---
phase: quick-261014-qv2
plan: 01
subsystem: districts / Locks simulation
tags: [locks, advancement-chance, joint-draw, web-worker, bake, backtest]
status: complete
requires: [261014-ol6 weighted pick draft (on this branch)]
provides: [DistrictLedgerEventInput.recordEventTotalByRun, DistrictEventTotalByRun, allocateEventTotalByRun, AdvancementChanceInputs.jointEvents, AdvancementChanceTeam.jointEventKeys, independentEventKeys, DistrictBakeParams.recordEventTotalByRun, MAX_DISTRICT_CHANCE_JOINT_CELLS, scripts/jointDrawCallers.test.ts, --independent-draws backtest arm, CHANCE CALIBRATION report block]
affects: [District Locks chance and predicted cutoff (Live, as of REAL, as of GENERATED), Champ Locks field chances (its district run), measureDistrictCutoff, measureLocksInRange]
key-files:
  created:
    - packages/core/districts/ledgerSimulation.eventTotalByRun.test.ts
    - packages/core/districts/advancementChance.joint.test.ts
    - apps/web/src/components/districts/districtJointDraw.test.ts
    - scripts/jointDrawCallers.test.ts
  modified:
    - packages/core/districts/ledgerSimulation.ts
    - packages/core/districts/advancementChance.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerChances.ts
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/districts/districtRunAssembly.ts
    - apps/web/src/components/districts/useDistrictLedgerData.test.ts
    - apps/web/src/workers/districtAsOfJob.ts
    - apps/web/src/workers/districtSimulationProtocol.ts
    - apps/web/src/workers/districtSimulationProtocol.test.ts
    - packages/harness/districtBake.ts
    - packages/harness/districtBake.test.ts
    - scripts/measureDistrictCutoff.ts
    - scripts/measureDistrictCutoff.test.ts
    - scripts/measureLocksInRange.ts
    - scripts/measureChampCutoff.ts
decisions:
  - "Only each event's total per team per run is kept (Uint8Array at the district tier); one allocation rule shared by the simulation and the bake."
  - "One uniform per referenced joint event per advancement run picks that event's run; with no referenced event the loop is the shipped one, byte for byte."
  - "The Champ Locks champ run stays independent (the core refuses joint input in champ mode); only the Champ tab's district run draws jointly."
  - "An event with no per run data (a published sidecar) falls back to the independent draw for that event only, named in independentEventKeys."
  - "No version bump: no stored artifact, schema, Worker or publisher output changes."
metrics:
  completed: 2026-10-14
actuals:
  tasks: 3
  commits: 4
---

# Quick 261014-qv2: draw each event's points jointly in the advancement run

The weighted pick draft (261014-ol6, this branch) widened each team's alliance points marginal, and because the advancement run drew every team's season total independently, the District Locks cutoff range held the settled cutoff at 194 of 205 backtest positions (94.6%), above the registered 72% to 88% band. Jacob held the push and chose to fix the cause: every team at one event now reads its points from the same simulated run of that event, so points stay conserved inside the event. "Likely" keeps meaning 8 of 10 runs.

## Registered bars (set in the plan before any joint number; unchanged)
| Bar | Measured | Result |
|---|---|---|
| G1 joint: simulated line MAE below the midpoint rule's, pooled | 1.20 (1.1951) < 1.93 (1.9317), n = 205 | PASS |
| G2 joint: range holds the settled cutoff in 148 to 180 of 205 | 179 of 205 (87.3%) | PASS |
| P1 independent arm reproduces the ol6 after run exactly | 194 of 205, 1.19 vs 1.93, 2,364 of 3,129, 579 of 874; 0 diffs over all 205 positions | PASS |
| P2 champ cutoff output identical, check-history no drift | identical, no drift | PASS |
| P3 publisher bake byte identical | 29 of 29 files identical once the run's wall clock `generation` stamp is masked; the literal diff differs only in that stamp | PASS in content (the orchestrator accepted it: the stamp is the run time, not output) |
| P4 full suite and three typechecks | typechecks 0 / 0 / 0; 3 load timing failures, each passes alone | PASS |

## Independent vs joint
| Measure | Independent (weighted draft) | Joint |
|---|---|---|
| Simulated MAE / midpoint MAE | 1.19 / 1.93 | 1.20 / 1.93 |
| Range holds settled | 194 of 205 (94.6%) | 179 of 205 (87.3%) |
| Mean range width (p90 minus p10) | 4.91 | 3.92 |
| Season start coverage | 46 of 48 | 37 of 48 |
| In range to locked, district | 75.6% (2,364 of 3,129) | 75.7% (2,359 of 3,116) |
| In range to locked, champ | 66.2% (579 of 874) | 66.0% (577 of 874) |
| Qualifying chance calibration Brier (report only, 28,236 pairs) | 0.11342 | 0.11341 |

The 15 positions lost each sit one point outside the narrowed range. Low qualifying chances under predict on both arms. Largest joint request: 4,244,000 bytes at 2026fim season start, under the 2^24 cell cap.

For the record, the fixed draft with independent draws (before 261014-ol6) read 1.25 vs 2.43 and 183 of 205 (89.3%, gate 2 FAIL).

## Commits
- 4723a1d5 feat: a Live in progress event is drawn once per advancement run, shared by every team at it
- c542504e feat: the GENERATED bake, the Worker boundary and every other caller draw jointly; caller guard
- a169fa57 feat: the backtests get an independent draws arm, report only chance calibration and the largest joint request
- 20c632f7 chore: record the joint draw measurement in both backtest headers

## Verification (executor, worktree)
- Full root suite under contention: 9,517 passed, 3 failed (DistrictLedger "SECOND Worker", "is shareable ... opens the drawer on first paint", spr.test.ts frc4414 30 s timeout), all three pass alone (142 of 142).
- Typechecks root, apps/web, apps/web e2e: 0 errors.
- ledgerSimulation.test.ts and advancementChance.test.ts untouched and green.

## Deviations
1. The Worker boundary checks typed arrays by their `Object.prototype.toString` tag (a structured clone from another realm fails `instanceof`).
2. useDistrictLedgerData.test.ts strips the new district only flag before comparing the dcmp input.
3. The as of GENERATED test builds its input in `generatedRequest`'s shape; the guard pins the flag inside `generatedRequest`.

## Copy handed to 261014-ol7 (applied in 0ec696eb)
- "Each team's total is drawn on its own, so the runs miss the fact that two teams at one event compete for the same points." replaced.
- Backtest figures now 1.2 vs 1.9 and 179 of 205, 87%.
- "The Champ Locks tab reads its predicted cutoff the same way, with one step added." now says the champ run draws each team's district points on their own.
- The source 9 header comment carries the new figures and the history.

## Follow ups for Jacob (not done)
- In a live season every unstarted event comes from a published sidecar, so Live at season start keeps the wider independent range for those events. Fixing that means per run totals in the sidecar (an artifact change, version bump and republish) or baking those events in the browser.
- Whether the Champ run's district points should be drawn jointly too.

## Self-Check: PASSED
