/**
 * READ-ONLY PRE-EVENT STATE PROBE, a separate Worker (`wrangler.probe.toml`)
 * that answers before an event, not in front of visitors:
 *
 *   1. Can the deployed bundle deserialize the rows in live D1? That depends
 *      on which `STATE_SNAPSHOT_SHAPE_VERSION` was deployed, so only the
 *      deployed runtime can settle it.
 *   2. What does a tick that folds the ranking-point path cost in real CPU
 *      time? An idle tick never reads a league row, so its `cpuTime` cannot say.
 *
 * WRITE GUARANTEE, two layers: R2 and KV are structurally unwritable (their
 * bindings are absent from `wrangler.probe.toml`). D1 is NOT: Workers has no
 * read-only D1 binding, so "never writes D1" is enforced only by
 * `test/stateProbe.test.ts` (import graph, comment-stripped source scan,
 * fake-D1 write count). THIS FILE MUST NEVER:
 *   - call `writeScopedState` / `writeEventCursor` / any `artifactWriter.ts`
 *     export, or import `scheduled.ts` (that pulls the write helpers into
 *     the import graph);
 *   - time itself with `Date.now()`/`performance.now()`: Cloudflare freezes
 *     both between I/O operations, so it would report `durationMs: 0`.
 *     Timing is the runtime's `cpuTime`, read off `wrangler tail`.
 *
 * Hence `probeSelectionsFor` duplicates `scheduled.ts`'s `selectionsFor`,
 * pinned equal by `stateProbe.test.ts`.
 *
 * ARMS: `?rp=0` skips exactly the tick's Phase A ranking-point operations
 * (mean shift included; list in `runSprFold`), so their CPU share is measured
 * as a difference between two runs. `rp` absent is ON. `?rpSkip=` further
 * splits that arm into six independently switchable RP components (see
 * `resolveRpArm`), so a single component's cost can be attributed rather than
 * the whole RP path at once. Runbook: `docs/worker-operations.md`, "Pre-event probe".
 *
 * SCOPE: Phase A only (state read, fold, serialize, discard), never Phase B,
 * TBA polling, the KV read or the global rebuild. Runbook:
 * `docs/worker-operations.md`, "Pre-event probe".
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
  readSigmaBeliefs,
  readSigmaPopulation,
  readRpBeliefs,
  readRpMeanShift,
  withSigmaBeliefs,
  withSigmaPopulation,
  withRpBeliefs,
  withRpMeanShift,
  STATE_SNAPSHOT_SHAPE_VERSION,
  type StateStamp,
} from "../../../packages/harness/stateSnapshot.js";
import { SigmaScoreAccumulator, usesSigmaScore, publishesRankingPoints, sigmaMatchBandVariance } from "../../../packages/harness/sigmaScore.js";
import { RpMomentsAccumulator } from "../../../packages/core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm } from "../../../packages/core/rankingPoints/meanShift.js";
import { analyticRpPmf } from "../../../packages/core/rankingPoints/analyticPmf.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { isRpEligibleEventType } from "../../../packages/core/rankingPoints/constants.js";
import { isDemoTeamKey } from "../../../packages/core/algorithms/demoTeams.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import type { SprState } from "../../../packages/core/algorithms/spr.js";
import { opr } from "../../../packages/core/algorithms/opr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { TOTAL_METRIC_KEY, type MatchResult, type UpcomingMatch, type Prediction } from "../../../packages/core/algorithms/types.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../packages/harness/manifestSchemas.js";

// `opr`/`epa` are dispatched by id in the deserialize loop below; referenced
// here so all three published algorithms stay in the graph on purpose.
void opr;
void epa;

/** The probe's entire binding surface, declared locally (not `./env.js`'s `Env`) so no edit can reach bindings `wrangler.probe.toml` does not declare. */
interface ProbeEnv {
  readonly DB: D1Database;
}

// ---------------------------------------------------------------------------
// Defaults and clamps
// ---------------------------------------------------------------------------

const DEFAULT_SEASON = 2026;
const DEFAULT_EVENT_TYPE = 0; // TBA event_type 0 = Regional, RP-eligible.
/** Peak realistic tick roster size. */
const DEFAULT_TEAM_COUNT = 21;
const DEFAULT_FOLDED = 2;
const DEFAULT_UPCOMING = 60;
/** `folded + upcoming` ceiling, so a query string cannot price unboundedly many synthetic matches. */
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

