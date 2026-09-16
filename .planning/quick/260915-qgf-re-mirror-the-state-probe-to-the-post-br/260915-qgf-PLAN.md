---
phase: quick-260915-qgf
plan: 01
quick_id: 260915-qgf
type: execute
wave: 1
depends_on: []
serves_todo: rp-fold-exceeds-worker-cpu-budget
files_modified:
  - apps/worker/src/artifactMerge.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/src/stateProbe.ts
  - apps/worker/test/stateProbe.test.ts
  - docs/worker-operations.md
  - .planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/measure/arms.mjs
  - .planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/measure/measure-arms.mjs
  - .planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/measure/analyze-arms.mjs
autonomous: true
requirements:
  - rp-fold-exceeds-worker-cpu-budget

estimate:
  tokens: 150000
  raw_tokens: 75000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The probe's Phase A mirror matches processEvent's Phase A AT HEAD: no upcoming pricing loop, the Phase A bonus-flag capture present, the changed rows retained for the block splice"
    - "A guard fails when the tick's Phase A call set changes in EITHER direction — a call added to the tick and absent from the probe, or a call the probe still makes that the tick no longer makes (the exact drift that produced this task)"
    - "A phaseB=1 arm emulates the tick's Phase B on the SAME functions the tick calls (not a copy): fetch a published artifact over public HTTPS, schema-parse it, run the real merge, splice the state block, stringify, discard — plus N per-team artifact merges"
    - "The probe still writes nothing: D1 is the only binding, every outbound request is a GET over https to the artifact origin, and both the static scan and a stubbed-fetch behavioral test hold it"
    - "phaseB is OFF by default and absent-phaseB responses are byte-identical to today's shape for the surviving RP arms, so RP arm comparisons stay internally valid"
    - "Retired components report NOT APPLICABLE at this tick shape rather than silently skipping nothing: rpSkip=upcomingPmf is recognized, changes no behavior, and says why"
    - "The analyzer splits every arm into fresh (isolateRequest=1) and reused (isolateRequest>1) isolates and reports the named differences on the reused stratum, which is the stratum the 2026-09-14 profile drew its component numbers from"
  artifacts:
    - path: apps/worker/src/artifactMerge.ts
      provides: "The Phase B merge path as a Worker-safe module with no write helper and no scheduled.ts in its import graph, imported by BOTH the tick and the probe"
    - path: apps/worker/src/stateProbe.ts
      provides: "Re-mirrored Phase A, the phaseB emulation arm, the retired-component reporting, the GET-only artifact fetch"
    - path: apps/worker/test/stateProbe.test.ts
      provides: "Bidirectional mirror guard, phaseB counters pinned by equality, GET-only fetch guard, unchanged no-write guarantees"
    - path: .planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/measure/analyze-arms.mjs
      provides: "Driver/tail join with the fresh/reused isolate split and the reused-stratum difference table"
  key_links:
    - "stateProbe.ts -> artifactMerge.ts (the real merge, shared with scheduled.ts) — a copy here would measure a fiction"
    - "artifactMerge.ts -/-> artifactWriter.ts and -/-> scheduled.ts (import-graph test) — the no-write property survives the extraction"
    - "analyze-arms.mjs -> isolateRequest=N in wrangler tail logs -> the reused-isolate stratum -> the only numbers comparable to 2026-09-14"
---

<objective>
Step 4 of the browser-pricing direction in `rp-fold-exceeds-worker-cpu-budget`: bring the read-only
state probe back into alignment with the tick at HEAD, extend it to price the artifact-merge work the
old probe never measured, and hand the orchestrator a measurement rig that can answer "did the
browser-pricing work actually buy the tick its budget back".

Purpose: the deployed probe (`28051f5c`) still mirrors the PRE-browser-pricing tick. It prices 60
upcoming matches the tick no longer prices, so its `all` arm over-states today's tick; and it has
never priced Phase B, which the same work made *bigger* (a `state` block of tens of KB now rides in
every live event artifact, parsed and spliced every tick). A measurement from it today would be wrong
in both directions at once.

Output: a re-mirrored probe with a new `phaseB` arm, a shared Worker-safe merge module, a rebuilt
measurement rig with the fresh/reused isolate split, and updated runbook docs. The deploy, the
measurement and the todo write-up are ORCHESTRATOR-RUN (see the section at the end) — the executor
has no network.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md
@apps/worker/src/stateProbe.ts
@apps/worker/src/scheduled.ts
@apps/worker/test/stateProbe.test.ts
@docs/worker-operations.md
</context>

<interface_context>

**The tick at HEAD, Phase A** (`scheduled.ts:982-1172`), which the probe must mirror:

- `selectionsFor` -> `loadOrInitState` -> `SigmaScoreAccumulator.fromBeliefs(readSigmaBeliefs, readSigmaPopulation)`
- `winOddsVarianceFor` / `displayBandFor` (`sigmaMatchBandVariance`)
- `rpRuleModule = publishesRankingPoints(id) ? RP_RULE_MODULES[season] : undefined`; `rpBeliefs = readRpBeliefs(rows)`;
  `rp = RpMomentsAccumulator.fromBeliefs`; `rpMeanShift = RpMeanShiftAccumulator.fromState(…, readRpMeanShift(rows))`;
  `rpKnownTeams = new Set(rpBeliefs.keys())`
