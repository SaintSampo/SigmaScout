import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { districtDisplayName } from "@/lib/districtNames";
import { formatEventDate } from "@/lib/eventDates";
import { SkeletonRows } from "@/components/Skeletons";
import { EmptyState, ErrorState } from "@/components/StateViews";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_EVENT_TAB } from "@/lib/searchParams";
import { composeEventLocation } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { hasOutOfBandWeek } from "./filterModel";
import type { EventRow, EventSortDirection, EventSortKey } from "./filterModel";

/**
 * The events list with its loading, empty, error and partial-row states. A
 * season's events are in the low hundreds — no virtualization here, unlike
 * the Teams table.
 *
 * `events` arrives already filtered and sorted by the caller (`events.tsx`)
 * — this component renders that array plainly and reports header clicks
 * back up via `onSortChange` rather than owning any sort/filter state of
 * its own, since sort lives in the URL.
 *
 * The event-name cell is a router `Link` to `/event/{eventKey}`. Only the
 * name cell links; every other cell stays inert, matching
 * `teams-table/columns.tsx`'s own cell-level-link precedent rather than a
 * whole-row anchor.
 */

const SKELETON_ROWS = 8;

interface ColumnDef {
  key: EventSortKey | null;
  label: string;
  numeric?: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Event" },
  // Labelled "Week", not "Type": the `TypeChip` cell this heads encodes
  // OFFICIALNESS (offseason/champs/week-0/week-N), while the sort key orders
  // by raw week with nulls last — related but distinct axes. The chip cell
  // itself does NOT participate in the sort.
  { key: "week", label: "Week", numeric: true },
  { key: "startDate", label: "Date" },
  { key: null, label: "Location" },
  { key: null, label: "District" },
  { key: "teamCount", label: "Teams", numeric: true },
  // Sorts by `playedMatchCount`, not the total `matchCount`, because the
  // cell renders `playedMatchCount/matchCount` and the sort should follow
  // the number the cell leads with.
  { key: "playedMatchCount", label: "Matches", numeric: true },
];

/** `null` renders as a blank cell (2026-09-01 user request: no em-dash placeholders anywhere), never the literal text of a null value. */
function cellText(value: string | null): string {
  return value === null ? "" : value;
}

export interface EventsListProps {
  status: "pending" | "error" | "success";
  events: readonly EventRow[];
  year: number;
  /** Threaded from the route rather than read a second time via a cross-route search hook — carried on the row link's `search` so the destination lands with the reader's current algorithm. */
  algorithm: PublishedAlgorithmId;
  hasActiveFilter: boolean;
  onClearFilters: () => void;
  onRetry: () => void;
  sortKey: EventSortKey;
  sortDir: EventSortDirection;
  onSortChange: (key: EventSortKey) => void;
}

function SortIcon({ direction }: { direction: EventSortDirection }) {
  return direction === "asc" ? (
    <ArrowUpIcon aria-hidden="true" className="size-3 text-[var(--color-accent)]" />
  ) : (
    <ArrowDownIcon aria-hidden="true" className="size-3 text-[var(--color-accent)]" />
  );
}

function ColumnHeaderRow({ sortKey, sortDir, onSortChange }: Pick<EventsListProps, "sortKey" | "sortDir" | "onSortChange">) {
  return (
    <TableHeader>
      {/*
        `h-11` (44px), not the table's default `h-10` (40px): the sort
        controls' hit-area overlay below is `inset-0`, so the CELL is the tap
        target and must itself meet the project's `.tap-target` floor of
        44px. Growing the overlay past the cell instead (an earlier version)
        put it on top of the first result row and ate clicks meant for it.
      */}
      <TableRow className="h-11">
        {COLUMNS.map((column) => {
          if (column.key === null) {
            return (
              <TableHead key={column.label} className="text-role-label">
                {column.label}
              </TableHead>
            );
          }
          const isActive = column.key === sortKey;
          const ariaSort = isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none";
          return (
            <TableHead
              key={column.label}
              aria-sort={ariaSort}
              className={`relative ${column.numeric ? "numeric-cell text-role-label" : "text-role-label"}`}
            >
              {/*
                The visible button below is UNTOUCHED — same normal-flow flex
                layout — because this table has no `table-layout: fixed`, so
                column widths come from the browser's auto-layout content
                measurement, which only counts NORMAL-FLOW content. Making the
                visible button itself `position: absolute` would pull the
                header text out of that measurement and narrow the column to
                fit its body cells instead of its own label.

                Instead a second, invisible full-cell button catches
                pointer/touch input across the whole header cell —
                `aria-hidden` + `tabIndex={-1}` remove it from the
                accessibility tree and tab order, so keyboard/AT users only
                ever see the one real, visible button. It paints above the
                static button by default (absolutely positioned siblings do),
                so it intercepts clicks anywhere in the cell without changing
                what fires.

                The overlay is `inset-0` — exactly its own cell, never an
                overhang past the `th`: an overhang lands on the row below and
                silently steals a strip of the first result's click target.
                The header ROW's own `h-11` buys the 44px tap-target floor
                instead.
              */}
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => onSortChange(column.key as EventSortKey)}
                className="absolute inset-0"
              />
              <button
                type="button"
                onClick={() => onSortChange(column.key as EventSortKey)}
                className="flex items-center gap-[var(--spacing-xs)]"
              >
                {column.label}
                {isActive && <SortIcon direction={sortDir} />}
              </button>
            </TableHead>
          );
        })}
      </TableRow>
    </TableHeader>
  );
}

