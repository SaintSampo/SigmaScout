import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * 05-05-PLAN.md Task 2: a placeholder route so the ribbon's "Events" link
 * (NAV-01) has somewhere real to land and never 404s. Plan 05-07 fills this
 * in with the real EVNT-01 events list, week/country/state/district
 * filtering, and its own artifact fetch. This route deliberately has NO
 * fetch of its own yet — the skeleton below is static chrome, not a D-16
 * loading state for real data.
 */
export const Route = createFileRoute("/events")({
  component: EventsPlaceholder,
});

function EventsPlaceholder() {
  return (
    <div className="p-[var(--spacing-lg)]">
      <h1 className="mb-[var(--spacing-md)] text-[20px] font-semibold leading-[1.2] text-[var(--color-text-primary)]">Events</h1>
      <div className="flex flex-col gap-[var(--spacing-sm)]">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}