- `rpFieldsFor` (partial-roster gate -> `analyticRpPmf` with `rpMeanShift.apply(rp.momentsFor(…), rosterIsFullyWarm(…))`)
- `observedBonusSides: Map<string, ParsedBonusSides>` — **NEW at HEAD**: `foldObservedRp` captures
  `parsed.bonusFlags` per side BEFORE `rp.fold`, then `observedBonusSides.set(matchKey, {red, blue})`
- the played loop only (`newlyFoldedResults`). **There is no upcoming loop.** Upcoming matches are
  priced in the browser from the artifact's `state` block (260915-isq).
- `touchedMetrics` / `touchedSigma`, then `serializeState` + `withRpBeliefs` + `withRpMeanShift` +
  `withSigmaPopulation(withSigmaBeliefs(…))`, then `selectChangedRows` -> `writeScopedState`
- `perAlgorithm.set(algorithmId, { …, writtenRows: changedRows, observedBonusSides })`

**The tick at HEAD, Phase B** (`scheduled.ts:1203-1295`), which the probe has never priced:

```
playedRowFactsFor(season, rawMatches, newlyFolded, newlyFoldedResults, observedBonusSides)
readExistingEvent  -> readArtifactObject -> LiveEventArtifactSchema.parse(JSON.parse(text))
mergeEventArtifact -> maintainedStateBlock -> spliceEventStateBlock(existing.state, writtenRows, touchedTeams)
                   -> buildEventScheduledRow x stillUpcoming, eventPlayedRow x newlyFolded, teams rebuild
writeArtifactObject (JSON.stringify)
  per touched team:
    readExistingTeam -> TeamSeasonArtifactSchema.parse(JSON.parse(text))
    mergeTeamSeasonArtifact -> teamSeasonPlayedRow, replaceOrAppendRows, metricHistory append
    writeArtifactObject (JSON.stringify)
```

**Signatures the probe will call after Task 1** (all exported from `apps/worker/src/artifactMerge.ts`
and re-exported from `scheduled.ts`):

- `playedRowFactsFor(season, rawMatches, folded, results, observedBonusSides) -> Map<string, PlayedRowFacts>`
- `mergeEventArtifact(params: MergeEventArtifactParams) -> unknown`
- `mergeTeamSeasonArtifact(params: MergeTeamSeasonArtifactParams) -> unknown`
- `touchedEventTeamMetrics(existing, incoming)`

**Artifact origin and keys:** `https://data.sigmascout.org` + `artifactKey(...)` from
`packages/harness/pageArtifacts.ts`:
- event: `v1/event/{eventKey}/{algorithmId}@{version}.json`
- team: `v1/team/{teamKey}/{year}/{algorithmId}@{version}.json`

**Block helpers** (`packages/harness/eventStatePricing.ts`): `buildEventStateBlock(rows, teamKeys)`,
`spliceEventStateBlock(block, writtenRows, touchedTeamKeys)`, `EventStateBlockError`. `spliceEventStateBlock`
throws when the block's `algorithmId`/`algorithmVersion`/`snapshotShapeVersion` disagree with the
written rows.

**Existing consumers of the symbols Task 1 moves** (all must keep working through re-exports):
`scheduled.mergePreservation.test.ts`, `scheduled.officialRecord.test.ts`, `scheduled.rowParity.test.ts`,
`scheduled.test.ts`.
</interface_context>

<constraints>
- **The executor has NO network.** No `wrangler deploy`, no live probe requests, no `wrangler tail`,
  no publishes, no pushes. Everything network-shaped is in the ORCHESTRATOR-RUN section.
- **Run tests from the REPO ROOT.** `npx vitest run` at the root covers 167 files; running from
  `apps/web` covers 77 and has hidden an 8-day red before. Use `npx vitest run`, never
  `timeout … pnpm test` (it swallows output and exits 0).
- **Stage explicit paths only.** Another session may hold this checkout. `git add <path> …`, never
  `git add -A`.
- **Never write CRLF into a tracked file.** Use the Write/Edit tools; if a shell heredoc is used,
  verify with `file` or `git diff --stat` that no line-ending churn appears.
- **Mutations are reverted, never committed.** Verify the revert with `git status` before committing.
- Never `Read`, `cat` or echo `.env` (project convention; a live token leaked to a transcript once).
</constraints>

<tasks>

<task type="tracer">
  <name>Task 1: Extract the Phase B merge path into a Worker-safe module both the tick and the probe import</name>
  <files>apps/worker/src/artifactMerge.ts (new), apps/worker/src/scheduled.ts, apps/worker/test/stateProbe.test.ts</files>
  <precondition>`npx vitest run` at the repo root is green at HEAD before any edit; record the file/test counts as the baseline the end of Task 3 compares against.</precondition>
  <read_first>
    - `apps/worker/src/scheduled.ts` lines 340-800 (the helpers and both merges) and 1340-1400 (`touchedEventTeamMetrics`)
    - `apps/worker/test/stateProbe.test.ts` Group 1 (`collectLocalImportGraph`, the banned-identifier scan)
  </read_first>
  <action>
Create `apps/worker/src/artifactMerge.ts` and MOVE into it, unchanged in behavior, every symbol the
Phase B artifact merge needs, so that a module which must never reach a write helper can import the
real merge instead of copying it.

