/**
 * The five page-artifact schemas (plan 04-02 Task 2): a valid-fixture parse
 * per schema, the D-04 stamp requirement, the D-08 upcoming-match shape,
 * the empty-input edge (D-05/D-07), the `artifactKey` five-shape scheme
 * including the `compare` exception, and the mechanical raw-numbers-only
 * (D-21) field-name scan.
 */
import { describe, expect, it } from "vitest";
import {
  artifactKey,
  CompareArtifactSchema,
  EventArtifactSchema,
  EventsArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  TeamsArtifactSchema,
  TeamSeasonArtifactSchema,
} from "./pageArtifacts.js";

const PREAMBLE = {
  schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
  generation: "gen-1",
  computedAt: "2026-08-22T00:00:00.000Z",
};

const ALGO_PREAMBLE = {
  ...PREAMBLE,
  algorithmId: "opr",
  algorithmVersion: "3.0.0+baseline",
};

function validTeamsFixture() {
  return {
    ...ALGO_PREAMBLE,
    season: 2026,
    teams: [
      {
        teamKey: "frc254",
        teamNumber: 254,
        nickname: "The Cheesy Poofs",
        eventCount: 3,
        matchCount: 42,
        record: { wins: 30, losses: 10, ties: 2 },
        metrics: { total: { value: 45.2, spread: 3.1 } },
      },
    ],
  };
}

function validMatchRowFixture() {
  return {
    matchKey: "2026casj_qm1",
    season: 2026,
    eventKey: "2026casj",
    compLevel: "qm" as const,
    algorithmId: "opr",
    algorithmVersion: "3.0.0+baseline",
    predictedWinner: "red" as const,
    pRedWin: 0.62,
    predictedRedScore: 110,
    predictedBlueScore: 95,
    redComponents: {},
    blueComponents: {},
    actualWinner: "red" as const,
    actualRedScore: 120,
    actualBlueScore: 90,
    redTeams: ["frc254", "frc1678", "frc971"],
    blueTeams: ["frc604", "frc2054", "frc1323"],
  };
}

function validTeamSeasonFixture() {
  return {
    ...ALGO_PREAMBLE,
    teamKey: "frc254",
    teamNumber: 254,
    nickname: "The Cheesy Poofs",
    season: 2026,
    seasonStats: {
      record: { wins: 30, losses: 10, ties: 2 },
      metrics: { total: { value: 45.2, spread: 3.1 } },
    },
    events: [
      {
        eventKey: "2026casj",
        eventName: "Silicon Valley Regional",
        startDate: "2026-03-01",
        matches: [validMatchRowFixture()],
      },
    ],
    metricHistory: [
      {
        matchKey: "2026casj_qm1",
        season: 2026,
        eventKey: "2026casj",
        algorithmId: "opr",
        teamKey: "frc254",
        matchIndex: 0,
        metrics: { total: { value: 45.2, spread: 3.1 } },
      },
    ],
  };
}

function validEventsFixture() {
  return {
    ...ALGO_PREAMBLE,
    season: 2026,
    events: [
      {
        eventKey: "2026casj",
        name: "Silicon Valley Regional",
        eventType: 0,
        isOffseason: false,
        startDate: "2026-03-01",
        week: 1,
        teamCount: 40,
        matchCount: 80,
        playedMatchCount: 80,
      },
    ],
  };
}

