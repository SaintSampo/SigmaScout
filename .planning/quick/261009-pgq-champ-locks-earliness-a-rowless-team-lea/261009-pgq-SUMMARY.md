---
phase: quick-261009-pgq
plan: 01
subsystem: districts / Champ Locks
status: complete
tags: [champ-locks, lock-proof, soundness, dcmp, divisions, earliness]
requirements_completed: [261009-pgq]
dependency_graph:
  requires: [261009-kt3 divisioned and two championship joint proof, 261009-2tr joint worst case proof, 261006-lwo two championships]
  provides: [fieldFixingDcmpKeys, the D1 field rule in dcmpStartedForTeam, the D3 remaining judged budget per division (awardedTeamCountAt), the D1 pool membership guard test, FIM and NE 2026 pins as executed]
  affects: [Champ Locks tab Locked verdict at FIM, NE, ON and TX from Alliances final to the finals, a rowless team's membership and ceiling at a divisioned championship before the finals start]
tech-stack:
  added: []
  patterns: [a rule on the dcmp keys alone, a budget that counts posted points and does not trust a stage flag, byte identical regression dumps for the shapes a change must not touch, pins replaced from the executed run by script]
key-files:
  created: []
  modified:
    - apps/web/src/components/districts/champLedgerRows.ts
    - apps/web/src/components/districts/champLedgerRows.test.ts
    - apps/web/src/components/districts/champLedgerStatus.ts
    - apps/web/src/components/districts/champLedgerStatus.test.ts
    - scripts/measureChampJointLocks.test.ts
    - packages/core/districts/champJointLock.ts
    - .planning/todos/pending/champ-joint-lock-follow-ups.md
decisions:
  - "D1: a team with no dcmp row is out of the field once every FIELD FIXING key has started; a divisioned championship's finals key is not field fixing."
  - "D2 withdrawn: no core code change. A rowless team read as out is already a pool rival at extra 0, asserted by a test."
  - "D3 as revised by the orchestrator: the divisioned judged budget is, per division, 14 while its Awards are open and 14 minus the teams already carrying award points there (never below 0) once they read final. The Awards flag alone is not trusted."
  - "The four FIM and NE pins hold the sets as executed after D1 and the revised D3; the pin loop asserts that no team that missed is in any pinned set."
metrics:
  duration: "about 35 minutes (18:44 to 19:04, then the revision 19:07 to 19:20 local)"
  completed: 2026-10-09
estimate:
  tokens: 50000
  tasks: 2
  confidence: high
actuals:
  tokens: 8600
  tasks: 2
  commits: 2
---

# Quick 261009-pgq: Champ Locks earliness, a rowless team leaves the field once every division has started, and the judged budget is what each division can still give

At a divisioned District Championship (FIM, NE, ON, TX) the Champ Locks `Locked` verdict now lands earlier. A team with no championship row stops carrying a 249 point hypothetical DCMP once every division has started (D1). The joint proof's judged award budget is, per division, the whole 14 while its Awards are open and 14 minus the teams already carrying award points there once they read final (D3 as revised). The corpus sweep over all 48 championships reports zero violations and skips none. Every single event and California bound and locked set is byte identical to before the task.

## Commits

| # | Commit | Subject |
|---|---|---|
| Task 1 | d48fb42e | feat(261009-pgq): a rowless team leaves the field once every division has started, and the judged budget counts open divisions only |
| Revision | 27a1434e | fix(261009-pgq): the judged budget is the ceiling minus the judged awards already posted, per division |
| Task 2 | none | Gates, todo and this summary. No methodology sentence reads false, so there is no copy change and no commit. |

Base: 0656d2f2. Nothing is pushed. Every commit staged files by explicit path. `git diff --name-only 0656d2f2..HEAD` lists six files: the five of the plan plus `packages/core/districts/champJointLock.ts` (comment only, the orchestrator's allowance). Not touched: `champJointLock.test.ts`, `districtLedgerStatus.ts`, `reservedSlots.ts`, `pooledLockInputs.ts`, the publisher, `apps/worker/`, `packages/harness/`. No artifact shape, algorithm version or Worker change. No `.planning/` file is committed.

## Verification (printed output, not exit codes)

Final state, at 27a1434e:
- `npx tsx scripts/measureChampJointLocks.ts`: exit 0, 48 championships, `SKIPPED (0)`, `VIOLATIONS: none`, 11.0 to 13.4 s (9.5 s before the task).
- `npx tsx scripts/measureChampTenets.ts`: `VIOLATIONS: none`. Locked on points shown 6,836 and Locked out shown 271,340, both unchanged from 261009-kt3.
- `npx tsx scripts/measureChampCutoff.ts --check-history`: `no drift: packages/core/districts/dcmpHistory.generated.ts` and `no drift: packages/core/districts/champCutoffTuning.generated.ts`. Nothing was regenerated.
- Full root `npx vitest run`: `Test Files 347 passed (347)`, `Tests 8147 passed | 1 skipped (8148)`. That is 261009-kt3's 8,138 plus 9 new tests; the one skip is the same pre existing one.
- `npx vitest run apps/web/src/components/districts scripts/measureChampJointLocks.test.ts`: `Test Files 29 passed (29)`, `Tests 924 passed (924)`.
- The pin file alone: 11 passed, 0 skipped (4 FNC, 4 FIM and NE, 2 CA, 1 D3). It ran, not skipped.
- `npx vitest run packages/core/districts/champJointLock.test.ts`: `Tests 40 passed (40)` before the task, after Task 1 and after the revision.
- `TYPECHECKS CLEAN (root, web, e2e)` after Task 1 and after the revision.

RED runs, read before each implementation: Task 1 printed `6 failed | 126 passed (132)` (the new D1, guard and D3 cases only); the revision printed `1 failed | 58 passed (59)` (`expected 14 to be 16`, the revised D3 case only).

The same gates were also run and passed at d48fb42e (the first D3 rule); their numbers are the "D3 as first committed" columns below.

## The sweep by shape: before, D3 as first committed, after the revision

| Shape | State | Championships | Stops | Proof ran | Shipped | Joint only | Combined | Violations | Locked earlier |
|---|---|---|---|---|---|---|---|---|---|
| Single event | before (kt3) | 31 | 248 | 217 | 340 | 414 | 754 | 0 | 167 |
| Single event | D3 first (d48fb42e) | 31 | 248 | 217 | 340 | 414 | 754 | 0 | 167 |
| Single event | after (27a1434e) | 31 | 248 | 217 | 340 | 414 | 754 | 0 | 167 |
| Divisioned | before (kt3) | 16 | 156 | 140 | 1,539 | 810 | 2,349 | 0 | 298 |
| Divisioned | D3 first (d48fb42e) | 16 | 156 | 140 | 1,582 | 1,246 | 2,828 | 0 | 461 |
| Divisioned | after (27a1434e) | 16 | 156 | 140 | 1,582 | 1,085 | 2,667 | 0 | 381 |
| Two championships (2026 CA) | before (kt3) | 1 | 8 | 7 | 41 | 62 | 103 | 0 | 21 |
| Two championships (2026 CA) | D3 first (d48fb42e) | 1 | 8 | 7 | 41 | 62 | 103 | 0 | 21 |
| Two championships (2026 CA) | after (27a1434e) | 1 | 8 | 7 | 41 | 62 | 103 | 0 | 21 |
| All | before (kt3) | 48 | 412 | 364 | 1,920 | 1,286 | 3,206 | 0 | 486 |
| All | D3 first (d48fb42e) | 48 | 412 | 364 | 1,963 | 1,722 | 3,685 | 0 | 649 |
| All | after (27a1434e) | 48 | 412 | 364 | 1,963 | 1,561 | 3,524 | 0 | 569 |

Single subtotal line as printed at 27a1434e: `SINGLE SUBTOTAL 31 championships / 248 stops / proof applied at 217 / shipped 340 / joint only 414 / combined 754 / violations 0`.

"Shipped" rose at the divisioned shape (1,539 to 1,582) because D1 also lowers a rowless team's ceiling in the older ceiling test, not only in the joint proof. The revision gives back 161 of the first rule's 479 lock stops (2,828 to 2,667) and keeps 318 over kt3.

### Divisioned, summed over the 16 championships, per stop (shipped + joint only = combined)

| Stop | Before (kt3) | D3 as first committed | After the revision | Gain over kt3 |
|---|---|---|---|---|
| Alliances final | 0+0=0 | 0+1=1 | 0+1=1 | +1 |
| Round 1 | 0+0=0 | 0+1=1 | 0+1=1 | +1 |
| Round 2 | 0+2=2 | 0+8=8 | 0+8=8 | +6 |
| Round 3 | 0+29=29 | 0+78=78 | 0+78=78 | +49 |
| Round 4 | 0+112=112 | 0+168=168 | 0+168=168 | +56 |
| Round 5 | 0+196=196 | 0+253=253 | 0+253=253 | +57 |
| Divisions final, finals not started | 197+144=341 | 240+247=487 | 240+186=426 | +85 |
| Finals after sf1 and sf2 (FIM only) | 118+105=223 | 118+152=270 | 118+127=245 | +22 |
| Finals after sf3 and sf4 (FIM only) | 118+108=226 | 118+155=273 | 118+128=246 | +20 |
| Finals after sf5 (FIM only) | 118+114=232 | 118+166=284 | 118+135=253 | +21 |
| Finals decided, awards open | 473+0=473 | 473+17=490 | 473+0=473 | 0 |
| Now | 515 | 515 | 515 | 0 |
| Total | 2,349 | 2,828 | 2,667 | +318 |

Alliances final to Round 5 are D1 alone (the division keys have started, the finals key has not, and every division's Awards are open, so K is unchanged there). From "Divisions final" on, the sweep's division stage has its Awards posted; every division posted 11 or 12, so K is 2 or 3 per division after the revision (it was 14 per division before the task, 0 under the first rule).

### Divisioned per stop tables, as the sweep prints them at 27a1434e

A cell reads shipped + joint only = combined; a lone number means all three are equal. "(was ...)" is the cell before the task (kt3). S' did not move at any stop.

**Four divisions (FIM)**

| Stop | 2023fim | 2024fim | 2025fim | 2026fim |
|---|---|---|---|---|
| Alliances final | 0 | 0 | 0 | 0 |
| Round 1 | 0 | 0 | 0 | 0 |
| Round 2 | 0+2=2 (was 0) | 0 | 0 | 0+1=1 (was 0) |
| Round 3 | 0+11=11 (was 0+9=9) | 0+6=6 (was 0+3=3) | 0+6=6 (was 0+4=4) | 0+9=9 (was 0+7=7) |
| Round 4 | 0+27=27 (was 0+26=26) | 0+20=20 (was 0+18=18) | 0+24=24 (was 0+14=14) | 0+26=26 (was 0+22=22) |
| Round 5 | 0+43=43 (was 0+40=40) | 0+33=33 (was 0+29=29) | 0+33=33 | 0+40=40 (was 0+32=32) |
| Divisions final, finals not started | 34+26=60 (was 32+20=52) | 28+36=64 (was 26+33=59) | 27+31=58 (was 27+24=51) | 29+34=63 (was 25+25=50) |
| Finals after sf1 and sf2 | 34+26=60 (was 34+18=52) | 28+36=64 (was 28+32=60) | 27+31=58 (was 27+26=53) | 29+34=63 (was 29+29=58) |
| Finals after sf3 and sf4 | 34+27=61 (was 34+20=54) | 28+36=64 (was 28+32=60) | 27+31=58 (was 27+27=54) | 29+34=63 (was 29+29=58) |
| Finals after sf5 | 34+29=63 (was 34+20=54) | 28+38=66 (was 28+35=63) | 27+34=61 (was 27+28=55) | 29+34=63 (was 29+31=60) |
| Finals decided, awards open | 71 | 74 | 67 | 71 |
| Now | 71 | 74 | 70 | 73 |
| S' first stop / finals decided | 82 / 79 | 86 / 82 | 80 / 77 | 83 / 80 |

**Two divisions (NE)**

| Stop | 2023ne | 2024ne | 2025ne | 2026ne |
|---|---|---|---|---|
| Alliances final | 0 | 0+1=1 (was 0) | 0 | 0 |
| Round 1 | 0 | 0+1=1 (was 0) | 0 | 0 |
| Round 2 | 0 | 0+1=1 | 0 | 0+1=1 (was 0) |
| Round 3 | 0+7=7 (was 0) | 0+5=5 (was 0+4=4) | 0+5=5 (was 0) | 0+8=8 (was 0) |
| Round 4 | 0+7=7 (was 0+4=4) | 0+6=6 | 0+8=8 (was 0+5=5) | 0+10=10 (was 0+3=3) |
| Round 5 | 0+10=10 (was 0+7=7) | 0+9=9 | 0+10=10 (was 0+9=9) | 0+13=13 (was 0+7=7) |
| Divisions final, finals not started | 16+4=20 (was 9+6=15) | 11+6=17 (was 11+4=15) | 13+7=20 (was 6+7=13) | 12+6=18 (was 7+5=12) |
| Finals decided, awards open | 21 | 18 | 19 | 18 |
| Now | 22 | 22 | 22 | 21 |
| S' first stop / finals decided | 32 / 29 | 31 / 28 | 31 / 28 | 32 / 28 |

**Two divisions (ON)**

| Stop | 2023ont | 2024ont | 2025ont | 2026ont |
|---|---|---|---|---|
| Alliances final to Round 3 | 0 | 0 | 0 | 0 |
| Round 4 | 0+4=4 (was 0) | 0+2=2 (was 0) | 0+2=2 (was 0) | 0+6=6 (was 0) |
| Round 5 | 0+6=6 (was 0+4=4) | 0+3=3 (was 0) | 0+7=7 (was 0) | 0+9=9 (was 0) |
| Divisions final, finals not started | 8+4=12 (was 8+1=9) | 5+5=10 (was 5) | 7+2=9 (was 6) | 8+3=11 (was 5) |
| Finals decided, awards open | 11 | 12 | 12 | 10 |
| Now | 15 | 15 | 15 | 14 |
| S' first stop / finals decided | 23 / 20 | 23 / 20 | 22 / 19 | 21 / 18 |

**Two divisions (TX)**

| Stop | 2023fit | 2024fit | 2025fit | 2026fit |
|---|---|---|---|---|
| Alliances final, Round 1 | 0 | 0 | 0 | 0 |
| Round 2 | 0+1=1 | 0 | 0 | 0+2=2 (was 0) |
| Round 3 | 0+2=2 | 0+9=9 (was 0) | 0+6=6 (was 0) | 0+4=4 (was 0) |
| Round 4 | 0+2=2 | 0+10=10 (was 0+3=3) | 0+7=7 (was 0+5=5) | 0+7=7 (was 0+4=4) |
| Round 5 | 0+5=5 | 0+13=13 (was 0+7=7) | 0+10=10 (was 0+7=7) | 0+9=9 (was 0+7=7) |
| Divisions final, finals not started | 8+9=17 (was 8+7=15) | 14+3=17 (was 7+5=12) | 11+4=15 (was 7+4=11) | 9+6=15 (was 8+3=11) |
| Finals decided, awards open | 19 | 18 | 16 | 16 |
| Now | 21 | 21 | 19 | 20 |
| S' first stop / finals decided | 30 / 27 | 29 / 26 | 28 / 25 | 28 / 25 |

### First lock moved earlier, divisioned: 381 (kt3 298, D3 first 461)

- FIM: 2023 61 (kt3 50), 2024 58 (55), 2025 56 (50), 2026 59 (57)
- NE: 2023 14 (9), 2024 13 (11), 2025 16 (11), 2026 17 (11)
- ON: 2023 9 (4), 2024 7 (0), 2025 7 (0), 2026 10 (0)
- TX: 2023 13 (11), 2024 15 (10), 2025 13 (10), 2026 13 (9)

Single stays 167 and 2026 California 21.

## Regression evidence (the gate that stands where D2 was withdrawn)

Zero single event and zero California bounds or locked sets changed, at d48fb42e and again at 27a1434e.

| Dump | Baseline (before any edit) | After Task 1 | After the revision | Lines | `cmp` against the baseline | sha256 (all three files) |
|---|---|---|---|---|---|---|
| `dumpSingle.mts`, every single championship stop | `pgq_single_base.txt` | `pgq_single_after.txt` | `pgq_single_rev.txt` | 248 | byte identical, both times | 34a18c7d...2424d0f |
| `pgq_dumpCa.mts`, every 2026 California stop | `pgq_ca_base.txt` | `pgq_ca_after.txt` | `pgq_ca_rev.txt` | 8 | byte identical, both times | 5e8c5afb...b604ce0e |

The baseline single dump was also byte identical to 261009-kt3's final `single_t5.txt`. In the sweep, no per stop line of any single or two championship district differs from the pre task sweep. The files are in the session scratchpad and are not committed.

## Pins as executed (never fitted)

The sets were written into `scripts/measureChampJointLocks.test.ts` by a script that read them from the pins run, after the gates held, once at Task 1 and again after the revision. No proof, gate or input was changed to reach a set. S' did not move at any pinned stop. No kt3 member left any set. Every member of every set is `locked` or `lockedAward` at Now, and no team that missed qualification is in any set (`bad 0` at all 29 FIM, NE and CA 2026 stops; the pin loop asserts it against the artifact's own verdicts).

**Unmoved:** FNC 2026 Round 5 (the five teams, K 14) and Playoffs final; CA Round 5 (15, S' 46) and CA Playoffs final (19, S' 39). No pinned value changed, at either commit.

| Stop | S' | K: kt3 / D3 first / revised | Count: kt3 / D3 first / revised | Teams gained over kt3 (bound, all `locked` at Now) | In the D3 first set, not in the revised set |
|---|---|---|---|---|---|
| FIM Divisions final, finals not started | 83 | 56 / 0 / 8 | 50 / 69 / 63 | 13: frc201 (82), frc1023 (75), frc1498 (77), frc2619 (72), frc3536 (79), frc3656 (79), frc4398 (73), frc6121 (77), frc6152 (81), frc6615 (72), frc9245 (74), frc9757 (72), frc9771 (81) | 6: frc70, frc494, frc1188, frc3707, frc5462, frc5675 |
| FIM Finals decided, awards open | 80 | 56 / 0 / 8 | 63 / 72 / 64 | 1: frc3707 (79) | 8: frc70, frc3572, frc3603, frc3604, frc5462, frc5843, frc8612, frc9572 |
| NE Divisions final, finals not started | 32 | 28 / 0 / 4 | 12 / 22 / 18 | 6: frc133 (26), frc238 (25), frc1922 (30), frc2067 (31), frc5813 (29), frc7407 (27) | 4: frc1073, frc1699, frc2713, frc4909 |
| NE Finals decided, awards open | 28 | 28 / 0 / 4 | 15 / 20 / 16 | 1: frc2067 (27) | 4: frc1073, frc1699, frc2713, frc4909 |

C is 8 at all four stops throughout. Every team in the last column is `locked` or `lockedAward` at Now: the first rule locked no team that missed, it locked on a flag that could be wrong at Live. K 8 and 4 are 2 per division: every 2026 FIM and NE division posted 12 teams with award points.

**The sets as executed at 27a1434e**

- FIM Divisions final (63): frc1023 frc10633 frc1189 frc1498 frc1701 frc1918 frc201 frc2054 frc2075 frc2137 frc2337 frc2586 frc2611 frc2619 frc27 frc2767 frc2851 frc2960 frc33 frc3414 frc3536 frc3538 frc3539 frc3620 frc3641 frc3656 frc3668 frc4237 frc4362 frc4391 frc4398 frc469 frc4967 frc5066 frc5086 frc5114 frc5166 frc5193 frc5216 frc5460 frc548 frc5534 frc5660 frc5712 frc5907 frc6002 frc6090 frc6121 frc6152 frc6615 frc67 frc68 frc7160 frc7166 frc7197 frc7220 frc7769 frc8280 frc8517 frc8608 frc9245 frc9757 frc9771. Bounds 17 to 82 against S' 83. Near misses kept: frc1188, frc494, frc5675.
- FIM Finals decided (64): frc1023 frc10633 frc1188 frc1189 frc1498 frc1701 frc1918 frc201 frc2054 frc2075 frc2137 frc2337 frc2586 frc2611 frc2619 frc2767 frc2851 frc2960 frc33 frc3414 frc3536 frc3538 frc3539 frc3620 frc3641 frc3656 frc3707 frc4237 frc4362 frc4391 frc4398 frc469 frc494 frc4967 frc5066 frc5086 frc5114 frc5166 frc5193 frc5216 frc5460 frc548 frc5534 frc5660 frc5675 frc5712 frc5907 frc6002 frc6090 frc6121 frc6152 frc6615 frc67 frc68 frc7160 frc7166 frc7197 frc7220 frc8280 frc8517 frc8608 frc9245 frc9757 frc9771. Bounds 9 to 79 against S' 80. Near misses kept: frc5462, frc70.
- NE Divisions final (18): frc125 frc133 frc176 frc1768 frc190 frc1922 frc195 frc2067 frc238 frc2877 frc3467 frc5000 frc5687 frc5813 frc6328 frc6329 frc7407 frc88. Bounds 13 to 31 against S' 32. Near misses kept: frc4909, frc2713.
- NE Finals decided (16): frc125 frc133 frc176 frc190 frc1922 frc195 frc2067 frc238 frc2877 frc3467 frc5000 frc5813 frc6328 frc6329 frc7407 frc88. Bounds 9 to 27 against S' 28. Near misses kept: frc4909, frc2713.

A near miss list keeps only the teams its set still does not hold (all are `locked` at Now, so they are teams the proof cannot yet prove, not teams that missed). Both "Divisions final" sets now hold every team of the 261009-kt3 planner prototype (60 and 17) and more.

Other 2026 stops, joint locked kt3 / D3 first / revised: FIM Round 2 0 / 1 / 1, Round 3 7 / 9 / 9, Round 4 22 / 26 / 26, Round 5 32 / 40 / 40, after sf1 and sf2 58 / 69 / 63, after sf3 and sf4 58 / 69 / 63, after sf5 60 / 72 / 63. NE Round 2 0 / 1 / 1, Round 3 0 / 8 / 8, Round 4 3 / 10 / 10, Round 5 7 / 13 / 13.

## D1: the measurement, the guard, and why D2 was withdrawn

**The rule.** `fieldFixingDcmpKeys(dcmpEventKeys)` returns the dcmp keys except any key K for which another key is K plus one digit (a divisioned championship's finals key). `dcmpStartedForTeam` tests that list for a team with no dcmp row; a team with its own row still reads its own first key. A single championship and 2026 California are unchanged, since every one of their keys is field fixing.

**The measurement, reproduced by the executor** (`pgq_norow.mts` in the scratchpad, corpus `event_teams` against the district artifacts, read only; the `noRow2.cjs` named in CONTEXT was not in the scratchpad). Corpus 2023 to 2026, all 73 single and division DCMP events, 3,344 registrations:
- 18 teams were registered at one and carry no dcmp row at Now.
- All 18 are `eliminated` at Now (champ tier and district tier both).
- Every one finished at least 113 points below its district's cut line: gaps 113 to 217, totals 0 to 56. A 45 point award could not have carried one past a locked team.
- Additional fact: all 18 are at single championships (17) or 2026 California (1), whose rule did not change. None is at a divisioned championship, the only shape D1 changes.

**The guard (planner reading P1).** `champLedgerStatus.test.ts`, "261009-pgq guard (D2 withdrawn)": on the divisioned fixture with both divisions started and the finals not, every rowless team reads membership `out`; every one not already qualified is in `jointProof.input.pool` with `extra` 0; and a reduced input holding only the pool's top team T and a rowless rival R gives `jointLockBound` 1 for T with one consuming award and 0 with none.

**Why D2 was withdrawn.** It proposed a core term for award winners outside the pool. The planner's check showed that a rowless team is already a pool rival (`orderedKeys` takes every `rows.teams` entry): 2026 NE 98 of 98 and 2026 FIM 368 of 369 at "Divisions final, finals not started", the one missing being award qualified. A consuming award to such a team is already counted inside the proof's `min`. So no core code changed.

## D3 as revised: the remaining judged budget

`divisionedJointProof` sums, over the division keys:
- `dcmpJudgedAwardCeiling()` (14) for a division whose Awards stage is OPEN at the position: none of its award points is in any floor;
- `max(0, 14 - posted)` for a division whose Awards stage reads FINAL, where `posted` is the number of TEAMS whose row at that division key carries award points above 0 (`awardedTeamCountAt`). Each such team holds at least one posted award whose points are already in its floor, so the count is a lower bound on the awards posted and the remainder an upper bound on the awards still to come.

Single and two championship inputs keep 14 per championship.

**Why the flag is not trusted.** The Worker sets `awardsPosted` on the first award of any kind TBA lists for the event (`apps/worker/src/districtRefresh.ts` near line 257, `awards.length > 0`) and never asks again, so a division's Winner and Finalist awards can flip it while its judged awards are still due. Under the rule first committed (d48fb42e: 14 per division with open Awards, 0 for a final one) that would have set a division's K to 0 with judged awards still to come. Under the revised rule a division whose flag is true with no award points posted keeps its whole 14.

**Tests** (two divisions, Playoffs final in both, only the Awards stage and the award points on the rows vary): both open 28; one final with 12 awarded teams 16; both final with 12 each 4; one final with zero awarded teams (the premature flag) 28; one final with 3 awarded teams (a partial posting) 25; one final with 16 awarded teams 14 (0 for that division, never negative), and with the other final at 12, 2. `candidateWinners` is [11, 21] in every case. The two championship test's inputs each still read 14, and the FNC Round 5 pin's 14 is unchanged.

**Measured for the rule** (`pgq_div_awards.py`, the district artifacts): over the 40 division events of 2023 to 2026, all 478 division rows with award points carry exactly 15 (one judged award), and a division has 11 or 12 such teams (2 divisions at 11, 38 at 12). So the count of teams equals the count of judged awards in the corpus and a finished division keeps 2 or 3.

## Deviations from Plan

1. **[Orchestrator revision, before any push] D3's rule was replaced in a second commit.** Reason: my soundness note on d48fb42e, that D3 made the Live proof trust a flag which turns true on the first award of any kind. The orchestrator replaced "14 per division with open Awards" with the remaining budget rule above, as `fix(261009-pgq): ...` (27a1434e). The plan's `openAwardDivisions` name and its key link pattern `dcmpJudgedAwardCeiling() * openAwardDivisions` no longer exist; `awardedTeamCountAt` and `judgedBudget` stand in their place. The 28 / 14 / 0 test was replaced by the six cases above, the four FIM and NE pins were executed again, and every gate was rerun.
2. **[Orchestrator allowance, overrides planner reading P6] `packages/core/districts/champJointLock.ts` received comment only edits, in both commits.** Its header sentence and the `JointLockInput.judgedAwards` doc now describe the remaining budget rule. Proof that no code changed: every changed line is a comment line; the file transpiled with comments removed hashes to the same sha256 (0310f384...eadaa17d, 20,263 characters) at 0656d2f2, at d48fb42e and at 27a1434e; `champJointLock.test.ts` printed 40 passed all three times.
3. **[TDD, by constraint] No separate RED commits.** Both RED runs were made and read before the implementation, but the orchestrator asked for one commit per change under the given subjects.
4. **[Rule 2] The pin loop asserts "nobody who missed is in the set" directly.** It lists every artifact team whose verdict at Now is neither `locked` nor `lockedAward` and asserts none is in the joint locked set. The loop is shared, so the two CA pins run it as well; no CA pinned value changed. Empty near miss strings are filtered before the near miss check.
5. **[Plan text] `rowsAt` beside `modelAt`.** The guard needs the rows' `membership`, so the status test's helper is split in two; `modelAt` takes the optional started set as planned.
6. **[Rule 3] The D1 measurement script was missing** from the scratchpad, so it was rewritten and rerun. The result matches CONTEXT D1 exactly (18, all eliminated, 113 to 217, 0 to 56).
7. **[Todo]** Items 9 and 15 are struck through and prefixed as the plan says, each with one closing sentence naming the new code; the D1 measurement is a sub bullet under item 15. The plan said to add no item; the orchestrator then asked for ONE, item 18 (below).
8. **[Process]** Edits were made through Python scripts in the scratchpad (exact string replacement with a count assertion), as in 261009-kt3.
9. **[Not done, by constraint]** STATE.md, ROADMAP.md and the WINDOWS ledger were not updated, and no `.planning/` file was committed.

## Soundness notes for the reviewer

- **The Awards flag problem is wider than D3 and is NOT fixed here.** The revised D3 protects only the divisioned proof's judged budget. Everywhere else on both Locks tabs, the same flag still closes the Awards category on the first award listed: the older ceiling test drops every team's award ceiling at that event, both reservations fall to zero, and the joint proof stops running at a single championship. It is pre existing, it is todo item 18 (high priority), and its fix needs a Worker deploy, so it is Jacob's call. Whether TBA posts an event's awards all at once is not known: there is no network evidence, and the corpus is ingested after the fact.
- The revised D3 assumes a division row's award points are judged awards. Measured true for all 40 division events of 2023 to 2026 (every awarded row is exactly 15). A division that paid a consuming award's points on a division row would be over counted as "posted", so a new season's division rows are worth re measuring (`pgq_div_awards.py`) before relying on it.
- D1 rests on the measurement above plus the tested fact that a rowless team stays a pool rival at extra 0. A district whose rowless registrant sat near the cut line is the case to re examine.
- The finals event gives no judged award (261009-kt3 RESEARCH section 3); the budget has no term for it.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or schema change. The sweep, the dumps and the measurements open `data/corpus.sqlite` and the local district artifacts read only, with no network.

## Follow ups

`.planning/todos/pending/champ-joint-lock-follow-ups.md` (edited, not committed):
- **Closed:** items 9 (the judged budget) and 15 (the rowless team), with the D1 measurement under item 15.
- **Added:** item 18, HIGH priority, PRE EXISTING: the Awards flag flips on the first award of any kind and both Locks tabs read it as final; what it weakens, what is not known, and two candidate fixes (the Worker and publisher set the flag only once a judged award is listed; a browser guard that reads Awards as final at Live only when some team's row carries award points).

## Self-Check: PASSED

- FOUND: the six modified source files and the edited todo.
- FOUND commits: d48fb42e, 27a1434e.
- Sweep at 27a1434e: exit 0, 48 championships, SKIPPED (0), VIOLATIONS: none; single 31 / 248 / 217 / 340 / 414 / 754; two championships 1 / 8 / 7 / 41 / 62 / 103.
- Both regression dumps byte identical to their pre task baselines, after Task 1 and after the revision.
