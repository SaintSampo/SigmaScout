/**
 * A live tick must keep every key it does not own, on both the event and the
 * team-season artifact. The fixtures here come from the REAL offline
 * builders, never hand-written artifact objects: an allow-list merge dropped
 * `name`/`startDate`/`location`/`week`/`alliances` precisely because those
 * keys were added to the publisher after the merge was written, and a
 * hand-written fixture would have been written from the same stale picture.
 * Preserved keys are enumerated from the builder's own output, so a key the
 * publisher adds later is covered with no edit here.
 *
 * WHY THE PUBLISHER IS LOADED BY RUNTIME `import()` ONLY: a static or even a
 * type-only import of `packages/harness/publish.ts` adds it to the Worker's
 * tsc program, and `packages/harness/r2Client.ts` (which it reaches) fails
 * the Worker typecheck under workers-types (node Buffer vs. the Workers
 * body types). A non-literal `import()` specifier keeps it out of the
 * program while vitest still loads and runs it.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergeEventArtifact, mergeTeamSeasonArtifact, touchedEventTeamMetrics } from "../src/scheduled.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import type { MatchResult, Prediction, TeamMetric, UpcomingMatch } from "../../../packages/core/algorithms/types.js";
import {
  EventUpcomingMatchSchema,
  LiveEventArtifactSchema,
  TeamSeasonArtifactSchema,
  type EventArtifact,
  type EventUpcomingMatch,
  type LiveEventArtifact,
  type TeamSeasonArtifact,
} from "../../../packages/harness/pageArtifacts.js";
import { eventUpcomingRow } from "../../../packages/harness/publishedRows.js";

/** The slice of `publish.ts` these tests drive, typed locally (see the header for why). */
interface OfflinePublisher {
  buildEventArtifact(params: unknown): EventArtifact;
  buildTeamSeasonArtifact(params: unknown): TeamSeasonArtifact;
}

// `.href`, not the `URL` object: this file typechecks under
// `@cloudflare/workers-types`, whose `URL` is not node's `URL`.
const publisher = (await import(fileURLToPath(new URL("../../../packages/harness/publish.ts", import.meta.url).href))) as OfflinePublisher;

const SEASON = 2026;
const EVENT_KEY = "2026casj";
const OTHER_EVENT_KEY = "2026cabl";
const OFFLINE_STAMP = { generation: "offline-gen", computedAt: "2026-03-05T00:00:00.000Z" };
const LIVE_STAMP = { generation: "tick-1", computedAt: "2026-03-07T18:00:00.000Z" };
const TEAMS = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6", "frc7", "frc8"];

function json<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function matchResult(overrides: Partial<MatchResult> & Pick<MatchResult, "matchKey" | "matchNumber" | "redTeams" | "blueTeams">): MatchResult {
  return {
    eventKey: EVENT_KEY,
    compLevel: "qm",
    setNumber: 1,
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    eventType: 0,
    week: 1,
    winner: "red",
    redScore: 120,
    blueScore: 95,
    redRpEarned: 4,
    blueRpEarned: 1,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
    ...overrides,
  };
}

function upcomingMatch(matchKey: string, matchNumber: number, redTeams: string[], blueTeams: string[], eventKey = EVENT_KEY): UpcomingMatch {
  return { matchKey, eventKey, compLevel: "qm", setNumber: 1, matchNumber, redTeams, blueTeams, redSurrogates: [], blueSurrogates: [], eventType: 0, week: 1 };
}

/** One priced upcoming row, as Phase B supplies them since quick task 260923-3w6, through the publisher's own builder. */
function pricedUpcoming(match: UpcomingMatch, sortTime: number): EventUpcomingMatch {
  return EventUpcomingMatchSchema.parse(
    eventUpcomingRow({ match, prediction: { winner: "red", pRedWin: 0.55, redScore: 103, blueScore: 99 } satisfies Prediction }, sortTime)
  );
}


