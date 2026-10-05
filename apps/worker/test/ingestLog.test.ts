/**
 * The ingest log's buffer, its one INSERT, and its never throwing flush (quick
 * task 261004-uyc). The SQL half runs on a REAL SQLite engine (`better-sqlite3`,
 * D1's own engine) for the same reason `readScopedStateSql.test.ts` does: a bug
 * in the statement text (a json_each expansion, a JSON null that must stay SQL
 * NULL, a migration that must apply twice) is invisible to a JS fake.
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushIngestLog, IngestLogBuffer, INGEST_LOG_INSERT_SQL, matchArrivalFacts, type IngestLogRow } from "../src/ingestLog.js";
import type { D1Database } from "@cloudflare/workers-types";

afterEach(() => {
  vi.restoreAllMocks();
});

const TICK_AT = "2026-10-03T22:55:00.000Z";

/** A clock that returns each listed instant in turn, then holds the last. */
function steppedClock(isoTimes: readonly string[]): () => number {
  let i = 0;
  return () => Date.parse(isoTimes[Math.min(i++, isoTimes.length - 1)]!);
}

describe("IngestLogBuffer", () => {
  it("an empty buffer flushes nothing and reports 0 rows written, with no database call", async () => {
    const prepare = vi.fn();
    const written = await flushIngestLog({ prepare } as unknown as D1Database, new IngestLogBuffer(TICK_AT));
    expect(written).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("endpointChanged, matchesFolded and eventPublished yield one endpoint row and one row per match, in time order", () => {
    const buffer = new IngestLogBuffer(TICK_AT, steppedClock(["2026-10-03T22:55:01.000Z", "2026-10-03T22:55:02.000Z", "2026-10-03T22:55:03.000Z"]));
    buffer.endpointChanged("2026vari", "matches", { lastModified: "Sat, 03 Oct 2026 22:54:55 GMT", detail: { played: 2, scheduled: 0 } });
    buffer.matchesFolded("2026vari", [
      { matchKey: "2026vari_qm1", actualTime: 1000, postResultTime: 1010 },
      { matchKey: "2026vari_qm2", actualTime: 2000, postResultTime: null },
    ]);
    buffer.eventPublished("2026vari");

    const rows = buffer.rows();
    expect(rows).toHaveLength(3);
    const [endpoint, m1, m2] = rows as [IngestLogRow, IngestLogRow, IngestLogRow];
    expect(endpoint).toMatchObject({ kind: "endpoint", subject: "matches", tbaLastModified: "Sat, 03 Oct 2026 22:54:55 GMT", observedAt: "2026-10-03T22:55:01.000Z", publishedAt: "2026-10-03T22:55:03.000Z", detail: '{"played":2,"scheduled":0}' });
    expect(m1).toMatchObject({ kind: "match", subject: "2026vari_qm1", tbaActualTime: 1000, tbaPostResultTime: 1010, observedAt: endpoint.observedAt, foldedAt: "2026-10-03T22:55:02.000Z", publishedAt: "2026-10-03T22:55:03.000Z" });
    expect(m2).toMatchObject({ subject: "2026vari_qm2", tbaActualTime: 2000, tbaPostResultTime: null });
    for (const row of [m1, m2]) {
      expect(Date.parse(row.observedAt)).toBeLessThanOrEqual(Date.parse(row.foldedAt!));
      expect(Date.parse(row.foldedAt!)).toBeLessThanOrEqual(Date.parse(row.publishedAt!));
    }
  });

  it("eventPublished stamps only the named event, and only rows still lacking a published time", () => {
    const buffer = new IngestLogBuffer(TICK_AT, steppedClock(["2026-10-03T22:55:01.000Z", "2026-10-03T22:55:02.000Z", "2026-10-03T22:55:03.000Z", "2026-10-03T22:55:04.000Z"]));
    buffer.endpointChanged("2026vari", "matches");
    buffer.endpointChanged("2026casj", "matches");
    buffer.eventPublished("2026vari");
    buffer.eventPublished("2026vari");
    const byEvent = new Map(buffer.rows().map((row) => [row.eventKey, row]));
    expect(byEvent.get("2026vari")!.publishedAt).toBe("2026-10-03T22:55:03.000Z");
    expect(byEvent.get("2026casj")!.publishedAt).toBeNull();
  });

  it("endpointPublished stamps one named endpoint's row and leaves the matches row alone", () => {
    const buffer = new IngestLogBuffer(TICK_AT);
    buffer.endpointChanged("2026vari", "matches");
    buffer.endpointChanged("2026vari", "rankings");
    buffer.endpointPublished("2026vari", "rankings");
    const rows = buffer.rows();
    expect(rows.find((row) => row.subject === "rankings")!.publishedAt).not.toBeNull();
    expect(rows.find((row) => row.subject === "matches")!.publishedAt).toBeNull();
  });

  it("phaseChanged writes a phase row carrying the new phase and the previous one in detail; setPhase fills the phase column of that event's other rows", () => {
    const buffer = new IngestLogBuffer(TICK_AT);
    buffer.endpointChanged("2026vari", "matches");
    buffer.endpointChanged("2026casj", "matches");
    buffer.phaseChanged("2026vari", "quals-in-progress", "quals-complete");
    buffer.setPhase("2026vari", "quals-complete");
    const rows = buffer.rows();
    const phaseRow = rows.find((row) => row.kind === "phase")!;
    expect(phaseRow).toMatchObject({ subject: "quals-complete", phase: "quals-complete", detail: '{"from":"quals-in-progress"}' });
    expect(rows.find((row) => row.eventKey === "2026vari" && row.kind === "endpoint")!.phase).toBe("quals-complete");
    expect(rows.find((row) => row.eventKey === "2026casj")!.phase).toBeNull();
  });

  it("failure rows cut the error message to 300 characters", () => {
    const buffer = new IngestLogBuffer(TICK_AT);
    buffer.failure("2026vari", "phase-b", new Error("x".repeat(500)));
    const [row] = buffer.rows();
    expect(row).toMatchObject({ kind: "failure", subject: "phase-b" });
    expect(row!.detail).toHaveLength(300);
  });

  it("an event with no matches endpoint row this tick still folds: observed falls back to the folded time", () => {
    const buffer = new IngestLogBuffer(TICK_AT, steppedClock(["2026-10-03T22:55:05.000Z"]));
    buffer.matchesFolded("2026vari", [{ matchKey: "2026vari_qm1", actualTime: null, postResultTime: null }]);
    const [row] = buffer.rows();
    expect(row!.observedAt).toBe("2026-10-03T22:55:05.000Z");
    expect(row!.foldedAt).toBe(row!.observedAt);
  });
});

describe("matchArrivalFacts", () => {
  it("reads actual_time and post_result_time off unparsed objects, in list order, for the named keys only", () => {
    const facts = matchArrivalFacts(
      [
        { key: "a", actual_time: 10, post_result_time: 20 },
        { key: "b", actual_time: 11, post_result_time: 21 },
        { key: "c", actual_time: 12, post_result_time: 22 },
      ],
      new Set(["c", "a"])
    );
    expect(facts).toEqual([
      { matchKey: "a", actualTime: 10, postResultTime: 20 },
      { matchKey: "c", actualTime: 12, postResultTime: 22 },
    ]);
  });

  it("returns null for a missing or non numeric value", () => {
    const facts = matchArrivalFacts([{ key: "a", actual_time: "soon", post_result_time: undefined }, { key: "b", actual_time: null, post_result_time: Number.NaN }], new Set(["a", "b"]));
    expect(facts).toEqual([
      { matchKey: "a", actualTime: null, postResultTime: null },
      { matchKey: "b", actualTime: null, postResultTime: null },
    ]);
  });

  it("never throws on a malformed element", () => {
    expect(matchArrivalFacts([null, 7, "x", [], { key: 5 }, { key: "a" }], new Set(["a"]))).toEqual([{ matchKey: "a", actualTime: null, postResultTime: null }]);
  });
});

describe("flushIngestLog", () => {
  it("swallows a rejecting database, warns once with msg ingest-log-flush-failed, and resolves to 0", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = { prepare: () => ({ bind: () => ({ run: async () => Promise.reject(new Error("no such table: ingest_log")) }) }) } as unknown as D1Database;
    const buffer = new IngestLogBuffer(TICK_AT);
    buffer.endpointChanged("2026vari", "matches");

    await expect(flushIngestLog(db, buffer)).resolves.toBe(0);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ msg: "ingest-log-flush-failed", rows: 1, error: "no such table: ingest_log" });
  });

  it("writes every row in ONE statement bound to ONE parameter", async () => {
    const prepare = vi.fn();
    const bind = vi.fn();
    const run = vi.fn(async () => ({ success: true }));
    prepare.mockReturnValue({ bind });
    bind.mockReturnValue({ run });
    const buffer = new IngestLogBuffer(TICK_AT);
    for (let i = 0; i < 3; i++) buffer.endpointChanged("2026vari", "matches");

    await expect(flushIngestLog({ prepare } as unknown as D1Database, buffer)).resolves.toBe(3);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(INGEST_LOG_INSERT_SQL);
    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind.mock.calls[0]).toHaveLength(1);
    expect(JSON.parse(bind.mock.calls[0]![0] as string)).toHaveLength(3);
  });
});

