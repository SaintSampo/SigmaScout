import { test, expect } from "@playwright/test";
import { assertNoPagePan, assertOverflows } from "./support/scrollRegions.js";

/**
 * The Road to District Champs tab (phase 10), at 1440x900 and at 390px.
 *
 * RUNS AGAINST THE DEPLOYED ORIGIN ONLY. It is registered on `desktop` and
 * `phone-390` in `playwright.config.ts` and on NO `local-*` project: the point
 * of this spec is the deployed page reading the republished district artifact
 * out of R2, which a local preview reaches only through the `/v1` proxy. It is
 * therefore run by 10-09 from the main context AFTER the deploy and the
 * republish, never by an executor (an executor subagent's sandbox denies all
 * network Bash, project memory `project_subagent_network_block`).
 *
 * NO SELECTOR HERE IS INVENTED. Every literal below was grepped out of the
 * shipped source that renders it, and every grep's output line is in
 * `10-08-SUMMARY.md` (`e2e/support/simulation.ts`'s own rule). This file
 * imports nothing from `apps/web/src`, following this suite's precedent.
 *
 * THE TARGET DISTRICT IS FINISHED. `2026pnw`'s season is over, so the pinned
 * counts below are stable facts about a published artifact rather than a
 * moment inside a live weekend. A failure on one of them means the published
 * VERDICTS moved, which is a finding to triage, not spec drift to soften.
 *
 * FIRST EXECUTION. 10-08 wrote and registered this spec without running it, so
 * 10-09's run is its first. A failure there is as likely to be spec drift as a
 * site defect and both must be triaged rather than one assumed.
 */

// ---------------------------------------------------------------------------
// Pinned constants, each with the source it was derived from.
// ---------------------------------------------------------------------------

/** The finished district this spec targets. `data/fixtures/phase10/district-2026pnw.json`'s own `districtKey`. */
const DISTRICT_KEY = "2026pnw";
const SEASON = 2026;

/** `districts-index-2026.json`'s row for this district: `teamCount`. Also the artifact's `teams.length` and `insights.teamCount`. */
const ROSTER_SIZE = 126;

/** `districts-index-2026.json`'s row for this district: `dcmpSlots`. Also the artifact's own `dcmpSlots`. */
const DCMP_SLOTS = 50;

/**
 * The artifact's own `districtLock.status` census: 42 `locked` plus 8
 * `lockedAward`. The Locked CHIP counts both, because `lockedAward` is a note
 * on one status rather than a second status (`districtLedgerStatus.ts`).
 *
 * THE TWO PINS CHECK EACH OTHER: on a finished district every slot that can be
 * locked is locked, so `PREQUALIFIED_COUNT + LOCKED_COUNT` must equal
 * `DCMP_SLOTS`. If both numbers drifted together the equality below would
 * still catch the drift against the index's own slot count.
 */
const LOCKED_COUNT = 50;

/** No team in this artifact carries a `prequalified` verdict. */
const PREQUALIFIED_COUNT = 0;

/** The artifact's own `insights.districtEliminatedCount`, and its `districtLock.status` census of `eliminated`. */
const LOCKED_OUT_COUNT = 76;

/**
 * Test ids, transcribed by hand from shipped source (an e2e spec does not
 * import app source). Each comment names the file and the line the literal
 * was grepped out of, as of 2026-09-25.
 */
