---
phase: quick-261013-lve
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/districts/pointPool.ts
  - packages/core/districts/pointPool.test.ts
  - packages/core/districts/securedPlayoffPoints.ts
  - packages/core/districts/pooledLockInputs.ts
  - packages/core/districts/pointPool.reconciliation.test.ts
  - scripts/securedPlayoffCorpus.test.ts
  - scripts/districtLocksNoTakeBack.test.ts
  - scripts/measureLedgerTenets.test.ts
  - scripts/districtLocksStagedReplay.test.ts
autonomous: true
requirements: [261013-lve]

estimate:
  tokens: 35000
  raw_tokens: 70000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "D1: `mostPlayoffPointsPaid(rule)` in `pointPool.ts` is the most TBA's playoff pay rule can pay ALL robots of one eight alliance event together, over every way the bracket can end and every lineup of alliances of at most four robots with three on the field a win: 214 under the 2023 rule (`allWins`) and 216 under the rule of 2024 to 2026 (`semifinalWins`). It is computed from `BRACKET_SETS`, `SEMIFINAL_WIN_POINTS`, `FINALS_WIN_POINTS` and `proratedPlayoffPoints`, never typed. With three robots an alliance it reads 210, the placement table times three."
    - "D1: a search that shares no code with that derivation (the bracket's feeds typed by hand, all 32,768 ways a bracket can end, every lineup of a roster of four for each alliance, one joint call per bracket, asked only of the pay rule's public `playoffPointsPaid`) reads exactly 214 for 2023 (at 12,288 brackets) and exactly 216 for 2024, 2025 and 2026 (at 16,384), never above, with 0 refusals. A seeded random search of 20,000 brackets a season that draws every roster and lineup at once agrees, and the lineup that reaches the maximum is pinned row by row."
    - "D1: `PLAYOFF_POOL` is the largest of `MOST_PLAYOFF_POINTS_PAID_BY_RULE`, 216, for every season. The measured margin and the robots per alliance constant are gone. `pointPool.test.ts` fails for a registered bracket season with no declared pay rule or with a bound the search does not reach, and the typecheck fails for a pay rule kind with no entry in the `Record`."
    - "D1, corpus: over the 491 eight alliance events of 2023 to 2026 the pay rule's own total over EVERY robot is at or below the bound of its season's rule. District tier, base points: 210 at 343 events, 211 at 69, 212 at 6, none above (2023: 82 and 12; 2024 on: 261, 57 and 6). No decisive row credits more than three robots (7,540 of 7,540 credit three), no alliance holds a win at more than four (132 of 3,968 at four) and no alliance list names more than four (351 name four)."
    - "D2: no other pool changes. Selection is PROVEN (the formula over eight alliances, 236, reached at 612 of 951 events). Qualification is the manual's formula at a field three larger than the artifact shows, the three MEASURED (two already leaves no event over; the closest event sits 11 under its pool). Awards are MEASURED and cannot be proven (78, 86, 91, reached at 37, 45 and 70 events, never exceeded). The headers say which is which."
    - "D3: Task 1 moves NOTHING: every history gate is identical to the base (`LVE GATES AS EXPECTED (none)`). Task 2 moves exactly the two District Locks sweeps, to the planner's expected outputs (`LVE GATES AS EXPECTED (pool)`): settled sweep Locked on points 38,771 to 38,705 (66 lost, 0 gained, all 66 held by the pooled argument alone; 8, 8, 9, 15, 14, 9 and 3 by stop), Locked out 83,667 unchanged, tenets A to F all 0; all seasons sweep Locked 76,964 to 76,909, pooled alone 6,512 to 6,457 at 1,073 to 1,066 positions, both tenets 0. The two Champ sweeps, the cutoff history check, `take-backs 0` over 48 championships and 412 stops, the Now dump and the publisher comparison (`UL3 COMPARE CLEAN`, `R9X COMPARE CLEAN`) do not move in either task."
    - "D3: the pins that move are exactly nine tests in four files (planner finding 6), each replaced by the value the executor's own run shows and each equal to the planner's pre registered value. No pin is fitted, and any difference stops the task before the commit."
    - "D3: the full root `npx vitest run` with `REQUIRE_LOCAL_DATA=1` passes, the four typechecks (root, web, e2e, worker) are clean, and `npx wrangler deploy --dry-run` builds the Worker bundle. The Worker bundle CHANGES, as it must: `pointPool.ts` is bundled, and `securedPlayoffPoints.ts` with the `finalsBracket.ts` it imports joins the Worker's import closure (103 files to 105)."
    - "D4: the headers of `pointPool.ts` and `pooledLockInputs.ts` say the playoff pool is proven from the pay rule, carry the derivation in a few lines, name the tests that hold it and say which pools are still measured. `securedPlayoffPoints.ts` no longer says the Worker does not import it."
    - "No artifact schema change, no algorithm version change, no new todo item, nothing under `.planning/` committed, nothing pushed, nothing deployed. The Worker deploy is owed to the orchestrator."
  artifacts:
    - path: "packages/core/districts/pointPool.ts"
      provides: "mostPlayoffPointsPaid, mostSharedByWins, MOST_PLAYOFF_POINTS_PAID_BY_RULE, MOST_ROBOTS_PAID_PER_ALLIANCE, ROBOTS_CREDITED_PER_WIN, and PLAYOFF_POOL set from the bound"
      contains: "mostPlayoffPointsPaid"
    - path: "packages/core/districts/pointPool.test.ts"
      provides: "the bound's pins, the search that shares no code with the derivation, the registered season coverage, the lineup that reaches the bound"
      contains: "261013-lve"
    - path: "scripts/securedPlayoffCorpus.test.ts"
      provides: "the eighth test: the bound and the two facts of play it rests on, against every event in the corpus"
      contains: "POOL_BOUND_PINS"
    - path: "packages/core/districts/pooledLockInputs.ts"
      provides: "the header that says why the netting is sound now that the pool is proven"
      contains: "261013-lve"
    - path: "scripts/districtLocksNoTakeBack.test.ts"
      provides: "2026cthar frc2067 re read under the proven pool: Locked from Round 2, nothing taken back"
      contains: "261013-lve"
  key_links:
    - from: "packages/core/districts/pointPool.ts"
      to: "packages/core/districts/securedPlayoffPoints.ts"
      via: "the pay tables and the rounding the bound is derived from"
      pattern: "from \"./securedPlayoffPoints.js\""
    - from: "packages/core/districts/pointPool.ts"
      to: "packages/core/districts/bracket.ts"
      via: "BRACKET_SETS: every place an alliance can leave the bracket at"
      pattern: "BRACKET_SETS"
    - from: "packages/core/districts/pooledLockInputs.ts"
      to: "packages/core/districts/pointPool.ts"
      via: "PLAYOFF_POOL inside eventRemainingPool and as the cap of the netting (code unchanged)"
      pattern: "PLAYOFF_POOL"
    - from: "packages/harness/districtRankingsMerge.ts"
      to: "packages/core/districts/pooledLockInputs.ts"
      via: "pooledDistrictPoints, the publisher's and the Worker's one argument call (not edited)"
      pattern: "pooledLockInputs\\(entries\\)"
    - from: "packages/core/districts/pointPool.test.ts"
      to: "packages/core/districts/securedPlayoffPoints.ts"
      via: "playoffPointsPaid, the only thing the search asks"
      pattern: "playoffPointsPaid"
---

<objective>
Replace a measured number with a proven one in the lock math of the District Locks tab. The pooled remaining points lock assumes one district event hands out at most 213 playoff points in all. That 213 is the placement table times three robots plus a margin of 3, one above the highest total ever seen (212). The pooled test treats it as an UPPER BOUND, and a measured maximum is not one. TBA's pay rule is known exactly since quick task 261012-mw2, and under it an event can pay more: a robot's share is rounded up, so an alliance that rotates a fourth robot is paid above three times its points. This plan derives the exact maximum from the rule (CONTEXT D1), holds it by a search that shares no code with the derivation and by the corpus, makes it the pool, moves the pins the larger pool moves (D3) and rewrites the headers (D4). The other three pools are reported and not changed (D2).

