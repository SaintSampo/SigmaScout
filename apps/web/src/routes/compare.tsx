import { createFileRoute } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { COMPARE_SEASONS, compareQueryOptions } from "../lib/api/compare.js";
import { ArtifactFetchError } from "../lib/api/errors.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import type { CompareArtifact } from "../../../../packages/harness/pageArtifacts.js";

/**
 * The real `/compare` route (08-01-PLAN.md Task 1), replacing Phase 5's
 * 21-line placeholder wholesale. This task wires ONE path — real R2 bytes,
 * through `CompareArtifactSchema`, to rendered elements — with no table
 * component yet (Task 2), no compLevel switcher, no calibration, no
 * coverage section. Task 3 deletes the `compare-parse-proof` tracer element
 * below and mounts the real `AccuracyTable` in its place.
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
 * The tracer's parse-proof placeholder row count is irrelevant here (no
 * skeleton exists yet at this stage) — this constant is Task 3's, added
 * when `AccuracyTableSkeleton` is mounted. Not declared in Task 1.
 */

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

      {!is404 && !otherError && isPending && (
        <p className="text-role-body text-muted-foreground">Loading comparison data…</p>
      )}

      {!is404 && !otherError && !isPending && (
        <div className="flex flex-col gap-[var(--spacing-sm)]">
          {COMPARE_SEASONS.map((year, index) => {
            const artifact = results[index]?.data as CompareArtifact | undefined;
            if (artifact === undefined) return null;
            const vprCombinedSlice = artifact.slices.find(
              (slice) => slice.algorithmId === "vpr" && slice.season === year && slice.compLevelView === "combined",
            );
            return (
              <p key={year} data-testid="compare-parse-proof" className="numeric-cell text-role-body">
                {`${year}: ${vprCombinedSlice?.brierScore?.toFixed(4) ?? "—"}`}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
