import { useMemo } from "react";
import { EventMatchTable } from "./EventMatchTable.js";
import { computeEventAxisDomain, isQualCompLevel, mergeEventMatches } from "./eventMatchAxis.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The Quals tab (EVNT-04, D-12/D-13, 07-12-PLAN.md): this event's
 * qualification matches (`compLevel === "qm"` only) as one client-merged
 * chronological list, drawn on a domain computed fresh over THIS tab's
 * played AND scheduled rows and nothing else (D-12).
 *
 * TRACER SCOPE (Task 1): the merge, the per-tab domain, the scroll region
 * and the table. Task 3 adds the empty state and the skeleton wiring — an
 * empty row list here may render an empty table body.
 */
export interface QualsTabProps {
  artifact: EventArtifact;
  algorithmId: string;
  season: number;
}

/**
 * `matches[]`/`upcoming[]` are read-only inputs here — `mergeEventMatches`
 * mutates neither, which is the assertion protecting Phase 8's input (D-13).
 * The scroll region carries `min-w-0`, `touch-pan-x`, `overflow-x-auto` and
 * `overscroll-x-contain`, and is a DOM SIBLING of the tab strip's own scroll
 * region — neither contains the other (07-RESEARCH.md Open Question 5).
 */
export function QualsTab({ artifact, season }: QualsTabProps) {
  const rows = useMemo(() => mergeEventMatches(artifact.matches, artifact.upcoming, isQualCompLevel), [artifact]);
  const domain = useMemo(() => computeEventAxisDomain(rows), [rows]);

  return (
    <div data-testid="quals-table-scroll" className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain">
      <EventMatchTable rows={rows} domain={domain} season={season} />
    </div>
  );
}
