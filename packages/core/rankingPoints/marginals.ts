/**
 * Negative-binomial, Gaussian, degenerate and lattice marginal fitting and
 * evaluation. A browser-safe leaf with type-only imports, so `apps/web` runs
 * the same pure functions real matches use.
 *
 * Negative-binomial method-of-moments fit (`r` and `p` must never be
 * re-derived at a call site):
 *
 *   r = mean² / (variance − mean)
 *   p = mean / (mean + r)
 *   P(X = k) = C(k + r − 1, k) · (1 − p)^r · p^k
 *
 * The lattice family lives at the bottom of this file. It does NOT use
 * `standardNormalCdf`: its far-tail masses are differences of CDF values,
 * where the 1.5e-7 erf error would go negative, so it uses `hartNormalCdf`.
 */
import type { MarginalFamily, RpLatticeSupport, RpThresholdVariable } from "./constants.js";
import type { AllianceRpMoments } from "./moments.js";

/** Abramowitz-Stegun formula 7.1.26 erf approximation (max absolute error under 1.5e-7). */
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
 * Standard normal CDF of an already-standardized `z`. Exact at z=0, where the
 * erf approximation's error would otherwise leak a residual off 0.5.
 */
export function standardNormalCdf(z: number): number {
  if (z === 0) return 0.5;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Hard cap on the negative-binomial upper-tail summation loop in `negativeBinomialAtLeast`. */
export const NB_MAX_TAIL_TERMS = 100_000;

/** What a fit resolved to. `"degenerate"` is a resolution of the fallback ladder, never a declared `MarginalFamily`. */
export type ResolvedMarginalFamily = "negative-binomial" | "gaussian" | "degenerate" | "lattice";

/**
 * Why a fit resolved to something other than its declared family. Absent
 * when `resolved === declared`, including a declared Gaussian, so fallback
 * counts are not corrupted.
 *
 * The last three belong to the lattice family, which always resolves to
 * `"lattice"` once past the non-finite and zero-variance rungs; they name a
 * shape fallback inside that family:
 *   - "mean-outside-support": the fitted mean sits at or beyond a declared
 *     bound, so the bounded form is a point mass on that bound (or the
 *     discretized Gaussian's mean lies below its declared `min`).
 *   - "under-dispersed": the variance is at or below the binomial variance,
 *     so the bounded form is a binomial.
 *   - "overdispersion-clamped": the beta-binomial correlation exceeded
 *     `LATTICE_RHO_CLAMP` and was clamped, or a one-step support (n = 1)
 *     could only honour the mean as a Bernoulli.
 */
export type MarginalFallbackReason =
  | "non-finite"
  | "zero-variance"
  | "non-positive-mean"
  | "variance-le-mean"
  | "mean-outside-support"
  | "under-dispersed"
  | "overdispersion-clamped";

/** A distribution on the lattice `base + i * step`, `probabilities[i]` at each point. A single entry is a point mass at `base`. */
export interface LatticePmf {
  readonly base: number;
  readonly step: number;
  readonly probabilities: readonly number[];
}

/**
 * A Gaussian discretized onto the lattice `anchor + k * step`: the mass
 * at `x` is `Phi((x + step/2 - mean)/sd) - Phi((x - step/2 - mean)/sd)`, and
 * all mass beyond a declared bound is lumped onto that bound.
 */
export interface DiscretizedGaussian {
  readonly step: number;
  readonly anchor: number;
  readonly min?: number;
  readonly max?: number;
  readonly mean: number;
  readonly sd: number;
}

/**
 * One threshold variable's fitted marginal. `declared`, `resolved` and
 * `fallbackReason` stay separate so fallbacks can be counted.
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
  /** The bounded form's materialized pmf. Present only when `resolved === "lattice"` and both bounds were declared. */
  readonly latticePmf?: LatticePmf;
  /** The unbounded form's parameters. Present only when `resolved === "lattice"` and a bound was not declared. */
  readonly discretizedGaussian?: DiscretizedGaussian;
  readonly fallbackReason?: MarginalFallbackReason;
}

