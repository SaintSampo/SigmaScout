import { test, expect } from "@playwright/test";
import { touchDrag } from "./support/touchDrag.js";
import { assertNoIntermediateScroller, assertNoPagePan, assertOverflows } from "./support/scrollRegions.js";

/**
 * C1's 390px pan-and-re-render evidence for the accuracy table and C3's
 * 390px legend, axis-label and sparse-bin-radius evidence for the
 * calibration section (08-15-PLAN.md Task 3).
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
 * `CalibrationSection.tsx`'s/`CalibrationChart.tsx`'s own exported testid
 * constants — kept in sync by hand, matching this app's established
 * e2e-does-not-import-app-source convention (`simulation-run.spec.ts`).
 */

const COMPARE_URL = "/compare";
const ACCURACY_SCROLL_TESTID = "compare-accuracy-scroll";
const SWITCHER_SEGMENT_TESTIDS = {
  combined: "compare-comp-level-switcher-segment-combined",
  qualification: "compare-comp-level-switcher-segment-qualification",
  elimination: "compare-comp-level-switcher-segment-elimination",
} as const;
const CALIBRATION_SECTION_TESTID = "compare-calibration-section";
const CALIBRATION_LEGEND_TESTID = "compare-calibration-legend";
const CALIBRATION_CHART_TESTID = "calibration-chart";
const CALIBRATION_SENTENCE_TESTID = "compare-calibration-sentence";

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
    const scroller = region.locator('[data-slot="table-container"]');

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

test.describe("C3 — the Compare calibration section at 390px: legend, axis labels and sparse-bin radius scaling all stay legible", () => {
  test("all three legend entries render with non-empty text inside the viewport, no axis tick is clipped or reads as float noise, and the sparse-bin radius scaling is real", async ({
    page,
  }, testInfo) => {
    await openComparePage(page);

    const section = page.getByTestId(CALIBRATION_SECTION_TESTID);
    await section.scrollIntoViewIfNeeded();

    const legend = page.getByTestId(CALIBRATION_LEGEND_TESTID);
    await expect(legend).toBeVisible();
    const legendButtons = legend.getByRole("button");
    await expect(legendButtons).toHaveCount(3);

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size");
    const legendCount = await legendButtons.count();
    for (let i = 0; i < legendCount; i++) {
      const entry = legendButtons.nth(i);
      const text = (await entry.innerText()).trim();
      expect(text.length, `legend entry ${i} must render non-empty text`).toBeGreaterThan(0);
      const box = await entry.boundingBox();
      if (box === null) throw new Error(`legend entry ${i} has no bounding box`);
      expect(box.x, `legend entry "${text}" left edge must be inside the viewport`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `legend entry "${text}" right edge must be inside the viewport`).toBeLessThanOrEqual(viewport.width + 1);
    }

    const chart = page.getByTestId(CALIBRATION_CHART_TESTID);
    await expect(chart).toBeVisible();

    // Every rendered tick label (X and Y axes both carry the same
    // `.recharts-cartesian-axis-tick-value` class on their <text> nodes) —
    // `metric-history-axis-legibility.spec.ts`'s own established technique.
    const tickInfo = await chart.evaluate((el) => {
      const svg = el.querySelector("svg.recharts-surface");
      if (svg === null) throw new Error("expected a rendered recharts <svg>");
      const svgRect = svg.getBoundingClientRect();
      const ticks = Array.from(el.querySelectorAll(".recharts-cartesian-axis-tick-value"));
      return {
        svgLeft: svgRect.left,
        svgBottom: svgRect.bottom,
        ticks: ticks.map((tickEl) => {
          const rect = tickEl.getBoundingClientRect();
          return { label: tickEl.textContent ?? "", left: rect.left, bottom: rect.bottom };
        }),
      };
    });
    expect(tickInfo.ticks.length, "expected at least one rendered axis tick").toBeGreaterThan(0);
    for (const tick of tickInfo.ticks) {
      expect(tick.label, `tick "${tick.label}" reads as float noise`).not.toMatch(FLOAT_NOISE_PATTERN);
      expect(tick.left, `tick "${tick.label}" left edge (${tick.left}) is clipped before the SVG's own left edge (${tickInfo.svgLeft})`).toBeGreaterThanOrEqual(tickInfo.svgLeft - 1);
      expect(tick.bottom, `tick "${tick.label}" bottom edge (${tick.bottom}) is clipped past the SVG's own bottom edge (${tickInfo.svgBottom})`).toBeLessThanOrEqual(tickInfo.svgBottom + 1);
    }

    // Sparse-bin encoding: every rendered point's radius, read directly off
    // the SVG circles the custom dot renderer draws.
    const radii = await chart.evaluate((el) => Array.from(el.querySelectorAll("circle")).map((c) => Number(c.getAttribute("r") ?? "0")));
    expect(radii.length, "expected at least one rendered calibration point").toBeGreaterThan(0);
    const minRadius = Math.min(...radii);
    const maxRadius = Math.max(...radii);
    expect(minRadius, "no sparse bin may be hidden — every rendered point's radius must be strictly greater than zero").toBeGreaterThan(0);
    expect(new Set(radii).size, "the radii must not all be equal — the scaling must actually be applied, not merely declared").toBeGreaterThan(1);
    expect(maxRadius, "the largest-count bin's radius must exceed the smallest-count bin's — the scale must run the right way").toBeGreaterThan(minRadius);

    // The calibration chart is demoted beneath its own sentence — asserted,
    // not assumed: the sentence's computed font-size must exceed a tick
    // label's.
    const sentenceFontSize = await page.getByTestId(CALIBRATION_SENTENCE_TESTID).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const firstTick = chart.locator(".recharts-cartesian-axis-tick-value").first();
    const tickFontSize = await firstTick.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(sentenceFontSize, `sentence font-size ${sentenceFontSize}px must exceed the chart's own tick-label font-size ${tickFontSize}px`).toBeGreaterThan(tickFontSize);

    const shot = testInfo.outputPath("compare-calibration-390.png");
    await page.screenshot({ path: shot, fullPage: true });
    // eslint-disable-next-line no-console -- Task 4's checkpoint names this exact path for the human judgement call.
    console.log(`[08-15] C3 calibration screenshot: ${shot}`);
  });
});
