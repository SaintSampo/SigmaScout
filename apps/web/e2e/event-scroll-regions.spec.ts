/**
 * The sibling-scroll-region evidence at phone width. Proves, against the
 * widest real data that exists in five seasons of corpus data, that the
 * tab strip's own scroll region, each tab's own table scroll region, and
 * the page's vertical scroll are three SIBLING regions — never nested,
 * never trapping one another — under a real CDP touch drag at 390px (and,
 * for the shared structural cases, at 360px too).
 *
 * Runs against the DEPLOYED origin (`playwright.config.ts`'s `baseURL`):
 * `https://data.sigmascout.org`'s R2 CORS policy does not allow-list
 * `localhost`/`*.pages.dev`, so there is nothing to scroll without the
 * real, deployed artifact.
 *
 * THE BOUNDARY THIS SPEC DOES NOT CROSS: every drag here is dispatched via
 * `e2e/support/touchDrag.ts`'s CDP `Input.dispatchTouchEvent` helper — a
 * synthesized gesture in a desktop Chromium engine wearing a phone viewport,
 * not iOS Safari's arbitration of a directional `touch-action: pan-x` inside
 * a different-axis outer scroller. This spec is necessary evidence and is
 * not proof of real-hardware touch behavior.
 *
 * The ancestor walk (`assertNoIntermediateScroller`) closes a gap
 * `.contains()` alone cannot: two regions can mutually fail `.contains()`
 * while still having a THIRD scroller sandwiched between them. Walking every
 * ancestor from a candidate scroll element up to (never including)
 * `document.body` and asserting none has a computed `overflow-x`/`overflow-y`
 * of `auto`/`scroll` rules that third case out.
 */
import { test, expect } from "@playwright/test";
import { touchDrag } from "./support/touchDrag.js";
import { assertNoIntermediateScroller, assertNoPagePan, assertOverflows, visibleMidpoint } from "./support/scrollRegions.js";
import { runSimulation, selectStartMatch, SIMULATION_TEST_IDS } from "./support/simulation.js";

const TAB_STRIP = '[data-testid="event-tab-strip-scroll"]';

/** The primary multi-tab structural target: 2024 is the widest component season, so this one event exercises all five tabs' structural sibling/no-trap invariants at once. `2024new` also carries pmfs on all 125 of its qm rows, so it doubles as the sixth (`simulation`) tab's own structural fixture — one event exercising all six tabs' invariants at once. */
const STRUCTURAL_EVENT_KEY = "2024new";

const TAB_SCROLL_TESTID: Record<string, string> = {
  insights: "insights-table-scroll",
  breakdown: "breakdown-table-scroll",
  quals: "quals-table-scroll",
  alliances: "alliances-table-scroll",
  elims: "elims-table-scroll",
  // The Simulation tab's scroll region does not exist until a run
  // completes — `RankDistributionTable.tsx`'s own
  // scroll-region testid, the same one `simulation-tab.spec.ts`'s S3 evidence
  // asserts against.
  simulation: SIMULATION_TEST_IDS.rankTableScroll,
};

// `simulation` joins as the sixth element, behind a real run (see the
// shared `beforeEach` below) rather than a parallel, weaker structural
// block of its own — the tab's scroll region does not exist until a run
// completes.
const TABS = ["insights", "breakdown", "quals", "alliances", "elims", "simulation"] as const;

function eventUrl(eventKey: string, tab: string): string {
  return `/event/${eventKey}?algorithm=spr&tab=${tab}`;
}

// `assertNoIntermediateScroller`, `assertOverflows`, `assertNoPagePan` and
// `visibleMidpoint` moved verbatim to `./support/scrollRegions.js` — the
// Compare page and the Simulation tab need the identical definitions, and
// a second hand-maintained copy of a
// nested-scroll definition is exactly the drift `touchDrag.ts`'s own
// extraction was done to prevent. Both hard-won findings that used to live
// in this file's own doc comments (the coupled-axis false positive, and "a
// region that never overflows proves nothing") moved with their functions —
// read them there.

// ---------------------------------------------------------------------------
// E5 and E6 — written and run FIRST (UI-SPEC calls E5 the highest-risk item
// on its tab, folding E6 into the same test class). If either is red, that
// is the finding and the remaining cases wait.
// ---------------------------------------------------------------------------

