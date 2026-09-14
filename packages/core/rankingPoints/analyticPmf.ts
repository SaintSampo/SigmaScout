/**
 * The closed form — an exact analytic pmf: one marginal per threshold
 * variable (`marginals.ts`), bonuses grouped by shared threshold variable
 * and enumerated from marginal CDFs, groups convolved into a bonus-only
 * pmf, and that pmf convolved with the win/tie outcome half.
 *
 * Exact, not an approximation, because `empiricalMoments.ts`'s
 * `momentsFor` builds a diagonal `varianceBlock` and an all-zero
 * `scoreCrossCovariance` by construction — the joint is already exactly
 * independent, so a closed form over independent marginals computes the
 * exact distribution with no sampling noise. This module asserts that
 * diagonal/zero precondition on every call (`assertIndependencePrecondition`
 * below) rather than assuming it: a caller supplying a genuine, non-zero
 * correlation would have it silently discarded by a function whose whole
 * correctness argument depends on its absence, so this module refuses that
 * caller instead.
 *
 * The single highest-risk computation in the whole module: 2026's
 * `energized`/`supercharged` pair both threshold `hubTotalCount`, and the
 * supercharged threshold is always at or above the energized one at every
 * tier, so supercharged structurally implies energized. Treating the pair
 * as independent Bernoulli events understates `P(both)` — the
 * nested-threshold interval enumeration below (`groupContribution`'s
 * `nestedSameVariable` branch) exists specifically to get this right, and
 * the test suite asserts the correct answer is not the independent product.
 *
 * The model this file implements:
 *   - each threshold variable's marginal is Gaussian;
 *   - the win/tie/loss split comes from the difference of the two
 *     alliances' independent Gaussian score distributions, `D = redScore -
 *     blueScore`. A tie is the event that the real, integer-valued margin
 *     rounds to zero (`tieProbability` below gives its exact probability
 *     under a continuous latent `D`), and the decisive share (red vs blue)
 *     is either the score-draw comparison `P(D > 0)` or, when the caller
 *     supplies its own `pRedWin` (every SPR call site does), the
 *     algorithm's own published win probability, split proportionally
 *     against `1 - pTie`.
 *
 * Both the win-probability substitution and the discrete tie probability
 * were measured against control through the publisher's own scorer, and
 * both cleared the bar — see `docs/models/rp-layer-config-arms.md` for the record.
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
  divideLatticePmf,
  fitAllianceMarginals,
  fitMarginal,
  latticeSumTail,
  materializeLatticeMarginal,
  poissonBinomialAtLeast,
  probAtLeast,
  probAtMost,
  standardNormalCdf,
} from "./marginals.js";

/**
 * A fallback-ladder diagnostic: running counts of what a set of
 * `fitMarginal` calls actually resolved to — `FittedMarginal.resolved`,
 * never `.declared`. A variable can declare Gaussian and still resolve to a
 * degenerate point mass when a fit over its data cannot support any
 * distribution; this counts how often that happens.
 *
 * The `negativeBinomial` counter matters because the NB method-of-moments
 * fit is undefined for `mean <= 0` and for `variance <= mean`, both of
 * which fall back to Gaussian. Without this counter, a measurement arm
 * labelled `"negative-binomial"` whose fits mostly fell back is
 * indistinguishable from a genuine one. `fallbacks` is counted separately
 * from `gaussian` — a fit that resolved to what it declared is not a
 * fallback.
 */
export interface MarginalResolutionTally {
  negativeBinomial: number;
  gaussian: number;
  degenerate: number;
  /** Fits that resolved to the lattice family (quick task 260914-01x). A lattice shape fallback also counts in `fallbacks`. */
  lattice: number;
  fallbacks: number;
}

/** A fresh, all-zero `MarginalResolutionTally` — for callers that want their own counter rather than sharing `SigmaScoutLayer`'s running one. */
export function emptyMarginalResolutionTally(): MarginalResolutionTally {
  return { negativeBinomial: 0, gaussian: 0, degenerate: 0, lattice: 0, fallbacks: 0 };
}

/** Increments `tally` by one fitted marginal's resolved family and (separately) its fallback status. */
function accumulateMarginalResolution(tally: MarginalResolutionTally, marginal: FittedMarginal): void {
  switch (marginal.resolved) {
    case "negative-binomial":
      tally.negativeBinomial += 1;
      break;
    case "gaussian":
      tally.gaussian += 1;
      break;
    case "degenerate":
      tally.degenerate += 1;
      break;
    case "lattice":
      tally.lattice += 1;
      break;
  }
  if (marginal.fallbackReason !== undefined) tally.fallbacks += 1;
}

