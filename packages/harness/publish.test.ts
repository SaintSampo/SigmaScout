/**
 * Assembly-level coverage for plan 04-04's widened `publish.ts` (T-04-22:
 * every assembly function parses through its Zod schema before returning,
 * so a validation failure occurs before any upload could possibly be
 * attempted). All fixtures are small, in-memory, hand-built objects — no
 * network, no corpus. The real full 2022-2026 run is recorded in the
 * SUMMARY, not re-run on every `pnpm test`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlgorithmModule, MatchResult, Prediction, TeamMetric, TeamMetrics, UpcomingMatch } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { opr } from "../core/algorithms/opr.js";
import { epa } from "../core/algorithms/epa.js";
import { spr } from "../core/algorithms/spr.js";
import { OFFSEASON_EVENT_TYPE } from "../core/algorithms/eventTypes.js";
// Renamed by plan 07-16's full-repo sweep (wave 11, D-04/D-05): this file's
// own `publish.ts` importer now imports the published `vpr` registry entry
// under its post-rename name.
import { vpr } from "../core/algorithms/sigma1/index.js";
import { PUBLISHED_ALGORITHM_IDS, PIPELINE_ALGORITHM_IDS } from "./publishedAlgorithms.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import {
  openCorpus,
  openCorpusReadOnly,
  selectScheduledMatches,
  upsertEvent,
  upsertEventAlliance,
  upsertEventRanking,
  upsertEventTeam,
  upsertMatch,
  upsertTeam,
  upsertTeamMedia,
  type Corpus,
} from "../corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator, type PredictionRecord } from "./replay.js";
import type { CompareArtifact, EventArtifact, TeamSeasonArtifact } from "./pageArtifacts.js";
import type { MetricHistoryRow } from "./metricHistorySchema.js";
import {
  actualBonusFlagsForSeason,
  attachRpCalibration,
  buildCompareArtifact,
  buildEventArtifact,
  buildEventsArtifact,
  buildSingleEventPublish,
  buildTeamsArtifact,
  buildTeamSeasonArtifact,
  computeSizeStats,
  lastOfficialMetricsByTeam,
  loadRpCalibrationMeasurement,
  OUTCOME_KEYS,
  parseSeasonsRange,
  publishSeasons,
  resolvePublishAlgorithms,
  RP_CALIBRATION_MEASUREMENT_PATH,
  seasonStatsMetricsForTeam,
  withEventPercentiles,
  withHistoryPercentiles,
  withPublishedTiers,
  type ActualBonusFlags,
  type BuildEventArtifactParams,
  type EventTeamRankingInput,
  type PublishedObjectRecord,
  type RpCalibrationMeasurement,
} from "./publish.js";
import {
  artifactKey,
  decodeTeamsRowMetrics,
  preScheduleKey,
  PublishedPreScheduleArtifactSchema,
  TeamsArtifactSchema,
} from "./pageArtifacts.js";
import { SWING_METRIC_KEY } from "./swingFactor.js";
import { compareTeamsByTotal, isRealPublishedTeamKey } from "./teamRanks.js";
import { roundPmf, roundTo, ROUNDING_RULE } from "./rounding.js";
import type { ScoreSlice } from "./score.js";
import { RP_RULE_MODULES } from "../core/rankingPoints/rules.js";
import { seasonBoundaryFor } from "./seasonBoundary.js";
import { HISTORY_PERCENTILE_METRIC_KEYS, percentileAgainstSortedPool, sortedPoolsByMetric } from "./percentiles.js";

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
    week: null,
    winner: "red",
    redScore: 120,
    blueScore: 95,
    redRpEarned: 2,
    blueRpEarned: 0,
    redDqs: [],
    blueDqs: [],
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
    week: null,
    ...overrides,
  };
}

/**
 * Plan 07-08 Task 1: a complete `BuildEventArtifactParams` — one played
 * `PredictionRecord`, one `UpcomingPredictionRecord`, one team, a fixed
 * `generation`/`computedAt` — so Tasks 1-3 extend ONE helper instead of each
 * hand-building params. `prediction`/`upcomingPrediction` override the
 * FIRST played/upcoming record's `Prediction` only (this fixture always
 * carries exactly one of each); every other top-level field is overridable
 * directly through the rest of `overrides`.
 */
function eventArtifactParams(
  overrides: Partial<BuildEventArtifactParams> & {
    prediction?: Partial<Prediction>;
    upcomingPrediction?: Partial<Prediction>;
  } = {}
): BuildEventArtifactParams {
  const { prediction, upcomingPrediction, ...rest } = overrides;
  return {
    eventKey: "2026casj",
    season: 2026,
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+test",
    predictions: [{ match: fixtureMatch(), prediction: fixturePrediction(prediction) }],
    upcoming: [{ match: fixtureUpcoming(), prediction: fixturePrediction(upcomingPrediction) }],
    teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", metrics: { total: { value: 45.6, spread: 3.1 } } }],
    generation: "test-generation-1",
    computedAt: "2026-08-27T00:00:00.000Z",
    ...rest,
  };
}

/** Plan 07-08 Task 1: mirrors `findTeamArtifact`'s shape exactly, for the seeded-corpus `publishSeasons` harness's `v1/event/{eventKey}/{algorithmId}@...` `putObject` calls. */
function findEventArtifact(eventKey: string, algorithmId: string): EventArtifact {
  const call = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith(`v1/event/${eventKey}/${algorithmId}@`));
  expect(call, `expected a v1/event/${eventKey}/${algorithmId}@... putObject call`).toBeDefined();
  return JSON.parse(call![2] as string) as EventArtifact;
}

/** Hoisted to module scope (plan 07-08) so Tasks 1-3's own seeded-corpus describe blocks can reuse it alongside the pre-existing `publishSeasons — Phase 6` block. */
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

/** Hoisted to module scope (plan 07-08) — see `seasonEvent`'s comment. */
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
    videoKey: null,
    ...overrides,
  };
}

/** Hoisted to module scope (plan 07-08) — see `seasonEvent`'s comment. */
function findTeamArtifact(teamKey: string, year = 2026): TeamSeasonArtifact {
  const call = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith(`v1/team/${teamKey}/${year}/`));
  expect(call, `expected a v1/team/${teamKey}/${year}/... putObject call`).toBeDefined();
  return JSON.parse(call![2] as string) as TeamSeasonArtifact;
}

/** Plan 07-08 Task 3: a complete `EventTeamRankingInput`, overridable field-by-field. */
function seasonRankingRow(overrides: Partial<EventTeamRankingInput> = {}): EventTeamRankingInput {
  return {
    rank: 7,
    recordWins: 9,
    recordLosses: 1,
    recordTies: 0,
    rankingScore: 3.835,
    ...overrides,
  };
}

/**
 * Plan 07-09 (D-10, Wave 0 case): seeds two 2026 events over the SAME six
 * teams — an early event ("2026ear") and a later one ("2026lat"), each with
 * two `qm` matches at distinct `sortTime` ranges (1,000/2,000 vs
 * 10,000/11,000). Scores deliberately differ between the two events so a
 * team's event-scoped OPR rating (D-01: one independent least-squares fit
 * per event) at the early event's end differs from its rating at the
 * season's end — OPR's `teamMetrics` headlines each team's MOST RECENT
 * event (`lastEventByTeam`), so after both events replay, every one of
 * these six teams' season-final value is its LATE-event rating, while the
 * as-of-early-event snapshot this plan captures is its EARLY-event rating
 * alone. Returns the event keys and the team keys seeded so each case names
 * what it is asserting about rather than re-deriving it.
 */
function seedTwoEventSeason(db: Corpus): { earlyEventKey: string; lateEventKey: string; teamKeys: string[] } {
  const earlyEventKey = "2026ear";
  const lateEventKey = "2026lat";
  const teamKeys = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];

  upsertEvent(db, seasonEvent({ eventKey: earlyEventKey, name: "Early Event" }));
  upsertMatch(
    db,
    seasonMatch({
      matchKey: `${earlyEventKey}_qm1`,
      eventKey: earlyEventKey,
      matchNumber: 1,
      sortTime: 1_000,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      redScore: 150,
      blueScore: 90,
      winner: "red",
    })
  );
  upsertMatch(
    db,
    seasonMatch({
      matchKey: `${earlyEventKey}_qm2`,
      eventKey: earlyEventKey,
      matchNumber: 2,
      sortTime: 2_000,
      redTeams: ["frc1", "frc4", "frc5"],
      blueTeams: ["frc2", "frc3", "frc6"],
      redScore: 100,
      blueScore: 140,
      winner: "blue",
    })
  );

  upsertEvent(db, seasonEvent({ eventKey: lateEventKey, name: "Late Event" }));
  upsertMatch(
    db,
    seasonMatch({
      matchKey: `${lateEventKey}_qm1`,
      eventKey: lateEventKey,
      matchNumber: 1,
      sortTime: 10_000,
      redTeams: ["frc1", "frc2", "frc3"],
      blueTeams: ["frc4", "frc5", "frc6"],
      redScore: 60,
      blueScore: 200,
      winner: "blue",
    })
  );
  upsertMatch(
    db,
    seasonMatch({
      matchKey: `${lateEventKey}_qm2`,
      eventKey: lateEventKey,
      matchNumber: 2,
      sortTime: 11_000,
      redTeams: ["frc1", "frc5", "frc6"],
      blueTeams: ["frc2", "frc3", "frc4"],
      redScore: 180,
      blueScore: 80,
      winner: "red",
    })
  );

  return { earlyEventKey, lateEventKey, teamKeys };
}

describe("resolvePublishAlgorithms — D-03/D-04/D-05 rename (plan 07-16 Task 2, repointed at the collapsed single tier by plan 07-18 Task 1)", () => {
  // Test 7: the default publish set (an operator who omits `--algorithm`,
  // the path an operator actually takes) resolves to the OPR id, the EPA
  // id, and `vpr` — read from `PUBLISHED_ALGORITHM_IDS`, the single
  // algorithm-id constant again as of plan 07-18's collapse.
  // 260912-ivg Stage 1: resolvePublishAlgorithms's default reads
  // PIPELINE_ALGORITHM_IDS (the WRITE tier, premier id `spr`), deliberately
  // NOT PUBLISHED_ALGORITHM_IDS (the READ tier, still `bpr`) — this is the
  // split's whole safety property, so both constants are asserted here in
  // the SAME test to make a half-collapse fail loudly rather than silently.
  it("the default (undefined) publish set resolves to the WRITE tier (opr, epa, spr), while the READ tier stays on the retiring premier id", () => {
    const algorithms = resolvePublishAlgorithms(undefined);
    expect(algorithms.map((a) => a.id)).toEqual([...PIPELINE_ALGORITHM_IDS]);
    expect(PIPELINE_ALGORITHM_IDS).toEqual(["opr", "epa", "spr"]);
    expect(PUBLISHED_ALGORITHM_IDS).toEqual(["opr", "epa", "bpr"]);
  });

  // Test 8: every emitted artifact key for the published algorithm carries
  // the renamed segment, and none carries the retired one — across all four
  // algorithm-scoped page kinds (`compare` carries no algorithm segment by
  // design, so it is excluded here).
  // 2026-09-09: the third published module is BPR, not VPR — VPR was retired
  // from the published set. The claim is unchanged in substance: whatever sits
  // in that position, every artifact key carries ITS id, never the long-retired
  // `sigma1@` segment.
  it("every artifact key built for the premier algorithm carries the spr@{version} segment, never the retired sigma1@ segment", () => {
    const [, , premierModule] = resolvePublishAlgorithms(undefined);
    const module = premierModule!;
    const keys = [
      artifactKey({ page: "teams", year: 2026, algorithmId: module.id, version: module.version }),
      artifactKey({ page: "team", teamKey: "frc118", year: 2026, algorithmId: module.id, version: module.version }),
      artifactKey({ page: "events", year: 2026, algorithmId: module.id, version: module.version }),
      artifactKey({ page: "event", eventKey: "2026casj", algorithmId: module.id, version: module.version }),
    ];
    for (const key of keys) {
      expect(key).toContain(`spr@${module.version}`);
      expect(key).not.toContain("sigma1@");
    }
  });

  // Test 9 (T-07-16-01): an unknown/stale id throws loudly rather than
  // resolving silently — this is what makes a half-applied rename loud
  // instead of a run that quietly publishes nothing under the requested id.
  it("throws on the pre-rename id, listing the three known keys in the message", () => {
    expect(() => resolvePublishAlgorithms("opr,epa,sigma1")).toThrow(/Unknown algorithm for publish: "sigma1"/);
    try {
      resolvePublishAlgorithms("sigma1");
    } catch (err) {
      expect((err as Error).message).toContain("opr");
      expect((err as Error).message).toContain("epa");
      expect((err as Error).message).toContain("vpr");
    }
  });
});

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

/**
 * Plan 07-08 Task 1 (D-18 item 3, D-13 routed from 07-12): each alliance's
 * own predicted-score variance and each row's `sortTime`, threaded onto both
 * event match row builders. Every case asserts on a value read off the
 * returned or published artifact — never merely that a call did not throw.
 */
describe("buildEventArtifact — D-18 item 3 own predicted-score variance and D-13 sortTime (plan 07-08 Task 1)", () => {
  it("Test 1 (regression floor): a call supplying none of this plan's new parameters still produces a parsing artifact with both fields undefined", () => {
    const artifact = buildEventArtifact(eventArtifactParams());
    expect(artifact.matches[0]?.redScoreVarianceOwn).toBeUndefined();
    expect(artifact.matches[0]?.sortTime).toBeUndefined();
  });

  it("Test 2: a played row carries both variance fields, rounded at ROUNDING_RULE.variance", () => {
    const artifact = buildEventArtifact(eventArtifactParams({ prediction: { redScoreVarianceOwn: 41.256, blueScoreVarianceOwn: 38.5 } }));
    expect(artifact.matches[0]?.redScoreVarianceOwn).toBe(roundTo(41.256, ROUNDING_RULE.variance));
    expect(artifact.matches[0]?.blueScoreVarianceOwn).toBe(roundTo(38.5, ROUNDING_RULE.variance));
  });

  it("Test 3: an upcoming row carries both variance fields", () => {
    const artifact = buildEventArtifact(eventArtifactParams({ upcomingPrediction: { redScoreVarianceOwn: 12.34, blueScoreVarianceOwn: 9.87 } }));
    expect(artifact.upcoming[0]?.redScoreVarianceOwn).toBe(roundTo(12.34, ROUNDING_RULE.variance));
    expect(artifact.upcoming[0]?.blueScoreVarianceOwn).toBe(roundTo(9.87, ROUNDING_RULE.variance));
  });

  /**
   * Deviation from the plan's literal `[0.2, 0.2]` wording (Rule 1, found
   * RED-first): `buildEventArtifact`'s existing `roundPmf` call
   * UNCONDITIONALLY renormalizes any non-empty pmf so its rounded entries
   * sum to exactly 1 (adding the residual to the largest entry) — so a
   * `[0.2, 0.2]` input renormalizes to `[0.8, 0.2]` and parses successfully
   * through this path; `[0.2, 0.2]`'s failure mode is only reachable by
   * calling `EventArtifactSchema` directly with the UNROUNDED value, which
   * `pageArtifacts.test.ts`'s own "Test 3b" (plan 07-07) already covers. An
   * EMPTY `redRpPmf` genuinely reaches a throw through THIS function — the
   * conditional guard above `roundPmf` treats an empty array as truthy and
   * hands it to `roundPmf`, whose own explicit guard rejects it ("an empty
   * array is never a valid distribution") — the same non-empty rule
   * `EventUpcomingMatchSchema`'s refine enforces. This still proves the
   * point the plan named: the new variance fields sit inside the object
   * literal without disturbing this pmf handling.
   */
  it("Test 3 (pmf refines still fire): an upcoming prediction carrying both variance fields AND an empty redRpPmf still throws, naming the pmf rule", () => {
    expect(() =>
      buildEventArtifact(
        eventArtifactParams({
          upcomingPrediction: { redScoreVarianceOwn: 12.34, blueScoreVarianceOwn: 9.87, redRpPmf: [] },
        })
      )
    ).toThrow(/distribution/);
  });

  it("Test 4: red and blue own-variance are independently optional", () => {
    const artifact = buildEventArtifact(eventArtifactParams({ prediction: { redScoreVarianceOwn: 41.25 } }));
    expect(artifact.matches[0]?.redScoreVarianceOwn).toBe(roundTo(41.25, ROUNDING_RULE.variance));
    expect(artifact.matches[0]?.blueScoreVarianceOwn).toBeUndefined();
  });

  it("Test 5 (PD-02): an OPR row carries neither variance key, in memory nor after a JSON round-trip", () => {
    const artifact = buildEventArtifact(eventArtifactParams({ algorithmId: "opr", algorithmVersion: "3.0.0+baseline" }));
    expect(artifact.matches[0]?.redScoreVarianceOwn).toBeUndefined();
    expect(artifact.matches[0]?.blueScoreVarianceOwn).toBeUndefined();
    const roundTripped = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
    expect(roundTripped.matches[0]).not.toHaveProperty("redScoreVarianceOwn");
    expect(roundTripped.matches[0]).not.toHaveProperty("blueScoreVarianceOwn");
  });

  it("Test 6 (PD-09): the published value traces to predict()'s own output on the record it built the row from, never a recomputation", () => {
    const teams = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];
    const match = fixtureMatch();
    const records = new WalkForwardSimulator([match]).run(vpr, teams);
    const record = records[0]!;
    expect(record.prediction.redScoreVarianceOwn).toBeDefined();
    const artifact = buildEventArtifact({
      eventKey: match.eventKey,
      season: 2026,
      algorithmId: vpr.id,
      algorithmVersion: vpr.version,
      predictions: records,
      generation: "g-test6",
    });
    expect(artifact.matches[0]?.redScoreVarianceOwn).toBe(roundTo(record.prediction.redScoreVarianceOwn!, ROUNDING_RULE.variance));
  });

  it("Test 9: sortTime round-trips exactly on both a played and an upcoming row", () => {
    const match = fixtureMatch();
    const upcoming = fixtureUpcoming();
    const artifact = buildEventArtifact(
      eventArtifactParams({
        sortTimeByMatchKey: new Map([
          [match.matchKey, 111_000],
          [upcoming.matchKey, 222_000],
        ]),
      })
    );
    expect(artifact.matches[0]?.sortTime).toBe(111_000);
    expect(artifact.upcoming[0]?.sortTime).toBe(222_000);
  });

  it("Test 10: a match key absent from a supplied map, and a call supplying no map at all, both leave sortTime absent and never 0", () => {
    const match = fixtureMatch();
    const withEmptyMap = buildEventArtifact(eventArtifactParams({ sortTimeByMatchKey: new Map() }));
    expect(withEmptyMap.matches[0]?.sortTime).toBeUndefined();
    expect(withEmptyMap.matches[0]?.sortTime).not.toBe(0);
    const roundTrippedEmptyMap = JSON.parse(JSON.stringify(withEmptyMap)) as typeof withEmptyMap;
    expect(roundTrippedEmptyMap.matches[0]).not.toHaveProperty("sortTime");

    const withNoMap = buildEventArtifact(eventArtifactParams());
    expect(withNoMap.matches[0]?.sortTime).toBeUndefined();
    expect(withNoMap.matches[0]?.sortTime).not.toBe(0);
    const roundTrippedNoMap = JSON.parse(JSON.stringify(withNoMap)) as typeof withNoMap;
    expect(roundTrippedNoMap.matches[0]).not.toHaveProperty("sortTime");
    void match; // referenced for clarity that this map deliberately omits this match's key
  });
});

/**
 * Plan 08-02 Task 1 (D-03): `buildEventArtifact`'s `matches` row builder gains
 * `redRpPmf`/`blueRpPmf`, a two-line mirror of the `upcoming` builder's own
 * pair immediately below it. Every case asserts on the built/published value,
 * never merely that a call did not throw (PD-06).
 */
