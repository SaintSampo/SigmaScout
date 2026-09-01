/**
 * 07-20-PLAN.md Task 1 — the sibling-scroll-region evidence at phone width,
 * for ledger rows 1, 2, 3, 5 and 7 (UI-SPEC's E2/E3/E4/E5/E6 `overflow`
 * rows). Proves, against the widest real data that exists in five seasons
 * of corpus data, that the tab strip's own scroll region, each tab's own
 * table scroll region, and the page's vertical scroll are three SIBLING
 * regions — never nested, never trapping one another — under a real CDP
 * touch drag at 390px (and, for the shared structural cases, at 360px too).
 *
 * Runs against the DEPLOYED origin (`playwright.config.ts`'s `baseURL`):
 * `https://data.sigmascout.org`'s R2 CORS policy (Phase 5 D-18) does not
 * allow-list `localhost`/`*.pages.dev`, so there is nothing to scroll
 * without the real, deployed artifact.
 *
 * THE BOUNDARY THIS SPEC DOES NOT CROSS: every drag here is dispatched via
 * `e2e/support/touchDrag.ts`'s CDP `Input.dispatchTouchEvent` helper — a
 * synthesized gesture in a desktop Chromium engine wearing a phone viewport,
 * not iOS Safari's arbitration of a directional `touch-action: pan-x` inside
 * a different-axis outer scroller (06-RESEARCH.md Pitfall 6). This spec is
 * necessary evidence and is not proof of real-hardware touch behavior — see
 * `07-20-SUMMARY.md` for the still-outstanding real-device human check.
 *
 * The ancestor walk (`assertNoIntermediateScroller`) closes a gap
 * `.contains()` alone cannot: two regions can mutually fail `.contains()`
 * while still having a THIRD scroller sandwiched between them. Walking every
 * ancestor from a candidate scroll element up to (never including)
 * `document.body` and asserting none has a computed `overflow-x`/`overflow-y`
 * of `auto`/`scroll` rules that third case out — the exact shape
 * 07-RESEARCH.md's Open Question 5 resolved against.
 */
import { test, expect } from "@playwright/test";
import { touchDrag } from "./support/touchDrag.js";
import { assertNoIntermediateScroller, assertNoPagePan, assertOverflows, visibleMidpoint } from "./support/scrollRegions.js";
import { runSimulation, selectStartMatch, SIMULATION_TEST_IDS } from "./support/simulation.js";

const TAB_STRIP = '[data-testid="event-tab-strip-scroll"]';

/** The primary multi-tab structural target (`measured_ground_truth`): 2024 is the widest component season, so this one event exercises all five tabs' structural sibling/no-trap invariants at once. `2024new` also carries pmfs on all 125 of its qm rows (confirmed live, 08-15-PLAN.md Task 2), so it doubles as the sixth (`simulation`) tab's own structural fixture — one event exercising all six tabs' invariants at once, exactly as it already did for the first five. */
const STRUCTURAL_EVENT_KEY = "2024new";

const TAB_SCROLL_TESTID: Record<string, string> = {
  insights: "insights-table-scroll",
  breakdown: "breakdown-table-scroll",
  quals: "quals-table-scroll",
  alliances: "alliances-table-scroll",
  elims: "elims-table-scroll",
  // 08-15-PLAN.md Task 2, PD-02: the Simulation tab's scroll region does not
  // exist until a run completes — `RankDistributionTable.tsx`'s own
  // scroll-region testid, the same one `simulation-tab.spec.ts`'s S3 evidence
  // asserts against.
  simulation: SIMULATION_TEST_IDS.rankTableScroll,
};

// PD-02, 08-15-PLAN.md Task 2: `simulation` joins as the sixth element,
// behind a real run (see the shared `beforeEach` below) rather than a
// parallel, weaker structural block of its own — the tab's scroll region
// does not exist until a run completes, which is exactly why 08-09
// deliberately left this file untouched and routed the work here.
const TABS = ["insights", "breakdown", "quals", "alliances", "elims", "simulation"] as const;

function eventUrl(eventKey: string, tab: string): string {
  return `/event/${eventKey}?algorithm=vpr&tab=${tab}`;
}

