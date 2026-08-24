/**
 * The events artifact fetcher: artifactKey -> fetch -> Zod parse -> typed
 * result. Mirrors `apps/web/src/lib/api/teams.ts`'s fetcher exactly — same
 * shape, same two named error classes, same origin helper — so the two
 * fetchers read as siblings rather than two independent patterns
 * (05-07-PLAN.md Task 1).
 *
 * Import depth matches `teams.ts`'s corrected, verified depth: from
 * `apps/web/src/lib/api/`, the repo root is FIVE levels up.
 */
import { artifactKey, EventsArtifactSchema, type EventsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { markArtifactParsed } from "../perfMarks.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

export interface FetchEventsArtifactParams {
  year: number;
  algorithmId: string;
  version: string;
}

export async function fetchEventsArtifact({ year, algorithmId, version }: FetchEventsArtifactParams): Promise<EventsArtifact> {
  const key = artifactKey({ page: "events", year, algorithmId, version });
  const res = await fetch(artifactUrl(key));
  if (!res.ok) {
    throw new ArtifactFetchError("events", year, res.status);
  }
  const body: unknown = await res.json();
  try {
    const parsed = EventsArtifactSchema.parse(body);
    // 05-VALIDATION.md's "Measurement Gate (NAV-06)" — the network/parse
    // side of the parse-to-paint split, marked identically to
    // `fetchTeamsArtifact` immediately after the schema parse resolves.
    markArtifactParsed();
    return parsed;
  } catch (err) {
    throw new ArtifactValidationError("events", year, err);
  }
}

export function eventsQueryOptions(params: FetchEventsArtifactParams) {
  return {
    queryKey: ["events", params.year, params.algorithmId, params.version] as const,
    queryFn: () => fetchEventsArtifact(params),
  };
}
