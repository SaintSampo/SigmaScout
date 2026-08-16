/**
 * Pure unit tests over `searchSpace.ts`'s own logic — no corpus, matching
 * the plan's stated scope: grid shape/inclusivity/monotonicity/scale,
 * bound/default consistency across every searchable key, and
 * `isValidParamSet`'s cross-parameter rejections.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "../core/algorithms/sigma1/params.js";
import { SEARCHABLE_PARAM_KEYS, SIGMA1_SEARCH_SPACE, isValidParamSet, screenGridFor } from "./searchSpace.js";

describe("SEARCHABLE_PARAM_KEYS", () => {
  it("excludes rpMonteCarloSeed, rpMonteCarloDraws, and adaptationEnabled, each for a documented reason", () => {
    expect(SEARCHABLE_PARAM_KEYS).not.toContain("rpMonteCarloSeed");
    expect(SEARCHABLE_PARAM_KEYS).not.toContain("rpMonteCarloDraws");
    expect(SEARCHABLE_PARAM_KEYS).not.toContain("adaptationEnabled");
  });

  it("has exactly one entry per SIGMA1_SEARCH_SPACE key, no more, no less", () => {
    expect(SEARCHABLE_PARAM_KEYS.length).toBe(Object.keys(SIGMA1_SEARCH_SPACE).length);
    for (const key of SEARCHABLE_PARAM_KEYS) {
      expect(SIGMA1_SEARCH_SPACE).toHaveProperty(key);
    }
  });

  it("every entry's own DEFAULT_SIGMA1_PARAMS value lies inside its declared bound", () => {
    for (const key of SEARCHABLE_PARAM_KEYS) {
      const bound = SIGMA1_SEARCH_SPACE[key];
      const defaultValue = DEFAULT_SIGMA1_PARAMS[key] as number;
      expect(defaultValue).toBeGreaterThanOrEqual(bound.min);
      expect(defaultValue).toBeLessThanOrEqual(bound.max);
    }
  });

  it("is sorted (matches SIGMA1_PARAM_KEYS's own canonical order)", () => {
    const sorted = [...SEARCHABLE_PARAM_KEYS].sort();
    expect(SEARCHABLE_PARAM_KEYS).toEqual(sorted);
  });
});

describe("screenGridFor", () => {
  it("returns exactly valueCount points, inclusive of both bounds, monotonically increasing, containing the default", () => {
    for (const key of SEARCHABLE_PARAM_KEYS) {
      const bound = SIGMA1_SEARCH_SPACE[key];
      const grid = screenGridFor(key, 5);
      expect(grid).toHaveLength(5);
      expect(grid[0]).toBe(bound.min);
      expect(grid[grid.length - 1]).toBe(bound.max);
      for (let i = 1; i < grid.length; i++) {
        expect(grid[i]!).toBeGreaterThan(grid[i - 1]!);
      }
      expect(grid).toContain(DEFAULT_SIGMA1_PARAMS[key] as number);
    }
  });

  it("works at the minimum valueCount of 3 (the acceptance smoke test's own grid size)", () => {
    for (const key of SEARCHABLE_PARAM_KEYS) {
      const grid = screenGridFor(key, 3);
      expect(grid).toHaveLength(3);
      expect(grid).toContain(DEFAULT_SIGMA1_PARAMS[key] as number);
    }
  });

  it("throws for valueCount < 3", () => {
    expect(() => screenGridFor("linkC", 2)).toThrow(/valueCount must be an integer >= 3/);
    expect(() => screenGridFor("linkC", 0)).toThrow(/valueCount must be an integer >= 3/);
  });

  it("throws for a non-integer valueCount", () => {
    expect(() => screenGridFor("linkC", 3.5)).toThrow(/valueCount must be an integer/);
  });

  it("produces the exact expected geometric (log-scale) grid for processNoiseWithinEvent", () => {
    // bounds [0.05, 5], default 0.5 -- 0.5 lands EXACTLY on the geometric
    // grid's middle slot at valueCount=5 (100^0.5 * 0.05 = 0.5), so this is
    // an exact-equality check, not just an approximate one.
    const grid = screenGridFor("processNoiseWithinEvent", 5);
    expect(grid[0]).toBe(0.05);
    expect(grid[2]).toBe(0.5);
    expect(grid[4]).toBe(5);
    expect(grid[1]).toBeCloseTo(0.05 * Math.pow(100, 0.25), 10);
    expect(grid[3]).toBeCloseTo(0.05 * Math.pow(100, 0.75), 10);
  });

  it("produces the exact expected arithmetic (linear-scale) grid for consistencyEwmaAlpha", () => {
    // bounds [0.02, 0.6], default 0.2 -- default is closest to the raw
    // interior slot at index 1 (0.165), which gets overwritten with the
    // exact default.
    const grid = screenGridFor("consistencyEwmaAlpha", 5);
    expect(grid[0]).toBe(0.02);
    expect(grid[1]).toBe(0.2);
    expect(grid[2]).toBeCloseTo(0.31, 10);
    expect(grid[3]).toBeCloseTo(0.455, 10);
    expect(grid[4]).toBe(0.6);
  });
});

describe("isValidParamSet", () => {
  it("accepts DEFAULT_SIGMA1_PARAMS", () => {
    expect(isValidParamSet(DEFAULT_SIGMA1_PARAMS)).toBe(true);
  });

  it("rejects processNoiseEventBoundary <= processNoiseWithinEvent", () => {
    const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, processNoiseEventBoundary: 0.5, processNoiseWithinEvent: 0.5 };
    expect(isValidParamSet(params)).toBe(false);
    const params2: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, processNoiseEventBoundary: 0.4, processNoiseWithinEvent: 0.5 };
    expect(isValidParamSet(params2)).toBe(false);
  });

  it("rejects adaptationMinFactor >= adaptationMaxFactor", () => {
    const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, adaptationMinFactor: 4, adaptationMaxFactor: 4 };
    expect(isValidParamSet(params)).toBe(false);
    const params2: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, adaptationMinFactor: 5, adaptationMaxFactor: 4 };
    expect(isValidParamSet(params2)).toBe(false);
  });

  it("rejects carry weights outside [0, 1]", () => {
    expect(isValidParamSet({ ...DEFAULT_SIGMA1_PARAMS, carryMeanReversion: -0.1 })).toBe(false);
    expect(isValidParamSet({ ...DEFAULT_SIGMA1_PARAMS, carryMeanReversion: 1.1 })).toBe(false);
    expect(isValidParamSet({ ...DEFAULT_SIGMA1_PARAMS, carryLastYearWeight: -0.1 })).toBe(false);
    expect(isValidParamSet({ ...DEFAULT_SIGMA1_PARAMS, carryPriorYearWeight: 1.5 })).toBe(false);
  });
});
