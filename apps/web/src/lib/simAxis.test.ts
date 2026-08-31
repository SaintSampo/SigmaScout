import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { continuousQuantile } from "./simQuantile.js";
import { PLOT_W, SIM_GEOMETRY, histBarExtent, medianTickLeft, rankBandExtent, rankSlotWidth, x } from "./simAxis.js";

/**
 * 08-04-PLAN.md Task 3's geometry contract: continuous-input mapping, the
 * endpoint anchors, the degenerate-roster guard, the clamp proven against
 * the three sketch events' measured overflows, and the BAND_OPACITY-to-token
 * coupling assertion read from the shipped `theme.css`.
 */

describe("PLOT_W", () => {
  it("is re-exported from matchAxis.ts (asserted structurally, never by restating 470 here)", () => {
    expect(PLOT_W).toBe(470);
  });
});

describe("x(rank, teamCount) — the single rank-to-pixel mapping", () => {
  it.each([17, 39, 42, 78])("anchors the axis: x(1, N) is 0 and x(N, N) is PLOT_W, for N=%s", (n) => {
    expect(x(1, n)).toBe(0);
    expect(x(n, n)).toBe(PLOT_W);
  });

  it("is continuous and never snapped: x(1.5, 39) sits strictly between x(1, 39) and x(2, 39), and equals their exact midpoint", () => {
    const lo = x(1, 39);
    const hi = x(2, 39);
    const mid = x(1.5, 39);
    expect(mid).toBeGreaterThan(lo);
    expect(mid).toBeLessThan(hi);
    expect(mid).toBeCloseTo((lo + hi) / 2, 10);
  });

  it("is continuous and never snapped: x(2.7, 39) sits strictly between x(2, 39) and x(3, 39)", () => {
    const lo = x(2, 39);
    const hi = x(3, 39);
    expect(x(2.7, 39)).toBeGreaterThan(lo);
    expect(x(2.7, 39)).toBeLessThan(hi);
  });

  it("is linear in rank: the pitch between consecutive integer ranks is constant and equals PLOT_W / (N - 1)", () => {
    expect(x(2, 78) - x(1, 78)).toBeCloseTo(6.104, 3);
    expect(x(50, 78) - x(49, 78)).toBeCloseTo(6.104, 3);
    expect(x(2, 39) - x(1, 39)).toBeCloseTo(12.368, 3);
    expect(x(20, 39) - x(19, 39)).toBeCloseTo(12.368, 3);
  });

  it("maps a band edge at the mathematical bounds outside the plot box — the fact the clamp exists for", () => {
    expect(x(0.5, 39)).toBeCloseTo(-6.184, 3);
    expect(x(0.5, 39)).toBeLessThan(0);
    expect(x(39.5, 39)).toBeCloseTo(476.184, 3);
    expect(x(39.5, 39)).toBeGreaterThan(PLOT_W);
  });

  it("degenerate guard: x(1, 1), x(1, 0) and x(1, NaN) each return exactly 0, never NaN or non-finite", () => {
    expect(x(1, 1)).toBe(0);
    expect(Number.isFinite(x(1, 1))).toBe(true);
    expect(x(1, 0)).toBe(0);
    expect(Number.isFinite(x(1, 0))).toBe(true);
    expect(x(1, Number.NaN)).toBe(0);
    expect(Number.isFinite(x(1, Number.NaN))).toBe(true);
  });
});

describe("rankSlotWidth(teamCount)", () => {
  it("returns PLOT_W / teamCount, with N deliberately (not N-1, x()'s denominator)", () => {
    expect(rankSlotWidth(78)).toBeCloseTo(6.026, 3);
    expect(rankSlotWidth(39)).toBeCloseTo(12.051, 3);
  });

  it("returns PLOT_W for a teamCount below 1, and never a non-finite value", () => {
    expect(rankSlotWidth(0)).toBe(PLOT_W);
    expect(rankSlotWidth(Number.NaN)).toBe(PLOT_W);
    expect(Number.isFinite(rankSlotWidth(Number.NaN))).toBe(true);
  });
});

