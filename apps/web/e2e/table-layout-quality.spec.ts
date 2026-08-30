/**
 * 07-UAT.md G-3: 07-20's 122 e2e assertions all test scroll ARBITRATION
 * ("only the table moved", "the strip did not shift") and never LAYOUT
 * QUALITY — a table with wrong column widths, visible sticky gaps and no
 * data reachable on screen passed every one of them, which is why a human
 * found G-1/G-2 on a real phone and CI did not.
 *
 * This file adds the three assertion classes G-3 calls for, over the three
 * tables G-1/G-2 fixed (Insights, Breakdown, TeamsTable):
 *
 *  1. Declared-vs-actual column width: for every SIZED column, the
 *     rendered width equals the declared `size` (within a 1px subpixel
 *     rounding tolerance). This is exactly the class of bug `table-layout:
 *     auto` produced (a column's actual width silently diverging from its
 *     declared `size`) and is the thing `table-layout: fixed` (G-1)
 *     guarantees.
 *  2. Sticky offset correctness: each pinned column's right edge meets the
 *     next pinned column's left edge with a 0px gap (within the same
 *     tolerance) — the literal "page-coloured stripe between pinned
 *     headers" G-1 found. A column whose actual width diverges from
 *     declared desyncs this even when every column's own individual width
 *     assertion (#1) looks fine in isolation, because TanStack's sticky
 *     `left` offsets are derived from DECLARED sizes, not actual ones.
 *  3. Pinned width as a fraction of the viewport, bounded at phone width:
 *     a future change that re-pins nickname (or widens the identity
 *     columns back toward their pre-G-2 sizes) would reproduce G-2's core
 *     complaint — no room for a single metric column — without failing
 *     assertions #1/#2 at all, since #1/#2 only check that DECLARED and
 *     ACTUAL agree, never that the declared total itself is reasonable.
 *     Bounded at 50% of the viewport: G-2's fixed 2-column pinned block
 *     measures ~33% of 390px (128/390) with real margin under this line,
 *     while the pre-fix 3-column block measured 97% (380/390) — a bound at
 *     the midpoint cleanly separates "some room left for data" from "the
 *     whole screen is identity columns," independent of any single pixel
 *     constant either side might later drift toward.
 *
 * Runs on `phone-390`/`pixel-10` only (both at 390px UI-SPEC's own named
 * width, matching this repo's existing narrow-viewport convention rather
 * than a new one) — this is a narrow-viewport defect class, not one this
 * file needs to also re-prove at desktop width.
 *
 * PROVEN TO BITE (07-UAT.md's own requirement): run locally against
 * `scripts/fixture-server.mjs` + a local dev server pinned at the
 * pre-G-1/G-2 commit, all three assertion classes failed RED — see this
 * task's commit message / SUMMARY for the captured failure output. Restored
 * to the post-fix commit, all three pass GREEN. `data.sigmascout.org`'s R2
 * CORS policy excludes `localhost`, so that RED/GREEN proof could not be run
 * through this exact file against the deployed origin locally; it is
 * committed here to run for real against the deployed origin once deployed
 * (this repo's own established e2e convention — see `playwright.config.ts`'s
 * header comment).
 */
import { test, expect, type Locator, type Page } from "@playwright/test";

/** 1px: real-world subpixel rounding tolerance for width/position comparisons — tight enough that a real desync (measured 11-56px pre-fix) cannot pass by accident, loose enough that browser subpixel rounding never produces a false failure. */
const SUBPIXEL_TOLERANCE_PX = 1;

/** G-3's bound (see file header for the derivation): a pinned block may never consume more than half of a phone viewport. */
const MAX_PINNED_FRACTION_OF_VIEWPORT = 0.5;

interface ColumnSpec {
  id: string;
  /** `true` for a column expected to be pinned at THIS viewport (390px is below MOBILE_BREAKPOINT_PX for every table G-1/G-2 touched). */
  pinned: boolean;
}

interface TableSpec {
  name: string;
  url: string;
  regionTestId: string;
  headerPrefix: string;
  cellPrefix: string;
  rowTestId: string;
  /** Declared-size columns to check, header-row order — must include every pinned column, in pinned order, first. */
  columns: ColumnSpec[];
}

