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

/**
 * ELIM-OFF (quick task 260904-v9n): a LEAGUE-LEVEL (never per-team) additive
 * elim score offset, learned online as an EWMA of the RAW prediction
 * residual (`observed alliance total - predicted alliance total`) for
 * elimination matches, applied to BOTH alliances' predicted scores in
 * `sigma1/index.ts`'s `predict()`. Independent of `elimNoiseFactor` above —
 * this mechanism never touches measurement noise or the Kalman fold at all.
 *
 * MOTIVATION: the same `reports/rolling-2026-09b` backtest that motivates
 * `elimNoiseFactor` also measured that elim-minus-qual per-alliance SCORE
 * bias SHIFTS REGIME by season: -3.5 (2022), -2.8 (2023), +4.2 (2024), +0.5
 * (2025), -15.2 (2026) points. No fixed cross-season correction can
 * transfer, so anything score-side must be learned WITHIN the season —
 * hence an online, within-season EWMA rather than a tuned constant.
 *
 * KNOWN LIMITATION (D-13), stated here rather than left to be discovered: a
 * symmetric league-wide offset added to BOTH alliances CANCELS in the
 * margin, so it does NOT move `pRedWin`, winner accuracy or Brier — its
 * purpose is honest published elim SCORE predictions, not accuracy. Be
 * precise about the arithmetic: it cancels ANALYTICALLY, not bitwise —
 * `(a+k) - (b+k)` is not guaranteed to equal `a-b` in IEEE-754 — so with the
 * flag ON, `pRedWin` may differ at ULP scale and a flag-ON digest is not
 * guaranteed to reproduce a flag-OFF one. At the default `k = 0` the
 * cancellation IS exact, because `x + 0 === x` for every finite `x`.
 */
export interface ElimScoreOffset {
  readonly value: number;
  readonly count: number;
}

/**
 * A never-observed cold start: `value: 0` (the honest neutral — no
 * correction until this league's own elim matches say otherwise) and
 * `count: 0`. `count` exists so "never observed" is distinguishable from
 * "learned exactly zero", which is what makes a season-reset assertion
 * meaningful (`carrySeason` must return THIS, not merely a value that
 * happens to be 0). Deliberately NOT used as a minimum-observations gate the
 * way `adaptationMinObservations` gates `adaptation.ts`'s `adaptationFactor`:
 * unlike per-team adaptation, this statistic accumulates across EVERY
 * concurrent elimination bracket in the league, so it is never thin for
 * long, and a gate here would be an unmeasured knob rather than a documented
 * necessity.
 */
export function emptyElimScoreOffset(): ElimScoreOffset {
  return { value: 0, count: 0 };
}

/**
 * Folds one alliance's RAW residual (`observed - predicted`, measured from
 * the PRE-fold state — D-7) into `prior` via an EWMA:
 * `(1 - alpha) * prior.value + alpha * residual`, with `count` incremented.
 * Pure — returns a new object, never mutates `prior`.
 *
 * D-7's trap, named so nobody re-derives it and loses the fix: the residual
 * folded here MUST be the RAW one, measured against the UNCORRECTED
 * prediction. Folding the OFFSET-CORRECTED residual instead would make the
 * accumulator converge toward zero and the correction would silently
 * evaporate — the EWMA of the raw residual IS the bias estimate; there is no
 * second correction to layer on top of it.
 *
 * Refuses a non-finite `residual` by throwing, mirroring `adaptation.ts`'s
 * `foldInnovation` and `swing.ts`'s `foldSwingObservation`, for the identical
 * reason: a non-finite residual reaching here is a genuine upstream bug
 * (T-02-01's finite-value gate already ran on `result.redScore`/
 * `result.blueScore` earlier in `update()`), never an input this function
 * should paper over.
 */
export function foldElimScoreOffset(prior: ElimScoreOffset, residual: number, alpha: number): ElimScoreOffset {
  if (!Number.isFinite(residual)) {
    throw new Error(`foldElimScoreOffset: non-finite residual ${residual} — refusing to fold into the elim score offset`);
  }
  return {
    value: (1 - alpha) * prior.value + alpha * residual,
    count: prior.count + 1,
  };
}

/**
 * The offset APPLIED to one alliance's predicted score in `predict()`.
 * Returns EXACTLY `0` — not a computed value that happens to be near it — on
 * TWO INDEPENDENT gates (D-10), either of which alone is sufficient:
 * `params.elimScoreOffsetEnabled === false` (the whole mechanism is off,
 * regardless of `compLevel`) and `!isElimination(compLevel)` (a
 * qualification match, regardless of the flag). Otherwise returns the
 * accumulated `offset.value` verbatim, with no clamp or transform.
 */
export function elimScoreOffsetFor(offset: ElimScoreOffset, compLevel: CompLevel, params: Sigma1ResolvedParams): number {
  if (!params.elimScoreOffsetEnabled || !isElimination(compLevel)) return 0;
  return offset.value;
}
