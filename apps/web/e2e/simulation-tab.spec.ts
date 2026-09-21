import { test, expect } from "@playwright/test";
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

const S3_EVENT_KEY = "2026arc";
const S3_TEAM_COUNT = 75;
const S3_REMAINING_MATCHES = 125;

test.describe("S3 — the rank-distribution table at its largest real roster (2026arc, 75 teams, 125 remaining matches)", () => {
  test("1440x900: one shared rank axis, every mark on every row measured visible at the real slot pitch", async ({ page }, testInfo) => {
    // 75 rows x up to 75 bars, each measured: far past the default 30s.
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSimulationTab(page, S3_EVENT_KEY);
    // Start match 1 simulates every one of the event's 125
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
    expect(measuredPitch, `measured slot pitch ${measuredPitch}px must not fall under the designed floor ${expectedPitch}px`).toBeGreaterThanOrEqual(expectedPitch - 0.5);
    // eslint-disable-next-line no-console -- printed for the SUMMARY's measured-figure obligation.
    console.log(`[simulation-tab] measured slot pitch at ${S3_TEAM_COUNT} teams: ${measuredPitch.toFixed(2)}px (PLOT_W/N = ${expectedPitch.toFixed(2)}px)`);

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

    expect(elapsedMs, `measured elapsed ${elapsedMs}ms must clear a generous ceiling — only a real hang or a pathological regression trips this`).toBeLessThan(60_000);
    // eslint-disable-next-line no-console -- printed for the SUMMARY's SC-2 obligation, complementing 08-13's representative capture.
    console.log(`[simulation-tab] worst-case measurement: event=${S3_EVENT_KEY} teamCount=${S3_TEAM_COUNT} remainingMatches=${S3_REMAINING_MATCHES} elapsedMs=${elapsedMs}`);

    const shot = testInfo.outputPath(`simulation-tab-${S3_EVENT_KEY}-${S3_TEAM_COUNT}-rows-desktop.png`);
    await page.screenshot({ path: shot, fullPage: true });
    // eslint-disable-next-line no-console -- Task 4's checkpoint names this exact path for the human judgement call.
    console.log(`[simulation-tab] desktop screenshot: ${shot}`);
  });

  test("390x844: the same 75-row table fits its region with no page overflow and a usable plot width", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSimulationTab(page, S3_EVENT_KEY);
    await selectStartMatch(page, 0);
    const elapsedMs = await runSimulation(page);

    const rows = page.getByTestId(SIMULATION_TEST_IDS.rankRow);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(S3_TEAM_COUNT);

    // At phone width the table fits its region (names truncate, the plot is
    // fluid), so there is nothing to pan: the region must not overflow, the
    // page must not overflow, and every plot must keep a usable width.
    const region = page.locator(`[data-testid="${SIMULATION_TEST_IDS.rankTableScroll}"]`);
    const regionSize = await region.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(regionSize.scrollWidth, `rank table scrollWidth ${regionSize.scrollWidth} must fit its region ${regionSize.clientWidth}`).toBeLessThanOrEqual(regionSize.clientWidth);
    const doc = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(doc.scrollWidth, `document scrollWidth ${doc.scrollWidth} must not exceed ${doc.clientWidth}`).toBeLessThanOrEqual(doc.clientWidth);
    const plotBox = await page.locator('[data-testid^="rank-plot-"]').first().boundingBox();
    if (plotBox === null) throw new Error("rank plot cell has no bounding box");
    expect(plotBox.width / S3_TEAM_COUNT, "each rank slot must keep at least 1.5px at phone width").toBeGreaterThanOrEqual(1.5);

    expect(elapsedMs).toBeLessThan(60_000);
    // eslint-disable-next-line no-console -- printed for the SUMMARY's SC-2 obligation.
    console.log(`[simulation-tab] worst-case measurement (390px): event=${S3_EVENT_KEY} teamCount=${S3_TEAM_COUNT} remainingMatches=${S3_REMAINING_MATCHES} elapsedMs=${elapsedMs}`);

    const shot = testInfo.outputPath(`simulation-tab-${S3_EVENT_KEY}-${S3_TEAM_COUNT}-rows-phone.png`);
    await page.screenshot({ path: shot, fullPage: true });
    // eslint-disable-next-line no-console -- Task 4's checkpoint names this exact path for the human judgement call.
    console.log(`[simulation-tab] phone screenshot: ${shot}`);
  });
});

/**
 * S1 — the start-match picker at the largest qualification slate that carries
 * ranking point odds. The picker is a slider plus a number input, so there is
 * no row list to overflow: the facts worth pinning are that both controls span
 * the whole slate and that the panel never pushes the page sideways at 390px.
 * The simulation sidecars exist from 2026 on, so the target is that season's
 * largest slate.
 */
const S1_EVENT_KEY = "2026mrcmp";
const S1_MATCH_COUNT = 132;

test.describe("S1 — the start-match picker at its real maximum (2026mrcmp, 132 qualification matches)", () => {
  test("the slider and the number input both span the whole slate, and the panel adds no horizontal page overflow at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSimulationTab(page, S1_EVENT_KEY);

    const slider = page.getByTestId("start-match-slider");
    const input = page.getByTestId("start-match-number");
    await expect(slider).toBeVisible();
    expect(await slider.getAttribute("max")).toBe(String(S1_MATCH_COUNT));

    await selectStartMatch(page, S1_MATCH_COUNT - 1);
    await expect(slider).toHaveValue(String(S1_MATCH_COUNT));

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `document scrollWidth ${scrollWidth} must not exceed clientWidth ${clientWidth}`).toBeLessThanOrEqual(clientWidth);
  });
});

const S1_CONTROL_EVENT_KEY = "2024wvrox";
/** `SimulationTab.tsx`'s own `SIMULATION_UNAVAILABLE_HEADING`, verbatim. */
const SIMULATION_UNAVAILABLE_HEADING = "Rank simulation isn't available for this event";

test.describe("S1 control — 2024wvrox, the largest qualification slate in the corpus (135 rows), renders the unavailable state and zero picker rows", () => {
  test("the event-type gate, made legible as a control: TBA event type 99 is deliberately absent from EVENT_TYPE_TIERS, so the RP algorithm emits no pmf here, so hasSimulatableRankInputs is false and the unavailable branch renders instead of a picker", async ({ page }) => {
    await page.goto(`/event/${S1_CONTROL_EVENT_KEY}?algorithm=spr&tab=simulation`, { waitUntil: "networkidle" });
    await expect(page.getByText(SIMULATION_UNAVAILABLE_HEADING)).toBeVisible();
    expect(await page.locator(`[data-testid^="${SIMULATION_TEST_IDS.rowPrefix}"]`).count()).toBe(0);
  });
});
