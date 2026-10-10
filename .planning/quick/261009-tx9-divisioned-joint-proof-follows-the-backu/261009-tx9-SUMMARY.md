---
phase: quick-261009-tx9
plan: 01
subsystem: districts / Champ Locks
status: complete
tags: [champ-locks, lock-proof, soundness, dcmp, divisions, backup-robot-rule]
requirements_completed: [261009-tx9]
dependency_graph:
  requires: [261009-kt3 divisioned joint proof, 261009-pgq judged budget and rowless teams, 261009-tx8 tie routing]
  provides: [JointLockSeatGroup, JointLockInput.seatGroups, four field JointLockFrame, DivisionedJointStructure.spareByAlliance, one seat group per division on the divisioned status input, ruleViolations legality check]
  affects: [Champ Locks tab Locked verdict at FIM, NE, ON and TX at every rewound and live stop from Alliances final to Finals after sf5]
tech-stack:
  added: []
  patterns: [seat groups with one group as the shipped degenerate case, exhaustive enumeration over rule legal futures, decisive instances asserted with equality, legality check on the samplers themselves, mutation checks applied as patches and removed with git checkout]
key-files:
  created: []
  modified:
    - packages/core/districts/champJointLock.ts
    - packages/core/districts/champJointLock.test.ts
    - apps/web/src/components/districts/champLedgerStatus.ts
    - apps/web/src/components/districts/champLedgerStatus.test.ts
    - scripts/measureChampJointLocks.test.ts
decisions:
  - "The divisioned proof follows the verified backup robot rule: one backup per alliance for the whole championship, from its own division's unselected teams, never a team already on an alliance. The kt3 reading R5 seats, the D9 seat bonus, and the seats and fill ins open to any rival (step 6, guard G3) are removed."
  - "P4 (D7): a rival on no alliance that no seat group names is eligible in every group, so the proof never rests on a competing team's row being posted."
  - "P3 (D7): a listed pick that is not confirmed counts as a member and as an eligible team of its division, and a frame whose winner only lists T is no longer skipped."
  - "Executor, covering side: a division's seat group also names every pick an alliance there lists and has not confirmed, row or no row. Zero cost on the corpus."
  - "Executor, covering side: an empty seatGroups list reads as absent (one group), so it can never remove every seat."
metrics:
  duration: "about 57 minutes (00:41 to 01:38 local, 2026-10-10)"
  completed: 2026-10-10
estimate:
  tokens: 70000
  tasks: 3
  confidence: high
actuals:
  tokens: 39100
  tasks: 3
  commits: 2
---

# Quick 261009-tx9: The divisioned joint proof follows the backup robot rule

The divisioned Champ Locks joint lock proof now follows the verified backup robot rule, which removes three cautious terms of quick task 261009-kt3 and restricts every backup seat and fill in to the alliance's own division. Over the 16 divisioned championships of 2023 to 2026 the combined Locked on points count rises from 2,667 to 2,865 lock stops (198 more) with zero lost at any stop, zero sweep violations and zero take backs. The single event and California shapes are byte identical.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | 997061b5 | feat(261009-tx9): the divisioned joint proof follows the backup robot rule |
| 2 | 61444f38 | fix(261009-tx9): the divisioned samplers are checked against the backup robot rule |
| 3 | none | The pins did not move after Task 2, so there was nothing to commit. The todo is edited and uncommitted by constraint. |

Both commits were staged by explicit path. `git diff --name-only 8fb29c8a..HEAD` lists exactly the five source files. Nothing under `.planning/` is committed and nothing is pushed.

## The rule and its three sources

At a divisioned championship an alliance has at most ONE backup for the whole championship (division playoffs and finals together). A backup is an unselected team of the alliance's OWN division. A team already on an alliance is never a backup.

1. **The 2026 manual, District Tournaments:** "If an ALLIANCE in a District Championship Playoff has not yet recruited a BACKUP TEAM per section 10.6.3 BACKUP TEAMS, the ALLIANCE CAPTAIN may bring in only the highest ranked team from their division's BACKUP POOL to join its ALLIANCE."
2. **FIRST's 2026 Alliance Selection Script:** the backup pool is the next eight highest ranking UNSELECTED teams; each alliance has ONE opportunity to substitute in a robot from the backup pool; backups come in by ranking order.
3. **The corpus, every divisioned championship of 2017 to 2026 (24 championships, 64 finals alliances):** no division or finals alliance lists more than four teams; exactly two teams were added for a finals (frc5926 on 2023micmp alliance 1, frc4327 on 2026micmp alliance 4), both unpicked teams of the alliance's own division; no finals roster carried a team from another alliance or another division.

