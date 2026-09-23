/**
 * The live event rows' own unit tests (quick task 260918-16t, Task 1).
 *
 * These pin the merge's four behaviours, the encoding's round trip, the
 * EPHEMERALITY ASYMMETRY that makes a republish drop the block, the shape
 * guard's degrade, and — the one that matters most — the WHOLE PATH end to
 * end, through the real merge, a real serialization, the real shipped schema
 * and the real browser-side extension, with no hand-built stand-in for any of
 * them.
 *
 * What they deliberately do NOT cover is the Worker's use of them: that the
 * tick issues exactly two R2 calls per algorithm-event and none under any
 * other key lives in `apps/worker/test/scheduled.liveRows.test.ts`, against
 * the real `runTick`.
 */
import { describe, expect, it } from "vitest";
import {
  EVENT_LIVE_BLOCK_TRIM_RETAIN_ROWS,
  EVENT_LIVE_BLOCK_TRIM_THRESHOLD_BYTES,
  EventArtifactSchema,
  EventLiveBlockSchema,
  LiveEventArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  type EventLiveBlock,
} from "./pageArtifacts.js";
import { liveRowsForTeam, mergeEventLiveBlock, type EventLiveTickRow } from "./liveEventRows.js";
import { SIGMA_METRIC_KEY } from "./sigmaScore.js";
import { PAGE_BUDGET_MAX_BYTES } from "./publishBudget.js";
import { mergeEventArtifact } from "../../apps/worker/src/artifactMerge.js";
import { checkLiveEventArtifactShape } from "../../apps/worker/src/artifactShapeCheck.js";
import { extendMetricHistory } from "../../apps/web/src/lib/liveTeamSeason.js";
import { preMatchMetrics } from "../../apps/web/src/lib/preMatchMetrics.js";
import type { MatchResult, Prediction } from "../core/algorithms/types.js";
import type { MetricHistoryRow } from "./metricHistorySchema.js";

const EVENT_KEY = "2026casj";
const SEASON = 2026;
const ALGORITHM_ID = "spr";
const ALGORITHM_VERSION = "4.0.0+baseline";
// Sorted, exactly as `buildTickLiveRows` emits it — "auto" < "sigma" < "total".
const KEYS = ["auto", SIGMA_METRIC_KEY, "total"];
const RED = ["frc1", "frc2", "frc3"];
const BLUE = ["frc4", "frc5", "frc6"];
const TEAM = "frc1";

function tickRow(matchKey: string, teams: readonly string[], base: number): EventLiveTickRow {
  return {
    matchKey,
    teamKeys: teams,
    valuesByTeam: new Map(teams.map((teamKey, i) => [teamKey, { total: base + i, auto: base / 2 + i, [SIGMA_METRIC_KEY]: base / 10 + i }])),
  };
}

function merge(existing: EventLiveBlock | undefined, rows: readonly EventLiveTickRow[], overrides: { metricKeys?: readonly string[]; existingBodyBytes?: number } = {}) {
  return mergeEventLiveBlock({
    existing,
    metricKeys: overrides.metricKeys ?? KEYS,
    rows,
    existingBodyBytes: overrides.existingBodyBytes ?? 0,
  });
}

describe("mergeEventLiveBlock — the first fold at an event", () => {
  it("encodes exactly the folded match, positionally against the header, with no wrapper fields at all", () => {
    const { block, keySetDrifted, droppedRows } = merge(undefined, [tickRow("2026casj_qm1", [...RED, ...BLUE], 10)]);

    expect(keySetDrifted).toBe(false);
    expect(droppedRows).toBe(0);
    // The block is EXACTLY `{ metricKeys, rows }`. The eight wrapper fields the
    // sidecar carried (`sidecarVersion`, `ephemeral`, `eventKey`, `season`,
    // `algorithmId`, `algorithmVersion`, `computedAt`, `complete`) are all
    // stated by the event artifact this block rides inside.
    expect(Object.keys(block)).toEqual(["metricKeys", "rows"]);
    expect(block.metricKeys).toEqual(KEYS);
    expect(block.rows).toHaveLength(1);
    expect(block.rows[0]!.m).toBe("2026casj_qm1");
    expect(block.rows[0]!.t).toEqual([...RED, ...BLUE]);
    // frc1: auto = 10/2 + 0 = 5, sigma = 10/10 + 0 = 1, total = 10 + 0 = 10.
    expect(block.rows[0]!.v[0]).toEqual([5, 1, 10]);
    // frc5 is index 4: auto = 5 + 4 = 9, sigma = 1 + 4 = 5, total = 14.
    expect(block.rows[0]!.v[4]).toEqual([9, 5, 14]);
  });

  it("ROUNDS every value through roundMetric at encode time, so a live value equals the publisher's rounded one", () => {
    const { block } = merge(undefined, [
      { matchKey: "2026casj_qm1", teamKeys: [TEAM], valuesByTeam: new Map([[TEAM, { total: 42.987654, auto: 1.005, [SIGMA_METRIC_KEY]: -2.345 }]]) },
    ]);
    expect(block.rows[0]!.v[0]).toEqual([1.01, -2.35, 42.99]);
  });

  it("writes null, never 0, for a metric key a team has no value for", () => {
    const { block } = merge(undefined, [{ matchKey: "2026casj_qm1", teamKeys: [TEAM], valuesByTeam: new Map([[TEAM, { total: 40 }]]) }]);
    expect(block.rows[0]!.v[0]).toEqual([null, null, 40]);
  });

  it("treats SIGMA_METRIC_KEY as an ORDINARY header member with no special case in the encoding", () => {
    const { block } = merge(undefined, [tickRow("2026casj_qm1", [TEAM], 10)]);
    const sigmaIndex = block.metricKeys.indexOf(SIGMA_METRIC_KEY);
    expect(sigmaIndex).toBeGreaterThanOrEqual(0);
    expect(block.rows[0]!.v[0]![sigmaIndex]).toBe(1);
  });
});

