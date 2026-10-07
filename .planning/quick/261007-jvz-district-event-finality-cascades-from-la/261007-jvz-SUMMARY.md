---
phase: quick-261007-jvz
plan: 01
subsystem: districts
tags: [district-locks, finality, champ-cutoff, tenets, methodology]
status: complete
requires: [261007-il9]
provides:
  - cascading district event finality (districtEventCategoryFinality)
  - eventTierByKey shared by the publisher verdict pass and the District Locks tab
  - awardFinalByEventAtPosition shared by the slot reservation and the consuming award set
affects:
  - packages/harness/districtRankingsMerge.ts recomputeDistrictVerdicts (publisher and Worker)
  - District Locks tab statuses, poll gate, milestone picker
  - Champ cutoff and District cutoff backtests
tech-stack:
  added: []
  patterns: [one rule, many consumers; district wide maps built once per position]
key-files:
  created:
    - .planning/todos/pending/champ-cutoff-2022isr-week-tie.md
  modified:
    - packages/core/districts/reservedSlots.ts
    - packages/core/districts/reservedSlots.test.ts
    - apps/web/src/lib/liveEvent.ts
    - apps/web/src/lib/liveEvent.test.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/districts/districtMilestones.ts
    - apps/web/src/components/districts/districtMilestones.test.ts
    - scripts/measureLedgerTenets.ts
    - scripts/measureLedgerTenets.test.ts
    - packages/core/districts/champCutoffTuning.generated.ts
    - packages/core/districts/qualification.ts
    - packages/core/districts/qualification.test.ts
    - packages/harness/districtRankingsMerge.ts
    - apps/web/src/components/districts/districtLedgerStatus.ts
    - apps/web/src/components/districts/districtLedgerStatus.test.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
    - apps/web/src/components/districts/predictedCutoff.ts
    - scripts/measureDistrictCutoff.ts
    - .planning/todos/completed/champ-cutoff-backtest-season-skips.md (moved from pending)
    - .planning/todos/completed/locks-tab-award-at-uncounted-event.md (moved from pending)
decisions:
  - "District event finality cascades from later stages: award = awardsPosted, elim = playoffsDone or award, alliance = alliancesPicked or elim, qual = full schedule played or alliance"
  - "The District Locks tab counts a consuming Impact award at any event some team's rows resolve to the district tier, from the eventTierByKey map the publisher reads"
  - "2022isr week tie NOT fixed: the district artifact rows carry no start date; recorded as todo champ-cutoff-2022isr-week-tie"
metrics:
  completed: 2026-10-07
  tasks: 3
  files: 23
actuals:
  tokens: 12300
  tasks: 3
  commits: 3
---

# Quick Task 261007-jvz: District event finality cascades from later stages Summary

A later stage's fact now closes every earlier district point category, so curtailed events (2023nhgrs, 52 of 78) and 2022gacar read final. The champ cutoff backtest scores 68 seasons again and reproduces the published 18.2 / 40.4 / 48 of 69 exactly. The District Locks tab now counts an Impact award at any district tier event from one tier map shared with the publisher. Tenet A against the publisher's verdicts drops 4 to 0, and the publisher against tab residual drops 37 teams to 0.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | ea6fa51a | fix(261007-jvz): district event finality cascades from later stages, so curtailed events read final |
| 2 | 0935cabc | fix(261007-jvz): Locks tab counts a consuming award at any district tier event, like the publisher |
| 3 | d27a364e | fix(261007-jvz): methodology district cutoff reads 203 positions of 47 seasons; close two todos; record the 2022isr week tie |

## Verification (read from output)

