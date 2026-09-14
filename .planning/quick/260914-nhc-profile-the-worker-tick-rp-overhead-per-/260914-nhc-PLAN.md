---
phase: quick-260914-nhc
plan: 01
quick_id: 260914-nhc
type: execute
wave: 1
depends_on: []
serves_todo: rp-fold-exceeds-worker-cpu-budget
files_modified:
  - apps/worker/src/stateProbe.ts
  - apps/worker/test/stateProbe.test.ts
  - docs/worker-operations.md
  - .planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/arms.mjs
  - .planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/measure-arms.mjs
  - .planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/analyze-arms.mjs
autonomous: true
requirements:
  - rp-fold-exceeds-worker-cpu-budget

estimate:
  tokens: 55000
  raw_tokens: 110000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "The probe's Phase A performs every call the live tick's processEvent Phase A performs (at HEAD, SPR-only live tier), and a test fails if the tick gains a call the probe does not mirror"
    - "rp=1 / rp=0 / absent rp / unrecognized rp behave exactly as before, and every previously pinned value (rpPmfsProduced 7, bandsProduced 14, Group 6 mean-shift counters) still passes unmodified"
    - "rpSkip ablates exactly the named RP components; each of the nine measurement arms has its full counter vector pinned by EQUALITY, bandsProduced is identical across all nine, and every arm issues zero D1 writes"
    - "An unknown rpSkip token skips NOTHING and says so in warnings; every response echoes params.rpArm.id and params.rpArm.ran, so a typo cannot measure the wrong arm"
    - "A driver and an analyzer exist that round-robin the nine arms against the deployed probe, join wrangler tail cpuTime to each request by seq, and print n/p50/p75/p90/max/mean/% over 10 ms per arm plus the named component differences with a standard error"
  artifacts:
    - path: apps/worker/src/stateProbe.ts
      provides: "Re-mirrored Phase A plus the rpSkip component flag, the rpArm echo and three new counters"
    - path: apps/worker/test/stateProbe.test.ts
      provides: "Group 7 (Phase A mirror guard) and Group 8 (component arms, equality-pinned)"
    - path: .planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/analyze-arms.mjs
      provides: "Tail/driver join, per-arm statistics, named differences, invariants, --self-test"
  key_links:
    - from: apps/worker/src/stateProbe.ts runSprFold
      to: apps/worker/src/scheduled.ts processEvent Phase A (lines ~833-1020)
      via: "Group 7 call-name mirror test with a four-name tick-only allowlist"
    - from: "probe response params.rpArm.id"
      to: "measure/arms.mjs expectedId"
      via: "driver aborts after warm-up on any mismatch"
    - from: "wrangler tail event.request.url seq param"
      to: "driver.jsonl seq"
      via: "analyze-arms.mjs join; unmatched or non-ok events are counted and reported, never silently dropped"
---

<objective>
Split the probe's single `rp` ablation flag into independently switchable RP components, so the
7 ms p50 RP overhead measured on 2026-09-12 (13 ms on vs 6 ms off) can be attributed to a
component, and a later change can remove that component's cost while keeping output byte-identical.

Purpose: the Node micro-benchmark puts `analyticRpPmf` at 4.6 µs/call warm, but the Workers ablation
implies ~160 µs per pmf. Something other than the formula may be expensive. Only per-component
ablation measured with `wrangler tail` `cpuTime` can settle that, because in-Worker timers do not
advance during CPU execution.

Output: a re-mirrored probe with an `rpSkip` flag and pinned tests (executor). Driver and analyzer
scripts (executor). A measurement against live D1 and a dated results section in the todo
(orchestrator, main context only).

Tracer-first is deliberately not used. The instrument's architecture (probe arm flag, then tail
`cpuTime`, then interleaved arms) was already proven end-to-end by 260912-iur. The user also ordered
the re-mirror to come first, and that is a prerequisite rather than a slice.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md
@apps/worker/src/stateProbe.ts
@apps/worker/test/stateProbe.test.ts

Read with offset/limit, not whole:
- `apps/worker/src/scheduled.ts` lines 747-1038 (`processEvent`). Phase A is the
  `for (const [algorithmId, algorithm] of algorithmModules) {` loop at ~833 through
  `perAlgorithm.set(algorithmId, ...)` at ~1019. Landmarks: `readRpBeliefs` :872,
  `RpMomentsAccumulator.fromBeliefs` :873, `RpMeanShiftAccumulator.fromState` :877, `rpFieldsFor`
  :884, `foldObservedRp` :934, folded loop :952, upcoming loop :985, `touchedMetrics`/`touchedSigma`
  :997-1003, `withRpBeliefs` :1008, `withRpMeanShift` :1010.
- `packages/core/rankingPoints/empiricalMoments.ts` 78-196 (`momentsFor`, `fromBeliefs`, `hasHistory`).
- `packages/core/rankingPoints/meanShift.ts` 55-181 (`rosterIsFullyWarm`, `observeMatch`, `apply`,
  `fromState`; `RP_MEAN_SHIFT_WARMUP_OBSERVATIONS` is 200).
