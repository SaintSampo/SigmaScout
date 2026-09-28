---
quick_id: 260927-vmb
date: 2026-09-27
description: >-
  Price a registered no show from awards alone once its event's schedule is
  known, on both Locks tabs. A team registered for a started event (a TBA
  registration in the district artifact) but absent from the event artifact's
  posted qualification schedule today gets no record from the event's own
  simulation, so its cells read unavailable and the Champ Locks DCMP row falls
  to the walk forward estimate (buildDcmpRow case 3). After this task the
  event's own simulation draws that team's award exactly as it draws every
  other team's, its three on field categories read a grey 0, and its event
  total is its award distribution. Real case: frc2635 at 2026pncmp.
status: planned
phase: quick-260927-vmb
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [quick-260927-vmb]
files_modified:
  - packages/core/districts/ledgerSimulation.ts
  - packages/core/districts/ledgerSimulation.test.ts
  - apps/web/src/components/districts/districtLedgerRows.ts
  - apps/web/src/components/districts/champLedgerRows.ts
  - apps/web/src/components/districts/champLedgerRows.test.ts
  - apps/web/src/components/districts/districtLedgerRows.test.ts
  - apps/web/src/components/districts/useDistrictLedgerData.ts
  - apps/web/src/components/districts/useDistrictLedgerData.test.ts
  - apps/web/src/workers/districtSimulationProtocol.ts
  - apps/web/src/workers/districtSimulationProtocol.test.ts
  - apps/web/src/components/methodology/districtLedgerContent.ts

estimate:
  tokens: 75000
  raw_tokens: 150000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "At a started event whose event artifact carries qualification rows, a team the district artifact lists for that event (an eventPoints or remainingEvents row at the event's tier) but that is absent from the schedule reads a grey 0 in Qualification, Alliance selection and Playoffs, an open Awards cell, and an open event total whose mass at every point value equals its Awards mass (District Locks event row and Champ Locks DCMP row alike)"
    - "That team's Awards distribution is produced by simulateDistrictEvent's own award draw in the same run as the roster: same field ordering (the team joins the decoration ordering), same posted / ordering / base rate path choice, same stack fold, tier weight and ceiling clamp"
    - "On Champ Locks the no show's DCMP row is the event's own row (buildDcmpRow case 2, estimated false), its win chance is 0, and ChampLedgerTeam.dcmpPart carries that same award distribution into the champ chance run and the simulated cutoff"
    - "The no show's row.stage is the event level stage every roster team's row at that event carries, so floors, ceilings, the Impact slot reservation and the pooled lock read exactly the event facts they read before"
    - "Before the schedule posts (zero qualification rows) and at any event where every registered team is scheduled, the simulation input carries no awardOnlyTeams member and simulateDistrictEvent's output is byte for byte what it was"
    - "The live per event run re fires when the award only list changes, and the Web Worker boundary bounds the list's size"
  artifacts:
    - path: packages/core/districts/ledgerSimulation.ts
      provides: "Optional DistrictLedgerEventInput.awardOnlyTeams and DistrictLedgerResult.awardOnlyTeams; award only teams join the award ordering and are drawn by the same per team award draw; InvalidAwardOnlyTeamsError"
    - path: apps/web/src/components/districts/districtLedgerRows.ts
      provides: "buildDistrictEventSimulationInput derives the award only list; DistrictEventDistributions.awardOnlyTeams; buildDistrictLedgerRows renders award only rows"
    - path: apps/web/src/components/districts/useDistrictLedgerData.ts
      provides: "districtRunSignature folds the award only list when present"
    - path: apps/web/src/workers/districtSimulationProtocol.ts
      provides: "isEventRequest bounds awardOnlyTeams"
    - path: apps/web/src/components/methodology/districtLedgerContent.ts
      provides: "One sentence stating how a registered team missing from the schedule is priced"
  key_links:
    - from: "buildDistrictEventSimulationInput (districtLedgerRows.ts)"
      to: "simulateDistrictEvent (ledgerSimulation.ts)"
      via: "input.awardOnlyTeams plus an awardProfiles entry for each (awardProfileOrZero)"
    - from: "simulateDistrictEvent result"
      to: "buildDistrictLedgerRows"
      via: "distributionsFromResult copies result.awardOnlyTeams onto DistrictEventDistributions.awardOnlyTeams; the row builder reads it per (event, team)"
    - from: "buildDistrictLedgerRows dcmp pass"
      to: "buildDcmpRow case 2 and ChampLedgerTeam.dcmpPart (champLedgerRows.ts)"
      via: "the no show's eventTotal is now open, so case 2 fires and the subtotal becomes dcmpPart"
    - from: "useDistrictLedgerData"
      to: "useDistrictSimulationRun"
      via: "districtRunSignature includes the award only list"
