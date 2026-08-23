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

/**
 * The one place the whole credential surface (and the whole SigV4 signing
 * algorithm) lives — `putObject`/`getObject` below are thin callers.
 */
function signRequest(
  method: "PUT" | "GET" | "DELETE",
  credentials: R2Credentials,
  bucket: string,
  key: string,
  body: string | undefined,
  extraHeaders: Readonly<Record<string, string>>
): SignedRequest {
  const host = `${credentials.accountId}.r2.cloudflarestorage.com`;
  const canonicalPath = encodePath(`/${bucket}/${key}`);
  const url = `https://${host}${canonicalPath}`;

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

  const canonicalRequest = [method, canonicalPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

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
 * PUTs `body` to `{bucket}/{key}` on R2's S3-compatible endpoint.
 * `options.contentType`/`options.cacheControl` are sent verbatim as the
 * `Content-Type`/`Cache-Control` headers (D-26 — the publisher passes
 * `application/json` and `public, max-age=60`). Throws on any non-2xx
 * response, with the status and the key in the message.
 */
export async function putObject(
  bucket: string,
  key: string,
  body: string,
  options: { contentType: string; cacheControl: string }
): Promise<void> {
  const credentials = credentialsFromEnv();
  const signed = signRequest("PUT", credentials, bucket, key, body, {
    "content-type": options.contentType,
    "cache-control": options.cacheControl,
  });

  const response = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`r2Client.putObject: PUT "${key}" failed with status ${response.status} ${response.statusText}`);
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
 * 200) and a 404 are treated as success, matching that contract; any other
 * status throws with the key in the message.
 */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  const credentials = credentialsFromEnv();
  const signed = signRequest("DELETE", credentials, bucket, key, undefined, {});

  const response = await fetch(signed.url, {
    method: "DELETE",
    headers: signed.headers,
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`r2Client.deleteObject: DELETE "${key}" failed with status ${response.status} ${response.statusText}`);
  }
}
