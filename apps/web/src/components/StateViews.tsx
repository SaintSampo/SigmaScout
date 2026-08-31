import { Button } from "@/components/ui/button";

/**
 * The one empty-state view every wave-4 table renders (05-03-PLAN.md Task 2).
 * `heading` and `body` are supplied by the caller because the UI contract's
 * Copywriting Contract parameterizes them per resource — the Events page's
 * filtered-to-zero case ("No events match your filters") and the Teams
 * page's year-gap case ("No teams for {year}", per D-11's "same
 * heading/body pattern applies verbatim with 'for {year}' substituted in")
 * are the same component with different text, not different components.
 *
 * "Clear filters" is the one fixed literal string from the Copywriting
 * Contract; it renders only when `onClearFilters` is supplied (D-11's
 * one-click clear is a Teams/Events filter concept, not universal to every
 * empty state this component might later serve).
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
 * a failed Teams or Events artifact fetch (Copywriting Contract's "Error
 * state" row). Unlike `EmptyState`, both copy lines are fixed templates
 * owned by this component — only `resource` and `year` vary per call site.
 *
 * `year` is OPTIONAL (08-01-PLAN.md Decision 2): the Compare page is this
 * site's first page whose data is not scoped to a single year — five
 * simultaneous per-season fetches, with no one honest year to substitute
 * into "for {year}". When `year` is omitted, the rendered line drops the
 * trailing "for {year}" clause entirely, producing the Copywriting
 * Contract's exact Compare-page string ("Couldn't load comparison data.").
 * All four pre-existing call sites pass a year and render byte-identically
 * to before this change — this is additive, not a behavior change for them.
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
