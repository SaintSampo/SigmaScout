/**
 * THROWAWAY — 05-04-PLAN.md Task 1 (D-04's touch-scroll proof). Deleted by
 * plan 05-08 once the proof it exists to produce has been recorded. This
 * component renders no real data and reads no artifact; it fabricates rows
 * locally so the touch spec (`e2e/touch-scroll.spec.ts`) has a stable
 * fixture that never depends on network state.
 *
 * Composition, verbatim from 05-RESEARCH.md "Pattern 2": exactly ONE native
 * scrolling DOM element, which is also the row virtualizer's scroll element.
 * Pinned leading columns (rank, team #, nickname) render `position: sticky`
 * at their computed left offset with an opaque background — never a second
 * scrolling region. If this file ever seems to want a nested horizontally
 * scrolling `<div>`, that is the D-04 failure shape; stop and record it
 * rather than add one.
 *
 * API note (Rule 1 fix — a real blocking bug, not a style choice): the
 * installed `@tanstack/react-table@9.1.2` is a genuine v9, not the v8 API
 * 05-RESEARCH.md's illustrative Pattern 2 snippet was written against.
 * `useReactTable`/`getCoreRowModel` do not exist in this version; sizing
 * (`size`/`getSize`/`getStart`) and pinning (`'start'`/`'end'`, not
 * `'left'`/`'right'`) are each separate registered features. This file
 * follows the real v9 surface, cross-checked against the package's own
 * bundled `skills/getting-started` and `skills/with-tanstack-virtual` docs
 * (`node_modules/@tanstack/react-table/skills/`) and `dist/*.d.ts`.
 */
import { useRef } from "react";
import { columnPinningFeature, columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

interface SpikeRow {
  rank: number;
  teamNumber: number;
  nickname: string;
  autoTower: number;
  endGameTower: number;
  hubAuto: number;
  hubTransition: number;
  hubShift1: number;
  hubShift2: number;
  hubShift3: number;
  hubShift4: number;
  total: number;
}

const ROW_COUNT = 50;
const ROW_HEIGHT = 40;
const VIRTUAL_OVERSCAN = 5;
const CONTAINER_HEIGHT = 400;

const PINNED_COLUMN_IDS = ["rank", "teamNumber", "nickname"];

/** Deterministic fabricated value in a plausible 0-40 point range — no Math.random(), so a failing run is reproducible. */
function fabricatedValue(seed: number): number {
  return Math.round(((Math.sin(seed) + 1) / 2) * 4000) / 100;
}

function fabricateRows(): SpikeRow[] {
  return Array.from({ length: ROW_COUNT }, (_, i) => {
    const teamNumber = 1000 + i * 7;
    return {
      rank: i + 1,
      teamNumber,
      nickname: `Fabricated Team ${teamNumber}`,
      autoTower: fabricatedValue(i * 1.1),
      endGameTower: fabricatedValue(i * 1.2 + 1),
      hubAuto: fabricatedValue(i * 1.3 + 2),
      hubTransition: fabricatedValue(i * 1.4 + 3),
      hubShift1: fabricatedValue(i * 1.5 + 4),
      hubShift2: fabricatedValue(i * 1.6 + 5),
      hubShift3: fabricatedValue(i * 1.7 + 6),
      hubShift4: fabricatedValue(i * 1.8 + 7),
      total: fabricatedValue(i * 1.9 + 8),
    };
  });
}

const FABRICATED_ROWS = fabricateRows();

const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, SpikeRow>();

function metricColumn(id: keyof SpikeRow, header: string, size: number) {
  return columnHelper.accessor(id, {
    header,
    size,
    cell: (info) => (info.getValue() as number).toFixed(2),
  });
}

const COLUMNS = columnHelper.columns([
  columnHelper.accessor("rank", { header: "Rank", size: 56 }),
  columnHelper.accessor("teamNumber", { header: "Team #", size: 88 }),
  columnHelper.accessor("nickname", { header: "Nickname", size: 180 }),
  metricColumn("autoTower", "Auto Tower", 120),
  metricColumn("endGameTower", "Endgame Tower", 130),
  metricColumn("hubAuto", "Hub Auto", 110),
  metricColumn("hubTransition", "Hub Transition", 130),
  metricColumn("hubShift1", "Hub Shift 1", 120),
  metricColumn("hubShift2", "Hub Shift 2", 120),
  metricColumn("hubShift3", "Hub Shift 3", 120),
  metricColumn("hubShift4", "Hub Shift 4", 120),
  metricColumn("total", "Total", 110),
]);

export function TableSpike() {
  const parentRef = useRef<HTMLDivElement>(null);

  const table = useTable({
    features,
    columns: COLUMNS,
    data: FABRICATED_ROWS,
    initialState: { columnPinning: { start: PINNED_COLUMN_IDS, end: [] } },
  });

  const tableRows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      data-testid="spike-scroll-container"
      style={{ overflow: "auto", height: CONTAINER_HEIGHT, width: "100%", position: "relative" }}
    >
      <table style={{ width: table.getTotalSize(), borderCollapse: "separate", borderSpacing: 0 }}>
        <thead data-testid="spike-header" style={{ position: "sticky", top: 0, zIndex: 3 }}>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const pinned = header.column.getIsPinned();
                return (
                  <th
                    key={header.id}
                    data-testid={`spike-header-cell-${header.column.id}`}
                    data-pinned={pinned ? "true" : "false"}
                    className="truncate px-[var(--spacing-sm)] py-[var(--spacing-sm)] text-left text-[12px] font-semibold"
                    style={{
                      width: header.getSize(),
                      position: pinned ? "sticky" : undefined,
                      left: pinned ? header.getStart("start") : undefined,
                      zIndex: pinned ? 4 : 3,
                      background: "var(--color-bg-surface)",
                    }}
                  >
                    <table.FlexRender header={header} />
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {virtualRows.map((virtualRow) => {
            const row = tableRows[virtualRow.index];
            if (!row) return null;
            return (
              <tr
                key={row.id}
                data-testid="spike-row"
                data-row-index={virtualRow.index}
                data-team-number={row.original.teamNumber}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.getAllCells().map((cell) => {
                  const pinned = cell.column.getIsPinned();
                  return (
                    <td
                      key={cell.id}
                      data-testid={`spike-cell-${cell.column.id}`}
                      data-pinned={pinned ? "true" : "false"}
                      className="truncate px-[var(--spacing-sm)] py-[var(--spacing-xs)] text-[14px]"
                      style={{
                        width: cell.column.getSize(),
                        position: pinned ? "sticky" : undefined,
                        left: pinned ? cell.column.getStart("start") : undefined,
                        zIndex: pinned ? 1 : undefined,
                        background: "var(--color-bg-page)",
                      }}
                    >
                      <table.FlexRender cell={cell} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
