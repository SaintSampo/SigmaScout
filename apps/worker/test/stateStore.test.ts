/**
 * Call-count and SQL-shape assertions against a small hand-rolled fake D1
 * (not Miniflare) — the properties under test are "how many D1 calls did
 * this issue" and "is a rejection all-or-nothing," both of which a fake
 * makes assertable in milliseconds. The real thing is exercised end to end
 * in plan 04-07.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  hasAlreadyFolded,
  MAX_SCOPE_KEYS_PER_READ,
  readEventCursor,
  readScopedState,
  selectChangedRows,
  writeEventCursor,
  writeScopedState,
  type EventCursor,
  type StateRow,
} from "../src/stateStore.js";

// ---------------------------------------------------------------------------
// A minimal fake D1Database: enough of the real surface (prepare/bind/all/
// first/run/batch) for stateStore.ts's call shapes, with call counters and
// an in-memory table so round-trip/dedup behaviour is genuinely assertable.
// ---------------------------------------------------------------------------

interface FakeAlgorithmStateRow {
  algorithm_id: string;
  algorithm_version: string;
  scope_kind: string;
  scope_key: string;
  state_json: string;
  generation: string;
  computed_at: string;
}

interface FakeEventCursorRow {
  event_key: string;
  tba_etag: string | null;
  last_folded_match_key: string | null;
  last_polled_at: string | null;
  last_advanced_at: string | null;
}

class FakePreparedStatement {
  readonly sql: string;
  boundArgs: readonly unknown[] = [];

  constructor(
    sql: string,
    private readonly db: FakeD1Database
  ) {
    this.sql = sql;
  }

  bind(...args: unknown[]): FakePreparedStatement {
    const bound = new FakePreparedStatement(this.sql, this.db);
    bound.boundArgs = args;
    return bound;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    this.db.allCallCount++;
    return { results: this.db.executeSelect(this.sql, this.boundArgs) as T[] };
  }

  async first<T = unknown>(): Promise<T | null> {
    this.db.firstCallCount++;
    const results = this.db.executeSelect(this.sql, this.boundArgs) as T[];
    return results.length > 0 ? results[0]! : null;
  }

  async run(): Promise<{ success: true }> {
    this.db.runCallCount++;
    this.db.executeWrite(this.sql, this.boundArgs);
    return { success: true };
  }
}

class FakeD1Database {
  prepareCallCount = 0;
  allCallCount = 0;
  firstCallCount = 0;
  runCallCount = 0;
  batchCallCount = 0;

  algorithmState = new Map<string, FakeAlgorithmStateRow>();
  eventCursors = new Map<string, FakeEventCursorRow>();

  /** When set, the NEXT `batch()` call rejects with this error instead of applying anything. */
  rejectNextBatchWith: Error | null = null;

  prepare(sql: string): FakePreparedStatement {
    this.prepareCallCount++;
    return new FakePreparedStatement(sql, this);
  }

  async batch(statements: readonly FakePreparedStatement[]): Promise<{ success: true }[]> {
    this.batchCallCount++;
    if (this.rejectNextBatchWith) {
      const err = this.rejectNextBatchWith;
      this.rejectNextBatchWith = null;
      throw err;
    }
    // Real D1 batches are transactions: stage writes, then commit all at
    // once. Since this fake only rejects BEFORE applying anything (above),
    // plain sequential application here already matches "all or nothing."
    for (const stmt of statements) this.executeWrite(stmt.sql, stmt.boundArgs);
    return statements.map(() => ({ success: true as const }));
  }

  executeSelect(sql: string, args: readonly unknown[]): unknown[] {
    if (sql.includes("FROM algorithm_state")) {
      const algorithmId = args[0] as string;
      if (sql.includes("scope_key IN")) {
        const scopeKind = args[1] as string;
        const scopeKeys = args.slice(2) as string[];
        const keySet = new Set(scopeKeys);
        return [...this.algorithmState.values()].filter(
          (row) =>
            row.algorithm_id === algorithmId &&
            ((row.scope_kind === scopeKind && keySet.has(row.scope_key)) || row.scope_kind === "league")
        );
      }
      // league-only shape (zero scope keys)
      return [...this.algorithmState.values()].filter((row) => row.algorithm_id === algorithmId && row.scope_kind === "league");
    }
    if (sql.includes("FROM event_cursor")) {
      const eventKey = args[0] as string;
      const row = this.eventCursors.get(eventKey);
      return row ? [row] : [];
    }
    throw new Error(`FakeD1Database.executeSelect: unrecognized SQL: ${sql}`);
  }

  executeWrite(sql: string, args: readonly unknown[]): void {
    if (sql.includes("INSERT INTO algorithm_state")) {
      const [algorithmId, algorithmVersion, scopeKind, scopeKey, stateJson, generation, computedAt] = args as string[];
      this.algorithmState.set(`${algorithmId} ${scopeKind} ${scopeKey}`, {
        algorithm_id: algorithmId!,
        algorithm_version: algorithmVersion!,
        scope_kind: scopeKind!,
        scope_key: scopeKey!,
        state_json: stateJson!,
        generation: generation!,
        computed_at: computedAt!,
      });
      return;
    }
    if (sql.includes("INSERT INTO event_cursor")) {
      const [eventKey, tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt] = args as (string | null)[];
      this.eventCursors.set(eventKey!, {
        event_key: eventKey!,
        tba_etag: tbaEtag ?? null,
        last_folded_match_key: lastFoldedMatchKey ?? null,
        last_polled_at: lastPolledAt ?? null,
        last_advanced_at: lastAdvancedAt ?? null,
      });
      return;
    }
    throw new Error(`FakeD1Database.executeWrite: unrecognized SQL: ${sql}`);
  }
}

