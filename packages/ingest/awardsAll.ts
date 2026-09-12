/**
 * Pure helpers for the `--awards-all-only` ingest mode (quick task
 * 260912-5n8 T1). Modelled directly on `eventTeams.ts` next door, which
 * solved the identical "the existing mode only covered district events"
 * problem: the testable core lives here so it can be covered without
 * importing `cli.ts`, and the CLI holds nothing but the fetch loop.
 *
 * WHY A SECOND AWARD PATH EXISTS. `districts.ts`'s `normalizeEventAwards`
 * drops every award type outside `{0,1,9,10}` and every recipient whose
 * `team_key` is null. That filter is correct for what it feeds —
 * `packages/core/districts/qualification.ts:94` throws on any other award
 * type, and it is a shipped surface — so it must not be widened. But it
 * means the corpus has never seen a single judged award beyond those four,
 * nor any award at a regional or championship. Asking "can FRC awards be
 * predicted?" against that slice would measure the ingest filter, not the
 * awards. Hence: a parallel normalize with NO filters, writing to a
 * parallel table (`event_awards_all`), read by nothing the site ships.
 *
 * These three functions are the mode's entire testable surface:
 *
 * - `selectAllEventKeysForYear` picks which events the mode iterates.
 *   Unlike `selectOfficialEventKeysForYear`, it is deliberately NOT gated
 *   on `isOfficialEventType` — see its own comment.
 * - `normalizeEventAwardsAll` is the unfiltered normalize.
 * - `eventAwardsAllEtagKey` is the ONE spelling of this mode's ETag cache
 *   key, and it is deliberately NOT the fetch URL.
 */
import type { Corpus } from "../corpus/db.js";
import type { TbaEventAwardsResponse } from "./schemas.js";

/**
 * EVERY event key for `year` in the corpus's own `events` table, ascending.
 *
 * Deliberately NOT gated on `isOfficialEventType`, which is what
 * `selectOfficialEventKeysForYear` (eventTeams.ts) uses and what every
 * other season-wide mode uses. Offseason (99) and preseason (100) events
 * give out real awards, and this table is research material: storing them
 * and excluding them at SCORING time is recoverable and countable, while
 * filtering them out at INGEST time is not — a later question that wants
 * them would need a whole second backfill pass over the TBA API. The
 * experiment that reads this table excludes 99/100 itself and prints the
 * excluded count, so the split stays visible rather than silent.
 *
 * Reads the corpus's OWN `events` table: the `--awards-all-only` mode runs
 * over an ALREADY-INGESTED season and never re-fetches `/events/{year}`,
 * matching `ingestSeasonAwardsOnly`/`ingestSeasonEventTeamsOnly`.
 */
export function selectAllEventKeysForYear(db: Corpus, year: number): string[] {
  const rows = db
    .prepare(`SELECT event_key FROM events WHERE year = ? ORDER BY event_key ASC`)
    .all(year) as { event_key: string }[];
  return rows.map((row) => row.event_key);
}

/**
 * One recipient of one award, positionally identified. `awardIndex` is the
 * award's index in the `/event/{key}/awards` response array and
 * `recipientIndex` its index within that award's `recipient_list` — together
 * with the event key they form `event_awards_all`'s primary key, which is
 * why they are produced here rather than invented at the write boundary.
 * `eventKey`/`year`/`fetchedAt` are deliberately absent: the caller supplies
 * all three, mirroring `NormalizedEventAward`'s own split.
 */
export interface NormalizedEventAwardAll {
  awardType: number;
  awardIndex: number;
  recipientIndex: number;
  teamKey: string | null;
  awardee: string | null;
  name: string;
}

/**
 * Normalizes a (possibly null) TBA `/event/{key}/awards` response into
 * per-recipient records, keeping EVERYTHING.
 *
 * The two lines that are conspicuously absent are the two that make
 * `normalizeEventAwards` the wrong function for this job:
 *
 *   1. NO `QUALIFICATION_RELEVANT_AWARD_TYPES` filter. Every award type TBA
 *      has ever enumerated is kept, including ones that do not exist yet —
 *      TBA's contract is that a type, once enumerated, is never changed, so
 *      an unknown number is a new award, not corruption.
 *   2. NO null-`team_key` skip. A person-only recipient (Woodie Flowers,
 *      Volunteer of the Year, Dean's List) is kept with its `awardee` and a
 *      null `teamKey`. Dropping those would quietly shrink the denominator
 *      of any "how many awards were given here" question.
 *
 * An award with an EMPTY `recipient_list` contributes no rows — there is
 * nothing to index — which is the one and only case where an award present
 * in the response is not represented in the output.
 *
 * A `null` body and an `[]` body both return `[]` and neither throws: two
 * real, distinct "nothing to report" answers, never coerced into each other,
 * mirroring every other normalize in this package.
 */
export function normalizeEventAwardsAll(response: TbaEventAwardsResponse): NormalizedEventAwardAll[] {
  if (response === null || response.length === 0) return [];
  const result: NormalizedEventAwardAll[] = [];
  response.forEach((award, awardIndex) => {
    award.recipient_list.forEach((recipient, recipientIndex) => {
      result.push({
        awardType: award.award_type,
        awardIndex,
        recipientIndex,
        teamKey: recipient.team_key,
        awardee: recipient.awardee,
        name: award.name,
      });
    });
  });
  return result;
}

/**
 * This mode's ETag cache key for one event — `/event/{key}/awards#all`.
 *
 * THE TRAP THIS EXISTS TO AVOID, and it is load-bearing. `readEtag`/
 * `writeEtag` are keyed by the URL STRING, not by the mode. The existing
 * `--awards-only` mode has already cached `/event/{key}/awards` for every
 * district event it has ever visited. If this mode reused that key, TBA
 * would answer 304 Not Modified WITH NO BODY on exactly the events that
 * already have awards — the events with the most to contribute — and the
 * backfill would store nothing while reporting a clean, successful run.
 * The `#all` fragment gives this mode its own cache namespace over the same
 * fetch URL; `fetchEventAwards` builds the real request URL itself, so the
 * cache key is free to differ and costs nothing to pass.
 *
 * `awardsAll.test.ts` pins this key as NOT EQUAL to `/event/{key}/awards`.
 * That assertion is the whole defence — a comment would not have caught it.
 */
export function eventAwardsAllEtagKey(eventKey: string): string {
  return `/event/${eventKey}/awards#all`;
}
