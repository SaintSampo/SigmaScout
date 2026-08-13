/**
 * ETag-conditional TBA v3 fetch (DATA-01). Base URL and `X-TBA-Auth-Key`
 * header per RESEARCH.md's "TBA client with ETag conditional requests"
 * example (sourced from TBA's own "Efficiently Querying the TBA API" blog
 * post). The API key is a parameter read from the environment by the
 * caller — this module never logs it and never embeds it in a returned
 * value.
 */

const TBA_BASE = "https://www.thebluealliance.com/api/v3";

export type TbaFetchResult =
  | { status: 304 }
  | { status: 200; etag: string | undefined; body: unknown };

export async function tbaFetch(
  path: string,
  apiKey: string,
  cachedEtag: string | undefined
): Promise<TbaFetchResult> {
  const res = await fetch(`${TBA_BASE}${path}`, {
    headers: {
      "X-TBA-Auth-Key": apiKey,
      ...(cachedEtag ? { "If-None-Match": cachedEtag } : {}),
    },
  });

  if (res.status === 304) {
    return { status: 304 };
  }
  if (!res.ok) {
    throw new Error(`TBA request failed: ${path} -> HTTP ${res.status}`);
  }
  return { status: 200, etag: res.headers.get("etag") ?? undefined, body: await res.json() };
}
