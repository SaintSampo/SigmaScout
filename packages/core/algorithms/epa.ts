/**
 * EPA (Expected Points Added) reimplementation — a component-decomposed,
 * variance-free `AlgorithmModule` (ALGO-02, D-13, D-08).
 *
 * Faithful core (D-13, verified verbatim against
 * github.com/avgupta456/statbotics/blob/master/backend/src/models/epa/{math,main}.py
 * this phase's RESEARCH.md session): the two-stage EWMA (`add_obs`'s
 * `update_mean` then a `weight` blend), the decaying learning rate
 * (`percent_func`), and the natural-exp form of the margin-over-season-SD
 * win-probability logistic (`k_func`'s base-10 form, converted to the same
 * shape `opr.ts`'s `logisticWinProbability` uses).
 *
 * Deliberate divergences from Statbotics (every one documented at its use
 * site below, per D-13's "every deliberate divergence must be documented"
 * requirement):
 *   - D-04: `predict()`'s alliance score excludes its OWN
 *     `FOULS_COMMITTED_COMPONENT` mean and instead adds the OPPOSING
 *     alliance's `FOULS_COMMITTED_COMPONENT` mean — mirrors
 *     `sigma1/index.ts`'s `allianceOffensiveTotal`/`predict` handling of the
 *     same component (see that file's D-04 comment). WINDOWS.md entry 3
 *     tracked this as a bug before this fix; see the use site below.
 *   - D-08: elimination matches are learned from normally — full weight
 *     (Statbotics: `ELIM_WEIGHT = 1/3`), and the per-team match counter
 *     increments on every match including elims (Statbotics: does not).
 *   - D-13: no per-season post-processing (Statbotics' 2018 switch/scale
 *     sigmoid, per-year clamps) — this module never runs
 *     `post_process_breakdown`/`post_process_attrib` equivalents.
 *   - Pitfall EPA-1: the win-probability scale denominator is this
 *     season's EXPANDING-window alliance-score SD (Welford, folded
 *     match-by-match via `packages/core/scoring/expandingStats.ts`), never
 *     a season-final constant — a season-batch SD would leak future
 *     variance into early-season predictions.
 *   - Component attribution: TBA's `score_breakdown` per-season maps this
 *     phase built (D-02) are alliance-level only (Assumption A1 excludes
 *     unverified per-robot fields), so a component's alliance total is
 *     divided evenly across its rating-eligible teammates — Statbotics has
 *     no direct analog here since its own component extraction differs.
 *   - Cold start: `EPA_NORM_MEAN`/`EPA_NORM_SD`/`EPA_INIT_PENALTY` are
 *     Statbotics-parity constants owned by `carryover.ts` (D-16, imported
 *     back here), but this module's INTRA-season cold start (a team's
 *     first-ever match, nothing to carry from at all) cannot live-convert
 *     them into "this season's point units" without a season scale that
 *     does not yet exist (the same Pitfall EPA-1 concern). See
 *     `EPA_INIT_COMPONENT_TOTAL` below for the documented, fixed-constant
 *     seed used instead. Cross-SEASON carry (a team WITH prior-season
 *     history) is `carrySeason` below, backed by `carryover.ts`'s
 *     `epaCarryover`.
 */
import { ratingEligibleTeams } from "./opr.js";
import {
  parseBreakdown,
  componentMapForSeason,
  FOULS_COMMITTED_COMPONENT,
  type ParsedComponents,
} from "./breakdown/index.js";
import { distributeResidual } from "./breakdown/fallback.js";
import {
  emptyExpandingStats,
  foldObservation,
  standardDeviation,
  type ExpandingStats,
} from "../scoring/expandingStats.js";
import {
  TOTAL_METRIC_KEY,
  type AlgorithmModule,
  type ComponentPrediction,
  type MatchResult,
  type Prediction,
  type SeasonBoundary,
  type TeamMetrics,
  type UpcomingMatch,
} from "./types.js";
import {
  EPA_INIT_PENALTY,
  EPA_NORM_MEAN,
  EPA_NORM_SD,
  epaCarryover,
  type EpaCarryoverPriorRatings,
} from "./carryover.js";

// EPA_NORM_MEAN/EPA_NORM_SD/EPA_INIT_PENALTY/EPA_MEAN_REVERSION are owned by
// carryover.ts (D-16) — imported here rather than redeclared, and
// re-exported below so this module's existing doc comments (and anything
// that historically imported the Statbotics-parity constants from here)
// keep working. See carryover.ts's file header for why that module owns
// them and not this one (avoiding a circular import at module-init time).
export { EPA_NORM_MEAN, EPA_NORM_SD, EPA_INIT_PENALTY };
export { EPA_MEAN_REVERSION } from "./carryover.js";

