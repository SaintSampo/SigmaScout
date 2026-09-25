/**
 * The single source of truth for what the URL carries. Every field either
 * coerces to a known-valid value or is structurally impossible to
 * construct outside its own declared valid states — a hand-edited or
 * malformed search param can therefore only ever resolve to one of this
 * schema's own declared states before any component reads it.
 *
 * The URL carries year, algorithm, sort field and sort direction; the
 * CURRENT VIEW is the pathname itself (`/teams`, `/events`, `/compare`) —
 * it needs no search param of its own. Do not add a `view` field here: the
 * route segment already IS that fact, and a redundant `view` param would
 * be a second, driftable source of the same information.
 */
import { z } from "zod";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../packages/harness/publishedAlgorithms.js";
import { DISTRICT_KEY_PATTERN } from "../../../../packages/core/districts/keys.js";
import { CURRENT_SEASON, SEASONS } from "./seasons.js";
import { teamsSortKeyUniverse } from "./metricKeys.js";
import { resolveSortKey } from "./resolveSortKey.js";

const KNOWN_SEASONS = new Set<number>(SEASONS);

/**
 * The default algorithm every route without an explicit `?algorithm=`
 * resolves to — SigmaScout's own premier algorithm.
 *
 * A shared link carrying a retired algorithm id is not a dead link: a
 * retired id is not a member of `PUBLISHED_ALGORITHM_IDS`, so the
 * `z.enum(...).catch(DEFAULT_ALGORITHM)` expression below falls through to
 * this value rather than failing.
 */
const DEFAULT_ALGORITHM: PublishedAlgorithmId = "spr";

/**
 * `year`: coerced to an integer and constrained to the known season list
 * (`seasons.ts`'s `SEASONS`) — anything else, INCLUDING a missing param
 * (`z.coerce.number()` on `undefined` produces `NaN`, which fails both the
 * base number check and the refinement below), falls back to
 * `CURRENT_SEASON` via `.catch()`.
 *
 * `algorithm`: an enum over the published algorithm ids
 * (`packages/harness/publishedAlgorithms.ts`'s `PUBLISHED_ALGORITHM_IDS`,
 * the same build-time constant the algorithm dropdown renders from before
 * any manifest fetch resolves) — anything outside that closed set,
 * including a missing param or a retired id, falls back to
 * `DEFAULT_ALGORITHM` via `.catch()`.
 */
export const RootSearchSchema = z.object({
  year: z.coerce
    .number()
    .int()
    .refine((year) => KNOWN_SEASONS.has(year))
    .catch(CURRENT_SEASON),
  algorithm: z.enum(PUBLISHED_ALGORITHM_IDS).catch(DEFAULT_ALGORITHM),
});

export type RootSearch = z.infer<typeof RootSearchSchema>;

/**
 * Extends (never restates) `RootSearchSchema` — `.extend()` keeps the two
 * schemas from drifting apart on the fields they share.
 *
 * `sort`: an optional metric key. Typed only as "a string" HERE, on
 * purpose — the valid key SET for a metric key depends on the selected
 * (algorithm, season) pair (`metricKeys.ts`'s `metricKeysFor`), which this
 * static schema cannot know in isolation. `resolveSortKey` is the
 * runtime check that turns an invalid/stale key into the total-key
 * fallback; this schema's only job is making sure `sort` is a plain string
 * (or absent) before it ever reaches that check — never an object, array,
 * or other shape that could reach a downstream comparison/render in an
 * unexpected way.
 *
 * `sortDir`: an ascending/descending enum, defaulting (and falling back on
 * anything else, including a missing param) to descending.
 */
