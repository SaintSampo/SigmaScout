/**
 * THROWAWAY — 05-04-PLAN.md Task 1 (D-04's touch-scroll proof). Deleted by
 * plan 05-08 alongside `src/spike/TableSpike.tsx` and `src/routes/spike.tsx`.
 *
 * Drives real touch drag gestures (touchstart/touchmove/touchend, not mouse
 * wheel events) against the spike's single-scroll-container composition, on
 * both configured device projects (playwright.config.ts). Wheel scrolling
 * does not exercise the same gesture arbitration a real vertical-virtualized
 * + horizontal-overflow touch drag competes over, so `touchDrag` below
 * scripts a real multi-point touch sequence via the Chromium DevTools
 * Protocol's `Input.dispatchTouchEvent` rather than any mouse-based
 * shortcut — Playwright's public `page.touchscreen` only exposes `tap()`,
 * which cannot express a drag.
 */
import { test, expect, type Page } from "@playwright/test";

const SCROLL_CONTAINER = '[data-testid="spike-scroll-container"]';
const HEADER = '[data-testid="spike-header"]';
const ROW = '[data-testid="spike-row"]';
const TOTAL_ROWS = 50;

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
  await page.goto("/spike");
  await page.locator(SCROLL_CONTAINER).waitFor({ state: "visible" });
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

  // Starts near the right edge of the visible unpinned region and drags left,
  // well clear of the pinned rank/team#/nickname group (~324px wide).
  await touchDrag(page, { x: box.x + box.width - 20, y: box.y + box.height / 2 }, { x: box.x + 40, y: box.y + box.height / 2 });

  const after = await scrollPosition(page);
  expect(after.left).toBeGreaterThan(before.left);
  expect(after.top).toBe(before.top);
});

test("after a horizontal drag, pinned columns stay fixed relative to the viewport while an unpinned column moves", async ({ page }) => {
  const pinnedHeader = page.locator('[data-testid="spike-header-cell-teamNumber"]');
  const unpinnedHeader = page.locator('[data-testid="spike-header-cell-autoTower"]');
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

test("virtualization is real: rendered row count stays far below the fabricated total, and scrolled content differs from the top", async ({ page }) => {
  const rowsAtTop = await page.locator(ROW).count();
  expect(rowsAtTop).toBeGreaterThan(0);
  expect(rowsAtTop).toBeLessThan(TOTAL_ROWS - 15);

  const firstTeamAtTop = await page.locator(ROW).first().getAttribute("data-team-number");

  const box = await page.locator(SCROLL_CONTAINER).boundingBox();
  if (!box) throw new Error("scroll container has no bounding box");
  await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.8 }, { x: box.x + box.width / 2, y: box.y + box.height * 0.05 });

  const rowsScrolled = await page.locator(ROW).count();
  expect(rowsScrolled).toBeGreaterThan(0);
  expect(rowsScrolled).toBeLessThan(TOTAL_ROWS - 15);

  const firstTeamScrolled = await page.locator(ROW).first().getAttribute("data-team-number");
  expect(firstTeamScrolled).not.toBe(firstTeamAtTop);
});

test("a pinned cell's background is opaque, not transparent", async ({ page }) => {
  const pinnedCell = page.locator('[data-testid="spike-cell-teamNumber"]').first();
  const background = await pinnedCell.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("transparent");
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
});