describe("ingest_log on a real SQLite engine", () => {
  // The migration file as a git checkout on Windows wrote it (CRLF under autocrlf).
  const MIGRATION = readFileSync(resolve(import.meta.dirname, "../migrations/0003_ingest_log.sql"), "utf8").replace(/\r\n/g, "\n");

  it("the migration applies twice without error", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(MIGRATION);
    expect(() => sqlite.exec(MIGRATION)).not.toThrow();
    const names = (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ingest_log'`).all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["idx_ingest_log_event", "idx_ingest_log_observed"]));
    sqlite.close();
  });

  it("INGEST_LOG_INSERT_SQL bound to one JSON string inserts 150 rows in one statement, and a null stays SQL NULL", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(MIGRATION);
    const buffer = new IngestLogBuffer(TICK_AT);
    buffer.matchesFolded(
      "2026vari",
      Array.from({ length: 150 }, (_, i) => ({ matchKey: `2026vari_qm${i + 1}`, actualTime: i % 2 === 0 ? 1_000 + i : null, postResultTime: null }))
    );
    const rows = buffer.rows();

    const info = sqlite.prepare(INGEST_LOG_INSERT_SQL).run(JSON.stringify(rows));

    expect(info.changes).toBe(150);
    const stored = sqlite.prepare(`SELECT subject, tba_actual_time, tba_post_result_time, folded_at, published_at, phase FROM ingest_log ORDER BY id`).all() as Record<string, unknown>[];
    expect(stored).toHaveLength(150);
    expect(stored[0]).toMatchObject({ subject: "2026vari_qm1", tba_actual_time: 1000, tba_post_result_time: null, published_at: null, phase: null });
    expect(stored[1]!.tba_actual_time).toBeNull();
    expect(stored[149]!.subject).toBe("2026vari_qm150");
    expect(typeof stored[0]!.folded_at).toBe("string");
    sqlite.close();
  });
});