describe("buildEventArtifact — redRpPmf/blueRpPmf on played matches (D-03, plan 08-02 Task 1)", () => {
  it("Test 9 (regression floor): a call supplying no prediction pmf leaves matches[0]'s pmf keys undefined", () => {
    const artifact = buildEventArtifact(eventArtifactParams());
    expect(artifact.matches[0]?.redRpPmf).toBeUndefined();
    expect(artifact.matches[0]?.blueRpPmf).toBeUndefined();
  });

  it("Test 10: a played prediction's pmf reaches the published row, rounded via the same roundPmf the upcoming builder uses, and sums to exactly 1", () => {
    const redRpPmf = [0.123456, 0.234567, 0.345678, 0.111111, 0.098765, 0.055555, 0.030868];
    const blueRpPmf = [0.2, 0.2, 0.2, 0.15, 0.1, 0.1, 0.05];
    const artifact = buildEventArtifact(eventArtifactParams({ prediction: { redRpPmf, blueRpPmf } }));
    expect(artifact.matches[0]?.redRpPmf).toEqual(roundPmf(redRpPmf));
    expect(artifact.matches[0]?.blueRpPmf).toEqual(roundPmf(blueRpPmf));
    expect(artifact.matches[0]?.redRpPmf?.reduce((a, b) => a + b, 0)).toBe(1);
    expect(artifact.matches[0]?.blueRpPmf?.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("Test 11: the published value traces to the model's own output, never a synthesis — a red-only prediction publishes the red array and no blue key at all after a JSON round trip", () => {
    const redRpPmf = [0.4, 0.3, 0.3];
    const artifact = buildEventArtifact(eventArtifactParams({ prediction: { redRpPmf } }));
    expect(artifact.matches[0]?.redRpPmf).toEqual(roundPmf(redRpPmf));
    expect(artifact.matches[0]?.blueRpPmf).toBeUndefined();
    const roundTripped = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
    expect(roundTripped.matches[0]).not.toHaveProperty("blueRpPmf");
  });

  it("Test 12 (PD-02 mirror of Test 5): an OPR row carries neither pmf key, in memory nor after a JSON round trip", () => {
    const artifact = buildEventArtifact(eventArtifactParams({ algorithmId: "opr", algorithmVersion: "3.0.0+baseline" }));
    expect(artifact.matches[0]?.redRpPmf).toBeUndefined();
    expect(artifact.matches[0]?.blueRpPmf).toBeUndefined();
    const roundTripped = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
    expect(roundTripped.matches[0]).not.toHaveProperty("redRpPmf");
    expect(roundTripped.matches[0]).not.toHaveProperty("blueRpPmf");
  });

  it("Test 13 (PD-07, the builder's own failure path): a played prediction carrying an EMPTY redRpPmf throws through buildEventArtifact, naming the distribution rule", () => {
    expect(() => buildEventArtifact(eventArtifactParams({ prediction: { redRpPmf: [] } }))).toThrow(/distribution/);
  });
});

describe("buildEventArtifact — matchOutcomePmf/redBonusRpPmf/blueBonusRpPmf/rpOutcomeRp (D-15, plan 09-07)", () => {
  const DECOMPOSITION: Partial<Prediction> = {
    matchOutcomePmf: [0.612345, 0.023456, 0.364199],
    redOutcomeRp: [2, 1, 0],
    blueOutcomeRp: [0, 1, 2],
    redBonusRpPmf: [0.7123456, 0.2876544],
    blueBonusRpPmf: [0.812345, 0.187655],
  };

  it("a prediction carrying all five decomposition fields publishes the three row fields (rounded via roundPmf) and the top-level pair, on both matches and upcoming", () => {
    const artifact = buildEventArtifact(eventArtifactParams({ prediction: DECOMPOSITION, upcomingPrediction: DECOMPOSITION }));
    expect(artifact.matches[0]?.matchOutcomePmf).toEqual(roundPmf(DECOMPOSITION.matchOutcomePmf!));
    expect(artifact.matches[0]?.redBonusRpPmf).toEqual(roundPmf(DECOMPOSITION.redBonusRpPmf!));
    expect(artifact.matches[0]?.blueBonusRpPmf).toEqual(roundPmf(DECOMPOSITION.blueBonusRpPmf!));
    expect(artifact.upcoming[0]?.matchOutcomePmf).toEqual(roundPmf(DECOMPOSITION.matchOutcomePmf!));
    expect(artifact.upcoming[0]?.redBonusRpPmf).toEqual(roundPmf(DECOMPOSITION.redBonusRpPmf!));
    expect(artifact.upcoming[0]?.blueBonusRpPmf).toEqual(roundPmf(DECOMPOSITION.blueBonusRpPmf!));
    // redOutcomeRp: [2, 1, 0] -> win=2, tie=1, read against the pinned order.
    expect(artifact.rpOutcomeRp).toEqual({ win: 2, tie: 1 });
  });

  it("predictions carrying none of the five decomposition fields leave all four published keys absent — including after a JSON round trip", () => {
    const artifact = buildEventArtifact(eventArtifactParams());
    expect(artifact.matches[0]?.matchOutcomePmf).toBeUndefined();
    expect(artifact.matches[0]?.redBonusRpPmf).toBeUndefined();
    expect(artifact.matches[0]?.blueBonusRpPmf).toBeUndefined();
    expect(artifact.rpOutcomeRp).toBeUndefined();
    const roundTripped = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
    expect(roundTripped.matches[0]).not.toHaveProperty("matchOutcomePmf");
    expect(roundTripped.matches[0]).not.toHaveProperty("redBonusRpPmf");
    expect(roundTripped.matches[0]).not.toHaveProperty("blueBonusRpPmf");
    expect(roundTripped).not.toHaveProperty("rpOutcomeRp");
  });

  it("the pre-existing redRpPmf/blueRpPmf values on both row builders are byte-identical whether or not the decomposition is also present", () => {
    const redRpPmf = [0.123456, 0.234567, 0.345678, 0.111111, 0.098765, 0.055555, 0.030868];
    const blueRpPmf = [0.2, 0.2, 0.2, 0.15, 0.1, 0.1, 0.05];
    const withDecomposition = buildEventArtifact(
      eventArtifactParams({
        prediction: { redRpPmf, blueRpPmf, ...DECOMPOSITION },
        upcomingPrediction: { redRpPmf, blueRpPmf, ...DECOMPOSITION },
      })
    );
    const withoutDecomposition = buildEventArtifact(
      eventArtifactParams({ prediction: { redRpPmf, blueRpPmf }, upcomingPrediction: { redRpPmf, blueRpPmf } })
    );
    expect(withDecomposition.matches[0]?.redRpPmf).toEqual(withoutDecomposition.matches[0]?.redRpPmf);
    expect(withDecomposition.matches[0]?.blueRpPmf).toEqual(withoutDecomposition.matches[0]?.blueRpPmf);
    expect(withDecomposition.upcoming[0]?.redRpPmf).toEqual(withoutDecomposition.upcoming[0]?.redRpPmf);
    expect(withDecomposition.upcoming[0]?.blueRpPmf).toEqual(withoutDecomposition.upcoming[0]?.blueRpPmf);
  });
});

/**
 * Plan 08-02 Task 2 (D-12): `buildEventArtifact`'s `matches` row builder
 * gains `actualRedRp`/`actualBlueRp`, mirroring `buildTeamSeasonArtifact`'s
 * played branch exactly through the existing `toIntegerRpOrNull` guard —
 * direct assignment, never a conditional spread and never a nullish-
 * coalescing default (PD-04).
 */
describe("buildEventArtifact — actualRedRp/actualBlueRp on played matches (D-12, plan 08-02 Task 2)", () => {
  it("Test 7: the builder publishes both, including a real zero, derived from fixtureMatch's own redRpEarned/blueRpEarned", () => {
    const artifact = buildEventArtifact(eventArtifactParams());
    expect(artifact.matches[0]?.actualRedRp).toBe(fixtureMatch().redRpEarned);
    expect(artifact.matches[0]?.actualBlueRp).toBe(0);
  });

  it("Test 8 (ledger #14 regression): a non-integer corpus value degrades to null rather than aborting the build", () => {
    const artifact = buildEventArtifact({
      ...eventArtifactParams(),
      predictions: [{ match: fixtureMatch({ redRpEarned: 32.5, blueRpEarned: 7.5 }), prediction: fixturePrediction() }],
    });
    expect(artifact.matches[0]?.actualRedRp).toBeNull();
    expect(artifact.matches[0]?.actualBlueRp).toBeNull();
  });

  it("Test 9: a null source value publishes as null, never as 0", () => {
    const artifact = buildEventArtifact({
      ...eventArtifactParams(),
      predictions: [{ match: fixtureMatch({ redRpEarned: null }), prediction: fixturePrediction() }],
    });
    expect(artifact.matches[0]?.actualRedRp).toBeNull();
    expect(artifact.matches[0]?.actualRedRp).not.toBe(0);
  });

  it("Test 10: both keys are present on every played row after a JSON round trip, even when one is null", () => {
    const artifact = buildEventArtifact({
      ...eventArtifactParams(),
      predictions: [{ match: fixtureMatch({ redRpEarned: null }), prediction: fixturePrediction() }],
    });
    const roundTripped = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
    expect(roundTripped.matches[0]).toHaveProperty("actualRedRp");
    expect(roundTripped.matches[0]).toHaveProperty("actualBlueRp");
  });

  it("Test 11: a playoff row carries the pair too — elimination matches award no bonus RP, so a real zero from TBA is the honest published value, not an omission", () => {
    const artifact = buildEventArtifact({
      ...eventArtifactParams(),
      predictions: [
        { match: fixtureMatch({ matchKey: "2026casj_sf1m1", compLevel: "sf", redRpEarned: 0, blueRpEarned: 0 }), prediction: fixturePrediction() },
      ],
    });
    expect(artifact.matches[0]?.actualRedRp).toBe(0);
    expect(artifact.matches[0]?.actualBlueRp).toBe(0);
  });
});

/**
 * Plan 08-02 Task 3 (PD-02): the claim that `buildEventArtifact` and
 * `buildTeamSeasonArtifact` agree on all four of this plan's fields for the
 * SAME match and the SAME prediction, proven rather than asserted in prose —
 * one rule across three row builders (the third, `EventUpcomingMatchSchema`'s
 * own `upcoming` builder, is covered by Task 1's Test 10/11), not a fourth
 * convention that could silently diverge if a future contributor added a
 * competition-level gate to one builder and not the others.
 */
describe("buildEventArtifact / buildTeamSeasonArtifact — cross-builder equivalence on D-03/D-12's four fields (PD-02, plan 08-02 Task 3)", () => {
  it("agree on redRpPmf/blueRpPmf/actualRedRp/actualBlueRp for one shared elimination match and one shared prediction", () => {
    const sharedMatch = fixtureMatch({ matchKey: "2026casj_sf1m1", compLevel: "sf", redRpEarned: 0, blueRpEarned: 0 });
    const sharedPrediction = fixturePrediction({ redRpPmf: [1], blueRpPmf: [1] });

    const eventArtifact = buildEventArtifact({
      ...eventArtifactParams(),
      predictions: [{ match: sharedMatch, prediction: sharedPrediction }],
    });
    const teamArtifact = buildTeamSeasonArtifact({
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      season: 2026,
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+test",
      seasonStats: { record: { wins: 10, losses: 2, ties: 0 }, metrics: { total: { value: 12.34567 } }, metricsBasis: "last-official-match" },
      events: [
        {
          eventKey: "2026casj",
          eventName: "2026casj",
          startDate: "2026-03-01",
          matches: [{ match: sharedMatch, prediction: sharedPrediction }],
        },
      ],
      metricHistory: [],
      generation: "g-cross-builder",
      computedAt: "2026-08-31T00:00:00.000Z",
    });

    const eventRow = eventArtifact.matches[0]!;
    const teamRow = teamArtifact.events[0]!.matches[0]!;
    expect(eventRow.redRpPmf).toEqual(teamRow.redRpPmf);
    expect(eventRow.blueRpPmf).toEqual(teamRow.blueRpPmf);
    expect(eventRow.actualRedRp).toBe(teamRow.actualRedRp);
    expect(eventRow.actualBlueRp).toBe(teamRow.actualBlueRp);
    // Non-vacuity: the elimination match's degenerate one-entry pmf and its
    // real zero actual RP are the exact playoff-row shape PD-02 records —
    // asserting the agreement is non-trivial (not two undefined values).
    expect(eventRow.redRpPmf).toEqual([1]);
    expect(eventRow.actualRedRp).toBe(0);
  });
});

/**
 * Quick task 260906-7eu Task 1: `videoByMatchKey` end-to-end through both
 * builders, parsed through the real schema.
 */
describe("buildEventArtifact / buildTeamSeasonArtifact — videoByMatchKey (quick task 260906-7eu)", () => {
  it("buildEventArtifact publishes `video` on a mapped played match and omits it on an unmapped one", () => {
    const mappedMatch = fixtureMatch({ matchKey: "2026casj_qm1" });
    const unmappedMatch = fixtureMatch({ matchKey: "2026casj_qm3" });
    const artifact = buildEventArtifact({
      ...eventArtifactParams(),
      predictions: [
        { match: mappedMatch, prediction: fixturePrediction() },
        { match: unmappedMatch, prediction: fixturePrediction() },
      ],
      videoByMatchKey: new Map([["2026casj_qm1", "abc123XYZ90"]]),
    });

    const mappedRow = artifact.matches.find((m) => m.matchKey === "2026casj_qm1")!;
    const unmappedRow = artifact.matches.find((m) => m.matchKey === "2026casj_qm3")!;
    expect(mappedRow.video).toBe("abc123XYZ90");
    expect(Object.keys(unmappedRow)).not.toContain("video");
  });

  it("buildEventArtifact never publishes `video` on an upcoming row, even when the match key is in the map", () => {
    const artifact = buildEventArtifact({
      ...eventArtifactParams(),
      videoByMatchKey: new Map([["2026casj_qm2", "abc123XYZ90"]]), // fixtureUpcoming's matchKey
    });

    expect(Object.keys(artifact.upcoming[0]!)).not.toContain("video");
  });

  it("buildEventArtifact with no map supplied at all parses and no row carries `video`", () => {
    const artifact = buildEventArtifact(eventArtifactParams());

    expect(Object.keys(artifact.matches[0]!)).not.toContain("video");
    expect(Object.keys(artifact.upcoming[0]!)).not.toContain("video");
  });

  it("buildTeamSeasonArtifact publishes `video` on a mapped played match and omits it on an unmapped one", () => {
    const mappedMatch = fixtureMatch({ matchKey: "2026casj_qm1" });
    const unmappedMatch = fixtureMatch({ matchKey: "2026casj_qm3" });
    const artifact = buildTeamSeasonArtifact({
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      season: 2026,
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+test",
      seasonStats: { record: { wins: 10, losses: 2, ties: 0 }, metrics: { total: { value: 12.34567 } }, metricsBasis: "last-official-match" },
      events: [
        {
          eventKey: "2026casj",
          eventName: "2026casj",
          startDate: "2026-03-01",
          matches: [
            { match: mappedMatch, prediction: fixturePrediction() },
            { match: unmappedMatch, prediction: fixturePrediction() },
          ],
        },
      ],
      metricHistory: [],
      generation: "g-video-test",
      computedAt: "2026-08-31T00:00:00.000Z",
      videoByMatchKey: new Map([["2026casj_qm1", "abc123XYZ90"]]),
    });

    const rows = artifact.events[0]!.matches;
    const mappedRow = rows.find((m) => m.matchKey === "2026casj_qm1")!;
    const unmappedRow = rows.find((m) => m.matchKey === "2026casj_qm3")!;
    expect(mappedRow.video).toBe("abc123XYZ90");
    expect(Object.keys(unmappedRow)).not.toContain("video");
  });

  it("buildTeamSeasonArtifact with no map supplied at all parses and no row carries `video`", () => {
    const artifact = buildTeamSeasonArtifact({
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      season: 2026,
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+test",
      seasonStats: { record: { wins: 10, losses: 2, ties: 0 }, metrics: { total: { value: 12.34567 } }, metricsBasis: "last-official-match" },
      events: [
        {
          eventKey: "2026casj",
          eventName: "2026casj",
          startDate: "2026-03-01",
          matches: [{ match: fixtureMatch(), prediction: fixturePrediction() }],
        },
      ],
      metricHistory: [],
      generation: "g-video-test-2",
      computedAt: "2026-08-31T00:00:00.000Z",
    });

    expect(Object.keys(artifact.events[0]!.matches[0]!)).not.toContain("video");
  });
});

/**
 * Plan 07-08 Task 1, Tests 7-8: the seeded-corpus `publishSeasons` harness,
 * proving the variance/sortTime seam and the folded playoff bonus-RP
 * criterion against REAL published JSON bytes rather than in-memory
 * assertions.
 */
describe("buildEventArtifact — D-18 item 3 and folded playoff bonus-RP criterion, end-to-end (plan 07-08 Task 1)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-event-variance-corpus-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("Test 7: a real publishSeasons run with vpr publishes a finite redScoreVarianceOwn and the seeded sortTime on a played event row", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026casj" }));
    upsertMatch(db, seasonMatch({ sortTime: 12_345 }));

    await publishSeasons(db, { seasons: [2026], algorithms: [vpr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact = findEventArtifact("2026casj", vpr.id);
    const row = artifact.matches.find((m) => m.matchKey === "2026casj_qm1");
    expect(row).toBeDefined();
    expect(Number.isFinite(row?.redScoreVarianceOwn)).toBe(true);
    expect(row?.sortTime).toBe(12_345);
  });

  /**
   * PD-08: the seeded corpus rows actively carry a REAL, populated 2024
   * score breakdown on BOTH the qm and the sf match (the same
   * `rawBreakdown2024()` fixture `actualBonusFlagsForSeason`'s own tests
   * use) — so this is a genuine input that could produce bonus-RP data for
   * the playoff match, not a well-behaved fixture that happens not to
   * supply it. The qualification-side assertions below are what makes this
   * non-vacuous.
   */
  it("Test 8 (folded todo, PD-08; qm-side event assertions flipped by quick 260905-jj8): a freshly published playoff row carries no bonus-RP key on either artifact kind, while the qualification row carries all four on BOTH artifact kinds", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2024early", year: 2024 }));
    upsertEvent(db, seasonEvent({ eventKey: "2024casj", year: 2024 }));
    // Plan 09-04 Task 3: VPR no longer computes its OWN RP pmf independent
    // of Swing Factor band history (that bypass — VPR always having RP by
    // its very first played match — died when VPR's own RP block was
    // removed, not repointed). `#rpFieldsFor`'s band-variance gate now
    // applies to VPR exactly as it always has to OPR/EPA, and Swing Factor
    // needs 2 PLAYED matches per team before a band exists. These two
    // warm-up matches (an earlier event, same roster, real scores) exist
    // solely to give every team on "2024casj_qm1" that history BEFORE it
    // folds — F8/F9's cold-start gate is explicitly out of scope for this
    // phase (09-CONTEXT.md), so this test widens its fixture rather than
    // relying on a bypass this phase intentionally removed.
    upsertMatch(db, seasonMatch({ matchKey: "2024early_qm1", eventKey: "2024early", compLevel: "qm", sortTime: 100, redScore: 90, blueScore: 70 }));
    upsertMatch(db, seasonMatch({ matchKey: "2024early_qm2", eventKey: "2024early", compLevel: "qm", sortTime: 200, redScore: 85, blueScore: 75 }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2024casj_qm1",
        eventKey: "2024casj",
        compLevel: "qm",
        sortTime: 1_000,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: JSON.stringify(rawBreakdown2024()),
      })
    );
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2024casj_sf1m1",
        eventKey: "2024casj",
        compLevel: "sf",
        setNumber: 1,
        matchNumber: 1,
        sortTime: 2_000,
        hasScoreBreakdown: true,
        scoreBreakdownRaw: JSON.stringify(rawBreakdown2024()),
      })
    );

    await publishSeasons(db, { seasons: [2024], algorithms: [vpr], bucket: "test-bucket", dryRun: false, skipState: true });

    const teamArtifact = findTeamArtifact("frc1", 2024);
    const eventArtifact = findEventArtifact("2024casj", vpr.id);

    const teamCasjEvent = teamArtifact.events.find((e) => e.eventKey === "2024casj");
    const qmTeamRow = teamCasjEvent?.matches.find((m) => m.matchKey === "2024casj_qm1") as object;
    const sfTeamRow = teamCasjEvent?.matches.find((m) => m.matchKey === "2024casj_sf1m1") as object;

    // Non-vacuity: the qualification row genuinely carries all four keys.
    expect(qmTeamRow).toHaveProperty("redBonusRp");
    expect(qmTeamRow).toHaveProperty("blueBonusRp");
    expect(qmTeamRow).toHaveProperty("actualRedBonusRp");
    expect(qmTeamRow).toHaveProperty("actualBlueBonusRp");

    expect(sfTeamRow).not.toHaveProperty("redBonusRp");
    expect(sfTeamRow).not.toHaveProperty("blueBonusRp");
    expect(sfTeamRow).not.toHaveProperty("actualRedBonusRp");
    expect(sfTeamRow).not.toHaveProperty("actualBlueBonusRp");

    // Quick 260905-jj8 (todo `event-per-bonus-rp-publish`): the EVENT
    // artifact now carries the same four per-bonus keys on the
    // qualification row (previously it carried none at all — the gap that
    // left every Quals-tab dot permanently `unknown`), under the exact
    // comp-level gate the team artifact applies: the playoff row still
    // carries none of them, against the same real qualification-side bonus
    // set that keeps this non-vacuous (PD-08).
    const qmEventRow = eventArtifact.matches.find((m) => m.matchKey === "2024casj_qm1") as object;
    const sfEventRow = eventArtifact.matches.find((m) => m.matchKey === "2024casj_sf1m1") as object;
    for (const key of ["redBonusRp", "blueBonusRp", "actualRedBonusRp", "actualBlueBonusRp"]) {
      expect(qmEventRow).toHaveProperty(key);
      expect(sfEventRow).not.toHaveProperty(key);
    }
  });
});

/**
 * Plan 07-08 Task 2 (D-18 items 7/8): the event's own identity
 * (`name`/`startDate`/`location`/`week`) and its playoff alliance selection
 * (`alliances`). Every case asserts on a value read off the returned or
 * published artifact.
 */
