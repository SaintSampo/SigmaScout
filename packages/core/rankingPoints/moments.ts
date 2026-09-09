/**
 * THE SEAM between a rating algorithm and SigmaScout's ranking-point layer.
 *
 * Everything else in `packages/core/rankingPoints/` is universal: the ten
 * per-season rule modules are game-manual data entry, `rules.ts` is a registry,
 * `constants.ts` is FRC domain (event tiers, RP eligibility), and
 * `distribution.ts` is Monte Carlo machinery. None of them knows what a rating
 * model is.
 *
 * This file is the one place the two halves meet. An algorithm that can fill in
 * the numbers below gets ranking points, per-bonus probabilities and the rank
 * simulation for free, for every season already registered.
 *
 * Extracted from `sigma1/rp/state.ts` on 2026-09-09, when VPR was retired and
 * the universal 84% of that work was pulled out of a dying algorithm's
 * directory. Sigma1's `buildAllianceRpMoments` remains ONE implementation of
 * this contract; it is not the contract.
 *
 * ---------------------------------------------------------------------------
 * THE ASSUMPTIONS BELOW ARE DECISIONS, NOT DEFAULTS
 * ---------------------------------------------------------------------------
 *
 * This shape was designed around Sigma1, which modelled a full per-team
 * covariance. A different algorithm may not, and the honest move is to DECIDE
 * what to supply rather than inherit VPR's answer by accident. Two places where
 * that matters:
 *
 *   - `varianceBlock` is a full T x T covariance over the threshold variables.
 *     An algorithm with no covariance structure can supply a DIAGONAL block
 *     (variances only, zero off-diagonals), which asserts the season's
 *     threshold variables are mutually independent. For 2026 that would claim
 *     `hubTotalCount` and `totalTowerPoints` are uncorrelated, which is a real
 *     claim about robots and probably false — an alliance good at one tends to
 *     be good at the other. Supplying zeros is allowed; supplying them WITHOUT
 *     noticing is the failure this comment exists to prevent.
 *
 *   - `scoreCrossCovariance` is the correlation between the alliance's total
 *     score and each threshold variable (Sigma1's D-11, learned from data
 *     rather than asserted). Zeroing it claims a high-scoring alliance is no
 *     more likely to clear a bonus threshold than a low-scoring one. Also a
 *     decision, also probably false, also fine to make deliberately.
 *
 * Sigma1 additionally summed teammates' moments under D-06's independent-teams
 * assumption. That summation is the IMPLEMENTATION's business, not this
 * contract's: this interface asks for alliance-level numbers and does not care
 * how they were reached.
 */

/** For one alliance: predicted RP-relevant moments, ready for `distribution.ts`'s joint Monte Carlo draw. */
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

/**
 * The Monte Carlo settings `rpPmfForMatch` needs.
 *
 * Replaces a `Sigma1ResolvedParams` import that reached into a whole tuned
 * parameter set for exactly two fields. Both are REQUIRED and have no default
 * on purpose: the values VPR shipped were chosen for VPR, and a new caller
 * should pick its own rather than silently inherit them. `draws` trades
 * accuracy against CPU; `seed` exists so a match's pmf is reproducible.
 */
export interface RpMonteCarloConfig {
  /** Combined with an FNV-1a hash of the match key so each match draws its own deterministic stream. */
  readonly rpMonteCarloSeed: number;
  /** Draws per match. `0` short-circuits to the degenerate no-bonus pmf. */
  readonly rpMonteCarloDraws: number;
}
