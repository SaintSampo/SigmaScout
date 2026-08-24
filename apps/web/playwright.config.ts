import { defineConfig, devices } from "@playwright/test";

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
 * Two projects use Playwright's built-in device descriptors for a recent
 * iPhone and a recent Pixel (`hasTouch: true` on both, already set by each
 * descriptor). The iPhone project pins `browserName: "chromium"` rather
 * than the descriptor's own WebKit default — the spec drives a real
 * multi-point touch drag via `Input.dispatchTouchEvent` over a Chromium
 * CDP session (`e2e/touch-scroll.spec.ts`'s `touchDrag` helper), and
 * `context.newCDPSession()` only exists for Chromium; WebKit's public
 * surface here is `page.touchscreen.tap()` alone, which cannot express a
 * drag. The iPhone descriptor's viewport, user agent, `hasTouch` and
 * `isMobile` flags are unaffected by the engine override.
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
  projects: [
    {
      name: "iphone-17",
      use: { ...devices["iPhone 17"], browserName: "chromium" },
    },
    {
      name: "pixel-10",
      use: { ...devices["Pixel 10"] },
    },
  ],
});
