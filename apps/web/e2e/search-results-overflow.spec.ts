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

  // Supporting signal, not the primary proof (07-UAT.md G-12 correction):
  // `overflow-y: auto`/`scroll` are the only computed values that CAN make an
  // element a scroll container, so ruling both out is still meaningful. What
  // it does NOT prove is that the element currently scrolls — `scrollHeight >
  // clientHeight` is true here even post-fix, because `overflow-y: visible`
  // still reports the full extent of the overflowing, absolutely-positioned
  // results list in `scrollHeight`. That made the old assertion (`scrollHeight
  // <= clientHeight`) a FALSE POSITIVE: it measured content extent, not
  // scrolling behaviour. The behavioural check below (`actuallyScrollable`)
  // is the real proof.
  expect(
    overflow.overflowY,
    `header computed overflow-y is "${overflow.overflowY}" — "auto"/"scroll" means the header CAN become a scroll container`,
  ).not.toMatch(/^(auto|scroll)$/);

  // The behavioural proof, per the developer's actual report ("results turn
  // the ribbon into a scrollable area"): attempt to move the header's own
  // scroll position and confirm it does not move. `scrollHeight >
  // clientHeight` is an unreliable proxy for "is scrollable" — with
  // `overflow-y: visible` an absolutely-positioned overflowing child still
  // inflates `scrollHeight` even though the element has zero scrolling
  // behaviour. Setting `scrollTop` and reading it back is what a user
  // dragging/wheeling the header would actually experience.
  const scrollability = await header.evaluate((el) => {
    const before = el.scrollTop;
    el.scrollTop = 50;
    const after = el.scrollTop;
    el.scrollTop = before; // restore — this is a shared page, not a fresh element
    return { before, after, actuallyScrollable: after !== before };
  });
  console.log(JSON.stringify({ test: "search-results-overflow desktop scrollability", ...scrollability }));

  expect(
    scrollability.actuallyScrollable,
    `header scrollTop moved from ${scrollability.before} to ${scrollability.after} when set to 50 — the header is genuinely scrollable, meaning results are trapped inside it instead of overlaying the page`,
  ).toBe(false);

  const headerBox = await header.boundingBox();
  const resultsBox = await resultsList.boundingBox();
  if (headerBox === null || resultsBox === null) {
    throw new Error("expected both the header and the results list to have a real bounding box");
  }
  const headerBottom = headerBox.y + headerBox.height;
  const resultsBottom = resultsBox.y + resultsBox.height;
  console.log(JSON.stringify({ test: "search-results-overflow desktop boxes", headerBottom, resultsBottom }));

  expect(
    resultsBottom,
    `results list bottom (${resultsBottom}px) does not extend below the header's own bottom edge (${headerBottom}px) — results are still confined inside the header`,
  ).toBeGreaterThan(headerBottom);

  // Hit-test, not just geometry: a box CAN extend below the header's bottom
  // edge while still being clipped/unpainted there (e.g. by an ancestor's
  // `overflow: hidden`). Sample a point just below the header's bottom edge,
  // horizontally centered in the results list, and confirm the element
  // actually painted there is the results list itself (or a descendant of
  // it) — proof the dropdown is genuinely visible and hit-testable overlaying
  // the page, not merely reported as such by `getBoundingClientRect`.
  const probeX = resultsBox.x + resultsBox.width / 2;
  const probeY = headerBottom + 5;
  if (probeY >= resultsBottom) {
    throw new Error(`probe point y=${probeY} is not within the results list's own box (bottom ${resultsBottom}) — cannot hit-test`);
  }
  const hitTest = await page.evaluate(
    ({ x, y, selector }) => {
      const el = document.elementFromPoint(x, y);
      const resultsListEl = document.querySelector(selector);
      return {
        hitTag: el?.tagName ?? null,
        paintedInsideResultsList: resultsListEl !== null && el !== null && resultsListEl.contains(el),
      };
    },
    { x: probeX, y: probeY, selector: '[data-slot="command-list"]' },
  );
  console.log(JSON.stringify({ test: "search-results-overflow desktop hit-test", probeX, probeY, ...hitTest }));

  expect(
    hitTest.paintedInsideResultsList,
    `elementFromPoint(${probeX}, ${probeY}) — just below the header's bottom edge — hit a "${hitTest.hitTag}" that is not inside the results list; the dropdown is not actually painted/hit-testable below the header`,
  ).toBe(true);
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
