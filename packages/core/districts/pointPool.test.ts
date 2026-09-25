/**
 * The pure half of `pointPool.ts`'s proof, which is the half CI actually runs
 * — `pointPool.reconciliation.test.ts` skips wherever `data/corpus.sqlite` is
 * absent, and a green skip proves nothing.
 *
 * What is pinned here and why:
 *
 *   1. THE THREE FIXED POOLS BY VALUE. 236, 213 and the three award values are
 *      the numbers the whole pooled lock rests on. A silent change to any of
 *      them shrinks the pool, and a shrinking pool publishes a `Locked`
 *      guarantee that is not true.
 *   2. THE SELECTION POOL AGAINST ITS OWN SUMMANDS. `SELECTION_POOL` is
 *      computed from `selectionPoints.ts` rather than typed, so the assertion
 *      that matters is that the sum really is the eight captains plus the eight
 *      first picks plus the eight second picks, and 100 + 100 + 36 is checked
 *      part by part.
 *   3. MONOTONICITY IN FIELD SIZE AND ROOKIE COUNT. A bigger field is worth
 *      more, never less; a rookie adds award points, never removes them. Both
 *      are properties a future edit could break without moving any of the
 *      pinned values.
 *   4. THE OPEN-CATEGORY SELECTION. A category that is final contributes
 *      nothing, and a fully finished event's pool is exactly zero — which is
 *      what makes a finished season's verdicts identical with and without the
 *      pooled argument.
 */
import { describe, expect, it } from "vitest";
import {
  AWARD_POOL_BASE,
  AWARD_POOL_FIRST_ROOKIE,
  AWARD_POOL_SECOND_ROOKIE,
  InvalidPoolInputError,
  PLAYOFF_POOL,
  QUAL_POOL_PHANTOM_ATTENDEES,
  SELECTION_POOL,
  awardPool,
  eventHasOpenCategory,
  eventRemainingPool,
  qualificationPool,
} from "./pointPool.js";
import { PLAYOFF_PLACEMENT_POINTS } from "./bracket.js";
import { qualPoints } from "./qualPoints.js";
import { selectionPoints } from "./selectionPoints.js";
import { ALL_CATEGORIES_OPEN, type DistrictCategoryFinality } from "./reservedSlots.js";

const ALL_FINAL: DistrictCategoryFinality = { qual: true, alliance: true, elim: true, award: true };

describe("SELECTION_POOL", () => {
  it("is 236, the eight captains plus the eight first picks plus the eight second picks", () => {
    const captains = [1, 2, 3, 4, 5, 6, 7, 8].reduce((sum, alliance) => sum + selectionPoints(0, alliance), 0);
    const firstPicks = [1, 2, 3, 4, 5, 6, 7, 8].reduce((sum, alliance) => sum + selectionPoints(1, alliance), 0);
    const secondPicks = [1, 2, 3, 4, 5, 6, 7, 8].reduce((sum, alliance) => sum + selectionPoints(2, alliance), 0);
    expect(captains).toBe(100);
    expect(firstPicks).toBe(100);
    expect(secondPicks).toBe(36);
    expect(SELECTION_POOL).toBe(236);
    expect(SELECTION_POOL).toBe(captains + firstPicks + secondPicks);
  });

  it("counts the backup robot's slot as worth nothing, so it adds no pool", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].reduce((sum, alliance) => sum + selectionPoints(3, alliance), 0)).toBe(0);
  });
});

describe("PLAYOFF_POOL", () => {
  it("is 213: every placement's value paid to three robots, plus three for a backup robot's prorated share", () => {
    const perAlliance = PLAYOFF_PLACEMENT_POINTS.reduce((sum, points) => sum + points, 0);
    expect(perAlliance).toBe(70);
    expect(PLAYOFF_POOL).toBe(perAlliance * 3 + 3);
    expect(PLAYOFF_POOL).toBe(213);
  });
});