---

<objective>
Price a registered no show from awards alone once its event's schedule is known, on Champ Locks (the DCMP) and District Locks (a started district event), without changing anything before the schedule posts.

Purpose: today frc2635 at 2026pncmp (registered, 0 matches, later 24 award points) shows estimated DCMP points as if it were playing, and the same team at a started district event would show unavailable cells and an unavailable grand total. Its qualification, alliance selection and playoff points are settled at 0 the moment the schedule posts; only its award is open.

Output: an optional award only team list on the core simulation input, derived in the browser from the district artifact's registrations minus the posted schedule, drawn by the simulation's own award draw, and rendered by the row builder as three grey zeros, an open Awards cell and an event total equal to the award distribution. Every downstream consumer (grand total, statuses, champ chance run, champ cutoff) reads that through the rows it already reads.

WHY THE CORE MODULE CHANGES (the constraint was web only unless proven otherwise; this is the proof). The award draw prices Impact and Rookie All Star from a team's POSITION in the whole field's decoration ordering, computed inside simulateDistrictEvent from the input's own team list, and picks one of three paths (posted, ordering, base rate) per event from that same list. A team outside the input has no position and no path. Pricing it in the browser would mean restating the draw's composition (Impact, then Rookie All Star, then the folded residual, the tier weight, the clamp) as a second copy of a rule ledgerSimulation.ts keeps in one place, over a field that differs from the one the roster was priced in. The core change is ADDITIVE and OPTIONAL: packages/harness/districtBake.ts and scripts/measureChampCutoff.ts never pass the new member, so the publisher bake and every published sidecar are byte for byte unchanged (pinned in Task 1). No file under apps/worker/ is touched.

MODELLING CONSEQUENCE, stated so the SUMMARY can repeat it: the no show joins the event's award ordering, so at an event WITH a no show the roster teams' award prices move to the ones the registered field gives, which is the field the pre event bake already priced (scripts/publishDistricts.ts builds the bake roster from the same registrations). At every event without one nothing moves.

CEILINGS STAY CONSERVATIVE, deliberately. row.stage is an event level fact that reservedSlotsAtPosition and pooledLockInputs read FIRST ROW WINS; a per team override on the no show's row could shrink an event's remaining points pool and print a false Locked. So the no show's ceiling keeps counting the open on field categories (the widening direction the guarantee side already takes for unprofiled teams, which it passes as rookies). The status layer still reads the new projection, so In range and Out of range follow the award only distribution.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/quick/260927-ue3-local-visual-check-of-the-no-call-chip-a/screenshots/README.md

