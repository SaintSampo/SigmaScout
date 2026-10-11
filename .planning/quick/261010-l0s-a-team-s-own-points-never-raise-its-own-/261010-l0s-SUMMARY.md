---
phase: quick-261010-l0s
plan: 01
subsystem: districts
tags: [champ-locks, joint-proof, lock-math, monotone, matching, paid-pick-rule, live]
status: complete
requires: [261010-d7r, 261010-66y, 261009-vp9, 261009-tx9, 261009-kt3, 261009-2tr]
provides:
  - "coverMatching: every rival is one entity of one exact matching, so no rival is counted twice in a scenario"
  - "the two properties as always on tests: a team's own points never raise its own bound, and another team's judged award posting never raises a bound"
  - "confirmedPicks and paidPlayoffsAt: a pick TBA has paid for its alliance's playoffs is on that alliance and holds its seat"
  - "two guards on the paid pick rule: one list, and one finals backup"
  - "the monotone file's third property (no bound rises over any walked edge) and group E (the one event walks read exactly, the paid pick rule on and off)"
  - "an independent brute force over rule legal futures with two seat groups"
affects: [apps/web Champ Locks tab, packages/core/districts]
tech-stack:
  added: []
  patterns:
    - "a minimum cost flow by successive shortest paths, entities with the same costs merged into one type, exact at every size"
    - "the proof it replaced kept whole in the test file as an oracle, beside an independent enumeration of futures that shares nothing with the rewrite"
    - "a rule that closes a seat only for a named holder, with each guard on the side of the larger bound and shown to bite by taking it out"
key-files:
  created: []
  modified:
    - packages/core/districts/champJointLock.ts
    - packages/core/districts/champJointLock.test.ts
    - apps/web/src/components/districts/champLedgerStatus.ts
    - apps/web/src/components/districts/champLedgerStatus.test.ts
    - scripts/champJointMonotone.test.ts
    - scripts/champFieldStagedWalk.test.ts
decisions:
  - "the fix of D1 is the exact matching: the distinct rivals cap and the lower floor fallback were both refuted by measurement and not built"
  - "finding F2 was closed in this task (Task 3), in the status code: the proof's count is exact on the input it is handed"
  - "the paid pick rule closes a seat only where its holder is named; the wider rule (every seat closed once a key's Playoffs are final) was weighed and not taken"
  - "guard one counts how often the lists of a key name a team, so a team one list names twice is held back too (the sound side)"
  - "Task 3 landed as two commits, each verified green: the planner's tested references first, then the plan check's guards"
metrics:
  duration: "two executor runs; run B about 60 minutes"
  completed: 2026-10-10
  tasks: 3
  commits: 4
  files: 6
actuals:
  tokens: 69091
  tasks: 3
  commits: 4
---

# Quick task 261010-l0s: a team's own points never raise its own joint lock bound, and the tick the playoff points land takes no Locked back

Two defects in the Champ Locks joint proof are closed at their roots: every rival is now one entity of one exact matching, and a pick TBA has paid for its alliance's playoffs is on that alliance. No sweep line moved, no Locked was lost anywhere, six teams are shown Locked earlier on the live walks, and no file the Worker bundles changed. Nothing is pushed and nothing is deployed. Only a push is owed.

## Commits (all on `main`, unpushed, four ahead of `origin/main`)