/**
 * Fits one marginal from a (mean, variance) pair and a declared family. The
 * ladder is ordered; a later branch is never reached once an earlier one fires:
 *
 *   1. Either input non-finite -> degenerate at 0, reason "non-finite" (a
 *      counted skip, not a throw that would abort a publish over one match).
 *   2. `variance <= 0` -> degenerate at the unrounded `mean`, reason
 *      "zero-variance". Reproduces `predictThresholds`'s boolean limit.
 *   3. Declared "gaussian" -> resolved "gaussian", no fallbackReason.
 *   4. Declared "negative-binomial" (unused by every current season):
 *        - `mean <= 0` -> Gaussian, reason "non-positive-mean".
 *        - `variance <= mean` -> Gaussian, reason "variance-le-mean" (`r`
 *          would divide by zero or go negative).
 *        - otherwise the method-of-moments `r`, `p`.
 *   5. Declared "lattice" (requires the variable's `RpLatticeSupport`): see
 *      `fitLattice`.
 */
export function fitMarginal(mean: number, variance: number, declared: "lattice", lattice: RpLatticeSupport): FittedMarginal;
export function fitMarginal(mean: number, variance: number, declared: Exclude<MarginalFamily, "lattice">, lattice?: RpLatticeSupport): FittedMarginal;
export function fitMarginal(mean: number, variance: number, declared: MarginalFamily, lattice: RpLatticeSupport): FittedMarginal;
export function fitMarginal(mean: number, variance: number, declared: MarginalFamily, lattice?: RpLatticeSupport): FittedMarginal {
  if (!Number.isFinite(mean) || !Number.isFinite(variance)) {
    return { declared, resolved: "degenerate", mean: 0, variance: 0, fallbackReason: "non-finite" };
  }

  if (variance <= 0) {
    return { declared, resolved: "degenerate", mean, variance, fallbackReason: "zero-variance" };
  }

  if (declared === "gaussian") {
    return { declared, resolved: "gaussian", mean, variance, sd: Math.sqrt(variance) };
  }

  if (declared === "lattice") {
    if (lattice === undefined) {
      throw new Error(`fitMarginal: declared "lattice" with no lattice support — every RpThresholdVariable declares one, so pass it`);
    }
    return fitLattice(mean, variance, lattice);
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
 * Reads only the diagonal of `moments.varianceBlock`. A variable absent from
 * `variables` defaults to `"gaussian"` rather than throwing.
 */
export function fitAllianceMarginals(moments: AllianceRpMoments, variables: readonly RpThresholdVariable[]): Map<string, FittedMarginal> {
  const variableByName = new Map(variables.map((v) => [v.name, v] as const));
  const fits = new Map<string, FittedMarginal>();
  for (let i = 0; i < moments.variableNames.length; i++) {
    const name = moments.variableNames[i]!;
    const mean = moments.meanVector[i]!;
    const variance = moments.varianceBlock[i]![i]!;
    const variable = variableByName.get(name);
    fits.set(name, variable === undefined ? fitMarginal(mean, variance, "gaussian") : fitMarginal(mean, variance, variable.marginalFamily, variable.lattice));
  }
  return fits;
}

// ---------------------------------------------------------------------------
// Negative-binomial exact discrete CDF, in log space. The recurrence, the
// lower-sum-then-switch ordering that avoids catastrophic cancellation, and
// the bounded tail loop are load-bearing numerics.
// ---------------------------------------------------------------------------

/**
 * Sum of NB pmf terms `k = from..to` (inclusive), by the log-space recurrence
 * `logTerm(k) = logTerm(k−1) + log(p) + log(k+r−1) − log(k)`.
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

/** The NB mode, which never exceeds the mean; the tail-termination guard relies on that. */
function nbMode(r: number, mean: number): number {
  return r > 1 ? Math.floor(((r - 1) * mean) / r) : 0;
}

/**
 * `P(X >= t)`; `t <= 0` returns exactly `1`. If the lower sum `P(X <= n)` is
 * at most 0.5, returns `1 − sum`; otherwise accumulates the upper tail
 * directly, so a genuine 1e-9 probability is not the cancellation residue of
 * `1 − 0.999999999`.
 *
 * The upward loop stops when a term is below `1e-18` past the mode and mean,
 * or at `NB_MAX_TAIL_TERMS`, so a slow-decaying tail cannot hang a publish or
 * a Worker's sustained CPU budget.
 */
function negativeBinomialAtLeast(r: number, p: number, mean: number, t: number): number {
  const n = Math.ceil(t) - 1;
  if (n < 0) return 1;

  const lowerSum = nbTailSum(r, p, 0, n);
  if (lowerSum <= 0.5) {
    return clamp01(1 - lowerSum);
  }

  const logP = Math.log(p);
  const logQ = Math.log(1 - p);
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
 * `P(X >= threshold)` for any resolved family. Monotone non-increasing in
 * `threshold` and within `[0, 1]`: nested-threshold interval probabilities
 * are differences of this function, and a non-monotone step would make one
 * negative.
 */
export function probAtLeast(marginal: FittedMarginal, threshold: number): number {
  switch (marginal.resolved) {
    case "negative-binomial":
      return negativeBinomialAtLeast(marginal.r!, marginal.p!, marginal.mean, threshold);
    case "gaussian":
      // No continuity correction, deliberately: a half-integer shift would re-specify the model.
      return clamp01(1 - standardNormalCdf((threshold - marginal.mean) / marginal.sd!));
    case "degenerate":
      // A point mass may sit between integers, so `probAtMost(t) + probAtLeast(t+1) === 1` need not hold.
      return marginal.mean >= threshold ? 1 : 0;
    case "lattice":
      return marginal.latticePmf !== undefined
        ? latticePmfTail(marginal.latticePmf, threshold, "gte")
        : discretizedGaussianAtLeast(marginal.discretizedGaussian!, threshold);
  }
}

/**
 * `P(X <= threshold)`. The negative binomial is defined as
 * `1 − probAtLeast(floor(threshold) + 1)`, so one summation routine serves both.
 */
export function probAtMost(marginal: FittedMarginal, threshold: number): number {
  switch (marginal.resolved) {
    case "negative-binomial":
      return clamp01(1 - probAtLeast(marginal, Math.floor(threshold) + 1));
    case "gaussian":
      return clamp01(standardNormalCdf((threshold - marginal.mean) / marginal.sd!));
    case "degenerate":
      return marginal.mean <= threshold ? 1 : 0;
    case "lattice":
      return marginal.latticePmf !== undefined
        ? latticePmfTail(marginal.latticePmf, threshold, "lte")
        : discretizedGaussianAtMost(marginal.discretizedGaussian!, threshold);
  }
}

// ---------------------------------------------------------------------------
// Poisson-binomial convolution — count-of-indicators bonuses (2016 `breach`,
// the strict branch of 2025 `coralBonus`).
// ---------------------------------------------------------------------------

/**
 * The exact pmf of a sum of independent, non-identical Bernoulli indicators
 * by direct convolution. Each step builds a fresh array; writing in place
 * would alias it. At four or five indicators no log-space variant is needed.
 *
 * Each `p` is clamped into `[0, 1]`. A non-finite entry is dropped (the
 * output shrinks by one) rather than coerced to `0` or `1`.
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
 * `k > probabilities.length` is exactly `0`. Serves 2016 `breach` (4 of five
 * defences) and the strict branch of 2025 `coralBonus` (all four reef
 * levels). `parse`'s coopertition-relaxed `coopCount >= 3` branch is not
 * served: `predictThresholds` evaluates only the strict branch, deliberately.
 */
export function poissonBinomialAtLeast(probabilities: readonly number[], k: number): number {
  if (k <= 0) return 1;
  if (k > probabilities.length) return 0;
  const pmf = poissonBinomialPmf(probabilities);
  let sum = 0;
  for (let i = k; i < pmf.length; i++) sum += pmf[i]!;
  return clamp01(sum);
}

// ---------------------------------------------------------------------------
// The lattice family, used by season modules that declare `marginalFamily: "lattice"`.
// ---------------------------------------------------------------------------

/** The beta-binomial intra-class correlation is clamped to this, so `1/rho - 1` never reaches 0. Structural, never tuned. */
export const LATTICE_RHO_CLAMP = 0.999;

/** The discretized Gaussian is materialized over `mean ± LATTICE_SD_SPAN · sd`, with both tails lumped onto the end points. */
export const LATTICE_SD_SPAN = 8;

/** Tolerance, in units of the lattice step, for deciding which lattice point a threshold lands on. */
export const LATTICE_EPS = 1e-7;

/** Thrown when two lattice terms of one clause have steps with no integer ratio, so no common lattice exists. */
export class IncommensurateLatticeStepsError extends Error {
  constructor(a: number, b: number) {
    super(`lattice steps ${a} and ${b} are not commensurate, so no common lattice exists for an exact sum`);
    this.name = "IncommensurateLatticeStepsError";
  }
}

/**
 * Double-precision standard normal CDF of a standardized `z` (Hart 1966, as
 * given by West 2005). Accurate in both far tails, so a difference of two
 * values never goes negative the way `standardNormalCdf`'s would.
 */
export function hartNormalCdf(z: number): number {
  const zAbs = Math.abs(z);
  let c: number;
  if (zAbs > 37) {
    c = 0;
  } else {
    const e = Math.exp((-zAbs * zAbs) / 2);
    if (zAbs < 7.07106781186547) {
      let b = 3.52624965998911e-2 * zAbs + 0.700383064443688;
      b = b * zAbs + 6.37396220353165;
      b = b * zAbs + 33.912866078383;
      b = b * zAbs + 112.079291497871;
      b = b * zAbs + 221.213596169931;
      b = b * zAbs + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * zAbs + 1.75566716318264;
      b = b * zAbs + 16.064177579207;
      b = b * zAbs + 86.7807322029461;
      b = b * zAbs + 296.564248779674;
      b = b * zAbs + 637.333633378831;
      b = b * zAbs + 793.826512519948;
      b = b * zAbs + 440.413735824752;
      c = c / b;
    } else {
      let b = zAbs + 0.65;
      b = zAbs + 4 / b;
      b = zAbs + 3 / b;
      b = zAbs + 2 / b;
      b = zAbs + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return z > 0 ? 1 - c : c;
}

/** `P(a <= Z < b)` for a standard normal, computed on whichever side avoids cancellation. */
export function normalMass(a: number, b: number): number {
  if (a >= 0) return hartNormalCdf(-a) - hartNormalCdf(-b);
  if (b <= 0) return hartNormalCdf(b) - hartNormalCdf(a);
  return 1 - hartNormalCdf(a) - hartNormalCdf(-b);
}

/** `LOG_FACTORIAL[i] = ln(i!)`, grown on demand and always by the same left-to-right sum, so every entry is identical however the table grew. */
const LOG_FACTORIAL: number[] = [0];

function logFactorial(n: number): number {
  for (let i = LOG_FACTORIAL.length; i <= n; i++) LOG_FACTORIAL.push(LOG_FACTORIAL[i - 1]! + Math.log(i));
  return LOG_FACTORIAL[n]!;
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** Clamps every entry to be non-negative, then divides by the sum. */
function normalizeProbabilities(raw: number[]): number[] {
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    if (!(raw[i]! > 0)) raw[i] = 0;
    sum += raw[i]!;
  }
  for (let i = 0; i < raw.length; i++) raw[i] = raw[i]! / sum;
  return raw;
}

function binomialProbabilities(n: number, p: number): number[] {
  const out = new Array<number>(n + 1);
  const logP = Math.log(p);
  const log1mP = Math.log1p(-p);
  for (let k = 0; k <= n; k++) out[k] = Math.exp(logChoose(n, k) + k * logP + (n - k) * log1mP);
  return normalizeProbabilities(out);
}

/** `P(k) = C(n,k) (alpha)_k (beta)_(n-k) / (alpha+beta)_n`, from log rising factorials. */
function betaBinomialProbabilities(n: number, alpha: number, beta: number): number[] {
  const logRisingAlpha = new Array<number>(n + 1).fill(0);
  const logRisingBeta = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    logRisingAlpha[i + 1] = logRisingAlpha[i]! + Math.log(alpha + i);
    logRisingBeta[i + 1] = logRisingBeta[i]! + Math.log(beta + i);
  }
  let logRisingTotal = 0;
  for (let i = 0; i < n; i++) logRisingTotal += Math.log(alpha + beta + i);
  const out = new Array<number>(n + 1);
  for (let k = 0; k <= n; k++) out[k] = Math.exp(logChoose(n, k) + logRisingAlpha[k]! + logRisingBeta[n - k]! - logRisingTotal);
  return normalizeProbabilities(out);
}

function assertValidLatticeSupport(support: RpLatticeSupport): void {
  const { step, min, max } = support;
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error(`fitMarginal: lattice step must be finite and positive, got ${step}`);
  }
  if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))) {
    throw new Error(`fitMarginal: lattice bounds must be finite, got min=${min} max=${max}`);
  }
  if (max !== undefined && min === undefined) {
    throw new Error(`fitMarginal: a lattice max needs a declared min to anchor the lattice`);
  }
  if (min !== undefined && max !== undefined && max < min) {
    throw new Error(`fitMarginal: lattice max ${max} is below min ${min}`);
  }
}

