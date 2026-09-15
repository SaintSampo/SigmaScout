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
