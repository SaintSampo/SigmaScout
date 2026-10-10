---
phase: quick-261010-d7r
verified: 2026-10-10
head: 72cc0830
status: passed
score: 7/7 checks hold, 0 gaps, 3 warnings
behavior_unverified: 0
gaps: []
warnings:
  - id: W1
    summary: "Monotonicity is proven by walking real data, not by the core proof's own structure. A team's OWN bound can rise at the core when its OWN floor jumps (its own award posting), through the old fill in plus seat double count. Zero on any real instance; the header's 'no bound rises over that tick' over-claims for that one case."
  - id: W2
    summary: "F-B and F-C hand the proof NO consuming award past a final Awards flag. That rests on the awards flag limit (a further recipient of an already listed consuming type, listed over an hour after the list last changed). Reachable from the Worker's own writes in principle, shared with the reservation, stated in the header; the new exposure is small."
  - id: W3
    summary: "No live divisioned championship has exercised any of this. The first real observation is the first 2027 divisioned District Championship."
---

# Quick task 261010-d7r: verification at HEAD 72cc0830

Verifier stance: assumed the goal was missed until run output said otherwise. Nothing in the repo was edited, nothing committed. All scratch work is under the session scratchpad `d7r-verify/` (brute force `bf1.mts`, shuffle harness `shuffle/`, capacity probe `capcheck.mts`).

## Verdict

**passed.** No gap. Every must have holds on the code and on runs I made myself. Three warnings, one of which (W1) deserves a follow up because it is a claim in a header that is stronger than what is proven.

## What I ran, and what it said

| # | Check | Result |
| - | ----- | ------ |
| 1 | Independent brute force, my own enumerator, 20,000 instances (two seat groups, one or two frames, awarded rivals incl. T, listed only picks of a placed alliance and of the winner, slot only rivals, rivals named by one group) | **bound below a legal future: 0.** Bound reached at 97%. |
| 1b | Same, F-C shape (finished championship: no alliance, null winner, no consuming award, K left, awarded rivals), 20,000 instances | bound equals the exact answer at all 20,000 (0 below, 0 above) |
| 1c | Repo's own soundness files: `champJointLock.test.ts`, `finalsBracket.test.ts`, `champLedgerStatus.test.ts`, `useDistrictLedgerData.test.ts`, `measureChampJointLocks.test.ts` | 5 files, 217 tests passed |
| 2 | `REQUIRE_LOCAL_DATA=1 npx vitest run scripts/champJointMonotone.test.ts scripts/champFieldStagedWalk.test.ts` | **2 files, 157 tests passed, 0 skipped**, 835 s, exit 0 |
| 2b | Shuffled and reversed live walks of my own (below) | 49 walks, 2,359 readings, **0 Locked lost, 0 margin drops**; the same harness with the awarded rule off loses 11 and 5 |
| 3 | `gates.sh` then `gates_compare.sh exec/final mine` then `d7r_gate.mjs exec/base mine` | **`D8 GATES IDENTICAL`**, **`D7R T1 GATE HOLDS`**, every gate exit 0 |
| 4 | D2: equivalence gate and live walks | both exist and run (below) |
| 5 | Worker closure | `WORKER BUNDLE UNTOUCHED (13 files probed)`, closure 103 files |
| 6 | Four typechecks chained | `TYPECHECKS CLEAN` |
| 7 | Stated limits | honest and complete; none is reachable from the Worker's own writes except W2's pre existing one |

### 1. Soundness

Four rules and D2, each attacked.

- **D1, awarded rivals (`champJointLock.ts` ~1018, ~1105 to 1140, `champLedgerStatus.ts` 1612 to 1640).** Read the two places a judged award is spent and the reachability filter. An awarded rival stays in `uncovered`, so a consuming award and the winner's fill in still take it (P1 withdrawn, correct: six 2017 and 2018 FIM teams held both). It is covered on a seat only where a seat's value alone reaches T. Division budget stays `max(0, 14 - awarded teams)` and goes only to others. The finals key is never in `awardedRivals`. My brute force gave awarded rivals to 80% of instances, to T in 25%, with two seat groups: no future above the bound.
- **F-D, listed only (`champJointLock.ts` 1018 to 1030).** `alonePoints` and `seatPoints` split correctly. The settled value is in `extra` exactly once (`settledElimBounds` sends `ceiling` into `openCeiling`, `jointModeled` skips it), so `extra - settled` never strips another ceiling. The listed pick of a placed alliance has `own`, `seat`, `fill` and `none` in my enumerator; the winner's pick has `fill` or free. 0 failures.
- **F-C (`mixedMultipleJointProof`).** Finished championship: no alliance, null winner, Winner must be counted, consuming 0, K = 14 minus teams at exactly one judged award's points (the deviation A1 is the sound side: a whole championship's rows carry the 24 and 30 point consuming awards). Exact at 20,000 instances.
- **F-B.** Reading is `jointProofStillRuns`; verified the three callers (divisioned, `multipleJointProof`, `mixedMultipleJointProof`) agree: both final reads false, one final reads true. The consuming award hand off of 0 is W2.
- **D2.** `championshipShape(keys, finalsMayBeAbsent)` is divisioned only for 2 or 4 division keys of one stem with no parent. I computed, for all 19 divisioned championships 2022 to 2026, every proper subset of division keys against the capacity line the tab uses (`postedTeams >= dcmpSlots - floor(largest/2)`): **none** reads complete by capacity, so a 2 of 4 FIM reading cannot be taken for a two division championship.

