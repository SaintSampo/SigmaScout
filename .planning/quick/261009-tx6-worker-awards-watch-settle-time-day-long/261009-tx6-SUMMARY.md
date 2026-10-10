---
phase: quick-261009-tx6
plan: 01
subsystem: districts
tags: [worker, districts, locks, awards, tba, d1-cursor, live-windows-manifest]
status: complete
requirements_completed: [261009-tx6]
requires:
  - 261009-r9x (the awards flag and the live winner records)
  - 260925-ms7 and 261006-3gg (the two reservations)
  - 261007-il9 (the district pass ranks the district tier total)
provides:
  - publishedCategoryFinality, the one place the published verdicts read category finality (for 261009-vp9)
  - awardsListSettled and AWARDS_SETTLE_MS in packages/core/districts/eventAwards.ts
  - DISTRICT_AWARDS_WATCH_MS in packages/harness/manifestSchemas.ts
  - loadTickWindowsAt in apps/worker/src/liveWindows.ts
  - the district pass under the watch set, the two cadences, the forced look and the catch up
affects:
  - apps/worker (deploy owed, orchestrator)
  - the live windows manifest (a closed district window is kept 24 hours; takes effect at the next publish of that manifest)
  - 261009-vp9 (edits publishedCategoryFinality next)
tech-stack:
  added: []
  patterns:
    - both ceilings built from the rows on every call, never added to a stored value
    - facts read off the incoming artifact before anything is merged into it
    - cadence read off the UTC minute of the tick, nothing stored
    - cursor row as ETag of the last list merged plus the time that ETag last changed
key-files:
  created: []
  modified:
    - packages/harness/districtRankingsMerge.ts
    - packages/harness/districtRankingsMerge.test.ts
    - packages/core/districts/eventAwards.ts
    - packages/core/districts/eventAwards.test.ts
    - packages/core/districts/reservedSlots.ts
    - packages/harness/manifestSchemas.ts
    - packages/harness/manifests.ts
    - packages/harness/manifests.test.ts
    - apps/worker/src/districtRefresh.ts
    - apps/worker/src/liveWindows.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/test/scheduled.district.test.ts
    - apps/worker/test/liveWindows.test.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
    - docs/worker-operations.md
  uncommitted:
    - .planning/todos/pending/champ-joint-lock-follow-ups.md
decisions:
  - A recorded award is read only once its own event's state says it is given; a Winner once the playoffs are final, which is playoffsDone or awardsPosted
  - The published ceilings and floors follow the District Locks tab's rule without its settled playoffs refinement
  - The live flag needs a third fact, the awards list unchanged for 60 minutes, kept in lastAdvancedAt on the awards cursor row
  - A district event is watched for 24 hours after its window, on a 5 minute cadence, with a forced look every 15 minutes
  - The catch up rotates by lastPolledAt, stamped on every ask
metrics:
  started: 2026-10-10T03:04:19Z
  completed: 2026-10-10T04:15:00Z
  duration: about 71 minutes
  tasks: 6
  files: 16 committed, 1 uncommitted
actuals:
  tokens: 82218
  tasks: 6
  commits: 6
---

# Quick Task 261009-tx6: The Worker's awards watch, closed out

The published Locked is no longer taken back at the award stage: a recorded award is read only once its own event says it is given, the ceilings and floors count what is still open at a played event, the flag waits for the awards list to stand unchanged for an hour, and the Worker keeps looking at a district event for a day after its window closes.

