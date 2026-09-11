/**
 * THE CLOSED FORM — replaces `distribution.ts`'s 4,000-draw joint Monte
 * Carlo with an EXACT analytic pmf: one marginal per threshold variable
 * (`marginals.ts`, 09-03), bonuses grouped by shared threshold variable and
 * enumerated from marginal CDFs, groups convolved into a bonus-only pmf,
 * and that pmf convolved with the win/tie outcome half.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS EXACT, NOT AN APPROXIMATION (D-08, 09-CONTEXT `<domain>`)
 * ---------------------------------------------------------------------------
 *
 * `empiricalMoments.ts`'s `momentsFor` builds a DIAGONAL `varianceBlock` and
 * an ALL-ZERO `scoreCrossCovariance` by construction — the joint the deleted
 * Monte Carlo sampled was already exactly independent. `distribution.ts`'s
 * Cholesky factor was therefore always a diagonal of standard deviations,
 * and its 4,000 correlated-looking draws were sampling independent normals.
 * A closed form over independent marginals is not an approximation of that
 * joint; it computes the same distribution the draws were estimating, with
 * the +/-0.008 of sampling noise the draws added simply gone. This module
 * ASSERTS that diagonal/zero precondition on every call
 * (`assertIndependencePrecondition` below) rather than assuming it — a
 * caller supplying a genuine, non-zero correlation (Sigma1's
 * `predictAllianceRpMoments` does exactly that, D-11) would have it silently
 * discarded by a function whose whole correctness argument depends on its
 * absence, so this module refuses that caller instead.
 *
 * ---------------------------------------------------------------------------
 * D-07 — THE HAND-COMPUTED TEST DEBT THIS MODULE OWES
 * ---------------------------------------------------------------------------
 *
 * D-07 declined the one-time Monte Carlo equivalence check that would have
 * been this phase's strongest correctness evidence, and named hand-computed
 * unit tests as the required mitigation instead. `analyticPmf.test.ts` and
 * `analyticPmf.seasons.test.ts` carry that debt: every expected value in
 * them was computed from this module's own specification at PLANNING time,
 * never produced by running this file. The single highest-risk computation
 * in the whole phase lives here — 2026's `energized`/`supercharged` pair
 * both threshold `hubTotalCount`, and `SUPERCHARGED_THRESHOLD[tier] >=
 * ENERGIZED_THRESHOLD[tier]` at every tier, so supercharged structurally
 * IMPLIES energized. Treating the pair as independent Bernoulli events
 * understates `P(both)` — the nested-threshold interval enumeration below
 * (`groupContribution`'s `nestedSameVariable` branch) exists specifically to
 * get this right, and the test suite asserts the correct answer is NOT the
 * independent product.
 *
 * ---------------------------------------------------------------------------
 * D-06 — `RpLayerConfig` IS TEMPORARY SCAFFOLDING, NOT PERMANENT (see 09-06)
 * ---------------------------------------------------------------------------
 *
 * `RpLayerConfig` structurally resembles `sigma1/linkFunctions.ts`'s
 * `WinProbMode` (a resolved-once config set threaded through a prediction
 * path) but is NOT the same kind of thing: `WinProbMode` is permanently
 * multi-valued by design, while `RpLayerConfig` exists ONLY until 09-06
 * measures its three real branches against 09-01's frozen baseline. As of
 * 09-05, all three are LANDED and independently selectable — `winSource:
 * "p-red-win"` (Task 1, D-13), `tieModel: "discrete-margin"` (Task 2,
 * D-14), `marginal: "negative-binomial"` (Task 3, D-01) — but the
 * PRODUCTION DEFAULT still resolves every field to its legacy member (see
 * `RP_LAYER_CONFIG_DEFAULT` below). Once 09-06's measurement publishes, it
 * collapses this to ONE hardcoded path, deletes the losing branches, and
 * removes this config surface entirely. Adding a fourth field, or a
 * consumer outside the RP layer, is what this notice exists to stop — see
 * the removal notice beside the type declaration below too.
 */
import type { CompLevel } from "../algorithms/types.js";
import type {
  BonusPredicate,
  EventTier,
  MarginalFamily,
  RpRuleModule,
  RpThresholdClause,
  RpThresholdVariable,
} from "./constants.js";
import { eventTierFor, isBonusRpCompLevel, resolveRpThreshold } from "./constants.js";
import type { AllianceRpMoments } from "./moments.js";
import type { FittedMarginal } from "./marginals.js";
import {
  fitAllianceMarginals,
  fitMarginal,
  poissonBinomialAtLeast,
  probAtLeast,
  probAtMost,
  standardNormalCdf,
} from "./marginals.js";

// ---------------------------------------------------------------------------
// RpLayerConfig (D-05) — inert defaults that reproduce today's model exactly.
// ---------------------------------------------------------------------------

/** The alliance-score comparison `matchOutcomeDistribution` uses. `"p-red-win"` (D-13) is 09-05's. */
export type RpWinSource = "score-draw" | "p-red-win";

