---
quick_id: 261018-3ju
slug: concurrent-tick-events
description: Process live events concurrently inside a Worker tick so one-minute cron means one-minute freshness
date: 2026-10-18
status: complete
commits:
  task1: 5c58913a
  task2: 69c97ac1
  deviation_fix: 7690cb52
  task3: 04996326
files_changed:
  - apps/worker/src/boundedConcurrency.ts (new)
  - apps/worker/test/boundedConcurrency.test.ts (new)
  - apps/worker/src/scheduled.ts
  - apps/worker/src/liveEventPass.ts
  - packages/ingest/tbaClient.ts
  - packages/ingest/tbaClient.test.ts
  - apps/worker/test/scheduled.test.ts
  - docs/worker-operations.md
tests:
  worker_and_ingest: "41 files, 850 passed, 1 skipped (TBA_API_KEY live test)"
  scheduled.replay: "1 passed"
  scheduled.rp: "26 passed"
  scheduled.rowParity: "11 passed"
  scheduled.test: "62 passed (2 new)"
  boundedConcurrency.test: "9 passed (new)"
  tbaClient.test: "14 passed (1 new)"
  whole_repo: "381 files, 9617 passed, 1 skipped (run on final committed code 04996326)"
typecheck:
  worker: "tsc --noEmit -p apps/worker/tsconfig.json exit 0"
  root: "tsc --noEmit exit 0"
decisions:
  - "The plan's premise that two events never contend on a D1 row was wrong. Every fold reads and rewrites each algorithm's league row in algorithm_state. Phase A (state read, fold, write) now runs inside a tick-wide serial lock. The as-of write rewrites the shared as-of season object and gets a second lock. TBA requests and artifact I/O still overlap."
  - "EVENT_CONCURRENCY = 6 lives in boundedConcurrency.ts and scheduled.ts re-exports it. liveEventPass.ts imports it from there, which avoids a scheduled.ts <-> liveEventPass.ts import cycle."
  - "The TBA throttle is a turn queue, not a precomputed time slot. Each caller chains onto the previous caller and measures its wait from that caller's actual start. A pure slot reservation failed the concurrent-spacing test under load (a gap of 95 ms) because a late timer squeezes the next gap."
---

# Quick task 261018-3ju: process live events concurrently inside a Worker tick

## What changed

- `mapWithConcurrency(items, limit, fn)` (new, `apps/worker/src/boundedConcurrency.ts`). It starts
  items in input order, keeps at most `limit` in flight, and returns settled results in input order.
  `createSerialLock()` lives in the same file.
- Four per-event passes now run up to `EVENT_CONCURRENCY` (6) events at once: `runProbes`,
  `runRosterPass`, the `runTickCore` fold loop, and `runLiveEventPass`. **The fourth one,
  `runLiveEventPass`, was not in the user's list of three.** It is in scope because it writes the
  `endpoint` rows whose `observed_at` is part of the measured tick span.
- `algorithmContext` now caches the in-flight promise. A load that rejects is dropped from the
  cache, so a later caller retries, the same as before.
- `touchedTeamsByAlgorithm`: each event builds its own feed, then merges it into the shared map
  synchronously after its team loop.
- TBA client `throttle()` is now a turn queue (see decisions).
- Fold tallies are counted after every event settles, in `orderedEventKeys` order. A `rejected`
  result is rethrown after the others settle.
- `runGlobalRebuild`, `runDistrictRefresh`, `writeTickMeta` and the probe-before-manifest ordering
  have not moved. Fold math, schemas, the cron, `THROTTLE_INTERVAL_MS`, counter names, the result
  shape and log `msg` values are unchanged.

## Behaviour that differs from the sequential walk

1. **Roster pass mismatch.** The old code returned from inside the loop. Now a shared `suspended`
   flag stops any event that has not started yet. Up to 5 events already in flight may finish their
   roster poll, which raises `rostersPolled` by up to 5 compared with before. They then see the same
   memoized mismatch and write nothing, not even the etag. `roster-suspended` is still logged once
   per tick.
2. **Rethrow after settle.** `processEvent` catches its own errors, so this should never happen. If a
   fold does reject, the tick still aborts before the global rebuild, the district pass, the live
   event pass and `writeTickMeta`. The difference is that the other events have already been
   processed and are no longer skipped.
3. **When the touched-teams merge lands.** An event's `teams/{year}` feed for an algorithm now lands
   in one synchronous step after its team loop. Before, if the season map already existed, the
   entries were mutated in place as the loop ran. If a team artifact write throws partway through
   the loop, that algorithm's feed for that event now lands nothing. Before, the teams processed
   before the throw had already landed whenever an earlier event had created the map.
4. **Phase A order.** The league-row fold runs one event at a time, in the order events reach Phase
   A, not strictly in rotated order. Within a tick the league row now takes events in arrival order.
   That changes the order of updates, not their content. Rotation already changed this order from
   one tick to the next.
5. **Ingest log row order.** Rows from different events can interleave inside one tick's flush.
   Every row carries its own event key and timestamps.
