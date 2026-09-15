import { useMemo } from "react";
import { EmptyState } from "@/components/StateViews";
import { EventMatchTable, EventMatchTableSkeleton } from "./EventMatchTable.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { computeEventAxisDomain, isQualCompLevel, mergeEventMatches } from "./eventMatchAxis.js";
import type { EventPageArtifact } from "../../lib/eventPricing.js";

/**
 * The Quals tab: this event's qualification matches (`compLevel === "qm"`
 * only) as one client-merged chronological list, drawn on a domain computed
 * fresh over THIS tab's played AND scheduled rows and nothing else.
 *
 * `matches[]`/`upcoming[]` are read-only inputs — `mergeEventMatches`
 * mutates neither. The scroll region carries `min-w-0`, `touch-pan-xy`
 * (permits vertical page scroll AND pinch-zoom; a `touch-pan-x` would block
 * every vertical gesture starting on this element), `overflow-x-auto` and
 * `overscroll-x-contain`, and is a DOM SIBLING of the tab strip's own
 * scroll region — neither contains the other.
 */
export interface QualsTabProps {
  artifact: EventPageArtifact;
  algorithmId: string;
  season: number;
}

/**
 * The empty-state body, verbatim, exported so the Elims tab renders the
 * identical sentence rather than a paraphrase.
 */
export const QUALS_EMPTY_STATE_BODY = "This usually means results haven't published yet. Check back shortly.";

const QUALS_SKELETON_ROW_COUNT = 6;

/**
 * The pending state's placeholder — the same scroll-region wrapper shape
 * the populated tab uses, so the pending and populated states share a
 * footprint and the panel does not jump when data lands.
 */
export function QualsTabSkeleton() {
  return (
    <div data-testid="quals-table-scroll" className="data-card min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
      <EventMatchTableSkeleton rowCount={QUALS_SKELETON_ROW_COUNT} />
    </div>
  );
}

/**
 * Renders `EmptyState` (no table, no axis header, no scroll region) when the
 * merged row list is empty — the real Championship Finals (Einstein) case,
 * live-reachable, not a defensive branch. Renders the full table for a
 * played-empty/upcoming-populated event (`2025srsd`'s shape) — empty means
 * zero qualification matches at all, never "none played yet".
 *
 * This copy reads as "not yet published", which is exactly right for an
 * event mid-schedule and slightly wrong for a Championship Finals event
 * where qualification rounds structurally never exist. Distinguishing
 * those two cases needs the event type, which is deliberately deferred
 * rather than resolved by inventing a second copy variant on this tab
 * alone.
 */
export function QualsTab({ artifact, season, algorithmId }: QualsTabProps) {
  const rows = useMemo(() => mergeEventMatches(artifact.matches, artifact.upcoming, isQualCompLevel), [artifact]);
  const domain = useMemo(() => computeEventAxisDomain(rows), [rows]);

  if (rows.length === 0) {
    const eventName = artifact.name ?? artifact.eventKey;
    return <EmptyState heading={`No matches found for ${eventName}`} body={QUALS_EMPTY_STATE_BODY} />;
  }

  return (
    <div data-testid="quals-table-scroll" className="data-card min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
      <EventMatchTable rows={rows} domain={domain} season={season} algorithm={algorithmId as PublishedAlgorithmId} />
    </div>
  );
}