/**
 * The lattice rung of `fitMarginal`, reached only past the non-finite and
 * zero-variance rungs. Never throws on a mean outside the support.
 *
 * Both bounds declared: the bounded form on `n = (max - min) / step` steps,
 * matched to mean and variance in step units (`m`, `v`, `p = m / n`):
 *   - `n = 0` -> a point mass on `min`.
 *   - `m <= 0` or `m >= n` -> a point mass on that bound ("mean-outside-support").
 *   - `v <= n·p·(1-p)` -> binomial ("under-dispersed").
 *   - `n = 1` -> Bernoulli ("overdispersion-clamped": two points cannot carry more variance).
 *   - otherwise beta-binomial with `rho = (v / (n·p·(1-p)) - 1) / (n - 1)`,
 *     clamped to `LATTICE_RHO_CLAMP` ("overdispersion-clamped").
 * Otherwise: the discretized Gaussian parameters, anchored at `min ?? 0`.
 */
function fitLattice(mean: number, variance: number, support: RpLatticeSupport): FittedMarginal {
  assertValidLatticeSupport(support);
  const { step, min, max } = support;
  const fit = { declared: "lattice", resolved: "lattice", mean, variance } as const;

  if (min === undefined || max === undefined) {
    const discretizedGaussian: DiscretizedGaussian = {
      step,
      anchor: min ?? 0,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      mean,
      sd: Math.sqrt(variance),
    };
    return min !== undefined && mean < min
      ? { ...fit, discretizedGaussian, fallbackReason: "mean-outside-support" }
      : { ...fit, discretizedGaussian };
  }

  const n = Math.round((max - min) / step);
  if (n <= 0) return { ...fit, latticePmf: { base: min, step, probabilities: [1] } };
  const m = (mean - min) / step;
  if (m <= 0) return { ...fit, latticePmf: { base: min, step, probabilities: [1] }, fallbackReason: "mean-outside-support" };
  if (m >= n) return { ...fit, latticePmf: { base: min + n * step, step, probabilities: [1] }, fallbackReason: "mean-outside-support" };

  const v = variance / (step * step);
  const p = m / n;
  const binomialVariance = n * p * (1 - p);
  if (v <= binomialVariance) {
    return { ...fit, latticePmf: { base: min, step, probabilities: binomialProbabilities(n, p) }, fallbackReason: "under-dispersed" };
  }
  if (n === 1) {
    return { ...fit, latticePmf: { base: min, step, probabilities: binomialProbabilities(1, p) }, fallbackReason: "overdispersion-clamped" };
  }
  let rho = (v / binomialVariance - 1) / (n - 1);
  const clamped = rho > LATTICE_RHO_CLAMP;
  if (clamped) rho = LATTICE_RHO_CLAMP;
  const alpha = p * (1 / rho - 1);
  const beta = (1 - p) * (1 / rho - 1);
  const latticePmf: LatticePmf = { base: min, step, probabilities: betaBinomialProbabilities(n, alpha, beta) };
  return clamped ? { ...fit, latticePmf, fallbackReason: "overdispersion-clamped" } : { ...fit, latticePmf };
}

