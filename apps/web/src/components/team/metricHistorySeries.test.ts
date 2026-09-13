import { describe, expect, it } from "vitest";
import { buildMetricSeries, detectEventBands, drawsSigmaBand, niceYAxis, sigmaBandFor } from "./metricHistorySeries.js";
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

describe("niceYAxis (quick task 260913-m45)", () => {
  // Every tick must be a whole multiple of one step, with zero on the ladder.
  function expectLadder(ticks: readonly number[], domain: readonly [number, number]) {
    const step = ticks[1]! - ticks[0]!;
    expect(step).toBeGreaterThan(0);
    for (const tick of ticks) expect(Math.abs(tick / step - Math.round(tick / step))).toBeLessThan(1e-9);
    expect(ticks).toContain(0);
    expect(ticks[0]).toBe(domain[0]);
    expect(ticks[ticks.length - 1]).toBe(domain[1]);
  }

  it("a band dipping below zero gets round ticks through zero, not ticks anchored at the band's odd lower edge", () => {
    // The live look check (2481, synthetic sigma): a raw domain of
    // [-18.71, 514.53] rendered ticks -18.71, 131.29, 281.29, ...
    const { domain, ticks } = niceYAxis(-18.71, 514.53);
    expect(domain).toEqual([-100, 600]);
    expect(ticks).toEqual([-100, 0, 100, 200, 300, 400, 500, 600]);
  });

  it("a negative-Total team straddling zero reads -100, -50, 0, 50, 100", () => {
    const { domain, ticks } = niceYAxis(-74.29, 76.13);
    expect(domain).toEqual([-100, 100]);
    expect(ticks).toEqual([-100, -50, 0, 50, 100]);
  });

  it("never narrows the raw domain, and adds at most one step on each side", () => {
    for (const [min, max] of [
      [0, 418.64],
      [-1509.66, 180.2],
      [-85, 0],
      [0, 101],
      [0, 1.3],
    ] as const) {
      const { domain, ticks } = niceYAxis(min, max);
      const step = ticks[1]! - ticks[0]!;
      expect(domain[0]).toBeLessThanOrEqual(min);
      expect(domain[1]).toBeGreaterThanOrEqual(max);
      expect(min - domain[0]).toBeLessThan(step);
      expect(domain[1] - max).toBeLessThan(step);
      expectLadder(ticks, domain);
    }
  });

  it("keeps zero as the exact floor or ceiling when the raw domain ends at zero", () => {
    expect(niceYAxis(0, 418.64).domain[0]).toBe(0);
    expect(niceYAxis(-85, 0).domain[1]).toBe(0);
  });

  it("produces tick values free of float noise for fractional steps", () => {
    for (const tick of niceYAxis(0, 1.3).ticks) expect(tick).toBe(Number(tick.toFixed(6)));
  });
});