/**
 * The win-probability logistic's base-10 exponent coefficient (Statbotics'
 * `k_func` for year >= 2008). `epa.ts`'s `predict` uses the algebraically
 * identical natural-exp form: `10 ** (k * x) == exp(k * ln(10) * x)`, so
 * `winProb = 1 / (1 + exp(-margin / scale))` where
 * `scale = seasonScoreSd / (-k * ln(10))` — matching `opr.ts`'s
 * `logisticWinProbability` shape rather than introducing a second logistic
 * base.
 */
export const EPA_K = -5 / 8;

/**
 * Documented fallback for the expanding-window alliance-score SD before at
 * least 2 alliance-score observations exist this season (Pitfall EPA-1;
 * `standardDeviation`'s `count < 2` contract). A small, conservative
 * placeholder point-magnitude so week-1 win probabilities are neither
 * degenerate nor wildly over/underconfident before real variance data
 * accumulates. Phase 3 hyperparameter, default unverified.
 */
export const EPA_FALLBACK_SCORE_SD = 25;

/**
 * A flat, documented placeholder for "a rookie team's typical total
 * contribution to an alliance's score," in point units (Phase 3
 * hyperparameter, default unverified) — used only to give
 * `EPA_INIT_COMPONENT_TOTAL` below a defensible point-unit magnitude to
 * scale from.
 */
const EPA_INIT_TYPICAL_TEAM_SHARE = 20;

/**
 * A team's cold-start TOTAL contribution (summed across every component),
 * before any observation exists. `EPA_NORM_MEAN`/`EPA_NORM_SD`/
 * `EPA_INIT_PENALTY` are Statbotics' normalized-rating-scale constants, not
 * point units — this plan does not implement Statbotics' normalization
 * layer (D-13 skips per-season post-processing), so there is no live
 * conversion from that scale into point units at cold start. Instead, the
 * SAME fractional structure Statbotics uses (how far below the normalized
 * mean a rookie starts, as a fraction: `INIT_PENALTY * NORM_SD / NORM_MEAN`)
 * is applied to the flat `EPA_INIT_TYPICAL_TEAM_SHARE` placeholder to get a
 * defensible, non-zero, FIXED point-unit seed — exactly what the plan asks
 * for ("there is no season scale yet, so seed from a documented constant
 * and let the first observations correct it"). This total is divided
 * evenly across the season's registered component count (see
 * `componentColdStartValue`) the first time each component is observed for
 * a team, and is corrected within roughly a dozen matches by
 * `epaPercentFunc`'s fast initial learning rate (1/3 at match count 0).
 */
const EPA_INIT_COMPONENT_TOTAL =
  EPA_INIT_TYPICAL_TEAM_SHARE * (1 - (EPA_INIT_PENALTY * EPA_NORM_SD) / EPA_NORM_MEAN);

/**
 * Statbotics' decaying learning rate (`percent_func` for year >= 2016):
 * `(2/3) * clamp(0.5 - (0.2/6) * (matchCount - 6), 0.3, 0.5)`. 1/3 at
 * matchCount 0, decaying to 0.2 at matchCount >= 12 — a new team's rating
 * moves fast at first and settles as more observations accumulate.
 */
export function epaPercentFunc(matchCount: number): number {
  const prevYearShape = Math.min(0.5, Math.max(0.3, 0.5 - (0.2 / 6) * (matchCount - 6)));
  return (2 / 3) * prevYearShape;
}

/** The two-stage EWMA from Statbotics' `EPARating.add_obs` (D-08: `weight` is always 1 in this project, see file header). */
function twoStageEwma(mean: number, observation: number, percent: number, weight: number): number {
  const newMean = (1 - percent) * mean + percent * observation;
  return weight * newMean + (1 - weight) * mean;
}

function componentColdStartValue(componentCount: number): number {
  return componentCount > 0 ? EPA_INIT_COMPONENT_TOTAL / componentCount : 0;
}

