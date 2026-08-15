/**
 * D-09's parallel threshold-variable Kalman state, plus D-11's
 * cross-covariance with the score-component vector. Kept structurally
 * SEPARATE from `sigma1/index.ts`'s score-side `Sigma1TeamState` fields
 * (`beliefs`/`covariance`/`consistency`) — this module never reads or
 * writes those, and `sigma1/index.ts`'s `teamTotalVariance` call keeps
 * summing the score-component matrix alone, so the published team-page `±`
 * and `docs/models/sigma1-identifiability.md`'s conclusions are numerically
 * untouched by everything in this file (D-09's whole point, provable by
 * `state.test.ts`'s dedicated equality assertion, not merely asserted in
 * prose).
 *
 * A dependency-free-ish leaf: imports only from `../kalman.js` (REUSED
 * unchanged — no second Kalman recursion, per the plan's explicit
 * instruction), `../covariance.js` (`emptyCovariance`/`ewmaCovariance`,
 * also reused unchanged for `rpCovariance`'s own T x T fold), `../params.js`
 * (`Sigma1Params`, a pure leaf itself), `./constants.js` (`RpRuleModule`,
 * `assertFiniteThresholdVariables`), and `../../../scoring/expandingStats.js`.
 * `sigma1/index.ts` imports THIS module, never the reverse — the same
 * acyclic direction `params.ts`'s header documents fixing once already
 * (plan 03-01's Rule 3 circular-import deviation). One small, deliberate
 * duplication follows from that direction: `rpTeammateGains` below
 * reimplements the same `K_j = P_j / (sum P_i + R)` formula
 * `sigma1/index.ts`'s private `componentGains` already computes for the
 * score side, because importing that private function FROM `index.ts`
 * would recreate exactly the cycle this header describes avoiding.
 *
 * Season handling (D-19): threshold variables are season-specific (2022's
 * cargo count has no 2023 analog), so this state does NOT carry across a
 * season boundary — `sigma1/index.ts`'s `carrySeason` resets every team to
 * `emptyRpTeamState` for the incoming season's variable/component counts,
 * mirroring the score-component `carrySeason` path's own reasoning that a
 * cold start is the honest alternative to carrying a meaningless value
 * forward.
 *
 * Missing-breakdown handling (RESEARCH.md Pitfall 4, D-05's fallback):
 * when a match has no `score_breakdown` at all, `sigma1/index.ts`'s
 * `update` SKIPS calling `foldRpObservation` for that match entirely —
 * never a coerced zero, never an imputed threshold-variable split. This
 * module has no opinion on that decision; it is made by the caller, which
 * simply does not invoke this module's fold function for such a match.
 */
import type { RpRuleModule } from "./constants.js";
import { assertFiniteThresholdVariables } from "./constants.js";
import { applyProcessNoise, updateAllianceSum, type TeamComponentBelief } from "../kalman.js";
import { emptyCovariance, ewmaCovariance } from "../covariance.js";
import { emptyExpandingStats, foldObservation, type ExpandingStats } from "../../../scoring/expandingStats.js";
import type { Sigma1Params } from "../params.js";

/**
 * Per-team RP state (D-09), kept OUT of `Sigma1TeamState.covariance` (see
 * file header). `sigma1/index.ts`'s `Sigma1TeamState` structurally extends
 * this interface (adds `rpBeliefs`/`rpCovariance`/`rpCrossCovariance`
 * alongside its own score fields), rather than this module importing
 * `Sigma1TeamState` — the acyclic direction this file's header requires.
 */
export interface RpTeamState {
  /** One Gaussian per threshold variable, named by the season's `RpRuleModule.thresholdVariables`. Updated by the SAME `updateAllianceSum` alliance-sum Kalman step the score components use (`../kalman.js`, reused unchanged). */
  readonly rpBeliefs: Readonly<Record<string, TeamComponentBelief>>;
  /** T x T EWMA covariance across this season's threshold variables, folded with `../covariance.js`'s `ewmaCovariance` using `params.covEwmaAlpha`/`params.covShrinkage` — the identical fold the score-component covariance uses, applied to a different vector. */
  readonly rpCovariance: number[][];
  /**
   * C x T (rows = this season's SCORE components, columns = threshold
   * variables): the EWMA of the outer product of the score-component
   * residual vector against the threshold-variable residual vector. THIS
   * is what makes D-11's correlation fall out of the data instead of being
   * asserted — the only place the model learns that a team which
   * over-performs on score also over-performs on the counts its bonuses
   * threshold on. Asymmetric (never square), so `../covariance.js`'s
   * diagonal-shrinkage does not apply — see `ewmaCrossCovariance` below.
   */
  readonly rpCrossCovariance: number[][];
}

