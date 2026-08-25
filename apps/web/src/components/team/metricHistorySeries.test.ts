import { describe, expect, it } from "vitest";
import { buildMetricSeries, detectEventBands } from "./metricHistorySeries.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";

function row(overrides: Partial<MetricHistoryRow> & { matchKey: string; eventKey: string; matchIndex: number }): MetricHistoryRow {
  return {
    matchKey: overrides.matchKey,
    season: 2024,
    eventKey: overrides.eventKey,
    algorithmId: "sigma1",
    teamKey: "frc1114",
    matchIndex: overrides.matchIndex,
    metrics: overrides.metrics ?? { total: { value: 100, spread: 5 } },
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

  it("carries value/spread/matchKey/eventKey through for the requested metric key", () => {
    const rows = [row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, metrics: { total: { value: 42.5, spread: 3.1 } } })];

    const [point] = buildMetricSeries(rows, "total");

    expect(point).toEqual({ x: 1, value: 42.5, spread: 3.1, matchKey: "m1", eventKey: "2024casj" });
  });

  it("produces an undefined value (a gap, never a coerced zero) when a row is missing the requested metric", () => {
    const rows = [row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, metrics: {} })];

    const [point] = buildMetricSeries(rows, "total");

    expect(point?.value).toBeUndefined();
    expect(point?.spread).toBeUndefined();
  });

  it("produces no value/spread suffix at all for an algorithm with no spread field (OPR/EPA)", () => {
    const rows = [row({ matchKey: "m1", eventKey: "2024casj", matchIndex: 0, metrics: { total: { value: 88 } } })];

    const [point] = buildMetricSeries(rows, "total");

    expect(point).toEqual({ x: 1, value: 88, spread: undefined, matchKey: "m1", eventKey: "2024casj" });
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
