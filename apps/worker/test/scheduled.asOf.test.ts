/**
 * Quick task 261005-5g0, Part 2: the tick's as-of capture.
 *
 *   - PARITY: `runTick` over two interleaved events (one team playing both,
 *     so it opens several segments at each, and one tick that folds two matches
 *     at once), against an independent offline arm that drives the publisher's
 *     own `AsOfSeasonCapture` and the real `SigmaScoutLayer` over the same
 *     matches in the same order. Every INDEX, LOG and the season object are
 *     deep equal apart from the generation/computedAt stamps, with a seeded
 *     season object (its `L0` preserved) and without one (`L0: null`).
 *   - BEST EFFORT: an R2 failure in the as-of write, or a corrupt as-of object,
 *     logs one line and leaves the event "advanced", with the D1 rows and every
 *     other R2 object byte identical to a run whose as-of write succeeded.
 *
 * Fakes are duplicated rather than shared, this directory's convention (see
 * `scheduled.replay.test.ts`'s header). The breakdowns are real 2026 ones, so
 * the RP part of each tuple and the league's RP population are exercised.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { runTick } from "../src/scheduled.js";
import { AsOfTickCapture, type AsOfModelView } from "../src/asOfCapture.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { spr, type SprState } from "../../../packages/core/algorithms/spr.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { TOTAL_METRIC_KEY, type MatchResult } from "../../../packages/core/algorithms/types.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { SigmaScoutLayer } from "../../../packages/harness/sigmaScoutLayer.js";
import { AsOfSeasonCapture, type AsOfSeasonCaptureResult } from "../../../packages/harness/asOfCapture.js";
import { AsOfIndexSchema, AsOfLogSchema, AsOfSeasonSchema, type AsOfIndex, type AsOfLog, type AsOfSeason } from "../../../packages/harness/asOfState.js";
import { artifactKey, asOfIndexKey, asOfLogKey, asOfSeasonKey } from "../../../packages/harness/pageArtifacts.js";
import { seedStateBaselineMarkers } from "./support/stateBaseline.js";
import { IngestLogFakeStore, isIngestLogSql } from "./support/ingestLogFake.js";
import { officialDataStubResponse } from "./support/officialDataStubs.js";
import type { Env } from "../src/env.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeAlgorithmStateRow {
  algorithm_id: string;
  algorithm_version: string;
  scope_kind: string;
  scope_key: string;
  state_json: string;
  generation: string;
  computed_at: string;
}

interface FakeEventCursorRow {
  event_key: string;
  tba_etag: string | null;
  last_folded_match_key: string | null;
  last_polled_at: string | null;
  last_advanced_at: string | null;
}

class FakePreparedStatement {
  readonly sql: string;
  boundArgs: readonly unknown[] = [];
  constructor(
    sql: string,
    private readonly db: FakeD1Database
  ) {
    this.sql = sql;
  }
  bind(...args: unknown[]): FakePreparedStatement {
    const bound = new FakePreparedStatement(this.sql, this.db);
    bound.boundArgs = args;
    return bound;
  }
  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: this.db.executeSelect(this.sql, this.boundArgs) as T[] };
  }
  async first<T = unknown>(): Promise<T | null> {
    const results = this.db.executeSelect(this.sql, this.boundArgs) as T[];
    return results.length > 0 ? results[0]! : null;
  }
  async run(): Promise<{ success: true; meta: { changes: number } }> {
    return { success: true, meta: { changes: this.db.executeWrite(this.sql, this.boundArgs) } };
  }
}

class FakeD1Database {
  algorithmState = new Map<string, FakeAlgorithmStateRow>();
  eventCursors = new Map<string, FakeEventCursorRow>();
  readonly ingestLog = new IngestLogFakeStore();

  constructor() {
    seedStateBaselineMarkers(this.eventCursors, ["spr"], "gen-1");
  }

  prepare(sql: string): FakePreparedStatement {
    return new FakePreparedStatement(sql, this);
  }

  async batch(statements: readonly FakePreparedStatement[]): Promise<{ success: true }[]> {
    for (const stmt of statements) this.executeWrite(stmt.sql, stmt.boundArgs);
    return statements.map(() => ({ success: true as const }));
  }

  executeSelect(sql: string, args: readonly unknown[]): unknown[] {
    if (sql.includes("FROM algorithm_state")) {
      const algorithmId = args[0] as string;
      const groupSizes = [...sql.matchAll(/\(scope_kind = \? AND scope_key IN \(([^)]*)\)\)/g)].map((m) => m[1]!.split(",").filter((s) => s.length > 0).length);
      if (groupSizes.length === 0) {
        return [...this.algorithmState.values()].filter((row) => row.algorithm_id === algorithmId && row.scope_kind === "league");
      }
      let idx = 1;
      const matchers: { scopeKind: string; keySet: Set<string> }[] = [];
      for (const size of groupSizes) {
        const scopeKind = args[idx] as string;
        idx += 1;
        const keys = args.slice(idx, idx + size) as string[];
        idx += size;
        matchers.push({ scopeKind, keySet: new Set(keys) });
      }
      return [...this.algorithmState.values()].filter((row) => {
        if (row.algorithm_id !== algorithmId) return false;
        if (row.scope_kind === "league") return true;
        return matchers.some((m) => m.scopeKind === row.scope_kind && m.keySet.has(row.scope_key));
      });
    }
    if (sql.includes("FROM event_cursor")) {
      const eventKeys = args as string[];
      return eventKeys.map((key) => this.eventCursors.get(key)).filter((row): row is FakeEventCursorRow => row !== undefined);
    }
    throw new Error(`FakeD1Database.executeSelect: unrecognized SQL: ${sql}`);
  }

  executeWrite(sql: string, args: readonly unknown[]): number {
    if (isIngestLogSql(sql)) return this.ingestLog.apply(sql, args);
    if (sql.includes("INSERT INTO algorithm_state")) {
      const [algorithmId, algorithmVersion, scopeKind, scopeKey, stateJson, generation, computedAt] = args as string[];
      this.algorithmState.set(`${algorithmId}::${scopeKind}::${scopeKey}`, {
        algorithm_id: algorithmId!,
        algorithm_version: algorithmVersion!,
        scope_kind: scopeKind!,
        scope_key: scopeKey!,
        state_json: stateJson!,
        generation: generation!,
        computed_at: computedAt!,
      });
      return 1;
    }
    const cursorRow = (eventKey: string, tbaEtag: string | null, lastFoldedMatchKey: string | null, lastPolledAt: string | null, lastAdvancedAt: string | null): FakeEventCursorRow => ({
      event_key: eventKey,
      tba_etag: tbaEtag ?? null,
      last_folded_match_key: lastFoldedMatchKey ?? null,
      last_polled_at: lastPolledAt ?? null,
      last_advanced_at: lastAdvancedAt ?? null,
    });
    if (sql.includes("UPDATE event_cursor") && sql.includes("WHERE event_key")) {
      const [tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt, eventKey, expectedPrior] = args as (string | null)[];
      const existing = this.eventCursors.get(eventKey!);
      const currentPrior = existing ? existing.last_folded_match_key : null;
      if (!existing || currentPrior !== (expectedPrior ?? null)) return 0;
      this.eventCursors.set(eventKey!, cursorRow(eventKey!, tbaEtag!, lastFoldedMatchKey!, lastPolledAt!, lastAdvancedAt!));
      return 1;
    }
    if (sql.includes("INSERT INTO event_cursor") && sql.includes("WHERE NOT EXISTS")) {
      const [eventKey, tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt] = args as (string | null)[];
      if (this.eventCursors.has(eventKey as string)) return 0;
      this.eventCursors.set(eventKey as string, cursorRow(eventKey!, tbaEtag!, lastFoldedMatchKey!, lastPolledAt!, lastAdvancedAt!));
      return 1;
    }
    if (sql.includes("INSERT INTO event_cursor")) {
      const [eventKey, tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt] = args as (string | null)[];
      this.eventCursors.set(eventKey as string, cursorRow(eventKey!, tbaEtag!, lastFoldedMatchKey!, lastPolledAt!, lastAdvancedAt!));
      return 1;
    }
    throw new Error(`FakeD1Database.executeWrite: unrecognized SQL: ${sql}`);
  }
}

class FakeR2Object {
  constructor(private readonly value: string) {}
  async text(): Promise<string> {
    return this.value;
  }
}

class FakeR2Bucket {
  readonly puts: { key: string; body: string }[] = [];
  readonly store = new Map<string, string>();
  /** When set, every put whose key starts with it throws, as an R2 outage would. */
  failPutsWithPrefix: string | undefined;

  async put(key: string, body: string): Promise<void> {
    if (this.failPutsWithPrefix !== undefined && key.startsWith(this.failPutsWithPrefix)) throw new Error(`R2 put failed: ${key}`);
    this.puts.push({ key, body });
    this.store.set(key, body);
  }
  async get(key: string): Promise<FakeR2Object | null> {
    const value = this.store.get(key);
    return value === undefined ? null : new FakeR2Object(value);
  }
  seed(key: string, body: string): void {
    this.store.set(key, body);
  }
}

