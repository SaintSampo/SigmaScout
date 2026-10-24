---
phase: quick-261024-lfa
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  # Task 1 (tracer): the roster-only season path, end to end in the publisher
  - packages/harness/rosterOnlySeason.ts
  - packages/harness/publish.ts
  - packages/harness/manifests.ts
  - packages/harness/publish.rosterOnly.test.ts
  # Task 2: the publish season list carries 2027; the live-windows default follows it
  - package.json
  - scripts/publishLiveWindows.ts
  - scripts/publishLiveWindows.test.ts
  - packages/harness/publish.test.ts
  # Task 3: local corpus only (gitignored data/corpus.sqlite); no tracked file changes
autonomous: true
requirements: [QUICK-261024-lfa]

estimate:
  tokens: 80000
  raw_tokens: 160000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "A publish run that includes 2027 writes, for each of opr, epa and spr, one 2027 events list, one empty 2027 teams list, and one event artifact for every 2027 event, with name, dates, week, district and the registered roster (team count from the roster, demo keys dropped)"
    - "A 2027 season gets no season carry, no replay, no layer, no presim sidecar, no as-of object, no compare file and no team page"
    - "A run whose last season is 2027 still seeds D1 from 2026: the seed rows and the cursor file come from 2026, exactly as a run ending at 2026"
    - "A run made only of roster-only seasons never writes the live-windows manifest, the algorithms manifest or any seed file, even without --skip-state"
    - "The live-windows manifest never carries a window for a roster-only season, whichever caller builds it (full publish or publishLiveWindows)"
    - "A roster-only season that has any played match makes the publish refuse before anything uploads"
    - "componentMapForSeason and the RP rule registry still throw for 2027; no 2027 entry exists in either"
  artifacts:
    - path: "packages/harness/rosterOnlySeason.ts"
      provides: "NEWEST_GAME_SEASON, isRosterOnlySeason(season), selectRosterOnlySeasons(seasons)"
    - path: "packages/harness/publish.ts"
      provides: "publishRosterOnlySeason branch at the top of the season loop, played-match preflight, forced skip-state, --roster-seasons-only CLI flag"
    - path: "packages/harness/manifests.ts"
      provides: "buildLiveWindowsManifest drops roster-only seasons before its query"
    - path: "packages/harness/publish.rosterOnly.test.ts"
      provides: "the roster-only behaviour tests (no EPA carry, 2026 seed, no 2027 windows, refusal on played matches, all-roster-only run writes no manifest or seed)"
    - path: "package.json"
      provides: "publish:seasons --seasons 2016-2020,2022-2027"
  key_links:
    - from: "publishSeasonsWith season loop"
      to: "isRosterOnlySeason(season) -> publishRosterOnlySeason(...) -> continue"
      via: "branch placed before buildSeasonStream, so the carry block and every cross-season variable are never reached for 2027"
    - from: "buildLiveWindowsManifest"
      to: "isRosterOnlySeason"
      via: "seasons filtered before the SQL IN list; publish.ts and scripts/publishLiveWindows.ts both call this one builder"
    - from: "scripts/publishLiveWindows.ts DEFAULT_LIVE_WINDOWS_SEASONS"
      to: "package.json publish:seasons"
      via: "publishLiveWindows.test.ts equality pin, now 2016-2020,2022-2027"
---

<objective>
Make the offline publisher treat 2027 as a ROSTER-ONLY SEASON: a season the site lists for its events and rosters before its game rules exist. Jacob decided (CONTEXT.md, 2026-10-24) that 2027 ships as events, rosters and the year dropdown only; no provisional copy of 2026's rules; the D1 seed stays the 2026 state; the throw-by-design registries stay strict. This plan is the server half; plans 02 and 03 are the web and the release command.

Purpose: today `publish.ts:2132-2136` carries EPA into 2027 and throws at `componentMapForSeason(2027)`, and the final season of a run seeds D1 (`publish.ts:2850-2869`, used at `:2895-2938`). Both must be impossible for a season with no registered rules and no matches.

