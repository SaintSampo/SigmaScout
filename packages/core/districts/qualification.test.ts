/**
 * `qualification.ts`'s behavior contract (quick task 260905-lic revision
 * R2a) -- the declared consuming/award-only award-type sets, the
 * qualification-relevance and award-only predicates, the per-season display
 * label rule (research Q4: award_type is invariant, only the label
 * rebrands at 2023), and the 2025fsc special-allocation flag (research's
 * documented exception).
 */
import { describe, expect, it } from "vitest";
import {
  AWARD_TYPE_ENGINEERING_INSPIRATION,
  AWARD_TYPE_IMPACT,
  AWARD_TYPE_ROOKIE_ALL_STAR,
  AWARD_TYPE_WINNER,
  awardDisplayName,
  consumingAwardTypesForTier,
  DCMP_TIER_CONSUMING_AWARD_TYPES,
  DISTRICT_TIER_AWARD_ONLY_TYPES,
  DISTRICT_TIER_CONSUMING_AWARD_TYPES,
  isAwardOnly,
  isQualificationRelevantAward,
  specialAllocationNote,
  UnknownAwardTypeError,
} from "./qualification.js";

describe("consumingAwardTypesForTier", () => {
  it("district tier consumes ONLY Impact/Chairman's (0) -- EI and RAS are award-only, never consuming", () => {
    expect(consumingAwardTypesForTier("district")).toBe(DISTRICT_TIER_CONSUMING_AWARD_TYPES);
    expect([...consumingAwardTypesForTier("district")]).toEqual([AWARD_TYPE_IMPACT]);
  });

  it("dcmp tier consumes all four: Impact (0), Winner (1), EI (9), RAS (10)", () => {
    expect(consumingAwardTypesForTier("dcmp")).toBe(DCMP_TIER_CONSUMING_AWARD_TYPES);
    expect([...consumingAwardTypesForTier("dcmp")].sort((a, b) => a - b)).toEqual([
      AWARD_TYPE_IMPACT,
      AWARD_TYPE_WINNER,
      AWARD_TYPE_ENGINEERING_INSPIRATION,
      AWARD_TYPE_ROOKIE_ALL_STAR,
    ]);
  });
});

describe("DISTRICT_TIER_AWARD_ONLY_TYPES", () => {
  it("is exactly {EI, RAS} -- Impact is never award-only at the district tier", () => {
    expect([...DISTRICT_TIER_AWARD_ONLY_TYPES].sort((a, b) => a - b)).toEqual([
      AWARD_TYPE_ENGINEERING_INSPIRATION,
      AWARD_TYPE_ROOKIE_ALL_STAR,
    ]);
    expect(DISTRICT_TIER_AWARD_ONLY_TYPES.has(AWARD_TYPE_IMPACT)).toBe(false);
  });
});

describe("isQualificationRelevantAward", () => {
  it("district tier: Impact (0), EI (9) and RAS (10) are relevant; Winner (1) is NOT", () => {
    expect(isQualificationRelevantAward(AWARD_TYPE_IMPACT, "district")).toBe(true);
    expect(isQualificationRelevantAward(AWARD_TYPE_ENGINEERING_INSPIRATION, "district")).toBe(true);
    expect(isQualificationRelevantAward(AWARD_TYPE_ROOKIE_ALL_STAR, "district")).toBe(true);
    expect(isQualificationRelevantAward(AWARD_TYPE_WINNER, "district")).toBe(false);
  });

  it("dcmp tier: all four of Impact/Winner/EI/RAS are relevant", () => {
    expect(isQualificationRelevantAward(AWARD_TYPE_IMPACT, "dcmp")).toBe(true);
    expect(isQualificationRelevantAward(AWARD_TYPE_WINNER, "dcmp")).toBe(true);
    expect(isQualificationRelevantAward(AWARD_TYPE_ENGINEERING_INSPIRATION, "dcmp")).toBe(true);
    expect(isQualificationRelevantAward(AWARD_TYPE_ROOKIE_ALL_STAR, "dcmp")).toBe(true);
  });

  it("an unrelated award_type (e.g. Finalist, 2) is not relevant at either tier", () => {
    expect(isQualificationRelevantAward(2, "district")).toBe(false);
    expect(isQualificationRelevantAward(2, "dcmp")).toBe(false);
  });
});

describe("isAwardOnly", () => {
  it("EI and RAS are award-only at the district tier", () => {
    expect(isAwardOnly(AWARD_TYPE_ENGINEERING_INSPIRATION, "district")).toBe(true);
    expect(isAwardOnly(AWARD_TYPE_ROOKIE_ALL_STAR, "district")).toBe(true);
  });

  it("Impact is never award-only at the district tier -- it is the one full qualifier there", () => {
    expect(isAwardOnly(AWARD_TYPE_IMPACT, "district")).toBe(false);
  });

  it("nothing is award-only at the dcmp tier -- every consuming type there is a full qualifier", () => {
    expect(isAwardOnly(AWARD_TYPE_IMPACT, "dcmp")).toBe(false);
    expect(isAwardOnly(AWARD_TYPE_WINNER, "dcmp")).toBe(false);
    expect(isAwardOnly(AWARD_TYPE_ENGINEERING_INSPIRATION, "dcmp")).toBe(false);
    expect(isAwardOnly(AWARD_TYPE_ROOKIE_ALL_STAR, "dcmp")).toBe(false);
  });
});

describe("awardDisplayName", () => {
  it("Impact/Chairman's is 'Chairman's Award' before 2023 and 'FIRST Impact Award' from 2023 on -- the ONLY season-branched label", () => {
    expect(awardDisplayName(AWARD_TYPE_IMPACT, 2019)).toBe("Chairman's Award");
    expect(awardDisplayName(AWARD_TYPE_IMPACT, 2022)).toBe("Chairman's Award");
    expect(awardDisplayName(AWARD_TYPE_IMPACT, 2023)).toBe("FIRST Impact Award");
    expect(awardDisplayName(AWARD_TYPE_IMPACT, 2026)).toBe("FIRST Impact Award");
  });

  it("Winner/EI/RAS labels do not vary by season", () => {
    expect(awardDisplayName(AWARD_TYPE_WINNER, 2019)).toBe("Winner");
    expect(awardDisplayName(AWARD_TYPE_WINNER, 2026)).toBe("Winner");
    expect(awardDisplayName(AWARD_TYPE_ENGINEERING_INSPIRATION, 2026)).toBe("Engineering Inspiration");
    expect(awardDisplayName(AWARD_TYPE_ROOKIE_ALL_STAR, 2026)).toBe("Rookie All Star");
  });

  it("throws UnknownAwardTypeError for an award_type this module does not label, never guesses a label", () => {
    expect(() => awardDisplayName(2, 2026)).toThrow(UnknownAwardTypeError);
    expect(() => awardDisplayName(68, 2026)).toThrow(UnknownAwardTypeError);
  });
});

describe("specialAllocationNote", () => {
  it("flags 2025fsc with the documented not-modeled note", () => {
    expect(specialAllocationNote("2025fsc")).toBe("special allocation — not modeled");
  });

  it("returns null for 2026fsc -- the exception is gone in 2026 (standard model, 7 slots)", () => {
    expect(specialAllocationNote("2026fsc")).toBeNull();
  });

  it("returns null for every ordinary district-year", () => {
    expect(specialAllocationNote("2026fnc")).toBeNull();
    expect(specialAllocationNote("2019fim")).toBeNull();
  });
});
