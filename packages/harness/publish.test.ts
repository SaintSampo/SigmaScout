/**
 * Assembly-level coverage for plan 04-04's widened `publish.ts` (T-04-22:
 * every assembly function parses through its Zod schema before returning,
 * so a validation failure occurs before any upload could possibly be
 * attempted). All fixtures are small, in-memory, hand-built objects — no
 * network, no corpus. The real full 2022-2026 run is recorded in the
 * SUMMARY, not re-run on every `pnpm test`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchResult, Prediction, TeamMetric, UpcomingMatch } from "../core/algorithms/types.js";
import { TOTAL_METRIC_KEY } from "../core/algorithms/types.js";
import { opr } from "../core/algorithms/opr.js";
import { epa } from "../core/algorithms/epa.js";
// Renamed by plan 07-16's full-repo sweep (wave 11, D-04/D-05): this file's
// own `publish.ts` importer now imports the published `vpr` registry entry
// under its post-rename name.
import { vpr } from "../core/algorithms/sigma1/index.js";
import type { CorpusEvent, CorpusMatch } from "../ingest/normalize.js";
import {
  openCorpus,
  openCorpusReadOnly,
  selectScheduledMatches,
  upsertEvent,
  upsertEventAlliance,
  upsertEventRanking,
  upsertMatch,
  upsertTeam,
  upsertTeamMedia,
  type Corpus,
} from "../corpus/db.js";
import { buildSeasonStream, WalkForwardSimulator, type PredictionRecord } from "./replay.js";
import type { EventArtifact, TeamSeasonArtifact } from "./pageArtifacts.js";
import type { MetricHistoryRow } from "./metricHistorySchema.js";
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
  resolvePublishAlgorithms,
  withEventPercentiles,
  withHistoryPercentiles,
  type ActualBonusFlags,
  type BuildEventArtifactParams,
  type EventTeamRankingInput,
  type PublishedObjectRecord,
} from "./publish.js";
import { artifactKey } from "./pageArtifacts.js";
import { roundPmf, roundTo, ROUNDING_RULE } from "./rounding.js";
import type { ScoreSlice } from "./score.js";
import { RP_RULE_MODULES } from "../core/algorithms/sigma1/rp/rules.js";
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
  it("the default (undefined) publish set resolves to opr, epa, vpr", () => {
    const algorithms = resolvePublishAlgorithms(undefined);
    expect(algorithms.map((a) => a.id)).toEqual([opr.id, epa.id, "vpr"]);
  });

  // Test 8: every emitted artifact key for the published algorithm carries
  // the renamed segment, and none carries the retired one — across all four
  // algorithm-scoped page kinds (`compare` carries no algorithm segment by
  // design, so it is excluded here).
  it("every artifact key built for the published algorithm carries the vpr@{version} segment, never the retired sigma1@ segment", () => {
    const [, , vprModule] = resolvePublishAlgorithms(undefined);
    const module = vprModule!;
    const keys = [
      artifactKey({ page: "teams", year: 2026, algorithmId: module.id, version: module.version }),
      artifactKey({ page: "team", teamKey: "frc118", year: 2026, algorithmId: module.id, version: module.version }),
      artifactKey({ page: "events", year: 2026, algorithmId: module.id, version: module.version }),
      artifactKey({ page: "event", eventKey: "2026casj", algorithmId: module.id, version: module.version }),
    ];
    for (const key of keys) {
      expect(key).toContain(`vpr@${module.version}`);
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
  it("Test 8 (folded todo, PD-08): a freshly published playoff row carries no bonus-RP key on either artifact kind, against a real qualification-side bonus set", async () => {
    upsertEvent(db, seasonEvent({ eventKey: "2024casj", year: 2024 }));
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

    const qmEventRow = eventArtifact.matches.find((m) => m.matchKey === "2024casj_qm1") as object;
    const sfEventRow = eventArtifact.matches.find((m) => m.matchKey === "2024casj_sf1m1") as object;
    for (const key of ["redBonusRp", "blueBonusRp", "actualRedBonusRp", "actualBlueBonusRp"]) {
      expect(qmEventRow).not.toHaveProperty(key);
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
 * Plan 07-09 Task 2: `runEventMode` is module-private and not directly
 * callable from this test file, so its own single-season-replay/single-
 * pool/single-as-of-event-call shape is asserted STRUCTURALLY, at the
 * source-text level, standing in for a behavior test that would otherwise
 * need a full corpus. This is a deliberate stand-in, named as such so a
 * later reader does not mistake it for a weakened behavior assertion —
 * Test 3 below (the full pre-existing + Task 1 seeded-corpus suite still
 * green) is what actually proves runEventMode's sibling function,
 * publishSeasons, moved nothing.
 */
describe("runEventMode — structural (plan 07-09 Task 2)", () => {
  const source = readFileSync(new URL("./publish.ts", import.meta.url), "utf8");
  const rangeMatch = /async function runEventMode\b[\s\S]*?(?=\nasync function runSeasonsCliMode\b)/.exec(source);

  it("Test 2 (structural stand-in for an un-exported function): runEventMode's own range contains exactly one buildSeasonStream call, one sortedPoolsByMetric call, and one metricsAsOfEvent call", () => {
    expect(rangeMatch, "expected to find runEventMode's source range").not.toBeNull();
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
