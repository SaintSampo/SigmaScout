---
phase: quick-261009-r9x
plan: 01
subsystem: districts
tags: [worker, districts, locks, awards, tba, d1-cursor]
status: complete
requirements_completed: [261009-r9x]
requires:
  - 260925-ms7 (the Impact reservation)
  - 261006-3gg (the champ reservation)
  - 261009-pgq (where follow up 18 was found)
provides:
  - packages/core/districts/eventAwards.ts (awardsPostedRule at two vantages, qualifyingAwardRecord)
  - applyDistrictEventAwards in packages/harness/districtRankingsMerge.ts
  - the Worker district pass under R-A2, R-B and D8
affects:
  - apps/worker (deploy owed, orchestrator)
  - scripts/publishDistricts.ts (output unchanged, zero flips)
tech-stack:
  added: []
  patterns:
    - one rule function with a vantage argument, called by both producers
    - cursor row as "ETag of the last list merged", null ETag as a retry marker
key-files:
  created:
    - packages/core/districts/eventAwards.ts
    - packages/core/districts/eventAwards.test.ts
  modified:
    - packages/harness/districtRankingsMerge.ts
    - packages/harness/districtRankingsMerge.test.ts
    - apps/worker/src/districtRefresh.ts
    - apps/worker/src/tbaPoll.ts
    - apps/worker/src/districtEventState.ts
    - apps/worker/test/scheduled.district.test.ts
    - scripts/publishDistricts.ts
    - scripts/publishDistricts.test.ts
    - docs/worker-operations.md
    - apps/web/src/components/districts/champLedgerStatus.ts
    - packages/core/districts/champJointLock.ts
    - packages/core/districts/reservedSlots.ts
  uncommitted:
    - .planning/todos/pending/champ-joint-lock-follow-ups.md
decisions:
  - The live flag needs a judged award listed AND award points in the rankings merged that tick; hindsight needs either
  - The awards cursor row holds the ETag of the last list merged; a null ETag is a retry marker
  - A failed ask before the gate on a tick that does not pass the gate writes no marker (the flag cannot be known without the R2 read)
  - The published verdict holds a recorded winner's slot twice while the flag waits (P4), kept as planned and pinned
metrics:
  started: 2026-10-10T00:24:24Z
  completed: 2026-10-10T01:02:00Z
  duration: about 38 minutes
  tasks: 4
  files: 14 committed, 1 uncommitted
actuals:
  tokens: 37190
  tasks: 4
  commits: 4
---

# Quick Task 261009-r9x: The awards posted flag waits for real awards, and the live Worker records who won

The Locks guarantee can no longer release held slots on a Winner and Finalist only list: the flag turns true only on a judged award whose points are in the merged rankings, the Worker writes who won in the same R2 put, and a changed awards list passes the gate by itself.

Base commit `c5029590`. Not pushed. Not deployed.

## What changed, in plain terms

**The flag rule.** `state.awardsPosted` is what ends the reservation on both Locks tabs. One function now decides it for both producers, `awardsPostedRule(facts, vantage)` in `packages/core/districts/eventAwards.ts`. It reads two facts about one event: is an award other than Winner (1) and Finalist (2) listed, and does some team's row at that event carry award points above zero.

- Live (the Worker): BOTH must hold, read on the artifact AFTER this tick's rankings are merged. Winner and Finalist only reads false. A judged award with no points yet reads false. A published true stays true.
- Hindsight (the offline publisher): EITHER is enough, because the corpus is ingested after the event.

**The winner records.** `applyDistrictEventAwards` in the shared merge takes this tick's awards lists and appends, to each recipient that is a team of the district, the `qualifyingAwards` entry that `qualifyingAwardRecord` returns. The offline publisher builds its entries with that same function. The step runs after the rows are merged and before the verdict pass, so the flag, the records, `districtLock` and `champLock` come out of one build and land in one put. Entries are never removed and never doubled. A District Championship division records nothing. An event on no row records nothing.