- `npx vitest run` (repo root, after commit 3): Test Files 344 passed (344); Tests 7944 passed, 1 skipped (7945). After Task 1 alone it read 344 / 7936 passed, 1 skipped.
- `npx tsc --noEmit` for `-p tsconfig.json`, `-p apps/web/tsconfig.json`, `-p apps/web/tsconfig.e2e.json` and `-p apps/worker/tsconfig.json`: each printed nothing.
- Offline publisher rebuild before against after (Task 1): "files compared 119; moved 0; unexplained 0; input moved 0; missing 0". After Task 2 against after Task 1: the same line. The corpus stat was identical before and after.
- `measureChampCutoff --check-history`: "no drift" for dcmpHistory.generated.ts and for champCutoffTuning.generated.ts (after Task 1, Task 2 and commit 3).
- `measureChampCutoff` main mode: SKIPPED 1 (2022isr: district event 2022isde4 is not final at the end of district season position), n = 68, simulated MAE 18.19 against same position naive 40.38, gate 5 "48 of 69 (69.6%)". Gates 1 to 4 PASS, gate 5 FAIL, leak checks 68 of 68. Gate 4 bias read 9.01 after Task 1 and 9.04 after Task 2; nothing else moved.
- Selected tuning settings: diff against HEAD empty (2017 uniform/fixed/1.00, 2018 to 2027 uniform/fixed/1.75). `git diff 117960cd^ -- champCutoffTuning.generated.ts` shows only the Generated line. `--write-history` changed only the Generated line of dcmpHistory.generated.ts, so the file was restored.
- `measureDistrictCutoff`: 108 district seasons, 203 scored positions; Season start n = 47; All positions sim MAE 1.2 against midpoint 1.8; gate 1 PASS "1.15 < 1.77 (n = 203)"; gate 2 FAIL "181 of 203 (89.2%)", three positions above the 178 ceiling; 2022ont skipped; 71 district tier events with no artifact on disk, 0 scored positions with an unpriced open event. Task 2 left the output identical.
- `measureLedgerTenets`, default yardstick: T0 (HEAD) 0 / 0; after Task 1 0 / 0; after Task 2 and commit 3 0 / 0, unresolved tie 0, seasons with an unfinished district tier event at now 0 (19 before).
- `measureLedgerTenets --dir` on the rebuilt artifacts: 0 / 0 after Task 1 and after Task 2.
- `districtVerdictCompare` against publishedFinalVerdicts: after Task 1 tenet A 4 (2019fma frc5113 and frc6943, at 2019paben:awards and at now), tenet B 0, residual 37 (contending vs locked 2, eliminated vs contending 2, lockedAward vs eliminated 3, lockedAward vs locked 30). After Task 2: tenet A 0, tenet B 0, unresolved tie 0, no residual kind, 0 residual rows. District tier fields moved: 0.
- `measureChampTenets`: 0 / 0 after Task 1 (Locked 7,243, Locked out 271,471, held back 44,404 over 4,212 positions) and after Task 2 (Locked out 271,506).

### Tenet census (default yardstick)

| Census line | HEAD | After Task 1 | After Task 2 |
|---|---|---|---|
| tenet A / tenet B / unresolved tie | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Locked on points shown | 76,390 | 77,202 | 76,964 |
| Locked out shown | 166,590 | 167,428 | 167,429 |
| Locked · award chip | 24,192 | 24,192 | 24,466 |
| Slots held back | 26,604 at 3,804 | unchanged | unchanged |
| Pooled only locks | 6,296 at 1,029 | 6,552 at 1,074 | 6,512 at 1,073 |

Every figure matches the planner's simulation.

## Test files edited, by triage class

- packages/core/districts/reservedSlots.test.ts: class 1. "leaves a null qualMatchesTotal unfinished" and "reads each category off its own state fact" were retitled to the cascade with CANCELLED_BUT_AWARDED now final. The partly played and null total opens keep every later fact false, and the two finals were added. New cases cover 2023nhgrs, 2022gacar, alliances only, the divisioned DCMP parent, the 2020 cancellations, the all open shapes, a 24 combination monotone enumeration and the two 2020 carve out neighbours.
- apps/web/src/lib/liveEvent.test.ts: class 1. "never calls an event finished while its schedule length is unpublished" now reads the divisioned parent shape finished and the bare null schedule unfinished. Added the curtailed poll gate case.
- apps/web/src/components/districts/districtLedgerRows.test.ts: class 1. Each single fact override sets its later facts false, so the assertion still isolates that fact. Added one cascade assertion. The posted award fixture at 1874-1905 did not fail, so no class 2 literal was needed.
- apps/web/src/components/districts/districtMilestones.test.ts: additions only (the 2020, 2023nhgrs and 2022gacar cases).
- apps/web/src/components/districts/districtLedgerStatus.test.ts and packages/core/districts/qualification.test.ts: additions only.
- scripts/measureLedgerTenets.test.ts: floors re-pinned to the measured values, with a dated comment. Equality and reservation pins are unchanged.

