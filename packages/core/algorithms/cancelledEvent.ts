/**
 * The single "cancelled event" predicate (quick task 260929-mcf). Three
 * producers read it: the offline publisher (`packages/harness/publish.ts`),
 * the browser's events fetcher (`apps/web/src/lib/api/events.ts`) and the
 * operator cleanup script (`scripts/pruneCancelledEvents.ts`).
 *
 * THE RULE (LOCKED). An event is cancelled only when its end date is in the
 * past, with a grace window, AND it has zero played matches. An upcoming or
 * in-progress zero-match event is NOT cancelled and keeps its Worker probe
 * window. Getting that wrong is exactly what broke Chezy Champs on 2026-09-20
 * (quick task 260920-lny): a zero-match event that is about to run must stay
 * visible and pollable.
 *
 * END-DATE PROXY. The corpus `events` table stores only `start_date`; there
 * is no `end_date` column, and neither the corpus nor TBA carries an explicit
 * cancelled flag. So the end date is taken as `start_date` midnight UTC plus
 * `EVENT_SPAN_ALLOWANCE_MS` (4 days, the same span `PROBE_WINDOW_SPAN_MS`
 * uses to cover a multi-day championship), and `CANCELLED_EVENT_GRACE_MS`
 * (3 more days) keeps a late TBA upload from being hidden. The effective rule:
 * zero played matches AND now >= start_date + 7 days.
 *
 * WHY 7 EXCEEDS THE PROBE WINDOW. A probe window closes at start_date + 4 days,
 * so a cancelled event (7+ days) can never also hold a probe window: the
 * Worker never polls it, and the publisher never needs its stub.
 *
 * Deliberately independent of event type: NOT merged with `isOfficialEventType`
 * or `foldsIntoRatings`, which answer different questions (does this event
 * count toward the official season; may a match teach the ratings).
 *
 * "Now" is always the caller's reference instant (the publish `computedAt`, or
 * a published artifact's own `computedAt`), never an ambient clock read here.
 * A browser-clock check would hide a live event a week after the last publish,
 * because the Worker never rewrites a published events list.
 *
 * This file must import nothing: `packages/core/isomorphic.test.ts` enforces
 * that no file under `packages/core` reaches for a Node built-in, since this
 * code also runs in the Worker and the browser.
 */

/** The facts the predicate needs; a published events-list row carries exactly these two fields. */
export interface CancellationFacts {
  readonly startDate: string;
  readonly playedMatchCount: number;
}

/** Stand-in for an event's span: `start_date` midnight UTC plus this is the assumed end date. */
export const EVENT_SPAN_ALLOWANCE_MS = 4 * 24 * 60 * 60 * 1000;

/** Grace after the assumed end date before a zero-match event is judged cancelled. */
export const CANCELLED_EVENT_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * True when the event has zero played matches and `nowMs` is at least
 * `start_date + EVENT_SPAN_ALLOWANCE_MS + CANCELLED_EVENT_GRACE_MS`. An
 * unparseable start date or a non-finite `nowMs` returns false: degrade toward
 * showing, mirroring `probeWindowFor`.
 */
export function isCancelledEvent(facts: CancellationFacts, nowMs: number): boolean {
  if (facts.playedMatchCount > 0) return false;
  const startMs = Date.parse(facts.startDate);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return false;
  return nowMs >= startMs + EVENT_SPAN_ALLOWANCE_MS + CANCELLED_EVENT_GRACE_MS;
}
