/**
 * Column definitions for the Teams table, against the `@tanstack/react-table`
 * v9 API surface — `useTable`, `tableFeatures({ columnPinningFeature,
 * columnSizingFeature })`, `createColumnHelper`, logical `'start'`/`'end'`
 * pinning.
 *
 * The metric columns come from `metricKeysFor(algorithmId, season)` (the
 * components view) or `displayedMetricKeys`'s own grouped-view key set
 * (`[TOTAL_KEY, ...GROUP_METRIC_KEYS]`) and NOTHING else — never from
 * inspecting a fetched row. A row missing a declared component renders a
 * BLANK cell (`MetricValue`'s own absent-metric case) and the column itself
 * never disappears.
 */
import { columnPinningFeature, columnSizingFeature, createColumnHelper, tableFeatures } from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";
import { MetricValue } from "@/components/MetricValue";
import { TotalSigmaValue, totalColumnHeader, TOTAL_SIGMA_COLUMN_WIDTH_PX } from "@/components/TotalSigmaValue";
import { GROUP_METRIC_KEYS, hasGroupedTeamsView, metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { metricDisplayLabel } from "@/lib/metricLabels";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { WIN_RATE_SORT_KEY, type TeamRow } from "./rowModel";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { usesSigmaScore } from "../../../../../packages/harness/sigmaScore.js";

/** The three leading, frozen columns — the ONE list both the table and any test agree on. */
export const PINNED_COLUMN_IDS = ["rank", "teamNumber", "nickname"] as const;

/**
 * The narrow-viewport pinned set: ALWAYS derived as `PINNED_COLUMN_IDS`
 * minus `"nickname"`, never a second hand-typed literal. Below
 * `MOBILE_BREAKPOINT_PX`, nickname stops being pinned and scrolls with the
 * data — pinning all three (380px declared) leaves no room for a single
 * prediction metric on a 390px screen; team number is FRC's canonical row
 * identity and rank is implicit in row order on a rank-ordered table, so
 * nickname is the one that gives way. `Insights` and `TeamsTable` share
 * this identical derivation (`Breakdown` has its own copy since it has no
 * rank column to derive from).
 */
export const MOBILE_PINNED_COLUMN_IDS = PINNED_COLUMN_IDS.filter((id) => id !== "nickname");

/**
 * The two identity columns' declared width BELOW `MOBILE_BREAKPOINT_PX`,
 * derived from real rendered geometry:
 *  - rank needs to hold a 4-digit value without clipping — `TeamsTable`'s
 *    own rank column ranks the full season-wide team pool (~3,750 teams),
 *    so "9999" is the worst case, measured at a real cell width of 52.3px
 *    including padding. `RANK_COLUMN_WIDTH_NARROW_PX` adds a ~4px
 *    cross-browser font-hinting margin and is shared by both `TeamsTable`
 *    and `InsightsTab` rather than each table picking its own number.
 *  - teamNumber needs to hold a 5-digit value ("10000" — FRC numbers now
 *    exceed 9999) without clipping, measured at 61.4px; adds a larger
 *    ~10px margin matching the "Team #" header's own measured width.
 * The WIDE-viewport sizes (96/88 for `TeamsTable`, 72/88 for
 * `buildInsightsColumns`) are DELIBERATELY left unchanged: both already
 * exceed these narrow minimums with room to spare.
 */
export const RANK_COLUMN_WIDTH_NARROW_PX = 56;
export const TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX = 72;

/**
 * Nickname's declared width BELOW `MOBILE_BREAKPOINT_PX`. Unpinning
 * nickname but leaving its `size: 220` unchanged left a real 390px phone
 * consuming the ENTIRE scroller before a single data column began — zero
 * data pixels visible at scroll 0. Nickname is supplementary once unpinned
 * (the pinned team number is FRC's canonical identifier), so it is the
 * column that gives further ground.
 *
 * 90 is the largest width that still leaves TeamsTable's tightest layout —
 * the only one of the three tables where a full 120px metric column sits
 * immediately after nickname — with a real, fully-visible metric column at
 * scroll 0 (measured with 4px to spare against the scroller). Insights and
 * Breakdown clear it with more room. A single shared constant, not a
 * per-table number, matching the identity-column constants' own "one
 * number, not independently-drifting copies" precedent.
 *
 * Verified against real nicknames at this width: "Black Hawk Robotics" →
 * "Black Haw…", a readable multi-word prefix in every measured case, never
 * a bare ellipsis. The WIDE-viewport size (220, unchanged) applies only
 * below `MOBILE_BREAKPOINT_PX`.
 */
export const NICKNAME_COLUMN_WIDTH_NARROW_PX = 90;

/**
 * `record`'s declared width BELOW `MOBILE_BREAKPOINT_PX`. The narrowest
 * supported viewport (312px scroller) left only 94px after rank+teamNumber+
 * nickname, and the 100-120px column that used to sit there next no longer
 * fit (measured live: Insights' `record` missed by 6px, TeamsTable's first
 * metric column by 26px).
 *
 * The metric-tier value cell is NOT narrowed here: its real worst-case
 * value+spread string needs ~86.7px of rendered box width on its own,
 * already exceeding the 94px budget before cell padding — narrowing a
 * metric column would silently risk a real value bleeding into its
 * neighbour's cell. `record` is narrowed instead.
 *
 * Derived from real rendered geometry: `formatRecord`/`formatEventRecord`
 * both emit `{wins}-{losses}-{ties}`, and tabular-figure digits make the
 * rendered width a pure function of CHARACTER COUNT. The real worst case
 * across every published season is an 8-character `WWW-LL-T` string (max
 * wins observed: 165) — never 9+ characters. 56.48px content + padding +
 * a 6px cross-browser buffer rounds up to 80, clearing the 94px budget
 * with 14px to spare. `TeamsTable` also REORDERS `record` to sit
 * immediately after `nickname` below the breakpoint (its layout puts the
 * metric columns there first, unlike `InsightsTab`).
 *
 * The WIDE-viewport size (100, unchanged) applies only below
 * `MOBILE_BREAKPOINT_PX`.
 */
export const RECORD_COLUMN_WIDTH_NARROW_PX = 80;

/**
 * Registered once, module-level, and re-exported so `TeamsTable.tsx`
 * constructs `useTable` with the SAME features object `createColumnHelper`
 * below was instantiated against — pinning offsets require
 * `columnSizingFeature` registered alongside `columnPinningFeature`, or
 * `getStart`/`getSize` do not exist at all.
 */
export const features = tableFeatures({ columnPinningFeature, columnSizingFeature });

const columnHelper = createColumnHelper<typeof features, TeamRow>();

/**
 * The Teams table's two views: "grouped" is the DEFAULT — Auto / Teleop /
 * Endgame / Total, the same four numbers the team page's header tiles lead
 * with — and "components" is the full per-component set behind the toggle.
 * Only grouped-capable algorithms (`hasGroupedTeamsView`) ever resolve to
 * the grouped column set; EPA renders components regardless (its artifact
 * carries no phase metrics) and OPR renders its single Total column on both.
 */
export type TeamsTableView = "grouped" | "components";

/**
 * The WIDE-viewport (at/above `MOBILE_BREAKPOINT_PX`) per-metric-column
 * width for every algorithm — 88px. Tabular-figure digits make rendered
 * width a pure function of character count, and 65.16px content + padding
 * + a 6px cross-browser font-hinting buffer rounds up to 88. Below the
 * breakpoint every algorithm uses the literal `120` directly at
 * `buildColumns`'s own call site; this constant is for the
 * at/above-breakpoint case only.
 */
export const METRIC_COLUMN_WIDTH_PX = 88;

/**
 * The Total column's own width, which depends on whether it renders the
 * split pill. `TOTAL_SIGMA_COLUMN_WIDTH_PX` (154, `TotalSigmaValue.tsx`'s
 * own measurement block) applies in BOTH narrow and wide modes when
 * `usesSigmaScore(algorithmId)` — the pill needs headroom the narrow
 * literal 120 does not give it. Every other metric column (and Total
 * itself under a non-Sigma algorithm) keeps the pre-existing narrow/wide
 * derivation unchanged: the literal 120 below the breakpoint,
 * `METRIC_COLUMN_WIDTH_PX` above it.
 */
function metricColumnWidthFor(key: string, algorithmId: string, isNarrow: boolean): number {
  if (key === TOTAL_KEY && usesSigmaScore(algorithmId)) return TOTAL_SIGMA_COLUMN_WIDTH_PX;
  return isNarrow ? 120 : METRIC_COLUMN_WIDTH_PX;
}

/** Total's header reads "Total ± Sigma" under a Sigma-enabled algorithm (`TotalSigmaValue.tsx`'s `totalColumnHeader`); every other metric column keeps its ordinary friendly label. */
function metricColumnHeaderFor(key: string, algorithmId: string): string {
  return key === TOTAL_KEY ? totalColumnHeader(algorithmId) : metricDisplayLabel(key);
}

/**
 * The metric column KEY SET a given (algorithm, season, view) triple
 * actually displays — the one derivation both `buildColumns` and
 * `sortableColumnIds` share. Total leads in BOTH the grouped branch and
 * `metricKeysFor`'s own components-view order — see `metricKeysFor`'s own
 * doc comment for why that single change lands everywhere it applies.
 */
export function displayedMetricKeys(algorithmId: string, season: number, view: TeamsTableView): readonly string[] {
  if (view === "grouped" && hasGroupedTeamsView(algorithmId)) {
    return [TOTAL_KEY, ...GROUP_METRIC_KEYS];
  }
  return metricKeysFor(algorithmId, season);
}

/**
 * Column ids the header row treats as clickable/sortable — every DISPLAYED
 * metric key (which always includes `TOTAL_KEY`) plus the reserved win-rate
 * sentinel. `rank`/`teamNumber`/`nickname`/`record` are NOT sortable:
 * `sortTeamRows` only orders by a metric value or the win-rate sentinel, so
 * making a text/derived-rank column "sortable" would expose a control with
 * no matching sort implementation behind it.
 */
export function sortableColumnIds(algorithmId: string, season: number, view: TeamsTableView = "grouped"): string[] {
  return [...displayedMetricKeys(algorithmId, season, view), WIN_RATE_SORT_KEY];
}

/**
 * The rank column's full, algorithm-qualified accessible name — the
 * current algorithm's own display label plus "Rank". Exported so
 * `TeamsTable.tsx` can hang it off the `<th>` as `aria-label`/`title` in
 * narrow mode, rather than hand-deriving a second copy there: one
 * function, two call sites, so the visible-wide-mode string and the
 * narrow-mode accessible name can never drift apart. See the `rank`
 * column's own comment below for why both exist.
 */
export function rankColumnAccessibleLabel(algorithmId: string): string {
  return `${algorithmDisplayLabel(algorithmId as PublishedAlgorithmId)} Rank`;
}

function formatWinRate(value: number | null): string {
  if (value === null) return "";
  return `${(value * 100).toFixed(1)}%`;
}

function formatRecord(record: TeamRow["record"]): string {
  return `${record.wins}-${record.losses}-${record.ties}`;
}

/**
 * `buildColumns(algorithmId, season)`: the leading pinned group (rank, team
 * number, nickname) followed by one column per declared metric key, then
 * record, then win rate. Truncation for long text (the nickname cell) is
 * done by the layout (a CSS class in `TeamsTable.tsx`), never by slicing the
 * string here — a multi-byte character can never be cut mid-codepoint.
 *
 * The team-number and nickname cells link to `/team/{teamNumber}`, carrying
 * the CURRENTLY-SELECTED `algorithmId`/`season` this function is already
 * called with — threaded straight through rather than a second cross-route
 * search read, since both values are already parameters here. `tab` is
 * fixed to `"overview"`: there is no "previous team search" to preserve a
 * tab choice from when arriving from a different route.
 *
 * `isNarrow`: below `MOBILE_BREAKPOINT_PX`, `rank`/`teamNumber` shrink to
 * `RANK_COLUMN_WIDTH_NARROW_PX`/`TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX` — see
 * those constants' own doc comments for the real-geometry derivation.
 * At/above the breakpoint the sizes are UNCHANGED (96/88).
 */
export function buildColumns(
  algorithmId: string,
  season: number,
  isNarrow: boolean,
  metricFirst: boolean = isNarrow,
  view: TeamsTableView = "grouped",
) {
  const metricKeys = displayedMetricKeys(algorithmId, season, view);
  // `algorithmId` reaching this function was already validated upstream
  // through `RootSearchSchema.algorithm` before this table ever rendered —
  // the same loose-cast escape hatch `SearchBox.tsx`/`YearSelect.tsx` use
  // for a value the type system widened to plain `string` crossing a
  // component-prop boundary.
  const algorithm = algorithmId as PublishedAlgorithmId;

  const metricColumns = metricKeys.map((key) => {
    const isTotal = key === TOTAL_KEY;
    return columnHelper.accessor((row) => row.metrics[key], {
      id: key,
      // Friendly labels ONLY: "Hub Shift 2", "Auto", "Fouls Committed" —
      // never a raw artifact key like `hubShift2`. Total is the one
      // exception: its header comes from `metricColumnHeaderFor`, which
      // reads "Total ± Sigma" under a Sigma-enabled algorithm.
      header: metricColumnHeaderFor(key, algorithmId),
      // Total's own width is `metricColumnWidthFor`'s business — see that
      // function's own doc comment.
      size: metricColumnWidthFor(key, algorithmId, isNarrow),
      // Rarity tiers, the same ones the team page's metric grid applies and
      // the same `.metric-tier--*` tokens — so a number does not change
      // meaning between the Teams table and the team page it links to.
      // Read from the artifact's own `tier` field rather than derived from
      // a percentile: the teams artifact deliberately carries the compact
      // tier instead.
      //
      // `?? "common"`: the wire field is OMITTED for both Common and "no
      // rank at all", and the client cannot tell those two apart. On any
      // fully-published season the coalesce is exactly correct — publish
      // ranks every metric that has a value, so the only cells with no
      // label ARE the Common ones. The gap is a live event: the Worker
      // that updates rows mid-event computes no percentiles at all, so a
      // row can briefly wear a Common ring instead of the ring it
      // deserves, until the next full publish corrects it.
      //
      // There is no separate Sigma column. Wherever this algorithm
      // publishes a Sigma Score, the TOTAL cell renders it as the right
      // half of a joined split pill (`TotalSigmaValue`) instead — the
      // row's own `sigmaScore`/`sigmaTier` (never re-derived here), passed
      // through exactly as `rowModel.ts` decided them (no `?? "common"`
      // coalesce: an absent entry means "unranked," not "Common"). Every
      // other metric column, and Total itself under a non-Sigma algorithm,
      // renders byte-identical — `TotalSigmaValue` degrades to plain
      // `MetricValue` whenever `sigma` is `undefined`. The algorithm's own
      // `spread` is never rendered here, in either shape.
      cell: (info) =>
        isTotal ? (
          <TotalSigmaValue
            total={info.getValue()}
            totalTier={info.getValue()?.tier ?? "common"}
            sigma={
              info.row.original.sigmaScore !== undefined
                ? { value: info.row.original.sigmaScore, tier: info.row.original.sigmaTier }
                : undefined
            }
          />
        ) : (
          <MetricValue metric={info.getValue()} tier={info.getValue()?.tier ?? "common"} />
        ),
    });
  });

  // The narrow-viewport LEADING metric: Total leads `metricKeys` in EVERY
  // view — `metricKeysFor`'s components-view order and
  // `displayedMetricKeys`'s grouped-view order both put `TOTAL_KEY` first —
  // so the narrow lead is always index 0 by construction.
  //
  // Under a Sigma-enabled algorithm this leading column is 154px
  // (`TOTAL_SIGMA_COLUMN_WIDTH_PX`), not 120 — the split pill's own
  // measured width. Known phone-390 consequence: the pill's Sigma half
  // overshoots the scroller's edge by ~16px until the reader scrolls; Rank
  // and Team # cannot absorb that (their floors save at most 13px), and
  // the overflow is accepted rather than narrowing nickname for one
  // algorithm — see `NICKNAME_COLUMN_WIDTH_NARROW_PX`'s own doc comment.
  const leadMetricIndex = 0;
  const leadMetricColumns = [metricColumns[leadMetricIndex]!];
  const restMetricColumns = metricColumns.filter((_, index) => index !== leadMetricIndex);

  // Below MOBILE_BREAKPOINT_PX, `record` moves to sit immediately after
  // `nickname` (before the metric columns) — see
  // `RECORD_COLUMN_WIDTH_NARROW_PX`'s own doc comment for why the metric
  // columns themselves cannot safely narrow enough to occupy that position
  // instead. At/above the breakpoint the order is UNCHANGED (metrics, then
  // record, then win rate) — a narrow-viewport-only presentation change,
  // not a data or sort-behaviour change (`record` was never sortable
  // either way).
  const recordColumn = columnHelper.accessor("record", {
    header: "Record",
    size: isNarrow ? RECORD_COLUMN_WIDTH_NARROW_PX : 100,
    cell: (info) => formatRecord(info.getValue()),
  });

  const winRateColumn = columnHelper.accessor("winRate", {
    id: WIN_RATE_SORT_KEY,
    header: "Win %",
    size: 84,
    cell: (info) => formatWinRate(info.getValue()),
  });

  return columnHelper.columns([
    // This column ranks by the SELECTED algorithm's Total regardless of
    // which column the reader currently sorts by — `rowModel.ts`'s
    // `buildTeamRows` has always computed exactly this ordering. The label
    // is derived from `algorithmDisplayLabel` at render time, never a
    // literal, so a wrong-provenance claim is structurally unreachable.
    // `size` grows from 56 to 96 at/above the breakpoint: the header string
    // grows from four characters ("Rank") to a longer algorithm-qualified
    // one, and `TeamsTable.tsx` derives every pinned cell's sticky `left`
    // offset from this column's declared size — a stale 56 would clip the
    // header inside its own box on the one column the whole table is
    // ordered by.
    //
    // Below the breakpoint the column tightens to
    // `RANK_COLUMN_WIDTH_NARROW_PX`. A 56px `truncate` box on an
    // algorithm-qualified label can keep the algorithm's own short name
    // (already shown in the ribbon's algorithm selector) and ellipsize away
    // "Rank" — the only informative half, on the one column the whole
    // table is ordered by.
    //
    // Resolution: the VISIBLE text below the breakpoint is the literal
    // "Rank" — the algorithm-derived label survives only as the
    // ACCESSIBLE name, via `rankColumnAccessibleLabel` above, which
    // `TeamsTable.tsx` applies as `aria-label`/`title` on the `<th>` itself
    // (columnheader is a legal aria-label carrier; a bare `<span>`'s
    // `role="generic"` is NOT). Do NOT "simplify" this back to one literal
    // string for both modes: that either re-breaks the narrow-mode
    // truncation or loses the algorithm-provenance disclosure. The VALUE
    // cell itself never clips at either size, unaffected by any of this.
    columnHelper.accessor("rank", {
      header: isNarrow ? "Rank" : rankColumnAccessibleLabel(algorithm),
      size: isNarrow ? RANK_COLUMN_WIDTH_NARROW_PX : 96,
    }),
    columnHelper.accessor("teamNumber", {
      header: "Team #",
      size: isNarrow ? TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX : 88,
      cell: (info) => (
        <Link to="/team/$teamNumber" params={{ teamNumber: String(info.getValue()) }} search={{ year: season, algorithm, tab: "overview" }}>
          {info.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor("nickname", {
      // Visible label only — the column id stays "nickname" everywhere
      // (pinning, sticky offsets, data-testid, e2e selectors all key off it).
      header: "Team Name",
      // 220 at/above the breakpoint (unchanged), `NICKNAME_COLUMN_WIDTH_NARROW_PX`
      // below it — see that constant's own doc comment for the real-geometry
      // derivation.
      size: isNarrow ? NICKNAME_COLUMN_WIDTH_NARROW_PX : 220,
      cell: (info) => (
        <Link
          to="/team/$teamNumber"
          params={{ teamNumber: String(info.row.original.teamNumber) }}
          search={{ year: season, algorithm, tab: "overview" }}
          title={info.getValue()}
          // `truncate`, not just `block max-w-full` — see
          // `InsightsTab.tsx`'s identical anchor for the full mechanism:
          // the cell's own ellipsis only fires on ITS OWN overflowing
          // content, and this anchor's box already fills the cell exactly,
          // so the cell never sees an overflow. The anchor's own text was
          // the thing overflowing and getting hard-clipped mid-character.
          className="block max-w-full truncate"
        >
          {info.getValue()}
        </Link>
      ),
    }),
    // Below MOBILE_BREAKPOINT_PX the FIRST metric column leads (rank + team
    // + nickname + metric clears the scroller with a few pixels spare, the
    // same measured math this file's own width-derivation comments
    // record), so the product's differentiator — a tiered, ± -carrying
    // value — is on the first screenful. `record` (a TBA fact) sits
    // directly behind it, then the remaining metrics. At/above the
    // breakpoint the order is UNCHANGED.
    ...(metricFirst ? leadMetricColumns : []),
    ...(isNarrow ? [recordColumn] : []),
    ...(metricFirst ? restMetricColumns : metricColumns),
    ...(isNarrow ? [] : [recordColumn]),
    winRateColumn,
  ]);
}
