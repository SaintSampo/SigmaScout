---
phase: quick-261007-mxf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/components/districts/asOfRewind.ts
  - apps/web/src/components/districts/asOfRewind.test.ts
  - apps/web/src/components/districts/useAsOfRewind.ts
  - apps/web/src/components/districts/districtRunAssembly.ts
  - apps/web/src/components/districts/useDistrictLedgerData.asOf.test.ts
  - apps/web/src/components/districts/useSimulatedDcmpBake.ts
  - apps/web/src/components/districts/champLedgerChances.ts
  - apps/web/src/components/districts/champLedgerChances.test.ts
  - apps/web/src/components/districts/champLedgerRows.ts
  - apps/web/src/components/districts/champLedgerRows.test.ts
  - apps/web/src/components/districts/districtLedgerCopy.ts
  - apps/web/src/components/districts/districtLedgerCopy.test.ts
  - apps/web/src/components/districts/ChampLocksLedger.tsx
  - apps/web/src/components/districts/ChampLocksLedger.test.tsx
  - apps/web/src/components/districts/useDistrictLedgerData.ts
  - apps/web/src/components/methodology/districtLedgerContent.ts
  - .planning/todos/pending/champ-locks-now-dcmp-bake.md
autonomous: true
requirements: [261007-mxf]

estimate:
  tokens: 100000
  raw_tokens: 200000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "At a rewound stop before any District Championship has started, every team the district tier SHOWS as Locked, Prequalified or In range (the District Locks tab's own chip, after its simulated line settles) has four open DCMP category cells and an open DCMP Subtotal, priced by ONE Web Worker bake of one generated championship whose roster is exactly that set, at the as-of state of the stop. No DCMP cell reads not yet priced there once the bake lands."
    - "At that stop a district Out of range team reads out of range in all four DCMP cells and the DCMP Subtotal, its DCMP Source line says outside the simulated field, and its grand total is the district total labelled district only. A district Locked out team reads the em dash with not in the field and the same labelled district only grand total. Neither team joins gaps.teamsWithDistrictOnlyGrandTotal, so the champ run still runs and the stat line prints the simulated line."
    - "While the district run, the district chance run or the DCMP bake is in flight, the affected DCMP cells and grand totals read pending (a Locked out em dash renders at once). A district range call of No call, an unpublished capacity, or a refused or failed bake reads not available, and the champ range state reads No call with reason unpricedDcmp. Never a silent zero."
    - "The bake is a SECOND Worker request, posted only once the verdict roster is known. The main per event run keeps skipping the unstarted championship, so its requests and signature are unchanged and a roster change re-runs one generated event, never every district event."
    - "At the Now position change 2 changes nothing: the field rank estimate and not yet priced stand, hypotheticalDcmp.ts and scripts/measureChampCutoff.ts are untouched, and every Now test passes unedited except the two finished-district tests change 1 supersedes."
    - "Whenever the District Championship is the selected event (a championship has started at the position, the reader is at a DCMP's own Schedule stop, or Now after a championship started), a team with no dcmp-tier row is absent from the table and still counted in the status chips, the champ run, the predicted cutoff and the disclosed gaps. At a district event position nobody is hidden."
    - "The Methodology page describes the rewound Locked plus In range simulation in the site voice, and a pending todo records the Now position DCMP bake follow-up."
  artifacts:
    - path: "apps/web/src/components/districts/useSimulatedDcmpBake.ts"
      provides: "The second Worker request: one generated DCMP over the verdict roster, with its pending, unavailable and ready view"
      contains: "export function useSimulatedDcmpBake"
    - path: "apps/web/src/components/districts/districtRunAssembly.ts"
      provides: "assembleSimulatedDcmpBake and simulatedDcmpBakeView, sharing the GENERATED request helper with assembleAsOfDistrictEvents"
      contains: "export function assembleSimulatedDcmpBake"
    - path: "apps/web/src/components/districts/champLedgerRows.ts"
      provides: "The outOfRange cell kind, the simulatedDcmp option, buildDcmpRow's simulated case and the outside field district only grand total, plus champTeamHiddenAtDcmp"
      contains: "outOfRange"
    - path: "apps/web/src/components/districts/champLedgerChances.ts"
      provides: "dcmpSimulatedField, simulatedDcmpState and champRangeState's simulatedDcmp arm"
      contains: "export function dcmpSimulatedField"
    - path: "apps/web/src/components/districts/districtLedgerCopy.ts"
      provides: "CHAMP_LEDGER_OUT_OF_RANGE_CELL and CHAMP_LEDGER_OUT_OF_RANGE_LINE"
      contains: "CHAMP_LEDGER_OUT_OF_RANGE_CELL"
    - path: ".planning/todos/pending/champ-locks-now-dcmp-bake.md"
      provides: "The Now position follow-up, with the two known limits of this task"
  key_links:
    - from: "ChampLocksLedger.tsx candidates memo (roster override on dcmpEventKeys[0])"
      to: "asOfRewind.ts planAsOfEvent GENERATED branch"
      via: "loadAsOfRewind passes candidate.roster as rosterOverride, so the one as-of load resolves every district team at the cut"
      pattern: "rosterOverride"
    - from: "ChampLocksLedger.tsx districtShown (predictedCutoff kind, districtRangeState, applyLedgerRangeState over districtStatuses)"
      to: "champLedgerChances.ts dcmpSimulatedField"
      via: "the District Locks tab's own recipe, so In range is the chip that tab shows"
      pattern: "dcmpSimulatedField"
    - from: "useSimulatedDcmpBake.ts"
      to: "useDistrictSimulationRun (as-of Worker, runAsOfEvent GENERATED branch)"
      via: "one DistrictSimulationEventRequest from assembleSimulatedDcmpBake, signature districtRunSignature([request])"
      pattern: "assembleSimulatedDcmpBake"
    - from: "ChampLocksLedger.tsx rows memo simulatedDcmp"
      to: "champLedgerRows.ts buildDcmpRow simulated case"
      via: "BuildChampLedgerRowsOptions.simulatedDcmp; the baked record is read by team key from distributionsFromPreSim(entry)"
      pattern: "simulatedDcmp"
    - from: "ChampLocksLedger.tsx champChanceRun and rangeState"
      to: "champLedgerChances.ts buildChampAdvancementChanceRun and champRangeState"
      via: "the champ run's runSignature carries the bake signature and is null until the bake is ready; champRangeState reads simulatedDcmp in place of the estimate"
      pattern: "simulatedDcmpState"
