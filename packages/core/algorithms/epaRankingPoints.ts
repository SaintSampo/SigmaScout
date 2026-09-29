/**
 * EPA's ranking-point odds, by Statbotics' method (quick task 260929-mat,
 * L-02 lifted by Jacob 2026-09-29).
 *
 * Statbotics rates every team on each bonus RP the same way it rates a score
 * component: the rating lives in the pre-image of `unit_sigmoid`, the alliance
 * sums its three teams' ratings, and `post_process_breakdown` applies
 * `unit_sigmoid` to the sum to get the alliance's chance of earning the bonus.
 * The update is the ordinary EPA update on the error `flag - p`, split across
 * the alliance, and elimination matches leave the ratings alone
 * (`post_process_attrib`'s "Don't update RP score during elim match").
 * Transcriptions: `docs/models/statbotics-breakdown-reference.md` sections 12,
 * 13 and 15.
 *
 * Storage. A team's effective slot for bonus `b` is `cold(team, b) + offset`,
 * where `cold` is `get_init_epa`'s RP term evaluated from the season's current
 * walk-forward league rate and scale, and `offset` is the season-scoped sum of
 * this team's updates. Once EPA's week 1 seal fires, `cold` stops moving and
 * the effective slot is exactly Statbotics' `init + sum of updates`.
 *
 * The slots never feed a score, a winner or a component: EPA's win and score
 * arithmetic is untouched by anything in this file.
 *
 * Pure and Worker-importable: no Node-only API, no binding.
 */
import type { AnalyticRpPmfResult } from "../rankingPoints/analyticPmf.js";
import { carryNormalizedRating, EPA_NORM_MEAN, EPA_NORM_SD, type EpaCarryoverPriorRatings } from "./carryover.js";
import { EPA_CARRY_RESCALE_MIN_OBS } from "./epaCarryScale.js";
import { EPA_WEEK_ONE_MIN_OBS } from "./epaWeekOne.js";
import type { Prediction } from "./types.js";

/** Statbotics' `unit_sigmoid` (`math.py`): `1 / (1 + exp(-4 (x - 0.5)))`, so `unitSigmoid(0.5) === 0.5`. */
export function unitSigmoid(x: number): number {
  return 1 / (1 + Math.exp(-4 * (x - 0.5)));
}

/** Statbotics' `inv_unit_sigmoid` (`math.py`): `0.5 + ln(x / (1 - x)) / 4`. */
export function invUnitSigmoid(x: number): number {
  return 0.5 + Math.log(x / (1 - x)) / 4;
}

/**
 * Statbotics' `EPS` (`backend/src/constants.py`: `EPS = 1e-6`, beside
 * `CURR_YEAR = 2026`), fetched by the planner on 2026-09-29 from
 * raw.githubusercontent.com/avgupta456/statbotics/master/backend/src/constants.py.
 * `get_init_epa` clamps a league rate into `[EPS, 1 - EPS]` before the pre-image.
 */
export const EPA_RP_EPS = 1e-6;

/** Statbotics' `num_teams` for every season after 2004 (`get_constants`). */
export const EPA_RP_NUM_TEAMS = 3;

/** The league rate used before any usable one exists; its pre-image is exactly 0.5, a coin flip for a z-neutral alliance. */
export const EPA_RP_UNINFORMED_RATE = 0.5;

/**
 * Alliances folded before the live season rate replaces `EPA_RP_UNINFORMED_RATE`
 * ahead of the week 1 seal. Deliberately the SAME floor the carry rescale waits
 * for (`EPA_CARRY_RESCALE_MIN_OBS`), not a new tuned number: both are "a
 * season's own aggregate from enough of its own play to trust".
 */
export const EPA_RP_RATE_MIN_ALLIANCES = EPA_CARRY_RESCALE_MIN_OBS;

