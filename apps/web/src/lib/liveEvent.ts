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
import { eventScheduleIsCurrent, SCHEDULE_STALE_AFTER_MS } from "../../../../packages/harness/eventSchedule.js";
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

/** The played-row facts the finished test reads. Every field is optional so a row shape that predates one of them still type-checks; a missing field reads as "not a decided final". */
export interface PlayedRowShape extends ScheduledRow {
  readonly compLevel?: string;
  readonly setNumber?: number;
  readonly actualWinner?: unknown;
}

/**
 * Whether the artifact's played rows show the event is OVER: one colour holds
 * two or more wins within a single finals set, the same rule the Worker's
 * `eventPhase.ts` derives `complete` from. A finals set still at one win each,
 * or no finals row at all, is not finished.
 */
export function eventArtifactLooksFinished(matches: readonly PlayedRowShape[]): boolean {
  const finalsWins = new Map<number, { red: number; blue: number }>();
  for (const row of matches) {
    if (row.compLevel !== "f") continue;
    if (row.actualWinner !== "red" && row.actualWinner !== "blue") continue;
    const setNumber = row.setNumber ?? 1;
    const wins = finalsWins.get(setNumber) ?? { red: 0, blue: 0 };
    wins[row.actualWinner]++;
    finalsWins.set(setNumber, wins);
  }
  for (const wins of finalsWins.values()) if (wins.red >= 2 || wins.blue >= 2) return true;
  return false;
}

/**
 * LD-3, widened by quick task 261017-doy: poll while the schedule is current
 * and the event is not over. Finished and stale events never poll.
 *
 * "Something left to play" used to be read off `upcoming` alone, which went
 * empty the moment the last qualification match was scored — and the page
 * then stopped polling for the rest of the day, through alliance selection
 * and the playoff schedule landing, until the reader reloaded. An empty
 * `upcoming` now keeps polling until the finals are decided
 * (`eventArtifactLooksFinished`); the 7-day currency rule bounds an event
 * that never posts a playoff.
 */
export function shouldPollEventArtifact(
  artifact: { readonly matches: readonly PlayedRowShape[]; readonly upcoming: readonly ScheduledRow[]; readonly startDate?: string } | undefined,
  nowMs: number
): boolean {
  if (artifact === undefined) return false;
  if (!eventArtifactScheduleIsCurrent(artifact, nowMs)) return false;
  return artifact.upcoming.length > 0 || !eventArtifactLooksFinished(artifact.matches);
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
 * seven-day currency rule cannot be asked of it. Since quick task 261007-jvz's
 * finality cascade a curtailed event (2023nhgrs played 52 of 78 qualification
 * matches) finishes once its alliances are picked and its later stages close,
 * so it stops polling. The limitation remains for a member event that starts
 * and is abandoned BEFORE alliance selection: it never finishes, and it would
 * keep an OPEN district page polling at the floor forever. The bound is the reader's own attention plus TanStack's focus
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

// ---------------------------------------------------------------------------
// The Events page LIST's poll gate (quick task 261024-jdz)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` plus `days`, by calendar arithmetic on the string's own parts. `Date.UTC` is used purely as a calendar here, so no time zone is ever applied. */
function addDaysToDateString(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Poll the Events page list at the 60 s floor while at least one row is inside
 * its live window: its start date is today or earlier (the browser's LOCAL date,
 * as `events.tsx` and `isDisplayableEvent` read it) and today is no more than
 * `SCHEDULE_STALE_AFTER_MS` (7 days) past it. The window length is the
 * publisher's own, imported so it stays defined in one place.
 *
 * NO COUNT GATE. Played equals total in the gap between the last qualification
 * match and the playoff schedule landing (quick task 261017-doy fixed that same
 * gap for the event page), and a promoted event reads 0/0 until the Worker
 * patches it. Both need polling, and a list row carries no finals facts to tell
 * a finished event apart.
 *
 * THE HONEST LIMITATION, stated here because it is a real one: the list row
 * carries a start date and counts, but no match times, no end date and no finals
 * result. So a finished event keeps an open Events page polling at the 60 s floor
 * until its window closes (at most 7 days after its start), and in season the
 * page polls whenever any event is in its window. The bound is the window plus
 * TanStack's focus gating (`refetchIntervalInBackground` stays unset, so a hidden
 * tab stops). Each poll re-reads the edge-cached list (max-age 60). A second,
 * finer currency approximation is deliberately NOT invented.
 *
 * A malformed `startDate` makes that row not live, which errs toward not polling:
 * the list still renders, it just does not refresh.
 */
export function shouldPollEventsList(artifact: { readonly events: readonly { readonly startDate: string }[] } | undefined, nowMs: number): boolean {
  if (artifact === undefined) return false;
  const today = new Date(nowMs).toLocaleDateString("en-CA");
  const windowDays = SCHEDULE_STALE_AFTER_MS / DAY_MS;
  return artifact.events.some((row) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.startDate)) return false;
    // Plain string comparison is correct for zero-padded ISO dates.
    return row.startDate <= today && today <= addDaysToDateString(row.startDate, windowDays);
  });
}
