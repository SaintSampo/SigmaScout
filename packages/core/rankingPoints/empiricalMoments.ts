/**
 * Per-team beliefs over a season's RP THRESHOLD VARIABLES, learned from
 * observed results alone.
 *
 * This is the adapter VPR's retirement left missing. `distribution.ts` needs an
 * `AllianceRpMoments` per alliance; Sigma1 produced one from its own Kalman
 * state (`sigma1/rp/state.ts`), which is exactly why ranking points died with
 * it. This module produces the same contract from NOTHING BUT PAST RESULTS —
 * no model state, no per-team rating, no algorithm import — so every algorithm
 * gets ranking points, including OPR and EPA, which model no uncertainty at
 * all.
 *
 * It is a level-2 SigmaScout feature in exactly the sense `swingFactor.ts` is,
 * and it is built the same way: a team's share of an alliance-level
 * observation, recency-weighted, folded walk-forward.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS OBSERVED, AND HOW IT IS SPLIT
 * ---------------------------------------------------------------------------
 *
 * A season's rule module reports threshold variables at ALLIANCE level — for
 * 2026, `hubTotalCount` (a raw fuel count) and `totalTowerPoints`. FRC records
 * no per-robot breakdown (this project's Assumption A1), so a team's share is
 * the even split `value / rosterSize`, the identical inference
 * `swingFactor.ts` makes for score residuals and with the identical caveat: it
 * absorbs partners' contributions and is a genuinely noisy per-robot estimate.
 *
 * An alliance's predicted mean is then the sum of its three teams' means, and
 * its variance the sum of their variances. That summation is D-06's
 * independent-teams assumption, and it is the reason the covariance block this
 * module emits is DIAGONAL.
 *
 * ---------------------------------------------------------------------------
 * THE THREE ASSUMPTIONS, MADE DELIBERATELY
 * ---------------------------------------------------------------------------
 *
 * `moments.ts` warns that a diagonal block and a zero cross-covariance are
 * decisions rather than defaults. This module makes both, on purpose, and says
 * why rather than inheriting them silently:
 *
 *   1. DIAGONAL `varianceBlock` — no covariance BETWEEN threshold variables.
 *      For 2026 that claims `hubTotalCount` and `totalTowerPoints` are
 *      uncorrelated, which is very likely false: an alliance good at one is
 *      probably good at the other, so the joint draw will understate how often
 *      an alliance clears BOTH thresholds together and overstate how often it
 *      splits them. Chosen because estimating a stable cross-term per team
 *      needs far more observations than a team plays in a season, and a noisy
 *      off-diagonal is worse than an honest zero.
 *
 *   2. ZERO `scoreCrossCovariance` — no correlation between the alliance's
 *      predicted SCORE and its threshold variables. Also likely false for the
 *      same reason. Same justification, and the same direction of error.
 *
 *   3. VARIANCE IS ABOUT THE TEAM'S OWN MEAN, not about zero, and uses the
 *      same effective-sample denominator `swingFactor.ts` documents — so one
 *      observation yields no variance rather than a fake zero.
 *
 * All three make the predicted distribution NARROWER and less correlated than
 * reality. The published effect is bonus probabilities pulled toward the
 * extremes. That is a known bias with a known sign, which is the condition
 * this project accepts a simplification under.
 */

import type { AllianceRpMoments } from "./moments.js";
import type { RpRuleModule } from "./constants.js";

/** Matches `swingFactor.ts` — the same 6-match half-life, measured there. */
export const RP_MOMENTS_HALF_LIFE_MATCHES = 6;

const DECAY = 0.5 ** (1 / RP_MOMENTS_HALF_LIFE_MATCHES);

/** One team's running belief about one threshold variable. */
interface VariableBelief {
  weight: number;
  weightSquares: number;
  mean: number;
  m2: number;
}

function emptyBelief(): VariableBelief {
  return { weight: 0, weightSquares: 0, mean: 0, m2: 0 };
}

/**
 * West's weighted incremental update, decaying every prior weight first.
 * Numerically stable — it never subtracts two large nearly-equal numbers,
 * which is the failure the naive `E[x²] − E[x]²` form suffers on the large,
 * nearly-equal values a points threshold produces.
 */
function fold(belief: VariableBelief, x: number): void {
  const decayedWeight = DECAY * belief.weight;
  const decayedM2 = DECAY * belief.m2;
  const weight = decayedWeight + 1;
  const delta = x - belief.mean;
  const mean = belief.mean + delta / weight;
  belief.weight = weight;
  belief.weightSquares = DECAY * DECAY * belief.weightSquares + 1;
  belief.mean = mean;
  belief.m2 = decayedM2 + delta * (x - mean);
}

/** Variance about the team's own mean, or `undefined` below an effective sample of one. */
function varianceOf(belief: VariableBelief): number | undefined {
  if (belief.weight <= 0) return undefined;
  const denominator = belief.weight - belief.weightSquares / belief.weight;
  if (denominator <= 0) return undefined;
  return Math.max(0, belief.m2 / denominator);
}