const TABLES: TableSpec[] = [
  {
    name: "Insights (2023cur, widest real roster)",
    url: "/event/2023cur?tab=insights&algorithm=vpr",
    regionTestId: "insights-table-scroll",
    headerPrefix: "insights-header",
    cellPrefix: "insights-cell",
    rowTestId: "insights-row",
    columns: [
      { id: "rank", pinned: true },
      { id: "teamNumber", pinned: true },
      { id: "nickname", pinned: false },
      { id: "record", pinned: false },
    ],
  },
  {
    name: "Breakdown (2024new, widest column set)",
    url: "/event/2024new?tab=breakdown&algorithm=vpr",
    regionTestId: "breakdown-table-scroll",
    headerPrefix: "breakdown-header",
    cellPrefix: "breakdown-cell",
    rowTestId: "breakdown-row",
    columns: [
      { id: "teamNumber", pinned: true },
      { id: "nickname", pinned: false },
    ],
  },
  {
    name: "TeamsTable (2024 season)",
    url: "/teams?year=2024&algorithm=vpr&sort=total&sortDir=desc",
    regionTestId: "teams-table-scroll",
    headerPrefix: "teams-header",
    cellPrefix: "teams-cell",
    rowTestId: "teams-row",
    columns: [
      { id: "rank", pinned: true },
      { id: "teamNumber", pinned: true },
      { id: "nickname", pinned: false },
    ],
  },
];

/** Reads a `<th>`/`<td>`'s DECLARED pixel width straight from its own inline `style.width` — the exact value `header.getSize()`/`cell.column.getSize()` wrote, never a CSS cascade guess. */
async function declaredWidthPx(locator: Locator): Promise<number> {
  const raw = await locator.evaluate((el) => (el as HTMLElement).style.width);
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) throw new Error(`element has no numeric inline style.width (got "${raw}") — is this a sized column?`);
  return parsed;
}

async function gotoTable(page: Page, spec: TableSpec): Promise<void> {
  await page.goto(spec.url, { waitUntil: "networkidle" });
  await page.locator(`[data-testid="${spec.regionTestId}"]`).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId(spec.rowTestId).first().waitFor({ state: "visible", timeout: 15_000 });
}

for (const spec of TABLES) {
  test.describe(`G-3 layout quality — ${spec.name}`, () => {
    test("declared vs actual: every sized column's rendered width equals its declared size", async ({ page }) => {
      await gotoTable(page, spec);

      for (const column of spec.columns) {
        const header = page.getByTestId(`${spec.headerPrefix}-${column.id}`);
        const declared = await declaredWidthPx(header);
        const box = await header.boundingBox();
        if (box === null) throw new Error(`${column.id} header has no bounding box`);
        expect(
          Math.abs(box.width - declared),
          `${spec.name} column "${column.id}": declared ${declared}px, actual ${box.width}px — table-layout:auto (or an anonymous per-row table under a virtualizer) is letting content override the declared size`,
        ).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX);
      }
    });

    test("sticky offset correctness: each pinned column's right edge meets the next pinned column's left edge with a 0px gap", async ({ page }) => {
      await gotoTable(page, spec);

      const pinnedIds = spec.columns.filter((c) => c.pinned).map((c) => c.id);
      expect(pinnedIds.length, `${spec.name} declares no pinned columns for this test to check`).toBeGreaterThan(0);

      // Check both the header row (always in normal table flow) and the
      // FIRST body row (TeamsTable's own virtualizer absolutely-positions
      // rows, which is exactly the case that partially masked this defect
      // in the header alone — 07-UAT.md G-1's own finding).
      for (const rowKind of ["header", "body"] as const) {
        const boxes: { id: string; box: { x: number; width: number } }[] = [];
        for (const id of pinnedIds) {
          const locator = rowKind === "header" ? page.getByTestId(`${spec.headerPrefix}-${id}`) : page.getByTestId(`${spec.cellPrefix}-${id}`).first();
          const box = await locator.boundingBox();
          if (box === null) throw new Error(`${spec.name} ${rowKind} cell "${id}" has no bounding box`);
          boxes.push({ id, box });
        }

        for (let i = 0; i < boxes.length - 1; i++) {
          const current = boxes[i]!;
          const next = boxes[i + 1]!;
          const gap = next.box.x - (current.box.x + current.box.width);
          expect(
            Math.abs(gap),
            `${spec.name} ${rowKind} row: gap of ${gap}px between pinned "${current.id}" and pinned "${next.id}" — a non-zero gap here is the exact "page-coloured stripe between pinned headers" 07-UAT.md G-1 found on a real phone`,
          ).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE_PX);
        }
      }
    });
  });
}

