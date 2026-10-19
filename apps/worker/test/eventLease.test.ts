/**
 * The event lease (quick task 261019-oim): the acquire and release SQL on a REAL
 * SQLite engine (`better-sqlite3`, D1's own engine), the two functions over a
 * small better-sqlite3 backed D1 stand-in, and the parity of the fake every tick
 * test uses. A bug in the statement text (a conflict target, a WHERE that
 * compares the wrong way, a migration that must apply twice) is invisible to a
 * JS fake, which is why the SQL half runs on the engine.
 *
 * better-sqlite3 does not bind D1's numbered `?1` placeholders from a positional
 * argument list ("Too many parameter values were provided"), so this file binds
 * them as an object keyed by number. The SQL constants are left exactly as D1
 * takes them.
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import {
  acquireEventLeases,
  acquireFoldLease,
  EVENT_LEASE_ACQUIRE_SQL,
  EVENT_LEASE_RELEASE_KEY_SQL,
  EVENT_LEASE_RELEASE_SQL,
  EVENT_LEASE_TTL_MS,
  FOLD_LEASE_KEY,
  FOLD_LEASE_TTL_MS,
  releaseEventLeases,
  releaseFoldLease,
} from "../src/eventLease.js";
import { EventLeaseFakeStore, isEventLeaseSql } from "./support/eventLeaseFake.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// The migration file as a git checkout on Windows wrote it (CRLF under autocrlf).
const MIGRATION = readFileSync(resolve(import.meta.dirname, "../migrations/0004_event_lease.sql"), "utf8").replace(/\r\n/g, "\n");

const NOW_MS = Date.parse("2026-10-19T12:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

/** D1's `?1`, `?2` placeholders, bound the way better-sqlite3 accepts them. */
function numbered(args: readonly unknown[]): Record<number, unknown> {
  return Object.fromEntries(args.map((value, index) => [index + 1, value]));
}

function freshEngine(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(MIGRATION);
  return sqlite;
}

function runOn(sqlite: Database.Database, sql: string, args: readonly unknown[]): number {
  return sqlite.prepare(sql).run(numbered(args)).changes;
}

const acquire = (eventKey: string, tickId: string, leasedAtMs: number, expiresAtMs = leasedAtMs + EVENT_LEASE_TTL_MS): [string, unknown[]] => [
  EVENT_LEASE_ACQUIRE_SQL,
  [eventKey, tickId, iso(leasedAtMs), iso(expiresAtMs)],
];
const release = (tickId: string): [string, unknown[]] => [EVENT_LEASE_RELEASE_SQL, [tickId]];
const releaseKey = (eventKey: string, tickId: string): [string, unknown[]] => [EVENT_LEASE_RELEASE_KEY_SQL, [eventKey, tickId]];

/**
 * One sequence covering every case: an absent key, a foreign unexpired lease, an
 * expired one taken over, an expiry equal to the new leased_at, and a release
 * that must delete only its own tick's rows. Run on the engine and on the fake.
 */
const SCENARIO: readonly { readonly name: string; readonly statement: [string, unknown[]]; readonly changes: number }[] = [
  { name: "acquire an absent key", statement: acquire("2026aaaa", "tick-1", NOW_MS), changes: 1 },
  { name: "another tick, lease not expired", statement: acquire("2026aaaa", "tick-2", NOW_MS + 60_000), changes: 0 },
  { name: "another tick, lease expired: take over", statement: acquire("2026aaaa", "tick-3", NOW_MS + EVENT_LEASE_TTL_MS + 1), changes: 1 },
  { name: "a second key for tick-3", statement: acquire("2026bbbb", "tick-3", NOW_MS, NOW_MS + 1_000), changes: 1 },
  { name: "expires_at equals the new leased_at exactly: take over", statement: acquire("2026bbbb", "tick-4", NOW_MS + 1_000), changes: 1 },
  { name: "a third key for tick-3", statement: acquire("2026cccc", "tick-3", NOW_MS), changes: 1 },
  { name: "release a tick that holds nothing", statement: release("tick-1"), changes: 0 },
  { name: "release tick-3: its two rows only", statement: release("tick-3"), changes: 2 },
  { name: "release tick-4", statement: release("tick-4"), changes: 1 },
  { name: "the fold lease, absent", statement: acquire(FOLD_LEASE_KEY, "tick-5", NOW_MS, NOW_MS + FOLD_LEASE_TTL_MS), changes: 1 },
  { name: "release the fold lease by key with the wrong tick id", statement: releaseKey(FOLD_LEASE_KEY, "tick-6"), changes: 0 },
  { name: "release the fold lease by key with its own tick id", statement: releaseKey(FOLD_LEASE_KEY, "tick-5"), changes: 1 },
];

