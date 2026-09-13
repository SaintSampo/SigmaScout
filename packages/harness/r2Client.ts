/**
 * SigV4-signed R2 object PUT/GET over native `fetch` (D-25, plan 04-01 Task
 * 3). No new dependency: signing is implemented with `node:crypto`'s
 * `createHash`/`createHmac`, matching `.claude/CLAUDE.md`'s standing
 * preference for native `fetch` over an HTTP client library. Region is
 * `"auto"`, service is `"s3"` — R2's S3-compatible endpoint convention.
 *
 * Credential surface (T-04-01/T-04-02): `CLOUDFLARE_ACCOUNT_ID`,
 * `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are read from
 * `process.env` exactly once, inside `credentialsFromEnv`, and the secret
 * access key is touched only inside `signRequest`'s HMAC chain — never
 * logged, returned, or embedded in a request body, mirroring
 * `packages/ingest/tbaClient.ts`'s file-header rule for the TBA key.
 *
 * The `+`/`@` characters `packages/harness/pageArtifacts.ts`'s `artifactKey`
 * puts in every published key are legal URI path characters but must be
 * percent-encoded per RFC 3986 for both the SigV4 canonical request and the
 * actual HTTP request path — `encodePath`/`uriEncode` below do this once, so
 * the signed path and the requested path can never drift apart.
 *
 * Listing and delete retry (quick task 260912-tay, 2026-09-12). `listObjects`
 * adds a paginated, signed ListObjectsV2 walk — the one new R2 capability, and
 * the only measurement that can PROVE a bulk cleanup: the earlier 60-key
 * samples reported "nothing orphaned" over a bucket that a full listing showed
 * still held thousands of superseded objects. One canonical query string
 * (`canonicalQueryString`) is both signed and sent after `?`, so the two cannot
 * drift apart; with no params there is no `?` at all, so every object-level URL
 * and signature is byte-identical to before. `deleteObject` now shares the PUT
 * path's transient-retry policy, because `docs/publish-budget.md`'s git history records "two
 * transient R2 500s" interrupting a past single-shot delete pass. Deletion
 * stays single-key: there is no bulk or prefix DELETE in this file, and none
 * may be added.
 */
import { createHash, createHmac } from "node:crypto";

const REGION = "auto";
const SERVICE = "s3";

