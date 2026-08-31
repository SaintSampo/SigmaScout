/**
 * SC-2's "measured and recorded" — a real Chromium, a real module Worker,
 * and real published R2 bytes through the `local-desktop` project's `/v1`
 * proxy (08-13-PLAN.md Task 3). D-07 accepted the consequence that there is
 * no committed benchmark file — runtime varies by visitor hardware and is
 * not regression-testable — so this spec's job is narrow: prove the run
 * happens end to end against real data, print the measurement, and assert
 * only its SHAPE. No assertion here is a duration bound, an upper limit, or
 * a percentile — every assertion is a shape/finiteness/ordering check. Do
 * NOT add a runtime threshold as a later "improvement": a bound here would
 * either flake on a slower machine than this one, or be read as a
 * performance guarantee this project has not earned. Neither outcome is
 * better than having no bound at all.
 *
 * **Measurement event: `2023cur` (2023 Sacramento Regional).** Chosen from
 * 08-05-SUMMARY.md's verified RP-eligible/pmf-publishing census, confirmed
 * live against the real artifact origin before this spec was written
 * (`https://data.sigmascout.org/v1/event/2023cur/vpr@2.1.0+tuned-2026-08.json`,
 * 2026-08-31): 78 teams (the corpus's measured maximum roster) and 130
 * played qualification rows, every one of the 130 carrying both
 * `redRpPmf`/`blueRpPmf`. The event is fully played (`upcoming: []`), so no
 * row is pre-selected by default (D-01) — this spec selects the FIRST
 * qualification row explicitly, leaving all 130 matches remaining, which is
 * both the heaviest reachable case at this event and the most representative
 * one (a reader most often starts a simulation from the very beginning of a
 * finished event's schedule). The next person re-measuring should reproduce
 * this exact run, not a different one.
 */
import { test, expect } from "@playwright/test";

const EVENT_KEY = "2023cur";
const EVENT_URL = `/event/${EVENT_KEY}?algorithm=vpr&tab=simulation`;
const FIRST_QUAL_MATCH_KEY = `${EVENT_KEY}_qm1`;

// Literal testids/labels, matching `RunControl.tsx`'s/`StartMatchPicker.tsx`'s
// exported constants byte-for-byte (an e2e spec does not import app source —
// see `event-page.spec.ts`'s own precedent — so these must be kept in sync by
// hand with `RUN_CONTROL_TESTID`/`RUN_LABEL_IDLE`/`START_MATCH_ROW_TESTID_PREFIX`).
const RUN_CONTROL_TESTID = "run-control";
const RUN_LABEL_IDLE = "Run simulation";
const START_MATCH_ROW_TESTID = `start-match-row-${FIRST_QUAL_MATCH_KEY}`;

test.describe("SC-2 measurement — 2023cur, real Worker, real published bytes", () => {
  test("a full round trip from the first qualification match prints a shape-only, real-browser measurement", async ({ page, browserName }) => {
    await page.goto(EVENT_URL);

    const firstRow = page.getByTestId(START_MATCH_ROW_TESTID);
    await expect(firstRow).toBeVisible({ timeout: 15_000 });
    await firstRow.click();

    const runButton = page.getByRole("button", { name: RUN_LABEL_IDLE });
    await expect(runButton).toBeEnabled();
    await runButton.click();

    // The completion sentence's paragraph is the only element in the region
    // carrying `data-elapsed-ms` — waiting on that attribute's presence is
    // waiting on the run's terminal message, not on a fixed sleep.
    const completionLine = page.locator(`[data-testid="${RUN_CONTROL_TESTID}"] [data-elapsed-ms]`);
    await expect(completionLine).toBeVisible({ timeout: 30_000 });

    const completionText = (await completionLine.textContent())?.trim() ?? "";
    // Shape only: the fixed prefix, a numeric or bound elapsed figure, one
    // decimal or the "<0.1" bound, and the trailing "s" (PD-04's recorded
    // one-word Copywriting Contract deviation — "draws", not "matches").
    expect(completionText).toMatch(/^Simulated \d+ draws in (<0\.1|\d+\.\d)s$/);

    const elapsedMsAttr = await completionLine.getAttribute("data-elapsed-ms");
    const computeMsAttr = await completionLine.getAttribute("data-compute-ms");
    const teamCountAttr = await completionLine.getAttribute("data-team-count");
    const remainingMatchesAttr = await completionLine.getAttribute("data-remaining-matches");

    const elapsedMs = Number(elapsedMsAttr);
    const computeMs = Number(computeMsAttr);
    const teamCount = Number(teamCountAttr);
    const remainingMatches = Number(remainingMatchesAttr);

    expect(Number.isFinite(elapsedMs)).toBe(true);
    expect(elapsedMs).toBeGreaterThan(0);
    expect(Number.isFinite(computeMs)).toBe(true);
    expect(computeMs).toBeGreaterThan(0);
    // The split this measurement exists to make visible (08-07's PD-05):
    // computeMs is the draw loop alone, elapsedMs also spans Worker
    // construction and the structured-clone transfer, so computeMs can never
    // exceed elapsedMs.
    expect(computeMs).toBeLessThanOrEqual(elapsedMs);
    expect(Number.isInteger(teamCount)).toBe(true);
    expect(teamCount).toBeGreaterThan(0);
    expect(Number.isInteger(remainingMatches)).toBe(true);
    expect(remainingMatches).toBeGreaterThan(0);

    // No progress bar survives to the completed state.
    await expect(page.getByRole("progressbar")).toHaveCount(0);

    const version = page.context().browser()?.version() ?? "unknown";

    // Printed for transcription into the phase SUMMARY (SC-2's only durable
    // "recorded" home — no committed benchmark file exists, per D-07's
    // accepted consequence). This is the whole reason this spec prints
    // rather than only asserting.
    // eslint-disable-next-line no-console
    console.log(
      `[SC-2 measurement] event=${EVENT_KEY} season=2023 teamCount=${teamCount} remainingMatches=${remainingMatches} ` +
        `elapsedMs=${elapsedMs} computeMs=${computeMs} sentence="${completionText}" browser=${browserName}/${version} os=${process.platform}`
    );
  });
});
