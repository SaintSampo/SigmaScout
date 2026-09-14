---
phase: 260913-pnp-drop-licensed-schedule-templates
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/measureGeneratedSchedules.ts
  - docs/models/rung2-generated-schedules.md
  - docs/models/random-vs-generated-schedules.md
  - packages/harness/generatedSchedules.ts
  - packages/harness/generatedSchedules.test.ts
  - packages/harness/preSchedule.ts
  - packages/harness/preSchedule.test.ts
  - packages/harness/publish.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/scheduleTemplates.ts
  - packages/harness/scheduleTemplates.test.ts
  - packages/harness/fixtures/schedule-templates/6_1.csv
  - packages/harness/fixtures/schedule-templates/6_2.csv
  - packages/harness/fixtures/schedule-templates/8_2.csv
  - packages/harness/fixtures/schedule-templates/README.md
  - scripts/measureRandomSchedules.ts
  - scripts/fetchScheduleTemplates.ts
  - scripts/measureFieldAveragedRanks.ts
  - scripts/measureFieldAveragedRanks.test.ts
  - package.json
  - docs/simulation-architecture.md
  - .github/workflows/test.yml
  - .planning/phases/09-analytic-ranking-points-browser-side-simulation/09-CONTEXT.md
  - .planning/todos/pending/drop-licensed-schedule-templates.md
  - .planning/todos/completed/drop-licensed-schedule-templates.md
autonomous: true
requirements: [QUICK-260913-pnp]

estimate:
  tokens: 150000
  raw_tokens: 300000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "docs/models/rung2-generated-schedules.md line 31 ends with a matched-scope comparison: that document's n=2,000 same-construction floor (pooled and 2025cur) against random-vs-generated-schedules.md's generated-vs-generated floor at the same count, naming the 20-vs-50 draws-per-schedule difference, with every number read from the current random-vs-generated JSON block at render time. The re-render differs from the pre-task HEAD on that one line only, and no sentence claims either harness reproduces the other."
    - "Lines 11-12 of the todo carry the same matched-scope figures, and its MUST FIX section is marked resolved."
    - "buildPreScheduleArtifact uses a generated structure for every schedule k that is shared by event SHAPE (Jacob, 2026-09-14): the structure is exactly generateSchedule(rosterSize, matchesPerTeam, mulberry32(fnv1a32(generate|rosterSize|matchesPerTeam|k)), DEFAULT_RESTARTS), served through a bounded, compact memo that is byte-transparent. A cached structure deep-equals a fresh one for the same key, so output never depends on cache state or eviction. Two events with the same roster size and matchesPerTeam receive identical structures per k and different shuffle seeds. Schedule 0's structure feeds the first-match probe. The shuffle seeds (eventKey|algorithmVersion|shuffle|k) and baked seeds are unchanged, and the injected-structure seam no longer exists."
    - "No code path in the repo reads a schedule-template file. The reader module, its test, the committed CI fixture grid, the fetch script, both measurement scripts that needed the licensed arm, and the package.json fetch entry are all deleted. Root tsc reports 0 errors."
    - "preSchedule.test.ts runs every builder test with no template cache present, with 0 skipped. publish.test.ts still builds presim sidecars in CI through the generator."
    - "publish.ts skips an event whose roster is outside the generator's servable team range with an explicit size check before building, with a logged reason. It has no exception-type branch, and any GeneratedScheduleError that escapes fails the run."
    - "scripts/measureFieldAveragedRanks.ts and its test keep passing (37 tests), with the binding-floor helpers it used to import from the deleted script now living in it and no module cycle left."
    - "The executor reports the measured cost of 1,000 generateSchedule calls at 76 teams x 10 matches per team and the added minutes it implies for a full SPR publish's presim sidecars, with the sidecar-count assumption stated."
    - "Both rung-2 documents carry the one-line retired-harness note under their titles. docs/simulation-architecture.md and the .github/workflows/test.yml comment describe the generator. 09-CONTEXT.md carries a dated 'Jacob decided' resolution beside both D-19 consequences. The todo sits in .planning/todos/completed/ with a closing note."
    - "The full root vitest run after Task 3 has no failing test that was not already failing in the baseline run taken before Task 1."
  artifacts:
    - path: "packages/harness/generatedSchedules.ts"
      provides: "ScheduleMatch type, matchesPerTeamFor, defaultMatchesPerTeam, MIN_SCHEDULE_TEAMS, MAX_SCHEDULE_TEAMS, generateSchedule (the only pairing-structure source)"
      contains: "export function matchesPerTeamFor"
    - path: "packages/harness/preSchedule.ts"
      provides: "per-schedule generated structure inside buildPreScheduleArtifact, shared by event shape through a bounded compact memo"
      contains: "generate|"
    - path: "scripts/measureFieldAveragedRanks.ts"
      provides: "relocated measureResamplingFloor, measureEdgeNoiseFloor, DRAWS_PER_SCHEDULE, REPLICATE_SUFFIX"
      contains: "export function measureResamplingFloor"
    - path: ".planning/todos/completed/drop-licensed-schedule-templates.md"
      provides: "closed todo with closing note"
      contains: "260913-pnp"
  key_links:
    - from: "packages/harness/preSchedule.ts"
      to: "packages/harness/generatedSchedules.ts"
      via: "generateSchedule + DEFAULT_RESTARTS + ScheduleMatch imports"
      pattern: "from \"./generatedSchedules.js\""
    - from: "packages/harness/publish.ts"
      to: "packages/harness/generatedSchedules.ts"
      via: "matchesPerTeamFor, defaultMatchesPerTeam, MIN_SCHEDULE_TEAMS, MAX_SCHEDULE_TEAMS"
      pattern: "from \"./generatedSchedules.js\""
    - from: "scripts/measureFieldAveragedRanks.ts"
      to: "packages/harness/generatedSchedules.ts"
      via: "matchesPerTeamFor import"
      pattern: "generatedSchedules.js"
---

<objective>
Fully resolve `.planning/todos/pending/drop-licensed-schedule-templates.md`. The rules-based generator
(`packages/harness/generatedSchedules.ts`) becomes the only source of pre-schedule pairing structure.
Every template-reading path is retired, the misquoted corroboration figure is fixed first, and the
todo is closed.