interface R2Credentials {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** Reads the three R2 credential values from the environment. Throws (never falls back to a placeholder) when any is missing. */
function credentialsFromEnv(): R2Credentials {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "r2Client: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must all be set in the environment. Populate .env from .env.example."
    );
  }
  return { accountId, accessKeyId, secretAccessKey };
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** AWS-style URI component encoder: `encodeURIComponent` plus the four reserved characters it deliberately leaves alone (`! ' ( ) *`). */
function uriEncode(component: string): string {
  return encodeURIComponent(component).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Encodes every path segment individually and rejoins with literal `/` — the SigV4 canonical-URI convention. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/");
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** One query parameter, as an ordered `[name, value]` pair (unencoded). */
export type QueryParam = readonly [name: string, value: string];

/**
 * The SigV4 canonical query string: every name and value `uriEncode`d, sorted
 * by encoded name (then encoded value) in code-unit order, and joined as
 * `name=value` with `&`. The request URL carries this exact string after `?`,
 * so the signed query and the sent query are one value. Empty input gives "".
 */
export function canonicalQueryString(params: readonly QueryParam[]): string {
  const encoded = params.map(([name, value]) => [uriEncode(name), uriEncode(value)] as const);
  encoded.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return encoded.map(([name, value]) => `${name}=${value}`).join("&");
}

/**
 * The one place the whole credential surface (and the whole SigV4 signing
 * algorithm) lives — `putObject`/`getObject`/`deleteObject`/`listObjects`
 * below are thin callers. `key === undefined` signs the bucket-level path
 * `/{bucket}` (listing). `query` is empty for every object-level call, which
 * keeps those URLs and signatures exactly as they were.
 */
function signRequest(
  method: "PUT" | "GET" | "DELETE",
  credentials: R2Credentials,
  bucket: string,
  key: string | undefined,
  body: string | undefined,
  extraHeaders: Readonly<Record<string, string>>,
  query: readonly QueryParam[] = []
): SignedRequest {
  const host = `${credentials.accountId}.r2.cloudflarestorage.com`;
  const canonicalPath = encodePath(key === undefined ? `/${bucket}` : `/${bucket}/${key}`);
  const canonicalQuery = canonicalQueryString(query);
  const url = `https://${host}${canonicalPath}${canonicalQuery === "" ? "" : `?${canonicalQuery}`}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");

  const headersToSign: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...extraHeaders,
  };

  const signedHeaderNames = Object.keys(headersToSign).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headersToSign[name]!.trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // `host` is deliberately excluded from the headers actually handed to
  // `fetch` below — the runtime sets it from `url` itself with the same
  // value, and some `fetch` implementations reject an explicit override. It
  // stays part of the SIGNED header set above, per the SigV4/S3 convention.
  const { host: _host, ...sendHeaders } = headersToSign;
  return {
    url,
    headers: { ...sendHeaders, Authorization: authorization },
  };
}

/**
 * Retry policy for R2 writes (plan 05-02 deviation, 2026-08-24).
 *
 * A full `publish:seasons` run makes on the order of 55,000 sequential PUTs.
 * Before this, `putObject` issued exactly one `fetch` with no retry, so a
 * single transient 5xx anywhere in that run aborted the whole publish — which
 * is exactly what happened on 2026-08-24 (`PUT "v1/team/frc8285/2022/opr@..."
 * failed with status 500`) after R2 had been verified healthy either side of
 * the failure. At that request count a bare single-shot write is not a
 * reasonable bet, and the same path backs the live-event cron tick, where an
 * aborted run means stale published data during a match.
 *
 * Only *transient* classes are retried: 5xx (server-side), 429 (throttling)
 * and 408 (request timeout), plus network-level `fetch` rejections. A 4xx
 * other than those is a permanent client error — a bad key, bad credentials,
 * a malformed body — and retrying it just burns Class-A operations against
 * the free-tier quota, so it throws immediately.
 */
const PUT_MAX_ATTEMPTS = 5;
const PUT_BASE_DELAY_MS = 250;

function isRetriableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function backoffMs(attempt: number): number {
  return PUT_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * PUT_BASE_DELAY_MS);
}

/** Replaces the account id (it names the endpoint host) in a message, so an error can never leak the request host into a log. */
function redactAccount(message: string, credentials: R2Credentials): string {
  return credentials.accountId === "" ? message : message.split(credentials.accountId).join("<account>");
}

/**
 * The shared transient-retry loop for `deleteObject` and `listObjects` — the
 * same policy `putObject` pins (`PUT_MAX_ATTEMPTS`, exponential backoff plus
 * jitter, network rejections retried, a fresh signature per attempt via
 * `send`). `isSuccess` decides which statuses end the loop successfully. The
 * thrown message is `r2Client.{op}: {label} failed ...`: it names the label the
 * caller built (a key, or a bucket and prefix) and the status, never the URL, a
 * header or a credential. `putObject` keeps its own loop, unchanged, because its
 * error strings are pinned by r2ClientRetry.test.ts.
 */
async function sendWithRetry(
  op: string,
  label: string,
  credentials: R2Credentials,
  send: () => Promise<Response>,
  isSuccess: (status: number) => boolean
): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await send();
    } catch (cause) {
      if (attempt >= PUT_MAX_ATTEMPTS) {
        throw new Error(
          redactAccount(`r2Client.${op}: ${label} failed after ${attempt} attempts: ${String(cause)}`, credentials)
        );
      }
      await delay(backoffMs(attempt));
      continue;
    }

    if (isSuccess(response.status)) return response;

    if (!isRetriableStatus(response.status) || attempt >= PUT_MAX_ATTEMPTS) {
      const suffix = attempt > 1 ? ` after ${attempt} attempts` : "";
      throw new Error(
        redactAccount(
          `r2Client.${op}: ${label} failed with status ${response.status} ${response.statusText}${suffix}`,
          credentials
        )
      );
    }

    await delay(backoffMs(attempt));
  }
}

/**
 * PUTs `body` to `{bucket}/{key}` on R2's S3-compatible endpoint.
 * `options.contentType`/`options.cacheControl` are sent verbatim as the
 * `Content-Type`/`Cache-Control` headers (D-26 — the publisher passes
 * `application/json` and `public, max-age=60`). Throws on any non-2xx
 * response, with the status and the key in the message.
 *
 * Transient failures are retried with exponential backoff plus jitter (see
 * the retry-policy note above). Each attempt re-signs the request rather than
 * reusing the first signature: SigV4 embeds `x-amz-date`, so a signature
 * reused across a backoff window is a correctness hazard, not just a style
 * point. The thrown message names the attempt count so an exhausted retry is
 * distinguishable in a log from a first-shot failure.
 */
export async function putObject(
  bucket: string,
  key: string,
  body: string,
  options: { contentType: string; cacheControl: string }
): Promise<void> {
  const credentials = credentialsFromEnv();

  for (let attempt = 1; attempt <= PUT_MAX_ATTEMPTS; attempt += 1) {
    const signed = signRequest("PUT", credentials, bucket, key, body, {
      "content-type": options.contentType,
      "cache-control": options.cacheControl,
    });

    let response: Response;
    try {
      response = await fetch(signed.url, {
        method: "PUT",
        headers: signed.headers,
        body,
      });
    } catch (cause) {
      // Network-level failure (DNS, socket reset, TLS). Transient by nature.
      if (attempt === PUT_MAX_ATTEMPTS) {
        throw new Error(
          `r2Client.putObject: PUT "${key}" failed after ${attempt} attempts: ${String(cause)}`
        );
      }
      await delay(PUT_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * PUT_BASE_DELAY_MS));
      continue;
    }

    if (response.ok) return;

    if (!isRetriableStatus(response.status) || attempt === PUT_MAX_ATTEMPTS) {
      const suffix = attempt > 1 ? ` after ${attempt} attempts` : "";
      throw new Error(
        `r2Client.putObject: PUT "${key}" failed with status ${response.status} ${response.statusText}${suffix}`
      );
    }

    await delay(PUT_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * PUT_BASE_DELAY_MS));
  }
}

/**
 * GETs `{bucket}/{key}` from R2's S3-compatible endpoint (used by tests and
 * any future server-side read path — the client's own reads go through the
 * public `R2_PUBLIC_BASE_URL`, unsigned, never this function). Throws on any
 * non-2xx response, with the status and the key in the message.
 */
export async function getObject(bucket: string, key: string): Promise<string> {
  const credentials = credentialsFromEnv();
  const signed = signRequest("GET", credentials, bucket, key, undefined, {});

  const response = await fetch(signed.url, {
    method: "GET",
    headers: signed.headers,
  });

  if (!response.ok) {
    throw new Error(`r2Client.getObject: GET "${key}" failed with status ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * DELETEs `{bucket}/{key}` from R2's S3-compatible endpoint (plan 04-07's
 * replay rig: establishing a genuinely cold-started published-artifact
 * baseline for an already-published historical event, alongside its D1
 * `algorithm_state` reset — deleting only, never a bulk/prefix operation).
 * S3's DELETE is idempotent (a missing key is not an error): both a 204 (or
 * 200) and a 404 are treated as success, matching that contract.
 *
 * Transient failures (5xx, 429, 408, network rejections) are retried with the
 * same policy as `putObject` (quick task 260912-tay): `docs/publish-budget.md`'s git history
 * logs "two transient R2 500s" interrupting a past delete pass that made one
 * attempt per key, and a census-driven cleanup issues hundreds of thousands of
 * single-key DELETEs. A permanent status throws immediately; an exhausted
 * retry throws with the key, the status and `after N attempts`.
 */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  const credentials = credentialsFromEnv();
  await sendWithRetry(
    "deleteObject",
    `DELETE "${key}"`,
    credentials,
    () => {
      const signed = signRequest("DELETE", credentials, bucket, key, undefined, {});
      return fetch(signed.url, { method: "DELETE", headers: signed.headers });
    },
    (status) => (status >= 200 && status < 300) || status === 404
  );
}

