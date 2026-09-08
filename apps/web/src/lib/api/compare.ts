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
 * exist" in this codebase — this is the seam where Compare's own set may
 * narrow it, never a second hand-typed year array.
 *
 * **The floor moved 2022 -> 2016 on 2026-09-07 (user request), because the
 * reason it sat at 2022 stopped being true.** The retired rationale is worth
 * stating exactly, since it was wrong in an instructive way: it argued that
 * 2019 and 2020 were selection-only "FOREVER", on the explicit grounds that
 * "their prior-season count can only grow if the corpus is extended even
 * further backward, and THERE IS NO EARLIER SEASON TO ADD." The corpus was
 * then extended backward — 2016, 2017 and 2018 landed 2026-09-07 (quick task
 * 260907-203) — so the premise failed, not the logic built on it. A "forever"
 * claim resting on an unstated assumption about what would never be ingested
 * is the shape to distrust here.
 *
 * Verified against the LIVE published artifacts rather than re-derived, since
 * `headlineEligible` is computed at publish time and is the authority:
 * **2018, 2019 and 2020 now publish `headlineEligible: true`** (they have
 * three, four and five prior corpus seasons respectively). The floor's own
 * stated purpose — keep permanently-ineligible rows off the page — no longer
 * excludes them.
 *
 * **2016 and 2017 publish `headlineEligible: false` and are shown anyway.**
 * 2016 is the corpus cold start (zero priors, and it can never gain one);
 * 2017 has a single thin prior. Their published winner-accuracy and Brier
 * figures are real measurements and are NOT empty — the flag governs whether
 * this project makes a HEADLINE claim from a season, not whether the number
 * is valid to display. Two caveats a reader cannot see from the table, and
 * which no component currently surfaces: every algorithm cold-starts in 2016,
 * so its absolute figures are depressed relative to a season with carry (the
 * head-to-head between algorithms is still fair — they are handicapped
 * equally), and 2017's single prior is thin for the same reason. If those
 * caveats ever need to be visible, `headlineEligible` is already on every
 * published slice and is the field to read.
 *
 * `COMPARE_SEASONS` is `SEASONS` filtered to `>= COMPARE_FIRST_SEASON` and
 * sorted ASCENDING (`Year` column order, top-to-bottom 2016-2026); `SEASONS`
 * itself is DESCENDING by design (the year dropdown's default selection is
 * first). The filter is presently a NO-OP — the floor equals `FIRST_SEASON` —
 * and the constant is kept rather than deleted because it is the documented
 * seam for narrowing Compare independently of the site's season list, which
 * is exactly the move that was made once and then had to be undone.
 */
export const COMPARE_FIRST_SEASON = 2016;

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
