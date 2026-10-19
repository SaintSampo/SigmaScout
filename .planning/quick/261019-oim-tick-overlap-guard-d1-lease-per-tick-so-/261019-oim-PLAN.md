---
phase: quick-261019-oim
plan: 01
type: execute
wave: 1
depends_on: []
quick_id: 261019-oim
mode: quick
files_modified:
  - apps/worker/migrations/0004_event_lease.sql
  - apps/worker/src/eventLease.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/src/ingestLog.ts
  - apps/worker/src/boundedConcurrency.ts
  - apps/worker/test/eventLease.test.ts
  - apps/worker/test/support/eventLeaseFake.ts
  - apps/worker/test/boundedConcurrency.test.ts
  - apps/worker/test/scheduled.test.ts
  - apps/worker/test/scheduled.asOf.test.ts
  - apps/worker/test/scheduled.district.test.ts
  - apps/worker/test/scheduled.phaseBWrites.test.ts
  - apps/worker/test/scheduled.replay.test.ts
  - apps/worker/test/scheduled.rp.test.ts
  - apps/worker/test/scheduled.stateBaseline.test.ts
  - apps/worker/test/liveAlgorithmTier.test.ts
  - apps/worker/test/stateStore.test.ts
  - docs/worker-operations.md
autonomous: true
requirements: [QUICK-261019-oim]

estimate:
  tokens: 120000
  raw_tokens: 240000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "A tick that starts while another tick still holds an event's lease skips that event: no TBA request, no D1 state or cursor write and no R2 write for it, and the event is counted in eventsSkippedInFlight"
    - "A lease older than 15 minutes (a killed tick) is taken over and its event folds"
    - "A lease outage (missing event_lease table, D1 error) never stops folding: the tick warns event-lease-unavailable once and folds every open window unguarded"
    - "An idle tick (no open window) still costs exactly one R2 read and issues no lease statement"
    - "Every tick that holds a lease releases it on the way out, whether the core returned or threw"
    - "One team at two events folding in the same tick ends with both events' matches on its team page"
    - "Two SPR events folding in the same tick write the as-of season object with no conditional put conflict"
  artifacts:
    - path: apps/worker/migrations/0004_event_lease.sql
      provides: "event_lease table, IF NOT EXISTS, header in 0003's style with APPLY ORDER"
    - path: apps/worker/src/eventLease.ts
      provides: "EVENT_LEASE_TTL_MS, EVENT_LEASE_ACQUIRE_SQL, EVENT_LEASE_RELEASE_SQL, acquireEventLeases, releaseEventLeases"
      exports: [EVENT_LEASE_TTL_MS, EVENT_LEASE_ACQUIRE_SQL, EVENT_LEASE_RELEASE_SQL, acquireEventLeases, releaseEventLeases]
    - path: apps/worker/test/support/eventLeaseFake.ts
      provides: "isEventLeaseSql and EventLeaseFakeStore, taught to all nine FakeD1Database copies"
    - path: apps/worker/src/boundedConcurrency.ts
      provides: "createKeyedLock and the KeyedLock interface"
    - path: docs/worker-operations.md
      provides: "migration 0004 in Database, the 3ju After table, the new overlapping-ticks section"
  key_links:
    - from: "runTickCore (scheduled.ts)"
      to: "acquireEventLeases"
      via: "one batch after the openWindows.length === 0 early exit and before the probe pass"
    - from: "runTick finally (scheduled.ts)"
      to: "releaseEventLeases"
      via: "live.leaseTickId, released before flushIngestLog, counted as one subrequest"
    - from: "runPhaseBAndReport, runLateBreakdownBackfill, runScheduleOnlyPricing team loops"
      to: "locks.team.run(artifactKey(teamParams), ...)"
      via: "TickLocks.team created in runTickCore"
    - from: "every FakeD1Database.batch"
      to: "EventLeaseFakeStore"
      via: "a lease-only batch is routed before any counter, log or rejectNextBatchWith"
---

<objective>
Close the cross-invocation half of the league-row race that quick task 261018-3ju left open, and the
in-tick team page race it flagged.

Purpose: the cron fires every minute and 25 of 435 ticks since the 3ju deploy still ran past 60 s.
`claimEventAdvance` stops two invocations folding the SAME event twice, but nothing stops
invocation 2 folding event B while invocation 1 is still folding event A. Both read each
algorithm's shared `league` row in `algorithm_state` and the later write erases the earlier
contribution. A per-event D1 lease, taken once per tick and released when the tick ends, makes a
new tick skip every window an older tick still holds. Inside one tick, a keyed lock per team page
artifact stops one team at two concurrently folding events losing one event's matches. The as-of
lock (3ju) gets the direct test 3ju could not write.

Output: migration 0004, `eventLease.ts`, lease wiring in `runTick`/`runTickCore`,
`createKeyedLock` and `TickLocks.team`, a lease fake taught to all nine fake D1 databases, seven
new behaviour tests (each concurrency test shown failing with its guard removed), and the
operations docs.

The design is settled by the orchestrator. Do not reopen it. Where this plan makes a choice the
design left open, the action says so and why.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/quick/261018-3ju-concurrent-tick-events/261018-3ju-SUMMARY.md

Source anchors (line numbers as of commit 1d182e74):