/** True for events outside the official season: offseason (99, via `isOffseason`) and preseason Week 0 (100). Championship divisions/Einstein are OFFICIAL. Same rule `lib/officialSnapshot.ts` applies on the team page. */
function isUnofficial(event: EventRow): boolean {
  return event.isOffseason || event.eventType === 100;
}

/**
 * The Type chip: ONE officialness vocabulary — filled neutral chip =
 * official season week, the single dark chip = Championship, dashed outline
 * = unofficial (Week 0 preseason / offseason). Week display stays +1 (TBA
 * publishes week 0-indexed) and a null week, or a week TBA indexed OUTSIDE
 * the season scale (`hasOutOfBandWeek`), renders "Other" or nothing rather
 * than a guessed label.
 */
function TypeChip({ event }: { event: EventRow }) {
  if (event.isOffseason) return <span className="event-chip event-chip--unofficial">Offseason</span>;
  if (event.eventType === 3 || event.eventType === 4) return <span className="event-chip event-chip--champs">Champs</span>;
  if (event.eventType === 100) return <span className="event-chip event-chip--unofficial">Week 0</span>;
  if (hasOutOfBandWeek(event)) return <span className="event-chip event-chip--week">Other</span>;
  if (event.week === null) return null;
  return <span className="event-chip event-chip--week">{`Week ${event.week + 1}`}</span>;
}

/**
 * Location string with junk-region suppression: TBA sometimes carries a
 * numeric province code in `state_prov` (İstanbul's "34"), which reads as
 * noise — any region containing a digit is dropped and the row shows the
 * country alone. Real 2-3 letter regions ("BC", "NSW") and full names pass
 * through untouched.
 */
function displayLocation(event: EventRow): string {
  const region = event.stateProv !== null && /\d/.test(event.stateProv) ? null : event.stateProv;
  return composeEventLocation(region, event.country) ?? "";
}

function EventRowView({ event, year, algorithm }: { event: EventRow; year: number; algorithm: PublishedAlgorithmId }) {
  const location = displayLocation(event);
  return (
    <TableRow className={isUnofficial(event) ? "event-row-unofficial" : undefined}>
      <TableCell className="max-w-[22rem] p-0">
        {/*
          Only the name cell links — the header row already carries per-cell
          sort buttons a row-level anchor would swallow, and one linked cell
          keeps the row's other text selectable. `tab` comes from the
          imported `DEFAULT_EVENT_TAB` constant, never a hardcoded id. The
          accent ink marks it as the row's one link; `.event-row-unofficial a`
          (theme.css) overrides it to muted on unofficial rows.
        */}
        <Link
          to="/event/$eventKey"
          params={{ eventKey: event.eventKey }}
          search={{ year, algorithm, tab: DEFAULT_EVENT_TAB }}
          title={event.name}
          className="block max-w-[22rem] truncate p-2 font-medium text-[var(--color-accent)]"
        >
          {event.name}
        </Link>
      </TableCell>
      <TableCell className="numeric-cell">
        <TypeChip event={event} />
      </TableCell>
      <TableCell className="numeric-cell">{formatEventDate(event.startDate)}</TableCell>
      <TableCell className="max-w-[10rem] truncate" title={location}>
        {location}
      </TableCell>
      <TableCell className="max-w-[11rem] truncate" title={event.districtKey === null ? undefined : districtDisplayName(event.districtKey)}>
        {event.districtKey === null ? cellText(null) : districtDisplayName(event.districtKey)}
      </TableCell>
      <TableCell className="numeric-cell">{event.teamCount}</TableCell>
      <TableCell className="numeric-cell">{`${event.playedMatchCount}/${event.matchCount}`}</TableCell>
    </TableRow>
  );
}

export function EventsList({ status, events, year, algorithm, hasActiveFilter, onClearFilters, onRetry, sortKey, sortDir, onSortChange }: EventsListProps) {
  if (status === "error") {
    return (
      <div className="w-full">
        <ErrorState resource="events" year={year} onRetry={onRetry} />
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="data-card">
        <Table>
          <ColumnHeaderRow sortKey={sortKey} sortDir={sortDir} onSortChange={onSortChange} />
          <TableBody>
            <SkeletonRows rows={SKELETON_ROWS} columns={COLUMNS.length} />
          </TableBody>
        </Table>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="w-full">
        <EmptyState
          heading="No events match your filters"
          body="Try removing a filter, or check a different year."
          onClearFilters={hasActiveFilter ? onClearFilters : undefined}
        />
      </div>
    );
  }

  return (
    <div className="data-card">
      <Table>
        <ColumnHeaderRow sortKey={sortKey} sortDir={sortDir} onSortChange={onSortChange} />
        <TableBody>
          {events.map((event) => (
            <EventRowView key={event.eventKey} event={event} year={year} algorithm={algorithm} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
