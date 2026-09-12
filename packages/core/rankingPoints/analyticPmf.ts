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
 * THE MODEL THIS FILE IMPLEMENTS (settled 2026-09-11, phase 09 plan 09-06)
 * ---------------------------------------------------------------------------
 *
 * ONE model, one path, no selectable surface. Phase 9 built three alternative
 * formulations behind a temporary config object, measured all eight
 * combinations of them against the unchanged legacy model through the
 * publisher's own scorer, and applied a per-bonus acceptance bar that had been
 * committed as executable code before any of the figures existed. THE RULE
 * ACCEPTED NONE OF THE THREE, so all three were reverted and the branches they
 * selected between were deleted along with the config object itself.
 *
 * What survives is the legacy formulation running on the CLOSED FORM that plan
 * 09-04 put in place of a 4,000-draw Monte Carlo — that engine change shipped
 * unconditionally and was never on trial:
 *
 *   - the win/loss split comes from the difference of the two alliances'
 *     independent Gaussian score distributions;
 *   - a tie has zero probability whenever that difference has positive
 *     variance, and probability one only in the degenerate equal-deterministic-
 *     means case;
 *   - each threshold variable's marginal is Gaussian.
 *
 * The measurement, the rejected formulations, their measured effects and the
 * reason each was refused are recorded in `docs/models/rp-attribution.md` and
 * `docs/models/rp-layer-config-arms.md`. Both outlive the code they describe;
 * that is deliberate, and it is why the committed measurement's schema
 * references nothing that was deleted here.
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

/**
 * A PERMANENT FALLBACK-LADDER DIAGNOSTIC: running counts of what a set of
 * `fitMarginal` calls actually RESOLVED to — `FittedMarginal.resolved`, never
 * `.declared`.
 *
 * It was introduced to stop a measurement publishing an accept/revert call for
 * a model that had silently fallen back to a different one, and it did that
 * job. It is kept, rather than deleted with the rest of that measurement's
 * scaffolding, because the thing it counts is still live and still
 * multi-valued: a variable declares Gaussian, and a fit over data that cannot
 * support any distribution still resolves to a degenerate point mass. A count
 * of how often that happens is a real diagnostic, not a toggle that lost its
 * second position.
 *
 * Its `negativeBinomial` counter is gone with the family it counted.
 *
 * `fallbacks` is counted SEPARATELY from `gaussian` — a fit that resolved to
 * what it declared is not a fallback, and conflating the two would overstate
 * how often the ladder fired (the same discipline `FittedMarginal`'s own
 * `declared`/`resolved`/`fallbackReason` split applies).
 */
export interface MarginalResolutionTally {
  gaussian: number;
  degenerate: number;
  fallbacks: number;
}

/** A fresh, all-zero `MarginalResolutionTally` — for callers that want their own counter rather than sharing `SigmaScoutLayer`'s running one. */
export function emptyMarginalResolutionTally(): MarginalResolutionTally {
  return { gaussian: 0, degenerate: 0, fallbacks: 0 };
}