6. **Probe/live pass counters.** `eventsProbed`, `eventsFailed`, `officialDataPolled` and
   `officialDataWritten` are synchronous increments and mean what they meant before.
7. **TBA spacing.** Requests are still at least 100 ms apart, measured from the previous request's
   actual start. Concurrent callers now queue for turns instead of firing at the same moment.

## Deviations from plan

**1. [Rule 1 - Bug] Lost league-row updates under concurrency (commit 7690cb52)**
- Found during: Task 2 review.
- Issue: the plan says two events never contend on D1 rows. But `resumeAlgorithmState` always reads
  the algorithm's `league` row, and `writeScopedState` always writes it back ("the league row ...
  DO move on every fold"). Two events in Phase A at once would both read L0, and the later write
  would erase the earlier event's contribution. Team rows have the same problem when one team is
  at both events.
- Fix: `createSerialLock()`. Phase A's per-algorithm loop runs in `locks.state`, and
  `writeAsOfFolds` runs in `locks.asOf`, because the SPR as-of season object is shared, uses a
  conditional put and tolerates only one conflict. New test: two events folding in one tick (with
  the state write held 300 ms) leave the same `algorithm_state` rows as two sequential ticks. The
  test FAILS with the lock replaced by a direct call (checked).
- Not tested directly: the as-of lock. That path needs an SPR manifest, and the existing as-of
  tests are all single-event.

**2. [Rule 1] Throttle implementation (in commit 69c97ac1).** The plan's slot-reservation formula
fails the plan's own spacing test under load. It was replaced with a turn queue. Sequential waits
are the same as before.

**3. Test delay 400 ms instead of ~250 ms (commit 04996326).** B's matches request goes out one
throttle interval (100 ms) after A's, so a 250 ms delay leaves only about 150 ms of separation,
right at the threshold. 400 ms gives about 300 ms. The test FAILS with `EVENT_CONCURRENCY = 1`
(observed -110 ms, checked).

**4. `EVENT_CONCURRENCY` lives in `boundedConcurrency.ts`**, re-exported from `scheduled.ts`, to
avoid an import cycle (this is the plan's "move it next to the helper" option).

**5. Commit count.** There are four commits, not three: the league-row fix is a separate `fix`
commit between Task 2 and Task 3.

## Residual hazard (not fixed, flagged)

- **Team page artifacts** (`team/{teamKey}/{year}`) are read, merged and written without a lock. If
  one real team is at two concurrently live events in the same tick, one event's team-page merge
  can be lost until that team's next match rewrites the page. This is rare in real FRC (a team
  plays one event at a time). Team STATE rows are protected by the state lock.
- **Overlapping ticks.** Ticks that overlap each other (cron every minute, with ticks that took
  143 s median before this change) already had the cross-invocation version of the league-row race
  before this task. The in-tick lock does not cover a second invocation. Shorter ticks should make
  overlap rarer. This task does not change it.

## Checks

- `npx vitest run apps/worker packages/ingest`: 41 files, 850 passed, 1 skipped. The named suites
  `scheduled.replay` (1), `scheduled.rp` (26) and `scheduled.rowParity` (11) are green and unmodified.
- Worker typecheck `tsc --noEmit -p apps/worker/tsconfig.json`: exit 0. Root `tsc --noEmit`: exit 0.
- Whole repo `npx vitest run` on the final committed code: 381 files, 9617 passed, 1 skipped, exit 0.
- No existing test needed changing for ordering. `sharedLog` and every single-event test still hold.

## Measurement

Before (2026-10-17, 13 live offseason events, from `ingest_log`): tick span (`tick_at` to last
`observed_at`) median 143 s, p90 266 s, max 530 s. TBA `post_result_time` to artifact
`published_at` median 203 s, p90 281 s. Target: tick span under 30 s with 10+ live events.

Before, recomputed by the orchestrator from `ingest_log` over 2026-10-17 00:00Z to the deploy at
2026-10-18 07:47Z (1351 ticks; tick span = `tick_at` to the tick's last `observed_at`, grouped by
`tick_at`; publish latency = `published_at` minus `tba_post_result_time`, which is stored as epoch
seconds):

| Slice | n | median | p90 | max |
|---|---|---|---|---|
| tick span, all ticks | 1351 | 54 s | 234 s | 530 s |
| tick span, ticks with 10 to 12 events | 36 | 282 s | 335 s | 476 s |
| tick span, ticks with 5 to 9 events | 459 | 183 s | 279 s | 530 s |
| post_result_time to published_at, folded matches | 599 | 226 s | 354 s | 754 s |

Deployed as Worker version 9d2c0b8d-4ca9-4934-943e-64ae71636775 at 2026-10-18 07:47Z.

After: pending (orchestrator fills in after the next live window)

## Self-Check: PASSED

- Files exist: apps/worker/src/boundedConcurrency.ts, apps/worker/test/boundedConcurrency.test.ts.
- Commits exist: 5c58913a, 69c97ac1, 7690cb52, 04996326.
