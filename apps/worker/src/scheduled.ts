/**
 * The cron tick: read what is live, ask TBA what changed, advance the
 * shared prediction state, and rewrite only the artifacts that moved — in
 * that order, always. `scheduled(controller, env, ctx)` is three lines;
 * `runTick(env, deps)` holds all the logic, testable without a
 * `ScheduledController`.
 *
 * ORDER THAT MATTERS: **update, then state write, then artifact write.**
 * Never the reverse. `processEvent` below runs a strict two-phase sequence
 * per event — PHASE A folds every published algorithm's state and writes it
 * (`stateStore.ts`'s batched writer); only once EVERY algorithm's Phase A
 * write has succeeded does PHASE B write any artifact. A rejected Phase A
 * write aborts the WHOLE event (zero artifact puts, the event cursor is not
 * advanced) — the shared `event_cursor` row has no per-algorithm
 * granularity, so a partial per-algorithm advance would silently desync the
 * un-advanced algorithms' folding forever. An event either advances for ALL
 * published algorithms this tick, or it advances for none of them.
 *
 * BUDGET: every event's total subrequest cost (state read/write per
 * algorithm + artifact read/write per touched artifact) is estimated UP
 * FRONT, right after polling tells us what actually changed. If the
 * estimate exceeds what remains, the WHOLE event defers — no state touched
 * at all — rather than starting Phase A and discovering mid-loop that
 * Phase B cannot be afforded (which would leave state advanced but some
 * artifacts stale with no future trigger to fix them). Once the upfront
 * estimate clears, every subsequent real call is expected to succeed —
 * `SubrequestBudget`'s own accounting guarantees it, since events are
 * handled sequentially within one tick, never concurrently.
 *
 * ROTATION OFFSET / GLOBAL REBUILD TIMESTAMP PERSISTENCE: stored in
 * `event_cursor` under a reserved sentinel key, `__scheduler_meta__`
 * (`TICK_META_EVENT_KEY` below) — a deliberate reuse of `stateStore.ts`'s
 * existing `event_cursor` table/columns rather than a new migration/table.
 * `lastFoldedMatchKey` (a free-text column with no FK to a real match)
 * carries a small JSON blob (`{ rotationOffset, lastGlobalRebuildAtMs }`)
 * instead of a match key for this one row.
 *
 * GLOBAL REBUILD: serializing the whole year-wide `teams`/`events` tables
 * every tick is close to the entire CPU budget by itself — this Worker
 * rebuilds them on a slower cadence (a fixed interval OR an event just
 * completing its last scheduled match this tick, whichever comes first).
 * Because this Worker has NO corpus access at all (no `better-sqlite3`, by
 * the same isomorphic boundary `packages/core` enforces), "rebuild" here can
 * only ever mean an INCREMENTAL merge of the teams actually touched since
 * the last rebuild into the existing published `teams/{year}` table — never
 * a from-scratch recomputation, which remains the offline
 * `pnpm publish:seasons` job. Known stub: the `record` (win/loss/tie) field
 * on a `teams/{year}` row is NOT updated by this incremental merge (only
 * `metrics`/`matchCount` are — see `runGlobalRebuild`'s own comment), and the
 * `events/{year}` table is not touched by this path at all; both stay
 * accurate as of the last offline publish.
 *
 * TIERS: a touched row keeps the prior row's published rarity `tier` per
 * metric key and its published Sigma entry (`touchedTeamsRowMetrics`), so
 * the Teams list never falls back to a false Common mid-event. Tiers are
 * CARRIED, not re-derived: re-ranking every row with the pipeline's helper
 * was measured at 67-97% of this rebuild's existing CPU-bound cost against a
 * 25% gate (numbers on that function's doc comment).
 *
 * OFFICIAL-PLAY SCOPE: every SUMMARY quantity this merge writes covers
 * OFFICIAL play only (`isOfficialEventType`,
 * `packages/core/algorithms/eventTypes.ts`), matching what `publish.ts`
 * writes offline. Two gates, at two levels:
 *
 *   - the `teams/{year}` leaderboard feed — a live offseason or preseason
 *     Week-0 event contributes nothing to `touchedTeamsByAlgorithm`, so it
 *     can never move the season leaderboard;
 *   - the per-team artifact's own `seasonStats.record` — `incrementRecord`
 *     skips an unofficial match outright.
 *
 * A live offseason event still folds its matches into per-event and per-team
 * artifacts normally — match rows and metric-history rows are written exactly
 * as before. Only the summary record is scoped.
 *
 * An unknown event type (the `-1` "detail fetch failed" sentinel) is treated
 * as official at BOTH gates, so a failed TBA detail fetch degrades toward
 * keeping the leaderboard updated rather than toward silently freezing it.
 *
 * OFF-SEASON DEMO TEAM EXCLUSION: `packages/core/algorithms/demoTeams.ts`'s
 * predicates are already applied INSIDE every published algorithm's
 * `update()`/`predict()` (via `ratingEligibleTeams`), so no raw demo team key
 * ever enters an algorithm's own per-team state or design matrix, and a
 * fully-demo alliance is already a no-op fold — nothing in THIS file needs
 * to re-implement either of those. What this file alone is responsible for
 * is `touchedTeams` (`processEvent` below), the RAW per-match roster used to
 * (a) decide which "team" scope keys Phase A reads/initializes in D1 and (b)
 * which `team/{teamKey}/{year}` artifacts Phase B writes. `realTouchedTeams`
 * strips every demo key out of that list BEFORE either use — the same choke
 * point `publish.ts`'s `teamsThisSeason` is for the offline path — so a demo
 * key can neither acquire its own D1 state row nor produce a published team
 * page. The RAW `touchedTeams` list is still passed to `mergeEventArtifact`
 * unfiltered, matching `publish.ts`'s own unfiltered `eventTeamKeys` — event
 * pages are deliberately untouched by this exclusion.
 */
