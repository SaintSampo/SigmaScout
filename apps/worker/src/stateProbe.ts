/**
 * READ-ONLY PRE-EVENT STATE PROBE (quick task 260912-3e6).
 *
 * A separate Worker deployment (`wrangler.probe.toml`) that answers two
 * questions nothing else in this system answers, and that would otherwise be
 * answered for the first time during a live event, in front of visitors:
 *
 *   1. Can the DEPLOYED bundle read the rows now sitting in live D1? The
 *      real `deserializeState` has been run locally over rows pulled
 *      verbatim from live D1 and opr/epa/spr all deserialize — but that only
 *      proves the CODE can do it. Whether the currently-DEPLOYED Worker
 *      bundle can is a deploy-ordering property (which
 *      `STATE_SNAPSHOT_SHAPE_VERSION` it was built against), not a code
 *      property, and only something running inside the deployed runtime can
 *      settle it.
 *   2. What does a tick that actually folds the ranking-point path cost, in
 *      real Workers CPU time? Completely unmeasured. Live ticks report
 *      `cpuTime` 1 ms, and that number is worthless: the live-windows
 *      manifest is `windows: []`, so `processEvent` (`scheduled.ts:1002`)
 *      returns at its `newlyFolded.length === 0` check BEFORE a single
 *      league row is read. Every green tick since the 2026-09-12 seed is
 *      green for a reason that has nothing to do with this question — the
 *      Phase 9 ranking-point work (`analyticRpPmf` per match, on every
 *      still-upcoming match at the event) has never executed inside the
 *      Workers runtime against real beliefs.
 *
 * THE TWO-LAYER WRITE GUARANTEE (state this in exactly these terms — see the
 * plan's own table, and do not restate the brief's stronger, false claim
 * that the absence of write bindings is "the structural guarantee it cannot
 * mutate anything"; that is true for R2/KV and FALSE for D1):
 *
 *   | Surface | What stops a write                         | Strength           |
 *   |---------|---------------------------------------------|--------------------|
 *   | R2      | binding absent from wrangler.probe.toml —   | structural         |
 *   |         | env.ARTIFACTS does not exist                 |                    |
 *   | KV      | binding absent — env.MANIFEST does not exist | structural         |
 *   | D1      | this file never calls a write helper, and no | TEST-ENFORCED ONLY |
 *   |         | write helper is in its import graph          | (stateProbe.test)  |
 *
 * Workers has no read-only D1 binding — this probe needs `DB` bound to read
 * state at all, and a bound D1 is writable. The guarantee that this file
 * never actually writes to it is held by `apps/worker/test/stateProbe.test.ts`
 * (static import-graph + comment-stripped source scan, PLUS a fake-D1
 * write-count assertion), not by the binding list. THIS FILE MUST NEVER:
 *   - call `writeScopedState` / `writeEventCursor` / any `artifactWriter.ts`
 *     export, or import `scheduled.ts` at all (importing it would pull
 *     those write helpers into this file's import graph even if unused,
 *     which is the one thing the test above exists to forbid);
 *   - time itself with `Date.now()`/`performance.now()` — Cloudflare freezes
 *     both between I/O operations as a Spectre mitigation, so a self-timed
 *     probe would report `durationMs: 0` and be believed. Timing comes from
 *     the runtime's own `cpuTime`, read off `wrangler tail` by a human, not
 *     from anything this file computes.
 *
 * `selectionsFor` (`scheduled.ts`) is exactly the helper this file needs to
 * build a read selection, but importing it would pull `scheduled.ts` (and
 * therefore the write helpers above) into this file's import graph — so this
 * file carries its own `probeSelectionsFor`, a deliberate duplicate pinned
 * equal to the real one by `stateProbe.test.ts`'s own equivalence test.
 *
 * ARMS (quick task 260912-iur): `?rp=0` ablates exactly the operations plan
 * 09-08 added to the live tick's Phase A, so Phase 9's share of the
 * `rp-fold-exceeds-worker-cpu-budget` overrun can be MEASURED as the
 * difference between two otherwise-identical runs instead of inferred. Which
 * operations those are was settled from `git log -S`, not from which code
 * reads as RP-shaped — see `runSprFold`'s own comment for the list and the
 * commits behind it. `rp` absent is ON and byte-identical to the pre-flag
 * probe, which is what keeps the existing 13 ms p50 / 28 ms p90 numbers
 * comparable.
 *
 * SCOPE: this probe prices Phase A only (state read, fold, serialize,
 * discard) — never Phase B (artifact merge, R2 reads/writes), TBA polling,
 * the KV manifest read, or the global rebuild. See
 * `docs/worker-operations.md`'s "Pre-event probe" section for the full
 * runbook, the same-commit ordering rule, and the conditions under which a
 * reported `cpuTime` is not a measurement at all.
 *
 * 260912-ivg Stage 1: this probe reads `PIPELINE_ALGORITHM_IDS` (the
 * WRITE tier — premier id `spr`), not `PUBLISHED_ALGORITHM_IDS`. Until
 * Stage 3's D1 reseed runs, the live database holds no `algorithm_id =
 * 'spr'` rows, so a probe run in that window legitimately reports
 * `NoLeagueRow`/zero rows for the premier algorithm rather than an error —
 * that is the expected, not-yet-seeded state, not a probe failure.
 */
