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
 * NO SUBREQUEST BUDGET (quick task 260923-3w4). Every event used to have its
 * subrequest cost estimated up front and defer whole if it did not fit, and
 * three Phase B operations ran only when a subrequest was left over. All of it
 * existed for the free plan's 50 subrequests per invocation; Workers Paid
 * allows 10,000 and the most expensive tick ever measured here spent 26, so the
 * deferral paths were unreachable code at every call site. `SubrequestCounter`
 * is all that survives, and only to feed the tick log's `subrequestsUsed`.
 *
 * TICK META: the rotation offset lives in `event_cursor` under the sentinel key
 * `TICK_META_EVENT_KEY`, with a JSON blob in `lastFoldedMatchKey`.
 *
 * PER-TEAM ARTIFACTS ARE WRITTEN AGAIN (quick task 260923-3w6, reversing
 * 260917-jr4): one read and one merge-write per touched team per live algorithm,
 * carrying that team's newly-played rows AND its priced upcoming rows for the
 * event. The write is unconditional; only the `teams/{year}` feed is gated on
 * officialness. Known accepted limitation, tracked in
 * `.planning/todos/pending/live-merges-drop-percentiles.md`: a live-merged row
 * carries no percentile number.
 *
 * GLOBAL REBUILD: an incremental merge of the teams this tick touched into the
 * year-wide `teams` table. With no corpus access it is never a from-scratch
 * recompute (that is `pnpm publish:seasons`). Known stub: a `teams/{year}`
 * row's `record` is not updated here, and `events/{year}` is not touched; both
 * stay as of the last offline publish.
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
 * UPCOMING MATCHES ARE PRICED HERE AGAIN (quick task 260923-3w6, reversing
 * 260915-isq). Phase B prices every still-upcoming match through
 * `priceUpcomingRows` — the same function the offline publisher's rows and the
 * web's own pricer go through — from the model Phase A captured at end of fold.
 * The published `sortTime` is the one input that comes off the existing
 * artifact rather than the model; it is never re-derived from TBA's `time`.
 *
 * Between 260915-isq and 260923-3w6 the tick instead wrote schedule-only rows
 * and spliced a `state` block (a verbatim copy of the event's D1 rows) into the
 * artifact for the BROWSER to price from. That existed for one reason — the free
 * plan's 10 ms of CPU per tick — and the block, its splice, its completion read
 * and its two warn lines are all deleted. An artifact still carrying a block
 * from before the reversal has it DROPPED on the next tick.
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
 * NO EPHEMERAL BLOCKS AND NO LIVE ROSTER (quick task 260923-3w6). The tick used
 * to splice two extra objects' worth of data into the event artifact — a `state`
 * block for the browser to price from (260915-isq) and a `live` block of
 * per-match metric rows for the browser to overlay onto a team page (260918-16t)
 * — plus a `v1/live-roster/{eventKey}.json` object so a robot page could DISCOVER
 * an event no publish had ever written (260921-5qw). All three existed because
 * the tick could not afford to write the team artifact itself. It writes it
 * again, so the team page reads its own file: the blocks and the roster object
 * are gone, and an artifact still carrying either block has it dropped on the
 * next write.
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
import { foldsIntoRatings, isOfficialEventType } from "../../../packages/core/algorithms/eventTypes.js";
import type { AlgorithmModule, MatchResult, Prediction, TeamMetric } from "../../../packages/core/algorithms/types.js";
import { tbaMatchListSchema, type TbaMatch } from "../../../packages/ingest/schemas.js";
import { tbaEventSchema } from "../../../packages/ingest/schemas.js";
import { type CorpusMatch } from "../../../packages/ingest/normalize.js";
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
  stateScopeKeys,
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
  type EventArtifact,
  type TeamsArtifact,
  type TeamSeasonArtifact,
} from "../../../packages/harness/pageArtifacts.js";
import { priceUpcomingRows, type PriceUpcomingResult, type ScheduledMatchInput, type UpcomingPricingModel } from "../../../packages/harness/upcomingPricing.js";
import { roundMetric, roundPmf, roundProbability, roundTo, ROUNDING_RULE } from "../../../packages/harness/rounding.js";
import { PUBLISHED_ALGORITHM_IDS, type AlgorithmsManifest, type LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import { loadAlgorithmsManifest, loadLiveEventsAt } from "./liveWindows.js";
// Phase B's merge path, in its own module (see `artifactMerge.ts`'s header for
// why it was extracted and why it stays). The edge runs one way only: the tick
// imports the merge, never the reverse.
import {
  existingUpcomingSortTimes,
  fallbackTeamNumber,
  mergeEventArtifact,
  mergeTeamSeasonArtifact,
  playedRowFactsFor,
  roundTeamMetricRecord,
  touchedEventTeamMetrics,
  type MatchBand,
  type PlayedRowFacts,
  type ScheduledMatchFacts,
  type Stamp,
} from "./artifactMerge.js";
import { checkLiveEventArtifactShape, checkTeamSeasonArtifactShape } from "./artifactShapeCheck.js";
import { ArtifactSecretLeakError, readArtifactObject, writeArtifactObject } from "./artifactWriter.js";
import { readEventCursor, readEventCursors, readScopedStateChunked, scopedStateReadStatements, selectChangedRows, writeEventCursor, writeScopedState, type EventCursor, type ScopeSelection } from "./stateStore.js";
import { splitEventMatches } from "./matchSplit.js";
import { runDistrictRefresh, type DistrictRefreshResult } from "./districtRefresh.js";
import { deriveMatchDerivedEventState, type MatchDerivedEventState } from "./districtEventState.js";
import { TICK_META_EVENT_KEY, stateBaselineEventKey } from "../../../packages/harness/stateBaseline.js";
import { rotate, sortEventKeys, SubrequestCounter } from "./subrequestCounter.js";
import { createTbaContext, pollEventMatches, TbaRequestCounter, type TbaClientContext } from "./tbaPoll.js";
import type { Env } from "./env.js";

// ---------------------------------------------------------------------------
// Tick meta (the rotation offset) plus the per-algorithm state-baseline marker
// (quick task 260920-q75) — read together, in the ONE subrequest this section
// already spent on the sentinel alone. See
// `packages/harness/stateBaseline.ts` for the shared key contract and
// `readEventCursors` (`stateStore.ts`) for why this costs no extra round trip.
// ---------------------------------------------------------------------------

/**
 * One field, deliberately still an object. It carried
 * `lastGlobalRebuildAtMs` until quick task 260923-3w4 deleted the
 * fixed-interval rebuild trigger it gated; the JSON blob shape is kept so a
 * stale value written by an older Worker deserializes to the default instead of
 * failing, and so a second field can return without a migration.
 */
interface TickMeta {
  readonly rotationOffset: number;
}

const DEFAULT_TICK_META: TickMeta = { rotationOffset: 0 };

export interface TickState {
  readonly meta: TickMeta;
  /** This tick's LIVE algorithm ids only (`algorithmModules.keys()`), each mapped to what its `event_cursor` baseline marker holds — `undefined` for a missing row (today's live D1 bootstrap state, or an algorithm never seeded a marker for). */
  readonly baselineGenerationByAlgorithm: ReadonlyMap<string, string | undefined>;
}

/**
 * Replaces the old `readTickMeta`: the SAME one subrequest (`readEventCursors`
 * over a small, fixed key list), now also naming each live algorithm's
 * state-baseline marker key alongside the tick-meta sentinel.
 */
async function readTickState(db: D1Database, algorithmIds: readonly string[]): Promise<TickState> {
  const keys = [TICK_META_EVENT_KEY, ...algorithmIds.map((id) => stateBaselineEventKey(id))];
  const cursors = await readEventCursors(db, keys);

  let meta = DEFAULT_TICK_META;
  const metaCursor = cursors.get(TICK_META_EVENT_KEY);
  if (metaCursor && metaCursor.lastFoldedMatchKey !== null) {
    try {
      const parsed = JSON.parse(metaCursor.lastFoldedMatchKey) as Partial<TickMeta>;
      // An unrecognized field (a pre-260923-3w4 `lastGlobalRebuildAtMs`) is
      // read past, never rejected.
      meta = { rotationOffset: typeof parsed.rotationOffset === "number" ? parsed.rotationOffset : 0 };
    } catch {
      meta = DEFAULT_TICK_META;
    }
  }

  const baselineGenerationByAlgorithm = new Map<string, string | undefined>();
  for (const id of algorithmIds) {
    // A baseline row's `lastFoldedMatchKey` holds a BARE generation string —
    // never JSON (see `stateBaseline.ts`'s header) — so it is read as-is.
    baselineGenerationByAlgorithm.set(id, cursors.get(stateBaselineEventKey(id))?.lastFoldedMatchKey ?? undefined);
  }

  return { meta, baselineGenerationByAlgorithm };
}

async function writeTickMeta(db: D1Database, meta: TickMeta, nowIso: string): Promise<void> {
  await writeEventCursor(db, { eventKey: TICK_META_EVENT_KEY, tbaEtag: null, lastFoldedMatchKey: JSON.stringify(meta), lastPolledAt: null, lastAdvancedAt: nowIso });
}

/** What a state-generation mismatch's one warn line carries — never more than the manifest generation and each live algorithm's own marker (never a TBA value, never an artifact body). */
export interface StateGenerationMismatch {
  readonly manifestGeneration: string;
  /** Per live algorithm id: what its marker actually holds, or `null` for a missing row (never `undefined` — this is serialized straight into the warn line's JSON). */
  readonly markers: Readonly<Record<string, string | null>>;
}

/**
 * `undefined` when every one of `algorithmIds`' markers equals
 * `manifestGeneration` (the healthy, common-case control arm) — otherwise the
 * full picture of what disagreed. Compared for the LIVE tier only
 * (`algorithmModules.keys()`, the ids `runTick` passes in): an algorithm that
 * never folds live cannot desync its state from the cursor, and a partial
 * publish (`--algorithm spr`) must not brick folding for a tier it did not
 * touch. See this quick task's PLAN.md "Design decisions" for why a mismatch
 * on ANY live algorithm suspends the WHOLE tick rather than just that one:
 * `event_cursor` has no per-algorithm granularity, so a partial fold would
 * desync the un-advanced algorithms.
 */
export function detectStateGenerationMismatch(
  manifestGeneration: string,
  algorithmIds: readonly string[],
  baselineGenerationByAlgorithm: ReadonlyMap<string, string | undefined>
): StateGenerationMismatch | undefined {
  const markers: Record<string, string | null> = {};
  let mismatched = false;
  for (const id of algorithmIds) {
    const marker = baselineGenerationByAlgorithm.get(id);
    markers[id] = marker ?? null;
    if (marker !== manifestGeneration) mismatched = true;
  }
  return mismatched ? { manifestGeneration, markers } : undefined;
}

// ---------------------------------------------------------------------------
// Algorithm module construction, once per tick
// ---------------------------------------------------------------------------

/**
 * Every published algorithm folds live (quick task 260923-3w8). This default
 * deliberately EQUALS the tracked `LIVE_ALGORITHM_IDS` in `wrangler.toml`: a
 * deploy that fails to carry tracked vars through would otherwise silently
 * NARROW the tier, and a narrowed tier is invisible — opr and epa would simply
 * stop moving mid-event while the site kept serving them as live, which is
 * exactly the failure the `live-tier-defaulted` warn line exists to make
 * audible rather than to make harmless.
 *
 * The tier was `spr` alone from 260822-wqt to 2026-09-23, held by the free
 * plan's 50-subrequest cap and then by its 10 ms CPU cap; Workers Paid retired
 * both on 2026-09-22 and quick task 260923-3w4 deleted the cap and the deferral
 * machinery it gated. Widening it then cost what it had always cost — opr and
 * epa advance match by match instead of refreshing at the manual event-weekend
 * re-baseline (D-12), which changes numbers the site has already published — and
 * that was paid for by shipping opr 6.0.0 and epa 13.0.0 under Jacob's decision
 * (260923-1tu-FINDINGS.md item C6), not avoided.
 *
 * Exported so the fallback and `liveAlgorithmTier.test.ts` share one default.
 */
export const DEFAULT_LIVE_ALGORITHM_IDS: readonly string[] = [...PUBLISHED_ALGORITHM_IDS];

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
 *    `live-tier-defaulted` warn line. Defaulting to the full published set is
 *    correct BECAUSE that set is what tracked config deploys (see that
 *    constant): a default narrower than the tracked value would answer a
 *    missing binding by quietly publishing stale numbers, which reads as
 *    healthy. Throwing instead would stop freshness over a config omission.
 *    The warn line is how the omission is caught; only the ids are logged,
 *    never another binding value.
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

async function loadOrInitState(
  db: D1Database,
  algorithmId: string,
  selections: readonly ScopeSelection[],
  algorithm: AlgorithmModule<any>,
  coldStartTeamKeys: readonly string[]
) {
  const rows = await readScopedStateChunked(db, algorithmId, selections);
  const hasLeagueRow = rows.some((row) => row.scopeKind === "league");
  // Not yet seeded: cold-start via initState, since deserializeState throws
  // MissingLeagueRowError for this case. initState takes team keys, never
  // the event key, and never a demo key: the selection above reads demo keys,
  // but only so a seeded passenger-only row can be resumed.
  const state: any = hasLeagueRow ? deserializeState(algorithmId, rows) : algorithm.initState([...coldStartTeamKeys]);
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
// The merge itself lives in `./artifactMerge.js`. These re-exports keep the
// symbols importable from `./scheduled.js`, which is where the merge-parity
// tests (`scheduled.mergePreservation`, `scheduled.officialRecord`,
// `scheduled.rowParity`, `scheduled.test`) reach for them.
//
// `mergeTeamSeasonArtifact` IS DELIBERATELY KEPT, and kept exported, even
// though NOTHING on the live path calls it any more (260917-jr4 removed the
// last caller). It is what the successor of quick task 260923-3w4 reinstates
// the tick's per-team artifact write through; see that function's own doc
// comment in `artifactMerge.ts`.
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
  /**
   * This algorithm's END-OF-TICK state and level-2 accumulators, as the shared
   * `priceUpcomingRows` wants them (quick task 260923-3w6). Phase B prices every
   * still-upcoming match from this, which is why Phase A's D1 read covers every
   * team on the remaining schedule and not just the ones a match touched.
   *
   * Captured at the same instant as `touchedMetrics` and `touchedSigma`, after
   * every fold, so an upcoming match is priced from a state that has seen every
   * played match — the offline publisher's own rule.
   */
  readonly upcomingModel: UpcomingPricingModel;
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
  counter: SubrequestCounter,
  params: { page: "event"; eventKey: string; algorithmId: string; version: string }
): Promise<EventArtifact | undefined> {
  const text = await readArtifactObject(env, counter, artifactKey(params));
  if (text === undefined) return undefined;
  // It returned the fetched body's byte length alongside the artifact until quick
  // task 260923-3w6: the `live` block's size trim was priced off it, here rather
  // than in the merge, so the guard cost no second stringify. The block is gone
  // and nothing else ever read the number.
  try {
    return checkLiveEventArtifactShape(JSON.parse(text));
  } catch {
    return undefined; // unparseable JSON -- degrade to a fresh bootstrap rather than fail the event
  }
}

/**
 * The team-season half of the read path, back on the live path with the per-team
 * write (quick task 260923-3w6). Structural, not schema-validating, for exactly
 * the reasons `readExistingEvent` above states — and `checkTeamSeasonArtifactShape`
 * has been sitting in `artifactShapeCheck.ts` waiting for this caller to return.
 */
async function readExistingTeam(
  env: Env,
  counter: SubrequestCounter,
  params: { page: "team"; teamKey: string; year: number; algorithmId: string; version: string }
): Promise<TeamSeasonArtifact | undefined> {
  const text = await readArtifactObject(env, counter, artifactKey(params));
  if (text === undefined) return undefined;
  try {
    return checkTeamSeasonArtifactShape(JSON.parse(text));
  } catch {
    return undefined; // unparseable JSON -- degrade to a fresh bootstrap rather than fail the event
  }
}

/** A `console.warn`ed error message is bounded here: a zod issue list over a large artifact is long, and a log line is not a debugger. Ids and counts carry the diagnosis; the message only points at it. */
const WRITE_RETRY_ERROR_MESSAGE_MAX = 300;

/**
 * `writeArtifactObject`, plus the degrade-to-bootstrap behaviour the read-side
 * schema parse used to provide (260915-t7o fix F2).
 *
 * WHY THIS IS NOT OPTIONAL. `EventArtifactSchema` has no `.catch`
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
 * BOTH `"event"` AND `"team"` REACH HERE AGAIN (quick task 260923-3w6). Between
 * 260917-jr4 and that task only `"event"` did; the argument above is what made the
 * `"team"` branch worth keeping through the gap, and it is now load-bearing for
 * the same reason it was before — one corrupt published team artifact must not
 * stop that team publishing permanently.
 *
 * TWO FAILURES ARE DELIBERATELY NOT RETRIED:
 *   - one where the subrequest was already counted, i.e. the R2 `put` itself
 *     failed. A retry there would spend a SECOND subrequest for one artifact and
 *     break the per-tick accounting `scheduled.rp.test.ts` pins. Validation runs
 *     before `counter.spend`, so an unmoved count is an exact witness that the
 *     failure was pre-put.
 *   - `ArtifactSecretLeakError`. A bootstrap merge is not the remedy for a
 *     leaked secret, and re-serializing is not worth the chance of writing it.
 *
 * The log line carries the artifact key, the algorithm id and a truncated
 * error message only — never an artifact body, a TBA value or an env value. That
 * is the rule every warn line in this file follows.
 */
async function writeArtifactWithBootstrapRetry(
  env: Env,
  counter: SubrequestCounter,
  page: "event" | "team",
  params: { page: "event"; eventKey: string; algorithmId: string; version: string } | { page: "team"; teamKey: string; year: number; algorithmId: string; version: string },
  merged: unknown,
  algorithmId: string,
  rebuildAsBootstrap: () => unknown
): Promise<void> {
  const usedBefore = counter.used;
  try {
    await writeArtifactObject(env, counter, page, params, merged);
    return;
  } catch (error) {
    if (counter.used !== usedBefore) throw error; // the put itself failed -- a retry would double-spend
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
  await writeArtifactObject(env, counter, page, params, rebuildAsBootstrap());
}

// ---------------------------------------------------------------------------
// Per-event processing
// ---------------------------------------------------------------------------

interface TouchedTeamInfo {
  metrics: Record<string, TeamMetric>;
  matchDelta: number;
}

/**
 * `"advanced"` carried an `eventComplete: boolean` until quick task 260923-3w4 —
 * "this event just folded its last scheduled match" — which was one of the two
 * triggers for the global rebuild. The rebuild now runs on every tick that
 * touched a team, so that trigger is subsumed rather than dropped, and the field
 * had no other reader. It is not kept as an unread flag: an outcome field nothing
 * branches on is a claim the next reader has to disprove.
 */
type EventOutcome = { readonly status: "advanced" } | { readonly status: "failed" } | { readonly status: "unchanged" };

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
// Probe windows (260920-lny): a zero-match event's `inferred: true` window
// proves matches exist before anything expensive runs. See
// `packages/harness/manifests.ts`'s `buildLiveWindowsManifest` header and
// `manifestSchemas.ts`'s doc comment on `inferred` for the two-sided
// contract this section implements the Worker's half of.
// ---------------------------------------------------------------------------

/**
 * The result of the two calls a probe (or a foldable event's own preflight)
 * always makes first: the cursor read, then the conditional TBA poll.
 *  - `"not-modified"`: TBA returned 304 — nothing changed since the cursor's etag.
 *  - `"ok"`: a 200, with the RAW (not yet `tbaMatchListSchema`-validated) match
 *    array. A probe reads only `.length` off it — see `runProbes` — so an
 *    idle probe never pays to parse a payload it is about to discard.
 *
 * There is no third `"deferred"` case any more: quick task 260923-3w4 deleted
 * the subrequest budget the two calls used to be gated behind.
 */
export type EventPreflightResult =
  | { readonly status: "not-modified"; readonly cursor: EventCursor }
  | { readonly status: "ok"; readonly cursor: EventCursor; readonly etag: string | undefined; readonly matches: readonly unknown[] };

/**
 * `processEvent`'s own first two calls, extracted so a probe can pay for them
 * ONCE and hand the result to `processEvent` as a preflight — a promoted
 * event is never polled twice. Two subrequests, same as before extraction.
 */
async function eventPreflight(env: Env, counter: SubrequestCounter, tbaCtx: TbaClientContext, eventKey: string): Promise<EventPreflightResult> {
  counter.spend(1);
  const cursor: EventCursor = (await readEventCursor(env.DB, eventKey)) ?? { eventKey, tbaEtag: null, lastFoldedMatchKey: null, lastPolledAt: null, lastAdvancedAt: null };

  counter.spend(1);
  const poll = await pollEventMatches(tbaCtx, eventKey, cursor.tbaEtag ?? undefined);
  if (poll.status === "not-modified") return { status: "not-modified", cursor };
  return { status: "ok", cursor, etag: poll.etag, matches: poll.matches };
}

/** What `runProbes` hands back to `runTick`: promoted events (probe saw real matches — keyed by event key, ready to pass straight into `processEvent` as its preflight) plus the two tallies the tick's tail line reports. A throwing probe is confined to itself and counted in `eventsFailed`, never in `eventsProbed`. */
interface ProbePassResult {
  readonly promoted: ReadonlyMap<string, { readonly cursor: EventCursor; readonly etag: string | undefined; readonly matches: readonly unknown[] }>;
  readonly eventsProbed: number;
  readonly eventsFailed: number;
}

/**
 * Answers liveness for EVERY open `inferred: true` window, EVERY tick, spending
 * ONE cheap conditional TBA request per probe and nothing else — no
 * algorithms-manifest read, no `buildAlgorithmModules`, no D1 batch, no artifact
 * write. Called from `runTick` BEFORE all three of those, and THAT ORDERING IS
 * LOAD-BEARING: moving this pass below them would restore exactly the condition
 * `.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md` cause B
 * describes, where a phantom `inferred: true` window kept the tick on the
 * full, expensive live path.
 *
 * NO PER-TICK CAP AND NO ROTATION SLOT since quick task 260923-3w4. Until then
 * this probed at most `MAX_PROBES_PER_TICK` (6) windows, the slice chosen by a
 * clock-derived offset (`floor(nowMs / 60_000)`), so an offseason weekend with
 * many concurrently-open windows could not spend the free plan's 50-subrequest
 * budget on discovery alone. At 10,000 per invocation the 40 real windows of
 * 2026-09-20's manifest cost 80 subrequests to probe in full, and probing all of
 * them every tick removes the up-to-`ceil(n/6)`-minute discovery lag a
 * just-started offseason event used to sit behind — the lag that missed Chezy
 * Champs 2026 is exactly what this whole pass exists to prevent, so buying the
 * rest of it for 80 subrequests is the point. The order stays sorted for
 * determinism; nothing is sliced off it, so `rotate` is not used here at all.
 *
 *  - A `"not-modified"` (304) preflight ends that probe: nothing changed.
 *  - An `"ok"` preflight whose raw match array is EMPTY ends that probe too,
 *    after writing the cursor's etag back if it changed — `.length` is read off
 *    the raw array; `tbaMatchListSchema` never runs here, so an idle probe
 *    parses nothing.
 *  - An `"ok"` preflight with a NON-empty array promotes: the window and its
 *    already-paid-for preflight are kept for `runTick` to feed straight into
 *    `processEvent`, so a promoted event issues exactly ONE TBA request this
 *    tick, never two.
 *  - A throw is confined to that probe alone, warned as a JSON line carrying
 *    only the event key and the error message (never a TBA key or a header —
 *    this file's standing log rule), and counted as failed rather than probed.
 */
async function runProbes(env: Env, counter: SubrequestCounter, tbaCtx: TbaClientContext, probeWindows: readonly LiveWindowEntry[], nowIso: string): Promise<ProbePassResult> {
  const ordered = sortEventKeys(probeWindows.map((w) => w.eventKey));

  const promoted = new Map<string, { cursor: EventCursor; etag: string | undefined; matches: readonly unknown[] }>();
  let eventsProbed = 0;
  let eventsFailed = 0;

  for (const eventKey of ordered) {
    try {
      const preflight = await eventPreflight(env, counter, tbaCtx, eventKey);

      eventsProbed++;
      if (preflight.status === "not-modified") continue;

      if (preflight.matches.length === 0) {
        if (preflight.etag !== undefined && preflight.etag !== preflight.cursor.tbaEtag) {
          counter.spend(1);
          await writeEventCursor(env.DB, { ...preflight.cursor, tbaEtag: preflight.etag, lastPolledAt: nowIso });
        }
        continue;
      }

      promoted.set(eventKey, { cursor: preflight.cursor, etag: preflight.etag, matches: preflight.matches });
    } catch (err) {
      eventsFailed++;
      console.warn(JSON.stringify({ msg: "probe-failed", eventKey, error: err instanceof Error ? err.message : String(err) }));
    }
  }

  return { promoted, eventsProbed, eventsFailed };
}

async function processEvent(
  env: Env,
  counter: SubrequestCounter,
  tbaCtx: TbaClientContext,
  algorithmModules: ReadonlyMap<string, AlgorithmModule<any>>,
  window: LiveWindowEntry,
  nowIso: string,
  stamp: Stamp,
  touchedTeamsByAlgorithm: Map<string, Map<string, TouchedTeamInfo>>,
  /**
   * The district pass's collector (10-05), threaded exactly as
   * `touchedTeamsByAlgorithm` is — declared in `runTick`, passed in, filled by
   * this callee. Keyed by event key. Only an event whose window carries a
   * `districtKey` ever writes to it.
   */
  matchDerivedState: Map<string, MatchDerivedEventState>,
  /**
   * A probe's already-paid-for `eventPreflight` result (`runProbes`), for a
   * PROMOTED event only. When supplied, `processEvent` counts NO subrequest for
   * the cursor read or the poll and makes NO second TBA request for either —
   * the probe already paid for both. `undefined` for the ordinary (foldable,
   * `inferred: false`) path, which still runs its own preflight exactly as
   * before this parameter existed.
   */
  preflight?: { readonly cursor: EventCursor; readonly etag: string | undefined; readonly matches: readonly unknown[] }
): Promise<EventOutcome> {
  const eventKey = window.eventKey;

  try {
    let cursor: EventCursor;
    let pollEtag: string | undefined;
    let rawMatchesUnknown: readonly unknown[];

    if (preflight) {
      cursor = preflight.cursor;
      pollEtag = preflight.etag;
      rawMatchesUnknown = preflight.matches;
    } else {
      counter.spend(1);
      cursor = (await readEventCursor(env.DB, eventKey)) ?? { eventKey, tbaEtag: null, lastFoldedMatchKey: null, lastPolledAt: null, lastAdvancedAt: null };

      counter.spend(1);
      const poll = await pollEventMatches(tbaCtx, eventKey, cursor.tbaEtag ?? undefined);
      if (poll.status === "not-modified") return { status: "unchanged" };
      pollEtag = poll.etag;
      rawMatchesUnknown = poll.matches;
    }

    const rawMatches = tbaMatchListSchema.parse(rawMatchesUnknown);

    // THE DISTRICT STATE OBSERVATION (10-05), derived from the match list this
    // tick already paid for and placed HERE — above the `newlyFolded.length
    // === 0` return below — on purpose: a category can finish without moving a
    // single match past the cursor. Alliances are selected and nobody's point
    // total changes; a derivation below that return would miss exactly the
    // observation the ledger needs to turn a cell grey.
    //
    // Gated on the window carrying a `districtKey`, which is what keeps every
    // non-district event's behaviour byte-identical and keeps the derivation
    // off the hot path for the overwhelming majority of events.
    if (typeof window.districtKey === "string" && window.districtKey.length > 0) {
      matchDerivedState.set(eventKey, deriveMatchDerivedEventState(rawMatches));
    }
    // The live-windows manifest has no real start_date; this approximation
    // feeds only normalizeMatch's rarely used sortTime fallback.
    const approxStartDateIso = new Date(window.startMs).toISOString();
    // ONE pass that orders the event, resolves the cursor anchor once, and runs
    // the full `normalizeMatch` only on the matches past it (260921-vzf). The
    // cursor an offline seed writes (`event_cursor.last_folded_match_key`) is
    // only meaningful if both sides agree on order — `compareCorpusMatchOrder`,
    // which `splitEventMatches` imports, is the Worker's half of that shared
    // contract with the publisher's own `selectMatchesChronological` (quick
    // task 260920-q75). Output-identical to normalizing everything; see
    // `matchSplit.ts`'s header for what that guarantees and
    // `test/matchSplit.test.ts` for the proof.
    const { orderedMatchKeys, newlyFolded, stillUpcoming } = splitEventMatches(rawMatches, approxStartDateIso, cursor);

    if (newlyFolded.length === 0) {
      // Unconditional since quick task 260923-3w4: this etag write used to sit
      // behind a `tryConsume` so it could never be the call that squeezed out an
      // event's real work. Skipping it costs a full payload on the next poll.
      if (pollEtag !== undefined && pollEtag !== cursor.tbaEtag) {
        counter.spend(1);
        await writeEventCursor(env.DB, { ...cursor, tbaEtag: pollEtag, lastPolledAt: nowIso });
      }
      return { status: "unchanged" };
    }

    const touchedTeams = [...new Set(newlyFolded.flatMap((m) => [...m.redTeams, ...m.blueTeams]))].sort();
    // Demo keys never seed a level-1 `team` row or a team artifact;
    // `touchedTeams` stays raw for the event artifact's standings and for the
    // state READ (see the selection below).
    const realTouchedTeams = touchedTeams.filter((teamKey) => !isDemoTeamKey(teamKey));
    // EVERY TEAM ON THE REMAINING SCHEDULE, whether or not it played this tick
    // (quick task 260923-3w6). Phase B prices the upcoming matches, and the
    // offline rule it must reproduce gives an alliance NO band and the match NO
    // ranking points when any roster team has no Sigma belief. Reading only the
    // touched teams would therefore make a scheduled match price differently
    // live and offline — silently, with a well-formed row either way.
    const scheduledTeams = [...new Set(stillUpcoming.flatMap((m) => [...m.redTeams, ...m.blueTeams]))];
    const stateReadTeamKeys = stateScopeKeys([...touchedTeams, ...scheduledTeams]);
    const lastFoldedMatchKey = newlyFolded[newlyFolded.length - 1]!.matchKey;

    // Claim before any state is read; a lost claim means another invocation
    // is advancing this event and its work supersedes ours.
    //
    // NOTHING IS ESTIMATED FIRST any more (quick task 260923-3w4). The event's
    // whole remaining subrequest cost used to be estimated here (`2 + 4A`) and
    // the event deferred WHOLE if it did not fit, so that state never advanced
    // into a Phase B the budget could not finish. Workers Paid's 10,000
    // subrequests per invocation make that arithmetic unreachable; the Phase
    // A-before-Phase B ordering and the claim revert below are what still keep a
    // partial event from desyncing the cursor.
    counter.spend(1);
    const claimed = await claimEventAdvance(env.DB, eventKey, cursor.lastFoldedMatchKey, lastFoldedMatchKey, pollEtag ?? cursor.tbaEtag, nowIso);
    if (!claimed) {
      return { status: "unchanged" };
    }

    try {
      // The event detail supplies `event_type` (the RP eligibility gate) and
      // `week`, which the live-windows manifest lacks. A failed fetch
      // degrades (RP ineligible, week unplaced) rather than failing the event.
      counter.spend(1);
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
        // The READ names every raw key plus the demo pseudo-team key
        // (`stateScopeKeys`), so a demo match resumes what the offline
        // publisher seeded: the pseudo-team row SPR and OPR predict a demo robot
        // from, and the passenger-only row its level-2 beliefs ride in. Reading
        // only `realTouchedTeams` restarted both from the prior on every tick
        // (quick task 260918-wfc). Since 260923-3w6 the key list also covers the
        // remaining schedule (`stateReadTeamKeys`), so Phase B can price it.
        const selections = selectionsFor(algorithmId, eventKey, stateReadTeamKeys);

        // One statement per `MAX_SCOPE_KEYS_PER_READ` keys — SQLite's
        // bound-parameter limit, not a budget. A full championship-division
        // roster is the only realistic way past one.
        counter.spend(scopedStateReadStatements(selections));
        // Cold start still gets real keys only, so no demo key seeds a level-1 `team` row.
        const { rows, state: initialState } = await loadOrInitState(env.DB, algorithmId, selections, algorithm, realTouchedTeams);

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
        // `SigmaScoutLayer.#rpFieldsFor`; change them together. An UPCOMING
        // match's RP comes from `priceUpcomingRows` instead, which mirrors the
        // same layer method — see `upcomingPricing.ts`.
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
        const foldObservedRp = (result: MatchResult, folds: boolean): void => {
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
              // The flags above are an OBSERVATION and publish either way; only
              // the belief fold is withheld from a match that does not fold.
              if (folds) rp.fold(side === "red" ? result.redTeams : result.blueTeams, parsed.thresholdVariables);
            } catch {
              // A breakdown this season's module cannot parse contributes
              // nothing rather than failing the tick.
            }
          }
          observedBonusSides.set(result.matchKey, { red: redBonusFlags, blue: blueBonusFlags });
          if (folds) for (const teamKey of [...result.redTeams, ...result.blueTeams]) rpKnownTeams.add(teamKey);
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
          // A preseason Week 0 match is PRICED above and never FOLDED
          // (`foldsIntoRatings`), the same rule `SigmaScoutLayer.foldPlayed`
          // applies offline. `update` and `foldMatch` gate themselves; the mean
          // shift, the threshold fold and the talent have no gate of their own.
          const folds = foldsIntoRatings(result.eventType);
          state = algorithm.update(state, result);
          sigma?.foldMatch(result, prediction);
          // After the RP read and before the threshold fold, so the residual is
          // taken against the mean the match was priced from.
          if (folds && rp !== undefined) rpMeanShift?.observeMatch(rp, result);
          foldObservedRp(result, folds);
          // Talent from the post-update state, as `SigmaScoutLayer.foldPlayed`
          // does: applying it before the fold would let a match inform its own prior.
          if (folds && sigma !== undefined) {
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

        // What Phase B prices the remaining schedule from (quick task
        // 260923-3w6). `scoreByTeam()`, NEVER `bandVarianceFor`: the offline
        // publisher gives a never-seen team no Sigma Score at all, while
        // `bandVarianceFor` prices one from the prior — that difference is a
        // played-row rule, and applying it to an upcoming row would publish a
        // number the next republish silently changes. The accumulators are passed
        // by reference and only READ downstream (`momentsFor`, `apply`); nothing
        // in Phase B folds.
        const upcomingModel: UpcomingPricingModel = {
          algorithm,
          state,
          sigmaScores: sigma?.scoreByTeam(),
          ruleModule: rpRuleModule,
          rp,
          shift: rpMeanShift,
        };

        // Passengers ride back into the rows after `serializeState`, so no
        // algorithm serializer knows they exist, at zero added subrequests.
        let candidateRows = serializeState(algorithmId, algorithm.version, state, stamp);
        if (rp !== undefined) candidateRows = withRpBeliefs(candidateRows, rp.beliefsByTeam());
        // The mean shift rides on the LEAGUE row.
        if (rpMeanShift !== undefined) candidateRows = withRpMeanShift(candidateRows, rpMeanShift.toState());
        if (sigma !== undefined) {
          candidateRows = withSigmaPopulation(withSigmaBeliefs(candidateRows, sigma.beliefsByTeam()), sigma.population());
        }
        // WRITE ONLY THE TEAMS THIS TICK ACTUALLY ADVANCED (quick task
        // 260923-3w6). Phase A's read now covers every team on the remaining
        // SCHEDULE so Phase B can price it, which means `serializeState` emits a
        // row for each of them. None of those extra rows moved: `update()`, the
        // Sigma fold, the talent observation and the RP fold all touch only the
        // rosters of the matches just folded.
        //
        // They are not BYTE-identical to what D1 holds, though, and that is the
        // trap this filter exists for. The publisher's passenger chain attaches
        // Sigma beliefs BEFORE RP beliefs (`seedStateRows`) and the tick's
        // attaches RP first, so the two produce the same `stateJson` object with
        // a different KEY ORDER. Without this filter `selectChangedRows` would
        // read every roster team as changed and rewrite it on every tick,
        // stamping a fresh `generation`/`computedAt` onto state that never
        // advanced. The league row (and OPR's event row) are not filtered: those
        // DO move on every fold.
        const advancedTeamKeys = new Set(stateScopeKeys(touchedTeams));
        candidateRows = candidateRows.filter((row) => row.scopeKind !== "team" || advancedTeamKeys.has(row.scopeKey));
        const changedRows = selectChangedRows(rows, candidateRows);

        counter.spend(1);
        await writeScopedState(env.DB, changedRows); // may throw -- caught below, reverts the claim and aborts the WHOLE event (zero artifact puts)

        perAlgorithm.set(algorithmId, { algorithm, newPredictions, touchedMetrics, newBands, touchedSigma, observedBonusSides, upcomingModel });
      }

      return await runPhaseBAndReport(env, counter, window, eventKey, eventType, fetchedEventType, rawMatches, newlyFolded, newlyFoldedResults, stillUpcoming, touchedTeams, realTouchedTeams, perAlgorithm, touchedTeamsByAlgorithm, stamp);
    } catch (phaseAError) {
      // Revert the claim: state did not advance, so a later tick must be free
      // to fold these matches again. Unconditional since quick task 260923-3w4 —
      // it used to sit behind `tryConsume`, which meant a budget-exhausted tick
      // could leave the cursor claiming matches no state ever saw.
      counter.spend(1);
      await writeEventCursor(env.DB, cursor);
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
 * scopes the event artifact's ephemeral `live` block rows (260918-16t). It
 * scoped the deleted metric sidecar's rows before that, and the
 * `team/{teamKey}/{year}` writes this tick no longer makes at all before that.
 *
 * `eventType` is passed explicitly (`newlyFoldedResults` can be empty) and
 * gates only the `touchedTeamsByAlgorithm` feed into `teams/{year}`. Event
 * and team artifact writes stay unconditional: an offseason event is fully
 * visible on its pages and only stops moving the season leaderboard. `-1`
 * counts as official. `fetchedEventType` is the value the event artifact
 * publishes, `undefined` when the detail fetch failed. */
async function runPhaseBAndReport(
  env: Env,
  counter: SubrequestCounter,
  window: LiveWindowEntry,
  eventKey: string,
  eventType: number,
  fetchedEventType: number | undefined,
  rawMatches: readonly TbaMatch[],
  newlyFolded: readonly CorpusMatch[],
  newlyFoldedResults: readonly MatchResult[],
  /** Schedule fields only, narrowed since 260921-vzf: the tick no longer normalizes an upcoming match, and this type is how the COMPILER proves nothing downstream reads a field it stopped producing. */
  stillUpcoming: readonly ScheduledMatchFacts[],
  touchedTeams: readonly string[],
  realTouchedTeams: readonly string[],
  perAlgorithm: ReadonlyMap<string, PerAlgorithmFold>,
  touchedTeamsByAlgorithm: Map<string, Map<string, TouchedTeamInfo>>,
  stamp: Stamp
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
      const existingEvent = await readExistingEvent(env, counter, eventParams);

      // THE REMAINING SCHEDULE, PRICED HERE (quick task 260923-3w6). The rows go
      // through the publisher's own builder inside `priceUpcomingRows`, from the
      // model Phase A captured, so a live row and the republished row for the
      // same match agree by construction — the same discipline the played rows
      // already follow through `publishedRows.ts`.
      //
      // `sortTime` is an INPUT to pricing, not something the merge can add
      // afterwards, so the published upcoming sort times are read here. A
      // scheduled match's sort time is never re-derived from TBA's `time`
      // (260915-isq): the published value, or no key at all.
      //
      // `eventType` is the tick's own resolved value, `-1` sentinel included,
      // exactly as the played rows' `rpFieldsFor` reads it — a failed detail
      // fetch makes the event RP-ineligible on both row kinds together.
      const upcomingSortTimes = existingUpcomingSortTimes(existingEvent);
      const scheduledInputs: ScheduledMatchInput[] = stillUpcoming.map((m) => {
        const sortTime = upcomingSortTimes.get(m.matchKey);
        return {
          matchKey: m.matchKey,
          compLevel: m.compLevel,
          setNumber: m.setNumber,
          matchNumber: m.matchNumber,
          ...(sortTime !== undefined ? { sortTime } : {}),
          redTeams: m.redTeams,
          blueTeams: m.blueTeams,
        };
      });
      let priced: PriceUpcomingResult;
      try {
        priced =
          scheduledInputs.length === 0
            ? { event: [], team: [] }
            : priceUpcomingRows({ model: info.upcomingModel, eventKey, season: window.season, eventType, upcoming: scheduledInputs });
      } catch (error) {
        // Logged and rethrown, never degraded to an unpriced row: writing
        // `upcoming: []` would tell the event page the schedule was over, and
        // writing schedule-only rows would revive a shape 260923-3w6 exists to
        // retire. The rethrow lands in this function's blanket catch, so the
        // event's artifacts lag one tick while its state stays durable in D1 —
        // the same outcome any other Phase B failure has. The line carries the
        // ids and a truncated message only, never a row or a TBA value.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          JSON.stringify({
            msg: "upcoming-pricing-failed",
            eventKey,
            algorithmId,
            upcoming: scheduledInputs.length,
            error: message.slice(0, WRITE_RETRY_ERROR_MESSAGE_MAX),
          })
        );
        throw error;
      }

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
        upcoming: priced.event,
        newBands: info.newBands,
        touchedTeams,
        touchedMetrics: info.touchedMetrics,
        playedRowFacts,
        stamp,
      };
      const mergedEvent = mergeEventArtifact(eventMergeParams);
      await writeArtifactWithBootstrapRetry(env, counter, "event", eventParams, mergedEvent, algorithmId, () =>
        mergeEventArtifact({ ...eventMergeParams, existing: undefined })
      );

      // Only the `teams/{year}` feed is gated on officialness. The live rows
      // ride the event write above, which is unconditional — exactly as the
      // deleted sidecar write and, before it, the team-artifact write were.
      const isOfficial = isOfficialEventType(eventType);
      const compositeKey = touchedTeamsCompositeKey(algorithmId, window.season);
      const seasonMap = touchedTeamsByAlgorithm.get(compositeKey) ?? new Map<string, TouchedTeamInfo>();

      // THE TEAM ARTIFACT WRITE IS BACK (quick task 260923-3w6), one read and one
      // write per touched team per algorithm, exactly as it was before 260917-jr4
      // removed it to save 7.6 ms of a 10 ms budget. The team page is one fetch
      // again, which the 2026-09-17 load test measured 2.1x faster than the
      // index-plus-event-file hybrid the removal forced.
      //
      // UNCONDITIONAL, unlike the `teams/{year}` feed below: an offseason event is
      // fully visible on its own pages and only stops moving the season
      // leaderboard. That split is the pre-260917-jr4 behaviour, preserved.
      for (const teamKey of realTouchedTeams) {
        const teamMatches = newlyFoldedResults.filter((m) => m.redTeams.includes(teamKey) || m.blueTeams.includes(teamKey));

        const teamParams = { page: "team" as const, teamKey, year: window.season, algorithmId, version: info.algorithm.version };
        const existingTeam = await readExistingTeam(env, counter, teamParams);
        const teamMergeParams = {
          existing: existingTeam,
          teamKey,
          season: window.season,
          algorithmId,
          algorithmVersion: info.algorithm.version,
          eventKey,
          matches: teamMatches,
          predictions: info.newPredictions,
          metrics: info.touchedMetrics[teamKey] ?? {},
          bands: info.newBands,
          playedRowFacts,
          // The SAME records the event artifact's `upcoming` came from, filtered to
          // this team's own matches — one pricing call per algorithm feeds both
          // pages, so they cannot disagree about a scheduled match.
          upcomingRows: priced.team.filter((row) => row.redTeams.includes(teamKey) || row.blueTeams.includes(teamKey)),
          stamp,
          sigmaAfterTick: info.touchedSigma.get(teamKey),
        };
        const mergedTeam = mergeTeamSeasonArtifact(teamMergeParams);
        await writeArtifactWithBootstrapRetry(env, counter, "team", teamParams, mergedTeam, algorithmId, () =>
          mergeTeamSeasonArtifact({ ...teamMergeParams, existing: undefined })
        );

        // `runGlobalRebuild`'s teams-of-the-year feed, gated on officialness and
        // summing this team's newly-folded match count. Unchanged.
        if (!isOfficial) continue;
        const prior = seasonMap.get(teamKey);
        seasonMap.set(teamKey, {
          metrics: info.touchedMetrics[teamKey] ?? prior?.metrics ?? {},
          matchDelta: (prior?.matchDelta ?? 0) + teamMatches.length,
        });
      }

      if (isOfficial) touchedTeamsByAlgorithm.set(compositeKey, seasonMap);
    }
  } catch {
    // Best-effort: state already advanced; some artifacts may lag.
  }

  return { status: "advanced" };
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
async function runGlobalRebuild(env: Env, counter: SubrequestCounter, algorithmModules: ReadonlyMap<string, AlgorithmModule<any>>, touchedTeamsByAlgorithm: ReadonlyMap<string, Map<string, TouchedTeamInfo>>, stamp: Stamp): Promise<boolean> {
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
      const text = await readArtifactObject(env, counter, artifactKey(params));
      existing = text === undefined ? undefined : TeamsArtifactSchema.parse(JSON.parse(text));
    } catch {
      return false; // read or parse failure — report the rebuild as not run
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
      await writeArtifactObject(env, counter, "teams", params, candidate);
    } catch {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// runTick / scheduled
// ---------------------------------------------------------------------------

export interface RunTickDeps {
  readonly nowMs?: number;
  /** Test-only: lets a test count `buildAlgorithmModules` calls to assert one construction per tick. */
  readonly buildAlgorithmModules?: (algorithmsManifest: AlgorithmsManifest, liveAlgorithmIds: readonly string[]) => Map<string, AlgorithmModule<any>>;
}

export interface TickResult {
  readonly eventsConsidered: number;
  readonly eventsAdvanced: number;
  /** A per-event failure, EITHER a folded/promoted event's own processing failure OR a probe that threw (`runProbes`) — both are confined to the one event/probe and counted here. */
  readonly eventsFailed: number;
  /** `inferred: true` windows this tick answered liveness for (`runProbes`), whether or not they promoted. Probed above zero and promoted zero is a healthy idle offseason weekend; probed above zero and promoted above zero is an event that has started. */
  readonly eventsProbed: number;
  /** Probe windows that saw real matches this tick and were folded via the normal live path, counted once per promoted event actually processed. */
  readonly eventsPromoted: number;
  readonly tbaRequests: number;
  readonly subrequestsUsed: number;
  readonly globalRebuildRan: boolean;
  /** The offline seed for this generation has not been applied to D1 yet; folding is suspended, not broken. See `detectStateGenerationMismatch`. */
  readonly stateGenerationMismatch: boolean;
  /** Districts with at least one live member event this tick (`districtRefresh.ts`'s `liveDistrictsOf`). Zero against a manifest carrying no `districtKey` — which is every manifest published before phase 10. */
  readonly districtsConsidered: number;
  /** Districts whose artifact this tick republished. */
  readonly districtsRefreshed: number;
  /** Districts whose rankings and observed state both came back unchanged — one conditional TBA request and no write. */
  readonly districtsUnchanged: number;
  /** Districts whose refresh threw, was refused, or found no published artifact. Confined to that district: the pass still refreshed the others and the tick still wrote its rotation offset. */
  readonly districtsFailed: number;
}

/** The four district counts every `TickResult` return site carries, as zeros — the early returns, which the district pass is deliberately unreachable from. */
const NO_DISTRICT_REFRESH: DistrictRefreshResult = { districtsConsidered: 0, districtsRefreshed: 0, districtsUnchanged: 0, districtsFailed: 0 };

export async function runTick(env: Env, deps: RunTickDeps = {}): Promise<TickResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const stamp: Stamp = { generation: `tick-${nowMs}`, computedAt: nowIso };

  const subrequests = new SubrequestCounter();
  const tbaCounter = new TbaRequestCounter();
  const tbaCtx = createTbaContext(env, tbaCounter);

  // Parsed on every tick, idle ones included, so a misconfigured deploy
  // surfaces within a minute.
  const liveAlgorithmIds = parseLiveAlgorithmIds(env.LIVE_ALGORITHM_IDS);

  // The one read that answers "is anything live"; an idle tick (the common
  // case) exits here with zero TBA requests. Keep `loadLiveEventsAt`; see
  // its header in `liveWindows.ts`.
  subrequests.spend(1);
  const liveEvents = await loadLiveEventsAt(env, nowMs);

  if (liveEvents.length === 0) {
    return { eventsConsidered: 0, eventsAdvanced: 0, eventsFailed: 0, eventsProbed: 0, eventsPromoted: 0, tbaRequests: tbaCounter.total, subrequestsUsed: subrequests.used, globalRebuildRan: false, stateGenerationMismatch: false, ...NO_DISTRICT_REFRESH };
  }

  // Split into foldable (`inferred: false`, a real measured window) and
  // probe (`inferred: true`, liveness unproven) entries. THE PROBE PASS RUNS
  // HERE, BEFORE the algorithms-manifest read, `buildAlgorithmModules` and the
  // tick-meta read — deliberately. Moving it below any of those three would
  // restore exactly the condition
  // `.planning/debug/resolved/worker-tick-exceeds-cpu-budget.md` cause B
  // describes: a tick that pays the full expensive prefix for a window that
  // was never proven live. `loadLiveEventsAt`'s prefilter and the
  // `liveEvents.length === 0` early exit above are unchanged.
  const foldableWindows = liveEvents.filter((w) => !w.inferred);
  const probeWindows = liveEvents.filter((w) => w.inferred);

  const probeResult: ProbePassResult = probeWindows.length > 0 ? await runProbes(env, subrequests, tbaCtx, probeWindows, nowIso) : { promoted: new Map(), eventsProbed: 0, eventsFailed: 0 };

  if (foldableWindows.length === 0 && probeResult.promoted.size === 0) {
    // Nothing foldable and nothing promoted: a probe-only (or fully idle
    // besides probes) tick ends here, having paid ONLY for `loadLiveEventsAt`
    // and each probe's own two calls — no algorithms manifest, no
    // `buildAlgorithmModules`, no D1 batch, no artifact write.
    return {
      eventsConsidered: 0,
      eventsAdvanced: 0,
      eventsFailed: probeResult.eventsFailed,
      eventsProbed: probeResult.eventsProbed,
      eventsPromoted: 0,
      tbaRequests: tbaCounter.total,
      subrequestsUsed: subrequests.used,
      globalRebuildRan: false,
      stateGenerationMismatch: false,
      // The district pass is deliberately NOT reached from here. A district's
      // points cannot move while no member event has played a single match,
      // which is CONTEXT's own rationale for deriving district liveness from
      // member-event liveness in the first place.
      ...NO_DISTRICT_REFRESH,
    };
  }

  // Something is foldable or was promoted: load the algorithms manifest and build the modules once for the tick.
  subrequests.spend(1);
  const algorithmsManifest = await loadAlgorithmsManifest(env);
  const buildModules = deps.buildAlgorithmModules ?? buildAlgorithmModules;
  const algorithmModules = buildModules(algorithmsManifest, liveAlgorithmIds);

  // The tick-meta sentinel and every live algorithm's state-baseline marker,
  // in the ONE subrequest `readTickMeta` used to spend on the sentinel alone
  // (quick task 260920-q75).
  subrequests.spend(1);
  const liveAlgorithmModuleIds = [...algorithmModules.keys()];
  const { meta, baselineGenerationByAlgorithm } = await readTickState(env.DB, liveAlgorithmModuleIds);

  // A mismatch means D1 has not yet been seeded from the generation the R2
  // manifests now name — folding against it would either double-fold (a
  // seed-then-tick race) or silently skip matches forever (a tick-then-seed
  // race). Return BEFORE the event loop, before `runGlobalRebuild` and before
  // `writeTickMeta`: nothing is claimed, advanced, rebuilt or written. Probes
  // above already ran and are reported as usual; a promoted event is simply
  // never fed into the loop below.
  const mismatch = detectStateGenerationMismatch(algorithmsManifest.generation, liveAlgorithmModuleIds, baselineGenerationByAlgorithm);
  if (mismatch !== undefined) {
    console.warn(JSON.stringify({ msg: "state-generation-mismatch", manifestGeneration: mismatch.manifestGeneration, markers: mismatch.markers }));
    return {
      eventsConsidered: 0,
      eventsAdvanced: 0,
      eventsFailed: probeResult.eventsFailed,
      eventsProbed: probeResult.eventsProbed,
      eventsPromoted: 0,
      tbaRequests: tbaCounter.total,
      subrequestsUsed: subrequests.used,
      globalRebuildRan: false,
      stateGenerationMismatch: true,
      // Nor from here: a state-generation mismatch suspends EVERY live write
      // until the seed lands, districts included.
      ...NO_DISTRICT_REFRESH,
    };
  }

  const promotedWindows = liveEvents.filter((w) => probeResult.promoted.has(w.eventKey));
  const orderedEventKeys = rotate(sortEventKeys([...foldableWindows.map((w) => w.eventKey), ...promotedWindows.map((w) => w.eventKey)]), meta.rotationOffset);
  const liveEventByKey = new Map([...foldableWindows, ...promotedWindows].map((w) => [w.eventKey, w]));

  let eventsConsidered = 0;
  let eventsAdvanced = 0;
  let eventsFailed = probeResult.eventsFailed;
  let eventsPromoted = 0;
  const touchedTeamsByAlgorithm = new Map<string, Map<string, TouchedTeamInfo>>();
  // Filled by `processEvent` for district member events only; consumed by
  // `runDistrictRefresh` below.
  const matchDerivedState = new Map<string, MatchDerivedEventState>();

  for (const eventKey of orderedEventKeys) {
    const window = liveEventByKey.get(eventKey);
    if (!window) continue;

    // A promoted event's preflight was already paid for by `runProbes` — hand
    // it straight to `processEvent`, which then makes no second TBA request.
    const preflight = probeResult.promoted.get(eventKey);
    if (preflight) eventsPromoted++;

    const outcome = await processEvent(env, subrequests, tbaCtx, algorithmModules, window, nowIso, stamp, touchedTeamsByAlgorithm, matchDerivedState, preflight);
    if (outcome.status === "unchanged") continue; // considered, but not counted toward advanced/failed

    eventsConsidered++;
    if (outcome.status === "advanced") {
      eventsAdvanced++;
    } else {
      eventsFailed++;
    }
  }

  // EVERY TICK THAT TOUCHED A TEAM, since quick task 260923-3w4. This used to
  // fire on a 10-minute `GLOBAL_REBUILD_INTERVAL_MS` or on an event completing
  // its last scheduled match, because serializing the year-wide `teams` table
  // cost close to the whole free-plan CPU budget — so the Teams page could be up
  // to ten minutes behind an event page showing the same match. Workers Paid
  // allows 30 s of CPU per tick, and the cost of rebuilding every touched tick is
  // one R2 write per algorithm-season (~13k in a peak month against R2's 1M
  // Class A allowance, which the plan change did NOT raise — priced in
  // `260923-1tu-FINDINGS.md` item C3). `runGlobalRebuild` returns a no-op `true`
  // when nothing was touched, so an unchanged tick still writes nothing. The
  // event-completion trigger is subsumed: a completing event touched teams.
  const globalRebuildRan = await runGlobalRebuild(env, subrequests, algorithmModules, touchedTeamsByAlgorithm, stamp);

  // THE DISTRICT PASS (10-05), placed here deliberately:
  //  (a) AFTER the event loop, because the per-event state facts it writes are
  //      collected inside `processEvent` from the match list the loop already
  //      fetched;
  //  (b) BEFORE `writeTickMeta`, and `runDistrictRefresh` never throws, so a
  //      failing district can cost neither an event's fold nor this tick's
  //      rotation offset;
  //  (c) unreachable from both early returns above — see the comments there.
  // THE DELIBERATE NARROWING: CONTEXT says a district is live when "any member
  // event has a live window", and this pass is handed the windows the tick
  // ACTUALLY processed (foldable plus promoted). A probe window that never
  // promoted is excluded on purpose: `runProbes`'s header calls the cheap-idle
  // ordering load-bearing, and spending a district's TBA request on an event
  // that has not proven it has a single match would spend against exactly that.
  const districtRefresh = await runDistrictRefresh(env, subrequests, tbaCtx, { windows: [...foldableWindows, ...promotedWindows], matchDerivedState, stamp, nowIso });

  const newMeta: TickMeta = {
    rotationOffset: orderedEventKeys.length > 0 ? (meta.rotationOffset + eventsAdvanced) % orderedEventKeys.length : 0,
  };
  subrequests.spend(1);
  await writeTickMeta(env.DB, newMeta, nowIso);

  return {
    eventsConsidered,
    eventsAdvanced,
    eventsFailed,
    eventsProbed: probeResult.eventsProbed,
    eventsPromoted,
    tbaRequests: tbaCounter.total,
    subrequestsUsed: subrequests.used,
    globalRebuildRan,
    stateGenerationMismatch: false,
    ...districtRefresh,
  };
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
