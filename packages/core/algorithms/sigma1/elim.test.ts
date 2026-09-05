/**
 * D-1/D-4/D-5's pure unit tests for the elimination-match mechanisms
 * (ELIM-R, quick task 260904-v9n): the shared `isElimination` predicate is
 * exhaustive over `CompLevel`, and `elimNoiseFactor` returns exactly `1` on
 * the qualification branch (never a computed value that happens to equal
 * it) and the raw multiplier verbatim on every elimination branch.
 */
import { describe, expect, it } from "vitest";
import {
  elimNoiseFactor,
  elimScoreOffsetFor,
  emptyElimScoreOffset,
  foldElimScoreOffset,
  isElimination,
  type ElimScoreOffset,
} from "./elim.js";
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

describe("emptyElimScoreOffset", () => {
  it("returns a never-observed cold start: value 0, count 0", () => {
    expect(emptyElimScoreOffset()).toEqual({ value: 0, count: 0 });
  });
});

describe("foldElimScoreOffset", () => {
  it("returns (1 - alpha) * prior.value + alpha * residual, with count incremented", () => {
    const prior: ElimScoreOffset = { value: 2, count: 3 };
    const next = foldElimScoreOffset(prior, 10, 0.25);
    expect(next.value).toBeCloseTo(0.75 * 2 + 0.25 * 10);
    expect(next.count).toBe(4);
  });

  it("is pure — returns a new object, never mutates prior", () => {
    const prior: ElimScoreOffset = { value: 0, count: 0 };
    const frozen = { ...prior };
    const next = foldElimScoreOffset(prior, 5, 0.5);
    expect(prior).toEqual(frozen);
    expect(next).not.toBe(prior);
  });

  it("a first fold from cold start lands exactly at the residual itself (0 prior, count 0 -> 1)", () => {
    const next = foldElimScoreOffset(emptyElimScoreOffset(), 7, 0.05);
    expect(next.value).toBeCloseTo(0.05 * 7);
    expect(next.count).toBe(1);
  });

  it("refuses a non-finite residual by throwing, mirroring foldInnovation/foldSwingObservation", () => {
    expect(() => foldElimScoreOffset(emptyElimScoreOffset(), Number.NaN, 0.05)).toThrow();
    expect(() => foldElimScoreOffset(emptyElimScoreOffset(), Number.POSITIVE_INFINITY, 0.05)).toThrow();
    expect(() => foldElimScoreOffset(emptyElimScoreOffset(), Number.NEGATIVE_INFINITY, 0.05)).toThrow();
  });
});

describe("elimScoreOffsetFor", () => {
  const LEARNED_OFFSET: ElimScoreOffset = { value: 12.5, count: 40 };

  it("returns EXACTLY 0 when elimScoreOffsetEnabled is false, regardless of compLevel or the accumulated value", () => {
    const disabled: Sigma1ResolvedParams = { ...RESOLVED_DEFAULTS, elimScoreOffsetEnabled: false };
    for (const compLevel of ALL_COMP_LEVELS) {
      expect(elimScoreOffsetFor(LEARNED_OFFSET, compLevel, disabled)).toBe(0);
    }
  });

  it('returns EXACTLY 0 for compLevel "qm" even when the flag is enabled', () => {
    const enabled: Sigma1ResolvedParams = { ...RESOLVED_DEFAULTS, elimScoreOffsetEnabled: true };
    expect(elimScoreOffsetFor(LEARNED_OFFSET, "qm", enabled)).toBe(0);
  });

  it("returns the accumulated value verbatim for an elimination compLevel when the flag is enabled", () => {
    const enabled: Sigma1ResolvedParams = { ...RESOLVED_DEFAULTS, elimScoreOffsetEnabled: true };
    for (const compLevel of ELIMINATION_COMP_LEVELS) {
      expect(elimScoreOffsetFor(LEARNED_OFFSET, compLevel, enabled)).toBe(12.5);
    }
  });
});
