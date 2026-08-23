/**
 * The cron tick (DATA-04's freshness path): read what is live, ask TBA what
 * changed, advance the shared prediction state, and rewrite only the
 * artifacts that moved — in that order, always. `scheduled(controller, env,
 * ctx)` is three lines; `runTick(env, deps)` holds all the logic, testable
 * without a `ScheduledController`.
 *
 * ORDER THAT MATTERS (D-Pitfall-3): **update, then state write, then
 * artifact write.** Never the reverse. `processEvent` below runs a strict
 * two-phase sequence per event — PHASE A folds every published algorithm's
 * state and writes it (`stateStore.ts`'s batched writer); only once EVERY
 * algorithm's Phase A write has succeeded does PHASE B write any artifact.
 * A rejected Phase A write aborts the WHOLE event (zero artifact puts, the
 * event cursor is not advanced) — the shared `event_cursor` row has no
 * per-algorithm granularity, so a partial per-algorithm advance would
 * silently desync the un-advanced algorithms' folding forever (they would
 * re-fold an already-applied match the next tick). This is a deliberate
 * atomicity choice: an event either advances for ALL three published
 * algorithms this tick, or it advances for none of them.
 *
 * BUDGET (D-15): every event's total subrequest cost (state read/write per
 * algorithm + artifact read/write per touched artifact) is estimated UP
 * FRONT, right after polling tells us what actually changed (we cannot know
 * the touched-team count before that). If the estimate exceeds what remains,
 * the WHOLE event defers — no state touched at all — rather than starting
 * Phase A and discovering mid-loop that Phase B cannot be afforded (which
 * would leave state advanced but some artifacts stale with no future trigger
 * to fix them, since the cursor's per-event "already folded" check has no
 * way to know a given team's artifact specifically lagged). Once the
 * upfront estimate clears, every subsequent real call is expected to
 * succeed — `SubrequestBudget`'s own accounting guarantees it, since
 * nothing else touches the SAME budget instance while a single event is
 * being processed (events are handled sequentially within one tick, never
 * concurrently with each other in this Worker's own event loop).
 *
 * ROTATION OFFSET / GLOBAL REBUILD TIMESTAMP PERSISTENCE (D-15/D-16): stored
 * in `event_cursor` under a reserved sentinel key, `__scheduler_meta__`
 * (`TICK_META_EVENT_KEY` below) — a deliberate reuse of `stateStore.ts`'s
 * existing `event_cursor` table/columns rather than a new migration/table,
 * since this plan's declared `files_modified` does not include the
 * migration file. `lastFoldedMatchKey` (a free-text column with no FK to a
 * real match) carries a small JSON blob (`{ rotationOffset,
 * lastGlobalRebuildAtMs }`) instead of a match key for this one row —
 * documented here and at the sentinel's own read/write helpers so a future
 * editor of `stateStore.ts`'s schema does not remove this column without
 * noticing this second use of it.
 *
 * GLOBAL REBUILD (D-16): serializing the whole year-wide `teams`/`events`
 * tables every tick is close to the entire CPU budget by itself — this
 * Worker rebuilds them on a slower cadence (a fixed interval OR an event
 * just completing its last scheduled match this tick, whichever comes
 * first). Because this Worker has NO corpus access at all (no
 * `better-sqlite3`, by the same isomorphic boundary `packages/core`
 * enforces), "rebuild" here can only ever mean an INCREMENTAL merge of the
 * teams actually touched since the last rebuild into the existing published
 * `teams/{year}` table — never a from-scratch recomputation, which remains
 * the offline `pnpm publish:seasons` job. This is a genuine, documented
 * scope reduction from a literal "rebuild": the `record` (win/loss/tie)
 * field on a `teams/{year}` row is NOT updated by this incremental merge
 * (only `metrics`/`matchCount` are) — see `runGlobalRebuild`'s own comment —
 * and the `events/{year}` table is not touched by this path at all;
 * both stay accurate as of the last offline publish until a future plan
 * extends this mechanism or a manual republish runs. Documented as a Known
 * Stub in this plan's SUMMARY, not a silent gap.
 */
