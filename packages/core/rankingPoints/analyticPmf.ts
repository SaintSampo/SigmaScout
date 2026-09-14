/**
 * The closed-form RP pmf: one marginal per threshold variable
 * (`marginals.ts`), bonuses grouped by shared threshold variable and
 * enumerated from marginal CDFs, groups convolved into a bonus-only pmf, and
 * that pmf convolved with the win/tie outcome half.
 *
 * Exact because `momentsFor` builds a diagonal `varianceBlock` and a zero
 * `scoreCrossCovariance`, so the joint is independent. The precondition is
 * asserted on every call (`assertIndependencePrecondition`): a real
 * correlation would otherwise be silently discarded.
 *
 * Highest-risk case: 2026's `energized`/`supercharged` both threshold
 * `hubTotalCount`, and supercharged implies energized. Independent Bernoullis
 * would understate `P(both)`; `groupContribution`'s `nestedSameVariable`
 * interval enumeration gets it right.
 *
 * The model:
 *   - each marginal is the lattice family its season declares: a bounded
 *     beta-binomial/binomial where the rules cap the value, otherwise a
 *     Gaussian discretized onto the rule step. Multi-term or divided clauses
 *     are summed by exact lattice convolution, not refitted. The Gaussian
 *     and negative-binomial branches are unused by every current season;
 *   - the alliance means carry the walk-forward mean shift (`meanShift.ts`),
 *     applied by the caller;
 *   - the win/tie/loss split comes from `D = redScore - blueScore`, with
 *     independent Gaussian scores. A tie is the integer margin rounding to
 *     zero (`tieProbability`); the decisive share is `P(D > 0)` or, when the
 *     caller supplies `pRedWin`, that win probability, split proportionally
 *     against `1 - pTie`. Measurements: `docs/models/rp-layer-config-arms.md`.
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
 * Running counts of what `fitMarginal` calls resolved to (`resolved`, never
 * `declared`). `fallbacks` counts fits with a `fallbackReason`, separately
 * from the family counts.
 */
export interface MarginalResolutionTally {
  negativeBinomial: number;
  gaussian: number;
  degenerate: number;
  /** Fits that resolved to the lattice family. A lattice shape fallback also counts in `fallbacks`. */
  lattice: number;
  fallbacks: number;
}

/** A fresh, all-zero `MarginalResolutionTally` — for callers that want their own counter rather than sharing `SigmaScoutLayer`'s running one. */
export function emptyMarginalResolutionTally(): MarginalResolutionTally {
  return { negativeBinomial: 0, gaussian: 0, degenerate: 0, lattice: 0, fallbacks: 0 };
}

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
// convolvePmf: plain polynomial multiplication, the one convolution routine.
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

/** Throws unless every `scoreCrossCovariance` and off-diagonal `varianceBlock` entry is zero. */
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
// One clause's probability from the alliance's fitted marginals.
// ---------------------------------------------------------------------------

function footprintOfClause(clause: RpThresholdClause): Set<string> {
  return new Set(clause.terms.map((term) => term.variable));
}

function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

/**
 * Which `MarginalFamily` a clause's terms are summed in, derived from the
 * terms' declared families. Throws where no exact closed form exists rather
 * than falling back silently to an unrequested distribution.
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
      // A sum of independently-scaled Gaussians is exactly Gaussian.
      return "gaussian";
    case "negative-binomial":
      // Not closed under scaled addition, so combined moments cannot be fitted.
      throw new Error(
        `analyticRpPmf: season ${season} bonus "${bonusName}" sums scaled terms all declaring "negative-binomial" over variables {${clause.terms.map((term) => term.variable).join(", ")}}, which is not closed under scaled addition — a sum of independent negative binomials is negative binomial only when every p matches, and a divided term is not even integer-supported, so implement that joint explicitly or declare "gaussian" on every variable appearing in a multi-term or divisor-bearing clause`
      );
    case "lattice":
      // Not closed either, but needs no refit: the caller sums the terms by exact lattice convolution.
      return "lattice";
    default: {
      // A new family fails to compile here, forcing a decision on closure under scaled addition.
      const exhaustive: never = family;
      throw new Error(
        `analyticRpPmf: season ${season} bonus "${bonusName}" sums scaled terms all declaring "${String(exhaustive)}", which is not closed under scaled addition — a sum of its scaled terms has no exact closed form in that family, so implement that joint explicitly rather than fitting the combined moments with it`
      );
    }
  }
}

/**
 * One clause's probability. A single unscaled term reuses that variable's own
 * `FittedMarginal` verbatim, so its `resolved`/`fallbackReason` survive.
 *
 * Every other clause (including a single divided term, since `X / c` is not
 * `X`) is summed on the lattice when its terms declare "lattice", otherwise
 * fitted from combined moments summed left to right in declared term order
 * (floating-point addition is not associative).
 */
