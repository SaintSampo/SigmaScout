/**
 * Ranking points on live rows: the live path must produce the same pmf the
 * offline publisher would, not merely produce one.
 *
 * Two arms. A "prior" event is folded first and the Worker persists its own
 * RP beliefs into D1; the "live" event is then folded one match per tick,
 * resuming them. The offline arm drives the real `SigmaScoutLayer` (never a
 * hand-rolled accumulator) over the same stream, and the live event's RP rows
 * are compared by digest. Break `withRpBeliefs` or `readRpBeliefs` and the
 * Worker cold-starts every tick and the digests diverge, while every pmf
 * still sums to 1 and renders.
 *
 * `scheduled.replay.test.ts` is the prediction/band equivalence test; its
 * breakdowns are all null, so it produces no RP.
 *
 * The fake D1/R2/KV classes are copied from `scheduled.replay.test.ts`, which
 * exports none of them. Keep them in step.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTick } from "../src/scheduled.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { artifactKey } from "../../../packages/harness/pageArtifacts.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { isOfficialEventType } from "../../../packages/core/algorithms/eventTypes.js";
import { roundPmf } from "../../../packages/harness/rounding.js";
import { SigmaScoutLayer } from "../../../packages/harness/sigmaScoutLayer.js";
import { SigmaScoreAccumulator } from "../../../packages/harness/sigmaScore.js";
import { RpMomentsAccumulator } from "../../../packages/core/rankingPoints/empiricalMoments.js";
import { RP_MEAN_SHIFT_WARMUP_OBSERVATIONS } from "../../../packages/core/rankingPoints/meanShift.js";
import { analyticRpPmf } from "../../../packages/core/rankingPoints/analyticPmf.js";
import type { Prediction, UpcomingMatch } from "../../../packages/core/algorithms/types.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { EVENT_TYPE_TIERS, isRpEligibleEventType } from "../../../packages/core/rankingPoints/constants.js";
import { TOTAL_METRIC_KEY } from "../../../packages/core/algorithms/types.js";
import type { AlgorithmModule, MatchResult } from "../../../packages/core/algorithms/types.js";
import type { Env } from "../src/env.js";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * The final live tick's subrequest cost on this fixture. RP beliefs ride
 * inside rows the tick already reads and writes, so RP costs zero extra
 * subrequests (measured with RP forced off and on: same count). If this has
 * to be raised, the passenger design is broken.
 */
