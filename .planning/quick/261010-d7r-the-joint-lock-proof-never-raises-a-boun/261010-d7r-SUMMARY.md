---
phase: quick-261010-d7r
plan: 01
subsystem: districts
tags: [champ-locks, joint-proof, lock-math, monotone, live, divisioned-championship]
status: complete
requires: [261010-66y, 261009-pgq, 261009-tx9, 261009-kt3, 261009-2tr, 261009-vp9, 261009-r9x]
provides:
  - "awardedRivals on the joint proof's input: a rival that holds a posted award takes no further judged award"
  - "jointProofStillRuns: a divisioned or two championship proof stops only once every key's Awards are final"
  - "listedOnly on a rival: a listed pick that is not confirmed is paid its placed alliance's value or takes another seat, never both"
  - "championshipShape with finalsMayBeAbsent: the divisioned proof runs before the finals key is on the artifact, while the field is proven by capacity"
  - "scripts/champJointMonotone.test.ts: the monotone property over every edge of four lattices and 58 live walks, each rule shown to bite"
affects: [apps/web Champ Locks tab, packages/core/districts]
tech-stack:
  added: []
  patterns:
    - "a monotone property checked edge by edge over a lattice of readings, which covers every order the facts can arrive in"
    - "one module mock of the core proof that switches exactly one rule off per mode, so each rule is shown to bite through the import the tab uses"
    - "an earliness rule held by two separate proofs: an equivalence gate at rewound stops and live walks tick by tick"
key-files:
  created:
    - scripts/champJointMonotone.test.ts
  modified:
    - packages/core/districts/champJointLock.ts
    - packages/core/districts/champJointLock.test.ts
    - packages/core/districts/finalsBracket.ts
    - packages/core/districts/finalsBracket.test.ts
    - apps/web/src/components/districts/champLedgerStatus.ts
    - apps/web/src/components/districts/champLedgerStatus.test.ts
    - apps/web/src/components/districts/useDistrictLedgerData.ts
    - apps/web/src/components/districts/useDistrictLedgerData.test.ts
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - scripts/measureChampJointLocks.ts
    - scripts/measureChampJointLocks.test.ts
    - scripts/champFieldStagedWalk.test.ts
decisions:
  - "D1's clause denying an awarded rival a consuming award was NOT applied (premise P1): it is false in the data and it put the bound below a legal future at 406 of 20,000 instances"
  - "a finished championship of two is budgeted on the teams at exactly one judged award's points, not on every team with award points (run A deviation 1, the sound side)"
  - "the decided winner's listed pick is read without its settled value only where every frame names one and the same winner (run B deviation 1)"
  - "D2 landed: the equivalence gate and the live walks both hold, so the refusal of 261010-66y is lifted and todo item 10 is struck"
  - "the two forced edges stay FORCED and NOT REQUIRED; D2 makes both lose more when forced, because the proof holds more and holds it earlier"
metrics:
  duration: "three executor runs, about 65, 70 and 75 minutes"
  completed: 2026-10-10
  tasks: 5
  commits: 6
  files: 13
actuals:
  tokens: 99608
  tasks: 5
  commits: 6
---

# Quick task 261010-d7r: the joint lock proof never raises a bound, and the divisioned proof runs before the finals key exists

The Champ Locks joint proof is now monotone as well as sound over every order of facts that was walked: four rules close four measured places where a team shown Locked could later read not Locked, and the divisioned proof runs from the tick the alliance points land at a live championship. Nothing is pushed and nothing is deployed. Only a push is owed.

## Commits (all on `main`, unpushed, six ahead of `origin/main`)

| Task | Hash | Subject |
| --- | --- | --- |
| 1 | `f3239319` | fix(261010-d7r): a rival that already holds a posted award takes no further judged award in the joint proof |
| 2 | `ba46dde8` | fix(261010-d7r): the joint proof keeps running until every championship key's awards are final |
| 3 | `9445a047` | fix(261010-d7r): a listed pick that is not confirmed is paid its decided alliance's value or takes another seat, never both |
| 3 | `3afa3b97` | test(261010-d7r): the micro step live walks hold the joint proof one fact at a time, with each rule switched off shown |
| 4 | `8d817b1c` | feat(261010-d7r): the divisioned joint proof runs before the finals key is on the artifact |
| 5 | `72cc0830` | docs(261010-d7r): the joint proof's headers state the four rules and their limits |

Run A did Tasks 1 and 2, run B Task 3 (two commits, allowed by the orchestrator), run C Tasks 4 and 5 and this summary. No `.planning/` file is committed.

## The defect and its exact mechanism

Shipped by quick tasks 261009-kt3, 261009-pgq and 261009-tx9, found by run 2 of quick task 261010-66y.

