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
  type ScopeSelection,
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
      // Each `(scope_kind = ? AND scope_key IN (?,?,...))` group in the SQL
      // text names its own placeholder count, in the SAME order the real
      // query binds its args — walking the SQL text (rather than assuming a
      // single fixed-shape group) is what lets this fake support plan
      // 04-08's multi-selection reads (e.g. OPR's event key + team keys in
      // ONE query) without hardcoding how many groups exist.
      const groupSizes = [...sql.matchAll(/\(scope_kind = \? AND scope_key IN \(([^)]*)\)\)/g)].map(
        (m) => m[1]!.split(",").filter((s) => s.length > 0).length
      );
      if (groupSizes.length === 0) {
        // league-only shape (zero scope keys across every selection)
        return [...this.algorithmState.values()].filter((row) => row.algorithm_id === algorithmId && row.scope_kind === "league");
      }
      let idx = 1;
      const matchers: { scopeKind: string; keySet: Set<string> }[] = [];
      for (const size of groupSizes) {
        const scopeKind = args[idx] as string;
        idx += 1;
        const keys = args.slice(idx, idx + size) as string[];
        idx += size;
        matchers.push({ scopeKind, keySet: new Set(keys) });
      }
      return [...this.algorithmState.values()].filter((row) => {
        if (row.algorithm_id !== algorithmId) return false;
        if (row.scope_kind === "league") return true;
        return matchers.some((m) => m.scopeKind === row.scope_kind && m.keySet.has(row.scope_key));
      });
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
    algorithmId: "vpr",
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
      db.algorithmState.set("vpr league league", {
        algorithm_id: "vpr",
        algorithm_version: "2.0.0+test",
        scope_kind: "league",
        scope_key: "league",
        state_json: "{}",
        generation: "gen-1",
        computed_at: "2026-08-22T00:00:00.000Z",
      });
      for (const key of keys.slice(0, 5)) {
        db.algorithmState.set(`vpr team ${key}`, {
          algorithm_id: "vpr",
          algorithm_version: "2.0.0+test",
          scope_kind: "team",
          scope_key: key,
          state_json: "{}",
          generation: "gen-1",
          computed_at: "2026-08-22T00:00:00.000Z",
        });
      }

      const rows = await readScopedState(db as unknown as D1Database, "vpr", [{ scopeKind: "team", scopeKeys: keys }]);

      expect(db.prepareCallCount).toBe(1);
      expect(db.allCallCount).toBe(1);
      // 5 team rows + 1 league row
      expect(rows).toHaveLength(6);
      expect(rows.some((r) => r.scopeKind === "league")).toBe(true);
    });

    it("returns an empty array (never throws) for an algorithm with no rows at all", async () => {
      const rows = await readScopedState(db as unknown as D1Database, "unseeded-algo", [{ scopeKind: "team", scopeKeys: ["frc254"] }]);
      expect(rows).toEqual([]);
    });

    it("throws a named error rather than issuing a second statement past MAX_SCOPE_KEYS_PER_READ", async () => {
      const tooMany = Array.from({ length: MAX_SCOPE_KEYS_PER_READ + 1 }, (_, i) => `frc${i}`);
      await expect(readScopedState(db as unknown as D1Database, "vpr", [{ scopeKind: "team", scopeKeys: tooMany }])).rejects.toThrow(
        /MAX_SCOPE_KEYS_PER_READ/
      );
      expect(db.prepareCallCount).toBe(0);
    });

    // Plan 04-08 (Task 2): an algorithm that stores more than one scope kind
    // (OPR: event + team, since lastEventByTeam moved out of the league row)
    // reads ALL of them in one statement/one subrequest.
    it("a read for an algorithm that stores two scope kinds issues exactly ONE prepare/all() call, and returns the event row, the requested team rows, and the league row", async () => {
      db.algorithmState.set("opr league league", {
        algorithm_id: "opr",
        algorithm_version: "3.0.0+baseline",
        scope_kind: "league",
        scope_key: "league",
        state_json: "{}",
        generation: "gen-1",
        computed_at: "2026-08-22T00:00:00.000Z",
      });
      db.algorithmState.set("opr event 2026casj", {
        algorithm_id: "opr",
        algorithm_version: "3.0.0+baseline",
        scope_kind: "event",
        scope_key: "2026casj",
        state_json: '{"observations":[]}',
        generation: "gen-1",
        computed_at: "2026-08-22T00:00:00.000Z",
      });
      for (const teamKey of ["frc1", "frc2"]) {
        db.algorithmState.set(`opr team ${teamKey}`, {
          algorithm_id: "opr",
          algorithm_version: "3.0.0+baseline",
          scope_kind: "team",
          scope_key: teamKey,
          state_json: '{"lastEventKey":"2026casj"}',
          generation: "gen-1",
          computed_at: "2026-08-22T00:00:00.000Z",
        });
      }
      // A team NOT requested this tick — must not appear in the result.
      db.algorithmState.set("opr team frc999", {
        algorithm_id: "opr",
        algorithm_version: "3.0.0+baseline",
        scope_kind: "team",
        scope_key: "frc999",
        state_json: '{"lastEventKey":"2026someothereven"}',
        generation: "gen-1",
        computed_at: "2026-08-22T00:00:00.000Z",
      });

      const selections: ScopeSelection[] = [
        { scopeKind: "event", scopeKeys: ["2026casj"] },
        { scopeKind: "team", scopeKeys: ["frc1", "frc2"] },
      ];
      const rows = await readScopedState(db as unknown as D1Database, "opr", selections);

      expect(db.prepareCallCount).toBe(1);
      expect(db.allCallCount).toBe(1);
      expect(rows).toHaveLength(4); // 1 league + 1 event + 2 requested team rows
      expect(rows.filter((r) => r.scopeKind === "league")).toHaveLength(1);
      expect(rows.filter((r) => r.scopeKind === "event").map((r) => r.scopeKey)).toEqual(["2026casj"]);
      expect(rows.filter((r) => r.scopeKind === "team").map((r) => r.scopeKey).sort()).toEqual(["frc1", "frc2"]);
      expect(rows.some((r) => r.scopeKey === "frc999")).toBe(false);
    });

    it("matches each selection's key list against its OWN scope kind — a team key is never satisfied by an event row sharing the same string, even when the fake's stored rows are arranged to tempt that", async () => {
      // Deliberately arrange a "team" row and an "event" row under the SAME
      // scope_key string ("2026casj") — a caller matching one combined key
      // list against a SET of scope kinds (the shortcut this task's action
      // text forbids) would incorrectly return BOTH for a selection naming
      // only "event".
      db.algorithmState.set("opr league league", {
        algorithm_id: "opr",
        algorithm_version: "3.0.0+baseline",
        scope_kind: "league",
        scope_key: "league",
        state_json: "{}",
        generation: "gen-1",
        computed_at: "2026-08-22T00:00:00.000Z",
      });
      db.algorithmState.set("opr event 2026casj", {
        algorithm_id: "opr",
        algorithm_version: "3.0.0+baseline",
        scope_kind: "event",
        scope_key: "2026casj",
        state_json: '{"observations":[]}',
        generation: "gen-1",
        computed_at: "2026-08-22T00:00:00.000Z",
      });
      db.algorithmState.set("opr team 2026casj", {
        algorithm_id: "opr",
        algorithm_version: "3.0.0+baseline",
        scope_kind: "team",
        scope_key: "2026casj", // same literal string as the event key above
        state_json: '{"lastEventKey":"2026elsewhere"}',
        generation: "gen-1",
        computed_at: "2026-08-22T00:00:00.000Z",
      });

      // Request ONLY the event scope for "2026casj" — no team selection at all.
      const rows = await readScopedState(db as unknown as D1Database, "opr", [{ scopeKind: "event", scopeKeys: ["2026casj"] }]);

      expect(rows.filter((r) => r.scopeKind === "event")).toHaveLength(1);
      expect(rows.filter((r) => r.scopeKind === "team")).toHaveLength(0); // must NOT be pulled in just because the key string matches
    });

    it("MAX_SCOPE_KEYS_PER_READ is enforced against the TOTAL key count across all requested scope kinds", async () => {
      const half = Math.ceil((MAX_SCOPE_KEYS_PER_READ + 1) / 2);
      const eventKeys = Array.from({ length: half }, (_, i) => `2026evt${i}`);
      const teamKeys = Array.from({ length: half }, (_, i) => `frc${i}`);
      const selections: ScopeSelection[] = [
        { scopeKind: "event", scopeKeys: eventKeys },
        { scopeKind: "team", scopeKeys: teamKeys },
      ];
      await expect(readScopedState(db as unknown as D1Database, "opr", selections)).rejects.toThrow(/MAX_SCOPE_KEYS_PER_READ/);
      expect(db.prepareCallCount).toBe(0);
    });

    it("an algorithm with no rows at all still returns an empty array (never throws) for a multi-selection request", async () => {
      const selections: ScopeSelection[] = [
        { scopeKind: "event", scopeKeys: ["2026casj"] },
        { scopeKind: "team", scopeKeys: ["frc1", "frc2"] },
      ];
      const rows = await readScopedState(db as unknown as D1Database, "unseeded-algo", selections);
      expect(rows).toEqual([]);
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