- `apps/worker/src/scheduled.ts`
  - 210: imports `createSerialLock, EVENT_CONCURRENCY, mapWithConcurrency, type SerialLock`
  - 212: imports `flushIngestLog, IngestLogBuffer, matchArrivalFacts, type LiveTickContext`
  - 170: `artifactKey` is already imported (from `./artifactMerge.js` re-exports)
  - 841-929: `runLateBreakdownBackfill`. Its team loop (905-928) calls `readExistingTeam` then
    `writeArtifactObject(env, counter, "team", ...)`: it DOES read and rewrite team artifacts.
  - 939-942: `interface TickLocks { state; asOf }`
  - 1161-1285: `runScheduleOnlyPricing`. Its team loop (1254-1285) calls `readExistingTeam`,
    `mergeTeamSeasonArtifact`, `writeArtifactWithBootstrapRetry(..."team"...)`: it ALSO reads and
    rewrites team artifacts. The design did not name it; see Task 2.
  - 1477-1500: `processEvent` signature; `locks: TickLocks` at 1496
  - 1570: `await runLateBreakdownBackfill(env, counter, algorithmModules, window, rawMatches, orderedMatchKeys, cursor, approxStartDateIso, stamp, live);`
  - 1597: `await runScheduleOnlyPricing(env, counter, tbaCtx, algorithmModules, window, stillUpcoming, stamp);`
  - 1661: `await locks.state.run(async () => {` (Phase A)
  - 1911: `return await runPhaseBAndReport(..., stamp, live, locks.asOf);`
  - 1944-1962: `runPhaseBAndReport` signature; last param `asOfLock: SerialLock`
  - 2086-2112: Phase B per-team loop: `teamParams` (2088), `readExistingTeam` (2089),
    `mergeTeamSeasonArtifact` (2110), `writeArtifactWithBootstrapRetry` (2111-2113), then the
    `teams/{year}` feed bookkeeping with `if (!isOfficial) continue;`
  - 2160-2176: the as-of write, `await asOfLock.run(() => writeAsOfFolds(...))`
  - 2291-2297: `RunTickDeps`
  - 2299-2341: `TickResult`; 2344: `type CoreTickResult = Omit<TickResult, "ingestRowsWritten">`
  - 2360-2373: `runTick` (the `finally` that flushes the ingest log)
  - 2375-2716: `runTickCore`
    - 2396-2401: `subrequests.spend(1)`, `loadTickWindowsAt`, `const liveEvents = tickWindows.live;`,
      `const districtWatchWindows = [...liveEvents.filter(district), ...tickWindows.recentlyEnded];`
    - 2458-2473: the `liveEvents.length === 0` early exit (the `idle` literal at 2459, two returns)
    - 2483-2487: `foldableWindows` / `probeWindows` split, then the probe pass
    - 2495-2496: `readOpenWindowCursors(..., liveEvents)`, `runRosterPass(..., liveEvents, ...)`
    - 2498-2537: probe-only return; 2549-2570: state generation mismatch return
    - 2573-2575: `promotedWindows`, `orderedEventKeys`, `liveEventByKey`
    - 2595: `const locks: TickLocks = { state: createSerialLock(), asOf: createSerialLock() };`
    - 2682, 2691: district pass and live event pass (both read `liveEvents`/`districtWatchWindows`)
    - 2698-2715: main return
- `apps/worker/src/ingestLog.ts` 235-240: `interface LiveTickContext { readonly ingest; readonly phaseFacts }`
- `apps/worker/src/boundedConcurrency.ts` 56-75: `SerialLock`, `createSerialLock`
- `apps/worker/migrations/0003_ingest_log.sql` 1-31: the header style to copy
- `apps/worker/test/support/ingestLogFake.ts`: the pattern for one SQL family taught to every fake
- `apps/worker/test/ingestLog.test.ts` 8-9, 170-200: real SQL on `better-sqlite3` over the migration
  file, CRLF normalised with `.replace(/\r\n/g, "\n")`. Copy this for the lease SQL test.
- `apps/worker/test/scheduled.test.ts`
  - 83-206: `FakeD1Database` (`batch` 104-114 bumps `batchCallCount`, consumes `rejectNextBatchWith`,
    pushes `{ type: "d1-batch" }` to `sharedLog`; `executeWrite` 156 starts with the ingest branch)
  - 224-252: `FakeR2Bucket` (`putCallCount`, `puts`, `seed`)
  - 345-397: `makeTbaFetchStub`; 401-411: `twoMatchEventRecord` (qm1 is frc1-3 vs frc4-6 at EVERY
    event, so frc1 plays at both `2026aaaa` and `2026bbbb`); 413-418: `makeManifests`
  - 542-567: existing "runTick — overlapping invocations" (two ticks raced at the same instant;
    must stay green)
  - 704-744: the 3ju test "two events folding at once leave the same state rows ...": the
    300 ms `algorithm_state` batch hold and the `stateJsonByRow` sequential reference to reuse
  - 2045 and 2121: exact `subrequestsUsed` pins on non-idle ticks (see Task 1 step H)
- `apps/worker/test/scheduled.asOf.test.ts`
  - 97-150: its `FakeD1Database` (`batch` 110-113); 205-252: its `FakeR2Bucket` (`refused`,
    `afterGet`, conditional `onlyIf` put)
  - 255-262: `EVENT_A = "2026aaa"`, `EVENT_B = "2026bbb"`, `NOW_MS`, `WINDOWS` (both events live),
    `KEY_PARAMS`; 289-297: `A1`, `B1`, `A_MATCHES`, `B_MATCHES`; 375: `let revealed`
  - 377-411: `makeTbaFetchStub` (serves `revealed.a`/`revealed.b` matches), `makeEnv` (SPR manifest)
  - 487: `read(r2, key, schema)`; 561-647: the C1 describe (`SEASON_KEY = asOfSeasonKey({ season: SEASON, ...KEY_PARAMS })`)
- `apps/worker/test/liveAlgorithmTier.test.ts` 524: `expect(result.subrequestsUsed).toBe(8);` (non-idle)
- `apps/worker/test/scheduled.district.test.ts` 106-111: its `batch` bumps `batchCallCount` AND
  `callCount`; 2420 and 2444 assert `subrequestsUsed === r2 gets + r2 puts + d1.callCount + fetches`
  (both on idle watch ticks)
- `apps/worker/test/scheduled.phaseBWrites.test.ts` 121-125 (`batch` pushes `"d1-batch"` to
  `statements`), 159-161 (`executeWrite` pushes the SQL to `statements` BEFORE the ingest branch),
  656 asserts no `"d1-batch"` on the schedule-only path
- `apps/worker/test/stateStore.test.ts` 89-164: its fake (`executeWrite` returns `void`, never
  driven through `runTick`)
- `docs/worker-operations.md` 94-115 ("## Database"), 1490-1519 (the 3ju section, ending with
  "After: _measured on the next live window, see the quick task SUMMARY_" at 1517), 1522 ("## The ingest log")

<interfaces>
The exact contracts the design fixes. Copy the SQL text byte for byte.

```typescript
// apps/worker/src/eventLease.ts
export const EVENT_LEASE_TTL_MS = 15 * 60 * 1000;

export const EVENT_LEASE_ACQUIRE_SQL =
  "INSERT INTO event_lease (event_key, tick_id, leased_at, expires_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(event_key) DO UPDATE SET tick_id = excluded.tick_id, leased_at = excluded.leased_at, expires_at = excluded.expires_at WHERE event_lease.expires_at <= excluded.leased_at";

export const EVENT_LEASE_RELEASE_SQL = "DELETE FROM event_lease WHERE tick_id = ?1";

/** ONE db.batch of acquire statements over the sorted, de-duplicated keys; returns the keys whose statement changed a row. Throws if D1 throws. */
export function acquireEventLeases(db: D1Database, eventKeys: readonly string[], tickId: string, nowMs: number): Promise<Set<string>>;

/** One statement. NEVER throws: warns {msg:"event-lease-release-failed", tickId, error} and returns. */
export function releaseEventLeases(db: D1Database, tickId: string): Promise<void>;
```

