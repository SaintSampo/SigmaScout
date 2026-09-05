/**
 * Unit tests for `scripts/publishDistricts.ts`'s pure composition (quick
 * task 260905-lic Task 2) — no corpus, no network. `buildDistrictArtifact`
 * is exercised against small, hand-built corpus-row fixtures covering: the
 * regular/dcmp tier split, a remaining-event ceiling, the DCMP-attendance
 * gate on `maxRemainingChamp`, a `null`-capacity district, and the
 * `--years` term grammar.
 */
import { describe, expect, it } from "vitest";
import type { CorpusDistrict, CorpusDistrictRanking } from "../packages/corpus/db.js";
import { buildDistrictArtifact, buildDistrictsIndexArtifact, cutLinePointsFor, parseYearsSpec, type DistrictEventMeta } from "./publishDistricts.js";

const GENERATION = "gen-1";
const COMPUTED_AT = "2026-09-05T00:00:00.000Z";

function district(overrides: Partial<CorpusDistrict> = {}): CorpusDistrict {
  return {
    districtKey: "2026fnc",
    year: 2026,
    abbreviation: "fnc",
    displayName: "FIRST North Carolina",
    dcmpSlots: 2,
    cmpSlots: 1,
    fetchedAt: COMPUTED_AT,
    ...overrides,
  };
}

function ranking(overrides: Partial<CorpusDistrictRanking> = {}): CorpusDistrictRanking {
  return {
    districtKey: "2026fnc",
    teamKey: "frc1",
    rank: 1,
    pointTotal: 0,
    rookieBonus: 0,
    adjustments: 0,
    eventPointsRaw: "[]",
    fetchedAt: COMPUTED_AT,
    ...overrides,
  };
}

function eventPointsRaw(entries: Array<{ event_key: string; district_cmp: boolean; qual_points: number; alliance_points: number; elim_points: number; award_points: number; total: number }>) {
  return JSON.stringify(entries);
}

function districtEvent(overrides: Partial<DistrictEventMeta> & { eventKey: string }): DistrictEventMeta {
  return { name: overrides.eventKey, week: 1, eventType: 1, ...overrides };
}