/** `P(X >= t)` or `P(X <= t)` on a materialized lattice pmf, by direct summation. */
function latticePmfTail(d: LatticePmf, threshold: number, direction: "gte" | "lte"): number {
  const length = d.probabilities.length;
  const position = (threshold - d.base) / d.step;
  let sum = 0;
  if (direction === "gte") {
    for (let j = Math.max(0, Math.ceil(position - LATTICE_EPS)); j < length; j++) sum += d.probabilities[j]!;
  } else {
    const last = Math.min(length - 1, Math.floor(position + LATTICE_EPS));
    for (let j = 0; j <= last; j++) sum += d.probabilities[j]!;
  }
  return clamp01(sum);
}

/** Closed-form `P(X >= t)`: the upper tail from half a step below the first lattice point at or above `t`. 1 at or below `min`, 0 above `max`. */
function discretizedGaussianAtLeast(g: DiscretizedGaussian, threshold: number): number {
  const x = g.anchor + Math.ceil((threshold - g.anchor) / g.step - LATTICE_EPS) * g.step;
  if (g.min !== undefined && x <= g.min) return 1;
  if (g.max !== undefined && x > g.max) return 0;
  return clamp01(hartNormalCdf(-(x - g.step / 2 - g.mean) / g.sd));
}

/** Closed-form `P(X <= t)`: the lower tail to half a step above the last lattice point at or below `t`. 0 below `min`, 1 at or above `max`. */
function discretizedGaussianAtMost(g: DiscretizedGaussian, threshold: number): number {
  const x = g.anchor + Math.floor((threshold - g.anchor) / g.step + LATTICE_EPS) * g.step;
  if (g.min !== undefined && x < g.min) return 0;
  if (g.max !== undefined && x >= g.max) return 1;
  return clamp01(hartNormalCdf((x + g.step / 2 - g.mean) / g.sd));
}

