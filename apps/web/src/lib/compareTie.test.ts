import { describe, expect, it } from "vitest";
import {
  combineStandardErrors,
  formatBrierDisplay,
  formatWinnerAccuracyDisplay,
  isNearTie,
  naiveStandardError,
  resolveBrierLeaders,
  resolveWinnerAccuracyLeaders,
  type BrierCandidate,
  type WinnerAccuracyCandidate,
} from "./compareTie.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../../packages/harness/publishedAlgorithms.js";

// Every input in this file is a hand-built literal (Task 1's own discipline
// — this module is pure and its expectations must be independent of the
// committed Compare fixtures, which are 08-06 Task 3's parity anchors, not
// this task's). The three "real elimination case" tests below are hand-typed
// literals copied from 08-CONTEXT.md D-11's own measured table, not read
// from a fixture file.

const [OPR, EPA, VPR] = PUBLISHED_ALGORITHM_IDS;

describe("formatBrierDisplay", () => {
  it("returns the four-decimal fixed-point text of its input, computed via the same expression the formatter itself uses", () => {
    const value = 0.15012807378698909;
    expect(formatBrierDisplay(value)).toBe(value.toFixed(4));
  });

  it("pins the rounding contract to Number.prototype.toFixed over the binary double, not decimal half-up — two inputs that round opposite ways at their decimal midpoint", () => {
    // These two literals are chosen because they sit exactly at a
    // four-decimal rounding midpoint in decimal notation, but `toFixed`
    // rounds the underlying BINARY double, not the decimal literal — so one
    // rounds down (ends `5`, i.e. it did NOT round up to `...3`) and the
    // other rounds up (ends `2`, not down to `...1`). A future contributor
    // "fixing" this into explicit decimal half-up rounding would flip one of
    // these two and this test would catch it.
    const roundsToFive = 0.12345;
    const roundsToTwo = 0.14725;
    expect(formatBrierDisplay(roundsToFive)).toBe(roundsToFive.toFixed(4));
    expect(formatBrierDisplay(roundsToFive).endsWith("5")).toBe(true);
    expect(formatBrierDisplay(roundsToTwo)).toBe(roundsToTwo.toFixed(4));
    expect(formatBrierDisplay(roundsToTwo).endsWith("2")).toBe(true);
  });
});

describe("formatWinnerAccuracyDisplay", () => {
  it("returns the input scaled by 100 at one decimal with a trailing percent sign, computed via the same expression the formatter itself uses", () => {
    const value = 0.7913181346017167;
    expect(formatWinnerAccuracyDisplay(value)).toBe(`${(value * 100).toFixed(1)}%`);
  });
});

