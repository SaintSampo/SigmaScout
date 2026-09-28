import { describe, expect, it } from "vitest";
import { tierFromCuts } from "../../../../packages/harness/tierCuts.js";
import { TOTAL_KEY } from "./metricKeys";
import type { SeasonTierCuts } from "../../../../packages/harness/pageArtifacts.js";
import { estimateCombinedTier } from "./allianceTierApproximation";

const CUTS: SeasonTierCuts = { [TOTAL_KEY]: { cuts: [20, 30, 40] } };

describe("estimateCombinedTier — the season cut rule", () => {
  it("returns undefined when tierCuts is undefined", () => {
    expect(estimateCombinedTier(90, undefined)).toBeUndefined();
  });

  it("returns undefined when tierCuts is present but has no Total entry", () => {
    const noTotal: SeasonTierCuts = { autoPoints: { cuts: [1, 2, 3] } };
    expect(estimateCombinedTier(90, noTotal)).toBeUndefined();
  });

  it("boundary exactness, higher is better", () => {
    expect(estimateCombinedTier(60, CUTS)).toBe("rare"); // 20 exactly on the Rare cut
    expect(estimateCombinedTier(59.97, CUTS)).toBe("common"); // per team 19.99
    expect(estimateCombinedTier(90, CUTS)).toBe("epic"); // 30 exactly
    expect(estimateCombinedTier(89.97, CUTS)).toBe("rare"); // per team 29.99
    expect(estimateCombinedTier(120, CUTS)).toBe("legendary"); // 40 exactly
    expect(estimateCombinedTier(119.97, CUTS)).toBe("epic"); // per team 39.99
  });

  it("rounding onto a cut: 89.988 (per team 29.996, rounds to 30.00) is epic", () => {
    expect(estimateCombinedTier(89.988, CUTS)).toBe("epic");
  });

  it("far above and far below the cuts, no roster to clamp to", () => {
    expect(estimateCombinedTier(300, CUTS)).toBe("legendary");
    expect(estimateCombinedTier(0, CUTS)).toBe("common");
  });

  it("lower is better via the entry's own marker, not an assumption", () => {
    const lowerCuts: SeasonTierCuts = { [TOTAL_KEY]: { cuts: [40, 30, 20], lower: true } };
    expect(estimateCombinedTier(60, lowerCuts)).toBe("legendary");
    expect(estimateCombinedTier(90, lowerCuts)).toBe("epic");
    expect(estimateCombinedTier(120, lowerCuts)).toBe("rare");
    expect(estimateCombinedTier(150, lowerCuts)).toBe("common");
    // The same combined value against the higher-is-better CUTS gives a
    // different tier — direction comes from the entry, not an assumption.
    expect(estimateCombinedTier(60, CUTS)).toBe("rare");
  });

  it("the divide by 3 matches tierFromCuts on the per-team value directly, for a spread of per-team values", () => {
    for (const v of [0, 19.99, 20, 25, 30, 39.99, 40, 55]) {
      expect(estimateCombinedTier(3 * v, CUTS)).toBe(tierFromCuts(CUTS[TOTAL_KEY], v));
    }
  });
});