The module header of `champJointLock.ts` states the rule with these sources, the four frame steps that remain, and readings P3, P4 and P8.

## Baselines (taken at HEAD 8fb29c8a before the first edit)

- Precondition held: clean tree under the three directories, the 261009-tx8 commits in the log.
- Sweep: 1,179 lines. Single dump 248 lines, California dump 8 lines, divisioned dump 156 lines.
- The divisioned baseline dump is byte identical to the planner's `prototype_before_ee445919.txt`. Every baseline number equals the plan's expectation from 9e979118; nothing differed.
- Take back check at baseline: `championships 48, stops 412, take-backs 0`.

## Sweep totals, before and after (`npx tsx scripts/measureChampJointLocks.ts`)

| Shape | Championships | Stops | Proof ran | Shipped | Joint only | Combined | Violations | Locked earlier |
|---|---|---|---|---|---|---|---|---|
| Single, before | 31 | 248 | 217 | 340 | 414 | 754 | 0 | 167 |
| Single, after | 31 | 248 | 217 | 340 | 414 | 754 | 0 | 167 |
| Divisioned, before | 16 | 156 | 140 | 1,582 | 1,085 | 2,667 | 0 | 381 |
| Divisioned, after | 16 | 156 | 140 | 1,582 | 1,283 | 2,865 | 0 | 391 |
| Two championships, before | 1 | 8 | 7 | 41 | 62 | 103 | 0 | 21 |
| Two championships, after | 1 | 8 | 7 | 41 | 62 | 103 | 0 | 21 |
| All, before | 48 | 412 | 364 | 1,963 | 1,561 | 3,524 | 0 | 569 |
| All, after | 48 | 412 | 364 | 1,963 | 1,759 | 3,722 | 0 | 579 |

- Single subtotal line, unchanged from the baseline: `SINGLE SUBTOTAL 31 championships / 248 stops / proof applied at 217 / shipped 340 / joint only 414 / combined 754 / violations 0`.
- After: `SKIPPED (0)`, `VIOLATIONS: none`, no floor gap.
- Sweep run time 20.9 s before, 8.6 s after.

## Per stop gains (set level compare over all 156 divisioned stops)

`TOTAL stops 156 / combined 2667 -> 2865 / gained 198 / lost 0 / missed at Now 0`. S' did not move at any stop.

| Stop | Before | After | Gain |
|---|---|---|---|
| Alliances final | 1 | 2 | +1 |
| Round 1 | 1 | 2 | +1 |
| Round 2 | 8 | 16 | +8 |
| Round 3 | 78 | 155 | +77 |
| Round 4 | 168 | 217 | +49 |
| Round 5 | 253 | 280 | +27 |
| Divisions final, finals not started | 426 | 436 | +10 |
| Finals after sf1 and sf2 | 245 | 255 | +10 |
| Finals after sf3 and sf4 | 246 | 257 | +11 |
| Finals after sf5 | 253 | 257 | +4 |
| Finals decided, awards open | 473 | 473 | 0 |
| Now | 515 | 515 | 0 |

Per championship: 2023fim +52 (469 to 521), 2024fim +43 (465 to 508), 2025fim +47 (435 to 482), 2026fim +49 (472 to 521), 2023ne +1, 2024ne +1, 2025ne +1, 2025fit +1, 2026fit +3, every other 0 (2026ne, all four ont, 2023fit, 2024fit).

Largest single stops: 2023fim Round 3 11 to 36, 2025fim Round 3 6 to 25, 2026fim Round 3 9 to 25, 2023fim Round 4 27 to 44. The full per stop list with team keys is in the scratch file `tx9/final_compare.txt`.

## Pins as executed (never fitted)

| Stop | S' | C | K | Before | After | Change | Bounds | Near misses kept |
|---|---|---|---|---|---|---|---|---|
| FIM Divisions final, finals not started | 83 | 8 | 8 | 63 | 65 | frc494 and frc1188 join, each at bound 82 | 17 to 82 | frc5675 (83), frc3707 (84) |
| FIM Finals decided, awards open | 80 | 8 | 8 | 64 | 64 | none | 9 to 79 | frc5462 (81), frc70 (81) |
| NE Divisions final, finals not started | 32 | 8 | 4 | 18 | 18 | none | 13 to 31 | frc4909 (33), frc2713 (33) |
| NE Finals decided, awards open | 28 | 8 | 4 | 16 | 16 | none | 9 to 27 | frc4909 (29), frc2713 (29) |