import { opr } from "../../../packages/core/algorithms/opr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { makeSigma1 } from "../../../packages/core/algorithms/sigma1/index.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import type { AlgorithmModule, ComponentPrediction, MatchResult, Prediction, TeamMetric, UpcomingMatch } from "../../../packages/core/algorithms/types.js";
import { tbaMatchListSchema } from "../../../packages/ingest/schemas.js";
import { tbaEventSchema } from "../../../packages/ingest/schemas.js";
import { normalizeMatch, type CorpusMatch } from "../../../packages/ingest/normalize.js";
import { fetchEventDetail } from "../../../packages/ingest/tbaClient.js";
import { deserializeState, serializeState } from "../../../packages/harness/stateSnapshot.js";
import {
  artifactKey,
  EventArtifactSchema,
  PAGE_ARTIFACT_SCHEMA_VERSION,
  TeamsArtifactSchema,
  TeamSeasonArtifactSchema,
  type EventArtifact,
  type TeamSeasonArtifact,
  type TeamsArtifact,
} from "../../../packages/harness/pageArtifacts.js";
import { roundMetric, roundPmf, roundProbability, roundTo, ROUNDING_RULE } from "../../../packages/harness/rounding.js";
import { PUBLISHED_ALGORITHM_IDS, type AlgorithmsManifest, type LiveWindowEntry } from "../../../packages/harness/manifestSchemas.js";
import { liveEventsAt, loadAlgorithmsManifest, loadLiveWindowsManifest } from "./liveWindows.js";
import { readArtifactObject, writeArtifactObject } from "./artifactWriter.js";
import { hasAlreadyFolded, readEventCursor, readScopedState, selectChangedRows, writeEventCursor, writeScopedState, type EventCursor, type ScopeSelection } from "./stateStore.js";
import { rotate, sortEventKeys, SubrequestBudget } from "./subrequestBudget.js";
import { createTbaContext, pollEventMatches, TbaRequestCounter, type TbaClientContext } from "./tbaPoll.js";
import type { Env } from "./env.js";

// ---------------------------------------------------------------------------
// Tick meta (rotation offset, last global rebuild) — see this module's header.
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
// Algorithm module construction — hoisted ONCE per tick (Pitfall 4)
// ---------------------------------------------------------------------------

/**
 * Quick task 260822-wqt (D-04 regression fix): only sigma1 needs real-time
 * folding during a live event — the user's explicit decision over adding
 * per-algorithm cursor granularity. `processEvent`'s `estimatedCost` for ONE
 * ordinary 3v3 match (6 touched teams) is 18 with sigma1 alone vs. 50 with
 * all three published algorithms live, against ~41 subrequests actually
 * available per tick — with all three live the event defers every tick,
 * forever (measured on the deployed Worker during plan 04-07, recorded in
 * `docs/publish-budget.md`'s "Worker runtime budget" section). This does NOT
 * change what is PUBLISHED (D-03 — opr, epa, sigma1 stay exactly as
 * published); it only narrows what THIS Worker folds LIVE. opr/epa refresh
 * at the manual pre/post-event-weekend re-baseline (D-12) instead. Exported
 * so `parseLiveAlgorithmIds`'s unset/empty fallback and this file's own
 * regression test (`liveAlgorithmTier.test.ts`) bind to the SAME default
 * rather than a re-typed copy.
 */
export const DEFAULT_LIVE_ALGORITHM_IDS: readonly string[] = ["sigma1"];

/** An id in `LIVE_ALGORITHM_IDS` that is not one of `PUBLISHED_ALGORITHM_IDS` — unambiguously a typo in tracked config, never auto-corrected. */
export class UnknownLiveAlgorithmIdError extends Error {
  constructor(id: string) {
    super(`parseLiveAlgorithmIds: "${id}" is not a published algorithm id (accepted: ${PUBLISHED_ALGORITHM_IDS.join(", ")}) — check LIVE_ALGORITHM_IDS in apps/worker/wrangler.toml for a typo.`);
    this.name = "UnknownLiveAlgorithmIdError";
  }
}