/** How a tie's probability is modelled. `"discrete-margin"` (D-14) is 09-05's. */
export type RpTieModel = "continuous-equality" | "discrete-margin";

/**
 * REMOVAL NOTICE (D-06, see also this file's header): this type is
 * deliberately TEMPORARY. As of 09-05 all three real branches are landed
 * (`winSource: "p-red-win"`, `tieModel: "discrete-margin"`, `marginal:
 * "negative-binomial"`) and 09-06 measures them; at that point 09-06
 * collapses this whole config surface to one hardcoded path and deletes the
 * losing branches. Do not add a fourth field, and do not let a consumer
 * outside the RP layer depend on it.
 */
export interface RpLayerConfig {
  readonly winSource: RpWinSource;
  readonly tieModel: RpTieModel;
  readonly marginal: MarginalFamily;
}

/** The inert default (D-10's revert target): reproduces today's model exactly. */
export const RP_LAYER_CONFIG_DEFAULT: RpLayerConfig = {
  winSource: "score-draw",
  tieModel: "continuous-equality",
  marginal: "gaussian",
};

/** A self-describing label for an `RpLayerConfig` — read by 09-06 to decide what an attribution arm measured. */
export function describeRpLayerConfig(config: RpLayerConfig): string {
  return `winSource=${config.winSource}, tieModel=${config.tieModel}, marginal=${config.marginal}`;
}

/**
 * Throws for every `RpLayerConfig` value not yet implemented anywhere in the
 * tree — a config that claims a model it did not run is worse than one that
 * refuses (T-09-04-04). The default value never throws. `winSource:
 * "p-red-win"` (09-05 Task 1, D-13) no longer throws as of this plan;
 * `tieModel`/`marginal` still refuse their non-default members until 09-05
 * Tasks 2/3 land the corresponding branch.
 */
export function assertSupportedRpLayerConfig(config: RpLayerConfig): void {
  if (config.winSource !== "score-draw" && config.winSource !== "p-red-win") {
    throw new Error(
      `analyticRpPmf: RpLayerConfig.winSource "${config.winSource}" is not implemented — no plan has shipped this branch`
    );
  }
  if (config.tieModel !== "continuous-equality") {
    throw new Error(
      `analyticRpPmf: RpLayerConfig.tieModel "${config.tieModel}" is not yet implemented (09-05 Task 2, D-14)`
    );
  }
  if (config.marginal !== "gaussian") {
    throw new Error(
      `analyticRpPmf: RpLayerConfig.marginal "${config.marginal}" is not yet implemented (09-05 Task 3, D-01)`
    );
  }
}

/**
 * `config.marginal === "gaussian"` (the inert default): every variable is
 * fitted Gaussian regardless of what it declares — one field change reverts
 * the whole marginal swap without editing 34 declarations (D-10). Otherwise
 * each variable is fitted with its own declared family. Today both sides
 * agree (config gaussian, all 34 declarations gaussian), so this is inert;
 * `assertSupportedRpLayerConfig` rejects the non-default branch in THIS
 * plan, so it is written and documented now but unreachable until 09-05.
 */
export function resolveMarginalFamily(declared: MarginalFamily, config: RpLayerConfig): MarginalFamily {
  return config.marginal === "gaussian" ? "gaussian" : declared;
}

// ---------------------------------------------------------------------------
// convolvePmf — plain polynomial multiplication, the one convolution routine
// every step below (and 09-09's rung-1 N-fold season-total convolution) uses.
// ---------------------------------------------------------------------------