- Every executed set equals the plan's expectation from 9e979118. No team left a set.
- Every member is `locked` or `lockedAward` at Now and no team that missed is in a set (asserted by the pin loop and by the compare, missed at Now 0).
- The FNC pins, the two CA pins and the D3 pin were not touched and pass.
- FIM Divisions final set as executed (65): frc1023 frc10633 frc1188 frc1189 frc1498 frc1701 frc1918 frc201 frc2054 frc2075 frc2137 frc2337 frc2586 frc2611 frc2619 frc27 frc2767 frc2851 frc2960 frc33 frc3414 frc3536 frc3538 frc3539 frc3620 frc3641 frc3656 frc3668 frc4237 frc4362 frc4391 frc4398 frc469 frc494 frc4967 frc5066 frc5086 frc5114 frc5166 frc5193 frc5216 frc5460 frc548 frc5534 frc5660 frc5712 frc5907 frc6002 frc6090 frc6121 frc6152 frc6615 frc67 frc68 frc7160 frc7166 frc7197 frc7220 frc7769 frc8280 frc8517 frc8608 frc9245 frc9757 frc9771.
- The pins were rechecked on the final tree after Task 2: all four strings unchanged.

**`cmp` against the planner's prototype dump:** the executed divisioned dump is byte identical to `prototype_after.txt` (every locked set, every joint bound, every near miss, all 156 stops).

## The take back check

`npx tsx orch_takeback.mts` after the change, on the final tree: `championships 48, stops 412, take-backs 0`. The same line printed at the baseline.

## Tests and typechecks (printed counts)

- **STEP A, the regenerated soundness tests against the UNCHANGED proof:** 47 tests, 46 passed, 1 failed. The one failure is T6, as the plan expected: `expected 0 to be greater than or equal to 3` (bound 0 against 3 real takers when a frame whose winner only lists T is skipped). The six E3 variants, the three S2 stops and T1 to T5 passed against the unchanged proof.
- **STEP B, RED:** 53 tests, 14 failed (the new seat group cases, the absence pins, the structure tests, T6), 39 passed. Every regenerated E3 and S2 test still passed.
- **Task 1 verify set** (`champJointLock.test.ts`, `locks.test.ts`, `apps/web/src/components/districts`, `measureChampJointLocks.test.ts`): 31 files passed, 1,047 tests passed. Before the pins were replaced the only failure was the FIM Divisions final pin (65 against the old 63).
- **`champJointLock.test.ts` alone:** 54 passed at Task 1, 56 passed after Task 2. E1, E2, S1, S3, R1 to R3, dominance, edges, R9, R10 and D10 pass with no expectation edited. R11's expectation (1) is unchanged; its frame literal dropped the removed fields.
- **Pin file:** 11 passed, ran, not skipped.
- **Full root `npx vitest run`:** 350 files passed, 8,369 tests passed, 1 skipped (this task adds no skip; 261009-kt3 recorded the same single skip).
- **Typechecks:** `TYPECHECKS CLEAN (root, web, e2e)` after Task 1, after Task 2 and on the final tree.
- **`measureChampTenets.ts`:** `VIOLATIONS: none`. Locked on points shown 6,836, Locked out shown 271,340.
- **`measureLedgerSettledTenets.ts`:** `VIOLATIONS: none`, `SKIPPED (0)`.
- **`measureChampCutoff.ts --check-history`:** `no drift` for `dcmpHistory.generated.ts` and `champCutoffTuning.generated.ts`. Nothing regenerated.
- **Dump gates on the final tree:** `SINGLE AND CA DUMPS BYTE IDENTICAL` (248 and 8 lines).

## Regenerated soundness tests

- **E3, six variants, exhaustive over rule legal futures:** (30, 0) C 1 K 1; (60, 30) C 1 K 1; (60, 30) C 0 K 0; (60, 30) C 1 K 1 with division 1 decided; the decisive open instance; the decisive decided instance. In each decisive instance the decisive team's worst legal future EQUALS its bound (asserted with `toBe`).
- **E3 over seeded random floors (executor addition):** 8 fields, 5,697,088 rule legal futures, 106 teams exactly on their bound, none above.
- **S2, three stops, 20,000 rule legal futures each**, C 5, K 56, 2026 values, the Round 4 stop with two listed fourths.
- **T1 to T6**, the targeted real futures.
- **Legality test:** 141,440 futures from the E3 enumerator (one pool team in each of the six variants) and 60,000 from the S2 sampler, zero messages. Counted across those 201,440 futures: a backup on the champion 116,738; a backup on a losing finals alliance 185,396; a backup that joined only for the finals 185,071; a division winner with no backup 150,337; a listed fourth that stays 86,923; a listed fourth that is another alliance's backup 150,161. Five hand built illegal futures are each reported with exactly one message of their own.

