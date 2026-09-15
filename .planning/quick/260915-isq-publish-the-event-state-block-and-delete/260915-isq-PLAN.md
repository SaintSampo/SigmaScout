---
phase: quick-260915-isq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/harness/pageArtifacts.ts
  - packages/harness/eventStatePricing.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/src/artifactWriter.ts
  - apps/worker/test/scheduled.rp.test.ts
  - apps/worker/test/scheduled.officialRecord.test.ts
  - packages/harness/eventStatePricing.splice.test.ts
  - packages/harness/pageArtifacts.test.ts
  - apps/worker/wrangler.toml
  - apps/worker/wrangler.probe.toml
  - apps/worker/migrations/0001_algorithm_state.sql
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - packages/harness/rpSeed.test.ts
  - packages/harness/sigmaSeed.test.ts
  - docs/worker-operations.md
  - apps/web/src/components/event/SimulationTab.tsx
autonomous: true
requirements: [DATA-04, DATA-05]

estimate:
  tokens: 170000
  raw_tokens: 340000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "A Worker tick folds newly played matches against an event artifact whose state block was built the way the publisher builds it. priceUpcomingFromState then runs on the block the Worker wrote and reproduces, with toEqual and no tolerance, the upcoming event rows the offline publisher produces for the same played set. This holds on a tick where touched and untouched teams share an upcoming match, and on a tick that folds two matches at once."
    - "The tick no longer predicts, bands or prices RP for still-upcoming matches. Every upcoming row the Worker writes carries only matchKey, compLevel, setNumber, matchNumber, sortTime (preserved from the existing row when it had one), redTeams and blueTeams."
    - "Predict-before-update, played-row band and RP, the fold, and the D1 write are unchanged. The played-row RP parity with the offline SigmaScoutLayer (mean shift included) still holds, and the pinned per-tick subrequest count (SUBREQUESTS_PER_LIVE_TICK = 64) and estimateEventSubrequestCost are unchanged."
    - "When a tick folds an event's last match, the written SPR event artifact has upcoming = [] and no state key."
    - "An SPR artifact written over an existing artifact that has no block, or has a block the splice rejects, is written without a block. Its upcoming rows are schedule-only, and the tick log carries one structured warn line naming the event. The Worker never reads D1 to bootstrap a block."
    - "Every SPR event artifact the publisher emits with a non-empty upcoming array carries a state block equal to buildEventStateBlock over exactly the rows handed to emitSeedSql (final season), built from one serialization per season and one passenger chain. An artifact with empty upcoming carries no block. Every event artifact, for every algorithm, carries eventType. Offline upcoming rows keep every priced field."
    - "No published number changes. Upcoming rows, played rows, team, teams, events and compare artifacts, presim sidecars and seed rows are identical to before. The only additions are the state and eventType keys, so no algorithm version bump is due."
    - "A newly played match replaces that match's unplayed row in the team-season artifact in place instead of appending a duplicate row."
    - "An artifact carrying state and eventType parses under a schema without those keys (the deployed web), with both keys stripped. The new EventArtifactSchema turns a malformed state into an absent one and does not fail the whole parse."
    - "stateProbe Group 7 (Phase A mirror guard) stays green with src/stateProbe.ts unmodified."
  artifacts:
    - path: packages/harness/pageArtifacts.ts
      provides: "EventArtifactSchema.eventType and EventArtifactSchema.state (optional, malformed-degrades-to-absent); EventScheduledMatchSchema; LiveEventArtifactSchema (upcoming rows fully priced OR schedule-only) and its type"
    - path: packages/harness/eventStatePricing.ts
      provides: "spliceEventStateBlock(block, writtenRows, touchedTeamKeys): replaces/inserts rows verbatim, league first, team rows by key, throws EventStateBlockError on algorithm/version/shape mismatch"
    - path: apps/worker/src/scheduled.ts
      provides: "tick without the upcoming pricing loop; schedule-only upcoming rows; block maintenance from Phase A's written rows; eventType preservation; in-place replacement of a team's unplayed row"
    - path: packages/harness/publish.ts
      provides: "one passenger-chain helper feeding both emitSeedSql and buildEventStateBlock; buildEventArtifact eventType + lazy stateRows params; per-season and summary state-block log lines"
    - path: apps/worker/test/scheduled.rp.test.ts
      provides: "the load-bearing end-to-end block parity test (three ticks) plus the no-block and invalid-block warning paths"
    - path: docs/worker-operations.md
      provides: "operational contract: publish with block-producing code (and seed from the same run) before a live window opens; tick-log warnings explained; probe upcoming arm caveat"
  key_links:
    - from: apps/worker/src/scheduled.ts
      to: packages/harness/eventStatePricing.ts
      via: "mergeEventArtifact calls spliceEventStateBlock with the changed rows writeScopedState just wrote (carried on the per-algorithm fold record), never a D1 read"
    - from: apps/worker/src/artifactWriter.ts
      to: packages/harness/pageArtifacts.ts
      via: "the event page validates with LiveEventArtifactSchema on write; readExistingEvent parses with the same schema so a Worker-written schedule-only artifact survives the next tick"
    - from: packages/harness/publish.ts
      to: packages/harness/eventStatePricing.ts
      via: "buildEventArtifact calls buildEventStateBlock(stateRows(), roster) only for spr with non-empty upcoming; the seed loop calls emitSeedSql on the same memoized rows array"
    - from: apps/worker/test/scheduled.rp.test.ts
      to: packages/harness/eventStatePricing.ts
      via: "priceUpcomingFromState on the JSON+zod round-tripped Worker block vs EventUpcomingMatchSchema.parse(eventUpcomingRow(layer.enrichUpcoming(...))) from an offline replay"
---

<objective>
Step 2 of 4 of the browser-pricing direction (`.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md`, section "DIRECTION CHOSEN — browser pricing of upcoming matches (Jacob, 2026-09-15)").

