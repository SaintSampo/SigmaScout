/**
 * The event lease (quick task 261019-oim). A tick that runs past 60 s overlaps
 * the next cron invocation, and two invocations folding DIFFERENT events both
 * read and rewrite each algorithm's shared `league` row, so the later write
 * erased the earlier event's contribution.
 *
 * Each tick takes one `event_lease` row per open live window, in ONE D1 batch
 * before any pass runs, and releases them in ONE statement when it ends. A tick
 * that finds a window still held by another, unexpired tick skips it. A lease
 * expires after `EVENT_LEASE_TTL_MS`, so a killed tick's rows are taken over.
 * The table is `apps/worker/migrations/0004_event_lease.sql`.
 *
 * Worker safe: no zod at runtime, no Node built in.
 */
import type { D1Database } from "@cloudflare/workers-types";

/**
 * How long a lease holds: the Workers cron wall time ceiling. A row older than
 * this belongs to a tick that was killed, never to one still running, so the
 * next tick takes it over.
 */
export const EVENT_LEASE_TTL_MS = 15 * 60 * 1000;

/**
 * Takes the lease on one event: inserts it when absent, takes it over when the
 * stored lease has expired, and otherwise changes nothing. `meta.changes` is 1
 * when this tick now holds the key and 0 when another tick still does. ISO UTC
 * strings compare correctly as text, which the WHERE relies on.
 */
export const EVENT_LEASE_ACQUIRE_SQL =
  "INSERT INTO event_lease (event_key, tick_id, leased_at, expires_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(event_key) DO UPDATE SET tick_id = excluded.tick_id, leased_at = excluded.leased_at, expires_at = excluded.expires_at WHERE event_lease.expires_at <= excluded.leased_at";

/** Releases every lease one tick holds. */
export const EVENT_LEASE_RELEASE_SQL = "DELETE FROM event_lease WHERE tick_id = ?1";

/** The longest error message a lease warn line carries. */
const LEASE_ERROR_MESSAGE_MAX = 300;

function truncatedMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, LEASE_ERROR_MESSAGE_MAX);
}

/** `meta.changes` read defensively: a result without it counts as 0, so a fake never taught the count skips everything and fails loudly. */
function changesOf(result: unknown): number {
  const changes = (result as { meta?: { changes?: unknown } } | undefined)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

/**
 * ONE `db.batch` of acquire statements over the sorted, de-duplicated keys;
 * returns the keys whose statement changed a row, which are the keys this tick
 * now holds. No keys, no call. THROWS if D1 throws: the caller decides what an
 * unavailable lease means (the tick folds unguarded).
 */
export async function acquireEventLeases(db: D1Database, eventKeys: readonly string[], tickId: string, nowMs: number): Promise<Set<string>> {
  const keys = [...new Set(eventKeys)].sort();
  const held = new Set<string>();
  if (keys.length === 0) return held;
  const leasedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + EVENT_LEASE_TTL_MS).toISOString();
  const statement = db.prepare(EVENT_LEASE_ACQUIRE_SQL);
  const results = await db.batch(keys.map((eventKey) => statement.bind(eventKey, tickId, leasedAt, expiresAt)));
  keys.forEach((eventKey, index) => {
    if (changesOf(results[index]) > 0) held.add(eventKey);
  });
  return held;
}

/**
 * One statement. NEVER throws: a failure warns one JSON line and returns, and
 * the leases it failed to release expire on their own.
 */
export async function releaseEventLeases(db: D1Database, tickId: string): Promise<void> {
  try {
    await db.prepare(EVENT_LEASE_RELEASE_SQL).bind(tickId).run();
  } catch (error) {
    console.warn(JSON.stringify({ msg: "event-lease-release-failed", tickId, error: truncatedMessage(error) }));
  }
}
