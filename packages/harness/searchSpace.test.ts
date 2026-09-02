/**
 * Pure unit tests over `searchSpace.ts`'s own logic — no corpus, matching
 * the plan's stated scope: grid shape/inclusivity/monotonicity/scale,
 * bound/default consistency across every searchable key, and
 * `isValidParamSet`'s cross-parameter rejections.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGMA1_PARAMS, Sigma1ParamsSchema, type Sigma1Params } from "../core/algorithms/sigma1/params.js";
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

  it("produces the exact expected geometric (log-scale) grid for processNoiseWithinEventRel", () => {
    // D-T1 bounds [2e-5, 2e-3] -- exactly two decades, so the endpoints and
    // the geometric spacing between them are checkable in closed form. The
    // DEFAULT (SIGMA1_PROCESS_NOISE_WITHIN_EVENT / SIGMA1_REFERENCE_SCORE_VARIANCE
    // = 4.8628e-4) no longer lands on a grid slot exactly, so unlike the
    // retired absolute version this asserts the endpoints exactly and the
    // interior slots up to the default's own overwrite.
    const grid = screenGridFor("processNoiseWithinEventRel", 5);
    expect(grid[0]).toBe(2e-5);
    expect(grid[4]).toBe(2e-3);
    // Exactly one INTERIOR slot is replaced by the default; the other two
    // keep their geometric positions.
    expect(grid).toContain(DEFAULT_SIGMA1_PARAMS.processNoiseWithinEventRel);
    expect(grid.filter((v) => v === DEFAULT_SIGMA1_PARAMS.processNoiseWithinEventRel)).toHaveLength(1);
    // Strictly increasing: the default's overwrite must never de-order the grid.
    for (let i = 1; i < grid.length; i++) expect(grid[i]!).toBeGreaterThan(grid[i - 1]!);
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

  it("rejects processNoiseEventBoundaryRel <= processNoiseWithinEventRel", () => {
    const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, processNoiseEventBoundaryRel: 5e-4, processNoiseWithinEventRel: 5e-4 };
    expect(isValidParamSet(params)).toBe(false);
    const params2: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, processNoiseEventBoundaryRel: 4e-4, processNoiseWithinEventRel: 5e-4 };
    expect(isValidParamSet(params2)).toBe(false);
  });

  // F3: the RP threshold variables' own absolute pair carries the SAME D-07
  // ordering. It is not searchable, but `--set-param` and a hand-edited
  // committed version file both reach this predicate.
  it("rejects rpProcessNoiseEventBoundary <= rpProcessNoiseWithinEvent", () => {
    expect(isValidParamSet({ ...DEFAULT_SIGMA1_PARAMS, rpProcessNoiseEventBoundary: 0.5, rpProcessNoiseWithinEvent: 0.5 })).toBe(false);
    expect(isValidParamSet({ ...DEFAULT_SIGMA1_PARAMS, rpProcessNoiseEventBoundary: 0.4, rpProcessNoiseWithinEvent: 0.5 })).toBe(false);
  });

  it("rejects adaptationMinFactor >= adaptationMaxFactor", () => {
    const params: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, adaptationMinFactor: 4, adaptationMaxFactor: 4 };
    expect(isValidParamSet(params)).toBe(false);
    const params2: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, adaptationMinFactor: 5, adaptationMaxFactor: 4 };
    expect(isValidParamSet(params2)).toBe(false);
  });

  it("rejects carry reversion or share outside [0, 1]", () => {
    expect(isValidParamSet({ ...DEFAULT_SIGMA1_PARAMS, carryMeanReversion: -0.1 })).toBe(false);
    expect(isValidParamSet({ ...DEFAULT_SIGMA1_PARAMS, carryMeanReversion: 1.1 })).toBe(false);
    // D-T2: one share replaces the retired unnormalized weight pair.
    expect(isValidParamSet({ ...DEFAULT_SIGMA1_PARAMS, carryPriorYearShare: -0.1 })).toBe(false);
    expect(isValidParamSet({ ...DEFAULT_SIGMA1_PARAMS, carryPriorYearShare: 1.5 })).toBe(false);
  });

  // D-11 / 03-REVIEW WR-01: `isValidParamSet` and `Sigma1ParamsSchema`'s
  // object-level `.check(...)` must agree on exactly the same accept/reject
  // set — this is what makes the schema a safe drop-in enforcement point for
  // every construction path, not just an independently-plausible duplicate
  // check that could silently drift from the boolean pre-filter. Placed here
  // (not in `params.test.ts`) so `packages/core`'s own test suite stays
  // package-local and never imports from `packages/harness`.
  describe("agreement with Sigma1ParamsSchema (D-11)", () => {
    const CANDIDATES: readonly Sigma1Params[] = [
      DEFAULT_SIGMA1_PARAMS,
      { ...DEFAULT_SIGMA1_PARAMS, processNoiseEventBoundaryRel: 5e-4, processNoiseWithinEventRel: 5e-4 },
      { ...DEFAULT_SIGMA1_PARAMS, processNoiseEventBoundaryRel: 4e-4, processNoiseWithinEventRel: 5e-4 },
      { ...DEFAULT_SIGMA1_PARAMS, rpProcessNoiseEventBoundary: 0.5, rpProcessNoiseWithinEvent: 0.5 },
      { ...DEFAULT_SIGMA1_PARAMS, rpProcessNoiseEventBoundary: 0.4, rpProcessNoiseWithinEvent: 0.5 },
      { ...DEFAULT_SIGMA1_PARAMS, adaptationMinFactor: 4, adaptationMaxFactor: 4 },
      { ...DEFAULT_SIGMA1_PARAMS, adaptationMinFactor: 5, adaptationMaxFactor: 4 },
      { ...DEFAULT_SIGMA1_PARAMS, carryMeanReversion: -0.1 },
      { ...DEFAULT_SIGMA1_PARAMS, carryMeanReversion: 1.1 },
      { ...DEFAULT_SIGMA1_PARAMS, carryPriorYearShare: -0.1 },
      { ...DEFAULT_SIGMA1_PARAMS, carryPriorYearShare: 1.5 },
      { ...DEFAULT_SIGMA1_PARAMS, processNoiseEventBoundaryRel: 2e-2 },
      { ...DEFAULT_SIGMA1_PARAMS, adaptationMinFactor: 0.1, adaptationMaxFactor: 8 },
    ];

    it.each(CANDIDATES.map((params, i) => [i, params] as const))(
      "candidate %i: isValidParamSet and Sigma1ParamsSchema.safeParse agree",
      (_i, params) => {
        const accepted = isValidParamSet(params);
        const parsed = Sigma1ParamsSchema.safeParse(params);
        expect(parsed.success).toBe(accepted);
      }
    );
  });
});
