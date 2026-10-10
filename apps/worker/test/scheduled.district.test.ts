/**
 * The district pass (10-05), driven through the REAL `runTick` with injected
 * fakes for D1 and R2 and a stubbed `fetch` — no network, no wrangler.
 *
 * The fakes below are deliberately DUPLICATED from `scheduled.test.ts` rather
 * than extracted into a shared harness, following this directory's stated
 * convention (see `scheduled.phaseBWrites.test.ts`'s header): a Worker test
 * file owns its own fakes so a change made for one file's scenario cannot
 * silently alter another's. The TBA stub here additionally serves
 * `/district/{key}/rankings` and `/event/{key}/awards`, both ETag-conditional.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTick } from "../src/scheduled.js";
import { liveDistrictsOf } from "../src/districtRefresh.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { districtDetailKey, DistrictArtifactSchema } from "../../../packages/harness/pageArtifacts.js";
import { recomputeDistrictVerdicts } from "../../../packages/harness/districtRankingsMerge.js";
import { districtEventStateFinished } from "../../../packages/core/districts/reservedSlots.js";
import { districtRankingsCursorKey } from "../../../packages/harness/stateBaseline.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../packages/harness/publishedAlgorithms.js";
import { seedStateBaselineMarkers } from "./support/stateBaseline.js";
import type { LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import type { Env } from "../src/env.js";
import type { D1Database } from "@cloudflare/workers-types";
import { IngestLogFakeStore, isIngestLogSql } from "./support/ingestLogFake.js";
import { officialDataStubResponse } from "./support/officialDataStubs.js";

// ---------------------------------------------------------------------------
// Fakes (duplicated from scheduled.test.ts — see this file's header)
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
    this.db.callCount++;
    return { results: this.db.executeSelect(this.sql, this.boundArgs) as T[] };
  }
  async first<T = unknown>(): Promise<T | null> {
    this.db.callCount++;
    const results = this.db.executeSelect(this.sql, this.boundArgs) as T[];
    return results.length > 0 ? results[0]! : null;
  }
  async run(): Promise<{ success: true; meta: { changes: number } }> {
    this.db.callCount++;
    const changes = this.db.executeWrite(this.sql, this.boundArgs);
    return { success: true, meta: { changes } };
  }
}

class FakeD1Database {
  batchCallCount = 0;
  algorithmState = new Map<string, FakeAlgorithmStateRow>();
  eventCursors = new Map<string, FakeEventCursorRow>();
  /** The ingest log table (quick task 261004-uyc). */
  readonly ingestLog = new IngestLogFakeStore();
  /** Cursor rows whose whole row UPSERT must reject, modelling a D1 write failure (quick task 261009-r9x). */
  rejectCursorWritesForKeyPrefix: string | null = null;
  /** Every D1 call the Worker made: one per statement run and one per batch (quick task 261009-tx6). What a subrequest count is checked against. */
  callCount = 0;
  /** The keys of every `event_cursor` SELECT, in order (quick task 261009-tx6). */
  cursorSelects: string[][] = [];
  /** An `event_cursor` SELECT naming a key with this prefix rejects, modelling a D1 read failure (quick task 261009-tx6). */
  rejectCursorReadsForKeyPrefix: string | null = null;

  constructor() {
    seedStateBaselineMarkers(this.eventCursors, PUBLISHED_ALGORITHM_IDS, "gen-1");
  }

  prepare(sql: string): FakePreparedStatement {
    return new FakePreparedStatement(sql, this);
  }

  async batch(statements: readonly FakePreparedStatement[]): Promise<{ success: true }[]> {
    this.batchCallCount++;
    this.callCount++;
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
      this.cursorSelects.push([...eventKeys]);
      const rejectPrefix = this.rejectCursorReadsForKeyPrefix;
      if (rejectPrefix !== null && eventKeys.some((key) => key.startsWith(rejectPrefix))) throw new Error("fake D1 cursor read rejected");
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
    if (sql.includes("UPDATE event_cursor") && sql.includes("WHERE event_key")) {
      const [tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt, eventKey, expectedPrior] = args as (string | null)[];
      const existing = this.eventCursors.get(eventKey!);
      const currentPrior = existing ? existing.last_folded_match_key : null;
      if (!existing || currentPrior !== (expectedPrior ?? null)) return 0;
      this.eventCursors.set(eventKey!, { event_key: eventKey!, tba_etag: tbaEtag ?? null, last_folded_match_key: lastFoldedMatchKey ?? null, last_polled_at: lastPolledAt ?? null, last_advanced_at: lastAdvancedAt ?? null });
      return 1;
    }
    if (sql.includes("INSERT INTO event_cursor") && sql.includes("WHERE NOT EXISTS")) {
      const [eventKey, tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt] = args as (string | null)[];
      if (this.eventCursors.has(eventKey as string)) return 0;
      this.eventCursors.set(eventKey as string, { event_key: eventKey as string, tba_etag: tbaEtag ?? null, last_folded_match_key: lastFoldedMatchKey ?? null, last_polled_at: lastPolledAt ?? null, last_advanced_at: lastAdvancedAt ?? null });
      return 1;
    }
    if (sql.includes("INSERT INTO event_cursor")) {
      const [eventKey, tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt] = args as (string | null)[];
      if (this.rejectCursorWritesForKeyPrefix !== null && eventKey!.startsWith(this.rejectCursorWritesForKeyPrefix)) {
        throw new Error(`fake D1 cursor write rejected for ${eventKey}`);
      }
      this.eventCursors.set(eventKey!, { event_key: eventKey!, tba_etag: tbaEtag ?? null, last_folded_match_key: lastFoldedMatchKey ?? null, last_polled_at: lastPolledAt ?? null, last_advanced_at: lastAdvancedAt ?? null });
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
  getCallCount = 0;
  putCallCount = 0;
  puts: { key: string; body: string }[] = [];
  /** Every key `get` was called with, in order — what the "a steady-state district costs no R2 read" assertion inspects. */
  gets: string[] = [];
  /** Keys whose `put` must reject, modelling an R2 failure AFTER the subrequest was counted. */
  rejectPutsForKeyPrefix: string | null = null;
  private readonly store = new Map<string, string>();

  async put(key: string, body: string): Promise<void> {
    this.putCallCount++;
    if (this.rejectPutsForKeyPrefix !== null && key.startsWith(this.rejectPutsForKeyPrefix)) {
      throw new Error(`fake R2 put rejected for ${key}`);
    }
    this.puts.push({ key, body });
    this.store.set(key, body);
  }

  async get(key: string): Promise<FakeR2Object | null> {
    this.getCallCount++;
    this.gets.push(key);
    const value = this.store.get(key);
    return value === undefined ? null : new FakeR2Object(value);
  }

  /** Pre-load an object as if an offline publish had written it — deliberately NOT counted in `putCallCount`/`puts`. */
  seed(key: string, body: string): void {
    this.store.set(key, body);
  }

  /** What the bucket holds at `key` right now, read by the TEST: not a `get`, so it is counted nowhere. */
  peek(key: string): string | undefined {
    return this.store.get(key);
  }
}

function makeEnv(manifests: Map<string, string>, d1: FakeD1Database, r2: FakeR2Bucket): Env {
  for (const [key, body] of manifests) r2.seed(key, body);
  return { DB: d1 as unknown as D1Database, ARTIFACTS: r2 as unknown, TBA_API_KEY: "test-key", TBA_BASE_URL: "https://tba.example.invalid/api/v3", LIVE_ALGORITHM_IDS: "opr" } as Env;
}

// ---------------------------------------------------------------------------
// Manifest / TBA fixtures
// ---------------------------------------------------------------------------

interface WindowFixture {
  eventKey: string;
  season: number;
  startMs: number;
  endMs: number;
  inferred?: boolean;
  /** Omitted entirely when `undefined` — that is the PRE-PHASE-10 manifest shape, which must make the whole pass a no-op. */
  districtKey?: string | null;
}

function liveWindowsManifest(windows: readonly WindowFixture[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-22T00:00:00.000Z",
    windows: windows.map((w) => ({
      eventKey: w.eventKey,
      season: w.season,
      startMs: w.startMs,
      endMs: w.endMs,
      inferred: w.inferred ?? false,
      ...(w.districtKey === undefined ? {} : { districtKey: w.districtKey }),
    })),
  });
}

function algorithmsManifest(): string {
  return JSON.stringify({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-22T00:00:00.000Z",
    algorithms: [{ id: "opr", version: "3.1.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" }],
  });
}

function makeManifests(windows: readonly WindowFixture[]): Map<string, string> {
  return new Map([
    [LIVE_WINDOWS_MANIFEST_KEY, liveWindowsManifest(windows)],
    [ALGORITHMS_MANIFEST_KEY, algorithmsManifest()],
  ]);
}

interface TbaMatchFixture {
  key: string;
  eventKey: string;
  compLevel?: "qm" | "sf" | "f";
  setNumber?: number;
  matchNumber: number;
  redTeams?: readonly string[];
  blueTeams?: readonly string[];
  redScore?: number | null;
  blueScore?: number | null;
  actualTimeSec?: number;
  predictedTimeSec?: number;
  winningAlliance?: "red" | "blue" | "";
}

function tbaMatch(f: TbaMatchFixture): unknown {
  const played = f.redScore != null && f.blueScore != null;
  const red = f.redTeams ?? RED_TEAMS;
  const blue = f.blueTeams ?? BLUE_TEAMS;
  return {
    key: f.key,
    event_key: f.eventKey,
    comp_level: f.compLevel ?? "qm",
    set_number: f.setNumber ?? 1,
    match_number: f.matchNumber,
    time: null,
    predicted_time: f.predictedTimeSec ?? null,
    actual_time: f.actualTimeSec ?? null,
    winning_alliance: f.winningAlliance ?? (played ? (f.redScore! > f.blueScore! ? "red" : f.blueScore! > f.redScore! ? "blue" : "") : ""),
    alliances: {
      red: { team_keys: red, surrogate_team_keys: [], dq_team_keys: [], score: f.redScore ?? null },
      blue: { team_keys: blue, surrogate_team_keys: [], dq_team_keys: [], score: f.blueScore ?? null },
    },
    score_breakdown: null,
  };
}

interface TbaEventRecord {
  matches: unknown[];
  etag: string;
  eventType: number;
  season: number;
  /** `/event/{key}/awards` payload. `undefined` means "the stub answers 404" — no test should reach it. */
  awards?: unknown;
  awardsEtag?: string;
  /** Forces `/event/{key}/awards` to answer this status with no body, modelling a TBA failure (quick task 261009-r9x). */
  awardsStatus?: number;
  /** The awards response carries NO ETag header, so it can never be asked conditionally and never reads as settled (quick task 261009-tx6). */
  awardsNoEtag?: boolean;
}

interface TbaDistrictRecord {
  rankings: unknown;
  etag: string;
}

/**
 * Serves `/event/{key}/matches`, `/event/{key}`, `/event/{key}/awards` and
 * `/district/{key}/rankings`, all ETag-conditional. The awards branch is
 * matched BEFORE the bare event-detail branch, which would otherwise swallow
 * it. Every request is recorded on `calls` so a test can assert a count by
 * equality rather than by truthiness.
 */
function makeTbaFetchStub(events: Map<string, TbaEventRecord>, districts: Map<string, TbaDistrictRecord> = new Map(), districtStatusOverride: Map<string, number> = new Map()): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    const quietOfficialData = officialDataStubResponse(u);
    if (quietOfficialData !== undefined) return quietOfficialData;
    const ifNoneMatch = init?.headers?.["If-None-Match"];

    const rankingsMatch = /\/district\/([^/]+)\/rankings$/.exec(u);
    if (rankingsMatch) {
      const districtKey = rankingsMatch[1]!;
      const override = districtStatusOverride.get(districtKey);
      if (override !== undefined) return { status: override, ok: false, headers: new Map(), json: async () => ({}) };
      const record = districts.get(districtKey);
      if (!record) return { status: 404, ok: false, headers: new Map(), json: async () => ({}) };
      if (ifNoneMatch && ifNoneMatch === record.etag) return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
      return { status: 200, ok: true, headers: { get: (name: string) => (name === "etag" ? record.etag : null) }, json: async () => record.rankings };
    }

    const awardsMatch = /\/event\/([^/]+)\/awards$/.exec(u);
    if (awardsMatch) {
      const eventKey = awardsMatch[1]!;
      const record = events.get(eventKey);
      if (record?.awardsStatus !== undefined) return { status: record.awardsStatus, ok: false, headers: new Map(), json: async () => ({}) };
      if (!record || record.awards === undefined) return { status: 404, ok: false, headers: new Map(), json: async () => ({}) };
      if (record.awardsNoEtag === true) return { status: 200, ok: true, headers: { get: () => null }, json: async () => record.awards };
      const etag = record.awardsEtag ?? `${record.etag}-awards`;
      if (ifNoneMatch && ifNoneMatch === etag) return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
      return { status: 200, ok: true, headers: { get: (name: string) => (name === "etag" ? etag : null) }, json: async () => record.awards };
    }

    const matchesMatch = /\/event\/([^/]+)\/matches$/.exec(u);
    if (matchesMatch) {
      const eventKey = matchesMatch[1]!;
      const record = events.get(eventKey);
      if (!record) return { status: 404, ok: false, headers: new Map(), json: async () => ({}) };
      if (ifNoneMatch && ifNoneMatch === record.etag) return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
      return { status: 200, ok: true, headers: { get: (name: string) => (name === "etag" ? record.etag : null) }, json: async () => record.matches };
    }

    const detailMatch = /\/event\/([^/]+)$/.exec(u);
    if (detailMatch) {
      const eventKey = detailMatch[1]!;
      const record = events.get(eventKey);
      if (!record) return { status: 404, ok: false, headers: new Map(), json: async () => ({}) };
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ key: eventKey, name: eventKey, year: record.season, event_type: record.eventType, start_date: "2026-08-01" }) };
    }

    // The roster pass's conditional poll (quick task 260925-uy5), answered 304 by
    // default so every expectation in this file holds unchanged. BEFORE the
    // fallthrough throw, which would otherwise turn one extra request per open
    // window into a per-window `roster-failed` warning.
    if (/\/event\/[^/]+\/teams\/simple$/.test(u)) {
      return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
    }
    throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
  });
}

/**
 * 12:01:00Z ON PURPOSE (quick task 261009-tx6). The district pass reads the
 * UTC minute of the tick: a multiple of 5 is when a district with nothing live
 * is asked, and a multiple of 15 is a forced look. Minute 1 is neither, so
 * every test that does not name its minute runs on an ordinary tick. A test
 * that depends on the minute states it.
 */
const NOW_MS = Date.parse("2026-08-22T12:01:00.000Z");
const SEASON = 2026;
const RED_TEAMS = ["frc1", "frc2", "frc3"];
const BLUE_TEAMS = ["frc4", "frc5", "frc6"];

/** 2026 district-tier event maximum: 22 + 16 + 30 + 15. */
const DISTRICT_EVENT_MAX = 83;
/** 2026 dcmp-tier event maximum: three times the district tier. */
const DCMP_EVENT_MAX = 249;

const DISTRICT_KEY = "2026pnw";
const LIVE_EVENT = "2026wayak";
const PLAYED_EVENT = "2026wabon";

function twoMatchEventRecord(eventKey: string, etag: string, extra: Partial<TbaEventRecord> = {}): TbaEventRecord {
  return {
    etag,
    eventType: 1, // District — the tier a district member event actually is
    season: SEASON,
    matches: [
      tbaMatch({ key: `${eventKey}_qm1`, eventKey, matchNumber: 1, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 }),
      tbaMatch({ key: `${eventKey}_qm2`, eventKey, matchNumber: 2, redTeams: ["frc7", "frc8", "frc9"], blueTeams: ["frc10", "frc11", "frc12"], predictedTimeSec: Math.floor(NOW_MS / 1000) + 3600 }),
    ],
    ...extra,
  };
}

function lockVerdict(status: string) {
  return { status, pointsToLock: null, threatCount: 0, cutLinePoints: null, allocationNote: null };
}

/** `2026wabon`: over, awards posted, so nothing is held back for it. */
const PLAYED_EVENT_STATE = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true } as const;

/**
 * The published district artifact the Worker reads back. `frc1` has played
 * `2026wabon` and still has `2026wayak` ahead of it; `frc2` and `frc3` have
 * played only `2026wabon`. Every team's `districtLock.status` is deliberately
 * WRONG (`"contending"`) so a carried-over verdict fails loudly rather than
 * passing by accident.
 *
 * TWO DCMP SLOTS AND THREE TEAMS, because `2026wayak` is live and its Impact
 * award is not posted: 260925-ms7 holds one points slot back for it, so a
 * one-slot district could guarantee nobody at all and the recomputed-verdict
 * assertions below would pass for the wrong reason.
 */
function districtArtifactFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    generation: "gen-published",
    computedAt: "2026-03-01T00:00:00.000Z",
    districtKey: DISTRICT_KEY,
    year: SEASON,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 2,
    cmpSlots: 1,
    teams: [
      {
        teamKey: "frc1",
        teamNumber: 1,
        nickname: "The Juggernauts",
        rank: 1,
        pointTotal: 40,
        rookieBonus: 0,
        adjustments: 0,
        eventPoints: [{ eventKey: PLAYED_EVENT, eventName: "Bonney Lake", week: 1, tier: "district", qual: 20, alliance: 10, elim: 5, award: 5, total: 40, state: { ...PLAYED_EVENT_STATE } }],
        remainingEvents: [{ eventKey: LIVE_EVENT, eventName: "Yakima", week: 3, tier: "district", maxPoints: DISTRICT_EVENT_MAX }],
        maxRemainingDistrict: DISTRICT_EVENT_MAX,
        maxRemainingChamp: DISTRICT_EVENT_MAX + DCMP_EVENT_MAX,
        qualifyingAwards: [],
        districtLock: lockVerdict("contending"),
        champLock: lockVerdict("contending"),
      },
      {
        teamKey: "frc2",
        teamNumber: 2,
        nickname: "Mechanical Bulls",
        rank: 2,
        pointTotal: 30,
        rookieBonus: 0,
        adjustments: 0,
        eventPoints: [{ eventKey: PLAYED_EVENT, eventName: "Bonney Lake", week: 1, tier: "district", qual: 15, alliance: 8, elim: 2, award: 5, total: 30, state: { ...PLAYED_EVENT_STATE } }],
        remainingEvents: [],
        maxRemainingDistrict: 0,
        maxRemainingChamp: DCMP_EVENT_MAX,
        qualifyingAwards: [],
        districtLock: lockVerdict("contending"),
        champLock: lockVerdict("contending"),
      },
      {
        teamKey: "frc3",
        teamNumber: 3,
        nickname: "Tin Whiskers",
        rank: 3,
        pointTotal: 10,
        rookieBonus: 0,
        adjustments: 0,
        eventPoints: [{ eventKey: PLAYED_EVENT, eventName: "Bonney Lake", week: 1, tier: "district", qual: 6, alliance: 2, elim: 0, award: 2, total: 10, state: { ...PLAYED_EVENT_STATE } }],
        remainingEvents: [],
        maxRemainingDistrict: 0,
        maxRemainingChamp: DCMP_EVENT_MAX,
        qualifyingAwards: [],
        districtLock: lockVerdict("contending"),
        champLock: lockVerdict("contending"),
      },
    ],
    insights: { teamCount: 3, eventCount: 2, dcmpCutLinePoints: 40, cmpCutLinePoints: 40, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
    ...overrides,
  };
}

function eventPointsEntry(eventKey: string, total: number, districtCmp = false) {
  return { event_key: eventKey, district_cmp: districtCmp, qual_points: total, alliance_points: 0, elim_points: 0, award_points: 0, total };
}

/**
 * `frc1` has now played `2026wayak` for 50 more points; `frc2` and `frc3` are unchanged.
 *
 * Five of the 50 are PLAYOFF points (quick task 261009-vp9): the live awards
 * flag waits until some row at the event carries a playoff point, and every
 * award test below means an event whose playoff points are in. The total is
 * unchanged, and no row at the event carries the winner's 30, so every
 * category of the event still reads open until its flag turns true.
 */
function movedRankings(): unknown {
  const liveEntry = { ...eventPointsEntry(LIVE_EVENT, 50), qual_points: 45, elim_points: 5 };
  return [
    { team_key: "frc1", rank: 1, point_total: 90, rookie_bonus: 0, adjustments: 0, event_points: [eventPointsEntry(PLAYED_EVENT, 40), liveEntry] },
    { team_key: "frc2", rank: 2, point_total: 30, rookie_bonus: 0, adjustments: 0, event_points: [eventPointsEntry(PLAYED_EVENT, 30)] },
    { team_key: "frc3", rank: 3, point_total: 10, rookie_bonus: 0, adjustments: 0, event_points: [eventPointsEntry(PLAYED_EVENT, 10)] },
  ];
}

