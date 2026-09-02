/**
 * D-05/D-07's within-season online adaptation (ALGO-05, plan 03-04) —
 * innovation-driven per-team process-noise scaling, the classical
 * adaptive-Kalman idea applied to Sigma1's own alliance-sum observation
 * model.
 *
 * The idea, stated concretely for this model: under a correctly specified
 * filter, the NORMALIZED innovation `innovation / sqrt(pooledVariance)` has
 * unit variance — `sigma1/index.ts`'s `applyAllianceUpdate` already computes
 * both `innovation` and, from the same teammate beliefs plus measurement
 * noise, the pooled variance `updateAllianceSum` (`kalman.ts`) uses
 * internally. A team whose recent normalized innovations are consistently
 * LARGER than unit variance is one the filter is under-reacting to — its
 * true ability is moving faster than the current process noise allows — and
 * its process noise should GROW. A team whose normalized innovations are
 * consistently SMALLER is one the filter is over-reacting to, and its
 * process noise should SHRINK.
 *
 * D-07's granularity is enforced by this module's own shape: ONE
 * `InnovationStats` per team, folded from the team's AGGREGATE (root-mean-
 * square across `componentOrder`) normalized innovation for a match, never
 * one `InnovationStats` per component. Per-team-per-component was
 * considered and rejected: it multiplies free parameters by roughly the
 * component count (~13 for a typical season) over data that is already
 * sparse per team — structurally the same trap as the failure log's
 * collapsed 4D model (REBUILD_SPEC.md's "unidentifiable model" entry, also
 * named by D-03/D-09).
 *
 * Deliberately kept OUT of this module: the RMS-across-`componentOrder`
 * aggregation itself, and the per-component normalized-innovation
 * computation. Both live inside `sigma1/index.ts`'s `applyAllianceUpdate`,
 * because `componentOrder` and each component's pooled variance are only
 * available inside that function's own per-component loop, which already
 * folds `covariance`/`consistency`/`matchCount` in one pass (D-05/D-07's
 * action text: "no second loop over the alliance"). This module owns only
 * the pure per-team EWMA fold (`foldInnovation`) and the factor formula
 * (`adaptationFactor`) — a leaf, importing nothing but
 * `Sigma1ResolvedParams`'s type from `./scale.js` (never the reverse:
 * `scale.ts` and `params.ts` are pure leaves themselves and must never import
 * this module, the same acyclic-import discipline `params.ts`'s own file
 * header documents for the constants it owns). Since 4.0.0 (D-T1) every
 * Sigma1 internal takes the RESOLVED parameter type, so this module
 * structurally cannot read a scale-relative field; none of the five fields it
 * does read is scale-dependent, so the change here is the annotation alone.
 */
import type { Sigma1ResolvedParams } from "./scale.js";

/**
 * A per-team running EWMA of SQUARED normalized innovation, plus an
 * observation count. Deliberately NOT an `ExpandingStats`
 * (`../../scoring/expandingStats.js`): that module is a Welford EXPANDING
 * (equal-weight, never-forgetting) average, the wrong shape here — a regime
 * change (the exact thing adaptation exists to detect) must be able to move
 * this statistic within a handful of matches, not get diluted by a whole
 * season of history. This uses its own EWMA at `params.adaptationEwmaAlpha`,
 * the same "recency-weighted, one off match can't swing it too far"
 * reasoning `consistency.ts`'s `SIGMA1_CONSISTENCY_EWMA_ALPHA` doc comment
 * already states for R, the consistency term (plan 07-06, D-01: R is one of
 * the two terms — alongside the posterior P — now summed into every
 * published `TeamMetric.spread`; see `sigma1/index.ts`'s `teamMetrics` doc
 * comment for the full redefinition).
 */
export interface InnovationStats {
  readonly meanSquaredNormalizedInnovation: number;
  readonly count: number;
}

