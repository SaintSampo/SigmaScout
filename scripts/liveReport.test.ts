/**
 * `scripts/liveReport.ts`: the pure report core and the CLI's guarded paths
 * (quick task 261004-uyc). No wrangler, no filesystem: the CLI takes its effects
 * as an injected `CliIo`.
 */
import { describe, expect, it } from "vitest";
import { buildLiveReport, buildPruneCommand, buildSelectCommand, formatLiveReport, parseWranglerRows, runCli, type CliIo } from "./liveReport.js";
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

// ---------------------------------------------------------------------------
// The full report, over a 31 row fixture built from named numbers so every
// figure below can be checked by hand.
//
//   quals-in-progress, qm1..qm9: one `matches` observation per tick. qm1..qm8
//   published with post to published 66, 72, 78, 84, 90, 96, 102, 108 seconds;
//   qm9 folded but never published. A 2400 s silence between qm4 and qm5.
//   playoffs-in-progress, sf1..sf4: sf1..sf3 published at 50, 70, 120 seconds;
//   sf4 carries no post_result_time (actual_time 45 s before published).
//   The last `matches` observation says 14 played; 13 match rows exist.
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-10-03T20:00:00.000Z");
const at = (offsetSeconds: number): string => new Date(T0 + offsetSeconds * 1000).toISOString();
const epochSeconds = (offsetSeconds: number): number => (T0 + offsetSeconds * 1000) / 1000;

function fullFixture(): IngestLogRow[] {
  const out: IngestLogRow[] = [];
  const QUAL_TICKS = [600, 1200, 1800, 2400, 4800, 5400, 6000, 6600, 7200];
  const PLAYOFF_TICKS = [8100, 8700, 9300, 9900];
  // Lag, Last-Modified to observed, per `matches` observation; null means TBA sent no Last-Modified.
  const QUAL_LAG: (number | null)[] = [null, 4, 10, 4, 4, 4, 20, 4, 4];
  const PLAYOFF_LAG: number[] = [4, 6, 4, 4];
  const QUAL_LATENCY: (number | null)[] = [66, 72, 78, 84, 90, 96, 102, 108, null]; // qm9 is never published
  const PLAYOFF_LATENCY: (number | null)[] = [50, 70, 120, null]; // sf4 has no post_result_time

  out.push(row({ kind: "phase", subject: "quals-in-progress", phase: "quals-in-progress", observedAt: at(0), detail: '{"from":"no-schedule"}' }));

  QUAL_TICKS.forEach((tick, i) => {
    const latency = QUAL_LATENCY[i] ?? null;
    const lag = QUAL_LAG[i] ?? null;
    out.push(
      row({
        kind: "endpoint",
        subject: "matches",
        phase: "quals-in-progress",
        observedAt: at(tick),
        tbaLastModified: lag === null ? null : new Date(T0 + (tick - lag) * 1000).toUTCString(),
        detail: `{"played":${i + 1},"scheduled":0}`,
      })
    );
    out.push(
      row({
        kind: "match",
        subject: `2026vari_qm${i + 1}`,
        phase: "quals-in-progress",
        observedAt: at(tick),
        foldedAt: at(tick + 2),
        publishedAt: latency === null ? null : at(tick + 4),
        tbaPostResultTime: epochSeconds(tick + 4 - (latency ?? 100)),
        tbaActualTime: epochSeconds(tick - 100),
      })
    );
  });

  out.push(row({ kind: "endpoint", subject: "rankings", phase: "quals-in-progress", observedAt: at(3000), tbaLastModified: new Date(T0 + (3000 - 8) * 1000).toUTCString() }));
  out.push(row({ kind: "endpoint", subject: "rankings", phase: "quals-in-progress", observedAt: at(6000), tbaLastModified: new Date(T0 + (6000 - 12) * 1000).toUTCString() }));
  out.push(row({ kind: "failure", subject: "phase-b", phase: "quals-in-progress", observedAt: at(5400), detail: "boom" }));
  out.push(row({ kind: "phase", subject: "playoffs-in-progress", phase: "playoffs-in-progress", observedAt: at(7800), detail: '{"from":"alliances-posted"}' }));

  PLAYOFF_TICKS.forEach((tick, j) => {
    const lag = PLAYOFF_LAG[j]!;
    const latency = PLAYOFF_LATENCY[j] ?? null;
    out.push(
      row({
        kind: "endpoint",
        subject: "matches",
        phase: "playoffs-in-progress",
        observedAt: at(tick),
        tbaLastModified: new Date(T0 + (tick - lag) * 1000).toUTCString(),
        detail: `{"played":${j === 3 ? 14 : 10 + j},"scheduled":0}`,
      })
    );
    out.push(
      row({
        kind: "match",
        subject: `2026vari_sf${j + 1}`,
        phase: "playoffs-in-progress",
        observedAt: at(tick),
        foldedAt: at(tick + 2),
        publishedAt: at(tick + 4),
        tbaPostResultTime: latency === null ? null : epochSeconds(tick + 4 - latency),
        // Played 45 s before it was published when TBA gave no post time; otherwise 30 s before the post.
        tbaActualTime: epochSeconds(latency === null ? tick + 4 - 45 : tick + 4 - latency - 30),
      })
    );
  });

  return out.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
}

