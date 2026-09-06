---
phase: quick-260905-tll
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [QUICK-260905-tll]
files_modified:
  - packages/harness/scheduleTemplates.ts
  - packages/harness/scheduleTemplates.test.ts
  - packages/harness/preSchedule.ts
  - packages/harness/preSchedule.test.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/pageArtifacts.test.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - packages/ingest/eventTeams.ts
  - packages/ingest/eventTeams.test.ts
  - packages/ingest/cli.ts
  - scripts/fetchScheduleTemplates.ts
  - package.json
  - docs/publish-budget.md
  - apps/web/src/lib/api/preSchedule.ts
  - apps/web/src/lib/api/preSchedule.test.ts
  - apps/web/src/lib/preScheduleResult.ts
  - apps/web/src/lib/preScheduleResult.test.ts
  - apps/web/src/routes/event.$eventKey.tsx
  - apps/web/src/components/event/SimulationTab.tsx
  - apps/web/src/components/event/SimulationTab.test.tsx
  - apps/web/src/components/event/StartMatchPicker.tsx
  - apps/web/src/components/event/StartMatchPicker.test.tsx
  - apps/web/src/components/event/RunControl.tsx
  - apps/web/src/components/event/RunControl.test.tsx

estimate:
  tokens: 340000
  raw_tokens: 170000
  tasks: 6
  confidence: low

must_haves:
  truths:
    - "Opening an event's Simulation tab on a covered event renders a rank-distribution table on FIRST PAINT with no Web Worker constructed and no client Monte Carlo executed (C-01)."
    - "The start-match slider's leftmost stop reads 'Before schedule release'; selecting it and pressing the button re-displays the baked pipeline result and the client engine does not run (C-02)."
    - "Every other slider stop still runs the existing client engine on demand, behind a button labelled 'Update simulation' (C-03)."
    - "An event with registered teams in the corpus but no qualification schedule publishes a full event artifact (roster + as-of-now metrics) instead of being skipped by publish.ts (C-15, C-17)."
    - "`pnpm ingest:event-teams` populates `event_teams` for EVERY official event in a season, not only district events (C-16)."
    - "The sidecar is fetched only while the Simulation tab is the active tab — an event page view that stays on another tab issues no sidecar request (C-10)."
    - "Republishing the same corpus twice produces byte-identical sidecar schedules and baked histograms; nothing in the sidecar path reads a wall clock or an unseeded random source (C-14)."
    - "Every published sidecar pmf is produced by the SAME `algorithm.predict()` joint-covariance RP path real matches use — no independence approximation exists anywhere in the code path (C-04)."
    - "A missing schedule template fails loudly, naming the missing path and the fetch script, rather than degrading to a fabricated schedule (C-11)."
  artifacts:
    - packages/harness/scheduleTemplates.ts
    - packages/harness/preSchedule.ts
    - scripts/fetchScheduleTemplates.ts
    - packages/ingest/eventTeams.ts
    - apps/web/src/lib/api/preSchedule.ts
    - apps/web/src/lib/preScheduleResult.ts
    - "packages/harness/pageArtifacts.ts :: preScheduleKey + PreScheduleArtifactSchema"
    - "packages/harness/publish.ts :: pre-event walk-forward state map + scheduleless event branch + sidecar upload"
  key_links:
    - "`preScheduleKey()` is the ONE spelling of the sidecar R2 key, imported by BOTH packages/harness/publish.ts and apps/web/src/lib/api/preSchedule.ts. Two spellings means a silent permanent 404."
    - "`PreScheduleArtifactSchema`'s baked-histogram refinements (length === roster.length, sum === draws) are what make `MalformedRankHistogramError` in apps/web/src/components/event/rankRows.ts unreachable in front of a visitor."
    - "`preEventStateByAlgoEvent` (publish.ts's per-match completion hook) feeds `buildPreScheduleArtifact`'s `predict` closure. If that map ever holds POST-event state the whole walk-forward honesty claim is false and nothing else detects it."
    - "The sidecar key is deliberately NOT a `PageKind` member, so apps/worker/src/artifactWriter.ts's `SCHEMA_BY_PAGE`-keyed writer structurally cannot clobber it (C-18)."
    - "The `activeTab === \"simulation\"` gate lives in apps/web/src/routes/event.$eventKey.tsx, never inside SimulationTab — Radix keeps every TabsContent mounted-but-hidden, so a query inside the tab would fetch on every event page load."
---

<objective>
Ship pre-schedule rank simulation: the pipeline prices K=20 synthetic qualification
schedules per covered event with the exact Sigma1/VPR joint-covariance RP model, bakes a
default rank distribution from them, and publishes both as a lazily-fetched R2 sidecar. The
event page's Simulation tab shows that baked result as its default view for every covered
event, gains a "Before schedule release" leftmost slider stop, and relabels its run button
"Update simulation". Scheduleless events get a full event page for the first time, with the
roster read from the corpus `event_teams` table — which this task also widens from
district-only to every official event.

Purpose: the Simulation tab currently renders nothing until a visitor presses a button, and
an event with no schedule yet has no page at all. Both are the highest-value moments for an
FRC audience (the week before a schedule drops), and both are currently blank.

Output: two new pipeline modules, one new sidecar artifact schema + key, one new ingest
mode, a widened publish path, and a reworked Simulation tab. Code + schemas + tests only —
the season republish that actually generates the sidecars is an orchestrator follow-up.

**WORKTREES MUST BE DISABLED FOR THIS PLAN.** Tasks 1, 2 and 4 read `data/schedule-templates/`
and `data/corpus.sqlite`, both gitignored, and neither is carried into a git worktree.

**EXECUTORS HAVE NO NETWORK.** No task here runs `pnpm publish:seasons`, `pnpm ingest:*`, a
live-origin read-back, or `scripts/fetchScheduleTemplates.ts`. Those are orchestrator
follow-ups listed at the bottom of this file.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.planning/quick/260905-tll-pre-schedule-rank-simulation-pipeline-pr/260905-tll-CONTEXT.md
@.planning/quick/260905-tll-pre-schedule-rank-simulation-pipeline-pr/260905-tll-RESEARCH.md

Read RESEARCH.md's Finding 1-7 before Task 4 and its Finding 5 before Tasks 5-6. Every line
number it cites was opened during research and is current.
</context>

<execution_notes>
**Test scope (project memory `project_test_scope_trap`, `project_timeout_pnpm_false_green`).**
Run tests as `npx vitest run <path>` from the REPO ROOT. Never `timeout <n> pnpm test` — that
combination swallows all output and exits 0. Judge a run by its printed summary, not its exit
code. The root `vitest.config.ts` declares a `node` project (`packages/**`, `scripts/**`,
`apps/worker/**`) plus the `apps/web` project, so a root-level path filter reaches both.

**Typecheck.** Root `pnpm typecheck` (`tsc --noEmit`) does NOT cover `apps/web`; the
authoritative web command is `pnpm --filter web typecheck`. `apps/worker` currently has FOUR
pre-existing `tsc` errors about `redDqs`/`blueDqs` that predate 2026-09-05 — do not
misattribute them to this work and do not fix them here.

**Secrets (CLAUDE.md, non-negotiable).** Never `Read`, `cat`, `echo` or interpolate `.env` or
any value from it. `putObject` reads its own credentials from `process.env`; no file in this
plan touches `process.env` directly.

