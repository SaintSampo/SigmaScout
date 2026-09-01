import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * The one driver that takes a Playwright page from an event URL to a
 * completed simulation (08-15-PLAN.md Task 1) — open the Simulation tab,
 * select a start match, press Run, wait for completion, return the measured
 * elapsed. Used by both `simulation-tab.spec.ts` and
 * `event-scroll-regions.spec.ts` so the two specs cannot diverge in what "a
 * completed run" means.
 *
 * Every literal here is read out of shipped source and paired with a grep
 * proving it appears verbatim in the component that renders it — see this
 * plan's Task 1 acceptance criteria. This module carries no `.spec.`
 * segment in its filename, so it matches no project's `testMatch` and is
 * never collected as a test itself.
 */

/**
 * The literals this driver and its two consumer specs need, read out of
 * `SimulationTab.tsx`, `StartMatchPicker.tsx`, `RunControl.tsx` and
 * `RankDistributionTable.tsx` — an e2e spec does not import app source
 * (`simulation-run.spec.ts`'s own established precedent), so these are kept
 * in sync by hand with the exported constants of the same name.
 */
export const SIMULATION_TEST_IDS = Object.freeze({
  /** `SimulationTab.tsx`'s `SIMULATION_STACK_TESTID`. */
  stack: "simulation-stack",
  /** `SimulationTab.tsx`'s `SIMULATION_PRE_RUN_TESTID`. */
  preRun: "simulation-pre-run",
  /** `StartMatchPicker.tsx`'s `START_MATCH_PICKER_TESTID`. */
  picker: "start-match-picker",
  /** `StartMatchPicker.tsx`'s `START_MATCH_ROW_TESTID_PREFIX`. */
  rowPrefix: "start-match-row-",
  /** `RunControl.tsx`'s `RUN_CONTROL_TESTID`. */
  runControl: "run-control",
  /** `RunControl.tsx`'s `RUN_LABEL_IDLE`. */
  runLabelIdle: "Run simulation",
  /** `RankDistributionTable.tsx`'s own scroll-region testid. */
  rankTableScroll: "rank-distribution-table-scroll",
  /** `RankDistributionTable.tsx`'s per-row testid. */
  rankRow: "rank-distribution-row",
} as const);

/** Navigates to `/event/{eventKey}?algorithm=vpr&tab=simulation` (D-04 makes the tab VPR-only — any other algorithm lands on a disabled trigger) and waits for the layout stack to be visible. */
export async function openSimulationTab(page: Page, eventKey: string): Promise<void> {
  await page.goto(`/event/${eventKey}?algorithm=vpr&tab=simulation`, { waitUntil: "networkidle" });
  await page.getByTestId(SIMULATION_TEST_IDS.stack).waitFor({ state: "visible", timeout: 15_000 });
}

/** Clicks the picker row at a zero-based `index` (in the picker's own rendered order) and asserts exactly one row ends up in the selected state. */
export async function selectStartMatch(page: Page, index: number): Promise<void> {
  const rows = page.locator(`[data-testid^="${SIMULATION_TEST_IDS.rowPrefix}"]`);
  await rows.nth(index).click();
  await expect(page.locator('[data-selected="true"]')).toHaveCount(1);
}

/**
 * Records `Date.now()`, presses the run control, waits for its completion
 * state with a timeout generous enough for the phase's worst case (78 teams
 * x 130 remaining matches x 1000 draws), records `Date.now()` again and
 * returns the elapsed milliseconds — the wall-clock the caller can print
 * beside the event key, roster size and remaining-match count.
 */
export async function runSimulation(page: Page): Promise<number> {
  const started = Date.now();
  await page.getByRole("button", { name: SIMULATION_TEST_IDS.runLabelIdle }).click();
  const completionLine = page.locator(`[data-testid="${SIMULATION_TEST_IDS.runControl}"] [data-elapsed-ms]`);
  await expect(completionLine).toBeVisible({ timeout: 60_000 });
  return Date.now() - started;
}