- `packages/harness/stateSnapshot.ts` 582-670 (`readRpBeliefs`, `withRpBeliefs`, `readRpMeanShift`,
  `withRpMeanShift`). Each one JSON-parses, and the `with*` helpers also re-stringify, every row they
  touch.
- `docs/worker-operations.md` lines 577-670 ("Pre-event probe" runbook and its param table).

Facts established while planning (2026-09-14, HEAD af689c04):
- `npx vitest run apps/worker/test/stateProbe.test.ts` from the repo root passes 36/36.
- `npx tsc --noEmit -p apps/worker/tsconfig.json` prints NOTHING at HEAD, so the old URL-type error
  is gone. Any error after this task is new and must be fixed, not waived.
- The probe already mirrors the shape-16 mean shift (98c5bfa4) and contains no Swing or VPR code.
  It is still NOT in line with the tick at HEAD. Differences found:
  1. The tick computes a published Match Band per match with `displayBandFor`
     (`sigmaMatchBandVariance`) in both loops, into `newBands`/`upcomingBands` Maps. The probe does not.
  2. The tick stores `{ ...prediction, ...rpFieldsFor(...) }` into `newPredictions` /
     `upcomingPredictions` Maps. The probe calls `rpFieldsFor` and discards the result.
  3. The tick gates the rule module with `publishesRankingPoints(algorithmId)`. The probe indexes
     `RP_RULE_MODULES` directly.
  4. After the upcoming loop, the tick computes `touchedMetrics = algorithm.teamMetrics(state, touchedTeams)`
     and a `touchedSigma` Map via `sigma.sigmaFor` over `realTouchedTeams`. The probe does neither.
  5. The tick names the variance accessor `winOddsVarianceFor`; the probe calls it `bandFor`.
  6. Intentional, keep as is: the probe loads all `teamCount` teams (so every roster is fully
     resumed, pricing the correct-implementation tick per the todo) and deserializes opr and epa
     too. Both are constant offsets shared by every arm.

Concurrency: another session is running quick task 260914-ndu (ALGO-05) in this checkout. Stage by
explicit path only (`git add -- <paths>`), never `git add -A` or `git add .`. Before each commit,
run `git status --porcelain -- apps/worker docs .planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-`
and confirm every listed change is yours. If a file in this plan carries changes you did not make,
stop and report. Retry once on `index.lock`. No push. Never read, cat or echo `.env`: nothing in this
plan needs a secret. Do not write SUMMARY.md; return its text in your final message and the
orchestrator writes it.

Test and typecheck commands, always from the repo root. Read the OUTPUT (the `Tests N passed` line),
never just the exit code:
- `npx vitest run apps/worker/test/stateProbe.test.ts`
- `npx tsc --noEmit -p apps/worker/tsconfig.json`
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Re-mirror the probe's Phase A to processEvent at HEAD, and guard the mirror by test</name>
  <files>apps/worker/src/stateProbe.ts, apps/worker/test/stateProbe.test.ts</files>
  <precondition>At HEAD, before editing, `npx vitest run apps/worker/test/stateProbe.test.ts` reports 36 passed and `npx tsc --noEmit -p apps/worker/tsconfig.json` prints nothing.</precondition>
  <read_first>apps/worker/src/scheduled.ts lines 747-1038; apps/worker/src/stateProbe.ts runSprFold (lines 409-629); apps/worker/test/stateProbe.test.ts Groups 1, 5 and 6</read_first>
  <behavior>
    - Group 7 test A: the Phase A region is extracted from scheduled.ts, starting at the `for (const [algorithmId, algorithm] of algorithmModules) {` marker and ending before `perAlgorithm.set(algorithmId`. If either marker is missing, the test throws with a message naming the missing marker, so a refactor fails loudly instead of extracting nothing.
    - Group 7 test B (positive control): the extracted call-name set has at least 25 names and includes analyticRpPmf, withRpBeliefs, sigmaMatchBandVariance, publishesRankingPoints, teamMetrics and sigmaFor.
    - Group 7 test C: every extracted call name, minus JS keywords and a TICK_ONLY allowlist of exactly selectionsFor, loadOrInitState, consume and writeScopedState, appears as `name(` in the comment-stripped probe source. Each missing name is reported by name.
    - Existing Groups 1-6 pass with NO edits to their expectations. The re-mirror adds tick skeleton work, not RP semantics.
  </behavior>
  <action>
Write the Group 7 tests first. Confirm test C fails against the current probe, naming at least
sigmaMatchBandVariance, publishesRankingPoints, sigmaFor, displayBandFor and winOddsVarianceFor. Then
re-mirror `runSprFold` so it passes.

Group 7, in stateProbe.test.ts:
- Reuse the file's existing `stripComments` helper on both sources.
- Extract call names from the Phase A region with a global regex for an identifier immediately
  followed by optional whitespace and an opening parenthesis.
