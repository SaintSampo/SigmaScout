/**
 * The Compare artifact fetcher: artifactKey -> fetch -> Zod parse -> typed
 * result. Mirrors `apps/web/src/lib/api/events.ts`/`event.ts` in shape, with
 * one deliberate divergence: `FetchCompareArtifactParams` carries ONLY
 * `year`. `ArtifactKeyParams`'s `ComparePageParams` member has no
 * `algorithmId`/`version` field at all — `v1/compare/{year}.json` is the
 * single published key with no algorithm segment and no version segment.
 * That is why this fetcher, alone among the site's five, needs no
 * `useAlgorithmVersion` resolution and no `enabled` gate on an unresolved
 * manifest version — there is no version to wait for. This asymmetry is
 * deliberate, not an oversight; do not add one back by symmetry with the
 * other four fetchers.
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
 * The floor is 2016. 2016 and 2017 publish `headlineEligible: false` and are
 * shown anyway: 2016 is the corpus cold start (zero priors, and it can
 * never gain one); 2017 has a single thin prior. Their published
 * winner-accuracy and Brier figures are real measurements and are NOT
 * empty — the flag governs whether this project makes a HEADLINE claim from
 * a season, not whether the number is valid to display. Every algorithm
 * cold-starts in 2016, so its absolute figures are depressed relative to a
 * season with carry, though the head-to-head between algorithms stays fair
 * since they are handicapped equally. If those caveats ever need to be
 * visible, `headlineEligible` is already on every published slice.
 *
 * `COMPARE_SEASONS` is `SEASONS` filtered to `>= COMPARE_FIRST_SEASON` and
 * sorted ASCENDING (`Year` column order, top-to-bottom 2016-2026); `SEASONS`
 * itself is DESCENDING by design (the year dropdown's default selection is
 * first). The filter is presently a NO-OP — the floor equals `FIRST_SEASON`
 * — and the constant is kept as the documented seam for narrowing Compare
 * independently of the site's season list.
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
