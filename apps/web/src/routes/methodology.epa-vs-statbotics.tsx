import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { epaComparisonQueryOptions, EpaComparisonFetchError } from "../lib/api/epaComparison.js";
import { EmptyState, ErrorState } from "../components/StateViews.js";
import { EpaComparisonPage, EpaHeadToHeadResults, EpaHeadToHeadSkeleton } from "../components/methodology/EpaComparisonPage.js";
import { EPA_COMPARISON_PAGE_TITLE } from "../components/methodology/epaComparisonContent.js";

/**
 * The `/methodology/epa-vs-statbotics` route (quick task 260912-tib, a
 * from-scratch rewrite of the page body). One `useQuery` against
 * `epaComparisonQueryOptions` — this artifact has no algorithm/version/year
 * segment, so there is nothing to gate `enabled` on. Branch order matches
 * `methodology.compare.tsx`'s fixed order: 404 empty state, other error
 * state with retry, pending skeleton, populated. The lead, the shared list
 * and every difference card render from first paint regardless of query
 * state — only the head-to-head results slot depends on this route's query.
 *
 * Declares no `validateSearch` of its own, matching `methodology.compare.tsx`'s
 * own Decision 3 — this page filters by nothing the URL would carry.
 */
export const Route = createFileRoute("/methodology/epa-vs-statbotics")({
  component: EpaComparisonRoute,
});

function EpaComparisonRoute() {
  const query = useQuery(epaComparisonQueryOptions());

  const is404 = query.error instanceof EpaComparisonFetchError && query.error.status === 404;
  const otherError = query.error !== null && !(query.error instanceof EpaComparisonFetchError && query.error.status === 404);

  let results;
  if (is404) {
    results = (
      <EmptyState
        heading="No published comparison data yet"
        body="This usually means the measurement hasn't been published yet. Check back shortly."
      />
    );
  } else if (otherError) {
    results = <ErrorState resource="EPA comparison data" onRetry={() => void query.refetch()} />;
  } else if (query.data !== undefined) {
    results = <EpaHeadToHeadResults artifact={query.data} />;
  } else {
    results = <EpaHeadToHeadSkeleton />;
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      {/* The page title renders from first paint regardless of query state
          — the same rule every other route in this app follows. */}
      <h1 className="text-role-heading mb-[var(--spacing-md)]">{EPA_COMPARISON_PAGE_TITLE}</h1>

      <EpaComparisonPage results={results} />
    </div>
  );
}
