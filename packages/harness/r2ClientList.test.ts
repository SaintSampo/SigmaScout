import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalQueryString, deleteObject, getObject, listObjects, parseListObjectsV2Xml, putObject } from "./r2Client.js";

/**
 * Bucket listing (quick task 260912-tay). Listing is the one new R2 capability
 * the census-driven prune tool needs: a full ListObjectsV2 walk is the only
 * measurement that can prove a bulk cleanup, because the earlier 60-key
 * samples reported "nothing orphaned" over a bucket that still held ~11K
 * superseded objects.
 *
 * Every test here is offline: `fetch` is stubbed and the credentials are fake
 * values set on the environment object, exactly as r2ClientRetry.test.ts does.
 * A listing parser that silently under-reads a page would make the census lie
 * in the dangerous direction (a live generation looking small, an orphan
 * looking gone), so the parser's fail-closed cases are pinned one by one.
 */

const FAKE_ACCOUNT = "test-account";
const FAKE_ACCESS_KEY = "test-access-key-id-AKIAFAKE";
const FAKE_SECRET = "test-secret-key-DO-NOT-LEAK";

interface FixtureObject {
  readonly key: string;
  readonly size: number | string;
  readonly lastModified?: string;
}

function contentsXml(o: FixtureObject): string {
  const lm = o.lastModified === undefined ? "" : `<LastModified>${o.lastModified}</LastModified>`;
  return `<Contents><Key>${o.key}</Key>${lm}<ETag>&quot;abc&quot;</ETag><Size>${o.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
}

function pageXml(opts: {
  objects: readonly FixtureObject[];
  isTruncated?: string | undefined;
  nextToken?: string;
  keyCount?: number | "omit";
  requestToken?: string;
}): string {
  const truncated = opts.isTruncated === undefined ? "" : `<IsTruncated>${opts.isTruncated}</IsTruncated>`;
  const next = opts.nextToken === undefined ? "" : `<NextContinuationToken>${opts.nextToken}</NextContinuationToken>`;
  const req = opts.requestToken === undefined ? "" : `<ContinuationToken>${opts.requestToken}</ContinuationToken>`;
  const kc = opts.keyCount === "omit" ? "" : `<KeyCount>${opts.keyCount ?? opts.objects.length}</KeyCount>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<Name>bucket</Name><Prefix></Prefix>${req}${kc}<MaxKeys>1000</MaxKeys>${truncated}${next}` +
    opts.objects.map(contentsXml).join("") +
    `</ListBucketResult>`
  );
}

const LM = "2026-09-01T10:00:00.000Z";

function xmlResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

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

function urlOf(call: unknown[]): string {
  return String(call[0]);
}

function headersOf(call: unknown[]): Headers {
  return new Headers((call[1] as RequestInit).headers);
}

beforeEach(() => {
  process.env["CLOUDFLARE_ACCOUNT_ID"] = FAKE_ACCOUNT;
  process.env["R2_ACCESS_KEY_ID"] = FAKE_ACCESS_KEY;
  process.env["R2_SECRET_ACCESS_KEY"] = FAKE_SECRET;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("canonicalQueryString", () => {
  it("sorts by encoded key and uriEncodes both key and value", () => {
    expect(
      canonicalQueryString([
        ["max-keys", "1000"],
        ["list-type", "2"],
        ["continuation-token", "a+b/c="],
        ["prefix", "v1/manifest/"],
      ])
    ).toBe("continuation-token=a%2Bb%2Fc%3D&list-type=2&max-keys=1000&prefix=v1%2Fmanifest%2F");
  });

  it("encodes the characters encodeURIComponent leaves alone and spaces as %20", () => {
    expect(canonicalQueryString([["k", "a b!'()*~"]])).toBe("k=a%20b%21%27%28%29%2A~");
  });

  it("is the empty string for no params", () => {
    expect(canonicalQueryString([])).toBe("");
  });
});

describe("listObjects request shape", () => {
  it("requests /{bucket} with exactly the canonical query and a SigV4 Authorization header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      xmlResponse(pageXml({ objects: [{ key: "v1/manifest/algorithms.json", size: 10, lastModified: LM }], isTruncated: "false" }))
    );

    const objects = await settle(listObjects("bucket"));

    expect(objects).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = urlOf(fetchMock.mock.calls[0]!);
    expect(url).toBe(`https://${FAKE_ACCOUNT}.r2.cloudflarestorage.com/bucket?list-type=2&max-keys=1000`);
    expect(url).not.toContain("prefix=");
    const auth = headersOf(fetchMock.mock.calls[0]!).get("authorization") ?? "";
    expect(auth.startsWith("AWS4-HMAC-SHA256")).toBe(true);
    const signed = /SignedHeaders=([^,]+)/.exec(auth)?.[1]?.split(";") ?? [];
    expect(signed).toEqual(expect.arrayContaining(["host", "x-amz-content-sha256", "x-amz-date"]));
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("GET");
  });

  it("emits prefix only when given, in sorted position", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(xmlResponse(pageXml({ objects: [], isTruncated: "false" })));

    await settle(listObjects("bucket", { prefix: "v1/manifest/" }));

    expect(urlOf(fetchMock.mock.calls[0]!).split("?")[1]).toBe("list-type=2&max-keys=1000&prefix=v1%2Fmanifest%2F");
  });
});

