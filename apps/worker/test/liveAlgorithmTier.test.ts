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
 * THE TIER WAS WIDENED to all three published algorithms on 2026-09-23 (quick
 * task 260923-3w8, Jacob's decision on `260923-1tu-FINDINGS.md` item C6), paid
 * for with opr 6.0.0 and epa 13.0.0 because their published numbers now advance
 * during an event instead of only at the manual re-baseline. So the defect this
 * file was written for — a three-algorithm tier deferring every tick forever —
 * is now the shipped configuration, and the tests below assert that all three
 * really do fold rather than that only one does.
 *
 * THE EQUALITY PIN (`trackedLiveAlgorithmIds`) IS THE POINT OF THIS FILE, and it
 * was missing at the moment the widening landed: `4671401d` (quick task
 * 260923-3w4) deleted the whole `describe` block that held it, together with the
 * budget arithmetic it sat beside, leaving `extractVarsValue`, `readFileSync` and
 * `__dirname` below dangling unused — and 260923-3w4's own summary recorded the
 * pin as kept. It is restored here, and the fold assertions DERIVE their
 * expectation from the tracked `wrangler.toml` value rather than naming ids
 * again, so the two cannot disagree. Narrowing or widening the tracked value
 * fails here rather than silently going untested.
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
  EVENT_SCOPED_ALGORITHM_IDS,
} from "../src/scheduled.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { artifactKey } from "../../../packages/harness/pageArtifacts.js";
import { AlgorithmsManifestSchema } from "../../../packages/harness/manifestSchemas.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { DEMO_PSEUDO_TEAM_KEY } from "../../../packages/core/algorithms/demoTeams.js";
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

const WRANGLER_TOML_PATH = resolve(__dirname, "../wrangler.toml");

/** The raw `LIVE_ALGORITHM_IDS` string as tracked config spells it — the value a `wrangler deploy` from this repo actually ships. */
function trackedLiveAlgorithmIdsRaw(): string {
  const raw = extractVarsValue(readFileSync(WRANGLER_TOML_PATH, "utf-8"), "LIVE_ALGORITHM_IDS");
  expect(raw, `LIVE_ALGORITHM_IDS not found in ${WRANGLER_TOML_PATH}'s [vars] block`).not.toBeNull();
  return raw!;
}