| Hash | Subject | Run |
| --- | --- | --- |
| `37b6a3bf` | fix(261010-l0s): every rival is counted once in the joint proof, so a team's own points never raise its own bound | A, Task 1 |
| `4b5bebd4` | test(261010-l0s): no pool team's joint bound rises over any walked edge, and 2024 NE holds it with every bound exact | A, Task 2 |
| `b861d87a` | fix(261010-l0s): a pick TBA has paid for its alliance's playoffs is on that alliance, so the tick the playoff points land takes no Locked back | B, Task 3 |
| `d95bfc4d` | fix(261010-l0s): the paid pick rule names a team only where the rows place it: one list, and one finals backup | B, Task 3 (the plan check's guards) |

Base `b776d222`. No `.planning/` file is committed. `STATE.md` is not touched.

## The two defects and their exact mechanisms

### Defect 1 (warning W1 of 261010-d7r): one rival counted more than once

A scenario's count in `champJointLock.ts` was a sum of terms worked out apart from each other. A rival AHEAD of T by its floor counts exactly once. Once T's own floor passed it, three terms could each count it again:

- the winner's fill in was added beside the seat and judged award cover, and both held the same rivals;
- a rival no seat group names was entered in every group's cover, and the group covers were summed;
- a listed pick that is not confirmed, on an alliance still in its bracket, counted as a member at its alliance's value and again on a seat of its division.

Each only raised a bound, so nothing was unsound. But T's bound ROSE on T's own good news. The context named one double count and a rise of 1. There are three, and the rise reaches 5. "No other team's posting raises a bound" was also false at HEAD for a listed pick on an alliance still in its bracket.

In real data it showed under one team: frc9710 at 2024 NE, 65 or more above its points slots, at the edge where its own division award posts. Run A read it itself: 9 of 11,761 exact bounds higher on the 2024 NE awards order lattice against the old proof, 0 with the matching.

### Defect 2 (finding F2, found by this task's planner): a paid backup left off its alliance

An alliance's seats count from its CONFIRMED picks, and a pick was confirmed by its alliance selection points alone. A backup holds none.

- Before the tick a key's playoff points land, the decided winner's backup is a listed pick that is not confirmed, read at its floor and counted through the winner's one fill in.
- After the tick TBA's payment is in the team's floor, its settled value is gone, and it is a plain rival. The winner still showed three members and one spare seat, so the fill in covered one MORE rival, which no future can do: the winner already has its four teams.
- Every team the paid pick had just passed read a bound one higher.
- It shows only live, in the window before the Winner award is listed. At a rewound stop the artifact already lists the Winner. That is why no sweep ever saw it.
- At a divisioned championship the same rise sits at the finals' tick, where the champion took a backup only for the finals. No season of 2023 to 2026 has one.

The cause was in what the status code handed the proof. The proof's count was exact on that input (the allocation model enumerated reads the same 4, 5 and 4).

## Why the cap and the fallback were dropped

- THE DISTINCT RIVALS CAP (the context's preferred fix) does not reach zero. It leaves 787 of 227,134 own floor rises and 378 of 80,519 own award rises on the divisioned shape, and it makes another team's posting raise a bound once in 89,167. A hand built five team instance is pinned in the core test: with the cap the bound still goes 3 then 4, with the matching 3 then 3.
- THE LOWER FLOOR FALLBACK is sound and zero for a team's own floor by construction. It leaves the rises from another team's posting, changes no bound on the eleven 2026 FIM inputs, and costs 15,710 ms against 1,112 ms over them.

Neither was built.

## What was built

### The matching (Task 1)

`coverMatching(rows, capacities, budget)`: every rival short of T is ONE entity and takes at most ONE resource. The resources are a seat type per seat group and value, one judged award alone, and the winner's fill ins. Each costs an entity 0 or 1 judged awards, or is closed to it. It is a minimum cost flow by successive shortest paths and is exact at every size. `unpickedCover`, `coverUpperBound`, `greedySeatMatching`, `seatAndJudgedCover`, `CoverOptions` and `EXACT_COVER_STATE_CAP` are gone.

### What proves the matching sound

Independent of the matching (these enumerate FUTURES and share no code with it):

| Test | What it read |
| --- | --- |
| Two seat group brute force over rule legal futures (new, the plan check's addendum) | 39,751 instances, 5,656,885 rule legal futures, none above the bound. It calls only `jointLockBound` |
| The same test, the proof's own reading of a listed pick's seat | 7,232,335 futures, the bound REACHED at all 39,751 instances |
| E1, E2 single exhaustive | 26 and 25 team bounds, 0 futures above |
| E3 divisioned exhaustive (six variants, 8 seeded floor fields, awarded rivals) | 140, 256 and 256 team bounds, 0 futures above (5,697,088 and 3,821,696 futures) |
| S1, S2, S3 sampled | 205, 27 and 8 team bounds, 0 futures above |
| One group brute force | 20,000 instances, 0 above, the bound reached at 20,000 (19,693 before) |

The two seat group test bites: eight single breaks of the module each fail it (8 of 8), and the module was restored byte for byte each time.

NOT independent (these read a future the way the module does, as an allocation, so they prove exactness and "not loosened", never the rules):

| Test | What it read |
| --- | --- |
| The bound against the allocation model enumerated | equal at 13,899 single and 17,628 divisioned team instances (2,378 and 10,913 left out as too large) |
| The old proof kept whole as an oracle | never BELOW the bound: single 16,277 compared and 714 lower (by up to 2), divisioned 28,541 and 6,722 (by up to 6), two championships 33,913 and 2,346 (by up to 3) |
| `coverMatching` against every assignment enumerated | 20,000 cost tables |
| `coverMatching` against the old exact program on one seat group | 60,000 instances, plain (70,086 cells), with awarded flags and with seat deficits |

### The walk property (Task 2)

`checkEdge` counts every pool team's bound before and after each edge, and `expectMonotone` requires none higher, so every rules on test of groups A to D holds a third property beside "no Locked lost" and "no margin dropped". A new last group pins the nine tallies and reads the 2024 NE awards order lattice with every bound exact.

### The paid pick rule (Task 3)

`confirmedPicks` (core, beside the proof whose seats it decides): of the teams an alliance lists, the confirmed ones are those that hold alliance selection points there and those TBA has paid playoff points for that alliance's playoffs. `paidPlayoffsAt` (status code) reads the payment off the rows, only where that key's Playoffs are final at the position.

- A single championship, and each of two: the alliance's own key.
- A division: its own key. For the division's decided winner the finals key too, once the finals' Playoffs are final: a team with a row at that division's key that no alliance there lists and that the finals have paid is counted as the winner's pick.

WHY IT IS SOUND IN EVERY SHAPE.

- Playoff points at a key are paid only to a team that played for an alliance there, and a team is on one alliance at most. So "listed by A and paid at A's key" is "played for A". The bracket facts are refused wherever the field shows a team on another alliance than the one that lists it.
- An alliance has at most four teams over the whole championship, its one backup included. A seat with a named holder is open to nobody else.
- NOTHING IS CLOSED WITHOUT A HOLDER. A listed pick TBA paid nothing stays not confirmed and its seat stays open (frc4405 at 2024 FIM was paid nothing and holds the Winner award all the same). A division winner with no backup keeps its spare seat until the finals have paid one.
- The wider rule (every seat of a key closed once its Playoffs are final) was not taken. It is false at a division, whose winner may still take a backup for the finals. At a single championship it would close the winner's seat without naming its holder.
- The tick is monotone: before the tick the proof already read the same team in the same place, through the winner's fill in, on that alliance's own seat, or at the placed alliance's settled maximum.

THE GATE (stated in both headers). A payment is read once the key's Playoffs read final at the position AND the team's own row carries playoff points. At the live position that stage is the field saying the key's playoffs are done with the winner's playoff value on a row there, or the key's awards posted (quick task 261009-vp9). Membership is sound either way. That every payment is in its floor from that tick rests on TBA posting an event's playoff points together, the stated assumption of 261009-vp9, checked on the walks and not proven.

THE TWO GUARDS (the plan check's addenda, commit `d95bfc4d`), each on the side with the larger bound, since confirming a pick only ever closes a seat:

1. A payment confirms a listed pick only where the alliance lists of its key name that team EXACTLY ONCE (`listedExactlyOnce`). A team two lists name is confirmed on neither and both seats stay open.
2. The finals name a division winner's backup only where EXACTLY ONE unlisted team of that division was paid at the finals. With two or more nobody is named and the seat stays open.

Three status tests hold them (guard one at a single championship, guard one at a division, guard two). Each asserts the seats stay open and that no team's bound is below the reading that names the team. Each fails with its guard taken out of the status code, and only it (`execB/guards-mutations.txt`: 1 failed and 106 passed, three times).

## Measured numbers, each rule on and off

### The two properties at the core (3,000 seeds a shape, 814,080 comparisons)

| Shape | Own floor up: before, after | Own award posts: before, after | Another team's award posts: before, after |
| --- | --- | --- | --- |
| Single | 283 of 65,292, then 0 | 95 of 21,554, then 0 | 0 of 70,521, then 0 |
| Divisioned | 1,787 of 114,382 (largest 5), then 0 | 740 of 40,727, then 0 | 10 of 135,543, then 0 |
| Two championships | 413 of 135,816, then 0 | 183 of 44,368, then 0 | 0 of 185,877, then 0 |

The "after" zeros are held by the always on test and printed in both of run B's full suite runs. The "before" counts are the planner's; no executor reran them.

### Bound reached and never above (run A, at HEAD and after)

| Test | Team bounds | A future above | Bound reached before | After | Summed slack before, after |
| --- | --- | --- | --- | --- | --- |
| E1 single exhaustive | 26 | 0 | 9 | 23 | 21, 4 |
| E2 single exhaustive, slot only | 25 | 0 | 25 | 25 | 0, 0 |
| S1 single sampled | 205 | 0 | 51 | 51 | 597, 597 |
| E3 divisioned, six variants | 140 | 0 | 35 | 74 | 305, 152 |
| E3 divisioned, 8 seeded floor fields | 256 | 0 | 106 | 143 | 381, 186 |
| E3 with awarded rivals | 256 | 0 | 52 | 74 | 507, 282 |
| S2 divisioned sampled | 27 | 0 | 3 | 3 | 215, 188 |
| S3 two championships sampled | 8 | 0 | 0 | 0 | 87, 87 |
| One group brute force | 20,000 | 0 | 19,693 | 20,000 | mean 0.015, 0.000 |

### The core gate (`l0s_gate.sh`), the same at every reading

- Seeded, 8,000 a shape: single 86,560 bounds, 3,878 lower (largest by 2), 0 above. Divisioned 151,380, 36,085 lower (by 7), 0 above. Two championships 181,375, 13,497 lower (by 4), 0 above.
- The 364 real inputs of the joint sweep: 59,693 bounds the same, 28 lower (at 16 divisioned stops), 0 higher. Locked sets differ at 0 inputs: gained 0, lost 0.

Timing at 2026 FIM, old proof then new, median of 15:

| Reading | Alliances final | Divisions final, finals not started |
| --- | --- | --- |
| After Task 1 | 149.2 to 89.5 ms (0.60) | 31.4 to 26.1 ms (0.83) |
| After Task 2 | 156.4 to 90.2 ms (0.58) | 29.5 to 26.1 ms (0.88) |
| After Task 3 (`b861d87a`) | 162.4 to 87.0 ms (0.54) | 31.6 to 27.9 ms (0.88) |
| Final tree (`d95bfc4d`) | 158.2 to 89.2 ms (0.56) | 31.2 to 27.5 ms (0.88) |

### The walks, at the file's own reading (bounds exact to 12 above the points slots)

Rules on, the nine tallies of groups A to D: 2,712,435 team bounds compared, 0 higher. A lattice 1,253,848. B two division 63,616. B FIM 130,048. C finishing first 10,990. C lattice 570. D live walks 979,948. D Winner first 88,361. D awards first 24,368. D late rows 160,686. Against the OLD proof the same tally is also 0 (run A): the first defect shows only above the cap of 12.

2024 NE read exactly: 36 readings, 36 flag edges, 32 stop edges, 11,761 bounds, 0 higher. Against the old proof: 9 higher, every one frc9710.

### Group E, the paid pick rule (run B, both full suite runs)

| Reading | Rule on | Rule off |
| --- | --- | --- |
| The 32 one event walks, every bound exact | 1,079 readings, 991 edges (874 step, 117 flag), 84,991 bounds, 0 higher, 0 Locked lost, 0 margin drops | on the four districts: 20 higher over 5 edges, each by one (2024fnc 1, 2025fin 2, 2026fnc 1, 2026ca 16, of which 8 on the walk itself), 0 Locked lost |
| The hand built championship (2026 PNW fixture, frc492 the winner's fourth paid 60) | frc6696 reads 20 of 21 slots and Locked before and after the tick; the winner has 4 members and no spare seat after | 21 of 21, no longer Locked: the take back |
| The six team core input | 4 of 5 slots, Locked, before and after | 5, not Locked |
| The fixture sweep through the status code | 26 fourths, 390 scenarios, 49,140 bounds, 0 higher, 10,948 lower | 882 higher on the input of before the rule |
| The divisioned fixture, the finals' tick | 0 higher, the champion at 4 members and no fill in | 12 bounds one higher |

RED before the install, on run A's code: `hand2.mts` read T's bound 4 and Locked before the playoff points land, 5 and not Locked after.

### Measurements with another rule off (not requirements)

| Measurement | Before this task | After Tasks 1 and 2 | After Task 3 |
| --- | --- | --- | --- |
| Group A, awarded rule off: Locked lost | 957 | 952 | 952 |
| Group A, awarded rule off: distinct pairs | 163 | 161 | 161 |
| Group A, awarded rule off: flag edges with a drop | 1,776 | 1,786 | 1,786 |
| Group A, awarded rule off: team margins dropped | 33,355 | 33,385 | 33,388 |
| Group B, awarded rule off: Locked lost, margins | 49, 772 | 54, 777 | 54, 777 |
| Group D, awarded rule off, finals key on no row: lost, margins | 121, 2,029 | 121, 2,029 | 121, 2,035 |
| Group D, awarded rule off, finals key registered: lost, margins | 202, 3,236 | 202, 3,236 | 202, 3,245 |
| Group D, forced "a proven field read not proven again": lost, pairs | 765, 510 | 765, 510 | 770, 515 |

### The guards moved nothing

Run B verified the tree twice in full: as installed (`b861d87a`) and with the guards (`d95bfc4d`). All 58 measurement lines the suite prints are identical between the two runs, the seven gate outputs are identical, and no pin moved. Over the 89 championship tier keys of 2023 to 2026 (`execB/d5_facts.txt`): no team of the 1,937 on a key's lists is named twice there, and no division of 40 has an unlisted team paid at the finals.

## The six locks gained, and no sweep row moved

No line of any sweep moved in any task. The eight history gates read `D8 GATES IDENTICAL` at every reading.

On the live walks six teams are shown Locked EARLIER and none is lost (the planner's reading of 5,256 readings of the 58 live walks: 34 differ, 0 teams lost). Each is the paid backup of a decided winner. It is Locked from the tick its payment lands, where it had waited for its Winner award to be listed. Each holds that award at the season's end.

- 2023pnw frc1983
- 2024fnc frc6639
- 2025fin frc1747
- 2026ca frc3512
- 2026fnc frc6639
- 2026 NE frc8724, from the tick the finals' state is written (the staged walk file names it and asserts it is not Locked the tick before, Locked from that tick on, and Locked at the end)

## Gate lines

| Reading | D8 gates | Core gate | Worker closure | Typechecks | Full suite |
| --- | --- | --- | --- | --- | --- |
| Step 0, run A (`b776d222`) | IDENTICAL against the planner's | | | | |
| Task 1 | IDENTICAL | HOLDS | UNTOUCHED (3 files probed) | CLEAN | 357 files, 9,028 passed, 1 skipped |
| Task 2 | IDENTICAL | HOLDS | UNTOUCHED (3 files probed) | CLEAN | 357 files, 9,030 passed, 1 skipped |
| Step 0, run B (`4b5bebd4`) | IDENTICAL against run A's `after-t2` and against the planner's | | | | |
| Task 3 as installed (`b861d87a`) | IDENTICAL | HOLDS | UNTOUCHED (6 files probed) | CLEAN | 357 files, 9,048 passed, 1 skipped |
| Final tree (`d95bfc4d`) | IDENTICAL | HOLDS | UNTOUCHED (6 files probed) | CLEAN | 357 files, 9,051 passed, 1 skipped |

Every D8 reading: joint 1200 lines, champ 129, ledger 163, settled 35, cutoff no drift for both generated files, `championships 48, stops 412, take-backs 0`, Now identical (artifacts 109, teams 16345), `UL3 COMPARE CLEAN`, `R9X COMPARE CLEAN`. Worker closure 103 files. Typechecks: root, web, e2e, worker.

Every full suite ran with `REQUIRE_LOCAL_DATA=1`. No file failed. The one skipped test is in `packages/ingest/rankingsLive.test.ts`, which needs the TBA key and the network. Final per file counts: core 86, status 107, monotone 130, staged walk 33, sweep test 11, staged replay 48, finals bracket 14.

## Pins moved, each with its reason

Tasks 1 and 2 (the matching):

- Core test, E3 with awarded rivals: `{ onTheBound: 52, ruleTighter: 17 }` to 74 and 16. The bound is lower where a rival had been counted twice.
- Core test, the one group brute force: reached at 19,693 to 20,000 of 20,000.
- Core test, `raisedByTheWinnerReading`: 10 to 0, now a requirement.
- Core test: the three R10 tests are equality tests against the old exact program, and the `EXACT_COVER_STATE_CAP` assertion went with the constant.
- Monotone file, awarded rule OFF measurements only: group A and group B as in the table above, and by district 2023fim 118 to 116, 2023fit 4 to 3, 2024fim 239 to 237.

Task 3 (the paid pick rule):

- Status test, the digest of the proof's input on the divisioned fixture at "divisions done": `f9cbb263...` to `5e9642cd...`. The fixture's frc7034 carries 12 playoff points and no alliance selection points, division 2's alliance 7 lists it, and it is now that alliance's confirmed pick. The test asserts that difference by name. The "Round 5" digest did not move.
- Staged walk file, the 2026 NE series in two tests: 21 to 22 at the last two ticks (frc8724).
- Monotone file, three measurements, none a rules on requirement: the last column of the table above.

New pins, each an executed value: the eleven counts and two readings of the two seat group test (run A), group E's counts, the fixture sweep's counts.

Every pin the planner's references carry read the planner's value in the executors' runs. The pins of run A's two seat group block did not move in run B. No other existing pin moved in any file.

## Deviations

Run A:

1. The two seat group brute force (CONTEXT D5) was added as one block at the END of the core test file, so the planner's hash guarded installer could still be used: strip the block, install, apply the block again. Run B followed that cycle and it worked as written.
2. "Rule legal" in that block is read as: an alliance takes as many backups as it has spare seats, and a listed pick that was on its alliance sits in one of that alliance's spare seats. A second reading in the same test is the proof's own.
3. The tracer gate would stop for a human check after Task 1 with auto mode off. The orchestrator's instruction was Tasks 1 and 2 in order, so run A did not stop. Task 1's whole verify step passed before its commit.
4. The full suite ran before Task 1's commit too (the plan check's addendum).
5. AN UNINTENDED DOWNLOAD. One scratch command was run with the planner's `tree-head` as the working directory. `npx vitest` found no local vitest there and fetched `vitest@5.0.3` from the npm registry into the user's npx cache. It ran once, failed, and touched nothing in the repo: the repo's vitest is 4.1.10, and `package.json`, the lockfile and `node_modules` are untouched. The cache entry is still there. It also shows the executor did have network, where the brief said it had none.
6. Temporary edits to the module, the core test and the planner's scratch tree, all restored and checked byte for byte.
7. Run A did not rerun the planner's "before" numbers: the seeded rise counts of before the matching, the 20 bounds over 5 edges of F2, the 22 rises of frc9710 across all sets (it read the 9 of the 2024 NE awards order lattice itself). Run B's group E reads the 20 over 5 edges on the real tree with the rule off.

Run B:

8. Task 3 is two commits, as the brief allowed. `b861d87a` is the planner's six references plus run A's block and nothing else. `d95bfc4d` is the guards, their tests and the header texts. Each was verified with the whole verify step before it was committed.
9. Guard one counts how often the lists of a key name a team, so a team that ONE list names twice is held back as well. D5 says "exactly one alliance lists it". Confirming a team listed twice by one alliance would close two seats for one holder, so the stricter count is the sound side.
10. A third guard test was added (guard one at a division), beyond one test per guard, because the divisioned site is a second place the guard lives.
11. The gate's wording in the headers is more exact than D5's. `stage.elim` at the live position is the number reading of 261009-vp9: the field says the key's playoffs are done AND a row there carries the winner's playoff value, or the awards are posted. The headers say that.
12. The status code was changed three times for the mutation check and restored byte for byte (hash checked).
13. The gate output of the final tree is under `exec/after-final` and `exec/gate-final`, not the plan's `exec/final`.
14. No `gsd-tools` state command was run, and `STATE.md` and `ROADMAP.md` are untouched: the orchestrator logs the quick task.
15. Every `npx` command of run B ran from the repo root. Nothing was installed or downloaded. No network was used. `.env` was never read.

No STOP rule fired in either run. No soundness test failed at any point. Nothing in an enumerator, the model, the oracle, the reference cover, a sampler, a seed or an instance count was changed.

## What stays unwalked, and every stated limit

- THE SUITE READS MOST BOUNDS ONLY UP TO 12 ABOVE THE POINTS SLOTS. Read exactly in the suite: the 2024 NE lattice and the 32 one event walks. The divisioned walks and the FIM lattices cost 15 to 35 minutes each read exactly. The planner read every rules on edge of groups A to D exactly once on the planned code (8,785 edges, 2,712,435 bounds, 0 higher). That reading was taken before the two guards, which change no real reading.
- MONOTONE BEYOND THE TWO PROPERTIES RESTS ON WALKS, not on an argument: a played row, a stage turning final, an awards flag, the finals facts, the field proof.
- NOT WALKED (group D's own list, unchanged): the published capacities changing during a championship; an alliance list changing after a pick; a row or a point being withdrawn; a key's playoff points landing in part beside its award points; a further recipient of an award type added after the list has settled; the FIM seasons of 2023 to 2025 as micro step walks.
- THE PAID RULE'S ONE STATED LIMIT: a team TBA paid at a single championship that no alliance lists and no played row shows is confirmed nowhere. Its seat stays open, which is sound, and a bound could still rise by one at that tick. 0 of 894 paid teams in 2023 to 2026.
- THE GUARDS' CASES read as before the rule: a team two lists name, and two or more unlisted teams of a division paid at the finals. Sound, and a bound could still rise by one at that tick. Neither is in the data.
- NOT GUARDED: a division winner with four confirmed picks AND an unlisted team paid at the finals would read five members. The rules do not allow it, and no division of 40 has an unlisted team paid at the finals.
- THE GATE'S ASSUMPTION: TBA posts an event's playoff points together. It is the stated assumption of 261009-vp9 and is not verified against a live event. No live district weekend has been observed under these rules. The first real exercise is the first 2027 district championship.
- LOOSENESS ON THE SAFE SIDE, by design and older than this task: in a rule legal future a listed pick on its alliance sits in a seat that alliance counts spare. The proof does not take that seat away. 3,071 of 39,751 instances, 0.08 of a rival on average.
- A listed backup TBA paid nothing stays not confirmed even where it is on the winner (frc4405). Its seat stays open: sound and loose.

## Scope

`scripts/champFieldStagedWalk.test.ts` was touched beyond the files the orchestrator's decision named: two pins of one series move with the rule, and the suite needs them to stay green. No file of quick task 261010-jyn was touched. No todo item was added.

## The Worker, and what is owed

No file the Worker bundles changed: `WORKER BUNDLE UNTOUCHED` at every reading, closure 103 files. No artifact changed, so no republish is owed and no Worker deploy is owed. ONLY A PUSH IS OWED: four commits on `main`, ahead of `origin/main`.

## Known Stubs

None.

## Self-Check: PASSED

- The four commits exist on `main`: `37b6a3bf`, `4b5bebd4`, `b861d87a`, `d95bfc4d`.
- The six modified files exist, and `git status --short` shows only the untracked `.planning/quick/261010-l0s-...` directory.
- The final tree is the tree the last verify step ran on: nothing was edited between that run and the commit.
