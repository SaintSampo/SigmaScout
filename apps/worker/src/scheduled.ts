/**
 * The cron tick: read what is live, ask TBA what changed, advance the shared
 * prediction state, and rewrite only the artifacts that moved. `runTick`
 * holds all the logic, testable without a `ScheduledController`.
 *
 * ORDER: update, then state write, then artifact write, never the reverse.
 * `processEvent` runs Phase A (fold and write every live algorithm's state)
 * and only after every Phase A write succeeds, Phase B (artifacts). A
 * rejected Phase A write aborts the whole event without advancing the
 * cursor: `event_cursor` has no per-algorithm granularity, so a partial
 * advance would desync the un-advanced algorithms forever.
 *
 * BUDGET: each event's subrequest cost is estimated up front, right after
 * polling. If it exceeds what remains the whole event defers with no state
 * touched, rather than advancing state and then finding Phase B
 * unaffordable (stale artifacts with no future trigger). Events run
 * sequentially, so a cleared estimate holds.
 *
 * TICK META: the rotation offset and last global rebuild time live in
 * `event_cursor` under the sentinel key `TICK_META_EVENT_KEY`, with a JSON
 * blob in `lastFoldedMatchKey`.
 *
 * GLOBAL REBUILD: serializing the year-wide `teams`/`events` tables costs
 * close to the whole CPU budget, so it runs on a fixed interval or when an
 * event completes its last scheduled match. With no corpus access it is an
 * incremental merge of teams touched since the last rebuild, never a
 * from-scratch recompute (that is `pnpm publish:seasons`). Known stub: a
 * `teams/{year}` row's `record` is not updated here, and `events/{year}` is
 * not touched; both stay as of the last offline publish.
 *
 * TIERS: a touched row keeps the prior row's published `tier` per metric and
 * its published Sigma entry, so the Teams list never shows a false Common
 * mid-event. Re-ranking every row was measured too costly for the CPU budget.
 *
 * OFFICIAL-PLAY SCOPE: summary quantities cover official play only
 * (`isOfficialEventType`), matching `publish.ts`, at two gates: the
 * `teams/{year}` leaderboard feed and `seasonStats.record`
 * (`incrementRecord`). An offseason event still folds into per-event and
 * per-team artifacts. The `-1` "detail fetch failed" event type counts as
 * official, so a failed fetch keeps the leaderboard updating.
 *
 * UPCOMING MATCHES ARE NOT PRICED HERE (260915-isq). The tick writes each
 * still-upcoming match as a schedule-only row (keys, rosters, and the
 * published `sortTime` when the existing row had one). The browser prices
 * those rows from the SPR event artifact's `state` block, which the publisher
 * builds from the same rows it seeds D1 with. Each tick splices the D1 rows
 * Phase A just wrote into that block (`spliceEventStateBlock`), so the block
 * tracks D1 for the event's teams without a D1 read. The Worker never
 * bootstraps a block: an artifact without one (or with one the splice
 * rejects) is written without one, with a structured warn line. The block is
 * dropped once the event has no upcoming match left.
 *
 * DEMO TEAMS: the algorithms already exclude demo teams in
 * `update()`/`predict()`. `realTouchedTeams` strips demo keys before Phase A
 * scope keys and Phase B team artifacts, so a demo key gets no D1 row and no
 * team page. `mergeEventArtifact` still gets the unfiltered roster, matching
 * `publish.ts`'s `eventTeamKeys`.
 */
import { opr } from "../../../packages/core/algorithms/opr.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { isOfficialEventType } from "../../../packages/core/algorithms/eventTypes.js";
import type { AlgorithmModule, MatchResult, Prediction, TeamMetric } from "../../../packages/core/algorithms/types.js";
import { tbaMatchListSchema } from "../../../packages/ingest/schemas.js";
import { tbaEventSchema } from "../../../packages/ingest/schemas.js";
import { normalizeMatch, type CorpusMatch } from "../../../packages/ingest/normalize.js";
import { fetchEventDetail } from "../../../packages/ingest/tbaClient.js";
import { isDemoTeamKey } from "../../../packages/core/algorithms/demoTeams.js";
import { isBonusRpCompLevel, isRpEligibleEventType } from "../../../packages/core/rankingPoints/constants.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { RpMomentsAccumulator } from "../../../packages/core/rankingPoints/empiricalMoments.js";
import { RpMeanShiftAccumulator, rosterIsFullyWarm } from "../../../packages/core/rankingPoints/meanShift.js";
import { analyticRpPmf } from "../../../packages/core/rankingPoints/analyticPmf.js";
import {
  deserializeState,
  readSigmaBeliefs,
  readSigmaPopulation,
  readRpBeliefs,
  readRpMeanShift,
  serializeState,
  withRpBeliefs,
  withRpMeanShift,
  withSigmaBeliefs,
  withSigmaPopulation,
  type StateRow,
} from "../../../packages/harness/stateSnapshot.js";
import { EventStateBlockError, spliceEventStateBlock } from "../../../packages/harness/eventStatePricing.js";
import {
  publishesRankingPoints,
  SIGMA_METRIC_KEY,
  SigmaScoreAccumulator,
  sigmaMatchBandVariance,
  usesSigmaScore,
} from "../../../packages/harness/sigmaScore.js";
import { TOTAL_METRIC_KEY } from "../../../packages/core/algorithms/types.js";
import {
  artifactKey,
  deriveMetricKeyOrder,
  encodeTeamsRowMetrics,
  LiveEventArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  TeamsArtifactSchema,
  TeamSeasonArtifactSchema,
  type LiveEventArtifact,
  type TeamSeasonArtifact,
  type TeamsArtifact,
} from "../../../packages/harness/pageArtifacts.js";
import { roundMetric, roundPmf, roundProbability, roundTo, ROUNDING_RULE } from "../../../packages/harness/rounding.js";
import { PUBLISHED_ALGORITHM_IDS, type AlgorithmsManifest, type LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import { loadAlgorithmsManifest, loadLiveEventsAt } from "./liveWindows.js";
import { readArtifactObject, writeArtifactObject } from "./artifactWriter.js";
import { hasAlreadyFolded, readEventCursor, readScopedState, selectChangedRows, writeEventCursor, writeScopedState, type EventCursor, type ScopeSelection } from "./stateStore.js";
import { rotate, sortEventKeys, SubrequestBudget } from "./subrequestBudget.js";
import { createTbaContext, pollEventMatches, TbaRequestCounter, type TbaClientContext } from "./tbaPoll.js";
import type { Env } from "./env.js";

// ---------------------------------------------------------------------------
// Tick meta (rotation offset, last global rebuild)
// ---------------------------------------------------------------------------

const TICK_META_EVENT_KEY = "__scheduler_meta__";

interface TickMeta {
  readonly rotationOffset: number;
  readonly lastGlobalRebuildAtMs: number;
}

const DEFAULT_TICK_META: TickMeta = { rotationOffset: 0, lastGlobalRebuildAtMs: 0 };

async function readTickMeta(db: D1Database): Promise<TickMeta> {
  const cursor = await readEventCursor(db, TICK_META_EVENT_KEY);
  if (!cursor || cursor.lastFoldedMatchKey === null) return DEFAULT_TICK_META;
  try {
    const parsed = JSON.parse(cursor.lastFoldedMatchKey) as Partial<TickMeta>;
    return {
      rotationOffset: typeof parsed.rotationOffset === "number" ? parsed.rotationOffset : 0,
      lastGlobalRebuildAtMs: typeof parsed.lastGlobalRebuildAtMs === "number" ? parsed.lastGlobalRebuildAtMs : 0,
    };
  } catch {
    return DEFAULT_TICK_META;
  }
}

async function writeTickMeta(db: D1Database, meta: TickMeta, nowIso: string): Promise<void> {
  await writeEventCursor(db, { eventKey: TICK_META_EVENT_KEY, tbaEtag: null, lastFoldedMatchKey: JSON.stringify(meta), lastPolledAt: null, lastAdvancedAt: nowIso });
}

// ---------------------------------------------------------------------------
// Algorithm module construction, once per tick
// ---------------------------------------------------------------------------

/**
 * Only SPR folds live. One 3v3 match's `estimatedCost` is 18 with spr alone
 * vs. 50 with all three algorithms, against ~41 subrequests available per
 * tick, so with all three live the event would defer forever. What is
 * published is unchanged; opr/epa refresh at the manual event-weekend
 * re-baseline. Exported so the fallback and `liveAlgorithmTier.test.ts`
 * share one default.
 */
export const DEFAULT_LIVE_ALGORITHM_IDS: readonly string[] = ["spr"];

/** An id in `LIVE_ALGORITHM_IDS` that is not one of `PUBLISHED_ALGORITHM_IDS` — unambiguously a typo in tracked config, never auto-corrected. */
export class UnknownLiveAlgorithmIdError extends Error {
  constructor(id: string) {
    super(`parseLiveAlgorithmIds: "${id}" is not a known algorithm id (accepted: ${PUBLISHED_ALGORITHM_IDS.join(", ")}) — check LIVE_ALGORITHM_IDS in apps/worker/wrangler.toml for a typo.`);
    this.name = "UnknownLiveAlgorithmIdError";
  }
}

/**
 * The live tier came out empty after filtering the algorithms manifest.
 * Thrown because a tick that folds nothing would still claim and advance
 * the event cursor, marking matches folded that no state ever saw, and its
 * log line would look healthy.
 */
export class EmptyLiveAlgorithmTierError extends Error {
  constructor() {
    super(
      "buildAlgorithmModules: the live algorithm tier is empty after filtering the algorithms manifest — " +
        "a tick that folds zero algorithms would still claim and advance the event cursor, marking matches " +
        "folded that were never applied to any state. Check LIVE_ALGORITHM_IDS in apps/worker/wrangler.toml " +
        "against the deployed algorithms manifest (v1/manifest/algorithms.json)."
    );
    this.name = "EmptyLiveAlgorithmTierError";
  }
}

/**
 * Parses `Env.LIVE_ALGORITHM_IDS` (comma-separated) into the tier that folds
 * live this tick.
 *  - Unset or empty: `DEFAULT_LIVE_ALGORITHM_IDS` plus one
 *    `live-tier-defaulted` warn line. Defaulting to "all" would blow the
 *    subrequest budget; throwing would stop freshness over a config omission.
 *    Only the ids are logged, never another binding value.
 *  - An id not in `PUBLISHED_ALGORITHM_IDS`: throws `UnknownLiveAlgorithmIdError`.
 * Called at the top of `runTick` so a misconfigured deploy fails on the next
 * tick, not when an event goes live months later.
 */
export function parseLiveAlgorithmIds(raw: string | undefined): string[] {
  const segments = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) {
    console.warn(JSON.stringify({ msg: "live-tier-defaulted", ids: DEFAULT_LIVE_ALGORITHM_IDS }));
    return [...DEFAULT_LIVE_ALGORITHM_IDS];
  }

  for (const id of segments) {
    if (!(PUBLISHED_ALGORITHM_IDS as readonly string[]).includes(id)) {
      throw new UnknownLiveAlgorithmIdError(id);
    }
  }
  return segments;
}