/** The tracked value through the Worker's OWN parser, so the test reads it exactly as a tick does. */
function trackedLiveAlgorithmIds(): string[] {
  return parseLiveAlgorithmIds(trackedLiveAlgorithmIdsRaw());
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

/**
 * EVERY live algorithm's version comes off its own module now, for exactly the
 * reason `PREMIER_TEST_VERSION` does: `processEvent` builds every artifact key
 * from `algorithm.version`, so a hand-typed manifest version makes this file
 * look for keys nothing ever wrote. Until quick task 260923-3w8 the two
 * non-premier entries below carried invented versions (`opr@3.0.0+baseline`,
 * `epa@1.0.0+baseline`), which was harmless only while neither of them folded.
 */
const MODULE_VERSION_BY_ID: Readonly<Record<string, string>> = { opr: opr.version, epa: epa.version, spr: spr.version };

/** The version this file expects an artifact key to name for `algorithmId` — derived, never a literal. */
function testVersionFor(algorithmId: string): string {
  const version = MODULE_VERSION_BY_ID[algorithmId];
  expect(version, `no module version known for algorithm id "${algorithmId}"`).toBeDefined();
  return version!;
}

function algorithmsManifest(ids: readonly string[] = ["opr"]): string {
  const algorithms = ids.map((id) => {
    const version = testVersionFor(id);
    return { id, version, codeVersion: version.split("+")[0]!, paramSetName: version.split("+")[1] ?? "baseline" };
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

describe("liveAlgorithmTier — the tracked live tier, pinned by equality", () => {
  /**
   * The assertion this whole file exists for, and the one that has to change
   * deliberately whenever the tier does. Spelled as a raw-string equality on the
   * tracked value rather than a "contains spr" or a length check, because either
   * of those would keep passing through a narrowing that silently froze opr and
   * epa mid-event.
   */
  it('wrangler.toml\'s LIVE_ALGORITHM_IDS is exactly "opr,epa,spr"', () => {
    expect(trackedLiveAlgorithmIdsRaw()).toBe("opr,epa,spr");
  });

  it("the tracked tier is the WHOLE published set, in PUBLISHED_ALGORITHM_IDS display order", () => {
    expect(trackedLiveAlgorithmIds()).toEqual([...PUBLISHED_ALGORITHM_IDS]);
  });

  /**
   * A default narrower than the tracked value is how a deploy that fails to
   * carry tracked vars through becomes invisible: opr and epa would just stop
   * moving while the site kept serving them, and the only signal would be the
   * `live-tier-defaulted` warn line nobody is watching at 11pm on a Saturday.
   */
  it("DEFAULT_LIVE_ALGORITHM_IDS equals the tracked value, so a deploy that drops the var cannot narrow the tier", () => {
    expect([...DEFAULT_LIVE_ALGORITHM_IDS]).toEqual(trackedLiveAlgorithmIds());
  });
});

describe("liveAlgorithmTier — with the TRACKED tier, every published algorithm folds (quick task 260923-3w8)", () => {
  const EVENT_KEY = "2026casj";

  /** One advancing tick at an official event, driven by the value `wrangler.toml` actually tracks — never by a literal tier — against a manifest publishing exactly the ids that value names. */
  async function runTrackedTick(): Promise<{ ids: string[]; d1: FakeD1Database; r2: FakeR2Bucket }> {
    const ids = trackedLiveAlgorithmIds();
    const window: WindowFixture = { eventKey: EVENT_KEY, season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([[EVENT_KEY, twoMatchEventRecord(EVENT_KEY, "etag-1")]])));
    const result = await runTick(makeEnv(makeManifests([window], ids), d1, r2, trackedLiveAlgorithmIdsRaw()), { nowMs: NOW_MS });
    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);
    return { ids, d1, r2 };
  }

  /** The algorithm ids that wrote state, and which scope kinds each wrote. `FakeD1Database.algorithmState` keys are `${algorithmId}::${scopeKind}::${scopeKey}`. */
  function scopeKindsById(d1: FakeD1Database): Map<string, Set<string>> {
    const byId = new Map<string, Set<string>>();
    for (const key of d1.algorithmState.keys()) {
      const [algorithmId, scopeKind] = key.split("::");
      if (!byId.has(algorithmId!)) byId.set(algorithmId!, new Set());
      byId.get(algorithmId!)!.add(scopeKind!);
    }
    return byId;
  }

  it("every tracked id writes league and team state, and exactly the event-scoped ones write an event row", async () => {
    const { ids, d1 } = await runTrackedTick();
    const byId = scopeKindsById(d1);

    // SET EQUALITY, which is both halves at once: a tracked id that did not fold
    // fails here, and so does an id outside the tier that did.
    expect([...byId.keys()].sort()).toEqual([...ids].sort());

    for (const id of ids) {
      expect(byId.get(id), `${id}: no league row`).toContain("league");
      expect(byId.get(id), `${id}: no team rows`).toContain("team");
      // Derived from `EVENT_SCOPED_ALGORITHM_IDS`, never re-typed. OPR's
      // per-event ratings row is the one that matters: without `selectionsFor`
      // loading it before the fold, `update()` rebuilds the accumulator from this
      // tick's matches alone and writes it back, overwriting the event's history
      // with well-formed but wrong ratings. A written row proves the round trip.
      expect(byId.get(id)!.has("event"), `${id}: event-scope row presence`).toBe(EVENT_SCOPED_ALGORITHM_IDS.has(id));
    }

    // Every played team, for every tracked id — the fold really reached each one.
    for (const id of ids) {
      for (const teamKey of ALL_TEAMS) {
        expect(d1.algorithmState.has(`${id}::team::${teamKey}`), `${id}: no state row for ${teamKey}`).toBe(true);
      }
    }
  });

  it("every tracked id gets its own event artifact, a team artifact per played team, and a teams/{year} rebuild", async () => {
    const { ids, r2 } = await runTrackedTick();
    const written = new Set(r2.puts.map((p) => p.key));

    for (const id of ids) {
      const version = testVersionFor(id);
      expect(written.has(artifactKey({ page: "event", eventKey: EVENT_KEY, algorithmId: id, version })), `${id}: no event artifact`).toBe(true);
      // `runGlobalRebuild` runs unconditionally since quick task 260923-3w4, and
      // this event is official (type 0), so the season feed moves for each id.
      expect(written.has(artifactKey({ page: "teams", year: SEASON, algorithmId: id, version })), `${id}: no teams/${SEASON} rebuild`).toBe(true);
    }

    // Team artifacts: exactly the cross product of played teams and tracked ids,
    // asserted by set equality so a missing id and a stray extra one both fail.
    expect(new Set(r2.puts.filter((p) => p.key.startsWith("v1/team/")).map((p) => p.key))).toEqual(
      new Set(ids.flatMap((id) => ALL_TEAMS.map((teamKey) => artifactKey({ page: "team", teamKey, year: SEASON, algorithmId: id, version: testVersionFor(id) }))))
    );

    // Exactly ONE per-event object per tracked id: the event artifact. Asserted by
    // equality over every key mentioning this event, so a reintroduced second
    // object fails here by name — 260921-5qw's live roster was that second
    // object, and quick task 260923-3w6 deleted it.
    expect(new Set(r2.puts.filter((p) => p.key.includes(EVENT_KEY)).map((p) => p.key))).toEqual(
      new Set(ids.map((id) => artifactKey({ page: "event", eventKey: EVENT_KEY, algorithmId: id, version: testVersionFor(id) })))
    );
  });
});

describe("liveAlgorithmTier — a NARROWED tier folds only its own members", () => {
  /**
   * The original form of this file's central test, kept after the widening rather
   * than deleted. With the tracked tier now equal to the published set, the
   * assertions above cannot distinguish "folds the tier" from "folds everything
   * the manifest names" — this can, because it hands the Worker a tier that is a
   * strict subset of a three-entry manifest. It is also the exact shape an
   * operator gets from a `wrangler deploy --var LIVE_ALGORITHM_IDS:spr`.
   */
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

    // Every touched team gets its own artifact again (quick task 260923-3w6,
    // reversing 260917-jr4), and only for the narrowed tier: a team artifact
    // under `/opr@` or `/epa@` would mean an algorithm outside
    // `LIVE_ALGORITHM_IDS` was folded.
    expect(new Set(r2.puts.filter((p) => p.key.startsWith("v1/team/")).map((p) => p.key))).toEqual(
      new Set(ALL_TEAMS.map((teamKey) => artifactKey({ page: "team", teamKey, year: SEASON, algorithmId: "spr", version: PREMIER_TEST_VERSION })))
    );

    // ONE per-event object, for the narrowed tier only.
    expect(new Set(r2.puts.filter((p) => p.key.includes("2026casj")).map((p) => p.key))).toEqual(new Set([premierEventKey]));
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

describe("liveAlgorithmTier — a promoted event's upcoming match is priced by the tick itself (quick task 260923-3w6)", () => {
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

  interface PublishedEvent {
    readonly state?: unknown;
    readonly upcoming: Record<string, unknown>[];
  }

  function publishedEvent(r2: FakeR2Bucket, eventKey: string): PublishedEvent {
    const key = artifactKey({ page: "event", eventKey, algorithmId: "spr", version: PREMIER_TEST_VERSION });
    const put = r2.puts.filter((p) => p.key === key).at(-1);
    expect(put, "the tick wrote no event artifact").toBeDefined();
    return JSON.parse(put!.body) as PublishedEvent;
  }

  it("no published artifact at all: the first fold prices the still-upcoming match itself and writes no state block", async () => {
    const window: WindowFixture = { eventKey: "2026promo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const d1 = seededD1();
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", twoMatchEventRecord("2026promo", "etag-1")]])));

    const result = await runTick(makeEnv(makeManifests([window], ["spr"]), d1, r2, "spr"), { nowMs: NOW_MS });
    expect(result.eventsAdvanced).toBe(1);

    // An event promoted to live folding with no offline publish behind it used to
    // need a `state` block completed out of D1 before its upcoming matches could
    // be priced at all (260921-5qw). The tick prices them directly now, so there
    // is no block and no operator step.
    const artifact = publishedEvent(r2, "2026promo");
    expect(artifact).not.toHaveProperty("state");
    expect(artifact.upcoming.map((row) => row.matchKey)).toEqual(["2026promo_qm2"]);
    const qm2 = artifact.upcoming[0]!;
    expect(qm2.pRedWin, "the upcoming match was not priced").toBeTypeOf("number");
    expect(qm2.predictedRedScore).toBeTypeOf("number");
    // qm2's whole roster is unseen — nobody on it has played — so the offline
    // rule gives neither alliance a band and the match no ranking points. That
    // agreement with the publisher is the point; a price-from-prior band here
    // would be a number the next republish silently changes.
    expect(qm2).not.toHaveProperty("redMatchBandVariance");
    expect(qm2).not.toHaveProperty("redRpPmf");
  });

  /**
   * The same bootstrap for EVERY tracked id, not just the premier one (quick task
   * 260923-3w8). A promoted event is discovered by the probe pass and has no
   * published artifact of any kind behind it, so opr and epa now have to build
   * one from nothing exactly as spr does — and opr additionally has to create its
   * per-event ratings row on that first tick. If opr's event-scope bootstrap were
   * broken, the failure would be an event page whose OPR ratings are quietly
   * rebuilt from one tick's matches, which renders as plausible numbers.
   */
  it("a promoted event bootstraps for EVERY tracked id: an event artifact with a priced upcoming row, no state block", async () => {
    const ids = trackedLiveAlgorithmIds();
    const window: WindowFixture = { eventKey: "2026promo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const d1 = new FakeD1Database();
    for (const id of ids) {
      const module = id === "opr" ? opr : id === "epa" ? epa : spr;
      for (const row of serializeState(id, module.version, module.initState([...SEEDED_TEAMS]) as never, { generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z" })) {
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
    }
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", twoMatchEventRecord("2026promo", "etag-1")]])));

    const result = await runTick(makeEnv(makeManifests([window], ids), d1, r2, trackedLiveAlgorithmIdsRaw()), { nowMs: NOW_MS });
    expect(result.eventsAdvanced).toBe(1);
    expect(result.eventsFailed).toBe(0);

    for (const id of ids) {
      const key = artifactKey({ page: "event", eventKey: "2026promo", algorithmId: id, version: testVersionFor(id) });
      const put = r2.puts.filter((p) => p.key === key).at(-1);
      expect(put, `${id}: the tick wrote no event artifact for the promoted event`).toBeDefined();
      const artifact = JSON.parse(put!.body) as { state?: unknown; upcoming: Record<string, unknown>[] };
      expect(artifact, id).not.toHaveProperty("state");
      expect(artifact.upcoming.map((row) => row.matchKey), id).toEqual(["2026promo_qm2"]);
      expect(artifact.upcoming[0]!.pRedWin, `${id}: the upcoming match was not priced`).toBeTypeOf("number");
      expect(artifact.upcoming[0]!.predictedRedScore, id).toBeTypeOf("number");
    }

    // Every event-scoped tracked id has its per-event ratings row after the first
    // tick at an event it had never seen — the `selectionsFor` round trip, for the
    // promoted case. Derived from `EVENT_SCOPED_ALGORITHM_IDS` so this test stays
    // about the bootstrap and never becomes a second copy of the tracked-tier pin.
    for (const id of ids.filter((candidate) => EVENT_SCOPED_ALGORITHM_IDS.has(candidate))) {
      expect(d1.algorithmState.has(`${id}::event::2026promo`), `${id} wrote no per-event row for the promoted event`).toBe(true);
    }
  });

  it("one D1 state read per tick, and it covers the remaining schedule's teams — including the rookie with no row", async () => {
    const window: WindowFixture = { eventKey: "2026promo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const d1 = seededD1();
    const r2 = new FakeR2Bucket();
    const selects = vi.spyOn(d1, "executeSelect");
    const stateReadCalls = () => selects.mock.calls.filter(([sql]) => String(sql).includes("FROM algorithm_state"));

    const first = twoMatchEventRecord("2026promo", "etag-1");
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", first]])));
    await runTick(makeEnv(makeManifests([window], ["spr"]), d1, r2, "spr"), { nowMs: NOW_MS });
    // ONE statement, not two: the fold's own read now also carries the teams
    // Phase B needs to price the schedule, where 260921-5qw spent a second read
    // completing a `state` block.
    expect(stateReadCalls()).toHaveLength(1);
    // And it really asked for them: qm1's six plus qm2's six, frc12 included even
    // though D1 has no row for it (reading it is how the pricer learns it is
    // unseen rather than guessing).
    const boundKeys = stateReadCalls()[0]![1] as readonly unknown[];
    for (const teamKey of [...ALL_TEAMS, ...UPCOMING_TEAMS]) {
      expect(boundKeys, `${teamKey} was not in the state read`).toContain(teamKey);
    }

    // A third match is played by the ORIGINAL six teams; qm2 is still upcoming.
    const second: TbaEventRecord = {
      ...first,
      etag: "etag-2",
      matches: [...first.matches, tbaMatch({ key: "2026promo_qm3", eventKey: "2026promo", matchNumber: 3, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 99, blueScore: 101, actualTimeSec: Math.floor(NOW_MS / 1000) - 30 })],
    };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", second]])));
    const result = await runTick(makeEnv(makeManifests([window], ["spr"]), d1, r2, "spr"), { nowMs: NOW_MS + 60_000 });
    expect(result.eventsAdvanced).toBe(1);
    expect(stateReadCalls()).toHaveLength(2);
    expect(publishedEvent(r2, "2026promo")).not.toHaveProperty("state");
  });

  it("a promoted event reaches a robot page through the TEAM's own artifact, which is what replaced the live roster", async () => {
    // THIS TEST IS THE ARGUMENT FOR DELETING `v1/live-roster/{eventKey}.json`
    // (quick task 260923-3w6). That object existed for one reason: a robot page
    // learns a team's events from that team's published season file, and between
    // 260917-jr4 and 260923-3w6 the live tick wrote no such file — so an event the
    // Worker promoted, which TBA publishes no advance team list for, was invisible
    // on every robot page until an operator republished. The tick writes the team
    // file again and names the event in it, so the roster object is redundant
    // rather than merely unused, and this asserts both halves of that.
    const window: WindowFixture = { eventKey: "2026promo", season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
    const d1 = seededD1();
    const r2 = new FakeR2Bucket();
    const env = () => makeEnv(makeManifests([window], ["spr"]), d1, r2, "spr");

    const first = twoMatchEventRecord("2026promo", "etag-1");
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", first]])));
    await runTick(env(), { nowMs: NOW_MS });

    // Nothing under the deleted prefix, spelled as a concatenation so the literal
    // does not reappear in source.
    expect(r2.puts.filter((p) => p.key.startsWith("v1/" + "live-roster" + "/"))).toEqual([]);

    // Each team that PLAYED has its own artifact, and that artifact names the
    // promoted event — which is exactly what the robot page reads.
    for (const teamKey of ALL_TEAMS) {
      const put = r2.puts.filter((p) => p.key === artifactKey({ page: "team", teamKey, year: SEASON, algorithmId: "spr", version: PREMIER_TEST_VERSION })).at(-1);
      expect(put, `${teamKey}: no team artifact`).toBeDefined();
      const events = (JSON.parse(put!.body) as { events: { eventKey: string }[] }).events;
      expect(events.map((e) => e.eventKey), teamKey).toContain("2026promo");
    }

    // A team only on the SCHEDULE has played nothing, so it gets no write — the
    // documented carry-forward, and the one thing the roster object used to cover
    // that the team file cannot until that team's first match.
    for (const teamKey of UPCOMING_TEAMS) {
      const key = artifactKey({ page: "team", teamKey, year: SEASON, algorithmId: "spr", version: PREMIER_TEST_VERSION });
      expect(r2.puts.some((p) => p.key === key), `${teamKey} has not played and must not be written`).toBe(false);
    }

    // A thirteenth team appears, plays, and gets its own artifact on the tick that
    // folds its match — the case the roster object's regrowth branch covered.
    const second: TbaEventRecord = { ...first, etag: "etag-2", matches: [...first.matches, tbaMatch({ key: "2026promo_qm3", eventKey: "2026promo", matchNumber: 3, redTeams: ["frc13", "frc8", "frc9"], blueTeams: ["frc10", "frc11", "frc12"], redScore: 99, blueScore: 101, actualTimeSec: Math.floor(NOW_MS / 1000) - 30 })] };
    vi.stubGlobal("fetch", makeTbaFetchStub(new Map([["2026promo", second]])));
    await runTick(env(), { nowMs: NOW_MS + 60_000 });
    const rookieKey = artifactKey({ page: "team", teamKey: "frc13", year: SEASON, algorithmId: "spr", version: PREMIER_TEST_VERSION });
    const rookiePut = r2.puts.filter((p) => p.key === rookieKey).at(-1);
    expect(rookiePut, "frc13 played and got no team artifact").toBeDefined();
    expect((JSON.parse(rookiePut!.body) as { events: { eventKey: string }[] }).events.map((e) => e.eventKey)).toContain("2026promo");
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
