/**
 * TBA client tests (DATA-01 Task 2): conditional-request headers, cache-hit
 * vs. fresh handling, error surfacing, request counting, and throttling —
 * all against a mocked global fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAllTeams,
  fetchEventAlliances,
  fetchEventDetail,
  fetchEventMatches,
  fetchEventRankings,
  fetchEventTeams,
  fetchEventsList,
  fetchMatchDetail,
  fetchStatus,
  fetchTeamDetail,
  fetchTeamMedia,
  TbaRequestCounter,
  tbaFetch,
  THROTTLE_INTERVAL_MS,
  type TbaClientContext,
} from "./tbaClient.js";

function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers();
  if (init.etag) headers.set("etag", init.etag);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

describe("tbaFetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends If-None-Match when a cached ETag is supplied", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { etag: "\"abc\"" }));

    await tbaFetch("/status", "key", "\"cached-etag\"");

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe("\"cached-etag\"");
  });

  it("omits If-None-Match when no cached ETag is supplied", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await tbaFetch("/status", "key", undefined);

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBeUndefined();
  });

  it("returns a cache-hit result carrying no body on 304", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));

    const result = await tbaFetch("/status", "key", "\"cached-etag\"");

    expect(result).toEqual({ status: 304 });
  });

  it("persists the returned ETag for a 200 response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, { etag: "\"new-etag\"" }));

    const result = await tbaFetch("/status", "key", undefined);

    expect(result.status).toBe(200);
    expect(result.status === 200 && result.etag).toBe("\"new-etag\"");
  });

  it("throws with the request path and status for a non-OK, non-304 response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    await expect(tbaFetch("/event/2024casj", "key", undefined)).rejects.toThrow(
      /\/event\/2024casj.*500/
    );
  });

  it("tallies 304 and 200 responses separately on a shared counter", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ a: 1 }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(jsonResponse({ b: 2 }));

    const counter = new TbaRequestCounter();
    await tbaFetch("/a", "key", undefined, counter);
    await tbaFetch("/b", "key", "\"etag\"", counter);
    await tbaFetch("/c", "key", undefined, counter);

    expect(counter.fresh).toBe(2);
    expect(counter.cacheHits).toBe(1);
    expect(counter.total).toBe(3);
  });

  it("separates consecutive requests by at least the throttle interval", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));

    const start = Date.now();
    await tbaFetch("/a", "key", undefined);
    await tbaFetch("/b", "key", undefined);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(THROTTLE_INTERVAL_MS);
  });
});

describe("capability surface", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let ctx: TbaClientContext;

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])));
    vi.stubGlobal("fetch", fetchMock);
    ctx = { apiKey: "key", counter: new TbaRequestCounter() };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes exactly the eleven COVERAGE.md INTEGRATE capabilities", async () => {
    await fetchStatus(ctx);
    await fetchTeamDetail(ctx, "frc254");
    await fetchEventsList(ctx, 2024);
    await fetchEventDetail(ctx, "2024casj");
    await fetchEventTeams(ctx, "2024casj");
    await fetchEventMatches(ctx, "2024casj");
    await fetchMatchDetail(ctx, "2024casj_qm1");
    await fetchAllTeams(ctx, 2024); // default mock returns [] -> a single (empty) page
    await fetchTeamMedia(ctx, "frc254", 2024);
    await fetchEventRankings(ctx, "2024casj");
    await fetchEventAlliances(ctx, "2024casj");

    const requestedPaths = fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname);
    expect(requestedPaths).toEqual(
      expect.arrayContaining([
        "/api/v3/status",
        "/api/v3/team/frc254",
        "/api/v3/events/2024",
        "/api/v3/event/2024casj",
        "/api/v3/event/2024casj/teams",
        "/api/v3/event/2024casj/matches",
        "/api/v3/match/2024casj_qm1",
        "/api/v3/teams/2024/0",
        "/api/v3/team/frc254/media/2024",
        "/api/v3/event/2024casj/rankings",
        "/api/v3/event/2024casj/alliances",
      ])
    );
  });

  it("paginates fetchAllTeams until an empty page is returned", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ key: "frc1" }]))
      .mockResolvedValueOnce(jsonResponse([{ key: "frc2" }]))
      .mockResolvedValueOnce(jsonResponse([]));

    const pages = await fetchAllTeams(ctx, 2024);

    expect(pages).toHaveLength(3);
    expect(pages[2]?.body).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fetchTeamMedia issues /team/{key}/media/{year} and forwards a cached ETag as a conditional request header (plan 06-03 Task 2)", async () => {
    await fetchTeamMedia(ctx, "frc254", 2024, "\"cached-media-etag\"");

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/v3/team/frc254/media/2024");
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe("\"cached-media-etag\"");
  });

  it("fetchEventAlliances issues /event/{key}/alliances and forwards a cached ETag as a conditional request header (D-18.7, plan 07-03)", async () => {
    await fetchEventAlliances(ctx, "2024casj", "\"cached-alliances-etag\"");

    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/v3/event/2024casj/alliances");
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBe("\"cached-alliances-etag\"");
  });
});
