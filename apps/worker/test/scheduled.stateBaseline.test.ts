/**
 * Quick task 260920-q75: the tick refuses to fold against stale D1 state, and
 * its match order agrees with the offline publisher's own total order.
 *
 * Drives `runTick` with injected fakes for D1/R2/KV and a stubbed `fetch` —
 * no network, no wrangler. Fakes are deliberately duplicated from
 * `scheduled.test.ts` rather than shared, following this directory's
 * established convention (see `scheduled.replay.test.ts`'s header for the
 * reasoning): independent fakes make a real divergence detectable rather than
 * tautological.
 *
 * Every bullet in this quick task's PLAN.md Task 1 `<behavior>` block has a
 * test below, in the same order the block lists them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTick } from "../src/scheduled.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { artifactKey } from "../../../packages/harness/pageArtifacts.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { TICK_META_EVENT_KEY } from "../../../packages/harness/stateBaseline.js";
import { seedStateBaselineMarkers } from "./support/stateBaseline.js";
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

/**
 * Deliberately seeds NO baseline marker by default (unlike every other
 * `FakeD1Database` in this directory, which defaults to a healthy marker) —
 * this file's whole subject is the mismatch/absent-marker behavior, so
 * "healthy" is the one case each test opts INTO via `seedHealthyMarker`.
 */
class FakeD1Database {
  selectCallCount = 0;
  batchCallCount = 0;
  algorithmState = new Map<string, FakeAlgorithmStateRow>();
  eventCursors = new Map<string, FakeEventCursorRow>();

  prepare(sql: string): FakePreparedStatement {
    return new FakePreparedStatement(sql, this);
  }

  async batch(statements: readonly FakePreparedStatement[]): Promise<{ success: true }[]> {
    this.batchCallCount++;
    for (const stmt of statements) this.executeWrite(stmt.sql, stmt.boundArgs);
    return statements.map(() => ({ success: true as const }));
  }