function liveWindow(overrides: Partial<WindowFixture> = {}): WindowFixture {
  return { eventKey: LIVE_EVENT, season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000, districtKey: DISTRICT_KEY, ...overrides };
}

function districtPuts(r2: FakeR2Bucket): { key: string; body: string }[] {
  return r2.puts.filter((p) => p.key.startsWith("v1/district/"));
}

function tbaUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String((call as [unknown])[0]));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Task 1 — the tracer: one live district, one changed rankings response, one
// republished artifact.
// ---------------------------------------------------------------------------

describe("runTick — the district pass end to end", () => {
  it("republishes the district artifact with recomputed verdicts after a changed rankings response", async () => {
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, twoMatchEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(env, { nowMs: NOW_MS });

    // 1. Exactly one rankings request.
    expect(tbaUrls(fetchMock).filter((u) => u.endsWith(`/district/${DISTRICT_KEY}/rankings`))).toHaveLength(1);

    // 2. Exactly one put, at the district detail key.
    const puts = districtPuts(r2);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.key).toBe(districtDetailKey(DISTRICT_KEY));

    // 3. The put body re-parses through the published schema.
    const written = DistrictArtifactSchema.parse(JSON.parse(puts[0]!.body));

    const frc1 = written.teams.find((team) => team.teamKey === "frc1")!;
    // 4. Team A's point total moved.
    expect(frc1.pointTotal).toBe(90);
    // 5/6. The newly played event is in eventPoints and gone from remainingEvents.
    expect(frc1.eventPoints.map((row) => row.eventKey)).toEqual([PLAYED_EVENT, LIVE_EVENT]);
    expect(frc1.remainingEvents.map((row) => row.eventKey)).toEqual([]);
    // 7. The lock verdict was RECOMPUTED, not carried over: frc1 now has 90
    //    points and nothing remaining, frc2 has 30, frc3 has 10, and there are
    //    two DCMP slots of which ONE IS HELD BACK for the live event's Impact
    //    award, which has not been posted. So frc1 is guaranteed the single
    //    remaining points slot and frc3 cannot reach it; frc2 sits between the
    //    two and is neither.
    expect(frc1.districtLock.status).toBe("locked");
    expect(written.teams.find((team) => team.teamKey === "frc2")!.districtLock.status).toBe("contending");
    expect(written.teams.find((team) => team.teamKey === "frc3")!.districtLock.status).toBe("eliminated");
    // 8. The body carries the tick's own stamp.
    expect(written.generation).toBe(`tick-${NOW_MS}`);

    // 9. The counts.
    expect(result.districtsConsidered).toBe(1);
    expect(result.districtsRefreshed).toBe(1);
    expect(result.districtsFailed).toBe(0);
  });

  it("issues no district put on a second tick whose rankings poll returns 304", async () => {
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, twoMatchEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    await runTick(env, { nowMs: NOW_MS });
    const putsAfterFirst = districtPuts(r2).length;
    const second = await runTick(env, { nowMs: NOW_MS + 60_000 });

    expect(putsAfterFirst).toBe(1);
    expect(districtPuts(r2)).toHaveLength(1);
    expect(second.districtsUnchanged).toBe(1);
    expect(second.districtsRefreshed).toBe(0);
  });

  it("writes the rankings ETag under the reserved cursor key, and sends If-None-Match only on the second tick", async () => {
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, twoMatchEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    await runTick(env, { nowMs: NOW_MS });

    const cursorKey = districtRankingsCursorKey(DISTRICT_KEY);
    expect(d1.eventCursors.get(cursorKey)?.tba_etag).toBe("rank-etag-1");

    const firstRankingsCall = fetchMock.mock.calls.find((call) => String((call as [unknown])[0]).endsWith("/rankings")) as [unknown, { headers?: Record<string, string> }];
    expect(firstRankingsCall[1]?.headers?.["If-None-Match"]).toBeUndefined();

    fetchMock.mockClear();
    await runTick(env, { nowMs: NOW_MS + 60_000 });
    const secondRankingsCall = fetchMock.mock.calls.find((call) => String((call as [unknown])[0]).endsWith("/rankings")) as [unknown, { headers?: Record<string, string> }];
    expect(secondRankingsCall[1]?.headers?.["If-None-Match"]).toBe("rank-etag-1");
  });
});

// ---------------------------------------------------------------------------
// Task 2 — the four state facts, the awards fetch, and the state-only write.
// ---------------------------------------------------------------------------

interface StateBlock {
  qualMatchesPlayed: number;
  qualMatchesTotal: number | null;
  alliancesPicked: boolean;
  playoffsDone: boolean;
  awardsPosted: boolean;
}

function stateBlock(overrides: Partial<StateBlock> = {}): StateBlock {
  return { qualMatchesPlayed: 2, qualMatchesTotal: 2, alliancesPicked: true, playoffsDone: false, awardsPosted: false, ...overrides };
}

/** The published fixture with `state` already on `frc1`'s `remainingEvents` row for the live event — the "published state" half of the fallback and steady-state cases. */
function districtArtifactWithState(state: StateBlock): unknown {
  const artifact = districtArtifactFixture() as { teams: { remainingEvents: { state?: StateBlock }[] }[] };
  artifact.teams[0]!.remainingEvents[0]!.state = state;
  return artifact;
}

function sec(offsetSec: number): number {
  return Math.floor(NOW_MS / 1000) + offsetSec;
}

/** Two played quals plus an UNPLAYED semifinal carrying both alliances — alliances posted, playoffs not done. */
function alliancesPostedEventRecord(eventKey: string, etag: string, extra: Partial<TbaEventRecord> = {}): TbaEventRecord {
  return {
    etag,
    eventType: 1,
    season: SEASON,
    matches: [
      tbaMatch({ key: `${eventKey}_qm1`, eventKey, matchNumber: 1, redScore: 120, blueScore: 95, actualTimeSec: sec(-180) }),
      tbaMatch({ key: `${eventKey}_qm2`, eventKey, matchNumber: 2, redScore: 80, blueScore: 110, actualTimeSec: sec(-120) }),
      tbaMatch({ key: `${eventKey}_sf1m1`, eventKey, compLevel: "sf", matchNumber: 1, predictedTimeSec: sec(600) }),
    ],
    ...extra,
  };
}

/** Two played quals, a played semifinal and a played, DECIDED final — playoffs done. */
function finishedEventRecord(eventKey: string, etag: string, extra: Partial<TbaEventRecord> = {}): TbaEventRecord {
  return {
    etag,
    eventType: 1,
    season: SEASON,
    matches: [
      tbaMatch({ key: `${eventKey}_qm1`, eventKey, matchNumber: 1, redScore: 120, blueScore: 95, actualTimeSec: sec(-180) }),
      tbaMatch({ key: `${eventKey}_qm2`, eventKey, matchNumber: 2, redScore: 80, blueScore: 110, actualTimeSec: sec(-150) }),
      tbaMatch({ key: `${eventKey}_sf1m1`, eventKey, compLevel: "sf", matchNumber: 1, redScore: 130, blueScore: 90, actualTimeSec: sec(-120), winningAlliance: "red" }),
      tbaMatch({ key: `${eventKey}_f1m1`, eventKey, compLevel: "f", matchNumber: 1, redScore: 140, blueScore: 100, actualTimeSec: sec(-60), winningAlliance: "red" }),
    ],
    ...extra,
  };
}

/** The `state` block the written artifact carries for the live event, wherever that event's row now lives. */
function writtenLiveEventState(r2: FakeR2Bucket): StateBlock | undefined {
  const puts = districtPuts(r2);
  const written = DistrictArtifactSchema.parse(JSON.parse(puts[puts.length - 1]!.body));
  const frc1 = written.teams.find((team) => team.teamKey === "frc1")!;
  const row = frc1.eventPoints.find((entry) => entry.eventKey === LIVE_EVENT) ?? frc1.remainingEvents.find((entry) => entry.eventKey === LIVE_EVENT);
  return row?.state as StateBlock | undefined;
}

function awardsRequests(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return tbaUrls(fetchMock).filter((u) => u.endsWith("/awards"));
}

function seedCursor(d1: FakeD1Database, eventKey: string, tbaEtag: string | null, lastFoldedMatchKey: string | null): void {
  d1.eventCursors.set(eventKey, { event_key: eventKey, tba_etag: tbaEtag, last_folded_match_key: lastFoldedMatchKey, last_polled_at: null, last_advanced_at: null });
}