/**
 * Cold-start value: EXACTLY `1.0` (the "correctly specified filter" value)
 * with `count: 0` — "assume the filter is correctly specified until this
 * team's own data says otherwise." A cold start of `0` would make every new
 * team's factor slam to `adaptationMinFactor` the instant it clears
 * `adaptationMinObservations`, which is not a defensible prior for a team
 * with no evidence either way (RESEARCH.md Anti-Patterns: never invent a
 * plausible-looking number in the OTHER direction either).
 */
export function emptyInnovationStats(): InnovationStats {
  return { meanSquaredNormalizedInnovation: 1, count: 0 };
}

/**
 * Folds one match's aggregate normalized innovation into `stats` via an EWMA
 * of its SQUARE: `(1 - alpha) * prior + alpha * normalizedInnovation^2` — the
 * same EWMA-of-a-squared-quantity shape `consistency.ts`'s `foldConsistency`
 * already uses, applied to a normalized (unit-variance-under-correct-
 * specification) quantity instead of a raw residual. Pure: returns new
 * stats, never mutates `stats`.
 *
 * T-03-12 (threat register): refuses a non-finite `normalizedInnovation` by
 * throwing, never a silent skip or a coerced zero — the same discipline
 * `breakdown/constants.ts`'s `assertFiniteComponents` already establishes
 * for the score-side observation. The zero-pooled-variance case is already
 * handled explicitly and finitely by the caller (`sigma1/index.ts`'s own
 * normalized-innovation computation reports exactly `0` rather than a `0/0`
 * division, mirroring `kalman.ts`'s own zero-gain degenerate branch), so a
 * non-finite value reaching this function is a genuine upstream bug, not an
 * expected input this function should paper over.
 */
export function foldInnovation(stats: InnovationStats, normalizedInnovation: number, alpha: number): InnovationStats {
  if (!Number.isFinite(normalizedInnovation)) {
    throw new Error(
      `foldInnovation: non-finite normalizedInnovation ${normalizedInnovation} — refusing to fold into adaptation state`
    );
  }
  const squared = normalizedInnovation * normalizedInnovation;
  return {
    meanSquaredNormalizedInnovation: (1 - alpha) * stats.meanSquaredNormalizedInnovation + alpha * squared,
    count: stats.count + 1,
  };
}

/**
 * D-05's process-noise scaling factor for one team, from its own
 * `InnovationStats`. Returns EXACTLY `1` — not a computed value that
 * happens to equal 1 — on two disabled paths:
 *
 *   - `params.adaptationEnabled === false` (D-08's default): the whole
 *     mechanism must be provably inert when off, and multiplying a belief's
 *     process noise by an exact IEEE-754 `1.0` is exact — this is what lets
 *     `params.test.ts`'s adaptation-off identity test (plan 03-04 Task 2)
 *     assert byte-identical prediction streams rather than merely "close."
 *   - `stats.count < params.adaptationMinObservations`: a team's first
 *     handful of matches cannot tell you its regime is changing — returning
 *     1 here (rather than computing off thin data) is the min-observations
 *     floor, the same role `consistency.ts`'s `shrinkConsistency` weight
 *     plays for thin per-team history on R, the consistency term.
 *
 * Otherwise: `clamp(pow(stats.meanSquaredNormalizedInnovation,
 * params.adaptationExponent), params.adaptationMinFactor,
 * params.adaptationMaxFactor)`. The exponent defaults to `0.5`, so the
 * factor scales with the RATIO of observed to expected innovation STANDARD
 * DEVIATION (not variance) — a gentler response than the raw variance ratio.
 * The clamp is T-03-06's documented stability bound: an unbounded adaptive
 * filter can destabilize (a large factor inflates `P`, which inflates the
 * Kalman gain, which produces a larger innovation next match, which inflates
 * the factor again) — asserted with EXACT equality at both bounds by
 * `adaptation.test.ts`, never merely "close to."
 */
export function adaptationFactor(stats: InnovationStats, params: Sigma1ResolvedParams): number {
  if (!params.adaptationEnabled || stats.count < params.adaptationMinObservations) {
    return 1;
  }
  const raw = Math.pow(stats.meanSquaredNormalizedInnovation, params.adaptationExponent);
  return Math.min(params.adaptationMaxFactor, Math.max(params.adaptationMinFactor, raw));
}