/** The discretized Gaussian over `[max(min, mean - 8sd), mean + 8sd]` (capped at `max`), both tails lumped onto the end points, masses clamped non-negative. */
function materializeDiscretizedGaussian(g: DiscretizedGaussian): LatticePmf {
  const { step, anchor, mean, sd } = g;
  let kLo = Math.floor((mean - LATTICE_SD_SPAN * sd - anchor) / step);
  let kHi = Math.ceil((mean + LATTICE_SD_SPAN * sd - anchor) / step);
  if (g.min !== undefined) {
    const kMin = Math.round((g.min - anchor) / step);
    kLo = Math.max(kLo, kMin);
    kHi = Math.max(kHi, kMin);
  }
  if (g.max !== undefined) {
    const kMax = Math.round((g.max - anchor) / step);
    kHi = Math.min(kHi, kMax);
    kLo = Math.min(kLo, kMax);
  }
  if (kHi <= kLo) return { base: anchor + kLo * step, step, probabilities: [1] };

  const probabilities = new Array<number>(kHi - kLo + 1);
  for (let k = kLo; k <= kHi; k++) {
    const x = anchor + k * step;
    const a = (x - step / 2 - mean) / sd;
    const b = (x + step / 2 - mean) / sd;
    probabilities[k - kLo] = k === kLo ? hartNormalCdf(b) : k === kHi ? hartNormalCdf(-a) : normalMass(a, b);
  }
  return { base: anchor + kLo * step, step, probabilities: normalizeProbabilities(probabilities) };
}