describe("runTick — the four state facts", () => {
  it("writes all four match-derived facts onto the live event's row, and the body re-parses through the published schema", async () => {
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    await runTick(env, { nowMs: NOW_MS });

    expect(writtenLiveEventState(r2)).toEqual({ qualMatchesPlayed: 2, qualMatchesTotal: 2, alliancesPicked: true, playoffsDone: false, awardsPosted: false });
  });

  it("records alliancesPicked even when the poll folded NO new match — the derivation sits ABOVE the newlyFolded early return", async () => {
    const d1 = new FakeD1Database();
    // The cursor already sits at the last PLAYED match, so this tick folds
    // nothing; the stale etag still forces a 200, so the match list is parsed.
    seedCursor(d1, LIVE_EVENT, "stale-etag", `${LIVE_EVENT}_qm2`);
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(env, { nowMs: NOW_MS });

    expect(result.eventsAdvanced).toBe(0);
    expect(writtenLiveEventState(r2)).toMatchObject({ alliancesPicked: true, qualMatchesPlayed: 2 });
  });

  it("writes state-only through applyDistrictEventState on a 304 rankings poll, leaving every point total and rank byte-identical and the verdicts at the recompute's fixed point", async () => {
    const d1 = new FakeD1Database();
    seedCursor(d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);
    const r2 = new FakeR2Bucket();
    // A published artifact is already at the verdict recompute's fixed point;
    // the fixture's stub verdicts are not, so it is seeded recomputed.
    const seeded = recomputeDistrictVerdicts(DistrictArtifactSchema.parse(districtArtifactFixture()));
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(seeded));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(env, { nowMs: NOW_MS });

    expect(result.districtsRefreshed).toBe(1);
    const puts = districtPuts(r2);
    expect(puts).toHaveLength(1);
    const written = DistrictArtifactSchema.parse(JSON.parse(puts[0]!.body));
    const seededParsed = seeded;

    // The verdicts are recomputed with the observed state attached (an
    // observation can shrink the remaining pool and move a verdict, and a
    // posted award releases its held back slot), so the written artifact is
    // the recompute's own fixed point rather than a copy of the seeded verdicts.
    const fixedPoint = recomputeDistrictVerdicts(written);
    expect(JSON.stringify(written.insights)).toBe(JSON.stringify(fixedPoint.insights));
    for (const team of written.teams) {
      const before = seededParsed.teams.find((t) => t.teamKey === team.teamKey)!;
      const settled = fixedPoint.teams.find((t) => t.teamKey === team.teamKey)!;
      expect(team.pointTotal).toBe(before.pointTotal);
      expect(team.rank).toBe(before.rank);
      expect(JSON.stringify(team.districtLock)).toBe(JSON.stringify(settled.districtLock));
      expect(JSON.stringify(team.champLock)).toBe(JSON.stringify(settled.champLock));
    }
    expect(writtenLiveEventState(r2)).toEqual({ qualMatchesPlayed: 2, qualMatchesTotal: 2, alliancesPicked: true, playoffsDone: false, awardsPosted: false });
  });

  it("writes NOTHING when a 304 rankings poll meets a state observation equal to the published state, and stays that way when repeated", async () => {
    const steady = stateBlock();
    const runSteadyTick = async (): Promise<{ result: Awaited<ReturnType<typeof runTick>>; r2: FakeR2Bucket }> => {
      const d1 = new FakeD1Database();
      seedCursor(d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);
      seedCursor(d1, LIVE_EVENT, "stale-etag", `${LIVE_EVENT}_qm2`);
      const r2 = new FakeR2Bucket();
      // Seeded at the recompute's fixed point, as a published artifact is.
      r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(recomputeDistrictVerdicts(DistrictArtifactSchema.parse(districtArtifactWithState(steady)))));
      const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
      vi.stubGlobal("fetch", makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]])));
      const result = await runTick(env, { nowMs: NOW_MS });
      return { result, r2 };
    };

    const first = await runSteadyTick();
    expect(districtPuts(first.r2)).toHaveLength(0);
    expect(first.result.districtsUnchanged).toBe(1);
    expect(first.result.districtsRefreshed).toBe(0);

    const second = await runSteadyTick();
    expect(districtPuts(second.r2)).toHaveLength(0);
    expect(second.result.districtsUnchanged).toBe(1);
  });

  it("performs ZERO v1/district/ R2 reads when a 304 rankings poll meets no observation at all", async () => {
    const d1 = new FakeD1Database();
    seedCursor(d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);
    // The event's own match poll returns 304, so `processEvent` returns before
    // parsing and contributes no observation.
    seedCursor(d1, LIVE_EVENT, "etag-1", `${LIVE_EVENT}_qm2`);
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(env, { nowMs: NOW_MS });

    expect(r2.gets.filter((key) => key.startsWith("v1/district/"))).toEqual([]);
    expect(districtPuts(r2)).toHaveLength(0);
    expect(result.districtsUnchanged).toBe(1);
    // No awards cursor row for the event, so no awards request before the gate
    // either (quick task 261009-r9x): this district cost one TBA request.
    expect(awardsRequests(fetchMock)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The awards flag and the winner records (quick task 261009-r9x).
//
// The flag turns true only once the awards list holds a judged award (anything
// other than Winner and Finalist) AND some team's row at the event carries
// award points in the merged rankings. Every list that reaches the merge is
// merged, so who won is written in the same put as the flag and the verdicts.
// The awards cursor row holds the ETag of the last list the pass merged.
// ---------------------------------------------------------------------------

const AWARDS_CURSOR_KEY = `__event_awards__:${LIVE_EVENT}`;

function tbaAward(awardType: number, name: string, teamKeys: readonly string[], eventKey: string = LIVE_EVENT): unknown {
  return { name, award_type: awardType, event_key: eventKey, recipient_list: teamKeys.map((teamKey) => ({ team_key: teamKey, awardee: null })), year: SEASON };
}

/** What TBA lists first at many events: the field results, and no judged award yet. */
const WINNER_ONLY = [tbaAward(1, "District Event Winner", ["frc1"])];
const WINNER_AND_FINALIST = [tbaAward(1, "District Event Winner", ["frc1"]), tbaAward(2, "District Event Finalist", ["frc2"])];
const IMPACT_TO_FRC3 = tbaAward(0, "FIRST Impact Award", ["frc3"]);
const EI_TO_FRC2 = tbaAward(9, "Engineering Inspiration Award", ["frc2"]);
const JUDGED_LIST = [...WINNER_AND_FINALIST, IMPACT_TO_FRC3];

const IMPACT_RECORD = { eventKey: LIVE_EVENT, awardType: 0, label: "FIRST Impact Award", awardOnly: false };

/** `movedRankings()` plus `frc3`'s Impact award points at the live event: the rankings TBA serves once the award points are in. */
function rankingsWithAwardPoints(): unknown {
  const rows = movedRankings() as { team_key: string; point_total: number; event_points: unknown[] }[];
  const frc3 = rows.find((row) => row.team_key === "frc3")!;
  frc3.point_total = 20;
  frc3.event_points.push({ event_key: LIVE_EVENT, district_cmp: false, qual_points: 0, alliance_points: 0, elim_points: 0, award_points: 10, total: 10 });
  return rows;
}

interface AwardsCall {
  /** The `If-None-Match` header the request carried, `undefined` for an unconditional ask. */
  readonly ifNoneMatch: string | undefined;
  /** True when no `v1/district/` object had been read yet this tick: the ask was made before the gate. */
  readonly beforeArtifactRead: boolean;
}

interface TickReport {
  readonly result: Awaited<ReturnType<typeof runTick>>;
  readonly awardsCalls: AwardsCall[];
  /** `If-None-Match` of every rankings request this tick. */
  readonly rankingsCalls: (string | undefined)[];
  /** `v1/district/` R2 reads this tick. */
  readonly districtReads: number;
  /** `v1/district/` puts this tick, parsed. */
  readonly written: ReturnType<typeof DistrictArtifactSchema.parse>[];
  /** Every awards request this tick with the event it asked about, in order (quick task 261009-tx6). */
  readonly awardsAsked: { readonly eventKey: string; readonly ifNoneMatch: string | undefined }[];
}

interface Harness {
  readonly d1: FakeD1Database;
  readonly r2: FakeR2Bucket;
  readonly env: Env;
  readonly events: Map<string, TbaEventRecord>;
  readonly districts: Map<string, TbaDistrictRecord>;
  readonly warnSpy: WarnSpy;
  /** Every TBA request the harness has seen, in order. */
  readonly fetchMock: ReturnType<typeof vi.fn>;
  /** Runs the real `runTick` one minute after the last `tick()`, starting at `NOW_MS`. */
  tick(): Promise<TickReport>;
  /** Runs the real `runTick` at an explicit clock (quick task 261009-tx6). Does not move `tick()`'s own counter. */
  tickAt(nowMs: number): Promise<TickReport>;
  /** The district artifact R2 holds right now, parsed. Read by the test, counted nowhere. */
  current(): WrittenArtifact;
}

interface HarnessOptions {
  readonly artifact?: unknown;
  readonly eventKey?: string;
  /** The manifest's windows. Default: one live window for `eventKey` (or the live event), one hour either side of `NOW_MS`. */
  readonly windows?: readonly WindowFixture[];
  /** R2 holds no algorithms manifest, so the tick's algorithm context cannot be built. */
  readonly withoutAlgorithmsManifest?: boolean;
}

/**
 * One district, one R2 seeded artifact, the manifest's windows (one live
 * window unless the test passes its own), and a TBA stub whose event and
 * district records the test mutates between ticks. Each `tick()` runs the
 * REAL `runTick` one minute after the last, `tickAt` runs it at an explicit
 * clock, and both report only what that tick did.
 */
function makeHarness(options: HarnessOptions = {}): Harness {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const d1 = new FakeD1Database();
  const r2 = new FakeR2Bucket();
  r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(options.artifact ?? districtArtifactFixture()));
  const manifests = makeManifests(options.windows ?? [liveWindow(options.eventKey === undefined ? {} : { eventKey: options.eventKey })]);
  if (options.withoutAlgorithmsManifest === true) manifests.delete(ALGORITHMS_MANIFEST_KEY);
  const env = makeEnv(manifests, d1, r2);
  const events = new Map<string, TbaEventRecord>();
  const districts = new Map<string, TbaDistrictRecord>();
  // Narrowed to a callable: `ReturnType<typeof vi.fn>` is not one under the Worker tsconfig.
  const inner = makeTbaFetchStub(events, districts) as unknown as (url: unknown, init?: { headers?: Record<string, string> }) => Promise<unknown>;

  const districtReadCount = (): number => r2.gets.filter((key) => key.startsWith("v1/district/")).length;
  let readsAtTickStart = 0;
  let awardsCalls: AwardsCall[] = [];
  let awardsAsked: { eventKey: string; ifNoneMatch: string | undefined }[] = [];
  let rankingsCalls: (string | undefined)[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    const ifNoneMatch = init?.headers?.["If-None-Match"];
    if (u.endsWith("/awards")) {
      awardsCalls.push({ ifNoneMatch, beforeArtifactRead: districtReadCount() === readsAtTickStart });
      awardsAsked.push({ eventKey: /\/event\/([^/]+)\/awards$/.exec(u)?.[1] ?? "", ifNoneMatch });
    }
    if (u.endsWith("/rankings") && u.includes("/district/")) rankingsCalls.push(ifNoneMatch);
    return inner(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);

  const tickAt = async (nowMs: number): Promise<TickReport> => {
    awardsCalls = [];
    awardsAsked = [];
    rankingsCalls = [];
    readsAtTickStart = districtReadCount();
    const putsAtTickStart = districtPuts(r2).length;
    const result = await runTick(env, { nowMs });
    return {
      result,
      awardsCalls,
      rankingsCalls,
      districtReads: districtReadCount() - readsAtTickStart,
      written: districtPuts(r2)
        .slice(putsAtTickStart)
        .map((put) => DistrictArtifactSchema.parse(JSON.parse(put.body))),
      awardsAsked,
    };
  };

  let tickIndex = 0;
  return {
    d1,
    r2,
    env,
    events,
    districts,
    warnSpy,
    fetchMock,
    tick: () => tickAt(NOW_MS + 60_000 * tickIndex++),
    tickAt,
    current: () => DistrictArtifactSchema.parse(JSON.parse(r2.peek(districtDetailKey(DISTRICT_KEY))!)),
  };
}

type WrittenArtifact = TickReport["written"][number];

const MINUTE_MS = 60_000;

/** A live window that is still live hours after `NOW_MS`, for a test that waits out the 60 minute settle time. */
function longLiveWindow(overrides: Partial<WindowFixture> = {}): WindowFixture {
  return liveWindow({ endMs: NOW_MS + 6 * 60 * MINUTE_MS, ...overrides });
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Seeds an awards cursor row as the pass leaves one: the ETag of the last list
 * it merged, and the time that ETag last changed, `minutesBefore` minutes
 * before `clockMs`. `null` minutes leaves the change time null, which is the
 * row Worker 33d0ded7 (quick task 261009-r9x) wrote.
 */
function seedAwardsRow(d1: FakeD1Database, eventKey: string, tbaEtag: string | null, minutesBefore: number | null, clockMs: number = NOW_MS): void {
  const key = `__event_awards__:${eventKey}`;
  d1.eventCursors.set(key, { event_key: key, tba_etag: tbaEtag, last_folded_match_key: null, last_polled_at: null, last_advanced_at: minutesBefore === null ? null : isoAt(clockMs - minutesBefore * MINUTE_MS) });
}

function awardsCursorRow(d1: FakeD1Database, eventKey: string = LIVE_EVENT): FakeEventCursorRow | undefined {
  return d1.eventCursors.get(`__event_awards__:${eventKey}`);
}

function teamIn(artifact: WrittenArtifact, teamKey: string): WrittenArtifact["teams"][number] {
  return artifact.teams.find((team) => team.teamKey === teamKey)!;
}

/** The `awardsPosted` flag of every row for `eventKey` that carries a state block, across every team. */
function flagsFor(artifact: WrittenArtifact, eventKey: string = LIVE_EVENT): boolean[] {
  return artifact.teams.flatMap((team) => [...team.eventPoints, ...team.remainingEvents].filter((row) => row.eventKey === eventKey && row.state !== undefined).map((row) => row.state!.awardsPosted));
}

function awardsCursorEtag(d1: FakeD1Database, eventKey: string = LIVE_EVENT): string | null | undefined {
  const row = d1.eventCursors.get(`__event_awards__:${eventKey}`);
  return row === undefined ? undefined : row.tba_etag;
}

function awardsWarns(warnSpy: WarnSpy): Record<string, unknown>[] {
  return warnLines(warnSpy)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry["msg"] === "district-awards-poll-failed");
}

function expectNoSecretInWarns(warnSpy: WarnSpy): void {
  for (const line of warnLines(warnSpy)) {
    expect(line).not.toContain("test-key");
    expect(line).not.toContain("X-TBA-Auth-Key");
    expect(line).not.toContain("If-None-Match");
  }
}

describe("runTick — the awards flag waits for a judged award and its points, tick by tick (261009-r9x)", () => {
  it("tick by tick: Winner and Finalist first, then Impact, then its points, then an hour with the list unchanged, then a late award, then nothing", async () => {
    // The window stays live for hours, so the event is still asked every tick
    // once the hour has passed.
    const h = makeHarness({ windows: [longLiveWindow()] });
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: WINNER_AND_FINALIST, awardsEtag: "awards-etag-1" }));
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });

    // TICK 1, 12:01. Winner and Finalist are listed. No cursor row exists yet,
    // so the one ask is the one inside the loop, with no ETag.
    const t1 = await h.tickAt(NOW_MS);
    expect(t1.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: false }]);
    expect(t1.written).toHaveLength(1);
    expect(flagsFor(t1.written[0]!)).toEqual([false]);
    expect(teamIn(t1.written[0]!, "frc1").eventPoints.find((row) => row.eventKey === LIVE_EVENT)!.state).toEqual({ qualMatchesPlayed: 2, qualMatchesTotal: 2, alliancesPicked: true, playoffsDone: true, awardsPosted: false });
    expect(t1.written[0]!.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");
    expect(awardsCursorRow(h.d1)?.last_advanced_at).toBe(isoAt(NOW_MS));
    // The match list never changes again, so every later tick gets a match 304
    // and contributes no observation.
    expect(h.d1.eventCursors.get(LIVE_EVENT)?.tba_etag).toBe("etag-1");

    // TICK 2, 12:02. Impact is now listed, under a new ETag. The rankings are
    // a 304 and nothing is observed, so only the changed list passes the gate.
    // THIS is the list's last change: the hour is counted from here.
    const listChangedAt = NOW_MS + MINUTE_MS;
    h.events.get(LIVE_EVENT)!.awards = JUDGED_LIST;
    h.events.get(LIVE_EVENT)!.awardsEtag = "awards-etag-2";
    const t2 = await h.tickAt(listChangedAt);
    expect(t2.rankingsCalls).toEqual(["rank-etag-1"]);
    expect(t2.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-1", beforeArtifactRead: true }]);
    expect(t2.districtReads).toBe(1);
    expect(t2.written).toHaveLength(1);
    // No award points in the rankings yet: the flag still waits.
    expect(flagsFor(t2.written[0]!)).toEqual([false]);
    expect(teamIn(t2.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-2");
    expect(awardsCursorRow(h.d1)?.last_advanced_at).toBe(isoAt(listChangedAt));

    // TICK 3, 12:03. The rankings now carry frc3's award points. The list
    // itself is unchanged, so the ask before the gate is a 304 and the pass
    // asks once more, with no ETag, so the rule has the list. Two facts hold
    // and the third does not: the list changed one minute ago. The flag WAITS
    // (before quick task 261009-tx6 it turned true on this tick).
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-2" });
    const t3 = await h.tickAt(NOW_MS + 2 * MINUTE_MS);
    expect(t3.awardsCalls).toEqual([
      { ifNoneMatch: "awards-etag-2", beforeArtifactRead: true },
      { ifNoneMatch: undefined, beforeArtifactRead: false },
    ]);
    expect(t3.written).toHaveLength(1);
    expect(teamIn(t3.written[0]!, "frc3").pointTotal).toBe(20);
    expect(flagsFor(t3.written[0]!)).toEqual([false, false]);
    expect(teamIn(t3.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(teamIn(t3.written[0]!, "frc3").districtLock.status).not.toBe("lockedAward");
    // The list did not change, so its row is not rewritten and the clock stands.
    expect(awardsCursorRow(h.d1)?.last_advanced_at).toBe(isoAt(listChangedAt));

    // TICK 4, 13:01. Fifty nine minutes after the list last changed. The
    // rankings answer 200 under a new ETag, so the gate passes and the rule is
    // read again: still false, and nothing differs, so nothing is written.
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-3" });
    const t4 = await h.tickAt(listChangedAt + 59 * MINUTE_MS);
    expect(t4.districtReads).toBe(1);
    expect(t4.written).toHaveLength(0);
    expect(flagsFor(h.current())).toEqual([false, false]);

    // TICK 5, 13:02. Sixty minutes. ONE put carries the flag and the verdict
    // together, beside the winner record written an hour earlier.
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-4" });
    const t5 = await h.tickAt(listChangedAt + 60 * MINUTE_MS);
    expect(t5.awardsCalls).toEqual([
      { ifNoneMatch: "awards-etag-2", beforeArtifactRead: true },
      { ifNoneMatch: undefined, beforeArtifactRead: false },
    ]);
    expect(t5.written).toHaveLength(1);
    expect(flagsFor(t5.written[0]!)).toEqual([true, true]);
    expect(teamIn(t5.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(teamIn(t5.written[0]!, "frc3").districtLock.status).toBe("lockedAward");
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-2");
    expect(awardsCursorRow(h.d1)?.last_advanced_at).toBe(isoAt(listChangedAt));

    // TICK 6, 13:03 (case d). A late Engineering Inspiration is listed.
    // Rankings 304, match 304: the changed list alone passes the gate and is
    // merged. Awards do not un post: the flag stays true.
    h.events.get(LIVE_EVENT)!.awards = [...JUDGED_LIST, EI_TO_FRC2];
    h.events.get(LIVE_EVENT)!.awardsEtag = "awards-etag-3";
    const t6 = await h.tickAt(listChangedAt + 61 * MINUTE_MS);
    expect(t6.rankingsCalls).toEqual(["rank-etag-4"]);
    expect(t6.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-2", beforeArtifactRead: true }]);
    expect(t6.written).toHaveLength(1);
    expect(teamIn(t6.written[0]!, "frc2").qualifyingAwards).toEqual([{ eventKey: LIVE_EVENT, awardType: 9, label: "Engineering Inspiration", awardOnly: true }]);
    expect(teamIn(t6.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(flagsFor(t6.written[0]!)).toEqual([true, true]);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-3");

    // TICK 7, 13:04 (case e). Nothing changed: one rankings request and one
    // awards request, both 304, and the artifact is neither read nor written.
    const t7 = await h.tickAt(listChangedAt + 62 * MINUTE_MS);
    expect(t7.rankingsCalls).toEqual(["rank-etag-4"]);
    expect(t7.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-3", beforeArtifactRead: true }]);
    expect(t7.districtReads).toBe(0);
    expect(t7.written).toHaveLength(0);
    expect(t7.result.districtsUnchanged).toBe(1);
    expect(t7.result.districtsRefreshed).toBe(0);

    for (const report of [t1, t2, t3, t4, t5, t6, t7]) expect(report.result.districtsFailed).toBe(0);
    expect(awardsWarns(h.warnSpy)).toEqual([]);
  });

  it("(a) the points arrive one tick before the judged list: the changed list alone passes the gate, and the flag turns true an hour after that change", async () => {
    const h = makeHarness({ windows: [longLiveWindow()] });
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: WINNER_AND_FINALIST, awardsEtag: "awards-etag-1" }));
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-1" });

    // 12:01: the award points are in, the list holds Winner and Finalist only.
    const first = await h.tickAt(NOW_MS);
    expect(first.written).toHaveLength(1);
    expect(flagsFor(first.written[0]!)).toEqual([false, false]);
    expect(first.written[0]!.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");

    // 12:02: rankings 304, nothing observed, the list now holds Impact. Both
    // of the first two facts hold on this tick, and the list changed on this
    // tick, so the flag waits. The winner is recorded at once.
    const listChangedAt = NOW_MS + MINUTE_MS;
    h.events.get(LIVE_EVENT)!.awards = JUDGED_LIST;
    h.events.get(LIVE_EVENT)!.awardsEtag = "awards-etag-2";
    const second = await h.tickAt(listChangedAt);
    expect(second.rankingsCalls).toEqual(["rank-etag-1"]);
    expect(second.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-1", beforeArtifactRead: true }]);
    expect(second.written).toHaveLength(1);
    expect(flagsFor(second.written[0]!)).toEqual([false, false]);
    expect(teamIn(second.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(teamIn(second.written[0]!, "frc3").districtLock.status).not.toBe("lockedAward");
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-2");
    expect(awardsCursorRow(h.d1)?.last_advanced_at).toBe(isoAt(listChangedAt));

    // 13:01, fifty nine minutes on, on a tick that passes the gate: still false.
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-2" });
    const early = await h.tickAt(listChangedAt + 59 * MINUTE_MS);
    expect(early.districtReads).toBe(1);
    expect(early.written).toHaveLength(0);
    expect(flagsFor(h.current())).toEqual([false, false]);

    // 13:02, sixty minutes on: the flag and the verdict in one put.
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-3" });
    const settled = await h.tickAt(listChangedAt + 60 * MINUTE_MS);
    expect(settled.written).toHaveLength(1);
    expect(flagsFor(settled.written[0]!)).toEqual([true, true]);
    expect(teamIn(settled.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(teamIn(settled.written[0]!, "frc3").districtLock.status).toBe("lockedAward");
  });

  it("(b) the points arrive late: a quiet tick in between reads nothing, and the tick that brings them asks for the list with no ETag", async () => {
    const h = makeHarness();
    // The list was merged, unchanged, more than an hour ago: the settle time
    // is not this test's subject.
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 61);
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST, awardsEtag: "awards-etag-1" }));
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });

    // Tick k: a judged list and no points. Impact is recorded, the flag waits.
    const first = await h.tick();
    expect(flagsFor(first.written[0]!)).toEqual([false]);
    expect(teamIn(first.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");

    // Tick k+1: every poll a 304. One conditional awards request, no R2 read.
    const quiet = await h.tick();
    expect(quiet.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-1", beforeArtifactRead: true }]);
    expect(quiet.districtReads).toBe(0);
    expect(quiet.written).toHaveLength(0);

    // Tick k+2: the rankings bring the points, the list is unchanged.
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-2" });
    const third = await h.tick();
    expect(third.awardsCalls).toEqual([
      { ifNoneMatch: "awards-etag-1", beforeArtifactRead: true },
      { ifNoneMatch: undefined, beforeArtifactRead: false },
    ]);
    expect(third.written).toHaveLength(1);
    expect(flagsFor(third.written[0]!)).toEqual([true, true]);
    expect(teamIn(third.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
  });

  it("(c) a District Championship Winner listed on a quiet tick is recorded on that tick, and the flag stays false", async () => {
    const DCMP_EVENT = "2026pncmp";
    const dcmpState = { qualMatchesPlayed: 2, qualMatchesTotal: 2, alliancesPicked: true, playoffsDone: true, awardsPosted: false };
    const artifact = districtArtifactFixture() as { teams: { teamKey: string; pointTotal: number; eventPoints: unknown[]; remainingEvents: unknown[]; maxRemainingDistrict: number; maxRemainingChamp: number }[] };
    for (const team of artifact.teams) {
      team.remainingEvents = [];
      team.maxRemainingDistrict = 0;
      team.maxRemainingChamp = 0;
      if (team.teamKey === "frc3") continue;
      team.eventPoints.push({ eventKey: DCMP_EVENT, eventName: "PNW Championship", week: 6, tier: "dcmp", qual: 30, alliance: 0, elim: 0, award: 0, total: 30, state: { ...dcmpState } });
      team.pointTotal += 30;
    }
    const h = makeHarness({ artifact, eventKey: DCMP_EVENT });
    // Everything is quiet: the rankings and the match list both answer 304.
    seedCursor(h.d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);
    seedCursor(h.d1, DCMP_EVENT, "etag-1", `${DCMP_EVENT}_f1m1`);
    seedCursor(h.d1, `__event_awards__:${DCMP_EVENT}`, "awards-etag-0", null);
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });
    // The winning alliance: two district teams and one team from outside it.
    h.events.set(DCMP_EVENT, finishedEventRecord(DCMP_EVENT, "etag-1", { awards: [tbaAward(1, "District Championship Winner", ["frc1", "frc2", "frc9999"], DCMP_EVENT)], awardsEtag: "awards-etag-1" }));

    const report = await h.tick();

    expect(report.rankingsCalls).toEqual(["rank-etag-1"]);
    expect(report.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-0", beforeArtifactRead: true }]);
    expect(report.districtReads).toBe(1);
    expect(report.written).toHaveLength(1);
    const winner = { eventKey: DCMP_EVENT, awardType: 1, label: "Winner", awardOnly: false };
    expect(teamIn(report.written[0]!, "frc1").qualifyingAwards).toEqual([winner]);
    expect(teamIn(report.written[0]!, "frc2").qualifyingAwards).toEqual([winner]);
    expect(teamIn(report.written[0]!, "frc3").qualifyingAwards).toEqual([]);
    expect(report.written[0]!.teams.map((team) => team.teamKey)).toEqual(["frc1", "frc2", "frc3"]);
    expect(flagsFor(report.written[0]!, DCMP_EVENT)).toEqual([false, false]);
    expect(awardsCursorEtag(h.d1, DCMP_EVENT)).toBe("awards-etag-1");
    expect(report.result.districtsFailed).toBe(0);
  });
});

describe("runTick — an awards request that fails is not fatal to the district (261009-r9x, R-B and D8)", () => {
  it("(f) a failed ask before the gate: the new points are written, the flag is unchanged, one warn names the event, and the row is left as a retry marker", async () => {
    const h = makeHarness();
    seedCursor(h.d1, AWARDS_CURSOR_KEY, "awards-etag-0", null);
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST, awardsStatus: 500 }));
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-1" });

    const report = await h.tick();

    // The district carried on: its rankings merge was written.
    expect(report.result.districtsFailed).toBe(0);
    expect(report.result.districtsRefreshed).toBe(1);
    expect(report.written).toHaveLength(1);
    expect(teamIn(report.written[0]!, "frc1").pointTotal).toBe(90);
    expect(teamIn(report.written[0]!, "frc3").pointTotal).toBe(20);
    // No awards news: the flag stays false and nobody is recorded.
    expect(flagsFor(report.written[0]!)).toEqual([false, false]);
    expect(report.written[0]!.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
    // Asked once, before the gate, and not a second time inside the loop.
    expect(report.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-0", beforeArtifactRead: true }]);
    // Exactly one warn, naming the district, the event and a reason.
    const warns = awardsWarns(h.warnSpy);
    expect(warns).toHaveLength(1);
    expect(Object.keys(warns[0]!).sort()).toEqual(["districtKey", "eventKey", "msg", "reason"]);
    expect(warns[0]!["districtKey"]).toBe(DISTRICT_KEY);
    expect(warns[0]!["eventKey"]).toBe(LIVE_EVENT);
    expectNoSecretInWarns(h.warnSpy);
    // D8: the flag is not yet true, so the row becomes a retry marker (a null
    // ETag), never an ETag from the failed response. The next ask is
    // unconditional.
    expect(awardsCursorEtag(h.d1)).toBeNull();
    // The rankings cursor was still written.
    expect(h.d1.eventCursors.get(districtRankingsCursorKey(DISTRICT_KEY))?.tba_etag).toBe("rank-etag-1");
  });

  it("(f) a failed ask inside the loop, on a body that fails the schema: same outcome, and a retry marker row is created", async () => {
    const h = makeHarness();
    // No awards cursor row, playoffs done: the one ask is the unconditional one.
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: { notAList: true }, awardsEtag: "awards-etag-bad" }));
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-1" });

    const report = await h.tick();

    expect(report.result.districtsFailed).toBe(0);
    expect(report.written).toHaveLength(1);
    expect(teamIn(report.written[0]!, "frc1").pointTotal).toBe(90);
    expect(flagsFor(report.written[0]!)).toEqual([false, false]);
    expect(report.written[0]!.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
    expect(report.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: false }]);
    const warns = awardsWarns(h.warnSpy);
    expect(warns).toHaveLength(1);
    expect(warns[0]!["eventKey"]).toBe(LIVE_EVENT);
    expect(warns[0]!["reason"]).toBe("the awards response failed the schema");
    // The payload itself never reaches the log.
    expect(JSON.stringify(warns[0])).not.toContain("notAList");
    expectNoSecretInWarns(h.warnSpy);
    // D8: a row is created with a null ETag, never the failed response's ETag.
    expect(h.d1.eventCursors.has(AWARDS_CURSOR_KEY)).toBe(true);
    expect(awardsCursorEtag(h.d1)).toBeNull();
  });

  it("(f) a failed ask inside the loop on a non 2xx answer: the district carries on and a retry marker row is created", async () => {
    const h = makeHarness();
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST, awardsStatus: 503 }));
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });

    const report = await h.tick();

    expect(report.result.districtsFailed).toBe(0);
    expect(report.written).toHaveLength(1);
    expect(teamIn(report.written[0]!, "frc1").pointTotal).toBe(90);
    expect(flagsFor(report.written[0]!)).toEqual([false]);
    expect(report.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: false }]);
    expect(awardsWarns(h.warnSpy)).toHaveLength(1);
    expectNoSecretInWarns(h.warnSpy);
    expect(awardsCursorEtag(h.d1)).toBeNull();
  });

  it("a failed ask for an event whose flag is already true leaves its row untouched: the next conditional ask is the retry", async () => {
    const h = makeHarness({ artifact: districtArtifactWithState(stateBlock({ playoffsDone: true, awardsPosted: true })) });
    seedCursor(h.d1, AWARDS_CURSOR_KEY, "awards-etag-0", null);
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST, awardsStatus: 500 }));
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });

    const report = await h.tick();

    expect(report.result.districtsFailed).toBe(0);
    expect(report.written).toHaveLength(1);
    expect(flagsFor(report.written[0]!)).toEqual([true]);
    expect(report.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-0", beforeArtifactRead: true }]);
    expect(awardsWarns(h.warnSpy)).toHaveLength(1);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-0");
  });

  it("D8 (i): a failed ask inside the loop leaves a null ETag row, and the next quiet tick asks with no ETag, passes the gate and merges the list", async () => {
    const h = makeHarness();
    // The rankings are a 304 from the start; the gate passes on the match
    // observation alone.
    seedCursor(h.d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST, awardsEtag: "awards-etag-1", awardsStatus: 500 }));
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });

    const first = await h.tick();
    expect(first.rankingsCalls).toEqual(["rank-etag-1"]);
    expect(first.districtReads).toBe(1);
    expect(first.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: false }]);
    expect(first.result.districtsFailed).toBe(0);
    expect(h.d1.eventCursors.has(AWARDS_CURSOR_KEY)).toBe(true);
    expect(awardsCursorEtag(h.d1)).toBeNull();
    expect(h.d1.eventCursors.get(LIVE_EVENT)?.tba_etag).toBe("etag-1");

    // TBA answers again. Rankings 304, match 304: nothing else would pass the
    // gate. The null ETag row is asked with no ETag, and its 200 does.
    delete h.events.get(LIVE_EVENT)!.awardsStatus;
    const second = await h.tick();
    expect(second.rankingsCalls).toEqual(["rank-etag-1"]);
    expect(second.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: true }]);
    expect(second.districtReads).toBe(1);
    expect(second.written).toHaveLength(1);
    expect(teamIn(second.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");
  });

  it("D8 (ii): the points arrive on the tick the conditional ask fails, the next tick's unconditional ask records the winner, and the flag turns true an hour after that list was stored", async () => {
    const h = makeHarness({ windows: [longLiveWindow()] });
    // The row the last merged list left behind. The list has not changed since.
    seedCursor(h.d1, AWARDS_CURSOR_KEY, "awards-etag-1", null);
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST, awardsEtag: "awards-etag-1", awardsStatus: 500 }));
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-1" });

    // 12:01.
    const first = await h.tickAt(NOW_MS);
    expect(first.written).toHaveLength(1);
    expect(teamIn(first.written[0]!, "frc3").pointTotal).toBe(20);
    expect(flagsFor(first.written[0]!)).toEqual([false, false]);
    expect(awardsCursorEtag(h.d1)).toBeNull();

    // 12:02. Without the marker this tick would be a conditional 304 on an
    // unchanged list, the gate would stay shut, and the list would never be
    // read again. With it the list is merged. A list stored over a marker
    // reads as changed now (quick task 261009-tx6), so the flag waits.
    const listStoredAt = NOW_MS + MINUTE_MS;
    delete h.events.get(LIVE_EVENT)!.awardsStatus;
    const second = await h.tickAt(listStoredAt);
    expect(second.rankingsCalls).toEqual(["rank-etag-1"]);
    expect(second.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: true }]);
    expect(second.written).toHaveLength(1);
    expect(flagsFor(second.written[0]!)).toEqual([false, false]);
    expect(teamIn(second.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");
    expect(awardsCursorRow(h.d1)?.last_advanced_at).toBe(isoAt(listStoredAt));

    // 13:02, sixty minutes later, on a tick that passes the gate.
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-2" });
    const third = await h.tickAt(listStoredAt + 60 * MINUTE_MS);
    expect(third.written).toHaveLength(1);
    expect(flagsFor(third.written[0]!)).toEqual([true, true]);
    expect(teamIn(third.written[0]!, "frc3").districtLock.status).toBe("lockedAward");
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");
  });

  it("D8 (iii): an awards cursor write that throws leaves the rankings cursor unwritten, so the next tick's rankings pass the gate again", async () => {
    const h = makeHarness();
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: WINNER_AND_FINALIST, awardsEtag: "awards-etag-1" }));
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });
    h.d1.rejectCursorWritesForKeyPrefix = "__event_awards__:";

    const first = await h.tick();
    // The awards cursors are written first. The throw lands before the
    // rankings cursor, so neither row exists.
    expect(h.d1.eventCursors.has(AWARDS_CURSOR_KEY)).toBe(false);
    expect(h.d1.eventCursors.has(districtRankingsCursorKey(DISTRICT_KEY))).toBe(false);
    expect(first.result.districtsFailed).toBe(1);
    // `runTick` resolved, and the rotation offset survived.
    expect(h.d1.eventCursors.get("__scheduler_meta__")).toBeDefined();

    h.d1.rejectCursorWritesForKeyPrefix = null;
    const second = await h.tick();
    // No rankings ETag was cached, so the request is unconditional and its 200
    // passes the gate again.
    expect(second.rankingsCalls).toEqual([undefined]);
    expect(second.districtReads).toBe(1);
    expect(second.result.districtsFailed).toBe(0);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");
    expect(h.d1.eventCursors.get(districtRankingsCursorKey(DISTRICT_KEY))?.tba_etag).toBe("rank-etag-1");
  });
});