import { opr } from "../../../packages/core/algorithms/opr.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { epa } from "../../../packages/core/algorithms/epa.js";
import { toLeakProofUpcoming } from "../../../packages/core/algorithms/leakProof.js";
import { isOfficialEventType } from "../../../packages/core/algorithms/eventTypes.js";
import type { AlgorithmModule, MatchResult, Prediction, TeamMetric, UpcomingMatch } from "../../../packages/core/algorithms/types.js";
import { tbaMatchListSchema } from "../../../packages/ingest/schemas.js";
import { tbaEventSchema } from "../../../packages/ingest/schemas.js";
import { normalizeMatch, type CorpusMatch } from "../../../packages/ingest/normalize.js";
import { fetchEventDetail } from "../../../packages/ingest/tbaClient.js";
import { isDemoTeamKey } from "../../../packages/core/algorithms/demoTeams.js";
// Dependency-free comp-level predicate (rp/constants.ts has zero runtime
// imports) — the same direct-from-core precedent
// apps/web/src/components/event/EventMatchTable.tsx already cites.
import { isBonusRpCompLevel, isRpEligibleEventType } from "../../../packages/core/rankingPoints/constants.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import { RpMomentsAccumulator } from "../../../packages/core/rankingPoints/empiricalMoments.js";
import { analyticRpPmf } from "../../../packages/core/rankingPoints/analyticPmf.js";
import {
  deserializeState,
  readSigmaBeliefs,
  readSigmaPopulation,
  readRpBeliefs,
  serializeState,
  withRpBeliefs,
  withSigmaBeliefs,
  withSigmaPopulation,
} from "../../../packages/harness/stateSnapshot.js";
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
import { loadAlgorithmsManifest, loadLiveEventsAt } from "./liveWindows.js";
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
 * Only the published SPR algorithm needs real-time folding during a live
 * event — an explicit narrowing over adding per-algorithm cursor
 * granularity. `processEvent`'s `estimatedCost` for ONE ordinary 3v3 match
 * (6 touched teams) is 18 with spr alone vs. 50 with all three published
 * algorithms live, against ~41 subrequests actually available per tick —
 * with all three live the event defers every tick, forever (see
 * `docs/publish-budget.md`'s "Worker runtime budget" section). This does
 * NOT change what is PUBLISHED (opr, epa, spr stay exactly as published);
 * it only narrows what THIS Worker folds LIVE. opr/epa refresh at the
 * manual pre/post-event-weekend re-baseline instead. Exported so
 * `parseLiveAlgorithmIds`'s unset/empty fallback and this file's own
 * regression test (`liveAlgorithmTier.test.ts`) bind to the SAME default
 * rather than a re-typed copy. This value is validated against
 * `PUBLISHED_ALGORITHM_IDS` (packages/harness/publishedAlgorithms.ts) — a
 * fallback naming a retired id would make an unset LIVE_ALGORITHM_IDS throw
 * `UnknownLiveAlgorithmIdError` on every tick, the misconfiguration this
 * default exists to avoid.
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
 * that folds LIVE this tick. Two decided behaviors, each deliberate:
 *  - Unset or empty (after trimming/dropping blank segments) — falls back to
 *    `DEFAULT_LIVE_ALGORITHM_IDS` AND emits ONE structured
 *    `live-tier-defaulted` warn line (never silent). Defaulting to "all"
 *    would reintroduce the exact defect this fixes; throwing would take the
 *    site's freshness down over a config omission. Only the ids themselves
 *    are logged, never any other binding value.
 *  - An id not in `PUBLISHED_ALGORITHM_IDS` — throws
 *    `UnknownLiveAlgorithmIdError`. A retired id is correctly REJECTED here,
 *    since it is no longer a member of `PUBLISHED_ALGORITHM_IDS`.
 * Called at the TOP of `runTick`, before the live-windows manifest read, so
 * a misconfigured deploy surfaces on the very next tick rather than lying
 * dormant until an event goes live months later.
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

/** Builds exactly the modules `algorithmsManifest` names, at the exact versions/parameters it names — never a second, independently-derived resolution — narrowed to ONLY the ids in `liveAlgorithmIds` (PUBLISHED and FOLDED-LIVE are two different sets; this filter narrows the latter only). Called exactly ONCE per tick; every event this tick reuses the SAME module instances, never rebuilt per event. Throws `EmptyLiveAlgorithmTierError` if the filtered result is empty — see that error's own doc comment for why. */
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
    // Any other id throws. A default branch that built an unknown id as a
    // different model wearing that id would fold live events with the wrong
    // model silently; an unknown id must be loud, not plausible.
    throw new UnknownLiveAlgorithmIdError(entry.id);
  }
  if (modules.size === 0) {
    throw new EmptyLiveAlgorithmTierError();
  }
  return modules;
}

/**
 * Which algorithms keep EVENT-SCOPED state, and therefore need this event's
 * own row loaded before a tick may fold into it.
 *
 * OPR has per-event observations/ratings. EPA and SPR are team-scoped only.
 *
 * A SET rather than a chain of `if`s so a fourth event-scoped algorithm is one
 * entry, not a fourth branch that could be forgotten — the forgetting is the
 * failure mode this constant exists to make hard (see `selectionsFor`).
 */
export const EVENT_SCOPED_ALGORITHM_IDS = new Set(["opr"]);

