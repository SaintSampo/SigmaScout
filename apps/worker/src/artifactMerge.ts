/**
 * PHASE B's ARTIFACT MERGE PATH, as a Worker-safe module with no write helper
 * anywhere in its import graph.
 *
 * WHY THIS FILE EXISTS. It was extracted verbatim out of `scheduled.ts` for the
 * read-only CPU-attribution probe deleted by quick task 260923-3w4, which
 * needed to PRICE Phase B by calling THESE functions — the very ones the tick
 * calls — without pulling a write helper into its import graph. THE FILE STAYS,
 * and so does every function in it: quick task 260923-3w4's successor reinstates
 * the tick's per-team artifact writes, and `mergeTeamSeasonArtifact` below is
 * what it reinstates them through. Merging this module back into `scheduled.ts`
 * now would be churn immediately undone.
 *
 * The no-write-helper property is no longer enforced by a test (the probe's own
 * import-graph walk went with it), and nothing depends on it any more. Adding a
 * write helper here is a style question, not a safety one.
 *
 * Everything below is byte-identical in behavior to what `scheduled.ts` held
 * before the extraction. The only changes are three parameter types widened to
 * the fields the function actually reads (`PlayedRowFactsRawMatch`,
 * `PlayedRowFactsFoldedMatch`, `ScheduledMatchFacts`), so a caller holding only
 * those facts does not have to synthesize a whole corpus row. `scheduled.ts`
 * keeps passing its full objects unchanged.
 */
import { isOfficialEventType } from "../../../packages/core/algorithms/eventTypes.js";
import type { MatchResult, Prediction, TeamMetric } from "../../../packages/core/algorithms/types.js";
import { spr } from "../../../packages/core/algorithms/spr.js";
import { RP_RULE_MODULES } from "../../../packages/core/rankingPoints/rules.js";
import type { TbaMatch } from "../../../packages/ingest/schemas.js";
import { tbaReportedMatchTimeMs, type CorpusMatch } from "../../../packages/ingest/normalize.js";
import type { StateRow } from "../../../packages/harness/stateSnapshot.js";
import { completeEventStateBlock, EventStateBlockError, spliceEventStateBlock } from "../../../packages/harness/eventStatePricing.js";
import {
  actualBonusFlagsForMatch,
  eventPlayedRow,
  teamSeasonPlayedRow,
  type ActualBonusFlags,
  type ParsedBonusSides,
} from "../../../packages/harness/publishedRows.js";
import { SIGMA_METRIC_KEY } from "../../../packages/harness/sigmaScore.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION, type LiveEventArtifact, type TeamSeasonArtifact } from "../../../packages/harness/pageArtifacts.js";
import { mergeEventLiveBlock, type EventLiveTickRow } from "../../../packages/harness/liveEventRows.js";
import { roundMetric } from "../../../packages/harness/rounding.js";

// ---------------------------------------------------------------------------
// Narrowed input shapes — the fields each function actually reads, named so a
// caller can see what it must supply without holding a whole corpus row.
// ---------------------------------------------------------------------------

/** What `playedRowFactsFor` reads off a raw TBA match: `key` to index by, plus the three fields `tbaReportedMatchTimeMs` chains through. */
export type PlayedRowFactsRawMatch = Pick<TbaMatch, "key" | "actual_time" | "predicted_time" | "time">;

/** What `playedRowFactsFor` reads off a newly-folded corpus match: `matchKey` to index by, plus `videoKey` for the published row. */
export type PlayedRowFactsFoldedMatch = Pick<CorpusMatch, "matchKey" | "videoKey">;

/** What `mergeEventArtifact` reads off a still-upcoming match: exactly the schedule fields `buildEventScheduledRow` writes, and nothing an outcome could leak through. */
export type ScheduledMatchFacts = Pick<CorpusMatch, "matchKey" | "compLevel" | "setNumber" | "matchNumber" | "redTeams" | "blueTeams">;

// ---------------------------------------------------------------------------
// Rounding — small, deliberate duplication of publish.ts's own helpers:
// publish.ts is Node/corpus-heavy and must never be imported by the Worker.
// ---------------------------------------------------------------------------

