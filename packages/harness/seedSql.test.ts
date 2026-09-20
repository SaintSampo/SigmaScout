/**
 * Quick task 260920-q75, Task 2: the offline seed's fourth file
 * (`emitCursorSeedSql`) and its companion `SEED-COMMANDS.txt` writer
 * (`writeSeedCommandsFile`).
 *
 * Primary assertions execute the generated SQL against a REAL in-memory
 * SQLite database created from `apps/worker/migrations/0001_algorithm_state.sql`
 * — the same real-engine pattern `apps/worker/test/readScopedStateSql.test.ts`
 * already established for this codebase, for the same reason: a hand-rolled
 * JS fake that reimplements the intended filtering logic cannot catch a
 * defect IN the generated SQL text itself. Only the reserved-key refusal (a
 * throw before any file is written) falls back to a string match, since
 * there is no SQL to run in that case.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitCursorSeedSql, emitSeedSql, ReservedEventCursorKeyError, writeSeedCommandsFile } from "./seedSql.js";
import type { StateRow } from "./stateSnapshot.js";

type SqliteDb = InstanceType<typeof Database>;

const MIGRATION_PATH = fileURLToPath(new URL("../../apps/worker/migrations/0001_algorithm_state.sql", import.meta.url));

const GENERATION = "e5cf1304";
const COMPUTED_AT = "2026-09-20T20:12:00.000Z";

interface EventCursorRow {
  event_key: string;
  tba_etag: string | null;
  last_folded_match_key: string | null;
  last_polled_at: string | null;
  last_advanced_at: string | null;
}

function allCursors(db: SqliteDb): EventCursorRow[] {
  return db.prepare("SELECT * FROM event_cursor ORDER BY event_key").all() as EventCursorRow[];
}

function cursorFor(db: SqliteDb, eventKey: string): EventCursorRow | undefined {
  return db.prepare("SELECT * FROM event_cursor WHERE event_key = ?").get(eventKey) as EventCursorRow | undefined;
}

function insertAlgorithmStateRow(db: SqliteDb, algorithmId: string, generation: string): void {
  db.prepare(
    `INSERT INTO algorithm_state (algorithm_id, algorithm_version, scope_kind, scope_key, state_json, generation, computed_at)
     VALUES (?, '1.0.0+test', 'league', 'league', '{}', ?, ?)
     ON CONFLICT(algorithm_id, scope_kind, scope_key) DO UPDATE SET generation = excluded.generation, computed_at = excluded.computed_at`
  ).run(algorithmId, generation, COMPUTED_AT);
}

describe("emitCursorSeedSql — against a real SQLite engine", () => {
  let dir: string;
  let sqlPath: string;
  let sqlite: SqliteDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-seedsql-"));
    sqlPath = join(dir, "seed-cursors.sql");
    sqlite = new Database(":memory:");
    sqlite.exec(readFileSync(MIGRATION_PATH, "utf8"));
  });

  afterEach(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function emitAndRun(options: {
    algorithmIds?: readonly string[];
    cursors?: readonly { eventKey: string; lastFoldedMatchKey: string | null }[];
    generation?: string;
  } = {}): void {
    emitCursorSeedSql({
      generation: options.generation ?? GENERATION,
      computedAt: COMPUTED_AT,
      algorithmIds: options.algorithmIds ?? ["opr", "epa", "spr"],
      cursors: options.cursors ?? [
        { eventKey: "2026casj", lastFoldedMatchKey: "2026casj_qm3" },
        { eventKey: "2026probe", lastFoldedMatchKey: null },
      ],
      out: sqlPath,
    });
    sqlite.exec(readFileSync(sqlPath, "utf8"));
  }

  it("emits exactly the supplied event keys, no more and no fewer, and never a reserved sentinel key", () => {
    emitAndRun();
    const rows = allCursors(sqlite);
    expect(rows.map((r) => r.event_key)).toEqual(["2026casj", "2026probe"]);
    expect(rows.some((r) => r.event_key === "__scheduler_meta__")).toBe(false);
  });

  it("a folded event gets last_folded_match_key equal to its LAST folded match; a zero-match probe window gets NULL", () => {
    emitAndRun();
    expect(cursorFor(sqlite, "2026casj")?.last_folded_match_key).toBe("2026casj_qm3");
    expect(cursorFor(sqlite, "2026probe")?.last_folded_match_key).toBeNull();
  });

  it("every emitted cursor row sets tba_etag to NULL, so the next tick re-polls TBA from scratch", () => {
    emitAndRun();
    for (const row of allCursors(sqlite)) {
      if (row.event_key.startsWith("__state_baseline__:")) continue;
      expect(row.tba_etag, row.event_key).toBeNull();
    }
  });

  it("applying the file twice is idempotent, and leaves an event_cursor row NOT named by this run untouched", () => {
    // A row this run's manifest does not name at all — e.g. an event closed
    // out of a prior season's live window.
    sqlite
      .prepare(`INSERT INTO event_cursor (event_key, tba_etag, last_folded_match_key, last_polled_at, last_advanced_at) VALUES ('2025oldevent', 'stale-etag', '2025oldevent_qm9', '2025-01-01', '2025-01-01')`)
      .run();

    emitAndRun();
    const firstPass = allCursors(sqlite);
    emitAndRun();
    const secondPass = allCursors(sqlite);

    expect(secondPass).toEqual(firstPass);
    expect(cursorFor(sqlite, "2025oldevent")).toEqual({
      event_key: "2025oldevent",
      tba_etag: "stale-etag",
      last_folded_match_key: "2025oldevent_qm9",
      last_polled_at: "2025-01-01",
      last_advanced_at: "2025-01-01",
    });
  });

  it("one baseline marker row per algorithm this run emitted state for, landing ONLY when that algorithm's own rows at this generation already exist", () => {
    // Only spr has state at GENERATION; opr has state at a DIFFERENT generation (a partial publish); epa has none.
    insertAlgorithmStateRow(sqlite, "spr", GENERATION);
    insertAlgorithmStateRow(sqlite, "opr", "some-older-generation");

    emitAndRun({ algorithmIds: ["opr", "epa", "spr"] });

    expect(cursorFor(sqlite, "__state_baseline__:spr")?.last_folded_match_key).toBe(GENERATION);
    expect(cursorFor(sqlite, "__state_baseline__:opr")).toBeUndefined();
    expect(cursorFor(sqlite, "__state_baseline__:epa")).toBeUndefined();
  });

  it("applying the cursors file before the state files leaves cursor rows present but marker rows absent; re-applying afterwards lands the markers", () => {
    // Pass 1: no algorithm_state at all yet (cursors file mistakenly applied first).
    emitAndRun({ algorithmIds: ["spr"] });
    expect(cursorFor(sqlite, "2026casj")).toBeDefined();
    expect(cursorFor(sqlite, "__state_baseline__:spr")).toBeUndefined();

    // The state seed lands.
    insertAlgorithmStateRow(sqlite, "spr", GENERATION);

    // Pass 2: re-applying the SAME cursors file now lands the marker.
    emitAndRun({ algorithmIds: ["spr"] });
    expect(cursorFor(sqlite, "__state_baseline__:spr")?.last_folded_match_key).toBe(GENERATION);
    // The ordinary cursor rows are unchanged by the second pass.
    expect(cursorFor(sqlite, "2026casj")?.last_folded_match_key).toBe("2026casj_qm3");
  });

  it("a marker row is re-guarded on every re-application: re-running after the state moves to a NEW generation without a matching insert leaves the OLD marker untouched", () => {
    insertAlgorithmStateRow(sqlite, "spr", GENERATION);
    emitAndRun({ algorithmIds: ["spr"] });
    expect(cursorFor(sqlite, "__state_baseline__:spr")?.last_folded_match_key).toBe(GENERATION);

    // A later run at a NEW generation, with no matching algorithm_state row present yet.
    const NEXT_GENERATION = "f0009999";
    emitAndRun({ algorithmIds: ["spr"], generation: NEXT_GENERATION });
    // The guard held: no state at NEXT_GENERATION exists, so the marker was not advanced.
    expect(cursorFor(sqlite, "__state_baseline__:spr")?.last_folded_match_key).toBe(GENERATION);
  });
});

describe("emitCursorSeedSql — reserved-key refusal (fallback: string match, no file is written)", () => {
  let dir: string;
  let sqlPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-seedsql-reserved-"));
    sqlPath = join(dir, "seed-cursors.sql");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws ReservedEventCursorKeyError naming the offending key when a cursor's eventKey is the tick-meta sentinel", () => {
    expect(() =>
      emitCursorSeedSql({
        generation: GENERATION,
        computedAt: COMPUTED_AT,
        algorithmIds: ["spr"],
        cursors: [{ eventKey: "__scheduler_meta__", lastFoldedMatchKey: null }],
        out: sqlPath,
      })
    ).toThrow(ReservedEventCursorKeyError);
    try {
      emitCursorSeedSql({ generation: GENERATION, computedAt: COMPUTED_AT, algorithmIds: ["spr"], cursors: [{ eventKey: "__scheduler_meta__", lastFoldedMatchKey: null }], out: sqlPath });
    } catch (err) {
      expect((err as Error).message).toContain("__scheduler_meta__");
    }
  });

  it("throws for a cursor's eventKey that collides with the state-baseline marker prefix", () => {
    expect(() =>
      emitCursorSeedSql({
        generation: GENERATION,
        computedAt: COMPUTED_AT,
        algorithmIds: ["spr"],
        cursors: [{ eventKey: "__state_baseline__:spr", lastFoldedMatchKey: null }],
        out: sqlPath,
      })
    ).toThrow(ReservedEventCursorKeyError);
  });
});

describe("emitSeedSql — the per-algorithm DELETE guard is unchanged and still scopes to its own algorithm", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-seedsql-emit-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("the leading DELETE names only this algorithm's id, never another one's", () => {
    const outPath = join(dir, "seed-spr.sql");
    const rows: StateRow[] = [{ algorithmId: "spr", algorithmVersion: "1.0.0+test", scopeKind: "league", scopeKey: "league", stateJson: "{}", generation: GENERATION, computedAt: COMPUTED_AT }];
    emitSeedSql(rows, { algorithmId: "spr", out: outPath });
    const text = readFileSync(outPath, "utf8");
    expect(text).toContain("DELETE FROM algorithm_state WHERE algorithm_id = 'spr';");
    expect(text).not.toContain("algorithm_id = 'opr'");
    expect(text).not.toContain("algorithm_id = 'epa'");
  });
});

describe("writeSeedCommandsFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-seedcommands-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes one wrangler invocation per seed file, in the supplied order, with the cursors file last", () => {
    const outPath = join(dir, "SEED-COMMANDS.txt");
    writeSeedCommandsFile({
      databaseName: "sigmascout-state",
      seedFiles: ["reports/publish/seed-opr.sql", "reports/publish/seed-epa.sql", "reports/publish/seed-spr.sql", "reports/publish/seed-cursors.sql"],
      out: outPath,
    });
    const text = readFileSync(outPath, "utf8");
    const commandLines = text.split("\n").filter((line) => line.startsWith("npx wrangler"));
    expect(commandLines).toHaveLength(4);
    expect(commandLines[3]).toContain("seed-cursors.sql");
    expect(commandLines[3]).toContain("sigmascout-state");
    for (const line of commandLines) {
      expect(line).toContain("--env-file .env");
      expect(line).not.toMatch(/--env-file \.env\s+\S+=/); // no inline secret value ever appears
    }
  });
});
