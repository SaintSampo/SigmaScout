# Quick Task 260913-pnp: drop the licensed schedule templates - Context

**Gathered:** 2026-09-13
**Status:** Ready for planning (after 260913-nvn lands; see "Sequencing")

<domain>
## Task Boundary

Fully resolve `.planning/todos/pending/drop-licensed-schedule-templates.md`: make the rules-based
generator (`packages/harness/generatedSchedules.ts`) the only source of pre-schedule pairing
structure, retire every template-reading path, fix the misquoted corroboration figure first, and
close the todo.

</domain>

<decisions>
## Implementation Decisions (Jacob, 2026-09-13, via AskUserQuestion; LOCKED)

### D-19 (licensing)
- **Cleared: publish it.** The generator's structurally-derived rules are OK to publish. Delete the
  templates; the generator becomes the only source. Record this in the todo and as a dated
  resolution under `09-CONTEXT.md`'s D-19 consequences (lines ~423 and ~500).
- Agents still do not read, quote or reason about the cheesy-arena licence itself. The record says
  "Jacob decided", not why it is permitted.

### The two measurement scripts
- **Delete both** `scripts/measureGeneratedSchedules.ts` and `scripts/measureRandomSchedules.ts`
  (their licensed arm cannot run once the templates are gone), plus `scripts/fetchScheduleTemplates.ts`
  and the `fetch:schedule-templates` script in root `package.json`.
- **Order matters:** re-render `docs/models/rung2-generated-schedules.md` with the corrected
  sentence BEFORE deleting `measureGeneratedSchedules.ts` (see "The corroboration figure").
- Each of the two docs gets a one-line note under its title: its measurement harness was retired
  with the licensed templates on 2026-09-13 (quick task 260913-pnp) and it cannot be re-run. That
  note is a hand edit, which is fine once the writer script no longer exists; do not otherwise
  rewrite the records.
- `scripts/measureFieldAveragedRanks.ts` STAYS (it only imports `matchesPerTeamFor`; repoint it).

### Publish cost: share grids by event shape (decided 2026-09-14, after the planner priced it)
- Measured: `generateSchedule` costs ~0.43e-3 x n^1.88 x mpt ms per call (15.6 ms at 76 x 10). Over
  the 215 RP-eligible 2026 events with roster >= 6 (median 37 teams, p95 61, max 75; corpus read by
  the orchestrator), a fresh grid per (event, schedule) adds ~17.6 min to a 23m28s publish.
- Those events have only **72 distinct (roster size, matchesPerTeam) cells**. **Jacob chose: share
  grids by size.** Schedule k's structure for an event with n teams at mpt matches per team is the
  SAME for every event of that shape: seed `fnv1a32(`generate|${n}|${mpt}|${k}`)`, generated once
  and memoized. Each event still gets K independently generated grids (the proven construction per
  event); only the seed source changes. Estimated added publish time ~6.2 min.
- The memo must be transparent: a cached structure is byte-identical to a fresh
  `generateSchedule(n, mpt, mulberry32(seed), DEFAULT_RESTARTS)` for the same key, so output never
  depends on cache state. Store structures compactly (plain match objects cost ~20 MB per cell x 72
  cells), and bound the number of cells held so a many-season presim run cannot exhaust memory.

### Committed CI fixtures
- Delete `packages/harness/fixtures/schedule-templates/` (3 CSVs + README) from current code only.
  No history rewrite. NOTE: these were never licensed files; the README records they are schedules
  this repo generated for CI, byte-distinct from upstream. They go because nothing loads them.

</decisions>

<specifics>
## Established facts (verified by the orchestrator 2026-09-13; do not re-derive)

### The corroboration figure (MUST FIX FIRST)
The hardcoded sentence in `measureGeneratedSchedules.ts`'s `--render-doc` block (~L1170-1173,
rendered at `rung2-generated-schedules.md:31`) says the rung-2 n=1000 binding floor "independently
reproduces that session's separately-built 74.2% at `2025cur`". Traced:

