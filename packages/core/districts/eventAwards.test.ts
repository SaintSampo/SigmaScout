/**
 * `eventAwards.ts`'s behavior contract (quick task 261009-r9x): the one
 * "awards posted" rule at both vantages, the judged award test, the award
 * points test, and the one qualifying award record builder at both tiers.
 */
import { describe, expect, it } from "vitest";
import {
  AWARD_TYPE_FINALIST,
  awardPointsPresentAt,
  awardsPostedRule,
  isJudgedAwardType,
  judgedAwardListed,
  qualifyingAwardRecord,
} from "./eventAwards.js";

describe("isJudgedAwardType", () => {
  it("reads Winner (1) and Finalist (2) as not judged, from the type alone", () => {
    expect(AWARD_TYPE_FINALIST).toBe(2);
    expect(isJudgedAwardType(1)).toBe(false);
    expect(isJudgedAwardType(2)).toBe(false);
  });

  it("reads every other type as judged: Impact, an unlabelled type, Engineering Inspiration, Rookie All Star, Woodie Flowers", () => {
    for (const awardType of [0, 5, 9, 10, 11]) expect(isJudgedAwardType(awardType)).toBe(true);
  });
});

describe("judgedAwardListed", () => {
  it("is false for an empty list and for a Winner and Finalist only list", () => {
    expect(judgedAwardListed([])).toBe(false);
    expect(judgedAwardListed([1, 2])).toBe(false);
    expect(judgedAwardListed([1, 1, 1, 2, 2, 2])).toBe(false);
  });

  it("is true as soon as one judged type is listed, beside Winner and Finalist or alone", () => {
    expect(judgedAwardListed([1, 2, 0])).toBe(true);
    expect(judgedAwardListed([5])).toBe(true);
    expect(judgedAwardListed(new Set([2, 9]))).toBe(true);
  });
});

describe("awardsPostedRule", () => {
  const cells = [
    { judgedAwardListed: false, awardPointsPresent: false },
    { judgedAwardListed: true, awardPointsPresent: false },
    { judgedAwardListed: false, awardPointsPresent: true },
    { judgedAwardListed: true, awardPointsPresent: true },
  ] as const;

  it("live: only a judged award listed AND award points present reads true", () => {
    expect(cells.map((facts) => awardsPostedRule(facts, "live"))).toEqual([false, false, false, true]);
  });

  it("hindsight: only neither fact reads false", () => {
    expect(cells.map((facts) => awardsPostedRule(facts, "hindsight"))).toEqual([false, true, true, true]);
  });
});

describe("awardPointsPresentAt", () => {
  const row = (eventKey: string, award: number) => ({ eventKey, award });

  it("is false when every row at the event carries zero award points", () => {
    expect(awardPointsPresentAt([{ eventPoints: [row("2026e1", 0)] }, { eventPoints: [row("2026e1", 0)] }], "2026e1")).toBe(false);
    expect(awardPointsPresentAt([], "2026e1")).toBe(false);
  });

  it("is true when one row at the event carries award points above zero", () => {
    expect(awardPointsPresentAt([{ eventPoints: [row("2026e1", 0)] }, { eventPoints: [row("2026e0", 0), row("2026e1", 5)] }], "2026e1")).toBe(true);
  });

  it("is false when the only award points are at another event", () => {
    expect(awardPointsPresentAt([{ eventPoints: [row("2026e0", 10), row("2026e1", 0)] }], "2026e1")).toBe(false);
  });
});

describe("qualifyingAwardRecord", () => {
  it("builds the Impact record at the district tier, labelled by season", () => {
    expect(qualifyingAwardRecord({ eventKey: "2026ncwak", awardType: 0, tier: "district", season: 2026 })).toEqual({
      eventKey: "2026ncwak",
      awardType: 0,
      label: "FIRST Impact Award",
      awardOnly: false,
    });
    expect(qualifyingAwardRecord({ eventKey: "2022ncwak", awardType: 0, tier: "district", season: 2022 })).toEqual({
      eventKey: "2022ncwak",
      awardType: 0,
      label: "Chairman's Award",
      awardOnly: false,
    });
  });

  it("marks Engineering Inspiration and Rookie All Star at the district tier as award only", () => {
    expect(qualifyingAwardRecord({ eventKey: "2026ncwak", awardType: 9, tier: "district", season: 2026 })).toEqual({
      eventKey: "2026ncwak",
      awardType: 9,
      label: "Engineering Inspiration",
      awardOnly: true,
    });
    expect(qualifyingAwardRecord({ eventKey: "2026ncwak", awardType: 10, tier: "district", season: 2026 })).toEqual({
      eventKey: "2026ncwak",
      awardType: 10,
      label: "Rookie All Star",
      awardOnly: true,
    });
  });

  it("returns null for Winner at the district tier and the full record at the dcmp tier", () => {
    expect(qualifyingAwardRecord({ eventKey: "2026ncwak", awardType: 1, tier: "district", season: 2026 })).toBeNull();
    expect(qualifyingAwardRecord({ eventKey: "2026nccmp", awardType: 1, tier: "dcmp", season: 2026 })).toEqual({
      eventKey: "2026nccmp",
      awardType: 1,
      label: "Winner",
      awardOnly: false,
    });
  });

  it("never marks a dcmp tier award as award only", () => {
    expect(qualifyingAwardRecord({ eventKey: "2026nccmp", awardType: 9, tier: "dcmp", season: 2026 })).toEqual({
      eventKey: "2026nccmp",
      awardType: 9,
      label: "Engineering Inspiration",
      awardOnly: false,
    });
  });

  it("returns null for a type with no label at either tier, and never throws for it", () => {
    expect(qualifyingAwardRecord({ eventKey: "2026ncwak", awardType: 5, tier: "district", season: 2026 })).toBeNull();
    expect(qualifyingAwardRecord({ eventKey: "2026nccmp", awardType: 5, tier: "dcmp", season: 2026 })).toBeNull();
    expect(qualifyingAwardRecord({ eventKey: "2026nccmp", awardType: 2, tier: "dcmp", season: 2026 })).toBeNull();
  });
});
