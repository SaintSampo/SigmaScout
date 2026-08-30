/**
 * Quick task 260822-wqt (D-04 regression fix): the guard that stops the
 * live-folding-defers-forever defect from being rediscovered during a future
 * event weekend. `processEvent`'s `estimatedCost` for ONE ordinary 3v3 match
 * (6 touched teams) is 50 with all three published algorithms live, against
 * ~41 subrequests actually available per tick — that estimate never clears,
 * so the event defers every tick, forever (measured on the deployed Worker
 * during plan 04-07, recorded in `docs/publish-budget.md`'s "Worker runtime
 * budget" section). This file asserts, against the REAL exported formula
 * (`estimateEventSubrequestCost`) and the REAL exported constants
 * (`TICK_FIXED_SUBREQUEST_COST`, `EVENT_PREFLIGHT_SUBREQUEST_COST`) — never a
 * re-typed copy of the arithmetic, which is precisely how this defect
 * survived four plans undetected — that the tracked `LIVE_ALGORITHM_IDS`
 * value in `wrangler.toml` fits the measured per-tick budget, that a live
 * tier of all three does not, that only the live tier actually folds, and
 * that the three decided misconfiguration behaviors (default+warn / throw /
 * throw) are exactly what's implemented.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runTick,
  buildAlgorithmModules,
  parseLiveAlgorithmIds,
  DEFAULT_LIVE_ALGORITHM_IDS,
  estimateEventSubrequestCost,
  TICK_FIXED_SUBREQUEST_COST,
  EVENT_PREFLIGHT_SUBREQUEST_COST,
  UnknownLiveAlgorithmIdError,
  EmptyLiveAlgorithmTierError,
} from "../src/scheduled.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { artifactKey } from "../../../packages/harness/pageArtifacts.js";
import { AlgorithmsManifestSchema } from "../../../packages/harness/manifestSchemas.js";
import { SubrequestBudget } from "../src/subrequestBudget.js";
import type { Env } from "../src/env.js";
import type { D1Database } from "@cloudflare/workers-types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// wrangler.toml reader — same shape `scripts/secrets-boundary.test.ts`
// already uses to read a tracked repo file with `readFileSync` +
// `fileURLToPath`/`resolve`.
// ---------------------------------------------------------------------------

/** Extracts a plain `KEY = "value"` assignment from `wrangler.toml`'s `[vars]` block, dropping comment lines BEFORE matching — a `#`-prefixed line that happens to name the key must not be able to satisfy the match. */
function extractVarsValue(tomlContent: string, key: string): string | null {
  const assignment = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`);
  for (const rawLine of tomlContent.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("#")) continue; // drop comment lines before matching
    const match = assignment.exec(line);
    if (match) return match[1]!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fakes — deliberately duplicated from `scheduled.test.ts` rather than
// shared (this codebase's own established precedent, see
// `scheduled.replay.test.ts`'s header for the identical reasoning): keeping
// each test file's fakes independent is what makes a real divergence
// detectable rather than tautological.
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
  constructor(private readonly values: Map<string, string>) {}
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
}

function makeEnv(kv: FakeKvNamespace, d1: FakeD1Database, r2: FakeR2Bucket, liveAlgorithmIds?: string): Env {
  return {
    DB: d1 as unknown as D1Database,
    ARTIFACTS: r2 as unknown,
    MANIFEST: kv as unknown,
    TBA_API_KEY: "test-key",
    TBA_BASE_URL: "https://tba.example.invalid/api/v3",
    LIVE_ALGORITHM_IDS: liveAlgorithmIds,
  } as Env;
}

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
    if (id === "opr") return { id: "opr", version: "3.0.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" };
    if (id === "epa") return { id: "epa", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" };
    return { id: "vpr", version: "2.1.0+test", codeVersion: "2.0.0", paramSetName: "test" };
  });
  return JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", algorithms });
}

function makeKv(windows: readonly WindowFixture[], algorithmIds: readonly string[] = ["opr", "epa", "vpr"]): FakeKvNamespace {
  return new FakeKvNamespace(
    new Map([
      [LIVE_WINDOWS_MANIFEST_KEY, liveWindowsManifest(windows)],
      [ALGORITHMS_MANIFEST_KEY, algorithmsManifest(algorithmIds)],
    ])
  );
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

/** One played match plus one unplayed "upcoming" match at a DIFFERENT pair of teams (mirrors `scheduled.test.ts`'s identically-named helper). */
function twoMatchEventRecord(eventKey: string, etag: string): TbaEventRecord {
  return {
    etag,
    eventType: 0,
    season: SEASON,
    matches: [
      tbaMatch({ key: `${eventKey}_qm1`, eventKey, matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 }),
      tbaMatch({ key: `${eventKey}_qm2`, eventKey, matchNumber: 2, redTeams: ["frc7", "frc8", "frc9"], blueTeams: ["frc10", "frc11", "frc12"], predictedTimeSec: Math.floor(NOW_MS / 1000) + 3600 }),
    ],
  };
}

const DISABLE_GLOBAL_REBUILD = { globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER };

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("liveAlgorithmTier — tracked config's live tier fits the measured budget", () => {
  it("wrangler.toml's LIVE_ALGORITHM_IDS estimatedCost is within the usable per-tick subrequest budget", () => {
    const wranglerTomlPath = resolve(__dirname, "../wrangler.toml");
    const content = readFileSync(wranglerTomlPath, "utf-8");
    const rawValue = extractVarsValue(content, "LIVE_ALGORITHM_IDS");
    expect(rawValue, `LIVE_ALGORITHM_IDS not found in ${wranglerTomlPath}'s [vars] block`).not.toBeNull();

    const ids = parseLiveAlgorithmIds(rawValue!);
    const usable = new SubrequestBudget().usableCap - TICK_FIXED_SUBREQUEST_COST - EVENT_PREFLIGHT_SUBREQUEST_COST;
    const estimated = estimateEventSubrequestCost(ids.length, 6);

    expect(
      estimated,
      `LIVE_ALGORITHM_IDS="${ids.join(",")}" estimates ${estimated} subrequests for one ordinary 3v3 match ` +
        `(6 touched teams), which exceeds the ~${usable} actually available per tick (SUBREQUEST_CAP 50, ` +
        `SUBREQUEST_RESERVE 4, minus ${TICK_FIXED_SUBREQUEST_COST} tick-fixed + ${EVENT_PREFLIGHT_SUBREQUEST_COST} ` +
        "event-preflight costs). See docs/publish-budget.md's \"Worker runtime budget (D-21/D-23, plan 04-07)\" " +
        "section for the measured arithmetic this regression guard protects — with all three algorithms live, " +
        "the event defers every tick, forever."
    ).toBeLessThanOrEqual(usable);
  });

  it("the counterfactual: three live algorithms exceed the same usable budget for one ordinary match (pins WHY vpr-only was chosen)", () => {
    const usable = new SubrequestBudget().usableCap - TICK_FIXED_SUBREQUEST_COST - EVENT_PREFLIGHT_SUBREQUEST_COST;
    // If this assertion ever fails because Phase B's per-team cost shape
    // genuinely improved, that is the signal to re-evaluate LIVE_ALGORITHM_IDS
    // against a fresh measurement on a deployed Worker — not to delete this
    // test.
    expect(estimateEventSubrequestCost(3, 6)).toBeGreaterThan(usable);
  });
});

