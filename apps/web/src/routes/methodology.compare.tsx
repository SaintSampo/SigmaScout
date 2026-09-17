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
import { COMPARE_LEAD, COMPARE_LEAD_TESTID, COMPARE_PAGE_TITLE } from "../components/compare/compareCopy.js";
import { CalibrationSection } from "../components/compare/CalibrationSection.js";
import type { CompareArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * The `/compare` route: the five-artifact fetch/parse path plus the real
 * `AccuracyTable`.
 *
 * Declares NO `validateSearch` of its own: `__root.tsx` already validates
 * `year`/`algorithm` through `RootSearchSchema` at the router boundary, and
 * this page deliberately ignores both — Compare filters by neither.
 * `COMPARE_SEASONS` (a module constant derived from `SEASONS`, never
 * `?year=`) is the only source of "which years this page fetches", so a
 * hand-edited `/compare?year=2023` still renders all five seasons.
 */
export const Route = createFileRoute("/methodology/compare")({
  component: ComparePage,
});

/**
 * The methodology note's and the calibration section's pending-state
 * placeholders are declared HERE, in `compare.tsx`, rather than added as
 * skeleton siblings inside `MethodologyNote.tsx` or `CalibrationSection.tsx`
 * — neither ships one by its own design, and adding one to each would mean
 * editing two files this component otherwise has no reason to touch. Both
 * compositions size their repeated `Skeleton` lines from a named module
 * constant, never a bare number at the call site, matching
 * `AccuracyTable.tsx`'s own precedent.
 */
// One line: `MethodologyNote` is a single static sentence.
const METHODOLOGY_NOTE_SKELETON_LINE_COUNT = 1;
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
 * page's own order — so the page's footprint does not jump when the five
 * artifacts land.
 */
function ComparePendingSections() {
  return (
    <>
      <AccuracyTableSkeleton />
      <MethodologyNoteSkeleton />
      <CalibrationSectionSkeleton />
    </>
  );
}

function ComparePage() {
  // The ONE compLevelView state: drives AccuracyTable below and the
  // calibration section. MethodologyNote is static copy and reads neither. `CompLevelSwitcher` is fully
  // controlled and declares no selection state of its own, so this is the
  // single source of truth.
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
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      {/* The page title renders from first paint regardless of query state
          — the same "gate content, never the element's own existence" rule
          the event page's tab strip already follows. */}
      <h1 className="text-role-heading mb-[var(--spacing-md)]">{COMPARE_PAGE_TITLE}</h1>
      <p data-testid={COMPARE_LEAD_TESTID} className="mb-[var(--spacing-md)] max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
        {COMPARE_LEAD}
      </p>

      {/* The switcher renders from first paint alongside the title, gated
          on nothing — it filters already-fetched data and issues no
          request of its own, present during the pending branch exactly as
          it is when populated. */}
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
              own test asserts they never appear. Static copy: it reads no
              artifact and ignores the switcher. */}
          <div className="mt-[var(--spacing-md)]">
            <MethodologyNote />
          </div>
          {/* Fed the SAME compLevelView state the accuracy table receives above. */}
          <CalibrationSection artifactsByYear={artifactsByYear} compLevelView={compLevelView} />
        </>
      )}
    </div>
  );
}
