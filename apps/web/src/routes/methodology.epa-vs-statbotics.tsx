import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { epaComparisonQueryOptions, EpaComparisonFetchError } from "../lib/api/epaComparison.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import { EpaComparisonPage, EpaComparisonPageSkeleton } from "../components/methodology/EpaComparisonPage.js";

/**
 * The `/methodology/epa-vs-statbotics` route (quick task 260908-n5o Task 3).
 * One `useQuery` against `epaComparisonQueryOptions` — this artifact has no
 * algorithm/version/year segment, so there is nothing to gate `enabled` on.
 * Branch order matches `methodology.compare.tsx`'s fixed order: 404 empty
 * state, other error state with retry, pending skeleton, populated.
 *
 * Declares no `validateSearch` of its own, matching `methodology.compare.tsx`'s
 * own Decision 3 — this page filters by nothing the URL would carry.
 *
 * NOT linked from the hub yet as of this task's own Task 3 — Task 4 wires
 * `methodologyCardData.ts`'s first card to this route, deliberately kept
 * separate so the two file surfaces this task touches never collide.
 */
export const Route = createFileRoute("/methodology/epa-vs-statbotics")({
  component: EpaComparisonRoute,
});

function EpaComparisonRoute() {
  const query = useQuery(epaComparisonQueryOptions());

  const is404 = query.error instanceof EpaComparisonFetchError && query.error.status === 404;
  const otherError = query.error !== null && !(query.error instanceof EpaComparisonFetchError && query.error.status === 404);

  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      {/* The page title renders from first paint regardless of query state
          — the same rule every other route in this app follows. */}
      <h1 className="text-role-heading mb-[var(--spacing-md)]">Our EPA vs Statbotics' EPA</h1>

      {is404 && (
        <EmptyState
          heading="No published comparison data yet"
          body="This usually means the measurement hasn't been published yet. Check back shortly."
        />
      )}

      {!is404 && otherError && <ErrorState resource="EPA comparison data" onRetry={() => void query.refetch()} />}

      {!is404 && !otherError && (query.isPending || query.data === undefined) && <EpaComparisonPageSkeleton />}

      {!is404 && !otherError && query.data !== undefined && <EpaComparisonPage artifact={query.data} />}
    </div>
  );
}