/** The subset of `RpTeamState` plus the one score-side field this module needs to READ (never write) for its own process-noise decision. `sigma1/index.ts`'s `Sigma1TeamState` structurally satisfies this. */
export interface RpFoldableTeamState extends RpTeamState {
  readonly lastEventKey: string | null;
}

/** D-09's third `Sigma1League` record (alongside `componentMean`/`componentConsistency`): a live, per-threshold-variable running mean across every rating-eligible team ever observed, feeding a fresh team's RP cold-start seed once any team anywhere has been observed for that variable. */
export interface RpLeague {
  readonly rpVariableMean: Readonly<Record<string, ExpandingStats>>;
}

/**
 * Documented flat prior for a threshold variable's cold-start MEAN before
 * ANY league data exists for it. Threshold variables span wildly different
 * scales and units per season (2022's `matchCargoTotal`, a raw count, vs
 * 2026's `totalTowerPoints`, a point total) — unlike the score side's
 * `SIGMA1_COLD_START_TEAM_TOTAL` (one typical point-scale constant spread
 * evenly across components), there is no single defensible non-zero guess
 * that fits every season's threshold variables. Zero is the honest,
 * documented "no signal yet" prior (RESEARCH.md Anti-Patterns: never invent
 * a plausible-looking number), corrected within a handful of matches by the
 * Kalman gain, and by the live league mean the moment any team anywhere has
 * been observed.
 */
const RP_COLD_START_VARIABLE_MEAN = 0;

function rpLeagueMeanFor(league: RpLeague, name: string, fallback: number): number {
  const stats = league.rpVariableMean[name];
  return stats && stats.count > 0 ? stats.mean : fallback;
}

/**
 * A fresh team's RP belief on every one of this season's threshold
 * variables: mean from the live league-average share (falling back to
 * `RP_COLD_START_VARIABLE_MEAN` before any league data exists), variance
 * from `params.coldStartConsistencyVariance` — the SAME cold-start
 * consistency constant the score side seeds fresh beliefs with
 * (`sigma1/index.ts`'s `coldStartTeamState`), reused here as a documented
 * placeholder rather than introducing a second cold-start-variance
 * hyperparameter Phase 3's tuner would have to search independently.
 */
function coldStartRpTeamState(
  variableNames: readonly string[],
  componentCount: number,
  league: RpLeague,
  params: Sigma1Params
): RpTeamState {
  const rpBeliefs: Record<string, TeamComponentBelief> = {};
  for (const name of variableNames) {
    rpBeliefs[name] = {
      mean: rpLeagueMeanFor(league, name, RP_COLD_START_VARIABLE_MEAN),
      variance: params.coldStartConsistencyVariance,
    };
  }
  return {
    rpBeliefs,
    rpCovariance: emptyCovariance(variableNames.length),
    rpCrossCovariance: Array.from({ length: componentCount }, () => new Array(variableNames.length).fill(0)),
  };
}

/**
 * A fully empty RP state sized by count alone (no variable NAMES) — used by
 * `sigma1/index.ts`'s `carrySeason` to reset every team at a season
 * boundary (D-19: threshold variables don't carry across seasons, see file
 * header) and as the documented "nothing observed yet" baseline. `rpBeliefs`
 * starts as an empty record; individual variable beliefs are cold-started
 * lazily by `foldRpObservation` the first time each is actually folded,
 * mirroring how a fresh team's score beliefs are built per-component only
 * when `applyAllianceUpdate` (`sigma1/index.ts`) first touches it.
 */
export function emptyRpTeamState(variableCount: number, componentCount: number): RpTeamState {
  return {
    rpBeliefs: {},
    rpCovariance: emptyCovariance(variableCount),
    rpCrossCovariance: Array.from({ length: componentCount }, () => new Array(variableCount).fill(0)),
  };
}

