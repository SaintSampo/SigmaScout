---
quick_id: 260913-pnp
slug: drop-licensed-schedule-templates
date: 2026-09-14
status: complete
stopped_reason: all work committed on branch quick/260913-pnp and handed to Jacob (2026-09-14), who takes the merge from here; it waits on sigmascout-26's all-clear for packages/harness/publish.ts (260914-01x)
branch: quick/260913-pnp
worktree: removed at handoff (the branch keeps every commit)
fork_point: 812fd99d
commits: [ca5114d2, 4daf2232, a5a08f3b, 8a5b13dc]
owed:
  - "Jacob: merge quick/260913-pnp into main after sigmascout-26's all-clear (a 2026-09-14 01:50 merge-tree dry run against main f959c18c was conflict-free), then flip this SUMMARY to status complete. 260913-nvn is closed; its consistencyByTeam rename and held-back comment trims on this branch's files are todo finish-nvn-held-back-trims-and-sigma-rename, to run after this merge and sigmascout-26's push."
  - "A republish from the main context. Every published pre-schedule band moves, because pairing structure now comes from the generator."
  - "Local rm -rf of the gitignored data/schedule-templates/ in the shared checkout, only once this branch is on main AND no publish from pre-merge code is pending (main's publish path reads that cache until the merge)."
  - "Append the Quick Tasks row with the patched quick-tasks-append (--dir, --commit) at landing."
---

# Quick Task 260913-pnp: drop the licensed schedule templates

The rules-based generator is now the only source of pre-schedule pairing structure, and every path
that read the licensed cheesy-arena templates is deleted. **Jacob decided D-19 on 2026-09-13**: the
generator's structurally-derived rules may be published. No agent read or reasoned about the licence.

All work ran in an isolated worktree, because two live sessions were editing the shared checkout
(260913-nvn's comment pass and sigmascout-26's 260914-01x, which holds `publish.ts`).

## Decisions (Jacob, via AskUserQuestion)

| Decision | Choice |
|---|---|
| D-19, may the generator's derived rules be published | Cleared: publish it (2026-09-13) |
| The two measurement scripts whose licensed arm cannot run | Delete both; freeze their docs with a retired-harness note |
| Committed CI fixtures | Delete from current code only, no history rewrite (they were never licensed files: generated stand-ins per their README) |
| Publish cost of a fresh grid per (event, schedule) | Share grids by (roster size, matches per team) (2026-09-14) |

## What changed

**1. `ca5114d2`: the corroboration sentence, stated at matched scope.** The old sentence said the
rung-2 n=1000 floor "independently reproduces" 74.2% at `2025cur`. That 74.2% was the POOLED
template-vs-template floor at N=1000 from the first version of `random-vs-generated-schedules.md`
(`5454999e`, overwritten 41 minutes later by `71dccb26`), set against rung-2's PER-EVENT 73.7%. The
renderer now reads the comparand from the current document's JSON block. The doc was re-rendered from
the preserved inputs, and it differs from HEAD on line 31 only. The rendered sentence:

> Matched at the same count, that document's generated-vs-generated floor (the same construction
> built twice on the same six events, but at 20 draws per schedule where this table uses 50) reads
> 89.3% pooled and 78.9% at `2025cur` at n=2,000, against 91.8% and 88.2% here: lower in both cells,
> the direction its fewer draws per schedule predict. The two harnesses agree in direction; neither
> reproduces the other's figures.

**2. `4daf2232`: the generator wired in, every template path deleted.** 18 files, +707/-3,820.
- Phase B's proven arm drew a fresh grid per schedule. The `scheduleStructure` seam took one grid for
  all K, so wiring through it would have shipped an unproven construction. The seam is gone.
  `buildPreScheduleArtifact` now takes schedule k's structure from `SHARED_STRUCTURE_CACHE`.
- `ScheduleStructureCache(maxCells)` in `preSchedule.ts` returns exactly
  `generateSchedule(n, mpt, mulberry32(fnv1a32("generate|n|mpt|k")), DEFAULT_RESTARTS)`. It stores
  cells compactly (one byte per slot up to 128 teams, surrogate flag in the top bit) and evicts the
  least-recently-used cell past `SCHEDULE_STRUCTURE_CACHE_CELLS` = 128. The memo is transparent:
  cached, warm and post-eviction reads all deep-equal a fresh generation. Shuffle and baked seeds are
  unchanged and stay per event.
- `ScheduleMatch`, `matchesPerTeamFor` (1..14 clamp kept) and `defaultMatchesPerTeam` moved into
  `generatedSchedules.ts`, with `MIN_SCHEDULE_TEAMS` = 6 and `MAX_SCHEDULE_TEAMS` = 1,024.
- `publish.ts`, four places: the import, a doc-comment paragraph, the roster check widened to a
  6..1,024 range with a logged skip, and the try/catch removed, so any builder error fails the run.
