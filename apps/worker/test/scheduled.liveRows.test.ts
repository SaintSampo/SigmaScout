/**
 * The event artifact's ephemeral LIVE BLOCK, end to end through the REAL
 * `runTick` (quick task 260918-16t, Task 2 — this is
 * `scheduled.sidecar.test.ts` retargeted at the new shape, not a new file).
 *
 * `packages/harness/liveEventRows.test.ts` covers the merge and the encoding
 * in isolation. THIS file covers the things only a driven tick can settle:
 * that the tick issues zero team-artifact R2 calls (reads included — a read
 * costs a subrequest and a round trip whether or not a write follows), that
 * Phase B now makes EXACTLY TWO R2 calls per algorithm-event and none under
 * any other key at all, that successive ticks append to the one body, that the
 * write-side scrub covers the live rows because they sit inside the body it
 * already scrubs, that a drifted key set is logged and self-heals, and — the
 * one thing the deleted team loop was carrying besides its artifact work —
 * that `runGlobalRebuild`'s touched-team bookkeeping still reaches
 * `teams/{year}` with the right per-team match delta.
 *
 * FOUR CASES FROM THE SIDECAR VERSION ARE GONE BECAUSE THEIR SUBJECT IS: the
 * R2 key spelling (the block has no key of its own), the wrapper-schema
 * literal `ephemeral: true` (the block is exactly `{ metricKeys, rows }`, and
 * the ephemerality is now the schema asymmetry pinned in
 * `pageArtifacts.test.ts`), the standalone byte ceiling (replaced by the size
 * trim, unit-tested in `liveEventRows.test.ts` because a 300 KB body cannot be
 * driven through this fixture) and `complete` (nothing ever read it).
 *
 * Fakes are deliberately duplicated from `scheduled.test.ts` rather than
 * shared, following this directory's established convention (see
 * `scheduled.replay.test.ts`'s header for the reasoning): independent fakes
 * are what make a real divergence detectable rather than tautological. THIS
 * file's fake R2 additionally logs GETS, which `scheduled.test.ts`'s does not
 * — the zero-team-READ half of the claim is unassertable without it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTick } from "../src/scheduled.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { artifactKey, LiveEventArtifactSchema, TeamsArtifactSchema, type EventLiveBlock } from "../../../packages/harness/pageArtifacts.js";
import { mergeEventLiveBlock } from "../../../packages/harness/liveEventRows.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { SIGMA_METRIC_KEY } from "../../../packages/harness/sigmaScore.js";
import { TOTAL_METRIC_KEY } from "../../../packages/core/algorithms/types.js";
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
      if (!existing || (existing.last_folded_match_key ?? null) !== (expectedPrior ?? null)) return 0;
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
  puts: { key: string; body: string }[] = [];
  /** Every key the tick asked for. The zero-team-READ half of the claim is unassertable without this. */
  gets: string[] = [];
  private readonly store = new Map<string, string>();

  async put(key: string, body: string): Promise<void> {
    this.puts.push({ key, body });
    this.store.set(key, body);
  }

  async get(key: string): Promise<FakeR2Object | null> {
    this.gets.push(key);
    const value = this.store.get(key);
    return value === undefined ? null : new FakeR2Object(value);
  }

  /** Pre-load an object as if an earlier tick or an offline publish had written it — never counted in `puts`/`gets`. */
  seed(key: string, body: string): void {
    this.store.set(key, body);
  }

  peek(key: string): string | undefined {
    return this.store.get(key);
  }
}

