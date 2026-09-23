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
import {
  artifactKey,
  EventStateBlockSchema,
  EventUpcomingMatchSchema,
  LiveEventArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  type EventStateBlock,
  type EventStateBlockRow,
  type EventUpcomingMatch,
} from "../../../packages/harness/pageArtifacts.js";
import { buildEventStateBlock, priceUpcomingFromState } from "../../../packages/harness/eventStatePricing.js";
import { eventUpcomingRow } from "../../../packages/harness/publishedRows.js";
import {
  serializeState,
  withRpBeliefs,
  withRpMeanShift,
  withSigmaBeliefs,
  withSigmaPopulation,
  type StateRow,
} from "../../../packages/harness/stateSnapshot.js";
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
import { PUBLISHED_ALGORITHM_IDS } from "../../../packages/harness/publishedAlgorithms.js";
import { seedStateBaselineMarkers } from "./support/stateBaseline.js";
import type { Env } from "../src/env.js";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * The final live tick's subrequest cost on this fixture. RP beliefs ride
 * inside rows the tick already reads and writes, so RP costs zero extra
 * subrequests (measured with RP forced off and on: same count). If this has
 * to be raised, the passenger design is broken.
 *
 * RE-DERIVED FOR 260917-jr4, AS ARITHMETIC OFF THE OLD OBSERVED VALUE — never
 * re-pinned to whatever the new code happened to produce. The old value was an
 * OBSERVED whole-fixture count of 64. The change removes Phase B's per-team
 * artifact read+write and adds one sidecar read+write per algorithm-event:
 *
 *   final live tick folds `2026casj_qm4` -> 6 real touched teams
 *   LIVE_ALGORITHM_IDS = "opr,epa,spr"                 -> 3 algorithms
 *
 *   removed: 3 algorithms x 6 teams x 2 (read + write) = -36
 *   added:   3 algorithms x 1 sidecar x 2 (read + write) = +6
 *
 *   PREDICTED: 64 - 36 + 6 = 34
 *
 * This comment was written and committed BEFORE the suite was re-run. The
 * observed value matched the prediction exactly.
 *
 * RE-DERIVED AGAIN FOR 260918-16t, the same way — arithmetic off the CURRENT
 * OBSERVED value, never a re-pin to whatever the new code produces. The
 * current value is an OBSERVED whole-fixture count of 34. This change deletes
 * the sidecar object entirely: its rows now ride inside the event artifact the
 * tick already reads and writes, so the sidecar's read and write per
 * algorithm-event both disappear and NOTHING is added in their place.
 *
 *   LIVE_ALGORITHM_IDS = "opr,epa,spr"                    -> 3 algorithms
 *   removed: 3 algorithms x 1 sidecar x 2 (read + write)  = -6
 *   added:   nothing — the block rides an existing read+write pair
 *
 *   PREDICTED: 34 - 6 = 28
 *
 * This paragraph was written and COMMITTED BEFORE the suite was re-run (see
 * commit 7d5b6d6). If the observed value had not been 28, the correct response
 * would have been to stop and report both figures — NOT to adopt the observed
 * one — because a mismatch means a subrequest is being spent somewhere this
 * arithmetic does not describe.
 *
 * OBSERVED: 28. The prediction matched exactly.
 */
const SUBREQUESTS_PER_LIVE_TICK = 28;

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

  constructor() {
    // Every fixture's algorithms manifest publishes `generation: "gen-1"`
    // (see `algorithmsManifestJson` below) — seeding a marker at that
    // generation for every published algorithm id keeps every pre-existing
    // test in this file folding exactly as before quick task 260920-q75.
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
  /** Pre-load an object as if an offline publish had written it. Since quick task 260923-3w4 the two manifests arrive here rather than through a fake KV binding. */
  seed(key: string, body: string): void {
    this.store.set(key, body);
  }
}

// THE FAKE KV BINDING IS GONE (quick task 260923-3w4): the Worker reads both
// manifests straight from R2, so every `makeEnv` below seeds them into the R2
// fake instead of into a second store that production never wrote to.


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

