/**
 * Pure option-list derivation, the filter predicate, and the deterministic
 * sort for the Events page (EVNT-01, 05-07-PLAN.md Task 1). Imports no
 * React — these three functions operate purely over the published
 * `EventsListRowSchema` rows and are independently testable from any
 * component that renders them.
 *
 * The null-vs-Unknown rule, written once: an event with no district is not
 * an event in a district called Unknown. `country`, `stateProv` and
 * `districtKey` are genuinely nullable in the published artifact (plan
 * 05-02) — offseason and preseason events legitimately have no week, and
 * most events have no district. Coercing a null into a placeholder bucket
 * would put a filter option in the list that answers a question the data
 * cannot answer. `filterOptions` therefore excludes null entirely from
 * every option list, and `applyEventFilters` follows directly: a filter can
 * never match an event whose value on that dimension is null, because no
 * filter value is ever offered that could equal null.
 */
import type { EventsArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/** One row from the published `events/{year}` artifact — `EventsListRowSchema`'s inferred shape, reached through the exported `EventsArtifact` type since the row schema itself is module-private. */
export type EventRow = EventsArtifact["events"][number];

/** The week dimension's special (non-numeric) values (2026-09-01 user request): preseason "Week 0" events (eventType 100 — real events after Jan 1, not part of the official season), Championship divisions/Einstein (eventType 3/4), and offseason. */
export const WEEK_SPECIAL_VALUES = ["week0", "champs", "offseason"] as const;
export type WeekFilterValue = number | (typeof WEEK_SPECIAL_VALUES)[number];

/** The four filterable dimensions' distinct-value option lists, each excluding null and sorted for stable display. */
export interface EventFilterOptionLists {
  weeks: WeekFilterValue[];
  countries: string[];
  states: string[];
  districts: string[];
}

/**
 * Returns, per dimension, the distinct non-null values present in `events`,
 * sorted for stable display (weeks numerically, the rest alphabetically).
 * A dimension where every event's value is null yields an empty list — the
 * signal the control uses to render itself disabled rather than hidden.
 */
export function filterOptions(events: readonly EventRow[]): EventFilterOptionLists {
  const weeks = new Set<number>();
  let hasWeek0 = false;
  let hasChamps = false;
  let hasOffseason = false;
  const countries = new Set<string>();
  const states = new Set<string>();
  const districts = new Set<string>();

  for (const event of events) {
    if (event.isOffseason) hasOffseason = true;
    else if (event.eventType === 3 || event.eventType === 4) hasChamps = true;
    else if (event.eventType === 100) hasWeek0 = true;
    else if (event.week !== null) weeks.add(event.week);
    if (event.country !== null) countries.add(event.country);
    // 2026-09-01: TBA state_prov carries junk alongside real regions —
    // pure numerics ("06", "34") and single letters ("M") were rendering as
    // filter options. Values of 2+ letters (any script) stay, including
    // international regions ("NSW", "HaMerkaz"); an event whose state was
    // dropped here remains reachable through its country filter.
    // 2026-09-01 (round 2): TBA's state_prov mixes real state/province codes
    // with numerics ("06", "34") and longer region names ("Daan District",
    // "HaMerkaz", "COA") the user asked out of the STATE dropdown. Keep
    // exactly the two-letter alpha codes (US states + CA provinces and
    // peers); everything else stays reachable through the country filter.
    if (event.stateProv !== null && /^[A-Za-z]{2}$/.test(event.stateProv)) states.add(event.stateProv);
    if (event.districtKey !== null) districts.add(event.districtKey);
  }

  return {
    weeks: [...(hasWeek0 ? ["week0" as const] : []), ...Array.from(weeks).sort((a, b) => a - b), ...(hasChamps ? ["champs" as const] : []), ...(hasOffseason ? ["offseason" as const] : [])],
    countries: Array.from(countries).sort((a, b) => a.localeCompare(b)),
    states: Array.from(states).sort((a, b) => a.localeCompare(b)),
    districts: Array.from(districts).sort((a, b) => a.localeCompare(b)),
  };
}

/** The four filter dimensions, each optional — an unset dimension does not filter. */
export interface EventFilters {
  week?: WeekFilterValue;
  country?: string;
  state?: string;
  district?: string;
}

/**
 * Returns the intersection of `events` over whichever dimensions of
 * `filters` are set. Week matching is exact equality on the integer, never
 * a range. Because `filterOptions` never offers a null value as an option,
 * a strict-equality comparison against a set filter value automatically
 * excludes any event whose own value on that dimension is null (`null !==
 * anyFilterValue` is always true) — the exclusion rule falls directly out
 * of the comparison rather than needing a separate null check.
 */
/** One event's membership in one week-filter value. A NUMERIC week means an official in-season week — offseason/preseason rows that happen to carry a week index are excluded from it, since they have their own filter values. */
export function weekMatches(event: EventRow, week: WeekFilterValue): boolean {
  if (week === "offseason") return event.isOffseason;
  if (week === "champs") return event.eventType === 3 || event.eventType === 4;
  if (week === "week0") return event.eventType === 100;
  return event.week === week && !event.isOffseason && event.eventType !== 100;
}

export function applyEventFilters(events: readonly EventRow[], filters: EventFilters): EventRow[] {
  return events.filter((event) => {
    if (filters.week !== undefined && !weekMatches(event, filters.week)) return false;
    if (filters.country !== undefined && event.country !== filters.country) return false;
    if (filters.state !== undefined && event.stateProv !== filters.state) return false;
    if (filters.district !== undefined && event.districtKey !== filters.district) return false;
    return true;
  });
}

/** The columns `sortEvents` can order by. */
export type EventSortKey = "name" | "week" | "startDate" | "teamCount" | "matchCount" | "playedMatchCount";
export type EventSortDirection = "asc" | "desc";

/** A null value (only reachable via `week`) always sorts after every non-null value, independent of `direction` — there is no meaningful "greater/less than" comparison against an event that has no week. */
function compareSortValues(a: number | string | null, b: number | string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Sorts `events` by `key` in `direction`, breaking ties by ascending event
 * key so the order is total and stable across reloads without relying on
 * the engine's own sort stability. Never mutates its input.
 */
export function sortEvents(events: readonly EventRow[], key: EventSortKey, direction: EventSortDirection): EventRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...events].sort((a, b) => {
    const primary = compareSortValues(a[key], b[key]);
    if (primary !== 0) return sign * primary;
    return a.eventKey.localeCompare(b.eventKey);
  });
}
