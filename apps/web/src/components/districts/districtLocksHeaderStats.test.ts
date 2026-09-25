import { describe, expect, it } from "vitest";
import { DistrictArtifactSchema, type DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { computeChampLocksHeaderStats } from "./districtLocksHeaderStats.js";

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

describe("computeChampLocksHeaderStats", () => {
  it("maxRemainingAcrossRoster reads maxRemainingChamp (not maxRemainingDistrict), and seasonCeiling is the 2-event pre-DCMP ceiling plus one DCMP at 3x", () => {
    const teams = parseTeams([
      team({ teamKey: "frc1", maxRemainingDistrict: 5, maxRemainingChamp: 332 }),
      team({ teamKey: "frc2", maxRemainingDistrict: 999, maxRemainingChamp: 10 }),
    ]);
    const champStats = computeChampLocksHeaderStats(teams, REGISTERED_SEASON);
    expect(champStats.maxRemainingAcrossRoster).toBe(332);
    expect(champStats.seasonCeiling).toBe(415);
  });

  it("matches the user-approved preview numbers: 332 / 166 mid-season, 0 / 166 when done", () => {
    const midSeason = parseTeams([team({ teamKey: "frc1", maxRemainingChamp: 332 })]);
    const done = parseTeams([team({ teamKey: "frc1", maxRemainingChamp: 0 })]);
    expect(computeChampLocksHeaderStats(midSeason, REGISTERED_SEASON)).toEqual({ maxRemainingAcrossRoster: 332, seasonCeiling: 415 });
    expect(computeChampLocksHeaderStats(done, REGISTERED_SEASON)).toEqual({ maxRemainingAcrossRoster: 0, seasonCeiling: 415 });
  });

  it("returns a null seasonCeiling for an unregistered season", () => {
    const teams = parseTeams([team({ teamKey: "frc1", maxRemainingChamp: 100 })]);
    const champStats = computeChampLocksHeaderStats(teams, UNREGISTERED_SEASON);
    expect(champStats.seasonCeiling).toBeNull();
  });
});
