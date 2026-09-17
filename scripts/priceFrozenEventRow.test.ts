/**
 * Offline tests for the frozen-row pricing instrument (260917-1zs). The CLI's
 * corpus/publisher half is not exercised here; every pure function under it is.
 *
 * The load-bearing test in this file is the LAST one: it asserts that the
 * proposed per-event shape reproduces the SHIPPED `preMatchMetrics`'s answer
 * for every played row, by calling the real resolver rather than restating its
 * rule. That is the property the whole design rests on — if an event file plus
 * an entry snapshot cannot reproduce it, the shape silently inverts cause and
 * effect on the match page.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roundMetric } from "../packages/harness/rounding.js";
import { SIGMA_METRIC_KEY } from "../packages/harness/sigmaScore.js";
import { preMatchMetrics } from "../apps/web/src/lib/preMatchMetrics.js";
import type { TeamSeasonArtifact } from "../packages/harness/pageArtifacts.js";
import {
  applyEncodeOptions,
  attachVariant,
  buildRobotIndexBody,
  decodePositionalEntry,
  decodePositionalRecord,
  deriveEventEntrySnapshots,
  deriveFrozenMetricKeys,
  encodePositionalEntry,
  encodePositionalRecord,
  encodeVariantA,
  encodeVariantB,
  encodeVariantC,
  extrapolateStorage,
  frozenCellKey,
  meanAndSd,
  parsesAsEventArtifact,
  percentileOfSorted,
  pricedVariants,
  preMatchFromFrozenEvent,
  rawBytes,
  sizeOf,
  type FrozenEventInput,
  type FrozenMetricsRecord,
  type TeamHistoryRow,
} from "./priceFrozenEventRow.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const RED = ["frc254", "frc1678", "frc971"];
const BLUE = ["frc2481", "frc1323", "frc604"];
const ROSTER = [...RED, ...BLUE];

/** A record shaped exactly like a published SPR history row: value + spread + percentile per metric, plus `sigma` as `{ value }` only. */
function record(seed: number): FrozenMetricsRecord {
  return {
    total: { value: roundMetric(20 + seed / 7), spread: roundMetric(12 + seed / 11), percentile: 50.5 + seed },
    phaseAuto: { value: roundMetric(3 + seed / 13), spread: roundMetric(5 + seed / 17), percentile: 10.2 + seed },
    [SIGMA_METRIC_KEY]: { value: roundMetric(16 + seed / 19) },
  };
}

/** Two played matches for the same six teams, so every team has a first and a last row at the event. */
function input(matchCount = 2): FrozenEventInput {
  const matchKeys = Array.from({ length: matchCount }, (_, i) => `2026casj_qm${i + 1}`);
  const cells = new Map<string, FrozenMetricsRecord>();
  matchKeys.forEach((matchKey, matchIndex) => {
    ROSTER.forEach((teamKey, teamIndex) => {
      cells.set(frozenCellKey(matchKey, teamKey), record(matchIndex * 10 + teamIndex));
    });
  });
  return {
    matchKeys,
    rosterByMatch: new Map(matchKeys.map((matchKey) => [matchKey, ROSTER])),
    cells,
    teamKeys: ROSTER,
    entryByTeam: new Map([["frc254", record(99)]]),
  };
}

const EVERY = { sigma: true, percentile: "every" } as const;

