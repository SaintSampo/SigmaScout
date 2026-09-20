/**
 * The D1 bulk seed emitter: `emitSeedSql` writes `StateRow`s as a `.sql` file
 * for `wrangler d1 execute --file`, the bulk seed of the `algorithm_state` table.
 *
 * Node-only (`node:fs`/`node:path`), split out of `stateSnapshot.ts` so the
 * row format and its readers stay browser-safe. Never re-export this from
 * `stateSnapshot.ts`: that would pull these imports back into the browser graph.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StateRow } from "./stateSnapshot.js";
import { isReservedEventCursorKey, stateBaselineEventKey } from "./stateBaseline.js";

/** Doubles single quotes; applied to every string field, since `state_json` is arbitrary JSON text. */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

const INSERT_COLUMNS = "(algorithm_id, algorithm_version, scope_kind, scope_key, state_json, generation, computed_at)";

function sqlRowTuple(row: StateRow): string {
  return (
    `('${escapeSqlString(row.algorithmId)}', '${escapeSqlString(row.algorithmVersion)}', ` +
    `'${escapeSqlString(row.scopeKind)}', '${escapeSqlString(row.scopeKey)}', ` +
    `'${escapeSqlString(row.stateJson)}', '${escapeSqlString(row.generation)}', '${escapeSqlString(row.computedAt)}')`
  );
}

/**
 * D1 caps a statement at 100,000 bytes and `wrangler d1 execute --file` fails
 * the whole import (`SQLITE_TOOBIG`) if one exceeds it; 90,000 leaves headroom
 * for the `INSERT INTO ... VALUES` prefix.
 */
export const DEFAULT_MAX_STATEMENT_LENGTH = 90_000;

/** D1's hard limit, for the error message. */
const D1_STATEMENT_LIMIT = 100_000;
/** Cap on value tuples per `INSERT`; whichever cap is reached first starts a new statement. */
const DEFAULT_MAX_ROWS_PER_INSERT = 500;

/**
 * Thrown when one row's own tuple exceeds `maxStatementLength`. Batching cannot
 * help; it means per-key data sits in a row meant for aggregates and belongs in
 * team rows, so a tick reads only the keys it folds.
 */
export class SeedRowTooLargeError extends Error {
  constructor(
    readonly algorithmId: string,
    readonly scopeKind: string,
    readonly scopeKey: string,
    readonly tupleLength: number,
    readonly maxStatementLength: number
  ) {
    super(
      `emitSeedSql: algorithm "${algorithmId}" row (scopeKind="${scopeKind}", scopeKey="${scopeKey}") is ${tupleLength} bytes as a single ` +
        `INSERT tuple, over the ${maxStatementLength}-byte per-statement budget (D1's hard limit is ${D1_STATEMENT_LIMIT}). ` +
        `A single row cannot be split across statements, so this cannot be fixed by batching — it means per-key data is being ` +
        `stored in a row meant for aggregates. Move it into scopeKind:"team" rows.`
    );
    this.name = "SeedRowTooLargeError";
  }
}

export interface EmitSeedSqlOptions {
  /** The algorithm this seed is for; its rows are deleted first, since a re-baseline overwrites rather than merges. */
  readonly algorithmId: string;
  /** Output `.sql` file path. */
  readonly out: string;
  /** Overrides `DEFAULT_MAX_ROWS_PER_INSERT`. */
  readonly maxRowsPerInsert?: number;
  /** Overrides `DEFAULT_MAX_STATEMENT_LENGTH`. */
  readonly maxStatementLength?: number;
}

/**
 * Writes rows as a `.sql` file for `wrangler d1 execute --file`: a leading
 * per-algorithm `DELETE` (the offline run is the authority), then batched
 * multi-row `INSERT`s capped by tuple count and statement length. One terminal
 * file write, so an interrupted emit leaves no half-file.
 */
