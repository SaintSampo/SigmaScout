---
phase: quick-261009-vp9
plan: 01
subsystem: districts
tags: [districts, locks, worker, awards, tba, live-finality, two-readings, winner-hold]
status: complete
requirements_completed: [261009-vp9]
requires:
  - 261009-tx6 (publishedCategoryFinality, the awards settle clock, the 24 hour watch)
  - 261009-tx9 (the divisioned joint proof, champLedgerStatus.ts as it left it)
  - 261009-r9x (the awards flag and the live winner records)
provides:
  - packages/core/districts/categoryCorroboration.ts (corroboratedCategoryFinality, categoryPointsPresenceByEvent, divisionCountOf, finalsChampionMaximum)
  - publishedCategoryFinality reading the rows, with a fourth parameter (season)
  - AWARDS_SETTLE_WITHOUT_IMPACT_MS, AwardsEventKind, expectedConsumingAwardTypes, expectedAwardsListed, awardsListSettled with a threshold
  - longSettledAwardEvents on both merge entry points
  - deriveLiveStage, liveStageByEvent, pointsFinal on the simulation input builder, fieldStageByEvent on both row builders
  - scripts/districtLocksStagedReplay.test.ts
affects:
  - apps/worker (deploy owed, orchestrator)
  - apps/web (ships with the Pages deploy a push triggers)
tech-stack:
  added: []
  patterns:
    - two readings of one event, never mixed (the field from the state alone, the number from the state and the proving points)
    - one core rule read by the verdict pass and by both tabs
    - presence facts built once per teams array (WeakMap) and once per row build
    - the Worker measures (two settle facts off one cursor row), the merge decides
    - a rule switched off inside a test through a module mock, to prove the walk bites
key-files:
  created:
    - packages/core/districts/categoryCorroboration.ts
    - packages/core/districts/categoryCorroboration.test.ts
    - scripts/districtLocksStagedReplay.test.ts
  modified:
    - packages/core/districts/eventAwards.ts
    - packages/core/districts/eventAwards.test.ts
    - packages/core/districts/reservedSlots.ts
    - packages/core/districts/champReservedSlots.ts
    - packages/harness/districtRankingsMerge.ts
    - packages/harness/districtRankingsMerge.test.ts
    - apps/worker/src/districtRefresh.ts
    - apps/worker/test/scheduled.district.test.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/districts/districtLedgerStatus.test.ts
    - apps/web/src/components/districts/districtRunAssembly.ts
    - apps/web/src/components/districts/useDistrictLedgerData.ts
    - apps/web/src/components/districts/useDistrictLedgerData.test.ts
    - apps/web/src/components/districts/champLedgerRows.ts
    - apps/web/src/components/districts/champLedgerRows.test.ts
    - apps/web/src/components/districts/DistrictLedger.tsx
    - apps/web/src/components/districts/DistrictLedger.test.tsx
    - apps/web/src/components/districts/ChampLocksLedger.tsx
    - apps/web/src/components/districts/ChampLocksLedger.test.tsx
    - apps/web/src/components/districts/districtFieldOverlay.ts
    - apps/web/src/components/districts/districtFieldOverlay.test.ts
    - apps/web/src/components/districts/champLedgerStatus.ts
    - apps/web/src/components/districts/champLedgerStatus.test.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
    - docs/worker-operations.md
decisions:
  - A category's number is final at the live position only when the state says the stage is over AND the points that prove it are in the artifact's rows
  - Two readings, never mixed: the field (state alone) drives the run, the bracket facts, the timeline and the rail; the number drives the grey cells and the lock math
  - The run takes TBA's own playoff and award points as known only once those numbers are final, and reads the played bracket until then
  - The awards flag waits for every consuming award an event gives and 60 unchanged minutes, otherwise 12 unchanged hours; a division keeps 60 minutes
  - The winning alliance's four places are released only once the Playoffs are final AND a Winner is recorded; on the Champ Locks tab only while that championship's flag is not yet true at Now
  - Whenever a step was ambiguous the side taken reads a category open or holds a reservation longer
  - Hardening after verification: only the awards flag cascades down; Alliance selection and Playoffs each need their own points, and the live awards flag also waits for a playoff point at the event
