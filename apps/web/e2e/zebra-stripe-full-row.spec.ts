/**
 * 07-UAT.md G-9: on the event page's Quals and Elims tabs, `.match-row-tint`
 * (`theme.css`) is `background-color: var(--color-bg-page)`. Its own comment
 * assumed the UNTINTED row was always rendered inside an `.event-card`,
 * which paints `--color-bg-surface` — so the untinted row could stay
 * `background: transparent` and quietly borrow that colour, leaving the
 * tint's own `--color-bg-page` as the only one that visibly "popped."
 *
 * That assumption holds on the team page (`EventSection.tsx` wraps
 * `MatchTable` in an `.event-card`), but `EventMatchTable` (shared by Quals
 * and Elims) renders with NO card ancestor at all. There the untinted row
 * fell through to the PAGE's own background — which happens to be the exact
 * colour the tint paints — so every tinted row rendered invisible. The only
 * thing that still visibly alternated was the sticky first `<td>`, which
 * carries its own opaque background for an unrelated reason (staying
 * readable over horizontally-scrolling content), so a real user saw one
 * darker square per alternate row and no full-width stripe.
 *
 * The fix (this task) paints BOTH states explicitly (`.match-row-untinted`
 * from `--color-bg-surface`, `.match-row-tint` from `--color-bg-page`) so
 * the stripe is self-contained and correct regardless of what ancestor sits
 * behind the table — same two tokens as before (D-06: no third shade
 * invented), just no longer left to inherit one of them from a `transparent`
 * background.
 *
 * This file checks FULL-ROW alternation — every one of the first four cells
 * in a body row, not just the first (sticky) cell — because checking only
 * the sticky cell is exactly what hid this bug: the sticky cell alone
 * alternates correctly in both the broken and fixed versions (it always
 * carries its own opaque background), so an assertion scoped to it alone
 * would never have caught the other five-sixths of the row rendering
 * invisible.
 *
 * PROVEN RED against the currently-deployed origin pre-fix (see this task's
 * commit/SUMMARY for the captured failure output): on both Quals and Elims,
 * cells 1-3 (every cell after the sticky Match column) measured an IDENTICAL
 * effective background across adjacent rows, while the team page (which
 * already renders correctly via its `.event-card` ancestor) passed the same
 * assertion unmodified — reproducing the diagnosed defect exactly. Awaiting
 * deploy for GREEN confirmation on Quals/Elims; the team page assertion is a
 * regression guard, not new coverage.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";

/** 2024's widest component season — same event key `event-scroll-regions.spec.ts`/`touch-action-vertical-scroll.spec.ts` already use for Quals/Elims coverage. */
const EVENT_KEY = "2024new";

/** Same team/season the diagnosis in 07-UAT.md's own live measurement used. */
const TEAM_URL = "/team/118?year=2024&algorithm=vpr";

/** First four `<td>`s of a match row: the sticky Match column, the plot, Confidence and Pred. Score — enough to prove the stripe runs the FULL row width, not just the sticky cell. */
const CELL_SAMPLE_COUNT = 4;

interface TableTarget {
  name: string;
  url: string;
  /** Ancestor scope to search for match rows inside (keeps this file from accidentally picking up a same-page unrelated table). */
  regionTestId: string;
}

const TARGETS: TableTarget[] = [
  { name: "Quals", url: `/event/${EVENT_KEY}?tab=quals&algorithm=vpr`, regionTestId: "quals-table-scroll" },
  { name: "Elims", url: `/event/${EVENT_KEY}?tab=elims&algorithm=vpr`, regionTestId: "elims-table-scroll" },
];

/**
 * Reads the EFFECTIVE background colour of an element — walking up from the
 * element itself through its ancestors (stopping at, and including,
 * `<html>`) and returning the first computed `background-color` that is not
 * fully transparent. This mirrors exactly how the defect was diagnosed live
 * (07-UAT.md G-9's own measurement table): a `<td>` with no background of
 * its own reports `rgba(0, 0, 0, 0)` from `getComputedStyle` directly, which
 * says nothing about what a viewer actually SEES painted behind it.
 */
async function effectiveBackgroundColor(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    let node: Element | null = el;
    while (node !== null) {
      const bg = getComputedStyle(node).backgroundColor;
      const isTransparent = bg === "rgba(0, 0, 0, 0)" || bg === "transparent";
      if (!isTransparent) return bg;
      node = node.parentElement;
    }
    return "rgba(0, 0, 0, 0)";
  });
}