const PLAYED_QM1 = matchResult({ matchKey: `${EVENT_KEY}_qm1`, matchNumber: 1, redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] });
const UPCOMING_QM2 = upcomingMatch(`${EVENT_KEY}_qm2`, 2, ["frc1", "frc3", "frc5"], ["frc2", "frc4", "frc6"]);
const QM1_SORT_TIME = 1_772_900_000_000;
const QM2_SORT_TIME = 1_772_900_420_000;

// ---------------------------------------------------------------------------
// Event artifact
// ---------------------------------------------------------------------------

function offlineEventArtifact(): EventArtifact {
  const built = publisher.buildEventArtifact({
    eventKey: EVENT_KEY,
    season: SEASON,
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    generation: OFFLINE_STAMP.generation,
    computedAt: OFFLINE_STAMP.computedAt,
    eventMeta: { name: "Silicon Valley Regional", startDate: "2026-03-05", country: "USA", stateProv: "CA", week: 1 },
    eventType: 0,
    alliances: [
      { allianceNumber: 1, name: "Alliance 1", picks: ["frc1", "frc2", "frc3"], record: { wins: 4, losses: 1, ties: 0 } },
      { allianceNumber: 2, name: null, picks: ["frc4", "frc5", "frc6", "frc7"] },
    ],
    teams: TEAMS.map((teamKey, i) => ({
      teamKey,
      teamNumber: i + 1,
      nickname: `Team ${i + 1}`,
      metrics: { total: { value: 40 + i, spread: 5, percentile: 10 * i }, sigma: { value: 20 + i, percentile: 5 * i } },
    })),
    rankings: new Map(
      TEAMS.map((teamKey, i) => [teamKey, { rank: i + 1, recordWins: 8 - i, recordLosses: i, recordTies: 0, rankingScore: 3.25 - i * 0.125 }])
    ),
    predictions: [
      {
        match: PLAYED_QM1,
        prediction: { winner: "red", pRedWin: 0.62, redScore: 110, blueScore: 98, redOutcomeRp: [3, 1, 0], blueOutcomeRp: [0, 1, 3] } satisfies Prediction,
      },
    ],
    upcoming: [{ match: UPCOMING_QM2, prediction: { winner: "blue", pRedWin: 0.45, redScore: 100, blueScore: 104 } satisfies Prediction }],
    sortTimeByMatchKey: new Map([
      [PLAYED_QM1.matchKey, QM1_SORT_TIME],
      [UPCOMING_QM2.matchKey, QM2_SORT_TIME],
    ]),
  });
  return json(built);
}

/** The production read path: JSON off R2, then `LiveEventArtifactSchema.parse`. */
function existingEvent(): LiveEventArtifact {
  return LiveEventArtifactSchema.parse(offlineEventArtifact());
}

const TICK_QM2 = matchResult({ matchKey: UPCOMING_QM2.matchKey, matchNumber: 2, redTeams: [...UPCOMING_QM2.redTeams], blueTeams: [...UPCOMING_QM2.blueTeams], winner: "blue", redScore: 90, blueScore: 101 });
const TOUCHED = [...TICK_QM2.redTeams, ...TICK_QM2.blueTeams].sort();
const FRESH_METRICS: Record<string, Record<string, TeamMetric>> = Object.fromEntries(TOUCHED.map((teamKey, i) => [teamKey, { total: { value: 60.123 + i } }]));

interface EventTickOptions {
  readonly existing: LiveEventArtifact | undefined;
  readonly algorithmId?: string;
  readonly algorithmVersion?: string;
  readonly eventType?: number;
  readonly upcoming?: readonly EventUpcomingMatch[];
}

/**
 * Every `mergeEventArtifact` call in this file goes through here. RAW, before
 * the schema parse: `EventArtifactSchema.state` is `.catch(undefined)`, so a
 * parse would quietly drop a stale block and hide exactly the regression the
 * state tests below exist to catch.
 */