- **74.2% is real but mis-scoped.** It is the POOLED generated-vs-generated (template-vs-template)
  floor at N=1000, 20 draws/schedule, from the FIRST version of
  `docs/models/random-vs-generated-schedules.md` (commit `5454999e`, 2026-09-11 23:25), which was
  overwritten 41 minutes later by the N=2000 run (`71dccb26`). The sentence paired that pooled
  figure with rung-2's PER-EVENT `2025cur` 73.7%. Apples to oranges.
- Matched-scope comparisons (both are the licensed construction built twice, same six events,
  `bpr@3.0.0+baseline`; differ in draws per schedule, 20 vs 50, and seeds):

  | Count | Scope | random-vs-generated doc | rung-2 binding floor | gap |
  |---|---|---|---|---|
  | N=1000 | pooled | 74.2% (`5454999e`) | 81.1% | 6.9pp |
  | N=1000 | `2025cur` | 63.2% (`5454999e`) | 73.7% | 10.5pp |
  | N=2000 | pooled | 89.3% (current doc) | 91.8% | 2.5pp |
  | N=2000 | `2025cur` | 78.9% (current doc) | 88.2% | 9.3pp |

  The other harness is lower in every matched cell, in the direction its fewer draws per schedule
  predicts. Mean |d median| at N=2000: 0.224 there vs 0.192 here. Do NOT claim "reproduces".