class FakeKvNamespace {
  constructor(private readonly values: Map<string, string>) {}
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const NOW_MS = Date.parse("2026-08-22T12:00:00.000Z");
const SEASON = 2026;
const EVENT_KEY = "2026casj";
const RED_TEAMS = ["frc1", "frc2", "frc3"];
const BLUE_TEAMS = ["frc4", "frc5", "frc6"];
const ALL_TEAMS = [...RED_TEAMS, ...BLUE_TEAMS];
const DISABLE_GLOBAL_REBUILD = { globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER };

interface MatchFixture {
  readonly matchNumber: number;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly redScore: number;
  readonly blueScore: number;
}

/** Three matches, folded one per tick, so tick N resumes what tick N-1 wrote — the property the live block's append behaviour rests on. */
const MATCHES: readonly MatchFixture[] = [
  { matchNumber: 1, redTeams: RED_TEAMS, blueTeams: BLUE_TEAMS, redScore: 120, blueScore: 95 },
  { matchNumber: 2, redTeams: ["frc2", "frc4", "frc6"], blueTeams: ["frc1", "frc3", "frc5"], redScore: 99, blueScore: 147 },
  { matchNumber: 3, redTeams: ["frc5", "frc1", "frc4"], blueTeams: ["frc6", "frc2", "frc3"], redScore: 126, blueScore: 118 },
];

function matchKeyOf(f: MatchFixture): string {
  return `${EVENT_KEY}_qm${f.matchNumber}`;
}

function tbaMatch(f: MatchFixture, played: boolean): unknown {
  return {
    key: matchKeyOf(f),
    event_key: EVENT_KEY,
    comp_level: "qm",
    set_number: 1,
    match_number: f.matchNumber,
    time: null,
    predicted_time: played ? null : Math.floor(NOW_MS / 1000) + 3600,
    actual_time: played ? Math.floor(NOW_MS / 1000) - 60 : null,
    winning_alliance: played ? (f.redScore > f.blueScore ? "red" : "blue") : "",
    alliances: {
      red: { team_keys: f.redTeams, surrogate_team_keys: [], dq_team_keys: [], score: played ? f.redScore : null },
      blue: { team_keys: f.blueTeams, surrogate_team_keys: [], dq_team_keys: [], score: played ? f.blueScore : null },
    },
    score_breakdown: null,
  };
}

/** How many of `MATCHES` are revealed as PLAYED by the TBA stub. Advanced between ticks. */
let revealed = 0;

function makeTbaFetchStub(eventType = 0): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    if (/\/event\/[^/]+\/matches$/.test(u)) {
      const body = MATCHES.map((f, i) => tbaMatch(f, i < revealed));
      return { status: 200, ok: true, headers: { get: (name: string) => (name === "etag" ? `etag-${revealed}` : null) }, json: async () => body };
    }
    if (/\/event\/[^/]+$/.test(u)) {
      // `tbaEventSchema` REQUIRES `name`; omitting it throws inside
      // `processEvent`'s swallowed try/catch and silently degrades `eventType`
      // to the `-1` sentinel (which counts as official), regardless of what
      // this stub was asked to report. `scheduled.test.ts` carries the same
      // note for the same reason.
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ key: EVENT_KEY, name: EVENT_KEY, year: SEASON, event_type: eventType, start_date: "2026-08-01" }) };
    }
    throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
  });
}

function algorithmsManifest(ids: readonly string[]): string {
  const algorithms = ids.map((id) =>
    id === "spr"
      ? { id: "spr", version: spr.version, codeVersion: spr.version.split("+")[0]!, paramSetName: spr.version.split("+")[1] ?? "baseline" }
      : { id: "opr", version: opr.version, codeVersion: opr.version.split("+")[0]!, paramSetName: opr.version.split("+")[1] ?? "baseline" }
  );
  return JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", algorithms });
}

