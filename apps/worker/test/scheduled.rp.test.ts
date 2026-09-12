/**
 * Plan 09-08 (D-21, audit finding F5): RANKING POINTS ON LIVE ROWS.
 *
 * The live Worker never computed ranking points at all — nothing under
 * `apps/worker/src/` constructed an RP accumulator, so `prediction.redRpPmf`
 * was never set, and `buildEventMatchRow` did not list the pmf fields in the
 * first place. This file is the test that the live path now produces the
 * SAME pmf the offline publisher would have, rather than merely producing
 * one.
 *
 * THE TWO-ARM DESIGN, and why the online arm seeds ITSELF:
 *
 * A pmf is only correct relative to the history it was priced from. So the
 * fixture runs TWO events in one season. A "prior" event is folded first and
 * the Worker persists its own RP beliefs into D1 exactly as production does;
 * the "live" event is then folded one match per tick, RESUMING those beliefs.
 * The offline arm drives the real `SigmaScoutLayer` over the identical
 * chronological stream (prior matches, then live matches) and the two RP
 * streams are compared by digest over the LIVE event's rows.
 *
 * That construction is what makes the state-shape bump load-bearing rather
 * than decorative: break `withRpBeliefs` on the write side or `readRpBeliefs`
 * on the read side and the Worker re-cold-starts on every tick, prices each
 * match from one tick's matches alone, and the digests diverge — while every
 * published pmf still sums to 1, still parses and still renders. That is the
 * failure this test exists to catch, and it was observed failing by hand
 * before being recorded as passing (see the plan's SUMMARY).
 *
 * The offline arm drives the REAL `SigmaScoutLayer`, never a hand-rolled
 * accumulator. `scheduled.replay.test.ts`'s band digest records why in its
 * own words: it once compared the Worker against a stand-in that had drifted
 * from the publisher, and a second implementation of the thing under test can
 * always drift from it.
 *
 * WHY `scheduled.replay.test.ts` IS NOT THE RP ARM, despite driving the same
 * `runTick`: its fixture carries `score_breakdown: null` on every match and
 * constructs its offline `SigmaScoutLayer` with an UNDEFINED rule module, so
 * it produces no RP on either side and stays green unchanged. It is the
 * prediction/band equivalence test; this is the RP one.
 *
 * The fake D1/R2/KV classes below are COPIED from
 * `apps/worker/test/scheduled.replay.test.ts` rather than imported — that
 * file exports none of them, and this file follows the small-duplication
 * precedent its own header already sets for this exact cross-boundary
 * situation. Keep them in step with the original.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTick } from "../src/scheduled.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { artifactKey } from "../../../packages/harness/pageArtifacts.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { spr } from "../../../packages/core/algorithms/bpr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { isOfficialEventType } from "../../../packages/core/algorithms/eventTypes.js";
import { roundPmf } from "../../../packages/harness/rounding.js";
import { SigmaScoutLayer } from "../../../packages/harness/sigmaScoutLayer.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { EVENT_TYPE_TIERS, isRpEligibleEventType } from "../../../packages/core/rankingPoints/constants.js";
import { TOTAL_METRIC_KEY } from "../../../packages/core/algorithms/types.js";
import type { AlgorithmModule, MatchResult } from "../../../packages/core/algorithms/types.js";
import type { Env } from "../src/env.js";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * The final live tick's OWN subrequest cost on this fixture, pinned so a
 * future edit that adds a D1 round-trip per team fails loudly here.
 *
 * RP costs ZERO additional subrequests by construction: the beliefs ride as a
 * passenger key inside the very team rows the tick already reads and already
 * writes back (09-RESEARCH.md Pattern 1). This constant is the PROOF of that
 * claim rather than the claim itself — if it has to be raised to make this
 * file pass, the passenger design has been broken.
 *
 * MEASURED, not assumed (plan 09-08). The same fixture was driven twice: once
 * with the RP accumulator forced to `undefined` (every RP gate closed, no
 * belief read and none written) and once with it live. Both runs reported
 * `subrequestsUsed: 64` on the final live tick. That equality IS the
 * zero-additional-subrequest result — the number itself is a property of the
 * fixture's event and team counts, not of RP.
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
    // writeEventCursor's own plain upsert (ON CONFLICT DO UPDATE) — used by
    // writeTickMeta's sentinel row and the "unchanged but ETag moved" path.
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


// ---------------------------------------------------------------------------
// Fixture — two events, one season, overlapping rosters
// ---------------------------------------------------------------------------

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

/**
 * The PRIOR event — the season history the live event's Worker resumes from.
 * Four matches is enough for every team to clear the Swing Factor's
 * two-observation rule, so the band gate is open for opr/epa as well as for
 * the Sigma-scored spr by the time the live event starts.
 */
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