/**
 * K_j = P_j / (sum P_i + R) — the identical formula `updateAllianceSum`
 * (`../kalman.js`) already applies internally to compute each teammate's
 * posterior, used here to attribute a per-team RP residual from a SHARED
 * alliance-sum observation (the same reasoning `../covariance.js`'s header
 * documents for the score side's `componentGains`). Duplicated rather than
 * imported from `sigma1/index.ts`'s own private `componentGains` — see
 * this file's header for why that import direction is forbidden.
 */
function rpTeammateGains(teammates: readonly TeamComponentBelief[], measurementNoise: number): number[] {
  const pooled = teammates.reduce((sum, t) => sum + t.variance, 0) + measurementNoise;
  if (pooled === 0) return teammates.map(() => 0);
  return teammates.map((t) => t.variance / pooled);
}

/**
 * EWMA fold of the outer product between a team's SCORE-component residual
 * vector (length C) and its RP threshold-variable residual vector (length
 * T) — an asymmetric C x T matrix, never square, so `../covariance.js`'s
 * `ewmaCovariance` (which assumes ONE residual vector indexes both the row
 * and column dimension) cannot be reused directly for this fold; this is a
 * plain EWMA of the raw outer product at the SAME `params.covEwmaAlpha`
 * rate `rpCovariance`'s own fold uses, with no diagonal-shrinkage step
 * (shrinkage-toward-diagonal has no meaning for a non-square matrix with no
 * diagonal in the square sense).
 */
function ewmaCrossCovariance(
  prior: readonly (readonly number[])[],
  scoreResidual: readonly number[],
  rpResidual: readonly number[],
  alpha: number
): number[][] {
  return scoreResidual.map((c, i) => rpResidual.map((t, j) => (1 - alpha) * (prior[i]?.[j] ?? 0) + alpha * c * t));
}

export interface RpFoldInput {
  /** Every team's PRE-this-match RP state (structurally `Sigma1State.teams`, read-only). */
  readonly teams: ReadonlyMap<string, RpFoldableTeamState>;
  readonly league: RpLeague;
  readonly ruleModule: RpRuleModule;
  /** Rating-eligible teammates for this alliance (surrogates already excluded — `ratingEligibleTeams`, `sigma1/index.ts`'s existing caller convention). */
  readonly allianceTeams: readonly string[];
  /** This alliance's OBSERVED threshold-variable SUMS (`RpParsedResult.thresholdVariables`), one scalar per name — the alliance-level total the Kalman fold distributes credit for across teammates, mirroring the score side's `observed: ParsedComponents`. */
  readonly observedThresholdVariables: Readonly<Record<string, number>>;
  /**
   * This alliance's per-team SCORE-component gain-weighted residual vector
   * (length = `componentOrder.length`, ordered by `componentOrder`) —
   * ALREADY computed by `sigma1/index.ts`'s `applyAllianceUpdate` for this
   * same match, threaded through here rather than recomputed, since
   * `rpCrossCovariance`'s whole purpose is correlating the score residual
   * this match already produced against the RP residual this fold is about
   * to produce.
   */
  readonly scoreResidualsByTeam: ReadonlyMap<string, readonly number[]>;
  readonly componentCount: number;
  readonly eventKey: string;
  readonly params: Sigma1Params;
}

export interface RpFoldResult {
  /** Only the teams actually touched by this fold (`allianceTeams`) — the caller merges these RP-only fields back into its own full team-state map, exactly as `sigma1/index.ts` already threads `applyAllianceUpdate`'s score-only result forward. */
  readonly teams: ReadonlyMap<string, RpTeamState>;
  readonly league: RpLeague;
}

/**
 * Applies one alliance's observed threshold-variable vector to its
 * rating-eligible teammates: process noise first (mirroring the score
 * side's event-boundary bump, D-07, using the SAME `lastEventKey` read from
 * the caller's `RpFoldableTeamState`), then a per-threshold-variable
 * `updateAllianceSum` Kalman update (`../kalman.js`, unchanged), then
 * folding each team's gain-weighted RP residual into `rpCovariance` and,
 * against the ALREADY-COMPUTED score residual, into `rpCrossCovariance`
 * (D-11). Returns new maps; never mutates `input.teams`/`input.league`.
 */
