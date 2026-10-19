---
quick_id: 261019-oim
slug: tick-overlap-guard-d1-lease-per-tick-so-
description: Tick overlap guard: a D1 lease per tick so a new tick skips events still in flight; a D1 fold lease across invocations; test the as-of lock and the team-artifact cross-event merge; write the After numbers into the 3ju summary
date: 2026-10-19
status: complete
commits:
  task1: b11c857a
  task2: ded4acdf
  task3: 828194d1
files_changed:
  - apps/worker/migrations/0004_event_lease.sql (new)
  - apps/worker/src/eventLease.ts (new)
  - apps/worker/src/scheduled.ts
  - apps/worker/src/boundedConcurrency.ts
  - apps/worker/src/ingestLog.ts
  - apps/worker/test/eventLease.test.ts (new)
  - apps/worker/test/support/eventLeaseFake.ts (new)
  - apps/worker/test/boundedConcurrency.test.ts
  - apps/worker/test/scheduled.test.ts
  - apps/worker/test/scheduled.asOf.test.ts
  - apps/worker/test/scheduled.district.test.ts, scheduled.phaseBWrites.test.ts, scheduled.replay.test.ts, scheduled.rp.test.ts, scheduled.stateBaseline.test.ts, liveAlgorithmTier.test.ts, stateStore.test.ts (lease fake taught to every FakeD1Database)
  - docs/worker-operations.md
  - .planning/quick/261018-3ju-concurrent-tick-events/261018-3ju-SUMMARY.md (After numbers)
tests:
  worker: "30 files, 630 tests (was 29 files, 604)"
  ingest: "12 files, 246 passed, 1 skipped (unchanged)"
  whole_repo: "382 files, 9643 passed, 1 skipped, exit 0 (on 828194d1)"
typecheck:
  worker: "tsc --noEmit -p apps/worker/tsconfig.json exit 0"
  web: "tsc --noEmit -p apps/web/tsconfig.json exit 0"
  root: "tsc --noEmit exit 0"
deployed: "Worker version 071ba371-686d-42b2-a27e-3333096bd454, 2026-10-19 23:05Z, after migration 0004"
decisions:
  - "Two leases, not one. The per-event lease (15 min expiry) makes a later invocation skip windows an earlier one still holds. The fold lease (#fold row, 60 s expiry) is waited for, not skipped, around every Phase A section, so two invocations folding different events rewrite each algorithm's league row one at a time. Both planners flagged that the per-event lease alone left that race open."
  - "Fail open. A lease table that cannot be read warns once (event-lease-unavailable, fold-lease-unavailable) and the tick folds unguarded, so a D1 outage or a missed migration never stops the site folding."
  - "A tick whose every window is held by another tick returns at once and runs no district pass; the tick holding the leases runs it."
---

# Quick task 261019-oim: a D1 lease per tick, a fold lease across invocations, and the two tests 3ju left open

## What changed

- **`event_lease` table** (migration 0004). One row per open live window a running tick holds, plus
  the `#fold` row. Apply order: migration first, then deploy; a Worker running against a missing
  table warns and folds unguarded.
- **Per-event lease** (`apps/worker/src/eventLease.ts`, `leaseOpenWindows` in `scheduled.ts`). Right
  after the idle exit, a non-idle tick takes every open window in ONE D1 batch (an upsert that only
  takes over an expired row) and releases them in ONE statement in `runTick`'s `finally`. Windows
  another unexpired tick holds are skipped, logged once as `events-in-flight`, and counted in the new
  `TickResult.eventsSkippedInFlight`. Expiry 15 minutes, the cron wall time ceiling. An idle tick
  issues no lease statement (every idle pin stayed put).
- **Fold lease** (`withFoldLease`, inside `locks.state`). Every Phase A section first takes the
  `#fold` row, polling every 250 ms on the real clock until `deps.deadlineMs` (default 60 s), then
  releases it in a `finally`. A section that cannot get it by the deadline throws
  `FoldLeaseTimeoutError`; the existing Phase A catch reverts the claim, counts the event failed, and
  the next tick folds the same matches. Expiry 60 s, because Phase A for one event takes seconds.
- **Keyed team lock** (`createKeyedLock` in `boundedConcurrency.ts`, `locks.team`). The team page
  read, merge and write runs one at a time per artifact key in all three places that do it: the
  Phase B team loop, `runLateBreakdownBackfill` and `runScheduleOnlyPricing` (the third was not in
  the design; it rewrites team pages the same way).