/**
 * A fitted marginal as a lattice pmf, for convolution. A `"lattice"` fit
 * returns its bounded pmf or materializes its discretized Gaussian; a
 * `"degenerate"` fit is a point mass at its (possibly off-lattice) mean.
 * Any other resolution has no lattice form and throws.
 */
export function materializeLatticeMarginal(marginal: FittedMarginal): LatticePmf {
  switch (marginal.resolved) {
    case "lattice":
      return marginal.latticePmf ?? materializeDiscretizedGaussian(marginal.discretizedGaussian!);
    case "degenerate":
      return { base: marginal.mean, step: 1, probabilities: [1] };
    default:
      throw new Error(`materializeLatticeMarginal: a "${marginal.resolved}" marginal has no lattice form`);
  }
}

/** `X / divisor` on the lattice: base and step are both divided, never multiplied by a reciprocal (see `RpLinearTerm.divisor`). */
export function divideLatticePmf(d: LatticePmf, divisor: number): LatticePmf {
  return divisor === 1 ? d : { base: d.base / divisor, step: d.step / divisor, probabilities: d.probabilities };
}

function expandLattice(d: LatticePmf, factor: number): LatticePmf {
  const out = new Array<number>((d.probabilities.length - 1) * factor + 1).fill(0);
  for (let i = 0; i < d.probabilities.length; i++) out[i * factor] = d.probabilities[i]!;
  return { base: d.base, step: d.step / factor, probabilities: out };
}