Live windows, chosen approach: KEEP 2027 OUT of the live-windows manifest, enforced inside `buildLiveWindowsManifest` by dropping roster-only seasons. No Worker guard is added. Why: (1) the Worker only ever folds events that have a manifest window (`scheduled.ts:2628-2640`: even a TBA webhook tick filters to manifest windows), so no window means the Worker never touches 2027; (2) a Worker guard would need a Worker deploy, which this task does not do, and a guard that is committed but undeployed protects nothing; (3) 2027 events start 2027-02-28, after the January rules work, so no window is lost. The filter lifts itself the day 2027's component map is registered; the January follow-up (plan 03 todo) records that a rebaseline must seed 2027 before any manifest lists 2027 windows.

Output: `packages/harness/rosterOnlySeason.ts`, the roster-only branch and guards in `publish.ts`, the manifest filter, a new test file, 2027 in `publish:seasons`, and a dry run of the 2027 publish against the real corpus.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.planning/quick/261024-lfa-add-2027-season/261024-lfa-CONTEXT.md
@.planning/quick/261024-lfa-add-2027-season/261024-lfa-RESEARCH.md

Line numbers below were verified on commit 6f8bcf61 while planning.

`packages/harness/publish.ts` (3154 lines; read only these ranges):
- `:1664-1709` `PublishSeasonsOptions` (`skipState`, `artifactSink`, `preScheduleFromSeason`, `generation`, `computedAt`).
- `:1798-1845` `EventMetaRow` and `buildProbeStubArtifact`: the model for an identity-only event artifact.
- `:1846-1871` `selectEventMeta`, `selectPlayedMatchCountsByEvent`; `:1878` `cancelledEventKeysForSeason`.
- `:1984-2030` run setup: `seasonsSorted`, `teamInfo`, `cancelledBySeason` loop (`:2002-2014`), activeYears pre-pass.
- `:2071-2140` the season loop head: stream, `teamsThisSeason` (demo filter at `:2085`), `eventMeta`, `registeredTeamsByEvent` (`:2096`), carry block (`:2126-2138`).
- `:2393-2416` the events-list row shape (`EventsArtifactEventInput`), `:2556-2584` teams and events writers, `:2588-2610` event loop head incl. the registered-roster fallback.
- `:2645-2667` `buildEventArtifact` call and `artifactKey` for an event.
- `:2842-2870` compare write and the cross-season variables (`liveStatesAcrossSeasons`, `sigmaCarryAcrossSeasons`, `finalSeasonStateRows`, `finalSeasonLastFoldedByEvent`, `finalSeasonNumber`).
- `:2872-2939` drain, `if (!options.skipState)` (`:2877`), live-windows and algorithms manifests, seed and cursor files.
- `:3016-3141` `parseSeasonsRange`, `runSeasonsCliMode`, `main()` parseArgs.

`packages/harness/manifests.ts:192-202` `buildLiveWindowsManifest` head (`const { seasons, ... } = options` at `:193`, `if (seasons.length > 0)` at `:202`).
`packages/core/algorithms/breakdown/index.ts:70` `BREAKDOWN_REGISTERED_SEASONS` (sorted, readonly).
`packages/corpus/db.ts:1394` `upsertEventTeam`, `:1414` `selectEventTeamsForEvents` (absent key = roster unknown).
Fixture analogs: `packages/harness/sigmaCarry.publish.test.ts:1-90` (temp corpus, `upsertEvent`/`upsertMatch`, dry run with `artifactSink`); `packages/harness/publish.test.ts:89-117` (the `./r2Client.js` and `./seedSql.js` mocks that capture seed rows and cursor calls).
</context>

<source_audit>
Every source item for quick task 261024-lfa, and the plan that covers it.

