/**
 * Drives `runTick` with injected fakes for D1/R2/KV and a stubbed `fetch` —
 * no network, no wrangler. Covers the nothing-live early exit,
 * state-before-artifact ordering, idempotent repeats, overlapping-invocation
 * folding, per-event error confinement (rejecting write / throwing poll),
 * concurrent live events, and the global-rebuild triggers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTick, touchedTeamsRowMetrics, touchedEventTeamMetrics, MAX_PROBES_PER_TICK, PROBE_ROTATION_PERIOD_MS } from "../src/scheduled.js";
import { checkLiveEventArtifactShape, checkTeamSeasonArtifactShape } from "../src/artifactShapeCheck.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import {
  artifactKey,
  decodeTeamsRowMetrics,
  LiveEventArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  TeamSeasonArtifactSchema,
} from "../../../packages/harness/pageArtifacts.js";
// `runTick` builds every artifact key from the LIVE algorithm module's
// `version` (see scheduled.ts's `info.algorithm.version`), never from the
// algorithms manifest below, so deriving these expectations from the module
// tracks any future version bump instead of standing as a literal trip-wire.
import { opr } from "../../../packages/core/algorithms/opr.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../packages/harness/publishedAlgorithms.js";
import { seedStateBaselineMarkers } from "./support/stateBaseline.js";
import type { Env } from "../src/env.js";
import type { D1Database } from "@cloudflare/workers-types";
import { liveRosterKey } from "../../../packages/harness/liveRoster.js";

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

  constructor(private readonly sharedLog: SharedLogEntry[] = []) {
    // Every existing fixture's algorithms manifest publishes `generation:
    // "gen-1"` (see `algorithmsManifest` below) — seeding a marker at that
    // generation for every published algorithm id is what keeps every
    // pre-existing test in this file folding exactly as before quick task
    // 260920-q75 (a mismatch would otherwise suspend folding by default).
    seedStateBaselineMarkers(this.eventCursors, PUBLISHED_ALGORITHM_IDS, "gen-1");
  }

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
      // A request may name more than one scope kind in one query (e.g. OPR's
      // event key + team keys). Each `(scope_kind = ? AND scope_key IN
      // (?,?,...))` group in the SQL text names its own placeholder count, in
      // the SAME order the real query binds its args -- walking the SQL text
      // is what lets this fake support an arbitrary number of selections
      // without hardcoding shape.
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
      // Every bound argument is an `event_key` to match, whether the caller
      // asked for one (`readEventCursor`) or several via an `IN (...)` list
      // (`readEventCursors` — the tick-meta sentinel plus every live
      // algorithm's state-baseline marker, quick task 260920-q75). Returning
      // every hit serves both shapes with one branch.
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
  /** ATTEMPTS, not successes — a rejected put still counts here, which is what makes "the retry consumed no second subrequest" assertable. */
  putCallCount = 0;
  puts: { key: string; body: string }[] = [];
  /** Set to make every `put` reject, modelling an R2/network failure AFTER the subrequest has already been counted. */
  rejectPutsWith: Error | null = null;
  private readonly store = new Map<string, string>();

  constructor(private readonly sharedLog: SharedLogEntry[] = []) {}

  async put(key: string, body: string): Promise<void> {
    this.putCallCount++;
    if (this.rejectPutsWith !== null) throw this.rejectPutsWith;
    this.puts.push({ key, body });
    this.store.set(key, body);
    this.sharedLog.push({ type: "r2-put", key });
  }

  async get(key: string): Promise<FakeR2Object | null> {
    const value = this.store.get(key);
    return value === undefined ? null : new FakeR2Object(value);
  }

  /** Pre-load an object as if a previous tick or an offline publish had written it — deliberately NOT counted in `putCallCount`/`puts`, which exist to count what THIS tick wrote. */
  seed(key: string, body: string): void {
    this.store.set(key, body);
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

// Every `makeKv` call site in this file uses the default OPR-ONLY manifest,
// so `LIVE_ALGORITHM_IDS: "opr"` keeps assertions exercising a non-empty
// live tier -- an empty tier throws EmptyLiveAlgorithmTierError.
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
  /** PROBE-ONLY when true (260920-lny) — a reader must prove matches exist before folding. Defaults to `false` (a measured, foldable window) so every pre-existing call site is untouched. */
  inferred?: boolean;
}

function liveWindowsManifest(windows: readonly WindowFixture[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-22T00:00:00.000Z",
    windows: windows.map((w) => ({ ...w, inferred: w.inferred ?? false })),
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
  /** Emitted only when defined, so every existing fixture's payload stays byte-identical. */
  videos?: readonly { type: string; key: string }[];
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
    ...(f.videos !== undefined ? { videos: f.videos } : {}),
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
      // `tbaEventSchema` requires `name`; its absence would silently throw
      // inside `processEvent`'s swallowed try/catch, degrading `eventType` to
      // the `-1` sentinel regardless of `record.eventType`.
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({ key: eventKey, name: eventKey, year: record.season, event_type: record.eventType, start_date: "2026-08-01" }),
      };
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
  // Unconditional, because a per-test `mockRestore()` placed after an
  // assertion never runs when that assertion throws — leaving `console.warn`
  // spied, and the NEXT test's `vi.spyOn` reusing the same spy with the
  // previous test's calls still on it. That turns one real failure into a
  // second, fictional one, which is exactly what it did the first time these
  // retry tests were mutation-checked.
  vi.restoreAllMocks();
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
    expect(result).toMatchObject({ eventsConsidered: 0, eventsAdvanced: 0, eventsFailed: 0, tbaRequests: 0, globalRebuildRan: false });
  });
});