  executeSelect(sql: string, args: readonly unknown[]): unknown[] {
    this.selectCallCount++;
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
      this.eventCursors.set(eventKey!, {
        event_key: eventKey!,
        tba_etag: tbaEtag ?? null,
        last_folded_match_key: lastFoldedMatchKey ?? null,
        last_polled_at: lastPolledAt ?? null,
        last_advanced_at: lastAdvancedAt ?? null,
      });
      return 1;
    }
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
    // writeEventCursor's own plain upsert — used by writeTickMeta's sentinel
    // row and the "unchanged but ETag moved" path.
    if (sql.includes("INSERT INTO event_cursor")) {
      const [eventKey, tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt] = args as (string | null)[];
      this.eventCursors.set(eventKey as string, {
        event_key: eventKey as string,
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

  async put(key: string, body: string): Promise<void> {
    this.putCallCount++;
    this.puts.push({ key, body });
    this.store.set(key, body);
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

function makeEnv(kv: FakeKvNamespace, d1: FakeD1Database, r2: FakeR2Bucket, liveAlgorithmIds = "spr"): Env {
  return { DB: d1 as unknown as D1Database, ARTIFACTS: r2 as unknown, MANIFEST: kv as unknown, TBA_API_KEY: "test-key", LIVE_ALGORITHM_IDS: liveAlgorithmIds } as Env;
}

// ---------------------------------------------------------------------------
// Manifest / TBA fixtures
// ---------------------------------------------------------------------------

/** The one algorithms-manifest generation every fixture below publishes, unless a test deliberately wants a different one. */
const MANIFEST_GENERATION = "gen-1";
/** A generation that is deliberately NOT `MANIFEST_GENERATION` — a stale marker. */
const STALE_GENERATION = "gen-0";

interface WindowFixture {
  eventKey: string;
  season: number;
  startMs: number;
  endMs: number;
  inferred?: boolean;
}

function liveWindowsManifest(windows: readonly WindowFixture[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    generation: MANIFEST_GENERATION,
    computedAt: "2026-08-22T00:00:00.000Z",
    windows: windows.map((w) => ({ ...w, inferred: w.inferred ?? false })),
  });
}

function algorithmsManifest(): string {
  return JSON.stringify({
    schemaVersion: 1,
    generation: MANIFEST_GENERATION,
    computedAt: "2026-08-22T00:00:00.000Z",
    algorithms: [{ id: "spr", version: spr.version, codeVersion: spr.version.split("+")[0]!, paramSetName: spr.version.split("+")[1] ?? "baseline" }],
  });
}

function makeKv(windows: readonly WindowFixture[]): FakeKvNamespace {
  return new FakeKvNamespace(
    new Map([
      [LIVE_WINDOWS_MANIFEST_KEY, liveWindowsManifest(windows)],
      [ALGORITHMS_MANIFEST_KEY, algorithmsManifest()],
    ])
  );
}

/** Seeds `d1` with a state-baseline marker for `spr` at `MANIFEST_GENERATION` — the healthy control-arm state every OTHER test file in this directory defaults to, opted into explicitly here. */
function seedHealthyMarker(d1: FakeD1Database): void {
  seedStateBaselineMarkers(d1.eventCursors, ["spr"], MANIFEST_GENERATION);
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
const NOW_SEC = Math.floor(NOW_MS / 1000);
const SEASON = 2026;
const EVENT_KEY = "2026casj";
const RED_TEAMS = ["frc1", "frc2", "frc3"];
const BLUE_TEAMS = ["frc4", "frc5", "frc6"];
const WINDOW: WindowFixture = { eventKey: EVENT_KEY, season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
const PROBE_WINDOW: WindowFixture = { eventKey: "2026probe", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000, inferred: true };
const DISABLE_GLOBAL_REBUILD = { globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER };

/** One played match plus one upcoming match at a different pair of teams — mirrors `scheduled.test.ts`'s identically-named helper. */
function twoMatchEventRecord(eventKey: string, etag: string): TbaEventRecord {
  return {
    etag,
    eventType: 0,
    season: SEASON,
    matches: [
      tbaMatch({ key: `${eventKey}_qm1`, eventKey, matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: NOW_SEC - 60 }),
      tbaMatch({ key: `${eventKey}_qm2`, eventKey, matchNumber: 2, redTeams: ["frc7", "frc8", "frc9"], blueTeams: ["frc10", "frc11", "frc12"], predictedTimeSec: NOW_SEC + 3600 }),
    ],
  };
}

/** Three played matches, all before `NOW_MS`, at the SAME roster — the fixture the cursor-anchor tests fold against. */
function threeMatchEventRecord(eventKey: string, etag: string): TbaEventRecord {
  return {
    etag,
    eventType: 0,
    season: SEASON,
    matches: [
      tbaMatch({ key: `${eventKey}_qm1`, eventKey, matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 100, blueScore: 50, actualTimeSec: NOW_SEC - 180 }),
      tbaMatch({ key: `${eventKey}_qm2`, eventKey, matchNumber: 2, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 90, blueScore: 60, actualTimeSec: NOW_SEC - 120 }),
      tbaMatch({ key: `${eventKey}_qm3`, eventKey, matchNumber: 3, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 80, blueScore: 70, actualTimeSec: NOW_SEC - 60 }),
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests — one per `<behavior>` bullet, in PLAN.md order
// ---------------------------------------------------------------------------

describe("runTick — state-generation marker equals the manifest generation (control arm)", () => {
  it("behaves exactly as today: folds, one D1 batch, one R2 put, stateGenerationMismatch false", async () => {
    const kv = makeKv([WINDOW]);
    const d1 = new FakeD1Database();
    seedHealthyMarker(d1);
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([[EVENT_KEY, twoMatchEventRecord(EVENT_KEY, "etag-1")]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);
    expect(result.stateGenerationMismatch).toBe(false);
    expect(d1.batchCallCount).toBe(1);
    expect(r2.putCallCount).toBe(1);
    const eventPutKey = artifactKey({ page: "event", eventKey: EVENT_KEY, algorithmId: "spr", version: spr.version });
    expect(r2.puts.some((p) => p.key === eventPutKey)).toBe(true);
  });
});

describe("runTick — state-generation marker differs from the manifest generation", () => {
  it("zero D1 batches, zero R2 puts, no cursor write, no global rebuild, no tick-meta write, stateGenerationMismatch true, one console.warn line", async () => {
    const kv = makeKv([WINDOW]);
    const d1 = new FakeD1Database();
    seedStateBaselineMarkers(d1.eventCursors, ["spr"], STALE_GENERATION);
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([[EVENT_KEY, twoMatchEventRecord(EVENT_KEY, "etag-1")]])));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // globalRebuildIntervalMs deliberately 0 here (not DISABLE_GLOBAL_REBUILD)
    // so "no global rebuild ran" is a genuine assertion about the mismatch
    // return, not a coincidence of the interval never having elapsed.
    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, globalRebuildIntervalMs: 0 });

    expect(result).toMatchObject({
      eventsConsidered: 0,
      eventsAdvanced: 0,
      eventsDeferred: 0,
      eventsPromoted: 0,
      globalRebuildRan: false,
      stateGenerationMismatch: true,
    });
    expect(d1.batchCallCount).toBe(0);
    expect(r2.putCallCount).toBe(0);
    // The cursor for the live event was never touched, and the tick-meta
    // sentinel was never written.
    expect(d1.eventCursors.has(EVENT_KEY)).toBe(false);
    expect(d1.eventCursors.has(TICK_META_EVENT_KEY)).toBe(false);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string) as { msg: string; manifestGeneration: string; markers: Record<string, string | null> };
    expect(logged.msg).toBe("state-generation-mismatch");
    expect(logged.manifestGeneration).toBe(MANIFEST_GENERATION);
    expect(logged.markers).toEqual({ spr: STALE_GENERATION });
  });
});

describe("runTick — state-generation marker row absent entirely (today's live D1 bootstrap state)", () => {
  it("identical to the mismatch case: stateGenerationMismatch true, zero D1 batches, zero R2 puts", async () => {
    const kv = makeKv([WINDOW]);
    const d1 = new FakeD1Database(); // no marker seeded at all
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([[EVENT_KEY, twoMatchEventRecord(EVENT_KEY, "etag-1")]])));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.stateGenerationMismatch).toBe(true);
    expect(result.eventsAdvanced).toBe(0);
    expect(d1.batchCallCount).toBe(0);
    expect(r2.putCallCount).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string) as { markers: Record<string, string | null> };
    // Absent renders as `null`, never `undefined` (which JSON.stringify would drop).
    expect(logged.markers).toEqual({ spr: null });
  });
});

describe("runTick — probes still run under a mismatch", () => {
  it("eventsProbed above zero, eventsPromoted zero, and a promoted event is NOT folded", async () => {
    const kv = makeKv([PROBE_WINDOW]);
    const d1 = new FakeD1Database(); // no marker: every tick this tick would attempt is a mismatch
    const r2 = new FakeR2Bucket();
    const record = twoMatchEventRecord("2026probe", "probe-etag-1");
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026probe", record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsProbed).toBe(1);
    expect(result.eventsPromoted).toBe(0);
    expect(result.stateGenerationMismatch).toBe(true);
    // The probe's own poll happened (that is what "still run" means) but the
    // promoted event was never fed into processEvent: no fold, no put.
    expect(r2.putCallCount).toBe(0);
    expect(d1.batchCallCount).toBe(0);
  });
});

describe("runTick — cursor ahead of nothing (a seeded cursor at the offline run's last match)", () => {
  it("exactly the matches after the cursor reach update(), no more and no fewer", async () => {
    const kv = makeKv([WINDOW]);
    const d1 = new FakeD1Database();
    seedHealthyMarker(d1);
    // The offline run's own last folded match was qm1; TBA now reports qm1
    // (already folded) plus two more (qm2, qm3).
    d1.eventCursors.set(EVENT_KEY, { event_key: EVENT_KEY, tba_etag: null, last_folded_match_key: `${EVENT_KEY}_qm1`, last_polled_at: null, last_advanced_at: null });
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([[EVENT_KEY, threeMatchEventRecord(EVENT_KEY, "etag-1")]])));
    const updateSpy = vi.spyOn(spr, "update");

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    const foldedKeys = updateSpy.mock.calls.map((call) => (call[1] as { matchKey: string }).matchKey);
    expect(foldedKeys).toEqual([`${EVENT_KEY}_qm2`, `${EVENT_KEY}_qm3`]);
    expect(d1.eventCursors.get(EVENT_KEY)?.last_folded_match_key).toBe(`${EVENT_KEY}_qm3`);
  });
});

