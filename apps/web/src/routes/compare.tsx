import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPARE_SEASONS, compareQueryOptions, type CompareCompLevelView } from "../lib/api/compare.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import { AccuracyTable, AccuracyTableSkeleton } from "../components/compare/AccuracyTable.js";
import { CompLevelSwitcher, DEFAULT_COMP_LEVEL_VIEW } from "../components/compare/CompLevelSwitcher.js";
import { MethodologyNote } from "../components/compare/MethodologyNote.js";
import { CalibrationSection } from "../components/compare/CalibrationSection.js";
import { DataCoverageSection, DataCoverageSectionSkeleton } from "../components/compare/DataCoverageTable.js";
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
 * 08-12-PLAN.md Decision 7: the methodology note's and the calibration
 * section's pending-state placeholders are declared HERE, in `compare.tsx`,
 * rather than added as skeleton siblings inside `MethodologyNote.tsx` or
 * `CalibrationSection.tsx` — neither ships one by its own plan's design
 * (08-06, 08-10), and adding one to each would mean editing two files this
 * plan otherwise has no reason to touch. Both compositions size their
 * repeated `Skeleton` lines from a named module constant, never a bare
 * number at the call site, matching `AccuracyTable.tsx`'s own
 * `ACCURACY_TABLE_ROW_COUNT`/`ACCURACY_TABLE_COLUMN_COUNT` precedent.
 */
const METHODOLOGY_NOTE_SKELETON_LINE_COUNT = 2;
const CALIBRATION_SECTION_SKELETON_TEXT_LINE_COUNT = 3;

function MethodologyNoteSkeleton() {
  return (
    <div className="mt-[var(--spacing-md)] flex flex-col gap-[var(--spacing-xs)]">
      {Array.from({ length: METHODOLOGY_NOTE_SKELETON_LINE_COUNT }, (_, index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
    </div>
  );
}

function CalibrationSectionSkeleton() {
  return (
    <div className="mt-[var(--spacing-xl)] flex flex-col gap-[var(--spacing-sm)]">
      <Skeleton className="h-7 w-40" />
      {Array.from({ length: CALIBRATION_SECTION_SKELETON_TEXT_LINE_COUNT }, (_, index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
      <Skeleton className="h-[220px] w-full" />
    </div>
  );
}

/**
 * The pending branch's shape-preserving composition, in the populated
 * page's own order: the real `AccuracyTableSkeleton` (08-01), a text-free
 * methodology-note placeholder, a text-free calibration-section placeholder,
 * then Task 2's real `DataCoverageSectionSkeleton` — so the page's footprint
 * does not jump when the five artifacts land (UI-SPEC C4 loading).
 */
function ComparePendingSections() {
  return (
    <>
      <AccuracyTableSkeleton />
      <MethodologyNoteSkeleton />
      <CalibrationSectionSkeleton />
      <DataCoverageSectionSkeleton />
    </>
  );
}

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

      {!is404 && !otherError && isPending && <ComparePendingSections />}

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
          {/* Fed the SAME compLevelView state the accuracy table receives
              above (one state, three consumers now, D-09). */}
          <CalibrationSection artifactsByYear={artifactsByYear} compLevelView={compLevelView} />
          {/* The LAST section on the page (UI-SPEC's layout order, item
              six), a DOM sibling of CalibrationSection — the same one
              compLevelView state, its third consumer (08-12-PLAN.md). No
              new state declared anywhere in this file. */}
          <DataCoverageSection artifactsByYear={artifactsByYear} compLevelView={compLevelView} />
        </>
      )}
    </div>
  );
}
