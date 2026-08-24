/**
 * Assembly-level coverage for plan 04-04's widened `publish.ts` (T-04-22:
 * every assembly function parses through its Zod schema before returning,
 * so a validation failure occurs before any upload could possibly be
 * attempted). All fixtures are small, in-memory, hand-built objects — no
 * network, no corpus. The real full 2022-2026 run is recorded in the
 * SUMMARY, not re-run on every `pnpm test`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchResult, Prediction, UpcomingMatch } from "../core/algorithms/types.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { openCorpus, selectScheduledMatches, upsertEvent, upsertMatch, type Corpus } from "../corpus/db.js";
import type { PredictionRecord } from "./replay.js";
import {
  buildCompareArtifact,
  buildEventArtifact,
  buildEventsArtifact,
  buildTeamsArtifact,
  buildTeamSeasonArtifact,
  computeSizeStats,
  OUTCOME_KEYS,
  type PublishedObjectRecord,
} from "./publish.js";
import { ROUNDING_RULE } from "./rounding.js";
import type { ScoreSlice } from "./score.js";

vi.mock("./r2Client.js", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => ""),
}));
import { putObject } from "./r2Client.js";

function fixtureMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    matchKey: "2026casj_qm1",
    eventKey: "2026casj",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 1,
    redTeams: ["frc254", "frc1678", "frc971"],
    blueTeams: ["frc604", "frc2054", "frc1323"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    winner: "red",
    redScore: 120,
    blueScore: 95,
    redRpEarned: 2,
    blueRpEarned: 0,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: "{}",
    ...overrides,
  };
}

function fixturePrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    winner: "red",
    pRedWin: 0.6234567,
    redScore: 110.123456,
    blueScore: 100.654321,
    ...overrides,
  };
}

function fixtureUpcoming(overrides: Partial<UpcomingMatch> = {}): UpcomingMatch {
  return {
    matchKey: "2026casj_qm2",
    eventKey: "2026casj",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 2,
    redTeams: ["frc254", "frc118", "frc1114"],
    blueTeams: ["frc971", "frc2910", "frc330"],
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    ...overrides,
  };
}

describe("buildEventArtifact", () => {
  it("assembles a two-match fixture with upcoming and teams into a valid EventArtifact", () => {
    const predictions: PredictionRecord[] = [
      { match: fixtureMatch(), prediction: fixturePrediction() },
    ];
    const artifact = buildEventArtifact({
      eventKey: "2026casj",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      predictions,
      upcoming: [{ match: fixtureUpcoming(), prediction: fixturePrediction({ pRedWin: 0.4321 }) }],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", metrics: { total: { value: 45.6789, spread: 3.14159 } } }],
      generation: "test-generation-1",
      computedAt: "2026-08-22T00:00:00.000Z",
    });
    expect(artifact.matches).toHaveLength(1);
    expect(artifact.upcoming).toHaveLength(1);
    expect(artifact.teams).toHaveLength(1);
    expect(artifact.teams[0]?.metrics.total?.value).toBe(45.68);
  });

  it("defaults upcoming and teams to [] when omitted (matches plan 04-01's tracer usage)", () => {
    const predictions: PredictionRecord[] = [{ match: fixtureMatch(), prediction: fixturePrediction() }];
    const artifact = buildEventArtifact({
      eventKey: "2026casj",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      predictions,
      generation: "test-generation-1",
    });
    expect(artifact.upcoming).toEqual([]);
    expect(artifact.teams).toEqual([]);
  });

  it("rounds pRedWin to 4 decimals and predicted scores to 2 decimals (D-06)", () => {
    const artifact = buildEventArtifact({
      eventKey: "2026casj",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      predictions: [{ match: fixtureMatch(), prediction: fixturePrediction() }],
      generation: "g1",
    });
    expect(artifact.matches[0]?.pRedWin).toBe(0.6235);
    expect(artifact.matches[0]?.predictedRedScore).toBe(110.12);
    expect(artifact.matches[0]?.predictedBlueScore).toBe(100.65);
  });
});

describe("T-04-22: schema-parse failure occurs before any upload call is made", () => {
  it("buildEventArtifact throws on malformed input and putObject is never called", () => {
    vi.mocked(putObject).mockClear();
    const malformedPredictions = [
      { match: fixtureMatch({ compLevel: "invalid-level" as unknown as MatchResult["compLevel"] }), prediction: fixturePrediction() },
    ];
    expect(() =>
      buildEventArtifact({
        eventKey: "2026casj",
        season: 2026,
        algorithmId: "opr",
        algorithmVersion: "3.0.0+baseline",
        predictions: malformedPredictions,
        generation: "g1",
      })
    ).toThrow();
    expect(putObject).not.toHaveBeenCalled();
  });

  it("buildTeamsArtifact throws on a negative match count and putObject is never called", () => {
    vi.mocked(putObject).mockClear();
    expect(() =>
      buildTeamsArtifact({
        season: 2026,
        algorithmId: "opr",
        algorithmVersion: "3.0.0+baseline",
        teams: [
          {
            teamKey: "frc254",
            teamNumber: 254,
            nickname: "The Cheesy Poofs",
            record: { wins: 1, losses: 0, ties: 0 },
            metrics: {},
            eventCount: 1,
            matchCount: -1,
          },
        ],
        generation: "g1",
      })
    ).toThrow();
    expect(putObject).not.toHaveBeenCalled();
  });
});

describe("buildTeamsArtifact", () => {
  it("assembles a small fixture that parses against TeamsArtifactSchema, rounding metrics", () => {
    const artifact = buildTeamsArtifact({
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      teams: [
        {
          teamKey: "frc254",
          teamNumber: 254,
          nickname: "The Cheesy Poofs",
          record: { wins: 10, losses: 2, ties: 0 },
          metrics: { total: { value: 12.34567 } },
          eventCount: 3,
          matchCount: 36,
        },
      ],
      generation: "g1",
      computedAt: "2026-08-22T00:00:00.000Z",
    });
    expect(artifact.teams).toHaveLength(1);
    expect(artifact.teams[0]?.metrics.total?.value).toBe(12.35);
  });
});

describe("buildEventsArtifact", () => {
  it("assembles a small fixture that parses against EventsArtifactSchema", () => {
    const artifact = buildEventsArtifact({
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      events: [
        {
          eventKey: "2026casj",
          name: "2026casj",
          eventType: 0,
          isOffseason: false,
          startDate: "2026-03-01",
          week: null,
          teamCount: 40,
          matchCount: 80,
          playedMatchCount: 80,
          country: null,
          stateProv: null,
          districtKey: null,
        },
      ],
      generation: "g1",
    });
    expect(artifact.events).toHaveLength(1);
    expect(artifact.events[0]?.week).toBeNull();
  });

  it("round-trips name, week, country, stateProv and districtKey (EVNT-01, plan 05-02)", () => {
    const artifact = buildEventsArtifact({
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      events: [
        {
          eventKey: "2026fim",
          name: "FIM District Champs",
          eventType: 0,
          isOffseason: false,
          startDate: "2026-03-01",
          week: 3,
          teamCount: 40,
          matchCount: 80,
          playedMatchCount: 80,
          country: "USA",
          stateProv: "MI",
          districtKey: "fim",
        },
      ],
      generation: "g1",
    });
    const row = artifact.events[0]!;
    expect(row.name).toBe("FIM District Champs");
    expect(row.week).toBe(3);
    expect(row.country).toBe("USA");
    expect(row.stateProv).toBe("MI");
    expect(row.districtKey).toBe("fim");
  });

  it("a null week and a null district survive the build unchanged — not dropped by JSON.stringify or defaulted", () => {
    const artifact = buildEventsArtifact({
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      events: [
        {
          eventKey: "2026off",
          name: "Some Offseason Event",
          eventType: 99,
          isOffseason: true,
          startDate: "2026-09-01",
          week: null,
          teamCount: 10,
          matchCount: 20,
          playedMatchCount: 20,
          country: null,
          stateProv: null,
          districtKey: null,
        },
      ],
      generation: "g1",
    });
    const roundTripped = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
    const row = roundTripped.events[0]!;
    expect("week" in row).toBe(true);
    expect(row.week).toBeNull();
    expect("districtKey" in row).toBe(true);
    expect(row.districtKey).toBeNull();
  });
});

describe("buildTeamSeasonArtifact", () => {
  it("assembles a team-season fixture, rounding every match's numeric fields to their ROUNDING_RULE decimal count", () => {
    const artifact = buildTeamSeasonArtifact({
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      seasonStats: { record: { wins: 10, losses: 2, ties: 0 }, metrics: { total: { value: 12.34567 } } },
      events: [
        {
          eventKey: "2026casj",
          eventName: "2026casj",
          startDate: "2026-03-01",
          matches: [{ match: fixtureMatch(), prediction: fixturePrediction() }],
        },
      ],
      metricHistory: [],
      generation: "g1",
      computedAt: "2026-08-22T00:00:00.000Z",
    });

    const row = artifact.events[0]?.matches[0];
    expect(row).toBeDefined();
    // Every numeric value equals itself re-rounded at its own decimal count —
    // proof rounding was applied, not skipped (matches the plan's own
    // acceptance criterion wording).
    expect(row!.pRedWin).toBeCloseTo(Math.round(row!.pRedWin * 10 ** ROUNDING_RULE.probability) / 10 ** ROUNDING_RULE.probability, 10);
    expect(row!.predictedRedScore).toBeCloseTo(Math.round(row!.predictedRedScore * 10 ** ROUNDING_RULE.score) / 10 ** ROUNDING_RULE.score, 10);
    expect(row!.predictedBlueScore).toBeCloseTo(
      Math.round(row!.predictedBlueScore * 10 ** ROUNDING_RULE.score) / 10 ** ROUNDING_RULE.score,
      10
    );
    expect(row!.redComponents).toEqual({});
    expect(row!.blueComponents).toEqual({});
  });

  it("accepts a team with no matches — events: [] and metricHistory: [] parse as a valid, non-missing artifact (D-05/D-07)", () => {
    const artifact = buildTeamSeasonArtifact({
      teamKey: "frc9999",
      teamNumber: 9999,
      nickname: "Nobody",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {} },
      events: [],
      metricHistory: [],
      generation: "g1",
    });
    expect(artifact.events).toEqual([]);
    expect(artifact.metricHistory).toEqual([]);
  });
});

describe("buildCompareArtifact", () => {
  it("assembles a fixture that parses against CompareArtifactSchema without rounding scoring figures", () => {
    const slice: ScoreSlice = {
      algorithmId: "opr",
      season: 2025,
      seasonLabel: "holdout",
      headlineEligible: true,
      compLevelView: "combined",
      brierScore: 0.181234567,
      winnerAccuracy: 0.712345,
      scoredCount: 1000,
      tieCount: 0,
      noCallCount: 0,
      exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 },
      candidateCount: 1000,
      calibrationBins: [],
    };
    const artifact = buildCompareArtifact({
      algorithms: [{ id: "opr", version: "3.0.0+baseline" }],
      slices: [slice],
      generation: "g1",
    });
    expect(artifact.algorithms[0]).toEqual({ id: "opr", version: "3.0.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" });
    // Unrounded — mirrors artifact.ts's HarnessArtifactSchema policy.
    expect(artifact.slices[0]?.brierScore).toBe(0.181234567);
  });

  it("throws when an algorithm's version carries no '+' separator", () => {
    expect(() =>
      buildCompareArtifact({
        algorithms: [{ id: "opr", version: "3.0.0" }],
        slices: [],
        generation: "g1",
      })
    ).toThrow();
  });
});

describe("computeSizeStats", () => {
  it("groups by page kind and computes count/median/p95/max/largestKey", () => {
    const records: PublishedObjectRecord[] = [
      { pageKind: "team", key: "v1/team/frc1/2026/opr@3.0.0+baseline.json", bytes: 100 },
      { pageKind: "team", key: "v1/team/frc2/2026/opr@3.0.0+baseline.json", bytes: 300 },
      { pageKind: "team", key: "v1/team/frc3/2026/opr@3.0.0+baseline.json", bytes: 200 },
      { pageKind: "teams", key: "v1/teams/2026/opr@3.0.0+baseline.json", bytes: 5000 },
    ];
    const stats = computeSizeStats(records);
    expect(stats.team?.count).toBe(3);
    expect(stats.team?.maxBytes).toBe(300);
    expect(stats.team?.largestKey).toBe("v1/team/frc2/2026/opr@3.0.0+baseline.json");
    expect(stats.teams?.count).toBe(1);
    expect(stats.teams?.maxBytes).toBe(5000);
  });
});

describe("selectScheduledMatches never carries an outcome key (D-08) — publish.ts's own re-check", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-corpus-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function corpusEvent(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
    return {
      eventKey: "2026casj",
      year: 2026,
      eventType: 0,
      isOffseason: false,
      startDate: "2026-03-01",
      name: "2026casj",
      week: null,
      country: null,
      stateProv: null,
      districtKey: null,
      ...overrides,
    };
  }
  function corpusMatch(overrides: Partial<CorpusMatch> = {}): CorpusMatch {
    return {
      matchKey: "2026casj_qm2",
      eventKey: "2026casj",
      compLevel: "qm",
      matchNumber: 2,
      setNumber: 1,
      sortTime: 2_000,
      redTeams: ["frc254", "frc118", "frc1114"],
      blueTeams: ["frc971", "frc2910", "frc330"],
      redSurrogates: [],
      blueSurrogates: [],
      redDqs: [],
      blueDqs: [],
      winner: null,
      winnerImputed: false,
      redScore: null,
      blueScore: null,
      redRpEarned: null,
      blueRpEarned: null,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
      ...overrides,
    };
  }

  it("a real not-yet-played match read via publish.ts's import path carries no key from OUTCOME_KEYS", () => {
    upsertEvent(db, corpusEvent());
    upsertMatch(db, corpusMatch());

    const scheduled = selectScheduledMatches(db, { eventKey: "2026casj" });
    expect(scheduled).toHaveLength(1);
    for (const row of scheduled) {
      for (const key of OUTCOME_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(row, key)).toBe(false);
      }
    }
  });
});