- Drop the keywords if, for, while, switch, catch, return, typeof and function.
- Put a one-line comment on each of the four TICK_ONLY allowlist entries:
  - selectionsFor: the probe's copy is probeSelectionsFor, pinned equal by Group 2.
  - loadOrInitState: the probe calls readScopedState plus deserializeState, and deliberately never
    takes the initState cold path.
  - consume: subrequest budget bookkeeping that the probe does not have.
  - writeScopedState: forbidden in the probe, and Group 1 bans it.
- Do not add any other allowlist entry. If a new name seems to need one, stop and report it instead.
  Group 7 may import nothing from scheduled.ts beyond what Group 2 already imports. It reads
  scheduled.ts as text.

Re-mirror in stateProbe.ts, changing only runSprFold's skeleton (items 1-5 in the context):
- Rename bandFor to winOddsVarianceFor.
- Add a displayBandFor closure identical in logic to the tick's. It uses sigmaMatchBandVariance from
  packages/harness/sigmaScore.js; add it to the existing sigmaScore import alongside
  publishesRankingPoints.
- In both loops, build the band via displayBandFor into newBands/upcomingBands Maps.
- In both loops, store `{ ...prediction, ...fields }` into newPredictions/upcomingPredictions Maps.
  Count rpPmfsProduced from the fields exactly as today.
- Gate rpRuleModule with publishesRankingPoints("spr") ahead of the indexed RP_RULE_MODULES lookup,
  keeping the existing rp gate.
- Before the fold, derive touchedTeams the way the tick does: the sorted unique teams of the folded
  synthetic matches. Derive realTouchedTeams by filtering with isDemoTeamKey from
  packages/core/algorithms/demoTeams.js.
- After the upcoming loop and before serializeState, compute touchedMetrics via spr.teamMetrics over
  touchedTeams, and a touchedSigma Map via sigma.sigmaFor over realTouchedTeams when sigma exists.
  Both results are discarded, since the probe writes nothing.
- The tick calls readRpBeliefs and builds the rpKnownTeams Set unconditionally. Keep both inside the
  probe's rp gate, because removing RP would remove them. Say so in the runSprFold doc comment's
  ablation list.
- Update that doc comment so its lists match the new skeleton. Keep it short, per the repo's
  comment-trimming passes.

Never import scheduled.ts or any write helper into the probe; Group 1 enforces this. Do not change
scheduled.ts. Run the vitest and tsc commands, read the output, then commit only the two files as
`refactor(260914-nhc): re-mirror state probe Phase A to the post-teardown tick` with the
Co-Authored-By trailer.
  </action>
  <verify>
    <automated>npx vitest run apps/worker/test/stateProbe.test.ts (output shows all tests passed, count above 36, Group 7 present) AND npx tsc --noEmit -p apps/worker/tsconfig.json prints nothing</automated>
  </verify>
  <done>Group 7 is green, with its failure against the pre-change probe observed first. Groups 1-6 are green with unmodified expectations. tsc is clean. There is one commit touching exactly stateProbe.ts and stateProbe.test.ts.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Per-component RP arms (rpSkip), echoed and equality-pinned for all nine measurement arms</name>
  <files>apps/worker/src/stateProbe.ts, apps/worker/test/stateProbe.test.ts, docs/worker-operations.md</files>
  <read_first>apps/worker/src/stateProbe.ts after Task 1 (parseParams, runSprFold, buildWarnings, runProbe); apps/worker/test/stateProbe.test.ts Groups 5-6 (runArm, runShiftArm, SEEDED_SHIFT, ARM_QUERY)</read_first>
  <behavior>
    Group 8 uses the Group 6 fixture with SEEDED_SHIFT, so the mean shift's apply is observable, and ARM_QUERY (folded=2, upcoming=5, season=2026). V is the 2026 variable count. Expected counters: resumed = rpBeliefTeamsResumed, gates = rpGatesOpened, pmfs = rpPmfsProduced, shifted = rpMeanShiftedAlliances, obsFolds = rpObservedFolds, shiftObs = rpMeanShiftObservations, attached = rpBeliefTeamsAttached, shiftAtt = rpMeanShiftAttached.
    - all (rp=1): id "all"; resumed 21, gates 7, pmfs 7, shifted 14, obsFolds 4, shiftObs 4V, attached 21, shiftAtt true; warnings [].
    - none (rp=0): id "none"; every RP counter 0 or false.
    - resumeOnly (rpSkip=foldedPmf,upcomingPmf,observe,beliefs): id "skip:foldedPmf,upcomingPmf,observe,beliefs"; resumed 21, every other RP counter 0 or false.
    - skipFoldedPmf: id "skip:foldedPmf"; resumed 21, gates 5, pmfs 5, shifted 10, obsFolds 4, shiftObs 4V, attached 21, shiftAtt true.
    - skipUpcomingPmf: id "skip:upcomingPmf"; resumed 21, gates 2, pmfs 2, shifted 4, obsFolds 4, shiftObs 4V, attached 21, shiftAtt true.
    - skipBothPmf (rpSkip=foldedPmf,upcomingPmf): id "skip:foldedPmf,upcomingPmf"; resumed 21, gates 0, pmfs 0, shifted 0, obsFolds 4, shiftObs 4V, attached 21, shiftAtt true.
    - skipFormula: id "skip:formula"; resumed 21, gates 7, pmfs 0, shifted 14, obsFolds 4, shiftObs 4V, attached 21, shiftAtt true.
    - skipObserve: id "skip:observe"; resumed 21, gates 7, pmfs 7, shifted 14, obsFolds 0, shiftObs 0, attached 21, shiftAtt true.
    - skipBeliefs: id "skip:beliefs"; resumed 21, gates 7, pmfs 7, shifted 14, obsFolds 4, shiftObs 4V, attached 0, shiftAtt false.
    - Every arm: matchesFolded 2, upcomingPriced 5, bandsProduced 14 (equality to the literal AND to the all arm), fold.error undefined, status 200, zero D1 writes.
    - changedRowsDiscarded: arms with beliefs ON equal the all arm's value. Arms with beliefs OFF (none, resumeOnly, skipBeliefs) equal the rp=0 arm's value.
    - Every partial arm has exactly one warning, containing the uppercase substring "ABLATED ARM" and the quoted arm id. none via rp=0 keeps its existing single warning.
    - rpSkip=resume: id "none", the fold object deep-equals rp=0's, and one warning explains that resume's dependents were forced off.
    - rpSkip=upcomingPmf,obsrve (unknown token): id "all", counters deep-equal the all arm's, exactly one warning naming "obsrve" and containing "NO component was skipped", with no "ABLATED ARM" substring.
    - rpSkip=UPCOMINGPMF resolves to "skip:upcomingPmf". An empty rpSkip= is byte-identical to the all arm.
    - rp=0&rpSkip=beliefs: id "none", two warnings. The first is the existing rp=0 warning. The second says rpSkip was ignored and does not contain "ABLATED ARM".
    - params.rpArm.ran for each arm matches the component booleans described in the action. params.rp equals ran.resume.
  </behavior>
  <action>