Purpose: Jacob's rule. "It is mission critical that no team is told they are locked at any stop, and then later they are not locked." A pool that is too small can show a Locked that is not true. A larger pool can only take pooled locks away, which is the safe direction.

Output: two commits on `main`, unpushed. Task 1 adds the proof and moves nothing. Task 2 sets the pool from it: 216 where it was 213.
</objective>

<planner_findings>
The planner derived the bound by hand, wrote the module's derivation and the tests as a prototype, ran them, and ran every gate on scratch trees of both tasks before writing this plan. Every number below is PRE REGISTERED: the executor compares its own runs with them, reports every difference, and never fits code or a pin to them. `SCRATCH` and `LVE` are defined in the context section.

**1. The proven maximum (D1): 216 since 2024, 214 in 2023. Not 222.**

An alliance's table points are shared among its robots by the wins each was on the field for, each share rounded UP, three robots credited a win. Before rounding the shares sum to exactly three times the alliance's points, so every point above the placement table times three (210) is a rounded share, and a part share needs a fourth robot. With at most four robots an alliance:

| alliance | points over wins | best split of the wins | paid |
|---|---|---|---|
| finalist or champion | 20 over 3 semifinal wins | one robot on all three, three robots on two each: 20 + 14 + 14 + 14 | 62 |
| the same over 4 wins (the whole lower bracket) | 20 over 4 | every share a multiple of 5 | 60 |
| third place | 13 over 2 or over 3 | 13 + 13 + 7 + 7, or 13 + 13 + 9 + 5 | 40 |
| fourth place | 7 over 2 | 7 + 7 + 4 + 4 | 22 |
| the champion's two Finals wins, since 2024 | 5 a robot a win | three robots a win, never rounded | 30 |

Since 2024: (62 + 30) + 62 + 40 + 22 = 216. In 2023 the title's 10 joined the shared points and 30 over 5 or 6 wins never leaves a part share, so the champion is paid exactly 90: 90 + 62 + 40 + 22 = 214. Both finalists can hold their 20 over three wins at once (the upper final's winner, and its loser back through the lower final), so the sum is reached. The rounding gains are 2, 2, 1 and 1, not 3 each: with 20 over 3 wins one of the four robots must be on the field for all three, so only three can hold a part share.

These readings agree (the first shares no code with the repo, the search shares none with the derivation):

| reading | 2023 | 2024, 2025, 2026 |
|---|---|---|
| by hand, and `LVE/d1_closed.mjs` (every table typed by hand, no repo import) | 214 | 216 |
| the module's derivation in the prototype (`mostPlayoffPointsPaid`) | 214 | 216 |
| search through `playoffPointsPaid`, fully exhaustive and unmemoized (`LVE/d1_search.mts`, 7,159,808 calls for 2023 and 2026) | 214, at 12,288 of 32,768 brackets | 216, at 16,384 of 32,768 |
| the same search remembering an alliance's best by its own winning rows (the shipped test's form, 139,640 calls for four seasons, 0.4 s a season) | the same | the same |
| joint random search, 400,000 brackets a season, rosters of three or four, one field in fifty short a robot (`LVE/d1_random.mts`) | 214, reached 3,521 times | 216, reached 981, 923 and 959 times |

Every search: 0 refusals, and 0 brackets where the joint total differs from the sum of the parts. The least any bracket's best lineup pays is 212 in 2023 and 214 since 2024. The lineup that reaches 216: alliance 1 wins sf1, sf7 and sf11 with a different robot of its last three sitting sf7 and sf11 (30, 24, 24 and 14 with its two Finals wins), alliance 2 wins sf3, sf8 and sf13 the same way (20, 14, 14, 14), alliance 4 is third (13, 13, 9, 5) and alliance 3 fourth (7, 7, 4, 4).

The roster matters. The same derivation reads 210 at three robots an alliance, 217 and 220 at five, and 222 and 225 at nine or more; the random search with rosters up to nine reached 222 and 224. The bound is proven for four and no more (finding 10, reading R2).

**2. The corpus (D1).** `LVE/corpus_dist.mts`, read only.

| what | events | 210 | 211 | 212 | above 212 |
|---|---|---|---|---|---|
| the pay rule's total over EVERY robot, district tier, 2023 | 94 | 82 | 12 | 0 | 0 |
| the same, district tier, 2024 to 2026 | 324 | 261 | 57 | 6 | 0 |
| the same, dcmp tier in base points (raw over 3), 8 alliances, 2023 | 17 | 16 | 1 | 0 | 0 |
| the same, dcmp tier, 2024 to 2026 | 56 | 44 | 12 | 0 | 0 |
| TBA's paid total over district rows only, district tier, 2023 to 2026 | 418 | 275 | 51 | 6 | 0 (86 below 210: a robot with no district row was paid) |
| the same, every season 2016 to 2026 | 951 | 601 | 51 | 6 | 0 (293 below 210) |

No season before 2023 ever reads above 210: all 533 district tier events of 2016 to 2022 top out at exactly 210 (another bracket and another pay rule, which nothing here declares; see reading R1). The six events at 212: 2024misjo, 2026txcle, 2026njfla, 2026mabil, 2026wasam, 2026wiply. Robots credited per decisive row: 3 at 7,540 of 7,540. Robots holding a win per alliance over all 507 events: none at 994 alliances, three at 2,842, four at 132, never five. Alliance lists: three names at 3,617, four at 351, never more.

THE TIER WEIGHT DOES NOT ENTER THE POOL. The pool is base points for a district tier event, weight 1. The dcmp tier does not read this pool at all: neither `champLedgerStatus.ts` (its line 1178 says no pooled argument is passed) nor the champ pass of the merge (`districtRankingsMerge.ts` line 1102) passes one.

**3. Who reads `PLAYOFF_POOL` (line numbers at e0e8856e).**

| site | what it does | told the season or the tier? |
|---|---|---|
| `packages/core/districts/pointPool.ts` 157 | the definition | |
| `pointPool.ts` 232, `eventRemainingPool` | adds the pool for an event whose Playoffs category is open | no: `EventPoolInput` is field size, rookie count, finality |
| `packages/core/districts/pooledLockInputs.ts` 179 and 187 | calls `eventRemainingPool`; caps the netting at the pool | no; its callers hand it district tier events only |
| `apps/web/src/components/districts/districtLedgerStatus.ts` 553 | the District Locks tab's one `pooledLockInputs` call | the caller knows `artifact.year` and does not pass it |
| `packages/harness/districtRankingsMerge.ts` 688 to 700, called at 1061 | `pooledDistrictPoints`: the publisher's and the Worker's call, district tier rows only | the caller knows `season` and does not pass it |
| tests: `pointPool.test.ts`, `pointPool.reconciliation.test.ts` 147 and 171, `pooledLockInputs.test.ts`, `districtLedgerStatus.test.ts` 953 and 1123 | the last two files read it by name, not by value | |

So the pool readers are not told the season, and the pool is the LARGEST over the declared rules for every season (reading R1). It is counted once for every district tier event whose Playoffs category is open at the position, PLAYED OR NOT: at 2026cthar's stops five events of 2026ne have their Playoffs open, and the district's pool reads 4,338 where it read 4,323.

**4. The other pools (D2). Nothing is plainly understated, so nothing changes.**

