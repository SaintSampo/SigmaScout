import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useAlgorithmVersion } from "../ribbon/AlgorithmSelect.js";
import { eventQueryOptions } from "../../lib/api/event.js";
import { liveSidecarQueryOptions } from "../../lib/api/liveSidecar.js";
import { teamEventNeedsLivePricing } from "../../lib/liveEvent.js";
import { deriveMetricsBasis, deriveSeasonRecord, extendMetricHistory, type SeasonRecord } from "../../lib/liveTeamSeason.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { LiveMetricSidecar } from "../../../../../packages/harness/liveMetricSidecar.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { TeamSeasonEvent } from "./matchAxis.js";
import { overlayTeamEventMatches } from "./teamUpcomingOverlay.js";

/**
 * The robot page's whole live view, in ONE hook (quick task 260917-jr4, D-05
 * — this is `useTeamUpcomingOverlay` renamed and widened, not a new parallel
 * path).
 *
 * WHY IT IS ONE HOOK. The page needs two fetches per live event — the event
 * artifact (match rows) and the ephemeral metric sidecar (per-match metrics)
 * — and they must agree, exactly, about WHICH events are live. Two hooks each
 * resolving `teamEventNeedsLivePricing` independently would be two chances to
 * disagree, and a disagreement would show as a chart whose last points belong
 * to matches the table below it still calls upcoming. One resolution of the
 * live-event set feeds both `useQueries` calls.
 *
 * WHY THE SIDECAR IS NEEDED AT ALL. Since 260917-jr4 the live Worker writes
 * NO team-season artifact. Match rows are recoverable from the event artifact
 * (`overlayTeamEventMatches`, shipped 260915-m4j and unchanged here); per-match
 * METRICS are not — they live only inside the tick's algorithm state — so the
 * tick writes them to one small sidecar per event and this hook reads it.
 *
 * WHAT IT RETURNS IS FED TO UNCHANGED CONSUMERS. `metricHistory` goes
 * straight into `officialSnapshotRow`, `endOfEventMetrics`,
 * `buildMetricSeries` and `preMatchMetrics` with no adapter and no fork; see
 * `apps/web/src/lib/liveTeamSeason.ts`'s header.
 *
 * `useQueries` is called with a variable-length array rather than mapping
 * `useQuery` over the live events: the HOOK COUNT never depends on a branch.
 * While a query is pending or failed, that event shows its published rows —
 * degrading to published data, never to an error.
 */
export interface LiveTeamSeason {
  /** The team's events with each live event's matches taken from that event's own artifact. */
  readonly events: readonly TeamSeasonEvent[];
  /** The published metric history, extended with each live event's sidecar rows. Mutable, matching the artifact's own type — see `extendMetricHistory`. */
  readonly metricHistory: MetricHistoryRow[];
  /** `seasonStats` with the record and basis brought forward past the last publish. Every other field is the published one, untouched. */
  readonly seasonStats: TeamSeasonArtifact["seasonStats"];
}

export function useLiveTeamSeason(artifact: TeamSeasonArtifact | undefined, algorithmId: string): LiveTeamSeason | undefined {
  const publishedId = (PUBLISHED_ALGORITHM_IDS as readonly string[]).includes(algorithmId) ? (algorithmId as PublishedAlgorithmId) : undefined;
  const version = useAlgorithmVersion(publishedId ?? "spr");

  // ONE resolution of the live-event set, shared by both query arrays below.
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

  const sidecarResults = useQueries({
    queries: liveEvents.map((event) => ({
      ...liveSidecarQueryOptions({ eventKey: event.eventKey, algorithmId, version: version ?? "" }),
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

  // A handful of events with tens of rows each: recomputed per render rather
  // than memoized on a variable-length dependency list.
  const eventArtifactsByKey = new Map(liveEvents.map((event, index) => [event.eventKey, eventResults[index]?.data]));
  const sidecarsByEventKey = new Map<string, LiveMetricSidecar | null>(liveEvents.map((event, index) => [event.eventKey, sidecarResults[index]?.data ?? null]));

  const events = artifact.events.map((event) =>
    eventArtifactsByKey.has(event.eventKey)
      ? { ...event, matches: overlayTeamEventMatches({ teamKey: artifact.teamKey, event, eventArtifact: eventArtifactsByKey.get(event.eventKey) }) }
      : event
  );

  const metricHistory = extendMetricHistory({ artifact, sidecars: sidecarsByEventKey });
  const contributingEventKeys = liveEvents.filter((event) => sidecarsByEventKey.get(event.eventKey) != null).map((event) => event.eventKey);
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
