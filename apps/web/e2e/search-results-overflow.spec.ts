import { expect, test } from "@playwright/test";

/**
 * G-12 (07-UAT.md): `Ribbon.tsx`'s `<header>` carried `overflow-x-hidden`
 * with no authored `overflow-y` — per the CSS Overflow spec, that alone
 * forces `overflow-y`'s USED value to `auto`, so the header silently became
 * a Y-axis scroll container the instant the search box's absolutely-
 * positioned results list made the header's content taller than the header
 * itself. Instead of the dropdown overlaying the page below the ribbon, the
 * RIBBON scrolled and the results were clipped to (and reachable only by
 * scrolling) the header's own box.
 *
 * Desktop renders `SearchBox` as an inline `Command` box inside the header
 * (`<div className="relative w-64">` wrapping an absolutely-positioned
 * `CommandList`) — this is the shape that reproduces the defect. At 390px,
 * `SearchBox` instead renders a 44x44 icon trigger that opens a
 * `CommandDialog`, and `ui/dialog.tsx`'s `DialogContent` renders through a
 * Radix `Portal` straight to `document.body` — entirely outside the
 * header's DOM subtree, so this defect shape cannot reproduce there. The
 * 390px test below is a REGRESSION guard (the header must never become a
 * scroll container, full stop), not a second reproduction — mirroring
 * 07-UAT.md G-9's own precedent of keeping an already-passing assertion as
 * a regression guard alongside a proven-RED one.
 */
const ROUTE = "/teams?year=2026&algorithm=vpr";
/** Matches many team numbers by prefix (D-09) — enough combined results to hit `SEARCH_RESULT_CAP` (8) and make the header's content taller than the header itself. */
const QUERY = "1";
const SEARCH_PLACEHOLDER = "Search teams or events";

test("desktop: search results overlay the page below the header instead of scrolling it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE, { waitUntil: "networkidle" });

  const input = page.getByPlaceholder(SEARCH_PLACEHOLDER);
  await input.click();
  await input.fill(QUERY);

  const resultsList = page.locator('[data-slot="command-list"]');
  await expect(resultsList).toBeVisible();
  // At least one result actually rendered — otherwise the header would
  // never grow taller than its own content and the overflow condition below
  // would go untested.
  await expect(page.locator('[data-slot="command-item"]').first()).toBeVisible();

  const header = page.locator("header");
  const overflow = await header.evaluate((el) => {
    const style = getComputedStyle(el);
    return { overflowX: style.overflowX, overflowY: style.overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  console.log(JSON.stringify({ test: "search-results-overflow desktop", ...overflow }));

  expect(
    overflow.overflowY,
    `header computed overflow-y is "${overflow.overflowY}" — "auto" means the header silently became a scroll container`,
  ).not.toBe("auto");
  expect(
    overflow.scrollHeight,
    `header scrollHeight ${overflow.scrollHeight} exceeds clientHeight ${overflow.clientHeight} — the header itself is scrolling instead of letting the dropdown overlay the page`,
  ).toBeLessThanOrEqual(overflow.clientHeight + 1);

  const headerBox = await header.boundingBox();
  const resultsBox = await resultsList.boundingBox();
  if (headerBox === null || resultsBox === null) {
    throw new Error("expected both the header and the results list to have a real bounding box");
  }
  console.log(JSON.stringify({ test: "search-results-overflow desktop boxes", headerBottom: headerBox.y + headerBox.height, resultsBottom: resultsBox.y + resultsBox.height }));

  expect(
    resultsBox.y + resultsBox.height,
    `results list bottom (${resultsBox.y + resultsBox.height}px) does not extend below the header's own bottom edge (${headerBox.y + headerBox.height}px) — results are still confined inside the header`,
  ).toBeGreaterThan(headerBox.y + headerBox.height);
});

test("390px: header stays non-scrolling with the search dialog open (regression guard, not a reproduction — the dialog is portaled outside the header)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ROUTE, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Open search" }).click();
  const dialogInput = page.getByPlaceholder(SEARCH_PLACEHOLDER);
  await expect(dialogInput).toBeVisible();
  await dialogInput.fill(QUERY);
  await expect(page.locator('[data-slot="command-item"]').first()).toBeVisible();

  const header = page.locator("header");
  const overflow = await header.evaluate((el) => {
    const style = getComputedStyle(el);
    return { overflowY: style.overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  console.log(JSON.stringify({ test: "search-results-overflow 390px", ...overflow }));

  expect(overflow.overflowY, `header computed overflow-y is "${overflow.overflowY}"`).not.toBe("auto");
  expect(
    overflow.scrollHeight,
    `header scrollHeight ${overflow.scrollHeight} exceeds clientHeight ${overflow.clientHeight}`,
  ).toBeLessThanOrEqual(overflow.clientHeight + 1);
});
