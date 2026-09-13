import { describe, expect, it } from "vitest";
import { buildMetricSeries, detectEventBands, drawsSigmaBand, sigmaBandFor } from "./metricHistorySeries.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";

function row(overrides: Partial<MetricHistoryRow> & { matchKey: string; eventKey: string; matchIndex: number }): MetricHistoryRow {
  return {
    matchKey: overrides.matchKey,
    season: 2024,
    eventKey: overrides.eventKey,
    algorithmId: "spr",
    teamKey: "frc1114",
    matchIndex: overrides.matchIndex,
    metrics: overrides.metrics ?? { total: { value: 100 } },
  };
}

describe("buildMetricSeries", () => {
  it("derives x from array position, not matchIndex — season-wide gaps never appear", () => {
    const rows = [
      row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 4 }),
      row({ matchKey: "m2", eventKey: "2024casj", matchIndex: 17 }),
      row({ matchKey: "m3", eventKey: "2024casj", matchIndex: 92 }),
    ];

    const points = buildMetricSeries(rows, "total");

    expect(points.map((p) => p.x)).toEqual([1, 2, 3]);
  });

  it("carries value/sigma/matchKey/eventKey through for the requested metric key — sigma removed is the whole point (2026-09-09)", () => {
    const rows = [
      row({
        matchKey: "m1",
        eventKey: "2024casj",
        matchIndex: 0,
        metrics: { total: { value: 120, spread: 33 }, [SIGMA_METRIC_KEY]: { value: 12.5 } },
      }),
    ];

    const [point] = buildMetricSeries(rows, "total");

    expect(point).toEqual({ x: 1, value: 120, sigma: 12.5, matchKey: "m1", eventKey: "2024casj" });
    expect(point).not.toHaveProperty("spread");
  });

  it("produces an undefined value when a row is missing the requested metric, and undefined sigma when the row carries no sigma entry", () => {
    const rows = [row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, metrics: {} })];

    const [point] = buildMetricSeries(rows, "total");

    expect(point?.value).toBeUndefined();
    expect(point?.sigma).toBeUndefined();
  });

  it("yields sigma: undefined for a row carrying only total (no sigma entry — OPR/EPA, or a not-yet-republished SPR row)", () => {
    const rows = [row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, metrics: { total: { value: 88, spread: 33 } } })];

    const [point] = buildMetricSeries(rows, "total");

    expect(point).toEqual({ x: 1, value: 88, sigma: undefined, matchKey: "m1", eventKey: "2024casj" });
  });

  it("does not re-sort rows — array order is trusted as this team's own chronological order", () => {
    const rows = [
      row({ matchKey: "m-later", eventKey: "e1", matchIndex: 50 }),
      row({ matchKey: "m-earlier", eventKey: "e1", matchIndex: 2 }),
    ];

    const points = buildMetricSeries(rows, "total");

    expect(points.map((p) => p.matchKey)).toEqual(["m-later", "m-earlier"]);
  });
});

describe("detectEventBands", () => {
  it("opens a new band wherever eventKey changes across consecutive points", () => {
    const rows = [
      row({ matchKey: "m1", eventKey: "A", matchIndex: 0 }),
      row({ matchKey: "m2", eventKey: "A", matchIndex: 1 }),
      row({ matchKey: "m3", eventKey: "B", matchIndex: 2 }),
      row({ matchKey: "m4", eventKey: "B", matchIndex: 3 }),
      row({ matchKey: "m5", eventKey: "B", matchIndex: 4 }),
      row({ matchKey: "m6", eventKey: "C", matchIndex: 5 }),
    ];

    const bands = detectEventBands(buildMetricSeries(rows, "total"));

    expect(bands).toEqual([
      { eventKey: "A", startX: 1, endX: 2, index: 0 },
      { eventKey: "B", startX: 3, endX: 5, index: 1 },
      { eventKey: "C", startX: 6, endX: 6, index: 2 },
    ]);
  });

  it("returns an empty array for zero points", () => {
    expect(detectEventBands([])).toEqual([]);
  });

  it("returns a single one-point band for a single point", () => {
    const rows = [row({ matchKey: "m1", eventKey: "A", matchIndex: 0 })];
    const bands = detectEventBands(buildMetricSeries(rows, "total"));
    expect(bands).toEqual([{ eventKey: "A", startX: 1, endX: 1, index: 0 }]);
  });
});

describe("sigmaBandFor (quick task 260913-m45)", () => {
  it("returns [value - sigma, value + sigma] when both are defined", () => {
    expect(sigmaBandFor({ value: 120, sigma: 12.5 })).toEqual([107.5, 132.5]);
  });

  it("returns null (a gap, never a zero-width band) when sigma is missing", () => {
    expect(sigmaBandFor({ value: 120, sigma: undefined })).toBeNull();
  });

  it("returns null when value is missing", () => {
    expect(sigmaBandFor({ value: undefined, sigma: 12.5 })).toBeNull();
  });
});

describe("drawsSigmaBand (quick task 260913-m45)", () => {
  it("is true for spr rows carrying both a total value and a sigma entry", () => {
    const rows = [row({ matchKey: "m1", eventKey: "A", matchIndex: 0, metrics: { total: { value: 100 }, [SIGMA_METRIC_KEY]: { value: 8 } } })];
    expect(drawsSigmaBand(rows, "spr")).toBe(true);
  });

  it("is false for opr rows, even when the rows happen to carry a sigma key", () => {
    const rows = [row({ matchKey: "m1", eventKey: "A", matchIndex: 0, metrics: { total: { value: 100 }, [SIGMA_METRIC_KEY]: { value: 8 } } })];
    expect(drawsSigmaBand(rows, "opr")).toBe(false);
  });

  it("is false for spr rows with no sigma entry at all (pre-republish)", () => {
    const rows = [row({ matchKey: "m1", eventKey: "A", matchIndex: 0, metrics: { total: { value: 100 } } })];
    expect(drawsSigmaBand(rows, "spr")).toBe(false);
  });
});
