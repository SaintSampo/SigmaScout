/**
 * 07-UAT.md G-7 (original fix): on desktop, the Breakdown tab's 14 metric
 * columns (2024's widest real column set) overflowed their scroll region by
 * 836px at both 1440px and 1280px. The G-7 fix (widening the Breakdown tab's
 * own container plus wrapping/humanizing headers) cut that to 596px/756px —
 * real progress, but not zero, because it left every metric column's own
 * declared width at the pre-existing 120px.
 *
 * 07-UAT.md G-10 (this fix): the developer's own design direction —
 * "make the glyph and the spread smaller, make them grey, and make them
 * like a superscript, top aligned with the value number" — redesigned
 * `MetricValue.tsx`'s shared metric cell (`.metric-spread-superscript` in
 * `theme.css`). The VALUE stays full-size; only the ± glyph and spread
 * number shrink, grey, and rise. That directly narrows the cell's real
 * rendered content, which `BreakdownTab.tsx` now spends on two NARROWER
 * declared column widths (`BREAKDOWN_METRIC_COLUMN_WIDTH_PX` 110,
 * `BREAKDOWN_TOTAL_COLUMN_WIDTH_PX` 118 for the one column whose value can
 * run to six digits) instead of one uniform 120px:
 *
 *   - Table width: 1988px -> 1856px (13 × 110 + 1 × 118 vs. 14 × 120 for
 *     the metric columns, teamNumber/nickname unchanged at 88/220) — a real
 *     132px recovery, measured live against the deployed 2024new artifact
 *     (fixture-backed local render, matching this file's own established
 *     measurement method).
 *   - Overflow: 596px -> 464px at 1440px; 756px -> 624px at 1280px.
 *
 * This is STILL NOT ZERO, and this file says so with real numbers rather
 * than asserting a bound it knows to be false. The redesign's width saving
 * is real but bounded: 13 of the 14 columns are genuinely narrower now, but
 * the 14th (Total) keeps a wider floor because ITS value alone — not the
 * spread — can reach six digits (`"284.89"`, the real worst case measured
 * against the deployed 2026alhu artifact) at the unchanged, full-size
 * `.text-role-body`. Reaching zero at 1440px would need the 14-column total
 * at or below 1084px (1392px scroller minus the 88/220 identity columns),
 * i.e. ~77px average per metric column — below even this fix's own
 * redesigned non-Total floor (94-102px minimum real content). Eliminating
 * the remaining ~460-620px needs one of: a wider target viewport (roughly
 * 1904px, down from the pre-G-10 estimate of ~2036px), fewer default-visible
 * metric columns, or hiding/collapsing the spread entirely on this one dense
 * table — each a further product/design decision for a human, not something
 * this fix resolves unilaterally.
 */
import { test, expect, type Page } from "@playwright/test";

const EVENT_URL = "/event/2024new?tab=breakdown&algorithm=vpr";

/** 07-UAT.md G-7's own reported pre-fix number (before ANY fix), both target viewports — kept as the original historical anchor. */
const PRE_FIX_OVERFLOW_PX = 836;

/** 07-UAT.md G-7's own post-fix number (container widen + header wrap, before the G-10 metric-cell redesign) — the baseline THIS fix further reduces. */
const PRE_G10_OVERFLOW_PX: Record<number, number> = {
  1440: 596,
  1280: 756,
};

/**
 * The bound this fix (G-10) is expected to hold GREEN at, post-deploy —
 * measured locally against a fixture-backed dev server serving the real,
 * deployed 2024new artifact (464px at 1440, 624px at 1280), with a ~25px
 * buffer for cross-environment font-rendering variance. Both are
 * comfortably under `PRE_G10_OVERFLOW_PX`, which is what proves this is a
 * genuine further improvement rather than a no-op.
 */
const OVERFLOW_BOUNDS_PX: Record<number, number> = {
  1440: 490,
  1280: 650,
};

async function measureOverflow(page: Page, width: number): Promise<{ scrollerWidth: number; tableWidth: number; overflow: number }> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(EVENT_URL, { waitUntil: "networkidle" });
  const region = page.getByTestId("breakdown-table-scroll");
  await region.waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("breakdown-row").first().waitFor({ state: "visible", timeout: 15_000 });

  const regionBox = await region.boundingBox();
  const tableBox = await region.locator("table").boundingBox();
  if (regionBox === null || tableBox === null) throw new Error("breakdown table or its scroll region has no bounding box");

  return { scrollerWidth: regionBox.width, tableWidth: tableBox.width, overflow: tableBox.width - regionBox.width };
}