/**
 * Per-team state: a component-mean record per team, a per-team match
 * counter (increments on EVERY match — D-08), an expanding-window alliance
 * score SD (Pitfall EPA-1), the season this state belongs to (derived
 * lazily from the first match's `eventKey`, since `initState` receives no
 * season parameter), and `fallbackSkipped` — a permanently-zero invariant
 * (asserted by test) left over from plan 02-01's tracer, which deliberately
 * skipped the component update for a breakdown-less match. Plan 02-02's
 * D-05 fallback (`distributeResidual`, below) means no match is skipped
 * anymore; the counter is kept only so a future regression that reopens
 * that gap fails loudly instead of silently. `priorSeasonRatings` (D-16):
 * normalized-scale ratings carried INTO `season` from the two seasons
 * before it, updated by `carrySeason` at each boundary — empty maps at the
 * cold-start season and for any team with no rating in a given prior
 * season (see `carryover.ts`).
 */
export interface EpaState {
  readonly season: number | null;
  readonly teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>;
  readonly teamMatchCounts: ReadonlyMap<string, number>;
  readonly allianceScoreStats: ExpandingStats;
  readonly fallbackSkipped: number;
  readonly priorSeasonRatings: EpaCarryoverPriorRatings;
}

const EMPTY_PRIOR_SEASON_RATINGS: EpaCarryoverPriorRatings = {
  lastSeason: new Map(),
  yearBefore: new Map(),
};

function deriveSeasonFromEventKey(eventKey: string): number {
  const season = Number.parseInt(eventKey.slice(0, 4), 10);
  if (!Number.isInteger(season)) {
    throw new Error(`epa: could not derive a season from event key "${eventKey}" (expected a leading 4-digit year)`);
  }
  return season;
}

function initState(teams: string[]): EpaState {
  const teamComponents = new Map<string, Readonly<Record<string, number>>>();
  const teamMatchCounts = new Map<string, number>();
  for (const team of teams) {
    teamComponents.set(team, {});
    teamMatchCounts.set(team, 0);
  }
  return {
    season: null,
    teamComponents,
    teamMatchCounts,
    allianceScoreStats: emptyExpandingStats(),
    fallbackSkipped: 0,
    priorSeasonRatings: EMPTY_PRIOR_SEASON_RATINGS,
  };
}

/** Sums each requested team's component means into one alliance-level `Record<component, ComponentPrediction>`. */
function sumComponentsAcrossTeam(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teams: readonly string[]
): Record<string, ComponentPrediction> {
  const totals: Record<string, number> = {};
  for (const team of teams) {
    const components = teamComponents.get(team);
    if (!components) continue;
    for (const [name, value] of Object.entries(components)) {
      totals[name] = (totals[name] ?? 0) + value;
    }
  }
  const result: Record<string, ComponentPrediction> = {};
  for (const [name, value] of Object.entries(totals)) {
    result[name] = { mean: value };
  }
  return result;
}

/**
 * Same alliance-level sum `predict()` shows a caller, but as plain
 * `ParsedComponents` numbers rather than `ComponentPrediction` records —
 * the shape `distributeResidual` (D-05) needs for "this alliance's own
 * predicted component vector."
 */
function predictedComponentTotals(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teams: readonly string[]
): ParsedComponents {
  const summed = sumComponentsAcrossTeam(teamComponents, teams);
  const result: ParsedComponents = Object.create(null) as ParsedComponents;
  for (const [name, componentPrediction] of Object.entries(summed)) {
    result[name] = componentPrediction.mean;
  }
  return result;
}