// ---------------------------------------------------------------------------
// convolvePmf — plain polynomial multiplication, the one convolution routine
// every step below (and the rung-1 N-fold season-total convolution) uses.
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
 * `analyticRpPmf`/`allianceBonusRpPmf` are exact only because the joint is
 * diagonal: every `scoreCrossCovariance` entry zero, every off-diagonal
 * `varianceBlock` entry zero. Throws naming the season and the violating
 * index/variable pair otherwise.
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
 * Which `MarginalFamily` a clause's combined moments may be fitted with,
 * derived from the families its contributing terms declare rather than
 * asserted here. Reads `FittedMarginal.declared` so a future family
 * extends the declarations and this derivation picks it up.
 *
 * Refuses, loudly, in both cases where no exact closed form exists — this
 * module's house style: name the season, name the subject, name the
 * violated precondition, never fall back silently to an unrequested distribution.
 */
function familyForClauseSum(
  marginals: readonly FittedMarginal[],
  clause: RpThresholdClause,
  season: number,
  bonusName: string
): MarginalFamily {
  const declared = new Set(marginals.map((m) => m.declared));
  if (declared.size !== 1) {
    throw new Error(
      `analyticRpPmf: season ${season} bonus "${bonusName}" sums terms declaring ${declared.size} distinct marginal families {${[...declared].join(", ")}} over variables {${clause.terms.map((term) => term.variable).join(", ")}} — a sum of scaled terms drawn from different families has no exact closed form, so declare one family across the clause or implement that joint explicitly`
    );
  }

  const family = [...declared][0]!;
  switch (family) {
    case "gaussian":
      // Returns here rather than throwing: a sum of independently-scaled
      // Gaussians is exactly Gaussian, with the summed mean and the summed
      // scaled variance. Closure under scaled addition is the whole
      // precondition; a family without it cannot be fitted from combined
      // moments at all.
      return "gaussian";
    case "negative-binomial":
      // Negative binomial is not closed under scaled addition: a sum of
      // independent NB variables is NB only when every `p` matches, and
      // `X / divisor` is not even integer-supported. Fitting the combined
      // moments with an NB would publish a probability from a distribution
      // the terms do not have, so this throws rather than silently
      // falling back to Gaussian.
      throw new Error(
        `analyticRpPmf: season ${season} bonus "${bonusName}" sums scaled terms all declaring "negative-binomial" over variables {${clause.terms.map((term) => term.variable).join(", ")}}, which is not closed under scaled addition — a sum of independent negative binomials is negative binomial only when every p matches, and a divided term is not even integer-supported, so implement that joint explicitly or declare "gaussian" on every variable appearing in a multi-term or divisor-bearing clause`
      );
    case "lattice":
      // Not closed under scaled addition either, but it needs no refit: the
      // caller sums the terms exactly by lattice convolution instead, each
      // term's lattice divided by its own divisor (quick task 260914-01x).
      return "lattice";
    default: {
      // `never` so a third union member fails to compile here, before it
      // can fail at runtime on real data — whoever adds that member gets a
      // type error pointing at this arm, and must decide whether their
      // family is closed under scaled addition rather than discover the
      // answer from a wrong published probability.
      const exhaustive: never = family;
      throw new Error(
        `analyticRpPmf: season ${season} bonus "${bonusName}" sums scaled terms all declaring "${String(exhaustive)}", which is not closed under scaled addition — a sum of its scaled terms has no exact closed form in that family, so implement that joint explicitly rather than fitting the combined moments with it`
      );
    }
  }
}

/**
 * One clause's probability, by one of two routes.
 *
 * A single unscaled term (`divisor` absent or 1) reuses that variable's own
 * `FittedMarginal` verbatim: the clause's random variable is the
 * variable's, so correctness rests on identity rather than any closure
 * property, and the variable's own `resolved`/`fallbackReason` survive
 * instead of being re-derived from its moments. This is why
 * `singleThreshold`, the most common predicate shape, honours a future
 * declared family for free — including one not closed under scaled
 * addition, which a refit of the combined moments could never do.
 *
 * Every other clause builds its own marginal as the sum of its scaled
 * terms (mean and variance divided by each term's own `divisor`, summed
 * left to right in declared term order — floating-point addition is not
 * associative, and `RpLinearTerm.divisor` is always a divisor, never a
 * multiplier), fits it with the family `familyForClauseSum` derives from
 * those terms' declarations, and compares against the resolved threshold.
 * A clause whose terms all declare "lattice" is summed exactly on the
 * lattice instead (`latticeSumTail`), never refitted from combined moments.
 * A single term with a divisor takes this route deliberately: `X / c` is
 * not `X`, so closure under scaling is load-bearing there and identity is
 * not available.
 */