const TEST_IDS = {
  /** `routes/districts.tsx:228` — the Road to District Champs `TabsContent`. */
  ledgerPanel: "road-to-district-champs-panel",
  /** `routes/districts.tsx:231` — the Champ Locks `TabsContent`, the scoped removal control. */
  champPanel: "champ-locks-panel",
  /** `DistrictLedger.tsx:686` — the tab's own root. */
  ledgerTab: "district-ledger-tab",
  /** `DistrictLedger.tsx:477` — the one controls card. */
  controls: "district-ledger-controls",
  /** `DistrictLedger.tsx:426` — the Rewind slider's wrapper. */
  rewind: "district-ledger-rewind",
  /** `DistrictLedger.tsx:439` — the slider's position readout. */
  rewindReadout: "district-ledger-rewind-readout",
  /** `DistrictLedger.tsx:182` — the five status chips. */
  statusChips: "district-ledger-status-chips",
  /** `DistrictLedger.tsx:188` — one chip; carries `data-status`. */
  statusChip: "district-ledger-status-chip",
  /** `DistrictLedger.tsx:715` — one table row; carries `data-team`. */
  row: "district-ledger-row",
  /** `DistrictLedger.tsx:302` — the sticky Team cell. */
  teamCell: "district-ledger-team-cell",
  /** `DistrictLedger.tsx:151` — the Status cell. */
  statusCell: "district-ledger-status-cell",
  /** `DistrictLedger.tsx:734` — the Grand total cell. */
  grandTotal: "district-ledger-grand-total",
  /** `DistrictLocksTab.tsx:176`, with `which="champ"` — the champ tab's own header stats row. */
  champHeaderStatRow: "champ-locks-header-stat-row",
  /** `DistrictLocksTab.tsx:308`, with `which="champ"` — the champ tab's per event columns toggle. */
  champColumnToggle: "district-champ-locks-column-toggle",
  /** `DistrictLocksTab.tsx:302`, with `which="champ"` — the champ table itself. */
  champTab: "district-champ-locks-tab",
} as const;

/**
 * The five `data-status` values the chips carry, in render order.
 * `districtLedgerStatus.ts:47`'s `DISTRICT_LEDGER_STATUS_KEYS`.
 */
const STATUS_KEYS = ["prequalified", "locked", "inRange", "outOfRange", "lockedOut"] as const;

/** The PRE RENAME first tab id, retired in phase 10. `searchParams.ts:315`'s own rename note names it. */
const PRE_RENAME_TAB_ID = "district-locks";

/** The Rewind position search param. `searchParams.ts:358`. */
const REWIND_PARAM = "at";

/** The plus minus sign, which must never render on this tab (10-CONTEXT.md, locked). */
const PLUS_MINUS = "±";

function districtUrl(tab?: string): string {
  const base = `/districts?year=${SEASON}&district=${DISTRICT_KEY}`;
  return tab === undefined ? base : `${base}&tab=${tab}`;
}

/** The ledger's own horizontal scroll region: the direct `overflow-x-auto` child of the tab root (`DistrictLedger.tsx:697`). */
// The shared Table component wraps the table in its own horizontal scroller
// inside the data card, so the region that overflows is the wrapper holding
// the table, not the card (measured live 2026-09-25: table 1445px inside a
// 340px wrapper at 390px, the card itself never overflowing).
const LEDGER_SCROLL_REGION = `[data-testid="${TEST_IDS.ledgerTab}"] div.overflow-x-auto:has(> table)`;

/** Reads a chip's count out of its rendered text, which is `"{label} {count}"` (`DistrictLedger.tsx:188`). */
async function chipCount(page: import("@playwright/test").Page, status: string): Promise<number> {
  const chip = page.locator(`[data-testid="${TEST_IDS.statusChip}"][data-status="${status}"]`);
  await expect(chip, `the ${status} chip must render`).toHaveCount(1);
  const text = (await chip.innerText()).trim();
  const match = /(\d+)\s*$/.exec(text);
  if (match === null) throw new Error(`the ${status} chip's text "${text}" carries no trailing count`);
  return Number(match[1]);
}