test.describe("G-3 layout quality — pinned width bound (all three tables)", () => {
  for (const spec of TABLES) {
    test(`${spec.name}: pinned columns never consume more than ${MAX_PINNED_FRACTION_OF_VIEWPORT * 100}% of the viewport`, async ({ page }) => {
      await gotoTable(page, spec);
      const viewport = page.viewportSize();
      if (viewport === null) throw new Error("no viewport size");

      // Reads `data-pinned="true"` DIRECTLY off the DOM rather than from
      // this file's own `spec.columns` list — a future regression that
      // re-pins a column this file does not currently expect (e.g.
      // nickname) must still be caught here. Hardcoding the pinned id list
      // would make this bound blind to exactly the "re-pin everything"
      // regression it exists to catch.
      const pinnedHeaders = page.locator(`[data-testid^="${spec.headerPrefix}-"][data-pinned="true"]`);
      const pinnedCount = await pinnedHeaders.count();
      expect(pinnedCount, `${spec.name}: no pinned header cells found via data-pinned="true" — is the testid prefix right?`).toBeGreaterThan(0);

      let pinnedTotal = 0;
      for (let i = 0; i < pinnedCount; i++) {
        const box = await pinnedHeaders.nth(i).boundingBox();
        if (box === null) throw new Error(`${spec.name} pinned header #${i} has no bounding box`);
        pinnedTotal += box.width;
      }

      const fraction = pinnedTotal / viewport.width;
      expect(
        fraction,
        `${spec.name}: pinned columns total ${pinnedTotal}px of a ${viewport.width}px viewport (${(fraction * 100).toFixed(1)}%) — this reproduces G-2's "no room for a single metric column" complaint regardless of which exact columns are pinned`,
      ).toBeLessThanOrEqual(MAX_PINNED_FRACTION_OF_VIEWPORT);
    });
  }
});

/**
 * 07-UAT.md G-2 part 2 (the "first-paint half"): G-2 part 1 unpinned
 * nickname and tightened rank/teamNumber, which fixed the SCROLLED state
 * (panning right now reaches real data), but left nickname's own `size: 220`
 * unchanged — on a real 390px phone `rank(56) + teamNumber(72) +
 * nickname(220) = 348px` still exceeded the 342px scroller before ANY data
 * column began, measured live at exactly 0 data pixels visible at scroll 0.
 * This is a DIFFERENT assertion from the pinned-width bound above: that test
 * bounds the PINNED block alone and would pass even with nickname at 220,
 * since nickname is no longer pinned — this test is the one that actually
 * bites on "the first thing a user sees contains no data," matching the
 * class of bug G-3's own header comment describes 122 prior e2e assertions
 * not catching.
 */
/**
 * Post-G-2 follow-up: G-2 part 2's `NICKNAME_COLUMN_WIDTH_NARROW_PX = 90`
 * narrowing exposed a PRE-EXISTING truncation defect (latent at the old
 * 220px width, where most nicknames fit) — nickname cells hard-clip
 * mid-character instead of showing an ellipsis. Diagnosed live at 390px on
 * the deployed site: `"The Bucks' Wrath"` rendered as `"The Bucks' \""`,
 * `"Robowranglers"` as `"Robowrangle"`, `"Steel Falcons"` as `"Steel
 * Falcon"` — no `…` in any of them.
 *
 * Root cause, measured in the browser: the CELL (`<td>`) carries
 * `overflow:hidden`/`text-overflow:ellipsis`, but the element that actually
 * overflows is the INNER anchor (`display:block`, `white-space:nowrap` via
 * inheritance, `overflow:visible`, `text-overflow:clip`). `text-overflow:
 * ellipsis` only ever applies to the element that is itself clipping its
 * own overflowing content — the cell's declaration has nothing to attach to
 * because the anchor's own box already fills the cell's content width
 * exactly (no box-level overflow the cell can see), so the cell hard-clips
 * the anchor's overflowing PAINTED text at the pixel level with no ellipsis
 * glyph. The fix moves `truncate` (Tailwind's `overflow:hidden;
 * text-overflow:ellipsis; white-space:nowrap`) onto the anchor itself.
 *
 * This can't be asserted by reading the anchor's `textContent`/`innerText`:
 * `text-overflow: ellipsis` is a paint-time effect that never mutates the
 * DOM text, so both the pre-fix hard-clip and the post-fix ellipsis report
 * the identical full string via `innerText`. The only way to distinguish
 * "this box truncates its own overflow with an ellipsis" from "this box
 * paints past its own edges and relies on an ancestor to hard-clip it" is
 * to read the actually-overflowing element's OWN computed `overflow-x`/
 * `text-overflow` — which is exactly the root-cause mechanism above, read
 * live from the rendered page rather than assumed from source.
 */
