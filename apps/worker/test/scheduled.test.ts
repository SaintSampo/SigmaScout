/**
 * Drives `runTick` with injected fakes for D1/R2/KV and a stubbed `fetch` —
 * no network, no wrangler. Covers this plan's Task 3 acceptance criteria:
 * the nothing-live early exit, state-before-artifact ordering, idempotent
 * repeats, overlapping-invocation folding, per-event error confinement
 * (rejecting write / throwing poll), the no-starvation budget property, and
 * the global-rebuild triggers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTick } from "../src/scheduled.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { artifactKey, decodeTeamsRowMetrics } from "../../../packages/harness/pageArtifacts.js";
// `runTick` builds every artifact key from the LIVE algorithm module's
// `version` (see scheduled.ts's `info.algorithm.version`), never from the
// algorithms manifest below — so these expectations must track the module too.
// They were pinned to a "3.1.0+baseline" literal and went red on D-Q4's
// 3.1.0 -> 4.0.0 bump; deriving them removes that standing trip-wire.
import { opr } from "../../../packages/core/algorithms/opr.js";
import type { Env } from "../src/env.js";
import type { D1Database } from "@cloudflare/workers-types";

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

type SharedLogEntry = { readonly type: "d1-batch" } | { readonly type: "r2-put"; readonly key: string };

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
  rejectNextBatchWith: Error | null = null;

  constructor(private readonly sharedLog: SharedLogEntry[] = []) {}

  prepare(sql: string): FakePreparedStatement {
    return new FakePreparedStatement(sql, this);
  }

  async batch(statements: readonly FakePreparedStatement[]): Promise<{ success: true }[]> {
    this.batchCallCount++;
    if (this.rejectNextBatchWith) {
      const err = this.rejectNextBatchWith;
      this.rejectNextBatchWith = null;
      throw err;
    }
    for (const stmt of statements) this.executeWrite(stmt.sql, stmt.boundArgs);
    this.sharedLog.push({ type: "d1-batch" });
    return statements.map(() => ({ success: true as const }));
  }

  executeSelect(sql: string, args: readonly unknown[]): unknown[] {
    if (sql.includes("FROM algorithm_state")) {
      const algorithmId = args[0] as string;
      // Plan 04-08: a request may name more than one scope kind in one query
      // (e.g. OPR's event key + team keys). Each
      // `(scope_kind = ? AND scope_key IN (?,?,...))` group in the SQL text
      // names its own placeholder count, in the SAME order the real query
      // binds its args -- walking the SQL text is what lets this fake
      // support an arbitrary number of selections without hardcoding shape.
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
      const eventKey = args[0] as string;
      const row = this.eventCursors.get(eventKey);
      return row ? [row] : [];
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
    // The CAS claim (scheduled.ts's claimEventAdvance): conditional UPDATE,
    // matches only if the row's current last_folded_match_key still equals
    // the value the caller expected when it read the cursor.
    if (sql.includes("UPDATE event_cursor") && sql.includes("WHERE event_key")) {
      const [tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt, eventKey, expectedPrior] = args as (string | null)[];
      const existing = this.eventCursors.get(eventKey!);
      const currentPrior = existing ? existing.last_folded_match_key : null;
      if (!existing || currentPrior !== (expectedPrior ?? null)) return 0;
      this.eventCursors.set(eventKey!, {
        event_key: eventKey!,
        tba_etag: tbaEtag ?? null,
        last_folded_match_key: lastFoldedMatchKey ?? null,
        last_polled_at: lastPolledAt ?? null,
        last_advanced_at: lastAdvancedAt ?? null,
      });
      return 1;
    }
    // claimEventAdvance's INSERT-if-absent fallback (the row didn't exist
    // yet at all, distinct from "a row exists but the CAS condition failed").
    if (sql.includes("INSERT INTO event_cursor") && sql.includes("WHERE NOT EXISTS")) {
      const [eventKey, tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt] = args as (string | null)[];
      if (this.eventCursors.has(eventKey as string)) return 0;
      this.eventCursors.set(eventKey as string, {
        event_key: eventKey as string,
        tba_etag: tbaEtag ?? null,
        last_folded_match_key: lastFoldedMatchKey ?? null,
        last_polled_at: lastPolledAt ?? null,
        last_advanced_at: lastAdvancedAt ?? null,
      });
      return 1;
    }
    if (sql.includes("INSERT INTO event_cursor")) {
      const [eventKey, tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt] = args as (string | null)[];
      this.eventCursors.set(eventKey!, {
        event_key: eventKey!,
        tba_etag: tbaEtag ?? null,
        last_folded_match_key: lastFoldedMatchKey ?? null,
        last_polled_at: lastPolledAt ?? null,
        last_advanced_at: lastAdvancedAt ?? null,
      });
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
  putCallCount = 0;
  puts: { key: string; body: string }[] = [];
  private readonly store = new Map<string, string>();

  constructor(private readonly sharedLog: SharedLogEntry[] = []) {}

  async put(key: string, body: string): Promise<void> {
    this.putCallCount++;
    this.puts.push({ key, body });
    this.store.set(key, body);
    this.sharedLog.push({ type: "r2-put", key });
  }

  async get(key: string): Promise<FakeR2Object | null> {
    const value = this.store.get(key);
    return value === undefined ? null : new FakeR2Object(value);
  }
}

class FakeKvNamespace {
  getCallCount = 0;
  constructor(private readonly values: Map<string, string>) {}
  async get(key: string): Promise<string | null> {
    this.getCallCount++;
    return this.values.get(key) ?? null;
  }
}

// Quick task 260822-wqt: every `makeKv` call site in this file uses the
// default OPR-ONLY manifest, so `LIVE_ALGORITHM_IDS: "opr"` keeps every
// existing assertion in this file exercising exactly what it exercised
// before the live-tier filter existed — without it the filter yields an
// empty tier and every test in this file throws (EmptyLiveAlgorithmTierError).
function makeEnv(kv: FakeKvNamespace, d1: FakeD1Database, r2: FakeR2Bucket): Env {
  return { DB: d1 as unknown as D1Database, ARTIFACTS: r2 as unknown, MANIFEST: kv as unknown, TBA_API_KEY: "test-key", LIVE_ALGORITHM_IDS: "opr" } as Env;
}

// ---------------------------------------------------------------------------
// Manifest / TBA fixtures
// ---------------------------------------------------------------------------

interface WindowFixture {
  eventKey: string;
  season: number;
  startMs: number;
  endMs: number;
}

function liveWindowsManifest(windows: readonly WindowFixture[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-22T00:00:00.000Z",
    windows: windows.map((w) => ({ ...w, inferred: false })),
  });
}

function algorithmsManifest(ids: readonly string[] = ["opr"]): string {
  const algorithms = ids.map((id) => {
    if (id === "opr") return { id: "opr", version: "3.1.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" };
    if (id === "epa") return { id: "epa", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" };
    return { id: "vpr", version: "2.0.0+test", codeVersion: "2.0.0", paramSetName: "test" };
  });
  return JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", algorithms });
}

interface TbaMatchFixture {
  key: string;
  eventKey: string;
  matchNumber: number;
  redTeams: readonly string[];
  blueTeams: readonly string[];
  redScore?: number | null;
  blueScore?: number | null;
  actualTimeSec?: number;
  predictedTimeSec?: number;
}

function tbaMatch(f: TbaMatchFixture): unknown {
  const played = f.redScore != null && f.blueScore != null;
  return {
    key: f.key,
    event_key: f.eventKey,
    comp_level: "qm",
    set_number: 1,
    match_number: f.matchNumber,
    time: null,
    predicted_time: f.predictedTimeSec ?? null,
    actual_time: f.actualTimeSec ?? null,
    winning_alliance: played ? (f.redScore! > f.blueScore! ? "red" : f.blueScore! > f.redScore! ? "blue" : "") : "",
    alliances: {
      red: { team_keys: f.redTeams, surrogate_team_keys: [], dq_team_keys: [], score: f.redScore ?? null },
      blue: { team_keys: f.blueTeams, surrogate_team_keys: [], dq_team_keys: [], score: f.blueScore ?? null },
    },
    score_breakdown: null,
  };
}

interface TbaEventRecord {
  matches: unknown[];
  etag: string;
  eventType: number;
  season: number;
}

function makeTbaFetchStub(events: Map<string, TbaEventRecord>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    const ifNoneMatch = init?.headers?.["If-None-Match"];

    const matchesMatch = /\/event\/([^/]+)\/matches$/.exec(u);
    if (matchesMatch) {
      const eventKey = matchesMatch[1]!;
      const record = events.get(eventKey);
      if (!record) return { status: 404, ok: false, headers: new Map(), json: async () => ({}) };
      if (ifNoneMatch && ifNoneMatch === record.etag) {
        return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
      }
      return { status: 200, ok: true, headers: { get: (name: string) => (name === "etag" ? record.etag : null) }, json: async () => record.matches };
    }

    const detailMatch = /\/event\/([^/]+)$/.exec(u);
    if (detailMatch) {
      const eventKey = detailMatch[1]!;
      const record = events.get(eventKey);
      if (!record) return { status: 404, ok: false, headers: new Map(), json: async () => ({}) };
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ key: eventKey, year: record.season, event_type: record.eventType, start_date: "2026-08-01" }) };
    }

    throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
  });
}

const NOW_MS = Date.parse("2026-08-22T12:00:00.000Z");
const SEASON = 2026;

const RED_TEAMS = ["frc1", "frc2", "frc3"];
const BLUE_TEAMS = ["frc4", "frc5", "frc6"];
const ALL_TEAMS = [...RED_TEAMS, ...BLUE_TEAMS];

/** One played match plus one unplayed "upcoming" match at a DIFFERENT pair of teams — keeps `eventComplete` false (disables the event-boundary global-rebuild trigger) without perturbing `touchedTeams` (derived only from newly-folded matches). */
function twoMatchEventRecord(eventKey: string, etag: string): TbaEventRecord {
  return {
    etag,
    eventType: 0, // Regional — RP-eligible tier, though this plan's opr-only manifests never model RP
    season: SEASON,
    matches: [
      tbaMatch({ key: `${eventKey}_qm1`, eventKey, matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 }),
      tbaMatch({ key: `${eventKey}_qm2`, eventKey, matchNumber: 2, redTeams: ["frc7", "frc8", "frc9"], blueTeams: ["frc10", "frc11", "frc12"], predictedTimeSec: Math.floor(NOW_MS / 1000) + 3600 }),
    ],
  };
}