**No new dependencies.** Every module here uses native `fetch`, `node:fs`, `zod`, and existing
workspace modules. No `pnpm add`, so no package-legitimacy checkpoint applies.
</execution_notes>

<source_coverage_audit>
Every CONTEXT.md decision, given a stable ID here because CONTEXT.md numbers none of them.
Cite these IDs in commits and the SUMMARY.

| ID | Decision (CONTEXT.md) | Covered by |
|----|------------------------|------------|
| C-01 | Baked pre-schedule result is the DEFAULT Simulation-tab view for every covered event, always; zero client compute on first paint | Task 6 |
| C-02 | Leftmost slider stop "Before schedule release"; selecting it + button re-displays the baked result, client engine does NOT run | Task 6 |
| C-03 | All other stops run the existing client engine; button label becomes "Update simulation" | Task 6 |
| C-04 | All pricing pipeline-side with the exact joint-covariance RP model (Phase 7 D-11); no browser approximation | Task 2, Task 4 |
| C-05 | Current season onward now, but the season cutoff is a PARAMETER, never hardcoded deep in the pipeline | Task 4 |
| C-06 | Events with schedules/results priced with walk-forward PRE-EVENT state | Task 4 |
| C-07 | Scheduleless events priced with current state; regenerated each full publish while no real schedule exists; frozen once the real schedule lands | Task 4 (see PD-02) |
| C-08 | K=20 synthetic schedules, each a match list of red trio / blue trio / redRpPmf / blueRpPmf in the existing pmf encoding | Task 2 |
| C-09 | Baked default result = precomputed per-team rank distribution, same shape the client engine outputs | Task 2, Task 5 |
| C-10 | Sidecar lazy-loaded — fetched when the Simulation tab opens, not with the main event artifact | Task 5 |
| C-11 | Templates CACHED into gitignored `data/schedule-templates/`, never vendored; fail loudly with a run-the-fetch-script message when one is missing | Task 1 |
| C-12 | matchesPerTeam = actual when the real schedule is known, else 12 (10 for championship divisions); cheesy-arena TRUNCATION, not rounding | Task 1 |
| C-13 | Team counts without an exact template use the nearest-template / split trick | Task 1 |
| C-14 | Per-simulated-schedule team-to-slot assignment is a SEEDED shuffle (deterministic republishes) | Task 2 |
| C-15 | Scheduleless events get a full event page: roster from `event_teams`, as-of-now metrics, live Simulation tab, schedule-not-released empty states elsewhere | Task 4, Task 6 |
| C-16 | Widen the ingest to fetch registered teams for ALL events, not district-only | Task 3 |
| C-17 | publish.ts's zero-predictions/zero-upcoming skip and match-only roster derivation both change; single-event mode's "No completed matches" throw needs the scheduleless branch | Task 4 |
| C-18 | Worker never generates/regenerates sidecars and never simulates; must not clobber or delete existing sidecars | Task 1 (key stays out of `PageKind`) |

