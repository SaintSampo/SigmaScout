/**
 * `eventAwards.ts`'s behavior contract (quick task 261009-r9x): the one
 * "awards posted" rule at both vantages, the judged award test, the award
 * points test, and the one qualifying award record builder at both tiers.
 *
 * Since quick task 261009-vp9 the live rule also waits for every consuming
 * award the event gives, and for 12 unchanged hours where one is not listed.
 */
import { describe, expect, it } from "vitest";
import {
  AWARD_TYPE_FINALIST,
  AWARDS_SETTLE_MS,
  AWARDS_SETTLE_WITHOUT_IMPACT_MS,
  awardPointsPresentAt,
  awardsListSettled,
  awardsPostedRule,
  expectedAwardsListed,
  expectedConsumingAwardTypes,
  isJudgedAwardType,
  playoffPointsPresentAt,
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
  // Every cell carries the playoff points fact (quick task 261009-vp9): the
  // cases below turn on the other facts, and the fact has its own cases.
  const cells = [
    { judgedAwardListed: false, awardPointsPresent: false, playoffPointsPresent: true },
    { judgedAwardListed: true, awardPointsPresent: false, playoffPointsPresent: true },
    { judgedAwardListed: false, awardPointsPresent: true, playoffPointsPresent: true },
    { judgedAwardListed: true, awardPointsPresent: true, playoffPointsPresent: true },
  ] as const;

  it("live: with a judged award, award points, every expected award listed and a settled list, the flag is false with no playoff points at the event and true with them (quick task 261009-vp9)", () => {
    const rest = { judgedAwardListed: true, awardPointsPresent: true, expectedAwardsListed: true, listSettled: true, listSettledLong: true } as const;
    expect(awardsPostedRule({ ...rest, playoffPointsPresent: false }, "live")).toBe(false);
    expect(awardsPostedRule({ ...rest, playoffPointsPresent: true }, "live")).toBe(true);
    // An absent fact reads as not present, which is the waiting side.
    expect(awardsPostedRule(rest, "live")).toBe(false);
    // The 12 hour path needs it too.
    expect(awardsPostedRule({ judgedAwardListed: true, awardPointsPresent: true, expectedAwardsListed: false, listSettledLong: true, playoffPointsPresent: false }, "live")).toBe(false);
    expect(awardsPostedRule({ judgedAwardListed: true, awardPointsPresent: true, expectedAwardsListed: false, listSettledLong: true, playoffPointsPresent: true }, "live")).toBe(true);
  });

  it("hindsight does not read the playoff points fact", () => {
    for (const playoffPointsPresent of [true, false, undefined]) {
      const extra = playoffPointsPresent === undefined ? {} : { playoffPointsPresent };
      expect(awardsPostedRule({ judgedAwardListed: true, awardPointsPresent: false, ...extra }, "hindsight")).toBe(true);
      expect(awardsPostedRule({ judgedAwardListed: false, awardPointsPresent: true, ...extra }, "hindsight")).toBe(true);
      expect(awardsPostedRule({ judgedAwardListed: false, awardPointsPresent: false, ...extra }, "hindsight")).toBe(false);
    }
  });

  it("live: only all the facts read true: judged, points, every expected award listed, and the list settled for 60 minutes (quick tasks 261009-tx6 and 261009-vp9)", () => {
    expect(cells.map((facts) => awardsPostedRule({ ...facts, expectedAwardsListed: true, listSettled: true }, "live"))).toEqual([false, false, false, true]);
    expect(cells.map((facts) => awardsPostedRule({ ...facts, expectedAwardsListed: true, listSettled: false }, "live"))).toEqual([false, false, false, false]);
  });

  it("live: an absent settle fact reads as not settled", () => {
    expect(cells.map((facts) => awardsPostedRule({ ...facts, expectedAwardsListed: true }, "live"))).toEqual([false, false, false, false]);
    expect(cells.map((facts) => awardsPostedRule(facts, "live"))).toEqual([false, false, false, false]);
  });

  it("live: an expected award not listed is false at 60 settled minutes and true at 12 settled hours (quick task 261009-vp9)", () => {
    const base = { judgedAwardListed: true, awardPointsPresent: true, playoffPointsPresent: true } as const;
    // Settled for 60 minutes only: the flag waits for the award.
    expect(awardsPostedRule({ ...base, expectedAwardsListed: false, listSettled: true }, "live")).toBe(false);
    expect(awardsPostedRule({ ...base, expectedAwardsListed: false, listSettled: true, listSettledLong: false }, "live")).toBe(false);
    // Settled for 12 hours: the event gave none, and the flag turns true.
    expect(awardsPostedRule({ ...base, expectedAwardsListed: false, listSettled: true, listSettledLong: true }, "live")).toBe(true);
  });

  it("live: an absent expectedAwardsListed reads as not listed, so only the long settle turns the flag true", () => {
    const base = { judgedAwardListed: true, awardPointsPresent: true, playoffPointsPresent: true } as const;
    expect(awardsPostedRule({ ...base, listSettled: true }, "live")).toBe(false);
    expect(awardsPostedRule({ ...base, listSettled: true, listSettledLong: true }, "live")).toBe(true);
  });

  it("live: no judged award, or no points, is false whatever the rest says", () => {
    const rest = { expectedAwardsListed: true, listSettled: true, listSettledLong: true, playoffPointsPresent: true } as const;
    expect(awardsPostedRule({ judgedAwardListed: false, awardPointsPresent: true, ...rest }, "live")).toBe(false);
    expect(awardsPostedRule({ judgedAwardListed: true, awardPointsPresent: false, ...rest }, "live")).toBe(false);
    expect(awardsPostedRule({ judgedAwardListed: false, awardPointsPresent: false, ...rest }, "live")).toBe(false);
  });

  it("hindsight: only neither of the first two facts reads false, whatever the settle facts and the expected awards say", () => {
    for (const listSettled of [true, false, undefined]) {
      for (const listSettledLong of [true, false, undefined]) {
        for (const expected of [true, false, undefined]) {
          const extra = {
            ...(listSettled === undefined ? {} : { listSettled }),
            ...(listSettledLong === undefined ? {} : { listSettledLong }),
            ...(expected === undefined ? {} : { expectedAwardsListed: expected }),
          };
          expect(cells.map((facts) => awardsPostedRule({ ...facts, ...extra }, "hindsight"))).toEqual([false, true, true, true]);
        }
      }
    }
  });
});

