// Small, dependency-free statistics helpers shared across the app and pipeline.

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation.
 * Max abs error ~1.5e-7 — plenty for win-probability display.
 */
export function normalCdf(x: number, mean = 0, stdDev = 1): number {
  if (stdDev <= 0) {
    // Degenerate distribution: a step at the mean.
    return x < mean ? 0 : x > mean ? 1 : 0.5;
  }
  const z = (x - mean) / stdDev;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * P(A > B) for two independent Gaussians. The difference A−B is Gaussian with
 * mean muA−muB and variance varA+varB, so this is just a CDF evaluation.
 */
export function probAGreaterThanB(
  meanA: number,
  varA: number,
  meanB: number,
  varB: number,
): number {
  const diffMean = meanA - meanB;
  const diffStd = Math.sqrt(Math.max(varA + varB, 1e-9));
  // P(A - B > 0) = 1 - CDF(0) = CDF(diffMean / diffStd)
  return normalCdf(diffMean / diffStd);
}