describe("encoder A — one object per played row, keyed by team key", () => {
  it("emits one entry per team on each played row, with the values it was given", () => {
    const encoded = encodeVariantA(input(), EVERY);
    expect(encoded.perMatch).toHaveLength(2);
    expect(Object.keys(encoded.perMatch[0]!)).toEqual(ROSTER);
    // The instrument never rounds: it carries the publisher's already-rounded
    // values through unchanged, so a rounded input survives bit-for-bit.
    expect(encoded.perMatch[0]!.frc254).toEqual(record(0));
    expect(encoded.perMatch[1]!.frc604).toEqual(record(15));
  });

  it("carries a `sigma` entry as `{ value }` only — no spread, no percentile", () => {
    const encoded = encodeVariantA(input(), EVERY);
    expect(encoded.perMatch[0]!.frc254![SIGMA_METRIC_KEY]).toEqual({ value: roundMetric(16) });
    expect(Object.keys(encoded.perMatch[0]!.frc254![SIGMA_METRIC_KEY]!)).toEqual(["value"]);
  });

  it("drops `sigma` entirely when the variant says so, and nothing else", () => {
    const withSigma = encodeVariantA(input(), EVERY).perMatch[0]!.frc254!;
    const without = encodeVariantA(input(), { sigma: false, percentile: "every" }).perMatch[0]!.frc254!;
    expect(Object.keys(withSigma)).toContain(SIGMA_METRIC_KEY);
    expect(Object.keys(without)).not.toContain(SIGMA_METRIC_KEY);
    expect(Object.keys(without)).toEqual(Object.keys(withSigma).filter((k) => k !== SIGMA_METRIC_KEY));
  });

  it("still parses as an EventArtifact when attached to a real artifact clone", () => {
    const body = attachVariant(artifactFixture(), input(), { name: "A", layout: "A", options: EVERY });
    expect(parsesAsEventArtifact(body)).toBe(true);
  });
});

describe("encoder B — the same information, laid out per team", () => {
  it("emits one timeline entry per (team, played match) and reproduces A's values exactly", () => {
    const a = encodeVariantA(input(3), EVERY);
    const b = encodeVariantB(input(3), EVERY);
    expect(b.timelines).toHaveLength(ROSTER.length);
    for (const timeline of b.timelines) expect(timeline).toHaveLength(3);
    ROSTER.forEach((teamKey, teamIndex) => {
      const timeline = b.timelines[teamIndex]!;
      timeline.forEach((entry, matchIndex) => {
        expect(entry.matchKey).toBe(a.perMatch[matchIndex] !== undefined ? `2026casj_qm${matchIndex + 1}` : "");
        expect(entry.metrics).toEqual(a.perMatch[matchIndex]![teamKey]);
      });
    });
  });
});

describe("encoder C — positional, with a metricKeys header", () => {
  it("decodes back to encoder A's record for the same input", () => {
    const a = encodeVariantA(input(2), EVERY);
    const c = encodeVariantC(input(2), EVERY);
    ROSTER.forEach((teamKey, teamIndex) => {
      const timeline = c.timelines[teamIndex]!;
      timeline.m.forEach((matchKey, matchIndex) => {
        const decoded = decodePositionalRecord(timeline.v[matchIndex]!, c.metricKeys);
        expect(decoded).toEqual(a.perMatch[matchIndex]![teamKey]);
        expect(matchKey).toBe(`2026casj_qm${matchIndex + 1}`);
      });
    });
  });

  it("round-trips every slot shape, keeping a real 0 spread distinct from an absent one", () => {
    const shapes: FrozenMetricsRecord[] = [
      { m: { value: 1 } },
      { m: { value: 1, spread: 0 } },
      { m: { value: 1, spread: 2 } },
      { m: { value: 1, percentile: 50 } },
      { m: { value: 1, spread: 0, percentile: 50 } },
    ];
    for (const shape of shapes) expect(decodePositionalRecord(encodePositionalRecord(shape, ["m"]), ["m"])).toEqual(shape);
    // An absent spread encodes as `null`; a real 0 encodes as `0`. Never the same JSON value.
    expect(encodePositionalEntry({ value: 1, percentile: 50 })).toEqual([1, null, 50]);
    expect(encodePositionalEntry({ value: 1, spread: 0, percentile: 50 })).toEqual([1, 0, 50]);
    expect(decodePositionalEntry(null)).toBeUndefined();
  });

  it("omits a key whose slot is absent rather than writing an undefined value", () => {
    const decoded = decodePositionalRecord([null, [3]], ["gone", "kept"]);
    expect(Object.keys(decoded)).toEqual(["kept"]);
  });

  it("derives the metric-key order first-seen, not sorted", () => {
    expect(deriveFrozenMetricKeys([{ z: { value: 1 } }, { a: { value: 2 }, z: { value: 3 } }])).toEqual(["z", "a"]);
  });
});

