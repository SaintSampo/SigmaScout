/**
 * The single-scroll-container virtualized, pinned Teams table: TanStack
 * Table's column pinning composed with TanStack Virtual's row virtualizer
 * over exactly ONE native scrolling element, which is also the virtualizer's
 * scroll element. A second scrolling region anywhere in this file breaks
 * that composition — do not introduce one (see `apps/web/e2e/touch-scroll.spec.ts`).
 *
 * This component is CONTROLLED for sort: it renders rows in whatever order
 * the caller passes (`routes/teams.tsx` resolves the sort key and calls
 * `sortTeamRows` before handing rows here) and only reports which column
 * header was clicked via `onSortChange` — it never reorders rows itself.
 * That keeps the URL as the single source of truth for sort state, rather
 * than a second, driftable copy living in table state.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SkeletonRows } from "@/components/Skeletons";
import { EmptyState, ErrorState } from "@/components/StateViews";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile, useIsF3MetricFirstWidth } from "@/lib/breakpoints";
import { buildColumns, features, MOBILE_PINNED_COLUMN_IDS, PINNED_COLUMN_IDS, rankColumnAccessibleLabel, sortableColumnIds, type TeamsTableView } from "./columns";
import type { SortDirection, TeamRow } from "./rowModel";

const ROW_HEIGHT_PX = 44;
const VIRTUAL_OVERSCAN = 8;
const SKELETON_ROW_COUNT = 12;
/**
 * The scroll viewport fills everything below the table's own top edge rather
 * than a fixed fraction of the viewport (was `min(70vh, 720px)`, which left
 * dead space under the table on any tall screen — raised at plan 05-08's
 * real-device sign-off). Measured at runtime because the space above the
 * table is not a constant: the ribbon wraps to two rows on a phone, and the
 * page heading and filter row differ per route. `100dvh` (not `vh`) so a
 * mobile browser's collapsing URL bar does not leave a gap.
 */
const SCROLL_VIEWPORT_BOTTOM_GAP_PX = 24;
const SCROLL_CONTAINER_MIN_HEIGHT_PX = 320;

export type TeamsTableStatus = "loading" | "empty" | "error" | "success";

export interface TeamsTableProps {
  status: TeamsTableStatus;
  rows: readonly TeamRow[];
  algorithmId: string;
  season: number;
  /** Grouped (Auto/Teleop/Endgame/Total, the default) vs full components — a URL-backed toggle; the route owns the state. */
  view: TeamsTableView;
  sortKey: string;
  sortDirection: SortDirection;
  onSortChange: (columnId: string) => void;
  onRetry: () => void;
  /**
   * Whether a Country/State/District filter is currently active. Branches
   * the empty state (below) between the year-gap copy and a filtered-to-zero
   * copy that names the filters as the cause and offers a Clear-filters
   * action, mirroring `EventsList.tsx`'s own empty branch — otherwise a
   * filter's zero-result state wrongly tells the reader to check a
   * different year.
   */
  hasActiveFilter?: boolean;
  onClearFilters?: () => void;
}

function cellClassName(columnId: string): string {
  return columnId === "nickname" ? "truncate text-role-body" : "numeric-cell text-role-body";
}

