/**
 * THE BLUE-CELL RULES, in one module, singular — so the same rule cannot be
 * applied two ways on two surfaces.
 *
 * `10-CONTEXT.md`'s "What a blue cell prints (round four)" is the source, and
 * it specifies exactly two forms:
 *
 *   MEDIAN FORM — qualification, event total, grand total: the median in bold
 *   with a range beneath it, the 10th to the 90th percentile with CONTINUOUS
 *   edges (sketch 005).
 *
 *   CHANCE FORM — alliance selection, playoffs, awards: the chance of any
 *   points in bold, and the typical amount when it happens beneath it, a
 *   conditional median. Above a 0.995 chance the cell falls back to the median
 *   form, because a near-certain event's chance carries no information while
 *   its amount does.
 *
 * WHY THE TWO FORMS EXIST AT ALL, rather than one: ranges do not add, and
 * three of the four categories have a LUMP AT ZERO whose percentile range
 * comes out honest and empty. A team that earns something in 44 runs out of a
 * hundred has a 10th percentile of zero and a 90th percentile barely above it,
 * which renders as a range saying nothing at all. The chance and the
 * conditional amount are the two numbers that do say something.
 *
 * THE BOUNDARY: this module returns NUMBERS and WHICH FORM TO USE. 10-07 turns
 * them into words. Nothing here formats anything, and no exported function
 * returns a string.
 *
 * NEITHER EDGE THIS MODULE RETURNS IS A STANDARD DEVIATION. Every interval
 * here is a percentile range, and the skill reference
 * (`.claude/skills/sketch-findings-sigmascout/references/simulation-and-compare.md`)
 * reserves the one-standard-deviation glyph for exactly one standard deviation
 * of full predictive variance. A caller must never label one of these values
 * with that glyph.
 *
 * A browser-safe leaf with exactly ONE import, the promoted estimator.
 */
import { continuousQuantile } from "../algorithms/simulation/continuousQuantile.js";

/**
 * Thrown for a zero, negative or non-finite denominator rather than dividing
 * by it. A division here yields `Infinity` or `NaN`, which then renders as a
 * plausible-looking wrong number on a cell — the failure this repo's whole
 * validate-before-compute discipline exists to prevent.
 */
export class InvalidDenominatorError extends Error {
  constructor(where: string, denominator: number) {
    super(`${where}: the denominator must be a positive finite number, got ${denominator}`);
    this.name = "InvalidDenominatorError";
  }
}

function assertDenominator(where: string, denominator: number): void {
  if (!Number.isFinite(denominator) || denominator <= 0) throw new InvalidDenominatorError(where, denominator);
}

/**
 * Thrown for a histogram carrying NO MASS AT ALL against a positive
 * denominator — an empty array, or one whose entries are all zero.
 *
 * WHY THIS IS ITS OWN REFUSAL. `chanceOfAnyPoints` is `1 - histogram[0] /
 * denominator`, so an empty histogram reads as a chance of exactly 1.0: a cell
 * printing a CONFIDENT certainty of earning points over a distribution that
 * says nothing at all, which then trips the 0.995 rule into the median form
 * over zero mass. That is the single worst shape this module can produce,
 * because nothing about it looks wrong.
 *
 * A histogram that sums to less than its denominator is a contradiction its
 * producer has to answer for, not a number to render. `ledgerSimulation.ts`'s
 * `InvalidKnownPointsError` closes the one path known to produce it (an
 * out-of-range known value silently no-opping every TypedArray write); this is
 * the second line, so no future producer can reintroduce the same confident
 * wrong number quietly.
 */
export class EmptyDistributionError extends Error {
  constructor(where: string, denominator: number) {
    super(
      `${where}: the histogram carries no mass at all against a denominator of ${String(denominator)} — ` +
        `an empty distribution has no chance and no median, and reporting one would print a confident number over nothing`
    );
    this.name = "EmptyDistributionError";
  }
}

function assertHasMass(where: string, histogram: ArrayLike<number>, denominator: number): void {
  let mass = 0;
  for (let i = 0; i < histogram.length; i++) mass += histogram[i]!;
  if (!(mass > 0)) throw new EmptyDistributionError(where, denominator);
}

/**
 * A continuous quantile on a POINTS histogram.
 *
 * DELEGATES to the promoted estimator and subtracts one. The subtraction is
 * the whole of the difference between the two axes and it lives in exactly
 * this one place: the estimator's own convention is that index `i` holds the
 * count for RANK `i + 1`, while a points histogram's index IS its point value
 * (offset zero, value equals index — `ledgerSimulation.ts` states that
 * contract). Delegating rather than adapting the estimator is what keeps
 * sketch 005's three measured defects fixed in one implementation; a second
 * copy on the points axis is exactly how they would come back. See the skill
 * reference named in this file's header.
 *
 * Bounded by construction within `[-0.5, histogram.length - 0.5]`, which is
 * the estimator's own `[0.5, length + 0.5]` shifted down by one.
 *
 * @param histogram Draw counts, or probabilities; index `i` is exactly `i` points.
 * @param p         The target percentile in `[0, 1]`.
 * @param denominator What `histogram` sums to: the draw count, or 1 for a pmf.
 */