describe("runTick — one live event, one new match", () => {
  it("writes state before any artifact put, exactly ONE artifact put, and zero team puts", async () => {
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
    expect(d1.batchCallCount).toBe(1); // one algorithm (opr) -> one batched state write
    // Since 260918-16t this is ONE: the event artifact alone, with the live
    // rows inside it. It was TWO (event + a separate metric sidecar) after
    // 260917-jr4, and `1 + ALL_TEAMS.length` -- a whole team-season artifact
    // rewritten per touched team -- before that. Removing those puts is the
    // whole change, in two steps.
    // Since quick task 260921-5qw a FIRST fold also writes the event's live roster, the tiny object a
    // robot page finds a promoted event through. It is one object per EVENT, not per algorithm, and it
    // is written only when the roster grew, so never on an ordinary tick.
    expect(r2.puts.filter((p) => p.key !== liveRosterKey("2026casj"))).toHaveLength(1);
    expect(r2.puts.filter((p) => p.key === liveRosterKey("2026casj"))).toHaveLength(1);

    const eventPutKey = artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === eventPutKey)).toBe(true);
    for (const teamKey of ALL_TEAMS) {
      const teamPutKey = artifactKey({ page: "team", teamKey, year: SEASON, algorithmId: "opr", version: opr.version });
      expect(r2.puts.some((p) => p.key === teamPutKey), teamKey + ": a live tick must write no team artifact").toBe(false);
    }
    // Since 260918-16t the live rows ride inside the event body above, and since
    // 260921-5qw a first fold also writes the event's live roster. Those are the
    // ONLY two objects. Asserted by equality over every key mentioning this
    // event, so any third object fails here by name.
    expect(new Set(r2.puts.map((p) => p.key).filter((key) => key.includes("2026casj")))).toEqual(new Set([eventPutKey, liveRosterKey("2026casj")]));

    // OPR's lastEventByTeam bookkeeping lives in its OWN team-scoped rows,
    // and the ONE batched state write for this event includes them alongside
    // the event row -- proof the tick reads/folds/writes both scope kinds
    // together, in the same single-statement read and single batched write.
    for (const teamKey of RED_TEAMS) {
      const row = d1.algorithmState.get(`opr::team::${teamKey}`);
      expect(row).toBeDefined();
      // The row carries OPR's own `lastEventKey` and NOTHING else: OPR has no
      // Sigma Score or ranking-point passenger, so no level-2 key rides on
      // its team rows.
      expect(JSON.parse(row!.state_json)).toEqual({
        lastEventKey: "2026casj",
      });
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

/**
 * WAS "no-starvation under a restrictive budget" until quick task 260923-3w4.
 * That test drove two concurrent live events with `subrequestCap: 17,
 * subrequestReserve: 2`, sized so exactly one event fitted and the second
 * deferred, then asserted the union of two ticks covered both. There is no cap
 * to restrict and no deferral to observe any more, so the fixture cannot be
 * rebuilt — and the rotation property it was standing in for is proved directly,
 * over an abstract early stop, by `subrequestCounter.test.ts`'s "no-starvation
 * property" describe (including its counterfactual that a pinned offset
 * permanently omits the tail).
 *
 * What replaces it here is the BEHAVIOUR CHANGE that made it unbuildable: two
 * concurrent live events now both fold in ONE tick.
 */
describe("runTick — two concurrent live events", () => {
  it("folds and publishes BOTH in a single tick, with no second tick needed", async () => {
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

    const tick = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(tick.eventsAdvanced).toBe(2);
    expect(tick.eventsFailed).toBe(0);

    const eventAPut = r2.puts.some((p) => p.key.includes("2026aaaa") && p.key.startsWith("v1/event/"));
    const eventBPut = r2.puts.some((p) => p.key.includes("2026bbbb") && p.key.startsWith("v1/event/"));
    expect(eventAPut).toBe(true);
    expect(eventBPut).toBe(true);
  });
});

describe("runTick — algorithm module construction", () => {
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
    // `buildAlgorithmModules` requires a second parameter (the live tier),
    // passed through unchanged here since this test's own concern is call
    // COUNT, not filtering behavior.
    const countingBuilder = (manifest: Parameters<typeof realBuildAlgorithmModules>[0], liveAlgorithmIds: Parameters<typeof realBuildAlgorithmModules>[1]) => {
      constructionCount++;
      return realBuildAlgorithmModules(manifest, liveAlgorithmIds);
    };

    await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, buildAlgorithmModules: countingBuilder, ...DISABLE_GLOBAL_REBUILD });

    expect(constructionCount).toBe(1);
  });
});

