/**
 * D-02's rewind-overconfidence gap (08-CONTEXT.md) — mirrored here so
 * 08-11's Simulation-tab caption can render the measured figure without a
 * human retyping it.
 *
 * `docs/models/rewind-overconfidence-gap.md`'s ```json rewind-gap``` block
 * is the number's SINGLE SOURCE OF TRUTH. These five constants are a
 * hand-written mirror, kept honest by `scripts/measureRewindGap.test.ts`'s
 * sync guard, which parses the doc's committed block and asserts every
 * constant below equals its corresponding field — mirroring
 * `packages/harness/payloadBudget.test.ts`'s existing treatment of
 * `docs/publish-budget.md`. A hand-edited caption number, a stale constant
 * after a re-measurement, or a doc block updated without this file all fail
 * that test loudly.
 *
 * `REWIND_GAP_PERCENT` is stored UNROUNDED, matching this project's
 * established convention that Brier/accuracy/calibration figures are kept
 * unrounded at rest — display rounding belongs to the render site (08-11),
 * not here.
 *
 * `REWIND_GAP_VERDICT` is exported ALONGSIDE the magnitude for a reason
 * that is not optional: 08-11's caption MUST consult `REWIND_GAP_VERDICT`
 * before asserting a narrowing. D-02 explicitly permits a measured result
 * of "wider" or "indistinguishable" — a caption that says "narrower"
 * against either of those verdicts would be exactly the unearned claim
 * this whole plan exists to prevent.
 *
 * Zero imports, deliberately — nothing about the web bundle changes by
 * this file's presence.
 */

/** Unrounded `headline.meanNarrowingPercent` from the committed measurement. Positive means the rewind arm's rank band came out narrower than the honest from-here forecast; negative is a legitimate finding, never clamped. */
export const REWIND_GAP_PERCENT = 10.848394210456348;

/** The measurement's own verdict, derived from `|meanNarrowingPercent| <= meanNoiseFloorPercent`. Consult this before rendering the word "narrower" anywhere. */
export const REWIND_GAP_VERDICT: "narrower" | "wider" | "indistinguishable" = "narrower";

/** ISO timestamp the underlying measurement was produced. */
export const REWIND_GAP_MEASURED_AT = "2026-08-31T21:30:31.398Z";

/** Number of events the measurement sampled (`headline.eventCount`). */
export const REWIND_GAP_EVENT_COUNT = 5;

/** Number of paired (event, start-point) measurements the mean/verdict were computed over (`headline.measurementCount`). */
export const REWIND_GAP_MEASUREMENT_COUNT = 15;
