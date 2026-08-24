import { defineConfig, devices } from "@playwright/test";

/**
 * Harness for 05-04-PLAN.md Task 1's D-04 touch-scroll proof
 * (`e2e/touch-scroll.spec.ts` against `src/spike/TableSpike.tsx`).
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
    // `localhost`, not `127.0.0.1` — `vite preview` binds only the IPv6
    // loopback (`[::1]`) on this machine, so an IPv4-literal URL never
    // connects and the webServer health check times out silently.
    baseURL: "http://localhost:4319",
  },
  webServer: {
    // `npx` rather than a bare `vite`/local `.bin` path — the webServer child
    // process is spawned via the OS shell (`cmd.exe` on Windows), which does
    // not inherit this package's `node_modules/.bin` on PATH the way a
    // `pnpm run` script does; `npx` reliably resolves the locally-installed
    // binary regardless of the spawning shell.
    command: "npx vite build && npx vite preview --port 4319 --strictPort",
    url: "http://localhost:4319/spike",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
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