/** One listed object: its key, its size in bytes, and R2's LastModified string. */
export interface ListedObject {
  readonly key: string;
  readonly size: number;
  readonly lastModified: string;
}

export interface ParsedListPage {
  readonly objects: ListedObject[];
  readonly isTruncated: boolean;
  readonly nextContinuationToken?: string;
  readonly keyCount?: number;
}

const XML_NAMED_ENTITIES: Readonly<Record<string, string>> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };

/**
 * Decodes the five predefined XML entities plus decimal/hex character
 * references in ONE left-to-right pass, which is equivalent to decoding
 * `&amp;` last: `&amp;lt;` becomes `&lt;`, never `<`. Any other `&` sequence
 * throws — a well-formed S3 response never contains one, so an unknown entity
 * means the body is not what this parser understands.
 */
function decodeXmlText(text: string): string {
  return text.replace(/&([^;&\s]*)(;?)/g, (_match, name: string, semi: string) => {
    if (semi !== ";") throw new Error("r2Client.parseListObjectsV2Xml: bare '&' in XML text");
    let codePoint: number | undefined;
    if (/^#x[0-9a-fA-F]+$/.test(name)) codePoint = Number.parseInt(name.slice(2), 16);
    else if (/^#[0-9]+$/.test(name)) codePoint = Number.parseInt(name.slice(1), 10);
    if (codePoint !== undefined) {
      if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) {
        throw new Error(`r2Client.parseListObjectsV2Xml: invalid character reference &${name};`);
      }
      return String.fromCodePoint(codePoint);
    }
    const named = XML_NAMED_ENTITIES[name];
    if (named === undefined) throw new Error(`r2Client.parseListObjectsV2Xml: unknown XML entity &${name};`);
    return named;
  });
}

/** Every `<tag>…</tag>` text in `xml`, in document order (S3 listings never nest same-name tags). */
function allTagTexts(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) out.push(m[1]!);
  return out;
}

