/**
 * Asserts that the tracked `LIVE_ALGORITHM_IDS` value in `wrangler.toml` is the
 * tier that actually folds, that only that tier folds, and that the three
 * decided misconfiguration behaviors (default+warn / throw / throw) are exactly
 * what is implemented.
 *
 * THE WHOLE SUBREQUEST-BUDGET HALF OF THIS FILE IS GONE (quick task 260923-3w4),
 * and this header records it rather than quietly dropping tests. It used to
 * recompute `processEvent`'s own `estimateEventSubrequestCost` against
 * `TICK_FIXED_SUBREQUEST_COST` + `EVENT_PREFLIGHT_SUBREQUEST_COST` and a
 * `SubrequestBudget().usableCap`, so that adding a second id to the tracked value
 * failed loudly rather than making every event defer forever. The history of
 * that arithmetic, in order:
 *
 *   - `2 + 4A + 2A(1 + T)`: A=3 cost 50 against ~41 usable, so a three-algorithm
 *     tier deferred every tick, forever. This is the defect the file was written
 *     for.
 *   - `2 + 6A` (260917-jr4 deleted Phase B's per-team artifact loop): flat in
 *     the touched-team count, A=3 = 20, which FIT.
 *   - `2 + 4A` (260918-16t deleted the metric sidecar): A=1 = 6, A=3 = 14.
 *
 * With Workers Paid's 10,000 subrequests per invocation (since 2026-09-22) no
 * value of A comes near the cap, the estimate and the deferral it gated are
 * deleted, and there is no arithmetic left to re-derive. What remains of the
 * budget material in this file is one assertion that an unchanged-event tick
 * spends exactly six subrequests — `subrequestsUsed` is still real telemetry, so
 * a silent extra round trip per tick is still worth catching.
 *
 * Widening the tier beyond spr is now purely a published-numbers decision
 * (opr/epa would fold live instead of refreshing at the manual re-baseline,
 * which needs its own algorithm version bump), NOT a budget one. If it is ever
 * widened, `trackedLiveAlgorithmIds`'s assertion below is what has to change,
 * and it is deliberately an equality pin so it cannot silently stop testing the
 * deployed value.
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
  UnknownLiveAlgorithmIdError,
  EmptyLiveAlgorithmTierError,
} from "../src/scheduled.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { artifactKey } from "../../../packages/harness/pageArtifacts.js";
import { AlgorithmsManifestSchema } from "../../../packages/harness/manifestSchemas.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { DEMO_PSEUDO_TEAM_KEY } from "../../../packages/core/algorithms/demoTeams.js";
import { LiveRosterSchema, liveRosterKey } from "../../../packages/harness/liveRoster.js";
import { readSigmaBeliefs, serializeState, withSigmaBeliefs } from "../../../packages/harness/stateSnapshot.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../packages/harness/publishedAlgorithms.js";
import { seedStateBaselineMarkers } from "./support/stateBaseline.js";
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

  constructor() {
    // Every fixture's algorithms manifest publishes `generation: "gen-1"`
    // (see `algorithmsManifest` below) — seeding a marker at that generation
    // for every published algorithm id keeps every pre-existing test in this
    // file folding exactly as before quick task 260920-q75.
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
      // Every bound argument is an `event_key` to match — one for
      // `readEventCursor`, several for `readEventCursors`'s `IN (...)` list
      // (quick task 260920-q75). Returning every hit serves both shapes.
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

  /** Pre-load an object as if an offline publish had written it — deliberately NOT counted in `putCallCount`/`puts`, which exist to count what THIS tick wrote. Since quick task 260923-3w4 the two manifests arrive here rather than through a fake KV binding. */
  seed(key: string, body: string): void {
    this.store.set(key, body);
  }
}

// THE FAKE KV BINDING IS GONE (quick task 260923-3w4): the Worker reads both
// manifests straight from R2, so every `makeEnv` below seeds them into the R2
// fake instead of into a second store that production never wrote to.