---

<objective>
Two changes to the Champ Locks tab, Jacob 2026-10-07 (every decision in 261007-mxf-CONTEXT.md is locked):

1. When the District Championship is the selected event, the table omits a team that is not at the DCMP and not eligible for an award there (a team with no dcmp-tier row).
2. At every rewound district event position before the DCMP starts, the DCMP is simulated as if its field were the Locked plus In range teams at that position, baked in the Web Worker over generated schedules at the as-of state of the stop. Teams outside that field read "out of range" where the DCMP row used to read "not yet priced".

Purpose: a rewound Champ Locks view prices the championship from a field that was knowable at the stop, with its four categories visible, instead of a field rank estimate.
Output: the bake pipeline and its readings (Task 1, the tracer), the hide rule (Task 2), and the methodology copy, module headers and a follow-up todo (Task 3).

BROWSER ONLY. No artifact shape, publisher, Cloudflare Worker, D1, R2 or algorithm version changes, and nothing to publish, deploy or fetch from a live origin. Every test runs against fixtures and mocked fetch, so the executor sandbox's missing network is no obstacle.

RUNS IN THE MAIN CHECKOUT (workflow.use_worktrees is false). apps/web/src/routeTree.gen.ts already exists, so the web typecheck is meaningful as is.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/quick/261007-mxf-champ-locks-hide-non-field-teams-at-the-/261007-mxf-CONTEXT.md
@.planning/quick/261005-5g0-make-every-rewound-locks-view-a-true-for/261005-5g0-SUMMARY.md

Source map. Read each section ONCE with offset and limit; these files are long.
- apps/web/src/components/districts/ChampLocksLedger.tsx (880 lines). ChampCell ~175, SourceCell ~195, candidates ~409, useAsOfRewind call ~410, startedDcmpEventKeys ~429, skipEventKeys ~457, data ~463, runProgress ~476, distributionsPending ~483, passOptions ~485, districtRows/districtStatuses ~502-511, runSignature ~516, districtChanceRun/State ~519-523, districtRunCurrent and fieldChanceByTeam ~531-541, estimates ~548, rows ~569, champChanceRun ~600, rangeState ~622, visibleTeams ~724.
- apps/web/src/components/districts/champLedgerRows.ts (909 lines). ChampLedgerCell ~95-110, ChampLedgerRow.estimated ~126, ChampLedgerTeam.grandTotalIsDistrictOnly ~198, ChampLedgerGaps ~245, BuildChampLedgerRowsOptions ~369 (dcmpEstimateByTeam ~405), buildChampLedgerRows ~431 (fieldIsFact ~488, buildDcmpRow call ~490, districtOnly and the grand total ~499-579), buildDcmpRow ~764-855 (its four documented cases), reId ~858.
- apps/web/src/components/districts/champLedgerChances.ts. Header 1-24, champFieldChances ~290, HypotheticalDcmpEstimates ~338, ChampRangeStateInputs ~489, champRangeState ~505.
- apps/web/src/components/districts/asOfRewind.ts. AsOfBakeParams ~132, asOfDefaultMatchesPerTeam ~172, fallbackEventType ~177 (module private), districtRegistrations ~182, PlanAsOfEventParams ~327, planAsOfEvent ~350 (GENERATED branch ~383-407), AsOfRewindInput ~506 (candidates ~515), asOfCandidateEvents ~555, loadAsOfRewind planning loop ~605-622.
- apps/web/src/components/districts/useAsOfRewind.ts (145 lines). UseAsOfRewindOptions ~38, FINGERPRINT_KEY_INDEX ~85, queryKey ~106.
- apps/web/src/components/districts/districtRunAssembly.ts (339 lines). districtRunSignature ~100, foldAsOf ~129, AS_OF_BAKE_ALLIANCE_COUNT ~219, assembleAsOfDistrictEvents ~239 (GENERATED branch ~304-325).
- apps/web/src/components/districts/useDistrictSimulationRun.ts (reference only): one Worker per hook instance, effect keyed on the signature, an empty request posts nothing.
- apps/web/src/components/districts/ledgerRangeState.ts (reference only): districtRangeState ~134, applyLedgerRangeState ~246. apps/web/src/components/districts/DistrictLedger.tsx ~380-520 (reference only): the recipe the District Locks tab cuts its shown In range with (predictedCutoff over rows.teams and dcmpSlots, districtRangeState, applyLedgerRangeState).
- apps/web/src/components/districts/districtLedgerRows.ts (reference only): openDistrictLedgerCell ~1055, distributionsFromPreSim ~1008, DistrictEventDistributions ~941.
- apps/web/src/workers/districtSimulationProtocol.ts (reference only): MAX_DISTRICT_SIMULATION_ROSTER = 256 (~75), DistrictAsOfBlock ~122, DistrictSimulationEventBaked ~228. apps/web/src/workers/districtAsOfJob.ts runAsOfEvent (GENERATED: roster = input.baselines keys).
- apps/web/src/components/districts/districtLedgerCopy.ts ~680-730 (NOT_IN_FIELD_LINE, NOT_IN_FIELD_CELL, NOT_YET_PRICED_CELL, DISTRICT_ONLY_LINE), ~807 (no call reasons), ~830 (ESTIMATED_DCMP_LINE).
- Tests: ChampLocksLedger.test.tsx (helpers installFetch ~324, realRunScript ~346, renderLedger ~350, rowsFor ~359, waitForSimulatedLine ~368; finished describe ~377 with the tests at ~422 and ~465; rewound drawer tests ~858 and ~905), champLedgerRows.test.ts (rewound with estimates ~615), champLedgerChances.test.ts (champRangeState ~531), asOfRewind.test.ts (planAsOfEvent modes ~211, loadAsOfRewind ~328), useDistrictLedgerData.asOf.test.ts (rewoundAt ~189, rewound requests ~197; fixtures from asOfTestFixtures.ts: EVENTS, CANDIDATES, ARTIFACTS, districtArtifact), districtLedgerCopy.test.ts ~544.
- apps/web/src/components/methodology/districtLedgerContent.ts ~163-164 (the two Champ Locks paragraphs) and its test's voice rules (no hyphen, en dash or em dash, no singular first person, at most three sentences a paragraph).
- Sketch rules: .claude/skills/sketch-findings-sigmascout/SKILL.md. Words carry the meaning, never colour alone. Class strings that mix a text-role class with a colour custom property stay plain strings, never cn().
</context>

