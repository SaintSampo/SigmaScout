/**
 * Sigma1: the variance-carrying `AlgorithmModule<Sigma1State>` (ALGO-03,
 * D-01) — every team metric ships as a mean AND a variance derived from
 * that team's OWN observed match history (never a fixed constant, a
 * placeholder, or a copy of another team's value — PROJECT.md's core
 * value), and every match prediction carries the full predictive variance
 * behind its win probability (D-10).
 *
 * Assembles `kalman.ts` (the per-component Kalman recursion), `covariance.ts`
 * (D-03's per-team cross-component covariance and total-variance quadratic
 * form), `consistency.ts` (D-09/D-11's consistency/R term estimator — ONE OF
 * THE TWO TERMS behind every published spread since plan 07-06, D-01/D-02;
 * see `teamMetrics`'s own doc comment below for the full redefinition), and
 * `linkFunctions.ts` (D-12's three win-probability modes) into one
 * `predict`/`update`/`teamMetrics`/`carrySeason` contract, reusing
 * `opr.ts`'s `ratingEligibleTeams` and `breakdown/index.ts`'s per-season
 * component maps unchanged rather than re-deriving surrogate policy or
 * component extraction (RESEARCH.md Pattern 2, 02-PATTERNS.md).
 *
 * `makeSigma1({ id, linkMode })` builds one module per D-12 win-probability
 * mode; `update`'s state-transition math is IDENTICAL across every mode
 * (link mode only affects `predict`'s probability step), so three prebuilt
 * modules (`vpr`, `vprSeasonSd`, `vprNormalCdf` — renamed by plan 07-16,
 * D-04/D-05, from the pre-rename exports of the same shape) can each run
 * their own state instance in one harness pass — three times a cheap
 * update, in exchange for D-12's side-by-side comparison table without a
 * second replay pass.
 *
 * D-06 (no defense latent, no cross-team covariance): Sigma1 estimates
 * OFFENSE ONLY. This project's failure log already recorded what happens
 * when a dimension the observables cannot separate gets estimated anyway
 * (an unidentifiable 4D model, shipped without an evaluation harness) —
 * unexplained suppression here correctly widens a team's residual (and
 * therefore its `±`) rather than being falsely attributed to a defense
 * term the alliance-sum observation model has no way to identify.
 */
import { ratingEligibleTeams } from "../opr.js";
import { isFullyDemoAlliance } from "../demoTeams.js";
import { isFullyDqZeroScoreAlliance } from "../dq.js";
import {
  COMPONENT_GROUP_IDS,
  COMPONENT_GROUP_METRIC_KEYS,
  FOULS_COMMITTED_COMPONENT,
  componentGroupsForSeason,
  componentMapForSeason,
  assertFiniteComponents,
  tryParseBreakdownPair,
  type ParsedComponents,
} from "../breakdown/index.js";
import { distributeResidual, FALLBACK_NOISE_MULTIPLIER } from "../breakdown/fallback.js";
import { emptyExpandingStats, foldObservation, standardDeviation, type ExpandingStats } from "../../scoring/expandingStats.js";
import { assertValidPRedWin } from "../../scoring/predictionValidity.js";
import {
  TOTAL_METRIC_KEY,
  type AlgorithmModule,
  type BreakdownParseTelemetry,
  type ComponentPrediction,
  type MatchResult,
  type Prediction,
  type SeasonBoundary,
  type TeamMetric,
  type TeamMetrics,
  type UpcomingMatch,
} from "../types.js";
import { type EpaCarryoverPriorRatings } from "../carryover.js";
import { applyProcessNoise, updateAllianceSum, type TeamComponentBelief } from "./kalman.js";
import { adaptationFactor, emptyInnovationStats, foldInnovation, type InnovationStats } from "./adaptation.js";
import {
  allianceTotalPredictiveVariance,
  emptyCovariance,
  ewmaCovariance,
  ewmaCovarianceSample,
  subsetVariance,
  teamTotalVariance,
} from "./covariance.js";
// `foldConsistency` is deliberately NOT imported here: since 3.0.0 (D-Q2)
// nothing on this module's update path holds a residual, so importing the
// residual door would leave a dead binding that reads like a live one. It is
// still RE-EXPORTED below, unchanged, for callers that genuinely have one.
import { foldConsistencyVariance, shrinkConsistency } from "./consistency.js";
import { winProbability, type WinProbMode } from "./linkFunctions.js";
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_CODE_VERSION, Sigma1ParamsSchema, type Sigma1Params } from "./params.js";
import { resolveSigma1Params, type Sigma1ResolvedParams } from "./scale.js";
import { sigma1Carryover } from "./carryover.js";
import { rpRuleModuleForSeason } from "./rp/rules.js";
import { isRpEligibleEventType, type RpParsedResult, type RpRuleModule } from "./rp/constants.js";
import {
  emptyRpTeamState,
  foldRpObservation,
  predictAllianceRpMoments,
  type RpLeague,
  type RpTeamState,
} from "./rp/state.js";
import { rpPmfForMatch } from "./rp/distribution.js";

export type { TeamComponentBelief } from "./kalman.js";
export type { WinProbMode } from "./linkFunctions.js";
export {
  DEFAULT_SIGMA1_PARAMS,
  SIGMA1_CODE_VERSION,
  SIGMA1_COLD_START_CONSISTENCY_VARIANCE,
  SIGMA1_COLD_START_TEAM_TOTAL,
  SIGMA1_CONSISTENCY_CARRY_DECAY,
  SIGMA1_FALLBACK_SCORE_SD,
  SIGMA1_PARAM_KEYS,
  SIGMA1_REFERENCE_SCORE_VARIANCE,
  Sigma1ParamsSchema,
  type Sigma1Params,
} from "./params.js";
export { resolveSigma1Params, type Sigma1ResolvedParams } from "./scale.js";
export {
  SIGMA1_COV_EWMA_ALPHA,
  SIGMA1_COV_SHRINKAGE,
  allianceTotalPredictiveVariance,
  emptyCovariance,
  ewmaCovariance,
  ewmaCovarianceSample,
  teamTotalVariance,
} from "./covariance.js";
export {
  SIGMA1_CONSISTENCY_EWMA_ALPHA,
  SIGMA1_SHRINKAGE_PRIOR_MATCHES,
  SIGMA1_MIN_CONSISTENCY_VARIANCE,
  foldConsistency,
  foldConsistencyVariance,
  shrinkConsistency,
} from "./consistency.js";
export { SIGMA1_LINK_C, erf, normalCdf, winProbability } from "./linkFunctions.js";
export {
  SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY,
  SIGMA1_PROCESS_NOISE_WITHIN_EVENT,
  applyProcessNoise,
  updateAllianceSum,
} from "./kalman.js";

function componentColdStartTotal(componentCount: number, params: Sigma1ResolvedParams): number {
  return componentCount > 0 ? params.coldStartTeamTotal / componentCount : 0;
}

/**
 * One team's full Sigma1 state: Kalman beliefs, cross-component covariance,
 * and the D-09/D-11 consistency estimate, per component. Extends
 * `rp/state.ts`'s `RpTeamState` (adds `rpBeliefs`/`rpCovariance`/
 * `rpCrossCovariance`, D-09's parallel threshold-variable state) — kept
 * structurally SEPARATE members, never merged into `covariance` above; see
 * `rp/state.ts`'s file header for why that separation is provable rather
 * than merely asserted.
 */
export interface Sigma1TeamState extends RpTeamState {
  readonly beliefs: Readonly<Record<string, TeamComponentBelief>>;
  /** D-03's per-team cross-component covariance matrix Sigma, indexed by `Sigma1State.componentOrder`. */
  readonly covariance: number[][];
  /** Raw (unshrunk) EWMA consistency VARIANCE per component — `shrinkConsistency` is applied at read time (`teamMetrics`), not stored pre-shrunk. */
  readonly consistency: Readonly<Record<string, number>>;
  readonly matchCount: number;
  /** D-07: the `eventKey` of the last match this team was observed in, for cross-event process-noise detection. `null` for a team never yet observed. */
  readonly lastEventKey: string | null;
  /** D-05/D-07 (plan 03-04, `./adaptation.js`): this team's own recency-weighted innovation history, scaling `applyTeamProcessNoise`'s `q` via `adaptationFactor`. ONE scalar-producing statistic per team (D-07's granularity), never one per component. */
  readonly innovationStats: InnovationStats;
}

/**
 * League-wide running aggregates feeding D-11's shrinkage prior and every
 * cold-start team's baseline (Claude's Discretion, RESEARCH.md). Extends
 * `rp/state.ts`'s `RpLeague` — `rpVariableMean` is D-09's third record,
 * alongside the two score-side aggregates below.
 */
export interface Sigma1League extends RpLeague {
  /** Per-component expanding stats over every rating-eligible team's OWN observed per-match share — `.mean` is the live league-average component share, the cold-start baseline once populated. */
  readonly componentMean: Readonly<Record<string, ExpandingStats>>;
  /**
   * Per-component expanding stats over the INNOVATION-BASED variance sample
   * `max(0, innovation^2 - sum P) / n` (D-Q2, quick task 260901-is2), folded
   * once per rating-eligible teammate per alliance-component — `.mean` is a
   * running league-average consistency VARIANCE, D-11's shrinkage target.
   *
   * This must fold the SAME sample the per-team estimators do. It is
   * `shrinkConsistency`'s prior, i.e. the value a thin-history team's spread
   * is blended toward, so folding a different quantity here would blend two
   * incompatible variances and leave the estimator fix doing nothing for
   * every new team. Before 3.0.0 this averaged each team's own squared
   * gain-weighted residual, which ran roughly 25x small.
   */
  readonly componentConsistency: Readonly<Record<string, ExpandingStats>>;
}

