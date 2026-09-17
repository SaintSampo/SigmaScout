/**
 * Offline coverage for the post-deploy asset check (quick task 260917-hul).
 *
 * NO NETWORK: `checkDeployedAssets` takes its `fetch` as an argument, so every
 * verdict here is driven by a fake edge that can serve one thing bare and a
 * different thing to a request carrying an `Origin` header — which is exactly
 * what the real edge did on 2026-09-17.
 */
import { describe, expect, it, vi } from "vitest";
import { checkDeployedAssets, extractAssetUrls, failureMessages, formatReport, main, type FetchLike } from "./checkDeployedAssets.js";

const BASE = "https://sigmascout.org";
const JS = `${BASE}/assets/index-B2Zy6h0g.js`;
const PRELOAD = `${BASE}/assets/schemas-AVUJaT2V.js`;
const CSS = `${BASE}/assets/index-DdAx08y9.css`;

/** The real shipped shape: Vite's `crossorigin` is what makes browsers send `Origin`. */
const HTML = `<!doctype html>
<html lang="en">
  <head>
    <link rel="preconnect" href="https://data.sigmascout.org" crossorigin="">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <script type="module" crossorigin src="/assets/index-B2Zy6h0g.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/schemas-AVUJaT2V.js">
    <link rel="stylesheet" crossorigin href="/assets/index-DdAx08y9.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

interface Served {
  readonly status?: number;
  readonly contentType?: string;
  readonly cfCacheStatus?: string;
  readonly age?: string;
  readonly etag?: string;
  readonly body?: string;
  readonly throws?: string;
}

const JS_OK: Served = { contentType: "application/javascript", cfCacheStatus: "HIT", age: "704", etag: '"js-a"', body: "export const a=1;" };
const CSS_OK: Served = { contentType: "text/css", cfCacheStatus: "HIT", age: "704", etag: '"css-a"', body: ":root{}" };
/** What the poisoned edge returned: the SPA fallback, status 200, hard-cached. */
const SPA_FALLBACK: Served = { contentType: "text/html; charset=utf-8", cfCacheStatus: "HIT", age: "1051", etag: '"html-a"', body: HTML };

function toResponse(served: Served): Response {
  const headers = new Headers();
  if (served.contentType !== undefined) headers.set("content-type", served.contentType);
  if (served.cfCacheStatus !== undefined) headers.set("cf-cache-status", served.cfCacheStatus);
  if (served.age !== undefined) headers.set("age", served.age);
  if (served.etag !== undefined) headers.set("etag", served.etag);
  return new Response(served.body ?? "", { status: served.status ?? 200, headers });
}

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
}

interface EdgeSpec {
  /** `undefined` means the document request throws. */
  readonly document?: Served;
  /** Per URL: what a bare request gets, and what a request carrying `Origin` gets. */
  readonly assets: Readonly<Record<string, { readonly plain: Served; readonly origin: Served }>>;
}

function fakeEdge(spec: EdgeSpec): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const headers = init?.headers ?? {};
    calls.push({ url, headers });
    if (url === BASE) {
      if (spec.document === undefined) return Promise.reject(new Error("getaddrinfo ENOTFOUND sigmascout.org"));
      return Promise.resolve(toResponse(spec.document));
    }
    const entry = spec.assets[url];
    if (entry === undefined) return Promise.reject(new Error(`the test edge has no route for ${url}`));
    const served = headers["Origin"] === undefined ? entry.plain : entry.origin;
    if (served.throws !== undefined) return Promise.reject(new Error(served.throws));
    return Promise.resolve(toResponse(served));
  };
  return { fetchImpl, calls };
}

function healthyEdge(overrides: EdgeSpec["assets"] = {}): ReturnType<typeof fakeEdge> {
  return fakeEdge({
    document: { contentType: "text/html; charset=utf-8", body: HTML },
    assets: {
      [JS]: { plain: JS_OK, origin: JS_OK },
      [PRELOAD]: { plain: JS_OK, origin: JS_OK },
      [CSS]: { plain: CSS_OK, origin: CSS_OK },
      ...overrides,
    },
  });
}

describe("extractAssetUrls", () => {
  it("collects the module script, the modulepreload and the stylesheet, in document order", () => {
    expect(extractAssetUrls(HTML, BASE)).toEqual([JS, PRELOAD, CSS]);
  });

  it("skips cross-origin references and same-origin paths outside /assets/", () => {
    const html = `<link rel="preconnect" href="https://data.sigmascout.org/assets/x.js"><link href="/favicon.svg"><script src="/assets/a.js"></script>`;
    expect(extractAssetUrls(html, BASE)).toEqual([`${BASE}/assets/a.js`]);
  });

  it("de-duplicates a URL referenced twice", () => {
    const html = `<link rel="modulepreload" href="/assets/a.js"><script src="/assets/a.js"></script>`;
    expect(extractAssetUrls(html, BASE)).toEqual([`${BASE}/assets/a.js`]);
  });
});

describe("checkDeployedAssets", () => {
  it("PASSES when every asset is served identically bare and with an Origin header", async () => {
    const report = await checkDeployedAssets({ base: BASE, fetchImpl: healthyEdge().fetchImpl });
    expect(report.ok).toBe(true);
    expect(failureMessages(report)).toEqual([]);
    expect(report.assets.map((a) => a.url)).toEqual([JS, PRELOAD, CSS]);
    expect(formatReport(report)).toContain("PASS");
    expect(formatReport(report)).toContain("3 referenced asset(s)");
  });

  it("FAILS, naming the URL, when only the Origin-carrying request is served HTML (the 2026-09-17 outage)", async () => {
    const { fetchImpl } = healthyEdge({ [JS]: { plain: JS_OK, origin: SPA_FALLBACK } });
    const report = await checkDeployedAssets({ base: BASE, fetchImpl });

    expect(report.ok).toBe(false);
    const messages = failureMessages(report);
    expect(messages.some((m) => m.includes(JS))).toBe(true);
    // Specifically the poisoned-cache rule, not merely a message that happens to
    // quote `text/html` inside a variant dump (a mutation check caught exactly
    // that loophole in an earlier draft of this assertion).
    expect(messages.some((m) => m.includes(JS) && m.includes("poisoned-cache failure"))).toBe(true);
    // The two variants disagreeing is reported as its own distinct problem.
    expect(messages.some((m) => m.includes("disagree on content-type"))).toBe(true);
    // The other two assets are well and must not be smeared as failures.
    expect(report.assets.filter((a) => a.failures.length > 0).map((a) => a.url)).toEqual([JS]);
  });

  it("reports cf-cache-status and Age for both variants, and the Purge Everything remedy", async () => {
    const { fetchImpl } = healthyEdge({ [JS]: { plain: JS_OK, origin: SPA_FALLBACK } });
    const text = formatReport(await checkDeployedAssets({ base: BASE, fetchImpl }));
    expect(text).toContain("cf-cache-status=HIT");
    expect(text).toContain("Age=704");
    expect(text).toContain("Age=1051");
    expect(text).toContain("Purge Everything");
    expect(text).toContain("single-file purge");
  });

  it("FAILS when BOTH variants serve HTML — the variants agree, so only the HTML rule can catch it", async () => {
    const { fetchImpl } = healthyEdge({ [JS]: { plain: SPA_FALLBACK, origin: SPA_FALLBACK } });
    const report = await checkDeployedAssets({ base: BASE, fetchImpl });

    expect(report.ok).toBe(false);
    expect(failureMessages(report).some((m) => m.includes(JS) && m.includes("poisoned-cache failure"))).toBe(true);
    // Nothing disagrees here, so a check built only on variant comparison would pass this.
    expect(failureMessages(report).some((m) => m.includes("disagree"))).toBe(false);
  });

  it("FAILS when an asset 404s", async () => {
    const missing: Served = { status: 404, contentType: "text/plain", body: "not found" };
    const { fetchImpl } = healthyEdge({ [CSS]: { plain: missing, origin: missing } });
    const report = await checkDeployedAssets({ base: BASE, fetchImpl });

    expect(report.ok).toBe(false);
    expect(failureMessages(report).some((m) => m.includes(CSS) && m.includes("HTTP 404"))).toBe(true);
  });

  it("does NOT print the Purge Everything remedy for failures a purge cannot fix", async () => {
    const missing: Served = { status: 404, contentType: "text/plain", body: "not found" };
    const { fetchImpl } = healthyEdge({ [CSS]: { plain: missing, origin: missing } });
    const notPoisoned = formatReport(await checkDeployedAssets({ base: BASE, fetchImpl }));
    expect(notPoisoned).toContain("FAIL");
    expect(notPoisoned).toContain("HTTP 404");
    expect(notPoisoned).not.toContain("Purge Everything");

    const unreachable = formatReport(await checkDeployedAssets({ base: BASE, fetchImpl: fakeEdge({ assets: {} }).fetchImpl }));
    expect(unreachable).not.toContain("Purge Everything");
  });

  it("FAILS when the two variants disagree on content-type even though neither is HTML", async () => {
    const { fetchImpl } = healthyEdge({ [PRELOAD]: { plain: JS_OK, origin: { ...JS_OK, contentType: "application/octet-stream" } } });
    const report = await checkDeployedAssets({ base: BASE, fetchImpl });

    expect(report.ok).toBe(false);
    expect(failureMessages(report).some((m) => m.includes(PRELOAD) && m.includes("disagree on content-type"))).toBe(true);
  });

  it("FAILS when the two variants carry different strong ETags — one URL, two cached objects", async () => {
    const { fetchImpl } = healthyEdge({ [JS]: { plain: JS_OK, origin: { ...JS_OK, etag: '"js-b"', age: "1051" } } });
    const report = await checkDeployedAssets({ base: BASE, fetchImpl });

    expect(report.ok).toBe(false);
    expect(failureMessages(report).some((m) => m.includes(JS) && m.includes("strong ETag"))).toBe(true);
  });

  it("ignores weak or absent ETags, which prove nothing about identity", async () => {
    const { fetchImpl } = healthyEdge({
      [JS]: { plain: { ...JS_OK, etag: 'W/"js-a"' }, origin: { ...JS_OK, etag: 'W/"js-b"' } },
      [CSS]: { plain: { ...CSS_OK, etag: undefined }, origin: CSS_OK },
    });
    const report = await checkDeployedAssets({ base: BASE, fetchImpl });
    expect(failureMessages(report)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("FAILS loudly rather than vacuously passing when the document references no assets", async () => {
    const { fetchImpl, calls } = fakeEdge({ document: { contentType: "text/html", body: "<html><body>nothing here</body></html>" }, assets: {} });
    const report = await checkDeployedAssets({ base: BASE, fetchImpl });

    expect(report.ok).toBe(false);
    expect(report.assets).toEqual([]);
    expect(failureMessages(report).some((m) => m.includes("references no same-origin /assets/ URL"))).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([BASE]);
  });

  it("FAILS when the document itself is unreachable", async () => {
    const { fetchImpl } = fakeEdge({ assets: {} });
    const report = await checkDeployedAssets({ base: BASE, fetchImpl });

    expect(report.ok).toBe(false);
    expect(failureMessages(report).some((m) => m.includes("the document request failed"))).toBe(true);
  });

  it("FAILS when an asset request throws", async () => {
    const { fetchImpl } = healthyEdge({ [CSS]: { plain: JS_OK, origin: { throws: "socket hang up" } } });
    const report = await checkDeployedAssets({ base: BASE, fetchImpl });

    expect(report.ok).toBe(false);
    expect(failureMessages(report).some((m) => m.includes(CSS) && m.includes("socket hang up"))).toBe(true);
  });

  it("requests each asset twice: once bare, once with Origin and the browser-shaped Sec-Fetch headers for its kind", async () => {
    const { fetchImpl, calls } = healthyEdge();
    await checkDeployedAssets({ base: BASE, fetchImpl });

    const assetCalls = calls.filter((c) => c.url !== BASE);
    expect(assetCalls).toHaveLength(6);
    expect(assetCalls.filter((c) => c.url === JS).map((c) => c.headers["Origin"])).toEqual([undefined, BASE]);

    const jsOrigin = assetCalls.find((c) => c.url === JS && c.headers["Origin"] !== undefined)!;
    expect(jsOrigin.headers["Sec-Fetch-Dest"]).toBe("script");
    expect(jsOrigin.headers["Sec-Fetch-Mode"]).toBe("cors");
    expect(jsOrigin.headers["Sec-Fetch-Site"]).toBe("same-origin");

    const cssOrigin = assetCalls.find((c) => c.url === CSS && c.headers["Origin"] !== undefined)!;
    expect(cssOrigin.headers["Sec-Fetch-Dest"]).toBe("style");
  });

  it("never appends a cache-busting query string — the cached object is the thing under test", async () => {
    const { fetchImpl, calls } = healthyEdge();
    await checkDeployedAssets({ base: BASE, fetchImpl });
    expect(calls.every((c) => !c.url.includes("?"))).toBe(true);
  });

  it("tolerates a --base with a trailing slash", async () => {
    const { fetchImpl, calls } = healthyEdge();
    const report = await checkDeployedAssets({ base: `${BASE}/`, fetchImpl });
    expect(report.ok).toBe(true);
    expect(calls[0]!.url).toBe(BASE);
  });
});

describe("main", () => {
  it("returns 0 and prints a PASS line on a healthy site", async () => {
    const { fetchImpl } = healthyEdge();
    vi.stubGlobal("fetch", fetchImpl);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(await main(["--base", BASE])).toBe(0);
      expect(log.mock.calls[0]![0]).toContain("PASS");
    } finally {
      log.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("returns 1 and emits a parseable report under --json on a poisoned site", async () => {
    const { fetchImpl } = healthyEdge({ [JS]: { plain: JS_OK, origin: SPA_FALLBACK } });
    vi.stubGlobal("fetch", fetchImpl);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(await main(["--base", BASE, "--json"])).toBe(1);
      const parsed = JSON.parse(String(log.mock.calls[0]![0])) as { ok: boolean; assets: { url: string; failures: string[] }[] };
      expect(parsed.ok).toBe(false);
      expect(parsed.assets.find((a) => a.url === JS)!.failures.length).toBeGreaterThan(0);
    } finally {
      log.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("refuses an unknown flag rather than silently ignoring it", async () => {
    await expect(main(["--purge"])).rejects.toThrow();
  });
});