describe("liveAlgorithmTier — the fixed-cost constants are real, not declared", () => {
  it("a tick that considers one live event and finds it unchanged spends exactly TICK_FIXED_SUBREQUEST_COST + EVENT_PREFLIGHT_SUBREQUEST_COST + 1 (the tick-meta write)", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window], ["vpr"]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (/\/event\/[^/]+\/matches$/.test(u)) {
        return { status: 304, ok: false, headers: new Map(), json: async () => ({}) };
      }
      throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv(kv, d1, r2, "vpr");

    const result = await runTick(env, { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsFailed).toBe(0);
    expect(result.subrequestsUsed).toBe(TICK_FIXED_SUBREQUEST_COST + EVENT_PREFLIGHT_SUBREQUEST_COST + 1);
  });
});

describe("liveAlgorithmTier — only the live tier folds", () => {
  it("with a three-entry algorithms manifest and LIVE_ALGORITHM_IDS=vpr, an advancing tick writes only vpr artifacts/state and touches no opr/epa artifact or algorithm_state row", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const kv = makeKv([window], ["opr", "epa", "vpr"]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const tbaEvents = new Map([["2026casj", twoMatchEventRecord("2026casj", "etag-1")]]);
    vi.stubGlobal("fetch", makeTbaFetchStub(tbaEvents));
    const env = makeEnv(kv, d1, r2, "vpr");

    const result = await runTick(env, { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);

    // FakeD1Database.algorithmState keys are `${algorithmId}::${scopeKind}::${scopeKey}`.
    const stateAlgorithmIds = new Set([...d1.algorithmState.keys()].map((k) => k.split("::")[0]));
    expect(stateAlgorithmIds.has("vpr")).toBe(true);
    expect(stateAlgorithmIds.has("opr")).toBe(false);
    expect(stateAlgorithmIds.has("epa")).toBe(false);

    // artifactKey's shape ends every path segment with `{algorithmId}@{version}.json`.
    expect(r2.puts.some((p) => p.key.includes("/vpr@"))).toBe(true);
    expect(r2.puts.some((p) => p.key.includes("/opr@"))).toBe(false);
    expect(r2.puts.some((p) => p.key.includes("/epa@"))).toBe(false);

    const vprEventKey = artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "vpr", version: "2.1.0+test" });
    expect(r2.puts.some((p) => p.key === vprEventKey)).toBe(true);
    for (const teamKey of ALL_TEAMS) {
      const vprTeamKey = artifactKey({ page: "team", teamKey, year: SEASON, algorithmId: "vpr", version: "2.1.0+test" });
      expect(r2.puts.some((p) => p.key === vprTeamKey)).toBe(true);
    }
  });
});