export interface Sigma1State extends BreakdownParseTelemetry {
  readonly season: number | null;
  /** This season's canonical, ordered component list — indexes every team's `covariance` matrix. Empty until the first `update()` call resolves a season. */
  readonly componentOrder: readonly string[];
  readonly teams: ReadonlyMap<string, Sigma1TeamState>;
  readonly league: Sigma1League;
  /** Pitfall EPA-1: expanding-window alliance-score SD, folded match-by-match, never a season-batch constant — feeds D-12 mode 1's denominator. */
  readonly allianceScoreStats: ExpandingStats;
  /** D-16/D-17: normalized-scale ratings carried into `season` from the two seasons before it, reusing `carryover.ts`'s EPA-shaped carry (see `carrySeason` below). */
  readonly priorSeasonRatings: EpaCarryoverPriorRatings;
  /**
   * Plan 03-03: how many matches' RP threshold-variable fold was SKIPPED
   * because `result.scoreBreakdownRaw` was `null` (the same `usedFallback`
   * population the score side already imputes via `fallbackObserved` —
   * measured at 0.00%-0.12% across 2022-2026, RESEARCH.md). A cumulative
   * counter across the algorithm's whole lifetime, never reset by
   * `carrySeason` (mirrors `allianceScoreStats`'s own "carry forward
   * unchanged" choice) — makes the skip observable rather than silent.
   */
  readonly rpSkippedMatchCount: number;
  // `breakdownParseFailureCount` (D-Q2, `BreakdownParseTelemetry`, extended
  // above) — see that interface's own doc comment for why this is a
  // SEPARATE, never-merged counter from `rpSkippedMatchCount` above.
}

const EMPTY_PRIOR_SEASON_RATINGS: EpaCarryoverPriorRatings = { lastSeason: new Map(), yearBefore: new Map() };

function initState(): Sigma1State {
  return {
    season: null,
    componentOrder: [],
    teams: new Map(),
    league: { componentMean: {}, componentConsistency: {}, rpVariableMean: {} },
    allianceScoreStats: emptyExpandingStats(),
    priorSeasonRatings: EMPTY_PRIOR_SEASON_RATINGS,
    rpSkippedMatchCount: 0,
    breakdownParseFailureCount: 0,
  };
}

function deriveSeasonFromEventKey(eventKey: string): number {
  const season = Number.parseInt(eventKey.slice(0, 4), 10);
  if (!Number.isInteger(season)) {
    throw new Error(`sigma1: could not derive a season from event key "${eventKey}" (expected a leading 4-digit year)`);
  }
  return season;
}

function leagueMeanFor(league: Sigma1League, component: string, fallback: number): number {
  const stats = league.componentMean[component];
  return stats && stats.count > 0 ? stats.mean : fallback;
}

function leagueConsistencyFor(league: Sigma1League, component: string, fallback: number): number {
  const stats = league.componentConsistency[component];
  return stats && stats.count > 0 ? stats.mean : fallback;
}

/**
 * The league consistency prior used to SEED a team's own state — a
 * cold-start team's belief variance and consistency
 * (`coldStartTeamState`), and a carried team's re-inflated posterior across
 * a season boundary (`carrySeason`) — floored at
 * `params.minConsistencyVariance`.
 *
 * D-Q2 (quick task 260901-is2) made this floor load-bearing rather than
 * decorative. The innovation-based sample is
 * `max(0, innovation^2 - sum P) / n` and genuinely EQUALS 0 whenever a
 * match lands inside the prior's own spread — which is most of them in the
 * first matches of a season, when P is still at its cold-start width. So
 * `componentConsistency[name].mean` can legitimately be exactly 0 with a
 * non-zero count, and seeding from it unfloored gives a team `P = 0` AND
 * `R = 0` for that component, hence `pooledVariance = 0`, hence
 * `kalman.ts`'s zero-gain branch: a team that cannot learn from its own
 * first observation, publishing a `0 ±` claim of perfect certainty. The
 * retired squared-gain-weighted-residual sample was never exactly 0 in
 * practice, so this path was unreachable before 3.0.0 — it is a consequence
 * of the estimator change and is fixed here rather than left to surface as
 * a frozen team.
 *
 * Deliberately reuses `shrinkConsistency`'s OWN floor rather than introducing
 * a second constant: it is the same statement — a variance blended toward a
 * still-cold-start league average must not claim an implausibly tiny spread —
 * applied one step earlier, at the seed rather than at the read.
 *
 * Since 4.0.0 (D-T1) that floor is `params.minConsistencyVariance` on the
 * RESOLVED parameter set, i.e. `minConsistencyVarianceRel * sigma^2` for this
 * call's own realized alliance-score scale. `consistency.ts`'s
 * `SIGMA1_MIN_CONSISTENCY_VARIANCE` is no longer the value applied here — it
 * is only the absolute constant the relative DEFAULT was derived from, at
 * `SIGMA1_REFERENCE_SCORE_VARIANCE`. The floor therefore tracks each season's
 * own scale instead of holding a single points^2 number across five seasons
 * whose variances span 718 to 20,164.
 *
 * With a realistic league prior (hundreds of points^2 under this estimator)
 * the floor never binds; it exists for exactly the early-season and
 * synthetic-fixture cases where the prior is still 0.
 */
function seedConsistencyFor(league: Sigma1League, component: string, params: Sigma1ResolvedParams): number {
  return Math.max(params.minConsistencyVariance, leagueConsistencyFor(league, component, params.coldStartConsistencyVariance));
}

/**
 * A fresh team's belief on every one of this season's components: mean
 * from the live league-average share (falling back to the fixed cold-start
 * constant before any league data exists), variance/consistency from the
 * live league-average consistency (D-11's cold-start baseline). Never an
 * implausibly tiny spread off zero matches — this IS the league prior,
 * which `shrinkConsistency` (`teamMetrics`) will fully weight at
 * `matchCount === 0` regardless.
 */
function coldStartTeamState(
  componentOrder: readonly string[],
  league: Sigma1League,
  params: Sigma1ResolvedParams,
  rpVariableCount: number
): Sigma1TeamState {
  const coldStartMean = componentColdStartTotal(componentOrder.length, params);
  const beliefs: Record<string, TeamComponentBelief> = {};
  const consistency: Record<string, number> = {};
  for (const name of componentOrder) {
    const mean = leagueMeanFor(league, name, coldStartMean);
    // D-Q2: floored — see `seedConsistencyFor`. An unfloored 0 here gives a
    // brand-new team P = R = 0 and therefore a zero Kalman gain on its very
    // first observation.
    const variance = seedConsistencyFor(league, name, params);
    beliefs[name] = { mean, variance };
    consistency[name] = variance;
  }
  return {
    beliefs,
    covariance: emptyCovariance(componentOrder.length),
    consistency,
    matchCount: 0,
    lastEventKey: null,
    // D-05/D-07 (plan 03-04): a brand-new team's adaptation history starts
    // at the cold-start "assume correctly specified" prior — see
    // `emptyInnovationStats`'s own doc comment for why that is 1.0, not 0.
    innovationStats: emptyInnovationStats(),
    // D-09: a brand-new team's RP state starts fully empty (never carries
    // score-side data into it) — `foldRpObservation` (rp/state.ts) cold-starts
    // individual threshold-variable beliefs lazily the first time each is
    // actually folded, mirroring this function's own per-component loop
    // above but on the RP fold's own first touch, not here.
    ...emptyRpTeamState(rpVariableCount, componentOrder.length),
  };
}

function applyTeamProcessNoise(teamState: Sigma1TeamState, eventKey: string, params: Sigma1ResolvedParams): Sigma1TeamState {
  // A team with no prior observation (lastEventKey === null) is treated as
  // "within event" — it was just cold-start-seeded this instant, so there
  // is nothing to have drifted since a nonexistent last observation, and
  // an event-boundary bump would inflate a belief for no reason.
  const q =
    teamState.lastEventKey === null || teamState.lastEventKey === eventKey
      ? params.processNoiseWithinEvent
      : params.processNoiseEventBoundary;
  // D-05 (plan 03-04): BOTH the within-event and event-boundary magnitudes
  // are scaled by this team's own adaptationFactor — a factor that applied
  // to only one of the two would make adaptation's effect depend on the
  // event calendar, not on the team's actual innovation history.
  // `adaptationFactor` returns exactly 1 when adaptation is off
  // (`params.adaptationEnabled === false`), so `scaledQ === q` bitwise on
  // the disabled path — this is what keeps adaptation-off byte-identical
  // to the pre-adaptation module (`params.test.ts`'s identity test proves
  // this end to end, plan 03-04 Task 2).
  const scaledQ = q * adaptationFactor(teamState.innovationStats, params);
  const beliefs: Record<string, TeamComponentBelief> = {};
  for (const [name, belief] of Object.entries(teamState.beliefs)) {
    beliefs[name] = applyProcessNoise(belief, scaledQ);
  }
  return { ...teamState, beliefs };
}

/**
 * Recomputes each teammate's Kalman gain `K_j = P_j / (Sum P_i + R)` — the
 * exact formula `updateAllianceSum` (`kalman.ts`) already applies
 * internally — so this module can attribute a per-team residual from a
 * SHARED alliance-sum observation. `covariance.ts`'s own header names this
 * exact attribution as a stated modeling choice (Pitfall Sigma1-3): there
 * is no way to recover an individual team's residual from a summed
 * observation without assuming something, and reusing the update's own
 * gain is the least-arbitrary available assumption.
 */
function componentGains(teammates: readonly TeamComponentBelief[], measurementNoise: number): number[] {
  const pooled = teammates.reduce((sum, t) => sum + t.variance, 0) + measurementNoise;
  if (pooled === 0) return teammates.map(() => 0);
  return teammates.map((t) => t.variance / pooled);
}

/**
 * Same alliance-level sum `predict()` reports, but as plain
 * `ParsedComponents` numbers.
 *
 * WR-03 (code review, phase 02) correction: this is NOT "this alliance's
 * own predicted component vector" in the sense of matching `predict()`'s
 * own reported score (the prior comment's claim, disproven by CR-01). It
 * is a straight per-team sum across EVERY entry in `componentOrder`,
 * including this alliance's own `FOULS_COMMITTED_COMPONENT` figure — a
 * team with no belief for a component yet (never observed, not even
 * cold-start-seeded) contributes exactly 0, NOT the league/cold-start
 * fallback `coldStartTeamState` would assign it. `predict()`, by contrast,
 * EXCLUDES `FOULS_COMMITTED_COMPONENT` from an alliance's own total and
 * adds the OPPONENT's instead (D-04). A caller that needs `predict()`'s
 * cross-attributed total (the D-05 fallback path below) must apply that
 * adjustment itself; see `fallbackObserved`.
 */
function predictedComponentTotals(
  state: Sigma1State,
  teams: readonly string[],
  componentOrder: readonly string[]
): ParsedComponents {
  const result: ParsedComponents = Object.create(null) as ParsedComponents;
  for (const name of componentOrder) {
    let total = 0;
    for (const team of teams) {
      total += state.teams.get(team)?.beliefs[name]?.mean ?? 0;
    }
    result[name] = total;
  }
  return result;
}

