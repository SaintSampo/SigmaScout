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
 * Also faithful as of D-Q1 (quick task 260901-is2) — component attribution.
 * `applyComponentUpdate` credits each rating-eligible teammate the alliance's
 * ERROR, shared equally, on top of that team's own current level:
 * `attrib = currentMean + (observed - predicted) / n`, one predicted-total
 * pass per alliance-component computed from the pre-update snapshot. That is
 * Statbotics' `post_process_attrib` (`err = observed - predicted`,
 * `attrib = epa + err / n`), and this bullet used to sit in the deliberate-
 * divergence list below claiming both that the alliance total was "divided
 * evenly across its rating-eligible teammates" and that "Statbotics has no
 * direct analog here". Both halves were false. The even split pulled every
 * team toward its alliance's mean on EVERY match: an alliance scoring exactly
 * its predicted total still dragged its strongest robot down and lifted its
 * weakest, when the honest update is that nobody moves.
 *
 * Measured over a 5-season faithful replay (carrySeason, offseason
 * built-not-scored), even split -> error split:
 *   - OLS slope vs Statbotics `epa.total_points` (2025, 3,690 teams):
 *     0.489 -> 0.841; Pearson 0.729 -> 0.900
 *   - rating SD 12.5 -> 17.4 (Statbotics: 18.7); mean abs difference
 *     11.2 -> 5.9 points
 *   - 2025 quals Brier 0.1950 -> 0.1589; 2026 quals 0.1771 -> 0.1427
 * The slope lands at 0.84 rather than 1.00 because of the deliberate
 * divergences listed below (full-weight elims vs `ELIM_WEIGHT = 1/3`, the
 * counter incrementing on elims, no per-season post-processing, a different
 * component decomposition) — 0.84 is the expected resting point of those
 * choices, NOT an unfinished job.
 *
 * **Provenance (quick task 260904-4aa, SC-2).** The D-Q1 figures immediately
 * above were produced by a one-off script that was never committed — an
 * un-re-runnable result, exactly the failure log's "docs must track the
 * shipped model" pitfall. That gap is closed: `scripts/epaVsStatbotics.ts`
 * (statistics in `packages/harness/epaStatboticsCompare.ts`) is the
 * committed, tested, re-runnable replacement, `npx tsx
 * scripts/epaVsStatbotics.ts --check` gates it against
 * `data/baselines/epa-vs-statbotics-2026-09.json`, and
 * `docs/models/epa-vs-statbotics.md` records the full current verdict
 * across all five seasons (not just 2025). A fresh 2026-09-04 measurement
 * lands close to but not identical to the D-Q1 figures above (2025
 * all-teams: slope 0.865 vs. 0.841, Pearson 0.907 vs. 0.900, joined 3,687
 * vs. 3,690 teams) — the corpus has grown since 260901-is2's one-off run,
 * and that document also measures an offseason-EXCLUDED comparability arm
 * this comment never did (2025: slope 1.012, Pearson 0.991), a materially
 * closer match. Treat the fresh, committed measurement as authoritative;
 * this comment's own D-Q1 figures are the historical record of what
 * changed when the error-split fix landed, not a maintained claim. A
 * future reader should regenerate current numbers from the script rather
 * than trust either quoted figure as a standing claim.
 *
 * The one thing that is still ours rather than Statbotics': TBA's
 * `score_breakdown` per-season maps this phase built (D-02) are alliance-level
 * only (Assumption A1 excludes unverified per-robot fields), so `n` is the
 * rating-eligible teammate count and the error is shared equally among them.
 * The ERROR is shared; the LEVEL is not.
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
 *   - D-13: no per-season post-processing — Statbotics' 2018 switch/scale
 *     sigmoid and its per-year clamps have no equivalent here, and this
 *     module runs no `post_process_breakdown` equivalent. Narrowed by D-Q1:
 *     the ATTRIBUTION half of `post_process_attrib` (`err = observed -
 *     predicted`, `attrib = epa + err / n`) IS now implemented faithfully —
 *     see the component-attribution paragraph above. What remains divergent
 *     is the per-season rescaling around it, not the error split itself.
 *   - Pitfall EPA-1: the win-probability scale denominator is this
 *     season's EXPANDING-window alliance-score SD (Welford, folded
 *     match-by-match via `packages/core/scoring/expandingStats.ts`), never
 *     a season-final constant — a season-batch SD would leak future
 *     variance into early-season predictions.
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
import { isFullyDemoAlliance } from "./demoTeams.js";
import { isFullyDqZeroScoreAlliance } from "./dq.js";
import {
  componentMapForSeason,
  assertFiniteComponents,
  FOULS_COMMITTED_COMPONENT,
  tryParseBreakdownPair,
  type ParsedComponents,
} from "./breakdown/index.js";
import { distributeResidual } from "./breakdown/fallback.js";
import {
  emptyExpandingStats,
  foldObservation,
  standardDeviation,
  type ExpandingStats,
} from "../scoring/expandingStats.js";
import { assertValidPRedWin } from "../scoring/predictionValidity.js";
import {
  TOTAL_METRIC_KEY,
  type AlgorithmModule,
  type BreakdownParseTelemetry,
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
export interface EpaState extends BreakdownParseTelemetry {
  readonly season: number | null;
  readonly teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>;
  readonly teamMatchCounts: ReadonlyMap<string, number>;
  readonly allianceScoreStats: ExpandingStats;
  readonly fallbackSkipped: number;
  readonly priorSeasonRatings: EpaCarryoverPriorRatings;
  // `breakdownParseFailureCount` (D-Q2, `BreakdownParseTelemetry`, extended
  // above): cumulative over the algorithm's whole lifetime, incremented only
  // for a "malformed" `tryParseBreakdownPair` outcome (T-03-18b). Kept
  // SEPARATE from `fallbackSkipped` immediately above — that field is a
  // permanently-zero invariant about a code path that must never run (a
  // breakdown-less match reaching a code path that dropped it entirely),
  // while this one is a genuine, expected-nonzero data-quality counter that
  // one shared CLI reader (`reportBreakdownParseFailures`) prints for both
  // EPA and Sigma1 and therefore must mean the same thing on both states.
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
    breakdownParseFailureCount: 0,
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
 * `ParsedComponents` numbers rather than `ComponentPrediction` records.
 *
 * WR-03 (code review, phase 02) correction: this is NOT "exactly the
 * vector `predict()` would have shown for this alliance" (the prior
 * comment's claim, disproven by CR-01). It is a straight per-team sum
 * across EVERY registered component, including this alliance's own
 * `FOULS_COMMITTED_COMPONENT` figure, with no cross-alliance adjustment.
 * `predict()`, by contrast, EXCLUDES that figure from an alliance's own
 * total and adds the OPPONENT's instead (D-04) — the two are not
 * interchangeable. A caller that needs `predict()`'s cross-attributed
 * total (the D-05 fallback path below) must apply that adjustment itself;
 * see `fallbackObserved`.
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

/**
 * CR-01 fix: this alliance's own currently-predicted total for
 * `FOULS_COMMITTED_COMPONENT`, carried forward UNCHANGED as the "observed"
 * value for a D-05 fallback match — never derived from `result.*Score`.
 * Mirrors, per team, exactly the cold-start fallback `applyComponentUpdate`
 * uses internally (`currentComponents[component] ?? coldStart`), so
 * feeding this value back in as the observation makes
 * `twoStageEwma(mean, mean, percent, 1) === mean`: a genuine no-op for a
 * component this project has no way to observe without a real breakdown
 * (D-04: it is derived from the OPPONENT's raw `foulPoints` field, equally
 * absent here) — never a silent drop, never a coerced zero (RESEARCH.md
 * Anti-Patterns). It also stays populated even for a team whose very first
 * match is a fallback match, satisfying D-05's "no component left
 * undefined" invariant (`breakdown.test.ts`).
 */
function foulsCommittedCarryForward(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teams: readonly string[],
  componentCount: number
): number {
  const coldStart = componentColdStartValue(componentCount);
  let total = 0;
  for (const team of teams) {
    total += teamComponents.get(team)?.[FOULS_COMMITTED_COMPONENT] ?? coldStart;
  }
  return total;
}

/**
 * CR-01 (code review, phase 02): builds the fallback-imputed observation
 * for one alliance when a match has no `score_breakdown`, mirroring
 * `predict()`'s own cross-alliance foul attribution rather than summing
 * every registered component (including this alliance's own
 * `foulsCommitted`) straight from `result.*Score`. Two invariants
 * enforced, per the review:
 *
 *   1. None of this alliance's own actual score is ever folded into its
 *      own `FOULS_COMMITTED_COMPONENT` slot — `opponentFoulsMean` is
 *      subtracted from `observedAllianceScore` BEFORE the split, and the
 *      split itself only ever runs over `offensiveComponents` (every
 *      registered component EXCEPT `FOULS_COMMITTED_COMPONENT`).
 *   2. The opponent's currently-predicted foul contribution to this
 *      alliance's actual score (`opponentFoulsMean`, D-04) is netted out
 *      before that split, so it is never misattributed into this
 *      alliance's own offensive components.
 */
function fallbackObserved(
  teamComponents: ReadonlyMap<string, Readonly<Record<string, number>>>,
  teams: readonly string[],
  observedAllianceScore: number,
  opponentFoulsMean: number,
  offensiveComponents: readonly string[],
  componentCount: number
): ParsedComponents {
  const offensive = distributeResidual(
    observedAllianceScore - opponentFoulsMean,
    predictedComponentTotals(teamComponents, teams),
    offensiveComponents
  );
  return {
    ...offensive,
    [FOULS_COMMITTED_COMPONENT]: foulsCommittedCarryForward(teamComponents, teams, componentCount),
  };
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
  // 01-REVIEW WR-05 / D-05: validated at emission, before this Prediction
  // is returned — see predictionValidity.ts's doc comment for why this
  // check lives here rather than at scoreSet/calibrationBins entry.
  assertValidPRedWin(pRedWin, `epa.predict (${match.matchKey})`);

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
 * rating-eligible teams by ERROR SPLIT — each teammate is credited
 * `currentMean + (allianceValue - predictedAllianceTotal) / n` (D-Q1; see the
 * file header's component-attribution bullet) — applying the two-stage EWMA
 * with D-08's full weight and unconditional counter increment. Returns new
 * maps; never mutates its inputs.
 *
 * The predicted total is computed ONCE per component, BEFORE the per-team
 * loop, from `teamComponents` — the pre-update snapshot. That ordering is
 * load-bearing, not stylistic: computing it inside the loop off the
 * progressively-updated `nextComponents` would attribute each teammate
 * against a prediction its predecessors had already moved, making the result
 * depend on the order `teams` happens to arrive in. Statbotics has the same
 * structure for the same reason — one `pred_bd` per alliance, then a loop
 * over teams.
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

  // D-Q1: one predicted-total pass per alliance-component, taken from the
  // PRE-update snapshot (`teamComponents`, not `nextComponents`) so every
  // teammate is attributed against the same prediction. The `?? coldStart`
  // fallback is character-for-character the one the per-team loop below
  // applies, so a team's own contribution to this sum is exactly the
  // `currentMean` it is later differenced against — if the two ever drifted
  // apart, an unobserved team would appear to have missed a prediction it was
  // never part of.
  const predictedAllianceTotals: Record<string, number> = {};
  for (const component of Object.keys(observed)) {
    let total = 0;
    for (const team of teams) {
      total += teamComponents.get(team)?.[component] ?? coldStart;
    }
    predictedAllianceTotals[component] = total;
  }

  for (const team of teams) {
    const matchCount = nextCounts.get(team) ?? 0;
    const percent = epaPercentFunc(matchCount);
    const currentComponents = nextComponents.get(team) ?? {};
    const updatedComponents: Record<string, number> = { ...currentComponents };

    for (const [component, allianceValue] of Object.entries(observed)) {
      const currentMean = currentComponents[component] ?? coldStart;
      // D-Q1: credit the alliance's ERROR, shared equally, on top of this
      // team's own level — Statbotics' `post_process_attrib`
      // (`err = observed - predicted`, `attrib = epa + err / n`). The retired
      // form fed `allianceValue / n`, the alliance TOTAL split evenly, which
      // pulled every team toward its alliance's mean on every match: an
      // alliance scoring exactly its prediction still dragged its strongest
      // robot down and lifted its weakest. Here that match is a genuine no-op,
      // because `twoStageEwma(mean, mean, percent, 1) === mean`.
      const attributed = currentMean + (allianceValue - predictedAllianceTotals[component]!) / teams.length;
      // D-08: weight is always 1 (no ELIM_WEIGHT discount), and the
      // counter below increments on every match including eliminations —
      // both deliberate divergences from Statbotics' `update_team`.
      updatedComponents[component] = twoStageEwma(currentMean, attributed, percent, 1);
    }

    nextComponents.set(team, updatedComponents);
    nextCounts.set(team, matchCount + 1);
  }

  return { teamComponents: nextComponents, teamMatchCounts: nextCounts };
}

function update(state: EpaState, result: MatchResult): EpaState {
  // Case 1 (`demoTeams.ts`): a fully-demo alliance is a non-contest (a
  // forfeit/no-show playoff bucket or an offseason bracket bye) — the WHOLE
  // MATCH is skipped, both alliances, never just the demo side's own share.
  // Checked against the RAW (pre-remap) team lists. Unlike OPR, EPA folds
  // every comp level (D-08), so this is NOT a defensive no-op here — it is
  // load-bearing for both the 36 real-event playoff matches and the 195
  // offseason `qm` rows this corpus carries with a fully-demo alliance.
  if (isFullyDemoAlliance(result.redTeams) || isFullyDemoAlliance(result.blueTeams)) return state;

  const season = state.season ?? deriveSeasonFromEventKey(result.eventKey);

  const redTeams = ratingEligibleTeams(result.redTeams, result.redSurrogates);
  const blueTeams = ratingEligibleTeams(result.blueTeams, result.blueSurrogates);

  const seasonMap = componentMapForSeason(season);
  const componentCount = seasonMap.components.length;

  const breakdownOutcome = tryParseBreakdownPair(season, result.scoreBreakdownRaw);
  const redParsed = breakdownOutcome.kind === "parsed" ? breakdownOutcome.red : null;
  const blueParsed = breakdownOutcome.kind === "parsed" ? breakdownOutcome.blue : null;

  // D-05 fallback: a match with no score_breakdown ("absent") OR a
  // score_breakdown that IS present but fails its season Zod schema
  // ("malformed" — T-03-18b, self-reported offseason data;
  // `tryParseBreakdownPair`, `breakdown/index.ts`) still updates state. CR-01
  // fix: the residual is distributed across this alliance's own OFFENSIVE
  // components only (never FOULS_COMMITTED_COMPONENT — see
  // fallbackObserved), against the alliance's own actual score net of the
  // OPPONENT's currently-predicted foul contribution — mirroring predict()'s
  // own cross-alliance attribution, rather than the flat, uncorrected sum
  // this fallback used to feed distributeResidual pre-fix. Never a silent
  // drop, never a coerced zero (RESEARCH.md Anti-Patterns).
  const breakdownParseFailureCount = state.breakdownParseFailureCount + (breakdownOutcome.kind === "malformed" ? 1 : 0);
  const nonFoulsComponents = seasonMap.components.filter((name) => name !== FOULS_COMMITTED_COMPONENT);
  const blueFoulsMean = predictedComponentTotals(state.teamComponents, blueTeams)[FOULS_COMMITTED_COMPONENT] ?? 0;
  const redFoulsMean = predictedComponentTotals(state.teamComponents, redTeams)[FOULS_COMMITTED_COMPONENT] ?? 0;

  const redObserved =
    redParsed ??
    fallbackObserved(state.teamComponents, redTeams, result.redScore, blueFoulsMean, nonFoulsComponents, componentCount);
  const blueObserved =
    blueParsed ??
    fallbackObserved(state.teamComponents, blueTeams, result.blueScore, redFoulsMean, nonFoulsComponents, componentCount);

  // WR-01 (code review, phase 02): throw loudly rather than let a
  // non-finite value (surviving the Zod parse boundary, or produced by
  // distributeResidual's degenerate branch off a non-finite
  // result.redScore/blueScore) silently poison this team's EWMA state for
  // the rest of the season — mirrors sigma1/index.ts's identical second
  // gate (T-02-01) for the same scenario.
  assertFiniteComponents(redObserved, `red observation, match ${result.matchKey}`);
  assertFiniteComponents(blueObserved, `blue observation, match ${result.matchKey}`);

  // `.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`: an
  // alliance whose every rating-eligible team is disqualified AND whose RAW
  // recorded score is exactly 0 gets NO component update at all — fed `[]`
  // to `applyComponentUpdate`, the same no-op input that function already
  // handles for an all-surrogate alliance (see its own doc comment). Checked
  // per-alliance, NOT per-match like `isFullyDemoAlliance` above: the
  // opposing alliance's own score is still a genuine observation of real
  // robots and its own component update proceeds unaffected.
  const redIsDqZero = isFullyDqZeroScoreAlliance(redTeams, result.redDqs, result.redScore);
  const blueIsDqZero = isFullyDqZeroScoreAlliance(blueTeams, result.blueDqs, result.blueScore);

  const afterRed = applyComponentUpdate(
    state.teamComponents,
    state.teamMatchCounts,
    redIsDqZero ? [] : redTeams,
    redObserved,
    componentCount
  );
  const afterBlue = applyComponentUpdate(
    afterRed.teamComponents,
    afterRed.teamMatchCounts,
    blueIsDqZero ? [] : blueTeams,
    blueObserved,
    componentCount
  );

  // Fold each alliance's observed total into the expanding-window SD — the
  // score itself is always known, even when its breakdown is not (Pitfall
  // EPA-1: this must only ever incorporate matches already replayed) — EXCEPT
  // a whole-alliance-DQ zero, which is a ruling, not an observed score, and
  // would otherwise pull this season SD toward zero for no real reason.
  let allianceScoreStats = state.allianceScoreStats;
  if (!redIsDqZero) allianceScoreStats = foldObservation(allianceScoreStats, result.redScore);
  if (!blueIsDqZero) allianceScoreStats = foldObservation(allianceScoreStats, result.blueScore);

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
    breakdownParseFailureCount,
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
    // D-Q2 (quick task 260818-inm): carried forward UNCHANGED, in deliberate
    // CONTRAST to the `fallbackSkipped` reset immediately above.
    // `fallbackSkipped` is a per-lifetime zero invariant about a code path
    // that must never run; `breakdownParseFailureCount` is a cumulative
    // data-quality counter that one shared CLI reader
    // (`reportBreakdownParseFailures`) prints for both EPA and Sigma1, so it
    // must mean the same thing — "observed since this algorithm started" —
    // on both states, and a season boundary is not a reason to forget it.
    breakdownParseFailureCount: state.breakdownParseFailureCount,
  };
}

export const epa: AlgorithmModule<EpaState> = {
  id: "epa",
  // D-13 (plan 03-03, Rule 1 fix): `buildArtifact` (packages/harness/artifact.ts)
  // now REQUIRES every algorithm's `version` to carry the
  // `{codeVersion}+{paramSetName}` shape, throwing otherwise — a real
  // `pnpm harness --algorithm epa` run would break at artifact-build time
  // without this. EPA has no separate tuned parameter set (D-04: frozen at
  // Statbotics' own published constants, never searched), so "baseline" is
  // the honest, single named set.
  //
  // Bumped 1.0.0 -> 1.1.0
  // (`.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`,
  // 2026-08-30): `update()`'s observable output changed — a whole-alliance
  // disqualification with a recorded 0 score is now dropped as a rating
  // observation instead of fitted as real performance
  // (`isFullyDqZeroScoreAlliance`, `dq.ts`) — the same D-13 invariant
  // `opr.ts`'s own version-bump comment names ("no artifact may show one
  // code version standing for two structurally different algorithms").
  //
  // Bumped 1.1.0 -> 2.0.0 (D-Q1, quick task 260901-is2): `update()`'s
  // observable output changed — `applyComponentUpdate` now attributes the
  // alliance's ERROR shared over its rating-eligible teammates
  // (`currentMean + (observed - predicted) / n`, Statbotics'
  // `post_process_attrib`) instead of the alliance TOTAL split evenly. Same
  // D-13 invariant as the 1.0.0 -> 1.1.0 bump above: no version string may
  // stand for two different computations.
  //
  // MAJOR, not minor, and deliberately so: unlike the 1.1.0 bump — which
  // changed an edge case (whole-alliance DQ zero scores, a few dozen matches
  // a season) — this changes the attribution arithmetic for EVERY multi-team
  // alliance in every match ever replayed. Every rating this module has ever
  // produced moves. Measured: rating SD 12.5 -> 17.4, OLS slope vs
  // Statbotics 0.489 -> 0.841, 2025 quals Brier 0.1950 -> 0.1589 (see the
  // file header for the full table).
  version: "2.0.0+baseline",
  initState,
  predict,
  update,
  teamMetrics,
  carrySeason,
};
