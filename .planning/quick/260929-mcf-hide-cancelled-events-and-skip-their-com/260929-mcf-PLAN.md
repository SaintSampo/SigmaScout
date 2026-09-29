---
id: 260929-mcf
slug: hide-cancelled-events-and-skip-their-com
kind: quick
mode: executor
created: 2026-09-29
description: "Cancelled events (past, zero played matches) are never published, priced or listed; the browser hides already-published ones; an operator script cleans R2 without a republish"
phase: quick-260929-mcf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/algorithms/cancelledEvent.ts
  - packages/core/algorithms/cancelledEvent.test.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - packages/corpus/db.ts
  - packages/harness/manifests.test.ts
  - apps/web/src/lib/api/events.ts
  - apps/web/src/lib/api/events.test.ts
  - scripts/pruneCancelledEvents.ts
  - scripts/pruneCancelledEvents.test.ts
  - package.json
autonomous: true
requirements: [QUICK-260929-mcf]

estimate:
  tokens: 75000
  raw_tokens: 150000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "A past event with zero played matches (every 2020 cancellation, e.g. a regional whose start_date is 2020-03-19) is absent from a newly published events list and gets no per-event artifact and no presim sidecar"
    - "A zero-match event that is upcoming, in progress, or less than 7 days past its start_date stays in the events list, and a probe-window event still gets its stub artifact (the 2026cc / 260920-lny shape is unharmed)"
    - "A past event whose schedule was posted but never scored (2019wagg, 2024txsg shape) is not priced: no upcoming rows on its teams' season artifacts, no Teams-list row or activeYears entry for a team seen only there"
    - "The browser's events list (Events page, search, year switch) drops rows that were already cancelled at the artifact's own computedAt, and never judges by the browser clock"
    - "The Worker needs no change: a cancelled event can never hold a probe window (pinned by test), so the cron already spends nothing on it"
    - "isOfficialEventType, foldsIntoRatings and the Events page's isDisplayableEvent are untouched"
  artifacts:
    - path: "packages/core/algorithms/cancelledEvent.ts"
      provides: "isCancelledEvent predicate plus EVENT_SPAN_ALLOWANCE_MS and CANCELLED_EVENT_GRACE_MS, import-free (isomorphic)"
      exports: ["isCancelledEvent", "EVENT_SPAN_ALLOWANCE_MS", "CANCELLED_EVENT_GRACE_MS", "CancellationFacts"]
    - path: "packages/harness/publish.ts"
      provides: "cancelledEventKeysForSeason and the season-loop filter over eventMeta and scheduled matches"
      contains: "isCancelledEvent"
    - path: "apps/web/src/lib/api/events.ts"
      provides: "fetchEventsArtifact drops rows cancelled as of the artifact's computedAt"
      contains: "isCancelledEvent"
    - path: "scripts/pruneCancelledEvents.ts"
      provides: "dry-run-by-default operator script: rewrites events lists by projection, deletes orphan event artifacts and presim sidecars"
      exports: ["projectEventsList", "cancelledArtifactKeys", "refusalReason"]
  key_links:
    - from: "packages/harness/publish.ts"
      to: "packages/core/algorithms/cancelledEvent.ts"
      via: "cancelledEventKeysForSeason calls isCancelledEvent with corpus played counts and Date.parse(computedAt)"
      pattern: "isCancelledEvent\\("
    - from: "apps/web/src/lib/api/events.ts"
      to: "packages/core/algorithms/cancelledEvent.ts"
      via: "row filter evaluated at Date.parse(parsed.computedAt)"
      pattern: "isCancelledEvent\\("
    - from: "scripts/pruneCancelledEvents.ts"
      to: "packages/core/algorithms/cancelledEvent.ts"
      via: "projectEventsList applies the same predicate at the list's own computedAt"
      pattern: "isCancelledEvent\\("
    - from: "packages/harness/manifests.test.ts"
      to: "packages/harness/manifests.ts"
      via: "invariant: isCancelledEvent true implies probeWindowFor undefined"
      pattern: "probeWindowFor"
---

# Quick task 260929-mcf: hide cancelled events and skip their compute

Jacob, 2026-09-29: "right now sigmascout wastes compute on displaying cancelled events. for
example many events in 2020. I dont want those using more resources than they have to or being
displayed on the site"

