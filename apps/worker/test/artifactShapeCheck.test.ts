/**
 * The narrow structural read guard that replaced the tick's two read-side zod
 * parses (quick task 260915-t7o, fix F2).
 *
 * WHAT THIS FILE HAS TO PROVE, and why each part of it exists:
 *
 *   1. EQUIVALENCE. A guarded `existing` and a zod-parsed `existing` must
 *      produce the SAME PUBLISHED BYTES. Not the same merge output — the same
 *      bytes. zod strips unknown top-level keys and the guard does not, so the
 *      two merge outputs CAN differ by exactly such a key; what may never
 *      differ is what `writeArtifactObject` serializes, because that call
 *      stringifies the output of `schema.parse`, which strips the key again.
 *      Every equivalence assertion below therefore compares
 *      `JSON.stringify(Schema.parse(merged))` — the real published bytes,
 *      key order included — and not the raw merge object.
 *
 *   2. REJECTION PARITY. Everything the guard rejects must degrade to a
 *      bootstrap merge exactly as a failed read-side zod parse does today.
 *
 *   3. THE `state` BLOCK's `.catch(undefined)`. `EventArtifactSchema.state` is
 *      `.optional().catch(undefined)`: a malformed block today drops the BLOCK,
 *      not the artifact. The guard mirrors that — it drops a block it cannot
 *      hand to `spliceEventStateBlock` and keeps the rest of the artifact —
 *      rather than rejecting the whole object, which would silently turn a bad
 *      block into a full history loss.
 *
 * WHY THE PUBLISHER IS LOADED BY RUNTIME `import()` ONLY: a static or even a
 * type-only import of `packages/harness/publish.ts` adds it to the Worker's
 * tsc program, and `packages/harness/r2Client.ts` (which it reaches) fails the
 * Worker typecheck under workers-types. A non-literal `import()` specifier
 * keeps it out of the program while vitest still loads and runs it. The same
 * reasoning `scheduled.mergePreservation.test.ts` records.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkLiveEventArtifactShape, checkTeamSeasonArtifactShape } from "../src/artifactShapeCheck.js";
import { mergeEventArtifact, mergeTeamSeasonArtifact } from "../src/artifactMerge.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import type { MatchResult, Prediction, TeamMetric, UpcomingMatch } from "../../../packages/core/algorithms/types.js";
import { STATE_SNAPSHOT_SHAPE_VERSION } from "../../../packages/harness/stateSnapshot.js";
import {
  LiveEventArtifactSchema,
  TeamSeasonArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  type EventArtifact,
  type EventStateBlock,
  type LiveEventArtifact,
  type TeamSeasonArtifact,
} from "../../../packages/harness/pageArtifacts.js";
import type { CorpusMatch } from "../../../packages/ingest/normalize.js";

interface OfflinePublisher {
  buildEventArtifact(params: unknown): EventArtifact;
  buildTeamSeasonArtifact(params: unknown): TeamSeasonArtifact;
}

// `.href`, not the `URL` object: this file typechecks under workers-types.
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

function upcomingMatch(matchKey: string, matchNumber: number, redTeams: string[], blueTeams: string[]): UpcomingMatch {
  return { matchKey, eventKey: EVENT_KEY, compLevel: "qm", setNumber: 1, matchNumber, redTeams, blueTeams, redSurrogates: [], blueSurrogates: [], eventType: 0, week: 1 };
}

function corpusMatch(result: UpcomingMatch, sortTime: number): CorpusMatch {
  return {
    matchKey: result.matchKey,
    eventKey: result.eventKey,
    compLevel: result.compLevel,
    matchNumber: result.matchNumber,
    setNumber: result.setNumber,
    sortTime,
    redTeams: [...result.redTeams],
    blueTeams: [...result.blueTeams],
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
  };
}

const PLAYED_QM1 = matchResult({ matchKey: `${EVENT_KEY}_qm1`, matchNumber: 1, redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] });
const UPCOMING_QM2 = upcomingMatch(`${EVENT_KEY}_qm2`, 2, ["frc1", "frc3", "frc5"], ["frc2", "frc4", "frc6"]);
const UPCOMING_QM3 = upcomingMatch(`${EVENT_KEY}_qm3`, 3, ["frc7", "frc8", "frc1"], ["frc2", "frc3", "frc4"]);
const QM1_SORT_TIME = 1_772_900_000_000;
const QM2_SORT_TIME = 1_772_900_420_000;
const QM3_SORT_TIME = 1_772_900_840_000;

const TICK_QM2 = matchResult({
  matchKey: UPCOMING_QM2.matchKey,
  matchNumber: 2,
  redTeams: [...UPCOMING_QM2.redTeams],
  blueTeams: [...UPCOMING_QM2.blueTeams],
  winner: "blue",
  redScore: 90,
  blueScore: 101,
});
const TOUCHED = [...TICK_QM2.redTeams, ...TICK_QM2.blueTeams].sort();
const FRESH_METRICS: Record<string, Record<string, TeamMetric>> = Object.fromEntries(TOUCHED.map((teamKey, i) => [teamKey, { total: { value: 60.123 + i } }]));

// ---------------------------------------------------------------------------
// Fixtures, from the REAL offline builders — never hand-written artifacts, for
// the reason `scheduled.mergePreservation.test.ts` records: a hand-written
// fixture is written from the same stale picture as the bug it is meant to catch.
// ---------------------------------------------------------------------------

function offlineEventArtifact(): EventArtifact {
  return json(
    publisher.buildEventArtifact({
      eventKey: EVENT_KEY,
      season: SEASON,
      algorithmId: spr.id,
      algorithmVersion: spr.version,
      generation: OFFLINE_STAMP.generation,
      computedAt: OFFLINE_STAMP.computedAt,
      eventMeta: { name: "Silicon Valley Regional", startDate: "2026-03-05", country: "USA", stateProv: "CA", week: 1 },
      eventType: 0,
      alliances: [{ allianceNumber: 1, name: "Alliance 1", picks: ["frc1", "frc2", "frc3"], record: { wins: 4, losses: 1, ties: 0 } }],
      teams: TEAMS.map((teamKey, i) => ({
        teamKey,
        teamNumber: i + 1,
        nickname: `Team ${i + 1}`,
        metrics: { total: { value: 40 + i, spread: 5, percentile: 10 * i }, sigma: { value: 20 + i, percentile: 5 * i } },
      })),
      rankings: new Map(TEAMS.map((teamKey, i) => [teamKey, { rank: i + 1, recordWins: 8 - i, recordLosses: i, recordTies: 0, rankingScore: 3.25 - i * 0.125 }])),
      predictions: [
        {
          match: PLAYED_QM1,
          prediction: { winner: "red", pRedWin: 0.62, redScore: 110, blueScore: 98, redOutcomeRp: [3, 1, 0], blueOutcomeRp: [0, 1, 3] } satisfies Prediction,
        },
      ],
      upcoming: [
        { match: UPCOMING_QM2, prediction: { winner: "blue", pRedWin: 0.45, redScore: 100, blueScore: 104 } satisfies Prediction },
        { match: UPCOMING_QM3, prediction: { winner: "red", pRedWin: 0.55, redScore: 103, blueScore: 99 } satisfies Prediction },
      ],
      sortTimeByMatchKey: new Map([
        [PLAYED_QM1.matchKey, QM1_SORT_TIME],
        [UPCOMING_QM2.matchKey, QM2_SORT_TIME],
        [UPCOMING_QM3.matchKey, QM3_SORT_TIME],
      ]),
    })
  );
}

/**
 * A `state` block that is BOTH `EventStateBlockSchema`-valid and
 * `spliceEventStateBlock`-valid — written out field by field rather than built
 * from D1 rows, because a block row is exactly seven strings and nothing about
 * this file's subject needs a real snapshot payload inside `stateJson`.
 */
