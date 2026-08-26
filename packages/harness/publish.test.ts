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
import { opr } from "../core/algorithms/opr.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import { openCorpus, selectScheduledMatches, upsertEvent, upsertMatch, upsertTeam, upsertTeamMedia, type Corpus } from "../corpus/db.js";
import type { PredictionRecord } from "./replay.js";
import type { TeamSeasonArtifact } from "./pageArtifacts.js";
import {
  actualBonusFlagsForSeason,
  buildCompareArtifact,
  buildEventArtifact,
  buildEventsArtifact,
  buildTeamsArtifact,
  buildTeamSeasonArtifact,
  computeSizeStats,
  OUTCOME_KEYS,
  publishSeasons,
  type ActualBonusFlags,
  type PublishedObjectRecord,
} from "./publish.js";
import { ROUNDING_RULE } from "./rounding.js";
import type { ScoreSlice } from "./score.js";
import { RP_RULE_MODULES } from "../core/algorithms/sigma1/rp/rules.js";

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

describe("buildTeamSeasonArtifact — Phase 6 D-01/D-02/D-08/D-09 per-match fields (plan 06-04 Task 1)", () => {
  const baseParams = {
    teamKey: "frc254",
    teamNumber: 254,
    nickname: "The Cheesy Poofs",
    season: 2026,
    algorithmId: "opr",
    algorithmVersion: "3.0.0+baseline",
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 45.6 } } },
    metricHistory: [],
    generation: "test-generation-1",
    computedAt: "2026-08-22T00:00:00.000Z",
  } as const;

  it("D-01: rounds a Sigma1-shaped prediction's own-variance fields to 4 decimals; an OPR-shaped prediction leaves both undefined", () => {
    const sigma1Artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [
        {
          eventKey: "2026casj",
          eventName: "2026casj",
          startDate: "2026-03-01",
          matches: [
            { match: fixtureMatch(), prediction: fixturePrediction({ redScoreVarianceOwn: 12.345678, blueScoreVarianceOwn: 9.876543 }) },
          ],
        },
      ],
    });
    const sigma1Row = sigma1Artifact.events[0]?.matches[0];
    expect(sigma1Row?.redScoreVarianceOwn).toBe(12.3457);
    expect(sigma1Row?.blueScoreVarianceOwn).toBe(9.8765);

    const oprArtifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [
        {
          eventKey: "2026casj",
          eventName: "2026casj",
          startDate: "2026-03-01",
          matches: [{ match: fixtureMatch(), prediction: fixturePrediction() }],
        },
      ],
    });
    const oprRow = oprArtifact.events[0]?.matches[0];
    expect(oprRow?.redScoreVarianceOwn).toBeUndefined();
    expect(oprRow?.blueScoreVarianceOwn).toBeUndefined();
  });

  it("D-02: actualRedRp/actualBlueRp round-trip an integer RP from MatchResult.redRpEarned/blueRpEarned", () => {
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [
        {
          eventKey: "2026casj",
          eventName: "2026casj",
          startDate: "2026-03-01",
          matches: [{ match: fixtureMatch({ redRpEarned: 2, blueRpEarned: 0 }), prediction: fixturePrediction() }],
        },
      ],
    });
    const row = artifact.events[0]?.matches[0];
    expect(row?.actualRedRp).toBe(2);
    expect(row?.actualBlueRp).toBe(0);
  });

  it("D-02: a null redRpEarned publishes as null — never coerced to 0, never omitted", () => {
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [
        {
          eventKey: "2026casj",
          eventName: "2026casj",
          startDate: "2026-03-01",
          matches: [{ match: fixtureMatch({ redRpEarned: null }), prediction: fixturePrediction() }],
        },
      ],
    });
    const row = artifact.events[0]?.matches[0];
    expect(row).toBeDefined();
    expect("actualRedRp" in (row as object)).toBe(true);
    expect(row?.actualRedRp).toBeNull();
  });

  it("D-08/D-09: a scheduled match publishes predicted fields with every actual field undefined, and the row parses", () => {
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [
        {
          eventKey: "2026casj",
          eventName: "2026casj",
          startDate: "2026-03-01",
          matches: [{ match: fixtureUpcoming(), prediction: fixturePrediction() }],
        },
      ],
    });
    const row = artifact.events[0]?.matches[0];
    expect(row?.predictedRedScore).toBeDefined();
    expect(row?.predictedBlueScore).toBeDefined();
    expect(row?.actualWinner).toBeUndefined();
    expect(row?.actualRedScore).toBeUndefined();
    expect(row?.actualBlueScore).toBeUndefined();
    expect(row?.actualRedRp).toBeUndefined();
    expect(row?.actualBlueRp).toBeUndefined();
  });

  it("plan 06-04 Task 3: every field this phase added at once — own variance, actual RP, percentile, robot image, active years, a played and a scheduled match in the same event — parses as one artifact", () => {
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      seasonStats: {
        record: { wins: 1, losses: 0, ties: 0 },
        metrics: { total: { value: 45.6, spread: 3.1, percentile: 82.4 } },
      },
      robotImageUrl: "https://i.imgur.com/example.jpg",
      activeYears: [2024, 2025, 2026],
      events: [
        {
          eventKey: "2026casj",
          eventName: "Sacramento Regional",
          startDate: "2026-03-01",
          matches: [
            {
              match: fixtureMatch({ redRpEarned: 2, blueRpEarned: 0 }),
              prediction: fixturePrediction({ redScoreVarianceOwn: 15.4321, blueScoreVarianceOwn: 11.2233 }),
            },
            { match: fixtureUpcoming(), prediction: fixturePrediction({ redScoreVarianceOwn: 14.1, blueScoreVarianceOwn: 10.2 }) },
          ],
        },
      ],
    });

    expect(artifact.robotImageUrl).toBe("https://i.imgur.com/example.jpg");
    expect(artifact.activeYears).toEqual([2024, 2025, 2026]);
    expect(artifact.seasonStats.metrics.total?.percentile).toBe(82.4);
    expect(artifact.events).toHaveLength(1);
    expect(artifact.events[0]?.matches).toHaveLength(2);
    const playedRow = artifact.events[0]?.matches.find((m) => m.actualWinner !== undefined);
    const scheduledRow = artifact.events[0]?.matches.find((m) => m.actualWinner === undefined);
    expect(playedRow?.redScoreVarianceOwn).toBe(15.4321);
    expect(playedRow?.actualRedRp).toBe(2);
    expect(scheduledRow?.redScoreVarianceOwn).toBe(14.1);
    expect(scheduledRow?.actualRedScore).toBeUndefined();
  });
});

