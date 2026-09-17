/**
 * The live metric sidecar's own unit tests (quick task 260917-jr4, Task 1).
 *
 * These pin the merge's four behaviours and the encoding's round trip. What
 * they deliberately do NOT cover is the Worker's use of them — that the tick
 * issues zero team-artifact reads/writes and exactly one sidecar write per
 * algorithm lives in `apps/worker/test/scheduled.sidecar.test.ts`, against the
 * real `runTick`.
 */
import { describe, expect, it } from "vitest";
import {
  LIVE_METRIC_SIDECAR_BYTE_CEILING,
  LIVE_METRIC_SIDECAR_VERSION,
  LiveMetricSidecarSchema,
  LiveMetricSidecarVersionError,
  liveMetricSidecarKey,
  mergeLiveMetricSidecar,
  sidecarRowsForTeam,
  type LiveMetricSidecar,
  type LiveMetricSidecarTickRow,
} from "./liveMetricSidecar.js";
import { SIGMA_METRIC_KEY } from "./sigmaScore.js";

const EVENT_KEY = "2026casj";
const SEASON = 2026;
const ALGORITHM_ID = "spr";
const ALGORITHM_VERSION = "4.0.0+baseline";
const KEYS = ["total", "auto", SIGMA_METRIC_KEY];
const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];

function tickRow(matchKey: string, teams: readonly string[], base: number): LiveMetricSidecarTickRow {
  return {
    matchKey,
    teamKeys: teams,
    valuesByTeam: new Map(teams.map((teamKey, i) => [teamKey, { total: base + i, auto: base / 2 + i, [SIGMA_METRIC_KEY]: base / 10 + i }])),
  };
}

function merge(existing: LiveMetricSidecar | undefined, rows: readonly LiveMetricSidecarTickRow[], overrides: { metricKeys?: readonly string[]; complete?: boolean } = {}) {
  return mergeLiveMetricSidecar({
    existing,
    eventKey: EVENT_KEY,
    season: SEASON,
    algorithmId: ALGORITHM_ID,
    algorithmVersion: ALGORITHM_VERSION,
    computedAt: "2026-03-07T18:00:00.000Z",
    complete: overrides.complete ?? false,
    metricKeys: overrides.metricKeys ?? KEYS,
    rows,
  });
}

describe("liveMetricSidecarKey — the one spelling", () => {
  it("builds the v1/live/ key, a sibling of v1/event/ and v1/presim/ and never a page kind", () => {
    expect(liveMetricSidecarKey({ eventKey: EVENT_KEY, algorithmId: ALGORITHM_ID, version: ALGORITHM_VERSION })).toBe("v1/live/2026casj/spr@4.0.0+baseline.json");
  });

  it("refuses a version with no + separator rather than writing a half-formed key", () => {
    expect(() => liveMetricSidecarKey({ eventKey: EVENT_KEY, algorithmId: ALGORITHM_ID, version: "4.0.0" })).toThrow(LiveMetricSidecarVersionError);
  });

  it("the byte ceiling is a real number well above a 241-match event's ~80 KB, not a token", () => {
    expect(LIVE_METRIC_SIDECAR_BYTE_CEILING).toBeGreaterThan(80_000);
  });
});

describe("mergeLiveMetricSidecar — append, replace, drift", () => {
  it("appends this tick's match after the stored ones, in fold order, one row per match", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", RED, 10)]).sidecar;
    const second = merge(first, [tickRow("2026casj_qm2", BLUE, 20)]).sidecar;
    const third = merge(second, [tickRow("2026casj_qm3", RED, 30)]).sidecar;

    expect(third.rows.map((row) => row.m)).toEqual(["2026casj_qm1", "2026casj_qm2", "2026casj_qm3"]);
  });

  it("a tick folding TWO matches appends both, and both carry the SAME metrics record — the preserved flaw (D-04), not an introduced one", () => {
    // Both rows are built from one end-of-tick `valuesByTeam`, exactly as
    // `mergeTeamSeasonArtifact`'s own `matches.map` reuses one `metrics`
    // record today. This asserts the flaw so a future fix is a deliberate,
    // version-bumped change rather than an accident.
    const shared = new Map(RED.map((teamKey, i) => [teamKey, { total: 50 + i, auto: 25 + i, [SIGMA_METRIC_KEY]: 5 + i }]));
    const merged = merge(undefined, [
      { matchKey: "2026casj_qm1", teamKeys: RED, valuesByTeam: shared },
      { matchKey: "2026casj_qm2", teamKeys: RED, valuesByTeam: shared },
    ]).sidecar;

    expect(merged.rows).toHaveLength(2);
    expect(merged.rows[0]!.v).toEqual(merged.rows[1]!.v);
  });

  it("a row for a match key already present REPLACES it in place rather than appending a duplicate", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", RED, 10), tickRow("2026casj_qm2", BLUE, 20)]).sidecar;
    const replayed = merge(first, [tickRow("2026casj_qm1", RED, 99)]).sidecar;

    expect(replayed.rows.map((row) => row.m)).toEqual(["2026casj_qm1", "2026casj_qm2"]);
    expect(replayed.rows[0]!.v[0]![0]).toBe(99);
  });

  it("a DIFFERENT metric-key header discards the stored rows and reports keySetDrifted rather than mis-aligning them", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", RED, 10)]).sidecar;
    const drifted = merge(first, [tickRow("2026casj_qm2", BLUE, 20)], { metricKeys: ["total", "teleop", SIGMA_METRIC_KEY] });

    expect(drifted.keySetDrifted).toBe(true);
    expect(drifted.sidecar.rows.map((row) => row.m)).toEqual(["2026casj_qm2"]);
    expect(drifted.sidecar.metricKeys).toEqual(["total", "teleop", SIGMA_METRIC_KEY]);
  });

  it("an unchanged header does NOT report drift", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", RED, 10)]).sidecar;
    expect(merge(first, [tickRow("2026casj_qm2", BLUE, 20)]).keySetDrifted).toBe(false);
  });

  it("carries `complete` through — the tick sets it on the last-match fold", () => {
    expect(merge(undefined, [tickRow("2026casj_qm1", RED, 10)], { complete: true }).sidecar.complete).toBe(true);
    expect(merge(undefined, [tickRow("2026casj_qm1", RED, 10)]).sidecar.complete).toBe(false);
  });

  it("a metric key a team has no value for encodes as null, never as 0", () => {
    const merged = merge(undefined, [{ matchKey: "2026casj_qm1", teamKeys: ["frc1"], valuesByTeam: new Map([["frc1", { total: 12 }]]) }]).sidecar;
    expect(merged.rows[0]!.v[0]).toEqual([12, null, null]);
  });

  it("values are ROUNDED on the way in, so a sidecar value matches the publisher's rounded one exactly", () => {
    const merged = merge(undefined, [{ matchKey: "2026casj_qm1", teamKeys: ["frc1"], valuesByTeam: new Map([["frc1", { total: 12.345678 }]]) }]).sidecar;
    expect(merged.rows[0]!.v[0]![0]).toBe(12.35);
  });

  it("the merge never mutates the sidecar it was given", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", RED, 10)]).sidecar;
    const before = JSON.stringify(first);
    merge(first, [tickRow("2026casj_qm2", BLUE, 20)]);
    expect(JSON.stringify(first)).toBe(before);
  });
});

