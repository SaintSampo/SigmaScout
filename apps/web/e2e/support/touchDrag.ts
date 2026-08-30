import type { Page } from "@playwright/test";

/**
 * The shared CDP touch-drag helper (07-20-PLAN.md Task 1, Decision 2) —
 * extracted from `e2e/touch-scroll.spec.ts` (05-08-PLAN.md Task 3's original
 * home) so the team page's and the event page's touch evidence cannot
 * diverge in what a "drag" means. This module carries no `.spec.` segment in
 * its filename, so it matches no project's `testMatch` and is never
 * collected as a test itself (`playwright.config.ts`'s `testMatch` regexes
 * only match `*.spec.ts` files).
 *
 * Drives real touch drag gestures (touchstart/touchmove/touchend, not mouse
 * wheel events) via the Chromium DevTools Protocol's
 * `Input.dispatchTouchEvent` — Playwright's public `page.touchscreen` only
 * exposes `tap()`, which cannot express a drag, and wheel scrolling does not
 * exercise the same gesture arbitration a real vertical-virtualized +
 * horizontal-overflow touch drag competes over.
 *
 * THE BOUNDARY THIS HELPER DOES NOT CROSS (07-20-PLAN.md's T-07-20-01,
 * carried forward from `touch-scroll.spec.ts`'s own header): a synthesized
 * `Input.dispatchTouchEvent` sequence dispatched into a desktop Chromium
 * engine wearing a phone viewport is NOT iOS Safari arbitrating a
 * directional `touch-action: pan-x` inside a different-axis outer scroller —
 * a case 06-RESEARCH.md Pitfall 6 documents as having real historical WebKit
 * gaps. No spec importing `touchDrag` may be described, in a SUMMARY or
 * anywhere else, as proof of real-hardware touch behavior. It is necessary
 * evidence and is not proof.
 */
export async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
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

/**
 * Reads one scroll container's `{ scrollTop, scrollLeft }` by CSS selector.
 * Generalized to take a `selector` parameter (rather than closing over a
 * single module-level constant, as the original `touch-scroll.spec.ts`
 * private copy did) because this module is now shared by specs that each
 * read a DIFFERENT scroll region — the Teams table's single scroller, five
 * different per-tab table scrollers, and the tab strip itself.
 */
export async function scrollPosition(page: Page, selector: string): Promise<{ top: number; left: number }> {
  return page.locator(selector).evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
}