**Keep asking.** The awards cursor row now holds the ETag of the last awards list the pass MERGED, whatever the flag says. Every member event with a row is asked conditionally before the gate on every tick, and a 200 lets the district through the gate beside a rankings 200 and a match observation. An event whose flag still waits (playoffs done, and either a 304 before the gate or no row) is asked once with no ETag, only on a tick that already read the artifact. A quiet tick reads nothing from R2.

## Commits

| Task | Commit | Subject |
| ---- | ------ | ------- |
| 1 | `d2d4cb61` | feat(261009-r9x): one awards posted rule, one award record builder, and the shared merge records who won |
| 2 | `4bda96ac` | fix(261009-r9x): the awards flag waits for a judged award and its points, the Worker records who won in the same write and keeps asking while the event is live |
| 3 | `8bab7662` | feat(261009-r9x): the offline publisher shares the awards posted rule and the award record builder |
| 4 | `2ee9b85c` | fix(261009-r9x): the operations doc and three comments state the new awards rule |

Each task was written tests first and seen red before the code (Task 1: 16 failing, Task 2: 17 failing, Task 3: 3 failing). The plan asked for one commit per task, so there are no separate `test(...)` commits.

## The zero flip gate (Task 3)

Planner dump against my own before dump, taken at `c5029590` before the first edit:

```
artifacts 109 | differing 0 | carried events 1124 | awardsPosted true before 1124 after 1124 | flips 0 | qualifyingAwards entries before 3251 after 3251
R9X COMPARE CLEAN
```

Before against after (the gate):

```
artifacts 109 | differing 0 | carried events 1124 | awardsPosted true before 1124 after 1124 | flips 0 | qualifyingAwards entries before 3251 after 3251
R9X COMPARE CLEAN
```

Planner baseline: 1124 carried events, 1124 posted true, 3251 qualifyingAwards entries. Identical. No event's flag, no award list and no verdict changed, so no republish is owed.

## Tick by tick tests (apps/worker/test/scheduled.district.test.ts), all passing

The five tick sequence, one test, one district, one finished live event:

| Tick | What TBA serves | Awards requests | Result |
| ---- | --------------- | --------------- | ------ |
| 1 | Winner and Finalist listed, rankings 200 | one, no `If-None-Match`, inside the loop | flag false, nobody recorded, cursor holds `awards-etag-1` |
| 2 | Impact now listed (new ETag), rankings 304, match 304 | one, conditional on `awards-etag-1`, before the artifact read, 200 | gate passes on the list alone, flag false (no points), Impact record on frc3, cursor `awards-etag-2` |
| 3 | rankings bring frc3's award points, list unchanged | two: conditional 304, then no `If-None-Match` | ONE put: flag true, Impact entry exactly once, frc3 `lockedAward` |
| 4 | late Engineering Inspiration (new ETag), rankings 304 | one, conditional, 200 | one put, frc2 holds `{ awardType 9, awardOnly true }`, flag still true, cursor `awards-etag-3` |
| 5 | nothing changed | one rankings 304, one awards 304 | zero `v1/district/` reads, zero puts, district counted unchanged |

The other cases:

- (a) points one tick before the judged list: tick k flag false with ETag stored; tick k+1 the conditional ask returns 200, the gate passes, flag true, winner recorded, one put.
- (b) points late: tick k Impact recorded with the flag false; tick k+1 all 304, no R2 read; tick k+2 rankings 200, conditional 304 then the unconditional ask, flag true, one put.
- (c) District Championship Winner on a quiet tick (parent key `2026pncmp`): the conditional 200 passes the gate, the two district recipients hold `{ awardType 1, label "Winner", awardOnly false }`, the outside recipient is ignored, the flag stays false.
- (f) a failed ask before the gate (HTTP 500): points written, flag unchanged, `districtsFailed` 0, exactly one `district-awards-poll-failed` warn with keys `districtKey`, `eventKey`, `msg`, `reason`, asked once, rankings cursor written, awards row left as a null ETag marker (D8).
- (f) a failed ask inside the loop on a body that fails the schema: same, reason is the fixed phrase, the payload is not logged, a null ETag row is created (D8).
- (f) a failed ask inside the loop on HTTP 503: same, null ETag row created.
- a failed ask for an event whose flag is already true: its row keeps its ETag.
- D8 (i), D8 (ii), D8 (iii): see D8 below.