/** Builds exactly the modules `algorithmsManifest` names, narrowed to `liveAlgorithmIds` (published and folded-live are different sets). Called once per tick; every event reuses the same instances. Throws `EmptyLiveAlgorithmTierError` on an empty result. */
export function buildAlgorithmModules(algorithmsManifest: AlgorithmsManifest, liveAlgorithmIds: readonly string[]): Map<string, AlgorithmModule<any>> {
  const liveSet = new Set(liveAlgorithmIds);
  const modules = new Map<string, AlgorithmModule<any>>();
  for (const entry of algorithmsManifest.algorithms) {
    if (!liveSet.has(entry.id)) continue;
    if (entry.id === "opr") {
      modules.set(entry.id, opr);
      continue;
    }
    if (entry.id === "epa") {
      modules.set(entry.id, epa);
      continue;
    }
    if (entry.id === "spr") {
      modules.set(entry.id, spr);
      continue;
    }
    // Any other id throws — an unknown id must be loud, not plausible.
    throw new UnknownLiveAlgorithmIdError(entry.id);
  }
  if (modules.size === 0) {
    throw new EmptyLiveAlgorithmTierError();
  }
  return modules;
}

/** Algorithms with event-scoped state (OPR's per-event ratings), whose event row must be loaded before a tick folds into it. EPA and SPR are team-scoped only. */
export const EVENT_SCOPED_ALGORITHM_IDS = new Set(["opr"]);

/**
 * An algorithm's full selection list for one event's fold, in one
 * `readScopedState` statement (two scope kinds cost what one does).
 *
 * Never drop the event selection for an event-scoped algorithm: without that
 * row, `update()` rebuilds the accumulator from this tick's matches alone
 * and writes it back, silently overwriting the event's history with
 * well-formed but wrong rows.
 */
export function selectionsFor(algorithmId: string, eventKey: string, touchedTeams: readonly string[]): ScopeSelection[] {
  const selections: ScopeSelection[] = [];
  if (EVENT_SCOPED_ALGORITHM_IDS.has(algorithmId)) {
    selections.push({ scopeKind: "event", scopeKeys: [eventKey] });
  }
  selections.push({ scopeKind: "team", scopeKeys: touchedTeams });
  return selections;
}

async function loadOrInitState(db: D1Database, algorithmId: string, selections: readonly ScopeSelection[], algorithm: AlgorithmModule<any>) {
  const rows = await readScopedState(db, algorithmId, selections);
  const hasLeagueRow = rows.some((row) => row.scopeKind === "league");
  // Not yet seeded: cold-start via initState, since deserializeState throws
  // MissingLeagueRowError for this case. initState takes team keys, never
  // the event key.
  const teamKeys = selections.find((s) => s.scopeKind === "team")?.scopeKeys ?? [];
  const state: any = hasLeagueRow ? deserializeState(algorithmId, rows) : algorithm.initState([...teamKeys]);
  return { rows, state };
}

// ---------------------------------------------------------------------------
// TBA match -> core algorithm types
// ---------------------------------------------------------------------------

function toMatchResult(match: CorpusMatch, eventType: number, week: number | null): MatchResult {
  return {
    matchKey: match.matchKey,
    eventKey: match.eventKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: match.redTeams,
    blueTeams: match.blueTeams,
    redSurrogates: match.redSurrogates,
    blueSurrogates: match.blueSurrogates,
    // DQ keys must be threaded, never defaulted: `isFullyDqZeroScoreAlliance`
    // fails OPEN on an absent field, so omitting them would silently skip the
    // whole-alliance-DQ exclusion the offline publish applies.
    redDqs: match.redDqs,
    blueDqs: match.blueDqs,
    eventType,
    // Threaded, never defaulted: `null` means TBA gives no week, while corpus
    // week 0 is a real week (Statbotics' week 1), so a fabricated `0` would
    // enrol a championship match in the week-1 calibration population.
    week,
    winner: match.winner as "red" | "blue" | "tie",
    redScore: match.redScore!,
    blueScore: match.blueScore!,
    redRpEarned: match.redRpEarned,
    blueRpEarned: match.blueRpEarned,
    hasScoreBreakdown: match.hasScoreBreakdown,
    scoreBreakdownRaw: match.scoreBreakdownRaw,
  };
}

// ---------------------------------------------------------------------------
// Rounding — small, deliberate duplication of publish.ts's own helpers:
// publish.ts is Node/corpus-heavy and must never be imported by the Worker.
// ---------------------------------------------------------------------------

function roundTeamMetricRecord(metrics: Record<string, TeamMetric>): Record<string, TeamMetric> {
  const result: Record<string, TeamMetric> = {};
  for (const [key, m] of Object.entries(metrics)) {
    result[key] = { value: roundMetric(m.value), ...(m.spread !== undefined ? { spread: roundMetric(m.spread) } : {}) };
  }
  return result;
}

