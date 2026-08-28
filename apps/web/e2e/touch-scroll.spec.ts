/**
 * D-04's touch-scroll proof, RETARGETED at the real, shipped `TeamsTable`
 * (05-08-PLAN.md Task 3) — the throwaway spike this spec originally drove
 * (`src/spike/TableSpike.tsx`, `src/routes/spike.tsx`, plan 05-04) has been
 * deleted, and its own header always said this plan would do so. Retargeting
 * rather than deleting outright: "a permanently-passing touch assertion
 * against the shipped table is worth more than one against a component
 * nobody ships" (this task's own instruction). The composition under test —
 * exactly ONE native scrolling element, sticky pinned columns, TanStack
 * Virtual row virtualization — is identical to what the spike proved; only
 * the selectors and the data source changed.
 *
 * Runs against the DEPLOYED origin (`playwright.config.ts`'s `baseURL`), not
 * a local dev server: this table now fetches a REAL, fully-populated
 * `teams/{year}` artifact from `https://data.sigmascout.org`, whose R2 CORS
 * policy (D-18) does not allow-list `localhost`/`*.pages.dev` — confirmed
 * directly by `05-06-SUMMARY.md`'s "Issues Encountered" section. Without the
 * real data resident, there is nothing to scroll.
 *
 * Drives real touch drag gestures (touchstart/touchmove/touchend, not mouse
 * wheel events): wheel scrolling does not exercise the same gesture
 * arbitration a real vertical-virtualized + horizontal-overflow touch drag
 * competes over, so `touchDrag` below scripts a real multi-point touch
 * sequence via the Chromium DevTools Protocol's `Input.dispatchTouchEvent`
 * rather than any mouse-based shortcut — Playwright's public
 * `page.touchscreen` only exposes `tap()`, which cannot express a drag.
 */
import { test, expect, type Page } from "@playwright/test";

const TEAMS_URL = "/teams?year=2024&algorithm=vpr&sort=total&sortDir=desc";
const SCROLL_CONTAINER = '[data-testid="teams-table-scroll"]';
const HEADER = '[data-slot="table-header"]';
const ROW = '[data-testid="teams-row"]';
/** Loose upper bound proving VIRTUALIZATION is real without hard-coding the
 * live artifact's exact row count (~3,750 per D-01, and the live count
 * drifts every event) — the assertion only needs "far fewer rows are in the
 * DOM than a full unvirtualized render would produce." */
const MAX_PLAUSIBLE_VIRTUALIZED_ROWS = 120;

async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  const client = await page.context().newCDPSession(page);
  const points = Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  }));
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: points[0].x, y: points[0].y }],
  });
  for (const point of points.slice(1)) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x, y: point.y }],
    });
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  // Let native momentum settle before reading the scroll position.
  await page.waitForTimeout(300);
}

async function scrollPosition(page: Page) {
  return page.locator(SCROLL_CONTAINER).evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
}

test.beforeEach(async ({ page }) => {
  await page.goto(TEAMS_URL);
  await page.locator(SCROLL_CONTAINER).waitFor({ state: "visible" });
  // Real rows must actually be resident before dragging — proves the real
  // artifact loaded (not the CORS-blocked-empty-state this spec's own header
  // warns about).
  await page.locator(ROW).first().waitFor({ state: "visible", timeout: 15_000 });
});

test("a vertical drag inside the body advances vertical scroll and leaves horizontal scroll unchanged", async ({ page }) => {
  const box = await page.locator(SCROLL_CONTAINER).boundingBox();
  if (!box) throw new Error("scroll container has no bounding box");
  const before = await scrollPosition(page);

  await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.8 }, { x: box.x + box.width / 2, y: box.y + box.height * 0.2 });

  const after = await scrollPosition(page);
  expect(after.top).toBeGreaterThan(before.top);
  expect(after.left).toBe(before.left);
});

test("a horizontal drag across the unpinned region advances horizontal scroll and leaves vertical scroll unchanged", async ({ page }) => {
  const box = await page.locator(SCROLL_CONTAINER).boundingBox();
  if (!box) throw new Error("scroll container has no bounding box");
  const before = await scrollPosition(page);

  // Starts near the right edge of the visible unpinned region and drags
  // left, well clear of the pinned rank/team#/nickname group.
  await touchDrag(page, { x: box.x + box.width - 20, y: box.y + box.height / 2 }, { x: box.x + 40, y: box.y + box.height / 2 });

  const after = await scrollPosition(page);
  expect(after.left).toBeGreaterThan(before.left);
  expect(after.top).toBe(before.top);
});

