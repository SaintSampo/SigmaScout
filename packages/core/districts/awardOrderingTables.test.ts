/**
 * The award point constants and the stack fold: pure, synthetic, no corpus.
 * The ordering tables, their lookups and their tests were deleted in quick
 * task 261014-qje (replaced by the one award slate, `awardSlate.ts`); these
 * tests cover the exports that remain.
 */
import { describe, expect, it } from "vitest";
import { AWARD_POINT_SUPPORT, DISTRICT_POINT_AWARD_VALUES } from "./awardBaseRates.js";
import {
  foldStackedAwardPmf,
  foldStackedAwardPoints,
  IMPACT_AWARD_POINTS,
  IMPACT_AWARD_TYPE,
  ROOKIE_ALL_STAR_AWARD_POINTS,
  ROOKIE_ALL_STAR_AWARD_TYPE,
  SINGLE_AWARD_POINT_CEILING,
} from "./awardOrderingTables.js";

/** Synthetic pmfs over `AWARD_POINT_SUPPORT`, each summing to one, with mass in both stacked bins. */
const PMFS: readonly (readonly number[])[] = [
  [0.7, 0.15, 0.06, 0.05, 0.02, 0.02],
  [0.9, 0.05, 0.02, 0.01, 0.01, 0.01],
  [0.5, 0.2, 0.1, 0.1, 0.05, 0.05],
];

function mean(pmf: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < AWARD_POINT_SUPPORT.length; i++) total += AWARD_POINT_SUPPORT[i]! * (pmf[i] ?? 0);
  return total;
}

describe("the two award constants", () => {
  it("are TBA's award types 0 and 10, paying 10 and 8 points, equal to the district point award values", () => {
    expect(IMPACT_AWARD_TYPE).toBe(0);
    expect(ROOKIE_ALL_STAR_AWARD_TYPE).toBe(10);
    expect(IMPACT_AWARD_POINTS).toBe(DISTRICT_POINT_AWARD_VALUES.get(IMPACT_AWARD_TYPE));
    expect(ROOKIE_ALL_STAR_AWARD_POINTS).toBe(DISTRICT_POINT_AWARD_VALUES.get(ROOKIE_ALL_STAR_AWARD_TYPE));
    expect(SINGLE_AWARD_POINT_CEILING).toBe(IMPACT_AWARD_POINTS);
  });
});

describe("the stacked-award fold — two awards are never a prediction", () => {
  it("leaves every single-award support value exactly where it is", () => {
    expect(foldStackedAwardPoints(0)).toBe(0);
    expect(foldStackedAwardPoints(5)).toBe(5);
    expect(foldStackedAwardPoints(ROOKIE_ALL_STAR_AWARD_POINTS)).toBe(ROOKIE_ALL_STAR_AWARD_POINTS);
    expect(foldStackedAwardPoints(IMPACT_AWARD_POINTS)).toBe(IMPACT_AWARD_POINTS);
  });

  it("folds 13 onto Rookie All Star and 15 onto Impact, in that order — never 13 onto Impact", () => {
    expect(foldStackedAwardPoints(13)).toBe(ROOKIE_ALL_STAR_AWARD_POINTS);
    expect(foldStackedAwardPoints(15)).toBe(IMPACT_AWARD_POINTS);
  });

  it("folds a COMPOSED sum above Impact onto Impact, which is the highest single award that exists", () => {
    for (const composed of [18, 23, 28, 31]) expect(foldStackedAwardPoints(composed)).toBe(IMPACT_AWARD_POINTS);
  });

  it("never returns a value above the highest single award, over every support value and every composed sum", () => {
    for (const impact of [0, IMPACT_AWARD_POINTS]) {
      for (const rookie of [0, ROOKIE_ALL_STAR_AWARD_POINTS]) {
        for (const residual of AWARD_POINT_SUPPORT) {
          expect(foldStackedAwardPoints(impact + rookie + residual)).toBeLessThanOrEqual(SINGLE_AWARD_POINT_CEILING);
        }
      }
    }
  });

  it("moves mass rather than dropping it: a folded pmf still sums to one and empties the two stacked bins", () => {
    for (const raw of PMFS) {
      const folded = foldStackedAwardPmf(raw);
      expect(folded.reduce((sum, value) => sum + value, 0)).toBeCloseTo(raw.reduce((sum, value) => sum + value, 0), 12);
      expect(folded[4]).toBe(0);
      expect(folded[5]).toBe(0);
      expect(folded[2]).toBeCloseTo(raw[2]! + raw[4]!, 12);
      expect(folded[3]).toBeCloseTo(raw[3]! + raw[5]!, 12);
    }
  });

  it("lowers a pmf's mean, by exactly the points the fold gives up", () => {
    for (const raw of PMFS) {
      const givenUp = raw[4]! * (13 - ROOKIE_ALL_STAR_AWARD_POINTS) + raw[5]! * (15 - IMPACT_AWARD_POINTS);
      expect(mean(raw) - mean(foldStackedAwardPmf(raw))).toBeCloseTo(givenUp, 12);
    }
  });

  it("is idempotent, so a pmf folded twice is the pmf folded once", () => {
    for (const raw of PMFS) {
      const once = foldStackedAwardPmf(raw);
      expect([...foldStackedAwardPmf(once)]).toEqual([...once]);
    }
  });
});
