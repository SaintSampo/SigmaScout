/**
 * The points-axis adapter over the shipped rank-plot geometry.
 *
 * Every expectation compares against a DIRECT `simAxis` call with the two
 * substitutions applied by hand, so a drifting adapter fails here rather than
 * only in a screenshot.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLOT_W, SIM_GEOMETRY, histBarExtent, medianTickLeft, rankBandExtent, rankSlotWidth, x } from "../../lib/simAxis.js";
import { pointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import {
  VERDICT_GEOMETRY,
  VERDICT_PLOT_W,
  pointAxisTicks,
  pointBandExtent,
  pointBarExtent,
  pointBinExtent,
  pointBinSize,
  pointMedianTickLeft,
  pointSlots,
  pointVerdictAxisTicks,
  pointVerdictBandExtent,
  pointX,
} from "./districtHistGeometry.js";

const MAX = 22;
const SLOTS = MAX + 1;

describe("the one index shift", () => {
  it("maps point value v to slot v + 1 of m + 1 bins, EXACTLY, at the first, last and a middle value", () => {
    expect(pointSlots(MAX)).toBe(SLOTS);
    for (const value of [0, 11, MAX]) {
      expect(pointX(value, MAX)).toBe(x(value + 1, SLOTS));
    }
  });

  it("maps the median tick and a bar extent through the same substitution", () => {
    expect(pointMedianTickLeft(7.5, MAX)).toBe(medianTickLeft(8.5, SLOTS));
    expect(pointBarExtent(3, MAX)).toEqual(histBarExtent(4, SLOTS));
    expect(pointBandExtent(2, 9, MAX)).toEqual(rankBandExtent(3, 10, SLOTS));
  });

  it("maps the axis ticks back off the slot axis, so the first tick is point value 0", () => {
    const ticks = pointAxisTicks(MAX);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(MAX);
  });
});

describe("the band stays inside the plot box and never vanishes", () => {
  const cases: ReadonlyArray<readonly [string, number[]]> = [
    ["a point mass", [0, 0, 0, 0, 0, 100]],
    ["a two-point distribution", [50, 0, 0, 0, 0, 0, 0, 50]],
    ["a broad one", Array.from({ length: MAX + 1 }, () => 10)],
  ];

  for (const [label, counts] of cases) {
    it(`keeps the band and the tick inside the plot box for ${label}`, () => {
      const denominator = counts.reduce((sum, value) => sum + value, 0);
      const { p10, p50, p90 } = pointPercentiles(counts, denominator);
      const band = pointBandExtent(p10, p90, MAX);
      expect(band.left).toBeGreaterThanOrEqual(0);
      expect(band.left + band.width).toBeLessThanOrEqual(PLOT_W + 1e-9);
      const tick = pointMedianTickLeft(p50, MAX);
      expect(tick).toBeGreaterThanOrEqual(0);
      expect(tick + SIM_GEOMETRY.MEDIAN_TICK_W).toBeLessThanOrEqual(PLOT_W + 1e-9);
    });
  }

  it("draws a VISIBLE band for a point mass — sketch 005's first measured defect, floored at BAND_MIN_W", () => {
    const counts = [0, 0, 0, 0, 0, 100];
    const { p10, p90 } = pointPercentiles(counts, 100);
    expect(pointBandExtent(p10, p90, MAX).width).toBeGreaterThanOrEqual(SIM_GEOMETRY.BAND_MIN_W);
  });
});

describe("the bars tile the axis", () => {
  it("never overlaps two adjacent point values, and keeps both end bars flush inside the plot box", () => {
    for (let value = 0; value < MAX; value++) {
      const left = pointBarExtent(value, MAX);
      const right = pointBarExtent(value + 1, MAX);
      expect(left.left + left.width).toBeLessThanOrEqual(right.left + 1e-9);
    }
    const first = pointBarExtent(0, MAX);
    const last = pointBarExtent(MAX, MAX);
    expect(first.left).toBeGreaterThanOrEqual(0);
    expect(last.left + last.width).toBeLessThanOrEqual(PLOT_W + 1e-9);
  });
});

describe("the two denominators agree", () => {
  it("gives a denominator-1 baked array and a denominator-N simulated histogram describing the same distribution identical band edges and median tick", () => {
    const simulated = [0, 0, 100, 300, 400, 200];
    const draws = 1000;
    const baked = simulated.map((count) => count / draws);

    const fromSimulated = pointPercentiles(simulated, draws);
    const fromBaked = pointPercentiles(baked, 1);
    expect(pointBandExtent(fromBaked.p10, fromBaked.p90, MAX)).toEqual(pointBandExtent(fromSimulated.p10, fromSimulated.p90, MAX));
    expect(pointMedianTickLeft(fromBaked.p50, MAX)).toBe(pointMedianTickLeft(fromSimulated.p50, MAX));
  });
});

describe("the verdict chart's geometry (sketch 025 variant A, quick task 261006-lxp)", () => {
  const GRAND_MAX = 425;
  const GRAND_SLOTS = GRAND_MAX + 1;

  it("bins a 426 slot axis at plotW 560 five values to a bar, and a narrow axis one to a bar", () => {
    expect(VERDICT_PLOT_W).toBe(560);
    expect(pointBinSize(GRAND_MAX)).toBe(Math.ceil(GRAND_SLOTS / VERDICT_GEOMETRY.BIN_TARGET));
    expect(pointBinSize(GRAND_MAX)).toBe(5);
    expect(pointBinSize(MAX)).toBe(1);
    expect(pointBinSize(94)).toBe(1);
    expect(pointBinSize(95)).toBe(2);
  });

  it("tiles the axis edge to edge with touching bins, matching direct simAxis calls", () => {
    const bin = pointBinSize(GRAND_MAX);
    const half = rankSlotWidth(GRAND_SLOTS, VERDICT_PLOT_W) / 2;
    const extents = [];
    for (let from = 0; from <= GRAND_MAX; from += bin) {
      const to = Math.min(from + bin - 1, GRAND_MAX);
      const extent = pointBinExtent(from, to, GRAND_MAX, VERDICT_PLOT_W);
      expect(extent.left).toBeCloseTo(x(from + 1, GRAND_SLOTS, VERDICT_PLOT_W) - half, 9);
      expect(extent.left + extent.width).toBeCloseTo(x(to + 1, GRAND_SLOTS, VERDICT_PLOT_W) + half, 9);
      extents.push(extent);
    }
    expect(extents[0]!.left).toBeCloseTo(0, 9);
    const last = extents[extents.length - 1]!;
    expect(last.left + last.width).toBeCloseTo(VERDICT_PLOT_W, 9);
    for (let i = 1; i < extents.length; i++) {
      const previous = extents[i - 1]!;
      // No gap and no overlap: each bin starts exactly where the last one ends.
      expect(extents[i]!.left).toBeCloseTo(previous.left + previous.width, 9);
    }
  });

  it("maps the band through the adapter with no extra half slot, and floors a point mass at 3 inside the box", () => {
    expect(pointVerdictBandExtent(199, 228, GRAND_MAX, VERDICT_PLOT_W)).toEqual(rankBandExtent(200, 229, GRAND_SLOTS, VERDICT_PLOT_W));
    for (const at of [0, 11, MAX]) {
      const counts = Array.from({ length: MAX + 1 }, (_, value) => (value === at ? 100 : 0));
      const { p10, p90 } = pointPercentiles(counts, 100);
      const band = pointVerdictBandExtent(p10, p90, MAX, VERDICT_PLOT_W);
      expect(band.width).toBeGreaterThanOrEqual(VERDICT_GEOMETRY.BAND_MIN_W);
      expect(band.left).toBeGreaterThanOrEqual(0);
      expect(band.left + band.width).toBeLessThanOrEqual(VERDICT_PLOT_W + 1e-9);
    }
    // A degenerate band at one edge stays inside the box.
    const edge = pointVerdictBandExtent(MAX + 0.5, MAX + 0.5, MAX, VERDICT_PLOT_W);
    expect(edge.width).toBe(VERDICT_GEOMETRY.BAND_MIN_W);
    expect(edge.left + edge.width).toBeLessThanOrEqual(VERDICT_PLOT_W + 1e-9);
  });

  it("follows the 100, 50, 20, 10 tick ladder from zero", () => {
    expect(pointVerdictAxisTicks(425)).toEqual([0, 100, 200, 300, 400]);
    expect(pointVerdictAxisTicks(249)).toEqual([0, 50, 100, 150, 200]);
    expect(pointVerdictAxisTicks(66)).toEqual([0, 20, 40, 60]);
    expect(pointVerdictAxisTicks(22)).toEqual([0, 10, 20]);
    expect(pointVerdictAxisTicks(300)).toEqual([0, 50, 100, 150, 200, 250, 300]);
  });

  it("keeps every number the sketch drew", () => {
    expect(VERDICT_GEOMETRY).toEqual({
      PLOT_H: 84,
      AXIS_H: 16,
      BOTTOM_PAD: 4,
      TOP_MARKED: 20,
      TOP_PLAIN: 6,
      BAR_MAX_H: 82,
      BAND_MIN_W: 3,
      BIN_TARGET: 95,
      LABEL_GAP: 5,
      LABEL_EDGE: 80,
      LABEL_RISE: 7,
      LINE_RISE: 2,
      TICK_LABEL_DROP: 13,
    });
  });
});

describe("the histogram reaches the shared geometry only through the adapter", () => {
  it("never names the shared rank geometry module in DistrictPointHistogram.tsx, comments stripped, and imports the adapter", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "DistrictPointHistogram.tsx"), "utf8").replace(/\r\n/g, "\n");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/simAxis/);
    expect(code).toContain('"./districtHistGeometry.js"');
  });
});