| Source | Item | Covered by |
|--------|------|------------|
| CONTEXT | Year dropdown lists 2027 above 2026, 2026 default and URL fallback | 02 T1, T2 (reveal is one line, named in 03 T3) |
| CONTEXT | Events page for 2027: every event, name, dates, week, district, team count from roster | 01 T1 (data), 03 T2 Test 4 (render under the revealed state) |
| CONTEXT | 2027 event page: name, dates, roster; plain empty states for Simulation, Locks, standings and predictions | 02 T3 (event page), 03 T2 (Locks on the Districts page, Teams page) |
| CONTEXT | Teams and Compare for 2027 honest; Compare never requests a 2027 file | 02 T2 (Compare), 03 T2 (Teams) |
| CONTEXT | Publish-then-reveal; committed default renders as today | 02 T1 (CURRENT_SEASON stays 2026), 03 T3 handoff |
| CONTEXT | Throw-by-design registries stay strict | 01 T1 (predicate, no registry entry), 02 T1 (metricKeys call site) |
| CONTEXT | D1 seed stays the 2026 state; no carry, replay, sidecars, seed for 2027 | 01 T1 |
| CONTEXT | Worker never promotes a 2027 event without rules | 01 T1 (manifest exclusion; see objective) |
| CONTEXT | No full rebaseline; 2027-only write | 01 T1 (forced skip-state, --roster-seasons-only), 03 T1 (publish:roster-seasons) |
| CONTEXT | Equality pins edited deliberately; site season lists not silently skipping 2027 | 01 T2, 02 T2, 03 T1 |
| CONTEXT | No version bump | all plans: no algorithm module version is touched |
| CONTEXT | Secrets rule | every command uses tsx --env-file=.env |
| Discretion | Roster reconciliation now or todo | 03 T3 (todo; reason recorded there) |
| Orchestrator | Ingest 2027 events, teams, rosters | 01 T3 (local), 03 T1 (inside the one command) |
| Orchestrator | Docs: PROJECT.md, seasons.ts header, season-list doc lines | 02 T1 (seasons.ts), 02 T2 (compare.ts), 03 T3 (rest) |
| Excluded | 2027 RP rules, component map, district model, bracket, pay rule, award list, sidecars, Locks | deferred to January by CONTEXT; recorded in 03 T3 todo |
| Excluded | publish:districts for 2027 | the district point model throws for 2027 (`publishDistricts.ts:436-437`); stays 2016-2020,2022-2026 |
</source_audit>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1 (tracer): roster-only season, corpus rosters to 2027 events list and event pages, with the 2026 seed untouched</name>
  <files>packages/harness/rosterOnlySeason.ts, packages/harness/publish.ts, packages/harness/manifests.ts, packages/harness/publish.rosterOnly.test.ts</files>
  <read_first>packages/harness/publish.ts ranges listed in context; packages/harness/manifests.ts:180-215; packages/harness/sigmaCarry.publish.test.ts:1-90; packages/harness/publish.test.ts:89-117</read_first>
  <behavior>
    New file packages/harness/publish.rosterOnly.test.ts. Temp corpus per test (mkdtempSync + openCorpus, closed and removed in afterEach). Mock "./r2Client.js" (putObject spy) and "./seedSql.js" (capture emitSeedSql rows by algorithm id, capture emitCursorSeedSql options, stub writeSeedCommandsFile) exactly as publish.test.ts:89-117 does.
    Fixture: one 2026 regional (start 2026-03-01) with about 12 played qualification matches over nine teams (copy the seedSeason helper shape from sigmaCarry.publish.test.ts); two 2027 events: 2027abca (eventType 0, week 0, start 2027-03-05, districtKey null) with upsertEventTeam rows for four real teams plus frc9999 (a demo key), and 2027micmp (eventType 2, districtKey "fim", start 2027-04-01) with no event_teams rows at all. computedAt "2026-10-24T00:00:00.000Z". preScheduleFromSeason 2027 (keeps 2026 fast and makes 2027 presim-eligible, so "no 2027 sidecar" is a real assertion).
    - Test 1 (no EPA carry): algorithms [opr, epaSpy, spr] where epaSpy is epa spread with carrySeason wrapped in vi.fn; seasons [2026, 2027]; the spy is never called (before the fix this run throws at componentMapForSeason(2027)).
    - Test 2 (2027 objects): with artifactSink, for each algorithm id there is v1/events/2027/{id}@{version}.json whose rows are exactly 2027abca and 2027micmp; 2027abca teamCount 4 (frc9999 dropped), 2027micmp teamCount 0; matchCount and playedMatchCount 0; name, week, startDate, districtKey copied from the corpus row. v1/event/2027abca/{id}@{version}.json has teams equal to the four teams in ascending team NUMBER order, each with an empty metrics record, and empty matches and upcoming; v1/event/2027micmp/... exists with teams []. v1/teams/2027/{id}@{version}.json has teams [].
    - Test 3 (nothing else for 2027): run with dryRun false and collect every key passed to the mocked putObject (it sees page artifacts, presim sidecars and as-of objects alike; as-of bodies never reach artifactSink, they go to asOfSink). No key matches /\/team\/[^/]+\/2027\//, v1/compare/2027.json, /^v1\/presim\/2027/, /^v1\/asof-(season|start)\/2027\// (pageArtifacts.ts:2540-2549) or /^v1\/asof(-log)?\/2027/.
    - Test 4 (seed stays 2026): seasons [2026, 2027], skipState false, dryRun false: capturedSeedRows for spr has team scope keys equal to the nine 2026 teams; emitCursorSeedSql was called exactly once; summary.seedFiles is non-empty.
    - Test 5 (no 2027 window): in the same run, the putObject call for v1/manifest/live-windows.json carries no window whose season is 2027 (without the filter both 2027 events get future probe windows at this computedAt). Also call buildLiveWindowsManifest(db, { seasons: [2026, 2027], generation: "g", computedAt }) directly and assert zero 2027 windows.
    - Test 6 (all roster-only run): seasons [2027], skipState left undefined, dryRun false: putObject is never called with a key under v1/manifest/, emitSeedSql and emitCursorSeedSql are never called, summary.manifestKeys and summary.seedFiles are both [].
    - Test 7 (refusal): add one played 2027abca match (winner set); publishSeasons with seasons [2026, 2027] rejects with a message naming 2027 and "played"; putObject and artifactSink were never called.
    - Test 8 (predicate): isRosterOnlySeason is false for every BREAKDOWN_REGISTERED_SEASONS member and for 2021, true for NEWEST_GAME_SEASON + 1; selectRosterOnlySeasons(parseSeasonsRange("2016-2020,2022-2027")) equals [2027]; componentMapForSeason(2027) still throws.
  </behavior>
  <action>
    1. Create packages/harness/rosterOnlySeason.ts. Import only BREAKDOWN_REGISTERED_SEASONS from "../core/algorithms/breakdown/index.js" (keep it Node-free; plan 02 imports it into the browser bundle, where that breakdown module is already bundled). Export NEWEST_GAME_SEASON (the greatest registered season), isRosterOnlySeason(season) (an integer greater than NEWEST_GAME_SEASON; this keeps 2021 out, so its permanent exclusion still throws where it always did), and selectRosterOnlySeasons(seasons) (order-preserving filter). Header comment, plain words: a roster-only season is listed for its events and rosters before its game rules exist; the registries are not loosened, this predicate is how call sites avoid reaching them; it lifts itself the day the season's component map is registered (January 2027 for 2027), and from that day a rebaseline must seed the season before any live-windows manifest lists its windows.
    2. publish.ts preflight, placed right after the cancelledBySeason loop (ends at :2014) and before any upload: for each roster-only season in seasonsSorted, sum selectPlayedMatchCountsByEvent(db, season); if above zero, throw an Error naming the season, the count, and that the season's component map and RP rules must be registered before it can be published with matches. This makes a silent skip of real matches impossible.
    3. publish.ts forced skip-state: near the top of publishSeasonsWith, derive a local skipState that is true when options.skipState is true OR every season in seasonsSorted is roster-only (and seasonsSorted is non-empty); log one line when it is forced. Use it in place of options.skipState at :2877. Reason (put it in the comment): a manifest built from roster-only seasons alone lists no live window and would switch off live folding for every 2026 event, and there is no state to seed.
    4. publish.ts branch: as the first statement inside the season loop (:2071, before buildSeasonStream), when isRosterOnlySeason(season), await a new module-level function publishRosterOnlySeason (timed under a label like `season ${season} roster`) and continue. Place the function next to buildProbeStubArtifact (:1818). It receives db, season, algorithms, uploader, generation, computedAt, teamInfo and the season's cancelled set. It: reads selectEventMeta minus cancelled; reads selectEventTeamsForEvents for those keys; builds each event's roster as registered keys minus isDemoTeamKey, sorted by team number ascending (numeric, via teamInfoOrFallback); builds the events-list rows in the same field shape as :2400-2416 with teamCount = roster length (0 when the roster is unknown), matchCount 0 and playedMatchCount 0; then per algorithm publishes a teams artifact with teams [] (buildTeamsArtifact), the events artifact (buildEventsArtifact), and for EVERY event (roster known or not) an event artifact from buildEventArtifact with predictions [], upcoming [], teams = roster rows { teamKey, teamNumber, nickname, metrics: {} }, allianceTeams [], alliances [], eventMeta identity, eventType, and no tierCuts (the field is optional and there is no pool to cut). Use uploader.publish with the same page kinds and artifactKey shapes as the general path. Log one summary line per roster-only season (events, rostered events, algorithms). It must not touch liveStatesAcrossSeasons, sigmaCarryAcrossSeasons, finalSeasonStateRows, finalSeasonLastFoldedByEvent or finalSeasonNumber; that is what keeps the D1 seed on the last game season. Roster-only seasons are always the newest seasons of a run (the predicate is "newer than every registered season"), so no game season ever follows one and seasonBoundaryFor is unaffected; say so in a comment.
    5. manifests.ts: in buildLiveWindowsManifest, filter the destructured seasons through isRosterOnlySeason before the length check and the IN list (:193-202), with a short doc paragraph: the Worker resumes the D1 state seeded from the last game season and has no RP rules or component map for a roster-only season, and a probe window is exactly what lets the Worker promote an event to folding; the filter lifts with the predicate, so the January rules work must rebaseline (seeding the new season) before a manifest lists its windows.
    6. publish.ts CLI: add a boolean "roster-seasons-only" to main()'s parseArgs (:3100-3112) and thread it into runSeasonsCliMode. When set: seasons = selectRosterOnlySeasons(parseSeasonsRange(spec)); throw when that is empty (message: no roster-only season in the spec, publish game seasons with publish:seasons); throw when combined with --write-budget (a roster-only run's sizes would overwrite the budget block in docs/publish-budget.md); pass skipState true. Export nothing else new from publish.ts.
    7. Write the tests in behavior first (red), then implement (green). Do not add any 2027 entry to SEASON_COMPONENT_MAPS, RP_RULE_MODULES or any other registry, and do not change any algorithm version.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/publish.rosterOnly.test.ts packages/harness/manifests.test.ts packages/harness/sigmaCarry.publish.test.ts packages/harness/publish.tracer.test.ts packages/harness/browserSafeSchemas.test.ts</automated>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>All eight behaviours pass; the existing manifest, sigma-carry and tracer publish tests still pass; root typecheck is clean; no registry gained a 2027 entry (git diff shows no change under packages/core/).</done>