/**
 * The live tier, after filtering the algorithms manifest, came out empty.
 * Thrown rather than allowed to silently fold zero algorithms: a tick that
 * folds nothing would still CLAIM and ADVANCE the event cursor
 * (`claimEventAdvance`), marking matches folded that were never applied to
 * any algorithm's state — a corruption that is indistinguishable from
 * health in the one log line `docs/worker-operations.md`'s troubleshooting
 * table tells an operator to read (`"ok":true`, `eventsAdvanced` climbing
 * normally). This guard exists specifically to make that failure loud.
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
 * Parses `Env.LIVE_ALGORITHM_IDS` (a comma-separated string) into the tier
 * that folds LIVE this tick. Three decided behaviors (quick task
 * 260822-wqt), each deliberate:
 *  - Unset or empty (after trimming/dropping blank segments) — falls back to
 *    `DEFAULT_LIVE_ALGORITHM_IDS` AND emits ONE structured
 *    `live-tier-defaulted` warn line (never silent). Defaulting to "all"
 *    would reintroduce the exact defect this fixes; throwing would take the
 *    site's freshness down over a config omission (including the plausible
 *    case where a deploy-time `--var` override drops this tracked var).
 *    Falling back is safe; the warn line is what stops it being silent. Only
 *    the ids themselves are logged, never any other binding value.
 *  - An id not in `PUBLISHED_ALGORITHM_IDS` — throws `UnknownLiveAlgorithmIdError`.
 * Called at the TOP of `runTick`, before the live-windows manifest read, so
 * a misconfigured deploy surfaces on the very next tick — one minute later,
 * in the tail an operator is already watching — rather than lying dormant
 * until an event goes live months later.
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

/** Builds exactly the modules `algorithmsManifest` names, at the exact versions/parameters it names — never a second, independently-derived resolution (D-03) — narrowed to ONLY the ids in `liveAlgorithmIds` (quick task 260822-wqt: PUBLISHED (D-03) and FOLDED-LIVE are two different sets; this filter narrows the latter only). Called exactly ONCE per tick; every event this tick reuses the SAME module instances, never rebuilt per event. Throws `EmptyLiveAlgorithmTierError` if the filtered result is empty — see that error's own doc comment for why. */
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
    // Every published Sigma1 entry uses the "predictive-variance" link mode
    // (the `sigma1` id's own default — the manifest schema rejects the four
    // harness-only link-mode ids by name, so this branch is only ever
    // reached for `id === "sigma1"`).
    modules.set(entry.id, makeSigma1({ id: entry.id, linkMode: "predictive-variance", params: entry.params, paramSetName: entry.paramSetName }));
  }
  if (modules.size === 0) {
    throw new EmptyLiveAlgorithmTierError();
  }
  return modules;
}

/**
 * Plan 04-08: an algorithm's FULL selection list for one event's fold — every
 * scope kind it stores, in ONE `readScopedState` request (never a second
 * call, which would spend a second subrequest). OPR now stores BOTH `event`
 * rows (its per-event observations/ratings, D-09) AND `team` rows
 * (`lastEventByTeam`'s per-team bookkeeping, moved out of the league row by
 * plan 04-08); EPA/Sigma1 store only `team` rows.
 */
function selectionsFor(algorithmId: string, eventKey: string, touchedTeams: readonly string[]): ScopeSelection[] {
  if (algorithmId === "opr") {
    return [
      { scopeKind: "event", scopeKeys: [eventKey] },
      { scopeKind: "team", scopeKeys: touchedTeams },
    ];
  }
  return [{ scopeKind: "team", scopeKeys: touchedTeams }];
}

async function loadOrInitState(db: D1Database, algorithmId: string, selections: readonly ScopeSelection[], algorithm: AlgorithmModule<any>) {
  const rows = await readScopedState(db, algorithmId, selections);
  const hasLeagueRow = rows.some((row) => row.scopeKind === "league");
  // Not-yet-seeded algorithm/scope: cold-start via initState rather than
  // deserializeState, which throws MissingLeagueRowError by design for
  // exactly this case (stateStore.ts's own readAndDeserializeScopedState
  // doc comment names this as the caller's responsibility). initState's
  // only real consumer of its argument is EPA (seeds teamComponents/
  // teamMatchCounts) — OPR and Sigma1 both ignore it — so the TEAM
  // selection's own key list (never the event key) is what gets passed.
  const teamKeys = selections.find((s) => s.scopeKind === "team")?.scopeKeys ?? [];
  const state: any = hasLeagueRow ? deserializeState(algorithmId, rows) : algorithm.initState([...teamKeys]);
  return { rows, state };
}

// ---------------------------------------------------------------------------
// TBA match -> core algorithm types
// ---------------------------------------------------------------------------

function toMatchResult(match: CorpusMatch, eventType: number): MatchResult {
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
    eventType,
    winner: match.winner as "red" | "blue" | "tie",
    redScore: match.redScore!,
    blueScore: match.blueScore!,
    redRpEarned: match.redRpEarned,
    blueRpEarned: match.blueRpEarned,
    hasScoreBreakdown: match.hasScoreBreakdown,
    scoreBreakdownRaw: match.scoreBreakdownRaw,
  };
}

