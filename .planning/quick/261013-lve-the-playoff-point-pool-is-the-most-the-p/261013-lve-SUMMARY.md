---
phase: quick-261013-lve
plan: 01
subsystem: district-locks
tags: [district-locks, lock-math, point-pool, playoff-pay-rule, worker-bundle]
status: complete
requirements_completed: [261013-lve]
requires:
  - quick task 261012-mw2 (TBA's playoff pay rule, `securedPlayoffPoints.ts`)
  - quick task 261009-tx9 (the four robot roster rule the Champ Locks joint proof rests on)
provides:
  - "`mostPlayoffPointsPaid`, `mostSharedByWins`, `MOST_PLAYOFF_POINTS_PAID_BY_RULE`, `MOST_ROBOTS_PAID_PER_ALLIANCE`, `ROBOTS_CREDITED_PER_WIN` in `packages/core/districts/pointPool.ts`"
  - "`PLAYOFF_POOL` = 216, the largest of the bounds by rule, for every season"
affects:
  - District Locks tab (pooled remaining points lock, rewound stops only)
  - the Worker's and the publisher's `pooledDistrictPoints` (published `districtLock` while a district event's Playoffs are open)
tech-stack:
  added: []
  patterns:
    - a bound derived from the rule's own tables, held by a search that shares no code with the derivation and by a corpus gate
key-files:
  created: []
  modified:
    - packages/core/districts/pointPool.ts
    - packages/core/districts/pointPool.test.ts
    - packages/core/districts/securedPlayoffPoints.ts
    - packages/core/districts/pooledLockInputs.ts
    - packages/core/districts/pointPool.reconciliation.test.ts
    - scripts/securedPlayoffCorpus.test.ts
    - scripts/districtLocksNoTakeBack.test.ts
    - scripts/measureLedgerTenets.test.ts
    - scripts/districtLocksStagedReplay.test.ts
decisions:
  - "The playoff pool is 216 for every season: the largest over the declared pay rules, because the pool readers are not told the season (D5, R1)"
  - "The bound rests on FIRST's four robot roster rule; the numbers at five robots (217 / 220) and with no roster rule (222 / 225) are pinned and NOT taken (D5, R2)"
  - "For the seasons before 2023, which declare no pay rule, 216 is a measured margin over the 210 none of their 533 district tier events passed"
  - "The selection pool is proven; the award pool and the qualification pool's three phantom attendees stay measured and unchanged (D2)"
metrics:
  started: 2026-10-13T21:08:13Z
  completed: 2026-10-13T21:50:38Z
  duration_minutes: 43
  tasks: 2
  files: 9
actuals:
  tokens: 18606
  tasks: 2
  commits: 2
---

# Quick Task 261013-lve: The playoff point pool is the most the pay rule can hand out, proven Summary

The District Locks pooled test now rests on a playoff pool of 216, derived from TBA's pay rule and reached but never passed by an independent search over all 32,768 brackets, where it was a measured 213 (the highest total ever seen plus one).

**Base commit:** e0e8856e (pushed and live). **Nothing is pushed. Nothing is deployed.**

| Task | Commit | Subject |
|---|---|---|
| 1 | 09cd8660 | feat(261013-lve): the most TBA's playoff pay rule can pay one event, derived from the rule and reached by a search that shares no code with it |
| 2 | 0ce59192 | fix(261013-lve): the playoff pool is the most the pay rule can pay, 216 and proven, where it was a measured 213 |

No gate stopped the task. No STOP rule fired: the search never read above the closed form, and no corpus event is above the bound.

## The derivation of 216 and 214

An alliance's table points are shared among its robots by the wins each was on the field for, each share rounded UP, three robots credited a win. Before rounding the shares sum to exactly three times the alliance's points (210 for the whole event), so every point above 210 is a rounded share, and a part share needs a fourth robot. With at most four robots an alliance:

| alliance | points over wins | best split | paid |
|---|---|---|---|
| finalist or champion | 20 over 3 semifinal wins | 20 + 14 + 14 + 14 | 62 |
| the same over 4 wins | 20 over 4 | every share a multiple of 5 | 60 |
| third place | 13 over 2 or 3 | 13 + 13 + 7 + 7, or 13 + 13 + 9 + 5 | 40 |
| fourth place | 7 over 2 | 7 + 7 + 4 + 4 | 22 |
| the champion's two Finals wins, since 2024 | 5 a robot a win | three robots a win, never rounded | 30 |

- Since 2024 (`semifinalWins`): (62 + 30) + 62 + 40 + 22 = **216**.
- In 2023 (`allWins`): the title's 10 joined the shared points and 30 over 5 or 6 wins leaves no part share, so the champion is paid exactly 90: 90 + 62 + 40 + 22 = **214**.
- The rounding gains are 2, 2, 1 and 1, not 3 each.

`mostPlayoffPointsPaid(rule, robots)` computes this from `BRACKET_SETS`, `SEMIFINAL_WIN_POINTS`, `FINALS_WIN_POINTS` and `proratedPlayoffPoints` (a sum over the eight places an alliance can leave the bracket at, of the most an alliance leaving there can be paid). It is never typed.

## The search

In `packages/core/districts/pointPool.test.ts`, sharing no code with the derivation: the bracket's feeds typed by hand, every one of the 8,192 semifinal outcomes times four Finals series (32,768 brackets), every lineup of a roster of four for each alliance, one joint call per bracket, asked only of the pay rule's public `playoffPointsPaid`. Executed in my runs (Task 1 targeted run, Task 2 targeted run, and the full suite):

| season | brackets | most | brackets at the most | least any bracket's best lineup pays | refusals | joint total differs from the sum of the parts |
|---|---|---|---|---|---|---|
| 2023 | 32,768 | 214 | 12,288 | 212 | 0 | 0 |
| 2024, 2025, 2026 | 32,768 each | 216 | 16,384 | 214 | 0 | 0 |

- Never above the closed form. Reached in every registered season.
- A seeded random joint search (20,000 brackets a season, every roster and lineup drawn at once, one field in fifty short a robot) agrees: the most equals the bound and is reached, 0 refusals.
- The lineup that reaches 216 (pinned row by row, 2026): alliance 1 wins sf1, sf7, sf11 and the Finals in two with a different robot of its last three sitting sf7 and sf11 (paid 30, 24, 24, 14); alliance 2 wins sf3, sf8 and sf13 the same way (20, 14, 14, 14); alliance 4 is third (13, 13, 9, 5); alliance 3 fourth (7, 7, 4, 4). For 2023 the champion is paid 30, 30, 30 and the total is 214. With every alliance on its first three both read 210.
- The planner's fully unmemoized run (7,159,808 calls for 2023 and 2026) and its 139,640 call count for the shipped form are the planner's readings; the shipped test does not print a call count.

## What the bound rests on, and the numbers not taken

Stated in the `pointPool.ts` header, each held by a test:

1. TBA's pay rule as declared per season (2023 `allWins`; 2024 to 2026 `semifinalWins`). The corpus gate holds the rule equal to every paid value.
2. The eight alliance bracket (`bracket.ts`).
3. At most three robots credited for one decisive row: 7,540 of 7,540 rows of 2023 to 2026.
4. At most FOUR robots paid on one alliance (three picks and one backup): FIRST's rule, the same one the Champ Locks joint proof rests on (quick task 261009-tx9). Over the 3,968 alliances of the 507 events of 2023 to 2026: 132 hold a win at four robots, none at five; no alliance list names more than four (351 name four).
5. A losing finalist is paid nothing for a Finals match it won (the pay rule, 329 of 329 measured).

Numbers NOT taken (pinned in the test so nobody reads 216 as free of premise 4):

| roster | 2023 rule | since 2024 |
|---|---|---|
| three robots | 210 | 210 |
| **four robots (taken)** | **214** | **216** |
| five robots | 217 | 220 |
| no roster rule (nine or more) | 222 | 225 |

Limits, stated plainly:
- The bound is proven for four robots an alliance and rests on TBA's pay rule as declared.
- It is proven for the seasons with a declared rule, 2023 on. The seasons before 2023 played another bracket under another pay rule that nothing here declares; for them 216 is a measured margin of 6 (all 533 of their district tier events top out at exactly 210).
- The award pool and the qualification pool's margin are still measured.

A fifth robot paid on one alliance, a row crediting four, a registered season with no declared rule, or a rule kind with no derived bound each turns a test or the typecheck red.

## The corpus distribution

My own read-only run of the planner's `corpus_dist.mts` (`LVE/exec/corpus_dist.txt`) equals the planner's line for line but for one line that reads the pool itself (all four pools together: closest event 23 under, where the planner read 20 under at a pool of 213). The eighth test of `scripts/securedPlayoffCorpus.test.ts` pins the same counts and passed.

| what | events | 210 | 211 | 212 | above 212 |
|---|---|---|---|---|---|
| the pay rule's total over EVERY robot, district tier, 2023 | 94 | 82 | 12 | 0 | 0 |
| the same, district tier, 2024 to 2026 | 324 | 261 | 57 | 6 | 0 |
| the same, dcmp tier in base points, 8 alliances, 2023 | 17 | 16 | 1 | 0 | 0 |
| the same, dcmp tier, 2024 to 2026 | 56 | 44 | 12 | 0 | 0 |
| TBA's paid total over district rows only, district tier, 2023 to 2026 | 418 | 275 | 51 | 6 | 0 (86 below 210) |
| the same, every season 2016 to 2026 | 951 | 601 | 51 | 6 | 0 (293 below 210) |

- The six events at 212: 2024misjo, 2026txcle, 2026njfla, 2026mabil, 2026wasam, 2026wiply.
- Seasons 2016 to 2022: 533 district tier events, maximum exactly 210 in every season.
- Robots credited per decisive row: 3 at 7,540 of 7,540. Robots holding a win per alliance (507 events): none at 994, three at 2,842, four at 132, never five. Alliance lists: three names at 3,617, four at 351, never more.

## Who reads `PLAYOFF_POOL`

`pointPool.ts` (`eventRemainingPool`), `pooledLockInputs.ts` (the pool and the cap of the netting), through it `districtLedgerStatus.ts` (the District Locks tab) and `districtRankingsMerge.ts` `pooledDistrictPoints` (the publisher and the Worker). None is told the season, which is why the pool is the largest over the rules. The dcmp tier does not read this pool. None of those callers was edited.

## The other pools (D2): nothing changed

| pool | rests on | closest the corpus has come (951 district tier events) |
|---|---|---|
| selection, 236 | PROVEN: the selection formula over the 24 scoring picks of eight alliances | exactly 236 at 612 events, never above |
| qualification | the manual's formula, proven for a real field up to three teams larger than the artifact shows; the three is MEASURED | at 0 phantom attendees 38 events over (by up to 10), at 1 one event over (by 2), at 2 and at 3 none; closest event 11 under (2022on409), then 12 (2022on273, 2017vabla) |
| awards, 78 / 86 / 91 by rookie count | MEASURED, and cannot be proven: an event chooses which awards it gives | exactly at the pool at 37, 45 and 70 events, never above; a season's events have sat exactly at their pool in 2019, 2020, 2022, 2025 and 2026 |

## Gates, as printed

Base (`LVE/exec/base`, taken at e0e8856e before the first edit) against the planner's base: `LVE GATES AS EXPECTED (none)`; `LVE WORKER CLOSURE AS EXPECTED (base, 103 files)`.

**Task 1** (`LVE/exec/after-t1`):

```
joint: identical to the base (1304 lines compared)
champ: identical to the base (129 lines compared)
ledger: identical to the base (163 lines compared)
settled: identical to the base (39 lines compared)
cutoff: no drift for both generated files
takeback: championships 48, stops 412, take-backs 0
now: identical on both tabs (artifacts 109 teams 16345)
UL3 COMPARE CLEAN
R9X COMPARE CLEAN
LVE GATES AS EXPECTED (none)
LVE WORKER CLOSURE AS EXPECTED (after, 105 files)
```

**Task 2** (`LVE/exec/after-t2`, `LVE/exec/effect`):

```
joint: identical to the base (1304 lines compared)
champ: identical to the base (129 lines compared)
ledger: identical to the planner's expected output (163 lines compared)
settled: identical to the planner's expected output (39 lines compared)
cutoff: no drift for both generated files
takeback: championships 48, stops 412, take-backs 0
now: identical on both tabs (artifacts 109 teams 16345)
UL3 COMPARE CLEAN
R9X COMPARE CLEAN
LVE GATES AS EXPECTED (pool)
pool_diff: identical to the planner's expected output (84 lines)
notakeback: identical to the planner's expected output (13 lines)
pin_pools: identical to the planner's expected output (4 lines)
LVE EFFECT AS EXPECTED
LVE WORKER CLOSURE AS EXPECTED (after, 105 files)
```

`LVE REFERENCE CHECK HOLDS (task 1, 4 files)` and `LVE REFERENCE CHECK HOLDS (task 2, 9 files)`: every code line and every pin is the reference's, comments aside. `LVE_TASK1_OK` and `LVE_TASK2_GATES_OK` were printed.

## The measured effect

Settled sweep, 418 district tier events of 2023 to 2026, 2,926 stops, from my own `LVE/exec/effect/pool_diff.txt`. It equals planner finding 5 in every cell; no difference to name.

| stop | Locked before | after | lost | gained |
|---|---|---|---|---|
| Alliances final | 5,155 | 5,147 | 8 | 0 |
| Round 1 | 5,155 | 5,147 | 8 | 0 |
| Round 2 | 5,393 | 5,384 | 9 | 0 |
| Round 3 | 5,557 | 5,542 | 15 | 0 |
| Round 4 | 5,690 | 5,676 | 14 | 0 |
| Round 5 | 5,769 | 5,760 | 9 | 0 |
| Playoffs final, awards open | 6,052 | 6,049 | 3 | 0 |
| all | 38,771 | 38,705 | 66 | 0 |

- By season: 18 (2023), 19 (2024), 7 (2025), 22 (2026). 47 distinct district and team pairs at 34 events.
- All 66 were held by the pooled argument alone. 63 are Locked again by the last stop of the same event; the other 3 are lost AT the last stop (2023txfor frc3802, 2026capin frc3255, 2026casgv frc3045), which has no later stop in the event.
- Take backs inside an event: 0. Status differences other than a pooled Locked no longer shown: 0. Locked out 83,667 unchanged. Tenets A to F all 0, `VIOLATIONS: none`, `SKIPPED (0)`.
- Settled sweep blunt rule: 36,982 to 36,931. Settled over blunt: 1,789 to 1,774, lost 0.
- All seasons sweep (109 seasons, 4,022 positions, 921,658 team positions): Locked on points 76,964 to 76,909, kept 75,594 to 75,541, award qualified 1,370 to 1,368, In range 318,013 to 318,068, pooled alone 6,512 to 6,457 at 1,073 to 1,066 positions, pool total 23,694,682 to 23,771,641, tenets A and B 0 and 0. The 55 include seasons before 2023 (for example 2016chs, 2017fim, 2022ne), because the same pool is read for their rewound views.
- Both Champ sweeps, the cutoff history check, `take-backs 0` over 48 championships and 412 stops, the Now dump and the publisher comparison did not move in either task.

## Every pin moved

All nine tests in four files, each replaced by the executed value and each equal to the planner's pre registered value. No pin was fitted.

| file | pin | before | after | cause |
|---|---|---|---|---|
| `pointPool.test.ts` | `PLAYOFF_POOL` | 213 | 216 | the pool itself |
| same | a 40 team event at 0, 1, 2 rookies | 1060, 1068, 1073 | 1063, 1071, 1076 | 3 more |
| same | only the Playoffs open; Playoffs and awards open, one rookie | 213; 213 + 86 | 216; 216 + 86 | 3 more |
| `districtLocksNoTakeBack.test.ts` | 2026cthar frc2067 status at the seven stops | Locked x 7 | In range, In range, Locked x 5 | its pooled lock at the first two stops rested on a district pool of 4,323; it reads 4,338 |
| same | frc2067 `lockedBy` | pooled, pooled, both x 5 | null, null, both x 5 | the same |
| same | Locked on points, blunt rule | 6, 6, 6, 6, 6, 6, 9 | 5, 5, 5, 5, 5, 5, 9 | the blunt rule held frc2067 by the pooled argument alone |
| same | Locked on points, settled rule | 6, 6, 7, 7, 8, 8, 9 | 5, 5, 7, 7, 8, 8, 9 | the same two stops |
| same | gained by the settled rule | frc7407 from Round 2, frc1699 from Round 4 | frc2067 joins both from Round 2 | the blunt rule no longer holds it |
| same | NEW pin: the district's whole pool per stop | (4,323 x 6, 4,110) | 4,338 x 6, 4,122 | five events with their Playoffs open (2026cthar, 2026mabos, 2026mawor, 2026nhdur, 2026vtbur), then four |
| same | NEW assertion: once Locked, Locked at every later stop (first Locked stop is the third) | | | the rule the file holds, on the statuses themselves |
| same | UNCHANGED: `lost` empty at every stop, pool difference 0, 0, 78, 120, 159, 181, 0, no violation, `takeBackBlunt` 0 | | | |
| `measureLedgerTenets.test.ts` | `MEASURED_LOCKED_SHOWN` | 76,964 | 76,909 | 55 pooled displays fewer |
| same | `MEASURED_LOCKED_BY_POOLED_ONLY` | 6,512 | 6,457 | the same 55 |
| same | `MEASURED_POSITIONS_WITH_POOLED_ONLY_LOCK` | 1,073 | 1,066 | |
| `districtLocksStagedReplay.test.ts` | case A `districtTabGained` | 105 | 99 | six team ticks the pooled argument no longer reaches; case B stays 97, champ counts stay 19 and 22, nothing Locked only without the credit |

`pointPool.reconciliation.test.ts` gained one assertion (the pool is above the highest total ever handed out, 212) and prints the totals by value; no pin there moved. `pooledLockInputs.test.ts` and `districtLedgerStatus.test.ts` pass unedited.

2026cthar frc2067 is the example quick task 261009-uhb was written around. It is re read as "once Locked, stays Locked": In range at Alliances final and Round 1, Locked from Round 2 at every later stop.

## Tests and typechecks, as printed

- Task 1 failing first run: `Tests 14 failed | 17 passed (31)` (the five bound tests, the eight search tests, the lineup test; `mostPlayoffPointsPaid is not a function`).
- Task 1 targeted: `Test Files 34 passed (34)`, `Tests 860 passed (860)`.
- Task 2 failing first run: `Tests 4 failed | 27 passed (31)` (the test named "is 216 ..." and the three `eventRemainingPool` pins, each on 213, 1060 or 299 where 216, 1063 or 302 is expected).
- Task 2 targeted: `Test Files 39 passed (39)`, `Tests 1020 passed (1020)`.
- Four typechecks (root, web, e2e, worker), chained: `TYPECHECKS_OK` in both tasks.
- Full root suite, `REQUIRE_LOCAL_DATA=1 npx vitest run`, one run after Task 2 on the tree that was committed: `Test Files 360 passed (360)`, `Tests 9205 passed | 1 skipped (9206)`, 1,591.77 s. No load sensitive test failed, no rerun was needed, and the machine did not sleep during it. No local data group was skipped (the one skip is the network test).

## The Worker

- Import closure: 103 files to 105. `securedPlayoffPoints.ts` and the `finalsBracket.ts` it imports join it; the bundler drops the credit functions (`playoffPointsPaid` and `securedPlayoffPoints` are not in the built file).
- `npx --no-install wrangler deploy --dry-run` from `apps/worker` builds in both tasks:

| build | Total Upload | gzip |
|---|---|---|
| e0e8856e (the planner's build from the real tree) | 1364.75 KiB | 250.93 KiB |
| after Task 1 (mine) | 1369.57 KiB | 252.22 KiB |
| after Task 2 (mine) | 1369.41 KiB | 252.16 KiB |

- What changes in the Worker's behaviour: `pooledDistrictPoints` hands the lock math a pool 3 larger for every district tier event whose Playoffs category is open, so a published `districtLock` of `locked` can be withheld where the pooled argument alone held it. Nothing at Now for a finished season (the publisher comparison is clean over all 109 artifacts), and no district event is live.

## What is owed

1. A push of the two commits (`git log origin/main..main` lists exactly 09cd8660 and 0ce59192).
2. A Worker deploy by the orchestrator, with the owner's go ahead (`npx wrangler deploy` from a clean tree). The bundle changed; no district event is live.
3. No republish: no published artifact moved.
4. The live e2e specs after the deploy.

## Readings the plan chose (kept as planned)

- R1. The largest over the rules for every season (216), not a pool per season; with the stated limit that seasons before 2023 have no declared rule.
- R2. A roster of four, named as a premise and held by a corpus test. A pool with no roster premise (225) was measured by the planner to lose 273 displays and was not planned.
- R3. A losing finalist is paid nothing for a Finals match it won (the pay rule), not the manual's 25 for second place (a pool of 231 would lose 396 displays; not planned).
- R4. The derivation is a sum over the eight places of the most an alliance leaving there can be paid: an upper bound whether or not the maxima can happen together, and the search shows they can.
- R5. Two tasks: the proof first, moving nothing, then the switch.

## Premises the code or the data contradicted

- P1. "up to about 222": the exact maximum is 216 (214 in 2023). 222 is what the 2023 rule could pay with no roster limit.
- P2. `SCRATCH/mw2/gates.sh` does not exist; the gates are `SCRATCH/d7r/gates.sh` with `LVE/gates_compare_lve.sh`.
- P3. `pointPool.ts` was in the Worker's closure already; what is new is `securedPlayoffPoints.ts` and `finalsBracket.ts`, and the header sentence saying the Worker does not import the pay rule module is corrected.
- P4. A larger pool only removes pooled locks, and one it removes was pinned (frc2067 at 2026cthar).
- P5. The pool is 3 larger for every event of the district whose Playoffs category is open at the position, events not yet played included, not for the event in progress only.
- P6. The white paper's own playoff value is 213, below what the rule can pay.

## Deviations from Plan

### Comment corrections beyond the reference (Step 3 and Step 4 of the tasks: "make every comment true")

The reference check holds with comments aside after each. No code line and no pin differs from the reference.

**1. [D5] The numbers not taken, both rules, in the `pointPool.ts` header**
- **Found during:** Task 1 (and reapplied after the Task 2 install, which rewrites the header)
- **Issue:** premise 4 named 220 and 225 (222 in 2023) but not the 2023 number at five robots. D5 asks for 217 / 220 and 222 / 225 side by side.
- **Fix:** the sentence now reads: with five robots an alliance the same pay rule could pay 217 under the 2023 rule and 220 since 2024, and with no limit on the roster 222 and 225. All four are pinned by the test "is proven for four robots an alliance and for no more".
- **Commits:** 09cd8660, 0ce59192

**2. [Rule 1] An untrue sentence about the award pool in the `pointPool.ts` header**
- **Found during:** Task 2, reading the installed header against my own corpus read
- **Issue:** the reference said events sit exactly at the award pool "every season". My run shows a margin of 0 in 2019, 2020, 2022, 2025 and 2026 only (5 in 2016, 2017, 2018, 2023, 2024).
- **Fix:** "events have sat exactly at it in five of the ten seasons (2019, 2020, 2022, 2025 and 2026)".
- **Commit:** 0ce59192

**3. [Rule 1] Test names in the `pooledLockInputs.ts` header that do not exist**
- **Found during:** Task 2
- **Issue:** HELD BY quoted "PLAYOFF_POOL, proven from the pay rule" and "the playoff pool against a search that shares no code with its derivation". The describes are named "PLAYOFF_POOL", "the most the pay rule can pay all robots of one event" and "the most the pay rule can pay against a search that shares no code with its derivation".
- **Fix:** the header quotes the real names.
- **Commit:** 0ce59192

### Findings (no stop)

**4. The planner's prototype bundle sizes were read from a scratch tree.** The plan names 1367.20 KiB (Task 1) and 1367.04 KiB (Task 2). Mine, from the real tree, read 1369.57 and 1369.41 KiB. The whole difference is the dependency path comments the bundler writes (the real tree's pnpm store paths are longer than the scratch tree's): with those paths normalized my two bundles equal the planner's two prototypes with 0 differing lines. The planner's base build (1364.75 KiB) was from the real tree, so the true growth is 4.66 KiB (1.23 KiB gzip). I did not take a base dry run of my own before the first edit; the plan did not ask for one.

**5. Three of the 66 lost displays are at an event's last sweep stop** (Playoffs final, awards open), so "63 Locked again by the last stop" leaves 3 with no later stop in the event rather than 3 that stay unlocked through later stops. The header's wording (63 of them are Locked again by the last stop of the same event) is true as written.

### By plan instruction

- No STATE.md edit, no todo, no `.planning/` commit, no final docs commit: the plan's output section says so.
- The full root suite ran once, after Task 2; the plan asks for none after Task 1.
- The search's call count and the fully unmemoized search are the planner's readings; the shipped test pins brackets, most, brackets at the most, least, refusals and joint differences, and those are what my runs executed.

## Known Stubs

None.

## Self-Check: PASSED

- 09cd8660 and 0ce59192 are on `main`, unpushed; each holds exactly the files of its task (4 and 7); nothing under `.planning/` and nothing under `apps/worker` is in either.
- All nine modified files exist; `git status --short` shows only this quick task's untracked directory.
- `PLAYOFF_POOL` reads 216 (`pointPool.test.ts` green on the committed tree).
