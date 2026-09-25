/**
 * Unit tests for `scripts/publishDistricts.ts`'s pure composition (quick
 * task 260905-lic Task 2; widened by revision R2a) — no corpus, no network.
 * `buildDistrictArtifact` is exercised against small, hand-built corpus-row
 * fixtures covering: the regular/dcmp tier split, a remaining-event
 * ceiling, the DCMP-attendance gate on `maxRemainingChamp`, a
 * `null`-capacity district, the `--years` term grammar, and (revision R2a)
 * award-qualified/`lockedAward`, curated pre-qualification/`prequalified`,
 * and the `2025fsc` special-allocation override.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly, type Corpus, type CorpusDistrict, type CorpusDistrictRanking, type CorpusEventAward } from "../packages/corpus/db.js";
import { applyDistrictEventState, recomputeDistrictVerdicts } from "../packages/harness/districtRankingsMerge.js";
import { DistrictEventStateSchema } from "../packages/harness/pageArtifacts.js";
import { DistrictBudgetExceededError } from "../packages/harness/publishBudget.js";
import {
  buildDistrictArtifact,
  buildDistrictsIndexArtifact,
  classifyBakeCandidate,
  deriveDistrictEventState,
  localOutFileName,
  parseOptions,
  parseYearsSpec,
  run,
  type DistrictEventMeta,
} from "./publishDistricts.js";

/** The corpus this file's corpus-guarded describes read, guarded exactly as `reconciliation.test.ts` guards its own. */
const CORPUS_PATH = "data/corpus.sqlite";

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

function eventAward(overrides: Partial<CorpusEventAward> & { eventKey: string }): CorpusEventAward {
  return { awardType: 0, teamKey: "frc1", year: 2026, fetchedAt: COMPUTED_AT, ...overrides };
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
      awards: new Map(),
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
      awards: new Map(),
      teamMeta: new Map(),
    });

    // district tier max total for 2026: qual 22 + alliance 16 + elim 30 + award 15 = 83, x2 regular events registered = 166
    expect(artifact.teams[0]!.maxRemainingDistrict).toBe(83 * 2);
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
      awards: new Map(),
      teamMeta: new Map(),
    });

    const dcmpEventMax = 22 * 3 + 16 * 3 + 30 * 3 + 15 * 3; // 249
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
      awards: new Map(),
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
      awards: new Map(),
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
      awards: new Map(),
      teamMeta: new Map(),
    });
    expect(artifact.insights.teamCount).toBe(2);
    expect(artifact.insights.eventCount).toBe(1);
    expect(artifact.insights.districtLockedCount).toBe(1);
    expect(artifact.insights.districtEliminatedCount).toBe(1);
  });
});