/**
 * An algorithm's FULL selection list for one event's fold — every scope kind
 * it stores, in ONE `readScopedState` request (never a second call, which
 * would spend a second subrequest; `readScopedState` binds every selection
 * into a single prepared statement, so naming two scope kinds costs exactly
 * what naming one does).
 *
 * DO NOT "SIMPLIFY" THE EVENT SELECTION BACK OUT FOR AN ALGORITHM THAT HAS
 * EVENT-SCOPED STATE. The consequence is not a missing optimization, it is
 * silent data destruction. Without this row loaded, a live tick deserializes
 * with an EMPTY accumulator; `update()` then rebuilds that accumulator from
 * the one or two matches this tick happens to see, and `selectChangedRows`
 * writes the result back — so the event's entire accumulated history is
 * overwritten by a single tick's worth of data, one tick at a time, while
 * every published `±` simultaneously disappears or collapses. Nothing else in
 * the pipeline notices: the rows are well-formed, the tick reports success,
 * and the numbers just quietly become wrong.
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
  // Not-yet-seeded algorithm/scope: cold-start via initState rather than
  // deserializeState, which throws MissingLeagueRowError by design for
  // exactly this case — checking for a league row before calling it is the
  // caller's responsibility. initState's only real consumer of its argument
  // is EPA (seeds teamComponents/teamMatchCounts) — OPR ignores it — so the
  // TEAM selection's own key list (never the event key) is what gets passed.
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
    // DQ keys must be threaded through, never defaulted. All three algorithms
    // call `isFullyDqZeroScoreAlliance(teams, result.redDqs, result.redScore)`
    // in `update()`, and that predicate fails OPEN rather than loudly when the
    // field is absent: `new Set(undefined)` is a legal empty Set, not a throw,
    // so `teams.every(t => dqSet.has(t))` simply returns false. Omitting these
    // two fields therefore did not crash the live fold — it silently skipped
    // the whole-alliance-DQ exclusion that the offline publish path applies,
    // folding a fully-DQ'd zero-score alliance as if it were real play and
    // corrupting those teams' ratings until the next full republish.
    // `normalizeMatch` has always produced both from TBA's `dq_team_keys`
    // (see its call in `refreshEvent`), so the data was in hand the whole time.
    redDqs: match.redDqs,
    blueDqs: match.blueDqs,
    eventType,
    // Threaded, never defaulted, for the same reason the DQ keys above are.
    // `null` is the honest "TBA gives this event no week" value and is what
    // the unknown case supplies; `0` is NOT an acceptable stand-in, because
    // corpus week 0 is a REAL week (it is Statbotics' week 1, see
    // `packages/core/algorithms/epaWeekOne.ts`) and a fabricated `0` here
    // would enrol a championship match in the week-1 calibration population
    // on the live path while the offline publisher excluded it.
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

function toUpcomingMatch(match: CorpusMatch, eventType: number, week: number | null): UpcomingMatch {
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
    /** See `toMatchResult`'s `week` comment — same contract, same null policy. */
    week,
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
 * The predicted per-bonus marginals for one live row — the same gated
 * spread `publish.ts`'s `eventMatchBonusRpFields` applies (comp-level gate
 * AND presence, `roundProbability` per entry). The ACTUAL per-bonus flags
 * are deliberately NOT built here: they require parsing the score breakdown
 * through the season's RP rule module, which this Worker does not do — the
 * offline republish fills `actualRedBonusRp`/`actualBlueBonusRp` on played
 * rows, and until then the client renders the actual dots `unknown`, the
 * designed degradation.
 */
function liveBonusRpFields(compLevel: MatchResult["compLevel"], prediction: Prediction) {
  return {
    ...(isBonusRpCompLevel(compLevel) && prediction.redBonusRp ? { redBonusRp: prediction.redBonusRp.map((p) => roundProbability(p)) } : {}),
    ...(isBonusRpCompLevel(compLevel) && prediction.blueBonusRp ? { blueBonusRp: prediction.blueBonusRp.map((p) => roundProbability(p)) } : {}),
  };
}

/**
 * One alliance-pair's PUBLISHED Match Band for one match — each side's
 * display variance as `sigmaMatchBandVariance(roster size, Σ its robots'
 * Sigma Score²)`, walk-forward as of that match. Sigma algorithms only: an
 * OPR or EPA match gets an empty band and its rows carry no band keys.
 * Never the win-odds variance `rpFieldsFor` reads — that is the uncorrected
 * sum and stays inside the tick.
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
  readonly upcomingPredictions: Map<string, Prediction>;
  readonly touchedMetrics: Record<string, Record<string, TeamMetric>>;
  /** Match Band per newly-folded match key (shape 10). */
  readonly newBands: ReadonlyMap<string, MatchBand>;
  /** Match Band per still-upcoming match key (shape 10). */
  readonly upcomingBands: ReadonlyMap<string, MatchBand>;
  /**
   * This algorithm's Sigma Score per REAL touched team, read at END OF TICK
   * — the SAME instant `touchedMetrics` is read, so Total and Sigma on a
   * live-written row always pair from one instant. Empty for an algorithm
   * outside `SIGMA_SCORE_ALGORITHM_IDS` (`usesSigmaScore` false), never
   * merely omitted.
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
    // A PLAYED row must carry the pmf pair too: a rewind start match is the
    // common case, 1,312 of 1,353 corpus events having no unplayed
    // qualification match at all. See `EventMatchSchema.redRpPmf`'s own doc
    // comment.
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    // The RP decomposition, read straight off `prediction` and never gated
    // on competition level — a gate here would make this the only surface
    // in the pipeline that drops what the model returned. Same three lines
    // `publish.ts`'s own two row builders carry, so a live row and an
    // offline row for the same match agree.
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

function buildEventUpcomingRow(match: UpcomingMatch, prediction: Prediction, band: MatchBand | undefined) {
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
    redRpPmf: prediction.redRpPmf ? roundPmf(prediction.redRpPmf) : undefined,
    blueRpPmf: prediction.blueRpPmf ? roundPmf(prediction.blueRpPmf) : undefined,
    // Same three lines `publish.ts`'s own two row builders carry, so a live
    // row and an offline row for the same match agree.
    matchOutcomePmf: prediction.matchOutcomePmf ? roundPmf(prediction.matchOutcomePmf) : undefined,
    redBonusRpPmf: prediction.redBonusRpPmf ? roundPmf(prediction.redBonusRpPmf) : undefined,
    blueBonusRpPmf: prediction.blueBonusRpPmf ? roundPmf(prediction.blueBonusRpPmf) : undefined,
    ...liveBonusRpFields(match.compLevel, prediction),
    ...matchBandFields(band),
  };
}

/**
 * `{ win, tie }` from the first prediction (played, then upcoming) carrying
 * both outcome-RP vectors. A deliberate small reimplementation of
 * `publish.ts`'s module-private `findRpOutcomeRp` — that function is not
 * exported and `publish.ts` cannot be imported here (it pulls
 * `packages/corpus/db.ts` and `better-sqlite3` into apps/worker's
 * Cloudflare-typed program). Reads the SAME `redOutcomeRp[0]`/`[1]`
 * positions, which `sigmaScoutLayer.ts` composes as `[winRp, tieRp, 0]`.
 */
function findRpOutcomeRp(
  played: readonly Prediction[],
  upcoming: readonly Prediction[]
): { win: number; tie: number } | undefined {
  for (const prediction of [...played, ...upcoming]) {
    const { redOutcomeRp, blueOutcomeRp } = prediction;
    if (redOutcomeRp !== undefined && blueOutcomeRp !== undefined) {
      return { win: redOutcomeRp[0]!, tie: redOutcomeRp[1]! };
    }
  }
  return undefined;
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
  readonly newBands: ReadonlyMap<string, MatchBand>;
  readonly upcomingBands: ReadonlyMap<string, MatchBand>;
  readonly stamp: Stamp;
}

