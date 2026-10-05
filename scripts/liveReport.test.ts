/**
 * `scripts/liveReport.ts`: the pure report core and the CLI's guarded paths
 * (quick task 261004-uyc). No wrangler, no filesystem: the CLI takes its effects
 * as an injected `CliIo`.
 */
import { describe, expect, it } from "vitest";
import { buildLiveReport, buildSelectCommand, formatLiveReport, parseWranglerRows, runCli, type CliIo } from "./liveReport.js";
import type { IngestLogRow } from "../apps/worker/src/ingestLog.js";

function row(over: Partial<IngestLogRow>): IngestLogRow {
  return {
    eventKey: "2026vari",
    tickAt: "2026-10-03T22:55:00.000Z",
    kind: "match",
    subject: "2026vari_qm1",
    phase: null,
    tbaLastModified: null,
    tbaActualTime: null,
    tbaPostResultTime: null,
    observedAt: "2026-10-03T22:55:00.000Z",
    foldedAt: null,
    publishedAt: null,
    detail: null,
    ...over,
  };
}

/** TBA posted at 22:53:51; seen 22:55:00 (69 s later); folded 22:55:02; published 22:55:04. */
const POST_SECONDS = Date.parse("2026-10-03T22:53:51.000Z") / 1000;
const TRACER_ROWS: IngestLogRow[] = [
  row({ kind: "endpoint", subject: "matches", tbaLastModified: "Sat, 03 Oct 2026 22:53:55 GMT", observedAt: "2026-10-03T22:55:00.000Z", publishedAt: "2026-10-03T22:55:04.000Z", detail: '{"played":1,"scheduled":0}' }),
  row({ kind: "match", subject: "2026vari_qm1", tbaActualTime: POST_SECONDS - 150, tbaPostResultTime: POST_SECONDS, observedAt: "2026-10-03T22:55:00.000Z", foldedAt: "2026-10-03T22:55:02.000Z", publishedAt: "2026-10-03T22:55:04.000Z" }),
];

function fakeIo(over: Partial<CliIo> & { execStdout?: string } = {}): { io: CliIo; out: string[]; err: string[]; commands: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const commands: string[] = [];
  const io: CliIo = {
    exec: (command) => {
      commands.push(command);
      return { status: 0, stdout: over.execStdout ?? "" };
    },
    readFile: () => "[]",
    log: (line) => out.push(line),
    error: (line) => err.push(line),
    ...(over.exec ? { exec: over.exec } : {}),
    ...(over.readFile ? { readFile: over.readFile } : {}),
  };
  return { io, out, err, commands };
}

describe("buildLiveReport", () => {
  it("yields one match entry whose postToPublishedSeconds is published minus post_result_time", () => {
    const report = buildLiveReport(TRACER_ROWS);
    expect(report.matches).toEqual([
      { matchKey: "2026vari_qm1", postToSeenSeconds: 69, seenToFoldedSeconds: 2, foldedToPublishedSeconds: 2, postToPublishedSeconds: 73 },
    ]);
    expect(report.timeline.map((entry) => entry.kind)).toEqual(["endpoint", "match"]);
  });

  it("an interval is null when one of its inputs is null", () => {
    const report = buildLiveReport([row({ tbaPostResultTime: null, foldedAt: "2026-10-03T22:55:02.000Z", publishedAt: null })]);
    expect(report.matches[0]).toEqual({ matchKey: "2026vari_qm1", postToSeenSeconds: null, seenToFoldedSeconds: 2, foldedToPublishedSeconds: null, postToPublishedSeconds: null });
  });
});

describe("parseWranglerRows", () => {
  it("slices from the first bracket past banner text and maps snake_case result rows", () => {
    const stdout = ` ⛅️ wrangler 4.0\n[{"results":[{"event_key":"2026vari","tick_at":"t","kind":"match","subject":"2026vari_qm1","phase":null,"tba_last_modified":null,"tba_actual_time":5,"tba_post_result_time":6,"observed_at":"2026-10-03T22:55:00.000Z","folded_at":null,"published_at":null,"detail":null}],"success":true}]`;
    expect(parseWranglerRows(stdout)).toEqual([row({ tickAt: "t", tbaActualTime: 5, tbaPostResultTime: 6 })]);
  });

  it("accepts a bare array of camelCase rows", () => {
    expect(parseWranglerRows(JSON.stringify(TRACER_ROWS))).toEqual(TRACER_ROWS);
  });

  it("throws when there is no JSON array at all", () => {
    expect(() => parseWranglerRows("nothing here")).toThrow();
  });
});

describe("the CLI", () => {
  it("refuses an event key that fails EVENT_KEY_PATTERN before it reaches any command, with exit code 1", () => {
    const { io, commands, err } = fakeIo();
    expect(runCli(["2026vari'; DROP TABLE ingest_log; --"], io)).toBe(1);
    expect(commands).toEqual([]);
    expect(err.join("\n")).toContain("not an event key");
    expect(() => buildSelectCommand("x; y")).toThrow();
  });

  it("reads D1 through wrangler with no env file flag, and prints the report", () => {
    const { io, commands, out } = fakeIo({ execStdout: JSON.stringify([{ results: TRACER_ROWS }]) });
    expect(runCli(["2026vari"], io)).toBe(0);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("FROM ingest_log WHERE event_key = '2026vari'");
    expect(commands[0]).not.toContain("env-file");
    expect(out.join("\n")).toContain("2026vari_qm1");
  });

  it("reads rows from a JSON file with --from-json and runs no command", () => {
    const { io, commands, out } = fakeIo({ readFile: () => JSON.stringify(TRACER_ROWS) });
    expect(runCli(["2026vari", "--from-json", "rows.json"], io)).toBe(0);
    expect(commands).toEqual([]);
    expect(formatLiveReport(buildLiveReport(TRACER_ROWS))).toBe(out.join("\n"));
  });
});
