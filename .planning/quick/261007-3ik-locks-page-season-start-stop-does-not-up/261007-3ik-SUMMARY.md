---
phase: quick-261007-3ik
plan: 01
quick_id: 261007-3ik
subsystem: web/locks
status: complete
tags: [locks, milestone-picker, verdict-drawer, district-ledger, champ-locks]
requires: []
provides:
  - "milestoneFocusKey(model, selection): the one rule for which event the Locks event menu shows"
  - "buildVerdictModel drops the implicit none row from rendered Playoffs and Awards lists"
  - "DistrictOutcomeList renders nothing for zero rows"
affects:
  - apps/web District Locks and Champ Locks tabs (picker menu, verdict drawer)
tech-stack:
  added: []
  patterns:
    - "Derived UI state: the picker's menu value is computed from ?at= on every render, with no local state"
    - "Display filter after aggregate: headline and tiles read every row; only the rendered list loses the implicit row"
key-files:
  created: []
  modified:
    - apps/web/src/components/districts/districtMilestones.ts
    - apps/web/src/components/districts/districtMilestones.test.ts
    - apps/web/src/components/districts/LocksMilestonePicker.tsx
    - apps/web/src/components/districts/LocksMilestonePicker.test.tsx
    - apps/web/src/components/districts/ledgerVerdict.ts
    - apps/web/src/components/districts/ledgerVerdict.test.ts
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/districts/ChampLocksLedger.test.tsx
    - apps/web/src/components/districts/DistrictOutcomeList.tsx
    - apps/web/src/components/districts/LedgerVerdictDrawer.test.tsx
decisions:
  - "The Locks event menu is derived from the selection (milestoneFocusKey), departing from sketch 024 on purpose (Jacob, 2026-10-07: the event does not update)"
  - "The Out before the top four and No award rows are removed from the rendered drawer list only; the headline and tiles still count them (Jacob, 2026-10-07)"
  - "The empty list guard lives in DistrictOutcomeList, not LedgerVerdictDrawer, because the list component owns how an outcome list looks"
metrics:
  duration: "about 25 min"
  completed: 2026-10-07
  tasks: 3
  files: 10
actuals:
  tokens: 7073
  tasks: 3
  commits: 3
---

# Quick Task 261007-3ik: the Locks menu follows Season start, and the drawers drop their implicit rows Summary

The Locks event menu is now derived from `?at=` through one pure rule, `milestoneFocusKey`, so Season start and Live move it. The picker keeps no local state. The Playoffs and Awards verdict drawers on both Locks tabs no longer list their implicit zero point row, and the headline and tiles still count that outcome. An empty outcome list renders nothing.

## How the bug was found

The orchestrator reproduced it in a headless Chromium against live data (a local `vite build` with `VITE_ARTIFACT_ORIGIN=http://localhost:4173`, served by `vite preview`, district 2026pnw, both tabs). Before the fix, clicking Season start pressed the pill, hollowed every dot, rewound the ledger (every status became In range with a chance), and the Next text read "Next: Oregon State Fair · Schedule released", while the event menu kept naming Auburn (District Locks) or DCMP (Champ Locks), the last event of the season. That is the "event does not update" Jacob saw. The sketch 024 rule "Season start and Live never move the menu" was the cause.

After the fix, the same script shows the menu reading Oregon State Fair at Season start on both tabs, and the Playoffs drawer listing Wins the event, Finalist, Third place, Fourth place only, the Awards drawer Impact and One judged award only.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | ac813908 | fix(261007-3ik): the Locks event menu follows Season start and Live, the picker keeps no state |
| 2 | 2da18fd9 | fix(261007-3ik): the Playoffs and Awards drawers drop their implicit zero point row |
| 3 | 7bfe59d3 | fix(261007-3ik): an eliminated alliance's Playoffs drawer shows no empty outcome list |

## The milestoneFocusKey rule

- A milestone or position selection shows its own event, if the model knows that event.
- Season start shows the event of the first milestone in the walk, which is the event its Next text names.
- Live shows `defaultMilestoneFocus`: the live event, otherwise the latest started event, otherwise the first event.
- These cases also fall back to `defaultMilestoneFocus`: a position with a null event key, a position whose event key the model does not know, and Season start when nothing has happened yet.

## What changed

**Task 1 (R1).**
- `milestoneFocusKey` is added and exported beside `defaultMilestoneFocus`.
- The picker lost `focusState`, `setFocusState`, the effect that synced them, the three way `focusKey` expression and the `useState`/`useEffect` imports. The menu value is now `const focusKey = milestoneFocusKey(model, selection)`.
- `handleEventChange` only calls `onAtChange` when the target is not null. A null target is a deliberate no op: the controlled select snaps back to the derived event.
- The header paragraph "THE URL IS THE ONLY SELECTION" was rewritten to the new rule and cites 261007-3ik and Jacob's 2026-10-07 report.
- New tests: unit tests on the live, finished and preseason fixtures, plus a position selection with event key `b`, null and an unknown key; the Live/Start picker test also checks that the menu reads `a` at Season start; one picker is mounted once and re-rendered through `c:awards`, Season start, Live and `c:awards`, and the menu reads c, a, b, c. A fresh mount per step would have missed the bug, because the bug was state surviving a re-render.
- RED was confirmed before the fix: 3 failures.