function clauseProbability(
  clause: RpThresholdClause,
  marginalsByName: ReadonlyMap<string, FittedMarginal>,
  tier: EventTier,
  season: number,
  bonusName: string
): number {
  // Look up every marginal first, so a missing marginal throws before any threshold-resolution throw.
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
    const terms = marginals.map((marginal, i) => divideLatticePmf(materializeLatticeMarginal(marginal), clause.terms[i]!.divisor ?? 1));
    return latticeSumTail(terms, resolveRpThreshold(clause.threshold, tier), clause.direction);
  }

  // Divide rather than multiply by a precomputed coefficient: the float difference shows at a threshold.
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
          `analyticRpPmf: season ${season} bonus "${bonusName}"'s ${label} are not pairwise disjoint — the exact form used here requires independence between them`
        );
      }
    }
  }
}

/**
 * One bonus's own probability, dispatched by `BonusPredicate.kind`. Never
 * called for `"nestedSameVariable"`, whose probability depends on its
 * siblings and is handled by `groupContribution`.
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
// Group bonuses by shared threshold variable, enumerate each group's outcomes.
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

/** Connected components over variable footprints: bonuses share a group iff their footprints intersect. */
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
 * One group's contribution pmf ("how many of this group's bonuses fire"):
 *   - every member `nestedSameVariable` over one variable and direction ->
 *     the telescoping interval enumeration (exact for size 1 too).
 *   - a single non-nested bonus -> `[1 - p, p]`.
 *   - anything else throws, never a silent product of independents.
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
    `analyticRpPmf: season ${season} has a multi-bonus group {${group.map((p) => p.name).join(", ")}} with no exact joint form implemented — dependence between distinct threshold variables is deliberately out of scope; a silent product-of-independents fallback is the one outcome this throw exists to prevent`
  );
}

// ---------------------------------------------------------------------------
// Fit marginals, group, convolve into the bonus-only pmf.
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

/** One alliance's bonus-only RP distribution: fit marginals, group bonuses, enumerate and convolve each group. */
export function allianceBonusRpPmf(
  moments: AllianceRpMoments,
  ruleModule: RpRuleModule,
  eventType: number,
  tally?: MarginalResolutionTally
): AllianceBonusRp {
  assertIndependencePrecondition(moments, ruleModule.season);
  const tier = eventTierFor(eventType);
  // Per-variable declared family, deliberately not a global switch.
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
// The outcome half.
// ---------------------------------------------------------------------------

/** The win/tie/loss probabilities for one match, plus the season's own `winRp`/`tieRp` (a caller composes its outcome vectors against these). */
export interface RpOutcomeDistribution {
  readonly pRedWin: number;
  readonly pTie: number;
  readonly pBlueWin: number;
  readonly winRp: number;
  readonly tieRp: number;
}

/** Half-width of the margin bin that rounds to a tie: FRC scores are integers, so a tie is the latent margin in `(-0.5, 0.5)`. Structural. */
const TIE_MARGIN_HALF_WIDTH = 0.5;

/**
 * The probability a Gaussian latent score margin rounds to zero:
 * `Phi((0.5 - mean) / sd) - Phi((-0.5 - mean) / sd)`. A non-finite or
 * non-positive variance takes the deterministic limit before any division.
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
 * Input to `matchOutcomeDistribution`: each alliance's own predicted score
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
  /**
   * The algorithm's published `Prediction.pRedWin`, used in place of the
   * score-draw `P(D > 0)`. Absent from `fieldAveraged.ts`, which prices a
   * hypothetical match with no `Prediction`.
   */
  readonly pRedWin?: number;
}

/**
 * The win/tie/loss split. `D = redScore - blueScore` is Gaussian with the
 * summed variance (the cross-alliance covariance is zero).
 *
 * With `varianceD > 0`, the win probability (`input.pRedWin`, else
 * `P(D > 0)`) and `tieProbability` split proportionally, so
 * `pRedWin / (pRedWin + pBlueWin)` equals that win probability exactly. A
 * finite out-of-range win probability is clamped; a non-finite one is left
 * to fail the normalization check rather than be laundered into a
 * plausible pmf.
 *
 * With `varianceD <= 0` the deterministic means are compared directly and
 * `input.pRedWin` is ignored.
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
// The final pmf.
// ---------------------------------------------------------------------------

/** Input to `analyticRpPmf`. The closed form consumes no randomness. */
export interface AnalyticRpPmfInput {
  readonly red: AllianceRpMoments;
  readonly blue: AllianceRpMoments;
  readonly ruleModule: RpRuleModule;
  readonly eventType: number;
  readonly compLevel: CompLevel;
  /** Optional external accumulator this call's marginal fits (both alliances) are also folded into. */
  readonly tally?: MarginalResolutionTally;
  /** Forwarded to `RpOutcomeInput.pRedWin`. */
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

/** Mean of a discrete pmf, derived at read time; mean and SD are never stored alongside the pmf. */
export function pmfMean(pmf: readonly number[]): number {
  let mean = 0;
  for (let i = 0; i < pmf.length; i++) mean += i * pmf[i]!;
  return mean;
}

/**
 * One match's full RP pmf for both alliances. A non-qualification
 * `compLevel` short-circuits to `P(RP=0)=1` with no marginal fitted.
 */
export function analyticRpPmf(input: AnalyticRpPmfInput): AnalyticRpPmfResult {
  const { red, blue, ruleModule, eventType, compLevel, tally, pRedWin } = input;

  if (!isBonusRpCompLevel(compLevel)) {
    return { redPmf: [1], bluePmf: [1] };
  }

  // This call's own tally, always built, then merged into any external `tally`.
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
