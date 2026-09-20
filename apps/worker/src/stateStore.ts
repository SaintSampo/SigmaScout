/**
 * Batched D1 reads and writes of algorithm state, plus per-event cron
 * bookkeeping (`event_cursor`). This module is the only place a Worker
 * tick touches `apps/worker/migrations/0001_algorithm_state.sql`'s two
 * tables — every column name and the `algorithm_state` primary key
 * `(algorithm_id, scope_kind, scope_key)` below must match that migration
 * exactly.
 *
 * TRANSACTION SEMANTICS (load-bearing, read before calling
 * `writeScopedState`): a D1 `batch()` call is a SQL transaction. If any
 * statement in it fails, D1 rolls back the whole batch — there is no
 * partial-success outcome. A caller that catches the rejection must treat
 * it as "nothing advanced this tick" and either retry the whole batch or
 * defer to the next tick. This is a different failure model from the other
 * two storage systems this Worker talks to: R2's `put()` calls each
 * succeed or fail independently, and KV is eventually consistent. Three
 * different failure models sit side by side in one Worker on purpose —
 * conflating them is how a subtle inconsistency ships.
 *
 * `readScopedState`/`writeScopedState` cost exactly one D1 subrequest each,
 * regardless of how many teams a tick touches: the read is one prepared
 * statement with a `scope_key IN (...)` placeholder list (the league row
 * rides along in the same query), and the write is one `db.batch([...])`
 * call over as many upsert statements as there are changed rows.
 *
 * The Worker reads back rows the offline seed wrote and rebuilds an
 * in-memory algorithm state through `packages/harness/stateSnapshot.ts`'s
 * `deserializeState` — the same deserializer the offline pipeline's own
 * round-trip tests already prove lossless — this module must never grow a
 * second deserializer that could drift from it.
 */
import type { StateRow, StateRowScopeKind } from "../../../packages/harness/stateSnapshot.js";

export type { StateRow, StateRowScopeKind } from "../../../packages/harness/stateSnapshot.js";

/**
 * A generous, named ceiling on how many scope keys a single
 * `readScopedState` call will bind into one `IN (...)` clause, totaled
 * across every selection in the request (a request may name more than one
 * scope kind — e.g. OPR's event key plus its touched teams — in one call).
 * The peak realistic tick is nowhere near this, but a caller that one day
 * passes an unbounded key list should get a named, actionable error here
 * rather than an opaque D1/SQLite bound-parameter-limit failure. Chunked
 * reads are deliberately not implemented — a chunked read would cost more
 * than one subrequest, exactly the invariant this module exists to hold.
 */
export const MAX_SCOPE_KEYS_PER_READ = 100;

interface AlgorithmStateRow {
  readonly scope_kind: string;
  readonly scope_key: string;
  readonly algorithm_version: string;
  readonly state_json: string;
  readonly generation: string;
  readonly computed_at: string;
}

const ALGORITHM_STATE_SELECT_COLUMNS = "scope_kind, scope_key, algorithm_version, state_json, generation, computed_at";

/**
 * One scope kind's own key list within a `readScopedState` request. An
 * algorithm that stores more than one scope kind (OPR's `event` rows
 * alongside its `team` rows) names all of them here, in one request —
 * never a second `readScopedState` call, which would spend a second
 * subrequest.
 */
export interface ScopeSelection {
  readonly scopeKind: StateRowScopeKind;
  readonly scopeKeys: readonly string[];
}

/**
 * One D1 statement, one subrequest, however many selections or keys: reads
 * every row for `algorithmId` matching any of `selections` (each
 * selection's key list is matched against its own `scopeKind` explicitly —
 * a team key is never satisfied by an event row, and vice versa), plus the
 * algorithm's single `scope_kind = 'league'` row (a value every tick
 * needs, folded into the same query rather than costing a second one).
 * Returns an empty array (never throws) for an algorithm with no rows at
 * all, so a not-yet-seeded algorithm degrades to "nothing to advance"
 * instead of taking the tick down.
 */