// `assertNoIntermediateScroller`, `assertOverflows`, `assertNoPagePan` and
// `visibleMidpoint` moved verbatim to `./support/scrollRegions.js`
// (08-15-PLAN.md Task 1, PD-03) — the Compare page and the Simulation tab
// need the identical definitions, and a second hand-maintained copy of a
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
    { eventKey: "2025flta", label: "07-12's own routed merge-at-width target (63 played + 21 upcoming)", rowCount: 84 },
  ] as const;

  for (const { eventKey, label, rowCount } of CASES) {
    test(`${eventKey} (${label}): ${rowCount} rows, pinned Match column holds, axis tick stays legible after a full-width drag`, async ({ page }, testInfo) => {
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
      console.log(`[07-20] quals density screenshot: ${shot}`);

      const pinnedHeader = region.getByRole("columnheader", { name: "Match", exact: true });
      const unpinnedHeader = region.getByRole("columnheader", { name: "Actual", exact: true });
      const pinnedBefore = await pinnedHeader.boundingBox();
      const unpinnedBefore = await unpinnedHeader.boundingBox();
      if (pinnedBefore === null || unpinnedBefore === null) throw new Error("header cell missing a bounding box");

      const { box, midY } = await visibleMidpoint(page, region);
      await touchDrag(page, { x: box.x + box.width - 20, y: midY }, { x: box.x + 20, y: midY });

      const pinnedAfter = await pinnedHeader.boundingBox();
      const unpinnedAfter = await unpinnedHeader.boundingBox();
      if (pinnedAfter === null || unpinnedAfter === null) throw new Error("header cell missing a bounding box after the drag");
      expect(pinnedAfter.x).toBeCloseTo(pinnedBefore.x, 0);
      expect(unpinnedAfter.x).not.toBeCloseTo(unpinnedBefore.x, 0);

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
    console.log(`[07-20] elims density screenshot: ${shot}`);

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
      // 08-15-PLAN.md Task 2, PD-02: every other tab's scroll region exists
      // the moment its panel mounts, so waiting on the shared testid below is
      // enough. `simulation` is the one exception — its rank-table scroll
      // region does not exist until a run completes (08-09 deliberately
      // built the branch this produces and routed the real run here) — so
      // this beforeEach drives a REAL run for `simulation` only, through the
      // same Task 1 driver `simulation-tab.spec.ts` uses, before waiting on
      // the shared testid.
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

    test("a horizontal drag inside the tab strip advances only the strip, leaving the table region at rest", async ({ page }) => {
      const strip = page.locator(TAB_STRIP);
      await assertOverflows(strip);
      const region = page.locator(`[data-testid="${TAB_SCROLL_TESTID[tab]}"]`);

      const stripBefore = await strip.evaluate((el) => el.scrollLeft);
      const regionBefore = await region.evaluate((el) => el.scrollLeft);

      const box = await strip.boundingBox();
      if (box === null) throw new Error("tab strip has no bounding box");
      await touchDrag(page, { x: box.x + box.width - 20, y: box.y + box.height / 2 }, { x: box.x + 20, y: box.y + box.height / 2 });

      const stripAfter = await strip.evaluate((el) => el.scrollLeft);
      const regionAfter = await region.evaluate((el) => el.scrollLeft);
      expect(stripAfter).toBeGreaterThan(stripBefore);
      expect(regionAfter).toBe(regionBefore);
    });

    // The bounded 8-row Alliances table may not fill the 844px phone
    // viewport at all, so a vertical drag over it would prove nothing about
    // page-scroll-versus-table-scroll arbitration (07-20-PLAN.md's own
    // stated reason) — this case runs on the four roster/match tabs only.
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
    test(`${eventKey}: exactly ${rowCount} rows, two pinned identity columns hold position after a full-width drag (nickname unpinned below 768px, 07-UAT.md G-2)`, async ({ page }) => {
      await page.goto(eventUrl(eventKey, "insights"), { waitUntil: "networkidle" });
      const region = page.locator('[data-testid="insights-table-scroll"]');
      await region.waitFor({ state: "visible", timeout: 15_000 });

      const rows = page.getByTestId("insights-row");
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBe(rowCount);

      await assertOverflows(region);

      // 07-UAT.md G-2: at this spec's phone-width projects (390px/360px,
      // both below MOBILE_BREAKPOINT_PX=768), nickname is DELIBERATELY no
      // longer pinned — see `teams-table/columns.tsx`'s `MOBILE_PINNED_COLUMN_IDS`.
      // Only rank+teamNumber stay pinned; nickname now behaves like any
      // other unpinned column (it must MOVE with the drag, not hold).
      const pinnedIds = ["rank", "teamNumber"] as const;
      const pinnedHeaders = pinnedIds.map((id) => page.getByTestId(`insights-header-${id}`));
      const nicknameHeader = page.getByTestId("insights-header-nickname");
      const unpinnedHeader = page.getByTestId("insights-header-record");

      expect(await nicknameHeader.getAttribute("data-pinned")).toBe("false");

      const pinnedBefore = await Promise.all(pinnedHeaders.map((h) => h.boundingBox()));
      const nicknameBefore = await nicknameHeader.boundingBox();
      const unpinnedBefore = await unpinnedHeader.boundingBox();
      if (pinnedBefore.some((b) => b === null) || nicknameBefore === null || unpinnedBefore === null) throw new Error("header cell missing a bounding box");

      const { box, midY } = await visibleMidpoint(page, region);
      await touchDrag(page, { x: box.x + box.width - 20, y: midY }, { x: box.x + 20, y: midY });

      const pinnedAfter = await Promise.all(pinnedHeaders.map((h) => h.boundingBox()));
      const nicknameAfter = await nicknameHeader.boundingBox();
      const unpinnedAfter = await unpinnedHeader.boundingBox();
      if (pinnedAfter.some((b) => b === null) || nicknameAfter === null || unpinnedAfter === null) throw new Error("header cell missing a bounding box after the drag");

      pinnedAfter.forEach((after, index) => {
        expect(after!.x).toBeCloseTo(pinnedBefore[index]!.x, 0);
      });
      // Nickname now scrolls with the data, exactly like any other unpinned column.
      expect(nicknameAfter.x).not.toBeCloseTo(nicknameBefore.x, 0);
      expect(unpinnedAfter.x).not.toBeCloseTo(unpinnedBefore.x, 0);
    });
  }
});

