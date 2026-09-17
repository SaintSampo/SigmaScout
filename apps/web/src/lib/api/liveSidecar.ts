/**
 * The LIVE METRIC SIDECAR fetcher (quick task 260917-jr4, Task 2). Modelled
 * line for line on `apps/web/src/lib/api/preSchedule.ts` — same relative
 * import depth, same `artifactUrl()` origin module, same
 * `seasonFromEventKey(eventKey)` source for the year both error classes need,
 * same `queryOptions` positional key convention.
 *
 * **A 404 RETURNS `null` INSTEAD OF THROWING, and here that is not merely
 * tolerable but the overwhelmingly common case.** A sidecar exists only for
 * an event a live tick has actually folded a match at, and only until the
 * next republish makes it redundant. Every finished event, every event whose
 * matches were scheduled but never played, and every event in a season the
 * Worker was not running for is a permanent, correct 404. A thrown 404 would
 * turn the ordinary state of the world into a rendered error on a page whose
 * correct behaviour there is simply to show the published history. Every
 * OTHER non-ok status still throws `ArtifactFetchError`, because a 500 or a
 * network failure is a genuine failure and hiding it behind the same `null`
 * would make an outage indistinguishable from a not-live event.
 *
 * `markArtifactParsed()` is deliberately NOT called, for the same reason
 * `preSchedule.ts` does not call it: that mark is the PAGE's own
 * parse-to-paint split, and this is a secondary, lazily-fetched object that
 * by construction resolves after the page has already painted.
 *
 * `liveMetricSidecarKey` is IMPORTED, never re-spelled, from the same module
 * `apps/worker/src/artifactWriter.ts` writes through. Two spellings of that
 * key would be a silent, permanent 404 that no test on either side would
 * catch alone — the rule `preScheduleKey` established.
 *
 * A PARSE FAILURE THROWS rather than returning `null`. An object that is
 * present but not a sidecar is NOT the ordinary-absence case: it means
 * something wrote a foreign body under the `v1/live/` prefix, and the
 * `ephemeral: true` literal exists precisely so that is loud.
 */
import { LiveMetricSidecarSchema, liveMetricSidecarKey, type LiveMetricSidecar } from "../../../../../packages/harness/liveMetricSidecar.js";
import { artifactUrl } from "../artifactOrigin.js";
import { seasonFromEventKey } from "../eventKey.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

/** Mirrors `FetchPreScheduleArtifactParams` exactly, and carries no `year` for the same reason: `liveMetricSidecarKey` has no year segment. */
export interface FetchLiveSidecarParams {
  eventKey: string;
  algorithmId: string;
  version: string;
}

/** The `resource` string both error classes carry into the UI-SPEC's "Couldn't load {resource} for {year}." copy. */
const LIVE_SIDECAR_RESOURCE = "live metrics";

export async function fetchLiveSidecar({ eventKey, algorithmId, version }: FetchLiveSidecarParams): Promise<LiveMetricSidecar | null> {
  const key = liveMetricSidecarKey({ eventKey, algorithmId, version });
  const res = await fetch(artifactUrl(key));
  // Checked BEFORE the general `!res.ok` branch so the ordinary-absence case
  // can never fall through into the failure case.
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new ArtifactFetchError(LIVE_SIDECAR_RESOURCE, seasonFromEventKey(eventKey), res.status);
  }
  const body: unknown = await res.json();
  try {
    return LiveMetricSidecarSchema.parse(body);
  } catch (err) {
    throw new ArtifactValidationError(LIVE_SIDECAR_RESOURCE, seasonFromEventKey(eventKey), err);
  }
}

/** Matches `eventQueryOptions`' positional key convention — `[kind, ...the same params, in the same order, the fetcher takes]`. */
export function liveSidecarQueryOptions(params: FetchLiveSidecarParams) {
  return {
    queryKey: ["liveSidecar", params.eventKey, params.algorithmId, params.version] as const,
    queryFn: () => fetchLiveSidecar(params),
  };
}