/** `frc254` -> `254`. Defensive fallback only, mirrors `publish.ts`'s own `fallbackTeamNumber`. */
function fallbackTeamNumber(teamKey: string): number {
  const parsed = Number.parseInt(teamKey.replace(/^frc/, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// Artifact merge: read the existing published object (if any) and apply
// only what THIS tick changed — never a full corpus-based rebuild (the
// Worker has no corpus access at all).
// ---------------------------------------------------------------------------

interface Stamp {
  readonly generation: string;
  readonly computedAt: string;
}

/**
 * Predicted per-bonus marginals for one live row, gated as `publish.ts`'s
 * `eventMatchBonusRpFields` does. Actual per-bonus flags need the season's
 * RP rule module to parse the breakdown, which this Worker does not do; the
 * offline republish fills them, and until then the client draws `unknown`.
 */
function liveBonusRpFields(compLevel: MatchResult["compLevel"], prediction: Prediction) {
  return {
    ...(isBonusRpCompLevel(compLevel) && prediction.redBonusRp ? { redBonusRp: prediction.redBonusRp.map((p) => roundProbability(p)) } : {}),
    ...(isBonusRpCompLevel(compLevel) && prediction.blueBonusRp ? { blueBonusRp: prediction.blueBonusRp.map((p) => roundProbability(p)) } : {}),
  };
}

/**
 * One played match's published Match Band: each side's display variance,
 * `sigmaMatchBandVariance(roster size, Σ Sigma Score²)`, walk-forward. Sigma
 * algorithms only; OPR/EPA rows carry no band keys. Never the win-odds
 * variance `rpFieldsFor` reads, which stays inside the tick.
 */
interface MatchBand {
  readonly red?: number;
  readonly blue?: number;
}

/** Emits the band fields exactly as `publish.ts` does, so a live row and an offline row for the same match are byte-identical. */
function matchBandFields(band: MatchBand | undefined) {
  if (band === undefined) return {};
  return {
    ...(band.red !== undefined ? { redMatchBandVariance: roundTo(band.red, ROUNDING_RULE.variance) } : {}),
    ...(band.blue !== undefined ? { blueMatchBandVariance: roundTo(band.blue, ROUNDING_RULE.variance) } : {}),
  };
}

/** What Phase A hands Phase B for one algorithm. */
interface PerAlgorithmFold {
  readonly algorithm: AlgorithmModule<any>;
  readonly newPredictions: Map<string, Prediction>;
  readonly touchedMetrics: Record<string, Record<string, TeamMetric>>;
  /** Match Band per newly-folded match key. */
  readonly newBands: ReadonlyMap<string, MatchBand>;
  /** The changed rows Phase A passed to `writeScopedState`; Phase B splices them into the SPR event artifact's `state` block. */
  readonly writtenRows: readonly StateRow[];
  /**
   * Sigma Score per real touched team, read at end of tick, the same instant
   * as `touchedMetrics`, so Total and Sigma always pair. Empty (never
   * omitted) when `usesSigmaScore` is false.
   */
  readonly touchedSigma: ReadonlyMap<string, number>;
}

function buildEventMatchRow(match: MatchResult, prediction: Prediction, band: MatchBand | undefined) {
  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    // Played rows carry the pmf pair too: the simulation rewinds into played
    // matches, and most events have no unplayed qualification match.
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    // The RP decomposition, never gated on competition level, exactly as
    // `publish.ts`'s row builders emit it, so live and offline rows agree.
    matchOutcomePmf: prediction.matchOutcomePmf ? roundPmf(prediction.matchOutcomePmf) : undefined,
    redBonusRpPmf: prediction.redBonusRpPmf ? roundPmf(prediction.redBonusRpPmf) : undefined,
    blueBonusRpPmf: prediction.blueBonusRpPmf ? roundPmf(prediction.blueBonusRpPmf) : undefined,
    ...liveBonusRpFields(match.compLevel, prediction),
    ...matchBandFields(band),
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
  };
}

/**
 * One still-upcoming match as the tick writes it: schedule fields only. The
 * browser prices it from the artifact's `state` block. `sortTime` is the
 * published value from the existing artifact's row for this match, never
 * the TBA-normalized approximation; absent when that row had none.
 */
function buildEventScheduledRow(match: CorpusMatch, existingSortTime: number | undefined) {
  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    setNumber: match.setNumber,
    matchNumber: match.matchNumber,
    ...(existingSortTime !== undefined ? { sortTime: existingSortTime } : {}),
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
  };
}

/**
 * `{ win, tie }` from the first played prediction carrying both outcome-RP
 * vectors. Reimplements the played half of `publish.ts`'s private
 * `findRpOutcomeRp`, because importing `publish.ts` would pull
 * `better-sqlite3` into the Worker; the tick prices no upcoming match, so the
 * caller falls back to the existing artifact's value. `sigmaScoutLayer.ts`
 * composes the vector as `[winRp, tieRp, 0]`.
 */
function findRpOutcomeRp(played: readonly Prediction[]): { win: number; tie: number } | undefined {
  for (const prediction of played) {
    const { redOutcomeRp, blueOutcomeRp } = prediction;
    if (redOutcomeRp !== undefined && blueOutcomeRp !== undefined) {
      return { win: redOutcomeRp[0]!, tie: redOutcomeRp[1]! };
    }
  }
  return undefined;
}

interface MergeEventArtifactParams {
  readonly existing: LiveEventArtifact | undefined;
  readonly eventKey: string;
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  /** TBA's `event_type` when this tick's event-detail fetch returned 200 and parsed; `undefined` otherwise, never the `-1` sentinel. */
  readonly eventType: number | undefined;
  readonly newlyFolded: readonly MatchResult[];
  readonly newPredictions: ReadonlyMap<string, Prediction>;
  readonly stillUpcoming: readonly CorpusMatch[];
  readonly touchedTeams: readonly string[];
  readonly touchedMetrics: Readonly<Record<string, Record<string, TeamMetric>>>;
  readonly newBands: ReadonlyMap<string, MatchBand>;
  /** The rows Phase A wrote to D1 for this algorithm this tick. */
  readonly writtenRows: readonly StateRow[];
  readonly stamp: Stamp;
}

/**
 * The SPR `state` block the merged artifact carries, or `undefined` for none.
 *
 * - Not SPR, or no upcoming match left: none, silently.
 * - The existing artifact has a block: the splice of this tick's written rows
 *   into it. A splice that throws `EventStateBlockError` drops the block and
 *   logs `event-state-block-invalid`.
 * - No existing block: none, and logs `event-state-block-missing`. The Worker
 *   never reads D1 to bootstrap one; republish and re-seed instead.
 *
 * Log lines carry the event key, algorithm id, counts and the error message
 * (ids and versions only), never an artifact body or a TBA value.
 */
function maintainedStateBlock(params: MergeEventArtifactParams, upcomingCount: number): LiveEventArtifact["state"] {
  const { existing, eventKey, algorithmId, writtenRows, touchedTeams } = params;
  if (algorithmId !== spr.id || upcomingCount === 0) return undefined;
  if (existing?.state === undefined) {
    console.warn(JSON.stringify({ msg: "event-state-block-missing", eventKey, algorithmId, upcoming: upcomingCount }));
    return undefined;
  }
  try {
    return spliceEventStateBlock(existing.state, writtenRows, touchedTeams);
  } catch (error) {
    if (!(error instanceof EventStateBlockError)) throw error;
    console.warn(JSON.stringify({ msg: "event-state-block-invalid", eventKey, algorithmId, upcoming: upcomingCount, error: error.message }));
    return undefined;
  }
}

/** Read-modify-write merge: replaces newly-folded matches (removing them from `upcoming`), rewrites the remaining `upcoming` rows schedule-only, refreshes touched teams' standings rows, keeps the SPR `state` block current, and preserves everything else from `existing` unchanged. Bootstraps a schema-valid (but degraded — no history this Worker cannot see) artifact when `existing` is `undefined`. */
function mergeEventArtifact(params: MergeEventArtifactParams): unknown {
  const { existing, eventKey, season, algorithmId, algorithmVersion, eventType, newlyFolded, newPredictions, stillUpcoming, touchedTeams, touchedMetrics, newBands, stamp } = params;

  const newMatchKeys = new Set(newlyFolded.map((m) => m.matchKey));
  const preservedMatches = (existing?.matches ?? []).filter((m) => !newMatchKeys.has(m.matchKey));
  const matches = [...preservedMatches, ...newlyFolded.map((m) => buildEventMatchRow(m, newPredictions.get(m.matchKey)!, newBands.get(m.matchKey)))];

  const existingSortTimes = new Map<string, number>();
  for (const row of existing?.upcoming ?? []) {
    if (row.sortTime !== undefined) existingSortTimes.set(row.matchKey, row.sortTime);
  }
  const upcoming = stillUpcoming.map((m) => buildEventScheduledRow(m, existingSortTimes.get(m.matchKey)));

  // The season's win/tie RP constants, derived as `publish.ts` derives them
  // so live and offline artifacts agree; else the existing artifact's value,
  // else absent.
  const rpOutcomeRp = findRpOutcomeRp([...newPredictions.values()]) ?? existing?.rpOutcomeRp;

  const resolvedEventType = eventType ?? existing?.eventType;
  const state = maintainedStateBlock(params, upcoming.length);

  const existingTeams = existing?.teams ?? [];
  const touchedSet = new Set(touchedTeams);
  const teams = [
    ...existingTeams.filter((t) => !touchedSet.has(t.teamKey)),
    ...touchedTeams.map((teamKey) => {
      const prior = existingTeams.find((t) => t.teamKey === teamKey);
      return {
        teamKey,
        teamNumber: prior?.teamNumber ?? fallbackTeamNumber(teamKey),
        nickname: prior?.nickname ?? "",
        // Carries the prior row's published Sigma entry forward; a live tick
        // computes no season-final Sigma of its own.
        metrics: touchedEventTeamMetrics(prior?.metrics, touchedMetrics[teamKey] ?? {}),
      };
    }),
  ];

  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: stamp.generation,
    computedAt: stamp.computedAt,
    algorithmId,
    algorithmVersion,
    eventKey,
    season,
    ...(resolvedEventType !== undefined ? { eventType: resolvedEventType } : {}),
    matches,
    upcoming,
    teams,
    ...(rpOutcomeRp !== undefined ? { rpOutcomeRp } : {}),
    ...(state !== undefined ? { state } : {}),
  };
}

