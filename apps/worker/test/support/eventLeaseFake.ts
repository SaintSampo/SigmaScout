/**
 * The event lease's SQL, taught to every fake D1 the tick tests build (quick task
 * 261019-oim). Each fake's `executeWrite` THROWS on SQL it does not recognise, so
 * the tick's lease statements need a branch in all of them; this module is that
 * branch's single implementation, modelled on `ingestLogFake.ts`.
 *
 * A fake routes a batch made only of lease statements here BEFORE any of its own
 * counters, logs or `rejectNextBatchWith`: those model the fold's state writes,
 * and a lease batch landing in them would consume a rejection meant for Phase A.
 * `eventLease.test.ts` proves this store returns the change counts a real SQLite
 * engine returns for the same statements.
 */
import { EVENT_LEASE_ACQUIRE_SQL, EVENT_LEASE_RELEASE_KEY_SQL, EVENT_LEASE_RELEASE_SQL } from "../../src/eventLease.js";

/** True for the lease's acquire, release and release-by-key statements, exactly as `eventLease.ts` writes them. */
export function isEventLeaseSql(sql: string): boolean {
  return sql === EVENT_LEASE_ACQUIRE_SQL || sql === EVENT_LEASE_RELEASE_SQL || sql === EVENT_LEASE_RELEASE_KEY_SQL;
}

export interface EventLeaseFakeRow {
  tickId: string;
  leasedAt: string;
  expiresAt: string;
}

export class EventLeaseFakeStore {
  /** The `event_lease` table, by event key. */
  rows = new Map<string, EventLeaseFakeRow>();
  /** Every attempted lease statement, a rejected one included. */
  statementCount = 0;
  /** Every attempted release of a tick's event leases, a rejected one included. */
  releaseCount = 0;
  /** Every attempted fold lease release (release by key), a rejected one included. */
  releaseKeyCount = 0;
  /** When set, every lease statement throws it, modelling a missing table or a D1 outage. */
  rejectWith: Error | null = null;

  /** Applies one lease statement and returns what D1 reports as `meta.changes`. */
  apply(sql: string, args: readonly unknown[]): number {
    this.statementCount++;
    if (sql === EVENT_LEASE_RELEASE_SQL) this.releaseCount++;
    if (sql === EVENT_LEASE_RELEASE_KEY_SQL) this.releaseKeyCount++;
    if (this.rejectWith !== null) throw this.rejectWith;
    if (sql === EVENT_LEASE_ACQUIRE_SQL) {
      const [eventKey, tickId, leasedAt, expiresAt] = args as string[];
      const existing = this.rows.get(eventKey!);
      // The ON CONFLICT ... WHERE event_lease.expires_at <= excluded.leased_at rule.
      if (existing !== undefined && !(existing.expiresAt <= leasedAt!)) return 0;
      this.rows.set(eventKey!, { tickId: tickId!, leasedAt: leasedAt!, expiresAt: expiresAt! });
      return 1;
    }
    if (sql === EVENT_LEASE_RELEASE_SQL) {
      const tickId = String(args[0]);
      let deleted = 0;
      for (const [eventKey, row] of [...this.rows]) {
        if (row.tickId !== tickId) continue;
        this.rows.delete(eventKey);
        deleted++;
      }
      return deleted;
    }
    if (sql === EVENT_LEASE_RELEASE_KEY_SQL) {
      const [eventKey, tickId] = args as string[];
      if (this.rows.get(eventKey!)?.tickId !== tickId) return 0;
      this.rows.delete(eventKey!);
      return 1;
    }
    throw new Error(`EventLeaseFakeStore.apply: unrecognized SQL: ${sql}`);
  }
}
