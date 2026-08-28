import { Skeleton } from "@/components/ui/skeleton";
import { isValidEventKey } from "../../lib/eventKey.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The D-18 item 8 identity header (07-15-PLAN.md Task 1) — the page's own
 * statement of which event it is showing, fed by the same single artifact
 * fetch every tab already reads. Mounted as a DOM sibling above the tab
 * strip in `routes/event.$eventKey.tsx`, never inside it and never wrapping
 * or being wrapped by it.
 */

/** The hardcoded TBA event-page origin-and-path prefix, matching `SeasonHeader.tsx`'s own team-page construction one segment over (PD-10). The literal origin makes scheme/host injection unreachable by construction. */
export const TBA_EVENT_URL_PREFIX = "https://www.thebluealliance.com/event/";

/**
 * The outbound "View on TBA" href, or `undefined` for a key `isValidEventKey`
 * rejects — in which case the header renders no anchor at all rather than an
 * anchor with an unvalidated href (PD-10, T-07-15-01). Delegates to
 * `lib/eventKey.ts`'s own predicate rather than restating
 * `EVENT_KEY_PATTERN` here, so this stays the one place the key convention is
 * checked.
 */
export function tbaEventUrl(eventKey: string): string | undefined {
  if (!isValidEventKey(eventKey)) return undefined;
  return `${TBA_EVENT_URL_PREFIX}${eventKey}`;
}

/**
 * Formats a date-only `YYYY-MM-DD` string for the metadata line, or returns
 * the em-dash when the field is absent. The `timeZone: "UTC"` pin is
 * load-bearing (PD-04): `startDate` carries no time-of-day, so
 * `new Date("2024-03-07")` resolves to UTC midnight, and formatting that
 * through a negative-offset locale would render the previous calendar day —
 * a wrong fact that looks exactly like a right one. Pinning UTC renders the
 * same calendar day for every viewer while still honouring the viewer's
 * locale for month naming and ordering.
 */
export function formatEventStartDate(startDate: string | undefined): string {
  if (startDate === undefined) return "—";
  const date = new Date(startDate);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * The three-segment metadata line — date, location, week — always all
 * three, never collapsed: an absent fact renders as a visible em-dash rather
 * than a shorter, less honest line.
 *
 * Segment two's `??` is correct HERE for exactly the reason it was wrong at
 * the publish boundary (PD-02): the value has already passed
 * `EventArtifactSchema`'s `.min(1)` parse, so the only thing `??` can catch
 * is genuine absence (`undefined`) alongside a genuine recorded null —
 * both render the same em-dash per the schema's own absence contract.
 *
 * Segment three tests `undefined` and `null` explicitly and never by
 * truthiness or nullish coalescing: a week index of zero is a real, measured
 * value (25 to 32 events per season) that a truthiness guard would silently
 * relabel as offseason. Copied from `EventsList.tsx`'s own week-cell rule —
 * do not import across the component-module boundary (PD-03).
 */
export function eventMetaLine(parts: { startDate?: string; location?: string | null; week?: number | null }): string {
  const dateSegment = formatEventStartDate(parts.startDate);
  const locationSegment = parts.location ?? "—";
  let weekSegment: string;
  if (parts.week === undefined) {
    weekSegment = "—";
  } else if (parts.week === null) {
    weekSegment = "Offseason";
  } else {
    weekSegment = `Week ${parts.week}`;
  }
  return `${dateSegment} · ${locationSegment} · ${weekSegment}`;
}

export interface EventHeaderProps {
  /** The already-`.parse()`d artifact this page fetched for its tabs — never a hand-shaped interface, so a value that hasn't passed `.min(1)` cannot reach this component (PD-01). */
  artifact: EventArtifact;
}

/**
 * The page's single `<h1>` (the published name, or the honest event-key
 * fallback), the composed metadata line, and the "View on TBA" link. Every
 * artifact-sourced string renders as a plain JSX text node or a `title`
 * attribute value — never through a raw-markup sink — because an event name
 * is human-entered third-party TBA text (T-07-15-04).
 */
export function EventHeader({ artifact }: EventHeaderProps) {
  const headingText = artifact.name ?? artifact.eventKey;
  const metaLine = eventMetaLine({ startDate: artifact.startDate, location: artifact.location, week: artifact.week });
  const tbaUrl = tbaEventUrl(artifact.eventKey);

  return (
    <div
      data-testid="event-header"
      className="flex min-w-0 flex-col gap-[var(--spacing-sm)] rounded-[var(--radius)] bg-[var(--color-bg-surface)] p-[var(--spacing-md)]"
    >
      <h1 title={headingText} className="text-role-heading min-w-0 truncate text-[var(--color-text-primary)]">
        {headingText}
      </h1>
      <div data-testid="event-header-meta" className="text-role-body text-[var(--color-text-muted)]">
        {metaLine}
      </div>
      {tbaUrl !== undefined && (
        // rel="noopener" (never target's default) closes reverse-tabnabbing
        // (T-07-15-02). `noreferrer` is deliberately NOT added — see
        // T-07-15-03: nothing secret is carried in this URL, and adding it
        // would diverge from `SeasonHeader.tsx`'s one shipped external-link
        // recipe for no protective benefit.
        <a
          href={tbaUrl}
          target="_blank"
          rel="noopener"
          className="text-role-body text-[var(--color-accent)] underline-offset-2 hover:underline"
        >
          View on TBA
        </a>
      )}
    </div>
  );
}

/**
 * The header's pending-state placeholder (PD-09: lives here, not in
 * `Skeletons.tsx` — this is the only consumer). Sized to the real header's
 * own rhythm so the tab strip does not jump downward when the artifact
 * lands.
 */
export function EventHeaderSkeleton() {
  return (
    <div
      data-testid="event-header-skeleton"
      className="flex min-w-0 flex-col gap-[var(--spacing-sm)] rounded-[var(--radius)] bg-[var(--color-bg-surface)] p-[var(--spacing-md)]"
    >
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}
