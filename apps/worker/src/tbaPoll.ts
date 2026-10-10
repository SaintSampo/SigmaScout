/**
 * A thin Worker wrapper over `packages/ingest/tbaClient.ts` — the SAME TBA
 * client the offline ingest pipeline uses, imported unchanged. This module
 * adds only the three genuinely Worker-specific things: reading the key from
 * `env.TBA_API_KEY` (a Cloudflare secret, never a `.env` value), building the
 * `TbaClientContext`, and mapping one live event key to one
 * `fetchEventMatches` call.
 *
 * It deliberately does NOT re-implement `THROTTLE_INTERVAL_MS`'s spacing or
 * `tbaFetch`'s conditional-request (ETag) handling — both are imported and
 * used exactly as `tbaClient.ts` defines them. A second TBA client is two
 * politeness policies that agree until the day they do not, and the day they
 * do not is a live event. The 100ms spacing across up to 38 concurrently live
 * events is ~3.8s of wall clock, which costs nothing against a CPU-time
 * budget — CPU time excludes waiting on the network.
 *
 * A 304 costs exactly the same ONE subrequest as a 200 — conditional
 * requests save bandwidth and downstream CPU, not subrequests. Nothing in this
 * file (or `subrequestCounter.ts`) ever treats a cache hit as free.
 *
 * Per-event errors throw with the event key in the message and nothing
 * else — never the TBA key, never a header dump — so the caller
 * (`scheduled.ts`) can catch per event and confine the failure to it.
 */
import { fetchDistrictRankings, fetchEventAlliances, fetchEventAwards, fetchEventMatches, fetchEventRankings, fetchEventTeamsSimple, TbaRequestCounter, THROTTLE_INTERVAL_MS, type TbaClientContext, type TbaFetchResult } from "../../../packages/ingest/tbaClient.js";
import type { Env } from "./env.js";

export { TbaRequestCounter, THROTTLE_INTERVAL_MS };
export type { TbaClientContext, TbaFetchResult };

/** Builds the `TbaClientContext` `pollEventMatches` needs from the Worker's typed `Env` and a counter the caller owns for the whole tick (one counter, shared across every event polled this tick — the tick's "TBA requests" figure comes from it). */
export function createTbaContext(env: Env, counter: TbaRequestCounter): TbaClientContext {
  return { apiKey: env.TBA_API_KEY, counter, baseUrl: env.TBA_BASE_URL };
}

export type PollEventMatchesResult =
  | { readonly status: "not-modified" }
  | { readonly status: "ok"; readonly etag: string | undefined; readonly matches: readonly unknown[]; readonly lastModified?: string };

