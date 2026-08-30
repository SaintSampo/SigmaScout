/**
 * 07-UAT.md G-6: the event tab strip's `TabsList` computed
 * `justify-content: center` while the strip overflows its own scroll region
 * (measured live: strip scrollWidth 358px > clientWidth 342px at 390px).
 * Centering an overflowing flex container pushes some of its leading
 * content past the scroll origin, which a native horizontal scroller can
 * never reach (there is no negative scrollLeft).
 *
 * Proven RED against the currently deployed origin (pre-fix): the assertion
 * below fails because TabsList's computed justify-content is exactly
 * "center" while the strip overflows. See this task's commit message /
 * SUMMARY for the captured failure output.
 */
import { test, expect } from "@playwright/test";

const EVENT_URL = "/event/2024new?algorithm=vpr&tab=insights";
/** Real-world subpixel/font-hinting tolerance for position comparisons. */
const TOLERANCE_PX = 2;

test.describe("G-6 — the tab strip start-aligns (falls back from center) while it overflows its scroll region", () => {
  test("justify-content is not plain center while the strip overflows, and the leading tab is reachable at scrollLeft 0", async ({ page }) => {
    await page.goto(EVENT_URL, { waitUntil: "networkidle" });
    const strip = page.locator('[data-testid="event-tab-strip-scroll"]');
    await strip.waitFor({ state: "visible", timeout: 15_000 });

    const { scrollWidth, clientWidth } = await strip.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(
      scrollWidth,
      `strip does not overflow (scrollWidth ${scrollWidth} <= clientWidth ${clientWidth}) — this test needs an overflowing strip to be meaningful`,
    ).toBeGreaterThan(clientWidth);

    const tabsList = page.locator('[data-slot="tabs-list"]');
    const justifyContent = await tabsList.evaluate((el) => getComputedStyle(el).justifyContent);
    expect(
      justifyContent,
      `TabsList computed justify-content is "${justifyContent}" while the strip overflows — plain "center" pushes the leading tab past the scroll origin, making it unreachable by scrolling (07-UAT.md G-6)`,
    ).not.toBe("center");

    // The concrete, observable consequence of G-6's bug (an unreachable
    // leading tab), not just the CSS property's name: at scrollLeft 0, the
    // first tab's own left edge must not sit to the LEFT of the scroller's
    // own left edge — if it does, no amount of native scrolling can reach it
    // (there is no negative scrollLeft).
    await strip.evaluate((el) => {
      el.scrollLeft = 0;
    });
    const firstTab = page.getByRole("tab").first();
    const firstBox = await firstTab.boundingBox();
    const stripBox = await strip.boundingBox();
    if (firstBox === null || stripBox === null) throw new Error("missing bounding box for the first tab or the strip");
    expect(
      firstBox.x,
      `first tab's left edge (${firstBox.x}) sits left of the scroller's own left edge (${stripBox.x}) at scrollLeft 0 — it is not reachable by scrolling`,
    ).toBeGreaterThanOrEqual(stripBox.x - TOLERANCE_PX);
  });
});