test("after a horizontal drag, the pinned team-number column stays fixed relative to the viewport while the unpinned total column moves", async ({
  page,
}) => {
  const pinnedHeader = page.locator('[data-testid="teams-header-teamNumber"]');
  const unpinnedHeader = page.locator('[data-testid="teams-header-total"]');
  const pinnedBefore = await pinnedHeader.boundingBox();
  const unpinnedBefore = await unpinnedHeader.boundingBox();
  if (!pinnedBefore || !unpinnedBefore) throw new Error("header cells missing a bounding box");

  const box = await page.locator(SCROLL_CONTAINER).boundingBox();
  if (!box) throw new Error("scroll container has no bounding box");
  await touchDrag(page, { x: box.x + box.width - 20, y: box.y + box.height / 2 }, { x: box.x + 40, y: box.y + box.height / 2 });

  const pinnedAfter = await pinnedHeader.boundingBox();
  const unpinnedAfter = await unpinnedHeader.boundingBox();
  if (!pinnedAfter || !unpinnedAfter) throw new Error("header cells missing a bounding box after the drag");

  expect(pinnedAfter.x).toBeCloseTo(pinnedBefore.x, 0);
  expect(unpinnedAfter.x).not.toBeCloseTo(unpinnedBefore.x, 0);
});

test("the header's bounding box stays fixed after a vertical drag", async ({ page }) => {
  const header = page.locator(HEADER);
  const before = await header.boundingBox();
  if (!before) throw new Error("header has no bounding box");

  const box = await page.locator(SCROLL_CONTAINER).boundingBox();
  if (!box) throw new Error("scroll container has no bounding box");
  await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.8 }, { x: box.x + box.width / 2, y: box.y + box.height * 0.2 });

  const after = await header.boundingBox();
  if (!after) throw new Error("header has no bounding box after the drag");
  expect(after.y).toBeCloseTo(before.y, 0);
});

test("virtualization is real: rendered row count stays far below a plausible full-render count, and scrolled content differs from the top", async ({
  page,
}) => {
  const rowsAtTop = await page.locator(ROW).count();
  expect(rowsAtTop).toBeGreaterThan(0);
  expect(rowsAtTop).toBeLessThan(MAX_PLAUSIBLE_VIRTUALIZED_ROWS);

  const firstTeamAtTop = await page.locator(ROW).first().getAttribute("data-team-number");

  const box = await page.locator(SCROLL_CONTAINER).boundingBox();
  if (!box) throw new Error("scroll container has no bounding box");
  // Several repeated drags, not one: the virtualizer's overscan window
  // (8 rows above/below the visible range) absorbs a single short drag
  // without shifting the FIRST RENDERED row at all — the earlier
  // "advances vertical scroll" test already proves `scrollTop` itself
  // moves on one drag; this test needs enough total distance to clear the
  // overscan buffer too.
  for (let i = 0; i < 4; i++) {
    await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.8 }, { x: box.x + box.width / 2, y: box.y + box.height * 0.05 });
  }

  const rowsScrolled = await page.locator(ROW).count();
  expect(rowsScrolled).toBeGreaterThan(0);
  expect(rowsScrolled).toBeLessThan(MAX_PLAUSIBLE_VIRTUALIZED_ROWS);

  const firstTeamScrolled = await page.locator(ROW).first().getAttribute("data-team-number");
  expect(firstTeamScrolled).not.toBe(firstTeamAtTop);
});

test("a pinned cell's background is opaque, not transparent", async ({ page }) => {
  const pinnedCell = page.locator('[data-testid="teams-cell-teamNumber"]').first();
  const background = await pinnedCell.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("transparent");
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
});

/**
 * The team page's per-event-section gesture contract (06-08-PLAN.md Task 3,
 * D-10 — this phase's own highest-risk item, since the pattern recurs once
 * per event section instead of once per page). Same team-year fixture
 * `no-page-pan.spec.ts` uses (frc118/2024, D-05's 292-match outlier), chosen
 * because it is already the phase's own named at-risk fixture with a
 * confirmed multi-section render, not an arbitrary pick.
 *
 * These drive Chromium's (or a Chromium-engined WebKit-viewport project's)
 * touch dispatcher via the SAME `touchDrag` CDP helper the Teams table
 * cases above use — they are NOT evidence of real iOS Safari gesture
 * arbitration, which has documented historical gaps for a directional
 * `touch-action` inside a different-axis outer scroller
 * (06-RESEARCH.md Pitfall 6). See this plan's SUMMARY.md for the still-
 * outstanding real-device human check.
 */
