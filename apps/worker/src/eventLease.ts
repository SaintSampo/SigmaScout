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

/** Releases ONE lease, and only while the given tick still holds it: the fold lease's release. */
export const EVENT_LEASE_RELEASE_KEY_SQL = "DELETE FROM event_lease WHERE event_key = ?1 AND tick_id = ?2";

/**
 * THE FOLD LEASE. The event lease stops two invocations touching the SAME
 * window; it does not stop one invocation folding event A while another folds
 * event B (a window that opened after the first tick leased, or a webhook tick
 * running one named event beside the cron), and both rewrite each algorithm's
 * league row. Every Phase A section therefore takes this one cross-invocation
 * lease first, and WAITS for it rather than skipping, so two invocations
 * interleave their Phase A sections through D1 exactly as events interleave
 * through the tick's state lock inside one invocation.
 *
 * The key lives in the same `event_lease` table. A `#` prefix can never collide
 * with a TBA event key, which always starts with a digit (the season).
 */
export const FOLD_LEASE_KEY = "#fold";

/** Phase A for one event takes seconds, so a holder that dies frees the fold section within a minute. */
export const FOLD_LEASE_TTL_MS = 60_000;

/** How long a tick waiting for the fold lease sleeps between attempts. */
export const FOLD_LEASE_POLL_MS = 250;

/**
 * Thrown when the fold lease was still held by another tick at the waiting
 * tick's deadline. The Phase A catch reverts the event's claim and counts the
 * event failed, and the next tick folds the same matches.
 */
export class FoldLeaseTimeoutError extends Error {
  constructor(eventKey: string) {
    super(`FoldLeaseTimeoutError: another tick still held the fold lease at this tick's deadline; ${eventKey} folds on the next tick`);
    this.name = "FoldLeaseTimeoutError";
  }
}

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

/**
 * Waits for the fold lease: ONE acquire statement per attempt (`run()`, not a
 * batch), `FOLD_LEASE_POLL_MS` apart, on the REAL clock because the loop sleeps.
 * Returns true once this tick holds it, and false when an attempt fails at or
 * after `deadlineMs`. `onAttempt` runs before every statement, so the caller can
 * count each one as a subrequest. THROWS if D1 throws: the caller fails open.
 */
export async function acquireFoldLease(db: D1Database, tickId: string, clock: () => number, deadlineMs: number, onAttempt: () => void = () => undefined): Promise<boolean> {
  for (;;) {
    const leasedAtMs = clock();
    onAttempt();
    const result = await db
      .prepare(EVENT_LEASE_ACQUIRE_SQL)
      .bind(FOLD_LEASE_KEY, tickId, new Date(leasedAtMs).toISOString(), new Date(leasedAtMs + FOLD_LEASE_TTL_MS).toISOString())
      .run();
    if (changesOf(result) > 0) return true;
    if (clock() >= deadlineMs) return false;
    await new Promise((resolve) => setTimeout(resolve, FOLD_LEASE_POLL_MS));
  }
}

/**
 * Releases the fold lease this tick holds, in one statement that deletes the
 * row only while this tick's id is on it. NEVER throws: a failure warns one JSON
 * line, and the lease expires on its own after `FOLD_LEASE_TTL_MS`.
 */
export async function releaseFoldLease(db: D1Database, tickId: string): Promise<void> {
  try {
    await db.prepare(EVENT_LEASE_RELEASE_KEY_SQL).bind(FOLD_LEASE_KEY, tickId).run();
  } catch (error) {
    console.warn(JSON.stringify({ msg: "fold-lease-release-failed", tickId, error: truncatedMessage(error) }));
  }
}
