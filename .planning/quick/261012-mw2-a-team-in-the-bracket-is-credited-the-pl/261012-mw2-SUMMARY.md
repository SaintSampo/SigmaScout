---
phase: quick-261012-mw2
plan: 01
subsystem: districts
tags: [champ-locks, district-locks, lock-math, playoff-points, secured-minimum, pay-rule, joint-proof, flicker, display]
status: complete
requires: [261010-l0s, 261010-d7r, 261010-66y, 261009-vp9, 261009-tx8, 261009-kt3, 261009-2tr, 261008-26o]
provides:
  - "playoffPointsPaid: TBA's playoff pay rule (by wins), declared per season, equal to every paid value of 2023 to 2026"
  - "securedPlayoffPoints: the least a robot can still be paid, a proven lower bound held by a corpus gate"
  - "securedElimByTeamFor, openPlayoffBounds, securedBeyondPosted, rowCountedPoints: the tab's reader and the bounds rules"
  - "the credit in both status modules' floors, in the pooled test and in the joint proof, withheld from the proof for a pick no alliance selection points confirm"
  - "the larger of TBA's number and the secured minimum wherever a Playoffs category reads final"
  - "the at least line of an open Playoffs cell and the methodology paragraph"
  - "the least a total may print: no printed total or median below what the lock math counts"
  - "attachRequestFacts: the milestones, the championship's bracket facts and the secured minimums per run request, run landed or not"
affects: [apps/web District Locks tab, apps/web Champ Locks tab, apps/web methodology page, packages/core/districts]
tech-stack:
  added: []
  patterns:
    - "a rule read from a third party's public source, then fitted exactly against every paid value in the corpus before anything rests on it"
    - "a lower bound held by an always on corpus gate at every position, in two orders, on the rule and on the tab's own reader"
    - "facts of a request laid onto the result map per request, so a result in flight cannot take a verdict back"
    - "a display rule fed as an optional least, so nothing but print can read it"
key-files:
  created:
    - packages/core/districts/securedPlayoffPoints.ts
    - packages/core/districts/securedPlayoffPoints.test.ts
    - scripts/securedPlayoffCorpus.test.ts
    - apps/web/src/components/districts/useDistrictLedgerData.flight.test.tsx
  modified:
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerStatus.ts
    - apps/web/src/components/districts/champLedgerRows.ts
    - apps/web/src/components/districts/champLedgerStatus.ts
    - apps/web/src/components/districts/useDistrictLedgerData.ts
    - apps/web/src/components/districts/LedgerParts.tsx
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/districts/districtLedgerCopy.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - scripts/measureChampJointLocks.ts
    - scripts/measureLedgerSettledTenets.ts
    - scripts/champJointMonotone.test.ts
    - scripts/champFieldStagedWalk.test.ts
    - scripts/districtLocksStagedReplay.test.ts
    - scripts/districtLocksNoTakeBack.test.ts
decisions:
  - "TBA pays by WINS, not by matches played: the CONTEXT's candidate rule was refuted by measurement (above TBA at 156 robots) and never built"
  - "the floor of a Playoffs category that reads final is the LARGER of TBA's number and the secured minimum (the orchestrator, 2026-10-12)"
  - "the joint proof is not handed the credit of a pick with no alliance selection points at the key: handing it raised 12 bounds on the 2023 PNW live walk"
  - "no credit at a divisioned championship's finals event and none for a backup no alliance list names"
  - "no tier entry, no credit at the live position (CONTEXT D7); the District Locks tab now names the district tier of its events so the rule does not take its live credit away"
  - "the print rule is display only and is fed as an optional least; the verdict drawer is not handed it"
  - "countedAtPosition reads no Playoffs floor at a finals key, the header's own predicate, so the row, the header and the status floor agree"
metrics:
  duration: "three executor runs: A (Tasks 1 to 3), B (Task 4), C (Tasks 5 to 7, about three hours of work, two of them full suite runs, across a ten and a half hour sleep of the machine)"
  completed: 2026-10-13
  tasks: 7
  commits: 7
  files: 32
actuals:
  tokens: 143806
  tasks: 7
  commits: 7
---

# Quick task 261012-mw2: a team in the bracket is credited the playoff points it has already secured

A team still playing in a playoff bracket now carries, in its floor on both Locks tabs, the playoff points its wins have already secured, measured against TBA's own pay rule and held as a proven lower bound. The page says what the lock math counts, and a live re run no longer takes a Locked back for its duration. History only gained locks: 466 team stops on Champ Locks and 1,287 on District Locks, none lost.

## The owner's question and the measured answer

Jacob, 2026-10-12, on the live Champ Locks tab: "In FNC 2026 DCMP round 5 why is 4561 not locked, even though they have more points than 3506 and 2724 who are locked?" Then: "any team in the bracket should be credited with the points that they essentially have already earned, given the matches they have played."

