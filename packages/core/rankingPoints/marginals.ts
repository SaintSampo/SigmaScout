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
 * (`packages/core/algorithms/bpr.ts:303`, `packages/bpr/model.ts:215`,
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

/**
 * What a fit RESOLVED to. A superset of the declared `MarginalFamily` union —
 * `"degenerate"` is a RESOLUTION (the fallback ladder's own answer when a
 * point mass is the only honest thing to fit), never a DECLARATION — which is
 * why this type and `MarginalFamily` are named and typed separately, and why
 * that separation still earns its place even though `MarginalFamily` now has
 * one member: a fit can still resolve to something its variable did not
 * declare.
 */
export type ResolvedMarginalFamily = "gaussian" | "degenerate";

/**
 * Why a fit resolved to something OTHER than its declared family. Absent
 * (`undefined`) when `resolved === declared`, INCLUDING when the declared
 * family is the Gaussian inert default — the inert default is not a
 * fallback, and mislabelling it as one would corrupt 09-06's fallback
 * counts (T-09-03-04).
 */
export type MarginalFallbackReason = "non-finite" | "zero-variance";

/**
 * The outcome of fitting one threshold variable's marginal. Carries THREE
 * separate facts — `declared`, `resolved`, `fallbackReason` — deliberately
 * never collapsed into one. That separation was introduced so a measurement
 * could count how often a fit resolved to something other than what it
 * declared, and it is kept for the same reason: the fallback ladder is live,
 * and a fit that degenerates is not a fit that was declared degenerate.
 */
export interface FittedMarginal {
  readonly declared: MarginalFamily;
  readonly resolved: ResolvedMarginalFamily;
  readonly mean: number;
  readonly variance: number;
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
 *   3. Otherwise -> resolved "gaussian", sd = sqrt(variance), NO
 *      fallbackReason — a declared family resolving to itself is not a
 *      fallback, and mislabelling it as one would corrupt any count taken
 *      over this ladder.
 *
 * The ladder had a fourth rung for a declared negative binomial, with two
 * further Gaussian fallbacks for the cases where its method-of-moments fit is
 * undefined (`mean <= 0`, `variance <= mean`). That family was measured and
 * refused on 2026-09-11; the rung and its two reasons went with it. The
 * remaining two reasons both describe data that cannot support ANY
 * distribution, which is why they survive a single-family union.
 */
export function fitMarginal(mean: number, variance: number, declared: MarginalFamily): FittedMarginal {
  if (!Number.isFinite(mean) || !Number.isFinite(variance)) {
    return { declared, resolved: "degenerate", mean: 0, variance: 0, fallbackReason: "non-finite" };
  }

  if (variance <= 0) {
    return { declared, resolved: "degenerate", mean, variance, fallbackReason: "zero-variance" };
  }

  return { declared, resolved: "gaussian", mean, variance, sd: Math.sqrt(variance) };
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
// The negative-binomial exact discrete CDF that used to live here — a
// log-space tail recurrence with a bounded upper loop — was deleted on
// 2026-09-11 (plan 09-06). Every threshold variable declared the family, the
// whole model was measured against the unchanged Gaussian one through the
// publisher's own scorer, and the pre-committed per-bonus bar refused it:
// three cells improved, three regressed, and the bar admits no regression at
// any magnitude. `docs/models/rp-attribution.md` carries the figures and the
// separate finding that the swap reached only one predicate shape in the first
// place. The knowledge survives as a measured negative result with the commit
// that carried the code; an unreachable family advertised as selectable does
// not.
// ---------------------------------------------------------------------------

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
 * `P(X <= threshold)`, evaluated directly for each surviving family.
 */
export function probAtMost(marginal: FittedMarginal, threshold: number): number {
  switch (marginal.resolved) {
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