Write Group 8 first, and see it fail. Then implement.

Components. The canonical order is resume, foldedPmf, upcomingPmf, formula, observe, beliefs. Each
maps onto the tick's RP operations as follows:

- resume: readRpBeliefs, RpMomentsAccumulator.fromBeliefs, the rpKnownTeams Set, readRpMeanShift and
  RpMeanShiftAccumulator.fromState.
- foldedPmf: the rpFieldsFor call in the folded loop. When skipped, the loop still stores
  `{ ...prediction }` in newPredictions, so only rpFieldsFor's own work disappears.
- upcomingPmf: the same, for the upcoming loop.
- formula: inside rpFieldsFor, everything from the analyticRpPmf call onward (the call, the
  decomposition object and the returned fields). The gates, momentsFor x2, rosterIsFullyWarm x2 and
  the mean shift apply x2 still run, and the closure returns an empty object.
- observe: both rpMeanShift observeMatch and foldObservedRp in the folded loop.
- beliefs: withRpBeliefs, including its beliefsByTeam deep copy, and withRpMeanShift, including its
  toState.

Dependencies. Without resume, every other component is off. formula is moot when both pmf loops are
skipped, so drop it from the id in that case.

Parsing. Add a new query param named exactly rpSkip. Split it on commas, trim each token, ignore
empty tokens, and match case-insensitively against the six names.
- All-or-nothing: if ANY token is unrecognized, skip NOTHING, and add one warning. The warning names
  every unknown token, lists the six valid names, and says NO component was skipped.
- rp=0 overrides rpSkip. Keep rp=0's existing warning, and when rpSkip is non-empty add a second
  warning saying it was ignored because rp=0 already turns every component off. It must not contain
  the uppercase arm label.
- An unrecognized rp value keeps its existing behaviour and warning, and a valid rpSkip still applies.
- Export a pure `resolveRpArm(rpRaw, rpSkipRaw)`. It returns `{ id, ran, warnings }`, where ran holds
  the six booleans that actually ran.
- id rules:
  - "all" when nothing is skipped.
  - "none" when resume did not run.
  - Otherwise "skip:" followed by the skipped names in canonical order, joined by commas.
- ran.formula is resume AND (ran.foldedPmf OR ran.upcomingPmf) AND formula not skipped.
- Partial-arm warning format: rpSkip=RAW, then an em dash, then PARTIALLY ABLATED ARM with the quoted
  id, then which components were skipped and which ran, then a note to compare cpuTime against an
  otherwise-identical rp=1 run. For rpSkip=resume, the warning uses the same ABLATED ARM wording and
  says the dependents were forced off.

runSprFold takes the ran object in place of rpEnabled, and each operation checks its own boolean.

Counters (FoldResult, and every zero-filled FoldResult literal in the file):
- rpBeliefTeamsResumed: the resumed belief map's size, or 0.
- rpGatesOpened: incremented inside rpFieldsFor once every gate has passed, before momentsFor.
- rpBeliefTeamsAttached: the size of the beliefsByTeam map passed to withRpBeliefs, or 0.
- rpMeanShiftAttached: whether withRpMeanShift ran.
These are increments and size reads only. Add no work to the measured path beyond that.