/** `get_init_epa`'s RP pre-image: `max(-1, inv_unit_sigmoid(max(EPS, min(1 - EPS, rate))))`. */
export function epaRpPreImage(rate: number): number {
  return Math.max(-1, invUnitSigmoid(Math.max(EPA_RP_EPS, Math.min(1 - EPA_RP_EPS, rate))));
}

/**
 * League-scoped bonus-rate state, flat in team count (it rides the epa LEAGUE
 * row). `sums[name]` counts alliances that earned bonus `name`; `alliances`
 * counts alliances folded. The week 1 pair is the same over Statbotics' week 1
 * population only, and `frozenRates` is set once by the week 1 seal.
 */
export interface EpaRpLeagueState {
  readonly alliances: number;
  readonly sums: Readonly<Record<string, number>>;
  readonly weekOneAlliances: number;
  readonly weekOneSums: Readonly<Record<string, number>>;
  readonly frozenRates: Readonly<Record<string, number>> | null;
}

export function emptyEpaRpLeague(): EpaRpLeagueState {
  return { alliances: 0, sums: {}, weekOneAlliances: 0, weekOneSums: {}, frozenRates: null };
}

/**
 * The walk-forward league rate for one bonus, the `year.rp_x_mean` analogue:
 * the frozen week 1 rate once EPA's week 1 seal fired with enough week 1
 * alliances; else the live season rate once `EPA_RP_RATE_MIN_ALLIANCES`
 * alliances have folded; else `EPA_RP_UNINFORMED_RATE`.
 */
export function epaRpLeagueRate(league: EpaRpLeagueState, bonusName: string): number {
  const frozen = league.frozenRates?.[bonusName];
  if (frozen !== undefined) return frozen;
  if (league.alliances >= EPA_RP_RATE_MIN_ALLIANCES) return (league.sums[bonusName] ?? 0) / league.alliances;
  return EPA_RP_UNINFORMED_RATE;
}

/**
 * `get_init_epa`'s RP term for one team, kept WHOLE including its z-score term:
 * `mean / num_teams + sd * max(zFloor, z)` with `sd = mean * sdFrac`, where
 * `mean` is the bonus pre-image. `sdFrac === null` (no readable season scale)
 * drops the z term and gives `preImage / 3`.
 *
 * The quirk is Statbotics' own and is kept deliberately (Jacob, 2026-09-29):
 * below a league rate of about 12% the pre-image is negative, so a STRONGER
 * team's cold slot is LOWER than a weaker one's.
 */
export function epaRpColdSlot(preImage: number, sdFrac: number | null, zFloor: number, z: number): number {
  if (sdFrac === null) return preImage / EPA_RP_NUM_TEAMS;
  return preImage / EPA_RP_NUM_TEAMS + preImage * sdFrac * Math.max(zFloor, z);
}

/**
 * A team's carried strength as a z score, `(carried normalized - NORM_MEAN) /
 * NORM_SD`: exactly the normalized rating `epaCarryover` used for this team at
 * the season's boundary, re-derived from the carried-in `priorSeasonRatings`.
 * A team with no history is the rookie baseline (z = -0.2), as in Statbotics.
 */
export function epaRpTeamZ(priorSeasonRatings: EpaCarryoverPriorRatings, team: string): number {
  const normalized = carryNormalizedRating(
    priorSeasonRatings.lastSeason.get(team) ?? null,
    priorSeasonRatings.yearBefore.get(team) ?? null
  );
  return (normalized - EPA_NORM_MEAN) / EPA_NORM_SD;
}

/**
 * Maps an RP pmf result onto `Prediction`'s RP fields, field for field as
 * `SigmaScoutLayer.#rpFieldsFor` does, so EPA's rows carry the exact shapes
 * SPR's do: both totals always, both per-bonus marginals when present, and the
 * five decomposition fields as a set only when the outcome and both bonus pmfs
 * exist.
 */
