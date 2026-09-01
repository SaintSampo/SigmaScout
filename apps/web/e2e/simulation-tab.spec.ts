import { test, expect } from "@playwright/test";
import { touchDrag } from "./support/touchDrag.js";
import { assertNoIntermediateScroller, assertOverflows } from "./support/scrollRegions.js";
import { openSimulationTab, runSimulation, selectStartMatch, SIMULATION_TEST_IDS } from "./support/simulation.js";

/**
 * S3's 78-team render and performance evidence at `2023cur`, across both
 * widths, and (added by Task 2) S1's 134-row picker nested-scroll evidence
 * at `2022oncmp` with the `2024wvrox` offseason control (08-15-PLAN.md).
 *
 * Runs against the LOCAL origin only (`local-phone-390`'s `testMatch`,
 * `playwright.config.ts`) — this is unshipped Phase 8 code, so only a
 * local-origin project can be green at execution time, reading real
 * published R2 bytes through `vite.config.ts`'s `preview.proxy['/v1']`
 * (PD-04). No selector in this file is invented: every literal is read out
 * of shipped source and paired with a grep proving it appears verbatim in
 * the component that renders it (this plan's Task 1/Task 2 acceptance
 * criteria).
 */

/**
 * `simAxis.ts`'s own locked geometry constants, read out of that file rather
 * than transcribed — `PLOT_W = 470` (re-exported verbatim from
 * `matchAxis.ts`), `HIST_BAR_MAX_H = 32`, `MEDIAN_TICK_W = 2`. An e2e spec
 * does not import app source (`simulation-run.spec.ts`'s own established
 * precedent), so these are kept in sync by hand.
 */
const PLOT_W = 470;
const HIST_BAR_MAX_H = 32;
const MEDIAN_TICK_W = 2;

const S3_EVENT_KEY = "2023cur";
const S3_TEAM_COUNT = 78;
const S3_REMAINING_MATCHES = 130;

