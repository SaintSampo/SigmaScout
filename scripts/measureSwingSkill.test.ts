/**
 * Unit tests for `measureSwingSkill.ts`'s pure statistics.
 *
 * The measurement LOOP is exercised by running the harness against the real
 * corpus, which prints a mismatched-pairing control precisely so that a broken
 * walk-forward pairing announces itself. What is tested here is everything that
 * could be silently wrong in a way no console output would reveal: a Spearman
 * that ignores ties, an NLL missing its log-sigma term, a decile bucketer that
 * drops rows, a within-season standardization that fails to remove a between-
 * season scale factor. Each of those produces a plausible number and a false
 * conclusion, which is the failure mode this whole audit is about.
 */
import { describe, expect, it } from "vitest";
import {
  averageRanks,
  coverage,
  equalCountBuckets,
  gaussianNll,
  mean,
  parseSeasons,
  pearson,
  rms,
  spearman,
  standardizeWithinGroups,
} from "./measureSwingSkill.js";

describe("mean / rms", () => {
  it("computes both over a known list", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(rms([3, 4])).toBeCloseTo(Math.sqrt(12.5), 12);
  });

  it("returns NaN on an empty list rather than 0 — an empty sample has no mean", () => {
    expect(mean([])).toBeNaN();
    expect(rms([])).toBeNaN();
  });

  it("rms ignores sign, which is the entire reason it is the spread comparison", () => {
    expect(rms([-5, 5, -5, 5])).toBeCloseTo(5, 12);
  });
});

describe("pearson", () => {
  it("is exactly 1 for a positive linear relationship", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
  });

  it("is exactly -1 for a negative linear relationship", () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
  });

  it("is 0 for an orthogonal pairing", () => {
    // Cross-products cancel exactly: (-1.5)(1) + (-0.5)(-1) + (0.5)(-1) + (1.5)(1) = 0.
    expect(pearson([1, 2, 3, 4], [1, -1, -1, 1])).toBeCloseTo(0, 12);
  });

  it("returns NaN when either side is constant — zero variance has no correlation, and 0 would be a lie", () => {
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNaN();
    expect(pearson([1, 2, 3, 4], [7, 7, 7, 7])).toBeNaN();
  });

  it("returns NaN on mismatched or too-short input rather than throwing", () => {
    expect(pearson([1, 2], [1])).toBeNaN();
    expect(pearson([1], [1])).toBeNaN();
  });
});

