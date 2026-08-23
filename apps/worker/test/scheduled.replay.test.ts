/**
 * Plan 04-07 Task 2's fast, offline, CI-runnable equivalence half (D-14).
 * Drives `runTick` with the SAME hand-rolled D1/R2/KV fakes and stubbed
 * `fetch` `scheduled.test.ts` already uses (no network, no wrangler, no
 * deployed Worker) over a small recorded fixture slice, one match revealed
 * per tick — then independently replays the identical match slice offline
 * through `packages/harness`'s `WalkForwardSimulator` from a cold start, and
 * asserts the two prediction streams' digests agree for every published
 * algorithm (`opr`, `epa`, `sigma1`).
 *
 * THIS TEST vs. `scripts/replayRig.ts`'s deployed-Worker rig — both are
 * required and they prove DIFFERENT things (recorded here so a future editor
 * of either does not treat the other as redundant):
 *   - This test catches a divergence introduced by a CODE change (e.g. a
 *     future edit to `scheduled.ts`'s fold loop that quietly reorders
 *     `predict`/`update`, or a rounding drift) — it runs in seconds, in every
 *     CI run, against fakes.
 *   - The deployed rig catches a divergence introduced by the PLATFORM (a
 *     real D1/R2 round-trip, real JSON serialization over the wire, a real
 *     bundled build) — something no fake, however faithful, can exercise.
 * Neither substitutes for the other; D-14's full claim rests on both passing.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTick } from "../src/scheduled.js";
import { LIVE_WINDOWS_MANIFEST_KEY, ALGORITHMS_MANIFEST_KEY } from "../src/liveWindows.js";
import { artifactKey } from "../../../packages/harness/pageArtifacts.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { makeSigma1 } from "../../../packages/core/algorithms/sigma1/index.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { roundMetric, roundProbability } from "../../../packages/harness/rounding.js";
import type { AlgorithmModule, MatchResult, Prediction } from "../../../packages/core/algorithms/types.js";
import type { Env } from "../src/env.js";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * `packages/harness/replay.ts` (`WalkForwardSimulator`) and
 * `packages/harness/promote.ts` (`computePredictionStreamDigest`) both
 * import `packages/corpus/db.ts` at module top level for unrelated exports
 * (`buildSeasonStream`/`selectMatchesChronological`), which pulls in
 * `better-sqlite3` and triggers the exact `URL` ambient-type collision
 * `apps/worker/src/liveWindows.ts`'s own header documents for the identical
 * reason (plan 04-06 Task 1's `manifestSchemas.ts` extraction). This file
 * lives inside apps/worker's Cloudflare-typed program, so it cannot import
 * either — the two tiny functions actually needed
 * (`WalkForwardSimulator.run`'s predict/update loop,
 * `computePredictionStreamDigest`'s hash) are reimplemented below,
 * byte-for-byte identical to their originals (D-06's own established
 * small-duplication precedent for this exact cross-boundary situation).
 */
interface OfflinePredictionRecord {
  readonly match: MatchResult;
  readonly prediction: Prediction;
}

function runOfflineWalkForward(matches: readonly MatchResult[], algorithm: AlgorithmModule<any>, teams: readonly string[]): OfflinePredictionRecord[] {
  let state = algorithm.initState([...teams]);
  const predictions: OfflinePredictionRecord[] = [];
  for (const result of matches) {
    const prediction = algorithm.predict(state, toLeakProofUpcoming(result));
    predictions.push({ match: result, prediction });
    state = algorithm.update(state, result);
  }
  return predictions;
}

