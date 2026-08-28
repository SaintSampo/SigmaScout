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
        country: "USA" as string | null,
        stateProv: "CA" as string | null,
        districtKey: null as string | null,
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

describe("EventsListRowSchema — country/stateProv/districtKey (EVNT-01, plan 05-02)", () => {
  it("parses a row carrying all three location values", () => {
    const fixture = validEventsFixture();
    fixture.events[0]!.country = "USA";
    fixture.events[0]!.stateProv = "MI";
    fixture.events[0]!.districtKey = "fim";
    expect(() => EventsArtifactSchema.parse(fixture)).not.toThrow();
  });

  it("parses a row carrying null for all three location values", () => {
    const fixture = validEventsFixture();
    fixture.events[0]!.country = null;
    fixture.events[0]!.stateProv = null;
    fixture.events[0]!.districtKey = null;
    expect(() => EventsArtifactSchema.parse(fixture)).not.toThrow();
  });

  it("rejects a row omitting one of the three keys entirely — required keys, not optional ones", () => {
    const fixture = validEventsFixture();
    const { districtKey, ...rowWithoutDistrictKey } = fixture.events[0]!;
    const badFixture = { ...fixture, events: [rowWithoutDistrictKey] };
    expect(() => EventsArtifactSchema.parse(badFixture)).toThrow();
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

describe("D-09 replacement guarantee — played-match validation rule (Phase 6, plan 06-02 Task 3)", () => {
  /** A team-season fixture whose one event carries exactly one match row, so a test can freely mutate that single row. */
  function fixtureWithMatchRow(row: Record<string, unknown>) {
    const fixture = validTeamSeasonFixture();
    fixture.events[0]!.matches = [row as ReturnType<typeof validMatchRowFixture>];
    return fixture;
  }

  it("a played match carrying all three actual fields parses", () => {
    const row = validMatchRowFixture(); // carries actualWinner/actualRedScore/actualBlueScore
    expect(() => TeamSeasonArtifactSchema.parse(fixtureWithMatchRow(row))).not.toThrow();
  });

  it("a played match missing actualWinner fails, naming the played-match rule", () => {
    const { actualWinner, ...row } = validMatchRowFixture();
    const result = TeamSeasonArtifactSchema.safeParse(fixtureWithMatchRow(row));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("must carry all three"))).toBe(true);
    }
  });

  it("a played match missing actualRedScore fails, naming the played-match rule", () => {
    const { actualRedScore, ...row } = validMatchRowFixture();
    const result = TeamSeasonArtifactSchema.safeParse(fixtureWithMatchRow(row));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("must carry all three"))).toBe(true);
    }
  });

  it("a played match missing actualBlueScore fails, naming the played-match rule", () => {
    const { actualBlueScore, ...row } = validMatchRowFixture();
    const result = TeamSeasonArtifactSchema.safeParse(fixtureWithMatchRow(row));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("must carry all three"))).toBe(true);
    }
  });

  it("an unplayed match carrying none of the three actual fields parses", () => {
    const { actualWinner, actualRedScore, actualBlueScore, ...row } = validMatchRowFixture();
    expect(() => TeamSeasonArtifactSchema.parse(fixtureWithMatchRow(row))).not.toThrow();
  });

  it("a row carrying only actualRedScore (not actualWinner or actualBlueScore) fails", () => {
    const { actualWinner, actualBlueScore, ...row } = validMatchRowFixture();
    const result = TeamSeasonArtifactSchema.safeParse(fixtureWithMatchRow(row));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("must carry all three"))).toBe(true);
    }
  });
});

describe("TeamSeasonMatchSchema — D-01 own-variance and D-02 actual RP fields (Phase 6, plan 06-02 Task 3)", () => {
  function fixtureWithMatchRow(row: Record<string, unknown>) {
    const fixture = validTeamSeasonFixture() as unknown as Record<string, unknown>;
    const events = fixture.events as Array<Record<string, unknown>>;
    events[0]!.matches = [row];
    return fixture;
  }

  it("parses a row with redScoreVarianceOwn set and variance unset — the two are different quantities, neither implies the other", () => {
    const { variance, ...row } = validMatchRowFixture() as unknown as Record<string, unknown>;
    expect(() => TeamSeasonArtifactSchema.parse(fixtureWithMatchRow({ ...row, redScoreVarianceOwn: 12.5 }))).not.toThrow();
  });

  it("parses a row with both variance and redScoreVarianceOwn/blueScoreVarianceOwn present at once", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    const parsed = TeamSeasonArtifactSchema.parse(
      fixtureWithMatchRow({ ...row, variance: 30, redScoreVarianceOwn: 12.5, blueScoreVarianceOwn: 14.1 })
    );
    const parsedMatch = parsed.events[0]!.matches[0] as unknown as { variance?: number; redScoreVarianceOwn?: number };
    expect(parsedMatch.variance).toBe(30);
    expect(parsedMatch.redScoreVarianceOwn).toBe(12.5);
  });

  it("rejects a non-integer actualRedRp — bonus RP is an integer count by contract", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    expect(() => TeamSeasonArtifactSchema.parse(fixtureWithMatchRow({ ...row, actualRedRp: 1.5 }))).toThrow();
  });

  it("accepts null for actualRedRp/actualBlueRp — 'not derivable from available data', distinct from a real 0", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    const parsed = TeamSeasonArtifactSchema.parse(fixtureWithMatchRow({ ...row, actualRedRp: null, actualBlueRp: 0 }));
    const parsedMatch = parsed.events[0]!.matches[0] as unknown as { actualRedRp?: number | null; actualBlueRp?: number | null };
    expect(parsedMatch.actualRedRp).toBeNull();
    expect(parsedMatch.actualBlueRp).toBe(0);
  });
});

