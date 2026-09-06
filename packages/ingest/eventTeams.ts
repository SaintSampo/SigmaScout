/**
 * Pure helpers for the `--event-teams-only` ingest mode (quick task
 * 260905-tll Task 3, C-16). `event_teams` was populated only inside the
 * `--districts-only` loop before this task, so it covered district events
 * exclusively — 150 of 2026's 310 events and ZERO regionals, championships,
 * preseason or offseason events — leaving the pre-schedule ("scheduleless
 * event") publish path nearly inert. These two functions are the mode's
 * testable core, split out of `cli.ts` so they can be covered without
 * importing the CLI:
 *
 * - `selectOfficialEventKeysForYear` picks which events the mode iterates,
 *   reading the shared `isOfficialEventType` predicate rather than
 *   re-listing event-type numbers — that predicate is already the single
 *   source `packages/harness/publish.ts` and `apps/worker/src/scheduled.ts`
 *   both read, and a fourth copy of the list is how the four drift.
 * - `eventTeamsUrlFor` is the ONE spelling of the `/event/{key}/teams/keys`
 *   path, so the CLI's fetch and the ETag cache key can never be spelled
 *   differently (the cache is keyed by URL string — see `cachedEtagFor` in
 *   `cli.ts`).
 */
import { isOfficialEventType } from "../core/algorithms/eventTypes.js";
import type { Corpus } from "../corpus/db.js";

/**
 * Every event key for `year` whose `event_type` counts toward the official
 * season (`isOfficialEventType`: everything that is neither offseason 99
 * nor preseason 100), ascending by event key. Reads the corpus's OWN
 * `events` table — the `--event-teams-only` mode runs over an
 * ALREADY-INGESTED season and never re-fetches `/events/{year}`.
 */
export function selectOfficialEventKeysForYear(db: Corpus, year: number): string[] {
  const rows = db
    .prepare(`SELECT event_key, event_type FROM events WHERE year = ? ORDER BY event_key ASC`)
    .all(year) as { event_key: string; event_type: number }[];
  return rows.filter((row) => isOfficialEventType(row.event_type)).map((row) => row.event_key);
}

/** The `/event/{key}/teams/keys` path — the fetch URL AND the ETag cache key, spelled exactly once. */
export function eventTeamsUrlFor(eventKey: string): string {
  return `/event/${eventKey}/teams/keys`;
}