Source, read once each, only the ranges named:
- packages/core/districts/ledgerSimulation.ts: 236-415 (DistrictAwardProfile, ZERO_AWARD_PROFILE, awardOrderingAssignments, singleAwardPoints), 422-608 (input and result shapes), 702-830 (typed errors), 907-1110 (validation, award profile lookup, ordering, accumulators), 1195-1240 (per draw buffers, ledgerRng), 1378-1525 (the award draw, accumulation, result)
- apps/web/src/components/districts/districtLedgerRows.ts: 371-435 (tierEvents), 494-531 (awardProfileFor, awardProfileOrZero), 686-832 (buildDistrictEventSimulationInput), 849-915 (DistrictEventDistributions, distributionsFromResult, distributionsFromPreSim), 1028-1175 (buildDistrictLedgerRows buildTeam)
- apps/web/src/components/districts/champLedgerRows.ts: 393-470 (buildChampLedgerRows pass fold), 695-785 (buildDcmpRow)
- apps/web/src/components/districts/useDistrictLedgerData.ts: 208-232 (districtRunSignature)
- apps/web/src/workers/districtSimulationProtocol.ts: 55-70 (MAX_DISTRICT_SIMULATION_ROSTER), 255-268 (isEventRequest)
- apps/web/src/components/districts/districtLedgerStatus.ts: 206-270 (floor and ceiling loop; read only, not modified)