- Deleted: `scheduleTemplates.ts` and its test, `fixtures/schedule-templates/` (3 CSVs + README),
  `scripts/measureGeneratedSchedules.ts`, `scripts/measureRandomSchedules.ts`,
  `scripts/fetchScheduleTemplates.ts`, and the `fetch:schedule-templates` package.json entry.
- `scripts/measureFieldAveragedRanks.ts` keeps working. The binding-floor helpers it imported from the
  deleted script (`DRAWS_PER_SCHEDULE`, `measureResamplingFloor`, `measureEdgeNoiseFloor`,
  `REPLICATE_SUFFIX` and their types) moved into it verbatim, which also removes a module cycle.
- No test pins moved: presim assertions check roster, counts and pricedFrom, not structure.

**3. `a5a08f3b` and `8a5b13dc`: records.** Both rung-2 docs carry a retired-harness note under their
titles. `docs/simulation-architecture.md` and the `test.yml` CI comment describe the generator.
`09-CONTEXT.md` carries a dated "Jacob decided" resolution beside both D-19 consequences. The todo is
in `.planning/todos/completed/` with a closing note.

## Verification

| Check | Baseline (812fd99d) | After |
|---|---|---|
| Root `npx tsc --noEmit -p .` | 0 errors | 0 errors |
| preSchedule.test.ts | 15 passed, 1 skipped (cache-absent) | 24 passed, 0 skipped |
| generatedSchedules.test.ts | 13 | 26 |
| publish.test.ts | 211 passed, 1 skipped | same (the skip is corpus-absent, unrelated) |
| measureFieldAveragedRanks.test.ts | 37 | 37 |
| Full root suite | 232 files; 4,987 passed, 64 skipped, 1 failed | 231 files; 5,002 passed, 62 skipped, 1 failed |

The one failure, before and after, is pre-existing and unrelated:
`scripts/measureRpCalibration.test.ts > docs/models/rp-attribution.md cannot drift off the record it
describes`. It fails at the fork point on main. `comm -13` of the failure sets is empty. The
orchestrator independently re-ran the five named files (474 passed, 1 skipped) and tsc after Task 2.

## Cost

| Measure | Result |
|---|---|
| `generateSchedule`, 76 teams x 10 | 15.2 ms per call |
| `generateSchedule`, 37 x 12 (2026 median roster) | 4.8 ms per call |
| 2026 presim scope | 215 RP-eligible events, 72 distinct (roster size, matches per team) cells |
| Added publish time, fresh grid per event | ~17.6-18 min (23m28s publish) |
| Added publish time, shared by shape (shipped) | ~6.2-6.4 min |
| Cache memory | ~1.0 MB per 76x10 cell, ~0.7 MB per 37x12 cell; ~50-73 MB at 72 cells; ~130 MB worst case at the cap |

## Behaviour change

Events with 101-200 teams were split into two template blocks and are now scheduled whole, up to
1,024 teams. Rosters under 6 were already skipped and still are.

## Deliberate survivors

- `packages/harness/publish.ts` ~L3381, comment "after loading a template, building schedule 0...":
  outside this change, and the file is held by sigmascout-26. Tidy it after the merge.
- `scripts/measureFieldAveragedRanks.ts` L11, L113, L470: historical wording, including the verbatim
  rung-1 criterion, which must not be paraphrased.
- `docs/models/rung2-generated-schedules.md` and `random-vs-generated-schedules.md`: machine-rendered
  historical records that still name their (now deleted) writer scripts, next to the retired note.

## Deviations

- The planner moved the three script deletions, the package.json entry and the helper relocation
  from Task 3 into Task 2: deleting the reader breaks their imports, so root tsc would go red between
  commits. Task 3 became records only.
- CONTEXT.md said `measureFieldAveragedRanks.ts` only imported `matchesPerTeamFor`. It also imported
  four helpers and two types from `measureGeneratedSchedules.ts`, which were relocated.
- A Task 2 grep printed about 10 lines of `scheduleTemplates.test.ts` (header, imports, test names)
  before that file was deleted unread. No licence text appeared.
- The cache encodes one byte per slot up to 128 teams instead of two bytes throughout, halving memory
  for every real FRC roster. A test covers the two-byte path.
- The closing note's team ceiling was corrected from 1,023 to 1,024 in `8a5b13dc`.

## Coordination record

- sigmascout-26 (260914-01x) asked sessions to keep clear of `publish.ts` and to message before any
  publish, seed, deploy or push. It was told this branch changes `publish.ts` in four small places and
  needs its own republish after theirs.
- sigmascout-74 (260913-nvn) excluded every file this branch rewrites or deletes from its comment
  pass. 260913-nvn then closed (Jacob's call). Its `consistencyByTeam` -> sigma rename and the trims
  it held back on this branch's files are now the pending todo
  `finish-nvn-held-back-trims-and-sigma-rename`, to run after this merge and sigmascout-26's push.
