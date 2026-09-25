/**
 * Pure unit tests for the qualification-points formula — no corpus, no
 * filesystem, no network. This file is the half of the qualification proof
 * that CI actually runs: `pointFormulas.reconciliation.test.ts` skips
 * wherever `data/corpus.sqlite` is absent (which is everywhere except a
 * developer's main checkout), so if these tests were a formality the
 * formula would ship unproven in CI.
 */
import { describe, expect, it } from "vitest";
import {
  districtQualPoints,
  districtTierWeight,
  erfinv,
  ErfInvDomainError,
  InvalidRankInputError,
  qualPoints,
} from "./qualPoints.js";
import { DISTRICT_REGISTERED_SEASONS, maxEventPoints, UnknownDistrictSeasonError } from "./pointModel.js";

describe("erfinv", () => {
  it("is zero at zero", () => {
    expect(erfinv(0)).toBeCloseTo(0, 10);
  });

  it("is odd: erfinv(-x) is the negation of erfinv(x)", () => {
    for (const x of [0.05, 0.25, 0.5, 0.75, 0.9, 0.99, 1 / 1.07 - 0.001]) {
      expect(erfinv(-x), `erfinv is not odd at ${x}`).toBeCloseTo(-erfinv(x), 12);
    }
  });

  it("is monotonically increasing on its domain", () => {
    let previous = erfinv(-0.99);
    for (let x = -0.98; x < 0.99; x += 0.01) {
      const current = erfinv(x);
      expect(current, `erfinv decreased at ${x}`).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it("approximates known erfinv values", () => {
    // Reference values from the exact inverse error function; Winitzki's
    // approximation is good to roughly 2e-3 absolute, which is what this
    // tolerance encodes. A tighter tolerance here would be asserting a
    // precision the approximation never claimed.
    expect(erfinv(0.5)).toBeCloseTo(0.4769362762, 2);
    expect(erfinv(0.9)).toBeCloseTo(1.1630871537, 2);
    expect(erfinv(-0.5)).toBeCloseTo(-0.4769362762, 2);
  });

  it("throws at and beyond a domain edge rather than returning a non-finite value", () => {
    for (const x of [1, -1, 1.5, -1.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      expect(() => erfinv(x), `erfinv(${x}) should throw`).toThrow(ErfInvDomainError);
    }
  });
});

describe("qualPoints", () => {
  it("gives the field's top value at rank 1 and its bottom at rank fieldSize", () => {
    const top = qualPoints(1, 40);
    const bottom = qualPoints(40, 40);
    expect(top).toBeGreaterThan(bottom);
    // Rank 1 collapses the curve's argument to exactly 1/1.07, so the
    // scaled term is exactly the 10-point scale and the value is the
    // 22-point ceiling `pointModel.ts` declares.
    expect(top).toBe(22);
  });

  it("is monotonically non-increasing in rank at every plausible field size", () => {
    for (const fieldSize of [12, 24, 30, 36, 40, 45, 60, 80]) {
      let previous = Number.POSITIVE_INFINITY;
      for (let rank = 1; rank <= fieldSize; rank++) {
        const value = qualPoints(rank, fieldSize);
        expect(
          value,
          `qualPoints rose from rank ${rank - 1} to rank ${rank} at fieldSize ${fieldSize}`
        ).toBeLessThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it("never exceeds pointModel.ts's declared district-tier qualification ceiling", () => {
    const ceiling = maxEventPoints(2026, "district").qual;
    for (const fieldSize of [1, 2, 6, 12, 24, 30, 36, 40, 45, 60, 80, 100]) {
      for (let rank = 1; rank <= fieldSize; rank++) {
        expect(
          qualPoints(rank, fieldSize),
          `qualPoints(${rank}, ${fieldSize}) exceeds the declared ceiling ${ceiling}`
        ).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("is never negative at any plausible field size", () => {
    for (const fieldSize of [1, 2, 6, 12, 24, 40, 60, 100]) {
      for (let rank = 1; rank <= fieldSize; rank++) {
        expect(qualPoints(rank, fieldSize)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("throws a typed error for a field size below 1", () => {
    expect(() => qualPoints(1, 0)).toThrow(InvalidRankInputError);
    expect(() => qualPoints(1, -5)).toThrow(InvalidRankInputError);
  });

  it("throws a typed error for a rank below 1", () => {
    expect(() => qualPoints(0, 40)).toThrow(InvalidRankInputError);
    expect(() => qualPoints(-1, 40)).toThrow(InvalidRankInputError);
  });

  it("throws a typed error for a rank above the field size", () => {
    expect(() => qualPoints(41, 40)).toThrow(InvalidRankInputError);
  });

  it("throws a typed error for a non-integer rank or field size", () => {
    expect(() => qualPoints(1.5, 40)).toThrow(InvalidRankInputError);
    expect(() => qualPoints(1, 40.5)).toThrow(InvalidRankInputError);
  });
});

describe("districtTierWeight", () => {
  it("is 1 at the district tier for every registered season", () => {
    for (const season of DISTRICT_REGISTERED_SEASONS) {
      expect(districtTierWeight(season, "district"), `season ${season}`).toBe(1);
    }
  });

  it("is the dcmp/district qualification-ceiling ratio at the dcmp tier, which is 3 for every registered season", () => {
    for (const season of DISTRICT_REGISTERED_SEASONS) {
      const expected = maxEventPoints(season, "dcmp").qual / maxEventPoints(season, "district").qual;
      expect(districtTierWeight(season, "dcmp"), `season ${season}`).toBe(expected);
      expect(districtTierWeight(season, "dcmp"), `season ${season}`).toBe(3);
    }
  });

  it("propagates UnknownDistrictSeasonError for an unregistered season rather than defaulting", () => {
    for (const season of [2021, 2015, 2027]) {
      expect(() => districtTierWeight(season, "district"), `season ${season} district`).toThrow(UnknownDistrictSeasonError);
      expect(() => districtTierWeight(season, "dcmp"), `season ${season} dcmp`).toThrow(UnknownDistrictSeasonError);
    }
  });
});

describe("districtQualPoints", () => {
  it("equals qualPoints at the district tier", () => {
    for (const season of DISTRICT_REGISTERED_SEASONS) {
      for (const [rank, fieldSize] of [
        [1, 40],
        [7, 40],
        [20, 40],
        [40, 40],
        [1, 12],
      ] as const) {
        expect(districtQualPoints(season, "district", rank, fieldSize)).toBe(qualPoints(rank, fieldSize));
      }
    }
  });

  it("is exactly three times the district-tier value at the dcmp tier, for every registered season", () => {
    for (const season of DISTRICT_REGISTERED_SEASONS) {
      for (let rank = 1; rank <= 40; rank++) {
        expect(
          districtQualPoints(season, "dcmp", rank, 40),
          `season ${season} rank ${rank}`
        ).toBe(3 * districtQualPoints(season, "district", rank, 40));
      }
    }
  });

  it("propagates UnknownDistrictSeasonError for an unregistered season", () => {
    expect(() => districtQualPoints(2021, "district", 1, 40)).toThrow(UnknownDistrictSeasonError);
  });
});
