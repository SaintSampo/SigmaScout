/**
 * What the ROBOT PAGE derives during a live event, now that the live Worker
 * no longer rewrites team-season artifacts at all (quick task 260917-jr4,
 * D-05). Pure module: no React, no Recharts, no fetch.
 *
 * THE DESIGN POINT IS THAT EVERY EXISTING CONSUMER STAYS UNCHANGED. There is
 * exactly ONE extension primitive here, `extendMetricHistory`, and with its
 * array in hand `officialSnapshotRow`, `endOfEventMetrics`,
 * `buildMetricSeries`, `detectEventBands`, `drawsSigmaBand` and
 * `preMatchMetrics` all become correct during a live event for free. Do not
 * write a second chart path, a second snapshot resolver or a second pre-match
 * resolver — the whole value of this module is that it FEEDS the single
 * implementations rather than forking them.
 *
 * WHERE THE DATA COMES FROM. Two sources, neither of them a team artifact:
 *
 *   - the live event's own ARTIFACT, for match rows (results, priced upcoming
 *     rows) — already shipped and tested as `overlayTeamEventMatches` /
 *     `teamRowFromEventRow` (260915-m4j), running in production today;
 *   - the live event's EPHEMERAL SIDECAR
 *     (`packages/harness/liveMetricSidecar.ts`), for the one thing the event
 *     artifact cannot carry: each newly-folded match's per-team POST-MATCH
 *     metrics, which exist only inside the Worker's own algorithm state.
 *
 * THE DOUBLE-COUNT RULE, STATED ONCE AND OBEYED EVERYWHERE BELOW. The
 * published `seasonStats.record` ALREADY counts every played row the
 * PUBLISHER saw. The overlaid rows contain those same matches, re-sourced
 * from the event artifact — so the overlaid list is a UNION, not a delta.
 * Every increment here is therefore keyed on the PUBLISHED team artifact's
 * OWN rows: a match counts only if its published row at that event is
 * UNPLAYED and the overlaid row is PLAYED. Keying the guard on the overlaid
 * list instead would count the publisher's matches a second time, and would
 * do it silently — the record would simply read high.
 */
import { isOfficialEventType } from "../../../../packages/core/algorithms/eventTypes.js";
import { sidecarRowsForTeam, type LiveMetricSidecar } from "../../../../packages/harness/liveMetricSidecar.js";
import type { MetricHistoryRow } from "../../../../packages/harness/metricHistorySchema.js";
import type { TeamSeasonArtifact } from "../../../../packages/harness/pageArtifacts.js";

/** The published team artifact's own event entry, narrowed to what this module reads. */
interface PublishedEventLike {
  readonly eventKey: string;
  readonly startDate: string;
  readonly matches: readonly { readonly matchKey: string; readonly actualWinner?: unknown }[];
}

/** A display event after `overlayTeamEventMatches` has run over it. */
interface OverlaidEventLike {
  readonly eventKey: string;
  readonly matches: readonly {
    readonly matchKey: string;
    readonly redTeams?: readonly string[];
    readonly blueTeams?: readonly string[];
    readonly actualWinner?: unknown;
  }[];
}

/** One live event's fetched sidecar, or `null` for the ordinary absent case (never fetched, 404, or not live). */
export type SidecarsByEventKey = ReadonlyMap<string, LiveMetricSidecar | null>;

export interface ExtendMetricHistoryParams {
  readonly artifact: Pick<TeamSeasonArtifact, "teamKey" | "season" | "algorithmId" | "metricHistory"> & { readonly events: readonly PublishedEventLike[] };
  readonly sidecars: SidecarsByEventKey;
}

