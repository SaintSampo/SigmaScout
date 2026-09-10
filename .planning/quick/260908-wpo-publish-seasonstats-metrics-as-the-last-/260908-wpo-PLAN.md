---
quick_id: 260908-wpo
date: 2026-09-08
type: execute
mode: quick
wave: 1
depends_on: []
autonomous: false
requirements:
  - QT-260908-wpo
files_modified:
  - packages/harness/pageArtifacts.ts
  - packages/harness/pageArtifacts.test.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - docs/publish-budget.md
  - .planning/todos/pending/season-final-metric-is-not-what-any-page-shows.md

estimate:
  tokens: 95000
  raw_tokens: 48000
  tasks: 4
  confidence: low

must_haves:
  truths:
    - "For a team with any official play, the published team artifact's `seasonStats.metrics.total` equals that team's Teams-list total exactly (frc7769, frc88, frc2056 in 2026)."
    - "For a team with no official play at all (offseason-only), the published team artifact still carries its season-final metric values — never an empty metrics object."
    - "Every published team artifact carries `seasonStats.metricsBasis`, whose value names which of the two branches produced `seasonStats.metrics`."
    - "`metricHistory` is byte-for-byte unchanged in basis: still season-final, still carrying offseason rows."
    - "A team with no offseason play (frc254) publishes the same numbers it did before this change."
  artifacts:
    - "packages/harness/pageArtifacts.ts — `metricsBasis` on the team artifact's `seasonStats`"
    - "packages/harness/publish.ts — an exported per-team basis-selection helper plus the corrected comment at ~2390-2400"
    - "packages/harness/publish.test.ts — coverage including an explicit offseason-only-team case"
    - "docs/publish-budget.md — a transcribed Latest run paragraph and json block for the republish"
  key_links:
    - "publishSeasons's team-artifact call site (~2729) reads the official percentile record, not `metricsByTeamWithPercentiles`"
    - "The offseason-only fallback branch — `lastOfficialMetricsByTeam` deliberately omits those teams, so a bare `?? {}` would blank 39 teams in 2026, 97 in 2025, 97 in 2024"
---

<objective>
`seasonStats` in the published team artifact mixes two bases: `record`/`matchCount`/`eventCount`
are official-play-only (quick task 260908-615) while `metrics` is season-final and keeps learning
through offseason and preseason play. Move `seasonStats.metrics` onto the last-official-match
snapshot the Teams list and the team page header already show, and add
`seasonStats.metricsBasis` so the object names which quantity it carries.

Purpose: close `.planning/todos/pending/season-final-metric-is-not-what-any-page-shows.md`
(Option 1). Today the todo's one-line repro prints two different numbers for frc7769; after this
it prints one.

Output: a publisher change, a schema field, tests, a full republish, and a live parity check.

**Not in scope:** any change to EPA/VPR/BPR/OPR rating maths. This changes which
already-computed number is written into one field. `metricHistory` stays season-final and must
not be touched. `SeasonHeader.tsx`'s `metricsOverride ?? artifact.seasonStats.metrics` stays as
written (CONTEXT: leaving it is the low-risk choice and keeps it working against artifacts
published before this change).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.planning/quick/260908-wpo-publish-seasonstats-metrics-as-the-last-/260908-wpo-CONTEXT.md
@.planning/todos/pending/season-final-metric-is-not-what-any-page-shows.md
@.claude/CLAUDE.md
</context>

<operating_rules>
Read these before touching anything. Each one has cost this project real time before.

1. **Another session is editing this checkout right now, including `publish.ts`.**
   Stage every commit by explicit path (`git add packages/harness/publish.ts ...`).
   **Never `git add -A`, never `git add .`, never `git commit -a`.** After each commit run
   `git status` and confirm nothing foreign was absorbed.

2. **Never `Read`, `cat`, `head`, `tail` or `echo` `.env`.** Nothing in this plan needs its
   contents. The publish scripts read it themselves via `tsx --env-file=.env`.