Response and warnings:
- Add params.rpArm (`{ id, ran }`) and keep params.rp, now equal to ran.resume.
- buildWarnings takes the arm resolution. The "every RP pmf was suppressed" warning now fires only
  when ran.resume holds, at least one unskipped pmf loop had matches to price
  ((ran.foldedPmf and folded > 0) or (ran.upcomingPmf and upcoming > 0)), and rpGatesOpened is 0.
  In the all arm this is identical to today's condition, because gates opened equals pmfs produced
  there.
- Update the file header's ARMS paragraph to name rpSkip and point at the runbook.

Tests:
- Group 5 and Group 6 expectations stay untouched and must still pass. Absent rp stays byte-identical
  to rp=1, because both carry the same new fields.
- Pin every Group 8 expectation with toBe or toEqual, never a greater-than or less-than comparison.
- If an observed value disagrees with the behavior table, do not edit the expectation to match.
  First explain the difference from the code. Only a difference caused by the skipped component
  itself may be pinned, with a one-line comment naming that cause. Report every such case.

docs/worker-operations.md: add two rows to the Pre-event probe param table.
- rp: default on; 0/off/false/no turns every RP component off; an unrecognized value runs on and
  warns.
- rpSkip: default empty; a comma-separated list from the six names, each with its one-line meaning;
  unknown names skip nothing and warn; read params.rpArm.id before trusting a cpuTime. State that the
  param name is case-sensitive while the values are not.

Run the vitest and tsc commands and read the output. Commit only the three files as
`feat(260914-nhc): per-component RP ablation arms in the state probe` with the trailer.
  </action>
  <verify>
    <automated>npx vitest run apps/worker/test/stateProbe.test.ts (all passed; Group 8 present with one test per arm plus the resume, unknown-token, case, empty and rp=0-override tests) AND npx tsc --noEmit -p apps/worker/tsconfig.json prints nothing AND grep -c "rpSkip" docs/worker-operations.md is at least 1</automated>
  </verify>
  <done>All nine arms' counter vectors are pinned by equality. bandsProduced is 14 in every arm. D1 writes are 0 in every arm. The echo and warning rules are pinned. Groups 1-7 are unmodified and green. tsc is clean. There is one commit touching exactly the three files.</done>
</task>

<task type="auto">
  <name>Task 3: Measurement driver and analyzer (offline self-test only; no network from the executor)</name>
  <files>.planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/arms.mjs, .planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/measure-arms.mjs, .planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/analyze-arms.mjs</files>
  <read_first>apps/worker/src/stateProbe.ts after Task 2 (resolveRpArm id rules, response shape, warning labels)</read_first>
  <action>
Write plain Node ESM with no dependencies, using only native fetch, node:fs, node:path and node:url.
The executor must NOT run the driver against any URL. The subagent sandbox has no network, and the
measurement belongs to the orchestrator.

**arms.mjs** exports three things.

- ARMS, in this order. Each entry carries name, query fragment and expectedId:

  | name | query fragment | expectedId |
  |---|---|---|
  | all | rp=1 | all |
  | none | rp=0 | none |
  | resumeOnly | rpSkip=foldedPmf,upcomingPmf,observe,beliefs | skip:foldedPmf,upcomingPmf,observe,beliefs |
  | skipFoldedPmf | rpSkip=foldedPmf | skip:foldedPmf |
  | skipUpcomingPmf | rpSkip=upcomingPmf | skip:upcomingPmf |
  | skipBothPmf | rpSkip=foldedPmf,upcomingPmf | skip:foldedPmf,upcomingPmf |
  | skipFormula | rpSkip=formula | skip:formula |
  | skipObserve | rpSkip=observe | skip:observe |
  | skipBeliefs | rpSkip=beliefs | skip:beliefs |

- COMMON_QUERY: season=2026&teamCount=21&folded=2&upcoming=60.
- DIFFERENCES, each as label, minuend arm, subtrahend arm and meaning:

  | label | minuend minus subtrahend | meaning |
  |---|---|---|
  | total | all minus none | every RP component |
  | resume | resumeOnly minus none | belief and mean-shift resume |
  | foldedPmf | all minus skipFoldedPmf | rpFieldsFor on 2 folded matches, expected below resolution |
  | upcomingPmf | all minus skipUpcomingPmf | rpFieldsFor on 60 upcoming matches |
  | bothPmf | all minus skipBothPmf | rpFieldsFor, both loops |
  | formula | all minus skipFormula | analyticRpPmf plus field construction, both loops |
  | wrapper | skipFormula minus skipBothPmf | gates, momentsFor, rosterIsFullyWarm and apply, both loops |
  | observe | all minus skipObserve | foldObservedRp plus observeMatch |
  | beliefs | all minus skipBeliefs | withRpBeliefs plus withRpMeanShift |

**measure-arms.mjs** is the CLI driver. Guard main execution so importing the file does nothing.