function makeKv(windows: readonly WindowFixture[], algorithmIds: readonly string[] = ["opr"]): FakeKvNamespace {
  return new FakeKvNamespace(
    new Map([
      [LIVE_WINDOWS_MANIFEST_KEY, liveWindowsManifest(windows)],
      [ALGORITHMS_MANIFEST_KEY, algorithmsManifest(algorithmIds)],
    ])
  );
}

const DISABLE_GLOBAL_REBUILD = { globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER };

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runTick — nothing live", () => {
  it("performs exactly one manifest read, zero TBA requests, zero puts, and reports zero events", async () => {
    const kv = makeKv([]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS });

    expect(kv.getCallCount).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r2.putCallCount).toBe(0);
    expect(result).toMatchObject({ eventsConsidered: 0, eventsAdvanced: 0, eventsDeferred: 0, eventsFailed: 0, tbaRequests: 0, globalRebuildRan: false });
  });
});

describe("runTick — one live event, one new match", () => {
  it("writes state before any artifact put, one event put and one team put per touched team", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const sharedLog: SharedLogEntry[] = [];
    const d1 = new FakeD1Database(sharedLog);
    const r2 = new FakeR2Bucket(sharedLog);
    const tbaEvents = new Map([["2026casj", twoMatchEventRecord("2026casj", "etag-1")]]);
    vi.stubGlobal("fetch", makeTbaFetchStub(tbaEvents));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);
    expect(result.eventsDeferred).toBe(0);
    expect(d1.batchCallCount).toBe(1); // one algorithm (opr) -> one batched state write
    expect(r2.putCallCount).toBe(1 + ALL_TEAMS.length); // one event artifact + one per touched team

    const eventPutKey = artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === eventPutKey)).toBe(true);
    for (const teamKey of ALL_TEAMS) {
      const teamPutKey = artifactKey({ page: "team", teamKey, year: SEASON, algorithmId: "opr", version: opr.version });
      expect(r2.puts.some((p) => p.key === teamPutKey)).toBe(true);
    }

    // Plan 04-08 (Task 2): OPR's lastEventByTeam bookkeeping now lives in its
    // OWN team-scoped rows (moved out of the league row), and the ONE batched
    // state write for this event includes them alongside the event row —
    // proof the tick reads/folds/writes both scope kinds together, in the
    // same single-statement read and the same single batched write.
    for (const teamKey of RED_TEAMS) {
      const row = d1.algorithmState.get(`opr::team::${teamKey}`);
      expect(row).toBeDefined();
      expect(JSON.parse(row!.state_json)).toEqual({ lastEventKey: "2026casj" });
    }
    expect(d1.algorithmState.get("opr::event::2026casj")).toBeDefined();

    // Ordering: the state write (d1-batch) for this event precedes EVERY
    // artifact put (r2-put) for it.
    const lastD1Index = sharedLog.reduce((acc, entry, i) => (entry.type === "d1-batch" ? i : acc), -1);
    const firstR2Index = sharedLog.findIndex((entry) => entry.type === "r2-put");
    expect(lastD1Index).toBeGreaterThanOrEqual(0);
    expect(firstR2Index).toBeGreaterThan(lastD1Index);
  });
});