describe("buildTeamSeasonArtifact — TEAM-04/F-06-3 event rank (plan 06.1-01 Task 3)", () => {
  const baseParams = {
    teamKey: "frc254",
    teamNumber: 254,
    nickname: "The Cheesy Poofs",
    season: 2024,
    algorithmId: "opr",
    algorithmVersion: "3.0.0+baseline",
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 45.6 } } },
    metricHistory: [],
    generation: "test-generation-1",
    computedAt: "2026-08-26T00:00:00.000Z",
  } as const;

  it("copies rank/totalTeams from TeamSeasonEventInput onto the parsed artifact's matching event when present", () => {
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [{ eventKey: "2024casj", eventName: "Sacramento Regional", startDate: "2024-03-01", matches: [], rank: 5, totalTeams: 32 }],
    });
    const publishedEvent = artifact.events[0];
    expect(publishedEvent?.rank).toBe(5);
    expect(publishedEvent?.totalTeams).toBe(32);
  });

  it("omits rank and totalTeams entirely (not merely undefined) from the parsed artifact's event when the input omits them", () => {
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [{ eventKey: "2024casj", eventName: "Sacramento Regional", startDate: "2024-03-01", matches: [] }],
    });
    const publishedEvent = artifact.events[0] as object;
    expect(publishedEvent).not.toHaveProperty("rank");
    expect(publishedEvent).not.toHaveProperty("totalTeams");
  });
});

/** A real-shaped 2022 (Rapid React) score_breakdown, satisfying rp2022's Rp2022Schema for both alliances. */
function rawBreakdown2022(): unknown {
  const side = { matchCargoTotal: 25, autoCargoTotal: 2, endgamePoints: 20, cargoBonusRankingPoint: true, hangarBonusRankingPoint: true, quintetAchieved: false };
  return { red: side, blue: { ...side, matchCargoTotal: 5, endgamePoints: 0, cargoBonusRankingPoint: false, hangarBonusRankingPoint: false } };
}

