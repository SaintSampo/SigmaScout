/**
 * ETag-conditional TBA v3 fetch (DATA-01). Base URL and `X-TBA-Auth-Key`
 * header per RESEARCH.md's "TBA client with ETag conditional requests"
 * example (sourced from TBA's own "Efficiently Querying the TBA API" blog
 * post). The API key is a parameter read from the environment by the
 * caller — this module never logs it and never embeds it in a returned
 * value.
 *
 * Hardened for a full 2022-2026 backfill (Plan 03 Task 2): every outbound
 * request is throttled and tallied so a five-season run stays measurable
 * and bounded (T-01-04), and the client exposes helpers for exactly the
 * eight capabilities COVERAGE.md marks INTEGRATE — status, teams-list
 * (paginated), team-detail, events-list, event-detail, event-teams,
 * event-matches, and match-detail — and none marked OPT-OUT.
 */

const TBA_BASE = "https://www.thebluealliance.com/api/v3";
/** Exported so a caller building a `TbaClientContext` can name the real default explicitly (plan 04-07's `baseUrl` override — see `TbaClientContext.baseUrl`'s own doc comment for why this exists and what it does NOT change). */
export const DEFAULT_TBA_BASE_URL = TBA_BASE;

/**
 * Minimum time between outbound TBA requests. Conditional requests
 * (If-None-Match) already make a *repeat* run cheap (304s), but this bounds
 * the *first* run, which is the one that actually downloads a full
 * season's worth of payloads against a free, volunteer-run service
 * (T-01-04). Enforced inside tbaFetch so no call site can bypass it.
 */
export const THROTTLE_INTERVAL_MS = 100;

export type TbaFetchResult =
  | { status: 304 }
  | { status: 200; etag: string | undefined; body: unknown };

/** Tallies a run's request volume against TBA — persisted to `ingest_runs` so cost is measured, not assumed (T-01-06). */
export class TbaRequestCounter {
  #cacheHits = 0;
  #fresh = 0;

  recordCacheHit(): void {
    this.#cacheHits++;
  }

  recordFresh(): void {
    this.#fresh++;
  }

  /** 304 responses. */
  get cacheHits(): number {
    return this.#cacheHits;
  }

  /** 200 responses. */
  get fresh(): number {
    return this.#fresh;
  }

  /** Total requests made (cacheHits + fresh). */
  get total(): number {
    return this.#cacheHits + this.#fresh;
  }
}

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < THROTTLE_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

export async function tbaFetch(
  path: string,
  apiKey: string,
  cachedEtag: string | undefined,
  counter?: TbaRequestCounter,
  baseUrl: string = TBA_BASE
): Promise<TbaFetchResult> {
  await throttle();

  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      "X-TBA-Auth-Key": apiKey,
      ...(cachedEtag ? { "If-None-Match": cachedEtag } : {}),
    },
  });

  if (res.status === 304) {
    counter?.recordCacheHit();
    return { status: 304 };
  }
  if (!res.ok) {
    throw new Error(`TBA request failed: ${path} -> HTTP ${res.status}`);
  }
  counter?.recordFresh();
  return { status: 200, etag: res.headers.get("etag") ?? undefined, body: await res.json() };
}

export interface TbaClientContext {
  apiKey: string;
  counter: TbaRequestCounter;
  /**
   * D-20 (plan 04-07): overrides `DEFAULT_TBA_BASE_URL` — the ONE substitution
   * point that lets the replay rig point a real deployed Worker at a recorded
   * fixture endpoint instead of the real TBA API, without touching
   * `THROTTLE_INTERVAL_MS`'s spacing or `tbaFetch`'s conditional-request
   * (ETag) handling, which stay identical regardless of which base URL is in
   * effect (D-22: one politeness policy, applied to whichever host is
   * configured). Left `undefined` by every production caller (the real
   * ingest pipeline, `apps/worker/src/tbaPoll.ts`'s production default) —
   * only a rig/test ever sets this.
   */
  baseUrl?: string;
}

// --- The eight capabilities COVERAGE.md marks INTEGRATE ---------------

/** `GET /status` — datafeed health, checked once at the start of a run. */
export function fetchStatus(ctx: TbaClientContext, cachedEtag?: string): Promise<TbaFetchResult> {
  return tbaFetch("/status", ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}

/** `GET /team/{key}` */
export function fetchTeamDetail(
  ctx: TbaClientContext,
  teamKey: string,
  cachedEtag?: string
): Promise<TbaFetchResult> {
  return tbaFetch(`/team/${teamKey}`, ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}

/** `GET /events/{year}` — bulk event list for a season. */
export function fetchEventsList(
  ctx: TbaClientContext,
  year: number,
  cachedEtag?: string
): Promise<TbaFetchResult> {
  return tbaFetch(`/events/${year}`, ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}

/** `GET /event/{key}` */
export function fetchEventDetail(
  ctx: TbaClientContext,
  eventKey: string,
  cachedEtag?: string
): Promise<TbaFetchResult> {
  return tbaFetch(`/event/${eventKey}`, ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}

/** `GET /event/{key}/teams` */
export function fetchEventTeams(
  ctx: TbaClientContext,
  eventKey: string,
  cachedEtag?: string
): Promise<TbaFetchResult> {
  return tbaFetch(`/event/${eventKey}/teams`, ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}

/** `GET /event/{key}/matches` */
export function fetchEventMatches(
  ctx: TbaClientContext,
  eventKey: string,
  cachedEtag?: string
): Promise<TbaFetchResult> {
  return tbaFetch(`/event/${eventKey}/matches`, ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}

/** `GET /match/{key}` */
export function fetchMatchDetail(
  ctx: TbaClientContext,
  matchKey: string,
  cachedEtag?: string
): Promise<TbaFetchResult> {
  return tbaFetch(`/match/${matchKey}`, ctx.apiKey, cachedEtag, ctx.counter, ctx.baseUrl);
}

/**
 * `GET /teams/{year}/{page}` — teams-list with page traversal. The last
 * page returns an empty array. Deliberately un-conditional (no ETag): a
 * cached 304 response carries no body, so pagination can't reliably detect
 * the terminal empty page from a cache hit alone. Teams-list is cheap
 * relative to match payloads (a handful of pages per season vs. thousands
 * of matches), so always fetching it fresh is a pragmatic, low-cost
 * trade-off rather than the load-bearing conditional-caching path DATA-01
 * targets (that's event-matches/event-detail, which do use ETags).
 */
export async function fetchAllTeams(
  ctx: TbaClientContext,
  year: number
): Promise<{ url: string; body: unknown[] }[]> {
  const pages: { url: string; body: unknown[] }[] = [];
  for (let page = 0; ; page++) {
    const url = `/teams/${year}/${page}`;
    const result = await tbaFetch(url, ctx.apiKey, undefined, ctx.counter, ctx.baseUrl);
    if (result.status !== 200) {
      // Unreachable: fetchAllTeams never supplies a cachedEtag, so tbaFetch
      // can only resolve 200 or throw. Guard kept for exhaustiveness.
      throw new Error(`Unexpected non-200 status while paginating teams for ${year}`);
    }
    const body = Array.isArray(result.body) ? result.body : [];
    pages.push({ url, body });
    if (body.length === 0) break;
  }
  return pages;
}
