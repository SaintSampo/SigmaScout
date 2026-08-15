/**
 * D-05/D-07/T-03-06/T-03-12's pure unit tests for the innovation-driven
 * per-team adaptation mechanism (plan 03-04): cold start is the "assume
 * correctly specified" prior, the clamp saturates at EXACT bounds (never
 * merely close), both disabled paths (`adaptationEnabled: false` and below
 * `adaptationMinObservations`) return exactly 1, and `foldInnovation` is a
 * pure fold that never mutates its input and refuses non-finite input
 * (T-03-12).
 */
import { describe, expect, it } from "vitest";
import { adaptationFactor, emptyInnovationStats, foldInnovation, type InnovationStats } from "./adaptation.js";
import { DEFAULT_SIGMA1_PARAMS, type Sigma1Params } from "./params.js";

const ENABLED_PARAMS: Sigma1Params = { ...DEFAULT_SIGMA1_PARAMS, adaptationEnabled: true };

describe("emptyInnovationStats", () => {
  it("cold-starts at exactly 1.0 with count 0", () => {
    expect(emptyInnovationStats()).toEqual({ meanSquaredNormalizedInnovation: 1, count: 0 });
  });

  it("gives a factor of exactly 1 even when adaptation is enabled, since count 0 is below adaptationMinObservations", () => {
    expect(adaptationFactor(emptyInnovationStats(), ENABLED_PARAMS)).toBe(1);
  });
});

describe("foldInnovation", () => {
  it("is pure — returns new stats, never mutates its input", () => {
    const stats = emptyInnovationStats();
    const frozen = { ...stats };
    const next = foldInnovation(stats, 2, 0.2);
    expect(stats).toEqual(frozen);
    expect(next).not.toBe(stats);
  });

  it("folds the SQUARE of the normalized innovation via EWMA", () => {
    const stats: InnovationStats = { meanSquaredNormalizedInnovation: 1, count: 0 };
    const next = foldInnovation(stats, 3, 0.5); // 3^2 = 9
    expect(next.meanSquaredNormalizedInnovation).toBeCloseTo(0.5 * 1 + 0.5 * 9);
    expect(next.count).toBe(1);
  });

  it("throws on a non-finite normalizedInnovation (T-03-12) — never a silent skip or coerced zero", () => {
    expect(() => foldInnovation(emptyInnovationStats(), Number.NaN, 0.2)).toThrow();
    expect(() => foldInnovation(emptyInnovationStats(), Number.POSITIVE_INFINITY, 0.2)).toThrow();
    expect(() => foldInnovation(emptyInnovationStats(), Number.NEGATIVE_INFINITY, 0.2)).toThrow();
  });
});

describe("adaptationFactor", () => {
  it("returns exactly 1 when adaptationEnabled is false, regardless of stats (D-08)", () => {
    const wildStats: InnovationStats = { meanSquaredNormalizedInnovation: 1000, count: 100 };
    expect(adaptationFactor(wildStats, { ...DEFAULT_SIGMA1_PARAMS, adaptationEnabled: false })).toBe(1);
  });

  it("returns exactly 1 below adaptationMinObservations", () => {
    const thinStats: InnovationStats = {
      meanSquaredNormalizedInnovation: 1000,
      count: ENABLED_PARAMS.adaptationMinObservations - 1,
    };
    expect(adaptationFactor(thinStats, ENABLED_PARAMS)).toBe(1);
  });

  it("saturates at EXACTLY adaptationMaxFactor for a run of large normalized innovations (T-03-06)", () => {
    let stats = emptyInnovationStats();
    for (let i = 0; i < 50; i++) stats = foldInnovation(stats, 100, ENABLED_PARAMS.adaptationEwmaAlpha);
    expect(adaptationFactor(stats, ENABLED_PARAMS)).toBe(ENABLED_PARAMS.adaptationMaxFactor);
  });

  it("saturates at EXACTLY adaptationMinFactor for a run of small normalized innovations (T-03-06)", () => {
    let stats = emptyInnovationStats();
    for (let i = 0; i < 50; i++) stats = foldInnovation(stats, 0.001, ENABLED_PARAMS.adaptationEwmaAlpha);
    expect(adaptationFactor(stats, ENABLED_PARAMS)).toBe(ENABLED_PARAMS.adaptationMinFactor);
  });

  it("stays within [adaptationMinFactor, adaptationMaxFactor] for a moderate stats value", () => {
    let stats = emptyInnovationStats();
    for (let i = 0; i < 10; i++) stats = foldInnovation(stats, 1.2, ENABLED_PARAMS.adaptationEwmaAlpha);
    const factor = adaptationFactor(stats, ENABLED_PARAMS);
    expect(factor).toBeGreaterThanOrEqual(ENABLED_PARAMS.adaptationMinFactor);
    expect(factor).toBeLessThanOrEqual(ENABLED_PARAMS.adaptationMaxFactor);
  });
});