Legality holes looked for and not found: awarded rival also on an alliance; T awarded; a listed pick named by two groups (the old P4 over count; real inputs name each rival once); a finished championship with prequalified slot only rivals.

### 2. Monotonicity

Printed counts, all rules on: group 9 `shown Locked 406 open, 451 final, Locked with Awards open and not final: 0`. Group A 16 championships, 1200 readings (1184 applied, 16 `stageNotEligible`), 1968 flag edges, 1088 stop edges, **Locked lost 0, margin drops 0**. Group B 288 + 192 readings, 0 and 0. Group C 28 readings and the 4 reading lattice, 0 and 0. Group D 3,326 readings, 4,439 edges across 58 walks, 0 and 0; further edges 386 + 112 + 1,235 readings, 0 and 0. Group 13 equivalence: 16 championships, 112 stops, 28,140 bounds compared, **every column 0**.

Rule off variants, confirmed by reading the assertions and the printed lines:

| Rule off | Asserted to bite | Printed |
| -------- | ---------------- | ------- |
| awarded | `lost.flag > 0` and `edgesWithADrop.flag > 0` (A), `lost > 0` and `marginDrops > 0` (D) | 957 lost, 33,355 margins; D: 121 and 202 lost |
| stop | `lost.stop > 0` (A), `finishing.lost.flag > 0` (C), `lost > 0` both variants (D) | 306 lost; 91 at California; 63 + 63 |
| listed | `single.marginDrops > 0` and **lost exactly 0** | 25 margins, 0 locks (the test says so itself) |
| D2 | no switch, by design | equivalence gate plus live walks, two separate proofs |

Rules on assertions are `toEqual` zero on lost and drops through `expectMonotone`. The cap (`pointsSlots + 12`) touches only the margin tally: a bound that rises across the cap is still larger after capping, and `held` (the Locked tally) is uncapped. Nothing is asserted only through a capped tally.

**Orders the file does not walk.** The file's main line takes the divisions in key order, every division's flag only after all points have landed (flags are then taken in every tuple). I copied the file into the scratchpad (absolute imports, a vitest config outside the repo) and added a walk that, from "alliance points land", interleaves per key units P (a played row), D (playoffs done), E (playoff points), F (awards flag) and the finals chain in a random topological order, plus a policy that does flags and points as early as possible with the keys reversed, and one that does them as late as possible. Five random seeds plus those two policies on each of 2026 NE, ONT, FIT (finals key on no row and registered) and 2026 FIM (on no row): 7 championship variants x 7 walks = 49 walks, 2,359 readings, 2,359 edges: **0 Locked lost, 0 margin drops, field proof taken back 0**, every walk ending at the same shown Locked count as the source (NE 32, ONT 21, FIT 28, FIM 83). With the awarded rule off the same harness loses 11 (NE) and 5 (FIT), so it can see the defect.

### 3. History

`D7R T1 GATE HOLDS`: ten divisioned rows moved, 16 gained, 0 lost, the planner's ten line for line, no champ tenets row moved. `D8 GATES IDENTICAL` against the executor's final: joint 1200 lines, champ 129, ledger 163, settled 35, cutoff no drift, `championships 48, stops 412, take-backs 0`, Now identical (artifacts 109, teams 16345), publisher files 119 / 119 differing 0, `UL3 COMPARE CLEAN`, `R9X COMPARE CLEAN`. Against the BASE (`gates_compare exec/base mine`) the only difference is the five joint hunks shown (the ten rows), everything else identical. Joint sweep `VIOLATIONS: none`, `SKIPPED (0)`.

### 4. D2

- Equivalence gate: `champFieldStagedWalk.test.ts` group 13, ran, all columns 0 over 112 stops.
- Live walks: group 10 (four 2026 divisioned districts, with the option and held off) and group D, ran.
- Derivation (`ChampLocksLedger.tsx` 467 to 493, 613): `finalsMayBeAbsentNow = fieldProofNow.completeBy === "capacity"`, passed on only `atNow`, to the data hook, the Live fetch set and `computeChampLedgerStatuses`. A rewound position never gets it. Capacity needs every field fixing key started and posted and `postedTeams >= dcmpSlots - half the largest key`.
- At the tick the finals rows post: the parent key is on the rows, so the shape is the same divisioned shape with the same `finalsKey`; the finals key now has a stage and facts if fetched, otherwise `distributions.get(finalsKey)` is undefined and the code reads it as not started, as before. Group D walks that tick (a finals row with no state block) at every tuple of division flags: 0 and 0. `completeBy` may move from "capacity" to "finals" there, which changes nothing because the key is on a row.
- D2's switch turning on: in 13 of 13 walks it turns on at exactly the tick the field proof turns true; 0 held teams lost, 4 more shown Locked.