- The SPR event artifact now carries the SPR `state` block, and every event artifact carries `eventType`.
- The Worker keeps the block current from the D1 rows it just wrote.
- The Worker stops pricing still-upcoming matches.

Code, tests and docs only. No network, no deploys, no R2 or D1 writes by the executor. The orchestrator runs O1 and O2 afterwards (see the end of this plan).

Purpose:
- Removes the tick's dominant resolved CPU term (upcoming-loop RP).
- Deletes the partial-roster mispricing.
- Every upcoming row can be priced exactly in the browser (step 3) from the published block.

Output:
- The schema widening.
- `spliceEventStateBlock`.
- The Worker tick without the upcoming loop.
- The publisher writing blocks from the seed rows.
- The end-to-end parity test.
- Runbook updates.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/STATE.md
@.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md
@.planning/quick/260915-4p9-browser-pricer-for-upcoming-spr-matches-/260915-4p9-SUMMARY.md
@packages/harness/eventStatePricing.ts
@packages/harness/eventStatePricing.parity.test.ts
@packages/harness/publishedRows.ts
@packages/harness/pageArtifacts.ts
@packages/harness/publish.ts
@apps/worker/src/scheduled.ts
@apps/worker/src/stateStore.ts
@apps/worker/src/artifactWriter.ts
@apps/worker/test/scheduled.rp.test.ts
@apps/worker/test/stateProbe.test.ts
@docs/worker-operations.md

## Design decisions made at planning time (read before Task 1)

**DD-1: schedule-only rows need a Worker-side schema variant, and the web stays on the priced schema in this step.**

The conflict:
- `EventUpcomingMatchSchema` makes `predictedWinner`, `pRedWin`, `predictedRedScore` and `predictedBlueScore` REQUIRED.
- `writeArtifactObject` validates every event write against `EventArtifactSchema`, so schedule-only rows would throw in Phase B, and Phase B swallows the error.
- The web's `EventMatchRow` (`apps/web/src/components/event/eventMatchAxis.ts`) types those four fields as required numbers. `EventMatchTable.tsx` renders them.
- Making the four fields optional in the shared schema therefore forces web rendering changes, which are step 3.

The decision:
- Keep `EventUpcomingMatchSchema` and `EventArtifactSchema.upcoming` exactly as they are, for the web and the publisher.
- Add `EventScheduledMatchSchema` (schedule-only) and `LiveEventArtifactSchema`. The latter is `EventArtifactSchema` with `upcoming` rows that are either fully priced (`EventUpcomingMatchSchema`, unchanged) or schedule-only.
- The Worker reads and writes event artifacts with `LiveEventArtifactSchema`.

Consequences:
- A Worker-written artifact with upcoming rows does not parse on the web until step 3 switches the web to `LiveEventArtifactSchema`.
- That is invisible while the pre-season gate keeps `live-windows.json` empty. The direction note already accepts it: "Nothing is live behind the pre-season gate, so no visitor sees the Worker's unpriced rows."
- Step 3 MUST land before any live window opens. Record this in the runbook (Task 3).

Rating: reversible (code-only, no data written).

**DD-2: `eventType` goes on every event artifact (OPR, EPA, SPR).**
- It is a fact about the event, like `name`/`week`/`location`, which every algorithm's artifact already carries.
- `buildEventArtifact` and `mergeEventArtifact` are algorithm-agnostic, so a per-algorithm branch would be the only added complexity.
- The cost is about 15 bytes per artifact.
- Only the SPR artifact gets a `state` block.

**DD-3: team-artifact upcoming rows are left as they are, except the newly played match's own row.**
- A consistent strip would mean reading every roster team's artifact each tick: +2 subrequests per untouched team, which breaks "estimate must not increase". The Worker only reads touched teams' artifacts.
- Stripping only the touched teams would leave a site where some team pages show numbers and others do not.
- Step 3 makes team pages price upcoming matches from the event file, so these fields stop being read.
- While the gate is closed no tick runs, so no visitor sees a stale team row in between.
- The one row the Worker must fix is the duplicate: a newly played match REPLACES its unplayed row in place. That keeps the offline chronological position; appending would put a played row after later unplayed rows.

**DD-4: block roster = the event's full match-derived team set.**
- Offline, that is every team on the event's played and scheduled matches (`publish.ts` `matchDerivedTeamKeys`, which equals `eventTeamKeys` whenever upcoming is non-empty).
- In the Worker, a written team row is inserted or replaced when its key is already in the block or is in `stateBlockScopeKeys(touchedTeams)`. Touched teams are always event teams, so the two agree.
- Rows Phase A did not rewrite (untouched teams, byte-identical rows) keep the block's copy, which by contract is identical to D1's.

**DD-5: no algorithm version bump (the "version bump on output change" rule).**
- The rule is triggered by changed published numbers.
- This task adds two keys (`state`, `eventType`) and changes no number. Offline upcoming and played rows, team, teams, events, compare, presim and seed rows are all byte-identical.
- The Worker's live-row changes (schedule-only upcoming rows, duplicate removal) only take effect when a live window opens, which the gate forbids.
- If the executor finds any change that would alter a published number (for example, the passenger-chain refactor reordering a seed row), STOP and report it. Do not ship it under the same version.

**DD-6: `state` degrades instead of failing.** `EventArtifactSchema.state` is `EventStateBlockSchema.optional().catch(undefined)`. It was verified at planning time with zod 4.4.3 and `tsc --strict`: the key stays optional in the inferred type, a malformed block parses to `undefined`, and an absent key stays absent. This honors the block schema's own doc comment ("a malformed block must never fail the whole event-artifact parse"). It protects the new web bundle and keeps the Worker from discarding a whole artifact's history over a bad block.

**stateProbe (deliverable 5):** leave `apps/worker/src/stateProbe.ts` as-is.
- Group 7 checks that every call name in the tick's Phase A appears in the probe. Deleting tick code only removes names; the upcoming loop's calls are all also made by the played loop, so the name set is unchanged.
- No new call may be added between the Phase A markers (`for (const [algorithmId, algorithm] of algorithmModules) {` … `perAlgorithm.set(algorithmId`).
- No test forces a probe change. Re-mirroring and CPU re-measurement are step 4.

