import { useEffect, useRef } from "react";
import type { EventTierCuts, TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { markFirstRowsRendered, measureParseToPaint } from "../../lib/perfMarks.js";
import { computeAxisDomain } from "./matchAxis.js";
import { EventSection } from "./EventSection.js";
import type { TeamSeasonEvent } from "./matchAxis.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";

/**
 * The second composition seam `OverviewTab.tsx` freezes — a section's match
 * table fills in without editing this prop contract or `OverviewTab.tsx`.
 */
export interface EventSectionListProps {
  artifact: TeamSeasonArtifact;
  algorithmId: string;
  season: number;
  teamNumber: number;
  /**
   * The LIVE view, threaded from the route (260917-jr4). This component used
   * to call the overlay hook ITSELF; it no longer does, because the metric
   * history and the overlaid events must come from ONE resolution of the
   * live-event set — two independent resolutions could disagree about which
   * events are live and paint a chart whose last points belong to matches
   * the table beside it still calls upcoming. Both fall back to the
   * published arrays.
   */
  events?: readonly TeamSeasonEvent[];
  metricHistory?: readonly MetricHistoryRow[];
  /** Each live event's `tierCuts` block, by event key — see `useLiveTeamSeason.ts`'s `tierCutsByEventKey` doc comment. Looked up per event below; a missing entry means "no cuts", the honest answer for a finished or pre-republish event. */
  tierCutsByEventKey?: Readonly<Record<string, EventTierCuts>>;
}

/**
 * One section per event the team attended (or is scheduled to attend) this
 * season, ordered by `startDate` ascending — ISO `YYYY-MM-DD` strings sort
 * correctly with a plain string comparator, no `Date` parsing needed. An
 * event carrying zero matches is not rendered at all — that case folds into
 * the page-level zero-events state. The shared score axis domain is
 * computed ONCE here, across the whole team-season, and passed down to
 * every section — never recomputed per event or per row.
 */
export function EventSectionList({ artifact, algorithmId, season, events: overlaidEvents, metricHistory, tierCutsByEventKey }: EventSectionListProps) {
  // A live event's matches come from its event artifact (priced upcoming rows,
  // fresh results); every other event is the published rows, same reference.
  const overlaid = overlaidEvents ?? artifact.events;
  const rows = metricHistory ?? artifact.metricHistory;
  const events = [...overlaid]
    .filter((event) => event.matches.length > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Over the overlaid rows, so a browser-priced upcoming band sits inside the shared axis.
  const domain = computeAxisDomain(overlaid);

  // Reuses `teams.tsx`'s own `artifact-parsed` -> `first-rows-rendered`
  // parse-to-paint pair (`perfMarks.ts`) rather than inventing a second mark
  // name — this is the LAST thing painted in the Overview tab (06-08-PLAN.md
  // Task 3's many-section render-time measurement), guarded on the specific
  // `artifact` reference so it fires once per load, never on every re-render.
  const markedArtifactRef = useRef<typeof artifact>(undefined);
  useEffect(() => {
    if (markedArtifactRef.current === artifact) return;
    markedArtifactRef.current = artifact;
    markFirstRowsRendered();
    const durationMs = measureParseToPaint();
    console.log(JSON.stringify({ event: "team-parse-to-paint", teamKey: artifact.teamKey, season: artifact.season, eventCount: events.length, durationMs }));
  }, [artifact, events.length]);

  return (
    <div className="flex min-w-0 flex-col gap-[var(--spacing-2xl)]">
      {events.map((event) => (
        <EventSection
          key={event.eventKey}
          event={event}
          domain={domain}
          teamKey={artifact.teamKey}
          algorithmId={algorithmId}
          season={season}
          metricHistory={rows}
          tierCuts={tierCutsByEventKey?.[event.eventKey]}
        />
      ))}
    </div>
  );
}