- The status code hands the proof a judged award budget per division: the whole ceiling of 14 while that division's Awards are open, and `max(0, 14 - awarded teams)` once they read final (the remaining budget rule of 261009-pgq, kept because the awards flag does not say every judged award is in).
- While a division's Awards are open, none of its award points is in any floor and the proof gives each rival at most one award. Once they read final the posted points ARE in the floors, and the proof still spent the rest of the budget on ANY rival, one that already held a posted award included. That rival then carried two judged awards, which no earlier reading allowed. Its maximum rose, so a team's bound rose, and a Locked the proof gave a tick earlier was taken back.
- The term, exactly: two places in `champJointLock.ts` spent the award. A rival on an alliance still short of T after its alliance's value was lifted by `judgedCost`; and a rival on no alliance was covered by `unpickedCover`, alone or on a seat. Closing the first alone lost none of the eleven teams and left 62 rises (largest 4). Closing the second alone lost all eleven and left 282 rises. Both: 0 and 0. The consuming awards and the fill ins took no part.
- Measured at the code before this task, over the 16 divisioned championships of 2023 to 2026. Reading A is every division's Playoffs final with its Awards open and the finals not started; reading B is the sweep's "Divisions final, finals not started". 406 shown Locked at A, 436 at B, eleven teams Locked at A and not at B, and 312 pool teams' bounds higher at B, the largest by 7. No sweep stop sits between A and B, which is why `take-backs 0` never saw it.
- It was reachable live wherever the proof ran before a division's awards flag turned true.

## What was built

### Rule 1, D1 (Task 1): a rival that holds a posted award takes no further judged award

`JointLockInput.awardedRivals` names the teams carrying award points above 0 at a division whose Awards read final. The bound gives each no judged award in the two places above. Its posted points stay in its floor. The budget of a final division is unchanged and goes only to rivals with no posted award. With no division's Awards final the input carries no `awardedRivals` key, so that input is the one of before.

Premise P1, NOT applied: CONTEXT D1 also denied an awarded rival a consuming award's place. That is false in the data (six times at 2017 and 2018 FIM a team held a division judged award and then won Impact or Rookie All Star at the finals: frc2834 twice, frc245, frc1718, frc6344, frc6637; since 2023, 0 of 478 awarded division rows). With the clause on, the brute force put the bound below a legal future at 406 of 20,000 instances. An awarded rival still counts through a consuming award and as the winner's backup. CONTEXT D6 withdrew the clause.

### Rule 2, finding F-B (Task 2): a divisioned proof stops only once EVERY key's Awards are final

`jointProofStillRuns(championshipAwardsFinal, anotherKeysAwardsOpen)`. The proof used to stop at the finals' Awards alone. Awards flags turn true one event at a time in no fixed order, and where the finals' flag turned true before a division's the ceiling test could not hold what the proof had held. Past the finals' Awards the proof is handed no consuming award. The Live fetch set keeps a divisioned championship's started keys until every one of its events has finished.

### Rule 3, finding F-C (Task 2): two championships stop only once BOTH are final

2026 California. While one championship is finished and the other is not, the proof runs (`mixedMultipleJointProof`): the finished championship needs no bracket facts, must have its Winner counted, and its input holds no alliance, no consuming award, its awarded teams and what is left of its judged budget.

### Rule 4, finding F-D (Task 3): a listed pick that is not confirmed is paid its placed alliance's value or takes another seat, never both

`JointLockRival.listedOnly` (`settled`, `onWinner`). A team an alliance lists at 0 alliance selection points is not a member once the alliance is placed, yet the row model settles its Playoffs at the alliance's placement (live: the placement's maximum, in `extra`). The proof went on offering it another alliance's seat, so it read one alliance's value plus another's. Now it is read at `extra` alone and at `extra` minus `settled` on a seat. The decided winner's such pick is counted through the winner's fill in. Live only: a rewound settled value is exact and in the floor.

### D2 (Task 4): the divisioned proof runs before the finals key is on the artifact

`championshipShape(keys, finalsMayBeAbsent = false)`: with the option, 2 or 4 division keys of one stem and no parent are a divisioned championship whose finals have not started. One or three division keys, and any set holding the parent, read as without it. The tab hands it only at the live position while the field proof is complete by capacity, to the status code, the data hook and the Live fetch set. Nothing in the proof changed: a finals key on no row has no stage, no facts and no Winner.

D2 is an earliness rule. It has NO rule off switch in the monotone file. Two separate proofs hold it, and neither stands in for the other:

1. **The equivalence gate** (`scripts/champFieldStagedWalk.test.ts` group 13): 16 divisioned championships, 112 stops before the finals have a played row, the proof applied at all 112. With the finals key's rows removed (and the option handed) against present, the number of stops that differ: reason 0, input 0, bounds 0 (28,140 pool bounds compared), joint locked set 0, reservation 0, points slots 0, floor 0, ceiling 0, teams shown Locked 0, `lockedBy` 0. The planner's scratch script run against the final tree reads the same.
2. **The live walks** (group 10, and group D of the monotone file): no Locked team lost at any tick. Numbers below.