describe("runTick — off-season demo team exclusion", () => {
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

    // The real teammate AND the real opposing alliance's teams DO reach the
    // event artifact's live rows: an exclusion of the demo key, not an
    // accidental drop of the whole match's real teammates. Asserted against
    // those rows since 260917-jr4 (and against the `live` block rather than a
    // separate object since 260918-16t), because no team artifact is written
    // for anyone; the property under test is unchanged.
    const demoEventPut = r2.puts.filter((p) => p.key === artifactKey({ page: "event", eventKey: "2026demo", algorithmId: "opr", version: opr.version })).at(-1);
    expect(demoEventPut).toBeDefined();
    const demoLive = LiveEventArtifactSchema.parse(JSON.parse(demoEventPut!.body)).live;
    expect(demoLive, "the demo event's written artifact carries no live block").toBeDefined();
    const teamsInLiveRows = new Set(demoLive!.rows.flatMap((row) => row.t));
    expect(teamsInLiveRows.has("frc9985")).toBe(false);
    for (const teamKey of ["frc1", "frc2", ...BLUE_TEAMS]) {
      expect(teamsInLiveRows.has(teamKey), teamKey).toBe(true);
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

describe("runTick — global rebuild", () => {
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

  /**
   * DELETED by quick task 260923-3w4: "is skipped when the budget is exhausted
   * by per-event work". It sized `subrequestCap`/`subrequestReserve` so that
   * exactly one subrequest was left after the event's own processing — enough
   * for the rebuild's read but not its write — and asserted
   * `globalRebuildRan: false`. Both the cap and `writeArtifactObject`'s
   * `{ deferred: true }` return are gone; the rebuild now reports `false` only
   * for a genuine read/parse/write FAILURE, which the throwing-put cases in this
   * file already cover.
   */

  it("reads an object-form (pre-republish) teams artifact, merges touched teams, and writes it back POSITIONALLY — an untouched row's metrics survive the decode/re-encode round trip exactly", async () => {
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
    // Exact, tier included: tiers are carried, never re-ranked, so an
    // untouched row gains and loses no tier.
    expect(decoded.total).toEqual({ value: 10, spread: 1 });

    // And the newly-touched teams acquired a real row too.
    for (const teamKey of ALL_TEAMS) {
      expect(written.teams.some((t) => t.teamKey === teamKey)).toBe(true);
    }
  });

  /**
   * A TOUCHED row must keep the fields the offline publisher owns. The test
   * above proves an UNTOUCHED row survives; this one covers a touched row's
   * own field-by-field rebuild, so a team that played a match keeps its
   * region (and with it its district/state rank scopes) and its per-team
   * consistency figure until the next offline publish.
   */
  it("a TOUCHED team's row keeps its offline-published region fields, and a stale unknown per-team field does not survive", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();

    const teamsKey = artifactKey({ page: "teams", year: SEASON, algorithmId: "opr", version: opr.version });
    await r2.put(
      teamsKey,
      JSON.stringify({
        schemaVersion: 1,
        generation: "gen-0",
        computedAt: "2026-08-01T00:00:00.000Z",
        algorithmId: "opr",
        algorithmVersion: opr.version,
        season: SEASON,
        teams: [
          {
            // frc1 is in RED_TEAMS, so this tick TOUCHES it.
            teamKey: "frc1",
            teamNumber: 1,
            nickname: "Touched Team",
            record: { wins: 2, losses: 0, ties: 0 },
            // A published Sigma entry with a tier, which the live tick does
            // not recompute and must not drop.
            metrics: { total: { value: 10, spread: 1 }, sigma: { value: 3.25, tier: "epic" } },
            eventCount: 1,
            matchCount: 2,
            legacyPerTeamField: 27.5,
            country: "USA",
            stateProv: "CA",
            districtKey: "2026fim",
          },
        ],
      })
    );

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
    const written = JSON.parse(teamsPut!.body) as {
      metricKeys: string[];
      teams: { teamKey: string; metrics: unknown; legacyPerTeamField?: number; country?: string; stateProv?: string; districtKey?: string; matchCount: number }[];
    };
    const touched = written.teams.find((t) => t.teamKey === "frc1");
    expect(touched).toBeDefined();
    // The published Sigma entry survives, value and tier.
    expect(decodeTeamsRowMetrics(touched!.metrics as never, written.metricKeys).sigma).toEqual({ value: 3.25, tier: "epic" });

    // A retired or unknown per-team field is stripped on parse and never
    // rewritten, so a stale artifact's value does not ride forward through a
    // live tick.
    expect(touched!, "a live tick must not carry an unknown per-team field forward").not.toHaveProperty("legacyPerTeamField");
    // Publisher-owned: preserved through the tick.
    expect(touched!.country).toBe("USA");
    expect(touched!.stateProv).toBe("CA");
    expect(touched!.districtKey).toBe("2026fim");

    // Tick-owned: still advanced, so the spread cannot be masking stale data.
    expect(touched!.matchCount).toBe(3);
  });
});

/**
 * During a live global rebuild the Teams list must not fall back to a false
 * Common. Full tier re-derivation was measured over the CPU gate, so touched
 * rows carry their published tiers forward (`touchedTeamsRowMetrics`'s doc
 * comment has the numbers).
 */
describe("live Teams-row tiers", () => {
  it("a touched metric keeps the prior row's published tier on the same key, with the fresh value", () => {
    const result = touchedTeamsRowMetrics({ total: { value: 180, tier: "legendary" }, phaseAuto: { value: 20, spread: 1, tier: "rare" } }, {
      total: { value: 190.5, spread: 2 },
      phaseAuto: { value: 22 },
    });
    expect(result.total).toEqual({ value: 190.5, spread: 2, tier: "legendary" });
    expect(result.phaseAuto).toEqual({ value: 22, tier: "rare" });
  });

  it("a key the prior row lacks, or carried without a tier, gets NO tier key — never a written 'common'", () => {
    const result = touchedTeamsRowMetrics({ total: { value: 40 } }, { total: { value: 41 }, phaseTeleop: { value: 7 } });
    expect(result.total).toEqual({ value: 41 });
    expect(result.phaseTeleop).toEqual({ value: 7 });
    expect(JSON.stringify(result)).not.toContain("common");
  });

  it("with no prior row at all, returns the fresh entries untiered", () => {
    expect(touchedTeamsRowMetrics(undefined, { total: { value: 12 } })).toEqual({ total: { value: 12 } });
  });

  it("the prior row's Sigma entry (value and tier) is carried forward unchanged after the fresh entries, and a stale retired consistency entry is not", () => {
    const prior = { total: { value: 100, tier: "epic" as const }, sigma: { value: 3.25, tier: "legendary" as const }, legacyConsistency: { value: 9.5, tier: "rare" as const } };
    const result = touchedTeamsRowMetrics(prior, { total: { value: 101 } });
    expect(result.sigma).toEqual({ value: 3.25, tier: "legendary" });
    expect(result).not.toHaveProperty("legacyConsistency");
    expect(Object.keys(result)).toEqual(["total", "sigma"]);
  });

  it("a Sigma entry is never re-tiered and a fresh Sigma entry wins over the carried one", () => {
    const result = touchedTeamsRowMetrics({ sigma: { value: 3.25, tier: "legendary" } }, { sigma: { value: 4 } });
    expect(result.sigma).toEqual({ value: 4, tier: "legendary" });
  });

  it("never mutates its inputs", () => {
    const prior = { total: { value: 100, tier: "epic" as const } };
    const fresh = { total: { value: 101 } };
    const priorSnapshot = structuredClone(prior);
    const freshSnapshot = structuredClone(fresh);
    touchedTeamsRowMetrics(prior, fresh);
    expect(prior).toEqual(priorSnapshot);
    expect(fresh).toEqual(freshSnapshot);
  });

  it("runTick: every touched row with a prior tier in the WRITTEN teams artifact carries it, and untouched rows keep theirs exactly", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();

    const teamsKey = artifactKey({ page: "teams", year: SEASON, algorithmId: "opr", version: opr.version });
    const priorTiers: Record<string, "rare" | "epic" | "legendary"> = { frc1: "legendary", frc2: "epic", frc4: "rare" };
    await r2.put(
      teamsKey,
      JSON.stringify({
        schemaVersion: 1,
        generation: "gen-0",
        computedAt: "2026-08-01T00:00:00.000Z",
        algorithmId: "opr",
        algorithmVersion: opr.version,
        season: SEASON,
        teams: [
          ...Object.entries(priorTiers).map(([teamKey, tier], i) => ({
            teamKey,
            teamNumber: Number(teamKey.slice(3)),
            nickname: `Touched ${teamKey}`,
            record: { wins: 1, losses: 0, ties: 0 },
            metrics: { total: { value: 50 + i, tier } },
            eventCount: 1,
            matchCount: 1,
          })),
          {
            teamKey: "frc999",
            teamNumber: 999,
            nickname: "Untouched",
            record: { wins: 1, losses: 0, ties: 0 },
            metrics: { total: { value: 77.7, spread: 1, tier: "epic" } },
            eventCount: 1,
            matchCount: 1,
          },
        ],
      })
    );

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
    const written = JSON.parse(teamsPut!.body) as { metricKeys: string[]; teams: { teamKey: string; metrics: unknown }[] };
    const decodedByTeam = new Map(written.teams.map((t) => [t.teamKey, decodeTeamsRowMetrics(t.metrics as never, written.metricKeys)]));

    let checked = 0;
    for (const teamKey of ALL_TEAMS) {
      const total = decodedByTeam.get(teamKey)?.total;
      expect(total, `${teamKey} has a live total`).toBeDefined();
      expect(total!.tier, `${teamKey} tier`).toBe(priorTiers[teamKey]);
      if (priorTiers[teamKey] !== undefined) {
        // Fresh value, not the seeded one: the tick really rewrote this row.
        expect(total!.value).not.toBe(50 + Object.keys(priorTiers).indexOf(teamKey));
        checked++;
      }
    }
    expect(checked, "non-vacuous: every seeded touched team was checked").toBe(Object.keys(priorTiers).length);
    expect(decodedByTeam.get("frc999")?.total).toEqual({ value: 77.7, spread: 1, tier: "epic" });
  });
});

describe("live ticks keep the published Sigma entry", () => {
  it("carries the prior Sigma entry forward, as the last key, over a fresh record that lacks it", () => {
    const result = touchedEventTeamMetrics({ total: { value: 10, percentile: 40 }, sigma: { value: 27.8, percentile: 83.2 } }, { total: { value: 12.34 } });
    expect(result).toEqual({ total: { value: 12.34 }, sigma: { value: 27.8, percentile: 83.2 } });
    expect(Object.keys(result)).toEqual(["total", "sigma"]);
  });

  it("when fresh already has a sigma key, the fresh entry wins and nothing is carried", () => {
    const result = touchedEventTeamMetrics({ sigma: { value: 27.8, percentile: 83.2 } }, { sigma: { value: 30 } });
    expect(result).toEqual({ sigma: { value: 30 } });
  });

  it("with prior undefined, the result equals the rounded fresh record", () => {
    expect(touchedEventTeamMetrics(undefined, { total: { value: 12.34 } })).toEqual({ total: { value: 12.34 } });
  });

  it("no key other than sigma is ever carried from prior", () => {
    const result = touchedEventTeamMetrics({ total: { value: 999 }, phaseAuto: { value: 5 }, sigma: { value: 1, percentile: 2 } }, { total: { value: 10 } });
    expect(result).toEqual({ total: { value: 10 }, sigma: { value: 1, percentile: 2 } });
    expect(result).not.toHaveProperty("phaseAuto");
  });

  it("runTick: a touched team's seeded event and team-season Sigma entries survive one tick, on both artifacts", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();

    const eventArtifactKey = artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "opr", version: opr.version });
    const seededSigma = { value: 27.8, percentile: 83.2 };
    await r2.put(
      eventArtifactKey,
      JSON.stringify({
        schemaVersion: 1,
        generation: "gen-0",
        computedAt: "2026-08-01T00:00:00.000Z",
        algorithmId: "opr",
        algorithmVersion: opr.version,
        eventKey: "2026casj",
        season: SEASON,
        matches: [],
        upcoming: [],
        teams: [{ teamKey: "frc1", teamNumber: 1, nickname: "Touched", metrics: { total: { value: 50 }, sigma: seededSigma } }],
      })
    );

    const teamArtifactKey = artifactKey({ page: "team", teamKey: "frc1", year: SEASON, algorithmId: "opr", version: opr.version });
    await r2.put(
      teamArtifactKey,
      JSON.stringify({
        schemaVersion: 1,
        generation: "gen-0",
        computedAt: "2026-08-01T00:00:00.000Z",
        algorithmId: "opr",
        algorithmVersion: opr.version,
        teamKey: "frc1",
        teamNumber: 1,
        nickname: "Touched",
        season: SEASON,
        seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: { total: { value: 50 }, sigma: seededSigma } },
        events: [],
        metricHistory: [],
      })
    );

    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType: 0,
      season: SEASON,
      matches: [tbaMatch({ key: "2026casj_qm1", eventKey: "2026casj", matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 })],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026casj", record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    expect(result.eventsAdvanced).toBe(1);

    const eventPut = r2.puts.filter((p) => p.key === eventArtifactKey).at(-1);
    expect(eventPut).toBeDefined();
    const writtenEvent = JSON.parse(eventPut!.body) as { teams: { teamKey: string; metrics: Record<string, { value: number; percentile?: number }> }[] };
    const frc1EventRow = writtenEvent.teams.find((t) => t.teamKey === "frc1");
    expect(frc1EventRow?.metrics.sigma).toEqual(seededSigma);
    expect(frc1EventRow?.metrics.total?.value).not.toBe(50); // the fresh value really landed, not the seeded one

    const teamPut = r2.puts.filter((p) => p.key === teamArtifactKey).at(-1);
    expect(teamPut).toBeDefined();
    const writtenTeam = JSON.parse(teamPut!.body) as { seasonStats: { metrics: Record<string, { value: number; percentile?: number }> } };
    expect(writtenTeam.seasonStats.metrics.sigma).toEqual(seededSigma);
  });
});

