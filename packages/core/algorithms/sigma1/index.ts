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
  FOULS_COMMITTED_COMPONENT,
  parseBreakdown,
  componentMapForSeason,
  assertFiniteComponents,
  type ParsedComponents,
} from "../breakdown/index.js";
import { distributeResidual, FALLBACK_NOISE_MULTIPLIER } from "../breakdown/fallback.js";
import { emptyExpandingStats, foldObservation, standardDeviation, type ExpandingStats } from "../../scoring/expandingStats.js";
import {
  TOTAL_METRIC_KEY,
  type AlgorithmModule,
  type ComponentPrediction,
  type MatchResult,
  type Prediction,
  type SeasonBoundary,
  type TeamMetric,
  type TeamMetrics,
  type UpcomingMatch,
} from "../types.js";
import { epaCarryover, type EpaCarryoverPriorRatings } from "../carryover.js";
import {
  SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY,
  SIGMA1_PROCESS_NOISE_WITHIN_EVENT,
  applyProcessNoise,
  updateAllianceSum,
  type TeamComponentBelief,
} from "./kalman.js";
import { allianceTotalPredictiveVariance, emptyCovariance, ewmaCovariance, teamTotalVariance } from "./covariance.js";
import { foldConsistency, shrinkConsistency, SIGMA1_MIN_CONSISTENCY_VARIANCE } from "./consistency.js";
import { winProbability, SIGMA1_LINK_C, type WinProbMode } from "./linkFunctions.js";

export type { TeamComponentBelief } from "./kalman.js";
export type { WinProbMode } from "./linkFunctions.js";
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

/**
 * A cold-start team's typical total contribution to an alliance's score, in
 * point units (mirrors `epa.ts`'s `EPA_INIT_TYPICAL_TEAM_SHARE` reasoning
 * exactly — a flat, documented placeholder scaled down to a defensible
 * per-component seed, corrected within a handful of matches by the Kalman
 * gain once real observations arrive). Used only when the LEAGUE's own
 * running mean for a component has no data yet (`Sigma1League.componentMean`
 * below) — once any team anywhere has been observed, new cold-start teams
 * seed from that live league average instead of this fixed constant.
 * Phase 3 hyperparameter, default unverified.
 */
const SIGMA1_COLD_START_TEAM_TOTAL = 20;

/**
 * Fallback consistency VARIANCE (points^2) for a component the league has
 * never observed a residual for yet — the same role `EPA_FALLBACK_SCORE_SD`
 * plays for EPA's win-probability scale, applied here to Sigma1's own
 * measurement-noise/spread estimate instead. Phase 3 hyperparameter,
 * default unverified.
 */
const SIGMA1_COLD_START_CONSISTENCY_VARIANCE = 25;

/** Fallback alliance-score SD before at least 2 alliance-score observations exist this season (mirrors `epa.ts`'s `EPA_FALLBACK_SCORE_SD`). Phase 3 hyperparameter, default unverified. */
const SIGMA1_FALLBACK_SCORE_SD = 25;

/**
 * D-17: how far a carried-over consistency estimate decays at a season
 * boundary before the empirical-Bayes shrinkage (D-11) even applies — since
 * `carrySeason` also resets `matchCount` to 0, `shrinkConsistency` will
 * fully weight the league prior immediately after a carry regardless of
 * this value; what this constant controls is how quickly the CARRIED value
 * stops mattering as the new season's own observations accumulate.
 * Phase 3's tuner is explicitly allowed to shrink this to 0 if the carried
 * consistency signal turns out not to be real (D-17's own wording).
 */
export const SIGMA1_CONSISTENCY_CARRY_DECAY = 0.5;

function componentColdStartTotal(componentCount: number): number {
  return componentCount > 0 ? SIGMA1_COLD_START_TEAM_TOTAL / componentCount : 0;
}

