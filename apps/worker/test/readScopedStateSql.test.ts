/**
 * Quick task 260822-wqt: a regression test against a REAL SQLite engine
 * (`better-sqlite3`, D1's own underlying engine — the same dependency
 * `packages/corpus/db.ts` already uses), not the hand-rolled JS fakes the
 * rest of this directory uses for `readScopedState`. This is deliberate: the
 * bug this test pins is a SQL operator-precedence defect in the query TEXT
 * itself (`AND` binds tighter than `OR` — `algorithm_id = ? AND (groups) OR
 * scope_kind = 'league'` scopes only the LEFT side of the `OR` to
 * `algorithm_id`, leaking every OTHER algorithm's league row into every
 * read). The existing `stateStore.test.ts` fakes reimplement `readScopedState`'s
 * INTENDED filtering logic directly in JS (`row.algorithm_id === algorithmId
 * && ...`), which is semantically correct on its own terms and therefore
 * cannot regress this specific defect — a fake that never runs the real SQL
 * text can't catch a bug IN the SQL text. Only a real SQL engine, given the
 * real query string, can.
 *
 * Reproduced live (quick task 260822-wqt, Task 2's own deployment
 * verification): with `opr`/`epa` seeded and `vpr` cold-started (no
 * league row of its own yet), the deployed Worker deterministically
 * deserialized OPR's league row as vpr's own, throwing `TypeError:
 * state.componentOrder is not iterable` in `predict()` on every tick.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readScopedState } from "../src/stateStore.js";
import type { D1Database } from "@cloudflare/workers-types";

type SqliteDb = InstanceType<typeof Database>;

const ALGORITHM_STATE_SCHEMA = `
CREATE TABLE algorithm_state (
  algorithm_id      TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  scope_kind        TEXT NOT NULL,
  scope_key         TEXT NOT NULL,
  state_json        TEXT NOT NULL,
  generation        TEXT NOT NULL,
  computed_at       TEXT NOT NULL,
  PRIMARY KEY (algorithm_id, scope_kind, scope_key)
);
CREATE INDEX idx_algorithm_state_scope ON algorithm_state(algorithm_id, scope_kind);
`;

/** A minimal D1Database-shaped adapter over a real (in-memory) SQLite connection — enough of the surface `readScopedState` calls (`prepare().bind().all()`), backed by the ACTUAL query planner rather than a JS reimplementation. */
function d1FromSqlite(db: SqliteDb): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            all: async <T = unknown>() => ({ results: stmt.all(...args) as T[] }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

function insertRow(db: SqliteDb, row: { algorithmId: string; algorithmVersion: string; scopeKind: string; scopeKey: string; stateJson: string }): void {
  db.prepare(
    `INSERT INTO algorithm_state (algorithm_id, algorithm_version, scope_kind, scope_key, state_json, generation, computed_at)
     VALUES (?, ?, ?, ?, ?, 'gen-1', '2026-08-22T00:00:00.000Z')`
  ).run(row.algorithmId, row.algorithmVersion, row.scopeKind, row.scopeKey, row.stateJson);
}

describe("readScopedState — real SQL engine (regression: algorithm_id must scope the league-row fallback too)", () => {
  let sqlite: SqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(ALGORITHM_STATE_SCHEMA);
    db = d1FromSqlite(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("an algorithm with NO league row of its own returns NO league-scoped row, even when OTHER algorithms' league rows exist and were inserted first", async () => {
    // Insertion order deliberately puts opr/epa BEFORE vpr — a plain table
    // scan (what SQLite falls back to for the unindexable `OR scope_kind =
    // 'league'` branch the pre-fix SQL produced) visits rows in roughly this
    // order, which is exactly the shape that silently "worked" whenever the
    // querying algorithm's OWN row happened to come first, and silently
    // broke the moment it did not — reproduced here on purpose.
    insertRow(sqlite, { algorithmId: "opr", algorithmVersion: "3.0.0+baseline", scopeKind: "league", scopeKey: "league", stateJson: '{"snapshotShapeVersion":2,"opr":true}' });
    insertRow(sqlite, { algorithmId: "epa", algorithmVersion: "1.0.0+baseline", scopeKind: "league", scopeKey: "league", stateJson: '{"snapshotShapeVersion":2,"epa":true}' });
    // vpr has team rows (from a prior season) but genuinely NO league row
    // of its own yet — the exact cold-start shape the live rig hit.
    insertRow(sqlite, { algorithmId: "vpr", algorithmVersion: "2.0.0+test", scopeKind: "team", scopeKey: "frc254", stateJson: '{"matchCount":3}' });

    const rows = await readScopedState(db, "vpr", [{ scopeKind: "team", scopeKeys: ["frc254"] }]);

    expect(rows.some((r) => r.scopeKind === "league")).toBe(false);
    expect(rows.map((r) => r.scopeKey)).toEqual(["frc254"]);
  });

  it("an algorithm WITH its own league row gets exactly that row back — never a different algorithm's, even when the other algorithm's row was inserted first", async () => {
    insertRow(sqlite, { algorithmId: "opr", algorithmVersion: "3.0.0+baseline", scopeKind: "league", scopeKey: "league", stateJson: '{"snapshotShapeVersion":2,"opr":true}' });
    insertRow(sqlite, { algorithmId: "vpr", algorithmVersion: "2.0.0+test", scopeKind: "league", scopeKey: "league", stateJson: '{"snapshotShapeVersion":2,"vpr":true}' });

    const rows = await readScopedState(db, "vpr", [{ scopeKind: "team", scopeKeys: ["frc254"] }]);

    const leagueRows = rows.filter((r) => r.scopeKind === "league");
    expect(leagueRows).toHaveLength(1);
    expect(leagueRows[0]!.algorithmVersion).toBe("2.0.0+test");
    expect(JSON.parse(leagueRows[0]!.stateJson)).toMatchObject({ vpr: true });
  });

  it("a multi-selection read (OPR-shaped: event + team) still scopes the league fallback to algorithmId, never another algorithm's row", async () => {
    insertRow(sqlite, { algorithmId: "epa", algorithmVersion: "1.0.0+baseline", scopeKind: "league", scopeKey: "league", stateJson: '{"epa":true}' });
    insertRow(sqlite, { algorithmId: "opr", algorithmVersion: "3.0.0+baseline", scopeKind: "event", scopeKey: "2026casj", stateJson: '{"observations":[]}' });

    const rows = await readScopedState(db, "opr", [
      { scopeKind: "event", scopeKeys: ["2026casj"] },
      { scopeKind: "team", scopeKeys: ["frc254"] },
    ]);

    expect(rows.some((r) => r.scopeKind === "league")).toBe(false);
    expect(rows.map((r) => r.scopeKind).sort()).toEqual(["event"]);
  });
});