import {
  readScopedState,
  selectChangedRows,
  MAX_SCOPE_KEYS_PER_READ,
  type ScopeSelection,
  type StateRow,
} from "./stateStore.js";
import {
  deserializeState,
  serializeState,
  readSwingBeliefs,
  readSigmaBeliefs,
  readSigmaPopulation,
  readRpBeliefs,
  withSwingBeliefs,
  withSigmaBeliefs,
  withSigmaPopulation,
  withRpBeliefs,
  STATE_SNAPSHOT_SHAPE_VERSION,
  type StateStamp,
} from "../../../packages/harness/stateSnapshot.js";
import { SwingFactorAccumulator } from "../../../packages/harness/swingFactor.js";
import { SigmaScoreAccumulator, usesSigmaScore } from "../../../packages/harness/sigmaScore.js";
import { RpMomentsAccumulator } from "../../../packages/core/rankingPoints/empiricalMoments.js";
import { analyticRpPmf } from "../../../packages/core/rankingPoints/analyticPmf.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { isRpEligibleEventType } from "../../../packages/core/rankingPoints/constants.js";
import { spr } from "../../../packages/core/algorithms/bpr.js";
import type { SprState } from "../../../packages/core/algorithms/bpr.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { TOTAL_METRIC_KEY, type MatchResult, type UpcomingMatch, type Prediction } from "../../../packages/core/algorithms/types.js";
import { PIPELINE_ALGORITHM_IDS } from "../../../packages/harness/manifestSchemas.js";

// `opr`/`epa` are imported for their side of `PIPELINE_ALGORITHM_IDS`'
// read-and-deserialize loop below (dispatched by id, never referenced by
// name directly) — referencing them here keeps them out of an
// unused-import lint trap while making plain that all three write-tier
// algorithms are in this file's graph on purpose.
void opr;
void epa;

/**
 * This probe's ENTIRE binding surface: one D1 database, declared LOCALLY
 * rather than reusing `./env.js`'s `Env` — so a future edit cannot reach
 * `env.ARTIFACTS`/`env.MANIFEST` by autocomplete when `wrangler.probe.toml`
 * declares neither binding at all.
 */
interface ProbeEnv {
  readonly DB: D1Database;
}

// ---------------------------------------------------------------------------
// Defaults and clamps
// ---------------------------------------------------------------------------

const DEFAULT_SEASON = 2026;
const DEFAULT_EVENT_TYPE = 0; // TBA event_type 0 = Regional, RP-eligible.
/** 04-RESEARCH.md Pattern 1's peak realistic tick. */
const DEFAULT_TEAM_COUNT = 21;
const DEFAULT_FOLDED = 2;
const DEFAULT_UPCOMING = 60;
/** `folded + upcoming` combined ceiling, so a pathological query string cannot make one probe request price an unbounded number of synthetic matches. */
const MAX_FOLDED_PLUS_UPCOMING = 200;
/** The opr selection spends one key on its event row, so the team side of any selection this probe builds must leave room for it. */
const MAX_TEAM_COUNT = MAX_SCOPE_KEYS_PER_READ - 1;

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, parseIntParam(raw, fallback)));
}

/**
 * `rp` — THE ABLATION ARM SELECTOR (quick task 260912-iur). Recognized values
 * only; anything else is ON *and warned about*, so a typo'd arm can never be
 * silently measured as the other one. Absent/empty is ON, which is what keeps
 * the existing 13 ms p50 / 28 ms p90 measurements comparable.
 */
const RP_ON_VALUES = new Set(["1", "on", "true", "yes"]);
const RP_OFF_VALUES = new Set(["0", "off", "false", "no"]);

function parseRpParam(raw: string | null): { enabled: boolean; unrecognized: string | undefined } {
  if (raw === null || raw.trim() === "") return { enabled: true, unrecognized: undefined };
  const v = raw.trim().toLowerCase();
  if (RP_OFF_VALUES.has(v)) return { enabled: false, unrecognized: undefined };
  if (RP_ON_VALUES.has(v)) return { enabled: true, unrecognized: undefined };
  return { enabled: true, unrecognized: raw.trim() };
}

function parseTeamsParam(raw: string | null): readonly string[] | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const keys = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return keys.length > 0 ? keys : undefined;
}

interface ProbeParams {
  readonly season: number;
  readonly eventType: number;
  readonly eventOverride: string | undefined;
  readonly teamsOverride: readonly string[] | undefined;
  readonly teamCount: number;
  readonly folded: number;
  readonly upcoming: number;
  /** Ablation arm. True = today's behaviour, byte-identical. False = every operation plan 09-08 (`dc30636e`) added to the tick's Phase A is skipped; see `runSprFold`. */
  readonly rp: boolean;
  /** The `rp=` value that was neither an on- nor an off-value, if any — surfaced as a warning rather than being silently coerced. */
  readonly rpUnrecognized: string | undefined;
}

