import { describe, expect, it } from "vitest";
import { resolveMetricTier, tierForPercentile } from "./tiers.js";
import type { SeasonTierCuts } from "../../../../packages/harness/pageArtifacts.js";

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

// Quick task 260920-qzf: resolveMetricTier prefers a published percentile
// over the cuts fallback in every case, falls back to cuts only when the
// percentile is absent, and never guesses when neither is available.

const TOTAL_CUTS: SeasonTierCuts = { total: { cuts: [31.17, 52.4, 88.05] } };

describe("resolveMetricTier", () => {
  it("prefers the published percentile when present, even when cuts would disagree", () => {
    // 60 -> "epic" under TOTAL_CUTS (>= 52.4), but the entry's own published
    // percentile (60) maps to "rare" — the percentile must win.
    const entry = { value: 60, percentile: 60 };
    expect(resolveMetricTier(entry, "total", TOTAL_CUTS)).toBe(tierForPercentile(60));
    expect(resolveMetricTier(entry, "total", TOTAL_CUTS)).toBe("rare");
  });

  it("resolves identically whether or not cuts are present, when a percentile is published", () => {
    const entry = { value: 90, percentile: 96 };
    expect(resolveMetricTier(entry, "total", TOTAL_CUTS)).toBe(resolveMetricTier(entry, "total", undefined));
    expect(resolveMetricTier(entry, "total", TOTAL_CUTS)).toBe("legendary");
  });

  it("falls back to the cuts-derived tier when the entry has a value but no percentile", () => {
    const entry = { value: 60 };
    expect(resolveMetricTier(entry, "total", TOTAL_CUTS)).toBe("epic");
  });

  it("resolves to no tier when the entry has a value, no percentile, and no cut entry for that name", () => {
    const entry = { value: 60 };
    expect(resolveMetricTier(entry, "phaseAuto", TOTAL_CUTS)).toBeUndefined();
    expect(resolveMetricTier(entry, "total", undefined)).toBeUndefined();
  });

  it("resolves to no tier for an absent metric entry, with or without cuts", () => {
    expect(resolveMetricTier(undefined, "total", TOTAL_CUTS)).toBeUndefined();
    expect(resolveMetricTier(undefined, "total", undefined)).toBeUndefined();
  });
});
