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
  "/teams?year=2026&algorithm=vpr",
  "/teams?year=2026&algorithm=opr",
  "/events?year=2025",
];

/**
 * A real team-year known to render at least TWO event sections (06-08-PLAN.md
 * Task 3) — frc118/2024, D-05's own measured 292-match outlier and the
 * team-page payload's largest published object
 * (`docs/publish-budget.md`/`packages/harness/payloadBudget.test.ts`'s
 * `v1/team/frc118/2024/vpr@2.0.0+tuned-2026-08.json`, the key this route
 * fetches after plan 07-18's cutover — 07-17 wrote it, and 06-06-SUMMARY.md's
 * original "confirmed live" measurement was taken under the pre-rename
 * `sigma1@` key [pre-rename] this same object was published under before
 * the rename).
 * A 292-match season across a full district campaign necessarily spans
 * multiple events, so this route is chosen specifically because it is
 * already the phase's own named at-risk fixture, not an arbitrary pick — a
 * later reader can re-verify by re-running `payloadBudget.test.ts`'s
 * largest-key report if the corpus changes.
 */
const TEAM_ROUTE = "/team/118?year=2024&algorithm=vpr";
const SCROLLER_TESTID_PATTERN = '[data-testid^="match-table-scroll-"]';
const MIN_TEAM_ROUTE_SCROLLERS = 2;

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

test(`page does not pan horizontally: ${TEAM_ROUTE}`, async ({ page }) => {
  await page.goto(TEAM_ROUTE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Asserted BEFORE the document-overflow check below: a fixture that
  // rendered zero or one section would not have exercised the per-section
  // scroll shape at all, and would not have caught the original bug's shape
  // (05-08-PLAN.md's real-device sign-off) or a per-section regression of it
  // — this is the whole reason a multi-section fixture was chosen over any
  // single-event team.
  const scrollerCount = await page.locator(SCROLLER_TESTID_PATTERN).count();
  expect(
    scrollerCount,
    `expected at least ${MIN_TEAM_ROUTE_SCROLLERS} per-section scrollers, found ${scrollerCount} — this route no longer renders a multi-section fixture`,
  ).toBeGreaterThanOrEqual(MIN_TEAM_ROUTE_SCROLLERS);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(
    scrollWidth,
    `document scrollWidth ${scrollWidth} exceeds clientWidth ${clientWidth} — the page can be panned sideways`,
  ).toBeLessThanOrEqual(clientWidth + 1);
});

test("each of the team page's per-section scrollers is individually wider than its own viewport", async ({ page }) => {
  await page.goto(TEAM_ROUTE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const scrollers = page.locator(SCROLLER_TESTID_PATTERN);
  const count = await scrollers.count();
  expect(count).toBeGreaterThanOrEqual(MIN_TEAM_ROUTE_SCROLLERS);

  for (let i = 0; i < count; i++) {
    const scroller = scrollers.nth(i);
    const testId = await scroller.getAttribute("data-testid");
    const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    // The point of confining the pan to each section: the axis content must
    // still be reachable — a region that never overflows proves nothing.
    expect(scrollWidth, `${testId}: scrollWidth ${scrollWidth} does not exceed clientWidth ${clientWidth}`).toBeGreaterThan(clientWidth);
  }
});

test("the teams table itself still scrolls horizontally", async ({ page }) => {
  await page.goto("/teams?year=2026&algorithm=vpr", { waitUntil: "networkidle" });
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