test.describe("E5 — Quals tab at phone width, highest-risk item on this tab", () => {
  const CASES = [
    { eventKey: "2023cur", label: "the widest non-championship-excluded quals slate", rowCount: 130 },
    { eventKey: "2025flta", label: "merge-at-width target (63 played + 21 upcoming)", rowCount: 84 },
  ] as const;

  for (const { eventKey, label, rowCount } of CASES) {
    test(`${eventKey} (${label}): ${rowCount} rows, Match column scrolls with the row, axis tick stays legible after a full-width drag`, async ({ page }, testInfo) => {
      await page.goto(eventUrl(eventKey, "quals"), { waitUntil: "networkidle" });
      const region = page.locator('[data-testid="quals-table-scroll"]');
      await region.waitFor({ state: "visible", timeout: 15_000 });

      const rows = region.locator('[data-testid^="match-row-"]');
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBe(rowCount);

      await assertOverflows(region);

      const shot = testInfo.outputPath(`quals-${eventKey}-${rowCount}-rows.png`);
      await page.screenshot({ path: shot, fullPage: true });
      // eslint-disable-next-line no-console -- Task 3's checkpoint names this exact path for the human judgement call.
      console.log(`[event-scroll-regions] quals density screenshot: ${shot}`);

      const matchHeader = region.getByRole("columnheader", { name: "Match", exact: true });
      const actualHeader = region.getByRole("columnheader", { name: "Actual RP", exact: true });
      const matchBefore = await matchHeader.boundingBox();
      const actualBefore = await actualHeader.boundingBox();
      if (matchBefore === null || actualBefore === null) throw new Error("header cell missing a bounding box");

      const { box, midY } = await visibleMidpoint(page, region);
      await touchDrag(page, { x: box.x + box.width - 20, y: midY }, { x: box.x + 20, y: midY });

      const matchAfter = await matchHeader.boundingBox();
      const actualAfter = await actualHeader.boundingBox();
      if (matchAfter === null || actualAfter === null) throw new Error("header cell missing a bounding box after the drag");
      expect(matchAfter.x).not.toBeCloseTo(matchBefore.x, 0);
      expect(actualAfter.x).not.toBeCloseTo(actualBefore.x, 0);

      const tick = region.getByTestId("axis-tick").first();
      await expect(tick).toBeVisible();
      const tickText = await tick.innerText();
      expect(tickText.trim().length).toBeGreaterThan(0);
    });
  }
});