describe("runTick — official-play scope on the global rebuild feed", () => {
  it("event_type 99 (offseason): the event artifact and its live rows are written, but no teams/{year} object is written at all", async () => {
    const window: WindowFixture = { eventKey: "2026off", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType: 99,
      season: SEASON,
      matches: [tbaMatch({ key: "2026off_qm1", eventKey: "2026off", matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 })],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026off", record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER });
    expect(result.eventsAdvanced).toBe(1);
    expect(result.globalRebuildRan).toBe(true); // trigger fires (event-boundary), but runs as a legitimate no-op

    const eventPutKey = artifactKey({ page: "event", eventKey: "2026off", algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === eventPutKey)).toBe(true);
    // The event write — and so the live rows inside it — is UNCONDITIONAL on
    // event type, exactly as the team artifact write it replaced was; only the
    // `teams/{year}` feed below is gated on officialness.
    expect(LiveEventArtifactSchema.parse(JSON.parse(r2.puts.filter((p) => p.key === eventPutKey).at(-1)!.body)).live?.rows.length).toBeGreaterThan(0);
    expect(r2.puts.some((p) => p.key.startsWith("v1/team/"))).toBe(false);

    const teamsPutKey = artifactKey({ page: "teams", year: SEASON, algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === teamsPutKey)).toBe(false);
  });

  it("event_type 100 (preseason Week 0): the event artifact is written and no teams/{year} write happens, but nothing FOLDS, so OPR has no live rows to write", async () => {
    const window: WindowFixture = { eventKey: "2026prez", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType: 100,
      season: SEASON,
      matches: [tbaMatch({ key: "2026prez_qm1", eventKey: "2026prez", matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 })],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026prez", record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER });
    expect(result.eventsAdvanced).toBe(1);

    const eventPutKey = artifactKey({ page: "event", eventKey: "2026prez", algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === eventPutKey)).toBe(true);
    // The event write is UNCONDITIONAL on event type. What differs from an
    // offseason event since quick task 260919-368: a Week 0 match is predicted
    // and never folded (`foldsIntoRatings`). OPR is event-scoped and starts each
    // season empty, so at a preseason event it holds a rating for nobody and
    // there is no live metric row to write. SPR, the live tier, carries ratings
    // in and does write rows; `liveAlgorithmTier.test.ts` pins that side.
    const written = LiveEventArtifactSchema.parse(JSON.parse(r2.puts.filter((p) => p.key === eventPutKey).at(-1)!.body));
    expect(written.matches.map((m) => m.matchKey)).toEqual(["2026prez_qm1"]);
    expect(written.live?.rows ?? []).toHaveLength(0);
    // No OPR team state was created by the Week 0 match.
    expect([...d1.algorithmState.keys()].filter((k) => k.startsWith("opr::team::"))).toEqual([]);
    expect(r2.puts.some((p) => p.key.startsWith("v1/team/"))).toBe(false);

    const teamsPutKey = artifactKey({ page: "teams", year: SEASON, algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === teamsPutKey)).toBe(false);
  });

  it("event_type 0 (official): still contributes and still produces the teams/{year} write, byte-equivalent to today's behaviour", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType: 0,
      season: SEASON,
      matches: [tbaMatch({ key: "2026casj_qm1", eventKey: "2026casj", matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 })],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026casj", record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER });
    expect(result.eventsAdvanced).toBe(1);
    expect(result.globalRebuildRan).toBe(true);

    const teamsPutKey = artifactKey({ page: "teams", year: SEASON, algorithmId: "opr", version: opr.version });
    const teamsPut = r2.puts.find((p) => p.key === teamsPutKey);
    expect(teamsPut).toBeDefined();
    const written = JSON.parse(teamsPut!.body) as { teams: { teamKey: string }[] };
    for (const teamKey of ALL_TEAMS) {
      expect(written.teams.some((t) => t.teamKey === teamKey)).toBe(true);
    }
  });

  it("an unknown event type (-1, event-detail fetch failed) is treated as official -- the teams table is still updated, not silently frozen", async () => {
    const window: WindowFixture = { eventKey: "2026unk", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const matches = [tbaMatch({ key: "2026unk_qm1", eventKey: "2026unk", matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 })];
    // Custom fetch stub: the matches endpoint succeeds normally, but the
    // event-detail endpoint (queried separately for `event_type`) always
    // fails -- reproducing `eventType`'s documented `-1` degradation
    // sentinel without a full TbaEventRecord map (which cannot express
    // "matches succeed, detail fails" for the same event key).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
        const u = String(url);
        if (/\/event\/[^/]+\/matches$/.test(u)) {
          const ifNoneMatch = init?.headers?.["If-None-Match"];
          if (ifNoneMatch) return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
          return { status: 200, ok: true, headers: { get: (name: string) => (name === "etag" ? "etag-1" : null) }, json: async () => matches };
        }
        if (/\/event\/[^/]+$/.test(u)) {
          return { status: 500, ok: false, headers: { get: () => null }, json: async () => ({}) };
        }
        throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
      })
    );

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER });
    expect(result.eventsAdvanced).toBe(1);

    const teamsPutKey = artifactKey({ page: "teams", year: SEASON, algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === teamsPutKey)).toBe(true);
  });

  it("with an offseason event live, D1 state still advances and the event cursor still moves -- the same matches are not re-folded on the next tick", async () => {
    const window: WindowFixture = { eventKey: "2026off", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType: 99,
      season: SEASON,
      matches: [tbaMatch({ key: "2026off_qm1", eventKey: "2026off", matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 })],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026off", record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER });
    expect(result.eventsAdvanced).toBe(1);

    expect(d1.eventCursors.get("2026off")?.last_folded_match_key).toBe("2026off_qm1");
    expect(d1.algorithmState.get("opr::team::frc1")).toBeDefined();
    expect(d1.algorithmState.get("opr::event::2026off")).toBeDefined();
  });
});

