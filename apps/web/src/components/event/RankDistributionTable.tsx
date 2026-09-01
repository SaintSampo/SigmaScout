/**
 * The rank-distribution table (08-14-PLAN.md Task 3, D-05/D-06/D-14, EVNT-07)
 * — the Simulation tab's central visualization. Four columns: Team #,
 * Nickname (both pinned, mirroring `BreakdownTab.tsx`'s two-column pinned
 * shape via `RANK_PINNED_COLUMN_IDS`), Median (a plain display integer) and
 * Distribution (the three-layer plot cell on a shared 1..N rank axis drawn
 * exactly once in the column header).
 *
 * Every position in this file comes from `simAxis.ts` (`x`, `histBarExtent`,
 * `rankBandExtent`, `medianTickLeft`, `rankAxisTicks`, `PLOT_W`,
 * `SIM_GEOMETRY`) or `rankRows.ts` (`histBarHeight`, `rankBandLabel`) — no
 * second, hand-tuned position is computed here. The row order this table
 * renders is whatever `buildRankDistributionRows` (Task 1) produced; this
 * component re-sorts nothing, computes no quantile and no median of its own.
 *
 * This file deliberately does NOT add a probability-of-finishing-top-8 or
 * alliance-captain column (D-06, dropped on the user's explicit instruction
 * — and the cutoff is not universally 8 anyway: 1,193 of 1,355 corpus events
 * run 8 alliances, 104 run 4 and 22 run 6, so such a column would have had
 * to derive its threshold per event). It renders no caption claiming the
 * ranking method replicates official tie-breaking, because only TBA's
 * position-0 sort order is ever ingested and no data-backed secondary sort
 * exists anywhere in this pipeline (D-14).
 */
import { columnPinningFeature, columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NICKNAME_COLUMN_WIDTH_NARROW_PX, TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX } from "@/components/teams-table/columns";
import { useIsMobile } from "@/lib/breakpoints";
import { PLOT_W, SIM_GEOMETRY, histBarExtent, medianTickLeft, rankAxisTicks, rankBandExtent, x } from "@/lib/simAxis";
import { histBarHeight, rankBandLabel, type RankDistributionRow } from "./rankRows.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

/** The Breakdown tab's own two-column pinned shape (`BreakdownTab.tsx`'s `BREAKDOWN_PINNED_COLUMN_IDS`) — this table has no rank column of its own to pin either. */
export const RANK_PINNED_COLUMN_IDS = ["teamNumber", "nickname"] as const;

/** The narrow-viewport pinned set, DERIVED from `RANK_PINNED_COLUMN_IDS` by a filter rather than restated — mirrors `BREAKDOWN_MOBILE_PINNED_COLUMN_IDS`'s own derivation. */
export const RANK_MOBILE_PINNED_COLUMN_IDS = RANK_PINNED_COLUMN_IDS.filter((id) => id !== "nickname");

/**
 * The exact four header labels, in order — shared by the header render so
 * the header list and the column count can never disagree, and the
 * structural gate that forbids a probability-of-top-8 or captain column
 * being added back without failing a test.
 */
export const RANK_TABLE_HEADERS = ["Team #", "Nickname", "Median", "Distribution"] as const;

/**
 * The shared 1..N rank axis, drawn EXACTLY ONCE inside the Distribution
 * column's own header cell — mirroring `EventMatchTable.tsx`'s
 * `EventAxisHeader` generalized from a score axis to a rank axis. A per-row
 * scale was rejected by the user on sight in sketch 005, and this axis is
 * deliberately NEVER clipped to the union of occupied ranks: every one of
 * the 1000 draws assigns every team to exactly one of the N ranks, so every
 * rank is occupied by somebody across the table, and clipping reclaims
 * exactly zero pixels (measured in sketch 005, independently confirmed by
 * the user seeing no difference). The visually-hidden "Distribution" span
 * keeps this cell's accessible name and `RANK_TABLE_HEADERS`'s own text in
 * agreement without competing with the axis for the reader's attention.
 */
