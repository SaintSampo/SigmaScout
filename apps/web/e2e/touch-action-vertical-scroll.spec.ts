/**
 * 07-UAT.md G-4: real-device UAT ("it is hard to scroll up and down on the
 * page. I have to do it very precisely") found that `touch-action: pan-x`
 * was applied to every horizontally-scrolling table/tab-strip on this page —
 * `pan-x` permits ONLY horizontal panning, so a vertical touch gesture that
 * STARTS on one of these elements is never handed to the page's own
 * vertical scroller. Since these regions occupy nearly the whole phone
 * viewport, a real user had almost no page real estate left where a
 * vertical drag would actually scroll the page.
 *
 * 06-RESEARCH.md's own Pitfall 6 ("`touch-action: pan-x` is not fully
 * reliable on iOS Safari") warned specifically that a passing
 * Playwright/CDP touch-emulation test does not prove real-device gesture
 * arbitration — and indeed, `touch-scroll.spec.ts` and
 * `event-scroll-regions.spec.ts` both passed green with the defect shipped
 * (their vertical-drag assertions dispatch synthetic touch events that do
 * not reproduce a real iPhone's touch-action-driven arbitration). This file
 * closes the CSS-CONTRACT half of that gap only — it asserts the computed
 * `touch-action` value permits `pan-y`, which is necessary but NOT
 * sufficient proof of real-device gesture arbitration. The real-device
 * check remains a human checkpoint (07-UAT.md's own Test 1).
 *
 * Proven RED against the currently deployed origin (pre-fix): every region
 * below reports a computed `touch-action` of exactly "pan-x" — see this
 * task's commit message / SUMMARY for the captured failure output.
 */
import { test, expect, type Locator } from "@playwright/test";

const EVENT_KEY = "2024new";
const TEAM_URL = "/team/118?year=2024&algorithm=vpr";

interface RegionCase {
  name: string;
  url: string;
  testId: string;
}

/** Every site named in 07-UAT.md's G-4 gap report as carrying the defect. */
const REGIONS: RegionCase[] = [
  { name: "event tab strip", url: `/event/${EVENT_KEY}?algorithm=vpr&tab=insights`, testId: "event-tab-strip-scroll" },
  { name: "Insights table", url: `/event/${EVENT_KEY}?algorithm=vpr&tab=insights`, testId: "insights-table-scroll" },
  { name: "Breakdown table", url: `/event/${EVENT_KEY}?algorithm=vpr&tab=breakdown`, testId: "breakdown-table-scroll" },
  { name: "Quals table", url: `/event/${EVENT_KEY}?algorithm=vpr&tab=quals`, testId: "quals-table-scroll" },
  { name: "Alliances table", url: `/event/${EVENT_KEY}?algorithm=vpr&tab=alliances`, testId: "alliances-table-scroll" },
  { name: "Elims table", url: `/event/${EVENT_KEY}?algorithm=vpr&tab=elims`, testId: "elims-table-scroll" },
];

async function assertVerticalPanPermittedAndOverscrollUnchanged(locator: Locator, label: string): Promise<void> {
  const { touchAction, overscrollBehaviorX } = await locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return { touchAction: style.touchAction, overscrollBehaviorX: style.overscrollBehaviorX };
  });

  expect(
    touchAction,
    `${label}: computed touch-action is "${touchAction}" — "pan-x" alone blocks every vertical touch gesture starting here (07-UAT.md G-4)`,
  ).not.toBe("pan-x");
  // Chromium canonicalizes a computed `touch-action: pan-x pan-y pinch-zoom`
  // down to the single equivalent keyword "manipulation" (confirmed live,
  // local build verification) rather than echoing back the three keywords
  // verbatim — a plain `.toContain("pan-y")` would false-negative against
  // that canonical form even though it permits EXACTLY the same gestures.
  // Accept either serialization; only reject an axis-restricted value.
  const permitsVerticalPan = touchAction === "manipulation" || touchAction === "auto" || touchAction.includes("pan-y");
  expect(permitsVerticalPan, `${label}: computed touch-action "${touchAction}" does not permit vertical panning`).toBe(true);

  // "Two things to get right" (07-UAT.md G-4, item 1): overscroll-behavior-x
  // is the property that stops the PAGE panning sideways, not touch-action —
  // it must stay "contain" exactly as before. A regression here would
  // silently reopen the Phase 5 `no-page-pan.spec.ts` bug via a different
  // property than the one this fix touches.
  expect(
    overscrollBehaviorX,
    `${label}: overscroll-behavior-x is "${overscrollBehaviorX}", not "contain" — this is the property guarding no-page-pan.spec.ts's invariant, not touch-action, and must be untouched by this fix`,
  ).toBe("contain");
}

for (const region of REGIONS) {
  test(`${region.name}: touch-action permits vertical panning (G-4)`, async ({ page }) => {
    await page.goto(region.url, { waitUntil: "networkidle" });
    const locator = page.locator(`[data-testid="${region.testId}"]`);
    await locator.waitFor({ state: "visible", timeout: 15_000 });

    await assertVerticalPanPermittedAndOverscrollUnchanged(locator, region.name);
  });
}

test("team page match-table scroller: touch-action permits vertical panning (G-4)", async ({ page }) => {
  await page.goto(TEAM_URL, { waitUntil: "networkidle" });
  const locator = page.locator('[data-testid^="match-table-scroll-"]').first();
  await locator.waitFor({ state: "visible", timeout: 15_000 });

  await assertVerticalPanPermittedAndOverscrollUnchanged(locator, "team page match-table scroller");
});