Move: the `MatchBand` interface, `roundTeamMetricRecord`, `fallbackTeamNumber`, the `Stamp`
interface, `PlayedRowFacts`, `playedRowFactsFor`, `buildEventScheduledRow`, `findRpOutcomeRp`,
`MergeEventArtifactParams`, `maintainedStateBlock`, `mergeEventArtifact`, `replaceOrAppendRows`,
`incrementRecord`, `MergeTeamSeasonArtifactParams`, `mergeTeamSeasonArtifact`, and
`touchedEventTeamMetrics`.

`scheduled.ts` then imports what it still uses from `./artifactMerge.js` and RE-EXPORTS every symbol
that was previously exported from it (`playedRowFactsFor`, `mergeEventArtifact`,
`mergeTeamSeasonArtifact`, `touchedEventTeamMetrics`, plus the `PlayedRowFacts` type), so the four
existing test files that import them from `../src/scheduled.js` keep working with no edit. Leave
`touchedTeamsRowMetrics` and everything else in `scheduled.ts`; if it needs a moved private helper,
import it back from `./artifactMerge.js` (tick -> merge is fine; merge -> tick is what is forbidden).

`artifactMerge.ts` must import NOTHING from `./scheduled.js` and NOTHING from `./artifactWriter.js`.
That is the whole point of the extraction: the probe's import-graph guarantee survives.

Narrow three parameter types while moving, so a caller that holds only the facts the function reads
does not have to synthesize a whole corpus row. These are type-level widenings of the accepted input
and change no behavior; `scheduled.ts` keeps passing its full objects:
  - `playedRowFactsFor`'s `rawMatches` -> `readonly Pick<TbaMatch, "key" | "actual_time" | "predicted_time" | "time">[]`
  - `playedRowFactsFor`'s `folded` -> `readonly Pick<CorpusMatch, "matchKey" | "videoKey">[]`
  - `MergeEventArtifactParams.stillUpcoming` -> `readonly Pick<CorpusMatch, "matchKey" | "compLevel" | "setNumber" | "matchNumber" | "redTeams" | "blueTeams">[]`
Give each narrowed shape a named exported type alias with a one-line comment saying which function
reads which field, rather than inlining the `Pick`.

Head the new file with a comment stating why it exists: the read-only probe measures Phase B by
calling THESE functions, so a second implementation would measure a fiction, and anything added here
that writes (R2, KV, D1) breaks the probe's guarantee and will fail the import-graph test below.

In `stateProbe.test.ts` Group 1, add two assertions over the import graph of the NEW module
(reuse `collectLocalImportGraph`, pointing it at `artifactMerge.ts`): it reaches neither
`src/scheduled.ts` nor `src/artifactWriter.ts`. Keep the existing probe-graph assertions untouched.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && npx tsc --noEmit -p apps/worker/tsconfig.json && npx vitest run apps/worker</automated>
  </verify>
  <done>
`apps/worker/src/artifactMerge.ts` exists, holds the whole Phase B merge path, and imports neither
`scheduled.ts` nor `artifactWriter.ts`. `scheduled.ts` re-exports the four previously-exported
symbols, and all four existing test files that import them pass unmodified. The worker typecheck is
clean and the worker suite is green. Offline published output is untouched (no publisher file edited).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Re-mirror Phase A to HEAD, add the phaseB emulation arm, and make the guard fail in both directions</name>
  <files>apps/worker/src/stateProbe.ts, apps/worker/test/stateProbe.test.ts</files>
  <behavior>
    - Phase A mirror at HEAD: with `folded=2&upcoming=60`, `rpPmfsProduced` is 2 (not 62) and
      `bandsProduced` is 4 (not 124) — the probe prices no upcoming match.
    - `upcomingScheduled` reports the synthetic still-upcoming count and is constant across arms;
      no counter claims upcoming matches were priced.
    - `rpBonusSidesCaptured` equals the number of RP-eligible folded matches whose breakdown parsed,
      and is 0 in the `rp=0` and `rpSkip=observe` arms.
    - `rpSkip=upcomingPmf`: recognized, arm id stays `all`, every counter equals the `all` arm's, and
      exactly one warning names it NOT APPLICABLE at this tick shape with the reason. It is not
      reported as an unknown token.
    - `rpSkip=foldedPmf,upcomingPmf`: the folded skip applies, the retired name warns separately.
    - `phaseB` absent: the response is byte-identical to `phaseB=0`, and `phaseB.ran` is false with
      every phaseB counter 0.
    - `phaseB=1` against a stubbed artifact origin: the event artifact is fetched once, schema-parsed,
      merged, the state block is present in the merged output, the merged object is stringified, and
      N team artifacts are parsed and merged for `phaseBTeams=N`. Every counter pinned by equality.
    - `phaseB=1` when the fetch fails or the body does not schema-parse: `phaseB.error` is set, the
      response is 500, and no counter reports a merge that did not happen.
    - Every outbound request the probe makes is `GET` over `https:`. Zero D1 writes in every arm,
      `phaseB` on or off.
  </behavior>
  <action>
**A. Re-mirror Phase A.**

Delete the upcoming pricing loop from `runSprFold` entirely, with `upcomingBands`,
`upcomingPredictions`, `upcomingPriced` and the upcoming `rpFieldsFor` call. The tick no longer
prices upcoming matches; a probe that does is measuring code that no longer exists.

The `upcoming=` param survives with a NEW meaning: the number of synthetic still-upcoming matches in
the event's schedule. It now costs CPU only in Phase B (the schedule-only row rebuild, and the
`upcomingCount === 0` gate that decides whether the state block is kept). Build those synthetic
matches in the narrowed scheduled-match shape Task 1 introduced, and report their count as a new
counter `upcomingScheduled`. Remove `upcomingPriced`. Keep `rosterAt` cycling so each scheduled match
carries a real roster.