Quick task 261010-66y built this reading and refused it because the live walks took 1 Locked back at 2026 FIM (frc5675), 2 at NE (frc4909, frc2713) and 2 at TX (frc624, frc9140). With rule 1 in, the same walks take none. The drop rule did not fire.

## Measured numbers, each rule on and off

### The sweeps (D4)

Task 1 moved the joint sweep at exactly the ten divisioned rows the planner measured, all upward, shipped unchanged on every row:

```
2023fit  Divisions final, finals not started  joint only 8 -> 9   | combined 17 -> 18
2023ne   Divisions final, finals not started  joint only 4 -> 5   | combined 20 -> 21
2023ont  Divisions final, finals not started  joint only 3 -> 4   | combined 12 -> 13
2024ont  Divisions final, finals not started  joint only 5 -> 7   | combined 10 -> 12
2025fit  Divisions final, finals not started  joint only 2 -> 3   | combined 15 -> 16
2025ont  Divisions final, finals not started  joint only 1 -> 5   | combined 9 -> 13
2026fim  Divisions final, finals not started  joint only 36 -> 37 | combined 65 -> 66
2026fim  Finals after sf1 and sf2             joint only 36 -> 37 | combined 65 -> 66
2026fit  Divisions final, finals not started  joint only 4 -> 6   | combined 15 -> 17
2026ne   Divisions final, finals not started  joint only 6 -> 8   | combined 18 -> 20
```

Totals after Task 1, unchanged by Tasks 2 to 5: divisioned shipped 1608, proof alone 1290 (was 1274), combined 2898 (was 2882), qualifiers locked at an earlier stop 403. Every championship: 1989, 1766 (was 1750), 3755 (was 3739), 591 (was 577). Single 340, 414, 754, 167. Two championship 41, 62, 103, 21. All 31 single blocks and the California block byte identical.

Tasks 2, 3, 4 and 5 moved no gate line. **That shows only that no rewound stop changed.** It says nothing about rules 2 to 4 or D2: a rewound reading never has the finals' Awards final before a division's, never has one California championship finished alone, and carries no `listedOnly`. The lattices and the live walks of `scripts/champJointMonotone.test.ts` are what check F-B, F-C and F-D, and the equivalence gate and the live walks are what check D2.

### The eleven teams (walk file group 9)

Shown Locked over the 16 championships: A 406 and B 436 before; A 406 and B 451 after. Lost from A to B: eleven before, none after, now a requirement. Each of the eleven is `locked` by `joint` at both readings:

| District | Team | Bound A then B before | after | Points slots |
| --- | --- | --- | --- | --- |
| 2023fit | frc9105 | 29 then 30 | 29 then 29 | 30 |
| 2023ont | frc4069 | 22 then 25 | 22 then 22 | 23 |
| 2024ont | frc5406 | 21 then 23 | 21 then 21 | 23 |
| 2024ont | frc7712 | 22 then 24 | 22 then 22 | 23 |
| 2025fit | frc418 | 27 then 28 | 27 then 27 | 28 |
| 2025ont | frc4039 | 21 then 24 | 21 then 21 | 22 |
| 2026fim | frc5675 | 81 then 83 | 81 then 81 | 83 |
| 2026fit | frc624 | 27 then 28 | 27 then 27 | 28 |
| 2026fit | frc9140 | 27 then 29 | 27 then 27 | 28 |
| 2026ne | frc2713 | 31 then 33 | 31 then 31 | 32 |
| 2026ne | frc4909 | 31 then 33 | 31 then 31 | 32 |

### Group A, the awards order lattice (rewound, 16 championships)

