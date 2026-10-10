---
phase: quick-261009-tx8
plan: 01
subsystem: districts (Locks tabs, bracket routing, methodology)
tags: [locks, champ-locks, bracket, reconciliation, methodology]
status: complete
requirements_completed: [261009-tx8]
dependency_graph:
  requires: [261008-26o, 261009-2tr, 261009-kt3, 261009-pgq]
  provides:
    - "bracketDecisionsFromPlayedMatches numbers a set's decided rows 1 to n, so a tie's replay decides the set"
    - "the corpus reconciliation routes every complete bracket: 491 brackets, 10,547 values, 0 unresolved"
    - "the Champ Locks DCMP row is the division plus the finals once earned (champCellNamesOutcomes, champDcmpStageSource, shiftedByFinals)"
    - "a corpus gated test that a losing finalist is paid the base second place value"
  affects: [apps/web Champ Locks tab, apps/web District Locks tab, methodology page]
tech_stack:
  added: []
  patterns:
    - "one decision map for the browser routing, the simulation's draw loop and the corpus proof"
    - "a flag present and true only (shiftedByFinals), on the notPicked precedent"
key_files:
  created: []
  modified:
    - packages/core/districts/bracket.ts
    - packages/core/districts/bracket.test.ts
    - packages/core/districts/ledgerSimulation.test.ts
    - packages/core/districts/pointFormulas.reconciliation.test.ts
    - packages/core/districts/champJointLock.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/districts/districtLedgerOutcomes.ts
    - apps/web/src/components/districts/districtLedgerOutcomes.test.ts
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/districts/districtLedgerCopy.test.ts
    - apps/web/src/components/districts/LedgerParts.tsx
    - apps/web/src/components/districts/ledgerVerdict.ts
    - apps/web/src/components/districts/ledgerVerdict.test.ts
    - apps/web/src/components/districts/DistrictOutcomeList.tsx
    - apps/web/src/components/districts/champLedgerRows.ts
    - apps/web/src/components/districts/champLedgerRows.test.ts
    - apps/web/src/components/districts/champLedgerStatus.ts
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
decisions:
  - "B1 withdrawn on the corpus measurement: a losing finalist is paid the base second place value; the 25 (75) placement maximum is kept for the lock math"
  - "B4: a set's decided rows are numbered per set after the last row for an original key replaced the earlier one"
  - "B2: the DCMP row reads the division row and adds each finals category that is final at the position; the stage line follows the event still being played"
metrics:
  duration: "about 35 minutes"
  completed: 2026-10-09
  tasks: 3
  commits: 4
  files: 21
actuals:
  tokens: 29968
  tasks: 3
  commits: 4
---

# Quick Task 261009-tx8: Locks display and model corrections Summary

A tied playoff match now routes to its real winner everywhere the played rows are read, a divisioned championship's DCMP row shows the division plus the finals once earned, the unreachable `placed` milestone arm is gone, and the losing finalist premise of B1 is withdrawn, corrected in the comments and held by a corpus test. No lock moved.

## What changed on the page, in plain terms

1. **Champ Locks, a team at a championship played in divisions (FIM, NE, ON, TX).** The team's District Championship row used to show whichever of its two championship rows sorted first, which at FIM was the finals row. It now shows the team's division, plus the finals points once they are earned. frc27 at 2026 FIM read Qualification 0, Alliance selection 0, Playoffs 60, Awards 30. It now reads **66, 48, 150, 30 and Subtotal 294**. A team whose only championship row is the finals (frc11387: 0, 0, 0, 24, Subtotal 24) reads as before. The grand total follows the Subtotal.
2. **The same row's small stage line** now follows the event still being played: the division's stage while the division is open, the finals' stage once the division is done and the finals are not, and the final word once both are done. A district with one championship prints what it printed.
3. **A division cell still open while finals points are already earned** (a rewound stop) shows a median with a likely range moved up by those points, and its drawer draws a histogram.
4. **While a finals category can still pay, the grand total stays open** and the predicted cutoff does not settle early.
5. **A playoff set with a tied match** (a tie is replayed under the next match number) is now decided once the replay is played. Before, the set stayed open on the Locks tabs and in the simulation, so both alliances kept reading as still alive. 13 eight alliance district points events of 2023 to 2026 carry such a tie, every one a district event.
6. **Methodology page.** One new sentence: "A championship played in divisions adds the finals points to the District Championship row once they are earned." The Playoffs row's checked figure reads "491 brackets and 10,547 rows, 0 mismatches" (was 478 and 10,278).
7. **Nothing changed for a losing finalist.** The simulation, the settled cell, the Finalist outcome row and the pays line print what they printed.
8. **B3 changed nothing on screen.** The removed arm could not be reached.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (B4) | 16d0f64e | fix(261009-tx8): a tied playoff match no longer stalls the bracket routing |
| 1 (B3) | e135a48b | fix(261009-tx8): remove the unreachable placed milestone arm |
| 2 (B2) | d4d715a6 | fix(261009-tx8): a divisioned championship's DCMP row shows the division plus the finals once earned |
| 3 (B1 withdrawn) | ee445919 | fix(261009-tx8): a losing finalist is paid the base second place value; correct the comments and pin the measurement |