function stateBlock(): EventStateBlock {
  const row = (scopeKind: "league" | "team", scopeKey: string) => ({
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    scopeKind,
    scopeKey,
    stateJson: JSON.stringify({ shapeVersion: STATE_SNAPSHOT_SHAPE_VERSION }),
    generation: OFFLINE_STAMP.generation,
    computedAt: OFFLINE_STAMP.computedAt,
  });
  return {
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION,
    rows: [row("league", EVENT_KEY), ...TEAMS.map((teamKey) => row("team", teamKey))],
  };
}

function offlineTeamSeasonArtifact(): TeamSeasonArtifact {
  const otherPlayed = matchResult({ matchKey: `${OTHER_EVENT_KEY}_qm4`, eventKey: OTHER_EVENT_KEY, matchNumber: 4, redTeams: ["frc1", "frc9", "frc10"], blueTeams: ["frc11", "frc12", "frc13"] });
  return json(
    publisher.buildTeamSeasonArtifact({
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
          matches: [{ match: otherPlayed, prediction: { winner: "red", pRedWin: 0.7, redScore: 115, blueScore: 90 } satisfies Prediction }],
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
        { matchKey: otherPlayed.matchKey, season: SEASON, eventKey: OTHER_EVENT_KEY, algorithmId: spr.id, teamKey: "frc1", matchIndex: 0, metrics: { total: { value: 47 }, sigma: { value: 21 } } },
      ],
      sortTimeByMatchKey: new Map([[UPCOMING_QM2.matchKey, QM2_SORT_TIME]]),
      robotImageUrl: "https://example.test/robot.jpg",
      activeYears: [2024, 2025, 2026],
      ranks: [{ scope: "world", rank: 7, total: 3706 }],
    })
  );
}

