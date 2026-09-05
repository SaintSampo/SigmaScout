/**
 * The single source of truth for what the URL carries (D-14, NAV-05). Every
 * field either coerces to a known-valid value or is structurally impossible
 * to construct outside its own declared valid states — a hand-edited or
 * malformed search param can therefore only ever resolve to one of this
 * schema's own declared states before any component reads it (T-05-02).
 *
 * Per D-14 the URL carries year, algorithm, sort field and sort direction;
 * the CURRENT VIEW is the pathname itself (`/teams`, `/events`, `/compare`)
 * — it needs no search param of its own. Do not add a `view` field here: the
 * route segment already IS that fact, and a redundant `view` param would be
 * a second, driftable source of the same information.
 */
import { z } from "zod";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../packages/harness/publishedAlgorithms.js";
import { CURRENT_SEASON, SEASONS } from "./seasons.js";
import { teamsSortKeyUniverse } from "./metricKeys.js";
import { resolveSortKey } from "./resolveSortKey.js";

const KNOWN_SEASONS = new Set<number>(SEASONS);

/**
 * The default algorithm every route without an explicit `?algorithm=`
 * resolves to. VPR (D-04's name for this project's own headline algorithm,
 * renamed from Sigma1) rather than OPR/EPA, matching 05-RESEARCH.md Pattern
 * 1's example schema.
 *
 * D-04/D-05 (plan 07-18, the cutover): this value moved here from `sigma1` [pre-rename]
 * once 07-17's write pass made the `vpr@` objects live in R2 —
 * the deployed browser now requests what the publisher and the Worker have
 * written since plan 07-16. An already-shared link carrying the retired
 * `sigma1` [pre-rename] id is not a dead link: it is no longer a member of
 * `PUBLISHED_ALGORITHM_IDS`, so the `z.enum(...).catch(DEFAULT_ALGORITHM)`
 * expression below falls through to this value rather than failing — D-05's
 * own safety argument for why the rename reaches the algorithm id at all.
 */
const DEFAULT_ALGORITHM: PublishedAlgorithmId = "vpr";

/**
 * `year`: coerced to an integer and constrained to the known season list
 * (`seasons.ts`'s `SEASONS`) — anything else, INCLUDING a missing param
 * (`z.coerce.number()` on `undefined` produces `NaN`, which fails both the
 * base number check and the refinement below), falls back to
 * `CURRENT_SEASON` via `.catch()`.
 *
 * `algorithm`: an enum over the published algorithm ids
 * (`packages/harness/publishedAlgorithms.ts`'s `PUBLISHED_ALGORITHM_IDS` —
 * the single algorithm-id constant again as of plan 07-18's collapse; 07-16's
 * transitional publisher/Worker-write tier existed only through waves 11-12
 * and no longer exists), the same build-time constant the algorithm dropdown
 * renders from before any manifest fetch resolves) — anything outside that
 * closed set, including a missing param or the retired pre-rename id, falls
 * back to `DEFAULT_ALGORITHM` via `.catch()`.
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
 * static schema cannot know in isolation. `resolveSortKey` (Task 1) is the
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
   * The Teams table's view toggle (2026-09-01 redesign, decision T1):
   * absent = the grouped Auto/Teleop/Endgame/Total default; "components" =
   * the full per-component set. URL-backed like every other shareable view
   * choice; anything unrecognized falls back to the default.
   */
  cols: z.literal("components").optional().catch(undefined),
});

export type TeamsSearch = z.infer<typeof TeamsSearchSchema>;

/**
 * The shape `applyYearChange` needs — `RootSearch` plus `sort`/`sortDir`,
 * BOTH OPTIONAL. `TeamsSearch` (required `sortDir`) satisfies this
 * structurally, but so does the bare `RootSearch` the Events/Compare
 * placeholder routes carry (Task 2) — the Ribbon (Task 3) mounts at the
 * ROOT layout and is visible on every route, so the year dropdown's change
 * handler must work whether or not the active route's own search happens to
 * carry a `sort`/`sortDir` field, without needing to know which route is
 * active.
 */