function buildTeamSeasonMatchRow(match: MatchResult, prediction: Prediction, season: number, algorithmId: string, algorithmVersion: string, band: MatchBand | undefined) {
  return {
    matchKey: match.matchKey,
    season,
    eventKey: match.eventKey,
    compLevel: match.compLevel,
    algorithmId,
    algorithmVersion,
    predictedWinner: prediction.winner,
    pRedWin: roundProbability(prediction.pRedWin),
    predictedRedScore: roundMetric(prediction.redScore),
    predictedBlueScore: roundMetric(prediction.blueScore),
    variance: prediction.variance !== undefined ? roundTo(prediction.variance, ROUNDING_RULE.variance) : undefined,
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    ...matchBandFields(band),
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
  };
}

/** `existing` with each new row replacing the row of the same `matchKey` in place, or appended when there is none. */
function replaceOrAppendRows<Row extends { readonly matchKey: string }>(existing: readonly Row[], newRows: readonly Row[]): Row[] {
  const rows = [...existing];
  for (const row of newRows) {
    const index = rows.findIndex((r) => r.matchKey === row.matchKey);
    if (index === -1) rows.push(row);
    else rows[index] = row;
  }
  return rows;
}

/**
 * Official play only: an offseason or Week-0 match leaves the record
 * unchanged, matching `publish.ts`. Tested per match, so the `-1` "detail
 * fetch failed" event type degrades toward counting the match.
 */
function incrementRecord(record: { wins: number; losses: number; ties: number }, teamKey: string, match: MatchResult) {
  if (!isOfficialEventType(match.eventType)) return record;
  const onRed = match.redTeams.includes(teamKey);
  const onBlue = match.blueTeams.includes(teamKey);
  if (!onRed && !onBlue) return record;
  const won = (onRed && match.winner === "red") || (onBlue && match.winner === "blue");
  const lost = (onRed && match.winner === "blue") || (onBlue && match.winner === "red");
  const tied = match.winner === "tie";
  return { wins: record.wins + (won ? 1 : 0), losses: record.losses + (lost ? 1 : 0), ties: record.ties + (tied ? 1 : 0) };
}

interface MergeTeamSeasonArtifactParams {
  readonly existing: TeamSeasonArtifact | undefined;
  readonly teamKey: string;
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly eventKey: string;
  readonly matches: readonly MatchResult[];
  readonly predictions: ReadonlyMap<string, Prediction>;
  readonly metrics: Readonly<Record<string, TeamMetric>>;
  readonly matchIndexByKey: ReadonlyMap<string, number>;
  /** Match Band per newly-folded match key. */
  readonly bands: ReadonlyMap<string, MatchBand>;
  readonly stamp: Stamp;
  /**
   * This team's Sigma Score at end of tick, used only on this tick's new
   * metric-history rows. It travels separately from `metrics` because
   * `seasonStats` keeps the publisher's season-final, tiered Sigma. Required
   * (may be `undefined`) so no caller omits it by accident.
   */
  readonly sigmaAfterTick: number | undefined;
}

/**
 * Read-modify-write merge for one team's season artifact: writes this tick's
 * newly-folded matches at `eventKey` (creating the event's entry if this is
 * the team's first match there), refreshes `seasonStats`, and appends
 * metric-history rows. Exported for `test/scheduled.officialRecord.test.ts`:
 * an offseason match's rows ARE appended while the record is NOT incremented.
 *
 * A newly played match REPLACES that match's existing row (the publisher's
 * unplayed row) in place, so the event keeps the offline chronological order
 * with no duplicate; a match with no prior row is appended. Other unplayed
 * rows keep their published priced fields: rewriting them would mean reading
 * every roster team's artifact each tick, and step 3 of the browser-pricing
 * direction prices team pages from the event file instead (260915-isq DD-3).
 */
export function mergeTeamSeasonArtifact(params: MergeTeamSeasonArtifactParams): unknown {
  const { existing, teamKey, season, algorithmId, algorithmVersion, eventKey, matches, predictions, metrics, matchIndexByKey, bands, stamp, sigmaAfterTick } = params;

  let record = existing?.seasonStats.record ?? { wins: 0, losses: 0, ties: 0 };
  for (const match of matches) record = incrementRecord(record, teamKey, match);

  const newRows = matches.map((m) => buildTeamSeasonMatchRow(m, predictions.get(m.matchKey)!, season, algorithmId, algorithmVersion, bands.get(m.matchKey)));
  const existingEvents = existing?.events ?? [];
  const eventIndex = existingEvents.findIndex((e) => e.eventKey === eventKey);
  const events =
    eventIndex === -1
      ? [...existingEvents, { eventKey, eventName: eventKey, startDate: stamp.computedAt.slice(0, 10), matches: newRows }]
      : existingEvents.map((e, i) => (i === eventIndex ? { ...e, matches: replaceOrAppendRows(e.matches, newRows) } : e));

  // `sigmaAfterTick`, when defined, is the last metrics key on each new row;
  // existing rows are untouched.
  const newMetricHistoryRows = matches.map((m) => ({
    matchKey: m.matchKey,
    season,
    eventKey: m.eventKey,
    algorithmId,
    teamKey,
    matchIndex: matchIndexByKey.get(m.matchKey) ?? 0,
    metrics: {
      ...roundTeamMetricRecord(metrics),
      ...(sigmaAfterTick !== undefined ? { [SIGMA_METRIC_KEY]: { value: roundMetric(sigmaAfterTick) } } : {}),
    },
  }));

  // The leading spread is load-bearing: without it a live tick would drop
  // publisher-owned fields (`ranks`, `robotImageUrl`, `activeYears`) until the
  // next offline publish. `existing` was schema-parsed, so it carries no
  // unknown keys. Tick-owned fields must stay listed explicitly below.
  return {
    ...existing,
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: stamp.generation,
    computedAt: stamp.computedAt,
    algorithmId,
    algorithmVersion,
    teamKey,
    teamNumber: existing?.teamNumber ?? fallbackTeamNumber(teamKey),
    nickname: existing?.nickname ?? "",
    season,
    // Carries the prior Sigma entry forward, keeping the team page's Total
    // tile pill visible during a live event.
    seasonStats: { record, metrics: touchedEventTeamMetrics(existing?.seasonStats.metrics, metrics) },
    events,
    metricHistory: [...(existing?.metricHistory ?? []), ...newMetricHistoryRows],
  };
}

async function readExistingEvent(env: Env, budget: SubrequestBudget, params: { page: "event"; eventKey: string; algorithmId: string; version: string }): Promise<LiveEventArtifact | undefined> {
  const text = await readArtifactObject(env, budget, artifactKey(params));
  if (text === undefined) return undefined;
  try {
    // The live schema, so an artifact a previous tick wrote with schedule-only
    // upcoming rows survives this tick's read.
    return LiveEventArtifactSchema.parse(JSON.parse(text));
  } catch {
    return undefined; // corrupt/legacy artifact -- degrade to a fresh bootstrap rather than fail the event
  }
}