Flags:
- --base, default https://sigmascout-state-probe.jrw4561.workers.dev
- --rounds, default 60
- --warmup, default 2
- --arms, a comma list of arm names, default all nine; an unknown name exits 1
- --delay-ms, default 200
- --out, required; a directory, created if missing
- --dry-run, which prints the full ordered URL list and exits without fetching

Behaviour:
- A global seq counter runs across the whole run. Round r visits the selected arms rotated by r, so
  no arm always runs first.
- Each URL is base, then COMMON_QUERY, then the arm fragment, then seq=N and arm=NAME. The probe
  ignores the last two.
- Fetch sequentially with a 30 s AbortSignal timeout, and append one line per request to
  OUT/driver.jsonl. Each line holds: seq, round, warmup flag, arm, expectedId, status, echoedId
  (params.rpArm.id), body ok, the whole fold object, params.teams length, each algorithm's id, ok and
  snapshotShapeVersionObserved, shapeVersionExpected, and the warnings array. Also record any fetch
  error message.
- Never log headers.
- Warm-up gate, after the warm-up rounds:
  - Abort with exit 2 and a clear message if any warm-up response has a non-200 status, a false ok,
    an echoedId that differs from expectedId, or an algorithm with ok false.
  - Also abort if the non-arm warnings differ between arms. A warning is an arm label when it
    contains the case-sensitive substring ABLATED ARM. Every arm must carry the same set of non-arm
    warnings, and each arm other than all must carry exactly one arm-label warning.
  - Print the shared non-arm warnings, which may be empty, so the operator reads them.
- Print one progress line per round, and the literal line DRIVER DONE at the end.

**analyze-arms.mjs** is the CLI analyzer. It takes --tail FILE, --driver FILE, an optional
--json-out FILE, and --self-test.

Tail parsing:
- Parse the wrangler tail output as a stream of concatenated JSON values. Scan characters while
  tracking brace depth, string state and escapes, so pretty-printed multi-line objects and one
  object per line both parse. Ignore text outside objects.
- Each event's seq comes from the seq search param of event.request.url. Its cpuTime comes from the
  top-level cpuTime field. If the first event has no numeric cpuTime, exit 1 and print that event's
  top-level key names, never its values.

Join and filtering:
- Keep a sample only if it is not warm-up, the driver status is 200, ok is true, echoedId equals
  expectedId, and the tail outcome is "ok".
- Count and report per arm: missing tail events, non-ok outcomes by outcome name (exceededCpu is a
  finding, not noise), and id mismatches.

Output:
- Per-arm table: n, then p50, p75 and p90 by the nearest-rank method, max, mean to one decimal place,
  and % of samples over 10 ms.
- Differences table: mean difference, its standard error (the square root of each arm's sample
  variance over its n, summed), the p50 difference, and "resolved" when the absolute mean difference
  is at least 2 SE.
- Closure line: total minus (resume + bothPmf + observe + beliefs), labelled as a non-additivity
  residual to report, never to force to zero.
- Per-pmf line: upcomingPmf's mean difference divided by the upcoming gates. Upcoming gates are the
  all arm's rpGatesOpened minus skipUpcomingPmf's.
- Formula per-gate line: formula's mean difference divided by the all arm's rpGatesOpened. Print
  both in µs, next to the Node warm reference of 4.6 µs.

Invariants, each printed as PASS or FAIL:
- bandsProduced, matchesFolded and upcomingPriced are identical across every sample of every arm. On
  a FAIL, print ARMS NOT COMPARABLE and exit 3 after printing the tables.
- Every arm's fold counter vector is constant across its own samples. List any deviating seqs.
- rpGatesOpened is additive: skipFoldedPmf plus skipUpcomingPmf equals all.
- rpPmfsProduced for skipObserve and skipBeliefs equals the all arm's.

Emit only aggregates, never request headers or cf fields. --json-out writes the same aggregates.

--self-test builds synthetic data in memory:
- Three arms with a handful of rounds each.
- Tail events written in both pretty-printed and compact form into one string, including a string
  value that contains braces and escaped quotes.
- One exceededCpu event, one driver record with a mismatched echoedId, and one seq with no tail event.
- It runs the same parse, join and stats functions and asserts the exact n, p50, mean, % over 10 ms,
  exclusion counts and a resolved/unresolved difference. On success it prints SELF-TEST PASSED; on
  any failure it exits non-zero.

Run `node <quick dir>/measure/analyze-arms.mjs --self-test` and `node <quick dir>/measure/measure-arms.mjs --dry-run --out <scratchpad>/nhc-dry --rounds 2 --warmup 1`, and read both outputs. The dry run should list 27 URLs whose arm order rotates. Commit only the three files as `chore(260914-nhc): probe arm measurement driver and analyzer` with the trailer. Writing inside this quick directory is permitted; write nothing else under `.planning/`.
  </action>
  <verify>
    <automated>node .planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/analyze-arms.mjs --self-test prints SELF-TEST PASSED; node .planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/measure-arms.mjs --dry-run --rounds 2 --warmup 1 --out SCRATCH/nhc-dry prints 27 URLs, each carrying seq and arm, with rotating order, and performs no fetch</automated>
  </verify>
  <done>Self-test passes. The dry run lists correctly rotated URLs. No network was used. There is one commit touching exactly the three measure files.</done>
