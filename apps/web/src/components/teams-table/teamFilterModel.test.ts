/**
 * Fixtures are constructed to satisfy the published teams/{year} artifact's
 * row shape (quick task 260905-ttv, Task 2). Includes a row with no region
 * fields at all (the pre-republish back-compat case), a non-real team key,
 * and a state value that fails the two-letter-alpha rule.
 */
import { describe, expect, it } from "vitest";
import { PAGE_ARTIFACT_SCHEMA_VERSION, TeamsArtifactSchema, type TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { applyTeamFilters, teamFilterOptions, type TeamFilterRow, type TeamFilters } from "./teamFilterModel.js";

function makeArtifact(teams: unknown[]): TeamsArtifact {
  return TeamsArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "bpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    season: 2026,
    teams,
  });
}

function makeRow(overrides: Partial<TeamFilterRow> & { teamKey: string; teamNumber: number }): Record<string, unknown> {
  return {
    nickname: "Team",
    eventCount: 3,
    matchCount: 30,
    record: { wins: 10, losses: 2, ties: 0 },
    metrics: { total: { value: 50 } },
    ...overrides,
  };
}

const ROWS: TeamFilterRow[] = makeArtifact([
  makeRow({ teamKey: "frc1114", teamNumber: 1114, country: "USA", stateProv: "MI", districtKey: "fim" }),
  makeRow({ teamKey: "frc27", teamNumber: 27, country: "USA", stateProv: "MI", districtKey: "fim" }),
  makeRow({ teamKey: "frc118", teamNumber: 118, country: "USA", stateProv: "AL" }),
  makeRow({ teamKey: "frc254", teamNumber: 254, country: "CAN", stateProv: "ON", districtKey: "ont" }),
  // No region fields at all -- the pre-republish back-compat case.
  makeRow({ teamKey: "frc16", teamNumber: 16 }),
  // A stateProv value that fails the two-letter-alpha rule (numeric junk).
  makeRow({ teamKey: "frc1937", teamNumber: 1937, country: "Israel", stateProv: "06", districtKey: "isr" }),
  // A non-real (letter-suffixed) team key -- must not contribute options.
  makeRow({ teamKey: "frc1114B", teamNumber: 1114, country: "USA", stateProv: "ZZ", districtKey: "zzz" }),
]).teams;

describe("teamFilterOptions", () => {
  it("returns the distinct non-absent country/stateProv/districtKey values, sorted with localeCompare", () => {
    const options = teamFilterOptions(ROWS);
    expect(options.countries).toEqual(["CAN", "Israel", "USA"]);
    expect(options.districts).toEqual(["fim", "isr", "ont"]);
    // "06" (numeric) and "ZZ" (from the non-real frc1114B row) are excluded.
    expect(options.states).toEqual(["AL", "MI", "ON"]);
  });

  it("a dimension where no row carries a value yields an empty list", () => {
    const noRegionRows = [makeRow({ teamKey: "frc1", teamNumber: 1 }), makeRow({ teamKey: "frc2", teamNumber: 2 })] as unknown as TeamFilterRow[];
    const options = teamFilterOptions(noRegionRows);
    expect(options.countries).toEqual([]);
    expect(options.states).toEqual([]);
    expect(options.districts).toEqual([]);
  });

  it("a pre-republish artifact (no region fields on any row) yields three empty lists", () => {
    const artifact = makeArtifact([makeRow({ teamKey: "frc1114", teamNumber: 1114 }), makeRow({ teamKey: "frc27", teamNumber: 27 })]);
    const options = teamFilterOptions(artifact.teams);
    expect(options).toEqual({ countries: [], states: [], districts: [] });
  });

  it("only rows whose teamKey passes isRealTeamKey contribute options", () => {
    const options = teamFilterOptions(ROWS);
    expect(options.districts).not.toContain("zzz");
    expect(options.states).not.toContain("ZZ");
  });

  it("the state dimension keeps only two-letter alpha codes; a dropped value stays reachable through its country", () => {
    const options = teamFilterOptions(ROWS);
    expect(options.states).not.toContain("06");
    expect(options.countries).toContain("Israel");
  });

  it("never offers an 'Unknown' or empty-string option for an absent value", () => {
    const options = teamFilterOptions(ROWS);
    expect(options.countries).not.toContain("");
    expect(options.countries).not.toContain("Unknown");
  });
});

describe("applyTeamFilters", () => {
  it("an unset dimension does not filter", () => {
    expect(applyTeamFilters(ROWS, {})).toHaveLength(ROWS.length);
  });

  it("each set dimension is strict equality; a row whose value is absent can never match", () => {
    const filtered = applyTeamFilters(ROWS, { country: "USA" });
    expect(filtered.map((r) => r.teamKey).sort()).toEqual(["frc118", "frc1114", "frc1114B", "frc27"].sort());
    // frc16 has no country at all -- never matches a set country filter.
    expect(filtered.find((r) => r.teamKey === "frc16")).toBeUndefined();
  });

  it("two set dimensions intersect", () => {
    const filtered = applyTeamFilters(ROWS, { country: "USA", state: "MI" });
    expect(filtered.map((r) => r.teamKey).sort()).toEqual(["frc1114", "frc27"]);
  });

  it("a filter value matching nothing yields an empty array, not an error", () => {
    expect(applyTeamFilters(ROWS, { country: "Mars" })).toEqual([]);
  });

  it("a district filter matches only rows carrying that exact districtKey", () => {
    const filtered = applyTeamFilters(ROWS, { district: "fim" });
    expect(filtered.map((r) => r.teamKey).sort()).toEqual(["frc1114", "frc27"]);
  });
});

describe("TeamFilters type shape", () => {
  it("all three dimensions are optional", () => {
    const filters: TeamFilters = {};
    expect(filters).toEqual({});
  });
});
