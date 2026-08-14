/**
 * D-12's three selectable win-probability link modes, implemented per
 * RESEARCH.md § Code Examples largely as given. All three are runnable
 * side by side in one harness run (`sigma1/index.ts`'s `makeSigma1`
 * assembles one `AlgorithmModule` per mode) so the choice between them is
 * settled by measured Brier/accuracy, not argument — the instrument
 * Statbotics itself does not have (their `EPARating` docstring: "does not
 * handle covariance between variables", and their own `pred_sd` line sits
 * commented out above their win-probability calculation).
 *
 *   1. `season-sd` — logistic on `margin / seasonScoreSd`. Statbotics
 *      parity (`opr.ts`'s `logisticWinProbability` shape, `epa.ts`'s own
 *      win-probability calc).
 *   2. `predictive-variance` — logistic on `margin / (c * sqrt(predictive
 *      Variance))`. D-12's NESTED DEFAULT: substituting
 *      `predictiveVariance = (seasonScoreSd / c)^2` makes this mode
 *      ALGEBRAICALLY IDENTICAL to mode 1 (see the nesting-property test in
 *      `linkFunctions.test.ts`) — the honest way to ask "does per-match
 *      variance improve accuracy over a season constant?" as a measured
 *      number rather than an assertion.
 *   3. `normal-cdf` — normal CDF on the predictive variance directly.
 *      Deferred idea (RESEARCH.md's Deferred Ideas): shipped as a fully
 *      working branch now so a future revisit is a flag flip, not a
 *      rewrite, but NOT the default.
 */

export type WinProbMode = "season-sd" | "predictive-variance" | "normal-cdf";

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Abramowitz-Stegun formula 7.1.26 erf approximation (max absolute error
 * under 1.5e-7) — a standard, deterministic, dependency-free closed form
 * (RESEARCH.md's "Don't Hand-Roll" table: this specific approximation is
 * the recommended alternative to a from-scratch numerical integration of
 * the Gaussian PDF, unlike matrix inversion which genuinely should not be
 * hand-rolled).
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Standard normal CDF of `x` scaled by `sd`, via `erf`. `sd <= 0` is a
 * documented degenerate branch (a genuinely zero or negative predictive
 * variance has no spread to integrate over): resolves to the sign-only
 * step function `x > 0 -> 1`, `x < 0 -> 0`, `x === 0 -> 0.5`, rather than
 * dividing by zero and emitting NaN/Infinity.
 */
export function normalCdf(x: number, sd: number): number {
  // Exact at x=0 regardless of sd (a normal CDF centered at 0 is exactly
  // 0.5 there by symmetry) — special-cased because the erf approximation
  // below carries a documented ~1.5e-7 max error that would otherwise leak
  // a tiny nonzero residual into this exact boundary value.
  if (x === 0) return 0.5;
  if (sd <= 0) return x > 0 ? 1 : 0;
  return 0.5 * (1 + erf(x / (sd * Math.SQRT2)));
}

/**
 * D-12's default `c` for mode 2's denominator scale. Phase 3
 * hyperparameter, default unverified.
 */
export const SIGMA1_LINK_C = 1.0;

/**
 * `margin` is `redScore - blueScore`. `seasonScoreSd` MUST be the
 * expanding-window value from `expandingStats.ts` (never a season-final
 * constant) — passing a season-batch SD here is the exact leakage Pitfall
 * EPA-1 describes, and this parameter is exactly where it would enter.
 * `predictiveVariance` is D-10's full `P + Q + R` alliance total from
 * `sigma1/index.ts`'s `predict`, combined red+blue.
 *
 * `predictiveVariance <= 0` (mode 2/3 only) is a documented degenerate
 * branch: mode 2 falls back to a sign-only step function at `margin`
 * (matching mode 3's `normalCdf` boundary behavior at `sd <= 0`) instead of
 * dividing by zero; mode 3 delegates to `normalCdf`'s own `sd <= 0` branch
 * via `Math.sqrt(Math.max(0, predictiveVariance))`.
 */
export function winProbability(
  mode: WinProbMode,
  margin: number,
  seasonScoreSd: number,
  predictiveVariance: number,
  c: number = SIGMA1_LINK_C
): number {
  switch (mode) {
    case "season-sd":
      return logistic(margin / seasonScoreSd);
    case "predictive-variance": {
      if (predictiveVariance <= 0) {
        return margin === 0 ? 0.5 : margin > 0 ? 1 : 0;
      }
      return logistic(margin / (c * Math.sqrt(predictiveVariance)));
    }
    case "normal-cdf":
      return normalCdf(margin, Math.sqrt(Math.max(0, predictiveVariance)));
  }
}