/**
 * The tick's own poll already carries everything a played row needs beyond the
 * prediction: TBA's reported time, the youtube video key and the score
 * breakdown the actual bonus flags come from. This drives the whole `runTick`
 * path (not the merge in isolation) so the wiring from `processEvent` through
 * `runPhaseBAndReport` to both merges is what is under test — a `playedRowFacts`
 * map that never gets filled fails here while every merge unit test still passes.
 */
describe("runTick — played rows carry the tick's own per-match facts", () => {
  it("writes video, TBA's reported sortTime and null actual RP / bonus flags on both the event row and the team row", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const actualTimeSec = Math.floor(NOW_MS / 1000) - 60;
    const videoKey = "dQw4w9WgXcQ";

    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType: 0,
      season: SEASON,
      matches: [
        // `tbaMatch` gives every fixture a null `score_breakdown`, so the actual
        // bonus flags must publish an explicit null ("not derivable"), never absence.
        tbaMatch({
          key: "2026casj_qm1",
          eventKey: "2026casj",
          matchNumber: 1,
          redTeams: RED_TEAMS,
          blueTeams: BLUE_TEAMS,
          redScore: 120,
          blueScore: 95,
          actualTimeSec,
          videos: [{ type: "youtube", key: videoKey }],
        }),
        tbaMatch({ key: "2026casj_qm2", eventKey: "2026casj", matchNumber: 2, redTeams: ["frc7", "frc8", "frc9"], blueTeams: ["frc10", "frc11", "frc12"], predictedTimeSec: Math.floor(NOW_MS / 1000) + 3600 }),
      ],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026casj", record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    expect(result.eventsAdvanced).toBe(1);

    const eventPutKey = artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "opr", version: opr.version });
    const eventPut = r2.puts.filter((p) => p.key === eventPutKey).at(-1);
    expect(eventPut).toBeDefined();
    const eventRow = (JSON.parse(eventPut!.body) as { matches: Record<string, unknown>[] }).matches.find((m) => m.matchKey === "2026casj_qm1");
    expect(eventRow).toBeDefined();
    expect(eventRow!.video).toBe(videoKey);
    expect(eventRow!.sortTime).toBe(actualTimeSec * 1000);
    expect(eventRow!.actualRedRp).toBeNull();
    expect(eventRow!.actualBlueRp).toBeNull();
    expect(eventRow!.actualRedBonusRp).toBeNull();
    expect(eventRow!.actualBlueBonusRp).toBeNull();

    // THE TEAM-ROW HALF OF THIS CLAIM MOVED (260917-jr4, D-07). The tick
    // writes no team artifact at all, so there is no team row here to read.
    // The same fields now reach the robot page through the BROWSER, which
    // builds a team-shaped row from this very event row
    // (`overlayTeamEventMatches` / `teamRowFromEventRow`), and
    // `apps/web/src/lib/liveTeamSeason.test.ts` asserts that derived row
    // equals the publisher's own row field for field, minus a stated
    // exception list. Deleting the assertion without naming its new home
    // would leave the impression the claim was dropped.
    const teamPutKey = artifactKey({ page: "team", teamKey: "frc1", year: SEASON, algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === teamPutKey)).toBe(false);
    // Non-vacuity for the redirect above: the event row this test just
    // asserted really is the row the browser derives from.
    expect(eventRow!.redTeams).toContain("frc1");
  });
});