describe("buildDistrictArtifact", () => {
  it("splits a team's per-event points into district/dcmp tiers by district_cmp, reading component values verbatim", () => {
    const rankings = [
      ranking({
        teamKey: "frc1",
        pointTotal: 90,
        eventPointsRaw: eventPointsRaw([
          { event_key: "2026e1", district_cmp: false, qual_points: 20, alliance_points: 14, elim_points: 20, award_points: 5, total: 59 },
          { event_key: "2026dcmp", district_cmp: true, qual_points: 40, alliance_points: 30, elim_points: 60, award_points: 10, total: 140 },
        ]),
      }),
    ];
    const events = [
      districtEvent({ eventKey: "2026e1", name: "Regional District Event", eventType: 1 }),
      districtEvent({ eventKey: "2026dcmp", name: "NC District Championship", eventType: 2 }),
    ];

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district(),
      rankings,
      events,
      registrations: new Map(),
      teamMeta: new Map(),
    });

    const team = artifact.teams[0]!;
    expect(team.eventPoints[0]).toMatchObject({ eventKey: "2026e1", tier: "district", qual: 20, alliance: 14, elim: 20, award: 5, total: 59 });
    expect(team.eventPoints[1]).toMatchObject({ eventKey: "2026dcmp", tier: "dcmp", qual: 40, alliance: 30, elim: 60, award: 10, total: 140 });
  });

  it("computes maxRemainingDistrict from registered-but-unplayed regular-tier events only, using pointModel.ts's declared ceiling", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 50, eventPointsRaw: "[]" })];
    const events = [
      districtEvent({ eventKey: "2026e1", eventType: 1 }), // regular, unplayed, registered
      districtEvent({ eventKey: "2026e2", eventType: 1 }), // regular, unplayed, registered
      districtEvent({ eventKey: "2026dcmp", eventType: 2 }), // dcmp, unplayed, NOT registered
    ];
    const registrations = new Map<string, readonly string[]>([
      ["2026e1", ["frc1"]],
      ["2026e2", ["frc1"]],
    ]);

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: null, cmpSlots: null }),
      rankings,
      events,
      registrations,
      teamMeta: new Map(),
    });

    // district tier max total for 2026: qual 22 + alliance 16 + elim 30 + award 10 = 78, x2 regular events registered = 156
    expect(artifact.teams[0]!.maxRemainingDistrict).toBe(78 * 2);
    // remainingEvents lists only the REGISTERED events, never the unregistered dcmp event
    expect(artifact.teams[0]!.remainingEvents.map((e) => e.eventKey).sort()).toEqual(["2026e1", "2026e2"]);
  });

  it("adds one hypothetical dcmp-tier ceiling to maxRemainingChamp only when the team has not already attended DCMP and is not eliminated from DCMP qualification", () => {
    const rankings = [
      ranking({ teamKey: "notPlayedDcmpYet", pointTotal: 50, eventPointsRaw: "[]" }),
      ranking({ teamKey: "alreadyAttendedDcmp", pointTotal: 200, eventPointsRaw: eventPointsRaw([{ event_key: "2026dcmp", district_cmp: true, qual_points: 40, alliance_points: 30, elim_points: 60, award_points: 10, total: 140 }]) }),
    ];
    const events = [districtEvent({ eventKey: "2026dcmp", eventType: 2 })];

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      // dcmpSlots large enough that neither team is eliminated from DCMP qualification
      district: district({ dcmpSlots: 10, cmpSlots: 5 }),
      rankings,
      events,
      registrations: new Map(),
      teamMeta: new Map(),
    });

    const dcmpEventMax = 22 * 3 + 16 * 3 + 30 * 3 + 10 * 3; // 234
    const notPlayed = artifact.teams.find((t) => t.teamKey === "notPlayedDcmpYet")!;
    const alreadyPlayed = artifact.teams.find((t) => t.teamKey === "alreadyAttendedDcmp")!;
    expect(notPlayed.maxRemainingChamp).toBe(notPlayed.maxRemainingDistrict + dcmpEventMax);
    expect(alreadyPlayed.maxRemainingChamp).toBe(alreadyPlayed.maxRemainingDistrict);
  });

  it("a null dcmpSlots/cmpSlots district reports 'unknown' status and null cutLinePoints for every team, never a guessed capacity", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 100 }), ranking({ teamKey: "frc2", pointTotal: 50 })];
    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: null, cmpSlots: null }),
      rankings,
      events: [],
      registrations: new Map(),
      teamMeta: new Map(),
    });
    for (const team of artifact.teams) {
      expect(team.districtLock.status).toBe("unknown");
      expect(team.districtLock.cutLinePoints).toBeNull();
      expect(team.champLock.status).toBe("unknown");
      expect(team.champLock.cutLinePoints).toBeNull();
    }
  });

  it("carries teamNumber/nickname through from teamMeta when present, and omits them when absent", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 10 }), ranking({ teamKey: "frc2", pointTotal: 5, rank: 2 })];
    const teamMeta = new Map([["frc1", { teamNumber: 1, nickname: "Team One" }]]);
    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district(),
      rankings,
      events: [],
      registrations: new Map(),
      teamMeta,
    });
    const frc1 = artifact.teams.find((t) => t.teamKey === "frc1")!;
    const frc2 = artifact.teams.find((t) => t.teamKey === "frc2")!;
    expect(frc1.teamNumber).toBe(1);
    expect(frc1.nickname).toBe("Team One");
    expect(frc2.teamNumber).toBeUndefined();
    expect(frc2.nickname).toBeUndefined();
  });

  it("insights tallies locked/eliminated counts for both locks and reports teamCount/eventCount", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 500, rank: 1 }), ranking({ teamKey: "frc2", pointTotal: 5, rank: 2 })];
    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: 1, cmpSlots: 1 }),
      rankings,
      events: [districtEvent({ eventKey: "2026e1" })],
      registrations: new Map(),
      teamMeta: new Map(),
    });
    expect(artifact.insights.teamCount).toBe(2);
    expect(artifact.insights.eventCount).toBe(1);
    expect(artifact.insights.districtLockedCount).toBe(1);
    expect(artifact.insights.districtEliminatedCount).toBe(1);
  });
});

describe("cutLinePointsFor", () => {
  const rankings = [ranking({ teamKey: "a", rank: 1, pointTotal: 100 }), ranking({ teamKey: "b", rank: 2, pointTotal: 80 }), ranking({ teamKey: "c", rank: 3, pointTotal: 50 })];

  it("returns null when slots is null", () => {
    expect(cutLinePointsFor(rankings, null)).toBeNull();
  });

  it("returns the point total at the slot-th rank", () => {
    expect(cutLinePointsFor(rankings, 2)).toBe(80);
  });

  it("clamps to the lowest-ranked team's point total when slots exceeds the team count", () => {
    expect(cutLinePointsFor(rankings, 10)).toBe(50);
  });

  it("returns null for an empty ranking list", () => {
    expect(cutLinePointsFor([], 1)).toBeNull();
  });
});

describe("buildDistrictsIndexArtifact", () => {
  it("composes an index row per district with the same nullable-slots contract", () => {
    const artifact = buildDistrictsIndexArtifact(2026, GENERATION, COMPUTED_AT, [
      { district: district({ dcmpSlots: null, cmpSlots: null }), teamCount: 90, eventCount: 7 },
    ]);
    expect(artifact.districts[0]).toMatchObject({ districtKey: "2026fnc", dcmpSlots: null, cmpSlots: null, teamCount: 90, eventCount: 7 });
  });
});

describe("parseYearsSpec", () => {
  it("parses a single year", () => {
    expect(parseYearsSpec("2026")).toEqual([2026]);
  });

  it("parses a range", () => {
    expect(parseYearsSpec("2022-2026")).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it("parses a comma-separated list of terms, ascending and de-duplicated", () => {
    expect(parseYearsSpec("2019,2020,2022-2026")).toEqual([2019, 2020, 2022, 2023, 2024, 2025, 2026]);
  });

  it("throws on an invalid term", () => {
    expect(() => parseYearsSpec("not-a-year")).toThrow();
  });

  it("throws on an empty spec", () => {
    expect(() => parseYearsSpec("")).toThrow();
  });
});