export function convolvePmf(a: readonly number[], b: readonly number[]): number[] {
  const result = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    if (ai === 0) continue;
    for (let j = 0; j < b.length; j++) {
      result[i + j]! += ai * b[j]!;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Independence precondition (asserted, not assumed).
// ---------------------------------------------------------------------------

/**
 * `analyticRpPmf`/`allianceBonusRpPmf` are exact ONLY because the joint is
 * diagonal: every `scoreCrossCovariance` entry zero, every off-diagonal
 * `varianceBlock` entry zero. Throws naming the season and the violating
 * index/variable pair otherwise — a caller supplying a learned correlation
 * (Sigma1's `predictAllianceRpMoments`) must not reach this function.
 */
function assertIndependencePrecondition(moments: AllianceRpMoments, season: number): void {
  for (let i = 0; i < moments.scoreCrossCovariance.length; i++) {
    const value = moments.scoreCrossCovariance[i]!;
    if (value !== 0) {
      throw new Error(
        `analyticRpPmf: season ${season} supplied a non-zero scoreCrossCovariance[${i}] (variable "${moments.variableNames[i]}") = ${value} — this module is exact only when the joint is diagonal; a caller with a learned score/threshold correlation must not call it`
      );
    }
  }
  const t = moments.varianceBlock.length;
  for (let i = 0; i < t; i++) {
    for (let j = 0; j < t; j++) {
      if (i === j) continue;
      const value = moments.varianceBlock[i]?.[j] ?? 0;
      if (value !== 0) {
        throw new Error(
          `analyticRpPmf: season ${season} supplied a non-zero off-diagonal varianceBlock[${i}][${j}] (variables "${moments.variableNames[i]}"/"${moments.variableNames[j]}") = ${value} — this module is exact only when the joint is diagonal`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step 4 helper — one clause's probability from the alliance's fitted
// marginals.
// ---------------------------------------------------------------------------

function footprintOfClause(clause: RpThresholdClause): Set<string> {
  return new Set(clause.terms.map((term) => term.variable));
}

function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

/**
 * Builds the clause's own marginal as the sum of its scaled terms (mean and
 * variance divided by each term's own `divisor`, summed LEFT TO RIGHT in
 * declared term order — floating-point addition is not associative, and
 * `RpLinearTerm.divisor` is always a DIVISOR, never a multiplier), fits it
 * Gaussian (exact and closed for a sum of independent marginals — see this
 * plan's "## The closed form, specified" Step 4), and compares against the
 * resolved threshold.
 */
function clauseProbability(
  clause: RpThresholdClause,
  marginalsByName: ReadonlyMap<string, FittedMarginal>,
  tier: EventTier,
  season: number,
  bonusName: string
): number {
  let mean = 0;
  let variance = 0;
  for (const term of clause.terms) {
    const marginal = marginalsByName.get(term.variable);
    if (marginal === undefined) {
      throw new Error(
        `analyticRpPmf: season ${season} bonus "${bonusName}" references threshold variable "${term.variable}" with no fitted marginal`
      );
    }
    const divisor = term.divisor ?? 1;
    mean += marginal.mean / divisor;
    variance += marginal.variance / (divisor * divisor);
  }
  const combined = fitMarginal(mean, variance, "gaussian");
  const threshold = resolveRpThreshold(clause.threshold, tier);
  return clause.direction === "gte" ? probAtLeast(combined, threshold) : probAtMost(combined, threshold);
}

function assertPairwiseDisjoint(footprints: readonly Set<string>[], season: number, bonusName: string, label: string): void {
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      if (intersects(footprints[i]!, footprints[j]!)) {
        throw new Error(
          `analyticRpPmf: season ${season} bonus "${bonusName}"'s ${label} are not pairwise disjoint — the exact form used here requires independence between them (F4 boundary)`
        );
      }
    }
  }
}

/**
 * One bonus's own probability, dispatched by `BonusPredicate.kind`. Never
 * called for `"nestedSameVariable"` — that kind is handled exclusively by
 * `groupContribution`'s interval enumeration (Step 3), because its
 * probability depends on its sibling(s) sharing the same variable.
 */
function bonusProbability(
  predicate: BonusPredicate,
  marginalsByName: ReadonlyMap<string, FittedMarginal>,
  tier: EventTier,
  season: number
): number {
  switch (predicate.kind) {
    case "singleThreshold": {
      const clause: RpThresholdClause = { terms: [{ variable: predicate.variable }], direction: predicate.direction, threshold: predicate.threshold };
      return clauseProbability(clause, marginalsByName, tier, season, predicate.name);
    }
    case "linearCombination": {
      const clause: RpThresholdClause = { terms: predicate.terms, direction: predicate.direction, threshold: predicate.threshold };
      return clauseProbability(clause, marginalsByName, tier, season, predicate.name);
    }
    case "conjunctionDistinct": {
      assertPairwiseDisjoint(predicate.clauses.map(footprintOfClause), season, predicate.name, "clauses");
      let product = 1;
      for (const clause of predicate.clauses) product *= clauseProbability(clause, marginalsByName, tier, season, predicate.name);
      return product;
    }
    case "countOfIndicators": {
      assertPairwiseDisjoint(predicate.indicators.map(footprintOfClause), season, predicate.name, "indicators");
      const probabilities = predicate.indicators.map((clause) => clauseProbability(clause, marginalsByName, tier, season, predicate.name));
      const required = resolveRpThreshold(predicate.required, tier);
      return poissonBinomialAtLeast(probabilities, required);
    }
    case "dataDependentMixture": {
      const selectorFootprint = footprintOfClause(predicate.selector);
      const trueFootprint = footprintOfClause(predicate.whenSelectorTrue);
      const falseFootprint = footprintOfClause(predicate.whenSelectorFalse);
      if (intersects(selectorFootprint, trueFootprint) || intersects(selectorFootprint, falseFootprint)) {
        throw new Error(
          `analyticRpPmf: season ${season} bonus "${predicate.name}" (dataDependentMixture) has a selector clause not disjoint from its branch clauses — the mixture is only exact when they are independent`
        );
      }
      const selectorProbability = clauseProbability(predicate.selector, marginalsByName, tier, season, predicate.name);
      const trueProbability = clauseProbability(predicate.whenSelectorTrue, marginalsByName, tier, season, predicate.name);
      const falseProbability = clauseProbability(predicate.whenSelectorFalse, marginalsByName, tier, season, predicate.name);
      return selectorProbability * trueProbability + (1 - selectorProbability) * falseProbability;
    }
    case "constant": {
      return predicate.value ? 1 : 0;
    }
    case "nestedSameVariable": {
      throw new Error(
        `analyticRpPmf: season ${season} bonus "${predicate.name}" (nestedSameVariable) reached bonusProbability directly — it must be routed through groupContribution's interval enumeration`
      );
    }
    default: {
      const exhaustive: never = predicate;
      throw new Error(`analyticRpPmf: unhandled BonusPredicate kind in bonusProbability: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2/3 — group bonuses by shared threshold variable, enumerate each
// group's joint outcomes.
// ---------------------------------------------------------------------------

function footprintOf(predicate: BonusPredicate): Set<string> {
  switch (predicate.kind) {
    case "singleThreshold":
    case "nestedSameVariable":
      return new Set([predicate.variable]);
    case "linearCombination":
      return new Set(predicate.terms.map((term) => term.variable));
    case "conjunctionDistinct":
      return new Set(predicate.clauses.flatMap((clause) => clause.terms.map((term) => term.variable)));
    case "countOfIndicators":
      return new Set(predicate.indicators.flatMap((clause) => clause.terms.map((term) => term.variable)));
    case "dataDependentMixture":
      return new Set(
        [...predicate.selector.terms, ...predicate.whenSelectorTrue.terms, ...predicate.whenSelectorFalse.terms].map(
          (term) => term.variable
        )
      );
    case "constant":
      return new Set();
    default: {
      const exhaustive: never = predicate;
      throw new Error(`analyticRpPmf: unhandled BonusPredicate kind in footprintOf: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Connected-components pass over each predicate's variable footprint — never
 * a hardcoded season list. Bonuses land in the same group iff their
 * footprints intersect.
 */
function groupBonusPredicates(predicates: readonly BonusPredicate[]): BonusPredicate[][] {
  const n = predicates.length;
  const footprints = predicates.map(footprintOf);
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (intersects(footprints[i]!, footprints[j]!)) union(i, j);
    }
  }
  const groups = new Map<number, BonusPredicate[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list === undefined) groups.set(root, [predicates[i]!]);
    else list.push(predicates[i]!);
  }
  return [...groups.values()];
}

function isNestedSameVariable(predicate: BonusPredicate): predicate is Extract<BonusPredicate, { kind: "nestedSameVariable" }> {
  return predicate.kind === "nestedSameVariable";
}

interface GroupContribution {
  readonly pmf: number[];
  readonly perBonusProbabilities: Map<string, number>;
}

/**
 * One group's contribution pmf ("how many of this group's bonuses fire").
 * Handles exactly two shapes, per Step 2/3:
 *
 *   - every member `nestedSameVariable` over the same variable/direction ->
 *     the interval enumeration (Step 3). Works for a group of size 1 too —
 *     the telescoping formula degenerates to the singleton case exactly.
 *   - a genuine singleton (one non-nested bonus alone) -> its own
 *     probability `p`, contribution `[1 - p, p]`.
 *   - anything else -> THROWS, naming the season and the member bonus
 *     names. A silent fallback to a product of independents is the one
 *     outcome this branch exists to prevent (F4's enforced boundary).
 */
function groupContribution(
  group: readonly BonusPredicate[],
  marginalsByName: ReadonlyMap<string, FittedMarginal>,
  tier: EventTier,
  season: number
): GroupContribution {
  if (group.every(isNestedSameVariable)) {
    const nested = group as readonly Extract<BonusPredicate, { kind: "nestedSameVariable" }>[];
    const variable = nested[0]!.variable;
    const direction = nested[0]!.direction;
    for (const member of nested) {
      if (member.variable !== variable) {
        throw new Error(
          `analyticRpPmf: season ${season} nestedSameVariable group spans multiple variables ("${variable}" vs "${member.variable}") — no exact joint form exists for this shape`
        );
      }
      if (member.direction !== direction) {
        throw new Error(
          `analyticRpPmf: season ${season} nestedSameVariable group over "${variable}" mixes directions ("${direction}" vs "${member.direction}") — no exact joint form exists for this shape`
        );
      }
    }
    if (direction !== "gte") {
      throw new Error(
        `analyticRpPmf: season ${season} nestedSameVariable group over "${variable}" uses direction "lte", which this module has no implementation for — handle it or throw, never silently assume "gte"`
      );
    }
    const marginal = marginalsByName.get(variable);
    if (marginal === undefined) {
      throw new Error(`analyticRpPmf: season ${season} nestedSameVariable group over "${variable}" has no fitted marginal`);
    }
    const withThresholds = nested
      .map((member) => ({ member, threshold: resolveRpThreshold(member.threshold, tier) }))
      .sort((a, b) => a.threshold - b.threshold);
    const qs = withThresholds.map(({ threshold }) => probAtLeast(marginal, threshold));
    for (let i = 1; i < qs.length; i++) {
      if (qs[i]! - qs[i - 1]! > 1e-9) {
        throw new Error(
          `analyticRpPmf: season ${season} nestedSameVariable group over "${variable}" violated probAtLeast monotonicity (q[${i - 1}]=${qs[i - 1]} < q[${i}]=${qs[i]})`
        );
      }
    }
    const n = qs.length;
    const pmf = new Array<number>(n + 1).fill(0);
    pmf[0] = 1 - qs[0]!;
    for (let k = 1; k < n; k++) pmf[k] = Math.max(0, qs[k - 1]! - qs[k]!);
    pmf[n] = qs[n - 1]!;
    const perBonusProbabilities = new Map<string, number>();
    withThresholds.forEach(({ member }, index) => perBonusProbabilities.set(member.name, qs[index]!));
    return { pmf, perBonusProbabilities };
  }

  if (group.length === 1) {
    const bonus = group[0]!;
    const p = bonusProbability(bonus, marginalsByName, tier, season);
    return { pmf: [1 - p, p], perBonusProbabilities: new Map([[bonus.name, p]]) };
  }

  throw new Error(
    `analyticRpPmf: season ${season} has a multi-bonus group {${group.map((p) => p.name).join(", ")}} with no exact joint form implemented — F4 (dependence between distinct threshold variables) is deliberately out of scope; a silent product-of-independents fallback is the one outcome this throw exists to prevent`
  );
}

// ---------------------------------------------------------------------------
// Step 1/5 — fit marginals, group, convolve into the bonus-only pmf.
// ---------------------------------------------------------------------------

/** One alliance's bonus-only RP distribution, plus the observability 09-06 depends on. */
export interface AllianceBonusRp {
  /** Index `i` = P(this alliance earns exactly `i` bonus RP). Sums to 1. Length `bonusNames.length + 1`. */
  readonly pmf: readonly number[];
  /** Per-bonus MARGINAL probabilities, in `ruleModule.bonusNames` order. Does NOT sum to 1. */
  readonly bonusProbabilities: readonly number[];
  /** 09-03's `FittedMarginal[]`, carrying `resolved`/`fallbackReason` intact, in `moments.variableNames` order. */
  readonly marginals: readonly FittedMarginal[];
}

function assertNormalizedPmf(pmf: readonly number[], season: number, label: string): void {
  let sum = 0;
  for (const p of pmf) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`analyticRpPmf: season ${season} ${label} pmf has a non-finite or out-of-[0,1] entry (${p}) — refusing to publish`);
    }
    sum += p;
  }
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`analyticRpPmf: season ${season} ${label} pmf sums to ${sum}, expected 1 within 1e-9`);
  }
}

/**
 * One alliance's bonus-only RP distribution — fit marginals (Step 1), group
 * bonuses (Step 2), enumerate and convolve each group (Steps 3/4/5). This is
 * the bonus-only marginal 09-07/09-09 consume directly.
 */
export function allianceBonusRpPmf(
  moments: AllianceRpMoments,
  ruleModule: RpRuleModule,
  eventType: number,
  config: RpLayerConfig
): AllianceBonusRp {
  assertIndependencePrecondition(moments, ruleModule.season);
  const tier = eventTierFor(eventType);
  const variablesForFit: RpThresholdVariable[] = ruleModule.thresholdVariables.map((variable) => ({
    ...variable,
    marginalFamily: resolveMarginalFamily(variable.marginalFamily, config),
  }));
  const marginalsByName = fitAllianceMarginals(moments, variablesForFit);
  const groups = groupBonusPredicates(ruleModule.bonusPredicates);

  let pmf: number[] = [1];
  const perBonusProbabilities = new Map<string, number>();
  for (const group of groups) {
    const contribution = groupContribution(group, marginalsByName, tier, ruleModule.season);
    pmf = convolvePmf(pmf, contribution.pmf);
    for (const [name, p] of contribution.perBonusProbabilities) perBonusProbabilities.set(name, p);
  }

  const bonusProbabilities = ruleModule.bonusNames.map((name) => {
    const p = perBonusProbabilities.get(name);
    if (p === undefined) {
      throw new Error(`analyticRpPmf: season ${ruleModule.season} bonus "${name}" has no computed probability — grouping did not cover every declared bonus`);
    }
    return p;
  });

  assertNormalizedPmf(pmf, ruleModule.season, "bonus-only");
  const expectedLength = ruleModule.bonusNames.length + 1;
  if (pmf.length !== expectedLength) {
    throw new Error(
      `analyticRpPmf: season ${ruleModule.season} bonus-only pmf has length ${pmf.length}, expected ${expectedLength} (bonusNames.length + 1)`
    );
  }

  const marginals = moments.variableNames.map((name) => marginalsByName.get(name)!);

  return { pmf, bonusProbabilities, marginals };
}

// ---------------------------------------------------------------------------
// Step 6 — the outcome half.
// ---------------------------------------------------------------------------

/** The win/tie/loss probabilities for one match, plus the season's own `winRp`/`tieRp` (09-07 composes its outcome vectors against these). */
export interface RpOutcomeDistribution {
  readonly pRedWin: number;
  readonly pTie: number;
  readonly pBlueWin: number;
  readonly winRp: number;
  readonly tieRp: number;
}

/**
 * Input to `matchOutcomeDistribution` — each alliance's OWN predicted score
 * mean/variance (never the combined win-probability variance), plus the
 * season's `winRp`/`tieRp` and the resolved config.
 *
 * `pRedWin` (D-13, 09-05 Task 1): `Prediction.pRedWin`, the SAME float the
 * artifact publishes — required, not optional, so no call site can omit it
 * and get a silent zero. Under `winSource: "score-draw"` (the legacy
 * member) it is accepted and never read.
 */
export interface RpOutcomeInput {
  readonly redScoreMean: number;
  readonly redScoreVariance: number;
  readonly blueScoreMean: number;
  readonly blueScoreVariance: number;
  readonly winRp: number;
  readonly tieRp: number;
  readonly config: RpLayerConfig;
  readonly pRedWin: number;
}

/**
 * The three-way split of a decisive-or-tied outcome into red/tie/blue mass
 * (09-05 Task 1, D-13/D-14's pinned formulation). `pRedStrict`/`pBlueStrict`
 * are each alliance's STRICT win probability (excludes tie mass);
 * `clampedPRedWin` records whether the supplied `pRedWin` had to be brought
 * into range (T-09-05-03) — COUNTED rather than silently applied, the same
 * discipline 09-03 used for `FittedMarginal.fallbackReason`.
 */
export interface OutcomeSplit {
  readonly pRedStrict: number;
  readonly pTie: number;
  readonly pBlueStrict: number;
  readonly clampedPRedWin: boolean;
}

/**
 * Splits a win probability and a tie probability into the three strict
 * outcome masses. PROPORTIONAL split — `pRedStrict = pRedWin * (1 - pTie)`,
 * `pBlueStrict = (1 - pRedWin) * (1 - pTie)` — chosen over subtracting half
 * the tie mass (`pRedWin - pTie/2`) because that alternative needs a clamp
 * whenever `pTie/2 > pRedWin`, and a clamp is a silent third model that
 * would confound 09-06's attribution. Proportional splitting never goes
 * negative and buys an exact algebraic identity: CONDITIONAL ON A DECISIVE
 * RESULT, `pRedStrict / (pRedStrict + pBlueStrict) === pRedWin` (the
 * `(1 - pTie)` factor cancels). The two formulations agree to roughly
 * `pTie * (pRedWin - 0.5)` — at the measured 1.09% tie base rate and a 0.3
 * probability offset, about 0.003, a third-order term (D-14's formulation
 * choice, recorded here per 09-05-PLAN.md's requirement that the file say
 * which one was picked and why).
 *
 * `pRedWin` is clamped into `[0, 1]` ONLY when it is finite but out of
 * range — the threat T-09-05-03 names is a finite-but-out-of-range value
 * silently propagating negative or greater-than-one mass into a published
 * pmf, and clamping is the correct fix for exactly that case (never a
 * clamp needed for an in-range value, which is why the six-point exactness
 * grid including both endpoints is bitwise exact). A NON-FINITE `pRedWin`
 * is intentionally left UNCLAMPED and propagates as `NaN` — inventing a
 * neutral `0.5` for it would silently launder a corrupted upstream
 * computation (e.g. a non-finite score mean feeding the legacy `winSource`
 * branch) into a plausible-looking pmf instead of letting
 * `assertNormalizedPmf`'s existing `Number.isFinite` guard catch it, which
 * is the structural check this project already relies on for exactly this
 * failure class. `clampedPRedWin` is `true` for EITHER case (finite-out-of-
 * range OR non-finite) — it names "something had to be flagged", not "the
 * output is now safe to use".
 */
export function splitOutcomeProbabilities(pRedWin: number, pTie: number): OutcomeSplit {
  const outOfRange = Number.isFinite(pRedWin) && (pRedWin < 0 || pRedWin > 1);
  const clampedPRedWin = !Number.isFinite(pRedWin) || outOfRange;
  const effectivePRedWin = outOfRange ? Math.min(1, Math.max(0, pRedWin)) : pRedWin;
  const effectivePTie = Number.isFinite(pTie) ? Math.min(1, Math.max(0, pTie)) : pTie;
  const pRedStrict = effectivePRedWin * (1 - effectivePTie);
  const pBlueStrict = (1 - effectivePRedWin) * (1 - effectivePTie);
  return { pRedStrict, pTie: effectivePTie, pBlueStrict, clampedPRedWin };
}

/**
 * `winSource: "score-draw"` (the legacy member, UNCHANGED and
 * un-refactored from 09-04's own expression): reproduces the deleted draw
 * loop's `redScore > blueScore` comparison exactly. The two alliance
 * scores are independent Gaussians (cross-alliance block was zero), so
 * `D = redScore - blueScore` is Gaussian with `meanD = red.scoreMean -
 * blue.scoreMean`, `varianceD = red.scoreVariance + blue.scoreVariance`.
 * `winSource: "p-red-win"` (D-13, 09-05 Task 1): uses `input.pRedWin`
 * directly — the SAME float the artifact publishes — closing F6's measured
 * coherence gap (mean signed difference 0.0000, median absolute difference
 * 0.0428, p90 0.1203, max 0.3415 over 110,362 qualification matches,
 * favourite never flipped) BY CONSTRUCTION rather than by narrowing it.
 *
 * `tieModel: "continuous-equality"` (the legacy member): a tie needs exact
 * equality of two continuous draws, so `pTie` is exactly 0 whenever
 * `varianceD > 0` — F7's dead branch, reproduced faithfully, not repaired.
 * `tieModel: "discrete-margin"` is 09-05 Task 2's (D-14).
 *
 * The `varianceD <= 0` DEGENERATE branch (both alliances' predicted score
 * variance is exactly zero — a deterministic score pair) is preserved
 * EXACTLY as 09-04 shipped it, for EVERY config: comparing the two
 * deterministic means directly is the correct limit regardless of
 * `winSource`/`tieModel`, and this branch is NOT F7's dead branch — that
 * claim is about `varianceD > 0` only, where a tie genuinely needs exact
 * float equality of two CONTINUOUS draws. A degenerate, already-equal pair
 * of deterministic means is not that.
 */
export function matchOutcomeDistribution(input: RpOutcomeInput): RpOutcomeDistribution {
  assertSupportedRpLayerConfig(input.config);
  const meanD = input.redScoreMean - input.blueScoreMean;
  const varianceD = input.redScoreVariance + input.blueScoreVariance;

  let pRedWin: number;
  let pTie: number;
  let pBlueWin: number;
  if (varianceD > 0) {
    const pRedWinEffective =
      input.config.winSource === "p-red-win" ? input.pRedWin : 1 - standardNormalCdf(-meanD / Math.sqrt(varianceD));
    // Tie-model dispatch lands in 09-05 Task 2 (D-14) — legacy is exactly 0
    // here, still hardcoded rather than routed through a not-yet-existing
    // tieProbability, matching this plan's own required commit ordering.
    const rawPTie = 0;
    const split = splitOutcomeProbabilities(pRedWinEffective, rawPTie);
    pRedWin = split.pRedStrict;
    pTie = split.pTie;
    pBlueWin = split.pBlueStrict;
  } else {
    pRedWin = meanD > 0 ? 1 : 0;
    pTie = meanD === 0 ? 1 : 0;
    pBlueWin = meanD < 0 ? 1 : 0;
  }

  const sum = pRedWin + pTie + pBlueWin;
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`analyticRpPmf: outcome probabilities summed to ${sum}, expected 1`);
  }

  return { pRedWin, pTie, pBlueWin, winRp: input.winRp, tieRp: input.tieRp };
}