3. **Tests run from the REPO ROOT**, not `apps/web`: `npx vitest run`. Running from
   `apps/web` sees 77 of 167 test files and has hidden an 8-day red before.
   **Never wrap it in `timeout ... pnpm ...`** — that swallows all output and exits 0.

4. **Both typechecks.** Root `tsc --noEmit` does NOT cover `apps/web`.
   Run `npx tsc --noEmit` at the root AND `npx tsc --noEmit -p apps/web/tsconfig.json`.

5. **Two root typecheck errors are PRE-EXISTING and belong to another session:**
   `packages/harness/tune.test.ts(1069)` and `packages/harness/stateSnapshot.test.ts(1008,1027)`.
   Expected noise. Do not fix them, do not count them as this task's, do not report them as a
   failure. Any OTHER error is yours.

6. **Tasks 3 and 4 are ORCHESTRATOR-RUN and are not yours.** An executor subagent's sandbox
   denies ALL network Bash — `pnpm publish:seasons`, `pnpm manifest:algorithms`,
   `pnpm verify:subset`, and every `fetch` against `data.sigmascout.org` will fail with a
   network denial that means nothing about the code. If you are an executor subagent: stop
   after Task 2, commit, and report. Do not attempt Tasks 3 or 4 and do not report their
   sandbox denials as failures.
</operating_rules>

<tasks>

<task type="auto">
  <name>Task 1: Add `seasonStats.metricsBasis` to the team artifact schema and thread it through the builder</name>
  <files>packages/harness/pageArtifacts.ts, packages/harness/publish.ts, packages/harness/pageArtifacts.test.ts</files>
  <read_first>
    - `packages/harness/pageArtifacts.ts:308-312` — `RecordAndMetricsSchema`
    - `packages/harness/pageArtifacts.ts:1235-1241` — `TeamSeasonArtifactSchema`, whose
      `seasonStats` is the schema's only remaining consumer of `RecordAndMetricsSchema`
      (line 1075 records that the teams-table row deliberately stopped extending it)
    - `packages/harness/publish.ts:1042` — `BuildTeamSeasonArtifactParams.seasonStats`
    - `packages/harness/publish.ts:1234` — the `candidate.seasonStats` construction
  </read_first>
  <action>
Add a `metricsBasis` field inside the team artifact's `seasonStats`, with exactly two permitted
values: `"last-official-match"` and `"season-final"` (per D-LOCKED "Name the basis"). Model it as
a Zod enum, not a free string.

Placement, resolving the CONTEXT's "Claude's Discretion" on field placement: extend at the use
site — `seasonStats: RecordAndMetricsSchema.extend({ metricsBasis: ... })` — rather than adding
the field to `RecordAndMetricsSchema` itself. That schema is named and documented as a shared
record+metrics shape; the basis is a property of the team artifact's `seasonStats` specifically,
and extending at the use site keeps the shared shape generic.

**Optional in the schema, mandatory in the publisher.** Make the field `.optional()` for parsing
and give it a doc comment stating the reading for an absent field: an artifact published before
quick task 260908-wpo, whose `seasonStats.metrics` is season-final. Required-at-parse would break
`apps/web/src/lib/api/team.ts`'s `TeamSeasonArtifactSchema.parse(body)` for every CDN-cached
pre-republish artifact during the republish window, which is a regression introduced by a bug fix.
The strong guarantee lives on the write side instead: Task 2's tests assert every freshly
published team artifact carries the field.

Doc-comment the field with: what the two values mean, that `metricHistory` is season-final
regardless of this field's value, and that the absent case means a pre-260908-wpo artifact.

Then thread it through the builder in `publish.ts`: add `metricsBasis` to
`BuildTeamSeasonArtifactParams.seasonStats`'s inline type (required there — every caller must
state it), and pass it through in the `candidate.seasonStats` construction alongside
`roundTeamMetricRecord(params.seasonStats.metrics)`. It is a string tag; do not round it, do not
transform it.

Fix every `buildTeamSeasonArtifact` call site the added required param breaks (tests included) by
supplying an explicit basis — never by making the param optional to avoid the compile error.

