/**
 * BROWSER-SAFE home of the "is this event's schedule still current" rule
 * (moved verbatim out of `publish.ts` by 260915-m4j; `publish.ts` re-exports
 * both names). Imports nothing, so the web can reuse the exact rule the
 * publisher gates state blocks on (LD-5): the event page's polling and the
 * team page's event-artifact fetch ask the same question with `computedAt`
 * set to the browser's now. `browserSafeSchemas.test.ts` holds this file to
 * the full browser-safe assertion.
 */

/** How long after its latest scheduled match an event's unplayed matches stop counting as upcoming for the state block. */
export const STATE_BLOCK_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether an event with unplayed matches is still current enough to carry a `state` block. The
 * corpus holds 146 long-finished events whose scheduled matches were never played (2016flrc has 24
 * of 28); a block on those would price matches that will never happen (Jacob, 2026-09-15: no block
 * once the event is over). Current means the latest scheduled `sortTime` (played or unplayed) is no
 * older than `STATE_BLOCK_STALE_AFTER_MS` before `computedAt`. With no scheduled time, the event's
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
  return latest >= now - STATE_BLOCK_STALE_AFTER_MS;
}