/** Byte-for-byte identical to `packages/harness/promote.ts`'s `computePredictionStreamDigest` — see this file's import-boundary comment above for why it is reimplemented rather than imported. */
function computePredictionStreamDigestLocal(records: readonly OfflinePredictionRecord[]): string {
  const lines = records.map((r) => JSON.stringify([r.match.matchKey, r.prediction.pRedWin, r.prediction.redScore, r.prediction.blueScore]));
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

// ---------------------------------------------------------------------------
// Fakes — deliberately the SAME shapes scheduled.test.ts already validates
// against real production SQL (this test does not re-derive its own fake
// D1/R2 semantics, which would risk silently diverging from what the tick
// actually issues).
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

// Quick task 260822-wqt: this test asserts D-14's equivalence property
// across ALL THREE published algorithms, so its live tier is deliberately
// left at all three rather than narrowed to sigma1 — it already overrides
// the subrequest budget (`subrequestCap: 1000, subrequestReserve: 0`) below
// precisely because it tests the equivalence property, not the deferral
// mechanism `scheduled.test.ts` covers directly. Narrowing this to sigma1
// would silently drop opr/epa fold-equivalence coverage while the suite
// stayed green.
function makeEnv(kv: FakeKvNamespace, d1: FakeD1Database, r2: FakeR2Bucket): Env {
  return {
    DB: d1 as unknown as D1Database,
    ARTIFACTS: r2 as unknown,
    MANIFEST: kv as unknown,
    TBA_API_KEY: "test-key",
    TBA_BASE_URL: "https://tba.example.invalid/api/v3",
    LIVE_ALGORITHM_IDS: "opr,epa,sigma1",
  } as Env;
}

function liveWindowsManifest(windows: readonly { eventKey: string; season: number; startMs: number; endMs: number }[]): string {
  return JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", windows: windows.map((w) => ({ ...w, inferred: false })) });
}

const ALGORITHM_IDS = ["opr", "epa", "sigma1"] as const;

function algorithmsManifestJson(): string {
  const algorithms = [
    { id: "opr", version: "3.0.0+baseline", codeVersion: "3.0.0", paramSetName: "baseline" },
    { id: "epa", version: "1.0.0+baseline", codeVersion: "1.0.0", paramSetName: "baseline" },
    { id: "sigma1", version: "2.0.0+test", codeVersion: "2.0.0", paramSetName: "test" },
  ];
  return JSON.stringify({ schemaVersion: 1, generation: "gen-1", computedAt: "2026-08-22T00:00:00.000Z", algorithms });
}

/** The SAME dispatch `apps/worker/src/scheduled.ts`'s `buildAlgorithmModules` performs for these three ids — reimplemented locally (never imported: this file lives inside apps/worker's own Cloudflare-typed program, so importing `scheduled.ts` here is fine and safe, but keeping the offline comparison's module construction independent of the code path under test is what makes a real divergence between them detectable rather than tautological). */
function buildOfflineModule(id: string): AlgorithmModule<any> {
  if (id === "opr") return opr;
  if (id === "epa") return epa;
  return makeSigma1({ id, linkMode: "predictive-variance", paramSetName: "test" });
}

// ---------------------------------------------------------------------------
// One fixture slice, defined once, projected into BOTH the raw TBA shape fed
// to the stubbed fetch AND the MatchResult shape fed to WalkForwardSimulator
// — a single source of truth per match so the two halves cannot drift apart.
// ---------------------------------------------------------------------------

const EVENT_KEY = "2026casj";
const SEASON = 2026;
const NOW_MS = Date.parse("2026-08-22T12:00:00.000Z");

interface MatchFixture {
  readonly matchNumber: number;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly redScore: number;
  readonly blueScore: number;
}

const MATCH_FIXTURES: readonly MatchFixture[] = [
  { matchNumber: 1, redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"], redScore: 120, blueScore: 95 },
  { matchNumber: 2, redTeams: ["frc7", "frc8", "frc1"], blueTeams: ["frc2", "frc3", "frc4"], redScore: 88, blueScore: 110 },
  { matchNumber: 3, redTeams: ["frc5", "frc6", "frc7"], blueTeams: ["frc8", "frc1", "frc2"], redScore: 140, blueScore: 130 },
  { matchNumber: 4, redTeams: ["frc3", "frc4", "frc5"], blueTeams: ["frc6", "frc7", "frc8"], redScore: 75, blueScore: 100 },
  { matchNumber: 5, redTeams: ["frc1", "frc4", "frc7"], blueTeams: ["frc2", "frc5", "frc8"], redScore: 160, blueScore: 155 },
  { matchNumber: 6, redTeams: ["frc3", "frc6", "frc8"], blueTeams: ["frc1", "frc5", "frc7"], redScore: 99, blueScore: 101 },
];

const ALL_TOUCHED_TEAMS = [...new Set(MATCH_FIXTURES.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort();

function matchKeyOf(f: MatchFixture): string {
  return `${EVENT_KEY}_qm${f.matchNumber}`;
}

function winnerOf(f: MatchFixture): "red" | "blue" {
  return f.redScore > f.blueScore ? "red" : "blue";
}

/** Raw TBA `GET /event/{key}/matches` element shape (mirrors scheduled.test.ts's `tbaMatch` helper). */
function toTbaMatch(f: MatchFixture): unknown {
  return {
    key: matchKeyOf(f),
    event_key: EVENT_KEY,
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
    score_breakdown: null,
  };
}

/** The SAME match, as a leak-proof-eligible `MatchResult` for the offline `WalkForwardSimulator` half. */
function toMatchResult(f: MatchFixture): MatchResult {
  return {
    matchKey: matchKeyOf(f),
    eventKey: EVENT_KEY,
    compLevel: "qm",
    setNumber: 1,
    matchNumber: f.matchNumber,
    redTeams: f.redTeams,
    blueTeams: f.blueTeams,
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 0,
    winner: winnerOf(f),
    redScore: f.redScore,
    blueScore: f.blueScore,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: false,
    scoreBreakdownRaw: null,
  };
}

function makeTbaFetchStub(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    if (/\/event\/[^/]+\/matches$/.test(u)) {
      const revealed = MATCH_FIXTURES.slice(0, revealedCount).map(toTbaMatch);
      return { status: 200, ok: true, headers: { get: (name: string) => (name === "etag" ? `etag-${revealedCount}` : null) }, json: async () => revealed };
    }
    if (/\/event\/[^/]+$/.test(u)) {
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ key: EVENT_KEY, year: SEASON, event_type: 0, start_date: "2026-08-01" }) };
    }
    throw new Error(`unexpected TBA fetch URL in test stub: ${u}`);
  });
}

