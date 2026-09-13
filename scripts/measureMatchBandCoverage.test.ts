/**
 * Unit tests for `measureMatchBandCoverage.ts`'s pure helpers.
 *
 * The measurement loop runs against the real corpus and is not exercised here.
 * What is tested is everything that could be silently wrong while still
 * printing a plausible percentage: an edge-exclusive band test, a bucket off by
 * one, a summary that divides by the wrong count, or a warmup range that drops
 * the first reported season. Each of those would put a false number on the
 * Sigma methodology page.
 */
import { describe, expect, it } from "vitest";
import {
  coldestBucket,
  formatShare,
  insideBands,
  replaySeasons,
  summarizeCoverage,
  type CoverageRow,
} from "./measureMatchBandCoverage.js";

describe("insideBands", () => {
  it("is inside when the absolute miss is at most k times the band's square root, inclusive at the edge", () => {
    // sqrt(100) = 10
    expect(insideBands(10, 100, 1)).toBe(true);
    expect(insideBands(-10, 100, 1)).toBe(true);
    expect(insideBands(10.0001, 100, 1)).toBe(false);
    expect(insideBands(-19.9, 100, 2)).toBe(true);
    expect(insideBands(20, 100, 2)).toBe(true);
    expect(insideBands(20.5, 100, 2)).toBe(false);
  });

  it("reads a zero band as inside only for an exact hit", () => {
    expect(insideBands(0, 0, 1)).toBe(true);
    expect(insideBands(0.1, 0, 1)).toBe(false);
  });

  it("reads a negative or non-finite input as outside, never as a coerced band", () => {
    expect(insideBands(1, -4, 1)).toBe(false);
    expect(insideBands(1, Number.NaN, 1)).toBe(false);
    expect(insideBands(Number.NaN, 100, 1)).toBe(false);
    expect(insideBands(1, Number.POSITIVE_INFINITY, 1)).toBe(false);
  });
});

describe("coldestBucket", () => {
  it("maps 0 to 2 prior matches to under 3, 3 to 11 to 3 to 11, and 12 or more to 12 plus", () => {
    expect(coldestBucket(0)).toBe("under 3");
    expect(coldestBucket(2)).toBe("under 3");
    expect(coldestBucket(3)).toBe("3 to 11");
    expect(coldestBucket(11)).toBe("3 to 11");
    expect(coldestBucket(12)).toBe("12 plus");
    expect(coldestBucket(40)).toBe("12 plus");
  });
});

describe("summarizeCoverage", () => {
  const row = (inside1: boolean, inside2: boolean, pre: boolean): CoverageRow => ({
    season: 2024,
    quals: true,
    coldestPrior: 5,
    inside1,
    inside2,
    preCorrectionInside1: pre,
  });

  it("reports n and each share over a hand-built list", () => {
    const rows = [row(true, true, true), row(true, true, false), row(false, true, false), row(false, false, false)];
    const s = summarizeCoverage(rows);
    expect(s.n).toBe(4);
    expect(s.inside1).toBe(0.5);
    expect(s.inside2).toBe(0.75);
    expect(s.preCorrectionInside1).toBe(0.25);
  });

  it("reports NaN shares for an empty list rather than 0%", () => {
    const s = summarizeCoverage([]);
    expect(s.n).toBe(0);
    expect(Number.isNaN(s.inside1)).toBe(true);
    expect(Number.isNaN(s.inside2)).toBe(true);
    expect(Number.isNaN(s.preCorrectionInside1)).toBe(true);
    expect(formatShare(s.inside1)).toBe("n/a");
  });

  it("formats a share to one decimal percent", () => {
    expect(formatShare(0.71666)).toBe("71.7%");
  });
});

describe("replaySeasons", () => {
  it("starts at the warmup season and runs through the last reported season", () => {
    expect(replaySeasons([2024, 2025, 2026], 2023)).toEqual([2023, 2024, 2025, 2026]);
  });

  it("never drops a reported season that is earlier than the warmup flag", () => {
    expect(replaySeasons([2022, 2023], 2023)).toEqual([2022, 2023]);
  });

  it("with no warmup starts at the first reported season", () => {
    expect(replaySeasons([2026, 2024], undefined)).toEqual([2024, 2025, 2026]);
  });

  it("returns nothing for no reported seasons", () => {
    expect(replaySeasons([], 2023)).toEqual([]);
  });
});