describe("TeamMetricSchema.percentile — D-04 boundary (Phase 6, plan 06-02 Task 3)", () => {
  function fixtureWithTotalPercentile(percentile: number) {
    const fixture = validTeamSeasonFixture() as unknown as Record<string, unknown>;
    const seasonStats = fixture.seasonStats as Record<string, unknown>;
    seasonStats.metrics = { total: { value: 45.2, spread: 3.1, percentile } };
    return fixture;
  }

  it("accepts percentile 0", () => {
    expect(() => TeamSeasonArtifactSchema.parse(fixtureWithTotalPercentile(0))).not.toThrow();
  });

  it("accepts percentile 100", () => {
    expect(() => TeamSeasonArtifactSchema.parse(fixtureWithTotalPercentile(100))).not.toThrow();
  });

  it("rejects percentile -0.1", () => {
    expect(() => TeamSeasonArtifactSchema.parse(fixtureWithTotalPercentile(-0.1))).toThrow();
  });

  it("rejects percentile 100.1", () => {
    expect(() => TeamSeasonArtifactSchema.parse(fixtureWithTotalPercentile(100.1))).toThrow();
  });
});

describe("TeamSeasonArtifactSchema — robotImageUrl/activeYears (D-03/D-05, Phase 6, plan 06-02 Task 3)", () => {
  it("parses a fixture with no robotImageUrl and no activeYears", () => {
    expect(() => TeamSeasonArtifactSchema.parse(validTeamSeasonFixture())).not.toThrow();
  });

  it("fails when robotImageUrl is not a URL", () => {
    const fixture = { ...validTeamSeasonFixture(), robotImageUrl: "not-a-url" };
    expect(() => TeamSeasonArtifactSchema.parse(fixture)).toThrow();
  });

  it("parses a fixture with a valid robotImageUrl and activeYears", () => {
    const fixture = { ...validTeamSeasonFixture(), robotImageUrl: "https://i.imgur.com/1kDEW6V.jpeg", activeYears: [2024, 2025, 2026] };
    expect(() => TeamSeasonArtifactSchema.parse(fixture)).not.toThrow();
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

describe("EventMatchSchema / EventUpcomingMatchSchema — redScoreVarianceOwn/blueScoreVarianceOwn and sortTime (D-18 item 3, D-13, plan 07-07 Task 1)", () => {
  /**
   * Mirrors `fixtureWithMatchRow`'s shape (see the D-01 own-variance describe
   * block above): spreads `validEventFixture()` and applies partial
   * overrides to the top level, to `matches[0]`, to `upcoming[0]` and to
   * `teams` — or, for the D-13 merge case, replaces the whole `matches`/
   * `upcoming` arrays outright. `validEventFixture` itself is never mutated.
   */
  function eventFixtureWith(
    overrides: {
      top?: Record<string, unknown>;
      match?: Record<string, unknown>;
      matches?: Array<Record<string, unknown>>;
      upcoming?: Record<string, unknown>;
      upcomingRows?: Array<Record<string, unknown>>;
      teams?: Array<Record<string, unknown>>;
    } = {}
  ) {
    const fixture = validEventFixture() as unknown as Record<string, unknown>;
    const baseMatches = fixture.matches as Array<Record<string, unknown>>;
    const baseUpcoming = fixture.upcoming as Array<Record<string, unknown>>;
    const matches = overrides.matches ?? [{ ...baseMatches[0]!, ...overrides.match }];
    const upcoming = overrides.upcomingRows ?? [{ ...baseUpcoming[0]!, ...overrides.upcoming }];
    return {
      ...fixture,
      ...overrides.top,
      matches,
      upcoming,
      ...(overrides.teams !== undefined ? { teams: overrides.teams } : {}),
    };
  }

  it("Test 2 — a played row carries both variance fields, read back off the parsed result", () => {
    const parsed = EventArtifactSchema.parse(eventFixtureWith({ match: { redScoreVarianceOwn: 41.25, blueScoreVarianceOwn: 38.5 } }));
    // Direct property access (no intermediate `as unknown as {...}` cast) is
    // load-bearing here (PD-10): before EventMatchSchema declares these
    // fields, this line is a `pnpm typecheck` error (TS2339, property does
    // not exist on the inferred zod type), not merely a runtime `undefined`.
    expect(parsed.matches[0]!.redScoreVarianceOwn).toBe(41.25);
    expect(parsed.matches[0]!.blueScoreVarianceOwn).toBe(38.5);
  });

  it("Test 3a — an upcoming row carries both variance fields, read back off the parsed result", () => {
    const parsed = EventArtifactSchema.parse(eventFixtureWith({ upcoming: { redScoreVarianceOwn: 41.25, blueScoreVarianceOwn: 38.5 } }));
    expect(parsed.upcoming[0]!.redScoreVarianceOwn).toBe(41.25);
    expect(parsed.upcoming[0]!.blueScoreVarianceOwn).toBe(38.5);
  });

  it("Test 3b — an upcoming row carrying both variance fields AND a redRpPmf summing to 0.4 still fails, naming the pmf rule — proves the new fields landed inside the object literal without disturbing the chained .refine() calls", () => {
    const result = EventArtifactSchema.safeParse(
      eventFixtureWith({ upcoming: { redScoreVarianceOwn: 41.25, blueScoreVarianceOwn: 38.5, redRpPmf: [0.2, 0.2] } })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("must be non-empty and sum to 1"))).toBe(true);
    }
  });

  it("Test 4 — the two fields are independently optional on a played row", () => {
    const parsed = EventArtifactSchema.parse(eventFixtureWith({ match: { redScoreVarianceOwn: 41.25 } }));
    expect(parsed.matches[0]!.redScoreVarianceOwn).toBe(41.25);
    expect(parsed.matches[0]!.blueScoreVarianceOwn).toBeUndefined();
  });

  it("Test 5 — the OPR/EPA case: a played row and an upcoming row carrying neither field both parse and both read back undefined", () => {
    const parsed = EventArtifactSchema.parse(validEventFixture());
    expect(parsed.matches[0]!.redScoreVarianceOwn).toBeUndefined();
    expect(parsed.matches[0]!.blueScoreVarianceOwn).toBeUndefined();
    expect(parsed.upcoming[0]!.redScoreVarianceOwn).toBeUndefined();
    expect(parsed.upcoming[0]!.blueScoreVarianceOwn).toBeUndefined();
  });

  it("Test 6 — sortTime round-trips on both a played row and an upcoming row", () => {
    const parsed = EventArtifactSchema.parse(eventFixtureWith({ match: { sortTime: 1710500000 }, upcoming: { sortTime: 1710503600 } }));
    expect(parsed.matches[0]!.sortTime).toBe(1710500000);
    expect(parsed.upcoming[0]!.sortTime).toBe(1710503600);
  });

  it("Test 6b — a row carrying no sortTime parses and reads it back as undefined — the pre-republish state", () => {
    const parsed = EventArtifactSchema.parse(validEventFixture());
    expect(parsed.matches[0]!.sortTime).toBeUndefined();
  });

  it("Test 7a — sortTime is rejected when non-integer", () => {
    const result = EventArtifactSchema.safeParse(eventFixtureWith({ match: { sortTime: 1710500000.5 } }));
    expect(result.success).toBe(false);
  });

  it("Test 7b — sortTime is rejected when null — matches.sort_time is NOT NULL in the corpus, so null is not a representable source state", () => {
    const result = EventArtifactSchema.safeParse(eventFixtureWith({ match: { sortTime: null } }));
    expect(result.success).toBe(false);
  });

  it("Test 8 — the D-13 merge is possible from the published shape alone: concatenating matches and upcoming and sorting by sortTime yields the four matchKeys in strict chronological order", () => {
    const baseMatch = validEventFixture().matches[0]!;
    const baseUpcoming = validEventFixture().upcoming[0]!;
    const fixture = eventFixtureWith({
      matches: [
        { ...baseMatch, matchKey: "2026casj_qm1", sortTime: 10 },
        { ...baseMatch, matchKey: "2026casj_qm3", sortTime: 30 },
      ],
      upcomingRows: [
        { ...baseUpcoming, matchKey: "2026casj_qm2", sortTime: 20 },
        { ...baseUpcoming, matchKey: "2026casj_qm4", sortTime: 40 },
      ],
    });
    const parsed = EventArtifactSchema.parse(fixture);
    type SortableRow = { matchKey: string; sortTime?: number };
    const merged = [...(parsed.matches as unknown as SortableRow[]), ...(parsed.upcoming as unknown as SortableRow[])].sort(
      (a, b) => (a.sortTime ?? 0) - (b.sortTime ?? 0)
    );
    expect(merged.map((row) => row.matchKey)).toEqual(["2026casj_qm1", "2026casj_qm2", "2026casj_qm3", "2026casj_qm4"]);
  });
});

describe("TeamSeasonMatchSchema — predicted/actual per-bonus RP fields (Phase 06.1, plan 06.1-05 Task 1)", () => {
  function fixtureWithMatchRow(row: Record<string, unknown>) {
    const fixture = validTeamSeasonFixture() as unknown as Record<string, unknown>;
    const events = fixture.events as Array<Record<string, unknown>>;
    events[0]!.matches = [row];
    return fixture;
  }

  it("a row with no bonus keys at all parses — every artifact published before this phase still validates", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    expect(() => TeamSeasonArtifactSchema.parse(fixtureWithMatchRow(row))).not.toThrow();
  });

  it("a row with a predicted bonus array of two probabilities in [0, 1] parses", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    expect(() =>
      TeamSeasonArtifactSchema.parse(fixtureWithMatchRow({ ...row, redBonusRp: [0.1, 0.9], blueBonusRp: [0.2, 0.8] }))
    ).not.toThrow();
  });

  it("a predicted bonus probability below 0 fails", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    const result = TeamSeasonArtifactSchema.safeParse(fixtureWithMatchRow({ ...row, redBonusRp: [-0.1, 0.9], blueBonusRp: [0.2, 0.8] }));
    expect(result.success).toBe(false);
  });

  it("a predicted bonus probability above 1 fails", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    const result = TeamSeasonArtifactSchema.safeParse(fixtureWithMatchRow({ ...row, redBonusRp: [0.1, 1.1], blueBonusRp: [0.2, 0.8] }));
    expect(result.success).toBe(false);
  });

  it("a predicted bonus array present but empty fails — absence, not emptiness, represents absent data", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    const result = TeamSeasonArtifactSchema.safeParse(fixtureWithMatchRow({ ...row, redBonusRp: [], blueBonusRp: [0.2, 0.8] }));
    expect(result.success).toBe(false);
  });

  it("mismatched predicted bonus array lengths across alliances fails", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    const result = TeamSeasonArtifactSchema.safeParse(fixtureWithMatchRow({ ...row, redBonusRp: [0.1, 0.9], blueBonusRp: [0.2] }));
    expect(result.success).toBe(false);
  });

  it("a row with actual bonus flag arrays of booleans parses", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    expect(() =>
      TeamSeasonArtifactSchema.parse(fixtureWithMatchRow({ ...row, actualRedBonusRp: [true, false], actualBlueBonusRp: [false, true] }))
    ).not.toThrow();
  });

  it("a row with both actual bonus arrays set to null parses, and the parsed result's actual fields are null rather than absent", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    const parsed = TeamSeasonArtifactSchema.parse(fixtureWithMatchRow({ ...row, actualRedBonusRp: null, actualBlueBonusRp: null }));
    const parsedMatch = parsed.events[0]!.matches[0] as unknown as { actualRedBonusRp?: boolean[] | null; actualBlueBonusRp?: boolean[] | null };
    expect(parsedMatch.actualRedBonusRp).toBeNull();
    expect(parsedMatch.actualBlueBonusRp).toBeNull();
  });

  it("an empty actual bonus array fails", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    const result = TeamSeasonArtifactSchema.safeParse(fixtureWithMatchRow({ ...row, actualRedBonusRp: [], actualBlueBonusRp: [false, true] }));
    expect(result.success).toBe(false);
  });

  it("mismatched non-null actual bonus array lengths across alliances fails", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    const result = TeamSeasonArtifactSchema.safeParse(
      fixtureWithMatchRow({ ...row, actualRedBonusRp: [true, false], actualBlueBonusRp: [false] })
    );
    expect(result.success).toBe(false);
  });

  it("a row with a predicted array present and the actual pair null parses — a scheduled-but-predicted or unparseable-breakdown match", () => {
    const row = validMatchRowFixture() as unknown as Record<string, unknown>;
    expect(() =>
      TeamSeasonArtifactSchema.parse(
        fixtureWithMatchRow({ ...row, redBonusRp: [0.1, 0.9], blueBonusRp: [0.2, 0.8], actualRedBonusRp: null, actualBlueBonusRp: null })
      )
    ).not.toThrow();
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