<objective>
One shared predicate decides "cancelled". The publisher applies it at the source, so a cancelled
event is never listed, priced or written as an artifact. The browser applies it to data that was
published before this change. An operator script, run from the main context afterwards, cleans up
the already-published R2 objects without a full republish.

**LOCKED-1 (orchestrator, not negotiable):** an event is cancelled only when its end date is in the
past, with a grace window, AND it has zero played matches. Upcoming and in-progress zero-match
events stay visible and keep their Worker probe windows. That is exactly what broke Chezy Champs on
2026-09-20 (260920-lny). The predicate lives in ONE shared helper and is tested with an
upcoming zero-match case and a 2020 cancelled case.

**End-date proxy (planner's call, recorded here):** the corpus `events` table has no end date,
only `start_date` (`packages/corpus/schema.sql`). No ingest path stores `end_date`, and TBA's event
model carries no explicit cancelled flag. Neither exists anywhere in `packages/ingest`. Adding
`end_date` would need a schema migration plus a networked re-ingest. So the end date is taken as
`start_date` midnight UTC + 4 days (`EVENT_SPAN_ALLOWANCE_MS`, the same span
`PROBE_WINDOW_SPAN_MS` uses to cover a multi-day championship), and the grace is 3 more days
(`CANCELLED_EVENT_GRACE_MS`) so late TBA uploads are not hidden. The effective rule: zero played
matches AND now >= start_date + 7 days. Because 7 days is more than the probe window's 4, a
cancelled event can never also hold a probe window. Task 2 pins that relationship.

Purpose: stop spending publish CPU, R2 writes and page space on events that never happened, and
stop showing them.
Output: the predicate, a source filter in the publisher, a browser belt-and-braces filter, and
`pnpm prune:cancelled-events`.
</objective>

## Where cancelled events cost resources today (measured on data/corpus.sqlite, 2026-09-29)

- **Events lists.** `publish.ts` builds `eventsRows` from EVERY `events` row of a season
  (`selectEventMeta`), so about 430 past zero-played events are listed across the ten seasons.
  2020 alone lists 140, the 134 COVID cancellations plus 6 Week 0 shells. The Events page already
  hides the unofficial ones (`isDisplayableEvent`), but it deliberately keeps official ones, so
  every 2020 cancellation renders as a "0/0" row, and search and the year switch return them.
- **Per-event artifacts.** The per-event loop skips only events with no predictions, no upcoming
  matches and no registered roster (`hasNothing`). The 2020 cancellations all have registered
  rosters (`event_teams`), so each gets a full event artifact per algorithm, with as-of-event
  standings. Adding 2022zhha, 2023tuis3, 2026isde3 and 2026isde4 plus 9 never-scored schedules,
  that is about 146 events, or about 440 objects across opr, epa and spr. 2026isde3/4 can also
  get presim sidecars.
- **Never-scored schedules.** 2017flrc, 2019flrc, 2019txrm, 2019wagg, 2020srrc, 2022ispr,
  2023iltrr, 2024txsg and 2025srsd have unplayed match rows but zero played. Every publish prices
  those matches (`predict()` per match per algorithm) as "upcoming" on the event page and on about
  238 team-season artifacts. 19 teams exist in a season ONLY through such a schedule: 12 in 2020
  via 2020srrc, 7 in 2017 via 2017flrc. They get a team page and a Teams-list row that show
  nothing real.
- **Worker: already zero cost.** `probeWindowFor` gives a zero-match event a window only until
  start_date + 4 days. RULE 2 in `buildLiveWindowsManifest` drops measured windows that have
  ended. So no past cancelled event is ever polled. No Worker code changes, and no Worker deploy.

## Explicitly out of scope

- **District pipeline** (`scripts/publishDistricts.ts`, District Locks / Champ Locks). The 2020
  cancellations posted Chairman's awards that consumed DCMP slots, and
  `packages/core/districts/reservedSlots.ts` ("the cancelled carve out") depends on seeing them.
  Filtering them there would move published Locked verdicts. This is flagged to Jacob as a
  follow-up question, not changed here.
- `isOfficialEventType`, `foldsIntoRatings`, `OFFICIAL_EVENT_SQL` and the Events page's
  `isDisplayableEvent` (Week 0 / offseason handling). None of them is edited or merged with the
  new predicate.
- Worker source, the live-windows manifest builder, `scripts/publishProbeStubs.ts`.

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

Source anchors (read the named line ranges only; publish.ts and publish.test.ts are large):
- packages/core/algorithms/eventTypes.ts: the import-free predicate style to mirror
- packages/harness/manifests.ts lines 60-100: `PROBE_WINDOW_SPAN_MS`, `PROBE_WINDOW_LEAD_MS`, `probeWindowFor`
- packages/harness/publish.ts lines 1762-1770 (`selectEventMeta`), 1868-1960 (season loop head:
  activeYears pre-pass, `stream`, `scheduled`, `eventMeta`), 2226-2250 (`eventsRows`), 2415-2430
  (per-event loop and `hasNothing` stub rule)
- packages/corpus/db.ts lines 585-595 (played = `m.winner IS NOT NULL`), 1215-1250 (`selectTeamKeysForYear`)
- packages/harness/publish.test.ts lines 86-120 (r2Client mock), 195-250 (`findEventArtifact`,
  `seasonEvent`, `seasonMatch`), 3981-4010 (the probe-stub describe, which pins `computedAt`)
- apps/web/src/lib/api/events.ts and events.test.ts (whole files, small)
- scripts/publishProbeStubs.ts (manifest read, Origin header, putObject pattern),
  scripts/verifySubsetPublish.ts lines 60-62 and 646-655 (`DEFAULT_ARTIFACT_ORIGIN`,
  `ALGORITHMS_MANIFEST_KEY`, `fetchArtifactFresh`), scripts/publishLiveWindows.ts line 58
  (`DEFAULT_LIVE_WINDOWS_SEASONS`, already pinned to package.json's publish:seasons spec by its test)

Execution rules for this repo:
- Never Read, cat or echo `.env`. No task here needs a secret. The operator script reads
  credentials only inside `packages/harness/r2Client.ts`.
- No network. Do not run any publish, prune, deploy or push. The operator section at the end is
  for the main context.
- Run vitest as `npx vitest run <paths>` from the repo root, and judge by the printed pass/fail
  counts, not the exit code. `timeout ... pnpm` swallows output.
- Stage by explicit path only. Other sessions share this checkout.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1 (tracer): isCancelledEvent in core, wired into the publisher's season loop so a cancelled event is never listed, priced or written</name>
  <files>packages/core/algorithms/cancelledEvent.ts, packages/core/algorithms/cancelledEvent.test.ts, packages/harness/publish.ts, packages/harness/publish.test.ts</files>
  <behavior>
    - isCancelledEvent({ startDate: "2020-03-19", playedMatchCount: 0 }, Date.parse("2026-09-29T00:00:00.000Z")) === true (2020 cancellation)
    - isCancelledEvent({ startDate: "2026-10-03", playedMatchCount: 0 }, same now) === false (upcoming zero-match)
    - isCancelledEvent({ startDate: "2026-09-27", playedMatchCount: 0 }, same now) === false (in progress / inside allowance)
    - boundary: startDate "2026-09-22" is false at Date.parse("2026-09-28T23:59:59.999Z") and true at Date.parse("2026-09-29T00:00:00.000Z")
    - isCancelledEvent({ startDate: "2019-03-01", playedMatchCount: 1 }, same now) === false (played events are never cancelled)
    - unparseable startDate ("" and "not-a-date") and a NaN nowMs both return false (degrade toward showing)
    - EVENT_SPAN_ALLOWANCE_MS === 345600000 and CANCELLED_EVENT_GRACE_MS === 259200000 (pinned literals)
    - publishSeasons at computedAt "2026-09-29T00:00:00.000Z", season 2026, algorithm spr, over a fixture holding a played event 2026casj, a past regional "2026gone" (start 2026-03-15, registered roster frc1..frc6, no matches), an offseason "2026soon" (start 2026-10-03, registered roster, no matches) and an offseason "2026edge" (start 2026-09-23, no roster, no matches): the events-list eventKeys equal exactly ["2026casj", "2026edge", "2026soon"]; no putObject key contains "/event/2026gone/"; an event artifact for 2026soon IS uploaded
    - every row of that published events list satisfies isCancelledEvent(row, Date.parse(computedAt)) === false, so the browser filter in Task 3 is a no-op on artifacts this publisher writes
  </behavior>
  <action>
Create packages/core/algorithms/cancelledEvent.ts. It must import nothing (`packages/core/isomorphic.test.ts` enforces the core directory's isomorphism; the Worker and browser read this file too). Export:
- `CancellationFacts`: an interface with readonly `startDate: string` and `playedMatchCount: number`. That is exactly the two field names the published events-list row already carries, so a row passes straight in.
- `EVENT_SPAN_ALLOWANCE_MS` = 4 days in ms.
- `CANCELLED_EVENT_GRACE_MS` = 3 days in ms.
- `isCancelledEvent(facts, nowMs): boolean`.

The predicate returns false when `playedMatchCount > 0`. It also returns false when `Date.parse(startDate)` or `nowMs` is not finite, mirroring `probeWindowFor`'s NaN rule: degrade toward showing. Otherwise it returns `nowMs >= startMs + EVENT_SPAN_ALLOWANCE_MS + CANCELLED_EVENT_GRACE_MS`. The file header documents all of this:
- LOCKED-1 verbatim in substance.
- Why start_date + 4 days stands in for the end date: there is no end_date column, and neither the corpus nor TBA carries a cancelled flag.
- Why the total of 7 days exceeds the probe window, and the Chezy Champs incident (260920-lny).
- That the predicate is independent of event type, deliberately NOT merged with `isOfficialEventType` or `foldsIntoRatings`.
- That "now" is always the caller's reference instant (the publish computedAt, or an artifact's computedAt), never an ambient clock read inside the predicate.

Write cancelledEvent.test.ts first with the `<behavior>` cases above, all as exact `toBe` equalities. Run it red, then implement.

In packages/harness/publish.ts:
1. Add a module-private corpus read, `selectPlayedMatchCountsByEvent(db, season): Map<string, number>`. It counts `matches` joined to `events` where `e.year` equals the season and `m.winner IS NOT NULL`, the same "played" definition `selectPlayedMatches` uses at db.ts line 589, grouped by `m.event_key`. It gets NO official or offseason clause. Cancellation is a property of the world, not of this run's `--include-offseason` scope. Without this, a run without the flag would see every offseason event as zero-played and drop it.
2. Add an exported `cancelledEventKeysForSeason(db, season, nowMs): Set<string>`. It reads `selectEventMeta` plus the played counts and keeps the keys where `isCancelledEvent({ startDate: e.start_date, playedMatchCount: counts.get(key) ?? 0 }, nowMs)`.
3. In `publishSeasonsWith`, compute `nowMs = Date.parse(computedAt)` once. Then build `cancelledBySeason` (a Map from season to Set) for every season in `seasonsSorted`, placed BEFORE the activeYears pre-pass so Task 2 can reuse it there.
4. Inside the season loop, filter BOTH of these by that season's set:
   - The `selectScheduledMatches` result: drop matches whose `eventKey` is cancelled. This removes never-scored schedules from `teamsThisSeason`, `qualMatchCountByEvent`, `scheduledByEvent`, `eventCounts`, the per-team scheduled grouping and all pricing.
   - The `selectEventMeta` result: this removes the rows from `eventsRows`, the per-event artifact loop, the presim sidecar and `registeredTeamsByEvent`.

   They MUST be filtered together. The team-season section builder looks up `eventMeta.find(...)` for every event a team's matches name. Filtering only `eventMeta` would publish sections with an empty startDate and a key-as-name.
5. Log one line per season with the count, for example `publish: season 2020: 140 cancelled event(s) skipped (zero played matches, start_date 7+ days before <computedAt date>)`, plus the first 10 keys.
6. Leave the `hasNothing` / `probeWindowFor` stub rule exactly as is.

In packages/harness/publish.test.ts:
- Add a describe `publishSeasons — cancelled events (quick task 260929-mcf)` using the existing r2Client mock, `seasonEvent`, `seasonMatch`, `upsertEventTeam` and `findEventArtifact` helpers. Pin `computedAt: "2026-09-29T00:00:00.000Z"` and cover the fixture and assertions in `<behavior>`. Read the events-list body from the `putObject` call whose key comes from `artifactKey({ page: "events", year: 2026, algorithmId: spr.id, version: spr.version })`.
- Then run the WHOLE file and the other publishSeasons callers (`presimRookieRule.test.ts`, `rpColdPrior.test.ts`, `sigmaCarry.publish.test.ts`). Some existing tests may now fail: a fixture event dated 2026-03-01 with only scheduled matches or only a roster, published at the default `computedAt` (the real clock, today) is now correctly cancelled. For each such failure, confirm the test's intent is an upcoming or in-progress event, then pin `computedAt` to an instant before that fixture's start_date (the 3981 describe already pins `computedAt` this way). Never loosen the predicate or special-case test data. Record in the SUMMARY how many tests needed a pinned `computedAt` and which.
  </action>
  <verify>
    <automated>npx vitest run packages/core/algorithms/cancelledEvent.test.ts packages/core/isomorphic.test.ts packages/harness/publish.test.ts packages/harness/presimRookieRule.test.ts packages/harness/rpColdPrior.test.ts packages/harness/sigmaCarry.publish.test.ts</automated>
  </verify>
  <done>All listed files pass (read the printed counts). The cancelled-events describe proves a 2026gone-shaped event is neither listed nor written, while 2026soon and 2026edge stay listed. isomorphic.test.ts still passes with the new core file. The SUMMARY lists every pre-existing test whose computedAt was pinned, with its reason.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: never-scored schedules leave team pages, the Teams list and activeYears; the Worker invariant is pinned</name>
  <files>packages/corpus/db.ts, packages/harness/publish.ts, packages/harness/publish.test.ts, packages/harness/manifests.test.ts</files>
  <behavior>
    - Fixture at computedAt "2026-09-29T00:00:00.000Z", seasons [2025, 2026], algorithm opr: frc77 plays one scored 2025 match; in 2026 frc77 appears ONLY in two unplayed (winner null) matches of offseason "2026dead" (start 2026-04-10) alongside frc1..frc5, who also play a scored 2026casj match. Assertions: no putObject key contains "/team/frc77/2026/"; no key contains "/event/2026dead/"; frc77's 2025 team artifact has activeYears equal to exactly [2025]; frc1's 2026 team artifact has no event section with eventKey "2026dead"; the 2026 teams list has no frc77 row
    - Same fixture plus offseason "2026later" (start 2026-10-10) with two unplayed matches: its event artifact is uploaded with upcoming.length === 2, and frc1's 2026 team artifact has a "2026later" section (an upcoming schedule is still priced)
    - selectTeamKeysForYear with excludeEventKeys omits teams seen only at excluded events and is unchanged when the option is absent
    - Invariant (manifests.test.ts): for every startDate in ["2020-03-19", "2026-09-22", "2026-10-03"] and every nowMs from startDate midnight UTC minus 2 days to plus 10 days in 1-hour steps, isCancelledEvent({ startDate, playedMatchCount: 0 }, nowMs) === true implies probeWindowFor(startDate, nowMs) === undefined; and EVENT_SPAN_ALLOWANCE_MS === PROBE_WINDOW_SPAN_MS
  </behavior>
  <action>
In packages/corpus/db.ts, add optional `excludeEventKeys?: ReadonlySet<string>` to `SelectTeamKeysForYearOptions`. When it is set, select `m.event_key` as well and skip rows whose event key is in the set. When absent, behaviour and output are byte-identical, so the media pass, which never passes it, is unchanged. Document it in the function's doc comment: the publisher uses it so a team seen only in a cancelled event's never-scored schedule gets no activeYears entry. Without that, the year dropdown would offer a year whose team artifact the publisher no longer writes, and the page would 404.

In packages/harness/publish.ts, pass `excludeEventKeys: cancelledBySeason.get(activeYearsSeason)` in the activeYears pre-pass. Task 1 already computes `cancelledBySeason` before this pre-pass.

In packages/harness/publish.test.ts, add the two `<behavior>` fixtures to the Task 1 describe, or to a sibling describe with the same setup. Use equality assertions (`toEqual` on exact arrays), never loops over a hardcoded season list. Add a direct `selectTeamKeysForYear` test with and without `excludeEventKeys`, in publish.test.ts or in an existing corpus test file if one already covers `selectTeamKeysForYear`. Pick whichever file already imports it, and do not create a new corpus test file.

In packages/harness/manifests.test.ts, append a describe `a cancelled event never holds a probe window (quick task 260929-mcf)`. It holds the invariant sweep and the constant equality from `<behavior>`, importing `isCancelledEvent` and `EVENT_SPAN_ALLOWANCE_MS` from the core file and `probeWindowFor` and `PROBE_WINDOW_SPAN_MS` from ./manifests.js. This test is the proof that the Worker needs no code change and no deploy: every event the publisher now drops is one the live-windows manifest could never give a window.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/publish.test.ts packages/harness/manifests.test.ts packages/corpus</automated>
  </verify>
  <done>frc77 has no 2026 team artifact and its 2025 activeYears is exactly [2025]. 2026dead is unpriced while 2026later is still priced. The invariant sweep passes. The existing manifests and corpus tests stay green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: already-published data — browser belt-and-braces filter and the dry-run-by-default R2 cleanup script</name>
  <files>apps/web/src/lib/api/events.ts, apps/web/src/lib/api/events.test.ts, scripts/pruneCancelledEvents.ts, scripts/pruneCancelledEvents.test.ts, package.json</files>
  <behavior>
    - fetchEventsArtifact over a fixture with computedAt "2026-09-28T12:00:00.000Z" and rows 2020casj (startDate 2020-03-19, played 0, matchCount 0), 2026soon (2026-10-03, played 0), 2026edge (2026-09-24, played 0), 2025alhu (2025-03-12, played 96): result eventKeys equal exactly ["2026soon", "2026edge", "2025alhu"] in input order
    - with vi.setSystemTime(new Date("2027-06-01T00:00:00.000Z")) the same call still keeps 2026soon (the artifact's computedAt governs, never the browser clock); restore real timers after
    - an artifact whose computedAt does not parse keeps every row
    - projectEventsList returns the same generation, computedAt, algorithmId, algorithmVersion and season, keeps surviving rows in order, parses through EventsArtifactSchema, and returns droppedEventKeys equal exactly ["2020casj"] for the fixture above
    - cancelledArtifactKeys(["2020casj"], { id: "spr", version: "9.0.0+x" }) equals exactly [artifactKey event 2020casj spr, preScheduleKey 2020casj spr]
    - refusalReason returns a reason string for an event artifact body whose matches array is non-empty or that does not parse as JSON, and undefined for one with matches []
    - the script's season list is the SAME array object as DEFAULT_LIVE_WINDOWS_SEASONS (toBe), which is already pinned to package.json's publish:seasons spec
    - main() with stubbed global fetch and a vi.mock of r2Client: the default run (no --execute) calls neither putObject nor deleteObject; with --execute, every events-list putObject happens before the first deleteObject, an event artifact carrying a played match is NOT deleted and the run sets process.exitCode = 1, a 404 key is counted absent and not deleted, and an events list whose generation differs from the manifest's is skipped, not rewritten
  </behavior>
  <action>
**Browser (apps/web/src/lib/api/events.ts).** After the `EventsArtifactSchema.parse` succeeds and before `markArtifactParsed`'s return, return the parsed artifact with `events` filtered to rows where `isCancelledEvent(row, Date.parse(parsed.computedAt))` is false. Import it from packages/core/algorithms/cancelledEvent.js at the same five-levels-up depth the file's header documents. The filter only runs after a successful parse, so a parse failure still raises `ArtifactValidationError`.

Explain in a comment why the reference instant is the artifact's computedAt and never Date.now():
- The live Worker never rebuilds the events list (STATE.md deferred item, WINDOWS #7).
- So an event the Worker promotes and folds after a publish keeps `playedMatchCount` 0 in its list row.
- A browser-clock check would hide it a week later. A computedAt check hides only rows the publisher itself would have dropped at that instant.
- That makes it a pure guard for lists published before 260929-mcf, and a no-op for every list published after, as Task 1's test pins.

This one fetcher feeds the Events page, `SearchBox`, `YearSelect`'s event-exists check and the team page's official snapshot, so no component changes. Leave `filterModel.ts`'s `isDisplayableEvent` untouched. Add the `<behavior>` cases to events.test.ts, reusing its `makeValidArtifact` style.

**Operator script (scripts/pruneCancelledEvents.ts).** Standalone-script shape like scripts/pruneR2Generations.ts: `parseArgs`, `async function main(argv)`, an entry-point guard. It gets no corpus import and never reads the environment; credentials stay inside r2Client. Export these:
- `SEASONS = DEFAULT_LIVE_WINDOWS_SEASONS`, imported from ./publishLiveWindows.js so there is one season list and it is pinned.
- `projectEventsList(artifact: EventsArtifact): { artifact: EventsArtifact; droppedEventKeys: string[] }`. It applies `isCancelledEvent` at `Date.parse(artifact.computedAt)` and keeps the generation and every stamp: a projection of the published list, not a recompute. The result re-parses through `EventsArtifactSchema`.
- `cancelledArtifactKeys(eventKeys, algorithm): string[]`. It returns `artifactKey({ page: "event", ... })` then `preScheduleKey(...)` for each key.
- `refusalReason(body: string): string | undefined`. It refuses when the body does not parse or its `matches` array is non-empty. A played match means the live Worker folded something there, so never delete it.

`main` behaviour:
1. Flags: `--execute` (default off, a dry run) and `--origin` (default `DEFAULT_ARTIFACT_ORIGIN`).
2. Read the live algorithms manifest with `fetchArtifactFresh` and a `randomUUID` run id. Refuse and exit 1 when it is not 200.
3. For each season in `SEASONS` and each manifest algorithm, fetch the events list fresh:
   - A 404 is logged and skipped.
   - A list whose `generation` differs from the manifest's is logged as skipped. It signals a concurrent publish, and the checkout is shared.
   - Otherwise project it. When anything was dropped, `putObject(BUCKET, key, JSON.stringify(projected), { contentType: "application/json", cacheControl: "public, max-age=60" })`, the same headers publish.ts uses, with `BUCKET` "sigmascout-artifacts". Only under `--execute`.
4. Only after EVERY list is processed, go through each dropped event key's artifact keys. Fetch each fresh:
   - 404 counts as absent.
   - For the event-kind key, `refusalReason` must be undefined, or the key is refused and counted.
   - Then `deleteObject(BUCKET, key)`, only under `--execute`.

   Lists go first so no rewritten list ever links to an object that is already gone.
5. Print a per-season, per-algorithm table: rows dropped, list rewritten (yes/no/skipped), deleted, absent, refused. Then a total line prefixed "DRY RUN, would" when not executing. Set `process.exitCode = 1` on any refusal.

The header comment states:
- Why this exists: a full publish:seasons is about 109,000 R2 writes, and this is at most 30 PUTs plus free DELETEs.
- The key facts: R2 keys are not generation-scoped, so `cleanup:r2-generations` can never remove these objects.
- The guards.
- The residual this script does not touch: team-season artifacts and Teams-list rows that still carry never-scored schedules, which clear at the next full rebaseline.

Add `"prune:cancelled-events": "tsx --env-file=.env scripts/pruneCancelledEvents.ts"` to root package.json scripts, next to `cleanup:r2-generations`.

Write scripts/pruneCancelledEvents.test.ts with the `<behavior>` cases. Stub `global.fetch` per URL and `vi.mock("../packages/harness/r2Client.js")`. No test may hit the network.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/lib/api/events.test.ts scripts/pruneCancelledEvents.test.ts scripts/publishLiveWindows.test.ts scripts/secrets-boundary.test.ts</automated>
  </verify>
  <done>The browser drops only rows cancelled at the artifact's computedAt, proven under a far-future system clock. The script's pure functions and its mocked main pass: dry run writes nothing, lists go before deletes, refusals block deletion and set exit code 1. `pnpm prune:cancelled-events` exists in package.json.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator script -> R2 bucket | the script PUTs events lists and DELETEs objects in the production bucket that serves the site |
| published artifact -> browser | the browser trusts the events list's computedAt and row counts to decide what to hide |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-mcf-01 | Tampering | scripts/pruneCancelledEvents.ts deletes | high | mitigate | Dry run by default. `--execute` required. `refusalReason` blocks deleting any event artifact with a played match (a Worker-folded event). Deletes are single-key, only for keys derived from rows the shared predicate dropped. Exit code 1 on any refusal |
| T-mcf-02 | Tampering | events-list rewrite during a concurrent publish | medium | mitigate | Skip any list whose generation differs from the live manifest's. Fresh cache-busted reads via `fetchArtifactFresh` |
| T-mcf-03 | Denial of service | hiding a live event | high | mitigate | The predicate needs start_date + 7 days AND zero played. The browser judges at the artifact's computedAt, never its own clock. The manifests invariant test proves no cancelled event can hold a probe window |
| T-mcf-04 | Information disclosure | .env credentials | medium | mitigate | The script never reads the environment. r2Client reads `.env` via `--env-file`. The executor never opens `.env` (CLAUDE.md secrets rule) |
</threat_model>

<verification>
From the repo root, after all three tasks:
- `npx vitest run` runs the full suite, about 167 files including apps/web. Read the printed totals. Every failure must be explained or fixed, not assumed pre-existing.
- `npx tsc --noEmit` for the root typecheck.
- `npx tsc --noEmit -p apps/web/tsconfig.json`. The root tsc misses apps/web. If routeTree.gen.ts is missing, around 45 unrelated route errors appear. Generate it with the web build first, or compare against a pre-change baseline.
- `git diff --stat` touches only the files in `files_modified`. Nothing under apps/worker/src, scripts/publishDistricts.ts, packages/core/districts, or filterModel.ts has changed.
</verification>

<success_criteria>
- One predicate (`isCancelledEvent`) is used by the publisher, the browser and the operator script, and is tested with a 2020 cancellation, an upcoming zero-match event, the 7-day boundary and a played event.
- A fresh publish writes no events-list row, event artifact, presim sidecar, upcoming pricing, team artifact or activeYears entry for a cancelled event. Upcoming and in-progress zero-match events and probe stubs are unchanged.
- Already-published cancelled rows disappear from the Events page, search and the year switch as soon as the web deploys, with zero R2 writes.
- `pnpm prune:cancelled-events` exists, is dry-run by default and is guarded. No Worker change is needed, and the manifests invariant proves it.
</success_criteria>

<output>
Create `.planning/quick/260929-mcf-hide-cancelled-events-and-skip-their-com/260929-mcf-SUMMARY.md` when done. If the Write tool is blocked for SUMMARY.md, return the SUMMARY text to the main context instead of routing around the block through Bash. Include:
- the list of pre-existing tests whose computedAt had to be pinned
- the full-suite totals
- the web tsc result
- the Operator follow-up below, copied verbatim
</output>

## Operator follow-up (main context only; executors have no network)

Cheapest path to live. No publish:seasons, no rebaseline, no Worker deploy.

1. **Push, then confirm CI and the Pages deploy.** Check `git log origin/main..main` first (other
   sessions' commits ride along), then `git push`, then `gh run list --limit 4` until Test and
   Deploy are green. The browser filter is now live. Every already-published cancelled row is gone
   from the Events page, search and the year switch, at zero R2 writes. Verify in a real browser or
   with an Origin header, not bare curl: open /events for 2020 and confirm no "0/0" official rows.
2. **Clean R2.** `pnpm prune:cancelled-events` (dry run). Expect about 430 dropped rows across the
   ten seasons and at most 30 lists to rewrite, about 440 event artifacts to delete (about 146
   events x opr/epa/spr), a few presim sidecars (2026isde3/4), and zero refusals. Then
   `pnpm prune:cancelled-events --execute`. Cost: at most 30 Class A PUTs plus about 3,000
   Class B GETs. R2 DELETEs are free. If a long run is killed silently, relaunch detached per
   the long-R2-runs memory. Verify with a GET carrying an Origin header, not HEAD: the 2020 spr
   events list has about 56 rows (196 minus 140), and a 2020 cancelled event key answers 404 for
   `event/{key}/spr@{live version}.json`.
3. **Nothing else is owed now.** The source filter takes effect at the next `pnpm rebaseline`,
   which is scheduled for other reasons, never for this. Residual until then: the 9 never-scored
   schedules still show as upcoming matches on about 238 team-season pages, and 19 teams (12 in
   2020, 7 in 2017) keep a team page and Teams-list row. The next full publish removes them. The
   only earlier fix is a full publish:seasons (about 109,000 R2 writes), which is not recommended.
4. **Ask Jacob:** should the District Locks / Champ Locks pages also hide 2020's cancelled district
   events? They carry real posted Chairman's awards that `reservedSlots.ts` counts, so changing
   them is a separate, verdict-moving task.