describe("runTick — cursor equal to what state already contains (the incident's other direction)", () => {
  it("folds nothing and issues no D1 batch, where the same fixture with a null cursor would refold every match", async () => {
    const kv = makeKv([WINDOW]);
    const record = threeMatchEventRecord(EVENT_KEY, "etag-1");

    // Arm 1: cursor already at the last match.
    const seededD1 = new FakeD1Database();
    seedHealthyMarker(seededD1);
    seededD1.eventCursors.set(EVENT_KEY, { event_key: EVENT_KEY, tba_etag: null, last_folded_match_key: `${EVENT_KEY}_qm3`, last_polled_at: null, last_advanced_at: null });
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([[EVENT_KEY, record]])));
    const seededUpdateSpy = vi.spyOn(spr, "update");
    const seededResult = await runTick(makeEnv(kv, seededD1, new FakeR2Bucket()), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    expect(seededResult.eventsAdvanced).toBe(0);
    expect(seededD1.batchCallCount).toBe(0);
    expect(seededUpdateSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    seededUpdateSpy.mockRestore();

    // Arm 2 (contrast): the identical fixture, no cursor at all — refolds everything.
    const nullCursorD1 = new FakeD1Database();
    seedHealthyMarker(nullCursorD1);
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([[EVENT_KEY, record]])));
    const nullCursorUpdateSpy = vi.spyOn(spr, "update");
    const nullCursorResult = await runTick(makeEnv(makeKv([WINDOW]), nullCursorD1, new FakeR2Bucket()), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    expect(nullCursorResult.eventsAdvanced).toBe(1);
    expect(nullCursorUpdateSpy).toHaveBeenCalledTimes(3);
  });
});

