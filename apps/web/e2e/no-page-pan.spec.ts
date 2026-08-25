import { expect, test } from "@playwright/test";

/**
 * The page must never scroll horizontally — only the table's own scroller may.
 *
 * Raised at plan 05-08's real-device sign-off: on a 390px phone the document
 * was 459px wide, so a horizontal drag panned the whole page instead of
 * scrolling the table. That had a second, less obvious cost — the Teams table
 * genuinely renders all 17 columns on mobile, but they were unreachable
 * because the drag never reached the table's scroller, making the page look
 * like it showed less data than desktop. The events filter sheet inherited the
 * same 459px body width, pushing its week select off-screen.
 *
 * The root cause was flex children refusing to shrink below their content
 * (no `min-w-0`), so this asserts the observable invariant rather than any
 * particular fix.
 */
const ROUTES = [
  "/teams?year=2026&algorithm=sigma1",
  "/teams?year=2026&algorithm=opr",
  "/events?year=2025",
];

for (const route of ROUTES) {
  test(`page does not pan horizontally: ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(
      scrollWidth,
      `document scrollWidth ${scrollWidth} exceeds clientWidth ${clientWidth} — the page can be panned sideways`,
    ).toBeLessThanOrEqual(clientWidth + 1);
  });
}

test("the teams table itself still scrolls horizontally", async ({ page }) => {
  await page.goto("/teams?year=2026&algorithm=sigma1", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const scroller = page.getByTestId("teams-table-scroll");
  await expect(scroller).toBeVisible();

  // The point of confining the pan to the table: its own content must still be
  // wider than its viewport, or the metric columns would be unreachable.
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
});