describe("buildDistrictArtifact — award-based qualification (revision R2a)", () => {
  it("a district-event Impact (award_type 0) winner reports districtLock lockedAward, and the award appears in qualifyingAwards not flagged awardOnly", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 10, rank: 1 }), ranking({ teamKey: "frc2", pointTotal: 500, rank: 2 })];
    const events = [districtEvent({ eventKey: "2026e1", eventType: 1 })];
    const awards = new Map([["2026e1", [eventAward({ eventKey: "2026e1", awardType: 0, teamKey: "frc1" })]]]);

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: 1, cmpSlots: 1 }),
      rankings,
      events,
      registrations: new Map(),
      awards,
      teamMeta: new Map(),
    });

    const frc1 = artifact.teams.find((t) => t.teamKey === "frc1")!;
    expect(frc1.districtLock.status).toBe("lockedAward");
    expect(frc1.qualifyingAwards).toEqual([{ eventKey: "2026e1", awardType: 0, label: "FIRST Impact Award", awardOnly: false }]);
  });

  it("a district-event Engineering Inspiration (award_type 9) winner is NOT districtLock-qualified (award-only, no slot), and its qualifyingAwards entry is flagged awardOnly", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 10, rank: 1 }), ranking({ teamKey: "frc2", pointTotal: 500, rank: 2 })];
    const events = [districtEvent({ eventKey: "2026e1", eventType: 1 })];
    const awards = new Map([["2026e1", [eventAward({ eventKey: "2026e1", awardType: 9, teamKey: "frc1" })]]]);

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: 1, cmpSlots: 1 }),
      rankings,
      events,
      registrations: new Map(),
      awards,
      teamMeta: new Map(),
    });

    const frc1 = artifact.teams.find((t) => t.teamKey === "frc1")!;
    expect(frc1.districtLock.status).not.toBe("lockedAward");
    expect(frc1.qualifyingAwards).toEqual([{ eventKey: "2026e1", awardType: 9, label: "Engineering Inspiration", awardOnly: true }]);
  });

  it("a registered event whose start_date is already well past computedAt is NOT a remaining event — no-show registrations must not inflate a ceiling forever", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 50, eventPointsRaw: "[]" })];
    const events = [
      districtEvent({ eventKey: "2026past", eventType: 1, startDate: "2026-03-01" }), // long past vs COMPUTED_AT (2026-09-05)
      districtEvent({ eventKey: "2026future", eventType: 1, startDate: "2026-10-01" }),
      districtEvent({ eventKey: "2026undated", eventType: 1 }), // unknown date -> honestly assumed still ahead
    ];
    const registrations = new Map<string, readonly string[]>([
      ["2026past", ["frc1"]],
      ["2026future", ["frc1"]],
      ["2026undated", ["frc1"]],
    ]);

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: null, cmpSlots: null }),
      rankings,
      events,
      registrations,
      awards: new Map(),
      teamMeta: new Map(),
    });

    expect(artifact.teams[0]!.remainingEvents.map((e) => e.eventKey).sort()).toEqual(["2026future", "2026undated"]);
    expect(artifact.teams[0]!.maxRemainingDistrict).toBe(83 * 2);
  });

  it("a district whose DCMP start_date is already past grants no hypothetical dcmp ceiling, while a district with NO dcmp event listed still grants it (never understate a ceiling)", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 50, eventPointsRaw: "[]" })];
    const base = {
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: 10, cmpSlots: 5 }),
      rankings,
      registrations: new Map<string, readonly string[]>(),
      awards: new Map<string, never[]>(),
      teamMeta: new Map(),
    };
    const dcmpEventMax = 83 * 3;

    const pastDcmp = buildDistrictArtifact({ ...base, events: [districtEvent({ eventKey: "2026dcmp", eventType: 2, startDate: "2026-04-01" })] });
    expect(pastDcmp.teams[0]!.maxRemainingChamp).toBe(pastDcmp.teams[0]!.maxRemainingDistrict);

    const noDcmpListed = buildDistrictArtifact({ ...base, events: [] });
    expect(noDcmpListed.teams[0]!.maxRemainingChamp).toBe(noDcmpListed.teams[0]!.maxRemainingDistrict + dcmpEventMax);

    const futureDcmp = buildDistrictArtifact({ ...base, events: [districtEvent({ eventKey: "2026dcmp", eventType: 2, startDate: "2026-10-01" })] });
    expect(futureDcmp.teams[0]!.maxRemainingChamp).toBe(futureDcmp.teams[0]!.maxRemainingDistrict + dcmpEventMax);
  });

  it("a DCMP DIVISION Winner (award_type 1 at event_type 5) qualifies NOTHING — division champions are not the DCMP winning alliance", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 10, rank: 1 }), ranking({ teamKey: "frc2", pointTotal: 500, rank: 2 })];
    const events = [districtEvent({ eventKey: "2026dcmp", eventType: 2 }), districtEvent({ eventKey: "2026dcmp1", eventType: 5 })];
    const awards = new Map([["2026dcmp1", [eventAward({ eventKey: "2026dcmp1", awardType: 1, teamKey: "frc1" }), eventAward({ eventKey: "2026dcmp1", awardType: 0, teamKey: "frc1" })]]]);

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: 1, cmpSlots: 1 }),
      rankings,
      events,
      registrations: new Map(),
      awards,
      teamMeta: new Map(),
    });

    const frc1 = artifact.teams.find((t) => t.teamKey === "frc1")!;
    expect(frc1.champLock.status).not.toBe("lockedAward");
    expect(frc1.districtLock.status).not.toBe("lockedAward");
    expect(frc1.qualifyingAwards).toEqual([]);
  });

  it("a DCMP Winner (award_type 1) is champLock lockedAward, though Winner is never relevant at the district tier", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 10, rank: 1 }), ranking({ teamKey: "frc2", pointTotal: 500, rank: 2 })];
    const events = [districtEvent({ eventKey: "2026dcmp", eventType: 2 })];
    const awards = new Map([["2026dcmp", [eventAward({ eventKey: "2026dcmp", awardType: 1, teamKey: "frc1" })]]]);

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: 1, cmpSlots: 1 }),
      rankings,
      events,
      registrations: new Map(),
      awards,
      teamMeta: new Map(),
    });

    const frc1 = artifact.teams.find((t) => t.teamKey === "frc1")!;
    expect(frc1.champLock.status).toBe("lockedAward");
    expect(frc1.qualifyingAwards).toEqual([{ eventKey: "2026dcmp", awardType: 1, label: "Winner", awardOnly: false }]);
  });

  it("a curated pre-qualified team (Hall of Fame) reports champLock prequalified regardless of its own points, never districtLock prequalified (champ tier only)", () => {
    // frc4613 is on the 2026 Hall of Fame list (prequalified.ts).
    const rankings = [ranking({ teamKey: "frc4613", pointTotal: 0, rank: 2 }), ranking({ teamKey: "frc2", pointTotal: 500, rank: 1 })];

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: 1, cmpSlots: 1 }),
      rankings,
      events: [],
      registrations: new Map(),
      awards: new Map(),
      teamMeta: new Map(),
    });

    const frc4613 = artifact.teams.find((t) => t.teamKey === "frc4613")!;
    expect(frc4613.champLock.status).toBe("prequalified");
    expect(frc4613.districtLock.status).not.toBe("prequalified");
  });

  it("2025fsc overrides every team's champLock to unknown with the documented allocationNote, and leaves districtLock unaffected", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 500, rank: 1 }), ranking({ teamKey: "frc2", pointTotal: 5, rank: 2 })];

    const artifact = buildDistrictArtifact({
      season: 2025,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ districtKey: "2025fsc", abbreviation: "fsc", displayName: "FIRST South Carolina", dcmpSlots: 5, cmpSlots: 5 }),
      rankings,
      events: [],
      registrations: new Map(),
      awards: new Map(),
      teamMeta: new Map(),
    });

    for (const team of artifact.teams) {
      expect(team.champLock.status).toBe("unknown");
      expect(team.champLock.pointsToLock).toBeNull();
      expect(team.champLock.cutLinePoints).toBeNull();
      expect(team.champLock.allocationNote).toBe("special allocation, not modeled");
      expect(team.districtLock.allocationNote).toBeNull();
    }
    // districtLock still runs the ordinary points math -- frc1 (500 points, 1 slot) is locked.
    expect(artifact.teams.find((t) => t.teamKey === "frc1")!.districtLock.status).toBe("locked");
  });

  it("every ordinary district-year's allocationNote is null on both locks", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 100, rank: 1 })];
    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district(),
      rankings,
      events: [],
      registrations: new Map(),
      awards: new Map(),
      teamMeta: new Map(),
    });
    expect(artifact.teams[0]!.districtLock.allocationNote).toBeNull();
    expect(artifact.teams[0]!.champLock.allocationNote).toBeNull();
  });
});