/** Read-modify-write merge: replaces newly-folded matches (removing them from `upcoming`), refreshes touched teams' standings rows, and preserves everything else from `existing` unchanged. Bootstraps a schema-valid (but degraded — no history this Worker cannot see) artifact when `existing` is `undefined`. */
function mergeEventArtifact(params: MergeEventArtifactParams): unknown {
  const { existing, eventKey, season, algorithmId, algorithmVersion, newlyFolded, newPredictions, stillUpcoming, upcomingPredictions, touchedTeams, touchedMetrics, newBands, upcomingBands, stamp } = params;

  const newMatchKeys = new Set(newlyFolded.map((m) => m.matchKey));
  const preservedMatches = (existing?.matches ?? []).filter((m) => !newMatchKeys.has(m.matchKey));
  const matches = [...preservedMatches, ...newlyFolded.map((m) => buildEventMatchRow(m, newPredictions.get(m.matchKey)!, newBands.get(m.matchKey)))];

  const upcoming = stillUpcoming.map((m) => buildEventUpcomingRow(m, upcomingPredictions.get(m.matchKey)!, upcomingBands.get(m.matchKey)));

  // This season's own win/tie RP constants, published ONCE PER ARTIFACT.
  // Derived exactly as `publish.ts`'s `findRpOutcomeRp` derives it — off
  // `redOutcomeRp[0]`/`[1]`, which are `winRp`/`tieRp` by construction —
  // rather than from a literal or a second season lookup, so the live and
  // offline artifacts cannot disagree about a season constant. Falls back to
  // whatever the existing artifact already carried, and stays ABSENT when
  // neither source has it.
  const rpOutcomeRp =
    findRpOutcomeRp([...newPredictions.values()], [...upcomingPredictions.values()]) ?? existing?.rpOutcomeRp;

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
        // Quick task 260913-jkp: carries the prior row's published Sigma
        // entry forward — see `touchedEventTeamMetrics` for why (a live tick
        // computes no season-final Sigma of its own).
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
    matches,
    upcoming,
    teams,
    ...(rpOutcomeRp !== undefined ? { rpOutcomeRp } : {}),
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

/**
 * Quick task 260908-615: OFFICIAL play only. An offseason or preseason
 * Week-0 match returns the record unchanged, matching what `publish.ts`
 * writes offline (`teamStatsOfficial`) — without this gate the live merge
 * would re-introduce, one tick at a time, exactly the offseason wins the
 * offline publisher had just stopped counting, and the two would silently
 * disagree about the same team's record.
 *
 * The test is per-match and inside the fold loop rather than a boolean
 * threaded down from the caller, so an unknown/sentinel event type (`-1`,
 * "event detail fetch failed") degrades toward COUNTING the match — the
 * same direction `isOfficialEventType` documents and the same direction the
 * teams-artifact feed's own gate already takes.
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
  /** Match Band per newly-folded match key (shape 10). */
  readonly bands: ReadonlyMap<string, MatchBand>;
  readonly stamp: Stamp;
  /**
   * Quick task 260913-m45 Task 2: this team's Sigma Score at the SAME
   * instant as `metrics` (end of tick), used ONLY on this tick's NEW
   * metric-history rows below. `seasonStats` keeps the publisher's
   * season-final, tiered Sigma, which `touchedEventTeamMetrics` carries
   * forward — putting this value into `metrics` instead would replace that
   * entry, which is why it travels separately. REQUIRED (may be
   * `undefined`) so no caller can opt out by omission.
   */
  readonly sigmaAfterTick: number | undefined;
}

/**
 * Read-modify-write merge for one team's season artifact: appends this tick's
 * newly-folded matches at `eventKey` (creating the event's entry if this is
 * the team's first match there), refreshes `seasonStats`, and appends
 * metric-history rows.
 *
 * Exported for `test/scheduled.officialRecord.test.ts`, which pins the one
 * asymmetry this function carries: an offseason match's rows ARE appended
 * while the summary record is NOT incremented. Driving that assertion
 * through `runTick` would need the whole D1/R2/KV fake rig to prove a
 * property of ten lines of pure merge logic.
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
      : existingEvents.map((e, i) => (i === eventIndex ? { ...e, matches: [...e.matches, ...newRows] } : e));

  // `sigmaAfterTick` is appended as the LAST metrics key on every NEW row
  // this tick writes, ONLY when defined — an algorithm outside
  // `SIGMA_SCORE_ALGORITHM_IDS` passes `undefined` and appends nothing.
  // Existing rows (built before this tick, whether or not they carry sigma)
  // are untouched below, via the leading `existing?.metricHistory` spread.
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

  // The leading spread is load-bearing, not tidiness: a fresh object naming
  // only the fields below would DROP every OTHER field the offline
  // publisher wrote the first time a live tick touched a team — `ranks`
  // (rank cards), `robotImageUrl` (photo, replaced by the no-photo tile),
  // `activeYears` (year dropdown) — for the rest of the event, until the
  // next offline publish put them back.
  //
  // `existing` has already been through `TeamSeasonArtifactSchema.parse`, which
  // strips unknown keys, so this spread carries exactly the schema's own
  // optional fields and cannot smuggle anything else onto the wire.
  //
  // EVERY field this tick genuinely recomputes is still listed explicitly
  // BELOW the spread, and must stay listed: a reader has to be able to see what
  // a tick owns without diffing against the schema. Adding a field here is how
  // the drop happens again — if a future field is tick-owned, name it; if it is
  // publisher-owned, the spread already handles it.
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
    // Carries the prior `seasonStats.metrics` Sigma entry forward — see
    // `touchedEventTeamMetrics`. Keeps the team page's Total tile pill
    // visible during a live event; the tile reads this field directly.
    seasonStats: { record, metrics: touchedEventTeamMetrics(existing?.seasonStats.metrics, metrics) },
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
 * Overlap-safety anchor: an optimistic compare-and-swap on
 * `event_cursor.last_folded_match_key`. Two genuinely overlapping
 * invocations both reading the SAME prior cursor value and both proceeding
 * to fold the SAME matches would otherwise be possible — a plain "read
 * cursor, do work, write cursor" sequence has a window between the read and
 * the write where a second invocation's own read/write can land in between,
 * causing it to read the FIRST invocation's already-advanced state as its
 * own "prior" and fold the same match again on top of it. This function
 * closes that window by making the CURSOR ADVANCE ITSELF the atomic claim,
 * performed BEFORE any state is read: only the invocation whose
 * `UPDATE ... WHERE last_folded_match_key IS <the value we read>` actually
 * matches a row gets to proceed; a second invocation's identical attempt
 * (now `IS` a value that no longer matches, since the first already wrote
 * its new value) affects zero rows and returns `false`.
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
// Subrequest budget estimate — extracted so `processEvent` and this file's
// regression test (`liveAlgorithmTier.test.ts`) bind to the SAME formula;
// see this module's header for the atomicity/budget reasoning.
// ---------------------------------------------------------------------------

/** `runTick`'s own three fixed `consume(1)` calls, paid before any event-specific work: the live-windows manifest read, the algorithms manifest read, and the tick-meta read (see `runTick`'s "Step 1" / "something is live" comments below). Pinned to the real deployed Worker's measured `subrequestsUsed` for an idle/unchanged tick by this file's regression test — never re-typed without re-measuring on a deployed Worker. */
export const TICK_FIXED_SUBREQUEST_COST = 3;

