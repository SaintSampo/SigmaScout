/**
 * BROWSER-SAFE home of the "is this event's schedule still current" rule
 * (moved verbatim out of `publish.ts` by 260915-m4j; `publish.ts` re-exports
 * both names). Imports nothing, so the web can reuse the exact rule the
 * publisher applies: the event page's and the robot page's polling gates
 * (`apps/web/src/lib/liveEvent.ts`) ask the same question with `computedAt` set
 * to the browser's now. `browserSafeSchemas.test.ts` holds this file to the full
 * browser-safe assertion.
 *
 * The constant was `STATE_BLOCK_STALE_AFTER_MS` until quick task 260923-3w7,
 * because the first thing this rule gated was whether an event still got a
 * `state` block. That block is deleted; the 7-day window is not, and it never had
 * anything to do with blocks beyond having been introduced for one.
 */

/** How long after its latest scheduled match an event's unplayed matches stop counting as still-upcoming. */
export const SCHEDULE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether an event with unplayed matches is still current enough to treat those matches as
 * genuinely upcoming. The corpus holds 146 long-finished events whose scheduled matches were never
 * played (2016flrc has 24 of 28); treating those as upcoming would poll and price matches that will
 * never happen (Jacob, 2026-09-15, of the `state` block this rule first gated: no block once the
 * event is over). Current means the latest scheduled `sortTime` (played or unplayed) is no
 * older than `SCHEDULE_STALE_AFTER_MS` before `computedAt`. With no scheduled time, the event's
 * `startDate` stands in; with neither, or no `computedAt`, staleness cannot be shown and the event
 * counts as current.
 */
export function eventScheduleIsCurrent(input: {
  readonly scheduledTimes: readonly number[];
  readonly startDate: string | undefined;
  readonly computedAt: string | undefined;
}): boolean {
  const now = input.computedAt !== undefined ? Date.parse(input.computedAt) : Number.NaN;
  if (!Number.isFinite(now)) return true;
  const latest =
    input.scheduledTimes.length > 0
      ? Math.max(...input.scheduledTimes)
      : input.startDate !== undefined
        ? Date.parse(input.startDate)
        : Number.NaN;
  if (!Number.isFinite(latest)) return true;
  return latest >= now - SCHEDULE_STALE_AFTER_MS;
}