function validEventFixture() {
  return {
    ...ALGO_PREAMBLE,
    eventKey: "2026casj",
    season: 2026,
    matches: [
      {
        matchKey: "2026casj_qm1",
        compLevel: "qm" as const,
        setNumber: 1,
        matchNumber: 1,
        redTeams: ["frc254", "frc1678", "frc971"],
        blueTeams: ["frc604", "frc2054", "frc1323"],
        predictedWinner: "red" as const,
        pRedWin: 0.62,
        predictedRedScore: 110,
        predictedBlueScore: 95,
        actualWinner: "red" as const,
        actualRedScore: 120,
        actualBlueScore: 90,
      },
    ],
    upcoming: [
      {
        matchKey: "2026casj_qm2",
        compLevel: "qm" as const,
        setNumber: 1,
        matchNumber: 2,
        redTeams: ["frc254", "frc118", "frc1114"],
        blueTeams: ["frc971", "frc2910", "frc330"],
        predictedWinner: "red" as const,
        pRedWin: 0.55,
        predictedRedScore: 100,
        predictedBlueScore: 90,
      },
    ],
    // 04-04: EventArtifactSchema.teams is required (not optional) as of
    // plan 04-04 Task 1 — publish.ts now always populates it (defaulting to
    // [] when an event genuinely has no team data in scope).
    teams: [],
  };
}

function validCompareFixture() {
  return {
    ...PREAMBLE,
    algorithms: [{ id: "opr", version: "3.0.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" }],
    slices: [
      {
        algorithmId: "opr",
        season: 2025,
        seasonLabel: "holdout" as const,
        headlineEligible: true,
        compLevelView: "combined" as const,
        brierScore: 0.18,
        winnerAccuracy: 0.72,
        scoredCount: 1000,
        tieCount: 0,
        noCallCount: 0,
        exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 },
        candidateCount: 1000,
        calibrationBins: [],
      },
    ],
  };
}

describe("valid-fixture parse — one per schema", () => {
  it("TeamsArtifactSchema parses a valid fixture", () => {
    expect(() => TeamsArtifactSchema.parse(validTeamsFixture())).not.toThrow();
  });

  it("TeamSeasonArtifactSchema parses a valid fixture", () => {
    expect(() => TeamSeasonArtifactSchema.parse(validTeamSeasonFixture())).not.toThrow();
  });

  it("EventsArtifactSchema parses a valid fixture", () => {
    expect(() => EventsArtifactSchema.parse(validEventsFixture())).not.toThrow();
  });

  it("EventArtifactSchema parses a valid fixture", () => {
    expect(() => EventArtifactSchema.parse(validEventFixture())).not.toThrow();
  });

  it("CompareArtifactSchema parses a valid fixture", () => {
    expect(() => CompareArtifactSchema.parse(validCompareFixture())).not.toThrow();
  });
});

describe("D-04 stamp — generation is required on all five schemas", () => {
  it("TeamsArtifactSchema rejects an object missing generation", () => {
    const { generation, ...rest } = validTeamsFixture();
    expect(() => TeamsArtifactSchema.parse(rest)).toThrow();
  });

  it("TeamSeasonArtifactSchema rejects an object missing generation", () => {
    const { generation, ...rest } = validTeamSeasonFixture();
    expect(() => TeamSeasonArtifactSchema.parse(rest)).toThrow();
  });

  it("EventsArtifactSchema rejects an object missing generation", () => {
    const { generation, ...rest } = validEventsFixture();
    expect(() => EventsArtifactSchema.parse(rest)).toThrow();
  });

  it("EventArtifactSchema rejects an object missing generation", () => {
    const { generation, ...rest } = validEventFixture();
    expect(() => EventArtifactSchema.parse(rest)).toThrow();
  });

  it("CompareArtifactSchema rejects an object missing generation", () => {
    const { generation, ...rest } = validCompareFixture();
    expect(() => CompareArtifactSchema.parse(rest)).toThrow();
  });
});

describe("algorithm-scoping — four pages require it, compare carries neither field", () => {
  it("CompareArtifactSchema requires algorithms with at least one entry", () => {
    expect(() => CompareArtifactSchema.parse({ ...validCompareFixture(), algorithms: [] })).toThrow();
  });

  it("CompareArtifactSchema's valid fixture carries no top-level algorithmId/algorithmVersion", () => {
    const parsed = CompareArtifactSchema.parse(validCompareFixture());
    expect("algorithmId" in parsed).toBe(false);
    expect("algorithmVersion" in parsed).toBe(false);
  });
});

