/**
 * The teams artifact fetcher: artifactKey -> fetch -> Zod parse -> typed
 * result. Mirrors `apps/worker/src/liveWindows.ts`'s parse-or-throw shape
 * (05-PATTERNS.md), adapted from KV/R2 bindings to a plain `fetch()` — the
 * browser's own HTTP cache already honours the `ETag`/`Cache-Control:
 * public, max-age=60` headers Phase 4 D-26 sets, so no custom
 * conditional-request wrapper is needed here.
 *
 * Import depth: from `apps/web/src/lib/api/`, the repo root is FIVE levels
 * up (apps/web/src/lib/api has 5 path segments) — 05-PATTERNS.md's own
 * illustrative depth was one short; this is the corrected, verified depth.
 * No `@sigmascout/*` workspace alias exists anywhere in this repo
 * (05-PATTERNS.md, confirmed by grep), so this is a plain relative path with
 * the explicit `.js` extension, matching every existing cross-package import
 * in `apps/worker`.
 */
import { artifactKey, TeamsArtifactSchema, type TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

export interface FetchTeamsArtifactParams {
  year: number;
  algorithmId: string;
  version: string;
}

export async function fetchTeamsArtifact({ year, algorithmId, version }: FetchTeamsArtifactParams): Promise<TeamsArtifact> {
  const key = artifactKey({ page: "teams", year, algorithmId, version });
  const res = await fetch(artifactUrl(key));
  if (!res.ok) {
    throw new ArtifactFetchError("teams", year, res.status);
  }
  const body: unknown = await res.json();
  try {
    return TeamsArtifactSchema.parse(body);
  } catch (err) {
    throw new ArtifactValidationError("teams", year, err);
  }
}

export function teamsQueryOptions(params: FetchTeamsArtifactParams) {
  return {
    queryKey: ["teams", params.year, params.algorithmId, params.version] as const,
    queryFn: () => fetchTeamsArtifact(params),
  };
}