// ---------------------------------------------------------------------------
// Fixture: two interleaved 2026 Regionals
// ---------------------------------------------------------------------------

const SEASON = 2026;
const EVENT_A = "2026aaa";
const EVENT_B = "2026bbb";
const NOW_MS = Date.parse("2026-08-22T12:00:00.000Z");
const NOW_SEC = Math.floor(NOW_MS / 1000);
const RULES = RP_RULE_MODULES[SEASON]!;
const VARS = RULES.thresholdVariables.map((v) => v.name);
const WINDOWS = [EVENT_A, EVENT_B].map((eventKey) => ({ eventKey, season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000, inferred: false }));
const KEY_PARAMS = { algorithmId: spr.id, version: spr.version };

interface MatchFixture {
  readonly eventKey: string;
  readonly matchNumber: number;
  /** Seconds after `NOW_SEC`: the match's TBA `actual_time`. */
  readonly offsetSec: number;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly redScore: number;
  readonly blueScore: number;
  readonly redHub: number;
  readonly blueHub: number;
  readonly redTower: number;
  readonly blueTower: number;
}

function fixture(eventKey: string, matchNumber: number, offsetSec: number, red: readonly string[], blue: readonly string[], scores: [number, number], hub: [number, number], tower: [number, number]): MatchFixture {
  return { eventKey, matchNumber, offsetSec, redTeams: red, blueTeams: blue, redScore: scores[0], blueScore: scores[1], redHub: hub[0], blueHub: hub[1], redTower: tower[0], blueTower: tower[1] };
}

