import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useAlgorithmVersion } from "../ribbon/AlgorithmSelect.js";
import { eventQueryOptions } from "../../lib/api/event.js";
import { teamEventNeedsLivePricing } from "../../lib/liveEvent.js";
import { deriveMetricsBasis, deriveSeasonRecord, extendMetricHistory, type SeasonRecord } from "../../lib/liveTeamSeason.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { TeamSeasonEvent } from "./matchAxis.js";
import { overlayTeamEventMatches } from "./teamUpcomingOverlay.js";

/**
 * The robot page's whole live view, in ONE hook (quick task 260917-jr4, D-05
 * — this is `useTeamUpcomingOverlay` renamed and widened, not a new parallel
 * path).
 *
 * WHY IT IS STILL ONE HOOK, now that the page makes only ONE fetch per live
 * event (260918-16t deleted the second). The single resolution of the
 * live-event set is what earns this hook, not the fetch count: `events` and
 * `metricHistory` are derived from the SAME set, and two independent
 * resolutions of `teamEventNeedsLivePricing` would be two chances to disagree.
 * A disagreement shows as a chart whose last points belong to matches the
 * table below it still calls upcoming.
 *
 * WHY THE LIVE ROWS ARE NEEDED AT ALL. Since 260917-jr4 the live Worker writes
 * NO team-season artifact. Match rows are recoverable from the event artifact
 * (`overlayTeamEventMatches`, shipped 260915-m4j and unchanged here); per-match
 * METRICS are not — they live only inside the tick's algorithm state — so the
 * tick folds them into that same event artifact's ephemeral `live` block, and
 * this hook reads them out of the response it was already fetching.
 *
 * WHAT IT RETURNS IS FED TO UNCHANGED CONSUMERS. `metricHistory` goes
 * straight into `officialSnapshotRow`, `endOfEventMetrics`,
 * `buildMetricSeries` and `preMatchMetrics` with no adapter and no fork; see
 * `apps/web/src/lib/liveTeamSeason.ts`'s header.
 *
 * `useQueries` is called with a variable-length array rather than mapping
 * `useQuery` over the live events: the HOOK COUNT never depends on a branch.
 * That rule survives the drop from two query arrays to one — it is about the
 * shape of the call, not how many of them there are. While a query is pending
 * or failed, that event shows its published rows — degrading to published
 * data, never to an error.
 */
export interface LiveTeamSeason {
  /** The team's events with each live event's matches taken from that event's own artifact. */
  readonly events: readonly TeamSeasonEvent[];
  /** The published metric history, extended with each live event artifact's own `live` block rows. Mutable, matching the artifact's own type — see `extendMetricHistory`. */
  readonly metricHistory: MetricHistoryRow[];
  /** `seasonStats` with the record and basis brought forward past the last publish. Every other field is the published one, untouched. */
  readonly seasonStats: TeamSeasonArtifact["seasonStats"];
}

export function useLiveTeamSeason(artifact: TeamSeasonArtifact | undefined, algorithmId: string): LiveTeamSeason | undefined {
  const publishedId = (PUBLISHED_ALGORITHM_IDS as readonly string[]).includes(algorithmId) ? (algorithmId as PublishedAlgorithmId) : undefined;
  const version = useAlgorithmVersion(publishedId ?? "spr");

  // ONE resolution of the live-event set, feeding the query array below AND
  // every derivation under it.
  const liveEvents = useMemo(
    () => (artifact === undefined || publishedId === undefined ? [] : artifact.events.filter((event) => teamEventNeedsLivePricing(event))),
    [artifact, publishedId]
  );

  const eventResults = useQueries({
    queries: liveEvents.map((event) => ({
      ...eventQueryOptions({ eventKey: event.eventKey, algorithmId, version: version ?? "" }),
      enabled: version !== undefined,
    })),
  });

  if (artifact === undefined) return undefined;

  // No live event (every ordinary robot page): the published values, same
  // references, no work. `extendMetricHistory` has the same fast path, but
  // taking it here keeps `events` and `seasonStats` identical too.
  if (liveEvents.length === 0) {
    return { events: artifact.events, metricHistory: artifact.metricHistory, seasonStats: artifact.seasonStats };
  }

  // ONE map, feeding all three derivations below: the match-row overlay, the
  // metric-history extension and the officialness scoping. Since 260918-16t
  // the live rows are a KEY ON these same artifacts, so there is nothing else
  // to fetch and nothing to keep in sync with them. A handful of events with
  // tens of rows each: recomputed per render rather than memoized on a
  // variable-length dependency list.
  const eventArtifactsByKey = new Map(liveEvents.map((event, index) => [event.eventKey, eventResults[index]?.data]));

  const events = artifact.events.map((event) =>
    eventArtifactsByKey.has(event.eventKey)
      ? { ...event, matches: overlayTeamEventMatches({ teamKey: artifact.teamKey, event, eventArtifact: eventArtifactsByKey.get(event.eventKey) }) }
      : event
  );

  const metricHistory = extendMetricHistory({ artifact, eventArtifacts: eventArtifactsByKey });
  const contributingEventKeys = liveEvents.filter((event) => eventArtifactsByKey.get(event.eventKey)?.live !== undefined).map((event) => event.eventKey);
  const record: SeasonRecord = deriveSeasonRecord({ artifact, overlaidEvents: events, eventArtifactsByKey });
  const metricsBasis = deriveMetricsBasis({ published: artifact.seasonStats.metricsBasis, liveEventKeys: contributingEventKeys, eventArtifactsByKey });

  return {
    events,
    metricHistory,
    // Spread first: every publisher-owned field (`metrics`, and whatever the
    // publisher adds next) survives; only the two fields the live view can
    // honestly bring forward are replaced.
    seasonStats: { ...artifact.seasonStats, record, ...(metricsBasis !== undefined ? { metricsBasis } : {}) },
  };
}