export function TeamsTable({ status, rows, algorithmId, season, view, sortKey, sortDirection, onSortChange, onRetry, hasActiveFilter, onClearFilters }: TeamsTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Below `MOBILE_BREAKPOINT_PX`, nickname unpins and rank/teamNumber
  // tighten (`buildColumns`'s own `isNarrow` doc comment). Reuses the SAME
  // sitewide breakpoint hook `Ribbon.tsx`/`SearchBox.tsx` use, so this
  // table's compact pinning always agrees with the ribbon's compact layout
  // on which viewports are narrow. `useIsMobile` subscribes to
  // `matchMedia`'s `change` event, so it re-evaluates live on resize/rotate.
  const isNarrow = useIsMobile();
  const isF3Width = useIsF3MetricFirstWidth();

  const metricFirst = isNarrow && isF3Width;
  const columns = useMemo(
    () => buildColumns(algorithmId, season, isNarrow, metricFirst, view),
    [algorithmId, season, isNarrow, metricFirst, view],
  );
  const sortableIds = useMemo(() => new Set(sortableColumnIds(algorithmId, season, view)), [algorithmId, season, view]);
  const columnPinning = useMemo(
    () => ({ start: isNarrow ? [...MOBILE_PINNED_COLUMN_IDS] : [...PINNED_COLUMN_IDS], end: [] }),
    [isNarrow],
  );

  const table = useTable({
    features,
    columns,
    data: rows as TeamRow[],
    state: { columnPinning },
  });

  const tableRows = table.getRowModel().rows;

  // The hook must run unconditionally (React's rules of hooks) even during
  // loading/empty/error early returns below; the virtual item LIST is simply
  // unused on those branches.
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: VIRTUAL_OVERSCAN,
    // Without this, the virtualizer's `scrollRect` starts at the library's
    // own `{ width: 0, height: 0 }` default until the first ResizeObserver
    // callback fires — a real first-paint flash of zero rows on every load
    // (jsdom's stubbed ResizeObserver never calls back at all).
    initialRect: { width: 960, height: 640 },
  });

  // Fill the viewport below wherever the table actually starts. Recomputed on
  // resize and orientation change; falls back to a sane min so the table is
  // never collapsed to nothing while measuring.
  //
  // MUST stay ABOVE the empty/error early returns below: an empty or error
  // render must call the same number of hooks as a table render, or React
  // throws error #310 when a state change crosses between them.
  //
  // Keyed on `status` rather than `[]` because it also runs on renders where
  // `parentRef` is unattached and `measure()` bails; re-running on status
  // change is what makes it measure for real once the scroll container
  // actually exists.
  const [scrollHeight, setScrollHeight] = useState<number>(SCROLL_CONTAINER_MIN_HEIGHT_PX);
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = parentRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const available = window.innerHeight - top - SCROLL_VIEWPORT_BOTTOM_GAP_PX;
      setScrollHeight(Math.max(SCROLL_CONTAINER_MIN_HEIGHT_PX, Math.floor(available)));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [status]);

  // An empty or error state renders OUTSIDE the horizontally scrolling table
  // region entirely, so it is fully visible at phone width without a
  // sideways scroll — never nested inside the virtualized container below.
  if (status === "empty") {
    if (hasActiveFilter) {
      return (
        <EmptyState heading="No teams match your filters" body="Try removing a filter, or check a different year." onClearFilters={onClearFilters} />
      );
    }
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
      // `.data-card` is the white card the table sits in. Its
      // `overflow: hidden` is overridden by this element's own inline
      // `overflow: auto` — inline always wins — so the card contributes
      // border, radius and shadow only, and scroll behavior is untouched.
      className="data-card"
      // `fit-content` capped at 100%: the card hugs the table's declared
      // total width instead of stretching across an ultrawide viewport; when
      // the declared total exceeds the viewport, fit-content resolves to the
      // available width and the inner overflow scrolls as before.
      style={{ overflow: "auto", height: scrollHeight, width: "fit-content", maxWidth: "100%", position: "relative" }}
    >
      <table
        style={{
          // `table-layout: fixed` makes every column's ACTUAL rendered width
          // equal its DECLARED `size`. Under `auto`, the browser resizes
          // columns to content instead, desyncing each pinned column's
          // sticky `left` (derived from DECLARED sizes) from where its
          // neighbour actually rendered — most visible in the virtualized
          // BODY rows, which sit outside normal table flow.
          tableLayout: "fixed",
          // `max-content`, not `100%`: at `100%` the table always fills its
          // container, which stretches a mostly-empty card on a wide
          // viewport. `max-content` under `table-layout: fixed` resolves to
          // exactly the sum of the declared column sizes, so the table can
          // never stretch and pinned columns' sticky `left` offsets stay in
          // sync with those same declared sizes by construction.
          width: "max-content",
          minWidth: table.getTotalSize(),
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <TableHeader style={{ position: "sticky", top: 0, zIndex: 3 }}>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const pinned = header.column.getIsPinned();
                const isSortable = sortableIds.has(header.column.id);
                const isActive = isSortable && header.column.id === sortKey;
                const ariaSort = !isSortable ? undefined : isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none";
                // Below the breakpoint the rank header's VISIBLE text is the
                // bare "Rank" (`columns.tsx`'s own `isNarrow` branch), so
                // which algorithm's rank it is still has to reach assistive
                // tech and hover via `aria-label`/`title` on the `<th>`
                // itself — a bare `<span>`'s `role="generic"` drops
                // `aria-label` outright, and the `<th>` is not wrapped in a
                // button since `rank` is never sortable. Wide mode needs
                // neither: the visible text already IS the full accessible name.
                const rankAccessibleName = isNarrow && header.column.id === "rank" ? rankColumnAccessibleLabel(algorithmId) : undefined;

                return (
                  <TableHead
                    key={header.id}
                    data-testid={`teams-header-${header.column.id}`}
                    data-pinned={pinned ? "true" : "false"}
                    aria-sort={ariaSort}
                    aria-label={rankAccessibleName}
                    title={rankAccessibleName}
                    className="text-role-label truncate"
                    style={{
                      // `minWidth`/`maxWidth` paired with `width`: see the
                      // body `TableCell`'s identical style-object comment
                      // below. The header row itself stays in normal table
                      // flow and doesn't need this, but carries the same
                      // pair for defense in depth.
                      width: header.getSize(),
                      minWidth: header.getSize(),
                      maxWidth: header.getSize(),
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
                          // A `<tr>` with `position: absolute` (this table's
                          // row virtualizer) is blockified by the CSS
                          // Display spec, which disconnects its `<td>`s from
                          // the real table's column grid: each virtualized
                          // row's cells get rebuilt into their own anonymous
                          // one-row table, where `auto` sizing applies
                          // regardless of `tableLayout: "fixed"` above.
                          // Pairing `width` with an EQUAL `minWidth`/
                          // `maxWidth` forces an exact box size that
                          // survives that anonymous auto-layout table.
                          // HEADER cells stay in normal table flow and don't
                          // need this, but carry the same pair for defense
                          // in depth.
                          width: cell.column.getSize(),
                          minWidth: cell.column.getSize(),
                          maxWidth: cell.column.getSize(),
                          position: pinned ? "sticky" : undefined,
                          left: pinned ? cell.column.getStart("start") : undefined,
                          zIndex: pinned ? 1 : undefined,
                          // Rows sit on a white card, so the opaque
                          // pinned-cell backing must match the card, not the
                          // slate page.
                          background: pinned ? "var(--color-bg-surface)" : undefined,
                        }}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    );
                  })}
                  <TableCell aria-hidden="true" style={{ padding: 0 }} />
                </TableRow>
              );
            })
          )}
        </TableBody>
      </table>
    </div>
  );
}