export async function readScopedState(db: D1Database, algorithmId: string, selections: readonly ScopeSelection[]): Promise<StateRow[]> {
  const totalKeys = selections.reduce((sum, s) => sum + s.scopeKeys.length, 0);
  if (totalKeys > MAX_SCOPE_KEYS_PER_READ) {
    throw new Error(
      `readScopedState: ${totalKeys} scope keys across ${selections.length} selection(s) exceeds MAX_SCOPE_KEYS_PER_READ ` +
        `(${MAX_SCOPE_KEYS_PER_READ}) — a single tick should never touch this many; this is a named error rather than an ` +
        `opaque driver failure`
    );
  }

  const nonEmptySelections = selections.filter((s) => s.scopeKeys.length > 0);
  const groups = nonEmptySelections.map((s) => `(scope_kind = ? AND scope_key IN (${s.scopeKeys.map(() => "?").join(",")}))`);
  const whereTail = groups.length > 0 ? `(${groups.join(" OR ")}) OR scope_kind = 'league'` : `scope_kind = 'league'`;
  // `whereTail` must be wrapped in its own parens here. SQL binds AND
  // tighter than OR, so an unparenthesized `algorithm_id = ? AND ${whereTail}`
  // parses as `(algorithm_id = ? AND (groups)) OR (scope_kind = 'league')`
  // — the league-row fallback would not be scoped to `algorithmId` at all,
  // and a cold-started algorithm with no league row of its own could
  // deserialize a DIFFERENT algorithm's league row as its own, corrupting
  // the fold. See `readScopedStateSql.test.ts` (a real SQLite engine, not
  // a JS fake) for the regression test binding this exact scenario.
  const sql = `SELECT ${ALGORITHM_STATE_SELECT_COLUMNS} FROM algorithm_state WHERE algorithm_id = ? AND (${whereTail})`;
  const bindArgs: (string | number)[] = [algorithmId];
  for (const selection of nonEmptySelections) {
    bindArgs.push(selection.scopeKind, ...selection.scopeKeys);
  }

  const { results } = await db
    .prepare(sql)
    .bind(...bindArgs)
    .all<AlgorithmStateRow>();

  return results.map((row) => ({
    algorithmId,
    algorithmVersion: row.algorithm_version,
    scopeKind: row.scope_kind as StateRowScopeKind,
    scopeKey: row.scope_key,
    stateJson: row.state_json,
    generation: row.generation,
    computedAt: row.computed_at,
  }));
}

const ALGORITHM_STATE_UPSERT_SQL = `INSERT INTO algorithm_state (algorithm_id, algorithm_version, scope_kind, scope_key, state_json, generation, computed_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(algorithm_id, scope_kind, scope_key) DO UPDATE SET
  algorithm_version = excluded.algorithm_version,
  state_json = excluded.state_json,
  generation = excluded.generation,
  computed_at = excluded.computed_at`;

/**
 * One `db.batch([...])` call, one subrequest, regardless of row count — an
 * empty `rows` array performs zero calls rather than an empty batch. See
 * this module's header for the transaction semantics a rejection implies:
 * none of `rows` advanced this tick, never a partial application. Callers
 * should filter `rows` through `selectChangedRows` first so an unchanged
 * team never costs a write — a direct saving against D1's
 * 100,000-rows-written-per-day free allowance.
 */
export async function writeScopedState(db: D1Database, rows: readonly StateRow[]): Promise<void> {
  if (rows.length === 0) return;
  const statements = rows.map((row) =>
    db
      .prepare(ALGORITHM_STATE_UPSERT_SQL)
      .bind(row.algorithmId, row.algorithmVersion, row.scopeKind, row.scopeKey, row.stateJson, row.generation, row.computedAt)
  );
  await db.batch(statements);
}

function rowIdentity(row: Pick<StateRow, "algorithmId" | "scopeKind" | "scopeKey">): string {
  return `${row.algorithmId}::${row.scopeKind}::${row.scopeKey}`;
}

/**
 * Drops every `candidateRow` whose `stateJson` is byte-identical to the
 * matching `priorRow` — a row with no matching prior row at all counts as
 * changed (it is new). This is what makes advancing an event twice with
 * the same match list a genuine no-op at the write layer:
 * `stateSnapshot.ts`'s serializer is key-sorted and stable precisely so
 * re-serializing an untouched team's state produces the identical string.
 */
export function selectChangedRows(priorRows: readonly StateRow[], candidateRows: readonly StateRow[]): StateRow[] {
  const priorStateJsonByIdentity = new Map(priorRows.map((row) => [rowIdentity(row), row.stateJson]));
  return candidateRows.filter((row) => priorStateJsonByIdentity.get(rowIdentity(row)) !== row.stateJson);
}

// event_cursor: per-event cron bookkeeping.

/** `apps/worker/migrations/0001_algorithm_state.sql`'s `event_cursor` row, camelCased. */
export interface EventCursor {
  readonly eventKey: string;
  readonly tbaEtag: string | null;
  readonly lastFoldedMatchKey: string | null;
  readonly lastPolledAt: string | null;
  readonly lastAdvancedAt: string | null;
}

interface EventCursorRow {
  readonly event_key: string;
  readonly tba_etag: string | null;
  readonly last_folded_match_key: string | null;
  readonly last_polled_at: string | null;
  readonly last_advanced_at: string | null;
}