metrics:
  started: 2026-10-10T06:10:00Z
  completed: 2026-10-10T08:15:44Z
  duration: about 85 minutes for the five tasks, about 35 more for the hardening commit
  tasks: 5
  files: 30 committed
actuals:
  tokens: 103100
  tasks: 5
  commits: 6
---

# Quick Task 261009-vp9: A category counts as finished only when its points are in

A category's number now reads final at a live event only once the event's state says the stage is over and the points that prove it are in the district rankings, in the published verdicts and on both Locks tabs, and the awards flag waits for every consuming award an event gives.

Base commit `9db0c2e1`. Not pushed. Not deployed. Six commits: one per task, and one hardening fix asked for by the orchestrator after verification.

## Commits

| Task | Commit | Subject |
| ---- | ------ | ------- |
| 1 | `37aeb594` | feat(261009-vp9): a category's number reads final only once its points are in, proven end to end on one event |
| 2 | `b3ae56d5` | fix(261009-vp9): the awards flag waits for every consuming award an event gives, and the winner's places stay held until a Winner is recorded |
| 3 | `e3b03487` | feat(261009-vp9): the run keeps reading the field and takes TBA's numbers only once they are final, and both tabs' rows read the number at every stop |
| 4 | `1e8d0e64` | fix(261009-vp9): the field overlay reads the number, and the Champ Locks tab holds the winner's places until a Winner is recorded |
| 5 | `e44472a3` | feat(261009-vp9): every PNW event walked stage by stage with lagging points, the late awards replayed, and the docs state the rule and the two readings |
| fix | `0aafac90` | fix(261009-vp9): Alliance selection and Playoffs each need their own points, and the awards flag waits for playoff points |

## The rule

An event's state block (qualification matches played, alliances picked, playoffs done) comes from the match feed and moves within a minute. Each team's points come from TBA's district rankings, a different feed that can lag. Read from the state alone, a category closed before its points were in: a rival lost a ceiling it could still fill, a team read Locked, and the points arriving took the Locked back.

For one event, reading the artifact's own rows at that event (`packages/core/districts/categoryCorroboration.ts`):

- **Awards** are final when `awardsPosted` is true.
- **Playoffs** are final when Awards are, or `playoffsDone` is true AND some row carries the winner's playoff value (30 at a district event, 90 at a championship or a division, in 2026; 60 or 30 at a four or two division finals event; the whole dcmp Playoffs ceiling at a finals event in a season or at a division count the bracket module does not carry).
- **Alliance selection** is final when Awards are, or `alliancesPicked` is true AND some row carries alliance points above 0. Playoffs final does NOT close it (the hardening, commit `0aafac90`).
- **Qualification** is final when Alliance selection is. TBA shows provisional qualification points during an event, so their presence proves nothing.
- An absent state reads every category open. A finals event keeps the state's own reading for Qualification and Alliance selection, which it does not have.

**Only the awards flag cascades down.** Alliance selection and Playoffs each need their own points. The flag may cascade because the live flag itself now needs, at the event: a judged award listed, award points on some row, **a playoff point on some row**, every consuming award the event gives listed, and the list unchanged for 60 minutes (12 hours where an expected award is not listed). Hindsight, the publisher's reading, is unchanged.

The rule only ever reads a category OPEN where the state alone reads it final. A test checks all 192 combinations of state and presence: no category the rule reads final is read open by the state's own reading. A rankings row alone closes nothing.

## The two readings, never mixed

1. **What has happened on the field** is the state alone (`deriveStageFromState`, unchanged). It drives the simulation run, the published alliances and the played bracket the run is conditioned on, the bracket facts, the timeline, the milestone rail, and whether selection is over for the not picked note.
2. **Whether a category's number is final** is the rule above (`deriveLiveStage`, `liveStageByEvent`). It drives which cells are grey and everything the lock math reads: the floors, the ceilings, the pooled pool, both reservations, the winner gate, the settled playoffs rule and the joint proof's eligibility.
3. **Reading R19.** The run reads two of TBA's numbers off the district artifact, the playoff points and the award points. It takes each as known only where its number is final (`pointsFinal`), and reads the played bracket until then. Without `pointsFinal` every request is what it was.
4. Nothing live goes dark while points lag. Only finality waits.

Both tabs keep their state only maps exactly as they were and add the number maps beside them.

## The staged walk