describe("variant D — percentile on a team's last row at the event only", () => {
  it("omits percentile on every row but the last, and that last one equals A's", () => {
    const a = encodeVariantA(input(3), EVERY);
    const d = encodeVariantA(input(3), { sigma: true, percentile: "last" });
    ROSTER.forEach((teamKey) => {
      expect(d.perMatch[0]![teamKey]!.total!.percentile).toBeUndefined();
      expect(d.perMatch[1]![teamKey]!.total!.percentile).toBeUndefined();
      expect(d.perMatch[2]![teamKey]!.total!.percentile).toBe(a.perMatch[2]![teamKey]!.total!.percentile);
    });
  });

  it("leaves the entry snapshot's percentile intact — an arrival record is not a per-match row", () => {
    const d = encodeVariantA(input(3), { sigma: true, percentile: "last" });
    expect(d.entry[0]!.total!.percentile).toBe(record(99).total!.percentile);
  });

  it("`applyEncodeOptions` never mutates its input", () => {
    const source = record(1);
    const copy = structuredClone(source);
    applyEncodeOptions(source, { sigma: false, percentile: "last" }, false);
    expect(source).toEqual(copy);
  });
});

describe("the narrower frozen sets", () => {
  it("`metricKeys` restricts which keys travel and `spread: false` drops every spread", () => {
    const narrowed = applyEncodeOptions(record(1), { sigma: true, percentile: "every", metricKeys: ["total", SIGMA_METRIC_KEY], spread: false }, true);
    expect(Object.keys(narrowed)).toEqual(["total", SIGMA_METRIC_KEY]);
    expect(narrowed.total!.spread).toBeUndefined();
    expect(narrowed.total!.percentile).toBe(record(1).total!.percentile);
  });

  it("`rows: \"last\"` keeps only each team's end-of-event row", () => {
    const encoded = encodeVariantB(input(4), { sigma: true, percentile: "last", rows: "last" });
    for (const timeline of encoded.timelines) {
      expect(timeline).toHaveLength(1);
      expect(timeline[0]!.matchKey).toBe("2026casj_qm4");
    }
  });

  it("prices every bar variant plus the narrower sets, each under a distinct name", () => {
    const names = pricedVariants().map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    for (const required of ["A", "B", "C", "D-A", "D-B", "D-C", "A/no-sigma", "N0-no-spread", "N1-total+sigma", "N2-end-of-event"]) {
      expect(names).toContain(required);
    }
  });
});