/** The 2026 score-breakdown shape `rp2026.parse` actually reads — see `packages/core/rankingPoints/2026.ts`'s schema. */
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
        // `name` is REQUIRED by `tbaEventSchema` and its absence is not loud:
        // `processEvent` parses the detail inside a try/catch that degrades to
        // `eventType = -1`, which `isRpEligibleEventType` then rejects. An
        // event-detail stub missing this field therefore produces a fixture
        // where RP is silently gated off on every row.
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

/**
 * The RP counterpart of `scheduled.replay.test.ts`'s band-stream digest:
 * matchKey plus both ROUNDED pmfs per row. Both arms pass through the same
 * imported `roundPmf`, so a rounding difference cannot masquerade as
 * agreement (or as divergence).
 */
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

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe("scheduled.rp — ranking points on live rows (D-21, F5)", () => {
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

    // Phase 1 — the whole PRIOR event. The Worker persists its own RP beliefs
    // into D1 here; nothing is hand-seeded, so the resume path below is
    // exercised against exactly what production would have written.
    revealedPrior = PRIOR_FIXTURES.length;
    for (let i = 0; i < PRIOR_FIXTURES.length; i++) {
      const priorResult = await runTick(env, { nowMs: NOW_MS + i * 60_000, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER, subrequestCap: 1000, subrequestReserve: 0 });
      expect(priorResult.eventsFailed).toBe(0);
    }

    // Phase 2 — the LIVE event, one match per tick. Tick N resumes what tick
    // N-1 wrote, which is the property the shape bump exists for.
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

      // NON-VACUITY FIRST. A fixture that silently produced no pmf at all
      // would make every assertion below pass while proving nothing.
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
    "the LIVE pmf stream EQUALS an independent offline SigmaScoutLayer replay of the same matches, for every published algorithm",
    async () => {
      const { r2 } = await driveFixture();

      for (const algorithmId of ["opr", "epa", "spr"] as const) {
        const offline = offlineRpRows(algorithmId);
        // Non-vacuity on the OFFLINE arm too: two empty streams digest
        // identically, so the comparison below would pass on a fixture where
        // the band gate never opened.
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
      }
    },
    60_000
  );

  it(
    "09-07's decomposition fields reach live PLAYED rows alongside the totals",
    async () => {
      const { r2 } = await driveFixture();
      const rows = await publishedLiveRows(r2, "spr");
      const decomposed = rows.filter((r) => r?.matchOutcomePmf !== undefined);
      expect(
        decomposed.length,
        "no played row carried 09-07's decomposition, so the rank simulation would silently fall back to the legacy path on every live row"
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
    // 2021 is the one season with no RP rule module. `rpRuleModuleForSeason`
    // THROWS for it by design, so the Worker indexes `RP_RULE_MODULES`
    // directly and degrades to "no RP" instead of aborting the whole event.
    expect(RP_RULE_MODULES[2021]).toBeUndefined();
    const { rpRuleModuleForSeason } = await import("../../../packages/core/rankingPoints/rules.js");
    expect(() => rpRuleModuleForSeason(2021)).toThrow();

    // Recorded rather than driven end-to-end: 2021 also has no SCORE-COMPONENT
    // map (`componentMapForSeason` throws for it too), so a 2021 fixture fails
    // in `spr` before RP is ever consulted and would prove nothing about this
    // gate. The registered RP seasons and the registered component-map seasons
    // are the same set, so no season can exercise "component map present, RP
    // rules absent" at all — which is exactly why this is asserted here
    // instead.
    expect(Object.keys(RP_RULE_MODULES)).not.toContain("2021");
  });

  it("every event type the Worker will PROCESS is RP-eligible, so the eventType gate is defence in depth rather than a live branch", () => {
    // Recorded rather than faked as an end-to-end case: the Worker only
    // processes OFFICIAL event types, and every official type is present in
    // `EVENT_TYPE_TIERS`. The one RP-ineligible type the tier table
    // deliberately omits (99, offseason) is also the one `isOfficialEventType`
    // rejects, so no live tick can reach `rpFieldsFor`'s eventType gate with an
    // ineligible value. An end-to-end "offseason yields no pmf" test would
    // therefore assert on an event the Worker never folds at all.
    for (const eventType of [0, 1, 2, 3, 4, 5]) {
      expect(isOfficialEventType(eventType), `event type ${eventType}`).toBe(true);
      expect(isRpEligibleEventType(eventType), `event type ${eventType}`).toBe(true);
    }
    expect(isOfficialEventType(99)).toBe(false);
    expect(isRpEligibleEventType(99)).toBe(false);
    expect(Object.keys(EVENT_TYPE_TIERS)).not.toContain("99");
  });
});
