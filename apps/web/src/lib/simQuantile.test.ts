import { describe, expect, it } from "vitest";
import { continuousQuantile } from "./simQuantile.js";

/**
 * RESEARCH.md's Wave 0 EVNT-07 regression file for `continuousQuantile()` —
 * sketch 005's three worked examples, recomputed this session from that
 * sketch's own committed `data.js`
 * (`.claude/skills/sketch-findings-sigmascout/sources/005-rank-distribution/data.js`),
 * plus the bounded-by-construction, 0.8-rank-unit-minimum-width, skip-empty-bins
 * and hostile-input properties. Every fixture below is a plain array literal
 * written directly into this test — `data.js` is never read at test time.
 *
 * `08-04-PLAN.md`'s Task 1 <acceptance_criteria> requires the three
 * worked-example cases be OBSERVED FAILING against a deliberately
 * integer-snapping implementation before the real port lands (a
 * module-not-found error does not count as that red step). See
 * `08-04-SUMMARY.md` for the quoted failure.
 */

// Team 3467 @ 2023nhgrs — the locked team integer snapping renders as a
// zero-width, invisible `1-1` band. Head 996, 3, 1; length 39, sum 1000.
const DIST_3467 = [996, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Team 95 @ 2023nhgrs — head 3, 666, 330, 0, 1; length 39, sum 1000.
const DIST_95 = [3, 666, 330, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Team 4564 @ 2023nhgrs — head 1, 330, 574, 87, 8; length 39, sum 1000.
const DIST_4564 = [1, 330, 574, 87, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function sum(dist: readonly number[]): number {
  return dist.reduce((acc, v) => acc + v, 0);
}

describe("continuousQuantile — sketch 005's three worked examples (regression core)", () => {
  it("fixtures are shaped exactly as sketch 005 recorded — length 39, sum 1000 — so a mistyped fixture fails as a fixture error, not a silently redefined expectation", () => {
    expect(DIST_3467).toHaveLength(39);
    expect(sum(DIST_3467)).toBe(1000);
    expect(DIST_95).toHaveLength(39);
    expect(sum(DIST_95)).toBe(1000);
    expect(DIST_4564).toHaveLength(39);
    expect(sum(DIST_4564)).toBe(1000);
  });

  it("team 3467 — the locked-team case integer snapping collapsed to a zero-width, invisible '1-1' band", () => {
    const p10 = continuousQuantile(DIST_3467, 0.1, 1000);
    const p90 = continuousQuantile(DIST_3467, 0.9, 1000);
    expect(p10).toBeCloseTo(0.600402, 6);
    expect(p90).toBeCloseTo(1.403614, 6);
    expect(p10).not.toBe(p90);
  });

  it("team 95 — p90 is the exact rational 3.2 (3 - 0.5 + 231/330)", () => {
    const p10 = continuousQuantile(DIST_95, 0.1, 1000);
    const p90 = continuousQuantile(DIST_95, 0.9, 1000);
    expect(p10).toBeCloseTo(1.645646, 6);
    expect(p90).toBe(3.2);
  });

  it("team 4564 — p10 is the exact rational 1.8 (2 - 0.5 + 99/330)", () => {
    const p10 = continuousQuantile(DIST_4564, 0.1, 1000);
    const p90 = continuousQuantile(DIST_4564, 0.9, 1000);
    expect(p10).toBe(1.8);
    expect(p90).toBeCloseTo(3.491289, 6);
  });

  it("team 95 and team 4564 produce DIFFERENT bands on both edges — integer snapping renders both as '2-3'", () => {
    const p10_95 = continuousQuantile(DIST_95, 0.1, 1000);
    const p90_95 = continuousQuantile(DIST_95, 0.9, 1000);
    const p10_4564 = continuousQuantile(DIST_4564, 0.1, 1000);
    const p90_4564 = continuousQuantile(DIST_4564, 0.9, 1000);
    expect(p10_95).not.toBe(p10_4564);
    expect(p90_95).not.toBe(p90_4564);
  });
});

describe("continuousQuantile — bounded by construction", () => {
  it.each([
    ["3467", DIST_3467],
    ["95", DIST_95],
    ["4564", DIST_4564],
  ] as const)("team %s: p10 and p90 both fall inside [0.5, dist.length + 0.5]", (_label, dist) => {
    const p10 = continuousQuantile(dist, 0.1, 1000);
    const p90 = continuousQuantile(dist, 0.9, 1000);
    expect(p10).toBeGreaterThanOrEqual(0.5);
    expect(p10).toBeLessThanOrEqual(dist.length + 0.5);
    expect(p90).toBeGreaterThanOrEqual(0.5);
    expect(p90).toBeLessThanOrEqual(dist.length + 0.5);
  });

  it("an all-zero histogram returns exactly dist.length + 0.5 for any p — the terminal fallback, since no bin ever meets the target", () => {
    const allZero = new Array<number>(39).fill(0);
    expect(continuousQuantile(allZero, 0.1, 1000)).toBe(39.5);
    expect(continuousQuantile(allZero, 0.5, 1000)).toBe(39.5);
    expect(continuousQuantile(allZero, 0.9, 1000)).toBe(39.5);
  });

  it("a histogram whose total mass is less than draws (a mismatched draw count) returns the terminal dist.length + 0.5 for p near 1, rather than throwing or looping", () => {
    const short = [500, 200, 0, 0, 0];
    expect(continuousQuantile(short, 0.99, 1000)).toBe(5.5);
  });
});

describe("continuousQuantile — structural properties", () => {
  it("empty bins are skipped, not consumed: a leading run of zeros does not shift the answer", () => {
    expect(continuousQuantile([0, 0, 1000], 0.5, 1000)).toBe(3.0);
  });

  it("all mass on one rank r yields exactly r - 0.4 at p=0.1 and r + 0.4 at p=0.9 — an exactly 0.8-rank-unit-wide band", () => {
    const singleRank1 = [1000, 0, 0, 0, 0];
    expect(continuousQuantile(singleRank1, 0.1, 1000)).toBe(0.6);
    expect(continuousQuantile(singleRank1, 0.9, 1000)).toBe(1.4);
    expect(continuousQuantile(singleRank1, 0.9, 1000) - continuousQuantile(singleRank1, 0.1, 1000)).toBeCloseTo(0.8, 10);

    const singleRankLast = [0, 0, 0, 0, 1000];
    expect(continuousQuantile(singleRankLast, 0.1, 1000)).toBe(4.6);
    expect(continuousQuantile(singleRankLast, 0.9, 1000)).toBe(5.4);
    expect(continuousQuantile(singleRankLast, 0.9, 1000) - continuousQuantile(singleRankLast, 0.1, 1000)).toBeCloseTo(0.8, 10);
  });

  it("monotonicity: for each of the three real fixtures, p10 is strictly less than p90", () => {
    for (const dist of [DIST_3467, DIST_95, DIST_4564]) {
      expect(continuousQuantile(dist, 0.1, 1000)).toBeLessThan(continuousQuantile(dist, 0.9, 1000));
    }
  });

  it("determinism: calling twice with the same inputs returns identical values, and the input array is never mutated", () => {
    const before = [...DIST_3467];
    const first = continuousQuantile(DIST_3467, 0.1, 1000);
    const second = continuousQuantile(DIST_3467, 0.1, 1000);
    expect(first).toBe(second);
    expect(DIST_3467).toEqual(before);
  });
});

describe("continuousQuantile — hostile and degenerate input (must terminate, never throw, never return NaN)", () => {
  it("a zero-length histogram returns 0.5", () => {
    expect(continuousQuantile([], 0.5, 1000)).toBe(0.5);
  });

  it("a histogram containing a NaN count still terminates and returns a finite number — NaN comparisons are false, so the bin is stepped over", () => {
    const poisoned = [Number.NaN, 0, 0];
    const result = continuousQuantile(poisoned, 0.5, 1000);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("p=0 returns a value at or above 0.5, and p=1 returns a value at or below dist.length + 0.5", () => {
    expect(continuousQuantile(DIST_3467, 0, 1000)).toBeGreaterThanOrEqual(0.5);
    expect(continuousQuantile(DIST_3467, 1, 1000)).toBeLessThanOrEqual(DIST_3467.length + 0.5);
  });

  it("accepts an Int32Array as well as a plain array, and produces identical results for the same counts — the shape 08-03's per-team accumulator hands it", () => {
    const asArray = DIST_3467;
    const asTyped = Int32Array.from(DIST_3467);
    expect(continuousQuantile(asTyped, 0.1, 1000)).toBe(continuousQuantile(asArray, 0.1, 1000));
    expect(continuousQuantile(asTyped, 0.9, 1000)).toBe(continuousQuantile(asArray, 0.9, 1000));
  });
});