export function foldRpObservation(input: RpFoldInput): RpFoldResult {
  const { teams, league, ruleModule, allianceTeams, observedThresholdVariables, scoreResidualsByTeam, componentCount, eventKey, params } =
    input;

  if (allianceTeams.length === 0) {
    // Every team on this alliance was a surrogate — nothing to attribute, a
    // genuine no-op, mirroring `sigma1/index.ts`'s `applyAllianceUpdate` and
    // `updateAllianceSum`'s own empty-teammates branch.
    return { teams: new Map(), league };
  }

  assertFiniteThresholdVariables(observedThresholdVariables, `RP fold, event ${eventKey}`);

  const variableNames = ruleModule.thresholdVariables.map((v) => v.name);
  const variableCount = variableNames.length;

  const workingTeams = new Map<string, RpTeamState>();
  for (const team of allianceTeams) {
    const existing = teams.get(team);
    if (existing) {
      const sameEvent = existing.lastEventKey === null || existing.lastEventKey === eventKey;
      const q = sameEvent ? params.processNoiseWithinEvent : params.processNoiseEventBoundary;
      const rpBeliefs: Record<string, TeamComponentBelief> = {};
      for (const name of variableNames) {
        const belief = existing.rpBeliefs[name] ?? {
          mean: rpLeagueMeanFor(league, name, RP_COLD_START_VARIABLE_MEAN),
          variance: params.coldStartConsistencyVariance,
        };
        rpBeliefs[name] = applyProcessNoise(belief, q);
      }
      workingTeams.set(team, { rpBeliefs, rpCovariance: existing.rpCovariance, rpCrossCovariance: existing.rpCrossCovariance });
    } else {
      workingTeams.set(team, coldStartRpTeamState(variableNames, componentCount, league, params));
    }
  }

  const nextBeliefsByTeam = new Map<string, Record<string, TeamComponentBelief>>();
  const rpResidualsByTeam = new Map<string, number[]>();
  for (const team of allianceTeams) {
    nextBeliefsByTeam.set(team, { ...workingTeams.get(team)!.rpBeliefs });
    rpResidualsByTeam.set(team, new Array(variableCount).fill(0));
  }

  let nextRpVariableMean = { ...league.rpVariableMean };

  variableNames.forEach((name, variableIndex) => {
    const teammateBeliefs = allianceTeams.map((team) => workingTeams.get(team)!.rpBeliefs[name]!);
    const observedSum = observedThresholdVariables[name] ?? 0;
    // R for this alliance-variable observation: the SUM of each teammate's
    // own current RP-variable variance estimate — the diagonal of
    // `rpCovariance` at [variableIndex][variableIndex], which (per
    // `ewmaCovariance`'s own EWMA-of-squared-residual fold) plays the exact
    // role `consistency[name]` plays for the score side. Starts at 0 for a
    // cold-started team (an empty `rpCovariance` matrix), which is fine:
    // `updateAllianceSum`'s pooled variance is still positive from the
    // teammates' own belief variance, so no degenerate 0/0 division occurs.
    const measurementNoise = allianceTeams.reduce((sum, team) => {
      const cov = workingTeams.get(team)!.rpCovariance;
      return sum + (cov[variableIndex]?.[variableIndex] ?? 0);
    }, 0);

    const updated = updateAllianceSum(teammateBeliefs, observedSum, measurementNoise);
    const gains = rpTeammateGains(teammateBeliefs, measurementNoise);
    const predictedSum = teammateBeliefs.reduce((sum, t) => sum + t.mean, 0);
    const innovation = observedSum - predictedSum;
    const observedShare = observedSum / allianceTeams.length;

    allianceTeams.forEach((team, i) => {
      nextBeliefsByTeam.get(team)![name] = updated[i]!;
      rpResidualsByTeam.get(team)![variableIndex] = gains[i]! * innovation;
    });

    let meanStats = nextRpVariableMean[name] ?? emptyExpandingStats();
    for (let i = 0; i < allianceTeams.length; i++) meanStats = foldObservation(meanStats, observedShare);
    nextRpVariableMean = { ...nextRpVariableMean, [name]: meanStats };
  });

  const resultTeams = new Map<string, RpTeamState>();
  for (const team of allianceTeams) {
    const working = workingTeams.get(team)!;
    const rpResidualVector = rpResidualsByTeam.get(team)!;
    const scoreResidualVector = scoreResidualsByTeam.get(team) ?? new Array(componentCount).fill(0);

    resultTeams.set(team, {
      rpBeliefs: nextBeliefsByTeam.get(team)!,
      rpCovariance: ewmaCovariance(working.rpCovariance, rpResidualVector, params.covEwmaAlpha, params.covShrinkage),
      rpCrossCovariance: ewmaCrossCovariance(working.rpCrossCovariance, scoreResidualVector, rpResidualVector, params.covEwmaAlpha),
    });
  }

  return { teams: resultTeams, league: { rpVariableMean: nextRpVariableMean } };
}

