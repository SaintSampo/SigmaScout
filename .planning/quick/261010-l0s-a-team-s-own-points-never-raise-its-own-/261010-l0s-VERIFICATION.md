---
quick: 261010-l0s
verified: 2026-10-10
head: d95bfc4d (main, 4 ahead of origin/main b776d222, none pushed)
status: passed
blockers: 0
warnings: 3
verifier: Claude (gsd-verifier), independent code and independent runs
---

# 261010-l0s verification: a team's own points never raise its own joint lock bound, and the paid pick is on its alliance

## Verdict: PASSED, with 3 warnings and 0 gaps

Nothing in the code or the runs falsified the goal. No future above the bound was found, no bound rose over any transition the task claims, the paid rule understates in none of the cases tried, and history did not move. The repo was not edited by this verification (git shows only the two todo moves and untracked files that were there before, none mine). All scratch material is under `scratchpad/l0s-verify`.

I did not choose `human_needed` because the one thing that cannot be checked offline (TBA posting an event's playoff points together, and no live district weekend seen under these rules) is the inherited, stated assumption of quick task 261009-vp9, not a new must-have of this task. It is carried as warning W1.

## 1. Soundness of the matching, independent brute force

Written from scratch (`gen.mts`, `bf.mts`). It imports ONLY the public `jointLockBound` and builds plain `JointLockInput` objects. It enumerates RULE LEGAL FUTURES directly: every injective assignment of the placement maxima to the enumerated alliances, fixed alliances at their values, each rival's role (nothing, one backup seat on an alliance the frame pays and that has a spare seat, the winner's fill in, with eligibility by seat group, rivals no group names eligible everywhere), one judged award per rival (none for awarded rivals, none for slot only), listed unconfirmed picks read both ways (on the alliance, occupying one of its spare seats; or never on it and free), listed only picks with `settled` on placed alliances and on the decided winner, T only listed by a candidate winner, slot only rivals, consuming awards in closed form. Shapes: no seat groups (module builds the frames), one group, two groups, three groups; one or two frames; T confirmed or listed.

| Run | Instances | Future above the bound | Bound reached, lax reading | Bound reached, strict reading |
| --- | --- | --- | --- | --- |
| main (up to 6 rivals, 3 alliances a group), seeds 1,000,000 / 2,000,000 / 3,000,000, 150,000 each | 450,000 | 0 | 450,000 | 442,918 |
| big (up to 9 rivals, 4 alliances a group) | 3,000 | 0 | 3,000 | 2,926 |
| stress (up to 10 rivals, few confirmed members, so many free rivals), 6 processes x 6,000 plus 3,000 | 39,000 | 0 | 39,000 | 37,349 |
| tiny, pruned search against a FULL unpruned search | 20,000 | 0 | 20,000 | 19,744 |
| Total | 512,000 | 0 | 512,000 (100%) | 502,937 (98.2%) |

- Lax reading = the proof's own (a listed pick in a seat does not take the seat away). The bound equals the exact maximum over those futures at every one of 512,000 instances: no rival is counted twice and none is lost. Strict reading = rule legal (the listed pick sits in one of its alliance's spare seats): never above the bound; below it at 9,063 instances (1.8%, the stated safe side looseness).
- Pruned search equals full search at 20,000 of 20,000 (the dominance pruning loses nothing).
- The search BITES. I broke a scratch copy of the module in 7 single places and the brute force found futures above the bound each time (of 4,000 instances): winner's fill in one short 395, winner's members not counted 1,866, one consuming award dropped 1,402, judged budget one short 250, every seat one short 78, fill in closed 1,088, slot only rivals not counted 1,083.
- Smallest instance above the bound: none exists, so no BLOCKING gap.
- The repo's own two seat group test was run too (`--reporter=default` printed it): 39,751 instances, 5,656,885 rule legal futures, 0 above, bound reached at all 39,751 on the proof's reading, 0 award hand out mismatches. Its source calls only `jointLockBound` of the module (checked by grep); the names it lists as not used appear only in comments.

