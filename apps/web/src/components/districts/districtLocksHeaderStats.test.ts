import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { computeChampLocksHeaderStats, computeDistrictLocksHeaderStats } from "./districtLocksHeaderStats.js";

type DistrictTeam = DistrictArtifact["teams"][number];

/** A registered season (`pointModel.ts`'s `DISTRICT_REGISTERED_SEASONS`) — district-tier ceiling qual22+alliance16+elim30+award15 = 83. */
const REGISTERED_SEASON = 2026;
/** 2021 — the real FRC COVID-cancelled year, deliberately absent from `pointModel.ts`'s registered set. Used to exercise the honest `null` fallback. */
const UNREGISTERED_SEASON = 2021;

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
    year: REGISTERED_SEASON,
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
  it("derives perEventMax from the point model for a registered season, even with no remainingEvents rows at all (a fully-played season)", () => {
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        eventPoints: [
          { eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 40, alliance: 20, elim: 10, award: 0, total: 70 },
          { eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", qual: 30, alliance: 10, elim: 5, award: 0, total: 45 },
        ],
        remainingEvents: [],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district", REGISTERED_SEASON);
    expect(stats.perEventMax).toBe(83);
  });

  it("the per-team ceiling is FIXED at 2 x perEventMax (first-2-home-events rule), never perEventMax x totalEventCount", () => {
    // Three distinct district events across the roster -> totalEventCount 3,
    // but the per-team ceiling must stay 2 x 83 = 166, not 3 x 83 = 249.
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 10, alliance: 0, elim: 0, award: 0, total: 10 }],
        remainingEvents: [
          { eventKey: "eventB", eventName: "Event B", week: 3, tier: "district", maxPoints: 83 },
          { eventKey: "eventC", eventName: "Event C", week: 5, tier: "district", maxPoints: 83 },
        ],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district", REGISTERED_SEASON);
    expect(stats.totalEventCount).toBe(3);
    expect(stats.perTeamCeiling).toBe(166);
  });

  it("returns null ceilings for an unregistered season, never a guessed number", () => {
    const teams = parseTeams([team({ teamKey: "frc1" })]);
    const stats = computeDistrictLocksHeaderStats(teams, "district", UNREGISTERED_SEASON);
    expect(stats.perEventMax).toBeNull();
    expect(stats.perTeamCeiling).toBeNull();
  });

  it("maxRemainingAcrossRoster is the MAXIMUM of maxRemainingDistrict across the roster, not any one team's value", () => {
    const teams = parseTeams([
      team({ teamKey: "frc1", maxRemainingDistrict: 40 }),
      team({ teamKey: "frc2", maxRemainingDistrict: 83 }),
      team({ teamKey: "frc3", maxRemainingDistrict: 0 }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district", REGISTERED_SEASON);
    expect(stats.maxRemainingAcrossRoster).toBe(83);
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
    const stats = computeDistrictLocksHeaderStats(teams, "district", REGISTERED_SEASON);
    expect(stats.pointsPool.distributed).toBe(120);
    expect(stats.pointsPool.perEvent.find((e) => e.eventKey === "2026nccmp")).toEqual({
      eventKey: "2026nccmp",
      played: true,
      actualOrEstimate: 120,
      isEstimate: false,
    });
  });

  it("estimates an upcoming event's points as teamCount x observed average points-per-team at played events, marked isEstimate, UNROUNDED", () => {
    const teams = parseTeams([
      // Two teams already played event A for a combined 121 points -> average 60.5/team (deliberately fractional).
      team({
        teamKey: "frc1",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 40, alliance: 20, elim: 1, award: 0, total: 81 }],
        remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", maxPoints: 83 }],
      }),
      team({
        teamKey: "frc2",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 20, alliance: 10, elim: 10, award: 0, total: 40 }],
        remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", maxPoints: 83 }],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district", REGISTERED_SEASON);
    // average = 121 / 2 = 60.5; eventB has 2 teams still counting it -> estimate 121 (left unrounded here, e.g. 60.5*2=121 exactly — assert the fractional average case separately below)
    expect(stats.pointsPool.distributed).toBe(121);
    const eventB = stats.pointsPool.perEvent.find((e) => e.eventKey === "eventB");
    expect(eventB?.isEstimate).toBe(true);
    expect(eventB?.actualOrEstimate).toBeCloseTo(121, 5);
  });

  it("leaves a genuinely fractional estimate UNROUNDED — rounding is a display concern, not this module's", () => {
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 30, alliance: 0, elim: 0, award: 0, total: 30 }],
        remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", maxPoints: 83 }],
      }),
      team({
        teamKey: "frc2",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 10, alliance: 0, elim: 0, award: 0, total: 10 }],
        remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", maxPoints: 83 }],
      }),
      team({
        teamKey: "frc3",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", qual: 15, alliance: 0, elim: 0, award: 0, total: 15 }],
        remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 5, tier: "district", maxPoints: 83 }],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district", REGISTERED_SEASON);
    // average = 55 / 3 = 18.333...; eventB has 3 teams -> estimate 55 exactly (3 * 55/3), but the intermediate average is fractional and this asserts the module never pre-rounds it away.
    expect(stats.pointsPool.remainingEstimate).toBeCloseTo(55, 5);
    expect(Number.isInteger(stats.pointsPool.remainingEstimate * 3)).toBe(true); // sanity: still full precision internally
  });

  it("never fabricates a non-zero remaining estimate when no event of this tier has been played yet", () => {
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        remainingEvents: [{ eventKey: "eventA", eventName: "Event A", week: 1, tier: "district", maxPoints: 83 }],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district", REGISTERED_SEASON);
    expect(stats.pointsPool.distributed).toBe(0);
    expect(stats.pointsPool.remainingEstimate).toBe(0);
  });

  it("orders the schedule by week, played and upcoming events alike, and uses the point-model ceiling for both", () => {
    const teams = parseTeams([
      team({
        teamKey: "frc1",
        eventPoints: [{ eventKey: "eventA", eventName: "Event A", week: 3, tier: "district", qual: 10, alliance: 0, elim: 0, award: 0, total: 10 }],
        remainingEvents: [{ eventKey: "eventB", eventName: "Event B", week: 1, tier: "district", maxPoints: 83 }],
      }),
    ]);
    const stats = computeDistrictLocksHeaderStats(teams, "district", REGISTERED_SEASON);
    expect(stats.schedule.map((e) => e.eventKey)).toEqual(["eventB", "eventA"]);
    expect(stats.schedule.every((e) => e.maxPoints === 83)).toBe(true);
  });
});

