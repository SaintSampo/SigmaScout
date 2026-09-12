/**
 * NEGATIVE-BINOMIAL / GAUSSIAN / DEGENERATE marginal fitting and evaluation —
 * a ZERO-RUNTIME-IMPORT browser-safe leaf per **D-08**. Its only import is a
 * TYPE-ONLY import of the marginal-family union from `./constants.js`, which
 * erases at build time — the leaf property survives into the client bundle.
 * `apps/web` runs the exact same pure function real matches use, exactly the
 * shape `packages/core/algorithms/simulation/rankSimulation.ts` established.
 *
 * ---------------------------------------------------------------------------
 * THE PINNED PARAMETERIZATION (D-01) — written out once, never re-derived
 * ---------------------------------------------------------------------------
 *
 * Method-of-moments fit of a negative binomial to a (mean, variance) pair:
 *
 *   r = mean² / (variance − mean)
 *   p = mean / (mean + r)
 *   P(X = k) = C(k + r − 1, k) · (1 − p)^r · p^k
 *   mean = r·p / (1 − p)
 *   variance = r·p / (1 − p)²
 *
 * These four identities are mutually consistent; `r` and `p` must never be
 * re-derived at a call site. Chosen (09-CONTEXT.md D-01) because it is
 * count-native and right-skewed — a symmetric Gaussian under-predicts
 * `P(X ≥ t)` exactly where bonus thresholds sit — has an exact discrete CDF
 * at integer thresholds, support `[0, ∞)`, and handles the overdispersion
 * alliance totals plainly have. 09-RESEARCH.md's corpus probe measured 15
 * threshold variables across 7 seasons, all 100% integer-valued, variance/
 * mean 1.27-102.3 — that rules out a Poisson by dispersion (Poisson forces
 * variance = mean) and a continuity-corrected normal by shape (still
 * symmetric).
 *
 * ---------------------------------------------------------------------------
 * erf — SAME-PACKAGE VERBATIM COPY, cited rather than imported or re-derived
 * ---------------------------------------------------------------------------
 *
 * Copied byte-for-byte from `packages/core/algorithms/sigma1/linkFunctions.ts:41-49`
 * (Abramowitz-Stegun formula 7.1.26, max absolute error under 1.5e-7). Four
 * copies of this formula exist in the tree already
 * (`packages/core/algorithms/spr.ts:303`, `packages/spr/model.ts:215`,
 * `packages/pcm/model.ts:135`, and `linkFunctions.ts` itself);
 * `linkFunctions.ts` is the copy source because it is the only one inside
 * `packages/core`, so copying it — rather than importing across the package
 * boundary — avoids the exact cross-package import D-08 exists to prevent.
 * Copied rather than re-derived per 09-RESEARCH.md's "cite, don't
 * hand-roll" framing: a from-scratch numerical integration of the Gaussian
 * PDF is exactly the kind of thing that should not be reinvented per call
 * site.
 */
import type { MarginalFamily, RpThresholdVariable } from "./constants.js";
import type { AllianceRpMoments } from "./moments.js";

/**
 * Abramowitz-Stegun formula 7.1.26 erf approximation (max absolute error
 * under 1.5e-7). Verbatim copy of `linkFunctions.ts:41-49` — see this file's
 * header for why copied rather than imported or re-derived.
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
 * Standard normal CDF of an ALREADY-STANDARDIZED `z`. Deliberately NOT named
 * `normalCdf` (`linkFunctions.ts`'s name): that function takes a raw value
 * and a scale (`normalCdf(x, sd)`); this one takes a pre-standardized `z`.
 * Two same-named functions with different signatures in one project is a
 * footgun this leaf does not introduce.
 *
 * Carries over `normalCdf`'s exact-at-zero special case: the raw erf
 * approximation's ~1.5e-7 max error would otherwise leak a tiny nonzero
 * residual into z=0, where the true answer is exactly 0.5 by symmetry.
 */
