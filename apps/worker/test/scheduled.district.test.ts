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
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTick } from "../src/scheduled.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { districtDetailKey, DistrictArtifactSchema } from "../../../packages/harness/pageArtifacts.js";
import { districtRankingsCursorKey } from "../../../packages/harness/stateBaseline.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../packages/harness/publishedAlgorithms.js";
import { seedStateBaselineMarkers } from "./support/stateBaseline.js";
import type { Env } from "../src/env.js";
import type { D1Database } from "@cloudflare/workers-types";

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
    return { results: this.db.executeSelect(this.sql, this.boundArgs) as T[] };
  }
  async first<T = unknown>(): Promise<T | null> {
    const results = this.db.executeSelect(this.sql, this.boundArgs) as T[];
    return results.length > 0 ? results[0]! : null;
  }
  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const changes = this.db.executeWrite(this.sql, this.boundArgs);
    return { success: true, meta: { changes } };
  }
}

class FakeD1Database {
  batchCallCount = 0;
  algorithmState = new Map<string, FakeAlgorithmStateRow>();
  eventCursors = new Map<string, FakeEventCursorRow>();

  constructor() {
    seedStateBaselineMarkers(this.eventCursors, PUBLISHED_ALGORITHM_IDS, "gen-1");
  }

  prepare(sql: string): FakePreparedStatement {
    return new FakePreparedStatement(sql, this);
  }

  async batch(statements: readonly FakePreparedStatement[]): Promise<{ success: true }[]> {
    this.batchCallCount++;
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
      if (!record || record.awards === undefined) return { status: 404, ok: false, headers: new Map(), json: async () => ({}) };
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

    throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
  });
}

const NOW_MS = Date.parse("2026-08-22T12:00:00.000Z");
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

/**
 * The published district artifact the Worker reads back. `frc1` has played
 * `2026wabon` and still has `2026wayak` ahead of it; `frc2` has played only
 * `2026wabon`. Both teams' `districtLock.status` is deliberately WRONG
 * (`"contending"`) so a carried-over verdict fails loudly rather than passing
 * by accident.
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
    dcmpSlots: 1,
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
        eventPoints: [{ eventKey: PLAYED_EVENT, eventName: "Bonney Lake", week: 1, tier: "district", qual: 20, alliance: 10, elim: 5, award: 5, total: 40 }],
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
        eventPoints: [{ eventKey: PLAYED_EVENT, eventName: "Bonney Lake", week: 1, tier: "district", qual: 15, alliance: 8, elim: 2, award: 5, total: 30 }],
        remainingEvents: [],
        maxRemainingDistrict: 0,
        maxRemainingChamp: DCMP_EVENT_MAX,
        qualifyingAwards: [],
        districtLock: lockVerdict("contending"),
        champLock: lockVerdict("contending"),
      },
    ],
    insights: { teamCount: 2, eventCount: 2, dcmpCutLinePoints: 40, cmpCutLinePoints: 40, districtLockedCount: 0, districtEliminatedCount: 0, champLockedCount: 0, champEliminatedCount: 0 },
    ...overrides,
  };
}

function eventPointsEntry(eventKey: string, total: number, districtCmp = false) {
  return { event_key: eventKey, district_cmp: districtCmp, qual_points: total, alliance_points: 0, elim_points: 0, award_points: 0, total };
}

/** `frc1` has now played `2026wayak` for 50 more points; `frc2` is unchanged. */
function movedRankings(): unknown {
  return [
    { team_key: "frc1", rank: 1, point_total: 90, rookie_bonus: 0, adjustments: 0, event_points: [eventPointsEntry(PLAYED_EVENT, 40), eventPointsEntry(LIVE_EVENT, 50)] },
    { team_key: "frc2", rank: 2, point_total: 30, rookie_bonus: 0, adjustments: 0, event_points: [eventPointsEntry(PLAYED_EVENT, 30)] },
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
    //    points and nothing remaining, frc2 has 30 and nothing remaining, and
    //    there is one DCMP slot.
    expect(frc1.districtLock.status).toBe("locked");
    expect(written.teams.find((team) => team.teamKey === "frc2")!.districtLock.status).toBe("eliminated");
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

const ONE_AWARD = [{ name: "Regional Winner", award_type: 1, event_key: LIVE_EVENT, recipient_list: [{ team_key: "frc1", awardee: null }], year: SEASON }];

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

  it("writes state-only through applyDistrictEventState on a 304 rankings poll, leaving every point total, rank, verdict and insight byte-identical", async () => {
    const d1 = new FakeD1Database();
    seedCursor(d1, districtRankingsCursorKey(DISTRICT_KEY), "rank-etag-1", null);
    const r2 = new FakeR2Bucket();
    const seeded = districtArtifactFixture();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(seeded));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(env, { nowMs: NOW_MS });

    expect(result.districtsRefreshed).toBe(1);
    const puts = districtPuts(r2);
    expect(puts).toHaveLength(1);
    const written = DistrictArtifactSchema.parse(JSON.parse(puts[0]!.body));
    const seededParsed = DistrictArtifactSchema.parse(seeded);

    expect(JSON.stringify(written.insights)).toBe(JSON.stringify(seededParsed.insights));
    for (const team of written.teams) {
      const before = seededParsed.teams.find((t) => t.teamKey === team.teamKey)!;
      expect(team.pointTotal).toBe(before.pointTotal);
      expect(team.rank).toBe(before.rank);
      expect(JSON.stringify(team.districtLock)).toBe(JSON.stringify(before.districtLock));
      expect(JSON.stringify(team.champLock)).toBe(JSON.stringify(before.champLock));
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
      r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactWithState(steady)));
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
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1")]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]])));

    const result = await runTick(env, { nowMs: NOW_MS });

    expect(r2.gets.filter((key) => key.startsWith("v1/district/"))).toEqual([]);
    expect(districtPuts(r2)).toHaveLength(0);
    expect(result.districtsUnchanged).toBe(1);
  });
});