**Measured at planning time (corpus, read-only):**
- 146 events across 2016–2026 have at least one unplayed match, so about 146 SPR event artifacts gain a block. The largest roster is 51 teams (`2024cacc`).
- Most are historical or offseason leftovers that will never be played. They still meet the "non-empty upcoming" rule, and the block is faithful for them.
- 291 of those unplayed matches (about 57 events) involve demo teams. That is step 1's pinned KNOWN GAP: the pricer omits band/RP there while offline shows them. It does not affect step 2, which has no consumer, but step 3 must fall back for demo rosters.
- `data/corpus.sqlite` mtime is 2026-09-13 19:51, earlier than the live generation's 2026-09-14 publish, so a republish should reproduce live numbers exactly.
</context>

<source_audit>
| Source item | Covered by |
|---|---|
| 1. Schema: optional `state` (SPR only) + optional `eventType`, non-strict stripping confirmed | Task 1 (schema), Task 2 (tests), DD-2, DD-6 |
| 2. Publisher: block from exactly the seed rows, no block on empty upcoming, `eventType`, offline rows keep priced fields, version-bump reasoning | Task 3, DD-5 |
| 3a. Delete the upcoming loop and its plumbing | Task 1 |
| 3b. `mergeEventArtifact` schedule-only rows, `sortTime` preserved, `rpOutcomeRp` still derived | Task 1 |
| 3c. Block maintenance from written rows, league first + sorted, removal on empty, no-bootstrap warning, `eventType` preserved | Task 1 (logic), Task 2 (warning/invalid tests) |
| 3d. `mergeTeamSeasonArtifact` duplicate removal + team-row choice | Task 2, DD-3 |
| 3e. Subrequest estimate and D1 bound-param cap unaffected | Task 1 (pinned count stays 64), Task 2 (verification) |
| 3f. Stale comments in wrangler.toml, wrangler.probe.toml, migration; keep nodejs_compat | Task 2 |
| 4. End-to-end parity test (touched+untouched shared match, last-match removal), replaced tests listed, no-block warning test, team duplicate test, 2+ hand mutations | Task 1 (parity), Task 2 (warning, duplicate, mutations) |
| 5. stateProbe Group 7 green, probe left as-is | Task 1 verify, context note |
| 6. Docs: tick repricing text + operational contract | Task 3 |
| O1 dry run / O2 Worker deploy | ORCHESTRATOR-RUN section |
</source_audit>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1 (tracer): one live tick keeps a published state block exact, end to end</name>
  <files>packages/harness/pageArtifacts.ts, packages/harness/eventStatePricing.ts, apps/worker/src/scheduled.ts, apps/worker/src/artifactWriter.ts, apps/worker/test/scheduled.rp.test.ts</files>
  <behavior>
    - Tick 1 folds one live match (six touched teams). The pricer on the Worker's block reproduces the offline upcoming rows for the remaining schedule exactly. That schedule includes a match whose alliances mix touched and untouched teams.
    - Tick 2 folds two matches in one tick; parity still exact.
    - Tick 3 folds the last match: the artifact has upcoming = [] and no state key.
    - Pre-tick sanity: the pricer on the test's emulated published block already equals the offline rows.
    - After tick 1:
      - Untouched teams' block rows deep-equal the published block's rows, stamps included.
      - Touched teams' rows and the league row deep-equal the fake D1 rows the tick wrote.
      - Rows run league first, then team rows by ascending key.
    - Every Worker upcoming row's key set is a subset of {matchKey, compLevel, setNumber, matchNumber, sortTime, redTeams, blueTeams}, and sortTime equals the published row's.
  </behavior>
  <action>