describe("listObjects pagination", () => {
  it("follows NextContinuationToken across two pages and returns every object", async () => {
    const token = "tok+en/with=chars";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        xmlResponse(
          pageXml({
            objects: [
              { key: "v1/event/2024casf/vpr@1.0.0.json", size: 100, lastModified: LM },
              { key: "v1/event/2024casf/epa@2.0.0.json", size: 200, lastModified: LM },
            ],
            isTruncated: "true",
            nextToken: token,
          })
        )
      )
      .mockResolvedValueOnce(
        xmlResponse(
          pageXml({
            objects: [{ key: "v1/compare/2024.json", size: 300, lastModified: LM }],
            isTruncated: "false",
            requestToken: token,
          })
        )
      );

    const pages: Array<[number, number]> = [];
    const objects = await settle(listObjects("bucket", { onPage: (p, o) => pages.push([p, o]) }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(objects).toEqual([
      { key: "v1/event/2024casf/vpr@1.0.0.json", size: 100, lastModified: LM },
      { key: "v1/event/2024casf/epa@2.0.0.json", size: 200, lastModified: LM },
      { key: "v1/compare/2024.json", size: 300, lastModified: LM },
    ]);
    expect(typeof objects[0]!.size).toBe("number");
    expect(urlOf(fetchMock.mock.calls[1]!).split("?")[1]).toBe(
      "continuation-token=tok%2Ben%2Fwith%3Dchars&list-type=2&max-keys=1000"
    );
    expect(pages).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("throws when a continuation token repeats across pages", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        xmlResponse(pageXml({ objects: [{ key: `k${Math.random()}.json`, size: 1, lastModified: LM }], isTruncated: "true", nextToken: "same" }))
      )
    );

    await expect(settle(listObjects("bucket"))).rejects.toThrow(/repeat/i);
  });

  it("throws when the same key is listed twice across pages", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(xmlResponse(pageXml({ objects: [{ key: "a.json", size: 1, lastModified: LM }], isTruncated: "true", nextToken: "t1" })))
      .mockResolvedValueOnce(xmlResponse(pageXml({ objects: [{ key: "a.json", size: 1, lastModified: LM }], isTruncated: "false" })));

    await expect(settle(listObjects("bucket"))).rejects.toThrow(/duplicate/i);
  });
});