// ---------------------------------------------------------------------------
// The two merges, driven identically whatever produced `existing`
// ---------------------------------------------------------------------------

function mergeEvent(existing: LiveEventArtifact | undefined): unknown {
  return mergeEventArtifact({
    existing,
    eventKey: EVENT_KEY,
    season: SEASON,
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    eventType: 0,
    newlyFolded: [TICK_QM2],
    newPredictions: new Map([[TICK_QM2.matchKey, { winner: "blue", pRedWin: 0.4, redScore: 95, blueScore: 99 } satisfies Prediction]]),
    stillUpcoming: [corpusMatch(UPCOMING_QM3, QM3_SORT_TIME)],
    touchedTeams: TOUCHED,
    touchedMetrics: FRESH_METRICS,
    newBands: new Map(),
    writtenRows: [],
    playedRowFacts: new Map(),
    // The live block's inputs (260918-16t), set so every equivalence
    // assertion below ALSO exercises the block rather than leaving it absent:
    // a non-empty `realTouchedTeams` gives `buildTickLiveRows` a real header.
    realTouchedTeams: TOUCHED,
    touchedSigma: new Map(),
    existingBodyBytes: 0,
    stamp: LIVE_STAMP,
  });
}

function mergeTeam(existing: TeamSeasonArtifact | undefined): unknown {
  return mergeTeamSeasonArtifact({
    existing,
    teamKey: "frc1",
    season: SEASON,
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    eventKey: EVENT_KEY,
    matches: [TICK_QM2],
    predictions: new Map([[TICK_QM2.matchKey, { winner: "blue", pRedWin: 0.4, redScore: 95, blueScore: 99 } satisfies Prediction]]),
    metrics: FRESH_METRICS.frc1!,
    matchIndexByKey: new Map([[TICK_QM2.matchKey, 1]]),
    bands: new Map(),
    playedRowFacts: new Map(),
    stamp: LIVE_STAMP,
    sigmaAfterTick: 23.5,
  });
}

/** The bytes `writeArtifactObject` would actually put: `JSON.stringify(schema.parse(merged))`, key order included. */
function publishedEventBytes(merged: unknown): string {
  return JSON.stringify(LiveEventArtifactSchema.parse(merged));
}
function publishedTeamBytes(merged: unknown): string {
  return JSON.stringify(TeamSeasonArtifactSchema.parse(merged));
}

// ---------------------------------------------------------------------------
// Group 1 — acceptance and the published-bytes equivalence
// ---------------------------------------------------------------------------

