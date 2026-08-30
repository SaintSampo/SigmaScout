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
import { Link } from "@tanstack/react-router";
import { MetricValue } from "@/components/MetricValue";
import { metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { WIN_RATE_SORT_KEY, type TeamRow } from "./rowModel";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";

/** The three leading, frozen columns — the ONE list both the table and any test agree on (this plan's own `key_links`). */
export const PINNED_COLUMN_IDS = ["rank", "teamNumber", "nickname"] as const;

/**
 * The narrow-viewport pinned set (07-UAT.md G-2): ALWAYS derived as
 * `PINNED_COLUMN_IDS` minus `"nickname"`, never a second hand-typed
 * `["rank", "teamNumber"]` literal — the exact "one list, not an
 * independently-drifting copy" discipline `PINNED_COLUMN_IDS`'s own doc
 * comment states, applied to its own narrow variant. Below
 * `MOBILE_BREAKPOINT_PX` (`lib/breakpoints.ts`), nickname stops being
 * pinned and scrolls with the data — G-2's finding was that
 * rank+teamNumber+nickname pinned (380px declared) leaves no room for a
 * single prediction metric on a 390px screen; team number is FRC's
 * canonical row identity and rank is implicit in row order on a
 * rank-ordered table, so nickname is the one that gives way. `Insights`
 * and `TeamsTable` share this identical derivation (`Breakdown` has its own
 * copy in `BreakdownTab.tsx` since it has no rank column to derive from).
 */
export const MOBILE_PINNED_COLUMN_IDS = PINNED_COLUMN_IDS.filter((id) => id !== "nickname");

/**
 * The two identity columns' declared width BELOW `MOBILE_BREAKPOINT_PX`
 * (07-UAT.md G-2). Derived from real rendered geometry
 * (`scripts/measure-cell-width.mjs`, run against the app's actual compiled
 * Tailwind CSS + `@fontsource-variable/inter`, not eyeballed):
 *  - rank needs to hold a 4-digit value without clipping — `TeamsTable`'s
 *    own rank column ranks the full season-wide team pool (~3,750 teams per
 *    D-01), so "130" (Insights' own worst real case, a large event roster)
 *    is NOT this column's worst case; "9999" is, measured at a real
 *    `numeric-cell`/`text-role-body` cell width of 52.3px including the
 *    real 8px+8px `p-2` padding. `RANK_COLUMN_WIDTH_NARROW_PX` adds a ~4px
 *    safety margin for cross-browser font-hinting variance (measured on
 *    Chromium; the real device is iOS Safari) and is shared by both
 *    `TeamsTable` and `InsightsTab` (whose own worst case, a 3-digit event
 *    rank, is a strict subset of this) rather than each table picking its
 *    own number.
 *  - teamNumber needs to hold a 5-digit value ("10000" — FRC numbers now
 *    exceed 9999) without clipping, measured at a real cell width of
 *    61.4px; `TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX` adds a larger ~10px
 *    margin, matching the "Team #" header's own real measured width
 *    (58.6px) so the header text is not forced to truncate at this width
 *    either (a bonus, not a hard requirement — only the VALUE's non-clip is
 *    a hard constraint).
 * The WIDE-viewport sizes (`buildColumns`'s existing 96/88 for `TeamsTable`,
 * `buildInsightsColumns`'s existing 72/88) are DELIBERATELY left unchanged:
 * both already exceed these narrow minimums with room to spare, so leaving
 * them alone is a zero-risk way to satisfy G-2's "do not degrade the wide
 * layout" constraint — there is no header-truncation or value-clipping
 * regression to reason about above the breakpoint because nothing there
 * changes at all.
 */
export const RANK_COLUMN_WIDTH_NARROW_PX = 56;
export const TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX = 72;

/**
 * Nickname's declared width BELOW `MOBILE_BREAKPOINT_PX` (07-UAT.md G-2 part
 * 2 — "first-paint half"). G-2 part 1 (`MOBILE_PINNED_COLUMN_IDS`) unpinned
 * nickname but left its `size: 220` unchanged, so on a real 390px phone
 * `rank(56) + teamNumber(72) + nickname(220) = 348px` still consumed the
 * ENTIRE 342px scroller (390 minus the page's `p-[var(--spacing-lg)]` 24px
 * each side, `routes/event.$eventKey.tsx`/`routes/teams.tsx`) before a
 * single data column began — zero data pixels visible at scroll 0, measured
 * live. Nickname is supplementary once unpinned (the pinned team number is
 * FRC's canonical identifier, `MOBILE_PINNED_COLUMN_IDS`'s own doc comment),
 * so it is the column that gives further ground here, the same trade G-2
 * part 1 already made for the pinned block itself.
 *
 * 90 is the largest width that still leaves TeamsTable's tightest layout —
 * the only one of the three tables where a full 120px metric column sits
 * immediately after nickname (`buildColumns` below: rank, teamNumber,
 * nickname, then `metricKeys` at `size: 120` each; `InsightsTab`/
 * `BreakdownTab` both put a smaller column there instead) — with a real,
 * fully-visible metric column at scroll 0: `128 (pinned) + 90 (nickname) +
 * 120 (metric) = 338px`, 4px under the 342px scroller. Insights (`record` at
 * size 100 follows nickname) clears with 24px to spare; Breakdown (pinned
 * width only 72, teamNumber alone) clears with 60px. This 4px margin is pure
 * declared-pixel arithmetic, not a font-rendering measurement — G-1's
 * `table-layout: fixed` makes every declared width exactly the rendered
 * width, so there is no cross-browser hinting variance to buffer against
 * here (unlike `RANK_COLUMN_WIDTH_NARROW_PX`/`TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX`
 * above, which size a column to hold specific glyphs without clipping).
 *
 * Verified against real nicknames at this width (Playwright + the app's
 * actual compiled `text-role-body` CSS and `@fontsource-variable/inter`
 * font, not eyeballed): "Black Hawk Robotics" → "Black Haw…", "The Bucks'
 * Wrath" → "The Bucks…", "FIRST Israel Off Season" → "FIRST Isra…" — a
 * readable multi-word prefix in every case, never a bare ellipsis (that only
 * happens by ~30px, where two-word FRC team names lose all their
 * characters). A single shared constant, not a per-table number, matching
 * `RANK_COLUMN_WIDTH_NARROW_PX`/`TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX`'s own
 * "one number, not three independently-drifting copies" precedent — even
 * though only `TeamsTable`'s layout is the binding constraint, `InsightsTab`
 * and `BreakdownTab` both clear it with room to spare, so there is no
 * argument for giving them a separately-tuned, larger value.
 *
 * The WIDE-viewport size (220, unchanged) is untouched — this narrowing
 * applies only below `MOBILE_BREAKPOINT_PX`.
 */
export const NICKNAME_COLUMN_WIDTH_NARROW_PX = 90;

/**
 * `record`'s declared width BELOW `MOBILE_BREAKPOINT_PX` (07-UAT.md G-11).
 * G-2 part 2's own `NICKNAME_COLUMN_WIDTH_NARROW_PX` derivation was checked
 * only against `phone-390`'s 342px scroller and left `pixel-10`'s narrower
 * 312px scroller RED for Insights and TeamsTable: at 312px,
 * `rank(56) + teamNumber(72) + nickname(90) = 218px` leaves only 94px before
 * the scroller boundary, and the column that used to sit there next — a
 * 100-120px cell — no longer fits (measured live: Insights' `record` missed
 * by 6px, TeamsTable's first metric column by 26px).
 *
 * The metric-tier value cell (`MetricValue.tsx`'s `.metric-tier` box) is NOT
 * the column narrowed here, even though G-10 freed real space inside it
 * (`min-width` 80 -> 58): G-10's own live measurement against the deployed
 * 2026alhu artifact found the real worst-case NON-Total value+spread string
 * needs ~86.7px of rendered box width on its own
 * (`BREAKDOWN_METRIC_COLUMN_WIDTH_PX`'s doc comment), which already exceeds
 * this 94px budget before `TableCell`'s own 16px `p-2` padding is even
 * added (86.7 + 16 = 102.7px minimum, no buffer). Narrowing a metric column
 * to fit inside 94px would silently risk a real value bleeding into its
 * neighbour's cell (table cells default to `overflow: visible`, so this
 * would not even show as a clean clip) the first time a team's value
 * approaches that worst case — unacceptable per this gap's own "do not clip
 * metric values" instruction. `record` is narrowed instead, below.
 *
 * Derived from real rendered geometry, not guessed: `formatRecord`/
 * `formatEventRecord` both emit `{wins}-{losses}-{ties}`, and this column's
 * `numeric-cell` class carries `font-feature-settings: "tnum"`
 * (tabular/fixed-width digits), so the string's rendered width is a pure
 * function of its CHARACTER COUNT, never its specific digits — confirmed by
 * measuring "121-42-4", "165-99-9" and "999-99-9" (all 8 characters) against
 * the app's real compiled CSS/font and finding all three render at the exact
 * same 56.48px. The real worst case, queried live against every published
 * `teams/{year}/vpr@*.json` artifact 2022-2026 (3,100-3,750 teams/year): an
 * 8-character `WWW-LL-T` string (e.g. "121-42-4", 2022; max wins observed
 * across all five years: 165) — never 9+ characters in any published season.
 * 56.48px content + `TableCell`'s 16px `p-2` padding + a 6px cross-browser
 * font-hinting buffer (the same small numeric-column margin
 * `RANK_COLUMN_WIDTH_NARROW_PX` uses) = ~78.5px, rounded up to 80 for a
 * clean number with a couple of spare pixels.
 *
 * 80 clears the 94px budget with 14px to spare at `pixel-10` (312px
 * scroller) and comfortably at `phone-390` (124px available) — see this
 * table's own `07-UAT.md G-11` entry for the full arithmetic, including why
 * `TeamsTable` also REORDERS `record` to sit immediately after `nickname`
 * below the breakpoint (its own layout puts the metric columns there first,
 * unlike `InsightsTab`, which already has `record` in that position).
 *
 * The WIDE-viewport size (100, unchanged) is untouched — this narrowing
 * applies only below `MOBILE_BREAKPOINT_PX`, matching every other narrow
 * constant in this file.
 */
export const RECORD_COLUMN_WIDTH_NARROW_PX = 80;

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
 *
 * The team-number and nickname cells link to `/team/{teamNumber}` (06-05,
 * D-15/D-16), carrying the CURRENTLY-SELECTED `algorithmId`/`season` this
 * function is already called with — threaded straight through rather than a
 * second cross-route search read, per 06-05-PLAN.md's own instruction to
 * prefer threading since both values are already parameters here. `tab` is
 * fixed to `"overview"`: D-16's own default, and there is no "previous team
 * search" to preserve a tab choice from when arriving from a different route.
 *
 * `isNarrow` (07-UAT.md G-2): below `MOBILE_BREAKPOINT_PX`, `rank`/
 * `teamNumber` shrink to `RANK_COLUMN_WIDTH_NARROW_PX`/
 * `TEAM_NUMBER_COLUMN_WIDTH_NARROW_PX` — see those constants' own doc
 * comments for the real-geometry derivation. At/above the breakpoint the
 * sizes are UNCHANGED (96/88), so wide-viewport rendering is byte-for-byte
 * identical to before this fix.
 */
export function buildColumns(algorithmId: string, season: number, isNarrow: boolean) {
  const metricKeys = metricKeysFor(algorithmId, season);
  // `algorithmId` reaching this function was already validated upstream
  // through `RootSearchSchema.algorithm` (T-05-02) before this table ever
  // rendered — the same loose-cast escape hatch `SearchBox.tsx`/`YearSelect.tsx`
  // already use for a value the type system widened to plain `string`
  // crossing a component-prop boundary, not a new, unvalidated assumption.
  const algorithm = algorithmId as PublishedAlgorithmId;

  const metricColumns = metricKeys.map((key) =>
    columnHelper.accessor((row) => row.metrics[key], {
      id: key,
      header: metricLabel(key),
      size: 120,
      // D-17's rarity tiers, the same ones the team page's metric grid
      // applies and the same `.metric-tier--*` tokens — so a number does
      // not change meaning between the Teams table and the team page it
      // links to. Read from the artifact's own `tier` field rather than
      // derived from a percentile: the teams artifact deliberately carries
      // the compact tier instead (see pageArtifacts.ts's `tier` doc).
      cell: (info) => <MetricValue metric={info.getValue()} tier={info.getValue()?.tier} />,
    }),
  );

  // 07-UAT.md G-11: below MOBILE_BREAKPOINT_PX, `record` moves to sit
  // immediately after `nickname` (before the metric columns) — see
  // `RECORD_COLUMN_WIDTH_NARROW_PX`'s own doc comment for why the metric
  // columns themselves cannot safely narrow enough to occupy that position
  // instead. At/above the breakpoint the order is UNCHANGED (metrics, then
  // record, then win rate) — this reorder is a narrow-viewport-only
  // presentation change, not a data or sort-behaviour change (`record` was
  // never sortable either way, `sortableColumnIds` above never lists it).
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
    // D-20: this column ranks by the SELECTED algorithm's Total regardless
    // of which column the reader currently sorts by — `rowModel.ts`'s
    // `buildTeamRows` has always computed exactly this ordering, the bare
    // "Rank" label simply failed to say so. The label is derived from
    // `algorithmDisplayLabel` at render time, never a literal, so a
    // wrong-provenance claim (naming an algorithm that didn't produce the
    // ordering) is structurally unreachable and 07-18's D-04 relabel
    // carries this header for free. `size` grows from 56 to 96 at/above the
    // breakpoint: the header string grows from four characters ("Rank") to
    // eight or nine ("Sigma1 Rank"/"VPR Rank"), and `TeamsTable.tsx` derives
    // every pinned cell's sticky `left` offset from this column's declared
    // size — a stale 56 would clip the new header inside its own box on the
    // one column the whole table is ordered by. Below the breakpoint it
    // tightens to `RANK_COLUMN_WIDTH_NARROW_PX` (G-2) — the header may
    // ellipsis-truncate there (it already carries `truncate`), which is an
    // accepted narrow-mode trade for two extra metric columns' worth of
    // width; the VALUE itself never clips at either size.
    columnHelper.accessor("rank", { header: `${algorithmDisplayLabel(algorithm)} Rank`, size: isNarrow ? RANK_COLUMN_WIDTH_NARROW_PX : 96 }),
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
      header: "Nickname",
      // 07-UAT.md G-2 part 2: 220 at/above the breakpoint (unchanged),
      // `NICKNAME_COLUMN_WIDTH_NARROW_PX` below it — see that constant's own
      // doc comment for the real-geometry derivation (this table's own
      // layout is the binding constraint the shared constant is sized to).
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
    // 07-UAT.md G-11: below MOBILE_BREAKPOINT_PX, `record` (narrow, safe
    // content) sits here, ahead of the metric columns — see
    // `RECORD_COLUMN_WIDTH_NARROW_PX`'s doc comment. At/above the breakpoint
    // this array is empty and `record` stays in its original trailing spot.
    ...(isNarrow ? [recordColumn] : []),
    ...metricColumns,
    ...(isNarrow ? [] : [recordColumn]),
    winRateColumn,
  ]);
}
