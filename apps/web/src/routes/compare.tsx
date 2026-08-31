import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { COMPARE_SEASONS, compareQueryOptions, type CompareCompLevelView } from "../lib/api/compare.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import { AccuracyTable, AccuracyTableSkeleton } from "../components/compare/AccuracyTable.js";
import { CompLevelSwitcher, DEFAULT_COMP_LEVEL_VIEW } from "../components/compare/CompLevelSwitcher.js";
import { MethodologyNote } from "../components/compare/MethodologyNote.js";
import { CalibrationSection } from "../components/compare/CalibrationSection.js";
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

function ComparePage() {
  // The ONE compLevelView state (08-06-PLAN.md Task 2, D-09's "one state,
  // two consumers" obligation): drives AccuracyTable below and, per
  // Decision 5, 08-10's calibration section — but deliberately NOT
  // MethodologyNote (08-06 Task 3), whose figures are pinned to the
  // combined view because D-08's claim and SC-3's verdict are both measured
  // there. `CompLevelSwitcher` is fully controlled and declares no
  // selection state of its own, so this is the single source of truth.
  const [compLevelView, setCompLevelView] = useState<CompareCompLevelView>(DEFAULT_COMP_LEVEL_VIEW);

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

      {/* The switcher renders from first paint alongside the title, gated
          on nothing — it filters already-fetched data and issues no
          request of its own, present during the pending branch exactly as
          it is when populated (UI-SPEC C2 loading). */}
      <div className="mb-[var(--spacing-md)]">
        <CompLevelSwitcher value={compLevelView} onValueChange={setCompLevelView} />
      </div>

      {is404 && (
        <EmptyState
          heading="No published comparison data yet"
          body="This usually means results haven't published yet. Check back shortly."
        />
      )}

      {!is404 && otherError && <ErrorState resource="comparison data" onRetry={retryFailed} />}

      {!is404 && !otherError && isPending && <AccuracyTableSkeleton />}

      {!is404 && !otherError && !isPending && (
        <>
          <AccuracyTable artifactsByYear={artifactsByYear} compLevelView={compLevelView} />
          {/* A DOM SIBLING of AccuracyTable's scroll region, never a
              descendant — mounting the note inside the table would put the
              words it discloses (tune/holdout) inside the component whose
              own test asserts they never appear (D-08). Pinned to the
              combined view (Decision 5), never the switcher's own state —
              re-slicing would make the note's own best-season clause false
              against the committed data. */}
          <div className="mt-[var(--spacing-md)]">
            <MethodologyNote artifactsByYear={artifactsByYear} />
          </div>
          {/* Beneath the methodology note, above where 08-12 will add its
              data-coverage section — fed the SAME compLevelView state the
              accuracy table receives above (one state, two consumers, D-09). */}
          <CalibrationSection artifactsByYear={artifactsByYear} compLevelView={compLevelView} />
        </>
      )}
    </div>
  );
}