/** A real-shaped 2024 (Crescendo) score_breakdown, satisfying rp2024's Rp2024Schema for both alliances. */
function rawBreakdown2024(): unknown {
  const side = {
    autoAmpNoteCount: 2,
    autoSpeakerNoteCount: 2,
    teleopAmpNoteCount: 4,
    teleopSpeakerNoteCount: 10,
    teleopSpeakerNoteAmplifiedCount: 2,
    endGameTotalStagePoints: 12,
    endGameRobot1: "StageLeft",
    endGameRobot2: "StageRight",
    endGameRobot3: "None",
    coopertitionBonusAchieved: false,
    melodyBonusAchieved: true,
    ensembleBonusAchieved: true,
    melodyBonusThresholdCoop: 15,
    melodyBonusThresholdNonCoop: 18,
    ensembleBonusStagePointsThreshold: 10,
    ensembleBonusOnStageRobotsThreshold: 2,
  };
  return { red: side, blue: { ...side, autoAmpNoteCount: 0, teleopAmpNoteCount: 0, teleopSpeakerNoteCount: 0, endGameTotalStagePoints: 0, endGameRobot1: "None", endGameRobot2: "None", melodyBonusAchieved: false, ensembleBonusAchieved: false } };
}

describe("actualBonusFlagsForSeason (Phase 06.1, plan 06.1-05 Task 2, F-06-3/PD-09)", () => {
  it("2022: a played qm match at an RP-eligible event type with a parseable breakdown produces arrays matching rp2022's own parse result, bonus by bonus", () => {
    const match = fixtureMatch({ matchKey: "2022casj_qm1", eventType: 0, scoreBreakdownRaw: JSON.stringify(rawBreakdown2022()) });
    const result = actualBonusFlagsForSeason([match], 2022);
    const flags = result.get(match.matchKey);
    expect(flags).not.toBeNull();
    const ruleModule = RP_RULE_MODULES[2022]!;
    const rawJson = JSON.parse(match.scoreBreakdownRaw!);
    const expectedRed = ruleModule.parse(rawJson, "red", match.eventType);
    const expectedBlue = ruleModule.parse(rawJson, "blue", match.eventType);
    expect((flags as ActualBonusFlags).red).toEqual(ruleModule.bonusNames.map((name) => expectedRed.bonusFlags[name]));
    expect((flags as ActualBonusFlags).blue).toEqual(ruleModule.bonusNames.map((name) => expectedBlue.bonusFlags[name]));
  });

  it("2024: a played qm match at an RP-eligible event type with a parseable breakdown produces arrays matching rp2024's own parse result, bonus by bonus", () => {
    const match = fixtureMatch({ matchKey: "2024casj_qm1", eventType: 0, scoreBreakdownRaw: JSON.stringify(rawBreakdown2024()) });
    const result = actualBonusFlagsForSeason([match], 2024);
    const flags = result.get(match.matchKey);
    expect(flags).not.toBeNull();
    const ruleModule = RP_RULE_MODULES[2024]!;
    const rawJson = JSON.parse(match.scoreBreakdownRaw!);
    const expectedRed = ruleModule.parse(rawJson, "red", match.eventType);
    const expectedBlue = ruleModule.parse(rawJson, "blue", match.eventType);
    expect((flags as ActualBonusFlags).red).toEqual(ruleModule.bonusNames.map((name) => expectedRed.bonusFlags[name]));
    expect((flags as ActualBonusFlags).blue).toEqual(ruleModule.bonusNames.map((name) => expectedBlue.bonusFlags[name]));
  });

  it("publishes null (strictly, not undefined) for an RP-ineligible event type", () => {
    // eventType 99 (offseason) is not in EVENT_TYPE_TIERS — isRpEligibleEventType returns false.
    const match = fixtureMatch({ matchKey: "2024off_qm1", eventType: 99, scoreBreakdownRaw: JSON.stringify(rawBreakdown2024()) });
    const result = actualBonusFlagsForSeason([match], 2024);
    expect(result.get(match.matchKey)).toBeNull();
  });

  it("publishes null (strictly, not undefined) for a match with no score breakdown", () => {
    const match = fixtureMatch({ matchKey: "2024casj_qm2", eventType: 0, hasScoreBreakdown: false, scoreBreakdownRaw: null });
    const result = actualBonusFlagsForSeason([match], 2024);
    expect(result.get(match.matchKey)).toBeNull();
  });

  it("publishes null (strictly, not undefined) for a match whose score breakdown throws on parse, rather than propagating the throw", () => {
    const match = fixtureMatch({ matchKey: "2024casj_qm3", eventType: 0, scoreBreakdownRaw: JSON.stringify({ red: {}, blue: {} }) });
    expect(() => actualBonusFlagsForSeason([match], 2024)).not.toThrow();
    const result = actualBonusFlagsForSeason([match], 2024);
    expect(result.get(match.matchKey)).toBeNull();
  });

  it("returns an empty map for a season with no registered RP rule module", () => {
    const match = fixtureMatch({ matchKey: "2021casj_qm1", eventType: 0 });
    const result = actualBonusFlagsForSeason([match], 2021);
    expect(result.size).toBe(0);
  });
});

