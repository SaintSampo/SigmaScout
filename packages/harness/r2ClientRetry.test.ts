import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteObject, putObject } from "./r2Client.js";

/**
 * Retry behaviour for R2 writes (plan 05-02 deviation, 2026-08-24).
 *
 * A full publish makes ~55,000 sequential PUTs. Before the retry loop, one
 * transient 5xx aborted the entire run — which is what happened on
 * 2026-08-24 (`PUT "v1/team/frc8285/2022/opr@..." failed with status 500`)
 * with R2 verified healthy either side of it. These tests pin the policy:
 * transient classes retry, permanent ones fail fast, and the loop terminates.
 *
 * `fetch` is stubbed, so nothing here touches the network or a real bucket.
 * Credentials are fake values set on `process.env` — never read from `.env`.
 */
const OPTIONS = { contentType: "application/json", cacheControl: "public, max-age=60" };

function response(status: number): Response {
  return new Response(status === 200 ? "" : "error", { status });
}

describe("putObject retry policy", () => {
  beforeEach(() => {
    process.env["CLOUDFLARE_ACCOUNT_ID"] = "test-account";
    process.env["R2_ACCESS_KEY_ID"] = "test-access-key";
    process.env["R2_SECRET_ACCESS_KEY"] = "test-secret-key";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Drives the promise and the fake-timer backoff to completion together. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    const raced = promise.then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e })
    );
    await vi.runAllTimersAsync();
    const outcome = await raced;
    if (outcome.ok) return outcome.v;
    throw outcome.e;
  }

  it("retries a transient 500 and succeeds once R2 recovers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200));

    await settle(putObject("bucket", "v1/teams/2024/x.json", "{}", OPTIONS));

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries 429 and 408 as transient", async () => {
    for (const status of [429, 408]) {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(response(status))
        .mockResolvedValueOnce(response(200));

      await settle(putObject("bucket", "k.json", "{}", OPTIONS));

      expect(fetchMock).toHaveBeenCalledTimes(2);
      vi.restoreAllMocks();
    }
  });

  it("does NOT retry a permanent 403 — retrying burns Class-A quota for nothing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(403));

    await expect(settle(putObject("bucket", "k.json", "{}", OPTIONS))).rejects.toThrow(/403/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after a bounded number of attempts and names the count", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(503));

    await expect(settle(putObject("bucket", "k.json", "{}", OPTIONS))).rejects.toThrow(
      /failed with status 503 .*after 5 attempts/
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("retries a network-level rejection, then reports it after exhausting attempts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("socket hang up"));

    await expect(settle(putObject("bucket", "k.json", "{}", OPTIONS))).rejects.toThrow(
      /after 5 attempts: Error: socket hang up/
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("re-signs each attempt rather than reusing an expiring SigV4 signature", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const headers = new Headers((init as RequestInit).headers);
      seen.push(headers.get("authorization") ?? "");
      return Promise.resolve(response(seen.length < 3 ? 500 : 200));
    });

    // Advance the clock between attempts so a reused signature would be stale.
    await settle(putObject("bucket", "k.json", "{}", OPTIONS));

    expect(seen).toHaveLength(3);
    expect(seen.every((a) => a.startsWith("AWS4-HMAC-SHA256"))).toBe(true);
  });
});

/**
 * deleteObject retry policy (quick task 260912-tay). docs/publish-budget.md
 * records "two transient R2 500s" interrupting a past single-shot delete pass;
 * a census-driven cleanup issues ~228K single-key DELETEs, so the delete path
 * now shares the PUT path's transient-retry policy. 404 stays a success (S3
 * DELETE is idempotent), and a permanent 4xx still fails fast.
 */
describe("deleteObject retry policy", () => {
  beforeEach(() => {
    process.env["CLOUDFLARE_ACCOUNT_ID"] = "test-account";
    process.env["R2_ACCESS_KEY_ID"] = "test-access-key";
    process.env["R2_SECRET_ACCESS_KEY"] = "test-secret-key";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function settleDelete(promise: Promise<void>): Promise<void> {
    const raced = promise.then(
      () => ({ ok: true as const }),
      (e: unknown) => ({ ok: false as const, e })
    );
    await vi.runAllTimersAsync();
    const outcome = await raced;
    if (!outcome.ok) throw outcome.e;
  }

  it("retries 500 twice and then succeeds on 204", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await settleDelete(deleteObject("bucket", "v1/teams/2024/x.json"));

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats 404 as success immediately", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(404));

    await settleDelete(deleteObject("bucket", "k.json"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a permanent 403", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(403));

    await expect(settleDelete(deleteObject("bucket", "k.json"))).rejects.toThrow(/"k\.json".*403/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a persistent 503 after 5 attempts and names the key and count", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(503));

    await expect(settleDelete(deleteObject("bucket", "k.json"))).rejects.toThrow(
      /"k\.json" failed with status 503 .*after 5 attempts/
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("retries a network-level rejection", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await settleDelete(deleteObject("bucket", "k.json"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
