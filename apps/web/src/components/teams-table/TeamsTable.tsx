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
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SkeletonRows } from "@/components/Skeletons";
import { EmptyState, ErrorState } from "@/components/StateViews";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile, useIsF3MetricFirstWidth } from "@/lib/breakpoints";
import { buildColumns, features, MOBILE_PINNED_COLUMN_IDS, PINNED_COLUMN_IDS, sortableColumnIds, type TeamsTableView } from "./columns";
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
  /** Grouped (Auto/Teleop/Endgame/Total, the default) vs full components — decision T1's URL-backed toggle; the route owns the state. */
  view: TeamsTableView;
  sortKey: string;
  sortDirection: SortDirection;
  onSortChange: (columnId: string) => void;
  onRetry: () => void;
}

function cellClassName(columnId: string): string {
  return columnId === "nickname" ? "truncate text-role-body" : "numeric-cell text-role-body";
}

export function TeamsTable({ status, rows, algorithmId, season, view, sortKey, sortDirection, onSortChange, onRetry }: TeamsTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // 07-UAT.md G-2: below `MOBILE_BREAKPOINT_PX`, nickname unpins and
  // rank/teamNumber tighten (`buildColumns`'s own `isNarrow` doc comment).
  // Reuses the SAME sitewide breakpoint hook `Ribbon.tsx`/`SearchBox.tsx`
  // already switch their own compact treatment on, rather than a new
  // ResizeObserver-based mechanism — one definition of "mobile" for the
  // whole page, so this table's compact pinning and the ribbon's compact
  // layout always agree on which viewports are narrow. `useIsMobile`
  // subscribes to `matchMedia`'s `change` event, so a resize or device
  // rotation re-evaluates it live, not just on first mount.
  const isNarrow = useIsMobile();
  const isF3Width = useIsF3MetricFirstWidth();

  const metricFirst = isNarrow && isF3Width;
  const columns = useMemo(() => buildColumns(algorithmId, season, isNarrow, metricFirst, view), [algorithmId, season, isNarrow, metricFirst, view]);
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

  // Fill the viewport below wherever the table actually starts. Recomputed on
  // resize and orientation change; falls back to a sane min so the table is
  // never collapsed to nothing while measuring.
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
  }, []);

  const isLoading = status === "loading";
  const virtualItems = isLoading ? [] : rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      data-testid="teams-table-scroll"
      // `.data-card` (2026-09-01 redesign): the white card the table sits in.
      // Its `overflow: hidden` is overridden by this element's own inline
      // `overflow: auto` — inline always wins — so the scroll behavior is
      // untouched; the card contributes border, radius and shadow only.
      className="data-card"
      style={{ overflow: "auto", height: scrollHeight, width: "100%", position: "relative" }}
    >
      <table
        style={{
          // 07-UAT.md G-1: `table-layout: fixed` makes every column's
          // ACTUAL rendered width equal its DECLARED `size` — with `auto`
          // (the prior default), the browser treated `width` as a hint and
          // resized columns to content instead, desyncing every pinned
          // column's sticky `left` (`getStart("start")`, derived from
          // DECLARED sizes) from where its neighbour actually rendered.
          // This table's own virtualizer-driven `position: absolute` rows
          // partly masked the bug in the HEADER row (only the header
          // participates in `auto`'s column-width algorithm once body rows
          // are taken out of normal flow) but not in the BODY rows
          // themselves, where the desync was real and measured — see
          // `07-UAT.md` G-1's own table for the live numbers.
          tableLayout: "fixed",
          width: "100%",
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

                return (
                  <TableHead
                    key={header.id}
                    data-testid={`teams-header-${header.column.id}`}
                    data-pinned={pinned ? "true" : "false"}
                    aria-sort={ariaSort}
                    className="text-role-label truncate"
                    style={{
                      // `minWidth`/`maxWidth` paired with `width`: see the
                      // body `TableCell`'s identical style-object comment
                      // below for why (the header row itself never needed
                      // this — it stays in normal table flow — but carries
                      // the same pair for defense in depth).
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
              {/*
                Trailing filler so the table can stretch to the full page width
                without the browser redistributing slack across the real columns.
                That distinction matters: pinned offsets come from
                `header.getStart("start")`, which is derived from column sizes,
                so widening a pinned column would silently desync the sticky
                `left` values from the cells they pin. Absorbing the slack in a
                sizeless trailing cell leaves every real column at exactly
                `getSize()`. Hidden from assistive tech — it carries no data.
              */}
              <TableHead aria-hidden="true" style={{ padding: 0, background: "var(--color-bg-surface)" }} />
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
                          // 07-UAT.md G-1, measured finding beyond the plain
                          // `table-layout: fixed` fix: a `<tr>` with
                          // `position: absolute` (this table's own row
                          // virtualizer) is blockified by the CSS Display
                          // spec's "absolutely positioned boxes are
                          // blockified" rule, which disconnects its `<td>`s
                          // from the real table's column grid — each
                          // virtualized row's cells get rebuilt into their
                          // own anonymous one-row table, where `auto` sizing
                          // and content-driven growth apply regardless of
                          // `tableLayout: "fixed"` on the table element
                          // above (verified live: `width` alone left a real
                          // ~31px sticky gap even after that fix). Pairing
                          // `width` with an EQUAL `minWidth`/`maxWidth`
                          // forces an exact box size that a table-cell must
                          // honor even inside that anonymous auto-layout
                          // table — re-measured at 0px gap. `HEADER` cells
                          // never needed this (they stay in normal table
                          // flow, so `tableLayout: "fixed"` alone already
                          // sizes them correctly) but carry the same pair
                          // for defense in depth against the same class of
                          // future regression.
                          width: cell.column.getSize(),
                          minWidth: cell.column.getSize(),
                          maxWidth: cell.column.getSize(),
                          position: pinned ? "sticky" : undefined,
                          left: pinned ? cell.column.getStart("start") : undefined,
                          zIndex: pinned ? 1 : undefined,
                          // Surface, not page (2026-09-01 redesign): rows now
                          // sit on a white card, so the opaque pinned-cell
                          // backing must match the card, not the slate page.
                          background: pinned ? "var(--color-bg-surface)" : undefined,
                        }}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    );
                  })}
                  {/* Matches the header's trailing filler — see the note there. */}
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