Independence caveat: the code is independent, the RULE READING is shared with the module's authors (one judged award per rival, backups bounded by spare seats, placement maxima, consuming awards count any rival). Those are the documented rules, not something a brute force can re-derive.

## 2. The two properties, own transition search

`tr.mts`, public `jointLockBound` only, 4 x 60,000 seeds (main) plus 2 x 8,000 seeds (stress), three picks of the acting team per seed, every pool team compared:

| Transition | Comparisons | Bound rises |
| --- | --- | --- |
| T's own floor rises (1 to 60) | 768,000 | 0 |
| T's own judged award posts (floor up, budget down one, T named awarded) | 516,084 | 0 |
| Another team's judged award posts, every other team's bound read | 2,350,530 | 0 |
| Another team's floor rises by CONVERSION (floor up, extra down by the same) | 786,523 | 0 |
| Same checks across two championships (`jointLockBoundMultiple`), 60,000 seeds: own floor 60,000, own award 45,020, another's award 89,161 | 194,181 | 0 |
| Information only: another team's floor rises with nothing taken out of its extra | 2,907,730 | 141,629 (by 1): legitimate, that team really can finish higher |
| Information only: T's own floor rises, the OTHER teams' bounds | 3,524,406 | 182,939 (by 1): legitimate, T is their rival |

Sensitivity of the search: the same search on the module at b776d222 (before the task) finds own floor rises 627 of 60,000 (up to 3), own award 365 of 40,210, another's award 26 of 179,632, and in the two championship sum 306 / 504 / 14. So a rise would have been seen. The repo's own always on test prints 0 rises over 814,080 comparisons (391,941 and 422,139), matching the header.

The paid tick as a transition (`tick.mts`: a listed 0 point pick of the decided winner is paid, joins the winner's members, floor up by 1 to its settled value, extra down by the settled value, the winner's seat count down by one; single path and divisioned path, every pool team compared): 849,196 comparisons, 0 rises. With the pick NOT joined (the code before the rule) 42,460 rises. The rule is what removes them.

## 3. The paid rule

Read `confirmedPicks` (champJointLock.ts 1581) and both call sites (champLedgerStatus.ts 1457 single and two championship, 1806 divisioned). Findings:

- A paid pick listed by two alliances (or one list twice): `listedExactlyOnce` keeps it unconfirmed on both, both seats stay open. Status test "guard one" and "guard one at a division" exist and pass.
- Two unlisted teams paid at the finals: `finalsBackups` is empty unless exactly one, so nobody is named, the winner's seat stays open. Test "guard two".
- A division winner with four confirmed picks and a fifth team paid at the finals: the code DOES read five members (`confirmed` = 4 + the finals backup) and `spare = max(0, 4 - 5) = 0`. It closes no open seat (the four confirmed already left 0) and only adds one covered member. I ran it at the core: 4 confirmed + e as a plain rival gives bound 4; the same with e as the fifth member gives 5. So it can only RAISE a bound (the larger bound side), never understate. It is also true that the fifth is on the champion's finals alliance (paid at the finals, unlisted, own division). Rules and the corpus say no alliance lists more than four (`paidfacts.mts`: 89 keys, 954 paid teams, longest list 4).
- Playoff points present before the key's Playoffs read final: gated by `stage.elim` at all three reads (single, division, finals).
- A rewound stop: read only where the stop's own stage says the key's Playoffs are final, so hindsight rows are never read earlier.
- Guards and gates bite. On a scratch copy of the tree (never the repo), each change failed the status test file (107 tests, 107 pass unmodified):
  - guard one at a single championship removed: 1 failed, 106 passed ("the tick the playoff points land")
  - guard one at a division removed: 1 failed ("guard one at a division")
  - guard two removed: 1 failed ("the tick the finals' playoff points land")
  - gate removed at the single key: 4 failed; at a division key: 2 failed; at the finals key: 2 failed