</task>

<task type="auto">
  <name>Task 2: publish:seasons carries 2027 and the live-windows default follows it, with both pins edited deliberately</name>
  <files>package.json, scripts/publishLiveWindows.ts, scripts/publishLiveWindows.test.ts, packages/harness/publish.test.ts</files>
  <read_first>package.json:29-30; scripts/publishLiveWindows.ts:50-58; scripts/publishLiveWindows.test.ts:250-256; packages/harness/publish.test.ts:4878-4930</read_first>
  <action>
    1. package.json:29 publish:seasons: change the --seasons value to 2016-2020,2022-2027 and keep every other flag. Leave publish:districts (:30) at 2016-2020,2022-2026: the district point model throws for 2027 by design (CONTEXT hard rule), and that script has no pin to publish:seasons. Why 2027 belongs in publish:seasons: R2 keys are id@version, so the next rebaseline that bumps a version and prunes the old prefix would delete 2027 objects that no rebaseline republishes; listing 2027 keeps them current at the cost of a few hundred small writes.
    2. scripts/publishLiveWindows.ts:58: same literal change, and extend the doc comment above it: a roster-only season in this list gets no window, because buildLiveWindowsManifest drops it (Task 1). scripts/pruneCancelledEvents.ts reuses this array unchanged; a 2027 events list is skipped by its generation check or has nothing cancelled, so no edit there.
    3. scripts/publishLiveWindows.test.ts:252: change the expected literal to 2016-2020,2022-2027; keep the second equality against package.json.
    4. packages/harness/publish.test.ts:4881-4893: keep exact equality. New expected list [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026, 2027]; retitle the test to say the ten game seasons plus the roster-only 2027; keep the 2021 assertion; add two assertions with messages: every parsed season is either in BREAKDOWN_REGISTERED_SEASONS or isRosterOnlySeason, and selectRosterOnlySeasons(parsed) equals [2027]. Leave the presim tripwire test (:4900) as is; it still holds (2016 is not later than 2027).
  </action>
  <verify>
    <automated>npx vitest run packages/harness/publish.test.ts scripts/publishLiveWindows.test.ts scripts/pruneCancelledEvents.test.ts packages/harness/publish.rosterOnly.test.ts</automated>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>publish:seasons and DEFAULT_LIVE_WINDOWS_SEASONS both parse to the eleven seasons ending at 2027; both pins assert that by exact equality; publish:districts is unchanged; the four test files pass.</done>
