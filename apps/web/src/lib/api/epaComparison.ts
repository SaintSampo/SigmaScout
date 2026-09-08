/**
 * The EPA-vs-Statbotics comparison artifact fetcher (quick task 260908-n5o
 * Task 3). Mirrors `apps/web/src/lib/api/compare.ts`'s shape — fetch, check
 * `res.ok`, parse through the schema, `markArtifactParsed()`, throw on
 * failure — with the same deliberate omission `compare.ts` already
 * documents: `v1/methodology/epa-vs-statbotics.json` carries no algorithm
 * segment and no version segment (`epaComparisonKey()` takes no params at
 * all), so this fetcher needs no `useAlgorithmVersion` resolution and no
 * `enabled` gate on an unresolved manifest version. Do not add one back by
 * symmetry with the other fetchers.
 *
 * ONE further divergence from `compare.ts`, and it is deliberate rather than
 * an oversight: this artifact ALSO carries no `year` — it is a single
 * cross-season document (2022-2026 in one object), unlike `compare.ts`'s
 * `v1/compare/{year}.json`. The shared `ArtifactFetchError`/
 * `ArtifactValidationError` (`./errors.js`) both REQUIRE a `year: number`
 * (their copy is "Couldn't load {resource} for {year}."), and manufacturing
 * a fake year to satisfy that signature would print a nonsensical error
 * message for a document that has no year. This file declares its own two
 * named error classes instead — the same choice
 * `apps/web/src/lib/api/manifests.ts` already made for `v1/manifest/
 * algorithms.json`, another key with no year of its own.
 *
 * Import depth matches `compare.ts`'s corrected, verified depth: from
 * `apps/web/src/lib/api/`, the repo root is FIVE levels up. No
 * `@sigmascout/*` workspace alias exists anywhere in this repo.
 */
import { epaComparisonKey, EpaComparisonArtifactSchema, type EpaComparisonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { markArtifactParsed } from "../perfMarks.js";

export class EpaComparisonFetchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`fetchEpaComparisonArtifact: failed with HTTP ${status}`);
    this.name = "EpaComparisonFetchError";
    this.status = status;
  }
}

export class EpaComparisonValidationError extends Error {
  constructor(cause: unknown) {
    super(`fetchEpaComparisonArtifact: failed schema validation: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "EpaComparisonValidationError";
  }
}

export async function fetchEpaComparisonArtifact(): Promise<EpaComparisonArtifact> {
  const res = await fetch(artifactUrl(epaComparisonKey()));
  if (!res.ok) {
    throw new EpaComparisonFetchError(res.status);
  }
  const body: unknown = await res.json();
  try {
    const parsed = EpaComparisonArtifactSchema.parse(body);
    // Same parse-to-paint convention as every other fetcher in this
    // directory — marked immediately after the schema parse resolves.
    markArtifactParsed();
    return parsed;
  } catch (err) {
    throw new EpaComparisonValidationError(err);
  }
}

export function epaComparisonQueryOptions() {
  return {
    queryKey: ["epa-comparison"] as const,
    queryFn: fetchEpaComparisonArtifact,
  };
}