function mergeEventRaw(options: EventTickOptions): Record<string, unknown> {
  const merged = mergeEventArtifact({
    existing: options.existing,
    eventKey: EVENT_KEY,
    season: SEASON,
    algorithmId: options.algorithmId ?? spr.id,
    algorithmVersion: options.algorithmVersion ?? spr.version,
    eventType: options.eventType,
    newlyFolded: [TICK_QM2],
    // No outcome RP on this tick's prediction, so `rpOutcomeRp` must carry.
    newPredictions: new Map([[TICK_QM2.matchKey, { winner: "blue", pRedWin: 0.4, redScore: 95, blueScore: 99 } satisfies Prediction]]),
    upcoming: options.upcoming ?? [],
    touchedTeams: TOUCHED,
    touchedMetrics: FRESH_METRICS,
    newBands: new Map(),
    // Task 3: the merges take this tick's per-match facts; these preservation
    // fixtures fold no facts, which is a valid (empty) value.
    playedRowFacts: new Map(),
    stamp: LIVE_STAMP,
  });
  return merged as Record<string, unknown>;
}

/** The written artifact as R2 holds it: the merge, schema-parsed (`writeArtifactObject`'s own path), JSON round-tripped. */
function mergeEvent(options: EventTickOptions): LiveEventArtifact {
  return json(LiveEventArtifactSchema.parse(mergeEventRaw(options)));
}

const EVENT_OWNED_KEYS = new Set(["generation", "computedAt", "matches", "upcoming", "teams", "state"]);