function makeKv(ids: readonly string[] = ["opr"]): FakeKvNamespace {
  const windows = [{ eventKey: EVENT_KEY, season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000, inferred: false }];
  return new FakeKvNamespace(
    new Map([
      [LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", windows })],
      [ALGORITHMS_MANIFEST_KEY, algorithmsManifest(ids)],
    ])
  );
}

function makeEnv(kv: FakeKvNamespace, d1: FakeD1Database, r2: FakeR2Bucket, overrides: Partial<Env> = {}): Env {
  return {
    DB: d1 as unknown as D1Database,
    ARTIFACTS: r2 as unknown,
    MANIFEST: kv as unknown,
    TBA_API_KEY: "test-key",
    TBA_BASE_URL: "https://tba.example.invalid/api/v3",
    LIVE_ALGORITHM_IDS: "opr",
    ...overrides,
  } as Env;
}

function eventKeyFor(algorithmId: "opr" | "spr"): string {
  return artifactKey({ page: "event", eventKey: EVENT_KEY, algorithmId, version: algorithmId === "spr" ? spr.version : opr.version });
}

/**
 * A minimal but SCHEMA-VALID published event body carrying a given live block
 * — the shape a prior tick would have left in R2. Built here rather than by
 * driving a tick, because the point is a block this tick could NOT have
 * written.
 */
function seededEventBody(live: EventLiveBlock): unknown {
  return {
    schemaVersion: 1,
    generation: "gen-seed",
    computedAt: "2026-08-20T00:00:00.000Z",
    algorithmId: "opr",
    algorithmVersion: opr.version,
    eventKey: EVENT_KEY,
    season: SEASON,
    matches: [],
    upcoming: [],
    teams: [],
    live,
  };
}

/** The live block off a written event body, through the REAL shipped schema — never a hand-reach into the raw JSON. */
function liveBlockOf(body: string | undefined): EventLiveBlock | undefined {
  expect(body, "no event body was written at all").toBeDefined();
  return LiveEventArtifactSchema.parse(JSON.parse(body!)).live;
}

/** Drives `tickCount` ticks over the shared env, revealing one more played match each time. */
async function driveTicks(env: Env, tickCount: number): Promise<void> {
  for (let i = 0; i < tickCount; i++) {
    revealed = i + 1;
    const result = await runTick(env, { nowMs: NOW_MS + i * 60_000, ...DISABLE_GLOBAL_REBUILD });
    expect(result.eventsFailed, `tick ${i}`).toBe(0);
    expect(result.eventsAdvanced, `tick ${i}`).toBe(1);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  revealed = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("the live tick's team half is ZERO R2 calls", () => {
  it("issues no team-artifact GET and no team-artifact PUT across three folding ticks", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(makeKv(), new FakeD1Database(), r2);
    vi.stubGlobal("fetch", makeTbaFetchStub());

    await driveTicks(env, 3);

    // Reads matter as much as writes: a read costs a subrequest and a round
    // trip whether or not a write follows it, and the old loop paid one per
    // touched team per algorithm per tick.
    expect(r2.gets.filter((key) => key.startsWith("v1/team/"))).toEqual([]);
    expect(r2.puts.filter((p) => p.key.startsWith("v1/team/"))).toEqual([]);

    // Non-vacuity: the tick really did do Phase B work on this event.
    const eventKeyPath = artifactKey({ page: "event", eventKey: EVENT_KEY, algorithmId: "opr", version: opr.version });
    expect(r2.puts.filter((p) => p.key === eventKeyPath)).toHaveLength(3);
  });

  it("issues exactly TWO R2 calls per algorithm-event — the event artifact, read then written — and NOTHING else", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(makeKv(), new FakeD1Database(), r2);
    vi.stubGlobal("fetch", makeTbaFetchStub());

    await driveTicks(env, 3);

    expect(r2.gets.filter((key) => key === eventKeyFor("opr"))).toHaveLength(3);
    expect(r2.puts.filter((p) => p.key === eventKeyFor("opr"))).toHaveLength(3);
    // BY EQUALITY, not by the absence of a named prefix: every PER-EVENT R2
    // call this tick makes is one of those two, on every tick. A third
    // per-event object reintroduced anywhere would fail here by name rather
    // than slip past a prefix filter that did not know to look for it — and
    // any per-event object is necessarily keyed by the event key, which is what
    // makes this filter exhaustive rather than merely suggestive.
    //
    // `v1/teams/{year}` is deliberately outside the filter: it is the global
    // rebuild's SEASON-wide feed, not per-event work, and it is asserted by the
    // teams-bookkeeping cases at the bottom of this file.
    expect(new Set(r2.gets.filter((key) => key.includes(EVENT_KEY)))).toEqual(new Set([eventKeyFor("opr")]));
    // Since quick task 260921-5qw a FIRST fold also writes the event's live roster, the tiny object a
    // robot page finds a promoted event through. It is one object per EVENT, not per algorithm, and it
    // is written only when the roster grew, so never on an ordinary tick.
    expect(new Set(r2.puts.filter((p) => p.key.includes(EVENT_KEY)).map((p) => p.key))).toEqual(new Set([eventKeyFor("opr"), liveRosterKey(EVENT_KEY)]));
    // ONCE across all three ticks: the roster never changed after the first fold.
    expect(r2.puts.filter((p) => p.key === liveRosterKey(EVENT_KEY))).toHaveLength(1);
  });

  it("issues no R2 call whatsoever under the DELETED live-object prefix", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(makeKv(), new FakeD1Database(), r2);
    vi.stubGlobal("fetch", makeTbaFetchStub());

    await driveTicks(env, 3);

    // Spelled as a concatenation on purpose. The module that built this prefix
    // is deleted, so nothing imports it and nothing can re-derive it — and the
    // repo-wide grep gate forbids the literal appearing in source at all.
    const deletedPrefix = "v1/" + "live" + "/";
    expect(r2.gets.filter((key) => key.startsWith(deletedPrefix))).toEqual([]);
    expect(r2.puts.filter((p) => p.key.startsWith(deletedPrefix))).toEqual([]);
  });
});

