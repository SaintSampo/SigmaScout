/**
 * Dependency-free leaf enforcing `Prediction.pRedWin`'s documented closed
 * interval [0, 1] as a runtime fact, not merely a type comment (01-REVIEW
 * WR-05). Mirrors `packages/core/algorithms/breakdown/constants.ts`'s
 * `assertFiniteComponents` in framing and hoisting rationale — one shared
 * implementation every algorithm calls, rather than three copies that can
 * drift.
 *
 * Per D-05, the check runs where `predict()` returns — NOT at `scoreSet`'s
 * or `calibrationBins`'s entry (`packages/core/scoring/brier.ts`,
 * `packages/core/scoring/calibration.ts`, both deliberately untouched by
 * this module). Phase 2 writes per-match prediction JSONL sidecars, so a
 * scoring-boundary-only check would let a malformed `pRedWin` reach an
 * artifact on disk before anything notices; an emission-time check can also
 * name the algorithm and match that produced the value, rather than only
 * reporting that a final aggregated score is `NaN`.
 *
 * Per D-09, this module deliberately does NOT decide what happens to a
 * malformed prediction once caught here: a single bad `pRedWin` is a
 * per-prediction anomaly, handled by harness-side quarantine-and-count
 * (`packages/harness/score.ts`'s `aggregateScores`) — deliberately UNLIKE
 * the OPR solver's `denom`/`residual` guard (`opr.ts`'s
 * `applyObservation`), which aborts the whole run outright because shared
 * model state, not a single prediction, is unrecoverable there. Two
 * failure classes, two responses — do not normalize them into one policy.
 */

/**
 * True iff `pRedWin` is finite and lies in the closed interval [0, 1]
 * inclusive (both endpoints valid).
 */
export function isValidPRedWin(pRedWin: number): boolean {
  return Number.isFinite(pRedWin) && pRedWin >= 0 && pRedWin <= 1;
}

/**
 * Throws when `pRedWin` fails `isValidPRedWin`, naming both the offending
 * value and the caller-supplied `context` (which algorithm, which match) so
 * the failure is attributable without re-running. The prediction is
 * refused here — it is never recorded, persisted, or scored.
 */
export function assertValidPRedWin(pRedWin: number, context: string): void {
  if (!isValidPRedWin(pRedWin)) {
    throw new Error(
      `pRedWin ${pRedWin} is not a valid win probability (${context}) — must be finite and within the closed interval [0, 1]; refusing to publish this prediction`
    );
  }
}