function toUpcomingMatch(match: CorpusMatch, eventType: number): UpcomingMatch {
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
    eventType,
  };
}

// ---------------------------------------------------------------------------
// D-06 rounding — small, deliberate duplication of publish.ts's own helpers
// (same precedent this codebase already sets for splitVersion/
// fallbackTeamNumber-shaped small duplications): publish.ts is Node/corpus
// -heavy and must never be imported by the Worker.
// ---------------------------------------------------------------------------

function roundComponents(components: Record<string, ComponentPrediction> | undefined): Record<string, ComponentPrediction> | undefined {
  if (components === undefined) return undefined;
  const result: Record<string, ComponentPrediction> = {};
  for (const [key, c] of Object.entries(components)) {
    result[key] = { mean: roundMetric(c.mean), ...(c.variance !== undefined ? { variance: roundMetric(c.variance) } : {}) };
  }
  return result;
}

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

function buildEventMatchRow(match: MatchResult, prediction: Prediction) {
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
    redComponents: roundComponents(prediction.redComponents),
    blueComponents: roundComponents(prediction.blueComponents),
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
  };
}

function buildEventUpcomingRow(match: UpcomingMatch, prediction: Prediction) {
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
    redComponents: roundComponents(prediction.redComponents),
    blueComponents: roundComponents(prediction.blueComponents),
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
  };
}

interface MergeEventArtifactParams {
  readonly existing: EventArtifact | undefined;
  readonly eventKey: string;
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly newlyFolded: readonly MatchResult[];
  readonly newPredictions: ReadonlyMap<string, Prediction>;
  readonly stillUpcoming: readonly UpcomingMatch[];
  readonly upcomingPredictions: ReadonlyMap<string, Prediction>;
  readonly touchedTeams: readonly string[];
  readonly touchedMetrics: Readonly<Record<string, Record<string, TeamMetric>>>;
  readonly stamp: Stamp;
}

/** Read-modify-write merge: replaces newly-folded matches (removing them from `upcoming`), refreshes touched teams' standings rows, and preserves everything else from `existing` unchanged. Bootstraps a schema-valid (but degraded — no history this Worker cannot see) artifact when `existing` is `undefined`. */
function mergeEventArtifact(params: MergeEventArtifactParams): unknown {
  const { existing, eventKey, season, algorithmId, algorithmVersion, newlyFolded, newPredictions, stillUpcoming, upcomingPredictions, touchedTeams, touchedMetrics, stamp } = params;

  const newMatchKeys = new Set(newlyFolded.map((m) => m.matchKey));
  const preservedMatches = (existing?.matches ?? []).filter((m) => !newMatchKeys.has(m.matchKey));
  const matches = [...preservedMatches, ...newlyFolded.map((m) => buildEventMatchRow(m, newPredictions.get(m.matchKey)!))];

  const upcoming = stillUpcoming.map((m) => buildEventUpcomingRow(m, upcomingPredictions.get(m.matchKey)!));

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
        metrics: roundTeamMetricRecord(touchedMetrics[teamKey] ?? {}),
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
    matches,
    upcoming,
    teams,
  };
}

function buildTeamSeasonMatchRow(match: MatchResult, prediction: Prediction, season: number, algorithmId: string, algorithmVersion: string) {
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
    redComponents: roundComponents(prediction.redComponents) ?? {},
    blueComponents: roundComponents(prediction.blueComponents) ?? {},
    variance: prediction.variance !== undefined ? roundTo(prediction.variance, ROUNDING_RULE.variance) : undefined,
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    actualWinner: match.winner,
    actualRedScore: match.redScore,
    actualBlueScore: match.blueScore,
    redTeams: [...match.redTeams],
    blueTeams: [...match.blueTeams],
  };
}

function incrementRecord(record: { wins: number; losses: number; ties: number }, teamKey: string, match: MatchResult) {
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
  readonly stamp: Stamp;
}

