/**
 * The team-page tracer's end-to-end proof (06-01-PLAN.md Task 1): a real
 * published `v1/team/frc1114/2024/vpr@{version}.json` artifact is fetched,
 * parsed and rendered on `/team/1114` — the renamed key plan 07-18's cutover
 * points this spec at (07-17 wrote it; this spec fetched the pre-rename
 * `sigma1@` key of the same object before this plan [pre-rename]).
 *
 * Runs against the DEPLOYED origin (`playwright.config.ts`'s `baseURL`),
 * following `touch-scroll.spec.ts`'s own header rule: `https://data.sigmascout.org`'s
 * R2 CORS policy does not allow-list `localhost`/`*.pages.dev`, so a local
 * dev/preview server's artifact fetch fails CORS entirely — there is nothing
 * to render without the real, deployed artifact.
 */
import { test, expect } from "@playwright/test";

const TEAM_URL = "/team/1114?year=2024&algorithm=vpr";

test.describe("Team page tracer", () => {
  test("renders a real team's nickname, number and record from the live bucket", async ({ page }) => {
    await page.goto(TEAM_URL);

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    const nicknameText = await heading.innerText();
    expect(nicknameText.trim().length).toBeGreaterThan(0);

    const record = page.getByTestId("team-record");
    await expect(record).toBeVisible();
    const recordText = await record.innerText();
    expect(recordText).toMatch(/^\d+-\d+-\d+$/);
  });

  test("a non-numeric team number renders a message and fires no artifact fetch", async ({ page }) => {
    let teamRequestFired = false;
    page.on("request", (request) => {
      if (request.url().includes("/v1/team/")) {
        teamRequestFired = true;
      }
    });

    await page.goto("/team/notateam?year=2024&algorithm=vpr");
    await expect(page.getByText('"notateam" is not a valid team number.')).toBeVisible();
    expect(teamRequestFired).toBe(false);
  });
});