The answer had two halves. frc4561 was a finalist, and a finalist cannot finish below second place (60 at a District Championship), yet the lock math counted nothing for a team's playoffs until its alliance was knocked out. Being knocked out raised a floor and staying in did not. And the page's "earned" figure left out settled playoff points the lock math counted, so frc2724 looked 11 behind frc4561 and was 28 ahead.

2026 FNC, Round 5, 15 slots (`locks_diff.mts`, this tree against 9a6c9fae, read again at the last commit):

| Team | Floor before | Floor after | Ceiling | Joint bound before | After | Status before | After |
| --- | --- | --- | --- | --- | --- | --- | --- |
| frc4561 (alliance 2, finalist) | 232 | 292 | 367, unchanged | 16 | 11 | In range | Locked (ceiling and joint) |
| frc2724 (alliance 4, out in third) | 260 | 260 | 305 | 12 | 12 | Locked | Locked (joint) |
| frc3506 (alliance 3, out, paid 0) | 243 | 243 | 288 | 14 | 14 | Locked | Locked (joint) |
| frc4795 | 244 | 304 | 379 | 14 | 11 | Locked | Locked (ceiling and joint) |
| frc9496 | 259 | 319 | 394 | 12 | 11 | Locked | Locked (ceiling and joint) |
| frc9032 | 259 | 319 | 394 | 12 | 11 | Locked | Locked (ceiling and joint) |
| frc7763 (sat one win out) | 103 | 145 | 238 | 50 | 31 | Out of range | Out of range |
| frc6639 (no alliance selection points) | 101 | 122 | 236 | 52 | 52 | Out of range | Out of range, credit withheld from the proof |

The earned figure the page prints is now the floor: frc4561 reads 292 earned and frc2724 reads 260 earned, where the live site prints 232 and 221.

## Commits (all on `main`, unpushed, seven ahead of `origin/main`)

| Hash | Subject | Run, task |
| --- | --- | --- |
| `f5c3ca44` | feat(261012-mw2): TBA's playoff pay rule, measured against every paid value, and the least a robot can still be paid, read by the Locks rows | A, 1 |
| `1fe354e1` | feat(261012-mw2): Champ Locks counts the playoff points a team in the bracket has secured, and 2026 FNC frc4561 is Locked at Round 5 | A, 2 |
| `946c9e47` | feat(261012-mw2): District Locks counts the playoff points a team in the bracket has secured, in the ceiling test and the pooled test | A, 3 |
| `a1d33f2e` | test(261012-mw2): no floor drops over any walked edge, the forced awards flag reading loses nothing, and with the credit switched off the walks read as they did | B, 4 |
| `efa06869` | feat(261012-mw2): an open Playoffs cell reads at least the points a team has secured, and the methodology says how a robot that sat out is paid | C, 5 |
| `0c0db62b` | feat(261012-mw2): no total or median is printed below what the lock math already counts for that row or team | C, 6 |
| `b1fc2566` | fix(261012-mw2): a run in flight takes no Locked back, and both Locks tabs credit a team in the bracket with the playoff points it has secured | C, 7 |

## The pay rule, in full, and where it comes from

It is TBA's rule and not this code's. It was read from The Blue Alliance's public source (`district_helper.py`: `_calc_elim_match_points_2023` and `_calc_elim_match_points`; `district_point_values.py`) and then fitted exactly to 11,991 team values over the 507 district points events of 2023 to 2026 that carry an alliance list. This code does not control it. If TBA changes it, a credit can be wrong in either direction, and the corpus gate is what would show it.

- Only a decisive semifinal or Finals row counts. A tie, a loss and an unplayed row count for nobody.
- A decisive row is credited to the alliance that won it and to the three robots on the field for the winner.
- Winning a semifinal set adds table points to the alliance. Eight alliance bracket: 13 for sf7 and sf8; 7 for sf9, sf10, sf11 and sf13; 6 for sf12; 0 for sf1 to sf6. Four alliance finals of a divisioned championship: 10 for sf3 and for sf5, 0 for the others.
- SINCE 2024: a robot is paid its alliance's table points times its own semifinal wins over its alliance's semifinal wins, rounded UP, plus 5 for each Finals win it was on the field for where its alliance won the Finals. The sum is then multiplied by the tier weight (3 at a District Championship, a division and a finals event). The rounding comes before the weight.
- IN 2023: the title added 10 to the alliance's points, and a robot was paid the whole of that times ALL its wins (Finals wins included) over all its alliance's wins, rounded up, then times the weight.
- A robot's alliance is the alliance of the row it won. A listed pick that never played and a robot on the field only for losses are paid nothing.

The rule is declared per season (`PLAYOFF_PAY_RULE_BY_SEASON`: 2023 `allWins`, 2024 to 2026 `semifinalWins`). A season with no declared rule is credited nothing, and a unit test fails when a bracket season is registered without one, telling the person registering it to read that season's district playoff point rule first.