describe("buildTeamSeasonArtifact — predicted/actual per-bonus RP fields (Phase 06.1, plan 06.1-05 Task 2, F-06-1/F-06-3)", () => {
  const baseParams = {
    teamKey: "frc254",
    teamNumber: 254,
    nickname: "The Cheesy Poofs",
    season: 2024,
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+test",
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 45.6 } } },
    metricHistory: [],
    generation: "test-generation-1",
    computedAt: "2026-08-26T00:00:00.000Z",
  } as const;

  it("a prediction carrying predicted bonus marginals publishes them rounded to exactly four decimals", () => {
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [
        {
          eventKey: "2024casj",
          eventName: "2024casj",
          startDate: "2024-03-01",
          matches: [{ match: fixtureMatch(), prediction: fixturePrediction({ redBonusRp: [0.123456789, 0.987654321] }) }],
        },
      ],
    });
    const row = artifact.events[0]?.matches[0];
    expect(row?.redBonusRp).toEqual([0.1235, 0.9877]);
  });

  it("a prediction without predicted bonus marginals publishes no predicted bonus key", () => {
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [
        {
          eventKey: "2024casj",
          eventName: "2024casj",
          startDate: "2024-03-01",
          matches: [{ match: fixtureMatch(), prediction: fixturePrediction() }],
        },
      ],
    });
    const row = artifact.events[0]?.matches[0];
    // Direct-assignment field (matches `redRpPmf`/`redScoreVarianceOwn`'s own
    // existing convention above) — undefined, not genuinely absent; this
    // still parses `TeamSeasonMatchSchema`'s `.optional()` field correctly.
    expect(row?.redBonusRp).toBeUndefined();
    expect(row?.blueBonusRp).toBeUndefined();
  });

  it("a missing map entry leaves both actual bonus keys absent (never a synthetic default)", () => {
    const match = fixtureMatch();
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [{ eventKey: "2024casj", eventName: "2024casj", startDate: "2024-03-01", matches: [{ match, prediction: fixturePrediction() }] }],
      actualBonusFlagsByMatchKey: new Map(),
    });
    const row = artifact.events[0]?.matches[0] as object;
    expect(row).not.toHaveProperty("actualRedBonusRp");
    expect(row).not.toHaveProperty("actualBlueBonusRp");
  });

  it("a null map entry publishes an explicit null for both actual bonus fields", () => {
    const match = fixtureMatch();
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [{ eventKey: "2024casj", eventName: "2024casj", startDate: "2024-03-01", matches: [{ match, prediction: fixturePrediction() }] }],
      actualBonusFlagsByMatchKey: new Map([[match.matchKey, null]]),
    });
    const row = artifact.events[0]?.matches[0];
    expect(row?.actualRedBonusRp).toBeNull();
    expect(row?.actualBlueBonusRp).toBeNull();
  });

  it("a real map entry publishes the copied boolean arrays for both alliances", () => {
    const match = fixtureMatch();
    const flags: ActualBonusFlags = { red: [true, false], blue: [false, true] };
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [{ eventKey: "2024casj", eventName: "2024casj", startDate: "2024-03-01", matches: [{ match, prediction: fixturePrediction() }] }],
      actualBonusFlagsByMatchKey: new Map([[match.matchKey, flags]]),
    });
    const row = artifact.events[0]?.matches[0];
    expect(row?.actualRedBonusRp).toEqual([true, false]);
    expect(row?.actualBlueBonusRp).toEqual([false, true]);
  });

  it("an unplayed (scheduled) match's row has neither actual bonus key, even with a populated flag map", () => {
    const upcoming = fixtureUpcoming();
    const flags: ActualBonusFlags = { red: [true, false], blue: [false, true] };
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [
        { eventKey: "2024casj", eventName: "2024casj", startDate: "2024-03-01", matches: [{ match: upcoming, prediction: fixturePrediction() }] },
      ],
      actualBonusFlagsByMatchKey: new Map([[upcoming.matchKey, flags]]),
    });
    const row = artifact.events[0]?.matches[0] as object;
    expect(row).not.toHaveProperty("actualRedBonusRp");
    expect(row).not.toHaveProperty("actualBlueBonusRp");
  });

  it("algorithm independence: the same match built into two artifacts under different algorithm ids carries identical actual bonus arrays", () => {
    const match = fixtureMatch();
    const flags: ActualBonusFlags = { red: [true, false], blue: [false, true] };
    const flagMap = new Map([[match.matchKey, flags]]);
    const oprArtifact = buildTeamSeasonArtifact({
      ...baseParams,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      events: [{ eventKey: "2024casj", eventName: "2024casj", startDate: "2024-03-01", matches: [{ match, prediction: fixturePrediction() }] }],
      actualBonusFlagsByMatchKey: flagMap,
    });
    const sigma1Artifact = buildTeamSeasonArtifact({
      ...baseParams,
      algorithmId: "sigma1",
      algorithmVersion: "2.0.0+test",
      events: [{ eventKey: "2024casj", eventName: "2024casj", startDate: "2024-03-01", matches: [{ match, prediction: fixturePrediction() }] }],
      actualBonusFlagsByMatchKey: flagMap,
    });
    const oprRow = oprArtifact.events[0]?.matches[0];
    const sigma1Row = sigma1Artifact.events[0]?.matches[0];
    expect(oprRow?.actualRedBonusRp).toEqual(sigma1Row?.actualRedBonusRp);
    expect(oprRow?.actualBlueBonusRp).toEqual(sigma1Row?.actualBlueBonusRp);
  });
});