describe("sizeOf and the index builder", () => {
  it("reports raw UTF-8 bytes and brotli bytes at a stated quality for the same body", () => {
    const body = JSON.stringify({ a: "x".repeat(5000) });
    const measured = sizeOf(body, 5);
    expect(measured.raw).toBe(Buffer.byteLength(body, "utf8"));
    expect(measured.raw).toBe(rawBytes(body));
    expect(measured.brotli).toBeLessThan(measured.raw);
    // Deterministic for the same (body, quality) pair, so two figures in the
    // report are comparable. Deliberately NOT asserting that a higher quality
    // is always smaller: on a degenerate, highly repetitive body q11 measured
    // 28 B against q5's 25 B, and a monotonicity claim here would be false.
    expect(sizeOf(body, 5)).toEqual(measured);
    expect(sizeOf(body, 11).brotli).toBeLessThan(measured.raw);
  });

  it("counts UTF-8 bytes, not code units", () => {
    expect(rawBytes('{"n":"é"}')).toBe(10);
  });

  it("drops metricHistory and every event's matches, and keeps everything the audit dispositioned INDEX", () => {
    const index = JSON.parse(
      buildRobotIndexBody({
        teamKey: "frc254",
        teamNumber: 254,
        nickname: "The Cheesy Poofs",
        season: 2026,
        seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: {}, metricsBasis: "last-official-match" },
        events: [{ eventKey: "2026casj", eventName: "San Jose", startDate: "2026-03-01", rank: 1, totalTeams: 40, matches: [{ matchKey: "x" }] }],
        metricHistory: [{ matchKey: "x" }],
        robotImageUrl: "https://example.test/a.jpg",
        activeYears: [2025, 2026],
        ranks: [{ scope: "world", rank: 1, total: 100 }],
      })
    ) as Record<string, any>;
    expect(index.metricHistory).toBeUndefined();
    expect(index.events[0].matches).toBeUndefined();
    expect(index.events[0]).toEqual({ eventKey: "2026casj", eventName: "San Jose", startDate: "2026-03-01", rank: 1, totalTeams: 40 });
    for (const key of ["teamKey", "teamNumber", "nickname", "season", "seasonStats", "robotImageUrl", "activeYears", "ranks"]) {
      expect(index[key], key).toBeDefined();
    }
    expect(index.seasonStats.metricsBasis).toBe("last-official-match");
  });
});