describe("buildDistrictArtifact cut lines (sharing the lock verdicts' own pool/slot derivation)", () => {
  it("a DCMP Winner award (award_type 1, consuming at the DCMP tier) to a team ranked below cmpSlots pulls insights.cmpCutLinePoints ABOVE the naive rank-slot value, and every team's champLock.cutLinePoints matches it", () => {
    const rankings = [
      ranking({ teamKey: "a", rank: 1, pointTotal: 100 }),
      ranking({ teamKey: "b", rank: 2, pointTotal: 90 }),
      ranking({ teamKey: "c", rank: 3, pointTotal: 80 }),
      ranking({ teamKey: "d", rank: 4, pointTotal: 70 }),
    ];
    const events = [districtEvent({ eventKey: "2026dcmp", eventType: 2 })];
    const awards = new Map([["2026dcmp", [eventAward({ eventKey: "2026dcmp", awardType: 1, teamKey: "d" })]]]);

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: 4, cmpSlots: 3 }),
      rankings,
      events,
      registrations: new Map(),
      awards,
      teamMeta: new Map(),
    });

    // Naive rank-slot answer (the old cutLinePointsFor): rankings[cmpSlots-1] = "c" at 80.
    // Pool-consistent answer: "d" is award-qualified (removed from the pool,
    // pointsSlots = 3 - 1 = 2), so the pool is [a, b, c] and the 2nd-highest is 90.
    expect(artifact.insights.cmpCutLinePoints).toBe(90);
    expect(artifact.insights.cmpCutLinePoints).toBeGreaterThan(80);
    for (const team of artifact.teams) {
      expect(team.champLock.cutLinePoints).toBe(90);
    }
  });

  it("a district-event Impact award (award_type 0, consuming at the district-event tier) to a team ranked below dcmpSlots pulls insights.dcmpCutLinePoints ABOVE the naive rank-slot value", () => {
    const rankings = [
      ranking({ teamKey: "e", rank: 1, pointTotal: 100 }),
      ranking({ teamKey: "f", rank: 2, pointTotal: 90 }),
      ranking({ teamKey: "g", rank: 3, pointTotal: 80 }),
      ranking({ teamKey: "h", rank: 4, pointTotal: 70 }),
    ];
    const events = [districtEvent({ eventKey: "2026e1", eventType: 1 })];
    const awards = new Map([["2026e1", [eventAward({ eventKey: "2026e1", awardType: 0, teamKey: "h" })]]]);

    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: 3, cmpSlots: 1 }),
      rankings,
      events,
      registrations: new Map(),
      awards,
      teamMeta: new Map(),
    });

    // Naive rank-slot answer: rankings[dcmpSlots-1] = "g" at 80.
    // Pool-consistent answer: "h" is award-qualified (pointsSlots = 3 - 1 = 2),
    // pool [e, f, g], 2nd-highest is 90.
    expect(artifact.insights.dcmpCutLinePoints).toBe(90);
    expect(artifact.insights.dcmpCutLinePoints).toBeGreaterThan(80);
    for (const team of artifact.teams) {
      expect(team.districtLock.cutLinePoints).toBe(90);
    }
  });

  it("2025fsc still publishes a null champ cut line", () => {
    const rankings = [ranking({ teamKey: "frc1", pointTotal: 500, rank: 1 }), ranking({ teamKey: "frc2", pointTotal: 5, rank: 2 })];
    const artifact = buildDistrictArtifact({
      season: 2025,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ districtKey: "2025fsc", abbreviation: "fsc", displayName: "FIRST South Carolina", dcmpSlots: 5, cmpSlots: 5 }),
      rankings,
      events: [],
      registrations: new Map(),
      awards: new Map(),
      teamMeta: new Map(),
    });
    expect(artifact.insights.cmpCutLinePoints).toBeNull();
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

// ---------------------------------------------------------------------------
// 10-06 — additive describes. Every expectation above this line is committed
// and unchanged; `git diff` is the proof.
// ---------------------------------------------------------------------------

