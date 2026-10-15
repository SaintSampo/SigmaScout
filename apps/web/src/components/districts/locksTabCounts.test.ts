import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { locksTabCountText, locksTabCounts, locksTabFallbackCounts, mergeLocksTabReport } from "./locksTabCounts.js";

type Verdict = DistrictArtifact["teams"][number]["districtLock"]["status"];

function team(teamKey: string, district: Verdict, champ: Verdict): DistrictArtifact["teams"][number] {
  const verdict = (status: Verdict) => ({ status, pointsToLock: null, threatCount: 0, cutLinePoints: null, allocationNote: null });
  return {
    teamKey,
    rank: 1,
    pointTotal: 0,
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: [],
    remainingEvents: [],
    maxRemainingDistrict: 0,
    maxRemainingChamp: 0,
    qualifyingAwards: [],
    districtLock: verdict(district),
    champLock: verdict(champ),
  };
}

function artifactOf(teams: DistrictArtifact["teams"], slots: { dcmpSlots: number | null; cmpSlots: number | null }): DistrictArtifact {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-10-15T00:00:00.000Z",
    districtKey: "2026fnc",
    year: 2026,
    abbreviation: "fnc",
    displayName: "FIRST North Carolina",
    ...slots,
    teams,
    insights: { teamCount: teams.length, eventCount: 1, dcmpCutLinePoints: null, cmpCutLinePoints: null, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
  });
}

// No team carries a championship row, so the field rule never applies and the
// fallback is the published verdict count on both tiers.
const ARTIFACT = artifactOf(
  [team("frc1", "locked", "locked"), team("frc2", "lockedAward", "prequalified"), team("frc3", "contending", "lockedAward"), team("frc4", "eliminated", "eliminated")],
  { dcmpSlots: 50, cmpSlots: 15 }
);

describe("the fallback counts, from the artifact alone", () => {
  it("counts locked and lockedAward as held slots and prequalified as none", () => {
    expect(locksTabFallbackCounts(ARTIFACT)).toEqual({ district: 2, champ: 2 });
  });
});

describe("the printed count", () => {
  it("reads N of M slots called while the count fits the capacity", () => {
    expect(locksTabCountText(2, 50)).toBe("2 of 50 slots called");
    expect(locksTabCountText(50, 50)).toBe("50 of 50 slots called");
  });

  it("reads a bare locked count where the field outgrew its slots, or where no capacity is published", () => {
    expect(locksTabCountText(161, 160)).toBe("161 locked");
    expect(locksTabCountText(3, null)).toBe("3 locked");
  });
});

describe("a mounted ledger's report wins over the fallback, for its own artifact only", () => {
  it("prints the reported count for the tier that reported and the fallback for the other", () => {
    const reported = mergeLocksTabReport({}, "district", { districtKey: "2026fnc", locked: 7 });
    expect(locksTabCounts(ARTIFACT, reported)).toEqual({ district: "7 of 50 slots called", champ: "2 of 15 slots called" });
  });

  it("ignores a report computed from another district's artifact", () => {
    const reported = mergeLocksTabReport({}, "district", { districtKey: "2026fim", locked: 161 });
    expect(locksTabCounts(ARTIFACT, reported)).toEqual({ district: "2 of 50 slots called", champ: "2 of 15 slots called" });
  });

  it("a report from a new artifact drops the old artifact's other tier", () => {
    const first = mergeLocksTabReport({}, "champ", { districtKey: "2026fim", locked: 83 });
    const second = mergeLocksTabReport(first, "district", { districtKey: "2026fnc", locked: 7 });
    expect(second).toEqual({ districtKey: "2026fnc", district: 7 });
  });

  it("an unchanged report returns the same object, so a memo keyed on it does not recompute", () => {
    const first = mergeLocksTabReport({}, "district", { districtKey: "2026fnc", locked: 7 });
    expect(mergeLocksTabReport(first, "district", { districtKey: "2026fnc", locked: 7 })).toBe(first);
  });

  it("prints nothing with no artifact", () => {
    expect(locksTabCounts(undefined, {})).toBeUndefined();
  });
});