export interface YearChangeableSearch extends RootSearch {
  sort?: string;
  sortDir?: "asc" | "desc";
}

/**
 * The ONE shared year-change handler (D-11) — every year control (this
 * plan's `YearSelect.tsx`, and any later plan's own year control) calls
 * this rather than re-deriving the same preserve-filters-and-resolve-sort
 * logic. Preserves every existing field on `current` (filters, sort
 * direction, column state — whatever the caller's search shape carries, via
 * the `...current` spread) and re-resolves `sort` — ONLY when the current
 * route's search actually carries one — through the SAME `resolveSortKey`
 * function the algorithm-change path uses (Task 1's own "one function, both
 * triggers" contract). The valid metric-key set is season-dependent as well
 * as algorithm-dependent, so a plain year change can invalidate a sort just
 * as an algorithm change can.
 *
 * D-12 EXTENSION POINT (Phase 7, out of this plan's scope): on an event
 * *DETAIL* page, a year change should map to the SAME EVENT CODE in the
 * target year when it exists, otherwise fall back to that year's Events
 * list. That is a PATHNAME rewrite (a different route entirely), not a
 * search-param recompute — it belongs at the `navigate()` call site that
 * owns routing, alongside a call to this function, not as a second
 * `applyYearChange`-shaped function. Phase 7 extends the call site, not
 * this contract.
 */
export function applyYearChange<S extends YearChangeableSearch>(current: S, newYear: number): S {
  return {
    ...current,
    year: newYear,
    // `teamsSortKeyUniverse`, not `metricKeysFor` (2026-09-01 redesign): a
    // grouped-view sort like `phaseAuto` is valid across years for a
    // grouped-capable algorithm and must survive a year switch.
    sort: current.sort === undefined ? undefined : resolveSortKey(current.sort, teamsSortKeyUniverse(current.algorithm, newYear)),
  };
}

/**
 * The events list's sortable columns — 05-07-PLAN.md Task 3. Unlike
 * `TeamsSearchSchema`'s `sort` (typed as a plain string because the valid
 * metric-key SET depends on the selected algorithm/season pair), the
 * Events page's sortable columns are a small, fixed, algorithm-independent
 * set, so validating against a closed enum here is the more honest
 * T-05-02 mitigation: an invalid or hand-edited sort value cannot reach
 * render logic at all, it falls back to the default via `.catch()`.
 *
 * This list is a deliberate, small, documented mirror of
 * `apps/web/src/components/events-list/filterModel.ts`'s `EventSortKey`
 * type — kept here rather than imported so `searchParams.ts` (a `lib`
 * module) does not depend on a `components` module for a six-string
 * literal tuple. If a future plan adds or renames a sortable column, both
 * lists must be updated together.
 */
const EVENT_SORT_KEYS = ["name", "week", "startDate", "teamCount", "matchCount", "playedMatchCount"] as const;

/** EVNT-01's default sort — "Events sort by start date ascending... so two events starting the same day order deterministically." */
const DEFAULT_EVENT_SORT_KEY = "startDate";