export const TeamsSearchSchema = RootSearchSchema.extend({
  sort: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).catch("desc"),
  /**
   * The Teams table's view toggle: absent = the grouped
   * Auto/Teleop/Endgame/Total default; "components" = the full
   * per-component set. URL-backed like every other shareable view choice;
   * anything unrecognized falls back to the default.
   */
  cols: z.literal("components").optional().catch(undefined),
  /**
   * The Teams page's Country/State/District filter dimensions, backing
   * `TeamsFilters`/`teamFilterModel.ts`'s `applyTeamFilters`. Plain
   * optional strings: their valid value set is data-dependent (this year's
   * distinct published regions), not a closed enum this static schema
   * could know, and a value matching no real option is not an error — it
   * is an ordinary filter that matches nothing, yielding the table's own
   * filtered-to-zero empty state rather than an undefined page state.
   *
   * These three names are safe to share with `EventsSearchSchema` — unlike
   * `sort`, which `applyYearChange` rewrites and which is exactly why the
   * Events page had to name its own field `eventSort` — because
   * `applyYearChange` touches only the literal key `sort` and passes
   * everything else through its `...current` spread untouched. That is
   * what makes a year change preserve these filters for free.
   */
  country: z.string().optional().catch(undefined),
  state: z.string().optional().catch(undefined),
  district: z.string().optional().catch(undefined),
  /**
   * Which VISUALISATION of the Teams page's already-filtered rows to draw
   * — absent (or anything unrecognized) is the table, `"bubble"` is the
   * scatter. This is NOT a second `view` field: this module's own header
   * note above says "the route segment already IS that fact" for the page
   * view itself, and `/teams` is the pathname in both modes here too.
   * `chart` answers a narrower question — which rendering of the SAME
   * filtered rows to draw.
   *
   * `applyYearChange` touches only the literal key `sort` and spreads
   * every other field on `current` through untouched, so this field
   * survives a year change with no change to that function.
   *
   * `z.literal("bubble").optional().catch(undefined)`: the field is
   * structurally incapable of holding a value other than `"bubble"` or
   * absent, so a hand-edited `?chart=` can only ever resolve to one of the
   * two declared view states before any component reads it.
   */
  chart: z.literal("bubble").optional().catch(undefined),
  /**
   * Which published rarity tier tints the Teams bubble chart's already-drawn
   * point cloud — absent (or anything unrecognized) means the Total rarity
   * tier, today's behaviour, so a URL with no `tint` is byte-identical to
   * one written before this field existed. `"sigma"` means the Sigma Score
   * rarity tier.
   *
   * `applyYearChange` touches only the literal key `sort` and spreads every
   * other field on `current` through untouched, so this field survives a
   * year change with no change to that function, exactly like `chart`.
   *
   * `z.literal("sigma").optional().catch(undefined)`: the field is
   * structurally incapable of holding a value other than `"sigma"` or
   * absent, so a hand-edited `?tint=` can only ever resolve to one of the
   * two declared colour states before any component reads it.
   */
  tint: z.literal("sigma").optional().catch(undefined),
});

export type TeamsSearch = z.infer<typeof TeamsSearchSchema>;

/**
 * The shape `applyYearChange` needs — `RootSearch` plus `sort`/`sortDir`,
 * BOTH OPTIONAL. `TeamsSearch` (required `sortDir`) satisfies this
 * structurally, but so does the bare `RootSearch` the Events/Compare
 * placeholder routes carry — the Ribbon mounts at the ROOT layout and is
 * visible on every route, so the year dropdown's change handler must work
 * whether or not the active route's own search happens to carry a
 * `sort`/`sortDir` field, without needing to know which route is active.
 */
export interface YearChangeableSearch extends RootSearch {
  sort?: string;
  sortDir?: "asc" | "desc";
}

/**
 * The ONE shared year-change handler — every year control calls this
 * rather than re-deriving the same preserve-filters-and-resolve-sort
 * logic. Preserves every existing field on `current` (filters, sort
 * direction, column state — whatever the caller's search shape carries,
 * via the `...current` spread) and re-resolves `sort` — ONLY when the
 * current route's search actually carries one — through the SAME
 * `resolveSortKey` function the algorithm-change path uses. The valid
 * metric-key set is season-dependent as well as algorithm-dependent, so a
 * plain year change can invalidate a sort just as an algorithm change can.
 *
 * EXTENSION POINT: on an event *DETAIL* page, a year change should map to
 * the SAME EVENT CODE in the target year when it exists, otherwise fall
 * back to that year's Events list. That is a PATHNAME rewrite (a different
 * route entirely), not a search-param recompute — it belongs at the
 * `navigate()` call site that owns routing, alongside a call to this
 * function, not as a second `applyYearChange`-shaped function.
 */