function predict(state: EpaState, match: UpcomingMatch): Prediction {
  const redTeams = ratingEligibleTeams(match.redTeams, match.redSurrogates);
  const blueTeams = ratingEligibleTeams(match.blueTeams, match.blueSurrogates);

  const redComponents = sumComponentsAcrossTeam(state.teamComponents, redTeams);
  const blueComponents = sumComponentsAcrossTeam(state.teamComponents, blueTeams);

  // D-04: an alliance's own FOULS_COMMITTED_COMPONENT mean represents
  // points ITS fouls would cost the OPPONENT (breakdown/2024.ts's parse()
  // derives it from the OPPOSING side's raw foulPoints), so it is excluded
  // from this alliance's own offensive total and added to the opponent's
  // predicted score instead — mirrors sigma1/index.ts's
  // `allianceOffensiveTotal` + `predict` handling of the same component.
  const redOffensiveTotal = Object.entries(redComponents).reduce(
    (sum, [name, c]) => (name === FOULS_COMMITTED_COMPONENT ? sum : sum + c.mean),
    0
  );
  const blueOffensiveTotal = Object.entries(blueComponents).reduce(
    (sum, [name, c]) => (name === FOULS_COMMITTED_COMPONENT ? sum : sum + c.mean),
    0
  );
  const redScore = redOffensiveTotal + (blueComponents[FOULS_COMMITTED_COMPONENT]?.mean ?? 0);
  const blueScore = blueOffensiveTotal + (redComponents[FOULS_COMMITTED_COMPONENT]?.mean ?? 0);

  // Pitfall EPA-1: the expanding-window SD only ever reflects matches
  // already replayed (folded in `update`), never a season-batch constant.
  const seasonScoreSd = standardDeviation(state.allianceScoreStats, EPA_FALLBACK_SCORE_SD);
  const scale = seasonScoreSd / (-EPA_K * Math.LN10);
  const margin = redScore - blueScore;
  const pRedWin = 1 / (1 + Math.exp(-margin / scale));

  return {
    // Ties (margin === 0) give pRedWin exactly 0.5 via the logistic form
    // itself (exp(0) === 1), and `>= 0.5` resolves to "red" — matching
    // `opr.ts`'s tie convention so every algorithm agrees at the boundary.
    winner: pRedWin >= 0.5 ? "red" : "blue",
    pRedWin,
    redScore,
    blueScore,
    redComponents,
    blueComponents,
  };
}

/**
 * Attributes one alliance's observed component vector across its
 * rating-eligible teams (evenly split per component — see file header on
 * component attribution), applying the two-stage EWMA with D-08's full
 * weight and unconditional counter increment. Returns new maps; never
 * mutates its inputs.
 */
function applyComponentUpdate(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teamMatchCounts: ReadonlyMap<string, number>,
  teams: readonly string[],
  observed: ParsedComponents,
  componentCount: number
): {
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>;
  teamMatchCounts: ReadonlyMap<string, number>;
} {
  if (teams.length === 0) {
    // Every team on this alliance was a surrogate — nothing to attribute,
    // a genuine no-op (mirrors opr.ts's own empty-observation handling).
    return { teamComponents, teamMatchCounts };
  }

  const nextComponents = new Map(teamComponents);
  const nextCounts = new Map(teamMatchCounts);
  const coldStart = componentColdStartValue(componentCount);

  for (const team of teams) {
    const matchCount = nextCounts.get(team) ?? 0;
    const percent = epaPercentFunc(matchCount);
    const currentComponents = nextComponents.get(team) ?? {};
    const updatedComponents: Record<string, number> = { ...currentComponents };

    for (const [component, allianceValue] of Object.entries(observed)) {
      const observedShare = allianceValue / teams.length;
      const currentMean = currentComponents[component] ?? coldStart;
      // D-08: weight is always 1 (no ELIM_WEIGHT discount), and the
      // counter below increments on every match including eliminations —
      // both deliberate divergences from Statbotics' `update_team`.
      updatedComponents[component] = twoStageEwma(currentMean, observedShare, percent, 1);
    }

    nextComponents.set(team, updatedComponents);
    nextCounts.set(team, matchCount + 1);
  }

  return { teamComponents: nextComponents, teamMatchCounts: nextCounts };
}

function update(state: EpaState, result: MatchResult): EpaState {
  const season = state.season ?? deriveSeasonFromEventKey(result.eventKey);

  const redTeams = ratingEligibleTeams(result.redTeams, result.redSurrogates);
  const blueTeams = ratingEligibleTeams(result.blueTeams, result.blueSurrogates);

  const seasonMap = componentMapForSeason(season);
  const componentCount = seasonMap.components.length;

  const redParsed = parseBreakdown(season, result.scoreBreakdownRaw, "red");
  const blueParsed = parseBreakdown(season, result.scoreBreakdownRaw, "blue");

  // D-05 fallback: a match with no score_breakdown (parseBreakdown
  // returns null) still updates state — the residual is distributed across
  // this alliance's own components in proportion to their current
  // predicted shares, using exactly the vector `predict()` would have
  // shown for this alliance. Never a silent drop, never a coerced zero
  // (RESEARCH.md Anti-Patterns).
  const redObserved =
    redParsed ?? distributeResidual(result.redScore, predictedComponentTotals(state.teamComponents, redTeams), seasonMap.components);
  const blueObserved =
    blueParsed ?? distributeResidual(result.blueScore, predictedComponentTotals(state.teamComponents, blueTeams), seasonMap.components);

  const afterRed = applyComponentUpdate(state.teamComponents, state.teamMatchCounts, redTeams, redObserved, componentCount);
  const afterBlue = applyComponentUpdate(
    afterRed.teamComponents,
    afterRed.teamMatchCounts,
    blueTeams,
    blueObserved,
    componentCount
  );

  // Fold both alliances' observed totals into the expanding-window SD — the
  // score itself is always known, even when its breakdown is not (Pitfall
  // EPA-1: this must only ever incorporate matches already replayed).
  const allianceScoreStats = foldObservation(foldObservation(state.allianceScoreStats, result.redScore), result.blueScore);

  return {
    season,
    teamComponents: afterBlue.teamComponents,
    teamMatchCounts: afterBlue.teamMatchCounts,
    allianceScoreStats,
    // Permanently zero (see EpaState's doc comment) — no code path below
    // this line increments it anymore.
    fallbackSkipped: state.fallbackSkipped,
    // Untouched by an ordinary match update — only carrySeason (D-16)
    // moves this forward, at a season boundary.
    priorSeasonRatings: state.priorSeasonRatings,
  };
}

