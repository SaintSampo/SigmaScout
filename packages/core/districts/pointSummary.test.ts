/**
 * The blue-cell rules' own tests — pure, synthetic, no corpus. Every expected
 * value below is hand-computed from the estimator's own definition rather than
 * lifted from the implementation's output, because the whole point of this
 * module is that ONE rule produces the numbers on every surface.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { continuousQuantile } from "../algorithms/simulation/continuousQuantile.js";
import {
  chanceOfAnyPoints,
  conditionalMedianGivenPoints,
  InvalidDenominatorError,
  POINT_CELL_CHANCE_FORM_THRESHOLD,
  pointCellSummary,
  pointPercentiles,
  pointQuantile,
} from "./pointSummary.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 400 draws at exactly 3 points and 600 at exactly 4 — the points-axis twin of `rankRows.test.ts`'s own continuous-median pin. */
const SPLIT_3_4 = (() => {
  const histogram = new Int32Array(11);
  histogram[3] = 400;
  histogram[4] = 600;
  return histogram;
})();

/** Mass at 0, 5 and 10 — the lump-at-zero shape three of the four categories actually have. */
const LUMP_AT_ZERO = (() => {
  const histogram = new Int32Array(11);
  histogram[0] = 500;
  histogram[5] = 200;
  histogram[10] = 300;
  return histogram;
})();

function pointMassAt(value: number, length: number, draws: number): Int32Array {
  const histogram = new Int32Array(length);
  histogram[value] = draws;
  return histogram;
}

describe("pointQuantile — delegates to the promoted estimator and shifts by exactly one", () => {
  it.each([0.1, 0.5, 0.9])(
    "p=%s: the points quantile equals the estimator's value on the same input minus one",
    (p) => {
      for (const histogram of [SPLIT_3_4, LUMP_AT_ZERO, pointMassAt(7, 11, 1_000)]) {
        expect(pointQuantile(histogram, p, 1_000)).toBe(continuousQuantile(histogram, p, 1_000) - 1);
      }
    }
  );

  it("is never below -0.5 and never above the histogram length minus 0.5", () => {
    for (const histogram of [SPLIT_3_4, LUMP_AT_ZERO, new Int32Array(11)]) {
      for (const p of [0, 0.1, 0.5, 0.9, 1]) {
        const value = pointQuantile(histogram, p, 1_000);
        expect(value).toBeGreaterThanOrEqual(-0.5);
        expect(value).toBeLessThanOrEqual(histogram.length - 0.5);
      }
    }
  });

  it("400 draws at 3 points and 600 at 4 gives a median of 3.667 and NOT 4 — the continuous edge, not an integer snap", () => {
    expect(pointQuantile(SPLIT_3_4, 0.5, 1_000)).toBeCloseTo(3.666_667, 6);
    expect(pointQuantile(SPLIT_3_4, 0.5, 1_000)).not.toBe(4);
  });

  it("a locked histogram is not zero-width: all mass at one value gives exactly value-0.4, value and value+0.4, the sketch-005 defect reproduced as FIXED", () => {
    const histogram = pointMassAt(7, 11, 1_000);
    const { p10, p50, p90 } = pointPercentiles(histogram, 1_000);
    expect(p10).toBeCloseTo(6.6, 10);
    expect(p50).toBeCloseTo(7, 10);
    expect(p90).toBeCloseTo(7.4, 10);
    expect(p90 - p10).toBeCloseTo(0.8, 10);
    expect(p10).not.toBe(p90);
  });

  it("the three-percentile helper is the estimator called once per percentile, no second derivation", () => {
    const { p10, p50, p90 } = pointPercentiles(LUMP_AT_ZERO, 1_000);
    expect(p10).toBe(pointQuantile(LUMP_AT_ZERO, 0.1, 1_000));
    expect(p50).toBe(pointQuantile(LUMP_AT_ZERO, 0.5, 1_000));
    expect(p90).toBe(pointQuantile(LUMP_AT_ZERO, 0.9, 1_000));
  });
});

describe("chanceOfAnyPoints", () => {
  it("is exactly 1 with no mass at the zero index and exactly 0 with all mass there", () => {
    expect(chanceOfAnyPoints(SPLIT_3_4, 1_000)).toBe(1);
    expect(chanceOfAnyPoints(pointMassAt(0, 11, 1_000), 1_000)).toBe(0);
  });

  it("a hand-built split gives the hand-computed fraction to within 1e-12, never a rounded value", () => {
    expect(Math.abs(chanceOfAnyPoints(LUMP_AT_ZERO, 1_000) - 0.5)).toBeLessThan(1e-12);
    const uneven = new Int32Array(11);
    uneven[0] = 723;
    uneven[5] = 277;
    expect(Math.abs(chanceOfAnyPoints(uneven, 1_000) - 277 / 1_000)).toBeLessThan(1e-12);
  });

  it("is never outside 0 through 1", () => {
    for (const histogram of [SPLIT_3_4, LUMP_AT_ZERO, pointMassAt(0, 11, 1_000)]) {
      const chance = chanceOfAnyPoints(histogram, 1_000);
      expect(chance).toBeGreaterThanOrEqual(0);
      expect(chance).toBeLessThanOrEqual(1);
    }
  });
});