Base commit `aa888eba` (the code tree of `036f2216`; the orchestrator's docs only commit landed between the brief and my first commit). Not pushed. Not deployed.

## Commits

| Task | Commit | Subject |
| ---- | ------ | ------- |
| 1 | `a7c77122` | fix(261009-tx6): the published verdicts count an award only once its own event says it is given |
| 2 | `e9dab2d7` | fix(261009-tx6): the published ceilings count what is still open at an event a team has already played |
| 3 | `0ac3c524` | fix(261009-tx6): the awards flag also waits for the list to settle for an hour |
| 4 | `11190093` | feat(261009-tx6): the manifest keeps a district window for a day after it closes, and one read hands it to the tick |
| 5 | `d971b1d1` | feat(261009-tx6): the district pass watches an event for a day after its window, with a forced look every 15 minutes and a catch up |
| 6 | `8fb29c8a` | feat(261009-tx6): every PNW district event's award stage replayed through the watch, and the doc and the methodology state the new rules |

Each task's tests were written first and seen red before the code (Task 1: 7 failing, Task 2: 11, Task 3: 20, Task 4: 10, Task 5: 18). One commit per task, as the plan asks, so there are no separate test commits. The Task 6 replay passed on its first run, because it verifies Tasks 1 to 5. I checked that it bites: with the open category walk switched off in a scratch edit, all eight event replays fail. The edit was reverted with `git checkout -- packages/harness/districtRankingsMerge.ts` before anything was staged.

## What the Worker now does, tick by tick

Every minute the tick reads the live windows manifest once. That one read now returns two lists: the windows that are live, and the district windows that closed within the last 24 hours.

1. **Nothing live, no district window in its 24 hours.** The tick ends there. One R2 read, no TBA request, no D1 call. Unchanged from before, and pinned by a test at a forced look minute over five window shapes.
2. **Nothing live, a district event inside its 24 hours.** On a minute that is not a multiple of 5 the tick still ends there, at the same cost. On a multiple of 5 the district is asked: one cursor read, a check that live writes are not suspended, one conditional rankings request, and one conditional awards request per event that has an awards cursor row. If nothing changed, nothing is read from R2.
3. **A minute that is a multiple of 15, the forced look.** The rankings are asked with no ETag and the artifact is always read. Every watched event whose flag still waits is asked for its awards, with or without a cursor row. An event whose window has ended is asked even when its published state says its playoffs are open. Up to 8 older events of that district that still wait (their watch ended before their awards or points landed) are asked as well, the ones never asked first and then the one asked longest ago.
4. **A district with an event the tick processed (folded or promoted this tick)** is asked every minute, as before. The forced look applies to it too.
5. **A calendar window** (an event the corpus held no match for) is watched only once its own match cursor shows a folded match. Until then its district costs one D1 read on the 5 minute marks and no request.
6. **The flag.** An event's `awardsPosted` turns true only when a judged award is listed, AND award points for the event are in the rankings, AND the awards list has been unchanged for 60 minutes. The time the list last changed is kept on the event's awards cursor row. Winner records are still written the moment TBA lists them.
7. **The verdicts.** A recorded winner is counted only once its own event says the award is given. While an event a team has played still has an open category, that category's ceiling is in the team's ceiling and the points it already carries there are out of its floor. So a rival's award points landing moves no verdict.

The live windows manifest keeps a closed district window for the same 24 hours, so a manifest rebuilt inside that day does not end the watch. That half takes effect at the next publish of the manifest. It is not part of the Worker bundle.

## The zero flip gates

Baseline dump taken at `036f2216` before the first edit (`tx6-before`).

Planner dump against my baseline:

```
artifacts 109 | differing 0 | carried events 1124 | awardsPosted true before 1124 after 1124 | flips 0 | qualifyingAwards entries before 3251 after 3251
R9X COMPARE CLEAN
```

Baseline against after Task 1 (D3):

```
artifacts 109 | differing 0 | carried events 1124 | awardsPosted true before 1124 after 1124 | flips 0 | qualifyingAwards entries before 3251 after 3251
R9X COMPARE CLEAN
```

Baseline against after Task 2 (D8):

```
artifacts 109 | differing 0 | carried events 1124 | awardsPosted true before 1124 after 1124 | flips 0 | qualifyingAwards entries before 3251 after 3251
R9X COMPARE CLEAN
```

Baseline against the final tree, after Task 6 (an extra run, not asked for):

```
artifacts 109 | differing 0 | carried events 1124 | awardsPosted true before 1124 after 1124 | flips 0 | qualifyingAwards entries before 3251 after 3251
R9X COMPARE CLEAN
```

No event's flag, no award list, no ceiling and no verdict changed in any published artifact. No republish is owed for the verdict changes.

## The replay over the eight derived PNW events

`apps/worker/test/scheduled.district.test.ts`, describe "the award stage of every 2026 PNW district event, replayed through the watch". Nine tests, all passing. The event list is derived from the fixture and asserted to have 8 entries: `2026orore`, `2026orsal`, `2026orwil`, `2026waahs`, `2026wabon`, `2026wasam`, `2026wasno`, `2026wayak`.

Premise, pinned first: the baseline (the fixture with a finished state block on every row, through the verdict pass) has the same `districtLock.status` as the fixture file for all 126 teams (42 locked, 8 lockedAward, 76 eliminated).

Each event runs 16 ticks through the real `runTick`, nothing live, one window that closed ten minutes before the first tick:

| Tick | What TBA serves | Asserted |
| ---- | --------------- | -------- |
| 12:05 | Winner and Finalist, the rankings as the rewound rows | flag false, no record at this tier |
| 12:10 | the judged awards of the fixture | every record written in one put, flag false, every team's `districtLock` deep equal to 12:05 |
| 12:15 forced | nothing new | rankings request with no `If-None-Match`, flag false |
| 12:20 | the rankings with the award points | points written in one put, flag false, every team's `districtLock` deep equal to 12:10 |
| 12:25 to 13:10, every 5 minutes | nothing new | no put and flag false on all ten ticks, 13:10 (minute 60) included |
| 13:15 forced | nothing new | flag true, one put |
| 13:20 | nothing new | no district read, no put |

Result on all eight events:

- **No published lock is taken back on the award stage walk**, at either tier. A team that reads `locked` or `lockedAward` in `districtLock` after one tick reads one of the two after every later tick, and the same for `champLock` with `prequalified` counted as held. The assertion collects every loss into a list and requires it empty, per event.
- The end state is the published one: for every team the event's state block, its `qualifyingAwards` entries at the event, the whole `districtLock` object, `pointTotal`, `rank`, `maxRemainingDistrict` and `maxRemainingChamp` equal the baseline's, and `districtLock.status` equals the fixture file's.
- `frc9430` on `2026orsal` and `frc5920` on `2026orore`, the two teams the old ceilings took a Locked back from, are each named in their own assertion. Neither loses a held place. `frc9430` reads contending from 12:05 to 13:10 and locked from 13:15. `frc5920` reads contending from 12:05 to 13:10 and eliminated from 13:15. Neither is shown Locked and then not locked.

Status counts while the event's award stage is open, from the verdict pass on each rewound artifact (a scratch run of the same pure function the tick calls; the replay asserts the tick's verdicts do not move between 12:05 and 13:10):

