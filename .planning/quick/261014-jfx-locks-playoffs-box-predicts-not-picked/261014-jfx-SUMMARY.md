---
phase: quick-261014-jfx
plan: 01
subsystem: locks-ui
tags: [district-locks, champ-locks, playoffs-cell, not-picked, display-only]
requires: [quick-261014-i1c]
provides: [playoffs-cell-route-view, not-picked-best-guess, playoffs-drawer-best-guess-tile]
affects: [districtLedgerRows, districtLedgerOutcomes, districtLedgerCopy, ledgerVerdict, methodology]
key-files:
  modified:
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerOutcomes.ts
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/ledgerVerdict.ts
    - apps/web/src/components/districts/LedgerParts.tsx
    - apps/web/src/components/methodology/districtLedgerContent.ts
key-decisions:
  - "Not picked shows only when strictly more than half of the runs left the team off every alliance; it is not a fifth bucket in the plain contest"
  - "Small line reads N% on an alliance (any alliance, captains included), printed as 100 minus the headline run count, floored at <1%"
  - "Playoffs drawer tile reads best guess; Awards and Alliance selection keep most likely"
  - "Legend tilde means this site's prediction, not only predicted points"
  - "One selectionRouteViewFor helper builds the route view for the Alliance selection and Playoffs cells"
status: complete
actuals:
  tasks: 3
  commits: 4
---

# Quick 261014-jfx: Locks Playoffs box predicts not picked

Display only. An open Playoffs cell whose run reported its alliance routes reads `~not picked` over `N% on an alliance` when the runs left the team off every alliance in more than half of them. Jacob saw 6932 at 2026 UNC Asheville read `~5th to 8th` over `99% · pays 0` while it most likely made no alliance; it now reads `~not picked` over `2% on an alliance`, and its drawer reads `Not picked in 98 of 100 runs.`

## Jacob's decisions (2026-10-14)
1. Wording `~not picked` (picked over long shot, after picks, and leading with the chance).
2. Legend `~ = this site's prediction`.
3. Not picked only when more likely than not (strictly above half). A plain most runs contest would have shown `~not picked` for a team picked in 60% of runs.
4. Small line word `on an alliance` (the Alliance selection cell's `picked` excludes captains, so `picked` would have clashed with `2% captain` beside it).
5. Floor at `<1%`: once quals end the simulated draft is the same in every run, so a team it leaves out read `0% on an alliance`, and 6932 was in fact picked.

## Planner choices
1. One helper, `selectionRouteViewFor`, builds the route view; the Alliance selection cell and the open Playoffs cell both carry it under `selection`, each with its own denominator.
2. The 5th to 8th share is exact: only alliance members are paid while the cell is open (proved by the simulation's observer: 3,200 unpicked team draws, all elim 0). A clamp keeps rows summing to the mass and could only overstate not picked if a future simulation modelled a backup call.
3. `districtPlayoffOutcomes` takes an optional route view; with it a `notPicked` row is appended and `none` means picked but out. Both zero point rows stay hidden from the drawer list. A milestone, or a secured figure above zero, rules not picked out.
4. No route view means no change: an event priced before it started (baked sidecar), the Champ Locks simulated DCMP, a finals shifted cell and the District points row. The methodology says so. Found, not built: a baked event's Alliance selection pmf mass at 0 equals its not selected share, so those events could be split too.

## Commits
- 578a5410 feat: the Locks Playoffs cell names not picked from the run's own alliance routes
- 3ab7d444 feat: the Playoffs drawer names not picked with the cell
- 9d39bb4c docs: the legend tilde means this site's prediction, and the methodology names not picked
- 58799481 fix: the not picked line floors at <1% on an alliance, never a flat 0% (orchestrator)
- 33e1c478 merge quick/261014-jfx into main

Built in a separate worktree (SigmaScout-jfx, branch quick/261014-jfx) because the 261014-i8i session held uncommitted edits in districtLedgerRows.ts and champLedgerRows.test.ts. Merged once i8i committed; both files auto merged.

## Verification
- Executor, on the branch: districts, methodology, district points route test and packages/core/districts: 60 files passed, 2134 tests passed, 0 failed. tsc root, web, e2e clean.
- After the merge, on main: same paths, 2196 passed, 1 failed: `DistrictLedger.test.tsx` "posts the advancement chance to a SECOND Worker", a timing test that fails under full load and passes alone (101 of 101 in that file, rerun on main and on the branch). tsc root, web and e2e: 0 errors.
- Local preview of the branch against live data, FNC, UNC Asheville, team 6932:
  - Schedule released: `~not picked` over `2% on an alliance`.
  - Quals ¼: `~not picked` over `2% on an alliance`.
  - Quals ½ (qm30): `~1st` over `43% · pays 30`. Picked in 51% of runs, always as alliance 1's second pick (serpentine order puts the edge robot there), so the guess among picked finishes is the alliance 1 win. Honest, though surprising for a mid team.
  - Quals ¾: `~2nd` over `40% · pays 20`; drawer `Finalist in 40 of 100 runs.` with the tile labeled best guess.
  - Quals done: `~not picked` over `0% on an alliance` before the floor fix; unit tests pin `<1%` after it.
  - Legend reads `~ = this site's prediction`. Six teams on that table read `~not picked`.

## Self-Check: PASSED
