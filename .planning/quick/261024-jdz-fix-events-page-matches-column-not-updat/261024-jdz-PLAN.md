---
phase: quick-261024-jdz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/worker/src/eventsListRebuild.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/test/eventsListRebuild.test.ts
  - apps/worker/test/scheduled.phaseBWrites.test.ts
  - packages/core/algorithms/cancelledEvent.ts
  - apps/web/src/lib/liveEvent.ts
  - apps/web/src/lib/liveEvent.test.ts
  - apps/web/src/lib/api/events.ts
  - apps/web/src/lib/api/events.test.ts
  - apps/web/src/lib/query-client.ts
autonomous: true
requirements: [QUICK-261024-jdz]

estimate:
  tokens: 75000
  raw_tokens: 150000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "After a live tick folds a match, the events list row for that event carries the event artifact's current playedMatchCount, matchCount and teamCount, for every event type including offseason (type 99)"
    - "A posted but unscored schedule (the schedule-only pricing path) moves a 0/0 row to 0/N on the same tick"
    - "The Worker never adds a row to the list, never creates a missing list, leaves rows of events it did not process byte-identical, keeps every publisher-owned field, and skips the list write entirely when no count changed"
    - "A list rebuild failure never throws out of the tick: the district pass, live event pass and writeTickMeta still run"
    - "The Events page refetches the list every 60 s while at least one row's local start date is within the last 7 days (today included), and never polls a finished season or a season whose events are all in the future; a hidden tab stops polling"
    - "Comments that said the Worker never rewrites the events list are corrected"
  artifacts:
    - path: "apps/worker/src/eventsListRebuild.ts"
      provides: "eventsListCountsOf, recordEventsListCounts, patchEventsListRows, runEventsListRebuild, EventsListFeed, EventsListCounts"
    - path: "apps/worker/src/scheduled.ts"
      provides: "eventsListFeed threaded runTick -> processEvent -> runPhaseBAndReport and runScheduleOnlyPricing; runEventsListRebuild called after runGlobalRebuild"
    - path: "apps/web/src/lib/liveEvent.ts"
      provides: "shouldPollEventsList(artifact, nowMs)"
    - path: "apps/web/src/lib/api/events.ts"
      provides: "eventsQueryOptions with refetchInterval"
  key_links:
    - from: "runPhaseBAndReport and runScheduleOnlyPricing (event artifact write)"
      to: "recordEventsListCounts"
      via: "counts derived from the object writeArtifactWithBootstrapRetry actually wrote"
    - from: "runTick"
      to: "runEventsListRebuild -> writeArtifactObject(env, counter, \"events\", params, candidate)"
      via: "one call after runGlobalRebuild, same position as the teams rebuild"
    - from: "eventsQueryOptions.refetchInterval"
      to: "shouldPollEventsList"
      via: "EVENT_POLL_INTERVAL_MS while true, false otherwise"
---

<objective>
Make the Events page "Matches" column (`playedMatchCount/matchCount`, `apps/web/src/components/events-list/EventsList.tsx:224`) move during a live event instead of freezing until the next offline publish.

Two independent causes, both fixed here:
1. Server: the live Worker writes `event`, `team` and `teams` artifacts but never the `events` list (`v1/events/{year}/{algorithmId}@{version}.json`). Task 1 adds an events-list rebuild that mirrors `runGlobalRebuild`: a per-tick feed of each processed event's CURRENT counts, patched into existing rows once per tick.
2. Browser: `eventsQueryOptions` never refetches (5-minute default staleTime, no interval). Task 2 adds a pure, tested `shouldPollEventsList` predicate and wires it as a 60 s `refetchInterval`, mirroring `eventQueryOptions`.

Purpose: during the fall 2026 offseason Jacob is watching this column right now. A side benefit: a multi-day unofficial event whose row reads 0 played is currently HIDDEN from day 2 onward by `isDisplayableEvent` (past start, zero played); patched counts keep it visible.

Output: one new Worker module plus tests, Worker wiring, one web predicate plus tests, corrected comments. No algorithm version bump (counts are not model output). No deploy inside the tasks.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/STATE.md

