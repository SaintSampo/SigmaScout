/**
 * The pre-schedule rank-simulation SIDECAR fetcher (quick task 260905-tll
 * Task 5, C-10): `preScheduleKey` -> fetch -> Zod parse -> typed result.
 * Mirrors `apps/web/src/lib/api/event.ts`'s shape deliberately — same
 * relative import depth, same `artifactUrl()` origin module, same
 * `seasonFromEventKey(eventKey)` source for the year both error classes
 * need, same `queryOptions` positional key convention.
 *
 * **The one deliberate divergence from `event.ts`, recorded as a decision
 * rather than left for a reader to infer: a 404 RETURNS `null` instead of
 * throwing `ArtifactFetchError`.** An absent sidecar is an ordinary,
 * EXPECTED state, not a failure — it is the correct and permanent answer
 * for every event outside the covered season set (`--presim-from-season`,
 * defaulting to 2026), for every RP-ineligible event type (the pipeline
 * skips them, PD-06), for a cold-start season's very first event (PD-04),
 * and for every algorithm with no ranking-point model at all. A thrown 404
 * would surface as a rendered ERROR state on a tab whose correct behaviour
 * there is simply to fall back to the existing pre-run placeholder and let
 * the reader run the client engine. Every OTHER non-ok status still throws
 * `ArtifactFetchError` unchanged, because a 500 or a network failure is a
 * genuine failure and hiding it behind the same `null` would make an
 * outage indistinguishable from an uncovered event.
 *
 * `markArtifactParsed()` is deliberately NOT called here (contrast
 * `event.ts`, which does call it). That mark is 07-VALIDATION.md's
 * parse-to-paint split for the PAGE's own artifact; the sidecar is a
 * secondary, lazily-fetched object that by construction resolves after the
 * page has already painted, so marking it would move a measured
 * page-performance number to describe something that is not the page.
 *
 * `preScheduleKey` is imported — never re-spelled — from the same module
 * `packages/harness/publish.ts` writes through. Two spellings of that key
 * would be a silent, permanent 404 that no test on either side would catch
 * alone.
 */
import { preScheduleKey, PreScheduleArtifactSchema, type PreScheduleArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { seasonFromEventKey } from "../eventKey.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

/** Mirrors `FetchEventArtifactParams` exactly — and carries no `year` for the same reason: `preScheduleKey` has no year segment, and both error classes take their year from `seasonFromEventKey(eventKey)` so the reported season can never disagree with the event actually being fetched. */
export interface FetchPreScheduleArtifactParams {
  eventKey: string;
  algorithmId: string;
  version: string;
}

/** The `resource` string both error classes carry into the UI-SPEC's "Couldn't load {resource} for {year}." copy. Named for what a reader would recognise, not for the key segment. */
const PRE_SCHEDULE_RESOURCE = "pre-schedule simulation";

export async function fetchPreScheduleArtifact({
  eventKey,
  algorithmId,
  version,
}: FetchPreScheduleArtifactParams): Promise<PreScheduleArtifact | null> {
  const key = preScheduleKey({ eventKey, algorithmId, version });
  const res = await fetch(artifactUrl(key));
  // The recorded divergence — see this module's doc comment. Checked BEFORE
  // the general `!res.ok` branch so the ordinary-absence case can never fall
  // through into the failure case.
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new ArtifactFetchError(PRE_SCHEDULE_RESOURCE, seasonFromEventKey(eventKey), res.status);
  }
  const body: unknown = await res.json();
  try {
    return PreScheduleArtifactSchema.parse(body);
  } catch (err) {
    throw new ArtifactValidationError(PRE_SCHEDULE_RESOURCE, seasonFromEventKey(eventKey), err);
  }
}

/** Matches `eventQueryOptions`' positional key convention — `[kind, ...the same params, in the same order, the fetcher takes]`. */
export function preScheduleQueryOptions(params: FetchPreScheduleArtifactParams) {
  return {
    queryKey: ["preSchedule", params.eventKey, params.algorithmId, params.version] as const,
    queryFn: () => fetchPreScheduleArtifact(params),
  };
}