describe("the live block accumulates across ticks", () => {
  it("appends one row per folded match, in fold order, over three ticks", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(makeKv(), new FakeD1Database(), r2);
    vi.stubGlobal("fetch", makeTbaFetchStub());

    await driveTicks(env, 3);

    const bodies = r2.puts.filter((p) => p.key === eventKeyFor("opr")).map((p) => liveBlockOf(p.body)!);
    expect(bodies.map((block) => block.rows.map((row) => row.m))).toEqual([
      [`${EVENT_KEY}_qm1`],
      [`${EVENT_KEY}_qm1`, `${EVENT_KEY}_qm2`],
      [`${EVENT_KEY}_qm1`, `${EVENT_KEY}_qm2`, `${EVENT_KEY}_qm3`],
    ]);
  });

  it("carries each match's own roster, and each team's own post-match metrics", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(makeKv(), new FakeD1Database(), r2);
    vi.stubGlobal("fetch", makeTbaFetchStub());

    await driveTicks(env, 3);

    const artifact = LiveEventArtifactSchema.parse(JSON.parse(r2.peek(eventKeyFor("opr"))!));
    // THE FOUR IDENTITY FIELDS THE BLOCK DROPPED are stated by the artifact it
    // rides inside — which is the whole reason it may drop them, and where
    // `extendMetricHistory` now reads them from.
    expect(artifact.eventKey).toBe(EVENT_KEY);
    expect(artifact.season).toBe(SEASON);
    expect(artifact.algorithmId).toBe("opr");
    expect(artifact.algorithmVersion).toBe(opr.version);
    // And the block itself is EXACTLY those two keys, with no wrapper at all.
    const final = artifact.live!;
    expect(Object.keys(final)).toEqual(["metricKeys", "rows"]);

    expect(final.metricKeys).toContain(TOTAL_METRIC_KEY);
    for (const [i, row] of final.rows.entries()) {
      const fixture = MATCHES[i]!;
      expect(new Set(row.t), row.m).toEqual(new Set([...fixture.redTeams, ...fixture.blueTeams]));
      expect(row.v).toHaveLength(row.t.length);
      for (const values of row.v) {
        expect(values).toHaveLength(final.metricKeys.length);
        // Non-vacuity: a row of all-nulls would satisfy the shape and prove nothing.
        expect(values.some((value) => value !== null), row.m).toBe(true);
      }
    }
  });

  it("serializes the block LAST in the written body, after `state`", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(makeKv(), new FakeD1Database(), r2);
    vi.stubGlobal("fetch", makeTbaFetchStub());

    await driveTicks(env, 3);

    // Key ORDER is a real property of the body, not an incidental one: the
    // event page needs `state` for first paint and never reads `live`, so the
    // block only the robot and match pages read goes at the very end.
    const written = JSON.parse(r2.peek(eventKeyFor("opr"))!) as Record<string, unknown>;
    expect(Object.keys(written).at(-1)).toBe("live");
  });

  it("carries Sigma as an ordinary metric key for a Sigma algorithm, and not at all for OPR", async () => {
    const sprR2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub());
    await driveTicks(makeEnv(makeKv(["spr"]), new FakeD1Database(), sprR2, { LIVE_ALGORITHM_IDS: "spr" }), 3);
    expect(liveBlockOf(sprR2.peek(eventKeyFor("spr")))!.metricKeys).toContain(SIGMA_METRIC_KEY);

    const oprR2 = new FakeR2Bucket();
    await driveTicks(makeEnv(makeKv(), new FakeD1Database(), oprR2), 3);
    expect(liveBlockOf(oprR2.peek(eventKeyFor("opr")))!.metricKeys).not.toContain(SIGMA_METRIC_KEY);
  });
});

