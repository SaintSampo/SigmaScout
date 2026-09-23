/**
 * "Is this artifact live enough to keep polling?" for the web (260915-m4j).
 *
 * The currency rule is the publisher's own `eventScheduleIsCurrent` (7 days
 * after the latest scheduled match), reused from its browser-safe home and
 * asked relative to the browser's now rather than the artifact's own
 * `computedAt`: the question here is whether the event is current today, not
 * whether it was current when it was written.
 *
 * Both polls exist because the live Worker rewrites both artifacts as it folds:
 * the event artifact for the event and match pages, the team artifact for the
 * robot page. 60 s is the floor either way (see `EVENT_POLL_INTERVAL_MS`).
 *
 * Pure module, no React.
 */
import { eventScheduleIsCurrent } from "../../../../packages/harness/eventSchedule.js";

/**
 * How often a live query refetches, event or team. The artifact origin serves
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
 * A ROBOT PAGE POLLS ITS OWN TEAM ARTIFACT while it still has an unplayed row
 * at an event whose schedule is current (quick task 260923-3w7).
 *
 * This replaces `teamEventNeedsLivePricing`, which answered a different
 * question — "should this page fetch that EVENT's artifact?" — for a page that
 * reconstructed its live rows from the event artifact because the Worker wrote
 * no team artifact at all (260917-jr4). The Worker writes one again, so the
 * robot page reads one file and this is the only thing left to decide: how
 * often to re-read it.
 *
 * THE SCHEDULE-CURRENCY CONJUNCT IS BACK, and for the reason it was removed.
 * 260917-jr4 (D-05) dropped it because a FINISHED event's matches would have
 * rendered as UNPLAYED once the window closed and no team artifact carried the
 * results — a correctness cliff. That cannot happen here: currency gates
 * POLLING, never the fetch, and the published team artifact already carries
 * every result whether or not this returns true. Without the conjunct an
 * abandoned event whose matches will never be played would poll every 60
 * seconds forever, which is exactly what `shouldPollEventArtifact`'s own
 * currency test exists to stop.
 */
export function shouldPollTeamArtifact(
  artifact: { readonly events: readonly { readonly startDate?: string; readonly matches: readonly (ScheduledRow & { readonly actualWinner?: unknown })[] }[] } | undefined,
  nowMs: number
): boolean {
  if (artifact === undefined) return false;
  return artifact.events.some(
    (event) => event.matches.some((match) => match.actualWinner === undefined) && eventArtifactScheduleIsCurrent({ matches: event.matches, upcoming: [], startDate: event.startDate }, nowMs)
  );
}
