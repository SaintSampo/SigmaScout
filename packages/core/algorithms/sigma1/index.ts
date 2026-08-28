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
 * form), `consistency.ts` (D-09/D-11's team-page spread estimator), and
 * `linkFunctions.ts` (D-12's three win-probability modes) into one
 * `predict`/`update`/`teamMetrics`/`carrySeason` contract, reusing
 * `opr.ts`'s `ratingEligibleTeams` and `breakdown/index.ts`'s per-season
 * component maps unchanged rather than re-deriving surrogate policy or
 * component extraction (RESEARCH.md Pattern 2, 02-PATTERNS.md).
 *
 * `makeSigma1({ id, linkMode })` builds one module per D-12 win-probability
 * mode; `update`'s state-transition math is IDENTICAL across every mode
 * (link mode only affects `predict`'s probability step), so three prebuilt
 * modules (`sigma1`, `sigma1SeasonSd`, `sigma1NormalCdf`) can each run
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
import { allianceTotalPredictiveVariance, emptyCovariance, ewmaCovariance, subsetVariance, teamTotalVariance } from "./covariance.js";
import { foldConsistency, shrinkConsistency } from "./consistency.js";
import { winProbability, type WinProbMode } from "./linkFunctions.js";
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_CODE_VERSION, Sigma1ParamsSchema, type Sigma1Params } from "./params.js";
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
  Sigma1ParamsSchema,
  type Sigma1Params,
} from "./params.js";
export {
  SIGMA1_COV_EWMA_ALPHA,
  SIGMA1_COV_SHRINKAGE,
  allianceTotalPredictiveVariance,
  emptyCovariance,
  ewmaCovariance,
  teamTotalVariance,
} from "./covariance.js";
export {
  SIGMA1_CONSISTENCY_EWMA_ALPHA,
  SIGMA1_SHRINKAGE_PRIOR_MATCHES,
  SIGMA1_MIN_CONSISTENCY_VARIANCE,
  foldConsistency,
  shrinkConsistency,
} from "./consistency.js";
export { SIGMA1_LINK_C, erf, normalCdf, winProbability } from "./linkFunctions.js";
export {
  SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY,
  SIGMA1_PROCESS_NOISE_WITHIN_EVENT,
  applyProcessNoise,
  updateAllianceSum,
} from "./kalman.js";

function componentColdStartTotal(componentCount: number, params: Sigma1Params): number {
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
  /** Per-component expanding stats over every team's own squared gain-weighted residual — `.mean` is a running league-average consistency VARIANCE, D-11's shrinkage target. */
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
  params: Sigma1Params,
  rpVariableCount: number
): Sigma1TeamState {
  const coldStartMean = componentColdStartTotal(componentOrder.length, params);
  const beliefs: Record<string, TeamComponentBelief> = {};
  const consistency: Record<string, number> = {};
  for (const name of componentOrder) {
    const mean = leagueMeanFor(league, name, coldStartMean);
    const variance = leagueConsistencyFor(league, name, params.coldStartConsistencyVariance);
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

function applyTeamProcessNoise(teamState: Sigma1TeamState, eventKey: string, params: Sigma1Params): Sigma1TeamState {
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
  params: Sigma1Params
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
  params: Sigma1Params
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
   * `componentOrder`) — the same value already computed below for
   * `covariance.ts`'s own fold, now also exposed so `update()` can thread
   * it into `rp/state.ts`'s `foldRpObservation` for D-11's cross-covariance,
   * without recomputing it.
   */
  readonly residualsByTeam: ReadonlyMap<string, readonly number[]>;
}

/**
 * Applies one alliance's observed component vector to its rating-eligible
 * teammates: D-07 process noise first, then a per-component
 * `updateAllianceSum` Kalman update, then folding each team's
 * gain-weighted residual into its own consistency (D-09/D-11) and
 * covariance (D-03) estimators, plus the league-wide running aggregates
 * (`Sigma1League`). Returns new maps; never mutates its inputs.
 */
function applyAllianceUpdate(
  teams: ReadonlyMap<string, Sigma1TeamState>,
  league: Sigma1League,
  componentOrder: readonly string[],
  allianceTeams: readonly string[],
  observed: ParsedComponents,
  measurementNoiseMultiplier: number,
  eventKey: string,
  params: Sigma1Params,
  rpVariableCount: number
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
    const pooledVariance = teammateBeliefs.reduce((sum, t) => sum + t.variance, 0) + measurementNoise;
    const normalizedInnovation = pooledVariance > 0 ? innovation / Math.sqrt(pooledVariance) : 0;

    allianceTeams.forEach((team, i) => {
      nextBeliefsByTeam.get(team)![name] = updated[i]!;
      residualsByTeam.get(team)![componentIndex] = gains[i]! * innovation;
      normalizedInnovationsByTeam.get(team)![componentIndex] = normalizedInnovation;
    });

    let meanStats = nextComponentMean[name] ?? emptyExpandingStats();
    for (let i = 0; i < allianceTeams.length; i++) meanStats = foldObservation(meanStats, observedShare);
    nextComponentMean = { ...nextComponentMean, [name]: meanStats };

    let consistencyStats = nextComponentConsistency[name] ?? emptyExpandingStats();
    for (const team of allianceTeams) {
      const residual = residualsByTeam.get(team)![componentIndex]!;
      consistencyStats = foldObservation(consistencyStats, residual * residual);
    }
    nextComponentConsistency = { ...nextComponentConsistency, [name]: consistencyStats };
  });

  const nextTeams = new Map(teams);
  for (const team of allianceTeams) {
    const working = workingTeams.get(team)!;
    const residualVector = residualsByTeam.get(team)!;
    const nextConsistency: Record<string, number> = { ...working.consistency };
    componentOrder.forEach((name, i) => {
      nextConsistency[name] = foldConsistency(
        nextConsistency[name] ?? params.coldStartConsistencyVariance,
        residualVector[i]!,
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
      covariance: ewmaCovariance(working.covariance, residualVector, params.covEwmaAlpha, params.covShrinkage),
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
 * both committed `sigma1@2.0.0` digests, and reverted in favor of this
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
  const seasonScoreSd = standardDeviation(state.allianceScoreStats, params.fallbackScoreSd);
  const pRedWin = winProbability(linkMode, margin, seasonScoreSd, variance, params.linkC);
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
        params,
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
  const season = state.season ?? deriveSeasonFromEventKey(result.eventKey);
  const seasonMap = componentMapForSeason(season);
  const componentOrder = state.componentOrder.length > 0 ? state.componentOrder : seasonMap.components;

  const redTeams = ratingEligibleTeams(result.redTeams, result.redSurrogates);
  const blueTeams = ratingEligibleTeams(result.blueTeams, result.blueSurrogates);

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
    fallbackObserved(state, redTeams, result.redScore, blueFoulsMean, nonFoulsComponents, componentOrder, params);
  const blueObserved =
    blueParsed ??
    fallbackObserved(state, blueTeams, result.blueScore, redFoulsMean, nonFoulsComponents, componentOrder, params);

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

  const afterRed = applyAllianceUpdate(
    state.teams,
    state.league,
    componentOrder,
    redTeams,
    redObserved,
    measurementNoiseMultiplier,
    result.eventKey,
    params,
    rpVariableCount
  );
  const afterBlue = applyAllianceUpdate(
    afterRed.teams,
    afterRed.league,
    componentOrder,
    blueTeams,
    blueObserved,
    measurementNoiseMultiplier,
    result.eventKey,
    params,
    rpVariableCount
  );

  // Pitfall EPA-1's fix, reused here: fold both alliances' observed totals
  // into the expanding-window SD — the score itself is always known, even
  // when its breakdown is not.
  const allianceScoreStats = foldObservation(foldObservation(state.allianceScoreStats, result.redScore), result.blueScore);

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
      allianceTeams: redTeams,
      observedThresholdVariables: redRpParsed.thresholdVariables,
      scoreResidualsByTeam: afterRed.residualsByTeam,
      componentCount: componentOrder.length,
      eventKey: result.eventKey,
      params,
    });
    const blueRpFold = foldRpObservation({
      teams: state.teams,
      league: redRpFold.league,
      ruleModule,
      allianceTeams: blueTeams,
      observedThresholdVariables: blueRpParsed.thresholdVariables,
      scoreResidualsByTeam: afterBlue.residualsByTeam,
      componentCount: componentOrder.length,
      eventKey: result.eventKey,
      params,
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
 * D-27: per team, one `TeamMetric` per learned component (`value` = the
 * Kalman belief mean, `spread` = the square root of the D-11-shrunk
 * consistency variance) plus `TOTAL_METRIC_KEY` (`value` = the component
 * sum, `spread` = the square root of `teamTotalVariance` over the team's
 * OWN covariance matrix — D-03's full quadratic form, not a sum of
 * per-component spreads, since that would silently drop cross-component
 * correlation). Every spread is derived from that team's own residual
 * history; a team with no history gets the shrinkage blend's
 * league-prior-dominated value, visible as such via a `matchCount` of 0
 * rather than hidden behind a plausible-looking number.
 *
 * D-05 (plan 03-04), Claude's Discretion resolved: adaptation does NOT
 * touch this function's output. `consistency`/`teamState.covariance` below
 * are exactly what they were before adaptation existed — adaptation only
 * ever scales `applyTeamProcessNoise`'s `q` (the Kalman filter's process
 * noise, an internal responsiveness knob), never the empirically-estimated
 * consistency/covariance this function reads. The published `±` is what the
 * site shows the user; it must stay a direct empirical estimate of that
 * team's own residual spread, not partly a function of a tuning parameter —
 * letting a responsiveness knob move it would quietly turn an "honest
 * uncertainty" number into something the on/off adaptation comparison could
 * no longer cleanly attribute.
 */
function teamMetrics(state: Sigma1State, teams: readonly string[] | undefined, params: Sigma1Params): TeamMetrics {
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

      const observedConsistency = teamState.consistency[name] ?? params.coldStartConsistencyVariance;
      const leagueConsistency = leagueConsistencyFor(state.league, name, params.coldStartConsistencyVariance);
      const shrunkVariance = shrinkConsistency(
        observedConsistency,
        teamState.matchCount,
        leagueConsistency,
        params.shrinkagePriorMatches,
        params.minConsistencyVariance
      );
      perTeam[name] = { value, spread: Math.sqrt(shrunkVariance) };
    }

    const totalVariance = Math.max(params.minConsistencyVariance, teamTotalVariance(teamState.covariance));
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
        let present = false;
        for (const name of groups[groupId]) {
          const index = state.componentOrder.indexOf(name);
          if (index === -1) continue;
          indices.push(index);
          groupValue += teamState.beliefs[name]?.mean ?? 0;
          present = true;
        }
        // A group whose components are all absent from this season's resolved
        // component order publishes nothing, rather than a spurious 0 ± floor.
        if (!present) continue;
        const groupVariance = Math.max(params.minConsistencyVariance, subsetVariance(teamState.covariance, indices));
        perTeam[COMPONENT_GROUP_METRIC_KEYS[groupId]] = { value: groupValue, spread: Math.sqrt(groupVariance) };
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
 * frozen), so tuning `params.carryMeanReversion`/`carryLastYearWeight`/
 * `carryPriorYearWeight` moves Sigma1's carried ratings without moving
 * EPA's (D-04). Component MEANS carry via the blend; posterior variance
 * re-inflates to the cold-start prior (a year of layoff is a bigger regime
 * change than an event boundary, D-07's own reasoning applied one level
 * up) rather than carrying the outgoing season's converged, and therefore
 * small, `P` forward. The consistency estimate ALSO carries (D-17), decayed
 * by `params.consistencyCarryDecay`.
 */
function carrySeason(state: Sigma1State, boundary: SeasonBoundary, params: Sigma1Params): Sigma1State {
  if (boundary.isColdStart) return state;

  const teamTotals = new Map<string, number>();
  for (const [team, teamState] of state.teams) {
    let total = 0;
    for (const belief of Object.values(teamState.beliefs)) total += belief.mean;
    teamTotals.set(team, total);
  }

  const carryResult = sigma1Carryover({ teamTotals, priorSeasonRatings: state.priorSeasonRatings }, params);
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
      const coldStartVariance = leagueConsistencyFor(state.league, name, params.coldStartConsistencyVariance);
      beliefs[name] = { mean: share, variance: coldStartVariance };
      const carriedObserved = oldTeamState?.consistency[name] ?? coldStartVariance;
      consistency[name] = carriedObserved * params.consistencyCarryDecay;
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

/** D-12's nested default: logistic on `margin / (c * sqrt(predictiveVariance))`. Untagged `paramSetName` — resolves to `version: "{SIGMA1_CODE_VERSION}+defaults"`. */
export const sigma1 = makeSigma1({ id: "sigma1", linkMode: "predictive-variance" });
/** D-12 mode 1: Statbotics-parity logistic on `margin / seasonScoreSd`. */
export const sigma1SeasonSd = makeSigma1({ id: "sigma1-seasonsd", linkMode: "season-sd" });
/** D-12 mode 3: deferred idea, shipped as a working flag flip (RESEARCH.md Deferred Ideas). */
export const sigma1NormalCdf = makeSigma1({ id: "sigma1-normalcdf", linkMode: "normal-cdf" });
/**
 * The honest, untuned baseline (Claude's Discretion, naming) — identical to
 * `sigma1` in every respect except an explicit `paramSetName: "defaults"`
 * rather than relying on `makeSigma1`'s own default fallback, so a harness
 * run can register both `sigma1` (implicit defaults) and `sigma1Defaults`
 * (explicit defaults) side by side once `promote.ts` starts registering
 * tuned variants under the `sigma1` id — this row is what isolates what
 * tuning actually bought.
 */
export const sigma1Defaults = makeSigma1({ id: "sigma1-defaults", linkMode: "predictive-variance", paramSetName: "defaults" });
/**
 * D-05/D-06/D-08 (plan 03-04 Task 2): the adaptation-ON counterpart to
 * `sigma1`/`sigma1Defaults`, registered under the `sigma1-adapt` harness id
 * so `pnpm harness --algorithm sigma1,sigma1-adapt` scores both variants in
 * ONE pass over one shared match stream — the same objects, the same order,
 * so any difference between the two is the adaptation and nothing else.
 * `paramSetName: "defaults-adapt"` keeps its version identity distinct from
 * the off variant's `"defaults"` (D-13). The default `sigma1` module itself
 * is UNCHANGED — `adaptationEnabled: false` — D-08: the code stays in the
 * tree behind its flag, and the default promoted version has adaptation off
 * until a measurement (plan 03-05's best-vs-best search) says otherwise.
 */
export const sigma1Adaptive = makeSigma1({
  id: "sigma1-adapt",
  linkMode: "predictive-variance",
  paramSetName: "defaults-adapt",
  params: { ...DEFAULT_SIGMA1_PARAMS, adaptationEnabled: true },
});