describe("runTick — idempotency", () => {
  it("a second identical tick against an unchanged TBA payload performs zero further state writes and zero further puts", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 7_200_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const tbaEvents = new Map([["2026casj", twoMatchEventRecord("2026casj", "etag-1")]]);
    vi.stubGlobal("fetch", makeTbaFetchStub(tbaEvents));

    await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    const batchesAfterFirst = d1.batchCallCount;
    const putsAfterFirst = r2.putCallCount;
    expect(batchesAfterFirst).toBeGreaterThan(0);
    expect(putsAfterFirst).toBeGreaterThan(0);

    const result2 = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS + 60_000, ...DISABLE_GLOBAL_REBUILD });

    expect(d1.batchCallCount).toBe(batchesAfterFirst);
    expect(r2.putCallCount).toBe(putsAfterFirst);
    expect(result2.eventsAdvanced).toBe(0);
  });
});

describe("runTick — overlapping invocations", () => {
  it("folds a match exactly once even when two runTick calls race against the same fakes", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };

    // Baseline: a single, non-overlapping tick's resulting state.
    const baselineKv = makeKv([window]);
    const baselineD1 = new FakeD1Database();
    const baselineR2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026casj", twoMatchEventRecord("2026casj", "etag-1")]])));
    await runTick(makeEnv(baselineKv, baselineD1, baselineR2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    const baselineStateJson = baselineD1.algorithmState.get("opr::event::2026casj")?.state_json;
    expect(baselineStateJson).toBeDefined();
    vi.unstubAllGlobals();

    // Overlapping: two runTick calls started against the SAME fakes.
    const raceKv = makeKv([window]);
    const raceD1 = new FakeD1Database();
    const raceR2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026casj", twoMatchEventRecord("2026casj", "etag-1")]])));
    const env = makeEnv(raceKv, raceD1, raceR2);
    await Promise.all([runTick(env, { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD }), runTick(env, { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD })]);

    const raceStateJson = raceD1.algorithmState.get("opr::event::2026casj")?.state_json;
    expect(raceStateJson).toBe(baselineStateJson); // folded exactly once, not twice
  });
});

