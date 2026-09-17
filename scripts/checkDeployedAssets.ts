/**
 * POST-DEPLOY CHECK for the web app (quick task 260917-hul): does a deployed
 * build actually reach a browser?
 *
 * On 2026-09-17 sigmascout.org served a blank page to every real visitor while
 * `curl` reported a healthy site. The edge held `index.html`
 * (`content-type: text/html`, status 200) under `/assets/index-<hash>.js` and
 * `/assets/index-<hash>.css` — but ONLY for requests carrying an `Origin`
 * header. Browsers always send `Origin` for those files, because Vite emits
 * `<script type="module" crossorigin>`; a plain `curl` of the very same URL
 * seconds later returned the correct file. Every naive check passed while the
 * site was down. See
 * `.planning/todos/pending/pages-deploy-can-poison-asset-cache.md` for the
 * reproduction, and for why the routing-level fixes were all rejected.
 *
 * So this script requests every asset TWICE — once bare, once shaped like a
 * browser (`Origin` plus `Sec-Fetch-Dest`/`Sec-Fetch-Mode`/`Sec-Fetch-Site`) —
 * and fails when the two disagree, or when either is served as HTML. The exact
 * variant key the edge used is NOT documented; sending the full browser-shaped
 * header set is a deliberate net cast wide, not a claim about the mechanism.
 *
 * It is READ-ONLY over the network: GET only, no writes, no auth. **It needs no
 * `.env` and must keep needing none** — it reads nothing but public URLs, so it
 * is safe to run anywhere, by anyone, as the last step of a deploy.
 *
 * USAGE
 *
 *   pnpm check:deployed-assets
 *   tsx scripts/checkDeployedAssets.ts [--base https://sigmascout.org] [--json]
 *
 * Exits 0 on PASS, 1 on FAIL. The manual one-liner it automates is:
 *
 *   curl -sI <asset-url> -H "Origin: https://sigmascout.org" | grep -i content-type
 *
 * The network lives entirely in `fetchVariant`, which takes its `fetch` as an
 * argument, so `checkDeployedAssets.test.ts` exercises every verdict offline.
 */
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const DEFAULT_BASE = "https://sigmascout.org";

/** The remedy, quoted where a failure is printed so nobody has to go find the todo. */
export const POISONED_CACHE_REMEDY =
  "REMEDY: Cloudflare dashboard -> Caching -> Configuration -> Purge Everything. " +
  "A single-file purge may NOT clear this: Cloudflare's own docs say a dashboard single-file purge does not " +
  "invalidate objects cached with header variants, and they name Origin among those headers.";

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; redirect?: "follow" | "manual" | "error" }) => Promise<Response>;

export type VariantLabel = "plain" | "origin";

export interface VariantResult {
  readonly label: VariantLabel;
  /** Null when the request never produced a response. */
  readonly status: number | null;
  readonly contentType: string | null;
  readonly cfCacheStatus: string | null;
  readonly age: string | null;
  readonly etag: string | null;
  /** Set when `fetch` itself threw (DNS, TLS, connection reset). */
  readonly networkError: string | null;
}

export interface AssetResult {
  readonly url: string;
  readonly plain: VariantResult;
  readonly origin: VariantResult;
  /** Empty means this asset is well. Every message names the URL. */
  readonly failures: readonly string[];
  /**
   * True when this asset's failure is cache-shaped — HTML served under an asset
   * URL, or the two variants disagreeing — as opposed to a plain 404 or a dead
   * socket. Only these are answered by Purge Everything, and printing that
   * remedy under an unrelated failure would send an operator to the wrong lever.
   */
  readonly poisoned: boolean;
}

