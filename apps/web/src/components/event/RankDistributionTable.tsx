/**
 * The rank-distribution table — the Simulation tab's central visualization.
 * Four columns: Team #, Nickname (both leading, matching `BreakdownTab.tsx`'s
 * own identity-column lead), Median (a plain display integer) and
 * Distribution (the three-layer plot cell on a shared 1..N rank axis drawn
 * exactly once in the column header). No column is frozen horizontally.
 *
 * Every position in this file comes from `simAxis.ts` (`x`, `histBarExtent`,
 * `rankBandExtent`, `medianTickLeft`, `rankAxisTicks`, `PLOT_W`,
 * `SIM_GEOMETRY`) or `rankRows.ts` (`histBarHeight`, `rankBandLabel`) — no
 * second, hand-tuned position is computed here. The row order this table
 * renders is whatever `buildRankDistributionRows` produced; this component
 * re-sorts nothing, computes no quantile and no median of its own.
 *
 * This file deliberately does not add a probability-of-finishing-top-8 or
 * alliance-captain column — the cutoff is not universally 8 across the
 * corpus's events, so such a column would have had to derive its threshold
 * per event. It renders no caption claiming the ranking method replicates
 * official tie-breaking, because only TBA's position-0 sort order is ever
 * ingested and no data-backed secondary sort exists anywhere in this
 * pipeline.
 */
import { columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/lib/breakpoints";
import { PLOT_W, SIM_GEOMETRY, histBarExtent, medianTickLeft, rankAxisTicks, rankBandExtent, x } from "@/lib/simAxis";
import { histBarHeight, rankBandLabel, type RankDistributionRow } from "./rankRows.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

/**
 * The exact four header labels, in order — shared by the header render so
 * the header list and the column count can never disagree, and the
 * structural gate that forbids a probability-of-top-8 or captain column
 * being added back without failing a test.
 */
export const RANK_TABLE_HEADERS = ["Team #", "Team Name", "Median", "Distribution"] as const;

/**
 * The shared 1..N rank axis, drawn exactly once inside the Distribution
 * column's own header cell — mirroring `EventMatchTable.tsx`'s
 * `EventAxisHeader` generalized from a score axis to a rank axis. This axis
 * is deliberately never clipped to the union of occupied ranks: every one of
 * the 1000 draws assigns every team to exactly one of the N ranks, so every
 * rank is occupied by somebody across the table. The visually-hidden
 * "Distribution" span keeps this cell's accessible name and
 * `RANK_TABLE_HEADERS`'s own text in agreement without competing with the
 * axis for the reader's attention.
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
 * then the median tick — drawn in that DOM order so the tick is never
 * obscured. Bars are emitted only for ranks with a non-zero draw count (the
 * one real per-row node reduction available). The band carries the
 * `sim-band-overlay` class and nothing else — no inline opacity, no filter,
 * no blend mode: that token already carries its own alpha, and applying
 * `SIM_GEOMETRY.BAND_OPACITY` a second time as a CSS opacity would render the
 * band nearly invisible. The band's extents are already clamped inside
 * `rankBandExtent` against real measured overflows and are never re-clamped
 * or adjusted here.
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
  // The continuous median, never the display integer — coupled geometry, not
  // a second computation.
  const tickLeft = medianTickLeft(row.medianRank, teamCount, plotW);

  return (
    // Bounded to the plot's own width so the percentile label below can never
    // be the thing that widens the column: a wide label can measure wider
    // than a shrunken plot and push overflow into a table that must never
    // scroll sideways.
    <div className="flex flex-col gap-[var(--spacing-xs)]" style={{ width: plotW }}>
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
        dash — never a plus-or-minus quantity: that glyph is reserved for
        exactly one standard deviation of full predictive variance, and a
        rank spread is not that quantity, because rank is bounded, integer
        and skewed. `rankBandLabel` (rankRows.ts) is the one function that
        formats this string, and neither it nor this file ever types that
        glyph.
      */}
      <span data-testid={`rank-band-label-${row.teamKey}`} className="text-role-label truncate text-[var(--color-text-muted)]">
        {rankBandLabel(row.p10, row.p90)}
      </span>
    </div>
  );
}

/**
 * Registered once, module-level: only column sizing is registered (no
 * pinning feature — no column in this table is frozen). The column helper is
 * typed against this module's own `RankDistributionRow`, so it is declared
 * locally rather than imported across a module boundary.
 */