Add schema coverage in `pageArtifacts.test.ts` near the existing `TeamSeasonArtifactSchema`
blocks (~line 247): both enum values parse; an absent field parses; a third string value is
rejected.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/pageArtifacts.test.ts</automated>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>`TeamSeasonArtifactSchema` accepts `seasonStats.metricsBasis` as an optional two-value enum and rejects any other value; `buildTeamSeasonArtifact` requires a basis from its caller and emits it unmodified; root typecheck shows only the two pre-existing errors named in operating rule 5.</done>
</task>

<task type="auto">
  <name>Task 2: Publish the last-official-match snapshot as `seasonStats.metrics`, with a season-final fallback for offseason-only teams</name>
  <files>packages/harness/publish.ts, packages/harness/publish.test.ts</files>
  <read_first>
    - `packages/harness/publish.ts:228-265` — `lastOfficialMetricsByTeam` and its doc comment's
      explicit contract that an offseason-only team is OMITTED from the returned record
    - `packages/harness/publish.ts:2368` — `metricsByTeamWithPercentiles` (season-final)
    - `packages/harness/publish.ts:2388-2403` — the comment block to correct, plus
      `officialMetricsByTeam` / `officialMetricsByTeamWithPercentiles`
    - `packages/harness/publish.ts:2493` — the Teams-list call site, for contrast
    - `packages/harness/publish.ts:2713-2731` — the team-artifact call site to change
    - `packages/harness/percentiles.ts:99` — `withPercentiles` returns `TeamMetricsWithPercentile`
    - `packages/harness/publish.test.ts:2601` — the existing direct unit block for
      `lastOfficialMetricsByTeam`, and `:2796` — the `260908-615` end-to-end block whose
      `seedOneOfficialOneOffseason` corpus fixture is the pattern to follow
  </read_first>
  <action>
**Add an exported, named helper** in `publish.ts`, sited next to `lastOfficialMetricsByTeam` so
the two contracts read together. Take the discretion CONTEXT offers on inline-vs-helper in favour
of the helper: it is directly unit-testable, matching why `lastOfficialMetricsByTeam` is itself
exported. Roughly:

`seasonStatsMetricsForTeam(teamKey, officialWithPercentiles, seasonFinalWithPercentiles)`
returning `{ metrics, metricsBasis }`.

Selection rule: use the official entry when it is present AND non-empty, tagged
`"last-official-match"`; otherwise fall back to the season-final entry (`?? {}`) tagged
`"season-final"`. Check emptiness as well as presence so the helper structurally cannot publish
an empty metrics object for a team that has season-final values — that is the trap the LOCKED
decision names, and a presence-only check would depend on an invariant held elsewhere.

**Do NOT introduce a second derivation of officialness.** The helper takes the two already-built
percentile-widened records as arguments and derives nothing itself; `officialEventKeys` and
`lastOfficialMetricsByTeam` already did that work once, and this codebase has paid for a duplicate
derivation before.

Wire it at the team-artifact call site (~2729), replacing `metricsByTeamWithPercentiles[teamKey] ?? {}`
with the helper's `metrics`, and pass its `metricsBasis` into the `seasonStats` object Task 1 added.
`officialMetricsByTeamWithPercentiles` and `metricsByTeamWithPercentiles` are both already in
scope at that point — build no new maps.

**Do not copy `withPublishedTiers` from the Teams-list call site at 2493.** The team artifact does
not apply tiers today and this task does not change that.

**Leave these alone**, explicitly: `metricHistory` (still
`withHistoryPercentiles(metricHistoryForAlgo.get(teamKey) ?? [], sortedPools)`, still season-final
— it is the metric-history chart's source and carries the offseason rows that let an offseason
event section render its own end-of-event state); the `events` array; `teamStatsOfficial`; and the
Teams-list branch.

