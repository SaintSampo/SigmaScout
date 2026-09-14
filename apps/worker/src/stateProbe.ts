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
 * as a difference between two runs. `rp` absent is ON.
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
import { SigmaScoreAccumulator, usesSigmaScore } from "../../../packages/harness/sigmaScore.js";
import { RpMomentsAccumulator } from "../../../packages/core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm } from "../../../packages/core/rankingPoints/meanShift.js";
import { analyticRpPmf } from "../../../packages/core/rankingPoints/analyticPmf.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { isRpEligibleEventType } from "../../../packages/core/rankingPoints/constants.js";
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
  /** Ablation arm: false skips every Phase A ranking-point operation (see `runSprFold`). */
  readonly rp: boolean;
  /** An `rp=` value that was neither on nor off, surfaced as a warning. */
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
    /** The ablation arm, echoed so a `cpuTime` from `wrangler tail` is never attributed to the wrong arm. */
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
 * a live tick's order: resume Sigma/RP accumulators, price `folded` played
 * matches (predict, band, RP fields, update, fold), price `upcoming` matches
 * read-only, then serialize and discard.
 *
 * `rpEnabled` false skips exactly the ranking-point operations:
 *     1. the accumulator resume (`RP_RULE_MODULES[season]`, `readRpBeliefs`,
 *        `RpMomentsAccumulator.fromBeliefs`, `rpKnownTeams`, `readRpMeanShift`,
 *        `RpMeanShiftAccumulator.fromState`)
 *     2. `rpFieldsFor` (mean shift `apply`, `analyticRpPmf` and its gates) in both loops
 *     3. `observeMatch` then `foldObservedRp`
 *     4. `withRpBeliefs` and `withRpMeanShift`
 * Both arms keep the upcoming loop, every `bandFor` call (`bandsProduced` must
 * match across arms, asserted by `stateProbe.test.ts`), predict/update, the
 * Sigma fold, the talent read and `serializeState` with the Sigma passengers.
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
      rpMeanShiftObservations: 0,
      rpMeanShiftedAlliances: 0,
      changedRowsDiscarded: 0,
      error: { name: "EmptyRoster", message: "no teams available (discovery found none and no teams= override was supplied) — cannot build synthetic matches" },
    };
  }

  try {
    // Resumed from the rows just read, as a real tick resumes.
    const sigma = usesSigmaScore("spr") ? SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs(sprRows), readSigmaPopulation(sprRows)) : undefined;
    const bandFor = (roster: readonly string[]): number | undefined => (sigma === undefined ? undefined : sigma.bandVarianceFor(roster));

    // Indexed lookup, never `rpRuleModuleForSeason` (which throws): an
    // unregistered season yields no accumulator and a warning. Gating here
    // (ablation operation 1) disables operations 2-4, which all guard on `rp`.
    const rpRuleModule = rpEnabled ? RP_RULE_MODULES[season] : undefined;
    const rpBeliefs = rpEnabled ? readRpBeliefs(sprRows) : undefined;
    const rp = rpRuleModule !== undefined && rpBeliefs !== undefined ? RpMomentsAccumulator.fromBeliefs(rpRuleModule, rpBeliefs) : undefined;
    // Mirrors `scheduled.ts`'s resume, gated with the accumulator so `rp=0` ablates it.
    const rpMeanShift = rp !== undefined && rpRuleModule !== undefined ? RpMeanShiftAccumulator.fromState(rpRuleModule, readRpMeanShift(sprRows)) : undefined;
    const rpKnownTeams = new Set(rpBeliefs?.keys() ?? []);

    let bandsProduced = 0;
    let rpPmfsProduced = 0;
    let rpObservedFolds = 0;
    let rpMeanShiftedAlliances = 0;
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

      // The mean shift per alliance, fully-warm rosters only. `apply` returns
      // its input unchanged when it shifts nothing, which the counter reads.
      const redMoments = rp.momentsFor(view.redTeams, prediction.redScore, redBandVariance);
      const blueMoments = rp.momentsFor(view.blueTeams, prediction.blueScore, blueBandVariance);
      const red = rpMeanShift.apply(redMoments, rosterIsFullyWarm(rp, view.redTeams));
      const blue = rpMeanShift.apply(blueMoments, rosterIsFullyWarm(rp, view.blueTeams));
      if (red !== redMoments) rpMeanShiftedAlliances++;
      if (blue !== blueMoments) rpMeanShiftedAlliances++;
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
      // One increment per match: `rpFieldsFor`'s gates are all-or-nothing
      // per match. `stateProbe.test.ts` pins this to `folded + upcoming`.
      if (fields.redRpPmf !== undefined) rpPmfsProduced++;

      state = spr.update(state, result);
      sigma?.foldMatch(result, prediction);
      // Mirrors `scheduled.ts`: after the RP fields, before the threshold fold.
      if (rp !== undefined) rpMeanShift?.observeMatch(rp, result);
      foldObservedRp(result);
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

    // Serialize and discard: building the write payload is real tick CPU, but
    // the rows are never written.
    let candidateRows = serializeState("spr", spr.version, state, PROBE_STAMP);
    if (rp !== undefined) candidateRows = withRpBeliefs(candidateRows, rp.beliefsByTeam());
    if (rpMeanShift !== undefined) candidateRows = withRpMeanShift(candidateRows, rpMeanShift.toState());
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
  // In the ablated arm a 0 here is the requested outcome.
  if (rpEnabled && fold.error === undefined && folded + upcoming > 0 && fold.rpPmfsProduced === 0) {
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
      ? runSprFold(sprRows, sprState, eventKey, params.eventType, params.season, teamKeys, params.folded, params.upcoming, params.rp)
      : {
          algorithmId: "spr",
          matchesFolded: 0,
          upcomingPriced: 0,
          bandsProduced: 0,
          rpPmfsProduced: 0,
          rpObservedFolds: 0,
          rpMeanShiftObservations: 0,
          rpMeanShiftedAlliances: 0,
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