async function firstBodyRows(page: Page, regionTestId: string, count: number): Promise<Locator[]> {
  const region = page.getByTestId(regionTestId);
  const rows = region.locator('[data-testid^="match-row-"]');
  await rows.first().waitFor({ state: "visible", timeout: 15_000 });
  const total = await rows.count();
  expect(total, `${regionTestId}: expected at least ${count} match rows to assert full-row alternation across`).toBeGreaterThanOrEqual(count);
  return Array.from({ length: count }, (_, i) => rows.nth(i));
}

/**
 * The core proof: for `count` consecutive body rows, sample the effective
 * background of the first `CELL_SAMPLE_COUNT` cells in each row and assert
 * every adjacent pair of rows differs on EVERY sampled cell — not merely
 * "some cell differs," which a sticky-cell-only stripe would already
 * satisfy.
 */
async function assertFullRowAlternation(rows: Locator[]): Promise<void> {
  const rowColors: string[][] = [];
  for (const row of rows) {
    const cells = row.locator("td");
    const cellCount = Math.min(CELL_SAMPLE_COUNT, await cells.count());
    const colors: string[] = [];
    for (let i = 0; i < cellCount; i++) {
      colors.push(await effectiveBackgroundColor(cells.nth(i)));
    }
    rowColors.push(colors);
  }

  for (let r = 1; r < rowColors.length; r++) {
    const prev = rowColors[r - 1]!;
    const curr = rowColors[r]!;
    for (let c = 0; c < curr.length; c++) {
      expect(
        curr[c],
        `row ${r} cell ${c}: effective background "${curr[c]}" is IDENTICAL to the previous row's cell ${c} ("${prev[c]}") — full rows: ${JSON.stringify(
          rowColors,
        )}. A stripe that only alternates on the sticky first cell (index 0) while every other cell stays the same colour is exactly the diagnosed G-9 defect: the untinted row inherits its background from an ancestor, and on this table there is no .event-card ancestor to inherit a distinct colour from.`,
      ).not.toBe(prev[c]);
    }
  }
}

for (const target of TARGETS) {
  test(`G-9 — ${target.name}: full-row zebra alternation across the first ${CELL_SAMPLE_COUNT} cells, not just the sticky column`, async ({ page }) => {
    await page.goto(target.url, { waitUntil: "networkidle" });
    const rows = await firstBodyRows(page, target.regionTestId, 3);
    await assertFullRowAlternation(rows);
  });
}

test("G-9 — team page: full-row zebra alternation unregressed (already correct via .event-card ancestor)", async ({ page }) => {
  await page.goto(TEAM_URL, { waitUntil: "networkidle" });
  const rows = page.locator('[data-testid^="match-row-"]');
  await rows.first().waitFor({ state: "visible", timeout: 15_000 });
  const total = await rows.count();
  expect(total, "team page: expected at least 3 match rows to assert full-row alternation across").toBeGreaterThanOrEqual(3);
  await assertFullRowAlternation([rows.nth(0), rows.nth(1), rows.nth(2)]);
});

/**
 * The sticky first cell's own colour must always match its row's own
 * stripe — a fix that painted the non-sticky cells correctly but left the
 * sticky cell on its own independent `bg-[var(--color-bg-surface)]` literal
 * (rather than the SAME `match-row-tint`/`match-row-untinted` class the row
 * itself carries) would reproduce the "one odd square" look in the opposite
 * direction the moment the two happened to diverge.
 */
for (const target of TARGETS) {
  test(`G-9 — ${target.name}: the sticky first cell's background matches its own row's stripe state`, async ({ page }) => {
    await page.goto(target.url, { waitUntil: "networkidle" });
    const rows = await firstBodyRows(page, target.regionTestId, 2);
    for (const row of rows) {
      const rowBg = await effectiveBackgroundColor(row);
      const stickyCell = row.locator("td").first();
      const stickyBg = await effectiveBackgroundColor(stickyCell);
      expect(stickyBg, `${target.name}: sticky cell background ("${stickyBg}") does not match its own row's effective background ("${rowBg}")`).toBe(rowBg);
    }
  });
}