- **`RunTickDeps`** gains `tickId`, `leaseClock` and `deadlineMs` (quick task 261019-ooj passes a
  short deadline for webhook ticks). `TickLocks` carries `team`, `tickId`, `clock`, `deadlineMs` and
  `foldLeaseUnavailable`. `runPhaseBAndReport` takes `locks`.

## Tests

- `eventLease.test.ts` (13): the acquire and release SQL on real SQLite (better-sqlite3, migration
  read with CRLF normalised; the numbered placeholders bind as an object there), the functions over a
  SQLite-backed D1 stand-in, fake parity, and the fold lease functions.
- `scheduled.test.ts`, "runTick — overlapping invocations" (8): two invocations on one database (the
  second skips both windows, folds nothing, spends no TBA request, and the state rows equal the
  sequential reference); a foreign unexpired lease skips one window; an expired one is taken over;
  a lease outage fails open with one warn; the team-artifact cross-event merge; the fold lease waited
  for and taken; the fold lease timing out at a short deadline (claim reverted, no state written);
  two invocations folding DIFFERENT events on one database leave the sequential state rows.
- `scheduled.asOf.test.ts`, "the as-of lock" (1): two SPR events folding in one tick with the season
  put held 300 ms: no refused conditional put, both events' tails present. This is the test 3ju said
  it could not write.
- `boundedConcurrency.test.ts` (4): the keyed lock.

Every guard was removed and seen failing, then restored (300 ms holds were enough everywhere):

| Test | Guard removed | Failing assertion |
|---|---|---|
| second invocation skips both windows | every window treated as held | `tbaRequests` 6, expected 0 |
| foreign unexpired lease skips one window | same | `eventsAdvanced` 2, expected 1 |
| one team at two events in one tick | `locks.team.run` bypassed | A's match key missing from the team artifact |
| two SPR events, as-of lock | `locks.asOf.run` bypassed | one refused season put |
| two invocations, different events | `acquireFoldLease` always true | OPR league row count 2 (B erased A), expected 4 |

## Deviations from plan

1. A fourth subrequest pin moved: `SUBREQUESTS_PER_LIVE_TICK` in `scheduled.rp.test.ts`, 84 to 86
   (event lease acquire and release) to 88 (fold lease acquire and release). The other moved pins:
   the probe-only pin and the 304 ingest-log tick in `scheduled.test.ts` (+2 each), and
   `liveAlgorithmTier.test.ts` 8 to 10 (its title now says ten). No idle pin moved. No other
   existing assertion changed.
2. The fold lease lives in a `withFoldLease` helper rather than inline; `acquireFoldLease` takes an
   `onAttempt` callback so each attempt is counted as a subrequest.
3. The fold-lease timeout test checks the cursor's `last_folded_match_key` is null rather than that
   no row exists, because the claim inserts the row and the revert writes the null cursor back.

## What is still not guarded

The `teams/{year}` feed and a team page shared across two INVOCATIONS (one team at two live events
at once, a different team page write landing from each invocation) are read-merge-write without a
cross-invocation lock. The same-event double fold stays covered by the cursor compare-and-swap.

## After numbers for 261018-3ju

Written into `261018-3ju-SUMMARY.md` and `docs/worker-operations.md`. Measured from `ingest_log`,
2026-10-18 12:49Z to 2026-10-19 13:58Z, 435 ticks, never more than 4 events live:

| Slice | Before (1 to 4 events, n=856 / 122) | After (n=435 / 141) |
|---|---|---|
| tick span median / p90 / max | 5 s / 92 s / 176 s | 4 s / 47 s / 85 s |
| post_result_time to published_at median / p90 | 180 s / 271 s | 122 s / 200 s |

The "median 4 s, was 143 s" headline compares against the all-ticks Before median on a 13-event
day; the matched slice shows the gain in the tail and in publish latency. 25 of the 435 After ticks
still ran past 60 s, which is what this task's lease closes.

## Release

- Migration 0004 applied to the remote `sigmascout-state` database before the deploy.
- Worker deployed: see the line below.

Deployed as Worker version 071ba371-686d-42b2-a27e-3333096bd454 at 2026-10-19 23:05Z, after migration 0004 was applied to the remote database (`wrangler d1 migrations apply sigmascout-state --remote -c apps/worker/wrangler.toml`, run from the repo root; from `apps/worker` the same command fails with a 7403 because wrangler picks up the R2-scoped token there).
