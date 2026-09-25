/**
 * Pure, synthetic, corpus-free tests for the shipped award base-rate module.
 * Runs everywhere, including CI, which is exactly where the corpus-guarded
 * reconciliation in `scripts/measureDistrictAwardBaseRates.test.ts` skips — so
 * these are what CI actually proves about the table's invariants.
 */
import { describe, expect, it } from "vitest";
import {
  anyAwardProbability,
  awardBaseRate,
  awardPointsBucketIndex,
  AWARD_POINT_SUPPORT,
  cellKey,
  conditionalMedianPoints,
  DECORATION_BUCKETS,
  decorationBucket,
  DISTRICT_AWARD_BASE_RATE_SEASONS,
  MIN_CELL_OBSERVATIONS,
  NON_JUDGED_AWARD_TYPES,
  ROOKIE_STATES,
  rookieStateFor,
  UnknownAwardBaseRateSeasonError,
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

describe("NON_JUDGED_AWARD_TYPES", () => {
  it("is exactly {1, 2, 14}, asserted by set equality so an addition or removal fails loudly", () => {
    expect([...NON_JUDGED_AWARD_TYPES].sort((a, b) => a - b)).toEqual([1, 2, 14]);
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

describe("every registered table is a well-formed pmf, across every season and every cell", () => {
  it("registers at least one season", () => {
    expect(DISTRICT_AWARD_BASE_RATE_SEASONS.length).toBeGreaterThan(0);
  });

  it("sums to 1 within 1e-9, has the support's length, and every entry is finite and in [0, 1]", () => {
    for (const season of DISTRICT_AWARD_BASE_RATE_SEASONS) {
      for (const bucket of DECORATION_BUCKETS) {
        for (const state of ROOKIE_STATES) {
          const result = awardBaseRate(season, bucket, state);
          expect(result.pmf.length, `${season} ${cellKey(bucket, state)}`).toBe(AWARD_POINT_SUPPORT.length);
          let sum = 0;
          for (const p of result.pmf) {
            expect(Number.isFinite(p), `${season} ${cellKey(bucket, state)}`).toBe(true);
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(1);
            sum += p;
          }
          expect(sum, `${season} ${cellKey(bucket, state)}`).toBeCloseTo(1, 9);
        }
      }
    }
  });

  it("never returns a cell-sourced result below the stated minimum", () => {
    for (const season of DISTRICT_AWARD_BASE_RATE_SEASONS) {
      for (const bucket of DECORATION_BUCKETS) {
        for (const state of ROOKIE_STATES) {
          const result = awardBaseRate(season, bucket, state);
          if (result.source === "cell") {
            expect(result.n, `${season} ${cellKey(bucket, state)}`).toBeGreaterThanOrEqual(MIN_CELL_OBSERVATIONS);
          }
        }
      }
    }
  });
});

describe("the derived helpers", () => {
  it("anyAwardProbability is exactly 1 - pmf[0]", () => {
    expect(anyAwardProbability([0.7, 0.2, 0.05, 0.03, 0.01, 0.01])).toBeCloseTo(0.3, 12);
    expect(anyAwardProbability([1, 0, 0, 0, 0, 0])).toBe(0);
  });

  it("conditionalMedianPoints returns the hand-computed conditional median over the non-zero support", () => {
    // Conditional mass: 5 -> 0.2/0.3, 8 -> 0.05/0.3, 10 -> 0.03/0.3, 13 -> 0.01/0.3, 15 -> 0.01/0.3.
    // Cumulative at 5 is 0.667 >= 0.5, so the median is 5.
    expect(conditionalMedianPoints([0.7, 0.2, 0.05, 0.03, 0.01, 0.01])).toBe(5);
    // Mass concentrated at 10: cumulative at 5 is 0.1, at 8 is 0.2, at 10 is 1.0.
    expect(conditionalMedianPoints([0.5, 0.05, 0.05, 0.4, 0, 0])).toBe(10);
  });

  it("applies the stated even-mass tie-break: an exact 0.5 cumulative returns the LOWER straddling value", () => {
    // Conditional mass splits exactly 0.5 / 0.5 between 5 and 10.
    expect(conditionalMedianPoints([0.6, 0.2, 0, 0.2, 0, 0])).toBe(5);
  });

  it("returns undefined — never 0 — when the conditional distribution has no mass at all", () => {
    expect(conditionalMedianPoints([1, 0, 0, 0, 0, 0])).toBeUndefined();
  });
});

describe("the fallback hierarchy is stated and observable", () => {
  const season = DISTRICT_AWARD_BASE_RATE_SEASONS[DISTRICT_AWARD_BASE_RATE_SEASONS.length - 1]!;

  it("an exact cell returns source: cell", () => {
    // `none|veteran` is the densest cell in every registered season.
    expect(awardBaseRate(season, "none", "veteran").source).toBe("cell");
  });

  it("a thin cell whose bucket is dense returns the bucket pooled across rookie states, with source: bucket-pooled", () => {
    // A rookie has no prior seasons and therefore no prior judged awards, so
    // `three-or-more|rookie` is structurally empty in every season.
    const result = awardBaseRate(season, "three-or-more", "rookie");
    expect(result.source).toBe("bucket-pooled");
    expect(result).toEqual({ ...awardBaseRate(season, "three-or-more", "veteran"), source: "bucket-pooled" });
  });

  it("no lookup ever returns a value without saying which rung produced it", () => {
    for (const s of DISTRICT_AWARD_BASE_RATE_SEASONS) {
      for (const bucket of DECORATION_BUCKETS) {
        for (const state of ROOKIE_STATES) {
          expect(["cell", "bucket-pooled", "season-pooled"]).toContain(awardBaseRate(s, bucket, state).source);
        }
      }
    }
  });
});

describe("an unregistered season throws rather than defaulting", () => {
  it("throws the typed error, and its message lists the registered set", () => {
    expect(() => awardBaseRate(2016, "none", "veteran")).toThrow(UnknownAwardBaseRateSeasonError);
    try {
      awardBaseRate(2016, "none", "veteran");
      expect.unreachable("awardBaseRate must throw for an unregistered season");
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownAwardBaseRateSeasonError);
      const message = (err as Error).message;
      for (const season of DISTRICT_AWARD_BASE_RATE_SEASONS) {
        expect(message).toContain(String(season));
      }
    }
  });

  it("2016 in particular cannot have a table — it has no prior season at all", () => {
    expect(DISTRICT_AWARD_BASE_RATE_SEASONS).not.toContain(2016);
  });
});