test.describe("Road to District Champs, 1440x900", () => {
  test("the default panel renders the ledger, and the five status chips account for the whole roster", async ({ page }, testInfo) => {
    // A 126 team roster, two rows a team, nine columns, and the page polls.
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    // No `?tab=` at all: the renamed tab is the default.
    await page.goto(districtUrl());
    await expect(page.getByTestId(TEST_IDS.ledgerPanel)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.ledgerTab)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.controls)).toBeVisible();

    const rows = page.getByTestId(TEST_IDS.row);
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    // eslint-disable-next-line no-console -- printed for the SUMMARY's measured-figure obligation.
    console.log(`[districts-ledger] ${DISTRICT_KEY} rendered ${rowCount} ledger rows at 1440x900`);
    expect(rowCount, "the ledger must render at least one row per team").toBeGreaterThanOrEqual(ROSTER_SIZE);

    // One Team cell, one Status cell and one Grand total cell per team.
    await expect(page.getByTestId(TEST_IDS.teamCell)).toHaveCount(ROSTER_SIZE);
    await expect(page.getByTestId(TEST_IDS.statusCell)).toHaveCount(ROSTER_SIZE);
    await expect(page.getByTestId(TEST_IDS.grandTotal)).toHaveCount(ROSTER_SIZE);

    // The five chips, each with a count.
    await expect(page.getByTestId(TEST_IDS.statusChips)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.statusChip)).toHaveCount(STATUS_KEYS.length);
    const counts: Record<string, number> = {};
    for (const status of STATUS_KEYS) counts[status] = await chipCount(page, status);
    // eslint-disable-next-line no-console -- printed for the SUMMARY's measured-figure obligation.
    console.log(`[districts-ledger] chip counts: ${JSON.stringify(counts)}`);

    // A FAILURE ON ANY PIN BELOW MEANS THE PUBLISHED VERDICTS MOVED. That is a
    // finding to triage against the artifact, never a number to soften here.
    const total = STATUS_KEYS.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
    expect(total, "the five chip counts must account for the whole district roster").toBe(ROSTER_SIZE);
    expect(counts["prequalified"], "prequalified count").toBe(PREQUALIFIED_COUNT);
    expect(counts["locked"], "locked count, which includes the lockedAward variant").toBe(LOCKED_COUNT);
    expect(counts["lockedOut"], "locked out count, the artifact's own districtEliminatedCount").toBe(LOCKED_OUT_COUNT);
    // The two pins check each other: on a finished district every slot that can
    // be locked is locked.
    expect(
      (counts["prequalified"] ?? 0) + (counts["locked"] ?? 0),
      "prequalified plus locked must equal the district championship slot count",
    ).toBe(DCMP_SLOTS);
    // A finished district has no open category, so nothing is decided by a
    // median projection.
    expect(counts["inRange"], "in range count on a finished district").toBe(0);
    expect(counts["outOfRange"], "out of range count on a finished district").toBe(0);

    // Never a plus minus anywhere inside the table's scroll region.
    const regionText = await page.locator(LEDGER_SCROLL_REGION).innerText();
    expect(regionText, "the ledger's scroll region must never print a plus minus sign").not.toContain(PLUS_MINUS);

    const shotPath = testInfo.outputPath("districts-ledger-1440x900.png");
    await page.screenshot({ path: shotPath, fullPage: true });
    // eslint-disable-next-line no-console -- the path is printed so a human can look at the image.
    console.log(`[districts-ledger] desktop screenshot: ${shotPath}`);
  });

  test("the Rewind slider spans the district's timeline and its position is shareable", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(districtUrl());
    await expect(page.getByTestId(TEST_IDS.rewind)).toBeVisible();

    const slider = page.getByTestId(TEST_IDS.rewind).locator('input[type="range"]');
    await expect(slider).toHaveCount(1);
    const max = Number(await slider.getAttribute("max"));
    // eslint-disable-next-line no-console -- printed for the SUMMARY's measured-figure obligation.
    console.log(`[districts-ledger] rewind slider max (the now index): ${max}`);
    // At "now" on a finished district no event artifact is loaded (the tab
    // fetches only events in progress), so the timeline holds the four stage
    // steps per district-tier event plus season start and now: 34 positions
    // for this eight event district, a now index of 33. The by-match rows
    // appear once a rewind loads the artifacts, which the second half of this
    // test proves by watching the maximum grow. A max below the stage floor
    // would mean the timeline never built.
    expect(max, "the slider's maximum must hold every event's four stage steps").toBeGreaterThanOrEqual(4 * 8 + 1);

    const readoutBefore = (await page.getByTestId(TEST_IDS.rewindReadout).innerText()).trim();
    const target = Math.max(0, Math.floor(max / 2));
    await slider.fill(String(target));
    await expect(page.getByTestId(TEST_IDS.rewindReadout)).not.toHaveText(readoutBefore);

    // The rewind loads every started event's artifact, and the timeline
    // refines to one step per qualification match: the maximum must grow well
    // past the stage-only floor (measured live 2026-09-25: 33 became 549).
    await expect
      .poll(() => slider.getAttribute("max").then((value) => Number(value)), {
        message: "a rewind must load the event artifacts and refine the timeline to match steps",
        timeout: 30_000,
      })
      .toBeGreaterThan(50);

    // Moving it writes a shareable search param.
    await expect
      .poll(() => new URL(page.url()).searchParams.get(REWIND_PARAM), {
        message: `moving the slider must write ?${REWIND_PARAM}= into the URL`,
      })
      .not.toBeNull();
    const sharedUrl = page.url();
    const readoutAfter = (await page.getByTestId(TEST_IDS.rewindReadout).innerText()).trim();

    // Reloading that URL lands on the same position.
    await page.goto(sharedUrl);
    await expect(page.getByTestId(TEST_IDS.rewindReadout)).toHaveText(readoutAfter);
    await expect(page.getByTestId(TEST_IDS.rewind).locator('input[type="range"]')).toHaveValue(String(target));
  });

  test("a pre rename tab id still lands on the Road to District Champs panel", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    // The tab schema falls an unrecognised id back to the default, and the
    // renamed tab IS the default, so every pre-rename shared link still works.
    await page.goto(districtUrl(PRE_RENAME_TAB_ID));
    await expect(page.getByTestId(TEST_IDS.ledgerPanel)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.ledgerTab)).toBeVisible();
    // The tabs primitive keeps the inactive panel mounted, empty and hidden,
    // so the honest assertion is hidden, not absent.
    await expect(page.getByTestId(TEST_IDS.champPanel)).toBeHidden();
  });

  test("the Champ Locks panel still renders the shipped champ table, so this phase's removal is provably scoped", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(districtUrl("champ-locks"));
    // Asserted POSITIVELY by the champ tier's own test ids: a spec that
    // silently matched nothing could otherwise pass by absence alone.
    await expect(page.getByTestId(TEST_IDS.champPanel)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.champTab)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.champHeaderStatRow)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.champColumnToggle)).toBeVisible();
  });
});