// ---------------------------------------------------------------------------
// The settle time (quick task 261009-tx6, D1). The flag needs a third fact: the
// awards list unchanged for 60 minutes. The awards cursor row holds the ETag of
// the last list merged and, in `last_advanced_at`, the time that ETag last
// changed. Every unknown reads as changed NOW.
//
// Every clock in this describe has a UTC minute that is not a multiple of 5.
// ---------------------------------------------------------------------------

describe("runTick — the awards flag also waits for the list to settle for an hour (261009-tx6)", () => {
  /** The live event finished, a judged list under one ETag, and the rankings already carrying frc3's award points. */
  function settleHarness(options: HarnessOptions = {}): Harness {
    const h = makeHarness({ windows: [longLiveWindow()], ...options });
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST, awardsEtag: "awards-etag-1" }));
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-1" });
    return h;
  }

  /** Serves the same rankings under a new ETag, so the next tick's rankings request is a 200 and passes the gate. */
  let rankingsBump = 1;
  function bumpRankings(h: Harness): void {
    rankingsBump += 1;
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: `rank-etag-bump-${String(rankingsBump)}` });
  }

  it("the first list: a judged award and its points on one tick leave the flag false, record the winner, and stamp the row with that tick's time", async () => {
    const h = settleHarness();

    const report = await h.tickAt(NOW_MS);

    expect(report.written).toHaveLength(1);
    expect(flagsFor(report.written[0]!)).toEqual([false, false]);
    expect(teamIn(report.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(teamIn(report.written[0]!, "frc3").districtLock.status).not.toBe("lockedAward");
    expect(awardsCursorRow(h.d1)).toMatchObject({ tba_etag: "awards-etag-1", last_advanced_at: isoAt(NOW_MS) });
  });

  it("settled: a row holding the list's ETag for 61 minutes turns the flag true on a tick that passes the gate, in one put, and is not rewritten", async () => {
    const h = settleHarness();
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 61);
    const seededRow = { ...awardsCursorRow(h.d1)! };

    const report = await h.tickAt(NOW_MS);

    expect(report.written).toHaveLength(1);
    expect(flagsFor(report.written[0]!)).toEqual([true, true]);
    expect(teamIn(report.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(teamIn(report.written[0]!, "frc3").districtLock.status).toBe("lockedAward");
    expect(awardsCursorRow(h.d1)).toEqual(seededRow);
  });

  it("59 minutes is not settled: the flag stays false, and the winner is recorded all the same", async () => {
    const h = settleHarness();
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 59);

    const report = await h.tickAt(NOW_MS);

    expect(report.written).toHaveLength(1);
    expect(flagsFor(report.written[0]!)).toEqual([false, false]);
    expect(teamIn(report.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
  });

  it("the list changes during the wait: the clock restarts at that tick, 59 minutes later is false and 60 minutes later is true", async () => {
    const h = settleHarness();
    // Fifty minutes into the wait on the old list, TBA lists one more award.
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 50);
    h.events.get(LIVE_EVENT)!.awards = [...JUDGED_LIST, EI_TO_FRC2];
    h.events.get(LIVE_EVENT)!.awardsEtag = "awards-etag-2";

    const changed = await h.tickAt(NOW_MS);
    expect(flagsFor(changed.written[0]!)).toEqual([false, false]);
    expect(awardsCursorRow(h.d1)).toMatchObject({ tba_etag: "awards-etag-2", last_advanced_at: isoAt(NOW_MS) });

    bumpRankings(h);
    await h.tickAt(NOW_MS + 59 * MINUTE_MS);
    expect(flagsFor(h.current())).toEqual([false, false]);

    bumpRankings(h);
    const settled = await h.tickAt(NOW_MS + 60 * MINUTE_MS);
    expect(settled.written).toHaveLength(1);
    expect(flagsFor(settled.written[0]!)).toEqual([true, true]);
    expect(awardsCursorRow(h.d1)).toMatchObject({ tba_etag: "awards-etag-2", last_advanced_at: isoAt(NOW_MS) });
  });

  it("the row an older Worker left (an ETag and no change time) reads as changed now: stamped on the first list in hand, true 60 minutes later", async () => {
    const h = settleHarness();
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", null);

    const first = await h.tickAt(NOW_MS);
    expect(flagsFor(first.written[0]!)).toEqual([false, false]);
    expect(awardsCursorRow(h.d1)).toMatchObject({ tba_etag: "awards-etag-1", last_advanced_at: isoAt(NOW_MS) });

    bumpRankings(h);
    await h.tickAt(NOW_MS + 59 * MINUTE_MS);
    expect(flagsFor(h.current())).toEqual([false, false]);

    bumpRankings(h);
    const settled = await h.tickAt(NOW_MS + 60 * MINUTE_MS);
    expect(flagsFor(settled.written[0]!)).toEqual([true, true]);
  });

  it("a failed ask on a tick that PASSES the gate restarts the clock: the marker is written, and the next list reads as changed now", async () => {
    const h = settleHarness();
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 61);
    h.events.get(LIVE_EVENT)!.awardsStatus = 500;

    // The rankings are a 200 (no cursor yet), so the gate passes and the
    // artifact is read: the flag is known to wait, and the marker is written.
    const failed = await h.tickAt(NOW_MS);
    expect(failed.districtReads).toBe(1);
    expect(flagsFor(failed.written[0]!)).toEqual([false, false]);
    expect(awardsCursorEtag(h.d1)).toBeNull();

    // TBA answers again one minute later. The list is the one that had
    // settled, and it still reads as changed now.
    delete h.events.get(LIVE_EVENT)!.awardsStatus;
    const next = await h.tickAt(NOW_MS + MINUTE_MS);
    expect(next.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: true }]);
    expect(flagsFor(next.written[0]!)).toEqual([false, false]);
    expect(awardsCursorRow(h.d1)).toMatchObject({ tba_etag: "awards-etag-1", last_advanced_at: isoAt(NOW_MS + MINUTE_MS) });
    expectNoSecretInWarns(h.warnSpy);
  });

  it("a failed ask on a tick that does NOT pass the gate leaves the clock alone: no marker, the row stands, and the next passing tick turns the flag true", async () => {
    // Published: playoffs done, awards not posted, nothing else to learn.
    const h = settleHarness({ artifact: districtArtifactWithState(stateBlock({ playoffsDone: true, awardsPosted: false })) });
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 61);
    const seededRow = { ...awardsCursorRow(h.d1)! };
    // Rankings 304 and match 304: nothing but an awards list could pass the gate.
    seedCursor(h.d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);
    seedCursor(h.d1, LIVE_EVENT, "etag-1", `${LIVE_EVENT}_f1m1`);
    h.events.get(LIVE_EVENT)!.awardsStatus = 500;

    const failed = await h.tickAt(NOW_MS);
    expect(failed.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-1", beforeArtifactRead: true }]);
    expect(failed.districtReads).toBe(0);
    expect(failed.written).toHaveLength(0);
    expect(awardsWarns(h.warnSpy)).toHaveLength(1);
    expect(awardsCursorRow(h.d1)).toEqual(seededRow);

    delete h.events.get(LIVE_EVENT)!.awardsStatus;
    bumpRankings(h);
    const next = await h.tickAt(NOW_MS + MINUTE_MS);
    expect(next.written).toHaveLength(1);
    expect(flagsFor(next.written[0]!)).toEqual([true, true]);
    expect(teamIn(next.written[0]!, "frc3").districtLock.status).toBe("lockedAward");
    expect(awardsCursorRow(h.d1)).toEqual(seededRow);
  });

  it("a response with no ETag header never settles: the flag is still false on a passing tick two hours later", async () => {
    const h = settleHarness();
    h.events.get(LIVE_EVENT)!.awardsNoEtag = true;

    const first = await h.tickAt(NOW_MS);
    expect(flagsFor(first.written[0]!)).toEqual([false, false]);
    expect(awardsCursorRow(h.d1)).toMatchObject({ tba_etag: null, last_advanced_at: isoAt(NOW_MS) });

    bumpRankings(h);
    await h.tickAt(NOW_MS + 120 * MINUTE_MS);
    expect(flagsFor(h.current())).toEqual([false, false]);
    expect(awardsWarns(h.warnSpy)).toEqual([]);
  });

  it("awards do not un post: a flag already true stays true on the tick a later award changes the list, and that award is recorded", async () => {
    const h = settleHarness({ artifact: districtArtifactWithState(stateBlock({ playoffsDone: true, awardsPosted: true })) });
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 61);
    h.events.get(LIVE_EVENT)!.awards = [...JUDGED_LIST, EI_TO_FRC2];
    h.events.get(LIVE_EVENT)!.awardsEtag = "awards-etag-2";

    const report = await h.tickAt(NOW_MS);

    expect(report.written).toHaveLength(1);
    expect(flagsFor(report.written[0]!)).toEqual([true, true]);
    expect(teamIn(report.written[0]!, "frc2").qualifyingAwards).toEqual([{ eventKey: LIVE_EVENT, awardType: 9, label: "Engineering Inspiration", awardOnly: true }]);
    // The list changed, so its row is stamped again. The flag does not read it.
    expect(awardsCursorRow(h.d1)).toMatchObject({ tba_etag: "awards-etag-2", last_advanced_at: isoAt(NOW_MS) });
  });
});

describe("runTick — the awards fetch", () => {
  it("asks once after playoffsDone, and a Winner only list leaves awardsPosted false with its ETag stored", async () => {
    const h = makeHarness();
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: WINNER_ONLY, awardsEtag: "awards-etag-1" }));
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });

    const report = await h.tick();

    expect(report.awardsCalls).toHaveLength(1);
    expect(writtenLiveEventState(h.r2)).toEqual({ qualMatchesPlayed: 2, qualMatchesTotal: 2, alliancesPicked: true, playoffsDone: true, awardsPosted: false });
    expect(report.written[0]!.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");
  });

  it("turns awardsPosted true on a settled Impact list whose points are in the rankings, records the winner, and writes once", async () => {
    const h = makeHarness();
    // The list has been in the pass's hands, unchanged, for more than an hour.
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 61);
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST, awardsEtag: "awards-etag-1" }));
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-1" });

    const report = await h.tick();

    // A conditional 304 before the gate, then the one ask with no ETag.
    expect(report.awardsCalls).toHaveLength(2);
    expect(report.written).toHaveLength(1);
    expect(writtenLiveEventState(h.r2)).toEqual({ qualMatchesPlayed: 2, qualMatchesTotal: 2, alliancesPicked: true, playoffsDone: true, awardsPosted: true });
    expect(teamIn(report.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");
  });

  it("makes NO awards request at all while the playoffs are not done", async () => {
    const h = makeHarness();
    h.events.set(LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST }));
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });

    const report = await h.tick();

    expect(report.awardsCalls).toHaveLength(0);
    expect(writtenLiveEventState(h.r2)?.awardsPosted).toBe(false);
    expect(h.d1.eventCursors.has(AWARDS_CURSOR_KEY)).toBe(false);
  });

  for (const [name, body] of [
    ["an EMPTY awards array", []],
    ["a null awards body", null],
  ] as const) {
    it(`leaves awardsPosted false on ${name}, does not throw, and stores the ETag`, async () => {
      const h = makeHarness();
      h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: body, awardsEtag: "awards-etag-1" }));
      h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-1" });

      const report = await h.tick();

      expect(report.result.districtsFailed).toBe(0);
      expect(report.awardsCalls).toHaveLength(1);
      expect(writtenLiveEventState(h.r2)?.awardsPosted).toBe(false);
      expect(awardsWarns(h.warnSpy)).toEqual([]);
      expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");
    });
  }

  it("asks twice for a waiting event whose list is unchanged (a stored ETag, a flag not yet true): a conditional 304, then no ETag, and with the list settled the flag follows the first two facts", async () => {
    async function flagAfter(awards: unknown, rankings: unknown): Promise<{ calls: AwardsCall[]; posted: boolean | undefined }> {
      const h = makeHarness();
      seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 61);
      h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards, awardsEtag: "awards-etag-1" }));
      h.districts.set(DISTRICT_KEY, { rankings, etag: "rank-etag-1" });
      const report = await h.tick();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      return { calls: report.awardsCalls, posted: writtenLiveEventState(h.r2)?.awardsPosted };
    }
    const twoAsks = [
      { ifNoneMatch: "awards-etag-1", beforeArtifactRead: true },
      { ifNoneMatch: undefined, beforeArtifactRead: false },
    ];

    // The old rule read this 304 as "still empty". The list may hold anything.
    expect(await flagAfter(WINNER_ONLY, rankingsWithAwardPoints())).toEqual({ calls: twoAsks, posted: false });
    expect(await flagAfter(JUDGED_LIST, movedRankings())).toEqual({ calls: twoAsks, posted: false });
    expect(await flagAfter(JUDGED_LIST, rankingsWithAwardPoints())).toEqual({ calls: twoAsks, posted: true });
  });

  it("publishes ONE MORE points slot once the live event's Impact award is posted — the 260925-ms7 reservation, end to end through the Worker", async () => {
    /** The same tick, run against a published state that differs only in `awardsPosted`. */
    async function statuses(awardsPosted: boolean): Promise<string[]> {
      const d1 = new FakeD1Database();
      const r2 = new FakeR2Bucket();
      r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactWithState(stateBlock({ playoffsDone: true, awardsPosted }))));
      const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
      const fetchMock = makeTbaFetchStub(
        new Map([[LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: [] })]]),
        new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]])
      );
      vi.stubGlobal("fetch", fetchMock);
      await runTick(env, { nowMs: NOW_MS });
      const puts = districtPuts(r2);
      const written = DistrictArtifactSchema.parse(JSON.parse(puts[puts.length - 1]!.body));
      return written.teams.map((team) => team.districtLock.status);
    }

    // Two DCMP slots. While the award is still to come one slot is held back,
    // so only the top team is guaranteed; once it is posted the second slot
    // returns to the points race and frc2 locks too. frc3 is out either way,
    // because the elimination test reads the unreserved count in both runs.
    expect(await statuses(false)).toEqual(["locked", "contending", "eliminated"]);
    expect(await statuses(true)).toEqual(["locked", "locked", "eliminated"]);
  });

  it("asks once, with no ETag, for an event whose published flag is already true and that has no awards cursor row, and the next tick's ask is conditional", async () => {
    // The offline publisher set this flag, so the Worker has never asked. One
    // unconditional ask gives the event a row, and from then on a changed
    // list passes the gate. Awards do not un post: the flag stays true even
    // though this list holds only a Winner.
    const h = makeHarness({ artifact: districtArtifactWithState(stateBlock({ playoffsDone: true, awardsPosted: true })) });
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: WINNER_ONLY, awardsEtag: "awards-etag-1" }));
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });

    const first = await h.tick();
    expect(first.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: false }]);
    expect(writtenLiveEventState(h.r2)?.awardsPosted).toBe(true);
    expect(awardsCursorEtag(h.d1)).toBe("awards-etag-1");

    const second = await h.tick();
    expect(second.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-1", beforeArtifactRead: true }]);
    expect(second.districtReads).toBe(0);
  });

  it("asks nothing more for an event whose flag is already true and whose conditional ask answered 304", async () => {
    const h = makeHarness({ artifact: districtArtifactWithState(stateBlock({ playoffsDone: true, awardsPosted: true })) });
    seedCursor(h.d1, AWARDS_CURSOR_KEY, "awards-etag-1", null);
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST, awardsEtag: "awards-etag-1" }));
    h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });

    const report = await h.tick();

    expect(report.awardsCalls).toEqual([{ ifNoneMatch: "awards-etag-1", beforeArtifactRead: true }]);
    expect(writtenLiveEventState(h.r2)?.awardsPosted).toBe(true);
    // The 304 carried no list, so nothing is recorded from it.
    expect(report.written[0]!.teams.map((team) => team.qualifyingAwards)).toEqual([[], [], []]);
  });

  it("still asks when THIS tick's match poll was a 304 but the PUBLISHED state says playoffs done and awards not posted, and a settled Impact list with its points turns the flag true", async () => {
    const h = makeHarness({ artifact: districtArtifactWithState(stateBlock({ playoffsDone: true, awardsPosted: false })) });
    seedCursor(h.d1, LIVE_EVENT, "etag-1", `${LIVE_EVENT}_f1m1`);
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 61);
    h.events.set(LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: JUDGED_LIST, awardsEtag: "awards-etag-1" }));
    h.districts.set(DISTRICT_KEY, { rankings: rankingsWithAwardPoints(), etag: "rank-etag-1" });

    const report = await h.tick();

    // The ask inside the loop, with no ETag, is the one the published state
    // earns: nothing was observed this tick.
    expect(report.awardsCalls).toEqual([
      { ifNoneMatch: "awards-etag-1", beforeArtifactRead: true },
      { ifNoneMatch: undefined, beforeArtifactRead: false },
    ]);
    expect(writtenLiveEventState(h.r2)?.awardsPosted).toBe(true);
    expect(teamIn(report.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
  });
});