function makeEnv(manifests: Map<string, string>, d1: FakeD1Database, r2: FakeR2Bucket): Env {
  for (const [key, body] of manifests) r2.seed(key, body);

  return {
    DB: d1 as unknown as D1Database,
    ARTIFACTS: r2 as unknown,
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
  readonly sortTime?: number;
  readonly actualRedRp?: number | null;
  readonly actualRedBonusRp?: readonly boolean[] | null;
  readonly actualBlueBonusRp?: readonly boolean[] | null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  revealedPrior = 0;
  revealedLive = 0;
});

describe("scheduled.rp — ranking points on live rows", () => {
  async function driveFixture(): Promise<{ r2: FakeR2Bucket; lastSubrequests: number }> {
    const manifests = (
      new Map([
        [LIVE_WINDOWS_MANIFEST_KEY, liveWindowsManifest()],
        [ALGORITHMS_MANIFEST_KEY, algorithmsManifestJson()],
      ])
    );
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", makeTbaFetchStub());
    const env = makeEnv(manifests, d1, r2);

    // Phase 1: the whole prior event. Nothing is hand-seeded; the Worker
    // persists its own RP beliefs, as production would.
    revealedPrior = PRIOR_FIXTURES.length;
    for (let i = 0; i < PRIOR_FIXTURES.length; i++) {
      const priorResult = await runTick(env, { nowMs: NOW_MS + i * 60_000 });
      expect(priorResult.eventsFailed).toBe(0);
    }

    // Phase 2: the live event, one match per tick; tick N resumes what tick N-1 wrote.
    let lastSubrequests = 0;
    for (let i = 0; i < LIVE_FIXTURES.length; i++) {
      revealedLive = i + 1;
      const result = await runTick(env, { nowMs: NOW_MS + (PRIOR_FIXTURES.length + i) * 60_000 });
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

  /**
   * The actual per-bonus flags a live row publishes come from the breakdown
   * Phase A's RP fold ALREADY parsed (`observedBonusSides`), passed through to
   * Phase B rather than parsed a second time against the tick's CPU budget.
   * They describe the MATCH, not the model, so OPR's and EPA's rows — whose
   * own folds parse nothing — must carry the same arrays (260915-p0a).
   */
  it(
    "live played rows carry the actual per-bonus flags the offline rule module derives, on every algorithm's artifact",
    async () => {
      const { r2 } = await driveFixture();
      // The oracle is the season's rule module itself, read here rather than
      // through `actualBonusFlagsForMatch`, so this test is independent of the
      // helper the Worker uses on either of its two paths.
      const expected = new Map(
        LIVE_FIXTURES.map((f) => {
          const raw = breakdownOf(f);
          const sideFlags = (side: "red" | "blue") => {
            const parsed = RULES_2026.parse(raw, side, EVENT_TYPE);
            return RULES_2026.bonusNames.map((name) => parsed.bonusFlags[name] ?? false);
          };
          return [matchKeyOf(f), { red: sideFlags("red"), blue: sideFlags("blue") }];
        })
      );
      // Non-vacuity: a fixture whose bonuses were all false would pass a broken pass-through.
      expect(
        [...expected.values()].some((flags) => [...flags.red, ...flags.blue].some((v) => v)),
        "no live fixture achieved a bonus, so the flag comparison below would be vacuous"
      ).toBe(true);

      for (const algorithmId of ["spr", "opr", "epa"]) {
        for (const row of await publishedLiveRows(r2, algorithmId)) {
          const flags = expected.get(row.matchKey)!;
          expect(row.actualRedBonusRp, `${algorithmId} ${row.matchKey} actualRedBonusRp`).toEqual(flags.red);
          expect(row.actualBlueBonusRp, `${algorithmId} ${row.matchKey} actualBlueBonusRp`).toEqual(flags.blue);
          // TBA's own reported time, straight off the same poll.
          const fixture = LIVE_FIXTURES.find((f) => matchKeyOf(f) === row.matchKey)!;
          expect(row.sortTime, `${algorithmId} ${row.matchKey} sortTime`).toBe((Math.floor(NOW_MS / 1000) + fixture.matchNumber * 60) * 1000);
          // These fixtures' breakdowns carry no `rp` field, so "not derivable" is the honest value.
          expect(row.actualRedRp, `${algorithmId} ${row.matchKey} actualRedRp`).toBeNull();
        }
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
    const manifests = (
      new Map([
        [LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", windows })],
        [ALGORITHMS_MANIFEST_KEY, algorithmsManifestJson()],
      ])
    );
    const d1 = new FakeD1Database();
    const r2 = new FakeR2Bucket();
    vi.stubGlobal("fetch", msTbaStub());
    // spr only, the tracked production tier (`LIVE_ALGORITHM_IDS = "spr"`).
    const env = { ...makeEnv(manifests, d1, r2), LIVE_ALGORITHM_IDS: "spr" } as Env;
    const tick = (i: number) =>
      runTick(env, { nowMs: NOW_MS + i * 60_000 });

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
    "spr: live RP rows EQUAL the offline SigmaScoutLayer's, which carry the mean shift — played AND upcoming",
    async () => {
      const { r2 } = await driveMeanShiftFixture();
      const offline = msOffline();
      const online = await msPublishedRows(r2);
      const onlinePlayed = online.slice(0, MS_LIVE_PLAYED);
      expect(onlinePlayed.filter((r) => r.red !== undefined).length, "the live arm produced no played pmf at all").toBe(MS_LIVE_PLAYED);
      expect(
        msDigest(onlinePlayed),
        "the live Worker's played RP rows diverged from the offline layer's — it priced the live event without the mean shift the publisher applies (check the league-row resume and write-back)"
      ).toBe(msDigest(offline.shifted.slice(0, MS_LIVE_PLAYED)));
      expect(msDigest(onlinePlayed)).not.toBe(msDigest(offline.unshifted.slice(0, MS_LIVE_PLAYED)));

      // UPCOMING ROWS ARE HELD TO THE SAME BAR SINCE QUICK TASK 260923-3w6. The
      // tick prices them itself again, so the mean shift has to reach them too —
      // and it reaches them through a DIFFERENT accessor than the played rows use
      // (`shift.apply` inside `priceUpcomingRows`, over `momentsFor` on the
      // post-fold accumulator), which is exactly why this is asserted rather than
      // assumed. Between 260915-isq and 260923-3w6 these rows carried no pmf at
      // all and this assertion read `toBeUndefined()`.
      const onlineUpcoming = online.slice(MS_LIVE_PLAYED);
      expect(onlineUpcoming).toHaveLength(MS_LIVE_UPCOMING);
      expect(onlineUpcoming.filter((r) => r.red !== undefined).length, "the live arm priced no upcoming pmf at all").toBe(MS_LIVE_UPCOMING);
      expect(
        msDigest(onlineUpcoming),
        "the live Worker's upcoming RP rows diverged from the offline layer's — it priced the remaining schedule from something the publisher does not use"
      ).toBe(msDigest(offline.shifted.slice(MS_LIVE_PLAYED)));
      expect(msDigest(onlineUpcoming)).not.toBe(msDigest(offline.unshifted.slice(MS_LIVE_PLAYED)));
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

// ---------------------------------------------------------------------------
// THE TICK'S OWN UPCOMING ROWS ARE THE OFFLINE PUBLISHER'S (quick task
// 260923-3w6). This is the equivalence proof for the reinstated Worker-side
// pricing: published NUMBERS must not move when the pricer moves.
//
// A publish is emulated at k = 4 played live matches: D1 holds the offline seed
// rows (the publisher's passenger chain, in its order) and R2 holds an spr event
// artifact carrying the offline upcoming rows. The Worker then folds the rest of
// the live event over three ticks. After each tick, the `upcoming` array the
// Worker ITSELF wrote must equal, exactly, the rows an offline replay of the same
// played set publishes. No tolerance anywhere.
//
// It used to prove the same equivalence one hop further out: the tick spliced a
// `state` block, the BROWSER priced from it, and the browser's rows had to match
// offline. Those three ticks, this fixture and this oracle are unchanged; only
// the arm under test moved back into the Worker.
//
// The schedule is built so pricing sees teams from every source: after tick 1
// match 6 pairs touched frc1 with untouched frc7-frc11; after tick 2 match 8
// carries frc5/frc6 (folded by tick 1), frc4/frc8/frc11 (tick 2) and frc12
// (untouched since the publish). An untouched team must still price exactly,
// which is why Phase A reads the whole remaining schedule's state.
// ---------------------------------------------------------------------------

const SB_PRIOR_EVENT_KEY = "2026sbprior";
const SB_LIVE_EVENT_KEY = "2026sblive";
const SB_TEAMS: readonly string[] = Array.from({ length: 12 }, (_, i) => `frc${i + 1}`);
const SB_PRIOR_MATCHES = 132;
const SB_PUBLISHED_PLAYED = 4;
const SB_SEED_STAMP = { generation: "seed-gen", computedAt: "2026-08-21T00:00:00.000Z" };
const SB_ARTIFACT_KEY = artifactKey({ page: "event", eventKey: SB_LIVE_EVENT_KEY, algorithmId: "spr", version: spr.version });

/** Match `k` of the prior event: an affine permutation of the twelve teams (multipliers coprime with 12), so partners and opponents vary. */
function sbPriorRoster(k: number): { red: string[]; blue: string[] } {
  const multiplier = [1, 5, 7, 11][k % 4]!;
  const order = SB_TEAMS.map((team, i) => ({ team, slot: (i * multiplier + k) % 12 })).sort((a, b) => a.slot - b.slot);
  return { red: order.slice(0, 3).map((o) => o.team), blue: order.slice(3, 6).map((o) => o.team) };
}

/** Trending threshold inputs, as `msFixture`: a nonzero mean shift by construction. */
function sbFixture(eventKey: string, matchNumber: number, k: number, red: readonly string[], blue: readonly string[]): MatchFixture {
  const base = msFixture(eventKey, matchNumber, k);
  return { ...base, redTeams: red, blueTeams: blue };
}

const SB_PRIOR_FIXTURES: readonly MatchFixture[] = Array.from({ length: SB_PRIOR_MATCHES }, (_, i) => {
  const { red, blue } = sbPriorRoster(i);
  return sbFixture(SB_PRIOR_EVENT_KEY, i + 1, i, red, blue);
});

const SB_LIVE_ROSTERS: readonly [readonly string[], readonly string[]][] = [
  [["frc1", "frc4", "frc7"], ["frc2", "frc5", "frc8"]],
  [["frc3", "frc6", "frc9"], ["frc10", "frc11", "frc12"]],
  [["frc1", "frc6", "frc11"], ["frc2", "frc9", "frc12"]],
  [["frc3", "frc4", "frc10"], ["frc5", "frc7", "frc8"]],
  // Tick 1 folds match 5: touched = frc1-frc6.
  [["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"]],
  // Tick 2 folds matches 6 and 7: touched = frc1-frc4, frc7-frc11.
  [["frc1", "frc7", "frc8"], ["frc9", "frc10", "frc11"]],
  [["frc2", "frc4", "frc7"], ["frc3", "frc9", "frc10"]],
  // Tick 3 folds match 8, the last one.
  [["frc5", "frc6", "frc12"], ["frc8", "frc11", "frc4"]],
];

const SB_LIVE_FIXTURES: readonly MatchFixture[] = SB_LIVE_ROSTERS.map(([red, blue], i) =>
  sbFixture(SB_LIVE_EVENT_KEY, i + 1, SB_PRIOR_MATCHES + i, red, blue)
);

/** The published sort time of a live match: deliberately NOT the TBA `time` the Worker normalizes, so a Worker that re-derived it would fail. */
function sbSortTimeOf(f: MatchFixture): number {
  return 1_780_000_000 + f.matchNumber * 420;
}

interface SbOffline {
  /** The publisher's D1 seed rows at this point: `serializeState`, then the passengers in `publish.ts`'s order. */
  readonly rows: StateRow[];
  /** The offline upcoming event rows for the remaining live matches. */
  readonly upcoming: EventUpcomingMatch[];
  readonly meanShift: ReturnType<SigmaScoutLayer["rpMeanShiftState"]>;
}

/** The offline arm after the prior event and live matches 1..k, driven as `msOffline` drives the real `SigmaScoutLayer`. */
function sbOfflineAt(k: number): SbOffline {
  const layer = new SigmaScoutLayer(RULES_2026, "spr");
  let state = spr.initState([...SB_TEAMS]);
  for (const f of [...SB_PRIOR_FIXTURES, ...SB_LIVE_FIXTURES.slice(0, k)]) {
    const result = toMatchResult(f);
    const prediction = spr.predict(state, toLeakProofUpcoming(result));
    state = spr.update(state, result);
    const roster = [...result.redTeams, ...result.blueTeams];
    const metrics = spr.teamMetrics(state, roster);
    const talent = new Map<string, number>();
    for (const teamKey of roster) {
      const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
      if (total !== undefined) talent.set(teamKey, total);
    }
    layer.foldPlayed(result, prediction, talent);
  }

  let rows = withRpBeliefs(withSigmaBeliefs(serializeState("spr", spr.version, state, SB_SEED_STAMP), layer.sigmaBeliefs()), layer.rpVariableBeliefs());
  const sigmaPopulation = layer.sigmaPopulation();
  if (sigmaPopulation !== undefined) rows = withSigmaPopulation(rows, sigmaPopulation);
  const rpMeanShift = layer.rpMeanShiftState();
  if (rpMeanShift !== undefined) rows = withRpMeanShift(rows, rpMeanShift);

  const upcoming = SB_LIVE_FIXTURES.slice(k).map((f) => {
    const view = toUpcomingMatchView(f);
    return EventUpcomingMatchSchema.parse(eventUpcomingRow(layer.enrichUpcoming(view, spr.predict(state, view)), sbSortTimeOf(f)));
  });
  return { rows, upcoming, meanShift: rpMeanShift };
}

function sbJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** One `FakeD1Database` row back in `StateRow` shape, so a D1 row can be compared field for field against a seed row. */
function sbStateRowOf(row: FakeAlgorithmStateRow): EventStateBlockRow {
  return {
    algorithmId: row.algorithm_id,
    algorithmVersion: row.algorithm_version,
    scopeKind: row.scope_kind as "league" | "team",
    scopeKey: row.scope_key,
    stateJson: row.state_json,
    generation: row.generation,
    computedAt: row.computed_at,
  };
}

/** Counts every D1 read, so a test can prove the Worker never reads D1 to bootstrap a block. */
class CountingFakeD1Database extends FakeD1Database {
  selectCalls = 0;
  override executeSelect(sql: string, args: readonly unknown[]): unknown[] {
    this.selectCalls += 1;
    return super.executeSelect(sql, args);
  }
}

interface SbHarnessOptions {
  /** The `state` the published artifact carries: the real block (default), none, or a replacement. */
  readonly publishedState?: "block" | "none" | ((block: EventStateBlock) => EventStateBlock);
  /** The published artifact's `eventType`; `undefined` omits the key. */
  readonly publishedEventType?: number | undefined;
  /** The event-detail route's HTTP status (default 200). */
  readonly detailStatus?: number;
}

interface SbHarness {
  readonly d1: CountingFakeD1Database;
  readonly r2: FakeR2Bucket;
  /** The emulated publish's own D1 seed rows — the oracle for "this team's state never advanced". */
  readonly publishedRows: readonly StateRow[];
  readonly publishedBlock: EventStateBlock;
  readonly publishedUpcoming: EventUpcomingMatch[];
  /** Reveals live matches 1..`played` and runs one tick. */
  tickTo(played: number): Promise<void>;
  /** The artifact the Worker last wrote, as parsed JSON. */
  readArtifact(): Promise<Record<string, unknown> & { upcoming: Record<string, unknown>[] }>;
}

async function sbHarness(options: SbHarnessOptions = {}): Promise<SbHarness> {
  const published = sbOfflineAt(SB_PUBLISHED_PLAYED);
  const publishedBlock = buildEventStateBlock(published.rows, SB_TEAMS);

  const d1 = new CountingFakeD1Database();
  for (const row of published.rows) {
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
  d1.eventCursors.set(SB_LIVE_EVENT_KEY, {
    event_key: SB_LIVE_EVENT_KEY,
    tba_etag: null,
    last_folded_match_key: matchKeyOf(SB_LIVE_FIXTURES[SB_PUBLISHED_PLAYED - 1]!),
    last_polled_at: null,
    last_advanced_at: null,
  });

  const publishedStateOption = options.publishedState ?? "block";
  const state =
    publishedStateOption === "block" ? publishedBlock : publishedStateOption === "none" ? undefined : publishedStateOption(publishedBlock);
  const eventType = "publishedEventType" in options ? options.publishedEventType : EVENT_TYPE;
  const artifact = LiveEventArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: SB_SEED_STAMP.generation,
    computedAt: SB_SEED_STAMP.computedAt,
    algorithmId: "spr",
    algorithmVersion: spr.version,
    eventKey: SB_LIVE_EVENT_KEY,
    season: SEASON,
    ...(eventType !== undefined ? { eventType } : {}),
    matches: [],
    upcoming: published.upcoming,
    teams: [],
    ...(state !== undefined ? { state } : {}),
  });
  const r2 = new FakeR2Bucket();
  await r2.put(SB_ARTIFACT_KEY, JSON.stringify(artifact));

  const windows = [{ eventKey: SB_LIVE_EVENT_KEY, season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000, inferred: false }];
  const manifests = (
    new Map([
      [LIVE_WINDOWS_MANIFEST_KEY, JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", windows })],
      [ALGORITHMS_MANIFEST_KEY, algorithmsManifestJson()],
    ])
  );

  let revealed = SB_PUBLISHED_PLAYED;
  const detailStatus = options.detailStatus ?? 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      const matchesRoute = /\/event\/([^/]+)\/matches$/.exec(u);
      if (matchesRoute) {
        const body = [...SB_LIVE_FIXTURES.slice(0, revealed).map(toTbaMatch), ...SB_LIVE_FIXTURES.slice(revealed).map(toUpcomingTbaMatch)];
        return {
          status: 200,
          ok: true,
          headers: { get: (name: string) => (name === "etag" ? `etag-${matchesRoute[1]!}-${revealed}` : null) },
          json: async () => body,
        };
      }
      const detailRoute = /\/event\/([^/]+)$/.exec(u);
      if (detailRoute) {
        if (detailStatus !== 200) {
          return { status: detailStatus, ok: false, headers: { get: () => null }, json: async () => ({}) };
        }
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ key: detailRoute[1]!, name: "Test Event", year: SEASON, event_type: EVENT_TYPE, start_date: "2026-08-01" }),
        };
      }
      throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
    })
  );
  const env = { ...makeEnv(manifests, d1 as unknown as FakeD1Database, r2), LIVE_ALGORITHM_IDS: "spr" } as Env;

  let tickIndex = 0;
  return {
    d1,
    r2,
    publishedRows: published.rows,
    publishedBlock,
    publishedUpcoming: published.upcoming,
    async tickTo(played: number) {
      revealed = played;
      const result = await runTick(env, {
        nowMs: NOW_MS + tickIndex++ * 60_000,
      });
      expect(result.eventsFailed).toBe(0);
      expect(result.eventsAdvanced).toBe(1);
    },
    async readArtifact() {
      const object = await r2.get(SB_ARTIFACT_KEY);
      expect(object, `no event artifact at ${SB_ARTIFACT_KEY}`).not.toBeNull();
      return JSON.parse(await object!.text());
    },
  };
}

/**
 * The artifact's OWN upcoming rows, re-parsed through the published schema so an
 * assertion compares parsed rows against parsed rows. The tick wrote these; no
 * pricing happens here at all (quick task 260923-3w6).
 */
function sbWrittenUpcoming(artifact: Record<string, unknown> & { upcoming: Record<string, unknown>[] }): EventUpcomingMatch[] {
  return artifact.upcoming.map((row) => EventUpcomingMatchSchema.parse(row));
}

function sbExpectExact(actual: readonly EventUpcomingMatch[], expected: readonly EventUpcomingMatch[]): void {
  expect(actual.length).toBe(expected.length);
  expect(actual).toEqual(expected);
  expect(sbJson(actual)).toStrictEqual(sbJson(expected));
}

describe("scheduled.rp — the tick's own upcoming rows are the offline publisher's", () => {
  it("non-vacuity: the fixture is warm, mixes touched and untouched teams, and the offline rows carry bands and RP", () => {
    const published = sbOfflineAt(SB_PUBLISHED_PLAYED);
    expect(published.meanShift, "no mean-shift state offline").toBeDefined();
    for (const [name, v] of Object.entries(published.meanShift!.variables)) {
      expect(v.count, `${name}: warm observations`).toBeGreaterThanOrEqual(RP_MEAN_SHIFT_WARMUP_OBSERVATIONS);
      expect(v.sum, `${name}: a zero shift`).not.toBe(0);
    }
    expect(published.upcoming).toHaveLength(SB_LIVE_FIXTURES.length - SB_PUBLISHED_PLAYED);
    for (const row of published.upcoming) {
      expect(row.redMatchBandVariance, `${row.matchKey}: red band`).toBeDefined();
      expect(row.blueMatchBandVariance, `${row.matchKey}: blue band`).toBeDefined();
      expect(row.redRpPmf, `${row.matchKey}: red RP pmf`).toBeDefined();
      expect(row.blueRpPmf, `${row.matchKey}: blue RP pmf`).toBeDefined();
      expect(row.sortTime).toBeDefined();
    }
    // Every team has a row in the block, so no team prices as fresh.
    const block = buildEventStateBlock(published.rows, SB_TEAMS);
    expect(block.rows.filter((r) => r.scopeKind === "team").map((r) => r.scopeKey).sort()).toEqual([...SB_TEAMS].sort());
  });

  it(
    "three ticks: the rows the Worker itself writes reproduce the offline upcoming rows exactly, and no state block is ever written",
    async () => {
      const harness = await sbHarness();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        // Pre-tick sanity: the emulated publish already prices to the offline rows.
        const before = await harness.readArtifact();
        sbExpectExact(sbWrittenUpcoming(before), sbOfflineAt(SB_PUBLISHED_PLAYED).upcoming);

        // Tick 1: match 5 (six touched teams).
        await harness.tickTo(5);
        const afterTick1 = await harness.readArtifact();
        expect(afterTick1.eventType).toBe(EVENT_TYPE);
        sbExpectExact(sbWrittenUpcoming(afterTick1), sbOfflineAt(5).upcoming);

        // NO BLOCK, EVER (quick task 260923-3w6). The artifact the tick writes
        // carries no `state` key at all, and the one the emulated publish put in
        // R2 was DROPPED rather than carried forward on the spread.
        expect("state" in afterTick1, "the tick wrote a state block").toBe(false);

        // THE WRITE-SET ORACLE, now read straight off D1 instead of off the block
        // the tick used to splice. Phase A reads state for all twelve teams so
        // Phase B can price the schedule, so this is the assertion that the READ
        // widening did not turn into a WRITE widening: a team that played this
        // tick has a freshly stamped row, and a team that did not still holds the
        // publish's row byte for byte, stamps included.
        const touched1 = new Set(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
        const publishedByKey = new Map(harness.publishedRows.map((r) => [`${r.scopeKind}::${r.scopeKey}`, r]));
        for (const teamKey of SB_TEAMS) {
          const d1Row = harness.d1.algorithmState.get(`spr::team::${teamKey}`);
          expect(d1Row, `no D1 row for ${teamKey}`).toBeDefined();
          if (touched1.has(teamKey)) {
            expect(d1Row!.generation, `${teamKey} played this tick and was not rewritten`).not.toBe(SB_SEED_STAMP.generation);
          } else {
            expect(sbStateRowOf(d1Row!), `untouched ${teamKey}`).toEqual(publishedByKey.get(`team::${teamKey}`));
          }
        }
        // The league row always advances: the scale, the Sigma population and the
        // RP mean shift all move on every fold.
        expect(harness.d1.algorithmState.get("spr::league::league")!.generation).not.toBe(SB_SEED_STAMP.generation);

        // Fully priced rows, with the published sort time preserved rather than
        // re-derived from TBA's `time` (260915-isq's one surviving rule).
        const publishedSortTimes = new Map(harness.publishedUpcoming.map((r) => [r.matchKey, r.sortTime]));
        expect(afterTick1.upcoming).toHaveLength(3);
        for (const row of afterTick1.upcoming) {
          expect(row.sortTime).toBe(publishedSortTimes.get(row.matchKey as string));
          expect(row.redMatchBandVariance, `${String(row.matchKey)}: no band`).toBeTypeOf("number");
          expect(row.redRpPmf, `${String(row.matchKey)}: no RP pmf`).toBeDefined();
        }
        // Match 6 pairs touched frc1 with untouched frc7-frc11.
        const match6 = afterTick1.upcoming.find((r) => r.matchKey === matchKeyOf(SB_LIVE_FIXTURES[5]!))!;
        expect([...(match6.redTeams as string[]), ...(match6.blueTeams as string[])].filter((t) => touched1.has(t))).toEqual(["frc1"]);

        // Tick 2: matches 6 and 7 in one tick.
        await harness.tickTo(7);
        const afterTick2 = await harness.readArtifact();
        sbExpectExact(sbWrittenUpcoming(afterTick2), sbOfflineAt(7).upcoming);
        expect("state" in afterTick2).toBe(false);
        // frc12 is on match 8's roster and has still played nothing, so two ticks
        // of reading its state have left its D1 row exactly as the publish wrote
        // it — and match 8 still prices, from that row.
        expect(sbStateRowOf(harness.d1.algorithmState.get("spr::team::frc12")!), "frc12 keeps the publish's row").toEqual(
          publishedByKey.get("team::frc12")
        );
        for (const row of afterTick2.upcoming) {
          expect(row.sortTime).toBe(publishedSortTimes.get(row.matchKey as string));
          expect(row.redRpPmf, `${String(row.matchKey)}: no RP pmf`).toBeDefined();
        }

        // Tick 3: the last match. Nothing left to price.
        await harness.tickTo(8);
        const afterTick3 = await harness.readArtifact();
        expect(afterTick3.upcoming).toEqual([]);
        expect("state" in afterTick3).toBe(false);
        expect(afterTick3.eventType).toBe(EVENT_TYPE);

        expect(warn, "the healthy path must not warn").not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    },
    120_000
  );
});

describe("scheduled.rp — a published state block is dropped, and eventType", () => {
  function warnLines(warn: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }, msg: string): Record<string, unknown>[] {
    return warn.mock.calls
      .map((call: readonly unknown[]) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter((line: Record<string, unknown> | undefined): line is Record<string, unknown> => line !== undefined && line.msg === msg);
  }

  /** The tick prices its own upcoming rows (260923-3w6), so a warning path must still leave fully priced rows behind. */
  function expectPriced(upcoming: readonly Record<string, unknown>[], played: number): void {
    expect(upcoming.length).toBeGreaterThan(0);
    expect(upcoming.map((row) => EventUpcomingMatchSchema.parse(row))).toEqual(sbOfflineAt(played).upcoming);
  }

  it(
    "a published block is DROPPED and nothing is warned about it — even one the retired splice would have rejected",
    async () => {
      // Until quick task 260923-3w6 this block's stale `algorithmVersion` made the
      // splice throw, which cost the event its browser pricing and emitted an
      // `event-state-block-invalid` line an operator had to act on by republishing
      // and re-seeding as a matched pair. The tick reads no block at all now, so a
      // stale one is simply dropped on the next write and there is nothing to warn
      // about: the upcoming rows price from D1 regardless.
      const stale = (block: EventStateBlock): EventStateBlock => ({
        ...block,
        algorithmVersion: "0.0.0+stale",
        rows: block.rows.map((row) => ({ ...row, algorithmVersion: "0.0.0+stale" })),
      });
      const harness = await sbHarness({ publishedState: stale });
      expect((await harness.readArtifact()).state, "the fixture did not publish the stale block").toBeDefined();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await harness.tickTo(5);
        const artifact = await harness.readArtifact();
        expect("state" in artifact).toBe(false);
        expectPriced(artifact.upcoming, 5);
        expect(warnLines(warn, "event-state-block-invalid")).toEqual([]);
        expect(warnLines(warn, "event-state-block-missing")).toEqual([]);
        expect(warnLines(warn, "upcoming-pricing-failed")).toEqual([]);
      } finally {
        warn.mockRestore();
      }
    },
    120_000
  );

  it(
    "a failed event-detail fetch keeps the existing artifact's eventType, and never writes the -1 sentinel when there is none",
    async () => {
      const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const kept = await sbHarness({ detailStatus: 500, publishedEventType: 2 });
        await kept.tickTo(5);
        expect((await kept.readArtifact()).eventType).toBe(2);
        vi.unstubAllGlobals();

        const absent = await sbHarness({ detailStatus: 500, publishedEventType: undefined });
        expect("eventType" in (await absent.readArtifact())).toBe(false);
        await absent.tickTo(5);
        const artifact = await absent.readArtifact();
        expect("eventType" in artifact, `eventType was written as ${JSON.stringify(artifact.eventType)}`).toBe(false);
      } finally {
        quiet.mockRestore();
      }
    },
    120_000
  );
});
