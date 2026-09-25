/**
 * Pure unit tests for the alliance-selection point formula — no corpus, no
 * filesystem. Exhaustive over all four pick slots crossed with all eight
 * alliance numbers: 32 cases is cheap and total, so there is no reason to
 * sample.
 *
 * This file is the half of the selection proof CI runs, because
 * `pointFormulas.reconciliation.test.ts` skips wherever
 * `data/corpus.sqlite` is absent. It matters more than usual here: the
 * second-pick form stated in the first draft of `10-CONTEXT.md` was wrong
 * and scored 0 of 969 real rows, so this formula is one the project has
 * already got wrong once from memory.
 */
import { describe, expect, it } from "vitest";
import { districtSelectionPoints, InvalidPickSlotError, selectionPoints } from "./selectionPoints.js";
import { DISTRICT_REGISTERED_SEASONS, maxEventPoints, UnknownDistrictSeasonError } from "./pointModel.js";

const ALLIANCE_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const PICK_SLOTS = [0, 1, 2, 3] as const;

describe("selectionPoints", () => {
  it("gives the captain 17 minus the alliance number, exhaustively", () => {
    for (const allianceNumber of ALLIANCE_NUMBERS) {
      expect(selectionPoints(0, allianceNumber), `captain of alliance ${allianceNumber}`).toBe(17 - allianceNumber);
    }
    // The two boundary values CONTEXT.md names explicitly.
    expect(selectionPoints(0, 1)).toBe(16);
    expect(selectionPoints(0, 8)).toBe(9);
  });

  it("gives the first pick the same 17 minus the alliance number, exhaustively", () => {
    for (const allianceNumber of ALLIANCE_NUMBERS) {
      expect(selectionPoints(1, allianceNumber), `first pick of alliance ${allianceNumber}`).toBe(17 - allianceNumber);
    }
  });

  it("gives the second pick the alliance number itself, exhaustively — NOT 9 minus it", () => {
    for (const allianceNumber of ALLIANCE_NUMBERS) {
      expect(selectionPoints(2, allianceNumber), `second pick of alliance ${allianceNumber}`).toBe(allianceNumber);
      // The form the first draft of 10-CONTEXT.md stated, which scored 0 of
      // 969 real corpus rows. Pinned as a negative so nobody reintroduces it
      // (the two forms coincide only at the non-integer 4.5, so this holds at
      // every real alliance number).
      expect(selectionPoints(2, allianceNumber)).not.toBe(9 - allianceNumber);
    }
    expect(selectionPoints(2, 1)).toBe(1);
    expect(selectionPoints(2, 8)).toBe(8);
  });

  it("gives a fourth robot 0 at every alliance number", () => {
    for (const allianceNumber of ALLIANCE_NUMBERS) {
      expect(selectionPoints(3, allianceNumber), `backup robot of alliance ${allianceNumber}`).toBe(0);
    }
  });

  it("covers all 32 slot-by-alliance combinations with a finite non-negative integer", () => {
    let cases = 0;
    for (const pickSlot of PICK_SLOTS) {
      for (const allianceNumber of ALLIANCE_NUMBERS) {
        const value = selectionPoints(pickSlot, allianceNumber);
        expect(Number.isInteger(value), `slot ${pickSlot} alliance ${allianceNumber} is not an integer`).toBe(true);
        expect(value, `slot ${pickSlot} alliance ${allianceNumber} is negative`).toBeGreaterThanOrEqual(0);
        cases++;
      }
    }
    expect(cases).toBe(32);
  });

  it("sums the captain and second-pick slots to 17 at every alliance number — the pair's internal identity", () => {
    for (const allianceNumber of ALLIANCE_NUMBERS) {
      expect(
        selectionPoints(0, allianceNumber) + selectionPoints(2, allianceNumber),
        `alliance ${allianceNumber}`
      ).toBe(17);
    }
  });

  it("never exceeds pointModel.ts's declared district-tier alliance ceiling", () => {
    const ceiling = maxEventPoints(2026, "district").alliance;
    for (const pickSlot of PICK_SLOTS) {
      for (const allianceNumber of ALLIANCE_NUMBERS) {
        expect(
          selectionPoints(pickSlot, allianceNumber),
          `slot ${pickSlot} alliance ${allianceNumber} exceeds the declared ceiling ${ceiling}`
        ).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("throws a typed error for a pick slot above 3 rather than returning 0", () => {
    for (const pickSlot of [4, 5, 12]) {
      expect(() => selectionPoints(pickSlot, 1), `slot ${pickSlot}`).toThrow(InvalidPickSlotError);
    }
  });

  it("throws a typed error for a negative or non-integer pick slot", () => {
    expect(() => selectionPoints(-1, 1)).toThrow(InvalidPickSlotError);
    expect(() => selectionPoints(1.5, 1)).toThrow(InvalidPickSlotError);
  });

  it("throws a typed error for an alliance number below 1 or above 8", () => {
    for (const allianceNumber of [0, -1, 9, 16]) {
      expect(() => selectionPoints(0, allianceNumber), `alliance ${allianceNumber}`).toThrow(InvalidPickSlotError);
    }
    expect(() => selectionPoints(0, 2.5)).toThrow(InvalidPickSlotError);
  });
});

describe("districtSelectionPoints", () => {
  it("equals selectionPoints at the district tier for every registered season", () => {
    for (const season of DISTRICT_REGISTERED_SEASONS) {
      for (const pickSlot of PICK_SLOTS) {
        for (const allianceNumber of ALLIANCE_NUMBERS) {
          expect(
            districtSelectionPoints(season, "district", pickSlot, allianceNumber),
            `season ${season} slot ${pickSlot} alliance ${allianceNumber}`
          ).toBe(selectionPoints(pickSlot, allianceNumber));
        }
      }
    }
  });

  it("is exactly three times the district-tier value at the dcmp tier, for every registered season", () => {
    for (const season of DISTRICT_REGISTERED_SEASONS) {
      for (const pickSlot of PICK_SLOTS) {
        for (const allianceNumber of ALLIANCE_NUMBERS) {
          expect(
            districtSelectionPoints(season, "dcmp", pickSlot, allianceNumber),
            `season ${season} slot ${pickSlot} alliance ${allianceNumber}`
          ).toBe(3 * selectionPoints(pickSlot, allianceNumber));
        }
      }
    }
  });

  it("never exceeds pointModel.ts's declared ceiling at either tier, for every registered season", () => {
    for (const season of DISTRICT_REGISTERED_SEASONS) {
      for (const tier of ["district", "dcmp"] as const) {
        const ceiling = maxEventPoints(season, tier).alliance;
        for (const pickSlot of PICK_SLOTS) {
          for (const allianceNumber of ALLIANCE_NUMBERS) {
            expect(
              districtSelectionPoints(season, tier, pickSlot, allianceNumber),
              `season ${season} ${tier} slot ${pickSlot} alliance ${allianceNumber} exceeds ${ceiling}`
            ).toBeLessThanOrEqual(ceiling);
          }
        }
      }
    }
  });

  it("propagates UnknownDistrictSeasonError for an unregistered season rather than defaulting", () => {
    expect(() => districtSelectionPoints(2021, "district", 0, 1)).toThrow(UnknownDistrictSeasonError);
    expect(() => districtSelectionPoints(2021, "dcmp", 0, 1)).toThrow(UnknownDistrictSeasonError);
  });
});
