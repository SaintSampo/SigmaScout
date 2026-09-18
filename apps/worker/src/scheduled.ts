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
 * PLAYED ROWS go through the offline publisher's own shared builders
 * (`publishedRows.ts`'s `eventPlayedRow`/`teamSeasonPlayedRow`), so a live row
 * and the republished row for the same match agree by construction rather
 * than by intention. TBA's reported time, the youtube video key and the
 * actual per-bonus flags all come from the tick's own poll: the flags reuse
 * the breakdown Phase A's RP fold already parsed (`observedBonusSides`), so
 * the common path pays no second parse, and only a live tier with no
 * RP-publishing algorithm parses in Phase B. With no TBA-reported time the
 * row keeps the value already published for that match, or carries no
 * `sortTime` key — never the window-start approximation (260915-isq). A
 * failed event-detail fetch leaves the event RP-ineligible, so the flags
 * publish `null` ("not derivable"), which heals at the next republish.
 * `coldStart` is corpus-global (`corpusColdStartIndex`) and is therefore
 * NEVER published live; it is the one tested exception to row parity.
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
import { tbaMatchListSchema, type TbaMatch } from "../../../packages/ingest/schemas.js";
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
import { type ParsedBonusSides } from "../../../packages/harness/publishedRows.js";
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
  PAGE_ARTIFACT_SCHEMA_VERSION,
  TeamsArtifactSchema,
  type LiveEventArtifact,
  type TeamsArtifact,
} from "../../../packages/harness/pageArtifacts.js";
import { roundMetric, roundPmf, roundProbability, roundTo, ROUNDING_RULE } from "../../../packages/harness/rounding.js";
import { PUBLISHED_ALGORITHM_IDS, type AlgorithmsManifest, type LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import { loadAlgorithmsManifest, loadLiveEventsAt } from "./liveWindows.js";
// Phase B's merge path, extracted so the read-only state probe can price it by
// calling these very functions (see `artifactMerge.ts`'s header). The edge runs
// one way only: the tick imports the merge, never the reverse.
import {
  fallbackTeamNumber,
  mergeEventArtifact,
  mergeTeamSeasonArtifact,
  playedRowFactsFor,
  roundTeamMetricRecord,
  touchedEventTeamMetrics,
  type MatchBand,
  type PlayedRowFacts,
  type Stamp,
} from "./artifactMerge.js";
import { checkLiveEventArtifactShape } from "./artifactShapeCheck.js";
import { ArtifactReadBudgetExhaustedError, ArtifactSecretLeakError, readArtifactObject, readLiveSidecarObject, writeArtifactObject, writeLiveSidecarObject } from "./artifactWriter.js";
import { LIVE_METRIC_SIDECAR_BYTE_CEILING, mergeLiveMetricSidecar } from "../../../packages/harness/liveMetricSidecar.js";
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
// Artifact merge: read the existing published object (if any) and apply only
// what THIS tick changed — never a full corpus-based rebuild (the Worker has
// no corpus access at all).
//
// The merge itself now lives in `./artifactMerge.js`, so the read-only state
// probe can price Phase B through the tick's own functions without pulling a
// write helper into its import graph. These re-exports keep the symbols
// importable from `./scheduled.js`, which is where the merge-parity tests
// (`scheduled.mergePreservation`, `scheduled.officialRecord`,
// `scheduled.rowParity`, `scheduled.test`) reach for them.
// ---------------------------------------------------------------------------

export { mergeEventArtifact, mergeTeamSeasonArtifact, playedRowFactsFor, touchedEventTeamMetrics };
export type { PlayedRowFacts };

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
  /**
   * The per-side `bonusFlags` this algorithm's Phase A RP fold ALREADY parsed
   * out of each newly-folded match's breakdown, by match key; a side whose
   * parse threw is `undefined`. A pure pass-through of a value the fold
   * computed anyway, so Phase B publishes the actual bonus flags without a
   * second breakdown parse against the tick's CPU budget. Empty for an
   * algorithm that publishes no ranking points (it never parses), in which
   * case Phase B falls back to parsing.
   */
  readonly observedBonusSides: ReadonlyMap<string, ParsedBonusSides>;
}