describe("publishSeasons — Phase 6 team-artifact wiring against a real corpus (plan 06-04 Task 1)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-team-corpus-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seasonEvent(overrides: Partial<CorpusEvent> = {}): CorpusEvent {
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

  function seasonMatch(overrides: Partial<CorpusMatch> = {}): CorpusMatch {
    return {
      matchKey: "2026casj_qm1",
      eventKey: "2026casj",
      compLevel: "qm",
      matchNumber: 1,
      setNumber: 1,
      sortTime: 1_000,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      redSurrogates: [],
      blueSurrogates: [],
      redDqs: [],
      blueDqs: [],
      winner: "red",
      winnerImputed: false,
      redScore: 100,
      blueScore: 80,
      redRpEarned: 2,
      blueRpEarned: 0,
      hasScoreBreakdown: false,
      scoreBreakdownRaw: null,
      ...overrides,
    };
  }

  function findTeamArtifact(teamKey: string, year = 2026): TeamSeasonArtifact {
    const call = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith(`v1/team/${teamKey}/${year}/`));
    expect(call, `expected a v1/team/${teamKey}/${year}/... putObject call`).toBeDefined();
    return JSON.parse(call![2] as string) as TeamSeasonArtifact;
  }

  it("fixes the eventName defect (real name published, null-column corpus degrades to the event key) and keeps an event with only a scheduled match as its own section, not dropped", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026casj", name: "Sacramento Regional" }));
    upsertMatch(db, seasonMatch());

    upsertEvent(db, seasonEvent({ eventKey: "2026null", name: "will be nulled" }));
    // Simulate an un-refreshed corpus (pre-EVNT-01) whose name column is null.
    db.prepare(`UPDATE events SET name = NULL WHERE event_key = ?`).run("2026null");
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026null_qm1",
        eventKey: "2026null",
        sortTime: 5_000,
        winner: null,
        redScore: null,
        blueScore: null,
        redRpEarned: null,
        blueRpEarned: null,
        hasScoreBreakdown: false,
        scoreBreakdownRaw: null,
      })
    );

    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact = findTeamArtifact("frc1");
    const casj = artifact.events.find((e) => e.eventKey === "2026casj");
    const nulled = artifact.events.find((e) => e.eventKey === "2026null");

    expect(casj?.eventName).toBe("Sacramento Regional");
    expect(nulled, "an event with only a scheduled match must still produce its own section").toBeDefined();
    expect(nulled?.eventName).toBe("2026null");
    expect(nulled?.matches).toHaveLength(1);
    expect(nulled?.matches[0]?.predictedRedScore).toBeDefined();
    expect(nulled?.matches[0]?.actualWinner).toBeUndefined();
  });

  it("orders a team's matches within an event by sortTime, then compLevel/setNumber/matchNumber/matchKey tie-breaks, independent of insertion order", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026ord", name: "Ordering Event" }));
    // Inserted highest matchNumber first, to prove the sort is applied and not incidental to insertion order.
    upsertMatch(db, seasonMatch({ matchKey: "2026ord_qm2", eventKey: "2026ord", matchNumber: 2, sortTime: 5_000 }));
    upsertMatch(db, seasonMatch({ matchKey: "2026ord_qm1", eventKey: "2026ord", matchNumber: 1, sortTime: 5_000 }));

    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact = findTeamArtifact("frc1");
    const ordEvent = artifact.events.find((e) => e.eventKey === "2026ord");
    expect(ordEvent?.matches.map((m) => m.matchNumber)).toEqual([1, 2]);
  });

  it("D-04/D-03/D-05: percentile, robotImageUrl and activeYears all reach the team artifact from their respective single insertion points", async () => {
    // 2025: frc1 plays a match, no team_media row (no photo resolved for this team-year).
    upsertEvent(db, seasonEvent({ eventKey: "2025casj", year: 2025, name: "2025 Event" }));
    upsertMatch(db, seasonMatch({ matchKey: "2025casj_qm1", eventKey: "2025casj", sortTime: 1_000 }));

    // 2026: frc1 plays a match, and HAS a team_media row with a resolved photo.
    upsertEvent(db, seasonEvent({ eventKey: "2026casj", year: 2026, name: "2026 Event" }));
    upsertMatch(db, seasonMatch({ matchKey: "2026casj_qm1", eventKey: "2026casj", sortTime: 2_000 }));
    upsertTeam(db, { teamKey: "frc1", teamNumber: 1, nickname: "" });
    upsertTeamMedia(db, {
      teamKey: "frc1",
      year: 2026,
      imageUrl: "https://i.imgur.com/example.jpg",
      mediaType: "imgur",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });

    await publishSeasons(db, { seasons: [2025, 2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact2026 = findTeamArtifact("frc1", 2026);
    const artifact2025 = findTeamArtifact("frc1", 2025);

    // D-04: percentile present, bounded [0, 100], at most one decimal place.
    const pct = artifact2026.seasonStats.metrics.total?.percentile;
    expect(pct).toBeDefined();
    expect(pct!).toBeGreaterThanOrEqual(0);
    expect(pct!).toBeLessThanOrEqual(100);
    expect(Number.isInteger(pct! * 10)).toBe(true);

    // D-03: robotImageUrl present when the corpus has a URL, absent when the corpus row's value is null (here: no row at all for 2025).
    expect(artifact2026.robotImageUrl).toBe("https://i.imgur.com/example.jpg");
    expect(artifact2025.robotImageUrl).toBeUndefined();

    // D-05: activeYears is a sorted ascending integer array containing exactly the seasons frc1 appears in, published on BOTH year's artifacts.
    expect(artifact2026.activeYears).toEqual([2025, 2026]);
    expect(artifact2025.activeYears).toEqual([2025, 2026]);
  });

  it("logs a warning naming the seasons in scope when the run's season set is narrower than the full published range (D-05 under-reporting guard)", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026casj" }));
    upsertMatch(db, seasonMatch());

    const originalLog = console.log;
    const captured: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      captured.push(args);
    };
    try {
      await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });
    } finally {
      console.log = originalLog;
    }

    const warned = captured.some(
      ([msg]) => typeof msg === "string" && msg.includes("2026") && msg.toLowerCase().includes("activeyears")
    );
    expect(warned).toBe(true);
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