describe("resolveBrierLeaders — lower is better", () => {
  it("three candidates with distinct values: the single lowest is returned, alone", () => {
    const candidates: BrierCandidate[] = [
      { algorithmId: OPR!, value: 0.2 },
      { algorithmId: EPA!, value: 0.15 },
      { algorithmId: VPR!, value: 0.25 },
    ];
    expect(resolveBrierLeaders(candidates)).toEqual([EPA]);
  });

  it("the real 2022 elimination pair renders an empty leader set — both round to the same displayed four-decimal string", () => {
    const oprValue = 0.14721222242674725;
    const vprValue = 0.14717091997830647;
    // Documents itself: the two formatted strings really are equal.
    expect(formatBrierDisplay(oprValue)).toBe(formatBrierDisplay(vprValue));
    const candidates: BrierCandidate[] = [
      { algorithmId: OPR!, value: oprValue },
      { algorithmId: VPR!, value: vprValue },
    ];
    expect(resolveBrierLeaders(candidates)).toEqual([]);
  });

  it("one step above the display-tie threshold: two values whose four-decimal strings differ by one unit in the last place return the lower value's algorithm alone", () => {
    const candidates: BrierCandidate[] = [
      { algorithmId: OPR!, value: 0.1001 },
      { algorithmId: VPR!, value: 0.1 },
    ];
    expect(formatBrierDisplay(0.1001)).not.toBe(formatBrierDisplay(0.1));
    expect(resolveBrierLeaders(candidates)).toEqual([VPR]);
  });

  it("two candidates strictly equal return BOTH as joint leaders, and a third strictly-worse candidate is not included", () => {
    const candidates: BrierCandidate[] = [
      { algorithmId: OPR!, value: 0.1234 },
      { algorithmId: EPA!, value: 0.5 },
      { algorithmId: VPR!, value: 0.1234 },
    ];
    expect(resolveBrierLeaders(candidates)).toEqual([OPR, VPR]);
  });

  it("candidates with a null-sourced or non-finite value are excluded before comparison; fewer than two comparable candidates return an empty leader set", () => {
    const allNull: BrierCandidate[] = [
      { algorithmId: OPR!, value: null },
      { algorithmId: EPA!, value: null },
    ];
    expect(resolveBrierLeaders(allNull)).toEqual([]);

    const onePresent: BrierCandidate[] = [
      { algorithmId: OPR!, value: 0.2 },
      { algorithmId: EPA!, value: null },
    ];
    expect(resolveBrierLeaders(onePresent)).toEqual([]);

    const onePlusNonFinite: BrierCandidate[] = [
      { algorithmId: OPR!, value: 0.2 },
      { algorithmId: EPA!, value: Number.NaN },
      { algorithmId: VPR!, value: Number.POSITIVE_INFINITY },
    ];
    expect(resolveBrierLeaders(onePlusNonFinite)).toEqual([]);
  });

  it("output order is PUBLISHED_ALGORITHM_IDS order regardless of the candidates' input order — a joint tie fed in reverse still returns the constant's own order", () => {
    const candidates: BrierCandidate[] = [
      { algorithmId: VPR!, value: 0.1 },
      { algorithmId: OPR!, value: 0.1 },
      { algorithmId: EPA!, value: 0.9 },
    ];
    expect(resolveBrierLeaders(candidates)).toEqual([OPR, VPR]);
  });
});

describe("naiveStandardError", () => {
  it("is the square root of p * (1 - p) / n, computed via the same expression the function itself uses", () => {
    const p = 0.7913181346017167;
    const n = 2867;
    expect(naiveStandardError(p, n)).toBe(Math.sqrt((p * (1 - p)) / n));
  });

  it("returns a non-finite value when n is zero, for both an interior p and a p at the unit boundary — the two zero-count shapes differ", () => {
    // Interior p: p*(1-p) is positive, divided by zero -> +Infinity.
    expect(Number.isFinite(naiveStandardError(0.5, 0))).toBe(false);
    // Boundary p: p*(1-p) is exactly zero, 0/0 -> NaN.
    expect(Number.isFinite(naiveStandardError(1, 0))).toBe(false);
  });
});

describe("combineStandardErrors", () => {
  it("is the square root of the sum of squares, computed via the same expression the function itself uses", () => {
    const a = 0.0113;
    const b = 0.012;
    expect(combineStandardErrors(a, b)).toBe(Math.sqrt(a * a + b * b));
  });
});

describe("isNearTie", () => {
  it("is a strict <: equal inputs return false, a gap one step below returns true, a gap one step above returns false — one standard-error value held fixed across all three", () => {
    const se = 1;
    expect(isNearTie(se, se)).toBe(false);
    expect(isNearTie(se - Number.EPSILON, se)).toBe(true);
    expect(isNearTie(se + Number.EPSILON, se)).toBe(false);
  });

  it("returns true whenever the combined standard error is not a finite number — a bound that cannot be computed cannot establish a winner", () => {
    expect(isNearTie(0.5, Number.POSITIVE_INFINITY)).toBe(true);
    expect(isNearTie(0.5, Number.NaN)).toBe(true);
  });
});

