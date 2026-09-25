/**
 * The shared contract for the two RESERVED `event_cursor` keys neither side
 * may confuse with a real TBA event key: the tick's own rotation/rebuild
 * sentinel (`TICK_META_EVENT_KEY`, already used by `apps/worker/src/scheduled.ts`
 * before this file existed) and the per-algorithm state-baseline marker this
 * file introduces (quick task 260920-q75).
 *
 * Browser-safe (no `node:` imports, no Zod) so the offline publisher
 * (`packages/harness/publish.ts`, `packages/harness/seedSql.ts`) and the
 * Worker (`apps/worker/src/scheduled.ts`) share exactly ONE definition of
 * what these keys look like and how a baseline row is read, without either
 * side pulling in the other's runtime.
 *
 * THE CONTRACT: a baseline row's `last_folded_match_key` column holds a BARE
 * generation string (e.g. `"e5cf1304"`), never JSON — unlike the tick-meta
 * sentinel row, which stores a JSON blob in that same column. A bare string
 * needs no `JSON.parse` at all, which is why the marker rides in
 * `event_cursor` rather than `algorithm_state` (see this quick task's
 * PLAN.md "What was verified" section for the full argument).
 *
 * No real TBA event key can collide with `STATE_BASELINE_KEY_PREFIX`: every
 * TBA event key is `<year><shortname>` (digits then lowercase letters/digits,
 * e.g. `2026casj`), and never begins with an underscore. The two phase-10
 * prefixes below are underscore-prefixed for exactly that reason, so the
 * collision proof covers them unchanged.
 *
 * WHY A DISTRICT-RANKINGS AND AN EVENT-AWARDS ETAG BELONG IN `event_cursor`
 * AT ALL (phase 10, plan 10-05). Both are per-tick conditional-request
 * bookkeeping with exactly the lifecycle `event_cursor.tba_etag` already has:
 * written by the tick, read by the next tick, meaningless to anything else,
 * and reset by a seed. `apps/worker/migrations/0001_algorithm_state.sql`'s
 * `event_cursor` header gives co-location with the cursor it advances
 * alongside as the reason `tba_etag` and `last_folded_match_key` share a
 * table; a district's rankings ETag advances alongside its member events'
 * cursors on the same tick, and an event's awards ETag alongside that event's
 * own. `readEventCursors` also reads every one of them in ONE subrequest
 * regardless of key count, which is what lets the district pass pay for the
 * whole set at once.
 *
 * BOTH SHAPES ARE DECLARED HERE, IN ONE PLACE, ON PURPOSE. This file is the
 * single definition of the reserved-key set that `emitCursorSeedSql`
 * (`packages/harness/seedSql.ts`) consults before writing a seed row.
 * Splitting the set across two plans or two files is how a seed comes to
 * clobber a row nobody registered.
 */

export const TICK_META_EVENT_KEY = "__scheduler_meta__";

/** Prefix for a per-algorithm state-baseline marker's `event_cursor.event_key`. Never a real TBA event key — see this file's header. */
export const STATE_BASELINE_KEY_PREFIX = "__state_baseline__:";

/** The reserved `event_cursor.event_key` a state-baseline marker for `algorithmId` is stored under. */
export function stateBaselineEventKey(algorithmId: string): string {
  return `${STATE_BASELINE_KEY_PREFIX}${algorithmId}`;
}

/** The inverse of `stateBaselineEventKey`: the algorithm id a baseline-marker event key names, or `undefined` for any other key (including a bare/empty prefix match). */
export function parseStateBaselineAlgorithmId(eventKey: string): string | undefined {
  if (!eventKey.startsWith(STATE_BASELINE_KEY_PREFIX)) return undefined;
  const id = eventKey.slice(STATE_BASELINE_KEY_PREFIX.length);
  return id.length > 0 ? id : undefined;
}

/** Prefix for a district's `/district/{key}/rankings` conditional-request ETag row (10-05). Never a real TBA event key — see this file's header. */
export const DISTRICT_RANKINGS_KEY_PREFIX = "__district_rankings__:";

/** The reserved `event_cursor.event_key` a district's rankings ETag is stored under. `districtKey` is TBA's own year-prefixed key (e.g. `"2026pnw"`). */
export function districtRankingsCursorKey(districtKey: string): string {
  return `${DISTRICT_RANKINGS_KEY_PREFIX}${districtKey}`;
}

/** Prefix for an event's `/event/{key}/awards` conditional-request ETag row (10-05). Deliberately DISTINCT from the event's own cursor row, whose `tba_etag` belongs to the match poll and must never be overwritten by an awards response's etag. */
export const EVENT_AWARDS_KEY_PREFIX = "__event_awards__:";

/** The reserved `event_cursor.event_key` an event's awards ETag is stored under. */
export function eventAwardsCursorKey(eventKey: string): string {
  return `${EVENT_AWARDS_KEY_PREFIX}${eventKey}`;
}

/** True for the tick-meta sentinel, any state-baseline marker key, any district-rankings ETag key or any event-awards ETag key — the full reserved-key set a real corpus event key must never collide with. */
export function isReservedEventCursorKey(eventKey: string): boolean {
  return (
    eventKey === TICK_META_EVENT_KEY ||
    eventKey.startsWith(STATE_BASELINE_KEY_PREFIX) ||
    eventKey.startsWith(DISTRICT_RANKINGS_KEY_PREFIX) ||
    eventKey.startsWith(EVENT_AWARDS_KEY_PREFIX)
  );
}