describe("awardPool", () => {
  it("is 78, 86 and 91 by attending rookie count, Impact included", () => {
    expect(awardPool(0)).toBe(78);
    expect(awardPool(1)).toBe(86);
    expect(awardPool(2)).toBe(91);
  });

  it("is flat above two rookies, because a third unlocks no further award", () => {
    expect(awardPool(3)).toBe(91);
    expect(awardPool(40)).toBe(91);
  });

  it("names its two rookie increments rather than hiding them inside three literals", () => {
    expect(AWARD_POOL_BASE).toBe(78);
    expect(AWARD_POOL_FIRST_ROOKIE).toBe(8);
    expect(AWARD_POOL_SECOND_ROOKIE).toBe(5);
    expect(awardPool(1) - awardPool(0)).toBe(AWARD_POOL_FIRST_ROOKIE);
    expect(awardPool(2) - awardPool(1)).toBe(AWARD_POOL_SECOND_ROOKIE);
  });

  it("refuses a negative or fractional rookie count rather than returning a smaller pool", () => {
    expect(() => awardPool(-1)).toThrow(InvalidPoolInputError);
    expect(() => awardPool(1.5)).toThrow(InvalidPoolInputError);
  });
});

describe("qualificationPool", () => {
  it("sums f(1) through f(fieldSize), each evaluated at fieldSize plus the phantom-attendee margin", () => {
    expect(QUAL_POOL_PHANTOM_ATTENDEES).toBe(3);
    let expected = 0;
    for (let rank = 1; rank <= 40; rank++) expected += qualPoints(rank, 43);
    expect(qualificationPool(40)).toBe(expected);
    expect(qualificationPool(40)).toBe(533);
  });

  it("is strictly larger than the unmargined sum, which is what covers a field bigger than the artifact shows", () => {
    let unmargined = 0;
    for (let rank = 1; rank <= 40; rank++) unmargined += qualPoints(rank, 40);
    expect(qualificationPool(40)).toBeGreaterThan(unmargined);
  });

  it("grows with the field size", () => {
    let previous = 0;
    for (const fieldSize of [1, 2, 12, 26, 40, 45]) {
      const pool = qualificationPool(fieldSize);
      expect(pool).toBeGreaterThan(previous);
      previous = pool;
    }
    expect(qualificationPool(1)).toBe(22);
    expect(qualificationPool(26)).toBe(357);
    expect(qualificationPool(45)).toBe(595);
  });

  it("refuses a field size that cannot describe a real event", () => {
    expect(() => qualificationPool(0)).toThrow(InvalidPoolInputError);
    expect(() => qualificationPool(-4)).toThrow(InvalidPoolInputError);
    expect(() => qualificationPool(12.5)).toThrow(InvalidPoolInputError);
  });
});

describe("eventRemainingPool", () => {
  it("prices a 40-team event with no rookie, one rookie and two rookies", () => {
    const pool = (rookieCount: number): number => eventRemainingPool({ fieldSize: 40, rookieCount, final: ALL_CATEGORIES_OPEN });
    expect(pool(0)).toBe(1060);
    expect(pool(1)).toBe(1068);
    expect(pool(2)).toBe(1073);
    // The whole of the difference between the three is the award pool.
    expect(pool(0)).toBe(533 + 236 + 213 + 78);
  });

  it("is exactly zero for a finished event, which is every event of a finished season", () => {
    expect(eventRemainingPool({ fieldSize: 40, rookieCount: 2, final: ALL_FINAL })).toBe(0);
  });

  it("adds only the categories that are still open", () => {
    const at = (final: DistrictCategoryFinality): number => eventRemainingPool({ fieldSize: 40, rookieCount: 0, final });
    expect(at({ ...ALL_FINAL, qual: false })).toBe(533);
    expect(at({ ...ALL_FINAL, alliance: false })).toBe(236);
    expect(at({ ...ALL_FINAL, elim: false })).toBe(213);
    expect(at({ ...ALL_FINAL, award: false })).toBe(78);
  });

  it("prices a part played event at its whole open pool, which over-counts on the safe side", () => {
    // Quals done, alliances picked, playoffs and awards still to come.
    expect(eventRemainingPool({ fieldSize: 40, rookieCount: 1, final: { qual: true, alliance: true, elim: false, award: false } })).toBe(213 + 86);
  });
});

describe("eventHasOpenCategory", () => {
  it("is true for any open category and false only when all four are final", () => {
    expect(eventHasOpenCategory(ALL_CATEGORIES_OPEN)).toBe(true);
    expect(eventHasOpenCategory(ALL_FINAL)).toBe(false);
    for (const key of ["qual", "alliance", "elim", "award"] as const) {
      expect(eventHasOpenCategory({ ...ALL_FINAL, [key]: false })).toBe(true);
    }
  });
});