describe("the schema is the contract — ephemeral, never a page", () => {
  it("a merged sidecar parses, and its ephemeral/sidecarVersion literals are what a reader keys on", () => {
    const merged = merge(undefined, [tickRow("2026casj_qm1", RED, 10)]).sidecar;
    const parsed = LiveMetricSidecarSchema.parse(JSON.parse(JSON.stringify(merged)));
    expect(parsed.ephemeral).toBe(true);
    expect(parsed.sidecarVersion).toBe(LIVE_METRIC_SIDECAR_VERSION);
  });

  it("an object without `ephemeral: true` FAILS the parse — a page artifact can never be read as a sidecar", () => {
    const merged = merge(undefined, [tickRow("2026casj_qm1", RED, 10)]).sidecar;
    const { ephemeral: _dropped, ...withoutEphemeral } = merged;
    expect(() => LiveMetricSidecarSchema.parse(withoutEphemeral)).toThrow();
  });

  it("no row carries a spread or a percentile — the encoding has no place to put one", () => {
    const merged = merge(undefined, [tickRow("2026casj_qm1", RED, 10)]).sidecar;
    const serialized = JSON.stringify(merged);
    expect(serialized).not.toContain("spread");
    expect(serialized).not.toContain("percentile");
    expect(serialized).not.toContain("matchIndex");
  });
});

describe("sidecarRowsForTeam — the one decode path", () => {
  it("a round trip through the schema and back reproduces the same per-team metric values for every row", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", RED, 10)]).sidecar;
    const second = merge(first, [tickRow("2026casj_qm2", [...RED, ...BLUE], 20)]).sidecar;
    const reparsed = LiveMetricSidecarSchema.parse(JSON.parse(JSON.stringify(second)));

    for (const teamKey of [...RED, ...BLUE]) {
      expect(sidecarRowsForTeam(reparsed, teamKey), teamKey).toEqual(sidecarRowsForTeam(second, teamKey));
    }
  });

  it("returns only the rows for matches the team played, in sidecar order", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", RED, 10)]).sidecar;
    const second = merge(first, [tickRow("2026casj_qm2", BLUE, 20)]).sidecar;
    const third = merge(second, [tickRow("2026casj_qm3", RED, 30)]).sidecar;

    expect(sidecarRowsForTeam(third, "frc1").map((row) => row.matchKey)).toEqual(["2026casj_qm1", "2026casj_qm3"]);
    expect(sidecarRowsForTeam(third, "frc4").map((row) => row.matchKey)).toEqual(["2026casj_qm2"]);
    expect(sidecarRowsForTeam(third, "frc9999")).toEqual([]);
  });

  it("decodes into the `{ value }` shape a metric-history row carries, Sigma as an ordinary key", () => {
    const merged = merge(undefined, [tickRow("2026casj_qm1", ["frc1"], 10)]).sidecar;
    expect(sidecarRowsForTeam(merged, "frc1")).toEqual([{ matchKey: "2026casj_qm1", metrics: { total: 10, auto: 5, [SIGMA_METRIC_KEY]: 1 } }].map((row) => ({ matchKey: row.matchKey, metrics: Object.fromEntries(Object.entries(row.metrics).map(([k, v]) => [k, { value: v }])) })));
  });

  it("a null value DROPS its key rather than becoming a 0 — absence stays absence", () => {
    const merged = merge(undefined, [{ matchKey: "2026casj_qm1", teamKeys: ["frc1"], valuesByTeam: new Map([["frc1", { total: 12 }]]) }]).sidecar;
    expect(sidecarRowsForTeam(merged, "frc1")[0]!.metrics).toEqual({ total: { value: 12 } });
  });
});