/** Read-modify-write merge for one team's season artifact: appends this tick's newly-folded matches at `eventKey` (creating the event's entry if this is the team's first match there), refreshes `seasonStats`, and appends metric-history rows. */
function mergeTeamSeasonArtifact(params: MergeTeamSeasonArtifactParams): unknown {
  const { existing, teamKey, season, algorithmId, algorithmVersion, eventKey, matches, predictions, metrics, matchIndexByKey, stamp } = params;

  let record = existing?.seasonStats.record ?? { wins: 0, losses: 0, ties: 0 };
  for (const match of matches) record = incrementRecord(record, teamKey, match);

  const newRows = matches.map((m) => buildTeamSeasonMatchRow(m, predictions.get(m.matchKey)!, season, algorithmId, algorithmVersion));
  const existingEvents = existing?.events ?? [];
  const eventIndex = existingEvents.findIndex((e) => e.eventKey === eventKey);
  const events =
    eventIndex === -1
      ? [...existingEvents, { eventKey, eventName: eventKey, startDate: stamp.computedAt.slice(0, 10), matches: newRows }]
      : existingEvents.map((e, i) => (i === eventIndex ? { ...e, matches: [...e.matches, ...newRows] } : e));

  const newMetricHistoryRows = matches.map((m) => ({
    matchKey: m.matchKey,
    season,
    eventKey: m.eventKey,
    algorithmId,
    teamKey,
    matchIndex: matchIndexByKey.get(m.matchKey) ?? 0,
    metrics: roundTeamMetricRecord(metrics),
  }));

  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: stamp.generation,
    computedAt: stamp.computedAt,
    algorithmId,
    algorithmVersion,
    teamKey,
    teamNumber: existing?.teamNumber ?? fallbackTeamNumber(teamKey),
    nickname: existing?.nickname ?? "",
    season,
    seasonStats: { record, metrics: roundTeamMetricRecord(metrics) },
    events,
    metricHistory: [...(existing?.metricHistory ?? []), ...newMetricHistoryRows],
  };
}