/**
 * THE READ PATH IS STRUCTURAL, NOT SCHEMA-VALIDATING, since 260915-t7o's fix
 * F2. `artifactShapeCheck.ts` holds the whole argument for that trade; the two
 * facts that matter at this call site are (a) the object was already schema-
 * validated by whichever writer put it in R2, so a read-side parse was a
 * SECOND validation of the same bytes, and (b) `writeArtifactObject`'s own
 * `schema.parse` is retained, so nothing malformed can still reach R2.
 *
 * The "corrupt artifact -> `undefined` -> bootstrap merge" contract is
 * unchanged: both guards return `undefined` for an object their merge cannot
 * survive, and `JSON.parse` failures are caught here exactly as before. What a
 * guard can no longer catch — a bad ROW inside a well-shaped artifact — now
 * surfaces at the write instead, which is what
 * `writeArtifactWithBootstrapRetry` below exists to handle.
 */
async function readExistingEvent(
  env: Env,
  budget: SubrequestBudget,
  params: { page: "event"; eventKey: string; algorithmId: string; version: string }
): Promise<{ artifact: LiveEventArtifact | undefined; bytes: number }> {
  const text = await readArtifactObject(env, budget, artifactKey(params));
  if (text === undefined) return { artifact: undefined, bytes: 0 };
  // `bytes` is the FETCHED body's own length, returned alongside the guarded
  // artifact because this function already holds the text and `.length` is
  // free. `mergeEventArtifact`'s live-block size trim is priced off it
  // (260918-16t) precisely so the guard costs no second stringify. It is
  // returned even when the guard rejects the object: the bytes are a fact
  // about what was in R2, not about whether it parsed.
  const bytes = text.length;
  try {
    return { artifact: checkLiveEventArtifactShape(JSON.parse(text)), bytes };
  } catch {
    return { artifact: undefined, bytes }; // unparseable JSON -- degrade to a fresh bootstrap rather than fail the event
  }
}

/** A `console.warn`ed error message is bounded here: a zod issue list over a large artifact is long, and a log line is not a debugger. Ids and counts carry the diagnosis; the message only points at it. */
const WRITE_RETRY_ERROR_MESSAGE_MAX = 300;

/**
 * `writeArtifactObject`, plus the degrade-to-bootstrap behaviour the read-side
 * schema parse used to provide (260915-t7o fix F2).
 *
 * WHY THIS IS NOT OPTIONAL. `LiveEventArtifactSchema` has no `.catch`
 * anywhere in it. Before F2, a corrupt published artifact failed the READ
 * parse, the read helper returned `undefined`, and the tick published a
 * fresh bootstrap — self-healing on the next tick. After F2 a corruption the
 * structural guard does not see (a bad row inside a well-shaped artifact)
 * survives the read, rides the merge, and throws in `writeArtifactObject`,
 * where `runPhaseBAndReport`'s blanket catch swallows it. That event would then
 * stop publishing PERMANENTLY, every tick, with the same object read back each
 * time. Re-running the merge with no existing artifact restores the old
 * outcome at the new detection point.
 *
 * SINCE 260917-jr4 ONLY `"event"` REACHES HERE. The team half of Phase B is
 * gone — there are no team-artifact reads or writes on the live path at all
 * (see `writeLiveMetricSidecar`). The `"team"` branch of the signature is kept
 * because it costs nothing and the argument above applies identically to any
 * page kind this helper is ever pointed at again; it is NOT evidence that the
 * tick still writes one.
 *
 * TWO FAILURES ARE DELIBERATELY NOT RETRIED:
 *   - one where the budget was consumed, i.e. the R2 `put` itself failed. A
 *     retry there would consume a SECOND subrequest for one artifact and break
 *     the per-tick accounting `scheduled.rp.test.ts` pins. Validation
 *     runs before `budget.tryConsume`, so an unconsumed budget is an exact
 *     witness that the failure was pre-put.
 *   - `ArtifactSecretLeakError`. A bootstrap merge is not the remedy for a
 *     leaked secret, and re-serializing is not worth the chance of writing it.
 *
 * The log line carries the artifact key, the algorithm id and a truncated
 * error message only — never an artifact body, a TBA value or an env value,
 * matching `event-state-block-invalid`'s existing rule.
 */