**Task 2 (R2).**
- In `buildVerdictModel`'s outcome branch, `top` and `chanceOfPoints` are still computed from every row. Then `shownRows` filters the `none` key, but only when `cell.cell` is `"elim"` or `"award"`, so the Alliance list keeps its Not selected row by construction.
- `districtLedgerOutcomes.ts` and `districtLedgerCopy.ts` are untouched (their `none` rows feed the unaccounted-mass diagnostic and the headline copy).
- New test: a placed sixth elim cell heads "Out before the top four in 100 of 100 runs.", with most likely "Out before the top four", chance of points "0%" and `chart.rows` equal to `[]`.
- Test pins updated in `ledgerVerdict.test.ts`, `DistrictLedger.test.tsx` (Playoffs rows winner, finalist, third, fourth; Awards rows impact, judged; rookie rows impact, rookieAllStar, judged; no `none` row and no none label in the list text) and `ChampLocksLedger.test.tsx` (the DCMP lists contain no none label).

**Task 3.**
- `DistrictOutcomeList` returns null when `rows.length === 0`: an alliance already placed fifth to eighth while the bracket runs lists only the implicit row, so its Playoffs pane is the headline and tiles alone rather than an empty labelled list.
- Two new tests in `LedgerVerdictDrawer.test.tsx`. RED was confirmed before the fix: 2 failures.

## Sweep record (R3)

**districtMilestones.ts**
- `selectionEventKey`: its only importer was the picker, so it is module private now; its doc claimed Live and Start "never move the event menu". FIXED.
- `milestoneFocusTarget` doc: "otherwise `null`, which moves the focus only" was stale. FIXED.
- `defaultMilestoneFocus` doc: "The event the menu opens on" was stale, the menu has no opening state. FIXED, behaviour unchanged.
- `walkKey`: a pure alias of `selectionKey`. Inlined at its one call site.
- File header and the "Playoffs half stop is not modelled yet" note: still accurate. LEFT.

**LocksMilestonePicker.tsx**
- Header, local state, effect, imports, `handleEventChange`: FIXED or REMOVED as above.
- `handleKeyDown`, `menuGroups`, `groupStatus`, the caption, `walkItemTitle`, `displayName`, the stop buttons: read, nothing wrong. LEFT. Every class is still a plain string, no `cn()`, no colour literal.

**ledgerVerdict.ts**
- `verdictOutcomeRows` doc said these are the rows "a cell lists", no longer exact. FIXED.
- The `top` tie break, `outcomes.rows[0]!` and `chanceOfPoints` read the unfiltered rows and stay safe. LEFT.

**DistrictOutcomeList.tsx**
- Added the zero row guard. The drawer's `.district-ledger-verdict__chart` wrapper stays in the DOM when the list is null; it is styled only `min-width: 0`, so it draws no box. LEFT.

Nothing further found in the touched files.

## Deviations from Plan

None. Each task is one commit (tests and fix together), with RED seen before each fix.

## Verification (printed results)

- `npx vitest run apps/web/src/components/districts` from the repo root, after Task 3: `Test Files  23 passed (23)`, `Tests  701 passed (701)` (699 after Task 2). The only noise was jsdom's "Not implemented: Window's scrollTo() method".
- `npx tsc --noEmit -p apps/web/tsconfig.json`: clean after each task.
- `npx tsc --noEmit` at the root: clean after each task.
- Headless browser check against live 2026pnw data after a rebuild (orchestrator): Season start moves the menu to Oregon State Fair on both tabs; Next steps to `2026orsal:schedule` with the menu staying on Oregon State Fair; the District Locks Playoffs drawer lists four rows and the Awards drawer two, neither carrying the implicit row.

## Follow ups

- **Loading cells read "not available" for about two seconds** (found in the headless check, not fixed here). After the Season start click, while the widened fetch set's event artifacts load and the as-of run has not landed, every open cell prints the unavailable word (`districtLedgerRows.ts` line 1188: an open category with no distribution yet is `kind: "unavailable"`), while the Status column and the cutoff already say Pending. Sampled at 2 s: all cells unavailable; at 4 s and after: resolved. The cell model has only `final`, `open` and `unavailable`, so a loading cell has no honest word of its own; giving it one is a new cell kind with copy, styling and tests on both tabs, not a trivial fix. Filed as a pending todo.
- Rerun the live Playwright family `apps/web/e2e/districts-ledger.spec.ts` from the main context after the next web deploy. It pins neither the menu after Season start nor any outcome row, so no edit is expected, but it only runs against sigmascout.org.
- Nothing pushed.

## Known Stubs

None.

## Threat Flags

None. `milestoneFocusKey` returns an event key only when `model.byEvent` has it (unit tested with an unknown key). `.env` was never read or touched.
