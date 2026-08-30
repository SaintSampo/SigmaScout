import { defineConfig, devices } from "@playwright/test";

/**
 * The local page origin (quick task 260830-p6s, G-06-2). Four places must
 * agree on this exact value — `webServer.url` below, `vite.config.ts`'s
 * `preview.port`, each local project's `baseURL`, and the
 * `VITE_ARTIFACT_ORIGIN` baked into the build — so it is one named constant
 * used everywhere, not four separate literals that could drift apart.
 */
const LOCAL_URL = "http://localhost:4173";

/**
 * TWO ORIGINS, TWO FAMILIES OF PROOF (quick task 260830-p6s, G-06-2).
 *
 * **Why this split exists.** G-06-2, verbatim: "the loop that catches bad UI
 * is rendering it and looking. In this phase that loop was structurally
 * broken ... `no-page-pan.spec.ts`" — a spec that already encoded the exact
 * bug a human later found by looking — "had never actually run", because
 * this file had no local `webServer` and every project asserted only against
 * the deployed origin, while the deploy workflow itself had been dead. Phase
 * 7 then shipped 8 more visible layout defects that only became specs AFTER
 * a human found them by looking. This split closes that loop: a developer
 * can now render-and-look at a page they just built, locally, before any
 * deploy.
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
 * **How the CORS objection below is answered, not routed around.** This
 * file's original comment (still true, kept below) explains why there was no
 * local `webServer`: `https://data.sigmascout.org`'s R2 CORS policy (Phase 5
 * D-18) does not allow-list `localhost`, so a local page's direct artifact
 * fetches would CORS-fail and every page would render empty. The fix is
 * `vite.config.ts`'s `preview.proxy['/v1']`: the local build's artifact
 * origin (`VITE_ARTIFACT_ORIGIN`, set in `webServer.env` below) is the
 * preview server ITSELF, so the browser's request is same-origin, and the
 * proxy forwards it server-side to the real R2 custom domain. R2's CORS
 * policy is unchanged and `localhost` is still not allow-listed — it no
 * longer needs to be.
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
 * Harness for the phase's real-artifact E2E specs (05-08-PLAN.md Task 3):
 * `e2e/touch-scroll.spec.ts` (D-04's touch-scroll proof, RETARGETED at the
 * real `TeamsTable` — its own throwaway spike, `src/spike/TableSpike.tsx`,
 * was deleted by this task) and `e2e/deep-link.spec.ts` (NAV-05's pasted-URL
 * proof).
 *
 * `baseURL` points at the CANONICAL DEPLOYED apex (D-17a), never a local dev
 * server — two independent reasons converge on this, not one:
 *  1. `e2e/deep-link.spec.ts`'s own instruction: prove the PRODUCTION build's
 *     router and SPA fallback, not a dev server's.
 *  2. `05-06-SUMMARY.md`'s documented finding: `https://data.sigmascout.org`'s
 *     R2 CORS policy allow-lists only the site's real origins (D-18) —
 *     `localhost`/`*.pages.dev` are NOT in that list, so a local `vite
 *     preview` server's artifact fetches fail CORS entirely. Since
 *     `touch-scroll.spec.ts` now drags a REAL, fully-populated Teams table
 *     (not spike-fabricated rows), it needs the real artifact to actually
 *     load — which only the deployed origin can serve without a CORS error.
 * There is therefore no local `webServer` here at all: both specs assume the
 * current build is ALREADY DEPLOYED before `playwright test` runs (this
 * task's own action deploys it as part of closing the phase).
 *
 * Four projects, matched to each spec by `testMatch` — these are NOT
 * interchangeable and each spec runs on exactly one project family:
 *  - `desktop`: `e2e/deep-link.spec.ts` and `e2e/team-page.spec.ts` (06-01-PLAN.md
 *    Task 1's tracer proof, added this phase). Neither needs a touch gesture
 *    or a phone viewport — NAV-05's deep-link promise is viewport-agnostic
 *    (it is about the URL restoring STATE, not about touch gestures), and
 *    the team-page tracer only needs a rendered nickname/record, not any
 *    layout-dependent assertion — a real desktop width keeps both specs'
 *    assertions simple and honest. (At phone width, `EventFilters` renders
 *    the D-15 collapsed Sheet and the Teams table's non-pinned columns sit
 *    almost entirely off-screen behind the pinned group, needing an extra,
 *    unrelated horizontal-scroll step before a sort header is even
 *    clickable — irrelevant to either spec here, but why 1440x900 was
 *    chosen originally.)
 *  - `iphone-17`/`pixel-10`: `e2e/touch-scroll.spec.ts` (and, since
 *    07-20-PLAN.md Task 1, `e2e/event-scroll-regions.spec.ts` on `pixel-10`
 *    only — see below), using Playwright's built-in device descriptors for a
 *    recent iPhone and a recent Pixel (`hasTouch: true` on both, already set
 *    by each descriptor). The iPhone project pins `browserName: "chromium"`
 *    rather than the descriptor's own WebKit default — the spec drives a
 *    real multi-point touch drag via `Input.dispatchTouchEvent` over a
 *    Chromium CDP session (`e2e/support/touchDrag.ts`'s `touchDrag` helper),
 *    and `context.newCDPSession()` only exists for Chromium; WebKit's public
 *    surface here is `page.touchscreen.tap()` alone, which cannot express a
 *    drag. The iPhone descriptor's viewport, user agent, `hasTouch` and
 *    `isMobile` flags are unaffected by the engine override.
 *  - `phone-390`: added by 07-20-PLAN.md Task 1, Decision 1. Neither
 *    `iphone-17` (402x681) nor `pixel-10` (360x732) is the 390px width
 *    `07-UI-SPEC.md`, `no-page-pan.spec.ts`'s own header, Phase 5 D-04 and
 *    Phase 6 D-10 all name specifically. Spreads `devices["iPhone 17"]`,
 *    overrides `browserName` to `"chromium"` (same CDP-drag reason as
 *    `iphone-17` above) and overrides `viewport` to `{ width: 390, height:
 *    844 }`. Runs `e2e/event-scroll-regions.spec.ts` and
 *    `e2e/event-header-overflow.spec.ts` — `event-scroll-regions.spec.ts`
 *    ALSO runs on `pixel-10` at 360px (the narrower, more adversarial width),
 *    so its evidence spans two widths rather than one.
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
  // the second and later runs skip that cost; see this file's header comment
  // for the full two-origin rationale (quick task 260830-p6s, G-06-2).
  webServer: {
    command: "pnpm build && pnpm preview",
    url: LOCAL_URL,
    reuseExistingServer: true,
    // A cold production build plus server start does not fit the default 60s.
    timeout: 180_000,
    env: {
      // Bakes `http://localhost:4173/v1/...` into the built bundle instead of
      // the default absolute `https://data.sigmascout.org` host — this is
      // what makes `vite.config.ts`'s `preview.proxy['/v1']` reachable at
      // all. Picked up by Vite's env loader straight off `process.env`
      // (no `.env` file involved — `.env*` is gitignored in this repo, so an
      // env FILE would not even be a shareable solution here).
      VITE_ARTIFACT_ORIGIN: LOCAL_URL,
    },
  },
  projects: [
    {
      name: "desktop",
      // Widened by 06-09-PLAN.md Task 1 (Rule 3 - blocking, matching
      // 06-05/06-07's identical precedent below for no-page-pan.spec.ts):
      // static-shell.spec.ts existed on disk but matched no project's
      // testMatch at all, so this plan's own literal verify command
      // (`test:e2e -- static-shell`) reported "no tests found" regardless
      // of any code change. No viewport-specific behavior is asserted (the
      // shell's JS-disabled/enabled cases are viewport-agnostic), so the
      // existing 1440x900 desktop project is the natural home — `baseURL`
      // itself is UNCHANGED, per this plan's own instruction not to repoint
      // e2e at anything other than the canonical deployed origin.
      // Widened by 07-01-PLAN.md Task 1 (matching the identical precedent set
      // by team-page.spec.ts/static-shell.spec.ts above): a spec matching no
      // project's testMatch reports "no tests found" rather than failing,
      // which both 06-01 and 06-05 hit — event-page.spec.ts needs the same
      // 1440x900 desktop project (the tracer only asserts a rendered event
      // key and team count, no layout-dependent assertion).
      // Widened by 07-20-PLAN.md Task 1, step 2: event-header-overflow.spec.ts
      // and event-live-artifact.spec.ts both need a real desktop width —
      // neither spec's claims are viewport-dependent (event-header-overflow's
      // desktop half deliberately asserts wholeness/layout, not truncation;
      // event-live-artifact fetches artifacts directly via the `request`
      // fixture and never renders a layout-dependent assertion) — same
      // "matches no project's testMatch" failure mode as every widening above.
      // Widened by 07-UAT.md G-7's own fix task: breakdown-desktop-overflow.spec.ts
      // needs a real desktop width to load from (1440x900, this project's
      // default) and overrides the viewport itself per-test (1440 AND 1280 —
      // the two widths G-7 was measured at) via `page.setViewportSize`, so it
      // does not need a second project of its own.
      // Widened by 07-UAT.md G-9's own fix task: zebra-stripe-full-row.spec.ts
      // asserts a CSS-painted background colour, not a layout-dependent
      // measurement — the defect and its fix are viewport-agnostic, so this
      // project's default 1440x900 is a fine home rather than a new project.
      // Widened by 07-UAT.md G-12's own fix task: search-results-overflow.spec.ts
      // needs a real desktop width for its primary (reproducing) case and
      // overrides the viewport itself per-test (1440 AND 390, mirroring
      // breakdown-desktop-overflow.spec.ts's own precedent above) rather than
      // needing a second project.
      // Widened by 07-UAT.md G-13's own fix task: metric-history-axis-legibility.spec.ts
      // needs a real desktop width to render the Metric History tab's chart
      // at a stable, non-mobile layout; not viewport-dependent otherwise.
      testMatch:
        /deep-link\.spec\.ts|team-page\.spec\.ts|static-shell\.spec\.ts|event-page\.spec\.ts|event-header-overflow\.spec\.ts|event-live-artifact\.spec\.ts|breakdown-desktop-overflow\.spec\.ts|zebra-stripe-full-row\.spec\.ts|search-results-overflow\.spec\.ts|metric-history-axis-legibility\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "iphone-17",
      // Widened by 06-05-PLAN.md Task 3 (Rule 3 - blocking, matching
      // 06-01-PLAN.md's identical precedent for team-page.spec.ts):
      // no-page-pan.spec.ts existed on disk but matched NO project's
      // testMatch at all, so this plan's own literal verify command
      // (`test:e2e -- no-page-pan`) reported "no tests found" regardless of
      // any code change. The spec's own header names the bug's origin as
      // "on a 390px phone" — a mobile-viewport project is where it's
      // actually meaningful, not desktop's 1440x900.
      testMatch: /touch-scroll\.spec\.ts|no-page-pan\.spec\.ts/,
      use: { ...devices["iPhone 17"], browserName: "chromium" },
    },
    {
      name: "pixel-10",
      // Widened by 07-20-PLAN.md Task 1, step 2: event-scroll-regions.spec.ts
      // also runs at this narrower (360px), more adversarial width, so its
      // sibling-scroll-region evidence spans two widths rather than one —
      // same "matches no project's testMatch" failure mode as every widening
      // above.
      testMatch: /touch-scroll\.spec\.ts|no-page-pan\.spec\.ts|event-scroll-regions\.spec\.ts|table-layout-quality\.spec\.ts|touch-action-vertical-scroll\.spec\.ts|tab-strip-trigger-sizing\.spec\.ts|tab-strip-alignment\.spec\.ts/,
      use: { ...devices["Pixel 10"] },
    },
    {
      name: "phone-390",
      // Added by 07-20-PLAN.md Task 1, Decision 1 — see this file's header
      // comment for the full rationale (neither existing mobile project pins
      // the 390px width UI-SPEC/no-page-pan.spec.ts/Phase 5 D-04/Phase 6 D-10
      // all name specifically).
      // table-layout-quality.spec.ts added by this task (07-UAT.md G-3):
      // the same 390px width its own pinned-width-fraction bound reasons
      // about. touch-action-vertical-scroll.spec.ts, tab-strip-trigger-sizing.spec.ts
      // and tab-strip-alignment.spec.ts (07-UAT.md G-4/G-5/G-6, real-device
      // UAT follow-up) reuse the same 390px real-device-reported width
      // rather than a new one.
      testMatch: /event-scroll-regions\.spec\.ts|event-header-overflow\.spec\.ts|table-layout-quality\.spec\.ts|touch-action-vertical-scroll\.spec\.ts|tab-strip-trigger-sizing\.spec\.ts|tab-strip-alignment\.spec\.ts/,
      use: { ...devices["iPhone 17"], browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
    {
      name: "local-desktop",
      // Plain desktop chromium at the same 1440x900 the deployed `desktop`
      // project uses, no device spread — against the LOCAL page origin.
      // Quick task 260830-p6s, G-06-2. A spec runs here at the width its OWN
      // premise holds:
      //  - no-page-pan / event-header-overflow / zebra-stripe-full-row: real
      //    at both widths (mirrors their deployed-origin assignment above).
      //  - breakdown-desktop-overflow / search-results-overflow /
      //    metric-history-axis-legibility: each sets its OWN viewport size
      //    per test via `page.setViewportSize` (1440 and a second width), so
      //    a `local-phone-390` run would just get overridden and re-run the
      //    same two widths twice — not assigned there.
      // NOT assigned here (and why, matching the discipline `testMatch`
      // comments already use for the deployed origin's own widening
      // history): table-layout-quality (its own header records a
      // phone-390/pixel-10-only scoping decision — "a narrow-viewport defect
      // class, not one this file needs to also re-prove at desktop width"),
      // tab-strip-alignment / tab-strip-trigger-sizing (both open with a
      // premise guard asserting the strip OVERFLOWS; at 1440px the strip
      // does not overflow, so a desktop run would fail on the premise before
      // ever reaching the layout claim), event-scroll-regions /
      // touch-action-vertical-scroll / touch-scroll (all drive real touch
      // drags via `touchDrag`, which needs `hasTouch` — this plain-chromium
      // project has no device descriptor and so no `hasTouch: true`).
      testMatch: /no-page-pan\.spec\.ts|event-header-overflow\.spec\.ts|zebra-stripe-full-row\.spec\.ts|breakdown-desktop-overflow\.spec\.ts|search-results-overflow\.spec\.ts|metric-history-axis-legibility\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 }, baseURL: LOCAL_URL },
    },
    {
      name: "local-phone-390",
      // The 390px real-device-reported width, but against the LOCAL page
      // origin (`vite.config.ts`'s `preview` server + `/v1` artifact proxy)
      // instead of the deployed apex — quick task 260830-p6s, G-06-2. Mirrors
      // `phone-390`'s device/engine/viewport triple deliberately: this is the
      // iPhone 17 descriptor pinned to the specs' own named 390px width, not
      // a new device, and the `chromium` override is what
      // `e2e/support/touchDrag.ts`'s CDP `Input.dispatchTouchEvent` helper
      // requires (`context.newCDPSession()` is Chromium-only).
      // Widened by 260830-p6s Task 2 to mirror `phone-390`'s full 390px
      // spec set (table-layout-quality / tab-strip-alignment /
      // tab-strip-trigger-sizing / event-scroll-regions /
      // touch-action-vertical-scroll / touch-scroll), plus the three shared
      // specs (no-page-pan / event-header-overflow / zebra-stripe-full-row)
      // that also run on `local-desktop` above — see that project's comment
      // for why the other three deployed-`desktop`-only specs are absent
      // here too.
      testMatch:
        /no-page-pan\.spec\.ts|event-header-overflow\.spec\.ts|zebra-stripe-full-row\.spec\.ts|table-layout-quality\.spec\.ts|tab-strip-alignment\.spec\.ts|tab-strip-trigger-sizing\.spec\.ts|event-scroll-regions\.spec\.ts|touch-action-vertical-scroll\.spec\.ts|touch-scroll\.spec\.ts/,
      use: { ...devices["iPhone 17"], browserName: "chromium", viewport: { width: 390, height: 844 }, baseURL: LOCAL_URL },
    },
  ],
});