Add the Phase A bonus-flag capture, mirroring HEAD: `foldObservedRp` captures `parsed.bonusFlags` per
side BEFORE `rp.fold` (so a throwing fold cannot lose them) and sets them into an
`observedBonusSides` map keyed by match key. Report `rpBonusSidesCaptured` (the map's size). This map
is also Phase B's input, exactly as in the tick.

Retain the `selectChangedRows` output as a value, not just a count: Phase B splices those rows into
the state block. Keep `changedRowsDiscarded` as-is.

Keep the two deliberate, already-documented divergences from the tick and restate why in the doc
comment: `rpBeliefs`/`rpKnownTeams` stay inside the `resume` gate (the tick builds them
unconditionally, but ablating the accumulator they exist to seed must ablate them too, or the arm
difference bills RP for work it did not cause), and `probeSelectionsFor` stays a pinned copy.

Split `runSprFold` so the Phase A mirror ends at a hard source boundary: keep `runSprFold` as the
Phase A mirror and define the new Phase B function IMMEDIATELY after it in source order, so the
mirror-guard test can slice the probe's fold region between the two function declarations. Say so in
a comment at both boundaries.

**B. Retire `upcomingPmf` loudly instead of silently.**

Split the component names into the five that still exist (`resume`, `foldedPmf`, `formula`,
`observe`, `beliefs`) and a separate retired set holding `upcomingPmf`. Drop `upcomingPmf` from
`RpArmRan`. A retired token is RECOGNIZED — it is not an unknown token and must not take the
"NO component was skipped" path for the other names in the same list. It contributes its own warning
naming it, saying it is not applicable at this tick shape, and citing that the upcoming RP pricing
loop was deleted by the browser-pricing work (260915-isq). Other valid tokens in the same list still
apply normally. Update `buildRpArmId` so a retired name never appears in the arm id (an id must
describe what actually ran).

**C. Add the Phase B emulation arm.**

New params, all with the same parse discipline the existing params use:
  - `phaseB` — off by default. Recognized off/on value sets; an UNRECOGNIZED value runs ON and warns,
    matching the existing `rp=` rule that a typo is never silently measured as the cheaper arm.
  - `phaseBTeams` — how many per-team artifact merges to emulate; default is the real touched-team
    count derived from the folded matches; clamp to the same ceiling the roster uses.
  - `phaseBEvent` — which published event artifact to fetch; defaults to the resolved event key.
  - `artifactOrigin` — defaults to the public data origin constant; an override is REJECTED unless its
    protocol is `https:` (reject, do not silently fall back).

The emulation, in the tick's own order, calling the REAL functions from `./artifactMerge.js`:
  1. Build the event artifact URL from `artifactKey({ page: "event", eventKey: phaseBEvent,
     algorithmId: "spr", version: spr.version })` and fetch its text. Build the team artifact URL from
     `artifactKey({ page: "team", teamKey: <first discovered roster key>, year: season,
     algorithmId: "spr", version: spr.version })` and fetch its text. Record both byte lengths.
     Fetch is I/O, not CPU, so it does not enter `cpuTime`; the parses that follow do.
  2. `LiveEventArtifactSchema.parse(JSON.parse(eventText))`. Record whether it carried a `state` block.
  3. If it carried no block, synthesize one with `buildEventStateBlock` from the rows the probe read
     and attach it before merging, recording `stateBlockSynthesized: true` and warning. Rationale:
     out of season no published event has a block (blocks attach only to events with a schedule
     current within 7 days), and measuring the merge without one would under-price the single term
     that grew. A synthesized block is sized by `teamCount`, so it is a floor for a 42-team regional,
     not a ceiling — say that in the warning.
  4. `playedRowFactsFor(season, [], foldedMatches, foldedResults, observedBonusSides)` — the narrowed
     signature from Task 1 lets the folded matches be passed directly with no TBA fixture.
  5. `mergeEventArtifact({ … })` with the probe's real predictions, bands, changed rows, touched
     teams, touched metrics and synthetic still-upcoming matches, then `JSON.stringify` the result
     and record its length. Record whether the merged object carries a `state` block (the observable
     proof the splice ran) and how many rows it holds.
  6. `phaseBTeams` times: `TeamSeasonArtifactSchema.parse(JSON.parse(teamText))` on the SAME fetched
     bytes, then `mergeTeamSeasonArtifact({ … })`, then `JSON.stringify`, recording lengths. Parsing
     one team's bytes N times prices N parses of a realistic artifact; a real tick parses N different
     teams' artifacts of similar size. State that in the field's doc comment so nobody reads the
     number as N distinct teams.
  7. Discard everything. Nothing is written anywhere.

Any failure — fetch non-200, JSON parse, schema parse, merge throw — sets `phaseB.error` with name and
message, leaves every phaseB counter at 0, and makes the response `ok: false` / 500, so the
measurement driver's warm-up gate aborts rather than recording a phaseB arm that measured nothing.

Report all of it under a `phaseB` object in the response body alongside `fold`, and echo
`phaseB`/`phaseBTeams`/`phaseBEvent`/`artifactOrigin` in `params`.

**D. The outbound fetch, and keeping the no-write property.**

Route every outbound request through ONE helper that calls `globalThis.fetch(url, { method: "GET" })`
after asserting the URL's protocol is `https:`. No other call site issues a request. No request
carries a body. R2 and KV remain structurally absent; D1 remains read-only by test; the artifact
origin is read over HTTPS with a method that cannot mutate it.

**E. Tests — make the guard bidirectional.**

Group 7 today only fails when the TICK gains a call the probe lacks. It cannot fail when the PROBE
keeps a call the tick dropped, which is exactly the drift this task is repairing. Add:
  - Keep the existing test C (every Phase A call name minus the tick-only allowlist appears in the
    probe).
  - New: pin the extracted Phase A call-name set by EQUALITY to a sorted literal snapshot in the
    test, with a failure message telling the reader to re-mirror `runSprFold` and then update the
    snapshot. This is what makes a tick-side deletion fail.
  - New: slice the PROBE's fold region between the two function declarations, extract its call names,
    drop a named set of JS builtin/method names, and pin the remainder by EQUALITY to a sorted
    literal snapshot. Positive control: assert the snapshot is non-trivial and contains
    `analyticRpPmf` and `serializeState`.
  - New: every domain call name in the probe's fold region must appear in the tick's Phase A region,
    minus a short probe-only allowlist for its fixtures. Comment the known limitation: a re-added
    upcoming loop built from calls the tick also makes would pass this test, which is why the
    behavioral pins below carry that weight.

Update the existing groups for the new shape: Group 5 and Group 8's band and pmf expectations become
folded-only; Group 8 loses its `skipUpcomingPmf` and `skipBothPmf` cases and gains a retired-token
case; the `resumeOnly` arm's query drops the retired name. Every counter stays pinned by EQUALITY —
never an inequality.

New group for phaseB: stub `globalThis.fetch` with a recorder returning a real-shaped published event
artifact (with and without a `state` block) and a real-shaped team artifact; pin every phaseB counter
by equality; assert the merged event carries a block in both the published-block and synthesized-block
cases; assert `phaseBTeams` merges happened; assert the absent-`phaseB` response is byte-identical to
`phaseB=0`; assert every recorded request is GET over https; assert zero D1 writes throughout;
assert the fetch-failure path is 500 with `phaseB.error` set and all counters 0.

Add to Group 1's static scan that the comment-stripped source contains exactly one outbound-fetch call
site and no non-GET HTTP verb literal and no request body key.

**F. Mutation-check at least two**, run one at a time, each reverted before the next:
  1. Re-add a priced upcoming match (call the RP fields helper once inside a loop over the scheduled
     matches) -> the folded-only `rpPmfsProduced`/`bandsProduced` equality pins must fail.
  2. Drop the Phase A bonus-flag capture -> `rpBonusSidesCaptured` and the probe-side call-name
     snapshot must fail.
  3. Skip the event schema parse in the phaseB path -> the phaseB byte/block counters must fail.
  4. Change the outbound method to a non-GET verb -> both the static scan and the stubbed-fetch
     assertion must fail.
Record in the SUMMARY which were run and what failed. Revert every mutation and confirm with
`git status` before committing.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && npx tsc --noEmit -p apps/worker/tsconfig.json && npx vitest run apps/worker/test/stateProbe.test.ts</automated>
  </verify>
  <done>
`rpPmfsProduced` and `bandsProduced` are folded-only and pinned by equality; `upcomingScheduled`
replaces `upcomingPriced`; `rpBonusSidesCaptured` is pinned; `rpSkip=upcomingPmf` is recognized,
inert and self-describing; `phaseB=1` fetches, parses, merges, splices and stringifies through the
real `artifactMerge.ts` functions with every counter pinned by equality; the absent-`phaseB` response
is byte-identical to `phaseB=0`; every outbound request is a GET over https; `writeStatementCount` is
0 in every arm; the mirror guard fails in both directions (proved by two reverted mutations).
  </done>
  <reversibility rating="reversible">The probe is a standalone deployment with no cron and no writes; a wrong arm shape is re-deployable in minutes and cannot affect the live Worker or any published artifact.</reversibility>
</task>

<task type="auto">
  <name>Task 3: Rebuild the measurement rig with the fresh/reused isolate split, and update the runbook</name>
  <files>.planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/measure/arms.mjs, .planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/measure/measure-arms.mjs, .planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/measure/analyze-arms.mjs, docs/worker-operations.md</files>
  <read_first>
    - `.planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/arms.mjs` (whole file)
    - `.planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/measure-arms.mjs` (the arg parser and `runWarmupGate`)
    - `.planning/quick/260914-nhc-profile-the-worker-tick-rp-overhead-per-/measure/analyze-arms.mjs` (the tail/driver join, `buildAggregates`, `printReport`, `runSelfTest`)
    - `docs/worker-operations.md`, the "Pre-event probe" section
  </read_first>
  <action>
Copy the three `260914-nhc/measure/*.mjs` files into this quick task's own `measure/` directory and
adapt them. Leave the 260914-nhc copies untouched — they are the record of how the 2026-09-14 numbers
were produced and must stay reproducible.

**`arms.mjs`.** Keep `COMMON_QUERY` at `season=2026&teamCount=21&folded=2&upcoming=60&algorithms=spr`
so the roster, fold count and algorithm tier stay identical to 2026-09-14; note in its comment that
`upcoming=60` now sizes Phase B's schedule-only row rebuild rather than a Phase A pricing loop, so it
is the same query string measuring a different tick. Nine arms, keeping the same round-robin shape
that produced n=12 per arm:

    all, none, resumeOnly, skipFoldedPmf, skipFormula, skipObserve, skipBeliefs, allPhaseB, nonePhaseB

`resumeOnly` drops the retired name from its skip list. `allPhaseB` is `rp=1&phaseB=1`, `nonePhaseB`
is `rp=0&phaseB=1`. Give every arm an `expectedPhaseB` boolean alongside `expectedId`, because two
arms now share an `expectedId` and only `params.phaseB` separates them.

Differences: `total` (all-none), `resume` (resumeOnly-none), `foldedPmf` (all-skipFoldedPmf),
`formula` (all-skipFormula), `wrapper` (skipFormula-skipFoldedPmf), `observe` (all-skipObserve),
`beliefs` (all-skipBeliefs), `phaseB` (allPhaseB-all), `phaseBNoRp` (nonePhaseB-none).

Add an exported, commented `RETIRED_DIFFERENCES` list naming `upcomingPmf` and `bothPmf` with the
reason they no longer exist, so a reader diffing this table against the 2026-09-14 COMPONENT PROFILE
sees that those rows were removed on purpose and not lost.

**`measure-arms.mjs`.** Extend the warm-up gate to compare `params.phaseB` against the arm's
`expectedPhaseB` and abort on mismatch, with the same wording style as the existing `expectedId`
check. Keep every existing flag and the `--dry-run` path. Keep the "never run this from an executor
sandbox" header.

**`analyze-arms.mjs`.** Add the fresh/reused isolate split, which is the load-bearing part:
  - `extractIsolateRequest(tailEvent)`: scan `tailEvent.logs[].message` (an array whose members may be
    strings or other values) for `isolateRequest=<n>` and return the integer, or `undefined`.
  - Stratify each arm's joined samples into `fresh` (n === 1) and `reused` (n > 1), plus `unknown`
    for samples whose tail event carried no counter. Report per stratum: n, p50, p75, p90, max, mean,
    and percent over 10 ms — and report the arm overall as today.
  - Report every named difference TWICE: on the reused stratum (with standard error) and overall.
    Label the reused stratum as the comparable one and print the reason next to the table: on fresh
    isolates the `none` arm was already ~18 ms on 2026-09-14, so a fresh-isolate difference prices
    platform cold-start, not the component.
  - Print a loud line whenever a stratum's n is below 8, so nobody reads a per-component number off
    a sample that cannot support one.
Update `CONSTANT_ACROSS_ARMS_FIELDS` to the counters that really are constant now
(`bandsProduced`, `matchesFolded`, `upcomingScheduled`) and extend `FOLD_VECTOR_FIELDS` with the new
Phase A counter. The phaseB counters vary by arm by design, so they get their own reported vector and
must NOT be added to the constant-across-arms check.

Extend `runSelfTest` with synthetic tail text carrying `isolateRequest=` log lines across both
strata, so the split is covered with no network and the executor can verify it.

**`docs/worker-operations.md`, "Pre-event probe".** Update the param table: `upcoming`'s meaning,
the five live `rpSkip` names plus the retired one and what it reports, and the new `phaseB`,
`phaseBTeams`, `phaseBEvent` and `artifactOrigin` rows. Rewrite the "upcoming defaults to 60"
paragraph for the new meaning. Change "What it does not measure" to say Phase A plus, under
`phaseB=1`, an emulation of Phase B's merge/splice/stringify — and keep the honest exclusions: no TBA
poll, no KV manifest read, no global rebuild, no second concurrent event, and no R2 write. Add a row
to the write-guarantee table for the outbound HTTPS artifact read (GET-only, single call site,
test-enforced; no binding involved). Add a short "reading a phaseB number" note: a synthesized state
block is a floor sized by `teamCount`, and the N team merges parse one team's bytes N times. Do NOT
delete the 2026-09-12 or 2026-09-14 dated sections — they are the record the new measurement is
compared against.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && node .planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/measure/analyze-arms.mjs --self-test && node .planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/measure/measure-arms.mjs --dry-run --out "$TEMP/qgf-dry" && npx tsc --noEmit && npx tsc --noEmit -p apps/worker/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json && npx vitest run</automated>
  </verify>
  <done>
The rig's arm list matches the probe exactly (nine arms, two of them phaseB), the warm-up gate checks
both `params.rpArm.id` and `params.phaseB`, the analyzer splits fresh from reused isolates and reports
every named difference on the reused stratum with a standard error and a low-n warning, `--self-test`
passes with no network, the 260914-nhc copies are unmodified, the runbook's probe section describes
the current params and arms, and all three typechecks plus the full root suite are green against the
Task 1 baseline (same or more passing files, zero new failures).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| probe -> live D1 | The probe holds a read-write D1 binding; only tests stop it writing production state |
| probe -> public artifact origin (NEW) | Outbound HTTPS leaves the Worker for the first time in this deployment |
| operator query string -> probe | `artifactOrigin`, `phaseBEvent`, `event`, `teams` are attacker-shaped input in principle; the probe URL is public |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-qgf-01 | Tampering | `stateProbe.ts` -> D1 | high | mitigate | The extraction in Task 1 is what lets Phase B be measured WITHOUT importing a write helper; Group 1's import-graph walk and comment-stripped scan now cover `artifactMerge.ts` too, and the fake-D1 write counter stays pinned at 0 in every arm |
| T-qgf-02 | Tampering | probe -> artifact origin (new outbound fetch) | medium | mitigate | One fetch call site, `method: "GET"`, no request body, protocol asserted `https:`; held by both a static source scan and a stubbed-fetch behavioral assertion |
| T-qgf-03 | Spoofing / SSRF | `artifactOrigin=` query param | medium | mitigate | A non-`https:` override is rejected rather than silently falling back; the probe holds no credential, no binding beyond D1, and returns only counters (byte lengths, booleans), never a fetched body |
| T-qgf-04 | Information disclosure | probe response body and logs | low | mitigate | Response carries counters and URLs built from public artifact keys only; no artifact body, no header, no `cf`/geo field, and the analyzer emits aggregates only |
| T-qgf-05 | Denial of service | `phaseBTeams` / `folded` / `upcoming` | low | mitigate | Existing clamps keep `folded + upcoming` bounded; `phaseBTeams` gets the same ceiling as the roster; the probe has no cron trigger, so it runs only when curled |
| T-qgf-06 | Repudiation | a measurement attributed to the wrong arm | medium | mitigate | Every arm echoes `params.rpArm.id`, `params.rpArm.ran` and `params.phaseB`; the driver's warm-up gate aborts on any mismatch; a retired component name warns rather than skipping nothing in silence |
| T-qgf-SC | Tampering | npm/pip/cargo installs | high | accept | No package is installed by this plan — every dependency is already in the lockfile, and the new module and rig files import only existing workspace code and Node builtins |
</threat_model>

<verification>
1. `npx tsc --noEmit` (root), `npx tsc --noEmit -p apps/worker/tsconfig.json`, and
   `npx tsc --noEmit -p apps/web/tsconfig.json` are all clean. The root check does not cover
   `apps/web`; run all three.
2. `npx vitest run` from the REPO ROOT, before Task 1 and after Task 3. Compare file/test counts and
   failures against the recorded baseline. Do not run from `apps/web`.
3. `git status` shows no leftover mutation and no line-ending churn; `git diff --stat` line counts
   match the intended edits.
4. The 260914-nhc measure directory is byte-identical to HEAD.
5. No network command was run by the executor.
</verification>

<success_criteria>
- The probe's Phase A mirrors `processEvent` at HEAD, and a mirror guard fails when EITHER side gains
  or loses a call, proved by a reverted mutation.
- Phase B is emulated by calling the tick's own merge functions from a shared Worker-safe module,
  not by a copy, and the probe still reaches no write helper.
- `phaseB` is OFF by default and the surviving RP arms are unchanged by its existence.
- The retired `upcomingPmf` component reports itself as not applicable instead of measuring nothing.
- The rig's arms match the probe, and the analyzer reproduces the fresh/reused isolate split that
  made the 2026-09-14 per-component numbers meaningful.
- Three typechecks and the full root suite are green; two mutations were run and reverted.
</success_criteria>

<output>
Create `.planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/260915-qgf-SUMMARY.md` when done.

Note: `Write` is blocked for subagents on SUMMARY.md. Return the SUMMARY text to the orchestrator and
let the orchestrator write it. Do NOT use a Bash heredoc — long markdown prose breaks Git Bash
heredocs on this machine.

The SUMMARY must state: which symbols moved to `artifactMerge.ts`; which arms survive and which were
retired; the exact phaseB param set and its defaults; which mutations were run and what failed; the
before/after root `vitest run` counts; and any place the emulation is a floor rather than a faithful
price (the synthesized state block, the one-team-bytes-N-times parse, the splice's `admitted` set).
</output>

---

# ORCHESTRATOR-RUN (main context, network required)

The executor cannot do any of this. Executor subagents' sandbox denies all network Bash, including
`wrangler`. Run every step below from the main context, on a clean tree, after the executor's commits
have landed.

## M1 — Deploy the probe and smoke-test every arm

The probe is evidence about the deployed Worker only if both were built from the same commit. Check
the live Worker's deployed version first and note whether it matches HEAD; if it does not, say so in
M3 rather than quietly comparing across commits.

```bash
cd apps/worker
npx wrangler deploy --config wrangler.probe.toml
```

`pnpm --filter worker deploy` hits pnpm's own built-in and deploys nothing — use `npx wrangler`.
The tree must be clean; if it is not, deploy from a clean detached worktree at the verified SHA.

Record the new probe version id. **Confirm the deploy output lists the D1 binding and NOTHING else**
— no R2 bucket, no KV namespace, no vars, no secrets, no triggers. If anything else appears, stop:
the write guarantee is no longer structural.

Smoke-test each arm once (substitute the deployed subdomain), reading `params.rpArm.id`,
`params.phaseB` and `warnings` on each:

```bash
BASE="https://sigmascout-state-probe.<subdomain>.workers.dev"
Q="season=2026&teamCount=21&folded=2&upcoming=60&algorithms=spr"
for A in "rp=1" "rp=0" "rpSkip=foldedPmf,observe,beliefs" "rpSkip=foldedPmf" \
         "rpSkip=formula" "rpSkip=observe" "rpSkip=beliefs" \
         "rpSkip=upcomingPmf" "rp=1&phaseB=1" "rp=0&phaseB=1"; do
  echo "== $A"
  curl -s "$BASE/?$Q&$A" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
    console.log(j.ok, j.params.rpArm.id, "phaseB="+j.params.phaseB, JSON.stringify(j.fold), JSON.stringify(j.phaseB));
    for(const w of j.warnings) console.log("  !", w);});'
done
```

Expected: every arm `ok: true`; the `rpSkip=upcomingPmf` arm reports id `all` with a
not-applicable warning; the two `phaseB=1` arms report a fetched artifact, a present state block and
non-zero stringified bytes. **If a `phaseB=1` arm returns 500 because no published artifact exists at
the default event key**, find one that does and re-run with `&phaseBEvent=<key>`; then use that same
`phaseBEvent` for M2, and record it in M3.

## M2 — Cold-cadence measurement

Start the tail capture FIRST, detached. A Bash background job died silently ~6.5 min into a long
network run before; use PowerShell `Start-Process` and keep the PID and log path.

```powershell
cd C:\Users\Jacob\Documents\GitHub\SigmaScout\apps\worker
$tail = Start-Process -FilePath "npx" `
  -ArgumentList "wrangler","tail","sigmascout-state-probe","--format","json" `
  -RedirectStandardOutput "$env:TEMP\qgf-tail.json" `
  -RedirectStandardError  "$env:TEMP\qgf-tail.err" `
  -NoNewWindow -PassThru
$tail.Id
```

Then the driver, also detached (9 arms x 30 s spacing x 13 rounds is roughly one hour):

```powershell
cd C:\Users\Jacob\Documents\GitHub\SigmaScout
$m = Start-Process -FilePath "node" `
  -ArgumentList ".planning\quick\260915-qgf-re-mirror-the-state-probe-to-the-post-br\measure\measure-arms.mjs",
                "--base","https://sigmascout-state-probe.<subdomain>.workers.dev",
                "--rounds","13","--warmup","1","--delay-ms","30000",
                "--out","$env:TEMP\qgf-measure" `
  -RedirectStandardOutput "$env:TEMP\qgf-driver.log" `
  -RedirectStandardError  "$env:TEMP\qgf-driver.err" `
  -NoNewWindow -PassThru
$m.Id
```

Poll with a Monitor until-loop on the driver PID and the `driver.jsonl` line count. A quiet log is not
proof a run died — check the output file's mtime and line count before concluding anything. When the
driver exits, stop the tail by PID (`Stop-Process -Id <pid>`), then analyze:

```bash
node .planning/quick/260915-qgf-re-mirror-the-state-probe-to-the-post-br/measure/analyze-arms.mjs \
  --driver "$TEMP/qgf-measure/driver.jsonl" --tail "$TEMP/qgf-tail.json"
```

`n >= 12` per arm is the target (2026-09-14 achieved 12-13). Auto-mode may deny `wrangler tail`; if
so, hand that command to Jacob to run.

## M3 — Write the result into the todo

Append a new dated section to `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md` (do not
edit the 2026-09-12 or 2026-09-14 sections; they are the comparison baseline). It must cover:

- **Provenance**: probe version, Worker version, whether both were built from the same commit, D1
  generation, spr version, the exact query including `phaseBEvent`, arm count, n per arm, spacing.
- **Before/after against the 2026-09-14 COMPONENT PROFILE**, using its own numbers by name: all-on
  15-23 ms p50 cold with 92-100% of ticks over 10 ms; reused-isolate mean 16.2 ms with RP on versus
  6.7 ms with RP off; upcoming-loop RP 7.2 +/- 2.1 ms; the `analyticRpPmf` formula 6.0 +/- 2.5 ms.
- **What the browser-pricing work actually bought.** The upcoming-loop term was the single resolved
  dominant cost; state whether the measured `total` and `formula` differences shrank by about that
  much, and say plainly if they did not.
- **What Phase B costs**, from the `phaseB` and `phaseBNoRp` differences — the term nothing has ever
  measured before.
- **What remains over budget**, on the reused-isolate stratum.
- **An explicit reading rule.** On 2026-09-14 fresh isolates ran ~18 ms even with RP fully off, so a
  verdict of "fits" cannot come from a single number or from the pooled mean. It requires the
  reused-isolate stratum plus the consistency rule in `docs/worker-operations.md`, "How the CPU budget
  is actually enforced": termination follows from hitting the limit consistently, not from one
  expensive tick. Production has shown the same bundle return `ok` at `cpuTime: 38` and be killed
  pinned at `10` sixty seconds later.
- **The floors.** Say which parts of the phaseB number are floors, not faithful prices: a synthesized
  state block is sized by `teamCount` (21) where a regional carries ~42 team rows; the N team merges
  parse one team's bytes N times; the splice's admitted set is the probe's synthetic touched teams, so
  fewer team rows are replaced than at a real event. Still Phase A + Phase B only — no TBA poll, no KV
  manifest read, no global rebuild, no second concurrent event.

Also update the `Status (2026-09-15)` line in the DIRECTION CHOSEN section: step 4's measurement half
is done, and name what is still outstanding before the gate can lift.

## M4 — The gate decision is Jacob's

Do **not** lift the PRE-SEASON GATE in `docs/worker-operations.md`. Present the measurement and the
remaining risks and ask.

Put the decision in `AskUserQuestion`, never in prose, with the plain-language background immediately
before the options. Frame it around what is published versus what is internal: the CPU budget decides
whether live events update at all, so this is the strict side. Options should cover at least: lift the
gate now on the reused-isolate evidence; hold the gate and take one more measurement at a
regional-sized `teamCount`; or hold and pursue the next cost reduction first. Name the remaining
blockers alongside — `live-merge-drops-event-identity-fields` and the outstanding DATA-04 row-parity
items — so the answer is not given in isolation.