The fit table (run A's run of `scripts/securedPlayoffCorpus.test.ts`): 507 events, 11,991 team values, exactly equal 11,991, rule above paid 0, rule below paid 0. Two district events with no alliance list are not compared.

| Kind | Events | Teams | Paid above 0 | Equal | Above | Below | No district row |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2023 rule, district tier, 8 alliances | 94 | 2,255 | 1,119 | 2,255 | 0 | 0 | 63 |
| 2023 rule, dcmp single, 8 alliances | 7 | 176 | 85 | 176 | 0 | 0 | 0 |
| 2023 rule, dcmp division, 8 alliances | 10 | 244 | 121 | 244 | 0 | 0 | 0 |
| 2023 rule, dcmp finals, 4 alliances | 1 | 9 | 6 | 9 | 0 | 0 | 4 |
| 2023 rule, dcmp finals, 2 alliances | 3 | 16 | 9 | 16 | 0 | 0 | 2 |
| 2024 on, district tier, 8 alliances | 324 | 7,837 | 3,873 | 7,837 | 0 | 0 | 165 |
| 2024 on, dcmp single, 8 alliances | 26 | 651 | 322 | 651 | 0 | 0 | 0 |
| 2024 on, dcmp division, 8 alliances | 30 | 738 | 366 | 738 | 0 | 0 | 0 |
| 2024 on, dcmp finals, 4 alliances | 3 | 28 | 18 | 28 | 0 | 0 | 11 |
| 2024 on, dcmp finals, 2 alliances | 9 | 37 | 27 | 37 | 0 | 0 | 21 |

What the rule is not: the CONTEXT's candidate (the placement value times the matches a robot played over the matches its alliance played). Of the 694 robots that sat out a row it is exact at 359, ABOVE what TBA paid at 156 and below at 179. It was refuted and never built.

The examples that started the task, by the measured rule: 2026nccmp frc7763 was on the field for two of three semifinal wins and both Finals wins, 3 times (14 plus 10), 72 of 90. frc6639 on the same alliance, one of three, 21. 2026pncmp frc3663, one of two semifinal wins, 3 times 4, 12 of 21.

## The secured minimum and its corpus gate

For a robot with a win at a position, the secured minimum is the least the pay rule can end at over every way the rest of the bracket can go, with the robot on the field for no further win and its alliance walked down every path still open. Nothing is capped by hand: only wins pay, a semifinal set is one decisive row however many times a tie is replayed, and a Finals series ends at the second win. Since 2024 the minimum is the alliance winning nothing more; in 2023 a later win without the robot dilutes its share, so the minimum sits lower.

The gate, always on under `REQUIRE_LOCAL_DATA=1` (`scripts/securedPlayoffCorpus.test.ts`, 7 tests):

- On the rule: 507 events, 16,094 positions (every prefix of every event's decisive rows, in schedule order and in clock order), 222,863 team positions, 90,965 with a credit above 0: ABOVE the final payment 0, lower than at the position before 0. Two positions are refused and credit nothing (`2023mawor` in clock order, where sf5's timestamp is before sf1's).
- On the tab's own reader (`securedElimByTeamFor`): 491 events, 7,987 positions, 45,513 credits summing 762,821, largest 90: above 0, lower 0, all to listed picks.
- Season coverage (a D7 addendum): the loader's seasons come from `BRACKET_REGISTERED_SEASONS` with no hard coded year, and every registered season with finished brackets in the corpus must have an event compared in each gate. Compared today: 115, 119, 125 and 148 events for 2023 to 2026. With the loader made to skip a season the test fails naming it.
- The pure half (`securedPlayoffPoints.test.ts`, 22 tests): hand built brackets, every refusal, the integer rounding against TBA's float order on 1,804 combinations, and an independent enumeration of every completion of 200 seeded brackets per season.
- Twelve single breaks of the module each fail a test (the planner's reading).

## Where the credit counts, and where it is withheld

- The FLOOR of a team's Playoffs category, on both tabs, wherever the category is open: `openPlayoffBounds` is the one rule. The secured minimum is the floor and the rest of the most the category can pay is the ceiling. No ceiling moves: what joins the floor leaves the open ceiling.
- The ceiling test and the header on both tabs read it for every team.
- The pooled test on District Locks nets it off the event's playoff pool, as the settled points already were.
- The joint proof is handed it for the team itself and for confirmed picks. A rival's reach is unchanged (what joins its floor leaves its extra), so every bound of after this task is the proof of before asked at a higher own floor.
- WITHHELD from the joint proof: a pick with no alliance selection points at the key, while that key's Playoffs are open. Handing it there read 12 bounds higher on the 2023 PNW live walk. The ceiling test and the header still read that pick's credit (frc6639 above).
- NO credit at a divisioned championship's finals event (96 robot stops would hold one, and at none is the team not already Locked), none for a backup no alliance list names, and none for the whole event wherever the bracket cannot be read whole (fewer than eight alliances of three, a team on two lists, a decisive row that does not map to two different alliances, a season with no declared rule).
- The published verdicts (the Worker's merge) are not changed.

## The larger of the two, and the forced reading

The orchestrator's decision of 2026-10-12: TBA's number does not replace the credit. Wherever a Playoffs category reads final, the floor is the LARGER of TBA's posted number and the secured minimum, and the paid pick rule of quick task 261010-l0s reads the same larger of the two. It adds no assumption (the credit already claims TBA will pay at least that much) and removes the reliance on WHEN the points post.

At every stop over a finished event the number is at or above the secured minimum, so nothing moves there. What it changed is the forced awards flag reading of `scripts/champJointMonotone.test.ts` (a division's awards flag written true by hand with no playoff point on any row, then the points landing), in each finals variant:

| | Before this task (the credit off, run B's run) | The credit with TBA's number replacing it (the planner's reading of a form never committed) | The larger of the two (run B's run) |
| --- | --- | --- | --- |
| Locked lost over its two edges | 28 | 93 | 0 |
| distinct district and team pairs | 22 | 85 | 0 |
| margin drops | 498 | 772 | 0 |
| lost at the tick that writes the flag | 0 | 65 | 0 |
| floors lower | 0 of 12,232 | 684 at the forced edges | 0 of 12,232 |

## Locks gained and lost, per tab

- CHAMP LOCKS, 48 championships, 412 stops: Locked on points 3,755 to 4,221. GAINED 466 team stops (303 distinct teams), LOST 0. Single 754 to 925 (Rounds 2 to 5: 22, 33, 58, 58), divisioned 2,898 to 3,178 (65, 71, 85, 59), two championships 103 to 118 (2, 5, 6, 2). Locked out 41,893 to 41,981 (88 gained, 0 lost). Joint bounds compared 59,721: HIGHER 0, lower 1,704. No gained team fails its final standing. 168 sweep stop rows moved, each listed in `SCRATCH/mw2/expected/locks_diff.txt`.
- DISTRICT LOCKS, 418 district tier events, 2,926 stops: Locked on points 37,484 to 38,771. GAINED 1,287 (637 by the pooled test alone, 650 by the ceiling test), LOST 0, at Rounds 2 to 5 (226, 325, 389, 347). Locked out 83,235 to 83,667 (432 gained, 0 lost).
- The sweeps: joint `VIOLATIONS: none`, `SKIPPED (0)`, 2,452 secured minimums in floors; settled tenets A to F all 0, 13,628 secured rows holding 176,335 points. Cutoff history: no drift. `take-backs 0` over 48 championships and 412 stops. Now identical on both tabs (109 artifacts, 16,345 teams). The publisher's dry run compares clean.
- The header against the floor: District tab 3,735 team stops differed at 9a6c9fae and 0 of 676,354 differ now; Champ tab 0 of 67,336 (the 666 at 9a6c9fae is the planner's reading).
- The three walk files, rules on: 0 Locked lost, 0 margin drops, 0 bounds higher and 0 floors lower (2,956,059 team floors compared on the monotone file's rules on edges). With the credit switched off inside each file the walks read what they pinned before this task.
- All three diff outputs were read again on the last commit and equal their expected files line for line.

## What the page shows now (each new line of copy, verbatim)

1. An open Playoffs cell of a team whose alliance is still in the bracket, small line: `at least N · pays <values>`, for example `at least 13 · pays 20 or 30` (a district event, after a sf7 win) and `at least 39 · pays 60 or 90` or `at least 60 · pays 60 or 90` (a District Championship). The bold line above it is unchanged (`96% final`). In the median form: `at least 13 · likely 13 to 30`. Where the cell has no small line of its own: `at least 13`. Never on a not picked cell, a cell of another category, or for a figure that is zero. No tilde (a proven least, not a prediction), no percent sign, no dash.
2. The earned figure of a Team cell (`N earned`) now counts settled playoff points and the secured minimum. No new words. At 2026 FNC Round 5 frc4561 reads 292 earned where it read 232.
3. A printed median, a total's `~N` and the low end of its `likely a to b` are never below what the lock math counts for that row or team. No new words. A hand built total whose run reads `~57` over `likely 56 to 61`, beside 58 counted, prints `~58` over `likely 58 to 61`. The rendered District Locks case reads `58 earned · median 58` with a grand total of `~58` and an event total of `~34`; the rendered Champ Locks case reads `126 earned · median 126`, `~126` and a District Championship Subtotal of `~102`.
4. Methodology, section How district points work, directly after the settled playoffs paragraph: "A team still playing in the playoffs is credited the playoff points its wins have already secured, before The Blue Alliance posts them. The Blue Alliance shares an alliance's playoff points among its robots by the wins each was on the field for, so a robot that sat out a win has secured less. An open Playoffs cell reads at least that many points, and the earned figure beside the team counts them."

The Champ Locks District points row is a sum over several events and carries no at least line; the District Championship row does. The verdict drawer's chips print the same line through the same function.

## The printed totals (Task 6)

On the local 2026 PNW fixture's 48 playoff stops, 1,512 team stops with an open grand total, real runs of 400 draws (this run, equal to the planner's reading):

| What is printed below | Without the rule | With it |
| --- | --- | --- |
| District tab, grand total: low end, median below the earned figure | 154, 110 | 0, 0 |
| District tab, event total: low end, median below its own row's counted points | 154, 110 | 0, 0 |
| District tab, the Team cell's median below the earned figure | 110 | 0 |
| Champ tab, District points Subtotal: low end, median below that row's counted points | 154, 110 | 0, 0 |
| Champ tab, grand total: low end, median below the earned figure | 154, 110 | 0, 0 |
| Champ tab, the Team cell's median below the earned figure | 110 | 0 |

The cause is not the credit: the run ranks the field itself, with a tie break that is not TBA's, so its qualification points sit a point or two under TBA's posted number for some teams. The rule is print only. In the same test every team's projection, earned figure, position, cell summaries and statuses, and every Champ floor, are read before a line is printed and after, at all 48 stops: 0 differ.

## The flicker: how it was reproduced and how it was fixed

A Live run's progress carries no entry, so from the moment a new run started until it landed the hook's map held nothing for the event: no bracket milestones, and at a championship no bracket facts. Every Locked resting on a settled playoff value or on the joint proof was shown, taken back for the seconds of the run, and shown again, on every live refresh.

- REPRODUCED at hook level first, before any fix (`useDistrictLedgerData.flight.test.tsx`: the real hook rendered, only the run hook replaced; the local 2026orore file cut to its first two playoff rounds, at the live position): 29 teams Locked on points with the run landed, 27 with a new run in flight, frc1983 and frc8896 taken back, no entry for the event. The test failed with exactly those two.
- FIXED by `attachRequestFacts`: the milestones, a championship's bracket facts and the secured minimums are facts of the run REQUEST, and are laid onto the map per request, run landed or not. Nothing is held over from an earlier run, so nothing can be older than the rows.
- AFTER: the same test reads 29 and 29, nobody taken back; the entry in flight carries the 26 milestones, no team record and the 7 secured minimums the landed entry carries.
- OVER HISTORY, through the real function (`SCRATCH/mw2/exec/flicker_after.txt`, a scratch reading):

| | Locked with the run landed | Of them not Locked with a run in flight |
| --- | --- | --- |
| Champ Locks, 31 single event championships, every sweep stop, the hook of before | 754 | 420 (414 held by the joint proof alone, the planner's reading) |
| The same, now | 925 | 0, and none Locked only in flight |
| District Locks, the local fixture, Rounds 1 to 5, real runs, before | 1,153 | 73 |
| The same, now | 1,223 | 0 |

Now, both the landed set and the in flight set are the sweep's own set at every one of the 248 stops.

## Pins moved, each with its value before and its reason

Runs A and B (every one named by the plan's fact 25 and equal to its value):

| File | Pin | Before | After | Why |
| --- | --- | --- | --- | --- |
| `measureChampJointLocks.test.ts` | FNC Round 5 locked set | frc2724, frc3506, frc4795, frc9032, frc9496 | plus frc4561 | a finalist's 60 secured is in its floor |
| same | FNC Round 5 bounds of frc9496, frc9032, frc4795, frc4561 | 12, 12, 14, 16 | 11, 11, 11, 11 | the same |
| same | California Round 5 | 15 Locked | 17 (frc7415 and frc3128 join) | credit in floors |
| `champJointMonotone.test.ts` group A, awarded rule OFF | lost, pairs, flag edges with a drop, margins | 952, 161, 1786, 33,388 | 887, 145, 1800, 34,337 | the reading runs the sweep's own stops |
| same, group B, awarded rule OFF | lost, margins | 54, 777 | 52, 784 | the same |
| same, group C, stop rule OFF | lost over flag edges | 91 | 87 | the same |
| same, further edges | `absentFinalsSwitch.lockedAdded` | 4 | 30 | credit in floors |
| same, listed rule off | single championships | 25 margins | 20 margins, lost 0 | the same |
| same, forced awards flag | lost, pairs, margins, per variant | 28, 22, 498 | 0, 0, 0 | the larger of the two |
| same, forced field proof | lost, distinct pairs | 770, 515 | 822, 515 | more teams Locked to lose in a rule off reading |
| same, paid pick rule off | rises | 20 | 26, lost 0 | the same |
| `measureLedgerSettledTenets.test.ts` | 2026waahs Round 3, settled Locked | 31 | 32 (frc4512 joins) | credit in floors |
| `districtLocksNoTakeBack.test.ts` | frc2067 lockedBy | pooled at the first six stops | pooled, pooled, then both | the ceiling test locks it too from Round 2 |
| same | pool difference per stop | 0, 0, 0, 0, 21, 60, 0 | 0, 0, 78, 120, 159, 181, 0 | the pool is netted by what the floors hold |
| same | settled Locked per stop | 6, 6, 6, 6, 6, 7, 9 | 6, 6, 7, 7, 8, 8, 9 | credit in floors; lost is empty at every stop |
| `champFieldStagedWalk.test.ts` group 10 | shown Locked per tick, four districts | fim `[0,1,1,5,25,35,41,46,60,...]` | fim `[0,1,1,12,30,43,52,60,60,...]`, end values unchanged | credit in floors; the series of before kept as the credit off expectation |
| `districtLocksStagedReplay.test.ts`, field walks, rule off | District tab take backs | 32 and 34 | 26 and 24 | a rule off reading loses less |
| same, 2026pncmp case B, rule off | Champ tab take backs | frc2522, frc5937 | none with the credit | the same |

Run C:

| File | Pin | Before | After | Why |
| --- | --- | --- | --- | --- |
| `districtLedgerContent.test.ts` | the two paragraphs after the settled paragraph | third and fourth after the anchor | fourth and fifth | the new paragraph sits between (Task 5) |
| `DistrictLedger.test.tsx`, three assertions | a finalist's Playoffs cell | `96% final` over `pays 20 or 30` | `96% final` over `at least 13 · pays 20 or 30` | the credit reaches the live tab at Task 7 and Task 5's line prints it |
| `ChampLocksLedger.test.tsx`, two assertions | the same at a championship | `pays 60 or 90` | `at least 39 · pays 60 or 90` | the same |
| the two rendered cases of Task 6 | the finalist's earned figure | 49 and 102 | 62 and 141 | its 13 and its 39 secured are in the header at Now from Task 7 on |

The five rendered assertions are not named by fact 25, which lists lock result pins. The planner's overlay of the hook reference had no at least line (Task 5 had no reference), so it could not see them. Each is the same cell with the secured line in front of an unchanged pays line, and the 13 and the 39 are worked by hand in the tests. No lock result pin moved in run C.

## Deviations

Run A:

1. D7 addendum 1 applied in Task 1 (the reference did not carry it): the corpus gate takes its seasons from `BRACKET_REGISTERED_SEASONS`, the fit table labels by the declared rule, and a seventh test requires every registered season with finished brackets to be compared. The corpus file has 7 tests where the plan says 6.
2. D7 addendum 2: four headers say in plain words that a Locked resting on the credit could be withdrawn if a playoff result is corrected after it was posted, and that the rule was read from TBA's public source and is not something this code controls.
3. Comment only changes to installed reference files, each made true at its commit; the non comment lines of each installed file equal the reference's, line for line.
4. The FNC rows of `measureChampJointLocks.test.ts` now carry who was on the field (the fixture fielded every alliance's first three picks in every row, which credited frc7763 for a win it sat out); a corpus gated test holds every row equal to the corpus row.
5. The plan's verify list for Task 2 was run as the full root suite, a superset. One new test of run A timed out at the default 5,000 ms under the loaded suite at the end of Task 2 and was given a 120 s timeout; the Task 3 full suite passed it.

Run B:

6. The plan's reason for 2026pncmp case B is not what the run shows: with the credit neither frc2522 nor frc5937 is shown Locked at "playoffs done, rows still stale" at all, so there is nobody to take back. The outcome the plan names holds.
7. The credit off reading reaches the forced awards flag reading and the absent finals switch of the monotone file, as the plan asks, and no further.
8. Four tests beyond the plan's list, and the monotone file is about four minutes longer (the 26 divisioned championships walked a second time with the credit off).
9. The first full suite of run B failed three load sensitive tests while a game ran on the machine; the files passed alone and the rerun was green.

Run C:

10. [Rule 1] TASK 6 TOUCHED TWO FILES BEYOND ITS SIX: `champLedgerRows.ts` and its test. `countedAtPosition` (run A's finding, below) summed over a finals key's row where the header and the status floor read no Playoffs floor there. It now reads a finals key's row without its settled or secured Playoffs value, with the header's own predicate. THE THREE NOW AGREE ON THE SMALLER SIDE: a finals key adds no Playoffs floor. No figure changes today (nothing supplies a secured minimum at a finals key). A test hands one in at both keys and holds the rows, the header and the status floor equal; it read 75 where 45 was required before the change.
11. [Rule 2, CONTEXT D7] NO TIER ENTRY, NO CREDIT, and what it needed. The reference's live reading credited a loaded event artifact with no tier entry at the district tier by default. After the install it credits nothing there. The District Locks tab handed the hook no tier map at all, so the literal rule would have taken that tab's live credit away. `DistrictLedger.tsx` (not in Task 7's file list) now names the district tier for every event the district artifact's own rows carry at that tier, as `ChampLocksLedger.tsx` already names both tiers. The run is assembled at the district tier either way: no request and no run signature moves. If the orchestrator wants the smaller reading (no live credit on District Locks), striking the eleven added lines in `DistrictLedger.tsx` gives it, and the hook level test's first case then needs its tier map removed.
12. THE HEADER SECTION Task 7 asks for sits in the module header of `useDistrictLedgerData.ts`, beside the reference's own doc comment on `attachRequestFacts`, which already said most of it.
13. THE THREE HEADERS OF RUN A: all three changed (comment only). `districtLedgerRows.ts` gained WHO SUPPLIES IT; `districtLedgerStatus.ts` and `champLedgerStatus.ts` no longer say the tabs' hook does not supply the credit. `champLedgerRows.ts` says who reads `countedAtPosition` (changed in Task 6).
14. The plan's behavior line "rows built from that map read the event's cells exactly as with no entry" is true of every cell but one kind: a knocked out alliance's Playoffs cell is settled grey from the request's milestones, where a run in flight left it without a number before. The test pins that (six robots after sf7) and that no cell is priced.
15. The Task 7 verify chain was run in two parts (the chain up to the typechecks, then the full suite), and the history flicker reading through the real function is a scratch test beyond the plan.
16. THE LAST FULL SUITE RAN THREE TIMES. The first ran while a game loaded the machine: 2 failed of 9,190, both load sensitive tests the orchestrator named (`spr.test.ts` "frc4414 at 2026cc_qm69", timed out at 30 s, and `DistrictLedger.test.tsx` "posts the advancement chance to a SECOND Worker"); the two files pass alone (2 files, 139 tests). The second passed both and the machine went to sleep for ten hours and 38 minutes in the middle of one monotone test ("2025fim with the awarded rule switched OFF: the lattice is read"), which then read as timed out at a duration of 38,291,046 ms; the test after it, which pins that lattice's findings, passed (the Windows event log shows the sleep at 03:42 and the wake at 14:20). The third was held awake by a helper process that changes no setting and ended with the run: green.
17. No STATE.md update and no ledger entry was made: the orchestrator's constraints forbid committing any `.planning` file and adding todo items, and the quick task row is the orchestrator's.

## Findings, not acted on

- THE `PLAYOFF_POOL` BOUND IS MEASURED, NOT PROVEN (run A; the orchestrator is handling it as a separate task). `packages/core/districts/pointPool.ts`, which the Worker bundles and this task did not touch, sets the pool at 210 plus a measured backup margin of 3 (highest ever handed out 212). The pay rule shows why a bracket can pay more than three times each placement: shares are rounded up per robot, so an alliance that rotates a fourth robot through its wins can be paid 1 or 2 base points over (2026 FNC alliance 2: 90 + 90 + 72 + 21 = 273 against 270 at the championship weight). The pooled test nets the secured minimums off that pool, which is sound exactly as far as the pool total is an upper bound, as it was for the settled points before this task.
- `maxPlayoffPointsByPlacement` allows 25 for second place, which TBA's rule never pays. It is a ceiling, so it is sound, and it lives in a Worker bundled file. Not changed (the plan's premise P11).
- The header's finals key predicate (not a field fixing key) and the status code's (`finalsSourceCeiling`, which needs two or more division keys) differ on an artifact carrying ONE division key and its parent. Such an artifact does not exist in practice (divisions come in two or four, and a finals row posts after both), and it would matter only if a settled or secured value sat at the parent key. Found while writing the three way test of deviation 10, which uses two divisions.
- On the committed PNW fixture the forced flag reading WITHOUT the credit takes one Locked back (frc3674); with the credit none. Pinned in `champLedgerStatus.test.ts` (run A).
- With quick task 261009-vp9's rule off, more floors fall WITH the credit than without it in two rule off readings (140 against 106, 22 against 21). Not a defect: a floor already holds the bracket's secured points, so a stale qualification number that is too high is no longer hidden by the playoff points landing (run B).
- The print rule can leave a row whose printed median reads a point or two above the projection its In range or Out of range chip was cut at, because the chip, the sort and the cutoff still read the run's own median. Stated in the header of `LedgerParts.tsx`.
- The Playwright specs under `apps/web/e2e` run against the live site only. None pins the cell copy this task changed (checked by search), but they should be rerun from the main context after the deploy.

## Stated limits

1. THE RULE IS TBA'S. It was read from TBA's public source and fitted to four seasons. A new season's declared rule must pass the corpus gate on that season's first finished events before the credit can be trusted for it.
2. A CORRECTED RESULT CAN LOWER A CREDIT. If TBA changes a decisive row after posting it (a match replayed by the head referee), a secured minimum read off the first result can fall, and a Locked that rested on it could be withdrawn. The corpus keeps final results only and cannot measure how often. The lock math already rested on rows read as posted.
3. THE LARGER OF THE TWO REACHES AS FAR AS THE PLAYED ROWS. Rewound, that is every stop. At the live position it is every event whose artifact the tab has loaded: an event that has started and not finished, and on Champ Locks every started key of a divisioned championship until every one of its events has finished. An event that has left the Live fetch set (a district event or a single event championship once its awards flag is true) has no played row in the browser, and its floor is TBA's number alone. Keeping it fetched is not in this task.
4. NO CREDIT at a divisioned championship's finals event, for a backup no list names, for an event with a playoff row the tab cannot place on two alliances, or at the live position for an event artifact with no tier entry.
5. THE PRINT RULE IS PRINT ONLY, and the verdict drawer is not handed it: its tiles and histogram show the distribution itself. At Now while an event is under way the earned figure is the published total, which is not a floor, so the print is held at what the lock math counts and a median can still read below that earned figure, as before.
6. TBA's public source computes an event's four categories in one function and returns them together. That is read from the source and not verified against a live event; the live flag rule's own header already names the same assumption.
7. The first real exercise of all of this is the first live 2027 district event.

## Gate lines of run C, as printed

| After | Tests of the verify list | History gates | Diff tools | Worker | Typechecks |
| --- | --- | --- | --- | --- | --- |
| step 0 (a1d33f2e) | | `MW2 GATES AS EXPECTED (both)`, every gate identical to run B's `after-t4`; `MW2 REFERENCE CHECK HOLDS (task 7, 1 files)` | | | |
| Task 5 | 7 files, 301 tests passed; the districts and methodology folders 33 files, 1,231 tests passed | `MW2 GATES AS EXPECTED (both)`, identical to `after-t4` | | `WORKER BUNDLE UNTOUCHED (3 files probed)` | root, web, e2e, worker clean |
| Task 6 | 10 files, 662 tests passed | `MW2 GATES AS EXPECTED (both)`, identical to `after-t4` | | `WORKER BUNDLE UNTOUCHED (4 files probed)` | clean |
| Task 7 | 6 files, 355 tests passed | `MW2 GATES AS EXPECTED (both)`, identical to `after-t4` | `LOCKS DIFF T7 EQUALS EXPECTED`, `DISTRICT DIFF T7 EQUALS EXPECTED`, `CHAMP HEADER T7 EQUALS EXPECTED` | `WORKER BUNDLE UNTOUCHED (13 files probed)` | clean |

Every gate run also printed `cutoff: no drift for both generated files`, `takeback: championships 48, stops 412, take-backs 0`, `now: identical on both tabs (artifacts 109 teams 16345)`, `UL3 COMPARE CLEAN` and `R9X COMPARE CLEAN`.

The full root suite, `REQUIRE_LOCAL_DATA=1`:

- After Task 6: `Test Files 359 passed (359)`, `Tests 9178 passed | 1 skipped (9179)`, 2,200 s.
- After Task 7, the run the commit rests on: `Test Files 360 passed (360)`, `Tests 9189 passed | 1 skipped (9190)`, 1,560 s. The two runs before it: `Test Files 2 failed | 358 passed (360)`, `Tests 2 failed | 9187 passed | 1 skipped (9190)` under load, and `Test Files 1 failed | 359 passed (360)`, `Tests 1 failed | 9188 passed | 1 skipped (9190)` across the machine's sleep (deviation 16).

The one skip is `packages/ingest/rankingsLive.test.ts`, which needs `TBA_API_KEY` and the network and is not a local data group.

## Scope

No file the Worker bundles changed, not even a comment (`WORKER BUNDLE UNTOUCHED` after every task; the thirteen code files of this quick task probed at the end). No artifact schema change, no algorithm version change, no published verdict moved (the publisher's dry run compares clean), no todo item added, no package installed. `districtRunAssembly.ts` is untouched: no request, gap list or run signature moved. 32 files changed since 9a6c9fae, none under `.planning`.

## What is owed

Only a push. No Worker deploy and no republish: nothing the Worker bundles and nothing the publisher writes changed. After the push deploys, the orchestrator's check from the main context: on a local preview or the live site open Champ Locks for 2026 FNC and rewind to Round 5. frc4561 reads Locked, its row prints 292 earned, and its District Championship Playoffs cell's small line starts `at least 60`. frc2724 prints 260 earned. No Team cell prints a median below its earned figure. On District Locks open a 2026 district rewound into an event's Round 4: a team of an alliance still playing prints an at least line and an earned figure that includes it. Then rerun the live e2e specs.

## Known Stubs

None.

## Self-Check: PASSED

Seven commits found (`f5c3ca44`, `1fe354e1`, `946c9e47`, `a1d33f2e`, `efa06869`, `0c0db62b`, `b1fc2566`), the four created files exist, the working tree is clean but for this untracked directory, and `origin/main..main` is seven commits.
