/**
 * NAV-05's deep-link promise, proven end to end (05-08-PLAN.md Task 3) — a
 * full URL carrying year, algorithm, sort key/direction and an events filter
 * restores the same screen when pasted into a FRESH browser context, and the
 * reverse direction (change a control, read the URL, open it fresh, get the
 * same screen) also holds. `RootSearchSchema`/`TeamsSearchSchema`/
 * `EventsSearchSchema` already prove this at the unit level (T-05-02); this
 * spec closes the gap between "the schema round-trips" and "a real browser,
 * loading the real production build, restores the real screen."
 *
 * Every navigation below uses its OWN freshly created `browser.newContext()`
 * — never the shared `page`/`context` test fixtures — so no cookie, storage
 * or cache state from one navigation can leak into the next and quietly
 * explain away a restoration that the URL alone did not actually produce.
 *
 * Runs against the DEPLOYED origin (`playwright.config.ts`'s `baseURL`, the
 * canonical apex per D-17a), never a local dev server — proving the
 * PRODUCTION build's router and SPA fallback, not a dev server's, per this
 * task's own instruction.
 */
import { test, expect, type Browser } from "@playwright/test";

/** A worst-case-artifact-free, cheap Teams URL: `opr` publishes only `total` (D-27), so `sort=total` is valid for every algorithm/year pair without needing to know a season's component-key set. */
const TEAMS_URL = "/teams?year=2022&algorithm=opr&sort=total&sortDir=asc";

/** 05-07-SUMMARY.md's own confirmed live fixture: `week=3&district=ne` matches real, non-empty 2025 events (`2025mawor`, `2025nhdur`) — a stable, already-verified filter combination rather than a newly-guessed one. */
const EVENTS_URL = "/events?year=2025&algorithm=sigma1&week=3&district=ne";

async function freshPage(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  return { context, page };
}

test.describe("Teams deep link (year, algorithm, sort, sortDir)", () => {
  test("a pasted URL restores the right year, algorithm and sort state in a fresh context", async ({ browser }) => {
    const { context, page } = await freshPage(browser, TEAMS_URL);
    try {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Teams — 2022");
      await expect(page.getByRole("combobox", { name: "Algorithm" })).toContainText("OPR");

      const totalHeader = page.locator('[data-testid="teams-header-total"]');
      await expect(totalHeader).toHaveAttribute("aria-sort", "ascending");

      // The table is actually sorted ascending, not just labelled as such:
      // read the first two rendered rows' total-metric text and confirm a
      // non-decreasing order (D-14: URL is the single source of sort truth).
      const rows = page.locator('[data-testid="teams-row"]');
      await rows.first().waitFor({ state: "visible", timeout: 15_000 });
      const firstValueText = await rows.nth(0).locator('[data-testid="teams-cell-total"]').innerText();
      const secondValueText = await rows.nth(1).locator('[data-testid="teams-cell-total"]').innerText();
      const firstValue = Number.parseFloat(firstValueText);
      const secondValue = Number.parseFloat(secondValueText);
      expect(Number.isNaN(firstValue)).toBe(false);
      expect(Number.isNaN(secondValue)).toBe(false);
      expect(firstValue).toBeLessThanOrEqual(secondValue);
    } finally {
      await context.close();
    }
  });

  test("REVERSE: changing sort writes a new URL, and pasting THAT URL into another fresh context restores the same sort state", async ({ browser }) => {
    const { context: contextA, page: pageA } = await freshPage(browser, TEAMS_URL);
    let capturedUrl: string;
    try {
      // Click a genuinely different, always-sortable column ("Win %") —
      // never one of the pinned rank/teamNumber/nickname columns, which
      // carry no sort control at all.
      const winRateHeaderButton = pageA.locator('[data-testid="teams-header-winRate"] button');
      await winRateHeaderButton.click();
      await expect(pageA.locator('[data-testid="teams-header-winRate"]')).toHaveAttribute("aria-sort", "descending");
      capturedUrl = pageA.url();
      expect(capturedUrl).toContain("sort=winRate");
      expect(capturedUrl).toContain("sortDir=desc");
    } finally {
      await contextA.close();
    }

    const { context: contextB, page: pageB } = await freshPage(browser, capturedUrl);
    try {
      await expect(pageB.locator('[data-testid="teams-header-winRate"]')).toHaveAttribute("aria-sort", "descending");
      // Year/algorithm survived the round-trip too — the updater form
      // (`onSortChange`'s `(prev) => ({...prev, ...})`) never drops them.
      await expect(pageB.getByRole("heading", { level: 1 })).toHaveText("Teams — 2022");
    } finally {
      await contextB.close();
    }
  });
});

test.describe("Events deep link (year, algorithm, filter)", () => {
  test("a pasted URL with an active filter restores the same filtered list in a fresh context", async ({ browser }) => {
    const { context, page } = await freshPage(browser, EVENTS_URL);
    try {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events — 2025");
      await expect(page.getByRole("combobox", { name: "Week" })).toContainText("Week 3");
      await expect(page.getByRole("combobox", { name: "District" })).toContainText("ne");

      // The visible rows themselves reflect the filter, not just the
      // controls — every rendered row's Week cell (2nd `<td>`, `COLUMNS[1]`
      // in `EventsList.tsx`) reads "3".
      const rows = page.locator('[data-slot="table-body"] [data-slot="table-row"]');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);
      for (let i = 0; i < rowCount; i++) {
        // Second cell in `COLUMNS` (`EventsList.tsx`) is Week.
        await expect(rows.nth(i).locator("td").nth(1)).toHaveText("3");
      }
    } finally {
      await context.close();
    }
  });

  test("REVERSE: clearing the filter writes a new URL, and pasting THAT URL into another fresh context restores the unfiltered list", async ({
    browser,
  }) => {
    const { context: contextA, page: pageA } = await freshPage(browser, EVENTS_URL);
    let capturedUrl: string;
    try {
      await pageA.getByRole("button", { name: "Clear filters" }).click();
      await expect(pageA.getByRole("combobox", { name: "Week" })).not.toContainText("Week 3");
      capturedUrl = pageA.url();
      expect(capturedUrl).not.toContain("week=3");
      expect(capturedUrl).not.toContain("district=ne");
    } finally {
      await contextA.close();
    }

    const { context: contextB, page: pageB } = await freshPage(browser, capturedUrl);
    try {
      await expect(pageB.getByRole("heading", { level: 1 })).toHaveText("Events — 2025");
      await expect(pageB.getByRole("combobox", { name: "Week" })).not.toContainText("Week 3");
      const rowCountFiltered = await pageB.locator('[data-slot="table-body"] [data-slot="table-row"]').count();
      // The unfiltered 2025 season has strictly MORE events than the
      // week=3&district=ne slice did — a real, not vacuous, contrast.
      expect(rowCountFiltered).toBeGreaterThan(2);
    } finally {
      await contextB.close();
    }
  });
});