/**
 * frc1 plays A, then B, then A twice, then B, then A: three segments at A and two
 * at B. frc7 first plays in the third tick, after the league row exists, so it
 * enters with no state at all.
 */
const A1 = fixture(EVENT_A, 1, 60, ["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"], [133, 121], [155, 128], [45, 38]);
const B1 = fixture(EVENT_B, 1, 120, ["frc1", "frc8", "frc9"], ["frc10", "frc11", "frc12"], [99, 147], [104, 178], [27, 63]);
const A2 = fixture(EVENT_A, 2, 180, ["frc1", "frc2", "frc4"], ["frc3", "frc5", "frc7"], [126, 118], [149, 124], [41, 36]);
const A3 = fixture(EVENT_A, 3, 240, ["frc2", "frc6", "frc7"], ["frc1", "frc3", "frc4"], [152, 144], [181, 167], [58, 51]);
const B2 = fixture(EVENT_B, 2, 300, ["frc8", "frc9", "frc10"], ["frc11", "frc12", "frc1"], [120, 95], [140, 90], [42, 28]);
const A4 = fixture(EVENT_A, 4, 360, ["frc1", "frc5", "frc6"], ["frc2", "frc3", "frc7"], [105, 130], [118, 165], [31, 55]);

const A_MATCHES = [A1, A2, A3, A4];
const B_MATCHES = [B1, B2];

/** Per tick, how many of each event's matches TBA reveals. Exactly one event moves per tick, so the fold order is fixed; the third tick folds two matches at once. */
const TICKS: readonly { a: number; b: number }[] = [
  { a: 1, b: 0 },
  { a: 1, b: 1 },
  { a: 3, b: 1 },
  { a: 3, b: 2 },
  { a: 4, b: 2 },
];
/** The order the Worker folds them in, which the offline arm must reproduce. */
const FOLD_ORDER = [A1, B1, A2, A3, B2, A4];

