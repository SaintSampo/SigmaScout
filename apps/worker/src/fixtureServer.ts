/**
 * The replay rig's fixture-serving Worker (plan 04-07, D-20's fixture
 * mechanism — see this repo's SUMMARY for the choice among the plan's
 * offered options and why). A SEPARATE, minimal Worker deployment
 * (`wrangler.fixture.toml`, name `sigmascout-fixture-rig`) — never the
 * entrypoint `wrangler.toml`'s `main` points at — that serves recorded,
 * real-corpus-derived TBA-shaped JSON payloads from the SAME R2 bucket
 * (`ARTIFACTS`) the production Worker publishes to, under a `fixtures/`
 * prefix that never collides with a published `v1/...` key.
 *
 * Substitutes for exactly the two TBA endpoints the deployed Worker's tick
 * calls (`pollEventMatches`'s `/event/{key}/matches`, `processEvent`'s
 * `event_type` lookup via `fetchEventDetail`'s `/event/{key}`) — nothing
 * else. `scripts/replayRig.ts` is the only writer of the fixture objects
 * this Worker reads; this Worker itself never writes.
 *
 * Conditional-request support mirrors TBA's own contract (a 304 on a
 * matching If-None-Match) via R2's own `onlyIf.etagDoesNotMatch` — the SAME
 * conditional-GET mechanism `env.ARTIFACTS.get` already offers, not a
 * hand-rolled ETag comparison. This is what lets `packages/ingest/
 * tbaClient.ts`'s conditional-request handling (unchanged, D-22) exercise
 * its real 304 path against a fixture exactly as it would against TBA.
 *
 * Deliberately logs NOTHING from the request (no header dump, no URL echo
 * beyond what `wrangler tail` already shows for any Worker) — the incoming
 * request carries the real `X-TBA-Auth-Key` header (the production TBA
 * client always sends it, unconditionally of which base URL is configured;
 * D-22 keeps that one code path unchanged rather than adding a second,
 * fixture-aware branch that skips the header), so this file must never
 * write it anywhere a log could capture it.
 */
export interface FixtureEnv {
  readonly ARTIFACTS: R2Bucket;
}

const FIXTURE_PREFIX = "fixtures";

function fixtureKey(eventKey: string, kind: "matches" | "detail"): string {
  return `${FIXTURE_PREFIX}/${eventKey}/${kind}.json`;
}

const EVENT_MATCHES_RE = /^\/event\/([^/]+)\/matches$/;
const EVENT_DETAIL_RE = /^\/event\/([^/]+)$/;

async function serveFixture(env: FixtureEnv, key: string, ifNoneMatch: string | null): Promise<Response> {
  const object = await env.ARTIFACTS.get(key, ifNoneMatch ? { onlyIf: { etagDoesNotMatch: ifNoneMatch } } : undefined);
  if (object === null) {
    return new Response("fixture not found", { status: 404 });
  }
  // `@cloudflare/workers-types` declares `get()` as always resolving an
  // `R2ObjectBody`, but at RUNTIME a satisfied `onlyIf.etagDoesNotMatch`
  // failure (the caller's cached ETag already matches) comes back with
  // `body: null` — the type does not capture this, so the check below is
  // deliberately untyped rather than relying on a (falsely) narrowed type.
  // Mirrors TBA's own 304 contract exactly (D-22's conditional-request
  // handling in packages/ingest/tbaClient.ts expects precisely this).
  const bodyPresent = (object as unknown as { body: unknown }).body != null;
  if (!bodyPresent) {
    return new Response(null, { status: 304, headers: { etag: object.httpEtag } });
  }
  const body = await object.text();
  return new Response(body, { status: 200, headers: { "content-type": "application/json", etag: object.httpEtag } });
}

export default {
  async fetch(request: Request, env: FixtureEnv): Promise<Response> {
    const url = new URL(request.url);
    const ifNoneMatch = request.headers.get("If-None-Match");

    const matchesMatch = EVENT_MATCHES_RE.exec(url.pathname);
    if (matchesMatch) {
      return serveFixture(env, fixtureKey(matchesMatch[1]!, "matches"), ifNoneMatch);
    }
    const detailMatch = EVENT_DETAIL_RE.exec(url.pathname);
    if (detailMatch) {
      return serveFixture(env, fixtureKey(detailMatch[1]!, "detail"), ifNoneMatch);
    }
    return new Response(`sigmascout-fixture-rig: unhandled path ${url.pathname}`, { status: 404 });
  },
} satisfies ExportedHandler<FixtureEnv>;
