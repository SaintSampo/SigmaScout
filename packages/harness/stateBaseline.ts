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
 * e.g. `2026casj`), and never begins with an underscore.
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

/** True for the tick-meta sentinel or any state-baseline marker key — the full reserved-key set a real corpus event key must never collide with. */
export function isReservedEventCursorKey(eventKey: string): boolean {
  return eventKey === TICK_META_EVENT_KEY || eventKey.startsWith(STATE_BASELINE_KEY_PREFIX);
}