describe("buildEventArtifact — D-18 items 7/8: event identity and playoff alliances (plan 07-08 Task 2)", () => {
  it("Test 1: no eventMeta, no alliances parameter -> none of the five keys are properties", () => {
    const artifact = buildEventArtifact(eventArtifactParams()) as object;
    expect(artifact).not.toHaveProperty("name");
    expect(artifact).not.toHaveProperty("startDate");
    expect(artifact).not.toHaveProperty("location");
    expect(artifact).not.toHaveProperty("week");
    expect(artifact).not.toHaveProperty("alliances");
  });

  it("Test 2: full identity round-trip", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({
        eventMeta: { name: "Sacramento Regional", startDate: "2026-03-01", country: "USA", stateProv: "CA", week: 3 },
      })
    );
    expect(artifact.name).toBe("Sacramento Regional");
    expect(artifact.startDate).toBe("2026-03-01");
    expect(artifact.location).toBe("CA, USA");
    expect(artifact.week).toBe(3);
  });

  it("Test 3: a null location and a null week are real, distinguishable from the absent case", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({ eventMeta: { name: "Some Event", startDate: "2026-03-01", country: null, stateProv: null, week: null } })
    ) as object & { location: unknown; week: unknown };
    expect(artifact.location).toBeNull();
    expect(artifact).toHaveProperty("location");
    expect(artifact.week).toBeNull();
    expect(artifact).toHaveProperty("week");
  });

  it("Test 4 (PD-07): week: 0 survives as a real zero, not null and not undefined", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({ eventMeta: { name: "Some Event", startDate: "2026-03-01", country: null, stateProv: null, week: 0 } })
    );
    expect(artifact.week).toBe(0);
  });

  it("Test 5 (PD-05): a null name AND an empty-string name both fall back to the event key", () => {
    const nullName = buildEventArtifact(
      eventArtifactParams({ eventMeta: { name: null, startDate: "2026-03-01", country: null, stateProv: null, week: null } })
    );
    expect(nullName.name).toBe("2026casj");
    const emptyName = buildEventArtifact(
      eventArtifactParams({ eventMeta: { name: "", startDate: "2026-03-01", country: null, stateProv: null, week: null } })
    );
    expect(emptyName.name).toBe("2026casj");
  });

  it("Test 6: an empty startDate is never invented — the key is entirely absent", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({ eventMeta: { name: "Some Event", startDate: "", country: null, stateProv: null, week: null } })
    ) as object;
    expect(artifact).not.toHaveProperty("startDate");
  });

  it("Test 7: composeEventLocation's four input combinations, pinned through buildEventArtifact's own output", () => {
    const both = buildEventArtifact(
      eventArtifactParams({ eventMeta: { name: "E", startDate: "2026-03-01", country: "USA", stateProv: "CA", week: null } })
    );
    expect(both.location).toBe("CA, USA");
    const countryOnly = buildEventArtifact(
      eventArtifactParams({ eventMeta: { name: "E", startDate: "2026-03-01", country: "USA", stateProv: null, week: null } })
    );
    expect(countryOnly.location).toBe("USA");
    const stateProvOnly = buildEventArtifact(
      eventArtifactParams({ eventMeta: { name: "E", startDate: "2026-03-01", country: null, stateProv: "CA", week: null } })
    );
    expect(stateProvOnly.location).toBe("CA");
    const neither = buildEventArtifact(
      eventArtifactParams({ eventMeta: { name: "E", startDate: "2026-03-01", country: null, stateProv: null, week: null } })
    );
    expect(neither.location).toBeNull();
  });

  it("Test 8 (PD-03): an empty alliances array IS a property, distinct from the omitted-parameter case", () => {
    const withEmpty = buildEventArtifact(eventArtifactParams({ alliances: [] })) as object & { alliances: unknown };
    expect(withEmpty).toHaveProperty("alliances");
    expect(withEmpty.alliances).toEqual([]);
    const withoutParam = buildEventArtifact(eventArtifactParams()) as object;
    expect(withoutParam).not.toHaveProperty("alliances");
  });

  it("Test 9: three alliances round-trip whole and in the supplied order, including a fourth pick", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({
        alliances: [
          { allianceNumber: 1, name: "The Alliance", picks: ["frc254", "frc1678", "frc971"] },
          { allianceNumber: 2, name: null, picks: ["frc604", "frc2054", "frc1323", "frc330"] },
          { allianceNumber: 3, name: null, picks: ["frc118", "frc192", "frc27"] },
        ],
      })
    );
    expect(artifact.alliances).toHaveLength(3);
    expect(artifact.alliances?.map((a) => a.allianceNumber)).toEqual([1, 2, 3]);
    expect(artifact.alliances?.[1]?.picks).toHaveLength(4);
    expect(artifact.alliances?.[1]?.picks[3]).toBe("frc330");
  });

  it("Test 10: an absent TBA alliance name publishes no name key, empty publishes none either, and a real name round-trips", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({
        alliances: [
          { allianceNumber: 1, name: null, picks: ["frc1", "frc2", "frc3"] },
          { allianceNumber: 2, name: "", picks: ["frc4", "frc5", "frc6"] },
          { allianceNumber: 3, name: "Real Name", picks: ["frc7", "frc8", "frc9"] },
        ],
      })
    );
    expect(artifact.alliances?.[0]).not.toHaveProperty("name");
    expect(artifact.alliances?.[1]).not.toHaveProperty("name");
    expect(artifact.alliances?.[2]?.name).toBe("Real Name");
  });

  it("Test 11 (07-UAT.md G-8): a real playoff record round-trips whole, and an absent one publishes no record key at all", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({
        alliances: [
          { allianceNumber: 1, name: null, picks: ["frc1", "frc2", "frc3"], record: { wins: 4, losses: 3, ties: 0 } },
          { allianceNumber: 2, name: null, picks: ["frc4", "frc5", "frc6"], record: null },
          { allianceNumber: 3, name: null, picks: ["frc7", "frc8", "frc9"] },
        ],
      })
    );
    expect(artifact.alliances?.[0]?.record).toEqual({ wins: 4, losses: 3, ties: 0 });
    expect(artifact.alliances?.[1]).not.toHaveProperty("record");
    expect(artifact.alliances?.[2]).not.toHaveProperty("record");
  });
});

/**
 * Plan 07-08 Task 2, Test 11: identity and alliances through the real
 * seeded-corpus `publishSeasons` path.
 */
describe("buildEventArtifact — D-18 items 7/8, end-to-end (plan 07-08 Task 2)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-event-identity-corpus-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("Test 11a: name/startDate/location/week and two alliance entries all reach the published v1/event/... body", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026casj", name: "Sacramento Regional", week: 3, country: "USA", stateProv: "CA" }));
    upsertMatch(db, seasonMatch());
    upsertEventAlliance(db, {
      eventKey: "2026casj",
      allianceNumber: 1,
      name: "The Alliance",
      picks: ["frc1", "frc2", "frc3"],
      declines: [],
      statusRaw: null,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });
    upsertEventAlliance(db, {
      eventKey: "2026casj",
      allianceNumber: 2,
      name: null,
      picks: ["frc4", "frc5", "frc6"],
      declines: [],
      statusRaw: null,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });

    await publishSeasons(db, { seasons: [2026], algorithms: [vpr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact = findEventArtifact("2026casj", vpr.id);
    expect(artifact.name).toBe("Sacramento Regional");
    expect(artifact.startDate).toBe("2026-03-01");
    expect(artifact.location).toBe("CA, USA");
    expect(artifact.week).toBe(3);
    expect(artifact.alliances).toHaveLength(2);
    expect(artifact.alliances?.[0]?.name).toBe("The Alliance");
    expect(artifact.alliances?.[1]).not.toHaveProperty("name");
  });

  it("Test 11b: an event with no alliance rows publishes alliances as [] (D-17)", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026noselect" }));
    upsertMatch(db, seasonMatch({ matchKey: "2026noselect_qm1", eventKey: "2026noselect" }));

    await publishSeasons(db, { seasons: [2026], algorithms: [vpr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact = findEventArtifact("2026noselect", vpr.id);
    expect(artifact.alliances).toEqual([]);
  });

  it("Test 11c (07-UAT.md G-8): a real status_raw round-trips through the corpus to the published record, and an absent status_raw publishes no record key", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026casj2" }));
    upsertMatch(db, seasonMatch({ matchKey: "2026casj2_qm1", eventKey: "2026casj2" }));
    upsertEventAlliance(db, {
      eventKey: "2026casj2",
      allianceNumber: 1,
      name: null,
      picks: ["frc1", "frc2", "frc3"],
      declines: [],
      statusRaw: JSON.stringify({ record: { wins: 4, losses: 3, ties: 0 }, status: "eliminated", level: "f" }),
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });
    upsertEventAlliance(db, {
      eventKey: "2026casj2",
      allianceNumber: 2,
      name: null,
      picks: ["frc4", "frc5", "frc6"],
      declines: [],
      statusRaw: null,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });

    await publishSeasons(db, { seasons: [2026], algorithms: [vpr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact = findEventArtifact("2026casj2", vpr.id);
    expect(artifact.alliances?.[0]?.record).toEqual({ wins: 4, losses: 3, ties: 0 });
    expect(artifact.alliances?.[1]).not.toHaveProperty("record");
  });
});

/**
 * Plan 07-08 Task 3 (D-18 item 6, D-07, D-08): official rank, TBA's
 * authoritative record and ranking points on each team row, from the
 * extended `event_rankings`. Every case asserts on a value read off the
 * returned or published artifact.
 */
describe("buildEventArtifact — D-18 item 6: rank/record/rp on team rows (plan 07-08 Task 3)", () => {
  it("Test 1 (D-08): a team with no rankings entry publishes none of rank/record/rp", () => {
    const artifact = buildEventArtifact(eventArtifactParams());
    const row = artifact.teams[0] as object;
    expect(row).not.toHaveProperty("rank");
    expect(row).not.toHaveProperty("record");
    expect(row).not.toHaveProperty("rp");
  });

  it("Test 2: full round-trip", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({ rankings: new Map([["frc254", seasonRankingRow({ rank: 7, recordWins: 9, recordLosses: 1, recordTies: 0, rankingScore: 3.835 })]]) })
    );
    const row = artifact.teams[0]!;
    expect(row.rank).toBe(7);
    expect(row.record).toEqual({ wins: 9, losses: 1, ties: 0 });
    expect(row.rp).toBe(roundTo(3.835, ROUNDING_RULE.rankingPoints));
  });

  it("Test 3 (PD-07): rp: 0 is a real, present ranking score, distinguishable from absent", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({ rankings: new Map([["frc254", seasonRankingRow({ rankingScore: 0 })]]) })
    );
    const row = artifact.teams[0] as object & { rp: unknown };
    expect(row).toHaveProperty("rp");
    expect(row.rp).toBe(0);
  });

  it("Test 4 (PD-06): a record missing any one of wins/losses/ties publishes no record key at all", () => {
    const allNull = buildEventArtifact(
      eventArtifactParams({ rankings: new Map([["frc254", seasonRankingRow({ rank: 4, recordWins: null, recordLosses: null, recordTies: null, rankingScore: null })]]) })
    );
    const allNullRow = allNull.teams[0] as object & { rank: unknown };
    expect(allNullRow.rank).toBe(4);
    expect(allNullRow).not.toHaveProperty("record");
    expect(allNullRow).not.toHaveProperty("rp");

    const partial = buildEventArtifact(
      eventArtifactParams({ rankings: new Map([["frc254", seasonRankingRow({ recordWins: 9, recordLosses: 1, recordTies: null })]]) })
    );
    expect(partial.teams[0]).not.toHaveProperty("record");
  });

  it("Test 5: an all-zero record is published, distinct from the absent case", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({ rankings: new Map([["frc254", seasonRankingRow({ recordWins: 0, recordLosses: 0, recordTies: 0 })]]) })
    );
    expect(artifact.teams[0]?.record).toEqual({ wins: 0, losses: 0, ties: 0 });
  });

  it("Test 6 (EVNT-02 adjacency): two teams sharing a rank value both publish it", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({
        teams: [
          { teamKey: "frc1", teamNumber: 1, nickname: "A", metrics: {} },
          { teamKey: "frc2", teamNumber: 2, nickname: "B", metrics: {} },
        ],
        rankings: new Map([
          ["frc1", seasonRankingRow({ rank: 5 })],
          ["frc2", seasonRankingRow({ rank: 5 })],
        ]),
      })
    );
    expect(artifact.teams[0]?.rank).toBe(5);
    expect(artifact.teams[1]?.rank).toBe(5);
  });

  it("Test 7 (EVNT-02 ordering): teams publish in the caller's supplied order, not sorted by rank", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({
        teams: [
          { teamKey: "frc1", teamNumber: 1, nickname: "A", metrics: {} },
          { teamKey: "frc2", teamNumber: 2, nickname: "B", metrics: {} },
        ],
        rankings: new Map([
          ["frc1", seasonRankingRow({ rank: 9 })],
          ["frc2", seasonRankingRow({ rank: 1 })],
        ]),
      })
    );
    expect(artifact.teams.map((t) => t.teamKey)).toEqual(["frc1", "frc2"]);
    expect(artifact.teams[0]?.rank).toBe(9);
    expect(artifact.teams[1]?.rank).toBe(1);
  });

  it("Test 8 (T-07-08-01): populated metrics and absent standings keys coexist on one row when no rankings map is supplied", () => {
    const artifact = buildEventArtifact(
      eventArtifactParams({ teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", metrics: { total: { value: 45.6, spread: 3.1 } } }] })
    );
    const row = artifact.teams[0] as object & { metrics: unknown };
    expect(row.metrics).toBeDefined();
    expect(row).not.toHaveProperty("rank");
    expect(row).not.toHaveProperty("record");
    expect(row).not.toHaveProperty("rp");
  });
});

/** Plan 07-08 Task 3, Test 9: rank/record/rp through the real seeded-corpus `publishSeasons` path. */
describe("buildEventArtifact — D-18 item 6, end-to-end (plan 07-08 Task 3)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-event-ranking-corpus-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("Test 9a: rank/record/rp reach the published v1/event/... body for a ranked team", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026casj" }));
    upsertMatch(db, seasonMatch());
    upsertTeam(db, { teamKey: "frc1", teamNumber: 1, nickname: "" });
    upsertEventRanking(db, {
      eventKey: "2026casj",
      teamKey: "frc1",
      rank: 2,
      totalTeams: 40,
      fetchedAt: "2026-01-01T00:00:00.000Z",
      recordWins: 5,
      recordLosses: 2,
      recordTies: 0,
      rankingScore: 2.71,
    });

    await publishSeasons(db, { seasons: [2026], algorithms: [vpr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact = findEventArtifact("2026casj", vpr.id);
    const row = artifact.teams.find((t) => t.teamKey === "frc1");
    expect(row?.rank).toBe(2);
    expect(row?.record).toEqual({ wins: 5, losses: 2, ties: 0 });
    expect(row?.rp).toBe(roundTo(2.71, ROUNDING_RULE.rankingPoints));
  });

  it("Test 9b (D-08): an event with no ranking rows publishes team rows with none of the three keys", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026norank" }));
    upsertMatch(db, seasonMatch({ matchKey: "2026norank_qm1", eventKey: "2026norank" }));

    await publishSeasons(db, { seasons: [2026], algorithms: [vpr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact = findEventArtifact("2026norank", vpr.id);
    for (const row of artifact.teams) {
      const r = row as object;
      expect(r).not.toHaveProperty("rank");
      expect(r).not.toHaveProperty("record");
      expect(r).not.toHaveProperty("rp");
    }
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
  it("assembles a small fixture that parses against TeamsArtifactWireSchema, rounding metrics and encoding positionally (260902-pbe)", () => {
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
    // 260902-pbe: buildTeamsArtifact returns the WIRE shape — `metricKeys`
    // carries the ordered key list, and each row's `metrics` is the
    // positional array aligned to it, not the pre-existing object-form
    // record. `decodeTeamsRowMetrics` (the schema's own decode helper) is
    // the round-trip proof this assertion leans on rather than re-deriving
    // the encoding by hand.
    expect(artifact.metricKeys).toEqual(["total"]);
    expect(artifact.teams[0]?.metrics).toEqual([[12.35]]);
    expect(decodeTeamsRowMetrics(artifact.teams[0]!.metrics as never, artifact.metricKeys!).total?.value).toBe(12.35);
  });

  it("given a team input with region fields, emits them on that row (quick task 260905-ttv)", () => {
    const artifact = buildTeamsArtifact({
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      teams: [
        {
          teamKey: "frc1114",
          teamNumber: 1114,
          nickname: "Simbotics",
          record: { wins: 10, losses: 2, ties: 0 },
          metrics: { total: { value: 50 } },
          eventCount: 3,
          matchCount: 36,
          country: "USA",
          stateProv: "MI",
          districtKey: "fim",
        },
      ],
      generation: "g1",
    });
    expect(artifact.teams[0]?.country).toBe("USA");
    expect(artifact.teams[0]?.stateProv).toBe("MI");
    expect(artifact.teams[0]?.districtKey).toBe("fim");
  });

  it("given a team input with no region fields, omits the keys entirely rather than emitting null or empty string (quick task 260905-ttv)", () => {
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
          metrics: { total: { value: 50 } },
          eventCount: 3,
          matchCount: 36,
        },
      ],
      generation: "g1",
    });
    const row = artifact.teams[0] as object;
    expect(row).not.toHaveProperty("country");
    expect(row).not.toHaveProperty("stateProv");
    expect(row).not.toHaveProperty("districtKey");
  });
});

describe("buildTeamsArtifact — swing metric (quick task 260909-tgf)", () => {
  function baseTeamInput(metrics: Record<string, TeamMetric & { percentile?: number; tier?: "rare" | "epic" | "legendary" }>) {
    return {
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      record: { wins: 10, losses: 2, ties: 0 },
      metrics,
      eventCount: 3,
      matchCount: 36,
    };
  }

  it("a row whose swing entry carries value + tier (no percentile) encodes positionally without throwing, and metricKeys includes SWING_METRIC_KEY", () => {
    const artifact = buildTeamsArtifact({
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      teams: [baseTeamInput({ [SWING_METRIC_KEY]: { value: 8.42, tier: "legendary" } })],
      generation: "g1",
      computedAt: "2026-08-22T00:00:00.000Z",
    });
    expect(artifact.metricKeys).toContain(SWING_METRIC_KEY);
    const swingIndex = artifact.metricKeys!.indexOf(SWING_METRIC_KEY);
    // [value, spread | null, tier] -- the three-element boxed-tier form.
    expect((artifact.teams[0]!.metrics as unknown[])[swingIndex]).toEqual([8.42, null, "legendary"]);
  });

  it("a row whose swing entry still carries percentile THROWS -- the merge must happen on the correct side of withPublishedTiers", () => {
    expect(() =>
      buildTeamsArtifact({
        season: 2026,
        algorithmId: "opr",
        algorithmVersion: "3.0.0+baseline",
        teams: [baseTeamInput({ [SWING_METRIC_KEY]: { value: 8.42, percentile: 97 } })],
        generation: "g1",
      })
    ).toThrow("encodeTeamMetricEntry: the teams-table positional encoding has no slot for `percentile`");
  });

  it("TeamsArtifactSchema.parse decodes the swing entry back to {value, tier} losslessly", () => {
    const artifact = buildTeamsArtifact({
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      teams: [baseTeamInput({ [SWING_METRIC_KEY]: { value: 8.42, tier: "legendary" } })],
      generation: "g1",
    });
    // TeamsArtifactSchema.parse (the DECODING schema, deliberately distinct
    // from TeamsArtifactWireSchema) already reconstructs each row's metrics
    // to record-form and drops metricKeys entirely -- see its own doc
    // comment. So the round-trip is a direct field read, not a second
    // decodeTeamsRowMetrics call.
    const parsed = TeamsArtifactSchema.parse(artifact);
    expect(parsed.teams[0]!.metrics[SWING_METRIC_KEY]).toEqual({ value: 8.42, tier: "legendary" });
  });

  it("rounds the swing value at ROUNDING_RULE.metric exactly once, matching the metrics beside it", () => {
    const artifact = buildTeamsArtifact({
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      teams: [baseTeamInput({ total: { value: 12.34567 }, [SWING_METRIC_KEY]: { value: 8.426789, tier: "epic" } })],
      generation: "g1",
    });
    const swingIndex = artifact.metricKeys!.indexOf(SWING_METRIC_KEY);
    const entry = (artifact.teams[0]!.metrics as unknown[])[swingIndex] as [number, number | null, string];
    expect(entry[0]).toBe(roundTo(8.426789, ROUNDING_RULE.metric));
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
      seasonStats: { record: { wins: 10, losses: 2, ties: 0 }, metrics: { total: { value: 12.34567 } }, metricsBasis: "last-official-match" },
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
  });

  it("accepts a team with no matches — events: [] and metricHistory: [] parse as a valid, non-missing artifact (D-05/D-07)", () => {
    const artifact = buildTeamSeasonArtifact({
      teamKey: "frc9999",
      teamNumber: 9999,
      nickname: "Nobody",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {}, metricsBasis: "last-official-match" },
      events: [],
      metricHistory: [],
      generation: "g1",
    });
    expect(artifact.events).toEqual([]);
    expect(artifact.metricHistory).toEqual([]);
  });
});

describe("buildTeamSeasonArtifact — swing metric (quick task 260909-tgf)", () => {
  it("seasonStats.metrics.swing.percentile round-trips, and the top-level swingFactor field stays present and unchanged", () => {
    const artifact = buildTeamSeasonArtifact({
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      seasonStats: {
        record: { wins: 10, losses: 2, ties: 0 },
        metrics: { total: { value: 50 }, [SWING_METRIC_KEY]: { value: 8.42, percentile: 97 } },
        metricsBasis: "last-official-match",
      },
      swingFactor: 8.42,
      events: [],
      metricHistory: [],
      generation: "g1",
    });
    expect(artifact.seasonStats.metrics[SWING_METRIC_KEY]?.percentile).toBe(97);
    expect(artifact.swingFactor).toBe(roundTo(8.42, ROUNDING_RULE.metric));
  });

  it("rounds the swing value at ROUNDING_RULE.metric exactly once, matching the metrics beside it", () => {
    const artifact = buildTeamSeasonArtifact({
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      seasonStats: {
        record: { wins: 10, losses: 2, ties: 0 },
        metrics: { [SWING_METRIC_KEY]: { value: 8.426789, percentile: 97 } },
        metricsBasis: "last-official-match",
      },
      events: [],
      metricHistory: [],
      generation: "g1",
    });
    expect(artifact.seasonStats.metrics[SWING_METRIC_KEY]?.value).toBe(roundTo(8.426789, ROUNDING_RULE.metric));
  });
});

describe("withPublishedTiers — swing tier stamping (quick task 260909-tgf)", () => {
  it("a swing entry with percentile 97 yields tier legendary and no percentile key", () => {
    const result = withPublishedTiers({ [SWING_METRIC_KEY]: { value: 8.42, percentile: 97 } });
    expect(result[SWING_METRIC_KEY]?.tier).toBe("legendary");
    expect("percentile" in (result[SWING_METRIC_KEY] ?? {})).toBe(false);
  });

  it("a swing entry with percentile 30 yields no tier key at all (Common is omitted, per the existing wire-format rule)", () => {
    const result = withPublishedTiers({ [SWING_METRIC_KEY]: { value: 8.42, percentile: 30 } });
    expect("tier" in (result[SWING_METRIC_KEY] ?? {})).toBe(false);
  });
});