describe("parseListObjectsV2Xml", () => {
  it("decodes XML entities in Key and NextContinuationToken, with &amp; decoded last", () => {
    const parsed = parseListObjectsV2Xml(
      pageXml({
        objects: [{ key: "a&amp;b&lt;c&gt;d&quot;e&apos;f&#65;&#x42;&amp;lt;.json", size: 5, lastModified: LM }],
        isTruncated: "true",
        nextToken: "x&amp;y&#x2F;z&amp;lt;",
      })
    );
    expect(parsed.objects[0]!.key).toBe("a&b<c>d\"e'fAB&lt;.json");
    expect(parsed.nextContinuationToken).toBe("x&y/z&lt;");
    expect(parsed.isTruncated).toBe(true);
    expect(parsed.keyCount).toBe(1);
  });

  it("does not mistake the echoed request ContinuationToken for NextContinuationToken", () => {
    const parsed = parseListObjectsV2Xml(pageXml({ objects: [], isTruncated: "false", requestToken: "old" }));
    expect(parsed.nextContinuationToken).toBeUndefined();
    expect(parsed.isTruncated).toBe(false);
  });

  it("accepts a page with no KeyCount element", () => {
    const parsed = parseListObjectsV2Xml(pageXml({ objects: [{ key: "a.json", size: 1, lastModified: LM }], isTruncated: "false", keyCount: "omit" }));
    expect(parsed.keyCount).toBeUndefined();
    expect(parsed.objects).toHaveLength(1);
  });

  const failClosed: Array<[string, string]> = [
    ["a body with no ListBucketResult", "<Error><Code>AccessDenied</Code></Error>"],
    ["a missing IsTruncated", pageXml({ objects: [] })],
    ["a non-boolean IsTruncated", pageXml({ objects: [], isTruncated: "maybe" })],
    ["IsTruncated true with no NextContinuationToken", pageXml({ objects: [], isTruncated: "true" })],
    ["a KeyCount that differs from the Contents count", pageXml({ objects: [{ key: "a.json", size: 1, lastModified: LM }], isTruncated: "false", keyCount: 2 })],
    ["a Contents with no Key", pageXml({ objects: [], isTruncated: "false", keyCount: 1 }).replace("</ListBucketResult>", `<Contents><Size>1</Size><LastModified>${LM}</LastModified></Contents></ListBucketResult>`)],
    ["a non-integer Size", pageXml({ objects: [{ key: "a.json", size: "1.5", lastModified: LM }], isTruncated: "false" })],
    ["a missing Size", pageXml({ objects: [], isTruncated: "false", keyCount: 1 }).replace("</ListBucketResult>", `<Contents><Key>a.json</Key><LastModified>${LM}</LastModified></Contents></ListBucketResult>`)],
    ["a missing LastModified", pageXml({ objects: [{ key: "a.json", size: 1 }], isTruncated: "false" })],
    ["an unknown XML entity", pageXml({ objects: [{ key: "a&nbsp;.json", size: 1, lastModified: LM }], isTruncated: "false" })],
  ];

  for (const [label, xml] of failClosed) {
    it(`throws on ${label}`, () => {
      expect(() => parseListObjectsV2Xml(xml)).toThrow();
    });
  }
});

describe("listObjects retry policy and error hygiene", () => {
  it("retries a transient 500 and succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(xmlResponse(pageXml({ objects: [], isTruncated: "false" })));

    await settle(listObjects("bucket", { prefix: "v1/manifest/" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 403, and the message names status, bucket and prefix but no credential or URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("denied", { status: 403 }));

    let message = "";
    try {
      await settle(listObjects("my-bucket", { prefix: "v1/manifest/" }));
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(message).toMatch(/403/);
    expect(message).toContain("my-bucket");
    expect(message).toContain("v1/manifest/");
    expect(message).not.toContain(FAKE_ACCESS_KEY);
    expect(message).not.toContain(FAKE_SECRET);
    expect(message).not.toContain(FAKE_ACCOUNT);
    expect(message).not.toContain("https://");
  });

  it("gives up on a persistent 503 after 5 attempts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 503 }));

    await expect(settle(listObjects("bucket"))).rejects.toThrow(/503.*after 5 attempts/);

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("redacts the account host from a network-level rejection message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`getaddrinfo ENOTFOUND ${FAKE_ACCOUNT}.r2.cloudflarestorage.com`));

    let message = "";
    try {
      await settle(listObjects("bucket"));
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toMatch(/after 5 attempts/);
    expect(message).not.toContain(FAKE_ACCOUNT);
  });
});

describe("regression: object-level calls carry no query string", () => {
  it("putObject, getObject and deleteObject URLs have no '?'", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));

    await settle(putObject("bucket", "v1/event/2024casf/vpr@1.0.0+x.json", "{}", { contentType: "application/json", cacheControl: "public, max-age=60" }));
    await settle(getObject("bucket", "v1/event/2024casf/vpr@1.0.0+x.json"));
    await settle(deleteObject("bucket", "v1/event/2024casf/vpr@1.0.0+x.json"));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const url = urlOf(call);
      expect(url).not.toContain("?");
      expect(url).toBe(`https://${FAKE_ACCOUNT}.r2.cloudflarestorage.com/bucket/v1/event/2024casf/vpr%401.0.0%2Bx.json`);
    }
  });
});
