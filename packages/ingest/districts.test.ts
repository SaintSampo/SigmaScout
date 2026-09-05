/**
 * tbaDistrictListSchema / tbaDistrictRankingsResponseSchema /
 * tbaKeysResponseSchema / normalizeDistricts / normalizeDistrictRankings
 * tests (quick task 260905-lic Task 1), from the live TBA response shapes
 * probed 2026-09-05 (see the plan's context section). Mirrors
 * `alliances.test.ts`'s fixture-factory structure — one factory per shape,
 * each case states only what it varies.
 */
import { describe, expect, it } from "vitest";
import { normalizeDistrictRankings, normalizeDistricts } from "./districts.js";
import {
  tbaDistrictListSchema,
  tbaDistrictRankingsResponseSchema,
  tbaKeysResponseSchema,
  type TbaDistrictListElement,
  type TbaDistrictRanking,
} from "./schemas.js";

function districtElement(overrides: Partial<TbaDistrictListElement> = {}): TbaDistrictListElement {
  return {
    abbreviation: "fnc",
    display_name: "FIRST North Carolina",
    key: "2026fnc",
    year: 2026,
    official_advancement_counts: { cmp: 19, dcmp: 54 },
    ...overrides,
  };
}

function districtRankingEntry(overrides: Partial<TbaDistrictRanking> = {}): TbaDistrictRanking {
  return {
    team_key: "frc4561",
    rank: 1,
    point_total: 352,
    rookie_bonus: 0,
    adjustments: 0,
    event_points: [
      {
        event_key: "2026ncwak",
        district_cmp: false,
        qual_points: 21,
        alliance_points: 16,
        elim_points: 20,
        award_points: 5,
        total: 62,
      },
      {
        event_key: "2026nccmp",
        district_cmp: true,
        qual_points: 60,
        alliance_points: 45,
        elim_points: 90,
        award_points: 30,
        total: 225,
      },
    ],
    ...overrides,
  };
}

describe("tbaDistrictListSchema", () => {
  it("parses a null body without throwing and yields null", () => {
    expect(() => tbaDistrictListSchema.parse(null)).not.toThrow();
    expect(tbaDistrictListSchema.parse(null)).toBeNull();
  });

  it("parses an empty array response without throwing", () => {
    expect(() => tbaDistrictListSchema.parse([])).not.toThrow();
    expect(tbaDistrictListSchema.parse([])).toEqual([]);
  });

  it("parses the real 2026fnc-shaped response", () => {
    expect(() => tbaDistrictListSchema.parse([districtElement()])).not.toThrow();
  });

  it("parses a district-year with no official_advancement_counts key at all", () => {
    const { official_advancement_counts: _oac, ...withoutCounts } = districtElement();
    expect(() => tbaDistrictListSchema.parse([withoutCounts])).not.toThrow();
  });

  it("parses a district-year with official_advancement_counts explicitly null", () => {
    expect(() => tbaDistrictListSchema.parse([districtElement({ official_advancement_counts: null })])).not.toThrow();
  });

  it("throws on a drifted payload — key retyped from a string to a number", () => {
    const drifted = [{ ...districtElement(), key: 2026 }];
    expect(() => tbaDistrictListSchema.parse(drifted)).toThrow();
  });
});

describe("tbaDistrictRankingsResponseSchema", () => {
  it("parses a null body without throwing and yields null", () => {
    expect(() => tbaDistrictRankingsResponseSchema.parse(null)).not.toThrow();
    expect(tbaDistrictRankingsResponseSchema.parse(null)).toBeNull();
  });

  it("parses an empty array response without throwing", () => {
    expect(() => tbaDistrictRankingsResponseSchema.parse([])).not.toThrow();
    expect(tbaDistrictRankingsResponseSchema.parse([])).toEqual([]);
  });

  it("parses the real 2026fnc rankings-shaped response, including the district championship's 3x row", () => {
    expect(() => tbaDistrictRankingsResponseSchema.parse([districtRankingEntry()])).not.toThrow();
  });

  it("does not strip unmodelled event_points fields — event_points is z.unknown() per component, so an extra key survives parsing verbatim", () => {
    const entry = districtRankingEntry({
      event_points: [{ event_key: "2026ncwak", district_cmp: false, some_future_field: "x" }],
    });
    const parsed = tbaDistrictRankingsResponseSchema.parse([entry]);
    expect(parsed?.[0]?.event_points).toEqual([{ event_key: "2026ncwak", district_cmp: false, some_future_field: "x" }]);
  });

  it("throws on a drifted payload — team_key retyped from a string to a number", () => {
    const drifted = [{ ...districtRankingEntry(), team_key: 4561 }];
    expect(() => tbaDistrictRankingsResponseSchema.parse(drifted)).toThrow();
  });

  it("throws on a drifted payload — rank present but non-integral", () => {
    const drifted = [{ ...districtRankingEntry(), rank: 1.5 }];
    expect(() => tbaDistrictRankingsResponseSchema.parse(drifted)).toThrow();
  });
});