describe("buildTeamSeasonArtifact — ranks (quick task 260905-ldu)", () => {
  function minimalParams(overrides: Partial<Parameters<typeof buildTeamSeasonArtifact>[0]> = {}): Parameters<typeof buildTeamSeasonArtifact>[0] {
    return {
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {}, metricsBasis: "last-official-match" },
      events: [],
      metricHistory: [],
      generation: "g1",
      ...overrides,
    };
  }

  it("emits the given rank scopes", () => {
    const artifact = buildTeamSeasonArtifact(
      minimalParams({
        ranks: [
          { scope: "world", rank: 12, total: 3481 },
          { scope: "district", value: "fim", rank: 3, total: 60 },
        ],
      })
    );
    expect(artifact.ranks).toEqual([
      { scope: "world", rank: 12, total: 3481 },
      { scope: "district", value: "fim", rank: 3, total: 60 },
    ]);
  });

  it("omits the ranks key (yields ranks: undefined) when given an empty array, rather than publishing an empty array", () => {
    const artifact = buildTeamSeasonArtifact(minimalParams({ ranks: [] }));
    expect(artifact.ranks).toBeUndefined();
  });

  it("omits the ranks key (yields ranks: undefined) when not given at all", () => {
    const artifact = buildTeamSeasonArtifact(minimalParams());
    expect(artifact.ranks).toBeUndefined();
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
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 45.6 } }, metricsBasis: "last-official-match" },
    metricHistory: [],
    generation: "test-generation-1",
    computedAt: "2026-08-22T00:00:00.000Z",
  } as const;

  it("D-01: rounds a Sigma1-shaped prediction's own-variance fields to 4 decimals; an OPR-shaped prediction leaves both undefined", () => {
    const vprArtifact = buildTeamSeasonArtifact({
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
    const vprRow = vprArtifact.events[0]?.matches[0];
    expect(vprRow?.redScoreVarianceOwn).toBe(12.3457);
    expect(vprRow?.blueScoreVarianceOwn).toBe(9.8765);

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

  it("degrades a non-integer stored redRpEarned/blueRpEarned to null rather than failing TeamSeasonMatchSchema's .int() assertion (2024orbb/2025orbb regression)", () => {
    // SQLite's loose type affinity does not enforce matches.red_rp_earned/
    // blue_rp_earned as integers, so a non-integer value written before
    // normalize.ts's extractRp guard existed (2024orbb/2025orbb's non-FRC
    // self-reported `rp` field) can still reach this assignment from the
    // corpus. Without the toIntegerRpOrNull defence-in-depth guard, this
    // would throw at TeamSeasonArtifactSchema.parse() and abort the batch.
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [
        {
          eventKey: "2024orbb",
          eventName: "2024orbb",
          startDate: "2024-12-14",
          matches: [
            { match: fixtureMatch({ redRpEarned: 32.5, blueRpEarned: 7.5 }), prediction: fixturePrediction() },
          ],
        },
      ],
    });
    const row = artifact.events[0]?.matches[0];
    expect(row?.actualRedRp).toBeNull();
    expect(row?.actualBlueRp).toBeNull();
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
        metricsBasis: "last-official-match",
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
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 45.6 } }, metricsBasis: "last-official-match" },
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

  /**
   * G-06.1-26 (plan 06.1-08, Task 3): the generalized invariant that
   * prevents silent reintroduction — written over the FULL comp-level set
   * (qm + all four playoff levels) in ONE mixed stream, so a future comp
   * level or a reintroduced ungated form fails here, not just for `sf`.
   * Non-vacuous: asserts the stream length (5) against the map size (1)
   * rather than only the per-match membership checks.
   */
  it("G-06.1-26 (plan 06.1-08): a match maps into the result set IFF its compLevel is qm, asserted over one mixed stream containing all five comp levels", () => {
    const compLevels = ["qm", "ef", "qf", "sf", "f"] as const;
    const stream: MatchResult[] = compLevels.map((compLevel, index) =>
      fixtureMatch({
        matchKey: `2024casj_${compLevel}${index}`,
        compLevel,
        eventType: 0,
        scoreBreakdownRaw: JSON.stringify(rawBreakdown2024()),
      }),
    );
    expect(stream).toHaveLength(5);

    const result = actualBonusFlagsForSeason(stream, 2024);
    expect(result.size).toBe(1);

    for (const match of stream) {
      expect(result.has(match.matchKey)).toBe(match.compLevel === "qm");
    }
  });
});

describe("buildTeamSeasonArtifact — predicted/actual per-bonus RP fields (Phase 06.1, plan 06.1-05 Task 2, F-06-1/F-06-3)", () => {
  const baseParams = {
    teamKey: "frc254",
    teamNumber: 254,
    nickname: "The Cheesy Poofs",
    season: 2024,
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+test",
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 45.6 } }, metricsBasis: "last-official-match" },
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
    const vprArtifact = buildTeamSeasonArtifact({
      ...baseParams,
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+test",
      events: [{ eventKey: "2024casj", eventName: "2024casj", startDate: "2024-03-01", matches: [{ match, prediction: fixturePrediction() }] }],
      actualBonusFlagsByMatchKey: flagMap,
    });
    const oprRow = oprArtifact.events[0]?.matches[0];
    const vprRow = vprArtifact.events[0]?.matches[0];
    expect(oprRow?.actualRedBonusRp).toEqual(vprRow?.actualRedBonusRp);
    expect(oprRow?.actualBlueBonusRp).toEqual(vprRow?.actualBlueBonusRp);
  });

  /**
   * G-06.1-26 (plan 06.1-08, Task 3): the cross-side invariant — pins
   * predicted and actual to the SAME gating rule. Deliberately feeds a
   * `Prediction` carrying populated bonus marginals AND a populated
   * `actualBonusFlagsByMatchKey` entry for BOTH the qm and the sf match, so
   * this proves `buildTeamSeasonArtifact` itself defends against a
   * playoff-match input carrying either kind of per-bonus data — never
   * merely that a well-behaved caller happens not to supply it.
   */
  it("G-06.1-26 (plan 06.1-08): a played sf row carries NEITHER predicted nor actual per-bonus keys, while a qm row in the same artifact carries all four", () => {
    const qmMatch = fixtureMatch({ matchKey: "2024casj_qm1", compLevel: "qm" });
    const sfMatch = fixtureMatch({ matchKey: "2024casj_sf1m1", compLevel: "sf" });
    const bonusPrediction = fixturePrediction({ redBonusRp: [0.7, 0.2], blueBonusRp: [0.1, 0.9] });
    const flags: ActualBonusFlags = { red: [true, false], blue: [false, true] };
    const artifact = buildTeamSeasonArtifact({
      ...baseParams,
      events: [
        {
          eventKey: "2024casj",
          eventName: "2024casj",
          startDate: "2024-03-01",
          matches: [
            { match: qmMatch, prediction: bonusPrediction },
            { match: sfMatch, prediction: bonusPrediction },
          ],
        },
      ],
      actualBonusFlagsByMatchKey: new Map([
        [qmMatch.matchKey, flags],
        [sfMatch.matchKey, flags],
      ]),
    });
    const qmRow = artifact.events[0]?.matches.find((m) => m.matchKey === qmMatch.matchKey) as object;
    const sfRow = artifact.events[0]?.matches.find((m) => m.matchKey === sfMatch.matchKey) as object;

    expect(qmRow).toHaveProperty("redBonusRp");
    expect(qmRow).toHaveProperty("blueBonusRp");
    expect(qmRow).toHaveProperty("actualRedBonusRp");
    expect(qmRow).toHaveProperty("actualBlueBonusRp");

    expect(sfRow).not.toHaveProperty("redBonusRp");
    expect(sfRow).not.toHaveProperty("blueBonusRp");
    expect(sfRow).not.toHaveProperty("actualRedBonusRp");
    expect(sfRow).not.toHaveProperty("actualBlueBonusRp");
  });
});

function historyRow(overrides: Partial<MetricHistoryRow> = {}): MetricHistoryRow {
  return {
    matchKey: "2026casj_qm1",
    season: 2026,
    eventKey: "2026casj",
    algorithmId: "vpr",
    teamKey: "frc254",
    matchIndex: 0,
    metrics: { [TOTAL_METRIC_KEY]: { value: 10 } },
    ...overrides,
  };
}

describe("withHistoryPercentiles (Phase 06.1, plan 06.1-05 Task 3, D-06.1-A)", () => {
  it("attaches a percentile to an allowlisted metric with a pool entry, agreeing exactly with percentileAgainstSortedPool", () => {
    const pool = new Map([[TOTAL_METRIC_KEY, [5, 10, 10, 20]]]);
    const rows = [historyRow({ metrics: { [TOTAL_METRIC_KEY]: { value: 10 } } })];
    const result = withHistoryPercentiles(rows, pool);
    const expected = percentileAgainstSortedPool(pool.get(TOTAL_METRIC_KEY)!, 10);
    expect(result[0]?.metrics[TOTAL_METRIC_KEY]?.percentile).toBe(expected);
  });

  it("a metric name outside the allowlist receives no percentile key, even when a pool exists for it", () => {
    const pool = new Map([["autoPoints", [1, 2, 3]]]);
    const rows = [historyRow({ metrics: { autoPoints: { value: 2 } } })];
    const result = withHistoryPercentiles(rows, pool);
    expect(result[0]?.metrics.autoPoints).not.toHaveProperty("percentile");
  });

  it("a metric name in the allowlist with no pool entry receives no percentile key, and the call does not throw", () => {
    const pool = new Map<string, number[]>(); // no entry for TOTAL_METRIC_KEY at all
    const rows = [historyRow({ metrics: { [TOTAL_METRIC_KEY]: { value: 10 } } })];
    expect(() => withHistoryPercentiles(rows, pool)).not.toThrow();
    const result = withHistoryPercentiles(rows, pool);
    expect(result[0]?.metrics[TOTAL_METRIC_KEY]).not.toHaveProperty("percentile");
  });

  it("does not mutate the input rows or their nested metric objects", () => {
    const pool = new Map([[TOTAL_METRIC_KEY, [5, 10, 10, 20]]]);
    const rows = [historyRow({ metrics: { [TOTAL_METRIC_KEY]: { value: 10 } } })];
    const clone = structuredClone(rows);
    withHistoryPercentiles(rows, pool);
    expect(rows).toEqual(clone);
  });

  it("preserves row order exactly, and two rows with equal values at different positions receive equal percentiles", () => {
    const pool = new Map([[TOTAL_METRIC_KEY, [5, 10, 10, 20]]]);
    const rows = [
      historyRow({ matchKey: "m1", matchIndex: 0, metrics: { [TOTAL_METRIC_KEY]: { value: 20 } } }),
      historyRow({ matchKey: "m2", matchIndex: 1, metrics: { [TOTAL_METRIC_KEY]: { value: 10 } } }),
      historyRow({ matchKey: "m3", matchIndex: 2, metrics: { [TOTAL_METRIC_KEY]: { value: 10 } } }),
    ];
    const result = withHistoryPercentiles(rows, pool);
    expect(result.map((r) => r.matchKey)).toEqual(["m1", "m2", "m3"]);
    expect(result[1]?.metrics[TOTAL_METRIC_KEY]?.percentile).toBe(result[2]?.metrics[TOTAL_METRIC_KEY]?.percentile);
  });
});

/** The metric name this suite's real-corpus invariant case checks — always present via `HISTORY_PERCENTILE_METRIC_KEYS` and computed independently per team by `epa` (no cross-team coupling in `epa.update`/`teamMetrics`, unlike OPR's shared least-squares solve — see this file's own doc comment above). */
const INVARIANT_SEASON = 2022;
const INVARIANT_MIN_TEAM_COUNT = 50;
const CORPUS_PATH = "data/corpus.sqlite";
const CORPUS_AVAILABLE = existsSync(CORPUS_PATH);

describe("withHistoryPercentiles — real-corpus season-final agreement invariant (Phase 06.1, plan 06.1-05 Task 3, D-06.1-A)", () => {
  if (!CORPUS_AVAILABLE) {
    it.skip(`skipped: ${CORPUS_PATH} is absent — run pnpm ingest --years 2022-2026 first`, () => {});
    return;
  }

  let corpus: Corpus;
  try {
    corpus = openCorpusReadOnly(CORPUS_PATH);
  } catch (err) {
    it.skip(`skipped: could not open ${CORPUS_PATH} read-only — ${err instanceof Error ? err.message : String(err)}`, () => {});
    return;
  }

  // Replays the real ${INVARIANT_SEASON} season for `epa` only — mirrors
  // `publish.ts`'s own season-loop shape (buildSeasonStream, onMatchComplete
  // metric-history collection, teamMetrics(finalState, teamsThisSeason))
  // at a scale that stays well inside this suite's feedback ceiling
  // (measured ~8s for the full non-offseason 2022 season, 14,677 matches,
  // 3,062 teams — mirrors `payloadBudget.test.ts`'s own real-slice
  // precedent). `epa` chosen deliberately: its `update()`/`teamMetrics()`
  // are per-team-independent (no cross-team coupling like OPR's shared
  // least-squares solve), so a team's LAST metricHistory row IS its
  // season-final metric for every team that plays at least once — this is
  // what makes the filtered-set floor trivially satisfiable while still
  // being a genuine, unconditional-on-luck real-corpus proof.
  const stream = buildSeasonStream(corpus, INVARIANT_SEASON, { includeOffseason: false });
  const teams = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
  const matchIndexByKey = new Map(stream.map((m, i) => [m.matchKey, i]));
  const historyByTeam = new Map<string, MetricHistoryRow[]>();
  const onMatchComplete = (match: MatchResult, algorithmId: string, state: unknown): void => {
    const involved = [...match.redTeams, ...match.blueTeams];
    const metrics = epa.teamMetrics(state as Parameters<typeof epa.teamMetrics>[0], involved);
    for (const teamKey of involved) {
      const row: MetricHistoryRow = {
        matchKey: match.matchKey,
        season: INVARIANT_SEASON,
        eventKey: match.eventKey,
        algorithmId,
        teamKey,
        matchIndex: matchIndexByKey.get(match.matchKey) ?? 0,
        metrics: metrics[teamKey] ?? {},
      };
      const list = historyByTeam.get(teamKey) ?? [];
      list.push(row);
      historyByTeam.set(teamKey, list);
    }
  };
  const simulator = new WalkForwardSimulator(stream);
  const records = simulator.runAll([epa], teams, undefined, onMatchComplete);
  const finalState = records.finalStates.get(epa.id);
  const metricsByTeam = finalState !== undefined ? epa.teamMetrics(finalState as Parameters<typeof epa.teamMetrics>[0], teams) : {};
  const sortedPools = sortedPoolsByMetric(metricsByTeam, teams);

  it(`the real ${INVARIANT_SEASON} season replay produces a non-vacuous team pool (>= ${INVARIANT_MIN_TEAM_COUNT} teams)`, () => {
    expect(teams.length).toBeGreaterThanOrEqual(INVARIANT_MIN_TEAM_COUNT);
  });

  it(`for every team whose last metricHistory row's ${TOTAL_METRIC_KEY} value equals its season-final value, withHistoryPercentiles's row percentile equals the season-final percentile exactly (filtered-set floor: ${INVARIANT_MIN_TEAM_COUNT})`, () => {
    const filteredTeamKeys: string[] = [];
    for (const teamKey of teams) {
      const rows = historyByTeam.get(teamKey);
      if (!rows || rows.length === 0) continue;
      const lastRow = rows[rows.length - 1]!;
      const lastValue = lastRow.metrics[TOTAL_METRIC_KEY]?.value;
      const finalValue = metricsByTeam[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (lastValue === undefined || finalValue === undefined) continue;
      if (lastValue === finalValue) filteredTeamKeys.push(teamKey);
    }
    expect(
      filteredTeamKeys.length,
      `expected at least ${INVARIANT_MIN_TEAM_COUNT} teams satisfying the value-equality precondition, found ${filteredTeamKeys.length}`
    ).toBeGreaterThanOrEqual(INVARIANT_MIN_TEAM_COUNT);

    for (const teamKey of filteredTeamKeys) {
      const rows = historyByTeam.get(teamKey)!;
      const [widenedLastRow] = withHistoryPercentiles([rows[rows.length - 1]!], sortedPools);
      const rowPercentile = widenedLastRow?.metrics[TOTAL_METRIC_KEY]?.percentile;
      const seasonFinalPercentile = percentileAgainstSortedPool(
        sortedPools.get(TOTAL_METRIC_KEY)!,
        metricsByTeam[teamKey]![TOTAL_METRIC_KEY]!.value
      );
      expect(rowPercentile, `team ${teamKey}: row percentile should equal season-final percentile exactly`).toBe(seasonFinalPercentile);
    }
  });

  corpus.close();
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

  // `seasonEvent`/`seasonMatch`/`findTeamArtifact` hoisted to module scope
  // (plan 07-08) — see their definitions above, beside `eventArtifactParams`.

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

/**
 * D-2/D-4 (quick task 260903-n2o, Task 4): real coverage on `publish.ts`'s
 * `compare/{year}.json` call site — the CONTEXT's first surviving finding
 * was that this call site decides EVERY published `headlineEligible`, and
 * today reverting either of its two eligibility arguments keeps the suite
 * green. The corpus below seeds two priors (2022, 2023) that exist in the
 * corpus but are ABSENT from the publish range (`--seasons 2024` alone) —
 * the exact shape that distinguishes a corpus-derived `corpusSeasons` from
 * a range- or loop-derived one.
 */
describe("publishSeasons — compare artifact eligibility sources the CORPUS, not the published range (D-2/D-4, quick task 260903-n2o Task 4)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-compare-eligibility-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function findCompareArtifact(year: number): CompareArtifact {
    const call = vi.mocked(putObject).mock.calls.find(([, key]) => key === `v1/compare/${year}.json`);
    expect(call, `expected a v1/compare/${year}.json putObject call`).toBeDefined();
    return JSON.parse(call![2] as string) as CompareArtifact;
  }

  it("2024, published alone, is headline-eligible for opr because the CORPUS (not the publish range) supplies its two priors", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2022prior", year: 2022 }));
    upsertMatch(db, seasonMatch({ matchKey: "2022prior_qm1", eventKey: "2022prior" }));

    upsertEvent(db, seasonEvent({ eventKey: "2023prior", year: 2023 }));
    upsertMatch(db, seasonMatch({ matchKey: "2023prior_qm1", eventKey: "2023prior" }));

    upsertEvent(db, seasonEvent({ eventKey: "2024casj", year: 2024 }));
    upsertMatch(db, seasonMatch({ matchKey: "2024casj_qm1", eventKey: "2024casj" }));

    await publishSeasons(db, { seasons: [2024], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact = findCompareArtifact(2024);
    const oprCombined2024 = artifact.slices.find(
      (s) => s.algorithmId === "opr" && s.season === 2024 && s.compLevelView === "combined"
    );
    expect(oprCombined2024).toBeDefined();
    expect(oprCombined2024?.headlineEligible).toBe(true);

    // Two reverts this test is standing guard over (both manually confirmed
    // to redden this test — recorded in the SUMMARY):
    //   1. Reverting publish.ts's `corpusSeasons` argument (at the
    //      compare-artifact `aggregateScores` call) to this loop's own
    //      `[season]`, or to `seasonsSorted` (the `--seasons` range): 2024
    //      would have zero declared priors instead of two, so
    //      `headlineEligible` above reads `false`.
    //   2. Reverting the same call's `selectedOnSeasons` argument to an
    //      empty record `{}`: `opr` is absent from that map, so
    //      `aggregateScores` throws naming it (D-2's missing-entry guard)
    //      and this `await publishSeasons(...)` call itself rejects.
  });

  /**
   * F-3 (quick task 260903-tk6): the prior version of this describe block
   * only ever published `algorithms: [opr]`, and `opr`'s registry entry is
   * a hardcoded `() => []` — so `selectedOnSeasonsFor(["opr"])` and a
   * hand-built `{opr: []}` are byte-identical on that path, and deleting
   * `selectionProvenance.ts`'s entire contribution kept the old test green.
   * `vpr` is the first algorithm in this file whose registry entry is a
   * REAL provenance read (the committed version file's
   * `provenance.tuneSeasons`), so this is the first assertion anywhere in
   * the repo that a published `compare/{year}.json`'s `vpr` eligibility
   * matches the real matrix on BOTH sides of the selected-on boundary.
   *
   * This expectation is PINNED to the committed version file's PER-SEASON
   * `paramSetsBySeason` map (quick task 260904-2i9; the flat
   * `provenance.tuneSeasons` read this comment used to describe no longer
   * exists on the live pin) — both 2024's and 2025's governing param sets in
   * `data/algorithm-versions/vpr@{SIGMA1_CODE_VERSION}+rolling-2026-09.json`
   * record `selectedOnSeasons` of `[2022, 2023, 2024]`, so "2024 NOT
   * headline-eligible, 2025 IS" still holds. A future re-tune that promotes
   * a different selected-on set for either season is SUPPOSED to redden this
   * test — a headline-eligibility matrix change must be a deliberate,
   * visible edit, never a silent side effect of a re-promotion.
   */
  it("2024 and 2025 are BOTH headline-eligible now that no season sits inside vpr's own selected-on set", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2022prior", year: 2022 }));
    upsertMatch(db, seasonMatch({ matchKey: "2022prior_qm1", eventKey: "2022prior" }));

    upsertEvent(db, seasonEvent({ eventKey: "2023prior", year: 2023 }));
    upsertMatch(db, seasonMatch({ matchKey: "2023prior_qm1", eventKey: "2023prior" }));

    upsertEvent(db, seasonEvent({ eventKey: "2024casj", year: 2024 }));
    upsertMatch(db, seasonMatch({ matchKey: "2024casj_qm1", eventKey: "2024casj" }));

    upsertEvent(db, seasonEvent({ eventKey: "2025casj", year: 2025 }));
    upsertMatch(db, seasonMatch({ matchKey: "2025casj_qm1", eventKey: "2025casj" }));

    await publishSeasons(db, { seasons: [2024, 2025], algorithms: [vpr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact2024 = findCompareArtifact(2024);
    const vprCombined2024 = artifact2024.slices.find(
      (s) => s.algorithmId === vpr.id && s.season === 2024 && s.compLevelView === "combined"
    );
    expect(vprCombined2024).toBeDefined();
    // CHANGED 2026-09-08 (quick task 260907-v1s, gate 5 de-contamination), and
    // the change is the RESULT rather than an accommodation of one. This
    // asserted `false` because vpr's 2024 parameters were selected on
    // 2022/2023/2024 — a window CONTAINING 2024 — so the season was excluded
    // from headline comparison on the grounds that the model had seen it.
    // Those parameters were re-fitted on 2020/2022/2023, strictly prior, so
    // 2024 is now a season vpr can honestly be headline-scored on for the
    // first time. After that re-fit NO season sits inside its own selected-on
    // set (verified across 2022-2026), which is why this test no longer has an
    // ineligible case to contrast against.
    //
    // The ineligible BRANCH is still covered, directly and at unit level, by
    // `score.test.ts`'s `isHeadlineEligible(2020, [2019, 2020], [])` — so
    // flipping this expectation loses no coverage of the mechanism itself.
    expect(vprCombined2024?.headlineEligible).toBe(true);

    const artifact2025 = findCompareArtifact(2025);
    const vprCombined2025 = artifact2025.slices.find(
      (s) => s.algorithmId === vpr.id && s.season === 2025 && s.compLevelView === "combined"
    );
    expect(vprCombined2025).toBeDefined();
    expect(vprCombined2025?.headlineEligible).toBe(true);

    // Mutation this test is standing guard over (confirmed to redden it —
    // recorded in the SUMMARY): replacing the registry call inside
    // `aggregateScoresForRun` (`selectionProvenance.ts`) with a map of
    // every requested id to an empty array flips 2024 to eligible, since
    // `vpr` would then read as never selected on anything.
  });
});

/**
 * Published-surface exclusion (`.planning/todos/pending/exclude-offseason-demo-teams.md`
 * scope item 2): no `team/{teamKey}/{year}` page, no `teams/{year}` list
 * entry, for any of the 30 `frc9970`-`frc9999` "Off-Season Demo Team" keys —
 * asserted against `publishSeasons`'s real `putObject` calls, not against
 * `teamsThisSeason` as an internal implementation detail.
 */
describe("publishSeasons — off-season demo team exclusion from every published team surface", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-demo-team-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function findTeamsArtifact(year: number): { teams: readonly { teamKey: string }[] } {
    const call = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith(`v1/teams/${year}/`));
    expect(call, `expected a v1/teams/${year}/... putObject call`).toBeDefined();
    return JSON.parse(call![2] as string) as { teams: readonly { teamKey: string }[] };
  }

  it("publishes no team/{teamKey}/{year} page for a demo key, even though it played a real, mixed alliance match", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026demo" }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026demo_qm1",
        eventKey: "2026demo",
        redTeams: ["frc1", "frc2", "frc9985"],
        blueTeams: ["frc4", "frc5", "frc6"],
      })
    );

    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const teamCalls = vi.mocked(putObject).mock.calls.filter(([, key]) => (key as string).startsWith("v1/team/"));
    expect(teamCalls.some(([, key]) => (key as string).startsWith("v1/team/frc9985/"))).toBe(false);
    // The real teammates DID get published — this is an exclusion, not an
    // accidental drop of the whole event.
    expect(teamCalls.some(([, key]) => (key as string).startsWith("v1/team/frc1/"))).toBe(true);
  });

  it("the teams/{year} list carries no row at all for a demo key", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026demo" }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026demo_qm1",
        eventKey: "2026demo",
        redTeams: ["frc1", "frc2", "frc9985"],
        blueTeams: ["frc4", "frc5", "frc6"],
      })
    );

    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const teamsArtifact = findTeamsArtifact(2026);
    expect(teamsArtifact.teams.some((row) => row.teamKey === "frc9985")).toBe(false);
    expect(teamsArtifact.teams.some((row) => row.teamKey === "frc1")).toBe(true);
  });

  it("excludes every one of the 30 demo keys, including a fully-demo forfeit alliance at a non-qm comp level", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026demo" }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026demo_qm1",
        eventKey: "2026demo",
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
      })
    );
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026demo_sf1m1",
        eventKey: "2026demo",
        compLevel: "sf",
        setNumber: 1,
        sortTime: 2_000,
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc9970", "frc9971", "frc9972"],
        redScore: 200,
        blueScore: 0,
      })
    );

    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const teamCalls = vi.mocked(putObject).mock.calls.filter(([, key]) => (key as string).startsWith("v1/team/"));
    for (const demoKey of ["frc9970", "frc9971", "frc9972"]) {
      expect(teamCalls.some(([, key]) => (key as string).startsWith(`v1/team/${demoKey}/`))).toBe(false);
    }
    const teamsArtifact = findTeamsArtifact(2026);
    for (const demoKey of ["frc9970", "frc9971", "frc9972"]) {
      expect(teamsArtifact.teams.some((row) => row.teamKey === demoKey)).toBe(false);
    }
  });
});