describe("mergeEventArtifact keeps every key the tick does not own", () => {
  it("non-vacuity: the offline fixture carries the identity keys, alliances, rpOutcomeRp and full standings rows", () => {
    const offline = offlineEventArtifact() as Record<string, unknown> & EventArtifact;
    for (const key of ["name", "startDate", "location", "week", "eventType", "alliances", "rpOutcomeRp"]) {
      expect(offline, key).toHaveProperty(key);
    }
    expect(offline.alliances!.length).toBeGreaterThanOrEqual(2);
    for (const row of offline.teams) {
      expect(row).toHaveProperty("rank");
      expect(row).toHaveProperty("record");
      expect(row).toHaveProperty("rp");
    }
  });

  it("every top-level key outside the owned set is JSON-equal to the published artifact", () => {
    const offline = offlineEventArtifact() as Record<string, unknown>;
    const written = mergeEvent({ existing: existingEvent() }) as unknown as Record<string, unknown>;
    const preserved = Object.keys(offline).filter((key) => !EVENT_OWNED_KEYS.has(key));
    expect(preserved.length).toBeGreaterThan(8);
    for (const key of preserved) {
      expect(written[key], key).toEqual(offline[key]);
    }
    expect(written.generation).toBe(LIVE_STAMP.generation);
    expect(written.computedAt).toBe(LIVE_STAMP.computedAt);
  });

  it("standings rows keep order, untouched rows are unchanged, touched rows change only metrics", () => {
    const offline = offlineEventArtifact();
    const written = mergeEvent({ existing: existingEvent() });
    expect(written.teams.map((t) => t.teamKey)).toEqual(offline.teams.map((t) => t.teamKey));
    for (const [i, row] of written.teams.entries()) {
      const offlineRow = offline.teams[i]!;
      if (!TOUCHED.includes(row.teamKey)) {
        expect(row, row.teamKey).toEqual(offlineRow);
        continue;
      }
      const { metrics, ...rest } = row;
      const { metrics: offlineMetrics, ...offlineRest } = offlineRow;
      expect(rest, row.teamKey).toEqual(offlineRest);
      expect(metrics, row.teamKey).toEqual(json(touchedEventTeamMetrics(offlineMetrics, FRESH_METRICS[row.teamKey]!)));
    }
  });

  it("writes no stale state block for a non-SPR artifact with upcoming matches", () => {
    const existing = { ...existingEvent(), state: { stale: true } } as unknown as LiveEventArtifact;
    const qm3 = pricedUpcoming(upcomingMatch(`${EVENT_KEY}_qm3`, 3, ["frc7", "frc8", "frc1"], ["frc2", "frc3", "frc4"]), QM2_SORT_TIME + 420_000);
    const written = mergeEventRaw({ existing, algorithmId: opr.id, algorithmVersion: opr.version, upcoming: [qm3] });
    expect(written).not.toHaveProperty("state");
  });

  it("writes no stale state block for an SPR artifact with no upcoming match left", () => {
    const existing = { ...existingEvent(), state: { stale: true } } as unknown as LiveEventArtifact;
    const written = mergeEventRaw({ existing });
    expect(written).not.toHaveProperty("state");
  });

  it("bootstrap: with no existing artifact the written key set is exactly what it was before", () => {
    const written = mergeEventRaw({ existing: undefined, eventType: 0 });
    expect(Object.keys(written).sort()).toEqual(
      ["schemaVersion", "generation", "computedAt", "algorithmId", "algorithmVersion", "eventKey", "season", "eventType", "matches", "upcoming", "teams"].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// tierCuts carry-forward (quick task 260920-qzf)
// ---------------------------------------------------------------------------

const SAMPLE_TIER_CUTS = { total: { cuts: [31.17, 52.4, 88.05] }, phaseAuto: { cuts: [7.2, 12.86, 24.1] } };

describe("mergeEventArtifact preserves tierCuts through a live tick", () => {
  it("carries tierCuts forward unchanged, for a tick that touches teams and folds a match", () => {
    const existing = { ...existingEvent(), tierCuts: SAMPLE_TIER_CUTS } as unknown as LiveEventArtifact;
    const written = mergeEventRaw({ existing });
    expect(written.tierCuts).toEqual(SAMPLE_TIER_CUTS);
  });

  it("survives the write-side parse the Worker actually uses (LiveEventArtifactSchema) — the step that would strip an undeclared key", () => {
    const existing = { ...existingEvent(), tierCuts: SAMPLE_TIER_CUTS } as unknown as LiveEventArtifact;
    const written = mergeEvent({ existing });
    expect(written.tierCuts).toEqual(SAMPLE_TIER_CUTS);
  });

  it("bootstrap (no existing artifact) carries no tierCuts key at all — never an empty object", () => {
    const written = mergeEventRaw({ existing: undefined, eventType: 0 });
    expect(written).not.toHaveProperty("tierCuts");
  });

  it("an existing artifact with no tierCuts still merges, and still carries no such key", () => {
    const written = mergeEventRaw({ existing: existingEvent() });
    expect(written).not.toHaveProperty("tierCuts");
  });
});

// ---------------------------------------------------------------------------
// Team-season artifact
// ---------------------------------------------------------------------------

const OTHER_PLAYED = matchResult({ matchKey: `${OTHER_EVENT_KEY}_qm4`, eventKey: OTHER_EVENT_KEY, matchNumber: 4, redTeams: ["frc1", "frc9", "frc10"], blueTeams: ["frc11", "frc12", "frc13"] });

function offlineTeamSeasonArtifact(): TeamSeasonArtifact {
  const built = publisher.buildTeamSeasonArtifact({
    teamKey: "frc1",
    teamNumber: 1,
    nickname: "Team 1",
    season: SEASON,
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    generation: OFFLINE_STAMP.generation,
    computedAt: OFFLINE_STAMP.computedAt,
    seasonStats: {
      record: { wins: 7, losses: 2, ties: 0 },
      metrics: { total: { value: 48.5, spread: 4, percentile: 91.2 }, sigma: { value: 22.1, percentile: 80 } },
      metricsBasis: "last-official-match",
    },
    events: [
      {
        eventKey: OTHER_EVENT_KEY,
        eventName: "Central Valley Regional",
        startDate: "2026-02-26",
        rank: 5,
        totalTeams: 38,
        matches: [{ match: OTHER_PLAYED, prediction: { winner: "red", pRedWin: 0.7, redScore: 115, blueScore: 90 } satisfies Prediction }],
      },
      {
        eventKey: EVENT_KEY,
        eventName: "Silicon Valley Regional",
        startDate: "2026-03-05",
        rank: 1,
        totalTeams: 40,
        matches: [{ match: UPCOMING_QM2, prediction: { winner: "blue", pRedWin: 0.45, redScore: 100, blueScore: 104 } satisfies Prediction }],
      },
    ],
    metricHistory: [
      { matchKey: OTHER_PLAYED.matchKey, season: SEASON, eventKey: OTHER_EVENT_KEY, algorithmId: spr.id, teamKey: "frc1", matchIndex: 0, metrics: { total: { value: 47 }, sigma: { value: 21 } } },
      { matchKey: PLAYED_QM1.matchKey, season: SEASON, eventKey: EVENT_KEY, algorithmId: spr.id, teamKey: "frc1", matchIndex: 1, metrics: { total: { value: 48 } } },
    ],
    sortTimeByMatchKey: new Map([[UPCOMING_QM2.matchKey, QM2_SORT_TIME]]),
    robotImageUrl: "https://example.test/robot.jpg",
    activeYears: [2024, 2025, 2026],
    ranks: [
      { scope: "world", rank: 7, total: 3706 },
      { scope: "country", value: "USA", rank: 5, total: 2800 },
    ],
  });
  return json(built);
}

function mergeTeam(existing: TeamSeasonArtifact | undefined, match: MatchResult): TeamSeasonArtifact {
  const merged = mergeTeamSeasonArtifact({
    existing,
    teamKey: "frc1",
    season: SEASON,
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    eventKey: match.eventKey,
    matches: [match],
    predictions: new Map([[match.matchKey, { winner: "blue", pRedWin: 0.4, redScore: 95, blueScore: 99 } satisfies Prediction]]),
    metrics: { total: { value: 50.25 } },
    upcomingRows: [],
    bands: new Map(),
    playedRowFacts: new Map(),
    stamp: LIVE_STAMP,
    sigmaAfterTick: 23.4,
  });
  return json(TeamSeasonArtifactSchema.parse(merged));
}

const TEAM_OWNED_KEYS = new Set(["generation", "computedAt", "seasonStats", "events", "metricHistory"]);
const SEASON_STATS_OWNED_KEYS = new Set(["record", "metrics", "metricsBasis"]);

describe("mergeTeamSeasonArtifact keeps every key the tick does not own", () => {
  it("official tick: top level, seasonStats, events and metric history are preserved; metricsBasis is last-official-match", () => {
    const offline = offlineTeamSeasonArtifact();
    const existing = TeamSeasonArtifactSchema.parse(offline);
    const written = mergeTeam(existing, TICK_QM2);

    // Non-vacuity: the fixture really carries the publisher-owned keys.
    for (const key of ["robotImageUrl", "activeYears", "ranks"]) expect(offline, key).toHaveProperty(key);
    expect(offline.seasonStats).toHaveProperty("metricsBasis");

    const offlineRecord = offline as unknown as Record<string, unknown>;
    const writtenRecord = written as unknown as Record<string, unknown>;
    for (const key of Object.keys(offlineRecord).filter((k) => !TEAM_OWNED_KEYS.has(k))) {
      expect(writtenRecord[key], key).toEqual(offlineRecord[key]);
    }

    const offlineStats = offline.seasonStats as unknown as Record<string, unknown>;
    const writtenStats = written.seasonStats as unknown as Record<string, unknown>;
    for (const key of Object.keys(offlineStats).filter((k) => !SEASON_STATS_OWNED_KEYS.has(k))) {
      expect(writtenStats[key], key).toEqual(offlineStats[key]);
    }
    expect(written.seasonStats.metricsBasis).toBe("last-official-match");

    expect(written.events.map((e) => e.eventKey)).toEqual(offline.events.map((e) => e.eventKey));
    expect(written.events[0]).toEqual(offline.events[0]);
    const { matches: _written, ...writtenEvent } = written.events[1]!;
    const { matches: _offline, ...offlineEvent } = offline.events[1]!;
    expect(writtenEvent).toEqual(offlineEvent);
    expect(Object.keys(offlineEvent).sort()).toEqual(["eventKey", "eventName", "rank", "startDate", "totalTeams"]);

    expect(written.metricHistory.slice(0, offline.metricHistory.length)).toEqual(offline.metricHistory);
    expect(written.metricHistory).toHaveLength(offline.metricHistory.length + 1);
  });

  it("offseason tick: metricsBasis is season-final", () => {
    const existing = TeamSeasonArtifactSchema.parse(offlineTeamSeasonArtifact());
    const written = mergeTeam(existing, { ...TICK_QM2, eventType: 99 });
    expect(written.seasonStats.metricsBasis).toBe("season-final");
  });
});