function matchKeyOf(f: MatchFixture): string {
  return `${f.eventKey}_qm${f.matchNumber}`;
}

function sortTimeOf(f: MatchFixture): number {
  return (NOW_SEC + f.offsetSec) * 1000;
}

function breakdownOf(f: MatchFixture): unknown {
  const side = (hub: number, tower: number) => ({
    autoTowerPoints: Math.round(tower / 2),
    endGameTowerPoints: tower - Math.round(tower / 2),
    hubScore: { totalCount: hub },
    energizedAchieved: hub >= 100,
    superchargedAchieved: hub >= 360,
    traversalAchieved: tower >= 40,
  });
  return { red: side(f.redHub, f.redTower), blue: side(f.blueHub, f.blueTower) };
}

function toTbaMatch(f: MatchFixture): unknown {
  return {
    key: matchKeyOf(f),
    event_key: f.eventKey,
    comp_level: "qm",
    set_number: 1,
    match_number: f.matchNumber,
    time: null,
    predicted_time: null,
    actual_time: NOW_SEC + f.offsetSec,
    winning_alliance: f.redScore > f.blueScore ? "red" : "blue",
    alliances: {
      red: { team_keys: f.redTeams, surrogate_team_keys: [], dq_team_keys: [], score: f.redScore },
      blue: { team_keys: f.blueTeams, surrogate_team_keys: [], dq_team_keys: [], score: f.blueScore },
    },
    score_breakdown: breakdownOf(f),
  };
}

/** The same match as the offline arm folds it: the fields the tick's own `toMatchResult` produces for it. */
function toMatchResult(f: MatchFixture): MatchResult {
  return {
    matchKey: matchKeyOf(f),
    eventKey: f.eventKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: f.matchNumber,
    redTeams: f.redTeams,
    blueTeams: f.blueTeams,
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    eventType: 0,
    week: null,
    winner: f.redScore > f.blueScore ? "red" : "blue",
    redScore: f.redScore,
    blueScore: f.blueScore,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: JSON.stringify(breakdownOf(f)),
  };
}

let revealed = { a: 0, b: 0 };

function makeTbaFetchStub(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    const quietOfficialData = officialDataStubResponse(u);
    if (quietOfficialData !== undefined) return quietOfficialData;
    const matchesRoute = /\/event\/([^/]+)\/matches$/.exec(u);
    if (matchesRoute) {
      const eventKey = matchesRoute[1]!;
      const list = eventKey === EVENT_A ? A_MATCHES.slice(0, revealed.a) : B_MATCHES.slice(0, revealed.b);
      return { status: 200, ok: true, headers: { get: (name: string) => (name === "etag" ? `etag-${eventKey}-${list.length}` : null) }, json: async () => list.map(toTbaMatch) };
    }
    const detailRoute = /\/event\/([^/]+)$/.exec(u);
    if (detailRoute) {
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ key: detailRoute[1], name: detailRoute[1], year: SEASON, event_type: 0, start_date: "2026-08-01" }) };
    }
    if (/\/event\/[^/]+\/teams\/simple$/.test(u)) return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
    throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
  });
}