`scripts/districtLocksStagedReplay.test.ts`, 41 tests, all groups ran (none skipped). One event at a time is rewound in the committed 2026 PNW fixture and walked over ten ticks through the two merge entry points and the tabs' own status code at Now. "Rule off" is the same walk with the one core rule switched off inside the test, every other change left on.

### The eight district events, ten ticks

Take backs: published `districtLock`, published `champLock`, District Locks tab.

| Event | Rule off | Rule on |
| ----- | -------- | ------- |
| 2026orore | 3, 2, 3 | 0, 0, 0 |
| 2026orsal | 3, 0, 3 | 0, 0, 0 |
| 2026orwil | 4, 1, 4 | 0, 0, 0 |
| 2026waahs | 3, 0, 3 | 0, 0, 0 |
| 2026wabon | 7, 1, 7 | 0, 0, 0 |
| 2026wasam | 3, 2, 3 | 0, 0, 0 |
| 2026wasno | 4, 2, 4 | 0, 0, 0 |
| 2026wayak | 5, 1, 5 | 0, 0, 0 |
| **Total** | **32, 9, 32** | **0, 0, 0** |

Rule off, per gap, for the published district and the tab alike: 2 where the rankings catch up (tick 1 to 2), 24 where the alliance points land (tick 3 to 4), 6 where the playoff points land (tick 5 to 6).

With the rule on, at every event the end state equals the baseline for all 126 teams (`districtLock`, `champLock`, `pointTotal`, both ceilings). A category reads open until its points are in, in the verdict pass and in the tab's rows alike, and no cell of an open category is grey.

`2026waahs` is the one event with no row at the winner's value (derived from the fixture and asserted): its Playoffs read open from the playoff points landing until the awards flag turns true.

Told out and then something else, published `districtLock`: 21 teams with the rule off, 2 with it on (`frc2976` at `2026wasam`, `frc4131` at `2026wasno`), both to `lockedAward`: out on points, in by an award, which is the accepted meaning.

### The two tick orders, two synthetic single championships

Take backs: published `champLock`, Champ Locks tab.

| Championship | The Winner listed before the playoff points land | The playoff points land before the Winner is listed |
| ------------ | --- | --- |
| S1, rule on | 0, 0 | 0, 0 |
| S1, rule off | 1, 1 (the team X) | 1, 1 (the team X) |
| S2, rule on | 0, 0 | 0, 0 |
| S2, rule on, winner hold removed | not measured | 13, 13 |

The S2 figure without the winner hold was measured by removing the hold from the merge (13 published) and from the tab (13 on the tab) in a scratch edit, each restored before anything was staged. With the hold, S2's reservation reads 4 more than the judged awards from the playoff points landing until the Winner is listed.

### The points arrive only at the end (the field conditioned walks)

The played bracket is handed to the tab at every tick from "alliances picked" on. Take backs: published district, published champ, District Locks tab, over the eight events.

| Case | Rule off | Rule on |
| ---- | -------- | ------- |
| A, the points lag by minutes | 32, 9, 32 | 0, 0, 0 |
| B, the points arrive only when the event ends | 34, 16, 34 | 0, 0, 0 |

In case B with the rule on, 607 team ticks carry a Playoffs cell settled by the bracket while Alliance selection still reads open, and no category of any event reads final until the points land.

### The champ walks, the real 2026pncmp with its corpus bracket

Both cases, rule on: 0 published `champLock` and 0 Champ Locks tab take backs. The joint proof refuses as `stageNotEligible` on every tick from "alliances picked" until the alliance points land, with the flat reservation (11) standing, and is applied on the tick they land. The reservation holds the four winner places on every tick before the Winner is listed, the ticks where the playoff points are already in included, and reads 7 from the tick it is listed.

Case B with the rule off: the Champ Locks tab takes 2 Locked back, `frc5937` and `frc2522`.

### The late award walks

The first list sits unchanged for two hours, then the award is listed with its points. Held places lost over four series (published district, published champ, District Locks, Champ Locks), measured with the old hour rule emulated exactly on the shipped code:

| Walk | Old hour rule | New rule |
| ---- | ------------- | -------- |
| late Impact at 2026orore, 2026orsal, 2026orwil, 2026wasam, 2026wasno | 2 each (`frc5920`, published and on the tab) | 0 |
| late Impact at 2026waahs, 2026wabon, 2026wayak | 0 | 0 |
| late Impact at 2026pncmp | 6 (`frc9450`, `frc3674`, `frc1425`) | 0 |
| late Engineering Inspiration at 2026pncmp | 4 (`frc9450`, `frc3674`) | 0 |
| late Rookie All Star at 2026pncmp | 4 (`frc9450`, `frc3674`) | 0 |
| late Winner at 2026pncmp | 0 | 0 |
| **Total over 12 walks** | **24** | **0** |

Under the new rule the flag is false at minutes 0, 60, 120 and 179 and true at 180 in all twelve. A list that never gains its Impact is false at minute 719 and true at minute 720. Through the real tick (`apps/worker/test/scheduled.district.test.ts`): a late Impact at `2026wasam` and `2026wasno`, and a late Impact, Engineering Inspiration and Rookie All Star at `2026pncmp`, each with the flag false on every tick until 15:15 (the first passing tick an hour after the award was listed at 14:05) and no held place lost. All five fail under the old rule.

### The reordered walks (the hardening, commit `0aafac90`)

The verifier walked `2026orore` with a later layer of points landing before the layer below it, and found locks taken back. The first version of the rule let Playoffs final close Alliance selection and Qualification without their own points, and let the flag rise with no playoff point in the rows. Three orders are now walked in the replay file. Take backs: published district, published champ, District Locks tab, Champ Locks tab.

| Order | Steps | Hardening switched off | Hardening on |
| ----- | ----- | ---------------------- | ------------ |
| N1, playoff points before alliance points | `qs P0 qd Pq sp pd Pe Pa L Pw ST` | 4, 2, 4, 2 | 0, 0, 0, 0 |
| N3, award points and a settled list before playoff points | `qs P0 qd Pq sp Pa pd L Pw ST Pe` | 1, 1, 1, 1 | 0, 0, 0, 0 |
| N4, playoff points before the final qualification points and the alliance points | `qs P0 qd sp pd Pe Pq Pa L Pw ST` | 4, 2, 4, 2 | 0, 0, 0, 0 |
| the physical order, through the same step machine | `qs P0 qd Pq sp Pa pd Pe L Pw ST` | 0, 0, 0, 0 | 0, 0, 0, 0 |

The switched off numbers equal the verifier's. With the hardening on, each walk ends on the published state, no category is grey without its own points, in N1 and N4 the playoff points close the Playoffs and nothing below them until the alliance points land, and in N3 the flag stays false at the settled tick and rises on the tick the playoff points land.

**N2 is not walked as a passing zero. It is the stated assumption** (see below): alliance points before the final qualification points, `qs P0 qd sp Pa Pq pd Pe L Pw ST`, measured by the verifier at 2, 0, 2, 0.

## The census

Over every district detail file under `data/local-publish/districts`: 109 district artifacts, 1124 events with a state block, 1124 finished by state, 0 with a category the rule reads differently from the state, in the verdict pass or in the tabs' rows. No finished event regresses to open.

## The history gates

Baselines taken at `9db0c2e1` before the first edit. My sweep baselines equal the planner's for three sweeps; the joint locks sweep differed from the planner's (519 diff lines), as expected, because quick task 261009-tx9 (`997061b5`, `61444f38`) landed after the planner's run.

| Gate | Result |
| ---- | ------ |
| `measureLedgerSettledTenets` | identical to baseline after Task 1, 3, 4, 5 and after the hardening. `VIOLATIONS: none` |
| `measureLedgerTenets` | identical. 109 seasons, 4022 positions, 921658 team positions, tenet A 0, tenet B 0, "Both tenets hold" |
| `measureChampTenets` | identical. 109 seasons, Locked on points shown 6836, Locked out shown 271340, `VIOLATIONS: none` |
| `measureChampJointLocks` | identical. 48 championships (31 single, 16 divisioned, 1 two championship), `VIOLATIONS: none` |
| `orch_takeback.mts` | `championships 48, stops 412, take-backs 0` (before the first edit, after Task 4, after Task 5 and after the hardening) |
| `measureChampCutoff --check-history` | `no drift` for both generated files, after Task 5 and after the hardening. Nothing regenerated |
| Publisher whole artifact comparison, after Tasks 1, 2 and 5 and after the hardening | `artifacts 109 \| differing 0 \| carried events 1124 \| awardsPosted true before 1124 after 1124 \| flips 0 \| qualifyingAwards entries before 3251 after 3251` then `R9X COMPARE CLEAN` |