/** `rp`, the ablation arm. Unrecognized values are ON with a warning, so a typo is never silently measured as the other arm; absent is ON. */
const RP_ON_VALUES = new Set(["1", "on", "true", "yes"]);
const RP_OFF_VALUES = new Set(["0", "off", "false", "no"]);

function parseRpParam(raw: string | null): { enabled: boolean; unrecognized: string | undefined } {
  if (raw === null || raw.trim() === "") return { enabled: true, unrecognized: undefined };
  const v = raw.trim().toLowerCase();
  if (RP_OFF_VALUES.has(v)) return { enabled: false, unrecognized: undefined };
  if (RP_ON_VALUES.has(v)) return { enabled: true, unrecognized: undefined };
  return { enabled: true, unrecognized: raw.trim() };
}

// ---------------------------------------------------------------------------
// `rpSkip`: six independently switchable RP components, layered on top of
// `rp`. See `runSprFold`'s doc comment for exactly which tick operations each
// name gates.
// ---------------------------------------------------------------------------

/** Canonical order: `resume` is the dependency root — every other name is one of its dependents. */
const RP_ARM_COMPONENT_NAMES = ["resume", "foldedPmf", "upcomingPmf", "formula", "observe", "beliefs"] as const;
type RpArmComponentName = (typeof RP_ARM_COMPONENT_NAMES)[number];

interface RpArmRan {
  readonly resume: boolean;
  readonly foldedPmf: boolean;
  readonly upcomingPmf: boolean;
  readonly formula: boolean;
  readonly observe: boolean;
  readonly beliefs: boolean;
}

interface RpArmResolution {
  readonly id: string;
  readonly ran: RpArmRan;
  readonly warnings: readonly string[];
}

const RP_ARM_ALL: RpArmRan = { resume: true, foldedPmf: true, upcomingPmf: true, formula: true, observe: true, beliefs: true };
const RP_ARM_NONE: RpArmRan = { resume: false, foldedPmf: false, upcomingPmf: false, formula: false, observe: false, beliefs: false };

/** Splits `raw` on commas, trims, drops empties, and matches case-insensitively against the six component names. Unknown tokens are reported, never guessed at. */
function parseRpSkipTokens(raw: string | null): { skipped: Set<RpArmComponentName>; unknown: string[] } {
  if (raw === null || raw.trim() === "") return { skipped: new Set(), unknown: [] };
  const byLower = new Map<string, RpArmComponentName>(RP_ARM_COMPONENT_NAMES.map((name) => [name.toLowerCase(), name]));
  const skipped = new Set<RpArmComponentName>();
  const unknown: string[] = [];
  for (const token of raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0)) {
    const canonical = byLower.get(token.toLowerCase());
    if (canonical === undefined) unknown.push(token);
    else skipped.add(canonical);
  }
  return { skipped, unknown };
}

/** `ran` from a validated (all-known-tokens) skip set. Without `resume`, every other component is off — there is nothing left for them to feed. */
function deriveRpArmRan(skipped: ReadonlySet<RpArmComponentName>): RpArmRan {
  if (skipped.has("resume")) return RP_ARM_NONE;
  const foldedPmf = !skipped.has("foldedPmf");
  const upcomingPmf = !skipped.has("upcomingPmf");
  return {
    resume: true,
    foldedPmf,
    upcomingPmf,
    // Moot once neither pmf loop calls rpFieldsFor at all — nothing for `formula` to gate.
    formula: (foldedPmf || upcomingPmf) && !skipped.has("formula"),
    observe: !skipped.has("observe"),
    beliefs: !skipped.has("beliefs"),
  };
}

/** The arm id: "all", "none", or "skip:a,b,c" in canonical order. `formula` is dropped from the listing once both pmf loops are already skipped, since requesting it changes nothing further. */
function buildRpArmId(skipped: ReadonlySet<RpArmComponentName>, ran: RpArmRan): string {
  if (!ran.resume) return "none";
  const bothPmfSkipped = skipped.has("foldedPmf") && skipped.has("upcomingPmf");
  const displayed = RP_ARM_COMPONENT_NAMES.filter((name) => skipped.has(name) && !(name === "formula" && bothPmfSkipped));
  return displayed.length === 0 ? "all" : `skip:${displayed.join(",")}`;
}

/**
 * Pure resolver for both ablation params: `rp` (whole-path on/off, existing)
 * layered under `rpSkip` (six independently switchable components, new).
 * `rp=0` always wins — every component is off regardless of `rpSkip`, and the
 * existing `rp=0` warning (built by `buildWarnings`) is untouched; this
 * function only adds a second warning when `rpSkip` was also supplied, so the
 * caller knows it had no effect.
 */