/**
 * Quick task 260904-586: direct unit coverage of `lastOfficialMetricsByTeam`
 * — the exported Teams-list official-play snapshot, tested in isolation
 * before the end-to-end `publishSeasons` describe block below wires it in.
 */
describe("lastOfficialMetricsByTeam — direct (quick task 260904-586)", () => {
  function historyRow(overrides: Partial<MetricHistoryRow> = {}): MetricHistoryRow {
    return {
      matchKey: "2026casj_qm1",
      season: 2026,
      eventKey: "2026casj",
      algorithmId: "opr",
      teamKey: "frc1",
      matchIndex: 0,
      metrics: { total: { value: 10 } },
      ...overrides,
    };
  }

  it("for rows official-A, official-A, offseason-B, returns the SECOND row's metrics, not the third's", () => {
    const rows = [
      historyRow({ eventKey: "2026a", matchIndex: 0, metrics: { total: { value: 10 } } }),
      historyRow({ eventKey: "2026a", matchIndex: 1, metrics: { total: { value: 20 } } }),
      historyRow({ eventKey: "2026b", matchIndex: 2, metrics: { total: { value: 999 } } }),
    ];
    const byTeam = new Map([["frc1", rows]]);
    const result = lastOfficialMetricsByTeam(byTeam, new Set(["2026a"]));
    expect(result.frc1?.total?.value).toBe(20);
  });

  it("for rows official-A, offseason-B, official-C, returns the THIRD row's metrics — last official wins regardless of what sits between", () => {
    const rows = [
      historyRow({ eventKey: "2026a", matchIndex: 0, metrics: { total: { value: 10 } } }),
      historyRow({ eventKey: "2026b", matchIndex: 1, metrics: { total: { value: 999 } } }),
      historyRow({ eventKey: "2026c", matchIndex: 2, metrics: { total: { value: 30 } } }),
    ];
    const byTeam = new Map([["frc1", rows]]);
    const result = lastOfficialMetricsByTeam(byTeam, new Set(["2026a", "2026c"]));
    expect(result.frc1?.total?.value).toBe(30);
  });

  it("a team with only offseason rows is ABSENT from the returned record — not present with an empty object", () => {
    const rows = [historyRow({ eventKey: "2026b", metrics: { total: { value: 999 } } })];
    const byTeam = new Map([["frc1", rows]]);
    const result = lastOfficialMetricsByTeam(byTeam, new Set(["2026a"]));
    expect(result).not.toHaveProperty("frc1");
    expect(Object.keys(result)).toEqual([]);
  });

  it("returns the SAME metrics object reference the source row carried — no rounding, no percentile, no mutation", () => {
    const sourceMetrics = { total: { value: 12.3456789 } };
    const rows = [historyRow({ eventKey: "2026a", metrics: sourceMetrics })];
    const byTeam = new Map([["frc1", rows]]);
    const result = lastOfficialMetricsByTeam(byTeam, new Set(["2026a"]));
    expect(result.frc1).toBe(sourceMetrics);
  });
});

/**
 * Quick task 260908-wpo: direct unit coverage of `seasonStatsMetricsForTeam`
 * — the team-artifact call site's official-vs-season-final selection helper
 * — tested in isolation before the end-to-end `publishSeasons` describe
 * block below wires it in.
 */
describe("seasonStatsMetricsForTeam — direct (quick task 260908-wpo)", () => {
  it("official present and non-empty wins, tagged last-official-match", () => {
    const official = { frc1: { total: { value: 313.95, percentile: 99.9 } } };
    const seasonFinal = { frc1: { total: { value: 251.37, percentile: 99.3 } } };
    const result = seasonStatsMetricsForTeam("frc1", official, seasonFinal);
    expect(result.metrics).toBe(official.frc1);
    expect(result.metricsBasis).toBe("last-official-match");
  });

  it("official absent falls back to season-final, tagged season-final", () => {
    const official = {};
    const seasonFinal = { frc1: { total: { value: 251.37, percentile: 99.3 } } };
    const result = seasonStatsMetricsForTeam("frc1", official, seasonFinal);
    expect(result.metrics).toBe(seasonFinal.frc1);
    expect(result.metricsBasis).toBe("season-final");
  });

  it("official present but empty ALSO falls back to season-final — the trap: a presence-only check would publish the empty object instead", () => {
    const official = { frc1: {} };
    const seasonFinal = { frc1: { total: { value: 251.37, percentile: 99.3 } } };
    const result = seasonStatsMetricsForTeam("frc1", official, seasonFinal);
    expect(result.metrics).toBe(seasonFinal.frc1);
    expect(Object.keys(result.metrics).length).toBeGreaterThan(0);
    expect(result.metricsBasis).toBe("season-final");
  });

  it("neither record has an entry for the team — returns empty metrics, tagged season-final (never throws)", () => {
    const result = seasonStatsMetricsForTeam("frc404", {}, {});
    expect(result.metrics).toEqual({});
    expect(result.metricsBasis).toBe("season-final");
  });
});

/**
 * Quick task 260904-586: end-to-end proof, through the real `publishSeasons`
 * path against a synthetic temp-dir corpus, that the Teams-list snapshot is
 * scoped to official play while team/event artifacts stay untouched.
 */
describe("publishSeasons — Teams-list official-play scoping (quick task 260904-586)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-official-scoping-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function findTeamsArtifactRaw(year: number): unknown {
    const call = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith(`v1/teams/${year}/`));
    expect(call, `expected a v1/teams/${year}/... putObject call`).toBeDefined();
    return JSON.parse(call![2] as string);
  }

  it("a team's teams/{year} row equals its official-event value, not its season-final value — while the team artifact still carries the offseason event and its metric-history rows", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026casj", name: "Official Event" }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026casj_qm1",
        eventKey: "2026casj",
        sortTime: 1_000,
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 100,
        blueScore: 50,
      })
    );

    upsertEvent(db, seasonEvent({ eventKey: "2026off", name: "Offseason Event", eventType: 99, isOffseason: true }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026off_qm1",
        eventKey: "2026off",
        sortTime: 2_000,
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 250,
        blueScore: 10,
      })
    );

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [opr],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
      includeOffseason: true,
    });

    const teamsArtifact = TeamsArtifactSchema.parse(findTeamsArtifactRaw(2026));
    const row = teamsArtifact.teams.find((t) => t.teamKey === "frc1");
    expect(row).toBeDefined();

    const teamArtifact = findTeamArtifact("frc1", 2026);
    const officialRow = teamArtifact.metricHistory.filter((r) => r.eventKey === "2026casj").at(-1);
    const offseasonRow = teamArtifact.metricHistory.filter((r) => r.eventKey === "2026off").at(-1);
    expect(officialRow).toBeDefined();
    expect(offseasonRow).toBeDefined();

    // The published teams-row metric equals the official-event snapshot...
    expect(row?.metrics.total?.value).toBe(roundTo(officialRow!.metrics.total!.value, ROUNDING_RULE.metric));
    // ...and NOT the offseason (season-final) snapshot, which is a
    // different number by construction of this fixture (a 250-10 offseason
    // blowout that would otherwise swamp the 100-50 official result).
    expect(row?.metrics.total?.value).not.toBe(roundTo(offseasonRow!.metrics.total!.value, ROUNDING_RULE.metric));

    // The team artifact itself is untouched — the offseason event and its
    // matches are still fully present.
    const offseasonSection = teamArtifact.events.find((e) => e.eventKey === "2026off");
    expect(offseasonSection).toBeDefined();
    expect(offseasonSection?.matches).toHaveLength(1);
  });

  it("a team appearing ONLY at an offseason event still has a teams/{year} row (teamKey, teamNumber, nickname, record present) with an empty metrics record", async () => {
    // An official event elsewhere in the season, involving different teams —
    // present only so the season has at least one non-offseason match
    // (`selectCorpusSeasons` requires that for `compare/{year}.json`'s
    // aggregation to declare 2026 in scope; unrelated to what this test is
    // actually asserting, which is about frc1's own row).
    upsertEvent(db, seasonEvent({ eventKey: "2026casj", name: "Official Event" }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026casj_qm1",
        eventKey: "2026casj",
        sortTime: 500,
        redTeams: ["frc10", "frc11", "frc12"],
        blueTeams: ["frc13", "frc14", "frc15"],
      })
    );

    upsertEvent(db, seasonEvent({ eventKey: "2026off", name: "Offseason Event", eventType: 99, isOffseason: true }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026off_qm1",
        eventKey: "2026off",
        sortTime: 1_000,
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
      })
    );

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [opr],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
      includeOffseason: true,
    });

    const teamsArtifact = TeamsArtifactSchema.parse(findTeamsArtifactRaw(2026));
    const row = teamsArtifact.teams.find((t) => t.teamKey === "frc1");
    expect(row).toBeDefined();
    expect(row?.teamNumber).toBe(1);
    // Quick task 260908-615: PRESENT-AND-ZERO, not absent. frc1 won its only
    // match, but that match was at an offseason event, so the official-scoped
    // record counts nothing — while the row itself still exists so the team
    // remains findable and its page still links.
    expect(row?.record).toEqual({ wins: 0, losses: 0, ties: 0 });
    expect(row?.eventCount).toBe(0);
    expect(row?.matchCount).toBe(0);
    expect(row?.metrics).toEqual({});
  });
});

describe("publishSeasons — official-only record, eventCount and matchCount (quick task 260908-615)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-official-counts-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Local copy of the sibling block's helper — `findTeamsArtifactRaw` there is describe-scoped. */
  function findTeamsArtifactRaw(year: number): unknown {
    const call = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith(`v1/teams/${year}/`));
    expect(call, `expected a v1/teams/${year}/... putObject call`).toBeDefined();
    return JSON.parse(call![2] as string);
  }

  /** frc1 plays one official match (a win) and one offseason match (also a win). */
  function seedOneOfficialOneOffseason(): void {
    upsertEvent(db, seasonEvent({ eventKey: "2026casj", name: "Official Event", eventType: 0 }));
    upsertMatch(db, seasonMatch({ matchKey: "2026casj_qm1", eventKey: "2026casj", sortTime: 1_000 }));

    upsertEvent(
      db,
      seasonEvent({ eventKey: "2026ex", name: "Exhibition", eventType: OFFSEASON_EVENT_TYPE, isOffseason: true })
    );
    upsertMatch(db, seasonMatch({ matchKey: "2026ex_qm1", eventKey: "2026ex", sortTime: 9_000 }));
  }

  it("the Teams-list row counts the official match only, with matchCount 1 and eventCount 1", async () => {
    seedOneOfficialOneOffseason();

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [opr],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
      includeOffseason: true,
    });

    const teamsArtifact = TeamsArtifactSchema.parse(findTeamsArtifactRaw(2026));
    const row = teamsArtifact.teams.find((t) => t.teamKey === "frc1");
    expect(row?.record).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(row?.matchCount).toBe(1);
    expect(row?.eventCount).toBe(1);
  });

  it("the per-team artifact publishes the same official-only record while still carrying the offseason event, its matches and its metricHistory rows", async () => {
    seedOneOfficialOneOffseason();

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [opr],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
      includeOffseason: true,
    });

    const artifact = findTeamArtifact("frc1", 2026);
    expect(artifact.seasonStats.record, "same population as the Teams-list row").toEqual({
      wins: 1,
      losses: 0,
      ties: 0,
    });

    // The re-scoping half: nothing about the offseason event is hidden.
    const exhibition = artifact.events.find((e) => e.eventKey === "2026ex");
    expect(exhibition, "the offseason event keeps its own section").toBeDefined();
    expect(exhibition?.matches).toHaveLength(1);
    expect(
      artifact.metricHistory.some((r) => r.eventKey === "2026ex"),
      "the offseason match still moves the metric-history chart"
    ).toBe(true);
  });

  it("region derivation is untouched: an offseason event never contributed a region (deriveTeamRegions filters officially on its own), and a team with official play still gets one", async () => {
    // frc10..frc15 play an OFFICIAL event carrying geography.
    upsertEvent(
      db,
      seasonEvent({ eventKey: "2026casj", name: "Official Event", eventType: 0, country: "USA", stateProv: "CA" })
    );
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026casj_qm1",
        eventKey: "2026casj",
        sortTime: 500,
        redTeams: ["frc10", "frc11", "frc12"],
        blueTeams: ["frc13", "frc14", "frc15"],
      })
    );

    // frc1..frc6 play ONLY an offseason event, which also carries geography.
    upsertEvent(
      db,
      seasonEvent({
        eventKey: "2026ex",
        name: "Exhibition",
        eventType: OFFSEASON_EVENT_TYPE,
        isOffseason: true,
        country: "USA",
        stateProv: "TX",
      })
    );
    upsertMatch(db, seasonMatch({ matchKey: "2026ex_qm1", eventKey: "2026ex", sortTime: 9_000 }));

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [opr],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
      includeOffseason: true,
    });

    const teamsArtifact = TeamsArtifactSchema.parse(findTeamsArtifactRaw(2026));

    // The offseason-only team: zero official counts, and NO region — not
    // because this task narrowed the region input (it did not; the all-play
    // map is still passed), but because `deriveTeamRegions` applies its own
    // `isRegionEligibleEvent` official-type filter. Pinned here so a future
    // reader does not "fix" the region input believing it was broken by the
    // record scoping.
    const offseasonOnly = teamsArtifact.teams.find((t) => t.teamKey === "frc1");
    expect(offseasonOnly?.record).toEqual({ wins: 0, losses: 0, ties: 0 });
    expect(offseasonOnly?.country).toBeUndefined();
    expect(offseasonOnly?.stateProv).toBeUndefined();

    // The official-play team: region derives exactly as before.
    const officialTeam = teamsArtifact.teams.find((t) => t.teamKey === "frc10");
    expect(officialTeam?.country).toBe("USA");
    expect(officialTeam?.stateProv).toBe("CA");
  });
});

/**
 * Quick task 260908-wpo: end-to-end proof, through the real `publishSeasons`
 * path against a synthetic temp-dir corpus, that the published team
 * artifact's `seasonStats.metrics` reads the last-official-match basis with
 * a season-final fallback for a team with no official play at all.
 */
describe("publishSeasons — seasonStats.metrics official-with-fallback (quick task 260908-wpo)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-seasonstats-basis-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function findTeamsArtifactRaw(year: number): unknown {
    const call = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith(`v1/teams/${year}/`));
    expect(call, `expected a v1/teams/${year}/... putObject call`).toBeDefined();
    return JSON.parse(call![2] as string);
  }

  it("a team with one official and one offseason match: seasonStats.metrics equals the Teams-list row's metrics, tagged last-official-match, while metricHistory still carries the offseason row", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026casj", name: "Official Event", eventType: 0 }));
    upsertMatch(db, seasonMatch({ matchKey: "2026casj_qm1", eventKey: "2026casj", sortTime: 1_000 }));

    upsertEvent(
      db,
      seasonEvent({ eventKey: "2026ex", name: "Exhibition", eventType: OFFSEASON_EVENT_TYPE, isOffseason: true })
    );
    upsertMatch(db, seasonMatch({ matchKey: "2026ex_qm1", eventKey: "2026ex", sortTime: 9_000 }));

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [opr],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
      includeOffseason: true,
    });

    const teamsArtifact = TeamsArtifactSchema.parse(findTeamsArtifactRaw(2026));
    const listRow = teamsArtifact.teams.find((t) => t.teamKey === "frc1");
    expect(listRow).toBeDefined();

    const teamArtifact = findTeamArtifact("frc1", 2026);
    expect(teamArtifact.seasonStats.metricsBasis).toBe("last-official-match");
    expect(teamArtifact.seasonStats.metrics.total?.value).toBe(listRow?.metrics.total?.value);

    expect(
      teamArtifact.metricHistory.some((r) => r.eventKey === "2026ex"),
      "the offseason match still moves the metric-history chart"
    ).toBe(true);
  });

  it("an offseason-only team publishes NON-EMPTY seasonStats.metrics, tagged season-final — the trap this task closes", async () => {
    // An official event elsewhere, involving different teams, so the season
    // qualifies for aggregation (matches the sibling 260904-586 block's own
    // fixture reasoning).
    upsertEvent(db, seasonEvent({ eventKey: "2026casj", name: "Official Event", eventType: 0 }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026casj_qm1",
        eventKey: "2026casj",
        sortTime: 500,
        redTeams: ["frc10", "frc11", "frc12"],
        blueTeams: ["frc13", "frc14", "frc15"],
      })
    );

    upsertEvent(
      db,
      seasonEvent({ eventKey: "2026ex", name: "Exhibition", eventType: OFFSEASON_EVENT_TYPE, isOffseason: true })
    );
    upsertMatch(db, seasonMatch({ matchKey: "2026ex_qm1", eventKey: "2026ex", sortTime: 1_000 }));

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [opr],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
      includeOffseason: true,
    });

    const teamArtifact = findTeamArtifact("frc1", 2026);
    expect(teamArtifact.seasonStats.metricsBasis).toBe("season-final");
    // The trap: assert the VALUES are present, not merely the basis string —
    // a basis-only assertion passes on a blanked team too.
    expect(Object.keys(teamArtifact.seasonStats.metrics).length).toBeGreaterThan(0);
    expect(teamArtifact.seasonStats.metrics.total?.value).toBeDefined();
    // Cross-check against the same team's own metricHistory, which stays
    // season-final regardless — the fallback must equal that value exactly.
    const lastHistoryRow = teamArtifact.metricHistory.at(-1);
    expect(teamArtifact.seasonStats.metrics.total?.value).toBe(lastHistoryRow?.metrics.total?.value);
  });

  it("a team with official play only: metricsBasis is last-official-match and the value equals the season-final path's own value — the frc254 no-regression case", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026casj", name: "Official Event", eventType: 0 }));
    upsertMatch(db, seasonMatch({ matchKey: "2026casj_qm1", eventKey: "2026casj", sortTime: 1_000 }));

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [opr],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
      includeOffseason: true,
    });

    const teamArtifact = findTeamArtifact("frc1", 2026);
    expect(teamArtifact.seasonStats.metricsBasis).toBe("last-official-match");
    const lastHistoryRow = teamArtifact.metricHistory.at(-1);
    expect(teamArtifact.seasonStats.metrics.total?.value).toBe(lastHistoryRow?.metrics.total?.value);
  });
});

