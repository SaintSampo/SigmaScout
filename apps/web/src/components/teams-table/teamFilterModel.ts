/**
 * Quick task 260905-ttv: pure option-list derivation and the filter predicate
 * for the Teams page's Country/State/District dropdowns. Imports no React —
 * mirrors `events-list/filterModel.ts`'s shape (`teamFilterOptions` /
 * `applyTeamFilters` are this module's `filterOptions` / `applyEventFilters`)
 * so the two pages' filter mechanics read as one convention across the site.
 *
 * The null-vs-Unknown rule `filterModel.ts` already states carries over here
 * with one real difference, named rather than left for a reader to infer: an
 * EVENT's geo fields are NULLABLE (`null` means "TBA published no value" —
 * the field genuinely exists on every row, sometimes empty). A TEAM's region
 * fields are OPTIONAL (absent means "not derivable from where this team
 * competed this season" — `packages/harness/teamRanks.ts`'s `deriveTeamRegions`
 * — or "this artifact predates the field existing" — a pre-republish
 * artifact, quick task 260905-ttv's own `<post_plan_note>`). Both resolve to
 * the identical filtering behavior below: a row with no value on a dimension
 * can never match a set filter on it. Also worth restating plainly: these
 * values are INFERRED from the events a team attended, never a team's
 * registered address — the same honesty note `deriveTeamRegions` itself
 * carries.
 *
 * Deliberately does NOT import from `events-list/` — the same cross-module
 * boundary `SeasonHeader.tsx` already refuses to cross (it copies
 * `formatRecord` rather than importing it from `teams-table/`). The
 * two-letter-state-code filter below is copied from `filterModel.ts`'s own
 * rule for the identical reason that file already gives: TBA's `state_prov`
 * mixes real codes with numerics and long region names.
 */
import type { TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { isRealTeamKey } from "../../lib/teamKey.js";

/** One row from the published `teams/{year}` artifact — reached through `TeamsArtifact` since the row schema itself is module-private. */
export type TeamFilterRow = TeamsArtifact["teams"][number];

/** The three filterable region dimensions, each optional — an unset dimension does not filter. */
export interface TeamFilters {
  country?: string;
  state?: string;
  district?: string;
}

/** The three dimensions' distinct-value option lists, each excluding absent values and sorted alphabetically for stable display. */
export interface TeamFilterOptionLists {
  countries: string[];
  states: string[];
  districts: string[];
}

/**
 * Returns, per dimension, the distinct values present in `rows`, sorted with
 * `localeCompare`. A dimension where no row carries a value yields an EMPTY
 * list — the signal the control uses to render itself disabled. A
 * pre-republish artifact (no region fields on any row) therefore yields
 * three empty lists, matching this task's own must-have truth.
 *
 * Only rows whose `teamKey` passes `isRealTeamKey` contribute options,
 * matching the pool every other ranking surface on this site already uses
 * (the Teams table itself, and the pipeline's own rank-scope pools).
 */
export function teamFilterOptions(rows: readonly TeamFilterRow[]): TeamFilterOptionLists {
  const countries = new Set<string>();
  const states = new Set<string>();
  const districts = new Set<string>();

  for (const row of rows) {
    if (!isRealTeamKey(row.teamKey)) continue;
    if (row.country !== undefined) countries.add(row.country);
    // Copied from `events-list/filterModel.ts`'s identical rule (see this
    // file's own header comment): TBA's state_prov mixes real two-letter
    // codes with numerics and longer region names. A value dropped here
    // stays reachable through its country.
    if (row.stateProv !== undefined && /^[A-Za-z]{2}$/.test(row.stateProv)) states.add(row.stateProv);
    if (row.districtKey !== undefined) districts.add(row.districtKey);
  }

  return {
    countries: Array.from(countries).sort((a, b) => a.localeCompare(b)),
    states: Array.from(states).sort((a, b) => a.localeCompare(b)),
    districts: Array.from(districts).sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Returns the intersection of `rows` over whichever dimensions of `filters`
 * are set. Each set dimension is strict equality; a row whose value on that
 * dimension is absent can never match a set filter (absence is never
 * coerced into a bucket a filter could match). A filter value matching
 * nothing yields an empty array, not an error.
 */
export function applyTeamFilters(rows: readonly TeamFilterRow[], filters: TeamFilters): TeamFilterRow[] {
  return rows.filter((row) => {
    if (filters.country !== undefined && row.country !== filters.country) return false;
    if (filters.state !== undefined && row.stateProv !== filters.state) return false;
    if (filters.district !== undefined && row.districtKey !== filters.district) return false;
    return true;
  });
}