// ---------------------------------------------------------------------------
// E4 — Breakdown, the widest column set that exists anywhere in the app
// (2024: 13 components + Total = 14 metric columns behind 2 pinned = 16)
// ---------------------------------------------------------------------------

test.describe("E4 — Breakdown tab at the app's widest column set", () => {
  test("2024new: exactly 16 header columns, one pinned header holds position and stays opaque after a full-width drag (nickname unpinned below 768px, 07-UAT.md G-2)", async ({ page }) => {
    await page.goto(eventUrl("2024new", "breakdown"), { waitUntil: "networkidle" });
    const region = page.locator('[data-testid="breakdown-table-scroll"]');
    await region.waitFor({ state: "visible", timeout: 15_000 });

    const headerCells = region.locator("thead th");
    expect(await headerCells.count()).toBe(16);

    await assertOverflows(region);

    // 07-UAT.md G-2: below MOBILE_BREAKPOINT_PX (this spec's phone-width
    // projects), only teamNumber stays pinned — see
    // `BreakdownTab.tsx`'s `BREAKDOWN_MOBILE_PINNED_COLUMN_IDS`. Nickname is
    // no longer pinned and must move with the drag like any other column.
    const pinnedHeader = page.getByTestId("breakdown-header-teamNumber");
    const nicknameHeader = page.getByTestId("breakdown-header-nickname");
    const unpinnedHeader = page.getByTestId("breakdown-header-total");

    expect(await nicknameHeader.getAttribute("data-pinned")).toBe("false");

    const pinnedBefore = await pinnedHeader.boundingBox();
    const nicknameBefore = await nicknameHeader.boundingBox();
    const unpinnedBefore = await unpinnedHeader.boundingBox();
    if (pinnedBefore === null || nicknameBefore === null || unpinnedBefore === null) throw new Error("header cell missing a bounding box");

    const { box, midY } = await visibleMidpoint(page, region);
    await touchDrag(page, { x: box.x + box.width - 20, y: midY }, { x: box.x + 20, y: midY });

    const pinnedAfter = await pinnedHeader.boundingBox();
    const nicknameAfter = await nicknameHeader.boundingBox();
    const unpinnedAfter = await unpinnedHeader.boundingBox();
    if (pinnedAfter === null || nicknameAfter === null || unpinnedAfter === null) throw new Error("header cell missing a bounding box after the drag");

    expect(pinnedAfter.x).toBeCloseTo(pinnedBefore.x, 0);
    expect(nicknameAfter.x).not.toBeCloseTo(nicknameBefore.x, 0);
    expect(unpinnedAfter.x).not.toBeCloseTo(unpinnedBefore.x, 0);

    // A see-through pinned column is how a wide table fails at phone width
    // without failing any scroll assertion — the same opacity assertion
    // `touch-scroll.spec.ts` makes for the Teams table.
    const pinnedCell = page.getByTestId("breakdown-cell-teamNumber").first();
    const background = await pinnedCell.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).not.toBe("transparent");
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
  });
});

