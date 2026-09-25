/**
 * The per-district-event BAKED pre-simulation SIDECAR fetcher:
 * `districtPreSimKey({districtKey, eventKey})` -> fetch -> Zod parse -> typed
 * result. Mirrors `apps/web/src/lib/api/preSchedule.ts`'s shape verbatim — same
 * relative import depth, same `artifactUrl()` origin module, same
 * `queryOptions` positional key convention — including BOTH of its recorded
 * divergences, because both apply here for the same reasons.
 *
 * **Divergence 1: a 404 RETURNS `null` rather than throwing
 * `ArtifactFetchError`.** An absent sidecar is an ordinary, expected state: it
 * is the correct and permanent answer for a district-year published before this
 * phase, for a divisioned DCMP parent (10-06 never writes one), and for any
 * event the publisher skipped. Every OTHER non-ok status still throws
 * `ArtifactFetchError` unchanged, because a 500 or a network failure is a
 * genuine failure and hiding it behind the same `null` would make an outage
 * indistinguishable from an uncovered event.
 *
 * **A 404 IS NEVER CONTROL FLOW HERE ANYWAY.** `DistrictArtifactSchema
 * .bakedEvents` lists the exact event keys for which a sidecar was published in
 * THIS generation, and `useDistrictLedgerData` fetches only for a key on that
 * list. The `null` branch above is the honest handling of a race (a generation
 * rolling over mid-view), not the ordinary path.
 *
 * **Divergence 2: `markArtifactParsed()` is deliberately NOT called.** That
 * mark is the parse-to-paint split for the PAGE's own artifact; a sidecar is a
 * secondary, lazily-fetched object that by construction resolves after the page
 * has already painted, so marking it would move a measured page-performance
 * number to describe something that is not the page.
 *
 * `districtPreSimKey` is imported — never re-spelled — from the same module the
 * publisher writes through. Two spellings of that key would be a silent,
 * permanent 404 that no test on either side would catch alone.
 */
import {
  districtPreSimKey,
  DistrictPreSimArtifactSchema,
  type DistrictPreSimArtifact,
} from "../../../../../packages/harness/pageArtifacts.js";
import { artifactUrl } from "../artifactOrigin.js";
import { seasonFromEventKey } from "../eventKey.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

/** The `resource` string both error classes carry into the "Couldn't load {resource} for {year}." copy. Named for what a reader would recognise, not for the key segment. */
const DISTRICT_PRESIM_RESOURCE = "district point projection";

export interface FetchDistrictPreSimArtifactParams {
  districtKey: string;
  eventKey: string;
}

export async function fetchDistrictPreSimArtifact({
  districtKey,
  eventKey,
}: FetchDistrictPreSimArtifactParams): Promise<DistrictPreSimArtifact | null> {
  const key = districtPreSimKey({ districtKey, eventKey });
  const res = await fetch(artifactUrl(key));
  // Checked BEFORE the general `!res.ok` branch so the ordinary-absence case
  // can never fall through into the failure case.
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new ArtifactFetchError(DISTRICT_PRESIM_RESOURCE, seasonFromEventKey(eventKey), res.status);
  }
  const body: unknown = await res.json();
  try {
    return DistrictPreSimArtifactSchema.parse(body);
  } catch (err) {
    throw new ArtifactValidationError(DISTRICT_PRESIM_RESOURCE, seasonFromEventKey(eventKey), err);
  }
}

/** Matches `eventQueryOptions`' positional key convention — `[kind, ...the same params, in the same order, the fetcher takes]`. */
export function districtPreSimQueryOptions(params: FetchDistrictPreSimArtifactParams) {
  return {
    queryKey: ["districtPreSim", params.districtKey, params.eventKey] as const,
    queryFn: () => fetchDistrictPreSimArtifact(params),
  };
}
