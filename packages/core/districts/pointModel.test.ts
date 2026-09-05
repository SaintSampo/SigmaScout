import { describe, expect, it } from "vitest";
import { DISTRICT_REGISTERED_SEASONS, maxEventPoints, maxRookieBonus, UnknownDistrictSeasonError } from "./pointModel.js";

describe("maxEventPoints", () => {
  it("returns the declared regular-tier ceiling for a registered season", () => {
    expect(maxEventPoints(2026, "district")).toEqual({ qual: 22, alliance: 16, elim: 30, award: 15 });
  });

  it("returns the dcmp tier ceiling as the district tier multiplied by the season's weight (3)", () => {
    const district = maxEventPoints(2026, "district");
    const dcmp = maxEventPoints(2026, "dcmp");
    expect(dcmp).toEqual({
      qual: district.qual * 3,
      alliance: district.alliance * 3,
      elim: district.elim * 3,
      award: district.award * 3,
    });
  });

  it("declares the dcmp weight per season rather than a single global constant -- every registered season independently resolves to weight 3", () => {
    for (const season of DISTRICT_REGISTERED_SEASONS) {
      const district = maxEventPoints(season, "district");
      const dcmp = maxEventPoints(season, "dcmp");
      expect(dcmp.qual).toBe(district.qual * 3);
      expect(dcmp.alliance).toBe(district.alliance * 3);
      expect(dcmp.elim).toBe(district.elim * 3);
      expect(dcmp.award).toBe(district.award * 3);
    }
  });

  it("throws a named error for an unlisted season, never returning a guessed ceiling", () => {
    expect(() => maxEventPoints(2021, "district")).toThrow(UnknownDistrictSeasonError);
    expect(() => maxEventPoints(2027, "dcmp")).toThrow(UnknownDistrictSeasonError);
  });

  it("covers every season this plan lists: 2019, 2020, 2022, 2023, 2024, 2025, 2026", () => {
    expect(DISTRICT_REGISTERED_SEASONS).toEqual([2019, 2020, 2022, 2023, 2024, 2025, 2026]);
  });
});

describe("maxRookieBonus", () => {
  it("returns the declared once-per-season rookie bonus ceiling", () => {
    expect(maxRookieBonus(2026)).toBe(10);
  });

  it("throws a named error for an unlisted season", () => {
    expect(() => maxRookieBonus(2021)).toThrow(UnknownDistrictSeasonError);
  });
});