/**
 * One alliance's outcome-RP pmf: length `winRp + 1`, `winProb` at index
 * `winRp`, `tieProb` at index `tieRp`, `loseProb` at index `0`
 * (ACCUMULATED with `+=`, since `tieRp` could in principle equal `0`).
 */
function allianceOutcomePmf(winProb: number, tieProb: number, loseProb: number, winRp: number, tieRp: number): number[] {
  const pmf = new Array<number>(winRp + 1).fill(0);
  pmf[winRp]! += winProb;
  pmf[tieRp]! += tieProb;
  pmf[0]! += loseProb;
  return pmf;
}

// ---------------------------------------------------------------------------
// Step 7 — the final pmf.
// ---------------------------------------------------------------------------

/**
 * Input to `analyticRpPmf` — no match key, no seed, no draw count (the
 * closed form consumes no randomness at all).
 *
 * `pRedWin` (D-13, 09-05 Task 1): `Prediction.pRedWin`, the SAME float the
 * artifact publishes. REQUIRED, not optional, so no call site can omit it
 * and get a silent zero — under `winSource: "score-draw"` (the legacy
 * member) it is accepted and never read; see `RpOutcomeInput`'s own doc
 * comment.
 */
export interface AnalyticRpPmfInput {
  readonly red: AllianceRpMoments;
  readonly blue: AllianceRpMoments;
  readonly ruleModule: RpRuleModule;
  readonly eventType: number;
  readonly compLevel: CompLevel;
  readonly config: RpLayerConfig;
  readonly pRedWin: number;
}