function parseParams(url: URL): ProbeParams {
  const search = url.searchParams;
  const season = clampInt(search.get("season"), DEFAULT_SEASON, 1992, 2100);
  const eventType = parseIntParam(search.get("eventType"), DEFAULT_EVENT_TYPE);
  const eventOverride = search.get("event")?.trim() || undefined;
  const teamsOverride = parseTeamsParam(search.get("teams"));
  const teamCount = clampInt(search.get("teamCount"), DEFAULT_TEAM_COUNT, 0, MAX_TEAM_COUNT);
  let folded = clampInt(search.get("folded"), DEFAULT_FOLDED, 0, MAX_FOLDED_PLUS_UPCOMING);
  let upcoming = clampInt(search.get("upcoming"), DEFAULT_UPCOMING, 0, MAX_FOLDED_PLUS_UPCOMING);
  if (folded + upcoming > MAX_FOLDED_PLUS_UPCOMING) {
    upcoming = Math.max(0, MAX_FOLDED_PLUS_UPCOMING - folded);
  }
  const rp = parseRpParam(search.get("rp"));
  return { season, eventType, eventOverride, teamsOverride, teamCount, folded, upcoming, rp: rp.enabled, rpUnrecognized: rp.unrecognized };
}

// ---------------------------------------------------------------------------
// Discovery — scope_key-only, never state_json. These two queries cannot
// deserialize anything; `readScopedState` below remains the only reader of a
// state payload in this file. Discovery is overhead a real tick never pays,
// so it is counted in `discovery` below rather than folded into `algorithms`
// or `fold`.
// ---------------------------------------------------------------------------

interface DiscoveryRow {
  readonly scope_kind: string;
  readonly scope_key: string;
}

async function discoverRoster(db: D1Database, limit: number): Promise<readonly string[]> {
  if (limit <= 0) return [];
  const { results } = await db
    .prepare(`SELECT scope_kind, scope_key FROM algorithm_state WHERE algorithm_id = 'spr' AND scope_kind = 'team' ORDER BY scope_key LIMIT ?`)
    .bind(limit)
    .all<DiscoveryRow>();
  return results.map((r) => r.scope_key);
}

async function discoverEventKey(db: D1Database): Promise<string | undefined> {
  const row = await db
    .prepare(`SELECT scope_kind, scope_key FROM algorithm_state WHERE algorithm_id = 'opr' AND scope_kind = 'event' ORDER BY scope_key LIMIT 1`)
    .first<DiscoveryRow>();
  return row?.scope_key;
}

// ---------------------------------------------------------------------------
// probeSelectionsFor — a DELIBERATE DUPLICATE of `scheduled.ts`'s
// `selectionsFor`. See this file's header for why importing the real one is
// not an option. `stateProbe.test.ts` asserts these two produce deep-equal
// output across a case table including the event-scoped `opr` case, so a
// future edit to either that drifts from the other fails a named test
// instead of silently reading a different row set than a real tick.
// ---------------------------------------------------------------------------

/** Mirrors `scheduled.ts`'s `EVENT_SCOPED_ALGORITHM_IDS` — which published algorithms keep EVENT-scoped state, alongside their team rows. */
const PROBE_EVENT_SCOPED_ALGORITHM_IDS = new Set(["opr"]);

export function probeSelectionsFor(algorithmId: string, eventKey: string, touchedTeams: readonly string[]): ScopeSelection[] {
  const selections: ScopeSelection[] = [];
  if (PROBE_EVENT_SCOPED_ALGORITHM_IDS.has(algorithmId)) {
    selections.push({ scopeKind: "event", scopeKeys: [eventKey] });
  }
  selections.push({ scopeKind: "team", scopeKeys: touchedTeams });
  return selections;
}

// ---------------------------------------------------------------------------
// Synthetic match fixtures — season-2026-SHAPED. A non-2026 `season` param
// folds no observed thresholds (rp2026.parse's schema will not recognize
// this shape) and must raise a warning rather than pass silently; see
// `buildResponse` below.
// ---------------------------------------------------------------------------

const SYNTHETIC_RED_SCORE = 120;
const SYNTHETIC_BLUE_SCORE = 95;
const SYNTHETIC_RED_HUB = 140;
const SYNTHETIC_RED_TOWER = 50;
const SYNTHETIC_BLUE_HUB = 110;
const SYNTHETIC_BLUE_TOWER = 38;

/** The 2026 score-breakdown shape `rp2026.parse` actually reads — copied from `apps/worker/test/scheduled.rp.test.ts`'s `breakdownOf` helper (same shape, this file's own synthetic scores). */
function synthesizeBreakdown(): unknown {
  const side = (hub: number, tower: number) => ({
    autoTowerPoints: Math.round(tower / 2),
    endGameTowerPoints: tower - Math.round(tower / 2),
    hubScore: { totalCount: hub },
    energizedAchieved: hub >= 100,
    superchargedAchieved: hub >= 360,
    traversalAchieved: tower >= 40,
  });
  return { red: side(SYNTHETIC_RED_HUB, SYNTHETIC_RED_TOWER), blue: side(SYNTHETIC_BLUE_HUB, SYNTHETIC_BLUE_TOWER) };
}

