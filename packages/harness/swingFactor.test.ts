import { describe, expect, it } from "vitest";
import {
  allianceSwingBandVariance,
  SwingFactorAccumulator,
  SWING_FACTOR_HALF_LIFE_MATCHES,
  SWING_FACTOR_SCALE,
  swingDecayFor,
  swingFactorFromDeviations,
} from "./swingFactor.js";

describe("swingFactorFromDeviations", () => {
  it("returns undefined below two observations — one point cannot separate model bias from robot swing", () => {
    expect(swingFactorFromDeviations([])).toBeUndefined();
    expect(swingFactorFromDeviations([7])).toBeUndefined();
  });

  it("returns exactly 0 for identical deviations — a model that is CONSISTENTLY wrong describes a consistent robot", () => {
    for (const k of [2, 5, 20]) {
      expect(swingFactorFromDeviations(Array.from({ length: k }, () => 3))).toBeCloseTo(0, 10);
    }
  });

  it("is invariant to a constant shift, which is what makes it a statement about the ROBOT and not the model", () => {
    const base = [4, -2, 7, 1, -3];
    // +250 is roughly OPR's measured Einstein bias; it must not move the number.
    expect(swingFactorFromDeviations(base.map((d) => d + 250))).toBeCloseTo(swingFactorFromDeviations(base) as number, 8);
  });

  it("weights recent matches more: the same large deviation counts for more when it is newer", () => {
    const recent = swingFactorFromDeviations([1, 1, 1, 1, 1, 1, 10]) as number;
    const old = swingFactorFromDeviations([10, 1, 1, 1, 1, 1, 1]) as number;
    expect(recent).toBeGreaterThan(old);
  });

  it("matches an independently computed weighted-unbiased variance", () => {
    const decay = swingDecayFor(SWING_FACTOR_HALF_LIFE_MATCHES);
    const [older, newer] = [2, 10];
    const sumW = decay + 1;
    const mean = (decay * older + newer) / sumW;
    const numerator = decay * (older - mean) ** 2 + (newer - mean) ** 2;
    const denominator = sumW - (decay * decay + 1) / sumW;
    expect(swingFactorFromDeviations([older, newer])).toBeCloseTo(SWING_FACTOR_SCALE * Math.sqrt(numerator / denominator), 10);
  });

  it("throws on a non-finite deviation rather than coercing it to a flattering zero", () => {
    expect(() => swingFactorFromDeviations([1, Number.NaN])).toThrow(/non-finite/);
  });
});

describe("allianceSwingBandVariance", () => {
  const swings = new Map([["a", 10], ["b", 10], ["c", 10]]);

  it("combines by summing SQUARES — three robots at ±10 give ±17.32, never ±30", () => {
    expect(Math.sqrt(allianceSwingBandVariance(["a", "b", "c"], swings) as number)).toBeCloseTo(17.3205, 4);
  });

  it("returns undefined when any member is missing — never a narrower band from a partial sum", () => {
    expect(allianceSwingBandVariance(["a", "b", "unknown"], swings)).toBeUndefined();
    expect(allianceSwingBandVariance([], swings)).toBeUndefined();
  });
});

describe("SwingFactorAccumulator — walk-forward", () => {
  const RED = ["frc1", "frc2", "frc3"];

  it("has no band before two observations, and one after", () => {
    const acc = new SwingFactorAccumulator();
    expect(acc.bandVarianceFor(RED)).toBeUndefined();
    acc.fold(RED, 130, 100);
    expect(acc.bandVarianceFor(RED)).toBeUndefined();
    acc.fold(RED, 70, 100);
    expect(acc.bandVarianceFor(RED)).toBeGreaterThan(0);
  });

  it("never lets a match inform its own band — the project's predict-before-update rule", () => {
    const acc = new SwingFactorAccumulator();
    acc.fold(RED, 130, 100);
    acc.fold(RED, 70, 100);
    const beforeWildMatch = acc.bandVarianceFor(RED);
    acc.fold(RED, 99999, 100); // a wild result, folded AFTER the read above
    expect(beforeWildMatch).toBeLessThan(acc.bandVarianceFor(RED) as number);
  });

  it("divides an alliance residual by roster size, so a 2-team alliance is not read like a 3-team one", () => {
    const pair = new SwingFactorAccumulator();
    pair.fold(["frc1", "frc2"], 130, 100);
    pair.fold(["frc1", "frc2"], 70, 100);
    expect(pair.swingFor("frc1")).toBeCloseTo(swingFactorFromDeviations([15, -15]) as number, 10);
  });

  it("carries across events rather than resetting, so a team's second event starts from what it showed at its first", () => {
    const acc = new SwingFactorAccumulator();
    acc.fold(RED, 130, 100);
    acc.fold(RED, 70, 100);
    // No reset call exists by design; a later fold keeps building on the same history.
    expect(acc.swingFor("frc1")).toBeDefined();
  });

  it("ignores an unplayed or malformed row instead of throwing or consuming a decay step", () => {
    const acc = new SwingFactorAccumulator();
    acc.fold(RED, 130, 100);
    acc.fold(RED, Number.NaN, 100);
    acc.fold([], 130, 100);
    acc.fold(RED, 70, 100);
    expect(acc.swingFor("frc1")).toBeCloseTo(swingFactorFromDeviations([10, -10]) as number, 10);
  });

  it("is algorithm-agnostic: a WORSE model's larger residuals simply produce a wider band", () => {
    const good = new SwingFactorAccumulator();
    const bad = new SwingFactorAccumulator();
    good.fold(RED, 130, 100);
    good.fold(RED, 70, 100);
    bad.fold(RED, 400, 100);
    bad.fold(RED, -200, 100);
    expect(bad.bandVarianceFor(RED) as number).toBeGreaterThan(good.bandVarianceFor(RED) as number);
  });
});