test.describe("nickname ellipsis — overflowing nickname text truncates with an ellipsis, not a hard mid-character clip", () => {
  /** Real Insights (2023cur) roster rows independently confirmed (07-UAT.md's own prior Playwright snapshot) to overflow the 90px narrow nickname column and, pre-fix, exhibit the reported hard-clip defect. */
  const OVERFLOWING_NICKNAME_CASES: { teamNumber: number; nickname: string }[] = [
    { teamNumber: 6329, nickname: "The Bucks' Wrath" },
    { teamNumber: 3310, nickname: "Black Hawk Robotics" },
    { teamNumber: 148, nickname: "Robowranglers" },
  ];

  test("Insights (2023cur): the actually-overflowing element (the nickname cell's inner link) clips its OWN content with an ellipsis", async ({ page }) => {
    const spec = TABLES[0]!; // Insights
    await gotoTable(page, spec);

    for (const { teamNumber, nickname } of OVERFLOWING_NICKNAME_CASES) {
      const row = page.locator(`[data-testid="${spec.rowTestId}"][data-team-number="${teamNumber}"]`);
      const link = row.getByTestId(`${spec.cellPrefix}-nickname`).locator("a");

      const measured = await link.evaluate((el) => {
        const style = getComputedStyle(el);
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: style.overflowX, textOverflow: style.textOverflow };
      });

      expect(
        measured.scrollWidth,
        `team ${teamNumber} ("${nickname}") link scrollWidth=${measured.scrollWidth} clientWidth=${measured.clientWidth} — this nickname is expected to overflow the 90px narrow nickname column; if it now fits, this case no longer exercises the defect and should be swapped for a longer nickname`,
      ).toBeGreaterThan(measured.clientWidth);

      expect(
        measured.overflowX,
        `team ${teamNumber} ("${nickname}") link overflow-x is "${measured.overflowX}" — the element that ACTUALLY overflows (the inner <a>, not just its ancestor <td>) must itself clip its own content, or the cell's ellipsis declaration never fires. This is the exact defect diagnosed live at 390px: the <td> declares text-overflow:ellipsis but the <a> that actually overflows had overflow:visible, producing a hard mid-character clip with no "…" glyph (e.g. "The Bucks' Wrath" rendering as "The Bucks' \\"")`,
      ).not.toBe("visible");

      expect(
        measured.textOverflow,
        `team ${teamNumber} ("${nickname}") link text-overflow is "${measured.textOverflow}", not "ellipsis" — without text-overflow:ellipsis on the element that actually overflows, the browser hard-clips mid-character instead of showing "…"`,
      ).toBe("ellipsis");
    }
  });
});

test.describe("G-2 part 2 — at least one full data column visible at scroll 0 (no scrolling)", () => {
  for (const spec of TABLES) {
    test(`${spec.name}: at least one non-pinned, non-nickname column is fully visible inside the scroll region at scroll 0`, async ({ page }) => {
      await gotoTable(page, spec);
      const region = page.getByTestId(spec.regionTestId);
      const regionBox = await region.boundingBox();
      if (regionBox === null) throw new Error(`${spec.name} scroll region has no bounding box`);

      // Reads `data-pinned="false"` DIRECTLY off the DOM (same technique the
      // pinned-width-bound test above uses for `data-pinned="true"`) rather
      // than hardcoding a metric-key column id — the metric-key set is
      // season/algorithm-dependent (`metricKeysFor`). Nickname's own header
      // cell is deliberately excluded (`:not([data-testid$="-nickname"])`):
      // nickname is supplementary identity once unpinned, not the
      // prediction/competition data 07-UAT.md G-2's own acceptance wording
      // ("two real metric columns visible on first paint") is about — a fix
      // that merely left nickname itself barely fitting must not pass this.
      const dataHeaders = page.locator(`[data-testid^="${spec.headerPrefix}-"][data-pinned="false"]:not([data-testid$="-nickname"])`);
      const dataCount = await dataHeaders.count();
      expect(dataCount, `${spec.name}: no non-pinned, non-nickname header cell found — is the testid prefix right?`).toBeGreaterThan(0);

      let fullyVisibleCount = 0;
      let totalVisiblePx = 0;
      const report: string[] = [];
      for (let i = 0; i < dataCount; i++) {
        const header = dataHeaders.nth(i);
        const box = await header.boundingBox();
        if (box === null) continue;
        const testId = await header.getAttribute("data-testid");
        const start = box.x - regionBox.x;
        const visible = Math.max(0, Math.min(box.x + box.width, regionBox.x + regionBox.width) - Math.max(box.x, regionBox.x));
        totalVisiblePx += visible;
        if (visible >= box.width - SUBPIXEL_TOLERANCE_PX) fullyVisibleCount++;
        report.push(`  ${testId}: w=${box.width.toFixed(1)} start=${start.toFixed(1)} visible=${visible.toFixed(1)}`);
      }

      expect(
        fullyVisibleCount,
        `${spec.name}: 0 of ${dataCount} data columns fully visible at scroll 0 inside a ${regionBox.width.toFixed(
          1,
        )}px scroller (total ${totalVisiblePx.toFixed(
          1,
        )}px of data-column pixels visible) — this is the exact "zero data pixels visible on first paint" G-2 part 2 defect (07-UAT.md). Columns:\n${report.join("\n")}`,
      ).toBeGreaterThan(0);
    });
  }
});