describe("buildDistrictArtifact — ONE verdict pass, two callers", () => {
  it("produces exactly what the shared pass produces for the same rows: both locks, both cut lines and all four insight counts", () => {
    const rankings = [
      ranking({
        teamKey: "frc1",
        pointTotal: 120,
        rank: 1,
        eventPointsRaw: eventPointsRaw([{ event_key: "2026e1", district_cmp: false, qual_points: 20, alliance_points: 14, elim_points: 20, award_points: 5, total: 59 }]),
      }),
      ranking({
        teamKey: "frc2",
        pointTotal: 90,
        rank: 2,
        eventPointsRaw: eventPointsRaw([{ event_key: "2026e1", district_cmp: false, qual_points: 18, alliance_points: 12, elim_points: 10, award_points: 0, total: 40 }]),
      }),
      ranking({ teamKey: "frc3", pointTotal: 10, rank: 3, eventPointsRaw: "[]" }),
    ];
    const events = [districtEvent({ eventKey: "2026e1", eventType: 1 }), districtEvent({ eventKey: "2026dcmp", eventType: 2 })];
    const artifact = buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district({ dcmpSlots: 2, cmpSlots: 1 }),
      rankings,
      events,
      registrations: new Map([["2026e1", ["frc3"]]]),
      awards: new Map(),
      teamMeta: new Map(),
    });

    // Handing the PUBLISHED artifact straight back to the shared pass must be a
    // NO-OP. If the publisher's verdicts came from any second implementation,
    // this comparison is where the two would differ.
    const tierByEvent = new Map<string, "district" | "dcmp">([
      ["2026e1", "district"],
      ["2026dcmp", "dcmp"],
    ]);
    const reRun = recomputeDistrictVerdicts(artifact, { tierByEvent });
    for (let i = 0; i < artifact.teams.length; i++) {
      expect(reRun.teams[i]!.districtLock).toEqual(artifact.teams[i]!.districtLock);
      expect(reRun.teams[i]!.champLock).toEqual(artifact.teams[i]!.champLock);
      expect(reRun.teams[i]!.maxRemainingChamp).toBe(artifact.teams[i]!.maxRemainingChamp);
    }
    expect(reRun.insights).toEqual(artifact.insights);
  });
});

describe("the publish byte gate", () => {
  /** `frc88`'s real TBA nickname: three UTF-16 code units, FOUR UTF-8 bytes. */
  const NON_ASCII_NICKNAME = "TJ²";

  function nonAsciiArtifact() {
    return buildDistrictArtifact({
      season: 2026,
      generation: GENERATION,
      computedAt: COMPUTED_AT,
      district: district(),
      rankings: [ranking({ teamKey: "frc88", rank: 1, pointTotal: 50 })],
      events: [districtEvent({ eventKey: "2026e1", eventType: 1 })],
      registrations: new Map(),
      awards: new Map(),
      teamMeta: new Map([["frc88", { teamNumber: 88, nickname: NON_ASCII_NICKNAME }]]),
    });
  }

  it("counts UTF-8 bytes, which for a non-ASCII nickname is STRICTLY MORE than the code-unit count", () => {
    expect(NON_ASCII_NICKNAME.length).toBe(3);
    expect(Buffer.byteLength(NON_ASCII_NICKNAME)).toBe(4);
    const body = JSON.stringify(nonAsciiArtifact());
    expect(body).toContain(NON_ASCII_NICKNAME);
    // A regression to a code-unit count would report the smaller number, and a
    // gate built on it would be short by exactly the amount that matters.
    expect(Buffer.byteLength(body)).toBeGreaterThan(body.length);
  });

  it("localOutFileName flattens an R2 key's separators, so one folder holds every composed object", () => {
    expect(localOutFileName("v1/district/2026fnc.json")).toBe("v1__district__2026fnc.json");
    expect(localOutFileName("v1/district-presim/2026pnw/2026wabon.json")).toBe("v1__district-presim__2026pnw__2026wabon.json");
  });
});

