import { describe, expect, it } from "vitest";
import { tierForPercentile } from "./tiers.js";

// D-04/D-17's locked boundary contract: half-open low, closed at the very
// top. Every cut is asserted at the cut itself AND one step either side, per
// 06-07-PLAN.md Task 1's acceptance criteria.

describe("tierForPercentile", () => {
  it("returns undefined when no percentile was published — never a coerced tier", () => {
    expect(tierForPercentile(undefined)).toBeUndefined();
  });

  it.each([
    [0, "common"],
    [49.9, "common"],
    [50, "rare"],
    [74.9, "rare"],
    [75, "epic"],
    [94.9, "epic"],
    [95, "legendary"],
    [100, "legendary"],
  ] as const)("classifies percentile %s as %s", (percentile, expected) => {
    expect(tierForPercentile(percentile)).toBe(expected);
  });

  it.each([-0.1, 100.1])(
    "returns undefined for an out-of-range percentile (%s) rather than clamping — an out-of-range value can only mean a pipeline defect",
    (percentile) => {
      expect(tierForPercentile(percentile)).toBeUndefined();
    },
  );
});