/** `processEvent`'s own fixed cost, spent BEFORE the estimate check below: the cursor-CAS-gate read (`tryConsume(1)`) and the TBA poll (`tryConsume(1)`). */
export const EVENT_PREFLIGHT_SUBREQUEST_COST = 2;

/**
 * The whole event's remaining subrequest cost, estimated up front — see
 * this module's header for why all-or-nothing-per-event atomicity is the
 * safe choice. `processEvent` below is this function's ONLY caller; the
 * regression test in `liveAlgorithmTier.test.ts` binds to this SAME function
 * rather than a re-typed copy of the arithmetic — re-typing a
 * plausible-looking formula is how a live-folding-defers-forever defect
 * could survive undetected.
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
    // The Worker has no corpus access and the live-windows manifest does not
    // carry the event's real start_date (only its derived live window) —
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
    // Off-season demo team exclusion (see this module's header) — every one
    // of the 30 `frc9970`-`frc9999` keys stripped out BEFORE `touchedTeams`
    // drives any D1 state read/init or any `team/{teamKey}/{year}` artifact
    // write. `touchedTeams` itself stays RAW for the event artifact's own
    // standings row below.
    const realTouchedTeams = touchedTeams.filter((teamKey) => !isDemoTeamKey(teamKey));
    const lastFoldedMatchKey = newlyFolded[newlyFolded.length - 1]!.matchKey;

    // Estimate the WHOLE event's remaining subrequest cost up front — see
    // this module's header for why atomicity (all-or-nothing per event) is
    // the safe choice here. Sized off `realTouchedTeams`, not the raw
    // roster — Phase B never spends a read+write pair on any demo key.
    const algorithmCount = algorithmModules.size;
    const estimatedCost = estimateEventSubrequestCost(algorithmCount, realTouchedTeams.length);
    if (budget.remaining < estimatedCost) {
      return { status: "deferred" };
    }

    // Claim this fold BEFORE any state is read (overlap safety — see
    // claimEventAdvance's own header). A lost claim means another
    // invocation already advanced (or is advancing) this event past where
    // we started; its work supersedes ours this tick.
    budget.consume(1);
    const claimed = await claimEventAdvance(env.DB, eventKey, cursor.lastFoldedMatchKey, lastFoldedMatchKey, poll.etag ?? cursor.tbaEtag, nowIso);
    if (!claimed) {
      return { status: "unchanged" };
    }

    try {
      // Reuse the SAME TBA client/counter for the event's `event_type`
      // (only `isRpEligibleEventType`'s RP eligibility gate reads it — the
      // live-windows manifest doesn't carry it). Degrades gracefully (RP
      // simply comes out ineligible) rather than failing the whole event on
      // a transient failure here.
      budget.consume(1);
      let eventType = -1;
      // `null`, not `-1`, is this field's unknown value — `week` is genuinely
      // nullable in TBA's own contract (`tbaEventSchema.week` is
      // `z.number().nullish()`), so there is no sentinel to borrow and none is
      // invented. A failed detail fetch therefore leaves the week UNPLACED,
      // which `epaWeekOne.ts`'s null policy already handles: an unplaced match
      // is neither week 1 nor after it, so it neither joins the week-1
      // population nor triggers the freeze.
      let week: number | null = null;
      try {
        const detail = await fetchEventDetail(tbaCtx, eventKey);
        if (detail.status === 200) {
          const parsed = tbaEventSchema.parse(detail.body);
          eventType = parsed.event_type;
          week = parsed.week ?? null;
        }
      } catch {
        // degrade gracefully — see comment above
      }

      const newlyFoldedResults = newlyFolded.map((m) => toMatchResult(m, eventType, week));
      const stillUpcomingViews = stillUpcoming.map((m) => toUpcomingMatch(m, eventType, week));

      // PHASE A — every algorithm reads, folds, and writes state. ALL must
      // succeed before ANY artifact write (see this module's header).
      const perAlgorithm = new Map<string, PerAlgorithmFold>();

      for (const [algorithmId, algorithm] of algorithmModules) {
        // `realTouchedTeams` (demo keys stripped) — see this module's header
        // and gap-1 comment above: a demo key must never seed a `team` scope
        // row via `algorithm.initState` at cold start.
        const selections = selectionsFor(algorithmId, eventKey, realTouchedTeams);

        budget.consume(1);
        const { rows, state: initialState } = await loadOrInitState(env.DB, algorithmId, selections, algorithm);

        let state = initialState;
        // SIGMA SCORE, for the algorithms that publish it (SPR today). RESUMED
        // from the beliefs seeded into these very rows rather than started
        // fresh — a fresh one would produce a band from this event's matches
        // alone while the offline publisher's came from the whole season — and
        // WITH the population statistics the talent prior needs: without them
        // the prior silently falls back to its flat form
        // (`MIN_POPULATION_FOR_TALENT_PRIOR`) and every band this tick writes
        // would differ from the publisher's while looking healthy.
        const sigma = usesSigmaScore(algorithmId)
          ? SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs(rows), readSigmaPopulation(rows))
          : undefined;
        // One alliance's WIN-ODDS variance, from the Sigma accumulator, or
        // `undefined` for an algorithm without one (OPR, EPA — which since quick
        // task 260913-it4 publish no ranking-point odds). ONE accessor so the
        // played loop and the upcoming loop cannot disagree. This is what
        // `rpFieldsFor` reads; the published display band is derived from it
        // by `displayBandFor` below.
        const winOddsVarianceFor = (roster: readonly string[]): number | undefined =>
          sigma === undefined ? undefined : sigma.bandVarianceFor(roster);
        // The published Match Band for one match, through the SAME helper
        // `SigmaScoutLayer.foldPlayed` / `enrichUpcoming` use offline, so a live
        // band and an offline band cannot drift. OPR and EPA publish none.
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

        // RANKING POINTS. Resumed from the very same rows, for the identical
        // reason the Sigma accumulator above is: a cold-started accumulator
        // would price this match from THIS EVENT's matches alone while the
        // offline publisher priced it from the whole season, and an RP pmf
        // that is wrong is still a valid distribution — it sums to 1 and
        // renders without complaint.
        //
        // The rule-module lookup is INDEXED, not `rpRuleModuleForSeason`,
        // which THROWS for an unmapped season. A season with no registered
        // rules (2021, and anything before the vocabulary starts) must yield
        // no accumulator and no RP at all rather than taking the whole tick
        // down — the same "absent feature, not empty feature" construction
        // `SigmaScoutLayer`'s own constructor performs. Likewise an algorithm
        // that publishes no ranking points (`publishesRankingPoints`) gets no
        // accumulator, and its rows carry no RP passenger.
        const rpRuleModule = publishesRankingPoints(algorithmId) ? RP_RULE_MODULES[window.season] : undefined;
        const rpBeliefs = readRpBeliefs(rows);
        const rp = rpRuleModule !== undefined ? RpMomentsAccumulator.fromBeliefs(rpRuleModule, rpBeliefs) : undefined;
        // Teams whose beliefs this tick actually resumed, plus the teams it
        // folds as it goes. The partial-roster gate below reads this; see its
        // own comment for why an unresumed team must suppress the pmf rather
        // than silently contribute nothing to it.
        const rpKnownTeams = new Set(rpBeliefs.keys());

        // ONE accessor for this tick's RP, alongside `winOddsVarianceFor` and for the
        // identical stated reason: the played loop, the upcoming loop and the
        // persisted rows cannot be allowed to disagree about what RP means
        // this tick. Field-for-field the same call
        // `SigmaScoutLayer.#rpFieldsFor` makes offline — read the two together
        // if either changes.
        const rpFieldsFor = (
          view: { redTeams: readonly string[]; blueTeams: readonly string[]; eventType: number; matchKey: string; compLevel: MatchResult["compLevel"] },
          prediction: Prediction,
          redBandVariance: number | undefined,
          blueBandVariance: number | undefined
        ): Partial<Prediction> => {
          if (rp === undefined || rpRuleModule === undefined) return {};
          if (!isRpEligibleEventType(view.eventType)) return {};
          if (redBandVariance === undefined || blueBandVariance === undefined) return {};
          // THE PARTIAL-ROSTER GATE — the RP counterpart of
          // `allianceSigmaBandVariance`'s all-or-nothing rule.
          //
          // The Worker reads state only for the teams touched by THIS tick's
          // newly-folded matches, so an upcoming match can name a team whose
          // row was never loaded. `momentsFor` sums silently over whatever
          // beliefs it finds, so a partially-resumed roster yields a
          // NARROWER, MORE CONFIDENT pmf than the truth, with nothing
          // anywhere reporting a problem.
          //
          // Deliberately MORE CONSERVATIVE than the offline path, which
          // always has the whole season's roster in hand. The conservative
          // direction — an absent pmf rather than a wrong one — is the same
          // direction every other gate in this file takes.
          for (const teamKey of [...view.redTeams, ...view.blueTeams]) {
            if (!rpKnownTeams.has(teamKey)) return {};
          }

          const pmf = analyticRpPmf({
            red: rp.momentsFor(view.redTeams, prediction.redScore, redBandVariance),
            blue: rp.momentsFor(view.blueTeams, prediction.blueScore, blueBandVariance),
            ruleModule: rpRuleModule,
            eventType: view.eventType,
            compLevel: view.compLevel,
            // WIN SHIPPED 2026-09-13 (quick task 260913-qyn) — mirrors
            // `SigmaScoutLayer.#rpFieldsFor` exactly, field for field.
            pRedWin: prediction.pRedWin,
          });

          // The five decomposition fields, composed exactly as
          // `SigmaScoutLayer.#rpFieldsFor` composes them — winRp/tieRp read
          // off THIS season's own rule module, never hardcoded (2/1 in
          // 2016-2024, 3/1 in 2025-2026). Gated on the decomposition actually
          // being present; absent stays absent rather than becoming empty.
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
          // Read the win odds BEFORE folding this match in, in the same place
          // `predict` already happens — predict-before-update, for the same
          // reason: a band says how unsure we were when we predicted this, and
          // this match's own result is not an admissible input to that.
          const redWinOddsVariance = winOddsVarianceFor(result.redTeams);
          const blueWinOddsVariance = winOddsVarianceFor(result.blueTeams);
          newBands.set(result.matchKey, displayBandFor(result, redWinOddsVariance, blueWinOddsVariance));
          // RP from the PRE-FOLD accumulator, same predict-before-update
          // position as the band above. The ENRICHED prediction is what goes
          // into `newPredictions`, never a parallel map: all three row
          // builders read this same `Prediction`, so a field attached once
          // here reaches every one of them — `sigmaScoutLayer.ts`'s own
          // discipline applied inside the Worker.
          newPredictions.set(result.matchKey, {
            ...prediction,
            ...rpFieldsFor(result, prediction, redWinOddsVariance, blueWinOddsVariance),
          });
          state = algorithm.update(state, result);
          sigma?.foldMatch(result, prediction);
          foldObservedRp(result);
          // Talent AFTER the fold, read from the post-update state — the exact
          // ordering `SigmaScoutLayer.foldPlayed` uses offline. Talent as of
          // after this match is admissible evidence for the team's NEXT match
          // and never for this one, so applying it before the fold would let a
          // match inform its own prior and put live out of step with offline.
          if (sigma !== undefined) {
            const roster = [...result.redTeams, ...result.blueTeams];
            const metrics = algorithm.teamMetrics(state, roster);
            for (const teamKey of roster) {
              const total = metrics[teamKey]?.[TOTAL_METRIC_KEY]?.value;
              if (total !== undefined) sigma.observeTalent(teamKey, total);
            }
          }
        }

        const upcomingPredictions = new Map<string, Prediction>();
        const upcomingBands = new Map<string, { red?: number; blue?: number }>();
        for (const match of stillUpcomingViews) {
          const prediction = algorithm.predict(state, match);
          // Read only — an unplayed match has no residual of its own, so its
          // win odds and band are built from everything played so far.
          const redWinOddsVariance = winOddsVarianceFor(match.redTeams);
          const blueWinOddsVariance = winOddsVarianceFor(match.blueTeams);
          upcomingBands.set(match.matchKey, displayBandFor(match, redWinOddsVariance, blueWinOddsVariance));
          // Read-only for RP too: an unplayed match has no result to fold.
          // This is what makes `buildEventUpcomingRow`'s already-present pmf
          // field lines carry real values instead of `undefined`.
          upcomingPredictions.set(match.matchKey, {
            ...prediction,
            ...rpFieldsFor(match, prediction, redWinOddsVariance, blueWinOddsVariance),
          });
        }

        const touchedMetrics = algorithm.teamMetrics(state, touchedTeams);
        // Quick task 260913-m45 Task 2: read directly after `touchedMetrics`
        // above — same instant, same one-read-per-team cost, zero added
        // subrequests (`sigma.sigmaFor` is the accumulator's own read-only
        // accessor, so this creates no belief). Scoped to `realTouchedTeams`
        // (demo keys excluded), matching `mergeTeamSeasonArtifact`'s own
        // per-team loop below, which is the only consumer.
        const touchedSigma = new Map<string, number>();
        if (sigma !== undefined) {
          for (const teamKey of realTouchedTeams) touchedSigma.set(teamKey, sigma.sigmaFor(teamKey));
        }

        // The beliefs ride back into the rows after the algorithm serializer
        // has run, so no algorithm's serializer knows they exist.
        let candidateRows = serializeState(algorithmId, algorithm.version, state, stamp);
        // The RP passenger rides back in the same way and in the same place
        // (shape 15) — after `serializeState`, so no algorithm's serializer
        // knows the key exists, and at zero additional D1 subrequests: these
        // are the rows the tick already reads and already writes back.
        if (rp !== undefined) candidateRows = withRpBeliefs(candidateRows, rp.beliefsByTeam());
        if (sigma !== undefined) {
          candidateRows = withSigmaPopulation(withSigmaBeliefs(candidateRows, sigma.beliefsByTeam()), sigma.population());
        }
        const changedRows = selectChangedRows(rows, candidateRows);

        budget.consume(1);
        await writeScopedState(env.DB, changedRows); // may throw -- caught below, reverts the claim and aborts the WHOLE event (zero artifact puts)

        perAlgorithm.set(algorithmId, { algorithm, newPredictions, upcomingPredictions, touchedMetrics, newBands, upcomingBands, touchedSigma });
      }

      return await runPhaseBAndReport(env, budget, window, eventKey, eventType, newlyFoldedResults, stillUpcomingViews, touchedTeams, realTouchedTeams, matchIndexByKey, perAlgorithm, touchedTeamsByAlgorithm, stamp, stillUpcoming.length === 0);
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
    // Without this, a per-event failure is completely invisible — the tick
    // itself still logs `"ok":true` (the TICK didn't throw, only this one
    // event's processing did), leaving `docs/worker-operations.md`'s
    // troubleshooting table with nothing to point an operator at. Never the
    // TBA key, never a response header/body — only the event key and the
    // caught error's own message, matching `TbaPollError`'s own naming
    // discipline.
    console.error(JSON.stringify({ msg: "event-failed", eventKey, error: err instanceof Error ? err.message : String(err) }));
    return { status: "failed" };
  }
}

/** PHASE B — artifact writes, best-effort, factored out only so `processEvent`'s Phase-A try/catch (which must revert the CAS claim on failure) does not also have to special-case Phase B's own best-effort try/catch. A failure inside Phase B does not change the event's "advanced" outcome (state has genuinely advanced); a skipped artifact stays one tick stale until this team's next match at this event, per this module's header's documented limitation.
 *
 * `touchedTeams` (RAW roster) feeds ONLY the event artifact's own standings
 * row, matching `publish.ts`'s unfiltered `eventTeamKeys` (event pages are
 * deliberately untouched by the demo-team exclusion). `realTouchedTeams`
 * (demo keys stripped, see this module's header) is what actually drives
 * `team/{teamKey}/{year}` writes.
 *
 * `eventType` (the TBA event-detail type `processEvent`
 * already resolved, including its `-1` "detail fetch failed" degradation
 * sentinel — passed through explicitly rather than re-derived from
 * `newlyFoldedResults[0]`, which can be empty) gates ONLY the
 * `touchedTeamsByAlgorithm` contribution below — the feed `runGlobalRebuild`
 * folds into `teams/{year}`. `mergeEventArtifact`'s `event/{eventKey}` write
 * and `mergeTeamSeasonArtifact`'s `team/{teamKey}/{year}` write both stay
 * unconditional: an offseason or preseason event must still be fully visible
 * on its own event page and on every participating team's page — it must
 * only stop moving the season leaderboard. An unknown type (`-1`) is treated
 * as official, matching `isOfficialEventType`'s own degrade-toward-updating
 * contract. */