```sql
-- apps/worker/migrations/0004_event_lease.sql (after the header comment)
CREATE TABLE IF NOT EXISTS event_lease (event_key TEXT PRIMARY KEY, tick_id TEXT NOT NULL, leased_at TEXT NOT NULL, expires_at TEXT NOT NULL);
```

```typescript
// apps/worker/src/boundedConcurrency.ts (Task 2)
export interface KeyedLock {
  run<T>(key: string, section: () => Promise<T>): Promise<T>;
  /** Keys with a section queued or running. A test seam: drained chains are dropped. */
  readonly size: number;
}
export function createKeyedLock(): KeyedLock;
```

```typescript
// scheduled.ts additions
RunTickDeps.tickId?: string;                 // test-only; default crypto.randomUUID()
LiveTickContext.leaseTickId?: string;        // ingestLog.ts, mutable, set by the core
TickResult.eventsSkippedInFlight: number;    // readonly
TickLocks.team: KeyedLock;                   // readonly
```

Log lines (one JSON line each, `JSON.stringify`):
- `{ msg: "events-in-flight", tickId, skipped: [sorted keys] }` via `console.log`, once per tick that skipped any
- `{ msg: "event-lease-unavailable", error }` via `console.warn`, once per tick whose acquire threw
- `{ msg: "event-lease-release-failed", tickId, error }` via `console.warn`
Error text in every line is cut with the same truncation the file already uses
(`WRITE_RETRY_ERROR_MESSAGE_MAX` in scheduled.ts; in eventLease.ts cut to 300 characters).
</interfaces>
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Per-event D1 lease, end to end: migration, eventLease.ts, runTick/runTickCore wiring, the fake in all nine fake databases, and four lease tests</name>
  <files>apps/worker/migrations/0004_event_lease.sql, apps/worker/src/eventLease.ts, apps/worker/test/eventLease.test.ts, apps/worker/test/support/eventLeaseFake.ts, apps/worker/src/ingestLog.ts, apps/worker/src/scheduled.ts, apps/worker/test/scheduled.test.ts, apps/worker/test/scheduled.asOf.test.ts, apps/worker/test/scheduled.district.test.ts, apps/worker/test/scheduled.phaseBWrites.test.ts, apps/worker/test/scheduled.replay.test.ts, apps/worker/test/scheduled.rp.test.ts, apps/worker/test/scheduled.stateBaseline.test.ts, apps/worker/test/liveAlgorithmTier.test.ts, apps/worker/test/stateStore.test.ts</files>
  <behavior>
    - eventLease.test.ts, on a REAL SQLite engine (better-sqlite3, the 0004 file read with CRLF normalised): applying the migration twice does not throw; the acquire statement reports changes 1 when the key is absent, 0 when another tick's lease on the key has not expired, 1 when it has expired (take over, and the row now carries the new tick id), 1 when expires_at equals the new leased_at exactly; release deletes only rows whose tick_id matches and reports how many.
    - eventLease.test.ts, through the real functions over a tiny better-sqlite3-backed D1 stand-in: acquireEventLeases issues exactly ONE batch, sorts and de-duplicates the keys, returns only the keys it now holds; it rejects when the batch rejects; releaseEventLeases resolves (never rejects) when the statement throws and warns exactly one event-lease-release-failed line carrying the tick id.
    - eventLease.test.ts, fake parity: the same scenario sequence through EventLeaseFakeStore.apply returns the same change counts the real engine returned.
    - scheduled.test.ts test 1 (two invocations, one database): tick 2 started 50 ms into tick 1 reports eventsSkippedInFlight 2, eventsAdvanced 0, tbaRequests 0, subrequestsUsed 2, and r2.putCallCount does not move while tick 2 runs; after both settle the algorithm_state rows equal the sequential A-then-B reference, the lease store is empty, and a third tick reports eventsSkippedInFlight 0.
    - scheduled.test.ts test 2 (foreign unexpired lease on A): the tick folds B only, eventsSkippedInFlight 1, A has no event_cursor row and no R2 put key containing it, one events-in-flight line with skipped ["2026aaaa"]; after the tick the lease store holds A's foreign row and nothing for B.
    - scheduled.test.ts test 3 (the same lease on A, expired): both events advance, eventsSkippedInFlight 0, lease store empty after.
    - scheduled.test.ts test 4 (eventLease.rejectWith set): both events advance, eventsSkippedInFlight 0, exactly one event-lease-unavailable warn line, eventLease.releaseCount 0.
  </behavior>
  <action>
Implement the lease exactly as the interfaces block fixes it. Work in this order.

A. Migration `apps/worker/migrations/0004_event_lease.sql`. Header comment in 0003's style (0003 lines 1-31): what the table is (one row per open live window a running tick holds, so an overlapping tick skips that window); WHY D1 (it is the one store with an atomic conditional write the tick already pays for, and the race it guards is on D1's own `algorithm_state` league row); the 15 minute expiry and why (the Workers cron wall time ceiling, so a row older than that belongs to a killed tick and is taken over); IDEMPOTENT (IF NOT EXISTS); APPLY ORDER: apply BEFORE deploying the Worker that uses it, and a Worker running against a missing table warns `event-lease-unavailable` and folds unguarded (fail open). Then the one CREATE TABLE from the interfaces block.

B. `apps/worker/src/eventLease.ts`. Header comment naming quick task 261019-oim and the problem in two sentences. Import `D1Database` the way `ingestLog.ts` line 24 does. Export the three constants and two functions from the interfaces block. `acquireEventLeases`: de-duplicate and sort the keys; with zero keys return an empty set without touching D1; leasedAt is `new Date(nowMs).toISOString()`, expiresAt is `new Date(nowMs + EVENT_LEASE_TTL_MS).toISOString()` (ISO UTC strings compare correctly as text, which the WHERE relies on); build one prepared, bound acquire statement per key, call `db.batch` ONCE, and add a key to the result when its result's `meta.changes` is above 0 (read it defensively: a missing `meta` counts as 0, which makes a fake that was not taught the count fail loudly by skipping everything). Do not catch: the caller decides. `releaseEventLeases`: one `db.prepare(EVENT_LEASE_RELEASE_SQL).bind(tickId).run()` inside try/catch; on a throw, `console.warn` the one JSON line `{ msg: "event-lease-release-failed", tickId, error }` with the error message cut to 300 characters; never rethrow (a lease that fails to release expires on its own).

