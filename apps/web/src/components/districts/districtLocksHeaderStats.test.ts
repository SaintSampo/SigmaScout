import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { computeChampLocksHeaderStats, computeDistrictLocksHeaderStats } from "./districtLocksHeaderStats.js";

type DistrictTeam = DistrictArtifact["teams"][number];

function verdict(overrides: Partial<DistrictTeam["districtLock"]> = {}): DistrictTeam["districtLock"] {
  return { status: "contending", pointsToLock: 10, threatCount: 2, cutLinePoints: 100, allocationNote: null, ...overrides };
}

function team(overrides: Partial<DistrictTeam> = {}): DistrictTeam {
  return {
    teamKey: "frc1",
    teamNumber: 1,
    nickname: "Team One",
    rank: 1,
    pointTotal: 100,
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: [],
    remainingEvents: [],
    maxRemainingDistrict: 20,
    maxRemainingChamp: 20,
    qualifyingAwards: [],
    districtLock: verdict(),
    champLock: verdict(),
    ...overrides,
  };
}

/** Round-trips every fixture through the real schema, so this module is tested against the actual published shape, not a hand-rolled approximation of it. */
function parseTeams(teams: DistrictTeam[]): DistrictTeam[] {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-05T00:00:00.000Z",
    districtKey: "2026fnc",
    year: 2026,
    abbreviation: "fnc",
    displayName: "FIRST North Carolina",
    dcmpSlots: 54,
    cmpSlots: 19,
    teams,
    insights: {
      teamCount: teams.length,
      eventCount: 3,
      dcmpCutLinePoints: 150,
      cmpCutLinePoints: 300,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
  }).teams;
}

describe("computeDistrictLocksHeaderStats", () => {
  it("reads the per-event ceiling and season total from any team's remainingEvents row", () => {
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        remainingEvents: [
          { eventKey: "2026nccmp", eventName: "NC Regional 1", week: 3, tier: "district", maxPoints: 83 },
          { eventKey: "2026ncalb", eventName: "NC Regional 2", week: 5, tier: "district", maxPoints: 83 },
        ],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district");
    expect(stats.perEventMax).toBe(83);
    expect(stats.totalEventCount).toBe(2);
    expect(stats.seasonCeilingTotal).toBe(166);
  });

  it("returns null ceilings when no roster row carries a remainingEvents entry for this tier", () => {
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        eventPoints: [{ eventKey: "2026nccmp", eventName: "NC Regional 1", week: 3, tier: "district", qual: 40, alliance: 20, elim: 15, award: 0, total: 75 }],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district");
    expect(stats.perEventMax).toBeNull();
    expect(stats.seasonCeilingTotal).toBeNull();
    expect(stats.totalEventCount).toBe(1);
  });

  it("sums played events' actual totals into `distributed`, never estimated", () => {
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        eventPoints: [{ eventKey: "2026nccmp", eventName: "NC Regional 1", week: 3, tier: "district", qual: 40, alliance: 20, elim: 15, award: 0, total: 75 }],
      }),
      team({
        teamKey: "frc2",
        eventPoints: [{ eventKey: "2026nccmp", eventName: "NC Regional 1", week: 3, tier: "district", qual: 30, alliance: 10, elim: 5, award: 0, total: 45 }],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district");
    expect(stats.pointsPool.distributed).toBe(120);
    expect(stats.pointsPool.perEvent.find((e) => e.eventKey === "2026nccmp")).toEqual({
      eventKey: "2026nccmp",
      played: true,
      actualOrEstimate: 120,
      isEstimate: false,
    });
  });

  it("estimates an upcoming event's points as teamCount x observed average points-per-team at played events, marked isEstimate", () => {
    const teams = parseTeams([
      // Two teams already played event A for a combined 120 points -> average 60/team.
      team({
        teamKey: "frc1",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 40, alliance: 20, elim: 0, award: 0, total: 80 }],
        remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", maxPoints: 83 }],
      }),
      team({
        teamKey: "frc2",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 20, alliance: 10, elim: 10, award: 0, total: 40 }],
        remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", maxPoints: 83 }],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district");
    // average = 120 / 2 = 60; eventB has 2 teams still counting it -> estimate 120
    expect(stats.pointsPool.distributed).toBe(120);
    expect(stats.pointsPool.remainingEstimate).toBe(120);
    const eventB = stats.pointsPool.perEvent.find((e) => e.eventKey === "eventB");
    expect(eventB?.isEstimate).toBe(true);
    expect(eventB?.actualOrEstimate).toBe(120);
  });

  it("never fabricates a non-zero remaining estimate when no event of this tier has been played yet", () => {
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        remainingEvents: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", maxPoints: 83 }],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district");
    expect(stats.pointsPool.distributed).toBe(0);
    expect(stats.pointsPool.remainingEstimate).toBe(0);
  });

  it("orders the schedule by week, played and upcoming events alike", () => {
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 3, tier: "district", qual: 10, alliance: 0, elim: 0, award: 0, total: 10 }],
        remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 1, tier: "district", maxPoints: 83 }],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district");
    expect(stats.schedule.map((e) => e.eventKey)).toEqual(["eventB", "eventA"]);
  });
});

describe("computeChampLocksHeaderStats", () => {
  it("mirrors computeDistrictLocksHeaderStats's district-tier remaining/ceiling figures", () => {
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 40, alliance: 20, elim: 0, award: 0, total: 60 }],
        remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", maxPoints: 83 }],
      }),
    ]);
    const champStats = computeChampLocksHeaderStats(teams);
    const districtStats = computeDistrictLocksHeaderStats(teams, "district");
    expect(champStats.remainingDistrictPoints).toBe(districtStats.pointsPool.remainingEstimate);
    expect(champStats.preDcmpCeiling).toBe(districtStats.seasonCeilingTotal);
  });
});