function makeEnv(d1: FakeD1Database, r2: FakeR2Bucket): Env {
  r2.seed(LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", windows: WINDOWS }));
  r2.seed(
    ALGORITHMS_MANIFEST_KEY,
    JSON.stringify({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-08-22T00:00:00.000Z",
      algorithms: [{ id: "spr", version: spr.version, codeVersion: spr.version.split("+")[0]!, paramSetName: spr.version.split("+")[1] ?? "baseline" }],
    })
  );
  return { DB: d1 as unknown as D1Database, ARTIFACTS: r2 as unknown, TBA_API_KEY: "test-key", TBA_BASE_URL: "https://tba.example.invalid/api/v3", LIVE_ALGORITHM_IDS: "spr" } as Env;
}

interface Drive {
  readonly d1: FakeD1Database;
  readonly r2: FakeR2Bucket;
  /** The INDEX row count of each event after each tick. */
  readonly rowsAfterTick: { a: number; b: number }[];
}

async function drive(options: { seedSeason?: AsOfSeason; failAsOfPuts?: boolean; seedCorruptIndex?: boolean } = {}): Promise<Drive> {
  const d1 = new FakeD1Database();
  const r2 = new FakeR2Bucket();
  if (options.seedSeason !== undefined) r2.seed(asOfSeasonKey({ season: SEASON, ...KEY_PARAMS }), JSON.stringify(options.seedSeason));
  if (options.seedCorruptIndex === true) r2.seed(asOfIndexKey({ eventKey: EVENT_A, ...KEY_PARAMS }), "{ not json");
  if (options.failAsOfPuts === true) r2.failPutsWithPrefix = "v1/asof";
  vi.stubGlobal("fetch", makeTbaFetchStub());
  const env = makeEnv(d1, r2);
  const rowsAfterTick: { a: number; b: number }[] = [];
  for (const [i, tick] of TICKS.entries()) {
    revealed = tick;
    const result = await runTick(env, { nowMs: NOW_MS + i * 60_000 });
    expect(result.eventsFailed, `tick ${i}`).toBe(0);
    expect(result.eventsAdvanced, `tick ${i}`).toBe(1);
    const rows = (eventKey: string): number => {
      const body = r2.store.get(asOfIndexKey({ eventKey, ...KEY_PARAMS }));
      if (body === undefined) return 0;
      try {
        return AsOfIndexSchema.parse(JSON.parse(body)).m.length;
      } catch {
        return -1;
      }
    };
    rowsAfterTick.push({ a: rows(EVENT_A), b: rows(EVENT_B) });
  }
  return { d1, r2, rowsAfterTick };
}

// ---------------------------------------------------------------------------
// The offline arm
// ---------------------------------------------------------------------------

const OFFLINE_STAMP = { generation: "offline", computedAt: "2026-01-01T00:00:00.000Z", algorithmId: spr.id, algorithmVersion: spr.version };
/** The tick's cold start: `initState` over the first tick's real touched teams (`loadOrInitState`), sorted as the tick sorts them. */
const COLD_START_TEAMS = [...new Set([...A1.redTeams, ...A1.blueTeams])].sort();

/** The publisher's own capture over `matches`, folded exactly as `publish.ts` folds a season: SPR, then the layer. */
function offlineCapture(matches: readonly MatchFixture[]): AsOfSeasonCaptureResult {
  const sortTimes = new Map(FOLD_ORDER.map((f) => [matchKeyOf(f), sortTimeOf(f)]));
  let state = spr.initState(COLD_START_TEAMS) as SprState;
  const capture = new AsOfSeasonCapture({ season: SEASON, vars: VARS, initialState: state, stamp: OFFLINE_STAMP, sortTimeOf: (matchKey) => sortTimes.get(matchKey) });
  // Explicit: the Worker resumes the RP cold-team prior on, so the offline arm does too (`scheduled.rp.test.ts`).
  const layer = new SigmaScoutLayer(RULES, spr.id, { rpColdPrior: true });
  capture.attachLayer(layer);
  for (const f of matches) {
    const result = toMatchResult(f);
    const prediction = spr.predict(state, toLeakProofUpcoming(result));
    state = spr.update(state, result);
    capture.onMatchComplete(result, state);
    const roster = [...result.redTeams, ...result.blueTeams];
    const metrics = spr.teamMetrics(state, roster);
    const talent = new Map<string, number>();
    for (const teamKey of roster) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    capture.foldLayer(result, () => layer.foldPlayed(result, prediction, talent));
  }
  return capture.finish();
}

/** Drops the two per-run stamps, the only fields the plan allows to differ. */
function unstamped<T extends { generation: string; computedAt: string }>(object: T): Omit<T, "generation" | "computedAt"> {
  const { generation: _g, computedAt: _c, ...rest } = object;
  return rest;
}

function read<T>(r2: FakeR2Bucket, key: string, schema: { parse(input: unknown): T }): T {
  const body = r2.store.get(key);
  expect(body, `nothing at ${key}`).toBeDefined();
  return schema.parse(JSON.parse(body!));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  revealed = { a: 0, b: 0 };
});