export interface CheckReport {
  readonly base: string;
  readonly ok: boolean;
  /** The `GET <base>` that the asset list came from. */
  readonly document: VariantResult;
  readonly assets: readonly AssetResult[];
  /** Failures of the check itself rather than of one asset (document unreachable, no assets referenced). */
  readonly documentFailures: readonly string[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** `text/html; charset=utf-8` -> `text/html`. Null stays null. */
export function mediaType(contentType: string | null): string | null {
  if (contentType === null) return null;
  const essence = contentType.split(";")[0]!.trim().toLowerCase();
  return essence === "" ? null : essence;
}

export type AssetKind = "script" | "style" | "other";

export function assetKind(url: string): AssetKind {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "script";
  if (path.endsWith(".css")) return "style";
  return "other";
}

/**
 * Every same-origin `/assets/` URL the document references, in document order,
 * de-duplicated.
 *
 * Deliberately every `src`/`href` under `/assets/` rather than only the three
 * tags the incident touched (module script, modulepreload, stylesheet) — a
 * future build that code-splits differently must not quietly fall out of
 * coverage. Cross-origin references (the artifact host) are skipped: this
 * checks the Pages deploy, not R2.
 */
export function extractAssetUrls(html: string, base: string): string[] {
  const baseOrigin = new URL(base).origin;
  const found: string[] = [];
  const seen = new Set<string>();
  const attr = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of html.matchAll(attr)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (raw === "") continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, base);
    } catch {
      continue;
    }
    if (resolved.origin !== baseOrigin) continue;
    if (!resolved.pathname.startsWith("/assets/")) continue;
    const url = resolved.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    found.push(url);
  }
  return found;
}

function readVariant(label: VariantLabel, res: Response): VariantResult {
  return {
    label,
    status: res.status,
    contentType: res.headers.get("content-type"),
    cfCacheStatus: res.headers.get("cf-cache-status"),
    age: res.headers.get("age"),
    etag: res.headers.get("etag"),
    networkError: null,
  };
}

function variantError(label: VariantLabel, err: unknown): VariantResult {
  return { label, status: null, contentType: null, cfCacheStatus: null, age: null, etag: null, networkError: err instanceof Error ? err.message : String(err) };
}

/** A weak (`W/"..."`) or absent ETag proves nothing about identity, so it is never compared. */
function strongEtag(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.startsWith("W/") ? null : trimmed;
}

function describe(variant: VariantResult): string {
  if (variant.networkError !== null) return `${variant.label}: request failed (${variant.networkError})`;
  const parts = [`HTTP ${String(variant.status)}`, `content-type=${variant.contentType ?? "(none)"}`, `cf-cache-status=${variant.cfCacheStatus ?? "(none)"}`, `Age=${variant.age ?? "(none)"}`];
  if (variant.etag !== null) parts.push(`ETag=${variant.etag}`);
  return `${variant.label}: ${parts.join(", ")}`;
}

/**
 * The verdict for one asset, from its two already-fetched variants.
 *
 * `cf-cache-status` and `Age` are reported on every failure because they are
 * what made the 2026-09-17 diagnosis possible: two different `Age` values on
 * one URL is what proved there were two distinct cached objects behind it.
 */
export function judgeAsset(url: string, plain: VariantResult, origin: VariantResult): AssetResult {
  const failures: string[] = [];
  let poisoned = false;
  for (const variant of [plain, origin]) {
    if (variant.networkError !== null) {
      failures.push(`${url}: the ${variant.label} request failed: ${variant.networkError}`);
      continue;
    }
    if (variant.status !== 200) {
      failures.push(`${url}: the ${variant.label} request returned HTTP ${String(variant.status)}, expected 200 (${describe(variant)})`);
    }
    if (mediaType(variant.contentType) === "text/html") {
      poisoned = true;
      failures.push(
        `${url}: the ${variant.label} request was served content-type ${variant.contentType ?? "(none)"} — an asset URL serving HTML is the poisoned-cache failure that blanks the site (${describe(plain)} | ${describe(origin)})`
      );
    }
  }

  if (plain.networkError === null && origin.networkError === null) {
    const plainType = mediaType(plain.contentType);
    const originType = mediaType(origin.contentType);
    if (plainType !== originType) {
      poisoned = true;
      failures.push(`${url}: the two variants disagree on content-type — ${describe(plain)} | ${describe(origin)}`);
    }
    const plainTag = strongEtag(plain.etag);
    const originTag = strongEtag(origin.etag);
    if (plainTag !== null && originTag !== null && plainTag !== originTag) {
      poisoned = true;
      failures.push(`${url}: the two variants disagree on a strong ETag, so the edge holds two different objects for one URL — ${describe(plain)} | ${describe(origin)}`);
    }
  }

  return { url, plain, origin, failures, poisoned };
}

/** Every failure in the report, document-level first. Each message names its URL. */
export function failureMessages(report: CheckReport): string[] {
  return [...report.documentFailures, ...report.assets.flatMap((asset) => asset.failures)];
}