Verified anchors (2026-10-24, main at 509f9764):
- `apps/worker/src/scheduled.ts`: `writeArtifactWithBootstrapRetry` line 799; `runScheduleOnlyPricing` line 1195 (its event write at ~1286); `processEvent` line 1553 (schedule-only call at line 1673, Phase B call at line 2005); `runPhaseBAndReport` line 2038 (event write ~2156, composite key ~2164, team feed merge ~2229-2243); `runGlobalRebuild` line 2327; `runTick` feed declaration line 2826, `processEvent` call line 2863, `runGlobalRebuild` call line 2913. `touchedTeamsCompositeKey` line 998 (not exported). `WRITE_RETRY_ERROR_MESSAGE_MAX = 300` line 763 (not exported).
- `apps/worker/src/artifactWriter.ts`: `writeArtifactObject` line 96 already maps `events` to `EventsArtifactSchema` (line 58) and parses before the put; `readArtifactObject` line 248.
- `apps/worker/src/artifactMerge.ts`: `Stamp` line 82; `mergeEventArtifact` returns `unknown` (line 312).
- `packages/harness/pageArtifacts.ts`: `EventsListRowSchema` line 1438, `EventsArtifactSchema` line 1458 (rows: eventKey, name, eventType, isOffseason, startDate, week, teamCount, matchCount, playedMatchCount, country, stateProv, districtKey). `EventMatchSchema` line 317 requires `actualWinner` (line 462), so every event `matches` row is PLAYED; not-yet-played rows live only in `upcoming` (`EventUpcomingMatchSchema` line 608). Both carry `redTeams`/`blueTeams`.
- `packages/harness/publish.ts` `computeEventCounts` line 1771: played rows add to matchCount AND playedMatchCount, scheduled rows add to matchCount only, teamCount is the union of red and blue keys over both. The Worker must reproduce exactly this rule from the event artifact.
- `apps/web/src/lib/api/event.ts` line 75-85: the `refetchInterval` precedent. `apps/web/src/lib/liveEvent.ts`: `EVENT_POLL_INTERVAL_MS` line 28, `shouldPollDistrictArtifact` line 182 (honest-limitation comment voice). `packages/harness/eventSchedule.ts`: `SCHEDULE_STALE_AFTER_MS` (7 days), browser safe.
- `apps/web/src/components/events-list/filterModel.ts:146` `isDisplayableEvent`: hides unofficial rows with zero played whose startDate is before today (local).
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Worker patches the events list row from every event write (fold and schedule-only paths)</name>
  <files>apps/worker/src/eventsListRebuild.ts, apps/worker/src/scheduled.ts, apps/worker/test/eventsListRebuild.test.ts, apps/worker/test/scheduled.phaseBWrites.test.ts, packages/core/algorithms/cancelledEvent.ts</files>
  <read_first>
    - apps/worker/src/scheduled.ts lines 755-830 (error-message limit, writeArtifactWithBootstrapRetry), 990-1000, 1195-1295 (runScheduleOnlyPricing up to its event write), 1553-1582 and 1660-1680 (processEvent signature and schedule-only call), 2038-2250 (runPhaseBAndReport), 2320-2390 (runGlobalRebuild, the precedent), 2820-2915 (runTick feed, event loop, rebuild call)
    - apps/worker/src/artifactWriter.ts lines 50-110 and 240-253
    - packages/harness/pageArtifacts.ts lines 1429-1463
    - packages/harness/publish.ts lines 1766-1796 (computeEventCounts)
    - packages/core/algorithms/cancelledEvent.ts (whole file, short)
    - apps/worker/test/scheduled.phaseBWrites.test.ts lines 255-445 (fakes, fixtures, makeTbaFetchStub(eventType), revealed, afterEach) and 526-600 (the runGlobalRebuild feed test to mirror)
  </read_first>
  <behavior>
    - eventsListCountsOf over an artifact with 2 played rows and 1 upcoming row covering 9 distinct teams (with overlap) returns playedMatchCount 2, matchCount 3, teamCount 9; empty arrays return all zeros; a value missing `upcoming` returns undefined
    - patchEventsListRows: a fed row keeps every publisher field and takes the three counts; an unfed row is returned as the same object; equal counts report changed false; a fed event key with no row lands in missingEventKeys and no row is appended
    - recordEventsListCounts: two events recorded under one composite key both survive; a second record for the same event replaces the first
    - runTick fold (revealed 1, then 2 on a second tick): the seeded opr list row for 2026casj reads 1/3 then 2/3 with teamCount 6, publisher fields unchanged, the other row deep-equal to the seed, generation and computedAt equal to the tick's stamp
    - runTick offseason (makeTbaFetchStub(99)): the row is still patched (no officialness gate)
    - runTick schedule-only (revealed 0): the row reads 0/3, teamCount 6
    - no list in R2: no put to the events key, the tick still advances the event, one events-list-missing warn
    - list without a 2026casj row: no put to the events key, the list gains no row, one events-list-row-missing warn naming 2026casj
    - counts already current (seeded 1/3/6, revealed 1): no put to the events key
    - a put to the events key that throws: the tick still completes (event advanced, no throw) and one events-list-rebuild-failed warn
  </behavior>
  <action>