/**
 * CR-01 fix: this alliance's own currently-predicted total for
 * `FOULS_COMMITTED_COMPONENT`, carried forward UNCHANGED as the "observed"
 * value for a D-05 fallback match — never derived from `result.*Score`.
 * Mirrors, per team, exactly the cold-start seed `coldStartTeamState`
 * assigns internally (the live league-average share, or the fixed
 * constant before any league data exists), so that feeding this value
 * back in as the alliance-sum observation gives `updateAllianceSum` an
 * innovation of exactly zero for any team already known to the state: the
 * belief MEAN is left unchanged, and only ordinary process noise (already
 * applied earlier in `applyAllianceUpdate`, D-07) continues to widen its
 * variance over time — a genuine "no observation happened for this
 * component" outcome, not a fabricated match. (Both alliances' fallback
 * observations are computed from the SAME pre-update `state` snapshot,
 * mirroring how `predict()` computes both alliances' scores from one
 * snapshot — for a team appearing in the state for the very first time in
 * this exact match, the innovation can be off by the tiny drift the OTHER
 * alliance's own within-match league-mean fold introduces, an existing
 * property of this function's sequential red-then-blue fold order that
 * applies identically to every component, not something this fix
 * introduces, and never derived from score data either way.)
 *
 * Posterior VARIANCE still shrinks somewhat even at zero innovation
 * (standard Kalman gain behavior, `updateAllianceSum`'s own doc comment) —
 * a documented, bounded approximation rather than a literal freeze of this
 * one component's belief, accepted because `FALLBACK_NOISE_MULTIPLIER`
 * already inflates the measurement noise for every component in a
 * fallback match, this one included.
 *
 * `FOULS_COMMITTED_COMPONENT` itself is genuinely unobservable from a
 * fallback match (D-04: it is derived from the OPPONENT's raw
 * `foulPoints` field, equally absent here) — rather than synthesizing a
 * value from the residual or coercing it to 0 (RESEARCH.md
 * Anti-Patterns), this is the least-arbitrary available substitute.
 */