/** The text of the single `<tag>` in `xml`: undefined when absent, a throw when it appears more than once. */
function singleTagText(xml: string, tag: string, where: string): string | undefined {
  const texts = allTagTexts(xml, tag);
  if (texts.length > 1) {
    throw new Error(`r2Client.parseListObjectsV2Xml: ${where} has ${texts.length} <${tag}> elements, expected at most 1`);
  }
  return texts[0];
}

/**
 * Parses one ListObjectsV2 response page with regexes (no XML dependency) and
 * FAILS CLOSED on anything it does not fully understand, because a listing that
 * silently under-reads makes a census lie in the dangerous direction. Throws
 * when: there is no `ListBucketResult`; `IsTruncated` is missing or not
 * true/false; `IsTruncated` is true with no `NextContinuationToken`; an opening
 * `<Contents>` has no complete block; a `Contents` lacks `Key`, lacks a
 * parseable `LastModified`, or has a `Size` that is not a non-negative
 * integer; `KeyCount`, when present, differs from the parsed `Contents` count;
 * or an XML entity is unknown.
 *
 * `<ContinuationToken>` (the echoed request token) is a different element name
 * from `<NextContinuationToken>`, and the tag regex requires the exact name.
 */
export function parseListObjectsV2Xml(xml: string): ParsedListPage {
  if (!/<ListBucketResult[\s>]/.test(xml)) {
    throw new Error("r2Client.parseListObjectsV2Xml: response body has no ListBucketResult element");
  }

  // Parse the object blocks first and strip them, so top-level elements are
  // read only from outside the Contents blocks.
  const contentsBlocks = allTagTexts(xml, "Contents");
  const openingCount = (xml.match(/<Contents>/g) ?? []).length;
  if (openingCount !== contentsBlocks.length) {
    throw new Error(
      `r2Client.parseListObjectsV2Xml: ${openingCount} <Contents> openings but ${contentsBlocks.length} complete blocks`
    );
  }
  const topLevel = xml.replace(/<Contents>[\s\S]*?<\/Contents>/g, "");

  const objects: ListedObject[] = contentsBlocks.map((block, index) => {
    const where = `Contents #${index + 1}`;
    const rawKey = singleTagText(block, "Key", where);
    if (rawKey === undefined || rawKey === "") throw new Error(`r2Client.parseListObjectsV2Xml: ${where} has no Key`);
    const rawSize = singleTagText(block, "Size", where)?.trim();
    if (rawSize === undefined || !/^\d+$/.test(rawSize)) {
      throw new Error(`r2Client.parseListObjectsV2Xml: ${where} has a missing or non-integer Size`);
    }
    const size = Number(rawSize);
    if (!Number.isSafeInteger(size)) throw new Error(`r2Client.parseListObjectsV2Xml: ${where} has an out-of-range Size`);
    const lastModified = singleTagText(block, "LastModified", where)?.trim();
    if (lastModified === undefined || lastModified === "" || Number.isNaN(Date.parse(lastModified))) {
      throw new Error(`r2Client.parseListObjectsV2Xml: ${where} has a missing or unparseable LastModified`);
    }
    return { key: decodeXmlText(rawKey), size, lastModified };
  });

  const rawTruncated = singleTagText(topLevel, "IsTruncated", "ListBucketResult")?.trim();
  if (rawTruncated !== "true" && rawTruncated !== "false") {
    throw new Error("r2Client.parseListObjectsV2Xml: IsTruncated is missing or not true/false");
  }
  const isTruncated = rawTruncated === "true";

  const rawNext = singleTagText(topLevel, "NextContinuationToken", "ListBucketResult");
  const nextContinuationToken = rawNext === undefined || rawNext === "" ? undefined : decodeXmlText(rawNext);
  if (isTruncated && nextContinuationToken === undefined) {
    throw new Error("r2Client.parseListObjectsV2Xml: IsTruncated is true but there is no NextContinuationToken");
  }

  const rawKeyCount = singleTagText(topLevel, "KeyCount", "ListBucketResult")?.trim();
  let keyCount: number | undefined;
  if (rawKeyCount !== undefined) {
    if (!/^\d+$/.test(rawKeyCount)) throw new Error("r2Client.parseListObjectsV2Xml: KeyCount is not an integer");
    keyCount = Number(rawKeyCount);
    if (keyCount !== objects.length) {
      throw new Error(
        `r2Client.parseListObjectsV2Xml: KeyCount ${keyCount} differs from the ${objects.length} parsed Contents`
      );
    }
  }

  return {
    objects,
    isTruncated,
    ...(nextContinuationToken === undefined ? {} : { nextContinuationToken }),
    ...(keyCount === undefined ? {} : { keyCount }),
  };
}