| Event | District while open: locked, lockedAward, contending, eliminated | Champ while open: locked, lockedAward, contending, eliminated |
| ----- | --- | --- |
| 2026orore | 36, 7, 17, 66 | 11, 8, 4, 103 |
| 2026orsal | 37, 7, 13, 69 | 12, 8, 2, 104 |
| 2026orwil | 36, 7, 15, 68 | 12, 8, 3, 103 |
| 2026waahs | 37, 7, 11, 71 | 11, 8, 3, 104 |
| 2026wabon | 35, 7, 14, 70 | 12, 8, 2, 104 |
| 2026wasam | 35, 7, 18, 66 | 11, 8, 3, 104 |
| 2026wasno | 34, 7, 19, 66 | 12, 8, 2, 104 |
| 2026wayak | 35, 7, 15, 69 | 12, 8, 2, 104 |
| every event, settled | 42, 8, 0, 76 | 12, 8, 2, 104 |

The same replay with the ceilings as they were before this task takes back six published Locked verdicts (the planner's measurement, and the take back is visible in the first red run of my own synthetic Task 2 test).

### Scope of the claim

This is asserted for the AWARD stage only: Winner and Finalist listed, the judged list, the award points, the hour of quiet, the settle. Every earlier category of the replayed event is already final at the first tick. The same gap one category earlier (qualification done, alliances picked, playoffs done, each while TBA's district rankings have not caught up with the match results) is NOT covered. It is the subject of quick task **261009-vp9**, "a category counts as finished only when its points are in". That task changes one function, `publishedCategoryFinality` in `packages/harness/districtRankingsMerge.ts`, which is the only place the published verdicts read category finality (a test reads the source and holds it to one call site). I did not build that walk and did not make the helper read the rows.

## The subrequest bound

Reading R26, held by a test: nothing live, one district with ten watched events that all wait (each with the costliest cursor row: a matching ETag and no change time) and ten catch up candidates, on a forced look. Asserted: `subrequestsUsed` at most 55 (1 manifest read, 1 cursor read, 2 for the suspension check, and 3 x 10 + 2 x 8 + 5 for the district), exactly 20 awards requests for the watched events and exactly 8 for catch up events, and `subrequestsUsed` equal to the R2 calls plus D1 calls plus TBA requests the fakes recorded. By my own count that tick spends 54: nothing differs, so there is no put. A second test asserts the same equality on a forced look with one waiting event.

| Tick | At most, for one district with M members and C catch up events |
| ---- | --- |
| A forced look | 3M + 2C + 5 |
| Not a forced look, the district passes the gate | 3M + 4 |
| Not a forced look, the district does not pass the gate | M + 1 |
| No district is due | nothing beyond the tick's one manifest read |

In TBA requests a forced look costs one unconditional rankings request per processed district, which is one full rankings body per watched district every 15 minutes, plus at most two awards requests per waiting member and one per catch up event.

## Every pin that moved, and why

### Task 1 (D3)

- `packages/harness/districtRankingsMerge.test.ts`, "the winner recorded while the flag still waits on points holds the slot twice": REPLACED by the three state walk the plan asks for. At Task 1 it pinned A locked, locked, locked with C `lockedAward` only in the third state. No other test moved.

### Task 2 (D8)

All five are in `packages/harness/districtRankingsMerge.test.ts`, and every one moved for the first allowed reason, an open category at a played row now counts.

| Test | Event, category | Before | After |
| ---- | --------------- | ------ | ----- |
| the tracer, assertion 5 | `2026ncpem`, awards (playoffs done, awards not posted) | `maxRemainingDistrict` 0, drop of 83 | 15, drop of 68 |
| "a team the artifact DOES carry still sums its own published remaining events" | `2026ncpem`, awards | frc1 0 | frc1 15, frc2 still 0 |
| the state write path test, retitled "leaves pointTotal and rank untouched, raises both ceilings by the two categories the observation reopened" | `2026ncwak`, playoffs and awards (the observation says both are open) | both ceilings untouched | both ceilings plus 45 on both teams |
| lock regression, "the first list, Winner and Finalist" | `2026ncpem`, awards | A locked | A contending (B, on 30, can still be given 15 and reach A's 40) |
| the three state walk of Task 1 | `2026ncpem`, awards | locked, locked, locked for A | contending, contending, locked. Its invariants are unchanged: the record alone moves nothing, C is `lockedAward` in the third state only, no held place is lost |

No pin moved in `apps/worker/test/scheduled.district.test.ts` or `scripts/publishDistricts.test.ts` in Task 2, so neither file was edited in that task. No fixture's stored ceiling needed correcting.

### Task 3 (D1), reworked 261009-r9x tick tests

`NOW_MS` in `apps/worker/test/scheduled.district.test.ts` moved to 12:01:00Z first; all 45 tests passed unchanged.

| Test | Rework |
| ---- | ------ |
| the five tick sequence | now seven ticks. The tick that brings the points (12:03) asserts the flag FALSE. A passing tick 59 minutes after the list last changed asserts false with no put, the tick at 60 minutes asserts true with the winner `lockedAward` in that one put. The late Engineering Inspiration tick and the quiet tick moved after the settle tick. |
| (a) the points arrive one tick before the judged list | the tick the list changes asserts false with the winner recorded; 59 minutes later false; 60 minutes later true with `lockedAward`. |
| (b) the points arrive late | the row is seeded as settled (same ETag, 61 minutes old), so the tick that brings the points still turns the flag true. The first tick now makes two asks. |
| D8 (ii) | the tick after the failed ask merges the list and asserts false (a list stored over a marker reads as changed now); a passing tick 60 minutes later asserts true. |
| "turns awardsPosted true on an Impact list..." | row seeded as settled; two asks. Retitled with "settled". |
| "asks twice for the row the old code left behind" | row seeded as settled, retitled. The old Worker's row (an ETag and no change time) has its own new test, where it reads as changed now. |
| "still asks when THIS tick's match poll was a 304..." | row seeded as settled; two asks. |

In `packages/harness/districtRankingsMerge.test.ts` the `withAwards` helper passes every listed event as settled by default, and six direct calls gained the settled set, so each existing case still turns on the first two facts. One new case covers the settled set through `applyDistrictEventAwards` and both entry points.

### Task 6 (D10)

`EXPECTED_LIMITS` in `districtLedgerContent.test.ts`: the title "Awards posted after every event in the district has finished wait for the next offline republish" is replaced by the two new titles, in table order.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] A District Championship Winner counts once the playoffs are FINAL, which is `playoffsDone` or `awardsPosted`. The plan says `playoffsDone` alone.**
- **Found during:** Task 1, reading `reservedChampSlots` against the plan's gate.
- **Issue:** `reservedChampSlots` returns zero once `awardsPosted` is true, whatever `playoffsDone` says ("awards final zeroes the winner reservation too"). With the plan's literal gate, a Winner at an event whose awards are posted while its playoffs flag never turned true would be neither reserved for nor counted. That is the one direction that can publish a Locked that is not true. Reading R5 creates exactly that shape on purpose (a forced look raises the flag at an ended event whose published `playoffsDone` is false), and R5's sentence "the Winner stays reserved for and uncounted until the state says the playoffs are done" does not hold once the flag is true, because the reservation has already gone.
- **Fix:** `awardQualifiedSets` counts a Winner when `state.playoffsDone || state.awardsPosted`. It is the cascade's playoff finality, the rule `champLedgerStatus.ts` applies in the browser (`awardStage.elim`), and a superset of the plan's rule, so every behavior the plan lists holds: with `awardsPosted` false it is exactly `playoffsDone`. An award is reserved for or counted and never both, in every state. One extra test pins the shape.
- **Files modified:** `packages/harness/districtRankingsMerge.ts`, `packages/harness/districtRankingsMerge.test.ts`
- **Commit:** `a7c77122`
- **Gate:** the publisher comparison is clean with it.

### Executor readings where the plan did not name the case

**2. The pass applies the 24 hour bound itself.** The plan has `districtRefresh.ts` import `DISTRICT_AWARDS_WATCH_MS`. The loader already selects by it, so I gave the import a job: a watch window is a member only while `startMs <= now < endMs + DISTRICT_AWARDS_WATCH_MS`, the same half open comparison the builder keeps a window by. `scheduled.ts` imports the constant from `manifestSchemas.ts` directly and passes it to the loader.

**3. A catch up event whose list is the one already stored keeps its ETag and its change time; only `lastPolledAt` moves.** R6 says the row is always written and that the ETag and `lastAdvancedAt` follow R7. For an unchanged list R7 writes nothing, so the always written row carries the stored values with the new ask time.

**4. Catch up events are not put in the state map.** Nothing was observed about them, so the merge is handed their list and the settled set only, and raises the flag on the rows the artifact already carries.

**5. A duplicated row for one event counts its ceiling once.** `openAtPlayedRows` counts an open category's ceiling once per event per team and takes the earned points of every such row out of the floor. TBA sends one row per event, so this only matters for a malformed input.

**6. The no starvation test's rotation claim stops covering the event that can post once it has posted.** It leaves the candidates when its flag turns true, so from then on any two consecutive looks cover the ten that cannot post. The test pins the exact looks: first asked at 12:30, asked every second look, true at 13:30.

**7. The pooled pool reads the same any tier event state map as the ceilings and floors.** R20 says the pool is switched to the one helper with no change in behaviour. For a district tier event the map holds exactly the block the old district tier only walk found, and the publisher comparison is clean, so the old walk (`districtTierStateByEvent`) is deleted.

**8. Two tests beyond the plan's list:** a builder case for a district abbreviation with no `districts` row for that year (a null joined key, so not a district event: dropped when it closes), and `awardsListSettled` returning false for a change time in the future.

**9. An extra limit in the operations doc.** A published `playoffsDone` that a republish from an older corpus set back to false is not repaired by the pass (the event is still asked once its window has ended, and its flag can still turn true). The doc names quick task 261009-ul3 for the publisher side, as CONTEXT D7 does.

**10. No STATE.md, ROADMAP.md or quick tasks row.** The brief says no `.planning` commits, so those are left to the orchestrator. The todo is edited and uncommitted.

**11. File edits were made with the Edit and Write tools and small scratch scripts, not shell heredocs.** A quoted heredoc containing an apostrophe fails in this shell ("unexpected EOF while looking for matching quote"), which matches the known heredoc problem on this machine.

### STOP rules

None fired. Both publisher gates printed their clean line, the replay showed no held place lost on any event at either tier and no final difference, and no measure script printed a violation or drift.

## The settle time's limit

The 60 minute rule closes the window in which a held slot was released at the first judged award with points. Its limit is stated in `eventAwards.ts`, in the pass's header and in the operations doc, and here: **an award listed more than an hour after the list last changed lands after the flag is true.** It is still recorded on the tick its list changes, but the slot held for it was released when the hour ran out. No todo item is added for it (reading R27).

Two related limits remain and are in the doc. Awards or points that land more than 24 hours after an event's window closed wait for the catch up, which runs the next time that district is watched, 8 events per forced look; the flag stays false until then, so the reservations stay held. An event whose window is still open and whose state says its playoffs are open is not asked for awards.

## Verification, as printed

| Gate | Result |
| ---- | ------ |
| Task 1 tests (4 files) | 4 passed, 228 tests passed |
| Task 2 tests (merge, browser safe schemas, publisher, all of `apps/worker/test`) | 30 files passed, 720 tests passed |
| Task 3 tests (3 files) | 3 passed, 174 tests passed |
| Task 4 tests (6 files, `publish.test.ts` and `publishLiveWindows.test.ts` included) | 6 passed, 418 tests passed |
| Task 5 tests (all of `apps/worker/test`, merge, browser safe schemas) | 29 files passed, 676 tests passed |
| Task 6 tests (the district test file and the methodology content test) | 2 files passed, 106 tests passed |
| Full root `npx vitest run`, after Task 2 | 350 files passed, 8287 tests passed, 1 skipped |
| Full root `npx vitest run`, after Task 3 | 350 files passed, 8305 tests passed, 1 skipped |
| Full root `npx vitest run`, after Task 6 | 350 files passed, 8352 tests passed, 1 skipped |
| Four typechecks, after every task | `TYPECHECKS CLEAN (root, web, e2e, worker)` |
| `measureChampJointLocks` | 48 championships swept, `VIOLATIONS: none` |
| `measureChampTenets` | 109 seasons swept, `VIOLATIONS: none` |
| `measureLedgerTenets` | tenet A 0, tenet B 0 |
| `measureLedgerSettledTenets` | `VIOLATIONS: none` |
| `measureChampCutoff --check-history` | `no drift` for both generated files, nothing regenerated |

The five measure scripts were run at `036f2216` before the first edit and again on the final tree. The champ tenets, ledger tenets and cutoff outputs are byte identical. The joint locks and settled tenets outputs differ in one line each, the elapsed time. Every total is identical.

## Scope fence

`git diff --name-only aa888eba..HEAD` lists 16 files, all in the plan's `files_modified`, none under `.planning/`. Under `apps/web` only `districtLedgerContent.ts` and its test changed, content only. Untouched: `apps/worker/src/stateStore.ts`, every file under `apps/worker/migrations`, `packages/harness/pageArtifacts.ts`, `scripts/publishDistricts.ts`, `scripts/publishDistricts.test.ts`, `packages/harness/publish.ts`, `scripts/publishProbeStubs.ts`, every algorithm version file. No artifact schema change, no algorithm version change, no D1 migration. The static import assertions for `districtRefresh.ts` and `districtEventState.ts` pass, and `browserSafeSchemas.test.ts` passes for the merge and for `manifestSchemas.ts`. `runDistrictRefresh` never throws: its cursor read and its suspension check each sit in their own try, and two tests pin `runTick` resolving on each failure. `reservedSlots.ts` changed in comment lines only (every changed line starts with ` *`).

## What a Worker deploy will now ship that differs from before this task

Walked from `apps/worker/src/scheduled.ts` over value imports. Of the 16 changed files, 7 are in the bundle:

| File | Kind of change |
| ---- | -------------- |
| `apps/worker/src/districtRefresh.ts` | code: the watch set, the two cadences, the proof for a calendar window, the suspension check, the forced look, the catch up, the settle clock on the awards cursor row |
| `apps/worker/src/scheduled.ts` | code: `loadTickWindowsAt` in place of `loadLiveEventsAt`, the lazy algorithm context declared above the first early return, and the district pass called from three places |
| `apps/worker/src/liveWindows.ts` | code: `loadTickWindowsAt`, sharing one scan with `loadLiveEventsAt` |
| `packages/harness/districtRankingsMerge.ts` | code: the award gate, the ceilings and floors, `publishedCategoryFinality`, `dcmpStillAhead` read off the incoming artifact, the carried seed, the settled set |
| `packages/core/districts/eventAwards.ts` | code: the third fact of the live rule, `AWARDS_SETTLE_MS`, `awardsListSettled` |
| `packages/harness/manifestSchemas.ts` | code: one new exported constant, `DISTRICT_AWARDS_WATCH_MS` |
| `packages/core/districts/reservedSlots.ts` | comment only |

Not in the Worker bundle: `packages/harness/manifests.ts` (the offline builder's retention of a closed district window, which takes effect at the next publish of the live windows manifest), the two methodology files, the doc and the tests. The methodology change ships with the Pages deploy a push triggers. The deploy also ships every Worker bundled change made since the last deploy; I cannot see the deployed version from here.

One thing to know before the deploy: until a live windows manifest built by the new builder is published, the manifest in R2 holds no closed district window, so the Worker's watch of ended events starts with the next manifest publish. Live districts, the forced look and the catch up work against the current manifest at once.

## Release hand off (D6)

Not pushed, not deployed. Owed by the orchestrator: commit the planning files and the todo, check `origin/main..main`, push, watch CI, then `npx wrangler deploy` from `apps/worker` on a clean tree at the pushed SHA, then watch two ticks. No district republish is owed.

## Todo

`.planning/todos/pending/champ-joint-lock-follow-ups.md` (edited, NOT committed), the 261009-r9x section only: (a), (b), (d), (e), (f) and (g) are struck, each prefixed "CLOSED by quick 261009-tx6." with one clause naming what closed it. (c) is one line: the first real observation is the first 2027 district event, and the replay test stands in until then. Nothing else in that section is open. No other section was touched, and the file was clean in git when I edited it.

## Known Stubs

None.

## Self-Check: PASSED

- All 16 changed files exist, and `packages/harness/districtRankingsMerge.ts` exports `publishedCategoryFinality`.
- Commits `a7c77122`, `e9dab2d7`, `0ac3c524`, `11190093`, `d971b1d1`, `8fb29c8a` are in `git log`.
- Working tree after the last commit: only the todo (modified) and the quick task directories (untracked).