## Mutation matrix (M1 to M7)

Each mutation was applied as an exact string patch to the repo file while it equalled HEAD, its `git diff` was read and showed only the mutation's lines (numstat 1/1, or 2/2 for M5), the test file was run, and the mutation was removed with `git checkout -- packages/core/districts/champJointLock.ts`. After the last one: `CORE MODULE EQUALS HEAD`, 56 passed.

| Mutation | Soundness tests that failed | Other tests that failed |
|---|---|---|
| M1: an alive alliance of another division fixed at the division champion maximum alone | E3 decisive open; E3 random floors; T1; T3 | round stop structure |
| M2: every frame's fill ins are 0 | E3 all four general variants; E3 decisive open; E3 decisive decided; E3 random floors; S2 Divisions final; S2 finals after sf1 to sf4; T2; T4 | round stop structure; G1 |
| M3: a fixed and ALIVE alliance contributes no seat | E3 decisive open; T3 | R11; seat inside its group; P4 |
| M4 (P10): the fill in pool counts only rivals within reach of a seat or a judged award | E3 decisive open; E3 decisive decided; T2; T4 | the greedy dominance test; P4; P3 champion backup |
| M5 (P3): a team an alliance lists is not entered among its group's eligible rivals | E3 decisive open; E3 decisive decided; T4 | both P3 unit tests |
| M6: a fixed alliance that is NOT alive (a decided winner) contributes no seat | E3 decisive decided; E3 random floors; S2 Divisions final; T5 | P4; the D2 absence pin |
| M7 (P3 for T): a frame whose winner lists T is skipped even when a group names T | T6 | none |

Every mutation fails at least one soundness test. M5 fails E3 variants (both decisive instances) and M6 fails the decisive decided variant, as the plan required. No targeted future had to be added.

## Readings as applied

- **P1.** Seat groups reach the proof as `JointLockInput.seatGroups`. Absent, the bound behaves as one group of every alliance and every rival on no alliance; the single and California dumps prove it byte for byte.
- **P2.** Eligibility is read off the status rows: a team with a dcmp source at the division key that no alliance there confirmed. Widened by deviation 1 below.
- **P3, in full.** A listed pick that is not confirmed is a hindsight fact, on both sides and for T itself. On an alliance its division has not placed, such a team is paid its alliance's scenario value as a member AND is an eligible team of its division for a seat or a fill in, at floor plus extra with no alliance value. One rival may be counted twice, which only raises the bound. When T is such a team, a frame whose winner lists T is NOT skipped, because T may never have been on that alliance. The proof recognises the case as a team that an alliance lists and a seat group names.
- **P4, in full (plan checker W2, CONTEXT D7).** A pool or slot only rival on no alliance that no group names is eligible in EVERY group: it is offered every division's seats and every candidate winner's fill in, and still counts through a consuming award and one judged award alone. The proof never assumes a competing team's row is posted. It may be counted once per group, which only raises the bound. A team an alliance lists that no group names (a confirmed pick) is eligible nowhere.
- **P5.** The winner's seats are fill ins only. The winner carries no value and offers no seat at a points value.
- **P6.** The fill in pool is the eligible rivals of the winner's own group that are not its members.
- **P7.** `extraSeats`, `fillInsFromAnyRival`, `enumeratedSeatBonus` and `anyRivalSeats` are deleted. `finalsSpareByAlliance` is renamed `spareByAlliance`.
- **P8.** The judged budget stays one pool: each group's cover is computed on its own seats and rivals, and the covers are combined by the best split.
- **P9.** The reachable filter uses the largest seat value over the placement values and every usable frame's fixed values.
- **P10.** M4 was read as the fill in pool counting only rivals within reach of a seat or a judged award.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Soundness] A division's seat group also names every pick an alliance there lists and has not confirmed, row or no row.**
- **Found during:** Task 1, STEP B (the status test).
- **Issue:** the plan's P2 reads eligibility off rows only. A pick an unplaced alliance lists, not confirmed, whose row is not at that division's key would then be a member named by no group, so eligible nowhere, and the "never on that alliance" future would be uncovered. The plan's own status test expects the listed fourth of alliance 13 in group 1, and in the fixture that team's row is at division 2's key.
- **Fix:** `divisionedJointProof` adds every listed pick of the division's alliances that is not confirmed to that division's eligible list. Strictly more covering.
- **Cost:** zero. The executed divisioned dump is byte identical to the planner's prototype dump, which used rows only.
- **Files:** `champLedgerStatus.ts`, pinned in `champLedgerStatus.test.ts`. **Commit:** 997061b5.

