/**
 * The AS-OF object fetchers (quick task 261005-5g0): an event's INDEX and LOG,
 * a season's season object and its season start object, each `key -> fetch ->
 * Zod parse -> typed result`, in `districtLedger.ts`'s shape.
 *
 * A 404 RETURNS `null` rather than throwing, `districtLedger.ts`'s own first
 * divergence and for a sharper reason: the absence is a FACT the resolver
 * consumes. `resolveAsOf` (`packages/harness/asOfLookup.ts`) reads a `null`
 * map entry as "known not published", which is the honest answer for an event
 * with no folded match yet (the publisher writes an INDEX on an event's first
 * fold) and for an event published before the as-of capture existed. A rewound
 * Locks view turns the second case into an unavailable event, never into the
 * stored odds. Every OTHER non-ok status still throws `ArtifactFetchError`, so
 * an outage never reads as an unpublished object.
 *
 * `markArtifactParsed()` is NOT called, for `districtLedger.ts`'s second
 * reason: these are secondary objects fetched after the page has painted.
 *
 * Every key is built by `pageArtifacts.ts`'s own key function, the one
 * spelling the publisher and the Worker write through.
 */
import {
  asOfIndexKey,
  asOfLogKey,
  asOfSeasonKey,
  asOfStartKey,
} from "../../../../../packages/harness/pageArtifacts.js";
import {
  AsOfIndexSchema,
  AsOfLogSchema,
  AsOfSeasonSchema,
  AsOfStartSchema,
  type AsOfIndex,
  type AsOfLog,
  type AsOfSeason,
  type AsOfStart,
} from "../../../../../packages/harness/asOfState.js";
import { artifactUrl } from "../artifactOrigin.js";
import { seasonFromEventKey } from "../eventKey.js";
import { ArtifactFetchError, ArtifactValidationError } from "./errors.js";

/** The `resource` both error classes carry into the "Couldn't load {resource} for {year}." copy. */
const AS_OF_RESOURCE = "rewound forecast state";

/**
 * How long a fetched as-of object is reused before a reader asks again. A
 * finished event's objects never change; a live event's INDEX and LOG grow by
 * one row per folded match, and the season object moves with every fold
 * anywhere. Each object is cached on its own, so copies of different ages
 * meet: a LOG a minute older than its INDEX, a season object behind or ahead
 * of an INDEX. `resolveAsOf` never answers from a copy that is behind another
 * one it read; it reports it stale, and the loaders refetch that object FRESH
 * (`AsOfFetchOptions`) before reading the stop as unavailable.
 */
export const AS_OF_STALE_TIME_MS = 60_000;

/** `fresh`: skip the query cache and revalidate the browser's HTTP cache, for an object `resolveAsOf` reported out of step. */
export interface AsOfFetchOptions {
  readonly fresh?: boolean;
}

/**
 * A FRESH fetch revalidates the browser's own HTTP cache (`cache: "no-cache"`),
 * which otherwise serves the object for its `max-age` without asking. It does
 * not reach past the CDN's edge copy, whose own lifetime (60 s) bounds how old
 * a fresh copy can still be: a stop that stays out of step after one is read
 * as unavailable and asked again on the live refresh cadence
 * (`useAsOfRewind.ts`).
 */
async function fetchAsOfObject<T>(key: string, year: number, parse: (body: unknown) => T, options?: AsOfFetchOptions): Promise<T | null> {
  const res = options?.fresh === true ? await fetch(artifactUrl(key), { cache: "no-cache" }) : await fetch(artifactUrl(key));
  // Checked BEFORE the general `!res.ok` branch so the ordinary absence can
  // never fall through into the failure case.
  if (res.status === 404) return null;
  if (!res.ok) throw new ArtifactFetchError(AS_OF_RESOURCE, year, res.status);
  const body: unknown = await res.json();
  try {
    return parse(body);
  } catch (err) {
    throw new ArtifactValidationError(AS_OF_RESOURCE, year, err);
  }
}

export interface AsOfEventObjectParams {
  readonly eventKey: string;
  readonly algorithmId: string;
  readonly version: string;
}

export interface AsOfSeasonObjectParams {
  readonly season: number;
  readonly algorithmId: string;
  readonly version: string;
}

export function fetchAsOfIndex(params: AsOfEventObjectParams, options?: AsOfFetchOptions): Promise<AsOfIndex | null> {
  return fetchAsOfObject(asOfIndexKey(params), seasonFromEventKey(params.eventKey), (body) => AsOfIndexSchema.parse(body), options);
}

export function fetchAsOfLog(params: AsOfEventObjectParams, options?: AsOfFetchOptions): Promise<AsOfLog | null> {
  return fetchAsOfObject(asOfLogKey(params), seasonFromEventKey(params.eventKey), (body) => AsOfLogSchema.parse(body), options);
}

export function fetchAsOfSeason(params: AsOfSeasonObjectParams, options?: AsOfFetchOptions): Promise<AsOfSeason | null> {
  return fetchAsOfObject(asOfSeasonKey(params), params.season, (body) => AsOfSeasonSchema.parse(body), options);
}

export function fetchAsOfStart(params: AsOfSeasonObjectParams): Promise<AsOfStart | null> {
  return fetchAsOfObject(asOfStartKey(params), params.season, (body) => AsOfStartSchema.parse(body));
}

/**
 * `eventQueryOptions`' positional key convention: `[kind, ...the fetcher's params, in order]`.
 * With `fresh`, `staleTime` 0 makes `fetchQuery` skip the cached copy, and the
 * fresh copy replaces it under the same key.
 */
export function asOfIndexQueryOptions(params: AsOfEventObjectParams, options?: AsOfFetchOptions) {
  return {
    queryKey: ["asOfIndex", params.eventKey, params.algorithmId, params.version] as const,
    queryFn: () => fetchAsOfIndex(params, options),
    staleTime: options?.fresh === true ? 0 : AS_OF_STALE_TIME_MS,
  };
}

export function asOfLogQueryOptions(params: AsOfEventObjectParams, options?: AsOfFetchOptions) {
  return {
    queryKey: ["asOfLog", params.eventKey, params.algorithmId, params.version] as const,
    queryFn: () => fetchAsOfLog(params, options),
    staleTime: options?.fresh === true ? 0 : AS_OF_STALE_TIME_MS,
  };
}

export function asOfSeasonQueryOptions(params: AsOfSeasonObjectParams, options?: AsOfFetchOptions) {
  return {
    queryKey: ["asOfSeason", params.season, params.algorithmId, params.version] as const,
    queryFn: () => fetchAsOfSeason(params, options),
    staleTime: options?.fresh === true ? 0 : AS_OF_STALE_TIME_MS,
  };
}

/** The season start object is offline only and never changes within a generation. 2026's is 746 KB raw, so it is fetched only when a resolve reports `missingStart`. */
export function asOfStartQueryOptions(params: AsOfSeasonObjectParams) {
  return {
    queryKey: ["asOfStart", params.season, params.algorithmId, params.version] as const,
    queryFn: () => fetchAsOfStart(params),
    staleTime: Number.POSITIVE_INFINITY,
  };
}