/**
 * Rosters cycled 6-at-a-time from `teamKeys`, so every team on the discovered
 * (or overridden) roster carries beliefs. Wraps around when `teamKeys` has
 * fewer than 6 entries — a roster that small is already flagged by the
 * "roster smaller than requested" warning, and a wrapped match (a team
 * appearing on both alliances) is still a valid `predict`/`update` input,
 * just not a realistic one.
 */
function rosterAt(teamKeys: readonly string[], index: number): { red: string[]; blue: string[] } {
  const n = teamKeys.length;
  if (n === 0) return { red: [], blue: [] };
  const start = (index * 6) % n;
  const picks: string[] = [];
  for (let i = 0; i < 6; i++) picks.push(teamKeys[(start + i) % n]!);
  return { red: picks.slice(0, 3), blue: picks.slice(3, 6) };
}

function buildPlayedMatch(eventKey: string, eventType: number, matchNumber: number, red: readonly string[], blue: readonly string[]): MatchResult {
  return {
    matchKey: `${eventKey}_probe_qm${matchNumber}`,
    eventKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber,
    redTeams: red,
    blueTeams: blue,
    // Stated explicitly, not omitted — `bundleSmoke.ts`'s header records why
    // an omitted DQ list reads as harmless and is not.
    redSurrogates: [],
    blueSurrogates: [],
    redDqs: [],
    blueDqs: [],
    eventType,
    week: null,
    winner: SYNTHETIC_RED_SCORE > SYNTHETIC_BLUE_SCORE ? "red" : "blue",
    redScore: SYNTHETIC_RED_SCORE,
    blueScore: SYNTHETIC_BLUE_SCORE,
    redRpEarned: null,
    blueRpEarned: null,
    hasScoreBreakdown: true,
    scoreBreakdownRaw: JSON.stringify(synthesizeBreakdown()),
  };
}

function buildUpcomingMatch(eventKey: string, eventType: number, matchNumber: number, red: readonly string[], blue: readonly string[]): UpcomingMatch {
  return {
    matchKey: `${eventKey}_probe_qm${matchNumber}`,
    eventKey,
    compLevel: "qm",
    setNumber: 1,
    matchNumber,
    redTeams: red,
    blueTeams: blue,
    redSurrogates: [],
    blueSurrogates: [],
    eventType,
    week: null,
  };
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface AlgorithmProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly leagueRowPresent: boolean;
  readonly rowsRead: { readonly league: number; readonly team: number; readonly event: number };
  readonly snapshotShapeVersionObserved?: unknown;
  readonly algorithmVersion?: string;
  readonly generation?: string;
  readonly computedAt?: string;
  readonly error?: { readonly name: string; readonly message: string };
}

interface FoldResult {
  readonly algorithmId: "spr";
  readonly matchesFolded: number;
  readonly upcomingPriced: number;
  readonly bandsProduced: number;
  readonly rpPmfsProduced: number;
  readonly rpObservedFolds: number;
  readonly changedRowsDiscarded: number;
  readonly error?: { readonly name: string; readonly message: string };
}

interface ProbeResponseBody {
  readonly ok: boolean;
  readonly shapeVersionExpected: number;
  readonly params: {
    readonly season: number;
    readonly eventType: number;
    readonly event: string;
    readonly teams: readonly string[];
    readonly teamCount: number;
    readonly folded: number;
    readonly upcoming: number;
    /** Which ablation arm produced this body. Echoed so a `cpuTime` read off `wrangler tail` can never be attributed to the wrong arm. */
    readonly rp: boolean;
  };
  readonly discovery: {
    readonly teamKeysFound: number;
    readonly eventKeyFound: string | undefined;
    readonly queries: number;
  };
  readonly algorithms: readonly AlgorithmProbeResult[];
  readonly fold: FoldResult;
  readonly warnings: readonly string[];
}

/** A literal, never a clock read — see this file's header on why the probe must not time itself. `serializeState`/`withSwingBeliefs`/etc. all thread a stamp through, and this probe's rows are discarded, so the stamp's actual value is inert; it exists only because the shared serializer contract requires one. */
const PROBE_STAMP: StateStamp = { generation: "probe", computedAt: "1970-01-01T00:00:00.000Z" };