describe("the live block's failure modes are logged, not silent", () => {
  it("is covered by the EVENT WRITE's own secret scrub, because the rows are inside the body it already scrubs (T-260918-16t-04)", async () => {
    const r2 = new FakeR2Bucket();
    // `"metricKeys"` appears in the LIVE BLOCK and nowhere else in an event
    // body, so a secret equal to it can only be caught by a scrub that sees
    // the block — which is the whole claim. The sidecar had its own separate
    // scrub; this shape needs none, because `writeArtifactObject` already
    // scrubs the entire serialized event body before the put and before the
    // budget consume.
    const env = makeEnv(makeKv(), new FakeD1Database(), r2, { TBA_API_KEY: "metricKeys" });
    vi.stubGlobal("fetch", makeTbaFetchStub());

    revealed = 1;
    await runTick(env, { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });

    // ZERO puts, not a stripped one: validate-then-persist means the refusal
    // costs no subrequest and reaches R2 with nothing at all.
    expect(r2.puts.filter((p) => p.key.startsWith("v1/event/"))).toEqual([]);
    // Non-vacuity: without the secret, the same tick writes the body.
    const cleanR2 = new FakeR2Bucket();
    revealed = 1;
    await runTick(makeEnv(makeKv(), new FakeD1Database(), cleanR2), { nowMs: NOW_MS, ...DISABLE_GLOBAL_REBUILD });
    expect(cleanR2.puts.some((p) => p.key.startsWith("v1/event/"))).toBe(true);
    expect(liveBlockOf(cleanR2.peek(eventKeyFor("opr")))).toBeDefined();
  });

  it("logs a key-set drift and starts a fresh block rather than mis-aligning the stored rows", async () => {
    const r2 = new FakeR2Bucket();
    // A published event body whose live block was written under a DIFFERENT
    // metric-key header, as a model change under the same version would leave
    // behind. The block itself comes from the REAL merge, so it is a shape the
    // shipped code can actually produce.
    const { block: stale } = mergeEventLiveBlock({
      existing: undefined,
      metricKeys: ["a-key-this-algorithm-does-not-emit"],
      rows: [{ matchKey: `${EVENT_KEY}_qm0`, teamKeys: ["frc1"], valuesByTeam: new Map([["frc1", { "a-key-this-algorithm-does-not-emit": 1 }]]) }],
      existingBodyBytes: 0,
    });
    r2.seed(eventKeyFor("opr"), JSON.stringify(seededEventBody(stale)));

    const env = makeEnv(makeKv(), new FakeD1Database(), r2);
    vi.stubGlobal("fetch", makeTbaFetchStub());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await driveTicks(env, 1);

    const lines = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("event-live-block-drift"));
    warn.mockRestore();
    expect(lines).toHaveLength(1);
    const logged = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(logged.discardedRows).toBe(1);
    // Ids, counts and lengths only — never a body.
    expect(logged.eventKey).toBe(EVENT_KEY);
    expect(logged.algorithmId).toBe("opr");

    const written = liveBlockOf(r2.peek(eventKeyFor("opr")))!;
    expect(written.rows.map((row) => row.m)).toEqual([`${EVENT_KEY}_qm1`]);
    expect(written.metricKeys).not.toContain("a-key-this-algorithm-does-not-emit");
  });
});