test.describe("Road to District Champs, 390px", () => {
  test("the table's own region is the only horizontal scroller and the sticky Team column holds", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    // Set explicitly rather than inherited from the project. Both deployed
    // projects collect this whole file, so a test that relied on the project's
    // own viewport would run at 1440x900 under `desktop` and its overflow
    // PREMISE could be false there, which is the one thing this test must not
    // be allowed to do quietly. `phone-390` still adds the real device
    // descriptor (touch, mobile user agent, device pixel ratio) on top.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(districtUrl());
    await expect(page.getByTestId(TEST_IDS.ledgerPanel)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.ledgerTab)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.row).first()).toBeVisible();

    const region = page.locator(LEDGER_SCROLL_REGION);
    await expect(region, "the ledger's own scroll region must exist").toHaveCount(1);

    // PREMISE BEFORE CONCLUSION, unconditionally: a region that does not
    // overflow proves nothing about scroll arbitration, so the overflow is
    // asserted before the arbitration is (`no-page-pan.spec.ts`'s own rule).
    await assertOverflows(region);
    await assertNoPagePan(page);

    const measured = await region.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    // eslint-disable-next-line no-console -- printed for the SUMMARY's measured-figure obligation.
    console.log(`[districts-ledger] 390px region scrollWidth ${measured.scrollWidth} vs clientWidth ${measured.clientWidth}`);

    // The first column stays at the same viewport x after the region scrolls.
    const teamCell = page.getByTestId(TEST_IDS.teamCell).first();
    const before = await teamCell.boundingBox();
    if (before === null) throw new Error("the first Team cell has no bounding box");
    await region.evaluate((el) => {
      el.scrollLeft = el.scrollWidth - el.clientWidth;
    });
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const after = await teamCell.boundingBox();
    if (after === null) throw new Error("the first Team cell has no bounding box after the scroll");
    // eslint-disable-next-line no-console -- printed for the SUMMARY's measured-figure obligation.
    console.log(`[districts-ledger] sticky Team cell x before ${before.x}, after ${after.x}`);
    expect(after.x, "the sticky Team column must hold its viewport x while the region scrolls").toBeCloseTo(before.x, 0);

    const shotPath = testInfo.outputPath("districts-ledger-390.png");
    await page.screenshot({ path: shotPath, fullPage: true });
    // eslint-disable-next-line no-console -- the path is printed so a human can look at the image.
    console.log(`[districts-ledger] phone screenshot: ${shotPath}`);
  });
});