/** Thrown by `pollEventMatches` for any non-2xx, non-304 TBA response, or for a transport-level `fetch` failure — always names ONLY the event key, never the TBA key, never response headers. */
export class TbaPollError extends Error {
  constructor(eventKey: string, cause: unknown) {
    super(`pollEventMatches: TBA poll failed for event "${eventKey}"${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "TbaPollError";
  }
}

/**
 * `GET /event/{key}/matches`, conditional on `cachedEtag` — `ctx.counter`
 * records whether this cost a cache hit (304) or a fresh fetch (200), and
 * either way it is ONE request against the budget. Returns the raw (not yet
 * Zod-validated) match list body on a 200 — `scheduled.ts` validates it
 * through `packages/ingest/schemas.ts`'s `tbaMatchListSchema` at the fetch
 * boundary, per this project's standing rule that a parse failure throws
 * rather than being partially consumed.
 */
export async function pollEventMatches(ctx: TbaClientContext, eventKey: string, cachedEtag: string | undefined): Promise<PollEventMatchesResult> {
  let result: TbaFetchResult;
  try {
    result = await fetchEventMatches(ctx, eventKey, cachedEtag);
  } catch (err) {
    throw new TbaPollError(eventKey, err);
  }
  if (result.status === 304) {
    return { status: "not-modified" };
  }
  return { status: "ok", etag: result.etag, matches: result.body as unknown[], ...(result.lastModified !== undefined ? { lastModified: result.lastModified } : {}) };
}

// ---------------------------------------------------------------------------
// The two district-pass polls (10-05). Both are ordinary conditional GETs; the
// only reason they live here rather than at their call site is this module's
// header: one TBA client, one politeness policy, one place a response's status
// is turned into a value.
// ---------------------------------------------------------------------------

/**
 * The shared shape of a conditional poll whose body this module does NOT
 * validate. `body` is deliberately `unknown`, matching
 * `PollEventMatchesResult`'s own contract that the CALLER parses at its own
 * boundary — `districtRefresh.ts` runs `DistrictRankingsPayloadSchema` /
 * `tbaEventAwardsResponseSchema` over it there, so a parse failure is confined
 * to the one district it came from.
 *
 * A 304 costs the same ONE request as a 200; see this file's header.
 */
export type TbaConditionalBody = { readonly status: "not-modified" } | { readonly status: "ok"; readonly etag: string | undefined; readonly body: unknown; readonly lastModified?: string };

/** Thrown by `pollDistrictRankings` for any non-2xx, non-304 TBA response, or for a transport-level `fetch` failure — always names ONLY the district key, never the TBA key, never response headers. Mirrors `TbaPollError`. */
export class TbaDistrictRankingsPollError extends Error {
  constructor(districtKey: string, cause: unknown) {
    super(`pollDistrictRankings: TBA poll failed for district "${districtKey}"${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "TbaDistrictRankingsPollError";
  }
}

/** Thrown by `pollEventAwards` for any non-2xx, non-304 TBA response, or for a transport-level `fetch` failure — always names ONLY the event key, never the TBA key, never response headers. Mirrors `TbaPollError`. */
export class TbaEventAwardsPollError extends Error {
  constructor(eventKey: string, cause: unknown) {
    super(`pollEventAwards: TBA poll failed for event "${eventKey}"${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "TbaEventAwardsPollError";
  }
}

/**
 * `GET /district/{districtKey}/rankings`, conditional on `cachedEtag`. One
 * request per live district per tick — the whole freshness mechanism of SC-1.
 * `districtKey` is TBA's year-prefixed key (e.g. `"2026pnw"`), the same shape
 * `fetchDistrictRankings`'s own doc comment describes; the caller validates it
 * against `DISTRICT_KEY_PATTERN` before it reaches this URL.
 */
export async function pollDistrictRankings(ctx: TbaClientContext, districtKey: string, cachedEtag: string | undefined): Promise<TbaConditionalBody> {
  let result: TbaFetchResult;
  try {
    result = await fetchDistrictRankings(ctx, districtKey, cachedEtag);
  } catch (err) {
    throw new TbaDistrictRankingsPollError(districtKey, err);
  }
  if (result.status === 304) return { status: "not-modified" };
  return { status: "ok", etag: result.etag, body: result.body, ...(result.lastModified !== undefined ? { lastModified: result.lastModified } : {}) };
}

/**
 * `GET /event/{key}/awards`, conditional on `cachedEtag`. The ONE genuinely
 * new request this phase adds. Since quick task 261009-r9x the flag is not
 * decided from this response alone: the shared merge
 * (`packages/harness/districtRankingsMerge.ts`) resolves `awardsPosted` from
 * the awards list and the rankings merged the same tick. An event that has an
 * awards cursor row is asked conditionally on every tick, and an event whose
 * flag still waits is asked with no ETag on a tick that reads the artifact —
 * see `districtRefresh.ts` for the order and the reasons.
 */
export async function pollEventAwards(ctx: TbaClientContext, eventKey: string, cachedEtag: string | undefined): Promise<TbaConditionalBody> {
  let result: TbaFetchResult;
  try {
    result = await fetchEventAwards(ctx, eventKey, cachedEtag);
  } catch (err) {
    throw new TbaEventAwardsPollError(eventKey, err);
  }
  if (result.status === 304) return { status: "not-modified" };
  return { status: "ok", etag: result.etag, body: result.body, ...(result.lastModified !== undefined ? { lastModified: result.lastModified } : {}) };
}

/** Thrown by `pollEventTeams` for any non-2xx, non-304 TBA response, or for a transport-level `fetch` failure — always names ONLY the event key, never the TBA key, never response headers. Mirrors `TbaPollError`. */
export class TbaEventTeamsPollError extends Error {
  constructor(eventKey: string, cause: unknown) {
    super(`pollEventTeams: TBA poll failed for event "${eventKey}"${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "TbaEventTeamsPollError";
  }
}

/**
 * `GET /event/{key}/teams/simple`, conditional on `cachedEtag` — the ONE extra
 * request the roster pass spends per open live window per tick, so a promoted
 * event whose schedule is posted but unscored can still publish its registered
 * roster. Returns the existing `TbaConditionalBody` union rather than a fourth
 * result type for the same shape; the caller parses the body through
 * `tbaEventTeamsSimpleResponseSchema` at its own boundary.
 */
export async function pollEventTeams(ctx: TbaClientContext, eventKey: string, cachedEtag: string | undefined): Promise<TbaConditionalBody> {
  let result: TbaFetchResult;
  try {
    result = await fetchEventTeamsSimple(ctx, eventKey, cachedEtag);
  } catch (err) {
    throw new TbaEventTeamsPollError(eventKey, err);
  }
  if (result.status === 304) return { status: "not-modified" };
  return { status: "ok", etag: result.etag, body: result.body, ...(result.lastModified !== undefined ? { lastModified: result.lastModified } : {}) };
}

/** Thrown by `pollEventRankings` for any non-2xx, non-304 TBA response, or for a transport-level `fetch` failure: always names ONLY the event key, never the TBA key, never response headers. Mirrors `TbaPollError`. */
export class TbaEventRankingsPollError extends Error {
  constructor(eventKey: string, cause: unknown) {
    super(`pollEventRankings: TBA poll failed for event "${eventKey}"${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "TbaEventRankingsPollError";
  }
}

/** Thrown by `pollEventAlliances` for any non-2xx, non-304 TBA response, or for a transport-level `fetch` failure: always names ONLY the event key, never the TBA key, never response headers. Mirrors `TbaPollError`. */
export class TbaEventAlliancesPollError extends Error {
  constructor(eventKey: string, cause: unknown) {
    super(`pollEventAlliances: TBA poll failed for event "${eventKey}"${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "TbaEventAlliancesPollError";
  }
}

/**
 * `GET /event/{key}/rankings`, conditional on `cachedEtag` (quick task
 * 261004-uyc). TBA's own standings for the event: rank, record and Ranking Score
 * per team. The body is returned raw; `liveEventPass.ts` parses it through
 * `tbaEventRankingsResponseSchema` and `normalizeEventRankings` at its own
 * boundary, so a parse failure is confined to the one event it came from. A 200
 * whose body is a bare `null` is a real answer (no ranking structure yet), not a
 * failure. A 304 costs the same ONE request as a 200; see this file's header.
 */
export async function pollEventRankings(ctx: TbaClientContext, eventKey: string, cachedEtag: string | undefined): Promise<TbaConditionalBody> {
  let result: TbaFetchResult;
  try {
    result = await fetchEventRankings(ctx, eventKey, cachedEtag);
  } catch (err) {
    throw new TbaEventRankingsPollError(eventKey, err);
  }
  if (result.status === 304) return { status: "not-modified" };
  return { status: "ok", etag: result.etag, body: result.body, ...(result.lastModified !== undefined ? { lastModified: result.lastModified } : {}) };
}

/**
 * `GET /event/{key}/alliances`, conditional on `cachedEtag` (quick task
 * 261004-uyc). The playoff alliance selection with each alliance's playoff
 * status. Same contract as `pollEventRankings`: raw body, parsed by the caller
 * through `tbaAllianceResponseSchema`, a bare `null` or an empty array being real
 * answers.
 */
export async function pollEventAlliances(ctx: TbaClientContext, eventKey: string, cachedEtag: string | undefined): Promise<TbaConditionalBody> {
  let result: TbaFetchResult;
  try {
    result = await fetchEventAlliances(ctx, eventKey, cachedEtag);
  } catch (err) {
    throw new TbaEventAlliancesPollError(eventKey, err);
  }
  if (result.status === 304) return { status: "not-modified" };
  return { status: "ok", etag: result.etag, body: result.body, ...(result.lastModified !== undefined ? { lastModified: result.lastModified } : {}) };
}