describe("the awards an event gives (quick task 261009-vp9)", () => {
  it("is Impact at a district event, Impact, Winner, Engineering Inspiration and Rookie All Star at a championship, and none at a division", () => {
    expect([...expectedConsumingAwardTypes("district")].sort((a, b) => a - b)).toEqual([0]);
    expect([...expectedConsumingAwardTypes("championship")].sort((a, b) => a - b)).toEqual([0, 1, 9, 10]);
    expect([...expectedConsumingAwardTypes("division")]).toEqual([]);
  });

  it("expectedAwardsListed: a district list with Impact is true and one without is false", () => {
    expect(expectedAwardsListed("district", [1, 2, 0, 29])).toBe(true);
    expect(expectedAwardsListed("district", [0])).toBe(true);
    expect(expectedAwardsListed("district", [1, 2, 9, 10, 29])).toBe(false);
    expect(expectedAwardsListed("district", [])).toBe(false);
  });

  it("expectedAwardsListed: a championship list is true only with all four", () => {
    expect(expectedAwardsListed("championship", [0, 1, 9, 10])).toBe(true);
    expect(expectedAwardsListed("championship", new Set([1, 2, 0, 9, 10, 29]))).toBe(true);
    for (const missing of [0, 1, 9, 10]) {
      expect(expectedAwardsListed("championship", [0, 1, 9, 10, 2, 29].filter((type) => type !== missing))).toBe(false);
    }
  });

  it("expectedAwardsListed: a division is true for any list, the empty list included", () => {
    expect(expectedAwardsListed("division", [])).toBe(true);
    expect(expectedAwardsListed("division", [1, 2])).toBe(true);
    expect(expectedAwardsListed("division", [29])).toBe(true);
  });
});