// ---------------------------------------------------------------------------
// E2 — the tab strip itself: SIX short labels (08-15-PLAN.md Task 2, S0),
// horizontally scrollable. Grown from five to six because six triggers is
// now the shipped truth (08-09) — the one expectation this plan strengthens
// rather than relaxes, per this plan's own third prohibition.
// ---------------------------------------------------------------------------

const EXPECTED_TAB_LABELS = ["Insights", "Breakdown", "Quals", "Alliances", "Elims", "Simulation"] as const;

test.describe("E2 — the tab strip: 6 tabs, scrollable at phone width", () => {
  test(`${STRUCTURAL_EVENT_KEY}: exactly 6 role="tab" elements in the declared order, and the strip overflows at 390px`, async ({ page }) => {
    await page.goto(eventUrl(STRUCTURAL_EVENT_KEY, "insights"), { waitUntil: "networkidle" });
    const strip = page.locator(TAB_STRIP);
    await strip.waitFor({ state: "visible", timeout: 15_000 });

    const tabs = page.getByRole("tab");
    expect(await tabs.count()).toBe(6);
    const labels = await tabs.allTextContents();
    expect(labels.map((l) => l.trim())).toEqual([...EXPECTED_TAB_LABELS]);

    // The premise guard: the strip must actually overflow BEFORE any of the
    // three measurements below run against it — a strip that never overflows
    // would make every one of them vacuous.
    await assertOverflows(strip);
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

  test("after scrolling the strip fully to its right end, the Simulation trigger is reachable — its bounding box sits entirely inside the viewport, with non-empty text", async ({ page }) => {
    await page.goto(eventUrl(STRUCTURAL_EVENT_KEY, "insights"), { waitUntil: "networkidle" });
    const strip = page.locator(TAB_STRIP);
    await strip.waitFor({ state: "visible", timeout: 15_000 });
    await assertOverflows(strip);

    const simulationTrigger = page.getByRole("tab", { name: "Simulation", exact: true });
    await expect(simulationTrigger, "the Simulation trigger must exist in the strip before it can be scrolled to").toBeAttached();

    const stripBox = await strip.boundingBox();
    if (stripBox === null) throw new Error("tab strip has no bounding box");
    await touchDrag(page, { x: stripBox.x + stripBox.width - 20, y: stripBox.y + stripBox.height / 2 }, { x: stripBox.x + 20, y: stripBox.y + stripBox.height / 2 }, 20);

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport size");
    const triggerBox = await simulationTrigger.boundingBox();
    if (triggerBox === null) throw new Error("Simulation trigger has no bounding box");
    expect(triggerBox.x, "Simulation trigger left edge must be inside the viewport").toBeGreaterThanOrEqual(0);
    expect(triggerBox.x + triggerBox.width, "Simulation trigger right edge must be inside the viewport").toBeLessThanOrEqual(viewport.width + 1);
    expect((await simulationTrigger.innerText()).trim().length).toBeGreaterThan(0);
  });
});