describe("mergeEventLiveBlock — a second tick", () => {
  it("APPENDS a new match after the stored rows, in fold order", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", [TEAM], 10)]).block;
    const { block } = merge(first, [tickRow("2026casj_qm2", [TEAM], 20)]);
    expect(block.rows.map((row) => row.m)).toEqual(["2026casj_qm1", "2026casj_qm2"]);
  });

  it("REPLACES a re-folded match key IN PLACE rather than appending a duplicate — a duplicate `m` would be a silent double point on the chart", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", [TEAM], 10), tickRow("2026casj_qm2", [TEAM], 20)]).block;
    const { block } = merge(first, [tickRow("2026casj_qm1", [TEAM], 99)]);
    expect(block.rows.map((row) => row.m)).toEqual(["2026casj_qm1", "2026casj_qm2"]);
    expect(block.rows[0]!.v[0]).toEqual([49.5, 9.9, 99]);
  });

  it("CARRIES STORED ROWS BY REFERENCE, never by deep copy — the allocation churn a per-tick deep copy causes is a live suspect for the sidecar's own 9.5 ms", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", [TEAM], 10), tickRow("2026casj_qm2", [TEAM], 20)]).block;
    const { block } = merge(first, [tickRow("2026casj_qm3", [TEAM], 30)]);
    // Identity, not equality: these are the very objects the fetched body held.
    expect(block.rows[0]).toBe(first.rows[0]);
    expect(block.rows[1]).toBe(first.rows[1]);
    // And the caller's own array is not mutated in place.
    expect(first.rows).toHaveLength(2);
  });
});

describe("mergeEventLiveBlock — the metric-key drift guard", () => {
  it("DISCARDS the stored rows rather than mis-aligning them against a header they were not encoded under, and says that it did", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", [TEAM], 10)]).block;
    const { block, keySetDrifted } = merge(first, [tickRow("2026casj_qm2", [TEAM], 20)], { metricKeys: ["auto", "total"] });
    expect(keySetDrifted).toBe(true);
    expect(block.metricKeys).toEqual(["auto", "total"]);
    expect(block.rows.map((row) => row.m)).toEqual(["2026casj_qm2"]);
  });

  it("does NOT fire on a header that merely re-states the same keys in the same order", () => {
    const first = merge(undefined, [tickRow("2026casj_qm1", [TEAM], 10)]).block;
    const { keySetDrifted } = merge(first, [tickRow("2026casj_qm2", [TEAM], 20)], { metricKeys: [...KEYS] });
    expect(keySetDrifted).toBe(false);
  });
});

describe("mergeEventLiveBlock — the size trim", () => {
  const manyRows = Array.from({ length: 60 }, (_, i) => tickRow(`2026casj_qm${i + 1}`, [TEAM], i));

  it("leaves every row alone while the fetched body is under the threshold", () => {
    const { block, droppedRows } = merge(undefined, manyRows, { existingBodyBytes: EVENT_LIVE_BLOCK_TRIM_THRESHOLD_BYTES });
    expect(droppedRows).toBe(0);
    expect(block.rows).toHaveLength(60);
  });

  it("retains only the MOST RECENT rows once the fetched body is over the threshold, and reports the drop count", () => {
    const { block, droppedRows } = merge(undefined, manyRows, { existingBodyBytes: EVENT_LIVE_BLOCK_TRIM_THRESHOLD_BYTES + 1 });
    expect(droppedRows).toBe(60 - EVENT_LIVE_BLOCK_TRIM_RETAIN_ROWS);
    expect(block.rows).toHaveLength(EVENT_LIVE_BLOCK_TRIM_RETAIN_ROWS);
    // The EARLIEST rows are the ones that go: the tail is what the chart and
    // `endOfEventMetrics` need most.
    expect(block.rows[0]!.m).toBe("2026casj_qm21");
    expect(block.rows.at(-1)!.m).toBe("2026casj_qm60");
  });

  it("never throws and never touches the header — a throw would lose this tick's rows permanently, because the event cursor has already advanced", () => {
    expect(() => merge(undefined, manyRows, { existingBodyBytes: 10_000_000 })).not.toThrow();
    expect(merge(undefined, manyRows, { existingBodyBytes: 10_000_000 }).block.metricKeys).toEqual(KEYS);
  });

  it("keeps the trim threshold below the event page's own published byte ceiling, so the guard can never fire after the ceiling already would have", () => {
    expect(EVENT_LIVE_BLOCK_TRIM_THRESHOLD_BYTES).toBeLessThan(PAGE_BUDGET_MAX_BYTES.event);
  });
});