/**
 * Quick task 260905-ldu: the cross-artifact agreement the whole rank-cards
 * feature rests on — the World rank published on a team's OWN artifact must
 * equal that team's index+1 in the published teams/{year} artifact's rows,
 * after filtering to real team keys and sorting with the shared
 * `compareTeamsByTotal`. This is asserted end-to-end against real
 * `publishSeasons` output, not against `teamRanks.ts` in isolation — the
 * risk this guards against is the two call sites (publish.ts's per-team loop
 * and its Teams-artifact assembly) drifting apart, which a pure unit test of
 * `teamRanks.ts` alone cannot catch.
 */
describe("publishSeasons — World rank cross-artifact agreement (quick task 260905-ldu)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-ranks-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function findTeamsArtifactRaw(year: number): unknown {
    const call = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith(`v1/teams/${year}/`));
    expect(call, `expected a v1/teams/${year}/... putObject call`).toBeDefined();
    return JSON.parse(call![2] as string);
  }

  it("every real team's published World rank equals its index+1 in the teams artifact's rows sorted by compareTeamsByTotal", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2026rnk", name: "Ranking Event", country: "USA", stateProv: "MI", districtKey: "fim" }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026rnk_qm1",
        eventKey: "2026rnk",
        sortTime: 1_000,
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: 120,
        blueScore: 60,
      })
    );
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026rnk_qm2",
        eventKey: "2026rnk",
        sortTime: 2_000,
        redTeams: ["frc1", "frc4", "frc7"],
        blueTeams: ["frc2", "frc5", "frc8"],
        redScore: 90,
        blueScore: 110,
      })
    );
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026rnk_qm3",
        eventKey: "2026rnk",
        sortTime: 3_000,
        // frc9B (a letter-suffixed non-real key) is deliberately included:
        // it must be excluded from every ranking pool before ranks are
        // computed, per teamRanks.ts's own contract.
        redTeams: ["frc3", "frc6", "frc9"],
        blueTeams: ["frc1", "frc8", "frc9B"],
        redScore: 70,
        blueScore: 130,
      })
    );

    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const teamsArtifact = TeamsArtifactSchema.parse(findTeamsArtifactRaw(2026));
    const realRows = teamsArtifact.teams.filter((t) => isRealPublishedTeamKey(t.teamKey));
    expect(realRows.length).toBeGreaterThan(0);
    const sorted = [...realRows].sort(compareTeamsByTotal);

    for (const row of realRows) {
      const expectedRank = sorted.findIndex((r) => r.teamKey === row.teamKey) + 1;
      const teamArtifact = findTeamArtifact(row.teamKey, 2026);
      const world = teamArtifact.ranks?.find((r) => r.scope === "world");
      expect(world, `expected a world rank scope on ${row.teamKey}'s artifact`).toBeDefined();
      expect(world?.rank, `world rank for ${row.teamKey}`).toBe(expectedRank);
      expect(world?.total).toBe(sorted.length);

      // Quick task 260905-ttv: every real team here played only at
      // "2026rnk" (USA/MI/fim) -- its published teams/{year} row carries
      // exactly that inferred home region.
      expect(row.country).toBe("USA");
      expect(row.stateProv).toBe("MI");
      expect(row.districtKey).toBe("fim");
    }
  });

  it("frc9B (a letter-suffixed non-real key) is excluded from the published teams artifact's region assertions but does not corrupt the real rows' ranks", () => {
    // Regression guard, deliberately trivial: isRealPublishedTeamKey already
    // filters non-real keys out of `realRows` above -- this test exists so a
    // future reader confirms that exclusion by name rather than by inference
    // from the previous test's row count alone.
    expect(isRealPublishedTeamKey("frc9B")).toBe(false);
  });

  it(
    "quick task 260905-ttv: World rank is computed against ROUNDED metrics -- when two real teams are indistinguishable to OPR's design matrix " +
      "(always paired on the same alliance) and therefore tie EXACTLY, the published World rank still equals each team's index+1 in the " +
      "wire-round-tripped teams artifact sorted by compareTeamsByTotal, broken by ascending team number",
    async () => {
      // frc1 and frc2 NEVER appear on separate alliances or with different
      // teammates across any of these three matches -- OPR's least-squares
      // design matrix cannot distinguish their columns, so the minimum-norm
      // solution assigns them EXACTLY equal ratings. This is the same class
      // of collision `roundTeamMetricRecord` guards against (two distinct-
      // by-construction values landing on the same published number) without
      // depending on an unverifiable floating-point coincidence.
      upsertEvent(db, seasonEvent({ eventKey: "2026tie", name: "Tie Event", country: "USA", stateProv: "MI", districtKey: "fim" }));
      upsertMatch(
        db,
        seasonMatch({
          matchKey: "2026tie_qm1",
          eventKey: "2026tie",
          sortTime: 1_000,
          redTeams: ["frc1", "frc2", "frc3"],
          blueTeams: ["frc4", "frc5", "frc6"],
          redScore: 100,
          blueScore: 60,
        })
      );
      upsertMatch(
        db,
        seasonMatch({
          matchKey: "2026tie_qm2",
          eventKey: "2026tie",
          sortTime: 2_000,
          redTeams: ["frc1", "frc2", "frc7"],
          blueTeams: ["frc8", "frc9", "frc10"],
          redScore: 90,
          blueScore: 70,
        })
      );
      upsertMatch(
        db,
        seasonMatch({
          matchKey: "2026tie_qm3",
          eventKey: "2026tie",
          sortTime: 3_000,
          redTeams: ["frc1", "frc2", "frc11"],
          blueTeams: ["frc12", "frc13", "frc14"],
          redScore: 110,
          blueScore: 50,
        })
      );

      await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

      const teamsArtifact = TeamsArtifactSchema.parse(findTeamsArtifactRaw(2026));
      const frc1Row = teamsArtifact.teams.find((t) => t.teamKey === "frc1");
      const frc2Row = teamsArtifact.teams.find((t) => t.teamKey === "frc2");
      expect(frc1Row?.metrics.total?.value).toBe(frc2Row?.metrics.total?.value);

      const realRows = teamsArtifact.teams.filter((t) => isRealPublishedTeamKey(t.teamKey));
      const sorted = [...realRows].sort(compareTeamsByTotal);
      // frc1 (teamNumber 1) sorts before frc2 (teamNumber 2) on the tie-break.
      const frc1Index = sorted.findIndex((r) => r.teamKey === "frc1");
      const frc2Index = sorted.findIndex((r) => r.teamKey === "frc2");
      expect(frc1Index).toBeLessThan(frc2Index);

      for (const teamKey of ["frc1", "frc2"]) {
        const expectedRank = sorted.findIndex((r) => r.teamKey === teamKey) + 1;
        const teamArtifact = findTeamArtifact(teamKey, 2026);
        const world = teamArtifact.ranks?.find((r) => r.scope === "world");
        expect(world, `expected a world rank scope on ${teamKey}'s artifact`).toBeDefined();
        expect(world?.rank, `world rank for ${teamKey}`).toBe(expectedRank);
        expect(world?.total).toBe(sorted.length);
      }
    }
  );
});

/**
 * Plan 07-09 Task 1 (D-10, D-09, D-11): direct unit coverage of
 * `withEventPercentiles` — the exported merge function, tested in isolation
 * from the seeded-corpus publish path below.
 */
describe("withEventPercentiles — direct (plan 07-09 Task 1)", () => {
  it("Test 2: a pool hit attaches the exact percentileAgainstSortedPool value; a pool miss attaches no percentile key at all", () => {
    const metrics: Record<string, TeamMetric> = { total: { value: 50 }, spread: { value: 12 } };
    const pool = [10, 20, 50, 80];
    const sortedPools = new Map<string, number[]>([["total", pool]]);
    const result = withEventPercentiles(metrics, sortedPools);
    expect(result.total?.percentile).toBe(percentileAgainstSortedPool(pool, 50));
    expect(result.spread).not.toHaveProperty("percentile");
  });

  it("Test 3 (PD-03 — deliberate divergence from withHistoryPercentiles): a raw metric name NOT in HISTORY_PERCENTILE_METRIC_KEYS still receives a percentile when the pool has it", () => {
    const rawComponentName = "autoMobility";
    expect(HISTORY_PERCENTILE_METRIC_KEYS).not.toContain(rawComponentName);
    const metrics: Record<string, TeamMetric> = { [rawComponentName]: { value: 5 } };
    const pool = [1, 5, 9];
    const sortedPools = new Map<string, number[]>([[rawComponentName, pool]]);
    const result = withEventPercentiles(metrics, sortedPools);
    expect(result[rawComponentName]?.percentile).toBe(percentileAgainstSortedPool(pool, 5));
  });

  it("Test 4: never mutates the input, returns new objects, preserves key order", () => {
    const metrics: Record<string, TeamMetric> = { b: { value: 2 }, a: { value: 1 } };
    const snapshot = JSON.parse(JSON.stringify(metrics));
    const sortedPools = new Map<string, number[]>([
      ["a", [1, 2, 3]],
      ["b", [1, 2, 3]],
    ]);
    const result = withEventPercentiles(metrics, sortedPools);
    expect(metrics).toEqual(snapshot);
    expect(result).not.toBe(metrics);
    expect(result.a).not.toBe(metrics.a);
    expect(Object.keys(result)).toEqual(Object.keys(metrics));
  });

  it("Test 5: value and spread survive untouched; this function attaches a percentile and derives nothing else", () => {
    const metrics: Record<string, TeamMetric> = { total: { value: 42.5, spread: 3.25 }, other: { value: 7 } };
    const sortedPools = new Map<string, number[]>([["total", [10, 42.5, 90]]]);
    const result = withEventPercentiles(metrics, sortedPools);
    expect(result.total?.value).toBe(42.5);
    expect(result.total?.spread).toBe(3.25);
    expect(result.other).not.toHaveProperty("spread");
  });

  it("Test 6 (EVNT-03 precision): a value exactly equal to a pool member gets EXACTLY that member's percentile, via toBe", () => {
    const pool = [10, 20, 30, 40, 50];
    const metrics: Record<string, TeamMetric> = { total: { value: 30 } };
    const sortedPools = new Map<string, number[]>([["total", pool]]);
    const result = withEventPercentiles(metrics, sortedPools);
    expect(result.total?.percentile).toBe(percentileAgainstSortedPool(pool, 30));
  });

  it("Test 11a (EVNT-02/EVNT-03 adjacency): two teams with exactly equal values receive the identical percentile", () => {
    const pool = [10, 20, 20, 40];
    const sortedPools = new Map<string, number[]>([["total", pool]]);
    const teamA = withEventPercentiles({ total: { value: 20 } }, sortedPools);
    const teamB = withEventPercentiles({ total: { value: 20 } }, sortedPools);
    expect(teamA.total?.percentile).toBe(teamB.total?.percentile);
  });

  it("Test 12 (PD-03, direct form): attaches a percentile to MORE metric names than HISTORY_PERCENTILE_METRIC_KEYS.length when the pool has all of them — the machine-checked form of the no-allowlist claim", () => {
    const metrics: Record<string, TeamMetric> = {
      total: { value: 50 },
      phaseAuto: { value: 10 },
      phaseTeleop: { value: 30 },
      phaseEndgame: { value: 10 },
      autoMobility: { value: 3 },
      teleopScoring: { value: 12 },
    };
    const sortedPools = new Map<string, number[]>(Object.keys(metrics).map((name) => [name, [1, 5, 50, 90]]));
    const result = withEventPercentiles(metrics, sortedPools);
    const withPercentileCount = Object.values(result).filter((m) => m.percentile !== undefined).length;
    expect(withPercentileCount).toBeGreaterThan(HISTORY_PERCENTILE_METRIC_KEYS.length);
  });
});

/**
 * Plan 07-09 Task 1 (D-10, Wave 0 case): the as-of-event value merged with
 * the season-final percentile, proven end-to-end from a seeded corpus to
 * published JSON bytes. `opr` is used throughout — its event-scoped fit
 * (D-01, headlines each team's MOST RECENT event) is what makes a genuinely
 * different as-of-event vs season-final value cheap to construct without
 * hand-tuning Sigma1/EPA's cross-match state evolution.
 */
describe("publishSeasons — D-10 as-of-event value + season-final percentile on published event artifacts (plan 07-09 Task 1)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-event-percentiles-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("Test 7 (Wave 0 D-10 case, non-vacuous): the early event publishes its as-of-event OPR value, distinct from the season-final value the late event publishes", async () => {
    const { earlyEventKey, lateEventKey, teamKeys } = seedTwoEventSeason(db);

    // (a) fixture-vacuity guard, asserted FIRST: replay independently, in-test.
    const stream = buildSeasonStream(db, 2026, {});
    const stateByEventKey = new Map<string, unknown>();
    const onMatchComplete = (match: MatchResult, _algorithmId: string, state: unknown): void => {
      stateByEventKey.set(match.eventKey, state);
    };
    const simulator = new WalkForwardSimulator(stream);
    const records = simulator.runAll([opr], teamKeys, undefined, onMatchComplete);
    const finalState = records.finalStates.get(opr.id);
    const seasonFinalMetrics = finalState !== undefined ? opr.teamMetrics(finalState as Parameters<typeof opr.teamMetrics>[0], teamKeys) : {};
    const earlyState = stateByEventKey.get(earlyEventKey);
    const asOfEarlyMetrics = earlyState !== undefined ? opr.teamMetrics(earlyState as Parameters<typeof opr.teamMetrics>[0], teamKeys) : {};

    const asOfEarlyEventValue = asOfEarlyMetrics["frc1"]?.[TOTAL_METRIC_KEY]?.value;
    const seasonFinalValue = seasonFinalMetrics["frc1"]?.[TOTAL_METRIC_KEY]?.value;
    expect(asOfEarlyEventValue, "fixture-vacuity guard: as-of-early-event and season-final OPR values must differ").not.toBe(seasonFinalValue);
    expect(asOfEarlyEventValue).toBeDefined();
    expect(seasonFinalValue).toBeDefined();

    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const earlyArtifact = findEventArtifact(earlyEventKey, "opr");
    const lateArtifact = findEventArtifact(lateEventKey, "opr");
    const earlyRow = earlyArtifact.teams.find((t) => t.teamKey === "frc1");
    const lateRow = lateArtifact.teams.find((t) => t.teamKey === "frc1");

    // Published `value` is rounded once at the publish boundary
    // (`roundTeamMetricRecord`, `ROUNDING_RULE.metric`) — round the
    // independently-replayed raw expectation the SAME way before comparing
    // against published JSON bytes, rather than comparing raw to rounded.
    const roundedAsOfEarlyEventValue = roundTo(asOfEarlyEventValue!, ROUNDING_RULE.metric);
    const roundedSeasonFinalValue = roundTo(seasonFinalValue!, ROUNDING_RULE.metric);

    // (b) the EARLY event's published artifact carries the as-of-early-event value.
    expect(earlyRow?.metrics.total?.value).toBe(roundedAsOfEarlyEventValue);
    // (c) it does NOT carry the season-final value.
    expect(earlyRow?.metrics.total?.value).not.toBe(roundedSeasonFinalValue);
    // (d) the LATER event's published artifact carries the season-final value.
    expect(lateRow?.metrics.total?.value).toBe(roundedSeasonFinalValue);
  });

  it("Test 8: the published percentile is ranked against the season-final pool, never the early event's own (smaller) roster", async () => {
    const { earlyEventKey, teamKeys } = seedTwoEventSeason(db);
    // Widen the season pool beyond the early event's own six-team roster:
    // two teams (frc7/frc8) that compete ONLY at the late event, so the
    // early event's own roster (six teams) and the season-final pool
    // (eight teams) provably differ in membership.
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026lat_qm3",
        eventKey: "2026lat",
        matchNumber: 3,
        sortTime: 12_000,
        redTeams: ["frc7", "frc2", "frc3"],
        blueTeams: ["frc8", "frc5", "frc6"],
        redScore: 115,
        blueScore: 95,
        winner: "red",
      })
    );

    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const earlyArtifact = findEventArtifact(earlyEventKey, "opr");
    const earlyRow = earlyArtifact.teams.find((t) => t.teamKey === "frc1")!;
    const publishedPercentile = earlyRow.metrics.total?.percentile;
    expect(publishedPercentile).toBeDefined();

    // Independently replay to compute both pools in-test.
    const stream = buildSeasonStream(db, 2026, {});
    const stateByEventKey = new Map<string, unknown>();
    const onMatchComplete = (match: MatchResult, _algorithmId: string, state: unknown): void => {
      stateByEventKey.set(match.eventKey, state);
    };
    const simulator = new WalkForwardSimulator(stream);
    const teamsThisSeason = Array.from(new Set(stream.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const records = simulator.runAll([opr], teamsThisSeason, undefined, onMatchComplete);
    const finalState = records.finalStates.get(opr.id);
    const seasonFinalMetrics =
      finalState !== undefined ? opr.teamMetrics(finalState as Parameters<typeof opr.teamMetrics>[0], teamsThisSeason) : {};
    const seasonFinalPool = sortedPoolsByMetric(seasonFinalMetrics, teamsThisSeason).get(TOTAL_METRIC_KEY)!;

    const earlyState = stateByEventKey.get(earlyEventKey);
    const asOfEarlyMetrics = earlyState !== undefined ? opr.teamMetrics(earlyState as Parameters<typeof opr.teamMetrics>[0], teamKeys) : {};
    const asOfEarlyValue = asOfEarlyMetrics["frc1"]![TOTAL_METRIC_KEY]!.value;

    const seasonFinalPoolPercentile = percentileAgainstSortedPool(seasonFinalPool, asOfEarlyValue);
    // The FORBIDDEN number: ranked against the early event's own roster alone.
    const eventRosterPool = sortedPoolsByMetric(asOfEarlyMetrics, teamKeys).get(TOTAL_METRIC_KEY)!;
    const eventRosterPoolPercentile = percentileAgainstSortedPool(eventRosterPool, asOfEarlyValue);

    expect(publishedPercentile).toBe(seasonFinalPoolPercentile);
    expect(publishedPercentile, "the published percentile must NOT equal the forbidden event-roster-ranked one").not.toBe(
      eventRosterPoolPercentile
    );
  });

  it("Test 9 (PD-04): an event with no completed matches publishes season-final metrics through the same merge, not an empty record", async () => {
    seedTwoEventSeason(db);
    upsertEvent(db, seasonEvent({ eventKey: "2026sch", name: "Scheduled Only" }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026sch_qm1",
        eventKey: "2026sch",
        matchNumber: 1,
        sortTime: 20_000,
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
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

    const schedArtifact = findEventArtifact("2026sch", "opr");
    const row = schedArtifact.teams.find((t) => t.teamKey === "frc1")!;
    expect(row.metrics).not.toEqual({});
    expect(row.metrics.total?.value).toBeDefined();
    expect(row.metrics.total?.percentile).toBeDefined();

    const lateArtifact = findEventArtifact("2026lat", "opr");
    const lateRow = lateArtifact.teams.find((t) => t.teamKey === "frc1")!;
    expect(row.metrics.total?.value).toBe(lateRow.metrics.total?.value);
  });

  it("Test 10 (UI-SPEC E3/E4 partial): a team the as-of-event state knows nothing about publishes metrics: {} — no fabricated value", async () => {
    const { earlyEventKey } = seedTwoEventSeason(db);
    upsertMatch(
      db,
      seasonMatch({
        matchKey: `${earlyEventKey}_qm3`,
        eventKey: earlyEventKey,
        matchNumber: 3,
        sortTime: 3_000,
        redTeams: ["frc1", "frc2", "frc9"],
        blueTeams: ["frc4", "frc5", "frc6"],
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

    const earlyArtifact = findEventArtifact(earlyEventKey, "opr");
    const row = earlyArtifact.teams.find((t) => t.teamKey === "frc9")!;
    expect(row).toBeDefined();
    expect(row.metrics).toEqual({});
  });

  it("Test 11b (EVNT-02/EVNT-03 ordering): the published teams array order is the caller's order, not a value-derived one", async () => {
    const { earlyEventKey } = seedTwoEventSeason(db);
    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });
    const earlyArtifact = findEventArtifact(earlyEventKey, "opr");
    // eventTeamKeys is Array.from(new Set([...match teams in chronological
    // order...])) inside publishSeasons — reproduced here from the
    // artifact's own matches (already in that same chronological order)
    // rather than hand-typed, so this cannot silently drift from production.
    const expectedOrder = Array.from(new Set(earlyArtifact.matches.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    expect(earlyArtifact.teams.map((t) => t.teamKey)).toEqual(expectedOrder);
  });
});

/**
 * Quick task 260905-tll Task 4: a minimal RP-modeling fake algorithm whose
 * predictions ENCODE its own state (`matchCount`), so which state priced a
 * sidecar is directly readable from the published pmf bytes. Registered
 * under the id "epa" deliberately: `publishSeasons`' compare step routes
 * every algorithm id through `selectedOnSeasonsFor`'s explicit registry,
 * which throws for an unregistered id — "epa"'s registered source is the
 * honest `() => []`, and this module never touches the real epa module
 * (publishSeasons uses the passed-in module directly).
 */
interface FakeRpState {
  matchCount: number;
}
const fakeRpAlgorithm: AlgorithmModule<FakeRpState> = {
  id: "epa",
  version: "9.9.9+presim-test",
  initState: () => ({ matchCount: 0 }),
  predict: (state) => {
    // 0.01 per completed match — exact at ROUNDING_RULE.pmf (5 decimals),
    // so roundPmf is the identity on these fixtures and the assertion below
    // compares published bytes to an exactly-representable expectation.
    const bonus = Math.min(0.4, state.matchCount * 0.01);
    return {
      winner: "red",
      pRedWin: 0.5,
      redScore: 50,
      blueScore: 50,
      redRpPmf: [1 - bonus, bonus],
      blueRpPmf: [1 - bonus, bonus],
    };
  },
  update: (state) => ({ matchCount: state.matchCount + 1 }),
  teamMetrics: (state, teams): TeamMetrics =>
    Object.fromEntries((teams ?? []).map((teamKey) => [teamKey, { total: { value: state.matchCount } }])),
};

describe("publishSeasons — pre-event walk-forward state, scheduleless events, and the presim sidecar (quick task 260905-tll Task 4)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-presim-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function findPresimCall(eventKey: string, algorithmId: string): [unknown, unknown, unknown, unknown] | undefined {
    return vi
      .mocked(putObject)
      .mock.calls.find(([, key]) => (key as string).startsWith(`v1/presim/${eventKey}/${algorithmId}@`)) as
      | [unknown, unknown, unknown, unknown]
      | undefined;
  }

  it("C-06/PD-02/PD-04: the later event's sidecar is priced from the PRE-event walk-forward state (the state after the earlier event's last match), never its post-event state — and the cold-start season's first event gets NO sidecar", async () => {
    seedTwoEventSeason(db);

    // 260912-2ur: the published body no longer carries the priced `schedules`
    // block, so C-06's provenance check can no longer read a match's `rp`
    // straight out of the published bytes (relocated from the pre-260912-2ur
    // version of this test, which asserted `artifact.schedules[0].matches[0]
    // .rp` against `preEventPmf`/`postEventPmf` literals). `fakeRpAlgorithm
    // .predict` encodes `state.matchCount` into its pmf, so recording every
    // call's `(matchKey, matchCount)` pair states the SAME fact — which
    // state priced every synthetic presim match — more directly than the old
    // byte assertion did, and it does not depend on the block being
    // published at all.
    const recordedPredictions: { matchKey: string; matchCount: number }[] = [];
    const recordingAlgorithm: AlgorithmModule<FakeRpState> = {
      ...fakeRpAlgorithm,
      predict: (state, match) => {
        recordedPredictions.push({ matchKey: match.matchKey, matchCount: state.matchCount });
        return fakeRpAlgorithm.predict(state, match);
      },
    };

    // Fixture-vacuity guard FIRST: the pre-event matchCount (after the early
    // event's two matches) and the post-event matchCount (after all four
    // matches across both events) must genuinely differ, or the assertion
    // below that every presim call saw the pre-event count proves nothing.
    const preEventMatchCount = 2;
    const postEventMatchCount = 4;
    expect(preEventMatchCount, "fixture-vacuity guard: pre- and post-event matchCount must differ").not.toBe(postEventMatchCount);

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [recordingAlgorithm],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
    });

    // The later event's sidecar exists, under the ONE key spelling.
    const call = findPresimCall("2026lat", "epa");
    expect(call, "expected a v1/presim/2026lat/epa@... putObject call").toBeDefined();
    expect(call![1]).toBe(preScheduleKey({ eventKey: "2026lat", algorithmId: "epa", version: "9.9.9+presim-test" }));

    // The proof obligation, on the RAW published bytes, before any schema
    // parse: no own `schedules` property, and `scheduleCount` is the real
    // 1,000 (PRESIM_SCHEDULE_COUNT, raised from 20 by quick task 260912-5hs)
    // — this and the 1,000 x 50 = 50,000 draws arithmetic below move together.
    const rawBody = JSON.parse(call![2] as string) as Record<string, unknown>;
    expect(Object.hasOwn(rawBody, "schedules")).toBe(false);
    expect(rawBody.scheduleCount).toBe(1000);

    // The body round-trips through the published sidecar schema (the
    // publish-boundary guarantee) and is priced from the PRE-event state.
    const artifact = PublishedPreScheduleArtifactSchema.parse(rawBody);
    expect(artifact.pricedFrom).toBe("pre-event-walk-forward");
    expect(artifact.roster).toEqual(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
    expect(artifact.baked.draws).toBe(50000); // 1,000 schedules x 50 draws — deliberately no longer the client's SIMULATION_DRAWS

    // C-06, restated at the seam that survives the block's removal: every
    // synthetic presim match for THIS event was priced at the pre-event
    // matchCount, never the post-event one.
    const presimRecordings = recordedPredictions.filter((r) => r.matchKey.startsWith("2026lat_presim"));
    expect(presimRecordings.length, "fixture-vacuity guard: at least one presim call must have been recorded").toBeGreaterThan(0);
    expect(
      presimRecordings.every((r) => r.matchCount === preEventMatchCount),
      "C-06: every synthetic presim match must be priced at the pre-event state, never the post-event state"
    ).toBe(true);
    expect(presimRecordings.some((r) => r.matchCount === postEventMatchCount)).toBe(false);

    // PD-04: the season's FIRST event has no exposable pre-event state under
    // a cold start — no sidecar, never a fabricated one.
    expect(findPresimCall("2026ear", "epa")).toBeUndefined();

    // Ordering: the sidecar is written BEFORE the same event's artifact.
    const calls = vi.mocked(putObject).mock.calls;
    const presimIndex = calls.findIndex(([, key]) => (key as string).startsWith("v1/presim/2026lat/"));
    const eventIndex = calls.findIndex(([, key]) => (key as string).startsWith("v1/event/2026lat/"));
    expect(presimIndex).toBeGreaterThanOrEqual(0);
    expect(eventIndex).toBeGreaterThanOrEqual(0);
    expect(presimIndex, "sidecar must be uploaded before the event artifact for the same event").toBeLessThan(eventIndex);
  });

  it("C-15/C-17: an event with event_teams rows and zero matches publishes a full event artifact — registered roster, non-empty (season-final fallback) metrics, empty matches/upcoming", async () => {
    seedTwoEventSeason(db); // gives frc1..frc6 real season play, so season-final metrics exist
    upsertEvent(db, seasonEvent({ eventKey: "2026reg", name: "Registered Only" }));
    // Inserted in reverse order deliberately: the published roster must be
    // sorted ascending, not corpus row order.
    upsertEventTeam(db, { eventKey: "2026reg", teamKey: "frc2", fetchedAt: "2026-09-05T00:00:00.000Z" });
    upsertEventTeam(db, { eventKey: "2026reg", teamKey: "frc1", fetchedAt: "2026-09-05T00:00:00.000Z" });

    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const artifact = findEventArtifact("2026reg", "opr");
    expect(artifact.teams.map((t) => t.teamKey)).toEqual(["frc1", "frc2"]);
    expect(artifact.matches).toEqual([]);
    expect(artifact.upcoming).toEqual([]);
    // metricsAsOfEvent's season-final fallback (PD-04 of plan 07-09) is
    // exactly the as-of-now metrics a pre-schedule page should show.
    expect(artifact.teams[0]?.metrics.total?.value).toBeDefined();
  });

  it("C-17 negative half: an event with neither matches nor registered teams is still skipped entirely", async () => {
    seedTwoEventSeason(db);
    upsertEvent(db, seasonEvent({ eventKey: "2026emp", name: "Empty Event" }));

    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });

    const emptyCall = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith("v1/event/2026emp/"));
    expect(emptyCall).toBeUndefined();
  });

  it("CR-03: an event whose schedule has landed but which has NOT started still gets a sidecar, priced from current state — never left serving a stale one", async () => {
    seedTwoEventSeason(db); // gives the algorithm real season-final state
    // A third event whose qualification schedule is posted but where not a
    // single match has been played. Before this fix the walk-forward branch
    // was entered (qualMatchCount > 0), found no pre-event state, and
    // SKIPPED — so any previously published sidecar kept serving unchanged
    // through the entire pre-event window, which is exactly when a reader
    // most wants this tab.
    upsertEvent(db, seasonEvent({ eventKey: "2026sch", name: "Scheduled Not Started" }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026sch_qm1",
        eventKey: "2026sch",
        matchNumber: 1,
        sortTime: 9_000,
        redTeams: ["frc1", "frc2", "frc3"],
        blueTeams: ["frc4", "frc5", "frc6"],
        redScore: null,
        blueScore: null,
        winner: null,
      })
    );

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [fakeRpAlgorithm],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
    });

    const call = findPresimCall("2026sch", "epa");
    expect(call, "a scheduled-but-unplayed event must still publish a sidecar").toBeDefined();
    const artifact = PublishedPreScheduleArtifactSchema.parse(JSON.parse(call![2] as string));
    // "Before the event" and "now" are the same state when no match of the
    // event has been played, so `current-state` is the honest label — and
    // it keeps regenerating every publish until the event actually starts.
    expect(artifact.pricedFrom).toBe("current-state");
  });

  it("C-05: preScheduleFromSeason is a real parameter — a cutoff above the season suppresses every sidecar", async () => {
    seedTwoEventSeason(db);

    await publishSeasons(db, {
      seasons: [2026],
      algorithms: [fakeRpAlgorithm],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
      preScheduleFromSeason: 2027,
    });

    const presimCall = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith("v1/presim/"));
    expect(presimCall).toBeUndefined();
  });
});

