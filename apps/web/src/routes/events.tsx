import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EventsSearchSchema } from "../lib/searchParams.js";
import { eventsQueryOptions } from "../lib/api/events.js";
import { useAlgorithmVersion } from "../components/ribbon/AlgorithmSelect.js";
import { EventsList } from "../components/events-list/EventsList.js";
import { EventFilters } from "../components/events-list/EventFilters.js";
import { applyEventFilters, isDisplayableEvent, sortEvents, type EventFilters as EventFiltersModel, type EventSortKey } from "../components/events-list/filterModel.js";

/**
 * EVNT-01's real Events page (05-07-PLAN.md Task 3), replacing plan 05-05's
 * placeholder. Reads the validated params, issues the single events query
 * for the year, derives filter options from the fetched rows, applies the
 * filters and sort, and renders the list. A year change preserves filters
 * and sort — `applyYearChange`'s cross-route spread already does this, and
 * `eventSort`/`eventSortDir` (not `sort`/`sortDir`) is exactly why it does
 * so correctly rather than being silently corrupted by the Teams-specific
 * metric-key resolution (see `searchParams.ts`'s own doc comment).
 */
export const Route = createFileRoute("/events")({
  validateSearch: EventsSearchSchema,
  component: EventsPage,
});

function EventsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { year, algorithm, week, country, state, district, eventSort, eventSortDir } = search;

  // Same disabled-until-resolved seam `teams.tsx` uses: the artifact query
  // stays off until the algorithms manifest resolves a real version, rather
  // than firing with a placeholder.
  const version = useAlgorithmVersion(algorithm);

  const { data, status, refetch } = useQuery({
    ...eventsQueryOptions({ year, algorithmId: algorithm, version: version ?? "" }),
    enabled: version !== undefined,
  });

  // `status` stays "pending" while the query is disabled (no version yet) —
  // EventsList's own "pending" branch (skeleton + real headers) covers that
  // wait identically to the "fetch in flight" case, so no extra state is
  // needed here.

  // `isDisplayableEvent` drops resultless unofficial events before ANY other
  // derivation, so the filter dropdowns never offer a week that only those
  // hidden rows would populate.
  const allEvents = (data?.events ?? []).filter(isDisplayableEvent);
  const filters: EventFiltersModel = { week, country, state, district };
  const hasActiveFilter = week !== undefined || country !== undefined || state !== undefined || district !== undefined;

  const filteredEvents = applyEventFilters(allEvents, filters);
  const sortedEvents = sortEvents(filteredEvents, eventSort, eventSortDir);

  function handleFiltersChange(nextFilters: EventFiltersModel) {
    navigate({
      search: (prev) => ({
        ...prev,
        week: nextFilters.week,
        country: nextFilters.country,
        state: nextFilters.state,
        district: nextFilters.district,
      }),
    });
  }

  function handleClearFilters() {
    navigate({
      search: (prev) => ({
        ...prev,
        week: undefined,
        country: undefined,
        state: undefined,
        district: undefined,
      }),
    });
  }

  function handleSortChange(key: EventSortKey) {
    navigate({
      search: (prev) => ({
        ...prev,
        eventSort: key,
        eventSortDir: prev.eventSort === key && prev.eventSortDir === "asc" ? "desc" : "asc",
      }),
    });
  }

  function handleRetry() {
    void refetch();
  }

  return (
    // Content capped and centered (2026-09-01 redesign, decision E1): seven
    // narrow data columns stretched edge-to-edge was most of the old page's
    // empty space. 1100px holds the flexed name column comfortably.
    <div className="mx-auto max-w-[1100px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)] text-[var(--color-text-primary)]">Events {year}</h1>
      {/* Per 05-UI-SPEC.md: "The controls are not rendered at all when the fetch
          failed — the list's error state is the single place that failure
          surfaces." Filter option lists also derive locally from the fetched
          rows, so the controls have no fetch and no loading state of their
          own. */}
      {status === "success" && (
        <div className="mb-[var(--spacing-md)]">
          <EventFilters events={allEvents} filters={filters} onFiltersChange={handleFiltersChange} onClearFilters={handleClearFilters} />
        </div>
      )}
      <EventsList
        status={status}
        events={sortedEvents}
        year={year}
        algorithm={algorithm}
        hasActiveFilter={hasActiveFilter}
        onClearFilters={handleClearFilters}
        onRetry={handleRetry}
        sortKey={eventSort}
        sortDir={eventSortDir}
        onSortChange={handleSortChange}
      />
    </div>
  );
}