describe("buildLiveReport over the full fixture", () => {
  const report = buildLiveReport(fullFixture());

  it("has 31 timeline rows in time order", () => {
    expect(fullFixture()).toHaveLength(31);
    expect(report.timeline).toHaveLength(31);
    const times = report.timeline.map((entry) => Date.parse(entry.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("summarises post to published over matches with a post time: count, median and worst, overall and per phase", () => {
    // 50 66 70 72 78 84 90 96 102 108 120: eleven values, median is the sixth.
    expect(report.summary.overall).toEqual({ count: 11, medianSeconds: 84, worstSeconds: 120 });
    expect(report.summary.byPhase).toEqual([
      // Eight values 66..108 step 6: median is the mean of 84 and 90.
      { phase: "quals-in-progress", stats: { count: 8, medianSeconds: 87, worstSeconds: 108 } },
      { phase: "playoffs-in-progress", stats: { count: 3, medianSeconds: 70, worstSeconds: 120 } },
    ]);
    expect(report.summary.unparseable).toBe(0);
  });

  it("counts a match with no post_result_time apart, uses actual_time for played to published, and keeps it out of the median", () => {
    expect(report.summary.noPostTime.count).toBe(1);
    expect(report.summary.noPostTime.playedToPublished).toEqual({ count: 1, medianSeconds: 45, worstSeconds: 45 });
    expect(report.summary.overall.count).toBe(11);
    expect(report.matches.find((m) => m.matchKey === "2026vari_sf4")!.postToPublishedSeconds).toBeNull();
  });

  it("reports per endpoint the change count and the Last-Modified to observed lag, skipping rows with no Last-Modified", () => {
    // matches: 13 observations, 12 with a Last-Modified: nine 4s, one 6, one 10, one 20.
    expect(report.endpoints).toEqual([
      { endpoint: "matches", changes: 13, lag: { count: 12, medianSeconds: 4, worstSeconds: 20 } },
      { endpoint: "rankings", changes: 2, lag: { count: 2, medianSeconds: 10, worstSeconds: 12 } },
    ]);
  });

  it("lists a folded but unpublished match, the matches TBA showed played that were never folded, and the long silence", () => {
    expect(report.gaps.foldedButUnpublished).toEqual(["2026vari_qm9"]);
    // The last matches observation says 14 played and 13 distinct match rows exist.
    expect(report.gaps.neverFolded).toBe(1);
    // qm4 at 2400 to qm5 at 4800 is the only quiet stretch past 15 minutes: qm9 at
    // 7200 to sf1 at 8100 is exactly 900 s, which is not more than 15 minutes.
    expect(report.gaps.observationGaps).toEqual([{ fromAt: at(2400), toAt: at(4800), seconds: 2400, phase: "quals-in-progress" }]);
  });

  it("lists every failure row with its time, stage and message", () => {
    expect(report.failures).toEqual([{ at: at(5400), stage: "phase-b", message: "boom" }]);
  });

  it("lists the phase rows in order with the time spent in each, the last running to the final log row", () => {
    expect(report.phases).toEqual([
      { phase: "quals-in-progress", enteredAt: at(0), seconds: 7800 },
      { phase: "playoffs-in-progress", enteredAt: at(7800), seconds: 2100 },
    ]);
  });
});

describe("buildLiveReport edge rows", () => {
  it("counts a time that does not parse in unparseable and skips it from the statistic it would have fed", () => {
    const report = buildLiveReport([
      row({ tbaPostResultTime: epochSeconds(0), observedAt: at(10), foldedAt: at(12), publishedAt: "not a time" }),
      row({ subject: "2026vari_qm2", tbaPostResultTime: epochSeconds(0), observedAt: at(10), foldedAt: at(12), publishedAt: at(40) }),
    ]);
    expect(report.summary.unparseable).toBe(1);
    expect(report.summary.overall).toEqual({ count: 1, medianSeconds: 40, worstSeconds: 40 });
  });

  it("the median of an even count is the mean of the two middle values", () => {
    const report = buildLiveReport(
      [10, 20, 40, 100].map((latency, i) => row({ subject: `2026vari_qm${i + 1}`, tbaPostResultTime: epochSeconds(0), observedAt: at(5), foldedAt: at(6), publishedAt: at(latency) }))
    );
    expect(report.summary.overall).toEqual({ count: 4, medianSeconds: 30, worstSeconds: 100 });
  });
});

describe("formatLiveReport", () => {
  it("an empty row set prints one line saying no ingest log rows exist, and the CLI exits 0", () => {
    expect(formatLiveReport(buildLiveReport([]))).toBe("No ingest log rows exist for that event.");
    const { io, out } = fakeIo({ readFile: () => "[]" });
    expect(runCli(["2026vari", "--from-json", "rows.json"], io)).toBe(0);
    expect(out).toEqual(["No ingest log rows exist for that event."]);
  });

  it("prints the sections in fixed width columns with whole seconds", () => {
    const text = formatLiveReport(buildLiveReport(fullFixture()));
    expect(text).toContain("Timeline (UTC)");
    expect(text).toContain("Post to published (seconds)");
    expect(text).toContain("overall               n=11  median=84    worst=120");
    expect(text).toContain("quals-in-progress     n=8   median=87    worst=108");
    expect(text).toContain("folded but unpublished: 2026vari_qm9");
    expect(text).toContain("played on TBA but never folded: 1");
    expect(text).toContain("no matches observation for 2400 s (20:40:00 to 21:20:00, quals-in-progress)");
    expect(text).toContain("20:00:00  phase     quals-in-progress");
    expect(text).toContain("boom");
  });
});

describe("the CLI flags", () => {
  it("--json prints the report object instead of text", () => {
    const { io, out } = fakeIo({ readFile: () => JSON.stringify(fullFixture()) });
    expect(runCli(["2026vari", "--from-json", "rows.json", "--json"], io)).toBe(0);
    expect(JSON.parse(out.join("\n"))).toEqual(JSON.parse(JSON.stringify(buildLiveReport(fullFixture()))));
  });

  it("--prune-before issues the prune statement through wrangler with no env file flag, and prints the cutoff", () => {
    const { io, commands, out } = fakeIo();
    expect(runCli(["--prune-before", "2026-08-01"], io)).toBe(0);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBe(`npx wrangler d1 execute sigmascout-state --remote --command "DELETE FROM ingest_log WHERE observed_at < '2026-08-01'"`);
    expect(commands[0]).not.toContain("env-file");
    expect(out.join("\n")).toContain("2026-08-01");
  });

  it("--prune-before refuses a malformed or impossible date with exit code 1 and runs nothing", () => {
    for (const bad of ["2026-8-1", "2026-13-45", "yesterday", "2026-08-01'; DROP TABLE ingest_log; --"]) {
      const { io, commands, err } = fakeIo();
      expect(runCli(["--prune-before", bad], io)).toBe(1);
      expect(commands).toEqual([]);
      expect(err.join("\n")).toContain("not a YYYY-MM-DD date");
    }
    expect(() => buildPruneCommand("2026-02-30")).toThrow();
  });

  it("refuses an unknown flag with the usage line and exit code 1", () => {
    const { io, commands, err } = fakeIo();
    expect(runCli(["2026vari", "--nope"], io)).toBe(1);
    expect(commands).toEqual([]);
    expect(err.join("\n")).toContain("usage:");
  });

  it("refuses --prune-before combined with an event key", () => {
    const { io, commands } = fakeIo();
    expect(runCli(["2026vari", "--prune-before", "2026-08-01"], io)).toBe(1);
    expect(commands).toEqual([]);
  });
});