for (const width of [1440, 1280] as const) {
  test(`Breakdown (2024new, 14 metric columns) desktop overflow at ${width}px is reduced well below the ${PRE_FIX_OVERFLOW_PX}px original baseline`, async ({ page }) => {
    const { scrollerWidth, tableWidth, overflow } = await measureOverflow(page, width);
    const bound = OVERFLOW_BOUNDS_PX[width]!;
    const priorBound = PRE_G10_OVERFLOW_PX[width]!;

    expect(
      overflow,
      `at ${width}px: scroller=${scrollerWidth.toFixed(1)}px table=${tableWidth.toFixed(1)}px overflow=${overflow.toFixed(
        1,
      )}px — expected <= ${bound}px (07-UAT.md G-10's measured post-fix bound). If this now FAILS because overflow is 0 or negative, G-10's own residual-overflow finding is stale — update this file's comment and bound rather than leaving a falsely pessimistic assertion in place.`,
    ).toBeLessThanOrEqual(bound);

    expect(
      overflow,
      `at ${width}px: overflow ${overflow.toFixed(1)}px did not improve on the G-7 (pre-G-10) ${priorBound}px baseline`,
    ).toBeLessThan(priorBound);

    expect(overflow, `at ${width}px: overflow ${overflow.toFixed(1)}px did not improve on the ${PRE_FIX_OVERFLOW_PX}px original baseline`).toBeLessThan(
      PRE_FIX_OVERFLOW_PX,
    );
  });
}

test("Breakdown desktop header wrap: no header cell's wrapped text is clipped (scrollHeight <= clientHeight) at 1440px", async ({ page }) => {
  await measureOverflow(page, 1440);
  const headers = page.locator('[data-testid^="breakdown-header-"]');
  const count = await headers.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const header = headers.nth(i);
    const testId = await header.getAttribute("data-testid");
    const { scrollHeight, clientHeight, text } = await header.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      text: el.textContent,
    }));
    expect(scrollHeight, `${testId} ("${text}") wrapped text is clipped: scrollHeight=${scrollHeight} > clientHeight=${clientHeight}`).toBeLessThanOrEqual(
      clientHeight,
    );
  }
});

test("Breakdown desktop (1440px): G-1's declared==actual and 0px pinned sticky gap both hold after the container widen", async ({ page }) => {
  await measureOverflow(page, 1440);

  const teamNumberHeader = page.getByTestId("breakdown-header-teamNumber");
  const nicknameHeader = page.getByTestId("breakdown-header-nickname");
  const declaredTeamNumber = await teamNumberHeader.evaluate((el) => Number.parseFloat((el as HTMLElement).style.width));
  const actualTeamNumberBox = await teamNumberHeader.boundingBox();
  if (actualTeamNumberBox === null) throw new Error("teamNumber header has no bounding box");
  expect(Math.abs(actualTeamNumberBox.width - declaredTeamNumber), "declared vs actual teamNumber column width diverged").toBeLessThanOrEqual(1);

  const nicknameBox = await nicknameHeader.boundingBox();
  if (nicknameBox === null) throw new Error("nickname header has no bounding box");
  const gap = nicknameBox.x - (actualTeamNumberBox.x + actualTeamNumberBox.width);
  expect(Math.abs(gap), `sticky gap between pinned teamNumber and nickname headers: ${gap}px`).toBeLessThanOrEqual(1);
});

/**
 * 07-UAT.md G-10's own regression guard: every metric-tier cell's content
 * must still fit its (now narrower) declared column width with zero
 * clipping. Checked against BOTH the file's own primary target (2024new)
 * and 2026alhu — the real worst-case artifact this fix's column widths were
 * sized against (`BREAKDOWN_TOTAL_COLUMN_WIDTH_PX`'s own doc comment in
 * `BreakdownTab.tsx`), whose Total values reach six digits
 * (`"284.89 ± 8.75"`). A guard against 2024new alone would never exercise
 * the six-digit case the Total column's own wider size exists for.
 */
async function assertNoCellClipping(page: Page, eventUrl: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(eventUrl, { waitUntil: "networkidle" });
  await page.getByTestId("breakdown-table-scroll").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("breakdown-row").first().waitFor({ state: "visible", timeout: 15_000 });

  const cells = page.locator('[data-testid^="breakdown-cell-"]');
  const count = await cells.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const cell = cells.nth(i);
    const testId = await cell.getAttribute("data-testid");
    const { scrollWidth, clientWidth, text } = await cell.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      text: el.textContent,
    }));
    expect(scrollWidth, `${testId} ("${text}") content clips: scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`).toBeLessThanOrEqual(clientWidth + 1);
  }
}

test("Breakdown desktop (1440px, 2024new): no metric-tier cell content clips at the narrowed column widths", async ({ page }) => {
  await assertNoCellClipping(page, EVENT_URL);
});

test("Breakdown desktop (1440px, 2026alhu — the six-digit-Total worst case): no metric-tier cell content clips at the narrowed column widths", async ({
  page,
}) => {
  await assertNoCellClipping(page, "/event/2026alhu?tab=breakdown&algorithm=vpr");
});