/**
 * The published `metricHistory`, then each live event's sidecar rows for this
 * team appended after it.
 *
 * ORDERING. Live events are ordered by their own `startDate` in
 * `artifact.events`, ties broken by `artifact.events` order; within an event,
 * sidecar (fold) order. A team cannot physically play at two events at once,
 * so that reproduces chronological order. THE LIMITATION, stated rather than
 * engineered around: a team genuinely attending two events in the same window
 * gets two sidecars, each with that team's metrics as of its OWN tick, and if
 * the two events share a start date the published `artifact.events` order
 * breaks the tie.
 *
 * DEDUP IS THE STALENESS GUARD AND THE DOUBLE-COUNT GUARD AT ONCE. A sidecar
 * row whose match key already appears in the published history is dropped —
 * it is redundant by construction, whether the sidecar is stale (the event was
 * republished since) or fresh (the publisher raced the tick). There is no
 * generation comparison, and there cannot be: the tick's own
 * `stamp.generation` is `tick-{nowMs}`, never the publisher's.
 *
 * `matchIndex` on a derived row is its ZERO-BASED ARRAY POSITION. No
 * season-wide index is invented, because none is reachable — and none is
 * needed: `buildMetricSeries` plots `index + 1` by its own doc comment, and
 * `preMatchMetrics`/`endOfEventMetrics`/`officialSnapshotRow` all walk the
 * array. The live tick had in fact always written an EVENT-LOCAL index into
 * that field anyway.
 *
 * With no live sidecar at all — every ordinary robot page — the published
 * array is returned BY IDENTITY, so React sees no new reference and no
 * consumer re-renders.
 *
 * RETURNS A MUTABLE `MetricHistoryRow[]`, not a `readonly` one, and that is
 * deliberate: `officialSnapshotRow` and `preMatchMetrics` take the artifact's
 * own (mutable) array type, and the whole point of this module is that those
 * two are fed UNCHANGED. Widening their signatures to `readonly` would be a
 * modification to two modules this change promised not to touch, bought for a
 * compile-time guarantee against a mutation no caller here performs.
 */
export function extendMetricHistory({ artifact, sidecars }: ExtendMetricHistoryParams): MetricHistoryRow[] {
  if (sidecars.size === 0) return artifact.metricHistory;

  const publishedKeys = new Set(artifact.metricHistory.map((row) => row.matchKey));
  const orderedEvents = artifact.events
    .map((event, index) => ({ event, index }))
    .filter((entry) => sidecars.get(entry.event.eventKey) != null)
    .sort((a, b) => a.event.startDate.localeCompare(b.event.startDate) || a.index - b.index);

  const appended: MetricHistoryRow[] = [];
  for (const { event } of orderedEvents) {
    const sidecar = sidecars.get(event.eventKey);
    if (sidecar == null) continue;
    for (const row of sidecarRowsForTeam(sidecar, artifact.teamKey)) {
      if (publishedKeys.has(row.matchKey)) continue;
      publishedKeys.add(row.matchKey); // two sidecars can never claim one match, but a duplicate would be a silent double point
      appended.push({
        matchKey: row.matchKey,
        season: sidecar.season,
        eventKey: sidecar.eventKey,
        algorithmId: sidecar.algorithmId,
        teamKey: artifact.teamKey,
        matchIndex: 0, // replaced by array position below -- never a season-wide index
        metrics: row.metrics,
      });
    }
  }

  if (appended.length === 0) return artifact.metricHistory;

  const extended = [...artifact.metricHistory, ...appended];
  // Array position, assigned to the DERIVED rows only: a published row keeps
  // whatever index the publisher wrote, because rewriting it would change a
  // field this module does not own for rows it did not create.
  const publishedLength = artifact.metricHistory.length;
  for (let i = publishedLength; i < extended.length; i++) {
    extended[i] = { ...extended[i]!, matchIndex: i };
  }
  return extended;
}