/**
 * Plan 07-09 Task 2, repointed 2026-09-09: this began as a source-text
 * stand-in because `runEventMode` was module-private and no behavior test of
 * it was possible. That premise is gone — the build half is now exported as
 * `buildSingleEventPublish` and the parity suites at the end of this file
 * exercise it against a real seeded corpus.
 *
 * What survives is worth keeping on its own terms, and is no longer a
 * stand-in for anything: the ONE-season-replay shape. `--event` must replay
 * the season exactly once — once because a per-event replay would give a team
 * no history from its earlier events (the wrong fix for the band/RP gap), and
 * only once because that replay is this path's whole cost.
 */
describe("--event replays the season exactly once — structural (plan 07-09 Task 2)", () => {
  const source = readFileSync(new URL("./publish.ts", import.meta.url), "utf8");
  const rangeMatch = /export function buildSingleEventPublish\b[\s\S]*?(?=\nasync function runEventMode\b)/.exec(source);

  it("its source range contains exactly one buildSeasonStream call, one sortedPoolsByMetric call, and one metricsAsOfEvent call", () => {
    expect(rangeMatch, "expected to find buildSingleEventPublish's source range").not.toBeNull();
    const body = rangeMatch![0];
    const count = (pattern: string) => (body.match(new RegExp(pattern, "g")) ?? []).length;
    expect(count("buildSeasonStream\\(")).toBe(1);
    // <!-- planner-discipline-allow: sortedPoolsByMetric -->
    expect(count("sortedPoolsByMetric\\(")).toBe(1);
    expect(count("metricsAsOfEvent\\(")).toBe(1);
  });
});

describe("buildCompareArtifact", () => {
  it("assembles a fixture that parses against CompareArtifactSchema without rounding scoring figures", () => {
    const slice: ScoreSlice = {
      algorithmId: "opr",
      season: 2025,
      headlineEligible: true,
      compLevelView: "combined",
      brierScore: 0.181234567,
      winnerAccuracy: 0.712345,
      scoredCount: 1000,
      tieCount: 0,
      noCallCount: 0,
      exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0, coldStart: 0 },
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

describe("buildCompareArtifact — rpCalibration attachment (F1/D-09/D-11, phase 09 plan 09-01 Task 1)", () => {
  function sliceFor(algorithmId: string, compLevelView: ScoreSlice["compLevelView"]): ScoreSlice {
    return {
      algorithmId,
      season: 2026,
      headlineEligible: true,
      compLevelView,
      brierScore: 0.18,
      winnerAccuracy: 0.72,
      scoredCount: 1000,
      tieCount: 0,
      noCallCount: 0,
      exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0, coldStart: 0 },
      candidateCount: 1000,
      calibrationBins: [],
    };
  }

  const MEASUREMENT: RpCalibrationMeasurement = {
    measuredAt: "2026-09-11T00:00:00.000Z",
    command: "npx tsx scripts/measureRpCalibration.ts --seasons 2026 --algorithm spr",
    corpusIdentity: "data/corpus.sqlite",
    offseasonIncluded: true,
    algorithmVersions: { spr: "3.0.0+baseline" },
    records: [
      {
        season: 2026,
        algorithmId: "spr",
        calibration: {
          scoredCount: 4,
          bonuses: [{ name: "energized", count: 4, meanPredicted: 0.123456789, observedFrequency: 0.987654321, brierScore: 0.111111111 }],
        },
      },
    ],
  };

  it("attaches the matching record onto the matching (algorithmId, season, qualification) slice, and onto NO other slice", () => {
    const artifact = buildCompareArtifact({
      algorithms: [{ id: "spr", version: "3.0.0+baseline" }, { id: "opr", version: "3.0.0+baseline" }],
      slices: [sliceFor("spr", "qualification"), sliceFor("spr", "elimination"), sliceFor("spr", "combined"), sliceFor("opr", "qualification")],
      generation: "g1",
      rpCalibration: MEASUREMENT,
    });
    const bprQual = artifact.slices.find((s) => s.algorithmId === "spr" && s.compLevelView === "qualification");
    const bprElim = artifact.slices.find((s) => s.algorithmId === "spr" && s.compLevelView === "elimination");
    const bprCombined = artifact.slices.find((s) => s.algorithmId === "spr" && s.compLevelView === "combined");
    const oprQual = artifact.slices.find((s) => s.algorithmId === "opr" && s.compLevelView === "qualification");
    expect(bprQual?.rpCalibration).toBeDefined();
    expect(bprElim?.rpCalibration).toBeUndefined();
    expect(bprCombined?.rpCalibration).toBeUndefined();
    expect(oprQual?.rpCalibration).toBeUndefined();
  });

  it("rounds attached figures to six decimal places at the attach boundary — the measurement file itself is untouched", () => {
    const artifact = buildCompareArtifact({
      algorithms: [{ id: "spr", version: "3.0.0+baseline" }],
      slices: [sliceFor("spr", "qualification")],
      generation: "g1",
      rpCalibration: MEASUREMENT,
    });
    const attached = artifact.slices.find((s) => s.algorithmId === "spr" && s.compLevelView === "qualification")?.rpCalibration;
    expect(attached?.bonuses[0]?.meanPredicted).toBe(0.123457);
    expect(attached?.bonuses[0]?.observedFrequency).toBe(0.987654);
    expect(attached?.bonuses[0]?.brierScore).toBe(0.111111);
    // The source measurement's own figures are untouched by rounding.
    expect(MEASUREMENT.records[0]?.calibration.bonuses[0]?.meanPredicted).toBe(0.123456789);
  });

  it("rpCalibration undefined (no committed baseline yet) is a no-op over every slice", () => {
    const artifact = buildCompareArtifact({
      algorithms: [{ id: "spr", version: "3.0.0+baseline" }],
      slices: [sliceFor("spr", "qualification")],
      generation: "g1",
    });
    expect(artifact.slices[0]?.rpCalibration).toBeUndefined();
  });
});

describe("loadRpCalibrationMeasurement (T-09-03)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rp-calibration-measurement-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined when the path does not exist", () => {
    expect(loadRpCalibrationMeasurement(join(dir, "nope.json"))).toBeUndefined();
  });

  it("throws a NAMED error — never a silent undefined — when the path exists but is not valid JSON", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{not json", "utf8");
    expect(() => loadRpCalibrationMeasurement(path)).toThrow(/loadRpCalibrationMeasurement/);
  });

  it("throws a NAMED error when the path exists but does not match RpCalibrationMeasurementSchema", () => {
    const path = join(dir, "wrong-shape.json");
    writeFileSync(path, JSON.stringify({ hello: "world" }), "utf8");
    expect(() => loadRpCalibrationMeasurement(path)).toThrow(/loadRpCalibrationMeasurement/);
  });

  it("reads and validates a real committed-shape measurement file", () => {
    const path = join(dir, "measurement.json");
    writeFileSync(
      path,
      JSON.stringify({
        measuredAt: "2026-09-11T00:00:00.000Z",
        command: "npx tsx scripts/measureRpCalibration.ts",
        corpusIdentity: "data/corpus.sqlite",
        offseasonIncluded: true,
        algorithmVersions: { spr: "3.0.0+baseline" },
        records: [],
      }),
      "utf8"
    );
    const loaded = loadRpCalibrationMeasurement(path);
    expect(loaded?.algorithmVersions).toEqual({ spr: "3.0.0+baseline" });
    expect(loaded?.records).toEqual([]);
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
      videoKey: null,
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

describe("parseSeasonsRange — gapped list form (quick task 260904-nt4)", () => {
  it("a single year is unchanged", () => {
    expect(parseSeasonsRange("2026")).toEqual([2026]);
  });

  it("a contiguous range is unchanged", () => {
    expect(parseSeasonsRange("2022-2026")).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it("a comma-separated list of single years and ranges parses to the gapped seven-season corpus", () => {
    expect(parseSeasonsRange("2019,2020,2022-2026")).toEqual([2019, 2020, 2022, 2023, 2024, 2025, 2026]);
  });

  it("terms out of order and repeated collapse to the same ascending, de-duplicated result", () => {
    expect(parseSeasonsRange("2026,2019,2022-2026,2020,2019")).toEqual([2019, 2020, 2022, 2023, 2024, 2025, 2026]);
  });

  it("a malformed term throws and the message names both the range form and the list form", () => {
    expect(() => parseSeasonsRange("2019,not-a-year,2022-2026")).toThrowError(/single year like "2026"|range like "2022-2026"/);
  });

  it("a term whose end precedes its start still throws", () => {
    expect(() => parseSeasonsRange("2026-2019")).toThrowError(/must be >= start/);
  });

  it("an empty spec throws", () => {
    expect(() => parseSeasonsRange("")).toThrowError(/must not be empty/);
  });

  // Quick task 260907-203 WIDENED this expectation from the seven-season
  // corpus to the ten-season one, deliberately rather than to make a red go
  // green: the corpus itself grew backwards (2016/2017/2018 ingested and
  // registered in every algorithm registry), and `package.json`'s
  // `publish:seasons` was re-spelled `2016-2020,2022-2026` in the same task
  // so the publisher actually covers what exists. This tripwire's JOB is to
  // fail when the script and the real corpus disagree, so the season list
  // here must track the corpus — what must NOT be weakened is the exact
  // equality (never a `toContain`/length check), and it is not: 2021 is still
  // absent, and a contiguous `2016-2026` in the script would fail this line.
  it("the script/parser drift tripwire: package.json's publish:seasons --seasons argument parses to exactly the ten-season corpus", () => {
    const packageJsonRaw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(packageJsonRaw) as { scripts: Record<string, string> };
    const script = pkg.scripts["publish:seasons"];
    expect(script, "publish:seasons script must exist in package.json").toBeDefined();

    const match = /--seasons\s+(\S+)/.exec(script!);
    expect(match, `--seasons argument not found in publish:seasons script: ${script}`).not.toBeNull();

    const parsed = parseSeasonsRange(match![1]!);
    expect(parsed).toEqual([2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]);
    expect(parsed, "2021 is a permanent exclusion — the at-home season has no conventional 3v3 matches").not.toContain(2021);
  });

  // Plan 09-10 Task 1, Step 2 — the presim-flag drift tripwire, sibling to the
  // `--seasons` one immediately above: same `package.json` read, same
  // "script must exist" guard, same regex-then-assert shape, different argument.
  //
  // WHY THIS EXISTS, recorded so it is never weakened into a formality. Commit
  // `1a759198` set `publish:seasons`' `--presim-from-season` to the far-future
  // sentinel `9999` while the simulation/swing rethink iterated. A cutoff above
  // every season in the corpus makes `presimEnabled` (`publish.ts`'s
  // `season >= preScheduleFromSeason`) false for EVERY season, so each run
  // logged a "below presim-from-season" skip per season and wrote zero
  // sidecars. That value stayed committed through at least three full publish
  // runs — roughly forty-five minutes and a complete R2 write pass each — and
  // NO test noticed, because the only committed assertions over this script
  // string read its `--seasons` argument. The pre-schedule stop was dark the
  // whole time while every run reported success.
  //
  // The assertion is deliberately a RELATION, not a literal year: the cutoff
  // must be at most the latest season the same script says it publishes. That
  // makes the two arguments move together (widen the corpus, the bound widens
  // with it) while still failing loudly on any value that disables generation
  // by sitting in the far future. A hardcoded `2026` here would go stale the
  // day 2027 is ingested and invite exactly the weakening this comment exists
  // to prevent.
  it("the presim-flag drift tripwire: package.json's publish:seasons --presim-from-season is an integer year no later than the latest season it publishes", () => {
    const packageJsonRaw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(packageJsonRaw) as { scripts: Record<string, string> };
    const script = pkg.scripts["publish:seasons"];
    expect(script, "publish:seasons script must exist in package.json").toBeDefined();

    const presimMatch = /--presim-from-season\s+(\S+)/.exec(script!);
    expect(
      presimMatch,
      `--presim-from-season argument not found in publish:seasons script: ${script}. ` +
        `The flag is kept with an EXPLICIT value on purpose (09-10 Task 1): the value is Claude's ` +
        `Discretion under 09-CONTEXT.md, so an explicit year is a recorded decision while a deletion ` +
        `is a silent fallback to DEFAULT_PRESCHEDULE_FROM_SEASON — and this tripwire needs something ` +
        `to assert equality against rather than an absence.`
    ).not.toBeNull();

    const presimFromSeason = Number.parseInt(presimMatch![1]!, 10);
    expect(
      Number.isInteger(presimFromSeason),
      `--presim-from-season must be an integer year, got "${presimMatch![1]}"`
    ).toBe(true);

    const seasonsMatch = /--seasons\s+(\S+)/.exec(script!);
    expect(seasonsMatch, `--seasons argument not found in publish:seasons script: ${script}`).not.toBeNull();
    const publishedSeasons = parseSeasonsRange(seasonsMatch![1]!);
    const latestPublishedSeason = Math.max(...publishedSeasons);

    expect(
      presimFromSeason,
      `--presim-from-season is ${presimFromSeason}, later than the latest season this same script ` +
        `publishes (${latestPublishedSeason}). A cutoff above every season in the corpus makes ` +
        `publish.ts's \`season >= preScheduleFromSeason\` gate false for EVERY season: the run logs a ` +
        `"below presim-from-season" skip per season, writes ZERO pre-schedule sidecars, and still ` +
        `reports success. That is exactly what commit 1a759198's \`9999\` did for three full publish ` +
        `runs, leaving the Simulation tab's pre-schedule stop dark site-wide. If presim generation is ` +
        `being switched off deliberately, remove the flag and record why — do not park it in the future.`
    ).toBeLessThanOrEqual(latestPublishedSeason);
  });

  // Kept on the literal seven-season spec (NOT re-pointed at package.json):
  // this case is about `seasonBoundaryFor`'s arithmetic across a one-season
  // hole, and `2019,2020,2022-2026` is the minimal spec that exhibits one.
  // The ten-season corpus has the identical single hole, so widening it here
  // would add eight boundary rows that prove nothing new.
  it("the gapped-boundary proof: over the parsed seven-season list, seasonBoundaryFor reports a two-year gap entering 2022, a one-year gap everywhere else, and a positional cold start only at index 0 (2019)", () => {
    const seasons = parseSeasonsRange("2019,2020,2022-2026");
    const boundaries = seasons.map((_, index) => seasonBoundaryFor(seasons, index));

    const gaps = boundaries.map((b) => b.toSeason - b.fromSeason);
    // index 0 (2019) has no real predecessor — its nominal `fromSeason` is
    // 2018, a gap of 1, but isColdStart is what actually matters there.
    expect(gaps).toEqual([1, 1, 2, 1, 1, 1, 1]);
    expect(boundaries[2]).toMatchObject({ fromSeason: 2020, toSeason: 2022, isColdStart: false });

    const coldStarts = boundaries.map((b) => b.isColdStart);
    expect(coldStarts).toEqual([true, false, false, false, false, false, false]);
  });
});

describe("publishSeasons — EPA carries from the last official match (quick task 260908-615)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-carry-instant-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Season A: one official event, then chronologically LATER an offseason
   * event whose scores are a lopsided blowout — the exact shape that used to
   * seed the next season's prior. Season B: one official event.
   *
   * The assertion is a real numeric discrimination, not a tautology: both
   * candidate priors are recomputed here from `WalkForwardSimulator` directly
   * (one threaded from the post-official-match state, one from the
   * season-final state), and the published season-B metric must match the
   * former and NOT the latter.
   */
  function seedTwoSeasons(): void {
    upsertEvent(db, seasonEvent({ eventKey: "2025off1", year: 2025, eventType: 0, name: "Official A" }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2025off1_qm1",
        eventKey: "2025off1",
        sortTime: 1_000,
        redScore: 100,
        blueScore: 80,
        winner: "red",
      })
    );

    upsertEvent(
      db,
      seasonEvent({
        eventKey: "2025ex",
        year: 2025,
        eventType: OFFSEASON_EVENT_TYPE,
        isOffseason: true,
        name: "Exhibition Blowout",
      })
    );
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2025ex_qm1",
        eventKey: "2025ex",
        sortTime: 9_000,
        redScore: 400,
        blueScore: 5,
        winner: "red",
      })
    );

    upsertEvent(db, seasonEvent({ eventKey: "2026off1", year: 2026, eventType: 0, name: "Official B" }));
    upsertMatch(
      db,
      seasonMatch({
        matchKey: "2026off1_qm1",
        eventKey: "2026off1",
        sortTime: 20_000,
        redScore: 90,
        blueScore: 85,
        winner: "red",
      })
    );
  }

  /** Replays season B from a prior taken at the given instant, returning frc1's published `total`. */
  function seasonBTotalFromInstant(instant: "carry" | "final"): number {
    const streamA = buildSeasonStream(db, 2025, { includeOffseason: true });
    const teamsA = Array.from(new Set(streamA.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const recordsA = new WalkForwardSimulator(streamA).runAll([epa], teamsA);
    const priorState = instant === "carry" ? recordsA.carryStates.get(epa.id) : recordsA.finalStates.get(epa.id);

    const boundary = seasonBoundaryFor([2025, 2026], 1);
    const carried = epa.carrySeason!(priorState as never, boundary);

    const streamB = buildSeasonStream(db, 2026, { includeOffseason: true });
    const teamsB = Array.from(new Set(streamB.flatMap((m) => [...m.redTeams, ...m.blueTeams])));
    const recordsB = new WalkForwardSimulator(streamB).runAll([epa], teamsB, new Map([[epa.id, carried]]));
    return epa.teamMetrics(recordsB.finalStates.get(epa.id) as never)["frc1"]![TOTAL_METRIC_KEY]!.value;
  }

  it("season B's published EPA matches a replay threaded from the post-official-match state, NOT from the season-final state", async () => {
    seedTwoSeasons();

    const expectedFromCarry = seasonBTotalFromInstant("carry");
    const expectedFromFinal = seasonBTotalFromInstant("final");

    // Guard the guard: if the offseason blowout did not actually move the
    // prior, this test would pass vacuously no matter which instant shipped.
    expect(
      Math.abs(expectedFromCarry - expectedFromFinal),
      "the seeded offseason blowout must move the season-B prior, or this test proves nothing"
    ).toBeGreaterThan(0.5);

    await publishSeasons(db, {
      seasons: [2025, 2026],
      algorithms: [epa],
      bucket: "test-bucket",
      dryRun: false,
      skipState: true,
      includeOffseason: true,
    });

    const artifact = findTeamArtifact("frc1", 2026);
    const publishedTotal = artifact.seasonStats.metrics[TOTAL_METRIC_KEY]!.value;

    // The published value carries D-06's display rounding, so both candidates
    // are rounded the same way before comparison — the discrimination above
    // (> 0.5 apart) is far coarser than this rule's 2 decimals, so rounding
    // cannot collapse the two instants into each other.
    expect(publishedTotal).toBe(roundTo(expectedFromCarry, ROUNDING_RULE.metric));
    expect(publishedTotal).not.toBe(roundTo(expectedFromFinal, ROUNDING_RULE.metric));
  });
});

describe("SigmaScout-layer swing band (quick task 260908-5wd)", () => {
  // The guarantee this task exists to provide: one match, ONE shared
  // PredictionRecord, and therefore the SAME band on an event page and a team
  // page. Both builders are handed the identical object here, exactly as
  // publishSeasons hands them the identical object.
  it("publishes a byte-identical band on the event artifact and the team artifact from one shared record", () => {
    const match = fixtureMatch();
    const prediction = fixturePrediction();
    const shared: PredictionRecord = { match, prediction, swingBand: { red: 812.3456789, blue: 640.1234567 } };

    const eventArtifact = buildEventArtifact({
      eventKey: "2026casj",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "4.0.0+baseline",
      predictions: [shared],
      generation: "g1",
      computedAt: "2026-09-08T00:00:00.000Z",
    });
    const teamArtifact = buildTeamSeasonArtifact({
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "4.0.0+baseline",
      seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 10 } }, metricsBasis: "last-official-match" },
      events: [{ eventKey: "2026casj", eventName: "2026casj", startDate: "2026-03-01", matches: [shared] }],
      metricHistory: [],
      generation: "g1",
      computedAt: "2026-09-08T00:00:00.000Z",
    });

    const eventRow = eventArtifact.matches[0];
    const teamRow = teamArtifact.events[0]?.matches[0];
    expect(eventRow?.redSwingBandVariance).toBe(teamRow?.redSwingBandVariance);
    expect(eventRow?.blueSwingBandVariance).toBe(teamRow?.blueSwingBandVariance);
    // Rounded once, at ROUNDING_RULE.variance (4dp), on both surfaces.
    expect(eventRow?.redSwingBandVariance).toBe(812.3457);
    expect(eventRow?.blueSwingBandVariance).toBe(640.1235);
  });

  it("omits the band keys entirely for a record with no swingBand — absent on the wire, never present-and-undefined", () => {
    const artifact = buildEventArtifact({
      eventKey: "2026casj",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "4.0.0+baseline",
      predictions: [{ match: fixtureMatch(), prediction: fixturePrediction() }],
      generation: "g1",
      computedAt: "2026-09-08T00:00:00.000Z",
    });
    expect(artifact.matches[0]).not.toHaveProperty("redSwingBandVariance");
    expect(artifact.matches[0]).not.toHaveProperty("blueSwingBandVariance");
  });

  it("builds an upcoming row's band from the season-final swing map, and omits it when a roster member has none", () => {
    const upcomingMatch = fixtureUpcoming();
    const full = new Map([...upcomingMatch.redTeams, ...upcomingMatch.blueTeams].map((t) => [t, 10] as const));
    const withBand = buildEventArtifact({
      eventKey: "2026casj",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "4.0.0+baseline",
      predictions: [],
      upcoming: [{ match: upcomingMatch, prediction: fixturePrediction() }],
      swingByTeam: full,
      generation: "g1",
      computedAt: "2026-09-08T00:00:00.000Z",
    });
    // Three members at 10 each -> variance 300.
    expect(withBand.upcoming[0]?.redSwingBandVariance).toBe(300);

    const partial = new Map(full);
    partial.delete(upcomingMatch.redTeams[0] as string);
    const withoutBand = buildEventArtifact({
      eventKey: "2026casj",
      season: 2026,
      algorithmId: "opr",
      algorithmVersion: "4.0.0+baseline",
      predictions: [],
      upcoming: [{ match: upcomingMatch, prediction: fixturePrediction() }],
      swingByTeam: partial,
      generation: "g1",
      computedAt: "2026-09-08T00:00:00.000Z",
    });
    expect(withoutBand.upcoming[0]).not.toHaveProperty("redSwingBandVariance");
    // The blue alliance is untouched by red's gap.
    expect(withoutBand.upcoming[0]?.blueSwingBandVariance).toBe(300);
  });

  it("publishes the per-team Swing Factor on the team artifact, rounded once, absent when the team has none", () => {
    const base = {
      teamKey: "frc254",
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      season: 2026,
      algorithmId: "opr" as const,
      algorithmVersion: "4.0.0+baseline",
      seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 10 } }, metricsBasis: "last-official-match" as const },
      events: [],
      metricHistory: [],
      generation: "g1",
      computedAt: "2026-09-08T00:00:00.000Z",
    };
    expect(buildTeamSeasonArtifact({ ...base, swingFactor: 12.3456 }).swingFactor).toBe(12.35);
    expect(buildTeamSeasonArtifact(base)).not.toHaveProperty("swingFactor");
  });
});