describe("awardsListSettled (quick task 261009-tx6)", () => {
  const NOW = Date.parse("2026-03-14T20:00:00.000Z");
  const ago = (ms: number): string => new Date(NOW - ms).toISOString();

  it("is 60 minutes", () => {
    expect(AWARDS_SETTLE_MS).toBe(60 * 60 * 1000);
  });

  it("is true for equal ETags and a change time exactly 60 minutes old, and false one second short of it", () => {
    expect(awardsListSettled("etag-1", ago(AWARDS_SETTLE_MS), "etag-1", NOW)).toBe(true);
    expect(awardsListSettled("etag-1", ago(AWARDS_SETTLE_MS + 1), "etag-1", NOW)).toBe(true);
    expect(awardsListSettled("etag-1", ago(AWARDS_SETTLE_MS - 1000), "etag-1", NOW)).toBe(false);
  });

  it("is false for a differing ETag, however old the change time", () => {
    expect(awardsListSettled("etag-1", ago(10 * AWARDS_SETTLE_MS), "etag-2", NOW)).toBe(false);
  });

  it("is false for a list whose response carried no ETag", () => {
    expect(awardsListSettled("etag-1", ago(10 * AWARDS_SETTLE_MS), null, NOW)).toBe(false);
    expect(awardsListSettled(null, ago(10 * AWARDS_SETTLE_MS), null, NOW)).toBe(false);
  });

  it("is false for a null or absent stored ETag", () => {
    expect(awardsListSettled(null, ago(10 * AWARDS_SETTLE_MS), "etag-1", NOW)).toBe(false);
    expect(awardsListSettled(undefined, ago(10 * AWARDS_SETTLE_MS), "etag-1", NOW)).toBe(false);
  });

  it("is false for a null, absent or unparseable change time", () => {
    expect(awardsListSettled("etag-1", null, "etag-1", NOW)).toBe(false);
    expect(awardsListSettled("etag-1", undefined, "etag-1", NOW)).toBe(false);
    expect(awardsListSettled("etag-1", "not a time", "etag-1", NOW)).toBe(false);
    expect(awardsListSettled("etag-1", "", "etag-1", NOW)).toBe(false);
  });

  it("is false for a change time in the future", () => {
    expect(awardsListSettled("etag-1", new Date(NOW + 1000).toISOString(), "etag-1", NOW)).toBe(false);
  });

  describe("with a threshold (quick task 261009-vp9)", () => {
    const LONG = AWARDS_SETTLE_WITHOUT_IMPACT_MS;

    it("the long wait is 12 hours", () => {
      expect(LONG).toBe(12 * 60 * 60 * 1000);
    });

    it("a change time exactly 12 hours old is true at the 12 hour threshold, and 11 hours 59 minutes is false", () => {
      expect(awardsListSettled("etag-1", ago(LONG), "etag-1", NOW, LONG)).toBe(true);
      expect(awardsListSettled("etag-1", ago(LONG - 60 * 1000), "etag-1", NOW, LONG)).toBe(false);
      // The same 11 hours 59 minutes is long settled at the default threshold.
      expect(awardsListSettled("etag-1", ago(LONG - 60 * 1000), "etag-1", NOW)).toBe(true);
    });

    it("with no threshold it is the 60 minute test as before", () => {
      expect(awardsListSettled("etag-1", ago(AWARDS_SETTLE_MS), "etag-1", NOW)).toBe(awardsListSettled("etag-1", ago(AWARDS_SETTLE_MS), "etag-1", NOW, AWARDS_SETTLE_MS));
      expect(awardsListSettled("etag-1", ago(AWARDS_SETTLE_MS - 1000), "etag-1", NOW)).toBe(false);
    });

    it("every unknown still reads false at both thresholds", () => {
      for (const threshold of [AWARDS_SETTLE_MS, LONG]) {
        expect(awardsListSettled("etag-1", ago(10 * LONG), "etag-2", NOW, threshold)).toBe(false);
        expect(awardsListSettled("etag-1", ago(10 * LONG), null, NOW, threshold)).toBe(false);
        expect(awardsListSettled(null, ago(10 * LONG), "etag-1", NOW, threshold)).toBe(false);
        expect(awardsListSettled(undefined, ago(10 * LONG), "etag-1", NOW, threshold)).toBe(false);
        expect(awardsListSettled("etag-1", null, "etag-1", NOW, threshold)).toBe(false);
        expect(awardsListSettled("etag-1", "not a time", "etag-1", NOW, threshold)).toBe(false);
        expect(awardsListSettled("etag-1", new Date(NOW + 1000).toISOString(), "etag-1", NOW, threshold)).toBe(false);
      }
    });
  });
});

describe("playoffPointsPresentAt (quick task 261009-vp9)", () => {
  const row = (eventKey: string, elim: number) => ({ eventKey, elim });

  it("is false when every row at the event carries zero playoff points, and for no rows at all", () => {
    expect(playoffPointsPresentAt([{ eventPoints: [row("2026e1", 0)] }, { eventPoints: [row("2026e1", 0)] }], "2026e1")).toBe(false);
    expect(playoffPointsPresentAt([], "2026e1")).toBe(false);
  });

  it("is true when one row at the event carries playoff points above zero", () => {
    expect(playoffPointsPresentAt([{ eventPoints: [row("2026e1", 0)] }, { eventPoints: [row("2026e0", 0), row("2026e1", 7)] }], "2026e1")).toBe(true);
  });

  it("is false when the only playoff points are at another event", () => {
    expect(playoffPointsPresentAt([{ eventPoints: [row("2026e0", 30), row("2026e1", 0)] }], "2026e1")).toBe(false);
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