Purpose: Jacob decided D-19 on 2026-09-13 (CONTEXT.md): the generator's structurally-derived rules
may be published. Delete the templates and make the generator the only source. The one asserted
number that claimed two harnesses agree has to be stated at matched scope before the change that
moves visitor-facing rank bands.

Output: three commits in the isolated worktree. (1) The corrected corroboration sentence and the
re-rendered rung-2 doc. (2) The generator wired per schedule, every template path deleted, and the
cost priced. (3) The retired-harness notes, the architecture and CI docs, the D-19 resolution, and
the todo closed. The SUMMARY text is returned in the final message.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@C:/Users/Jacob/Documents/GitHub/SigmaScout/.planning/quick/260913-pnp-drop-licensed-schedule-templates/260913-pnp-CONTEXT.md
@C:/Users/Jacob/Documents/GitHub/SigmaScout-pnp/.claude/CLAUDE.md
@C:/Users/Jacob/Documents/GitHub/SigmaScout-pnp/.planning/todos/pending/drop-licensed-schedule-templates.md

## Environment hazards (binding on every task)

- **Work ONLY in the isolated worktree** `C:/Users/Jacob/Documents/GitHub/SigmaScout-pnp` (branch
  `quick/260913-pnp`, forked from `812fd99d`). Every path in this plan is relative to that root, and
  every command runs from it. Before the first edit, confirm `git -C C:/Users/Jacob/Documents/GitHub/SigmaScout-pnp rev-parse --abbrev-ref HEAD`
  prints `quick/260913-pnp` and `git -C C:/Users/Jacob/Documents/GitHub/SigmaScout-pnp merge-base --is-ancestor 812fd99d HEAD` exits 0.
- **Never touch the shared checkout** `C:/Users/Jacob/Documents/GitHub/SigmaScout`, with one
  exception: read the three preserved input JSONs in
  `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/ada3c4be-a9bd-410c-9d77-d101d685caba/scratchpad/rung2-inputs/`
  (that path is a temp scratchpad, not the checkout). Two other sessions are editing the shared
  checkout.
- **Never** run `publish:seasons` or any publish, a D1 seed, a Worker deploy, `git push`, or
  `git merge`. **Never** Write or Edit `.planning/STATE.md`. Never read, cat or echo `.env`, since
  nothing here needs it.
- **Licence boundary (CONTEXT.md, locked):** do not read, quote, paraphrase or reason about the
  cheesy-arena licence. Delete `scripts/fetchScheduleTemplates.ts`, `scripts/measureRandomSchedules.ts`
  and the whole `packages/harness/fixtures/schedule-templates/` directory with `git rm` WITHOUT
  reading them. In `packages/harness/scheduleTemplates.ts`, read only the lines that hold the match
  type and the two matches-per-team functions (about lines 120-160). In `09-CONTEXT.md`, read only
  lines 415-430 and 494-504. Every record you write says "Jacob decided", never why.
- Worktree `node_modules` was installed with `--ignore-scripts`, so better-sqlite3 has no native
  binding. Nothing here opens the corpus. Importing `scripts/measureGeneratedSchedules.ts` still works,
  because the planner verified that its `--render-doc` path runs in this worktree.
- Tests: `npx vitest run <files>` from the worktree root, judged by the printed summary, never by
  exit code alone and never through `timeout ... pnpm ...`. Typecheck: `npx tsc --noEmit -p .` (its
  include covers `packages/**` and `scripts/**`). No `apps/web` or `apps/worker` file changes here.
- Line endings: `core.autocrlf=true`. The rung-2 doc is CRLF in the working tree and the renderer
  writes LF. `git diff` normalises this, so judge the re-render by `git diff`, not by raw bytes.
- `git mv` then edit, never edit then `git mv`. After every commit, run `git status --short` and
  `git show --stat HEAD` to confirm the commit holds exactly the intended paths. Stage by explicit
  path only, never `git add -A` or `commit -a`.
- Scratch files (baselines, timing scripts, logs) go to
  `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/ada3c4be-a9bd-410c-9d77-d101d685caba/scratchpad/pnp-exec/`.
  A tsx script there must use the `.mts` extension (a `.ts` file outside the repo is compiled as CJS and
  top-level await fails). Import repo modules by absolute `file://` URL, as the planner's probe
  `.../scratchpad/pnp-plan/grid-probe.mts` does. You may copy and adapt that probe.
- Do NOT write SUMMARY.md. Return its text in your final message; the orchestrator writes it.

## Established facts (orchestrator-verified in CONTEXT.md, and re-checked by the planner in this worktree; do not re-derive)

- Named-file baseline at `812fd99d`: `npx tsc --noEmit -p .` gives 0 errors. The five-file vitest run
  gives 283 passed and 3 skipped. Per file: generatedSchedules.test.ts 13; preSchedule.test.ts 16, of
  which 1 is the cache-absent skip placeholder standing in for 9 gated tests; scheduleTemplates.test.ts
  8, of which 1 is skipped; measureFieldAveragedRanks.test.ts 37; publish.test.ts 212, of which 1 is
  skipped (derived by subtraction).
- The unmodified renderer, fed `phaseA-binding.json,phaseB.json,phaseC.json` in that order,
  reproduces HEAD's `docs/models/rung2-generated-schedules.md` on all 187 lines (planner probe,
  modulo CRLF). The corroboration sentence is the tail of line 31. It is emitted by the `L.push(...)`
  at `scripts/measureGeneratedSchedules.ts` about lines 1168-1173, inside `renderRungTwoDoc`. The
  `--render-doc` branch of `main` is about lines 754-763.
- The current `docs/models/random-vs-generated-schedules.md` JSON block opens with the fence
  `json random-vs-generated-schedules`. The file is CRLF, so match the fence with `\r?\n`. Top-level
  keys include `scheduleCount` (2000) and `drawsPerSchedule` (20). The figures to read are
  `pooled.genBVsGenA.clause1TightRate` (0.8934..., 89.3%) and
  `events[eventKey === "2025cur"].genBVsGenA.clause1TightRate` (78.9%). In the renderer, the rung-2
  side at the same count is `pooled.get(2000).resampleWithinTightRate` (91.8%) and
  `noise.get("2025cur|2000").resampling.withinTightRate` (88.2%).