describe("conditionalMedianGivenPoints", () => {
  it("is the median of the distribution restricted to the nonzero support, hand-computed", () => {
    // Restricted mass is 500: 200 at 5 points and 300 at 10. The median target
    // is 250, which falls 50/300 of the way into the bin at 10 points, so the
    // continuous edge is 10 + 1 - 0.5 + 1/6, minus one for the points axis.
    expect(conditionalMedianGivenPoints(LUMP_AT_ZERO, 1_000)).toBeCloseTo(9.666_667, 6);
  });

  it("returns undefined for an all-mass-at-zero histogram — the honest null, never 0 and never NaN", () => {
    const result = conditionalMedianGivenPoints(pointMassAt(0, 11, 1_000), 1_000);
    expect(result).toBeUndefined();
    expect(result).not.toBe(0);
    expect(Number.isNaN(result as number)).toBe(false);
  });

  it("equals the unconditional median when no mass sits at zero at all", () => {
    expect(conditionalMedianGivenPoints(SPLIT_3_4, 1_000)).toBeCloseTo(pointQuantile(SPLIT_3_4, 0.5, 1_000), 10);
  });
});

describe("pointCellSummary — CONTEXT's two forms and the 0.995 fallback", () => {
  it("the threshold is an exported named constant, read at the comparison rather than written as a literal", () => {
    expect(POINT_CELL_CHANCE_FORM_THRESHOLD).toBe(0.995);
  });

  it("just BELOW the threshold the result is the chance form, carrying the chance and the conditional median", () => {
    const histogram = new Int32Array(11);
    histogram[0] = 6;
    histogram[5] = 994;
    const summary = pointCellSummary(histogram, 1_000);
    expect(chanceOfAnyPoints(histogram, 1_000)).toBeLessThan(POINT_CELL_CHANCE_FORM_THRESHOLD);
    expect(summary.form).toBe("chance");
    if (summary.form !== "chance") throw new Error("unreachable");
    expect(summary.chance).toBeCloseTo(0.994, 12);
    expect(summary.conditionalMedian).toBeCloseTo(5, 10);
  });

  it("AT the threshold value itself the result is the median form, carrying the three percentiles", () => {
    const histogram = new Int32Array(11);
    histogram[0] = 5;
    histogram[5] = 995;
    expect(chanceOfAnyPoints(histogram, 1_000)).toBe(POINT_CELL_CHANCE_FORM_THRESHOLD);
    const summary = pointCellSummary(histogram, 1_000);
    expect(summary.form).toBe("median");
    if (summary.form !== "median") throw new Error("unreachable");
    expect(summary.percentiles.p50).toBeCloseTo(pointQuantile(histogram, 0.5, 1_000), 10);
  });

  it("a chance of exactly 0 stays in the chance form with an UNDEFINED conditional median — an event that never happens has no typical amount", () => {
    const summary = pointCellSummary(pointMassAt(0, 11, 1_000), 1_000);
    expect(summary.form).toBe("chance");
    if (summary.form !== "chance") throw new Error("unreachable");
    expect(summary.chance).toBe(0);
    expect(summary.conditionalMedian).toBeUndefined();
  });
});

describe("pointSummary — numbers and a form, never a rendered string", () => {
  it("no exported helper returns a string", () => {
    const returns: unknown[] = [
      pointQuantile(LUMP_AT_ZERO, 0.5, 1_000),
      pointPercentiles(LUMP_AT_ZERO, 1_000),
      chanceOfAnyPoints(LUMP_AT_ZERO, 1_000),
      conditionalMedianGivenPoints(LUMP_AT_ZERO, 1_000),
      pointCellSummary(LUMP_AT_ZERO, 1_000),
    ];
    for (const value of returns) expect(typeof value).not.toBe("string");
  });

  it("the module carries no percent sign and none of the sketch's cell copy — the words belong to 10-07", () => {
    const source = readFileSync(resolve(HERE, "pointSummary.ts"), "utf8");
    expect(source).not.toContain("%");
    for (const word of ["picked", "likely"]) {
      expect(source.toLowerCase()).not.toContain(word);
    }
  });

  it("every helper throws InvalidDenominatorError on a zero or negative denominator rather than dividing", () => {
    for (const denominator of [0, -1, Number.NaN]) {
      expect(() => pointQuantile(LUMP_AT_ZERO, 0.5, denominator)).toThrow(InvalidDenominatorError);
      expect(() => pointPercentiles(LUMP_AT_ZERO, denominator)).toThrow(InvalidDenominatorError);
      expect(() => chanceOfAnyPoints(LUMP_AT_ZERO, denominator)).toThrow(InvalidDenominatorError);
      expect(() => conditionalMedianGivenPoints(LUMP_AT_ZERO, denominator)).toThrow(InvalidDenominatorError);
      expect(() => pointCellSummary(LUMP_AT_ZERO, denominator)).toThrow(InvalidDenominatorError);
    }
  });

  it("imports exactly one module, the promoted estimator — this leaf owns no math of its own", () => {
    const source = readFileSync(resolve(HERE, "pointSummary.ts"), "utf8");
    const importLines = source.split("\n").filter((line) => line.startsWith("import"));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toContain("continuousQuantile.js");
  });
});