/**
 * Extends `RootSearchSchema` with EVNT-01's four filter dimensions plus the
 * list's own sort key/direction (D-14: "the active filters and the sort are
 * encoded in the URL alongside year and algorithm").
 *
 * `eventSort`/`eventSortDir` — deliberately NOT named `sort`/`sortDir`
 * (Rule 1 bug fix, found running this task): `applyYearChange` (above) is
 * the ONE shared D-11 year-change handler every route's year control calls,
 * including this route (`YearSelect.tsx` is mounted once at the root layout
 * and reads/writes via `YearChangeableSearch`, which is structurally
 * satisfied by ANY search object carrying an optional `sort`/`sortDir`
 * field). Its `sort` re-resolution unconditionally runs
 * `resolveSortKey(current.sort, metricKeysFor(current.algorithm, newYear))`
 * — a TEAMS-specific metric-key check. Events' sort values ("startDate",
 * "week", ...) are never members of any algorithm's metric-key set, so had
 * this schema named its field `sort`, every year change on `/events` would
 * silently fall back through to `TOTAL_KEY` ("total") — not even a valid
 * `EventSortKey` — defeating this plan's own must-have truth ("a year
 * change preserves the active filters and the sort"). `applyYearChange`
 * only touches the literal key `sort`; a differently-named field passes
 * through its `...current` spread completely untouched, so year changes on
 * `/events` correctly preserve `eventSort`/`eventSortDir` with zero changes
 * needed to the shared function or to `YearSelect.tsx`.
 *
 * `week` coerces to an integer; `country`/`state`/`district` stay plain
 * optional strings — their valid value SET is data-dependent (this year's
 * distinct values, per `filterModel.ts`'s `filterOptions`), not a closed
 * enum this static schema could know. A value that matches no real option
 * is not an error (T-05-02): it reaches `applyEventFilters` as an ordinary
 * filter value that happens to match nothing, yielding the Events list's
 * own empty state rather than an undefined page state.
 */
export const EventsSearchSchema = RootSearchSchema.extend({
  // 2026-09-01: week is an official-season week INDEX (stored 0-based) OR one
  // of the special tokens (preseason week-0 events, championship, offseason,
  // and since WR-01 "other" — events whose TBA week is outside the season-week
  // scale). Enum arm first: z.coerce.number would coerce "champs" to NaN
  // before the enum ever ran.
  //
  // This list is a deliberate, documented mirror of `filterModel.ts`'s
  // `WEEK_SPECIAL_VALUES`, kept here for the same reason `EVENT_SORT_KEYS`
  // above is: `searchParams.ts` is a `lib` module and does not import from
  // `components` for a literal tuple. IN-03 named the drift risk and WR-01
  // then realised it — adding "other" required editing both. If a future
  // bucket is added, both lists must be updated together.
  week: z.union([z.enum(["week0", "champs", "offseason", "other"]), z.coerce.number().int()]).optional().catch(undefined),
  country: z.string().optional().catch(undefined),
  state: z.string().optional().catch(undefined),
  district: z.string().optional().catch(undefined),
  eventSort: z.enum(EVENT_SORT_KEYS).catch(DEFAULT_EVENT_SORT_KEY),
  eventSortDir: z.enum(["asc", "desc"]).catch("asc"),
});

export type EventsSearch = z.infer<typeof EventsSearchSchema>;

/**
 * The team page's two tabs (D-16, 06-CONTEXT.md) — Overview and Metric
 * History. `?tab=` is the shareable, back/forward-navigable URL state; the
 * default (absent or malformed) resolves to Overview via `.catch()`, same
 * T-06-01 discipline every other field on this schema already follows.
 */
export const TEAM_TABS = ["overview", "history"] as const;

/**
 * Extends `RootSearchSchema` with exactly one field, `tab` — per D-16, the
 * team page has no sortable table, so `sort`/`sortDir` are deliberately NOT
 * extended in here (unlike `TeamsSearchSchema`).
 */
export const TeamSearchSchema = RootSearchSchema.extend({
  tab: z.enum(TEAM_TABS).catch("overview"),
});

export type TeamSearch = z.infer<typeof TeamSearchSchema>;