</task>

<task type="auto">
  <name>Task 3: ingest 2027 into the local corpus and dry-run the roster-only publish on real data</name>
  <files>data/corpus.sqlite (gitignored, local only; no tracked file changes)</files>
  <read_first>packages/ingest/cli.ts:1-60 (modes) and :181-191 (--year / --years parsing)</read_first>
  <action>
    The ingest is read-only against TBA and writes only the gitignored corpus. Follow the CLAUDE.md secrets rule: let tsx read .env through --env-file; never Read, cat or echo .env. Run from the repo root:
    1. npx tsx --env-file=.env packages/ingest/cli.ts --year 2027   (teams, events, and each event's empty match list)
    2. npx tsx --env-file=.env packages/ingest/cli.ts --event-teams-only --years 2027-2027   (registered rosters for every official 2027 event)
    No --districts-only pass: the Events page reads the district from each event's own row, the 2027 district point data is January work, and both 2027fit and 2027tx already map to "FIRST TX" in apps/web/src/lib/districtNames.ts:37-38. No parser change is needed: --year 2027 and --years 2027-2027 already parse (cli.ts:181-191).
    3. Dry run (uploads nothing, writes no manifest and no seed): npx tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2027 --roster-seasons-only --include-offseason --dry-run
    Record in the SUMMARY: the 2027 event count, how many events have a roster, and the summary lines the dry run printed.
    If the network is refused (executor subagents have been blocked from network Bash before), do not retry in a loop: write "INGEST NOT RUN: network blocked" in the SUMMARY and continue. Plan 03's one command ingests 2027 itself, so nothing is lost. If the dry run refuses because 2027 already has played matches, stop and report it; do not work around the preflight.
  </action>
  <verify>
    <automated>npx tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2027 --roster-seasons-only --include-offseason --dry-run</automated>
  </verify>
  <done>Either the dry run exits 0 and its summary shows events count=3, teams count=3, an event count equal to 3 times the number of 2027 events (TBA listed 218 on 2026-10-24: 216 official plus one offseason and one preseason), and no presim, team, manifests or seed-files line; or the SUMMARY records that the network was blocked.</done>
</task>

</tasks>

<verification>
- npx vitest run packages/harness/publish.rosterOnly.test.ts packages/harness/publish.test.ts packages/harness/manifests.test.ts scripts/publishLiveWindows.test.ts scripts/pruneCancelledEvents.test.ts
- npx tsc --noEmit
- git diff --stat shows nothing under packages/core/ and no algorithm version change.
</verification>

<success_criteria>
A full publish that lists 2027 replays and seeds exactly as before through 2026, then writes only 2027 events lists, empty teams lists and roster event pages; a 2027-only run writes those objects and nothing else; no manifest ever carries a 2027 window.
</success_criteria>

<output>
Create `.planning/quick/261024-lfa-add-2027-season/261024-lfa-SUMMARY.md` when done.
</output>
