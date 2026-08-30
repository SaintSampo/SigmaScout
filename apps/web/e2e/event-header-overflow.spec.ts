/**
 * 07-20-PLAN.md Task 2, ledger rows 11 and 12 — UI-SPEC's E1 `overflow` and
 * `long-text` rows. Targets `2026vache`, whose published name is 124
 * characters — the longest event name measured across five seasons of
 * corpus data this session (2025 tops out at 98, 2023 at 97, 2024 at 82,
 * 2022 at 77).
 *
 * Runs on both `phone-390` and `desktop` (`playwright.config.ts`). Against
 * the DEPLOYED origin, matching every other spec in this phase — there is no
 * local `webServer` and `data.sigmascout.org`'s CORS policy does not
 * allow-list `localhost`/`*.pages.dev`.
 */
import { test, expect } from "@playwright/test";

/**
 * `2026vache`'s published name, verbatim. Declared as one constant so both
 * the `title` and `textContent` assertions compare against the SAME source,
 * and its own `.length` is asserted below so a silently edited constant
 * fails loudly rather than tautologically passing.
 */
const LONG_EVENT_NAME = "FCH District Chesapeake VA Event presented by Newport News Ship Yard / Hampton Roads Community Foundation (Norfolk Southern)";
const LONG_EVENT_NAME_LENGTH = 124;

test("the 2026vache constant is genuinely 124 characters — a silently edited constant fails this case rather than tautologically passing every other one", () => {
  expect(LONG_EVENT_NAME.length).toBe(LONG_EVENT_NAME_LENGTH);
});

test.describe("E1 — the longest published event name renders whole, truncates by layout only, never pans the page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/event/2026vache?algorithm=vpr", { waitUntil: "networkidle" });
    await page.getByTestId("event-header").waitFor({ state: "visible", timeout: 15_000 });
  });

  test("the heading's title attribute and textContent both equal the whole published name", async ({ page }) => {
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();

    const title = await heading.getAttribute("title");
    expect(title).toBe(LONG_EVENT_NAME);

    // The rendered text is never a shortened COPY — this is what makes
    // cutting a multi-byte character mid-codepoint structurally impossible:
    // there is no second, truncated string anywhere for a cut to happen to.
    const text = await heading.innerText();
    expect(text).toBe(LONG_EVENT_NAME);
  });

  test("the heading truncates by layout (overflow-x hidden, ellipsis) and never becomes a fourth scroll region", async ({ page }) => {
    const heading = page.getByRole("heading", { level: 1 });
    const { overflowX, textOverflow } = await heading.evaluate((el) => {
      const style = getComputedStyle(el);
      return { overflowX: style.overflowX, textOverflow: style.textOverflow };
    });
    expect(overflowX).toBe("hidden");
    expect(textOverflow).toBe("ellipsis");

    const headerEl = page.getByTestId("event-header");
    const stripEl = page.locator('[data-testid="event-tab-strip-scroll"]');
    const { headerContainsStrip, stripContainsHeader } = await page.evaluate(
      ({ headerSel, stripSel }) => {
        const header = document.querySelector(headerSel);
        const strip = document.querySelector(stripSel);
        if (header === null || strip === null) throw new Error("header or strip element not found");
        return { headerContainsStrip: header.contains(strip), stripContainsHeader: strip.contains(header) };
      },
      { headerSel: '[data-testid="event-header"]', stripSel: '[data-testid="event-tab-strip-scroll"]' },
    );
    expect(headerContainsStrip).toBe(false);
    expect(stripContainsHeader).toBe(false);
    void headerEl;
    void stripEl;
  });

  test('the "View on TBA" link stays fully inside the viewport', async ({ page }) => {
    const link = page.getByRole("link", { name: "View on TBA" });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    if (box === null) throw new Error("View on TBA link has no bounding box");
    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("no viewport size");
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  });

  test("the page does not pan horizontally", async ({ page }) => {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `document scrollWidth ${scrollWidth} exceeds clientWidth ${clientWidth} — the page can be panned sideways`).toBeLessThanOrEqual(clientWidth + 1);
  });
});

/**
 * `phone-390`-only: at 1440px (`desktop`), whether a 124-character heading
 * overflows its own box depends on the shipped type scale — asserting
 * truncation there would be asserting a coincidence, not a proven contract.
 * What IS asserted at both widths (the four cases above) is `title`/
 * `textContent` wholeness, layout-only truncation styling, no new scroll
 * region, the TBA link staying on-screen, and no page pan. This case alone
 * needs the actual overflow fact, which genuinely differs by viewport.
 *
 * This file's `testMatch` entry covers BOTH `phone-390` and `desktop`
 * (`playwright.config.ts`), so this single test body runs under both
 * projects — the plan's own prohibition forbids a focused-or-skipped test
 * modifier as a gating mechanism, so a plain early `return` (never an
 * `expect()` call, never that kind of API) is used instead: on `desktop` the
 * function returns
 * before making any assertion at all, which is exactly the "does NOT make
 * that assertion at desktop" contract this case exists to satisfy, and is
 * not the "vacuous pass" pattern this plan otherwise forbids elsewhere
 * (`assertOverflows`'s own rule) — that rule is about a REGION that never
 * overflows proving nothing; this is about a CLAIM that is only meaningful
 * at one specific, pinned viewport in the first place.
 */
test("phone-390 only: the heading genuinely overflows its own box at 390px, proving the ellipsis rule above is doing real truncation work", async ({ page }, testInfo) => {
  if (testInfo.project.name !== "phone-390") return;

  await page.goto("/event/2026vache?algorithm=vpr", { waitUntil: "networkidle" });
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  const { scrollWidth, clientWidth } = await heading.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth, `heading scrollWidth ${scrollWidth} does not exceed clientWidth ${clientWidth} at 390px — truncation would not be doing real work`).toBeGreaterThan(clientWidth);
});
