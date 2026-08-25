import { useEffect, useRef } from "react";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { markFirstRowsRendered, measureParseToPaint } from "../../lib/perfMarks.js";
import { computeAxisDomain } from "./matchAxis.js";
import { EventSection } from "./EventSection.js";

/**
 * The second composition seam `OverviewTab.tsx` freezes (06-01-PLAN.md
 * Task 2) — this plan (06-08) fills in each section's match table without
 * editing this prop contract or `OverviewTab.tsx`.
 */
export interface EventSectionListProps {
  artifact: TeamSeasonArtifact;
  algorithmId: string;
  season: number;
  teamNumber: number;
}

/**
 * One section per event the team attended (or is scheduled to attend) this
 * season, ordered by `startDate` ascending — ISO `YYYY-MM-DD` strings sort
 * correctly with a plain string comparator, no `Date` parsing needed. An
 * event carrying zero matches is not rendered at all — that case folds into
 * the page-level zero-events state plan 06-01 built (E5 empty). The shared
 * score axis domain is computed ONCE here, across the whole team-season
 * (D-06), and passed down to every section — never recomputed per event or
 * per row.
 */
export function EventSectionList({ artifact, algorithmId, season }: EventSectionListProps) {
  const events = [...artifact.events]
    .filter((event) => event.matches.length > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const domain = computeAxisDomain(artifact.events);

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
          metricHistory={artifact.metricHistory}
        />
      ))}
    </div>
  );
}