async function writeArtifactWithBootstrapRetry(
  env: Env,
  budget: SubrequestBudget,
  page: "event" | "team",
  params: { page: "event"; eventKey: string; algorithmId: string; version: string } | { page: "team"; teamKey: string; year: number; algorithmId: string; version: string },
  merged: unknown,
  algorithmId: string,
  rebuildAsBootstrap: () => unknown
): Promise<void> {
  const usedBefore = budget.used;
  try {
    await writeArtifactObject(env, budget, page, params, merged);
    return;
  } catch (error) {
    if (budget.used !== usedBefore) throw error; // the put itself failed -- a retry would double-consume
    if (error instanceof ArtifactSecretLeakError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      JSON.stringify({
        msg: "artifact-write-schema-retry",
        page,
        key: artifactKey(params),
        algorithmId,
        error: message.slice(0, WRITE_RETRY_ERROR_MESSAGE_MAX),
      })
    );
  }
  // Outside the catch: a throw HERE is a genuine failure of the bootstrap
  // itself and belongs to the caller's blanket catch, not to a third attempt.
  await writeArtifactObject(env, budget, page, params, rebuildAsBootstrap());
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

/**
 * The whole event's remaining subrequest cost, estimated up front so the
 * event is all-or-nothing.
 *
 * `2 + 6A`, FLAT IN THE TOUCHED-TEAM COUNT since quick task 260917-jr4. The
 * old form was `2 + 4A + 2A(1 + T)` — the `2AT` term was Phase B reading and
 * rewriting one whole team-season artifact per touched team per algorithm.
 * That loop is gone; Phase B now writes ONE small ephemeral sidecar per
 * algorithm-event instead (`packages/harness/liveMetricSidecar.ts`), and the
 * browser derives everything else from files the robot page already fetches.
 *
 * `touchedTeamCount` LEFT THE SIGNATURE deliberately rather than being kept
 * and ignored: a parameter the formula does not read is an invitation to pass
 * a number and believe it mattered. If a per-team term ever returns, it must
 * come back as an argument a caller has to supply on purpose.
 *
 * `A=1` (the tracked spr-only live tier) is 8; `A=3` is 20. Against the ~41
 * subrequests actually usable per tick that turns "about one event per tick"
 * into "about five" — and it means the subrequest argument no longer
 * constrains the live tier at all. The live tier's remaining justification is
 * the CPU budget; `liveAlgorithmTier.test.ts` says so where it used to cite
 * the subrequest counterfactual.
 */
export function estimateEventSubrequestCost(algorithmCount: number): number {
  return (
    1 /* claim (cursor CAS) */ +
    1 /* event-detail fetch */ +
    algorithmCount * 2 /* Phase A: read + write, per algorithm */ +
    algorithmCount * 2 /* Phase B: the event artifact, read + write, per algorithm */ +
    algorithmCount * 2 /* Phase B: the live metric sidecar, read + write, per algorithm */
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

    // Flat in the touched-team count since 260917-jr4: Phase B's per-team
    // artifact loop is gone, so no team count (real or raw) sizes this at all.
    const algorithmCount = algorithmModules.size;
    const estimatedCost = estimateEventSubrequestCost(algorithmCount);
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

        /**
         * The per-side `bonusFlags` `foldObservedRp` below already parsed, by
         * match key — a pure pass-through to Phase B's `playedRowFactsFor`, so
         * publishing the actual bonus flags costs no second breakdown parse
         * against the tick's CPU budget. Nothing about the fold changes.
         */
        const observedBonusSides = new Map<string, ParsedBonusSides>();

        /** Folds one played match's OBSERVED threshold variables — the exact mirror of `SigmaScoutLayer.#foldObservedThresholds`, including its degrade-to-a-counted-skip try/catch. */
        const foldObservedRp = (result: MatchResult): void => {
          if (rp === undefined || rpRuleModule === undefined) return;
          if (!isRpEligibleEventType(result.eventType)) return;
          if (!result.hasScoreBreakdown || result.scoreBreakdownRaw === null) return;
          let redBonusFlags: Readonly<Record<string, boolean>> | undefined;
          let blueBonusFlags: Readonly<Record<string, boolean>> | undefined;
          for (const side of ["red", "blue"] as const) {
            try {
              const parsed = rpRuleModule.parse(JSON.parse(result.scoreBreakdownRaw), side, result.eventType);
              // Captured BEFORE the fold, so a throwing fold cannot lose flags
              // the offline publisher would still have published.
              if (side === "red") redBonusFlags = parsed.bonusFlags;
              else blueBonusFlags = parsed.bonusFlags;
              rp.fold(side === "red" ? result.redTeams : result.blueTeams, parsed.thresholdVariables);
            } catch {
              // A breakdown this season's module cannot parse contributes
              // nothing rather than failing the tick.
            }
          }
          observedBonusSides.set(result.matchKey, { red: redBonusFlags, blue: blueBonusFlags });
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

        perAlgorithm.set(algorithmId, { algorithm, newPredictions, touchedMetrics, newBands, touchedSigma, writtenRows: changedRows, observedBonusSides });
      }

      return await runPhaseBAndReport(env, budget, window, eventKey, eventType, fetchedEventType, rawMatches, newlyFolded, newlyFoldedResults, stillUpcoming, touchedTeams, realTouchedTeams, perAlgorithm, touchedTeamsByAlgorithm, stamp, stillUpcoming.length === 0);
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

/**
 * Phase B's team half since 260917-jr4: ONE small ephemeral sidecar per
 * algorithm-event carrying each newly-folded match's per-team post-match
 * metrics, in place of reading and rewriting one whole team-season artifact
 * per touched team. `packages/harness/liveMetricSidecar.ts` holds the shape,
 * the lifecycle and the argument for why this can never be read as published
 * data; this function is only the tick's side of it.
 *
 * THE READ'S TWO FAILURE MODES ARE NOT THE SAME FAILURE, and conflating them
 * would lose data (D-04):
 *
 * - `undefined` — a genuine miss (the first fold at this event) or a shape
 *   the schema rejected. BOTH bootstrap a fresh sidecar. For a corrupt
 *   sidecar that is the correct self-healing outcome and matches the artifact
 *   read path's own contract.
 * - `ArtifactReadBudgetExhaustedError` — the budget could not afford the read
 *   at all, so the sidecar's CURRENT CONTENTS ARE UNKNOWN. Bootstrapping here
 *   would discard every row the event has accumulated. The write is skipped
 *   entirely for this tick instead, logged, and caught LOCALLY so the
 *   remaining algorithms still get their Phase B.
 *
 * A FAILED WRITE IS PERMANENT FOR THOSE MATCHES and that is accepted: the
 * event cursor has already advanced, so they will never be folded again. What
 * the page then shows is a GAP in the metric-history chart for those matches
 * and nothing else wrong — `endOfEventMetrics` and `officialSnapshotRow` both
 * take the LAST matching row, so later rows still carry correct tiles — and
 * it self-heals at the next republish. It is logged under a named message
 * rather than left silent.
 *
 * Log lines carry ids, counts and lengths only, never a body.
 */
async function writeLiveMetricSidecar(params: {
  env: Env;
  budget: SubrequestBudget;
  eventKey: string;
  season: number;
  algorithmId: string;
  algorithmVersion: string;
  realTouchedTeams: readonly string[];
  newlyFoldedResults: readonly MatchResult[];
  touchedMetrics: Record<string, Record<string, TeamMetric>>;
  touchedSigma: ReadonlyMap<string, number>;
  computedAt: string;
  complete: boolean;
}): Promise<void> {
  const { env, budget, eventKey, season, algorithmId, algorithmVersion, realTouchedTeams, newlyFoldedResults, touchedMetrics, touchedSigma, computedAt, complete } = params;
  const keyParams = { eventKey, algorithmId, version: algorithmVersion };

  // The tick's own end-of-tick values, read ONCE per team — which is exactly
  // why two matches folded in one tick share one metrics record (D-04, the
  // preserved flaw `mergeTeamSeasonArtifact` already had).
  const valuesByTeam = new Map<string, Record<string, number>>();
  const metricKeySet = new Set<string>();
  for (const teamKey of realTouchedTeams) {
    const values: Record<string, number> = {};
    for (const [key, metric] of Object.entries(touchedMetrics[teamKey] ?? {})) {
      values[key] = metric.value;
      metricKeySet.add(key);
    }
    const sigma = touchedSigma.get(teamKey);
    if (sigma !== undefined) {
      // An ORDINARY member of the header, never a special case in the
      // encoding — `sigmaScore.ts`'s own rule, applied here.
      values[SIGMA_METRIC_KEY] = sigma;
      metricKeySet.add(SIGMA_METRIC_KEY);
    }
    valuesByTeam.set(teamKey, values);
  }
  // Sorted, so the header a later tick computes for the same algorithm is
  // byte-identical and the drift guard fires only on a REAL key-set change.
  const metricKeys = [...metricKeySet].sort();

  const realTouched = new Set(realTouchedTeams);
  const rows = newlyFoldedResults.map((match) => ({
    matchKey: match.matchKey,
    teamKeys: [...match.redTeams, ...match.blueTeams].filter((teamKey) => realTouched.has(teamKey)),
    valuesByTeam,
  }));

  let existing;
  try {
    existing = await readLiveSidecarObject(env, budget, keyParams);
  } catch (error) {
    if (error instanceof ArtifactReadBudgetExhaustedError) {
      console.warn(JSON.stringify({ msg: "live-sidecar-read-deferred", eventKey, algorithmId, rows: rows.length }));
      return;
    }
    throw error;
  }

  const { sidecar, keySetDrifted } = mergeLiveMetricSidecar({ existing, eventKey, season, algorithmId, algorithmVersion, computedAt, complete, metricKeys, rows });
  if (keySetDrifted) {
    console.warn(JSON.stringify({ msg: "live-sidecar-key-set-drift", eventKey, algorithmId, storedKeys: existing?.metricKeys.length ?? 0, computedKeys: metricKeys.length, droppedRows: existing?.rows.length ?? 0 }));
  }

  try {
    const { deferred, bytes } = await writeLiveSidecarObject(env, budget, keyParams, sidecar);
    if (deferred) {
      console.warn(JSON.stringify({ msg: "live-sidecar-write-deferred", eventKey, algorithmId, rows: rows.length }));
      return;
    }
    if (bytes > LIVE_METRIC_SIDECAR_BYTE_CEILING) {
      // WARN ONLY — never a throw and never a truncation. A throw loses this
      // tick's rows permanently and truncation would punch a silent hole in
      // the chart; see the ceiling constant's own doc comment.
      console.warn(JSON.stringify({ msg: "live-sidecar-over-ceiling", eventKey, algorithmId, bytes, ceiling: LIVE_METRIC_SIDECAR_BYTE_CEILING, rows: sidecar.rows.length }));
    }
  } catch (error) {
    console.warn(JSON.stringify({ msg: "live-sidecar-write-failed", eventKey, algorithmId, rows: rows.length, error: (error instanceof Error ? error.message : String(error)).slice(0, WRITE_RETRY_ERROR_MESSAGE_MAX) }));
  }
}

/** Phase B: best-effort artifact writes, kept out of Phase A's claim-reverting try/catch. A Phase B failure leaves the event "advanced" (state did advance); a skipped artifact stays stale until the team's next match at this event.
 *
 * `touchedTeams` (raw) feeds only the event standings; `realTouchedTeams`
 * scopes the live metric sidecar's rows (260917-jr4 — it used to scope
 * `team/{teamKey}/{year}` writes, which this tick no longer makes at all).
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
  rawMatches: readonly TbaMatch[],
  newlyFolded: readonly CorpusMatch[],
  newlyFoldedResults: readonly MatchResult[],
  stillUpcoming: readonly CorpusMatch[],
  touchedTeams: readonly string[],
  realTouchedTeams: readonly string[],
  perAlgorithm: ReadonlyMap<string, PerAlgorithmFold>,
  touchedTeamsByAlgorithm: Map<string, Map<string, TouchedTeamInfo>>,
  stamp: Stamp,
  eventComplete: boolean
): Promise<EventOutcome> {
  try {
    // Algorithm-independent, so computed ONCE for the whole tick. The bonus
    // flags reuse whatever breakdown Phase A already parsed (any algorithm's
    // capture will do — they describe the match, not the model); only a tier
    // with no RP-publishing algorithm falls back to parsing here.
    const observedBonusSides = new Map<string, ParsedBonusSides>();
    for (const info of perAlgorithm.values()) {
      for (const [matchKey, sides] of info.observedBonusSides) {
        if (!observedBonusSides.has(matchKey)) observedBonusSides.set(matchKey, sides);
      }
    }
    const playedRowFacts = playedRowFactsFor(window.season, rawMatches, newlyFolded, newlyFoldedResults, observedBonusSides);

    for (const [algorithmId, info] of perAlgorithm) {
      const eventParams = { page: "event" as const, eventKey, algorithmId, version: info.algorithm.version };
      const { artifact: existingEvent, bytes: existingEventBytes } = await readExistingEvent(env, budget, eventParams);
      // Held as one object so the bootstrap retry below re-runs THIS merge with
      // `existing: undefined` and nothing else changed -- a second parameter
      // list would be a second thing to keep in sync.
      const eventMergeParams = {
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
        playedRowFacts,
        // The live block's three inputs (260918-16t). `realTouchedTeams`
        // scopes its rows, `touchedSigma` joins its header as an ordinary
        // metric key, and `existingEventBytes` is the fetched body's own
        // length, which prices the size trim with no second stringify.
        realTouchedTeams,
        touchedSigma: info.touchedSigma,
        existingBodyBytes: existingEventBytes,
        stamp,
      };
      const mergedEvent = mergeEventArtifact(eventMergeParams);
      await writeArtifactWithBootstrapRetry(env, budget, "event", eventParams, mergedEvent, algorithmId, () =>
        mergeEventArtifact({ ...eventMergeParams, existing: undefined })
      );

      // Only the `teams/{year}` feed is gated on officialness; the sidecar
      // write below stays unconditional, exactly as the team-artifact write
      // it replaces did.
      const isOfficial = isOfficialEventType(eventType);
      const compositeKey = touchedTeamsCompositeKey(algorithmId, window.season);
      const seasonMap = touchedTeamsByAlgorithm.get(compositeKey) ?? new Map<string, TouchedTeamInfo>();

      // THE LOOP SURVIVED ITS ARTIFACT WORK ON PURPOSE (260917-jr4). Every R2
      // call that used to live here — `readExistingTeam`,
      // `mergeTeamSeasonArtifact`, `writeArtifactWithBootstrapRetry` — is
      // gone, but `runGlobalRebuild`'s teams-of-the-year feed reads
      // `touchedTeamsByAlgorithm`, and THAT contribution must survive
      // unchanged: still gated on `isOfficial`, still summing
      // `teamMatches.length`. `teamMatches` is still needed for that sum and
      // now needs no artifact read to compute.
      for (const teamKey of realTouchedTeams) {
        if (!isOfficial) continue;
        const teamMatches = newlyFoldedResults.filter((m) => m.redTeams.includes(teamKey) || m.blueTeams.includes(teamKey));
        const prior = seasonMap.get(teamKey);
        seasonMap.set(teamKey, {
          metrics: info.touchedMetrics[teamKey] ?? prior?.metrics ?? {},
          matchDelta: (prior?.matchDelta ?? 0) + teamMatches.length,
        });
      }

      await writeLiveMetricSidecar({
        env,
        budget,
        eventKey,
        season: window.season,
        algorithmId,
        algorithmVersion: info.algorithm.version,
        realTouchedTeams,
        newlyFoldedResults,
        touchedMetrics: info.touchedMetrics,
        touchedSigma: info.touchedSigma,
        computedAt: stamp.computedAt,
        complete: eventComplete,
      });

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
