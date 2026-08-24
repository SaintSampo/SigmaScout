import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SkeletonRows } from "@/components/Skeletons";
import { EmptyState, ErrorState } from "@/components/StateViews";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EventRow, EventSortDirection, EventSortKey } from "./filterModel";

/**
 * The events list with its loading, empty, error and partial-row states
 * (05-07-PLAN.md Task 2). A season's events are in the low hundreds — no
 * virtualization here, unlike the Teams table (05-UI-SPEC.md "Events list"
 * populated row).
 *
 * `events` arrives already filtered and sorted by the caller (`events.tsx`,
 * Task 3) — this component renders that array plainly and reports header
 * clicks back up via `onSortChange` rather than owning any sort/filter
 * state of its own, since sort lives in the URL (D-14).
 */

const SKELETON_ROWS = 8;

interface ColumnDef {
  key: EventSortKey | null;
  label: string;
  numeric?: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Event" },
  { key: "week", label: "Week", numeric: true },
  { key: "startDate", label: "Date" },
  { key: null, label: "Location" },
  { key: null, label: "District" },
  { key: "teamCount", label: "Teams", numeric: true },
  { key: "matchCount", label: "Matches", numeric: true },
];

/** `null` renders as an em-dash — never a blank cell, never the literal text of a null value. */
function cellText(value: string | null): string {
  return value === null ? "—" : value;
}

function locationText(event: EventRow): string {
  if (event.stateProv === null && event.country === null) return "—";
  if (event.stateProv === null) return event.country as string;
  if (event.country === null) return event.stateProv;
  return `${event.stateProv}, ${event.country}`;
}

export interface EventsListProps {
  status: "pending" | "error" | "success";
  events: readonly EventRow[];
  year: number;
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
      <TableRow>
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
            <TableHead key={column.label} aria-sort={ariaSort} className={column.numeric ? "numeric-cell text-role-label" : "text-role-label"}>
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

function EventRowView({ event }: { event: EventRow }) {
  return (
    <TableRow>
      <TableCell className="max-w-[16rem] truncate" title={event.name}>
        {event.name}
      </TableCell>
      <TableCell className="numeric-cell">{event.week === null ? <Badge variant="secondary">Offseason</Badge> : event.week}</TableCell>
      <TableCell>{event.startDate}</TableCell>
      <TableCell className="max-w-[10rem] truncate" title={locationText(event)}>
        {locationText(event)}
      </TableCell>
      <TableCell className="max-w-[8rem] truncate" title={cellText(event.districtKey)}>
        {cellText(event.districtKey)}
      </TableCell>
      <TableCell className="numeric-cell">{event.teamCount}</TableCell>
      <TableCell className="numeric-cell">{`${event.playedMatchCount}/${event.matchCount}`}</TableCell>
    </TableRow>
  );
}

export function EventsList({ status, events, year, hasActiveFilter, onClearFilters, onRetry, sortKey, sortDir, onSortChange }: EventsListProps) {
  if (status === "error") {
    return (
      <div className="w-full">
        <ErrorState resource="events" year={year} onRetry={onRetry} />
      </div>
    );
  }

  if (status === "pending") {
    return (
      <Table>
        <ColumnHeaderRow sortKey={sortKey} sortDir={sortDir} onSortChange={onSortChange} />
        <TableBody>
          <SkeletonRows rows={SKELETON_ROWS} columns={COLUMNS.length} />
        </TableBody>
      </Table>
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
    <Table>
      <ColumnHeaderRow sortKey={sortKey} sortDir={sortDir} onSortChange={onSortChange} />
      <TableBody>
        {events.map((event) => (
          <EventRowView key={event.eventKey} event={event} />
        ))}
      </TableBody>
    </Table>
  );
}