describe("runGlobalRebuild's touched-team bookkeeping survived the deleted loop", () => {
  /**
   * THE ONE THING THE TEAM LOOP CARRIED BESIDES ITS ARTIFACT WORK. The loop
   * still runs; only its three R2 calls are gone. Its `seasonMap.set` feeds
   * `touchedTeamsByAlgorithm`, which `runGlobalRebuild` turns into each
   * `teams/{year}` row's `matchCount`. A refactor that deleted the loop
   * wholesale would leave every live `matchCount` frozen at its last
   * published value, silently and with no test failing — so the delta is
   * asserted by VALUE here, not merely by the artifact's existence.
   */
  it("feeds teams/{year} a per-team matchCount delta equal to the matches that team actually played", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(makeKv(), new FakeD1Database(), r2);
    vi.stubGlobal("fetch", makeTbaFetchStub());

    // One tick, global rebuild forced on. Match 1 touches all six teams once.
    revealed = 1;
    const result = await runTick(env, { nowMs: NOW_MS, globalRebuildIntervalMs: 0 });
    expect(result.eventsAdvanced).toBe(1);
    expect(result.globalRebuildRan).toBe(true);

    const teamsKey = artifactKey({ page: "teams", year: SEASON, algorithmId: "opr", version: opr.version });
    const teamsBody = r2.peek(teamsKey);
    expect(teamsBody, "the global rebuild wrote no teams artifact").toBeDefined();
    const teams = TeamsArtifactSchema.parse(JSON.parse(teamsBody!));
    for (const teamKey of ALL_TEAMS) {
      const row = teams.teams.find((t) => t.teamKey === teamKey);
      expect(row, teamKey).toBeDefined();
      expect(row!.matchCount, teamKey).toBe(1);
      // And the metrics really came off this tick's fold, not a placeholder —
      // a row whose metrics are empty would satisfy `matchCount` and prove the
      // feed carried a count but no values.
      // `TeamsArtifactSchema` DECODES either wire shape into a record on parse,
      // so this reads the record directly rather than re-decoding positionally.
      expect(row!.metrics, teamKey).toHaveProperty(TOTAL_METRIC_KEY);
    }
  });

  it("stays gated on officialness: an offseason (event_type 99) tick writes the live rows and contributes NO team row at all", async () => {
    const r2 = new FakeR2Bucket();
    const env = makeEnv(makeKv(), new FakeD1Database(), r2);
    vi.stubGlobal("fetch", makeTbaFetchStub(99));

    revealed = 1;
    const result = await runTick(env, { nowMs: NOW_MS, globalRebuildIntervalMs: 0 });
    expect(result.eventsAdvanced).toBe(1);

    // The event write (and so the live rows inside it) is unconditional; the
    // `teams/{year}` FEED is what the `isOfficial` gate guards, and it is the
    // gate that had to survive the loop's rewrite.
    expect(liveBlockOf(r2.peek(eventKeyFor("opr")))?.rows).toHaveLength(1);
    const teamsBody = r2.peek(artifactKey({ page: "teams", year: SEASON, algorithmId: "opr", version: opr.version }));
    if (teamsBody !== undefined) {
      const teams = TeamsArtifactSchema.parse(JSON.parse(teamsBody));
      for (const teamKey of ALL_TEAMS) {
        expect(teams.teams.some((t) => t.teamKey === teamKey), `${teamKey} must not be fed by an offseason event`).toBe(false);
      }
    }
  });
});