/** For one alliance: predicted RP-relevant moments, ready for `rp/distribution.ts`'s joint Monte Carlo draw. */
export interface AllianceRpMoments {
  /** Threshold-variable names, in `ruleModule.thresholdVariables` order — every other array/matrix here is indexed against this order. */
  readonly variableNames: readonly string[];
  /** Alliance-level mean vector over threshold variables (sum across teammates, D-06's independent-teams assumption). */
  readonly meanVector: readonly number[];
  /** T x T alliance-level variance block over threshold variables (sum across teammates' own `rpCovariance`). */
  readonly varianceBlock: readonly (readonly number[])[];
  /** The alliance's predicted SCORE mean — taken from the value `sigma1/index.ts`'s `predict` already computes, passed in, never recomputed here. */
  readonly scoreMean: number;
  /** The alliance's predicted SCORE variance (this alliance's own posterior + covariance sum, NOT the combined-both-alliances `Prediction.variance`) — also passed in, never recomputed here. */
  readonly scoreVariance: number;
  /** Length-T cross-covariance vector between the alliance's total score and each threshold variable — D-11's correlation, read from the data (`rpCrossCovariance`'s learned structure) rather than asserted. */
  readonly scoreCrossCovariance: readonly number[];
}

/**
 * Builds one alliance's `AllianceRpMoments` from its teammates' current RP
 * state. A team with no state yet (never observed) contributes nothing —
 * matches `sigma1/index.ts`'s `allianceComponentPredictions`'s own
 * `if (belief)` skip for the identical situation on the score side.
 */
export function predictAllianceRpMoments(
  teams: ReadonlyMap<string, RpTeamState>,
  allianceTeams: readonly string[],
  ruleModule: RpRuleModule,
  allianceScoreMean: number,
  allianceScoreVariance: number
): AllianceRpMoments {
  const variableNames = ruleModule.thresholdVariables.map((v) => v.name);
  const T = variableNames.length;
  const meanVector = new Array(T).fill(0);
  const varianceBlock: number[][] = Array.from({ length: T }, () => new Array(T).fill(0));
  const scoreCrossCovariance = new Array(T).fill(0);

  for (const team of allianceTeams) {
    const teamState = teams.get(team);
    if (!teamState) continue;

    variableNames.forEach((name, i) => {
      meanVector[i] += teamState.rpBeliefs[name]?.mean ?? 0;
    });
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < T; j++) {
        varianceBlock[i]![j]! += teamState.rpCovariance[i]?.[j] ?? 0;
      }
    }
    // "Each teammate's rpCrossCovariance column sums" (plan 03-03 Task 2):
    // for threshold variable t, sum this teammate's C rows at column t --
    // Cov(sum_c residual_c, residual_t) = sum_c Cov(residual_c, residual_t)
    // by bilinearity, i.e. this teammate's covariance between ITS OWN total
    // score and threshold variable t. Summed across teammates below under
    // the independent-teams assumption.
    for (let t = 0; t < T; t++) {
      let columnSum = 0;
      for (const row of teamState.rpCrossCovariance) columnSum += row[t] ?? 0;
      scoreCrossCovariance[t]! += columnSum;
    }
  }

  return {
    variableNames,
    meanVector,
    varianceBlock,
    scoreMean: allianceScoreMean,
    scoreVariance: allianceScoreVariance,
    scoreCrossCovariance,
  };
}