async function readExistingEvent(env: Env, budget: SubrequestBudget, params: { page: "event"; eventKey: string; algorithmId: string; version: string }): Promise<EventArtifact | undefined> {
  const text = await readArtifactObject(env, budget, artifactKey(params));
  if (text === undefined) return undefined;
  try {
    return EventArtifactSchema.parse(JSON.parse(text));
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
 * D-15/D-19's overlap-safety anchor, made concrete: an optimistic
 * compare-and-swap on `event_cursor.last_folded_match_key`. Two genuinely
 * overlapping invocations both reading the SAME prior cursor value and both
 * proceeding to fold the SAME matches would otherwise be possible — a plain
 * "read cursor, do work, write cursor" sequence has a window between the
 * read and the write where a second invocation's own read/write can land
 * in between, causing it to read the FIRST invocation's already-advanced
 * state as its own "prior" and fold the same match again on top of it. This
 * function closes that window by making the CURSOR ADVANCE ITSELF the
 * atomic claim, performed BEFORE any state is read: only the invocation
 * whose `UPDATE ... WHERE last_folded_match_key IS <the value we read>`
 * actually matches a row gets to proceed; a second invocation's identical
 * attempt (now `IS` a value that no longer matches, since the first already
 * wrote its new value) affects zero rows and returns `false`.
 *
 * SQLite's `IS` operator (not `=`) is used because it compares correctly
 * against a bound `NULL` parameter — the cold-start case where no match has
 * ever been folded yet — unlike `=`, which never matches `NULL`.
 *
 * A zero-row `UPDATE` result is ambiguous on its own (no row exists yet vs.
 * lost the race) — the `INSERT ... SELECT ... WHERE NOT EXISTS` fallback
 * resolves that: it inserts only if the row is genuinely absent, and is
 * itself a no-op (zero rows) if a concurrent invocation's own bootstrap
 * insert already landed.
 *
 * Callers MUST revert (write the cursor back to its prior value) if the
 * work performed after a successful claim later fails — see `processEvent`
 * — otherwise a rejected Phase A write would permanently desync the cursor
 * from `algorithm_state` (the exact bug this atomicity choice exists
 * alongside to avoid).
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
// Subrequest budget estimate (D-15) — extracted (quick task 260822-wqt) so
// `processEvent` and this file's regression test (`liveAlgorithmTier.test.ts`)
// bind to the SAME formula; see this module's header for the atomicity/
// budget reasoning.
// ---------------------------------------------------------------------------

/** `runTick`'s own three fixed `consume(1)` calls, paid before any event-specific work: the live-windows manifest read, the algorithms manifest read, and the tick-meta read (see `runTick`'s "Step 1" / "something is live" comments below). Pinned to the real deployed Worker's measured `subrequestsUsed` for an idle/unchanged tick by this file's regression test — never re-typed without re-measuring on a deployed Worker. */
export const TICK_FIXED_SUBREQUEST_COST = 3;

/** `processEvent`'s own fixed cost, spent BEFORE the estimate check below: the cursor-CAS-gate read (`tryConsume(1)`) and the TBA poll (`tryConsume(1)`). */
export const EVENT_PREFLIGHT_SUBREQUEST_COST = 2;

/**
 * The whole event's remaining subrequest cost, estimated up front (D-15) —
 * see this module's header for why all-or-nothing-per-event atomicity is the
 * safe choice. `processEvent` below is this function's ONLY caller; the
 * regression test in `liveAlgorithmTier.test.ts` binds to this SAME function
 * rather than a re-typed copy of the arithmetic — re-typing a
 * plausible-looking formula is exactly how the live-folding-defers-forever
 * defect (quick task 260822-wqt) survived four plans undetected.
 */
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
    // The Worker has no corpus access and D-18's live-windows manifest does
    // not carry the event's real start_date (only its derived live window) —
    // this approximates it for normalizeMatch's sortTime FALLBACK path only,
    // which real matches (carrying actual_time/predicted_time/time) rarely
    // exercise.
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
    const lastFoldedMatchKey = newlyFolded[newlyFolded.length - 1]!.matchKey;

    // Estimate the WHOLE event's remaining subrequest cost up front (D-15) —
    // see this module's header for why atomicity (all-or-nothing per event)
    // is the safe choice here.
    const algorithmCount = algorithmModules.size;
    const estimatedCost = estimateEventSubrequestCost(algorithmCount, touchedTeams.length);
    if (budget.remaining < estimatedCost) {
      return { status: "deferred" };
    }

    // Claim this fold BEFORE any state is read (D-15/D-19 overlap safety —
    // see claimEventAdvance's own header). A lost claim means another
    // invocation already advanced (or is advancing) this event past where
    // we started; its work supersedes ours this tick.
    budget.consume(1);
    const claimed = await claimEventAdvance(env.DB, eventKey, cursor.lastFoldedMatchKey, lastFoldedMatchKey, poll.etag ?? cursor.tbaEtag, nowIso);
    if (!claimed) {
      return { status: "unchanged" };
    }

    try {
      // D-22: reuse the SAME TBA client/counter for the event's `event_type`
      // (only Sigma1's RP eligibility gate reads it — D-18's manifest
      // doesn't carry it). Degrades gracefully (RP simply comes out
      // ineligible) rather than failing the whole event on a transient
      // failure here.
      budget.consume(1);
      let eventType = -1;
      try {
        const detail = await fetchEventDetail(tbaCtx, eventKey);
        if (detail.status === 200) eventType = tbaEventSchema.parse(detail.body).event_type;
      } catch {
        // degrade gracefully — see comment above
      }

      const newlyFoldedResults = newlyFolded.map((m) => toMatchResult(m, eventType));
      const stillUpcomingViews = stillUpcoming.map((m) => toUpcomingMatch(m, eventType));

      // PHASE A — every algorithm reads, folds, and writes state. ALL must
      // succeed before ANY artifact write (see this module's header).
      const perAlgorithm = new Map<string, { readonly algorithm: AlgorithmModule<any>; readonly newPredictions: Map<string, Prediction>; readonly upcomingPredictions: Map<string, Prediction>; readonly touchedMetrics: Record<string, Record<string, TeamMetric>> }>();

      for (const [algorithmId, algorithm] of algorithmModules) {
        const selections = selectionsFor(algorithmId, eventKey, touchedTeams);

        budget.consume(1);
        const { rows, state: initialState } = await loadOrInitState(env.DB, algorithmId, selections, algorithm);

        let state = initialState;
        const newPredictions = new Map<string, Prediction>();
        for (const result of newlyFoldedResults) {
          const prediction = algorithm.predict(state, toLeakProofUpcoming(result));
          newPredictions.set(result.matchKey, prediction);
          state = algorithm.update(state, result);
        }

        const upcomingPredictions = new Map<string, Prediction>();
        for (const match of stillUpcomingViews) {
          upcomingPredictions.set(match.matchKey, algorithm.predict(state, match));
        }

        const touchedMetrics = algorithm.teamMetrics(state, touchedTeams);

        const candidateRows = serializeState(algorithmId, algorithm.version, state, stamp);
        const changedRows = selectChangedRows(rows, candidateRows);

        budget.consume(1);
        await writeScopedState(env.DB, changedRows); // may throw -- caught below, reverts the claim and aborts the WHOLE event (zero artifact puts)

        perAlgorithm.set(algorithmId, { algorithm, newPredictions, upcomingPredictions, touchedMetrics });
      }

      return await runPhaseBAndReport(env, budget, window, eventKey, newlyFoldedResults, stillUpcomingViews, touchedTeams, matchIndexByKey, perAlgorithm, touchedTeamsByAlgorithm, stamp, stillUpcoming.length === 0);
    } catch (phaseAError) {
      // Revert the claim: state did not actually advance, so a future tick
      // (or another invocation) must be free to re-attempt folding these
      // same matches, exactly as if we had never claimed them.
      if (budget.tryConsume(1)) {
        await writeEventCursor(env.DB, cursor);
      }
      throw phaseAError; // re-thrown -- caught by the OUTER try/catch below, event recorded "failed"
    }
  } catch (err) {
    // Plan 04-07 (Rule 2 — missing critical functionality, found running the
    // replay rig's real deployed-Worker experiment): before this, a per-event
    // failure was completely invisible — the tick itself still logs
    // `"ok":true` (the TICK didn't throw, only this one event's processing
    // did), so `docs/worker-operations.md`'s own troubleshooting table
    // promise ("a tick throwing: check subrequestsUsed first, read the error
    // field") had nothing to point an operator at for this exact case. Never
    // the TBA key, never a response header/body — only the event key and the
    // caught error's own message, matching `TbaPollError`'s own naming
    // discipline (D-22).
    console.error(JSON.stringify({ msg: "event-failed", eventKey, error: err instanceof Error ? err.message : String(err) }));
    return { status: "failed" };
  }
}