function clauseProbability(
  clause: RpThresholdClause,
  marginalsByName: ReadonlyMap<string, FittedMarginal>,
  tier: EventTier,
  season: number,
  bonusName: string
): number {
  // Every term's marginal is looked up first, in declared order, so the
  // missing-marginal throw still surfaces at the same term and before any
  // threshold-resolution throw below.
  const marginals: FittedMarginal[] = [];
  for (const term of clause.terms) {
    const marginal = marginalsByName.get(term.variable);
    if (marginal === undefined) {
      throw new Error(
        `analyticRpPmf: season ${season} bonus "${bonusName}" references threshold variable "${term.variable}" with no fitted marginal`
      );
    }
    marginals.push(marginal);
  }

  if (clause.terms.length === 1 && (clause.terms[0]!.divisor ?? 1) === 1) {
    const only = marginals[0]!;
    const threshold = resolveRpThreshold(clause.threshold, tier);
    return clause.direction === "gte" ? probAtLeast(only, threshold) : probAtMost(only, threshold);
  }

  const family = familyForClauseSum(marginals, clause, season, bonusName);
  if (family === "lattice") {
    // Exact sum on the lattice: each term materialized, divided by its own
    // divisor, and summed in declared term order.
    const terms = marginals.map((marginal, i) => divideLatticePmf(materializeLatticeMarginal(marginal), clause.terms[i]!.divisor ?? 1));
    return latticeSumTail(terms, resolveRpThreshold(clause.threshold, tier), clause.direction);
  }

  // Left-to-right in declared term order, dividing rather than multiplying
  // by a precomputed coefficient — a threshold comparison is exactly where
  // that float difference becomes observable.
  let mean = 0;
  let variance = 0;
  for (let i = 0; i < clause.terms.length; i++) {
    const divisor = clause.terms[i]!.divisor ?? 1;
    mean += marginals[i]!.mean / divisor;
    variance += marginals[i]!.variance / (divisor * divisor);
  }
  const combined = fitMarginal(mean, variance, family);
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

/** One alliance's bonus-only RP distribution, plus the observability a caller may need. */
export interface AllianceBonusRp {
  /** Index `i` = P(this alliance earns exactly `i` bonus RP). Sums to 1. Length `bonusNames.length + 1`. */
  readonly pmf: readonly number[];
  /** Per-bonus MARGINAL probabilities, in `ruleModule.bonusNames` order. Does NOT sum to 1. */
  readonly bonusProbabilities: readonly number[];
  /** `FittedMarginal[]`, carrying `resolved`/`fallbackReason` intact, in `moments.variableNames` order. */
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
 * the bonus-only marginal callers consume directly.
 */
export function allianceBonusRpPmf(
  moments: AllianceRpMoments,
  ruleModule: RpRuleModule,
  eventType: number,
  tally?: MarginalResolutionTally
): AllianceBonusRp {
  assertIndependencePrecondition(moments, ruleModule.season);
  const tier = eventTierFor(eventType);
  // Each variable's own declared family is honored verbatim: this stays a
  // per-variable read even though every variable currently declares the
  // same family, so a future family extends the declaration rather than
  // reintroducing a global switch.
  const marginalsByName = fitAllianceMarginals(moments, ruleModule.thresholdVariables);
  if (tally !== undefined) {
    for (const marginal of marginalsByName.values()) accumulateMarginalResolution(tally, marginal);
  }
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

/** The win/tie/loss probabilities for one match, plus the season's own `winRp`/`tieRp` (a caller composes its outcome vectors against these). */
export interface RpOutcomeDistribution {
  readonly pRedWin: number;
  readonly pTie: number;
  readonly pBlueWin: number;
  readonly winRp: number;
  readonly tieRp: number;
}

/**
 * Half the width of the integer-margin bin centred on zero. Real FRC
 * scores are integers, so the observed margin is the rounding of a
 * continuous latent margin, and a tie is exactly the event that the
 * latent margin rounds to zero — the interval `(-0.5, 0.5)`. Structural,
 * not tunable: it follows from "integers round to the nearest integer".
 */
const TIE_MARGIN_HALF_WIDTH = 0.5;

/**
 * The probability a continuous latent score margin — Gaussian with mean
 * `marginMean` and variance `marginVariance` — rounds to zero:
 *
 *   `pTie = Phi((0.5 - marginMean) / marginSd) - Phi((-0.5 - marginMean) / marginSd)`
 *
 * Measured against the real base rate of ties in official qualification
 * matches and found to match closely (see `docs/models/rp-layer-config-arms.md`).
 *
 * The degenerate guard is ordered before the division, deliberately: if
 * `marginVariance` is not finite or is at or below zero, `pTie` is `1`
 * when the (deterministic) margin is within the tie window and `0`
 * otherwise — the same limit `matchOutcomeDistribution`'s own
 * `varianceD <= 0` branch uses for the win/loss split, restated here so
 * this function never divides by zero or propagates a `NaN` variance into the CDF.
 */
function tieProbability(marginMean: number, marginVariance: number): number {
  if (!Number.isFinite(marginVariance) || marginVariance <= 0) {
    return Math.abs(marginMean) < TIE_MARGIN_HALF_WIDTH ? 1 : 0;
  }
  const marginSd = Math.sqrt(marginVariance);
  return (
    standardNormalCdf((TIE_MARGIN_HALF_WIDTH - marginMean) / marginSd) -
    standardNormalCdf((-TIE_MARGIN_HALF_WIDTH - marginMean) / marginSd)
  );
}

/**
 * Input to `matchOutcomeDistribution` — each alliance's own predicted score
 * mean/variance (never the combined win-probability variance), plus the
 * season's `winRp`/`tieRp`.
 *
 * `pRedWin` is optional: every SPR call site holding a real `Prediction`
 * passes it, but `fieldAveraged.ts` prices a hypothetical field-averaged
 * match with no `Prediction` at all and must keep the score-draw limit.
 */
export interface RpOutcomeInput {
  readonly redScoreMean: number;
  readonly redScoreVariance: number;
  readonly blueScoreMean: number;
  readonly blueScoreVariance: number;
  readonly winRp: number;
  readonly tieRp: number;
  /**
   * When supplied, this is used in place of the score-draw comparison as
   * the win probability the outcome split is built from — the algorithm's
   * own published `Prediction.pRedWin`. Absent only from
   * `fieldAveraged.ts`, which has no `Prediction` to read one from, and
   * falls back to the score-draw expression `P(D > 0)`.
   */
  readonly pRedWin?: number;
}

/**
 * The win/tie/loss split, from the difference of the two alliances'
 * independent Gaussian score distributions. The cross-alliance covariance
 * block is zero, so `D = redScore - blueScore` is Gaussian with
 * `meanD = red.scoreMean - blue.scoreMean` and
 * `varianceD = red.scoreVariance + blue.scoreVariance`.
 *
 * The `varianceD > 0` branch computes `pRedWinEffective` (the caller's
 * supplied `input.pRedWin`, or the score-draw expression `P(D > 0)` when
 * absent) and `rawPTie` (`tieProbability(meanD, varianceD)`,
 * unconditional), then splits the two proportionally:
 * `pRedWin = pRedWinEffective * (1 - rawPTie)`,
 * `pBlueWin = (1 - pRedWinEffective) * (1 - rawPTie)`. This never goes
 * negative and preserves an exact identity conditional on a decisive
 * result: `pRedWin / (pRedWin + pBlueWin) === pRedWinEffective` (the
 * `(1 - rawPTie)` factor cancels). `pRedWinEffective` is clamped into
 * `[0, 1]` only when it is finite but out of range; a non-finite value is
 * left unclamped and propagates to this function's own normalization
 * check below, rather than a clamp silently laundering a corrupted
 * upstream computation into a plausible-looking pmf.
 *
 * Before the win/tie model shipped, a tie had probability zero whenever
 * `varianceD > 0`, because a tie would need exact floating-point equality
 * of two continuous draws — a known and measured shortcoming, since about
 * 1.09% of real qualification matches tie. Both the win-probability
 * substitution and the discrete tie probability were measured against a
 * bar built to see this half specifically and cleared it — see
 * `docs/models/rp-layer-config-arms.md` for the figures.
 *
 * The `varianceD <= 0` degenerate branch — both alliances' predicted score
 * variance exactly zero, a deterministic score pair — is the one place
 * `pTie` can be non-zero for a reason other than the shipped tie model:
 * comparing the two deterministic means directly is the correct limit
 * regardless of `input.pRedWin`, which this branch ignores.
 */
export function matchOutcomeDistribution(input: RpOutcomeInput): RpOutcomeDistribution {
  const meanD = input.redScoreMean - input.blueScoreMean;
  const varianceD = input.redScoreVariance + input.blueScoreVariance;

  let pRedWin: number;
  let pTie: number;
  let pBlueWin: number;
  if (varianceD > 0) {
    const pRedWinEffective = input.pRedWin !== undefined ? input.pRedWin : 1 - standardNormalCdf(-meanD / Math.sqrt(varianceD));
    const rawPTie = tieProbability(meanD, varianceD);
    const outOfRange = Number.isFinite(pRedWinEffective) && (pRedWinEffective < 0 || pRedWinEffective > 1);
    const clampedPRedWin = outOfRange ? Math.min(1, Math.max(0, pRedWinEffective)) : pRedWinEffective;
    pRedWin = clampedPRedWin * (1 - rawPTie);
    pTie = rawPTie;
    pBlueWin = (1 - clampedPRedWin) * (1 - rawPTie);
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
 */
export interface AnalyticRpPmfInput {
  readonly red: AllianceRpMoments;
  readonly blue: AllianceRpMoments;
  readonly ruleModule: RpRuleModule;
  readonly eventType: number;
  readonly compLevel: CompLevel;
  /**
   * Optional external accumulator — when supplied, this call's marginal
   * fits (both alliances) are also folded into it, so a caller can track
   * the resolved-family mix across many calls. A call given no tally still
   * returns a correct pmf and does not throw.
   */
  readonly tally?: MarginalResolutionTally;
  /**
   * Forwarded verbatim to `matchOutcomeDistribution`'s
   * `RpOutcomeInput.pRedWin` — see that field's doc comment. Absent only
   * from `fieldAveraged.ts`, which has no `Prediction` to read one from.
   */
  readonly pRedWin?: number;
}

export interface AnalyticRpPmfResult {
  readonly redPmf: readonly number[];
  readonly bluePmf: readonly number[];
  readonly redBonusProbabilities?: readonly number[];
  readonly blueBonusProbabilities?: readonly number[];
  /** Each alliance's bonus-only marginal — the halves a rank-simulation coupling consumes directly. */
  readonly redBonusPmf?: readonly number[];
  readonly blueBonusPmf?: readonly number[];
  /** `FittedMarginal[]`, carried through so a caller can count fallback rates. */
  readonly redMarginals?: readonly FittedMarginal[];
  readonly blueMarginals?: readonly FittedMarginal[];
  /** THIS CALL's OWN resolved-family counts (both alliances), independent of whether `input.tally` was also supplied. Undefined for the non-qualification short-circuit, which fits no marginal at all. */
  readonly marginalResolution?: MarginalResolutionTally;
  /** The shared win/tie/loss draw both alliances' outcome halves were built from — what a caller composes its `[winRp, tieRp, 0]`/`[0, tieRp, winRp]` vectors against. */
  readonly outcome?: RpOutcomeDistribution;
}

/**
 * Mean, derived from a discrete pmf at read time: the pmf is the ONE stored
 * representation, mean/SD are never stored alongside it.
 */
export function pmfMean(pmf: readonly number[]): number {
  let mean = 0;
  for (let i = 0; i < pmf.length; i++) mean += i * pmf[i]!;
  return mean;
}

/**
 * One match's full RP pmf for both alliances, from the closed form.
 *
 * The one short-circuit: non-qualification `compLevel` returns the
 * degenerate `P(RP=0)=1` pmf for both alliances with no marginal fitted —
 * a closed form has no draw count to set to zero, so this function always
 * computes for a qualification match.
 */
export function analyticRpPmf(input: AnalyticRpPmfInput): AnalyticRpPmfResult {
  const { red, blue, ruleModule, eventType, compLevel, tally, pRedWin } = input;

  if (!isBonusRpCompLevel(compLevel)) {
    return { redPmf: [1], bluePmf: [1] };
  }

  // This call's own tally (both alliances) — always built when the bonus
  // path runs, regardless of whether an external `tally` accumulator was
  // also supplied. Merged into the external accumulator below, never
  // replacing it.
  const callTally = emptyMarginalResolutionTally();
  const redBonus = allianceBonusRpPmf(red, ruleModule, eventType, callTally);
  const blueBonus = allianceBonusRpPmf(blue, ruleModule, eventType, callTally);
  if (tally !== undefined) {
    tally.negativeBinomial += callTally.negativeBinomial;
    tally.gaussian += callTally.gaussian;
    tally.degenerate += callTally.degenerate;
    tally.lattice += callTally.lattice;
    tally.fallbacks += callTally.fallbacks;
  }

  const outcome = matchOutcomeDistribution({
    redScoreMean: red.scoreMean,
    redScoreVariance: red.scoreVariance,
    blueScoreMean: blue.scoreMean,
    blueScoreVariance: blue.scoreVariance,
    winRp: ruleModule.winRp,
    tieRp: ruleModule.tieRp,
    ...(pRedWin !== undefined ? { pRedWin } : {}),
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
    marginalResolution: callTally,
    outcome,
  };
}