// ---------------------------------------------------------------------------
// The day long watch (quick task 261009-tx6, D2).
//
// The district pass is handed a WATCH SET: every district window of the
// manifest that is live or ended within the last 24 hours, beside the windows
// the tick processed. A district with a member the tick processed runs every
// tick. Any other watched district runs only when the tick's UTC minute is a
// multiple of 5. On a multiple of 15, the FORCED LOOK, every watched
// district's rankings are asked with no ETag and the gate is passed
// unconditionally.
//
// EVERY TEST HERE STATES ITS UTC MINUTE. `NOW_MS` is 12:01, which is neither.
// ---------------------------------------------------------------------------

/** An epoch for a wall clock time on the fixture day, 2026-08-22 UTC. */
function clockAt(hour: number, minute: number): number {
  return Date.parse(`2026-08-22T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
}

/** A measured district window that closed `minutesBefore` minutes before `clockMs`: never live at or after that clock, and inside the watch while that is under 24 hours. */
function endedWindow(eventKey: string, minutesBefore: number, clockMs: number, overrides: Partial<WindowFixture> = {}): WindowFixture {
  const endMs = clockMs - minutesBefore * MINUTE_MS;
  return { eventKey, season: SEASON, startMs: endMs - 3 * 24 * 60 * MINUTE_MS, endMs, districtKey: DISTRICT_KEY, ...overrides };
}

/** Playoffs done, awards not posted: the state of an event whose flag still waits. */
const WAITING_STATE: StateBlock = { qualMatchesPlayed: 2, qualMatchesTotal: 2, alliancesPicked: true, playoffsDone: true, awardsPosted: false };

interface WatchEvent {
  readonly eventKey: string;
  /** Default 2. */
  readonly week?: number | null;
  /** Default `WAITING_STATE`. */
  readonly state?: StateBlock;
  /** frc3's award points at the event. Default 0. */
  readonly frc3Award?: number;
}

/**
 * Three teams and nothing left to play. Every team has a finished row at
 * `2026wabon`. frc1 (10 points: 9 qualification and 1 playoff) and frc3 (2
 * qualification points, plus its award points) also have a row at every
 * listed event, carrying that event's state.
 *
 * frc1's one PLAYOFF point is there because the live awards flag waits until
 * some row at the event carries a playoff point (quick task 261009-vp9), and
 * every watched event here means an event whose playoff points are in. No
 * row carries the winner's 30, so every category of a waiting event still
 * reads open until its flag turns true.
 */
function watchArtifact(events: readonly WatchEvent[]): unknown {
  const rowsFor = (qual: number, awardAt: (event: WatchEvent) => number, elim = 0) =>
    events.map((event) => ({
      eventKey: event.eventKey,
      eventName: event.eventKey,
      week: event.week === undefined ? 2 : event.week,
      tier: "district",
      qual,
      alliance: 0,
      elim,
      award: awardAt(event),
      total: qual + elim + awardAt(event),
      state: { ...(event.state ?? WAITING_STATE) },
    }));
  const team = (teamKey: string, teamNumber: number, rank: number, base: number, rows: ReturnType<typeof rowsFor>) => ({
    teamKey,
    teamNumber,
    nickname: `Team ${String(teamNumber)}`,
    rank,
    pointTotal: base + rows.reduce((sum, row) => sum + row.total, 0),
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: [{ eventKey: PLAYED_EVENT, eventName: "Bonney Lake", week: 1, tier: "district", qual: base, alliance: 0, elim: 0, award: 0, total: base, state: { ...PLAYED_EVENT_STATE } }, ...rows],
    remainingEvents: [],
    maxRemainingDistrict: 0,
    maxRemainingChamp: 0,
    qualifyingAwards: [],
    districtLock: lockVerdict("contending"),
    champLock: lockVerdict("contending"),
  });
  return {
    ...(districtArtifactFixture() as Record<string, unknown>),
    teams: [team("frc1", 1, 1, 40, rowsFor(9, () => 0, 1)), team("frc2", 2, 2, 30, []), team("frc3", 3, 3, 10, rowsFor(2, (event) => event.frc3Award ?? 0))],
  };
}

/** The TBA rankings payload that says exactly what an artifact's rows say. */
function rankingsOf(artifact: unknown): unknown {
  const parsed = DistrictArtifactSchema.parse(artifact);
  return parsed.teams.map((team) => ({
    team_key: team.teamKey,
    rank: team.rank,
    point_total: team.pointTotal,
    rookie_bonus: team.rookieBonus,
    adjustments: team.adjustments,
    event_points: team.eventPoints.map((row) => ({ event_key: row.eventKey, district_cmp: row.tier === "dcmp", qual_points: row.qual, alliance_points: row.alliance, elim_points: row.elim, award_points: row.award, total: row.total })),
  }));
}

/** An event TBA has nothing new to say about except its awards list. */
function awardsOnlyRecord(awards: unknown, awardsEtag: string, extra: Partial<TbaEventRecord> = {}): TbaEventRecord {
  return { matches: [], etag: "etag-1", eventType: 1, season: SEASON, awards, awardsEtag, ...extra };
}

interface WatchHarnessOptions {
  readonly events: readonly WatchEvent[];
  readonly windows: readonly WindowFixture[];
  /** What TBA's rankings say. Default: exactly what the seeded artifact's rows say. */
  readonly rankingsEvents?: readonly WatchEvent[];
  readonly withoutAlgorithmsManifest?: boolean;
}

/**
 * The seeded artifact is `watchArtifact(events)` at the verdict pass's fixed
 * point, as a published artifact is, and TBA's rankings say what its rows say
 * (or what `rankingsEvents` says), under the ETag `rank-etag-1`.
 */
function watchHarness(options: WatchHarnessOptions): Harness {
  const h = makeHarness({
    artifact: recomputeDistrictVerdicts(DistrictArtifactSchema.parse(watchArtifact(options.events))),
    windows: options.windows,
    ...(options.withoutAlgorithmsManifest === true ? { withoutAlgorithmsManifest: true } : {}),
  });
  h.districts.set(DISTRICT_KEY, { rankings: rankingsOf(watchArtifact(options.rankingsEvents ?? options.events)), etag: "rank-etag-1" });
  return h;
}

/** The warn lines carrying one `msg`, parsed. */
function warnsNamed(warnSpy: WarnSpy, msg: string): Record<string, unknown>[] {
  return warnLines(warnSpy)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry["msg"] === msg);
}

/** The `event_cursor` reads that named the district's rankings key: the district pass's own reads, and nobody else's. */
function passCursorReads(d1: FakeD1Database): string[][] {
  return d1.cursorSelects.filter((keys) => keys.includes(districtRankingsCursorKey(DISTRICT_KEY)));
}

const NO_DISTRICT_WORK = { districtsConsidered: 0, districtsRefreshed: 0, districtsUnchanged: 0, districtsFailed: 0 };

describe("runTick — the district pass watches an event for a day after its window (261009-tx6)", () => {
  describe("what a tick with nothing to watch costs", () => {
    // Minute 12:15, a forced look, so nothing here is cheap by accident.
    const AT = clockAt(12, 15);
    const cases: [string, WindowFixture[]][] = [
      ["no window at all", []],
      ["an ended window of a non district event", [endedWindow(LIVE_EVENT, 10, AT, { districtKey: null })]],
      ["an ended window with no districtKey field", [endedWindow(LIVE_EVENT, 10, AT, { districtKey: undefined })]],
      ["a district window that ended exactly 24 hours ago", [endedWindow(LIVE_EVENT, 24 * 60, AT)]],
      ["a district window that has not opened yet", [{ eventKey: LIVE_EVENT, season: SEASON, startMs: AT + MINUTE_MS, endMs: AT + 60 * MINUTE_MS, districtKey: DISTRICT_KEY }]],
    ];
    for (const [name, windows] of cases) {
      it(`${name}: nothing beyond the one manifest read`, async () => {
        const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }], windows });

        const report = await h.tickAt(AT);

        expect(h.fetchMock.mock.calls).toHaveLength(0);
        expect(report.result.subrequestsUsed).toBe(1);
        expect(h.r2.getCallCount).toBe(1);
        expect(h.r2.putCallCount).toBe(0);
        expect(h.d1.callCount).toBe(0);
        expect(report.result).toMatchObject(NO_DISTRICT_WORK);
      });
    }
  });

  describe("the two cadences, with nothing live and one district window that ended ten minutes ago", () => {
    function quietDistrict(clockMs: number): Harness {
      const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }], windows: [endedWindow(LIVE_EVENT, 10, clockMs)] });
      h.events.set(LIVE_EVENT, awardsOnlyRecord(WINNER_AND_FINALIST, "awards-etag-1"));
      return h;
    }

    it("minute 12:01: no district is due, so the tick costs its one manifest read and nothing else", async () => {
      const h = quietDistrict(clockAt(12, 1));

      const report = await h.tickAt(clockAt(12, 1));

      expect(h.fetchMock.mock.calls).toHaveLength(0);
      expect(report.result.subrequestsUsed).toBe(1);
      expect(h.d1.callCount).toBe(0);
      expect(report.result).toMatchObject(NO_DISTRICT_WORK);
    });

    it("minute 12:05 with nothing changed: one rankings request, conditional on the stored ETag, and no artifact read", async () => {
      const h = quietDistrict(clockAt(12, 5));
      seedCursor(h.d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);

      const report = await h.tickAt(clockAt(12, 5));

      expect(report.rankingsCalls).toEqual(["rank-etag-1"]);
      expect(report.awardsCalls).toEqual([]);
      expect(h.fetchMock.mock.calls).toHaveLength(1);
      expect(report.districtReads).toBe(0);
      expect(report.written).toHaveLength(0);
      expect(report.result).toMatchObject({ districtsConsidered: 1, districtsRefreshed: 0, districtsUnchanged: 1, districtsFailed: 0 });
    });

    it("minute 12:15, the forced look: the rankings are asked with NO If-None-Match although an ETag is stored, the artifact is read, nothing is put when nothing differs, and the rankings cursor is not rewritten", async () => {
      const h = quietDistrict(clockAt(12, 10));
      // 12:10, a quiet cadence tick with no rankings cursor yet: the 200
      // passes the gate, the awards list is merged and both cursors are stored.
      const first = await h.tickAt(clockAt(12, 10));
      expect(first.rankingsCalls).toEqual([undefined]);
      expect(first.written).toHaveLength(0);
      const rankingsRow = { ...h.d1.eventCursors.get(districtRankingsCursorKey(DISTRICT_KEY))! };
      expect(rankingsRow).toMatchObject({ tba_etag: "rank-etag-1", last_polled_at: isoAt(clockAt(12, 10)) });

      const forced = await h.tickAt(clockAt(12, 15));

      expect(forced.rankingsCalls).toEqual([undefined]);
      // The waiting event is asked: its conditional 304 before the gate, then
      // once more with no ETag so the rule has the list.
      expect(forced.awardsCalls).toEqual([
        { ifNoneMatch: "awards-etag-1", beforeArtifactRead: true },
        { ifNoneMatch: undefined, beforeArtifactRead: false },
      ]);
      expect(forced.districtReads).toBe(1);
      expect(forced.written).toHaveLength(0);
      expect(forced.result).toMatchObject({ districtsConsidered: 1, districtsRefreshed: 0, districtsUnchanged: 1, districtsFailed: 0 });
      expect(h.d1.eventCursors.get(districtRankingsCursorKey(DISTRICT_KEY))).toEqual(rankingsRow);
    });

    it("a live district is asked every minute as before (12:02, 12:03), and at 12:15 its rankings request carries no If-None-Match", async () => {
      const h = makeHarness({ windows: [longLiveWindow()] });
      h.events.set(LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1"));
      h.districts.set(DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" });

      expect((await h.tickAt(clockAt(12, 2))).rankingsCalls).toEqual([undefined]);
      expect((await h.tickAt(clockAt(12, 3))).rankingsCalls).toEqual(["rank-etag-1"]);
      const forced = await h.tickAt(clockAt(12, 15));
      expect(forced.rankingsCalls).toEqual([undefined]);
      expect(h.d1.eventCursors.get(districtRankingsCursorKey(DISTRICT_KEY))?.tba_etag).toBe("rank-etag-1");
      // The playoffs are open and the window is open: no awards request, forced look or not.
      expect(forced.awardsCalls).toEqual([]);
    });
  });

  describe("the forced look", () => {
    it("the settle time fires by itself: a list merged at 12:10 reads false at 12:15, 12:30, 12:45 and 13:00 and true at 13:15, with the winner locked by its award in that one put", async () => {
      const events = [{ eventKey: LIVE_EVENT, frc3Award: 10 }];
      const h = watchHarness({ events, windows: [endedWindow(LIVE_EVENT, 10, clockAt(12, 10))] });
      h.events.set(LIVE_EVENT, awardsOnlyRecord(JUDGED_LIST, "awards-etag-1"));

      // 12:10: the judged list is merged with its points already in the rows.
      const merged = await h.tickAt(clockAt(12, 10));
      expect(merged.written).toHaveLength(1);
      expect(flagsFor(merged.written[0]!)).toEqual([false, false]);
      expect(teamIn(merged.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);
      expect(awardsCursorRow(h.d1)).toMatchObject({ tba_etag: "awards-etag-1", last_advanced_at: isoAt(clockAt(12, 10)) });

      // Nothing changes at TBA from here on.
      for (const [hour, minute] of [[12, 15], [12, 30], [12, 45], [13, 0]] as const) {
        const waiting = await h.tickAt(clockAt(hour, minute));
        expect({ hour, minute, puts: waiting.written.length, flags: flagsFor(h.current()) }).toEqual({ hour, minute, puts: 0, flags: [false, false] });
        expect(teamIn(h.current(), "frc3").districtLock.status).not.toBe("lockedAward");
      }

      // 13:10: sixty minutes have passed, on a quiet cadence tick. Every poll
      // is a 304, the gate stays shut, and nothing is read.
      const quiet = await h.tickAt(clockAt(13, 10));
      expect(quiet.districtReads).toBe(0);
      expect(flagsFor(h.current())).toEqual([false, false]);

      // 13:15: the forced look reads the rule again, and all three facts hold.
      const settled = await h.tickAt(clockAt(13, 15));
      expect(settled.written).toHaveLength(1);
      expect(flagsFor(settled.written[0]!)).toEqual([true, true]);
      expect(teamIn(settled.written[0]!, "frc3").districtLock.status).toBe("lockedAward");
      expect(awardsWarns(h.warnSpy)).toEqual([]);
    });

    it("heals after an offline republish replaced the artifact: a quiet tick reads nothing, and the next forced look writes the points, the winner and the flag in one put", async () => {
      // R2 holds what a republish from an older corpus wrote: the flag false,
      // no winner record, no award points. The cursors are untouched: they
      // still say the rankings and the awards list are the ones last seen.
      const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }], rankingsEvents: [{ eventKey: LIVE_EVENT, frc3Award: 10 }], windows: [endedWindow(LIVE_EVENT, 120, clockAt(12, 20))] });
      h.events.set(LIVE_EVENT, awardsOnlyRecord(JUDGED_LIST, "awards-etag-1"));
      seedCursor(h.d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);
      seedAwardsRow(h.d1, LIVE_EVENT, "awards-etag-1", 90, clockAt(12, 20));

      // 12:20, a quiet cadence tick.
      const quiet = await h.tickAt(clockAt(12, 20));
      expect(quiet.rankingsCalls).toEqual(["rank-etag-1"]);
      expect(quiet.districtReads).toBe(0);
      expect(quiet.written).toHaveLength(0);

      // 12:30, the forced look.
      const forced = await h.tickAt(clockAt(12, 30));
      expect(forced.rankingsCalls).toEqual([undefined]);
      expect(forced.written).toHaveLength(1);
      const frc3 = teamIn(forced.written[0]!, "frc3");
      expect(frc3.eventPoints.find((row) => row.eventKey === LIVE_EVENT)!.award).toBe(10);
      expect(frc3.qualifyingAwards).toEqual([IMPACT_RECORD]);
      expect(flagsFor(forced.written[0]!)).toEqual([true, true]);
      expect(frc3.districtLock.status).toBe("lockedAward");
    });

    it("an event with no awards cursor row in a quiet district is asked, with no ETag, on the next forced look, and gets its row", async () => {
      const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }], windows: [endedWindow(LIVE_EVENT, 10, clockAt(12, 5))] });
      h.events.set(LIVE_EVENT, awardsOnlyRecord(WINNER_AND_FINALIST, "awards-etag-1"));
      seedCursor(h.d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);

      // 12:05: the district is quiet and the event has no row, so nothing asks it.
      const quiet = await h.tickAt(clockAt(12, 5));
      expect(quiet.awardsCalls).toEqual([]);
      expect(quiet.districtReads).toBe(0);
      expect(awardsCursorRow(h.d1)).toBeUndefined();

      // 12:15.
      const forced = await h.tickAt(clockAt(12, 15));
      expect(forced.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: false }]);
      expect(awardsCursorRow(h.d1)).toMatchObject({ tba_etag: "awards-etag-1", last_advanced_at: isoAt(clockAt(12, 15)) });
    });

    it("a failed awards cursor write is repaired by the forced look after it", async () => {
      const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }], windows: [endedWindow(LIVE_EVENT, 10, clockAt(12, 15))] });
      h.events.set(LIVE_EVENT, awardsOnlyRecord(WINNER_AND_FINALIST, "awards-etag-1"));
      seedCursor(h.d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);
      h.d1.rejectCursorWritesForKeyPrefix = "__event_awards__:";

      // 12:15: asked, and the row's write fails.
      const failed = await h.tickAt(clockAt(12, 15));
      expect(failed.awardsCalls).toHaveLength(1);
      expect(failed.result.districtsFailed).toBe(1);
      expect(awardsCursorRow(h.d1)).toBeUndefined();

      // 12:20: quiet again, and still no row, so still nothing asks it.
      h.d1.rejectCursorWritesForKeyPrefix = null;
      expect((await h.tickAt(clockAt(12, 20))).awardsCalls).toEqual([]);

      // 12:30.
      const repaired = await h.tickAt(clockAt(12, 30));
      expect(repaired.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: false }]);
      expect(repaired.result.districtsFailed).toBe(0);
      expect(awardsCursorRow(h.d1)).toMatchObject({ tba_etag: "awards-etag-1", last_advanced_at: isoAt(clockAt(12, 30)) });
    });

    it("playoffs that ran past the measured window: an ended event whose published state says its playoffs are open is asked on a forced look only, and reaches flag true with every category final", async () => {
      const playoffsOpen: StateBlock = { ...WAITING_STATE, playoffsDone: false };
      const h = watchHarness({ events: [{ eventKey: LIVE_EVENT, state: playoffsOpen, frc3Award: 10 }], windows: [endedWindow(LIVE_EVENT, 10, clockAt(12, 5))] });
      h.events.set(LIVE_EVENT, awardsOnlyRecord(JUDGED_LIST, "awards-etag-1"));

      // 12:05: the rankings are a 200 (no cursor yet), so the gate passes and
      // the event is looked at. Its playoffs read open and this is not a
      // forced look: it is not asked.
      const quiet = await h.tickAt(clockAt(12, 5));
      expect(quiet.districtReads).toBe(1);
      expect(quiet.awardsCalls).toEqual([]);

      // 12:15: asked with no ETag. The list is new to the pass, so the flag waits.
      const forced = await h.tickAt(clockAt(12, 15));
      expect(forced.awardsCalls).toEqual([{ ifNoneMatch: undefined, beforeArtifactRead: false }]);
      expect(flagsFor(forced.written[0]!)).toEqual([false, false]);
      expect(teamIn(forced.written[0]!, "frc3").qualifyingAwards).toEqual([IMPACT_RECORD]);

      // 13:15: a judged award, its points, and sixty settled minutes.
      const settled = await h.tickAt(clockAt(13, 15));
      expect(settled.written).toHaveLength(1);
      expect(flagsFor(settled.written[0]!)).toEqual([true, true]);
      const state = teamIn(settled.written[0]!, "frc3").eventPoints.find((row) => row.eventKey === LIVE_EVENT)!.state!;
      expect(state).toEqual({ ...playoffsOpen, awardsPosted: true });
      // The posted awards close every earlier category through the cascade.
      expect(districtEventStateFinished(state)).toBe(true);
      expect(teamIn(settled.written[0]!, "frc3").districtLock.status).toBe("lockedAward");
    });
  });

  describe("the catch up", () => {
    const olderKey = (index: number): string => `2026old${String(index).padStart(2, "0")}`;
    const awardsKey = (eventKey: string): string => `__event_awards__:${eventKey}`;
    const oldAsked = (report: TickReport): string[] => report.awardsAsked.filter((call) => call.eventKey.startsWith("2026old")).map((call) => call.eventKey);

    it("a forced look asks at most eight older waiting events, none conditionally, reads their rows in one extra D1 read, stamps every one it asked, and a settled one turns true", async () => {
      const AT = clockAt(12, 15);
      // Ten older events (weeks 1 and 2) that the watch no longer covers, and
      // one whose key is not an event key at all.
      const older: WatchEvent[] = Array.from({ length: 10 }, (_, index) => ({ eventKey: olderKey(index), week: index < 5 ? 1 : 2, ...(index === 0 ? { frc3Award: 10 } : {}) }));
      const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }, ...older, { eventKey: "2026OLD_not-a-key", week: 1 }], windows: [endedWindow(LIVE_EVENT, 10, AT)] });
      h.events.set(LIVE_EVENT, awardsOnlyRecord(WINNER_AND_FINALIST, "live-awards-1"));
      // 2026old00: a judged list with its points, unchanged for more than an hour.
      h.events.set(olderKey(0), awardsOnlyRecord([tbaAward(0, "FIRST Impact Award", ["frc3"], olderKey(0))], "old00-a"));
      seedAwardsRow(h.d1, olderKey(0), "old00-a", 61, AT);
      // 2026old01: its list did not change since it was stored thirty minutes ago.
      h.events.set(olderKey(1), awardsOnlyRecord(WINNER_AND_FINALIST, "old01-a"));
      seedAwardsRow(h.d1, olderKey(1), "old01-a", 30, AT);
      const old01Seeded = { ...h.d1.eventCursors.get(awardsKey(olderKey(1)))! };
      // 2026old02: TBA fails.
      h.events.set(olderKey(2), awardsOnlyRecord(WINNER_AND_FINALIST, "old02-a", { awardsStatus: 500 }));
      // The rest have never been asked.
      for (let index = 3; index < 10; index++) h.events.set(olderKey(index), awardsOnlyRecord(WINNER_AND_FINALIST, `old${String(index)}-a`));

      const forced = await h.tickAt(AT);

      // Never asked first, ties by week then key: the first eight.
      expect(oldAsked(forced)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(olderKey));
      expect(forced.awardsAsked.filter((call) => call.eventKey.startsWith("2026old")).map((call) => call.ifNoneMatch)).toEqual(Array.from({ length: 8 }, () => undefined));
      expect(forced.awardsAsked.some((call) => call.eventKey === "2026OLD_not-a-key")).toBe(false);

      // ONE extra read, after the artifact read, naming all ten candidates and
      // not the key that is not an event key.
      const catchUpReads = h.d1.cursorSelects.filter((keys) => keys.some((key) => key.startsWith("__event_awards__:2026old") || key.startsWith("__event_awards__:2026OLD")));
      expect(catchUpReads).toHaveLength(1);
      expect([...catchUpReads[0]!].sort()).toEqual(Array.from({ length: 10 }, (_, index) => awardsKey(olderKey(index))));

      // Every event it asked is stamped with this tick's time, whatever it answered.
      for (let index = 0; index < 8; index++) expect({ index, polled: h.d1.eventCursors.get(awardsKey(olderKey(index)))?.last_polled_at }).toEqual({ index, polled: isoAt(AT) });
      expect(h.d1.eventCursors.has(awardsKey(olderKey(8)))).toBe(false);
      expect(h.d1.eventCursors.has(awardsKey(olderKey(9)))).toBe(false);
      // Unchanged: the ETag and the change time stand.
      expect(h.d1.eventCursors.get(awardsKey(olderKey(1)))).toEqual({ ...old01Seeded, last_polled_at: isoAt(AT) });
      // Failed: the marker, and one warn that names the event.
      expect(h.d1.eventCursors.get(awardsKey(olderKey(2)))).toMatchObject({ tba_etag: null, last_polled_at: isoAt(AT) });
      expect(awardsWarns(h.warnSpy).map((entry) => entry["eventKey"])).toEqual([olderKey(2)]);
      // New to the pass: stored, and changed now.
      expect(h.d1.eventCursors.get(awardsKey(olderKey(3)))).toMatchObject({ tba_etag: "old3-a", last_advanced_at: isoAt(AT), last_polled_at: isoAt(AT) });

      // The settled one turned true, with its winner.
      expect(forced.written).toHaveLength(1);
      expect(flagsFor(forced.written[0]!, olderKey(0))).toEqual([true, true]);
      expect(teamIn(forced.written[0]!, "frc3").qualifyingAwards).toEqual([{ eventKey: olderKey(0), awardType: 0, label: "FIRST Impact Award", awardOnly: false }]);
      expect(flagsFor(forced.written[0]!, olderKey(1))).toEqual([false, false]);
      expectNoSecretInWarns(h.warnSpy);

      // 12:20, a quiet cadence tick that passes the gate (new rankings ETag):
      // no older event is asked.
      h.districts.set(DISTRICT_KEY, { rankings: h.districts.get(DISTRICT_KEY)!.rankings, etag: "rank-etag-2" });
      const quiet = await h.tickAt(clockAt(12, 20));
      expect(quiet.districtReads).toBe(1);
      expect(oldAsked(quiet)).toEqual([]);
    });

    it("no starvation: ten events that can never post do not keep an eleventh from being asked, and it turns true once its list has settled", async () => {
      const stuckKey = (index: number): string => `2026oldstk${String(index).padStart(2, "0")}`;
      const POSTER = "2026oldzzpost";
      // The ten stuck events sort ahead of the one that can post: weeks 1 and
      // 2 against a null week, which goes last.
      const stuck: WatchEvent[] = Array.from({ length: 10 }, (_, index) => ({ eventKey: stuckKey(index), week: index < 5 ? 1 : 2 }));
      const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }, ...stuck, { eventKey: POSTER, week: null, frc3Award: 10 }], windows: [endedWindow(LIVE_EVENT, 10, clockAt(12, 15))] });
      h.events.set(LIVE_EVENT, awardsOnlyRecord(WINNER_AND_FINALIST, "live-awards-1"));
      for (let index = 0; index < 10; index++) h.events.set(stuckKey(index), awardsOnlyRecord(WINNER_AND_FINALIST, `stuck-${String(index)}`));
      h.events.set(POSTER, awardsOnlyRecord([tbaAward(0, "FIRST Impact Award", ["frc3"], POSTER)], "poster-a"));

      // Nine forced looks, 12:15 to 14:15.
      const looks: string[][] = [];
      const posterFlags: boolean[][] = [];
      for (let look = 0; look < 9; look++) {
        const report = await h.tickAt(clockAt(12, 15) + look * 15 * MINUTE_MS);
        looks.push(oldAsked(report));
        posterFlags.push(flagsFor(h.current(), POSTER));
        expect(report.result.districtsFailed).toBe(0);
      }

      // Look 1: all eleven have never been asked, so week then key decides.
      expect(looks[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(stuckKey));
      // Look 2: the three never asked first (week 2, week 2, null week), then
      // the least recently asked, which all tie on 12:15: week then key again.
      expect(looks[1]).toEqual([stuckKey(8), stuckKey(9), POSTER, ...[0, 1, 2, 3, 4].map(stuckKey)]);
      // Every look asks exactly eight, and every event still waiting is asked
      // within any two consecutive looks. The one that can post stops being a
      // candidate once its flag is true, so from then on the pair covers the
      // ten that cannot.
      const stuckKeys = stuck.map((event) => event.eventKey).sort();
      const posted = (look: number): boolean => look >= 0 && posterFlags[look]!.every((flag) => flag);
      for (let look = 0; look < looks.length; look++) {
        expect(looks[look]).toHaveLength(8);
        if (look === 0) continue;
        const pair = [...new Set([...looks[look - 1]!, ...looks[look]!])].sort();
        // Still waiting when the earlier look of the pair began?
        const posterStillWaiting = !posted(look - 2);
        expect({ look, pair }).toEqual({ look, pair: posterStillWaiting ? [...stuckKeys, POSTER].sort() : stuckKeys });
      }

      // The one that can post was first asked at 12:30 (look 2), was asked
      // again every second look, and turned true at 13:30 (look 6), the first
      // of its looks an hour after its list was stored. Not before.
      expect(looks.map((asked) => asked.includes(POSTER))).toEqual([false, true, false, true, false, true, false, false, false]);
      expect(posterFlags.map((flags) => flags.every((flag) => flag))).toEqual([false, false, false, false, false, true, true, true, true]);
      expect(posterFlags[1]).toEqual([false, false]);
      expect(posterFlags[posterFlags.length - 1]).toEqual([true, true]);
      expect(teamIn(h.current(), "frc3").qualifyingAwards).toEqual([{ eventKey: POSTER, awardType: 0, label: "FIRST Impact Award", awardOnly: false }]);
      // The ten that cannot post are still false.
      for (let index = 0; index < 10; index++) expect(flagsFor(h.current(), stuckKey(index))).toEqual([false, false]);
    });
  });

  describe("a calendar (inferred) window needs proof of a played match before its district is asked", () => {
    it("a LIVE inferred window the tick did not promote costs the pass one D1 read and no district request at 12:05 and 12:15, with no match cursor row and with one whose folded key is null", async () => {
      for (const seedRow of [false, true]) {
        const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }], windows: [liveWindow({ inferred: true })] });
        // The probe's own poll answers 304 or an empty list: not promoted.
        h.events.set(LIVE_EVENT, awardsOnlyRecord(JUDGED_LIST, "awards-etag-1"));
        if (seedRow) seedCursor(h.d1, LIVE_EVENT, "etag-1", null);

        for (const [hour, minute] of [[12, 5], [12, 15]] as const) {
          h.d1.cursorSelects.length = 0;
          h.fetchMock.mockClear();
          const report = await h.tickAt(clockAt(hour, minute));
          expect(report.result.eventsPromoted).toBe(0);
          expect(passCursorReads(h.d1)).toHaveLength(1);
          expect(tbaUrls(h.fetchMock).filter((u) => u.includes("/district/") || u.endsWith("/awards"))).toEqual([]);
          expect(report.districtReads).toBe(0);
          expect(report.result).toMatchObject(NO_DISTRICT_WORK);
        }

        // 12:06: not due, so not even the one read.
        h.d1.cursorSelects.length = 0;
        await h.tickAt(clockAt(12, 6));
        expect(passCursorReads(h.d1)).toHaveLength(0);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      }
    });

    it("with a folded match on its cursor row the same window's district is asked at 12:05 and forced at 12:15", async () => {
      const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }], windows: [liveWindow({ inferred: true })] });
      h.events.set(LIVE_EVENT, awardsOnlyRecord(WINNER_AND_FINALIST, "awards-etag-1"));
      seedCursor(h.d1, LIVE_EVENT, "etag-1", `${LIVE_EVENT}_qm2`);

      const quiet = await h.tickAt(clockAt(12, 5));
      expect(quiet.result.eventsPromoted).toBe(0);
      expect(quiet.rankingsCalls).toEqual([undefined]);
      expect(quiet.result.districtsConsidered).toBe(1);
      expect(h.d1.eventCursors.get(districtRankingsCursorKey(DISTRICT_KEY))?.tba_etag).toBe("rank-etag-1");

      expect((await h.tickAt(clockAt(12, 6))).rankingsCalls).toEqual([]);

      const forced = await h.tickAt(clockAt(12, 15));
      expect(forced.rankingsCalls).toEqual([undefined]);
      expect(forced.districtReads).toBe(1);
    });

    it("an inferred window that ENDED an hour ago: unproven it costs exactly one D1 read and no request, proven its district is asked at 12:05 and forced at 12:15", async () => {
      for (const seedRow of [false, true]) {
        const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }], windows: [endedWindow(LIVE_EVENT, 60, clockAt(12, 5), { inferred: true })] });
        h.events.set(LIVE_EVENT, awardsOnlyRecord(WINNER_AND_FINALIST, "awards-etag-1"));
        if (seedRow) seedCursor(h.d1, LIVE_EVENT, "etag-1", null);
        for (const [hour, minute] of [[12, 5], [12, 15]] as const) {
          const callsBefore = h.d1.callCount;
          const report = await h.tickAt(clockAt(hour, minute));
          expect(h.fetchMock.mock.calls).toHaveLength(0);
          expect(h.d1.callCount - callsBefore).toBe(1);
          // The manifest read and the pass's one cursor read.
          expect(report.result.subrequestsUsed).toBe(2);
          expect(report.result).toMatchObject(NO_DISTRICT_WORK);
        }
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      }

      const proven = watchHarness({ events: [{ eventKey: LIVE_EVENT }], windows: [endedWindow(LIVE_EVENT, 60, clockAt(12, 5), { inferred: true })] });
      proven.events.set(LIVE_EVENT, awardsOnlyRecord(WINNER_AND_FINALIST, "awards-etag-1"));
      seedCursor(proven.d1, LIVE_EVENT, "etag-1", `${LIVE_EVENT}_qm2`);
      const quiet = await proven.tickAt(clockAt(12, 5));
      expect(quiet.rankingsCalls).toEqual([undefined]);
      expect(quiet.result.districtsConsidered).toBe(1);
      const forced = await proven.tickAt(clockAt(12, 15));
      expect(forced.rankingsCalls).toEqual([undefined]);
      expect(proven.d1.eventCursors.get(districtRankingsCursorKey(DISTRICT_KEY))?.tba_etag).toBe("rank-etag-1");
    });
  });

  describe("reach, suspension and never throwing, from a tick with nothing live", () => {
    function idleWatch(options: Partial<WatchHarnessOptions> = {}): Harness {
      const h = watchHarness({ events: [{ eventKey: LIVE_EVENT }], windows: [endedWindow(LIVE_EVENT, 10, clockAt(12, 5))], ...options });
      h.events.set(LIVE_EVENT, awardsOnlyRecord(WINNER_AND_FINALIST, "awards-etag-1"));
      return h;
    }

    it("suspended at 12:15 while the state baseline markers disagree with the manifest generation: no TBA request, no put, one warn", async () => {
      const h = idleWatch();
      seedStateBaselineMarkers(h.d1.eventCursors, PUBLISHED_ALGORITHM_IDS, "gen-not-seeded-yet");

      const report = await h.tickAt(clockAt(12, 15));

      expect(h.fetchMock.mock.calls).toHaveLength(0);
      expect(h.r2.putCallCount).toBe(0);
      expect(report.districtReads).toBe(0);
      expect(warnsNamed(h.warnSpy, "district-pass-suspended")).toHaveLength(1);
      expect(report.result).toMatchObject(NO_DISTRICT_WORK);
      expectNoSecretInWarns(h.warnSpy);
    });

    it("the algorithms manifest missing from R2 on that tick: runTick resolves, makes no TBA request and warns once", async () => {
      const h = idleWatch({ withoutAlgorithmsManifest: true });

      const report = await h.tickAt(clockAt(12, 15));

      expect(h.fetchMock.mock.calls).toHaveLength(0);
      expect(h.r2.putCallCount).toBe(0);
      expect(warnsNamed(h.warnSpy, "district-pass-suspended")).toHaveLength(1);
      expect(report.result).toMatchObject(NO_DISTRICT_WORK);
      expectNoSecretInWarns(h.warnSpy);
    });

    it("the pass's cursor read rejecting: runTick resolves, makes no TBA request, and the due district is counted failed", async () => {
      const h = idleWatch();
      h.d1.rejectCursorReadsForKeyPrefix = "__district_rankings__:";

      const report = await h.tickAt(clockAt(12, 5));

      expect(h.fetchMock.mock.calls).toHaveLength(0);
      expect(warnsNamed(h.warnSpy, "district-cursor-read-failed")).toHaveLength(1);
      expect(report.result).toMatchObject({ districtsConsidered: 1, districtsRefreshed: 0, districtsUnchanged: 0, districtsFailed: 1 });
      expectNoSecretInWarns(h.warnSpy);
    });

    it("counting: on a forced look with one waiting event, subrequestsUsed equals the R2 calls, D1 calls and TBA requests the fakes recorded", async () => {
      const h = idleWatch();

      const report = await h.tickAt(clockAt(12, 15));

      expect(report.awardsCalls).toHaveLength(1);
      const recorded = h.r2.getCallCount + h.r2.putCallCount + h.d1.callCount + h.fetchMock.mock.calls.length;
      expect(report.result.subrequestsUsed).toBe(recorded);
      expect(report.result.tbaRequests).toBe(h.fetchMock.mock.calls.length);
    });

    it("the bound: one district with ten watched events that all wait and ten catch up candidates spends at most 3 x 10 + 2 x 8 + 5 on a forced look, 55 with the tick's own four", async () => {
      const AT = clockAt(12, 15);
      const watchedKey = (index: number): string => `2026wev${String(index).padStart(2, "0")}`;
      const olderKey = (index: number): string => `2026old${String(index).padStart(2, "0")}`;
      const watched: WatchEvent[] = Array.from({ length: 10 }, (_, index) => ({ eventKey: watchedKey(index) }));
      const older: WatchEvent[] = Array.from({ length: 10 }, (_, index) => ({ eventKey: olderKey(index), week: 1 }));
      const h = watchHarness({ events: [...watched, ...older], windows: watched.map((event) => endedWindow(event.eventKey, 10, AT)) });
      for (const event of [...watched, ...older]) h.events.set(event.eventKey, awardsOnlyRecord(WINNER_AND_FINALIST, `${event.eventKey}-awards`));
      // The costliest row a watched event can have: its ETag matches (a
      // conditional 304, then the ask with no ETag) and it has no change time
      // (so the row is written).
      for (const event of watched) seedAwardsRow(h.d1, event.eventKey, `${event.eventKey}-awards`, null);

      const report = await h.tickAt(AT);

      expect(report.result.districtsFailed).toBe(0);
      expect(report.awardsAsked.filter((call) => call.eventKey.startsWith("2026wev"))).toHaveLength(20);
      expect(report.awardsAsked.filter((call) => call.eventKey.startsWith("2026old"))).toHaveLength(8);
      // 1 manifest read, 1 cursor read, 2 for the suspension check, and the district.
      expect(report.result.subrequestsUsed).toBeLessThanOrEqual(1 + 1 + 2 + (3 * 10 + 2 * 8 + 5));
      expect(report.result.subrequestsUsed).toBe(h.r2.getCallCount + h.r2.putCallCount + h.d1.callCount + h.fetchMock.mock.calls.length);
      expect(awardsWarns(h.warnSpy)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// THE AWARD STAGE REPLAY, on real data (quick task 261009-tx6, D4).
//
// Every district tier event of the committed 2026 PNW district artifact
// (`data/fixtures/phase10/district-2026pnw.json`) is rewound to the moment its
// playoffs ended, and its award stage is then replayed through the REAL
// `runTick` on the watch path: Winner and Finalist listed, the judged list,
// the award points, the hour of quiet, the settle.
//
// WHAT IS REAL: the 126 teams, every point of every row, who won which award
// at which event, and the order in which those facts reach TBA.
//
// WHAT IS SYNTHETIC: the counts inside the state blocks (the fixture carries
// no state block at all, so every row is given one that says "finished"), and
// the Winner and Finalist recipients, taken as the teams with the highest and
// the second highest playoff points at the event.
//
// WHY THE BASELINE IS BUILT HERE and not read from the file. The fixture has
// no state blocks, and its verdict fields were published before quick task
// 261007-il9 moved the district pass onto the district tier total (its cut
// line reads 82 where the pass now says 60). So the baseline is the fixture
// with a finished state block on every row, run through the verdict pass. Its
// `districtLock.status` equals the file's for all 126 teams, which is pinned
// first: the replay is measured against what was published.
//
// WHAT THE WALK GUARDS. Replayed with the ceilings as they were before this
// task, six published Locked verdicts were taken back over these eight events
// (`frc9430` on five of them, `2026orsal` among them, and `frc5920` on
// `2026orore`): a rival's award points landed on a ceiling that said they
// could not. With an award read only once its own event says it is given, and
// the ceilings and floors counting what is still open at a played event,
// there are none.
//
// SCOPE. This is the AWARD stage walk only. Every earlier category of the
// replayed event is already final at the first tick. The same gap one
// category earlier (qualification done, alliances picked, playoffs done, each
// while TBA's district rankings have not caught up with the match results) is
// the subject of quick task 261009-vp9, "a category counts as finished only
// when its points are in", and is not asserted here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Quick task 261009-vp9 (D6): the flag waits for every consuming award an
// event gives. A list that lacks one is read as "the event gave none" only
// after 12 unchanged hours. The Worker only MEASURES: it hands the merge the
// events whose list has stood for 60 minutes and for 12 hours.
// ---------------------------------------------------------------------------

describe("runTick — a list that lacks an award its event gives turns the flag true at 12 unchanged hours and not before (261009-vp9)", () => {
  const TWELVE_HOURS_IN_MINUTES = 12 * 60;

  /** Winner, Finalist and one judged award that records nothing. No Impact award. */
  function listWithoutImpact(eventKey: string): unknown[] {
    return [tbaAward(1, "District Event Winner", ["frc1"], eventKey), tbaAward(2, "District Event Finalist", ["frc2"], eventKey), tbaAward(29, "A judged award this pipeline carries no label for", ["frc1"], eventKey)];
  }

  // 12:15 UTC, a forced look: the rankings are asked with no ETag, so the
  // tick passes the gate with nothing new, and a waiting event is asked for
  // its list.
  it.each([
    { minutesOld: TWELVE_HOURS_IN_MINUTES - 1, expected: false, puts: 0, label: "11 hours 59 minutes old: the flag stays false and nothing is put" },
    { minutesOld: TWELVE_HOURS_IN_MINUTES, expected: true, puts: 1, label: "12 hours old: the flag turns true in one put" },
  ])("a watched district tier event at 12:15 UTC, a judged list with no Impact and its points, a row $label", async ({ minutesOld, expected, puts }) => {
    const AT = clockAt(12, 15);
    const h = watchHarness({ events: [{ eventKey: LIVE_EVENT, frc3Award: 10 }], windows: [endedWindow(LIVE_EVENT, 10, AT)] });
    h.events.set(LIVE_EVENT, awardsOnlyRecord(listWithoutImpact(LIVE_EVENT), "awards-no-impact"));
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-no-impact", minutesOld, AT);
    const seededRow = { ...awardsCursorRow(h.d1)! };

    const report = await h.tickAt(AT);

    expect(report.rankingsCalls).toEqual([undefined]);
    // The conditional ask answers 304, and the waiting event is then asked with no ETag.
    expect(report.awardsAsked).toEqual([
      { eventKey: LIVE_EVENT, ifNoneMatch: "awards-no-impact" },
      { eventKey: LIVE_EVENT, ifNoneMatch: undefined },
    ]);
    expect(report.written).toHaveLength(puts);
    expect(flagsFor(h.current())).toEqual([expected, expected]);
    // The list did not change, so the row and its clock stand.
    expect(awardsCursorRow(h.d1)).toEqual(seededRow);
    expect(report.result.districtsFailed).toBe(0);
    expect(awardsWarns(h.warnSpy)).toEqual([]);
  });

  it("the same list WITH its Impact award keeps the 60 minute rule: a row 60 minutes old turns the flag true at 12:15 UTC", async () => {
    const AT = clockAt(12, 15);
    const h = watchHarness({ events: [{ eventKey: LIVE_EVENT, frc3Award: 10 }], windows: [endedWindow(LIVE_EVENT, 10, AT)] });
    h.events.set(LIVE_EVENT, awardsOnlyRecord([...listWithoutImpact(LIVE_EVENT), tbaAward(0, "FIRST Impact Award", ["frc3"])], "awards-with-impact"));
    seedAwardsRow(h.d1, LIVE_EVENT, "awards-with-impact", 60, AT);

    const report = await h.tickAt(AT);

    expect(report.written).toHaveLength(1);
    expect(flagsFor(report.written[0]!)).toEqual([true, true]);
    expect(teamIn(report.written[0]!, "frc3").districtLock.status).toBe("lockedAward");
  });

  it("the catch up at 12:15 UTC (a forced look): an older event whose row is 12 hours old turns true, and one whose row is 11 hours 59 minutes old does not", async () => {
    const AT = clockAt(12, 15);
    const OLD_LONG = "2026old00";
    const OLD_SHORT = "2026old01";
    const awardsKey = (eventKey: string): string => `__event_awards__:${eventKey}`;
    // Two older events the watch no longer covers, each with its award points
    // in and a list that never gained its Impact award.
    const h = watchHarness({
      events: [{ eventKey: LIVE_EVENT }, { eventKey: OLD_LONG, week: 1, frc3Award: 10 }, { eventKey: OLD_SHORT, week: 1, frc3Award: 10 }],
      windows: [endedWindow(LIVE_EVENT, 10, AT)],
    });
    h.events.set(LIVE_EVENT, awardsOnlyRecord(WINNER_AND_FINALIST, "live-awards-1"));
    h.events.set(OLD_LONG, awardsOnlyRecord(listWithoutImpact(OLD_LONG), "old-long-a"));
    h.events.set(OLD_SHORT, awardsOnlyRecord(listWithoutImpact(OLD_SHORT), "old-short-a"));
    seedAwardsRow(h.d1, OLD_LONG, "old-long-a", TWELVE_HOURS_IN_MINUTES, AT);
    seedAwardsRow(h.d1, OLD_SHORT, "old-short-a", TWELVE_HOURS_IN_MINUTES - 1, AT);
    const longSeeded = { ...h.d1.eventCursors.get(awardsKey(OLD_LONG))! };
    const shortSeeded = { ...h.d1.eventCursors.get(awardsKey(OLD_SHORT))! };

    const forced = await h.tickAt(AT);

    // Each catch up event is asked once, with no ETag.
    expect(forced.awardsAsked.filter((call) => call.eventKey.startsWith("2026old"))).toEqual([
      { eventKey: OLD_LONG, ifNoneMatch: undefined },
      { eventKey: OLD_SHORT, ifNoneMatch: undefined },
    ]);
    expect(forced.written).toHaveLength(1);
    expect(flagsFor(forced.written[0]!, OLD_LONG)).toEqual([true, true]);
    expect(flagsFor(forced.written[0]!, OLD_SHORT)).toEqual([false, false]);
    // Both lists are the stored ones: the ETag and the change time stand, and
    // only the time of the ask moves.
    expect(h.d1.eventCursors.get(awardsKey(OLD_LONG))).toEqual({ ...longSeeded, last_polled_at: isoAt(AT) });
    expect(h.d1.eventCursors.get(awardsKey(OLD_SHORT))).toEqual({ ...shortSeeded, last_polled_at: isoAt(AT) });
    expect(forced.result.districtsFailed).toBe(0);
    expect(awardsWarns(h.warnSpy)).toEqual([]);
  });
});

describe("runTick — the award stage of every 2026 PNW district event, replayed through the watch (261009-tx6)", () => {
  type Artifact = ReturnType<typeof DistrictArtifactSchema.parse>;
  type ArtifactTeam = Artifact["teams"][number];

  const FIXTURE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "fixtures", "phase10", "district-2026pnw.json");
  const fixtureFile: Artifact = DistrictArtifactSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")));

  /** Synthetic counts, real meaning: the event is over and its awards are posted. */
  const FINISHED_STATE: StateBlock = { qualMatchesPlayed: 60, qualMatchesTotal: 60, alliancesPicked: true, playoffsDone: true, awardsPosted: true };

  /** The fixture with a finished state block on every row, at the verdict pass's fixed point. */
  const baseline: Artifact = recomputeDistrictVerdicts(
    DistrictArtifactSchema.parse({ ...fixtureFile, teams: fixtureFile.teams.map((team) => ({ ...team, eventPoints: team.eventPoints.map((row) => ({ ...row, state: { ...FINISHED_STATE } })) })) })
  );

  /** DERIVED, never typed in: every event key on a district tier `eventPoints` row of the fixture, sorted. */
  const districtEvents: string[] = [...new Set(fixtureFile.teams.flatMap((team) => team.eventPoints.filter((row) => row.tier === "district").map((row) => row.eventKey)))].sort();

  /** The baseline with one event's award stage undone: no award points, no posted flag, no winner record. */
  function rewound(eventKey: string): Artifact {
    return recomputeDistrictVerdicts(
      DistrictArtifactSchema.parse({
        ...baseline,
        teams: baseline.teams.map((team) => {
          const awardThere = team.eventPoints.filter((row) => row.eventKey === eventKey).reduce((sum, row) => sum + row.award, 0);
          return {
            ...team,
            pointTotal: team.pointTotal - awardThere,
            eventPoints: team.eventPoints.map((row) => (row.eventKey !== eventKey ? row : { ...row, award: 0, total: row.total - row.award, state: { ...FINISHED_STATE, awardsPosted: false } })),
            qualifyingAwards: team.qualifyingAwards.filter((entry) => entry.eventKey !== eventKey),
          };
        }),
      })
    );
  }

  /** Winner and Finalist as TBA lists them first: the teams with the highest, and the second highest, playoff points at the event. */
  function fieldAwards(eventKey: string): unknown[] {
    const elimByTeam = baseline.teams.flatMap((team) => team.eventPoints.filter((row) => row.eventKey === eventKey).map((row) => [team.teamKey, row.elim] as const));
    const levels = [...new Set(elimByTeam.map(([, elim]) => elim))].sort((a, b) => b - a);
    const teamsAt = (level: number | undefined): string[] => (level === undefined ? [] : elimByTeam.filter(([, elim]) => elim === level).map(([teamKey]) => teamKey));
    return [tbaAward(1, "District Event Winner", teamsAt(levels[0]), eventKey), tbaAward(2, "District Event Finalist", teamsAt(levels[1]), eventKey)];
  }

  /** The judged awards the fixture records at the event, as TBA would list them: one award per type, with every recipient. */
  function judgedAwards(eventKey: string): unknown[] {
    const recipientsByType = new Map<number, string[]>();
    for (const team of baseline.teams) {
      for (const entry of team.qualifyingAwards) {
        if (entry.eventKey !== eventKey) continue;
        recipientsByType.set(entry.awardType, [...(recipientsByType.get(entry.awardType) ?? []), team.teamKey]);
      }
    }
    return [...recipientsByType.entries()].sort((a, b) => a[0] - b[0]).map(([awardType, teamKeys]) => tbaAward(awardType, `award type ${String(awardType)}`, teamKeys, eventKey));
  }

  const entriesAt = (team: ArtifactTeam, eventKey: string) => team.qualifyingAwards.filter((entry) => entry.eventKey === eventKey).sort((a, b) => a.awardType - b.awardType);
  const districtLocksOf = (artifact: Artifact) => artifact.teams.map((team) => [team.teamKey, team.districtLock] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const districtHeld = (status: string): boolean => status === "locked" || status === "lockedAward";
  const champHeld = (status: string): boolean => status === "locked" || status === "lockedAward" || status === "prequalified";

  it("premise: the derived event list has eight entries, and the baseline's district status equals the published file's for all 126 teams", () => {
    expect(districtEvents).toHaveLength(8);
    expect(districtEvents).toContain("2026orsal");
    expect(districtEvents).toContain("2026orore");
    expect(baseline.teams).toHaveLength(126);
    const fileStatus = new Map(fixtureFile.teams.map((team) => [team.teamKey, team.districtLock.status] as const));
    for (const team of baseline.teams) expect({ teamKey: team.teamKey, status: team.districtLock.status }).toEqual({ teamKey: team.teamKey, status: fileStatus.get(team.teamKey) });
    // Every replayed event has a judged award to list and award points to land.
    for (const eventKey of districtEvents) {
      expect({ eventKey, judged: judgedAwards(eventKey).length > 0 }).toEqual({ eventKey, judged: true });
      expect({ eventKey, points: baseline.teams.some((team) => team.eventPoints.some((row) => row.eventKey === eventKey && row.award > 0)) }).toEqual({ eventKey, points: true });
    }
  });

  for (const eventKey of districtEvents) {
    it(`${eventKey}: the flag stays false until all three facts hold, no held place is lost at any tick, and the end state is the published one`, async () => {
      // One measured window that closed ten minutes before the first tick.
      // Nothing is live: this is the watch path, on the 5 minute cadence.
      const h = makeHarness({ artifact: rewound(eventKey), windows: [endedWindow(eventKey, 10, clockAt(12, 5))] });
      h.districts.set(DISTRICT_KEY, { rankings: rankingsOf(rewound(eventKey)), etag: "rank-before-awards" });
      h.events.set(eventKey, awardsOnlyRecord(fieldAwards(eventKey), "awards-field-only"));

      /** The district and champ status of every team after each tick, in tick order. */
      const walk: { tick: string; district: Map<string, string>; champ: Map<string, string> }[] = [];
      const tick = async (hour: number, minute: number): Promise<TickReport> => {
        const report = await h.tickAt(clockAt(hour, minute));
        const now = h.current();
        walk.push({
          tick: `${String(hour)}:${String(minute).padStart(2, "0")}`,
          district: new Map(now.teams.map((team) => [team.teamKey, team.districtLock.status] as const)),
          champ: new Map(now.teams.map((team) => [team.teamKey, team.champLock.status] as const)),
        });
        expect({ tick: walk[walk.length - 1]!.tick, failed: report.result.districtsFailed }).toEqual({ tick: walk[walk.length - 1]!.tick, failed: 0 });
        return report;
      };
      const flagsNow = (): boolean[] => flagsFor(h.current(), eventKey);
      const allFalse = (): boolean => flagsNow().length > 0 && flagsNow().every((flag) => !flag);

      // 12:05. TBA lists Winner and Finalist. The rankings say what the rows
      // already say. Nothing is recorded at this tier, and the flag is false.
      await tick(12, 5);
      expect(allFalse()).toBe(true);
      expect(h.current().teams.flatMap((team) => entriesAt(team, eventKey))).toEqual([]);
      const locksAtFieldAwards = districtLocksOf(h.current());

      // 12:10. The judged awards are listed. Every record is written at once,
      // the flag is false, and no verdict moves: a record is not read until
      // its own event says the award is given.
      h.events.set(eventKey, awardsOnlyRecord([...fieldAwards(eventKey), ...judgedAwards(eventKey)], "awards-judged"));
      const judged = await tick(12, 10);
      expect(judged.written).toHaveLength(1);
      expect(allFalse()).toBe(true);
      for (const team of h.current().teams) expect({ teamKey: team.teamKey, entries: entriesAt(team, eventKey) }).toEqual({ teamKey: team.teamKey, entries: entriesAt(baseline.teams.find((entry) => entry.teamKey === team.teamKey)!, eventKey) });
      expect(districtLocksOf(h.current())).toEqual(locksAtFieldAwards);
      const locksAtJudgedList = districtLocksOf(h.current());

      // 12:15, the forced look. Nothing is new.
      const forced = await tick(12, 15);
      expect(forced.rankingsCalls).toEqual([undefined]);
      expect(allFalse()).toBe(true);

      // 12:20. The rankings bring the award points. They are written, the flag
      // is false, and no verdict moves: a point landing in a category that is
      // still open is in no floor and inside every ceiling already.
      h.districts.set(DISTRICT_KEY, { rankings: rankingsOf(baseline), etag: "rank-with-award-points" });
      const points = await tick(12, 20);
      expect(points.written).toHaveLength(1);
      expect(allFalse()).toBe(true);
      for (const team of h.current().teams) {
        const published = baseline.teams.find((entry) => entry.teamKey === team.teamKey)!;
        expect({ teamKey: team.teamKey, pointTotal: team.pointTotal, award: team.eventPoints.find((row) => row.eventKey === eventKey)?.award }).toEqual({
          teamKey: team.teamKey,
          pointTotal: published.pointTotal,
          award: published.eventPoints.find((row) => row.eventKey === eventKey)?.award,
        });
      }
      expect(districtLocksOf(h.current())).toEqual(locksAtJudgedList);

      // 12:25 to 13:10, every five minutes: the hour of quiet. The list last
      // changed at 12:10, so 13:10 is the sixtieth minute, on a tick whose
      // polls all answer 304. The flag is false on every one of them.
      for (let minutesAfterNoon = 25; minutesAfterNoon <= 70; minutesAfterNoon += 5) {
        const quiet = await tick(12 + Math.floor(minutesAfterNoon / 60), minutesAfterNoon % 60);
        expect({ minutesAfterNoon, puts: quiet.written.length, allFalse: allFalse() }).toEqual({ minutesAfterNoon, puts: 0, allFalse: true });
      }

      // 13:15, the forced look, sixty five minutes after the list last
      // changed: all three facts hold. One put.
      const settled = await tick(13, 15);
      expect(settled.written).toHaveLength(1);
      expect(flagsNow().length).toBeGreaterThan(0);
      expect(flagsNow().every((flag) => flag)).toBe(true);

      // 13:20. Nothing is read from the district artifact and nothing is written.
      const after = await tick(13, 20);
      expect(after.districtReads).toBe(0);
      expect(after.written).toHaveLength(0);

      // THE END STATE IS THE PUBLISHED ONE.
      const final = h.current();
      const fileStatus = new Map(fixtureFile.teams.map((team) => [team.teamKey, team.districtLock.status] as const));
      expect(final.teams).toHaveLength(baseline.teams.length);
      for (const team of final.teams) {
        const published = baseline.teams.find((entry) => entry.teamKey === team.teamKey)!;
        expect({
          teamKey: team.teamKey,
          stateAtEvent: team.eventPoints.find((row) => row.eventKey === eventKey)?.state,
          entries: entriesAt(team, eventKey),
          districtLock: team.districtLock,
          status: team.districtLock.status,
          pointTotal: team.pointTotal,
          rank: team.rank,
          maxRemainingDistrict: team.maxRemainingDistrict,
          maxRemainingChamp: team.maxRemainingChamp,
        }).toEqual({
          teamKey: team.teamKey,
          stateAtEvent: published.eventPoints.find((row) => row.eventKey === eventKey)?.state,
          entries: entriesAt(published, eventKey),
          districtLock: published.districtLock,
          status: fileStatus.get(team.teamKey),
          pointTotal: published.pointTotal,
          rank: published.rank,
          maxRemainingDistrict: published.maxRemainingDistrict,
          maxRemainingChamp: published.maxRemainingChamp,
        });
      }
      expect(awardsWarns(h.warnSpy)).toEqual([]);

      // NO HELD PLACE IS LOST, at either tier: a team that reads Locked (on
      // points or by an award) after one tick reads Locked after every later
      // one. At the Championship tier a prequalified team counts as held.
      const lost: string[] = [];
      for (const team of baseline.teams) {
        let districtSince: string | undefined;
        let champSince: string | undefined;
        for (const step of walk) {
          const district = step.district.get(team.teamKey)!;
          const champ = step.champ.get(team.teamKey)!;
          if (districtSince !== undefined && !districtHeld(district)) lost.push(`${team.teamKey} district held at ${districtSince}, ${district} at ${step.tick}`);
          if (champSince !== undefined && !champHeld(champ)) lost.push(`${team.teamKey} champ held at ${champSince}, ${champ} at ${step.tick}`);
          if (districtSince === undefined && districtHeld(district)) districtSince = step.tick;
          if (champSince === undefined && champHeld(champ)) champSince = step.tick;
        }
      }
      expect({ eventKey, lost }).toEqual({ eventKey, lost: [] });

      // The two teams the old ceilings took a Locked back from, by name, on
      // the two events named for them: whatever each reads at 12:05, it never
      // loses a held place afterwards.
      const named = eventKey === "2026orsal" ? "frc9430" : eventKey === "2026orore" ? "frc5920" : undefined;
      if (named !== undefined) {
        const held = walk.map((step) => districtHeld(step.district.get(named)!));
        const firstHeld = held.indexOf(true);
        expect({ named, eventKey, heldToTheEnd: firstHeld === -1 || held.slice(firstHeld).every((value) => value) }).toEqual({ named, eventKey, heldToTheEnd: true });
        expect(walk[walk.length - 1]!.district.get(named)).toBe(fileStatus.get(named));
      }
    });
  }

  // -------------------------------------------------------------------------
  // Quick task 261009-vp9 (D6): a consuming award listed LATE.
  //
  // Before that task the flag turned true an hour after the list last
  // changed, whatever the list held. A list that sat for an hour WITHOUT its
  // Impact award therefore released the slot held for it, and the Impact
  // listed after that took a held place: frc5920 went from held to
  // eliminated at 2026wasam and 2026wasno, and at 2026pncmp a late Impact,
  // Engineering Inspiration or Rookie All Star took held places too. The
  // flag now waits for every consuming award the event gives.
  // -------------------------------------------------------------------------

  const PNCMP = "2026pncmp";

  /**
   * The awards TBA lists for an event, ONE ENTRY PER AWARD TYPE: every award
   * the fixture records there, a Winner where the fixture records none (a
   * district tier event), a Finalist, and one judged award with no district
   * recipient. `without` leaves one type out.
   */
  function awardsListOf(eventKey: string, without?: number): unknown[] {
    const typed = (entries: unknown[]) => entries as { award_type: number }[];
    const recorded = typed(judgedAwards(eventKey));
    const field = typed(fieldAwards(eventKey)).filter((entry) => !recorded.some((have) => have.award_type === entry.award_type));
    return [...recorded, ...field, ...typed([tbaAward(29, "a judged award with no district recipient", ["frc99999"], eventKey)])].filter((entry) => entry.award_type !== without);
  }

  /** The teams the fixture records an award of one type for at one event. */
  function recipientsOf(eventKey: string, awardType: number): string[] {
    return baseline.teams
      .filter((team) => team.qualifyingAwards.some((entry) => entry.eventKey === eventKey && entry.awardType === awardType))
      .map((team) => team.teamKey)
      .sort();
  }

  /** The rankings TBA serves before a late award: the published ones, with the late recipients' award points at the event still zero. */
  function rankingsBeforeLateAward(eventKey: string, lateRecipients: readonly string[]): unknown {
    const rows = rankingsOf(baseline) as { team_key: string; point_total: number; event_points: { event_key: string; award_points: number; total: number }[] }[];
    for (const row of rows) {
      if (!lateRecipients.includes(row.team_key)) continue;
      for (const entry of row.event_points) {
        if (entry.event_key !== eventKey) continue;
        row.point_total -= entry.award_points;
        entry.total -= entry.award_points;
        entry.award_points = 0;
      }
    }
    return rows;
  }

  const LATE_AWARD_VARIANTS: readonly { readonly eventKey: string; readonly lateType: number; readonly lateName: string }[] = [
    { eventKey: "2026wasam", lateType: 0, lateName: "Impact" },
    { eventKey: "2026wasno", lateType: 0, lateName: "Impact" },
    { eventKey: PNCMP, lateType: 0, lateName: "Impact" },
    { eventKey: PNCMP, lateType: 9, lateName: "Engineering Inspiration" },
    { eventKey: PNCMP, lateType: 10, lateName: "Rookie All Star" },
  ];

  it("premise of the late award variants: every one names an award the fixture records at that event, and the championship is a dcmp tier row", () => {
    for (const variant of LATE_AWARD_VARIANTS) expect({ ...variant, recipients: recipientsOf(variant.eventKey, variant.lateType).length > 0 }).toEqual({ ...variant, recipients: true });
    expect(new Set(baseline.teams.flatMap((team) => team.eventPoints.filter((row) => row.eventKey === PNCMP).map((row) => row.tier)))).toEqual(new Set(["dcmp"]));
    // Every award type appears once in a list.
    for (const eventKey of ["2026wasam", "2026wasno", PNCMP]) {
      const types = (awardsListOf(eventKey) as { award_type: number }[]).map((entry) => entry.award_type);
      expect({ eventKey, unique: new Set(types).size === types.length }).toEqual({ eventKey, unique: true });
    }
    expect((awardsListOf(PNCMP) as { award_type: number }[]).map((entry) => entry.award_type).sort((a, b) => a - b)).toEqual([0, 1, 2, 9, 10, 29]);
  });

  for (const { eventKey, lateType, lateName } of LATE_AWARD_VARIANTS) {
    it(`${eventKey}, a late ${lateName}: the flag is false until the first passing tick an hour after the late award is listed, its winner is recorded on the tick it is listed, and no held place is lost`, async () => {
      const lateRecipients = recipientsOf(eventKey, lateType);
      // One window that closed ten minutes before the first tick. Nothing is
      // live: the watch path, on the 5 minute cadence, forced on every
      // multiple of 15.
      const h = makeHarness({ artifact: rewound(eventKey), windows: [endedWindow(eventKey, 10, clockAt(12, 5))] });
      // The first list is every award of the fixture at the event but the
      // late one, and its points land with it.
      h.districts.set(DISTRICT_KEY, { rankings: rankingsBeforeLateAward(eventKey, lateRecipients), etag: "rank-first-list" });
      h.events.set(eventKey, awardsOnlyRecord(awardsListOf(eventKey, lateType), "awards-first-list"));

      const walk: { tick: string; district: Map<string, string>; champ: Map<string, string> }[] = [];
      /** Runs the tick at 12:00 UTC plus `minutes`. */
      const tick = async (minutes: number): Promise<TickReport> => {
        const report = await h.tickAt(clockAt(12, 0) + minutes * MINUTE_MS);
        const now = h.current();
        const label = `12:00 + ${String(minutes)} min`;
        walk.push({
          tick: label,
          district: new Map(now.teams.map((team) => [team.teamKey, team.districtLock.status] as const)),
          champ: new Map(now.teams.map((team) => [team.teamKey, team.champLock.status] as const)),
        });
        expect({ tick: label, failed: report.result.districtsFailed }).toEqual({ tick: label, failed: 0 });
        return report;
      };
      const flagsNow = (): boolean[] => flagsFor(h.current(), eventKey);
      const allFalse = (): boolean => flagsNow().length > 0 && flagsNow().every((flag) => !flag);
      const lateRecordedOn = (): string[] =>
        h
          .current()
          .teams.filter((team) => team.qualifyingAwards.some((entry) => entry.eventKey === eventKey && entry.awardType === lateType))
          .map((team) => team.teamKey)
          .sort();

      // 12:05. The first list and its points land in one tick.
      const first = await tick(5);
      expect(first.written).toHaveLength(1);
      expect(allFalse()).toBe(true);
      expect(lateRecordedOn()).toEqual([]);

      // 12:10 to 14:00, every five minutes: the list sits unchanged for two
      // hours. It lacks an award the event gives, so the flag is false on
      // every tick, the forced looks after the sixtieth minute included.
      for (let minutes = 10; minutes <= 120; minutes += 5) {
        await tick(minutes);
        expect({ minutes, allFalse: allFalse() }).toEqual({ minutes, allFalse: true });
      }

      // 14:05. The late award is listed, with its points. Its winner is
      // recorded on this tick, and the flag is still false.
      h.events.set(eventKey, awardsOnlyRecord(awardsListOf(eventKey), "awards-with-the-late-award"));
      h.districts.set(DISTRICT_KEY, { rankings: rankingsOf(baseline), etag: "rank-with-the-late-award" });
      const late = await tick(125);
      expect(late.written).toHaveLength(1);
      expect(lateRecordedOn()).toEqual(lateRecipients);
      expect(allFalse()).toBe(true);

      // 14:10 to 15:10. False on every tick: the forced look at 15:00 is 55
      // minutes after the list changed, and 15:05 and 15:10 are past the
      // hour but change nothing, so they do not pass the gate.
      for (let minutes = 130; minutes <= 190; minutes += 5) {
        const quiet = await tick(minutes);
        expect({ minutes, puts: quiet.written.length, allFalse: allFalse() }).toEqual({ minutes, puts: 0, allFalse: true });
      }

      // 15:15, the forced look, seventy minutes after the late award was
      // listed: the first tick that passes the gate after the hour. True.
      const settled = await tick(195);
      expect(settled.written).toHaveLength(1);
      expect(flagsNow().length).toBeGreaterThan(0);
      expect(flagsNow().every((flag) => flag)).toBe(true);

      // The end state's locks are the published ones.
      for (const team of h.current().teams) {
        const published = baseline.teams.find((entry) => entry.teamKey === team.teamKey)!;
        expect({ teamKey: team.teamKey, district: team.districtLock.status, champ: team.champLock.status }).toEqual({
          teamKey: team.teamKey,
          district: published.districtLock.status,
          champ: published.champLock.status,
        });
      }
      expect(awardsWarns(h.warnSpy)).toEqual([]);

      // NO HELD PLACE IS LOST at any tick, at either tier.
      const lost: string[] = [];
      for (const team of baseline.teams) {
        let districtSince: string | undefined;
        let champSince: string | undefined;
        for (const step of walk) {
          const district = step.district.get(team.teamKey)!;
          const champ = step.champ.get(team.teamKey)!;
          if (districtSince !== undefined && !districtHeld(district)) lost.push(`${team.teamKey} district held at ${districtSince}, ${district} at ${step.tick}`);
          if (champSince !== undefined && !champHeld(champ)) lost.push(`${team.teamKey} champ held at ${champSince}, ${champ} at ${step.tick}`);
          if (districtSince === undefined && districtHeld(district)) districtSince = step.tick;
          if (champSince === undefined && champHeld(champ)) champSince = step.tick;
        }
      }
      expect({ eventKey, lateName, lost }).toEqual({ eventKey, lateName, lost: [] });
    });
  }

  // A CHAMPIONSHIP THROUGH THE REAL TICK (CONTEXT D8). 2026pncmp is a dcmp
  // tier key equal to its championship stem, so the merge reads it as a
  // championship: it waits for Impact, Winner, Engineering Inspiration and
  // Rookie All Star. 12:15 UTC is a forced look.
  it.each([
    { without: 10, minutesOld: 12 * 60 - 1, expected: false, label: "no Rookie All Star, a row 11 hours 59 minutes old: false" },
    { without: 10, minutesOld: 12 * 60, expected: true, label: "no Rookie All Star, a row 12 hours old: true" },
    { without: undefined, minutesOld: 59, expected: false, label: "all four listed, a row 59 minutes old: false" },
    { without: undefined, minutesOld: 60, expected: true, label: "all four listed, a row 60 minutes old: true" },
  ])("2026pncmp through the real tick at 12:15 UTC, $label", async ({ without, minutesOld, expected }) => {
    const AT = clockAt(12, 15);
    const h = makeHarness({ artifact: rewound(PNCMP), windows: [endedWindow(PNCMP, 10, AT)] });
    h.districts.set(DISTRICT_KEY, { rankings: rankingsOf(baseline), etag: "rank-with-award-points" });
    h.events.set(PNCMP, awardsOnlyRecord(awardsListOf(PNCMP, without), "awards-championship"));
    seedAwardsRow(h.d1, PNCMP, "awards-championship", minutesOld, AT);

    const report = await h.tickAt(AT);

    expect(report.result.districtsFailed).toBe(0);
    expect(report.written).toHaveLength(1);
    const flags = flagsFor(report.written[0]!, PNCMP);
    expect(flags.length).toBeGreaterThan(0);
    expect({ everyFlag: flags.every((flag) => flag === expected) }).toEqual({ everyFlag: true });
    // Every award in the list is recorded whatever the flag says.
    for (const awardType of [0, 1, 9]) {
      expect({ awardType, recorded: report.written[0]!.teams.filter((team) => team.qualifyingAwards.some((entry) => entry.eventKey === PNCMP && entry.awardType === awardType)).map((team) => team.teamKey).sort() }).toEqual({
        awardType,
        recorded: recipientsOf(PNCMP, awardType),
      });
    }
    expect(awardsWarns(h.warnSpy)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — isolation, refusals, and the static import guard.
// ---------------------------------------------------------------------------

/** The FIRST district in sorted order, so a failure here is proved not to stop the one after it. */
const FAIL_DISTRICT = "2026aaa";
const FAIL_EVENT = "2026aaayak";
const FAIL_PLAYED_EVENT = "2026aaabon";

function failingDistrictArtifact(): unknown {
  const artifact = JSON.parse(JSON.stringify(districtArtifactFixture())) as {
    districtKey: string;
    abbreviation: string;
    displayName: string;
    teams: { eventPoints: { eventKey: string }[]; remainingEvents: { eventKey: string }[] }[];
  };
  artifact.districtKey = FAIL_DISTRICT;
  artifact.abbreviation = "aaa";
  artifact.displayName = "Alpha District";
  for (const team of artifact.teams) {
    for (const row of team.eventPoints) row.eventKey = FAIL_PLAYED_EVENT;
    for (const row of team.remainingEvents) row.eventKey = FAIL_EVENT;
  }
  return artifact;
}

function twoDistrictWindows(): WindowFixture[] {
  return [liveWindow({ eventKey: FAIL_EVENT, districtKey: FAIL_DISTRICT }), liveWindow()];
}

function twoDistrictEvents(): Map<string, TbaEventRecord> {
  return new Map([
    [FAIL_EVENT, alliancesPostedEventRecord(FAIL_EVENT, "fail-etag-1")],
    [LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")],
  ]);
}

interface FailureModeSetup {
  readonly name: string;
  /** `/district/{key}/rankings` payloads, keyed by district key. */
  readonly districts: Map<string, TbaDistrictRecord>;
  /** Forced non-2xx statuses, keyed by district key. */
  readonly statusOverride?: Map<string, number>;
  /** When false, the failing district's artifact is NOT seeded into R2. */
  readonly seedFailingArtifact?: boolean;
  readonly rejectPutsForKeyPrefix?: string;
}

const FAILURE_MODES: readonly FailureModeSetup[] = [
  {
    name: "a rankings poll that throws (a 500 from TBA)",
    districts: new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]),
    statusOverride: new Map([[FAIL_DISTRICT, 500]]),
  },
  {
    name: "a rankings body that fails DistrictRankingsPayloadSchema",
    districts: new Map([
      [FAIL_DISTRICT, { rankings: { notAnArray: true }, etag: "fail-rank-etag" }],
      [DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }],
    ]),
  },
  {
    name: "an EMPTY rankings array (the real DistrictMergeError)",
    districts: new Map([
      [FAIL_DISTRICT, { rankings: [], etag: "fail-rank-etag" }],
      [DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }],
    ]),
  },
  {
    name: "a missing district artifact in R2",
    districts: new Map([
      [FAIL_DISTRICT, { rankings: movedRankings(), etag: "fail-rank-etag" }],
      [DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }],
    ]),
    seedFailingArtifact: false,
  },
  {
    name: "a rejected R2 put",
    districts: new Map([
      [FAIL_DISTRICT, { rankings: movedRankings(), etag: "fail-rank-etag" }],
      [DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }],
    ]),
    rejectPutsForKeyPrefix: districtDetailKey(FAIL_DISTRICT),
  },
];

/** A console.warn spy, narrowed to just the shape the assertions read — `ReturnType<typeof vi.spyOn>` leaves `mock.calls` implicitly `any[]` under the Worker tsconfig. */
interface WarnSpy {
  readonly mock: { readonly calls: readonly (readonly unknown[])[] };
}

async function runTwoDistrictTick(mode: FailureModeSetup): Promise<{ result: Awaited<ReturnType<typeof runTick>>; d1: FakeD1Database; r2: FakeR2Bucket; fetchMock: ReturnType<typeof vi.fn>; warnSpy: WarnSpy }> {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const d1 = new FakeD1Database();
  const r2 = new FakeR2Bucket();
  if (mode.seedFailingArtifact !== false) r2.seed(districtDetailKey(FAIL_DISTRICT), JSON.stringify(failingDistrictArtifact()));
  r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
  if (mode.rejectPutsForKeyPrefix !== undefined) r2.rejectPutsForKeyPrefix = mode.rejectPutsForKeyPrefix;
  const env = makeEnv(makeManifests(twoDistrictWindows()), d1, r2);
  const fetchMock = makeTbaFetchStub(twoDistrictEvents(), mode.districts, mode.statusOverride ?? new Map());
  vi.stubGlobal("fetch", fetchMock);

  const result = await runTick(env, { nowMs: NOW_MS });
  return { result, d1, r2, fetchMock, warnSpy };
}

function warnLines(warnSpy: WarnSpy): string[] {
  return warnSpy.mock.calls.map((call) => String(call[0]));
}

describe("runDistrictRefresh — one bad district never stops the tick", () => {
  for (const mode of FAILURE_MODES) {
    it(`confines ${mode.name} to its own district, still refreshes the next one, and still writes the rotation cursor`, async () => {
      const { result, d1, r2 } = await runTwoDistrictTick(mode);

      // The surviving district got its own put.
      expect(r2.puts.filter((p) => p.key === districtDetailKey(DISTRICT_KEY))).toHaveLength(1);
      expect(result.districtsRefreshed).toBe(1);
      expect(result.districtsFailed).toBe(1);
      expect(result.districtsConsidered).toBe(2);
      // `runTick` RESOLVED — reaching this line at all is that assertion.
      expect(result.stateGenerationMismatch).toBe(false);
      // The rotation offset survived: the pass sits upstream of `writeTickMeta`
      // and can never cost the tick its place in the live-event list.
      expect(d1.eventCursors.get("__scheduler_meta__")).toBeDefined();
    });
  }

  it("never blanks a published district on an EMPTY rankings payload — zero puts for it", async () => {
    const { r2 } = await runTwoDistrictTick(FAILURE_MODES[2]!);

    expect(r2.puts.filter((p) => p.key === districtDetailKey(FAIL_DISTRICT))).toHaveLength(0);
  });

  it("never CREATES a district artifact: a missing one is warned with only the district key and the R2 key, and written from nothing", async () => {
    const { r2, warnSpy } = await runTwoDistrictTick(FAILURE_MODES[3]!);

    expect(r2.puts.filter((p) => p.key === districtDetailKey(FAIL_DISTRICT))).toHaveLength(0);

    const missing = warnLines(warnSpy).map((line) => JSON.parse(line) as Record<string, unknown>).find((entry) => entry["msg"] === "district-artifact-missing");
    expect(missing).toBeDefined();
    expect(Object.keys(missing!).sort()).toEqual(["districtKey", "key", "msg"]);
    expect(missing!["districtKey"]).toBe(FAIL_DISTRICT);
    expect(missing!["key"]).toBe(districtDetailKey(FAIL_DISTRICT));
  });

  it("emits no warn line containing the configured TBA key value or an auth/conditional header name, in ANY failure mode", async () => {
    for (const mode of FAILURE_MODES) {
      const { warnSpy } = await runTwoDistrictTick(mode);
      for (const line of warnLines(warnSpy)) {
        expect(line).not.toContain("test-key");
        expect(line).not.toContain("X-TBA-Auth-Key");
        expect(line).not.toContain("If-None-Match");
      }
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});

describe("runDistrictRefresh — the pre-republish manifest and the key guard", () => {
  it("does NOTHING for a live window whose districtKey is absent — the manifest shape R2 is actually in between deploy and republish", async () => {
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow({ districtKey: undefined })]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(env, { nowMs: NOW_MS });

    expect(tbaUrls(fetchMock).filter((u) => u.includes("/district/"))).toEqual([]);
    expect(r2.gets.filter((key) => key.startsWith("v1/district/"))).toEqual([]);
    expect(districtPuts(r2)).toHaveLength(0);
    expect(result).toMatchObject({ districtsConsidered: 0, districtsRefreshed: 0, districtsUnchanged: 0, districtsFailed: 0 });
  });

  it("does NOTHING for a live window whose districtKey is explicitly null", async () => {
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow({ districtKey: null })]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(env, { nowMs: NOW_MS });

    expect(tbaUrls(fetchMock).filter((u) => u.includes("/district/"))).toEqual([]);
    expect(r2.gets.filter((key) => key.startsWith("v1/district/"))).toEqual([]);
    expect(districtPuts(r2)).toHaveLength(0);
    expect(result.districtsConsidered).toBe(0);
  });

  it("skips a districtKey that does not match DISTRICT_KEY_PATTERN with a warn, counts it failed, and makes no request carrying it", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const env = makeEnv(makeManifests([liveWindow({ districtKey: "pnw2026" })]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")]]), new Map());
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(env, { nowMs: NOW_MS });

    expect(result.districtsFailed).toBe(1);
    expect(result.districtsConsidered).toBe(1);
    expect(tbaUrls(fetchMock).filter((u) => u.includes("pnw2026"))).toEqual([]);
    expect(warnLines(warnSpy).map((line) => JSON.parse(line) as Record<string, unknown>).some((entry) => entry["msg"] === "district-key-rejected" && entry["districtKey"] === "pnw2026")).toBe(true);
  });
});

describe("liveDistrictsOf", () => {
  function entry(eventKey: string, districtKey: string | null | undefined): LiveWindowEntry {
    return { eventKey, season: SEASON, startMs: 0, endMs: 1, inferred: false, ...(districtKey === undefined ? {} : { districtKey }) } as LiveWindowEntry;
  }

  it("collapses two events of one district into one entry carrying both windows", () => {
    const grouped = liveDistrictsOf([entry("2026wayak", DISTRICT_KEY), entry("2026wabon", DISTRICT_KEY)]);

    expect([...grouped.keys()]).toEqual([DISTRICT_KEY]);
    expect(grouped.get(DISTRICT_KEY)!.map((w) => w.eventKey)).toEqual(["2026wayak", "2026wabon"]);
  });

  it("orders two districts deterministically by key", () => {
    const grouped = liveDistrictsOf([entry("2026wayak", "2026pnw"), entry("2026ncwak", "2026fnc"), entry("2026misjo", "2026fim")]);

    expect([...grouped.keys()]).toEqual(["2026fim", "2026fnc", "2026pnw"]);
  });

  it("drops entries whose districtKey is null or absent", () => {
    const grouped = liveDistrictsOf([entry("2026casj", null), entry("2026cafr", undefined), entry("2026wayak", DISTRICT_KEY)]);

    expect([...grouped.keys()]).toEqual([DISTRICT_KEY]);
    expect(grouped.get(DISTRICT_KEY)!).toHaveLength(1);
  });
});

describe("the two new Worker modules are provably free of the corpus and the simulation", () => {
  /** `packages/harness/browserSafeSchemas.test.ts`'s own regex — this repo keeps one import statement per line. */
  const IMPORT_LINE_RE = /^\s*(?:import|export)\b.*\bfrom\s*["']([^"']+)["']/;
  const FORBIDDEN = ["packages/corpus", "better-sqlite3", "node:", "algorithms/simulation"];

  function importSpecifiers(relativePath: string): string[] {
    const filePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", relativePath);
    const specifiers: string[] = [];
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
      const match = IMPORT_LINE_RE.exec(line);
      if (match?.[1]) specifiers.push(match[1]);
    }
    return specifiers;
  }

  for (const file of ["districtRefresh.ts", "districtEventState.ts"]) {
    it(`${file} imports nothing matching the corpus, better-sqlite3, a node: built-in or the rank simulation`, () => {
      const specifiers = importSpecifiers(file);
      // NON-VACUITY: prove the scan actually read import lines, so a renamed
      // file or a broken regex cannot pass this test by finding nothing.
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        for (const forbidden of FORBIDDEN) {
          expect(specifier).not.toContain(forbidden);
        }
      }
    });
  }
});