function makeEnv(manifests: Map<string, string>, d1: FakeD1Database, r2: FakeR2Bucket, liveAlgorithmIds?: string): Env {
  for (const [key, body] of manifests) r2.seed(key, body);
  return {
    DB: d1 as unknown as D1Database,
    ARTIFACTS: r2 as unknown,
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

// The premier algorithm's version comes off its own module. Derived, not
// literal: an earlier hardcoded version string here silently went stale on a
// code-version bump and failed this test for a reason unrelated to the
// live-tier behaviour it pins. It must match the module the Worker actually
// builds, or the artifact keys this test looks for are keys nothing ever wrote.
const PREMIER_TEST_VERSION = spr.version;
const PREMIER_TEST_CODE_VERSION = spr.version.split("+")[0]!;
const PREMIER_TEST_PARAM_SET = spr.version.split("+")[1] ?? "baseline";

function algorithmsManifest(ids: readonly string[] = ["opr"]): string {
  const algorithms = ids.map((id) => {
    if (id === "opr") return { id: "opr", version: "3.0.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" };
    if (id === "epa") return { id: "epa", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" };
    return { id: "spr", version: PREMIER_TEST_VERSION, codeVersion: PREMIER_TEST_CODE_VERSION, paramSetName: PREMIER_TEST_PARAM_SET };
  });
  return JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", algorithms });
}

function makeManifests(windows: readonly WindowFixture[], algorithmIds: readonly string[] = ["opr", "epa", "spr"]): Map<string, string> {
  return (
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
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ key: eventKey, name: eventKey, year: record.season, event_type: record.eventType, start_date: "2026-08-01" }) };
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


afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("liveAlgorithmTier — an idle-but-considered tick's subrequest count", () => {
  /**
   * The one budget-shaped assertion worth keeping. `subrequestsUsed` is the tick
   * log field an operator reads to see an event weekend's shape, so a silently
   * added round trip per tick is worth catching — but this pins an OBSERVED
   * count, never a re-derivation of a formula the Worker no longer has. Six is
   * the live-windows manifest read, the algorithms manifest read, the tick-meta
   * read, the event's cursor read, the conditional TBA poll (a 304 here), and
   * the tick-meta write.
   */
  it("a tick that considers one live event and finds it unchanged spends exactly six subrequests", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const manifests = makeManifests([window], ["spr"]);
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
    const env = makeEnv(manifests, d1, r2, "spr");

    const result = await runTick(env, { nowMs: NOW_MS });

    expect(result.eventsFailed).toBe(0);
    expect(result.subrequestsUsed).toBe(6);
  });
});

describe("liveAlgorithmTier — only the live tier folds", () => {
  it("with a three-entry algorithms manifest and LIVE_ALGORITHM_IDS=spr, an advancing tick writes only spr artifacts/state and touches no opr/epa artifact or algorithm_state row", async () => {
    const window: WindowFixture = { eventKey: "2026casj", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const manifests = makeManifests([window], ["opr", "epa", "spr"]);
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    const tbaEvents = new Map([["2026casj", twoMatchEventRecord("2026casj", "etag-1")]]);
    vi.stubGlobal("fetch", makeTbaFetchStub(tbaEvents));
    const env = makeEnv(manifests, d1, r2, "spr");

    const result = await runTick(env, { nowMs: NOW_MS });

    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);

    // FakeD1Database.algorithmState keys are `${algorithmId}::${scopeKind}::${scopeKey}`.
    const stateAlgorithmIds = new Set([...d1.algorithmState.keys()].map((k) => k.split("::")[0]));
    expect(stateAlgorithmIds.has("spr")).toBe(true);
    expect(stateAlgorithmIds.has("opr")).toBe(false);
    expect(stateAlgorithmIds.has("epa")).toBe(false);

    // artifactKey's shape ends every path segment with `{algorithmId}@{version}.json`.
    expect(r2.puts.some((p) => p.key.includes("/spr@"))).toBe(true);
    expect(r2.puts.some((p) => p.key.includes("/opr@"))).toBe(false);
    expect(r2.puts.some((p) => p.key.includes("/epa@"))).toBe(false);

    const premierEventKey = artifactKey({ page: "event", eventKey: "2026casj", algorithmId: "spr", version: PREMIER_TEST_VERSION });
    expect(r2.puts.some((p) => p.key === premierEventKey)).toBe(true);

    // Since 260917-jr4 the tick writes NO team artifact at all — the assertion
    // here used to be that every one of ALL_TEAMS got one. Since 260918-16t
    // what replaced them is a block INSIDE the event artifact above, so there
    // is no second key to assert at all: the premier event key IS the whole
    // per-event write set.
    for (const teamKey of ALL_TEAMS) {
      const premierTeamKey = artifactKey({ page: "team", teamKey, year: SEASON, algorithmId: "spr", version: PREMIER_TEST_VERSION });
      expect(r2.puts.some((p) => p.key === premierTeamKey), `${teamKey} team artifact must NOT be written by a live tick`).toBe(false);
    }
    expect(r2.puts.some((p) => p.key.startsWith("v1/team/"))).toBe(false);

    // Exactly ONE per-event object, for the live tier only: the event artifact
    // itself. Asserted by equality over every key mentioning this event, so a
    // reintroduced second object fails here by name.
    // Since quick task 260921-5qw a FIRST fold also writes the event's live roster, the tiny object a
    // robot page finds a promoted event through. It is one object per EVENT, not per algorithm, and it
    // is written only when the roster grew, so never on an ordinary tick.
    expect(new Set(r2.puts.filter((p) => p.key.includes("2026casj")).map((p) => p.key))).toEqual(new Set([premierEventKey, liveRosterKey("2026casj")]));
  });
});

describe("liveAlgorithmTier — a demo match resumes the state the offline publisher seeded (quick task 260918-wfc)", () => {
  const DEMO_KEY = "frc9985";
  const SEEDED_MEAN_WEIGHT = 50;

  /** One tick over one played match whose red alliance holds a demo robot, against a D1 seeded with `pseudoMuL` on SPR's pseudo-team row. */
  async function runDemoTick(pseudoMuL: number): Promise<FakeD1Database> {
    const state = spr.initState([...ALL_TEAMS, DEMO_PSEUDO_TEAM_KEY]) as unknown as { teams: Map<string, { muL: number }> };
    state.teams.get(DEMO_PSEUDO_TEAM_KEY)!.muL = pseudoMuL;
    const seeded = withSigmaBeliefs(
      serializeState("spr", spr.version, state as never, { generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" }),
      new Map([[DEMO_KEY, { meanWeight: SEEDED_MEAN_WEIGHT, mean: 4, varWeight: SEEDED_MEAN_WEIGHT, sumSquares: 900, talent: 60 }]])
    );
    const d1 = new FakeD1Database();
    for (const row of seeded) {
      d1.algorithmState.set(`${row.algorithmId}::${row.scopeKind}::${row.scopeKey}`, {
        algorithm_id: row.algorithmId,
        algorithm_version: row.algorithmVersion,
        scope_kind: row.scopeKind,
        scope_key: row.scopeKey,
        state_json: row.stateJson,
        generation: row.generation,
        computed_at: row.computedAt,
      });
    }
    const window: WindowFixture = { eventKey: "2026demo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType: 99,
      season: SEASON,
      matches: [
        tbaMatch({
          key: "2026demo_qm1",
          eventKey: "2026demo",
          matchNumber: 1,
          redTeams: ["frc1", "frc2", DEMO_KEY],
          blueTeams: BLUE_TEAMS,
          redScore: 120,
          blueScore: 95,
          actualTimeSec: Math.floor(NOW_MS / 1000) - 60,
        }),
      ],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026demo", record]])));
    const result = await runTick(makeEnv(makeManifests([window], ["spr"]), d1, new FakeR2Bucket(), "spr"), { nowMs: NOW_MS });
    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);
    return d1;
  }

  function pseudoMuLAfter(d1: FakeD1Database): number {
    const row = d1.algorithmState.get(`spr::team::${DEMO_PSEUDO_TEAM_KEY}`);
    expect(row, "the tick wrote no pseudo-team row").toBeDefined();
    return (JSON.parse(row!.state_json) as { muL: number }).muL;
  }

  it("the demo robot's Sigma belief is RESUMED and written back, not restarted from the prior", async () => {
    const d1 = await runDemoTick(0);
    const row = d1.algorithmState.get(`spr::team::${DEMO_KEY}`);
    expect(row, "the demo robot's passenger-only row is gone after the tick").toBeDefined();
    const belief = readSigmaBeliefs([
      { algorithmId: "spr", algorithmVersion: spr.version, scopeKind: "team", scopeKey: DEMO_KEY, stateJson: row!.state_json, generation: row!.generation, computedAt: row!.computed_at },
    ]).get(DEMO_KEY);
    expect(belief).toBeDefined();
    // A belief restarted this tick has folded ONE match and reads exactly 1
    // (measured: that is what this assertion saw before the selection named
    // the demo key). A resumed one decays a little and adds one match, so it
    // stays near the seeded 50 (measured 49.1). Half the seed separates them.
    expect(belief!.meanWeight).toBeGreaterThan(SEEDED_MEAN_WEIGHT / 2);
    // The row holds passengers only: the raw demo key never becomes an SPR team.
    expect(Object.keys(JSON.parse(row!.state_json) as object).every((key) => key.startsWith("sigmascout"))).toBe(true);
  });

  it("SPR's pseudo-team row is READ: two ticks differing only in its seeded rating end at different ratings", async () => {
    // If the selection never names the pseudo-team key, both ticks price the
    // demo robot from a fresh pseudo team and write back the same number.
    const low = pseudoMuLAfter(await runDemoTick(0));
    const high = pseudoMuLAfter(await runDemoTick(40));
    expect(high).not.toBe(low);
    expect(high).toBeGreaterThan(low);
  });
});

describe("liveAlgorithmTier — a preseason Week 0 match is priced and never folded (quick task 260919-368)", () => {
  /** One tick over one played match at an event of `eventType`, against a D1 seeded with a plain SPR state for the six teams. Returns the seed and what D1 holds afterwards. */
  async function runTickAt(eventType: number): Promise<{ seeded: Map<string, string>; after: Map<string, string>; r2: FakeR2Bucket }> {
    const rows = serializeState("spr", spr.version, spr.initState([...ALL_TEAMS]) as never, { generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" });
    const d1 = new FakeD1Database();
    const seeded = new Map<string, string>();
    for (const row of rows) {
      const key = `${row.algorithmId}::${row.scopeKind}::${row.scopeKey}`;
      seeded.set(key, row.stateJson);
      d1.algorithmState.set(key, {
        algorithm_id: row.algorithmId,
        algorithm_version: row.algorithmVersion,
        scope_kind: row.scopeKind,
        scope_key: row.scopeKey,
        state_json: row.stateJson,
        generation: row.generation,
        computed_at: row.computedAt,
      });
    }
    const window: WindowFixture = { eventKey: "2026week0", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const record: TbaEventRecord = {
      etag: "etag-1",
      eventType,
      season: SEASON,
      matches: [
        tbaMatch({ key: "2026week0_qm1", eventKey: "2026week0", matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 150, blueScore: 40, actualTimeSec: Math.floor(NOW_MS / 1000) - 60 }),
      ],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026week0", record]])));
    const r2 = new FakeR2Bucket();
    const result = await runTick(makeEnv(makeManifests([window], ["spr"]), d1, r2, "spr"), { nowMs: NOW_MS });
    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);
    return { seeded, after: new Map([...d1.algorithmState].map(([key, row]) => [key, row.state_json])), r2 };
  }

  it("type 100: every seeded SPR row is byte-identical after the tick and no Sigma or RP belief appears, yet the match is on the event page with a prediction", async () => {
    const { seeded, after, r2 } = await runTickAt(100);
    expect([...after.keys()].sort()).toEqual([...seeded.keys()].sort());
    // Level-1 state, exactly. The tick always stamps its LEAGUE passengers onto
    // the league row whether or not anything folded, so those keys are set
    // aside here and asserted EMPTY below rather than ignored.
    const levelOne = (stateJson: string): Record<string, unknown> =>
      Object.fromEntries(Object.entries(JSON.parse(stateJson) as Record<string, unknown>).filter(([key]) => !key.startsWith("sigmascout")));
    for (const [key, stateJson] of seeded) expect(levelOne(after.get(key)!), key).toEqual(levelOne(stateJson));
    // No per-team belief of either kind was created.
    for (const [key, stateJson] of after) {
      if (key.startsWith("spr::team::")) expect(Object.keys(JSON.parse(stateJson) as object).filter((k) => k.startsWith("sigmascout")), key).toEqual([]);
    }
    // And what the league row gained has observed nothing.
    const league = JSON.parse(after.get("spr::league::league")!) as {
      sigmascoutSigmaPopulation?: { count: number };
      sigmascoutRpMeanShift?: { variables: Record<string, { count: number }> };
    };
    expect(league.sigmascoutSigmaPopulation?.count ?? 0).toBe(0);
    expect(Object.values(league.sigmascoutRpMeanShift?.variables ?? {}).map((v) => v.count)).toEqual(
      Object.values(league.sigmascoutRpMeanShift?.variables ?? {}).map(() => 0)
    );

    const eventKey = artifactKey({ page: "event", eventKey: "2026week0", algorithmId: "spr", version: PREMIER_TEST_VERSION });
    const body = JSON.parse(r2.puts.filter((p) => p.key === eventKey).at(-1)!.body) as { matches: { matchKey: string; pRedWin?: number }[] };
    expect(body.matches.map((m) => m.matchKey)).toEqual(["2026week0_qm1"]);
    expect(body.matches[0]!.pRedWin).toBeTypeOf("number");
  });

  it("the SAME match at an official event and at an offseason event DOES fold, so the type 100 result above is the rule and not an inert fixture", async () => {
    for (const eventType of [0, 99]) {
      const { seeded, after } = await runTickAt(eventType);
      const moved = [...seeded].filter(([key, stateJson]) => after.get(key) !== stateJson).map(([key]) => key);
      expect(moved, `event type ${eventType}`).toContain("spr::league::league");
      expect(moved.filter((key) => key.startsWith("spr::team::")), `event type ${eventType}`).toHaveLength(ALL_TEAMS.length);
    }
  });
});

describe("liveAlgorithmTier — a promoted event's state block is completed by the tick itself (quick task 260921-5qw)", () => {
  const UPCOMING_TEAMS = ["frc7", "frc8", "frc9", "frc10", "frc11", "frc12"];
  /** frc12 has no row in D1: a rookie. Everyone else is seeded. */
  const SEEDED_TEAMS = [...ALL_TEAMS, ...UPCOMING_TEAMS.filter((t) => t !== "frc12")];

  function seededD1(): FakeD1Database {
    const d1 = new FakeD1Database();
    for (const row of serializeState("spr", spr.version, spr.initState([...SEEDED_TEAMS]) as never, { generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" })) {
      d1.algorithmState.set(`${row.algorithmId}::${row.scopeKind}::${row.scopeKey}`, {
        algorithm_id: row.algorithmId,
        algorithm_version: row.algorithmVersion,
        scope_kind: row.scopeKind,
        scope_key: row.scopeKey,
        state_json: row.stateJson,
        generation: row.generation,
        computed_at: row.computedAt,
      });
    }
    return d1;
  }

  function stateOf(r2: FakeR2Bucket, eventKey: string): { rows: { scopeKind: string; scopeKey: string }[]; absentKeys?: string[] } | undefined {
    const key = artifactKey({ page: "event", eventKey, algorithmId: "spr", version: PREMIER_TEST_VERSION });
    const put = r2.puts.filter((p) => p.key === key).at(-1);
    expect(put, "the tick wrote no event artifact").toBeDefined();
    return (JSON.parse(put!.body) as { state?: { rows: { scopeKind: string; scopeKey: string }[]; absentKeys?: string[] } }).state;
  }

  it("no published artifact at all: the first fold leaves a block holding the league row, every touched team AND every team on the upcoming match, with the rookie recorded absent", async () => {
    const window: WindowFixture = { eventKey: "2026promo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const d1 = seededD1();
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", twoMatchEventRecord("2026promo", "etag-1")]])));

    const result = await runTick(makeEnv(makeManifests([window], ["spr"]), d1, r2, "spr"), { nowMs: NOW_MS });
    expect(result.eventsAdvanced).toBe(1);

    const state = stateOf(r2, "2026promo");
    expect(state, "a promoted event has no state block, so its upcoming match cannot be priced").toBeDefined();
    expect(state!.rows.filter((r) => r.scopeKind === "league")).toHaveLength(1);
    expect(state!.rows.filter((r) => r.scopeKind === "team").map((r) => r.scopeKey).sort()).toEqual([...SEEDED_TEAMS].sort());
    expect(state!.absentKeys).toEqual(["frc12"]);
  });

  it("the completion read happens ONCE: a later tick that folds nothing new for the block spends no extra D1 read on it", async () => {
    const window: WindowFixture = { eventKey: "2026promo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const d1 = seededD1();
    const r2 = new FakeR2Bucket();
    const selects = vi.spyOn(d1, "executeSelect");
    const stateReads = (): number => selects.mock.calls.filter(([sql]) => String(sql).includes("FROM algorithm_state")).length;

    const first = twoMatchEventRecord("2026promo", "etag-1");
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", first]])));
    await runTick(makeEnv(makeManifests([window], ["spr"]), d1, r2, "spr"), { nowMs: NOW_MS });
    const readsOnFirstTick = stateReads();
    // The fold's own read, plus exactly one to complete the block.
    expect(readsOnFirstTick).toBe(2);

    // A third match is played by the ORIGINAL six teams; qm2 is still upcoming.
    const second: TbaEventRecord = {
      ...first,
      etag: "etag-2",
      matches: [...first.matches, tbaMatch({ key: "2026promo_qm3", eventKey: "2026promo", matchNumber: 3, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 99, blueScore: 101, actualTimeSec: Math.floor(NOW_MS / 1000) - 30 })],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", second]])));
    const result = await runTick(makeEnv(makeManifests([window], ["spr"]), d1, r2, "spr"), { nowMs: NOW_MS + 60_000 });
    expect(result.eventsAdvanced).toBe(1);
    // Only the fold's own read: the block is complete and frc12 is known absent.
    expect(stateReads() - readsOnFirstTick).toBe(1);
    expect(stateOf(r2, "2026promo")!.absentKeys).toEqual(["frc12"]);
  });

  it("the live roster is written on the first fold, NOT rewritten by an ordinary tick, and rewritten when a team is added", async () => {
    const window: WindowFixture = { eventKey: "2026promo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const d1 = seededD1();
    const r2 = new FakeR2Bucket();
    const rosterPuts = () => r2.puts.filter((p) => p.key === liveRosterKey("2026promo"));
    const env = () => makeEnv(makeManifests([window], ["spr"]), d1, r2, "spr");

    const first = twoMatchEventRecord("2026promo", "etag-1");
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", first]])));
    await runTick(env(), { nowMs: NOW_MS });
    expect(rosterPuts()).toHaveLength(1);
    const roster = LiveRosterSchema.parse(JSON.parse(rosterPuts()[0]!.body));
    // The six that played AND the six still on the schedule, so a robot page
    // shows the event before that team's first match.
    expect(roster.teams).toEqual([...ALL_TEAMS, ...UPCOMING_TEAMS].sort());
    expect(roster).toMatchObject({ eventKey: "2026promo", season: SEASON });

    // Same twelve teams, one more match played: nothing to say.
    const second: TbaEventRecord = { ...first, etag: "etag-2", matches: [...first.matches, tbaMatch({ key: "2026promo_qm3", eventKey: "2026promo", matchNumber: 3, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 99, blueScore: 101, actualTimeSec: Math.floor(NOW_MS / 1000) - 30 })] };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", second]])));
    await runTick(env(), { nowMs: NOW_MS + 60_000 });
    expect(rosterPuts(), "the roster was rewritten by a tick that added no team").toHaveLength(1);

    // A thirteenth team appears on a new upcoming match.
    const third: TbaEventRecord = { ...second, etag: "etag-3", matches: [...second.matches, tbaMatch({ key: "2026promo_qm4", eventKey: "2026promo", matchNumber: 4, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 80, blueScore: 70, actualTimeSec: Math.floor(NOW_MS / 1000) - 10 }), tbaMatch({ key: "2026promo_qm5", eventKey: "2026promo", matchNumber: 5, redTeams: ["frc13", "frc8", "frc9"], blueTeams: ["frc10", "frc11", "frc12"], predictedTimeSec: Math.floor(NOW_MS / 1000) + 7200 })] };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", third]])));
    await runTick(env(), { nowMs: NOW_MS + 120_000 });
    expect(rosterPuts()).toHaveLength(2);
    expect(LiveRosterSchema.parse(JSON.parse(rosterPuts()[1]!.body)).teams).toContain("frc13");
  });

  /**
   * DELETED with the budget (quick task 260923-3w4). This slot held "no
   * subrequest budget left for it: the tick still advances and simply writes no
   * block, to be tried again next tick" — it drove `runTick` with
   * `subrequestCap` set to exactly one spr event's estimate and asserted the
   * event still advanced while the state block and the live roster were both
   * skipped. Both of those skips were the two opportunistic
   * `budget.remaining > stillOwed` guards, which are gone: the block read and
   * the roster write now simply happen. There is no cap to starve the tick with
   * and no deferral to observe, so the test was removed rather than rewritten
   * against a behaviour that no longer exists.
   */
});

describe("liveAlgorithmTier — the three decided misconfiguration behaviors", () => {
  it("unset or empty defaults to spr and emits a structured live-tier-defaulted warn line", () => {
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

  // parseLiveAlgorithmIds validates against PUBLISHED_ALGORITHM_IDS.
  it("accepts the current premier id (spr) and rejects the retired premier id (bpr)", () => {
    expect(parseLiveAlgorithmIds("spr")).toEqual(["spr"]);
    expect(() => parseLiveAlgorithmIds("bpr")).toThrow(UnknownLiveAlgorithmIdError);
    expect(() => parseLiveAlgorithmIds("bpr")).toThrow(/bpr/);
  });

  // The accepted-ids message lists the ids read from PUBLISHED_ALGORITHM_IDS,
  // joined at runtime — never a hardcoded sentence.
  it("the accepted-ids message lists all three published ids, joined from the imported constant", () => {
    let message = "";
    try {
      parseLiveAlgorithmIds("sigma7");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("accepted: opr, epa, spr");
  });

  it("the retired pre-rename id (sigma1) is still rejected, not silently folded", () => {
    expect(() => parseLiveAlgorithmIds("sigma1")).toThrow(UnknownLiveAlgorithmIdError);
  });

  it("a live id absent from the algorithms manifest, leaving the filtered module map empty, throws EmptyLiveAlgorithmTierError", () => {
    const manifest = AlgorithmsManifestSchema.parse(JSON.parse(algorithmsManifest(["opr"]))); // manifest publishes ONLY opr
    expect(() => buildAlgorithmModules(manifest, ["spr"])).toThrow(EmptyLiveAlgorithmTierError);
  });
});

/**
 * `buildAlgorithmModules` must never construct a plausible module for an id
 * it does not recognise — a silent fallthrough would fold live events with
 * the WRONG MODEL and write results to the wrong artifacts. These pin the
 * two halves: `spr` builds a real module, and an unknown id is loud.
 */
describe("buildAlgorithmModules — no silent Sigma1 fallthrough", () => {
  function manifestOf(ids: readonly string[]) {
    return {
      schemaVersion: 1,
      generation: "g",
      computedAt: "2026-09-08T00:00:00.000Z",
      algorithms: ids.map((id) => ({ id, version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" })),
    } as unknown as Parameters<typeof buildAlgorithmModules>[0];
  }

  it("builds a REAL BPR module for a spr live tier, not a Sigma1 module wearing BPR's id", () => {
    const modules = buildAlgorithmModules(manifestOf(["spr"]), ["spr"]);
    const module = modules.get("spr");
    expect(module).toBeDefined();
    expect(module).toBe(spr);
    expect(module!.id).toBe("spr");
  });

  it("throws on an id it does not recognise rather than constructing something plausible", () => {
    expect(() => buildAlgorithmModules(manifestOf(["mystery"]), ["mystery"])).toThrow(UnknownLiveAlgorithmIdError);
  });

  it("throws on the retired vpr id rather than building any module for it", () => {
    expect(() => buildAlgorithmModules(manifestOf(["vpr"]), ["vpr"])).toThrow(UnknownLiveAlgorithmIdError);
  });

  it("still builds opr, epa and spr as their own modules", () => {
    const modules = buildAlgorithmModules(manifestOf(["opr", "epa", "spr"]), ["opr", "epa", "spr"]);
    expect(modules.get("opr")).toBe(opr);
    expect(modules.get("epa")).toBe(epa);
    expect(modules.get("spr")?.id).toBe("spr");
  });
});
