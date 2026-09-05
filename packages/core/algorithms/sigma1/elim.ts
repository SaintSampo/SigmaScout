/**
 * D-1: elimination-match mechanisms for Sigma1 (ELIM-R/ELIM-OFF/ELIM-WIRE,
 * quick task 260904-v9n) — the ONE shared `isElimination` predicate both
 * mechanisms key off, plus `elimNoiseFactor`'s measurement-noise treatment
 * (ELIM-R). ELIM-OFF's within-season score-offset accumulator joins this file
 * in a later task; both live here so the two mechanisms can never disagree
 * about what an elimination match is (the same "one shared predicate, never a
 * second drifting eligibility rule" discipline `isRpEligibleEventType`
 * already carries for RP).
 *
 * MOTIVATION (the shipped `reports/rolling-2026-09b` walk-forward backtest,
 * offseason excluded): VPR's elim winner accuracy TRAILS its quals accuracy
 * in 2023 (73.1% vs 75.8%) and 2024 (71.2% vs 75.0%) at n~=2800/season, while
 * OPR gains +5 to +11 points at elims every season — the model converts
 * late-event information into no elim edge at all. `elimNoiseFactor` exists
 * to let the accuracy-primary tuner rule on whether an elimination
 * observation's measurement noise should move, in EITHER direction: the
 * measurement is consistent both with "the model over-trusts elim
 * observations" (multiplier > 1, more noise, smaller gain) and "the model
 * under-uses late-event information" (multiplier < 1, less noise, larger
 * gain) — see `searchSpace.ts`'s bound comment for why the search space
 * deliberately straddles 1 rather than pre-deciding between the two.
 *
 * A pure leaf (D-1): imports ONLY `type CompLevel` from `../types.js` and
 * `type Sigma1ResolvedParams` from `./scale.js` — type-only, so it adds no
 * RUNTIME import edge and cannot participate in the module-evaluation TDZ
 * cycle `params.ts`'s own header records fixing once already. `params.ts`
 * must NOT import this module.
 */
import type { CompLevel } from "../types.js";
import type { Sigma1ResolvedParams } from "./scale.js";

/**
 * The ONE shared predicate for "is this an elimination match" — TBA's five
 * `CompLevel` values split into exactly one qualification level and four
 * elimination levels (`epa.ts:632` already carries this identical
 * expression as precedent). Both `elimNoiseFactor` below and ELIM-OFF's
 * score-offset mechanism (added in a later task) call this and ONLY this —
 * never a second, independently-written eligibility check that could drift
 * from it.
 */
export function isElimination(compLevel: CompLevel): boolean {
  return compLevel !== "qm";
}

/**
 * D-4: the measurement-noise multiplier an ELIMINATION observation's `R`
 * carries, everywhere `R` enters that match's score-side fold (the Kalman
 * posterior `updateAllianceSum`, the per-team gains `componentGains`, and the
 * normalized-innovation denominator `pooledVariance` — `sigma1/index.ts`'s
 * `applyAllianceUpdate`). Composes with the pre-existing
 * `FALLBACK_NOISE_MULTIPLIER` by multiplication (D-4) rather than replacing
 * it, so a `usedFallback` elim match carries BOTH inflations.
 *
 * Returns EXACTLY the number `1` — not a computed value that happens to
 * equal 1 — for `compLevel === "qm"`: an exact IEEE-754 `1.0`, so
 * `base * elimNoiseFactor("qm", params) === base` bitwise for every finite
 * `base`, which is what lets `params.test.ts`'s identity test assert
 * byte-identical prediction streams rather than merely "close". For every
 * elimination `compLevel` it returns `params.elimObservationNoiseMultiplier`
 * verbatim — no clamp, no transform — since the value is already the
 * multiplier the fold wants and `Sigma1ParamsSchema` enforces
 * `.finite().positive()` at construction.
 *
 * D-5 (recorded here too, not only at the call site): the innovation-based
 * estimators (`varianceSample` in `applyAllianceUpdate`, and the
 * `covarianceSample` twin built from the same innovations) deliberately do
 * NOT see this factor. `E[innovation^2] = sum P + R_true` is a statement
 * about the OBSERVED data, not about what the filter chose to believe, so
 * inflating `R` there would not change the innovation's distribution — the
 * unbiased sample is already correct. Rescaling it would additionally
 * compound the multiplier geometrically across an elim bracket, since
 * `measurementNoise` is the SUM of the teammates' own consistency estimates
 * (fed by exactly that sample) times this same multiplier.
 */
export function elimNoiseFactor(compLevel: CompLevel, params: Sigma1ResolvedParams): number {
  if (!isElimination(compLevel)) return 1;
  return params.elimObservationNoiseMultiplier;
}