/** Increments `tally` by one fitted marginal's resolved family and (separately) its fallback status. */
function accumulateMarginalResolution(tally: MarginalResolutionTally, marginal: FittedMarginal): void {
  switch (marginal.resolved) {
    case "gaussian":
      tally.gaussian += 1;
      break;
    case "degenerate":
      tally.degenerate += 1;
      break;
  }
  if (marginal.fallbackReason !== undefined) tally.fallbacks += 1;
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
 * Which `MarginalFamily` a clause's COMBINED moments may be fitted with,
 * DERIVED from the families its contributing terms declare rather than
 * asserted here. Reads `FittedMarginal.declared` — the per-variable
 * declaration site D-02 locked — so a future family extends the declarations
 * and this derivation picks it up, rather than reintroducing a global switch.
 *
 * Refuses, loudly, in both cases where no exact closed form exists. That is
 * this module's house style (`assertIndependencePrecondition`,
 * `assertPairwiseDisjoint`, `groupContribution`'s multi-bonus throw): name the
 * season, name the subject, name the violated precondition, and never fall
 * back silently to a distribution the caller did not ask for.
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
      // The Gaussian family RETURNS here rather than throwing for one reason,
      // and it is the reason the hardcoded literal this function replaced was
      // numerically correct rather than merely convenient: a sum of
      // independently-scaled Gaussians is exactly Gaussian, with the summed
      // mean and the summed scaled variance. Closure under scaled addition is
      // the whole precondition; a family without it cannot be fitted from
      // combined moments at all.
      return "gaussian";
    default: {
      // `never` so a SECOND union member fails to compile here — before it can
      // fail at runtime on real data. Whoever adds that member gets a type
      // error pointing at this arm, which is the design: they must decide
      // whether their family is closed under scaled addition, not discover the
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
 * A SINGLE UNSCALED TERM (`divisor` absent or 1) REUSES that variable's own
 * `FittedMarginal` verbatim. The clause's random variable IS the variable's,
 * so correctness here rests on identity rather than on any closure property,
 * no family derivation applies, and the variable's own `resolved` /
 * `fallbackReason` survive instead of being re-derived from its moments. The
 * structural consequence is the point: `singleThreshold` — the most common
 * predicate shape in the registry — now honours a FUTURE declared family for
 * free, including one NOT closed under scaled addition, which a refit of the
 * combined moments could never have done.
 *
 * EVERY OTHER CLAUSE builds its own marginal as the sum of its scaled terms
 * (mean and variance divided by each term's own `divisor`, summed LEFT TO
 * RIGHT in declared term order — floating-point addition is not associative,
 * and `RpLinearTerm.divisor` is always a DIVISOR, never a multiplier), fits it
 * with the family `familyForClauseSum` DERIVES from those terms' declarations,
 * and compares against the resolved threshold. A single term with a divisor
 * takes this route deliberately: `X / c` is not `X`, so closure under scaling
 * is load-bearing there and identity is not available.
 *
 * The family used to be written here as the string literal `"gaussian"`,
 * discarding whatever the contributing `RpThresholdVariable`s declared. Quick
 * task 260911-w7k removed that literal on 2026-09-11. It moved NO published
 * number — every declaration in the tree is Gaussian, which is closed under
 * scaled addition, so the derived value equals the literal it replaced; that
 * inertness is pinned by `analyticPmfGolden.json`, captured before the change
 * and green after it with exact equality. The value of the change is REACH,
 * not accuracy: a second family would now be honoured by every predicate shape
 * whose terms declare it, where before only `nestedSameVariable` — 6 of 30
 * season/bonus cells — could respond to one at all. See
 * `docs/models/rp-attribution.md` for the measurement that found that limit.
 */
function clauseProbability(
  clause: RpThresholdClause,
  marginalsByName: ReadonlyMap<string, FittedMarginal>,
  tier: EventTier,
  season: number,
  bonusName: string
): number {
  // Every term's marginal is looked up FIRST, in declared order, so the
  // missing-marginal throw still surfaces at the same term and still surfaces
  // BEFORE any threshold-resolution throw below.
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

  // Left-to-right in declared term order, dividing rather than multiplying by
  // a precomputed coefficient. Both are load-bearing per `RpLinearTerm`'s own
  // doc comment: a threshold comparison is exactly where that float difference
  // becomes observable.
  let mean = 0;
  let variance = 0;
  for (let i = 0; i < clause.terms.length; i++) {
    const divisor = clause.terms[i]!.divisor ?? 1;
    mean += marginals[i]!.mean / divisor;
    variance += marginals[i]!.variance / (divisor * divisor);
  }
  const family = familyForClauseSum(marginals, clause, season, bonusName);
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
  tally?: MarginalResolutionTally
): AllianceBonusRp {
  assertIndependencePrecondition(moments, ruleModule.season);
  const tier = eventTierFor(eventType);
  // Each variable's own declared family is honored verbatim. D-02 locked the
  // per-variable DECLARATION SITE, so this stays a per-variable read even
  // though every variable currently declares the same family — a future family
  // extends the declaration rather than reintroducing a global switch.
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
 * season's `winRp`/`tieRp`.
 */
export interface RpOutcomeInput {
  readonly redScoreMean: number;
  readonly redScoreVariance: number;
  readonly blueScoreMean: number;
  readonly blueScoreVariance: number;
  readonly winRp: number;
  readonly tieRp: number;
}

/**
 * The win/tie/loss split, from the difference of the two alliances'
 * independent Gaussian score distributions. The cross-alliance covariance
 * block is zero, so `D = redScore - blueScore` is Gaussian with
 * `meanD = red.scoreMean - blue.scoreMean` and
 * `varianceD = red.scoreVariance + blue.scoreVariance`. This reproduces the
 * deleted draw loop's `redScore > blueScore` comparison exactly — plan 09-04
 * replaced a 4,000-draw Monte Carlo with this closed form without changing
 * the model it evaluates.
 *
 * A TIE HAS PROBABILITY ZERO whenever `varianceD > 0`, because a tie would
 * need exact floating-point equality of two continuous draws. That is a known
 * and measured shortcoming, not an oversight: about 1.09% of real
 * qualification matches tie. A replacement that gave the tie its own
 * integer-margin probability was built, measured on 2023-2026 through the
 * publisher's own scorer, and REFUSED by the pre-committed per-bonus bar,
 * which reads bonus Brier and is blind to a change that only moves the
 * win/tie/loss half. `docs/models/rp-attribution.md` carries the figures,
 * including what that replacement actually achieved.
 *
 * The `varianceD <= 0` DEGENERATE branch — both alliances' predicted score
 * variance exactly zero, a deterministic score pair — is preserved exactly as
 * 09-04 shipped it, and it is the one place `pTie` can be non-zero: two equal
 * deterministic means ARE a tie. That is not the dead branch described above,
 * which is a claim about `varianceD > 0` only.
 */
export function matchOutcomeDistribution(input: RpOutcomeInput): RpOutcomeDistribution {
  const meanD = input.redScoreMean - input.blueScoreMean;
  const varianceD = input.redScoreVariance + input.blueScoreVariance;

  let pRedWin: number;
  let pTie: number;
  let pBlueWin: number;
  if (varianceD > 0) {
    pRedWin = 1 - standardNormalCdf(-meanD / Math.sqrt(varianceD));
    pTie = 0;
    pBlueWin = 1 - pRedWin;
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
   * Optional EXTERNAL accumulator (09-05 Task 3, D-01) — when supplied, this
   * call's marginal fits (both alliances) are ALSO folded into it, so a
   * caller (`SigmaScoutLayer.rpMarginalResolutionTally`) can track the
   * resolved-family mix across many calls. A call given no tally still
   * returns a correct pmf and does not throw.
   */
  readonly tally?: MarginalResolutionTally;
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
  /** THIS CALL's OWN resolved-family counts (both alliances), independent of whether `input.tally` was also supplied. Undefined for the non-qualification short-circuit, which fits no marginal at all. */
  readonly marginalResolution?: MarginalResolutionTally;
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
  const { red, blue, ruleModule, eventType, compLevel, tally } = input;

  if (!isBonusRpCompLevel(compLevel)) {
    return { redPmf: [1], bluePmf: [1] };
  }

  // THIS CALL's own tally (both alliances) — always built when the bonus
  // path runs, regardless of whether an external `tally` accumulator was
  // also supplied. Merged into the external accumulator below, never
  // replacing it (D-01, 09-05 Task 3).
  const callTally = emptyMarginalResolutionTally();
  const redBonus = allianceBonusRpPmf(red, ruleModule, eventType, callTally);
  const blueBonus = allianceBonusRpPmf(blue, ruleModule, eventType, callTally);
  if (tally !== undefined) {
    tally.gaussian += callTally.gaussian;
    tally.degenerate += callTally.degenerate;
    tally.fallbacks += callTally.fallbacks;
  }

  const outcome = matchOutcomeDistribution({
    redScoreMean: red.scoreMean,
    redScoreVariance: red.scoreVariance,
    blueScoreMean: blue.scoreMean,
    blueScoreVariance: blue.scoreVariance,
    winRp: ruleModule.winRp,
    tieRp: ruleModule.tieRp,
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
