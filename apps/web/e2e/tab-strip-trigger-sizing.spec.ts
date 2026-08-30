/**
 * 07-UAT.md G-5: the event tab strip's `TabsList` force-equalized every
 * trigger to an identical box width (`flex-1`) regardless of its own
 * label's width. Measured live at 390px: every box forced to 67px while
 * label text varied 36-76px, and "Breakdown"'s own 76px text overflowed its
 * 67px box.
 *
 * Proven RED against the currently deployed origin (pre-fix): the
 * uniform-gap assertion below fails (gaps ranged ~6-22px per 07-UAT.md's
 * own table) and at least one trigger's own scrollWidth exceeds its
 * clientWidth ("Breakdown" overflowing its box). See this task's commit
 * message / SUMMARY for the captured failure output.
 */
import { test, expect, type Locator } from "@playwright/test";

const EVENT_URL = "/event/2024new?algorithm=vpr&tab=insights";
/** Real-world subpixel/font-hinting tolerance for width/position comparisons — loose enough to absorb browser rounding, tight enough that the 6-22px range 07-UAT.md measured cannot pass by accident. */
const TOLERANCE_PX = 2;

/**
 * The bounding rect of a tab's own VISIBLE LABEL TEXT (a Range over its text
 * node), not the trigger's own button box. This is deliberate: pre-fix, the
 * button boxes are ALL forced to an equal width (`flex-1`) regardless of
 * label width, so a box-edge-to-box-edge gap measurement would report a
 * uniform 4px (the list's own `gap-1`) even with the defect fully present —
 * it would not reproduce 07-UAT.md's own reported metric ("visual gap to
 * previous", 6-22px), which is a text-edge-to-text-edge measurement. Only a
 * label-rect measurement can distinguish "boxes are uniform but text isn't"
 * from "boxes size to their own content."
 */
async function labelRect(tab: Locator): Promise<{ x: number; width: number }> {
  return tab.evaluate((el) => {
    const textNode = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0);
    if (!textNode) throw new Error(`tab "${el.textContent}" has no direct text node to measure`);
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, width: rect.width };
  });
}

test.describe("G-5 — tab strip triggers size to their own content, with a uniform visual gap", () => {
  test("no trigger's label overflows its own box, and the gap between adjacent labels is uniform", async ({ page }) => {
    await page.goto(EVENT_URL, { waitUntil: "networkidle" });
    const strip = page.locator('[data-testid="event-tab-strip-scroll"]');
    await strip.waitFor({ state: "visible", timeout: 15_000 });

    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1);

    const measurements: { label: string; labelBox: { x: number; width: number }; scrollWidth: number; clientWidth: number }[] = [];
    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      const label = (await tab.innerText()).trim();
      const labelBox = await labelRect(tab);
      const { scrollWidth, clientWidth } = await tab.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      measurements.push({ label, labelBox, scrollWidth, clientWidth });
    }

    // No label may exceed its own box — the exact "Breakdown" overflow
    // 07-UAT.md measured (76px text inside a 67px box).
    for (const m of measurements) {
      expect(
        m.scrollWidth,
        `tab "${m.label}": content scrollWidth ${m.scrollWidth}px exceeds its own trigger's clientWidth ${m.clientWidth}px — the label overflows its trigger`,
      ).toBeLessThanOrEqual(m.clientWidth + TOLERANCE_PX);
    }

    // The visual gap between each pair of adjacent LABELS must be uniform —
    // 07-UAT.md's own measurement found gaps ranging 6-22px purely from
    // force-equalized box widths against varying label widths, even though
    // padding and the list's own gap are already uniform.
    const gaps: number[] = [];
    for (let i = 0; i < measurements.length - 1; i++) {
      const current = measurements[i]!;
      const next = measurements[i + 1]!;
      gaps.push(next.labelBox.x - (current.labelBox.x + current.labelBox.width));
    }
    const maxGap = Math.max(...gaps);
    const minGap = Math.min(...gaps);
    expect(
      maxGap - minGap,
      `visual gaps between adjacent tab labels are not uniform: [${gaps.map((g) => g.toFixed(1)).join(", ")}]px (spread ${(maxGap - minGap).toFixed(
        1,
      )}px) — this reproduces G-5's "box widths force-equalized while label text varies" defect`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
  });
});
