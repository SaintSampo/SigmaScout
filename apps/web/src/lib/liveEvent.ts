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
 * LD-2: a team page fetches an event's artifact when the team still has an
 * unplayed PUBLISHED row there.
 *
 * THE SCHEDULE-CURRENCY CONJUNCT WAS DELIBERATELY REMOVED (quick task
 * 260917-jr4, D-05 unsound part 1), and this comment exists so it is not
 * "restored" as an obvious optimisation. It used to also require
 * `eventScheduleIsCurrent` (7 days past the last scheduled match). That was
 * harmless while the live Worker wrote results into the team artifact: once
 * the window closed, the team page fell back to a team artifact that already
 * carried the results. The Worker no longer writes team artifacts at all, so
 * under that rule a FINISHED event's matches would render as UNPLAYED on the
 * robot page from the moment the window closed until the next offline
 * republish — a correctness cliff, not a stale number.
 *
 * WHAT THE REMOVAL COSTS, stated so the trade is visible: an abandoned event
 * whose matches were never played (and never will be) keeps one extra
 * CDN-cached fetch per robot page, forever. That is bounded, cheap, served
 * from the edge, and strictly better than rendering a finished event as
 * unplayed.
 *
 * `shouldPollEventArtifact`'s currency test is deliberately UNTOUCHED. That
 * one governs POLLING, not fetching, and polling a dead event every 60
 * seconds is exactly the thing the currency test exists to stop.
 */
export function teamEventNeedsLivePricing(event: { readonly startDate?: string; readonly matches: readonly (ScheduledRow & { readonly actualWinner?: unknown })[] }): boolean {
  return event.matches.some((match) => match.actualWinner === undefined);
}