| pool | rests on | closest the corpus has come (951 district tier events, 2016 to 2026) |
|---|---|---|
| selection, 236 | PROVEN: the selection formula summed over the 24 scoring picks of eight alliances | exactly 236 at 612 events, never above |
| qualification | the manual's formula, PROVEN for a real field of up to three teams more than the artifact shows; the three is MEASURED | at 0 phantom attendees 38 events over (by up to 10), at 1 one event over (by 2), at 2 and at 3 none; closest event 11 under (2022on409), then 12 (2022on273, 2017vabla) |
| awards, 78, 86, 91 by rookie count | MEASURED, and cannot be proven: an event chooses which awards it gives | exactly at the pool at 37, 45 and 70 events, never above; 91 was last reached in 2020, the maximum since 2022 is 86 |

All four pools together, with the playoff pool still at 213: the closest event sits 20 under (2019milsu).

**5. The effect (D3), measured on scratch trees of both tasks.** Gates: `SCRATCH/d7r/gates.sh`, compared by `LVE/gates_compare_lve.sh` (tested in both states and tested to fail in the wrong state).

After Task 1 (`LVE/after-t1`): `LVE GATES AS EXPECTED (none)`. Every gate is identical to the base.

After Task 2 (`LVE/after-t2`): `LVE GATES AS EXPECTED (pool)`.

| gate | reads |
|---|---|
| joint (Champ) | identical to the base, 1,304 lines |
| champ | identical to the base, 129 lines |
| ledger (all 109 seasons, 4,022 positions, 921,658 team positions) | Locked on points 76,964 to 76,909, kept 75,594 to 75,541, award qualified 1,370 to 1,368, In range 318,013 to 318,068, pooled alone 6,512 to 6,457 at 1,073 to 1,066 positions, pool total 23,694,682 to 23,771,641, tenets A and B 0 and 0 |
| settled (418 events of 2023 to 2026, 2,926 stops) | Locked blunt 36,982 to 36,931, settled 38,771 to 38,705, gained 1,789 to 1,774, lost 0, Locked out 82,092 and 83,667 unchanged, tenets A to F 0, `VIOLATIONS: none`, `SKIPPED (0)` |
| cutoff | no drift for both generated files |
| takeback | championships 48, stops 412, take-backs 0 |
| now | identical on both tabs (artifacts 109 teams 16345) |
| publisher | `UL3 COMPARE CLEAN` (119 files, differing 0), `R9X COMPARE CLEAN` (109 artifacts, differing 0) |

HOW MANY POOLED LOCKS THE LARGER POOL REMOVES. On the District Locks tab's settled run, team stop by team stop (`LVE/pool_diff.mts`, expected output `LVE/expected/pool_diff.txt`): 66 of 38,771 Locked on points displays are no longer shown, 0 are gained, and all 66 were held by the pooled argument alone. They are 47 distinct district and team pairs at 34 events.

| stop | Locked before | after | lost |
|---|---|---|---|
| Alliances final | 5,155 | 5,147 | 8 |
| Round 1 | 5,155 | 5,147 | 8 |
| Round 2 | 5,393 | 5,384 | 9 |
| Round 3 | 5,557 | 5,542 | 15 |
| Round 4 | 5,690 | 5,676 | 14 |
| Round 5 | 5,769 | 5,760 | 9 |
| Playoffs final, awards open | 6,052 | 6,049 | 3 |
| all | 38,771 | 38,705 | 66 |

By season 18, 19, 7 and 22. Of the 66, 63 are Locked again by the last stop of the same event. Take backs inside an event after the change: 0. Status differences other than a pooled Locked that is no longer shown: 0. No Locked out moves anywhere.

At Now nothing moves in a finished season: every event's pool is 0 there, and the publisher's dry run over all 109 artifacts differs at 0.

**6. The pins that move: nine tests in four files, and nothing else.** The full root suite run with ONLY the pool switched (`LVE/overlay_full.log`): `Test Files 4 failed | 356 passed (360)`, `Tests 9 failed | 9180 passed | 1 skipped (9190)`, 1,622 s. The monotone file, the walk file, every Worker test and every rendered test pass untouched.

| file | pin | before | after | why |
|---|---|---|---|---|
| `packages/core/districts/pointPool.test.ts` | `PLAYOFF_POOL` | 213 | 216 | the pool itself |
| same | a 40 team event, 0, 1 and 2 rookies | 1060, 1068, 1073 | 1063, 1071, 1076 | 3 more |
| same | only the Playoffs open; Playoffs and awards open with one rookie | 213; 213 + 86 | 216; 216 + 86 | 3 more |
| `scripts/districtLocksNoTakeBack.test.ts` | 2026cthar frc2067 status at the seven stops | Locked at all seven | In range, In range, then Locked at five | its pooled lock at the first two stops rested on a pool of 4,323; it reads 4,338 |
| same | frc2067 `lockedBy` | pooled, pooled, both x 5 | null, null, both x 5 | the same |
| same | Locked on points, blunt rule | 6, 6, 6, 6, 6, 6, 9 | 5, 5, 5, 5, 5, 5, 9 | the blunt rule held frc2067 by the pooled argument alone |
| same | Locked on points, settled rule | 6, 6, 7, 7, 8, 8, 9 | 5, 5, 7, 7, 8, 8, 9 | the same two stops |
| same | gained by the settled rule | frc7407 from Round 2, frc1699 from Round 4 | frc2067 joins both from Round 2 | the blunt rule no longer holds it |
| same | UNCHANGED: `lost` empty at every stop, pool difference 0, 0, 78, 120, 159, 181, 0, settled points, secured points, no violation, `takeBackBlunt` 0 | | | |
| same | NEW pin: the district's whole pool per stop | (4,323 x 6, 4,110) | 4,338 x 6, 4,122 | five events with their Playoffs open, then four |
| `scripts/measureLedgerTenets.test.ts` | `MEASURED_LOCKED_SHOWN` (a floor) | 76,964 | 76,909 | 55 pooled displays fewer |
| same | `MEASURED_LOCKED_BY_POOLED_ONLY` (a floor) | 6,512 | 6,457 | the same 55 |
| same | `MEASURED_POSITIONS_WITH_POOLED_ONLY_LOCK` (a floor) | 1,073 | 1,066 | |
| `scripts/districtLocksStagedReplay.test.ts` | what the credit adds on the District Locks tab, case A | `districtTabGained` 105 | 99 | six team ticks the pooled argument no longer reaches; case B stays 97, the champ counts stay 19 and 22, nothing is Locked only without the credit |

2026cthar frc2067 is the pin quick task 261009-uhb was written around, and quick task 261012-mw2's header says of it "that assertion is not weakened". It is re read now: the rule that file holds was never "Locked at Alliances final", it is that a team once Locked stays Locked, and the reference test says so on the statuses themselves.

**7. The Worker.** `pointPool.ts` and `pooledLockInputs.ts` are in the Worker's import closure already (103 files at e0e8856e). From Task 1 on `pointPool.ts` imports the pay tables, so `securedPlayoffPoints.ts` and the `finalsBracket.ts` it imports join the closure: 105 files. No import cycle (`LVE/cycle_check.cjs`: the pay rule module's closure of 12 files does not lead back to `pointPool.ts` or `pooledLockInputs.ts`). The bundler drops the credit functions: `playoffPointsPaid` and `securedPlayoffPoints` are not in the built file.

| `npx wrangler deploy --dry-run` | Total Upload | gzip |
|---|---|---|
| at e0e8856e | 1364.75 KiB | 250.93 KiB |
| Task 1 prototype | 1367.20 KiB | 252.10 KiB |
| Task 2 prototype | 1367.04 KiB | 252.04 KiB |

