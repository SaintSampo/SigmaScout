import { test, expect } from "@playwright/test";
import { touchDrag } from "./support/touchDrag.js";
import { assertNoIntermediateScroller, assertNoPagePan, assertOverflows } from "./support/scrollRegions.js";

/**
 * C1's 390px pan-and-re-render evidence for the accuracy table and C3's
 * 390px card-legibility evidence (headline sentence, bin range labels, mini
 * deviation-chart bars) for the calibration section (08-15-PLAN.md Task 3).
 *
 * Runs against the LOCAL origin only (`local-phone-390`'s `testMatch`,
 * `playwright.config.ts`) — this is unshipped Phase 8 code, so only a
 * local-origin project can be green at execution time, reading real
 * published R2 bytes for all five Compare years through
 * `vite.config.ts`'s `preview.proxy['/v1']` (PD-04).
 *
 * Every literal here is read out of shipped source: `AccuracyTable.tsx`'s
 * `COMPARE_ACCURACY_SCROLL_TESTID`, `CompLevelSwitcher.tsx`'s
 * `COMP_LEVEL_SWITCHER_TESTID`/`compLevelSegmentTestId`, and
 * `CalibrationSection.tsx`'s own exported testid constants — kept in sync by
 * hand, matching this app's established e2e-does-not-import-app-source
 * convention (`simulation-run.spec.ts`). WR-07
 * (260902-post-phase08-ungoverned-ui/REVIEW.md): this file used to also cite
 * a since-deleted three-series reliability-diagram component the user's
 * 2026-09-01 checkpoint replaced with `CalibrationSection.tsx`'s
 * per-algorithm plain-language cards (`calibrationCards.ts`) — that
 * component no longer exists, and nothing in this spec ever imported it.
 */

const COMPARE_URL = "/compare";
const ACCURACY_SCROLL_TESTID = "compare-accuracy-scroll";
const SWITCHER_SEGMENT_TESTIDS = {
  combined: "compare-comp-level-switcher-segment-combined",
  qualification: "compare-comp-level-switcher-segment-qualification",
  elimination: "compare-comp-level-switcher-segment-elimination",
} as const;
const CALIBRATION_SECTION_TESTID = "compare-calibration-section";

async function openComparePage(page: import("@playwright/test").Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(COMPARE_URL, { waitUntil: "networkidle" });
  // Five per-year artifact fetches fan out — wait on the POPULATED table
  // rather than a fixed delay. [Rule 1 - Bug, found live running this task's
  // own required e2e pass] `AccuracyTableSkeleton` renders the identical
  // 5-row `tbody tr` shape the populated table does (`SkeletonRows`'s own
  // footprint-matching design), so a `tbody tr` count check alone is
  // satisfied by the SKELETON and races ahead of the real data — measuring
  // scrollWidth against generic-width skeleton cells produced a false
  // "never overflows" premise failure. Waiting for a real season year's
  // text (present only once real artifact data has landed) is what actually
  // waits on the populated state.
  const region = page.locator(`[data-testid="${ACCURACY_SCROLL_TESTID}"]`);
  await region.waitFor({ state: "visible", timeout: 15_000 });
  await expect(region.getByText("2022", { exact: true })).toBeVisible({ timeout: 15_000 });
}

