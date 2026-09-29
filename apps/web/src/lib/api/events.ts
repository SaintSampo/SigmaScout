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
import { isCancelledEvent } from "../../../../../packages/core/algorithms/cancelledEvent.js";
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
    // Drop rows that were already cancelled when the list was published (quick task 260929-mcf). The
    // reference instant is the artifact's OWN `computedAt`, never `Date.now()`: the live Worker never
    // rebuilds this list, so an event it promotes and folds after a publish keeps `playedMatchCount` 0
    // in its row, and a browser-clock check would hide it a week later. A `computedAt` check hides only
    // rows the publisher itself would have dropped at that instant, which makes this a pure guard for
    // lists published before the change and a no-op for every list published after. An unparseable
    // `computedAt` gives a NaN instant, and `isCancelledEvent` then keeps every row.
    const publishedAtMs = Date.parse(parsed.computedAt);
    return { ...parsed, events: parsed.events.filter((row) => !isCancelledEvent(row, publishedAtMs)) };
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
