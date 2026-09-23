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
import {
  actualBonusFlagsForMatch,
  eventPlayedRow,
  teamSeasonPlayedRow,
  type ActualBonusFlags,
  type ParsedBonusSides,
} from "../../../packages/harness/publishedRows.js";
import { SIGMA_METRIC_KEY } from "../../../packages/harness/sigmaScore.js";
import { PAGE_ARTIFACT_SCHEMA_VERSION, type EventUpcomingMatch, type LiveEventArtifact, type TeamSeasonArtifact, type TeamSeasonMatch } from "../../../packages/harness/pageArtifacts.js";
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
 * One still-upcoming match as a SCHEDULE-ONLY row: the shape the tick wrote
 * between quick tasks 260915-isq and 260923-3w6, when the browser priced the
 * remaining schedule from the artifact's `state` block.
 *
 * NO PRODUCTION CALLER SINCE 260923-3w6. The tick prices its own upcoming rows
 * again (`priceUpcomingRows`), so what it writes is the publisher's priced
 * shape. This builder is kept for `test/matchSplit.test.ts`, whose whole point
 * is that the trimmed and the reference split agree on the shape that reaches an
 * artifact rather than merely on the six fields feeding it (260921-vzf) — the
 * six schedule fields are still exactly what a split must preserve, priced or
 * not. `EventScheduledMatchSchema`, the union arm that accepted these rows,
 * stays on `LiveEventArtifactSchema` until quick task 260923-3w7 retires the
 * web's tolerance for them.
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
 * The `sortTime` each of `existing`'s UPCOMING rows already publishes. The tick
 * never re-derives a scheduled match's sort time from TBA's `time` field
 * (260915-isq): a row keeps the published value or carries no key at all.
 *
 * Exported because Phase B needs the map BEFORE the merge — it prices the
 * upcoming rows itself now, and `sortTime` is a per-match input to that pricing,
 * not something the merge can add afterwards.
 */
export function existingUpcomingSortTimes(existing: LiveEventArtifact | undefined): Map<string, number> {
  const sortTimes = new Map<string, number>();
  for (const row of existing?.upcoming ?? []) {
    if (row.sortTime !== undefined) sortTimes.set(row.matchKey, row.sortTime);
  }
  return sortTimes;
}

/**
 * `{ win, tie }` from the first played prediction carrying both outcome-RP
 * vectors. Reimplements the played half of `publish.ts`'s private
 * `findRpOutcomeRp`, because importing `publish.ts` would pull
 * `better-sqlite3` into the Worker. It stays the PLAYED half even now that the
 * tick prices upcoming matches (260923-3w6): an upcoming ROW publishes no
 * outcome-RP vectors (`eventUpcomingRow` omits them), so there is nothing to
 * read off one. Played, then the existing artifact's value, then absent.
 * `sigmaScoutLayer.ts` composes the vector as `[winRp, tieRp, 0]`.
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
  /**
   * The event's remaining schedule, ALREADY PRICED by Phase B through
   * `priceUpcomingRows` (quick task 260923-3w6) — the publisher's own row shape,
   * built by the publisher's own builder. This used to be the raw
   * `ScheduledMatchFacts` list, which this merge turned into schedule-only rows
   * for the browser to price. The merge no longer decides anything about these
   * rows; it places them, so that one function prices an upcoming match for the
   * whole system.
   */
  readonly upcoming: readonly EventUpcomingMatch[];
  readonly touchedTeams: readonly string[];
  readonly touchedMetrics: Readonly<Record<string, Record<string, TeamMetric>>>;
  readonly newBands: ReadonlyMap<string, MatchBand>;
  /** This tick's per-match facts for the newly-folded matches. Required (an empty map is a valid value) so no caller omits it, as `sigmaAfterTick` is. */
  readonly playedRowFacts: ReadonlyMap<string, PlayedRowFacts>;
  readonly stamp: Stamp;
}