test.describe("team page — per-event-section touch scroll (D-10)", () => {
  const TEAM_URL = "/team/118?year=2024&algorithm=vpr";
  const SCROLLER_TESTID_PATTERN = '[data-testid^="match-table-scroll-"]';

  test.beforeEach(async ({ page }) => {
    await page.goto(TEAM_URL);
    await page.locator(SCROLLER_TESTID_PATTERN).first().waitFor({ state: "visible", timeout: 15_000 });
  });

  test("a horizontal drag inside the FIRST section's scroller advances only that scroller, and leaves the document's horizontal scroll at zero", async ({
    page,
  }) => {
    const scrollers = page.locator(SCROLLER_TESTID_PATTERN);
    const first = scrollers.nth(0);
    const second = scrollers.nth(1);
    // The scroller holds every match row, so it is ~1400px tall and starts
    // ~1300px down the page — its OWN midpoint (box.y + box.height / 2) lands
    // around y=2039 on a 681px-tall viewport, i.e. far below the fold, and a
    // touch dispatched there hits nothing at all. Scroll it into view and drag
    // through the midpoint of the band that is actually visible. This masked
    // itself for as long as the deployed origin was stale: the spec could
    // never pass, so its own bad coordinate never surfaced.
    await first.scrollIntoViewIfNeeded();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size");
    const box = await first.boundingBox();
    if (!box) throw new Error("first scroller has no bounding box");
    const visibleY = (Math.max(box.y, 0) + Math.min(box.y + box.height, viewport.height)) / 2;

    const firstBefore = await first.evaluate((el) => el.scrollLeft);
    const secondBefore = await second.evaluate((el) => el.scrollLeft);
    const documentLeftBefore = await page.evaluate(() => document.documentElement.scrollLeft);

    await touchDrag(page, { x: box.x + box.width - 20, y: visibleY }, { x: box.x + 20, y: visibleY });

    const firstAfter = await first.evaluate((el) => el.scrollLeft);
    const secondAfter = await second.evaluate((el) => el.scrollLeft);
    const documentLeftAfter = await page.evaluate(() => document.documentElement.scrollLeft);

    expect(firstAfter).toBeGreaterThan(firstBefore);
    // The SECOND section's scroll-left is unchanged by the first section's drag.
    expect(secondAfter).toBe(secondBefore);
    expect(documentLeftAfter).toBe(documentLeftBefore);
    expect(documentLeftAfter).toBe(0);
  });

  test("a vertical drag anywhere over a match table advances the page's vertical scroll", async ({ page }) => {
    const first = page.locator(SCROLLER_TESTID_PATTERN).first();
    const box = await first.boundingBox();
    if (!box) throw new Error("first scroller has no bounding box");
    const before = await page.evaluate(() => document.documentElement.scrollTop);

    await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 + 200 }, { x: box.x + box.width / 2, y: box.y + box.height / 2 - 200 });

    const after = await page.evaluate(() => document.documentElement.scrollTop);
    expect(after).toBeGreaterThan(before);
  });

  test("after both a horizontal and a vertical drag, the document still has no horizontal overflow", async ({ page }) => {
    const first = page.locator(SCROLLER_TESTID_PATTERN).first();
    const box = await first.boundingBox();
    if (!box) throw new Error("first scroller has no bounding box");

    await touchDrag(page, { x: box.x + box.width - 20, y: box.y + box.height / 2 }, { x: box.x + 20, y: box.y + box.height / 2 });
    await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 + 200 }, { x: box.x + box.width / 2, y: box.y + box.height / 2 - 200 });

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("an axis tick label stays in the viewport and non-empty while the region is scrolled", async ({ page }) => {
    const first = page.locator(SCROLLER_TESTID_PATTERN).first();
    const box = await first.boundingBox();
    if (!box) throw new Error("first scroller has no bounding box");

    await touchDrag(page, { x: box.x + box.width - 20, y: box.y + box.height / 2 }, { x: box.x + 20, y: box.y + box.height / 2 });

    const tick = first.getByTestId("axis-tick").first();
    await expect(tick).toBeVisible();
    const text = await tick.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });
});