Lines compared against the baseline, the elapsed time line dropped: 35, 163, 129 and 1188. Every gate was run again on the final tree (`0aafac90`): the four sweeps identical with zero violations, the census 0 of 1124, the take back line, the cutoff check and the publisher comparison all as above.

## Verification, as printed

| Gate | Result |
| ---- | ------ |
| Task 1 test set | 61 files passed, 1769 tests passed |
| Task 2 test set | 33 files passed, 864 tests passed |
| Task 3 test set | 50 files passed, 1318 tests passed |
| Task 4 test set | 50 files passed, 1327 tests passed |
| Task 5 test set (replay, methodology) | 2 files passed, 62 tests passed |
| Full root `npx vitest run` after Task 1, 2, 3, 4, 5 | 352 files passed each time; 8413, 8450, 8475, 8484, 8524 tests passed, 1 skipped |
| Staged replay file after the hardening | 48 tests passed, none skipped |
| Full root `npx vitest run` after the hardening | 352 files passed, 8537 tests passed, 1 skipped |
| Four typechecks, after every task and after the hardening | `TYPECHECKS CLEAN (root, web, e2e, worker)` |

## Every pin that moved

The orchestrator's constraint names one reason for a moved pin: a fixture whose state says a category is done while its rows lack the proving points. Three pins moved for that reason. **One pin moved for a second reason, the winner hold**, which the plan allows in Task 4 only (reading R17, fact 13). It is called out here so it is not missed.

| File, test | Before | After | Reason |
| ---------- | ------ | ----- | ------ |
| `districtRankingsMerge.test.ts`, "publishedCategoryFinality returns what districtEventCategoryFinality returns for the same state" | equal for every state, with no rows at all | rewritten: equal where the rows prove every category, open where no row does | the fixture handed the reader an empty teams array while the state said the playoffs were done |
| `districtRankingsMerge.test.ts`, the source test | `districtEventCategoryFinality(` called once, inside the reader | `corroboratedCategoryFinality(` called once inside the reader, `districtEventCategoryFinality(` never, and no code line reads `playoffsDone` | the one place moved to the rule that reads the rows |
| `districtLedgerStatus.test.ts`, "live with no TBA row yet" | `openCeiling` award + 7 | qual + alliance + award + 7 | the state says alliances are picked and no row at the event carries a point |
| `champLedgerStatus.test.ts`, "reserves one championship's slots per championship still open" | second championship, Playoffs final, awards open: `AWARD_SLOTS` | `AWARD_SLOTS + 4`, with the mirror case (`AWARD_SLOTS` at the championship that has its Winner recorded) added | **the winner hold**: the fixture's three Winner records sit at the first championship and it carries no state block, so the second championship's Playoffs are final with no Winner recorded there |

Nine of the planner's ten merge pins did NOT move. Their fixtures mean "everything but the awards is in", so each was given the proving points with every total unchanged, and the pin kept:

- the tracer payload (`2026ncpem` is 10 qualification, 10 alliance, 30 playoff points), which keeps "merges a real payload" and "a team the artifact DOES carry";
- the awards describe's fixture (team A's `2026ncpem` row carries an alliance point and the winner's 30) and its championship fixture (A's row carries 90), which keep "counts a District Championship Winner once the playoffs are done", "the first list, Winner and Finalist" and "three states in order";
- `openAwardDistrict`, the "no take back at the award stage" walk, the "stored ceiling" district and the fifteen team pool district, which keep the four tests that read them.

Task 2 moved no pin in the merge or the Worker tests. The live cases of `eventAwards.test.ts` gained the new fact, as the plan says. The four `DistrictLedger.test.tsx` tests of fact 13 pass with their fixtures untouched.

### The hardening commit

One pin moved, for the allowed reason:

| File, test | Before | After | Reason |
| ---------- | ------ | ----- | ------ |
| `categoryCorroboration.test.ts`, "reads final whenever Playoffs are final, with no alliance points on any row" | Alliance selection final from the winner's playoff value alone | rewritten as two tests: Playoffs corroborated with alliance points absent leaves Alliance selection and Qualification open, and the awards flag still closes all four | the case's state says Alliance selection is done while its rows carry no alliance point, the category's own proof |