Every (f) and D8 test also asserts no warn line carries the TBA key value, `X-TBA-Auth-Key` or `If-None-Match`.

### Rewritten tests (reading P11), describe "runTick — the awards fetch"

| Old test | Now |
| -------- | --- |
| "requests /awards exactly once, only after playoffsDone, and a non-empty response sets awardsPosted true" | "asks once after playoffsDone, and a Winner only list leaves awardsPosted false with its ETag stored" plus "turns awardsPosted true on an Impact list whose points are in the rankings, records the winner, and writes once" |
| "leaves awardsPosted false on an EMPTY awards array" | two cases, an empty array and a `null` body: flag false, no throw, no warn, ETag stored |
| "leaves awardsPosted false on a 304 awards response" | "asks twice for the row the old code left behind": conditional 304 then no ETag, and the flag follows the rule in three variants (Winner only with points false, judged without points false, judged with points true) |
| "issues NO awards request for an event whose published state already says awardsPosted true" | "asks once, with no ETag, for an event whose published flag is already true and that has no awards cursor row, and the next tick's ask is conditional" plus "asks nothing more for an event whose flag is already true and whose conditional ask answered 304" |
| "still issues the awards request when THIS tick's match poll was a 304..." | same intent, now with an Impact list plus its points turning the flag true |

Kept unchanged: "makes NO awards request at all while the playoffs are not done" (now also asserts no cursor row), the 260925-ms7 reservation test, the static import assertions. The cheap steady state test also asserts zero awards requests. The old `ONE_AWARD` fixture (a Winner only list expected to read true) is gone.

## D8 as applied (binding addenda not in the plan text)

- **A failed ask is retried.** When an awards ask fails for an event whose flag is not yet true, on a tick that passed the gate, its cursor row is written with a NULL ETag at the end of the tick, created if absent, never the failed response's ETag. Step 2 asks a null ETag row with no ETag, so the next tick's 200 passes the gate. An event whose flag is already true keeps its row. This supersedes R-B's "no cursor written from it" for not yet posted events, and the two (f) tests assert the marker in place of "row unchanged" and "no row written".
- **Cursor write order.** Awards cursors first, then the rankings cursor. A throw in an awards cursor write leaves the rankings cursor unwritten.
- **Three tests added.** D8 (i): gate passes on a match observation with rankings 304, the ask inside the loop fails for an event with no row, a null ETag row is written; next tick everything else is quiet, the row is asked with no ETag before the gate, the 200 passes the gate, the list is merged and its ETag stored. D8 (ii): rankings 200 brings the points while the conditional ask fails, points written, flag false, row ETag null; next tick rankings 304, the unconditional ask returns the judged list, flag true, winner recorded, one write. D8 (iii): an awards cursor write that throws leaves the rankings cursor unwritten, and the next tick's rankings request carries no `If-None-Match` and passes the gate. All three pass.
- **Leftover (d) wording.** The module header, the operations doc and the todo all say an event with no awards cursor row whose district is quiet may not be asked again while it stays quiet, and name the remaining way to get there.

## Decisions and readings as executed

- **R-A2** built as written. The four planner readings: (i) an event with a true flag and no row is asked once with no ETag inside the loop, playoffs done or not; (ii) a list in hand for an event the loop skips is dropped and its ETag is not stored; (iii) a response with no ETag header stores a null; (iv) a row is written only when its ETag would change or no row exists.
- **R-B** built as written, with D8's marker on top.
- **R-C proof.** `champLedgerStatus.ts`: 10 changed lines, 0 non comment. `champJointLock.ts`: 8 changed lines, 0 non comment. `champJointLock.test.ts`: 40 passed before the edit, 40 passed after.
- **R-D** leftovers (a) to (g) are in the todo, with the two struck items named.
- **P4** kept as planned and pinned. See "For the orchestrator" below.
- **P11** rewritten tests listed above. The publisher's existing flag fixtures (types 0 and 5) passed unchanged.