export function emitSeedSql(rows: readonly StateRow[], options: EmitSeedSqlOptions): void {
  const { algorithmId, out } = options;
  const maxRowsPerInsert = options.maxRowsPerInsert ?? DEFAULT_MAX_ROWS_PER_INSERT;
  const maxStatementLength = options.maxStatementLength ?? DEFAULT_MAX_STATEMENT_LENGTH;

  const statements: string[] = [`DELETE FROM algorithm_state WHERE algorithm_id = '${escapeSqlString(algorithmId)}';`];

  let currentTuples: string[] = [];
  let currentLength = 0;

  const flush = (): void => {
    if (currentTuples.length === 0) return;
    statements.push(`INSERT INTO algorithm_state ${INSERT_COLUMNS} VALUES ${currentTuples.join(",")};`);
    currentTuples = [];
    currentLength = 0;
  };

  for (const row of rows) {
    const tuple = sqlRowTuple(row);
    // Fail before batching: a tuple over the budget on its own can never fit.
    if (tuple.length + 1 > maxStatementLength) {
      throw new SeedRowTooLargeError(algorithmId, row.scopeKind, row.scopeKey, tuple.length, maxStatementLength);
    }
    const wouldExceedLength = currentTuples.length > 0 && currentLength + tuple.length + 1 > maxStatementLength;
    const wouldExceedCount = currentTuples.length >= maxRowsPerInsert;
    if (wouldExceedLength || wouldExceedCount) flush();
    currentTuples.push(tuple);
    currentLength += tuple.length + 1;
  }
  flush();

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${statements.join("\n")}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// The fourth seed file: event_cursor rows + per-algorithm state-baseline
// markers (quick task 260920-q75). Applied LAST, after every seed-<id>.sql.
// ---------------------------------------------------------------------------

/** One event's cursor entry for `emitCursorSeedSql`. */
export interface CursorSeedEntry {
  readonly eventKey: string;
  /** The last match key this run's replay folded for this event, or `null` for a window this run folded nothing for (a probe-only, zero-match event). */
  readonly lastFoldedMatchKey: string | null;
}

export interface EmitCursorSeedSqlOptions {
  /** This publish run's generation — written onto every state-baseline marker row, and the `WHERE EXISTS` guard's own generation. */
  readonly generation: string;
  /** This run's stamp, written onto every cursor and marker row's timestamp columns. */
  readonly computedAt: string;
  /** Algorithm ids this run emitted a `seed-<id>.sql` state file for — exactly the set that gets a baseline marker row. */
  readonly algorithmIds: readonly string[];
  readonly cursors: readonly CursorSeedEntry[];
  readonly out: string;
}

/** A supplied event key collided with a reserved `event_cursor` key (the tick-meta sentinel or a state-baseline marker prefix) — see `stateBaseline.ts`. Thrown rather than silently emitting a row that would clobber scheduler bookkeeping. */
export class ReservedEventCursorKeyError extends Error {
  constructor(readonly eventKey: string) {
    super(
      `emitCursorSeedSql: cursor event key "${eventKey}" collides with a reserved event_cursor key ` +
        `(the tick-meta sentinel or the state-baseline marker prefix, see packages/harness/stateBaseline.ts) — ` +
        `refusing to emit a row that would clobber scheduler bookkeeping.`
    );
    this.name = "ReservedEventCursorKeyError";
  }
}

/**
 * Writes the D1 seed's fourth file: one upsert per `cursors` entry (the
 * offline run's own last-folded match per event, `tba_etag` always reset to
 * `NULL` so the next tick re-polls TBA from scratch), followed by one
 * GUARDED upsert per `algorithmIds` entry — the state-baseline marker, which
 * only lands when that algorithm's own state rows at `generation` are
 * already present in `algorithm_state` (an `INSERT ... SELECT ... WHERE
 * EXISTS (...) ON CONFLICT DO UPDATE`, verified against a real SQLite engine
 * in `seedSql.test.ts`). Applying this file before the three `seed-<id>.sql`
 * files leaves the cursor rows in place but the marker rows absent — the
 * tick keeps refusing to fold until this file is re-applied.
 *
 * Throws `ReservedEventCursorKeyError` before writing anything if any
 * `cursors` entry's `eventKey` collides with a reserved key. One terminal
 * `writeFileSync`, matching `emitSeedSql`'s no-half-file discipline.
 */
export function emitCursorSeedSql(options: EmitCursorSeedSqlOptions): void {
  const { generation, computedAt, algorithmIds, cursors, out } = options;

  for (const cursor of cursors) {
    if (isReservedEventCursorKey(cursor.eventKey)) throw new ReservedEventCursorKeyError(cursor.eventKey);
  }

  const lines: string[] = [
    "-- Generated by packages/harness/publish.ts (emitCursorSeedSql).",
    "-- APPLY THIS FILE LAST, after every seed-<id>.sql in this run.",
    "--",
    "-- The cursor rows below and the permission to fold (the state-baseline marker",
    "-- rows that follow them) land together in this one file on purpose: applying",
    "-- cursors before state would let the very next tick fold against the PREVIOUS",
    "-- generation's state using the NEW cursors -- silently reproducing the exact",
    "-- mid-event re-baseline incident this file exists to prevent.",
    "--",
    "-- Applying this file before the seed-<id>.sql files leaves the cursor rows in",
    "-- place but the marker rows absent (each guarded by a WHERE EXISTS against",
    "-- algorithm_state): the tick keeps refusing to fold, and re-running this file",
    "-- after the state seeds lands the markers and clears the refusal.",
    "",
  ];

  for (const cursor of cursors) {
    const lastFolded = cursor.lastFoldedMatchKey === null ? "NULL" : `'${escapeSqlString(cursor.lastFoldedMatchKey)}'`;
    lines.push(
      `INSERT INTO event_cursor (event_key, tba_etag, last_folded_match_key, last_polled_at, last_advanced_at) ` +
        `VALUES ('${escapeSqlString(cursor.eventKey)}', NULL, ${lastFolded}, '${escapeSqlString(computedAt)}', '${escapeSqlString(computedAt)}') ` +
        `ON CONFLICT(event_key) DO UPDATE SET tba_etag = excluded.tba_etag, last_folded_match_key = excluded.last_folded_match_key, ` +
        `last_polled_at = excluded.last_polled_at, last_advanced_at = excluded.last_advanced_at;`
    );
  }

  for (const algorithmId of algorithmIds) {
    const markerKey = stateBaselineEventKey(algorithmId);
    lines.push(
      `INSERT INTO event_cursor (event_key, tba_etag, last_folded_match_key, last_polled_at, last_advanced_at) ` +
        `SELECT '${escapeSqlString(markerKey)}', NULL, '${escapeSqlString(generation)}', '${escapeSqlString(computedAt)}', '${escapeSqlString(computedAt)}' ` +
        `WHERE EXISTS (SELECT 1 FROM algorithm_state WHERE algorithm_id = '${escapeSqlString(algorithmId)}' AND generation = '${escapeSqlString(generation)}') ` +
        `ON CONFLICT(event_key) DO UPDATE SET tba_etag = excluded.tba_etag, last_folded_match_key = excluded.last_folded_match_key, ` +
        `last_polled_at = excluded.last_polled_at, last_advanced_at = excluded.last_advanced_at;`
    );
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
}

/** `writeSeedCommandsFile`'s inputs. */
export interface WriteSeedCommandsFileOptions {
  /** The live Worker's D1 database name (`apps/worker/wrangler.toml`'s `[[d1_databases]]` binding). */
  readonly databaseName: string;
  /** This run's seed files, in APPLY ORDER — the cursors file (`emitCursorSeedSql`'s `out`) must be last. */
  readonly seedFiles: readonly string[];
  readonly out: string;
}

/**
 * Writes `reports/publish/SEED-COMMANDS.txt`: the exact ordered `wrangler d1
 * execute` invocations for one run's seed files, one per line, in the order
 * supplied. `--env-file` has wrangler read the credential itself; no value
 * from `.env` is ever read or interpolated here. Kept in this module (rather
 * than as an inline `writeFileSync` in `publish.ts`) so every filesystem side
 * effect of the seed step sits behind the one module `publish.test.ts` already
 * mocks.
 */
export function writeSeedCommandsFile(options: WriteSeedCommandsFileOptions): void {
  const { databaseName, seedFiles, out } = options;
  const lines: string[] = [
    "# Applying these files out of order suspends folding rather than corrupting state.",
    '# See docs/worker-operations.md\'s "Re-baselining" section.',
    ...seedFiles.map((file) => `npx wrangler d1 execute ${databaseName} --remote --env-file .env --file ${file}`),
  ];
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
}