describe("artifactKey — all five shapes, including the compare exception", () => {
  it("produces the teams key shape", () => {
    expect(artifactKey({ page: "teams", year: 2026, algorithmId: "opr", version: "3.0.0+baseline" })).toBe(
      "v1/teams/2026/opr@3.0.0+baseline.json"
    );
  });

  it("produces the team key shape", () => {
    expect(
      artifactKey({ page: "team", teamKey: "frc254", year: 2026, algorithmId: "opr", version: "3.0.0+baseline" })
    ).toBe("v1/team/frc254/2026/opr@3.0.0+baseline.json");
  });

  it("produces the events key shape", () => {
    expect(artifactKey({ page: "events", year: 2026, algorithmId: "opr", version: "3.0.0+baseline" })).toBe(
      "v1/events/2026/opr@3.0.0+baseline.json"
    );
  });

  it("produces the event key shape", () => {
    expect(
      artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "opr", version: "3.0.0+baseline" })
    ).toBe("v1/event/2026casj/opr@3.0.0+baseline.json");
  });

  it("produces the compare key shape with no algorithm segment", () => {
    expect(artifactKey({ page: "compare", year: 2026 })).toBe("v1/compare/2026.json");
  });
});

describe("empty-input edge (D-05/D-07) — a team with no matches is a valid empty artifact", () => {
  it("TeamSeasonArtifactSchema accepts events: [] and metricHistory: []", () => {
    const fixture = { ...validTeamSeasonFixture(), events: [], metricHistory: [] };
    expect(() => TeamSeasonArtifactSchema.parse(fixture)).not.toThrow();
  });
});

describe("EventArtifactSchema.upcoming — D-08's real shape", () => {
  it("accepts an upcoming entry with pRedWin and no redRpPmf/blueRpPmf", () => {
    expect(() => EventArtifactSchema.parse(validEventFixture())).not.toThrow();
  });

  it("accepts an upcoming entry carrying both pmf arrays", () => {
    const fixture: Record<string, unknown> = validEventFixture();
    fixture.upcoming = [
      {
        ...(validEventFixture().upcoming[0] as object),
        redRpPmf: [0.1, 0.2, 0.3, 0.4],
        blueRpPmf: [0.4, 0.3, 0.2, 0.1],
      },
    ];
    expect(() => EventArtifactSchema.parse(fixture)).not.toThrow();
  });
});

describe("raw-numbers-only (D-21) — no schema declares a comparison-shaped field", () => {
  const COMPARISON_PATTERN = /delta|beats|better|rankChange/i;

  function collectFieldNames(shape: Record<string, unknown>): string[] {
    return Object.keys(shape);
  }

  it("no top-level field on any of the five schemas matches the comparison pattern", () => {
    const schemas = [TeamsArtifactSchema, TeamSeasonArtifactSchema, EventsArtifactSchema, EventArtifactSchema, CompareArtifactSchema];
    for (const schema of schemas) {
      const names = collectFieldNames(schema.shape);
      for (const name of names) {
        expect(name).not.toMatch(COMPARISON_PATTERN);
      }
    }
  });

  it("no row-level field name (teams table row, event/team match rows, compare slice) matches the comparison pattern", () => {
    const teamsRow = validTeamsFixture().teams[0]!;
    const matchRow = validEventFixture().matches[0]!;
    const upcomingRow = validEventFixture().upcoming[0]!;
    const compareSlice = validCompareFixture().slices[0]!;
    const teamSeasonMatchRow = validTeamSeasonFixture().events[0]!.matches[0]!;

    const allRowNames = [
      ...Object.keys(teamsRow),
      ...Object.keys(matchRow),
      ...Object.keys(upcomingRow),
      ...Object.keys(compareSlice),
      ...Object.keys(teamSeasonMatchRow),
    ];
    for (const name of allRowNames) {
      expect(name).not.toMatch(COMPARISON_PATTERN);
    }
  });
});