const features = tableFeatures({ columnSizingFeature });
const columnHelper = createColumnHelper<typeof features, RankDistributionRow>();

/**
 * The four columns, in `RANK_TABLE_HEADERS` order. `teamCount`, `season` and
 * `algorithmId` are closed over so the Distribution column's shared axis and
 * every row's team-page links share the same values the caller passed to the
 * table. `algorithmId` is typed as plain `string` here and cast to
 * `PublishedAlgorithmId` at the one call site that needs it — the same
 * loose-cast escape hatch `InsightsTab.tsx`/`BreakdownTab.tsx` already use for
 * a value the type system widened crossing a component-prop boundary (it was
 * already validated upstream through `RootSearchSchema.algorithm` before this
 * table ever rendered).
 */
function buildRankTableColumns(teamCount: number, season: number, algorithmId: string, isNarrow: boolean, plotColumnW: number) {
  const algorithm = algorithmId as PublishedAlgorithmId;
  return columnHelper.columns([
    columnHelper.accessor("teamNumber", {
      header: RANK_TABLE_HEADERS[0],
      // Same derivation InsightsTab.tsx sizes its own Team # column at; the
      // narrow width is the shared exported constant, never a new literal.
      size: isNarrow ? RANK_COLUMN_WIDTHS.narrow.teamNumber : RANK_COLUMN_WIDTHS.wide.teamNumber,
      cell: (info) => (
        <Link to="/team/$teamNumber" params={{ teamNumber: String(info.getValue()) }} search={{ year: season, algorithm, tab: "overview" }}>
          {info.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("nickname", {
      header: RANK_TABLE_HEADERS[1],
      size: isNarrow ? RANK_COLUMN_WIDTHS.narrow.nickname : RANK_COLUMN_WIDTHS.wide.nickname,
      cell: (info) => {
        const nickname = info.getValue();
        return (
          <Link
            to="/team/$teamNumber"
            params={{ teamNumber: String(info.row.original.teamNumber) }}
            search={{ year: season, algorithm, tab: "overview" }}
            title={nickname}
            // `truncate` on the anchor, not the cell — the anchor is the box
            // that actually overflows.
            className="block max-w-full truncate"
          >
            {nickname ?? ""}
          </Link>
        );
      },
    }),
    columnHelper.accessor("medianDisplay", {
      header: RANK_TABLE_HEADERS[2],
      size: isNarrow ? RANK_COLUMN_WIDTHS.narrow.median : RANK_COLUMN_WIDTHS.wide.median,
      // A plain numeric-cell integer — no tier box, no colour, no weight
      // change. This is the display rounding of the continuous median the
      // tick draws, never a second computation.
      cell: (info) => <span className="numeric-cell text-role-body">{info.getValue()}</span>,
    }),
    columnHelper.accessor((row) => row, {
      id: "distribution",
      header: () => <RankAxisHeader teamCount={teamCount} plotW={plotColumnW - CELL_PADDING_X_PX} />,
      size: plotColumnW,
      cell: (info) => <RankDistributionPlotCell row={info.getValue()} teamCount={teamCount} plotW={plotColumnW - CELL_PADDING_X_PX} />,
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
 * The rank-distribution table. `tableLayout: "fixed"`: an `auto` layout lets
 * the browser resize columns past their declared `size`, and the
 * leftover-width computation below (`fixedColumnsWidth`) depends on every
 * column actually rendering at its declared width. The table is sized to
 * `max-content` so there is no slack to redistribute and no trailing filler
 * cell is needed.
 */
/**
 * The three non-plot columns' declared widths, per breakpoint — the one
 * source both `buildRankTableColumns` and the leftover-width computation
 * read, so the columns' declared sizes and the space left for the plot can
 * never disagree. A team number is at most five digits and a median at most
 * three, so both carry only what their content needs; the nickname keeps
 * enough room for a typical FRC name and ellipsises the rest (every cell
 * already carries `truncate` and a `title` with the full name).
 *
 * These widths include each cell's own horizontal padding, because
 * Tailwind's preflight sets `box-sizing: border-box`.
 */
const RANK_COLUMN_WIDTHS = {
  wide: { teamNumber: 72, nickname: 176, median: 78 },
  narrow: { teamNumber: 64, nickname: 72, median: 44 },
} as const;

function fixedColumnsWidth(isNarrow: boolean): number {
  const w = isNarrow ? RANK_COLUMN_WIDTHS.narrow : RANK_COLUMN_WIDTHS.wide;
  return w.teamNumber + w.nickname + w.median;
}

/** `TableCell`/`TableHead`'s own `px-2` — 8px each side, on the plot's own cell. */
const CELL_PADDING_X_PX = 16;

/**
 * The plot column's floor, chosen so it is never actually reached at any
 * supported width. The narrowest device this project targets is 320px, whose
 * card measures 255px; the narrow fixed columns take 180, leaving 75 — above
 * this floor, so the table fits exactly rather than clipping.
 */
const MIN_PLOT_COLUMN_W = 72;

export function RankDistributionTable({ rows, teamCount, season, algorithmId }: RankDistributionTableProps) {
  const isNarrow = useIsMobile();

  /*
   * The plot stretches to fill whatever width the card actually has, rather
   * than every row being a fixed-width island inside a card that hugged it.
   *
   * Measured rather than assumed, using the same measure-with-a-sane-fallback
   * pattern `MetricHistoryChart.tsx` established: jsdom always measures 0, so
   * tests and the first paint fall back to `PLOT_W` and render the geometry
   * this table shipped with. `PLOT_W` is also the floor — on a viewport too
   * narrow to grant more, the plot keeps its original width and the card
   * scrolls horizontally.
   */
  const containerRef = useRef<HTMLDivElement>(null);
  const [plotColumnW, setPlotColumnW] = useState<number>(PLOT_W + CELL_PADDING_X_PX);
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = containerRef.current;
      if (!el) return;
      // A zero measurement means "not laid out" — jsdom always reports 0, and
      // so does a real browser before first layout. Keep the fallback rather
      // than clamping to the floor, which would silently render every plot at
      // its minimum width under test.
      const measured = el.clientWidth;
      if (measured <= 0) return;
      const available = measured - fixedColumnsWidth(isNarrow);
      setPlotColumnW(Math.max(MIN_PLOT_COLUMN_W, Math.floor(available)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isNarrow]);
  const columns = useMemo(
    () => buildRankTableColumns(teamCount, season, algorithmId, isNarrow, plotColumnW),
    [teamCount, season, algorithmId, isNarrow, plotColumnW]
  );

  const table = useTable({ features, columns, data: rows as RankDistributionRow[] });

  return (
    // `max-h-[70vh]` + `overflow-y-auto` for a sticky title row. This element
    // is already a vertical scroll container — `overflow-x: auto` forces
    // `overflow-y`'s used value to `auto` per the CSS Overflow spec — but with
    // an unbounded height it never actually scrolled, so a `position: sticky`
    // header inside it would have had nothing to stick against. Bounding the
    // height is what gives the sticky header a scrollport; a large division
    // renders well over 5000px tall, so this table genuinely wants its own
    // scrollport rather than the page's.
    <div
      ref={containerRef}
      data-testid="rank-distribution-table-scroll"
      // Full width, not hug-the-content: the card spans the same width as the
      // run summary and the picker above it, and the plot grows to fill it.
      className="data-card max-h-[70vh] w-full min-w-0 touch-pan-xy overflow-x-hidden overflow-y-auto overscroll-contain"
    >
      <table
        style={{
          tableLayout: "fixed",
          // Exactly the card's width, never more. The declared column sizes
          // are computed to sum to this width — the three fixed columns plus
          // the measured leftover — so `100%` neither leaves a dead strip nor
          // overflows, and there is no `minWidth` to force a scrollbar back.
          width: "100%",
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  data-testid={`rank-header-${header.column.id}`}
                  className="text-role-label truncate"
                  style={{
                    width: header.getSize(),
                    // `top: 0` keeps the title row visible inside this
                    // table's own scrollport while the reader scrolls; no
                    // column is frozen horizontally.
                    position: "sticky",
                    top: 0,
                    zIndex: 4,
                    background: "var(--color-bg-surface)",
                  }}
                >
                  <table.FlexRender header={header} />
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-testid="rank-distribution-row" data-team-number={row.original.teamNumber}>
              {row.getAllCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  data-testid={`rank-cell-${cell.column.id}`}
                  className={cell.column.id === "nickname" ? "truncate text-role-body" : "text-role-body"}
                  style={{ width: cell.column.getSize() }}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}