/** PHASE B — artifact writes, best-effort, factored out only so `processEvent`'s Phase-A try/catch (which must revert the CAS claim on failure) does not also have to special-case Phase B's own best-effort try/catch. A failure inside Phase B does not change the event's "advanced" outcome (state has genuinely advanced); a skipped artifact stays one tick stale until this team's next match at this event, per this module's header's documented limitation. */
async function runPhaseBAndReport(
  env: Env,
  budget: SubrequestBudget,
  window: LiveWindowEntry,
  eventKey: string,
  newlyFoldedResults: readonly MatchResult[],
  stillUpcomingViews: readonly UpcomingMatch[],
  touchedTeams: readonly string[],
  matchIndexByKey: ReadonlyMap<string, number>,
  perAlgorithm: ReadonlyMap<string, { readonly algorithm: AlgorithmModule<any>; readonly newPredictions: Map<string, Prediction>; readonly upcomingPredictions: Map<string, Prediction>; readonly touchedMetrics: Record<string, Record<string, TeamMetric>> }>,
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
        newlyFolded: newlyFoldedResults,
        newPredictions: info.newPredictions,
        stillUpcoming: stillUpcomingViews,
        upcomingPredictions: info.upcomingPredictions,
        touchedTeams,
        touchedMetrics: info.touchedMetrics,
        stamp,
      });
      await writeArtifactObject(env, budget, "event", eventParams, mergedEvent);

      const compositeKey = touchedTeamsCompositeKey(algorithmId, window.season);
      const seasonMap = touchedTeamsByAlgorithm.get(compositeKey) ?? new Map<string, TouchedTeamInfo>();

      for (const teamKey of touchedTeams) {
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
          stamp,
        });
        await writeArtifactObject(env, budget, "team", teamParams, mergedTeam);

        const prior = seasonMap.get(teamKey);
        seasonMap.set(teamKey, {
          metrics: info.touchedMetrics[teamKey] ?? prior?.metrics ?? {},
          matchDelta: (prior?.matchDelta ?? 0) + teamMatches.length,
        });
      }

      touchedTeamsByAlgorithm.set(compositeKey, seasonMap);
    }
  } catch {
    // Best-effort — state already advanced correctly; some artifacts may
    // lag until this team's next match at this event (documented above).
  }

  return { status: "advanced", eventComplete };
}

