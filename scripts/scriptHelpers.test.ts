/**
 * Unit tests for `scriptHelpers.ts`. Both describe blocks were copied verbatim
 * by quick task 260913-it4 from the tests of the script these helpers were
 * relocated from.
 *
 * What is tested here is what could be silently wrong in a way no console
 * output would reveal: a bucketer that drops rows, or a season parser that
 * mishandles a gapped spec. Each produces a plausible number and a false
 * conclusion.
 */
import { describe, expect, it } from "vitest";
import { equalCountBuckets, parseSeasons } from "./scriptHelpers.js";

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