Base: 62c21b5d (the planner measured at 9e979118; one sibling commit, 261009-txb, landed in between). Nothing under `.planning/`, `apps/worker`, a schema, an algorithm version or a generated file is in the four commits. Nothing was pushed.

## The lock sweeps: baseline and every comparison

The executor took its own baseline at 62c21b5d before the first edit. It equals the planner's baseline at 9e979118 on all four outputs, apart from the joint sweep's timing line.

| Sweep | Baseline | After B4 | After B3 (Task 1) | After Task 2 | After Task 3 |
|---|---|---|---|---|---|
| `measureChampJointLocks.ts` | exit 0, SKIPPED (0), VIOLATIONS: none | identical | identical | identical | identical |
| `measureChampTenets.ts` | exit 0, VIOLATIONS 0 and 0 | identical | identical | identical | identical |
| `measureLedgerTenets.ts` | exit 0, tenet A 0, tenet B 0 | identical | identical | identical | identical |
| `measureChampCutoff.ts --check-history` | two `no drift:` lines | not run | not run | two `no drift:` lines | two `no drift:` lines |

"Identical" is a `diff` of the whole output with the one `time` line of the joint sweep filtered out (see deviation 1). No line moved, no lock was gained and none was lost.

Totals, the same before and after every task:

| Joint sweep TOTALS | swept | stops | proof ran | shipped | joint only | combined | violations | earlier |
|---|---|---|---|---|---|---|---|---|
| single event championships | 31 | 248 | 217 | 340 | 414 | 754 | 0 | 167 |
| divisioned championships | 16 | 156 | 140 | 1582 | 1085 | 2667 | 0 | 381 |
| two championship districts | 1 | 8 | 7 | 41 | 62 | 103 | 0 | 21 |
| every championship | 48 | 412 | 364 | 1963 | 1561 | 3524 | 0 | 569 |

- Champ tenets: seasons 109, positions 4714, team positions 1073186, Locked on points shown 6836 (kept 6767, award qualified at now 69, VIOLATIONS 0), Locked · award shown 4234, Locked out shown 271340 (kept 271077, award qualified at now 149, unresolved tie 114, VIOLATIONS 0), reservation 44436 over 4216 positions.
- Ledger tenets: tenet A violations 0, tenet B Locked out shown 167429 (kept 167381, award qualified 48, VIOLATIONS 0), both tenets hold at every swept position.

`scripts/measureLedgerSettledTenets.ts` (commit 62c21b5d) was not run and not touched, as instructed.

## The reconciliation figures (B4)

`npx vitest run packages/core/districts/pointFormulas.reconciliation.test.ts`, printed lines:

| | Before (shipped) | After |
|---|---|---|
| complete brackets reconciled | 478 (105 / 112 / 118 / 143) | **491** (111 / 115 / 121 / 144) |
| unreconcilable | 13 | **0** |
| team level values checked | 10,278 | **10,547** |
| mismatches | 0 | **0** |
| four robot alliances excluded | 330 | 343 |
| prorated three pick alliances | 1 | 1 |
| absent pick slots | 201 | 205 |

Every number equals the planner's measurement (`tx8-reconcile.mts`), so the pins moved without a stop. New pins: checked floor 10,547, a ceiling of 0 on unreconcilable events (the failure message names the event keys), four robot ceiling 343, absent team ceiling 205. The `bracket.ts` header, the methodology Playoffs row and `districtLedgerContent.test.ts` state 491 and 10,547.

## The losing finalist measurement (B1 withdrawn)

New corpus gated case in the reconciliation file, over its own 491 routed brackets. Printed line:

`[playoff finalist] brackets=491 twoToOneFinals=118 losingFinalistAtBaseAfterTwoToOne=329 (district=261 dcmp=68) aboveAfterTwoToOne=0 belowAfterTwoToOne=11 atBaseAfterSweep=1074 aboveAfterSweep=0 rowsAtBase25: winner=13 loser=0 other=0`