describe("runTick — per-event error confinement", () => {
  it("a rejecting state write for one event yields zero artifact puts for it, while the other live event still completes", async () => {
    const windowA: WindowFixture = { eventKey: "2026aaaa", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const windowB: WindowFixture = { eventKey: "2026bbbb", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([windowA, windowB]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const tbaEvents = new Map([
      ["2026aaaa", twoMatchEventRecord("2026aaaa", "etag-a")],
      ["2026bbbb", twoMatchEventRecord("2026bbbb", "etag-b")],
    ]);
    vi.stubGlobal("fetch", makeTbaFetchStub(tbaEvents));
    d1.rejectNextBatchWith = new Error("simulated D1 batch failure"); // consumed by the FIRST batch() call (event A, rotation offset 0)

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsFailed).toBe(1);
    expect(result.eventsAdvanced).toBe(1);
    expect(r2.puts.some((p) => p.key.includes("2026aaaa"))).toBe(false);
    expect(r2.puts.some((p) => p.key.includes("2026bbbb"))).toBe(true);
  });

  it("a throwing TBA poll for one event is recorded as failed, and the other live event still completes", async () => {
    const windowA: WindowFixture = { eventKey: "2026aaaa", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const windowB: WindowFixture = { eventKey: "2026bbbb", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([windowA, windowB]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();

    const fetchMock = vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
      const u = String(url);
      if (u.includes("/event/2026aaaa/matches")) {
        return { status: 500, ok: false, headers: new Map(), json: async () => ({}) };
      }
      const stub = makeTbaFetchStub(new Map([["2026bbbb", twoMatchEventRecord("2026bbbb", "etag-b")]]));
      const stubFn = stub as unknown as (url: unknown, init?: { headers?: Record<string, string> }) => Promise<unknown>;
      return stubFn(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsFailed).toBe(1);
    expect(result.eventsAdvanced).toBe(1);
  });
});

describe("runTick — no-starvation under a restrictive budget", () => {
  it("the union of two ticks (with the rotation offset advanced) covers every live event", async () => {
    const windowA: WindowFixture = { eventKey: "2026aaaa", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const windowB: WindowFixture = { eventKey: "2026bbbb", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([windowA, windowB]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const tbaEvents = new Map([
      ["2026aaaa", twoMatchEventRecord("2026aaaa", "etag-a")],
      ["2026bbbb", twoMatchEventRecord("2026bbbb", "etag-b")],
    ]);
    vi.stubGlobal("fetch", makeTbaFetchStub(tbaEvents));

    // usableCap = 27 - 2 = 25: enough for the tick's own fixed cost (2
    // manifest reads + 1 tick-meta read = 3) plus ONE fully-processed event
    // (2 sunk [cursor + poll] + 18 estimated [claim + event-detail + phase A
    // (read+write) + phase B (event put + 6 team puts, each preceded by a
    // read)] = 20; 3+20=23 <= 25) but not two (3+40=43 > 25) -- the second
    // event in each tick defers cheaply.
    const budgetDeps = { subrequestCap: 27, subrequestReserve: 2, ...DISABLE_GLOBAL_REBUILD };

    const tick1 = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...budgetDeps });
    expect(tick1.eventsAdvanced).toBe(1);
    expect(tick1.eventsDeferred).toBeGreaterThanOrEqual(1);

    const tick2 = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS + 60_000, ...budgetDeps });

    const advancedThisTickOrPrior = tick1.eventsAdvanced + tick2.eventsAdvanced;
    expect(advancedThisTickOrPrior).toBeGreaterThanOrEqual(2); // both events advanced across the two-tick union

    const eventAPut = r2.puts.some((p) => p.key.includes("2026aaaa") && p.key.startsWith("v1/event/"));
    const eventBPut = r2.puts.some((p) => p.key.includes("2026bbbb") && p.key.startsWith("v1/event/"));
    expect(eventAPut).toBe(true);
    expect(eventBPut).toBe(true);
  });
});

describe("runTick — algorithm module construction (Pitfall 4)", () => {
  it("constructs the algorithm modules exactly once per tick, not once per event", async () => {
    const windowA: WindowFixture = { eventKey: "2026aaaa", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const windowB: WindowFixture = { eventKey: "2026bbbb", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([windowA, windowB]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    // Both events are already fully folded (pre-seeded cursor with a
    // matching etag) so processing stays cheap -- 304 "not-modified" for
    // both -- while still exercising the "2 live events, 1 tick" shape the
    // construction-counter assertion needs.
    d1.eventCursors.set("2026aaaa", { event_key: "2026aaaa", tba_etag: "etag-a", last_folded_match_key: "2026aaaa_qm1", last_polled_at: null, last_advanced_at: null });
    d1.eventCursors.set("2026bbbb", { event_key: "2026bbbb", tba_etag: "etag-b", last_folded_match_key: "2026bbbb_qm1", last_polled_at: null, last_advanced_at: null });
    const tbaEvents = new Map([
      ["2026aaaa", twoMatchEventRecord("2026aaaa", "etag-a")],
      ["2026bbbb", twoMatchEventRecord("2026bbbb", "etag-b")],
    ]);
    vi.stubGlobal("fetch", makeTbaFetchStub(tbaEvents));

    let constructionCount = 0;
    const { buildAlgorithmModules: realBuildAlgorithmModules } = await import("../src/scheduled.js");
    // Quick task 260822-wqt: `buildAlgorithmModules` gained a required second
    // parameter (the live tier) — passed through unchanged here since this
    // test's own concern is call COUNT, not filtering behavior.
    const countingBuilder = (manifest: Parameters<typeof realBuildAlgorithmModules>[0], liveAlgorithmIds: Parameters<typeof realBuildAlgorithmModules>[1]) => {
      constructionCount++;
      return realBuildAlgorithmModules(manifest, liveAlgorithmIds);
    };

    await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, buildAlgorithmModules: countingBuilder, ...DISABLE_GLOBAL_REBUILD });

    expect(constructionCount).toBe(1);
  });
});

describe("runTick — off-season demo team exclusion (gap 1, exclude-offseason-demo-teams-SUMMARY.md)", () => {
  it("a live match containing a demo team writes no team/{demoKey} artifact and acquires no D1 state for it, while real teammates ARE updated and the event page stays untouched", async () => {
    const window: WindowFixture = { eventKey: "2026demo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType: 0,
      season: SEASON,
      matches: [
        tbaMatch({
          key: "2026demo_qm1",
          eventKey: "2026demo",
          matchNumber: 1,
          redTeams: ["frc1", "frc2", "frc9985"],
          blueTeams: BLUE_TEAMS,
          redScore: 120,
          blueScore: 95,
          actualTimeSec: Math.floor(NOW_MS / 1000) - 60,
        }),
      ],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026demo", record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    expect(result.eventsAdvanced).toBe(1);

    // No team/{demoKey} artifact for the demo teammate.
    const demoTeamPutKey = artifactKey({ page: "team", teamKey: "frc9985", year: SEASON, algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === demoTeamPutKey)).toBe(false);

    // The real teammate AND the real opposing alliance's teams DO get published
    // — this is an exclusion of the demo key, not an accidental drop of the
    // whole match's real teammates.
    for (const teamKey of ["frc1", "frc2", ...BLUE_TEAMS]) {
      const teamPutKey = artifactKey({ page: "team", teamKey, year: SEASON, algorithmId: "opr", version: opr.version });
      expect(r2.puts.some((p) => p.key === teamPutKey)).toBe(true);
    }

    // No D1 state row is ever created under the raw demo key.
    expect(d1.algorithmState.has("opr::team::frc9985")).toBe(false);
    // The real teammate's own state DID acquire a row.
    expect(d1.algorithmState.has("opr::team::frc1")).toBe(true);

    // The event page's own standings are deliberately untouched by this
    // exclusion — a demo robot's real historical presence in an event's own
    // match/alliance record stays visible, matching `publish.ts`'s unfiltered
    // `eventTeamKeys`.
    const eventPutKey = artifactKey({ page: "event", eventKey: "2026demo", algorithmId: "opr", version: opr.version });
    const eventPut = r2.puts.find((p) => p.key === eventPutKey);
    expect(eventPut).toBeDefined();
    const eventArtifact = JSON.parse(eventPut!.body) as { teams: readonly { teamKey: string }[] };
    expect(eventArtifact.teams.some((t) => t.teamKey === "frc9985")).toBe(true);
  });

  it("a fully-demo alliance is a no-op fold — resulting rating state is byte-identical to never having replayed the match at all, and no demo key ever acquires D1 state or an artifact", async () => {
    const RED = ["frc1", "frc2", "frc3"];
    const baselineMatch = tbaMatch({
      key: "2026demo_qm1",
      eventKey: "2026demo",
      matchNumber: 1,
      redTeams: RED,
      blueTeams: BLUE_TEAMS,
      redScore: 120,
      blueScore: 95,
      actualTimeSec: Math.floor(NOW_MS / 1000) - 120,
    });
    const fullyDemoMatch = tbaMatch({
      key: "2026demo_qm2",
      eventKey: "2026demo",
      matchNumber: 2,
      redTeams: RED,
      blueTeams: ["frc9970", "frc9971", "frc9972"],
      redScore: 200,
      blueScore: 0,
      actualTimeSec: Math.floor(NOW_MS / 1000) - 60,
    });

    // Baseline: only the real-vs-real match ever gets folded at this event.
    const baselineWindow: WindowFixture = { eventKey: "2026demo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const baselineKv = makeKv([baselineWindow]);
    const baselineD1 = new FakeD1Database();
    const baselineR2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026demo", { etag: "etag-1", eventType: 0, season: SEASON, matches: [baselineMatch] }]])));
    await runTick(makeEnv(baselineKv, baselineD1, baselineR2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    const baselineEventState = baselineD1.algorithmState.get("opr::event::2026demo")?.state_json;
    const baselineTeamState = baselineD1.algorithmState.get("opr::team::frc1")?.state_json;
    expect(baselineEventState).toBeDefined();
    expect(baselineTeamState).toBeDefined();
    vi.unstubAllGlobals();

    // Test: the SAME real-vs-real match, PLUS a fully-demo forfeit at the
    // same event — should fold as a complete no-op for every real team.
    const testWindow: WindowFixture = { eventKey: "2026demo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const testKv = makeKv([testWindow]);
    const testD1 = new FakeD1Database();
    const testR2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026demo", { etag: "etag-2", eventType: 0, season: SEASON, matches: [baselineMatch, fullyDemoMatch] }]])));
    await runTick(makeEnv(testKv, testD1, testR2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(testD1.algorithmState.get("opr::event::2026demo")?.state_json).toBe(baselineEventState);
    expect(testD1.algorithmState.get("opr::team::frc1")?.state_json).toBe(baselineTeamState);

    // No D1 state row or published artifact ever acquired under a raw demo key.
    for (const demoKey of ["frc9970", "frc9971", "frc9972"]) {
      expect(testD1.algorithmState.has(`opr::team::${demoKey}`)).toBe(false);
      const demoTeamPutKey = artifactKey({ page: "team", teamKey: demoKey, year: SEASON, algorithmId: "opr", version: opr.version });
      expect(testR2.puts.some((p) => p.key === demoTeamPutKey)).toBe(false);
    }
  });
});

describe("runTick — global rebuild (D-16)", () => {
  it("fires on the event-boundary trigger (an event completing its last scheduled match this tick)", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    // A SINGLE played match and nothing else -- stillUpcoming is empty, so
    // this event is complete after folding it.
    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType: 0,
      season: SEASON,
      matches: [tbaMatch({ key: "2026casj_qm1", eventKey: "2026casj", matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 })],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026casj", record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER });

    expect(result.globalRebuildRan).toBe(true);
    const teamsPutKey = artifactKey({ page: "teams", year: SEASON, algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === teamsPutKey)).toBe(true);
  });

  it("fires on the fixed-interval trigger even when no event completed", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026casj", twoMatchEventRecord("2026casj", "etag-1")]]))); // event NOT complete (has an upcoming match)

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, globalRebuildIntervalMs: 0 });

    expect(result.globalRebuildRan).toBe(true);
  });

  it("is skipped when the budget is exhausted by per-event work", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026casj", twoMatchEventRecord("2026casj", "etag-1")]])));

    // usableCap = 26 - 2 = 24: fits the tick's own fixed cost (3) plus the
    // one event's full processing (20 = 23 total), leaving exactly 1 unit —
    // enough for the rebuild's own read but not its write, so
    // writeArtifactObject reports deferred and the rebuild reports it did
    // not run.
    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, subrequestCap: 26, subrequestReserve: 2, globalRebuildIntervalMs: 0 });

    expect(result.eventsAdvanced).toBe(1);
    expect(result.globalRebuildRan).toBe(false);
  });

  it("260902-pbe: reads an object-form (pre-republish) teams artifact, merges touched teams, and writes it back POSITIONALLY — an untouched row's metrics survive the decode/re-encode round trip exactly", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();

    // Seed R2 with the shape production actually serves today: object-form
    // `metrics`, no `metricKeys` preamble at all — this Worker has never
    // written one before this task.
    const teamsKey = artifactKey({ page: "teams", year: SEASON, algorithmId: "opr", version: opr.version });
    const legacyObjectFormArtifact = {
      schemaVersion: 1,
      generation: "gen-0",
      computedAt: "2026-08-01T00:00:00.000Z",
      algorithmId: "opr",
      algorithmVersion: opr.version,
      season: SEASON,
      teams: [
        {
          teamKey: "frc999",
          teamNumber: 999,
          nickname: "Untouched Legacy Team",
          record: { wins: 1, losses: 0, ties: 0 },
          metrics: { total: { value: 10, spread: 1 } },
          eventCount: 1,
          matchCount: 1,
        },
      ],
    };
    await r2.put(teamsKey, JSON.stringify(legacyObjectFormArtifact));

    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType: 0,
      season: SEASON,
      matches: [tbaMatch({ key: "2026casj_qm1", eventKey: "2026casj", matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 })],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026casj", record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER });
    expect(result.globalRebuildRan).toBe(true);

    const teamsPut = r2.puts.filter((p) => p.key === teamsKey).at(-1);
    expect(teamsPut).toBeDefined();
    const written = JSON.parse(teamsPut!.body) as { metricKeys?: string[]; teams: { teamKey: string; metrics: unknown }[] };

    // Every write this Worker makes is positional now, regardless of what
    // shape it just read.
    expect(Array.isArray(written.metricKeys)).toBe(true);
    for (const row of written.teams) {
      expect(Array.isArray(row.metrics)).toBe(true);
    }

    // The untouched legacy row survived the decode-then-re-encode round trip
    // with its exact metrics intact — the merge path's whole safety argument.
    const untouchedRow = written.teams.find((t) => t.teamKey === "frc999");
    expect(untouchedRow).toBeDefined();
    const decoded = decodeTeamsRowMetrics(untouchedRow!.metrics as never, written.metricKeys!);
    expect(decoded.total).toEqual({ value: 10, spread: 1 });

    // And the newly-touched teams acquired a real row too.
    for (const teamKey of ALL_TEAMS) {
      expect(written.teams.some((t) => t.teamKey === teamKey)).toBe(true);
    }
  });
});