## Deviations from Plan

### Executor readings where the plan and D8 did not name the case

**1. A failed ask before the gate on a tick that does NOT pass the gate writes no retry marker.**
- **Why:** D8 writes the marker "for an event whose flag is NOT yet true". The flag lives on the artifact, and a tick that does not pass the gate reads nothing from R2, which a truth of this plan requires. Nothing was merged on such a tick, so the row's ETag still means "the last list merged" and the next conditional ask is a correct retry. No liveness hole follows from it.
- **Also:** a failed ask for an event the loop skips (no state known, or no row in the artifact) leaves its row untouched.

**2. Leftover (d) names two ways, not one.**
- D8 names "a D1 cursor write failing on the same tick an awards ask failed". The same D1 failure on the tick an event's first list was merged, with rankings 304, reaches the same state, so the header, the doc and the todo say both. They also record the separate case of an event whose flag the offline publisher set true, which has no row until the first tick that passes the gate.

### Auto-fixed Issues

**3. [Rule 1 - Bug] My Task 1 comment said the double hold "only delays" a Locked. It can also take a published Locked back.**
- **Found during:** Task 4, re-reading the P4 sentence against the lock regression fixture.
- **Issue:** see "For the orchestrator". The comment in `applyDistrictEventAwards` and the first draft of the `reservedSlots.ts` and operations doc sentences understated it.
- **Fix:** all three now state it exactly, and the merge test pins the statuses in that window (`contending`, `eliminated`, `lockedAward`).
- **Files modified:** `packages/harness/districtRankingsMerge.ts` (comment), `packages/harness/districtRankingsMerge.test.ts` (one assertion), in the Task 4 commit beside the four files the plan listed.
- **Commit:** `2ee9b85c`

**4. One extra comment word in `reservedSlots.ts`.** "The Worker requests `/event/{key}/awards` only once `playoffsDone` is true" became "first requests", because an event with a cursor row is now asked on every tick. Comment only.

**5. No tracer, no RED commits, no STATE.md updates.** One commit per task as the orchestrator asked. STATE.md, ROADMAP.md and the quick tasks table were left to the orchestrator.

## For the orchestrator: the published verdict can take a Locked back inside the P4 window

P4 says a winner recorded while the flag waits on points holds that event's slot twice in the PUBLISHED verdict, and calls it conservative. It is: it never publishes a Locked that is not true. But it is not only a delay. On the synthetic three team district (two slots, A 40 points, B 30, C 10):

| State | A | B | C |
| ----- | - | - | - |
| Winner and Finalist listed, flag false | locked | contending | eliminated |
| Impact to C recorded, flag still false (no points yet) | **contending** | eliminated | lockedAward |
| The points arrive, flag true | locked | eliminated | lockedAward |

A's published `districtLock` reads locked, then contending, then locked. That is a "shown Locked, then not locked" in the artifact field. I checked what renders it: nothing does. `apps/web/src` reads `champLock.status === "prequalified"` and no other published verdict field, and the Locks tabs compute their own statuses, gating each award on its own event's stage, so on the site A stays Locked throughout. I kept the planned behaviour (`awardQualifiedSets` unchanged, as the plan binds), pinned it in a test, stated it in three comments and the operations doc, and recorded it as leftover (g) with a candidate fix. If the published verdict is ever displayed, that fix is needed first.

The remaining user visible window is leftover (a): TBA lists a judged award WITH its points before it lists Impact at the same event. The flag turns true at that first batch. CONTEXT D5 accepted this.

## Leftovers recorded in the todo

`.planning/todos/pending/champ-joint-lock-follow-ups.md` (edited, NOT committed): item 18 struck through and prefixed "CLOSED by quick 261009-r9x.", and a new section "Added by quick 261009-r9x (the awards flag and the winner records)":