describe("run() over the real corpus — the gate and --no-bake", () => {
  if (!existsSync(CORPUS_PATH)) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest:districts) first`, () => {});
    return;
  }

  it("the budget gate fires BEFORE anything is written: a one-byte ceiling throws, and the local output folder stays empty", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "publish-districts-gate-"));
    try {
      await expect(
        run({
          years: [2026],
          bucket: "unused",
          dryRun: true,
          asOf: COMPUTED_AT,
          localOut: outDir,
          bake: false,
          ceilings: { detailPerTeam: 1, detailAbsolute: 1, presim: 1 },
        })
      ).rejects.toThrow(DistrictBudgetExceededError);
      // A gate that fires AFTER the file is written is a log line, not a gate.
      expect(readdirSync(outDir)).toEqual([]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("--no-bake is LOUD: no replay line is printed, the warning names the consequence, and no sidecar is composed", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "publish-districts-nobake-"));
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      await run({ years: [2026], bucket: "unused", dryRun: true, asOf: COMPUTED_AT, localOut: outDir, bake: false });
    } finally {
      console.log = original;
    }
    try {
      // A silent degradation is the one thing this flag must never be.
      expect(lines.some((line) => line.includes("--no-bake") && line.includes("no baked-event list"))).toBe(true);
      // The pricing-state builder was never reached: its replay line is absent.
      expect(lines.some((line) => line.includes("match(es) across"))).toBe(false);
      expect(lines.some((line) => line.includes("bake census"))).toBe(false);
      expect(readdirSync(outDir).some((name) => name.includes("district-presim"))).toBe(false);
      const written = readdirSync(outDir).filter((name) => name.startsWith("v1__district__"));
      expect(written.length).toBeGreaterThan(0);
      for (const name of written) {
        const artifact = JSON.parse(readFileSync(join(outDir, name), "utf8")) as { bakedEvents?: string[] };
        expect(artifact.bakedEvents).toBeUndefined();
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe("parseOptions — the new flags", () => {
  it("round-trips --as-of, --local-out and --no-bake", () => {
    const options = parseOptions(["--years", "2026", "--as-of", "2026-03-07", "--local-out", "data/out", "--no-bake", "--dry-run"]);
    expect(options.years).toEqual([2026]);
    expect(options.asOf).toBe("2026-03-07T00:00:00.000Z");
    expect(options.localOut).toBe("data/out");
    expect(options.bake).toBe(false);
    expect(options.dryRun).toBe(true);
  });

  it("defaults --as-of to the run's own clock and leaves baking ON", () => {
    const before = Date.now();
    const options = parseOptions(["--years", "2026"]);
    const after = Date.now();
    const parsed = Date.parse(options.asOf);
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
    expect(parsed).toBeLessThanOrEqual(after + 1000);
    expect(options.bake).toBe(true);
    expect(options.localOut).toBeUndefined();
  });

  it("throws naming the flag and the value for an unparseable --as-of", () => {
    expect(() => parseOptions(["--years", "2026", "--as-of", "yesterday"])).toThrow(/--as-of "yesterday"/);
  });

  it("throws for an --as-of later than the run's own clock — a future instant stamps a provenance that is a lie", () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(() => parseOptions(["--years", "2026", "--as-of", future])).toThrow(/later than the run's own clock/);
  });

  it("parses --warmup-from as an integer season and refuses a non-integer", () => {
    expect(parseOptions(["--years", "2026", "--warmup-from", "2024"]).warmupFrom).toBe(2024);
    expect(() => parseOptions(["--years", "2026", "--warmup-from", "early"])).toThrow(/--warmup-from/);
  });
});

// ---------------------------------------------------------------------------
// 10-06 Task 2 — the four state facts
// ---------------------------------------------------------------------------

/** An in-memory corpus carrying only the tables `deriveDistrictEventState` reads. */
function stateFixture(rows: {
  matches?: Array<{ match_key: string; event_key: string; comp_level: string; winner: string | null }>;
  alliances?: Array<{ event_key: string; alliance_number: number }>;
  awards?: Array<{ event_key: string; award_type: number; team_key: string }>;
  awardsAll?: Array<{ event_key: string; award_type: number; award_index: number; recipient_index: number }>;
  rankings?: Array<{ district_key: string; team_key: string; event_points_raw: string }>;
}): Corpus {
  const db = new Database(":memory:") as unknown as Corpus;
  db.prepare(`CREATE TABLE matches (match_key TEXT PRIMARY KEY, event_key TEXT, comp_level TEXT, winner TEXT)`).run();
  db.prepare(`CREATE TABLE event_alliances (event_key TEXT, alliance_number INTEGER)`).run();
  db.prepare(`CREATE TABLE event_awards (event_key TEXT, award_type INTEGER, team_key TEXT)`).run();
  db.prepare(`CREATE TABLE event_awards_all (event_key TEXT, award_type INTEGER, award_index INTEGER, recipient_index INTEGER)`).run();
  db.prepare(`CREATE TABLE district_rankings (district_key TEXT, team_key TEXT, event_points_raw TEXT)`).run();
  for (const m of rows.matches ?? []) db.prepare(`INSERT INTO matches VALUES (?,?,?,?)`).run(m.match_key, m.event_key, m.comp_level, m.winner);
  for (const a of rows.alliances ?? []) db.prepare(`INSERT INTO event_alliances VALUES (?,?)`).run(a.event_key, a.alliance_number);
  for (const a of rows.awards ?? []) db.prepare(`INSERT INTO event_awards VALUES (?,?,?)`).run(a.event_key, a.award_type, a.team_key);
  for (const a of rows.awardsAll ?? []) db.prepare(`INSERT INTO event_awards_all VALUES (?,?,?,?)`).run(a.event_key, a.award_type, a.award_index, a.recipient_index);
  for (const r of rows.rankings ?? []) db.prepare(`INSERT INTO district_rankings VALUES (?,?,?)`).run(r.district_key, r.team_key, r.event_points_raw);
  return db;
}

function quals(eventKey: string, total: number, played: number) {
  return Array.from({ length: total }, (_, i) => ({ match_key: `${eventKey}_qm${i + 1}`, event_key: eventKey, comp_level: "qm", winner: i < played ? "red" : null }));
}

/** An event well in the past relative to every `asOf` these tests use. */
const STARTED = "2026-03-01";
const DERIVE_AS_OF = "2026-09-01T00:00:00.000Z";

describe("deriveDistrictEventState — the four state facts", () => {
  it("a finished event reports every qualification match played, all three booleans true, and parses through the schema", () => {
    const db = stateFixture({
      matches: [
        ...quals("2026e1", 12, 12),
        { match_key: "2026e1_f1m1", event_key: "2026e1", comp_level: "f", winner: "red" },
      ],
      alliances: [{ event_key: "2026e1", alliance_number: 1 }],
      awards: [{ event_key: "2026e1", award_type: 0, team_key: "frc1" }],
    });
    try {
      const state = deriveDistrictEventState(db, [districtEvent({ eventKey: "2026e1", startDate: STARTED })], DERIVE_AS_OF).get("2026e1")!;
      expect(state).toEqual({ qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: true, playoffsDone: true, awardsPosted: true });
      expect(() => DistrictEventStateSchema.parse(state)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("an event mid-qualification reports the played count against the full schedule and all three booleans false", () => {
    const db = stateFixture({ matches: quals("2026e1", 12, 5) });
    try {
      const state = deriveDistrictEventState(db, [districtEvent({ eventKey: "2026e1", startDate: STARTED })], DERIVE_AS_OF).get("2026e1")!;
      expect(state).toEqual({ qualMatchesPlayed: 5, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
    } finally {
      db.close();
    }
  });

  it("an event with NO qualification rows reports a NULL total — never a fabricated zero", () => {
    const db = stateFixture({ matches: [] });
    try {
      const state = deriveDistrictEventState(db, [districtEvent({ eventKey: "2026isde3", startDate: STARTED })], DERIVE_AS_OF).get("2026isde3")!;
      expect(state.qualMatchesTotal).toBeNull();
      // Explicitly NOT zero: a zero would claim a zero-match event, which is a
      // different fact from "TBA has published no schedule".
      expect(state.qualMatchesTotal).not.toBe(0);
      expect(state.qualMatchesPlayed).toBe(0);
    } finally {
      db.close();
    }
  });

  it("alliances announced before the bracket runs reads true; elimination rows with no alliance rows reads false and does NOT throw", () => {
    const withAlliances = stateFixture({
      matches: [...quals("2026e1", 12, 12), { match_key: "2026e1_sf1m1", event_key: "2026e1", comp_level: "sf", winner: null }],
      alliances: [{ event_key: "2026e1", alliance_number: 1 }],
    });
    try {
      const state = deriveDistrictEventState(withAlliances, [districtEvent({ eventKey: "2026e1", startDate: STARTED })], DERIVE_AS_OF).get("2026e1")!;
      expect(state.alliancesPicked).toBe(true);
      expect(state.playoffsDone).toBe(false);
    } finally {
      withAlliances.close();
    }

    const withoutAlliances = stateFixture({
      matches: [...quals("2026e1", 12, 12), { match_key: "2026e1_sf1m1", event_key: "2026e1", comp_level: "sf", winner: "red" }],
    });
    try {
      // The schema carries NO implication refinement between the three
      // booleans on purpose: a real artifact can hold elimination matches with
      // no published alliances, and a schema that rejects a real state blocks a
      // live write.
      const state = deriveDistrictEventState(withoutAlliances, [districtEvent({ eventKey: "2026e1", startDate: STARTED })], DERIVE_AS_OF).get("2026e1")!;
      expect(state.alliancesPicked).toBe(false);
      expect(() => DistrictEventStateSchema.parse(state)).not.toThrow();
    } finally {
      withoutAlliances.close();
    }
  });

  it("playoffsDone needs BOTH halves: a decided final AND no open elimination row", () => {
    const cases: Array<{ name: string; elim: Array<{ match_key: string; comp_level: string; winner: string | null }>; expected: boolean }> = [
      {
        name: "a decided final with another elimination row still open",
        elim: [
          { match_key: "2026e1_sf1m1", comp_level: "sf", winner: null },
          { match_key: "2026e1_f1m1", comp_level: "f", winner: "red" },
        ],
        expected: false,
      },
      {
        name: "no final at all with every other elimination row decided",
        elim: [{ match_key: "2026e1_sf1m1", comp_level: "sf", winner: "red" }],
        expected: false,
      },
      {
        name: "a decided final with every elimination row decided",
        elim: [
          { match_key: "2026e1_sf1m1", comp_level: "sf", winner: "red" },
          { match_key: "2026e1_f1m1", comp_level: "f", winner: "blue" },
        ],
        expected: true,
      },
    ];
    for (const testCase of cases) {
      const db = stateFixture({
        matches: [...quals("2026e1", 12, 12), ...testCase.elim.map((m) => ({ ...m, event_key: "2026e1" }))],
      });
      try {
        const state = deriveDistrictEventState(db, [districtEvent({ eventKey: "2026e1", startDate: STARTED })], DERIVE_AS_OF).get("2026e1")!;
        expect(state.playoffsDone, testCase.name).toBe(testCase.expected);
      } finally {
        db.close();
      }
    }
  });

  it("awardsPosted has three POSITIVE sources and no negative one — a zero award_points entry can never flip it true", () => {
    const base = () => quals("2026e1", 12, 12);
    const fromAwardsAll = stateFixture({ matches: base(), awardsAll: [{ event_key: "2026e1", award_type: 5, award_index: 0, recipient_index: 0 }] });
    const fromAwards = stateFixture({ matches: base(), awards: [{ event_key: "2026e1", award_type: 0, team_key: "frc1" }] });
    const fromPoints = stateFixture({
      matches: base(),
      rankings: [{ district_key: "2026fnc", team_key: "frc1", event_points_raw: eventPointsRaw([{ event_key: "2026e1", district_cmp: false, qual_points: 10, alliance_points: 0, elim_points: 0, award_points: 5, total: 15 }]) }],
    });
    const fromNothing = stateFixture({ matches: base() });
    // The LOAD-BEARING case: every team present, every award_points ZERO.
    // CONTEXT forbids inferring posted-ness FROM award_points, because a team at
    // zero is indistinguishable from awards not yet posted. A positive-only
    // clause can never manufacture a premature grey cell; it can only rescue a
    // real one whose award rows are missing from a gitignored table.
    const fromZeroPoints = stateFixture({
      matches: base(),
      rankings: ["frc1", "frc2", "frc3"].map((teamKey) => ({
        district_key: "2026fnc",
        team_key: teamKey,
        event_points_raw: eventPointsRaw([{ event_key: "2026e1", district_cmp: false, qual_points: 10, alliance_points: 0, elim_points: 0, award_points: 0, total: 10 }]),
      })),
    });
    const event = [districtEvent({ eventKey: "2026e1", startDate: STARTED })];
    try {
      expect(deriveDistrictEventState(fromAwardsAll, event, DERIVE_AS_OF).get("2026e1")!.awardsPosted).toBe(true);
      expect(deriveDistrictEventState(fromAwards, event, DERIVE_AS_OF).get("2026e1")!.awardsPosted).toBe(true);
      expect(deriveDistrictEventState(fromPoints, event, DERIVE_AS_OF).get("2026e1")!.awardsPosted).toBe(true);
      expect(deriveDistrictEventState(fromNothing, event, DERIVE_AS_OF).get("2026e1")!.awardsPosted).toBe(false);
      expect(deriveDistrictEventState(fromZeroPoints, event, DERIVE_AS_OF).get("2026e1")!.awardsPosted).toBe(false);
    } finally {
      for (const db of [fromAwardsAll, fromAwards, fromPoints, fromNothing, fromZeroPoints]) db.close();
    }
  });

  it("counts DISTINCT match keys, so a duplicated alliance or award row cannot push played above total", () => {
    const db = stateFixture({
      matches: [...quals("2026e1", 12, 12), { match_key: "2026e1_f1m1", event_key: "2026e1", comp_level: "f", winner: "red" }],
      // A naive query joining these in would multiply the match counts.
      alliances: Array.from({ length: 8 }, (_, i) => ({ event_key: "2026e1", alliance_number: i + 1 })),
      awardsAll: Array.from({ length: 30 }, (_, i) => ({ event_key: "2026e1", award_type: 5, award_index: i, recipient_index: 0 })),
    });
    try {
      const state = deriveDistrictEventState(db, [districtEvent({ eventKey: "2026e1", startDate: STARTED })], DERIVE_AS_OF).get("2026e1")!;
      expect(state.qualMatchesPlayed).toBe(12);
      expect(state.qualMatchesTotal).toBe(12);
      expect(state.qualMatchesPlayed).toBeLessThanOrEqual(state.qualMatchesTotal!);
      expect(() => DistrictEventStateSchema.parse(state)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("an event that had not started at the as-of instant reports the honest not-yet-begun state", () => {
    const db = stateFixture({
      matches: [...quals("2026e1", 60, 60), { match_key: "2026e1_f1m1", event_key: "2026e1", comp_level: "f", winner: "red" }],
      alliances: [{ event_key: "2026e1", alliance_number: 1 }],
      awards: [{ event_key: "2026e1", award_type: 0, team_key: "frc1" }],
    });
    try {
      const state = deriveDistrictEventState(db, [districtEvent({ eventKey: "2026e1", startDate: "2026-04-10" })], "2026-03-07T00:00:00.000Z").get("2026e1")!;
      expect(state).toEqual({ qualMatchesPlayed: 0, qualMatchesTotal: null, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
    } finally {
      db.close();
    }
  });

  it("returns ONE block per event, so every team's row for that event carries a deeply equal state", () => {
    const db = stateFixture({
      matches: [...quals("2026e1", 12, 12), ...quals("2026e2", 12, 3)],
    });
    try {
      const state = deriveDistrictEventState(
        db,
        [districtEvent({ eventKey: "2026e1", startDate: STARTED }), districtEvent({ eventKey: "2026e2", startDate: STARTED })],
        DERIVE_AS_OF
      );
      expect([...state.keys()].sort()).toEqual(["2026e1", "2026e2"]);
      const artifact = buildDistrictArtifact({
        season: 2026,
        generation: GENERATION,
        computedAt: COMPUTED_AT,
        district: district(),
        rankings: [
          ranking({ teamKey: "frc1", rank: 1, eventPointsRaw: eventPointsRaw([{ event_key: "2026e1", district_cmp: false, qual_points: 10, alliance_points: 0, elim_points: 0, award_points: 0, total: 10 }]) }),
          ranking({ teamKey: "frc2", rank: 2, eventPointsRaw: eventPointsRaw([{ event_key: "2026e1", district_cmp: false, qual_points: 8, alliance_points: 0, elim_points: 0, award_points: 0, total: 8 }]) }),
        ],
        events: [districtEvent({ eventKey: "2026e1" }), districtEvent({ eventKey: "2026e2" })],
        registrations: new Map([["2026e2", ["frc1", "frc2"]]]),
        awards: new Map(),
        teamMeta: new Map(),
      });
      const written = applyDistrictEventState({ artifact, eventState: state, generation: GENERATION, computedAt: COMPUTED_AT });
      expect(written.teams[0]!.eventPoints[0]!.state).toEqual(written.teams[1]!.eventPoints[0]!.state);
      // And it lands on a remaining-event row too, not only on a played one.
      expect(written.teams[0]!.remainingEvents[0]!.eventKey).toBe("2026e2");
      expect(written.teams[0]!.remainingEvents[0]!.state).toEqual({ qualMatchesPlayed: 3, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
    } finally {
      db.close();
    }
  });
});

describe("classifyBakeCandidate — the bake-eligibility taxonomy", () => {
  const ROSTER = Array.from({ length: 30 }, (_, i) => `frc${i + 1}`);
  function args(overrides: Partial<Parameters<typeof classifyBakeCandidate>[0]> = {}) {
    return {
      event: districtEvent({ eventKey: "2026e1", eventType: 1 }),
      remainingEventKeys: new Set(["2026e1"]),
      roster: ROSTER,
      quals: undefined,
      startedEventKeys: new Set<string>(),
      ...overrides,
    };
  }

  it("a still-ahead event with zero played qualification matches is eligible", () => {
    expect(classifyBakeCandidate(args())).toBeNull();
  });

  it("an event no team carries in remainingEvents is not eligible", () => {
    expect(classifyBakeCandidate(args({ remainingEventKeys: new Set<string>() }))).toBe("not-a-remaining-event");
  });

  it("a divisioned DCMP parent (TBA event_type 2) is never baked", () => {
    // Measured: every 2026 district event whose alliance count is not eight is
    // one of these, and they carry no qualification schedule to generate.
    expect(
      classifyBakeCandidate(args({ event: districtEvent({ eventKey: "2026micmp", eventType: 2 }), remainingEventKeys: new Set(["2026micmp"]) }))
    ).toBe("divisioned-dcmp-parent");
  });

  it("an event with any played qualification match is the browser's, not the pipeline's", () => {
    expect(classifyBakeCandidate(args({ quals: { played: 1, total: 60 }, startedEventKeys: new Set(["2026e1"]) }))).toBe("already-in-progress");
    // ...but the SAME row set, at an instant before the event started, reads as
    // zero played, because at that instant it had played nothing.
    expect(classifyBakeCandidate(args({ quals: { played: 60, total: 60 }, startedEventKeys: new Set<string>() }))).toBeNull();
  });

  it("a roster outside the schedule generator's range is not eligible", () => {
    expect(classifyBakeCandidate(args({ roster: ["frc1", "frc2"] }))).toBe("roster-out-of-generator-range");
    expect(classifyBakeCandidate(args({ roster: [] }))).toBe("empty-roster");
  });
});

describe("the corpus-guarded state population (SC-5's offline half, on real data)", () => {
  if (!existsSync(CORPUS_PATH)) {
    it.skip(`skipped: ${CORPUS_PATH} not found — run the ingest pipeline (pnpm ingest:districts) first`, () => {});
    return;
  }

  it("pins the 2026 district population: at least 148 fully observed, exactly the two never-played events, zero played counts above a non-null total", () => {
    const db = openCorpusReadOnly(CORPUS_PATH);
    try {
      const rows = db
        .prepare(`SELECT event_key, name, week, event_type, start_date FROM events WHERE year = 2026 AND district_key IS NOT NULL ORDER BY event_key`)
        .all() as Array<{ event_key: string; name: string | null; week: number | null; event_type: number; start_date: string | null }>;
      const events: DistrictEventMeta[] = rows.map((row) => ({
        eventKey: row.event_key,
        name: row.name ?? row.event_key,
        week: row.week,
        eventType: row.event_type,
        startDate: row.start_date,
      }));
      // The run's own clock: no district event in the corpus is future-dated,
      // so the as-of horizon is an identity here and these are the corpus's own
      // facts.
      const state = deriveDistrictEventState(db, events, new Date().toISOString());

      expect(state.size).toBeGreaterThan(100); // non-vacuity
      const fullyObserved: string[] = [];
      const nullTotal: string[] = [];
      const neverPlayed: string[] = [];
      for (const [eventKey, observed] of state) {
        expect(() => DistrictEventStateSchema.parse(observed), eventKey).not.toThrow();
        if (observed.qualMatchesTotal !== null) {
          expect(observed.qualMatchesPlayed, `${eventKey} played above its non-null total`).toBeLessThanOrEqual(observed.qualMatchesTotal);
        } else {
          nullTotal.push(eventKey);
        }
        if (observed.alliancesPicked && observed.playoffsDone && observed.awardsPosted) fullyObserved.push(eventKey);
        if (!observed.alliancesPicked && !observed.playoffsDone && !observed.awardsPosted && observed.qualMatchesTotal === null) neverPlayed.push(eventKey);
      }
      console.log(
        `deriveDistrictEventState 2026: ${state.size} district events, ${fullyObserved.length} fully observed, ${nullTotal.length} with a null qualification total, never-played: ${neverPlayed.join(", ")}`
      );
      // A FLOOR for the population and a CEILING for the exceptions, so a later
      // legitimate ingest can only strengthen this result.
      expect(fullyObserved.length).toBeGreaterThanOrEqual(148);
      expect(nullTotal.length).toBeGreaterThanOrEqual(6);
      expect(neverPlayed.sort()).toEqual(["2026isde3", "2026isde4"]);
    } finally {
      db.close();
    }
  });
});
