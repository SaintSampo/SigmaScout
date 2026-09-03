/**
 * Pure unit tests over `searchSpace.ts`'s own logic — no corpus, matching
 * the plan's stated scope: grid shape/inclusivity/monotonicity/scale,
 * bound/default consistency across every searchable key, and
 * `isValidParamSet`'s cross-parameter rejections.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGMA1_PARAMS, SIGMA1_PARAM_KEYS, Sigma1ParamsSchema, type Sigma1Params } from "../core/algorithms/sigma1/params.js";
import {
  SEARCHABLE_PARAM_KEYS,
  SEARCH_EXCLUSIONS,
  SIGMA1_SEARCH_SPACE,
  isValidParamSet,
  screenGridFor,
  type ExcludedParamKey,
} from "./searchSpace.js";

/**
 * D-T3's enforcement (quick task 260901-trz). D-T3's own wording is the
 * requirement: the exclusions must be expressed EXPLICITLY, as a named list
 * with reasons, "not by omission — a future reader must not be able to re-add
 * them by accident." These tests are what turns that from a comment into a
 * fact: a `Sigma1Params` field added later and forgotten here fails the
 * partition test with a message naming the field.
 */
describe("SEARCH_EXCLUSIONS (D-T3)", () => {
  it("partitions SIGMA1_PARAM_KEYS exactly with SIGMA1_SEARCH_SPACE — no key in both, no key in neither", () => {
    const excluded = Object.keys(SEARCH_EXCLUSIONS);
    const searchable = Object.keys(SIGMA1_SEARCH_SPACE);
    const excludedSet = new Set(excluded);
    const searchableSet = new Set(searchable);

    // Disjoint. A key in BOTH would mean the type system says "not
    // searchable" while the bounds record says "here is its bound" — the grid
    // would still be built and the exclusion would be decorative.
    const inBoth = excluded.filter((key) => searchableSet.has(key));
    expect(inBoth, `these keys are in BOTH SEARCH_EXCLUSIONS and SIGMA1_SEARCH_SPACE: ${inBoth.join(", ")}`).toEqual([]);

    // Covering. This is the half that catches a NEW parameter: a field added
    // to `Sigma1Params` and placed in neither structure is neither searched
    // nor deliberately excluded, which is exactly the accidental omission
    // D-T3 forbids.
    const inNeither = SIGMA1_PARAM_KEYS.filter((key) => !excludedSet.has(key) && !searchableSet.has(key));
    expect(
      inNeither,
      `${inNeither.join(", ")} is in neither SIGMA1_SEARCH_SPACE nor SEARCH_EXCLUSIONS — ` +
        `every Sigma1Params field must be either searchable (with a bound) or excluded (with a reason)`
    ).toEqual([]);

    // And nothing invented: neither structure may name a key that is not a
    // real parameter (a typo'd exclusion would silently exclude nothing).
    const paramKeySet = new Set<string>(SIGMA1_PARAM_KEYS);
    const unknown = [...excluded, ...searchable].filter((key) => !paramKeySet.has(key));
    expect(unknown, `these keys are not Sigma1Params fields at all: ${unknown.join(", ")}`).toEqual([]);

    expect([...excluded, ...searchable].sort()).toEqual([...SIGMA1_PARAM_KEYS].sort());
  });

  it("names the three keys D-T3 deletes from the search space, BY NAME (re-adding one turns this red and says which)", () => {
    expect(SIGMA1_SEARCH_SPACE).not.toHaveProperty("covShrinkage");
    expect(SIGMA1_SEARCH_SPACE).not.toHaveProperty("coldStartTeamTotalRel");
    expect(SIGMA1_SEARCH_SPACE).not.toHaveProperty("fallbackScoreSd");
    expect(SEARCH_EXCLUSIONS).toHaveProperty("covShrinkage");
    expect(SEARCH_EXCLUSIONS).toHaveProperty("coldStartTeamTotalRel");
    expect(SEARCH_EXCLUSIONS).toHaveProperty("fallbackScoreSd");
  });

  it("gives every exclusion a real reason, not a placeholder", () => {
    for (const [key, reason] of Object.entries(SEARCH_EXCLUSIONS)) {
      // 40 characters is roughly one clause. Anything shorter is a shrug
      // ("inert", "not tuned") rather than an argument a future reader can
      // weigh before re-adding the key.
      expect(reason.length, `SEARCH_EXCLUSIONS.${key}'s reason is too short to be a reason: "${reason}"`).toBeGreaterThanOrEqual(40);
      expect(reason.trim()).toBe(reason);
    }
  });

  it("leaves exactly 15 searchable keys, in SIGMA1_PARAM_KEYS's own sorted order", () => {
    // 26 Sigma1Params fields - 11 exclusions = 15. Pinned as literals so a
    // silent addition or deletion has to be acknowledged here.
    //
    // Was 25 - 9 = 16 until SIGMA1_CODE_VERSION 5.0.0 (D-V4): the field COUNT
    // was unchanged because shrinkagePriorMatches was DELETED and
    // varianceOprRidge added in the same version, but the searchable set lost
    // one dimension — the deleted field was searchable and the added one is
    // excluded. That is a real, intended narrowing of what a re-tune explores.
    //
    // 7.0.0 (D-Y1/D-Y3, quick task 260903-750) moves the TOTALS but not the
    // SEARCHABLE count: `varianceOprRidge` was deleted and the two swing
    // constants added, so 25 -> 26 fields and 10 -> 11 exclusions. All three
    // fields involved are display-only and search-excluded, which is why the
    // searchable set is untouched at 15 — the re-tune explores exactly what it
    // explored before, and swapping one display estimator for another must not
    // change that.
    expect(SEARCHABLE_PARAM_KEYS).toHaveLength(15);
    expect(Object.keys(SEARCH_EXCLUSIONS)).toHaveLength(11);
    expect(SIGMA1_PARAM_KEYS).toHaveLength(26);
    expect([...SEARCHABLE_PARAM_KEYS].sort()).toEqual([...SEARCHABLE_PARAM_KEYS]);
  });

  it("screenGridFor refuses an excluded key at RUNTIME, quoting that key's own reason", () => {
    // The type already forbids this call — but `loadSurvivors` reads STRINGS
    // out of a JSON artifact, so the type system is not the only entry path,
    // and a stale survivors file from before this change must explain itself
    // rather than merely fail.
    for (const key of Object.keys(SEARCH_EXCLUSIONS) as ExcludedParamKey[]) {
      const reason = SEARCH_EXCLUSIONS[key];
      expect(() => screenGridFor(key as never, 5)).toThrow(new RegExp(key));
      expect(() => screenGridFor(key as never, 5)).toThrow(
        new RegExp(reason.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      );
    }
  });
});

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