Claude's-discretion items resolved in this plan, each recorded so a reader can find the
reasoning: sidecar key/versioning and Zod shape (Task 1, PD-01), roster-index byte encoding
(Task 1), 20 schedules x 50 draws = 1000 (Task 2, matches the client's `SIMULATION_DRAWS`),
surrogate handling (Task 2, PD-03), UI copy (Task 6, subject to the sketch skill).

Deferred Ideas: CONTEXT.md records none. No item above is unplanned; no phase split needed.
</source_coverage_audit>

<planner_decisions>
Decisions this plan makes that a reader could otherwise mistake for drift. Implement these as
written; if a task's reality contradicts one, stop and report rather than improvising.

**PD-01 — The sidecar is NOT a `PageKind`.** It gets its own exported `preScheduleKey()` and
its own schema, following the `districtsIndexKey`/`districtDetailKey` precedent documented at
`packages/harness/pageArtifacts.ts` around line 1420. Three things fall out of that single
choice at once: `apps/worker/src/artifactWriter.ts`'s `SCHEMA_BY_PAGE`-keyed writer
structurally cannot clobber the sidecar (C-18), `packages/harness/payloadBudget.test.ts`'s own
`PAGE_KINDS` list stays untouched, and the event artifact's reachable 350,000-byte ceiling is
never approached. `PAGE_ARTIFACT_SCHEMA_VERSION` is NOT bumped — this file's established
convention is that an additive new artifact kind never bumps it.

**PD-02 — "Freeze once the schedule lands" is implemented as a source-of-state switch, not an
R2 read-before-write.** C-07's literal mechanism (do not overwrite) would require a `get`
before every `put`, at ~300 events x 7 seasons. The corpus already answers the same question
more cheaply and more honestly: if the corpus holds at least one qualification match row for
an event, its schedule HAS landed, so the sidecar is priced from the walk-forward PRE-EVENT
state (C-06) — which is precisely "what we knew before the schedule was released", and is
stable across republishes because it is a function of the corpus prefix, not of the run. If
the corpus holds ZERO qualification rows, the schedule has not landed and the sidecar is
priced from current (season-final) state and regenerated every publish (C-07). No R2 read, no
freeze flag, and the frozen snapshot a reader eventually sees is strictly more honest than
freezing a current-state pricing would have been. **This is a deliberate reading of C-07;
record it in the SUMMARY so the user can reject it if they meant the literal mechanism.**

**PD-03 — Surrogate slots are honoured, and the mechanism is representable.** cheesy-arena
templates carry a per-slot surrogate flag, and a surrogate appearance earns no ranking credit.
`SimMatchInput` has no surrogate field and `simulateRanks` owns no exclusion rule — but it does
not need one: a surrogate is included in the alliance handed to `algorithm.predict()` (it plays,
so it contributes to the alliance's predicted RP) and EXCLUDED from that match's
`redTeamKeys`/`blueTeamKeys` when the match is handed to `simulateRanks` (so the drawn RP is
credited only to the two non-surrogates). This closes RESEARCH.md Pitfall 10 positively rather
than absorbing it as a disclosed inaccuracy.

**PD-04 — A cold-start season's very first event gets NO sidecar.** Its honest pre-event state
is the algorithm's internal cold-start state, which `WalkForwardSimulator` does not expose. An
absent sidecar renders as the ordinary pre-run placeholder; a fabricated one would render as a
confident distribution built from nothing. Log the skip by event key; never substitute.

**PD-05 — The scheduleless roster widening is narrow on purpose.** `event_teams` is unioned
into an event's roster ONLY when the match-derived roster is empty. Unioning it
unconditionally would add registered-but-never-played teams to every already-published event's
standings table, changing bytes and rendered rows across the whole corpus for no requirement
in this task.

**PD-06 — Offseason and RP-ineligible events get no sidecar.** `eventTierFor` throws for an
unmapped `event_type` (99/Offseason is deliberately absent from `EVENT_TYPE_TIERS`), so a
synthetic match at such an event would crash the publish rather than degrade. Gate on
`isRpEligibleEventType(event_type)` BEFORE constructing any synthetic match. The client's
existing `SIMULATION_UNAVAILABLE_*` state already covers those events, and the two conditions
coincide cleanly.
</planner_decisions>

<tasks>

<task type="auto">
  <name>Task 1: Schedule-template cache reader, fetch script, and the sidecar key + schema</name>
  <files>packages/harness/scheduleTemplates.ts, packages/harness/scheduleTemplates.test.ts, packages/harness/pageArtifacts.ts, packages/harness/pageArtifacts.test.ts, scripts/fetchScheduleTemplates.ts, package.json</files>
  <precondition>`data/schedule-templates/` exists and holds 1330 `.csv` files plus a `LICENSE` file. It is gitignored via `.gitignore`'s `data/*` rule and is NOT carried into a git worktree — if it is absent, stop and report rather than fetching (executors have no network).</precondition>
  <read_first>
    - packages/harness/pageArtifacts.ts lines 60-160 (PAGE_ARTIFACT_SCHEMA_VERSION, PageKind, assertVersionShape, artifactKey) and 1390-1442 (the districts precedent this task follows) and 300-315 (isValidPmf).
    - scripts/publishAlgorithmsManifest.ts for the standalone-script scaffolding shape (parseArgs, deep relative `.js` imports, main() guarded on entry point).
    - data/schedule-templates/34_12.csv — one real template, to confirm the 12-column layout before writing the parser.
  </read_first>
  <action>
Create `packages/harness/scheduleTemplates.ts`, a pure Node module that reads the gitignored
cheesy-arena template cache. It owns four exported things and no I/O beyond `readFileSync`:

- `SCHEDULE_TEMPLATE_DIR`, the literal relative path `data/schedule-templates`. Resolve
  template paths against `process.cwd()`, matching how `CORPUS_PATH` is used elsewhere in the
  harness.
- `ScheduleTemplateMissingError`, a named error whose message states the exact missing file
  path and instructs the reader to run `pnpm fetch:schedule-templates` (C-11). This is the
  loud failure the CONTEXT requires; there is no silent degrade path and no fabricated
  schedule anywhere in this module.
- `ScheduleTemplateUnavailableError`, a separate named error for a team count the grid cannot
  serve at all (fewer than 6 teams, or a split block that still falls outside 6-100). A caller
  is expected to catch this and skip the event, so it must be distinguishable from the missing
  file case by type, not by message text.
- `matchesPerTeamFor(numTeams, qualMatchCount)` returning
  `Math.trunc((qualMatchCount * 6) / numTeams)` clamped into the closed interval 1..14.
  Cheesy-arena's own `tournament/schedule.go` TRUNCATES; CONTEXT's earlier `round` phrasing is
  superseded by the upstream convention (C-12). Also export
  `defaultMatchesPerTeam(eventType)` returning 10 for TBA event type 3 (Championship Division)
  and 12 otherwise — the Statbotics convention, used when the real schedule is unknown.
- `loadScheduleTemplate(numTeams, matchesPerTeam)` returning a readonly array of template
  matches. Each element carries a `red` and a `blue` array of three ZERO-BASED slot indices,
  plus `redSurrogate` and `blueSurrogate` arrays of three booleans.

Parser contract: each CSV line is twelve integers with no header, ordered red1, red1Surrogate,
red2, red2Surrogate, red3, red3Surrogate, blue1, blue1Surrogate, blue2, blue2Surrogate, blue3,
blue3Surrogate. Team values are ONE-BASED indices into a shuffled team list and must be
converted to zero-based on read; surrogate values are 1 or 0. Reject a line that does not
parse into twelve finite integers, or that carries a slot index outside 1..numTeams, with a
named error that states the file and the line number — a malformed cache entry must fail
loudly rather than produce an off-by-one schedule.

Team-count coverage (C-13): a `numTeams` in 6..100 reads
`{numTeams}_{matchesPerTeam}.csv` directly. Above 100, split into two blocks of
`Math.ceil(n/2)` and `Math.floor(n/2)`, load each independently, offset every index in the
second block by the first block's team count, and concatenate the two match lists. Throw
`ScheduleTemplateUnavailableError` when either block still falls outside 6..100 or when
`numTeams` is below 6. Memoize parsed templates in a module-level `Map` keyed by
`{numTeams}_{matchesPerTeam}` — a full-season publish loads the same handful of templates
hundreds of times.

Record in the module's doc comment, as a positive fact rather than a caveat, that the template
row count is `ceil(numTeams * matchesPerTeam / 6)` and can therefore differ from a real event's
qualification count by a row or two; this is harmless for a synthetic schedule.

Create `scripts/fetchScheduleTemplates.ts`. It downloads the complete 6..100 by 1..14 grid plus
the upstream `LICENSE` from
`https://raw.githubusercontent.com/Team254/cheesy-arena/main/schedules/{n}_{m}.csv` into
`SCHEDULE_TEMPLATE_DIR`, skipping any file already present, using native `fetch`, with a
`main()` guarded on being the process entry point and a non-zero exit on failure. Its doc
comment must state plainly why the CSVs are cached and never committed: the upstream licence
is Team 254's own custom licence, NOT MIT, and it grants redistribution only for contributing
back upstream — SigmaScout is a public repo, so committing them would be redistribution. State
that Statbotics fetches these at runtime for the same reason. **This script is written but not
run by this task; executors have no network.**

Register `"fetch:schedule-templates": "tsx scripts/fetchScheduleTemplates.ts"` in the root
`package.json` scripts block, placed beside the other `tsx scripts/...` entries.

In `packages/harness/pageArtifacts.ts`, add the sidecar's key function and schema in a new
section BELOW the districts section, so the districts precedent comment sits immediately above
the code that follows it (PD-01):

- `preScheduleKey({ eventKey, algorithmId, version })` returning
  `v1/presim/{eventKey}/{algorithmId}@{version}.json`, calling the existing
  `assertVersionShape` first. Its doc comment must state, in its own words, why it is an
  exported standalone function and deliberately absent from `PageKind`/`ArtifactKeyParams`,
  citing the same three consequences the districts comment cites.
- `PreScheduleArtifactSchema`, extending `AlgorithmScopedPreambleSchema` with: `eventKey`
  (non-empty string), `season` (int), `pricedFrom` (an enum of exactly the two literals
  `pre-event-walk-forward` and `current-state`), `matchesPerTeam` (positive int),
  `roster` (a non-empty array of non-empty strings, the team keys that define the index space
  for everything below), `schedules` (a non-empty array of objects each holding a `seed` int
  and a non-empty `matches` array), and `baked` (an object with a positive int `draws` and a
  non-empty `histograms` array of int arrays).
  Each schedule match uses the compact roster-index encoding: `r` and `b` are three-element
  int arrays of roster indices, `rp` and `bp` are number arrays holding the red and blue RP
  pmfs. Name the two pmf fields' doc comments so a reader knows they carry exactly the same
  physical quantity, in the same encoding and at the same `ROUNDING_RULE.pmf` precision, as
  `EventMatchSchema`'s own `redRpPmf`/`blueRpPmf`.
  Add four refinements, each with its own message naming the rule it enforces: every `rp` and
  `bp` passes the existing module-private `isValidPmf`; every index in every `r`/`b` lies in
  `[0, roster.length)`; `baked.histograms.length` equals `roster.length`; and every histogram
  has length `roster.length` and sums exactly to `baked.draws`. Those last two are the
  publish-boundary guarantee that makes `MalformedRankHistogramError` in
  `apps/web/src/components/event/rankRows.ts` unreachable in front of a visitor.
- Export `PreScheduleArtifact` as the inferred type.
- Do NOT bump `PAGE_ARTIFACT_SCHEMA_VERSION`, do NOT widen `PageKind`, and do NOT touch
  `apps/worker/src/artifactWriter.ts`.

Write `packages/harness/scheduleTemplates.test.ts` covering, against the REAL cache: a direct
6..100 load returning the expected row count and zero-based indices in range; the surrogate
flags parsed as booleans on a template that has some; `matchesPerTeamFor` truncating rather
than rounding at a case where the two differ, and clamping at both ends; `defaultMatchesPerTeam`
returning 10 for event type 3 and 12 for types 0 and 1; a below-6 team count and an
above-200 team count each throwing `ScheduleTemplateUnavailableError`; a 110-team count
producing a concatenated two-block schedule whose indices span 0..109; and a
deliberately-absent `(numTeams, matchesPerTeam)` pair throwing `ScheduleTemplateMissingError`
with a message mentioning the fetch script.

Extend `packages/harness/pageArtifacts.test.ts` with sidecar cases: `preScheduleKey` builds the
expected string and throws `MissingVersionSeparatorError` for a version with no `+`; a
well-formed sidecar object parses; and each of the four refinements rejects a targeted mutation
of an otherwise-valid object (a pmf that sums to 0.9, an out-of-range roster index, a histogram
count that disagrees with the roster length, and a histogram that sums to one less than `draws`).
  </action>
  <verify>
    <automated>npx vitest run packages/harness/scheduleTemplates.test.ts packages/harness/pageArtifacts.test.ts</automated>
  </verify>
  <done>`loadScheduleTemplate` returns real parsed cheesy-arena rows with zero-based indices and surrogate flags; a missing template throws an error naming the fetch script; `preScheduleKey` and `PreScheduleArtifactSchema` exist in pageArtifacts.ts; `PageKind`, `PAGE_ARTIFACT_SCHEMA_VERSION` and apps/worker are all untouched; both test files pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: The pure pre-schedule sidecar builder</name>
  <files>packages/harness/preSchedule.ts, packages/harness/preSchedule.test.ts</files>
  <precondition>Task 1's `loadScheduleTemplate` and `PreScheduleArtifactSchema` are in place and their tests pass. `data/schedule-templates/` is populated.</precondition>
  <read_first>
    - packages/core/algorithms/simulation/rankSimulation.ts in full (mulberry32, SimMatchInput, SimTeamBaseline, SimResult, simulateRanks).
    - packages/core/algorithms/types.ts lines 18-43 (the `UpcomingMatch` shape a synthetic match must satisfy).
    - packages/harness/rounding.ts lines 200-220 (`roundPmf` — rounds then renormalizes).
    - packages/core/algorithms/sigma1/rp/constants.ts lines 50-110 (`EVENT_TYPE_TIERS`, `eventTierFor`, `isRpEligibleEventType`).
  </read_first>
  <behavior>
    - Two calls with identical parameters produce deep-equal artifacts, including every seed, every shuffled slot assignment, and every baked histogram count.
    - Changing only `eventKey` (or only `algorithmVersion`) changes the shuffles; changing neither does not.
    - A `predict` closure that returns no `redRpPmf` causes the builder to return `null` after pricing exactly ONE synthetic match — it does not price the remaining 20 schedules first.
    - Every team on the roster appears in the baked histogram map exactly once, its histogram has length `roster.length`, and every histogram sums to `scheduleCount * drawsPerSchedule`.
    - A team occupying a surrogate slot in a template match is present in that match's `UpcomingMatch.redSurrogates`/`blueSurrogates` handed to `predict`, and absent from the `SimMatchInput` team-key list handed to `simulateRanks` (PD-03).
    - The returned object round-trips through `PreScheduleArtifactSchema.parse` unchanged.
  </behavior>
  <action>
Create `packages/harness/preSchedule.ts` exporting one function,
`buildPreScheduleArtifact(params)`, returning `PreScheduleArtifact | null`. It performs no
corpus read, no R2 call, no filesystem access beyond Task 1's template reader, and no wall-clock
read — every value that varies between runs is either passed in or derived from a seed.

Parameters: `eventKey`, `season`, `eventType`, `algorithmId`, `algorithmVersion`, a readonly
`roster` of team keys, `matchesPerTeam`, `pricedFrom` (the two-literal union from Task 1's
schema), `scheduleCount`, `drawsPerSchedule`, `generation`, `computedAt`, and a
`predict(match: UpcomingMatch) => Prediction` closure. The closure is how C-04 is honoured
structurally: this module never touches a model, it only calls back into whatever
`algorithm.predict(state, match)` the caller has already bound to the right walk-forward state.

Steps, in order:

1. Sort a copy of `roster` ascending by team key. That sorted array IS the published `roster`
   and defines the index space for every `r`/`b` array and every baked histogram. Sorting rather
   than trusting caller order is what makes republish determinism independent of corpus row
   order.
2. Call `loadScheduleTemplate(sortedRoster.length, matchesPerTeam)`. Let
   `ScheduleTemplateUnavailableError` and `ScheduleTemplateMissingError` propagate — the caller
   decides whether to skip the event or fail the run.
3. For each schedule index `k` from 0 to `scheduleCount - 1`, derive a seed by hashing the
   string formed from `eventKey`, `algorithmVersion` and `k` with a small FNV-1a 32-bit hash
   written inline in this module, then build `mulberry32(seed)` and run a Fisher-Yates shuffle
   over the roster index array (C-14). Never call the platform's non-seedable random source and
   never read a clock. Publish that seed on the schedule object so a reader can reproduce the
   shuffle.
4. Map each template match's slot indices through the shuffle to produce roster indices, and
   build an `UpcomingMatch` for pricing: `matchKey` shaped as `{eventKey}_presim{k}_qm{n}` with
   `n` one-based (unique, and structurally incapable of colliding with a real TBA match key),
   `eventKey`, `compLevel` `"qm"`, `setNumber` 1, `matchNumber` `n`, the two three-team key
   arrays, the two surrogate key arrays derived from the template's surrogate flags, and
   `eventType` carried through from the real event. `eventType` is load-bearing, not decorative:
   the RP fold gates pmf production on `isRpEligibleEventType(match.eventType)`.
5. Call `predict` on the FIRST synthetic match only, before building the rest. If its result
   carries no `redRpPmf` or no `blueRpPmf`, return `null` immediately, documented as "this
   algorithm does not model ranking points" — not an error, and cheap enough that a full-season
   publish across three algorithms wastes nothing on the two that have no RP model.
6. Otherwise price every synthetic match, running both pmfs through `roundPmf` before storing
   them, exactly as `buildEventArtifact` does for real matches. A pmf that goes missing partway
   through a schedule is genuine corruption, not an expected state: throw a named
   `PreSchedulePricingError` stating the synthetic match key.
7. Build the baked result (C-09). Baselines are one entry per roster team with `earnedRpSum` 0
   and `matchesPlayed` 0 — nobody has played, which is exactly what "before schedule release"
   means. For each schedule `k`, call `simulateRanks` with that schedule's `SimMatchInput` list
   (surrogate slots removed from the team-key arrays per PD-03), the baselines,
   `drawsPerSchedule`, and a `mulberry32` seeded from a second, distinct hash of the same
   inputs. Sum the K per-schedule histograms element-wise into one histogram per team, so the
   published total draw count is `scheduleCount * drawsPerSchedule`. Store the histograms as
   plain number arrays indexed by roster position, in roster order.
8. Assemble the object with the preamble fields and return
   `PreScheduleArtifactSchema.parse(assembled)` — parse, not `safeParse`, so a builder bug can
   never reach R2.

Write `packages/harness/preSchedule.test.ts` covering every bullet in this task's `<behavior>`
block, plus: a roster whose sorted order differs from its input order producing the same
artifact from both orders; and an explicit assertion that the summed baked histograms equal
`scheduleCount * drawsPerSchedule` for every team. Use a hand-written `predict` stub returning
a fixed seven-entry pmf so the tests need no model and no corpus.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/preSchedule.test.ts</automated>
  </verify>
  <done>`buildPreScheduleArtifact` produces a schema-valid sidecar from a stub `predict`, is byte-deterministic across two calls, returns null for an RP-less algorithm after one priced match, honours surrogate slots per PD-03, and its baked histograms satisfy the length and sum invariants `rankRows.ts` requires.</done>
</task>

<task type="auto">
  <name>Task 3: Widen the registered-teams ingest from district-only to every official event</name>
  <files>packages/ingest/eventTeams.ts, packages/ingest/eventTeams.test.ts, packages/ingest/cli.ts, package.json</files>
  <read_first>
    - packages/ingest/cli.ts lines 133-250 (CliOptions and parseCliOptions), 799-876 (`ingestSeasonAwardsOnly` — the narrowest standalone `*-only` mode, and the shape to copy), 877-1000 (main()'s mode dispatch).
    - packages/corpus/db.ts lines 1330-1370 (`upsertEventTeam`, `selectEventTeamsForEvents` and its absence discipline).
    - packages/ingest/districts.test.ts for the temp-corpus test harness shape used in this package.
  </read_first>
  <action>
`event_teams` is populated today only inside the `--districts-only` loop, so it covers 150 of
2026's 310 events and ZERO regionals, championships, preseason or offseason events. That leaves
exactly two scheduleless 2026 events with a roster, which would make Task 4's and Task 6's
pre-schedule page deliverable nearly inert. Widen it (C-16).

Create `packages/ingest/eventTeams.ts` holding the two pure, testable pieces the new mode
needs, so they can be tested without importing the CLI:

- `selectOfficialEventKeysForYear(db, year)` returning the ascending-sorted event keys for that
  year whose `event_type` passes the shared `isOfficialEventType` predicate from
  `packages/core/algorithms/eventTypes.ts`. Read the predicate, never re-list the type numbers
  here — that shared predicate is already the single source `publish.ts` and
  `apps/worker/src/scheduled.ts` both read, and a fourth copy of the list is how the four drift.
- `eventTeamsUrlFor(eventKey)` returning the `/event/{key}/teams/keys` path, so the CLI and the
  ETag cache key can never be spelled differently.

In `packages/ingest/cli.ts`, add an `--event-teams-only` mode following
`ingestSeasonAwardsOnly`'s shape exactly — a narrow standalone mode that runs over an
ALREADY-INGESTED season, reading its event-key set from the corpus's own `events` table rather
than re-fetching `/events/{year}`:

- Add `"event-teams-only"` to the `parseArgs` options block and an `eventTeamsOnly` field to
  `CliOptions` (with a doc comment naming this quick task and the reason).
- Add `ingestSeasonEventTeamsOnly(db, ctx, year, force)` that iterates
  `selectOfficialEventKeysForYear`, calls the existing `fetchEventTeamKeys` with
  `cachedEtagFor`, and on a 200 parses with `tbaKeysResponseSchema` and upserts every key
  through `upsertEventTeam`. Copy the established 404 handling verbatim in intent: a
  placeholder or unregistered event key returning 404 is an honest nothing-to-fetch for that
  event, logged and skipped, never a thrown run failure; any other error rethrows. A 304 is a
  cache hit, counted and skipped. Write the ETag on a 200.
- Print the same style of summary line the other modes print: events considered, populated,
  cache hits, not-found, and total registration rows stored.
- Wire the mode into `main()`'s dispatch chain beside the other `*-only` branches, including
  the same per-year `recordIngestRun` progress write.
- Document, in the mode's own doc comment, the same caching rule every other `*-only` mode
  states: a re-run over an already-ingested season needs `--force`, because a cached-ETag 304
  carries no body.

Register `"ingest:event-teams": "tsx --env-file=.env packages/ingest/cli.ts --event-teams-only"`
in the root `package.json`, beside the other `ingest:*` entries.

Write `packages/ingest/eventTeams.test.ts` seeding a temp corpus with events of type 0, 1, 3,
99 and 100 across two years, asserting that `selectOfficialEventKeysForYear` returns exactly
the official ones for the requested year in ascending order, excludes offseason and preseason,
and returns an empty array for a year with no rows. Add one case asserting `eventTeamsUrlFor`
produces the exact path string the ETag cache is keyed on.

**Do not run the ingest.** Executors have no network; the real backfill run is an orchestrator
follow-up.
  </action>
  <verify>
    <automated>npx vitest run packages/ingest/eventTeams.test.ts &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <done>`pnpm ingest:event-teams --years 2026-2026` exists as a registered script and a wired CLI mode that fetches `/event/{key}/teams/keys` for every official event of a season; the pure helpers are covered by tests; the root typecheck is clean apart from the four pre-existing apps/worker `redDqs`/`blueDqs` errors.</done>
</task>

<task type="auto">
  <name>Task 4: publish.ts — pre-event walk-forward state, scheduleless event artifacts, and sidecar upload</name>
  <files>packages/harness/publish.ts, packages/harness/publish.test.ts, docs/publish-budget.md</files>
  <precondition>`data/corpus.sqlite` exists at the repo root (gitignored, not carried into a worktree). Tasks 1-2 are complete and their tests pass.</precondition>
  <read_first>
    - packages/harness/publish.ts lines 1230-1300 (`BoundedUploader`), 1366-1398 (`metricsAsOfEvent` and its PD-04 fallback), 1690-1800 (per-season setup, `initialStates`, the per-match completion hook), 1879-1950 (the per-algorithm block and `scheduledPredictionsByEvent`), 2069-2121 (the per-event artifact loop and the skip at line 2078), 2380-2500 (`runEventMode`).
    - packages/harness/publish.test.ts lines 3135-3160 (the structural stand-in that pins `runEventMode`'s call counts).
    - RESEARCH.md Findings 1, 2 and 7 in full before writing any code in this task.
  </read_first>
  <action>
Four changes to `packages/harness/publish.ts`, in this order.

**(a) Capture pre-event walk-forward state (C-06).** Today the per-match completion hook stores
state AFTER `update`, so `stateByAlgoEvent` holds each event's POST-event state; the file says
so in its own comment. Beside it, add `preEventStateByAlgoEvent` (the same
per-algorithm map-of-maps shape) and a `lastStateByAlgo` map. Inside the SAME hook, BEFORE the
existing post-event `.set`, if the pre-event map does not yet have `match.eventKey`, write into
it whatever `lastStateByAlgo` holds for this algorithm, falling back to
`initialStates?.get(algorithmId)` when it holds nothing — that is the state after the previous
chronological match, which is by construction the state immediately before this event's first
match. Then update `lastStateByAlgo`. Use `.has()`, never a truthiness test: state is typed
`unknown` and a falsy state object is representable. Three facts to record in the code comment
rather than rediscover later: no second replay pass and no second corpus read is added; events
run concurrently, so "the state before event X's first match" is genuinely the GLOBAL state at
that instant, which is the correct walk-forward answer and not a defect; and every algorithm's
`update` returns a NEW state object, so storing the reference is a real snapshot. Apply the
same treatment to `runEventMode`'s own smaller hook, using a single map and a single
`lastState` local. Add NO second `buildSeasonStream`, `sortedPoolsByMetric` or
`metricsAsOfEvent` call inside `runEventMode` — a structural test pins each of those at exactly
one occurrence in that function's source range.

**(b) Publish scheduleless events (C-15, C-17).** Once per season, before the per-algorithm
loop, read the registered-teams map for every event key in `eventMeta` via
`selectEventTeamsForEvents`. Respect its absence discipline exactly: an event with no rows is
ABSENT from the map, and an absent key means "unknown", not "zero teams" — never coalesce it
into an empty array and publish an empty roster. In the per-event artifact loop, replace the
skip that currently drops an event with zero predictions and zero upcoming matches: an event
now survives when it has predictions, OR upcoming matches, OR a non-empty registered-team
list. When and only when the match-derived roster is empty, use the registered team list as
`eventTeamKeys` (PD-05 — do not union it in for events that already have matches; that would
change every already-published event's standings). `metricsAsOfEvent` already falls back to
season-final metrics for an event with no captured state, which is exactly the as-of-now
metrics a pre-schedule page should show, so no change is needed there. In `runEventMode`, the
"No completed matches found in corpus for event" throw must gain the same scheduleless branch:
when the event has zero completed matches but DOES have registered teams, proceed with a
roster-only artifact instead of throwing; keep the throw, unchanged in message, for an event
with neither.

**(c) Generate and upload the sidecar (C-04, C-05, C-06, C-07, PD-02, PD-04, PD-06).** Add a
`preScheduleFromSeason` option to `publishSeasons`' options, defaulting to 2026, surfaced as a
`--presim-from-season` CLI flag in `main()`'s `parseArgs` block and threaded through
`runSeasonsCliMode`. It must be a parameter end to end — the cutoff appears in exactly one
place, the default, and nowhere inside the per-event logic (C-05).

Inside the per-algorithm per-event loop, for each event, generate a sidecar when ALL of these
hold, and log a one-line skip reason with the event key when any fails: the season is at or
above `preScheduleFromSeason`; `isRpEligibleEventType(e.event_type)` is true (PD-06); the
roster has at least 6 teams; and a pricing state is available. Choose the pricing state and
`pricedFrom` by the corpus, not by R2 (PD-02): if this event has at least one qualification
match in the corpus (played or scheduled), take the pre-event state from
`preEventStateByAlgoEvent` and set `pricedFrom` to the walk-forward literal; if that map has no
entry for the event, this is the cold-start season's first event, so skip the sidecar entirely
and log it (PD-04). If the event has zero qualification matches in the corpus, take the
season-final `state` already in scope and set `pricedFrom` to the current-state literal.

Derive `matchesPerTeam` with `matchesPerTeamFor(rosterSize, qualCount)` when the event has
qualification matches, and with `defaultMatchesPerTeam(e.event_type)` when it does not (C-12).
Call `buildPreScheduleArtifact` with a `predict` closure bound to the chosen state and this
algorithm. A `null` return means this algorithm has no RP model — skip silently, no log spam.
Catch `ScheduleTemplateUnavailableError` and skip that one event with a logged reason; let
`ScheduleTemplateMissingError` propagate and fail the run, because a missing cache entry is an
operator problem the run must surface loudly (C-11).

Upload through a NEW `publishSidecar(key, body)` method on `BoundedUploader` that reuses the
same bounded semaphore and the same `application/json` / `max-age=60` headers, but records into
its own separate array rather than the `PageKind`-keyed `records` array. Do not widen
`PageKind`, do not touch `computePageKindSizeStats`, and do not add an entry to
`payloadBudget.test.ts`'s own `PAGE_KINDS` list (PD-01). Write each sidecar BEFORE the event
artifact for the same event is written, following this repo's established artifacts-before-index
ordering rule. After the season's uploads settle, print a sidecar size summary line — count,
median, p95, max, and the largest key — in the same shape the page-kind summary prints, so the
figures can be transcribed by hand after a real run. Wire the same generation path into
`runEventMode` so a single-event subset publish also writes its sidecar.

**(d) Document the new artifact.** Add a short prose subsection to `docs/publish-budget.md`
describing the `presim` sidecar: what it is, that it lives outside `PageKind` and outside the
machine-readable budget block on purpose, the projected per-event byte cost from RESEARCH.md's
measurement (roughly 160 KB at a 43-team, 86-qual event under roster-index encoding), and an
explicit statement that the real measured figures are pending the first republish. **Do not
invent numbers and do not add a `pages.presim` entry to the machine-readable JSON block** —
that block is transcribed by hand from a real run, and a fabricated row there is exactly the
kind of number this project's premise forbids.

Extend `packages/harness/publish.test.ts` with, at minimum: a seeded two-event season proving
the captured pre-event state for the LATER event differs from that event's post-event state and
equals the state after the earlier event's last match (a fixture-vacuity guard asserting the two
values genuinely differ must come first); a seeded corpus where an event has `event_teams` rows
and zero matches, proving an event artifact is now published for it with the registered roster
and non-empty metrics; a case proving an event with neither matches nor registered teams is
still skipped; and a case proving a sidecar object is written for a covered event with a key
matching `preScheduleKey` and a `pricedFrom` of the walk-forward literal. Re-run the existing
structural `runEventMode` test unmodified — it must still pass.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/publish.test.ts packages/harness/payloadBudget.test.ts</automated>
  </verify>
  <done>Pre-event walk-forward state is captured in both publish modes and proven distinct from post-event state by a non-vacuous test; scheduleless events with registered teams publish a full event artifact; sidecars are generated for covered events, uploaded outside `PageKind`, and written before the event artifact; `--presim-from-season` exposes the cutoff as a parameter; `docs/publish-budget.md` describes the sidecar without inventing measurements; the pinned `runEventMode` structural test still passes.</done>
</task>

<task type="auto">
  <name>Task 5: Client data layer — lazy sidecar fetch and baked-result decode</name>
  <files>apps/web/src/lib/api/preSchedule.ts, apps/web/src/lib/api/preSchedule.test.ts, apps/web/src/lib/preScheduleResult.ts, apps/web/src/lib/preScheduleResult.test.ts, apps/web/src/routes/event.$eventKey.tsx</files>
  <read_first>
    - apps/web/src/lib/api/event.ts in full — the fetch/parse/error shape to mirror.
    - apps/web/src/lib/api/errors.ts (`ArtifactFetchError`, `ArtifactValidationError`).
    - apps/web/src/routes/event.$eventKey.tsx lines 141-210 and 295-310 (the existing query, `is404`, `isSimulationDisabled`, `activeTab`, `renderSimulationContent`).
    - apps/web/src/components/event/rankRows.ts lines 130-165 (the `SimResult` shape `buildRankDistributionRows` consumes).
    - apps/web/src/lib/api/event.test.ts for the fetch-mocking convention used in this package.
  </read_first>
  <action>
Create `apps/web/src/lib/api/preSchedule.ts`, mirroring `apps/web/src/lib/api/event.ts`'s shape:
build the key with `preScheduleKey`, fetch `artifactUrl(key)`, parse with
`PreScheduleArtifactSchema`, and throw `ArtifactValidationError` on a parse failure. ONE
deliberate divergence from `event.ts`, and it must be stated in the module's doc comment as a
decision rather than left for a reader to infer: a 404 RETURNS `null` instead of throwing
`ArtifactFetchError`. An absent sidecar is an ordinary, expected state for every event outside
the covered season set and for every algorithm with no RP model, so it is an absence, not a
failure; a thrown 404 would surface as a rendered error state on a tab that should simply fall
back to the existing pre-run placeholder. Every OTHER non-ok status still throws
`ArtifactFetchError` unchanged. Export `preScheduleQueryOptions(params)` with a query key of
`["preSchedule", eventKey, algorithmId, version]`, matching `eventQueryOptions`' positional
convention.

Create `apps/web/src/lib/preScheduleResult.ts` exporting
`decodePreScheduleResult(artifact)`, a pure function returning a `SimResult` —
`{ rankHistograms, draws }` — reconstituted from `baked.histograms` and `roster`: one
`Int32Array` per roster team, in roster order, keyed by team key, with `draws` taken from
`baked.draws`. This is what lets the baked path call the SHIPPED
`buildRankDistributionRows` unchanged, rather than a second row builder that could diverge from
the one the live engine feeds (C-09). The function must not re-validate the length and sum
invariants — Task 1's schema refinements already own them at the publish boundary, and a
second tolerance in a second place is how two tolerances drift apart. State that division of
labour in the doc comment.

In `apps/web/src/routes/event.$eventKey.tsx`, add the sidecar query beside the existing event
query, gated so it fires only while the Simulation tab is genuinely active (C-10):
`enabled: isValidKey && version !== undefined && !isSimulationDisabled && activeTab === "simulation"`.
The gate MUST live here and not inside `SimulationTab` — Radix keeps every `TabsContent`
mounted with `hidden`, so `SimulationTab` renders on every event page view regardless of the
active tab, and a query placed inside it would fetch the sidecar on every event page load in
the app, defeating the lazy requirement entirely. Record that reason in a comment at the query.
Thread the resolved sidecar (and its pending flag) into `renderSimulationContent`'s
`renderPopulated` call so `SimulationTab` receives it as a prop. Leave the existing `is404`
branch exactly as it is — it must keep firing for genuinely unpublished events, and it must NOT
become sidecar-aware.

Write `apps/web/src/lib/preScheduleResult.test.ts` covering: a three-team artifact decoding to
three `Int32Array` histograms in roster order with the right `draws`; the decoded result
feeding `buildRankDistributionRows` and producing three rows without throwing
`MalformedRankHistogramError`; and mutation of nothing on the input artifact.

Write `apps/web/src/lib/api/preSchedule.test.ts` covering: a 200 parsing into the typed
artifact; a 404 returning `null` rather than throwing; a 500 throwing `ArtifactFetchError`; and
a 200 carrying a malformed body throwing `ArtifactValidationError`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/lib/preScheduleResult.test.ts apps/web/src/lib/api/preSchedule.test.ts</automated>
  </verify>
  <done>The sidecar fetcher returns null on 404 and throws on every other failure; `decodePreScheduleResult` produces a `SimResult` the shipped `buildRankDistributionRows` consumes without error; the route's query is enabled only when the simulation tab is active and the algorithm is not disabled; all four new test files' cases pass.</done>
</task>

<task type="auto">
  <name>Task 6: Simulation tab — baked default view, "Before schedule release" stop, "Update simulation"</name>
  <files>apps/web/src/components/event/SimulationTab.tsx, apps/web/src/components/event/SimulationTab.test.tsx, apps/web/src/components/event/StartMatchPicker.tsx, apps/web/src/components/event/StartMatchPicker.test.tsx, apps/web/src/components/event/RunControl.tsx, apps/web/src/components/event/RunControl.test.tsx</files>
  <read_first>
    - **Load `Skill("sketch-findings-sigmascout")` FIRST.** Every copy string, colour token, spacing token and chart-craft decision below is subject to its rules; do not invent a palette value or a band treatment.
    - apps/web/src/components/event/SimulationTab.tsx in full.
    - apps/web/src/components/event/StartMatchPicker.tsx in full.
    - apps/web/src/components/event/RunControl.tsx in full.
    - apps/web/src/components/event/SimulationTab.test.tsx and SimulationTab.failure.test.tsx — the existing assertions that pin the three-state branch and the copy constants.
  </read_first>
  <action>
Rework the Simulation tab so the baked pipeline result is its default view for every covered
event (C-01), the slider grows a leftmost pre-schedule stop (C-02), and the run button becomes
an update button (C-03).

**Selection becomes a discriminated union.** Replace `SimulationTab`'s
`useState<string | null>` selected-match-key state with an explicit
`{ kind: "preSchedule" } | { kind: "match"; matchKey: string }`. The research finding this
guards against is concrete: `simulationSignature` currently folds a null selection to the
literal `"none"`, so a magic string or an overloaded null would make a pre-schedule selection
indistinguishable from no selection at all. Fold the selection KIND into
`simulationSignature` so the two can never collide. Initialise lazily to the pre-schedule kind
when a sidecar is present, and to the existing `defaultStartMatchKey` behaviour when it is not.
Keep the existing resolve-against-current-rows discipline for the match kind — a held key that
is no longer present resolves to no selection without clearing the held state.

**The three-state branch grows a fourth input.** Both early returns — zero qualification rows,
and `hasSimulatableRankInputs` false — must now ALSO require that no sidecar is available. A
scheduleless event trips both guards today and would render an empty state on top of a
perfectly good baked result. The `SIMULATION_UNAVAILABLE_*` state must still fire for offseason
events, and it does so cleanly: a sidecar structurally cannot exist for an RP-ineligible event
(the pipeline skips them per PD-06), so the two conditions coincide.

**The baked path constructs nothing.** When the selection is the pre-schedule kind and a sidecar
is present, decode it with `decodePreScheduleResult` and render `RankDistributionTable` from
`buildRankDistributionRows` directly — no `useSimulationRun` start, no Web Worker, no Monte
Carlo in the browser. First paint of the tab must show the table with zero client compute
(C-01). Pressing the button while the pre-schedule stop is selected is a no-op that leaves the
baked result on screen; `handleRun` returns early for that selection kind and never touches run
state (C-02).

**`StartMatchPicker` grows a leftmost stop.** Add a `hasPreScheduleStop` prop and change the
selection props to carry the discriminated union. When the stop is available the slider's `min`
becomes 0, position 0 IS the pre-schedule stop, and position `i + 1` is `rows[i]`; when it is
not available the picker behaves exactly as it does today. The typed number input accepts 0 for
the pre-schedule stop and keeps its existing match-number lookup for every other value. Replace
the selected-match summary with a pre-schedule summary when position 0 is selected. Keep the
existing PD-09 discipline intact: the guard lives in the HANDLERS, not only on the controls, so
a programmatic change event cannot move the selection mid-run. Preserve
`START_MATCH_SLIDER_TESTID`, `START_MATCH_NUMBER_INPUT_TESTID` and
`START_MATCH_PICKER_TESTID`; add one new testid for the pre-schedule summary.

**Copy.** The stop's own label is the phrase "Before schedule release", verbatim, because
CONTEXT names it. The pre-schedule scope line replaces the existing match-scope line while that
stop is selected and must say, in plain language and without a plus-or-minus glyph (that glyph
is reserved by Phase 7 D-01 for one standard deviation of predictive variance and a rank spread
is not that quantity): that this is the model's view before any schedule exists, that it was
computed in the pipeline across 20 randomly generated schedules, and the total draw count.
Route the exact wording through the sketch skill's copy rules. Record every minted string as a
new Copywriting-Contract row in the SUMMARY, since no contract row exists for these states.

**The button label.** Replace `RUN_LABEL_IDLE` and `RUN_LABEL_RERUN` with a single exported
`RUN_LABEL_UPDATE` whose value is the phrase "Update simulation", and update every importer.
Grep for both old constant names across `apps/web` (unit tests AND any Playwright spec) before
deleting them, and update every site the grep finds. This is a deliberate deviation from the
approved Copywriting Contract's two rows; record it explicitly in the SUMMARY rather than
letting it read as drift. The four rendered run-control states (idle, running, complete, error)
and their `isResultCurrent` discipline are otherwise unchanged.

**Tests.** Extend the three existing test files. At minimum: the tab renders a rank table on
first render when a sidecar is supplied and no run has been started, with no `Worker`
constructor invoked (the existing files already demonstrate the no-Worker-mock pattern — keep
it); a scheduleless event with a sidecar renders the stack rather than either empty state; an
offseason-shaped event with no sidecar still renders `SIMULATION_UNAVAILABLE_HEADING`; moving
the slider off position 0 and pressing the button starts a real run; moving it back to position
0 and pressing the button does NOT start a run and re-shows the baked table; and the button
reads "Update simulation" in both the idle and the post-run states.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/event &amp;&amp; pnpm --filter web typecheck</automated>
  </verify>
  <done>The Simulation tab's default view is the baked pipeline result with zero client compute; the slider's leftmost stop reads "Before schedule release" and selecting it plus pressing the button re-shows the baked result without running the engine; every other stop still runs the client engine behind an "Update simulation" button; scheduleless events render the stack instead of an empty state while offseason events still render the unavailable state; every event-component test passes and the web typecheck is clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| GitHub raw -> local filesystem | `scripts/fetchScheduleTemplates.ts` writes third-party CSV content into `data/schedule-templates/`, which the pipeline then parses as schedule structure. |
| Corpus -> published R2 sidecar | Team keys and event metadata from the corpus are serialized into a public JSON artifact. |
| R2 -> browser | The sidecar is fetched and its integer arrays drive array indexing and typed-array allocation in the client. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-tll-01 | Tampering | `loadScheduleTemplate` CSV parse | medium | mitigate | Task 1 rejects any line that is not twelve finite integers, and any slot index outside `1..numTeams`, with a named error citing file and line — a tampered or truncated cache entry cannot silently produce an off-by-one schedule. |
| T-tll-02 | Tampering | `decodePreScheduleResult` / `buildRankDistributionRows` | high | mitigate | Task 1's schema refinements bound every roster index to `[0, roster.length)` and pin every histogram's length and sum at the publish boundary; Task 5 does not re-derive those bounds, and `PreScheduleArtifactSchema.parse` runs on every fetched body before any indexing occurs. |
| T-tll-03 | Denial of Service | client memory from a hostile sidecar | medium | mitigate | Histogram count and length are both pinned to `roster.length` by schema refinement, so a fetched body cannot request an unbounded typed-array allocation. |
| T-tll-04 | Information Disclosure | publish/fetch scripts and `.env` | high | mitigate | No file in this plan reads `process.env` directly; `putObject` reads its own credentials as it already does. CLAUDE.md's never-render-`.env` rule is restated in `<execution_notes>` and applies to every task. |
| T-tll-05 | Elevation of Privilege | Worker overwriting or deleting sidecars | medium | mitigate | The sidecar key is deliberately not a `PageKind` member, so `apps/worker/src/artifactWriter.ts`'s `SCHEMA_BY_PAGE`-keyed writer cannot address it and issues no deletes (C-18, PD-01). |
| T-tll-06 | Repudiation | non-reproducible published sidecars | low | mitigate | Every shuffle and every Monte Carlo stream is seeded from `eventKey` + `algorithmVersion` + index; no wall clock and no unseeded random source appears in the sidecar path, so any published sidecar can be regenerated and compared. |
| T-tll-SC | Tampering | npm/pip/cargo installs | high | accept | This plan installs no packages — every module uses native `fetch`, `node:fs`, `zod` and existing workspace code. No package-legitimacy checkpoint applies; if a task finds itself needing a new dependency, stop and report instead. |
</threat_model>

<verification>
Run from the repo root, never wrapped in `timeout`:

1. `npx vitest run packages/harness/scheduleTemplates.test.ts packages/harness/preSchedule.test.ts packages/harness/pageArtifacts.test.ts packages/harness/publish.test.ts packages/harness/payloadBudget.test.ts packages/ingest/eventTeams.test.ts`
2. `npx vitest run apps/web/src/lib apps/web/src/components/event`
3. `npx tsc --noEmit` — clean apart from the four pre-existing `apps/worker` `redDqs`/`blueDqs` errors.
4. `pnpm --filter web typecheck` — clean.
5. Full suite once, at the end: `npx vitest run` from the repo root (167+ files across both projects). Judge it by the printed summary, not the exit code.
</verification>

<success_criteria>
- Every `must_haves.truths` entry is demonstrated by a passing automated test or is directly readable from the shipped code path.
- Every C-NN row in the source-coverage audit is implemented by its named task, with PD-02's reading of C-07 called out explicitly in the SUMMARY for the user to confirm or reject.
- No new npm dependency, no `PageKind` widening, no `PAGE_ARTIFACT_SCHEMA_VERSION` bump, no change to `apps/worker/`.
- No executor ran a network command, a publish, or `scripts/fetchScheduleTemplates.ts`.
- `docs/publish-budget.md` describes the sidecar and states that its measured figures are pending, with no fabricated numbers in the machine-readable block.
</success_criteria>

<follow_ups>
Orchestrator / user work, deliberately OUTSIDE this plan (executors have no network and this
task ships code, schemas and tests only):

1. `pnpm ingest:event-teams --years 2026-2026 --force` — backfill registered teams for all
   official 2026 events, so the scheduleless-page deliverable covers more than two events.
   Re-run for earlier seasons if backfilling.
2. `pnpm publish:seasons` — the republish that actually generates the sidecars. Note the run's
   printed `presim` size summary.
3. Transcribe that summary into `docs/publish-budget.md` by hand — `publish:seasons` prints its
   figures but does not write the doc, and a stale doc keeps `payloadBudget.test.ts` red.
4. Live-origin read-back of one sidecar key and one scheduleless event artifact.
5. Local visual verification of the Simulation tab per the recorded recipe
   (`VITE_ARTIFACT_ORIGIN=local` activates the `/v1` proxy; fresh port per restart), covering:
   the baked default view on a completed event, a scheduleless event's full page, and the slider
   round-trip off and back onto the pre-schedule stop.
6. Decide whether PD-02's corpus-derived reading of "freeze once the schedule lands" is what was
   meant, or whether a literal R2 read-before-write freeze is wanted instead.
</follow_ups>

<output>
Create `.planning/quick/260905-tll-pre-schedule-rank-simulation-pipeline-pr/260905-tll-SUMMARY.md` when done.
</output>