- The planner found a dependency that CONTEXT.md does not list. `scripts/measureFieldAveragedRanks.ts`
  imports more than `matchesPerTeamFor`. It also imports `DRAWS_PER_SCHEDULE`, `REPLICATE_SUFFIX`,
  `measureEdgeNoiseFloor`, `measureResamplingFloor` and the types `EdgeNoiseFloor` and
  `ResamplingFloor` from `./measureGeneratedSchedules.js` (a deliberate module cycle), and
  `scripts/measureFieldAveragedRanks.test.ts` imports the four value bindings too. Those helpers depend
  on nothing template-related, and they must move into `measureFieldAveragedRanks.ts` before the
  script is deleted.
- `scripts/measureGeneratedSchedules.ts`, `scripts/measureRandomSchedules.ts` and
  `scripts/fetchScheduleTemplates.ts` all import `packages/harness/scheduleTemplates.js`. Deleting the
  reader therefore forces those three deletions into the SAME commit, or root tsc goes red. That is
  why Task 2 carries them, and why Task 3 is records only.
- `publish.ts` already has `if (args.roster.length < 6)` log-and-skip before building (about line
  2063). The `ScheduleTemplateUnavailableError` catch (about lines 2141-2147) only ever fired for
  rosters over 200.
- The planner probed the generator: `generateSchedule` succeeded for every roster from 6 to 120 teams
  at 1 to 14 matches per team, 3 seeds each (4,830 cells, 0 throws). Rosters over 1,024 teams would
  make `pairKey` collide silently.
- Sidecar count for pricing: `docs/publish-budget.md`'s run line for generation `2dcc057f`
  (`--presim-from-season 2026`) records **214 presim sidecars** in a 0h23m28s publish.
- No test file exists for `measureGeneratedSchedules.ts`, `measureRandomSchedules.ts` or
  `fetchScheduleTemplates.ts`. Beyond those scripts, the only importers of the deleted modules are
  `preSchedule.ts`, `preSchedule.test.ts`, `generatedSchedules.ts`, `publish.ts`,
  `measureFieldAveragedRanks.ts` and `measureFieldAveragedRanks.test.ts`. Comment-only references sit
  in `publish.ts` (about lines 2031-2044) and `pageArtifacts.ts` (about lines 1954-1958).

<!-- planner-discipline-allow: reproduces that session -->
<!-- planner-discipline-allow: scheduleStructure -->
<!-- planner-discipline-allow: scheduleTemplates|schedule-templates|loadScheduleTemplate|ScheduleTemplate(Unavailable|Missing|Parse)Error|SCHEDULE_TEMPLATE -->

## Source coverage

| Source item | Task |
|---|---|
| GOAL: generator is the only pairing-structure source, every template path retired, corroboration fixed first, todo closed | T1, T2, T3 |
| D-19 cleared: publish, delete templates, record "Jacob decided" in the todo and at 09-CONTEXT L423/L500 | T2 (delete), T3 (records) |
| Delete both measurement scripts + fetch script + package.json entry; re-render BEFORE deletion | T1 (re-render), T2 (delete) |
| One-line retired-harness note under each rung-2 doc title, no other rewrite | T3 |
| measureFieldAveragedRanks.ts stays, repointed | T2 |
| Delete committed CI fixtures (current code only, no history rewrite) | T2 |
| Corroboration: matched scope N=2000 pooled + 2025cur, 20-vs-50 draws, computed from current JSON block, diff guard, todo L11-12, MUST FIX marked done | T1 |
| Fresh structure per k, DEFAULT_RESTARTS, remove seam, keep shuffle seeds; SHARED BY SHAPE via `generate|n|mpt|k` seed and a bounded transparent compact memo (Jacob 2026-09-14) | T2 |
| Move ScheduleTemplateMatch / matchesPerTeamFor / defaultMatchesPerTeam, keep 1..14 clamp, reword grid-citing comments | T2 |
| Explicit roster-size skip replaces exception branch; ScheduleTemplateMissingError has no successor; note 101-200-team behaviour change | T2 (code), SUMMARY (note) |
| Price 1,000 generateSchedule calls at 76x10, added minutes for a full SPR publish | T2 |
| preSchedule tests run unconditionally; pins that move updated with reasons | T2 |
| CI comment test.yml L55-75; docs/simulation-architecture.md L109/L272/L328 | T3 |
| Out of scope, noted as owed: the republish (main context), local `rm -rf data/schedule-templates/` (orchestrator) | SUMMARY |
</context>

<tasks>

<task type="auto">
  <name>Task 1: Record the full-suite baseline, then replace the hardcoded corroboration figure with a computed matched-scope comparison and re-render the rung-2 doc under a one-line diff guard</name>
  <files>scripts/measureGeneratedSchedules.ts, docs/models/rung2-generated-schedules.md, .planning/todos/pending/drop-licensed-schedule-templates.md</files>
  <precondition>The three files phaseA-binding.json, phaseB.json and phaseC.json exist under the scratchpad rung2-inputs directory named in Environment hazards, and the worktree HEAD is on quick/260913-pnp with a clean `git status --short`.</precondition>
  <action>
Step 0, the full-suite baseline (before ANY edit). From the worktree root, run the full root suite once with the output redirected: `npx vitest run > <pnp-exec>/baseline-full.txt 2>&1`, using the Bash tool with a 600000 ms timeout. If that times out, re-run it with `run_in_background` and wait until the file holds vitest's final `Test Files` summary line before continuing. Record the summary lines (Test Files, Tests) and extract the sorted set of failing test identifiers into `<pnp-exec>/baseline-failures.txt`: keep the lines vitest marks as failed (those starting, after whitespace, with `FAIL` or `×`), strip trailing durations, then sort and dedupe. An empty file is a valid baseline. Also run the named-file baseline from the facts section and confirm it still reads 283 passed and 3 skipped.

Step 1, prove the renderer and inputs match HEAD before editing. Run `npx tsx scripts/measureGeneratedSchedules.ts --render-doc --inputs <in>/phaseA-binding.json,<in>/phaseB.json,<in>/phaseC.json` (absolute paths, that order; the renderer lets later inputs overwrite earlier map entries, and this order is the one that reproduces HEAD). Then `git diff --quiet -- docs/models/rung2-generated-schedules.md` must exit 0. If it does not, STOP: do not edit anything, restore the file with `git checkout -- docs/models/rung2-generated-schedules.md`, and report that the inputs or renderer drifted.

