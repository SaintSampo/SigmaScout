/**
 * D-22: a thin Worker wrapper over `packages/ingest/tbaClient.ts` — the SAME
 * TBA client the offline ingest pipeline has used since Phase 1, imported
 * unchanged. This module adds only the three genuinely Worker-specific
 * things: reading the key from `env.TBA_API_KEY` (a Cloudflare secret, never
 * a `.env` value), building the `TbaClientContext`, and mapping one live
 * event key to one `fetchEventMatches` call.
 *
 * It deliberately does NOT re-implement `THROTTLE_INTERVAL_MS`'s spacing or
 * `tbaFetch`'s conditional-request (ETag) handling — both are imported and
 * used exactly as `tbaClient.ts` defines them. A second TBA client is two
 * politeness policies that agree until the day they do not, and the day they
 * do not is a live event (D-22's own reasoning, restated here because this
 * is the file someone editing the live path will open first). The 100ms
 * spacing across up to 38 concurrently live events is ~3.8s of wall clock,
 * which costs nothing against a CPU-time budget — CPU time excludes waiting
 * on the network.
 *
 * A 304 costs exactly the same ONE subrequest as a 200 — conditional
 * requests save bandwidth and downstream CPU, not subrequest budget. Nothing
 * in this file (or `subrequestBudget.ts`) ever treats a cache hit as free.
 *
 * Per-event errors throw with the event key in the message and nothing
 * else — never the TBA key, never a header dump — so the caller (`scheduled.
 * ts`) can catch per event and confine the failure to it (D-15).
 */
import { fetchEventMatches, TbaRequestCounter, THROTTLE_INTERVAL_MS, type TbaClientContext, type TbaFetchResult } from "../../../packages/ingest/tbaClient.js";
import type { Env } from "./env.js";

export { TbaRequestCounter, THROTTLE_INTERVAL_MS };
export type { TbaClientContext, TbaFetchResult };

/** Builds the `TbaClientContext` `pollEventMatches` needs from the Worker's typed `Env` and a counter the caller owns for the whole tick (one counter, shared across every event polled this tick — D-15's own "TBA requests" figure comes from it). */
export function createTbaContext(env: Env, counter: TbaRequestCounter): TbaClientContext {
  return { apiKey: env.TBA_API_KEY, counter };
}

export type PollEventMatchesResult =
  | { readonly status: "not-modified" }
  | { readonly status: "ok"; readonly etag: string | undefined; readonly matches: readonly unknown[] };

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
  return { status: "ok", etag: result.etag, matches: result.body as unknown[] };
}