export function resolveRpArm(rpRaw: string | null, rpSkipRaw: string | null): RpArmResolution {
  const rp = parseRpParam(rpRaw);
  const rpSkipRawTrimmed = rpSkipRaw?.trim() ?? "";
  const rpSkipSupplied = rpSkipRawTrimmed !== "";

  if (!rp.enabled) {
    return {
      id: "none",
      ran: RP_ARM_NONE,
      warnings: rpSkipSupplied
        ? [`rpSkip="${rpSkipRawTrimmed}" was ignored because rp=0 already turns every RP component off`]
        : [],
    };
  }

  const { skipped, unknown } = parseRpSkipTokens(rpSkipRaw);

  if (unknown.length > 0) {
    return {
      id: "all",
      ran: RP_ARM_ALL,
      warnings: [
        `rpSkip="${rpSkipRawTrimmed}" names unrecognized component(s) ${unknown.map((t) => `"${t}"`).join(", ")} — valid names are ${RP_ARM_COMPONENT_NAMES.join(", ")} — NO component was skipped`,
      ],
    };
  }

  const ran = deriveRpArmRan(skipped);
  const id = buildRpArmId(skipped, ran);

  if (id === "all") return { id, ran, warnings: [] };

  if (id === "none") {
    return {
      id,
      ran,
      warnings: [
        `rpSkip="${rpSkipRawTrimmed}" — ABLATED ARM "${id}": resume was skipped, so every dependent component (foldedPmf, upcomingPmf, formula, observe, beliefs) was forced off. Compare this cpuTime against an otherwise-identical rp=1 run`,
      ],
    };
  }

  const bothPmfSkipped = skipped.has("foldedPmf") && skipped.has("upcomingPmf");
  const skippedNames = RP_ARM_COMPONENT_NAMES.filter((name) => skipped.has(name) && !(name === "formula" && bothPmfSkipped));
  const ranNames = RP_ARM_COMPONENT_NAMES.filter((name) => ran[name]);
  return {
    id,
    ran,
    warnings: [
      `rpSkip="${rpSkipRawTrimmed}" — PARTIALLY ABLATED ARM "${id}": skipped ${skippedNames.join(",")}; ran ${ranNames.join(",")}. Compare this cpuTime against an otherwise-identical rp=1 run`,
    ],
  };
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
  /** The raw `rp=` on/off flag, kept separate from `rpArm` for the existing `rp=0` warning, which must fire only for THIS flag, never for an `rpSkip=resume` arm that reaches the same "none" id by a different route. */
  readonly rpEnabled: boolean;
  /** An `rp=` value that was neither on nor off, surfaced as a warning. */
  readonly rpUnrecognized: string | undefined;
  /** The resolved ablation arm: `rp` layered under `rpSkip`'s six components (see `resolveRpArm`). */
  readonly rpArm: RpArmResolution;
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
  const rpRaw = search.get("rp");
  const rp = parseRpParam(rpRaw);
  const rpArm = resolveRpArm(rpRaw, search.get("rpSkip"));
  return { season, eventType, eventOverride, teamsOverride, teamCount, folded, upcoming, rpEnabled: rp.enabled, rpUnrecognized: rp.unrecognized, rpArm };
}

// Discovery reads scope keys only, never state_json. It is overhead a real
// tick never pays, so it is counted separately in `discovery`.

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

// probeSelectionsFor duplicates `scheduled.ts`'s `selectionsFor` (see the
// header); `stateProbe.test.ts` asserts deep-equal output.

/** Mirrors `scheduled.ts`'s `EVENT_SCOPED_ALGORITHM_IDS`. */
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
// Synthetic match fixtures, 2026-shaped. Another `season` folds no observed
// thresholds and must warn (see `buildResponse`).
// ---------------------------------------------------------------------------

const SYNTHETIC_RED_SCORE = 120;
const SYNTHETIC_BLUE_SCORE = 95;
const SYNTHETIC_RED_HUB = 140;
const SYNTHETIC_RED_TOWER = 50;
const SYNTHETIC_BLUE_HUB = 110;
const SYNTHETIC_BLUE_TOWER = 38;

