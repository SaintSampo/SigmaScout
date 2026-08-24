/**
 * The single-scroll-container virtualized, pinned Teams table (Task 2,
 * 05-06-PLAN.md), built on the composition plan 05-04's throwaway touch spike
 * proved under real touch input before it was removed (05-08-PLAN.md Task 3;
 * see `apps/web/e2e/touch-scroll.spec.ts`, retargeted at this real table):
 * TanStack Table's column pinning composed with TanStack Virtual's row
 * virtualizer over exactly ONE native scrolling element, which is also the
 * virtualizer's scroll element. A second scrolling region anywhere in this
 * file is the D-04 failure shape — do not introduce one.
 *
 * This component is CONTROLLED for sort: it renders rows in whatever order
 * the caller passes (`routes/teams.tsx`, Task 3, resolves the sort key and
 * calls `sortTeamRows` before handing rows here) and only reports which
 * column header was clicked via `onSortChange` — it never reorders rows
 * itself. That keeps the URL (D-14) as the single source of truth for sort
 * state, rather than a second, driftable copy living in table state.
 */
import { useMemo, useRef } from "react";
import { useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SkeletonRows } from "@/components/Skeletons";
import { EmptyState, ErrorState } from "@/components/StateViews";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildColumns, features, PINNED_COLUMN_IDS, sortableColumnIds } from "./columns";
import type { SortDirection, TeamRow } from "./rowModel";

const ROW_HEIGHT_PX = 44;
const VIRTUAL_OVERSCAN = 8;
const SKELETON_ROW_COUNT = 12;
const SCROLL_CONTAINER_HEIGHT = "min(70vh, 720px)";

export type TeamsTableStatus = "loading" | "empty" | "error" | "success";

export interface TeamsTableProps {
  status: TeamsTableStatus;
  rows: readonly TeamRow[];
  algorithmId: string;
  season: number;
  sortKey: string;
  sortDirection: SortDirection;
  onSortChange: (columnId: string) => void;
  onRetry: () => void;
}

function cellClassName(columnId: string): string {
  return columnId === "nickname" ? "truncate text-role-body" : "numeric-cell text-role-body";
}

export function TeamsTable({ status, rows, algorithmId, season, sortKey, sortDirection, onSortChange, onRetry }: TeamsTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => buildColumns(algorithmId, season), [algorithmId, season]);
  const sortableIds = useMemo(() => new Set(sortableColumnIds(algorithmId, season)), [algorithmId, season]);

  const table = useTable({
    features,
    columns,
    data: rows as TeamRow[],
    initialState: { columnPinning: { start: [...PINNED_COLUMN_IDS], end: [] } },
  });

  const tableRows = table.getRowModel().rows;

  // Real virtualization even during loading/empty/error early returns below
  // — the hook must run unconditionally (React's rules of hooks), the
  // virtual item LIST is simply unused on those branches.
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: VIRTUAL_OVERSCAN,
    // Without this, the virtualizer's `scrollRect` starts at the library's
    // own `{ width: 0, height: 0 }` default until the first ResizeObserver
    // callback fires — a real first-paint flash of zero rows on every load,
    // not just a jsdom-under-test artifact (jsdom's stubbed ResizeObserver
    // never calls back at all, per apps/web/src/test/setup.ts).
    initialRect: { width: 960, height: 640 },
  });

  // NAV-04 empty edge: an empty or error state renders OUTSIDE the
  // horizontally scrolling table region entirely, so it is fully visible at
  // phone width without a sideways scroll — never nested inside the
  // virtualized container below.
  if (status === "empty") {
    return <EmptyState heading={`No teams for ${season}`} body={`No teams found for ${season}. Check a different year.`} />;
  }

  if (status === "error") {
    return <ErrorState resource="teams" year={season} onRetry={onRetry} />;
  }

  const isLoading = status === "loading";
  const virtualItems = isLoading ? [] : rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      data-testid="teams-table-scroll"
      style={{ overflow: "auto", height: SCROLL_CONTAINER_HEIGHT, width: "100%", position: "relative" }}
    >
      <table style={{ width: table.getTotalSize(), borderCollapse: "separate", borderSpacing: 0 }}>
        <TableHeader style={{ position: "sticky", top: 0, zIndex: 3 }}>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const pinned = header.column.getIsPinned();
                const isSortable = sortableIds.has(header.column.id);
                const isActive = isSortable && header.column.id === sortKey;
                const ariaSort = !isSortable ? undefined : isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

                return (
                  <TableHead
                    key={header.id}
                    data-testid={`teams-header-${header.column.id}`}
                    data-pinned={pinned ? "true" : "false"}
                    aria-sort={ariaSort}
                    className="text-role-label truncate"
                    style={{
                      width: header.getSize(),
                      position: pinned ? "sticky" : undefined,
                      left: pinned ? header.getStart("start") : undefined,
                      zIndex: pinned ? 4 : 3,
                      background: "var(--color-bg-surface)",
                    }}
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        className="tap-target inline-flex items-center gap-[var(--spacing-xs)]"
                        onClick={() => onSortChange(header.column.id)}
                      >
                        <table.FlexRender header={header} />
                        {isActive && (
                          <span aria-hidden="true" className="text-[var(--color-accent)]">
                            {sortDirection === "asc" ? "▲" : "▼"}
                          </span>
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody style={{ height: isLoading ? undefined : rowVirtualizer.getTotalSize(), position: "relative" }}>
          {isLoading ? (
            <SkeletonRows rows={SKELETON_ROW_COUNT} columns={columns.length} />
          ) : (
            virtualItems.map((virtualRow) => {
              const row = tableRows[virtualRow.index];
              if (!row) return null;
              return (
                <TableRow
                  key={row.id}
                  data-testid="teams-row"
                  data-team-number={row.original.teamNumber}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
                >
                  {row.getAllCells().map((cell) => {
                    const pinned = cell.column.getIsPinned();
                    return (
                      <TableCell
                        key={cell.id}
                        data-testid={`teams-cell-${cell.column.id}`}
                        data-pinned={pinned ? "true" : "false"}
                        className={cellClassName(cell.column.id)}
                        style={{
                          width: cell.column.getSize(),
                          position: pinned ? "sticky" : undefined,
                          left: pinned ? cell.column.getStart("start") : undefined,
                          zIndex: pinned ? 1 : undefined,
                          background: pinned ? "var(--color-bg-page)" : undefined,
                        }}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </table>
    </div>
  );
}