describe("computeChampLocksHeaderStats", () => {
  it("maxRemainingAcrossRoster reads maxRemainingChamp (not maxRemainingDistrict), and preDcmpCeiling mirrors the district tab's fixed 2-event ceiling", () => {
    const teams = parseTeams([
      team({ teamKey: "frc1", maxRemainingDistrict: 5, maxRemainingChamp: 332 }),
      team({ teamKey: "frc2", maxRemainingDistrict: 999, maxRemainingChamp: 10 }),
    ]);
    const champStats = computeChampLocksHeaderStats(teams, REGISTERED_SEASON);
    expect(champStats.maxRemainingAcrossRoster).toBe(332);
    expect(champStats.preDcmpCeiling).toBe(166);
  });

  it("matches the user-approved preview numbers: 332 / 166 mid-season, 0 / 166 when done", () => {
    const midSeason = parseTeams([team({ teamKey: "frc1", maxRemainingChamp: 332 })]);
    const done = parseTeams([team({ teamKey: "frc1", maxRemainingChamp: 0 })]);
    expect(computeChampLocksHeaderStats(midSeason, REGISTERED_SEASON)).toEqual({ maxRemainingAcrossRoster: 332, preDcmpCeiling: 166 });
    expect(computeChampLocksHeaderStats(done, REGISTERED_SEASON)).toEqual({ maxRemainingAcrossRoster: 0, preDcmpCeiling: 166 });
  });

  it("returns a null preDcmpCeiling for an unregistered season", () => {
    const teams = parseTeams([team({ teamKey: "frc1", maxRemainingChamp: 100 })]);
    const champStats = computeChampLocksHeaderStats(teams, UNREGISTERED_SEASON);
    expect(champStats.preDcmpCeiling).toBeNull();
  });
});
