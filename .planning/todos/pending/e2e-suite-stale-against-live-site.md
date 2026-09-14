---
id: e2e-suite-stale-against-live-site
created: 2026-09-14
source: quick task 260914-j0n (live e2e run after retiring the vpr id from the specs)
priority: medium
---

# The Playwright e2e suite is stale against the deployed site

The e2e specs assert against https://sigmascout.org only and are not run in CI, so UI changes drift past them unnoticed.
260914-j0n retired the `vpr` id from every spec (the premier id since 2026-09-12 is `spr`), which fixed 3 of the desktop failures.
It then ran the suite against production on 2026-09-14 (logs: that session's scratchpad `j0n-strings/logs/e2e-after-*.txt`).

- **desktop:** 29 passed, 8 failed.
- **iphone-17, pixel-10 and phone-390:** 118 passed, 32 failed. The failures are the same 9 specs on phone-390 and pixel-10; iphone-17 had none.

Triage each one as either a stale spec (update the spec to the current UI) or a real regression (fix the site). Do not update an assertion just to make it pass.

## Desktop failures

1. **`deep-link.spec.ts` :37, :63, :93, :115:** they expect the h1 to be `Teams — 2022` or `Events — 2025`. The live site renders `Teams 2022` and `Events 2025`, so the em dash was removed. Probably a stale spec.
2. **`static-shell.spec.ts:41`:** it expects `getByRole('banner').getByText('SigmaScout')` to have count 1 and gets 0. The wordmark text is no longer in the banner, possibly an image logo since the Pine redesign. Check whether the banner still has an accessible name.
3. **`event-live-artifact.spec.ts:79` (2024vabrb):** it expects an empty Pick 3 or Backup cell to render `—` and receives `""`. Check AlliancesTab's empty-cell rule and its unit tests.
4. **`event-live-artifact.spec.ts:318` (2022ilpe):** the row count is right (18). The spec reads the first `span` of each row, which after the match-table column reorder (21703441) is a team number, not the round label. Stale selector.
5. **`event-live-artifact.spec.ts:187` (alliance-uncertainty gap):** the first half is 8.95 and the second half 12.58 over 48/51 pairs, so under SPR the gap widens instead of narrowing. This was a model property measured on VPR. After the Match Band redefinition (260913-g66), decide whether the claim still belongs in the suite. It needs a model decision, not a spec edit.

## Phone failures (phone-390 and pixel-10)

- **`event-scroll-regions.spec.ts`:**
  - :84 (E5 Quals at phone width)
  - :199 and :232 (sibling scroll regions: tab-strip and table drags, all tabs)
  - :335 (E4, expects 16 Breakdown header columns)
  - :375 (E2, expects exactly 6 tabs in declared order)
  - :420 (E2, Simulation trigger at the strip's right end)
- **`tab-strip-alignment.spec.ts:21`:** start-aligns while overflowing.
- **`tab-strip-trigger-sizing.spec.ts:43`:** trigger label overflow and uniform gap.
- **`table-layout-quality.spec.ts:316`:** at least one full data column visible at scroll 0, for Insights 2023cur, Breakdown 2024new and TeamsTable 2024.

Many of these hinge on the event tab strip: the tab count, whether it still overflows at phone width, and its alignment. Check the current tab set first, since one change there likely explains most of them.

## Done when

- All four deployed projects pass against production, or each remaining failure is a named, fixed site bug.
- Consider a CI or post-deploy smoke job so this does not drift again.