**Record baselines first, before any edit:**
- From the repo root run `npx vitest run` and write the summary lines (test files, passed, failed, skipped, plus the names of any failures) to the scratchpad as the baseline.
- Run the three typechecks (`npx tsc --noEmit`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx tsc --noEmit -p apps/worker/tsconfig.json`) and record each error count. The web count can be non-zero if routeTree.gen.ts is stale; the baseline is what later runs are compared against.

**Schema (pageArtifacts.ts), per DD-1, DD-2, DD-6.**
- On EventArtifactSchema, add `eventType` (optional integer, placed beside the other event-identity fields) and `state` (EventStateBlockSchema, optional, with `.catch(undefined)`, placed LAST in the shape so the large block serializes at the end).
- EventStateBlockSchema is declared after EventArtifactSchema today. Move the two block schemas above EventArtifactSchema, or otherwise make them available, without changing their shape.
- Add EventScheduledMatchSchema with exactly matchKey, compLevel, setNumber, matchNumber, optional sortTime, redTeams and blueTeams, using the same field validators as EventUpcomingMatchSchema.
- Add LiveEventArtifactSchema: EventArtifactSchema with `upcoming` redefined as an array whose rows are either a fully priced row (EventUpcomingMatchSchema, unchanged, refines included) or a schedule-only row. Export its inferred type.
- The union must never silently reclassify:
  - A priced row keeps every field.
  - A schedule-only row keeps exactly its keys.
  - A row carrying priced keys that fails the priced schema (for example a pmf that does not sum to 1) must FAIL the parse, not be stripped to schedule-only.
  - The simplest way is to make the schedule-only variant reject unknown keys. If you do that, it is the one deliberate strict schema in the file: amend the header comment near PAGE_ARTIFACT_SCHEMA_VERSION so its "no schema here is strict" claim stays true for every schema a browser reads today, and state why this variant is strict.
- Do NOT change EventUpcomingMatchSchema, EventArtifactSchema.upcoming, or PAGE_ARTIFACT_SCHEMA_VERSION. Additive optional keys follow the file's existing no-bump precedent.

**Splice (eventStatePricing.ts).** Export `spliceEventStateBlock(block, writtenRows, touchedTeamKeys)`, returning a new EventStateBlock.
- It throws EventStateBlockError when:
  - the block's algorithmId is not the SPR module's id;
  - the block's snapshotShapeVersion is not STATE_SNAPSHOT_SHAPE_VERSION;
  - the block does not hold exactly one league row;
  - any written league or team row has a different algorithmId or algorithmVersion than the block.
- It ignores written rows of scopeKind event.
- A written league row replaces the league row.
- A written team row replaces the block's row with the same scopeKey, or is inserted when its key is in `stateBlockScopeKeys(touchedTeamKeys)` (DD-4). Every other written team row is ignored.
- The result is league first, then team rows sorted with the same comparator buildEventStateBlock uses.
- Rows are copied field for field through the existing copyRow helper. stateJson is never parsed or re-stringified; the shape check is a constant comparison on the block field, not a parse.
- Keep the module browser-safe: no new imports beyond what it already imports.

**Worker tick (scheduled.ts).**
- Delete the Phase A loop that predicts, bands and prices RP for still-upcoming matches.
- Delete everything only that loop feeds:
  - the two upcoming maps (predictions and bands) on the per-algorithm fold record and their parameters through runPhaseBAndReport and mergeEventArtifact;
  - the upcoming-row builder;
  - the CorpusMatch-to-UpcomingMatch view converter and the upcoming view array;
  - the upcoming half of findRpOutcomeRp, which now takes played predictions only, with the existing artifact's rpOutcomeRp as fallback.
- Keep predict-before-update, winOddsVarianceFor, displayBandFor, rpFieldsFor (partial-roster gate included, since it still guards played rows), foldObservedRp, the fold, serialization and writeScopedState exactly as they are. Only correct comments that describe "both loops" or upcoming pricing.
- Add the changed rows the tick passed to writeScopedState to the per-algorithm fold record, inside the existing `perAlgorithm.set(algorithmId, {...})` object literal.
- Add NO new function call between the Phase A start marker and that set call (stateProbe Group 7).
- Track the fetched event type separately from the -1 degrade sentinel: it is defined only when the event-detail fetch returned 200 and parsed. Pass it to Phase B.

**mergeEventArtifact:**
- Upcoming rows are built from the still-upcoming CorpusMatch list as schedule-only rows: matchKey, compLevel, setNumber, matchNumber, redTeams and blueTeams copies, plus sortTime taken from the existing artifact's upcoming row with the same matchKey when that row has one. The key is absent otherwise, and never the TBA-normalized approximation.
- Write eventType as the fetched value, else the existing artifact's eventType, else omit the key.
- Block rule, SPR only (use the spr module's id, never a bare string):
  - If upcoming is empty, omit state.
  - Else if the existing artifact has a state block, set state to spliceEventStateBlock(existing.state, the fold record's written rows, touchedTeams). If the splice throws EventStateBlockError, omit state and emit one `console.warn` JSON line `{msg:"event-state-block-invalid", eventKey, algorithmId, upcoming:<count>, error:<message>}`.
  - Else omit state and emit one `console.warn` JSON line `{msg:"event-state-block-missing", eventKey, algorithmId, upcoming:<count>}`.
  - Never read D1 to bootstrap a block.
  - Non-SPR artifacts never carry state and never warn.
- Log lines carry counts and keys only, never an artifact body or a TBA value.
- readExistingEvent parses with LiveEventArtifactSchema. In artifactWriter.ts the event page validates with LiveEventArtifactSchema; the file header's "same schema validation" sentence names the one deliberate difference and points at DD-1's reason.
- Update scheduled.ts's file header to describe the block and the absence of upcoming pricing.
- Do not touch estimateEventSubrequestCost or any D1 query.

**End-to-end parity test (scheduled.rp.test.ts, new describe "scheduled.rp — the state block survives the live Worker").** Reuse the file's fakes and helpers: toTbaMatch, toUpcomingTbaMatch, toMatchResult, breakdownOf, the fixture shape.

Fixture:
- Twelve teams, frc1 to frc12.
- A generated prior event of at least 120 matches rotating all twelve teams through varied alliances, with trending threshold inputs like msFixture, so every variable passes RP_MEAN_SHIFT_WARMUP_OBSERVATIONS and every team has RP and Sigma history.
- A live event of 8 qm matches with explicit rosters:
  - Match 5 is red frc1–frc3 vs blue frc4–frc6.
  - Match 6 pairs touched frc1 with untouched frc7–frc11.
  - Matches 6–8 together still mix touched and untouched teams.
- Only the live event is in the live-windows manifest. LIVE_ALGORITHM_IDS is "spr".

Offline arm `offlineAt(k)`:
- Run spr.initState over the twelve teams. For the prior event plus live matches 1..k: spr.predict on the leak-proof view, spr.update, talent from spr.teamMetrics, then SigmaScoutLayer.foldPlayed. This is the msOffline pattern.
- Build seed rows with publish.ts's passenger chain in its order: serializeState, withSigmaBeliefs, withRpBeliefs, withSigmaPopulation when defined, withRpMeanShift when defined.
- Build the expected upcoming rows for matches k+1..8 as EventUpcomingMatchSchema.parse(eventUpcomingRow(layer.enrichUpcoming(view, spr.predict(state, view)), sortTimeOf(match))). Give every upcoming match a sortTime.

Setup, emulating a publish at k = 4:
- Load every offlineAt(4) seed row into the fake D1 algorithmState map.
- Set the live event's cursor to match 4's key.
- Put a LiveEventArtifactSchema-valid spr artifact in fake R2 at the spr key. It carries eventType 0, the offline upcoming rows, empty matches and teams, and state = buildEventStateBlock(seed rows, every live-event team key).

Ticks and assertions:
- Reveal matches 1..5 played and 6..8 unplayed; tick. Then reveal 1..7; tick. Then reveal 1..8; tick.
- After each tick, read the artifact from fake R2, round-trip its state through JSON and EventStateBlockSchema, and call priceUpcomingFromState with season 2026, the artifact's eventType, RP_RULE_MODULES[2026], and the artifact's schedule-only upcoming rows. Assert `.event` toEqual offlineAt(k).upcoming rows, and their JSON forms toStrictEqual.
- Assert every behavior bullet above, including non-vacuity: offline rows carry band and RP pmfs, and the offline mean-shift state is past warmup.

Replace two existing tests, listing both in the SUMMARY with reasons:
- "an UPCOMING match naming a team this tick never touched emits NO pmf rather than one built from a partial roster". The behavior it pinned is deleted. Its TBA stub also never served an upcoming match, so it asserted nothing. Its replacement is the schedule-only key-set assertion in the new describe.
- "spr: live played AND upcoming RP rows EQUAL the offline SigmaScoutLayer's, which carry the mean shift". Narrow it to played rows: digest EQUAL offline shifted played rows and NOT equal unshifted. The Worker's upcoming rows now carry no pmf, so assert that, and point at the new describe for upcoming parity.

Keep the offline-only non-vacuity test and the SUBREQUESTS_PER_LIVE_TICK test unchanged. The count must still be 64; if it is not, stop and report.
  </action>
  <verify>
    <automated>npx vitest run apps/worker/test/scheduled.rp.test.ts apps/worker/test/stateProbe.test.ts apps/worker/test/artifactWriter.test.ts apps/worker/test/scheduled.test.ts apps/worker/test/scheduled.replay.test.ts apps/worker/test/liveAlgorithmTier.test.ts packages/harness/eventStatePricing.parity.test.ts packages/harness/pageArtifacts.test.ts  (read the output: 0 failed)</automated>
    <automated>grep -vE '^\s*(//|\*|/\*)' apps/worker/src/scheduled.ts | grep -cE 'upcomingPredictions|upcomingBands|buildEventUpcomingRow|toUpcomingMatch\('  (expect 0)</automated>
    <automated>npx tsc --noEmit -p apps/worker/tsconfig.json; npx tsc --noEmit; npx tsc --noEmit -p apps/web/tsconfig.json  (error counts no higher than baseline)</automated>
  </verify>
  <done>
- The three-tick parity describe passes with toEqual and toStrictEqual, and no tolerance.
- The two replaced tests are narrowed or replaced as described.
- stateProbe Group 7 is green with stateProbe.ts untouched.
- SUBREQUESTS_PER_LIVE_TICK is still 64.
- The typecheck counts do not rise.
- Committed as `feat(260915-isq): the Worker maintains the event state block and stops pricing upcoming matches (tracer)`, staging explicit paths only, then `git show --stat HEAD` confirms only this task's files.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: warning paths, schema guarantees, team duplicate removal, splice unit tests, stale comments, hand mutations</name>
  <files>apps/worker/src/scheduled.ts, apps/worker/test/scheduled.rp.test.ts, apps/worker/test/scheduled.officialRecord.test.ts, packages/harness/eventStatePricing.splice.test.ts, packages/harness/pageArtifacts.test.ts, apps/worker/wrangler.toml, apps/worker/wrangler.probe.toml, apps/worker/migrations/0001_algorithm_state.sql</files>
  <behavior>
    - No-block path: seeding the Task 1 fixture's artifact WITHOUT state produces:
      - a written artifact with no state and schedule-only upcoming rows;
      - exactly one `event-state-block-missing` warn line for the event, captured with a console.warn spy, whose JSON carries no artifact body;
      - fake D1 read calls unchanged from the with-block run (no bootstrap read).
    - Invalid-block path: a published block whose algorithmVersion is not spr.version produces a written artifact with no state plus exactly one `event-state-block-invalid` warn line.
    - Detail-fetch failure: when the TBA event-detail route returns 500, the written artifact keeps the existing artifact's eventType. With no existing eventType, the key is absent, never -1.
    - Team duplicate: when a team artifact already holds an unplayed row for match M at the event (no actualWinner), merging M played:
      - leaves exactly one row with M's matchKey, at the unplayed row's former index, carrying actualWinner;
      - leaves other unplayed rows byte-identical;
      - still appends a match with no prior row at the end.
    - Splice unit tests:
      - Oracle: splice(build(rowsA, roster), written, touched) equals build(rowsA overridden by written, roster) for touched ⊆ roster.
      - An untouched row object is carried field-for-field with an identical stateJson string.
      - A written team row outside the block and outside touched is ignored.
      - A demo touched key admits the pseudo-team row.
      - Written event rows are ignored.
      - The four throw conditions each throw EventStateBlockError.
    - Schema tests:
      - An artifact with state and eventType parses and keeps both.
      - The same artifact parsed by EventArtifactSchema.omit({state, eventType}) (modelling the deployed web) succeeds with both keys stripped.
      - A structurally malformed state parses to an absent state with the rest intact.
      - LiveEventArtifactSchema keeps a priced row whole, keeps a schedule-only row with exactly its keys, and rejects a priced row whose pmf does not sum to 1.
      - EventArtifactSchema still rejects a schedule-only upcoming row, pinning DD-1 until step 3.
  </behavior>
  <action>
**Team duplicate removal (scheduled.ts).** In mergeTeamSeasonArtifact, per DD-3: when the event's entry already holds a row whose matchKey equals a newly folded match's key, replace that row in place with the new played row. Otherwise append, as today. Leave every other row, including other unplayed rows and their priced fields, unchanged. Update the function's doc comment to say it replaces a match's unplayed row and why (offline chronological order is kept, and step 3 prices team pages from the event file). Add no subrequest.

**Tests:**
- Write the no-block, invalid-block and detail-failure cases in scheduled.rp.test.ts, reusing Task 1's fixture setup.
- Write the team duplicate case in scheduled.officialRecord.test.ts using its existing mergeTeamSeasonArtifact call helper.
- Write the splice unit tests in the new packages/harness/eventStatePricing.splice.test.ts. Build rows with serializeState plus the passengers on a small spr state, or with synthetic StateRow literals that have a valid league row. The oracle needs a league row buildEventStateBlock accepts.
- Add the schema tests to pageArtifacts.test.ts.

**Stale comments (deliverable 3):**
- apps/worker/wrangler.toml lines 14–24: say that compatibility_flags nodejs_compat was added when stateSnapshot.ts carried the Node-only seed emitter. Quick task 260915-4p9 moved that emitter to packages/harness/seedSql.ts, so that reason no longer applies. The flag stays because removing it has not been verified with a real bundle and tick.
- apps/worker/wrangler.probe.toml lines 29–33: the same correction, pointing at wrangler.toml's comment.
- apps/worker/migrations/0001_algorithm_state.sql lines 8–9: the seed emitter is packages/harness/seedSql.ts's emitSeedSql.
- Change comment lines only. Do not remove or move nodejs_compat. stateProbe.test.ts's "declares nodejs_compat" reads non-comment lines. Editing an already-applied migration's comment does not re-run it (wrangler tracks applied migrations by filename).

**Hand mutation checks (deliverable 4, at least two, all restored):**
- M1: spliceEventStateBlock files a written team row under a different team's scopeKey (for example the next key in order).
- M2: the splice skips the league row.
- M3 (optional): mergeEventArtifact drops the preserved sortTime.
- For each: run `npx vitest run apps/worker/test/scheduled.rp.test.ts packages/harness/eventStatePricing.splice.test.ts`, record which tests fail and how many, restore the code, re-run to green, and confirm with `git diff` that no mutation remains.
- The parity describe must fail under both M1 and M2. If either leaves the parity test green, the test is vacuous: strengthen the fixture (for example, make the mixed match's untouched teams' stateJson differ from the touched rows'), then re-mutate.
- Record the mutation table for the SUMMARY.
  </action>
  <verify>
    <automated>npx vitest run apps/worker/test packages/harness/eventStatePricing.splice.test.ts packages/harness/pageArtifacts.test.ts packages/harness/eventStatePricing.parity.test.ts  (read the output: 0 failed)</automated>
    <automated>grep -c "seedSql.ts" apps/worker/wrangler.toml apps/worker/wrangler.probe.toml apps/worker/migrations/0001_algorithm_state.sql  (each at least 1)</automated>
    <automated>grep -vE '^\s*#' apps/worker/wrangler.toml | grep -c nodejs_compat; grep -vE '^\s*#' apps/worker/wrangler.probe.toml | grep -c nodejs_compat  (each exactly 1)</automated>
    <automated>git diff --stat  (after restoring mutations: only intended files, no mutation residue)</automated>
  </verify>
  <done>
- Every behavior bullet has a passing test.
- At least two hand mutations were recorded failing the parity describe and were restored.
- The stale comments now name seedSql.ts, and nodejs_compat is still declared in both configs.
- Committed as `test(260915-isq): state block warning paths, team duplicate removal, splice and schema guarantees` with explicit paths, then `git show --stat HEAD` checked.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: the publisher writes the block from the seed rows, plus runbook and comment updates</name>
  <files>packages/harness/publish.ts, packages/harness/publish.test.ts, packages/harness/rpSeed.test.ts, packages/harness/sigmaSeed.test.ts, docs/worker-operations.md, apps/web/src/components/event/SimulationTab.tsx</files>
  <behavior>
    - A publishSeasons run with spr over a one-season test corpus, where one event has played and unplayed matches, uses skipState false. emitSeedSql is replaced by a vi.mock capture, and putObject is already mocked.
      - The event artifact's state deep-equals buildEventStateBlock(capturedSeedRows, every team key on that event's matches).
      - Every block row's stateJson string equals the captured seed row's.
    - The same event under opr has eventType and no state.
    - An spr event with no unplayed match has eventType and no state key.
    - Offline upcoming rows still carry pRedWin and predicted scores.
    - End to end through the real publisher: priceUpcomingFromState on the JSON-round-tripped published state, with the artifact's eventType and the season's rule module, toEqual the artifact's own upcoming rows. There must be at least one band on those rows (non-vacuity).
    - The captured seed rows deep-equal an independently built chain (serializeState on the replayed final state, then the four passengers in the pinned order), proving the refactor left seed output unchanged.
  </behavior>
  <action>
**One passenger chain (publish.ts), per DD-4 and DD-5.**
- Extract the seed loop's chain into one helper: serializeState, then withSigmaBeliefs, withRpBeliefs, withSigmaPopulation when defined, withRpMeanShift when defined, in exactly today's order and with today's fallbacks for a non-Sigma or non-RP algorithm.
- In the season loop, per algorithm, build a memoized getter over that helper from the season's final state and the layer's passengers, so a season serializes at most once no matter how many events need a block.
- Keep the final season's getter. The D1 seed loop must call emitSeedSql on the SAME memoized rows array when a block already forced it, and otherwise compute it once through the same getter.
- Maps that only fed the old chain may be removed. Keep the source literal `layers.get(algorithm.id)!.rpMeanShiftState()` or update rpSeed.test.ts's check to the new form.
- emitSeedSql's call-site arguments are unchanged.

**buildEventArtifact:**
- Add optional params `eventType` (number) and `stateRows` (a function returning readonly StateRow[]).
- Emit `eventType` when provided.
- Emit `state = buildEventStateBlock(stateRows(), roster)` only when algorithmId is the spr module's id, the built upcoming array is non-empty, and stateRows is provided. roster is every team key on params.predictions and params.upcoming match rosters.
- Never call stateRows otherwise.

In the publishSeasons event loop:
- Pass `eventType: e.event_type` for every algorithm, and the memoized getter as stateRows.
- For each emitted artifact with a state, add its UTF-8 JSON byte length to per-season counters.
- Print `publish: season <S> <algorithmId>: <n> event artifacts carry a state block (<bytes> B, max <m> B <key>)` once per season and algorithm with n > 0.
- Print a `  state blocks: count=<N> totalBytes=<B> maxBytes=<M> key=<K>` line in the final summary when N > 0.
- Do not change any other published field, the upcoming rows, the presim path, or PAGE_BUDGET_MAX_BYTES. The ceiling check keeps running on the larger bodies.

**Structural tests (rpSeed.test.ts, sigmaSeed.test.ts).**
- Retarget both "(structural)" regexes from the old seed-loop span to the new helper. Assert:
  - the helper body contains all four passengers and the literal `withRpMeanShift(rows, rpMeanShift)` (rename the helper's local variables to keep that literal, or update the literal and say why in the test);
  - the emitSeedSql call site is fed the helper's rows;
  - the helper, or its memoized getter, is what buildEventArtifact receives as stateRows.
- Keep each test's stated intent and comments about league-row passengers being easy to forget.
- List both in the SUMMARY as changed tests, with this reason.

**Publisher tests (publish.test.ts).** Add a describe using the file's existing corpus fixture helpers (seasonEvent, seasonMatch, and rawBreakdown2024 if RP pmfs are wanted). Add a hoisted vi.mock of ./seedSql.js whose emitSeedSql records its rows argument and writes nothing. Every other test in the file uses skipState true and never reaches it. Unplayed matches are corpus rows with a null winner that selectScheduledMatches returns.

**Runbook (docs/worker-operations.md):**
- New subsection under "Before an event: ingest it, or it will not live-fold", titled "Publish with state blocks before the window opens (260915-isq)". It states that:
  - an event must be published by code that writes the SPR `state` block (this commit or later), and D1 must be seeded from the SAME publish run, before its live window opens;
  - the Worker splices the rows it writes into the published block, so untouched teams' rows come from the publish and touched teams' rows from D1;
  - the Worker never bootstraps a block;
  - how to read `event-state-block-missing` (the artifact was published before this change or had no upcoming matches at publish time; republish and re-seed before the next tick) and `event-state-block-invalid` (block version or shape does not match the deployed Worker; republish and re-seed as a matched pair);
  - until step 3 switches the web to LiveEventArtifactSchema, a Worker-written artifact with upcoming matches will not render on the event page, so step 3 must ship before any window opens (DD-1).
- Add both warnings as rows in "When something is wrong".
- Rewrite the PRE-SEASON GATE paragraph that says "The expensive upcoming-repricing loop predates Phase 9" to say that the loop was deleted in 260915-isq, and that the gate stays in force until step 4 re-measures the tick and the remaining DATA-04 row-parity items land.
- In "Pre-event probe", keep the parameter table but amend the `upcoming` row and the "upcoming defaults to 60 … the upcoming loop is where the CPU goes" paragraph. The deployed probe still mirrors the tick as it was before 260915-isq and prices synthetic upcoming matches. The live tick no longer does, so `upcoming=0` is the arm closest to the current tick until step 4 re-mirrors the probe.
- Do not edit historical measurement records, which are dated evidence.

**Web comment (SimulationTab.tsx):** the doc comment above SIMULATION_UNAVAILABLE_HEADING says EventArtifactSchema carries no eventType field. Reword it to say this component does not read eventType, and artifacts published before 260915-isq do not carry it. Comment only; no rendered string changes. First grep SimulationTab.test.tsx for any readFileSync of the component source. If a test pins that comment text, leave the comment and note it in the SUMMARY instead.

**Final gate:**
- Run `npx vitest run` from the repo root and compare against the Task 1 baseline. Every new failure must be explained and fixed; a pre-existing flaky failure is named explicitly, with the baseline evidence.
- Run the three typechecks and compare against the baseline.
- Compose the SUMMARY with:
  - the full list of changed pre-existing tests and why;
  - the mutation table;
  - the DD-1..DD-6 decisions;
  - the version-bump reasoning, explicitly stating that no published number changed.
- If the Write tool is blocked for SUMMARY.md, return the SUMMARY text to the orchestrator instead. Never fall back to a Bash heredoc.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/publish.test.ts packages/harness/rpSeed.test.ts packages/harness/sigmaSeed.test.ts packages/harness/eventStatePricing.parity.test.ts packages/harness/eventStatePricing.browserSafe.test.ts  (read the output: 0 failed)</automated>
    <automated>npx vitest run  (full suite from repo root; compare file/pass/fail counts with the recorded baseline)</automated>
    <automated>npx tsc --noEmit; npx tsc --noEmit -p apps/web/tsconfig.json; npx tsc --noEmit -p apps/worker/tsconfig.json  (no count above baseline)</automated>
  </verify>
  <done>
- The publisher writes blocks equal to buildEventStateBlock over the exact seed rows, and eventType on every event artifact.
- Offline upcoming rows and seed rows are unchanged.
- The structural tests are retargeted with their intent kept.
- The runbook carries the operational contract and the probe caveat.
- The full suite and typechecks match the baseline.
- Committed as `feat(260915-isq): publish the SPR state block and eventType from the seed rows; runbook contract` with explicit paths, then `git show --stat HEAD` checked.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TBA → Worker | Untrusted match and event JSON, schema-parsed at the fetch boundary (unchanged) |
| R2 artifact → Worker | The Worker reads a published artifact whose `state` block it splices and republishes |
| Worker/publisher → public R2 | Everything written is world-readable, including the new block |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-isq-01 | Tampering | mergeEventArtifact block splice | medium | mitigate | spliceEventStateBlock throws on algorithm, version or shape mismatch. The Worker then drops the block and warns instead of republishing mixed-version state, and `.catch(undefined)` keeps a malformed block from erasing an artifact's history |
| T-isq-02 | Information disclosure | state block in public artifacts | low | accept | The rows are rating state derived from public TBA results, the same inputs every page already publishes. writeArtifactObject's existing secret-scan refusal still runs on every body |
| T-isq-03 | Information disclosure | new tick warn lines | low | mitigate | The lines carry event key, algorithm id, counts and an EventStateBlockError message (ids and versions only), never a body, header or TBA value |
| T-isq-04 | Denial of service | larger event artifacts | low | mitigate | PAGE_BUDGET_MAX_BYTES still asserts every body. O1's dry run proves the ceilings pass before any upload. No new subrequest (the pinned count stays 64) |
</threat_model>

<verification>
- The end-to-end parity describe passes exactly, and hand mutations M1 and M2 each turn it red.
- Every Worker-written upcoming row is schedule-only. The block is removed on the last match. Both warning paths are tested.
- Publisher blocks equal buildEventStateBlock over the captured seed rows. Seed rows equal the independent chain.
- The deployed-web model (EventArtifactSchema without the new keys) strips `state`/`eventType`; the new schema degrades a malformed block.
- stateProbe Group 7 is green with stateProbe.ts unmodified. SUBREQUESTS_PER_LIVE_TICK is 64. estimateEventSubrequestCost is untouched.
- The full `npx vitest run` from the repo root matches the baseline. Root, web and worker `tsc --noEmit` do not rise.
</verification>

<success_criteria>
- The Worker tick contains no still-upcoming predict, band or RP code.
- The SPR event artifact carries a state block exactly when upcoming is non-empty, and the Worker keeps it exact across ticks.
- No published number changes and no version bump is due. The executor's SUMMARY states this, with the evidence.
- Three commits, each staged by explicit path and checked with `git show --stat HEAD`.
</success_criteria>

<output>
Create `.planning/quick/260915-isq-publish-the-event-state-block-and-delete/260915-isq-SUMMARY.md` when done, or return its text if Write is blocked.
</output>

## ORCHESTRATOR-RUN (main context, network). Not executor tasks.

### O1: publisher dry run, before any upload

**Preconditions:**
- All three task commits are on local `main`.
- `git status --porcelain -- packages apps docs` is empty.
- `data/corpus.sqlite` mtime is still earlier than the live generation's publish time (2026-09-13 19:51 vs 2026-09-14). If an ingest has happened since, a republish would ship changed numbers under the same versions. Stop and ask Jacob first.

**Command** (repo root; the tool reads `.env` itself, never render it):

    npx tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2026 --include-offseason --presim-from-season 2026 --dry-run

These are the `publish:seasons` flags plus `--dry-run`, deliberately WITHOUT `--write-budget`:
- `--write-budget` rewrites `docs/publish-budget.md` even on a dry run.
- That would dirty a tracked doc that a concurrent session could absorb into its commit.
- The budget doc should record the real upload run.

Ceilings are still enforced on a dry run, because `assertWithinPageBudget` runs before the dry-run short-circuit. The run takes about 20–30 minutes. Launch it detached (PowerShell `Start-Process` redirecting to a log, then a PID-and-log Monitor), not Bash `run_in_background`. The dry run still rewrites the local, gitignored `reports/publish/seed-*.sql`. Do NOT apply those to D1.

**Read from the output:**
1. It exits cleanly, with no `publish:artifacts failed:` and no `PublishBudgetExceededError`.
2. `objects=` equals the last full real run's object count. Adding keys creates no objects, so any difference means something else changed. Stop.
3. The `event:` line's `max=` stays at or below 350000 B.
4. The per-season `event artifacts carry a state block` lines and the summary `state blocks: count=… totalBytes=… maxBytes=…` line. Expect about 146 spr blocks (planning census) spread over 2016–2026, most on historical or offseason events. A count far above that means the rule leaked to opr/epa or to empty-upcoming events.
5. The byte delta: `totalBytes` minus the last full real run's total. For a baseline, use the most recent full-run `run` string in `git log -p docs/publish-budget.md`: 3,908,787,937 B at generation 3ba2b580, measured 2026-09-14. Check whether 2dcc057f was a later full run before using it. The delta should be about the `state blocks totalBytes` plus roughly 15 B times the event-artifact count (~7,509). A materially larger delta means a published number or row changed. Stop.
6. `presim: count=` is unchanged (214–216).

**Then ask Jacob:** republish now, or wait for the next pre-event republish? Nothing is live, so waiting costs nothing. If he picks now, run `pnpm publish:seasons` detached, commit the rewritten `docs/publish-budget.md`, and re-seed D1 only if the corpus changed (see the precondition above). The block and D1 must come from the same state.

### O2: Worker deploy from a clean tree

**Preconditions:**
- `git status --porcelain -- apps/worker packages` is empty. Otherwise deploy from a clean detached worktree at the verified SHA.
- The full suite and worker typecheck are green at that SHA.
- Check `git log origin/main..main`. The Worker deploy does not need a push, but any push deploys the web, including other sessions' commits. For this change the web gains only optional schema keys and no rendering change.

**Command:** `cd apps/worker && npx wrangler deploy`. Never use `pnpm --filter worker deploy`, which hits pnpm's built-in `deploy` and deploys nothing. Record the Version ID from the output.

**Post-deploy checks:**
- Confirm `live-windows.json` has `live now: 0` with the runbook's curl one-liner.
- Start `npx wrangler tail sigmascout-worker --format json`, wait for the next cron minute, then stop tail by PID. If auto-mode denies tail, hand it to Jacob.
- Expect one `tick` line with `ok: true`, `eventsConsidered: 0`, `eventsAdvanced: 0`, `tbaRequests: 0`, and an `ok` outcome (no `exceededCpu`).
- Do NOT redeploy the state probe: it stays at `28051f5c`, mirroring the pre-isq tick, and step 4 re-mirrors it.

**Ordering is safe either way while windows are empty.**
- With no live window, `runTick` returns right after the live-windows read. That is before the algorithms manifest, D1, TBA, or any artifact read, so neither a block-less nor a block-carrying artifact is ever touched.
- An old Worker reading a republished artifact would strip the block. A new Worker reading an old artifact would warn `event-state-block-missing`. Both only happen once a window opens, which the pre-season gate forbids.
- Opening a window already requires ingest, republish and seed from the same run, then step 3, per the updated runbook.

**Rollback:** `npx wrangler rollback` to the previous Version ID (runbook "Rolling back").