function foulsCommittedCarryForward(
  state: Sigma1State,
  teams: readonly string[],
  componentOrder: readonly string[],
  params: Sigma1ResolvedParams
): number {
  const coldStartMean = componentColdStartTotal(componentOrder.length, params);
  let total = 0;
  for (const team of teams) {
    const existingMean = state.teams.get(team)?.beliefs[FOULS_COMMITTED_COMPONENT]?.mean;
    total += existingMean ?? leagueMeanFor(state.league, FOULS_COMMITTED_COMPONENT, coldStartMean);
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
 *      component in `componentOrder` EXCEPT `FOULS_COMMITTED_COMPONENT`).
 *   2. The opponent's currently-predicted foul contribution to this
 *      alliance's actual score (`opponentFoulsMean`, D-04) is netted out
 *      before that split, so it is never misattributed into this
 *      alliance's own offensive components.
 */
function fallbackObserved(
  state: Sigma1State,
  teams: readonly string[],
  observedAllianceScore: number,
  opponentFoulsMean: number,
  offensiveComponents: readonly string[],
  componentOrder: readonly string[],
  params: Sigma1ResolvedParams
): ParsedComponents {
  const offensive = distributeResidual(
    observedAllianceScore - opponentFoulsMean,
    predictedComponentTotals(state, teams, componentOrder),
    offensiveComponents
  );
  return {
    ...offensive,
    [FOULS_COMMITTED_COMPONENT]: foulsCommittedCarryForward(state, teams, componentOrder, params),
  };
}

interface AllianceUpdateResult {
  readonly teams: ReadonlyMap<string, Sigma1TeamState>;
  readonly league: Sigma1League;
  /**
   * Plan 03-03: this alliance's per-team, gain-weighted SCORE-component
   * residual vector (length `componentOrder.length`, ordered by
   * `componentOrder`) — `K_j * innovation` per component — threaded into
   * `rp/state.ts`'s `foldRpObservation` for D-11's cross-covariance.
   *
   * D-Q2 (quick task 260901-is2): this is now the ONLY consumer. The score
   * side's own consistency and covariance estimators moved to the
   * innovation-based sample (`varianceSample` in `applyAllianceUpdate`
   * below), and this vector was deliberately left UNCHANGED so the RP
   * subsystem is byte-identical in shape — it is only downstream of a
   * differently-sized R, via the beliefs it reads. Do NOT "unify" the two:
   * the RP cross-covariance wants a per-team SIGNED residual (which is what
   * the gain-weighted share is), while R wants an unbiased variance
   * magnitude (which the gain-weighted share is not).
   */
  readonly residualsByTeam: ReadonlyMap<string, readonly number[]>;
}

/**
 * Applies one alliance's observed component vector to its rating-eligible
 * teammates: D-07 process noise first, then a per-component
 * `updateAllianceSum` Kalman update, then folding the INNOVATION-BASED
 * variance sample (D-Q2) into each team's own consistency (D-09/D-11) and
 * covariance (D-03) estimators and into the league-wide running aggregates
 * (`Sigma1League`). Returns new maps; never mutates its inputs.
 *
 * The gain-weighted residual is still computed, but only for
 * `residualsByTeam` — the RP cross-covariance's input; see that field's own
 * doc comment.
 */
function applyAllianceUpdate(
  teams: ReadonlyMap<string, Sigma1TeamState>,
  league: Sigma1League,
  componentOrder: readonly string[],
  allianceTeams: readonly string[],
  observed: ParsedComponents,
  measurementNoiseMultiplier: number,
  eventKey: string,
  params: Sigma1ResolvedParams,
  rpVariableCount: number,
  varianceGroups: Readonly<Record<string, readonly string[]>>
): AllianceUpdateResult {
  if (allianceTeams.length === 0) {
    // Every team on this alliance was a surrogate — nothing to attribute,
    // a genuine no-op (mirrors opr.ts's/epa.ts's own empty-observation
    // handling, and kalman.ts's updateAllianceSum for an empty teammates
    // array).
    return { teams, league, residualsByTeam: new Map() };
  }

  const workingTeams = new Map<string, Sigma1TeamState>();
  for (const team of allianceTeams) {
    const existing = teams.get(team);
    workingTeams.set(
      team,
      existing
        ? applyTeamProcessNoise(existing, eventKey, params)
        : coldStartTeamState(componentOrder, league, params, rpVariableCount)
    );
  }

  const nextBeliefsByTeam = new Map<string, Record<string, TeamComponentBelief>>();
  const residualsByTeam = new Map<string, number[]>();
  // D-05/D-07 (plan 03-04): one per-component normalized-innovation array
  // per team, folded down to a single RMS-aggregate scalar per team AFTER
  // this alliance-component loop completes (see the `nextTeams` build
  // below) — never a second loop over the alliance, per the plan's own
  // "no second loop" instruction.
  const normalizedInnovationsByTeam = new Map<string, number[]>();
  for (const team of allianceTeams) {
    nextBeliefsByTeam.set(team, { ...workingTeams.get(team)!.beliefs });
    residualsByTeam.set(team, new Array(componentOrder.length).fill(0));
    normalizedInnovationsByTeam.set(team, new Array(componentOrder.length).fill(0));
  }

  let nextComponentMean = { ...league.componentMean };
  let nextComponentConsistency = { ...league.componentConsistency };

  // D-Q2 (quick task 260901-is2): the two ALLIANCE-level, per-component
  // quantities the R estimator produces, collected across the component loop
  // below and assembled into one CxC covariance sample matrix after it.
  // Alliance-level, not per-team: every teammate folds the same sample (see
  // `varianceSample`'s own comment), so the matrix is built ONCE rather than
  // per teammate.
  const varianceSampleByComponent = new Array<number>(componentOrder.length).fill(0);
  const innovationScaledByComponent = new Array<number>(componentOrder.length).fill(0);
  // D-V1 (quick task 260902-varopr): this alliance's RAW per-component
  // innovation, retained by exactly the same one-line pattern
  // `varianceSampleByComponent` above already uses.
  //
  // This array is the DECOMPOSITION'S PER-KEY TARGET — Task 4 folds
  // `innovation_c^2` (and the group/TOTAL sums of `innovation_c`, squared) into
  // the per-event variance accumulator from exactly here. It is deliberately
  // captured ONCE, in this loop, and never re-derived: `varianceSample` above
  // (filter R, the UPDATE path) and the decomposition's target (the DISPLAY
  // path) are two estimators over ONE innovation, and a second derivation is
  // precisely how the two would silently diverge while both looked right.
  //
  // Retained deliberately across the commit that retired the contribution fold
  // it previously served (its only reader), rather than deleted and reinstated
  // one commit later — the value and its capture point are unchanged either
  // way, and reinstating it would invite a second, subtly different expression.
  const innovationByComponent = new Array<number>(componentOrder.length).fill(0);

  componentOrder.forEach((name, componentIndex) => {
    const teammateBeliefs = allianceTeams.map((team) => workingTeams.get(team)!.beliefs[name] ?? { mean: 0, variance: 0 });
    const observedSum = observed[name] ?? 0;
    // R for this alliance-component observation: the SUM of each
    // teammate's own current consistency estimate — variance of a sum of
    // independent quantities is the sum of variances (D-06's
    // independent-teams assumption, applied to measurement noise too) —
    // scaled by FALLBACK_NOISE_MULTIPLIER for a D-05 fallback observation,
    // since an imputed total-only split is proportionally LESS informative
    // than a real per-component observation (breakdown/fallback.ts's own
    // doc comment names this as Sigma1's job to consume).
    const measurementNoise =
      allianceTeams.reduce(
        (sum, team) => sum + (workingTeams.get(team)!.consistency[name] ?? params.coldStartConsistencyVariance),
        0
      ) * measurementNoiseMultiplier;

    const updated = updateAllianceSum(teammateBeliefs, observedSum, measurementNoise);
    const gains = componentGains(teammateBeliefs, measurementNoise);
    const predictedSum = teammateBeliefs.reduce((sum, t) => sum + t.mean, 0);
    const innovation = observedSum - predictedSum;
    const observedShare = observedSum / allianceTeams.length;

    // D-Q2 (quick task 260901-is2): the prior-variance sum for this
    // alliance-component. Computed DIRECTLY from `teammateBeliefs` rather
    // than as `pooledVariance - measurementNoise`, so a reader can see it is
    // the sum of P and not a leftover of some other subtraction.
    const sumP = teammateBeliefs.reduce((sum, t) => sum + t.variance, 0);
    // D-Q2: the innovation-based per-team variance sample, the R estimator
    // both `consistency.ts` and `covariance.ts` now fold. Innovations are
    // observable and `E[innovation^2] = sumP + R_alliance`, so
    // `max(0, innovation^2 - sumP) / n` is an unbiased per-team sample; the
    // floor catches the ordinary case where a single match lands inside the
    // prior's own spread. Every teammate receives the SAME value — one
    // summed observation carries one innovation, the identical limitation
    // `componentGains` and the normalized-innovation block below already
    // document. See `consistency.ts`'s header for what this replaced (an
    // EWMA of squared gain-weighted residuals, biased toward its floor as
    // the gain converged) and the measurements that motivated it.
    const varianceSample = Math.max(0, innovation * innovation - sumP) / allianceTeams.length;
    varianceSampleByComponent[componentIndex] = varianceSample;
    innovationByComponent[componentIndex] = innovation;
    // D-Q2: `d_c = innovation_c / sqrt(n)`, the vector whose outer product
    // supplies the covariance sample's OFF-diagonals. Its own squared
    // diagonal `d_c^2 - sumP_c/n` is algebraically `varianceSample` above
    // (before the floor), which is why the sample matrix built after this
    // loop takes `varianceSample` as the single source of truth for the
    // diagonal rather than recomputing it from `d`.
    innovationScaledByComponent[componentIndex] = innovation / Math.sqrt(allianceTeams.length);

    // D-05/D-07 (plan 03-04, T-03-12): this alliance-component's normalized
    // innovation — `innovation / sqrt(pooledVariance)`, the classical
    // adaptive-Kalman quantity with unit variance under a correctly
    // specified filter. `pooledVariance` here is the exact quantity
    // `updateAllianceSum` (kalman.ts) already computed internally from
    // these same `teammateBeliefs`/`measurementNoise` — an ALLIANCE-level
    // quantity, shared across every teammate on this component, so every
    // teammate is credited the SAME per-component value: there is no way
    // to recover a team-differentiated innovation from a shared
    // alliance-sum observation, the identical limitation
    // `componentGains`/`residualsByTeam` already documents for the
    // score-side residual attribution above. The degenerate
    // `pooledVariance === 0` case (kalman.ts's own zero-gain branch: no
    // uncertainty anywhere for an observation to correct) reports exactly
    // `0` here rather than a `0/0` division — never NaN/Infinity reaching
    // `foldInnovation`, which refuses non-finite input by throwing.
    const pooledVariance = sumP + measurementNoise;
    const normalizedInnovation = pooledVariance > 0 ? innovation / Math.sqrt(pooledVariance) : 0;

    allianceTeams.forEach((team, i) => {
      nextBeliefsByTeam.get(team)![name] = updated[i]!;
      residualsByTeam.get(team)![componentIndex] = gains[i]! * innovation;
      normalizedInnovationsByTeam.get(team)![componentIndex] = normalizedInnovation;
    });

    let meanStats = nextComponentMean[name] ?? emptyExpandingStats();
    for (let i = 0; i < allianceTeams.length; i++) meanStats = foldObservation(meanStats, observedShare);
    nextComponentMean = { ...nextComponentMean, [name]: meanStats };

    // D-Q2 (quick task 260901-is2): the LEAGUE prior folds the SAME
    // innovation-based sample the per-team estimators do. This is
    // `shrinkConsistency`'s target — the quantity a thin-history team is
    // blended toward — so leaving it on squared gain-weighted residuals
    // would blend two incompatible quantities and the estimator fix would
    // silently do nothing for every new team, which is most of them early
    // in a season. One fold per teammate, preserving the previous fold
    // COUNT exactly, so the running mean's weighting is unchanged in shape
    // and only the quantity being averaged is different.
    let consistencyStats = nextComponentConsistency[name] ?? emptyExpandingStats();
    for (let i = 0; i < allianceTeams.length; i++) {
      consistencyStats = foldObservation(consistencyStats, varianceSample);
    }
    nextComponentConsistency = { ...nextComponentConsistency, [name]: consistencyStats };
  });

  // D-Q2 (quick task 260901-is2): the CxC covariance sample matrix, built
  // ONCE for the whole alliance because every one of its inputs is
  // alliance-level. Off-diagonal `d_i * d_j`; diagonal `varianceSample`,
  // which IS `d_c^2 - sumP_c/n` floored at 0 — the same number
  // `consistency.ts` folds for that component. Taking `varianceSample`
  // rather than recomputing the diagonal from `d` is what makes those two
  // views ONE quantity by construction instead of two expressions that have
  // to be kept in agreement (`innovationVariance.test.ts` pins the identity).
  const covarianceSample: number[][] = componentOrder.map((_, i) =>
    componentOrder.map((__, j) =>
      i === j ? varianceSampleByComponent[i]! : innovationScaledByComponent[i]! * innovationScaledByComponent[j]!
    )
  );

  // Resolve each variance group's metric key to `componentOrder` INDICES once
  // for the whole alliance, rather than re-running `indexOf` per team.
  //
  // The `index !== -1` filter is the load-bearing part and it is why this
  // machinery survived the retirement of the contribution fold it was written
  // for (quick task 260902-varopr Task 2): it is the SAME skip `teamMetrics`
  // applies to its own group walk, so the folded key set and the published key
  // set agree BY CONSTRUCTION rather than by two lists being kept in step. A
  // group whose components are all absent from this season's resolved
  // `componentOrder` resolves to an EMPTY index list, and a fold against an
  // empty list must contribute nothing — never a manufactured 0, which would
  // publish a spread for a group that was never observed.
  const varianceGroupIndices: [string, number[]][] = Object.entries(varianceGroups).map(([metricKey, names]) => [
    metricKey,
    names.map((name) => componentOrder.indexOf(name)).filter((index) => index !== -1),
  ]);
  // Task 4 (quick task 260902-varopr) folds the decomposition's per-key targets
  // against `varianceGroupIndices`. In THIS commit it is resolved and not yet
  // read — recorded rather than left ambiguous, per the plan's own instruction.
  void varianceGroupIndices;

  const nextTeams = new Map(teams);
  for (const team of allianceTeams) {
    const working = workingTeams.get(team)!;
    const nextConsistency: Record<string, number> = { ...working.consistency };
    componentOrder.forEach((name, i) => {
      nextConsistency[name] = foldConsistencyVariance(
        nextConsistency[name] ?? params.coldStartConsistencyVariance,
        varianceSampleByComponent[i]!,
        params.consistencyEwmaAlpha
      );
    });
    // D-05/D-07 (plan 03-04): this match's AGGREGATE normalized innovation
    // for this team — the root-mean-square of its per-component normalized
    // innovations, iterating `state.componentOrder` (the fixed array
    // parameter to this function, never a freshly enumerated key list) —
    // folded once into `innovationStats` (D-07's "one scalar per team"
    // granularity, never per-component).
    const normalizedInnovationVector = normalizedInnovationsByTeam.get(team)!;
    const meanSquaredNormalizedInnovation =
      normalizedInnovationVector.length > 0
        ? normalizedInnovationVector.reduce((sum, v) => sum + v * v, 0) / normalizedInnovationVector.length
        : 0;
    const aggregateNormalizedInnovation = Math.sqrt(meanSquaredNormalizedInnovation);

    nextTeams.set(team, {
      // `...working` first so this alliance-update pass never touches RP
      // fields (`rpBeliefs`/`rpCovariance`/`rpCrossCovariance`, D-09) —
      // those are threaded through unchanged here and updated separately by
      // `update()`'s own `foldRpObservation` call.
      ...working,
      beliefs: nextBeliefsByTeam.get(team)!,
      covariance: ewmaCovarianceSample(working.covariance, covarianceSample, params.covEwmaAlpha, params.covShrinkage),
      consistency: nextConsistency,
      matchCount: working.matchCount + 1,
      lastEventKey: eventKey,
      innovationStats: foldInnovation(working.innovationStats, aggregateNormalizedInnovation, params.adaptationEwmaAlpha),
    });
  }

  return {
    teams: nextTeams,
    // `...league` first so `rpVariableMean` (D-09's third `Sigma1League`
    // record) passes through unchanged — this function has no opinion on
    // RP data.
    league: { ...league, componentMean: nextComponentMean, componentConsistency: nextComponentConsistency },
    residualsByTeam,
  };
}

function allianceComponentPredictions(state: Sigma1State, teams: readonly string[]): Record<string, ComponentPrediction> {
  const result: Record<string, ComponentPrediction> = {};
  for (const name of state.componentOrder) {
    let mean = 0;
    let variance = 0;
    for (const team of teams) {
      const belief = state.teams.get(team)?.beliefs[name];
      if (belief) {
        mean += belief.mean;
        variance += belief.variance;
      }
    }
    result[name] = { mean, variance };
  }
  return result;
}

function allianceOffensiveTotal(components: Record<string, ComponentPrediction>): number {
  let total = 0;
  for (const [name, prediction] of Object.entries(components)) {
    if (name === FOULS_COMMITTED_COMPONENT) continue;
    total += prediction.mean;
  }
  return total;
}

/**
 * One team's own posterior (P) sum: `belief.variance` totalled over every
 * component this team has a belief for, starting from `seed` (default 0).
 * The per-team half of `allianceComponentVarianceSum` below (which resolves
 * each team's state and delegates here, THREADING its own running total
 * through as `seed` rather than summing each team's subtotal in isolation
 * and adding that) — after plan 07-06 (D-01), `teamMetrics` calls this SAME
 * function (at the default `seed = 0`) to build the posterior term of its
 * own published `spread`, so there is exactly one place in this file that
 * knows how a team's P is summed, and both the match path (`predict`) and
 * the publish path (`teamMetrics`) read it. That single construction is
 * what makes the alliance-additivity identity (`sigma1.test.ts`'s Test 1)
 * hold BY CONSTRUCTION rather than by two implementations agreeing by luck.
 *
 * The `seed` parameter exists ONLY to keep `allianceComponentVarianceSum`'s
 * floating-point addition order byte-for-byte IDENTICAL to its pre-07-06
 * form: IEEE-754 addition is not associative, so a naive "sum each team's
 * subtotal independently, then add the subtotals together" refactor
 * silently re-associates that sum and changes its last bit(s) — exactly the
 * kind of change `digest.test.ts` (D-15/SC-5, this plan's T-07-06-03) exists
 * to catch, and it did: that refactor shape was tried first, found to flip
 * both committed `sigma1@2.0.0` digests [pre-rename], and reverted in favor of this
 * threaded-accumulator shape, which reduces to the exact same left-to-right
 * chain of additions the original single flat loop performed. `predict()`
 * is bit-for-bit unaffected by this task; only `teamMetrics`'s NEW,
 * seed-less call site changes what gets published.
 */
function teamOwnComponentVarianceSum(teamState: Sigma1TeamState, seed = 0): number {
  let total = seed;
  for (const belief of Object.values(teamState.beliefs)) total += belief.variance;
  return total;
}

function allianceComponentVarianceSum(state: Sigma1State, teams: readonly string[]): number {
  let total = 0;
  for (const team of teams) {
    const teamState = state.teams.get(team);
    if (!teamState) continue;
    total = teamOwnComponentVarianceSum(teamState, total);
  }
  return total;
}

function allianceCovariances(state: Sigma1State, teams: readonly string[]): number[][][] {
  return teams.map((team) => state.teams.get(team)?.covariance ?? []);
}

function predict(state: Sigma1State, match: UpcomingMatch, linkMode: WinProbMode, params: Sigma1Params): Prediction {
  // D-T1: ONE resolve, at the top of the entry point, from `state`'s own
  // expanding statistic (Pitfall EPA-1: it reflects only matches already
  // replayed). `resolved.scoreSd` below is the SAME sigma the scaled
  // parameters were resolved at — one definition of sigma in this function,
  // never two.
  const resolved = resolveSigma1Params(params, state.allianceScoreStats);
  const redTeams = ratingEligibleTeams(match.redTeams, match.redSurrogates);
  const blueTeams = ratingEligibleTeams(match.blueTeams, match.blueSurrogates);

  const redComponents = allianceComponentPredictions(state, redTeams);
  const blueComponents = allianceComponentPredictions(state, blueTeams);

  // D-04: a predicted alliance score must include the OPPOSING alliance's
  // expected foulsCommitted contribution. Each side's OWN foulsCommitted
  // entry represents points ITS fouls would cost the OPPONENT (mirrors
  // breakdown/2024.ts's parse()-time derivation, which reads this same
  // component from the OPPOSING side's raw foulPoints field) — so it is
  // excluded from that side's own offensive total and added to the
  // opponent's predicted score instead.
  const redScore = allianceOffensiveTotal(redComponents) + (blueComponents[FOULS_COMMITTED_COMPONENT]?.mean ?? 0);
  const blueScore = allianceOffensiveTotal(blueComponents) + (redComponents[FOULS_COMMITTED_COMPONENT]?.mean ?? 0);

  // D-10: full predictive variance = P + Q + R, combined per D-03 across
  // the alliance. The posterior sums below are P+Q (every teammate's
  // current belief.variance already carries every process-noise injection
  // folded in by update(), summed simply per component since kalman.ts
  // tracks no cross-component posterior covariance); the covariance totals
  // are R (covariance.ts's own cross-component-aware residual-history
  // estimate, D-03/Pitfall Sigma1-3's full quadratic form).
  const redPosteriorSum = allianceComponentVarianceSum(state, redTeams);
  const bluePosteriorSum = allianceComponentVarianceSum(state, blueTeams);
  const redCovarianceTotal = allianceTotalPredictiveVariance(allianceCovariances(state, redTeams));
  const blueCovarianceTotal = allianceTotalPredictiveVariance(allianceCovariances(state, blueTeams));
  const variance = redPosteriorSum + bluePosteriorSum + redCovarianceTotal + blueCovarianceTotal;

  const margin = redScore - blueScore;
  const pRedWin = winProbability(linkMode, margin, resolved.scoreSd, variance, resolved.linkC);
  // 01-REVIEW WR-05 / D-05: validated at emission, before this Prediction
  // is returned — see predictionValidity.ts's doc comment for why this
  // check lives here rather than at scoreSet/calibrationBins entry. One
  // module builds three link-mode variants (D-12), so `linkMode` stands in
  // for the algorithm identifier alongside the match key.
  assertValidPRedWin(pRedWin, `sigma1:${linkMode} predict (${match.matchKey})`);

  // Plan 03-03 (D-09/D-10/D-11): the RP pmf is computed from values ALREADY
  // produced above (redScore/blueScore, and each alliance's OWN posterior +
  // covariance sum — never the combined `variance` above, which sums BOTH
  // alliances together for the win-probability denominator) — nothing in
  // the score/variance/win-probability computation above may change or be
  // recomputed here, and nothing below can retroactively change it either.
  // That independence is asserted by `params.test.ts`'s/`distribution.
  // test.ts`'s dedicated "0 draws === 2000 draws" equality test, not just
  // claimed.
  const season = state.season ?? deriveSeasonFromEventKey(match.eventKey);
  const ruleModule = rpRuleModuleForSeason(season);
  const redScoreVarianceOwn = redPosteriorSum + redCovarianceTotal;
  const blueScoreVarianceOwn = bluePosteriorSum + blueCovarianceTotal;
  const redRpMoments = predictAllianceRpMoments(state.teams, redTeams, ruleModule, redScore, redScoreVarianceOwn);
  const blueRpMoments = predictAllianceRpMoments(state.teams, blueTeams, ruleModule, blueScore, blueScoreVarianceOwn);
  // CR-01 (03-REVIEW.md): `rpPmfForMatch` calls `ruleModule.predictThresholds`,
  // which calls `eventTierFor(eventType)` as its first statement and throws
  // by design for an unmapped `eventType` (offseason `99` etc.) — guarded
  // by the SAME `isRpEligibleEventType` predicate `update()`'s RP fold uses
  // above, so the two can never disagree about which matches get an RP
  // prediction. `redRpMoments`/`blueRpMoments` above are untouched:
  // `predictAllianceRpMoments` takes no `eventType` and cannot throw.
  //
  // `{ redPmf: [], bluePmf: [] }` rather than `degenerateZeroPmf()`: the
  // empty arrays make the `...(rpResult.redPmf.length > 0 ? ... : {})`
  // spread below omit `redRpPmf`/`blueRpPmf` from the `Prediction` entirely
  // — `types.ts`'s documented "omitted entirely, never an empty array"
  // convention, already how the zero-draws fast path behaves. A degenerate
  // `P(RP=0)=1` would be a POSITIVE claim that the alliance certainly earns
  // no ranking points — false for an offseason qualification match, which
  // does award RP under whatever rules that event ran. Absence of a
  // prediction is the honest representation of "this subsystem has no
  // rules for this event tier"; certainty of zero is not.
  const rpResult = isRpEligibleEventType(match.eventType)
    ? rpPmfForMatch({
        red: redRpMoments,
        blue: blueRpMoments,
        ruleModule,
        eventType: match.eventType,
        matchKey: match.matchKey,
        compLevel: match.compLevel,
        params: resolved,
      })
    : { redPmf: [], bluePmf: [] };
  // Plan 06.1-02 (F-06-1): the RP-ineligible fallback above carries no
  // bonus arrays either -- `rpResult.redBonusProbabilities` stays
  // `undefined`, so the conditional spreads below omit `redBonusRp`/
  // `blueBonusRp` from the returned Prediction exactly as they omit
  // `redRpPmf`/`blueRpPmf`.

  return {
    // margin === 0 gives pRedWin exactly 0.5 through every link mode's own
    // documented boundary handling (linkFunctions.ts), and ">= 0.5"
    // resolves to "red" — matching opr.ts's/epa.ts's tie convention.
    winner: pRedWin >= 0.5 ? "red" : "blue",
    pRedWin,
    redScore,
    blueScore,
    variance,
    // D-01 (Phase 6): each alliance's OWN predicted-score variance, already
    // computed above (as `redScoreVarianceOwn`/`blueScoreVarianceOwn`) to
    // build the RP pmf below — never recomputed here, just attached to the
    // returned Prediction so the published artifact can carry it (see
    // `types.ts`'s `Prediction.redScoreVarianceOwn` doc comment for why this
    // is a different quantity from `variance` above).
    redScoreVarianceOwn,
    blueScoreVarianceOwn,
    redComponents,
    blueComponents,
    // D-10: omitted entirely (never an empty array) when
    // `rpPmfForMatch` returns `[]` — `params.rpMonteCarloDraws === 0`
    // (plan 03-05's search fast path) — matching `types.ts`'s documented
    // "omitted entirely, never an empty array" optional-field convention.
    ...(rpResult.redPmf.length > 0 ? { redRpPmf: rpResult.redPmf } : {}),
    ...(rpResult.bluePmf.length > 0 ? { blueRpPmf: rpResult.bluePmf } : {}),
    // Plan 06.1-02 (F-06-1): reuses the same presence test the pmf spreads
    // above already use (defined and non-empty) rather than inventing a
    // second convention -- `redBonusProbabilities` is `undefined` on both
    // `rpPmfForMatch` short-circuit branches (Task 1) and on the
    // RP-ineligible fallback object above.
    ...(rpResult.redBonusProbabilities && rpResult.redBonusProbabilities.length > 0
      ? { redBonusRp: rpResult.redBonusProbabilities }
      : {}),
    ...(rpResult.blueBonusProbabilities && rpResult.blueBonusProbabilities.length > 0
      ? { blueBonusRp: rpResult.blueBonusProbabilities }
      : {}),
  };
}

function update(state: Sigma1State, result: MatchResult, params: Sigma1Params): Sigma1State {
  // Case 1 (`demoTeams.ts`): a fully-demo alliance is a non-contest (a
  // forfeit/no-show playoff bucket or an offseason bracket bye) — the WHOLE
  // MATCH is skipped, both alliances, never just the demo side's own share.
  // Checked against the RAW (pre-remap) team lists. Sigma1 folds every comp
  // level, so this is load-bearing here, not a defensive no-op.
  if (isFullyDemoAlliance(result.redTeams) || isFullyDemoAlliance(result.blueTeams)) return state;

  // D-T1, and THE line that makes this leak-free: resolve from
  // `state.allianceScoreStats` — the PRE-fold statistic, reflecting only
  // matches already replayed — NOT from the post-fold `allianceScoreStats`
  // local computed near the end of this function. Resolving after the fold
  // would let this match's own two alliance scores set the scale its own
  // update is performed at, which is Pitfall EPA-1 exactly. That placement is
  // the entire guarantee; nothing else enforces it.
  const resolved = resolveSigma1Params(params, state.allianceScoreStats);

  const season = state.season ?? deriveSeasonFromEventKey(result.eventKey);
  const seasonMap = componentMapForSeason(season);
  const componentOrder = state.componentOrder.length > 0 ? state.componentOrder : seasonMap.components;

  const redTeams = ratingEligibleTeams(result.redTeams, result.redSurrogates);
  const blueTeams = ratingEligibleTeams(result.blueTeams, result.blueSurrogates);

  // `.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`: an
  // alliance whose every rating-eligible team is disqualified AND whose RAW
  // recorded score is exactly 0 gets NO update at all this match — fed `[]`
  // to `applyAllianceUpdate`/`foldRpObservation` below, the same no-op input
  // both functions already handle for an all-surrogate alliance. Checked
  // per-alliance, NOT per-match like `isFullyDemoAlliance` above: the
  // opposing alliance's own score (and RP threshold variables) is still a
  // genuine observation of real robots and proceeds unaffected. `redTeams`/
  // `blueTeams` themselves stay UNCHANGED below — `predictedComponentTotals`/
  // `fallbackObserved` read the OPPONENT's already-existing belief state,
  // which this override has no bearing on.
  const redIsDqZero = isFullyDqZeroScoreAlliance(redTeams, result.redDqs, result.redScore);
  const blueIsDqZero = isFullyDqZeroScoreAlliance(blueTeams, result.blueDqs, result.blueScore);
  const redUpdateTeams = redIsDqZero ? [] : redTeams;
  const blueUpdateTeams = blueIsDqZero ? [] : blueTeams;

  const breakdownOutcome = tryParseBreakdownPair(season, result.scoreBreakdownRaw);
  const redParsed = breakdownOutcome.kind === "parsed" ? breakdownOutcome.red : null;
  const blueParsed = breakdownOutcome.kind === "parsed" ? breakdownOutcome.blue : null;
  // D-05: a match with no score_breakdown ("absent") OR a score_breakdown
  // that IS present but fails its season Zod schema ("malformed" — T-03-18b,
  // self-reported offseason data; `tryParseBreakdownPair`,
  // `breakdown/index.ts`) still updates state via a proportional-residual
  // fallback, with the resulting observation's measurement noise inflated by
  // FALLBACK_NOISE_MULTIPLIER inside applyAllianceUpdate — never a silent
  // drop, never a coerced zero (RESEARCH.md Anti-Patterns). D-Q2: a
  // "malformed" outcome deliberately increments BOTH
  // `breakdownParseFailureCount` below (the CAUSE — this match's raw
  // breakdown failed its schema) and `rpSkippedMatchCount` further down (the
  // EFFECT — the RP threshold-variable fold has no raw fields to parse
  // either); see `BreakdownParseTelemetry`'s doc comment (`types.ts`) for why
  // these are two separate, deliberately overlapping counters rather than
  // one merged field.
  const usedFallback = breakdownOutcome.kind !== "parsed";
  const measurementNoiseMultiplier = usedFallback ? FALLBACK_NOISE_MULTIPLIER : 1;
  const breakdownParseFailureCount = state.breakdownParseFailureCount + (breakdownOutcome.kind === "malformed" ? 1 : 0);

  // CR-01 fix: the residual is distributed across this alliance's own
  // OFFENSIVE components only (never FOULS_COMMITTED_COMPONENT — see
  // fallbackObserved), against the alliance's own actual score net of the
  // OPPONENT's currently-predicted foul contribution — mirroring
  // predict()'s own cross-alliance attribution, rather than the flat,
  // uncorrected sum this fallback used to feed distributeResidual pre-fix.
  const nonFoulsComponents = componentOrder.filter((name) => name !== FOULS_COMMITTED_COMPONENT);
  const blueFoulsMean = predictedComponentTotals(state, blueTeams, componentOrder)[FOULS_COMMITTED_COMPONENT] ?? 0;
  const redFoulsMean = predictedComponentTotals(state, redTeams, componentOrder)[FOULS_COMMITTED_COMPONENT] ?? 0;

  const redObserved =
    redParsed ??
    fallbackObserved(state, redTeams, result.redScore, blueFoulsMean, nonFoulsComponents, componentOrder, resolved);
  const blueObserved =
    blueParsed ??
    fallbackObserved(state, blueTeams, result.blueScore, redFoulsMean, nonFoulsComponents, componentOrder, resolved);

  // T-02-01 (threat register, second gate): the per-season Zod parse
  // boundary (breakdown/*.ts) is the FIRST finite-value gate, but a value
  // that survives parsing can still be produced by distributeResidual's
  // degenerate branch (e.g. a non-finite result.redScore/blueScore from an
  // upstream corpus anomaly) and bypass it entirely. Assert finiteness
  // here, the last point before a value reaches updateAllianceSum and
  // propagates through every subsequent update for every teammate — throw
  // loudly rather than silently folding NaN/Infinity into Kalman state.
  assertFiniteComponents(redObserved, `red observation, match ${result.matchKey}`);
  assertFiniteComponents(blueObserved, `blue observation, match ${result.matchKey}`);

  // Plan 03-03: this season's RP rule module + threshold-variable count,
  // resolved once and threaded to both alliances' score-side fold (for
  // cold-starting a brand-new team's RP state at the right size) and to the
  // RP fold itself below.
  const ruleModule = rpRuleModuleForSeason(season);
  const rpVariableCount = ruleModule.thresholdVariables.length;

  // D-V1 (quick task 260902-varopr): the metric-key -> component-name map every
  // AGGREGATE-LEVEL variance target is folded against, assembled ONCE per
  // `update()` call rather than per alliance. Its keys are exactly the keys
  // `teamMetrics` publishes at the aggregate levels: `TOTAL_METRIC_KEY` over
  // every name in `componentOrder`, plus each phase group this season
  // registers. Group names are filtered by the SAME `indexOf(name) === -1` skip
  // `teamMetrics` applies to its own group walk, so the folded key set and the
  // published key set agree by construction rather than by two lists being kept
  // in step. When `componentGroupsForSeason` yields nothing for the season, the
  // map carries `TOTAL_METRIC_KEY` alone.
  //
  // Written for quick task 260902-disp's contribution fold and CONSUMED rather
  // than deleted when that fold was retired (260902-varopr Task 2): the
  // decomposition needs exactly this map, and reinventing it three tasks later
  // would only reinvent it worse.
  const varianceGroups: Record<string, readonly string[]> = { [TOTAL_METRIC_KEY]: componentOrder };
  const seasonGroups = componentGroupsForSeason(season);
  if (seasonGroups !== undefined) {
    for (const groupId of COMPONENT_GROUP_IDS) {
      varianceGroups[COMPONENT_GROUP_METRIC_KEYS[groupId]] = seasonGroups[groupId].filter(
        (name) => componentOrder.indexOf(name) !== -1
      );
    }
  }

  const afterRed = applyAllianceUpdate(
    state.teams,
    state.league,
    componentOrder,
    redUpdateTeams,
    redObserved,
    measurementNoiseMultiplier,
    result.eventKey,
    resolved,
    rpVariableCount,
    varianceGroups
  );
  const afterBlue = applyAllianceUpdate(
    afterRed.teams,
    afterRed.league,
    componentOrder,
    blueUpdateTeams,
    blueObserved,
    measurementNoiseMultiplier,
    result.eventKey,
    resolved,
    rpVariableCount,
    varianceGroups
  );

  // Pitfall EPA-1's fix, reused here: fold each alliance's observed total
  // into the expanding-window SD — the score itself is always known, even
  // when its breakdown is not — EXCEPT a whole-alliance-DQ zero, which is a
  // ruling, not an observed score, and would otherwise pull this season SD
  // toward zero for no real reason.
  let allianceScoreStats = state.allianceScoreStats;
  if (!redIsDqZero) allianceScoreStats = foldObservation(allianceScoreStats, result.redScore);
  if (!blueIsDqZero) allianceScoreStats = foldObservation(allianceScoreStats, result.blueScore);

  // D-09: the RP threshold-variable fold, kept SEPARATE from the score-side
  // fold above — never touches `afterBlue.teams`' score fields, never
  // recomputes anything the score side already produced. Skipped entirely
  // (never a coerced zero) for the same `usedFallback` population the
  // score side already imputes via `fallbackObserved` (RESEARCH.md Pitfall
  // 4) — a match with no `score_breakdown` has no raw RP fields to parse
  // either.
  //
  // CR-01 (03-REVIEW.md): ALSO skipped for a match whose `eventType` is not
  // `EVENT_TYPE_TIERS`-mapped (offseason `99`, or any future unmapped TBA
  // value) — `ruleModule.parse()` below calls `eventTierFor(eventType)` as
  // its first statement and throws by design for exactly this input
  // (`rp/constants.ts`). `rpSkippedMatchCount` DOES increment for this
  // reason too, sharing the counter with the no-score-breakdown case above:
  // the field's meaning is "matches whose RP fold was skipped, for any
  // reason", not "matches missing a breakdown" — both skip reasons produce
  // exactly the same diagnosable condition (a silently-empty RP state for
  // this match), the counter exists so that condition is diagnosable
  // (`carrySeason`, its only reader), and splitting it into two counters
  // would be a versioned-shape change for a distinction nothing currently
  // consumes. CONSISTENCY with `predict()`: `predict()` is pure and carries
  // no counter, so consistency here means the PREDICATE is shared, not the
  // bookkeeping — the same `isRpEligibleEventType(eventType)` decides both,
  // so any match whose fold `update()` skips is exactly a match whose
  // `predict()` emits no pmf. Do not add a second, drifting eligibility
  // rule on either side.
  let rpTeamUpdates: ReadonlyMap<string, RpTeamState> = new Map();
  let rpLeague: RpLeague = state.league;
  let rpSkippedMatchCount = state.rpSkippedMatchCount;

  if (usedFallback || !isRpEligibleEventType(result.eventType)) {
    rpSkippedMatchCount += 1;
  } else {
    const rawJson: unknown = JSON.parse(result.scoreBreakdownRaw!);
    const redRpParsed: RpParsedResult = ruleModule.parse(rawJson, "red", result.eventType);
    const blueRpParsed: RpParsedResult = ruleModule.parse(rawJson, "blue", result.eventType);

    const redRpFold = foldRpObservation({
      // `state.teams` (PRE-this-match) — the same snapshot the score side's
      // OWN `applyTeamProcessNoise`/`coldStartTeamState` read `lastEventKey`
      // from, before either alliance's score fold updates it to this
      // match's `eventKey`.
      teams: state.teams,
      league: rpLeague,
      ruleModule,
      allianceTeams: redUpdateTeams,
      observedThresholdVariables: redRpParsed.thresholdVariables,
      scoreResidualsByTeam: afterRed.residualsByTeam,
      componentCount: componentOrder.length,
      eventKey: result.eventKey,
      params: resolved,
    });
    const blueRpFold = foldRpObservation({
      teams: state.teams,
      league: redRpFold.league,
      ruleModule,
      allianceTeams: blueUpdateTeams,
      observedThresholdVariables: blueRpParsed.thresholdVariables,
      scoreResidualsByTeam: afterBlue.residualsByTeam,
      componentCount: componentOrder.length,
      eventKey: result.eventKey,
      params: resolved,
    });

    const merged = new Map(redRpFold.teams);
    for (const [team, rpState] of blueRpFold.teams) merged.set(team, rpState);
    rpTeamUpdates = merged;
    rpLeague = blueRpFold.league;
  }

  const finalTeams = new Map(afterBlue.teams);
  for (const [team, rpState] of rpTeamUpdates) {
    const existing = finalTeams.get(team);
    if (existing) finalTeams.set(team, { ...existing, ...rpState });
  }

  return {
    season,
    componentOrder,
    teams: finalTeams,
    // `...afterBlue.league` carries componentMean/componentConsistency;
    // `rpVariableMean` comes from the RP fold above (or, when skipped,
    // stays whatever `state.league.rpVariableMean` already was, since
    // `rpLeague` was initialized from `state.league` and never reassigned
    // in that branch).
    league: { ...afterBlue.league, rpVariableMean: rpLeague.rpVariableMean },
    allianceScoreStats,
    priorSeasonRatings: state.priorSeasonRatings,
    rpSkippedMatchCount,
    breakdownParseFailureCount,
  };
}

/**
 * D-27/D-01/D-02 (plan 07-06): per team, one `TeamMetric` per learned
 * component, plus `TOTAL_METRIC_KEY`, plus each of `phaseAuto`/
 * `phaseTeleop`/`phaseEndgame` this season registers a grouping for. Every
 * key's `spread` is the SAME two-term construction, at whatever aggregation
 * level the key names: that team's own posterior variance (P,
 * `teamOwnComponentVarianceSum`/`belief.variance`, the filter's uncertainty
 * about the mean) PLUS that team's own consistency term (R, D-09's
 * match-to-match performance variance, D-11-shrunk) over the SAME component
 * set — one standard deviation of the full predictive variance for that
 * team, at that aggregation level. A group's version restricts both terms
 * to the group's own component indices (PD-07); TOTAL's version is exactly
 * this team's own contribution to `predict()`'s `redScoreVarianceOwn`/
 * `blueScoreVarianceOwn` — three teammates' TOTAL spreads sum in quadrature
 * to the alliance variance `predict` reports, pinned by
 * `sigma1.test.ts`'s Test 1 (the additivity identity) against `predict()`'s
 * own output. `value` is unchanged at every level — expectation is linear
 * however the components covary, and D-01 changes only the uncertainty,
 * never the estimate. A group's spread has to be computed HERE, not
 * reconstructed from published per-component spreads on a client: it needs
 * the off-diagonal `Cov(auto_i, auto_j)` terms, which are never published.
 * A team with no history gets the shrinkage blend's league-prior-dominated
 * R term (P instead starts at the cold-start belief variance), visible as
 * such via a `matchCount` of 0 rather than hidden behind a plausible-
 * looking number.
 *
 * D-Q2 (quick task 260901-is2), what the R term IS. Both R sources this
 * function reads — `teamState.consistency[name]` per component, and
 * `teamTotalVariance`/`subsetVariance` over `teamState.covariance` for the
 * TOTAL and phase-group keys — are now estimated from INNOVATIONS:
 * `max(0, innovation^2 - sum P) / n` per alliance-component, folded by
 * `applyAllianceUpdate`. Until 3.0.0 they were EWMAs of the squared
 * gain-weighted residual `(K_j * innovation)^2`, which decayed toward its
 * floor as the Kalman gain converged and therefore published how much the
 * filter was still ADJUSTING rather than how much the team actually varied
 * — understating every spread on the site by roughly 5x (synthetic recovery
 * 2.29 against a true 12; real-corpus z-SD 1.62-4.99 rather than the ~1.0
 * an honest filter gives). `consistency.ts`'s header carries the full
 * derivation and the measured before/after. Nothing about the P/R
 * COMPOSITION below changed: the additivity identity (`sigma1.test.ts`'s
 * Test 1) holds exactly as it did, over differently-sized numbers.
 *
 * D-05 (plan 03-04) REVERSED by D-01 (plan 07-06): this comment used to
 * assert that adaptation does NOT touch this function's output, and that
 * the published `±` "must stay a direct empirical estimate of that team's
 * own residual spread, not partly a function of a tuning parameter." Both
 * claims stop being true the moment P is published. `index.ts`'s
 * `scaledQ = q * adaptationFactor(...)` (see `applyTeamProcessNoise`) scales
 * the process noise that inflates `belief.variance` — and `belief.variance`
 * IS P, now summed into every spread this function returns. D-01 is a
 * locked, one-way user decision that supersedes the earlier constraint
 * outright (plan 07-06, T-07-06-02 in the threat register): the published
 * `±` now includes the filter's own uncertainty about the mean, and that
 * term IS moved by the adaptation knob through the scaled process noise.
 * Consequence: an adaptation on/off comparison can no longer attribute the
 * published `±` independently of the tuning parameter — a REAL, accepted
 * cost of D-01, not a bug to fix here.
 */
function teamMetrics(state: Sigma1State, teams: readonly string[] | undefined, params: Sigma1Params): TeamMetrics {
  // D-T1: one resolve, at the top, from the same expanding statistic the
  // match path reads — so a published spread and the match-path variance floor
  // that produced it are on the identical scale by construction.
  const resolved = resolveSigma1Params(params, state.allianceScoreStats);
  const requestedTeams = teams ?? [...state.teams.keys()];
  const result: TeamMetrics = {};
  for (const team of requestedTeams) {
    const teamState = state.teams.get(team);
    if (!teamState) continue;

    const perTeam: Record<string, TeamMetric> = {};
    let total = 0;
    for (const name of state.componentOrder) {
      const belief = teamState.beliefs[name];
      const value = belief?.mean ?? 0;
      total += value;

      const observedConsistency = teamState.consistency[name] ?? resolved.coldStartConsistencyVariance;
      const leagueConsistency = leagueConsistencyFor(state.league, name, resolved.coldStartConsistencyVariance);
      const shrunkVariance = shrinkConsistency(
        observedConsistency,
        teamState.matchCount,
        leagueConsistency,
        resolved.shrinkagePriorMatches,
        resolved.minConsistencyVariance
      );
      // D-01/D-02 (plan 07-06): this component's posterior term
      // (`belief?.variance ?? 0`, PD-06 — matching what the match path
      // already does for a component a team has no belief for) summed with
      // `shrunkVariance` (R, unchanged above) inside the root.
      perTeam[name] = { value, spread: Math.sqrt((belief?.variance ?? 0) + shrunkVariance) };
    }

    const totalVariance = Math.max(resolved.minConsistencyVariance, teamTotalVariance(teamState.covariance));
    // D-01/D-02 (plan 07-06): published spread is now √(P + R) — this
    // team's own posterior sum (`teamOwnComponentVarianceSum`, the exact
    // per-team P `predict()`'s own `redScoreVarianceOwn`/
    // `blueScoreVarianceOwn` sums across an alliance) plus `totalVariance`
    // (R, unchanged above, including its `minConsistencyVariance` floor —
    // D-03/PD-04). `value: total` is unchanged — expectation is linear and
    // this plan changes only the uncertainty, never the estimate.
    perTeam[TOTAL_METRIC_KEY] = { value: total, spread: Math.sqrt(teamOwnComponentVarianceSum(teamState) + totalVariance) };

    // Phase groups (Auto/Teleop/Endgame) published as first-class metrics.
    //
    // The VALUE is a plain sum of component means — exact, since expectation
    // is linear however the components covary. The SPREAD is the quadratic
    // form of this team's own component covariance restricted to the group's
    // indices, which is why it has to be computed HERE: it needs the
    // off-diagonal Cov(auto_i, auto_j) terms, and those are never published,
    // so no client could reconstruct this number from per-component spreads.
    // `teamTotalVariance` above is the same computation over every index.
    const groups = state.season === undefined || state.season === null ? undefined : componentGroupsForSeason(state.season);
    if (groups !== undefined) {
      for (const groupId of COMPONENT_GROUP_IDS) {
        const indices: number[] = [];
        let groupValue = 0;
        // D-01/D-02 (plan 07-06, PD-07): this group's posterior (P) sum,
        // accumulated in the SAME loop iteration — after the same
        // `index === -1` guard — that builds `indices` and `groupValue`, so
        // a component this season's grouping names but `componentOrder`
        // does not carry is skipped from BOTH the posterior sum and the
        // covariance subset, never just one. Passing a name list to a
        // shared helper instead would not guarantee this, since a helper
        // cannot see `componentOrder`.
        let groupPosterior = 0;
        let present = false;
        for (const name of groups[groupId]) {
          const index = state.componentOrder.indexOf(name);
          if (index === -1) continue;
          indices.push(index);
          groupValue += teamState.beliefs[name]?.mean ?? 0;
          groupPosterior += teamState.beliefs[name]?.variance ?? 0;
          present = true;
        }
        // A group whose components are all absent from this season's resolved
        // component order publishes nothing, rather than a spurious 0 ± floor.
        if (!present) continue;
        const groupVariance = Math.max(resolved.minConsistencyVariance, subsetVariance(teamState.covariance, indices));
        perTeam[COMPONENT_GROUP_METRIC_KEYS[groupId]] = { value: groupValue, spread: Math.sqrt(groupPosterior + groupVariance) };
      }
    }

    result[team] = perTeam;
  }
  return result;
}

/**
 * D-16/D-17/D-19/D-04: carries every team's rating across a season boundary
 * via `sigma1/carryover.ts`'s `sigma1Carryover` — Sigma1's OWN tunable copy
 * of the same reference shape EPA's `carrySeason` builds on (`epaCarryover`,
 * frozen), so tuning `params.carryMeanReversion`/`params.carryPriorYearShare`
 * moves Sigma1's carried ratings without moving EPA's (D-04). Since 4.0.0
 * (D-T2) those are the only two carry knobs: the retired
 * `carryLastYearWeight`/`carryPriorYearWeight` pair was UNNORMALIZED, so its
 * SUM duplicated `carryMeanReversion`'s shrinkage job while only its RATIO
 * asked a distinct question — the ratio is now `carryPriorYearShare` and the
 * shrinkage is `carryMeanReversion` alone. Component MEANS carry via the blend; posterior variance
 * re-inflates to the cold-start prior (a year of layoff is a bigger regime
 * change than an event boundary, D-07's own reasoning applied one level
 * up) rather than carrying the outgoing season's converged, and therefore
 * small, `P` forward. The consistency estimate ALSO carries (D-17), decayed
 * by `params.consistencyCarryDecay`.
 */
function carrySeason(state: Sigma1State, boundary: SeasonBoundary, params: Sigma1Params): Sigma1State {
  if (boundary.isColdStart) return state;

  // D-T1: one resolve, at the top, from the OUTGOING season's own expanding
  // statistic — which `carrySeason` then threads forward unchanged, so the
  // incoming season starts scaled by the previous season's sigma and
  // converges to its own. That lag is accepted and documented (`scale.ts`'s
  // header); resetting the statistic here would leave the first matches of
  // every season with no scale at all.
  const resolved = resolveSigma1Params(params, state.allianceScoreStats);

  const teamTotals = new Map<string, number>();
  for (const [team, teamState] of state.teams) {
    let total = 0;
    for (const belief of Object.values(teamState.beliefs)) total += belief.mean;
    teamTotals.set(team, total);
  }

  const carryResult = sigma1Carryover({ teamTotals, priorSeasonRatings: state.priorSeasonRatings }, resolved);
  const toComponentOrder = componentMapForSeason(boundary.toSeason).components;
  // D-09: threshold variables are season-specific (2022's cargo count has
  // no 2023 analog) — RP state does NOT carry across a season boundary,
  // unlike the score-component beliefs blended below. Every team resets to
  // `emptyRpTeamState`, sized for the INCOMING season's variable count.
  const toRpVariableCount = rpRuleModuleForSeason(boundary.toSeason).thresholdVariables.length;
  const nextTeams = new Map<string, Sigma1TeamState>();

  for (const [team, carriedTotal] of carryResult.teamPointTotals) {
    const share = toComponentOrder.length > 0 ? carriedTotal / toComponentOrder.length : 0;
    const oldTeamState = state.teams.get(team);
    const beliefs: Record<string, TeamComponentBelief> = {};
    const consistency: Record<string, number> = {};
    for (const name of toComponentOrder) {
      // D-Q2: floored — see `seedConsistencyFor`. This is the re-inflated
      // posterior a year of layoff justifies; seeding it at an unfloored 0
      // would be the opposite claim (perfect certainty after a layoff) and
      // would freeze the component's gain.
      const coldStartVariance = seedConsistencyFor(state.league, name, resolved);
      beliefs[name] = { mean: share, variance: coldStartVariance };
      const carriedObserved = oldTeamState?.consistency[name] ?? coldStartVariance;
      consistency[name] = carriedObserved * resolved.consistencyCarryDecay;
    }
    nextTeams.set(team, {
      beliefs,
      covariance: emptyCovariance(toComponentOrder.length),
      consistency,
      matchCount: 0,
      lastEventKey: null,
      // D-05/D-07 (plan 03-04): a year of layoff makes last season's
      // adaptation evidence stale — the same "regime change" reasoning
      // `carrySeason`'s posterior-variance re-inflation already applies one
      // level up. Every team resets to the cold-start "assume correctly
      // specified" prior, never carries a converged factor forward.
      innovationStats: emptyInnovationStats(),
      ...emptyRpTeamState(toRpVariableCount, toComponentOrder.length),
    });
  }

  return {
    season: boundary.toSeason,
    componentOrder: toComponentOrder,
    teams: nextTeams,
    // League priors are retained rather than reset — a reasonable starting
    // point for the new season, the same "carry forward unchanged" choice
    // epa.ts's own carrySeason makes for allianceScoreStats below. This
    // includes `rpVariableMean` (D-09): its keys are the OUTGOING season's
    // threshold-variable names, which the incoming season's differently-named
    // variables simply won't match — harmless stale data, the identical
    // precedent `componentMean`/`componentConsistency` already establish for
    // season-specific component names.
    league: state.league,
    allianceScoreStats: state.allianceScoreStats,
    priorSeasonRatings: carryResult.priorSeasonRatings,
    // Plan 03-03: a cumulative counter across the algorithm's whole
    // lifetime — never reset at a season boundary (see `Sigma1State`'s own
    // doc comment).
    rpSkippedMatchCount: state.rpSkippedMatchCount,
    // D-Q2 (quick task 260818-inm): also cumulative over the algorithm's
    // whole lifetime, never reset at a season boundary — identical
    // "carry forward unchanged" treatment to `rpSkippedMatchCount` above.
    breakdownParseFailureCount: state.breakdownParseFailureCount,
  };
}

export interface Sigma1Options {
  readonly id: string;
  readonly linkMode: WinProbMode;
  /** D-13: the tunable parameter set this module reads instead of Phase-2's bare module constants. Defaults to `DEFAULT_SIGMA1_PARAMS` (the Phase-2-reproducing values) when omitted — every pre-Phase-3 `makeSigma1({ id, linkMode })` call site keeps compiling and behaving identically. */
  readonly params?: Sigma1Params;
  /** D-13: the named half of the `{codeVersion}+{paramSetName}` version identity (`version` below). Defaults to `"defaults"` — an explicit, honest label for the untuned baseline rather than an empty string. */
  readonly paramSetName?: string;
}

/**
 * Builds one Sigma1 `AlgorithmModule` for a given D-12 win-probability mode
 * and D-13 parameter set. `update`/`teamMetrics`/`carrySeason` are identical
 * across every link mode — only `predict`'s probability step differs — so
 * running all three prebuilt link-mode modules in one harness pass costs
 * three times a cheap update in exchange for D-12's side-by-side comparison
 * table without a second replay pass (documented tradeoff, not an
 * oversight). `params` resolves once here (`options.params ??
 * DEFAULT_SIGMA1_PARAMS`) and is closed over by every bound function below —
 * never re-resolved per match.
 */
export function makeSigma1(options: Sigma1Options): AlgorithmModule<Sigma1State> {
  // WR-02 (03.1-REVIEW.md): parse through Sigma1ParamsSchema rather than
  // merely accepting `options.params` by TypeScript shape — the schema's
  // `.check(...)` enforces the cross-parameter invariants (D-07, T-03-06,
  // D-04) that structural typing alone cannot, closing the boundary
  // params.ts's "unconstructible" doc comment already claimed was closed.
  // A no-op for every existing call site: `tune.ts`, `cli.ts`, and
  // `promote.ts` already validate upstream, and `DEFAULT_SIGMA1_PARAMS`
  // itself parses cleanly (verified directly before this change).
  const params = Sigma1ParamsSchema.parse(options.params ?? DEFAULT_SIGMA1_PARAMS);
  return {
    id: options.id,
    // D-13: a version is a code version paired with a named, committed
    // parameter set — never a hardcoded literal. `sigma1Defaults` below
    // (paramSetName "defaults") reproduces this exact string for the
    // untuned baseline; `promote.ts` produces the tuned equivalents.
    version: `${SIGMA1_CODE_VERSION}+${options.paramSetName ?? "defaults"}`,
    initState,
    predict: (state, match) => predict(state, match, options.linkMode, params),
    update: (state, result) => update(state, result, params),
    teamMetrics: (state, teams) => teamMetrics(state, teams, params),
    carrySeason: (state, boundary) => carrySeason(state, boundary, params),
  };
}

/**
 * D-04/D-05 (plan 07-16 Task 1): `vpr` is the PUBLISHED algorithm identity —
 * the id that reaches every R2 artifact key, the algorithms manifest, and
 * D1's `algorithm_state.algorithm_id` column. Everything around it in this
 * file — `makeSigma1`, `Sigma1State`, `Sigma1Params`, `SIGMA1_CODE_VERSION`,
 * and the `sigma1/` directory this file lives in — names the Kalman-filter
 * IMPLEMENTATION and was deliberately left unrenamed (PD-02, 07-16-PLAN.md):
 * the rename follows the identity a value IS, PRODUCES, or RESOLVES, not
 * the machinery that builds it. A reader who wants the implementation-side
 * rename too (`sigma1/` -> some other directory name, `Sigma1State` ->
 * some other type name) should treat that as a separate, later refactor —
 * it moves no published byte and was out of scope here.
 *
 * D-12's nested default: logistic on `margin / (c * sqrt(predictiveVariance))`.
 * Untagged `paramSetName` — resolves to `version: "{SIGMA1_CODE_VERSION}+defaults"`.
 */
export const vpr = makeSigma1({ id: "vpr", linkMode: "predictive-variance" });
/** D-12 mode 1: Statbotics-parity logistic on `margin / seasonScoreSd`. */
export const vprSeasonSd = makeSigma1({ id: "vpr-seasonsd", linkMode: "season-sd" });
/** D-12 mode 3: deferred idea, shipped as a working flag flip (RESEARCH.md Deferred Ideas). */
export const vprNormalCdf = makeSigma1({ id: "vpr-normalcdf", linkMode: "normal-cdf" });
/**
 * The honest, untuned baseline (Claude's Discretion, naming) — identical to
 * `vpr` in every respect except an explicit `paramSetName: "defaults"`
 * rather than relying on `makeSigma1`'s own default fallback, so a harness
 * run can register both `vpr` (implicit defaults) and `vprDefaults`
 * (explicit defaults) side by side once `promote.ts` starts registering
 * tuned variants under the `vpr` id — this row is what isolates what
 * tuning actually bought.
 */
export const vprDefaults = makeSigma1({ id: "vpr-defaults", linkMode: "predictive-variance", paramSetName: "defaults" });
/**
 * D-05/D-06/D-08 (plan 03-04 Task 2): the adaptation-ON counterpart to
 * `vpr`/`vprDefaults`, registered under the `vpr-adapt` harness id
 * so `pnpm harness --algorithm vpr,vpr-adapt` scores both variants in
 * ONE pass over one shared match stream — the same objects, the same order,
 * so any difference between the two is the adaptation and nothing else.
 * `paramSetName: "defaults-adapt"` keeps its version identity distinct from
 * the off variant's `"defaults"` (D-13). The default `vpr` module itself
 * is UNCHANGED — `adaptationEnabled: false` — D-08: the code stays in the
 * tree behind its flag, and the default promoted version has adaptation off
 * until a measurement (plan 03-05's best-vs-best search) says otherwise.
 */
export const vprAdaptive = makeSigma1({
  id: "vpr-adapt",
  linkMode: "predictive-variance",
  paramSetName: "defaults-adapt",
  params: { ...DEFAULT_SIGMA1_PARAMS, adaptationEnabled: true },
});
