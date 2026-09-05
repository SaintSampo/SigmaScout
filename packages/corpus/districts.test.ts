/**
 * Corpus accessor tests for the three district tables (quick task 260905-lic
 * Task 1): `upsertDistrict`/`selectDistrictsForYear`,
 * `upsertDistrictRanking`/`selectDistrictRankings`,
 * `upsertEventTeam`/`selectEventTeamsForEvents`. Mirrors
 * `integrity.test.ts`'s temp-corpus fixture shape — a fresh `openCorpus` per
 * test, cleaned up in `afterEach`. Needs no real corpus; always runs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openCorpus,
  selectDistrictRankings,
  selectDistrictsForYear,
  selectEventTeamsForEvents,
  upsertDistrict,
  upsertDistrictRanking,
  upsertEvent,
  upsertEventTeam,
  type Corpus,
  type CorpusDistrict,
  type CorpusDistrictRanking,
  type CorpusEventTeam,
} from "./db.js";

function district(overrides: Partial<CorpusDistrict> = {}): CorpusDistrict {
  return {
    districtKey: "2026fnc",
    year: 2026,
    abbreviation: "fnc",
    displayName: "FIRST North Carolina",
    dcmpSlots: 54,
    cmpSlots: 19,
    fetchedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

function districtRanking(overrides: Partial<CorpusDistrictRanking> = {}): CorpusDistrictRanking {
  return {
    districtKey: "2026fnc",
    teamKey: "frc4561",
    rank: 1,
    pointTotal: 352,
    rookieBonus: 0,
    adjustments: 0,
    eventPointsRaw: JSON.stringify([
      { event_key: "2026ncwak", district_cmp: false, qual_points: 21, alliance_points: 16, elim_points: 20, award_points: 5, total: 62 },
    ]),
    fetchedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

function eventTeam(overrides: Partial<CorpusEventTeam> = {}): CorpusEventTeam {
  return {
    eventKey: "2026ncwak",
    teamKey: "frc4561",
    fetchedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("districts / district_rankings / event_teams corpus accessors (quick task 260905-lic Task 1)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-districts-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    // event_teams.event_key REFERENCES events(event_key) -- seed a minimal
    // events row so upsertEventTeam does not fail the foreign-key check.
    upsertEvent(db, {
      eventKey: "2026ncwak",
      year: 2026,
      eventType: 0,
      isOffseason: false,
      startDate: "2026-03-01",
      name: "Wake County Event",
      week: 1,
      country: "USA",
      stateProv: "NC",
      districtKey: "fnc",
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("upsertDistrict / selectDistrictsForYear", () => {
    it("round-trips a district with both slot counts populated", () => {
      upsertDistrict(db, district());
      const rows = selectDistrictsForYear(db, 2026);
      expect(rows).toEqual([district()]);
    });

    it("stores a district with no official capacity as null slots, never zero", () => {
      upsertDistrict(db, district({ dcmpSlots: null, cmpSlots: null }));
      const rows = selectDistrictsForYear(db, 2026);
      expect(rows[0]?.dcmpSlots).toBeNull();
      expect(rows[0]?.cmpSlots).toBeNull();
      expect(rows[0]?.dcmpSlots).not.toBe(0);
      expect(rows[0]?.cmpSlots).not.toBe(0);
    });

    it("districtKey (year-prefixed) and abbreviation (bare) are stored as distinct values", () => {
      upsertDistrict(db, district({ districtKey: "2026fnc", abbreviation: "fnc" }));
      const rows = selectDistrictsForYear(db, 2026);
      expect(rows[0]?.districtKey).toBe("2026fnc");
      expect(rows[0]?.abbreviation).toBe("fnc");
    });

    it("upserting the same district_key twice overwrites rather than duplicates", () => {
      upsertDistrict(db, district({ displayName: "First Name" }));
      upsertDistrict(db, district({ displayName: "Updated Name" }));
      const rows = selectDistrictsForYear(db, 2026);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.displayName).toBe("Updated Name");
    });

    it("selectDistrictsForYear scopes strictly to the requested year", () => {
      upsertDistrict(db, district({ districtKey: "2026fnc", year: 2026 }));
      upsertDistrict(db, district({ districtKey: "2025fnc", year: 2025 }));
      expect(selectDistrictsForYear(db, 2026)).toHaveLength(1);
      expect(selectDistrictsForYear(db, 2025)).toHaveLength(1);
      expect(selectDistrictsForYear(db, 2024)).toHaveLength(0);
    });
  });

  describe("upsertDistrictRanking / selectDistrictRankings", () => {
    it("round-trips a ranking row", () => {
      upsertDistrict(db, district());
      upsertDistrictRanking(db, districtRanking());
      const rows = selectDistrictRankings(db, "2026fnc");
      expect(rows).toEqual([districtRanking()]);
    });

    it("event_points_raw round-trips byte-identically through the corpus", () => {
      upsertDistrict(db, district());
      const raw = JSON.stringify([
        { event_key: "2026ncwak", district_cmp: false, qual_points: 21, alliance_points: 16, elim_points: 20, award_points: 5, total: 62 },
        { event_key: "2026nccmp", district_cmp: true, qual_points: 60, alliance_points: 45, elim_points: 90, award_points: 30, total: 225 },
      ]);
      upsertDistrictRanking(db, districtRanking({ eventPointsRaw: raw }));
      const rows = selectDistrictRankings(db, "2026fnc");
      expect(rows[0]?.eventPointsRaw).toBe(raw);
      expect(JSON.parse(rows[0]!.eventPointsRaw)).toEqual(JSON.parse(raw));
    });

    it("returns rows ordered ascending by rank", () => {
      upsertDistrict(db, district());
      upsertDistrictRanking(db, districtRanking({ teamKey: "frcThird", rank: 3 }));
      upsertDistrictRanking(db, districtRanking({ teamKey: "frcFirst", rank: 1 }));
      upsertDistrictRanking(db, districtRanking({ teamKey: "frcSecond", rank: 2 }));
      const rows = selectDistrictRankings(db, "2026fnc");
      expect(rows.map((r) => r.teamKey)).toEqual(["frcFirst", "frcSecond", "frcThird"]);
    });

    it("upserting the same (district_key, team_key) twice overwrites rather than duplicates", () => {
      upsertDistrict(db, district());
      upsertDistrictRanking(db, districtRanking({ pointTotal: 100 }));
      upsertDistrictRanking(db, districtRanking({ pointTotal: 250 }));
      const rows = selectDistrictRankings(db, "2026fnc");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.pointTotal).toBe(250);
    });

    it("carries no REFERENCES teams(team_key) constraint — a synthetic second-robot team key does not throw", () => {
      upsertDistrict(db, district());
      expect(() => upsertDistrictRanking(db, districtRanking({ teamKey: "frc1165B" }))).not.toThrow();
    });
  });

  describe("upsertEventTeam / selectEventTeamsForEvents", () => {
    it("round-trips a registration row", () => {
      upsertEventTeam(db, eventTeam());
      const result = selectEventTeamsForEvents(db, ["2026ncwak"]);
      expect(result.get("2026ncwak")).toEqual(["frc4561"]);
    });

    it("throws on a registration row whose event_key has no matching events row (event_key REFERENCES events(event_key))", () => {
      expect(() => upsertEventTeam(db, eventTeam({ eventKey: "2026doesnotexist" }))).toThrow(
        /FOREIGN KEY constraint failed/i
      );
    });

    it("carries no REFERENCES teams(team_key) constraint — a synthetic second-robot team key does not throw", () => {
      expect(() => upsertEventTeam(db, eventTeam({ teamKey: "frc1165B" }))).not.toThrow();
    });

    it("an event with no upserted registrations is absent from the returned map entirely, no placeholder entry", () => {
      const result = selectEventTeamsForEvents(db, ["2026ncwak"]);
      expect(result.has("2026ncwak")).toBe(false);
    });

    it("returns an empty map for an empty eventKeys array, does not query the database", () => {
      const result = selectEventTeamsForEvents(db, []);
      expect(result.size).toBe(0);
    });

    it("groups multiple teams under the same event key", () => {
      upsertEventTeam(db, eventTeam({ teamKey: "frc1" }));
      upsertEventTeam(db, eventTeam({ teamKey: "frc2" }));
      const result = selectEventTeamsForEvents(db, ["2026ncwak"]);
      expect(result.get("2026ncwak")?.sort()).toEqual(["frc1", "frc2"]);
    });

    it("upserting the same (event_key, team_key) twice overwrites rather than duplicates", () => {
      upsertEventTeam(db, eventTeam());
      upsertEventTeam(db, eventTeam());
      const result = selectEventTeamsForEvents(db, ["2026ncwak"]);
      expect(result.get("2026ncwak")).toEqual(["frc4561"]);
    });
  });
});
