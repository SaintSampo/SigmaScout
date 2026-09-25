/**
 * The PROMOTION's own proof (10-04 Task 1), beyond the shipped
 * `apps/web/src/lib/simQuantile.test.ts` which keeps running unchanged
 * through the re-export and is the move's regression oracle.
 *
 * Three things this file pins that the shipped test cannot:
 *   1. There is exactly ONE function object, not two that happen to agree.
 *   2. The estimator is scale-free in its denominator, which is what licenses
 *      `pointSummary.ts` and the grand-total convolution to pass a
 *      pre-normalised pmf with a denominator of 1 rather than raw counts.
 *   3. The `ArrayLike` contract holds for the `Int32Array` histograms the
 *      district ledger produces.
 */
import { describe, expect, it } from "vitest";
import { continuousQuantile } from "./continuousQuantile.js";
import { continuousQuantile as webContinuousQuantile } from "../../../../apps/web/src/lib/simQuantile.js";

const SHAPES: readonly (readonly number[])[] = [
  [996, 3, 1, 0, 0, 0, 0, 0],
  [3, 666, 330, 0, 1, 0, 0, 0],
  [1, 330, 574, 87, 8, 0, 0, 0],
];

describe("continuousQuantile — one implementation, promoted to packages/core", () => {
  it("the promoted export and apps/web/src/lib/simQuantile.js's export are the SAME function object", () => {
    expect(webContinuousQuantile).toBe(continuousQuantile);
  });
});

describe("continuousQuantile — counts and a normalised pmf agree", () => {
  it.each([0.1, 0.5, 0.9])(
    "p=%s: raw counts over `draws` equals counts/draws over a denominator of 1, to within 1e-12, for every shape",
    (p) => {
      for (const shape of SHAPES) {
        const draws = shape.reduce((sum, v) => sum + v, 0);
        const normalised = shape.map((v) => v / draws);
        const fromCounts = continuousQuantile(shape, p, draws);
        const fromPmf = continuousQuantile(normalised, p, 1);
        expect(Math.abs(fromCounts - fromPmf)).toBeLessThan(1e-12);
      }
    }
  );
});

describe("continuousQuantile — the ArrayLike contract", () => {
  it("an Int32Array and a plain array holding the same values return the identical value", () => {
    for (const shape of SHAPES) {
      const draws = shape.reduce((sum, v) => sum + v, 0);
      const typed = Int32Array.from(shape);
      expect(continuousQuantile(typed, 0.1, draws)).toBe(continuousQuantile(shape, 0.1, draws));
      expect(continuousQuantile(typed, 0.5, draws)).toBe(continuousQuantile(shape, 0.5, draws));
      expect(continuousQuantile(typed, 0.9, draws)).toBe(continuousQuantile(shape, 0.9, draws));
    }
  });
});