// Mutated per-tick by the driving loop below — the stubbed fetch always
// returns exactly the matches "revealed so far," mirroring the real rig's
// progressive-reveal mechanism against a fixture endpoint.
let revealedCount = 0;

afterEach(() => {
  vi.unstubAllGlobals();
  revealedCount = 0;
});

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe("scheduled.replay — offline equivalence (D-14)", () => {
  it(
    "drives runTick over a recorded fixture slice, one match per tick, and matches an independent offline WalkForwardSimulator replay's prediction-stream digest for opr/epa/sigma1",
    async () => {
      const window = { eventKey: EVENT_KEY, season: SEASON, startMs: NOW_MS - 3_600_000, endMs: NOW_MS + 3_600_000 };
      const kv = new FakeKvNamespace(new Map([[LIVE_WINDOWS_MANIFEST_KEY, liveWindowsManifest([window])], [ALGORITHMS_MANIFEST_KEY, algorithmsManifestJson()]]));
      const d1 = new FakeD1Database();
      const r2 = new FakeR2Bucket();
      vi.stubGlobal("fetch", makeTbaFetchStub());
      const env = makeEnv(kv, d1, r2);

      // Drive one tick per revealed match, exactly like the deployed rig's
      // manual-trigger mode — a fresh `nowMs` per tick so each fold has a
      // distinct stamp, matching production's real per-invocation behavior.
      for (let i = 0; i < MATCH_FIXTURES.length; i++) {
        revealedCount = i + 1;
        // A real 6-team match folded across all three published algorithms in
        // ONE tick is already close to the real SUBREQUEST_CAP by itself
        // (Task 3's own worst-case-tick investigation is exactly about this
        // scaling concern) — this test's purpose is the EQUIVALENCE property,
        // not a re-test of the deferral mechanism scheduled.test.ts already
        // covers directly, so the budget is generously overridden via
        // `RunTickDeps`'s own test-only injection point.
        const result = await runTick(env, { nowMs: NOW_MS + i * 60_000, globalRebuildIntervalMs: Number.MAX_SAFE_INTEGER, subrequestCap: 1000, subrequestReserve: 0 });
        expect(result.eventsFailed).toBe(0);
        expect(result.eventsAdvanced).toBe(1);
      }

      const matchResults = MATCH_FIXTURES.map(toMatchResult);

      for (const algorithmId of ALGORITHM_IDS) {
        const offlineModule = buildOfflineModule(algorithmId);
        const offlineRecords = runOfflineWalkForward(matchResults, offlineModule, [...ALL_TOUCHED_TEAMS]);
        const offlineRounded = offlineRecords.map((r) => ({
          match: r.match,
          prediction: { ...r.prediction, pRedWin: roundProbability(r.prediction.pRedWin), redScore: roundMetric(r.prediction.redScore), blueScore: roundMetric(r.prediction.blueScore) },
        }));
        const offlineDigest = computePredictionStreamDigestLocal(offlineRounded);

        const key = artifactKey({ page: "event", eventKey: EVENT_KEY, algorithmId, version: offlineModule.version });
        const publishedText = await r2.get(key);
        expect(publishedText, `no published event artifact found at ${key} for algorithm "${algorithmId}"`).not.toBeNull();
        const published = JSON.parse(await publishedText!.text()) as { matches: { matchKey: string; pRedWin: number; predictedRedScore: number; predictedBlueScore: number }[] };
        expect(published.matches).toHaveLength(MATCH_FIXTURES.length);

        // Order both streams identically (chronological match order, the
        // SAME order matchResults/MATCH_FIXTURES already carry) before
        // digesting — a digest is order-sensitive by design (promote.ts).
        const byKey = new Map(published.matches.map((m) => [m.matchKey, m]));
        const onlineOrdered = matchResults.map((m) => byKey.get(m.matchKey)!);
        const onlineDigestInput = onlineOrdered.map((row) => ({
          match: { matchKey: row.matchKey } as MatchResult,
          prediction: { winner: "red" as const, pRedWin: row.pRedWin, redScore: row.predictedRedScore, blueScore: row.predictedBlueScore },
        }));
        const onlineDigest = computePredictionStreamDigestLocal(onlineDigestInput);

        expect(onlineDigest, `algorithm "${algorithmId}": online (deployed-tick) and offline (WalkForwardSimulator) prediction-stream digests diverged`).toBe(offlineDigest);
      }
    },
    60_000
  );
});