/** Returns `undefined` for an event with no cursor row yet (never polled) — not an error, a genuine "nothing known yet" state. */
export async function readEventCursor(db: D1Database, eventKey: string): Promise<EventCursor | undefined> {
  const row = await db
    .prepare(`SELECT event_key, tba_etag, last_folded_match_key, last_polled_at, last_advanced_at FROM event_cursor WHERE event_key = ?`)
    .bind(eventKey)
    .first<EventCursorRow>();
  if (row === null) return undefined;
  return {
    eventKey: row.event_key,
    tbaEtag: row.tba_etag,
    lastFoldedMatchKey: row.last_folded_match_key,
    lastPolledAt: row.last_polled_at,
    lastAdvancedAt: row.last_advanced_at,
  };
}

/**
 * Every named `event_cursor` row in ONE prepared statement, ONE subrequest,
 * however many keys — the multi-key sibling of `readEventCursor` (kept
 * exactly as it is; nothing below replaces it). An empty `eventKeys` array
 * performs zero calls and returns an empty map.
 *
 * This costs one subrequest REGARDLESS OF KEY COUNT, which is what lets a
 * tick read its own rotation/rebuild sentinel (`TICK_META_EVENT_KEY`) and
 * every live algorithm's state-baseline marker (`stateBaselineEventKey`, see
 * `packages/harness/stateBaseline.ts`) in the ONE subrequest
 * `readTickState` (`apps/worker/src/scheduled.ts`) already spent on the
 * sentinel alone, rather than adding a second round trip per marker.
 */
export async function readEventCursors(db: D1Database, eventKeys: readonly string[]): Promise<Map<string, EventCursor>> {
  const result = new Map<string, EventCursor>();
  if (eventKeys.length === 0) return result;

  const placeholders = eventKeys.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT event_key, tba_etag, last_folded_match_key, last_polled_at, last_advanced_at FROM event_cursor WHERE event_key IN (${placeholders})`)
    .bind(...eventKeys)
    .all<EventCursorRow>();

  for (const row of results) {
    result.set(row.event_key, {
      eventKey: row.event_key,
      tbaEtag: row.tba_etag,
      lastFoldedMatchKey: row.last_folded_match_key,
      lastPolledAt: row.last_polled_at,
      lastAdvancedAt: row.last_advanced_at,
    });
  }
  return result;
}

export async function writeEventCursor(db: D1Database, cursor: EventCursor): Promise<void> {
  await db
    .prepare(
      `INSERT INTO event_cursor (event_key, tba_etag, last_folded_match_key, last_polled_at, last_advanced_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(event_key) DO UPDATE SET
         tba_etag = excluded.tba_etag,
         last_folded_match_key = excluded.last_folded_match_key,
         last_polled_at = excluded.last_polled_at,
         last_advanced_at = excluded.last_advanced_at`
    )
    .bind(cursor.eventKey, cursor.tbaEtag, cursor.lastFoldedMatchKey, cursor.lastPolledAt, cursor.lastAdvancedAt)
    .run();
}

/**
 * The idempotency anchor: `cursor`'s `lastFoldedMatchKey` marks the last
 * match, in the event's own order (`orderedMatchKeys` — never a timestamp
 * comparison, which can tie), that has already been folded into
 * `algorithm_state`. A tick folds only matches that come strictly after
 * that anchor, so a retried invocation, an overlapping invocation, or an
 * unchanged TBA payload cannot double-apply a match's `update()`.
 *
 * A cursor with `lastFoldedMatchKey: null` (nothing folded yet for this
 * event) means every match is unfolded — always returns `false`. Throws
 * for a `matchKey` genuinely absent from `orderedMatchKeys` (a caller bug).
 */
export function hasAlreadyFolded(
  cursor: Pick<EventCursor, "lastFoldedMatchKey">,
  matchKey: string,
  orderedMatchKeys: readonly string[]
): boolean {
  if (cursor.lastFoldedMatchKey === null) return false;

  const matchIndex = orderedMatchKeys.indexOf(matchKey);
  if (matchIndex === -1) {
    throw new Error(`hasAlreadyFolded: matchKey "${matchKey}" is not present in the event's own ordered match list`);
  }

  const cursorIndex = orderedMatchKeys.indexOf(cursor.lastFoldedMatchKey);
  // The cursor's own anchor is missing from this tick's order list —
  // degrade to "not yet folded" rather than throw, since this tick's list
  // is authoritative and failing loudly here would take the whole tick
  // down over bookkeeping.
  if (cursorIndex === -1) return false;

  return matchIndex <= cursorIndex;
}
