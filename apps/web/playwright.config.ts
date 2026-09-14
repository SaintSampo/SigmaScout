import { defineConfig, devices } from "@playwright/test";

/**
 * The local page origin. Four places must agree on this exact value —
 * `webServer.url` below, `vite.config.ts`'s `preview.port`, each local
 * project's `baseURL`, and the `VITE_ARTIFACT_ORIGIN` baked into the build —
 * so it is one named constant used everywhere, not four separate literals
 * that could drift apart.
 */
const LOCAL_URL = "http://localhost:4173";

/**
 * TWO ORIGINS, TWO FAMILIES OF PROOF.
 *
 * **Deployed** (`https://sigmascout.org`, `use.baseURL` below, UNCHANGED):
 * `deep-link.spec.ts` (the PRODUCTION build's router and SPA fallback — an
 * explicit requirement of that spec, not swappable), `static-shell.spec.ts`,
 * `team-page.spec.ts`, `event-page.spec.ts`, and `event-live-artifact.spec.ts`
 * (asserts REAL PUBLISHED R2 BYTES fetched via `APIRequestContext` against
 * the absolute `https://data.sigmascout.org` — an ARTIFACT origin, not the
 * page origin, so `baseURL` is irrelevant to it; it stays with the deployed
 * family because a published-artifact proof is what it fundamentally IS).
 *
 * **Local** (`http://localhost:4173`, `local-desktop`/`local-phone-390`
 * below): the layout/visual specs, which need a page the developer just
 * built, not one that shipped days ago.
 *
 * **The CORS constraint.** `https://data.sigmascout.org`'s R2 CORS policy
 * does not allow-list `localhost`, so a local page's direct artifact
 * fetches would CORS-fail and every page would render empty. The fix is
 * `vite.config.ts`'s `preview.proxy['/v1']`: the local build's artifact
 * origin (`VITE_ARTIFACT_ORIGIN`, set in `webServer.env` below) is the
 * preview server ITSELF, so the browser's request is same-origin, and the
 * proxy forwards it server-side to the real R2 custom domain.
 *
 * **The cost.** Playwright's `webServer` is top-level — there is no
 * per-project form — so running ONLY a deployed-origin project now also
 * builds and starts the local preview server. `reuseExistingServer: true`
 * (below) makes the second and subsequent runs skip that build entirely.
 *
 * **The staleness foot-gun.** With `reuseExistingServer: true`, an
 * already-running preview server is reused AS-IS. After changing app source,
 * stop that server before the next run, or it will assert against a stale
 * build.
 */