function alignLatticeSteps(a: LatticePmf, b: LatticePmf): [LatticePmf, LatticePmf] {
  if (Math.abs(a.step - b.step) <= 1e-12 * Math.max(a.step, b.step)) return [a, b];
  const aIsBigger = a.step > b.step;
  const big = aIsBigger ? a : b;
  const small = aIsBigger ? b : a;
  const ratio = big.step / small.step;
  if (Math.abs(ratio - Math.round(ratio)) > 1e-9) throw new IncommensurateLatticeStepsError(a.step, b.step);
  const expanded = expandLattice(big, Math.round(ratio));
  return aIsBigger ? [expanded, small] : [small, expanded];
}

function convolveLattice(a: LatticePmf, b: LatticePmf): LatticePmf {
  if (a.probabilities.length === 1) return { base: a.base + b.base, step: b.step, probabilities: b.probabilities };
  if (b.probabilities.length === 1) return { base: a.base + b.base, step: a.step, probabilities: a.probabilities };
  const [x, y] = alignLatticeSteps(a, b);
  const out = new Array<number>(x.probabilities.length + y.probabilities.length - 1).fill(0);
  for (let i = 0; i < x.probabilities.length; i++) {
    const pi = x.probabilities[i]!;
    if (pi === 0) continue;
    for (let j = 0; j < y.probabilities.length; j++) out[i + j]! += pi * y.probabilities[j]!;
  }
  return { base: x.base + y.base, step: x.step, probabilities: out };
}

/**
 * `P(sum of terms >= t)` (or `<= t`), exact on the lattice. Point-mass terms
 * add up to a shift; the other terms are convolved in declared order, except
 * the last, which is folded in through its cumulative sums. Throws
 * `IncommensurateLatticeStepsError` when two spread terms share no lattice.
 */
export function latticeSumTail(terms: readonly LatticePmf[], threshold: number, direction: "gte" | "lte"): number {
  const spread = terms.filter((d) => d.probabilities.length > 1);
  let shift = 0;
  for (const d of terms) if (d.probabilities.length === 1) shift += d.base;
  if (spread.length === 0) {
    return direction === "gte" ? (shift >= threshold - LATTICE_EPS ? 1 : 0) : shift <= threshold + LATTICE_EPS ? 1 : 0;
  }

  let head: LatticePmf = { base: shift, step: 1, probabilities: [1] };
  for (let i = 0; i < spread.length - 1; i++) head = convolveLattice(head, spread[i]!);
  const last = spread[spread.length - 1]!;
  if (head.probabilities.length > 1) alignLatticeSteps(head, last);

  const length = last.probabilities.length;
  const cumulative = new Array<number>(length + 1).fill(0);
  if (direction === "gte") {
    for (let j = length - 1; j >= 0; j--) cumulative[j] = cumulative[j + 1]! + last.probabilities[j]!;
  } else {
    for (let j = 0; j < length; j++) cumulative[j + 1] = cumulative[j]! + last.probabilities[j]!;
  }

  const headStep = head.probabilities.length === 1 ? 0 : head.step;
  let total = 0;
  for (let i = 0; i < head.probabilities.length; i++) {
    const pi = head.probabilities[i]!;
    if (pi === 0) continue;
    const position = (threshold - (head.base + i * headStep) - last.base) / last.step;
    if (direction === "gte") {
      const first = Math.max(0, Math.ceil(position - LATTICE_EPS));
      if (first < length) total += pi * cumulative[first]!;
    } else {
      const lastIndex = Math.min(length - 1, Math.floor(position + LATTICE_EPS));
      if (lastIndex >= 0) total += pi * cumulative[lastIndex + 1]!;
    }
  }
  return clamp01(total);
}