**2. [Rule 2 - Soundness] An empty `seatGroups` list reads as absent.**
- **Issue:** with an empty list, "every group" would be no group, and a rival no group names would be offered no seat and no fill in.
- **Fix:** `jointLockBoundAt` treats an empty list as one group of everything. The status code always passes one group per division, so nothing changes on the corpus. **Commit:** 997061b5.

**3. [Rule 2 - Tests] E3 over seeded random floors added.**
- **Issue:** the four general E3 variants share one floor function and have slack against most terms (the planner's own finding).
- **Fix:** one committed test over 8 seeded fields (numbers above). It fails under M1, M2 and M6. A scratch run of 120 seeded fields (66,702,400 rule legal futures, 978 teams on their bound, 0 failures) was also made and not committed. **Commit:** 997061b5.

### Smaller differences

4. **The D3 absence pin's structure.** Division 1 is made undecided with 11 and 12 alive (the kt3 D9 test left 11 as its decided winner beside alive alliances), so the candidates are 11, 12, 21, 31, 41. The pinned values are the plan's: 0 at 51 short, 1 at 21 short.
5. **`BackupRecord` carries a `finalsOnly` flag** beside the team and alliance pair, needed for the non vacuity count. `ruleViolations` reports three breaches beyond the plan's list: a team on the champion roster that is not on the champion, a member paid above its alliance, and a team paid without being on an alliance.
6. **The legality count "an alliance with no backup"** is measured as a division winner with no backup.
7. **The cover table size was not measured.** The header states no number and says only that a table now covers one seat group's seats.
8. **Tooling.** A long Git Bash heredoc failed with `ENAMETOOLONG`, so edits went through small exact string patch scripts in the scratchpad (each anchor must match exactly once) with their content written by the Write tool. The mutations used the same patch script instead of the Edit tool; the hygiene steps were otherwise followed to the letter.
9. **Task 3 has no commit**, because no pin moved after Task 2 and the todo is not committed by constraint.
10. **The SUMMARY is written to this path** on the orchestrator's instruction, where the plan said to return it as text. STATE.md, ROADMAP.md and the WINDOWS ledger were not updated, by constraint.

## The planner's findings, as executed

- **The measured cost of the removed terms.** CONTEXT says about 22 of 2,667. The corpus says 198 lock stops with the own division rule, which the executor measured (2,667 to 2,865). The planner's split, 179 for the three terms alone with seats still shared across divisions, was not measured again here.
- **Three of the four pinned sets were expected not to move**, and did not. Only FIM Divisions final moved, 63 to 65.
- **W2 (P4) is wider than CONTEXT D2's sentence on a rival with no row and cost nothing.** The executed dump with P4 equals the planner's prototype dump, which the planner had compared against a no row rival barred from every seat.
- **The 261009-kt3 gap for a team an alliance only lists (T6)** was reproduced against the unchanged proof: bound 0 against 3 real takers. P3 closes it, and M7 guards it.

## The todo (edited, not committed)

`.planning/todos/pending/champ-joint-lock-follow-ups.md`: items 13 and 16 read **CLOSED by quick 261009-tx9** with the old text struck, item 17 names guards G1 and G2 with G3 removed by 261009-tx9. Three lines changed, 61 lines before and after, no item added, every existing line kept.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path, schema, artifact shape, Worker, publisher or algorithm version change.

## Self-Check: PASSED

- FOUND: all five modified files, each in `git diff --name-only 8fb29c8a..HEAD`.
- FOUND commits: 997061b5, 61444f38.
- Final tree: sweep exit 0 with `SKIPPED (0)` and `VIOLATIONS: none`; single and California dumps byte identical; compare lost 0 and missed at Now 0; take-backs 0; `CORE MODULE EQUALS HEAD`; working tree clean outside `.planning/`.
