import { createFileRoute } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { COMPARE_SEASONS, compareQueryOptions } from "../lib/api/compare.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import { AccuracyTable, AccuracyTableSkeleton } from "../components/compare/AccuracyTable.js";
import type { CompareArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * The real `/compare` route (08-01-PLAN.md Tasks 1 and 3), replacing
 * Phase 5's 21-line placeholder wholesale. Task 1's tracer proved the
 * five-artifact fetch/parse path; Task 3 mounts the real `AccuracyTable` in
 * place of the tracer's proof-of-parse scaffolding, which never shipped.
 *
 * Declares NO `validateSearch` of its own (08-01-PLAN.md Decision 3):
 * `__root.tsx` already validates `year`/`algorithm` through
 * `RootSearchSchema` at the router boundary, and this page deliberately
 * ignores both — 08-UI-SPEC.md's Global-dropdown exception is explicit that
 * Compare filters by neither. `COMPARE_SEASONS` (a module constant derived
 * from `SEASONS`, never `?year=`) is the only source of "which years this
 * page fetches", so a hand-edited `/compare?year=2023` still renders all
 * five seasons.
 */
export const Route = createFileRoute("/compare")({
  component: ComparePage,
});

/**
 * This plan's Compare surface mounts only the accuracy table, at the
 * combined compLevel view — 08-06 wires the real switcher into
 * `AccuracyTable`'s `compLevelView` prop with no other change to this
 * component (08-01-PLAN.md `key_links`).
 */
const INITIAL_COMP_LEVEL_VIEW = "combined" as const;

function ComparePage() {
  const results = useQueries({
    queries: COMPARE_SEASONS.map((year) => compareQueryOptions({ year })),
  });

  // One page-level state derived from all five results, in the SAME fixed
  // branch order `event.$eventKey.tsx`'s `renderTabState` uses: 404, other
  // error, pending, populated. Five independent per-year branches are
  // explicitly not the shape — every "inherits the page-level error" claim
  // on this page rests on there being exactly one.
  const is404 = results.some((r) => r.error instanceof ArtifactFetchError && r.error.status === 404);
  const otherError = results.some((r) => r.error && !(r.error instanceof ArtifactFetchError && r.error.status === 404));
  const isPending = results.some((r) => r.isPending);

  // Five entries at most, rebuilt each render — no useMemo warranted for a
  // map this small; COMPARE_SEASONS' own order is what buildAccuracyRows
  // walks, so this map's construction order is never load-bearing.
  const artifactsByYear = new Map<number, CompareArtifact>();
  COMPARE_SEASONS.forEach((year, index) => {
    const data = results[index]?.data as CompareArtifact | undefined;
    if (data !== undefined) artifactsByYear.set(year, data);
  });

  function retryFailed() {
    for (const r of results) {
      if (r.error) void r.refetch();
    }
  }

  return (
    <div className="p-[var(--spacing-lg)]">
      {/* The page title renders from first paint regardless of query state
          — the same "gate content, never the element's own existence" rule
          the event page's tab strip already follows. */}
      <h1 className="text-role-heading mb-[var(--spacing-md)]">Compare</h1>

      {is404 && (
        <EmptyState
          heading="No published comparison data yet"
          body="This usually means results haven't published yet. Check back shortly."
        />
      )}

      {!is404 && otherError && <ErrorState resource="comparison data" onRetry={retryFailed} />}

      {!is404 && !otherError && isPending && <AccuracyTableSkeleton />}

      {!is404 && !otherError && !isPending && (
        <AccuracyTable artifactsByYear={artifactsByYear} compLevelView={INITIAL_COMP_LEVEL_VIEW} />
      )}
    </div>
  );
}
