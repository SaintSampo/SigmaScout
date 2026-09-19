---
id: pages-deploy-can-poison-asset-cache
created: 2026-09-17
source: live outage 2026-09-17 after the 260917-2f4 push; diagnosed and purged the same night
priority: high
---

# A Pages deploy can leave index.html cached under an asset URL, blanking the site

> **CLOSED 2026-09-18: detection is automatic, prevention is not possible on this platform.**
>
> - Item 4 below was built as `pnpm check:deployed-assets` (quick task 260917-hul).
> - It now runs as the LAST step of `.github/workflows/deploy.yml`, after a 90 second propagation
>   wait, so a poisoned deploy turns the Actions run red instead of waiting for someone to notice a
>   blank site. The wait is deliberate: asking for a new asset before it has propagated is the
>   request that gets the SPA fallback back.
> - **The residual risk is unchanged and accepted.** Every routing fix is rejected in the table
>   below, and the only first-class one is migrating to Workers Static Assets. A red deploy run is a
>   live outage until proven otherwise, and the remedy is still Purge Everything.
> - Not yet observed: the new workflow steps run for the first time on the push that carries them.


## What happened

After the 2026-09-17 push, **sigmascout.org served a blank page to every real visitor** while `curl`
reported a healthy site. The live Playwright suite went 170/170 → 67 failures → 160 failures; the
first run was wrongly dismissed as a deploy race.

The edge held `index.html` (`content-type: text/html`, status 200) under
`/assets/index-<hash>.js` and `/assets/index-<hash>.css`. Browsers request those with an `Origin`
header (Vite emits `<script type="module" crossorigin>`), got HTML where a module was expected, and
rendered nothing.

**Reproduced deterministically at the time, same URL, seconds apart:**

| Request | Result |
|---|---|
| `curl -sI <asset>` | `application/javascript`, HIT, `Age: 704` |
| `curl -sI <asset> -H "Origin: https://sigmascout.org"` | **`text/html`**, HIT, `Age: 1051` |
| `curl -sI "<asset>?x=1" -H "Origin: ..."` | `application/javascript`, MISS |

Two different `Age` values on one URL means two distinct cached objects. **Jacob's Purge Everything
cleared it**; both variants then returned MISS with correct types, the browser rendered, and the
suite went back to 170/170.

## Mechanism: partly confirmed, partly not

- **Confirmed by docs:** Pages serves the SPA fallback (`index.html`, status 200) for any path that
  matches no file, with no special case for `.js`/`.css`
  (`/pages/configuration/serving-pages/`). `public/_headers` marks `/assets/*`
  `max-age=31536000, immutable`, so such a response is cached hard.
- **NOT confirmed by docs:** that the edge keys the cache on `Origin`. Pages sets
  `Access-Control-Allow-Origin: *` with no `Vary`, and `/cache/concepts/vary/` says Cloudflare does
  not consider `Vary` by default. The observation above is real; the mechanism behind it is not
  documented. Do not repeat the "CORS variant" explanation as fact.
- **A supporting hook:** `/cache/how-to/purge-cache/purge-by-single-file/` states a dashboard
  single-file purge does **not** invalidate objects cached with header variants, and names `Origin`
  among them. So per-URL purging may not be enough — Purge Everything, or the API with the header in
  the body, is the reliable remedy.
- **No documented guarantee** that a production deploy swap is atomic, and **no documentation that a
  deploy purges the edge**. The serving-pages page says both "the asset remains cached until your
  next deployment" and "if you notice stale assets after a new deployment … Purge Everything".

## Further evidence: the variant split is real, and visible on a HEALTHY site

The first run of `pnpm check:deployed-assets` against the restored site (2026-09-17) PASSED, and in
passing it showed the same URL answered from two different cached objects:

```
/assets/schemas-AVUJaT2V.js  [plain: cf-cache-status=HIT, Age=11654] [origin: cf-cache-status=HIT, Age=37547]
```

Same ETag, same content-type, so benign here — but two ages means two objects, keyed on something
the `Origin`-bearing request changes. That is the condition the outage needed: when one of those two
objects is filled during a deploy swap, only half the world sees it, and the half that does is every
browser. It is also why a check that requests each asset only once cannot see this class of failure.

## Why the obvious fixes are rejected

| Option | Verdict |
|---|---|
| `_redirects` rule returning 404 for `/assets/*` | **Impossible.** The docs' own ❌ example for unsupported rewrites is `/blog/* /blog/404.html 404`. Supported codes are 301/302/303/307/308 and 200. |
| Add a top-level `404.html` | **Breaks the site.** Pages only does the SPA fallback when no top-level `404.html` exists, so every deep link would 404. And `_redirects` cannot replace it: "Redirects are always followed, regardless of whether or not an asset matches", so `/* /index.html 200` would swallow `/assets/*` too. |
| Pages Functions middleware | **Costly.** Static requests are free and unlimited today; a root middleware makes every request count against the free 100k/day. It may also void `_headers` (unconfirmed: whether a `context.next()` pass-through counts as "generated by Functions"). |
| Migrate to Workers Static Assets | The only first-class fix (`not_found_handling: "404-page"` serves a real 404), but it is a platform migration. |

## Recommended fix: a post-deploy check, not a routing change

1. **After every web deploy, verify with an `Origin` header or a real browser — never plain curl.**
   One command:
   ```bash
   curl -sI <asset-url> -H "Origin: https://sigmascout.org" | grep -i content-type
   ```
   `text/html` on a `.js`/`.css` URL means poisoned.
2. **If poisoned: Purge Everything** (dashboard → Caching → Configuration). A single-file purge may
   not clear it.
3. **The live e2e suite already detects this** (170/170 → mass failures). Treat a mass failure right
   after a deploy as a live outage until proven otherwise, not as flakiness.
4. Worth building: a small script that reads the live HTML's asset URLs, re-requests each with an
   `Origin` header, and fails loudly on a `text/html` response — runnable as the last step of any
   deploy.

Related: [[e2e-is-live-only-and-drifts]].
