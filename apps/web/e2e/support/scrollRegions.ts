import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * The four sibling-scroll-region assertions, extracted verbatim from
 * `event-scroll-regions.spec.ts` (08-15-PLAN.md Task 1, PD-03) so the
 * Compare page and the Simulation tab are held to the same definition of
 * "sibling region" the five Phase 7 tabs already are, rather than to a
 * second hand-maintained copy. `event-scroll-regions.spec.ts` imports these
 * back and no longer declares its own copies — this is a pure move, not a
 * rewrite; both hard-won findings recorded in the doc comments below moved
 * with their functions unchanged.
 *
 * This module carries no `.spec.` segment in its filename (mirroring
 * `touchDrag.ts`'s own header note), so it matches no project's `testMatch`
 * and is never collected as a test itself.
 */

/**
 * Walks every ancestor from `locator`'s element up to (never including)
 * `document.body`, and asserts none is an ACTUALLY-SCROLLING intermediate
 * scroller — a computed `overflow-x`/`overflow-y` of `auto`/`scroll` on that
 * axis AND a real overflow on that same axis (`scrollWidth > clientWidth` /
 * `scrollHeight > clientHeight`). A non-empty offender list IS the finding
 * this assertion exists to surface — the nested-scroller shape 07-RESEARCH.md
 * Open Question 5 resolved against — and the assertion message names every
 * offender's tag, class list and axis so a failure is diagnosable without
 * re-running anything.
 *
 * [Rule 1 - Bug, found live running 07-20-PLAN.md's own required e2e pass]
 * A naive "flag any computed auto/scroll" walk (this function's first draft)
 * produced a false positive on `__root.tsx`'s own root layout div
 * (`min-h-screen overflow-x-hidden`): the CSS Overflow spec's coupled-axis
 * resolution rule forces a USED value of `overflow-y: auto` on that div
 * purely because it sets `overflow-x: hidden` with no explicit `overflow-y`
 * of its own — this is a real, spec-mandated browser behavior, not an app
 * bug. That div's `min-h-screen` (a MINIMUM, not a fixed height) means it
 * never actually constrains its own height, so it never actually scrolls
 * internally (`scrollHeight` always equals `clientHeight`) — the real page
 * scroll stays on `document.documentElement`, confirmed by every passing
 * vertical-scroll assertion in this suite. Requiring an ACTUAL overflow on
 * the flagged axis (not merely a CSS property permitting one) is the same
 * "a region that never overflows proves nothing" principle `no-page-pan.spec.ts`
 * already states, applied here to the ancestor walk rather than only to the
 * regions under direct test.
 */
export async function assertNoIntermediateScroller(locator: Locator): Promise<void> {
  const offenders = await locator.evaluate((el) => {
    const bad: { tag: string; className: string; axis: "x" | "y" }[] = [];
    let node = el.parentElement;
    while (node !== null && node !== document.body) {
      const style = getComputedStyle(node);
      const scrollsX = (style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth;
      const scrollsY = (style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight;
      if (scrollsX) bad.push({ tag: node.tagName, className: node.className, axis: "x" });
      if (scrollsY) bad.push({ tag: node.tagName, className: node.className, axis: "y" });
      node = node.parentElement;
    }
    return bad;
  });
  expect(offenders, `found an intermediate ACTUALLY-SCROLLING ancestor between this element and <body>: ${JSON.stringify(offenders)}`).toEqual([]);
}

/** `scrollWidth > clientWidth`, with both numbers in the failure message — must be called on a region BEFORE any gesture assertion against it: a region that never overflows lets every drag assertion pass vacuously. */
export async function assertOverflows(locator: Locator): Promise<void> {
  const { scrollWidth, clientWidth } = await locator.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth, `scrollWidth ${scrollWidth} does not exceed clientWidth ${clientWidth} — this region never overflows, so a drag assertion against it would prove nothing`).toBeGreaterThan(
    clientWidth,
  );
}

/**
 * The vertical-axis sibling of `assertOverflows` (08-15-PLAN.md Task 1,
 * PD-03) — genuinely new, not a move: no prior spec in this app needed a
 * VERTICAL bounded-scroller premise guard, because every nested scroll
 * region before the start-match picker was a horizontal table inside a
 * vertical page. `scrollHeight > clientHeight`, with both numbers in the
 * failure message, for the same reason the horizontal form carries both of
 * its own numbers: a region that never overflows on this axis lets every
 * vertical-drag assertion against it pass vacuously.
 */
export async function assertOverflowsY(locator: Locator): Promise<void> {
  const { scrollHeight, clientHeight } = await locator.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(
    scrollHeight,
    `scrollHeight ${scrollHeight} does not exceed clientHeight ${clientHeight} — this region never overflows vertically, so a vertical drag assertion against it would prove nothing`,
  ).toBeGreaterThan(clientHeight);
}

/** `document.documentElement.scrollWidth <= clientWidth + 1`, with both numbers in the message — the same invariant `no-page-pan.spec.ts` already asserts for `/teams`, `/events` and `/team/{n}`; every caller of this helper inherits it rather than establishing a weaker one. */
export async function assertNoPagePan(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `document scrollWidth ${scrollWidth} exceeds clientWidth ${clientWidth} — the page can be panned sideways`).toBeLessThanOrEqual(clientWidth + 1);
}

/**
 * Scrolls `locator` into view, then returns its bounding box and a y
 * coordinate guaranteed to sit inside the currently-VISIBLE band of that
 * box — never the box's own vertical midpoint, which for a 75-125-row table
 * can sit thousands of pixels below the viewport. Mirrors
 * `touch-scroll.spec.ts`'s team-page section fix for the identical class of
 * bug ("This masked itself for as long as the deployed origin was stale").
 */
export async function visibleMidpoint(page: Page, locator: Locator): Promise<{ box: { x: number; y: number; width: number; height: number }; midY: number }> {
  await locator.scrollIntoViewIfNeeded();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport size");
  const box = await locator.boundingBox();
  if (!box) throw new Error("locator has no bounding box");
  const midY = (Math.max(box.y, 0) + Math.min(box.y + box.height, viewport.height)) / 2;
  return { box, midY };
}
