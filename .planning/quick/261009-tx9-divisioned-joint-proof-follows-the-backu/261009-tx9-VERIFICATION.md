---
phase: quick-261009-tx9
verified: 2026-10-10
status: passed
score: 10/10 checks verified
behavior_unverified: 0
gaps: []
---

# Quick 261009-tx9 Verification Report

**Goal:** the DIVISIONED Champ Locks joint proof follows the backup robot rule (one backup per alliance for the whole championship; a backup is an unselected team of the alliance's OWN division; a team already on an alliance is never a backup; a winning alliance has at most 4 members). Removed: reading R5's extra seats, finals seats open to any rival (guard G3), the D9 seat bonus. Single and California shapes byte identical.
**Commits:** 997061b5, 61444f38 on main. Nothing edited, committed or pushed by the verifier (the scratch files live in the session scratchpad under `ver/`).
**Verdict:** status passed. No under count found. Every rule legal future in an independently written exhaustive oracle stays at or below `jointLockBound`.

## 1. Independent exhaustive oracle (`scratchpad/ver/oracle.mts`, `oracle2.mts`, `oracle3.mts`)

Written without reading the repo's tests. It imports only `divisionedJointFrames` and `jointLockBound`, builds the `JointLockInput` the way `divisionedJointProof` does (members are the confirmed picks of a placed alliance and every listed pick of an unplaced one, `spareSeats` is 4 minus the confirmed picks, one seat group per division holding the division's rowed teams that no alliance confirmed plus the listed unconfirmed picks), and enumerates the futures itself:

- two divisions, 3 to 5 alliances each (three confirmed picks each, some not in the pool), 20 to 24 teams, 14 to 22 pool teams, several unpicked teams per division, one slot only rival with a division row, one pool rival with no division row, one slot only rival with no row, and one alliance per division listing an unconfirmed fourth team (0 alliance points) that either STAYS as that alliance's one backup or was never on it (then it is a free unpicked team of its division);
- every division ranking of the alive alliances (values 90, 75, 39, 21, 0), every finals outcome (finals pay 60/30 or 30/0), for every relevant alliance (alive, decided winner alive in the finals, or the champion) either no backup or exactly one backup drawn from its own division's free rowed unselected teams (injective), every consuming and judged award assignment in closed form (cross checked by brute force on a sample, 0 mismatches over 83,923 checks);
- for every pool team T, the real takers (rivals at or above T's floor plus the champion roster including its backup, plus awards, each counted once, T excluded, futures where T is on the champion roster skipped) compared with `jointLockBound` on the status shaped input.

Stops covered: alliances final (A), partial division with one placed alliance (P), one division decided and the other open (B), both decided with finals not started (C), finals decided (D), a late stop with 2 alive per division (G), and a five alliance division with the other decided (E), with several floor seeds, finals pay variants and C/K budgets.

| Run | Futures | Team checks | Futures where takers exceed the bound | Bound equals the worst legal future |
|---|---|---|---|---|
| Legal, stops A P B C D, 30 seeds | 32,859,060 | 652,157,834 | 0 | 1,942 of 3,266 team/seed pairs |
| Legal, stops B C D G, 150 seeds | 2,274,822 | 45,098,329 | 0 | 8,273 of 13,096 |
| Legal, stop E (five alliances, 0 value places), 10 seeds | 10,332,000 | 207,202,032 | 0 | 78 of 224 |
| Legal total | 45,465,882 | 904,458,195 | **0** | tight in about 60% of team/seed pairs (42.7M tight future/team pairs in the first run alone) |
| Hill climb over floors (adversarial search, accept ties), stops A P B C D G E, lean worlds, each world fully enumerated | 140,000+ worlds | not tallied | 0 (best slack found = 0, i.e. a legal future reaches the bound exactly and never passes it) | |

Because the bound equals the worst legal future in most cases, the oracle is strong (it is not hiding behind slack). The decided stops C and D are tight for about 90% of the teams.

## 2. Non vacuity: deliberately illegal futures DO exceed the bound

| Illegal rule | Stops | Futures enumerated | (future, team) pairs with takers above the bound | First example |
|---|---|---|---|---|
| A second backup per alliance | C D G B, 12 seeds | 1,360,782 | 104,143 | C#1: 11 takes L1 and u1a, T=m22a bound 6, takers 7 |
| A backup from the OTHER division | C D G B, 12 seeds | 1,347,177 | 25,299 | C#2: 22 takes u1b (division 1), T=m22a bound 19, takers 20 |
| A confirmed pick of an eliminated alliance as a finals backup | A P B C D, 12 seeds | 13,376,904 | 1,309 (all at the decided stops B and C) | C#2: 22 takes m11a, T=m22c bound 21, takers 22 |

Each of the three breaches is caught, so the oracle is not vacuous and the three rule terms are load bearing. The removed terms (R5 seats, G3 finals seats open to any rival, D9) are exactly what these illegal futures would have needed.

## 3. Gates run from the repo root

| Gate | Result |
|---|---|
| `npx vitest run packages/core/districts apps/web/src/components/districts scripts` | 92 files passed, 2,580 tests passed, 0 failed, 0 skipped |
| `npx tsc --noEmit -p .`, `-p apps/web/tsconfig.json`, `-p apps/web/tsconfig.e2e.json` | all three exit 0 |
| `npx tsx scripts/measureChampJointLocks.ts` | `SKIPPED (0)`, `VIOLATIONS: none`, no floor gap line; `SINGLE SUBTOTAL 31 championships / 248 stops / proof applied at 217 / shipped 340 / joint only 414 / combined 754 / violations 0` (exact); divisioned 16 / 156 / 140 / 1582 / 1283 / 2865 / 0; two championships 1 / 8 / 7 / 41 / 62 / 103 / 0 |
| `npx tsx scripts/measureChampTenets.ts` | `VIOLATIONS: none` |
| `orch_takeback.mts` | `championships 48, stops 412, take-backs 0` |
| Single and California dumps re run and `cmp`d against the pre task baselines | byte identical (248 and 8 lines) |
| `git diff --stat 8fb29c8a..HEAD` | exactly the five source files; `git status` shows only the `.planning/` todo (shared with 261009-tx6) modified and untracked planning directories |

## 4. `divisionedJointProof` against the corpus (`scratchpad/ver/audit.mts`, all 156 divisioned stops, 140 where the proof ran, 16 championships of 2023 to 2026)

| Check | Count |
|---|---|
| A confirmed pick (alliance selection points above 0 at the key) listed as eligible in its own division's group | 0 |
| A real unpicked pool or slot only team with a row at a division key that is missing from its own group | 0 (6,872 team/stop observations) |
| ... that sits in another division's group instead | 0 |
| A pick at position 1 to 3 of an alliance with 0 alliance points (a real member read as unpicked) | 0 |
| A pick at position 4 with alliance points above 0 (a real backup read as confirmed) | 0 |
| Listed fourth picks with 0 alliance points (the P3 case) | 22 |
| Alliances listing more than four teams | 0 |

Failure directions, from reading `divisionedJointProof`, `jointLockBoundAt` and `computeChampLedgerStatuses`:

- **A real member read as unpicked** (alliance selection points not posted, or 0): it becomes an unconfirmed listed pick. On an unplaced alliance it stays a member AND becomes eligible in the group, and the alliance's spare seats grow by one. On a placed alliance it is a free rival in the group (G2). Both only add takers: conservative. The corpus has zero such cases at positions 1 to 3.
- **A real unpicked team left out of every group** is impossible for a rowed team (the group is every rowed team minus confirmed picks, plus the listed unconfirmed). A pool team with NO division row (a membership "out" team, which `dcmpSettledByEvent` never enters, a team that never attended, or a missing row) is named by no group and is not on an alliance, so `groupsOf` returns every group (P4): it is offered every division's seats and every fill in. Conservative, and the audit found zero real unpicked teams that were not in their own group.
- **A real unpicked team read as confirmed** would be the one non conservative direction (it would be excluded from every group). It requires alliance points above 0 on a backup position pick; the audit found 0 of 3,000+ alliance positions, and the 22 listed fourths all carry 0.
- **Rewound stops** read the final artifact for alliance points and facts, and the proof only runs once Qualification and Alliance selection are final, so the confirmed set is identical at every stop. **Live** reads the same fields; if alliance points lag the pick list every pick reads unconfirmed, which widens seats and eligibility (conservative).
- A confirmed pick that also has a row in the OTHER division becomes eligible there (over cover) and keeps `namedGroups.has(T)` true, so a frame whose winner lists it is not skipped (over cover).
- Header versus code, line by line for the divisioned frames: W's seats are fill ins only (`fillIns = spare(W)`, pool restricted to `seatRivals[winnerGroup]` minus W's members); other divisions' alive alliances are fixed at `divisionChampionMax + finalsNonChampionMax` and offer `spareOf` seats once; a decided winner of another division is fixed at F_nw, its finals placement value, or 0 once the finals are final; P3 skips a frame only when no group names T; P4 is `allianceOfTeam.has(key) ? noGroup : everyGroup`; the judged budget is shared across groups by `bestSplit`. All match the header. No remaining mention of R5, D9 or G3 other than as removed.

## Limits of the evidence (not gaps)

- The oracle models two divisions. The four division FIM finals and eight alliance brackets are covered by the corpus sweep (0 violations, 0 take backs, 0 lost locks per the executor's set compare) and by the repo's own soundness tests, not by my oracle.
- Alliances with a spare count above one (fewer than three confirmed picks) are not enumerated with two backups (the rule allows one); the bound there simply credits more fill ins, which is conservative.
- The five alliance run uses places 5 and below at 0 points; real brackets also pay 0 there.

## Result

All four requested checks pass. No gaps. status: passed.