// ---------------------------------------------------------------------------
// The bootstrap retry that recovers what the read-side schema parse used to do
// ---------------------------------------------------------------------------

/**
 * WHY THESE TESTS EXIST. Since 260915-t7o's fix F2 the tick reads artifacts
 * through `artifactShapeCheck.ts`'s O(1) structural guard instead of a full
 * `zod` parse. The guard checks only what the merges dereference, so a
 * corruption INSIDE a well-shaped artifact — a `teamNumber` that is a string, a
 * `name` that is a number — now survives the read, rides the merge, and fails
 * `writeArtifactObject`'s schema parse instead.
 *
 * That failure lands inside `runPhaseBAndReport`'s blanket `catch {}`.
 * `TeamSeasonArtifactSchema` has no `.catch` anywhere in it, so without a retry
 * that team would read the SAME corrupt object back and fail identically on
 * every subsequent tick — it would stop publishing permanently. Before F2 the
 * read-side parse rejected the object and the tick bootstrapped over it, which
 * self-heals on the very next tick. `writeArtifactWithBootstrapRetry` moves
 * that same degradation to the new detection point.
 *
 * Each fixture below is chosen to PASS the guard and FAIL the write schema, and
 * each test asserts both halves of that rather than assuming them — if a future
 * guard change starts rejecting one at read time, the non-vacuity assertion
 * fails and says so, instead of the test quietly passing for the wrong reason.
 */
const SEED_STAMP = { generation: "seed-gen", computedAt: "2026-08-01T00:00:00.000Z" };

/** Guard-passing (object, current schemaVersion, `seasonStats.record` an object, `events`/`metricHistory` arrays) but `teamNumber` is a string, which `TeamSeasonArtifactSchema`'s `z.number().int()` rejects at write. */
function guardPassingCorruptTeamArtifact(teamKey: string): string {
  return JSON.stringify({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: SEED_STAMP.generation,
    computedAt: SEED_STAMP.computedAt,
    algorithmId: "opr",
    algorithmVersion: opr.version,
    teamKey,
    teamNumber: "seventeen",
    nickname: "Corrupted",
    season: SEASON,
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: {} },
    events: [],
    metricHistory: [],
  });
}

/** Guard-passing (`matches`/`upcoming`/`teams` all arrays, current schemaVersion) but `name` is a number, which `z.string().min(1).optional()` rejects at write. */
function guardPassingCorruptEventArtifact(eventKey: string): string {
  return JSON.stringify({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: SEED_STAMP.generation,
    computedAt: SEED_STAMP.computedAt,
    algorithmId: "opr",
    algorithmVersion: opr.version,
    eventKey,
    season: SEASON,
    name: 42,
    matches: [],
    upcoming: [],
    teams: [],
  });
}

/** The same published body `guardPassingCorruptEventArtifact` starts from, but VALID — a prior tick's own output, for seeding a bad `live` key onto. */
function guardPassingBaseEventArtifact(eventKey: string): string {
  return JSON.stringify({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: SEED_STAMP.generation,
    computedAt: SEED_STAMP.computedAt,
    algorithmId: "opr",
    algorithmVersion: opr.version,
    eventKey,
    season: SEASON,
    matches: [],
    upcoming: [],
    teams: [],
  });
}

function stubOneLiveEvent(): void {
  vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026casj", twoMatchEventRecord("2026casj", "etag-1")]])));
}

const LIVE_WINDOW: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 7_200_000 };

const TEAM_PUT_KEY = artifactKey({ page: "team", teamKey: "frc1", year: SEASON, algorithmId: "opr", version: opr.version });
const EVENT_PUT_KEY = artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "opr", version: opr.version });