**Correct the stale comment** at ~2390-2400 in this same commit. Its closing sentence — "the
per-team artifact's `seasonStats`/`metricHistory` sections stay season-final, exactly as before" <!-- planner-discipline-allow: stay season-final, exactly as before -->
— documents precisely the behaviour being changed, and a document asserting something untrue about
the system is this project's named defining failure. Rewrite it rather than deleting it: state that
as of quick task 260908-wpo `seasonStats.metrics` reads the official record (tagged via
`metricsBasis`) with a season-final fallback for offseason-only teams, that `metricHistory` and
`sortedPools` genuinely do stay season-final, and why the fallback exists.

**Tests** in `publish.test.ts`, in a new describe block naming quick task 260908-wpo:

  a. Direct unit coverage of the helper: official present and non-empty wins and reports
     `"last-official-match"`; official absent falls back to season-final and reports
     `"season-final"`; official present-but-empty ALSO falls back rather than publishing empty.
  b. End-to-end, following the `260908-615` block's corpus fixture pattern
     (`seedOneOfficialOneOffseason`, `publishSeasons` with `includeOffseason: true`): a team with
     one official and one offseason match publishes `seasonStats.metrics` equal to the Teams-list
     row's metrics and `metricsBasis === "last-official-match"`, while its `metricHistory` still
     contains the offseason event's row.
  c. **The offseason-only branch, explicitly** (LOCKED — this is the trap): seed a team whose ONLY
     event is an offseason one. Assert its published `seasonStats.metrics` is NON-EMPTY and carries
     `metricsBasis === "season-final"`. A test that only asserts the basis string would pass on a
     blanked team; assert the values are there.
  d. A team with official play only: `metricsBasis === "last-official-match"` and the values are
     unchanged from what the season-final path produced (the two agree for such a team — this is
     the frc254 no-regression case).
  </action>
  <verify>
    <automated>npx vitest run</automated>
    <automated>npx tsc --noEmit</automated>
    <automated>npx tsc --noEmit -p apps/web/tsconfig.json</automated>
    <automated>! grep -qF "sections stay season-final, exactly as before" packages/harness/publish.ts</automated>
  </verify>
  <done>Full root vitest is green; both typechecks show only the two pre-existing errors from operating rule 5; the offseason-only test asserts non-empty metrics with basis `"season-final"`; the superseded comment sentence no longer appears in `publish.ts`. Committed by explicit path with `git status` confirming no foreign files were staged.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: ORCHESTRATOR-RUN — full republish and budget transcription</name>
  <what-built>Tasks 1-2 changed which number the publisher writes into `seasonStats.metrics`. Nothing is observable live until every artifact is rewritten.</what-built>
  <how-to-verify>
**This task runs from the main orchestrator context, never from an executor subagent** — subagent
sandboxes deny all network Bash.

1. Confirm Task 2's commit is on `main` and pushed (the push triggers the Pages build; the schema
   field is optional at parse, so a deployed client against not-yet-republished artifacts is safe).

2. Run the full republish. Roughly 75,000 objects, ~28 minutes based on the last run recorded in
   `docs/publish-budget.md`. Background it and check on it; a quiet log is not proof it died.

   ```
   pnpm publish:seasons
   ```

   **Publish ordering is load-bearing: artifacts before manifest.** Do not touch the manifest
   until the artifact run has completed.

3. `pnpm manifest:algorithms`, then read back and confirm all three algorithms report the new
   generation.

4. `pnpm verify:subset` — expect 35/35, with exactly one generation equal to the run's summary
   line.

5. **Transcribe the budget summary by hand.** `publish:seasons` PRINTS a budget summary but does
   NOT write `docs/publish-budget.md`. Until it is transcribed, `packages/harness/payloadBudget.test.ts`
   stays red. Update BOTH halves of that file, following the existing entries' shape exactly:
   - the **Latest run** paragraph — date, what changed (quick task 260908-wpo:
     `seasonStats.metrics` moved to the last-official-match basis; no algorithm version moved),
     object count, total bytes, wall time, generation UUID;
   - the machine-readable **json block at the bottom** — `count`, `medianBytes`, `p95Bytes`,
     `maxBytes`, `largestKey` per page type, from the printed summary. Leave `budgetMaxBytes`
     alone unless a measured `maxBytes` now exceeds it, in which case stop and raise it as a
     finding rather than silently widening the budget.

