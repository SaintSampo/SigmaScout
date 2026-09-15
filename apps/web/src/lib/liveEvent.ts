/**
 * "Is this event live enough to fetch or poll?" for the web (260915-m4j).
 *
 * LD-5: state blocks exist only for events with a current schedule, decided
 * by the publisher's `eventScheduleIsCurrent` (7 days after the latest
 * scheduled match). The web reuses exactly that function, from its
 * browser-safe home, asking relative to the browser's now rather than the
 * artifact's own `computedAt`: the question here is whether the event is
 * current today, not whether it was current when it was written.
 *
 * Pure module, no React.
 */
import { eventScheduleIsCurrent } from "../../../../packages/harness/eventSchedule.js";

/**
 * How often a live event query refetches. The artifact origin serves
 * `Cache-Control: public, max-age=60`, so polling faster would only re-read
 * the edge cache: 60 s is the floor.
 */
export const EVENT_POLL_INTERVAL_MS = 60_000;

/**
 * A published `sortTime` as epoch milliseconds. The corpus writes epoch ms,
 * but some published artifacts carry epoch seconds; any seconds value this
 * side of year ~5138 is < 1e11 and any real ms timestamp is > 1e12, so 1e11
 * splits them unambiguously.
 */
export function sortTimeToEpochMs(sortTime: number): number {
  return sortTime > 1e11 ? sortTime : sortTime * 1000;
}

interface ScheduledRow {
  readonly sortTime?: number;
}

function scheduledTimesMs(rows: readonly ScheduledRow[]): number[] {
  return rows.flatMap((row) => (row.sortTime !== undefined ? [sortTimeToEpochMs(row.sortTime)] : []));
}

/** `eventScheduleIsCurrent` over every played and upcoming sort time (in ms) and the start date, relative to `nowMs`. */
export function eventArtifactScheduleIsCurrent(
  artifact: { readonly matches: readonly ScheduledRow[]; readonly upcoming: readonly ScheduledRow[]; readonly startDate?: string },
  nowMs: number
): boolean {
  return eventScheduleIsCurrent({
    scheduledTimes: [...scheduledTimesMs(artifact.matches), ...scheduledTimesMs(artifact.upcoming)],
    startDate: artifact.startDate,
    computedAt: new Date(nowMs).toISOString(),
  });
}

/** LD-3: poll only while there is something left to play and the schedule is current. Finished and stale events never poll. */
export function shouldPollEventArtifact(
  artifact: { readonly matches: readonly ScheduledRow[]; readonly upcoming: readonly ScheduledRow[]; readonly startDate?: string } | undefined,
  nowMs: number
): boolean {
  return artifact !== undefined && artifact.upcoming.length > 0 && eventArtifactScheduleIsCurrent(artifact, nowMs);
}

/**
 * LD-2: a team page fetches an event's artifact only when the team still has
 * an unplayed match there and the event's schedule is current. A
 * long-finished event whose leftover matches were never played is never
 * fetched.
 */
export function teamEventNeedsLivePricing(
  event: { readonly startDate?: string; readonly matches: readonly (ScheduledRow & { readonly actualWinner?: unknown })[] },
  nowMs: number
): boolean {
  if (!event.matches.some((match) => match.actualWinner === undefined)) return false;
  return eventScheduleIsCurrent({
    scheduledTimes: scheduledTimesMs(event.matches),
    startDate: event.startDate,
    computedAt: new Date(nowMs).toISOString(),
  });
}