export function pointQuantile(histogram: ArrayLike<number>, p: number, denominator: number): number {
  assertDenominator("pointQuantile", denominator);
  return continuousQuantile(histogram, p, denominator) - 1;
}

/** The three percentiles a median-form cell prints. */
export interface PointPercentiles {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

/**
 * The 10th, 50th and 90th percentiles in one object — ONE estimator call per
 * percentile and no second derivation, following the shipped three-call
 * pattern in `apps/web/src/components/event/rankRows.ts`.
 */
export function pointPercentiles(histogram: ArrayLike<number>, denominator: number): PointPercentiles {
  assertDenominator("pointPercentiles", denominator);
  return {
    p10: pointQuantile(histogram, 0.1, denominator),
    p50: pointQuantile(histogram, 0.5, denominator),
    p90: pointQuantile(histogram, 0.9, denominator),
  };
}

/**
 * The chance of any points at all: one minus the mass at the zero index.
 *
 * Derived from the histogram rather than carried beside it, for the same
 * reason `anyAwardProbability` derives its own from the pmf — two stored
 * copies of one quantity drift, and a cell's two numbers must never disagree.
 *
 * REFUSES a histogram with no mass rather than returning 1.0 for it — see
 * `EmptyDistributionError`.
 */
export function chanceOfAnyPoints(histogram: ArrayLike<number>, denominator: number): number {
  assertDenominator("chanceOfAnyPoints", denominator);
  assertHasMass("chanceOfAnyPoints", histogram, denominator);
  const atZero = histogram.length > 0 ? histogram[0]! : 0;
  return 1 - atZero / denominator;
}

/**
 * The median of the distribution RESTRICTED to the nonzero support: the
 * typical amount, given that the team earns anything at all.
 *
 * `undefined` — never 0 and never `NaN` — when all the mass sits at zero. That
 * absence is the honest answer and it is stated here rather than left to a
 * type: an event that never occurs has no typical amount, and returning 0
 * would print a number meaning "zero points when it happens" on a cell whose
 * chance is itself zero.
 *
 * The restriction is a copy with the zero bin emptied, pushed through the same
 * `pointQuantile` above, so the conditional median is the same estimator on
 * the same axis rather than a second rule.
 */
export function conditionalMedianGivenPoints(
  histogram: ArrayLike<number>,
  denominator: number
): number | undefined {
  assertDenominator("conditionalMedianGivenPoints", denominator);
  let mass = 0;
  const restricted = new Float64Array(histogram.length);
  for (let i = 1; i < histogram.length; i++) {
    const value = histogram[i]!;
    restricted[i] = value;
    mass += value;
  }
  if (mass <= 0) return undefined;
  return pointQuantile(restricted, 0.5, mass);
}

/**
 * The chance above which a cell stops printing its chance and prints its
 * median instead — `10-CONTEXT.md`'s own 0.995. An exported named constant
 * rather than a literal at the comparison, so the threshold has exactly one
 * definition and a test can pin it.
 */
export const POINT_CELL_CHANCE_FORM_THRESHOLD = 0.995;

/** What a blue cell should print: the numbers, and which of CONTEXT's two forms they belong to. */
export type PointCellSummary =
  | {
      readonly form: "chance";
      readonly chance: number;
      /** `undefined` when the chance is zero — see `conditionalMedianGivenPoints`. */
      readonly conditionalMedian: number | undefined;
    }
  | {
      readonly form: "median";
      readonly percentiles: PointPercentiles;
    };

/**
 * Applies CONTEXT's rule to one points histogram.
 *
 * At or above `POINT_CELL_CHANCE_FORM_THRESHOLD` the cell takes the median
 * form. Below it the cell takes the chance form — INCLUDING at a chance of
 * exactly zero, where the conditional median is `undefined` and 10-07 prints
 * the chance alone.
 *
 * Inherits `chanceOfAnyPoints`'s `EmptyDistributionError` refusal: a histogram
 * with no mass has no form to take.
 */
export function pointCellSummary(histogram: ArrayLike<number>, denominator: number): PointCellSummary {
  assertDenominator("pointCellSummary", denominator);
  assertHasMass("pointCellSummary", histogram, denominator);
  const chance = chanceOfAnyPoints(histogram, denominator);
  if (chance >= POINT_CELL_CHANCE_FORM_THRESHOLD) {
    return { form: "median", percentiles: pointPercentiles(histogram, denominator) };
  }
  return { form: "chance", chance, conditionalMedian: conditionalMedianGivenPoints(histogram, denominator) };
}
