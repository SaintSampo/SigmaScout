/**
 * The seam between a rating algorithm and the ranking-point layer: an
 * algorithm that fills in these alliance-level numbers gets ranking points,
 * per-bonus probabilities and the rank simulation for every registered season.
 *
 * Two fields carry decisions, not defaults:
 *   - A diagonal `varianceBlock` asserts the season's threshold variables are
 *     mutually independent, which is probably false.
 *   - A zero `scoreCrossCovariance` claims a high-scoring alliance is no more
 *     likely to clear a bonus threshold than a low-scoring one.
 * Supplying either is allowed; supplying it without noticing is the failure.
 */

/** For one alliance: predicted RP-relevant moments, consumed by `analyticPmf.ts`'s closed-form pmf. */
export interface AllianceRpMoments {
  /** Threshold-variable names, in `ruleModule.thresholdVariables` order — every other array/matrix here is indexed against this order. */
  readonly variableNames: readonly string[];
  /** Alliance-level mean vector over threshold variables. */
  readonly meanVector: readonly number[];
  /** T x T alliance-level covariance block over threshold variables. See this file's header before supplying a diagonal. */
  readonly varianceBlock: readonly (readonly number[])[];
  /** The alliance's predicted SCORE mean — whatever the algorithm's own `predict` already computed, passed in rather than recomputed here. */
  readonly scoreMean: number;
  /** The alliance's predicted SCORE variance — this alliance's own, NOT a combined-both-alliances figure. */
  readonly scoreVariance: number;
  /** Length-T cross-covariance between the alliance's total score and each threshold variable. See this file's header before supplying zeros. */
  readonly scoreCrossCovariance: readonly number[];
}