- Corpus facts reproduced (`d5_facts.mts`, `paidfacts.mts`): 89 keys, 1,937 listed teams, 0 named twice at a key, 0 of 40 divisions with an unlisted team paid at the finals, 954 paid teams (894 at championship or division keys) and 0 of them unlisted.
- A one tick sound reading: in the model the paid pick was already counted at the same place before the tick (my `tick.mts` above).

## 4. Monotonicity on real data

`REQUIRE_LOCAL_DATA=1 npx vitest run scripts/champJointMonotone.test.ts scripts/champFieldStagedWalk.test.ts` from the repo root, run twice (once with the default agent reporter that hides console, once with `--reporter=default` to print): both `Test Files 2 passed (2)`, `Tests 163 passed (163)` (130 + 33), about 17 minutes. With `REQUIRE_LOCAL_DATA=1` an absent data group is a FAILING test, and none failed or is listed skipped, so no local data group skipped.

Printed counts: rules on, nine tallies, 2,712,435 team bounds compared, 0 higher (A lattice 1,253,848; B two division 63,616; B FIM 130,048; C finishing first 10,990; C lattice 570; D live walks 979,948; D Winner first 88,361; D awards first 24,368; D late rows 160,686). 2024 NE read exactly: 36 readings, 36 flag edges, 32 stop edges, 11,761 bounds, 0 higher. Group A rules on: 1,200 readings, 0 Locked lost, 0 margin drops. Group E, one event walks exact: 1,079 readings, 991 edges (874 step, 117 flag), 84,991 bounds, 0 higher, 0 Locked lost, 0 margin drops; paid rule OFF: bounds higher 20 over 5 edges (2024fnc 1, 2025fin 2, 2026ca 16, 2026fnc 1), 0 Locked lost. Each rule off variant is asserted to bite (the awarded rule off loses 952 Locked and drops 33,388 margins; the stop rule off loses 306; the two championship stop rule off loses 91; the forced edges lose 28 and 770). The 2026 NE series reads 22 at the last two ticks with frc8724 asserted not Locked the tick before, Locked from the finals' state on and at the end.

## 5. History

- `d7r/gates.sh` into `l0s-verify/final` (head d95bfc4d): all 8 steps exit 0.
- `gates_compare.sh l0s/exec/after-final final`: joint 1200 lines, champ 129, ledger 163, settled 35 identical; cutoff no drift; take-backs 0 over 48 championships and 412 stops; Now identical (artifacts 109, teams 16345); publisher differing 0; `UL3 COMPARE CLEAN`, `R9X COMPARE CLEAN`, last line `D8 GATES IDENTICAL`.
- Same against `d7r/exec/final` (the reading before this task): identical lines, last line `D8 GATES IDENTICAL`. No sweep row moved.
- Worker closure: `WORKER BUNDLE UNTOUCHED (6 files probed)`, closure 103 files. Only `apps/web/.../champLedgerStatus.ts` imports `champJointLock.ts` (grep), the Worker never does. Changed files are 6, all under apps/web, packages/core and scripts tests. No republish and no Worker deploy owed; only a push.

## 6. Tests and types

- `npx vitest run packages/core/districts/champJointLock.test.ts apps/web/src/components/districts/champLedgerStatus.test.ts`: 2 files, 193 tests passed (86 core + 107 status).
- `npx tsc --noEmit && ... -p apps/web/tsconfig.json && ... tsconfig.e2e.json && ... apps/worker/tsconfig.json && echo TYPECHECKS CLEAN`: printed `TYPECHECKS CLEAN`.

## 7. Headers and SUMMARY against the proof