export function applyYearChange<S extends YearChangeableSearch>(current: S, newYear: number): S {
  return {
    ...current,
    year: newYear,
    // `teamsSortKeyUniverse`, not `metricKeysFor`: a grouped-view sort like
    // `phaseAuto` is valid across years for a grouped-capable algorithm and
    // must survive a year switch.
    sort: current.sort === undefined ? undefined : resolveSortKey(current.sort, teamsSortKeyUniverse(current.algorithm, newYear)),
  };
}

/**
 * The events list's sortable columns. Unlike `TeamsSearchSchema`'s `sort`
 * (typed as a plain string because the valid metric-key SET depends on the
 * selected algorithm/season pair), the Events page's sortable columns are
 * a small, fixed, algorithm-independent set, so validating against a
 * closed enum here is the more honest mitigation: an invalid or
 * hand-edited sort value cannot reach render logic at all.
 *
 * This list is a deliberate, small, documented mirror of
 * `apps/web/src/components/events-list/filterModel.ts`'s `EventSortKey`
 * type — kept here rather than imported so `searchParams.ts` (a `lib`
 * module) does not depend on a `components` module for a six-string
 * literal tuple. If a future plan adds or renames a sortable column, both
 * lists must be updated together.
 */
const EVENT_SORT_KEYS = ["name", "week", "startDate", "teamCount", "matchCount", "playedMatchCount"] as const;

/** Events sort by start date ascending, so two events starting the same day order deterministically. */
const DEFAULT_EVENT_SORT_KEY = "startDate";

/**
 * Extends `RootSearchSchema` with four filter dimensions plus the list's
 * own sort key/direction — the active filters and the sort are encoded in
 * the URL alongside year and algorithm.
 *
 * `eventSort`/`eventSortDir` — deliberately NOT named `sort`/`sortDir`:
 * `applyYearChange` (above) is the ONE shared year-change handler every
 * route's year control calls, including this route. Its `sort`
 * re-resolution unconditionally runs a TEAMS-specific metric-key check.
 * Events' sort values ("startDate", "week", ...) are never members of any
 * algorithm's metric-key set, so had this schema named its field `sort`,
 * every year change on `/events` would silently fall back to `TOTAL_KEY`
 * ("total") — not even a valid `EventSortKey`. `applyYearChange` only
 * touches the literal key `sort`; a differently-named field passes through
 * its `...current` spread completely untouched, so year changes on
 * `/events` correctly preserve `eventSort`/`eventSortDir`.
 *
 * `week` coerces to an integer; `country`/`state`/`district` stay plain
 * optional strings — their valid value SET is data-dependent (this year's
 * distinct values), not a closed enum this static schema could know. A
 * value that matches no real option is not an error: it reaches
 * `applyEventFilters` as an ordinary filter value that happens to match
 * nothing, yielding the Events list's own empty state rather than an
 * undefined page state.
 */
export const EventsSearchSchema = RootSearchSchema.extend({
  // week is an official-season week INDEX (stored 0-based) OR one of the
  // special tokens (preseason week-0 events, championship, offseason,
  // "other" — events whose TBA week is outside the season-week scale).
  // Enum arm first: z.coerce.number would coerce "champs" to NaN before
  // the enum ever ran.
  //
  // This list is a deliberate, documented mirror of `filterModel.ts`'s
  // `WEEK_SPECIAL_VALUES`, kept here for the same reason `EVENT_SORT_KEYS`
  // above is. If a future bucket is added, both lists must be updated
  // together.
  week: z.union([z.enum(["week0", "champs", "offseason", "other"]), z.coerce.number().int()]).optional().catch(undefined),
  country: z.string().optional().catch(undefined),
  state: z.string().optional().catch(undefined),
  district: z.string().optional().catch(undefined),
  eventSort: z.enum(EVENT_SORT_KEYS).catch(DEFAULT_EVENT_SORT_KEY),
  eventSortDir: z.enum(["asc", "desc"]).catch("asc"),
});