async function runPhaseBAndReport(
  env: Env,
  budget: SubrequestBudget,
  window: LiveWindowEntry,
  eventKey: string,
  eventType: number,
  newlyFoldedResults: readonly MatchResult[],
  stillUpcomingViews: readonly UpcomingMatch[],
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
        newlyFolded: newlyFoldedResults,
        newPredictions: info.newPredictions,
        stillUpcoming: stillUpcomingViews,
        upcomingPredictions: info.upcomingPredictions,
        newBands: info.newBands,
        upcomingBands: info.upcomingBands,
        touchedTeams,
        touchedMetrics: info.touchedMetrics,
        stamp,
      });
      await writeArtifactObject(env, budget, "event", eventParams, mergedEvent);

      // Quick task 260904-586: ONLY this contribution — the feed
      // `runGlobalRebuild` folds into `teams/{year}` — is gated on
      // officialness. `mergeTeamSeasonArtifact`'s `team/{teamKey}/{year}`
      // write just below stays unconditional (see this function's own doc
      // comment).
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
          // Quick task 260913-m45 Task 2: end-of-tick Sigma for THIS team,
          // read at the same instant as `touchedMetrics` above.
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
    // Best-effort — state already advanced correctly; some artifacts may
    // lag until this team's next match at this event (documented above).
  }

  return { status: "advanced", eventComplete };
}