// ---------------------------------------------------------------------------
// D-16's slower-cadence global rebuild (see this module's header for scope)
// ---------------------------------------------------------------------------

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
        return {
          teamKey,
          teamNumber: prior?.teamNumber ?? fallbackTeamNumber(teamKey),
          nickname: prior?.nickname ?? "",
          // NOT updated here — see this module's header's documented
          // limitation. Preserved from the last offline/incremental value.
          record: prior?.record ?? { wins: 0, losses: 0, ties: 0 },
          metrics: roundTeamMetricRecord(info.metrics),
          eventCount: prior?.eventCount ?? 0,
          matchCount: (prior?.matchCount ?? 0) + info.matchDelta,
        };
      }),
    ];

    const candidate = { schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION, generation: stamp.generation, computedAt: stamp.computedAt, algorithmId, algorithmVersion: algorithm.version, season, teams: rows };
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

/** D-16: the fixed-interval trigger for the global rebuild — the other trigger is an event completing its last scheduled match this tick. */
export const GLOBAL_REBUILD_INTERVAL_MS = 10 * 60 * 1000;

export interface RunTickDeps {
  readonly nowMs?: number;
  readonly globalRebuildIntervalMs?: number;
  /** Test-only injection point (defaults to the real `buildAlgorithmModules`) — lets a test wrap it with a call counter to assert modules are constructed ONCE per tick, never once per event (Pitfall 4), without mocking the whole `packages/core/algorithms/sigma1` module. */
  readonly buildAlgorithmModules?: (algorithmsManifest: AlgorithmsManifest, liveAlgorithmIds: readonly string[]) => Map<string, AlgorithmModule<any>>;
  /** Test-only override of `SubrequestBudget`'s constructor args — lets a test drive the deferral/no-starvation and budget-exhausted-global-rebuild paths deterministically without depending on this tick's exact real subrequest-cost arithmetic. Defaults to `SUBREQUEST_CAP`/`SUBREQUEST_RESERVE` (the real production values) when omitted. */
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

  // Default parameters trigger on `undefined`, so passing through unset
  // deps.subrequestCap/Reserve unchanged still resolves to the real
  // SUBREQUEST_CAP/SUBREQUEST_RESERVE production values.
  const budget = new SubrequestBudget(deps.subrequestCap, deps.subrequestReserve);
  const counter = new TbaRequestCounter();
  const tbaCtx = createTbaContext(env, counter);

  // Quick task 260822-wqt: parsed BEFORE the live-windows manifest read, on
  // EVERY tick (including idle ones), so a misconfigured deploy surfaces on
  // the very next tick — one minute later, in the tail an operator is
  // already watching — rather than lying dormant until an event goes live
  // months later.
  const liveAlgorithmIds = parseLiveAlgorithmIds(env.LIVE_ALGORITHM_IDS);

  // Step 1 (Pattern 2): the ONE manifest read that answers "is anything
  // live" — an idle tick (the overwhelmingly common case, ~10 months of the
  // year) exits right here, having spent zero TBA requests.
  budget.consume(1);
  const liveWindowsManifest = await loadLiveWindowsManifest(env);
  const liveEvents = liveEventsAt(liveWindowsManifest, nowMs);

  if (liveEvents.length === 0) {
    return { eventsConsidered: 0, eventsAdvanced: 0, eventsDeferred: 0, eventsFailed: 0, tbaRequests: counter.total, subrequestsUsed: budget.used, globalRebuildRan: false };
  }

  // Something is live: now (and only now) load the algorithms manifest and
  // build every published module ONCE for the whole tick (Pitfall 4).
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
 * One structured line per invocation, and the only logging this Worker does.
 *
 * `runTick` already returns everything an operator needs (`TickResult`), but
 * until this handler emitted it, a deployed tick was completely invisible:
 * `wrangler tail` showed nothing at all, so "the cron is firing and finding
 * nothing live" and "the cron is not firing" produced identical evidence.
 * That is the exact question `docs/worker-operations.md`'s troubleshooting
 * table tells an operator to answer first during a live event, and 04-07's
 * own acceptance criterion asks for a tail capture proving it.
 *
 * Emitted as a single JSON object rather than prose so Workers Observability
 * can filter on a field (`eventsAdvanced > 0`, `eventsFailed > 0`) instead of
 * matching substrings. Nothing here is secret: counts and durations only,
 * never a key, an artifact body, or a TBA response.
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
          // A rejected waitUntil would otherwise be swallowed silently, so a
          // tick that throws every minute would look exactly like a healthy
          // idle tick. Log and rethrow: the log is for the operator, the
          // rethrow keeps the invocation recorded as failed in the dashboard.
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