function makeRow(overrides: Partial<StateRow> = {}): StateRow {
  return {
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+test",
    scopeKind: "team",
    scopeKey: "frc254",
    stateJson: '{"matchCount":1}',
    generation: "gen-1",
    computedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("stateStore", () => {
  let db: FakeD1Database;

  beforeEach(() => {
    db = new FakeD1Database();
  });

  describe("readScopedState", () => {
    it("issues exactly one D1 statement regardless of key count (21 keys)", async () => {
      const keys = Array.from({ length: 21 }, (_, i) => `frc${i}`);
      db.algorithmState.set("sigma1 league league", {
        algorithm_id: "sigma1",
        algorithm_version: "2.0.0+test",
        scope_kind: "league",
        scope_key: "league",
        state_json: "{}",
        generation: "gen-1",
        computed_at: "2026-08-22T00:00:00.000Z",
      });
      for (const key of keys.slice(0, 5)) {
        db.algorithmState.set(`sigma1 team ${key}`, {
          algorithm_id: "sigma1",
          algorithm_version: "2.0.0+test",
          scope_kind: "team",
          scope_key: key,
          state_json: "{}",
          generation: "gen-1",
          computed_at: "2026-08-22T00:00:00.000Z",
        });
      }

      const rows = await readScopedState(db as unknown as D1Database, "sigma1", "team", keys);

      expect(db.prepareCallCount).toBe(1);
      expect(db.allCallCount).toBe(1);
      // 5 team rows + 1 league row
      expect(rows).toHaveLength(6);
      expect(rows.some((r) => r.scopeKind === "league")).toBe(true);
    });

    it("returns an empty array (never throws) for an algorithm with no rows at all", async () => {
      const rows = await readScopedState(db as unknown as D1Database, "unseeded-algo", "team", ["frc254"]);
      expect(rows).toEqual([]);
    });

    it("throws a named error rather than issuing a second statement past MAX_SCOPE_KEYS_PER_READ", async () => {
      const tooMany = Array.from({ length: MAX_SCOPE_KEYS_PER_READ + 1 }, (_, i) => `frc${i}`);
      await expect(readScopedState(db as unknown as D1Database, "sigma1", "team", tooMany)).rejects.toThrow(/MAX_SCOPE_KEYS_PER_READ/);
      expect(db.prepareCallCount).toBe(0);
    });
  });

  describe("writeScopedState", () => {
    it("issues exactly one batch() call regardless of row count (21 rows)", async () => {
      const rows = Array.from({ length: 21 }, (_, i) => makeRow({ scopeKey: `frc${i}` }));
      await writeScopedState(db as unknown as D1Database, rows);
      expect(db.batchCallCount).toBe(1);
      expect(db.algorithmState.size).toBe(21);
    });

    it("performs zero calls on an empty row array", async () => {
      await writeScopedState(db as unknown as D1Database, []);
      expect(db.batchCallCount).toBe(0);
      expect(db.prepareCallCount).toBe(0);
    });

    it("surfaces a rejecting batch as a rejection with no rows recorded as applied", async () => {
      const rows = [makeRow({ scopeKey: "frc254" }), makeRow({ scopeKey: "frc111" })];
      db.rejectNextBatchWith = new Error("simulated D1 batch failure");

      await expect(writeScopedState(db as unknown as D1Database, rows)).rejects.toThrow("simulated D1 batch failure");
      expect(db.algorithmState.size).toBe(0);
    });
  });

  describe("selectChangedRows", () => {
    it("excludes rows whose stateJson is unchanged from the prior read", () => {
      const prior = [makeRow({ scopeKey: "frc254", stateJson: "A" }), makeRow({ scopeKey: "frc111", stateJson: "B" })];
      const candidate = [
        makeRow({ scopeKey: "frc254", stateJson: "A" }), // unchanged
        makeRow({ scopeKey: "frc111", stateJson: "B-changed" }), // changed
        makeRow({ scopeKey: "frc971", stateJson: "C" }), // new
      ];

      const changed = selectChangedRows(prior, candidate);

      expect(changed.map((r) => r.scopeKey).sort()).toEqual(["frc111", "frc971"]);
    });

    it("advancing an event twice with the same match list produces byte-identical state_json and issues zero writes the second pass", async () => {
      const firstPassRows = [makeRow({ scopeKey: "frc254", stateJson: "AFTER_MATCH_1" })];
      const priorEmpty: StateRow[] = [];
      const firstChanged = selectChangedRows(priorEmpty, firstPassRows);
      await writeScopedState(db as unknown as D1Database, firstChanged);
      expect(db.batchCallCount).toBe(1);

      // Second pass: re-computing the SAME match produces byte-identical
      // state_json (stateSnapshot.ts's stable serializer) -- selectChangedRows
      // against the now-current prior rows drops it, and writeScopedState
      // issues zero further batch calls.
      const secondPassRows = [makeRow({ scopeKey: "frc254", stateJson: "AFTER_MATCH_1" })];
      const secondChanged = selectChangedRows(firstPassRows, secondPassRows);
      await writeScopedState(db as unknown as D1Database, secondChanged);

      expect(secondChanged).toEqual([]);
      expect(db.batchCallCount).toBe(1); // unchanged from after the first pass
    });
  });

  describe("readEventCursor / writeEventCursor", () => {
    it("round-trips tba_etag, last_folded_match_key, last_polled_at and last_advanced_at", async () => {
      const cursor: EventCursor = {
        eventKey: "2026casj",
        tbaEtag: '"abc123"',
        lastFoldedMatchKey: "2026casj_qm5",
        lastPolledAt: "2026-08-22T00:00:00.000Z",
        lastAdvancedAt: "2026-08-22T00:00:01.000Z",
      };

      await writeEventCursor(db as unknown as D1Database, cursor);
      const readBack = await readEventCursor(db as unknown as D1Database, "2026casj");

      expect(readBack).toEqual(cursor);
    });

    it("returns undefined for an event with no cursor row yet", async () => {
      const readBack = await readEventCursor(db as unknown as D1Database, "2026nonexistent");
      expect(readBack).toBeUndefined();
    });
  });

  describe("hasAlreadyFolded", () => {
    const orderedMatchKeys = ["qm1", "qm2", "qm3", "qm4", "qm5"];

    it("returns true when matchKey is at or before the cursor's last-folded match in event order", () => {
      const cursor: Pick<EventCursor, "lastFoldedMatchKey"> = { lastFoldedMatchKey: "qm3" };
      expect(hasAlreadyFolded(cursor, "qm1", orderedMatchKeys)).toBe(true);
      expect(hasAlreadyFolded(cursor, "qm3", orderedMatchKeys)).toBe(true);
      expect(hasAlreadyFolded(cursor, "qm4", orderedMatchKeys)).toBe(false);
    });

    it("returns false for every match when nothing has been folded yet", () => {
      const cursor: Pick<EventCursor, "lastFoldedMatchKey"> = { lastFoldedMatchKey: null };
      expect(hasAlreadyFolded(cursor, "qm1", orderedMatchKeys)).toBe(false);
      expect(hasAlreadyFolded(cursor, "qm5", orderedMatchKeys)).toBe(false);
    });

    it("throws for a matchKey absent from the event's own ordered match list", () => {
      const cursor: Pick<EventCursor, "lastFoldedMatchKey"> = { lastFoldedMatchKey: "qm1" };
      expect(() => hasAlreadyFolded(cursor, "qm99", orderedMatchKeys)).toThrow(/not present/);
    });
  });
});