/**
 * The event page's six tab ids (07-01-PLAN.md Task 1; grown to six by
 * 08-09-PLAN.md Task 1, EVNT-07/D-04), in the fixed order 07-UI-SPEC.md's E2
 * populated row and its Copywriting Contract's Tab-labels row both state:
 * Insights, Breakdown, Quals, Alliances, Elims, Simulation. This enum stays
 * over all six ids for the whole phase even though only `breakdown` was
 * REGISTERED (had a trigger and a content panel) by 07-01 — the route's own
 * `REGISTERED_EVENT_TABS` array is the narrower, per-wave subset. Keeping the
 * URL contract stable across each phase means every later plan's own
 * `searchParams.ts` edit is a no-op here; only `REGISTERED_EVENT_TABS` in the
 * route grows.
 *
 * `simulation` (08-09) is a THIRD kind of state this tuple did not previously
 * have to describe: an id can be a member of this tuple, registered in the
 * route (has a trigger and a panel), and STILL not reachable — D-04's
 * VPR-only rule plain-disables the Simulation trigger on OPR/EPA. That
 * reachability rule lives in the route (`event.$eventKey.tsx`), not here, so
 * a reader looking for an algorithm condition should look there.
 */
export const EVENT_TABS = ["insights", "breakdown", "quals", "alliances", "elims", "simulation"] as const;

/**
 * The event page's default tab — Insights, the event's landing tab per
 * 07-UI-SPEC.md's E2 populated row (plan 07-18 Task 2). This constant names
 * which tab is ACTIVE on arrival, never where a tab sits in the strip —
 * `EVENT_TABS`'s declared order above is unrelated and unchanged by this
 * value. The route (`event.$eventKey.tsx`) narrows this against its own
 * `REGISTERED_EVENT_TABS` array, so this constant may only ever hold an id
 * that has a registered trigger and content panel; it held `breakdown`
 * (07-01-PLAN.md's objective, the only tab whose full contract rendered from
 * published fields at that point in the phase) until Insights existed and
 * every tab was registered.
 */
export const DEFAULT_EVENT_TAB = "insights";

/**
 * Extends `RootSearchSchema` with exactly one field, `tab` — mirroring
 * `TeamSearchSchema` exactly. Neither Insights nor Breakdown exposes a
 * clickable-to-resort header this phase (07-UI-SPEC.md's Accent section), so
 * there is no sort state to carry: `sort`/`sortDir` are deliberately NOT
 * extended in here.
 */
export const EventSearchSchema = RootSearchSchema.extend({
  tab: z.enum(EVENT_TABS).catch(DEFAULT_EVENT_TAB),
});

export type EventSearch = z.infer<typeof EventSearchSchema>;
export type EventTab = (typeof EVENT_TABS)[number];

/**
 * The Districts page's four tabs (quick task 260905-lic Task 3), in the
 * fixed order the page's own tab strip renders: Insights, Breakdown,
 * District Locks, Champ Locks. Unlike `EVENT_TABS`'s per-wave narrowing
 * (`REGISTERED_EVENT_TABS`), this quick task ships all four tabs in one
 * task, so there is no partial-registration state a narrower array would
 * need to guard against — the route's own `REGISTERED_DISTRICT_TABS` still
 * exists (mirroring the event page's shape) but is simply the full set.
 */
export const DISTRICT_TABS = ["insights", "breakdown", "district-locks", "champ-locks"] as const;

/** The Districts page's default tab — Insights, the page's landing tab. */
export const DEFAULT_DISTRICT_TAB = "insights";

/**
 * Extends `RootSearchSchema` with `district` (the selected TBA year-prefixed
 * district key, e.g. `"2026fnc"` — optional, since `/districts` with no
 * selection is a real, valid state per this plan's must-have truth) and
 * `tab`, mirroring `EventSearchSchema`'s `tab` field exactly. Both are URL
 * state so a district-and-tab view is shareable, exactly as `?tab=` already
 * is on the event and team pages.
 */
export const DistrictsSearchSchema = RootSearchSchema.extend({
  district: z.string().optional(),
  tab: z.enum(DISTRICT_TABS).catch(DEFAULT_DISTRICT_TAB),
});

export type DistrictsSearch = z.infer<typeof DistrictsSearchSchema>;
export type DistrictTab = (typeof DISTRICT_TABS)[number];
