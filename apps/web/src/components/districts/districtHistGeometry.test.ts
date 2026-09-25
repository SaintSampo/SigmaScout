/**
 * The points-axis adapter over the shipped rank-plot geometry.
 *
 * Every expectation compares against a DIRECT `simAxis` call with the two
 * substitutions applied by hand, so a drifting adapter fails here rather than
 * only in a screenshot.
 */
import { describe, expect, it } from "vitest";
import { PLOT_W, SIM_GEOMETRY, histBarExtent, medianTickLeft, rankBandExtent, x } from "../../lib/simAxis.js";
import { pointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import {
  pointAxisTicks,
  pointBandExtent,
  pointBarExtent,
  pointMedianTickLeft,
  pointSlots,
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
