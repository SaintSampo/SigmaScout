---
phase: quick-261014-mji
plan: 01
subsystem: districts / locks simulation (measurement only)
tags: [locks, alliance-selection, measurement, walk-forward, inert-option]
status: complete
requires:
  - packages/core/districts/ledgerSimulation.ts (simulateDistrictEvent)
  - scripts/measureSelectionAgreement.ts (10-02 boundary SPR replay)
  - scripts/publishedSprSnapshots.ts
  - apps/web/src/components/districts/districtLedgerRows.ts (playedBracketMatchesFor)
provides:
  - an optional pickPositionPmf input on simulateDistrictEvent, inert at default
  - PICK_STREAM_SALT, InvalidPickPositionPmfError, pickDraws on the observation (only when the option is present)
  - boundaryRatingsByEvent (total and sigma from the one 10-02 replay rule) and an injectable boundary map for measurePickOrderHalf
  - scripts/measureRandomPickDraft.ts, the walk forward measurement, with pure tests
affects: []
key-files:
  created:
    - scripts/measureRandomPickDraft.ts
    - scripts/measureRandomPickDraft.test.ts
  modified:
    - packages/core/districts/ledgerSimulation.ts
    - packages/core/districts/ledgerSimulation.test.ts
    - scripts/measureSelectionAgreement.ts
decisions:
  - "The random pick draft (a measured position pmf per round, walk forward) WINS against today's fixed SPR draft under Jacob's pre registered rule, with both the 2016 onward and the 2023 onward tables. Measurement only; nothing ships until Jacob decides."
  - "The fixed draft by qualification rank loses to the fixed SPR draft on Brier, log loss and accuracy."
metrics:
  duration: "about 30 minutes"
  completed: 2026-10-14
  tasks: 3
  files: 5
actuals:
  tasks: 3
  commits: 3
---

# Quick 261014-mji: a random pick draft measured against the fixed SPR draft

**At Quals done, a walk forward random pick draft beats today's fixed SPR draft by a wide margin on Brier and log loss and narrowly on accuracy, with both table sets. The pick by rank draft loses on all three. Nothing published changed.**

## Why
Jacob saw 2026 UNC Asheville team 6932 read 0% on an alliance at Quals done; it was picked (alliance 7, second pick). Today's draft picks greedily by published SPR in a fixed order with no randomness, so at Quals done every pick chance is 0% or 100%. Jacob asked whether picks are by rank or SPR (captains by rank, picks by SPR) and chose to measure a change before shipping one.

## Pre registered (Jacob, before any numbers)
- Win rule: pooled Brier lower AND pooled log loss (1% floor) lower AND pooled accuracy the same or higher, against the fixed SPR draft.
- If the 2016 onward and 2023 onward table sets disagree, report both and Jacob decides. (They agree.)

## What was measured
The candidate draws, at each pick turn, a position in the list of still available teams sorted by SPR, from a measured pmf of where real picks sat in that list: one pmf for first picks, one for second picks, each built only from seasons before the scored one. Positions are measured against each team's SPR after its last qualification match at that event (the 10-02 replay path, the same number the simulation picks by). Each table is cut to the teams still available and rescaled; if none falls on an available team the best available is taken.

Every event scored at Quals done (the real final ranking, no remaining matches), so only the picks are uncertain. The question: each ranked team's chance of being on an alliance (captain or pick; a backup is not). Every arm ran through the shipped `simulateDistrictEvent`, 1000 draws, seed 20260830.

- (a) today's fixed SPR draft
- (b) random pick draft, tables from 2016 to the season before
- (b2) the same, tables from 2023 to the season before (scored 2024 to 2026)
- (c) a fixed draft by qualification rank

Command: `npx tsx scripts/measureRandomPickDraft.ts --stability --json data/local-publish/pick-draft/261014-mji.json`. Report: `data/local-publish/pick-draft/261014-mji-report.txt` (gitignored). SPR is `spr@11.0.0+baseline`, replayed 2016 to 2026.

## In sample, stated plainly
- SPR's settings were tuned on corpus seasons that include the scored ones (all arms share this).
- The captain rule and serpentine order were measured on 2023 to 2026 (all arms share this).
- The candidate's shape (one position pmf per round) was chosen after the published 2026 position figures and the 2026ncash case were seen. The tables themselves are walk forward.
- The Quals done ranking is the real final ranking, which isolates the picks.

