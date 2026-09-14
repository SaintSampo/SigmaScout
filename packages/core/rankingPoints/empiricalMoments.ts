/**
 * Per-team beliefs over a season's RP threshold variables, learned from
 * observed results alone (no model state, no algorithm import). Which
 * algorithms publish ranking points is decided by `publishesRankingPoints` in
 * `packages/harness/sigmaScore.ts`.
 *
 * Threshold variables are observed at alliance level and FRC records no
 * per-robot breakdown, so a team's share is the even split
 * `value / rosterSize`, a noisy estimate that absorbs partners' contributions.
 *
 * Three deliberate simplifications, each making the distribution narrower
 * and less correlated than reality (bonus odds pulled toward the extremes):
 *   1. Diagonal `varianceBlock`: no covariance between threshold variables; a
 *      stable per-team cross-term needs more matches than a season has.
 *   2. Zero `scoreCrossCovariance`, for the same reason.
 *   3. Variance is about the team's own mean, with the effective-sample
 *      denominator `W − W2/W`, which is 0 after one observation, so one
 *      observation yields no variance rather than a fake zero.
 */

import type { AllianceRpMoments } from "./moments.js";
import type { RpRuleModule } from "./constants.js";

/**
 * Half-life in matches: an observation six matches old counts half as much as
 * the newest. Measured walk-forward: 6 tops a plateau spanning roughly 4 to 12.
 */
export const RP_MOMENTS_HALF_LIFE_MATCHES = 6;

const DECAY = 0.5 ** (1 / RP_MOMENTS_HALF_LIFE_MATCHES);

/** One team's running belief about one threshold variable, persisted to D1 as a `sigmascoutRp` passenger. */
export interface RpVariableBelief {
  weight: number;
  weightSquares: number;
  mean: number;
  m2: number;
}

/** One team's beliefs across every threshold variable this season tracks, keyed by variable name. */
export type RpTeamBeliefs = Readonly<Record<string, RpVariableBelief>>;

type VariableBelief = RpVariableBelief;

function emptyBelief(): VariableBelief {
  return { weight: 0, weightSquares: 0, mean: 0, m2: 0 };
}

/**
 * West's weighted incremental update, decaying every prior weight first.
 * Unlike the naive `E[x²] − E[x]²`, it never subtracts two large nearly-equal numbers.
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
 * Walk-forward per-team beliefs over one season's threshold variables. Read a
 * match's moments before folding it in (predict-before-update). A team with no
 * history contributes a zero mean and no variance.
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

  /** One alliance's moments from history so far. `scoreMean` and `scoreVariance` come from the algorithm; this module never estimates a score. */
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
      // Undo the even-split shrinkage: a belief folded from `allianceValue / rosterSize`
      // estimates the alliance variance over `rosterSize²`. Each contributing team implies
      // `rosterSize² · Var(belief)`, averaged over the teams that have one, so a partial
      // roster does not under-count. The mean needs no correction.
      variances.push(contributing > 0 ? (varianceSum * roster.length * roster.length) / contributing : 0);
    }

    // Diagonal by construction (see the module header).
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
   * Folds one alliance's observed threshold variables into each of its teams
   * as an even split. A non-finite observation is skipped, since a coerced
   * value would corrupt every later prediction for that team.
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

  /**
   * Every team's raw running state (not `momentsFor`'s derived output), for
   * the D1 seed the live Worker resumes from. Anything less and the live pmf
   * silently diverges from the offline publisher's. Returns deep copies.
   */
  beliefsByTeam(): ReadonlyMap<string, RpTeamBeliefs> {
    const out = new Map<string, RpTeamBeliefs>();
    for (const [teamKey, byVariable] of this.#byTeam) {
      const record: Record<string, RpVariableBelief> = {};
      for (const [name, belief] of byVariable) record[name] = { ...belief };
      out.set(teamKey, record);
    }
    return out;
  }

  /**
   * Rebuilds an accumulator from `beliefsByTeam()`'s output (the live Worker's
   * resume path). Keeps only the variable names `ruleModule` declares, so a
   * seed from another season's rules cannot carry a stale variable.
   */
  static fromBeliefs(ruleModule: RpRuleModule, beliefs: ReadonlyMap<string, RpTeamBeliefs>): RpMomentsAccumulator {
    const accumulator = new RpMomentsAccumulator(ruleModule);
    const known = new Set(ruleModule.thresholdVariables.map((v) => v.name));
    for (const [teamKey, record] of beliefs) {
      const byVariable = new Map<string, VariableBelief>();
      for (const [name, belief] of Object.entries(record)) {
        if (!known.has(name)) continue;
        byVariable.set(name, { ...belief });
      }
      if (byVariable.size > 0) accumulator.#byTeam.set(teamKey, byVariable);
    }
    return accumulator;
  }

  /** True once this team has at least one observation of every tracked variable — the caller's cue that a prediction rests on real history. */
  hasHistory(teamKey: string): boolean {
    const byVariable = this.#byTeam.get(teamKey);
    if (byVariable === undefined) return false;
    return this.variableNames.every((name) => (byVariable.get(name)?.weight ?? 0) > 0);
  }
}