describe("the structural guard accepts what zod accepts, and publishes the same bytes", () => {
  it("non-vacuity: the fixtures are real published artifacts that zod itself accepts", () => {
    const event = offlineEventArtifact() as Record<string, unknown>;
    expect(() => LiveEventArtifactSchema.parse(event)).not.toThrow();
    expect(() => TeamSeasonArtifactSchema.parse(offlineTeamSeasonArtifact())).not.toThrow();
    // The keys the merge dereferences without a guard of its own must really be there.
    for (const key of ["matches", "upcoming", "teams", "alliances", "rpOutcomeRp", "name", "week"]) {
      expect(event, key).toHaveProperty(key);
    }
  });

  it("event: a published artifact is accepted and its merge publishes bytes identical to the zod-parsed path", () => {
    const raw = offlineEventArtifact();
    const guarded = checkLiveEventArtifactShape(json(raw));
    expect(guarded).toBeDefined();
    expect(publishedEventBytes(mergeEvent(guarded))).toBe(publishedEventBytes(mergeEvent(LiveEventArtifactSchema.parse(json(raw)))));
  });

  it("event: a `state` block survives the guard and splices identically to the zod-parsed path", () => {
    const raw = { ...offlineEventArtifact(), state: stateBlock() };
    const guarded = checkLiveEventArtifactShape(json(raw));
    expect(guarded?.state).toBeDefined();
    const fromGuard = mergeEvent(guarded) as Record<string, unknown>;
    // Non-vacuity: this fixture really does exercise the splice.
    expect(fromGuard.state).toBeDefined();
    expect(publishedEventBytes(fromGuard)).toBe(publishedEventBytes(mergeEvent(LiveEventArtifactSchema.parse(json(raw)))));
  });

  it("team: a published artifact is accepted and its merge publishes bytes identical to the zod-parsed path", () => {
    const raw = offlineTeamSeasonArtifact();
    const guarded = checkTeamSeasonArtifactShape(json(raw));
    expect(guarded).toBeDefined();
    expect(publishedTeamBytes(mergeTeam(guarded))).toBe(publishedTeamBytes(mergeTeam(TeamSeasonArtifactSchema.parse(json(raw)))));
  });
});

// ---------------------------------------------------------------------------
// Group 2 — the one behavioural difference, and why it never reaches R2
// ---------------------------------------------------------------------------

describe("an unknown top-level key differs in the merge output but never in the published bytes", () => {
  it("event: the guarded merge carries the unknown key, the zod-parsed one does not, and the published bytes agree", () => {
    const raw = { ...offlineEventArtifact(), somethingThePublisherAddsLater: { a: 1 } };
    const fromGuard = mergeEvent(checkLiveEventArtifactShape(json(raw))) as Record<string, unknown>;
    const fromZod = mergeEvent(LiveEventArtifactSchema.parse(json(raw))) as Record<string, unknown>;

    expect(fromGuard.somethingThePublisherAddsLater).toEqual({ a: 1 });
    expect(fromZod).not.toHaveProperty("somethingThePublisherAddsLater");
    // The merge outputs differ by EXACTLY that key and nothing else.
    const { somethingThePublisherAddsLater: _dropped, ...guardRest } = fromGuard;
    expect(guardRest).toEqual(fromZod);
    // And what `writeArtifactObject` serializes is byte-identical.
    expect(publishedEventBytes(fromGuard)).toBe(publishedEventBytes(fromZod));
  });

  it("team: same — differs by exactly the unknown key, publishes the same bytes", () => {
    const raw = { ...offlineTeamSeasonArtifact(), somethingThePublisherAddsLater: [1, 2, 3] };
    const fromGuard = mergeTeam(checkTeamSeasonArtifactShape(json(raw))) as Record<string, unknown>;
    const fromZod = mergeTeam(TeamSeasonArtifactSchema.parse(json(raw))) as Record<string, unknown>;

    expect(fromGuard.somethingThePublisherAddsLater).toEqual([1, 2, 3]);
    expect(fromZod).not.toHaveProperty("somethingThePublisherAddsLater");
    const { somethingThePublisherAddsLater: _dropped, ...guardRest } = fromGuard;
    expect(guardRest).toEqual(fromZod);
    expect(publishedTeamBytes(fromGuard)).toBe(publishedTeamBytes(fromZod));
  });
});

// ---------------------------------------------------------------------------
// Group 3 — rejection parity: everything rejected degrades to a bootstrap
// ---------------------------------------------------------------------------

