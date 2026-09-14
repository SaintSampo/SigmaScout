import { Button } from "@/components/ui/button";

/**
 * The one empty-state view every wave-4 table renders. `heading` and
 * `body` are supplied by the caller because they are parameterized per
 * resource — the Events page's filtered-to-zero case ("No events match
 * your filters") and the Teams page's year-gap case ("No teams for
 * {year}") are the same component with different text, not different
 * components.
 *
 * "Clear filters" is the one fixed literal string; it renders only when
 * `onClearFilters` is supplied (the one-click clear is a Teams/Events
 * filter concept, not universal to every empty state this component might
 * later serve).
 */
export function EmptyState({
  heading,
  body,
  onClearFilters,
}: {
  heading: string;
  body: string;
  onClearFilters?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-[var(--spacing-sm)] px-[var(--spacing-lg)] py-[var(--spacing-2xl)] text-center">
      <p className="text-role-heading">{heading}</p>
      <p className="text-role-body text-muted-foreground">{body}</p>
      {onClearFilters !== undefined && (
        <Button type="button" variant="link" onClick={onClearFilters} className="p-0">
          Clear filters
        </Button>
      )}
    </div>
  );
}

/**
 * The one error-state view every wave-4 table renders, used identically for
 * a failed Teams or Events artifact fetch. Unlike `EmptyState`, both copy
 * lines are fixed templates owned by this component — only `resource` and
 * `year` vary per call site.
 *
 * `year` is OPTIONAL: the Compare page is this site's first page whose data
 * is not scoped to a single year — five simultaneous per-season fetches,
 * with no one honest year to substitute into "for {year}". When `year` is
 * omitted, the rendered line drops the trailing "for {year}" clause
 * entirely, producing "Couldn't load comparison data." All other call
 * sites pass a year and render byte-identically to before this change.
 */
export function ErrorState({
  resource,
  year,
  onRetry,
}: {
  resource: string;
  year?: string | number;
  onRetry: () => void;
}) {
  const message = year === undefined ? `Couldn't load ${resource}.` : `Couldn't load ${resource} for ${year}.`;
  return (
    <div className="flex flex-col items-center gap-[var(--spacing-sm)] px-[var(--spacing-lg)] py-[var(--spacing-2xl)] text-center">
      <p className="text-role-body text-destructive">{message}</p>
      <p className="text-role-body text-muted-foreground">Check your connection and try again.</p>
      <Button type="button" variant="outline" onClick={onRetry} className="border-destructive text-destructive">
        Retry
      </Button>
    </div>
  );
}
