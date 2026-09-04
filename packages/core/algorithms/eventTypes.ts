/**
 * The single official-play predicate for the whole system (quick task
 * 260904-586). Three independent producers each need to know whether an
 * event counts toward the OFFICIAL season: the offline publisher
 * (`packages/harness/publish.ts`), the live Worker's incremental merge
 * (`apps/worker/src/scheduled.ts`), and the browser's team-page header
 * (`apps/web/src/lib/officialSnapshot.ts`). Before this file existed, the
 * browser encoded its own copy of this rule inline; this is now the ONE
 * definition all three read, so the Teams list and the team page header
 * cannot silently drift apart again.
 *
 * `packages/corpus/schema.sql` derives its `is_offseason` column from TBA's
 * `event_type == 99` ONLY — preseason "Week 0" (`event_type == 100`) is a
 * separate TBA event type the corpus does NOT flag as offseason, even though
 * it is exhibition play in every sense that matters here. That is why this
 * predicate names both constants explicitly rather than trusting a single
 * `is_offseason`-shaped boolean: a caller that only checked `is_offseason`
 * would still let Week-0 results move the season leaderboard.
 *
 * This file must import nothing — `packages/core/isomorphic.test.ts`
 * enforces that no file under `packages/core` reaches for a Node built-in or
 * `better-sqlite3`, since this code also has to run unchanged inside the
 * Cloudflare Worker and the browser.
 */

/** TBA's offseason event type. The corpus's `is_offseason` column is derived from exactly this value. */
export const OFFSEASON_EVENT_TYPE = 99;

/** TBA's preseason "Week 0" event type. NOT covered by the corpus's `is_offseason` column — named separately here for that reason. */
export const PRESEASON_EVENT_TYPE = 100;

/**
 * True for an event that counts toward the official season: everything that
 * is neither offseason nor preseason Week 0. Regional, district, district
 * championship, championship division, championship finals, district
 * championship division and Festival of Champions event types (0-6) are all
 * official. An unknown or sentinel type (including `scheduled.ts`'s `-1`
 * "event detail fetch failed" degradation value) also returns `true` —
 * degrading toward "keep updating the leaderboard" rather than toward
 * "silently freeze it" when officialness cannot be determined.
 */
export function isOfficialEventType(eventType: number): boolean {
  return eventType !== OFFSEASON_EVENT_TYPE && eventType !== PRESEASON_EVENT_TYPE;
}
