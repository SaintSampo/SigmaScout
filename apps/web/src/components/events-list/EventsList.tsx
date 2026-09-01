import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { districtDisplayName } from "@/lib/districtNames";
import { SkeletonRows } from "@/components/Skeletons";
import { EmptyState, ErrorState } from "@/components/StateViews";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_EVENT_TAB } from "@/lib/searchParams";
import { composeEventLocation } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
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
 *
 * 07-15-PLAN.md Task 2: the event-name cell is now a router `Link` to
 * `/event/{eventKey}` — the navigation that makes the whole of Phase 7
 * reachable from the deployed site. Only the name cell links (PD-06);
 * every other cell stays inert, matching `teams-table/columns.tsx`'s own
 * cell-level-link precedent rather than a whole-row anchor.
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

export interface EventsListProps {
  status: "pending" | "error" | "success";
  events: readonly EventRow[];
  year: number;
  /** Threaded from the route rather than read a second time via a cross-route search hook (06-05's stated preference) — carried on the row link's `search` so the destination lands with the reader's current algorithm. */
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

function EventRowView({ event, year, algorithm }: { event: EventRow; year: number; algorithm: PublishedAlgorithmId }) {
  const location = composeEventLocation(event.stateProv, event.country) ?? "—";
  return (
    <TableRow>
      <TableCell className="max-w-[16rem] p-0">
        {/*
          07-15-PLAN.md Task 2, PD-06: only the name cell links — the header
          row already carries per-cell sort buttons a row-level anchor would
          swallow, and one linked cell keeps the row's other text selectable.
          `tab` comes from the imported `DEFAULT_EVENT_TAB` constant, never a
          hardcoded id, so 07-18's one-constant flip moves this entry point
          with no edit here.
        */}
        <Link
          to="/event/$eventKey"
          params={{ eventKey: event.eventKey }}
          search={{ year, algorithm, tab: DEFAULT_EVENT_TAB }}
          title={event.name}
          className="block max-w-[16rem] truncate p-2"
        >
          {event.name}
        </Link>
      </TableCell>
      {/* ui-polish Q1 chips (2026-08-31) + week semantics fix (2026-09-01):
          TBA publishes week 0-INDEXED (Cabarrus carries week 0 and is Week 1
          on the ground), so display is always week + 1. A null week is NOT
          always offseason: Championship divisions/Einstein (eventType 3/4)
          carry week null with isOffseason false — labeling them Offseason
          was the bug this branch fixes. */}
      <TableCell className="numeric-cell">
        {event.isOffseason ? (
          <Badge variant="secondary">Offseason</Badge>
        ) : event.eventType === 3 || event.eventType === 4 ? (
          <Badge variant="secondary">Champs</Badge>
        ) : event.week === null ? (
          <span>{"—"}</span>
        ) : (
          <Badge variant="secondary">{`Wk ${event.week + 1}`}</Badge>
        )}
      </TableCell>
      <TableCell>{event.startDate}</TableCell>
      <TableCell className="max-w-[10rem] truncate" title={location}>
        {location}
      </TableCell>
      <TableCell className="max-w-[8rem] truncate" title={cellText(event.districtKey)}>
        {event.districtKey === null ? cellText(event.districtKey) : <Badge variant="secondary">{districtDisplayName(event.districtKey)}</Badge>}
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
          <EventRowView key={event.eventKey} event={event} year={year} algorithm={algorithm} />
        ))}
      </TableBody>
    </Table>
  );
}