test.describe("E6 — Elims tab at phone width, the widest elimination slate in five seasons of corpus data", () => {
  test("2022mirr (Rainbow Rumble, offseason): 60 unplayed ef rows across 20 sets, round labels stay legible after a full-width drag", async ({ page }, testInfo) => {
    await page.goto(eventUrl("2022mirr", "elims"), { waitUntil: "networkidle" });
    const region = page.locator('[data-testid="elims-table-scroll"]');
    await region.waitFor({ state: "visible", timeout: 15_000 });

    const rows = region.locator('[data-testid^="match-row-"]');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(60);

    await assertOverflows(region);

    const shot = testInfo.outputPath("elims-2022mirr-60-rows.png");
    await page.screenshot({ path: shot, fullPage: true });
    // eslint-disable-next-line no-console -- Task 3's checkpoint names this exact path for the human judgement call.
    console.log(`[event-scroll-regions] elims density screenshot: ${shot}`);

    const { box, midY } = await visibleMidpoint(page, region);
    await touchDrag(page, { x: box.x + box.width - 20, y: midY }, { x: box.x + 20, y: midY });

    const firstLabel = rows.first().locator("span").first();
    const lastLabel = rows.last().locator("span").first();
    await expect(firstLabel).toBeVisible();
    await expect(lastLabel).toBeVisible();
    expect((await firstLabel.innerText()).trim().length).toBeGreaterThan(0);
    expect((await lastLabel.innerText()).trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The shared structural sibling/no-trap invariants — one parameterised block
// over all five tabs, at `2024new`, so no tab is covered by a weaker case
// set than its siblings.
// ---------------------------------------------------------------------------

for (const tab of TABS) {
  test.describe(`sibling scroll regions — ${tab} tab (${STRUCTURAL_EVENT_KEY})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(eventUrl(STRUCTURAL_EVENT_KEY, tab), { waitUntil: "networkidle" });
      // Every other tab's scroll region exists the moment its panel
      // mounts, so waiting on the shared testid below is enough.
      // `simulation` is the one exception — its rank-table scroll region
      // does not exist until a run completes — so this beforeEach drives a
      // REAL run for `simulation` only, through the same driver
      // `simulation-tab.spec.ts` uses, before waiting on the shared
      // testid.
      if (tab === "simulation") {
        await page.getByTestId("start-match-picker").waitFor({ state: "visible", timeout: 15_000 });
        await selectStartMatch(page, 0);
        await runSimulation(page);
      }
      await page.locator(`[data-testid="${TAB_SCROLL_TESTID[tab]}"]`).waitFor({ state: "visible", timeout: 15_000 });
    });

    test("the tab strip and this tab's table region mutually fail .contains() in both directions, and both pass the ancestor walk", async ({ page }) => {
      const tableSel = `[data-testid="${TAB_SCROLL_TESTID[tab]}"]`;
      const { stripContainsTable, tableContainsStrip } = await page.evaluate(
        ({ stripSel, tableSel }) => {
          const strip = document.querySelector(stripSel);
          const table = document.querySelector(tableSel);
          if (strip === null || table === null) throw new Error("strip or table element not found");
          return { stripContainsTable: strip.contains(table), tableContainsStrip: table.contains(strip) };
        },
        { stripSel: TAB_STRIP, tableSel },
      );
      expect(stripContainsTable).toBe(false);
      expect(tableContainsStrip).toBe(false);

      await assertNoIntermediateScroller(page.locator(TAB_STRIP));
      await assertNoIntermediateScroller(page.locator(tableSel));
    });

    test("the document does not pan horizontally", async ({ page }) => {
      await assertNoPagePan(page);
    });

    // Not generated for `simulation`: its rank table is sized to exactly its
    // card's width with `overflow-x: hidden`, so it never scrolls
    // horizontally by design (855741c1, "should not ever have a horizontal
    // scroll bar") and a drag assertion against it would prove nothing.
    if (tab !== "simulation") {
      test("a horizontal drag inside the table region advances only that region, leaving the tab strip and the document at rest", async ({ page }) => {
        const region = page.locator(`[data-testid="${TAB_SCROLL_TESTID[tab]}"]`);
        await assertOverflows(region);

        // [Rule 1 - Bug, found live running this task's own required e2e pass]
        // `visibleMidpoint` below calls `scrollIntoViewIfNeeded()`, which is
        // this TEST'S OWN setup step to bring an off-screen region into a
        // draggable position — it is not part of the gesture under test. The
        // "before" snapshot must be taken AFTER that setup scroll settles, or
        // the assertion below measures this test's own scaffolding rather than
        // the drag's actual effect on the document.
        const { box, midY } = await visibleMidpoint(page, region);

        const strip = page.locator(TAB_STRIP);
        const regionBefore = await region.evaluate((el) => el.scrollLeft);
        const stripBefore = await strip.evaluate((el) => el.scrollLeft);
        const documentLeftBefore = await page.evaluate(() => document.documentElement.scrollLeft);
        const documentTopBefore = await page.evaluate(() => document.documentElement.scrollTop);

        await touchDrag(page, { x: box.x + box.width - 20, y: midY }, { x: box.x + 20, y: midY });

        const regionAfter = await region.evaluate((el) => el.scrollLeft);
        const stripAfter = await strip.evaluate((el) => el.scrollLeft);
        const documentLeftAfter = await page.evaluate(() => document.documentElement.scrollLeft);
        const documentTopAfter = await page.evaluate(() => document.documentElement.scrollTop);

        expect(regionAfter).toBeGreaterThan(regionBefore);
        expect(stripAfter).toBe(stripBefore);
        expect(documentLeftAfter).toBe(documentLeftBefore);
        expect(documentLeftAfter).toBe(0);
        expect(documentTopAfter).toBe(documentTopBefore);
      });
    }

    // There is no "a drag inside the tab strip advances only the strip" case:
    // the strip's tabs wrap instead of overflowing (3df8e116, "I should not be
    // able to scroll the events tab bar, it shouldn't move"), so the strip
    // never has anything to scroll. E2 below asserts that it does not overflow.

    // The bounded 8-row Alliances table may not fill the 844px phone
    // viewport at all, so a vertical drag over it would prove nothing about
    // page-scroll-versus-table-scroll arbitration — this case runs on the
    // four roster/match tabs only.
    if (tab !== "alliances") {
      test("a vertical drag over the table region advances the page's vertical scroll rather than being swallowed by the table", async ({ page }) => {
        const region = page.locator(`[data-testid="${TAB_SCROLL_TESTID[tab]}"]`);
        const box = await region.boundingBox();
        if (box === null) throw new Error("table region has no bounding box");

        // Deliberately mirrors `touch-scroll.spec.ts`'s pre-existing,
        // already-verified team-page pattern exactly: the raw bounding box
        // straight off the freshly-loaded page, NOT `scrollIntoViewIfNeeded`
        // first. [Rule 1 - Bug, found live running this task's own required
        // e2e pass] An earlier draft called `scrollIntoViewIfNeeded` before
        // reading the box, which for the `elims` tab specifically (only 15
        // rows at this shared `2024new` structural fixture, versus E6's
        // dedicated 60-row `2022mirr` target) repositioned the region such
        // that the computed drag coordinates landed on a page position CDP's
        // synthetic touch dispatch would not scroll from — confirmed by a
        // side-by-side comparison against `quals`' identical un-scrolled
        // formula, which scrolled correctly on every tab tested. The
        // established pattern needs no adjustment; the deviation was in this
        // spec's own scaffolding, not in the shipped page.
        const before = await page.evaluate(() => document.documentElement.scrollTop);
        const regionLeftBefore = await region.evaluate((el) => el.scrollLeft);

        await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 + 200 }, { x: box.x + box.width / 2, y: box.y + box.height / 2 - 200 });

        const after = await page.evaluate(() => document.documentElement.scrollTop);
        const regionLeftAfter = await region.evaluate((el) => el.scrollLeft);
        expect(after).toBeGreaterThan(before);
        expect(regionLeftAfter).toBe(regionLeftBefore);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// E3 — Insights, the widest roster that exists (78 at 2023cur, 75 at 2024new)
// ---------------------------------------------------------------------------

test.describe("E3 — Insights tab at the widest real rosters", () => {
  const CASES = [
    { eventKey: "2023cur", rowCount: 78 },
    { eventKey: "2024new", rowCount: 75 },
  ] as const;

  for (const { eventKey, rowCount } of CASES) {
    test(`${eventKey}: exactly ${rowCount} rows, every column including rank and Team # scrolls with a full-width drag (no sticky columns)`, async ({ page }) => {
      await page.goto(eventUrl(eventKey, "insights"), { waitUntil: "networkidle" });
      const region = page.locator('[data-testid="insights-table-scroll"]');
      await region.waitFor({ state: "visible", timeout: 15_000 });

      const rows = page.getByTestId("insights-row");
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBe(rowCount);

      await assertOverflows(region);

      const headerIds = ["rank", "teamNumber", "nickname", "record"] as const;
      const headers = headerIds.map((id) => page.getByTestId(`insights-header-${id}`));

      const before = await Promise.all(headers.map((h) => h.boundingBox()));
      if (before.some((b) => b === null)) throw new Error("header cell missing a bounding box");

      const { box, midY } = await visibleMidpoint(page, region);
      await touchDrag(page, { x: box.x + box.width - 20, y: midY }, { x: box.x + 20, y: midY });

      const after = await Promise.all(headers.map((h) => h.boundingBox()));
      if (after.some((b) => b === null)) throw new Error("header cell missing a bounding box after the drag");

      after.forEach((afterBox, index) => {
        expect(afterBox!.x).not.toBeCloseTo(before[index]!.x, 0);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// E4 — Breakdown under SPR: Team #, Team Name, Total and the three phase
// columns = 6 (a013ca1e: SPR Breakdown shows Total and the three phases only,
// pinned by BreakdownTab.test.tsx "spr desktop geometry ... six header cells")
// ---------------------------------------------------------------------------

test.describe("E4 — Breakdown tab, SPR column set", () => {
  test("2024new: exactly 6 header columns, every column scrolls with a full-width drag (no sticky columns)", async ({ page }) => {
    await page.goto(eventUrl("2024new", "breakdown"), { waitUntil: "networkidle" });
    const region = page.locator('[data-testid="breakdown-table-scroll"]');
    await region.waitFor({ state: "visible", timeout: 15_000 });

    const headerCells = region.locator("thead th");
    expect(await headerCells.count()).toBe(6);

    await assertOverflows(region);

    const teamNumberHeader = page.getByTestId("breakdown-header-teamNumber");
    const nicknameHeader = page.getByTestId("breakdown-header-nickname");
    const totalHeader = page.getByTestId("breakdown-header-total");

    const teamNumberBefore = await teamNumberHeader.boundingBox();
    const nicknameBefore = await nicknameHeader.boundingBox();
    const totalBefore = await totalHeader.boundingBox();
    if (teamNumberBefore === null || nicknameBefore === null || totalBefore === null) throw new Error("header cell missing a bounding box");

    const { box, midY } = await visibleMidpoint(page, region);
    await touchDrag(page, { x: box.x + box.width - 20, y: midY }, { x: box.x + 20, y: midY });

    const teamNumberAfter = await teamNumberHeader.boundingBox();
    const nicknameAfter = await nicknameHeader.boundingBox();
    const totalAfter = await totalHeader.boundingBox();
    if (teamNumberAfter === null || nicknameAfter === null || totalAfter === null) throw new Error("header cell missing a bounding box after the drag");

    expect(teamNumberAfter.x).not.toBeCloseTo(teamNumberBefore.x, 0);
    expect(nicknameAfter.x).not.toBeCloseTo(nicknameBefore.x, 0);
    expect(totalAfter.x).not.toBeCloseTo(totalBefore.x, 0);
  });
});

// ---------------------------------------------------------------------------
// E2 — the tab strip itself: six labels that WRAP rather than scroll
// (3df8e116, user: "I should not be able to scroll the events tab bar, it
// shouldn't move"). Labels renamed Qualifications/Playoffs in ed49b8a0 and
// 3f160098, pinned by event.$eventKey.test.tsx's six-tabs-in-order test.
// ---------------------------------------------------------------------------

const EXPECTED_TAB_LABELS = ["Insights", "Breakdown", "Qualifications", "Alliances", "Playoffs", "Simulation"] as const;

test.describe("E2 — the tab strip: 6 tabs, wrapping at phone width", () => {
  test(`${STRUCTURAL_EVENT_KEY}: exactly 6 role="tab" elements in the declared order, and the strip does not overflow at phone width`, async ({ page }) => {
    await page.goto(eventUrl(STRUCTURAL_EVENT_KEY, "insights"), { waitUntil: "networkidle" });
    const strip = page.locator(TAB_STRIP);
    await strip.waitFor({ state: "visible", timeout: 15_000 });

    const tabs = page.getByRole("tab");
    expect(await tabs.count()).toBe(6);
    const labels = await tabs.allTextContents();
    expect(labels.map((l) => l.trim())).toEqual([...EXPECTED_TAB_LABELS]);

    // The tabs wrap onto a second line instead of running off the end, so
    // the strip's scroll region never has anything to scroll.
    const { scrollWidth, clientWidth } = await strip.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth, `tab strip scrollWidth ${scrollWidth}px exceeds clientWidth ${clientWidth}px — the tabs should wrap, not scroll`).toBeLessThanOrEqual(clientWidth);
    await assertNoPagePan(page);
  });

  test("each trigger's label text node occupies exactly one line box, and no trigger's content is clipped inside its own box", async ({ page }) => {
    await page.goto(eventUrl(STRUCTURAL_EVENT_KEY, "insights"), { waitUntil: "networkidle" });
    const strip = page.locator(TAB_STRIP);
    await strip.waitFor({ state: "visible", timeout: 15_000 });

    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      const label = (await tab.innerText()).trim();

      // A direct-text-node Range's getClientRects() returns ONE rect per
      // visual line — exactly two rects is the direct signature of a label
      // that wrapped onto a second line, the defect this row names.
      const lineBoxCount = await tab.evaluate((el) => {
        const textNode = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0);
        if (!textNode) throw new Error(`tab "${el.textContent}" has no direct text node to measure`);
        const range = document.createRange();
        range.selectNodeContents(textNode);
        return range.getClientRects().length;
      });
      expect(lineBoxCount, `tab "${label}" label wrapped onto ${lineBoxCount} line boxes`).toBe(1);

      const { scrollWidth, clientWidth } = await tab.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(scrollWidth, `tab "${label}" content scrollWidth ${scrollWidth}px exceeds its own trigger's clientWidth ${clientWidth}px — the label is clipped`).toBeLessThanOrEqual(clientWidth + 2);
    }
  });

  test("without any scrolling, the Simulation trigger is reachable — its bounding box sits entirely inside the viewport, with non-empty text", async ({ page }) => {
    await page.goto(eventUrl(STRUCTURAL_EVENT_KEY, "insights"), { waitUntil: "networkidle" });
    const strip = page.locator(TAB_STRIP);
    await strip.waitFor({ state: "visible", timeout: 15_000 });

    const simulationTrigger = page.getByRole("tab", { name: "Simulation", exact: true });
    await expect(simulationTrigger, "the Simulation trigger must exist in the strip").toBeAttached();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size");
    const triggerBox = await simulationTrigger.boundingBox();
    if (triggerBox === null) throw new Error("Simulation trigger has no bounding box");
    expect(triggerBox.x, "Simulation trigger left edge must be inside the viewport").toBeGreaterThanOrEqual(0);
    expect(triggerBox.x + triggerBox.width, "Simulation trigger right edge must be inside the viewport").toBeLessThanOrEqual(viewport.width + 1);
    expect((await simulationTrigger.innerText()).trim().length).toBeGreaterThan(0);
  });
});