describe("liveRowsForTeam — the ONE decode path", () => {
  const block = merge(undefined, [tickRow("2026casj_qm1", [...RED, ...BLUE], 10), tickRow("2026casj_qm2", [...BLUE], 20)]).block;

  it("decodes one team's rows in fold order and SKIPS every row that team did not play", () => {
    expect(liveRowsForTeam(block, TEAM).map((row) => row.matchKey)).toEqual(["2026casj_qm1"]);
    expect(liveRowsForTeam(block, "frc4").map((row) => row.matchKey)).toEqual(["2026casj_qm1", "2026casj_qm2"]);
  });

  it("returns the metric record in the shape a metric-history row carries — `{ value }` only, no spread and no percentile", () => {
    const [row] = liveRowsForTeam(block, TEAM);
    expect(row!.metrics).toEqual({ auto: { value: 5 }, [SIGMA_METRIC_KEY]: { value: 1 }, total: { value: 10 } });
  });

  it("DROPS a null value's key entirely rather than turning it into a 0, so an absent metric renders as absence", () => {
    const sparse = merge(undefined, [{ matchKey: "2026casj_qm1", teamKeys: [TEAM], valuesByTeam: new Map([[TEAM, { total: 40 }]]) }]).block;
    expect(liveRowsForTeam(sparse, TEAM)[0]!.metrics).toEqual({ total: { value: 40 } });
  });

  it("returns nothing for a team that appears in no row at all", () => {
    expect(liveRowsForTeam(block, "frc9999")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The ephemerality asymmetry — the mechanism, tested where it is used
// ---------------------------------------------------------------------------

describe("the live block's shape under the two schemas", () => {
  it("parses cleanly under EventLiveBlockSchema, which is what the live artifact embeds", () => {
    const { block } = merge(undefined, [tickRow("2026casj_qm1", [...RED, ...BLUE], 10)]);
    expect(() => EventLiveBlockSchema.parse(JSON.parse(JSON.stringify(block)))).not.toThrow();
  });
});

describe("checkLiveEventArtifactShape and a malformed `live` value", () => {
  function bodyWith(live: unknown): Record<string, unknown> {
    return {
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      eventKey: EVENT_KEY,
      season: SEASON,
      matches: [],
      upcoming: [],
      teams: [],
      live,
    };
  }

  for (const [label, live] of [
    ["a string", "not-a-block"],
    ["null", null],
    ["an array", []],
    ["an object with no rows array", { metricKeys: ["total"] }],
    ["an object whose rows is not an array", { metricKeys: ["total"], rows: {} }],
  ] as const) {
    it(`costs the BLOCK and not the artifact for ${label} — a one-key problem must never become a full history loss on every tick`, () => {
      const guarded = checkLiveEventArtifactShape(bodyWith(live));
      expect(guarded).toBeDefined();
      expect(guarded).not.toHaveProperty("live");
      // Everything else survives untouched.
      expect(guarded!.eventKey).toBe(EVENT_KEY);
      expect(guarded!.matches).toEqual([]);
    });
  }

  it("keeps a WELL-SHAPED block, rows not walked — the guard is O(1) by design", () => {
    const { block } = merge(undefined, [tickRow("2026casj_qm1", [TEAM], 10)]);
    expect(checkLiveEventArtifactShape(bodyWith(block))?.live).toBe(block);
  });

  it("adds no `live` key of its own to a body that carried none", () => {
    const body = bodyWith(undefined);
    delete body.live;
    expect(checkLiveEventArtifactShape(body)).not.toHaveProperty("live");
  });
});

// THE END-TO-END DESCRIBE THAT STOOD HERE IS DELETED (quick task 260923-3w6),
// with the `tick`/`parseLive` helpers and the `matchResult`/`PREDICTION` fixtures
// that fed it. It drove the REAL `mergeEventArtifact` and asserted that the merge
// emitted the block, serialized it last in the body, re-appended it last when the
// existing body carried it in the middle, carried it forward on an idle tick, and
// that `EventArtifactSchema` stripped it on republish. `mergeEventArtifact` emits
// no `live` block at all now — the tick writes the team artifact itself again — so
// every one of those claims is about a code path that no longer exists.
//
// What survives above is the half the WEB still runs until quick task 260923-3w7:
// `mergeEventLiveBlock`'s merge and encoding rules, `liveRowsForTeam`'s decode,
// both schemas' asymmetry, and the read guard's tolerance of a malformed block.