## Population
485 eight alliance district events, 17,412 teams (2023: 110 / 3,932; 2024: 114 / 4,119; 2025: 120 / 4,308; 2026: 141 / 5,053), the same usable count as 10-02. Excluded: 16 divisioned DCMP parents (micmp, necmp, oncmp, txcmp, 2023 to 2026) and 6 events with an alliance team missing a ranking row (demo teams). 2026isde3 and isde4 have no alliance rows. The simulation threw on 0 events. Table census 2016 to 2026: 987 events, 15,792 pick turns.

## Primary result: chance of being on an alliance

| season | arm | teams | Brier | LL 0.01 | accuracy | called wrong |
|---|---|---|---|---|---|---|
| 2023 | (a) fixed SPR | 3932 | 0.1368 | 0.6388 | 86.32% | 538 |
| 2023 | (b) 2016 on tables | 3932 | 0.0945 | 0.2948 | 86.37% | |
| 2023 | (c) fixed rank | 3932 | 0.1796 | 0.8351 | 82.04% | 706 |
| 2024 | (a) | 4119 | 0.1190 | 0.5567 | 88.10% | 490 |
| 2024 | (b) | 4119 | 0.0845 | 0.2699 | 88.59% | |
| 2024 | (b2) 2023 on tables | 4119 | 0.0836 | 0.2670 | 88.42% | |
| 2024 | (c) | 4119 | 0.1811 | 0.8423 | 81.89% | 746 |
| 2025 | (a) | 4308 | 0.1309 | 0.6116 | 86.91% | 564 |
| 2025 | (b) | 4308 | 0.0912 | 0.2877 | 87.12% | |
| 2025 | (b2) | 4308 | 0.0915 | 0.2894 | 87.02% | |
| 2025 | (c) | 4308 | 0.1936 | 0.8996 | 80.64% | 834 |
| 2026 | (a) | 5053 | 0.1421 | 0.6630 | 85.79% | 718 |
| 2026 | (b) | 5053 | 0.0959 | 0.2999 | 85.93% | |
| 2026 | (b2) | 5053 | 0.0966 | 0.3039 | 85.89% | |
| 2026 | (c) | 5053 | 0.1904 | 0.8849 | 80.96% | 962 |
| POOLED | (a) | 17412 | 0.1327 | 0.6197 | 86.73% | 2310 |
| POOLED | (b) | 17412 | 0.0917 | 0.2886 | 86.95% | |
| POOLED | (b2), 2024 to 2026 | 13480 | 0.0910 | 0.2880 | 87.03% | |
| POOLED | (c) | 17412 | 0.1865 | 0.8672 | 81.35% | 3248 |

## Calibration, pooled
Today's draft: 5,772 teams at exactly 0%, of whom 20.0% were picked; 11,640 at exactly 100%, of whom 90.1% were. The fixed rank draft: 28.1% and 86.0%.

Random pick draft (b), n / predicted / observed: (0, 0.1) 2005 / 4.5% / 6.6%; [0.1, 0.2) 1187 / 15.0% / 16.0%; [0.2, 0.3) 897 / 24.9% / 24.9%; [0.3, 0.4) 796 / 35.8% / 32.4%; [0.4, 0.5) 832 / 44.9% / 39.9%; [0.5, 0.6) 707 / 55.5% / 51.9%; [0.6, 0.7) 817 / 64.9% / 65.2%; [0.7, 0.8) 1006 / 75.3% / 74.2%; [0.8, 0.9) 1209 / 85.3% / 85.6%; [0.9, 1) 3352 / 96.4% / 97.7%; exactly 0: 55 / 0% / 1.8%; exactly 1: 4549 / 100% / 100% (captains). (b2) is similar; see the report.

## Brier by real rank band, pooled
| band | (a) | (b) | (b2) | (c) | teams |
|---|---|---|---|---|---|
| 1 to 8 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 3880 |
| 9 to 16 | 0.0729 | 0.0534 | 0.0497 | 0.0719 | 3880 |
| 17 to 24 | 0.2242 | 0.1491 | 0.1478 | 0.3466 | 3880 |
| 25 and below | 0.2005 | 0.1405 | 0.1416 | 0.2814 | 5772 |