// ---------------------------------------------------------------------------
// The slower-cadence global rebuild (see this module's header for scope)
// ---------------------------------------------------------------------------

/** One record-form teams-row metric entry, as `runGlobalRebuild` holds it. */
type TierableTeamMetric = { value: number; spread?: number; percentile?: number; tier?: "rare" | "epic" | "legendary" };

/**
 * The metrics record `runGlobalRebuild` writes for a TOUCHED teams row, so a
 * live update never paints a false Common on a team the last publish tiered.
 *
 * - Every freshly computed entry (`roundTeamMetricRecord(info.metrics)`) keeps
 *   the prior row's published `tier` for the SAME key when the prior row has
 *   that entry and it carries a tier. A key the prior row lacks gets no tier,
 *   and "common" is never written (absence means Common or unranked).
 * - The prior row's `SIGMA_METRIC_KEY` entry (value and tier) is carried
 *   forward unchanged: the live tick does not compute the season-final
 *   consistency figure, so the published one is kept rather than dropped.
 *
 * This is a CARRY-FORWARD fallback, not the preferred re-derivation, and the
 * choice was MEASURED, not assumed: re-deriving every row's tier from the
 * rows' own values with the pipeline's single ranking helper
 * (`percentiles.ts`'s `sortedPoolsByMetric` + `goodnessPercentileAgainstPools`,
 * then `publishedTierForPercentile`) is offline-identical by construction, but
 * measured at 67-97% of the rebuild's existing CPU-bound cost against a 25%
 * gate.
 *
 * Honest limitation, kept visible: a carried tier is the LAST PUBLISHED one.
 * A touched team whose value crossed a tier cut keeps its old tier until the
 * next offline publish, the other rows' tiers are not re-ranked against its
 * new value, and a team with no prior teams row gets no tier at all.
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
  // the consistency metric keeps publish.ts's position at the end of the record.
  for (const key of [SIGMA_METRIC_KEY]) {
    const carried = priorMetrics?.[key];
    if (carried !== undefined && !(key in result)) result[key] = carried;
  }
  return result;
}

/** One prior published metric entry as `touchedEventTeamMetrics` reads it — the shape `EventTeamSchema.metrics`/`TeamSeasonArtifactSchema.seasonStats.metrics` already carry (value, an optional spread, an optional percentile). Never a `tier`: that field is teams-row-only (`TierableTeamMetric`), and the event/team-season artifacts publish `percentile` instead. */
type PublishedEventTeamMetric = { value: number; spread?: number; percentile?: number };

