/**
 * Unit tests for `contribution.ts` — the Welford accumulator behind D-D4(b)'s
 * published `±` (quick task 260902-disp).
 *
 * Pure: no replay, no fixture, no `Math.random`. The integration-level
 * properties (the additivity identity, the count agreement, the surrogate /
 * DQ-zero no-fold) live in `sigma1.test.ts`; this file pins the statistic
 * itself.
 */
import { describe, expect, it } from "vitest";
import {
  contributionSpread,
  emptyContributionAccumulator,
  foldContribution,
  type ContributionAccumulator,
} from "./contribution.js";

function foldAll(values: readonly number[]): ContributionAccumulator {
  let acc = emptyContributionAccumulator();
  for (const value of values) acc = foldContribution(acc, value);
  return acc;
}

/** A plain two-pass sample SD (`n - 1`) — the reference every Welford claim below is measured against. */
function twoPassSd(values: readonly number[]): number {
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const sumSq = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0);
  return Math.sqrt(sumSq / (n - 1));
}

/** The naive `(sum, sumSq)` form Welford was chosen over — present ONLY as the loser of the precision comparison below. */
function sumSqSd(values: readonly number[]): number {
  let sum = 0;
  let sumSq = 0;
  for (const v of values) {
    sum += v;
    sumSq += v * v;
  }
  const n = values.length;
  return Math.sqrt((sumSq - (sum * sum) / n) / (n - 1));
}

/**
 * A seeded LCG — deterministic across machines and runs, so a failure here is
 * always reproducible. `Math.random` would make this file's precision claims
 * flaky by construction.
 */
function seededValues(count: number, seed: number, centre: number, spread: number): number[] {
  let s = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out.push(centre + ((s / 0x100000000) * 2 - 1) * spread);
  }
  return out;
}

describe("contributionSpread — the degenerate rule and the n-1 form", () => {
  it("over [30, 70] is exactly sqrt(800) — the SAMPLE (n-1) standard deviation, not the population (n) one", () => {
    // D-D4(b)'s own words are "computed the way a human would compute it".
    // Every spreadsheet's STDEV is the n-1 form, and it is the unbiased
    // estimator of the variance, so a scout reproducing the published figure
    // by hand gets the published figure back. With n the answer would be
    // sqrt(400) = 20 and every hand check on the site would disagree by 41%.
    expect(contributionSpread(foldAll([30, 70]))).toBe(Math.sqrt(800));
    expect(contributionSpread(foldAll([30, 70]))).toBe(28.284271247461902);
  });

  it("over [50, 50] is exactly 0 — a real sample standard deviation, published as computed, never floored", () => {
    // The user's decision (2026-09-02): "I really dont mind if the model takes
    // a few matches to make sense." Two identical matches genuinely have a
    // sample SD of 0. Inventing a floor here would be publishing a number no
    // series produces, which is the exact defect D-D4(b) exists to remove.
    expect(contributionSpread(foldAll([50, 50]))).toBe(0);
  });

  it("is undefined over one value and over zero values — the statistic does not exist there, and 0/0 is not an answer", () => {
    expect(contributionSpread(foldAll([50]))).toBeUndefined();
    expect(contributionSpread(emptyContributionAccumulator())).toBeUndefined();
  });

  it("the user's own example, executable: 50/50 is strictly steadier than 30/70", () => {
    const steady = contributionSpread(foldAll([50, 50]));
    const streaky = contributionSpread(foldAll([30, 70]));
    expect(steady).toBeDefined();
    expect(streaky).toBeDefined();
    expect(steady!).toBeLessThan(streaky!);
  });
});

describe("contributionSpread — Welford agrees with a two-pass SD", () => {
  it("matches a two-pass SD to within 1e-9 relative over 200 seeded values", () => {
    const values = seededValues(200, 20260902, 48, 17);
    const welford = contributionSpread(foldAll(values))!;
    const reference = twoPassSd(values);
    expect(Math.abs(welford - reference) / reference).toBeLessThan(1e-9);
  });

  it("beats a (sum, sumSq) form on a sequence centred at 5000 with a spread of 0.5 — the header's cancellation argument, measured", () => {
    // This is the case the module header's Welford justification names: the
    // steady robot the feature exists to identify. sumSq ~ n*25,000,000 while
    // the quantity of interest is ~0.25, so the naive form subtracts two
    // nearly-equal large numbers and loses the answer in the last digits.
    const values = seededValues(100, 424242, 5000, 0.5);
    const reference = twoPassSd(values);
    const welfordError = Math.abs(contributionSpread(foldAll(values))! - reference);
    const naiveError = Math.abs(sumSqSd(values) - reference);
    expect(welfordError / reference).toBeLessThan(1e-9);
    expect(naiveError).toBeGreaterThan(welfordError);
  });

  it("is invariant to fold order beyond 1e-9 — a property of the statistic, not a restatement of the implementation", () => {
    const values = seededValues(120, 99, 61, 9);
    const forward = contributionSpread(foldAll(values))!;
    const backward = contributionSpread(foldAll([...values].reverse()))!;
    expect(Math.abs(forward - backward) / forward).toBeLessThan(1e-9);
  });
});

describe("foldContribution — immutability", () => {
  it("returns a NEW accumulator and leaves its input untouched", () => {
    const before = foldAll([10, 20]);
    const snapshot = { ...before };
    const after = foldContribution(before, 30);
    expect(after).not.toBe(before);
    expect(before).toEqual(snapshot);
    expect(after.count).toBe(3);
  });

  it("emptyContributionAccumulator is count 0, mean 0, m2 0", () => {
    expect(emptyContributionAccumulator()).toEqual({ count: 0, mean: 0, m2: 0 });
  });
});
