/**
 * The static shell's regression proof (06-09-PLAN.md Task 1, folded todo
 * `static-shell-first-paint.md`): `index.html` ships real ribbon-frame
 * markup inside `#root`, so the wordmark paints from the document alone
 * before any script runs, and React's `createRoot(...).render(...)`
 * replaces it exactly once on mount — never a duplicate, never a leftover
 * placeholder alongside the real chrome.
 *
 * Runs against the DEPLOYED origin (`playwright.config.ts`'s `baseURL`),
 * matching every other spec in this directory. The shell itself has no data
 * fetch of its own (`Ribbon.tsx`'s own header comment: "No fetch of its own
 * — this component is static chrome"), so nothing here needs
 * `data.sigmascout.org` to resolve. What DOES depend on the deployed origin
 * is the shell markup itself — it is this plan's own change, so until this
 * branch merges and redeploys, the deployed `index.html` is still the OLD,
 * shell-less document and the first case below fails honestly against it
 * rather than passing against code this plan did not write. See
 * `06-09-SUMMARY.md` for the real, locally-measured proof this plan used
 * instead of a hollow pass here.
 *
 * Locators scope to the `banner` landmark (the top-level `<header>`, real or
 * shell) rather than a bare `getByText("SigmaScout")` — `<title>SigmaScout
 * </title>` also matches on plain text content, which would silently inflate
 * an unscoped count assertion by one.
 */
import { test, expect } from "@playwright/test";

const TARGET_URL = "/teams?year=2024&algorithm=sigma1";

test.describe("Static shell — JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("the wordmark paints from the static document alone", async ({ page }) => {
    await page.goto(TARGET_URL);
    const wordmark = page.getByRole("banner").getByText("SigmaScout");
    await expect(wordmark).toBeVisible();
  });
});

test.describe("Static shell — JavaScript enabled", () => {
  test("the shell is replaced exactly once by the real, mounted Ribbon — no duplicate, no leftover", async ({ page }) => {
    await page.goto(TARGET_URL);
    // The real Ribbon renders identifiable chrome (the "Primary" nav) that
    // only exists once React has taken over from the static shell.
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("banner").getByText("SigmaScout")).toHaveCount(1);
  });
});