What changes in the Worker's behaviour: `pooledDistrictPoints` hands `computeLocksWithQualifiers` a pool that is 3 larger for every district tier event of the district whose published state has its Playoffs category open, so a published `districtLock` of `locked` can be withheld where the pooled argument alone held it. Only while a district event's Playoffs are open, so nothing at Now for a finished season (the publisher comparison above), and no district event is live. The nearest measurement of that path at rewound positions is the ledger gate: 55 of 76,964 displays over 109 seasons.

**8. The failing first runs, the reference check and the single breaks.**
- Task 1's test over the repo's `pointPool.ts`: `14 failed | 17 passed (31)` (five bound tests, eight search tests, the lineup test; `mostPlayoffPointsPaid is not a function`).
- Task 2's test over Task 1's `pointPool.ts`: `4 failed | 27 passed (31)` (the test named "is 216 ..." and the three `eventRemainingPool` pins).
- Targeted lists under the planner's overlay: Task 1 `Test Files 34 passed (34)`, `Tests 860 passed (860)`; Task 2 `Test Files 39 passed (39)`, `Tests 1020 passed (1020)`.
- Four typechecks with each task's reference laid over the repo in memory: clean in both states.
- Nine single breaks of the reference `pointPool.ts` each fail `pointPool.test.ts` (`LVE/bite.cjs`): a roster of three, a roster of five, the finalist's place dropped, the champion's Finals wins paid to two robots, the smallest over the rules, a loss that ends the walk, shares rounded down, the 2023 title points left out, the old measured pool.
- The installer was self tested in a scratch copy: installs, installs again writing nothing, holds after a comment edit, refuses a tampered pin, refuses a file another session moved and then writes nothing at all. It keeps a file's line endings (`scripts/measureLedgerTenets.test.ts` is CRLF in the working tree, the other eight are LF).
- The full root suite on the prototype of the FINAL state, all nine reference files laid over the repo in memory (`LVE/overlay_t2.log`): `Test Files 360 passed (360)`, `Tests 9205 passed | 1 skipped (9206)`, 1,736 s. That is 16 tests more than today's 9,190: 15 in `pointPool.test.ts` and 1 in the corpus gate. The three load sensitive tests passed in both of the planner's full runs.
- The exact install sequence of both tasks was rehearsed in a scratch copy and printed the four lines the tasks name.

**9. Planner files the executor uses**, all under `LVE`. Do not edit or delete them; write your own outputs under `LVE/exec/`.

| file | what it is |
|---|---|
| `install_ref.cjs` | the guarded installer of the reference files, and `--check` (its header says what the guard is) |
| `ref-t1/`, `ref-t2/` | the reference files of Task 1 and Task 2, as the prototype ran them |
| `base-files/` | the nine files as the planner read them at e0e8856e, to read a reference against |
| `gates_compare_lve.sh` | the gates compared, states `none` and `pool` |
| `expected/` | the planner's expected `ledger.txt`, `settled.txt`, `pool_diff.txt`, `notakeback.txt`, `pin_pools.txt` |
| `base/` | the planner's own gate run at e0e8856e |
| `effect_check.sh` | the District Locks effect read from the tree as it stands and held equal to `expected/` |
| `worker_expect.cjs` | what the Worker's import closure is expected to hold, `base` and `after` |
| `tree-t1/` | a scratch tree of Task 1's state (the pool still 213), which `effect_check.sh` reads as the before side |