export interface SeasonRecord {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

export interface DeriveSeasonRecordParams {
  readonly artifact: Pick<TeamSeasonArtifact, "teamKey"> & { readonly seasonStats: { readonly record: SeasonRecord }; readonly events: readonly PublishedEventLike[] };
  readonly overlaidEvents: readonly OverlaidEventLike[];
  /** Each live event's own artifact, read ONLY for its `eventType` — the officialness scoping `mergeTeamSeasonArtifact` applies. An event with no entry here is treated as official, matching the tick's `-1` sentinel behaviour. */
  readonly eventArtifactsByKey: ReadonlyMap<string, { readonly eventType?: number } | undefined>;
}

function isPlayed(row: { readonly actualWinner?: unknown }): boolean {
  return row.actualWinner !== undefined;
}

/**
 * The published record plus the matches the publisher had not yet seen.
 *
 * The increment set is keyed on the PUBLISHED rows — see this module's header
 * for the double-count hazard that rule exists to close. Officialness is
 * scoped exactly as `mergeTeamSeasonArtifact` scopes it: an offseason (99) or
 * preseason (100) event's rows are DISPLAYED but never counted, and an event
 * whose type is unknown counts, matching the tick's own `-1` sentinel, which
 * degrades toward counting.
 */
export function deriveSeasonRecord({ artifact, overlaidEvents, eventArtifactsByKey }: DeriveSeasonRecordParams): SeasonRecord {
  let record = artifact.seasonStats.record;
  const overlaidByEventKey = new Map(overlaidEvents.map((event) => [event.eventKey, event]));

  for (const publishedEvent of artifact.events) {
    const overlaid = overlaidByEventKey.get(publishedEvent.eventKey);
    if (overlaid === undefined) continue;
    if (!isOfficialEventType(eventArtifactsByKey.get(publishedEvent.eventKey)?.eventType ?? -1)) continue;

    const overlaidByMatchKey = new Map(overlaid.matches.map((row) => [row.matchKey, row]));
    for (const publishedRow of publishedEvent.matches) {
      // THE GUARD, keyed on the PUBLISHED row. A published row that is
      // already played was already counted by the publisher.
      if (isPlayed(publishedRow)) continue;
      const overlaidRow = overlaidByMatchKey.get(publishedRow.matchKey);
      if (overlaidRow === undefined || !isPlayed(overlaidRow)) continue;

      const onRed = overlaidRow.redTeams?.includes(artifact.teamKey) ?? false;
      const onBlue = overlaidRow.blueTeams?.includes(artifact.teamKey) ?? false;
      if (!onRed && !onBlue) continue;
      const winner = overlaidRow.actualWinner;
      const won = (onRed && winner === "red") || (onBlue && winner === "blue");
      const lost = (onRed && winner === "blue") || (onBlue && winner === "red");
      const tied = winner === "tie";
      record = { wins: record.wins + (won ? 1 : 0), losses: record.losses + (lost ? 1 : 0), ties: record.ties + (tied ? 1 : 0) };
    }
  }
  return record;
}

export type MetricsBasis = "last-official-match" | "season-final";

export interface DeriveMetricsBasisParams {
  readonly published: MetricsBasis | undefined;
  /** The event keys whose sidecar rows were appended by `extendMetricHistory` on this render. */
  readonly liveEventKeys: readonly string[];
  readonly eventArtifactsByKey: ReadonlyMap<string, { readonly eventType?: number } | undefined>;
}

/**
 * Mirrors `mergeTeamSeasonArtifact`'s own rule: the tick OWNS the label
 * describing the metrics it just wrote, so a live update at an offseason
 * event must not keep a published "last-official-match" label on values that
 * learned from offseason play.
 *
 * With no live event contributing rows, the published label is returned
 * unchanged — this function never invents a basis for an artifact it did not
 * extend.
 */
export function deriveMetricsBasis({ published, liveEventKeys, eventArtifactsByKey }: DeriveMetricsBasisParams): MetricsBasis | undefined {
  if (liveEventKeys.length === 0) return published;
  return liveEventKeys.every((eventKey) => isOfficialEventType(eventArtifactsByKey.get(eventKey)?.eventType ?? -1)) ? "last-official-match" : "season-final";
}
