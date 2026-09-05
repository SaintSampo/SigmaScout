/**
 * D-1/D-4/D-5's pure unit tests for the elimination-match mechanisms
 * (ELIM-R, quick task 260904-v9n): the shared `isElimination` predicate is
 * exhaustive over `CompLevel`, and `elimNoiseFactor` returns exactly `1` on
 * the qualification branch (never a computed value that happens to equal
 * it) and the raw multiplier verbatim on every elimination branch.
 */
import { describe, expect, it } from "vitest";
import { elimNoiseFactor, isElimination } from "./elim.js";
import { DEFAULT_SIGMA1_PARAMS } from "./params.js";
import { resolveSigma1Params, type Sigma1ResolvedParams } from "./scale.js";
import { emptyExpandingStats } from "../../scoring/expandingStats.js";
import type { CompLevel } from "../types.js";

/** D-T1: every Sigma1 internal takes RESOLVED params. `elimObservationNoiseMultiplier` is dimensionless and passes through `resolveSigma1Params` unchanged, so resolving at the cold-start scale changes nothing this file exercises. */
const RESOLVED_DEFAULTS: Sigma1ResolvedParams = resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, emptyExpandingStats());

const ALL_COMP_LEVELS: readonly CompLevel[] = ["qm", "ef", "qf", "sf", "f"];
const ELIMINATION_COMP_LEVELS: readonly CompLevel[] = ["ef", "qf", "sf", "f"];

describe("isElimination", () => {
  it.each(ALL_COMP_LEVELS)('is true for exactly "ef" | "qf" | "sf" | "f" and false for "qm" (%s)', (compLevel) => {
    expect(isElimination(compLevel)).toBe(compLevel !== "qm");
  });
});

describe("elimNoiseFactor", () => {
  it.each([1, 0.25, 16, 1e6])(
    'returns EXACTLY 1 for compLevel "qm" regardless of elimObservationNoiseMultiplier (multiplier=%s)',
    (multiplier) => {
      const params: Sigma1ResolvedParams = { ...RESOLVED_DEFAULTS, elimObservationNoiseMultiplier: multiplier };
      expect(elimNoiseFactor("qm", params)).toBe(1);
    }
  );

  it.each(ELIMINATION_COMP_LEVELS)("returns params.elimObservationNoiseMultiplier verbatim for %s", (compLevel) => {
    const params: Sigma1ResolvedParams = { ...RESOLVED_DEFAULTS, elimObservationNoiseMultiplier: 8 };
    expect(elimNoiseFactor(compLevel, params)).toBe(8);
  });

  it("at the default multiplier (1), an elim observation's factor is exactly 1 too — inert by default", () => {
    for (const compLevel of ELIMINATION_COMP_LEVELS) {
      expect(elimNoiseFactor(compLevel, RESOLVED_DEFAULTS)).toBe(1);
    }
  });
});