- **Fix:** replace the literal with a matched-scope comparison (N=2000, pooled and `2025cur`,
  naming the 20-vs-50 draws difference). Prefer computing it by reading the JSON block of the
  CURRENT `docs/models/random-vs-generated-schedules.md` (fenced ```` ```json random-vs-generated-schedules ````;
  per-event `genBVsGenA.clause1TightRate`, pooled likewise) at render time, then re-render. Since the
  script is deleted in this same task, the rendered numbers are what survive; that is acceptable.
- **Re-render inputs are preserved** (the doc was rendered from files that were only ever in a
  session scratchpad):
  `C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/ada3c4be-a9bd-410c-9d77-d101d685caba/scratchpad/rung2-inputs/{phaseA-binding,phaseB,phaseC}.json`
  (`npx tsx scripts/measureGeneratedSchedules.ts --render-doc --inputs <a>,<b>,<c>`; order per the
  script). **Guard:** diff the re-render against HEAD; the ONLY changed lines may be the
  corroboration sentence. Any other diff means the inputs or renderer drifted: stop and report.
- Also correct lines 11-12 of the todo by hand to match, and mark the todo's "MUST FIX" section done.

### Wiring the generator (what was actually proven)
- Phase B's proven generated arm draws a **fresh generated structure PER SCHEDULE** k, seeded
  `fnv1a32(`${eventKey}|${algorithmVersion}|generate|${k}`)` via `mulberry32`, with
  `DEFAULT_RESTARTS` (4). See `generatedStructures()` / `assembleArm()` in
  `measureGeneratedSchedules.ts` ~L466-560.
- The existing `scheduleStructure` seam in `PreScheduleBuildParams` takes ONE structure for all K
  schedules. **Wiring through that seam as-is would ship an unproven construction.** Generate per k
  inside `buildPreScheduleArtifact`'s loop (k=0 used by the first-match probe), keep the existing
  `...|shuffle|k` shuffle seeds, and remove the `scheduleStructure` seam (experiment-only).
- Experiment used per-schedule `algorithmVersion#k` suffixes only because it called the builder with
  `scheduleCount: 1`; production's K-loop already gives independent shuffle streams. Seeds differ
  from the experiment's; the construction does not.
- `generatedSchedules.ts` imports `ScheduleTemplateMatch` from `scheduleTemplates.ts`; move the type
  (a neutral rename such as `ScheduleMatch` is at the planner's discretion). Move
  `matchesPerTeamFor` and `defaultMatchesPerTeam` too (publish.ts and measureFieldAveragedRanks.ts
  import them); keep their behaviour, including the 1..14 clamp, and reword comments that cite the
  template grid.
- Skip branch: `generateSchedule` throws `GeneratedScheduleError` below 6 teams. Replace publish.ts's
  `ScheduleTemplateUnavailableError` catch with an explicit roster-size check before building (log
  and skip, as today), not an exception-type branch. `ScheduleTemplateMissingError` has no successor.
  Behaviour change to note: 101-200-team events were split into two template blocks; the generator
  schedules them whole (pairKey supports up to 1,023 teams).
- **Price the change before shipping:** time 1,000 `generateSchedule` calls at a 76-team,
  10-matches-per-team event and report the added minutes for a full SPR publish's sidecars.
- `preSchedule.test.ts` and `scheduleTemplates.test.ts` currently `it.skip` when the cache is absent;
  after this, preSchedule tests must RUN unconditionally. Update `.github/workflows/test.yml`'s
  comment (L55-75) that names the fixture fallback. Any pinned sidecar digests/values in
  `publish.test.ts` / `pageArtifacts.test.ts` will move; update each pin with the reason.
- Docs: `docs/simulation-architecture.md` (L109, L272, L328) describes the template cache and the
  reader; update to the generator.

### Out of scope
- The republish. It changes every published pre-schedule band; it runs from the MAIN context only
  (subagents have no network), after commits land. Note it as owed.
- Deleting the gitignored `data/schedule-templates/` (1,331 files) is a local `rm -rf`, not a git
  change; the orchestrator does it after tests pass without it.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/todos/pending/drop-licensed-schedule-templates.md`
- `.planning/phases/09-analytic-ranking-points-browser-side-simulation/09-CONTEXT.md` (D-19: L156-158, L423, L500)
- `docs/models/rung2-generated-schedules.md`, `docs/models/random-vs-generated-schedules.md`
- `.planning/quick/260912-5hs-raise-presim-schedule-count-to-1000/260912-5hs-SUMMARY.md`

</canonical_refs>

## Sequencing and hazards (updated 2026-09-14 00:45)

- **ALL CODE WORK HAPPENS IN THE ISOLATED WORKTREE, never in the shared checkout:**
  `C:/Users/Jacob/Documents/GitHub/SigmaScout-pnp` on branch `quick/260913-pnp`, forked from
  `812fd99d`. Two sessions are live in the shared checkout: 260913-nvn plan 04 is still trimming
  comments file by file (it already did scheduleTemplates.ts; preSchedule.ts,
  generatedSchedules.ts and measureGeneratedSchedules.ts are not yet done), and sigmascout-26
  (260914-01x) holds packages/harness/publish.ts, sigmaScoutLayer.ts, packages/core/rankingPoints/,
  scripts/measureRpCalibration.ts, the Worker RP state and the web bonus-dot files until it sends an
  all-clear. The branch is merged into main by the orchestrator only after both are clear.
  Keep the publish.ts diff small (imports + the skip branch) so that merge stays trivial.
- Worktree `node_modules` was installed with `--ignore-scripts` (better-sqlite3 has no native build
  there; none of this work needs the corpus). Run everything from the worktree root with `npx`.
- **Baseline at 812fd99d in the worktree:** `npx tsc --noEmit -p .` clean (0 errors).
  `npx vitest run packages/harness/preSchedule.test.ts packages/harness/scheduleTemplates.test.ts
  packages/harness/generatedSchedules.test.ts packages/harness/publish.test.ts
  scripts/measureFieldAveragedRanks.test.ts` = 5 files, 283 passed, 3 skipped. Two of the skips are
  the real-template-cache suites (`data/schedule-templates` absent) in scheduleTemplates.test.ts and
  preSchedule.test.ts; after this task the preSchedule suite must RUN, not skip.
- Commit in the worktree with explicit paths. Do NOT touch STATE.md (the orchestrator appends the
  Quick Tasks row in the shared checkout with the patched `gsd-tools quick-tasks-append --task
  --dir --commit`, per the 2026-09-13 CLAUDE.md update).
- Executors return SUMMARY text; the orchestrator writes SUMMARY.md.