export function formatReport(report: CheckReport): string {
  const lines: string[] = [];
  if (report.ok) {
    lines.push(`PASS  ${report.base} — ${String(report.assets.length)} referenced asset(s), each served identically bare and with a browser-shaped Origin request.`);
    for (const asset of report.assets) {
      lines.push(`  ok  ${new URL(asset.url).pathname}  ${asset.plain.contentType ?? "(none)"}  [${describe(asset.plain)}] [${describe(asset.origin)}]`);
    }
    return lines.join("\n");
  }
  lines.push(`FAIL  ${report.base} — ${String(failureMessages(report).length)} problem(s) across ${String(report.assets.length)} referenced asset(s).`);
  for (const message of failureMessages(report)) lines.push(`  - ${message}`);
  if (report.assets.some((asset) => asset.poisoned)) {
    lines.push("");
    lines.push(POISONED_CACHE_REMEDY);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

function browserHeaders(base: string, kind: AssetKind): Record<string, string> {
  const dest = kind === "script" ? "script" : kind === "style" ? "style" : "empty";
  return {
    Origin: new URL(base).origin,
    "Sec-Fetch-Dest": dest,
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Accept: kind === "style" ? "text/css,*/*;q=0.1" : "*/*",
  };
}

/**
 * One GET, headers discarded from the body's point of view: the body is
 * cancelled rather than read, since only the status and headers matter and an
 * asset can be hundreds of kilobytes.
 *
 * GET rather than HEAD on purpose — a browser issues GET, and the point of this
 * check is to see what a browser would see. No cache-busting query string
 * either: the poisoned object IS the thing under test, and `?x=1` made it
 * vanish on 2026-09-17.
 */
async function fetchVariant(fetchImpl: FetchLike, url: string, label: VariantLabel, headers: Record<string, string>): Promise<VariantResult> {
  try {
    const res = await fetchImpl(url, { method: "GET", headers, redirect: "manual" });
    const variant = readVariant(label, res);
    try {
      await res.body?.cancel();
    } catch {
      // A cancelled body is housekeeping; never let it change the verdict.
    }
    return variant;
  } catch (err: unknown) {
    return variantError(label, err);
  }
}

export interface CheckOptions {
  readonly base?: string;
  readonly fetchImpl?: FetchLike;
}

export async function checkDeployedAssets(options: CheckOptions = {}): Promise<CheckReport> {
  const base = (options.base ?? DEFAULT_BASE).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  const documentFailures: string[] = [];

  let html = "";
  let document: VariantResult;
  try {
    const res = await fetchImpl(base, { method: "GET", headers: { Accept: "text/html,*/*;q=0.1", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none" } });
    document = readVariant("plain", res);
    html = await res.text();
  } catch (err: unknown) {
    document = variantError("plain", err);
    documentFailures.push(`${base}: the document request failed: ${document.networkError ?? "unknown error"}`);
    return { base, ok: false, document, assets: [], documentFailures };
  }

  if (document.status !== 200) {
    documentFailures.push(`${base}: the document returned HTTP ${String(document.status)}, expected 200 (${describe(document)})`);
  }
  if (mediaType(document.contentType) !== "text/html") {
    documentFailures.push(`${base}: the document was served content-type ${document.contentType ?? "(none)"}, expected text/html (${describe(document)})`);
  }

  const urls = extractAssetUrls(html, base);
  if (urls.length === 0) {
    // Never a vacuous pass: a build whose HTML references no assets is itself a
    // broken deploy, and "zero assets, zero failures" is exactly the shape of a
    // check that silently stops checking.
    documentFailures.push(`${base}: the document references no same-origin /assets/ URL, so there is nothing to verify — a deployed SPA always references at least its module script`);
  }

  const assets: AssetResult[] = [];
  for (const url of urls) {
    const plain = await fetchVariant(fetchImpl, url, "plain", {});
    const origin = await fetchVariant(fetchImpl, url, "origin", browserHeaders(base, assetKind(url)));
    assets.push(judgeAsset(url, plain, origin));
  }

  const ok = documentFailures.length === 0 && assets.every((asset) => asset.failures.length === 0);
  return { base, ok, document, assets, documentFailures };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { base: { type: "string", default: DEFAULT_BASE }, json: { type: "boolean", default: false } }, strict: true });
  const report = await checkDeployedAssets({ base: values.base });
  console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.ok ? 0 : 1;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    }
  );
}