</task>

</tasks>

## ORCHESTRATOR-RUN MEASUREMENT (main context only; the executor does none of this)

Subagent sandboxes deny all network Bash, and the auto-mode classifier has previously denied
`wrangler tail`. If any step below is denied, do not route around it. Stop and hand Jacob the exact
commands. `SCRATCH` is this session's scratchpad directory, and `Q` is
`.planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-`.

**M0 — Preconditions.**
- The three executor commits are on main. `git status --porcelain -- apps/worker packages` is empty,
  because wrangler bundles the working tree, not HEAD. Another session's untracked `.planning` files
  are fine.
- Record `git rev-parse HEAD`.
- If apps/worker or packages is dirty with foreign edits, deploy from a clean detached worktree at
  the verified SHA. Install with `--ignore-scripts`, then run `npx wrangler deploy --dry-run` and
  grep the bundle for `rpSkip` before the real deploy.
- No push is needed.

**M1 — Deploy the probe** (it has no cron, no R2 and no KV):

```bash
cd apps/worker && npx wrangler deploy --config wrangler.probe.toml
```

Record the version id. Confirm the deploy output lists only the `DB` D1 binding. Send one smoke
request by hand:
`https://sigmascout-state-probe.jrw4561.workers.dev/?season=2026&teamCount=21&folded=2&upcoming=60&rpSkip=formula`.
Check four things:
- `params.rpArm.id` is `skip:formula`.
- Every `algorithms[].ok` is true, with `snapshotShapeVersionObserved === shapeVersionExpected`.
- `rpGatesOpened > 0`.
- `rpPmfsProduced === 0`.

**M2 — Start the tail detached.** Record its PID, and never pattern-kill wrangler processes.

```powershell
New-Item -ItemType Directory -Force "$SCRATCH\nhc" | Out-Null
$tail = Start-Process -FilePath cmd.exe -ArgumentList '/c','npx wrangler tail sigmascout-state-probe --format json' `
  -WorkingDirectory 'C:\Users\Jacob\Documents\GitHub\SigmaScout\apps\worker' -WindowStyle Hidden `
  -RedirectStandardOutput "$SCRATCH\nhc\tail.json" -RedirectStandardError "$SCRATCH\nhc\tail.err" -PassThru
$tail.Id
```

Wait until `tail.err` or `tail.json` shows the tail is connected, which takes about 10 s.

**M3 — Run the driver detached.** It makes 9 arms x 62 rounds = 558 requests, which takes roughly 5-10
minutes. Launch it with Start-Process, because Bash background jobs have died silently past ~6 min.
Watch it with a Monitor that checks both the log and whether the PID is still alive
(`tasklist //FI "PID eq N"`).

```powershell
$drv = Start-Process -FilePath node -ArgumentList "$Q\measure\measure-arms.mjs",'--rounds','60','--warmup','2','--out',"$SCRATCH\nhc" `
  -WorkingDirectory 'C:\Users\Jacob\Documents\GitHub\SigmaScout' -WindowStyle Hidden `
  -RedirectStandardOutput "$SCRATCH\nhc\driver.log" -RedirectStandardError "$SCRATCH\nhc\driver.err" -PassThru
```

Wait for `DRIVER DONE`. If it exits 2 at the warm-up gate, read the message. The arm-id rules or the
environment warnings disagree; fix that before measuring. Once the driver is done, wait 15 s for the
tail to flush, then run `taskkill /PID <tail PID> /T /F`, using that PID only.

**M4 — Analyze.**

```bash
node "$Q/measure/analyze-arms.mjs" --tail "$SCRATCH/nhc/tail.json" --driver "$SCRATCH/nhc/driver.jsonl" --json-out "$SCRATCH/nhc/results.json"
```

- Any invariant FAIL, especially `bandsProduced`, means the arms are not comparable. Discard the run
  and investigate. Do not record numbers.
- If a load-bearing difference is unresolved (under 2 SE), run one focused second pass on only the
  arms it needs, with more rounds. For example, `formula` vs `wrapper` needs
  `--arms all,skipFormula,skipBothPmf --rounds 150`, in a fresh `--out` directory with a fresh tail.
  Report both passes.
- Raw `tail.json` and `driver.jsonl` stay in SCRATCH and are NEVER committed, because tail events
  carry the client IP and request headers.

**M5 — Record.** Edit `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md` with Edit, not
Write, and add a section `## COMPONENT PROFILE — where the RP overhead goes (2026-09-14)` above
"DIRECTION CHOSEN". It contains:
- Provenance: probe version id, commit SHA, D1 generation and shape observed, `n` per arm, the
  interleaved round-robin with warm-up excluded, and nearest-rank percentiles.
- The per-arm table and the differences table (mean diff ± SE, p50 diff, resolved), plus the closure
  residual and the per-pmf and per-gate µs lines against the 4.6 µs Node reference.