/**
 * The metrics record `mergeEventArtifact` and `mergeTeamSeasonArtifact`
 * write for a TOUCHED team, so a live tick never strips a published Sigma
 * Score off that team's event standings row or its team-season
 * `seasonStats` until the next offline publish.
 *
 * Every freshly computed entry is rounded exactly as `roundTeamMetricRecord`
 * already rounds it (this function delegates to it, unchanged). The prior
 * record's `SIGMA_METRIC_KEY` entry — value AND percentile, already rounded
 * at publish time and therefore never re-rounded here — is appended AFTER
 * the fresh entries (so a fresh entry of the same key wins and nothing is
 * carried), only when the prior record actually has that entry and the fresh
 * record lacks the key. This is the same carry-forward shape
 * `touchedTeamsRowMetrics` above already established for the teams row;
 * `roundTeamMetricRecord` itself is untouched; the return type is widened
 * just enough to carry the carried entry's `percentile`.
 *
 * Known limitation, left alone here: a touched team's OTHER metrics already
 * lose their `percentile` on a live tick — the Worker computes none. That
 * loss predates this task and is out of scope for it.
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
 * The slower-cadence rebuild — see this module's header for scope.
 *
 * `existing` is read and decoded through `TeamsArtifactSchema` above, which
 * accepts EITHER shape currently on R2 (object-form or positional) and
 * always hands back the canonical record-form `metrics` this function's
 * merge logic expects. What DOES matter is the write: `rows` here is always
 * record-form (decoded existing rows plus freshly computed touched rows),
 * and every write this Worker makes must be positional — re-encoding, never
 * assuming either shape, is what keeps a live event from corrupting the
 * season's teams artifact.
 *
 * A touched row's metrics go through `touchedTeamsRowMetrics`, which carries
 * the prior row's published tiers and Sigma entry forward instead of
 * dropping them. Zero added subrequests; the added CPU is one small object
 * per touched metric. Full tier re-derivation was measured and rejected on
 * CPU (see that function).
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
        // Leading spread for the same reason as `mergeTeamSeasonArtifact`'s:
        // a row constructed field-by-field would silently lose every
        // optional field the offline publisher wrote — `country`,
        // `stateProv`, `districtKey` (its region, and with it its
        // district/state rank scopes). Tick-owned fields stay listed below.
        return {
          ...prior,
          teamKey,
          teamNumber: prior?.teamNumber ?? fallbackTeamNumber(teamKey),
          nickname: prior?.nickname ?? "",
          // NOT updated here — see this module's header's documented
          // limitation. Preserved from the last offline/incremental value.
          record: prior?.record ?? { wins: 0, losses: 0, ties: 0 },
          // Quick task 260912-tnk: fresh values, with the prior row's
          // published tiers and Sigma entry carried forward — see
          // `touchedTeamsRowMetrics` for why tiers are carried, not re-derived.
          metrics: touchedTeamsRowMetrics(prior?.metrics, roundTeamMetricRecord(info.metrics)),
          eventCount: prior?.eventCount ?? 0,
          matchCount: (prior?.matchCount ?? 0) + info.matchDelta,
        };
      }),
    ];

    // 260902-pbe: re-encode positionally before writing — `rows` above is
    // always canonical record-form (decoded from whichever shape was
    // actually on disk), so every write this Worker makes converges the
    // artifact onto the compact wire shape one incremental rebuild at a
    // time, even during the pre-republish transition.
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
  /** Test-only injection point (defaults to the real `buildAlgorithmModules`) — lets a test wrap it with a call counter to assert modules are constructed ONCE per tick, never once per event (Pitfall 4), without mocking the algorithm modules themselves. */
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
  // `loadLiveEventsAt`, NOT `liveEventsAt(await loadLiveWindowsManifest(...))`:
  // the composed form Zod-validates all ~1,581 windows before answering a
  // question about the two that matter, which alone consumed 50-90% of this
  // tick's entire 10 ms CPU budget and was one of the two causes of the
  // 2026-08-29 outage. Same binding-call count (one), same selected set — see
  // `liveWindows.ts`'s `loadLiveEventsAt` header before changing this back.
  budget.consume(1);
  const liveEvents = await loadLiveEventsAt(env, nowMs);

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