describe("runTick — the awards fetch", () => {
  it("requests /awards exactly once, only after playoffsDone, and a non-empty response sets awardsPosted true", async () => {
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: ONE_AWARD })]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    await runTick(env, { nowMs: NOW_MS });

    expect(awardsRequests(fetchMock)).toHaveLength(1);
    expect(writtenLiveEventState(r2)).toEqual({ qualMatchesPlayed: 2, qualMatchesTotal: 2, alliancesPicked: true, playoffsDone: true, awardsPosted: true });
  });

  it("makes NO awards request at all while the playoffs are not done", async () => {
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, alliancesPostedEventRecord(LIVE_EVENT, "etag-1", { awards: ONE_AWARD })]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    await runTick(env, { nowMs: NOW_MS });

    expect(awardsRequests(fetchMock)).toHaveLength(0);
    expect(writtenLiveEventState(r2)?.awardsPosted).toBe(false);
  });

  it("leaves awardsPosted false on an EMPTY awards array", async () => {
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: [] })]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    await runTick(env, { nowMs: NOW_MS });

    expect(awardsRequests(fetchMock)).toHaveLength(1);
    expect(writtenLiveEventState(r2)?.awardsPosted).toBe(false);
  });

  it("leaves awardsPosted false on a 304 awards response — unchanged since the last time it was seen empty", async () => {
    const d1 = new FakeD1Database();
    seedCursor(d1, `__event_awards__:${LIVE_EVENT}`, "awards-etag-1", null);
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactFixture()));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: ONE_AWARD, awardsEtag: "awards-etag-1" })]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    await runTick(env, { nowMs: NOW_MS });

    expect(awardsRequests(fetchMock)).toHaveLength(1);
    expect(writtenLiveEventState(r2)?.awardsPosted).toBe(false);
  });

  it("issues NO awards request for an event whose published state already says awardsPosted true — awards do not un-post", async () => {
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactWithState(stateBlock({ playoffsDone: true, awardsPosted: true }))));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: ONE_AWARD })]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    await runTick(env, { nowMs: NOW_MS });

    expect(awardsRequests(fetchMock)).toHaveLength(0);
    expect(writtenLiveEventState(r2)?.awardsPosted).toBe(true);
  });

  it("still issues the awards request when THIS tick's match poll was a 304 but the PUBLISHED state says playoffs done and awards not posted", async () => {
    const d1 = new FakeD1Database();
    seedCursor(d1, LIVE_EVENT, "etag-1", `${LIVE_EVENT}_f1m1`);
    const r2 = new FakeR2Bucket();
    r2.seed(districtDetailKey(DISTRICT_KEY), JSON.stringify(districtArtifactWithState(stateBlock({ playoffsDone: true, awardsPosted: false }))));
    const env = makeEnv(makeManifests([liveWindow()]), d1, r2);
    const fetchMock = makeTbaFetchStub(new Map([[LIVE_EVENT, finishedEventRecord(LIVE_EVENT, "etag-1", { awards: ONE_AWARD })]]), new Map([[DISTRICT_KEY, { rankings: movedRankings(), etag: "rank-etag-1" }]]));
    vi.stubGlobal("fetch", fetchMock);

    await runTick(env, { nowMs: NOW_MS });

    expect(awardsRequests(fetchMock)).toHaveLength(1);
    expect(writtenLiveEventState(r2)?.awardsPosted).toBe(true);
  });
});