export function rpPredictionFieldsFrom(result: AnalyticRpPmfResult): Partial<Prediction> {
  const decomposition: Partial<Prediction> =
    result.outcome !== undefined && result.redBonusPmf !== undefined && result.blueBonusPmf !== undefined
      ? {
          matchOutcomePmf: [result.outcome.pRedWin, result.outcome.pTie, result.outcome.pBlueWin],
          redOutcomeRp: [result.outcome.winRp, result.outcome.tieRp, 0],
          blueOutcomeRp: [0, result.outcome.tieRp, result.outcome.winRp],
          redBonusRpPmf: result.redBonusPmf,
          blueBonusRpPmf: result.blueBonusPmf,
        }
      : {};
  return {
    redRpPmf: result.redPmf,
    blueRpPmf: result.bluePmf,
    ...(result.redBonusProbabilities !== undefined ? { redBonusRp: result.redBonusProbabilities } : {}),
    ...(result.blueBonusProbabilities !== undefined ? { blueBonusRp: result.blueBonusProbabilities } : {}),
    ...decomposition,
  };
}

/**
 * Folds one alliance's observed bonus flags into the league rate state. The
 * season-wide pair always moves; the week 1 pair moves only when `inWeekOne`
 * (the caller passes `isStatboticsWeekOne(week)` and "not yet sealed").
 */
export function foldEpaRpLeague(
  league: EpaRpLeagueState,
  bonusNames: readonly string[],
  flags: Readonly<Record<string, boolean>>,
  inWeekOne: boolean
): EpaRpLeagueState {
  const sums: Record<string, number> = { ...league.sums };
  for (const name of bonusNames) sums[name] = (sums[name] ?? 0) + (flags[name] === true ? 1 : 0);
  if (!inWeekOne) return { ...league, alliances: league.alliances + 1, sums };
  const weekOneSums: Record<string, number> = { ...league.weekOneSums };
  for (const name of bonusNames) weekOneSums[name] = (weekOneSums[name] ?? 0) + (flags[name] === true ? 1 : 0);
  return { ...league, alliances: league.alliances + 1, sums, weekOneAlliances: league.weekOneAlliances + 1, weekOneSums };
}

/**
 * The week 1 seal's RP half, called once on the seal transition: freezes each
 * bonus's week 1 rate when at least `EPA_WEEK_ONE_MIN_OBS` week 1 alliances
 * folded, and otherwise leaves `frozenRates` null so the live season rate keeps
 * applying (the same "a seal that found too little data freezes nothing" rule
 * the score aggregate follows).
 */
export function freezeEpaRpLeague(league: EpaRpLeagueState): EpaRpLeagueState {
  if (league.frozenRates !== null) return league;
  if (league.weekOneAlliances < EPA_WEEK_ONE_MIN_OBS) return league;
  const frozenRates: Record<string, number> = {};
  for (const [name, sum] of Object.entries(league.weekOneSums)) frozenRates[name] = sum / league.weekOneAlliances;
  return { ...league, frozenRates };
}

/**
 * One alliance's slot update, Statbotics' `attribute_match` plus `add_obs` at
 * full weight: each team's offset for bonus `b` moves by
 * `percent(team) * (flag_b - p_b) / teams.length`, with `p_b` the alliance's
 * pre-update probability. Returns a new map; never mutates its input.
 */
export function applyEpaRpSlotUpdate(
  offsets: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teams: readonly string[],
  bonusNames: readonly string[],
  flags: Readonly<Record<string, boolean>>,
  probabilities: readonly number[],
  percentFor: (team: string) => number
): ReadonlyMap<string, Readonly<Record<string, number>>> {
  if (teams.length === 0) return offsets;
  const next = new Map(offsets);
  for (const team of teams) {
    const percent = percentFor(team);
    const current = offsets.get(team) ?? {};
    const updated: Record<string, number> = { ...current };
    bonusNames.forEach((name, index) => {
      const err = Number(flags[name] === true) - probabilities[index]!;
      updated[name] = (current[name] ?? 0) + (percent * err) / teams.length;
    });
    next.set(team, updated);
  }
  return next;
}