Step 2, compute the comparand (CONTEXT.md "The corroboration figure"). In `scripts/measureGeneratedSchedules.ts`:
(a) Add an exported constant for the comparand doc path (`docs/models/random-vs-generated-schedules.md`).
(b) Add an exported pure reader that takes that document's text and returns scheduleCount, drawsPerSchedule, and the pooled and `2025cur` generated-vs-generated clause-1 rates from its JSON block. Match the fence with `\r?\n` on both sides. Throw an Error naming the missing piece if the block, `pooled.genBVsGenA`, or the `2025cur` event is absent.
(c) Give `renderRungTwoDoc` a second, required parameter carrying that comparand, and read the file in the `--render-doc` branch of `main`. This keeps the renderer pure.
(d) Replace ONLY the last sentence of the line-31 paragraph, the sentence that begins "Its n=1000 value". Keep every other string in that `L.push` byte-identical, including "so the binding floor is measured here rather than argued about."
(e) The new text is computed, not literal. It names `docs/models/random-vs-generated-schedules.md`'s generated-vs-generated floor as the same construction built twice on the same six events. It states that document's count (formatted en-US, `n=2,000`) and its draws per schedule against this table's `DRAWS_PER_SCHEDULE`. It gives that document's pooled and `2025cur` rates beside this table's resampling rates at the same count, read from `pooled` and `noise`. It says per cell whether that document reads lower or higher. When both cells are lower and its draws per schedule are fewer, it adds that this is the direction the fewer draws predict. It closes by saying the two harnesses agree in direction and neither reproduces the other's figures. Suggested rendering, with the numbers the JSON yields today: "Matched at the same count, that document's generated-vs-generated floor (the same construction built twice on the same six events, but at 20 draws per schedule where this table uses 50) reads 89.3% pooled and 78.9% at `2025cur` at n=2,000, against 91.8% and 88.2% here: lower in both cells, the direction its fewer draws per schedule predict. The two harnesses agree in direction; neither reproduces the other's figures."
(f) Throw loudly if the comparand's scheduleCount has no pooled row or no `2025cur` noise row in this table.
Do not mention the old mis-scoped figure anywhere in the script.

Step 3, re-render and enforce the guard. Re-run the Step 1 command. Then `git diff --numstat -- docs/models/rung2-generated-schedules.md` must print exactly `1	1`, and `git diff -U0 -- docs/models/rung2-generated-schedules.md` must hold exactly one hunk, `@@ -31 +31 @@`. The removed and added line 31 must share the identical prefix through "rather than argued about.". If the renderer reports different numbers on any other line, STOP: do not commit, restore the doc, and report the diff.

Step 4, the todo by hand. Replace lines 11-12 of `.planning/todos/pending/drop-licensed-schedule-templates.md` with a sentence carrying the same matched-scope figures as the rendered line 31: two independent harnesses on the same six events; at n=2,000 their same-construction floors read 91.8% vs 89.3% pooled and 88.2% vs 78.9% at `2025cur`; the second is lower in both, as its 20-vs-50 draws per schedule predict; they agree in direction and neither reproduces the other. Then mark the MUST FIX section resolved. Prefix its heading with "RESOLVED (quick task 260913-pnp) —", and add a short paragraph directly under the heading covering three things. First, what the old figure actually was: the POOLED generated-vs-generated floor at N=1000 and 20 draws per schedule, from the first version of `random-vs-generated-schedules.md` (commit `5454999e`, overwritten 41 minutes later by `71dccb26`), paired with rung-2's PER-EVENT `2025cur` figure. Second, that the renderer now reads the comparand from the current document's JSON block at matched scope. Third, that the doc was re-rendered with a one-line diff. Leave the rest of the todo untouched. It closes in Task 3.

