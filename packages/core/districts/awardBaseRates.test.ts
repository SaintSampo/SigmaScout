/**
 * Pure, synthetic, corpus-free tests for the award vocabulary module. The per
 * team base rate tables and their lookup were deleted in quick task 261014-qje
 * (replaced by the one award slate, `awardSlate.ts`); these tests cover the
 * exports that remain.
 */
import { describe, expect, it } from "vitest";
import {
  awardPointsBucketIndex,
  AWARD_POINT_SUPPORT,
  cellKey,
  DECORATION_BUCKETS,
  decorationBucket,
  DISTRICT_POINT_AWARD_VALUES,
  MIN_CELL_OBSERVATIONS,
  ROOKIE_STATES,
  rookieStateFor,
} from "./awardBaseRates.js";

describe("decorationBucket", () => {
  it("maps 0 to none, 1 and 2 to one-or-two, 3 and up to three-or-more", () => {
    expect(decorationBucket(0)).toBe("none");
    expect(decorationBucket(1)).toBe("one-or-two");
    expect(decorationBucket(2)).toBe("one-or-two");
    expect(decorationBucket(3)).toBe("three-or-more");
    expect(decorationBucket(40)).toBe("three-or-more");
  });

  it("pins both boundaries explicitly — an off-by-one there relabels a third of the population", () => {
    // 0 to 1
    expect(decorationBucket(0)).not.toBe(decorationBucket(1));
    // 2 to 3
    expect(decorationBucket(2)).not.toBe(decorationBucket(3));
  });
});

describe("DISTRICT_POINT_AWARD_VALUES (quick task 261014-mii, M-01)", () => {
  it("is exactly the M-01 map, asserted by equality on its sorted entries", () => {
    expect([...DISTRICT_POINT_AWARD_VALUES].sort((a, b) => a[0] - b[0])).toEqual([
      [0, 10],
      [9, 8],
      [10, 8],
      [11, 5],
      [13, 5],
      [15, 5],
      [16, 5],
      [17, 5],
      [18, 5],
      [20, 5],
      [21, 5],
      [22, 5],
      [27, 5],
      [29, 5],
      [30, 5],
      [71, 5],
      [82, 5],
      [83, 5],
    ]);
  });

  it("leaves out Winner, Finalist, Woodie Flowers, Dean's List, Volunteer, Highest Rookie Seed, Wildcard and Impact Finalist", () => {
    for (const type of [1, 2, 3, 4, 5, 14, 68, 69]) expect(DISTRICT_POINT_AWARD_VALUES.has(type), `type ${type}`).toBe(false);
  });
});

describe("the point support and its bucket index", () => {
  it("is exactly [0, 5, 8, 10, 13, 15], with index 5 meaning 15 or more", () => {
    expect([...AWARD_POINT_SUPPORT]).toEqual([0, 5, 8, 10, 13, 15]);
  });

  it("maps every support value to its own index, and anything at or above 15 to the top bin", () => {
    expect(awardPointsBucketIndex(0)).toBe(0);
    expect(awardPointsBucketIndex(5)).toBe(1);
    expect(awardPointsBucketIndex(8)).toBe(2);
    expect(awardPointsBucketIndex(10)).toBe(3);
    expect(awardPointsBucketIndex(13)).toBe(4);
    expect(awardPointsBucketIndex(15)).toBe(5);
    expect(awardPointsBucketIndex(23)).toBe(5);
  });

  it("returns the honest unmodelled signal for a value not in the support and below 15 — never the nearest bucket", () => {
    expect(awardPointsBucketIndex(7)).toBeUndefined();
    expect(awardPointsBucketIndex(3)).toBeUndefined();
    expect(awardPointsBucketIndex(Number.NaN)).toBeUndefined();
  });
});

describe("rookieStateFor", () => {
  it("is rookie in the team's own rookie year, veteran after it", () => {
    expect(rookieStateFor(2026, 2026)).toBe("rookie");
    expect(rookieStateFor(2019, 2026)).toBe("veteran");
  });

  it("is its OWN unknown state for a null or undefined rookie_year, and unknown is NOT veteran", () => {
    expect(rookieStateFor(null, 2026)).toBe("unknown");
    expect(rookieStateFor(undefined, 2026)).toBe("unknown");
    expect(rookieStateFor(null, 2026)).not.toBe("veteran");
  });
});

describe("the class vocabulary", () => {
  it("keys a class as bucket|rookie state, over the three buckets and three rookie states in print order", () => {
    expect(DECORATION_BUCKETS).toEqual(["none", "one-or-two", "three-or-more"]);
    expect(ROOKIE_STATES).toEqual(["rookie", "veteran", "unknown"]);
    expect(cellKey("one-or-two", "rookie")).toBe("one-or-two|rookie");
  });

  it("states a class only on 100 observations or more", () => {
    expect(MIN_CELL_OBSERVATIONS).toBe(100);
  });
});