## The DCMP bake threading (decided by the planner)

**Where the roster is built.** In the tab, from the district tier's SHOWN statuses: the tab computes them exactly as the District Locks tab does (the kind of `predictedCutoff` over `districtRows.teams` with `artifact.dcmpSlots` and `districtStatuses`' qualifier sets and reservation, then `districtRangeState` from the district chance run the tab already runs, then `applyLedgerRangeState(districtStatuses, districtRows.teams, state)`). The pure `dcmpSimulatedField` (champLedgerChances.ts) turns that into `pending` (the district line is pending), `refused` (No call, or any team still capacityUnknown), or `ready` with the sorted roster (prequalified, locked, inRange), the outOfRange set and the lockedOut set. The lockedOut set rides every arm, so Locked out renders at once.

**Where the as-of state comes from.** The SAME as-of load. The tab's candidates memo attaches `roster: every district team key, sorted` to the candidate `dcmpEventKeys[0]`. `planAsOfEvent` uses that override in its GENERATED branch only, so `loadAsOfRewind` resolves every district team at the cut under that plan. The main run never posts that plan: at every stop where the bake applies, `skipEventKeys` holds every unstarted championship. Resolving the extra teams needs no new object (a team whose last segment ends before the cut answers from an INDEX already in hand, an unseen team from the start object).

**How it reaches the Worker: a SECOND request, not a widened signature.** The roster is a function of the first run's output (per event run, then district chance run, then the district line). Folding the DCMP into the main request would change that request's signature the moment the roster lands, and `useDistrictSimulationRun` keys its effect on the whole signature, so it would terminate and re-run every district event (the prohibited second full rerun). It would also make the district run's own pending state wait on its downstream. So `useSimulatedDcmpBake` posts ONE generated event through its own `useDistrictSimulationRun` instance, built by `assembleSimulatedDcmpBake` from the DCMP outcome's tuples filtered to the roster and the plan's own bake parameters (eventType from the DCMP's artifact or `fallbackEventType("dcmp")`, `asOfDefaultMatchesPerTeam(eventType)`). Its signature is `districtRunSignature([request])`, which folds the roster and the cut, so only a roster or stop change re-bakes.

**How the DCMP row reads it.** `buildChampLedgerRows` takes `simulatedDcmp: { field, bake }`. For a team whose field is not a fact, `buildDcmpRow`'s new case reads the team's reading: em dash, out of range, pending, not available, or the baked record looked up by TEAM KEY in `distributionsFromPreSim(entry)` and built into four open cells and an open Subtotal (the same cells a baked sidecar event gives, so the drawer, outcome lists and win chance work unchanged). The win chance is the Playoffs cell's mass at the winner value, the formula case 2 already uses.

**Order.** per event run, district chance run, district line, DCMP bake, champ run. The champ run's `runSignature` is `null` until `simulatedDcmpState` is `ready`, then carries the bake signature, so a re-bake re-runs the champ run even when every array length is unchanged.

**Bounds.** One event, roster at most 256 (`MAX_DISTRICT_SIMULATION_ROSTER`); a longer or empty roster reads not available up front rather than letting the Worker refuse the request. The generator's 6..1024 range and the eight alliance bracket's own refusals become a per event unavailable entry, as for any generated event.

## Readings at a rewound stop before any championship has started

| District tier, as shown | Four DCMP cells and the Subtotal | DCMP Source line | Grand total |
|---|---|---|---|
| Locked, Prequalified or In range, bake landed | open, from the bake | the shipped "to be there" line | district part plus the bake, weighted once by the "to be there" chance (unchanged) |
| same, bake in flight | pending | unchanged | pending |
| same, bake refused or failed, or no row for the team | not available | unchanged | not available |
| Out of range | out of range (new kind) | outside the simulated field (new) | district only, labelled |
| Locked out | em dash (notInField) | not in the field | district only, labelled |
| any team while the district line is Pending | pending (Locked out: em dash) | unchanged | pending |
| any team while the district line is No call, or capacity unknown | not available (Locked out: em dash) | unchanged | not available |

