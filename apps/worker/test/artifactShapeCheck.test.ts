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
 *   3. STALE BLOCKS ARE INERT. An event artifact published before quick task
 *      260923-3w6 carries a `state` block and one an earlier tick wrote carries
 *      a `live` block; neither key is declared on any schema and nothing walks
 *      either, so whatever shape one is in, the guard passes the artifact and the
 *      merge emits neither key. Both had a `.catch(undefined)`-shaped guard here
 *      until 260923-3w7 deleted the code that walked their rows.
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
import {
  EventUpcomingMatchSchema,
  EventArtifactSchema,
  TeamSeasonArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  type EventArtifact,
  type EventUpcomingMatch,
  type TeamSeasonArtifact,
} from "../../../packages/harness/pageArtifacts.js";
import { eventUpcomingRow } from "../../../packages/harness/publishedRows.js";

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

/** One priced upcoming row, as Phase B supplies them since quick task 260923-3w6, through the publisher's own builder. */
function pricedUpcoming(match: UpcomingMatch, sortTime: number): EventUpcomingMatch[] {
  return [
    EventUpcomingMatchSchema.parse(
      eventUpcomingRow({ match, prediction: { winner: "red", pRedWin: 0.55, redScore: 103, blueScore: 99 } satisfies Prediction }, sortTime)
    ),
  ];
}

function mergeEvent(existing: EventArtifact | undefined): unknown {
  return mergeEventArtifact({
    existing,
    eventKey: EVENT_KEY,
    season: SEASON,
    algorithmId: spr.id,
    algorithmVersion: spr.version,
    eventType: 0,
    newlyFolded: [TICK_QM2],
    newPredictions: new Map([[TICK_QM2.matchKey, { winner: "blue", pRedWin: 0.4, redScore: 95, blueScore: 99 } satisfies Prediction]]),
    // The remaining schedule, ALREADY PRICED: since quick task 260923-3w6 the
    // tick prices its own upcoming rows and the merge only places them, so the
    // fixture supplies the published row shape rather than a corpus match.
    upcoming: pricedUpcoming(UPCOMING_QM3, QM3_SORT_TIME),
    touchedTeams: TOUCHED,
    touchedMetrics: FRESH_METRICS,
    newBands: new Map(),
    playedRowFacts: new Map(),
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
    upcomingRows: [],
    bands: new Map(),
    playedRowFacts: new Map(),
    stamp: LIVE_STAMP,
    sigmaAfterTick: 23.5,
  });
}

/** The bytes `writeArtifactObject` would actually put: `JSON.stringify(schema.parse(merged))`, key order included. */
function publishedEventBytes(merged: unknown): string {
  return JSON.stringify(EventArtifactSchema.parse(merged));
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
    expect(() => EventArtifactSchema.parse(event)).not.toThrow();
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
    expect(publishedEventBytes(mergeEvent(guarded))).toBe(publishedEventBytes(mergeEvent(EventArtifactSchema.parse(json(raw)))));
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
    const fromZod = mergeEvent(EventArtifactSchema.parse(json(raw))) as Record<string, unknown>;

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
// Group 4 — a stale `state` or `live` key is INERT, whatever shape it is in
// (quick task 260923-3w7, replacing two `.catch(undefined)` mirrors)
// ---------------------------------------------------------------------------

/**
 * TWO GROUPS AND FOURTEEN CASES STOOD HERE. One mirrored
 * `EventArtifactSchema.state`'s `.catch(undefined)` (260915-isq), the other
 * `LiveEventArtifactSchema.live`'s (260918-16t): each enumerated the malformed
 * shapes its guard had to tolerate, because something downstream WALKED the
 * block's rows and a non-object row threw a raw `TypeError` out through the
 * tick's blanket catch — costing the event its publish every tick, forever.
 *
 * Nothing walks either block now, and neither key is declared on the schema, so
 * there is one claim left and it covers every shape at once: the guard passes the
 * artifact, the merge emits neither key, and the published bytes match the
 * zod-parsed path. Enumerating malformed shapes against a key nobody
 * dereferences would be testing zod.
 */
describe("a stale `state` or `live` key of any shape is dropped, and the artifact is not", () => {
  const stale: [string, Record<string, unknown>][] = [
    ["a string at `state`", { state: "stale" }],
    ["null at `state`", { state: null }],
    ["a `state` whose rows are not an array", { state: { rows: {} } }],
    ["a `state` with a non-object row", { state: { rows: [null] } }],
    ["a WELL-FORMED-looking `state`", { state: { algorithmId: "spr", algorithmVersion: "9.9.9", snapshotShapeVersion: 1, rows: [{ scopeKind: "league", scopeKey: "l", stateJson: "{}" }] } }],
    ["a string at `live`", { live: "stale" }],
    ["a `live` whose rows are not an array", { live: { metricKeys: ["total"], rows: {} } }],
    ["a WELL-FORMED `live`", { live: { metricKeys: ["total"], rows: [{ m: `${EVENT_KEY}_qm1`, t: [TEAMS[0]!], v: [[40]] }] } }],
    ["BOTH at once", { state: { rows: [null] }, live: "stale" }],
  ];

  for (const [name, keys] of stale) {
    it(`${name}: the guard accepts the artifact, the merge emits neither key, and every other key survives`, () => {
      const raw = { ...offlineEventArtifact(), ...keys };
      const guarded = checkLiveEventArtifactShape(json(raw));
      expect(guarded).toBeDefined();
      const merged = mergeEvent(guarded) as Record<string, unknown>;
      expect(merged).not.toHaveProperty("state");
      expect(merged).not.toHaveProperty("live");
      expect(merged.alliances).toEqual((raw as Record<string, unknown>).alliances);
      expect(merged.matches).toBeDefined();
      expect(merged.teams).toBeDefined();
    });
  }

  it("the merged artifact is byte-identical to the zod-parsed path, which strips the same undeclared keys", () => {
    const raw = { ...offlineEventArtifact(), state: { rows: [null] }, live: { metricKeys: ["total"], rows: {} } };
    expect(publishedEventBytes(mergeEvent(checkLiveEventArtifactShape(json(raw))))).toBe(publishedEventBytes(mergeEvent(EventArtifactSchema.parse(json(raw)))));
  });

  it("an absent key stays absent — neither the guard nor the merge adds one of its own", () => {
    const raw = offlineEventArtifact();
    expect(raw).not.toHaveProperty("state");
    expect(raw).not.toHaveProperty("live");
    const merged = mergeEvent(checkLiveEventArtifactShape(json(raw))) as Record<string, unknown>;
    expect(merged).not.toHaveProperty("state");
    expect(merged).not.toHaveProperty("live");
  });
});