- An invariants line: `bandsProduced` value identical across all arms, gates additivity PASS, and
  any non-ok outcomes by name.
- What changed since the 2026-09-12 13/6 ms figures, so absolute numbers are not misread as a
  regression: the re-mirror added display band, prediction Maps and touched metrics/Sigma to every
  arm; lattice marginals and the mean shift shipped 2026-09-14; the state is spr@4.0.0. Differences
  between arms are the finding; absolute levels are context.
- **What dominates**, ranked by resolved mean share of `total`.
- **What it does NOT say.** Unresolved components are "below resolution at n=…", never "free". Note
  that skipping `observe` slightly changes the moments later pmfs are priced from, so
  `observe`/`formula` interaction is second-order and unmeasured.
- **Implications for an output-identical cheaper tick**, one line per dominant component naming a
  lever that keeps published bytes identical. Ground each lever in the measured component, and do
  not implement anything. Possible levers:
  - If `formula` dominates: memoize or reuse pmfs for upcoming matches whose inputs did not change,
    which fits the chosen horizon-repricing direction.
  - If `wrapper` dominates: allocation-free `momentsFor`. The `variableNames` getter allocates a new
    array on every call, including inside `hasHistory`.
  - If `resume` or `beliefs` dominate: one JSON parse and one stringify per row, shared across every
    passenger helper, instead of one per helper.
- Update the todo's "Reproduce with" block to mention `rpSkip` and the measure scripts' path.
- Note that the probe is LEFT DEPLOYED at the new version.

Then write `Q/260914-nhc-SUMMARY.md` from the executor's returned text plus the M-step results. Then
append the quick-task row with the patched helper: `gsd-tools quick-tasks-append --task "<no pipes>"
--dir 260914-nhc-profile-the-worker-tick-rp-overhead-per- --commit <sha>`. Commit the todo, SUMMARY
and STATE by explicit paths.

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| public HTTP → probe Worker | Anyone can request the probe URL. The query string (rp, rpSkip, folded, upcoming) is untrusted input |
| probe Worker → live D1 | Read-write binding. Only tests stop a write |
| wrangler tail → local disk | Tail events carry request headers, client IP and cf geo data |
| working tree → deployed bundle | wrangler bundles uncommitted files, including another session's edits |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-nhc-01 | Tampering | stateProbe.ts D1 binding | high | mitigate | Group 1 import-graph and banned-identifier tests stay green. Group 8 asserts zero D1 writes in all nine arms plus the override/typo cases. Task 1's mirror allowlist keeps writeScopedState tick-only |
| T-nhc-02 | Repudiation | arm attribution of cpuTime | medium | mitigate | params.rpArm.id echo; all-or-nothing unknown-token rule; the driver aborts at warm-up on id mismatch; seq join from the tail URL; the analyzer excludes and counts mismatches |
| T-nhc-03 | Information Disclosure | raw tail.json / driver.jsonl | medium | mitigate | Raw files live only in the session scratchpad and are never staged. The analyzer and the todo record aggregates only; the analyzer prints key names, never values, when cpuTime is absent |
| T-nhc-04 | Information Disclosure | .env secrets | medium | mitigate | No step needs a secret: wrangler uses OAuth. The plan forbids reading or echoing .env |
| T-nhc-05 | Tampering | probe deploy bundle | medium | mitigate | M0 requires a clean `git status --porcelain -- apps/worker packages`, or a clean detached worktree at the verified SHA |
| T-nhc-06 | Denial of Service | public probe endpoint cost | low | accept | Existing folded+upcoming clamp of 200. rpSkip only removes work relative to the all arm. No cron. Free-tier D1 reads for ~600 requests are well under quota |
</threat_model>

<verification>
- `npx vitest run apps/worker/test/stateProbe.test.ts` from the repo root: all pass, Groups 1-8.
- `npx tsc --noEmit -p apps/worker/tsconfig.json`: no output.
- `git show --stat` for the three executor commits: each touches exactly its task's files.
  None of the three touches `apps/worker/src/scheduled.ts`. Check with `git log --format=%h -- apps/worker/src/scheduled.ts`
  against the three SHAs. Another session may legitimately commit scheduled.ts; if it does, Group 7
  flags any new call the probe has not mirrored.
- `node Q/measure/analyze-arms.mjs --self-test` prints SELF-TEST PASSED.
</verification>

<success_criteria>
- The probe mirrors the tick's Phase A at HEAD, and a test catches future drift by call name.
- rp's behaviour and every previously pinned value are unchanged.
- Nine arms are switchable via rpSkip, echoed, equality-pinned, and band-invariant.
- Driver and analyzer are ready for the orchestrator. After M1-M5, the todo carries a dated
  per-component profile saying which RP component dominates Workers CPU, and what that implies for an
  output-identical cheaper tick.
</success_criteria>

<output>
The executor returns its SUMMARY text in its final message and does not write SUMMARY.md. After M5,
the orchestrator writes `.planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/260914-nhc-SUMMARY.md`.
</output>