6. `npx vitest run packages/harness/payloadBudget.test.ts` from the repo root — green.

7. Commit `docs/publish-budget.md` by explicit path.
  </how-to-verify>
  <resume-signal>Type "republished" once verify:subset passes and the budget doc is transcribed and committed, or describe what failed.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: ORCHESTRATOR-RUN — live parity verification and todo close</name>
  <what-built>The republished artifacts. This is the measurement that decides whether the defect is actually closed.</what-built>
  <how-to-verify>
**Orchestrator context only** — these are network fetches an executor subagent cannot make.

The bar is PARITY, not "a number changed". Assert equality against the Teams list.

1. The todo's own one-line repro. It prints two different numbers today and must print one now:

   ```
   node -e "(async()=>{const l=await (await fetch('https://data.sigmascout.org/v1/teams/2026/epa@6.0.0+baseline.json')).json();const i=l.metricKeys.indexOf('total');const r=l.teams.find(t=>t.teamKey==='frc7769');const p=await (await fetch('https://data.sigmascout.org/v1/team/frc7769/2026/epa@6.0.0+baseline.json')).json();console.log('list',r.metrics[i][0],'page',p.seasonStats.metrics.total.value);})()"
   ```

   If `epa@6.0.0+baseline` has moved, read the current version string from
   `https://data.sigmascout.org/v1/manifest/algorithms.json` rather than guessing.

2. Extend the same check across the four teams CONTEXT measured, asserting equality (not
   eyeballing), and asserting `metricsBasis` on each:

   | Team | Expected list total | Expected `seasonStats.metrics.total` | Expected `metricsBasis` |
   |---|---:|---:|---|
   | frc7769 | 313.95 | 313.95 (was 251.37) | last-official-match |
   | frc88 | 155.96 | 155.96 (was 182.75) | last-official-match |
   | frc2056 | 302.03 | 302.03 (was 277.79) | last-official-match |
   | frc254 | 328.39 | 328.39 (unchanged) | last-official-match |

   Percentiles must agree too, not just values — the CONTEXT table shows both split today.

3. **The offseason-only regression check, which is the one that actually protects users.** Pick an
   offseason-only team for 2026 (39 exist; find one whose events are all `eventType` 99/100), fetch
   its team artifact, and confirm `seasonStats.metrics` is NON-EMPTY with
   `metricsBasis === "season-final"`. A blanked team page here means stop and fix, not ship.

4. Load a team page with offseason play in the browser and confirm the header number no longer
   visibly changes after the events artifact loads (the user-visible glitch this fix removes).

5. Close the todo: move
   `.planning/todos/pending/season-final-metric-is-not-what-any-page-shows.md` to the completed
   location, appending the measured after-values and the run's generation UUID so the close is
   evidence rather than an assertion. Commit by explicit path.
  </how-to-verify>
  <resume-signal>Type "verified" with the four measured pairs and the offseason-only team's result, or describe the mismatch.</resume-signal>
</task>

</tasks>

<verification>
- `npx vitest run` from the repo root is green (167 test files, not 77).
- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json` both clean apart from the
  two pre-existing errors in `tune.test.ts` and `stateSnapshot.test.ts`.
- The superseded comment sentence is gone from `publish.ts` and replaced with an accurate one.
- Live: the todo's repro prints one number; frc254 unchanged; an offseason-only team still renders
  values.
- `docs/publish-budget.md` reflects the republish and `payloadBudget.test.ts` is green.
- `git log` shows commits staged by explicit path with no foreign files absorbed.
</verification>

<success_criteria>
The published team artifact's `seasonStats` is internally consistent — record, counts and metrics
all on official play — offseason-only teams still show their numbers, and every artifact says which
basis its metrics carry. The todo's repro prints one number.
</success_criteria>

<output>
Report results inline. This is a quick task; no SUMMARY.md file is required unless the orchestrator
asks for one.
</output>