export function standardNormalCdf(z: number): number {
  if (z === 0) return 0.5;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Hard cap on the negative-binomial upper-tail summation loop (T-09-03-02) — see `probAtLeast` below. */
export const NB_MAX_TAIL_TERMS = 100_000;

/**
 * What a fit RESOLVED to. A superset of the declared `MarginalFamily` union —
 * `"degenerate"` is a RESOLUTION (the fallback ladder's own answer when a
 * point mass is the only honest thing to fit), never a DECLARATION — which is
 * why this type and `MarginalFamily` are named and typed separately.
 */
export type ResolvedMarginalFamily = "negative-binomial" | "gaussian" | "degenerate";

/**
 * Why a fit resolved to something OTHER than its declared family. Absent
 * (`undefined`) when `resolved === declared`, INCLUDING when the declared
 * family is the Gaussian inert default — the inert default is not a
 * fallback, and mislabelling it as one would corrupt 09-06's fallback
 * counts (T-09-03-04).
 */
export type MarginalFallbackReason = "non-finite" | "zero-variance" | "non-positive-mean" | "variance-le-mean";

/**
 * The outcome of fitting one threshold variable's marginal. Carries THREE
 * separate facts — `declared`, `resolved`, `fallbackReason` — deliberately
 * never collapsed into one, so a measurement can count how often an arm
 * labelled `"negative-binomial"` actually resolved to one (T-09-03-04). That
 * counting is the reason the separation exists and the reason it is kept: the
 * fallback ladder is live, and a fit that degenerates is not a fit that was
 * declared degenerate.
 */
export interface FittedMarginal {
  readonly declared: MarginalFamily;
  readonly resolved: ResolvedMarginalFamily;
  readonly mean: number;
  readonly variance: number;
  /** Negative-binomial shape parameter. Present only when `resolved === "negative-binomial"`. */
  readonly r?: number;
  /** Negative-binomial probability parameter, in `(0, 1)`. Present only when `resolved === "negative-binomial"`. */
  readonly p?: number;
  /** Standard deviation. Present only when `resolved === "gaussian"`. */
  readonly sd?: number;
  readonly fallbackReason?: MarginalFallbackReason;
}

/**
 * Fits one marginal from a (mean, variance) pair and a DECLARED family, per
 * the ordered fallback ladder (Pitfall 3, T-09-03-01). Ordered and
 * documented branch by branch — precedence matters, and a later branch is
 * never reached once an earlier one fires:
 *
 *   1. Either input non-finite -> degenerate AT 0, reason "non-finite". A
 *      loud throw inside a pure leaf would abort a whole publish over one bad
 *      match; this project's established discipline for an unparseable
 *      observation is to degrade to a COUNTED skip, and `fallbackReason` is
 *      that count's mechanism.
 *   2. `variance <= 0` -> degenerate AT `mean` (the raw, continuous mean —
 *      NEVER rounded; a cold roster's mean is a sum of EWMA beliefs), reason
 *      "zero-variance". Reproduces `predictThresholds`'s boolean limit
 *      exactly. 09-04's all-variance-zero degeneracy case lands here.
 *   3. Declared "gaussian" -> resolved "gaussian", sd = sqrt(variance), NO
 *      fallbackReason — a declared family resolving to itself is not a
 *      fallback, and mislabelling it as one would corrupt any count taken
 *      over this ladder.
 *   4. Declared "negative-binomial":
 *        - `mean <= 0` -> Gaussian, reason "non-positive-mean".
 *        - `variance <= mean` -> Gaussian, reason "variance-le-mean" (this
 *          is where the method-of-moments fit is mathematically undefined —
 *          `r` would divide by zero or go negative).
 *        - otherwise: `r = mean²/(variance−mean)`, `p = mean/(mean+r)`.
 *
 * The Gaussian choice for both NB fallback branches is deliberate against
 * two alternatives Pitfall 3 names: clamping to a minimum dispersion invents
 * overdispersion the data does not show at that moment, and adding a Poisson
 * branch is a third CDF to maintain for a case that only arises on thin
 * data. Falling back to the family that shipped before cannot be a
 * regression against today's behavior.
 *
 * BOTH NB FALLBACKS ARE COUNTED AS FALLBACKS, and that counting is not
 * bookkeeping — it is what separates "the family lost" from "the fit did not
 * apply". Under-dispersion (`variance <= mean`) is a live possibility for
 * several of these variables, and an arm labelled negative binomial whose
 * fits mostly fell back to Gaussian would otherwise be indistinguishable from
 * a genuine one. See `MarginalResolutionTally` in `analyticPmf.ts`.
 */
export function fitMarginal(mean: number, variance: number, declared: MarginalFamily): FittedMarginal {
  if (!Number.isFinite(mean) || !Number.isFinite(variance)) {
    return { declared, resolved: "degenerate", mean: 0, variance: 0, fallbackReason: "non-finite" };
  }

  if (variance <= 0) {
    return { declared, resolved: "degenerate", mean, variance, fallbackReason: "zero-variance" };
  }

  if (declared === "gaussian") {
    return { declared, resolved: "gaussian", mean, variance, sd: Math.sqrt(variance) };
  }

  // declared === "negative-binomial" from here.
  if (mean <= 0) {
    return { declared, resolved: "gaussian", mean, variance, sd: Math.sqrt(variance), fallbackReason: "non-positive-mean" };
  }
  if (variance <= mean) {
    return { declared, resolved: "gaussian", mean, variance, sd: Math.sqrt(variance), fallbackReason: "variance-le-mean" };
  }

  const r = (mean * mean) / (variance - mean);
  const p = mean / (mean + r);
  return { declared, resolved: "negative-binomial", mean, variance, r, p };
}

/**
 * `fitAllianceMarginals` — reads ONLY the diagonal of `moments.varianceBlock`
 * (see `moments.ts`'s own header for why the block is diagonal by
 * construction). The off-diagonals are read as nothing, deliberately: F4's
 * deferred dependence-between-threshold-variables work lives there and this
 * module does not touch it.
 *
 * A variable absent from `variables` (a season module 09-02 has not reached
 * yet) defaults to `"gaussian"` rather than throwing — degrading to today's
 * behavior instead of aborting.
 */
export function fitAllianceMarginals(moments: AllianceRpMoments, variables: readonly RpThresholdVariable[]): Map<string, FittedMarginal> {
  const declaredByName = new Map(variables.map((v) => [v.name, v.marginalFamily] as const));
  const fits = new Map<string, FittedMarginal>();
  for (let i = 0; i < moments.variableNames.length; i++) {
    const name = moments.variableNames[i]!;
    const mean = moments.meanVector[i]!;
    const variance = moments.varianceBlock[i]![i]!;
    const declared = declaredByName.get(name) ?? "gaussian";
    fits.set(name, fitMarginal(mean, variance, declared));
  }
  return fits;
}

// ---------------------------------------------------------------------------
// Negative-binomial exact discrete CDF — log-space, never a float ratio of
// factorials, never a normal approximation.
//
// This block was deleted on 2026-09-11 (plan 09-06) and RESTORED VERBATIM on
// 2026-09-12 (quick task 260912-2uz) from commit 2731bfab, not rewritten from
// memory: the log-space recurrence, the lower-sum-then-switch ordering that
// avoids catastrophic cancellation, and the bounded tail loop are load-bearing
// numerics that a paraphrase would quietly get wrong.
// ---------------------------------------------------------------------------

/**
 * Sum of NB pmf terms `k = from..to` (inclusive), computed by the log-space
 * recurrence documented in this file's header. Both starting logs are exact
 * and free of cancellation: `logP = log(mean) − log(mean+r)`,
 * `logQ = log(r) − log(mean+r)`. Each subsequent term is derived from the
 * previous one via `logTerm(k) = logTerm(k−1) + logP + log(k+r−1) − log(k)`
 * — the ratio `term(k)/term(k-1) = p·(k+r-1)/k`, which follows directly from
 * the binomial-coefficient ratio `C(k+r-1,k)/C(k+r-2,k-1) = (k+r-1)/k`.
 */
function nbTailSum(r: number, p: number, from: number, to: number): number {
  if (from > to) return 0;
  const logP = Math.log(p);
  const logQ = Math.log(1 - p);
  let logTerm = r * logQ; // k = 0
  let sum = 0;
  for (let k = 0; ; k++) {
    if (k >= from && k <= to) sum += Math.exp(logTerm);
    if (k >= to) break;
    logTerm = logTerm + logP + Math.log(k + r) - Math.log(k + 1);
  }
  return sum;
}

/** The NB mode — `floor((r−1)·mean/r)` for `r > 1`, `0` otherwise — never exceeds the mean, which makes the tail-termination guard below a proven fact rather than an assumption. */
function nbMode(r: number, mean: number): number {
  return r > 1 ? Math.floor(((r - 1) * mean) / r) : 0;
}

/**
 * `P(X >= t)` for a discrete family. `n = ceil(t) − 1`; `t <= 0` returns
 * exactly `1` (every discrete family here has support starting at 0).
 * Accumulates the LOWER sum `P(X <= n)` first; if that sum is at most 0.5,
 * returns `1 − sum` (the lower side carries less mass — subtracting from 1
 * is safe). Otherwise continues the SAME recurrence upward from `k = n+1`
 * and returns the directly-accumulated UPPER tail — this is what keeps a
 * genuine 1e-9 bonus probability from being the catastrophic-cancellation
 * residue of `1 − 0.999999999`.
 *
 * The upward loop terminates when a term falls below `1e-18` AND `k` is past
 * the mean (the NB mode never exceeds the mean, so this makes the
 * monotone-decreasing-past-the-mode assumption a proven fact) or when
 * `NB_MAX_TAIL_TERMS` is reached (T-09-03-02: bounds the loop against a
 * slow-decaying tail hanging the offline publish or, once 09-08 lands this
 * in the Worker, a 10ms sustained CPU budget).
 */
function negativeBinomialAtLeast(r: number, p: number, mean: number, t: number): number {
  const n = Math.ceil(t) - 1;
  if (n < 0) return 1;

  const lowerSum = nbTailSum(r, p, 0, n);
  if (lowerSum <= 0.5) {
    return clamp01(1 - lowerSum);
  }

  // Upper tail, accumulated directly from k = n+1 upward.
  const logP = Math.log(p);
  const logQ = Math.log(1 - p);
  // Recompute logTerm(n) by walking the recurrence — reuses the same
  // formula as nbTailSum, never a second implementation.
  let logTerm = r * logQ;
  for (let k = 0; k < n; k++) logTerm = logTerm + logP + Math.log(k + r) - Math.log(k + 1);

  let sum = 0;
  let k = n;
  const mode = nbMode(r, mean);
  for (let terms = 0; terms < NB_MAX_TAIL_TERMS; terms++) {
    k++;
    logTerm = logTerm + logP + Math.log(k - 1 + r) - Math.log(k);
    const term = Math.exp(logTerm);
    sum += term;
    if (term < 1e-18 && k > mode && k > mean) break;
  }
  return clamp01(sum);
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * `P(X >= threshold)` for any resolved family. `probAtLeast` is MONOTONE
 * NON-INCREASING in `threshold` and always lands in `[0, 1]`, for every
 * resolved family — an asserted invariant (T-09-03-03), because 09-04
 * derives the 2026 nested-threshold interval probabilities by DIFFERENCING
 * this function (`P(only energized) = probAtLeast(T_e) − probAtLeast(T_s)`,
 * `P(both) = probAtLeast(T_s)`), and a non-monotone step there would produce
 * a negative probability in D-07's named single-easiest-thing-to-get-
 * silently-wrong case.
 */
export function probAtLeast(marginal: FittedMarginal, threshold: number): number {
  switch (marginal.resolved) {
    case "negative-binomial":
      return negativeBinomialAtLeast(marginal.r!, marginal.p!, marginal.mean, threshold);
    case "gaussian":
      // No continuity correction, deliberately: the Gaussian model treats
      // this as a CONTINUOUS normal and compares it directly to the
      // threshold — matching the deleted Monte Carlo's own draw semantics
      // (plan 09-04), which this closed form reproduces exactly rather than
      // "improving". Adding a half-integer shift here would make the
      // Gaussian model a second one, and a re-specification of the model is
      // not a refactor — which is precisely the line plan 09-06's collapse was
      // required to stay on the safe side of.
      return clamp01(1 - standardNormalCdf((threshold - marginal.mean) / marginal.sd!));
    case "degenerate":
      // A point mass at a REAL number, which may sit between two integers —
      // the discrete identity `probAtMost(t) + probAtLeast(t+1) === 1` does
      // NOT hold for this family, and that is correct, not a bug.
      return marginal.mean >= threshold ? 1 : 0;
  }
}

/**
 * `P(X <= threshold)`. For a discrete family, defined IN TERMS OF
 * `probAtLeast` — `1 − probAtLeast(threshold + 1)` after flooring — so there
 * is exactly ONE summation routine and the two functions are consistent by
 * construction rather than by two implementations that happen to agree. For
 * the Gaussian and degenerate families, evaluated directly.
 */
export function probAtMost(marginal: FittedMarginal, threshold: number): number {
  switch (marginal.resolved) {
    case "negative-binomial":
      return clamp01(1 - probAtLeast(marginal, Math.floor(threshold) + 1));
    case "gaussian":
      return clamp01(standardNormalCdf((threshold - marginal.mean) / marginal.sd!));
    case "degenerate":
      return marginal.mean <= threshold ? 1 : 0;
  }
}

// ---------------------------------------------------------------------------
// Poisson-binomial convolution — count-of-indicators bonuses (2016 `breach`,
// the strict branch of 2025 `coralBonus`).
// ---------------------------------------------------------------------------

/**
 * The exact pmf of a sum of independent (but not identically distributed)
 * Bernoulli indicators, via direct dynamic-programming convolution: start
 * from `[1]` and, for each `p`, build a FRESH array with
 * `next[i] += current[i] · (1−p)` and `next[i+1] += current[i] · p`.
 * Writing in place would alias the array and silently compute a different
 * distribution, so this always allocates rather than mutates.
 *
 * At this phase's sizes — five indicators for 2016 `breach`, four reef
 * levels for 2025 `coralBonus` — the direct form is exact to well within
 * 1e-12 and no log-space variant is warranted (09-CONTEXT.md's "Claude's
 * Discretion" line assigns this numerical-stability judgement to this plan;
 * the judgement made is: direct convolution, no log-space, because the
 * factor count here never approaches the range where direct convolution's
 * underflow risk becomes real).
 *
 * Each incoming `p` is clamped into `[0, 1]` on entry. A non-finite entry is
 * SKIPPED — that indicator is dropped from the convolution entirely (the
 * output shrinks by one dimension) rather than being coerced into `0` or
 * `1`, since either coercion would silently assert a fact about an
 * indicator this function was given no finite probability for.
 */
export function poissonBinomialPmf(probabilities: readonly number[]): number[] {
  let current = [1];
  for (const raw of probabilities) {
    if (!Number.isFinite(raw)) continue;
    const p = clamp01(raw);
    const next = new Array<number>(current.length + 1).fill(0);
    for (let i = 0; i < current.length; i++) {
      next[i]! += current[i]! * (1 - p);
      next[i + 1]! += current[i]! * p;
    }
    current = next;
  }
  return current;
}

/**
 * `P(count >= k)` for the Poisson-binomial sum. `k <= 0` is exactly `1`;
 * `k > probabilities.length` is exactly `0`. Serves two named rule shapes:
 * 2016 `breach` (`k = 4` of five damaged-defence indicators, each indicator
 * itself `probAtLeast(positionNcrossings marginal, 2)`) and the STRICT
 * branch of 2025 `coralBonus` (`k = n = 4` reef levels — the `k = n` case
 * reduces to the product of all four probabilities, exactly reproducing the
 * conjunction `predictThresholds` already computes). The coopertition-
 * relaxed `coopCount >= 3` branch of `parse` is NOT served here:
 * `predictThresholds` deliberately evaluates only the strict branch
 * (Pitfall 4's conservative convention, preserved byte-for-byte by 09-02),
 * and this module must not quietly "improve" that choice.
 */
export function poissonBinomialAtLeast(probabilities: readonly number[], k: number): number {
  if (k <= 0) return 1;
  if (k > probabilities.length) return 0;
  const pmf = poissonBinomialPmf(probabilities);
  let sum = 0;
  for (let i = k; i < pmf.length; i++) sum += pmf[i]!;
  return clamp01(sum);
}
