/**
 * Stubs global `fetch` and asserts: the 304 path records a cache hit and
 * still counts as one request, the non-2xx path throws with the event key,
 * and no thrown message or returned value contains a stubbed key value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTbaContext, pollEventMatches, TbaPollError, TbaRequestCounter } from "../src/tbaPoll.js";
import type { Env } from "../src/env.js";

const STUB_KEY = "test-tba-secret-key-do-not-leak";

function makeEnv(): Env {
  return { DB: {} as unknown, ARTIFACTS: {} as unknown, MANIFEST: {} as unknown, TBA_API_KEY: STUB_KEY, TBA_BASE_URL: "https://tba.example.invalid/api/v3" } as Env;
}

describe("pollEventMatches", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns not-modified on a 304 and records exactly one request (a cache hit, not zero)", async () => {
    fetchMock.mockResolvedValue({ status: 304, ok: false, headers: new Map(), json: async () => ({}) });
    const counter = new TbaRequestCounter();
    const ctx = createTbaContext(makeEnv(), counter);

    const result = await pollEventMatches(ctx, "2026casj", "etag-1");

    expect(result).toEqual({ status: "not-modified" });
    expect(counter.total).toBe(1);
    expect(counter.cacheHits).toBe(1);
    expect(counter.fresh).toBe(0);
  });

  it("returns ok with the match body and etag on a 200, recorded as fresh", async () => {
    const body = [{ key: "2026casj_qm1" }];
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: (name: string) => (name === "etag" ? "etag-2" : null) },
      json: async () => body,
    });
    const counter = new TbaRequestCounter();
    const ctx = createTbaContext(makeEnv(), counter);

    const result = await pollEventMatches(ctx, "2026casj", undefined);

    expect(result).toEqual({ status: "ok", etag: "etag-2", matches: body });
    expect(counter.total).toBe(1);
    expect(counter.fresh).toBe(1);
    expect(counter.cacheHits).toBe(0);
  });

  it("throws a named TbaPollError whose message contains the event key on a non-2xx, non-304 response", async () => {
    fetchMock.mockResolvedValue({ status: 500, ok: false, headers: new Map(), json: async () => ({}) });
    const counter = new TbaRequestCounter();
    const ctx = createTbaContext(makeEnv(), counter);

    await expect(pollEventMatches(ctx, "2026casj", undefined)).rejects.toBeInstanceOf(TbaPollError);
    try {
      await pollEventMatches(ctx, "2026casj", undefined);
      expect.fail("expected pollEventMatches to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("2026casj");
    }
  });

  it("requests against env.TBA_BASE_URL (D-20's override point), never a hardcoded host", async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true, headers: { get: () => null }, json: async () => [] });
    const counter = new TbaRequestCounter();
    const ctx = createTbaContext({ ...makeEnv(), TBA_BASE_URL: "https://fixture.example.invalid/api/v3" }, counter);

    await pollEventMatches(ctx, "2026casj", undefined);

    const [requestUrl] = fetchMock.mock.calls[0] as [string];
    expect(String(requestUrl)).toBe("https://fixture.example.invalid/api/v3/event/2026casj/matches");
  });

  it("never leaks the stubbed TBA key value in a thrown error message or a returned value", async () => {
    fetchMock.mockResolvedValue({ status: 500, ok: false, headers: new Map(), json: async () => ({}) });
    const counter = new TbaRequestCounter();
    const ctx = createTbaContext(makeEnv(), counter);

    try {
      await pollEventMatches(ctx, "2026casj", undefined);
      expect.fail("expected pollEventMatches to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain(STUB_KEY);
    }

    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => ({ ok: true }),
    });
    const okResult = await pollEventMatches(ctx, "2026casj", undefined);
    expect(JSON.stringify(okResult)).not.toContain(STUB_KEY);

    // The outbound request itself carries the key only in the auth header,
    // never the URL or body — confirm the fetch call's URL never contains it.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain(STUB_KEY);
    }
  });
});