export interface AnalyticRpPmfResult {
  readonly redPmf: readonly number[];
  readonly bluePmf: readonly number[];
  readonly redBonusProbabilities?: readonly number[];
  readonly blueBonusProbabilities?: readonly number[];
  /** Each alliance's bonus-only marginal — the halves 09-07's rank-simulation coupling fix consumes directly. */
  readonly redBonusPmf?: readonly number[];
  readonly blueBonusPmf?: readonly number[];
  /** 09-03's `FittedMarginal[]`, carried through so 09-06 can count fallback rates. */
  readonly redMarginals?: readonly FittedMarginal[];
  readonly blueMarginals?: readonly FittedMarginal[];
  /** The shared win/tie/loss draw both alliances' outcome halves were built from — what 09-07 composes its `[winRp, tieRp, 0]`/`[0, tieRp, winRp]` vectors against. */
  readonly outcome?: RpOutcomeDistribution;
}

/**
 * Mean, derived from a discrete pmf at read time — D-10: the pmf is the ONE
 * stored representation, mean/SD are never stored alongside it. MOVED here
 * from the deleted `distribution.ts` (plan 09-04 Task 3) — a pmf read-time
 * utility with nothing to do with the Monte Carlo it used to sit beside.
 * Same name, same doc comment as before, one relocation note.
 */
