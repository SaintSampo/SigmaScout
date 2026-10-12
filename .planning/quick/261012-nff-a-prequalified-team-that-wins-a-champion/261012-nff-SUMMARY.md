---
phase: quick-261012-nff
plan: 01
status: complete
completed: 2026-10-12
branch: quick/261012-nff
base: 9a6c9fae
released: false
---

# Quick Task 261012-nff: A prequalified team that wins a championship award or the event no longer uses up a district slot

## What changed

FIRST works out a district's FIRST Championship slots after the prequalified teams are taken out. So a prequalified team is never one of the district's slots, whatever it wins. The code counted it as one whenever it also held a District Championship award or was on the winning alliance, and the team next in line read `eliminated`.

The rule now lives in one place, `awardTakesSlot(teamKey, qualifiers)` in `packages/core/districts/locks.ts`. It is true exactly when the team is not prequalified.

- `pointsRaceSlots` counts a ranked award qualifier as using a slot only when `awardTakesSlot` says yes. Both sets still leave the pool. The floors and the reservation clamp are unchanged.
- `advancementChance.ts` champ mode no longer keeps its own copy of the posted count. A run's points slots are the static count from `pointsRaceSlots` less that run's drawn count. The drawn count reads `awardTakesSlot`. No call to the generator was added, moved or removed.
- Every other reader follows with no edit: the published verdict pass (`districtRankingsMerge.ts`), the Champ Locks tab (`champLedgerStatus.ts`), the predicted cutoff, the cutoff backtest.
- Headers corrected in `locks.ts`, `advancementChance.ts` and `prequalified.ts`.

## Commits (branch `quick/261012-nff`, above `9a6c9fae`)

| Hash | Message | Files |
| --- | --- | --- |
| f4e29a23 | fix(261012-nff): a prequalified team never uses a district slot, whatever it wins | `locks.ts`, `locks.test.ts`, `prequalified.ts`, `scripts/publishDistricts.test.ts` |
| e458c0b7 | fix(261012-nff): the champ chance run counts no slot for a prequalified winner, posted or drawn | `advancementChance.ts`, `advancementChance.test.ts` |
| f75362a1 | chore(261012-nff): regenerate the champ cutoff files under the prequalified slot rule | `champCutoffTuning.generated.ts` |
| d0ed851a | docs(261012-nff): the lock header counts every district the prequalified slot rule moved | `locks.ts` (comment only, by the orchestrator) |

New tests: 8 cases in `locks.test.ts` (one a seeded property over overlapping sets, 200 fixtures), 4 in `advancementChance.test.ts` (posted with a control, drawn with a control, same randomness, legacy mode), 1 publisher level case with a control in `scripts/publishDistricts.test.ts`. Each was watched failing on the old code first. No existing expectation was edited.

## What moved on real data

Every local district file was rebuilt twice with the publisher's dry run (`--dry-run --no-bake --local-out`): once by the old code (the control) and once by the new code. Same corpus, same flags. The diff tool's verdict: `EXPECT champ-only: OK`, `PROBLEMS: none`.

- 19 districts moved. 32 teams changed status: eliminated to locked 18, eliminated to contending 6, contending to locked 8.
- No team lost `locked`, `lockedAward` or `prequalified`. `districtLock` moved nowhere. No field outside the champ verdicts and champ insights moved.

