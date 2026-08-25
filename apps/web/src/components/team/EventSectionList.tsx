import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The second composition seam `OverviewTab.tsx` freezes this task
 * (06-01-PLAN.md Task 2) — plan 06-08 fills in each section's match table
 * (band/tick/dot anatomy) without editing this prop contract or
 * `OverviewTab.tsx`.
 */
export interface EventSectionListProps {
  artifact: TeamSeasonArtifact;
  algorithmId: string;
  season: number;
  teamNumber: number;
}

/**
 * One heading per event the team attended (or is scheduled to attend) this
 * season, ordered by `startDate` ascending — ISO `YYYY-MM-DD` strings sort
 * correctly with a plain string comparator, no `Date` parsing needed. Long
 * event names truncate by CSS ellipsis with a `title` attribute (same rule
 * as `SeasonHeader`'s nickname). Match rows themselves are plan 06-08's job.
 */
export function EventSectionList({ artifact }: EventSectionListProps) {
  const events = [...artifact.events].sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div className="flex min-w-0 flex-col gap-[var(--spacing-2xl)]">
      {events.map((event) => (
        <section key={event.eventKey} className="flex min-w-0 flex-col gap-[var(--spacing-sm)]">
          <h2 title={event.eventName} className="text-role-heading min-w-0 truncate text-[var(--color-text-primary)]">
            {event.eventName}
          </h2>
          <p className="text-role-body text-[var(--color-text-muted)]">{event.startDate}</p>
        </section>
      ))}
    </div>
  );
}
