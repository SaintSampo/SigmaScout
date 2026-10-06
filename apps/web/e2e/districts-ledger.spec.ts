import { test, expect } from "@playwright/test";
import { assertNoPagePan, assertOverflows } from "./support/scrollRegions.js";

/**
 * The District Locks tab (phase 10), at 1440x900 and at 390px.
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

/**
 * Locked out on the Live view. Since quick task 261005-04t the Live view of a
 * district whose championship has started shows its FIELD, and on `2026pnw`
 * that reads 76 Locked out and no Declined team, measured on the committed
 * fixture with a finished state on every row and on the live 2026 artifacts.
 */
const LOCKED_OUT_COUNT = 76;

/**
 * A district whose Live view shows Declined teams (quick task 261005-04t,
 * D-06), measured twice on 2026-10-05 (the live artifacts and the local
 * corpus): 100 Locked, 8 Declined, 92 Locked out. Locked equals its slot count.
 */
const DECLINED_DISTRICT_KEY = "2026ne";
const DECLINED_DISTRICT_LOCKED = 100;
const DECLINED_DISTRICT_DECLINED = 8;
const DECLINED_DISTRICT_LOCKED_OUT = 92;

/**
 * The Declined definition line, transcribed from `districtLedgerCopy.ts`'s
 * `DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.declined` as of 2026-10-05.
 */
const DECLINED_DEFINITION = "earned a place at the District Championship and is not in its field";

/**
 * Test ids, transcribed by hand from shipped source (an e2e spec does not
 * import app source). Each comment names the file and the line the literal
 * was grepped out of, as of 2026-09-25.
 */
const TEST_IDS = {
  /** `routes/districts.tsx:228` — the District Locks `TabsContent`. */
  ledgerPanel: "road-to-district-champs-panel",
  /** `routes/districts.tsx:231` — the Champ Locks `TabsContent`, the scoped removal control. */
  champPanel: "champ-locks-panel",
  /** `DistrictLedger.tsx:686` — the tab's own root. */
  ledgerTab: "district-ledger-tab",
  /** `DistrictLedger.tsx:477` — the one controls card. */
  controls: "district-ledger-controls",
  /** `LocksMilestonePicker.tsx:156` — the milestone picker's root, which keeps the old rewind control's id. */
  rewind: "district-ledger-rewind",
  /** `LocksMilestonePicker.tsx:164` — the event menu, a native select whose value is an event key. */
  pickerEvent: "locks-picker-event",
  /** `LocksMilestonePicker.tsx:182` — the Season start pill; carries `aria-pressed`. */
  pickerSeasonStart: "locks-picker-season-start",
  /** `LocksMilestonePicker.tsx:191` — the Live pill; carries `aria-pressed`. */
  pickerLive: "locks-picker-live",
  /** `LocksMilestonePicker.tsx:244` — the previous milestone arrow. */
  pickerPrev: "locks-picker-prev",
  /** `LocksMilestonePicker.tsx:258` — the next milestone arrow. */
  pickerNext: "locks-picker-next",
  /** `LocksMilestonePicker.tsx:269` — the text beside the arrows naming the next stop. */
  pickerNextText: "locks-picker-next-text",
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
  /** `ChampLocksLedger.tsx`'s own root — the sketch 022 ledger, which replaced the pre phase 10 champ table on 2026-09-26. */
  champLedgerTab: "champ-ledger-tab",
  /** `ChampLocksLedger.tsx`'s one controls card. */
  champControls: "district-ledger-controls",
  /** `ChampLocksLedger.tsx`'s five status chips. */
  champStatusChips: "district-ledger-status-chips",
  /** `ChampLocksLedger.tsx`'s table row; carries `data-team` and `data-row`, two per team. */
  champRow: "champ-ledger-row",
  /** `LedgerParts.tsx`'s `ControlsCard` stat line, shared by BOTH tabs. */
  statLine: "district-ledger-stat-line",
} as const;

/**
 * The cutoff's four labels, transcribed from
 * `districtLedgerCopy.ts`'s `DISTRICT_LEDGER_CUTOFF_LABELS` as of 2026-09-26
 * (quick task 260926-37q). The stat line prints exactly one of them.
 */
const CUTOFF_LABELS = {
  predicted: "Predicted cutoff",
  predictedDistrictOnly: "Predicted cutoff (district only)",
  settled: "Cutoff",
  capacityUnknown: "Capacity not published",
} as const;

/**
 * The RETIRED wording, for one assertion: no rendered text on either tab still
 * carries it. It was the stat line's own label and the grand total plot's
 * marker label in `districtLedgerCopy.ts`, both deleted by quick task
 * 260926-37q.
 *
 * ASSEMBLED FROM PARTS rather than typed, so the repo wide grep that enforces
 * the retirement stays clean — the same device, and the same reason,
 * `DistrictLedger.test.tsx` uses to name the plus minus without typing it.
 */
