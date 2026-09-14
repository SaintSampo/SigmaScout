---
quick_id: 260914-liz
slug: resolve-todo-e2e-suite-stale-against-liv
date: 2026-09-14
status: complete
resolves_todo: e2e-suite-stale-against-live-site
commits:
  - 69f88405 deep-link headings (no em dash)
  - 1587d928 static-shell wordmark is the ΣigmaScout home link
  - 244ffcf7 2024vabrb blank empty cells, hidden backup column
  - d1ef5970 2022ilpe round label read from the /match/ link
  - 74f89bda delete the alliance-uncertainty-gap test (premise withdrawn)
  - 519e1c12 tab strip wraps instead of scrolling; Breakdown 6 columns; Actual RP header; tab-strip-alignment spec deleted
  - 7409de60 table-layout-quality honours the recorded Total ± Sigma overflow decision
  - 3f015c47 deep-link week shows as Week 4 (zero-indexed), district as New England
---

# 260914-liz: the e2e suite passes against the live site again

This resolves the todo `e2e-suite-stale-against-live-site`, scoped to exactly its listed failures, as the user instructed.

## Result

- **Before:** against the deploy of 530fba08, the four deployed Playwright projects (desktop, iphone-17, pixel-10, phone-390) had 40 failures and 147 passes.
- **After:** **170 passed, 0 failed**. Web tsc has 0 errors.
- **Changed files:** only `apps/web/e2e/*` and `apps/web/playwright.config.ts`. No site code changed, so no deploy was needed.
- **Verdicts:** every failure was either a stale spec or a check whose premise no longer exists. None was a site regression.

## Stale specs, updated to the deliberate current UI

- **Em dashes removed from headings (ed49b8a0):** `Teams 2022` and `Events 2025`. The same commit made empty alliance cells blank. 834d27b2 hides the backup column when no alliance has one.
- **Pine redesign (40618556):** the banner wordmark is the `ΣigmaScout` home link.
- **Round labels (9000521b):** the round label is a `/match/` link. The 2022ilpe spec had been reading the first span, which is a team number since the column reorder 21703441. That reorder also renamed the Quals header to `Actual RP`.
- **Tabs:** Elims is now Playoffs (ed49b8a0), and Qualifications was added (3f160098).
- **SPR Breakdown (a013ca1e):** 6 columns (Team #, Team Name, Total and three phases), not 16.
- **Events deep link:**
  - `week=3` is TBA's zero-indexed week, shown as `Week 4` (38bb434d).
  - `ne` is shown as `New England` (275de709).
  - The REVERSE test's negative checks had been vacuous; they now test the right text.
- **Total ± Sigma pill:** on phone-width tables it is 154px and only partly visible before scrolling. That was a recorded decision (9bf8829d, "the developer chose to leave the overflow"). The check now passes when the pill's Total half is fully visible, and still requires a whole data column elsewhere. It was applied to Insights and Breakdown too, since they use the same component.

## Premise gone, so the checks were deleted

- **Tab-strip scrolling:** Jacob asked for the event tab strip to stop scrolling (3df8e116), and it now wraps. Removed:
  - the strip-drag tests;
  - the Simulation table-drag test, since the rank table never scrolls horizontally per 855741c1;
  - the whole `tab-strip-alignment.spec.ts`.

  The tab-count test now asserts the strip does not overflow, and the trigger-sizing test compares gaps only within one line.
- **Alliance-uncertainty gap:** the "gap narrows across an event" test compared `spread` with `redScoreVarianceOwn`. 06c65a40 withdrew any identity between those fields, and neither is drawn on the site. The model makes no narrowing claim; under SPR the gap widens (8.95 to 12.58), consistent with `displaySdFactor`.

## Playwright listing

`playwright test --list` went from 304 tests in 20 files to 279 tests in 19 files. All removals are the deliberate deletions above, counted across projects including local-phone-390.
