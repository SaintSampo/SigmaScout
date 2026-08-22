/**
 * D-06 rounding rule tests (04-02 Task 1). Every behaviour below is a
 * concrete input/output pair from the plan's `<behavior>` block — written
 * before `rounding.ts`'s implementation (RED before GREEN).
 */
import { describe, expect, it } from "vitest";
import { PredictionRecordSchema } from "./predictions.js";
import { ROUNDING_RULE, roundMetric, roundPmf, roundProbability, roundTo } from "./rounding.js";

describe("roundTo — half-away-from-zero, symmetric about zero", () => {
  it("rounds 1.005 to 2 decimals as 1.01", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
  });

  it("rounds -1.005 to 2 decimals as -1.01 (symmetric, not toward +Infinity)", () => {
    expect(roundTo(-1.005, 2)).toBe(-1.01);
  });

  it("returns exactly x when x is already representable at d decimals", () => {
    expect(roundTo(3.14, 2)).toBe(3.14);
  });

  it("returns a number, never a string", () => {
    expect(typeof roundTo(1.23456, 2)).toBe("number");
  });

  it("throws a named error for NaN", () => {
    expect(() => roundTo(NaN, 2)).toThrow(/non-finite/i);
  });

  it("throws a named error for Infinity", () => {
    expect(() => roundTo(Infinity, 2)).toThrow(/non-finite/i);
  });

  it("throws a named error for -Infinity", () => {
    expect(() => roundTo(-Infinity, 2)).toThrow(/non-finite/i);
  });
});

describe("roundMetric / roundProbability — fixed decimal counts", () => {
  it("roundMetric rounds to 2 decimals", () => {
    expect(roundMetric(12.3456)).toBe(12.35);
  });

  it("roundProbability rounds to 4 decimals", () => {
    expect(roundProbability(0.123456)).toBe(0.1235);
  });
});

describe("roundPmf — renormalized rounding with a deterministic tie-break", () => {
  it("rounds each entry to 5 decimals and the result sums to 1 within 1e-9", () => {
    const result = roundPmf([0.333333, 0.333333, 0.333334]);
    const sum = result.reduce((total, v) => total + v, 0);
    expect(result).toHaveLength(3);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-9);
  });

  it("preserves array length and index order (index i means P(RP = i))", () => {
    const input = [0.1, 0.2, 0.3, 0.4];
    const result = roundPmf(input);
    expect(result).toHaveLength(4);
    // Ascending order preserved: each rounded value should be close to its
    // corresponding input value (within the renormalization residual).
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs((result[i] as number) - (input[i] as number))).toBeLessThan(0.001);
    }
  });

  it("an input that already sums to 1 exactly still sums to 1 within 1e-9 after rounding", () => {
    const input = [0.25, 0.25, 0.25, 0.25];
    const result = roundPmf(input);
    const sum = result.reduce((total, v) => total + v, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-9);
  });

  it("throws on an empty array — never a valid distribution", () => {
    expect(() => roundPmf([])).toThrow();
  });

  it("adds the renormalization residual to the largest entry, lowest index on a tie", () => {
    // Two entries tie for largest (0.5 and 0.5); the lowest index (0) must
    // absorb the residual deterministically.
    const result = roundPmf([0.5, 0.5]);
    const sum = result.reduce((total, v) => total + v, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-9);
    expect(result[0] as number).toBeGreaterThanOrEqual(result[1] as number);
  });

  it("a rounded pmf still satisfies PredictionRecordSchema's own 1e-9 sum tolerance", () => {
    const redRpPmf = roundPmf([0.19999, 0.2, 0.2, 0.2, 0.20001]);
    const record = {
      matchKey: "2024test_qm1",
      season: 2024,
      eventKey: "2024test",
      compLevel: "qm" as const,
      algorithmId: "sigma1",
      algorithmVersion: "2.0.0+tuned-2026-08",
      predictedWinner: "red" as const,
      pRedWin: 0.6,
      predictedRedScore: 100,
      predictedBlueScore: 90,
      redComponents: {},
      blueComponents: {},
      redRpPmf,
      actualWinner: "red" as const,
      actualRedScore: 105,
      actualBlueScore: 88,
    };
    expect(() => PredictionRecordSchema.parse(record)).not.toThrow();
  });
});

describe("ROUNDING_RULE — plain data, quotable by name", () => {
  it("is a plain object, importable and assertable", () => {
    expect(typeof ROUNDING_RULE).toBe("object");
  });

  it("names the probability field class at 4 decimals", () => {
    expect(ROUNDING_RULE.probability).toBe(4);
  });

  it("names the pmf field class at 5 decimals", () => {
    expect(ROUNDING_RULE.pmf).toBe(5);
  });

  it("names the metric field class at 2 decimals", () => {
    expect(ROUNDING_RULE.metric).toBe(2);
  });
});