/**
 * `baseURL` points at the CANONICAL DEPLOYED apex, never a local dev
 * server — two independent reasons converge on this, not one:
 *  1. `e2e/deep-link.spec.ts`'s own instruction: prove the PRODUCTION build's
 *     router and SPA fallback, not a dev server's.
 *  2. `https://data.sigmascout.org`'s R2 CORS policy allow-lists only the
 *     site's real origins — `localhost`/`*.pages.dev` are NOT in that list,
 *     so a local `vite preview` server's artifact fetches fail CORS
 *     entirely. `touch-scroll.spec.ts` drags a REAL, fully-populated Teams
 *     table, so it needs the real artifact to actually load — which only
 *     the deployed origin can serve without a CORS error.
 * There is therefore no local `webServer` here at all: both specs assume the
 * current build is ALREADY DEPLOYED before `playwright test` runs.
 *
 * Four projects, matched to each spec by `testMatch` — these are NOT
 * interchangeable and each spec runs on exactly one project family:
 *  - `desktop`: `e2e/deep-link.spec.ts` and `e2e/team-page.spec.ts`. Neither
 *    needs a touch gesture or a phone viewport — the deep-link promise is
 *    viewport-agnostic (it is about the URL restoring STATE, not about
 *    touch gestures), and the team-page tracer only needs a rendered
 *    nickname/record, not any layout-dependent assertion.
 *  - `iphone-17`/`pixel-10`: `e2e/touch-scroll.spec.ts` (and
 *    `e2e/event-scroll-regions.spec.ts` on `pixel-10` only — see below),
 *    using Playwright's built-in device descriptors for a recent iPhone and
 *    a recent Pixel (`hasTouch: true` on both, already set by each
 *    descriptor). The iPhone project pins `browserName: "chromium"` rather
 *    than the descriptor's own WebKit default — the spec drives a real
 *    multi-point touch drag via `Input.dispatchTouchEvent` over a Chromium
 *    CDP session, and `context.newCDPSession()` only exists for Chromium;
 *    WebKit's public surface here is `page.touchscreen.tap()` alone, which
 *    cannot express a drag.
 *  - `phone-390`: neither `iphone-17` (402x681) nor `pixel-10` (360x732) is
 *    the 390px width this site's own real-device UAT names specifically.
 *    Spreads `devices["iPhone 17"]`, overrides `browserName` to `"chromium"`
 *    (same CDP-drag reason as `iphone-17` above) and overrides `viewport`
 *    to `{ width: 390, height: 844 }`. `event-scroll-regions.spec.ts` ALSO
 *    runs on `pixel-10` at 360px (the narrower, more adversarial width), so
 *    its evidence spans two widths rather than one.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  use: {
    baseURL: "https://sigmascout.org",
  },
  // Top-level ONLY — Playwright has no per-project `webServer` form, so any
  // run (even one that selects only a deployed-origin project) also builds
  // and starts the local preview server. `reuseExistingServer: true` makes
  // the second and later runs skip that cost; see this file's header
  // comment for the full two-origin rationale.
  webServer: {
    command: "pnpm build && pnpm preview",
    url: LOCAL_URL,
    reuseExistingServer: true,
    // A cold production build plus server start does not fit the default 60s.
    timeout: 180_000,
    env: {
      // Bakes `http://localhost:4173/v1/...` into the built bundle instead
      // of the default absolute `https://data.sigmascout.org` host — this
      // is what makes `vite.config.ts`'s `preview.proxy['/v1']` reachable
      // at all. Picked up by Vite's env loader straight off `process.env`
      // (no `.env` file involved — `.env*` is gitignored in this repo).
      VITE_ARTIFACT_ORIGIN: LOCAL_URL,
    },
  },
  projects: [
    {
      name: "desktop",
      // No viewport-specific behavior is asserted by any spec below (each
      // is either viewport-agnostic or sets its own viewport per-test via
      // `page.setViewportSize`), so the 1440x900 desktop project is the
      // natural shared home for all of them.
      testMatch:
        /deep-link\.spec\.ts|team-page\.spec\.ts|static-shell\.spec\.ts|event-page\.spec\.ts|event-header-overflow\.spec\.ts|event-live-artifact\.spec\.ts|breakdown-desktop-overflow\.spec\.ts|zebra-stripe-full-row\.spec\.ts|search-results-overflow\.spec\.ts|metric-history-axis-legibility\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "iphone-17",
      // no-page-pan.spec.ts's bug is specifically "on a 390px phone" — a
      // mobile-viewport project is where it's actually meaningful, not
      // desktop's 1440x900.
      testMatch: /touch-scroll\.spec\.ts|no-page-pan\.spec\.ts/,
      use: { ...devices["iPhone 17"], browserName: "chromium" },
    },
    {
      name: "pixel-10",
      // event-scroll-regions.spec.ts also runs at this narrower (360px),
      // more adversarial width, so its sibling-scroll-region evidence
      // spans two widths rather than one.
      testMatch: /touch-scroll\.spec\.ts|no-page-pan\.spec\.ts|event-scroll-regions\.spec\.ts|table-layout-quality\.spec\.ts|touch-action-vertical-scroll\.spec\.ts|tab-strip-trigger-sizing\.spec\.ts/,
      use: { ...devices["Pixel 10"] },
    },
    {
      name: "phone-390",
      // Neither `iphone-17` nor `pixel-10` pins the 390px width this
      // site's real-device UAT names specifically — see this file's header
      // comment for the full rationale. Every spec below reuses this same
      // 390px real-device-reported width.
      testMatch: /event-scroll-regions\.spec\.ts|event-header-overflow\.spec\.ts|table-layout-quality\.spec\.ts|touch-action-vertical-scroll\.spec\.ts|tab-strip-trigger-sizing\.spec\.ts/,
      use: { ...devices["iPhone 17"], browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
    {
      name: "local-desktop",
      // Plain desktop chromium at the same 1440x900 the deployed `desktop`
      // project uses, no device spread — against the LOCAL page origin. A
      // spec runs here at the width its OWN premise holds:
      //  - no-page-pan / event-header-overflow / zebra-stripe-full-row: real
      //    at both widths (mirrors their deployed-origin assignment above).
      //  - breakdown-desktop-overflow / search-results-overflow /
      //    metric-history-axis-legibility / simulation-run: each sets its
      //    OWN viewport size per test, or needs this project's local-origin
      //    `/v1` proxy to reach real published artifact bytes.
      // NOT assigned here: table-layout-quality (a narrow-viewport defect
      // class, not one that needs re-proving at desktop width),
      // tab-strip-trigger-sizing (a phone-width check of the wrapping tab
      // strip), event-scroll-regions / touch-action-vertical-scroll
      // / touch-scroll (all drive real touch drags via `touchDrag`, which
      // needs `hasTouch` — this plain-chromium project has no device
      // descriptor and so no `hasTouch: true`).
      testMatch: /no-page-pan\.spec\.ts|event-header-overflow\.spec\.ts|zebra-stripe-full-row\.spec\.ts|breakdown-desktop-overflow\.spec\.ts|search-results-overflow\.spec\.ts|metric-history-axis-legibility\.spec\.ts|simulation-run\.spec\.ts/,
      // no-page-pan.spec.ts's "each of the team page's per-section
      // scrollers is individually wider than its own viewport" test
      // carries its OWN premise guard, unconditional, for EVERY section
      // scroller — "a region that never overflows proves nothing." At
      // 1440px the frc118/2024 fixture's per-section match-table content
      // (measured 1102px) fits entirely inside the section's own
      // 1440px-wide container and does not overflow, so the premise is
      // false at this width. `grepInvert` excludes this one test by title
      // from this project only, on file/config authority, not a
      // spec-level skip. The file's other three tests (the actual
      // "document never pans" invariant, real at both widths) still run
      // here unweakened.
      grepInvert: /each of the team page's per-section scrollers is individually wider than its own viewport/,
      use: { viewport: { width: 1440, height: 900 }, baseURL: LOCAL_URL },
    },
    {
      name: "local-phone-390",
      // The 390px real-device-reported width, but against the LOCAL page
      // origin (`vite.config.ts`'s `preview` server + `/v1` artifact proxy)
      // instead of the deployed apex. Mirrors `phone-390`'s device/engine/
      // viewport triple deliberately: this is the iPhone 17 descriptor
      // pinned to the specs' own named 390px width, not a new device, and
      // the `chromium` override is what `e2e/support/touchDrag.ts`'s CDP
      // `Input.dispatchTouchEvent` helper requires (`context.newCDPSession()`
      // is Chromium-only). Mirrors `phone-390`'s full spec set plus the
      // three shared specs (no-page-pan / event-header-overflow /
      // zebra-stripe-full-row) that also run on `local-desktop` above, plus
      // simulation-tab.spec.ts and compare-narrow-legibility.spec.ts, both
      // of which need this project's local-origin `/v1` proxy to reach
      // real published artifact bytes.
      testMatch:
        /no-page-pan\.spec\.ts|event-header-overflow\.spec\.ts|zebra-stripe-full-row\.spec\.ts|table-layout-quality\.spec\.ts|tab-strip-trigger-sizing\.spec\.ts|event-scroll-regions\.spec\.ts|touch-action-vertical-scroll\.spec\.ts|touch-scroll\.spec\.ts|simulation-tab\.spec\.ts|compare-narrow-legibility\.spec\.ts/,
      use: { ...devices["iPhone 17"], browserName: "chromium", viewport: { width: 390, height: 844 }, baseURL: LOCAL_URL },
    },
  ],
});
