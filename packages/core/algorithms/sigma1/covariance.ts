/**
 * D-03's per-team component covariance and D-10's full alliance-total
 * predictive-variance quadratic form (RESEARCH.md Pitfall Sigma1-3).
 *
 * This covariance is between a SINGLE TEAM'S OWN COMPONENTS (a team good at
 * auto tends also to be good at teleop) — never between teams. A cross-team
 * joint covariance would reintroduce OPR's O(n^2) cost (RESEARCH.md
 * Pattern 2, `opr.ts`'s `IncrementalInverse`) and estimate a structure D-06
 * already rules out (no cross-team latent, no defensive dimension).
 * `emptyCovariance`/`ewmaCovariance` below track exactly one CxC matrix per
 * team, C being that season's component count (at most about 12 for the
 * largest 2022-2026 component set, per `breakdown/*.ts`) — small, dense
 * math with no inversion on the hot path, unlike `opr.ts`'s
 * `SingularValueDecomposition` solve.
 *
 * Per-team residuals are not directly observed — the observation an
 * alliance-sum Kalman update (`kalman.ts`) sees is a SUM across teammates.
 * `sigma1/index.ts`'s `update` attributes team j's residual for a component
 * as `K_j * innovation` — the gain-weighted share `updateAllianceSum`
 * already computes internally — before folding it into `ewmaCovariance`
 * below. This is a stated modeling choice: there is no way to recover an
 * individual team's exact residual from a summed observation without
 * assuming something, and the Kalman gain is the least-arbitrary available
 * assumption (it is already how the update itself apportions credit for
 * the innovation).
 */

/** `1^T Sigma 1` — the variance of a team's TOTAL score contribution, summing every entry of its component covariance matrix, not just the diagonal (a diagonal-only sum silently drops cross-component correlation and understates every match's ±, Pitfall Sigma1-3). */
export function teamTotalVariance(covariance: readonly (readonly number[])[]): number {
  let total = 0;
  for (const row of covariance) {
    for (const value of row) total += value;
  }
  return total;
}

/**
 * The variance of a SUBSET of components summed together — the same
 * quadratic form `teamTotalVariance` computes, restricted to `indices`.
 *
 * Var(sum of X_i for i in S) = sum over i,j in S of Cov(X_i, X_j)
 *
 * This is what makes a phase group's `X ± Y` honest. The off-diagonal terms
 * are the whole point and are decidedly non-zero — this file exists because
 * a team good at auto tends also to be good at teleop — so a client summing
 * published per-component spreads (which carry no covariance) could not
 * reproduce this number, in quadrature or otherwise.
 *
 * `teamTotalVariance` is exactly this function over every index, and is
 * kept as its own named entry point because `allianceTotalPredictiveVariance`
 * and the D-10 link function both read as "the team's total", not as "a
 * subset that happens to be everything".
 *
 * Out-of-range indices are ignored rather than throwing: a season whose
 * grouping names a component the covariance matrix does not carry (an
 * unregistered season, or a component order still empty before the first
 * update) contributes nothing instead of producing NaN.
 */
export function subsetVariance(covariance: readonly (readonly number[])[], indices: readonly number[]): number {
  let total = 0;
  for (const i of indices) {
    const row = covariance[i];
    if (row === undefined) continue;
    for (const j of indices) {
      const value = row[j];
      if (value === undefined) continue;
      total += value;
    }
  }
  return total;
}

/**
 * D-03/D-10: the alliance's total predictive-variance contribution from its
 * teammates' own component covariances, summed across teammates under the
 * independent-teams assumption (Pattern 2) — never a cross-team joint
 * covariance (see file header).
 */
export function allianceTotalPredictiveVariance(teamCovariances: readonly (readonly (readonly number[])[])[]): number {
  return teamCovariances.reduce((sum, cov) => sum + teamTotalVariance(cov), 0);
}

/** A fresh, all-zero CxC covariance matrix for a team with no residual history yet — the update path folds real structure in as observations arrive. */
export function emptyCovariance(componentCount: number): number[][] {
  return Array.from({ length: componentCount }, () => new Array<number>(componentCount).fill(0));
}

/**
 * EWMA rate for `ewmaCovariance`'s fold step. Phase 3 hyperparameter,
 * default unverified — chosen small so one unusual match does not swing a
 * team's covariance matrix drastically, mirroring `consistency.ts`'s own
 * EWMA-rate reasoning.
 */
export const SIGMA1_COV_EWMA_ALPHA = 0.1;

/**
 * Constant shrinkage toward the diagonal applied by `ewmaCovariance`,
 * `Sigma_shrunk = (1 - s) * Sigma + s * diag(Sigma)`: off-diagonal entries
 * are scaled by `(1 - s)`, diagonal entries are left exactly as folded (the
 * diagonal of `diag(Sigma)` equals `Sigma`'s own diagonal, so the `(1-s)` +
 * `s` terms recombine to the unshrunk value there). Keeps every folded
 * matrix positive semi-definite even over a rank-deficient early-season
 * residual history (a convex combination of PSD matrices — the EWMA'd
 * outer-product term and its own diagonal — is itself PSD), the same
 * numerical-stability instinct behind `opr.ts`'s `OPR_RIDGE_LAMBDA` and the
 * reason `opr.ts` reaches for `ml-matrix`'s SVD rather than a hand-rolled
 * elimination when a matrix must actually be inverted (this module never
 * inverts one). Phase 3 hyperparameter, default unverified.
 */
export const SIGMA1_COV_SHRINKAGE = 0.3;

function shrinkTowardDiagonal(matrix: readonly (readonly number[])[], shrinkage: number): number[][] {
  return matrix.map((row, i) => row.map((value, j) => (i === j ? value : (1 - shrinkage) * value)));
}

/**
 * Folds one residual vector's outer product into `prior` via an EWMA
 * (`(1 - alpha) * prior + alpha * outer(residual, residual)`), then applies
 * `shrinkage`'s diagonal shrinkage for numerical stability. Both trailing
 * arguments default to this module's own `SIGMA1_COV_EWMA_ALPHA`/
 * `SIGMA1_COV_SHRINKAGE` so every pre-Phase-3 call site keeps compiling and
 * behaving identically; `sigma1/index.ts` (Phase 3) passes
 * `params.covEwmaAlpha`/`params.covShrinkage` explicitly instead.
 * `residual` must be ordered consistently with `prior`'s row/column
 * indices (the season's canonical component order) across every call for a
 * given team — `sigma1/index.ts` owns that ordering discipline.
 */
export function ewmaCovariance(
  prior: readonly (readonly number[])[],
  residual: readonly number[],
  alpha: number = SIGMA1_COV_EWMA_ALPHA,
  shrinkage: number = SIGMA1_COV_SHRINKAGE
): number[][] {
  const n = residual.length;
  const folded: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const priorValue = prior[i]?.[j] ?? 0;
      const outer = residual[i]! * residual[j]!;
      return (1 - alpha) * priorValue + alpha * outer;
    })
  );
  return shrinkTowardDiagonal(folded, shrinkage);
}
