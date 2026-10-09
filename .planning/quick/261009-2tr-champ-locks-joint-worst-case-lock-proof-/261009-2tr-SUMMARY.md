---
phase: quick-261009-2tr
plan: 01
subsystem: districts / Champ Locks
status: complete
tags: [champ-locks, lock-proof, soundness, dcmp, bracket, awards]
requirements_completed: [261009-2tr]
dependency_graph:
  requires: [261006-3gg reservation, 261008-26o settled playoffs, 260925-pl6 pooled OR pattern]
  provides: [champJointLock.ts joint worst case proof, maxPlayoffPointsByPlacement, SettledPlayoffs.ceiling, dcmpJudgedAwardCeiling, measure:champ-joint-locks]
  affects: [Champ Locks tab Locked verdict, both Locks tabs' settled Playoffs ceiling (D7)]
tech-stack:
  added: []
  patterns: [OR-ed lock proof with named lockedBy, exact resource maximum by dynamic program, corpus gated tenet sweep]
key-files:
  created:
    - packages/core/districts/champJointLock.ts
    - packages/core/districts/champJointLock.test.ts
    - scripts/measureChampJointLocks.ts
    - scripts/measureChampJointLocks.test.ts
  modified:
    - packages/core/districts/bracket.ts
    - packages/core/districts/bracket.test.ts
    - packages/core/districts/locks.ts
    - packages/core/districts/locks.test.ts
    - packages/core/districts/hypotheticalDcmp.ts
    - packages/core/districts/hypotheticalDcmp.test.ts
    - packages/core/districts/dcmpHistory.generated.ts
    - scripts/measureChampCutoff.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/districts/champLedgerStatus.ts
    - apps/web/src/components/districts/champLedgerStatus.test.ts
    - apps/web/src/components/districts/useDistrictLedgerData.ts
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
    - package.json
decisions:
  - "Planner reading 1: steps 3b to 6 are the exact maximum of the resource allocation (dynamic program), never D2's literal greedy order, which undercounts in R1, R2, R3."
  - "Planner reading 2: a backup seat that does not reach the floor still pays its points, so the holder's judged need falls."
  - "Planner reading 3: a prequalified team not yet award qualified is a slot only rival (winner, consuming award, fill in), never a points rival."
  - "Planner reading 4: unpicked means every pool or slot only rival on no alliance by the membership rule (alliance selection points above 0)."
  - "Planner reading 5: extra is the shipped open ceiling minus exactly the open DCMP Awards ceiling and an unsettled open DCMP Playoffs ceiling."
  - "Planner reading 6: an alliance is alive for the proof when unplaced by the routing or when any listed pick in the field has no settled Playoffs value (implemented over listed picks, the more conservative reading)."
  - "Planner reading 7: single championship means exactly one dcmp tier key; 2026 California and the divisioned FIM, NE, ON and TX keep the shipped path."
  - "Planner reading 8: with Playoffs final the proof runs only once the winner award is posted, or the routed final names the winner."
  - "Planner reading 9: placement assignments are every ordered assignment of the top min(3, others) maxima (75, 39, 21) to distinct alive alliances other than W; the monotonicity argument is in the module header."
  - "Planner reading 10: K = 14 (all time maximum 13 plus a margin of 1)."
  - "Planner reading 11: MAX_POINT_PAYING_AWARDS_PER_TEAM = 1, a module constant."
  - "Planner reading 12 with CONTEXT D7: a decided placement that is not exact enters every lock ceiling at its maximum through SettledPlayoffs.ceiling; the only top up is a settled team with no routed placement."
metrics:
  duration: "about 40 minutes (13:40 to 14:20 local)"
  completed: 2026-10-09
estimate:
  tokens: 136000
  tasks: 4
actuals:
  tokens: 52561
  tasks: 4
  commits: 4
---

# Phase quick-261009-2tr Plan 01: Champ Locks joint worst case lock proof Summary

A second, OR-ed proof of `Locked` at a single event District Championship that bounds the rivals able to take a Championship slot from a team jointly over the bracket, the backup robots and the award budget (one point paying award per rival, placement maxima 90 / 75 / 39 / 21, K = 14), plus the D7 fix that puts a decided placement's maximum, not its printed table value, into every lock ceiling on both Locks tabs. The corpus sweep over all 31 single event championships of 2023 to 2026 found zero violations, and 167 eventual qualifiers now lock at an earlier stop.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | 2a7999d1 | feat(261009-2tr): joint worst case lock proof in core, OR-ed into the lock verdict |
| 2 | cc09dbee | feat(261009-2tr): measured judged award ceiling for the joint lock proof |
| 3 | e266557c | feat(261009-2tr): the Champ Locks tab ORs the joint lock proof into its statuses, and a settled placement's ceiling is its maximum |
| 4 | 5aa7b489 | feat(261009-2tr): corpus sweep gates the joint lock proof, and the methodology names it |

Each commit staged its files by explicit path. `git diff --name-only dabb2c81..HEAD` lists exactly the 21 non planning files of the plan; none of `districtLedgerStatus.ts`, `reservedSlots.ts`, `pooledLockInputs.ts`, `publishDistricts.ts`, `apps/worker/`, `packages/harness/` or `packages/core/algorithms/` is touched. `git diff HEAD~1 -- bracket.ts` at Task 1 added 35 lines and deleted none (`playoffPoints` untouched).

## Verification (printed output, not exit codes)

- Task 1: `champJointLock.test.ts`, `bracket.test.ts`, `locks.test.ts`: 16 + 103 tests passed. E1 (128 completions x 43 backup placements x every consuming and judged recipient, every pool team), E2, and S1 (4 cases x 20,000 futures) found no future above the bound. Mutation checks: shaving 1 off the lift term, dropping the seats, or dropping the fill ins each made E1 and E2 fail.
- Task 2: `hypotheticalDcmp.test.ts` + `champReservedSlots.test.ts`: 42 passed. `--check-history` printed no drift for both generated files before and after regeneration; the stripped diff (old file vs new file with every `, judgedAwards: N` and the `// Generated:` line removed) was empty.
- Task 3: the seven listed suites: 351 passed, `districtLedgerStatus.test.ts` among them and unedited. Mutation check: reading `settled.points` instead of `settled.ceiling` in `settledElimBounds` failed all three D7 pins.
- Task 4: `measureChampJointLocks.test.ts` (ran, not skipped) + `districtLedgerContent.test.ts`: 22 passed. `npx tsx scripts/measureChampJointLocks.ts`: 31 championships swept, VIOLATIONS: none. `npx tsx scripts/measureChampTenets.ts`: VIOLATIONS: none (Locked on points 7,234 shown, 0 violations; Locked out 271,382, 0 violations). `grep -c "One qualification slot is held back"` prints 1.
- Full root `npx vitest run`: 346 test files passed, 8,080 tests passed, 1 skipped (a pre existing skip, not this task's).
- Typechecks `npx tsc --noEmit -p .`, `-p apps/web/tsconfig.json`, `-p apps/web/tsconfig.e2e.json`: clean after every task.
- Task 1 timing (scratch, not a test): `jointLockedTeams` on a 90 team, 8 alive synthetic input takes 2.1 ms with members at 15 slots and 10.3 ms with no members; forcing full enumeration (40 slots) takes 70 ms with members and 90 ms without; exact bounds for all 90 teams with no members (the live worst case) take 288 ms.

## The corpus sweep (Task 4, D4)

Columns: S' is `pointsSlots`; joint is `applied` or the refusal reason; shipped is Locked on points under today's rule (with the bracket milestones); joint only is `lockedBy` exactly `joint`; combined is Locked on points with the proof OR-ed in; viol is tenet A violations plus any shipped lock the combined run lost.

Totals: 31 championships, 248 stops, the proof ran at 217 (every stop but Now, where the awards are final). Locked on points: shipped 340, joint only 414, combined 754. Violations: 0. 167 eventual qualifiers locked at an earlier stop (28 now at Alliances final, 7 at Round 2, 23 at Round 3, 14 at Round 4, 45 at Round 5, 50 at Playoffs final with awards open). Time 1.4 s.

| Championship | Alliances final | R1 | R2 | R3 | R4 | R5 | Playoffs final | Now |
|---|---|---|---|---|---|---|---|---|
| 2023chs S' 19/19/19/19/19/19/16/11 | 0+2=2 | 0+2=2 | 0+2=2 | 0+6=6 | 0+7=7 | 0+8=8 | 5+2=7 | 11 |
| 2023fin S' 10..10/7/4 | 0 | 0 | 0 | 0 | 0 | 0 | 1+1=2 | 4 |
| 2023fma S' 23..23/20/15 | 0+3=3 | 0+3=3 | 0+3=3 | 0+5=5 | 0+6=6 | 0+9=9 | 6+6=12 | 15 |
| 2023fnc S' 14..14/11/6 | 0 | 0 | 0 | 0 | 0+1=1 | 0+5=5 | 3+2=5 | 6 |
| 2023isr S' 11..11/8/6 | 0 | 0 | 0 | 0 | 0 | 0+1=1 | 0+2=2 | 6 |
| 2023pch S' 17..17/14/8 | 0 | 0 | 0+1=1 | 0+1=1 | 0+2=2 | 0+5=5 | 5+2=7 | 8 |
| 2023pnw S' 22..22/18/13 | 0+3=3 | 0+3=3 | 0+3=3 | 0+4=4 | 0+5=5 | 0+7=7 | 2+7=9 | 12 |
| 2024chs S' 17..17/14/11 | 0 | 0 | 0 | 0+1=1 | 0+2=2 | 0+3=3 | 3+3=6 | 11 |
| 2024fin S' 11..11/8/5 | 0 | 0 | 0 | 0 | 0 | 0+1=1 | 0+2=2 | 5 |
| 2024fma S' 22..22/19/14 | 0+4=4 | 0+4=4 | 0+4=4 | 0+6=6 | 0+6=6 | 0+11=11 | 7+6=13 | 14 |
| 2024fnc S' 13..13/9/5 | 0+1=1 | 0+1=1 | 0+1=1 | 0+1=1 | 0+1=1 | 0+1=1 | 0+1=1 | 5 |
| 2024isr S' 11..11/8/6 | 0 | 0 | 0 | 0 | 0 | 0+2=2 | 2+2=4 | 6 |
| 2024pch S' 16..16/13/8 | 0 | 0 | 0 | 0+2=2 | 0+2=2 | 0+3=3 | 2+3=5 | 8 |
| 2024pnw S' 22..22/19/14 | 0+4=4 | 0+4=4 | 0+4=4 | 0+4=4 | 0+5=5 | 0+6=6 | 5+5=10 | 14 |
| 2025chs S' 17..17/14/10 | 0+1=1 | 0+1=1 | 0+1=1 | 0+2=2 | 0+2=2 | 0+6=6 | 2+5=7 | 10 |
| 2025fin S' 12..12/8/5 | 0 | 0 | 0 | 0 | 0 | 0 | 0+2=2 | 5 |
| 2025fma S' 23..23/20/15 | 0+2=2 | 0+2=2 | 0+6=6 | 0+9=9 | 0+10=10 | 0+10=10 | 6+3=9 | 15 |
| 2025fnc S' 14..14/11/6 | 0 | 0 | 0 | 0 | 0+1=1 | 0+1=1 | 0+1=1 | 6 |
| 2025fsc S' 5..5/2/0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2025isr S' 10..10/7/5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| 2025pch S' 12..12/9/5 | 0 | 0 | 0 | 0 | 0 | 0 | 1+2=3 | 5 |
| 2025pnw S' 22..22/19/14 | 0+4=4 | 0+4=4 | 0+4=4 | 0+7=7 | 2+5=7 | 2+8=10 | 6+4=10 | 14 |
| 2026fch S' 19..19/16/12 | 0 | 0 | 0+2=2 | 0+3=3 | 0+4=4 | 0+6=6 | 3+6=9 | 12 |
| 2026fin S' 12..12/9/6 | 0 | 0 | 0 | 0 | 0 | 0 | 1+1=2 | 6 |
| 2026fma S' 23..23/20/16 | 0+2=2 | 0+2=2 | 0+2=2 | 0+4=4 | 0+4=4 | 1+5=6 | 5+6=11 | 16 |
| 2026fnc S' 15..15/11/7 | 0 | 0 | 0 | 0 | 0+2=2 | 0+5=5 | 2+2=4 | 7 |
| 2026fsc S' 7..7/4/1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| 2026isr S' 12..12/9/6 | 0 | 0 | 0 | 0 | 0 | 0+3=3 | 2+1=3 | 5 |
| 2026pch S' 13..13/10/5 | 0 | 0 | 0 | 0 | 0 | 0+1=1 | 3+1=4 | 5 |
| 2026pnw S' 21..21/18/13 | 0+2=2 | 0+2=2 | 0+2=2 | 0+3=3 | 0+5=5 | 1+6=7 | 6+3=9 | 12 |
| 2026win S' 12..12/9/6 | 0 | 0 | 0 | 0 | 0 | 0 | 1+1=2 | 6 |

Each cell reads shipped + joint only = combined (a lone number means all three agree; at Now the proof never runs and the number is the shipped count). Every one of the 248 stops reported 0 violations.

Skipped (17): divisions 2023 to 2026 fim, fit, ne, ont (16 entries); two championships 2026ca (2026cancmp, 2026cascmp).

### First lock moved earlier (167 qualifiers), as before -> after

- 2023chs: frc2363 (Playoffs final -> Alliances final); frc1731, frc8592, frc401, frc5804 (Playoffs final -> Round 3); frc1727 (Playoffs final -> Alliances final); frc836 (Playoffs final -> Round 5); frc4099 (Now -> Round 4); frc384 (Now -> Playoffs final)
- 2023fin: frc7457 (Now -> Playoffs final)
- 2023fma: frc5895, frc3314, frc2539 (Playoffs final -> Alliances final); frc1923, frc341 (Playoffs final -> Round 3); frc1403, frc11 (Playoffs final -> Round 5); frc1391 (Playoffs final -> Round 4); frc1676 (Now -> Round 5); frc316, frc1807, frc25, frc484, frc103 (Now -> Playoffs final)
- 2023fnc: frc4795 (Playoffs final -> Round 4); frc7890, frc4561 (Playoffs final -> Round 5); frc5727, frc2642 (Now -> Round 5)
- 2023isr: frc5990 (Now -> Playoffs final); frc2630 (Now -> Round 5)
- 2023pch: frc6919 (Playoffs final -> Round 4); frc2974 (Playoffs final -> Round 2); frc1683 (Playoffs final -> Round 5); frc1771, frc4451 (Now -> Round 5)
- 2023pnw: frc2910, frc3663 (Playoffs final -> Alliances final); frc2521 (Now -> Alliances final); frc2930 (Now -> Round 3); frc3218 (Now -> Round 4); frc955, frc3636 (Now -> Round 5); frc4682, frc1540 (Now -> Playoffs final)
- 2024chs: frc1731 (Playoffs final -> Round 3); frc449 (Playoffs final -> Round 5); frc1727 (Now -> Round 4); frc4099, frc2363 (Now -> Playoffs final)
- 2024fin: frc461 (Now -> Round 5); frc4272 (Now -> Playoffs final)
- 2024fma: frc5895, frc316, frc2539, frc341 (Playoffs final -> Alliances final); frc1923, frc103 (Playoffs final -> Round 3); frc1640, frc1403, frc3314 (Playoffs final -> Round 5); frc2590, frc3637 (Now -> Round 5); frc1391, frc4342, frc1807, frc1168 (Now -> Playoffs final)
- 2024fnc: frc9496 (Playoffs final -> Alliances final); frc2642 (Now -> Playoffs final)
- 2024isr: frc1690, frc2231 (Playoffs final -> Round 5); frc1574, frc1577 (Now -> Playoffs final)
- 2024pch: frc1771, frc2974 (Playoffs final -> Round 3); frc1261 (Playoffs final -> Round 5); frc1414, frc343, frc1683 (Now -> Playoffs final)
- 2024pnw: frc2521, frc2811, frc2046, frc2910 (Playoffs final -> Alliances final); frc1778 (Playoffs final -> Round 4); frc3663 (Now -> Round 5); frc9023, frc2522, frc4043, frc360 (Now -> Playoffs final)
- 2025chs: frc422 (Playoffs final -> Alliances final); frc449 (Playoffs final -> Round 3); frc8592 (Playoffs final -> Round 5); frc1727, frc888, frc2106 (Now -> Round 5); frc9072, frc1731 (Now -> Playoffs final)
- 2025fin: frc4272, frc3940 (Now -> Playoffs final)
- 2025fma: frc341, frc5895 (Playoffs final -> Alliances final); frc2607, frc365, frc2539, frc8513 (Playoffs final -> Round 2); frc3314, frc103 (Playoffs final -> Round 3); frc1923 (Now -> Round 3); frc1807 (Now -> Round 4); frc3142 (Now -> Playoffs final)
- 2025fnc: frc9496 (Playoffs final -> Round 4); frc4534 (Now -> Playoffs final)
- 2025pch: frc1261, frc6919 (Now -> Playoffs final)
- 2025pnw: frc2910, frc1778 (Playoffs final -> Alliances final); frc3663, frc2046 (Round 4 -> Alliances final); frc2930, frc9450 (Playoffs final -> Round 3); frc9442, frc1540 (Playoffs final -> Round 5); frc5468 (Now -> Round 3); frc1318 (Now -> Round 5); frc957, frc3674 (Now -> Playoffs final)
- 2026fch: frc836, frc9072 (Playoffs final -> Round 2); frc1908 (Playoffs final -> Round 4); frc2106 (Now -> Round 3); frc619, frc346 (Now -> Round 5); frc422, frc401, frc5338 (Now -> Playoffs final)
- 2026fin: frc1024 (Now -> Playoffs final)
- 2026fma: frc316 (Playoffs final -> Alliances final); frc341 (Round 5 -> Alliances final); frc8513, frc1403 (Playoffs final -> Round 3); frc1676 (Playoffs final -> Round 5); frc5895 (Now -> Round 5); frc484, frc272, frc103, frc11, frc1391 (Now -> Playoffs final)
- 2026fnc: frc9496, frc9032 (Playoffs final -> Round 4); frc4795 (Playoffs final -> Round 5); frc2724, frc3506 (Now -> Round 5)
- 2026isr: frc1690, frc2231, frc3075 (Playoffs final -> Round 5); frc4744 (Now -> Playoffs final)
- 2026pch: frc4188 (Playoffs final -> Round 5); frc2974 (Now -> Playoffs final)
- 2026pnw: frc2046 (Playoffs final -> Alliances final); frc5468 (Round 5 -> Alliances final); frc1540 (Playoffs final -> Round 3); frc955, frc4915 (Playoffs final or Now -> Round 4); frc360, frc9023 (Playoffs final or Now -> Round 5); frc6696 (Now -> Playoffs final)
- 2026win: frc2194 (Now -> Playoffs final)

("Playoffs final" is the "Playoffs final, awards open" stop.)

## FNC 2026 pins (D5), passing in `scripts/measureChampJointLocks.test.ts`

Inputs confirmed: C 6, K 14, one award per team, placement values 75, 39, 21, alive alliances 1 and 2 at Round 5.

| Stop | S' | Joint locked (bound) | Not joint locked (bound) |
|---|---|---|---|
| Round 5 | 15 | frc2724 12, frc9496 12, frc9032 12, frc4795 14, frc3506 14 | frc4561 16, frc8429 17, frc1533 18, frc7890 18, frc6500 18 |
| Playoffs final, awards open | 11 | frc9496 7, frc9032 7, frc2724 8, frc3506 10 (each lockedBy ends in joint) | frc8429 13, frc1533 13, frc7890 13, frc6500 13 |

At every FNC stop every joint locked team is `locked` or `lockedAward` at Now, and frc6500 (eliminated at Now) is never joint locked. Every value equals the planner's independent reproduction; no pin was adjusted.

## Deviations from Plan

### Auto-fixed and process deviations

**1. [Process] RED before GREEN not strictly observed in Task 1 for two files.** `bracket.ts`'s maxima and `locks.ts`'s joint argument were written before their new tests were run; `champJointLock.ts` and its tests were written together. Mitigation: the three mutation checks above show the soundness tests fail against a weakened bound, which is what a RED run would have shown. Committed as one `feat` commit per task, as the plan's commit subjects specify.

**2. [Rule 2, conservative reading] Planner reading 6 implemented over LISTED picks, not only members.** An alliance is alive for the proof when any listed pick that has a DCMP source lacks a settled value. A listed backup (alliance selection points 0) with no settled value on a decided alliance could otherwise have its playoff points from that alliance missed, since the proof treats it as unpicked. The alive set can only grow, so this is the safe side. The plan's alive for the proof test (one member's milestone omitted) passes either way.

**3. [Measurement] 2019 judged award maximum appears at 11 history entries, not 8.** The plan named eight single event championships at 13. Because `judgedAwards` is the per event maximum over a district's dcmp tier keys, the divisioned 2019 fim, ont and tx entries also read 13 (one of their dcmp tier events gave 13). K is unchanged at 14. The `JUDGED_AWARD_CEILING_MARGIN` comment states the full measurement.

**4. [Test scope] An extra routed Round 5 case on the PNW fixture.** The plan's FNC like stop on the PNW fixture (no played rows, so every alliance alive by routing, with decided milestones) records an EMPTY joint set: a decided alliance's members carry their settled maximum in `extra` and also take an assigned placement, a conservative double count. That pin is kept as recorded. A second case routes played rows that reproduce the fixture's real placements (alliances 1 and 5 alive) and pins the joint set {frc1540, frc2046, frc360, frc5468, frc9023, frc955}, every one qualified. Recorded counts at the PNW Playoffs final stop: joint only 3, ceiling+joint 6.

**5. [Test shape] The D7 status test has the Awards open, so R's ceiling includes the 45 award ceiling.** "R's floor plus 60 one point short of T's floor" is implemented as R's whole ceiling at the printed 60 (floor + 45 + 60) one point short; at 75 R is a threat and T is not ceiling locked; the control 15 points lower locks T by `ceiling`. `ChampLedgerStatusResult` has no `threatCount`, so the test reads `verdict` and `lockedBy`.

**6. [Tooling] Edits made through Python scripts in the scratchpad.** Git Bash heredocs broke on prose with apostrophes on this machine (the known issue), so multi line edits were written to scratch `.py` files with the Write tool and run. One `sed -i` converted `districtLedgerRows.ts` from CRLF to LF in the working copy; git stores LF either way and the committed diff is content only.

**7. [Not done, by the orchestrator's constraint] STATE.md, ROADMAP.md and the WINDOWS ledger were not updated** and no `.planning/` file is committed. The orchestrator owns those for quick tasks.

### Deferred Issues

None. Out of scope findings are in the follow ups todo below.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema at a trust boundary. The sweep opens `data/corpus.sqlite` read only and touches no network.

## Follow ups

Written, not committed: `.planning/todos/pending/champ-joint-lock-follow-ups.md` (divisions; 2026 California's two championships; the publisher's and Worker's `champLock`; the settled cell's printed 60 for a losing finalist, todo 5a of 261008-26o; the simulation's 20 for second place; live membership before TBA posts DCMP alliance points; a tied sf row's replay; a backup robot TBA never lists).

## Self-Check: PASSED

- FOUND: packages/core/districts/champJointLock.ts, champJointLock.test.ts, scripts/measureChampJointLocks.ts, scripts/measureChampJointLocks.test.ts, .planning/todos/pending/champ-joint-lock-follow-ups.md
- FOUND commits: 2a7999d1, cc09dbee, e266557c, 5aa7b489