Checked and accurate: the counts they quote for the core tests (13,899 and 17,628 equal to the model; 16,277 / 28,541 / 33,913 never below the oracle; 814,080 comparisons all zero; 39,751 instances, 5,656,885 and 7,232,335 futures), the per file counts, the gate lines, the corpus facts, the 2026 NE series, and that the repo's brute force calls only `jointLockBound`.

Independent of the matching (enumerate futures, share no code with it): the two seat group brute force (39,751), E1, E2, E3, S1 to S3 (per the summary), the one group brute force, and my own 512,000. NOT independent (read a future the way the module does, as an allocation): equality with `modelMostTakers`, the old proof kept as an oracle, `coverMatching` against enumerated assignments and against the old exact program. The header says this correctly ("Those three read a future the way this module does"); the SUMMARY table separates them correctly. The word "exact" in the header is supported from futures by the two seat group test and by my search (bound equals the maximum at 512,000 of 512,000).

Stated limits, and whether each is reachable in normal live operation:

1. Suite reads most bounds only to 12 above the points slots. Not a live limit; Locked and margin concern only bounds near the slot count.
2. "Monotone beyond the two properties rests on walks." Reachable by definition: any live sequence not walked could in principle take a lock back. The two properties are proven; the rest is tested, not argued.
3. Not walked: published capacities changing during a championship, an alliance list changing after a pick, a row or point withdrawn, a key's playoff points landing in part, a further award recipient added after the list settled, FIM 2023 to 2025 as micro steps. Several are plausible in normal operation (a list change, partial landing, a late award recipient, a TBA correction). None is new in this task.
4. Paid rule: a team TBA paid that no alliance lists and no played row shows is confirmed nowhere, so a bound can rise by one at that tick. 0 of 954 paid teams in 2023 to 2026. Reachable only if a backup who never played and is not listed is paid; low.
5. The two guards' cases: not in the data (above). Reachable only through a TBA data error. The unguarded fifth member: reachable only by a rule violation; it raises a bound, never lowers.
6. The gate's assumption (TBA posts an event's playoff points together): reachable in every live event, and not verified live. This is warning W1.
7. Looseness on the safe side (a listed pick keeps a seat the proof does not take away): always present, only raises a bound.

## Warnings (none block)

- W1 (inherited assumption, unobserved live). Everything about a payment being in the floors from the tick the stage turns final rests on TBA posting an event's playoff points together (quick task 261009-vp9). No live district weekend has run under these rules; the first real exercise is the first 2027 district championship. Membership by payment is sound regardless; what the assumption protects is the timing of the floors. A late partial payment would let a bound rise, the same exposure vp9 already accepted. The task states this plainly in both headers.
- W2 (process hazard, not code). `git status` shows two STAGED renames (`.planning/todos/pending/champ-joint-lock-follow-ups.md` and `locks-settled-playoffs-follow-ups.md` to `completed/`) plus an untracked `locks-first-live-2027-watch.md` that this task did not make. Commit with explicit paths and check `git log origin/main..main` before the push, so those are not absorbed into the l0s push.
- W3 (tooling note). Vitest 4 hides console output under the agent reporter, so the "printed counts" of the monotone and core files appear only with `--reporter=default`. And one `npx vitest` I ran with its working directory set to a scratch tree resolved vitest 5.0.3 from the existing npx cache (a copy fetched during run A, per the SUMMARY) and failed in 0.7 seconds; nothing was downloaded or installed, and every later run used the repo's 4.1.10 from the repo root.

## Evidence index (scratchpad/l0s-verify)

`gen.mts`, `bf.mts` (brute force), `tr.mts` (transitions), `multi.mts`, `tick.mts`, `five.mts`, `paidfacts.mts`, `guardmut.cjs`; logs `bf-stress-*.log`, `tr-*.log`, `monotone2.log`, `core2.log`, `core-status.log`, `tsc.log`, `final/` (gates), `paidfacts.log`; mutated module copies `mut_M1` to `mut_M7`, `mut_old`.