C. `apps/worker/test/eventLease.test.ts` (write it first and see it fail, then make B pass it). Real SQL half: import `better-sqlite3` and read the migration exactly as `ingestLog.test.ts` lines 8-9 and 170-175 do, CRLF normalised. Run the acquire SQL with `sqlite.prepare(EVENT_LEASE_ACQUIRE_SQL).run(key, tickId, leasedAt, expiresAt)` and read `.changes`; cover the cases in the behavior block. Function half: a ~20 line stand-in object exposing `prepare(sql).bind(...args)` (returning `{ sql, args, run() }`) and `batch(statements)` (running each on the same better-sqlite3 database and returning `{ success: true, meta: { changes } }`), cast to `D1Database`; count batch calls. Parity half: drive the same sequence through `EventLeaseFakeStore.apply` (step D) and compare counts. If better-sqlite3 cannot bind the numbered `?1` placeholders positionally, do NOT change the SQL constants; report it and bind in the test the way the engine requires.

D. `apps/worker/test/support/eventLeaseFake.ts`, modelled on `ingestLogFake.ts`. `isEventLeaseSql(sql)` is an exact string match against the two constants. `EventLeaseFakeStore` holds `rows: Map<string, { tickId: string; leasedAt: string; expiresAt: string }>`, `statementCount` (every attempted statement, rejected ones included), `releaseCount` (every attempted release, rejected ones included), and `rejectWith: Error | null`. `apply(sql, args): number`: bump the counters, throw `rejectWith` when set, then for acquire (args eventKey, tickId, leasedAt, expiresAt) insert when absent and return 1, take over when the stored `expiresAt <= leasedAt` and return 1, else return 0; for release (args tickId) delete every row with that tick id and return the count.

E. Teach the fake to all NINE `FakeD1Database` copies. Re-run `grep -rn "class FakeD1Database" apps/worker/test` first and confirm the list is exactly: scheduled.test, scheduled.asOf, scheduled.district, scheduled.phaseBWrites, scheduled.replay, scheduled.rp, scheduled.stateBaseline, liveAlgorithmTier, stateStore. In each: add `readonly eventLease = new EventLeaseFakeStore();`; at the very TOP of `batch()`, BEFORE any counter bump, log push, `statements` push or `rejectNextBatchWith` consumption, route a batch whose statements are all lease SQL straight to `this.eventLease.apply` and return `{ success: true, meta: { changes } }` per statement (this is what keeps `batchCallCount`, `sharedLog`, `statements` and every `rejectNextBatchWith` test exactly as they are: those model the fold's state writes, and a lease batch landing in them would consume a rejection meant for Phase A). The one exception is scheduled.district.test.ts, whose `callCount` mirrors every D1 subrequest (the equality pins at 2420 and 2444): there, bump `callCount` for the lease batch too, and nothing else. At the very top of `executeWrite` (BEFORE phaseBWrites' `this.statements.push(sql)`), return `this.eventLease.apply(sql, args)` for lease SQL. Then make every non-lease `batch` return `{ success: true, meta: { changes } }` per statement from `executeWrite`'s return (design requirement; stateStore's `executeWrite` returns `void`, so there report changes 1). stateStore.test.ts never drives `runTick`; it gets the store and both branches anyway, for uniformity, adapted to its `void` executeWrite.

F. `apps/worker/src/ingestLog.ts` `LiveTickContext` (235-240): add a mutable optional `leaseTickId?: string` with a doc comment (set by the tick core once it holds at least one lease; `runTick` releases by it). `liveEventPass.test.ts:76` builds the context without it and stays valid.

G. `apps/worker/src/scheduled.ts` wiring.
  1. `RunTickDeps` (2291): add `readonly tickId?: string` (test-only; the core defaults it to `crypto.randomUUID()`).
  2. `TickResult` (2299): add `readonly eventsSkippedInFlight: number` with the doc comment "Open live windows another tick still held when this one started (quick task 261019-oim). Zero on an idle tick, and zero when the lease table could not be read, because then nothing is skipped."
  3. `runTick` (2360-2373): in the `finally`, BEFORE the ingest flush, when `live.leaseTickId` is defined set a `releaseAttempted` flag and `await releaseEventLeases(env.DB, live.leaseTickId)`. The returned `subrequestsUsed` adds 1 for the release when it ran, beside the existing flush term. Update the function's doc comment in one sentence.
  4. `runTickCore`, the window lists (2396-2401): rename the R2 result `const liveEvents = tickWindows.live;` to `const openWindows = tickWindows.live;`. Replace the `districtWatchWindows` constant with a local arrow `watchWindowsFor(windows)` that returns the same expression over its argument plus `tickWindows.recentlyEnded`, keeping the existing comment on it. In the idle branch (2458-2473) test `openWindows.length === 0` and use `watchWindowsFor(openWindows)` in place of `districtWatchWindows` (identical value, since `openWindows` is empty there). Hoist the branch's `idle` literal (2459) just above the `if` so the new all-skipped return can reuse it, and add `eventsSkippedInFlight: 0` to both idle returns.
  5. Right AFTER the idle branch and BEFORE the `foldableWindows` split (2483), add a call to a new non-exported helper `leaseOpenWindows(env, subrequests, live, openWindows, tickId, nowMs)` placed just above `runTickCore`, with `tickId = deps.tickId ?? crypto.randomUUID()` computed here (an idle tick never generates one). The helper: `subrequests.spend(1)`; try `acquireEventLeases` over every open window's key; on success, set `live.leaseTickId = tickId` only when it holds at least one key (plan choice: a tick holding nothing has nothing to release and saves that subrequest), return the windows it holds plus the sorted keys it does not, and when any were skipped `console.log` the one `events-in-flight` line; on a throw, `console.warn` the one `event-lease-unavailable` line (message truncated with `WRITE_RETRY_ERROR_MESSAGE_MAX`), leave `leaseTickId` unset and return every window with nothing skipped (fail open: a lease outage must not stop the site folding). Back in the core: `const liveEvents = <held windows>`; `const eventsSkippedInFlight = <skipped count>`; `const districtWatchWindows = watchWindowsFor(liveEvents)`. Every later use of `liveEvents` and `districtWatchWindows` (probes, roster, cursors, fold loop, district pass, live event pass) now sees the leased subset with no further edits.
  6. When `liveEvents.length === 0` after the lease (every window was in flight), return the hoisted `idle` shape with `tbaRequests`, `subrequestsUsed`, `NO_DISTRICT_REFRESH` and `eventsSkippedInFlight`. Plan choice, say it in a comment: this return does NOT run the district pass, because the tick holding the leases runs it, and a second district pass from a tick that holds nothing would rewrite the same district artifact concurrently.
  7. Add `eventsSkippedInFlight` to the probe-only return (2522), the mismatch return (2551) and the main return (2698). `CoreTickResult` already requires it.
  Import `acquireEventLeases, releaseEventLeases` from `./eventLease.js`.