Write the tests first (RED), then implement (GREEN). Comments in the codebase's existing voice: explain the WHY and cite quick task 261024-jdz.

1. NEW MODULE `apps/worker/src/eventsListRebuild.ts`. Header comment: the events list row is publisher-built, and until 261024-jdz the live tick never rewrote it, so the Events page Matches column froze at its publish-time value during a live event. Exports:
   - `EventsListCounts` interface with `matchCount`, `playedMatchCount`, `teamCount`.
   - `eventsListCountsOf(written: unknown): EventsListCounts | undefined`. safeParse a narrow zod shape (import `z` from "zod" as `tbaWebhook.ts` does): `matches` and `upcoming`, each an array of objects carrying `redTeams` and `blueTeams` string arrays. playedMatchCount is the matches length (EventMatchSchema requires actualWinner, so every `matches` row is played), matchCount is matches plus upcoming, teamCount is the size of the union of every red and blue key across both arrays. Doc comment: this is the same three-part rule as `computeEventCounts` in packages/harness/publish.ts, so a patched row and the next published row agree. Return undefined when the parse fails.
   - `EventsListFeed` type: a Map keyed by the tick's composite key string, each value holding `algorithmId`, `season` and a `counts` Map from eventKey to EventsListCounts. The value carries algorithmId and season explicitly so the rebuild never re-parses the key.
   - `recordEventsListCounts(feed, compositeKey, algorithmId, season, eventKey, counts)`: get-or-create the entry, then set the event's counts. Comment: SYNCHRONOUS by construction, so events folding concurrently (quick task 261018-3ju) cannot drop each other's entries; each event writes only its own key, and the counts are absolute, so a later record for the same event replaces.
   - `patchEventsListRows(rows, counts)`: returns `{ rows, changed, missingEventKeys }`. A row whose eventKey is fed becomes a leading spread of the prior row followed by the three counts (the spread keeps publisher-owned fields: name, eventType, isOffseason, startDate, week, country, stateProv, districtKey). An unfed row is returned as the same object. `changed` is true only when one of the three numbers differs. `missingEventKeys` is the sorted list of fed keys with no row. It never appends a row.
   - `runEventsListRebuild(env, counter, algorithmModules, feed, stamp): Promise<void>`. Returns before any read when the feed is empty (zero subrequests, so idle and 304 ticks stay byte-identical). For each entry: skip when the algorithm module is absent (as runGlobalRebuild does); params are page "events", year = season, algorithmId, version = the module's version; read via `readArtifactObject`. Absent object: one `events-list-missing` warn line (algorithmId, season) and continue, never invent a list. Otherwise parse with `EventsArtifactSchema`, patch, and when missingEventKeys is non-empty log one `events-list-row-missing` warn line (algorithmId, season, eventKeys). When nothing changed, write nothing and do not re-stamp. Otherwise write via `writeArtifactObject(env, counter, "events", params, candidate)` where candidate is the parsed artifact spread with `generation` and `computedAt` from the stamp and the patched `events`. Each entry runs in its own try/catch: a failure logs one `events-list-rebuild-failed` warn line (algorithmId, season, error message truncated to 300 characters) and moves to the next entry. The function NEVER throws: a list failure must not cost the district pass, the live event pass or writeTickMeta. Use a local constant of 300 with a comment naming scheduled.ts's WRITE_RETRY_ERROR_MESSAGE_MAX; do not import from scheduled.ts (it would be a circular import). Import `Stamp` from artifactMerge.ts. Warn lines carry ids, keys and a truncated message only, never an artifact body or an env value (the rule every warn line in scheduled.ts follows).
   - The module doc must also state three decisions:
     (a) NO OFFICIALNESS GATE, unlike the teams/{year} feed: offseason and preseason rows are displayed on the Events page and their Matches column must move too.
     (b) CONCURRENCY: the rebuild runs once per tick after every event has settled, so nothing races within one invocation. Across two overlapping invocations the exposure is the gap between one R2 read and one put. The rows carry absolute counts, so the next tick that touches the event rewrites its true count. That is the same exposure runGlobalRebuild has, and runGlobalRebuild carries deltas.
     (c) THE CANCELLED-ROW GUARD: the browser's events fetcher drops rows that `isCancelledEvent` flags at the list's own computedAt, and a Worker re-stamp moves that instant to the tick. The rows it newly hides have zero played matches and a start date at least a week past, which is the publisher's own rule at that instant. Every event the Worker folds or prices gets its real count, so a live event stays visible. Residual: an event that ran after the last publish but before this change deployed keeps a zero played count and can be hidden once the list is re-stamped. An unofficial one is already hidden by isDisplayableEvent, and the next publish restores any official one. This is acceptable, and the no-change skip keeps re-stamps to ticks that actually moved a count.