async function readExistingTeam(env: Env, budget: SubrequestBudget, params: { page: "team"; teamKey: string; year: number; algorithmId: string; version: string }): Promise<TeamSeasonArtifact | undefined> {
  const text = await readArtifactObject(env, budget, artifactKey(params));
  if (text === undefined) return undefined;
  try {
    return TeamSeasonArtifactSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Per-event processing
// ---------------------------------------------------------------------------

interface TouchedTeamInfo {
  metrics: Record<string, TeamMetric>;
  matchDelta: number;
}

type EventOutcome = { readonly status: "advanced"; readonly eventComplete: boolean } | { readonly status: "deferred" } | { readonly status: "failed" } | { readonly status: "unchanged" };

function touchedTeamsCompositeKey(algorithmId: string, season: number): string {
  return `${algorithmId}::${season}`;
}

/**
 * Overlap safety: an optimistic compare-and-swap on
 * `event_cursor.last_folded_match_key`, made before any state is read, so
 * two overlapping invocations can never fold the same matches. Only the
 * invocation whose `UPDATE ... WHERE last_folded_match_key IS <value read>`
 * matches a row proceeds.
 *
 * `IS`, not `=`, so a bound `NULL` (nothing folded yet) compares correctly.
 * A zero-row UPDATE is ambiguous (no row vs. lost race); the
 * `INSERT ... WHERE NOT EXISTS` fallback inserts only a genuinely absent row.
 *
 * Callers must write the cursor back if later work fails, or a rejected
 * Phase A write would desync the cursor from `algorithm_state`.
 */
async function claimEventAdvance(db: D1Database, eventKey: string, expectedPriorLastFolded: string | null, newLastFoldedMatchKey: string, tbaEtag: string | null, nowIso: string): Promise<boolean> {
  const updateResult = await db
    .prepare(`UPDATE event_cursor SET tba_etag = ?, last_folded_match_key = ?, last_polled_at = ?, last_advanced_at = ? WHERE event_key = ? AND last_folded_match_key IS ?`)
    .bind(tbaEtag, newLastFoldedMatchKey, nowIso, nowIso, eventKey, expectedPriorLastFolded)
    .run();
  if (changesOf(updateResult) > 0) return true;

  const insertResult = await db
    .prepare(
      `INSERT INTO event_cursor (event_key, tba_etag, last_folded_match_key, last_polled_at, last_advanced_at)
       SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM event_cursor WHERE event_key = ?)`
    )
    .bind(eventKey, tbaEtag, newLastFoldedMatchKey, nowIso, nowIso, eventKey)
    .run();
  return changesOf(insertResult) > 0;
}

function changesOf(result: unknown): number {
  return (result as { meta?: { changes?: number } })?.meta?.changes ?? 0;
}

// ---------------------------------------------------------------------------
// Subrequest budget estimate, shared with `liveAlgorithmTier.test.ts`
// ---------------------------------------------------------------------------

/** `runTick`'s fixed subrequests before any event work: the live-windows manifest, algorithms manifest and tick-meta reads. Pinned to the deployed Worker's measured idle-tick `subrequestsUsed`. */
export const TICK_FIXED_SUBREQUEST_COST = 3;

/** `processEvent`'s fixed cost spent before the estimate check: the cursor read and the TBA poll. */
export const EVENT_PREFLIGHT_SUBREQUEST_COST = 2;

/** The whole event's remaining subrequest cost, estimated up front so the event is all-or-nothing. */
export function estimateEventSubrequestCost(algorithmCount: number, touchedTeamCount: number): number {
  return (
    1 /* claim (cursor CAS) */ +
    1 /* event-detail fetch */ +
    algorithmCount * 2 /* Phase A: read + write, per algorithm */ +
    algorithmCount * 2 * (1 + touchedTeamCount) /* Phase B: read + write, per event artifact + per team artifact, per algorithm */
  );
}

async function processEvent(
  env: Env,
  budget: SubrequestBudget,
  tbaCtx: TbaClientContext,
  algorithmModules: ReadonlyMap<string, AlgorithmModule<any>>,
  window: LiveWindowEntry,
  nowIso: string,
  stamp: Stamp,
  touchedTeamsByAlgorithm: Map<string, Map<string, TouchedTeamInfo>>
): Promise<EventOutcome> {
  const eventKey = window.eventKey;

  try {
    if (!budget.tryConsume(1)) return { status: "deferred" };
    const cursor: EventCursor = (await readEventCursor(env.DB, eventKey)) ?? { eventKey, tbaEtag: null, lastFoldedMatchKey: null, lastPolledAt: null, lastAdvancedAt: null };

    if (!budget.tryConsume(1)) return { status: "deferred" };
    const poll = await pollEventMatches(tbaCtx, eventKey, cursor.tbaEtag ?? undefined);
    if (poll.status === "not-modified") return { status: "unchanged" };

    const rawMatches = tbaMatchListSchema.parse(poll.matches);
    // The live-windows manifest has no real start_date; this approximation
    // feeds only normalizeMatch's rarely used sortTime fallback.
    const approxStartDateIso = new Date(window.startMs).toISOString();
    const normalized = rawMatches.map((m) => normalizeMatch(m, approxStartDateIso));
    const orderedMatches = [...normalized].sort((a, b) => a.sortTime - b.sortTime);
    const orderedMatchKeys = orderedMatches.map((m) => m.matchKey);
    const matchIndexByKey = new Map(orderedMatchKeys.map((key, i) => [key, i]));

    const newlyFolded = orderedMatches.filter((m) => m.winner !== null && !hasAlreadyFolded(cursor, m.matchKey, orderedMatchKeys));
    const stillUpcoming = orderedMatches.filter((m) => m.winner === null);

    if (newlyFolded.length === 0) {
      if (poll.etag !== undefined && poll.etag !== cursor.tbaEtag && budget.tryConsume(1)) {
        await writeEventCursor(env.DB, { ...cursor, tbaEtag: poll.etag, lastPolledAt: nowIso });
      }
      return { status: "unchanged" };
    }

    const touchedTeams = [...new Set(newlyFolded.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort();
    // Demo keys never drive D1 state or team artifacts; `touchedTeams` stays
    // raw for the event artifact's standings.
    const realTouchedTeams = touchedTeams.filter((teamKey) => !isDemoTeamKey(teamKey));
    const lastFoldedMatchKey = newlyFolded[newlyFolded.length - 1]!.matchKey;

    // Sized off `realTouchedTeams`: Phase B spends nothing on demo keys.
    const algorithmCount = algorithmModules.size;
    const estimatedCost = estimateEventSubrequestCost(algorithmCount, realTouchedTeams.length);
    if (budget.remaining < estimatedCost) {
      return { status: "deferred" };
    }

    // Claim before any state is read; a lost claim means another invocation
    // is advancing this event and its work supersedes ours.
    budget.consume(1);
    const claimed = await claimEventAdvance(env.DB, eventKey, cursor.lastFoldedMatchKey, lastFoldedMatchKey, poll.etag ?? cursor.tbaEtag, nowIso);
    if (!claimed) {
      return { status: "unchanged" };
    }

    try {
      // The event detail supplies `event_type` (the RP eligibility gate) and
      // `week`, which the live-windows manifest lacks. A failed fetch
      // degrades (RP ineligible, week unplaced) rather than failing the event.
      budget.consume(1);
      let eventType = -1;
      // The published `eventType`: defined only when the fetch returned 200
      // and parsed, so the `-1` sentinel never reaches an artifact.
      let fetchedEventType: number | undefined;
      // `null`, not a sentinel: `week` is nullable in TBA's contract.
      let week: number | null = null;
      try {
        const detail = await fetchEventDetail(tbaCtx, eventKey);
        if (detail.status === 200) {
          const parsed = tbaEventSchema.parse(detail.body);
          eventType = parsed.event_type;
          fetchedEventType = parsed.event_type;
          week = parsed.week ?? null;
        }
      } catch {
        // degrade gracefully — see comment above
      }

      const newlyFoldedResults = newlyFolded.map((m) => toMatchResult(m, eventType, week));

      // Phase A: every algorithm reads, folds and writes state; all must
      // succeed before any artifact write.
      const perAlgorithm = new Map<string, PerAlgorithmFold>();

      for (const [algorithmId, algorithm] of algorithmModules) {
        // Demo keys stripped, so none seeds a `team` row at cold start.
        const selections = selectionsFor(algorithmId, eventKey, realTouchedTeams);

        budget.consume(1);
        const { rows, state: initialState } = await loadOrInitState(env.DB, algorithmId, selections, algorithm);

        let state = initialState;
        // Sigma Score, resumed from the seeded beliefs (a fresh accumulator
        // would see only this event) and the population statistics (without
        // them the talent prior silently falls back to its flat form).
        const sigma = usesSigmaScore(algorithmId)
          ? SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs(rows), readSigmaPopulation(rows))
          : undefined;
        // One alliance's win-odds variance, one accessor for every played
        // row. `rpFieldsFor` reads it; `displayBandFor` derives the published
        // band from it.
        const winOddsVarianceFor = (roster: readonly string[]): number | undefined =>
          sigma === undefined ? undefined : sigma.bandVarianceFor(roster);
        // The published Match Band, through the same helper the offline
        // `SigmaScoutLayer` uses. OPR and EPA publish none.
        const displayBandFor = (
          view: { redTeams: readonly string[]; blueTeams: readonly string[] },
          redWinOddsVariance: number | undefined,
          blueWinOddsVariance: number | undefined
        ): MatchBand => {
          if (sigma === undefined) return {};
          const red = sigmaMatchBandVariance(view.redTeams.length, redWinOddsVariance);
          const blue = sigmaMatchBandVariance(view.blueTeams.length, blueWinOddsVariance);
          return { ...(red !== undefined ? { red } : {}), ...(blue !== undefined ? { blue } : {}) };
        };

        // Ranking points, resumed from the same rows for the same reason: a
        // wrong RP pmf is still a valid distribution and renders silently.
        //
        // The rule-module lookup is INDEXED, not `rpRuleModuleForSeason`
        // (which throws): a season with no registered rules, or an algorithm
        // that publishes no RP, gets no accumulator rather than failing the tick.
        const rpRuleModule = publishesRankingPoints(algorithmId) ? RP_RULE_MODULES[window.season] : undefined;
        const rpBeliefs = readRpBeliefs(rows);
        const rp = rpRuleModule !== undefined ? RpMomentsAccumulator.fromBeliefs(rpRuleModule, rpBeliefs) : undefined;
        // The walk-forward RP mean shift, resumed from the league row (state
        // shape 16) and built exactly when the RP accumulator is, as in
        // `SigmaScoutLayer`. `fromState` discards another season's state.
        const rpMeanShift = rpRuleModule !== undefined ? RpMeanShiftAccumulator.fromState(rpRuleModule, readRpMeanShift(rows)) : undefined;
        // Teams whose beliefs this tick resumed, plus those it folds; read by
        // the partial-roster gate below.
        const rpKnownTeams = new Set(rpBeliefs.keys());

        // One accessor for this tick's played-row RP. Mirrors
        // `SigmaScoutLayer.#rpFieldsFor`; change them together. Upcoming
        // matches are priced in the browser from the event's `state` block.
        const rpFieldsFor = (
          view: { redTeams: readonly string[]; blueTeams: readonly string[]; eventType: number; matchKey: string; compLevel: MatchResult["compLevel"] },
          prediction: Prediction,
          redBandVariance: number | undefined,
          blueBandVariance: number | undefined
        ): Partial<Prediction> => {
          if (rp === undefined || rpRuleModule === undefined || rpMeanShift === undefined) return {};
          if (!isRpEligibleEventType(view.eventType)) return {};
          if (redBandVariance === undefined || blueBandVariance === undefined) return {};
          // Partial-roster gate: the Worker loads state only for teams touched
          // this tick, and `momentsFor` would silently sum a narrower,
          // overconfident pmf over an unloaded team. Every played roster team
          // is touched, so it guards played rows as defence in depth.
          // Stricter than the offline path: an absent pmf, never a wrong one.
          for (const teamKey of [...view.redTeams, ...view.blueTeams]) {
            if (!rpKnownTeams.has(teamKey)) return {};
          }

          const pmf = analyticRpPmf({
            // The mean shift applies per alliance, only to a fully-warm roster.
            red: rpMeanShift.apply(rp.momentsFor(view.redTeams, prediction.redScore, redBandVariance), rosterIsFullyWarm(rp, view.redTeams)),
            blue: rpMeanShift.apply(rp.momentsFor(view.blueTeams, prediction.blueScore, blueBandVariance), rosterIsFullyWarm(rp, view.blueTeams)),
            ruleModule: rpRuleModule,
            eventType: view.eventType,
            compLevel: view.compLevel,
            pRedWin: prediction.pRedWin,
          });

          // The five decomposition fields; winRp/tieRp come from the season's
          // rule module, never hardcoded, and an absent decomposition stays absent.
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

        /** Folds one played match's OBSERVED threshold variables — the exact mirror of `SigmaScoutLayer.#foldObservedThresholds`, including its degrade-to-a-counted-skip try/catch. */
        const foldObservedRp = (result: MatchResult): void => {
          if (rp === undefined || rpRuleModule === undefined) return;
          if (!isRpEligibleEventType(result.eventType)) return;
          if (!result.hasScoreBreakdown || result.scoreBreakdownRaw === null) return;
          for (const side of ["red", "blue"] as const) {
            try {
              const parsed = rpRuleModule.parse(JSON.parse(result.scoreBreakdownRaw), side, result.eventType);
              rp.fold(side === "red" ? result.redTeams : result.blueTeams, parsed.thresholdVariables);
            } catch {
              // A breakdown this season's module cannot parse contributes
              // nothing rather than failing the tick.
            }
          }
          for (const teamKey of [...result.redTeams, ...result.blueTeams]) rpKnownTeams.add(teamKey);
        };

        const newBands = new Map<string, { red?: number; blue?: number }>();
        const newPredictions = new Map<string, Prediction>();
        for (const result of newlyFoldedResults) {
          const prediction = algorithm.predict(state, toLeakProofUpcoming(result));
          // Predict-before-update: read the win odds before folding this match,
          // whose own result is not an admissible input to its band.
          const redWinOddsVariance = winOddsVarianceFor(result.redTeams);
          const blueWinOddsVariance = winOddsVarianceFor(result.blueTeams);
          newBands.set(result.matchKey, displayBandFor(result, redWinOddsVariance, blueWinOddsVariance));
          // RP from the pre-fold accumulator. The enriched prediction goes into
          // `newPredictions`, never a parallel map, so every row builder sees it.
          newPredictions.set(result.matchKey, {
            ...prediction,
            ...rpFieldsFor(result, prediction, redWinOddsVariance, blueWinOddsVariance),
          });
          state = algorithm.update(state, result);
          sigma?.foldMatch(result, prediction);
          // After the RP read and before the threshold fold, so the residual is
          // taken against the mean the match was priced from.
          if (rp !== undefined) rpMeanShift?.observeMatch(rp, result);
          foldObservedRp(result);
          // Talent from the post-update state, as `SigmaScoutLayer.foldPlayed`
          // does: applying it before the fold would let a match inform its own prior.
          if (sigma !== undefined) {
            const roster = [...result.redTeams, ...result.blueTeams];
            const metrics = algorithm.teamMetrics(state, roster);
            for (const teamKey of roster) {
              const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
              if (total !== undefined) sigma.observeTalent(teamKey, total);
            }
          }
        }

        const touchedMetrics = algorithm.teamMetrics(state, touchedTeams);
        // Same instant as `touchedMetrics`, read-only, zero subrequests; scoped
        // to `realTouchedTeams` like its only consumer, the team artifact loop.
        const touchedSigma = new Map<string, number>();
        if (sigma !== undefined) {
          for (const teamKey of realTouchedTeams) touchedSigma.set(teamKey, sigma.sigmaFor(teamKey));
        }

        // Passengers ride back into the rows after `serializeState`, so no
        // algorithm serializer knows they exist, at zero added subrequests.
        let candidateRows = serializeState(algorithmId, algorithm.version, state, stamp);
        if (rp !== undefined) candidateRows = withRpBeliefs(candidateRows, rp.beliefsByTeam());
        // The mean shift rides on the LEAGUE row.
        if (rpMeanShift !== undefined) candidateRows = withRpMeanShift(candidateRows, rpMeanShift.toState());
        if (sigma !== undefined) {
          candidateRows = withSigmaPopulation(withSigmaBeliefs(candidateRows, sigma.beliefsByTeam()), sigma.population());
        }
        const changedRows = selectChangedRows(rows, candidateRows);

        budget.consume(1);
        await writeScopedState(env.DB, changedRows); // may throw -- caught below, reverts the claim and aborts the WHOLE event (zero artifact puts)

        perAlgorithm.set(algorithmId, { algorithm, newPredictions, touchedMetrics, newBands, touchedSigma, writtenRows: changedRows });
      }

      return await runPhaseBAndReport(env, budget, window, eventKey, eventType, fetchedEventType, newlyFoldedResults, stillUpcoming, touchedTeams, realTouchedTeams, matchIndexByKey, perAlgorithm, touchedTeamsByAlgorithm, stamp, stillUpcoming.length === 0);
    } catch (phaseAError) {
      // Revert the claim: state did not advance, so a later tick must be free
      // to fold these matches again.
      if (budget.tryConsume(1)) {
        await writeEventCursor(env.DB, cursor);
      }
      throw phaseAError; // re-thrown -- caught by the outer try/catch below, event recorded "failed"
    }
  } catch (err) {
    // Otherwise a per-event failure is invisible (the tick still logs
    // `"ok":true`). Logs only the event key and error message, never the TBA
    // key or a response header/body.
    console.error(JSON.stringify({ msg: "event-failed", eventKey, error: err instanceof Error ? err.message : String(err) }));
    return { status: "failed" };
  }
}

/** Phase B: best-effort artifact writes, kept out of Phase A's claim-reverting try/catch. A Phase B failure leaves the event "advanced" (state did advance); a skipped artifact stays stale until the team's next match at this event.
 *
 * `touchedTeams` (raw) feeds only the event standings; `realTouchedTeams`
 * drives `team/{teamKey}/{year}` writes.
 *
 * `eventType` is passed explicitly (`newlyFoldedResults` can be empty) and
 * gates only the `touchedTeamsByAlgorithm` feed into `teams/{year}`. Event
 * and team artifact writes stay unconditional: an offseason event is fully
 * visible on its pages and only stops moving the season leaderboard. `-1`
 * counts as official. `fetchedEventType` is the value the event artifact
 * publishes, `undefined` when the detail fetch failed. */
async function runPhaseBAndReport(
  env: Env,
  budget: SubrequestBudget,
  window: LiveWindowEntry,
  eventKey: string,
  eventType: number,
  fetchedEventType: number | undefined,
  newlyFoldedResults: readonly MatchResult[],
  stillUpcoming: readonly CorpusMatch[],
  touchedTeams: readonly string[],
  realTouchedTeams: readonly string[],
  matchIndexByKey: ReadonlyMap<string, number>,
  perAlgorithm: ReadonlyMap<string, PerAlgorithmFold>,
  touchedTeamsByAlgorithm: Map<string, Map<string, TouchedTeamInfo>>,
  stamp: Stamp,
  eventComplete: boolean
): Promise<EventOutcome> {
  try {
    for (const [algorithmId, info] of perAlgorithm) {
      const eventParams = { page: "event" as const, eventKey, algorithmId, version: info.algorithm.version };
      const existingEvent = await readExistingEvent(env, budget, eventParams);
      const mergedEvent = mergeEventArtifact({
        existing: existingEvent,
        eventKey,
        season: window.season,
        algorithmId,
        algorithmVersion: info.algorithm.version,
        eventType: fetchedEventType,
        newlyFolded: newlyFoldedResults,
        newPredictions: info.newPredictions,
        stillUpcoming,
        newBands: info.newBands,
        writtenRows: info.writtenRows,
        touchedTeams,
        touchedMetrics: info.touchedMetrics,
        stamp,
      });
      await writeArtifactObject(env, budget, "event", eventParams, mergedEvent);

      // Only the `teams/{year}` feed is gated on officialness; the team
      // artifact write below stays unconditional.
      const isOfficial = isOfficialEventType(eventType);
      const compositeKey = touchedTeamsCompositeKey(algorithmId, window.season);
      const seasonMap = touchedTeamsByAlgorithm.get(compositeKey) ?? new Map<string, TouchedTeamInfo>();

      for (const teamKey of realTouchedTeams) {
        const teamParams = { page: "team" as const, teamKey, year: window.season, algorithmId, version: info.algorithm.version };
        const existingTeam = await readExistingTeam(env, budget, teamParams);
        const teamMatches = newlyFoldedResults.filter((m) => m.redTeams.includes(teamKey) || m.blueTeams.includes(teamKey));
        const mergedTeam = mergeTeamSeasonArtifact({
          existing: existingTeam,
          teamKey,
          season: window.season,
          algorithmId,
          algorithmVersion: info.algorithm.version,
          eventKey,
          matches: teamMatches,
          predictions: info.newPredictions,
          metrics: info.touchedMetrics[teamKey] ?? {},
          matchIndexByKey,
          bands: info.newBands,
          stamp,
          sigmaAfterTick: info.touchedSigma.get(teamKey),
        });
        await writeArtifactObject(env, budget, "team", teamParams, mergedTeam);

        if (isOfficial) {
          const prior = seasonMap.get(teamKey);
          seasonMap.set(teamKey, {
            metrics: info.touchedMetrics[teamKey] ?? prior?.metrics ?? {},
            matchDelta: (prior?.matchDelta ?? 0) + teamMatches.length,
          });
        }
      }

      if (isOfficial) touchedTeamsByAlgorithm.set(compositeKey, seasonMap);
    }
  } catch {
    // Best-effort: state already advanced; some artifacts may lag.
  }

  return { status: "advanced", eventComplete };
}

// ---------------------------------------------------------------------------
// The slower-cadence global rebuild
// ---------------------------------------------------------------------------

/** One record-form teams-row metric entry, as `runGlobalRebuild` holds it. */
type TierableTeamMetric = { value: number; spread?: number; percentile?: number; tier?: "rare" | "epic" | "legendary" };

/**
 * The metrics record `runGlobalRebuild` writes for a touched teams row, so a
 * live update never paints a false Common on a team the last publish tiered.
 *
 * - Each fresh entry keeps the prior row's published `tier` for that key; a
 *   key the prior row lacks gets no tier, and "common" is never written.
 * - The prior `SIGMA_METRIC_KEY` entry is carried forward unchanged, since
 *   the live tick computes no season-final Sigma Score.
 *
 * Full tier re-derivation was measured too costly for the CPU budget.
 * Limitation: a touched team that crossed a tier cut keeps its old tier until
 * the next offline publish, other rows are not re-ranked, and a team with no
 * prior row gets no tier.
 */
export function touchedTeamsRowMetrics(
  priorMetrics: Readonly<Record<string, TierableTeamMetric>> | undefined,
  freshMetrics: Readonly<Record<string, TeamMetric>>
): Record<string, TierableTeamMetric> {
  const result: Record<string, TierableTeamMetric> = {};
  for (const [key, metric] of Object.entries(freshMetrics)) {
    const priorTier = priorMetrics?.[key]?.tier;
    result[key] = priorTier !== undefined ? { ...metric, tier: priorTier } : metric;
  }
  // Appended after the fresh entries (a fresh entry of the same key wins), so
  // Sigma keeps publish.ts's position at the end of the record.
  for (const key of [SIGMA_METRIC_KEY]) {
    const carried = priorMetrics?.[key];
    if (carried !== undefined && !(key in result)) result[key] = carried;
  }
  return result;
}

/** One prior published event/team-season metric entry. Never a `tier`: that is teams-row-only; these artifacts publish `percentile`. */
type PublishedEventTeamMetric = { value: number; spread?: number; percentile?: number };

/**
 * The metrics record the event and team-season merges write for a touched
 * team: fresh entries rounded, then the prior `SIGMA_METRIC_KEY` entry
 * appended when the fresh record lacks it, so a live tick never strips a
 * published Sigma Score.
 *
 * Known limitation: a touched team's other metrics lose their `percentile`
 * on a live tick; the Worker computes none.
 */
export function touchedEventTeamMetrics(
  priorMetrics: Readonly<Record<string, PublishedEventTeamMetric>> | undefined,
  freshMetrics: Readonly<Record<string, TeamMetric>>
): Record<string, PublishedEventTeamMetric> {
  const result: Record<string, PublishedEventTeamMetric> = roundTeamMetricRecord(freshMetrics);
  const carried = priorMetrics?.[SIGMA_METRIC_KEY];
  if (carried !== undefined && !(SIGMA_METRIC_KEY in result)) {
    result[SIGMA_METRIC_KEY] = carried;
  }
  return result;
}

/**
 * The slower-cadence rebuild. `TeamsArtifactSchema` decodes either shape on
 * R2 into record-form `metrics`; every write re-encodes positionally, which
 * keeps a live event from corrupting the season's teams artifact.
 */
async function runGlobalRebuild(env: Env, budget: SubrequestBudget, algorithmModules: ReadonlyMap<string, AlgorithmModule<any>>, touchedTeamsByAlgorithm: ReadonlyMap<string, Map<string, TouchedTeamInfo>>, stamp: Stamp): Promise<boolean> {
  if (touchedTeamsByAlgorithm.size === 0) return true; // trigger fired, nothing to merge — a legitimate no-op "ran"

  for (const [compositeKey, teamInfos] of touchedTeamsByAlgorithm) {
    if (teamInfos.size === 0) continue;
    const separatorIndex = compositeKey.lastIndexOf("::");
    const algorithmId = compositeKey.slice(0, separatorIndex);
    const season = Number(compositeKey.slice(separatorIndex + 2));
    const algorithm = algorithmModules.get(algorithmId);
    if (!algorithm) continue;

    const params = { page: "teams" as const, year: season, algorithmId, version: algorithm.version };

    let existing: TeamsArtifact | undefined;
    try {
      const text = await readArtifactObject(env, budget, artifactKey(params));
      existing = text === undefined ? undefined : TeamsArtifactSchema.parse(JSON.parse(text));
    } catch {
      return false; // budget exhausted or read failure — defer the whole rebuild
    }

    const existingRows = existing?.teams ?? [];
    const touchedKeys = new Set(teamInfos.keys());
    const rows = [
      ...existingRows.filter((row) => !touchedKeys.has(row.teamKey)),
      ...[...teamInfos.entries()].map(([teamKey, info]) => {
        const prior = existingRows.find((row) => row.teamKey === teamKey);
        // Leading spread keeps publisher-owned optional fields (`country`,
        // `stateProv`, `districtKey`); tick-owned fields stay listed below.
        return {
          ...prior,
          teamKey,
          teamNumber: prior?.teamNumber ?? fallbackTeamNumber(teamKey),
          nickname: prior?.nickname ?? "",
          // Not updated here (known stub); preserved from the last publish.
          record: prior?.record ?? { wins: 0, losses: 0, ties: 0 },
          metrics: touchedTeamsRowMetrics(prior?.metrics, roundTeamMetricRecord(info.metrics)),
          eventCount: prior?.eventCount ?? 0,
          matchCount: (prior?.matchCount ?? 0) + info.matchDelta,
        };
      }),
    ];

    // Re-encode positionally: `rows` is always record-form.
    const metricKeys = deriveMetricKeyOrder(rows.map((row) => row.metrics));
    const candidate = {
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: stamp.generation,
      computedAt: stamp.computedAt,
      algorithmId,
      algorithmVersion: algorithm.version,
      season,
      metricKeys,
      teams: rows.map((row) => ({ ...row, metrics: encodeTeamsRowMetrics(row.metrics, metricKeys) })),
    };
    try {
      const result = await writeArtifactObject(env, budget, "teams", params, candidate);
      if (result.deferred) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// runTick / scheduled
// ---------------------------------------------------------------------------

/** The fixed-interval trigger for the global rebuild — the other trigger is an event completing its last scheduled match this tick. */
export const GLOBAL_REBUILD_INTERVAL_MS = 10 * 60 * 1000;

export interface RunTickDeps {
  readonly nowMs?: number;
  readonly globalRebuildIntervalMs?: number;
  /** Test-only: lets a test count `buildAlgorithmModules` calls to assert one construction per tick. */
  readonly buildAlgorithmModules?: (algorithmsManifest: AlgorithmsManifest, liveAlgorithmIds: readonly string[]) => Map<string, AlgorithmModule<any>>;
  /** Test-only override of `SubrequestBudget`'s cap/reserve, for driving deferral and budget-exhaustion paths deterministically. Defaults to the production values. */
  readonly subrequestCap?: number;
  readonly subrequestReserve?: number;
}

export interface TickResult {
  readonly eventsConsidered: number;
  readonly eventsAdvanced: number;
  readonly eventsDeferred: number;
  readonly eventsFailed: number;
  readonly tbaRequests: number;
  readonly subrequestsUsed: number;
  readonly globalRebuildRan: boolean;
}

export async function runTick(env: Env, deps: RunTickDeps = {}): Promise<TickResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const globalRebuildIntervalMs = deps.globalRebuildIntervalMs ?? GLOBAL_REBUILD_INTERVAL_MS;
  const stamp: Stamp = { generation: `tick-${nowMs}`, computedAt: nowIso };

  // Unset deps pass `undefined`, which resolves to the production defaults.
  const budget = new SubrequestBudget(deps.subrequestCap, deps.subrequestReserve);
  const counter = new TbaRequestCounter();
  const tbaCtx = createTbaContext(env, counter);

  // Parsed on every tick, idle ones included, so a misconfigured deploy
  // surfaces within a minute.
  const liveAlgorithmIds = parseLiveAlgorithmIds(env.LIVE_ALGORITHM_IDS);

  // The one read that answers "is anything live"; an idle tick (the common
  // case) exits here with zero TBA requests. Keep `loadLiveEventsAt`; see
  // its header in `liveWindows.ts`.
  budget.consume(1);
  const liveEvents = await loadLiveEventsAt(env, nowMs);

  if (liveEvents.length === 0) {
    return { eventsConsidered: 0, eventsAdvanced: 0, eventsDeferred: 0, eventsFailed: 0, tbaRequests: counter.total, subrequestsUsed: budget.used, globalRebuildRan: false };
  }

  // Something is live: load the algorithms manifest and build the modules once for the tick.
  budget.consume(1);
  const algorithmsManifest = await loadAlgorithmsManifest(env);
  const buildModules = deps.buildAlgorithmModules ?? buildAlgorithmModules;
  const algorithmModules = buildModules(algorithmsManifest, liveAlgorithmIds);

  budget.consume(1);
  const meta = await readTickMeta(env.DB);

  const orderedEventKeys = rotate(sortEventKeys(liveEvents.map((w) => w.eventKey)), meta.rotationOffset);
  const liveEventByKey = new Map(liveEvents.map((w) => [w.eventKey, w]));

  let eventsConsidered = 0;
  let eventsAdvanced = 0;
  let eventsDeferred = 0;
  let eventsFailed = 0;
  let anEventJustCompleted = false;
  const touchedTeamsByAlgorithm = new Map<string, Map<string, TouchedTeamInfo>>();

  for (const eventKey of orderedEventKeys) {
    const window = liveEventByKey.get(eventKey);
    if (!window) continue;

    const outcome = await processEvent(env, budget, tbaCtx, algorithmModules, window, nowIso, stamp, touchedTeamsByAlgorithm);
    if (outcome.status === "unchanged") continue; // considered, but not counted toward advanced/deferred/failed

    eventsConsidered++;
    if (outcome.status === "advanced") {
      eventsAdvanced++;
      if (outcome.eventComplete) anEventJustCompleted = true;
    } else if (outcome.status === "deferred") {
      eventsDeferred++;
    } else {
      eventsFailed++;
    }
  }

  const intervalElapsed = nowMs - meta.lastGlobalRebuildAtMs >= globalRebuildIntervalMs;
  let globalRebuildRan = false;
  if (intervalElapsed || anEventJustCompleted) {
    globalRebuildRan = await runGlobalRebuild(env, budget, algorithmModules, touchedTeamsByAlgorithm, stamp);
  }

  const newMeta: TickMeta = {
    rotationOffset: orderedEventKeys.length > 0 ? (meta.rotationOffset + eventsAdvanced) % orderedEventKeys.length : 0,
    lastGlobalRebuildAtMs: globalRebuildRan ? nowMs : meta.lastGlobalRebuildAtMs,
  };
  if (budget.tryConsume(1)) {
    await writeTickMeta(env.DB, newMeta, nowIso);
  }

  return { eventsConsidered, eventsAdvanced, eventsDeferred, eventsFailed, tbaRequests: counter.total, subrequestsUsed: budget.used, globalRebuildRan };
}

/**
 * One structured JSON line per invocation, so an idle tick is distinguishable
 * from a cron that never fires and Workers Observability can filter on
 * fields. Counts and durations only, never a key, artifact body or TBA response.
 */
export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const startedMs = Date.now();
    ctx.waitUntil(
      runTick(env).then(
        (result) => {
          console.log(JSON.stringify({ msg: "tick", ok: true, durationMs: Date.now() - startedMs, ...result }));
        },
        (error: unknown) => {
          // A rejected waitUntil is otherwise swallowed silently. Log for the
          // operator, rethrow so the dashboard records the failure.
          console.error(
            JSON.stringify({
              msg: "tick",
              ok: false,
              durationMs: Date.now() - startedMs,
              error: error instanceof Error ? error.message : String(error),
            })
          );
          throw error;
        }
      )
    );
  },
} satisfies ExportedHandler<Env>;