H. Exact subrequest pins on NON-idle ticks move by exactly +2 (one acquire, one release), each new term named in the existing comment, following the precedent at scheduled.test.ts:2117-2121 ("moved from 8 on purpose"): scheduled.test.ts:2045 (append `+ 1 + 1` named "lease acquire, lease release (quick task 261019-oim)"), scheduled.test.ts:2121 (9 to 11), liveAlgorithmTier.test.ts:524 (8 to 10). These are the only assertion values that may change. If any OTHER existing assertion fails, stop and diagnose it: never edit it to pass. Idle-tick pins (scheduled.district.test.ts 1963, 1985, 2349; every `d1.callCount` of 0) must pass untouched: they are the proof that an idle tick issues no lease statement. List every moved pin in the summary as a deliberate deviation (the design said no assertion changes; the design's own subrequest accounting makes these three move).

I. New describe in scheduled.test.ts, "runTick — overlapping invocations (quick task 261019-oim)", placed right after the "runTick — two concurrent live events" describe (ends at line 744). Windows `2026aaaa` and `2026bbbb` with `twoMatchEventRecord`, `makeManifests`, `makeEnv`, `NOW_MS`, as the 3ju test at 704 does; ISO strings via `new Date(ms).toISOString()`; import `EVENT_LEASE_TTL_MS` from `../src/eventLease.js`.
  Test 1: sequential reference exactly as 704-722 builds it (algorithm ids `["opr", "epa"]`). Then ONE `FakeD1Database` and ONE `FakeR2Bucket` with the 300 ms `algorithm_state` batch hold from 726-730; start tick 1 (`tickId: "tick-1"`, `nowMs: NOW_MS`) without awaiting; wait 50 ms; record `r2.putCallCount`; run tick 2 (`tickId: "tick-2"`, `nowMs: NOW_MS + 60_000`) to completion; assert the behavior-block figures for tick 2 and that the put count is unchanged; await tick 1 (eventsAdvanced 2); compare `stateJsonByRow` to the reference; assert `d1.eventLease.rows.size === 0`; run tick 3 (`nowMs: NOW_MS + 120_000`) and assert `eventsSkippedInFlight === 0`.
  Test 2: seed `d1.eventLease.rows` with `2026aaaa` held by `"other-tick"`, leasedAt 30 s before `NOW_MS`, expiresAt that plus `EVENT_LEASE_TTL_MS`; spy `console.log`; assert the behavior-block outcomes, including `d1.eventCursors.get("2026aaaa") === undefined` and no `r2.puts` key containing `2026aaaa`.
  Test 3: same seed with expiresAt one millisecond before `NOW_MS`.
  Test 4: `d1.eventLease.rejectWith = new Error("D1_ERROR: no such table: event_lease")`; spy `console.warn` and count lines whose parsed `msg` is `event-lease-unavailable`.

J. Guard-removed proof (do not commit it): temporarily make `leaseOpenWindows` treat every window as held regardless of the acquire result. Run tests 1 and 2: both must FAIL. Restore, run again: both pass. Report both runs (test name, failing assertion, then pass) in the summary.

K. Commit (stage by path, never `git add -A`, no `.planning/` files): `feat(worker): lease each open event per tick so an overlapping tick skips events still in flight`, body naming quick task 261019-oim, the fail-open rule and the moved pins.
  </action>
  <verify>
    <automated>npx vitest run apps/worker/test/eventLease.test.ts apps/worker/test/scheduled.test.ts && npx vitest run apps/worker && npx tsc --noEmit -p apps/worker/tsconfig.json && npx tsc --noEmit</automated>
  </verify>
  <done>
    0004 exists with the header and one CREATE TABLE IF NOT EXISTS. eventLease.ts exports the five names with the SQL byte for byte as specified. The real-SQLite tests prove the acquire/release change counts and the fake matches them. All nine fakes route lease SQL first. Tests 1 to 4 pass, and tests 1 and 2 were seen failing with the guard removed. Every pre-existing worker test passes with only the three named subrequest pins moved by +2. Both typechecks exit 0. One commit.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Keyed team-page lock inside a tick, plus the team-merge test and the as-of lock test</name>
  <files>apps/worker/src/boundedConcurrency.ts, apps/worker/test/boundedConcurrency.test.ts, apps/worker/src/scheduled.ts, apps/worker/src/eventLease.ts, apps/worker/test/eventLease.test.ts, apps/worker/test/support/eventLeaseFake.ts, apps/worker/test/scheduled.test.ts, apps/worker/test/scheduled.asOf.test.ts</files>
  <behavior>
    - createKeyedLock: two sections on the same key run one at a time in arrival order; sections on different keys overlap (neither waits for the other); a rejecting section rejects only its own caller and the next section on that key still runs; once every section on a key has settled, `size` is 0.
    - scheduled.test.ts test 5: frc1 plays qm1 at both 2026aaaa and 2026bbbb in ONE tick while every R2 put whose key starts with `v1/team/frc1/` is held 300 ms; the final frc1 team artifact holds both match keys and equals the sequential A-then-B reference artifact (parsed, generation and computedAt removed).
    - scheduled.asOf.test.ts: A1 and B1 revealed together and folded in ONE SPR tick, with the as-of season object's put held 300 ms; eventsAdvanced 2, `r2.refused` is empty, no asof-write-failed line, and the season object's tails name every real team of A1 and of B1.
  </behavior>
  <action>
A. `apps/worker/src/boundedConcurrency.ts`: add the `KeyedLock` interface and `createKeyedLock()` from the interfaces block, beside `createSerialLock`, with a doc comment (quick task 261019-oim: one team's page artifact is read, merged and rewritten by every event that touched the team, so one team at two concurrently folding events must not merge both over the same stale read). Implementation: a `Map<string, Promise<unknown>>` of chain tails; `run(key, section)` chains `section` onto the key's tail (or a resolved promise), stores the caught tail, and when that tail settles deletes the key only if the map still points at that same tail; it returns the section's own promise so a rejection reaches its caller only. `size` returns the map's size. Write the four unit tests in `boundedConcurrency.test.ts` first (import `createKeyedLock` beside the existing imports at line 2), see them fail, then implement.

B. `apps/worker/src/scheduled.ts`:
  1. `TickLocks` (939-942): add `readonly team: KeyedLock` and extend its doc comment by one sentence. Import `createKeyedLock, type KeyedLock` on line 210. At 2595 create it: `{ state: createSerialLock(), asOf: createSerialLock(), team: createKeyedLock() }`.
  2. `runPhaseBAndReport` (smallest diff): replace the last parameter `asOfLock: SerialLock` with `locks: TickLocks` (update its doc comment), change the as-of call at ~2166 to `locks.asOf.run(...)`, and change the call site at 1911 to pass `locks` instead of `locks.asOf`. In the per-team loop (2086-2112) wrap ONLY the read, the merge and the write (`readExistingTeam`, `mergeTeamSeasonArtifact`, `writeArtifactWithBootstrapRetry` with its bootstrap fallback) in `await locks.team.run(artifactKey(teamParams), async () => { ... })`. `teamMatches`, `teamParams` and the `teams/{year}` feed bookkeeping (including `if (!isOfficial) continue;`) stay outside the section. Add a two-line comment naming the race.
  3. `runLateBreakdownBackfill` (841): it DOES read and rewrite team artifacts (905-928). Add a `teamLock: KeyedLock` parameter after `live`, pass `locks.team` at the call site (1570), and wrap each team's read, patch and `writeArtifactObject(... "team" ...)` in `teamLock.run(artifactKey(teamParams), ...)`. The two `continue` statements inside that section become `return` from the section.
  4. `runScheduleOnlyPricing` (1161): it ALSO reads and rewrites team artifacts (1254-1285), and the design did not name it. Same hazard, same fix: add a `teamLock: KeyedLock` parameter, pass `locks.team` at 1597, wrap each team's read, merge and write in `teamLock.run(artifactKey(teamParams), ...)`. Name this addition in the summary.
  No lock section here takes another lock, and all three team sections run outside `locks.state`, so nothing can deadlock. Say so in the `TickLocks` comment.

C. `apps/worker/test/scheduled.test.ts` FakeR2Bucket (224-252): add an optional `beforePut: ((key: string) => Promise<void>) | undefined` hook, awaited at the very top of `put` before anything else, so a held put has not landed anywhere yet. Test 5, appended to the Task 1 describe: sequential reference on one fresh d1/r2 pair (tick with manifest `[windowA]`, then a tick with `[windowB]`, both `nowMs: NOW_MS`, default `["opr"]` manifest), read the reference `artifactKey({ page: "team", teamKey: "frc1", year: SEASON, algorithmId: "opr", version: "3.1.0+baseline" })`. Then ONE tick over `[windowA, windowB]` on a fresh pair with `r2.beforePut` holding keys starting `v1/team/frc1/` for 300 ms. Assert eventsAdvanced 2, the artifact parses with `TeamSeasonArtifactSchema`, its events carry `2026aaaa_qm1` and `2026bbbb_qm1`, and it equals the reference with `generation` and `computedAt` removed. If some field legitimately differs for a reason unrelated to the race, narrow the equality to the `events` array and explain why in the summary.

D. `apps/worker/test/scheduled.asOf.test.ts` FakeR2Bucket (205-252): add the same optional `beforePut` hook, awaited at the top of `put` BEFORE the `onlyIf` etag check (R2 evaluates the condition when the write lands). New describe "scheduled.asOf — the as-of lock (quick task 261019-oim)" after the C1 describe (ends 647): fresh d1/r2, `vi.stubGlobal("fetch", makeTbaFetchStub())`, `revealed = { a: 1, b: 1 }`, `env = makeEnv(d1, r2)`, `r2.beforePut` holding `asOfSeasonKey({ season: SEASON, ...KEY_PARAMS })` for 300 ms, spy `console.warn`, one `runTick(env, { nowMs: NOW_MS })`; assert the behavior-block figures (tails via `read(r2, key, AsOfSeasonSchema)`; real teams from `A1` and `B1` red and blue lists). Give it the file's usual 60_000 ms timeout. Leave `revealed` as the other tests expect it (they set it themselves in `drive`).

E. Guard-removed proof (do not commit it): replace `locks.team.run(key, fn)` with a direct `fn()` call in `runPhaseBAndReport` and run test 5: it must FAIL; restore. Replace `locks.asOf.run(fn)` with `fn()` and run the as-of test: it must FAIL (expect one refused key); restore. If either does not fail at 300 ms, raise that test's hold (600 ms, then 1000 ms) until the unguarded run fails, keep the guarded run passing, and report the figure used. Report both runs of both tests in the summary.

F. THE FOLD LEASE ACROSS INVOCATIONS (orchestrator amendment, 2026-10-19, after both planners flagged the same gap). The per-event lease in Task 1 stops two invocations touching the SAME window. It does not stop invocation 1 folding event A while invocation 2 folds event B (a window that opened after invocation 1 leased, or a webhook tick from quick task 261019-ooj, which runs one named event beside the cron), and both rewrite each algorithm's league row. `locks.state` covers one invocation only. Close it with a cross-invocation lease on the fold section, WAITED FOR rather than skipped, so two invocations interleave their Phase A sections through D1 exactly as events interleave through `locks.state` inside one tick.
  1. `eventLease.ts`: add `FOLD_LEASE_KEY = "#fold"` (a `#` prefix can never collide with a TBA event key, which starts with a digit; say so in the comment), `FOLD_LEASE_TTL_MS = 60_000` (Phase A for one event is seconds: a holder that dies frees the section within a minute), `FOLD_LEASE_POLL_MS = 250`, `EVENT_LEASE_RELEASE_KEY_SQL = "DELETE FROM event_lease WHERE event_key = ?1 AND tick_id = ?2"`, and `acquireFoldLease(db, tickId, clock, deadlineMs): Promise<boolean>`: loop { one acquire statement for `FOLD_LEASE_KEY` with leasedAt = clock() and expiresAt = leasedAt + FOLD_LEASE_TTL_MS, via `prepare().bind().run()` (NOT batch); changes > 0 -> true; clock() >= deadlineMs -> false; else sleep FOLD_LEASE_POLL_MS (setTimeout) and retry }. Throws if D1 throws. `releaseFoldLease(db, tickId)`: the release-by-key statement, never throws (warn `fold-lease-release-failed`). Teach `EventLeaseFakeStore.apply` the release-by-key SQL (delete that key only when its tickId matches; return 0 or 1) and `isEventLeaseSql` the third constant; the real-SQLite test in Task 1 covers it too (one case: release by key with the wrong tick id deletes nothing).
  2. `RunTickDeps`: add `readonly leaseClock?: () => number` (test-only; default `Date.now`; the fold lease loop and its deadline run on the REAL clock, not `nowMs`, because the loop sleeps) and `readonly deadlineMs?: number` (the real-clock instant after which the tick takes no new fold section; default `leaseClock() + FOLD_LEASE_TTL_MS`; quick task 261019-ooj passes a short one for webhook ticks, which Cloudflare cancels 30 s after the response).
  3. `TickLocks`: add `readonly tickId: string`, `readonly clock: () => number`, `readonly deadlineMs: number`, and a mutable `foldLeaseUnavailable: boolean` (false). Create them at ~2595 from `tickId` (so Task 1 must compute `tickId` ALWAYS once past the idle exit, not only when the event lease held something), `deps.leaseClock ?? Date.now`, and the default above.
  4. `processEvent`, inside `locks.state.run(async () => { ... })` at ~1661: as the FIRST statement, `let held = false; if (!locks.foldLeaseUnavailable) { try { held = await acquireFoldLease(env.DB, locks.tickId, locks.clock, locks.deadlineMs); } catch (e) { locks.foldLeaseUnavailable = true; console.warn({ msg: "fold-lease-unavailable", error }) once per tick; } if (!locks.foldLeaseUnavailable && !held) throw new FoldLeaseTimeoutError(eventKey) }` (fail open on a D1 outage, same rule as Task 1; the wait counts `counter.spend(1)` per attempt). Then `try { <the existing per-algorithm loop, unchanged> } finally { if (held) { counter.spend(1); await releaseFoldLease(env.DB, locks.tickId); } }`. A `FoldLeaseTimeoutError` thrown there is caught by the existing Phase A catch: the claim is reverted (`writeEventCursor(env.DB, cursor)`), the event is logged `event-failed` and counted `failed`, and the next tick folds the same matches. Export the error class.
  5. Tests, in the Task 1 describe:
     - Fold lease waited for and taken: seed `d1.eventLease.rows` with `#fold` held by `"other-tick"`, leasedAt now, expiresAt `Date.now() + 600`; run one tick over `[windowA]`; it advances (eventsAdvanced 1), the elapsed real time is at least 500 ms, and the lease store holds no `#fold` row afterwards.
     - Fold lease never freed, deadline short: seed `#fold` held by `"other-tick"` expiring an hour from now; `runTick(env, { nowMs: NOW_MS, deadlineMs: Date.now() + 400 })`; the event is `failed` (eventsFailed 1, eventsAdvanced 0), its cursor is reverted (no `event_cursor` row for A, or the pre-seeded one unchanged), no `algorithm_state` row was written, and one `event-failed` line names `FoldLeaseTimeoutError`.
     - Two invocations folding DIFFERENT events on one database: d1 shared; env 1 over `[windowA]` with its own FakeR2Bucket and the 300 ms `algorithm_state` hold, env 2 over `[windowB]` with its own FakeR2Bucket; start tick 1 (`tickId: "tick-1"`), wait 50 ms, run tick 2 (`tickId: "tick-2"`) to completion, await tick 1; both advance; the `algorithm_state` rows equal the sequential A-then-B reference; `#fold` is absent from the lease store. Guard-removed proof: make `acquireFoldLease` return true without touching D1 and run this test: it must FAIL (B's write erases A's league contribution); restore; report both runs.
  6. Pins: every exact `subrequestsUsed` / `callCount` pin on a tick that FOLDS moves by +2 per folded event (one fold acquire, one release), on top of Task 1's +2 per tick. Name each moved pin and its new terms in the comment and in the summary. Pins on idle, probe-only, 304 and schedule-only ticks must not move: those paths never enter Phase A.
  7. Docs (Task 3) must describe the fold lease as the thing that closes the cross-invocation league-row race, its 60 s expiry, the wait and the deadline, the `fold-lease-unavailable` fail-open, and `FoldLeaseTimeoutError` as a retry-next-tick failure. The "still not guarded" paragraph then shrinks to: a window that opens during an overlap is leased by the newer tick and folds under the fold lease like any other; the `teams/{year}` feed and a shared team page across two INVOCATIONS remain read-merge-write without a cross-invocation lock (rare: one team at two live events at once).

G. Commit (stage by path): `fix(worker): serialize each team page's read-merge-write inside a tick; a D1 fold lease across invocations; test the as-of lock`, body naming quick task 261019-oim, the `runScheduleOnlyPricing` addition and the fold lease.
  </action>
  <verify>
    <automated>npx vitest run apps/worker/test/boundedConcurrency.test.ts apps/worker/test/scheduled.test.ts apps/worker/test/scheduled.asOf.test.ts && npx vitest run apps/worker && npx tsc --noEmit -p apps/worker/tsconfig.json && npx tsc --noEmit</automated>
  </verify>
  <done>
    createKeyedLock and its four unit tests pass. All three team read-merge-write sites run inside `locks.team.run(artifactKey(teamParams), ...)`, and `runPhaseBAndReport` takes `locks`. Test 5 and the as-of test pass, and each was seen failing with its guard removed. `scheduled.replay`, `scheduled.rp` and `scheduled.rowParity` pass without modified assertions. The fold lease (step F) is acquired inside `locks.state` before every Phase A loop and released after it; its three tests pass and the two-invocation one was seen failing with the lease bypassed. Both typechecks exit 0. One commit.
  </done>
</task>

<task type="auto">
  <name>Task 3: Operations docs: migration 0004, the measured 3ju After table, and the overlapping-ticks section</name>
  <files>docs/worker-operations.md</files>
  <action>
Three edits, plain short sentences, in the file's existing voice.

A. "## Database" (94-115): after the paragraph that ends "nothing upstream of the failure will have warned you.", add a short paragraph for migration 0004 (`0004_event_lease.sql`, quick task 261019-oim): the same two `migrations apply` commands above apply it; confirm with the same `wrangler d1 execute sigmascout-state --remote --command` form, querying `SELECT COUNT(*) FROM event_lease` (0 between ticks, a few rows while a tick runs); APPLY ORDER: apply the migration first, then `npx wrangler deploy`. A Worker deployed before the table exists warns `event-lease-unavailable` every tick and folds unguarded, so nothing breaks, but the overlap guard is off until the table exists.

B. In "## Events are processed concurrently inside a tick" replace the line "After: _measured on the next live window, see the quick task SUMMARY_" (1517) with this text, verbatim:

After (2026-10-18 12:49Z to 2026-10-19 13:58Z, 435 ticks, never more than 4 events live in a tick; tick span and publish latency computed exactly as the Before table):

| Slice | n | median | p90 | max |
|---|---|---|---|---|
| tick span, all ticks (1 to 4 events) | 435 | 4 s | 47 s | 85 s |
| post_result_time to published_at, folded matches | 141 | 122 s | 200 s | 1573 s |

No tick in the After window had 5 or more events live, so the busy-tick slices have no After yet. 25 of the 435 ticks still ran past 60 s, which is why quick task 261019-oim adds the lease.

Before, same slice: _orchestrator fills in_

C. New section directly after the 3ju section's closing `---` and before "## The ingest log": "## Overlapping ticks skip events still in flight (quick task 261019-oim, 2026-10-19)". Cover, as short bullets:
  - The problem in two sentences: a tick past 60 s overlaps the next one; the cursor CAS stops a double fold of one event, but two invocations folding different events both rewrite each algorithm's `league` row, and the later write erased the earlier.
  - The lease: one `event_lease` row per open window, taken by the tick for every open window in ONE D1 batch before any pass runs, released in ONE statement when the tick ends (also when it throws). A new tick skips every window another tick still holds. Cost: two subrequests and, per open window, one row written and one deleted per tick. An idle tick takes no lease and still costs one R2 read.
  - The 15 minute expiry and why (the cron wall time ceiling, so an older lease belongs to a killed tick and is taken over). Consequence, stated plainly: a tick that is killed, or whose release fails (`event-lease-release-failed`), leaves its events unfolded for up to 15 minutes. To clear that at once, delete the rows by hand with the same `--command` form (`DELETE FROM event_lease`), run without the `.env` token as the ingest log section says.
  - Fail open: if the lease batch throws (missing table, D1 outage) the tick warns `event-lease-unavailable` once and folds every window unguarded.
  - What to watch: the `events-in-flight` log line (tick id and the skipped keys) and the tick log's `eventsSkippedInFlight` counter. A tick that skips every window does not run the district pass; the tick holding the leases runs it.
  - The team page lock: inside one tick, each team page artifact's read, merge and write runs one at a time per artifact key (`locks.team`, a keyed lock in `boundedConcurrency.ts`), so one team at two concurrently folding events keeps both events' matches. It covers the Phase B team loop, the late breakdown backfill and schedule-only pricing. The 3ju residual "team page artifacts" is closed.
  - What is still NOT guarded, honestly: same-event double folds were already covered by the cursor CAS and still are. A window that opens (or appears in the manifest) after an older tick started is not held by it, so the newer tick leases and folds it while the older tick still folds its own events. Those two invocations can still both rewrite the `league` row, a shared team page or `teams/{year}`. This needs a window to open inside an overlap, which is rare.
  </action>
  <verify>
    <automated>grep -c "0004_event_lease" docs/worker-operations.md && grep -c "## Overlapping ticks skip events still in flight" docs/worker-operations.md && grep -c "| tick span, all ticks (1 to 4 events) | 435 | 4 s | 47 s | 85 s |" docs/worker-operations.md && grep -c "Before, same slice: _orchestrator fills in_" docs/worker-operations.md && grep -c "eventsSkippedInFlight" docs/worker-operations.md</automated>
  </verify>
  <done>
    Every grep prints 1 or more. The Database section names 0004 with the apply order, the 3ju section carries the After table and placeholder verbatim, and the new section covers every bullet above, including the newly opened window residual. Commit (stage by path): `docs(worker): event leases for overlapping ticks; measured After for concurrent events`, body naming quick task 261019-oim.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Worker -> D1 `event_lease` | New table written and read by the tick only. No browser path reaches D1. |
| Worker -> D1 `algorithm_state` / R2 artifacts | Shared state two overlapping invocations, or two events in one tick, can rewrite. |
| Worker -> logs | Three new JSON lines; Workers Logs are visible to the operator. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-oim-01 | Tampering (integrity) | league row in `algorithm_state` across overlapping invocations | high | mitigate | Per-event lease acquired in one batch before any pass; a held window is skipped (Task 1, tests 1 and 2, guard-removed proof). Residual for a window opening mid-overlap is documented (Task 3). |
| T-oim-02 | Tampering (integrity) | team page artifacts `v1/team/...` inside one tick | medium | mitigate | `locks.team.run(artifactKey(teamParams), ...)` on all three team read-merge-write sites (Task 2, test 5, guard-removed proof). |
| T-oim-03 | Tampering (integrity) | as-of season object conditional put | medium | mitigate | Existing `locks.asOf` now under direct test: zero refused puts with two SPR events in one tick (Task 2). |
| T-oim-04 | Denial of service | lease table missing or D1 outage | high | mitigate | Fail open: one `event-lease-unavailable` warn, every window folds unguarded, no release attempted (Task 1, test 4). |
| T-oim-05 | Denial of service | lease left by a killed tick or a failed release | medium | accept | Expires after `EVENT_LEASE_TTL_MS` (15 min, the cron wall time ceiling, so a live tick is never taken over); release never throws; operator `DELETE FROM event_lease` escape documented (Task 3). Ticks run max 85 s today. |
| T-oim-06 | Information disclosure | new log lines | low | mitigate | Lines carry event keys, a tick UUID and a truncated error message only. Never read, echo or log `.env` values (CLAUDE.md secrets rule). |
</threat_model>

<verification>
Run everything from the repo root (never `timeout n pnpm ...`, which swallows output and exits 0):

- `npx vitest run apps/worker` after each task; all green. `scheduled.replay`, `scheduled.rp` and `scheduled.rowParity` green with no assertion changed.
- `npx tsc --noEmit -p apps/worker/tsconfig.json` and `npx tsc --noEmit` both exit 0. Triage every type error. Never batch-dismiss one as pre-existing.
- After Task 3, once: `npx vitest run` over the whole repo; report the file and test counts.
- Guard-removed runs: Task 1 tests 1 and 2 fail with the lease result ignored; Task 2 test 5 fails without `locks.team.run`; the as-of test fails without `locks.asOf.run`. Each passes again once restored. None of the removals is committed.
- No network: no deploy, no `wrangler d1 execute --remote`, no `wrangler d1 migrations apply`, no push. The orchestrator applies the migration and deploys.
- Never Read, cat or echo `.env`.
</verification>

<success_criteria>
- Migration 0004 and `eventLease.ts` exist with the SQL text fixed by the design, proven on a real SQLite engine.
- A tick skips every window another unexpired tick holds, takes over an expired one, folds everything when the lease table is unavailable, takes no lease when idle, and always releases what it holds.
- `TickResult.eventsSkippedInFlight` is carried by every return.
- One team at two events in one tick keeps both events' matches; two SPR events in one tick cause no as-of conflict.
- All nine fake databases understand the lease SQL without changing any existing counter or rejection behaviour.
- Docs carry 0004, the measured After table with its placeholder, and the new section with an honest residual.
- Three commits, one per task, `.planning/` untouched.
</success_criteria>

<output>
Do NOT write SUMMARY.md. Return the summary as TEXT in your final message; the orchestrator writes
`.planning/quick/261019-oim-tick-overlap-guard-d1-lease-per-tick-so-/261019-oim-SUMMARY.md`.
The summary must carry: the three commit hashes; every guard-removed run (test name, the failing
assertion, then the passing run) and any hold figure raised; the moved subrequest pins and why;
the `runScheduleOnlyPricing` addition; the plan choices (lease tick id set only when a key is held,
all-skipped tick runs no district pass); test and typecheck results with counts.
</output>