No other pin moved. 26 tests failed on the first run after the change, all because a fixture meant "the playoff points are in" while no row at the event carried one. Each fixture was given a playoff point with every total unchanged, and every pin kept:

- `scheduled.district.test.ts`, `movedRankings`: five of frc1's 50 points at the live event are playoff points;
- `scheduled.district.test.ts`, `watchArtifact`: frc1's row at every watched event is 9 qualification and 1 playoff point;
- `districtRankingsMerge.test.ts`: the division rows and the championship rows of the flag tests carry five playoff points.

No row in those fixtures reaches the winner's value, so every category of a waiting event still reads open until its flag turns true, as before. The live cases of `eventAwards.test.ts` gained the playoff points fact. No web test changed.

## D8, as applied

- **History gates in Tasks 1 and 3:** the four sweeps were run and diffed against the Step 0 baselines after Task 1 and after Task 3, before each commit, and again after Task 4 and at the end. Identical every time.
- **The 12 hour catch up test (Task 2):** one tick at 12:15 UTC with two catch up events: the one whose awards cursor row is 12 hours old turns its flag true, the one whose row is 11 hours 59 minutes old does not. Both rows keep their ETag and change time.
- **A championship through the real tick (Task 2):** `2026pncmp` at 12:15 UTC, four cases: no Rookie All Star with a row 11 hours 59 minutes old (false) and 12 hours old (true), all four listed with a row 59 minutes old (false) and 60 minutes old (true). The tick harness carries a dcmp tier event with nothing more than a window record and a cursor row, so the three late `2026pncmp` variants run through the real tick as well.
- **The presence memo test (Task 1):** the finality reader is called on a teams array, then on a NEW array with a winner row added, then on one with it removed, and answers right each time. The merge's and the core module's comments state that team arrays are treated as immutable.
- **Copy:** the methodology Limits cell names the awards and never says "them". The tab tests read "settled at its placement" as not exact.
- **Release note for the orchestrator:** deploy the Worker only when no district or championship event sits between playoffs done and awards posted. The operations doc carries it.

## Deviations from the plan

1. **HEAD at the start was `9db0c2e1`, not `61444f38`.** One docs only commit by the orchestrator sat on top. `git diff 61444f38 9db0c2e1` outside `.planning/` is empty.
2. **Nine merge pins kept, not moved** (see above). The plan asks for exactly this where a fixture did not mean the gap.
3. **The awards flag reads the 12 hour fact alone where an expected award is not listed,** and the 60 minute fact alone where every one is, exactly as the plan words the rule. The Worker hands both from one row, so 12 hours implies 60 minutes.
4. **The winner hold in the published pass is "Playoffs final AND a Winner recorded".** The prototype also allowed "or awards final", which changes nothing because posted awards zero the reservation.
5. **The not picked note at a rewound stop reads the field map, then the stage map, then the row's own state.** The prototype fell back to the live stage for an event absent from a supplied stage map. The timeline seeds the map with every event, so the app cannot reach that case. I took the field side.
6. **The census reads every district detail file itself.** Both sweep loaders drop a district with no published capacity. It found 109 files, the sweeps' own count.
7. **`champLedgerRows.test.ts` carries a pass through spy** (`vi.mock` returning the real builder wrapped in `vi.fn`) so one test can read what each tier pass was handed. It changes no result.
8. **The awards describe's entry point payload helper now carries a row's alliance and playoff points** instead of zeroing them, so a merged row keeps the proof its fixture gives it.
9. **The function that names an event kind's awards is `expectedConsumingAwardTypes`.** The plan left the name open.
10. **Test order.** Core, merge, awards, row builder, input builder, assembly, overlay and champ status tests were written first and seen red. The tab level tests of Task 3 and the replay file passed on their first run, because they verify code already written. I checked that they bite: the stale playoff number test and the rewound stop test each fail with the tab's number reading unwired, all 14 late award tests fail under the old hour rule, the five Worker late variants fail under it too, and the S2 walk fails without the winner hold. Every scratch mutation was restored from a copy before anything was staged.
11. **No STATE.md, ROADMAP.md or quick tasks row, and no todo item,** per the brief. Left to the orchestrator.
12. **Edits were made through small scratch scripts and the Write tool,** not shell heredocs: a quoted heredoc containing an apostrophe fails in this shell.

