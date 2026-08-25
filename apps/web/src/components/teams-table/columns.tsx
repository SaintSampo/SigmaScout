/**
 * Column definitions for the real Teams table (Task 2, 05-06-PLAN.md),
 * against the REAL `@tanstack/react-table@9.1.2` v9 API surface documented in
 * 05-04-SUMMARY.md (the throwaway touch spike that proved this composition,
 * removed by 05-08-PLAN.md Task 3) — `useTable`,
 * `tableFeatures({ columnPinningFeature, columnSizingFeature })`,
 * `createColumnHelper`, logical `'start'`/`'end'` pinning. Do NOT copy
 * 05-RESEARCH.md's Pattern 2 example; it targets v8.
 *
 * The metric columns come from `metricKeysFor(algorithmId, season)` and
 * NOTHING else — never from inspecting a fetched row (TEAM-01's own
 * prohibition). A row missing a declared component renders an em-dash
 * (`MetricValue`'s own absent-metric case) and the column itself never
 * disappears.
 */
import { columnPinningFeature, columnSizingFeature, createColumnHelper, tableFeatures } from "@tanstack/react-table";
import { MetricValue } from "@/components/MetricValue";
import { metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { WIN_RATE_SORT_KEY, type TeamRow } from "./rowModel";

/** The three leading, frozen columns — the ONE list both the table and any test agree on (this plan's own `key_links`). */
export const PINNED_COLUMN_IDS = ["rank", "teamNumber", "nickname"] as const;

/**
 * Registered once, module-level, and re-exported so `TeamsTable.tsx`
 * constructs `useTable` with the SAME features object `createColumnHelper`
 * below was instantiated against (05-04-SUMMARY.md's v9 API note: pinning
 * offsets require `columnSizingFeature` registered alongside
 * `columnPinningFeature`, or `getStart`/`getSize` do not exist at all).
 */
export const features = tableFeatures({ columnPinningFeature, columnSizingFeature });

const columnHelper = createColumnHelper<typeof features, TeamRow>();

/**
 * Column ids the header row treats as clickable/sortable — every declared
 * metric key (which always includes `TOTAL_KEY`, D-27) plus the reserved
 * win-rate sentinel. `rank`/`teamNumber`/`nickname`/`record` are NOT
 * sortable: `sortTeamRows` (Task 1) only orders by a metric value or the
 * win-rate sentinel, so making a text/derived-rank column "sortable" would
 * expose a control with no matching sort implementation behind it.
 */
export function sortableColumnIds(algorithmId: string, season: number): string[] {
  return [...metricKeysFor(algorithmId, season), WIN_RATE_SORT_KEY];
}

function metricLabel(key: string): string {
  return key === TOTAL_KEY ? "Total" : key;
}

function formatWinRate(value: number | null): string {
  if (value === null) return "—";
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
 */
export function buildColumns(algorithmId: string, season: number) {
  const metricKeys = metricKeysFor(algorithmId, season);

  return columnHelper.columns([
    columnHelper.accessor("rank", { header: "Rank", size: 56 }),
    columnHelper.accessor("teamNumber", { header: "Team #", size: 88 }),
    columnHelper.accessor("nickname", {
      header: "Nickname",
      size: 220,
      cell: (info) => (
        <span title={info.getValue()} className="block max-w-full">
          {info.getValue()}
        </span>
      ),
    }),
    ...metricKeys.map((key) =>
      columnHelper.accessor((row) => row.metrics[key], {
        id: key,
        header: metricLabel(key),
        size: 120,
        cell: (info) => <MetricValue metric={info.getValue()} />,
      }),
    ),
    columnHelper.accessor("record", {
      header: "Record",
      size: 100,
      cell: (info) => formatRecord(info.getValue()),
    }),
    columnHelper.accessor("winRate", {
      id: WIN_RATE_SORT_KEY,
      header: "Win %",
      size: 84,
      cell: (info) => formatWinRate(info.getValue()),
    }),
  ]);
}