156 stops, 1200 readings (applied 1184, `stageNotEligible` 16: the one reading per championship where every key's Awards are final), 1968 flag edges, 1088 stop edges.

| Mode | Locked lost | Margin drops |
| --- | --- | --- |
| Rules on | 0 | 0 |
| Awarded rule OFF | 957, all over flag edges, 163 distinct district and team pairs | 33,355 team margins over 1776 flag edges, largest 4 |
| Stop rule OFF (the last sweep stop and "Finals awards final", 224 readings) | 306, every one over the stop edge into "Finals awards final", 129 distinct pairs | 0 |

Awarded rule off by district: 2023fim 118, 2023fit 4, 2023ne 6, 2023ont 10, 2024fim 239, 2024fit 7, 2024ne 9, 2024ont 10, 2025fim 215, 2025fit 9, 2025ne 0, 2025ont 15, 2026fim 287, 2026fit 13, 2026ne 10, 2026ont 5. Stop rule off by district: 24, 8, 4, 6, 80, 2, 8, 4, 49, 7, 4, 1, 90, 1, 16, 2 in the same order (63 over the 12 two division championships). Before the "Finals awards final" reading was added (Task 1's state): 140 stops, 1088 readings, 1792 flag edges, 976 stop edges, awarded rule off 924 lost, 148 pairs, 1640 edges with a drop, 29,359 margins.

### Group B, divisions out of step (rewound)

- The 12 two division championships, every ahead set: 24 ahead sets, 288 readings, 144 flag edges, 240 stop edges. Rules on 0 and 0. Awarded rule off: 49 lost over flag edges, 772 margins, largest 3.
- The four FIM seasons, one division ahead at a time: 16 ahead sets, 192 readings, 96 flag edges, 160 stop edges. Rules on 0 and 0. (The planner ran every ahead set there once: 1536 readings, 0 and 0, about 280 seconds a season.)
- No stop rule run: no reading of group B has the finals' Awards final.

### Group C, two championships (2026 California, rewound)

- One championship finishing first, rules on: 7 stops, 28 readings, applied at all 28, 14 flag edges, 24 stop edges, 0 lost, 0 drops.
- The awards lattice at "Playoffs final, awards open", rules on: 4 readings (applied 3, `noBracketFacts` 1 with both final), 4 flag edges, 0 and 0.
- Stop rule OFF: one finishing first applied 14 and `noBracketFacts` 14, 91 Locked lost over flag edges; the lattice 1 lost.

### Group D, the micro step live walks (58 walks), as they read at the final tree

Each walk goes live from an artifact with no championship row, one fact per tick through `applyDistrictRankings` and `applyDistrictEventState`, and reads the tab's own row builder and status code after every tick, `finalsMayBeAbsent` handed as the tab hands it.

| Set | Readings | Edges (step + flag) | Locked lost | Margin drops | What the proof said |
| --- | --- | --- | --- | --- | --- |
| 31 single championships and California | 970 | 883 (766 + 117) | 0 | 0 | noDistributions 162, stageNotEligible 33, applied 710, noBracketFacts 65 |
| 12 two division, finals key on no row | 848 | 1064 (776 + 288) | 0 | 0 | noDistributions 84, noBracketFacts 12, stageNotEligible 48, applied 704 |
| 12 two division, finals key registered | 1012 | 1392 (940 + 452) | 0 | 0 | noDistributions 84, noBracketFacts 12, stageNotEligible 48, applied 868 |
| 2026 FIM, finals key on no row | 184 | 358 (166 + 192) | 0 | 0 | noDistributions 11, noBracketFacts 3, stageNotEligible 6, applied 164 |
| 2026 FIM, finals key registered | 312 | 742 (294 + 448) | 0 | 0 | noDistributions 11, noBracketFacts 3, stageNotEligible 6, applied 292 |

3,326 readings and 4,439 edges. The corner reads the same by both orders of ticks in all 58. With the finals key on no row the proof reads `unsupportedShape` at no reading any more (before Task 4: 512 over the two division walks and 92 at FIM, with applied 228 and 79). 536 readings of the two division walks and 94 of FIM read the finals absent.

The further edges of CONTEXT D7, rules on, all 58 walks:

| Edge | Readings | Edges | Locked lost | Margin drops |
| --- | --- | --- | --- | --- |
| The Winner listed before the playoff points | 386 | 386 | 0 | 0 |
| A division's award points and settled awards list before its playoff points, through the merge's own flag rule | 112 | 112 | 0 | 0 |
| The last key's rows arriving mid playoffs (the field proof turns true) | 1235 | 1208 | 0 | 0 |

- A finals row posting with no state block is the first fact of the finals on no row chain, read at every tuple of division flags, so it is inside the walk's own counts.
- The merge's flag rule kept a division's flag false with no playoff point on a row at 56 of 56 divisions and raised it on the tick the points landed at 56 of 56.
- The field proof turned from not proven to proven on the late key's state tick at 27 of 27 walks. Over that walk the proof now reads noDistributions 116, fieldNotProven 337, applied 782 (before Task 4: applied 405 and unsupportedShape 377).
- **D2's switch turning on** (run C): in all 13 walks with the finals key on no row the absent finals reading turns on at exactly the tick the field proof turns true, the proof going from `fieldNotProven` to applied, 0 held teams lost over that edge, 4 more teams shown Locked after it than before over the 13. Asserted per walk: locks may only be added.
- The core field proof's `proven` never goes from true to false over any walked edge.

Each rule switched OFF (the ported walk alone):

| Rule off | Set | Locked lost | Margin drops |
| --- | --- | --- | --- |
| awarded | two division, finals on no row | 121, all over flag edges | 2029, largest 4 |
| awarded | two division, finals registered | 202, all over flag edges | 3236, largest 4 |
| stop | two division, both variants | 63 each, all over step edges | 0 |
| listed | 31 single championships | 0 | 25, largest 1 |
| listed | California, two division (both), 2026 FIM (both) | 0 | 0 |

- Awarded rule off, finals on no row, by district: 2023fit 8, 2023ne 7, 2023ont 12, 2024fit 3, 2024ne 9, 2024ont 18, 2025fit 13, 2025ont 14, 2026fit 14, 2026ne 19, 2026ont 4. Registered: 16, 11, 20, 3, 9, 29, 22, 26, 23, 39, 4. Before Task 4 the no row variant read 94 and 1666, because the proof started at the finals rows; 121 and 2029 are the planner's figures with this reading on.
- The listed rule off loses NO Locked team on any walk and only drops margins: 2023pnw 17 (at `f1m2`), 2026fnc 3, 2024pch 2, 2026win 2, 2024fnc 1. The planner's 26th is 2025 FIM, not among the committed walks. The test's name says so. No measured Locked rests on rule 4: it keeps a bound from rising, which is the mechanism of a take back.
- The awarded rule off and the stop rule off lose locks through the module the status code really imports, asserted above 0.

### The live walks of 2026 FIM, NE, ONT and TX (walk file group 10), with D2

Teams shown Locked, tick by tick: alliances picked, alliance points land, after Rounds 1 to 5, playoffs done, playoff points land, division award points land, every division finished, finals rows posted, finals state written, finals award points land; then the source artifact.

| District | With the option (D2) | The option held off (before D2) | End |
| --- | --- | --- | --- |
| 2026fim | 0, 1, 1, 5, 25, 35, 41, 46, 60, 60, 66, 66, 71, 71 | 0, 0, 0, 0, 0, 0, 0, 0, 13, 13, 29, 66, 71, 71 | 83 |
| 2026ne | 0, 0, 0, 1, 8, 9, 9, 12, 20, 20, 20, 20, 21, 21 | 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 12, 20, 21, 21 | 32 |
| 2026ont | 0, 0, 0, 0, 0, 6, 7, 8, 10, 10, 11, 11, 12, 12 | 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 10, 11, 12, 12 | 21 |
| 2026fit | 0, 0, 0, 2, 7, 7, 7, 8, 15, 15, 17, 17, 17, 17 | 0, 0, 0, 0, 0, 0, 0, 0, 6, 6, 11, 17, 17, 17 | 28 |

Never a step down. The proof reads `stageNotEligible` at "alliances picked" and `applied(divisioned)` at every tick from "alliance points land" to "finals award points land". No Locked taken back at any tick in either series. Every team Locked without the option is Locked with it at the same tick, and from the tick the finals rows post the two walks read every team the same. In the window (every division finished, the finals key on no row, nothing of the championship in progress) the proof holds 66, 20, 11 and 17, the same as at the finals rows tick. These are the planner's fact 13 exactly.

## Soundness evidence

- E3 with awarded rivals: 8 seeded fields, 256 teams, 69 awarded rivals, 3,821,696 futures. No rule legal future above the bound; 52 teams on their bound; the bound with the rule below the bound without it for 17 teams and above it for 0.
- Brute force, every legal future of 20,000 small instances, with listed only picks (16,657 instances) and awarded rivals (16,641) together: the bound reached at 19,693, below a legal future at 0, mean slack 0.015. (Before listed only picks joined the draw: 14,577 with an awarded rival, reached at 19,445.)
- R10 with awarded flags and with seat deficits: 20,000 seeded instances each, the cover upper bound never below the exact program.
- 500 seeded single championship instances: naming awarded rivals never raises a bound and lowers some; a placed alliance's listed pick reading is never above the reading of before rule 4.
- Mutations, run by hand and reverted, file hash checked equal before and after. P1's clause (an awarded rival denied a consuming award): the pin test fails and the brute force fails at seed 1 (real 4 above bound 3). The awarded rule off: fails the monotone tests (924 then 957) and passes every soundness test, as CONTEXT D4 asked. A placed alliance's listed pick denied its settled value alone: the brute force fails at seed 4.
- Every sweep: `VIOLATIONS: none`, `SKIPPED (0)`, `championships 48, stops 412, take-backs 0`, cutoff no drift, Now identical, publisher clean.
- D2 adds no new reading to prove sound: the equivalence gate shows the proof without the finals key IS the proof with it, input for input.

## Gate lines

- Step 0 of each run: `D8 GATES IDENTICAL` (run A against the planner's base; run B against `after-t2`; run C against `after-t3`). All gate tooling present at each.
- Task 1: `P12 GATE HOLDS`, `D7R T1 GATE HOLDS` (the moved rows are the planner's ten line for line, no combined Locked count dropped, no champ tenets row moved).
- Tasks 2, 3 and 4: `D8 GATES IDENTICAL` against the task before and against `after-t1`.
- Final tree (`72cc0830`, saved as `exec/final`): `D7R T1 GATE HOLDS` against the task's base (`P12 GATE HOLDS`, rows moved 10, gained 16, the planner's ten line for line, no champ tenets row moved), and `D8 GATES IDENTICAL` against both `after-t1` and `after-t3`: joint 1200 lines compared, champ 129, ledger 163, settled 35, cutoff no drift for both generated files, `championships 48, stops 412, take-backs 0`, Now identical on both tabs (artifacts 109, teams 16345), `UL3 COMPARE CLEAN`, `R9X COMPARE CLEAN`, every gate exit 0.
- `WORKER BUNDLE UNTOUCHED` after every task; on the final tree `WORKER BUNDLE UNTOUCHED (13 files probed)` for every file changed since the baseline `8b5f6a9f`, closure 103 files.
- `TYPECHECKS CLEAN (root, web, e2e, worker)` after every task and on the final tree.
- Full root `REQUIRE_LOCAL_DATA=1 npx vitest run` on the final tree: 356 files passed, 8901 tests passed, 1 skipped (`packages/ingest/rankingsLive.test.ts`, which needs the TBA key and the network; confirmed by running that file alone with the verbose reporter), 879 s wall. After Task 2 it read 356 files and 8813 tests; after Task 3, 356 and 8889.
- Task 4's verify set (9 files): 457 tests passed, 0 skipped.

## Pins moved, each with its reason

Every one was replaced with the executed value. None was fitted.

Task 1 (rule D1):
1. `scripts/measureChampJointLocks.test.ts`, fim 2026 "Divisions final": the set gains frc5675 (65 to 66); `nearMisses` "frc5675 frc3707" to "frc3707".
2. Same file, ne 2026 "Divisions final": gains frc2713 and frc4909 (18 to 20); `nearMisses` to "".
3. Same file, ne 2026 "Finals decided, awards open": gains the same two (16 to 18).
4. Walk file group 9: retitled CLOSED; `lost` is `[]` as a requirement; 16, 406, 436 to 16, 406, 451; the eleven kept as a record and pinned Locked at both readings.
5. Walk file group 10 at "finals rows posted, no state": FIM 65 to 66, NE 18 to 20, TX 15 to 17, and the `held` pin the same.

Task 2 (rules 2 and 3):
6. `champLedgerStatus.test.ts`, "The finals' Awards final refuse": refused now only with both divisions' Awards final too; with them open the same state is applied.
7. Monotone file group A: counts re pinned for the added reading (1088, 1792, 976 to 1200, 1968, 1088; 924, 148, 1640, 29,359 to 957, 163, 1776, 33,355).

Task 3 (rule 4):
8. `champJointLock.test.ts`, the brute force: `{ withAwarded 14_577, onBound 19_445 }` to `{ withListedOnly 16_657, withAwarded 16_641, onBound 19_693 }`, because listed only picks joined the seeded draw.

Task 4 (D2), all in the variant with the finals key on no row:
9. Walk file group 10 `shown`: the series of the table above replaces the series of before, upward only at every tick before the finals rows post. The series of before is kept as the pin of the option held off.
10. Walk file group 10 `held`: gains the window pins (66, 20, 11, 17); the finals rows pins did not move.
11. Monotone group D, what the proof said: two division no row `{noDistributions 84, unsupportedShape 512, applied 228, stageNotEligible 24}` to `{noDistributions 84, noBracketFacts 12, stageNotEligible 48, applied 704}`; FIM no row `{11, unsupportedShape 92, applied 79, stageNotEligible 2}` to `{11, noBracketFacts 3, stageNotEligible 6, applied 164}`. Applied then refused 36 and 5, unchanged. Readings and edges unchanged.
12. Group D late rows: `{noDistributions 116, fieldNotProven 337, applied 405, unsupportedShape 377}` to `{116, 337, applied 782}`.
13. Group D awarded rule off, no row: 94 lost and 1666 margins to 121 and 2029.
14. Group D forced flag: 34 lost, 28 distinct pairs, 498 margins (both variants together) to 28 lost, 22 pairs and 498 margins in EACH variant (56 and 996 together). The proof now runs at these ticks in the no row variant too, and the two variants read the same.
15. Group D forced field: 596 lost and 59 applied then refused to 765 and 85; 510 distinct pairs unchanged.

No pin of the registered or one event walks moved in Task 4, and no existing `champLiveFetchKeys` pin moved in any task.

## Readings taken

- R1 to R5, R8, R9 and R11 as the plan states them.
- R2 (T itself): nothing in code; `awardedRivals` may name T and the rivals list excludes T. A core test pins that naming T changes nothing.
- R4 (the cover upper bound with flags): the free rivals' bound, plus the awarded rivals a seat alone covers (greedy), plus awarded rivals with a deficit at or below 0 counted directly.
- R6 (a finished championship of two) with one change, deviation A1 below.
- R7: the divisioned input names only the listed picks of alliances placed below first in their division.
- "In progress" for the fetch rule is `stage.started && !stage.finished`.
- A settled ceiling of 0 sets no `listedOnly`. A backup seen on the field that no pick list names has no settled value and carries none.
- The merges' published verdict pass reads the real clock in the micro walks; the tab's reading is handed the artifact's year and reads nothing that pass writes but `prequalified`.
- "The field proof" in the walks' assertions is the core proof's own `proven`, not the row model's flag.
- Run C: the walks hand `finalsMayBeAbsent` exactly as the tab derives it (`completeBy === "capacity"` at the live position), in EVERY variant, not only where the finals key is on no row. Where the finals key is on a row it changes nothing, and those pins did not move.
- Run C: the equivalence gate compares every pool team's bound and the points slots as well as the plan's columns.

## Deviations

Run A:
- **A1 [soundness].** The finished championship's judged budget in `mixedMultipleJointProof` is `max(0, 14 - teams at exactly one judged award's points)`, not the plan's `14 - every team with award points`. A whole championship's rows also carry the consuming awards' points and the ceiling of 14 counts judged awards alone; at each 2026 California championship 16 teams carry award points, so the plan's reading gave a budget of 0 where 2 may still be listed, the unsound side. `awardedRivals` is still every team with award points there. Group C reads 0 and 0 and no sweep line moved.
- A2. Group C walks 24 stop edges the plan did not ask for.
- A3. Group A's stop rule off run reads two stops, not the whole lattice (the rule changes no other reading).
- A4. Comment only edits outside the tasks' file lists (`ChampLocksLedger.tsx`, one comment of the walk file, decision 4's quote of the corrected core sentence).
- A5. Extra tests beyond the behavior lists; the F-C fixture gives the second championship a Winner record; P1's clause was mutated by hand instead of counted inside E3.

Run B:
- **B1 [soundness guard].** The decided winner's reading is applied only where every frame names one and the same winner. With a `null` winner or two candidates the rival is read as if it carried no `listedOnly`. The status code never builds such an input.
- B2. A settled ceiling of 0 sets no `listedOnly`.
- B3, a finding, not a defect: the winner's reading is not always at or below the reading of before the rule (10 team bounds of 500 seeded instances read higher, through the fill in pool's old relaxation). Pinned and stated in the core header. It says nothing about soundness.
- B4. Two commits for Task 3.
- B5. The D7 edges are further edges beside the planner's walk, so the ported walk's counts stay the planner's.
- **B6. CONTEXT D7's "a division's awards flag turning true before its playoff points ... no Locked team is lost" is NOT asserted as written.** The merge's own flag rule cannot produce that edge (`eventAwards.ts` waits for a playoff point). What is asserted: the rule keeps the flag false (56 of 56), raises it when the points land (56 of 56), and nothing is lost over either tick. Forced by hand the edge loses Locked teams; pinned FORCED and NOT REQUIRED.
- **B7. CONTEXT D7's "the field proof turning false again ... no Locked team is lost" is NOT asserted as written.** Forced by doubling `dcmpSlots`, the proof refuses (`fieldNotProven`) and what it alone held is lost. What is asserted: the core proof's `proven` never goes from true to false over any walked edge. Pinned FORCED and NOT REQUIRED.
- B8. The row model's flag `fieldProven` does go from true to false once per walk with two or more field fixing keys, at the first key's state tick, by design. No Locked team is lost over it. Easy to mistake for the proof being taken back.
- B9 to B12. The listed rule off also runs on the two division walks and FIM; the rule off runs walk the ported walk only; the monotone file takes about 700 seconds, not the plan's seven minutes; a temporary test file was created and removed to check commit 1 green alone.

Run C:
- C1. Three files of the old patch still applied (`finalsBracket.test.ts`, `champLedgerStatus.test.ts`, `measureChampJointLocks.ts`), as the plan foretold, and were applied with `git apply --include`; their titles and doc comment were retitled to this task. Everything else was written by hand.
- C2. Group 10 keeps the walk with the option HELD OFF as a third test (the plan asked only for the walk with it). It pins the series of before and asserts D2 only adds: team by team, tick by tick.
- C3. The micro walks hand the option in every variant (reading above), and per walk assert D2's switch on edge (`fieldNotProven` then applied, 0 lost).
- C4. Group D's forced flag test: its "none is lost over the edge that writes the flag" assertion read the tally's lines, which are capped at 40, and the forced loss is now 56. It now counts that edge directly in the walk (0 in both variants) and pins each finals variant on its own. The measurement is the same one; the forced pins moved as listed above. FORCED and NOT REQUIRED, so not a STOP, but the orchestrator should know these two forced figures are not "as run B pinned them": D2 makes both larger.
- C5. One comment was added to the monotone file's header after Task 4's verify run and before its commit (the publisher's hindsight vantage, below). Comment only; the final full run covers the committed tree.
- C6. Task 5 added one new header section to `champJointLock.ts` ("SOUND AND MONOTONE: THE FOUR RULES ... AND THEIR LIMITS") beyond the edits the plan lists, so the rules and limits are stated once, side by side.

No STOP rule fired in any run. No rules on monotone assertion failed at any point. No soundness test failed except under the deliberate mutations.

## What stays unwalked, and every stated limit

- **The awards flag limit behind C = 0 (F-B). Stated, not closed.** Past the finals' Awards the proof is handed no consuming award. That rests on the finals' awards flag meaning every consuming award is listed, the same limit decision 2's reservation has: a consuming award listed after the list has settled (`eventAwards.ts`, "the rule's limits"). The same holds for the finished championship of two.
- **A division's awards flag true before its playoff points. FORCED, NOT REQUIRED.** Written by hand: 28 Locked lost in each finals variant (22 distinct pairs each), every one when the points land after the flag and none over the edge that writes it, 498 margins each. The Worker's live vantage of the flag rule waits for a playoff point, asserted at 56 of 56 divisions.
- **A district publish run during a live championship.** The offline publisher reads the same flag rule at its hindsight vantage, which asks for a judged award listed OR award points and reads no playoff point. A publish from a corpus taken during a live championship could therefore raise a division's flag before its playoff points, which is the forced edge above. That publisher is run after events are over. Stated in the monotone file's header and in `champJointLock.ts`; not walked, not closed.
- **A proven field read unproven again. FORCED, NOT REQUIRED.** By doubling `dcmpSlots` under the same rows, 85 forced readings: the proof refuses `fieldNotProven` at all 85 and 765 Locked are lost (510 distinct pairs). What excludes it is the field proof's design (its count never rises while rows are only added) and the assertion that it happens on no walked path. **This is also the one way D2's option switches off while the finals key is on no row**: with no finals row nothing but the capacity proves a live field. D2 raises this forced figure from 596 to 765 because the proof now holds more and holds it earlier; the same exposure already existed wherever the finals key was on the rows.
- **`dcmpSlots` or `cmpSlots` changing during a championship** is not walked (the capacity is doubled only as the lever above).
- An alliance list changing after a pick; a row or a point being withdrawn.
- A key's playoff points landing in part beside its award points (every tick lands a key's playoff points whole). `eventAwards.ts` states its remaining assumption, not verified against a live event: TBA computes an event's point categories together.
- A further recipient of an award type already listed, added after the list has settled.
- FIM 2023 to 2025 one fact at a time (about 40 seconds each per variant; the planner ran them once and read nothing lost). Their rewound lattices are in groups A and B.
- The three lines of `ChampLocksLedger.tsx` that derive the option and pass it are covered by the typechecks and by the walks deriving it with the same expression, not by a component test. The Playwright specs are live only and no divisioned championship is live.
- Rule 4 is checked by group D alone: a rewound reading carries no `listedOnly`.
- The first real observation of any of this is the first 2027 divisioned District Championship.

## Docs and todo

- Headers: `champJointLock.ts` (the facts name the awarded rival rule and the listed pick rule; the award bullet and the doc of `MAX_POINT_PAYING_AWARDS_PER_TEAM` now say "never both" is true at one event and false across a division and its finals, and that neither rests on it, the constant and its assertion unchanged; the new rules and limits section), `champLedgerStatus.ts` decision 5, `finalsBracket.ts` ("THE FINALS EVENT NOT YET ON THE WIRE" replaces the refusal). The "not closed" note 261010-66y left is gone. The one "stated, not closed" that remains is F-B's limit, on purpose (CONTEXT D7).
- Methodology: checked, no change. The one sentence on this proof (`districtLedgerContent.ts`: "Once the District Championship alliances are picked ... A championship played in divisions counts every division's bracket and the finals between the division winners") is still true, and truer live than it was.
- Todo `.planning/todos/pending/champ-joint-lock-follow-ups.md`: item 10 struck as CLOSED by this task in one sentence. No item added, every other line kept, the file left UNCOMMITTED.

## The Worker, and what is owed

**No file the Worker bundles changed, in code or in comments.** The closure tool reads 103 files in the Worker's import closure and none of the 13 files this task touched is among them (`WORKER BUNDLE UNTOUCHED`, probed after every task and on the final tree). No artifact schema change, no algorithm version change.

**Only a push is owed.** No Worker deploy, no republish. Six commits are ahead of `origin/main`. The orchestrator pushes from the main context (the executor has no network) and should check `origin/main..main` first, since a push deploys the web app.

## Known Stubs

None.

## Self-Check: PASSED

- All six commits exist on `main` (`git log origin/main..main`).
- `scripts/champJointMonotone.test.ts` exists; the 12 modified files are in `git diff --name-only 8b5f6a9f HEAD`.
- `git status --short` shows only the uncommitted todo file and this untracked task directory.
