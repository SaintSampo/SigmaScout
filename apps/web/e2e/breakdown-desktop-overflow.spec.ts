/**
 * 07-UAT.md G-7: on desktop, the Breakdown tab's 14 metric columns (2024's
 * widest real column set) overflowed their scroll region by 836px at both
 * 1440px and 1280px — the shared `max-w-[1200px]` content column (also used
 * by team pages) capped the scroller at 1152px regardless of monitor width,
 * so even a 1440px screen wasted ~240px of its own viewport. Reported live:
 * "on desktop, on breakdown, I should see every column always. I have to
 * jank scroll right to see total."
 *
 * The approved fix (this task) widens the Breakdown tab's own container
 * (scoped to that tab only — every other event tab and the team page keep
 * `max-w-[1200px]` unchanged) and humanizes/wraps the header labels. That
 * recovers real width — see the two assertions below — but does NOT reach
 * ZERO overflow at either target viewport, and this file says so with real
 * numbers rather than asserting a bound it knows to be false:
 *
 *   - the true floor on a metric column's width is NOT the header text (a
 *     wrapped, humanized header fits comfortably at 120px) — it is
 *     `MetricValue.tsx`'s shared `.metric-tier` box (`theme.css`), which the
 *     real "value ± spread" string alone needs ~97-106px of CONTENT width
 *     for (measured directly, `min-width` disabled, against the real
 *     deployed 2024new AND 2026alhu artifacts — a plain 2-decimal value plus
 *     a 2-decimal spread is already 12-13 characters at tabular-nums 14px).
 *     `MetricValue.tsx` is a SHARED component (Team page, Teams table,
 *     Insights all render through it) and is explicitly out of this task's
 *     file-ownership scope (`BreakdownTab.tsx` and this route's container
 *     only) — narrowing it here would be a cross-page design change, not a
 *     Breakdown-only fix, and is exactly the kind of change 07-UAT.md's own
 *     Rule 4 (architectural changes) asks to be surfaced rather than made
 *     silently.
 *   - at the EXISTING, collision-safe 120px metric-column width (unchanged
 *     by this fix — see the file header above), fitting all 14 columns with
 *     zero overflow needs roughly 1988px of table width, i.e. a ~2036px
 *     viewport (1988 + the page's 48px horizontal padding) — wider than
 *     both 1440px and 1280px, the two widths this gap was measured at.
 *
 * This file's assertions are therefore a REGRESSION GUARD on the real,
 * measured improvement (overflow strictly and substantially reduced from
 * the 836px baseline), not a false "no overflow" claim. Eliminating the
 * remaining ~600-750px needs one of: a wider target viewport, fewer
 * default-visible metric columns, or a Breakdown-specific redesign of
 * `MetricValue`'s value-display geometry — each a product/design decision
 * for a human, not something this fix resolves unilaterally.
 */
import { test, expect, type Page } from "@playwright/test";

const EVENT_URL = "/event/2024new?tab=breakdown&algorithm=vpr";

/** 07-UAT.md G-7's own reported pre-fix number, both target viewports. */
const PRE_FIX_OVERFLOW_PX = 836;

/**
 * The bound this fix is expected to hold GREEN at, post-deploy — measured
 * locally against a fixture-backed dev server serving the real, deployed
 * 2024new artifact (596px at 1440, 756px at 1280), with a ~25px buffer for
 * cross-environment font-rendering variance. Both are still comfortably
 * under `PRE_FIX_OVERFLOW_PX`, which is what proves this is a genuine
 * improvement rather than a no-op.
 */
const OVERFLOW_BOUNDS_PX: Record<number, number> = {
  1440: 620,
  1280: 780,
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
  test(`Breakdown (2024new, 14 metric columns) desktop overflow at ${width}px is reduced well below the ${PRE_FIX_OVERFLOW_PX}px pre-fix baseline`, async ({ page }) => {
    const { scrollerWidth, tableWidth, overflow } = await measureOverflow(page, width);
    const bound = OVERFLOW_BOUNDS_PX[width]!;

    expect(
      overflow,
      `at ${width}px: scroller=${scrollerWidth.toFixed(1)}px table=${tableWidth.toFixed(1)}px overflow=${overflow.toFixed(
        1,
      )}px — expected <= ${bound}px (07-UAT.md G-7's measured post-fix bound). If this now FAILS because overflow is 0 or negative, G-7's own residual-overflow finding is stale — update this file's comment and bound rather than leaving a falsely pessimistic assertion in place.`,
    ).toBeLessThanOrEqual(bound);

    expect(overflow, `at ${width}px: overflow ${overflow.toFixed(1)}px did not improve on the ${PRE_FIX_OVERFLOW_PX}px pre-fix baseline`).toBeLessThan(
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