/** One team's full Sigma1 state: Kalman beliefs, cross-component covariance, and the D-09/D-11 consistency estimate, per component. */
export interface Sigma1TeamState {
  readonly beliefs: Readonly<Record<string, TeamComponentBelief>>;
  /** D-03's per-team cross-component covariance matrix Sigma, indexed by `Sigma1State.componentOrder`. */
  readonly covariance: number[][];
  /** Raw (unshrunk) EWMA consistency VARIANCE per component — `shrinkConsistency` is applied at read time (`teamMetrics`), not stored pre-shrunk. */
  readonly consistency: Readonly<Record<string, number>>;
  readonly matchCount: number;
  /** D-07: the `eventKey` of the last match this team was observed in, for cross-event process-noise detection. `null` for a team never yet observed. */
  readonly lastEventKey: string | null;
}

/** League-wide running aggregates feeding D-11's shrinkage prior and every cold-start team's baseline (Claude's Discretion, RESEARCH.md). */
export interface Sigma1League {
  /** Per-component expanding stats over every rating-eligible team's OWN observed per-match share — `.mean` is the live league-average component share, the cold-start baseline once populated. */
  readonly componentMean: Readonly<Record<string, ExpandingStats>>;
  /** Per-component expanding stats over every team's own squared gain-weighted residual — `.mean` is a running league-average consistency VARIANCE, D-11's shrinkage target. */
  readonly componentConsistency: Readonly<Record<string, ExpandingStats>>;
}

export interface Sigma1State {
  readonly season: number | null;
  /** This season's canonical, ordered component list — indexes every team's `covariance` matrix. Empty until the first `update()` call resolves a season. */
  readonly componentOrder: readonly string[];
  readonly teams: ReadonlyMap<string, Sigma1TeamState>;
  readonly league: Sigma1League;
  /** Pitfall EPA-1: expanding-window alliance-score SD, folded match-by-match, never a season-batch constant — feeds D-12 mode 1's denominator. */
  readonly allianceScoreStats: ExpandingStats;
  /** D-16/D-17: normalized-scale ratings carried into `season` from the two seasons before it, reusing `carryover.ts`'s EPA-shaped carry (see `carrySeason` below). */
  readonly priorSeasonRatings: EpaCarryoverPriorRatings;
}

const EMPTY_PRIOR_SEASON_RATINGS: EpaCarryoverPriorRatings = { lastSeason: new Map(), yearBefore: new Map() };