describe("liveAlgorithmTier — the three decided misconfiguration behaviors", () => {
  it("unset or empty defaults to vpr and emits a structured live-tier-defaulted warn line", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseLiveAlgorithmIds(undefined)).toEqual([...DEFAULT_LIVE_ALGORITHM_IDS]);
      expect(parseLiveAlgorithmIds("")).toEqual([...DEFAULT_LIVE_ALGORITHM_IDS]);
      expect(parseLiveAlgorithmIds("  ,  ,")).toEqual([...DEFAULT_LIVE_ALGORITHM_IDS]);
      expect(warnSpy).toHaveBeenCalledTimes(3);
      for (const call of warnSpy.mock.calls) {
        const parsed = JSON.parse(call[0] as string) as { msg: string; ids: string[] };
        expect(parsed.msg).toBe("live-tier-defaulted");
        expect(parsed.ids).toEqual([...DEFAULT_LIVE_ALGORITHM_IDS]);
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("an id not in PUBLISHED_ALGORITHM_IDS throws UnknownLiveAlgorithmIdError naming the accepted ids", () => {
    expect(() => parseLiveAlgorithmIds("sigma7")).toThrow(UnknownLiveAlgorithmIdError);
    expect(() => parseLiveAlgorithmIds("opr,sigma7")).toThrow(/sigma7/);
  });

  // Test 10 (plan 07-18 Task 1): the accepted-ids message lists the three ids
  // read from the collapsed PUBLISHED_ALGORITHM_IDS constant, joined at
  // runtime — never a hardcoded sentence — the same assertion shape 07-16
  // Task 2 Test 3 used, now reading the collapsed constant.
  it("the accepted-ids message lists all three published ids, joined from the imported constant", () => {
    let message = "";
    try {
      parseLiveAlgorithmIds("sigma7");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("accepted: opr, epa, vpr");
  });

  // Test 11 (plan 07-18 Task 1): the retired id is still rejected at the
  // Worker tier — a collapse that reintroduced it as a member would be a
  // silent regression.
  it("the retired pre-rename id (sigma1) is still rejected, not silently folded", () => {
    expect(() => parseLiveAlgorithmIds("sigma1")).toThrow(UnknownLiveAlgorithmIdError);
  });

  it("a live id absent from the algorithms manifest, leaving the filtered module map empty, throws EmptyLiveAlgorithmTierError", () => {
    const manifest = AlgorithmsManifestSchema.parse(JSON.parse(algorithmsManifest(["opr"]))); // manifest publishes ONLY opr
    expect(() => buildAlgorithmModules(manifest, ["vpr"])).toThrow(EmptyLiveAlgorithmTierError);
  });
});