export function pmfMean(pmf: readonly number[]): number {
  let mean = 0;
  for (let i = 0; i < pmf.length; i++) mean += i * pmf[i]!;
  return mean;
}

/**
 * Standard deviation, derived from a discrete pmf at read time (see
 * `pmfMean`). Floored at 0 to absorb floating-point noise that could
 * otherwise produce a tiny negative variance. MOVED here from the deleted
 * `distribution.ts` (plan 09-04 Task 3) — see `pmfMean`'s relocation note.
 */
export function pmfStandardDeviation(pmf: readonly number[]): number {
  const mean = pmfMean(pmf);
  let variance = 0;
  for (let i = 0; i < pmf.length; i++) variance += pmf[i]! * (i - mean) ** 2;
  return Math.sqrt(Math.max(0, variance));
}

/**
 * The `rpPmfForMatch` replacement — one match's full RP pmf for both
 * alliances, from the closed form. See this plan's "## The closed form,
 * specified" section for the step-by-step derivation this function
 * implements.
 *
 * The two short-circuits carried forward from `distribution.ts`:
 * non-qualification `compLevel` returns the degenerate `P(RP=0)=1` pmf for
 * both alliances with no marginal fitted (Pitfall 3); the zero-draws fast
 * path is GONE — a closed form has no draw count to set to zero, so this
 * function always computes.
 */
