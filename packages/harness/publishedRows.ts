/**
 * Published match-row assembly shared by the offline publisher (`publish.ts`)
 * and the browser pricer (`eventStatePricing.ts`): rounding, key presence and
 * comp-level gates for one upcoming event row and one team-season row.
 *
 * Moved verbatim out of `publish.ts`, so both callers build rows through the
 * same code and cannot disagree on a rounding call or a conditional key.
 *
 * BROWSER-SAFE: imports only `rounding.ts`, `constants.ts` and type-only
 * algorithm types. Never import `publish.ts` here, not even for a type
 * (`eventStatePricing.browserSafe.test.ts`).
 */
import type { CompLevel, Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import { isBonusRpCompLevel } from "../core/rankingPoints/constants.js";
import { roundMetric, roundPmf, roundProbability, roundTo, ROUNDING_RULE } from "./rounding.js";

/** The schedule fields every row reads off a match; played and upcoming matches both carry them. */
type RowMatch = Pick<UpcomingMatch, "matchKey" | "eventKey" | "compLevel" | "setNumber" | "matchNumber" | "redTeams" | "blueTeams">;

/**
 * One match with its prediction and published display band. Structurally
 * `publish.ts`'s `UpcomingPredictionRecord` (and, for team rows, its
 * `PredictionRecord`), declared locally so this module never imports the CLI.
 */
export interface PublishedRowRecord {
  readonly match: RowMatch;
  readonly prediction: Prediction;
  readonly matchBand?: { red?: number; blue?: number };
}

/**
 * One row's published display band as a spreadable object, rounded once here; a side with no band
 * has no key. Played, upcoming and team-season rows all go through this, so they cannot disagree.
 */
export function matchBandFields(matchBand: { red?: number; blue?: number } | undefined): {
  redMatchBandVariance?: number;
  blueMatchBandVariance?: number;
} {
  return {
    ...(matchBand?.red !== undefined ? { redMatchBandVariance: roundTo(matchBand.red, ROUNDING_RULE.variance) } : {}),
    ...(matchBand?.blue !== undefined ? { blueMatchBandVariance: roundTo(matchBand.blue, ROUNDING_RULE.variance) } : {}),
  };
}

/**
 * The per-bonus RP fields for one event match row, with the same gates `buildTeamSeasonArtifact`
 * applies: predicted marginals only for a bonus-eligible level and a prediction carrying them; actual
 * flags only for a bonus-eligible level with a map entry, `null` staying `null` (never all-false).
 * An upcoming row passes `flags === undefined` and gets the predicted pair only.
 */
export function eventMatchBonusRpFields(
  compLevel: CompLevel,
  prediction: { readonly redBonusRp?: readonly number[]; readonly blueBonusRp?: readonly number[] },
  flags: { readonly red: readonly boolean[]; readonly blue: readonly boolean[] } | null | undefined
): Partial<{ redBonusRp: number[]; blueBonusRp: number[]; actualRedBonusRp: boolean[] | null; actualBlueBonusRp: boolean[] | null }> {
  return {
    ...(isBonusRpCompLevel(compLevel) && prediction.redBonusRp ? { redBonusRp: prediction.redBonusRp.map((p) => roundProbability(p)) } : {}),
    ...(isBonusRpCompLevel(compLevel) && prediction.blueBonusRp ? { blueBonusRp: prediction.blueBonusRp.map((p) => roundProbability(p)) } : {}),
    ...(isBonusRpCompLevel(compLevel) && flags !== undefined
      ? { actualRedBonusRp: flags === null ? null : [...flags.red], actualBlueBonusRp: flags === null ? null : [...flags.blue] }
      : {}),
  };
}

/** One `EventArtifact.upcoming` row, before schema parse. `sortTime` is the caller's lookup; `undefined` stays absent after parse. */
export function eventUpcomingRow(record: PublishedRowRecord, sortTime: number | undefined) {
  const { match, prediction, matchBand } = record;
  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    sortTime,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    redScoreVarianceOwn:
      prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    blueScoreVarianceOwn:
      prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    ...matchBandFields(matchBand),
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    matchOutcomePmf: prediction.matchOutcomePmf ? roundPmf(prediction.matchOutcomePmf) : undefined,
    redBonusRpPmf: prediction.redBonusRpPmf ? roundPmf(prediction.redBonusRpPmf) : undefined,
    blueBonusRpPmf: prediction.blueBonusRpPmf ? roundPmf(prediction.blueBonusRpPmf) : undefined,
    // No actual outcome yet, so predicted marginals only.
    ...eventMatchBonusRpFields(match.compLevel, prediction, undefined),
  };
}

/** The per-artifact stamps and per-match lookups a team-season row carries. */
export interface TeamSeasonRowStamps {
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  /** `match_key` -> `sort_time` lookup result; `undefined` leaves the key absent after parse. */
  readonly sortTime: number | undefined;
  /** The raw YouTube video key lookup result; the key is spread only when defined. */
  readonly video: string | undefined;
}

/**
 * The fields every `TeamSeasonArtifact` match row carries, played or upcoming. The played branch in
 * `buildTeamSeasonArtifact` spreads this and appends its played-only keys.
 */
export function teamSeasonMatchRow(record: PublishedRowRecord, stamps: TeamSeasonRowStamps) {
  const { match, prediction } = record;
  const sortTime = stamps.sortTime;
  return {
    matchKey: match.matchKey,
    season: stamps.season,
    eventKey: match.eventKey,
    compLevel: match.compLevel,
    algorithmId: stamps.algorithmId,
    algorithmVersion: stamps.algorithmVersion,
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    variance: prediction.variance !== undefined ? roundTo(prediction.variance, ROUNDING_RULE.variance) : undefined,
    // Each alliance's own predicted-score variance; undefined for OPR/EPA.
    redScoreVarianceOwn:
      prediction.redScoreVarianceOwn !== undefined ? roundTo(prediction.redScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    blueScoreVarianceOwn:
      prediction.blueScoreVarianceOwn !== undefined ? roundTo(prediction.blueScoreVarianceOwn, ROUNDING_RULE.variance) : undefined,
    // The same `record.matchBand` the event artifact reads, so both rows match by construction.
    ...matchBandFields(record.matchBand),
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    // The Match column's label, published rather than re-derived client-side from the matchKey.
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    sortTime,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    // Predicted per-bonus marginals are independent probabilities, so they round per value, never
    // through `roundPmf`. Gated on the comp level so a playoff row carries neither key even if a
    // caller-supplied `Prediction` has them.
    ...(isBonusRpCompLevel(match.compLevel) && prediction.redBonusRp
      ? { redBonusRp: prediction.redBonusRp.map((p) => roundProbability(p)) }
      : {}),
    ...(isBonusRpCompLevel(match.compLevel) && prediction.blueBonusRp
      ? { blueBonusRp: prediction.blueBonusRp.map((p) => roundProbability(p)) }
      : {}),
    // Unconditional lookup; the corpus has no `video_key` for unplayed matches.
    ...(stamps.video !== undefined ? { video: stamps.video } : {}),
  };
}