describe("event_lease on a real SQLite engine", () => {
  it("the migration applies twice without error", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(MIGRATION);
    expect(() => sqlite.exec(MIGRATION)).not.toThrow();
    const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_lease'`).all();
    expect(tables).toHaveLength(1);
    sqlite.close();
  });

  it("acquire reports 1 for an absent key, 0 against another tick's unexpired lease, 1 when it has expired (and the row now carries the new tick), and 1 when expires_at equals the new leased_at exactly", () => {
    const sqlite = freshEngine();
    const tickOf = (eventKey: string): unknown => (sqlite.prepare(`SELECT tick_id FROM event_lease WHERE event_key = ?`).get(eventKey) as { tick_id: string } | undefined)?.tick_id;

    expect(runOn(sqlite, ...acquire("2026aaaa", "tick-1", NOW_MS))).toBe(1);
    expect(tickOf("2026aaaa")).toBe("tick-1");
    expect(runOn(sqlite, ...acquire("2026aaaa", "tick-2", NOW_MS + 60_000))).toBe(0);
    expect(tickOf("2026aaaa")).toBe("tick-1");
    expect(runOn(sqlite, ...acquire("2026aaaa", "tick-3", NOW_MS + EVENT_LEASE_TTL_MS + 1))).toBe(1);
    expect(tickOf("2026aaaa")).toBe("tick-3");

    expect(runOn(sqlite, ...acquire("2026bbbb", "tick-1", NOW_MS, NOW_MS + 5_000))).toBe(1);
    expect(runOn(sqlite, ...acquire("2026bbbb", "tick-2", NOW_MS + 5_000))).toBe(1);
    expect(tickOf("2026bbbb")).toBe("tick-2");
    sqlite.close();
  });

  it("release deletes only the rows whose tick_id matches and reports how many", () => {
    const sqlite = freshEngine();
    runOn(sqlite, ...acquire("2026aaaa", "tick-1", NOW_MS));
    runOn(sqlite, ...acquire("2026bbbb", "tick-1", NOW_MS));
    runOn(sqlite, ...acquire("2026cccc", "tick-2", NOW_MS));

    expect(runOn(sqlite, ...release("tick-1"))).toBe(2);
    expect(sqlite.prepare(`SELECT event_key, tick_id FROM event_lease`).all()).toEqual([{ event_key: "2026cccc", tick_id: "tick-2" }]);
    expect(runOn(sqlite, ...release("tick-1"))).toBe(0);
    sqlite.close();
  });

  it("release by key deletes nothing for the wrong tick id and one row for the right one", () => {
    const sqlite = freshEngine();
    runOn(sqlite, ...acquire(FOLD_LEASE_KEY, "tick-1", NOW_MS, NOW_MS + FOLD_LEASE_TTL_MS));
    runOn(sqlite, ...acquire("2026aaaa", "tick-1", NOW_MS));

    expect(runOn(sqlite, ...releaseKey(FOLD_LEASE_KEY, "tick-2"))).toBe(0);
    expect(runOn(sqlite, ...releaseKey(FOLD_LEASE_KEY, "tick-1"))).toBe(1);
    expect(sqlite.prepare(`SELECT event_key FROM event_lease`).all()).toEqual([{ event_key: "2026aaaa" }]);
    sqlite.close();
  });

  it("the fake returns the same change counts as the engine over one scenario sequence", () => {
    const sqlite = freshEngine();
    const fake = new EventLeaseFakeStore();
    for (const step of SCENARIO) {
      const [sql, args] = step.statement;
      expect(isEventLeaseSql(sql), step.name).toBe(true);
      const engineChanges = runOn(sqlite, sql, args);
      const fakeChanges = fake.apply(sql, args);
      expect(engineChanges, `${step.name} (engine)`).toBe(step.changes);
      expect(fakeChanges, `${step.name} (fake)`).toBe(engineChanges);
    }
    expect(fake.rows.size).toBe((sqlite.prepare(`SELECT COUNT(*) AS n FROM event_lease`).get() as { n: number }).n);
    sqlite.close();
  });
});

/** A D1 stand-in over one better-sqlite3 database: `prepare().bind().run()` and `batch()`, nothing else. */
function sqliteD1(sqlite: Database.Database) {
  const batches: { sql: string; args: readonly unknown[] }[][] = [];
  const execute = (sql: string, args: readonly unknown[]) => ({ success: true, meta: { changes: runOn(sqlite, sql, args) } });
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({ sql, args, run: async () => execute(sql, args) }),
    }),
    batch: async (statements: readonly { sql: string; args: readonly unknown[] }[]) => {
      batches.push(statements.map((s) => ({ sql: s.sql, args: s.args })));
      return statements.map((s) => execute(s.sql, s.args));
    },
  };
  return { db: db as unknown as D1Database, batches };
}