describe("averageRanks", () => {
  it("ranks a strictly increasing list 1..n", () => {
    expect(averageRanks([10, 20, 30])).toEqual([1, 2, 3]);
  });

  it("gives tied values their SHARED mean rank, not arbitrary ordinal ranks", () => {
    // Two values tied for ranks 2 and 3 both become 2.5.
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("handles an all-tied list — every rank is the same midpoint", () => {
    expect(averageRanks([5, 5, 5, 5])).toEqual([2.5, 2.5, 2.5, 2.5]);
  });

  it("preserves input order in the returned ranks", () => {
    expect(averageRanks([30, 10, 20])).toEqual([3, 1, 2]);
  });
});

describe("spearman", () => {
  it("is 1 for any monotonically increasing relationship, however non-linear", () => {
    expect(spearman([1, 2, 3, 4], [1, 10, 1000, 100000])).toBeCloseTo(1, 12);
  });

  it("is tie-corrected — an all-tied side has no rank variance and yields NaN, never a fake 0", () => {
    expect(spearman([1, 1, 1, 1], [1, 2, 3, 4])).toBeNaN();
  });

  it("a partially tied side still produces a finite, correct coefficient", () => {
    // Ranks x = [1, 2.5, 2.5, 4], ranks y = [1, 2, 3, 4] — strongly positive.
    const r = spearman([10, 20, 20, 30], [1, 2, 3, 4]);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThan(0.9);
  });
});

describe("standardizeWithinGroups", () => {
  it("leaves a single group's correlation UNCHANGED — it is an affine transform and Pearson is affine-invariant", () => {
    const xs = [1, 5, 2, 9, 4];
    const ys = [3, 11, 4, 20, 8];
    const groups = [2026, 2026, 2026, 2026, 2026];
    expect(pearson(standardizeWithinGroups(xs, groups), standardizeWithinGroups(ys, groups))).toBeCloseTo(
      pearson(xs, ys),
      12
    );
  });

  it("gives each group zero mean and unit variance", () => {
    const values = [10, 20, 30, 1000, 2000, 3000];
    const groups = [1, 1, 1, 2, 2, 2];
    const z = standardizeWithinGroups(values, groups);
    const first = z.slice(0, 3);
    const second = z.slice(3);
    expect(mean(first)).toBeCloseTo(0, 12);
    expect(mean(second)).toBeCloseTo(0, 12);
    expect(rms(first)).toBeCloseTo(1, 12);
    expect(rms(second)).toBeCloseTo(1, 12);
  });

  it("REMOVES a between-group scale factor that would otherwise fake a correlation", () => {
    // Two groups, each internally ORTHOGONAL (centred cross-products cancel
    // exactly), but group 2 sits at a completely different LEVEL on both axes.
    // Raw pooling sees a near-perfect correlation that is purely the between-
    // group separation; standardizing within group must destroy it entirely.
    // This is the exact failure measured on real 2024-2026 data.
    const xs = [10, 11, 12, 13, 1000, 1001, 1002, 1003];
    const ys = [100, 98, 98, 100, 10000, 9998, 9998, 10000];
    const groups = [1, 1, 1, 1, 2, 2, 2, 2];
    expect(Math.abs(pearson(xs, ys))).toBeGreaterThan(0.9);
    const standardized = pearson(standardizeWithinGroups(xs, groups), standardizeWithinGroups(ys, groups));
    expect(Math.abs(standardized)).toBeLessThan(0.2);
  });

  it("preserves input order and length", () => {
    const z = standardizeWithinGroups([5, 1, 3], [1, 2, 1]);
    expect(z).toHaveLength(3);
    // Group 1 holds [5, 3] at indices 0 and 2; index 0 is the larger, so positive.
    expect(z[0]!).toBeGreaterThan(0);
    expect(z[2]!).toBeLessThan(0);
  });

  it("emits 0 rather than NaN for a zero-variance group, so one degenerate season cannot poison the pool", () => {
    const z = standardizeWithinGroups([7, 7, 7, 1, 2, 3], [1, 1, 1, 2, 2, 2]);
    expect(z.slice(0, 3)).toEqual([0, 0, 0]);
    expect(z.slice(3).every(Number.isFinite)).toBe(true);
  });

  it("returns an empty array on mismatched input", () => {
    expect(standardizeWithinGroups([1, 2], [1])).toEqual([]);
  });
});

describe("gaussianNll", () => {
  it("matches the closed form for a unit normal at the mean", () => {
    // sigma = 1, outcome = 0 -> 0.5*ln(2*pi)
    expect(gaussianNll([0], [1])).toBeCloseTo(0.5 * Math.log(2 * Math.PI), 12);
  });

  it("matches the closed form away from the mean", () => {
    // sigma = 2, outcome = 3 -> 0.5*ln(2pi) + ln(2) + 0.5*(1.5^2)
    const expected = 0.5 * Math.log(2 * Math.PI) + Math.log(2) + 0.5 * 1.5 * 1.5;
    expect(gaussianNll([3], [2])).toBeCloseTo(expected, 12);
  });

  it("includes the log-sigma term, so an absurdly WIDE band is penalised even when it covers the outcome", () => {
    // Without log(sigma) a huge sigma would look free. It must not.
    const tight = gaussianNll([1, -1, 1, -1], [1, 1, 1, 1]);
    const absurdlyWide = gaussianNll([1, -1, 1, -1], [100, 100, 100, 100]);
    expect(absurdlyWide).toBeGreaterThan(tight);
  });

  it("penalises an over-confident band too, so the score is two-sided", () => {
    const honest = gaussianNll([10, -10, 10, -10], [10, 10, 10, 10]);
    const overConfident = gaussianNll([10, -10, 10, -10], [0.5, 0.5, 0.5, 0.5]);
    expect(overConfident).toBeGreaterThan(honest);
  });

  it("is minimised at the TRUE sigma, which is what makes it a proper scoring rule", () => {
    const outcomes = [-2, -1, 0, 1, 2];
    const trueSigma = rms(outcomes);
    const atTruth = gaussianNll(
      outcomes,
      outcomes.map(() => trueSigma)
    );
    for (const wrong of [trueSigma * 0.5, trueSigma * 0.8, trueSigma * 1.25, trueSigma * 2]) {
      expect(
        gaussianNll(
          outcomes,
          outcomes.map(() => wrong)
        )
      ).toBeGreaterThan(atTruth);
    }
  });

  it("THROWS on a non-positive or non-finite sigma rather than coercing it", () => {
    expect(() => gaussianNll([1], [0])).toThrow(/finite and positive/);
    expect(() => gaussianNll([1], [-1])).toThrow(/finite and positive/);
    expect(() => gaussianNll([1], [Number.NaN])).toThrow(/finite and positive/);
    expect(() => gaussianNll([1], [Number.POSITIVE_INFINITY])).toThrow(/finite and positive/);
  });

  it("returns NaN on mismatched or empty input", () => {
    expect(gaussianNll([], [])).toBeNaN();
    expect(gaussianNll([1, 2], [1])).toBeNaN();
  });
});

describe("equalCountBuckets", () => {
  it("splits evenly divisible input into equal-population buckets", () => {
    const rows = [5, 1, 4, 2, 3, 6].map((v) => ({ v }));
    const buckets = equalCountBuckets(rows, (r) => r.v, 3);
    expect(buckets.map((b) => b.map((r) => r.v))).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("DROPS NO ROWS when the count does not divide evenly", () => {
    const rows = Array.from({ length: 17 }, (_, i) => ({ v: i }));
    const buckets = equalCountBuckets(rows, (r) => r.v, 5);
    expect(buckets.reduce((n, b) => n + b.length, 0)).toBe(17);
  });

  it("assigns every row to exactly one bucket, ascending, with no overlap", () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({ v: 23 - i }));
    const buckets = equalCountBuckets(rows, (r) => r.v, 4);
    const flattened = buckets.flat().map((r) => r.v);
    expect(new Set(flattened).size).toBe(23);
    expect(flattened).toEqual([...flattened].sort((a, b) => a - b));
  });

  it("does not emit empty buckets when there are fewer rows than buckets", () => {
    const buckets = equalCountBuckets([{ v: 1 }, { v: 2 }], (r) => r.v, 10);
    expect(buckets.every((b) => b.length > 0)).toBe(true);
    expect(buckets.reduce((n, b) => n + b.length, 0)).toBe(2);
  });

  it("does not mutate its input", () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    equalCountBuckets(rows, (r) => r.v, 3);
    expect(rows.map((r) => r.v)).toEqual([3, 1, 2]);
  });

  it("returns an empty array for empty input or a non-positive count", () => {
    expect(equalCountBuckets([], (r: { v: number }) => r.v, 5)).toEqual([]);
    expect(equalCountBuckets([{ v: 1 }], (r) => r.v, 0)).toEqual([]);
  });
});

describe("coverage", () => {
  it("counts a row exactly ON its band edge as INSIDE", () => {
    expect(coverage([5], [5])).toBe(1);
    expect(coverage([-5], [5])).toBe(1);
  });

  it("ignores sign — coverage is about magnitude", () => {
    expect(coverage([-3, 3], [4, 4])).toBe(1);
  });

  it("computes a partial fraction", () => {
    expect(coverage([1, 2, 30, 40], [10, 10, 10, 10])).toBe(0.5);
  });

  it("returns NaN on mismatched or empty input", () => {
    expect(coverage([], [])).toBeNaN();
    expect(coverage([1, 2], [1])).toBeNaN();
  });
});

describe("parseSeasons", () => {
  it("expands a range", () => {
    expect(parseSeasons("2024-2026")).toEqual([2024, 2025, 2026]);
  });

  it("accepts a single year", () => {
    expect(parseSeasons("2026")).toEqual([2026]);
  });

  it("accepts a comma-separated mix of years and ranges", () => {
    expect(parseSeasons("2019,2022-2024")).toEqual([2019, 2022, 2023, 2024]);
  });

  it("de-duplicates and sorts ascending regardless of input order", () => {
    expect(parseSeasons("2026,2024-2025,2024")).toEqual([2024, 2025, 2026]);
  });
});