/** The 2026 score-breakdown shape `rp2026.parse` reads (same shape as `scheduled.rp.test.ts`'s `breakdownOf`). */
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
 * Rosters cycled 6 at a time from `teamKeys`, so every team carries beliefs.
 * Wraps when fewer than 6 (already warned); a team on both alliances is still
 * a valid, if unrealistic, input.
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
    // Stated explicitly, not omitted — an omitted DQ list reads as harmless
    // and is not.
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
  /** Residuals the mean shift booked in the played loop, summed over every variable. */
  readonly rpMeanShiftObservations: number;
  /** Alliances whose moments the mean shift actually moved, in both loops. 0 before the warmup or with a cold roster. */
  readonly rpMeanShiftedAlliances: number;
  /** The `resume` component: the resumed belief map's size, or 0 when `resume` did not run. */
  readonly rpBeliefTeamsResumed: number;
  /** Incremented inside `rpFieldsFor` once every gate has passed, before `momentsFor` — independent of `formula`. */
  readonly rpGatesOpened: number;
  /** The `beliefs` component: the size of the map passed to `withRpBeliefs`, or 0 when `beliefs` did not run. */
  readonly rpBeliefTeamsAttached: number;
  /** The `beliefs` component: whether `withRpMeanShift` ran. */
  readonly rpMeanShiftAttached: boolean;
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
    /** The whole-path ablation arm, echoed so a `cpuTime` from `wrangler tail` is never attributed to the wrong arm. Always equal to `rpArm.ran.resume`. */
    readonly rp: boolean;
    /** The resolved component arm: `id` ("all" | "none" | "skip:a,b,c") plus which of the six components actually ran. Read this before trusting a `cpuTime` — a typo in `rpSkip` skips nothing. */
    readonly rpArm: { readonly id: string; readonly ran: RpArmRan };
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

/** A literal, never a clock read. The serializers require a stamp; the probe's rows are discarded, so its value is inert. */
const PROBE_STAMP: StateStamp = { generation: "probe", computedAt: "1970-01-01T00:00:00.000Z" };

