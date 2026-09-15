/**
 * The event artifact fetcher: artifactKey -> fetch -> Zod parse -> typed
 * result. Mirrors `apps/web/src/lib/api/team.ts` verbatim in shape
 * (07-PATTERNS.md) — only the schema/params/query-key differ, since the
 * event page needs one event's own artifact rather than a team's.
 *
 * `FetchEventArtifactParams` deliberately carries NO `year`, because
 * `ArtifactKeyParams`'s `EventPageParams` member has no year field and the
 * built key (`v1/event/{eventKey}/{algorithmId}@{version}.json`) has no year
 * segment. Both `ArtifactFetchError` and `ArtifactValidationError` still need
 * a `year` for the copy they feed — `seasonFromEventKey(eventKey)` supplies
 * it, never the `?year=` search param, so the reported season can never
 * disagree with the event actually being fetched (07-01-PLAN.md's Decision
 * 1).
 *
 * Import depth: identical to `team.ts` — `apps/web/src/lib/api/` sits five
 * path segments below the repo root. No `@sigmascout/*` workspace alias
 * exists anywhere in this repo, so this is a plain relative path with the
 * explicit `.js` extension.
 *
 * Since 260915-m4j the body parses with `LiveEventArtifactSchema`, whose
 * upcoming rows may be schedule-only (the live Worker's shape), and is then
 * handed to `resolveEventArtifact`, which prices those rows in the browser
 * from the artifact's `state` block where one is usable and strips the block.
 * Pricing runs here, inside the queryFn, so it happens once per fetch per
 * cache entry and every observer of the query key (event page, match page,
 * team pages) shares the priced result. A pricing failure never fails the
 * fetch: the artifact comes back unpriced.
 */
import { artifactKey, LiveEventArtifactSchema, type LiveEventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { seasonFromEventKey } from "../eventKey.js";
import { markArtifactParsed } from "../perfMarks.js";
import { resolveEventArtifact, type EventPageArtifact } from "../eventPricing.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

export interface FetchEventArtifactParams {
  eventKey: string;
  algorithmId: string;
  version: string;
}

export async function fetchEventArtifact({ eventKey, algorithmId, version }: FetchEventArtifactParams): Promise<EventPageArtifact> {
  const key = artifactKey({ page: "event", eventKey, algorithmId, version });
  const res = await fetch(artifactUrl(key));
  if (!res.ok) {
    throw new ArtifactFetchError("event", seasonFromEventKey(eventKey), res.status);
  }
  const body: unknown = await res.json();
  let parsed: LiveEventArtifact;
  try {
    parsed = LiveEventArtifactSchema.parse(body);
    // 07-VALIDATION.md's parse-to-paint split, same convention as
    // `team.ts`'s own `markArtifactParsed()` call — marked immediately after
    // the schema parse resolves, before returning.
    markArtifactParsed();
  } catch (err) {
    throw new ArtifactValidationError("event", seasonFromEventKey(eventKey), err);
  }
  // Outside the try: `resolveEventArtifact` never throws, and a pricing
  // problem must never be reported as a validation error.
  return await resolveEventArtifact(parsed);
}

export function eventQueryOptions(params: FetchEventArtifactParams) {
  return {
    queryKey: ["event", params.eventKey, params.algorithmId, params.version] as const,
    queryFn: () => fetchEventArtifact(params),
  };
}