### 5. Worker

`worker_closure.mjs --fail-if-bundled` with the 13 changed files: all "not in the Worker bundle". `hypotheticalDcmp.ts` and `locks.ts` mention `champJointLock.ts` in comments only; no Worker source imports the changed modules.

### 7. The stated limits

- **Awards flag limit behind C = 0.** Real and reachable from the Worker's own writes: `eventAwards.ts` limit 1 (a further recipient of a consuming type already listed, over an hour after the list changed; 72 of 109 championships give more than one Impact). It is the same limit the reservation has had since 261009-vp9. What is new: the joint proof now survives a final finals flag while a division's flag is open, so a late recipient could take a slot from a team the proof showed Locked in that window. In ordinary order the divisions' awards precede the finals', so the window is rare. **A limit, not a gap**; stated in the header and the SUMMARY.
- **A division's flag true before its playoff points.** Not producible by the Worker: `awardsPostedRule` at the live vantage needs a playoff point (`districtRankingsMerge.ts` 1274). Only the offline publisher's hindsight vantage (`publishDistricts.ts` 925) can, and there is no scheduled publish (`.github/workflows` has only deploy and test; the one cron is the Worker's). Operator discipline, as stated.
- **A proven field turning unproven.** Producible only by capacity changing (a re publish) or rows being withdrawn. The field proof's tolerance is half of the largest key, so a handful of withdrawn rows does not flip it. A later unseen key needs a field already at capacity.
- **Capacities changing, a district publish during a live championship:** operator actions, not the Worker. Not reachable in normal live operation.
- The SUMMARY's unwalked list is complete as far as I can find. One addition worth saying plainly: progressive posting of judged awards AFTER the flag is true (flag true at the first batch, further awards landing later) is walked only as a single tick; my core level check below covers its effect.

## Warnings

**W1 (header over claim, follow up recommended).** `champJointLock.ts` "WHY IT IS MONOTONE" and the task title say no bound rises when a division's Awards turn final. At the core, over awards open to final transitions (posted points enter floors, `awardedRivals` named, K shrinks) on my random instances: **no other team's posting ever raised a bound** (0 of 335,397 comparisons with realistic naming), so D1 itself is monotone for rivals. But a team whose OWN award posts can have its OWN bound rise by 1 in about 0.003% to 0.03% of comparisons (30 of 105,783 with small pools, 7 of 335,397 with six extra bulk rivals per instance; all deep pack teams). Mechanism: its floor jumps past a rival that was covered by floor, the rival becomes uncovered and is counted by the seat cover and again as the winner's fill in, which the bound has always allowed when the fill in pool is no larger than the fill in count. Smallest example from my script (seed 1256): T = mem20 floor 155 (member of alliance 2, value 39), rival free0 158 eligible in group 0, rival T0 200, judged K 1, fill ins 2; mem20's own 15 point award posts (floor 170, K 0): bound 2 then 3. This is not specific to D1: any rise of a team's own floor (its own playoff points landing) does the same, and those facts are walked on every real championship with 0 lost. So: no reachable failing sequence found, and the lock relevant teams (large pools) do not show it. The honest wording is "monotone over every fact walked, with this known relaxation at the core". Suggest softening the sentence in `champJointLock.ts` and adding the other team posting property (my `bf1.mts` section "CORE LEVEL MONOTONE") as a core test.

**W2.** The awards flag limit above, new exposure only inside the rare window.

**W3.** Unobserved live. Nothing here can substitute for the first real 2027 divisioned District Championship; the Playwright specs are live only and no divisioned championship is live.

## Smaller observations

- SUMMARY self check says `git status` shows only the todo file and this task directory; there is now also an untracked `.planning/quick/261010-jyn-...` directory from another session. Not part of this task.
- Full root `npx vitest run` (356 files, 8901 tests) was not rerun by me; I ran the two required monotone files and the five unit files (217 tests) and every gate.
- The todo item 10 edit is exactly the one sentence strike; the file is uncommitted as intended. Six commits ahead of `origin/main`, none pushed.

## Files

Verifier scratch (not in the repo): `scratchpad/d7r-verify/bf1.mts`, `shuffle/patch.cjs`, `shuffle/shuffle.test.ts`, `shuffle/results.txt`, `shuffle/results-off.txt`, `capcheck.mts`, `final/` (gate output), `vitest-mono.txt`, `vitest-unit.txt`, `tsc.txt`.

_Verified: 2026-10-10. Verifier: Claude (gsd-verifier)._