2. WIRING in `apps/worker/src/scheduled.ts`:
   - Make `writeArtifactWithBootstrapRetry` generic in the artifact type and have it RETURN the object it actually wrote (the merged candidate, or the bootstrap rebuild when the retry ran). Existing callers that ignore the result are unchanged. Why: a bootstrap rewrite carries only this tick's rows, and the list row must match what the event page actually carries.
   - `runTick`: declare `eventsListFeed` (type EventsListFeed, a new Map) beside `touchedTeamsByAlgorithm`. Comment: only the fold and schedule-only paths feed it; the roster pass, the late breakdown backfill and the live event pass change neither `matches` nor `upcoming`.
   - Thread it as a new parameter placed right after `touchedTeamsByAlgorithm` in `processEvent`, `runPhaseBAndReport` and `runScheduleOnlyPricing`, with a one-line param doc in the existing style. processEvent passes it to both callees.
   - `runPhaseBAndReport`: capture the return of the event write for each algorithm, derive counts with `eventsListCountsOf`, and when they are defined call `recordEventsListCounts(eventsListFeed, touchedTeamsCompositeKey(algorithmId, window.season), algorithmId, window.season, eventKey, counts)`. Place it immediately after the event write and BEFORE the team loop, outside the `isOfficial` gate. Comment why it is unconditional (see 1a) and why it sits before the team loop (the event artifact is already written even if a team write later throws into the blanket catch).
   - `runScheduleOnlyPricing`: the same, after its event write. Comment: this is the path that turns a promoted event's 0/0 row into 0/N when its schedule is posted.
   - Call `await runEventsListRebuild(env, subrequests, algorithmModules, eventsListFeed, stamp)` immediately after the `runGlobalRebuild` call. Comment, citing 261024-jdz: cost is one R2 read per algorithm-season per tick that wrote an event artifact, plus one put only when a count changed (Workers Paid since 2026-09-22; puts come out of R2's 1M Class A allowance, the same budget the teams rebuild uses). Do not add a TickResult field.
   - Do not bump any algorithm version.

3. TESTS.
   - NEW `apps/worker/test/eventsListRebuild.test.ts` (unit): the eventsListCountsOf, patchEventsListRows and recordEventsListCounts cases in `<behavior>`.
   - `apps/worker/test/scheduled.phaseBWrites.test.ts`: add a describe "the events list (quick task 261024-jdz)" using the file's existing fixtures (FakeR2Bucket seed and peek, `revealed`, `makeTbaFetchStub(eventType)`, `makeEnv`, `makeManifests`, `SEASON`, `opr`). Add a seed helper that builds an `EventsArtifactSchema`-valid list for opr at `artifactKey({ page: "events", year: SEASON, algorithmId: "opr", version: opr.version })`. It holds a 2026casj row at 0/0 with teamCount 0 and a second, untouched row (for example 2026other), both with distinctive publisher field values. Implement every runTick case in `<behavior>`; MATCHES covers frc1 to frc6, so teamCount is 6 and matchCount is 3. For the throwing-put case, add a minimal per-key failure hook to this file's FakeR2Bucket (for example a `failPutsForKey` field that makes `put` throw for that key only), because a global put failure would also fail the event write. Assert warn lines by filtering `console.warn` calls on the msg name, as existing tests do.
   - Run the FULL worker suite. Any exact subrequest, get-count or put-count assertion on a tick that wrote an event artifact moves by the events-list read (one get per algorithm-season). Update those by naming the new term in the existing comment style, never by loosening to a range. Idle and 304 ticks must not move at all.

4. `packages/core/algorithms/cancelledEvent.ts`, COMMENT ONLY. Two places say the Worker does not rewrite a published events list: the header paragraph about the reference instant, and its last sentence. Rewrite them to say that since quick task 261024-jdz the Worker re-stamps the list only when it patches the counts of an event it folded or priced, and that a row it never touched keeps its publish-time count, which is why the reference instant is still the artifact's own computedAt. The file must still import nothing (packages/core/isomorphic.test.ts).

Commit atomically with the code and test changes only, for example `fix(quick-261024-jdz): live Worker patches events list match counts`. Stage by path.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout && npx vitest run apps/worker && npx vitest run packages/core && npx tsc --noEmit -p apps/worker/tsconfig.json && pnpm typecheck && grep -c "runEventsListRebuild" apps/worker/src/scheduled.ts && grep -c "page: \"events\"" apps/worker/src/eventsListRebuild.ts && test "$(grep -c "never rewrites a published events list" packages/core/algorithms/cancelledEvent.ts)" = "0"</automated>
  </verify>
  <done>Worker suite green from the repo root, including the new unit file and the new phaseBWrites describe (fold 1/3 then 2/3, offseason patched, schedule-only 0/3, absent list untouched, missing row untouched, unchanged counts skip the put, throwing put leaves the tick intact). Worker and root typechecks clean. `runEventsListRebuild` is imported and called once in scheduled.ts after runGlobalRebuild. The cancelledEvent.ts comment no longer claims the Worker never rewrites the list. One atomic commit holding code and tests only.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Events page refetches the list every 60 s while an event is in its live window</name>
  <files>apps/web/src/lib/liveEvent.ts, apps/web/src/lib/liveEvent.test.ts, apps/web/src/lib/api/events.ts, apps/web/src/lib/api/events.test.ts, apps/web/src/lib/query-client.ts</files>
  <read_first>
    - apps/web/src/lib/liveEvent.ts (whole file; note EVENT_POLL_INTERVAL_MS, the eventSchedule.js import, shouldPollDistrictArtifact's limitation comment)
    - apps/web/src/lib/api/event.ts lines 1-40 (Query type import) and 60-85 (eventQueryOptions refetchInterval)
    - apps/web/src/lib/api/events.ts (whole file)
    - apps/web/src/lib/api/events.test.ts lines 1-60 and 94-150 (fixture builder, cancelled-row tests that must stay green)
    - apps/web/src/lib/query-client.ts
    - packages/harness/eventSchedule.ts lines 1-20 (SCHEDULE_STALE_AFTER_MS)
    - apps/web/src/routes/events.tsx lines 40-50 (local en-CA date precedent)
  </read_first>
  <behavior>
    - nowMs at local noon 2026-10-24 (built with the local Date constructor, so the test holds in any time zone): a row starting 2026-10-24 polls; a row starting 2026-10-17 polls; a list whose only row starts 2026-10-16 does not
    - future-only rows (2026-10-25 onward) do not poll; a finished season (all 2025 rows) does not poll; undefined does not poll
    - a malformed startDate ("" or "2026-10") alone does not poll
    - nowMs at local 23:30 on 2026-10-24 with a row starting 2026-10-25 does not poll (local date, never UTC)
    - one live row among many finished rows polls
    - month boundary: start 2026-09-28 polls at local 2026-10-05 and stops at local 2026-10-06
    - eventsQueryOptions.refetchInterval returns EVENT_POLL_INTERVAL_MS for a live list, false for a finished list and for undefined data; the options object has no refetchIntervalInBackground key
  </behavior>
  <action>
Tests first (RED), then implementation (GREEN). Comments in the existing voice, citing quick task 261024-jdz.

1. `apps/web/src/lib/liveEvent.ts`: add an exported `shouldPollEventsList(artifact, nowMs): boolean`. The artifact parameter is structurally typed as an object with a readonly `events` array of rows carrying a `startDate` string, or undefined, so the module stays free of schema imports. Rule:
   - Take today from `new Date(nowMs).toLocaleDateString("en-CA")`, the local date, as events.tsx and isDisplayableEvent use.
   - A row is in its live window when its startDate matches the YYYY-MM-DD shape, startDate is at or before today, and today is at or before startDate plus N days.
   - N is `SCHEDULE_STALE_AFTER_MS` divided by one day, which is 7. Import the constant from eventSchedule.js beside the existing import, so the publisher's window stays defined in one place.
   - Add the days with calendar arithmetic on the string's own year, month and day: use Date.UTC purely as a calendar, then slice back to YYYY-MM-DD. Never convert time zones.
   - Return true when any row is in its window. Return false for undefined. A malformed startDate makes that row not live, which errs toward not polling: the list still renders, it just does not refresh.
   - NO COUNT GATE, and the doc comment says why. Played equals total in the gap between the last qualification match and the playoff schedule landing; quick task 261017-doy fixed that same gap for the event page. A promoted event also reads 0/0 until the Worker patches it. Both need polling, and a list row has no finals facts to tell a finished event apart.
   - Write an HONEST LIMITATION paragraph in the shouldPollDistrictArtifact voice. The list row carries a start date and counts, but no match times, no end date and no finals result. So a finished event keeps an open Events page polling at the 60 s floor until its window closes (at most 7 days after its start), and in season the page polls whenever any event is in its window. The bound is the window plus TanStack's focus gating. Each poll re-reads the edge-cached list (max-age 60). A second, finer currency approximation is deliberately not invented.

2. `apps/web/src/lib/api/events.ts`:
   - `eventsQueryOptions` gains a `refetchInterval` function. It takes the query, typed exactly as eventQueryOptions types its own (the Query type imported from @tanstack/react-query, with data EventsArtifact and the readonly ["events", number, string, string] key). It returns EVENT_POLL_INTERVAL_MS when `shouldPollEventsList(query.state.data, Date.now())` is true, else false.
   - Leave `refetchIntervalInBackground` unset, so a hidden tab stops polling. Add a doc comment mirroring eventQueryOptions' LD-3 paragraph.
   - In fetchEventsArtifact's cancelled-row comment, rewrite the sentence that says the live Worker does not rebuild this list. It should now say: since 261024-jdz the Worker patches the counts of events it folds or prices, and re-stamps computedAt when it does. Keep the reasoning for using the artifact's computedAt instead of the browser clock: a row the Worker never touched keeps its publish-time count, and a browser-clock check would hide it a week later. Add one sentence: after a Worker re-stamp, the guard hides only rows with zero played matches a week past their start, which is the publisher's own rule at that instant. Do not change the fetch, parse or filter logic.

3. `apps/web/src/lib/query-client.ts`, COMMENT ONLY. It currently says the event artifact is the one query on a shorter cadence. Update it to name the four live polls: event, team, district and the events list. Each refetches at 60 s only while live, and each pauses in a hidden tab.

4. TESTS.
   - `apps/web/src/lib/liveEvent.test.ts`: add a describe for shouldPollEventsList covering every predicate case in `<behavior>`. Build nowMs with the local Date constructor (for example new Date(2026, 9, 24, 12, 0).getTime()), never Date.parse of an ISO string, so the tests are time-zone independent.
   - `apps/web/src/lib/api/events.test.ts`: add a describe "eventsQueryOptions polling (quick task 261024-jdz)". Use vi.useFakeTimers with vi.setSystemTime(new Date(2026, 9, 24, 12, 0)), and restore real timers in afterEach. Call the options' refetchInterval with a minimal object holding `state.data`, cast at the call site. Cover a live list (a row starting 2026-10-24) returning EVENT_POLL_INTERVAL_MS, the existing 2025 fixture returning false, undefined data returning false, and the absence of the refetchIntervalInBackground key. The existing fetchEventsArtifact and cancelled-row tests stay unchanged and green.

Commit atomically with the code and test changes only, for example `fix(quick-261024-jdz): Events page polls the list while an event is live`. Stage by path.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout && npx vitest run apps/web/src/lib && npx tsc --noEmit -p apps/web/tsconfig.json && pnpm typecheck && grep -c "shouldPollEventsList" apps/web/src/lib/api/events.ts && test "$(grep -c "never rebuilds this list" apps/web/src/lib/api/events.ts)" = "0"</automated>
  </verify>
  <done>apps/web/src/lib tests green from the repo root, including every new shouldPollEventsList case and the eventsQueryOptions polling describe; the existing cancelled-row tests unchanged and green. Web, root and e2e typechecks clean. eventsQueryOptions polls at EVENT_POLL_INTERVAL_MS only while a row is in its local-date live window. The events.ts comment no longer claims the Worker never rebuilds the list. One atomic commit holding code and tests only.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TBA -> Worker | Match lists and schedules are third-party input, already schema-parsed by the existing poll path; counts derive from the merged event artifact, never from raw TBA JSON |
| Worker -> R2 (events list) | A new writer of a public artifact the Events page renders |
| R2 edge -> browser | The browser polls a public, edge-cached JSON file |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261024-01 | Tampering | runEventsListRebuild candidate | medium | mitigate | writeArtifactObject parses the candidate with EventsArtifactSchema before the put (zero puts on failure); rows are patched, never appended; a missing list is never invented; a parse failure of the existing list skips the write |
| T-261024-02 | Information disclosure | events list body and warn lines | medium | mitigate | writeArtifactObject refuses any body containing TBA_API_KEY; warn lines carry algorithmId, season, event keys and a 300-character message only |
| T-261024-03 | Denial of service | browser polling | low | mitigate | 60 s floor equal to the edge max-age, interval only while a row is in its 7-day live window, refetchIntervalInBackground unset so a hidden tab stops |
| T-261024-04 | Denial of service | tick resilience | medium | mitigate | runEventsListRebuild never throws; each algorithm-season runs in its own try/catch, so writeTickMeta, the district pass and the live event pass still run |
| T-261024-05 | Tampering | cross-invocation list overwrite | low | accept | Read-to-put window is one R2 round trip; rows carry absolute counts, so the next touching tick restores the true count; same exposure as runGlobalRebuild |
</threat_model>

<verification>
Run all from the repo root (never from apps/web or apps/worker, never wrapped in `timeout`):
- `npx vitest run` (full suite, once, after both commits)
- `pnpm typecheck` (root plus e2e), `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx tsc --noEmit -p apps/worker/tsconfig.json`
- `git status` clean after the two commits; `git log -2 --stat` shows code and tests only, no `.planning/` files and no `.env`
</verification>

<success_criteria>
- A live fold or a posted schedule updates the matching events list row's playedMatchCount, matchCount and teamCount on the same tick, for official and offseason events alike
- No row is ever invented, unfed rows and publisher fields are untouched, and an unchanged tick writes no list
- The Events page refetches the list at 60 s while any event is in its local-date live window and never otherwise
- Both commits atomic, all suites and typechecks green, no algorithm version bumped
</success_criteria>

<output>
Create `.planning/quick/261024-jdz-fix-events-page-matches-column-not-updat/261024-jdz-SUMMARY.md` when done. If that write is blocked in the executor's context, return the full summary text to the orchestrator instead. Docs artifacts are committed by the orchestrator, not with the code.

## Operator follow-up (orchestrator)

The executor has no network; these steps belong to the main context, in this order:
1. Deploy the Worker: `npx wrangler deploy` from apps/worker on a clean tree, then note the version id.
2. Push: check `origin/main..main` first (concurrent sessions), then `git push`.
3. Run `gh run list` and confirm CI is green for the pushed commit.
4. Watch the live Events page (sigmascout.org/events, current offseason): within one or two ticks of the next scored match, the live event's Matches cell should move without a reload. Confirm with a real browser or an Origin header (Pages cache poisoning), and fetch the list with GET, not HEAD (R2 edge cache).
</output>
