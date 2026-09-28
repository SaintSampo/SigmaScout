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
 *
 * THE RP COLD-TEAM PRIOR (`rpColdPrior`), the production model since SPR
 * 9.0.0. Without it a team with no history for a variable contributes a zero
 * mean and no variance, so a fully cold alliance is priced from a degenerate
 * belief. With it such a team is priced from the season-to-date league summary
 * of that variable, and a one-observation team takes the league variance in
 * place of 0. It is not a blend: no second model's output is mixed in, and a
 * team with its own history is untouched. It is the RP analogue of SPR's
 * treatment of an unseen team. The summary rides the spr league row (shape
 * 17), so the live Worker resumes it with the prior on. This constructor still
 * needs the explicit opt-in (its own unit tests measure the pre-9.0.0 model);
 * `SigmaScoutLayer` is the policy point that turns it on by default. The bar it
 * passed is pre-registered in
 * `.planning/quick/260928-n6i-fix-the-early-season-rp-bonus-cold-start/260928-n6i-PREREG.md`.
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

/** One team's beliefs as a plain record of deep copies, in the team's own variable order. */
function copyBeliefs(byVariable: ReadonlyMap<string, VariableBelief>): Record<string, RpVariableBelief> {
  const record: Record<string, RpVariableBelief> = {};
  for (const [name, belief] of byVariable) record[name] = { ...belief };
  return record;
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

/** Construction switches for `RpMomentsAccumulator`. Every one is inert when absent. */
export interface RpMomentsAccumulatorOptions {
  /**
   * The RP cold-team prior (260928-n6i-PREREG.md), the production model since
   * SPR 9.0.0; at this low level it is on only when `true` (`SigmaScoutLayer`
   * defaults it on). On: a team with no belief for a variable is priced from
   * the season's population summary of that variable, and a team whose belief
   * has no variance yet takes the population's. Absent or `false`: the
   * pre-9.0.0 model.
   */
  readonly rpColdPrior?: boolean;
}

/**
 * The season-to-date league summary of one threshold variable: an
 * unweighted, undecayed Welford running count, mean and sum of squared
 * deviations over every finite ALLIANCE value `fold` has folded.
 */
interface PopulationSummary {
  n: number;
  mean: number;
  m2: number;
}

/** One threshold variable's population summary as it rides the D1 league row: a Welford count, mean and sum of squared deviations. */
export interface RpPopulationVariableState {
  readonly n: number;
  readonly mean: number;
  readonly m2: number;
}

/**
 * The serializable form of one season's population summary. Three numbers
 * per threshold variable, so it rides the D1 LEAGUE row and cannot scale with
 * team count. Season-tagged: another season's summary never resumes.
 */
export interface RpPopulationState {
  readonly season: number;
  readonly variables: Readonly<Record<string, RpPopulationVariableState>>;
}

/** A valid population entry: a non-negative integer count, a finite mean and a finite, non-negative sum of squares. */
function isPopulationEntry(entry: unknown): entry is RpPopulationVariableState {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
  const { n, mean, m2 } = entry as { n?: unknown; mean?: unknown; m2?: unknown };
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return false;
  if (typeof mean !== "number" || !Number.isFinite(mean)) return false;
  if (typeof m2 !== "number" || !Number.isFinite(m2) || m2 < 0) return false;
  return true;
}

/**
 * Walk-forward per-team beliefs over one season's threshold variables. Read a
 * match's moments before folding it in (predict-before-update). With the prior
 * off, a team with no history contributes a zero mean and no variance. With
 * the RP cold-team prior on (the production model since SPR 9.0.0), it
 * contributes the season-to-date league summary instead (see the module
 * header); a team with its own history is untouched either way.
 */
export class RpMomentsAccumulator {
  readonly #ruleModule: RpRuleModule;
  readonly #byTeam = new Map<string, Map<string, VariableBelief>>();
  readonly #rpColdPrior: boolean;
  /** Per variable, the population summary; written only with the knob on, so off it stays empty. */
  readonly #population = new Map<string, PopulationSummary>();

  constructor(ruleModule: RpRuleModule, options?: RpMomentsAccumulatorOptions) {
    this.#ruleModule = ruleModule;
    this.#rpColdPrior = options?.rpColdPrior === true;
  }

  /** Whether the RP cold-team prior is on (260928-n6i-PREREG.md; production since SPR 9.0.0). */
  get rpColdPrior(): boolean {
    return this.#rpColdPrior;
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
      // Knob off: no summary, so no cold or thin fill below, and every statement
      // runs exactly as the incumbent's.
      const population = this.#rpColdPrior ? this.#population.get(name) : undefined;
      // The per-team variance term `v / r²`, which the `r² / contributing` scaling
      // below turns back into the alliance variance `v`. Defined only once the
      // summary has an unbiased variance (n >= 2).
      const coldVarianceTerm =
        population !== undefined && population.n >= 2 && roster.length > 0
          ? Math.max(0, population.m2 / (population.n - 1)) / (roster.length * roster.length)
          : undefined;
      let mean = 0;
      let varianceSum = 0;
      let contributing = 0;
      for (const teamKey of roster) {
        const belief = this.#byTeam.get(teamKey)?.get(name);
        if (belief === undefined) {
          // Cold team (prior on): the league's mean share, and its variance once defined.
          if (population !== undefined && population.n >= 1) {
            mean += population.mean / roster.length;
            if (coldVarianceTerm !== undefined) {
              varianceSum += coldVarianceTerm;
              contributing++;
            }
          }
          continue;
        }
        mean += belief.mean;
        // Thin team (prior on): no variance of its own yet, so the league's.
        varianceSum += varianceOf(belief) ?? coldVarianceTerm ?? 0;
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
      if (this.#rpColdPrior) {
        // Prior on: the league summary, once per variable per alliance.
        let population = this.#population.get(name);
        if (population === undefined) {
          population = { n: 0, mean: 0, m2: 0 };
          this.#population.set(name, population);
        }
        population.n += 1;
        const delta = allianceValue - population.mean;
        population.mean += delta / population.n;
        population.m2 += delta * (allianceValue - population.mean);
      }
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
    for (const [teamKey, byVariable] of this.#byTeam) out.set(teamKey, copyBeliefs(byVariable));
    return out;
  }

  /**
   * A new accumulator holding deep copies of `teamKeys`' beliefs only, as they
   * stand now, plus the knob and (with it on) deep copies of the season's
   * population summary. `momentsFor` and `hasHistory` read nothing but the
   * teams they are given and, with the knob on, that summary, which the copy
   * carries. So for any roster inside `teamKeys` the copy answers exactly as
   * this accumulator does at this instant, and later folds here never reach it.
   */
  snapshotFor(teamKeys: Iterable<string>): RpMomentsAccumulator {
    const copy = new RpMomentsAccumulator(this.#ruleModule, this.#rpColdPrior ? { rpColdPrior: true } : undefined);
    for (const teamKey of teamKeys) {
      const byVariable = this.#byTeam.get(teamKey);
      if (byVariable === undefined || copy.#byTeam.has(teamKey)) continue;
      copy.#byTeam.set(teamKey, new Map(Object.entries(copyBeliefs(byVariable))));
    }
    for (const [name, population] of this.#population) copy.#population.set(name, { ...population });
    return copy;
  }

  /**
   * The season's population summary for the D1 seed and the live Worker's
   * write-back, or `undefined` with the prior off (there is no summary to
   * carry). One entry per declared threshold variable in rule-module order; a
   * variable never folded reads as zeros, which `momentsFor` and `fold` treat
   * exactly as a missing entry.
   */
  populationState(): RpPopulationState | undefined {
    if (!this.#rpColdPrior) return undefined;
    const variables: Record<string, RpPopulationVariableState> = {};
    for (const name of this.variableNames) {
      const population = this.#population.get(name);
      variables[name] = { n: population?.n ?? 0, mean: population?.mean ?? 0, m2: population?.m2 ?? 0 };
    }
    return { season: this.#ruleModule.season, variables };
  }

  /**
   * Rebuilds an accumulator from `beliefsByTeam()`'s output (the live Worker's
   * resume path). Keeps only the variable names `ruleModule` declares, so a
   * seed from another season's rules cannot carry a stale variable.
   *
   * With a third argument the rebuilt accumulator runs the RP cold-team prior,
   * and `population` (`populationState()`'s output, carried on the spr league
   * row since shape 17) restores the season's population summary. The live
   * Worker always passes it. The summary is all-or-nothing: `undefined`,
   * another season's summary, or any malformed entry resumes an EMPTY
   * population with the prior still on, mirroring
   * `RpMeanShiftAccumulator.fromState`. A variable name the rule module does
   * not declare is skipped. With no third argument the prior is off, as for
   * the pre-9.0.0 model.
   */
  static fromBeliefs(
    ruleModule: RpRuleModule,
    beliefs: ReadonlyMap<string, RpTeamBeliefs>,
    coldPrior?: { readonly population: RpPopulationState | undefined }
  ): RpMomentsAccumulator {
    const accumulator = new RpMomentsAccumulator(ruleModule, coldPrior !== undefined ? { rpColdPrior: true } : undefined);
    const known = new Set(ruleModule.thresholdVariables.map((v) => v.name));
    for (const [teamKey, record] of beliefs) {
      const byVariable = new Map<string, VariableBelief>();
      for (const [name, belief] of Object.entries(record)) {
        if (!known.has(name)) continue;
        byVariable.set(name, { ...belief });
      }
      if (byVariable.size > 0) accumulator.#byTeam.set(teamKey, byVariable);
    }
    if (coldPrior !== undefined) accumulator.#restorePopulation(coldPrior.population, known);
    return accumulator;
  }

  /** All-or-nothing restore of a population summary; any defect leaves the population empty. */
  #restorePopulation(population: RpPopulationState | undefined, known: ReadonlySet<string>): void {
    const raw = population as unknown;
    if (raw === null || typeof raw !== "object") return;
    const { season, variables } = raw as { season?: unknown; variables?: unknown };
    if (season !== this.#ruleModule.season) return;
    if (variables === null || typeof variables !== "object" || Array.isArray(variables)) return;
    const restored = new Map<string, PopulationSummary>();
    for (const [name, entry] of Object.entries(variables as Record<string, unknown>)) {
      if (!isPopulationEntry(entry)) return;
      if (!known.has(name)) continue;
      restored.set(name, { n: entry.n, mean: entry.mean, m2: entry.m2 });
    }
    for (const [name, summary] of restored) this.#population.set(name, summary);
  }

  /** True once this team has at least one observation of every tracked variable — the caller's cue that a prediction rests on real history. */
  hasHistory(teamKey: string): boolean {
    const byVariable = this.#byTeam.get(teamKey);
    if (byVariable === undefined) return false;
    return this.variableNames.every((name) => (byVariable.get(name)?.weight ?? 0) > 0);
  }
}