function initState(): Sigma1State {
  return {
    season: null,
    componentOrder: [],
    teams: new Map(),
    league: { componentMean: {}, componentConsistency: {} },
    allianceScoreStats: emptyExpandingStats(),
    priorSeasonRatings: EMPTY_PRIOR_SEASON_RATINGS,
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
function coldStartTeamState(componentOrder: readonly string[], league: Sigma1League): Sigma1TeamState {
  const coldStartMean = componentColdStartTotal(componentOrder.length);
  const beliefs: Record<string, TeamComponentBelief> = {};
  const consistency: Record<string, number> = {};
  for (const name of componentOrder) {
    const mean = leagueMeanFor(league, name, coldStartMean);
    const variance = leagueConsistencyFor(league, name, SIGMA1_COLD_START_CONSISTENCY_VARIANCE);
    beliefs[name] = { mean, variance };
    consistency[name] = variance;
  }
  return {
    beliefs,
    covariance: emptyCovariance(componentOrder.length),
    consistency,
    matchCount: 0,
    lastEventKey: null,
  };
}

function applyTeamProcessNoise(teamState: Sigma1TeamState, eventKey: string): Sigma1TeamState {
  // A team with no prior observation (lastEventKey === null) is treated as
  // "within event" — it was just cold-start-seeded this instant, so there
  // is nothing to have drifted since a nonexistent last observation, and
  // an event-boundary bump would inflate a belief for no reason.
  const q =
    teamState.lastEventKey === null || teamState.lastEventKey === eventKey
      ? SIGMA1_PROCESS_NOISE_WITHIN_EVENT
      : SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY;
  const beliefs: Record<string, TeamComponentBelief> = {};
  for (const [name, belief] of Object.entries(teamState.beliefs)) {
    beliefs[name] = applyProcessNoise(belief, q);
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
function foulsCommittedCarryForward(state: Sigma1State, teams: readonly string[], componentOrder: readonly string[]): number {
  const coldStartMean = componentColdStartTotal(componentOrder.length);
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
  componentOrder: readonly string[]
): ParsedComponents {
  const offensive = distributeResidual(
    observedAllianceScore - opponentFoulsMean,
    predictedComponentTotals(state, teams, componentOrder),
    offensiveComponents
  );
  return {
    ...offensive,
    [FOULS_COMMITTED_COMPONENT]: foulsCommittedCarryForward(state, teams, componentOrder),
  };
}

interface AllianceUpdateResult {
  readonly teams: ReadonlyMap<string, Sigma1TeamState>;
  readonly league: Sigma1League;
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
  eventKey: string
): AllianceUpdateResult {
  if (allianceTeams.length === 0) {
    // Every team on this alliance was a surrogate — nothing to attribute,
    // a genuine no-op (mirrors opr.ts's/epa.ts's own empty-observation
    // handling, and kalman.ts's updateAllianceSum for an empty teammates
    // array).
    return { teams, league };
  }

  const workingTeams = new Map<string, Sigma1TeamState>();
  for (const team of allianceTeams) {
    const existing = teams.get(team);
    workingTeams.set(team, existing ? applyTeamProcessNoise(existing, eventKey) : coldStartTeamState(componentOrder, league));
  }

  const nextBeliefsByTeam = new Map<string, Record<string, TeamComponentBelief>>();
  const residualsByTeam = new Map<string, number[]>();
  for (const team of allianceTeams) {
    nextBeliefsByTeam.set(team, { ...workingTeams.get(team)!.beliefs });
    residualsByTeam.set(team, new Array(componentOrder.length).fill(0));
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
        (sum, team) => sum + (workingTeams.get(team)!.consistency[name] ?? SIGMA1_COLD_START_CONSISTENCY_VARIANCE),
        0
      ) * measurementNoiseMultiplier;

    const updated = updateAllianceSum(teammateBeliefs, observedSum, measurementNoise);
    const gains = componentGains(teammateBeliefs, measurementNoise);
    const predictedSum = teammateBeliefs.reduce((sum, t) => sum + t.mean, 0);
    const innovation = observedSum - predictedSum;
    const observedShare = observedSum / allianceTeams.length;

    allianceTeams.forEach((team, i) => {
      nextBeliefsByTeam.get(team)![name] = updated[i]!;
      residualsByTeam.get(team)![componentIndex] = gains[i]! * innovation;
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
      nextConsistency[name] = foldConsistency(nextConsistency[name] ?? SIGMA1_COLD_START_CONSISTENCY_VARIANCE, residualVector[i]!);
    });
    nextTeams.set(team, {
      beliefs: nextBeliefsByTeam.get(team)!,
      covariance: ewmaCovariance(working.covariance, residualVector),
      consistency: nextConsistency,
      matchCount: working.matchCount + 1,
      lastEventKey: eventKey,
    });
  }

  return {
    teams: nextTeams,
    league: { componentMean: nextComponentMean, componentConsistency: nextComponentConsistency },
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

function allianceComponentVarianceSum(state: Sigma1State, teams: readonly string[]): number {
  let total = 0;
  for (const team of teams) {
    const beliefs = state.teams.get(team)?.beliefs;
    if (!beliefs) continue;
    for (const belief of Object.values(beliefs)) total += belief.variance;
  }
  return total;
}

function allianceCovariances(state: Sigma1State, teams: readonly string[]): number[][][] {
  return teams.map((team) => state.teams.get(team)?.covariance ?? []);
}

function predict(state: Sigma1State, match: UpcomingMatch, linkMode: WinProbMode): Prediction {
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
  const seasonScoreSd = standardDeviation(state.allianceScoreStats, SIGMA1_FALLBACK_SCORE_SD);
  const pRedWin = winProbability(linkMode, margin, seasonScoreSd, variance, SIGMA1_LINK_C);

  return {
    // margin === 0 gives pRedWin exactly 0.5 through every link mode's own
    // documented boundary handling (linkFunctions.ts), and ">= 0.5"
    // resolves to "red" — matching opr.ts's/epa.ts's tie convention.
    winner: pRedWin >= 0.5 ? "red" : "blue",
    pRedWin,
    redScore,
    blueScore,
    variance,
    redComponents,
    blueComponents,
  };
}

function update(state: Sigma1State, result: MatchResult): Sigma1State {
  const season = state.season ?? deriveSeasonFromEventKey(result.eventKey);
  const seasonMap = componentMapForSeason(season);
  const componentOrder = state.componentOrder.length > 0 ? state.componentOrder : seasonMap.components;

  const redTeams = ratingEligibleTeams(result.redTeams, result.redSurrogates);
  const blueTeams = ratingEligibleTeams(result.blueTeams, result.blueSurrogates);

  const redParsed = parseBreakdown(season, result.scoreBreakdownRaw, "red");
  const blueParsed = parseBreakdown(season, result.scoreBreakdownRaw, "blue");
  // D-05: a match with no score_breakdown (parseBreakdown returns null for
  // BOTH sides together, since the raw JSON is missing for the whole
  // match) still updates state via a proportional-residual fallback, with
  // the resulting observation's measurement noise inflated by
  // FALLBACK_NOISE_MULTIPLIER inside applyAllianceUpdate — never a silent
  // drop, never a coerced zero (RESEARCH.md Anti-Patterns).
  const usedFallback = redParsed === null;
  const measurementNoiseMultiplier = usedFallback ? FALLBACK_NOISE_MULTIPLIER : 1;

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
    redParsed ?? fallbackObserved(state, redTeams, result.redScore, blueFoulsMean, nonFoulsComponents, componentOrder);
  const blueObserved =
    blueParsed ?? fallbackObserved(state, blueTeams, result.blueScore, redFoulsMean, nonFoulsComponents, componentOrder);

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

  const afterRed = applyAllianceUpdate(state.teams, state.league, componentOrder, redTeams, redObserved, measurementNoiseMultiplier, result.eventKey);
  const afterBlue = applyAllianceUpdate(afterRed.teams, afterRed.league, componentOrder, blueTeams, blueObserved, measurementNoiseMultiplier, result.eventKey);

  // Pitfall EPA-1's fix, reused here: fold both alliances' observed totals
  // into the expanding-window SD — the score itself is always known, even
  // when its breakdown is not.
  const allianceScoreStats = foldObservation(foldObservation(state.allianceScoreStats, result.redScore), result.blueScore);

  return {
    season,
    componentOrder,
    teams: afterBlue.teams,
    league: afterBlue.league,
    allianceScoreStats,
    priorSeasonRatings: state.priorSeasonRatings,
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
 */
function teamMetrics(state: Sigma1State, teams?: readonly string[]): TeamMetrics {
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

      const observedConsistency = teamState.consistency[name] ?? SIGMA1_COLD_START_CONSISTENCY_VARIANCE;
      const leagueConsistency = leagueConsistencyFor(state.league, name, SIGMA1_COLD_START_CONSISTENCY_VARIANCE);
      const shrunkVariance = shrinkConsistency(observedConsistency, teamState.matchCount, leagueConsistency);
      perTeam[name] = { value, spread: Math.sqrt(shrunkVariance) };
    }

    const totalVariance = Math.max(SIGMA1_MIN_CONSISTENCY_VARIANCE, teamTotalVariance(teamState.covariance));
    perTeam[TOTAL_METRIC_KEY] = { value: total, spread: Math.sqrt(totalVariance) };
    result[team] = perTeam;
  }
  return result;
}

/**
 * D-16/D-17/D-19: carries every team's rating across a season boundary,
 * reusing `carryover.ts`'s `epaCarryover` unchanged (the same reference
 * shape EPA's own `carrySeason` builds on — Sigma1 needs no second
 * bespoke carry design). Component MEANS carry via the blend; posterior
 * variance re-inflates to the cold-start prior (a year of layoff is a
 * bigger regime change than an event boundary, D-07's own reasoning
 * applied one level up) rather than carrying the outgoing season's
 * converged, and therefore small, `P` forward. The consistency estimate
 * ALSO carries (D-17), decayed by `SIGMA1_CONSISTENCY_CARRY_DECAY`.
 */
function carrySeason(state: Sigma1State, boundary: SeasonBoundary): Sigma1State {
  if (boundary.isColdStart) return state;

  const teamTotals = new Map<string, number>();
  for (const [team, teamState] of state.teams) {
    let total = 0;
    for (const belief of Object.values(teamState.beliefs)) total += belief.mean;
    teamTotals.set(team, total);
  }

  const carryResult = epaCarryover({ teamTotals, priorSeasonRatings: state.priorSeasonRatings });
  const toComponentOrder = componentMapForSeason(boundary.toSeason).components;
  const nextTeams = new Map<string, Sigma1TeamState>();

  for (const [team, carriedTotal] of carryResult.teamPointTotals) {
    const share = toComponentOrder.length > 0 ? carriedTotal / toComponentOrder.length : 0;
    const oldTeamState = state.teams.get(team);
    const beliefs: Record<string, TeamComponentBelief> = {};
    const consistency: Record<string, number> = {};
    for (const name of toComponentOrder) {
      const coldStartVariance = leagueConsistencyFor(state.league, name, SIGMA1_COLD_START_CONSISTENCY_VARIANCE);
      beliefs[name] = { mean: share, variance: coldStartVariance };
      const carriedObserved = oldTeamState?.consistency[name] ?? coldStartVariance;
      consistency[name] = carriedObserved * SIGMA1_CONSISTENCY_CARRY_DECAY;
    }
    nextTeams.set(team, {
      beliefs,
      covariance: emptyCovariance(toComponentOrder.length),
      consistency,
      matchCount: 0,
      lastEventKey: null,
    });
  }

  return {
    season: boundary.toSeason,
    componentOrder: toComponentOrder,
    teams: nextTeams,
    // League priors are retained rather than reset — a reasonable starting
    // point for the new season, the same "carry forward unchanged" choice
    // epa.ts's own carrySeason makes for allianceScoreStats below.
    league: state.league,
    allianceScoreStats: state.allianceScoreStats,
    priorSeasonRatings: carryResult.priorSeasonRatings,
  };
}

export interface Sigma1Options {
  readonly id: string;
  readonly linkMode: WinProbMode;
}

/**
 * Builds one Sigma1 `AlgorithmModule` for a given D-12 win-probability
 * mode. `update`/`teamMetrics`/`carrySeason` are identical across every
 * mode — only `predict`'s probability step differs — so running all three
 * prebuilt modules in one harness pass costs three times a cheap update in
 * exchange for D-12's side-by-side comparison table without a second
 * replay pass (documented tradeoff, not an oversight).
 */
export function makeSigma1(options: Sigma1Options): AlgorithmModule<Sigma1State> {
  return {
    id: options.id,
    version: "1.0.0",
    initState,
    predict: (state, match) => predict(state, match, options.linkMode),
    update,
    teamMetrics,
    carrySeason,
  };
}

/** D-12's nested default: logistic on `margin / (c * sqrt(predictiveVariance))`. */
export const sigma1 = makeSigma1({ id: "sigma1", linkMode: "predictive-variance" });
/** D-12 mode 1: Statbotics-parity logistic on `margin / seasonScoreSd`. */
export const sigma1SeasonSd = makeSigma1({ id: "sigma1-seasonsd", linkMode: "season-sd" });
/** D-12 mode 3: deferred idea, shipped as a working flag flip (RESEARCH.md Deferred Ideas). */
export const sigma1NormalCdf = makeSigma1({ id: "sigma1-normalcdf", linkMode: "normal-cdf" });