describe("resolveWinnerAccuracyLeaders — higher is better", () => {
  it("three candidates with a wide gap: the single highest is returned, alone", () => {
    const candidates: WinnerAccuracyCandidate[] = [
      { algorithmId: OPR!, value: 0.5, scoredCount: 1000 },
      { algorithmId: EPA!, value: 0.9, scoredCount: 1000 },
      { algorithmId: VPR!, value: 0.6, scoredCount: 1000 },
    ];
    expect(resolveWinnerAccuracyLeaders(candidates)).toEqual([EPA]);
  });

  it("the real 2022 elimination triple withholds the leader (OPR, not VPR) — the gap sits inside the combined naive standard error", () => {
    const candidates: WinnerAccuracyCandidate[] = [
      { algorithmId: OPR!, value: 0.7930232558139535, scoredCount: 2613 },
      { algorithmId: EPA!, value: 0.778544061302682, scoredCount: 2613 },
      { algorithmId: VPR!, value: 0.782375478927203, scoredCount: 2613 },
    ];
    // The withheld leader here is OPR, not the site's own model — this is
    // the entire reason D-11 exists rather than being a rule that only ever
    // protects VPR.
    expect(resolveWinnerAccuracyLeaders(candidates)).toEqual([]);
  });

  it("the real 2023 elimination triple bolds VPR alone — the tightest above-threshold case in the real corpus", () => {
    const candidates: WinnerAccuracyCandidate[] = [
      { algorithmId: VPR!, value: 0.7296229802513465, scoredCount: 2795 },
      { algorithmId: OPR!, value: 0.7166965888689407, scoredCount: 2795 },
      { algorithmId: EPA!, value: 0.7150635208711433, scoredCount: 2795 },
    ];
    expect(resolveWinnerAccuracyLeaders(candidates)).toEqual([VPR]);
  });

  it("the real 2024 elimination pair returns an empty leader set — the gap is roughly six tenths of one match", () => {
    const candidates: WinnerAccuracyCandidate[] = [
      { algorithmId: OPR!, value: 0.7093926553672316, scoredCount: 2867 },
      { algorithmId: VPR!, value: 0.7091925900034953, scoredCount: 2867 },
    ];
    expect(resolveWinnerAccuracyLeaders(candidates)).toEqual([]);
  });

  it("two candidates whose accuracies are strictly equal return BOTH, regardless of their counts", () => {
    const candidates: WinnerAccuracyCandidate[] = [
      { algorithmId: OPR!, value: 0.75, scoredCount: 100 },
      { algorithmId: VPR!, value: 0.75, scoredCount: 5000 },
    ];
    expect(resolveWinnerAccuracyLeaders(candidates)).toEqual([OPR, VPR]);
  });

  it("a leading pair in which either candidate has scoredCount zero returns an empty leader set, even with a huge gap", () => {
    const candidates: WinnerAccuracyCandidate[] = [
      { algorithmId: OPR!, value: 0.9, scoredCount: 1000 },
      { algorithmId: VPR!, value: 0.1, scoredCount: 0 },
    ];
    expect(resolveWinnerAccuracyLeaders(candidates)).toEqual([]);
  });

  it("a candidate whose accuracy sits outside the unit interval makes the standard error non-finite and returns an empty leader set rather than throwing or bolding", () => {
    const candidates: WinnerAccuracyCandidate[] = [
      { algorithmId: OPR!, value: 1.5, scoredCount: 100 },
      { algorithmId: VPR!, value: 0.5, scoredCount: 100 },
    ];
    expect(() => resolveWinnerAccuracyLeaders(candidates)).not.toThrow();
    expect(resolveWinnerAccuracyLeaders(candidates)).toEqual([]);
  });

  it("fewer than two comparable candidates returns an empty leader set", () => {
    const candidates: WinnerAccuracyCandidate[] = [{ algorithmId: OPR!, value: 0.5, scoredCount: 100 }];
    expect(resolveWinnerAccuracyLeaders(candidates)).toEqual([]);
  });

  it("output order is PUBLISHED_ALGORITHM_IDS order regardless of the candidates' input order — a joint tie fed in reverse still returns the constant's own order", () => {
    const candidates: WinnerAccuracyCandidate[] = [
      { algorithmId: VPR!, value: 0.8, scoredCount: 1000 },
      { algorithmId: OPR!, value: 0.8, scoredCount: 1000 },
      { algorithmId: EPA!, value: 0.1, scoredCount: 1000 },
    ];
    expect(resolveWinnerAccuracyLeaders(candidates)).toEqual([OPR, VPR]);
  });
});
