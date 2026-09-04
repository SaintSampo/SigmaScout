/**
 * The Compare artifact fetcher: artifactKey -> fetch -> Zod parse -> typed
 * result. Mirrors `apps/web/src/lib/api/events.ts`/`event.ts` in shape, with
 * one deliberate divergence: `FetchCompareArtifactParams` carries ONLY
 * `year`. `ArtifactKeyParams`'s `ComparePageParams` member has no
 * `algorithmId`/`version` field at all — `v1/compare/{year}.json` is the
 * single published key with no algorithm segment and no version segment
 * (`packages/harness/pageArtifacts.ts`'s own doc comment on `ComparePageParams`:
 * "the deliberate exception with no algorithm segment"). That is why this
 * fetcher, alone among the site's five, needs no `useAlgorithmVersion`
 * resolution and no `enabled` gate on an unresolved manifest version — there
 * is no version to wait for. Do not add one back by symmetry with the other
 * four fetchers; 08-CONTEXT.md's own "Claude's Discretion" section and
 * 08-01-PLAN.md's Flagged Planner Assumption 4 record this asymmetry as
 * deliberate, not an oversight.
 *
 * Import depth matches `events.ts`/`event.ts`'s corrected, verified depth:
 * from `apps/web/src/lib/api/`, the repo root is FIVE levels up. No
 * `@sigmascout/*` workspace alias exists anywhere in this repo.
 */
import { artifactKey, CompareArtifactSchema, type CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { markArtifactParsed } from "../perfMarks.js";
import { SEASONS } from "../seasons.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

export interface FetchCompareArtifactParams {
  year: number;
}

/**
 * The three `CompareSliceSchema.compLevelView` values, named here so the
 * route and `AccuracyTable` share one type rather than each restating the
 * literal union. `CompareSliceSchema` itself is not exported from
 * `pageArtifacts.ts`, so this is derived off the exported `CompareArtifact`
 * type — never a second hand-typed literal union that could drift from the
 * schema.
 */
export type CompareCompLevelView = CompareArtifact["slices"][number]["compLevelView"];

/**
 * `SEASONS` (`lib/seasons.ts`) is STILL the one source of "which seasons
 * exist" in this codebase — this is a documented NARROWING of it, never a
 * second hand-typed year array. Since quick task 260904-nt4, `SEASONS` also
 * carries 2019 and 2020 (the gapped seven-season corpus), and neither may
 * enter Compare.
 *
 * The floor exists because a Compare row must be able to become
 * headline-eligible, which under the provenance-aware rule
 * (`packages/harness/score.ts`, quick task 260903-n2o) requires at least two
 * prior corpus seasons AND absence from the algorithm's own selected-on set.
 * 2019 has zero prior corpus seasons and 2020 has only a thin 2019 prior, so
 * both are selection-only seasons FOREVER (D-4/D-5) — no future republish
 * changes this, because their prior-season count can only grow if the corpus
 * is extended even further backward, and there is no earlier season to add.
 * `v1/compare/2019.json` and `v1/compare/2020.json` ARE published by
 * `publishSeasons` (one slice per season in the run) and simply never
 * fetched — this floor is what stops the page rendering a
 * permanently-ineligible empty row, not a gap in what gets published.
 *
 * `COMPARE_SEASONS` is `SEASONS` filtered to `>= COMPARE_FIRST_SEASON` and
 * sorted ASCENDING (`Year` column order, top-to-bottom 2022-2026); `SEASONS`
 * itself is DESCENDING by design (the year dropdown's default selection is
 * first).
 */
export const COMPARE_FIRST_SEASON = 2022;

export const COMPARE_SEASONS: readonly number[] = [...SEASONS].filter((season) => season >= COMPARE_FIRST_SEASON).sort((a, b) => a - b);

export async function fetchCompareArtifact({ year }: FetchCompareArtifactParams): Promise<CompareArtifact> {
  const key = artifactKey({ page: "compare", year });
  const res = await fetch(artifactUrl(key));
  if (!res.ok) {
    throw new ArtifactFetchError("comparison data", year, res.status);
  }
  const body: unknown = await res.json();
  try {
    const parsed = CompareArtifactSchema.parse(body);
    // Same parse-to-paint convention as every other fetcher in this
    // directory — marked immediately after the schema parse resolves.
    markArtifactParsed();
    return parsed;
  } catch (err) {
    throw new ArtifactValidationError("comparison data", year, err);
  }
}

export function compareQueryOptions(params: FetchCompareArtifactParams) {
  return {
    queryKey: ["compare", params.year] as const,
    queryFn: () => fetchCompareArtifact(params),
  };
}