/**
 * The team page's two tabs — Overview and Metric History. `?tab=` is the
 * shareable, back/forward-navigable URL state; the default (absent or
 * malformed) resolves to Overview via `.catch()`, same discipline every
 * other field on this schema already follows.
 */
export const TEAM_TABS = ["overview", "history"] as const;

/**
 * Extends `RootSearchSchema` with exactly one field, `tab` — the team page
 * has no sortable table, so `sort`/`sortDir` are deliberately NOT extended
 * in here (unlike `TeamsSearchSchema`).
 */
export const TeamSearchSchema = RootSearchSchema.extend({
  tab: z.enum(TEAM_TABS).catch("overview"),
});

export type TeamSearch = z.infer<typeof TeamSearchSchema>;

/**
 * The event page's six tab ids, in the fixed order the tab strip renders:
 * Insights, Breakdown, Quals, Alliances, Elims, Simulation. The route's own
 * `REGISTERED_EVENT_TABS` array is the narrower, currently-registered
 * subset (has a trigger and a content panel) — keeping this URL contract
 * stable means a later plan registering a new tab is a no-op here; only
 * `REGISTERED_EVENT_TABS` in the route grows.
 *
 * `simulation` is a THIRD kind of state this tuple did not previously have
 * to describe: an id can be a member of this tuple, registered in the
 * route (has a trigger and a panel), and STILL not reachable — an
 * algorithm-conditional rule plain-disables the Simulation trigger on some
 * algorithms. That reachability rule lives in the route
 * (`event.$eventKey.tsx`), not here.
 */
export const EVENT_TABS = ["insights", "breakdown", "quals", "alliances", "elims", "simulation"] as const;

/**
 * The event page's default tab — Insights, the event's landing tab. This
 * constant names which tab is ACTIVE on arrival, never where a tab sits in
 * the strip — `EVENT_TABS`'s declared order above is unrelated and
 * unchanged by this value. The route (`event.$eventKey.tsx`) narrows this
 * against its own `REGISTERED_EVENT_TABS` array, so this constant may only
 * ever hold an id that has a registered trigger and content panel.
 */
export const DEFAULT_EVENT_TAB = "insights";

/**
 * Extends `RootSearchSchema` with exactly one field, `tab` — mirroring
 * `TeamSearchSchema` exactly. Neither Insights nor Breakdown exposes a
 * clickable-to-resort header, so there is no sort state to carry:
 * `sort`/`sortDir` are deliberately NOT extended in here.
 */
export const EventSearchSchema = RootSearchSchema.extend({
  tab: z.enum(EVENT_TABS).catch(DEFAULT_EVENT_TAB),
});

export type EventTab = (typeof EVENT_TABS)[number];

/**
 * The Locks page's two tabs, in the fixed order the page's own tab strip
 * renders: Road to District Champs, Champ Locks. A stale `?tab=` for a
 * since-removed tab is not a special case: `z.enum().catch()` below already
 * falls any unrecognized id back to `DEFAULT_DISTRICT_TAB`.
 *
 * THE FIRST TAB'S ID WAS RENAMED FROM `district-locks` IN PHASE 10, AND THE
 * RENAME COSTS NO SHARED LINK. The renamed tab IS `DEFAULT_DISTRICT_TAB`, and
 * the `.catch()` below falls any unrecognised id back to exactly that, so every
 * pre-rename link carrying `?tab=district-locks` lands on the same panel it
 * always did. The only alternative was keeping an id named after a removed
 * concept, which would leave the URL asserting a vocabulary the page no longer
 * uses.
 */
export const DISTRICT_TABS = ["road-to-district-champs", "champ-locks"] as const;

/** The Locks page's default tab — Road to District Champs, the page's landing tab. */
export const DEFAULT_DISTRICT_TAB = "road-to-district-champs";

/**
 * Extends `RootSearchSchema` with `district` (the selected TBA
 * year-prefixed district key, e.g. `"2026fnc"` — optional, since
 * `/districts` with no selection is a real, valid state) and `tab`,
 * mirroring `EventSearchSchema`'s `tab` field exactly. Both are URL state
 * so a district-and-tab view is shareable, exactly as `?tab=` already is
 * on the event and team pages.
 */