async function readAndDeserializeAll(
  db: D1Database,
  eventKey: string,
  teamKeys: readonly string[]
): Promise<{ algorithms: AlgorithmProbeResult[]; sprRows: StateRow[] | undefined; sprState: SprState | undefined }> {
  const algorithms: AlgorithmProbeResult[] = [];
  let sprRows: StateRow[] | undefined;
  let sprState: SprState | undefined;

  for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
    const rowsRead = { league: 0, team: 0, event: 0 };
    let leagueRowPresent = false;
    try {
      const selections = probeSelectionsFor(algorithmId, eventKey, teamKeys);
      const rows = await readScopedState(db, algorithmId, selections);
      for (const row of rows) rowsRead[row.scopeKind]++;
      const leagueRow = rows.find((row) => row.scopeKind === "league");
      leagueRowPresent = leagueRow !== undefined;

      if (leagueRow === undefined) {
        // NEVER cold-start via initState here: that would measure a fiction.
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
        // If this parse fails, deserializeState below fails identically and
        // surfaces the real error.
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
 * The fold, `spr` only (matching `wrangler.toml`'s `LIVE_ALGORITHM_IDS`), in
 * a live tick's order: resume Sigma/RP accumulators, derive the touched
 * roster, price `folded` played matches (predict, band, RP fields, update,
 * fold, talent), price `upcoming` matches read-only (predict, band, RP
 * fields), read the touched metrics/Sigma, then serialize and discard.
 *
 * `ran` — the resolved `rpSkip` component set (see `resolveRpArm`) — gates the
 * ranking-point operations independently:
 *     1. `resume`: the accumulator resume (the `publishesRankingPoints` gate,
 *        `RP_RULE_MODULES[season]`, `readRpBeliefs`, `RpMomentsAccumulator.fromBeliefs`,
 *        `rpKnownTeams`, `readRpMeanShift`, `RpMeanShiftAccumulator.fromState`) —
 *        unlike `scheduled.ts`, which builds `readRpBeliefs`/`rpKnownTeams`
 *        unconditionally, both stay inside this gate here: removing RP removes
 *        the accumulator they exist to seed, so there is nothing left for them
 *        to feed. Without `resume`, every other component is off (`resolveRpArm`'s
 *        dependency rule)
 *     2. `foldedPmf`/`upcomingPmf`: whether `rpFieldsFor` is called at all, per loop
 *     3. `formula`: inside `rpFieldsFor`, everything from `analyticRpPmf` onward
 *        (the gates, `momentsFor` x2, `rosterIsFullyWarm` x2 and the mean shift
 *        `apply` x2 still run either way; `rpGatesOpened` counts the gate pass,
 *        independent of `formula`)
 *     4. `observe`: `rpMeanShift.observeMatch` then `foldObservedRp`
 *     5. `beliefs`: `withRpBeliefs` and `withRpMeanShift`
 * Every arm keeps the upcoming loop, every `displayBandFor` call (`bandsProduced`
 * must match across arms, asserted by `stateProbe.test.ts`), predict/update, the
 * Sigma fold, the talent read, the touched metrics/Sigma read and
 * `serializeState` with the Sigma passengers.
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
  ran: RpArmRan
): FoldResult {
  if (teamKeys.length === 0) {
    return {
      algorithmId: "spr",
      matchesFolded: 0,
      upcomingPriced: 0,
      bandsProduced: 0,
      rpPmfsProduced: 0,
      rpObservedFolds: 0,
      rpMeanShiftObservations: 0,
      rpMeanShiftedAlliances: 0,
      rpBeliefTeamsResumed: 0,
      rpGatesOpened: 0,
      rpBeliefTeamsAttached: 0,
      rpMeanShiftAttached: false,
      changedRowsDiscarded: 0,
      error: { name: "EmptyRoster", message: "no teams available (discovery found none and no teams= override was supplied) — cannot build synthetic matches" },
    };
  }

  try {
    // Resumed from the rows just read, as a real tick resumes.
    const sigma = usesSigmaScore("spr") ? SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs(sprRows), readSigmaPopulation(sprRows)) : undefined;
    // One alliance's win-odds variance, mirroring scheduled.ts's accessor name; `rpFieldsFor` reads it, `displayBandFor` derives the published band from it.
    const winOddsVarianceFor = (roster: readonly string[]): number | undefined => (sigma === undefined ? undefined : sigma.bandVarianceFor(roster));
    // The published Match Band, through the same helper the offline SigmaScoutLayer uses. OPR/EPA publish none (sigma undefined).
    const displayBandFor = (
      view: { redTeams: readonly string[]; blueTeams: readonly string[] },
      redWinOddsVariance: number | undefined,
      blueWinOddsVariance: number | undefined
    ): { red?: number; blue?: number } => {
      if (sigma === undefined) return {};
      const red = sigmaMatchBandVariance(view.redTeams.length, redWinOddsVariance);
      const blue = sigmaMatchBandVariance(view.blueTeams.length, blueWinOddsVariance);
      return { ...(red !== undefined ? { red } : {}), ...(blue !== undefined ? { blue } : {}) };
    };

    // Indexed lookup, never `rpRuleModuleForSeason` (which throws): an
    // unregistered season, or an algorithm that publishes no RP, yields no
    // accumulator and a warning. Gating here (component `resume`) disables
    // every other component, all of which guard on `rp`/`rpMeanShift`.
    const rpRuleModule = ran.resume && publishesRankingPoints("spr") ? RP_RULE_MODULES[season] : undefined;
    const rpBeliefs = ran.resume ? readRpBeliefs(sprRows) : undefined;
    const rp = rpRuleModule !== undefined && rpBeliefs !== undefined ? RpMomentsAccumulator.fromBeliefs(rpRuleModule, rpBeliefs) : undefined;
    // Mirrors `scheduled.ts`'s resume, gated with the accumulator so ablating `resume` ablates it too.
    const rpMeanShift = rp !== undefined && rpRuleModule !== undefined ? RpMeanShiftAccumulator.fromState(rpRuleModule, readRpMeanShift(sprRows)) : undefined;
    const rpKnownTeams = new Set(rpBeliefs?.keys() ?? []);
    // The `resume` component's own counter: independent of every downstream skip.
    const rpBeliefTeamsResumed = rpBeliefs?.size ?? 0;

    let bandsProduced = 0;
    let rpPmfsProduced = 0;
    let rpObservedFolds = 0;
    let rpMeanShiftedAlliances = 0;
    let rpGatesOpened = 0;
    const shiftObservationTotal = (): number =>
      rpMeanShift === undefined ? 0 : Object.values(rpMeanShift.toState().variables).reduce((total, v) => total + v.count, 0);
    const shiftObservationsAtResume = shiftObservationTotal();

    const rpFieldsFor = (
      view: { redTeams: readonly string[]; blueTeams: readonly string[]; eventType: number; matchKey: string; compLevel: MatchResult["compLevel"] },
      prediction: Prediction,
      redBandVariance: number | undefined,
      blueBandVariance: number | undefined
    ): Partial<Prediction> => {
      if (rp === undefined || rpRuleModule === undefined || rpMeanShift === undefined) return {};
      if (!isRpEligibleEventType(view.eventType)) return {};
      if (redBandVariance === undefined || blueBandVariance === undefined) return {};
      // The partial-roster gate, mirroring `scheduled.ts`: part of what the
      // probe measures, not overhead to strip.
      for (const teamKey of [...view.redTeams, ...view.blueTeams]) {
        if (!rpKnownTeams.has(teamKey)) return {};
      }
      // Every gate passed: counted here, before `momentsFor`, independent of `formula`.
      rpGatesOpened++;

      // The mean shift per alliance, fully-warm rosters only. `apply` returns
      // its input unchanged when it shifts nothing, which the counter reads.
      // Still runs when `formula` is ablated — only `analyticRpPmf` onward is skipped.
      const redMoments = rp.momentsFor(view.redTeams, prediction.redScore, redBandVariance);
      const blueMoments = rp.momentsFor(view.blueTeams, prediction.blueScore, blueBandVariance);
      const red = rpMeanShift.apply(redMoments, rosterIsFullyWarm(rp, view.redTeams));
      const blue = rpMeanShift.apply(blueMoments, rosterIsFullyWarm(rp, view.blueTeams));
      if (red !== redMoments) rpMeanShiftedAlliances++;
      if (blue !== blueMoments) rpMeanShiftedAlliances++;

      if (!ran.formula) return {};

      const pmf = analyticRpPmf({
        red,
        blue,
        ruleModule: rpRuleModule,
        eventType: view.eventType,
        compLevel: view.compLevel,
        pRedWin: prediction.pRedWin,
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

    /** Mirrors `scheduled.ts`'s `foldObservedRp`, including its skip-on-parse-failure try/catch. */
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

    // Built up front, mirroring `scheduled.ts`'s own `touchedTeams` derivation
    // ahead of its Phase A loop: the sorted unique teams the folded synthetic
    // matches touch. `realTouchedTeams` strips demo keys, like the tick's copy.
    const foldedMatches: MatchResult[] = [];
    for (let i = 0; i < folded; i++) {
      const roster = rosterAt(teamKeys, i);
      foldedMatches.push(buildPlayedMatch(eventKey, eventType, i + 1, roster.red, roster.blue));
    }
    const touchedTeams = [...new Set(foldedMatches.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort();
    const realTouchedTeams = touchedTeams.filter((teamKey) => !isDemoTeamKey(teamKey));

    let state = sprState;
    let matchesFolded = 0;
    // Mirrors `scheduled.ts`'s `newBands`/`newPredictions`; discarded like everything else here, but built the same shape so this loop's real cost is priced.
    const newBands = new Map<string, { red?: number; blue?: number }>();
    const newPredictions = new Map<string, Prediction>();
    for (const result of foldedMatches) {
      const prediction = spr.predict(state, toLeakProofUpcoming(result));
      const redWinOddsVariance = winOddsVarianceFor(result.redTeams);
      const blueWinOddsVariance = winOddsVarianceFor(result.blueTeams);
      if (redWinOddsVariance !== undefined) bandsProduced++;
      if (blueWinOddsVariance !== undefined) bandsProduced++;
      newBands.set(result.matchKey, displayBandFor(result, redWinOddsVariance, blueWinOddsVariance));
      // Component `foldedPmf`: when off, `rpFieldsFor` is never called for this loop — only its own work disappears.
      const fields = ran.foldedPmf ? rpFieldsFor(result, prediction, redWinOddsVariance, blueWinOddsVariance) : {};
      newPredictions.set(result.matchKey, { ...prediction, ...fields });
      // One increment per match: `rpFieldsFor`'s gates are all-or-nothing
      // per match. `stateProbe.test.ts` pins this to `folded + upcoming`.
      if (fields.redRpPmf !== undefined) rpPmfsProduced++;

      state = spr.update(state, result);
      sigma?.foldMatch(result, prediction);
      // Component `observe`: both the mean-shift residual booking and the
      // threshold fold below are skipped together, mirroring `scheduled.ts`'s
      // order (after the RP fields, before the threshold fold).
      if (ran.observe && rp !== undefined) rpMeanShift?.observeMatch(rp, result);
      if (ran.observe) foldObservedRp(result);
      // Talent after the fold, from the post-update state, as `scheduled.ts` orders it.
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
    const upcomingBands = new Map<string, { red?: number; blue?: number }>();
    const upcomingPredictions = new Map<string, Prediction>();
    for (let i = 0; i < upcoming; i++) {
      const roster = rosterAt(teamKeys, folded + i);
      const match = buildUpcomingMatch(eventKey, eventType, folded + i + 1, roster.red, roster.blue);
      const prediction = spr.predict(state, match);
      const redWinOddsVariance = winOddsVarianceFor(match.redTeams);
      const blueWinOddsVariance = winOddsVarianceFor(match.blueTeams);
      if (redWinOddsVariance !== undefined) bandsProduced++;
      if (blueWinOddsVariance !== undefined) bandsProduced++;
      upcomingBands.set(match.matchKey, displayBandFor(match, redWinOddsVariance, blueWinOddsVariance));
      // Component `upcomingPmf`: same rule as `foldedPmf`, for this loop.
      const fields = ran.upcomingPmf ? rpFieldsFor(match, prediction, redWinOddsVariance, blueWinOddsVariance) : {};
      upcomingPredictions.set(match.matchKey, { ...prediction, ...fields });
      // Same one-per-match counting rule as the played loop above.
      if (fields.redRpPmf !== undefined) rpPmfsProduced++;
      upcomingPriced++;
    }
    // Both Maps mirror `scheduled.ts`'s Phase A output shape; the probe writes
    // no artifact, so neither is read again.
    void newBands;
    void newPredictions;
    void upcomingBands;
    void upcomingPredictions;

    // Read-only, zero subrequests, same instant as `scheduled.ts`'s copy;
    // discarded like everything else here, since the probe writes nothing.
    const touchedMetrics = spr.teamMetrics(state, touchedTeams);
    void touchedMetrics;
    const touchedSigma = new Map<string, number>();
    if (sigma !== undefined) {
      for (const teamKey of realTouchedTeams) touchedSigma.set(teamKey, sigma.sigmaFor(teamKey));
    }
    void touchedSigma;

    // Serialize and discard: building the write payload is real tick CPU, but
    // the rows are never written.
    let candidateRows = serializeState("spr", spr.version, state, PROBE_STAMP);
    // Component `beliefs`: the write-back passengers only. `resume` (the read
    // side) is a separate component and stays gated above.
    let rpBeliefTeamsAttached = 0;
    if (ran.beliefs && rp !== undefined) {
      const beliefsByTeam = rp.beliefsByTeam();
      candidateRows = withRpBeliefs(candidateRows, beliefsByTeam);
      rpBeliefTeamsAttached = beliefsByTeam.size;
    }
    let rpMeanShiftAttached = false;
    if (ran.beliefs && rpMeanShift !== undefined) {
      candidateRows = withRpMeanShift(candidateRows, rpMeanShift.toState());
      rpMeanShiftAttached = true;
    }
    if (sigma !== undefined) {
      candidateRows = withSigmaPopulation(withSigmaBeliefs(candidateRows, sigma.beliefsByTeam()), sigma.population());
    }
    // `selectChangedRows` is a pure comparison with no write helper in its graph.
    const changedRowsDiscarded = selectChangedRows(sprRows, candidateRows).length;

    const rpMeanShiftObservations = shiftObservationTotal() - shiftObservationsAtResume;
    return {
      algorithmId: "spr",
      matchesFolded,
      upcomingPriced,
      bandsProduced,
      rpPmfsProduced,
      rpObservedFolds,
      rpMeanShiftObservations,
      rpMeanShiftedAlliances,
      rpBeliefTeamsResumed,
      rpGatesOpened,
      rpBeliefTeamsAttached,
      rpMeanShiftAttached,
      changedRowsDiscarded,
    };
  } catch (err) {
    return {
      algorithmId: "spr",
      matchesFolded: 0,
      upcomingPriced: 0,
      bandsProduced: 0,
      rpPmfsProduced: 0,
      rpObservedFolds: 0,
      rpMeanShiftObservations: 0,
      rpMeanShiftedAlliances: 0,
      rpBeliefTeamsResumed: 0,
      rpGatesOpened: 0,
      rpBeliefTeamsAttached: 0,
      rpMeanShiftAttached: false,
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
  /** The raw `rp=` flag — NOT `rpArm.ran.resume` — so this fires only for the literal `rp=0` case, never for an `rpSkip=resume` arm, which carries its own warning from `resolveRpArm`. */
  rpEnabled: boolean;
  rpUnrecognized: string | undefined;
  /** The resolved arm id. The generic "every RP pmf was suppressed" warning below is scoped to "all": a partial or fully-ablated `rpSkip` arm already explains its own zero via `resolveRpArm`'s warning, and stacking both would break the "exactly one warning" contract Group 8 pins. */
  armId: string;
}): string[] {
  const warnings: string[] = [];
  const { season, folded, upcoming, eventOverrideSupplied, discoveredEventKey, resolvedEventKey, requestedTeamCount, resolvedTeamCount, fold, rpEnabled, rpUnrecognized, armId } = params;

  if (rpUnrecognized !== undefined) {
    warnings.push(
      `rp="${rpUnrecognized}" is not a recognized value (on: 1/on/true/yes; off: 0/off/false/no) — the RP path ran ENABLED; re-run with rp=0 if the ablated arm was intended`
    );
  }
  if (!rpEnabled) {
    warnings.push(
      `rp=0 — ABLATED ARM: the ranking-point additions (the RpMomentsAccumulator resume, rpFieldsFor, foldObservedRp, and the withRpBeliefs passenger) and shape 16's mean shift (resume, apply, observeMatch, withRpMeanShift) were all skipped. Bands, both predict loops and the Sigma fold still ran, because they are not part of the ranking-point path. Compare this cpuTime against an otherwise-identical rp=1 run; it is not a measurement of the tick as deployed`
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
  // In an ablated arm a 0 here is the requested outcome, already explained by
  // that arm's own warning — so this generic one is scoped to "all".
  if (armId === "all" && fold.error === undefined && folded + upcoming > 0 && fold.rpPmfsProduced === 0) {
    warnings.push(`rpPmfsProduced is 0 — every RP pmf was suppressed (the partial-roster gate, an ineligible event type, or no registered rule module); the reported cpuTime is NOT evidence about the RP path`);
  }
  if (fold.error === undefined && folded + upcoming > 0 && fold.bandsProduced === 0) {
    warnings.push(`bandsProduced is 0 — no Sigma band was produced for any roster; the band-dependent RP gate above never opened, so the reported cpuTime under-prices a real tick`);
  }

  return warnings;
}

async function runProbe(request: Request, env: ProbeEnv): Promise<{ body: ProbeResponseBody; ok: boolean }> {
  const url = new URL(request.url);
  const params = parseParams(url);

  // Discovery always runs, even with overrides, so `discovery` reports what D1 holds.
  const discoveredTeamKeys = await discoverRoster(env.DB, params.teamCount);
  const discoveredEventKey = await discoverEventKey(env.DB);

  const eventKey = params.eventOverride ?? discoveredEventKey ?? `${params.season}probe`;
  const teamKeys = (params.teamsOverride ?? discoveredTeamKeys).slice(0, params.teamCount);

  const { algorithms, sprRows, sprState } = await readAndDeserializeAll(env.DB, eventKey, teamKeys);

  const fold: FoldResult =
    sprRows !== undefined && sprState !== undefined
      ? runSprFold(sprRows, sprState, eventKey, params.eventType, params.season, teamKeys, params.folded, params.upcoming, params.rpArm.ran)
      : {
          algorithmId: "spr",
          matchesFolded: 0,
          upcomingPriced: 0,
          bandsProduced: 0,
          rpPmfsProduced: 0,
          rpObservedFolds: 0,
          rpMeanShiftObservations: 0,
          rpMeanShiftedAlliances: 0,
          rpBeliefTeamsResumed: 0,
          rpGatesOpened: 0,
          rpBeliefTeamsAttached: 0,
          rpMeanShiftAttached: false,
          changedRowsDiscarded: 0,
          error: { name: "SprNotDeserialized", message: "spr state was not available — see algorithms[] for the read/deserialize failure; the fold was skipped rather than measuring a fiction" },
        };

  const warnings = [
    ...buildWarnings({
      season: params.season,
      folded: params.folded,
      upcoming: params.upcoming,
      eventOverrideSupplied: params.eventOverride !== undefined,
      discoveredEventKey,
      resolvedEventKey: eventKey,
      requestedTeamCount: params.teamCount,
      resolvedTeamCount: teamKeys.length,
      fold,
      rpEnabled: params.rpEnabled,
      rpUnrecognized: params.rpUnrecognized,
      armId: params.rpArm.id,
    }),
    // rpSkip's own warnings (unknown token, partial/full ablation, or the
    // rp=0-override notice) — kept separate so the rp=0 warning above always
    // sorts first when both fire (the rp=0&rpSkip=... override case).
    ...params.rpArm.warnings,
  ];

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
      rp: params.rpArm.ran.resume,
      rpArm: { id: params.rpArm.id, ran: params.rpArm.ran },
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