const RETIRED_CUTOFF_WORDING = ["Today", String.fromCharCode(0x27), "s line"].join("");

/**
 * The five `data-status` values the chips carry, in render order.
 * `districtLedgerStatus.ts:47`'s `DISTRICT_LEDGER_STATUS_KEYS`.
 */
const STATUS_KEYS = ["prequalified", "locked", "inRange", "outOfRange", "lockedOut"] as const;

/**
 * The sixth chip's `data-status` (quick task 261005-04t). It renders only on
 * the Live view of a district whose championship has started, and only where
 * at least one team reads Declined, between Locked and In range.
 */
const DECLINED_STATUS = "declined";

/** The PRE RENAME first tab id, retired in phase 10. `searchParams.ts:315`'s own rename note names it. */
const PRE_RENAME_TAB_ID = "district-locks";

/** The Rewind position search param. `searchParams.ts:358`. */
const REWIND_PARAM = "at";

/** The plus minus sign, which must never render on this tab (10-CONTEXT.md, locked). */
const PLUS_MINUS = "±";

function districtUrl(tab?: string, districtKey: string = DISTRICT_KEY): string {
  const base = `/districts?year=${SEASON}&district=${districtKey}`;
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

test.describe("District Locks, 1440x900", () => {
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

    // The five chips, each with a count, and a sixth, Declined, only where
    // some team reads Declined (quick task 261005-04t).
    await expect(page.getByTestId(TEST_IDS.statusChips)).toBeVisible();
    const chipTotal = await page.getByTestId(TEST_IDS.statusChip).count();
    expect([STATUS_KEYS.length, STATUS_KEYS.length + 1], "the chip row holds five chips, or six with Declined").toContain(chipTotal);
    const counts: Record<string, number> = {};
    for (const status of STATUS_KEYS) counts[status] = await chipCount(page, status);
    const declinedChip = page.locator(`[data-testid="${TEST_IDS.statusChip}"][data-status="${DECLINED_STATUS}"]`);
    const declinedPresent = (await declinedChip.count()) > 0;
    if (declinedPresent) counts[DECLINED_STATUS] = await chipCount(page, DECLINED_STATUS);
    expect(declinedPresent, "a sixth chip must be the Declined chip").toBe(chipTotal === STATUS_KEYS.length + 1);
    // eslint-disable-next-line no-console -- printed for the SUMMARY's measured-figure obligation.
    console.log(`[districts-ledger] chip counts: ${JSON.stringify(counts)}`);

    // A FAILURE ON ANY PIN BELOW MEANS THE PUBLISHED VERDICTS MOVED. That is a
    // finding to triage against the artifact, never a number to soften here.
    const total = [...STATUS_KEYS, DECLINED_STATUS].reduce((sum, status) => sum + (counts[status] ?? 0), 0);
    expect(total, "the chip counts must account for the whole district roster").toBe(ROSTER_SIZE);
    if (declinedPresent) expect(counts[DECLINED_STATUS], "a Declined chip renders only where some team reads Declined").toBeGreaterThanOrEqual(1);
    expect(counts["prequalified"], "prequalified count").toBe(PREQUALIFIED_COUNT);
    expect(counts["locked"], "locked count, which includes the lockedAward variant").toBe(LOCKED_COUNT);
    expect(counts["lockedOut"], "locked out count on the Live view, which shows the District Championship field").toBe(LOCKED_OUT_COUNT);
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

    /**
     * THE PREDICTED CUTOFF, on the stat line (quick task 260926-37q).
     *
     * `2026pnw` is finished, so the SETTLED label is the reading here: every
     * team still racing for points is done, the figure carries no tilde and
     * no likely range sits beside it. The retired wording must appear nowhere
     * on the page at all.
     */
    const districtStatLine = page.getByTestId(TEST_IDS.statLine);
    await expect(districtStatLine).toBeVisible();
    const districtStatText = (await districtStatLine.innerText()).trim();
    // eslint-disable-next-line no-console -- printed for the SUMMARY's measured-figure obligation.
    console.log(`[districts-ledger] district stat line: ${districtStatText}`);
    expect(
      Object.values(CUTOFF_LABELS).some((label) => districtStatText.includes(label)),
      `the District Locks stat line "${districtStatText}" must carry one of the cutoff labels`
    ).toBe(true);
    expect(districtStatText, "a finished district's cutoff is settled, so it carries no tilde").not.toContain("~");
    expect(await page.locator("body").innerText()).not.toContain(RETIRED_CUTOFF_WORDING);

    // Never a plus minus anywhere inside the table's scroll region.
    const regionText = await page.locator(LEDGER_SCROLL_REGION).innerText();
    expect(regionText, "the ledger's scroll region must never print a plus minus sign").not.toContain(PLUS_MINUS);

    const shotPath = testInfo.outputPath("districts-ledger-1440x900.png");
    await page.screenshot({ path: shotPath, fullPage: true });
    // eslint-disable-next-line no-console -- the path is printed so a human can look at the image.
    console.log(`[districts-ledger] desktop screenshot: ${shotPath}`);
  });

  test("the milestone picker walks the district's timeline and its position is shareable", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(districtUrl());
    const picker = page.getByTestId(TEST_IDS.rewind);
    await expect(picker).toBeVisible();
    // The old range input is gone for good.
    await expect(picker.locator("input[type=range]")).toHaveCount(0);
    // The stops carry `data-milestone`; exactly eight per event (sketch 024 Q, less its Playoffs half stop).
    const stops = picker.locator("[data-milestone]");
    await expect(stops).toHaveCount(8);
    const pressedStops = picker.locator('[data-milestone][aria-pressed="true"]');

    // At the district URL the page is live.
    await expect(page.getByTestId(TEST_IDS.pickerLive)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(TEST_IDS.pickerNextText)).toHaveText("This is live");

    // One step back from Live lands on the district's latest milestone.
    await page.getByTestId(TEST_IDS.pickerPrev).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get(REWIND_PARAM), {
        message: `stepping back must write ?${REWIND_PARAM}= into the URL`,
      })
      .not.toBeNull();
    await expect(pressedStops).toHaveCount(1);
    await expect(page.getByTestId(TEST_IDS.pickerLive)).toHaveAttribute("aria-pressed", "false");

    // And one more.
    const firstAt = new URL(page.url()).searchParams.get(REWIND_PARAM);
    await page.getByTestId(TEST_IDS.pickerPrev).click();
    await expect.poll(() => new URL(page.url()).searchParams.get(REWIND_PARAM)).not.toBe(firstAt);
    await expect(pressedStops).toHaveCount(1);
    const sharedUrl = page.url();
    const pressedKey = await pressedStops.getAttribute("data-milestone");
    const eventKey = await page.getByTestId(TEST_IDS.pickerEvent).inputValue();
    // eslint-disable-next-line no-console -- printed so a failed reload names what it expected.
    console.log(`[districts-ledger] shared milestone: ${String(pressedKey)} of ${eventKey} (${sharedUrl})`);

    // Reloading that URL lands on the same event and the same stop. The rewind
    // loads the started events' artifacts first, so this polls.
    await page.goto(sharedUrl);
    await expect
      .poll(
        async () => {
          const key = await page.getByTestId(TEST_IDS.rewind).locator('[data-milestone][aria-pressed="true"]').getAttribute("data-milestone", { timeout: 1_000 }).catch(() => null);
          const value = await page.getByTestId(TEST_IDS.pickerEvent).inputValue({ timeout: 1_000 }).catch(() => null);
          return `${String(key)} of ${String(value)}`;
        },
        { message: "a shared milestone link must reopen on the same event and the same stop", timeout: 30_000 },
      )
      .toBe(`${String(pressedKey)} of ${eventKey}`);
    await expect(page.getByTestId(TEST_IDS.pickerLive)).toHaveAttribute("aria-pressed", "false");

    // THE HEADLINE NEVER SITS OUTSIDE ITS OWN RANGE (quick task 261004-uw4).
    // At this rewound position a race is open again, so the cutoff is the
    // median of the simulated line and its likely range comes from the same
    // call. Measured live on 2026-10-04, before the fix, the figure sat BELOW
    // its printed range at 8 of 22 rewound positions ("~56 · likely 59–64").
    // The runs land a moment after the rows do, so this waits out "pending".
    const rewoundStatLine = page.getByTestId(TEST_IDS.statLine);
    await expect
      .poll(async () => (await rewoundStatLine.innerText()).trim(), {
        message: "the rewound stat line must leave pending: a figure, a settled cutoff, or not available with its reason",
        timeout: 60_000,
      })
      .not.toContain("pending");
    const rewoundStat = (await rewoundStatLine.innerText()).trim();
    // eslint-disable-next-line no-console -- printed so a failure names the stat line it read.
    console.log(`[districts-ledger] rewound stat line: ${rewoundStat}`);
    // An en dash separates the two ends of the likely range.
    const figureWithRange = /~(\d+)\s*·\s*likely\s+(\d+)–(\d+)/.exec(rewoundStat);
    if (figureWithRange !== null) {
      const [figure, low, high] = [Number(figureWithRange[1]), Number(figureWithRange[2]), Number(figureWithRange[3])];
      expect(low, `the predicted cutoff sits below its own likely range: "${rewoundStat}"`).toBeLessThanOrEqual(figure);
      expect(figure, `the predicted cutoff sits above its own likely range: "${rewoundStat}"`).toBeLessThanOrEqual(high);
    }
    // A refused run prints no figure at all, never a figure beside its refusal.
    expect(/~\d/.test(rewoundStat) && rewoundStat.includes("not available"), `a figure printed beside a refusal: "${rewoundStat}"`).toBe(false);
  });

  test("Season start reads nobody Locked and nobody Locked out", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(districtUrl());
    await expect(page.getByTestId(TEST_IDS.ledgerTab)).toBeVisible();
    await page.getByTestId(TEST_IDS.pickerSeasonStart).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get(REWIND_PARAM), {
        message: `pressing Season start must write ?${REWIND_PARAM}= into the URL`,
      })
      .not.toBeNull();
    await expect(page.getByTestId(TEST_IDS.pickerSeasonStart)).toHaveAttribute("aria-pressed", "true");

    // ONLY these two chips are read here: In range and Out of range can read
    // Pending with no count while the runs are in flight.
    const message =
      "the shipped floor read 2 Locked here on the committed fixture because it counted District Championship points (quick task 261005-04t); a failure is a finding to triage against the artifact, never a number to soften";
    await expect.poll(() => chipCount(page, "locked"), { message: `Locked at Season start: ${message}`, timeout: 30_000 }).toBe(0);
    await expect.poll(() => chipCount(page, "lockedOut"), { message: `Locked out at Season start: ${message}`, timeout: 30_000 }).toBe(0);
    await expect(
      page.locator(`[data-testid="${TEST_IDS.statusChip}"][data-status="${DECLINED_STATUS}"]`),
      "a rewound view never shows the District Championship field, so no Declined chip"
    ).toHaveCount(0);
  });

  test("the Live view of a district where some team declined its place shows Declined", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(districtUrl(undefined, DECLINED_DISTRICT_KEY));
    await expect(page.getByTestId(TEST_IDS.ledgerTab)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.pickerLive)).toHaveAttribute("aria-pressed", "true");

    const message = "Locked equal to the slot count is the check that the overlay finds the real field";
    await expect
      .poll(() => chipCount(page, "locked"), { message: `${DECLINED_DISTRICT_KEY} Locked at Live: ${message}`, timeout: 30_000 })
      .toBe(DECLINED_DISTRICT_LOCKED);
    expect(await chipCount(page, DECLINED_STATUS), `${DECLINED_DISTRICT_KEY} Declined at Live: ${message}`).toBe(DECLINED_DISTRICT_DECLINED);
    expect(await chipCount(page, "lockedOut"), `${DECLINED_DISTRICT_KEY} Locked out at Live: ${message}`).toBe(DECLINED_DISTRICT_LOCKED_OUT);

    const definition = page.locator(`[id="district-ledger-status-definition-${DECLINED_STATUS}"]`);
    await expect(definition, "the Declined chip carries its own definition line").toBeVisible();
    await expect(definition).toContainText(DECLINED_DEFINITION);
  });

  test("a pre rename tab id still lands on the District Locks panel", async ({ page }) => {
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

  test("the Champ Locks panel renders the two row ledger, so the replacement is provably scoped", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(districtUrl("champ-locks"));
    // Asserted POSITIVELY by the champ tier's own test ids: a spec that
    // silently matched nothing could otherwise pass by absence alone.
    await expect(page.getByTestId(TEST_IDS.champPanel)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.champLedgerTab)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.champControls)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.champStatusChips)).toBeVisible();
    // TWO rows per team, so a count of one would mean the fold collapsed.
    const rows = page.getByTestId(TEST_IDS.champRow);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(1);

    // THE CUTOFF, on this tab's own stat line. `2026pnw` is finished, so the
    // settled label is the expected reading; the assertion accepts any of the
    // four so a rerun mid season is a finding rather than a red spec.
    const statLine = page.getByTestId(TEST_IDS.statLine);
    await expect(statLine).toBeVisible();
    const champStat = (await statLine.innerText()).trim();
    expect(
      Object.values(CUTOFF_LABELS).some((label) => champStat.includes(label)),
      `the Champ Locks stat line "${champStat}" must carry one of the cutoff labels`
    ).toBe(true);
    expect(await page.locator("body").innerText()).not.toContain(RETIRED_CUTOFF_WORDING);
  });
});

test.describe("District Locks, 390px", () => {
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