describe("tbaKeysResponseSchema", () => {
  it("parses a null body without throwing and yields null", () => {
    expect(() => tbaKeysResponseSchema.parse(null)).not.toThrow();
    expect(tbaKeysResponseSchema.parse(null)).toBeNull();
  });

  it("parses an empty array without throwing", () => {
    expect(tbaKeysResponseSchema.parse([])).toEqual([]);
  });

  it("parses a real bare string-array response (7 district event keys, matching the live 2026fnc probe)", () => {
    const keys = ["2026ncwak", "2026ncash", "2026nccha", "2026ncgas", "2026nchic", "2026ncmwa", "2026nccmp"];
    expect(tbaKeysResponseSchema.parse(keys)).toEqual(keys);
  });

  it("throws on a drifted payload — an array element that is not a string", () => {
    expect(() => tbaKeysResponseSchema.parse(["2026ncwak", 42])).toThrow();
  });
});

describe("normalizeDistricts", () => {
  it("normalizes a null response to an empty array, does not throw", () => {
    expect(() => normalizeDistricts(null)).not.toThrow();
    expect(normalizeDistricts(null)).toEqual([]);
  });

  it("normalizes a response with an empty array to an empty array — a SEPARATE case from the null-response case", () => {
    expect(() => normalizeDistricts([])).not.toThrow();
    expect(normalizeDistricts([])).toEqual([]);
  });

  it("districtKey is TBA's own year-prefixed key, distinct from abbreviation", () => {
    const result = normalizeDistricts([districtElement()]);
    expect(result[0]?.districtKey).toBe("2026fnc");
    expect(result[0]?.abbreviation).toBe("fnc");
    expect(result[0]?.districtKey).not.toBe(result[0]?.abbreviation);
  });

  it("a district with official_advancement_counts normalizes dcmpSlots/cmpSlots from dcmp/cmp", () => {
    const result = normalizeDistricts([districtElement({ official_advancement_counts: { cmp: 19, dcmp: 54 } })]);
    expect(result[0]?.dcmpSlots).toBe(54);
    expect(result[0]?.cmpSlots).toBe(19);
  });

  it("a district with no official_advancement_counts key at all normalizes to null slots, never zero", () => {
    const { official_advancement_counts: _oac, ...withoutCounts } = districtElement();
    const result = normalizeDistricts([withoutCounts]);
    expect(result[0]?.dcmpSlots).toBeNull();
    expect(result[0]?.cmpSlots).toBeNull();
  });

  it("a district with official_advancement_counts explicitly null normalizes to null slots, never zero", () => {
    const result = normalizeDistricts([districtElement({ official_advancement_counts: null })]);
    expect(result[0]?.dcmpSlots).toBeNull();
    expect(result[0]?.cmpSlots).toBeNull();
  });

  it("year and displayName pass through verbatim", () => {
    const result = normalizeDistricts([districtElement({ year: 2019, display_name: "FIRST North Carolina" })]);
    expect(result[0]?.year).toBe(2019);
    expect(result[0]?.displayName).toBe("FIRST North Carolina");
  });

  it("never reorders districts, regardless of the response's given order", () => {
    const entries = [
      districtElement({ key: "2026third", abbreviation: "third" }),
      districtElement({ key: "2026first", abbreviation: "first" }),
      districtElement({ key: "2026second", abbreviation: "second" }),
    ];
    const result = normalizeDistricts(entries);
    expect(result.map((r) => r.districtKey)).toEqual(["2026third", "2026first", "2026second"]);
  });
});

describe("normalizeDistrictRankings", () => {
  it("normalizes a null response to an empty array, does not throw", () => {
    expect(() => normalizeDistrictRankings(null)).not.toThrow();
    expect(normalizeDistrictRankings(null)).toEqual([]);
  });

  it("normalizes a response with an empty array to an empty array — a SEPARATE case from the null-response case", () => {
    expect(() => normalizeDistrictRankings([])).not.toThrow();
    expect(normalizeDistrictRankings([])).toEqual([]);
  });

  it("rank/pointTotal/rookieBonus/adjustments pass through verbatim from TBA's own fields", () => {
    const result = normalizeDistrictRankings([
      districtRankingEntry({ rank: 3, point_total: 200, rookie_bonus: 10, adjustments: -5 }),
    ]);
    expect(result[0]?.rank).toBe(3);
    expect(result[0]?.pointTotal).toBe(200);
    expect(result[0]?.rookieBonus).toBe(10);
    expect(result[0]?.adjustments).toBe(-5);
  });

  it("eventPointsRaw round-trips byte-identically: JSON.parse(eventPointsRaw) deep-equals the original event_points array", () => {
    const entry = districtRankingEntry();
    const result = normalizeDistrictRankings([entry]);
    expect(result[0]?.eventPointsRaw).toBeTypeOf("string");
    expect(JSON.parse(result[0]!.eventPointsRaw)).toEqual(entry.event_points);
  });

  it("eventPointsRaw preserves the district championship's 3x row exactly, including district_cmp: true", () => {
    const entry = districtRankingEntry();
    const result = normalizeDistrictRankings([entry]);
    const parsed = JSON.parse(result[0]!.eventPointsRaw) as unknown[];
    expect(parsed).toHaveLength(2);
    expect((parsed[1] as { district_cmp: boolean }).district_cmp).toBe(true);
  });

  it("never reorders teams, regardless of the response's given order", () => {
    const entries = [
      districtRankingEntry({ team_key: "frcThird", rank: 3 }),
      districtRankingEntry({ team_key: "frcFirst", rank: 1 }),
      districtRankingEntry({ team_key: "frcSecond", rank: 2 }),
    ];
    const result = normalizeDistrictRankings(entries);
    expect(result.map((r) => r.teamKey)).toEqual(["frcThird", "frcFirst", "frcSecond"]);
  });
});
