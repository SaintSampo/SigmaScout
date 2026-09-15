import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useAlgorithmVersion } from "../ribbon/AlgorithmSelect.js";
import { eventQueryOptions } from "../../lib/api/event.js";
import { teamEventNeedsLivePricing } from "../../lib/liveEvent.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { TeamSeasonEvent } from "./matchAxis.js";
import { overlayTeamEventMatches } from "./teamUpcomingOverlay.js";

/**
 * The team page's events with each LIVE event's matches taken from that
 * event's own artifact (260915-m4j, LD-2): browser-priced upcoming rows,
 * results the team artifact has not caught up with, and "No prediction" for
 * an upcoming match nobody could price.
 *
 * - Only events where the team still has an unplayed match AND the schedule
 *   is current (`teamEventNeedsLivePricing`) are queried. A long-finished
 *   event is never fetched, so an ordinary team page makes no extra request.
 * - The query is `eventQueryOptions` itself, the event page's own key, so the
 *   two pages share one fetch, one pricing and the 60 s live polling.
 * - One `useQueries` call whatever the event count: the hook count never
 *   depends on a branch.
 * - While a query is pending or failed, that event shows its published rows.
 */
export function useTeamUpcomingOverlay(artifact: TeamSeasonArtifact, algorithmId: string): TeamSeasonEvent[] {
  const publishedId = (PUBLISHED_ALGORITHM_IDS as readonly string[]).includes(algorithmId) ? (algorithmId as PublishedAlgorithmId) : undefined;
  const version = useAlgorithmVersion(publishedId ?? "spr");

  // One clock reading per artifact: re-rendering never flips an event in or out of the live set.
  const now = useMemo(() => Date.now(), [artifact]);
  const liveEvents = useMemo(
    () => (publishedId === undefined ? [] : artifact.events.filter((event) => teamEventNeedsLivePricing(event, now))),
    [artifact, now, publishedId]
  );

  const results = useQueries({
    queries: liveEvents.map((event) => ({
      ...eventQueryOptions({ eventKey: event.eventKey, algorithmId, version: version ?? "" }),
      enabled: version !== undefined,
    })),
  });

  // No live event (every ordinary team page): the published events, same reference, no work.
  if (liveEvents.length === 0) return artifact.events;
  // A handful of events with tens of rows each: recomputed per render rather than memoized on a variable-length dependency list.
  const dataByEventKey = new Map(liveEvents.map((event, index) => [event.eventKey, results[index]?.data]));
  return artifact.events.map((event) =>
    dataByEventKey.has(event.eventKey)
      ? { ...event, matches: overlayTeamEventMatches({ teamKey: artifact.teamKey, event, eventArtifact: dataByEventKey.get(event.eventKey) }) }
      : event
  );
}