describe("acquireEventLeases and releaseEventLeases", () => {
  it("acquire issues ONE batch over the sorted, de-duplicated keys and returns only the keys it now holds", async () => {
    const sqlite = freshEngine();
    runOn(sqlite, ...acquire("2026bbbb", "other-tick", NOW_MS - 30_000));
    const { db, batches } = sqliteD1(sqlite);

    const held = await acquireEventLeases(db, ["2026cccc", "2026aaaa", "2026bbbb", "2026aaaa"], "tick-1", NOW_MS);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((s) => s.args[0])).toEqual(["2026aaaa", "2026bbbb", "2026cccc"]);
    expect(batches[0]!.every((s) => s.sql === EVENT_LEASE_ACQUIRE_SQL)).toBe(true);
    expect(batches[0]![0]!.args).toEqual(["2026aaaa", "tick-1", iso(NOW_MS), iso(NOW_MS + EVENT_LEASE_TTL_MS)]);
    expect([...held].sort()).toEqual(["2026aaaa", "2026cccc"]);
    sqlite.close();
  });

  it("acquire with no keys returns an empty set and never touches D1", async () => {
    const batch = vi.fn();
    const prepare = vi.fn();
    const held = await acquireEventLeases({ batch, prepare } as unknown as D1Database, [], "tick-1", NOW_MS);
    expect(held.size).toBe(0);
    expect(batch).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("acquire rejects when the batch rejects", async () => {
    const sqlite = freshEngine();
    const { db } = sqliteD1(sqlite);
    (db as unknown as { batch: unknown }).batch = async () => {
      throw new Error("D1_ERROR: no such table: event_lease");
    };
    await expect(acquireEventLeases(db, ["2026aaaa"], "tick-1", NOW_MS)).rejects.toThrow("no such table");
    sqlite.close();
  });

  it("release deletes the tick's rows through one statement", async () => {
    const sqlite = freshEngine();
    const { db } = sqliteD1(sqlite);
    await acquireEventLeases(db, ["2026aaaa", "2026bbbb"], "tick-1", NOW_MS);
    await releaseEventLeases(db, "tick-1");
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM event_lease`).get() as { n: number }).n).toBe(0);
    sqlite.close();
  });

  it("release resolves, never rejects, when the statement throws, and warns exactly one event-lease-release-failed line carrying the tick id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            throw new Error("D1_ERROR: network " + "x".repeat(1_000));
          },
        }),
      }),
    } as unknown as D1Database;

    await expect(releaseEventLeases(db, "tick-9")).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(warn.mock.calls[0]![0])) as { msg: string; tickId: string; error: string };
    expect(line.msg).toBe("event-lease-release-failed");
    expect(line.tickId).toBe("tick-9");
    expect(line.error.length).toBeLessThanOrEqual(300);
  });
});

describe("acquireFoldLease and releaseFoldLease", () => {
  it("takes a free fold lease on the first attempt, with one statement and a 60 s expiry on the clock it was given", async () => {
    const sqlite = freshEngine();
    const { db } = sqliteD1(sqlite);
    let attempts = 0;

    const held = await acquireFoldLease(db, "tick-1", () => NOW_MS, NOW_MS + 1_000, () => attempts++);

    expect(held).toBe(true);
    expect(attempts).toBe(1);
    expect(sqlite.prepare(`SELECT tick_id, leased_at, expires_at FROM event_lease WHERE event_key = ?`).get(FOLD_LEASE_KEY)).toEqual({
      tick_id: "tick-1",
      leased_at: iso(NOW_MS),
      expires_at: iso(NOW_MS + FOLD_LEASE_TTL_MS),
    });
    await releaseFoldLease(db, "tick-1");
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM event_lease`).get() as { n: number }).n).toBe(0);
    sqlite.close();
  });

  it("waits while another tick holds it and returns false once an attempt fails at the deadline", async () => {
    const sqlite = freshEngine();
    runOn(sqlite, ...acquire(FOLD_LEASE_KEY, "other-tick", Date.now(), Date.now() + 3_600_000));
    const { db } = sqliteD1(sqlite);
    let attempts = 0;
    const started = Date.now();

    const held = await acquireFoldLease(db, "tick-1", Date.now, started + 300, () => attempts++);

    expect(held).toBe(false);
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect((sqlite.prepare(`SELECT tick_id FROM event_lease WHERE event_key = ?`).get(FOLD_LEASE_KEY) as { tick_id: string }).tick_id).toBe("other-tick");
    sqlite.close();
  });

  it("acquire rejects when D1 throws; release never does and warns one fold-lease-release-failed line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            throw new Error("D1_ERROR: no such table: event_lease");
          },
        }),
      }),
    } as unknown as D1Database;

    await expect(acquireFoldLease(db, "tick-1", () => NOW_MS, NOW_MS)).rejects.toThrow("no such table");
    await expect(releaseFoldLease(db, "tick-1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ msg: "fold-lease-release-failed", tickId: "tick-1" });
  });
});
