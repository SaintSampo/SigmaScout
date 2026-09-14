/**
 * Runs on the `desktop` project only (`playwright.config.ts`): none of
 * these claims is viewport-dependent. Artifacts are fetched through
 * Playwright's `request` fixture (an anonymous public GET against our own
 * R2 origin, `https://data.sigmascout.org` — no CORS is involved on that
 * path), with the `spr` algorithm version resolved ONCE from
 * `v1/manifest/algorithms.json` and never hardcoded, so a rename or any
 * future version bump cannot silently turn these cases into
 * 404-assertions.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import type { EventArtifact } from "../../../packages/harness/pageArtifacts.js";

const ORIGIN = "https://data.sigmascout.org";

async function resolveSprVersion(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${ORIGIN}/v1/manifest/algorithms.json`);
  expect(response.ok(), `manifest fetch failed: ${response.status()}`).toBe(true);
  const manifest = (await response.json()) as { algorithms: { id: string; version: string }[] };
  const spr = manifest.algorithms.find((a) => a.id === "spr");
  if (spr === undefined) throw new Error("manifest carries no spr entry — the prerequisite publish has not landed");
  return spr.version;
}

async function fetchEventArtifact(request: APIRequestContext, eventKey: string, version: string): Promise<EventArtifact> {
  const url = `${ORIGIN}/v1/event/${eventKey}/spr@${version}.json`;
  const response = await request.get(url);
  expect(response.ok(), `${url} did not resolve 200 (got ${response.status()})`).toBe(true);
  return (await response.json()) as EventArtifact;
}

// ---------------------------------------------------------------------------
// The no-ranking fallback exercised against a REAL published no-ranking
// artifact, with a real ranked-artifact control.
// ---------------------------------------------------------------------------

test.describe("ledger row 4 — no-ranking fallback ordering, real artifact + control", () => {
  test("2025isios (offseason, reachable only via --include-offseason and a republish): no team carries a rank, and the Insights tab renders the fallback banner", async ({
    page,
    request,
  }) => {
    const version = await resolveSprVersion(request);
    const artifact = await fetchEventArtifact(request, "2025isios", version);
    expect(artifact.teams.length).toBeGreaterThan(0);
    // Absence via the property's own absence/undefined, never a falsy check —
    // a published rank of 0 could not be mistaken for absence this way.
    const anyRanked = artifact.teams.some((team) => team.rank !== undefined);
    expect(anyRanked, "2025isios unexpectedly carries a rank on at least one team — the no-ranking fallback fixture no longer exhibits the shape under test").toBe(false);

    await page.goto("/event/2025isios?tab=insights&algorithm=spr", { waitUntil: "networkidle" });
    const banner = page.getByTestId("insights-fallback-banner");
    await expect(banner).toBeVisible();
    const text = await banner.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  // The control: without this case, a build that ALWAYS renders the fallback
  // banner (a bug that would make the positive case above pass regardless of
  // whether the discriminant logic actually works) would go undetected.
  test("2024new: every one of its 75 teams carries a rank, and the Insights tab renders NO fallback banner", async ({ page, request }) => {
    const version = await resolveSprVersion(request);
    const artifact = await fetchEventArtifact(request, "2024new", version);
    expect(artifact.teams.length).toBe(75);
    const allRanked = artifact.teams.every((team) => team.rank !== undefined);
    expect(allRanked, "2024new no longer publishes a rank on every team — the no-ranking control fixture no longer exhibits the shape under test").toBe(true);

    await page.goto("/event/2024new?tab=insights&algorithm=spr", { waitUntil: "networkidle" });
    await expect(page.getByTestId("insights-row").first()).toBeVisible();
    await expect(page.getByTestId("insights-fallback-banner")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Ledger row 10 — the two-pick alliance contract against a REAL published
// artifact, with a populated-Pick-2 control.
// ---------------------------------------------------------------------------

test.describe("ledger row 10 — the two-pick alliance contract, real artifact + control", () => {
  test("2024vabrb (Blue Ridge Brawl, offseason): exactly 5 alliances of exactly 2 picks each; the rendered table leaves Pick 2 blank and renders no Pick 3 column at all", async ({
    page,
    request,
  }) => {
    const version = await resolveSprVersion(request);
    const artifact = await fetchEventArtifact(request, "2024vabrb", version);
    const alliances = artifact.alliances ?? [];
    expect(alliances.length).toBe(5);
    for (const alliance of alliances) {
      expect(alliance.picks.length, `alliance ${alliance.allianceNumber} does not carry exactly 2 picks`).toBe(2);
    }

    await page.goto("/event/2024vabrb?tab=alliances&algorithm=spr", { waitUntil: "networkidle" });
    const trigger = page.getByRole("tab", { name: "Alliances" });
    await expect(trigger).toBeEnabled();

    const rows = page.getByTestId("alliances-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(5);

    // The absent-value treatment since ed49b8a0 is BLANK, not an em dash, and
    // since 834d27b2 the backup column (header "Pick 3", id `pickBackup`)
    // renders only when some alliance has a backup pick. AlliancesTab.test.tsx
    // pins this exact two-pick shape ("modelled on 2024vabrb").
    await expect(page.getByTestId("alliances-header-pickBackup")).toHaveCount(0);
    for (let i = 0; i < 5; i++) {
      const pick1 = rows.nth(i).getByTestId("alliances-cell-pick1");
      const pick2 = rows.nth(i).getByTestId("alliances-cell-pick2");
      const backup = rows.nth(i).getByTestId("alliances-cell-pickBackup");
      expect((await pick1.innerText()).trim()).not.toBe("");
      expect((await pick2.innerText()).trim()).toBe("");
      await expect(backup).toHaveCount(0);
    }
  });

  // The control: without an event where Pick 2 CAN be populated, the blank
  // assertion above could pass even if the app rendered the cell blank
  // unconditionally for every alliance regardless of the underlying data.
  test("2024new: 8 alliances, each with a populated Pick 2", async ({ page, request }) => {
    const version = await resolveSprVersion(request);
    const artifact = await fetchEventArtifact(request, "2024new", version);
    const alliances = artifact.alliances ?? [];
    expect(alliances.length).toBe(8);
    for (const alliance of alliances) {
      expect(alliance.picks.length, `alliance ${alliance.allianceNumber} does not carry a 3rd pick`).toBeGreaterThanOrEqual(3);
    }

    await page.goto("/event/2024new?tab=alliances&algorithm=spr", { waitUntil: "networkidle" });
    const rows = page.getByTestId("alliances-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(8);

    for (let i = 0; i < 8; i++) {
      const pick2 = rows.nth(i).getByTestId("alliances-cell-pick2");
      expect((await pick2.innerText()).trim()).not.toBe("");
    }
  });

  // `2024cmptx` (Einstein) publishes 8 real alliances of 4 picks each
  // rather than an empty array, so no additive empty-array case exists
  // for it here.
});

// ---------------------------------------------------------------------------
// Ledger row 8, behavioral half — documents the shipped 2022 elimination
// order as FACT, without endorsing it as a product decision.
// ---------------------------------------------------------------------------

test.describe("ledger row 8 (behavioral half) — the shipped 2022ilpe elimination order", () => {
  /**
   * [Rule 1 correction, found live running this task's own required
   * verification] 07-20-PLAN.md's action text and Task 3 checkpoint both
   * describe the shipped order at `2022ilpe` as the SERIES-MAJOR sequence
   * 07-13 originally measured against the bracket-chain-only comparator.
   * Direct measurement this session — both by re-implementing
   * `eventMatchAxis.ts`'s actual shipped `compareEventMatchRows` against the
   * real fetched artifact, and by reading the LIVE rendered DOM order at
   * `/event/2022ilpe?tab=elims` — shows the CURRENT shipped order is
   * WALL-CLOCK (chronological by `sortTime`), not series-major.
   * `eventMatchAxis.ts` (git history: one commit, `cfdb83bf`, 07-12's own
   * original tracer task) has carried a sortTime-presence-first comparator
   * since it was first authored, and its own header comment states this
   * closes exactly the finding 07-13 raised. Every one of `2022ilpe`'s 18
   * elimination rows carries a `sortTime`, so the presence-based branch never
   * falls through to the bracket-chain tie-break, and the match set sorts
   * purely chronologically. This test therefore documents the ACTUAL,
   * currently-deployed sequence (wall-clock) rather than the plan's
   * inherited, now-stale series-major expectation — asserting the sequence
   * the plan describes would be asserting a claim the live site does not
   * make, which is exactly the false-evidence failure mode this plan exists
   * to prevent. See 07-20-SUMMARY.md for the full correction and its
   * implication for Task 3's checkpoint item 3.
   */
  const ACTUAL_SHIPPED_ORDER = [
    "Quarterfinal 1-1",
    "Quarterfinal 2-1",
    "Quarterfinal 3-1",
    "Quarterfinal 4-1",
    "Quarterfinal 1-2",
    "Quarterfinal 2-2",
    "Quarterfinal 3-2",
    "Quarterfinal 4-2",
    "Quarterfinal 3-3",
    "Semifinal 1-1",
    "Quarterfinal 2-3",
    "Quarterfinal 4-3",
    "Semifinal 2-1",
    "Semifinal 1-2",
    "Semifinal 2-2",
    "Final 1-1",
    "Semifinal 2-3",
    "Final 1-2",
  ] as const;

  test("2022ilpe: the rendered rows' round labels form exactly this 18-element sequence (documents what ships; does not endorse it)", async ({ page }) => {
    await page.goto("/event/2022ilpe?tab=elims&algorithm=spr", { waitUntil: "networkidle" });
    const rows = page.locator('[data-testid^="match-row-"]');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(ACTUAL_SHIPPED_ORDER.length);

    const labels: string[] = [];
    for (let i = 0; i < ACTUAL_SHIPPED_ORDER.length; i++) {
      // The round label is the Match column's link to that match's own page
      // (9000521b); the roster-number links beside it go to /team/ instead.
      const label = await rows.nth(i).locator('a[href^="/match/"]').innerText();
      labels.push(label);
    }
    expect(labels).toEqual([...ACTUAL_SHIPPED_ORDER]);
  });
});
