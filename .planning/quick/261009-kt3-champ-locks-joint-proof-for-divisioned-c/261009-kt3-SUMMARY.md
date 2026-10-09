---
phase: quick-261009-kt3
plan: 01
subsystem: districts / Champ Locks
status: complete
tags: [champ-locks, lock-proof, soundness, dcmp, divisions, finals, california]
requirements_completed: [261009-kt3]
dependency_graph:
  requires: [261009-2tr joint worst case proof, 261008-26o settled playoffs, 261006-lwo two championships, 261006-3gg reservation]
  provides: [finalsBracket.ts (finals topology, championshipShape), maxFinalsPointsByPlacement, JointLockFrame / divisionedJointFrames / jointLockBoundMultiple, coverUpperBound, D3 fold of every dcmp row, three shape jointProofAt, sweep over all 48 championships]
  affects: [Champ Locks tab Locked verdict at FIM, NE, ON, TX and 2026 California, every divisioned team's floor and ceiling at rewound stops]
tech-stack:
  added: []
  patterns: [frames generalization with the shipped loop as the degenerate case, sound cover upper bound above a state cap, corpus gated tenet sweep with a floor assertion, mutation checks recorded per guard]
key-files:
  created:
    - packages/core/districts/finalsBracket.ts
    - packages/core/districts/finalsBracket.test.ts
  modified:
    - packages/core/districts/bracket.ts
    - packages/core/districts/bracket.test.ts
    - packages/core/districts/champJointLock.ts
    - packages/core/districts/champJointLock.test.ts
    - apps/web/src/components/districts/champLedgerRows.ts
    - apps/web/src/components/districts/champLedgerRows.test.ts
    - apps/web/src/components/districts/champLedgerStatus.ts
    - apps/web/src/components/districts/champLedgerStatus.test.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/districts/useDistrictLedgerData.ts
    - apps/web/src/components/districts/useDistrictLedgerData.test.ts
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
    - scripts/measureChampJointLocks.ts
    - scripts/measureChampJointLocks.test.ts
decisions:
  - "Orchestrator option 1: the single and two championship paths keep CONFIRMED pick membership (alliance selection points posted and above 0); listed pick membership (R8) was measured LESS conservative on the single path (5 gained locks) and was rejected there. R8 applies only on the divisioned path, under guards G1 to G3."
  - "D10 on every shape: seats and fill ins are 4 minus the confirmed picks. With confirmed membership this is byte identical to the shipped single proof."
  - "D9: every backup seat on an enumerated alliance in W's division pays its value plus F_nw, and W's own division seats pay 90 plus F_nw."
  - "Executor addendum (soundness): finals seats are open to any rival, so a pick of an eliminated division alliance may be lifted F_nw by a losing finals alliance's seat. Without it S2 fails at Divisions final with 2026 values."
  - "The sweep's D3 floor assertion covers every dcmp row of every team (a settled division Playoffs value excepted), not only the finals row."
metrics:
  duration: "about 70 minutes of execution (16:13 to 17:22 local), plus the checkpoint round trip"
  completed: 2026-10-09
estimate:
  tokens: 160000
  tasks: 5
  confidence: high
actuals:
  tokens: 64500
  tasks: 5
  commits: 5
---

# Quick 261009-kt3: Champ Locks joint proof for divisioned championships and two championship districts

The Champ Locks joint worst case lock proof of 261009-2tr now runs at the 16 divisioned championships of 2023 to 2026 (FIM with 4 divisions, NE, ON and TX with 2, each a finals event among the division winners) and at 2026 California's two championships. The pre existing soundness gap is closed too: every dcmp tier row of a team, division and finals, now enters its floor and ceiling (D3). The corpus sweep over all 48 championships reports zero tenet A violations, zero lost shipped locks and zero floor gaps, and skips none. The single event subtotal and the FNC 2026 pins are byte identical to shipped.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | 14e87f66 | feat(261009-kt3): finals maxima, the finals bracket and championship shape in core |
| 2 | a03b5e32 | feat(261009-kt3): fold every championship row into the Champ Locks floor and ceiling, and gate each award on its own event |
| 3 | afbdda36 | feat(261009-kt3): joint lock proof over frames for divisioned and multiple championships |
| 4 | 070ff600 | feat(261009-kt3): the Champ Locks tab runs the joint proof at divisioned and two championship districts |
| 5 | d38455c4 | feat(261009-kt3): corpus sweep gates the divisioned and two championship joint proof, and the methodology names both |

Every commit staged files by explicit path. `git diff --name-only fdd99fc5..HEAD` lists exactly the 19 non planning files above. None of `districtLedgerStatus.ts`, `reservedSlots.ts`, `pooledLockInputs.ts`, the publisher, `apps/worker/` or `packages/harness/` is touched. No artifact shape, algorithm version or Worker change was made.

## Verification (printed output, not exit codes)

- **Task 1:** `bracket.test.ts` and `finalsBracket.test.ts`, 62 passed. TYPECHECKS CLEAN (root, web, e2e).
- **Task 2:**
  - The five listed suites: 196 passed.
  - `measureChampTenets`: VIOLATIONS: none. Locked on points shown 6,836 and Locked out 271,340. These are lower than 2tr's 7,234 and 271,382 because divisioned floors and ceilings are now folded and the reservation reads the finals stage.
  - The single sweep was unchanged.
- **Task 3:**
  - `champJointLock.test.ts` and `locks.test.ts`: 92 passed, every shipped test unchanged.
  - The single sweep was unchanged.
- **Task 4:**
  - Every suite under `apps/web/src/components/districts/` plus `scripts/measureChampJointLocks.test.ts`: 29 files, 908 passed.
  - Single sweep 31 / 248 / 217 / 340 / 414 / 754, VIOLATIONS: none.
  - `measureChampTenets` VIOLATIONS: none.
- **Task 5:**
  - `measureChampJointLocks.test.ts` plus `districtLedgerContent.test.ts`: 28 passed, then 11 in the pin file after the D3 pin was added. They ran, not skipped.
  - Full root `npx vitest run`: 347 files passed, 8,138 tests passed, 1 skipped (pre existing).
  - TYPECHECKS CLEAN (root, web, e2e).
  - `npx tsx scripts/measureChampJointLocks.ts`: exit 0, SKIPPED (0), VIOLATIONS: none, 9.4 s.
  - `npx tsx scripts/measureChampTenets.ts`: VIOLATIONS: none.
  - `npx tsx scripts/measureChampCutoff.ts --check-history`: no drift for both generated files.
- **Regression dump (scratch, not committed):** every single championship stop's combined locked set and every pool team's joint bound. It was byte identical to the pre task baseline after Tasks 2, 3, 4 and 5.

## The sweep by shape (Task 5, D6)

| Shape | Championships | Stops | Proof ran | Shipped | Joint only | Combined | Violations | Locked earlier |
|---|---|---|---|---|---|---|---|---|
| Single event | 31 | 248 | 217 | 340 | 414 | 754 | 0 | 167 |
| Divisioned | 16 | 156 | 140 | 1,539 | 810 | 2,349 | 0 | 298 |
| Two championships (2026 CA) | 1 | 8 | 7 | 41 | 62 | 103 | 0 | 21 |
| All | 48 | 412 | 364 | 1,920 | 1,286 | 3,206 | 0 | 486 |

Single subtotal line as printed: `31 championships / 248 stops / proof applied at 217 / shipped 340 / joint only 414 / combined 754 / violations 0`. Skipped: none, and no `unsupportedShape`.

At Now the proof does not run: divisioned stops read `stageNotEligible`, and CA reads `noBracketFacts` (the role championship gate refuses facts once the Awards are final, which is checked before the stage). The tables below read shipped + joint only = combined; a lone number means all three are equal.

### Divisioned, four divisions (FIM)

| Stop | 2023fim | 2024fim | 2025fim | 2026fim |
|---|---|---|---|---|
| Alliances final | 0 (S' 82) | 0 (S' 86) | 0 (S' 80) | 0 (S' 83) |
| Round 1 | 0 | 0 | 0 | 0 |
| Round 2 | 0 | 0 | 0 | 0 |
| Round 3 | 0+9=9 | 0+3=3 | 0+4=4 | 0+7=7 |
| Round 4 | 0+26=26 | 0+18=18 | 0+14=14 | 0+22=22 |
| Round 5 | 0+40=40 | 0+29=29 | 0+33=33 | 0+32=32 |
| Divisions final, finals not started | 32+20=52 | 26+33=59 | 27+24=51 | 25+25=50 |
| Finals after sf1 and sf2 | 34+18=52 | 28+32=60 | 27+26=53 | 29+29=58 |
| Finals after sf3 and sf4 | 34+20=54 | 28+32=60 | 27+27=54 | 29+29=58 |
| Finals after sf5 | 34+20=54 | 28+35=63 | 27+28=55 | 29+31=60 |
| Finals decided, awards open | 71 (S' 79) | 74 (S' 82) | 67 (S' 77) | 71 (S' 80) |
| Now | 71 | 74 | 70 | 73 |

### Divisioned, two divisions (NE, ON, TX)

| Stop | 2023ne | 2024ne | 2025ne | 2026ne | 2023ont | 2024ont | 2025ont | 2026ont | 2023fit | 2024fit | 2025fit | 2026fit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Alliances final to Round 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Round 2 | 0 | 0+1 | 0 | 0 | 0 | 0 | 0 | 0 | 0+1 | 0 | 0 | 0 |
| Round 3 | 0 | 0+4 | 0 | 0 | 0 | 0 | 0 | 0 | 0+2 | 0 | 0 | 0 |
| Round 4 | 0+4 | 0+6 | 0+5 | 0+3 | 0 | 0 | 0 | 0 | 0+2 | 0+3 | 0+5 | 0+4 |
| Round 5 | 0+7 | 0+9 | 0+9 | 0+7 | 0+4 | 0 | 0 | 0 | 0+5 | 0+7 | 0+7 | 0+7 |
| Divisions final, finals not started | 9+6 | 11+4 | 6+7 | 7+5 | 8+1 | 5 | 6 | 5 | 8+7 | 7+5 | 7+4 | 8+3 |
| Finals decided, awards open | 21 | 18 | 19 | 18 | 11 | 12 | 12 | 10 | 19 | 18 | 16 | 16 |
| Now | 22 | 22 | 22 | 21 | 15 | 15 | 15 | 14 | 21 | 21 | 19 | 20 |

S' per championship: NE 32, 31, 31, 32 (then 3 or 4 fewer once the winner posts); ON 23, 23, 22, 21; TX 30, 29, 28, 28.

### Two championships (2026 California, S' 46, 39 at Playoffs final)

| Alliances final | R1 | R2 | R3 | R4 | R5 | Playoffs final, awards open | Now |
|---|---|---|---|---|---|---|---|
| 0+6=6 | 0+6=6 | 0+6=6 | 0+9=9 | 0+11=11 | 0+15=15 | 10+9=19 | 31 |

### First lock gains, divisioned and two championship (319 eventual qualifiers)

Per championship:
- FIM: 2023 50, 2024 55, 2025 50, 2026 57
- NE: 2023 9, 2024 11, 2025 11, 2026 11
- ON: 2023 4
- TX: 2023 11, 2024 10, 2025 10, 2026 9
- CA 2026: 21

Most gains land at Rounds 3 to 5 and at "Divisions final, finals not started". For example, 2026fim's moved to: Round 3 7, Round 4 15, Round 5 10, Divisions final 15, after sf1/sf2 8, after sf5 2. 2026ca's moved to: Alliances final 6, Round 3 3, Round 4 2, Round 5 4, Playoffs final 6. The full list is printed by the sweep under FIRST LOCK MOVED EARLIER (486 across all shapes; the single 167 match 261009-2tr exactly).

## Pins as executed (never fitted)

Every pinned team is `locked` or `lockedAward` at Now. No team that missed qualification is in any set, and none of the plan's near misses is in a set. The pins are in `scripts/measureChampJointLocks.test.ts`, gated on the 2026 fim, ne and ca artifacts and the corpus.

| Stop | S' | Shape | Joint locked | Versus the planner prototype |
|---|---|---|---|---|
| FIM Divisions final, finals not started | 83 | divisioned | 50: frc10633, frc1189, frc1701, frc1918, frc2054, frc2075, frc2137, frc2337, frc2586, frc2611, frc27, frc2767, frc2851, frc2960, frc33, frc3414, frc3538, frc3539, frc3620, frc3641, frc3668, frc4237, frc4362, frc4391, frc469, frc4967, frc5066, frc5086, frc5114, frc5166, frc5193, frc5216, frc5460, frc548, frc5534, frc5660, frc5712, frc5907, frc6002, frc6090, frc67, frc68, frc7160, frc7166, frc7197, frc7220, frc7769, frc8280, frc8517, frc8608 | Prototype 60. Missing (bound): frc1023 85, frc1498 87, frc2619 83, frc3536 90, frc3656 90, frc4398 84, frc6121 87, frc6615 83, frc9245 84, frc9757 83. All 10 qualified. Nothing extra. |
| FIM Finals decided, awards open | 80 | divisioned | 63, identical to the prototype set (frc5460 and frc3538 lowest at 9) | equal |
| NE Divisions final, finals not started | 32 | divisioned | 12: frc125, frc176, frc1768, frc190, frc195, frc2877, frc3467, frc5000, frc5687, frc6328, frc6329, frc88 | Prototype 17. Missing (bound): frc133 34, frc1922 38, frc238 33, frc5813 38, frc7407 35. All qualified. |
| NE Finals decided, awards open | 28 | divisioned | 15, identical to the prototype set and bounds | equal |
| CA Round 5 | 46 | multiple | 15, identical to the prototype set and bounds (frc4414 31 to frc581 43) | equal |
| CA Playoffs final, awards open | 39 | multiple | 19, identical to the prototype set and bounds | equal |

The two "Divisions final" pins are below the prototype, measured by toggling one input at a time on the pinned input (diagnostic, not fitted):
- **FIM:** the finals seats open to any rival (deviation 1) cost 6 (56 without them, 50 with them).
- **NE, and the remaining 4 at FIM:** these come from the TAB's existing pre registration rule. A team with no championship row is not "out" until every dcmp key has started (`dcmpStartedForTeam`). Before the finals start, eight NE teams with no row therefore keep a whole hypothetical DCMP ceiling (249 in 2026). frc133's bound is 34 against 26 in the prototype. The prototype treated those teams as out. Follow up 15.

The FNC 2026 pins of 261009-2tr pass with no pinned value changed. A new D3 pin at FIM 2026 "Divisions final" asserts that each of the 16 teams with a finals row has floor at most pointTotal minus its finals row total, and that frc27 is exactly 445 minus 90 = 355.

## D9 and D10 as applied (orchestrator addenda)

- **D10 (seats from confirmed picks, every shape):**
  - `JointLockAlliance.spareSeats` is 4 minus the picks whose alliance selection points are posted and above 0 at that key. Every seat count reads it, and so do the single frames' fill ins (`singleChampionshipFrames`).
  - On the divisioned path, `finalsSpareByAlliance` holds the same count.
  - With confirmed membership on the single path this is byte identical to shipped: 0 of the single bounds changed.
  - Unit test: a listed fourth pick at 0 points, not coverable, and a coverable X. The bound is 0 under listed counting and counts X under confirmed counting.
- **D9 (a seat in the champion's division also pays the finals non champion maximum):**
  - `divisionedJointFrames` sets `enumeratedSeatBonus = F_nw` (30 at four divisions, 0 at two). It is added to the SEAT value of every enumerated alliance in W's division, including one left without a placement value, and never to member values.
  - W's own division seats (R5 a) pay 90 plus F_nw.
  - The E3 and S2 samplers let a division backup also join a losing finals roster and be paid F_nw.
  - Unit test: a seat at 21 plus 30 covers a rival 51 short, and 21 alone does not.
  - The module header states it beside step 3.

## The membership decision (checkpoint, orchestrator option 1)

Task 4 first applied R8 (an alliance's members are its listed picks) on every shape. The single gate moved: joint only 414 to 400, combined 754 to 740, and the FNC 2026 Round 5 pin lost frc3506 and frc4795 (bound 14 to 15, S' 15).

Toggling each change one at a time against the baseline (a sound bound may only rise, so "gained" locks mean a lower bound):
- R8 alone: 0 lost, **5 gained**. Listed pick membership was measured LESS conservative on the single path: a listed backup at 0 points, now a member, can no longer take another alliance's seat or the winner's fill in.
- R8 plus D10 seats: 4 gained.
- R8 plus D10 seats and fill ins: 17 lost, 3 gained.
- Confirmed membership plus D10: identical.

**Decision:** confirmed pick membership on the single path and on each California championship, with D10 seats and fill ins. R8 applies only on the divisioned path, with G1 to G3. The single gate and the FNC pins were confirmed byte identical before the Task 4 commit.

## Mutation checks (Task 3, all reverted; the file was verified identical afterwards)

| Mutation | Tests that failed |
|---|---|
| M1: drop F_nw from other division values (90, not 90 + 30) | round stop structure test; real future "another division's alliance is paid 90 plus the finalist's 30" |
| M2: drop the R5 extra seats (W's division seat and other divisions' finals seats) | structure test; real future "W's own division seat" |
| M3: reachable filter fed from placement values only | R11 test (a 120 seat); D9 test |
| M4: drop the D9 seat bonus | D9 test; structure test |
| M5: drop the finals seats open to any rival (deviation 1) | structure test, step 6 test, E3 stress (C=1, K=1), E3 stress (C=0, K=0), **S2 at Divisions final with 2026 values** |

M1 and M2 were not caught by E3 or S2, whose bounds have slack there. The two targeted real futures were added so that a soundness test, not only a structure test, fails for them.

Task 5 adds one more check on the sweep's own guard. With `buildDcmpRow` reverted to the shipped single source, the strengthened D3 assertion reports 1,308 `floorGap` violations and the sweep exits 1. Restored, it reports none.

## Deviations from Plan

1. **[Rule 1/2, soundness] Finals seats open to any rival (`JointLockFrame.anyRivalSeats`, header step 6).**
   - The same "two rosters" reading that D9 adopts lets a pick of an eliminated division alliance, confirmed or listed, be called as a backup on a losing finals alliance and be paid F_nw. The plan's frames could not lift a picked rival that way.
   - The fix adds `min(finals seats paying above 0, uncovered picked rivals on an unfixed alliance within that seat plus one judged award)` beside C and the fill ins. This double counts against the unpicked cover, which only raises the bound.
   - M5 shows the gap was real: S2 at FIM's Divisions final stop and E3 stress fail without it. It costs FIM 6 locks at that stop and is zero at two divisions (F_nw 0).
   - Commit afbdda36.
2. **[Rule 2] Two targeted real-future tests** for M1 and M2, and **two extra E3 variants** (finalist paid 30; C=0 and K=0), because E3 and S2 alone did not detect M1 and M2. Commit afbdda36.
3. **[Rule 3] Pre 2023 seasons in `measureChampTenets`.** `maxFinalsPointsByPlacement` throws outside 2023 to 2026, which crashed the tenets run on 2017. The status module's finals ceiling falls back to the full 3x Playoffs ceiling (the conservative side) for an unregistered season. Commit a03b5e32.
4. **[Rule 2] `ceilingByTeam` beside `floorByTeam`** on the status model, so the D3 ceiling test can read the ceiling. Commit a03b5e32.
5. **[Rule 2] The sweep's D3 assertion covers every dcmp row, not only the finals row.**
   - `tierEvents` sorts a team's rows by week, then by event NAME, so at FIM the finals row comes FIRST. The shipped single source fold therefore kept the DIVISION row's open points in the floor; it did not keep the finals row's, as RESEARCH section 5 assumed.
   - A finals only assertion did not catch the reverted fold. The strengthened one does (1,308 gaps). A settled division Playoffs value is the one category allowed back in the floor.
   - Commit d38455c4.
6. **[Plan text] `dcmpBracketFactsFor` with the finals role drops the Awards gate** as well as the Qualification gate. `jointProofAt` checks that the finals' Awards are open separately. Commit 070ff600.
7. **[Checkpoint] The membership decision above** (option 1). Commit 070ff600.
8. **[Process] Edits made through Python scripts in the scratchpad**, as in 261009-2tr, because Git Bash heredocs break on long prose here. One heredoc failed and was rerun as a script.
9. **[Not done, by constraint]** STATE.md, ROADMAP.md and the WINDOWS ledger were not updated, and no `.planning/` file was committed.

## Timing

- The full sweep over 412 stops takes 9.4 s, against 1.4 s for single only in 261009-2tr.
- The champJointLock test file takes about 48 s, mostly the E3 stress variants (about 10 s each).
- The cover upper bound is used where the exact program's table would exceed 250,000 cells (FIM's other division seats). No single event case reaches the cap.

## Readings applied (R1 to R14)

- **R1:** the finals source's ceilings are 0, 0, the finals champion maximum and 45. It is never settled from a bracket, and both open categories are modeled by the proof.
- **R2:** `champFinalsCeilingWithoutRow`, asserted zero on PNW, the two championship fixture and FNC 2026.
- **R3:** each award is gated on its own event's stage.
- **R4:** K = 14 times the division count.
- **R5 to R7:** `divisionedJointFrames`, with D9.
- **R8:** listed membership with G1 to G3, divisioned only (decision above).
- **R9:** a rival with no row is in every championship's input. The saturation test passes.
- **R10:** `coverUpperBound` with conditions (a) to (c) in the module header. `assertOneAwardPerRival` runs at load. The bound is never below the exact program on 20,000 instances.
- **R11:** the reachable filter takes the largest seat value over every frame.
- **R12:** `dcmpBracketFactsAtPosition` and the facts for every division and the finals key. The Live fetch set keeps a divisioned championship's started keys.
- **R13:** `unsupportedShape` replaces `notSingleChampionship`. A division whose Playoffs are final with no routed winner refuses.
- **R14:** `routeFinals` counts every played decision. The 2024necmp replay routes to alliance 2.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or schema change. The sweep and the pins open `data/corpus.sqlite` read only, with no network.

## Follow ups

Written and not committed: `.planning/todos/pending/champ-joint-lock-follow-ups.md`.
- **Closed:** items 1 (divisions) and 2 (California).
- **Added:**
  - 9: K over divisions with open Awards only (R4).
  - 10: the proof waits at Live for a finals row (R13).
  - 11: finals facts at Live depend on the run request (R12).
  - 12: the DCMP row's cells read the first row, which is the FINALS row at FIM.
  - 13: a distinct division and finals backup has never been observed (R5).
  - 14: R9's over count in the sum.
  - 15: a team with no row keeps a hypothetical DCMP until every dcmp key starts. This cost NE 5 and FIM 4 locks at Divisions final.
  - 16: the finals seats open to any rival, and D9, rest on the unverified "two rosters" reading. They cost FIM 6.
  - 17: R8 was rejected on the single path.

## Self-Check: PASSED

- FOUND: packages/core/districts/finalsBracket.ts, finalsBracket.test.ts, and every modified file listed above.
- FOUND commits: 14e87f66, a03b5e32, afbdda36, 070ff600, d38455c4.
- Sweep: exit 0, SKIPPED (0), VIOLATIONS: none. Single subtotal 31 / 248 / 217 / 340 / 414 / 754 / 0. FNC, FIM, NE and CA pins pass.
