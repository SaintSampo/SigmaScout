/**
 * The ingest log's SQL, taught to every fake D1 the tick tests build (quick task
 * 261004-uyc). Each fake's `executeWrite` THROWS on SQL it does not recognise, so
 * the tick's one insert (and the completion prune) needs a branch in all of them;
 * this module is that branch's single implementation.
 *
 * A fake holds one `IngestLogFakeStore` and hands it any statement
 * `isIngestLogSql` accepts. The store parses the ONE bound JSON string the real
 * insert takes, so a test can read the rows exactly as D1 would hold them.
 */
import { INGEST_LOG_INSERT_SQL, INGEST_LOG_PRUNE_SQL, type IngestLogRow } from "../../src/ingestLog.js";

/** True for the ingest log's insert and its prune, the only two statements the tick issues against `ingest_log`. */
export function isIngestLogSql(sql: string): boolean {
  return sql === INGEST_LOG_INSERT_SQL || sql === INGEST_LOG_PRUNE_SQL;
}

export class IngestLogFakeStore {
  /** Every row written so far, in insertion order. */
  rows: IngestLogRow[] = [];
  /** Statements attempted (including a rejected one), so a test can assert a 304 tick issued none. */
  statementCount = 0;
  /** When set, every ingest statement throws it, modelling a missing table. */
  rejectWith: Error | null = null;

  apply(sql: string, args: readonly unknown[]): number {
    this.statementCount++;
    if (this.rejectWith !== null) throw this.rejectWith;
    if (sql === INGEST_LOG_PRUNE_SQL) {
      const cutoff = String(args[0]);
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => row.observedAt >= cutoff);
      return before - this.rows.length;
    }
    const parsed = JSON.parse(String(args[0])) as IngestLogRow[];
    this.rows.push(...parsed);
    return parsed.length;
  }
}