const SUBREQUESTS_PER_LIVE_TICK = 64;

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
  algorithmState = new Map<string, FakeAlgorithmStateRow>();
  eventCursors = new Map<string, FakeEventCursorRow>();

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
      this.eventCursors.set(eventKey!, { event_key: eventKey!, tba_etag: tbaEtag ?? null, last_folded_match_key: lastFoldedMatchKey ?? null, last_polled_at: lastPolledAt ?? null, last_advanced_at: lastAdvancedAt ?? null });
      return 1;
    }
    if (sql.includes("INSERT INTO event_cursor") && sql.includes("WHERE NOT EXISTS")) {
      const [eventKey, tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt] = args as (string | null)[];
      if (this.eventCursors.has(eventKey as string)) return 0;
      this.eventCursors.set(eventKey as string, { event_key: eventKey as string, tba_etag: tbaEtag ?? null, last_folded_match_key: lastFoldedMatchKey ?? null, last_polled_at: lastPolledAt ?? null, last_advanced_at: lastAdvancedAt ?? null });
      return 1;
    }
    // writeEventCursor's own plain upsert — used by writeTickMeta's
    // sentinel row and the "unchanged but ETag moved" path.
    if (sql.includes("INSERT INTO event_cursor")) {
      const [eventKey, tbaEtag, lastFoldedMatchKey, lastPolledAt, lastAdvancedAt] = args as (string | null)[];
      this.eventCursors.set(eventKey as string, { event_key: eventKey as string, tba_etag: tbaEtag ?? null, last_folded_match_key: lastFoldedMatchKey ?? null, last_polled_at: lastPolledAt ?? null, last_advanced_at: lastAdvancedAt ?? null });
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
  private readonly store = new Map<string, string>();
  async put(key: string, body: string): Promise<void> {
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


// Fixture — two events, one season, overlapping rosters.

const SEASON = 2026;
const PRIOR_EVENT_KEY = "2026prior";
const LIVE_EVENT_KEY = "2026casj";
const EVENT_TYPE = 0; // Regional — official AND RP-eligible.
const NOW_MS = Date.parse("2026-08-22T12:00:00.000Z");

const RULES_2026 = RP_RULE_MODULES[SEASON]!;
/** 2026: 3 win RP + 3 bonuses, so a well-formed pmf has `maxRp + 1` entries. */
const PMF_LENGTH = RULES_2026.maxRp + 1;

interface MatchFixture {
  readonly eventKey: string;
  readonly matchNumber: number;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly redScore: number;
  readonly blueScore: number;
  /** Real 2026 threshold inputs — the difference from `scheduled.replay.test.ts`'s fixture, whose breakdowns are all null. */
  readonly redHub: number;
  readonly blueHub: number;
  readonly redTower: number;
  readonly blueTower: number;
}

function fixture(
  eventKey: string,
  matchNumber: number,
  redTeams: readonly string[],
  blueTeams: readonly string[],
  redScore: number,
  blueScore: number,
  redHub: number,
  blueHub: number,
  redTower: number,
  blueTower: number
): MatchFixture {
  return { eventKey, matchNumber, redTeams, blueTeams, redScore, blueScore, redHub, blueHub, redTower, blueTower };
}

/** The prior event: four matches of history per team, so spr starts the live event from warm beliefs. */
const PRIOR_FIXTURES: readonly MatchFixture[] = [
  fixture(PRIOR_EVENT_KEY, 1, ["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"], 120, 95, 140, 90, 42, 28),
  fixture(PRIOR_EVENT_KEY, 2, ["frc4", "frc5", "frc6"], ["frc1", "frc2", "frc3"], 105, 130, 118, 165, 31, 55),
  fixture(PRIOR_EVENT_KEY, 3, ["frc1", "frc4", "frc2"], ["frc3", "frc6", "frc5"], 88, 112, 96, 133, 24, 47),
  fixture(PRIOR_EVENT_KEY, 4, ["frc3", "frc5", "frc1"], ["frc2", "frc6", "frc4"], 145, 138, 172, 151, 60, 52),
];

/** The LIVE event — folded one match per tick, which is what makes tick N resume what tick N-1 wrote. */
const LIVE_FIXTURES: readonly MatchFixture[] = [
  fixture(LIVE_EVENT_KEY, 1, ["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"], 133, 121, 155, 128, 45, 38),
  fixture(LIVE_EVENT_KEY, 2, ["frc2", "frc4", "frc6"], ["frc1", "frc3", "frc5"], 99, 147, 104, 178, 27, 63),
  fixture(LIVE_EVENT_KEY, 3, ["frc5", "frc1", "frc4"], ["frc6", "frc2", "frc3"], 126, 118, 149, 124, 41, 36),
  fixture(LIVE_EVENT_KEY, 4, ["frc6", "frc3", "frc2"], ["frc4", "frc1", "frc5"], 152, 144, 181, 167, 58, 51),
];

const ALL_TEAMS = [...new Set([...PRIOR_FIXTURES, ...LIVE_FIXTURES].flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort();

function matchKeyOf(f: MatchFixture): string {
  return `${f.eventKey}_qm${f.matchNumber}`;
}

function winnerOf(f: MatchFixture): "red" | "blue" {
  return f.redScore > f.blueScore ? "red" : "blue";
}

/** The 2026 score-breakdown shape `rp2026.parse` reads. */
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
    actual_time: Math.floor(NOW_MS / 1000) + f.matchNumber * 60,
    winning_alliance: winnerOf(f),
    alliances: {
      red: { team_keys: f.redTeams, surrogate_team_keys: [], dq_team_keys: [], score: f.redScore },
      blue: { team_keys: f.blueTeams, surrogate_team_keys: [], dq_team_keys: [], score: f.blueScore },
    },
    score_breakdown: breakdownOf(f),
  };
}

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
    eventType: EVENT_TYPE,
    week: null,
    winner: winnerOf(f),
    redScore: f.redScore,
    blueScore: f.blueScore,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: JSON.stringify(breakdownOf(f)),
  };
}

// Mutated by the driving loop: how many of each event's matches TBA has
// revealed so far.
let revealedPrior = 0;
let revealedLive = 0;

function makeTbaFetchStub(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    const matchesRoute = /\/event\/([^/]+)\/matches$/.exec(u);
    if (matchesRoute) {
      const eventKey = matchesRoute[1]!;
      const revealed = (eventKey === PRIOR_EVENT_KEY ? PRIOR_FIXTURES.slice(0, revealedPrior) : LIVE_FIXTURES.slice(0, revealedLive)).map(toTbaMatch);
      return {
        status: 200,
        ok: true,
        headers: { get: (name: string) => (name === "etag" ? `etag-${eventKey}-${revealed.length}` : null) },
        json: async () => revealed,
      };
    }
    const detailRoute = /\/event\/([^/]+)$/.exec(u);
    if (detailRoute) {
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        // `name` is required by `tbaEventSchema`; without it the detail parse
        // silently degrades to `eventType = -1`, gating RP off on every row.
        json: async () => ({ key: detailRoute[1]!, name: "Test Event", year: SEASON, event_type: EVENT_TYPE, start_date: "2026-08-01" }),
      };
    }
    throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
  });
}

function liveWindowsManifest(): string {
  const windows = [PRIOR_EVENT_KEY, LIVE_EVENT_KEY].map((eventKey) => ({
    eventKey,
    season: SEASON,
    startMs: NOW_MS - 3_600_000,
    endMs: NOW_MS + 3_600_000,
    inferred: false,
  }));
  return JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", windows });
}