describe("statistics and the storage extrapolation", () => {
  it("computes the same percentile rule the publish budget uses", () => {
    expect(percentileOfSorted([1, 2, 3, 4], 50)).toBe(2);
    expect(percentileOfSorted([1, 2, 3, 4], 95)).toBe(4);
    expect(percentileOfSorted([], 95)).toBe(0);
  });

  it("reports mean and standard deviation", () => {
    expect(meanAndSd([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ mean: 5, sd: 2 });
  });

  it("echoes its inputs and nets the freed bytes against the split estimate", () => {
    const out = extrapolateStorage({
      earlyRows: 100,
      lateRows: 200,
      earlyRate: 10,
      lateRate: 20,
      algorithmCount: 3,
      teamObjects: 1000,
      freedPerTeamObject: 50,
    });
    expect(out.inputs.earlyRate).toBe(10);
    expect(out.addedBytesLow).toBe(300 * 10 * 3);
    expect(out.addedBytesHigh).toBe(300 * 20 * 3);
    expect(out.addedBytesSplit).toBe((100 * 10 + 200 * 20) * 3);
    expect(out.freedBytes).toBe(50_000);
    expect(out.netFreedBytes).toBe(50_000 - out.addedBytesSplit);
  });
});

describe("the entry snapshot, and the property the whole design rests on", () => {
  const history: TeamHistoryRow[] = [
    { matchKey: "2026casj_qm1", eventKey: "2026casj", metrics: record(1) },
    { matchKey: "2026casj_qm2", eventKey: "2026casj", metrics: record(2) },
    { matchKey: "2026cc_qm1", eventKey: "2026cc", metrics: record(3) },
    { matchKey: "2026cc_qm2", eventKey: "2026cc", metrics: record(4) },
    { matchKey: "2026arc_qm1", eventKey: "2026arc", metrics: record(5) },
  ];

  it("gives a team's FIRST event no entry snapshot, so an honest absence stays absent", () => {
    expect(deriveEventEntrySnapshots(history).has("2026casj")).toBe(false);
  });

  it("sets each later event's entry snapshot to the last row of the previous event", () => {
    const entries = deriveEventEntrySnapshots(history);
    expect(entries.get("2026cc")).toEqual(record(2));
    expect(entries.get("2026arc")).toEqual(record(4));
  });

  it("reproduces the SHIPPED preMatchMetrics for every played row, from one event file plus its entry snapshot", () => {
    const entries = deriveEventEntrySnapshots(history);
    // The shipped resolver needs full `MetricHistoryRow`s; the pricing only
    // needs three fields, so the rest are filled in here rather than modelled.
    const shippedHistory = history.map((row, index) => ({
      matchKey: row.matchKey,
      season: 2026,
      eventKey: row.eventKey,
      algorithmId: "spr",
      teamKey: "frc254",
      matchIndex: index,
      metrics: row.metrics,
    })) as unknown as TeamSeasonArtifact["metricHistory"];

    for (const row of history) {
      const eventRows = history.filter((r) => r.eventKey === row.eventKey);
      const fromFrozen = preMatchFromFrozenEvent(eventRows, entries.get(row.eventKey), row.matchKey);
      const fromShipped = preMatchMetrics(shippedHistory, row.matchKey, { played: true })?.metrics;
      expect(fromFrozen, row.matchKey).toEqual(fromShipped);
    }
  });

  it("returns undefined for a match key this team never played", () => {
    expect(preMatchFromFrozenEvent(history, undefined, "2026casj_qm99")).toBeUndefined();
  });
});

describe("static scan: the pricing instrument can never reach the network or a secret", () => {
  it("imports no R2 client, no S3 or signing SDK, and never fetches or reads an environment variable", () => {
    const source = readFileSync(resolve(HERE, "priceFrozenEventRow.ts"), "utf8");
    const specifiers = [...source.matchAll(/(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(specifiers.length).toBeGreaterThan(5);
    expect(specifiers.filter((s) => /r2Client|@aws-sdk|aws4fetch|aws-sdk|signature|sigv4|wrangler/i.test(s))).toEqual([]);
    // Positive control: the same regex catches a synthetic forbidden import.
    const control = [...`import { putObject } from "../packages/harness/r2Client.js";`.matchAll(/(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)].map(
      (m) => m[1]!
    );
    expect(control.filter((s) => /r2Client/.test(s))).toHaveLength(1);
    // No fetch, and no environment read at all — so it needs no `.env` and no
    // secret can reach a log line. `process.argv`/`process.stdout` are fine.
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/process\.env/);
    // The documented USAGE lines must never teach anyone to hand this script a
    // secrets file. The header's prose rule ("must never be invoked through
    // `--env-file`") is deliberately not what this matches.
    expect(source).not.toMatch(/tsx[^\n]*--env-file/);
    // The run is always a dry run, and never writes the budget doc or the seed SQL.
    expect(source).toMatch(/dryRun:\s*true/);
    expect(source).toMatch(/skipState:\s*true/);
    // No `--write-budget` as an actual argument or option (the header's prose
    // rule that it is never passed is deliberately not what this matches), so
    // `docs/publish-budget.md`'s machine block can never be rewritten.
    expect(source).not.toMatch(/["']--write-budget["']/);
    expect(source).not.toMatch(/writeBudget\s*[:=]/);
  });
});

/** A minimal but schema-valid event artifact, used to prove an augmented body still parses. */
function artifactFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generation: "test-generation",
    computedAt: "2026-09-17T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "4.0.0+baseline",
    eventKey: "2026casj",
    season: 2026,
    matches: [
      {
        matchKey: "2026casj_qm1",
        compLevel: "qm",
        setNumber: 1,
        matchNumber: 1,
        redTeams: RED,
        blueTeams: BLUE,
        predictedWinner: "red",
        pRedWin: 0.6,
        predictedRedScore: 100,
        predictedBlueScore: 90,
        actualWinner: "red",
        actualRedScore: 101,
        actualBlueScore: 88,
      },
      {
        matchKey: "2026casj_qm2",
        compLevel: "qm",
        setNumber: 1,
        matchNumber: 2,
        redTeams: RED,
        blueTeams: BLUE,
        predictedWinner: "blue",
        pRedWin: 0.4,
        predictedRedScore: 90,
        predictedBlueScore: 100,
        actualWinner: "blue",
        actualRedScore: 88,
        actualBlueScore: 101,
      },
    ],
    upcoming: [],
    teams: ROSTER.map((teamKey) => ({ teamKey, metrics: {} })),
  };
}