/** D-27: per team, one entry per learned component plus `TOTAL_METRIC_KEY` (the component sum). No `spread` — EPA carries a mean only, exactly as Statbotics' `EPARating`. */
function teamMetrics(state: EpaState, teams?: readonly string[]): TeamMetrics {
  const requestedTeams = teams ?? [...state.teamComponents.keys()];
  const result: TeamMetrics = {};
  for (const team of requestedTeams) {
    const components = state.teamComponents.get(team);
    if (!components) continue;
    const perTeam: Record<string, { value: number }> = {};
    let total = 0;
    for (const [name, value] of Object.entries(components)) {
      perTeam[name] = { value };
      total += value;
    }
    perTeam[TOTAL_METRIC_KEY] = { value: total };
    result[team] = perTeam;
  }
  return result;
}

/**
 * D-16/D-19: carries every team's rating across a season boundary using
 * `carryover.ts`'s `epaCarryover` — this function's only job is reshaping
 * `EpaState`'s fields into and out of that pure calculation.
 *
 * `boundary.isColdStart === true` is a no-op: the cold-start season has no
 * `fromSeason` state to carry from, by definition (D-18), so `state` is
 * returned unchanged (the caller — the harness season loop — is not
 * expected to call this for the cold-start season at all, but this makes
 * the contract safe to call defensively regardless).
 *
 * `allianceScoreStats` is carried forward UNCHANGED (not reset) rather
 * than re-seeded empty: RESEARCH.md's Pitfall EPA-1 fix specifies seeding
 * the expanding-window score SD "from the prior season's final value at
 * season start" — this is that seed, applied at the one place a season
 * boundary is already being handled, so the harness season loop (plan
 * 02-03 Task 2) needs no second boundary hook for it.
 */
function carrySeason(state: EpaState, boundary: SeasonBoundary): EpaState {
  if (boundary.isColdStart) return state;

  const teamTotals = new Map<string, number>();
  for (const [team, components] of state.teamComponents) {
    let total = 0;
    for (const value of Object.values(components)) total += value;
    teamTotals.set(team, total);
  }

  const carryResult = epaCarryover({ teamTotals, priorSeasonRatings: state.priorSeasonRatings });

  const toSeasonComponents = componentMapForSeason(boundary.toSeason).components;
  const teamComponents = new Map<string, Readonly<Record<string, number>>>();
  const teamMatchCounts = new Map<string, number>();

  for (const [team, carriedTotal] of carryResult.teamPointTotals) {
    const share = toSeasonComponents.length > 0 ? carriedTotal / toSeasonComponents.length : 0;
    const record: Record<string, number> = {};
    for (const name of toSeasonComponents) record[name] = share;
    teamComponents.set(team, record);
    // A new season resets each team's match counter — the percent_func's
    // fast early learning rate applies fresh, exactly as it does for any
    // genuinely new team (D-08's counter semantics are per-season).
    teamMatchCounts.set(team, 0);
  }

  return {
    season: boundary.toSeason,
    teamComponents,
    teamMatchCounts,
    allianceScoreStats: state.allianceScoreStats,
    fallbackSkipped: 0,
    priorSeasonRatings: carryResult.priorSeasonRatings,
  };
}

export const epa: AlgorithmModule<EpaState> = {
  id: "epa",
  version: "1.0.0",
  initState,
  predict,
  update,
  teamMetrics,
  carrySeason,
};
