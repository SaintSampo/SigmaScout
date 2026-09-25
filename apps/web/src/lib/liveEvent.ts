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
import {
  districtEventStateFinished,
  districtEventStateStarted,
  type DistrictEventStateFacts as DistrictEventStateShape,
} from "../../../../packages/core/districts/reservedSlots.js";

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

// ---------------------------------------------------------------------------
// The DISTRICT artifact's own poll gate (phase 10)
// ---------------------------------------------------------------------------

/**
 * The four state facts 10-03 publishes per (team, event) cell, and the two
 * predicates over them, now live in `packages/core/districts/reservedSlots.ts`
 * — the slot-reservation rule added by quick task 260925-ms7 needs the same
 * "started" and "finished" answers, and that module is reachable from the
 * harness and the Worker while this one is not. They are RE-EXPORTED here,
 * under their own names, so the poll gate below and every existing importer of
 * this module are unchanged.
 */
export {
  districtEventStateFinished,
  districtEventStateStarted,
  type DistrictEventStateFacts,
} from "../../../../packages/core/districts/reservedSlots.js";

interface DistrictArtifactPollShape {
  readonly teams: readonly {
    readonly eventPoints: readonly { readonly tier: "district" | "dcmp"; readonly state?: DistrictEventStateShape }[];
    readonly remainingEvents: readonly { readonly tier: "district" | "dcmp"; readonly state?: DistrictEventStateShape }[];
  }[];
}

/**
 * Poll the district artifact at the 60 s floor while at least one MEMBER
 * district-tier event is started and not finished.
 *
 * THE HONEST LIMITATION, stated here because it is a real one: the district
 * artifact carries week numbers but NO MATCH TIMES, so `eventScheduleIsCurrent`'s
 * seven-day currency rule cannot be asked of it. A member event that starts and
 * never finishes would therefore keep an OPEN district page polling at the
 * floor forever. The bound is the reader's own attention plus TanStack's focus
 * gating (`refetchIntervalInBackground` stays unset, so a hidden tab stops).
 * The EXPENSIVE per-event artifact fetches keep the full currency rule, because
 * they go through `eventQueryOptions`. A second, date-free approximation of
 * currency is deliberately NOT invented to paper over this.
 */
export function shouldPollDistrictArtifact(artifact: DistrictArtifactPollShape | undefined): boolean {
  if (artifact === undefined) return false;
  for (const team of artifact.teams) {
    for (const row of [...team.eventPoints, ...team.remainingEvents]) {
      if (row.tier !== "district") continue;
      const state = row.state;
      if (state === undefined) continue;
      if (districtEventStateStarted(state) && !districtEventStateFinished(state)) return true;
    }
  }
  return false;
}