export function roundTeamMetricRecord(metrics: Record<string, TeamMetric>): Record<string, TeamMetric> {
  const result: Record<string, TeamMetric> = {};
  for (const [key, m] of Object.entries(metrics)) {
    result[key] = { value: roundMetric(m.value), ...(m.spread !== undefined ? { spread: roundMetric(m.spread) } : {}) };
  }
  return result;
}

/** `frc254` -> `254`. Defensive fallback only, mirrors `publish.ts`'s own `fallbackTeamNumber`. */
export function fallbackTeamNumber(teamKey: string): number {
  const parsed = Number.parseInt(teamKey.replace(/^frc/, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// Artifact merge: read the existing published object (if any) and apply
// only what THIS tick changed — never a full corpus-based rebuild (the
// Worker has no corpus access at all).
// ---------------------------------------------------------------------------

export interface Stamp {
  readonly generation: string;
  readonly computedAt: string;
}

/**
 * One played match's published Match Band: each side's display variance,
 * `sigmaMatchBandVariance(roster size, Σ Sigma Score²)`, walk-forward. Sigma
 * algorithms only; OPR/EPA rows carry no band keys. Never the win-odds
 * variance `rpFieldsFor` reads, which stays inside the tick.
 */
export interface MatchBand {
  readonly red?: number;
  readonly blue?: number;
}

/**
 * The per-match facts a played row needs beyond the prediction, all of them
 * already in this tick's own poll and all algorithm-independent, so Phase B
 * computes them ONCE per tick rather than once per algorithm.
 */
export interface PlayedRowFacts {
  /** TBA's own reported time in ms, or `undefined` when TBA reports none — never `normalizeMatch`'s composite approximation. */
  readonly reportedSortTime: number | undefined;
  readonly video: string | undefined;
  /** `undefined` = no such property (a playoff match, or a season with no rule module); `null` = could not be derived. */
  readonly actualBonusFlags: ActualBonusFlags | null | undefined;
}

/**
 * `PlayedRowFacts` per newly-folded match key. Pure; exported for the parity
 * test. The rule-module lookup INDEXES `RP_RULE_MODULES`, never the throwing
 * `rpRuleModuleForSeason`, for the same reason the fold's own lookup does: an
 * unregistered season must cost the tick nothing.
 */
export function playedRowFactsFor(
  season: number,
  rawMatches: readonly PlayedRowFactsRawMatch[],
  folded: readonly PlayedRowFactsFoldedMatch[],
  results: readonly MatchResult[],
  observedBonusSides: ReadonlyMap<string, ParsedBonusSides> = new Map()
): Map<string, PlayedRowFacts> {
  const rawByKey = new Map(rawMatches.map((m) => [m.key, m]));
  const foldedByKey = new Map(folded.map((m) => [m.matchKey, m]));
  const ruleModule = RP_RULE_MODULES[season];

  const facts = new Map<string, PlayedRowFacts>();
  for (const result of results) {
    const raw = rawByKey.get(result.matchKey);
    const reported = raw === undefined ? null : tbaReportedMatchTimeMs(raw);
    const videoKey = foldedByKey.get(result.matchKey)?.videoKey;
    facts.set(result.matchKey, {
      reportedSortTime: reported === null ? undefined : reported,
      video: videoKey !== null && videoKey !== undefined && videoKey.length > 0 ? videoKey : undefined,
      actualBonusFlags: actualBonusFlagsForMatch(result, ruleModule, observedBonusSides.get(result.matchKey)),
    });
  }
  return facts;
}

/**
 * One still-upcoming match as the tick writes it: schedule fields only. The
 * browser prices it from the artifact's `state` block. `sortTime` is the
 * published value from the existing artifact's row for this match, never
 * the TBA-normalized approximation; absent when that row had none.
 *
 * Exported for `test/matchSplit.test.ts` only: the trimmed and the reference
 * split must agree on the shape that actually reaches an artifact, not merely
 * on the six fields feeding it (260921-vzf). No production caller outside this
 * module.
 */
export function buildEventScheduledRow(match: ScheduledMatchFacts, existingSortTime: number | undefined) {
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

export interface MergeEventArtifactParams {
  readonly existing: LiveEventArtifact | undefined;
  readonly eventKey: string;
  readonly season: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  /** TBA's `event_type` when this tick's event-detail fetch returned 200 and parsed; `undefined` otherwise, never the `-1` sentinel. */
  readonly eventType: number | undefined;
  readonly newlyFolded: readonly MatchResult[];
  readonly newPredictions: ReadonlyMap<string, Prediction>;
  readonly stillUpcoming: readonly ScheduledMatchFacts[];
  readonly touchedTeams: readonly string[];
  readonly touchedMetrics: Readonly<Record<string, Record<string, TeamMetric>>>;
  readonly newBands: ReadonlyMap<string, MatchBand>;
  /** The rows Phase A wrote to D1 for this algorithm this tick. */
  readonly writtenRows: readonly StateRow[];
  /** This tick's per-match facts for the newly-folded matches. Required (an empty map is a valid value) so no caller omits it, as `sigmaAfterTick` is. */
  readonly playedRowFacts: ReadonlyMap<string, PlayedRowFacts>;
  /**
   * The teams whose state this tick actually advanced, which scopes the LIVE
   * BLOCK's rows. Distinct from `touchedTeams` (raw), which scopes the event
   * standings — the same split the deleted sidecar writer drew before quick
   * task 260918-16t moved the rows into this merge.
   */
  readonly realTouchedTeams: readonly string[];
  /** Each touched team's Sigma Score as of the end of this tick, folded into the live block's header as an ORDINARY metric key. Empty for a non-Sigma algorithm. */
  readonly touchedSigma: ReadonlyMap<string, number>;
  /**
   * The byte length of the event body AS READ FROM R2 this tick — `.length` of
   * the text the caller already holds, never a re-serialization. Drives the
   * live block's size trim; see `EVENT_LIVE_BLOCK_TRIM_THRESHOLD_BYTES`. Pass
   * 0 when there was no existing body.
   */
  readonly existingBodyBytes: number;
  readonly stamp: Stamp;
  /**
   * Rows the tick read from D1 THIS tick to complete the state block, and the
   * scope keys it asked for (quick task 260921-5qw). Both absent on an
   * ordinary tick, which reads nothing for the block: `scheduled.ts` asks D1
   * only when `missingStateBlockKeys` names something, and only if a
   * subrequest is free. A key asked for and not returned is recorded absent.
   */
  readonly blockD1Rows?: readonly StateRow[];
  readonly blockReadKeys?: readonly string[];
}

/**
 * The SPR `state` block the merged artifact carries, or `undefined` for none.
 *
 * - Not SPR, or no upcoming match left: none, silently.
 * - The existing artifact has a block: the splice of this tick's written rows
 *   into it. A splice that throws `EventStateBlockError` drops the block and
 *   logs `event-state-block-invalid`.
 * - No existing block, or one lacking teams on the upcoming schedule: completed
 *   from `blockD1Rows` when the tick supplied them (`completeEventStateBlock`),
 *   then spliced as above. This is what lets an event promoted to live folding
 *   without ever being published offline price its upcoming matches with no
 *   operator step.
 * - Still no block (no rows supplied, or D1 held no league row): none, and logs
 *   `event-state-block-missing`. The next tick tries again.
 *
 * Log lines carry the event key, algorithm id, counts and the error message
 * (ids and versions only), never an artifact body or a TBA value.
 */
function maintainedStateBlock(params: MergeEventArtifactParams, upcomingCount: number): LiveEventArtifact["state"] {
  const { existing, eventKey, algorithmId, writtenRows, touchedTeams } = params;
  if (algorithmId !== spr.id || upcomingCount === 0) return undefined;
  try {
    const base =
      params.blockD1Rows === undefined ? existing?.state : completeEventStateBlock(existing?.state, params.blockD1Rows, params.blockReadKeys ?? []);
    if (base === undefined) {
      console.warn(JSON.stringify({ msg: "event-state-block-missing", eventKey, algorithmId, upcoming: upcomingCount }));
      return undefined;
    }
    if (params.blockD1Rows !== undefined) {
      console.log(JSON.stringify({ msg: "event-state-block-completed", eventKey, algorithmId, rows: base.rows.length, absent: base.absentKeys?.length ?? 0 }));
    }
    return spliceEventStateBlock(base, writtenRows, touchedTeams);
  } catch (error) {
    if (!(error instanceof EventStateBlockError)) throw error;
    console.warn(JSON.stringify({ msg: "event-state-block-invalid", eventKey, algorithmId, upcoming: upcomingCount, error: error.message }));
    return undefined;
  }
}

/**
 * This tick's live-block header and rows, built from the tick's own state.
 *
 * IT LIVES HERE, NOT IN `packages/harness/liveEventRows.ts`, on purpose: it
 * needs `SIGMA_METRIC_KEY`, and `liveEventRows.ts` sits on the BROWSER's
 * import graph and may not grow that dependency. This module already imports
 * both `SIGMA_METRIC_KEY` and `roundMetric`, so nothing new enters any graph.
 *
 * THE TICK'S OWN END-OF-TICK VALUES ARE READ ONCE PER TEAM — which is exactly
 * why two matches folded in one tick share one metrics record (the preserved
 * flaw `mergeTeamSeasonArtifact` has always had; see `liveEventRows.ts`'s
 * header).
 *
 * `SIGMA_METRIC_KEY` is an ORDINARY member of the header, never a special case
 * in the encoding — `sigmaScore.ts`'s own rule, applied here.
 *
 * THE HEADER IS SORTED so the header a later tick computes for the same
 * algorithm is byte-identical and `mergeEventLiveBlock`'s drift guard fires
 * only on a REAL key-set change rather than on `Object.entries` order.
 */
export function buildTickLiveRows(params: {
  readonly realTouchedTeams: readonly string[];
  readonly touchedMetrics: Readonly<Record<string, Record<string, TeamMetric>>>;
  readonly touchedSigma: ReadonlyMap<string, number>;
  readonly newlyFolded: readonly MatchResult[];
}): { readonly metricKeys: string[]; readonly rows: EventLiveTickRow[] } {
  const { realTouchedTeams, touchedMetrics, touchedSigma, newlyFolded } = params;

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
      values[SIGMA_METRIC_KEY] = sigma;
      metricKeySet.add(SIGMA_METRIC_KEY);
    }
    valuesByTeam.set(teamKey, values);
  }
  const metricKeys = [...metricKeySet].sort();

  const realTouched = new Set(realTouchedTeams);
  const rows = newlyFolded.map((match) => ({
    matchKey: match.matchKey,
    teamKeys: [...match.redTeams, ...match.blueTeams].filter((teamKey) => realTouched.has(teamKey)),
    valuesByTeam,
  }));

  return { metricKeys, rows };
}

/**
 * The ephemeral `live` block the merged artifact carries, or `undefined` for
 * none. Mirrors `maintainedStateBlock` above — same shape, same
 * log-here-rather-than-at-the-call-site convention, and for the same reason:
 * `mergeEventArtifact` returns the merged body alone, so a block's degrade
 * has to be reported by whoever computes it.
 *
 * A TICK THAT FOLDED NOTHING CARRIES THE EXISTING BLOCK FORWARD UNCHANGED.
 * That guard is load-bearing, not defensive: such a tick computes an EMPTY
 * header, an empty header never equals a stored non-empty one, and
 * `mergeEventLiveBlock` would therefore read it as key-set drift and discard
 * every row the event has accumulated.
 *
 * Log lines carry event key, algorithm id, counts and byte lengths only, never
 * a body and never a TBA value — the rule `event-state-block-invalid` already
 * follows.
 */
function maintainedLiveBlock(params: MergeEventArtifactParams): LiveEventArtifact["live"] {
  const { existing, eventKey, algorithmId, realTouchedTeams, touchedMetrics, touchedSigma, newlyFolded, existingBodyBytes } = params;
  const { metricKeys, rows } = buildTickLiveRows({ realTouchedTeams, touchedMetrics, touchedSigma, newlyFolded });
  if (rows.length === 0 || metricKeys.length === 0) return existing?.live;

  const { block, keySetDrifted, droppedRows } = mergeEventLiveBlock({ existing: existing?.live, metricKeys, rows, existingBodyBytes });
  if (keySetDrifted) {
    console.warn(
      JSON.stringify({
        msg: "event-live-block-drift",
        eventKey,
        algorithmId,
        storedKeys: existing?.live?.metricKeys.length ?? 0,
        computedKeys: metricKeys.length,
        discardedRows: existing?.live?.rows.length ?? 0,
      })
    );
  }
  if (droppedRows > 0) {
    console.warn(JSON.stringify({ msg: "event-live-block-trimmed", eventKey, algorithmId, droppedRows, retainedRows: block.rows.length, existingBodyBytes }));
  }
  return block;
}

/**
 * Read-modify-write merge: replaces newly-folded matches (removing them from
 * `upcoming`), rewrites the remaining `upcoming` rows schedule-only, refreshes
 * touched teams' standings rows, keeps the SPR `state` block current, and
 * SPREADS everything else from `existing` through unchanged. Bootstraps a
 * schema-valid (but degraded — no history this Worker cannot see) artifact
 * when `existing` is `undefined`.
 *
 * SPREAD-THEN-OVERRIDE, never an allow-list, so a key the publisher adds
 * later survives a tick automatically. Since 260915-t7o the live tick's
 * `existing` comes from `artifactShapeCheck.ts`'s structural guard, NOT from
 * `LiveEventArtifactSchema.parse`, so it may still carry keys the schema does
 * not know — the spread carries them into this function's output, and
 * `writeArtifactObject`'s own `schema.parse` strips them again before the put.
 * The published bytes are therefore unchanged either way, which
 * `test/artifactShapeCheck.test.ts` pins by comparing
 * `JSON.stringify(schema.parse(merged))` across both read paths. An
 * allow-list is how the identity bug
 * happened: `name`/`startDate`/`location`/`week`/`alliances` were added to
 * the schema after this merge was written and were silently dropped on every
 * tick. The keys the tick owns are listed explicitly below, each keeping its
 * original position. An owned key the tick may OMIT must be destructured out
 * of `existing` first, or a stale value would survive the spread; today that
 * is `state` (dropped for non-SPR artifacts and for events with no upcoming
 * match) and `live` (absent until the first fold at the event), both of which
 * the destructuring also re-appends last, in that order, where the schema
 * wants the two large blocks. Trade-off: a future key that should be
 * tick-owned is carried stale until someone lists it here — the project's
 * documented carry-forward policy, as for the Sigma entry and the teams-row
 * tier/record.
 *
 * `tierCuts` (quick task 260920-qzf) rides this same carry-forward policy —
 * it is NOT in the override list and NOT destructured out, so it survives
 * every tick unchanged via `...carriedFromExisting`, stale-but-true between
 * republishes exactly like the Sigma entry and the teams-row tier/record
 * above. A bootstrap merge (`existing` undefined) carries none, for the same
 * reason it carries no `name`/`alliances`/etc: the Worker has no season
 * pool to build one from. `pageArtifacts.ts`'s `EventArtifactSchema` doc
 * comment on `tierCuts` explains why declaring the key on the base schema
 * (not only on `LiveEventArtifactSchema`) is what stops the write-side parse
 * below from silently stripping it — the exact allow-list failure mode this
 * function's own header paragraph already warns about.
 */
export function mergeEventArtifact(params: MergeEventArtifactParams): unknown {
  const { existing, eventKey, season, algorithmId, algorithmVersion, eventType, newlyFolded, newPredictions, stillUpcoming, touchedTeams, touchedMetrics, newBands, playedRowFacts, stamp } = params;
  // BOTH tick-owned blocks destructured out before the spread: either may be
  // omitted from this tick's output, and a spread would carry a stale one
  // through. See this function's doc comment.
  const { state: _existingState, live: _existingLive, ...carriedFromExisting } = existing ?? {};

  // Read before the preserved-match filter below: a newly-played match's own
  // published row is where its prior `sortTime` lives when TBA reports none.
  // A still-upcoming row keeps reading the upcoming map alone, as before.
  const existingUpcomingSortTimes = new Map<string, number>();
  for (const row of existing?.upcoming ?? []) {
    if (row.sortTime !== undefined) existingUpcomingSortTimes.set(row.matchKey, row.sortTime);
  }
  const existingPlayedSortTimes = new Map<string, number>();
  for (const row of existing?.matches ?? []) {
    if (row.sortTime !== undefined) existingPlayedSortTimes.set(row.matchKey, row.sortTime);
  }

  const newMatchKeys = new Set(newlyFolded.map((m) => m.matchKey));
  const preservedMatches = (existing?.matches ?? []).filter((m) => !newMatchKeys.has(m.matchKey));
  const matches = [
    ...preservedMatches,
    ...newlyFolded.map((m) => {
      const facts = playedRowFacts.get(m.matchKey);
      return eventPlayedRow(
        { match: m, prediction: newPredictions.get(m.matchKey)!, matchBand: newBands.get(m.matchKey) },
        {
          // TBA's reported time, else the value already published for this
          // match (its played row or its upcoming row), else no key at all —
          // never the tick's window-start approximation (260915-isq).
          sortTime: facts?.reportedSortTime ?? existingPlayedSortTimes.get(m.matchKey) ?? existingUpcomingSortTimes.get(m.matchKey),
          video: facts?.video,
          actualBonusFlags: facts?.actualBonusFlags,
        }
      );
    }),
  ];

  const upcoming = stillUpcoming.map((m) => buildEventScheduledRow(m, existingUpcomingSortTimes.get(m.matchKey)));

  // The season's win/tie RP constants, derived as `publish.ts` derives them
  // so live and offline artifacts agree; else the existing artifact's value,
  // else absent.
  const rpOutcomeRp = findRpOutcomeRp([...newPredictions.values()]) ?? existing?.rpOutcomeRp;

  const resolvedEventType = eventType ?? existing?.eventType;
  const state = maintainedStateBlock(params, upcoming.length);
  const live = maintainedLiveBlock(params);

  const existingTeams = existing?.teams ?? [];
  const touchedSet = new Set(touchedTeams);
  // Touched rows are replaced IN PLACE, so a tick never reorders the
  // standings. `rank`, `record` and `rp` are TBA's own official standings
  // (this Worker never fetches `/event/{key}/rankings` and never recomputes
  // them): they are preserved as last published and are stale until the next
  // republish, exactly as the Sigma entry and the teams-row `record` are.
  // Stale-but-true TBA values beat a standings table whose columns vanish
  // mid-event.
  const teams = [
    ...existingTeams.map((row) =>
      touchedSet.has(row.teamKey)
        ? {
            ...row,
            // Carries the prior row's published Sigma entry forward; a live
            // tick computes no season-final Sigma of its own.
            metrics: touchedEventTeamMetrics(row.metrics, touchedMetrics[row.teamKey] ?? {}),
          }
        : row
    ),
    // A touched team with no published row yet is appended, in the bootstrap shape.
    ...touchedTeams
      .filter((teamKey) => !existingTeams.some((t) => t.teamKey === teamKey))
      .map((teamKey) => ({
        teamKey,
        teamNumber: fallbackTeamNumber(teamKey),
        nickname: "",
        metrics: touchedEventTeamMetrics(undefined, touchedMetrics[teamKey] ?? {}),
      })),
  ];

  return {
    ...carriedFromExisting,
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
    // LAST, after `state`: the event page needs `state` for first paint and
    // never reads `live`, so the block only the robot and match pages read
    // serializes at the very end of the body.
    ...(live !== undefined ? { live } : {}),
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

export interface MergeTeamSeasonArtifactParams {
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
  /** This tick's per-match facts for the newly-folded matches. Required (an empty map is a valid value) so no caller omits it, as `sigmaAfterTick` is. */
  readonly playedRowFacts: ReadonlyMap<string, PlayedRowFacts>;
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
 * NO LONGER ON THE LIVE PATH since quick task 260917-jr4 (D-07). A live tick
 * makes ZERO team-artifact reads and ZERO team-artifact writes: Phase B's team
 * half was replaced by one small ephemeral sidecar object per algorithm-event,
 * and then (quick task 260918-16t) by an ephemeral `live` block INSIDE the
 * event artifact, deleting the sidecar object entirely. The browser derives
 * the rest from files the robot page already fetches
 * (`apps/web/src/lib/liveTeamSeason.ts`).
 *
 * IT IS DELIBERATELY KEPT, AND KEPT EXPORTED, with no caller on the live path.
 * Until quick task 260923-3w4 it survived as the CPU probe's `allPhaseB`
 * baseline arm; that probe is now deleted, and this function is kept for the
 * OPPOSITE reason — the successor task reinstates the tick's per-team artifact
 * writes (`260923-1tu-FINDINGS.md` item C5, decided by Jacob 2026-09-23) and
 * this is the merge it reinstates them through. Deleting it would mean writing
 * it again from scratch in the next commit.
 *
 * SECOND CONSEQUENCE, RECORDED RATHER THAN LEFT IMPLICIT: `matchIndexByKey` has
 * no supplier at all right now. When the live tick last built it, it built it
 * from ONE EVENT's own ordered match keys, so the `matchIndex` it wrote into a
 * field documented as a season-wide index was in fact event-local — and nothing
 * in production web reads that field (`buildMetricSeries` uses array position,
 * by its own doc comment). The browser derivation assigns array position for the
 * same reason. Whatever reinstates the per-team write has to decide what that
 * index means rather than inherit the event-local answer by accident.
 *
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
  const { existing, teamKey, season, algorithmId, algorithmVersion, eventKey, matches, predictions, metrics, matchIndexByKey, bands, playedRowFacts, stamp, sigmaAfterTick } = params;

  let record = existing?.seasonStats.record ?? { wins: 0, losses: 0, ties: 0 };
  for (const match of matches) record = incrementRecord(record, teamKey, match);

  const existingEvents = existing?.events ?? [];
  const eventIndex = existingEvents.findIndex((e) => e.eventKey === eventKey);
  // The published rows for this event, read before the replace below: they
  // carry the `sortTime` a match keeps when TBA reports no time for it.
  const existingRowSortTimes = new Map<string, number>();
  for (const row of eventIndex === -1 ? [] : existingEvents[eventIndex]!.matches) {
    if (row.sortTime !== undefined) existingRowSortTimes.set(row.matchKey, row.sortTime);
  }

  const newRows = matches.map((m) => {
    const facts = playedRowFacts.get(m.matchKey);
    return teamSeasonPlayedRow(
      { match: m, prediction: predictions.get(m.matchKey)!, matchBand: bands.get(m.matchKey) },
      {
        season,
        algorithmId,
        algorithmVersion,
        sortTime: facts?.reportedSortTime ?? existingRowSortTimes.get(m.matchKey),
        video: facts?.video,
      },
      facts?.actualBonusFlags
    );
  });
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
  // next offline publish. Since 260915-t7o `existing` reaches the live tick
  // through `artifactShapeCheck.ts`'s structural guard rather than
  // `TeamSeasonArtifactSchema.parse`, so it MAY carry unknown keys; they ride
  // this spread and are stripped again by `writeArtifactObject`'s own
  // `schema.parse`, leaving the published bytes identical. Tick-owned fields
  // must stay listed explicitly below.
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
    // Spread for the same reason the top level spreads: a key this tick does
    // not own (today `metricsBasis`, tomorrow whatever the publisher adds)
    // must survive. `metrics` carries the prior Sigma entry forward, keeping
    // the team page's Total tile pill visible during a live event. The tick
    // owns `metrics`, so it owns the label describing them: blindly carrying
    // a published "last-official-match" through an offseason tick would
    // mislabel the value. The missing percentiles and the unscoped offseason
    // write stay open in `live-merges-drop-percentiles`.
    seasonStats: {
      ...existing?.seasonStats,
      record,
      metrics: touchedEventTeamMetrics(existing?.seasonStats.metrics, metrics),
      metricsBasis: matches.every((m) => isOfficialEventType(m.eventType)) ? ("last-official-match" as const) : ("season-final" as const),
    },
    events,
    metricHistory: [...(existing?.metricHistory ?? []), ...newMetricHistoryRows],
  };
}

/** One prior published event/team-season metric entry. Never a `tier`: that is teams-row-only; these artifacts publish `percentile`. */
type PublishedEventTeamMetric = { value: number; spread?: number; percentile?: number };

/**
 * The metrics record the event and team-season merges write for a touched
 * team: fresh entries rounded, then the prior `SIGMA_METRIC_KEY` entry
 * appended when the fresh record lacks it, so a live tick never strips a
 * published Sigma Score.
 *
 * Known limitation, narrowed by quick task 260920-qzf: a touched team's
 * other metrics still lose their `percentile` on a live tick — the Worker
 * computes none, and that stays the CPU gate
 * (`rp-fold-exceeds-worker-cpu-budget`). What no longer disappears with it
 * is the TIER: the client re-derives it from the event artifact's
 * `tierCuts` block (`apps/web/src/lib/tiers.ts`'s resolver) whenever a
 * metric entry has a value but no percentile, which is exactly this
 * function's output shape. The percentile NUMBER itself stays absent on
 * every surface that prints one and is never approximated from `tierCuts` —
 * only the tier box is recoverable this way.
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