No class 3 or class 4 failure occurred.

## Read only conclusions

- Worker (apps/worker/src/districtEventState.ts, districtRefresh.ts 235-271): unchanged. It derives the four facts and requests `/event/{key}/awards` only once the match derived `playoffsDone` is true. It picks up the cascade only through recomputeDistrictVerdicts (`districtEventCategoryFinality(stateByEvent...)` in districtRankingsMerge.ts). A side note: a live 2022gacar shape (one playoff row never played) would never get its awards requested by the Worker. That behaviour already existed and is out of scope.
- pointPool.ts and pooledLockInputs.ts consume finality through their inputs and are unchanged. champReservedSlots.ts `dcmpNeverHappening` reads only `districtEventStateStarted`, which is byte for byte unchanged. Their tests pass unedited.
- Poll gate: no code change. A curtailed event now finishes once its later stages close, so it stops polling. The limitation remains for an event abandoned before alliance selection.
- champLedgerStatus.ts: its award scan resolves dcmp keys district wide through `dcmpEventKeysFor(artifact)` and gates on the team's own championship stage. It has no own rows guard, so it was not changed.
- districtFieldOverlay.ts line 140: the award only invitee check still reads the team's own rows. It is a display rule for EI and RAS invites, not a guarantee, and was left unchanged.

## The 2022isr week tie (orchestrator addition)

NOT FIXED, because the data does not allow it. DistrictTeamEventPointsSchema and DistrictTeamRemainingEventSchema (packages/harness/pageArtifacts.ts) carry eventKey, eventName, week, tier, points and state, and no start date. The DistrictArtifact top level has no dated event list either. champTierEvents builds the rail from those rows, so it sees only eventKey, eventName, week and tier. The per event EventArtifactSchema does carry startDate, and data/local-publish/district-events holds 2022isde4.json (startDate 2022-03-22). There is no 2022iscmp file, and the backtest builds its rail with NO_EVENT_ARTIFACTS by design. No date was invented. The todo champ-cutoff-2022isr-week-tie records the evidence, the missing field and two candidate fixes: a tier tie break within one week, which needs no new field, or a start date added to the district artifact rows. The champ figures did not move, so the Champ cutoff sentence and its pins stayed as they were, and no history or tuning drift arose from this item.

## Deviations from Plan

- [Orchestrator instruction] The plan's output section said not to write SUMMARY.md. The orchestrator's constraints asked for it, so this file was written and is left uncommitted.
- [Rule 2, doc accuracy] packages/harness/districtRankingsMerge.ts recomputeDistrictVerdicts doc (around line 391) still cited the open todo locks-tab-award-at-uncounted-event as the cause of the four residual rows. It was updated in commit 2 to state the 0 and 0 result. This is a comment only change in a file already in Task 2's list.
- The champ-cutoff-backtest-season-skips closing note cannot quote commit 3's own hash, so it names ea6fa51a and "the commit that moved this file" (d27a364e).

## Known Stubs

None.

## Threat Flags

None. No new network, auth or file access surface. No `.env` access, and every rebuild ran with `--dry-run --no-bake --local-out` into the scratchpad.

## Left out / for the orchestrator

- Release is owed: `pnpm rebaseline` (Worker deploy carries the cascade through the shared verdict pass; the district republish should be byte identical apart from stamps). No version bump is owed.
- Not committed by design: this SUMMARY.md, PLAN.md and STATE.md. ROADMAP.md was not touched. No foreign files appeared in `git status` during the run, and no foreign commit was interleaved (870174cc, then ea6fa51a, 0935cabc, d27a364e).

## Self-Check: PASSED

- Commits ea6fa51a, 0935cabc and d27a364e are present in `git log`.
- `git show --name-status -M HEAD` lists the two R renames and A champ-cutoff-2022isr-week-tie.md. Each completed todo holds the release line exactly once at HEAD.