test.describe("C1 — the Compare accuracy table at 390px: pans inside its own region, re-renders identically across all three compLevel views", () => {
  test("the table's scroll region overflows, passes the ancestor walk, and a full-width drag advances only that region while the document never pans", async ({ page }) => {
    await openComparePage(page);
    const region = page.locator(`[data-testid="${ACCURACY_SCROLL_TESTID}"]`);

    // The routed deferred-items.md finding this comment used to describe is
    // FIXED (2026-08-31): `AccuracyTable.tsx` now renders a raw `<table>`
    // inside its own scroll region — matching every sibling table in the
    // app — so `compare-accuracy-scroll` IS the literal scrolling element
    // and this evidence targets it directly, no inner-wrapper workaround.
    const scroller = region;

    await assertOverflows(scroller);
    await assertNoIntermediateScroller(scroller);
    await assertNoPagePan(page);

    const box = await scroller.boundingBox();
    if (box === null) throw new Error("accuracy table scroll region has no bounding box");
    const scrollLeftBefore = await scroller.evaluate((el) => el.scrollLeft);

    await touchDrag(page, { x: box.x + box.width - 20, y: box.y + box.height / 2 }, { x: box.x + 20, y: box.y + box.height / 2 });

    const scrollLeftAfter = await scroller.evaluate((el) => el.scrollLeft);
    expect(scrollLeftAfter, "the drag must have advanced the region's own scrollLeft somewhere").toBeGreaterThan(scrollLeftBefore);
    await assertNoPagePan(page);
  });

  test("switching Combined -> Qualification -> Elimination never changes the table's scrollWidth or header-cell count, and never pans the page", async ({ page }) => {
    await openComparePage(page);
    const region = page.locator(`[data-testid="${ACCURACY_SCROLL_TESTID}"]`);
    // AccuracyTable owns its scroller since 2026-08-31 — the region IS it.
    const scroller = region;

    const combinedScrollWidth = await scroller.evaluate((el) => el.scrollWidth);
    const combinedHeaderCount = await region.locator("thead th").count();

    for (const view of ["qualification", "elimination"] as const) {
      await page.getByTestId(SWITCHER_SEGMENT_TESTIDS[view]).click();
      await assertNoPagePan(page);

      const scrollWidth = await scroller.evaluate((el) => el.scrollWidth);
      const headerCount = await region.locator("thead th").count();
      expect(scrollWidth, `${view} view's scrollWidth ${scrollWidth} must equal the Combined view's ${combinedScrollWidth} — the switcher changes cell contents and emphasis only`).toBe(
        combinedScrollWidth,
      );
      expect(headerCount, `${view} view's header-cell count ${headerCount} must equal the Combined view's ${combinedHeaderCount}`).toBe(combinedHeaderCount);
    }

    // Return to Combined and confirm the identity holds both ways.
    await page.getByTestId(SWITCHER_SEGMENT_TESTIDS.combined).click();
    await assertNoPagePan(page);
    expect(await scroller.evaluate((el) => el.scrollWidth)).toBe(combinedScrollWidth);
    expect(await region.locator("thead th").count()).toBe(combinedHeaderCount);
  });
});

/** `\.\d*9{4,}\d*$|\.\d*0{4,}\d+$` — the identical float-noise pattern `metric-history-axis-legibility.spec.ts` established as this test class's first instance. */
const FLOAT_NOISE_PATTERN = /\.\d*9{4,}\d*$|\.\d*0{4,}\d+$/;

// WR-07 (260902-post-phase08-ungoverned-ui/REVIEW.md): this describe block's
// title used to promise "legend, axis-label and sparse-bin-radius evidence"
// — the vocabulary of the deleted three-series reliability-diagram
// component (legend, shared axis, per-point radius). The plain-SVG per-
// algorithm card rebuild below never draws any of those three things; the
// test bodies were already correctly rewritten to card assertions (headline
// sentence, bin range labels, mini deviation-chart bars) — only this title
// was still describing evidence nothing here produces.
test.describe("C3 — the Compare calibration section at 390px: each card's headline sentence, bin range labels and mini deviation-chart bars stay legible", () => {
  test("each algorithm card renders a non-empty headline sentence inside the viewport, its bin rows carry range labels, and its mini deviation chart draws real bars", async ({ page }) => {
    await openComparePage(page);

    const section = page.getByTestId(CALIBRATION_SECTION_TESTID);
    await section.scrollIntoViewIfNeeded();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size");

    for (const algorithmId of ["opr", "epa", "vpr"]) {
      const card = page.getByTestId(`compare-calibration-card-${algorithmId}`);
      await expect(card).toBeVisible();
      await card.scrollIntoViewIfNeeded();

      const cardBox = await card.boundingBox();
      if (cardBox === null) throw new Error(`card ${algorithmId} has no bounding box`);
      expect(cardBox.x, `card ${algorithmId} left edge inside viewport`).toBeGreaterThanOrEqual(0);
      expect(cardBox.x + cardBox.width, `card ${algorithmId} right edge inside viewport`).toBeLessThanOrEqual(viewport.width + 1);

      const sentence = page.getByTestId(`compare-calibration-sentence-${algorithmId}`);
      const sentenceText = (await sentence.innerText()).trim();
      expect(sentenceText.length, `card ${algorithmId} sentence non-empty`).toBeGreaterThan(20);
      expect(sentenceText, `card ${algorithmId} sentence is the plain-language form`).toMatch(/^When .+ put red.s win chance at about /);

      // Ten published bins -> ten range labels, empties included (sparse honesty).
      const rangeLabels = await card.locator("span").filter({ hasText: /^\d+–\d+%$/ }).count();
      expect(rangeLabels, `card ${algorithmId} renders every bin range label`).toBe(10);

      // The mini deviation chart draws one bar per VALID bin — at least one
      // real bar on every card for the current live data.
      const barCount = await card.locator("svg rect").count();
      expect(barCount, `card ${algorithmId} mini chart draws bars`).toBeGreaterThan(0);
      expect(barCount, `card ${algorithmId} bars never exceed the bin count`).toBeLessThanOrEqual(10);
    }
  });
});