function algorithmsManifestJson(): string {
  const algorithms = [
    { id: "opr", version: "3.0.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" },
    { id: "epa", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" },
    { id: "spr", version: "2.0.0+test", codeVersion: "2.0.0", paramSetName: "test" },
  ];
  return JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", algorithms });
}

function makeEnv(kv: FakeKvNamespace, d1: FakeD1Database, r2: FakeR2Bucket): Env {
  return {
    DB: d1 as unknown as D1Database,
    ARTIFACTS: r2 as unknown,
    MANIFEST: kv as unknown,
    TBA_API_KEY: "test-key",
    TBA_BASE_URL: "https://tba.example.invalid/api/v3",
    LIVE_ALGORITHM_IDS: "opr,epa,spr",
  } as Env;
}

function buildOfflineModule(id: string): AlgorithmModule<any> {
  if (id === "opr") return opr;
  if (id === "epa") return epa;
  if (id === "spr") return spr;
  throw new Error(`buildOfflineModule: no module for algorithm id "${id}"`);
}

/** Digest of matchKey plus both ROUNDED pmfs per row; both arms use the same `roundPmf`, so rounding cannot fake agreement or divergence. */
function computeRpStreamDigest(
  rows: readonly { matchKey: string; red: readonly number[] | undefined; blue: readonly number[] | undefined }[]
): string {
  return createHash("sha256")
    .update(rows.map((r) => JSON.stringify([r.matchKey, r.red ?? null, r.blue ?? null])).join("\n"))
    .digest("hex");
}

interface OfflineRow {
  readonly matchKey: string;
  readonly red: readonly number[] | undefined;
  readonly blue: readonly number[] | undefined;
}

/** Drives the REAL `SigmaScoutLayer` over the whole chronological stream and returns the LIVE event's RP rows. */
function offlineRpRows(algorithmId: string): OfflineRow[] {
  const module = buildOfflineModule(algorithmId);
  const layer = new SigmaScoutLayer(RULES_2026, algorithmId);
  let state: unknown = module.initState([...ALL_TEAMS]);
  const rows: OfflineRow[] = [];

  for (const f of [...PRIOR_FIXTURES, ...LIVE_FIXTURES]) {
    const result = toMatchResult(f);
    const prediction = module.predict(state, toLeakProofUpcoming(result));
    state = module.update(state, result);
    const roster = [...result.redTeams, ...result.blueTeams];
    const metrics = module.teamMetrics(state, roster);
    const talent = new Map<string, number>();
    for (const teamKey of roster) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    const enriched = layer.foldPlayed(result, prediction, talent);
    if (f.eventKey !== LIVE_EVENT_KEY) continue;
    rows.push({
      matchKey: result.matchKey,
      red: enriched.prediction.redRpPmf ? roundPmf(enriched.prediction.redRpPmf) : undefined,
      blue: enriched.prediction.blueRpPmf ? roundPmf(enriched.prediction.blueRpPmf) : undefined,
    });
  }
  return rows;
}

interface PublishedMatchRow {
  readonly matchKey: string;
  readonly redRpPmf?: readonly number[];
  readonly blueRpPmf?: readonly number[];
  readonly matchOutcomePmf?: readonly number[];
  readonly redBonusRpPmf?: readonly number[];
  readonly blueBonusRpPmf?: readonly number[];
}

afterEach(() => {
  vi.unstubAllGlobals();
  revealedPrior = 0;
  revealedLive = 0;
});

describe("scheduled.rp — ranking points on live rows", () => {
  async function driveFixture(): Promise<{ r2: FakeR2Bucket; lastSubrequests: number }> {
    const kv = new FakeKvNamespace(
      new Map([
        [LIVE_WINDOWS_MANIFEST_KEY, liveWindowsManifest()],
        [ALGORITHMS_MANIFEST_KEY, algorithmsManifestJson()],
      ])
    );
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub());
    const env = makeEnv(kv, d1, r2);

    // Phase 1: the whole prior event. Nothing is hand-seeded; the Worker
    // persists its own RP beliefs, as production would.
    revealedPrior = PRIOR_FIXTURES.length;
    for (let i = 0; i < PRIOR_FIXTURES.length; i++) {
      const priorResult = await runTick(env, { nowMs: NOW_MS + i * 60_000, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER, subrequestCap: 1000, subrequestReserve: 0 });
      expect(priorResult.eventsFailed).toBe(0);
    }

    // Phase 2: the live event, one match per tick; tick N resumes what tick N-1 wrote.
    let lastSubrequests = 0;
    for (let i = 0; i < LIVE_FIXTURES.length; i++) {
      revealedLive = i + 1;
      const result = await runTick(env, { nowMs: NOW_MS + (PRIOR_FIXTURES.length + i) * 60_000, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER, subrequestCap: 1000, subrequestReserve: 0 });
      expect(result.eventsFailed).toBe(0);
      lastSubrequests = result.subrequestsUsed;
    }
    return { r2, lastSubrequests };
  }

  async function publishedLiveRows(r2: FakeR2Bucket, algorithmId: string): Promise<PublishedMatchRow[]> {
    const module = buildOfflineModule(algorithmId);
    const key = artifactKey({ page: "event", eventKey: LIVE_EVENT_KEY, algorithmId, version: module.version });
    const text = await r2.get(key);
    expect(text, `no published event artifact at ${key} for algorithm "${algorithmId}"`).not.toBeNull();
    const artifact = JSON.parse(await text!.text()) as { matches: PublishedMatchRow[] };
    const byKey = new Map(artifact.matches.map((m) => [m.matchKey, m]));
    return LIVE_FIXTURES.map((f) => byKey.get(matchKeyOf(f))!);
  }

  it(
    "a PLAYED qualification row on a live tick carries a well-formed redRpPmf and blueRpPmf",
    async () => {
      const { r2 } = await driveFixture();
      const rows = await publishedLiveRows(r2, "spr");

      // Non-vacuity first: a fixture producing no pmf would pass everything below.
      const withPmf = rows.filter((r) => r?.redRpPmf !== undefined && r?.blueRpPmf !== undefined);
      expect(
        withPmf.length,
        "the fixture produced NO played row carrying an RP pmf at all, so every assertion below would be vacuous"
      ).toBeGreaterThan(0);

      for (const row of withPmf) {
        for (const pmf of [row.redRpPmf!, row.blueRpPmf!]) {
          expect(pmf).toHaveLength(PMF_LENGTH);
          expect(pmf.every((p) => Number.isFinite(p))).toBe(true);
          expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
        }
      }
    },
    60_000
  );

  it(
    "spr: the LIVE pmf stream EQUALS an independent offline SigmaScoutLayer replay of the same matches",
    async () => {
      const { r2 } = await driveFixture();
      const algorithmId = "spr";
      const offline = offlineRpRows(algorithmId);
      // Non-vacuity on the offline arm too: two empty streams digest identically.
      expect(
        offline.filter((r) => r.red !== undefined || r.blue !== undefined).length,
        `algorithm "${algorithmId}": the offline arm produced no pmf at all, so the digest comparison would be vacuous`
      ).toBeGreaterThan(0);

      const online = (await publishedLiveRows(r2, algorithmId)).map((row) => ({
        matchKey: row.matchKey,
        red: row.redRpPmf,
        blue: row.blueRpPmf,
      }));

      expect(
        computeRpStreamDigest(online),
        `algorithm "${algorithmId}": the live (deployed-tick) and offline (SigmaScoutLayer) RP pmf streams diverged — the live Worker priced these matches from a different history`
      ).toBe(computeRpStreamDigest(offline));
    },
    60_000
  );

  /** OPR and EPA publish no ranking points, live or offline. */
  async function expectNoRpLiveOrOffline(r2: FakeR2Bucket, algorithmId: "opr" | "epa"): Promise<void> {
    const offline = offlineRpRows(algorithmId);
    expect(offline.length, `algorithm "${algorithmId}": the offline arm produced rows`).toBe(LIVE_FIXTURES.length);
    expect(offline.every((r) => r.red === undefined && r.blue === undefined), `algorithm "${algorithmId}": offline pmf present`).toBe(true);

    const online = await publishedLiveRows(r2, algorithmId);
    expect(online.every((row) => row !== undefined), `algorithm "${algorithmId}": every live fixture match was published`).toBe(true);
    for (const row of online) {
      expect(row.redRpPmf, `algorithm "${algorithmId}": live redRpPmf on ${row.matchKey}`).toBeUndefined();
      expect(row.blueRpPmf, `algorithm "${algorithmId}": live blueRpPmf on ${row.matchKey}`).toBeUndefined();
      expect(row.matchOutcomePmf, `algorithm "${algorithmId}": live matchOutcomePmf on ${row.matchKey}`).toBeUndefined();
    }
  }

  it(
    "opr and epa: neither the live tick nor the offline layer produces a ranking-point pmf",
    async () => {
      const { r2 } = await driveFixture();
      await expectNoRpLiveOrOffline(r2, "opr");
      await expectNoRpLiveOrOffline(r2, "epa");
    },
    60_000
  );

  it(
    "the decomposition fields reach live PLAYED rows alongside the totals",
    async () => {
      const { r2 } = await driveFixture();
      const rows = await publishedLiveRows(r2, "spr");
      const decomposed = rows.filter((r) => r?.matchOutcomePmf !== undefined);
      expect(
        decomposed.length,
        "no played row carried the decomposition, so the rank simulation would silently fall back to the legacy path on every live row"
      ).toBeGreaterThan(0);
      for (const row of decomposed) {
        expect(row.matchOutcomePmf).toHaveLength(3);
        expect(row.matchOutcomePmf!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
        expect(row.redBonusRpPmf!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
        expect(row.blueBonusRpPmf!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      }
    },
    60_000
  );

  it(
    "TIE SHIPPED (WIN+TIE arm): some live decomposed row carries a nonzero matchOutcomePmf[1] — a live tick is not silently stuck on a structural zero",
    async () => {
      const { r2 } = await driveFixture();
      const rows = await publishedLiveRows(r2, "spr");
      const decomposed = rows.filter((r) => r?.matchOutcomePmf !== undefined);
      expect(decomposed.length, "no played row carried the decomposition, so the tie assertion below would be vacuous").toBeGreaterThan(0);
      expect(
        decomposed.some((row) => row.matchOutcomePmf![1]! > 0),
        "no live row carried a nonzero tie probability — WIN+TIE ships (data/baselines/rp-outcome-arms-2026-09.json), so every varianceD > 0 row should"
      ).toBe(true);
    },
    60_000
  );

  it(
    "the artifact carries this season's own win/tie RP constants once, read off the rule module rather than hardcoded",
    async () => {
      const { r2 } = await driveFixture();
      const key = artifactKey({ page: "event", eventKey: LIVE_EVENT_KEY, algorithmId: "spr", version: spr.version });
      const artifact = JSON.parse(await (await r2.get(key))!.text()) as { rpOutcomeRp?: { win: number; tie: number } };
      expect(artifact.rpOutcomeRp).toEqual({ win: RULES_2026.winRp, tie: RULES_2026.tieRp });
    },
    60_000
  );

  it(
    "RP costs ZERO additional D1 subrequests — the beliefs ride inside rows the tick already reads and writes",
    async () => {
      const { lastSubrequests } = await driveFixture();
      expect(
        lastSubrequests,
        "the tick's subrequest count changed: RP must ride as a passenger key inside the team rows the tick already touches, never as its own D1 round-trip"
      ).toBe(SUBREQUESTS_PER_LIVE_TICK);
    },
    60_000
  );

  it(
    "an UPCOMING match naming a team this tick never touched emits NO pmf rather than one built from a partial roster",
    async () => {
      const { r2 } = await driveFixture();
      const key = artifactKey({ page: "event", eventKey: LIVE_EVENT_KEY, algorithmId: "spr", version: spr.version });
      const artifact = JSON.parse(await (await r2.get(key))!.text()) as {
        upcoming: { matchKey: string; redTeams: string[]; blueTeams: string[]; redRpPmf?: number[] }[];
      };
      // `momentsFor` sums silently over whatever beliefs it finds, so a
      // partially-resumed roster would yield a NARROWER, more confident pmf
      // than the truth with nothing reporting a problem. Every upcoming row
      // whose roster is not fully resumed must therefore carry nothing.
      for (const row of artifact.upcoming) {
        const roster = [...row.redTeams, ...row.blueTeams];
        if (roster.some((t) => !ALL_TEAMS.includes(t))) {
          expect(row.redRpPmf, `upcoming ${row.matchKey} emitted a pmf despite an unresumed roster member`).toBeUndefined();
        }
      }
    },
    60_000
  );

  it("a season with NO registered RP rules yields no accumulator rather than throwing — the Worker must INDEX the registry, never call rpRuleModuleForSeason", async () => {
    // 2021 has no RP rule module; the Worker indexes `RP_RULE_MODULES`
    // directly (never the throwing `rpRuleModuleForSeason`) and degrades to no RP.
    expect(RP_RULE_MODULES[2021]).toBeUndefined();
    const { rpRuleModuleForSeason } = await import("../../../packages/core/rankingPoints/rules.js");
    expect(() => rpRuleModuleForSeason(2021)).toThrow();

    // Not driven end-to-end: 2021 also has no score-component map, so a 2021
    // fixture fails in `spr` before RP is consulted.
    expect(Object.keys(RP_RULE_MODULES)).not.toContain("2021");
  });

  it("every event type the Worker will PROCESS is RP-eligible, so the eventType gate is defence in depth rather than a live branch", () => {
    // Not driven end-to-end: every official event type is in
    // `EVENT_TYPE_TIERS`, so no live tick reaches `rpFieldsFor`'s eventType
    // gate with an ineligible value.
    for (const eventType of [0, 1, 2, 3, 4, 5]) {
      expect(isOfficialEventType(eventType), `event type ${eventType}`).toBe(true);
      expect(isRpEligibleEventType(eventType), `event type ${eventType}`).toBe(true);
    }
    expect(isOfficialEventType(99)).toBe(false);
    expect(isRpEligibleEventType(99)).toBe(false);
    expect(Object.keys(EVENT_TYPE_TIERS)).not.toContain("99");
  });
});

// ---------------------------------------------------------------------------
// The walk-forward mean shift, live.
//
// The block above never passes the 200-observation warmup, so it cannot see
// the shift. This block generates a prior event long enough to pass it
// naturally (no hand-seeded passenger), then runs a live event one match per
// tick; each tick must resume the shift the previous tick wrote to the league
// row, or the live and offline digests diverge.
// ---------------------------------------------------------------------------

const MS_PRIOR_EVENT_KEY = "2026msprior";
const MS_LIVE_EVENT_KEY = "2026mslive";
const MS_PRIOR_MATCHES = 120;
const MS_LIVE_PLAYED = 6;
const MS_LIVE_UPCOMING = 2;

/** A roster rotation over the six fixture teams, alternating two alliance splits so partners vary. */
function msRoster(k: number): { red: string[]; blue: string[] } {
  const teams = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];
  const r = k % 6;
  const rotated = [...teams.slice(r), ...teams.slice(0, r)];
  const red = k % 2 === 0 ? rotated.slice(0, 3) : [rotated[0]!, rotated[2]!, rotated[4]!];
  return { red, blue: teams.filter((t) => !red.includes(t)) };
}

/**
 * Match `k` of the generated stream (the prior event, then the live event).
 * Both threshold inputs TREND UP, so recency-weighted beliefs lag and the
 * residuals are positive on balance: a nonzero shift by construction. Tower
 * points stay on their 5-point lattice inside [0, 120].
 */
function msFixture(eventKey: string, matchNumber: number, k: number): MatchFixture {
  const { red, blue } = msRoster(k);
  const hub = (side: number) => Math.max(0, Math.round(60 + 0.9 * k + (((k * 37 + side * 11) % 31) - 15)));
  const tower = (side: number) => 5 * Math.min(24, Math.max(0, Math.round(4 + 0.06 * k + (((k * 13 + side * 7) % 9) - 4))));
  const redHub = hub(0);
  const blueHub = hub(1);
  const redTower = tower(0);
  const blueTower = tower(1);
  const redScore = redHub + redTower + 20;
  const blueScore = blueHub + blueTower + 20 === redScore ? redScore - 1 : blueHub + blueTower + 20;
  return fixture(eventKey, matchNumber, red, blue, redScore, blueScore, redHub, blueHub, redTower, blueTower);
}

const MS_PRIOR_FIXTURES: readonly MatchFixture[] = Array.from({ length: MS_PRIOR_MATCHES }, (_, i) => msFixture(MS_PRIOR_EVENT_KEY, i + 1, i));
const MS_LIVE_FIXTURES: readonly MatchFixture[] = Array.from({ length: MS_LIVE_PLAYED + MS_LIVE_UPCOMING }, (_, i) =>
  msFixture(MS_LIVE_EVENT_KEY, i + 1, MS_PRIOR_MATCHES + i)
);

/** A not-yet-played TBA match: negative scores, no winner, no breakdown. */
function toUpcomingTbaMatch(f: MatchFixture): unknown {
  return {
    key: matchKeyOf(f),
    event_key: f.eventKey,
    comp_level: "qm",
    set_number: 1,
    match_number: f.matchNumber,
    time: Math.floor(NOW_MS / 1000) + f.matchNumber * 60,
    predicted_time: null,
    actual_time: null,
    winning_alliance: "",
    alliances: {
      red: { team_keys: f.redTeams, surrogate_team_keys: [], dq_team_keys: [], score: -1 },
      blue: { team_keys: f.blueTeams, surrogate_team_keys: [], dq_team_keys: [], score: -1 },
    },
    score_breakdown: null,
  };
}

function toUpcomingMatchView(f: MatchFixture): UpcomingMatch {
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
    eventType: EVENT_TYPE,
    week: null,
  };
}

interface MsRow {
  readonly matchKey: string;
  readonly red: readonly number[] | undefined;
  readonly blue: readonly number[] | undefined;
  readonly redBonus: readonly number[] | undefined;
  readonly blueBonus: readonly number[] | undefined;
}

function msDigest(rows: readonly MsRow[]): string {
  return createHash("sha256")
    .update(rows.map((r) => JSON.stringify([r.matchKey, r.red ?? null, r.blue ?? null, r.redBonus ?? null, r.blueBonus ?? null])).join("\n"))
    .digest("hex");
}

function msRowOf(matchKey: string, prediction: Prediction): MsRow {
  return {
    matchKey,
    red: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blue: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    redBonus: prediction.redBonusRpPmf ? roundPmf(prediction.redBonusRpPmf) : undefined,
    blueBonus: prediction.blueBonusRpPmf ? roundPmf(prediction.blueBonusRpPmf) : undefined,
  };
}

interface MsOffline {
  /** Live played rows, then the live upcoming rows as of after the last played match. */
  readonly shifted: MsRow[];
  /** The same rows priced WITHOUT the mean shift, from the test's own accumulators. */
  readonly unshifted: MsRow[];
  /** Prior-event rows from both arms, for the reference's own faithfulness check. */
  readonly priorShifted: MsRow[];
  readonly priorUnshifted: MsRow[];
  /** The layer's mean-shift state immediately before the first live match. */
  readonly stateBeforeLive: ReturnType<SigmaScoutLayer["rpMeanShiftState"]>;
}

/**
 * The offline arm: the real `SigmaScoutLayer` over the whole stream, beside an
 * unshifted reference built from the test's own accumulators and
 * `analyticRpPmf`, which proves the shift actually moves the live rows.
 */
function msOffline(): MsOffline {
  const layer = new SigmaScoutLayer(RULES_2026, "spr");
  const reference = new RpMomentsAccumulator(RULES_2026);
  const referenceSigma = new SigmaScoreAccumulator();
  let state = spr.initState([...ALL_TEAMS]);
  const out: MsOffline = { shifted: [], unshifted: [], priorShifted: [], priorUnshifted: [], stateBeforeLive: undefined };
  let stateBeforeLive: MsOffline["stateBeforeLive"];

  const unshiftedFields = (view: { redTeams: readonly string[]; blueTeams: readonly string[] }, prediction: Prediction): Prediction => {
    const redVariance = referenceSigma.bandVarianceFor(view.redTeams);
    const blueVariance = referenceSigma.bandVarianceFor(view.blueTeams);
    if (redVariance === undefined || blueVariance === undefined) return prediction;
    const pmf = analyticRpPmf({
      red: reference.momentsFor(view.redTeams, prediction.redScore, redVariance),
      blue: reference.momentsFor(view.blueTeams, prediction.blueScore, blueVariance),
      ruleModule: RULES_2026,
      eventType: EVENT_TYPE,
      compLevel: "qm",
      pRedWin: prediction.pRedWin,
    });
    return {
      ...prediction,
      redRpPmf: pmf.redPmf,
      blueRpPmf: pmf.bluePmf,
      ...(pmf.redBonusPmf !== undefined ? { redBonusRpPmf: pmf.redBonusPmf } : {}),
      ...(pmf.blueBonusPmf !== undefined ? { blueBonusRpPmf: pmf.blueBonusPmf } : {}),
    };
  };

  const played = [...MS_PRIOR_FIXTURES, ...MS_LIVE_FIXTURES.slice(0, MS_LIVE_PLAYED)];
  for (const f of played) {
    const result = toMatchResult(f);
    if (f.eventKey === MS_LIVE_EVENT_KEY && stateBeforeLive === undefined) stateBeforeLive = layer.rpMeanShiftState();
    const prediction = spr.predict(state, toLeakProofUpcoming(result));
    const unshifted = unshiftedFields(result, prediction);
    state = spr.update(state, result);
    const roster = [...result.redTeams, ...result.blueTeams];
    const metrics = spr.teamMetrics(state, roster);
    const talent = new Map<string, number>();
    for (const teamKey of roster) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    const enriched = layer.foldPlayed(result, prediction, talent);

    referenceSigma.foldMatch(result, prediction);
    for (const [teamKey, total] of talent) referenceSigma.observeTalent(teamKey, total);
    for (const side of ["red", "blue"] as const) {
      const parsed = RULES_2026.parse(JSON.parse(result.scoreBreakdownRaw!), side, result.eventType);
      reference.fold(side === "red" ? result.redTeams : result.blueTeams, parsed.thresholdVariables);
    }

    const target = f.eventKey === MS_LIVE_EVENT_KEY ? [out.shifted, out.unshifted] : [out.priorShifted, out.priorUnshifted];
    target[0]!.push(msRowOf(result.matchKey, enriched.prediction));
    target[1]!.push(msRowOf(result.matchKey, unshifted));
  }

  for (const f of MS_LIVE_FIXTURES.slice(MS_LIVE_PLAYED)) {
    const view = toUpcomingMatchView(f);
    const prediction = spr.predict(state, view);
    out.shifted.push(msRowOf(view.matchKey, layer.enrichUpcoming(view, prediction).prediction));
    out.unshifted.push(msRowOf(view.matchKey, unshiftedFields(view, prediction)));
  }
  return { ...out, stateBeforeLive };
}

describe("scheduled.rp — the mean shift survives the live Worker (shape 16)", () => {
  let msRevealedPrior = 0;
  let msRevealedLive = 0;

  function msTbaStub(): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: unknown) => {
      const u = String(url);
      const matchesRoute = /\/event\/([^/]+)\/matches$/.exec(u);
      if (matchesRoute) {
        const eventKey = matchesRoute[1]!;
        const body =
          eventKey === MS_PRIOR_EVENT_KEY
            ? MS_PRIOR_FIXTURES.slice(0, msRevealedPrior).map(toTbaMatch)
            : [
                ...MS_LIVE_FIXTURES.slice(0, msRevealedLive).map(toTbaMatch),
                // Every live match not yet played is still on the schedule.
                ...MS_LIVE_FIXTURES.slice(msRevealedLive).map(toUpcomingTbaMatch),
              ];
        const revealed = eventKey === MS_PRIOR_EVENT_KEY ? msRevealedPrior : msRevealedLive;
        return {
          status: 200,
          ok: true,
          headers: { get: (name: string) => (name === "etag" ? `etag-${eventKey}-${revealed}` : null) },
          json: async () => body,
        };
      }
      const detailRoute = /\/event\/([^/]+)$/.exec(u);
      if (detailRoute) {
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ key: detailRoute[1]!, name: "Test Event", year: SEASON, event_type: EVENT_TYPE, start_date: "2026-08-01" }),
        };
      }
      throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
    });
  }

  afterEach(() => {
    msRevealedPrior = 0;
    msRevealedLive = 0;
  });

  /** Drives the prior event (one tick folds all of it), then the live event one played match per tick. */
  async function driveMeanShiftFixture(): Promise<{ r2: FakeR2Bucket; d1: FakeD1Database }> {
    const windows = [MS_PRIOR_EVENT_KEY, MS_LIVE_EVENT_KEY].map((eventKey) => ({
      eventKey,
      season: SEASON,
      startMs: NOW_MS - 3_600_000,
      endMs: NOW_MS + 3_600_000,
      inferred: false,
    }));
    const kv = new FakeKvNamespace(
      new Map([
        [LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", windows })],
        [ALGORITHMS_MANIFEST_KEY, algorithmsManifestJson()],
      ])
    );
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", msTbaStub());
    // spr only, the tracked production tier (`LIVE_ALGORITHM_IDS = "spr"`).
    const env = { ...makeEnv(kv, d1, r2), LIVE_ALGORITHM_IDS: "spr" } as Env;
    const tick = (i: number) =>
      runTick(env, { nowMs: NOW_MS + i * 60_000, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER, subrequestCap: 1000, subrequestReserve: 0 });

    msRevealedPrior = MS_PRIOR_FIXTURES.length;
    expect((await tick(0)).eventsFailed).toBe(0);
    for (let i = 0; i < MS_LIVE_PLAYED; i++) {
      msRevealedLive = i + 1;
      expect((await tick(1 + i)).eventsFailed).toBe(0);
    }
    return { r2, d1 };
  }

  async function msPublishedRows(r2: FakeR2Bucket): Promise<MsRow[]> {
    const key = artifactKey({ page: "event", eventKey: MS_LIVE_EVENT_KEY, algorithmId: "spr", version: spr.version });
    const object = await r2.get(key);
    expect(object, `no published event artifact at ${key}`).not.toBeNull();
    const artifact = JSON.parse(await object!.text()) as {
      matches: (PublishedMatchRow & { matchKey: string })[];
      upcoming: (PublishedMatchRow & { matchKey: string })[];
    };
    const byKey = new Map([...artifact.matches, ...artifact.upcoming].map((m) => [m.matchKey, m]));
    return MS_LIVE_FIXTURES.map((f) => {
      const row = byKey.get(matchKeyOf(f));
      expect(row, `live artifact is missing ${matchKeyOf(f)}`).toBeDefined();
      return { matchKey: row!.matchKey, red: row!.redRpPmf, blue: row!.blueRpPmf, redBonus: row!.redBonusRpPmf, blueBonus: row!.blueBonusRpPmf };
    });
  }

  it(
    "non-vacuity: the generated prior event passes the warmup NATURALLY, and the shift moves the live rows",
    () => {
      const offline = msOffline();
      const state = offline.stateBeforeLive;
      expect(state, "the offline layer exposes no mean-shift state").toBeDefined();
      expect(Object.keys(state!.variables).sort()).toEqual(RULES_2026.thresholdVariables.map((v) => v.name).sort());
      for (const [name, v] of Object.entries(state!.variables)) {
        expect(v.count, `${name}: warm observations before the live event`).toBeGreaterThanOrEqual(RP_MEAN_SHIFT_WARMUP_OBSERVATIONS);
        expect(v.sum, `${name}: a zero shift would make the parity test below vacuous`).not.toBe(0);
      }

      // The reference is faithful: on early prior rows, before any variable
      // can have reached the warmup, it reproduces the layer exactly.
      const early = offline.priorShifted.slice(0, 40);
      expect(early.filter((r) => r.red !== undefined).length).toBeGreaterThan(20);
      expect(msDigest(early)).toBe(msDigest(offline.priorUnshifted.slice(0, 40)));

      // And every live row, played and upcoming, carries a pmf that the
      // shift actually changed.
      expect(offline.shifted.every((r) => r.red !== undefined && r.blue !== undefined)).toBe(true);
      for (let i = 0; i < offline.shifted.length; i++) {
        expect(JSON.stringify(offline.shifted[i]), `${offline.shifted[i]!.matchKey} is identical with and without the shift`).not.toBe(
          JSON.stringify(offline.unshifted[i])
        );
      }
    },
    60_000
  );

  it(
    "spr: live played AND upcoming RP rows EQUAL the offline SigmaScoutLayer's, which carry the mean shift",
    async () => {
      const { r2 } = await driveMeanShiftFixture();
      const offline = msOffline();
      const online = await msPublishedRows(r2);
      expect(online.filter((r) => r.red !== undefined).length, "the live arm produced no pmf at all").toBe(MS_LIVE_PLAYED + MS_LIVE_UPCOMING);
      expect(
        msDigest(online),
        "the live Worker's RP rows diverged from the offline layer's — it priced the live event without the mean shift the publisher applies (check the league-row resume and write-back)"
      ).toBe(msDigest(offline.shifted));
      expect(msDigest(online)).not.toBe(msDigest(offline.unshifted));
    },
    120_000
  );

  it(
    "the spr league row the Worker wrote carries the same mean-shift state the offline layer ends with",
    async () => {
      const { d1 } = await driveMeanShiftFixture();
      const league = d1.algorithmState.get("spr::league::league");
      expect(league, "the Worker wrote no spr league row").toBeDefined();
      const json = JSON.parse(league!.state_json) as { snapshotShapeVersion: number; sigmascoutRpMeanShift?: unknown };
      expect(json.snapshotShapeVersion).toBe(16);

      const layer = new SigmaScoutLayer(RULES_2026, "spr");
      let state = spr.initState([...ALL_TEAMS]);
      for (const f of [...MS_PRIOR_FIXTURES, ...MS_LIVE_FIXTURES.slice(0, MS_LIVE_PLAYED)]) {
        const result = toMatchResult(f);
        const prediction = spr.predict(state, toLeakProofUpcoming(result));
        state = spr.update(state, result);
        layer.foldPlayed(result, prediction);
      }
      expect(json.sigmascoutRpMeanShift).toEqual(layer.rpMeanShiftState());
    },
    120_000
  );
});
