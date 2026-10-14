---
phase: quick-261014-i1c
plan: 01
subsystem: web / Locks ledger (District Locks and Champ Locks tabs)
tags: [locks, playoffs, best-guess, copy, methodology]
status: complete
requirements: [261014-i1c]
key-files:
  created: []
  modified:
    - apps/web/src/components/districts/districtLedgerOutcomes.ts
    - apps/web/src/components/districts/districtLedgerOutcomes.test.ts
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/districtLedgerCopy.test.ts
    - apps/web/src/components/districts/LedgerParts.tsx
    - apps/web/src/components/districts/LedgerParts.test.tsx
    - apps/web/src/components/districts/ledgerVerdict.ts
    - apps/web/src/components/districts/ledgerVerdict.test.ts
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/districts/ChampLocksLedger.test.tsx
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
decisions:
  - "Playoffs cell names a BEST GUESS FINISH (1st, 2nd, 3rd or 4th, 5th to 8th), most runs wins, tie to the better finish"
  - "Cells no single finish describes print the median form with a likely range"
  - "Drawer headline and most likely tile follow the cell's best guess; outcome list rows stay separate"
  - "playoffMilestone survives trimmed to its kind (it only rules finishes out)"
actuals:
  tokens: 90000
  tasks: 3
  commits: 3
---

# Quick task 261014-i1c: Playoffs best guess finish

An open Playoffs cell on both Locks tabs now reads `best guess 3rd or 4th` over `36% · pays 7 or 13` (and the 1st, 2nd, 5th to 8th equivalents). The finish is the one with the most runs among {1st}, {2nd}, {3rd and 4th grouped}, {5th to 8th grouped}, with ties to the better finish and ruled-out finishes never chosen. The old moving question (top 4, then final, then win) is gone.

Why: Jacob found the old cell confusing. One column mixed three questions, so `60% win` looked weaker than `90% top 4` although it is the stronger position. He picked the best guess finish from four directions (same three numbers, one bar per team, best guess finish, bracket spot then win odds).

## User decisions (Jacob, before execution)
1. The drawer headline and most likely tile match the cell's best guess. The outcome list, the chance of points tile and the ruled-out filtering are unchanged.
2. Cells with no single finish (Champ Locks District points row, shiftedByFinals, unaccounted mass) print the median form with a likely range, like the Qualification cell.

## Planner choices
1. A best guess prints only where the cell has pricing, its season has a registered bracket, it is not flagged shiftedByFinals, and the five named placements account for all of its mass. Every other Playoffs cell prints the median form (`~N` over `likely a to b`). The flag is checked explicitly because a finals shift can land on named values (a DCMP 21 plus a finals 39 is 60).
2. playoffMilestone survives, trimmed to its kind. The lock math never reads it, but the drawer's ruled-out filter and the best guess need it. `chance`, `conditionalMedian` and the threshold summary that computed them are removed.

## What was built
- `districtPlayoffBestGuess(cell, pricing)` plus `DistrictPlayoffFinishId` and `DistrictPlayoffBestGuess` in districtLedgerOutcomes.ts. It reads the drawer's own `districtPlayoffOutcomes` rows with the cell's milestone, so the cell and the drawer read one array. Guards, all returning undefined: not a Playoffs cell, notPicked, shiftedByFinals, no pricing, season outside BRACKET_REGISTERED_SEASONS (checked before any call that reaches the throwing `playoffPoints`), and any mass off the five named placements (tolerance 1e-9, a named constant). The pay keeps zero, so 5th to 8th reads `pays 0`.
- `districtCellPay` lost its Playoffs branch and the headline coverage table.
- Copy: `DISTRICT_LEDGER_PLAYOFF_BEST_GUESS_PREFIX`, `DISTRICT_LEDGER_PLAYOFF_FINISH_WORDS`, `DISTRICT_LEDGER_PLAYOFF_FINISH_LABELS` (drawer, `Third or fourth place` is new), `districtLedgerPlayoffBestGuessLines`. Deleted `DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS` and the `elim` entry of `DISTRICT_LEDGER_CHANCE_WORDS`.
- `openCellLines`: a Playoffs cell prints the best guess, or the median fallback computed with `pointPercentiles` over the distribution. The `at least N · ` secured prefix still precedes the small line of both forms. Not picked still prints first.
- `buildVerdictModel`: a Playoffs drawer's headline and mostLikely tile use the best guess finish label and chance.
- `DistrictPlayoffMilestone` is now `{ kind: "finalist" } | { kind: "winner" }`; `playoffMilestoneFor` takes only the bracket milestone.
- Methodology page rewritten for the best guess.

## Deviations from Plan
1. Methodology paragraphs split to honour the existing three sentence voice test. Every sentence of the plan's wording kept verbatim and in order. The voice test was not weakened. (c706fef3)
2. Test fixtures for FINALIST, WINNER, WINNER_SURE and the DCMP variants reworked to carry mass only on that tier's placement values (anticipated by the plan).

## Commits
- 9fb51fb1 feat(quick-261014-i1c): the Locks Playoffs cell names a best guess finish
- 1dff3244 feat(quick-261014-i1c): the Playoffs drawer headline names the cell's best guess
- c706fef3 refactor(quick-261014-i1c): retire the Playoffs milestone question and rewrite its methodology

## Verification
- `npx vitest run apps/web/src/components/districts apps/web/src/components/methodology apps/web/src/routes/methodology.district-points.test.tsx` from the repo root: 35 files, 1275 tests passed.
- Typechecks clean: root tsconfig, apps/web/tsconfig.json, apps/web/tsconfig.e2e.json.
- Stale wording grep (`top 4|% final|% win|PLAYOFF_MILESTONE_WORDS|PLAYOFF_HEADLINE_OUTCOMES|milestone\.chance`) over apps/web/src and apps/web/e2e: clean. The e2e specs pin no Playoffs cell text.

## Visual check (orchestrator, local preview against live data)
- `vite build` with `VITE_ARTIFACT_ORIGIN=http://localhost:4173`, then `vite preview`.
- District Locks, FIM, Livonia Round 3 (`at=2026miliv:round:3`): 191 rows carry a best guess, 0 rows carry the old words. Example: 3538 at Livonia reads `best guess 1st` over `at least 13 · 99% · pays 30`.
- Champ Locks, PNW, DCMP Round 3 (`at=2026pncmp:round:3`): 13 rows carry a best guess, 0 old words. Examples: `best guess 2nd` over `at least 39 · 60% · pays 60`, `best guess 3rd or 4th` over `at least 21 · 95% · pays 21 or 39`. The District points row Playoffs cells print grey earned values there.
- Cell and drawer agree: 3603 at Ferris State reads `best guess 1st · 91%`, and its drawer headline reads `Wins the event in 91 of 100 runs.`
- Width: the Playoffs column grew from 157 px to 184 px at that stop. The District Locks table already overflowed its 1150 px container on the live site (1192 px, Awards partly hidden at desktop width); it now overflows by 69 px instead of 42 px. Not fixed here.

## Known Stubs
None.

## Self-Check: PASSED