/**
 * Read-modify-write merge: replaces newly-folded matches (removing them from
 * `upcoming`), places the remaining `upcoming` rows Phase B priced, refreshes
 * touched teams' standings rows, and SPREADS everything else from `existing`
 * through unchanged. Bootstraps a
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
 * of `existing` first, or a stale value would survive the spread; today that is
 * `state` and `live`, both destructured out and neither re-appended, because
 * nothing emits either any more (quick task 260923-3w6). Trade-off: a future key that should be
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
  const { existing, eventKey, season, algorithmId, algorithmVersion, eventType, newlyFolded, newPredictions, upcoming, touchedTeams, touchedMetrics, newBands, playedRowFacts, stamp } = params;
  // BOTH tick-owned blocks destructured out before the spread, and since quick
  // task 260923-3w6 for the same reason: this merge emits NEITHER of them any
  // more, so an artifact published before the reversal carries a `state` block
  // and an artifact written by an earlier tick carries a `live` block, and both
  // must be DROPPED here rather than ridden forward forever on the spread.
  const { state: _existingState, live: _existingLive, ...carriedFromExisting } = existing ?? {};

  // Read before the preserved-match filter below: a newly-played match's own
  // published row is where its prior `sortTime` lives when TBA reports none.
  // The still-upcoming rows arrive already priced, `sortTime` included (Phase B
  // reads the same map through `existingUpcomingSortTimes` before pricing).
  const upcomingSortTimes = existingUpcomingSortTimes(existing);
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
          sortTime: facts?.reportedSortTime ?? existingPlayedSortTimes.get(m.matchKey) ?? upcomingSortTimes.get(m.matchKey),
          video: facts?.video,
          actualBonusFlags: facts?.actualBonusFlags,
        }
      );
    }),
  ];

  // The season's win/tie RP constants, derived as `publish.ts` derives them
  // so live and offline artifacts agree; else the existing artifact's value,
  // else absent.
  const rpOutcomeRp = findRpOutcomeRp([...newPredictions.values()]) ?? existing?.rpOutcomeRp;

  const resolvedEventType = eventType ?? existing?.eventType;

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
  /** Match Band per newly-folded match key. */
  readonly bands: ReadonlyMap<string, MatchBand>;
  /**
   * This team's STILL-UPCOMING rows at `eventKey`, already priced by Phase B
   * through `priceUpcomingRows` — the same records the event artifact's
   * `upcoming` array is built from, so a team page and an event page never
   * disagree about a scheduled match (quick task 260923-3w6). Empty for an event
   * with nothing left on the schedule.
   */
  readonly upcomingRows: readonly TeamSeasonMatch[];
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
 * BACK ON THE LIVE PATH since quick task 260923-3w6 (`260923-1tu-FINDINGS.md`
 * item C5, decided by Jacob 2026-09-23). Between 260917-jr4 and here the tick
 * made ZERO team-artifact reads and writes: Phase B's team half was replaced by
 * one ephemeral sidecar object per algorithm-event, then (260918-16t) by an
 * ephemeral `live` block inside the event artifact, and the browser derived a
 * team's live rows from files the robot page already fetched. Both of those
 * existed to save the 7.6 ms this write costs, against a 10 ms CPU budget that is
 * now 30 s. A team page is one fetch again, which the 2026-09-17 load test
 * measured 2.1x faster than the index-plus-event-file hybrid it replaces.
 *
 * `matchIndex` ON A NEW METRIC-HISTORY ROW IS ITS OWN ARRAY POSITION, and that is
 * a decision, not an inheritance. The field is documented as a season-wide index;
 * the publisher fills it with the match's position in the whole SEASON's stream,
 * which the Worker has no way to know. The pre-260917-jr4 tick filled it from ONE
 * EVENT's ordered match keys — an event-local number in a season-wide field, and
 * nobody noticed because nothing reads it: `buildMetricSeries` and the browser's
 * own derivation both use array position, each saying so in its own doc comment.
 * Array position is therefore the honest answer here — monotone, unique, and
 * equal to what every consumer actually computes — rather than a second wrong
 * number. It still does not equal the publisher's value for the same row, which
 * is why no parity test compares the two.
 *
 * Read-modify-write merge for one team's season artifact: writes this tick's
 * newly-folded matches at `eventKey` (creating the event's entry if this is
 * the team's first match there), refreshes `seasonStats`, and appends
 * metric-history rows. Exported for `test/scheduled.officialRecord.test.ts`:
 * an offseason match's rows ARE appended while the record is NOT incremented.
 *
 * A newly played match REPLACES that match's existing row (the publisher's
 * unplayed row) in place, so the event keeps the offline chronological order
 * with no duplicate; a match with no prior row is appended. The team's remaining
 * unplayed rows at this event are REWRITTEN from `upcomingRows`, which is what
 * keeps a team page and an event page agreeing about a scheduled match.
 *
 * ONE CARRY-FORWARD REMAINS, and it is the same one the standings rows have: a
 * roster team that played nothing THIS tick gets no write at all, so its own
 * unplayed rows keep whatever they were last published or last written with. Its
 * teammates' pages show the fresh price for the same match. Stale-but-true, and
 * healed by that team's next match — rewriting every roster team's artifact on
 * every fold would multiply the write volume by the roster size for rows nobody
 * is looking at yet.
 */
export function mergeTeamSeasonArtifact(params: MergeTeamSeasonArtifactParams): unknown {
  const { existing, teamKey, season, algorithmId, algorithmVersion, eventKey, matches, predictions, metrics, bands, playedRowFacts, stamp, sigmaAfterTick, upcomingRows } = params;

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
  // Played rows first, then the still-upcoming ones — the publisher's own order
  // for an event in progress, and the order a bootstrap has to invent. A match
  // that just finished appears only in `newRows`, and `replaceOrAppendRows`
  // matches it to its own prior unplayed row by key, so nothing duplicates.
  const eventRows = [...newRows, ...upcomingRows];
  const events =
    eventIndex === -1
      ? [...existingEvents, { eventKey, eventName: eventKey, startDate: stamp.computedAt.slice(0, 10), matches: eventRows }]
      : existingEvents.map((e, i) => (i === eventIndex ? { ...e, matches: replaceOrAppendRows(e.matches, eventRows) } : e));

  // `sigmaAfterTick`, when defined, is the last metrics key on each new row;
  // existing rows are untouched. `matchIndex` is the row's own array position in
  // the appended history — see this function's header for why that, and not an
  // event-local index, is what a tick can honestly write.
  const priorHistoryLength = existing?.metricHistory?.length ?? 0;
  const newMetricHistoryRows = matches.map((m, i) => ({
    matchKey: m.matchKey,
    season,
    eventKey: m.eventKey,
    algorithmId,
    teamKey,
    matchIndex: priorHistoryLength + i,
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