Step 5, verify and commit. Run `npx tsc --noEmit -p .` (0 errors). Commit exactly the three files: `fix(260913-pnp): state the rung-2 corroboration at matched scope, computed from the current comparand doc`.
  </action>
  <verify>
    <automated>git show --numstat --format= HEAD -- docs/models/rung2-generated-schedules.md | grep -qx "1	1	docs/models/rung2-generated-schedules.md" && test "$(git show -U0 --format= HEAD -- docs/models/rung2-generated-schedules.md | grep -c '^@@')" = "1" && sed -n 31p docs/models/rung2-generated-schedules.md | grep -q "89.3%" && sed -n 31p docs/models/rung2-generated-schedules.md | grep -q "78.9%" && ! grep -q "reproduces that session" scripts/measureGeneratedSchedules.ts docs/models/rung2-generated-schedules.md && npx tsc --noEmit -p .</automated>
    <automated>test -s C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/ada3c4be-a9bd-410c-9d77-d101d685caba/scratchpad/pnp-exec/baseline-full.txt && grep -q "Test Files" C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/ada3c4be-a9bd-410c-9d77-d101d685caba/scratchpad/pnp-exec/baseline-full.txt</automated>
  </verify>
  <done>The full-suite baseline and its failure set are on disk. HEAD holds one commit touching exactly the script, the doc and the todo. The doc differs from its parent on line 31 only, and that line carries the computed matched-scope comparison (89.3% / 78.9% against 91.8% / 88.2%, 20 vs 50 draws). The script no longer asserts the old figure. The todo's lines 11-12 match, and its MUST FIX section reads RESOLVED. Root tsc is clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire the generator per schedule, delete every template-reading path together with the scripts that cannot compile without it, relocate the field-averaged harness's floors, and price generation</name>
  <files>packages/harness/generatedSchedules.ts, packages/harness/generatedSchedules.test.ts, packages/harness/preSchedule.ts, packages/harness/preSchedule.test.ts, packages/harness/publish.ts, packages/harness/pageArtifacts.ts, packages/harness/scheduleTemplates.ts, packages/harness/scheduleTemplates.test.ts, packages/harness/fixtures/schedule-templates/ (4 files), scripts/measureGeneratedSchedules.ts, scripts/measureRandomSchedules.ts, scripts/fetchScheduleTemplates.ts, scripts/measureFieldAveragedRanks.ts, scripts/measureFieldAveragedRanks.test.ts, package.json</files>
  <behavior>
    - matchesPerTeamFor(10, 16) is 9 (truncates), (100, 1) is 1 (low clamp), and (10, 1000) is 14 (high clamp). defaultMatchesPerTeam(3) is 10, and (0) and (1) are 12. These tests move from the deleted test file unchanged.
    - generateSchedule throws GeneratedScheduleError for 5 teams, for 0 matches per team, and for MAX_SCHEDULE_TEAMS + 1 teams. The last throws before any construction work. MIN_SCHEDULE_TEAMS is 6 and MAX_SCHEDULE_TEAMS is 1024.
    - buildPreScheduleArtifact with a 12-team roster at 6 matches per team and 3 schedules gives each schedule scheduleMatchCount(12, 6) matches, and two identical calls are deep-equal.
    - Exact construction, pinned. For every k, the published schedules[k].matches r and b arrays equal the test's own reconstruction: take generateSchedule(12, 6, mulberry32(fnv1a32(generate|12|6|k)), DEFAULT_RESTARTS), and map each slot through a Fisher-Yates permutation driven by mulberry32(schedules[k].seed). The test carries its own copies of the FNV-1a hash and the Fisher-Yates loop, doc-commented as the seed contract. A builder that reused one structure for every k fails this at k=1. Do not use balance-profile inequality as the proof: the generator minimises exactly those quantities, so different k can legitimately tie on them.
    - Shared by shape, pinned. Two builds with different eventKeys but the same 12-team roster size and 6 matches per team have identical un-shuffled structures per k (reconstruct via the inverse of each build's own shuffle, or compare against the shared generateSchedule reconstruction above), and different schedules[k].seed values. A 13-team build at 6 matches per team gets a different structure at k=0.
    - The memo is transparent and bounded. A cache instance built with a small cell cap (for example 2) serves, for keys spanning more cells than the cap, structures that deep-equal fresh generateSchedule output both on first request and again after that cell was evicted and regenerated. Cold and warm reads for the same key deep-equal each other, and the instance never holds more cells than its cap.
    - The shuffle seeds published in schedules[k].seed equal fnv1a32 of eventKey|algorithmVersion|shuffle|k exactly as before. The existing test that changing eventKey or algorithmVersion changes every seed stays green unedited.
    - preSchedule.test.ts's nine formerly gated builder tests run with no template cache present. That covers determinism, sort independence, seed change, the null-after-one-predict probe, the throw naming 2026casj_presim0_qm2, histogram shape, match count 12 for 6 teams at 12, surrogate flags in a 10-team at 10-per-team build (surrogateSlotCount(10, 10) is 2, so at least one match per schedule flags one), and the schema round-trip. The file reports 0 skipped.
    - The import-surface pin lists ./generatedSchedules.js in place of the deleted reader module, and still passes as a set-equality check.
    - measureFieldAveragedRanks.test.ts still has 37 passing tests, now importing DRAWS_PER_SCHEDULE (50), REPLICATE_SUFFIX, measureEdgeNoiseFloor and measureResamplingFloor from ./measureFieldAveragedRanks.js.
  </behavior>
  <action>
Step 1, move the shared shape into the generator (discretion: the type is renamed `ScheduleMatch`, a neutral name). In `packages/harness/generatedSchedules.ts`:
- Define and export `ScheduleMatch`, with the same four readonly fields and the same zero-based and positional-surrogate semantics. Move `matchesPerTeamFor` and `defaultMatchesPerTeam` in with identical bodies, including the trunc formula and the 1..14 clamp. Reword the clamp's comment so it no longer justifies 1..14 by a template grid: the range is kept so published `matchesPerTeam` values do not move.
- Export `MIN_SCHEDULE_TEAMS` (equal to the six-slot constant) and `MAX_SCHEDULE_TEAMS = 1024` (the `pairKey` index capacity). Make `generateSchedule` throw `GeneratedScheduleError` above the maximum, before building.
- Replace every use of the old type name. Remove the type import from the reader module.
- Rewrite the header's "what this is for" section. The module is now the only shipped source of pre-schedule pairing structure (quick task 260913-pnp), and `docs/models/rung2-generated-schedules.md` is its measurement record. Drop the claims that it is experiment-only and that nothing in publish.ts reaches it.
- In the remaining comments, remove references to the deleted reader module and loader by stating the geometry directly. Leave the stated rules, their weights and their behaviour alone. Add no licence discussion.

Step 2, per-schedule generation (CONTEXT.md "Wiring the generator"). In `packages/harness/preSchedule.ts`:
- Import `generateSchedule`, `DEFAULT_RESTARTS` and the `ScheduleMatch` type from `./generatedSchedules.js`. Remove the reader import.
- Delete the injected-structure field from `PreScheduleBuildParams` together with its whole doc comment (the seam was experiment-only).
- Add a small structure memo to this module (Jacob's decision 2026-09-14, CONTEXT.md "Publish cost"). Export a class, for example `ScheduleStructureCache`, constructed with a maximum cell count. Its `get(numTeams, matchesPerTeam, k)` returns exactly `generateSchedule(numTeams, matchesPerTeam, mulberry32(fnv1a32(`generate|${numTeams}|${matchesPerTeam}|${k}`)), DEFAULT_RESTARTS)`, using this module's existing `fnv1a32`. Each (numTeams, matchesPerTeam) cell stores its generated structures COMPACTLY, filled lazily per k: slot indices in a typed array (n <= 1024 fits Uint16) and the positional surrogate flags as bits or bytes. Decode into `ScheduleMatch[]` on read. When a new cell would exceed the cap, evict the least recently used cell. Export one module-level shared instance with a documented cap (128 cells; 2026's publish needs 72) and use it from `buildPreScheduleArtifact`. The doc comment must say the memo is transparent: output is a pure function of the key, so cache state and eviction can never change a published byte.
- Inside `buildPreScheduleArtifact`, get schedule k's structure from the shared cache with `(sortedRoster.length, params.matchesPerTeam, k)`. Build k=0's structure before the first-match probe and use it for `firstScheduleMatches`, so an RP-less algorithm touches exactly one structure. Get every k from 1 up to the schedule count inside the loop.
- Keep the `shuffle|k` and `baked|k` seed strings, the probe, pricing, rounding and surrogate handling exactly as they are. Rename the internal `template` parameters and variables to `structure`.
- Update the module header's purity contract: there is no filesystem access at all now. Update the builder's doc comment: a `GeneratedScheduleError` propagates for a roster outside the generator's range, and callers check roster size first. Update the field-averaged builder's comment that names the schedule-template read as the one filesystem touch.

Step 3, the tests (write the new cases first and watch them fail against the old code where they can).
- In `packages/harness/preSchedule.test.ts`: delete the `existsSync` import, the reader import, the cache constant and the `it.skip` early return, so the nine builder tests run unconditionally. Rewrite the header's fixture facts in terms of the generator (6 teams at 12 gives 12 matches with no surrogate slots; 10 at 10 gives 17 matches with 2 surrogate slots). Rewrite the surrogate test's comment the same way. Swap the expected import specifier to `./generatedSchedules.js`, with a comment saying the reader import was replaced by the generator in 260913-pnp. Reword the five-team field-averaged test's title and comments so they cite the generator's 6-team floor and `GeneratedScheduleError`. Reword the "never reads the filesystem" test's title so it no longer mentions a template cache.
- In `packages/harness/generatedSchedules.test.ts`: replace the two seam tests and their `paramsWith` helper with the per-schedule builder tests from the behavior block. Add the moved matches-per-team tests and the maximum-roster throw. Rename the "shape compatibility" describe so it no longer names the deleted loader. Reword the header and the geometry comments that point at the deleted module or a template cache.
- Grep `packages/harness/publish.test.ts` and `packages/harness/pageArtifacts.test.ts` for presim digests, byte counts or values that depend on structure. The planner found none: the presim assertions check roster, scheduleCount 1000, draws 50000 and pricedFrom. If any pin does move, update it with a one-line comment giving the reason (the generator replaced the template structure in 260913-pnp) and list it in the SUMMARY. Otherwise report "no pins moved".

Step 4, publish.ts: keep this diff to four places, because another session holds this file.
- Replace the import line with `defaultMatchesPerTeam`, `matchesPerTeamFor`, `MIN_SCHEDULE_TEAMS` and `MAX_SCHEDULE_TEAMS` from `./generatedSchedules.js`.
- Change the existing below-6 roster check in `buildPreScheduleSidecarForEvent` into an explicit range check against those two constants. It logs with the existing label ("roster has N team(s), outside the generator's MIN..MAX-team range") and returns undefined.
- Remove the try/catch around `buildPreScheduleArtifact` so the call is a plain assignment. Any throw now fails the run, and there is no exception-type branch. The missing-cache error has no successor.
- In that function's doc comment, replace the "Error split (C-11)" paragraph with one sentence on the explicit roster-range skip. In the 260912-2ur paragraph, change the clause naming both scripts to name `scripts/measureFieldAveragedRanks.ts` alone.
Leave the comment near line 3389 that mentions loading a template as it is. It is outside this branch and it is listed as a survivor in the SUMMARY. In `packages/harness/pageArtifacts.ts`, make the same one-clause edit to the comment that names both scripts (about lines 1954-1958): only `scripts/measureFieldAveragedRanks.ts` reads the `schedules` block now.

Step 5, relocate the field-averaged harness's floors, then delete the doomed files.
- Move these definitions from `scripts/measureGeneratedSchedules.ts` into `scripts/measureFieldAveragedRanks.ts`, verbatim apart from comment rewording: the `DRAWS_PER_SCHEDULE` constant (50), `ResamplingFloor`, `aggregateOverPrefix`, `RESAMPLE_DRAW_SALT`, `measureResamplingFloor`, `REPLICATE_SUFFIX`, `EdgeNoiseFloor` and `measureEdgeNoiseFloor`. Place them after the clause constants they read. Keep their exports.
- Delete the module-cycle comment block and the import from `./measureGeneratedSchedules.js`. Repoint the `matchesPerTeamFor` import to `../packages/harness/generatedSchedules.js`. Reword the header's baked-arm description: its structure now comes from the rules-based generator, and records written before 2026-09-13 used the licensed grid. Reword the `DEFAULT_SCHEDULE_COUNT` comment that points at the deleted script's constant.
- In `scripts/measureFieldAveragedRanks.test.ts`, import the four bindings from `./measureFieldAveragedRanks.js`. Rename the cycle describe and its test titles and comments to say the binding floors are exported from this module and the cycle is gone. Keep every assertion.
- Then `git rm` (without reading) `packages/harness/scheduleTemplates.ts`, `packages/harness/scheduleTemplates.test.ts`, `packages/harness/fixtures/schedule-templates/` (recursive), `scripts/measureGeneratedSchedules.ts`, `scripts/measureRandomSchedules.ts` and `scripts/fetchScheduleTemplates.ts`. Remove the `fetch:schedule-templates` entry from root `package.json`, and touch nothing else in that file.
- Run `git grep -nE "measureGeneratedSchedules|measureRandomSchedules|fetchScheduleTemplates|scheduleStructure" -- packages scripts apps package.json`. It must print nothing. Fix any hit before continuing.

Step 6, price the change (report only, no commit content). Write `<pnp-exec>/gen-timing.mts`, adapted from the planner's grid probe. Warm up with 20 calls, then time 1,000 `generateSchedule(76, 10, mulberry32(seed_k), DEFAULT_RESTARTS)` calls with distinct seeds, using `performance.now()`. Also time 1,000 calls at 37 teams x 12, the median 2026 roster. Then measure the memo. Fill one cell of 1,000 structures at 76x10 through a fresh `ScheduleStructureCache` and record `process.memoryUsage().heapUsed` before and after, with `global.gc` if you run under `--expose-gc`; do the same at 37x12. Then time a second full read of both cells, which must be near zero. The orchestrator measured these from the corpus, so do not re-derive them: 215 RP-eligible 2026 events with roster >= 6 (median 37, p95 61, max 75), 72 distinct (roster size, matchesPerTeam) cells, cost model ms ≈ 4.307e-4 x n^1.88 x mpt, ~17.6 min added without sharing and ~6.2 min with it. Report your per-call timings against that model, the bytes per cell, and the implied memory for 72 cells at the cap.

Step 7, verify and commit. Run the verify commands. Compare the named-file run against the baseline: preSchedule.test.ts shows at least 24 passed and 0 skipped (more if the shared-shape and memo tests live there); measureFieldAveragedRanks.test.ts shows 37; the only skip in the run is publish.test.ts's pre-existing one, and its message must not mention schedule templates; there are 0 failures. Report any publish.test.ts test whose duration grew near the 30 s timeout. Commit exactly the paths in this task's files list: `feat(260913-pnp): generate a fresh pairing structure per presim schedule and retire every template-reading path`.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/preSchedule.test.ts packages/harness/generatedSchedules.test.ts packages/harness/publish.test.ts scripts/measureFieldAveragedRanks.test.ts && npx tsc --noEmit -p .</automated>
    <automated>test ! -e packages/harness/scheduleTemplates.ts && test ! -e packages/harness/scheduleTemplates.test.ts && test ! -e packages/harness/fixtures/schedule-templates && test ! -e scripts/measureGeneratedSchedules.ts && test ! -e scripts/measureRandomSchedules.ts && test ! -e scripts/fetchScheduleTemplates.ts && ! grep -q "fetch:schedule" package.json && grep -q "generate|" packages/harness/preSchedule.ts && grep -q "ScheduleStructureCache" packages/harness/preSchedule.ts && test -z "$(git grep -nE 'scheduleStructure|measureGeneratedSchedules|measureRandomSchedules|fetchScheduleTemplates' -- packages scripts apps package.json)"</automated>
  </verify>
  <done>One commit holds the generator wiring, the moved type and functions with the range constants, the rewritten tests, the four-place publish.ts edit, the pageArtifacts.ts comment clause, the relocated floors, the six deleted files plus the fixture directory, and the package.json line. The named-file run has 0 failures, preSchedule.test.ts runs 24 tests with 0 skipped, and measureFieldAveragedRanks.test.ts runs 37. Root tsc is clean. The timing figures and their assumptions are recorded for the SUMMARY, along with the pin report (moved pins with reasons, or "no pins moved").</done>
</task>

<task type="auto">
  <name>Task 3: Retire the records: harness notes, architecture and CI docs, the dated D-19 resolution, the survivor grep, the closed todo, and the full-suite comparison</name>
  <files>docs/models/rung2-generated-schedules.md, docs/models/random-vs-generated-schedules.md, docs/simulation-architecture.md, .github/workflows/test.yml, .planning/phases/09-analytic-ranking-points-browser-side-simulation/09-CONTEXT.md, .planning/todos/pending/drop-licensed-schedule-templates.md -> .planning/todos/completed/drop-licensed-schedule-templates.md</files>
  <action>
Step 1, the retired-harness notes (CONTEXT.md, locked; a hand edit, nothing else in either record changes). In both `docs/models/rung2-generated-schedules.md` and `docs/models/random-vs-generated-schedules.md`, insert one line directly under the title, separated by blank lines. The line says the document's measurement harness (name that doc's own script: `scripts/measureGeneratedSchedules.ts` or `scripts/measureRandomSchedules.ts`) was retired with the licensed templates on 2026-09-13 (quick task 260913-pnp) and cannot be re-run. Format it as a bold-led blockquote. Do not touch the JSON block or any other line.

Step 2, `docs/simulation-architecture.md`:
- About line 109: the "schedule template" input row becomes a pairing-structure row. It points at `packages/harness/generatedSchedules.ts`, which generates a fresh balanced structure per schedule, seeded from eventKey, algorithmVersion, a generate salt and k, and needs no files.
- About lines 112-114: the K sentence becomes K = `PRESIM_SCHEDULE_COUNT` = 1,000 (correcting the stale 20 in the sentence being rewritten). Each schedule is its own generated structure plus a seeded Fisher-Yates shuffle of the roster onto its slots. Structure k is shared by every event with the same roster size and matches per team (seed over generate, n, mpt and k, memoized), and the shuffle and baked seeds are per event. Seeds are FNV-1a. There is still no platform RNG, so a republish is byte-identical.
- About lines 272-275, Option B "Blocker 1": the template cache no longer exists, and the structure comes from the generator. A browser-side run would have to reproduce the generator's seeded output to match the published pricing. State only that, and do not discuss the licence.
- About line 328, file map: replace the reader row with `packages/harness/generatedSchedules.ts`, the rules-based pairing-structure generator.

Step 3, `.github/workflows/test.yml` (comment only, about lines 59-71): the RUN paragraph for publish.test.ts now says its publishSeasons suites build a presim sidecar per event through the rules-based generator, which reads no files, so they and `packages/harness/preSchedule.test.ts` run on this runner. Keep the warning that a skip here would be a regression. Keep the history in one short sentence without naming deleted paths or error types: until 2026-09-13 these tests read a template cache the runner never had, which kept CI red for 22 runs. Change no YAML key or step.

Step 4, the dated D-19 resolution in `09-CONTEXT.md`. Read only lines 415-430 and 494-504. Under consequence "1. **D-19 is LIVE.**" (about line 423), and again right after the paragraph containing "Consequence 1 (D-19, the schedule-template redistribution licensing question) is **untouched by this**" (about line 500), add an indented blockquote. It reads: "**RESOLVED 2026-09-13 — Jacob decided:** the generator's structurally-derived rules may be published. The licensed templates are deleted and `packages/harness/generatedSchedules.ts` is the only source of pre-schedule pairing structure (quick task 260913-pnp, commit <Task 2 short sha>). No agent made this call." Give no reason, and quote or paraphrase nothing about the licence. Edit nothing else in the file.

Step 5, the survivor grep. Run `git grep -nE "scheduleTemplates|schedule-templates|loadScheduleTemplate|ScheduleTemplate(Unavailable|Missing|Parse)Error|SCHEDULE_TEMPLATE" -- . ":!.planning"`. The only lines allowed are in `docs/models/rung2-generated-schedules.md`: its machine-rendered historical record, whose line under the title-note says what was untouched at the time. List every surviving line with its reason in the SUMMARY. Fix any other hit. Also run `git grep -nE "measureGeneratedSchedules|measureRandomSchedules|fetchScheduleTemplates" -- . ":!.planning"`, and list the survivors, which are expected only in the two `docs/models/` records. List the `publish.ts` template-loading comment near line 3389 as a deliberate survivor: it is outside the branch, the file is held by another session, and it is not matched by the gate.

Step 6, close the todo. First `git mv .planning/todos/pending/drop-licensed-schedule-templates.md .planning/todos/completed/drop-licensed-schedule-templates.md`, and only then edit the moved file. Append a section headed "## CLOSED 2026-09-13 — quick task 260913-pnp". It says:
- Jacob decided D-19 on 2026-09-13 that the generator's structurally-derived rules may be published. The "D-19 is LIVE / unanswered / blocked" passages above are superseded. Point at `09-CONTEXT.md`'s dated resolution, and give no reason.
- The corroboration was fixed (Task 1 sha).
- The generator is wired per schedule (Task 2 sha), with the deleted files listed.
- The measured generation cost, and Jacob's 2026-09-14 choice to share grids by (roster size, matches per team): about 6.2 added publish minutes instead of about 17.6.
- The behaviour change: 101-200-team events, formerly split into two template blocks, are now scheduled whole.
- Owed, and not done by this task: the republish from the main context (every published pre-schedule band moves), and the orchestrator's local deletion of the gitignored `data/schedule-templates/`.

Step 7, the full suite and commit. Run `npx vitest run > <pnp-exec>/after-full.txt 2>&1`, the same way as the baseline. Extract the failing set the same way into `<pnp-exec>/after-failures.txt` and compare it with `baseline-failures.txt` using `comm -13`. There must be no new failures. If one appears, re-run that file alone. If it passes alone and imports nothing this task set touched, record it as a full-suite load flake, re-run the full suite once, and compare again. If it fails alone, fix it before committing. The Test Files count should be one lower than the baseline (scheduleTemplates.test.ts is gone), give or take nothing else. Explain any other difference. Run `npx tsc --noEmit -p .` once more. Commit exactly this task's paths, including both sides of the rename: `docs(260913-pnp): retire the rung-2 harness records, record Jacob's D-19 decision, close drop-licensed-schedule-templates`. Confirm with `git show --stat HEAD` that the rename carried the edited content, and that `git status --short` is clean.
  </action>
  <verify>
    <automated>test -z "$(git grep -nE 'scheduleTemplates|schedule-templates|loadScheduleTemplate|ScheduleTemplate(Unavailable|Missing|Parse)Error|SCHEDULE_TEMPLATE' -- . ':!.planning' ':!docs/models/rung2-generated-schedules.md')" && test -e .planning/todos/completed/drop-licensed-schedule-templates.md && test ! -e .planning/todos/pending/drop-licensed-schedule-templates.md && grep -q "CLOSED 2026-09-13" .planning/todos/completed/drop-licensed-schedule-templates.md && test "$(grep -c 'RESOLVED 2026-09-13' .planning/phases/09-analytic-ranking-points-browser-side-simulation/09-CONTEXT.md)" -ge 2 && sed -n 1,5p docs/models/rung2-generated-schedules.md | grep -q "260913-pnp" && sed -n 1,5p docs/models/random-vs-generated-schedules.md | grep -q "260913-pnp" && npx tsc --noEmit -p .</automated>
    <automated>comm -13 C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/ada3c4be-a9bd-410c-9d77-d101d685caba/scratchpad/pnp-exec/baseline-failures.txt C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/ada3c4be-a9bd-410c-9d77-d101d685caba/scratchpad/pnp-exec/after-failures.txt | wc -l | grep -qx "0"</automated>
  </verify>
  <done>Both rung-2 records carry the retired-harness line under their titles and are otherwise unchanged. simulation-architecture.md and the test.yml comment describe the generator. 09-CONTEXT.md holds two dated "Jacob decided" resolutions. The todo is in completed/ with its closing note. The survivor grep is empty outside .planning and the rung-2 record, with every survivor listed. The full root suite has no failure missing from the baseline. The working tree is clean after the third commit.</done>
</task>

</tasks>

<verification>
- `git log --oneline 812fd99d..HEAD` in the worktree shows exactly three commits, in order: the corroboration fix, the generator wiring and retirement, and the records.
- `git show --numstat --format= HEAD~2 -- docs/models/rung2-generated-schedules.md` is `1	1` (the re-render changed one line).
- `npx tsc --noEmit -p .` gives 0 errors. The named-file run has 0 failures, and preSchedule.test.ts has 0 skipped.
- The full root suite has no new failures against the pre-Task-1 baseline.
- Nothing outside the worktree was written except scratch files under `scratchpad/pnp-exec/`. There is no push, merge, publish, seed or deploy, and no STATE.md edit.
</verification>

<success_criteria>
- The corroboration claim is stated in numbers that exist, at matched scope, and is computed from the comparand document.
- Every presim sidecar's pairing structure comes from the rules-based generator, one fresh structure per schedule, exactly as Phase B proved. No template-reading path remains in code.
- The field-averaged measurement harness still compiles and passes, with no module cycle.
- The generation cost is priced in minutes against a stated sidecar count.
- D-19 is recorded as Jacob's decision in the todo and at both 09-CONTEXT consequences, and the todo is closed.
</success_criteria>

<output>
Return the SUMMARY text in the final message (do not Write it). The orchestrator writes `.planning/quick/260913-pnp-drop-licensed-schedule-templates/260913-pnp-SUMMARY.md`. The SUMMARY must include:
- the three commit shas
- the baseline and after figures (named-file and full-suite)
- the rendered replacement sentence, verbatim
- the pin report
- the timing and memory table: ms per call at 76x10 and 37x12 against the orchestrator's cost model, bytes per cached cell, implied memory at 72 cells, warm-read time, and the added publish minutes (~17.6 without sharing, ~6.2 with it, over 215 events and 72 cells)
- the survivor list with reasons
- the deviation from the orchestrator's task split: the three scripts, the package.json entry and the floor relocation moved into Task 2, because deleting the reader breaks their imports, so Task 3 is records only
- the 101-200-team behaviour change
- the owed items: the republish from the main context; the local `rm -rf data/schedule-templates/`; the merge to main only after 260913-nvn and 260914-01x are clear
- a note for 260913-nvn plan 04: `scripts/measureGeneratedSchedules.ts` no longer exists, and `packages/harness/preSchedule.ts` and `packages/harness/generatedSchedules.ts` were rewritten here, so its pending comment trims on those files will conflict and should be rebased onto this branch or skipped
</output>
