/**
 * The Districts page's two artifact fetchers (quick task 260905-lic Task 3):
 * `districtsIndexKey(year)`/`districtDetailKey(districtKey)` -> fetch -> Zod
 * parse -> typed result. Mirrors `compare.ts`'s fetcher shape exactly — same
 * two named error classes, same `artifactUrl`/`markArtifactParsed` calls —
 * with the same deliberate divergence `compare.ts` itself documents: neither
 * fetcher here takes an `algorithmId`/`version` at all. District point data
 * has no algorithm dependency whatsoever (`pageArtifacts.ts`'s own doc
 * comment on `DistrictsIndexArtifactSchema`/`DistrictArtifactSchema` states
 * this explicitly, echoing `ComparePageParams`'s "the deliberate exception
 * with no algorithm segment"). That is why this module, like `compare.ts`,
 * needs no `useAlgorithmVersion` resolution and no `enabled` gate on an
 * unresolved manifest version — there is no version to wait for. Do not add
 * one back by symmetry with `events.ts`/`event.ts`/`team.ts`/`teams.ts`;
 * this asymmetry is deliberate, not an oversight.
 *
 * `districtsIndexKey`/`districtDetailKey` are NOT members of `ArtifactKeyParams`
 * — see their own doc comments in `pageArtifacts.ts` for why — so this module
 * calls them directly rather than going through the shared `artifactKey`
 * dispatcher every other fetcher in this directory uses.
 *
 * Import depth matches `compare.ts`'s corrected, verified depth: from
 * `apps/web/src/lib/api/`, the repo root is FIVE levels up.
 */
import {
  districtDetailKey,
  districtsIndexKey,
  DistrictArtifactSchema,
  DistrictsIndexArtifactSchema,
  type DistrictArtifact,
  type DistrictsIndexArtifact,
} from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { markArtifactParsed } from "../perfMarks.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

export interface FetchDistrictsIndexArtifactParams {
  year: number;
}

export async function fetchDistrictsIndexArtifact({ year }: FetchDistrictsIndexArtifactParams): Promise<DistrictsIndexArtifact> {
  const key = districtsIndexKey(year);
  const res = await fetch(artifactUrl(key));
  if (!res.ok) {
    throw new ArtifactFetchError("districts", year, res.status);
  }
  const body: unknown = await res.json();
  try {
    const parsed = DistrictsIndexArtifactSchema.parse(body);
    // Same parse-to-paint convention as every other fetcher in this
    // directory — marked immediately after the schema parse resolves.
    markArtifactParsed();
    return parsed;
  } catch (err) {
    throw new ArtifactValidationError("districts", year, err);
  }
}

export function districtsIndexQueryOptions(params: FetchDistrictsIndexArtifactParams) {
  return {
    queryKey: ["districts-index", params.year] as const,
    queryFn: () => fetchDistrictsIndexArtifact(params),
  };
}

export interface FetchDistrictArtifactParams {
  districtKey: string;
  /**
   * The currently-selected year, carried ONLY so a fetch failure can render
   * `ArtifactFetchError`'s "Couldn't load {resource} for {year}." copy —
   * `districtDetailKey` itself does not use it, since a district key is
   * already year-prefixed (`"2026fnc"`).
   */
  year: number;
}

export async function fetchDistrictArtifact({ districtKey, year }: FetchDistrictArtifactParams): Promise<DistrictArtifact> {
  const key = districtDetailKey(districtKey);
  const res = await fetch(artifactUrl(key));
  if (!res.ok) {
    throw new ArtifactFetchError(`district ${districtKey}`, year, res.status);
  }
  const body: unknown = await res.json();
  try {
    const parsed = DistrictArtifactSchema.parse(body);
    markArtifactParsed();
    return parsed;
  } catch (err) {
    throw new ArtifactValidationError(`district ${districtKey}`, year, err);
  }
}

export function districtQueryOptions(params: FetchDistrictArtifactParams) {
  return {
    queryKey: ["district", params.districtKey] as const,
    queryFn: () => fetchDistrictArtifact(params),
  };
}