## Named example: 2026ncash
frc6932 (rank 21, really alliance 7 second pick): (a) 0.0%, (b) 25.0%, (b2) 21.9%, (c) 100.0%. Of 30 teams, (a) called 4 wrong: frc9605 (rank 15, off; b 87.4%), frc9607 (rank 16, off; b 55.9%), frc6932 (rank 21, on; b 25.0%), frc9762 (rank 26, on; b 21.9%).

## Secondary, pooled
| arm | slot Brier | slot LL 0.01 | playoff bucket Brier | bucket LL 0.01 |
|---|---|---|---|---|
| (a) | 1.0300 | 2.3716 | 0.5831 | 1.2642 |
| (b) | 0.6183 | 1.5410 | 0.4941 | 0.9589 |
| (b2) | 0.6054 | 1.4982 | 0.4859 | 0.9418 |
| (c) | 1.3061 | 3.0074 | 0.7117 | 1.5777 |

Slot = the exact alliance and slot (25 classes); playoff bucket = 1st, 2nd, 3rd or 4th, 5th to 8th, not picked.

## Stability and sensitivity
- (b) at seed 20260831: Brier 0.0915 vs 0.0917, LL 0.2878 vs 0.2886, accuracy 86.90% vs 86.95% (still above (a)'s 86.73%).
- (b) over (b2)'s seasons only: Brier 0.0909 vs 0.1315, LL 0.2868 vs 0.6141, accuracy 87.12% vs 86.85%: WIN. The two table sets agree.

## Verdicts (pre registered rule)
- (b) random pick, 2016 onward tables, 2023 to 2026: **WIN** (Brier 0.0917 vs 0.1327; LL 0.2886 vs 0.6197; accuracy 86.95% vs 86.73%; Brier lower in 4 of 4 seasons).
- (b2) random pick, 2023 onward tables, 2024 to 2026: **WIN** (Brier 0.0910 vs 0.1315; LL 0.2880 vs 0.6141; accuracy 87.03% vs 86.85%; 3 of 3 seasons).
- (c) fixed rank draft: **NO WIN** (Brier 0.1865; LL 0.8672; accuracy 81.35%; 0 of 4 seasons).

Accuracy wins by a thin margin (+0.22 points pooled, about 38 teams of 17,412); Brier and log loss by a wide one.

## Inert at default
Every existing test in `ledgerSimulation.test.ts` passes with no existing line edited; also `selectionModel.reconciliation.test.ts`, `districtBake.test.ts`, `browserSafeSchemas.test.ts`, `districtSimulationProtocol.test.ts`. A pmf of [1] for both rounds deep equals the run without the option. No caller passes the option (`grep pickPositionPmf` over apps, packages/harness and the publish scripts: 0). No version string, methodology page or published number changed. The candidate draws from its own separate stream, built only when the option is set, one value per pick turn.

## Commits
- 4d00c23a feat: an inert random pick draft option and one event measured end to end
- 25006c4b feat: score the random pick draft against the fixed SPR draft and a rank draft, walk forward
- 57fac333 chore: record the measured random pick draft against the fixed SPR draft

## Verification
- Executor: ledgerSimulation.test.ts 150 of 150 (Task 1); packages/core/districts plus apps/web/src/components/districts 2116 of 2116 (Task 2); typechecks 0 / 0 / 0 after Tasks 1 and 2.
- At Task 3, 2 award tests in ledgerSimulation.test.ts and 2 root typecheck errors in award test files failed while another session (261014-mii) held uncommitted award edits; Task 3 was comment only.
- Orchestrator, after: `npx vitest run scripts/measureRandomPickDraft.test.ts scripts/measureSelectionAgreement.test.ts packages/core/districts/selectionModel.reconciliation.test.ts packages/harness/districtBake.test.ts`: 4 files, 79 passed. The report file carries the three VERDICT lines above.

## Deviations
1. The VERDICT applies Jacob's three part rule (the plan's line asked only for Brier and log loss).
2. Task 3 commit prefix chore rather than docs.
3. Extra named assertions in the script (SlotTallyMismatchError, PlayoffBucketMassError, DuplicateRankError), none fired.

## Self-Check: PASSED