/**
 * The two orchestrations in `publish.ts` must agree.
 *
 * `publishSeasons` and `--event` (`buildSingleEventPublish`) both write
 * `v1/event/{eventKey}/{algorithmId}@...`, and for a day they disagreed: the
 * level-2 SigmaScout fields — the Match Band and ranking points — were added to
 * `publishSeasons`'s loop only, so republishing an event with `--event`
 * silently STRIPPED both from it until the next full publish.
 *
 * These tests exist because nothing else could catch that. Every unit test
 * passed while it was true, and a `--dry-run` byte count cannot see a missing
 * field. The fixture deliberately spans TWO events over the same six teams, so
 * the late event's band depends on history from the early one — an `--event`
 * path that replayed only its own event would produce different numbers here
 * and fail, which is the specific wrong fix this pins against.
 */
describe("publishSeasons and --event agree on the SigmaScout layer (2026-09-09)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-two-path-parity-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits a band at all on the late event — the precondition the parity assertions below rest on", async () => {
    const { lateEventKey } = seedTwoEventSeason(db);
    await publishSeasons(db, { seasons: [2026], algorithms: [spr], bucket: "test-bucket", dryRun: false, skipState: true });

    const fromSeasons = findEventArtifact(lateEventKey, spr.id);
    const banded = fromSeasons.matches.filter((m) => m.redSwingBandVariance !== undefined);
    expect(banded.length, "seasons path publishes at least one banded row on the late event").toBeGreaterThan(0);
  });

  it("--event publishes the SAME band on every played row as the full seasons publish", async () => {
    const { lateEventKey } = seedTwoEventSeason(db);
    await publishSeasons(db, { seasons: [2026], algorithms: [spr], bucket: "test-bucket", dryRun: false, skipState: true });
    const fromSeasons = findEventArtifact(lateEventKey, spr.id);

    const fromEvent = JSON.parse(buildSingleEventPublish(db, lateEventKey, spr).body) as EventArtifact;

    expect(fromEvent.matches.map((m) => m.matchKey)).toEqual(fromSeasons.matches.map((m) => m.matchKey));
    for (const seasonsRow of fromSeasons.matches) {
      const eventRow = fromEvent.matches.find((m) => m.matchKey === seasonsRow.matchKey);
      expect(eventRow?.redSwingBandVariance, `red band on ${seasonsRow.matchKey}`).toBe(seasonsRow.redSwingBandVariance);
      expect(eventRow?.blueSwingBandVariance, `blue band on ${seasonsRow.matchKey}`).toBe(seasonsRow.blueSwingBandVariance);
    }
  });

  it("--event publishes the same ranking-point fields as the full seasons publish", async () => {
    const { lateEventKey } = seedTwoEventSeason(db);
    await publishSeasons(db, { seasons: [2026], algorithms: [spr], bucket: "test-bucket", dryRun: false, skipState: true });
    const fromSeasons = findEventArtifact(lateEventKey, spr.id);

    const fromEvent = JSON.parse(buildSingleEventPublish(db, lateEventKey, spr).body) as EventArtifact;

    for (const seasonsRow of fromSeasons.matches) {
      const eventRow = fromEvent.matches.find((m) => m.matchKey === seasonsRow.matchKey);
      expect(eventRow?.redRpPmf, `redRpPmf on ${seasonsRow.matchKey}`).toEqual(seasonsRow.redRpPmf);
      expect(eventRow?.blueRpPmf, `blueRpPmf on ${seasonsRow.matchKey}`).toEqual(seasonsRow.blueRpPmf);
      expect(eventRow?.redBonusRp, `redBonusRp on ${seasonsRow.matchKey}`).toEqual(seasonsRow.redBonusRp);
      expect(eventRow?.blueBonusRp, `blueBonusRp on ${seasonsRow.matchKey}`).toEqual(seasonsRow.blueBonusRp);
    }
  });

  it("agrees for OPR too — the layer is algorithm-independent, so parity cannot be a BPR-only property", async () => {
    const { lateEventKey } = seedTwoEventSeason(db);
    await publishSeasons(db, { seasons: [2026], algorithms: [opr], bucket: "test-bucket", dryRun: false, skipState: true });
    const fromSeasons = findEventArtifact(lateEventKey, opr.id);

    const fromEvent = JSON.parse(buildSingleEventPublish(db, lateEventKey, opr).body) as EventArtifact;

    for (const seasonsRow of fromSeasons.matches) {
      const eventRow = fromEvent.matches.find((m) => m.matchKey === seasonsRow.matchKey);
      expect(eventRow?.redSwingBandVariance, `red band on ${seasonsRow.matchKey}`).toBe(seasonsRow.redSwingBandVariance);
      expect(eventRow?.redRpPmf, `redRpPmf on ${seasonsRow.matchKey}`).toEqual(seasonsRow.redRpPmf);
    }
  });
});

/**
 * The presim sidecar is the THIRD thing `--event` dropped, and the one with
 * the most visible consequence: the rank simulation reads it, so a `--event`
 * republish left that event's Simulation tab with no ranking points to draw
 * until the next full publish.
 */
describe("publishSeasons and --event agree on the presim sidecar (2026-09-09)", () => {
  let dir: string;
  let db: Corpus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sigmascout-publish-sidecar-parity-"));
    db = openCorpus(join(dir, "corpus.sqlite"));
    vi.mocked(putObject).mockClear();
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("both paths write a sidecar carrying ranking points for the same event", async () => {
    const { lateEventKey } = seedTwoEventSeason(db);
    await publishSeasons(db, { seasons: [2026], algorithms: [spr], bucket: "test-bucket", dryRun: false, skipState: true });

    const seasonsCall = vi.mocked(putObject).mock.calls.find(([, key]) => (key as string).startsWith(`v1/presim/${lateEventKey}/${spr.id}@`));
    expect(seasonsCall, "seasons path writes a presim sidecar for the late event").toBeDefined();
    // 260912-2ur: this test's subject is builder determinism across the two
    // publish paths, and it must survive the published body dropping the
    // priced `schedules` block — neither path hands back anything BUT a
    // published body anymore, so the literal `schedules` comparison this
    // test used before is no longer available from either side. Widened
    // instead to compare everything the published body now carries.
    type Sidecar = {
      roster: string[];
      pricedFrom: string;
      matchesPerTeam: number;
      scheduleCount: number;
      baked: { draws: number; histograms: number[][] };
      generation: string;
      computedAt: string;
    };
    const fromSeasons = JSON.parse(seasonsCall![2] as string) as Sidecar;

    const sidecar = buildSingleEventPublish(db, lateEventKey, spr).sidecar;
    expect(sidecar, "--event writes a presim sidecar for the same event").toBeDefined();
    const fromEvent = JSON.parse(sidecar!.body) as Sidecar;

    // Non-vacuity guard: the fixture must actually produce something to
    // compare, or the `toEqual` below would pass over two empty shells.
    expect(fromSeasons.scheduleCount, "the fixture produces a real schedule count to compare").toBeGreaterThan(0);
    const histogramTotal = fromSeasons.baked.histograms.flat().reduce((total, count) => total + count, 0);
    expect(histogramTotal, "the fixture produces a non-zero baked histogram total to compare").toBeGreaterThan(0);

    // `generation`/`computedAt` are deliberately excluded — they identify the
    // RUN, not the numbers. Everything else — roster, pricedFrom,
    // matchesPerTeam, scheduleCount, baked.draws and baked.histograms — is
    // compared. The histograms are a deterministic function of the priced
    // schedules under a seeded `mulberry32`, so a divergence in pricing
    // state or shuffle between the two paths still fails this test even
    // though the priced schedules themselves are no longer on the wire to
    // compare directly.
    const { generation: _seasonsGeneration, computedAt: _seasonsComputedAt, ...seasonsRest } = fromSeasons;
    const { generation: _eventGeneration, computedAt: _eventComputedAt, ...eventRest } = fromEvent;
    expect(eventRest).toEqual(seasonsRest);
  });
});

describe("buildCompareArtifact — one write path (F1/D-09/D-11, phase 09 plan 09-01 Task 2 Step 4)", () => {
  it("every buildCompareArtifact({ call site in publish.ts passes an rpCalibration argument — a second call site added later cannot silently omit it", () => {
    const source = readFileSync(new URL("./publish.ts", import.meta.url), "utf8");
    const callSiteCount = (source.match(/buildCompareArtifact\(\{/g) ?? []).length;
    expect(callSiteCount, "expected at least one buildCompareArtifact({ call site").toBeGreaterThan(0);
    // Each call site's own object literal, from its `buildCompareArtifact({`
    // opener to its closing `});`, must contain an `rpCalibration:` key.
    const callSites = [...source.matchAll(/buildCompareArtifact\(\{[\s\S]*?\n\s*\}\);/g)];
    expect(callSites).toHaveLength(callSiteCount);
    for (const callSite of callSites) {
      expect(callSite[0]).toMatch(/rpCalibration:/);
    }
  });
});

describe("data/baselines/rp-calibration-2026-09.json — the committed D-09 'before' baseline (phase 09 plan 09-01 Task 2)", () => {
  const measurement = existsSync(RP_CALIBRATION_MEASUREMENT_PATH) ? loadRpCalibrationMeasurement(RP_CALIBRATION_MEASUREMENT_PATH) : undefined;

  if (measurement === undefined) {
    it.skip(`skipped: ${RP_CALIBRATION_MEASUREMENT_PATH} does not exist yet — run scripts/measureRpCalibration.ts with --emit-artifact first`, () => {});
  } else {
    it("covers the FULL cross product of every registered RP season and every published algorithm — pinned by set equality, never a loop over a hand-typed list", () => {
      const expected = new Set(Object.keys(RP_RULE_MODULES).flatMap((season) => PUBLISHED_ALGORITHM_IDS.map((a) => `${season}:${a}`)));
      const actual = new Set(measurement.records.map((r) => `${r.season}:${r.algorithmId}`));
      expect(actual).toEqual(expected);
    });

    it("every record's bonuses are in the season module's OWN bonusNames order, and cover every bonus", () => {
      for (const record of measurement.records) {
        const ruleModule = RP_RULE_MODULES[record.season]!;
        expect(record.calibration.bonuses.map((b) => b.name)).toEqual([...ruleModule.bonusNames]);
        expect(record.calibration.bonuses).toHaveLength(ruleModule.bonusNames.length);
      }
    });

    it("was measured with offseasonIncluded: true, recorded rather than silently altered", () => {
      expect(measurement.offseasonIncluded).toBe(true);
    });
  }
});

describe("RP calibration wire-budget cost (F1/D-09/D-11, phase 09 plan 09-01 Task 2 Step 5)", () => {
  const measurement = existsSync(RP_CALIBRATION_MEASUREMENT_PATH) ? loadRpCalibrationMeasurement(RP_CALIBRATION_MEASUREMENT_PATH) : undefined;
  const COMPARE_FIXTURE_YEARS = [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];

  if (measurement === undefined) {
    it.skip(`skipped: ${RP_CALIBRATION_MEASUREMENT_PATH} does not exist yet`, () => {});
  } else {
    it("attaching the real committed measurement onto every committed compare-{year}.json fixture stays under docs/publish-budget.md's committed compare budgetMaxBytes", () => {
      const budgetDoc = readFileSync(join("docs", "publish-budget.md"), "utf8");
      const budgetMatch = /```json budget\r?\n([\s\S]*?)\r?\n```/.exec(budgetDoc);
      expect(budgetMatch, "docs/publish-budget.md must carry a fenced ```json budget block").not.toBeNull();
      const budget = JSON.parse(budgetMatch![1]!) as { pages: Record<string, { budgetMaxBytes: number }> };
      const compareBudgetMaxBytes = budget.pages.compare?.budgetMaxBytes;
      expect(typeof compareBudgetMaxBytes).toBe("number");

      let largest = 0;
      let largestYear = 0;
      for (const year of COMPARE_FIXTURE_YEARS) {
        const fixturePath = join("apps", "web", "src", "routes", "__fixtures__", `compare-${year}.json`);
        const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as CompareArtifact;
        const slicesWithRp = attachRpCalibration(fixture.slices as unknown as ScoreSlice[], measurement);
        const withRp = { ...fixture, slices: slicesWithRp };
        const bytes = Buffer.byteLength(JSON.stringify(withRp), "utf8");
        if (bytes > largest) {
          largest = bytes;
          largestYear = year;
        }
        expect(
          bytes,
          `compare-${year}.json + rpCalibration (${bytes} bytes) exceeded the committed compare budgetMaxBytes (${compareBudgetMaxBytes})`
        ).toBeLessThanOrEqual(compareBudgetMaxBytes!);
      }
      // Reported for the SUMMARY — the largest post-attach size against the committed ceiling.
      console.log(`RP calibration wire-budget: largest post-attach compare artifact is ${largest} bytes (compare-${largestYear}.json), ceiling ${compareBudgetMaxBytes}`);
    });
  }
});
