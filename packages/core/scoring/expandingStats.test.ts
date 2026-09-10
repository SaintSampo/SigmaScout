/**
 * Welford expanding-window mean/variance regression tests (Pitfall EPA-1).
 * The central property under test is leak-proofness: a value read after
 * folding the first k observations must be provably unaffected by any
 * observation folded afterward.
 */
import { describe, expect, it } from "vitest";
import { emptyExpandingStats, foldObservation, reseedFromPrior, standardDeviation } from "./expandingStats.js";

// Textbook Welford fixture: population mean 5, population variance 4 (sd 2).
// Sum of squared deviations from the mean: 9+1+1+1+0+0+4+16 = 32; /8 = 4.
const TEXTBOOK_SEQUENCE = [2, 4, 4, 4, 5, 5, 7, 9];

describe("emptyExpandingStats", () => {
  it("starts at count 0, mean 0, m2 0", () => {
    expect(emptyExpandingStats()).toEqual({ count: 0, mean: 0, m2: 0 });
  });
});

describe("foldObservation", () => {
  it("reproduces textbook Welford mean and variance on a known sequence", () => {
    let stats = emptyExpandingStats();
    for (const x of TEXTBOOK_SEQUENCE) {
      stats = foldObservation(stats, x);
    }
    expect(stats.count).toBe(8);
    expect(stats.mean).toBeCloseTo(5, 10);
    expect(stats.m2 / stats.count).toBeCloseTo(4, 10);
  });

  it("does not mutate its input", () => {
    const stats = emptyExpandingStats();
    const next = foldObservation(stats, 10);
    expect(stats).toEqual({ count: 0, mean: 0, m2: 0 });
    expect(next).not.toBe(stats);
  });
});

describe("standardDeviation", () => {
  it("matches sqrt of the textbook population variance (sd = 2)", () => {
    let stats = emptyExpandingStats();
    for (const x of TEXTBOOK_SEQUENCE) {
      stats = foldObservation(stats, x);
    }
    expect(standardDeviation(stats, -1)).toBeCloseTo(2, 10);
  });

  it("returns the caller's fallback (not 0, not NaN) when count < 2", () => {
    expect(standardDeviation(emptyExpandingStats(), 42)).toBe(42);
    const oneObservation = foldObservation(emptyExpandingStats(), 100);
    expect(standardDeviation(oneObservation, 42)).toBe(42);
    // Explicitly not 0 or NaN — a fallback of 0 would be indistinguishable
    // from "confirmed zero variance," and NaN would poison downstream math.
    expect(standardDeviation(emptyExpandingStats(), 42)).not.toBe(0);
    expect(Number.isNaN(standardDeviation(emptyExpandingStats(), 42))).toBe(false);
  });

  it("the leakage regression: a value captured after folding the first k observations is unchanged by folding k+1..n afterward", () => {
    let stats = emptyExpandingStats();
    for (const x of TEXTBOOK_SEQUENCE.slice(0, 4)) {
      stats = foldObservation(stats, x);
    }
    const capturedAfterFour = standardDeviation(stats, -1);

    // A completely independent fold of ONLY the first four observations
    // must equal the captured value.
    let freshPrefixOnly = emptyExpandingStats();
    for (const x of TEXTBOOK_SEQUENCE.slice(0, 4)) {
      freshPrefixOnly = foldObservation(freshPrefixOnly, x);
    }
    expect(standardDeviation(freshPrefixOnly, -1)).toBe(capturedAfterFour);

    // Now fold the remaining observations into the ORIGINAL stats object's
    // lineage — this must produce a NEW stats value; the previously
    // captured number must remain exactly what it was.
    let stats2 = stats;
    for (const x of TEXTBOOK_SEQUENCE.slice(4)) {
      stats2 = foldObservation(stats2, x);
    }
    expect(standardDeviation(stats, -1)).toBe(capturedAfterFour);
    expect(standardDeviation(stats2, -1)).not.toBe(capturedAfterFour);
  });
});

describe("reseedFromPrior", () => {
  it("preserves the prior regime's SD and mean exactly, while replacing its observation count", () => {
    let stats = emptyExpandingStats();
    for (const x of [40, 60, 55, 45, 70, 30, 52, 48]) stats = foldObservation(stats, x);
    const priorSd = standardDeviation(stats, NaN);

    const reseeded = reseedFromPrior(stats, 50);

    expect(standardDeviation(reseeded, NaN)).toBeCloseTo(priorSd, 12);
    expect(reseeded.mean).toBeCloseTo(stats.mean, 12);
    expect(reseeded.count).toBe(50);
  });

  it("lets the new regime's own dispersion take over, which carrying the accumulator whole never could", () => {
    // The defect this function exists to fix (quick task 260910-4x0): a
    // "seed" that brings its observation count along cannot be outvoted. Both
    // regimes share a mean here, deliberately, so this isolates the property
    // under test — how fast the SD follows the new regime — from the
    // mean-migration transient the next test covers.
    let old = emptyExpandingStats();
    for (let i = 0; i < 20_000; i++) old = foldObservation(old, i % 2 === 0 ? 50 : 150); // mean 100, SD 50

    let carriedWhole = old;
    let reseeded = reseedFromPrior(old, 50);
    for (let i = 0; i < 400; i++) {
      const x = i % 2 === 0 ? 94 : 106; // mean 100, SD 6
      carriedWhole = foldObservation(carriedWhole, x);
      reseeded = foldObservation(reseeded, x);
    }

    // Carrying the accumulator whole leaves the scale pinned at the OLD
    // regime's — 400 new observations against 20,000 old ones move it by
    // under a point.
    expect(standardDeviation(carriedWhole, NaN)).toBeGreaterThan(49);
    // Re-seeding lets the same 400 observations actually move it.
    expect(standardDeviation(reseeded, NaN)).toBeLessThan(standardDeviation(carriedWhole, NaN) / 2);
  });

  it("transiently INFLATES the SD when the new regime's mean is far from the old one — a real cost, recorded not hidden", () => {
    // Welford's m2 accumulates squared deviations from a running mean, so
    // while that mean migrates from the seed's level to the new regime's,
    // every new observation contributes a large deviation. EPA pays this at
    // season boundaries where FRC's point scale jumps hard (2016 averaged
    // 85.5, 2017 averaged 233.5), and it is why 2016/2017/2019 came out
    // marginally WORSE on Brier under the re-seed — see
    // `docs/models/epa-vs-statbotics.md`. Pinned here so the trade is a
    // known, measured property rather than a surprise to the next reader.
    let old = emptyExpandingStats();
    for (let i = 0; i < 1_000; i++) old = foldObservation(old, i % 2 === 0 ? 80 : 92); // mean 86, SD 6
    let reseeded = reseedFromPrior(old, 50);
    for (let i = 0; i < 50; i++) reseeded = foldObservation(reseeded, i % 2 === 0 ? 228 : 240); // mean 234, SD 6

    // Both regimes have SD 6, yet mid-migration the estimate is far above it.
    expect(standardDeviation(reseeded, NaN)).toBeGreaterThan(50);
  });

  it("passes a too-thin prior through untouched, so the caller's fallback keeps applying", () => {
    const thin = foldObservation(emptyExpandingStats(), 42);
    expect(reseedFromPrior(thin, 50)).toEqual(thin);
    expect(standardDeviation(reseedFromPrior(thin, 50), 25)).toBe(25);
  });
});