export const DistrictsSearchSchema = RootSearchSchema.extend({
  /**
   * The selected district's TBA key. VALIDATED AT THIS BOUNDARY against the
   * same shape the Worker validates it with (phase 10 review, WR-10).
   *
   * Unlike the three data-dependent fields below, this one HAS a knowable
   * static shape: `DISTRICT_KEY_PATTERN` from `packages/core/districts/keys.ts`
   * — the one declaration both halves of this repo import, so the browser and
   * `apps/worker/src/districtRefresh.ts` cannot drift apart on what a district
   * key is.
   *
   * WHY IT MATTERS. This value flows to `districtDetailKey(districtKey)` and
   * `districtPreSimKey`, and from there into `v1/district/${districtKey}.json`
   * and a `fetch` URL — a path segment, unencoded. The impact was bounded (the
   * artifact origin is a compile-time constant, React escapes the value where
   * it renders, and the response is Zod-parsed), which is why the review filed
   * it as a warning rather than a critical. It was still an asymmetry: the
   * Worker refused a malformed key before it could become an R2 key and the
   * browser did not.
   *
   * `.catch(undefined)` rather than a validation error, matching every other
   * field in this file: a hand-edited or malformed key resolves to "no
   * district selected", which renders the page's own "Pick a district" empty
   * state. The detail fetch is gated on `effectiveDistrict !== undefined`
   * (`routes/districts.tsx`), so a rejected value never reaches a key builder
   * or a fetch at all.
   */
  district: z.string().regex(DISTRICT_KEY_PATTERN).optional().catch(undefined),
  tab: z.enum(DISTRICT_TABS).catch(DEFAULT_DISTRICT_TAB),
  /**
   * The Road to District Champs tab's Rewind position — a timeline STEP ID.
   *
   * Typed as a plain optional string with a `.catch()`, for exactly the reason
   * `TeamsSearchSchema`'s `sort` field gives: the valid value SET is
   * data-dependent (it is built from this district's own loaded match
   * schedules), so a static schema cannot know it, and
   * `resolveDistrictTimelinePosition` is the runtime check. This schema's only
   * job is making sure the value is a plain string (or absent) before it ever
   * reaches that resolver — never an object or array that could reach a
   * downstream comparison in an unexpected way. An unrecognised id resolves to
   * the "now" position, never to a neighbouring step.
   *
   * `applyYearChange` rewrites only the literal key `sort` and spreads
   * everything else through untouched, so this field (and the two below)
   * survive a year change with no change to that function — which is exactly
   * why `EventsSearchSchema` had to rename ITS sort fields and these three do
   * not.
   */
  at: z.string().optional().catch(undefined),
  /** The drawer's team number. Coerced, so a hand-edited non-numeric value resolves to absent (no drawer) rather than to an undefined page state. */
  drawerTeam: z.coerce.number().int().optional().catch(undefined),
  /** The drawer's cell id. A plain optional string for the same data-dependent reason `at` states; an unrecognised id resolves to CLOSED, never to a neighbouring cell. */
  drawerCell: z.string().optional().catch(undefined),
});

export type DistrictTab = (typeof DISTRICT_TABS)[number];

/**
 * The match page's search schema — extends `RootSearchSchema` with NO
 * additional fields. There is no `tab` here: the match page has no tabs,
 * unlike the event and team pages.
 *
 * `year` is carried only so the root ribbon's year dropdown keeps working —
 * every other page on this site reads `year` for data, but the match page's
 * own season comes from the match key's embedded event key
 * (`eventKeyFromMatchKey` + `seasonFromEventKey`, `lib/matchKey.ts` /
 * `lib/eventKey.ts`), never from this search param. A hand-edited `?year=`
 * therefore cannot produce a mismatched render — it changes what the ribbon's
 * dropdown shows, never what artifact this page fetches or which season's
 * column set it renders.
 */
export const MatchSearchSchema = RootSearchSchema;