export function analyticRpPmf(input: AnalyticRpPmfInput): AnalyticRpPmfResult {
  assertSupportedRpLayerConfig(input.config);
  const { red, blue, ruleModule, eventType, compLevel, config, pRedWin } = input;

  if (!isBonusRpCompLevel(compLevel)) {
    return { redPmf: [1], bluePmf: [1] };
  }

  const redBonus = allianceBonusRpPmf(red, ruleModule, eventType, config);
  const blueBonus = allianceBonusRpPmf(blue, ruleModule, eventType, config);

  const outcome = matchOutcomeDistribution({
    redScoreMean: red.scoreMean,
    redScoreVariance: red.scoreVariance,
    blueScoreMean: blue.scoreMean,
    blueScoreVariance: blue.scoreVariance,
    winRp: ruleModule.winRp,
    tieRp: ruleModule.tieRp,
    config,
    pRedWin,
  });

  const redOutcomePmf = allianceOutcomePmf(outcome.pRedWin, outcome.pTie, outcome.pBlueWin, ruleModule.winRp, ruleModule.tieRp);
  const blueOutcomePmf = allianceOutcomePmf(outcome.pBlueWin, outcome.pTie, outcome.pRedWin, ruleModule.winRp, ruleModule.tieRp);

  const redPmf = convolvePmf(redOutcomePmf, redBonus.pmf);
  const bluePmf = convolvePmf(blueOutcomePmf, blueBonus.pmf);

  assertNormalizedPmf(redPmf, ruleModule.season, "red");
  assertNormalizedPmf(bluePmf, ruleModule.season, "blue");

  const expectedLength = ruleModule.maxRp + 1;
  if (redPmf.length !== expectedLength || bluePmf.length !== expectedLength) {
    throw new Error(
      `analyticRpPmf: season ${ruleModule.season} pmf length mismatch — expected ${expectedLength} (maxRp + 1), got red=${redPmf.length} blue=${bluePmf.length}`
    );
  }

  return {
    redPmf,
    bluePmf,
    ...(redBonus.bonusProbabilities.length > 0 ? { redBonusProbabilities: redBonus.bonusProbabilities } : {}),
    ...(blueBonus.bonusProbabilities.length > 0 ? { blueBonusProbabilities: blueBonus.bonusProbabilities } : {}),
    redBonusPmf: redBonus.pmf,
    blueBonusPmf: blueBonus.pmf,
    redMarginals: redBonus.marginals,
    blueMarginals: blueBonus.marginals,
    outcome,
  };
}