- No first three pick of a losing finalist is paid above the base second place value, after a swept final or a 2 to 1 final (0 and 0).
- After a 2 to 1 final, 329 are paid exactly the base (261 district tier at 20, 68 DCMP tier at 60) and 11 below it (prorations).
- All 13 rows at base 25 sit on the winning alliance. None sits on a losing finalist.

These equal the planner's probe (`tx8-finalist-pin.mts`, rerun by the executor) number for number. No value, threshold, ceiling or user facing string changed in Task 3: the comment check printed `COMMENT LINES ONLY (four source files)` with all four files in its stat (`bracket.ts` 32 lines, `champJointLock.ts` 10, `districtLedgerRows.ts` 42, `champLedgerStatus.ts` 11). Each of the four files now states the manual's wording, the 329 rows at the base value, the 13 winning alliance rows and that the 25 (75) maximum is kept as the safe side.

## Tests and typechecks, as printed

| When | Command | Printed |
|---|---|---|
| RED, B4 | `npx vitest run packages/core/districts/bracket.test.ts` | 5 failed, 56 passed (2023ncash, the four match final, the tie in the middle, the row ordering, the routeBracket agreement) |
| GREEN, B4 | same | 61 passed |
| RED, B2 | `npx vitest run apps/web/src/components/districts/champLedgerRows.test.ts` | 15 failed |
| GREEN, B2 | same | 89 passed |
| RED, methodology | `districtLedgerContent.test.ts` | 1 failed, 18 passed |
| After B4 | the Task 1 paths | 63 files, 1745 passed |
| After B3 | the Task 1 paths | 63 files, 1741 passed (four deleted cases, see below) |
| After Task 2 | districts and methodology | 33 files, 1011 passed |
| After Task 3 | core districts, districts, methodology | 58 files, 1647 passed |
| Final | `npx vitest run` (repo root) | **349 files passed, 8246 passed, 1 skipped** |
| Every task | root, web and e2e `tsc --noEmit` | `TYPECHECKS CLEAN (root, web, e2e)` |

The one skipped case in the full run is not one of this task's: the reconciliation file printed its corpus lines and the local artifact case printed `[261009-tx8 2026fim] frc27 66, 48, 150, 30, 294; frc11387 0, 0, 0, 24, 24`, so it ran and was not skipped on this machine.

Tests deleted in B3, with the arm they exercised: the outcome row case "leaves exactly one row once the bracket has decided the placement", the verdict case "heads an alliance placed sixth", and the two copy cases of `districtLedgerPlacementLine`, plus that helper's entry in the dash check. No other expectation changed, and `ChampLocksLedger.test.tsx`, `champLedgerStatus.test.ts` and `champJointLock.test.ts` passed with no edit.

## Readings

- R1 (B4): the numbering runs per set, after the last row for an original key replaced the earlier ones. `routePlayedBracket`, `routeBracket`, `ledgerSimulation.ts`, `champJointLock.ts` and `finalsBracket.ts` are not edited (one comment added beside the gap rule in `routePlayedBracket`).
- R2 (B4): the shipped "ends a set at a gap" case is rewritten over a hand built map.
- R3 (B3): `playoffMilestoneFor` returns `undefined` for a decided milestone. The placement line helper and its ordinals table are gone. The empty list guard in `DistrictOutcomeList` stays.
- R4 (B2): the primary row is the first pass row whose key is field fixing, else the first row.
- R5 (B2): a finals category is added exactly where the finals row's cell is a final cell. A value of 0 leaves the primary cell untouched.
- R6 (B2): final plus final is a final sum. An open division cell moved up by a positive value is a plain open cell from the module's own `foldCells`, flagged `shiftedByFinals`, in the median form, and its drawer draws a histogram.
- R7 (B2): the Subtotal adds the sum of the added category values.
- R8 (B2): the win chance is read off the primary row's own Playoffs cell before any addition.
- R9 (B2): `hasOpenCategory` stays true while a finals category is open.
- R10 (B2, orchestrator): the stage line reads division first, then finals, and prints the first that still has an open category, else the final word. `sources` keeps its order.
- R11 (B2): the "nothing was priced" gate reads the primary row's Subtotal.
- R12 (B4): the reconciliation test keeps its majority vote colour mapping and `routeBracket`; its decider reads `bracketDecisionsFromPlayedMatches`.
- R13 (B4): the published figure moves to 491 brackets and 10,547 rows.
- R14: no tracer task; Task 1 is two commits (B4, then B3).
- R15 (B1, orchestrator): withdrawn. Values as shipped, the 25 (75) maximum kept, comments corrected, the measurement a test.

## Deviations from Plan