describe("scheduled.asOf — the tick's capture equals the offline publisher's", () => {
  it(
    "PARITY with a season object the publisher wrote: every INDEX, LOG and the season object are deep equal to the offline capture's apart from the stamps, and L0 is preserved",
    async () => {
      // What the publisher would have written before the season's first match: L0 set, no tails.
      const seasonAtStart = offlineCapture([]).season;
      expect(seasonAtStart.L0).not.toBeNull();
      const { r2, rowsAfterTick } = await drive({ seedSeason: seasonAtStart });
      const offline = offlineCapture(FOLD_ORDER);

      for (const eventKey of [EVENT_A, EVENT_B]) {
        const index: AsOfIndex = read(r2, asOfIndexKey({ eventKey, ...KEY_PARAMS }), AsOfIndexSchema);
        const log: AsOfLog = read(r2, asOfLogKey({ eventKey, ...KEY_PARAMS }), AsOfLogSchema);
        expect(unstamped(index), `${eventKey} INDEX`).toEqual(unstamped(offline.indexes.get(eventKey)!));
        expect(unstamped(log), `${eventKey} LOG`).toEqual(unstamped(offline.logs.get(eventKey)!));
        expect(index.algorithmId).toBe("spr");
        expect(index.algorithmVersion).toBe(spr.version);
      }
      const season = read(r2, asOfSeasonKey({ season: SEASON, ...KEY_PARAMS }), AsOfSeasonSchema);
      expect(unstamped(season)).toEqual(unstamped(offline.season));
      expect(season.L0).toEqual(seasonAtStart.L0);

      // `t` is each match's own sort_time, as the tick normalized it from TBA's actual_time.
      const indexA = read(r2, asOfIndexKey({ eventKey: EVENT_A, ...KEY_PARAMS }), AsOfIndexSchema);
      expect(indexA.m).toEqual(A_MATCHES.map((f) => [matchKeyOf(f), sortTimeOf(f)]));

      // Non-vacuity: the interleave opened three segments for frc1 at A and two at B, frc7 entered with no state,
      // the third tick folded two matches in one go, and the RP part was really captured.
      expect(indexA.teams.frc1!.length).toBe(3);
      expect(read(r2, asOfIndexKey({ eventKey: EVENT_B, ...KEY_PARAMS }), AsOfIndexSchema).teams.frc1!.length).toBe(2);
      expect(indexA.teams.frc7![0]!.s).toEqual([null, null, null]);
      expect(indexA.teams.frc7![0]!.x[0]).not.toBeNull();
      expect(rowsAfterTick.map((r) => r.a)).toEqual([1, 1, 3, 3, 4]);
      expect(rowsAfterTick.map((r) => r.b)).toEqual([0, 1, 1, 2, 2]);
      expect(indexA.teams.frc1![2]!.x[2]?.some((part) => part !== null)).toBe(true);
      expect(season.tails.frc1).toEqual([EVENT_A, sortTimeOf(A4), 3]);
      // lb (the league before each event's first row) is captured by both writers and compared above:
      // A's is the season start row, B's the row A1 left, since A1 is the fold before B1.
      expect(indexA.lb).toEqual(seasonAtStart.L0);
      const logA = read(r2, asOfLogKey({ eventKey: EVENT_A, ...KEY_PARAMS }), AsOfLogSchema);
      expect(read(r2, asOfIndexKey({ eventKey: EVENT_B, ...KEY_PARAMS }), AsOfIndexSchema).lb).toEqual(logA.rows[0]!.L);
    },
    60_000
  );

  it(
    "PARITY with no season object in R2: the Worker creates one with L0 null, and everything else still equals the offline capture",
    async () => {
      const { r2 } = await drive();
      const offline = offlineCapture(FOLD_ORDER);
      for (const eventKey of [EVENT_A, EVENT_B]) {
        expect(unstamped(read(r2, asOfIndexKey({ eventKey, ...KEY_PARAMS }), AsOfIndexSchema))).toEqual(unstamped(offline.indexes.get(eventKey)!));
        expect(unstamped(read(r2, asOfLogKey({ eventKey, ...KEY_PARAMS }), AsOfLogSchema))).toEqual(unstamped(offline.logs.get(eventKey)!));
      }
      const season = read(r2, asOfSeasonKey({ season: SEASON, ...KEY_PARAMS }), AsOfSeasonSchema);
      expect(season.L0).toBeNull();
      expect(unstamped({ ...season, L0: offline.season.L0 })).toEqual(unstamped(offline.season));
    },
    60_000
  );
});