describe("runTick — a corrupt published artifact retries as a bootstrap instead of blocking forever", () => {
  /**
   * THE TEAM HALF BECAME AN ACCEPTED LOSS, ASSERTED RATHER THAN DELETED
   * (260917-jr4, unsound part 3). The tick no longer reads or writes a team
   * artifact at all, so it also no longer bootstraps over a corrupt one: a
   * corrupt team-season artifact now stays corrupt until the next offline
   * republish. That is a real, small regression Jacob accepted with the shape
   * — it is worth far less than the 7.6 ms of per-tick CPU the team loop cost
   * — and it is pinned here so a future reader sees a decision rather than a
   * missing test.
   *
   * The self-healing PROPERTY itself is not lost: since 260918-16t it lives on
   * the EVENT artifact, the one object the live path still owns, and is
   * asserted in the two tests below — a corrupt live block costs the block and
   * the tick republishes a fresh one in the same single put.
   */
  it("team: a corrupt team artifact is now left EXACTLY as it was — the tick makes no team read and no team write", async () => {
    const seeded = JSON.parse(guardPassingCorruptTeamArtifact("frc1")) as unknown;
    // Non-vacuity, unchanged from before: this fixture really does pass the
    // read guard and really does fail the write schema.
    expect(checkTeamSeasonArtifactShape(seeded)).toBeDefined();
    expect(() => TeamSeasonArtifactSchema.parse(seeded)).toThrow();

    stubOneLiveEvent();
    const r2 = new FakeR2Bucket();
    const seededBody = guardPassingCorruptTeamArtifact("frc1");
    r2.seed(TEAM_PUT_KEY, seededBody);
    const result = await runTick(makeEnv(makeKv([LIVE_WINDOW]), new FakeD1Database(), r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);

    expect(r2.puts.filter((p) => p.key === TEAM_PUT_KEY)).toHaveLength(0);
    // Byte-identical: not merged, not rewritten, not repaired.
    expect(await (await r2.get(TEAM_PUT_KEY))!.text()).toBe(seededBody);
  });

  it("live block: a corrupt block is dropped at read and republished fresh, in the SAME single event put", async () => {
    stubOneLiveEvent();
    const r2 = new FakeR2Bucket();
    // A published event body whose `live` value is well-formed JSON of the
    // wrong shape — the exact case the read guard must turn into "the key is
    // gone" rather than "the artifact is unusable". Rejecting the artifact
    // would cost this event its whole published history on every tick.
    r2.seed(EVENT_PUT_KEY, JSON.stringify({ ...(JSON.parse(guardPassingBaseEventArtifact("2026casj")) as object), live: { metricKeys: ["total"], rows: "not an array" } }));
    const result = await runTick(makeEnv(makeKv([LIVE_WINDOW]), new FakeD1Database(), r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);

    // ONE put, not two: there is no second object to republish.
    const eventPuts = r2.puts.filter((p) => p.key === EVENT_PUT_KEY);
    expect(eventPuts).toHaveLength(1);
    const published = LiveEventArtifactSchema.parse(JSON.parse(eventPuts[0]!.body));
    expect(published.live?.rows.map((row) => row.m)).toEqual(["2026casj_qm1"]);
  });

  it("live block: unparseable event bytes bootstrap the whole artifact rather than failing the event", async () => {
    stubOneLiveEvent();
    const r2 = new FakeR2Bucket();
    r2.seed(EVENT_PUT_KEY, "{not json at all");
    const result = await runTick(makeEnv(makeKv([LIVE_WINDOW]), new FakeD1Database(), r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);
    const eventPuts = r2.puts.filter((p) => p.key === EVENT_PUT_KEY);
    expect(eventPuts).toHaveLength(1);
    const published = LiveEventArtifactSchema.parse(JSON.parse(eventPuts[0]!.body));
    expect(published.live?.rows.map((row) => row.m)).toEqual(["2026casj_qm1"]);
  });

  it("event: a guard-passing, write-failing event artifact is republished as a valid bootstrap", async () => {
    const seeded = JSON.parse(guardPassingCorruptEventArtifact("2026casj")) as unknown;
    expect(checkLiveEventArtifactShape(seeded)).toBeDefined();
    expect(() => LiveEventArtifactSchema.parse(seeded)).toThrow();

    stubOneLiveEvent();
    const clean = new FakeR2Bucket();
    await runTick(makeEnv(makeKv([LIVE_WINDOW]), new FakeD1Database(), clean), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    const r2 = new FakeR2Bucket();
    r2.seed(EVENT_PUT_KEY, guardPassingCorruptEventArtifact("2026casj"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runTick(makeEnv(makeKv([LIVE_WINDOW]), new FakeD1Database(), r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    const eventPuts = r2.puts.filter((p) => p.key === EVENT_PUT_KEY);
    expect(eventPuts).toHaveLength(1);
    expect(r2.putCallCount).toBe(clean.putCallCount);

    const published = LiveEventArtifactSchema.parse(JSON.parse(eventPuts[0]!.body));
    expect(published).not.toHaveProperty("name"); // the corrupt numeric `name` is gone, not carried
    expect(published.matches.map((m) => m.matchKey)).toEqual(["2026casj_qm1"]);

    const retryLogs = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("artifact-write-schema-retry"));
    warn.mockRestore();
    expect(retryLogs).toHaveLength(1);
    expect((JSON.parse(retryLogs[0]!) as Record<string, unknown>).page).toBe("event");
  });

  it("a FAILING PUT is not retried — the retry is for validation failures only, or it would double-consume a subrequest", async () => {
    stubOneLiveEvent();
    const r2 = new FakeR2Bucket();
    r2.rejectPutsWith = new Error("simulated R2 put failure");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runTick(makeEnv(makeKv([LIVE_WINDOW]), new FakeD1Database(), r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    const retryLogs = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("artifact-write-schema-retry"));
    warn.mockRestore();

    // ONE attempt. `writeArtifactObject` consumes the budget BEFORE the put, so
    // a post-consume failure retried would spend a second subrequest on one
    // artifact and break the per-tick accounting `scheduled.rp.test.ts` pins at
    // 64. The consumed-budget check in `writeArtifactWithBootstrapRetry` is the
    // exact witness that distinguishes this case from a validation failure.
    expect(r2.putCallCount).toBe(1);
    expect(retryLogs).toHaveLength(0);
  });

  it("a healthy tick logs no retry at all — the retry is a failure path, not a steady-state cost", async () => {
    stubOneLiveEvent();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runTick(makeEnv(makeKv([LIVE_WINDOW]), new FakeD1Database(), new FakeR2Bucket()), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    const retryLogs = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("artifact-write-schema-retry"));
    warn.mockRestore();
    expect(retryLogs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Probe windows for zero-match events (260920-lny). An `inferred: true`
// window's liveness is unproven -- the tick must answer it with one cheap
// conditional TBA request and stop, never the full expensive live path, or
// the 2026-08-29 outage's cause B recurs
// (`.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md`).
// ---------------------------------------------------------------------------

describe("runTick — the tick probes a probe window", () => {
  const PROBE_WINDOW: WindowFixture = { eventKey: "2026probe", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000, inferred: true };

  it("OUTAGE GUARD: a 304 on the only live (probe) window does zero D1 batches and zero R2 puts, never reads the algorithms manifest, and never builds algorithm modules", async () => {
    const kv = makeKv([PROBE_WINDOW]);
    const sharedLog: SharedLogEntry[] = [];
    const d1 = new FakeD1Database(sharedLog);
    const r2 = new FakeR2Bucket(sharedLog);
    const fetchMock = vi.fn(async () => ({ status: 304, ok: false, headers: new Map(), json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    let constructionCount = 0;
    const { buildAlgorithmModules: realBuildAlgorithmModules } = await import("../src/scheduled.js");
    const countingBuilder = (manifest: Parameters<typeof realBuildAlgorithmModules>[0], ids: Parameters<typeof realBuildAlgorithmModules>[1]) => {
      constructionCount++;
      return realBuildAlgorithmModules(manifest, ids);
    };

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, buildAlgorithmModules: countingBuilder, ...DISABLE_GLOBAL_REBUILD });

    expect(sharedLog.filter((e) => e.type === "d1-batch")).toHaveLength(0);
    expect(sharedLog.filter((e) => e.type === "r2-put")).toHaveLength(0);
    expect(kv.getCallCount).toBe(1); // only v1/manifest/live-windows.json -- never v1/manifest/algorithms.json
    expect(constructionCount).toBe(0);
    expect(result).toMatchObject({ eventsConsidered: 0, eventsAdvanced: 0, eventsFailed: 0, eventsProbed: 1, eventsPromoted: 0 });
  });

  it("OUTAGE GUARD: an empty match array on the only live (probe) window does zero D1 batches and zero R2 puts", async () => {
    const kv = makeKv([PROBE_WINDOW]);
    const sharedLog: SharedLogEntry[] = [];
    const d1 = new FakeD1Database(sharedLog);
    const r2 = new FakeR2Bucket(sharedLog);
    const tbaEvents = new Map([["2026probe", { etag: "probe-etag-1", eventType: 99, season: SEASON, matches: [] as unknown[] }]]);
    vi.stubGlobal("fetch", makeTbaFetchStub(tbaEvents));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(sharedLog.filter((e) => e.type === "d1-batch")).toHaveLength(0);
    expect(sharedLog.filter((e) => e.type === "r2-put")).toHaveLength(0);
    expect(kv.getCallCount).toBe(1);
    expect(result).toMatchObject({ eventsConsidered: 0, eventsAdvanced: 0, eventsFailed: 0, eventsProbed: 1, eventsPromoted: 0 });
  });

  it("promotes a probe window that sees a played match: the normal live path runs, exactly one artifact put, and tbaRequests is 1 — the probe's own poll was not repeated", async () => {
    const kv = makeKv([PROBE_WINDOW]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const record = twoMatchEventRecord("2026probe", "probe-matches-etag-1");

    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/event/2026probe/matches")) {
        return { status: 200, ok: true, headers: { get: (name: string) => (name === "etag" ? record.etag : null) }, json: async () => record.matches };
      }
      // The event-detail fetch 404s and processEvent degrades gracefully
      // (eventType -1, week null): tbaFetch throws BEFORE recording a 404 to
      // the counter, so tbaRequests stays 1 (the matches poll alone),
      // proving the probe's own poll was never repeated by processEvent.
      if (u.endsWith("/event/2026probe")) {
        return { status: 404, ok: false, headers: new Map(), json: async () => ({}) };
      }
      throw new Error(`unexpected URL in promotion stub: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);
    expect(result.eventsProbed).toBe(1);
    expect(result.eventsPromoted).toBe(1);
    expect(result.tbaRequests).toBe(1);
    const eventPutKey = artifactKey({ page: "event", eventKey: "2026probe", algorithmId: "opr", version: opr.version });
    // Since quick task 260921-5qw a FIRST fold also writes the event's live roster, the tiny object a
    // robot page finds a promoted event through. It is one object per EVENT, not per algorithm, and it
    // is written only when the roster grew, so never on an ordinary tick.
    expect(r2.puts.map((p) => p.key).sort()).toEqual([eventPutKey, liveRosterKey("2026probe")].sort());
  });

  it("a tick with one foldable window and one probe window still folds the foldable event", async () => {
    const foldableWindow: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([foldableWindow, PROBE_WINDOW]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();

    const fetchMock = vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
      const u = String(url);
      if (u.includes("/event/2026probe/")) {
        return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
      }
      const stub = makeTbaFetchStub(new Map([["2026casj", twoMatchEventRecord("2026casj", "etag-1")]]));
      const stubFn = stub as unknown as (url: unknown, init?: { headers?: Record<string, string> }) => Promise<unknown>;
      return stubFn(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsConsidered).toBe(1); // the foldable event only -- a probe is never "considered"
    expect(result.eventsProbed).toBe(1);
    expect(result.eventsPromoted).toBe(0);
    const eventPutKey = artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "opr", version: opr.version });
    expect(r2.puts.some((p) => p.key === eventPutKey)).toBe(true);
  });

  it("BOUND: probes at most MAX_PROBES_PER_TICK, and a tick one cron minute later covers a different rotated slice", async () => {
    const probeKeys = Array.from({ length: MAX_PROBES_PER_TICK + 2 }, (_, i) => `2026probe${i}`);
    const windows: WindowFixture[] = probeKeys.map((eventKey) => ({ eventKey, season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000, inferred: true }));

    function stubAlways304(calls: string[]): ReturnType<typeof vi.fn> {
      return vi.fn(async (url: unknown) => {
        const u = String(url);
        const m = /\/event\/([^/]+)\/matches$/.exec(u);
        if (!m) throw new Error(`unexpected URL in probe-bound stub: ${u}`);
        calls.push(m[1]!);
        return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
      });
    }

    const tick1Calls: string[] = [];
    vi.stubGlobal("fetch", stubAlways304(tick1Calls));
    const tick1 = await runTick(makeEnv(makeKv(windows), new FakeD1Database(), new FakeR2Bucket()), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    vi.unstubAllGlobals();

    expect(tick1.eventsProbed).toBe(MAX_PROBES_PER_TICK);
    expect(tick1Calls).toHaveLength(MAX_PROBES_PER_TICK);

    const tick2Calls: string[] = [];
    vi.stubGlobal("fetch", stubAlways304(tick2Calls));
    const tick2 = await runTick(makeEnv(makeKv(windows), new FakeD1Database(), new FakeR2Bucket()), { nowMs: NOW_MS + PROBE_ROTATION_PERIOD_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(tick2.eventsProbed).toBe(MAX_PROBES_PER_TICK);
    expect(new Set(tick2Calls)).not.toEqual(new Set(tick1Calls)); // a different rotated slice
  });
});