**1. [Rule 3 - Blocking] The joint sweep's output carries a timing line.**
- **Found during:** Task 1, step 0.
- **Issue:** the plan says the sweep outputs carry no timing line, so `diff` compares them byte for byte. `measureChampJointLocks.ts` prints `time  <n> s` (13.5 s in the planner's file, 11.1 s in the baseline), so a plain `diff` of that file always differs.
- **Fix:** every joint, champ and ledger comparison is a `diff` with lines matching `^\s*time\s` filtered out (`scratchpad/tx8x/sweep.sh`). Every other line was compared.
- **Files modified:** none in the repo.

**2. The base commit is 62c21b5d, not 9e979118.** Expected by the plan. The executor's baseline equals the planner's on all four outputs apart from that timing line.

**3. [Reading] The shifted Subtotal carries the flag too.** The plan says the Subtotal follows "the same three rules". An open Subtotal moved up by earned finals points is built by the same fold and so also carries `shiftedByFinals`. It changes nothing on screen: a Subtotal's drawer never listed named outcomes.

**4. [Reading] `reconcilePlayoffPoints` takes an optional visitor.** The losing finalist case had to read "the file's own routed brackets". Rather than a second copy of the routing, the function hands each routed bracket (its alliances, its played rows, the routing, an entry lookup) to an optional `onRouted` callback. Its result and its counts are unchanged.

**5. [Reading] The decisive rows are mapped up front.** As the plan words it, a decisive sf or f row whose winning colour maps to no alliance makes the event unreconcilable even where the router would not have read that row. No event is affected: the counts equal the planner's lazy probe exactly.

**6. Comment wording beyond the listed sentences.** In `districtLedgerRows.ts` the dangling doc on the milestone type said "the three positions past that"; it now says two and names the removed arm. In B4 the `PlayoffBlockResult.unreconcilableEvents` doc no longer lists a tie as a cause.

**7. Edits were applied by exact string replacement scripts** (Python, in the scratchpad, run through Bash) on the harness's instruction to prefer Bash. Each replacement refuses unless its target occurs exactly once, and each preserves the file's line endings.

No Rule 4 stop, no auth gate, no package install.

## Todo items closed (edited in place, NOT committed)

- `.planning/todos/pending/locks-settled-playoffs-follow-ups.md`: item 1 (the `placed` arm is removed).
- `.planning/todos/pending/champ-joint-lock-follow-ups.md`: items 4 and 5 ("measured, not a gap: TBA pays a losing finalist the base value", with 329 at the base, 0 above, the 13 rows at 25 on the winning alliance, and the 25 (75) maximum kept), item 7 (a tied row's replay is routed), item 12 (the DCMP row's cells, Subtotal, grand total and small stage line).

No new item and no leftovers section was added.

Uncommitted `.planning/` files left for the orchestrator: the two todo files above, this SUMMARY, and the plan and context files of this quick task directory (untracked since before the task).

## For the orchestrator

1. **Two test comments still use the old wording, in files the plan said must pass unedited.** `packages/core/districts/champJointLock.test.ts` line 98 ("the maxima for 1, 3 and 4, and 60 or 75 for a losing finalist") and `apps/web/src/components/districts/districtLedgerRows.test.ts` line 1614 (the case title "its ceiling is the 75 a losing finalist can be paid"). Both describe the kept ceiling and both are true as bounds, so nothing is wrong in what they assert. I left them because the plan fixed the comment edits to four source files and required these two suites to pass with no edit.
2. **`locks-settled-playoffs-follow-ups.md` item 5 stays open.** CONTEXT's canonical references name it, the plan does not close it, and it is about proration (a team that sat out part of its alliance's playoffs is paid less than the table), which this task did not touch. The cross reference to it in champ joint item 4 ("todo 5a") is inside the struck text.
3. **The header comment of `champLedgerRows.test.ts` says `import.meta.url` is an `http://` URL under jsdom.** The new local artifact case resolves its path with `fileURLToPath(import.meta.url)`, as `DistrictLedger.test.tsx` already does in the same directory, inside a `try` that falls back to skipping. It resolved and ran here. If it ever skips silently on another machine, that comment is why to look.
4. **Not verified in a browser.** Everything above is from unit tests, the local 2026 FIM artifact and the sweeps. No page was opened and no screenshot was taken, and the live e2e specs were not run (they hit the deployed site).

## Known Stubs

None.

## Self-Check: PASSED

- The four commits exist on `main`: 16d0f64e, e135a48b, d4d715a6, ee445919.
- `git diff --name-only 62c21b5d..HEAD` lists 21 files, every one in the plan's `files_modified`, none under `.planning/` or `apps/worker`.
- `git status --short` shows no modified tracked file other than the two todo files.
