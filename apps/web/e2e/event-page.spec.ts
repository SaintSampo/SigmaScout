/**
 * The event-page tracer's end-to-end proof (07-01-PLAN.md Task 1): a real
 * published `v1/event/2024casf/vpr@{version}.json` artifact is fetched,
 * parsed and rendered on `/event/2024casf` — the renamed key plan 07-18's
 * cutover points this spec at (07-17 wrote it; this spec fetched the
 * pre-rename `sigma1@` key of the same object before this plan [pre-rename]).
 * Found live by 07-18 Task 3's re-grep — this file did not exist when
 * 07-16's handoff list was written (created between waves 6 and 10).
 *
 * Runs against the DEPLOYED origin (`playwright.config.ts`'s `baseURL`),
 * following `team-page.spec.ts`'s own header rule: `https://data.sigmascout.org`'s
 * R2 CORS policy does not allow-list `localhost`/`*.pages.dev`, so a local
 * dev/preview server's artifact fetch fails CORS entirely — there is nothing
 * to render without the real, deployed artifact.
 */
import { test, expect } from "@playwright/test";

const EVENT_URL = "/event/2024casf?algorithm=vpr";

test.describe("Event page tracer", () => {
  test("renders a real event's key and a positive team count from the live bucket", async ({ page }) => {
    await page.goto(EVENT_URL);

    const eventKey = page.getByTestId("event-key");
    await expect(eventKey).toBeVisible({ timeout: 15_000 });
    await expect(eventKey).toHaveText("2024casf");

    const teamCount = page.getByTestId("event-team-count");
    await expect(teamCount).toBeVisible();
    const teamCountText = await teamCount.innerText();
    expect(Number.parseInt(teamCountText, 10)).toBeGreaterThan(0);
  });

  test("an invalid event key renders a message and fires no artifact fetch", async ({ page }) => {
    let eventRequestFired = false;
    page.on("request", (request) => {
      if (request.url().includes("/v1/event/")) {
        eventRequestFired = true;
      }
    });

    await page.goto("/event/notanevent?algorithm=vpr");
    await expect(page.getByText('"notanevent" is not a valid event key.')).toBeVisible();
    expect(eventRequestFired).toBe(false);
  });
});