- (a) awards listed in several batches after the first judged award with points
- (b) the live window closing before the ceremony (flag stays false, reservations held)
- (c) no real live district event has exercised this, first observation due at the first 2027 district event
- (d) an event with no awards cursor row whose district is quiet may not be asked again while it stays quiet
- (e) awards or points landing after the live window closes, with the candidate fix
- (f) an offline republish from an older corpus overwriting the live flag and winner records
- (g) the published verdicts consuming a recorded winner's slot and still reserving one, with the measured Locked, contending, Locked sequence

Struck: the points arriving one tick before the list, and the Winner listed on a quiet tick.

## Verification, as printed

| Gate | Result |
| ---- | ------ |
| Task 1 tests (4 files) | 4 passed, 122 tests passed |
| Task 2 tests (`apps/worker/test` plus merge and browser safe schemas) | 29 files passed, 611 tests passed |
| Task 3 tests (publisher plus eventAwards) | 2 files passed, 98 tests passed |
| Task 4 tests (champJointLock plus champLedgerStatus) | 2 files passed, 99 tests passed |
| `measureChampJointLocks` | 48 championships swept, `VIOLATIONS: none` |
| `measureChampTenets` | 109 seasons, 1,073,186 team positions, `VIOLATIONS: none` |
| `measureLedgerTenets` | tenet A 0, tenet B 0 |
| `measureChampCutoff --check-history` | `no drift` for both generated files, nothing regenerated |
| Full root `npx vitest run` | 348 files passed, 8202 tests passed, 1 skipped |
| Four typechecks | `TYPECHECKS CLEAN (root, web, e2e, worker)` after every task |

## Scope fence

`git diff --name-only c5029590..HEAD` lists 14 files, all in `files_modified`, none under `.planning/`. Untouched: `packages/harness/pageArtifacts.ts`, everything under `apps/worker/migrations`, `apps/worker/src/stateStore.ts`, every algorithm version file. No artifact schema change, no D1 migration, no browser lock math change. The static import assertions for `districtRefresh.ts` and `districtEventState.ts` pass, and `browserSafeSchemas.test.ts` passes for the merge. `runDistrictRefresh` still never throws.

## What a Worker deploy will now ship that differs from before this task

Walked from `apps/worker/wrangler.toml`'s entry `src/scheduled.ts` (98 files in the import closure). Of the 14 changed files, 6 are in the bundle:

| File | Kind of change |
| ---- | -------------- |
| `apps/worker/src/districtRefresh.ts` | code: the pass under R-A2, R-B and D8 |
| `packages/harness/districtRankingsMerge.ts` | code: `applyDistrictEventAwards` and the `eventAwards` option on both entry points |
| `packages/core/districts/eventAwards.ts` | new: the rule and the record builder |
| `apps/worker/src/tbaPoll.ts` | comment only |
| `apps/worker/src/districtEventState.ts` | comment only |
| `packages/core/districts/reservedSlots.ts` | comment only |

Not in the Worker bundle: `champLedgerStatus.ts` and `champJointLock.ts` (web, comment only, so a Pages deploy on push changes no behaviour), `scripts/publishDistricts.ts`, the docs and the tests. The deploy also ships every Worker bundled change made since the last deploy (owed since 261006-3gg); I cannot see the deployed version from here.

## Release hand off (D6)

Not pushed, not deployed. Owed by the orchestrator: commit the planning files, check `origin/main..main`, push, watch CI, then `npx wrangler deploy` from `apps/worker` on a clean tree at the pushed SHA. No republish is owed.

## Known Stubs

None.

## Self-Check: PASSED

- `packages/core/districts/eventAwards.ts` and `eventAwards.test.ts` exist.
- Commits `d2d4cb61`, `4bda96ac`, `8bab7662`, `2ee9b85c` are in `git log`.
- Working tree after the last commit: only the todo (modified) and this quick task's directory (untracked).