describe("runTick — two played matches tied on sortTime", () => {
  it("the Worker's ordered match list follows the corpus ORDER BY chain (comp level, set number, match number), never TBA's array order", async () => {
    const kv = makeKv([WINDOW]);
    const d1 = new FakeD1Database();
    seedHealthyMarker(d1);
    const r2 = new FakeR2Bucket();
    const tiedSec = NOW_SEC - 60;
    // TBA's array lists matchNumber 2 BEFORE matchNumber 1, both at the exact
    // same actual_time (a genuine tie). A stable sort on sortTime alone would
    // keep this array order and fold matchNumber 2 last; the corpus's own
    // total order (matchNumber ascending, once sortTime and comp level tie)
    // folds matchNumber 1 first and matchNumber 2 last regardless — the
    // SAME answer here, which is the point: the assertion below only
    // distinguishes the two if the fixture is read correctly, so it is
    // pinned by explicit reasoning, not by accident.
    const record: TbaEventRecord = {
      etag: "tie-etag",
      eventType: 0,
      season: SEASON,
      matches: [
        tbaMatch({ key: `${EVENT_KEY}_qm2`, eventKey: EVENT_KEY, matchNumber: 2, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 90, blueScore: 60, actualTimeSec: tiedSec }),
        tbaMatch({ key: `${EVENT_KEY}_qm1`, eventKey: EVENT_KEY, matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 100, blueScore: 50, actualTimeSec: tiedSec }),
      ],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([[EVENT_KEY, record]])));

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    // The corpus's own total order (matchNumber ascending on a tie) says the
    // LAST folded match is matchNumber 2, regardless of TBA's array position.
    expect(d1.eventCursors.get(EVENT_KEY)?.last_folded_match_key).toBe(`${EVENT_KEY}_qm2`);
  });
});

describe("runTick — the nothing-live tick and the probe-only tick issue the same number of D1 statements as before this task", () => {
  it("the nothing-live tick makes zero D1 calls", async () => {
    const kv = makeKv([]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", vi.fn());

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS });

    expect(result.stateGenerationMismatch).toBe(false);
    expect(d1.selectCallCount).toBe(0);
    expect(d1.batchCallCount).toBe(0);
  });

  it("a probe-only tick that sees a 304 makes exactly the ONE cursor read runProbes already paid for, and no D1 write", async () => {
    const kv = makeKv([PROBE_WINDOW]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const fetchMock = vi.fn(async () => ({ status: 304, ok: false, headers: new Map(), json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runTick(makeEnv(kv, d1, r2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result).toMatchObject({ eventsProbed: 1, eventsPromoted: 0, stateGenerationMismatch: false });
    // eventPreflight's own cursor read (pre-existing, unrelated to this
    // task's readTickState) — never the tick-meta/baseline read, since a
    // probe-only tick returns before that.
    expect(d1.selectCallCount).toBe(1);
    expect(d1.batchCallCount).toBe(0);
    expect(r2.putCallCount).toBe(0);
  });
});