No STOP rule fired.

## When TBA posts points during an event: not verified

No live district weekend has been observed under this rule. Both cases are walked by tests and neither is asserted:

- **If the points lag by minutes,** finality waits minutes.
- **If they arrive only when an event ends,** the tabs show predictions conditioned on the field all event and no category reads final until then.

The header of `categoryCorroboration.ts` and `docs/worker-operations.md` say the same. The comment on `teamNotPickedAtPosition` now says this is not verified and asserts neither.

## The assumption that remains: not verified

TBA computes an event's point categories together. Two things follow from it, and neither is verified against a live event. Both are stated in the headers of `categoryCorroboration.ts` and `eventAwards.ts` and in `docs/worker-operations.md`.

1. **The qualification points are final once alliance points appear.** Qualification has no proof of its own, so alliance points close it. If alliance points ever landed before the corrected qualification points, the corrected points arriving afterwards could take a lock back (the verifier's N2 on `2026orore`: 2 published district and 2 on the District Locks tab).
2. **Playoff points carried by a payload that also carries award points include the deciding match.** The flag asks only for some playoff point above 0, not the winner's value, because an event whose winners carry no row never shows that value.

## The stated limits (no todo item)

1. A further recipient of a consuming award type that is already listed, listed more than an hour after the list last changed: a second Impact at a championship, a fourth member of a winning alliance.
2. An event that lists none of an expected award for 12 unchanged hours and then lists it.
3. The 24 hour watch and the catch up of 261009-tx6 are unchanged.
4. An event whose winning alliance carries no row at the winner's value (3 of 418 district events since 2023: `2026njtab`, `2026mawor`, `2026waahs`) keeps its Playoffs open at the live position from the playoff points landing until its awards flag turns true. That is the open side.
5. The published side is the tab's rule without its settled playoffs refinement, so mid playoffs a published status can be weaker than the tab's, never stronger.

## What a Worker deploy now ships that differs

Walked from `apps/worker/src/districtRefresh.ts` over value imports. Of the 30 changed files, 6 are in the Worker's bundle:

| File | Kind of change |
| ---- | -------------- |
| `packages/core/districts/categoryCorroboration.ts` | NEW: the rule (only the awards flag cascades down) and the presence facts |
| `packages/harness/districtRankingsMerge.ts` | code: `publishedCategoryFinality` reads the rows, the Winner gate and both reservations read through it, the winner hold, the awards step's event kind, second settle set and playoff points fact |
| `packages/core/districts/eventAwards.ts` | code: the expected awards fact, the 12 hour constant, the threshold on `awardsListSettled`, the playoff points fact and `playoffPointsPresentAt`, the live rule |
| `apps/worker/src/districtRefresh.ts` | code: the second settle set measured from the same cursor row and handed to both merge calls. No new request, D1 read or D1 write |
| `packages/core/districts/reservedSlots.ts` | comment only |
| `packages/core/districts/champReservedSlots.ts` | comment only |

`apps/worker/src/stateStore.ts`, every migration, `packages/harness/pageArtifacts.ts`, `scripts/publishDistricts.ts`, `districtMilestones.ts`, `districtTimeline.ts` and every measure script are untouched. No artifact schema change, no algorithm version change, no D1 migration. The static import guard and `browserSafeSchemas.test.ts` pass: the Worker imports nothing from `packages/corpus`, no `better-sqlite3`, no `node:` built in. `runDistrictRefresh` still never throws, and the existing subrequest bound tests pass unchanged.

## Release hand off

Not pushed, not deployed. `main` is 15 commits ahead of `origin/main`; 6 are this task's. Owed by the orchestrator: check `origin/main..main`, push, watch CI, then `npx wrangler deploy` from `apps/worker` on a clean tree, while no district or championship event sits between playoffs done and awards posted. No district republish is owed.

## Known Stubs

None.

## Self-Check: PASSED

- The three created files exist, and `packages/core/districts/categoryCorroboration.ts` exports `corroboratedCategoryFinality`.
- Commits `37aeb594`, `b3ae56d5`, `e3b03487`, `1e8d0e64`, `e44472a3`, `0aafac90` are in `git log`.
- Working tree after the last commit: only the untracked quick task directories under `.planning/`.