describe("rankBandExtent(p10, p90, teamCount) — the clamped band", () => {
  const N = 39;
  // Sketch 005's three worked examples, computed here via Task 1's own
  // continuousQuantile() rather than re-derived by hand.
  const DIST_3467 = [996, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const DIST_95 = [3, 666, 330, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const DIST_4564 = [1, 330, 574, 87, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  const p10_3467 = continuousQuantile(DIST_3467, 0.1, 1000);
  const p90_3467 = continuousQuantile(DIST_3467, 0.9, 1000);
  const p10_95 = continuousQuantile(DIST_95, 0.1, 1000);
  const p90_95 = continuousQuantile(DIST_95, 0.9, 1000);
  const p10_4564 = continuousQuantile(DIST_4564, 0.1, 1000);
  const p90_4564 = continuousQuantile(DIST_4564, 0.9, 1000);

  it("each real case stays inside the box and above the minimum band width", () => {
    for (const [p10, p90] of [
      [p10_3467, p90_3467],
      [p10_95, p90_95],
      [p10_4564, p90_4564],
    ] as const) {
      const extent = rankBandExtent(p10, p90, N);
      expect(extent.left).toBeGreaterThanOrEqual(0);
      expect(extent.left + extent.width).toBeLessThanOrEqual(PLOT_W);
      expect(extent.width).toBeGreaterThanOrEqual(SIM_GEOMETRY.BAND_MIN_W);
    }
  });

  it("team 3467's raw left edge is negative before clamping, and the returned left is exactly 0 — the clamp exercised by real data", () => {
    expect(x(p10_3467, N)).toBeLessThan(0);
    const extent = rankBandExtent(p10_3467, p90_3467, N);
    expect(extent.left).toBe(0);
    expect(extent.width).toBeCloseTo(4.99, 2);
  });

  it("teams 95 and 4564 return DIFFERENT extents on both left and width — the pixel-layer restatement of Task 1's inequality", () => {
    const extent95 = rankBandExtent(p10_95, p90_95, N);
    const extent4564 = rankBandExtent(p10_4564, p90_4564, N);
    expect(extent95.left).not.toBeCloseTo(extent4564.left, 6);
    expect(extent95.width).not.toBeCloseTo(extent4564.width, 6);
  });

  it("a fully locked team at N=78 (all 1000 draws on rank 1, edges 0.6/1.4) still returns a visible band above BAND_MIN_W", () => {
    const extent = rankBandExtent(0.6, 1.4, 78);
    expect(extent.width).toBeGreaterThanOrEqual(SIM_GEOMETRY.BAND_MIN_W);
    expect(extent.width).toBeCloseTo(2.44, 2);
  });

  it("a two-team event does not paint outside its cell, despite raw extents of -235px and 705px", () => {
    expect(x(0.5, 2)).toBe(-235);
    expect(x(2.5, 2)).toBe(705);
    const extent = rankBandExtent(0.5, 2.5, 2);
    expect(extent.left).toBe(0);
    expect(extent.left + extent.width).toBeLessThanOrEqual(PLOT_W);
  });

  it("a degenerate roster of 1 returns a finite extent inside the box rather than NaN", () => {
    const extent = rankBandExtent(0.6, 1.4, 1);
    expect(Number.isFinite(extent.left)).toBe(true);
    expect(Number.isFinite(extent.width)).toBe(true);
    expect(extent.left).toBeGreaterThanOrEqual(0);
    expect(extent.left + extent.width).toBeLessThanOrEqual(PLOT_W);
  });
});

describe("medianTickLeft(median, teamCount)", () => {
  it("centres the tick on the rank at a mid-table position where the clamp is not binding: medianTickLeft(20, 39) + half of MEDIAN_TICK_W equals x(20, 39)", () => {
    const half = SIM_GEOMETRY.MEDIAN_TICK_W / 2;
    expect(medianTickLeft(20, 39) + half).toBeCloseTo(x(20, 39), 10);
  });

  it("never leaves the box: at rank 1 and rank N, medianTickLeft is at least 0 and medianTickLeft + MEDIAN_TICK_W is at most PLOT_W", () => {
    for (const n of [2, 17, 39, 78]) {
      for (const rank of [1, n]) {
        const left = medianTickLeft(rank, n);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left + SIM_GEOMETRY.MEDIAN_TICK_W).toBeLessThanOrEqual(PLOT_W);
      }
    }
  });

  it("accepts a continuous median without snapping: medianTickLeft(7.5, 39) lies strictly between the values for 7 and 8", () => {
    const lo = medianTickLeft(7, 39);
    const hi = medianTickLeft(8, 39);
    const mid = medianTickLeft(7.5, 39);
    expect(mid).toBeGreaterThan(lo);
    expect(mid).toBeLessThan(hi);
  });
});

describe("histBarExtent(rank, teamCount)", () => {
  it("centres the bar on its rank's position for a mid-table rank where the clamp is not binding", () => {
    const extent = histBarExtent(20, 39);
    expect(extent.left + extent.width / 2).toBeCloseTo(x(20, 39), 10);
  });

  it("returns rankSlotWidth(N) - BAR_GAP, floored at 1, so adjacent bars never touch", () => {
    expect(histBarExtent(1, 78).width).toBeCloseTo(5.026, 3);
    expect(histBarExtent(1, 39).width).toBeCloseTo(11.051, 3);
  });

  it("no bar paints outside the cell, for every integer rank at N of 2, 17, 39 and 78 (looped, not spot-checked)", () => {
    let checked = 0;
    for (const n of [2, 17, 39, 78]) {
      for (let rank = 1; rank <= n; rank++) {
        const extent = histBarExtent(rank, n);
        expect(extent.left).toBeGreaterThanOrEqual(0);
        expect(extent.left + extent.width).toBeLessThanOrEqual(PLOT_W);
        checked++;
      }
    }
    // 2 + 17 + 39 + 78 = 136 positions checked across all four rosters.
    expect(checked).toBe(136);
  });
});

describe("--sim-band-overlay token coupling — the one case that reads a file off disk", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const THEME_CSS_PATH = resolve(HERE, "..", "styles", "theme.css");

  it("SIM_GEOMETRY.BAND_OPACITY * 100 equals the percentage declared inside --sim-band-overlay in the shipped theme.css", () => {
    const css = readFileSync(THEME_CSS_PATH, "utf-8");
    const match = css.match(/--sim-band-overlay:\s*color-mix\(in srgb, var\(--color-text-muted\) (\d+(?:\.\d+)?)%/);
    expect(match, "expected --sim-band-overlay to declare a color-mix(... N%, transparent) percentage in theme.css").not.toBeNull();
    const declaredPercent = Number(match![1]);
    const expectedPercent = SIM_GEOMETRY.BAND_OPACITY * 100;
    expect(declaredPercent, `theme.css declares ${declaredPercent}% but SIM_GEOMETRY.BAND_OPACITY * 100 is ${expectedPercent}`).toBe(expectedPercent);
  });

  it("theme.css also declares --sim-hist-bar and --sim-median-tick, so a partially-applied Task 2 fails here rather than at a later render", () => {
    const css = readFileSync(THEME_CSS_PATH, "utf-8");
    expect(css).toMatch(/--sim-hist-bar:/);
    expect(css).toMatch(/--sim-median-tick:/);
  });
});