| District | Prequalified award holder | Teams that moved | Cut line |
| --- | --- | --- | --- |
| 2016mar | frc341 (Winner) | frc1143 eliminated to locked | 167 to 155 |
| 2016ne | frc195 (Winner) | frc1729 eliminated to locked | 129 to 125 |
| 2018chs | frc1885 (Chairman's, Winner) | frc4472 eliminated to locked | 177 to 167 |
| 2018isr | frc2096 (Chairman's) | frc7039 eliminated to locked | 206 to 197 |
| 2019isr | frc3075 (Winner) | frc5554 eliminated to locked | 211 to 203 |
| 2019ont | frc1114 (Winner), frc772 (Chairman's) | frc2852, frc6867 eliminated to locked | 183 to 178 |
| 2019tx | frc148 (Winner), frc2468 (EI) | frc3481 eliminated to locked; frc5242, frc5052 eliminated to contending | 117 to 110 |
| 2020chs | frc1629 (Chairman's) | frc836, frc5338, frc1885 contending to locked | unchanged |
| 2022fim | frc27 (Winner) | frc4392, frc51, frc5086, frc1711, frc5166 contending to locked | unchanged |
| 2022ont | frc1114 (Winner) | frc4907, frc4039 eliminated to contending | 231 to 227 |
| 2023chs | frc1629 (EI) | frc6802 eliminated to locked | 178 to 173 |
| 2023fit | frc2468 (EI) | frc3035 eliminated to locked | 178 to 176 |
| 2023isr | frc2096 (Impact) | frc5654 eliminated to locked | 203 to 201 |
| 2024fim | frc27 (Winner), frc5166 (Impact) | frc4381 eliminated to locked; frc7501, frc2959 eliminated to contending | 161 to 156 |
| 2024fit | frc118 (Impact, Winner) | frc7121 eliminated to locked | 186 to 184 |
| 2024fma | frc1676 (Impact) | frc1218 eliminated to locked | 159 to 154 |
| 2025chs | frc1629 (EI) | frc3748 eliminated to locked | 184 to 178 |
| 2025isr | frc1690 (Winner), frc5614 (Impact) | frc1942, frc5987 eliminated to locked | 252 to 188 |
| 2026fch | frc1629 (EI) | frc614 eliminated to locked | 187 to 185 |

The seven teams of the CONTEXT table all read `locked`. 2023fit, 2024fim and 2024fit were not in that table and moved too. 2016fim holds such teams (frc27, frc67) and did not move: four teams tie at its line and the tie spans the old slot count and the new.

A correction to CONTEXT D4: the local files it called "built by the old code" were stamped 2026-09-25, from before quick task 261007-il9. Against a fresh build by the unchanged code they already differ in `districtLock` (14,509 teams in 98 districts), the district insights, `awardProfile` and `nickname`. Their champ side was exact. So the proof above uses a fresh control, and the comparison against the 2026-09-25 files shows the same 19 districts and the same teams on the champ side.

## Gates

| Gate | Result |
| --- | --- |
| Full suite less the three long local data files | 354 files, 8853 passed, 1 skipped |
| Four typechecks (root, web, e2e, worker) | clean |
| `measureLedgerTenets` | no change |
| `measureLedgerSettledTenets` | zero violations; only the three reference lines that the fresh files move |
| `measureChampTenets` | zero violations; Locked on points shown 6836 to 6912, Locked out shown 271608 to 271515 |
| `measureChampJointLocks` | zero violations, `SKIPPED (0)`; combined locked 754 to 763 (single), 2898 to 2902, 3755 to 3768 |
| `measureChampCutoff --check-history` | `dcmpHistory.generated.ts` no drift; `champCutoffTuning.generated.ts` drifted and was regenerated by the script's own flags |
| `districtLocksStagedReplay.test.ts` (local data) | 48 of 48 on the old code, passes on the new |
| `champFieldStagedWalk.test.ts` (local data) | passes on the old code and on the new |
| `champJointMonotone.test.ts` (local data) | every rules ON assertion passes: 0 Locked lost, 0 margin drops. FOUR pins of the "the test bites" cases moved, below |

The three long tests ran in the orchestrator's hands: once on the unchanged code with the fresh control files (all green, 21 minutes), then on the new code with the rebuilt files (207 passed, 4 failed, 24 minutes).

## Open: expected values measured on the old slot counts (NOT changed here)

Two sets of pinned numbers were measured before this rule and now read differently. They were left as they are, for Jacob to decide.

1. `scripts/champJointMonotone.test.ts`, the four "THE TEST BITES" cases. Each switches one rule OFF and pins how many locks are then lost. The file is held by quick task 261012-mw2, which will move the same pins.

| Case | Field | Pinned | Executed |
| --- | --- | --- | --- |
| Group A, awarded rule OFF (line 713) | `lostOverFlagEdges` | 952 | 934 |
| | `distinctPairsLost` | 161 | 162 |
| | `teamMarginsDropped` | 33388 | 33390 |
| Group A, stop rule OFF (line 760) | `lostOverStopEdges` | 306 | 288 |
| | `distinctPairsLost` | 129 | 125 |
| Group D, awarded rule OFF (line 2350) | no row: `lostOverFlagEdges` | 121 | 122 |
| | no row: `marginDrops` | 2035 | 2039 |
| | registered: `lostOverFlagEdges` | 202 | 203 |
| | registered: `marginDrops` | 3245 | 3249 |
| Group D, stop rule OFF (line 2372) | `lostOverStepEdges` (both readings) | 63 | 65 |
| | by district `2024fit` (both readings) | 2 | 4 |

2. `scripts/measureChampCutoff.ts`, `ORACLE_EXPECTED` (gate 1 of the plain backtest). The two oracle lines are scored against each season's published cut line, which this task moved. Registered: naive 20.3 / -20.2, `cmpSlots - 3` 9.0 / -2.6. Executed: 18.83 / -18.48 and 10.43 / -0.87 over the same 69 seasons. Gate 1 reads FAIL until the values are registered again. Gates 2 to 4 stay PASS, gate 5 stays FAIL, and the verdict stays NO-GO as before. `measureChampCutoff.test.ts` builds its own values and is green.

## The regenerated cutoff tuning

The history check drifted because the published lines moved. The tuning table was regenerated by `--write-tuning` and nothing was edited by hand. Seasons whose chosen setting changed:

| Season | Before | After |
| --- | --- | --- |
| 2020, 2021, 2022 | uniform / fixed / 1.75 | decoration / fixed / 1.75 |
| 2023 | uniform / fixed / 1.75 | uniform / drawn / 1.75 |
| 2025 | uniform / fixed / 1.75 | uniform / drawn / 1.30 |
| 2027 | uniform / fixed / 1.75 | decoration / drawn / 1.30 |

2018, 2019, 2024 and 2026 keep their settings. The backtest's simulated line reads MAE 17.62 (was 17.78), bias 6.7 (was 7.3), and the printed range covers 48 of 69 (was 49).

## Stated limit

The joint proof (`champJointLock.ts`, `slotOnlyRivals`) still counts a prequalified team that is not yet award qualified as a rival that can take a slot by winning or by a consuming award. Under this rule that is an over count. It can only delay a lock and can never make one false. Those files are held by quick task 261012-mw2, so it is left for a later task. Three comments in held files now read slightly wrong and were left alone: `champJointLock.ts` line 949, and `champLedgerStatus.ts` lines 28, 124 and 722 ("whatever its winner's points").

## Where this lives, and what is owed

The work is on branch `quick/261012-nff` in the sibling worktree `C:/Users/Jacob/Documents/GitHub/SigmaScout-nff`. The main checkout was never written. `git merge-tree --write-tree main quick/261012-nff` reads clean against `9a6c9fae`.

Owed, in order:

1. Merge the branch into main (the other session's lock task is in flight in the main checkout and reads the same files).
2. In the main checkout, rebuild the local district files with the dry run above. Until then the sweeps there compare new code against old verdicts and will report violations that are not real.
3. Decide the two sets of expected values above, then run the three long local data tests again.
4. Add the STATE.md quick task row (left off the branch on purpose, since two sessions appending to that table always conflict).
5. Release: deploy the Worker (it bundles `locks.ts`), republish the district files, push the web.