**10. Readings the planner chose.**
- R1. THE LARGEST OVER THE RULES, for every season (216), not a pool per season. The pool readers are not told the season, a pool per season would lower 2023 by 2 and nothing else, and 2023 is finished (its remaining pool is 0). A STATED LIMIT COMES WITH IT: the proof covers the seasons with a declared pay rule, 2023 on. The seasons before 2023 played another bracket under another pay rule that nothing here declares, and the same pool is read for their rewound views. For them 216 is a measured margin and not a proof: none of their 533 district tier events handed out more than 210. The reference header of `pointPool.ts` says so.
- R2. A ROSTER OF FOUR, as D1 states it, named as a premise and held by a corpus test. It is FIRST's rule (an alliance has one opportunity to bring in a backup), the Champ Locks joint proof already rests on it (`champJointLock.ts`, THE BACKUP ROBOT RULE, quick task 261009-tx9, which quotes the manual and the alliance selection script), and the corpus has no alliance at five. `mostPlayoffPointsPaid` takes the roster as a parameter so the dependence is visible and pinned (220 at five, 225 with no limit). The planner measured what a pool with no roster premise would cost and did NOT plan it: 225 loses 273 Locked displays where 216 loses 66.
- R3. A losing finalist is paid nothing for a Finals match it won. That is the pay rule (329 of 329 measured robots), and it is not the per team ceiling `bracket.ts` keeps for second place (25, the manual's wording). A pool that also allowed the manual's wording would be 231 and lose 396 displays. Not planned: D1 asks for the maximum under the declared rule.
- R4. The derivation is a sum over the eight places an alliance can leave the bracket at, of the most an alliance leaving there can be paid. That is an upper bound whether or not the eight maxima can happen together, and the search shows they can.
- R5. Two tasks: the proof first, moving nothing, then the switch. A gate that moves in Task 1 is a defect of the proof's wiring; a gate that moves in Task 2 other than the two District Locks sweeps is a defect of the switch.

**11. Premises the code or the data contradicts.**
- P1. "up to about 222" (CONTEXT, the orchestrator's first reading). The exact maximum is 216 (214 in 2023). The rounding gains are 2, 2, 1 and 1, not 3 for each of four alliances. 222 is what the 2023 rule could pay with NO limit on an alliance's roster. Planned to the proven maximum, as D1 says the pool becomes.
- P2. "`SCRATCH/mw2/gates.sh`". There is no such file. The gates are `SCRATCH/d7r/gates.sh`. `SCRATCH/mw2/gates_compare_mw2.sh` compares against quick task 261012-mw2's expected sweeps and would report this task's expected movement as drift; this plan ships `LVE/gates_compare_lve.sh`.
- P3. "`d7r/worker_closure.mjs` must report `pointPool.ts` as bundled". It does already at HEAD. What is new is that `securedPlayoffPoints.ts` and `finalsBracket.ts` join the closure, and `securedPlayoffPoints.ts`'s header said the Worker does not import it.
- P4. "A larger pool can only REMOVE pooled locks": true, and one it removes is pinned. frc2067 at 2026cthar, the example quick task 261009-uhb's test was written around, reads In range at Alliances final and at Round 1 and Locked from Round 2 on.
- P5. The pool is not 3 larger at "the event in progress" only. It is 3 larger for every event of the district whose Playoffs category is open at the position, events not yet played included (15 at 2026cthar's stops).
- P6. The white paper's own playoff value is 213, the number the old constant produced. It is below what the rule can pay too.
</planner_findings>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/261013-lve-the-playoff-point-pool-is-the-most-the-p/261013-lve-CONTEXT.md
@.claude/CLAUDE.md

`SCRATCH` below means `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad`, and `LVE` means `SCRATCH/lve`.

RULES OF THIS CHECKOUT, for both tasks:
- Worktrees are OFF. Edit the main checkout on `main`. Stage by explicit path. Never commit anything under `.planning/`. Never push. Never deploy.
- Run every `npx` from the repo root, with one exception named in the tasks: `wrangler` lives only in `apps/worker/node_modules`, so the dry run is `npx --no-install wrangler ...` from `apps/worker`. Download nothing.
- Tests are `npx vitest run <paths>` from the repo root with `REQUIRE_LOCAL_DATA=1` in front. Never `timeout <n> pnpm ...` (it swallows the output and exits 0). Read the printed `Test Files` and `Tests` lines, never an exit code alone.
- Never Read, cat, head or echo `.env`. No command in this plan needs a credential or the network.
- Other sessions commit to this checkout. Line numbers are at e0e8856e; if a range has moved, find it by the quoted name.
- Long content goes through the Write tool, never a Bash heredoc (long prose breaks Git Bash heredocs on this machine).
- No new todo item. No artifact schema change. No algorithm version change.

<interfaces>
Existing contracts (read these, do not re-explore the files):

```ts
// packages/core/districts/securedPlayoffPoints.ts (Task 1 edits ONE header sentence; no code line changes)
export type PlayoffPayRule = "allWins" | "semifinalWins";
export const PLAYOFF_PAY_RULE_BY_SEASON: Readonly<Record<number, PlayoffPayRule>>;   // 2023 allWins; 2024, 2025, 2026 semifinalWins
export function playoffPayRule(season: number): PlayoffPayRule | undefined;          // undefined for a season with no bracket or no declared rule
export const SEMIFINAL_WIN_POINTS: Readonly<Record<string, number>>;                 // sf7, sf8: 13; sf9, sf10, sf11, sf13: 7; sf12: 6; sf1 to sf6: 0
export const FINALS_WIN_POINTS = 5;
export function proratedPlayoffPoints(points: number, teamWins: number, allianceWins: number): number;   // rounded UP, in integers
export interface PlayoffWinRow { compLevel: string; setNumber: number; matchNumber: number; winningAllianceNumber: number; winningTeams: readonly string[] }
export function playoffPointsPaid(season: number, tier: DistrictTier, allianceCount: number, rows: readonly PlayoffWinRow[]): ReadonlyMap<string, number> | undefined;

// packages/core/districts/bracket.ts (READ ONLY)
export const BRACKET_SETS: readonly BracketSet[];              // sf1 to sf13 then "f" (bestOf 3); feedA and feedB are a seed, or a set's winner or loser
export const BRACKET_REGISTERED_SEASONS: readonly number[];    // 2023, 2024, 2025, 2026
export const PLAYOFF_PLACEMENT_POINTS: readonly number[];      // 30, 20, 13, 7, 0, 0, 0, 0

// packages/core/districts/pointPool.ts TODAY
export const PLAYOFF_POOL: number;                             // 213: the placement table times three, plus a measured margin of 3
export function eventRemainingPool(event: { fieldSize: number; rookieCount: number; final: DistrictCategoryFinality }): number;

// packages/core/districts/pointPool.ts AFTER TASK 1 (PLAYOFF_POOL still 213)
export const MOST_ROBOTS_PAID_PER_ALLIANCE = 4;
export const ROBOTS_CREDITED_PER_WIN = 3;
export function mostSharedByWins(points: number, wins: number, robots?: number): number;       // (20, 3) is 62; (20, 4) is 60; (13, 2) and (13, 3) are 40; (7, 2) is 22
export function mostPlayoffPointsPaid(rule: PlayoffPayRule, robots?: number): number;          // allWins 214, semifinalWins 216; at 3 robots 210
export const MOST_PLAYOFF_POINTS_PAID_BY_RULE: Readonly<Record<PlayoffPayRule, number>>;

// packages/core/districts/pointPool.ts AFTER TASK 2
export const PLAYOFF_POOL: number;                             // Math.max over MOST_PLAYOFF_POINTS_PAID_BY_RULE: 216

// packages/core/districts/pooledLockInputs.ts (Task 2 edits its HEADER only; the code is not touched)
export function pooledLockInputs(teams: readonly PooledTeamEntry[], playoffPointsInFloorsByEvent?: ReadonlyMap<string, number>): PooledLockInputsResult;
// line 179: eventRemainingPool({ fieldSize, rookieCount, final })      line 187: Math.min(inFloors, PLAYOFF_POOL)

// NOT EDITED by this plan: packages/harness/districtRankingsMerge.ts (pooledDistrictPoints, the publisher and the Worker),
// apps/web/src/components/districts/districtLedgerStatus.ts, locks.ts, bracket.ts, every champ file, every sweep script, anything under apps/worker.
```
</interfaces>
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: The most the pay rule can pay one event, derived from the rule, reached by a search that shares no code with it and held on the corpus. The pool is not moved (D1)</name>
  <files>packages/core/districts/pointPool.ts, packages/core/districts/pointPool.test.ts, packages/core/districts/securedPlayoffPoints.ts, scripts/securedPlayoffCorpus.test.ts</files>
  <precondition>`LVE/install_ref.cjs`, `LVE/ref-t1/`, `LVE/base/` and `LVE/gates_compare_lve.sh` exist (the planner's files, same session scratchpad), and `data/corpus.sqlite` and `data/local-publish/districts` exist in the main checkout (gitignored local data).</precondition>
  <read_first>
    - .planning/quick/261013-lve-the-playoff-point-pool-is-the-most-the-p/261013-lve-CONTEXT.md (D1 to D4)
    - This plan's planner_findings 1, 2, 7, 8 and 10
    - LVE/install_ref.cjs (the header: what it writes, the guard, what --check holds)
    - LVE/ref-t1/packages/core/districts/pointPool.ts (whole: the header section added, the imports, the derivation; `PLAYOFF_POOL` is unchanged in it)
    - LVE/ref-t1/packages/core/districts/pointPool.test.ts (the two describes named for quick task 261013-lve, and the search helpers between them)
    - LVE/ref-t1/scripts/securedPlayoffCorpus.test.ts (header item 8, `POOL_BOUND_PINS`, and the test whose name starts "the playoff pool's bound and what it rests on")
    - packages/core/districts/securedPlayoffPoints.ts lines 1 to 62 and 160 to 241 (the pay rule the bound is derived from; read only but for one header sentence)
  </read_first>
  <behavior>
    The pure half, `pointPool.test.ts`, as the reference carries it:
    - The bound by rule: `MOST_PLAYOFF_POINTS_PAID_BY_RULE` equals `{ allWins: 214, semifinalWins: 216 }`, each equal to `mostPlayoffPointsPaid` of its rule.
    - At three robots an alliance the bound is the placement table times three for both rules, 210; the rule since 2024 sits 6 above it and the 2023 rule 4.
    - The parts by hand: `mostSharedByWins` reads 62 for 20 over 3, 60 for 20 over 4, 40 for 13 over 2 and over 3, 22 for 7 over 2, 90 for 30 over 5 and over 6, 60 for 20 over 5; 60, 39 and 21 at three robots; 0 with nothing to share or no win.
    - The roster premise is visible: 220 and 217 at five robots, 225 and 222 at nine and at ninety nine.
    - Every season of `BRACKET_REGISTERED_SEASONS` has a declared rule and a positive integer bound, pinned by equality as 214, 216, 216, 216, and the rules with a bound are exactly the rules some season declares.
    - THE SEARCH, per registered season: 32,768 brackets, 0 refusals, 0 brackets whose joint total differs from the sum of the parts, the most equal to `mostPlayoffPointsPaid` of the season's rule, and the pins 214 at 12,288 brackets with a least of 212 (2023) and 216 at 16,384 with a least of 214 (2024 on).
    - The random joint search, 20,000 brackets a season: 0 refusals, the most equal to the bound, reached at least once.
    - The lineup that reaches it, row by row: 216 for 2026 with the four alliances paid 30, 24, 24, 14 and 20, 14, 14, 14 and 13, 13, 9, 5 and 7, 7, 4, 4; 214 for 2023 with the champion paid 30, 30, 30; and 210 for both with every alliance on its first three.
    - Every test that was in the file before this task still passes UNEDITED, the one named "is 213 ..." included: the pool has not moved.

    The corpus half, the eighth test of `scripts/securedPlayoffCorpus.test.ts`:
    - No eight alliance event's rule total over every robot, in base points, is above the bound of its season's rule, and no district tier event's is above `PLAYOFF_POOL`.
    - No decisive row credits more than `ROBOTS_CREDITED_PER_WIN` robots, no alliance holds a win at more than `MOST_ROBOTS_PAID_PER_ALLIANCE` robots, and no alliance list names more.
    - The pins of planner finding 2: the totals by kind of event, 7,540 rows crediting three, alliances with a win at none, three and four robots 994, 2,842 and 132, lists of three and four 3,617 and 351, the most a district tier event has read 212.
  </behavior>
  <action>
Step 0, baselines, before any edit. Record `git rev-parse --short HEAD` and `git status --short` (expect only the untracked directory of this quick task; leave any other session's paths alone all task). If HEAD is not e0e8856e, run `git diff --name-only e0e8856e HEAD` and continue only if none of the nine files of this plan's `files_modified` is listed; otherwise STOP and report. Then take the base gates: run `bash SCRATCH/d7r/gates.sh LVE/exec/base` from the repo root in the background with a log (read only, no network, no credential; about four minutes on this machine; pass the tree as a `C:/` path if you pass one at all), and compare it with the planner's own base: `bash LVE/gates_compare_lve.sh LVE/base LVE/exec/base none` must end `LVE GATES AS EXPECTED (none)`. If it ends in DRIFT, another session has moved a sweep since the planner read it: STOP and report the lines. Then `node LVE/worker_expect.cjs base` must print `LVE WORKER CLOSURE AS EXPECTED (base, 103 files)`; a different count with the same four memberships is another session's file and is reported, not a stop.

Step 1, the failing test first. Copy the reference test into place by path, `cp LVE/ref-t1/packages/core/districts/pointPool.test.ts packages/core/districts/pointPool.test.ts`, and run `REQUIRE_LOCAL_DATA=1 npx vitest run packages/core/districts/pointPool.test.ts`. It must FAIL as planner finding 8 says: 14 failed and 17 passed of 31, the failures being the five bound tests, the eight search tests and the lineup test, on a function that does not exist yet. Every test the file held before must be among the 17. If the split differs, report it before going on.

Step 2, install the reference. Run `node LVE/install_ref.cjs 1` from the repo root. It must print `LVE REFERENCE INSTALLED (task 1, 4 files, 3 written)`. If it prints REFUSED, another session has moved one of the four files: STOP and report the file it names; do not write over it. What it installs, so you can read it against `LVE/base-files/`:
- `pointPool.ts` gains a header section titled for quick task 261013-lve (the derivation in a few lines, the five things the proof rests on, the search), two imports (the bracket table, and from the pay rule module its semifinal table, its Finals win value, its rounding and its rule type), the two named premises as exported constants, `mostSharedByWins` (the most one alliance's robots can be paid together where points are shared by wins, every split of the credited wins tried), the walk of every way an alliance can leave the bracket down the bracket table's own feeds, `mostPlayoffPointsPaid` (the sum over the eight places of the most an alliance leaving there can be paid) and `MOST_PLAYOFF_POINTS_PAID_BY_RULE`, a `Record` over the rule type so a new rule kind cannot be added without its line. `PLAYOFF_POOL` and the constants it is built from are NOT touched in this task, and the header says so in capitals.
- `securedPlayoffPoints.ts` changes one header sentence: it said the Worker does not import the module, and from this commit `pointPool.ts` reads its tables, so the Worker bundles those; it still calls neither of the two credit functions. No code line changes.
- `scripts/securedPlayoffCorpus.test.ts` gains header item 8, two imports, `POOL_BOUND_PINS` and the eighth test, placed directly before the season coverage test.

Step 3, read what was installed and make every comment true at this commit. Read the four files through. Where a comment states a date or a count your own runs do not show, correct the comment (a comment may be edited; a code line or a pinned value may not). Then `node LVE/install_ref.cjs 1 --check` must print `LVE REFERENCE CHECK HOLDS (task 1, 4 files)`.

Step 4, verify. Run the verify command (about ten minutes: run it in the background with a log, or in two or three foreground calls of at most 600000 ms each). Read the printed lines. What must be true, in order: the reference check holds; the targeted tests pass with the planner's totals (34 files, 860 tests; report a different count with its cause); the gates compare ends `LVE GATES AS EXPECTED (none)`, which is this task's whole claim that nothing moved; `LVE WORKER CLOSURE AS EXPECTED (after, 105 files)`; the four typechecks are clean; the Worker bundle builds (planner: Total Upload 1367.20 KiB, gzip 252.10 KiB; report yours) and `LVE_TASK1_OK` is printed. THE WORKER BUNDLE CHANGES IN THIS TASK AND THAT IS EXPECTED: do not treat the two new files in its closure as a failure.

STOP RULES. If a gate reads DRIFT in this task, the proof's wiring has changed behaviour: stop before committing and report the lines; do not move a pin. If a pin of the corpus test differs from your run, stop and report both values: the corpus or the loader has moved since the planner read it, and the pin is not to be fitted. If the search does not reach the bound or reads above it, stop: that is the finding this task exists to catch.

Step 5, commit. Stage the four files by explicit path, confirm `git diff --cached --stat` lists exactly those four, commit `feat(261013-lve): the most TBA's playoff pay rule can pay one event, derived from the rule and reached by a search that shares no code with it`, then run `git status --short`. Do not push. Do not commit anything under `.planning/`.
  </action>
  <verify>
    <automated>S="C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad" && node "$S/lve/install_ref.cjs" 1 --check && REQUIRE_LOCAL_DATA=1 npx vitest run packages/core/districts/pointPool.test.ts packages/core/districts/pointPool.reconciliation.test.ts packages/core/districts/pooledLockInputs.test.ts packages/core/districts/locks.test.ts packages/core/districts/securedPlayoffPoints.test.ts scripts/securedPlayoffCorpus.test.ts packages/harness/districtRankingsMerge.test.ts apps/worker && bash "$S/d7r/gates.sh" "$S/lve/exec/after-t1" && bash "$S/lve/gates_compare_lve.sh" "$S/lve/exec/base" "$S/lve/exec/after-t1" none && node "$S/lve/worker_expect.cjs" after && npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx tsc --noEmit -p apps/worker/tsconfig.json && (cd apps/worker && npx --no-install wrangler deploy --dry-run --outdir "$S/lve/exec/wr-t1") && echo LVE_TASK1_OK</automated>
  </verify>
  <done>The reference test failed first with the planner's split and passes after the install. `LVE REFERENCE CHECK HOLDS (task 1, 4 files)`. The targeted tests pass and the corpus gated groups RAN (no skipped line). `LVE GATES AS EXPECTED (none)`: no sweep, no cutoff, no take back count, no Now dump and no published artifact moved. `LVE WORKER CLOSURE AS EXPECTED (after, 105 files)`, the four typechecks clean, the Worker bundle built, `LVE_TASK1_OK` printed. One commit holds exactly the four files of this task. `PLAYOFF_POOL` still reads 213. `LVE/exec/base/` holds the base gates taken before the first edit.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: The pool is the bound, 216 where it was a measured 213; the pins it moves are read from the run; the headers say what is proven and what is measured (D1, D2, D3, D4)</name>
  <files>packages/core/districts/pointPool.ts, packages/core/districts/pointPool.test.ts, packages/core/districts/pooledLockInputs.ts, packages/core/districts/pointPool.reconciliation.test.ts, scripts/districtLocksNoTakeBack.test.ts, scripts/measureLedgerTenets.test.ts, scripts/districtLocksStagedReplay.test.ts</files>
  <precondition>Task 1 is committed, `LVE/exec/base/exit.txt` exists (the base gates of Task 1's Step 0), and `LVE/ref-t2/`, `LVE/expected/`, `LVE/effect_check.sh` and `LVE/tree-t1/` exist.</precondition>
  <read_first>
    - This plan's planner_findings 3, 4, 5, 6, 7 and 11
    - LVE/ref-t2/packages/core/districts/pointPool.ts (whole: the header as it ends, and the one definition that changes)
    - LVE/ref-t2/packages/core/districts/pooledLockInputs.ts lines 24 to 100 (the header; the code below it is the repo's, untouched)
    - LVE/ref-t2/scripts/districtLocksNoTakeBack.test.ts (whole)
    - LVE/ref-t2/packages/core/districts/pointPool.test.ts (the describe named `PLAYOFF_POOL` and the `eventRemainingPool` describe)
    - LVE/gates_compare_lve.sh and LVE/effect_check.sh (their headers)
  </read_first>
  <behavior>
    - `PLAYOFF_POOL` is 216, equal to the largest of `MOST_PLAYOFF_POINTS_PAID_BY_RULE` and to the placement table times three plus 6, and at or above the bound of every registered season's rule; a registered season with no declared rule fails this test by name.
    - `eventRemainingPool` for a 40 team event reads 1063, 1071 and 1076 at 0, 1 and 2 rookies (533 + 236 + 216 + 78 for the first), 216 with only the Playoffs open, and 216 + 86 with the Playoffs and the awards open and one rookie.
    - `pooledLockInputs.test.ts` and `districtLedgerStatus.test.ts` pass UNEDITED: they read the pool by name.
    - 2026cthar frc2067 (corpus gated): In range, In range, then Locked on points at the five stops from Round 2, never by award, `lockedBy` null, null, then both five times; the first Locked stop is the third, and every stop after it is Locked. The district's pool reads 4,338 at the first six stops and 4,122 at the last. What the pool loses to the floors is unchanged: 0, 0, 78, 120, 159, 181, 0. Locked on points reads 5, 5, 5, 5, 5, 5, 9 under the blunt rule and 5, 5, 7, 7, 8, 8, 9 under the settled rule; `lost` is empty at every stop; the settled rule gains frc2067 and frc7407 from Round 2 and frc1699 from Round 4; no violation and no blunt take back.
    - The all seasons sweep's floors: Locked shown 76,909, pooled alone 6,457 at 1,066 positions, with both tenets at 0.
    - The staged replay: what the credit adds on the District Locks tab in case A is 99 team ticks; case B stays 97, the champ counts stay 19 and 22, and nothing is Locked only without the credit.
    - The reconciliation: the pool is above the highest playoff total ever handed out (212), and the totals at 210 and above are printed by value.
  </behavior>
  <action>
Step 1, the failing test first. Copy the reference test into place by path, `cp LVE/ref-t2/packages/core/districts/pointPool.test.ts packages/core/districts/pointPool.test.ts`, and run `REQUIRE_LOCAL_DATA=1 npx vitest run packages/core/districts/pointPool.test.ts`. It must FAIL as planner finding 8 says: 4 failed and 27 passed of 31, the four being the test named "is 216 ..." and the three `eventRemainingPool` pins, each on 213 where 216 is expected.

Step 2, install the reference. Run `node LVE/install_ref.cjs 2`. It must print `LVE REFERENCE INSTALLED (task 2, 7 files, 6 written)`. If it prints REFUSED, STOP and report the file it names. What it installs:
- `pointPool.ts`: `PLAYOFF_POOL` becomes the largest of the bounds by rule. The measured margin, the robots per alliance constant and the placement table import they needed are removed. The header's table and its first section are rewritten to say which pools are PROVEN and which are MEASURED (D2, D4: selection and playoffs proven, the award pool measured and not provable because an event chooses its awards, the qualification pool's three phantom attendees measured), the section of Task 1 loses its "still 213 at this commit" sentence and gains why the pool is the largest over the rules for every season and what the larger pool costs. No function of Task 1 changes.
- `pooledLockInputs.ts`: HEADER ONLY. The paragraph that said the pool is "the measured maximum" now says it is proven, with the bound in a few lines, the tests that hold it, why the same sentence covers the secured minimums of quick task 261012-mw2, and which pools are still measured. No code line changes: the Worker's and the publisher's call is the same call.
- `pointPool.test.ts`: the describe named `PLAYOFF_POOL` and the `eventRemainingPool` pins at their new values.
- `pointPool.reconciliation.test.ts`: the constants' doc says 212 is what has been SEEN and the pool is proven above it; the playoff test asserts the pool is above 212 and prints the totals by value.
- The three files whose pins the larger pool moves (planner finding 6), each with the old value kept in a comment beside the new one and the reason.

Step 3, THE PINS ARE READ FROM YOUR RUN, NOT TAKEN ON TRUST. The reference carries the planner's values. Your run must show the same values before you keep them:
- Run the gates into `LVE/exec/after-t2` and compare with state `pool`. `LVE GATES AS EXPECTED (pool)` means your ledger and settled sweeps equal the planner's expected outputs line for line, so 76,909, 6,457 and 1,066 are your run's numbers and the three floors of `measureLedgerTenets.test.ts` equal them (a floor that was merely low enough would pass the test, which is why the sweep's own output is what is compared).
- Run `bash LVE/effect_check.sh LVE/exec/effect`. `LVE EFFECT AS EXPECTED` means your tree reads frc2067's seven stops, the district's pool at each, and the whole per stop table of planner finding 5 exactly as the planner's prototype did: 66 lost, 0 gained, all 66 by the pooled argument alone, 0 take backs inside an event, 0 other status differences.
- Run the targeted tests. The staged replay's case A count is asserted by equality, so a green run is your run showing 99.
If ANY of these differs, STOP before committing and report the differing lines with both values. Never edit a pin, a floor or an expected file to make a difference go away, and never change a lock rule to meet a pin. A difference means the local data, another session or the reference is not what the planner read, and the orchestrator decides.

Step 4, read what was installed and make every comment true at this commit. Read the headers of `pointPool.ts` and `pooledLockInputs.ts` and the header of `scripts/districtLocksNoTakeBack.test.ts` through against your own runs: the counts of "WHAT IT COSTS" (66 of 38,771; 8, 8, 9, 15, 14, 9 and 3; 63 Locked again; 55 of 76,964 over the 109 seasons) must be the counts your runs printed. Correct a comment that is not; then `node LVE/install_ref.cjs 2 --check` must print `LVE REFERENCE CHECK HOLDS (task 2, 9 files)`.

Step 5, the rest of the verify command (about twelve minutes: background with a log, or in foreground calls of at most 600000 ms): the worker closure (`LVE WORKER CLOSURE AS EXPECTED (after, 105 files)`), the four typechecks, the Worker bundle (planner: Total Upload 1367.04 KiB, gzip 252.04 KiB) and `LVE_TASK2_GATES_OK`.

Step 6, the full root suite, in the background with a log: `REQUIRE_LOCAL_DATA=1 npx vitest run` redirected to `LVE/exec/full-t2.log` (about 27 minutes; the monotone file alone is most of it). Read the `Test Files` and `Tests` lines. Expected: 360 files and 9,206 tests, all passed but the 1 skip (`packages/ingest/rankingsLive.test.ts`, which needs the network). THREE TESTS ARE LOAD SENSITIVE and none of them reads the pool: `spr.test.ts` "frc4414 at 2026cc_qm69" and two in `DistrictLedger.test.tsx`. If only those fail, run their two files alone, and if they pass alone run the full suite once more with nothing else running; report every run. Any other failure: STOP before committing and report the test with its message. Keep the machine awake for the run (a sleep in the middle reads as a timeout).

Step 7, commit. Stage the seven files by explicit path, confirm `git diff --cached --stat` lists exactly those seven, commit `fix(261013-lve): the playoff pool is the most the pay rule can pay, 216 and proven, where it was a measured 213`, then run `git status --short` and `git log --oneline origin/main..main`. Do not push. Do not deploy the Worker: that is the orchestrator's, after it has read the SUMMARY. Do not commit anything under `.planning/`.

Do not edit `packages/harness/districtRankingsMerge.ts`, `apps/web/src/components/districts/districtLedgerStatus.ts`, `locks.ts`, `bracket.ts`, any champ file, any sweep script, any artifact schema, any algorithm version constant or anything under `apps/worker`. `awardPool`, `qualificationPool`, `QUAL_POOL_PHANTOM_ATTENDEES` and `SELECTION_POOL` keep their values (D2).
  </action>
  <verify>
    <automated>S="C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad" && node "$S/lve/install_ref.cjs" 2 --check && REQUIRE_LOCAL_DATA=1 npx vitest run packages/core/districts/pointPool.test.ts packages/core/districts/pointPool.reconciliation.test.ts packages/core/districts/pooledLockInputs.test.ts packages/core/districts/locks.test.ts packages/core/districts/securedPlayoffPoints.test.ts scripts/securedPlayoffCorpus.test.ts packages/harness/districtRankingsMerge.test.ts apps/web/src/components/districts/districtLedgerStatus.test.ts scripts/districtLocksNoTakeBack.test.ts scripts/measureLedgerTenets.test.ts scripts/measureLedgerSettledTenets.test.ts scripts/districtLocksStagedReplay.test.ts apps/worker && bash "$S/d7r/gates.sh" "$S/lve/exec/after-t2" && bash "$S/lve/gates_compare_lve.sh" "$S/lve/exec/base" "$S/lve/exec/after-t2" pool && bash "$S/lve/effect_check.sh" "$S/lve/exec/effect" && node "$S/lve/worker_expect.cjs" after && npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx tsc --noEmit -p apps/worker/tsconfig.json && (cd apps/worker && npx --no-install wrangler deploy --dry-run --outdir "$S/lve/exec/wr-t2") && echo LVE_TASK2_GATES_OK</automated>
    <automated>S="C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/d06c3f87-c452-46ba-bb8c-81f2dc3e1ec5/scratchpad"; REQUIRE_LOCAL_DATA=1 npx vitest run > "$S/lve/exec/full-t2.log" 2>&1; grep -a -E "Test Files|Tests " "$S/lve/exec/full-t2.log"</automated>
  </verify>
  <done>The reference test failed first with the planner's split. `LVE REFERENCE CHECK HOLDS (task 2, 9 files)`. The targeted tests pass (planner: 39 files, 1,020 tests) and the corpus gated groups RAN. `LVE GATES AS EXPECTED (pool)`: the two District Locks sweeps equal the planner's expected outputs and every other gate equals the base. `LVE EFFECT AS EXPECTED`. `LVE WORKER CLOSURE AS EXPECTED (after, 105 files)`, the four typechecks clean, the Worker bundle built, `LVE_TASK2_GATES_OK` printed. The full root suite shows no failure in its totals (every run reported if a load sensitive test needed a second). One commit holds exactly the seven files of this task. `PLAYOFF_POOL` reads 216. Nothing is pushed and nothing is deployed.</done>
</task>

</tasks>

<verification>
- `node LVE/install_ref.cjs 2 --check` prints `LVE REFERENCE CHECK HOLDS (task 2, 9 files)`: every code line and every pin is the reference's, comments aside.
- `REQUIRE_LOCAL_DATA=1 npx vitest run packages/core/districts/pointPool.test.ts`: the bound by rule is 214 and 216, the search over 32,768 brackets reaches it and never passes it for every registered season, the pool is 216.
- `REQUIRE_LOCAL_DATA=1 npx vitest run scripts/securedPlayoffCorpus.test.ts packages/core/districts/pointPool.reconciliation.test.ts`: no event of the corpus is above the bound, no row credits four robots, no alliance is paid at five; the gated groups RAN.
- `bash LVE/gates_compare_lve.sh LVE/exec/base LVE/exec/after-t1 none` prints `LVE GATES AS EXPECTED (none)` and `bash LVE/gates_compare_lve.sh LVE/exec/base LVE/exec/after-t2 pool` prints `LVE GATES AS EXPECTED (pool)`, each with `cutoff: no drift for both generated files`, `takeback: championships 48, stops 412, take-backs 0`, `now: identical on both tabs (artifacts 109 teams 16345)`, `UL3 COMPARE CLEAN` and `R9X COMPARE CLEAN`.
- `bash LVE/effect_check.sh LVE/exec/effect` prints `LVE EFFECT AS EXPECTED`: 66 pooled locks no longer shown, 0 gained, 0 take backs, 0 other differences.
- `npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx tsc --noEmit -p apps/worker/tsconfig.json && echo TYPECHECKS_OK` prints the sentinel.
- From `apps/worker`, `npx --no-install wrangler deploy --dry-run --outdir LVE/exec/wr-t2` builds the bundle; `node LVE/worker_expect.cjs after` prints `LVE WORKER CLOSURE AS EXPECTED (after, 105 files)`.
- The full root `REQUIRE_LOCAL_DATA=1 npx vitest run` passes; verified by the printed totals, never by an exit code alone and never through `timeout <n> pnpm ...`.
- The two commits touch only the nine files of `files_modified`. Nothing under `apps/worker`, no schema file, no version file, nothing under `.planning/`.
- `.env` is never read, printed or passed to a command. Nothing is pushed. Nothing is deployed.
</verification>

<success_criteria>
- The District Locks pooled test rests on a playoff pool no event that follows TBA's declared pay rule can exceed: 216, derived from the rule, reached by an independent search and not passed by it, and 4 above the highest total ever handed out. For the seasons before 2023, which have no declared rule, the same 216 is a measured margin of 6, and the header says so.
- The proof's footing is named and held: the declared pay rule, the eight alliance bracket, three robots credited a win, four robots paid on an alliance. A fifth robot paid on one alliance, a row crediting four, a registered season with no declared rule or a rule kind with no derived bound each turns a test or the typecheck red.
- The cost is stated and measured: 66 of 38,771 Locked on points displays over the playoff stops of four seasons, every one a pooled only lock, none gained, nothing taken back, nothing at Now.
- The Champ Locks tab, the cutoff tables, the published artifacts of the 109 finished seasons and every lock rule other than the size of one pool are what they were.
- The readings R1 to R5 and the contradicted premises P1 to P6 are recorded in the SUMMARY.
</success_criteria>

<output>
Produce `.planning/quick/261013-lve-the-playoff-point-pool-is-the-most-the-p/261013-lve-SUMMARY.md` with `requirements_completed: [261013-lve]` only when `LVE_TASK2_GATES_OK` was printed and the full suite's totals show no failure. It carries: the base commit and the two commit hashes; the proven maximum per season with the derivation in a few lines; the search's size and result per season; the corpus distribution; the reader list; the table of D2 (proven or measured, and the closest the corpus has come); the gate lines of both tasks as printed; the per stop table of the effect from your own `LVE/exec/effect/pool_diff.txt` beside planner finding 5, with every difference named; every pin moved with its value before, after and why; the Worker closure line and the two dry run totals; the full suite totals of every run; readings R1 to R5 and premises P1 to P6; and under "What is owed": a push, then a Worker deploy by the orchestrator (the bundle changed; no district event is live; `npx wrangler deploy` from a clean tree), no republish (no published artifact moved), and the live e2e specs after the deploy. State the limits plainly: the bound is proven for four robots an alliance and rests on TBA's pay rule as declared; it is proven for the seasons with a declared rule (2023 on) and is a measured margin for the seasons before; the award pool and the qualification pool's margin are still measured.

If a gate stopped the task, the SUMMARY leads with that gate, its lines, and what was and was not committed. If the harness blocks writing a SUMMARY.md from a subagent, return the full SUMMARY text to the orchestrator instead; do not route around the block through Bash. Make no STATE.md edit and no todo. Never commit `.planning/` files; worktrees are off; stage by explicit path; check `git status --short` after each commit; do not push; do not deploy.
</output>