async function readAndDeserializeAll(
  db: D1Database,
  eventKey: string,
  teamKeys: readonly string[]
): Promise<{ algorithms: AlgorithmProbeResult[]; sprRows: StateRow[] | undefined; sprState: SprState | undefined }> {
  const algorithms: AlgorithmProbeResult[] = [];
  let sprRows: StateRow[] | undefined;
  let sprState: SprState | undefined;

  for (const algorithmId of PIPELINE_ALGORITHM_IDS) {
    const rowsRead = { league: 0, team: 0, event: 0 };
    let leagueRowPresent = false;
    try {
      const selections = probeSelectionsFor(algorithmId, eventKey, teamKeys);
      const rows = await readScopedState(db, algorithmId, selections);
      for (const row of rows) rowsRead[row.scopeKind]++;
      const leagueRow = rows.find((row) => row.scopeKind === "league");
      leagueRowPresent = leagueRow !== undefined;

      if (leagueRow === undefined) {
        // NEVER cold-start via initState here — that would measure a
        // fiction, not a real tick (this file's header).
        algorithms.push({
          id: algorithmId,
          ok: false,
          leagueRowPresent,
          rowsRead,
          error: {
            name: "NoLeagueRow",
            message: `no scopeKind:"league" row present for algorithm "${algorithmId}" — this is not yet seeded, or the probe's discovered/overridden scope keys named no seeded row; deserializeState was NOT called`,
          },
        });
        continue;
      }

      let snapshotShapeVersionObserved: unknown;
      try {
        snapshotShapeVersionObserved = (JSON.parse(leagueRow.stateJson) as Record<string, unknown>).snapshotShapeVersion;
      } catch {
        // A field read off the already-fetched league row, not a second
        // deserializer — if this JSON.parse fails, deserializeState below
        // will fail identically and surface the real error.
      }

      const state = deserializeState(algorithmId, rows);
      algorithms.push({
        id: algorithmId,
        ok: true,
        leagueRowPresent,
        rowsRead,
        snapshotShapeVersionObserved,
        algorithmVersion: leagueRow.algorithmVersion,
        generation: leagueRow.generation,
        computedAt: leagueRow.computedAt,
      });

      if (algorithmId === "spr") {
        sprRows = rows;
        sprState = state as SprState;
      }
    } catch (err) {
      algorithms.push({
        id: algorithmId,
        ok: false,
        leagueRowPresent,
        rowsRead,
        error: {
          name: err instanceof Error ? err.name : "UnknownError",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return { algorithms, sprRows, sprState };
}

/**
 * The fold, `spr` ONLY — matching `wrangler.toml`'s tracked
 * `LIVE_ALGORITHM_IDS`. Drives the SAME sequence `scheduled.ts:1080-1300`
 * drives, in the same order: resume Swing/Sigma/RP accumulators from the
 * rows just read, price `folded` played matches (predict, band, RP fields,
 * update, fold), then price `upcoming` still-upcoming matches (predict,
 * band, RP fields — read-only), then serialize-and-discard.
 *
 * THE `rpEnabled` ABLATION ARM (quick task 260912-iur). `false` skips exactly
 * the operations plan 09-08 (`dc30636e`, 2026-09-11) added to `processEvent`'s
 * Phase A, established from `git log -S` rather than from which code looks
 * RP-shaped:
 *
 *   SKIPPED when off — all four are `+` lines in `dc30636e`:
 *     1. the accumulator resume: `RP_RULE_MODULES[season]`, `readRpBeliefs`,
 *        `RpMomentsAccumulator.fromBeliefs`, and the `rpKnownTeams` set
 *     2. `rpFieldsFor` — the `analyticRpPmf` call, its four gates, and 09-07's
 *        decomposition — in BOTH the played and the upcoming loop
 *     3. `foldObservedRp` — the per-side `rpRuleModule.parse` + `rp.fold`
 *     4. `withRpBeliefs` on the serialize-and-discard path
 *
 *   KEPT in BOTH arms — these PREDATE Phase 9 and are not its cost to bear:
 *     - the whole upcoming-repricing loop, `dabe9acd` (04-06, 2026-08-22).
 *       Phase 9 added `analyticRpPmf` INTO an already-costly loop; it did not
 *       create the loop.
 *     - every `bandFor` call in both loops: `63596da3` (2026-09-09) as
 *       `swing.bandVarianceFor`, then `447395a1` (2026-09-10) as the
 *       Sigma-dispatching `bandFor` closure. Both land BEFORE Phase 9's first
 *       commit (2026-09-11), so `bandsProduced` must come out IDENTICAL in the
 *       two arms — `stateProbe.test.ts` asserts exactly that. Ablating the
 *       bands would credit Phase 9 with work that was already there and
 *       overstate its share of the overrun.
 *     - `spr.predict`/`spr.update`, Swing/Sigma folds, the talent read, and
 *       `serializeState` + the Swing/Sigma passengers.
 */
function runSprFold(
  sprRows: StateRow[],
  sprState: SprState,
  eventKey: string,
  eventType: number,
  season: number,
  teamKeys: readonly string[],
  folded: number,
  upcoming: number,
  rpEnabled: boolean
): FoldResult {
  if (teamKeys.length === 0) {
    return {
      algorithmId: "spr",
      matchesFolded: 0,
      upcomingPriced: 0,
      bandsProduced: 0,
      rpPmfsProduced: 0,
      rpObservedFolds: 0,
      changedRowsDiscarded: 0,
      error: { name: "EmptyRoster", message: "no teams available (discovery found none and no teams= override was supplied) — cannot build synthetic matches" },
    };
  }

  try {
    // Resumed from the rows just read — a fresh accumulator would price
    // these synthetic matches from nothing, which answers a different
    // question than "what does a REAL tick's resumed fold cost".
    const swing = SwingFactorAccumulator.fromBeliefs(readSwingBeliefs(sprRows));
    const sigma = usesSigmaScore("spr") ? SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs(sprRows), readSigmaPopulation(sprRows)) : undefined;
    const bandFor = (roster: readonly string[]): number | undefined => (sigma === undefined ? swing.bandVarianceFor(roster) : sigma.bandVarianceFor(roster));

    // Indexed lookup, never `rpRuleModuleForSeason` (which throws for an
    // unmapped season) — an unregistered season yields no accumulator and a
    // named warning at the response level, never a failed probe.
    //
    // OPERATION 1 of the ablation set. Gating the module lookup and the
    // belief read here is what makes operations 2-4 fall out: `rpFieldsFor`,
    // `foldObservedRp` and the `withRpBeliefs` call below are ALL already
    // guarded on `rp === undefined`, which is the same guard an unregistered
    // season (2021) trips. Off-arm therefore skips the `readRpBeliefs` JSON
    // walk and the `fromBeliefs` reconstruction too, not merely the pmf call.
    const rpRuleModule = rpEnabled ? RP_RULE_MODULES[season] : undefined;
    const rpBeliefs = rpEnabled ? readRpBeliefs(sprRows) : undefined;
    const rp = rpRuleModule !== undefined && rpBeliefs !== undefined ? RpMomentsAccumulator.fromBeliefs(rpRuleModule, rpBeliefs) : undefined;
    const rpKnownTeams = new Set(rpBeliefs?.keys() ?? []);

    let bandsProduced = 0;
    let rpPmfsProduced = 0;
    let rpObservedFolds = 0;

    const rpFieldsFor = (
      view: { redTeams: readonly string[]; blueTeams: readonly string[]; eventType: number; matchKey: string; compLevel: MatchResult["compLevel"] },
      prediction: Prediction,
      redBandVariance: number | undefined,
      blueBandVariance: number | undefined
    ): Partial<Prediction> => {
      if (rp === undefined || rpRuleModule === undefined) return {};
      if (!isRpEligibleEventType(view.eventType)) return {};
      if (redBandVariance === undefined || blueBandVariance === undefined) return {};
      // THE PARTIAL-ROSTER GATE — mirrors `scheduled.ts:1140-1156` exactly.
      // Removing it would OVER-price as surely as tripping it under-prices;
      // it is part of what this probe exists to measure, not overhead to
      // strip out.
      for (const teamKey of [...view.redTeams, ...view.blueTeams]) {
        if (!rpKnownTeams.has(teamKey)) return {};
      }

      const pmf = analyticRpPmf({
        red: rp.momentsFor(view.redTeams, prediction.redScore, redBandVariance),
        blue: rp.momentsFor(view.blueTeams, prediction.blueScore, blueBandVariance),
        ruleModule: rpRuleModule,
        eventType: view.eventType,
        compLevel: view.compLevel,
      });

      const decomposition: Partial<Prediction> =
        pmf.outcome !== undefined && pmf.redBonusPmf !== undefined && pmf.blueBonusPmf !== undefined
          ? {
              matchOutcomePmf: [pmf.outcome.pRedWin, pmf.outcome.pTie, pmf.outcome.pBlueWin],
              redOutcomeRp: [pmf.outcome.winRp, pmf.outcome.tieRp, 0],
              blueOutcomeRp: [0, pmf.outcome.tieRp, pmf.outcome.winRp],
              redBonusRpPmf: pmf.redBonusPmf,
              blueBonusRpPmf: pmf.blueBonusPmf,
            }
          : {};

      return {
        redRpPmf: pmf.redPmf,
        blueRpPmf: pmf.bluePmf,
        ...(pmf.redBonusProbabilities !== undefined ? { redBonusRp: pmf.redBonusProbabilities } : {}),
        ...(pmf.blueBonusProbabilities !== undefined ? { blueBonusRp: pmf.blueBonusProbabilities } : {}),
        ...decomposition,
      };
    };

    /** Mirrors `scheduled.ts`'s `foldObservedRp` exactly, including its degrade-to-a-counted-skip try/catch. */
    const foldObservedRp = (result: MatchResult): void => {
      if (rp === undefined || rpRuleModule === undefined) return;
      if (!isRpEligibleEventType(result.eventType)) return;
      if (!result.hasScoreBreakdown || result.scoreBreakdownRaw === null) return;
      for (const side of ["red", "blue"] as const) {
        try {
          const parsed = rpRuleModule.parse(JSON.parse(result.scoreBreakdownRaw), side, result.eventType);
          rp.fold(side === "red" ? result.redTeams : result.blueTeams, parsed.thresholdVariables);
          rpObservedFolds++;
        } catch {
          // A breakdown this season's module cannot parse contributes
          // nothing rather than failing the probe.
        }
      }
      for (const teamKey of [...result.redTeams, ...result.blueTeams]) rpKnownTeams.add(teamKey);
    };

    let state = sprState;
    let matchesFolded = 0;
    for (let i = 0; i < folded; i++) {
      const roster = rosterAt(teamKeys, i);
      const result = buildPlayedMatch(eventKey, eventType, i + 1, roster.red, roster.blue);
      const prediction = spr.predict(state, toLeakProofUpcoming(result));
      const redBandVariance = bandFor(result.redTeams);
      const blueBandVariance = bandFor(result.blueTeams);
      if (redBandVariance !== undefined) bandsProduced++;
      if (blueBandVariance !== undefined) bandsProduced++;
      const fields = rpFieldsFor(result, prediction, redBandVariance, blueBandVariance);
      // ONE increment per MATCH, not per alliance — `rpFieldsFor`'s gates
      // (rule module, event eligibility, band presence, partial roster) are
      // all-or-nothing for a given match: either both alliances get a pmf or
      // neither does. `stateProbe.test.ts` asserts this counter by EQUALITY
      // against `folded + upcoming`, so double-counting here would silently
      // halve the threshold at which a suppressed pmf becomes visible.
      //
      // With `rp=0` this is 0 BY CONSTRUCTION, which is why the test pins the
      // two arms as two equalities (`=== folded + upcoming` and `=== 0`)
      // rather than relaxing to `>= 0` — an inequality would pass vacuously in
      // both arms and destroy the guarantee above.
      if (fields.redRpPmf !== undefined) rpPmfsProduced++;

      state = spr.update(state, result);
      swing.foldMatch(result, prediction);
      sigma?.foldMatch(result, prediction);
      foldObservedRp(result);
      // Talent AFTER the fold, from the post-update state — mirrors
      // `scheduled.ts`'s ordering exactly (predict-before-update for the
      // band/RP reads above, talent read only once the fold has happened).
      if (sigma !== undefined) {
        const roster2 = [...result.redTeams, ...result.blueTeams];
        const metrics = spr.teamMetrics(state, roster2);
        for (const teamKey of roster2) {
          const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
          if (total !== undefined) sigma.observeTalent(teamKey, total);
        }
      }
      matchesFolded++;
    }

    let upcomingPriced = 0;
    for (let i = 0; i < upcoming; i++) {
      const roster = rosterAt(teamKeys, folded + i);
      const match = buildUpcomingMatch(eventKey, eventType, folded + i + 1, roster.red, roster.blue);
      const prediction = spr.predict(state, match);
      const redBandVariance = bandFor(match.redTeams);
      const blueBandVariance = bandFor(match.blueTeams);
      if (redBandVariance !== undefined) bandsProduced++;
      if (blueBandVariance !== undefined) bandsProduced++;
      const fields = rpFieldsFor(match, prediction, redBandVariance, blueBandVariance);
      // Same one-per-match counting rule as the played loop above.
      if (fields.redRpPmf !== undefined) rpPmfsProduced++;
      upcomingPriced++;
    }

    // Serialize-and-discard: the write payload's construction is part of a
    // real tick's CPU, so this probe pays it too — then throws the rows
    // away rather than calling `writeScopedState` (this file's header).
    let candidateRows = withSwingBeliefs(serializeState("spr", spr.version, state, PROBE_STAMP), swing.beliefsByTeam());
    if (rp !== undefined) candidateRows = withRpBeliefs(candidateRows, rp.beliefsByTeam());
    if (sigma !== undefined) {
      candidateRows = withSigmaPopulation(withSigmaBeliefs(candidateRows, sigma.beliefsByTeam()), sigma.population());
    }
    // `selectChangedRows` is imported from `./stateStore.js` — a module this
    // file's import graph already carries (`readScopedState`/
    // `MAX_SCOPE_KEYS_PER_READ` above) — rather than reproduced inline. It is
    // a pure comparison with no write helper anywhere in ITS own graph, so
    // importing it does not change what `stateProbe.test.ts`'s Group 1
    // static scan forbids (`writeScopedState`, `writeEventCursor`,
    // `artifactWriter.ts`, `scheduled.ts` stay unreachable either way).
    const changedRowsDiscarded = selectChangedRows(sprRows, candidateRows).length;

    return { algorithmId: "spr", matchesFolded, upcomingPriced, bandsProduced, rpPmfsProduced, rpObservedFolds, changedRowsDiscarded };
  } catch (err) {
    return {
      algorithmId: "spr",
      matchesFolded: 0,
      upcomingPriced: 0,
      bandsProduced: 0,
      rpPmfsProduced: 0,
      rpObservedFolds: 0,
      changedRowsDiscarded: 0,
      error: { name: err instanceof Error ? err.name : "UnknownError", message: err instanceof Error ? err.message : String(err) },
    };
  }
}

function buildWarnings(params: {
  season: number;
  folded: number;
  upcoming: number;
  eventOverrideSupplied: boolean;
  discoveredEventKey: string | undefined;
  resolvedEventKey: string;
  requestedTeamCount: number;
  resolvedTeamCount: number;
  fold: FoldResult;
  rpEnabled: boolean;
  rpUnrecognized: string | undefined;
}): string[] {
  const warnings: string[] = [];
  const { season, folded, upcoming, eventOverrideSupplied, discoveredEventKey, resolvedEventKey, requestedTeamCount, resolvedTeamCount, fold, rpEnabled, rpUnrecognized } = params;

  if (rpUnrecognized !== undefined) {
    warnings.push(
      `rp="${rpUnrecognized}" is not a recognized value (on: 1/on/true/yes; off: 0/off/false/no) — the RP path ran ENABLED; re-run with rp=0 if the ablated arm was intended`
    );
  }
  if (!rpEnabled) {
    warnings.push(
      `rp=0 — ABLATED ARM: plan 09-08's four additions (the RpMomentsAccumulator resume, rpFieldsFor, foldObservedRp, and the withRpBeliefs passenger) were all skipped. Bands, both predict loops and the Swing/Sigma folds still ran, because they predate Phase 9. Compare this cpuTime against an otherwise-identical rp=1 run; it is not a measurement of the tick as deployed`
    );
  }
  if (!eventOverrideSupplied && discoveredEventKey === undefined) {
    warnings.push(
      `no discovered opr event-scoped row found; falling back to event key "${resolvedEventKey}", which carries no accumulated OPR history for this event`
    );
  }
  if (RP_RULE_MODULES[season] === undefined) {
    warnings.push(`season ${season} has no registered RP rule module — RP folding is fully suppressed; rpPmfsProduced/rpObservedFolds of 0 here are not a measurement of the RP path`);
  } else if (season !== 2026) {
    warnings.push(`season ${season} !== 2026 — this probe's synthetic scoreBreakdownRaw is built in the 2026 shape rp2026.parse reads, so a different season's rule module will fold zero observed thresholds from it`);
  }
  if (resolvedTeamCount < requestedTeamCount) {
    warnings.push(`roster smaller than requested: found/used ${resolvedTeamCount} team(s) against a requested teamCount of ${requestedTeamCount} — the fold below prices a smaller roster than a real tick's peak`);
  }
  // Gated on `rpEnabled`: in the ablated arm a 0 here is the REQUESTED
  // outcome, and this warning's list of causes (partial-roster gate,
  // ineligible event type, no rule module) would name three things that did
  // not happen. The `rp=0` warning above already says what did.
  if (rpEnabled && fold.error === undefined && folded + upcoming > 0 && fold.rpPmfsProduced === 0) {
    warnings.push(`rpPmfsProduced is 0 — every RP pmf was suppressed (the partial-roster gate, an ineligible event type, or no registered rule module); the reported cpuTime is NOT evidence about the RP path`);
  }
  if (fold.error === undefined && folded + upcoming > 0 && fold.bandsProduced === 0) {
    warnings.push(`bandsProduced is 0 — no Sigma/Swing band was produced for any roster; the band-dependent RP gate above never opened, so the reported cpuTime under-prices a real tick`);
  }

  return warnings;
}

async function runProbe(request: Request, env: ProbeEnv): Promise<{ body: ProbeResponseBody; ok: boolean }> {
  const url = new URL(request.url);
  const params = parseParams(url);

  // Discovery — always runs, even when `teams`/`event` are overridden, so
  // `discovery` below is honest about what the corpus actually holds
  // regardless of which value the fold uses.
  const discoveredTeamKeys = await discoverRoster(env.DB, params.teamCount);
  const discoveredEventKey = await discoverEventKey(env.DB);

  const eventKey = params.eventOverride ?? discoveredEventKey ?? `${params.season}probe`;
  const teamKeys = (params.teamsOverride ?? discoveredTeamKeys).slice(0, params.teamCount);

  const { algorithms, sprRows, sprState } = await readAndDeserializeAll(env.DB, eventKey, teamKeys);

  const fold: FoldResult =
    sprRows !== undefined && sprState !== undefined
      ? runSprFold(sprRows, sprState, eventKey, params.eventType, params.season, teamKeys, params.folded, params.upcoming, params.rp)
      : {
          algorithmId: "spr",
          matchesFolded: 0,
          upcomingPriced: 0,
          bandsProduced: 0,
          rpPmfsProduced: 0,
          rpObservedFolds: 0,
          changedRowsDiscarded: 0,
          error: { name: "SprNotDeserialized", message: "spr state was not available — see algorithms[] for the read/deserialize failure; the fold was skipped rather than measuring a fiction" },
        };

  const warnings = buildWarnings({
    season: params.season,
    folded: params.folded,
    upcoming: params.upcoming,
    eventOverrideSupplied: params.eventOverride !== undefined,
    discoveredEventKey,
    resolvedEventKey: eventKey,
    requestedTeamCount: params.teamCount,
    resolvedTeamCount: teamKeys.length,
    fold,
    rpEnabled: params.rp,
    rpUnrecognized: params.rpUnrecognized,
  });

  const ok = algorithms.every((a) => a.ok) && fold.error === undefined;

  const body: ProbeResponseBody = {
    ok,
    shapeVersionExpected: STATE_SNAPSHOT_SHAPE_VERSION,
    params: {
      season: params.season,
      eventType: params.eventType,
      event: eventKey,
      teams: teamKeys,
      teamCount: params.teamCount,
      folded: params.folded,
      upcoming: params.upcoming,
      rp: params.rp,
    },
    discovery: {
      teamKeysFound: discoveredTeamKeys.length,
      eventKeyFound: discoveredEventKey,
      queries: 2,
    },
    algorithms,
    fold,
    warnings,
  };

  return { body, ok };
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const { body, ok } = await runProbe(request, env);
    return new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    });
  },
} satisfies ExportedHandler<ProbeEnv>;