function RankAxisHeader({ teamCount, plotW }: { teamCount: number; plotW: number }) {
  const ticks = rankAxisTicks(teamCount, plotW);
  return (
    <>
      <span className="sr-only">{RANK_TABLE_HEADERS[3]}</span>
      <div data-testid="rank-axis-ticks" className="relative" style={{ width: plotW }}>
        {ticks.map((tick) => (
          <span
            key={tick}
            data-testid="rank-axis-tick"
            className="numeric-cell text-role-label absolute -translate-x-1/2 text-[var(--color-text-muted)]"
            style={{ left: x(tick, teamCount, plotW) }}
          >
            {tick}
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * One row's plot cell: histogram bars, then the translucent 10th-90th band,
 * then the median tick — drawn in THAT DOM order so the tick is never
 * obscured. Bars are emitted only for ranks with a non-zero draw count (the
 * one real per-row node reduction available; `docs/ui/rank-distribution-mock.md`
 * reports the measured node count this produces at the largest sampled
 * roster). The band carries the `sim-band-overlay` class and NOTHING ELSE —
 * no inline opacity, no filter, no blend mode: that token already carries
 * its own 18% alpha, and applying `SIM_GEOMETRY.BAND_OPACITY` a second time
 * as a CSS opacity would render the band at roughly 3.2%, invisible — the
 * same zero-width-band defect arriving by a second route, which is exactly
 * why 08-04 couples the constant and the token by its own test. The band's
 * extents are already clamped inside `rankBandExtent` against real measured
 * overflows and are never re-clamped or adjusted here.
 */
function RankDistributionPlotCell({ row, teamCount, plotW }: { row: RankDistributionRow; teamCount: number; plotW: number }) {
  const bars = [];
  for (let rank = 1; rank <= teamCount; rank++) {
    const count = row.histogram[rank - 1] ?? 0;
    if (count <= 0) continue;
    const extent = histBarExtent(rank, teamCount, plotW);
    bars.push(
      <div
        key={rank}
        data-testid={`rank-hist-bar-${row.teamKey}-${rank}`}
        className="sim-hist-bar absolute bottom-0"
        style={{ left: extent.left, width: extent.width, height: histBarHeight(count, row.maxBinCount) }}
      />
    );
  }

  const band = rankBandExtent(row.p10, row.p90, teamCount, plotW);
  // The CONTINUOUS median, never the display integer — this is the render-layer
  // proof of 08-14 Decision 1's coupled-geometry rule (chart-craft.md).
  const tickLeft = medianTickLeft(row.medianRank, teamCount, plotW);

  return (
    <div className="flex flex-col gap-[var(--spacing-xs)]">
      <div data-testid={`rank-plot-${row.teamKey}`} className="relative" style={{ width: plotW, height: SIM_GEOMETRY.ROW_PLOT_H }}>
        {bars}
        <div
          data-testid={`rank-band-${row.teamKey}`}
          className="sim-band-overlay absolute top-0"
          style={{ left: band.left, width: band.width, height: SIM_GEOMETRY.ROW_PLOT_H }}
        />
        <div
          data-testid={`rank-tick-${row.teamKey}`}
          className="sim-median-tick absolute top-0"
          style={{ left: tickLeft, width: SIM_GEOMETRY.MEDIAN_TICK_W, height: SIM_GEOMETRY.ROW_PLOT_H }}
        />
      </div>
      {/*
        An explicit percentile range, one decimal place, joined by an en
        dash — NEVER a plus-or-minus quantity. Phase 7 D-01 reserves that
        glyph for exactly one standard deviation of full predictive
        variance at every aggregation level on this site; a rank spread is
        not that quantity, because rank is bounded, integer and skewed.
        `rankBandLabel` (rankRows.ts) is the one function that formats this
        string, and neither it nor this file ever types that glyph. The
        app's shared metric-value primitive is never imported here or
        anywhere else in this table — it prints that glyph by construction.
      */}
      <span data-testid={`rank-band-label-${row.teamKey}`} className="text-role-label text-[var(--color-text-muted)]">
        {rankBandLabel(row.p10, row.p90)}
      </span>
    </div>
  );
}

/**
 * Registered once, module-level, mirroring `InsightsTab.tsx`'s/`BreakdownTab.tsx`'s
 * own precedent: pinning offsets require `columnSizingFeature` registered
 * alongside `columnPinningFeature`, or `getStart`/`getSize` do not exist at
 * all. The column helper is typed against THIS module's own
 * `RankDistributionRow`, so it is declared locally rather than imported
 * across a module boundary.
 */
const features = tableFeatures({ columnPinningFeature, columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, RankDistributionRow>();

/**
 * The four columns, in `RANK_TABLE_HEADERS` order. `teamCount`, `season` and
 * `algorithmId` are closed over so the Distribution column's shared axis and
 * every row's team-page links share the same values the caller passed to the
 * table. `algorithmId` is typed as plain `string` here and cast to
 * `PublishedAlgorithmId` at the one call site that needs it — the same
 * loose-cast escape hatch `InsightsTab.tsx`/`BreakdownTab.tsx` already use
 * for a value the type system widened crossing a component-prop boundary
 * (it was already validated upstream through `RootSearchSchema.algorithm`,
 * T-05-02, before this table ever rendered).
 */
function buildRankTableColumns(teamCount: number, season: number, algorithmId: string, isNarrow: boolean, plotW: number) {
  const algorithm = algorithmId as PublishedAlgorithmId;
  return columnHelper.columns([
    columnHelper.accessor("teamNumber", {
      header: RANK_TABLE_HEADERS[0],
      // Same real-geometry derivation InsightsTab.tsx sizes its own
      // Team # column at (72/88 at the two breakpoints); the narrow width
      // is the shared exported constant, never a new literal.
      size: isNarrow ? TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX : 88,
      cell: (info) => (
        <Link to="/team/$teamNumber" params={{ teamNumber: String(info.getValue()) }} search={{ year: season, algorithm, tab: "overview" }}>
          {info.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("nickname", {
      header: RANK_TABLE_HEADERS[1],
      size: isNarrow ? NICKNAME_COLUMN_WIDTH_NARROW_PX : 220,
      cell: (info) => {
        const nickname = info.getValue();
        return (
          <Link
            to="/team/$teamNumber"
            params={{ teamNumber: String(info.row.original.teamNumber) }}
            search={{ year: season, algorithm, tab: "overview" }}
            title={nickname}
            // `truncate` on the ANCHOR, not the cell — the anchor is the box
            // that actually overflows (InsightsTab.tsx's own measured
            // correction, Phase 7's 390px finding).
            className="block max-w-full truncate"
          >
            {nickname ?? ""}
          </Link>
        );
      },
    }),
    columnHelper.accessor("medianDisplay", {
      header: RANK_TABLE_HEADERS[2],
      size: 84,
      // A plain numeric-cell integer — no tier box, no colour, no weight
      // change. This is the display rounding of the CONTINUOUS median the
      // tick draws (rankRows.ts's own medianDisplayRank), never a second
      // computation.
      cell: (info) => <span className="numeric-cell text-role-body">{info.getValue()}</span>,
    }),
    columnHelper.accessor((row) => row, {
      id: "distribution",
      header: () => <RankAxisHeader teamCount={teamCount} plotW={plotW} />,
      size: plotW,
      cell: (info) => <RankDistributionPlotCell row={info.getValue()} teamCount={teamCount} plotW={plotW} />,
    }),
  ]);
}

export interface RankDistributionTableProps {
  rows: readonly RankDistributionRow[];
  teamCount: number;
  season: number;
  algorithmId: string;
}

/**
 * The rank-distribution table. `tableLayout: "fixed"` (07-UAT.md G-1's own
 * measured reasoning, reproduced by `InsightsTab.tsx`): an `auto` layout
 * lets the browser resize columns past their declared `size`, desyncing
 * every pinned column's sticky `left` from where its neighbour actually
 * rendered. The table is sized to `max-content` (2026-09-01) so there is no
 * slack to redistribute and no trailing filler cell is needed.
 */
/**
 * The three non-plot columns' declared widths at a given breakpoint. Derived
 * from the SAME expressions `buildRankTableColumns` uses, so the leftover
 * width computed below can never disagree with what the columns actually
 * declare.
 */
function fixedColumnsWidth(isNarrow: boolean): number {
  const teamNumber = isNarrow ? TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX : 88;
  const nickname = isNarrow ? NICKNAME_COLUMN_WIDTH_NARROW_PX : 220;
  const median = 84;
  return teamNumber + nickname + median;
}

/** `TableCell`/`TableHead`'s own `p-2` — 8px each side, on all four columns. */
const CELL_PADDING_X_PX = 16;

export function RankDistributionTable({ rows, teamCount, season, algorithmId }: RankDistributionTableProps) {
  const isNarrow = useIsMobile();

  /*
   * 2026-09-01 (user: "the simulation table is not wide enough, it should be
   * symmetrically wide, aligned with the above text"): the plot stretches to
   * fill whatever width the card actually has, instead of every row being a
   * fixed 470px island inside a card that hugged it and left the rest of the
   * content column empty.
   *
   * Measured rather than assumed, using the same measure-with-a-sane-fallback
   * pattern `MetricHistoryChart.tsx` established for exactly this problem:
   * jsdom always measures 0, so tests and the first paint fall back to
   * `PLOT_W` and render the geometry this table shipped with. `PLOT_W` is also
   * the FLOOR — on a viewport too narrow to grant more, the plot keeps its
   * original width and the card scrolls horizontally exactly as before.
   */
  const containerRef = useRef<HTMLDivElement>(null);
  const [plotW, setPlotW] = useState<number>(PLOT_W);
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = containerRef.current;
      if (!el) return;
      const available = el.clientWidth - fixedColumnsWidth(isNarrow) - CELL_PADDING_X_PX * 4;
      setPlotW(Math.max(PLOT_W, Math.floor(available)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isNarrow]);
  const columns = useMemo(
    () => buildRankTableColumns(teamCount, season, algorithmId, isNarrow, plotW),
    [teamCount, season, algorithmId, isNarrow, plotW]
  );
  const columnPinning = useMemo(
    () => ({ start: isNarrow ? [...RANK_MOBILE_PINNED_COLUMN_IDS] : [...RANK_PINNED_COLUMN_IDS], end: [] }),
    [isNarrow]
  );

  const table = useTable({ features, columns, data: rows as RankDistributionRow[], state: { columnPinning } });

  return (
    // `max-h-[70vh]` + `overflow-y-auto` (2026-09-01 user request: a sticky
    // title row). This element was ALREADY a vertical scroll container —
    // `overflow-x: auto` forces `overflow-y`'s used value to `auto` per the
    // CSS Overflow spec, the same rule that bit the ribbon in G-12 — but with
    // an unbounded height it never actually scrolled, so a `position: sticky`
    // header inside it would have had nothing to stick against. Bounding the
    // height is what gives the sticky header a scrollport; one row per team
    // at ~70px means a 75-team division is over 5000px tall, so this table
    // genuinely wants its own scrollport rather than the page's.
    <div
      ref={containerRef}
      data-testid="rank-distribution-table-scroll"
      // Full width, not hug-the-content (2026-09-01): the card spans the same width
      // as the run summary and the picker above it, and the plot grows to
      // fill it, rather than the card shrinking to a fixed-width plot and
      // leaving the right half of the content column empty.
      className="data-card max-h-[70vh] w-full min-w-0 touch-pan-xy overflow-x-auto overflow-y-auto overscroll-contain"
    >
      <table
        style={{
          tableLayout: "fixed",
          // `max-content`, not `100%` (2026-09-01, user: "rank numbers should
          // continue right to the edge of the graph"). At `100%` the table
          // filled the card and the trailing filler cell (removed below) took
          // up the slack, leaving a wide dead strip to the right of the rank
          // axis. Sized to content, the axis now ends where the card ends.
          width: "max-content",
          minWidth: table.getTotalSize(),
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const pinned = header.column.getIsPinned();
                return (
                  <TableHead
                    key={header.id}
                    data-testid={`rank-header-${header.column.id}`}
                    data-pinned={pinned ? "true" : "false"}
                    className="text-role-label truncate"
                    style={{
                      width: header.getSize(),
                      // ALWAYS sticky now, in both axes: `top: 0` keeps the
                      // title row visible while the reader scrolls this
                      // table's own scrollport, and a pinned column adds
                      // `left` so it sticks horizontally too. One element can
                      // stick on both axes at once, so the horizontal pinning
                      // this row already had is unchanged.
                      position: "sticky",
                      top: 0,
                      left: pinned ? header.getStart("start") : undefined,
                      zIndex: pinned ? 5 : 4,
                      background: "var(--color-bg-surface)",
                    }}
                  >
                    <table.FlexRender header={header} />
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-testid="rank-distribution-row" data-team-number={row.original.teamNumber}>
              {row.getAllCells().map((cell) => {
                const pinned = cell.column.getIsPinned();
                return (
                  <TableCell
                    key={cell.id}
                    data-testid={`rank-cell-${cell.column.id}`}
                    data-pinned={pinned ? "true" : "false"}
                    className={cell.column.id === "nickname" ? "truncate text-role-body" : "text-role-body"}
                    style={{
                      width: cell.column.getSize(),
                      position: pinned ? "sticky" : undefined,
                      left: pinned ? cell.column.getStart("start") : undefined,
                      zIndex: pinned ? 1 : undefined,
                      background: pinned ? "var(--color-bg-surface)" : undefined,
                    }}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}