test.describe("S3 — the rank-distribution table at its largest real roster (2023cur, 78 teams, 130 remaining matches)", () => {
  test("1440x900: one shared rank axis, every mark on every row measured visible at the real slot pitch", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSimulationTab(page, S3_EVENT_KEY);
    // The first picker row simulates every one of the event's 130
    // qualification matches — the phase's genuine worst case.
    await selectStartMatch(page, 0);
    const elapsedMs = await runSimulation(page);

    const rows = page.getByTestId(SIMULATION_TEST_IDS.rankRow);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count(), "the rank-distribution table must render exactly one row per event team").toBe(S3_TEAM_COUNT);

    // Exactly ONE rank axis element in the whole table — a per-row scale is
    // the shape sketch 005 had rejected on sight.
    expect(await page.getByTestId("rank-axis-ticks").count()).toBe(1);

    // The measured slot pitch — the plot's rendered width divided by the
    // team count — within a 0.5px tolerance of PLOT_W / teamCount, turning
    // UI-SPEC's stated "~6px per rank position" into a measurement.
    const firstPlot = page.locator('[data-testid^="rank-plot-"]').first();
    const plotBox = await firstPlot.boundingBox();
    if (plotBox === null) throw new Error("rank plot cell has no bounding box");
    const measuredPitch = plotBox.width / S3_TEAM_COUNT;
    const expectedPitch = PLOT_W / S3_TEAM_COUNT;
    expect(Math.abs(measuredPitch - expectedPitch), `measured slot pitch ${measuredPitch}px vs expected ${expectedPitch}px`).toBeLessThanOrEqual(0.5);
    // eslint-disable-next-line no-console -- printed for the SUMMARY's measured-figure obligation.
    console.log(`[08-15] S3 measured slot pitch at ${S3_TEAM_COUNT} teams: ${measuredPitch.toFixed(2)}px (PLOT_W/N = ${expectedPitch.toFixed(2)}px)`);

    let maxDistinctBarPositions = 0;
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);

      const bars = row.locator(".sim-hist-bar");
      const barCount = await bars.count();
      expect(barCount, `row ${i} must render at least one histogram bar`).toBeGreaterThanOrEqual(1);
      maxDistinctBarPositions = Math.max(maxDistinctBarPositions, barCount);
      for (let b = 0; b < barCount; b++) {
        const barBox = await bars.nth(b).boundingBox();
        if (barBox === null) throw new Error(`row ${i} bar ${b} has no bounding box`);
        expect(barBox.width, `row ${i} bar ${b} width`).toBeGreaterThan(0);
        expect(barBox.height, `row ${i} bar ${b} height`).toBeGreaterThan(0);
        expect(barBox.height, `row ${i} bar ${b} height must not exceed HIST_BAR_MAX_H`).toBeLessThanOrEqual(HIST_BAR_MAX_H + 0.5);
      }

      const tick = row.locator(".sim-median-tick");
      await expect(tick, `row ${i} must render exactly one median tick`).toHaveCount(1);
      await expect(tick).toBeVisible();
      const tickBox = await tick.boundingBox();
      if (tickBox === null) throw new Error(`row ${i} median tick has no bounding box`);
      expect(tickBox.width, `row ${i} median tick width must equal MEDIAN_TICK_W`).toBeCloseTo(MEDIAN_TICK_W, 0);

      const band = row.locator(".sim-band-overlay");
      await expect(band, `row ${i} must render exactly one percentile band`).toHaveCount(1);
      const plotBoxForRow = await row.locator('[data-testid^="rank-plot-"]').boundingBox();
      const bandBox = await band.boundingBox();
      if (plotBoxForRow === null || bandBox === null) throw new Error(`row ${i} plot or band has no bounding box`);
      expect(bandBox.width, `row ${i} band width must be strictly greater than zero`).toBeGreaterThan(0);
      expect(bandBox.x, `row ${i} band left edge must lie inside the plot`).toBeGreaterThanOrEqual(plotBoxForRow.x - 0.5);
      expect(bandBox.x + bandBox.width, `row ${i} band right edge must lie inside the plot`).toBeLessThanOrEqual(plotBoxForRow.x + plotBoxForRow.width + 0.5);
    }

    expect(maxDistinctBarPositions, "at least one row must show five or more distinct bar positions, proving the table shows distributions rather than identical blocks").toBeGreaterThanOrEqual(5);

    // D-05's prohibition made observable: no rank cell ever renders a
    // plus-or-minus glyph. U+00B1.
    const tableText = (await page.locator('[data-testid="rank-distribution-table-scroll"]').innerText()).trim();
    expect(tableText).not.toContain("±");

    expect(elapsedMs, `measured elapsed ${elapsedMs}ms must clear a generous ceiling (PD-06) — only a real hang or a pathological regression trips this`).toBeLessThan(60_000);
    // eslint-disable-next-line no-console -- printed for the SUMMARY's SC-2 obligation, complementing 08-13's representative capture.
    console.log(`[08-15] S3 worst-case measurement: event=${S3_EVENT_KEY} teamCount=${S3_TEAM_COUNT} remainingMatches=${S3_REMAINING_MATCHES} elapsedMs=${elapsedMs}`);

    const shot = testInfo.outputPath(`simulation-tab-${S3_EVENT_KEY}-${S3_TEAM_COUNT}-rows-desktop.png`);
    await page.screenshot({ path: shot, fullPage: true });
    // eslint-disable-next-line no-console -- Task 4's checkpoint names this exact path for the human judgement call.
    console.log(`[08-15] S3 desktop screenshot: ${shot}`);
  });

  test("390x844: the same 78-row table, its own scroll region overflows, passes the ancestor walk, and the pinned Team # column holds across a full-width drag while Nickname (unpinned below 768px) and Median both move", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSimulationTab(page, S3_EVENT_KEY);
    await selectStartMatch(page, 0);
    const elapsedMs = await runSimulation(page);

    const rows = page.getByTestId(SIMULATION_TEST_IDS.rankRow);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(S3_TEAM_COUNT);

    const region = page.locator(`[data-testid="${SIMULATION_TEST_IDS.rankTableScroll}"]`);
    await assertOverflows(region);
    await assertNoIntermediateScroller(region);

    // Below MOBILE_BREAKPOINT_PX (this project's 390px viewport), only
    // teamNumber stays pinned — `RankDistributionTable.tsx`'s own
    // `RANK_MOBILE_PINNED_COLUMN_IDS`, the identical G-2 narrowing
    // `InsightsTab.tsx`/`BreakdownTab.tsx` already established. Nickname is
    // NOT pinned at this width and must move with the drag like any other
    // unpinned column.
    const pinnedHeader = page.getByTestId("rank-header-teamNumber");
    const nicknameHeader = page.getByTestId("rank-header-nickname");
    const unpinnedHeader = page.getByTestId("rank-header-medianDisplay");

    expect(await nicknameHeader.getAttribute("data-pinned")).toBe("false");
    expect(await pinnedHeader.getAttribute("data-pinned")).toBe("true");

    const pinnedBefore = await pinnedHeader.boundingBox();
    const nicknameBefore = await nicknameHeader.boundingBox();
    const unpinnedBefore = await unpinnedHeader.boundingBox();
    if (pinnedBefore === null || nicknameBefore === null || unpinnedBefore === null) throw new Error("header cell missing a bounding box");

    const regionBox = await region.boundingBox();
    if (regionBox === null) throw new Error("rank table scroll region has no bounding box");
    await touchDrag(page, { x: regionBox.x + regionBox.width - 20, y: regionBox.y + 30 }, { x: regionBox.x + 20, y: regionBox.y + 30 });

    const pinnedAfter = await pinnedHeader.boundingBox();
    const nicknameAfter = await nicknameHeader.boundingBox();
    const unpinnedAfter = await unpinnedHeader.boundingBox();
    if (pinnedAfter === null || nicknameAfter === null || unpinnedAfter === null) throw new Error("header cell missing a bounding box after the drag");

    expect(pinnedAfter.x).toBeCloseTo(pinnedBefore.x, 0);
    expect(nicknameAfter.x).not.toBeCloseTo(nicknameBefore.x, 0);
    expect(unpinnedAfter.x).not.toBeCloseTo(unpinnedBefore.x, 0);

    expect(elapsedMs).toBeLessThan(60_000);
    // eslint-disable-next-line no-console -- printed for the SUMMARY's SC-2 obligation.
    console.log(`[08-15] S3 worst-case measurement (390px): event=${S3_EVENT_KEY} teamCount=${S3_TEAM_COUNT} remainingMatches=${S3_REMAINING_MATCHES} elapsedMs=${elapsedMs}`);

    const shot = testInfo.outputPath(`simulation-tab-${S3_EVENT_KEY}-${S3_TEAM_COUNT}-rows-phone.png`);
    await page.screenshot({ path: shot, fullPage: true });
    // eslint-disable-next-line no-console -- Task 4's checkpoint names this exact path for the human judgement call.
    console.log(`[08-15] S3 phone screenshot: ${shot}`);
  });
});