/** Infinite-loop guard: far above the ~340 pages a full listing of this bucket takes. */
const LIST_MAX_PAGES = 5000;
const LIST_MAX_KEYS = "1000";

/**
 * Lists every object in `bucket` (optionally under `options.prefix`) with
 * signed ListObjectsV2 GETs, following `NextContinuationToken` until
 * `IsTruncated` is false. Each page is retried under the shared transient
 * policy and re-signed per attempt. Fails closed: throws on a non-2xx after
 * retries, on any page `parseListObjectsV2Xml` rejects, on a continuation
 * token that repeats, on a key listed twice, and on more than
 * `LIST_MAX_PAGES` pages. Error messages name the status, bucket and prefix
 * only — never the URL (it carries the account host), a header or a
 * credential. `options.onPage(pagesSoFar, objectsSoFar)` reports progress.
 */
export async function listObjects(
  bucket: string,
  options: { prefix?: string; onPage?: (pagesSoFar: number, objectsSoFar: number) => void } = {}
): Promise<ListedObject[]> {
  const credentials = credentialsFromEnv();
  const prefix = options.prefix;
  const label = `LIST bucket "${bucket}" prefix "${prefix === undefined || prefix === "" ? "(whole bucket)" : prefix}"`;

  const objects: ListedObject[] = [];
  const seenKeys = new Set<string>();
  const seenTokens = new Set<string>();
  let token: string | undefined;

  for (let page = 1; ; page += 1) {
    if (page > LIST_MAX_PAGES) {
      throw new Error(`r2Client.listObjects: ${label} exceeded ${LIST_MAX_PAGES} pages; refusing to continue`);
    }
    const query: QueryParam[] = [
      ["list-type", "2"],
      ["max-keys", LIST_MAX_KEYS],
    ];
    if (prefix !== undefined && prefix !== "") query.push(["prefix", prefix]);
    if (token !== undefined) query.push(["continuation-token", token]);

    const response = await sendWithRetry(
      "listObjects",
      `${label} page ${page}`,
      credentials,
      () => {
        const signed = signRequest("GET", credentials, bucket, undefined, undefined, {}, query);
        return fetch(signed.url, { method: "GET", headers: signed.headers });
      },
      (status) => status >= 200 && status < 300
    );

    let parsed: ParsedListPage;
    try {
      parsed = parseListObjectsV2Xml(await response.text());
    } catch (err) {
      throw new Error(
        redactAccount(`r2Client.listObjects: ${label} page ${page}: ${err instanceof Error ? err.message : String(err)}`, credentials)
      );
    }

    for (const object of parsed.objects) {
      if (seenKeys.has(object.key)) {
        throw new Error(`r2Client.listObjects: ${label} page ${page} listed a duplicate key "${object.key}"`);
      }
      seenKeys.add(object.key);
      objects.push(object);
    }
    options.onPage?.(page, objects.length);

    if (!parsed.isTruncated) return objects;

    const next = parsed.nextContinuationToken!;
    if (seenTokens.has(next)) {
      throw new Error(`r2Client.listObjects: ${label} page ${page} repeated a continuation token; refusing to loop`);
    }
    seenTokens.add(next);
    token = next;
  }
}