describe("the guard rejects exactly what the merges cannot survive, and rejection means bootstrap", () => {
  const eventRejections: [string, unknown][] = [
    ["null", null],
    ["an array", []],
    ["a string", "{}"],
    ["a wrong schemaVersion", { ...offlineEventArtifact(), schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION + 1 }],
    ["a missing schemaVersion", (() => { const { schemaVersion: _drop, ...rest } = offlineEventArtifact(); return rest; })()],
    ["`matches` that is not an array", { ...offlineEventArtifact(), matches: { 0: {} } }],
    ["`upcoming` that is not an array", { ...offlineEventArtifact(), upcoming: null }],
    ["`teams` that is not an array", { ...offlineEventArtifact(), teams: "frc1" }],
  ];

  for (const [name, value] of eventRejections) {
    it(`event guard rejects ${name}`, () => {
      expect(checkLiveEventArtifactShape(value)).toBeUndefined();
    });
  }

  const teamRejections: [string, unknown][] = [
    ["null", null],
    ["an array", []],
    ["a wrong schemaVersion", { ...offlineTeamSeasonArtifact(), schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION + 1 }],
    ["`seasonStats` that is not an object", { ...offlineTeamSeasonArtifact(), seasonStats: 7 }],
    ["`seasonStats.record` that is not an object", { ...offlineTeamSeasonArtifact(), seasonStats: { record: null, metrics: {} } }],
    ["`events` that is not an array", { ...offlineTeamSeasonArtifact(), events: {} }],
    ["an `events` entry that is not an object", { ...offlineTeamSeasonArtifact(), events: [null] }],
    ["an `events` entry whose `matches` is not an array", { ...offlineTeamSeasonArtifact(), events: [{ eventKey: EVENT_KEY, matches: "none" }] }],
    ["`metricHistory` that is not an array", { ...offlineTeamSeasonArtifact(), metricHistory: 0 }],
  ];

  for (const [name, value] of teamRejections) {
    it(`team guard rejects ${name}`, () => {
      expect(checkTeamSeasonArtifactShape(value)).toBeUndefined();
    });
  }

  it("a rejected event artifact bootstraps: the merge runs with no existing artifact", () => {
    const rejected = checkLiveEventArtifactShape({ ...offlineEventArtifact(), teams: "frc1" });
    expect(rejected).toBeUndefined();
    expect(publishedEventBytes(mergeEvent(rejected))).toBe(publishedEventBytes(mergeEvent(undefined)));
  });

  it("a rejected team artifact bootstraps: the merge runs with no existing artifact", () => {
    const rejected = checkTeamSeasonArtifactShape({ ...offlineTeamSeasonArtifact(), metricHistory: 0 });
    expect(rejected).toBeUndefined();
    expect(publishedTeamBytes(mergeTeam(rejected))).toBe(publishedTeamBytes(mergeTeam(undefined)));
  });
});

// ---------------------------------------------------------------------------
// Group 4 — the `state` block mirrors `.catch(undefined)`, not a rejection
// ---------------------------------------------------------------------------

describe("a malformed `state` block drops the block, never the artifact", () => {
  const malformed: [string, unknown][] = [
    ["not an object", "stale"],
    ["null", null],
    ["a block whose `rows` is not an array", { algorithmId: spr.id, algorithmVersion: spr.version, snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION, rows: {} }],
    // `spliceEventStateBlock` dereferences `row.scopeKind` on every row, so a
    // non-object row would throw a TypeError THROUGH `maintainedStateBlock`'s
    // `EventStateBlockError`-only catch and out through the tick's blanket
    // catch — costing the whole event its publish. Dropping the block here is
    // what keeps that path unreachable.
    ["a block with a non-object row", { algorithmId: spr.id, algorithmVersion: spr.version, snapshotShapeVersion: STATE_SNAPSHOT_SHAPE_VERSION, rows: [null] }],
  ];

  for (const [name, state] of malformed) {
    it(`drops ${name} and keeps every other key`, () => {
      const raw = { ...offlineEventArtifact(), state };
      const guarded = checkLiveEventArtifactShape(json(raw)) as Record<string, unknown> | undefined;
      expect(guarded).toBeDefined();
      expect(guarded).not.toHaveProperty("state");
      // Everything else survives — this is `.catch(undefined)`, not a rejection.
      expect(guarded!.matches).toEqual((raw as Record<string, unknown>).matches);
      expect(guarded!.teams).toEqual((raw as Record<string, unknown>).teams);
      expect(guarded!.alliances).toEqual((raw as Record<string, unknown>).alliances);
    });
  }

  it("the merged artifact is byte-identical to the zod-parsed path, which `.catch`es the same block away", () => {
    const raw = { ...offlineEventArtifact(), state: { rows: [null] } };
    expect(publishedEventBytes(mergeEvent(checkLiveEventArtifactShape(json(raw))))).toBe(publishedEventBytes(mergeEvent(LiveEventArtifactSchema.parse(json(raw)))));
  });

  it("an absent `state` key stays absent — the guard adds no key of its own", () => {
    const raw = offlineEventArtifact();
    expect(raw).not.toHaveProperty("state");
    expect(checkLiveEventArtifactShape(json(raw))).not.toHaveProperty("state");
  });
});