Fixture patterns to copy (do not re read the whole files):
- apps/web/src/components/districts/districtLedgerRows.test.ts 52-127 (state, eventPoints, remainingEvent, team, artifactOf helpers) and 753-805 (a scheduled EventArtifact built with EventArtifactSchema.parse)
- apps/web/src/components/districts/ChampLocksLedger.test.tsx 250-310 (a 24 team EventArtifact with played matches and upcoming rows; 24 teams is the minimum for eight three team alliances)
- packages/core/districts/ledgerSimulation.test.ts helpers baselinesFor, profilesWithCounts, teamKey, SEASON (used from line 1362 on)
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Tracer, a registered DCMP no show priced from awards alone, end to end</name>
  <files>packages/core/districts/ledgerSimulation.ts, packages/core/districts/ledgerSimulation.test.ts, apps/web/src/components/districts/districtLedgerRows.ts, apps/web/src/components/districts/champLedgerRows.ts, apps/web/src/components/districts/champLedgerRows.test.ts</files>
  <behavior>
    - Core: simulateDistrictEvent with awardOnlyTeams absent and with awardOnlyTeams set to an empty array return deep equal results for the same seed (every histogram, awardSources, awardOrdering, selectionRoutes, playoffMilestones, rankingFixed), and the result carries no awardOnlyTeams member in either case. The existing ledgerSimulation.test.ts suites pass with no pinned value edited.
    - Core: with one award only team, result.awardPoints and result.eventTotal carry it, result.qualPoints, selectionPoints and elimPoints and selectionRoutes do not, its award histogram sums to draws, its eventTotal histogram equals its award histogram bin for bin (zero past the award length), result.awardSources carries its rung, and result.awardOnlyTeams lists it.
    - Core: with knownAwardPoints supplied, an award only team's award histogram is a point mass at its posted value (0 when absent from the map).
    - Core: an award only team that is the most decorated in the field takes ordering position 1: over 4,000 draws its share at the Impact value times the tier weight is within 0.03 of impactOrderingProbability(SEASON, 1).p.
    - Core: an award only key that is empty, duplicated, or also in baselines throws InvalidAwardOnlyTeamsError before any draw, naming every offender; an award only team with no profile and no knownAwardPoints is named in MissingAwardProfileError like any roster team.
    - End to end (champLedgerRows.test.ts): a synthetic 2026 district whose DCMP has started (every team's dcmp row carries state qualMatchesPlayed 6 of qualMatchesTotal 12), a 24 team DCMP EventArtifact with played and upcoming qual rows, and one extra district team registered for the DCMP through a dcmp tier remainingEvents row but on no qual row. buildDistrictEventSimulationInput at tier dcmp puts exactly that team in input.awardOnlyTeams; simulateDistrictEvent then distributionsFromResult then buildChampLedgerRows (dcmpStarted true, atLivePosition true, and a dcmpEstimateByTeam entry for the no show) gives the no show a DCMP row with estimated false, grey final 0 in qual, alliance and elim, an open award cell whose distribution counts equal result.awardPoints for that team, an open subtotal whose mass at every point value equals the award mass, ChampLedgerTeam.dcmpPart whose distribution is that subtotal's and whose winChance is 0, and a grand total that is not unavailable.
  </behavior>
  <action>
RED first: write the core behaviours above in a new describe block in packages/core/districts/ledgerSimulation.test.ts and the end to end case in a new describe block in apps/web/src/components/districts/champLedgerRows.test.ts; run them and confirm they fail for the missing member, not for a fixture error.

Core, packages/core/districts/ledgerSimulation.ts:
1. Add an optional readonly awardOnlyTeams (array of team keys) to DistrictLedgerEventInput with a doc comment: registered teams that are not on the posted qualification schedule; they earn no qualification, selection or playoff points, they join the award field (decoration ordering, path choice) and are drawn by the same per team award draw; absent or empty is byte for byte the shipped run; the caller decides who they are.
2. Add an optional readonly awardOnlyTeams to DistrictLedgerResult, present ONLY when the input list was non empty, documented as: these keys appear in awardPoints, eventTotal and awardSources and nowhere else, and their eventTotal equals their award draw by construction.
3. Add a typed error class InvalidAwardOnlyTeamsError beside the others (set this.name). In the up front validation pass, collect EVERY empty key, duplicate, and key also present in baselines, and throw once naming all of them, before any draw.
4. Widen awardOrderingAssignments' second parameter type to a readonly array of objects with a readonly teamKey string (it reads nothing else), so existing callers still compile. Build one combined award field list: the baselines in order, then the award only keys in their given order. Run the missing profile check, the base rate lookup (awardPmfByTeam, awardSources) and awardOrderingAssignments over that combined list, so the award only teams take real positions in the ordering and can flip the event to incomplete profiles exactly as a roster team can.
5. Extract the per team award draw (the three paths: posted via knownAwardPoints with a missing key reading 0; the ordering path's Impact, Rookie All Star only when its probability is above 0, residual, singleAwardPoints, tier weight, ceiling clamp; the base rate path with foldStackedAwardPoints) into ONE local function indexed over the combined list. Do not copy the three paths a second time. Inside each draw keep the roster loop exactly where and how it consumes ledgerRng today, then draw the award only teams after it. With no award only teams the stream consumption must be identical, which the equality pin proves.
6. Allocate award and eventTotal Int32Array histograms for each award only team (lengths from the same ceilings), accumulate award into both each draw, and add them to awardPoints, eventTotal and awardSources only. The observer arrays stay roster indexed (say so in the observer doc); ledgerDraws naturally includes their consumption.

Browser, apps/web/src/components/districts/districtLedgerRows.ts:
7. In buildDistrictEventSimulationInput, after rosterKeys: when buildQualRows(eventArtifact) is non empty (the schedule is known), collect the scheduled keys as rosterKeys plus every key on any qual row's redTeams and blueTeams; the award only list is every district artifact team for which tierEvents(team, tier) has an entry with this eventKey and whose key is not scheduled, sorted ascending. Give each an awardProfiles entry through awardProfileOrZero. Spread awardOnlyTeams into the input only when the list is non empty. With zero qual rows nothing is derived, which is the before the schedule posts guarantee.
8. Add an optional readonly awardOnlyTeams (ReadonlySet of team keys) to DistrictEventDistributions with a doc comment. distributionsFromResult sets it only when result.awardOnlyTeams is non empty. distributionsFromPreSim never sets it: the pre event bake prices every registered team as a full participant, which is the unchanged before the schedule posts behaviour.
9. In buildDistrictLedgerRows' buildTeam, per entry read awardOnly as the event's distributions set containing this team. For an award only team, qual, alliance and elim return a final cell BEFORE the final[category] check, with earned equal to the artifact's own entry.earned value for that category when TBA has published a row, else 0; they never set hasOpenCategory. The award category keeps the existing logic untouched (final reads entry.earned or unavailable; open reads the record). The event total treats an award only row as finished once final.award is true (earned total, or unavailable when TBA has published no row); otherwise it reads record.eventTotal as today. Do NOT change the row's stage: it stays the event level stage (see the objective's ceilings paragraph). Document the rule in a short comment at the branch: the three on field categories are settled by the posted schedule, not by TBA's row.

Champ, apps/web/src/components/districts/champLedgerRows.ts: doc comment only. In buildDcmpRow's case 2 paragraph add one sentence noting that a registered team missing from the posted schedule reaches case 2 once its championship is simulated, because its event row is priced from awards alone (districtLedgerRows.ts awardOnlyTeams). No code change: case 2 fires because the subtotal is now open, and winChance reads 0 because the elim cell is final.

GREEN: run the verify command until every new and existing test in the two files passes. No pinned seeded value in ledgerSimulation.test.ts may be edited; if one moves, the ledger stream moved and step 5 is wrong.
  </action>
  <verify>
    <automated>npx vitest run packages/core/districts/ledgerSimulation.test.ts packages/harness/districtBake.test.ts apps/web/src/components/districts/champLedgerRows.test.ts</automated>
  </verify>
  <done>The end to end case passes: the no show's DCMP row is the event's own row (estimated false) with three grey zeros, an open award cell equal to the run's award histogram, a subtotal whose mass equals the award mass at every point value, dcmpPart carrying that distribution with winChance 0. The absent and empty award only list produce deep equal core results, every pre existing core and bake test passes unedited, and the change is committed with explicit paths.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: District Locks no show, consistency pins, and the run signature</name>
  <files>apps/web/src/components/districts/districtLedgerRows.test.ts, apps/web/src/components/districts/useDistrictLedgerData.ts, apps/web/src/components/districts/useDistrictLedgerData.test.ts</files>
  <behavior>
    - District tier: a started 2026 district event (state qualMatchesPlayed 4 of 12, alliances not picked), a 24 team EventArtifact with played and upcoming qual rows, the 24 roster teams in the district artifact with a district tier row for it, and one extra team registered through a district tier remainingEvents row and on no qual row. buildDistrictEventSimulationInput (default tier) puts only that team in input.awardOnlyTeams; after simulateDistrictEvent and distributionsFromResult, buildDistrictLedgerRows gives it final 0 in qual, alliance and elim, an open award cell equal to the run's award histogram, an open event total whose mass equals the award mass at every point value, an open grand total whose projection equals pointQuantile of its counts at 0.5, hasOpenCategory true, and a row.stage deep equal to a roster team's row.stage for the same event.
    - Statuses: computeDistrictLedgerStatuses over those rows gives the no show inRange exactly when its projection is at or above projectionCutLine and outOfRange otherwise (the artifact publishes dcmpSlots), and never capacityUnknown.
    - Awards posted: with state awardsPosted true and the no show's eventPoints row carrying award 8 (the other categories 0), its award cell reads final 8 and its three on field cells read final 0.
    - Before the schedule posts: the same district and an EventArtifact with no matches and no upcoming rows builds an input with no awardOnlyTeams key at all. A scheduled event where every registered team is on a qual row builds an input with no awardOnlyTeams key.
    - A team registered for a DIFFERENT event of the district is never put in this event's award only list.
    - Signature: districtRunSignature for a request without awardOnlyTeams splits on the pipe into exactly the nine segments it has today, and two requests that differ only in their award only list produce different signatures.
  </behavior>
  <action>
Add one describe block to apps/web/src/components/districts/districtLedgerRows.test.ts covering the district tier behaviours above, reusing the file's own state, eventPoints, remainingEvent, team and artifactOf helpers and a 24 team EventArtifact built the way ChampLocksLedger.test.tsx builds one (every roster team needs metrics.total and metrics.sigma or the run throws UnratedTeamError). Import computeDistrictLedgerStatuses from ./districtLedgerStatus.js for the status pin rather than adding a second test file. Run the real simulateDistrictEvent at a small draw count (200 is enough) under a fixed seed. The awards posted case sets the stage through the state block and passes startMatchKey null, so the run takes the posted path.

In apps/web/src/components/districts/useDistrictLedgerData.ts, append the award only list to districtRunSignature's per event segments ONLY when input.awardOnlyTeams is present, as its keys joined in their given (already sorted) order, so every existing signature string is byte for byte unchanged. Extend the comment above the function with one line: a registration arriving mid event changes the list and must re run the event. Add the two signature behaviours to useDistrictLedgerData.test.ts using its existing requestFor helper.

Nothing in districtLedgerStatus.ts changes. If the status pin fails, the fault is in Task 1's row builder, not in the status module.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/districts/districtLedgerRows.test.ts apps/web/src/components/districts/useDistrictLedgerData.test.ts apps/web/src/components/districts/districtLedgerStatus.test.ts</automated>
  </verify>
  <done>The District Locks no show reads three grey zeros, an open award cell, an event total equal to its award distribution and a grand total the status reads; its row.stage equals its event's; the before the schedule posts and fully scheduled inputs carry no awardOnlyTeams key; the signature moves with the list and is unchanged without it; committed with explicit paths.</done>
</task>

<task type="auto">
  <name>Task 3: Worker boundary bound, methodology sentence, regression triage and full verification</name>
  <files>apps/web/src/workers/districtSimulationProtocol.ts, apps/web/src/workers/districtSimulationProtocol.test.ts, apps/web/src/components/methodology/districtLedgerContent.ts</files>
  <action>
1. In apps/web/src/workers/districtSimulationProtocol.ts isEventRequest: when input.awardOnlyTeams is present it must be an array, and baselines plus award only teams together must not exceed MAX_DISTRICT_SIMULATION_ROSTER; otherwise the request is rejected. This is a cost and shape bound only, matching the header's rule; key validity stays in simulateDistrictEvent (InvalidAwardOnlyTeamsError becomes a per event unavailable entry through the existing catch). Add three cases to districtSimulationProtocol.test.ts: a non array list rejected, a combined size of MAX_DISTRICT_SIMULATION_ROSTER plus 1 rejected, a valid list accepted.

2. Methodology copy, apps/web/src/components/methodology/districtLedgerContent.ts, section how-open-categories-are-predicted: insert ONE new paragraph directly after the paragraph that begins "A category that is already settled shows the points the team earned". Suggested text, flat third person, no digits, no hyphen or dash characters of any kind: A team registered for an event but absent from its published match schedule earns no qualification, alliance selection or playoff points there, and its event total is its award prediction alone. Do not touch the limitations list (it is pinned by equality). No string in districtLedgerCopy.ts changes, because no rendered label changes: the grey zero cells and the open Awards cell use the existing renderers, so no UI component and no sketch rule is involved.

3. Regression triage. Run the full verify command. Any pre existing test that now fails must be read before it is edited. A failure is LEGITIMATE only when its fixture has a district artifact team registered for a started event whose event artifact carries qual rows while that team is on none of them, and the assertion pinned the old unavailable cell or the walk forward estimate for that team; update those assertions to the award only reading with a one line comment naming this task. Any other failure is a regression in Tasks 1 or 2: fix the source, never the test. List every edited test and why in the SUMMARY; add each edited file to the commit by explicit path.

4. Typecheck both halves: the root project (npx tsc --noEmit from the repo root) and the web project (npx tsc --noEmit -p apps/web/tsconfig.json), because the root run misses apps/web. Both must print no errors. scripts/measureChampCutoff.ts and scripts/measureLedgerTenets.ts call the browser builders; they must still compile, and they are NOT re run in this task (the published 16.4 and 49 of 69 figures stay as measured; note in the SUMMARY that a future re run will price no shows award only).

5. Stage and commit by explicit path only, never git add -A or git add ., because other sessions share this checkout. Do not touch apps/worker/src/artifactMerge.ts, apps/worker/src/scheduled.ts or anything else under apps/worker/. No publish, no deploy, no push.
  </action>
  <verify>
    <automated>npx vitest run packages/core/districts packages/harness/districtBake.test.ts apps/web/src/components/districts apps/web/src/workers apps/web/src/components/methodology apps/web/src/routes/methodology.district-points.test.tsx && npx tsc --noEmit && npx tsc --noEmit -p apps/web/tsconfig.json</automated>
  </verify>
  <done>Every test under the listed paths passes when read from vitest's own output (not from an exit code alone), both typechecks print no errors, the protocol bound and the methodology paragraph are in, every edited pre existing test is justified in the SUMMARY, and nothing under apps/worker/ appears in git diff for this task's commits.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TBA registrations to district artifact | Third party team lists; parsed by DistrictArtifactSchema at fetch, now also decide the award only list |
| main thread to district simulation Web Worker | postMessage payload carrying the new awardOnlyTeams member, shape checked by isEventRequest |
| row stage to guarantee math | reservedSlotsAtPosition and pooledLockInputs read row.stage first row wins as an event level fact |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-vmb-01 | Denial of service | districtSimulationProtocol.ts isEventRequest | low | mitigate | Reject a non array awardOnlyTeams and any request whose baselines plus award only teams exceed MAX_DISTRICT_SIMULATION_ROSTER (Task 3 tests) |
| T-vmb-02 | Tampering (integrity of a published guarantee) | buildDistrictLedgerRows row.stage | high | mitigate | The no show's row.stage is never overridden per team, so the pooled lock pool and the Impact reservation cannot shrink; pinned by the row.stage equality test in Task 2 |
| T-vmb-03 | Tampering (silent wrong pricing) | simulateDistrictEvent award only validation | medium | mitigate | InvalidAwardOnlyTeamsError for empty, duplicate or roster overlapping keys before any draw; the existing catch turns it into a per event unavailable entry rather than a plausible wrong row |
| T-vmb-04 | Tampering (published output drift) | packages/harness/districtBake.ts via the shared core | medium | mitigate | Absent and empty list deep equality pin plus districtBake.test.ts unedited; the bake never passes the member |
| T-vmb-05 | Information disclosure | none | low | accept | No secret, credential or personal data is read or rendered; .env is never touched |
</threat_model>

<verification>
- npx vitest run packages/core/districts packages/harness/districtBake.test.ts apps/web/src/components/districts apps/web/src/workers apps/web/src/components/methodology apps/web/src/routes/methodology.district-points.test.tsx passes, read from the printed summary line (never through timeout pnpm).
- npx tsc --noEmit and npx tsc --noEmit -p apps/web/tsconfig.json both clean.
- git diff of this task's commits touches no file under apps/worker/.
- The absent versus empty award only list deep equality pin and the before the schedule posts input pin both pass.
</verification>

<success_criteria>
- A registered DCMP no show at a started DCMP shows the event's own row on Champ Locks: grey 0 in Qualification, Alliance selection and Playoffs, an open Awards cell, a Subtotal equal to its award distribution, win chance 0, and that distribution in the champ chance run's DCMP part.
- The same holds for a registered no show at a started district event on District Locks, priced at district tier ceilings.
- Floors, ceilings, the reservation and the pooled lock read unchanged event facts; In range and Out of range follow the new projection.
- Nothing changes before a schedule posts or at a fully scheduled event; the publisher bake is untouched.
</success_criteria>

<output>
Create `.planning/quick/260927-vmb-price-a-registered-dcmp-no-show-from-awa/260927-vmb-SUMMARY.md` when done (if the Write tool is blocked for a subagent, return the SUMMARY text to the orchestrator instead of routing around the block through Bash).
</output>