The bake applies when the tab is rewound (`asOf` supplied), not at Now, the district publishes at least one dcmp-tier key, and no championship has started at the position. Everywhere else the shipped rule stands: Now keeps the field rank estimate and "not yet priced"; a championship that has started (or, after Task 2, the reader at its own Schedule stop) is a fact; a district whose championship is not on the artifact yet keeps the estimate at rewound stops (no event key to plan under, recorded in the todo). The pending window shows the pending word, the 261007-4qr convention: "not yet priced" can still flash only in the instant before the stop's position resolves, which is the "stop whose as-of state has not loaded yet" case the CONTEXT names.

## Untouched on purpose

`packages/core/districts/hypotheticalDcmp.ts` and its generated tables, `scripts/measureChampCutoff.ts`, `scripts/measureChampTenets.ts` (they call `buildChampLedgerRows` without the new option and keep their output), `DistrictLedger.tsx`, the Now position's pricing of live district events, and the "to be there" weighting.

## Concurrent-session rules (every commit)

- Stage by EXPLICIT PATH only. Never `git add -A`, `git add .`, `git commit -a` or `git stash`.
- Run `git status --short` before each commit and `git diff --cached --stat` after staging; only this task's files may be staged.
- Do not push, publish or deploy.
- Never read, cat or echo `.env`; nothing here needs it.
- Run vitest from the REPO ROOT as `npx vitest run <paths>` and read the pass and fail counts in the output, never the exit code (`timeout <n> pnpm <cmd>` swallows output and exits 0).

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Tracer, the Locked plus In range DCMP bake end to end at a rewound stop (as-of roster, second request, row readings, render)</name>
  <files>apps/web/src/components/districts/asOfRewind.ts, apps/web/src/components/districts/asOfRewind.test.ts, apps/web/src/components/districts/useAsOfRewind.ts, apps/web/src/components/districts/districtRunAssembly.ts, apps/web/src/components/districts/useDistrictLedgerData.asOf.test.ts, apps/web/src/components/districts/useSimulatedDcmpBake.ts, apps/web/src/components/districts/champLedgerChances.ts, apps/web/src/components/districts/champLedgerChances.test.ts, apps/web/src/components/districts/champLedgerRows.ts, apps/web/src/components/districts/champLedgerRows.test.ts, apps/web/src/components/districts/districtLedgerCopy.ts, apps/web/src/components/districts/districtLedgerCopy.test.ts, apps/web/src/components/districts/ChampLocksLedger.tsx, apps/web/src/components/districts/ChampLocksLedger.test.tsx</files>
  <precondition>The working directory is the main checkout C:/Users/Jacob/Documents/GitHub/SigmaScout and apps/web/src/routeTree.gen.ts exists.</precondition>
  <reversibility rating="reversible">Browser only; no published artifact, publisher or version changes, so a revert is one commit.</reversibility>
  <behavior>
    - asOfRewind.test.ts: planAsOfEvent with rosterOverride is GENERATED on exactly the sorted, de-duplicated override, ahead of both the event artifact's roster and districtRegistrations; a REAL plan (folded by the cut, or its own Schedule stop) ignores the override. loadAsOfRewind with CANDIDATES where 2026wazzz carries roster = every fixture district team returns a ready outcome for 2026wazzz whose plan.roster and state.teams cover every one of those teams.
    - useDistrictLedgerData.asOf.test.ts (fixtures from asOfTestFixtures.ts, via rewoundAt with the override candidates): assembleSimulatedDcmpBake for 2026wazzz over a roster subset returns one GENERATED request whose input.baselines keys are the roster (zero RP), fieldSize is the roster length, allianceCount 8, tier the plan's, asOf.bake the plan's bake plus algorithmId spr and the version, and asOf.teams exactly the roster's tuples in key order. Its signature differs for a different roster and is stable for the same one. It is unavailable for: an unavailable result, a missing or unavailable outcome, a roster team with no tuple, an empty roster, and a roster longer than MAX_DISTRICT_SIMULATION_ROSTER. assembleAsOfDistrictEvents marks a GENERATED plan whose roster is longer than that bound unavailable instead of posting it, and is otherwise byte identical (every existing test in the file passes unedited, the frozen Live pin included). End to end: runAsOfEvent on the ready request returns status baked with roster equal to the verdict roster, and simulatedDcmpBakeView over a complete run state for that signature is ready with byTeam keys equal to the roster. The view is pending for asOf loading, an idle or running run, or a complete run for another signature; unavailable for asOf failed, an unavailable assembly, a run error, or an unavailable entry.
    - champLedgerChances.test.ts: dcmpSimulatedField is pending for a pending district state, refused for noCall and for any capacityUnknown team under settled or simulated, and ready otherwise with the sorted roster (prequalified, locked, inRange), the outOfRange set, and the lockedOut set carried in every arm. simulatedDcmpState maps field pending to pending, field refused to unavailable, and a ready field to its bake's status. champRangeState with simulatedDcmp pending reads pending even where estimates is noTable; with unavailable reads noCall unpricedDcmp; with ready ignores estimates (noTable and awaitingFieldChances) and reads the champ run. Every existing champRangeState test passes unedited.
    - champLedgerRows.test.ts, a new describe on the rewound before the DCMP fixture (~615) with simulatedDcmp supplied beside the estimate map: a roster team gets four open cells with the dcmp-row ids at the dcmp ceilings and an open Subtotal from the record, estimated false, dcmpPart carrying its supplied field chance and the elim mass at the winner value as winChance; an outOfRange team gets five outOfRange cells, grandTotalIsDistrictOnly true, dcmpPart undefined, a grand total equal to the district only convolution, and is NOT in gaps.teamsWithDistrictOnlyGrandTotal; a lockedOut team gets five notInField cells, the same district only grand total, and is not in that gap. Field pending gives five unavailable pending cells and a pending grand total for every non lockedOut team; field refused, bake unavailable and a roster team with no record give five plain unavailable cells and a plain unavailable grand total; bake pending gives pending. The estimate is never read for a team whose field is not a fact while simulatedDcmp is supplied. Every existing test passes unedited.
    - districtLedgerCopy.test.ts: CHAMP_LEDGER_OUT_OF_RANGE_CELL is "out of range" and CHAMP_LEDGER_OUT_OF_RANGE_LINE is "outside the simulated field"; the existing three absences test widens to FOUR pairwise distinct readings (em dash, not yet priced, not available, out of range); neither new string carries a hyphen, en dash or em dash.
    - ChampLocksLedger.test.tsx: the test at ~905 ("prices every team from the estimate at a rewound position before the DCMP...") is REWRITTEN for the bake at at=season-start on the championship under way fixture: after waitForSimulatedLine, no cell reads not-yet-priced; at least one team's DCMP row has four category cells with data-cell open and an open Subtotal and no district only label; at least one team's DCMP row has five data-cell out-of-range cells reading "out of range", a DCMP Source line containing "outside the simulated field" and the champ-ledger-district-only label; the count of district only labels equals the count of teams whose DCMP row reads out of range or the em dash; the stat line keeps its likely range. The test at ~858 ("prints the field chance on the grand total's DCMP chip...") passes UNEDITED. Every Now test in the file passes unedited.
  </behavior>
  <action>
    RED first: write the behavior cases above and run them; they fail on missing exports and on the not-yet-priced reading.

    GREEN, in this order.

    1. asOfRewind.ts. The candidate element type of AsOfRewindInput.candidates gains optional `roster` (readonly string[]), documented: a GENERATED plan's roster when the caller supplies one, used by the Champ Locks tab (261007-mxf) to resolve every district team at the cut under its unstarted championship's plan so the Locked plus In range bake assembles from the same load; the main run never posts that plan. PlanAsOfEventParams gains optional `rosterOverride`. In planAsOfEvent's GENERATED branch only, the roster is the sorted, de-duplicated override when supplied, ahead of fromArtifact and districtRegistrations; extend that branch's comment. loadAsOfRewind passes candidate.roster as rosterOverride. Nothing else in the module moves.

    2. useAsOfRewind.ts. UseAsOfRewindOptions.candidates gains the same optional roster. Append ONE segment at the END of queryKey: each open candidate that carries a roster as eventKey:length, comma joined (empty when none), so FINGERPRINT_KEY_INDEX stays 5 and a district artifact that gains a team re-plans.

    3. districtRunAssembly.ts. (a) Move the GENERATED request construction out of assembleAsOfDistrictEvents (~304-325) into one module private helper taking the artifact, event key, tier, roster, the outcome's cutId, season, vars, league and team tuples, the plan's bake params and the algorithm version. It returns unavailable for an empty roster or one longer than MAX_DISTRICT_SIMULATION_ROSTER (import it from ../../workers/districtSimulationProtocol.js; useDistrictSimulationRun.ts already imports runtime values from that module, so the main bundle carries it today). Say why in its doc: a longer roster makes the Worker refuse the WHOLE request as malformed, costing every event. assembleAsOfDistrictEvents calls it and stays byte identical for rosters of 1 to 256. (b) Export assembleSimulatedDcmpBake({ artifact, result, algorithmVersion, eventKey, roster }) returning ready with { request, signature } or unavailable with a reason, per the behavior list. The as-of block's teams are the outcome's state.teams filtered to the roster; tier and bake come from outcome.state.plan; signature is districtRunSignature([request]). (c) Export simulatedDcmpBakeView({ asOf, assembled, runState }) returning SimulatedDcmpBake: pending while asOf is undefined or loading, while assembled is undefined, or while the run is idle, running, or complete for another signature; unavailable for asOf failed, an unavailable assembly, a run error, or an unavailable entry; ready with distributionsFromPreSim(entry) for a baked entry of the current signature. Import AsOfRewindView and DistrictSimulationRunState as TYPES only, so the module stays React free. Add one header paragraph naming the second request and the reason in "The DCMP bake threading" above.

    4. New useSimulatedDcmpBake.ts with a WHY header (the second request, why it waits for the settled field, why it never widens the main signature). It exports useSimulatedDcmpBake({ active, asOf, artifact, eventKey, field }) returning { bake, signature, runState }. A memo assembles only when active, field is ready, asOf is ready and eventKey is defined; a second memo builds the run request (the one event and its signature, else a module constant empty request with signature ""), which goes to useDistrictSimulationRun; a third memo is simulatedDcmpBakeView. An empty request posts nothing (SC-5 lives in that hook).

    5. champLedgerRows.ts. (a) ChampLedgerCell gains the outOfRange variant; its doc names the four readings (em dash not in the field, not yet priced, not available, out of range = outside the simulated field). (b) Export the types SimulatedDcmpField (pending with lockedOut; refused with lockedOut; ready with roster, outOfRange, lockedOut), SimulatedDcmpBake (pending; unavailable; ready with a DistrictEventDistributions) and SimulatedDcmpPricing ({ field, bake }). (c) BuildChampLedgerRowsOptions gains optional simulatedDcmp, documented: rewound stops before any championship starts only; absent everywhere else, which is the shipped behaviour byte for byte. (d) fieldIsFact (~488): the "any priced row is read" default applies only when BOTH dcmpEstimateByTeam and simulatedDcmp are absent. (e) buildDcmpRow takes the team's simulated reading (resolved by one private helper from the pricing and the team key, by the readings table above) and the dcmp category ceilings, and also returns outsideSimulatedField. Its new case sits between case 2 (the field is a fact) and the estimate: lockedOut gives the notInField whole row; outOfRange the outOfRange whole row; pending a whole row of unavailable cells with pending true; unavailable a whole row of plain unavailable cells; baked gives four openDistrictLedgerCell cells (champCellId("dcmp", category), the record's distribution, that category's dcmp ceiling) and an open Subtotal from record.eventTotal at the event total ceiling, estimated false, sources the dcmp pass's own. A record missing any of its five distributions reads unavailable. Factor the Playoffs mass at the winner value out of case 2 into one private helper that both cases call. outsideSimulatedField is true for the lockedOut and outOfRange readings only. Rewrite the doc as FIVE cases. (f) In the grand total section (~499-579) split districtOnly into unpriced (subtotal notYetPriced; still the ONLY thing that joins teamsWithDistrictOnlyGrandTotal) and outsideSimulatedField. The district only arithmetic (the ceiling without the DCMP, no DCMP part in the convolution, no dcmpRunPart, the final branch's earned sum, the third term of hasOpenCategory) reads either one. grandTotalIsDistrictOnly is either one AND the shipped not-unavailable guard. Update the docs of grandTotalIsDistrictOnly and teamsWithDistrictOnlyGrandTotal: an outside field total is labelled but never suppresses the champ run, because those teams are priced, at zero championship points.

    6. champLedgerChances.ts. Export dcmpSimulatedField(districtShown, state), typed structurally on a byTeam map of { status, rangeCall? } plus a LedgerRangeState, with the rules in the behavior list and a WHY doc (the shown chip, per CONTEXT; refusal where the roster cannot be decided). Export simulatedDcmpState(pricing). ChampRangeStateInputs gains optional simulatedDcmp ("pending" | "ready" | "unavailable"); in champRangeState, after the district run checks and IN PLACE OF the two estimates checks when supplied: pending returns pending, unavailable returns noCall unpricedDcmp, ready falls through to unpricedInTeams and the champ run. Absent keeps the shipped order.

    7. districtLedgerCopy.ts. Add CHAMP_LEDGER_OUT_OF_RANGE_CELL = "out of range" directly after CHAMP_LEDGER_NOT_YET_PRICED_CELL, its doc stating the distinction (em dash = not in the field, not available = attempted and refused, not yet priced = no field to price over, out of range = outside the simulated Locked plus In range field). Add CHAMP_LEDGER_OUT_OF_RANGE_LINE = "outside the simulated field" directly after CHAMP_LEDGER_NOT_IN_FIELD_LINE.

    8. ChampLocksLedger.tsx. (a) An allDistrictTeamKeys memo (sorted) and the candidates memo attaching roster to dcmpEventKeys[0] only. (b) After districtRunCurrent: districtShownRange and districtShown memos on the District Locks tab's recipe (see "The DCMP bake threading"), with the same perEventRunSignature expression the champ rangeState already uses and cutoffByRun and draws from districtChanceState when complete; comment that this is the chip the District Locks tab shows. (c) simulatedDcmpActive = asOf supplied, not atNow, dcmpEventKeys non-empty, and startedDcmpEventKeys empty. simulatedField = dcmpSimulatedField(districtShown, districtShownRange) when active, else undefined. Call useSimulatedDcmpBake unconditionally with active, asOf, artifact, eventKey dcmpEventKeys[0] and the field. simulatedDcmp (memo) = { field, bake } when the field is defined; simulatedDcmpStatus = simulatedDcmpState of it. (d) rows passes simulatedDcmp (add to deps). (e) champChanceRun passes champRunSignature: runSignature when simulatedDcmpStatus is undefined; runSignature joined with "#" and the bake signature when it is ready and runSignature is non-null; otherwise null. (f) rangeState passes simulatedDcmp: simulatedDcmpStatus (add to deps). (g) runProgress falls back to an indeterminate bar while simulatedDcmpStatus is pending. (h) ChampCell renders the outOfRange kind with data-cell "out-of-range" and CHAMP_LEDGER_OUT_OF_RANGE_CELL in the same muted UNAVAILABLE_CELL_CLASS span. (i) SourceCell's DCMP line order becomes: membership out or a notInField subtotal gives CHAMP_LEDGER_NOT_IN_FIELD_LINE; an outOfRange subtotal gives CHAMP_LEDGER_OUT_OF_RANGE_LINE; then the shipped chance, estimated and stage lines. (j) Rewrite the skipEventKeys comment: the unstarted championship stays out of the MAIN run because it is baked separately over the simulated field (useSimulatedDcmpBake), which is what replaces the old exclusion.

    9. Run the five pure test files, then ChampLocksLedger.test.tsx alone, then the three typechecks. Commit A by explicit paths with the message `feat(261007-mxf): bake the DCMP over the Locked and In range field at rewound stops`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/districts/asOfRewind.test.ts apps/web/src/components/districts/useDistrictLedgerData.asOf.test.ts apps/web/src/components/districts/useAsOfRewind.test.tsx apps/web/src/components/districts/champLedgerChances.test.ts apps/web/src/components/districts/champLedgerRows.test.ts apps/web/src/components/districts/districtLedgerCopy.test.ts scripts/asOfRewindWeb.test.ts (repo root; read the counts in the output)</automated>
    <automated>npx vitest run apps/web/src/components/districts/ChampLocksLedger.test.tsx (repo root, timeout 600000 ms; read the counts in the output)</automated>
    <automated>npx tsc --noEmit -p . and npx tsc --noEmit -p apps/web/tsconfig.json and npx tsc --noEmit -p apps/web/tsconfig.e2e.json, all three clean (root tsc misses apps/web)</automated>
    <human-check>End of phase, orchestrator or Jacob on a local preview (the local visual verification recipe): Champ Locks for 2026 Michigan rewound to a week 2 stop. In field teams show four DCMP numbers, out of range teams read out of range with district only under the grand total, the stat line prints a simulated cutoff, and the time to a settled table is noted against the 3.7 to 8.0 s the 261005-5g0 summary measured.</human-check>
  </verify>
  <done>All listed tests pass, including the two pre-existing rewound drawer tests (one rewritten, one unedited) and every Now test; scripts/asOfRewindWeb.test.ts passes unedited; three typechecks clean; Commit A holds exactly this task's files.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Hide teams not registered at the DCMP once it is the selected event, and treat a DCMP's own Schedule stop as a fact</name>
  <files>apps/web/src/components/districts/champLedgerRows.ts, apps/web/src/components/districts/champLedgerRows.test.ts, apps/web/src/components/districts/ChampLocksLedger.tsx, apps/web/src/components/districts/ChampLocksLedger.test.tsx</files>
  <behavior>
    - champLedgerRows.test.ts: champTeamHiddenAtDcmp is true only when dcmpSelected is true AND the team's DCMP row has no source (no dcmp-tier row on the artifact). A judging only registrant (a dcmp-tier row with no qualification schedule) is never hidden. On the all-final fixture it hides exactly the teams whose membership is out.
    - ChampLocksLedger.test.tsx, finished district at Now (the DCMP has started): the test at ~422 now expects DCMP_FIELD.size times two rows and still checks ROSTER[0]'s two labelled rows; the test at ~465 is REWRITTEN as "omits a team outside the field once the DCMP has started, and still counts it": rowsFor(ROSTER[12]) is empty, ROSTER[0] still renders, and the district-ledger-status-chip counts still sum to ROSTER.length. The em dash reading itself stays pinned by Task 1's pure tests on the simulated Locked out team.
    - New: the finished artifact at at=season-start (a district event position) renders ROSTER[12]'s two rows, so nobody is hidden before the DCMP is the selected event.
    - New: the finished artifact at at=2026pncmp:schedule with installFetch serving liveEventArtifact(DISTRICT_EVENT) and liveEventArtifact(DCMP_EVENT): once ROSTER[0]'s DCMP row shows a non-final cell (data-cell open or pending, which proves the stop resolved off Now), rowsFor(ROSTER[12]) is empty and ROSTER[0]'s DCMP row carries no out-of-range and no not-yet-priced cell. If the Schedule alias cannot be made to resolve with the existing fixtures, cover the same rule with a pure test of a small exported helper instead and say so in the summary.
    - Every other test in ChampLocksLedger.test.tsx passes unedited.
  </behavior>
  <action>
    1. champLedgerRows.ts: export champTeamHiddenAtDcmp(team, dcmpSelected) with a WHY doc. Per CONTEXT the hidden teams are exactly the membership out teams: a judging only registrant already has a dcmp-tier row and reads in. The predicate is "no dcmp-tier row" (an empty team.dcmpRow.sources), which equals membership out wherever one championship is played, and also hides a rowless team while a divisioned (FIM) or two-championship (2026 California) district has started one of them, because a team registered at no championship cannot attend.

    2. ChampLocksLedger.tsx. (a) startedDcmpEventKeys, rewound arm: a dcmp key is in the set when eventStartedAtPosition says so OR it equals asOfScheduleStopEventKey(search.at) (import it from ./asOfRewind.js). Rewrite the memo's doc: at a championship's own Schedule stop its schedule is posted, so its field is a fact there; planAsOfEvent already prices that event REAL there, and the hide rule needs membership to read out there. This one change carries through skipEventKeys (the Schedule stop DCMP joins the main run as REAL), membership, the estimate's field chance and simulatedDcmpActive (inactive there). (b) visibleTeams: dcmpSelected = startedDcmpEventKeys.size > 0; drop hidden teams before the team number search and the status filter (they compose as today); add the deps. Comment that hidden teams leave the table only, never rows.teams, so the champ run, the predicted cutoff, the disclosed gaps and the status counts still see them.

    3. Update the two finished-district tests and add the two new ones per the behavior list. Run, typecheck, commit B by explicit paths: `feat(261007-mxf): hide teams not registered at the DCMP once it is the selected event`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/districts/champLedgerRows.test.ts apps/web/src/components/districts/ChampLocksLedger.test.tsx (repo root, timeout 600000 ms; read the counts in the output)</automated>
    <automated>npx tsc --noEmit -p . and npx tsc --noEmit -p apps/web/tsconfig.json, both clean</automated>
  </verify>
  <done>Non-field teams are absent at Now after a championship starts and at a DCMP's Schedule stop, present at district positions, and still counted in the chips. All tests pass; Commit B holds exactly this task's files.</done>
</task>

<task type="auto">
  <name>Task 3: Methodology copy, module headers and the Now position todo</name>
  <files>apps/web/src/components/methodology/districtLedgerContent.ts, apps/web/src/components/districts/ChampLocksLedger.tsx, apps/web/src/components/districts/champLedgerRows.ts, apps/web/src/components/districts/champLedgerChances.ts, apps/web/src/components/districts/districtLedgerCopy.ts, apps/web/src/components/districts/useDistrictLedgerData.ts, .planning/todos/pending/champ-locks-now-dcmp-bake.md</files>
  <action>
    1. districtLedgerContent.ts, section how-district-points-work: replace the two Champ Locks paragraphs (~163-164) with three, each at most three sentences, flat third person, no hyphen or dash characters, no how or why sentences, and nothing inserted between the award lock paragraph and the two paragraphs after it (a test pins that slice). Proposed text, which Jacob may edit:
       - "The Champ Locks tab predicts each team's finish in the race for the district's FIRST Championship slots, adding the District Championship's own four categories to the district season total. Only the grand total folds in the chance of being there."
       - "At a rewound point before the District Championship starts, the championship is simulated with a field made of the teams that are Locked or In range at that point. A team outside that field reads out of range in the championship row, and its grand total counts district points only."
       - "On the live view, until the championship field is set, a team's championship points are estimated from how teams at the same place in past championship fields scored, using only seasons before the one shown, and the four championship categories read not yet priced. Once the District Championship has started, its own prediction is used and teams not registered at it are left out of the table. A season with no earlier season to learn from shows the district season alone until the field is set."
       Report the final wording in the summary and link the file so Jacob can edit it himself.

    2. Module headers and docs, prose only, no code change. ChampLocksLedger.tsx header: rewrite the "BEFORE THE CHAMPIONSHIP STARTS, ITS POINTS ARE AN ESTIMATE" bullet (Now keeps the estimate; a rewound stop bakes the Locked plus In range field, 261007-mxf), extend "TWO CHANCE RUNS" to the full order (per event run, district chance run, district line, DCMP bake, champ run), and add the hide rule to "THE FIELD IS A QUESTION BEFORE IT IS A FACT". champLedgerRows.ts header: in the "AN UNPRICED DCMP..." section add that a team outside the simulated field also gets a labelled district only total, priced at zero championship points, so it never suppresses the champ run. champLedgerChances.ts header: the "WHY THERE IS NO PER-RUN FIELD MEMBERSHIP" paragraph says the DCMP's predictions come from the event artifact's REAL roster; add that at a rewound stop before the championship they come from the simulated Locked plus In range field. districtLedgerCopy.ts: the PRE-REGISTRATION WINDOW block and CHAMP_LEDGER_DISTRICT_ONLY_LINE's doc name the outside field case. useDistrictLedgerData.ts: the tierByEvent doc's "A second run for one event would be a second place..." sentence gains the one deliberate exception (the Champ Locks DCMP bake, whose roster is a function of this run's output) and its reason.

    3. Write .planning/todos/pending/champ-locks-now-dcmp-bake.md in the existing todo format (front matter id champ-locks-now-dcmp-bake, created 2026-10-07, source quick 261007-mxf, priority medium; then "Why this matters" and "What to do"). The follow-up: a DCMP only as-of bake at the Now position before the field is a fact, so Now matches rewound stops, without routing live district events through the as-of path (that stays untouched). Add a "Known limits of 261007-mxf" section: (a) a district whose championship is not on the artifact yet (the live season before registrations) keeps the estimate at rewound stops, because no event key exists to plan the bake under; (b) a divisioned championship (FIM) or a two-championship district (2026 California) is simulated as ONE eight alliance event over the whole field, so alliance and playoff points are drawn from one bracket; a per division simulation needs a division assignment rule.

    4. Run the methodology and copy tests and the typechecks. Commit C by explicit paths: `docs(261007-mxf): methodology for the rewound DCMP simulation, module headers, Now position todo`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/methodology apps/web/src/routes/methodology.district-points.test.tsx apps/web/src/components/districts/districtLedgerCopy.test.ts (repo root; read the counts in the output)</automated>
    <automated>npx tsc --noEmit -p . and npx tsc --noEmit -p apps/web/tsconfig.json, both clean</automated>
  </verify>
  <done>The methodology tests pass (voice, sentence limit, pinned slices); the headers describe the shipped behaviour; the todo exists; Commit C holds exactly this task's files.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| main thread to Web Worker | The bake request crosses a structured clone; the Worker validates cost and shape (isDistrictSimulationRequest) |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-mxf-01 | Denial of service | assembleSimulatedDcmpBake and the shared GENERATED helper | low | mitigate | A roster longer than MAX_DISTRICT_SIMULATION_ROSTER reads not available before posting, so the visitor's CPU stays bounded and the main request can never be refused whole |
| T-mxf-02 | Information disclosure | rewound stops | low | mitigate | The simulated field is built from the verdicts at the stop and the as-of state at the cut; no future registration reaches a rewound price (the no leak guarantee of 260927-6bf is kept) |
</threat_model>

<verification>
- `npx vitest run apps/web/src/components/districts scripts/asOfRewindWeb.test.ts apps/web/src/components/methodology apps/web/src/routes/methodology.district-points.test.tsx` from the repo root, with the counts read from the output.
- `npx tsc --noEmit -p .`, `npx tsc --noEmit -p apps/web/tsconfig.json` and `npx tsc --noEmit -p apps/web/tsconfig.e2e.json` all clean.
- `git log --oneline -3` shows commits A, B and C, and `git status --short` shows nothing of this task unstaged.
</verification>

<success_criteria>
- Rewound before the DCMP: in field teams carry four baked DCMP cells, outside teams read out of range or the em dash with a labelled district only total, and the simulated champ line prints.
- The DCMP bake is one extra generated event in a second request; the main per event run is unchanged.
- At the DCMP position the table omits teams with no dcmp-tier row and still counts them.
- Now position pricing is unchanged; the estimate and not yet priced survive there.
- Methodology, module headers and the follow-up todo are written.
</success_criteria>

<output>
Per project memory (feedback_subagent_summary_write_block), RETURN the summary text to the orchestrator instead of writing it; the orchestrator writes `.planning/quick/261007-mxf-champ-locks-hide-non-field-teams-at-the-/261007-mxf-SUMMARY.md`. Include: the three commit hashes, the test counts as read from the output, the final methodology wording with a link to districtLedgerContent.ts, whether the Schedule stop component test used the alias or the pure fallback, and the two known limits recorded in the todo.
</output>