// ---------------------------------------------------------------------------
// Group 5 — the `live` block mirrors `state`'s `.catch(undefined)` exactly
// (quick task 260918-16t)
// ---------------------------------------------------------------------------

describe("a malformed `live` block drops the block, never the artifact", () => {
  const malformed: [string, unknown][] = [
    ["not an object", "stale"],
    ["null", null],
    ["an array", []],
    ["a block with no `rows` at all", { metricKeys: ["total"] }],
    ["a block whose `rows` is not an array", { metricKeys: ["total"], rows: {} }],
  ];

  for (const [name, live] of malformed) {
    it(`drops ${name} and keeps every other key`, () => {
      const raw = { ...offlineEventArtifact(), live };
      const guarded = checkLiveEventArtifactShape(json(raw)) as Record<string, unknown> | undefined;
      expect(guarded).toBeDefined();
      expect(guarded).not.toHaveProperty("live");
      // Everything else survives — this is `.catch(undefined)`, not a rejection.
      // REJECTING instead would cost this event its whole published history on
      // EVERY tick for as long as the bad block sat in R2, turning an
      // ephemeral, self-healing key into a permanent outage.
      expect(guarded!.matches).toEqual((raw as Record<string, unknown>).matches);
      expect(guarded!.teams).toEqual((raw as Record<string, unknown>).teams);
      expect(guarded!.alliances).toEqual((raw as Record<string, unknown>).alliances);
    });
  }

  it("the merged artifact is byte-identical to the zod-parsed path, which `.catch`es the same block away", () => {
    const raw = { ...offlineEventArtifact(), live: { metricKeys: ["total"], rows: {} } };
    expect(publishedEventBytes(mergeEvent(checkLiveEventArtifactShape(json(raw))))).toBe(publishedEventBytes(mergeEvent(LiveEventArtifactSchema.parse(json(raw)))));
  });

  it("a WELL-SHAPED block survives the guard and the merge publishes bytes identical to the zod-parsed path", () => {
    const live = { metricKeys: ["total"], rows: [{ m: `${EVENT_KEY}_qm1`, t: [TEAMS[0]!], v: [[40]] }] };
    const raw = { ...offlineEventArtifact(), live };
    const guarded = checkLiveEventArtifactShape(json(raw));
    expect(guarded?.live).toBeDefined();
    const fromGuard = mergeEvent(guarded) as Record<string, unknown>;
    // Non-vacuity: this fixture really does carry a block through the merge.
    expect(fromGuard.live).toBeDefined();
    expect(publishedEventBytes(fromGuard)).toBe(publishedEventBytes(mergeEvent(LiveEventArtifactSchema.parse(json(raw)))));
  });

  it("BOTH blocks can be malformed at once and both drop independently", () => {
    const raw = { ...offlineEventArtifact(), state: { rows: [null] }, live: "stale" };
    const guarded = checkLiveEventArtifactShape(json(raw));
    expect(guarded).toBeDefined();
    expect(guarded).not.toHaveProperty("state");
    expect(guarded).not.toHaveProperty("live");
  });

  it("an absent `live` key stays absent — the guard adds no key of its own", () => {
    const raw = offlineEventArtifact();
    expect(raw).not.toHaveProperty("live");
    expect(checkLiveEventArtifactShape(json(raw))).not.toHaveProperty("live");
  });
});