describe("scheduled.asOf — best effort", () => {
  /** Every R2 object except the as-of ones, and every D1 row, of one run. */
  function nonAsOfOutputs(run: Drive): { r2: [string, string][]; d1: [string, FakeAlgorithmStateRow][] } {
    const r2 = [...run.r2.store.entries()].filter(([key]) => !key.startsWith("v1/asof")).sort(([a], [b]) => (a < b ? -1 : 1));
    const d1 = [...run.d1.algorithmState.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    return { r2, d1 };
  }

  it(
    "an R2 failure in the as-of write logs one line per event tick and leaves the event advanced, with every other object and D1 row identical to a successful run",
    async () => {
      const healthy = await drive();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const failing = await drive({ failAsOfPuts: true });

      const asOfWarnings = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("asof-write-failed"));
      expect(asOfWarnings).toHaveLength(TICKS.length);
      expect(JSON.parse(asOfWarnings[0]!)).toMatchObject({ msg: "asof-write-failed", eventKey: EVENT_A, algorithmId: "spr" });
      expect(failing.r2.puts.some((put) => put.key.startsWith("v1/asof"))).toBe(false);
      expect(nonAsOfOutputs(failing)).toEqual(nonAsOfOutputs(healthy));
      // Non-vacuity: the comparison covers the event and team artifacts and real D1 rows.
      const keys = nonAsOfOutputs(healthy).r2.map(([key]) => key);
      expect(keys).toContain(artifactKey({ page: "event", eventKey: EVENT_A, algorithmId: "spr", version: spr.version }));
      expect(keys).toContain(artifactKey({ page: "team", teamKey: "frc1", year: SEASON, algorithmId: "spr", version: spr.version }));
      expect(nonAsOfOutputs(healthy).d1.length).toBeGreaterThan(10);
    },
    60_000
  );

  it(
    "a corrupt as-of INDEX is never replaced by a fresh one: the event's as-of write is skipped with one line, the event still advances, and the other event's objects are written",
    async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const run = await drive({ seedCorruptIndex: true });
      const asOfWarnings = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("asof-write-failed"));
      // Ticks 0, 2 and 4 fold at A.
      expect(asOfWarnings).toHaveLength(3);
      expect(asOfWarnings.every((line) => (JSON.parse(line) as { eventKey: string }).eventKey === EVENT_A)).toBe(true);
      expect(run.r2.store.get(asOfIndexKey({ eventKey: EVENT_A, ...KEY_PARAMS }))).toBe("{ not json");
      expect(run.r2.puts.some((put) => put.key === asOfLogKey({ eventKey: EVENT_A, ...KEY_PARAMS }))).toBe(false);
      expect(run.rowsAfterTick.map((r) => r.b)).toEqual([0, 1, 1, 2, 2]);
    },
    60_000
  );

  it("a read that throws inside Phase A is held, never thrown into the fold: later calls are no-ops and Phase B gets the error", () => {
    const capture = new AsOfTickCapture(VARS);
    const result = toMatchResult(A1);
    const broken = new Error("belief read failed");
    const view: AsOfModelView = {
      state: spr.initState(COLD_START_TEAMS) as SprState,
      sigma: {
        beliefFor: () => {
          throw broken;
        },
        population: () => ({ sumSquares: 0, talentSquares: 0, count: 0 }),
      },
      rp: undefined,
      meanShift: undefined,
    };
    const before = capture.before(result, view);
    expect(before).toBeUndefined();
    expect(() => capture.after(result, sortTimeOf(A1), before, view)).not.toThrow();
    expect(capture.folds).toEqual([]);
    expect(capture.error).toBe(broken);
    // A healthy view afterwards stays a no-op: one broken match must not leave a gap inside a captured run.
    const healthy: AsOfModelView = { ...view, sigma: undefined };
    expect(capture.before(toMatchResult(A2), healthy)).toBeUndefined();
    expect(capture.folds).toEqual([]);
  });
});