/**
 * Walk-forward per-team beliefs over one season's threshold variables.
 *
 * Read a match's moments BEFORE folding it in — the same predict-before-update
 * discipline the rest of this project runs on. A team with no history yet
 * contributes a zero mean and no variance, which is the honest cold start: the
 * alliance's predicted total is simply smaller and tighter than it will be once
 * the team has played.
 */
export class RpMomentsAccumulator {
  readonly #ruleModule: RpRuleModule;
  readonly #byTeam = new Map<string, Map<string, VariableBelief>>();

  constructor(ruleModule: RpRuleModule) {
    this.#ruleModule = ruleModule;
  }

  /** Every threshold-variable name this season tracks, in rule-module order. */
  get variableNames(): readonly string[] {
    return this.#ruleModule.thresholdVariables.map((v) => v.name);
  }

  /**
   * One alliance's moments from history SO FAR, ready for
   * `rpPmfForMatch`. `scoreMean` and `scoreVariance` come from whatever the
   * ALGORITHM predicted for this alliance — this module never estimates a
   * score.
   */
  momentsFor(roster: readonly string[], scoreMean: number, scoreVariance: number): AllianceRpMoments {
    const names = this.variableNames;
    const meanVector: number[] = [];
    const variances: number[] = [];

    for (const name of names) {
      let mean = 0;
      let varianceSum = 0;
      let contributing = 0;
      for (const teamKey of roster) {
        const belief = this.#byTeam.get(teamKey)?.get(name);
        if (belief === undefined) continue;
        mean += belief.mean;
        varianceSum += varianceOf(belief) ?? 0;
        contributing++;
      }
      meanVector.push(mean);
      // UNDO THE EVEN-SPLIT SHRINKAGE (fixed 2026-09-09; measured, see below).
      //
      // A team's belief is folded from `allianceValue / rosterSize`, so what it
      // estimates is not that robot's own contribution variance — it is the
      // WHOLE ALLIANCE's variance divided by `rosterSize²`, because the even
      // split carries the partners' variability too. Summing `rosterSize` of
      // them therefore lands on `Var(A)/rosterSize`, not `Var(A)`.
      //
      // Each contributing team implies `rosterSize² · Var(belief)` for the
      // alliance, so the alliance estimate is the AVERAGE of those implications
      // over the teams that actually have one. With a full roster that reduces
      // to `rosterSize × Σ Var(belief)`; with a partial roster it degrades
      // correctly instead of under-counting once for the missing team and again
      // for the shrinkage.
      //
      // The mean needs no such correction and gets none: `rosterSize` even
      // splits summed back reconstruct the alliance value exactly, which is why
      // this was easy to miss — the first moment was right the whole time.
      //
      // Measured before the fix, walk-forward over 488,076 (alliance, bonus)
      // observations across ten seasons: mean predicted 0.1131 against an
      // observed 0.3109. This shrinkage is one of three causes and the only
      // unintended one — the DIAGONAL block and the zero cross-covariance in
      // this module's header are deliberate and remain.
      variances.push(contributing > 0 ? (varianceSum * roster.length * roster.length) / contributing : 0);
    }

    // Diagonal by construction — see this module's header for why the
    // off-diagonals are deliberately zero rather than estimated badly.
    const varianceBlock = names.map((_, i) => names.map((__, j) => (i === j ? (variances[i] as number) : 0)));

    return {
      variableNames: names,
      meanVector,
      varianceBlock,
      scoreMean,
      scoreVariance,
      scoreCrossCovariance: names.map(() => 0),
    };
  }

  /**
   * Folds one alliance's OBSERVED threshold variables into each of its teams,
   * as an even split of the alliance value.
   *
   * A non-finite observation is skipped rather than folded — the same
   * discipline `swingFactor.ts` applies, and for the same reason: a coerced
   * value would quietly corrupt every later prediction for that team.
   */
  fold(roster: readonly string[], observedThresholdVariables: Readonly<Record<string, number>>): void {
    if (roster.length === 0) return;
    for (const name of this.variableNames) {
      const allianceValue = observedThresholdVariables[name];
      if (allianceValue === undefined || !Number.isFinite(allianceValue)) continue;
      const share = allianceValue / roster.length;
      for (const teamKey of roster) {
        let byVariable = this.#byTeam.get(teamKey);
        if (byVariable === undefined) {
          byVariable = new Map();
          this.#byTeam.set(teamKey, byVariable);
        }
        let belief = byVariable.get(name);
        if (belief === undefined) {
          belief = emptyBelief();
          byVariable.set(name, belief);
        }
        fold(belief, share);
      }
    }
  }

  /** True once this team has at least one observation of every tracked variable — the caller's cue that a prediction rests on real history. */
  hasHistory(teamKey: string): boolean {
    const byVariable = this.#byTeam.get(teamKey);
    if (byVariable === undefined) return false;
    return this.variableNames.every((name) => (byVariable.get(name)?.weight ?? 0) > 0);
  }
}
