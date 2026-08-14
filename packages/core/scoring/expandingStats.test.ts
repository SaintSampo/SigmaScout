/**
 * Welford expanding-window mean/variance regression tests (Pitfall EPA-1).
 * The central property under test is leak-proofness: a value read after
 * folding the first k observations must be provably unaffected by any
 * observation folded afterward.
 */
import { describe, expect, it } from "vitest";
import { emptyExpandingStats, foldObservation, standardDeviation } from "./expandingStats.js";

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
