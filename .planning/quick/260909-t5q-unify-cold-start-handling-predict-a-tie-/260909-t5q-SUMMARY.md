---
phase: quick-260909-t5q
plan: 01
subsystem: harness-scoring, compare-page, match-tables
tags: [cold-start, scoring, harness, compare, ui]
status: complete
dependency-graph:
  requires: []
  provides:
    - packages/core/scoring/coldStart.ts (buildColdStartIndex, applyColdStartTie, NO_COLD_START_INDEX)
    - packages/harness/corpusColdStart.ts (corpusColdStartIndex)
    - HarnessPredictionInput.isColdStart / ExclusionCounts.coldStart
    - PredictionRecord.coldStart / MultiAlgorithmPredictionRecord.coldStart stamp
    - EventMatchSchema.coldStart / TeamSeasonMatchSchema.coldStart (optional, D-04)
    - CompareExclusionCountsSchema.coldStart (optional, D-04)
  affects:
    - OPR, EPA, BPR predictions for a corpus-global first-appearance match
    - Compare page Data coverage table (5th exclusion column)
    - Event and team match tables' Call column
tech-stack:
  added: []
  patterns:
    - "single stamp threaded end-to-end: WalkForwardSimulator stamps once, every downstream consumer reads the stamp rather than re-deriving"
key-files:
  created:
    - packages/core/scoring/coldStart.ts
    - packages/core/scoring/coldStart.test.ts
    - packages/harness/corpusColdStart.ts
    - .planning/quick/260909-t5q-unify-cold-start-handling-predict-a-tie-/scripts/coldStartCensus.ts
  modified:
    - packages/harness/replay.ts
    - packages/harness/score.ts
    - packages/harness/artifact.ts
    - packages/harness/report.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/cli.ts
    - packages/harness/promote.ts
    - packages/harness/publish.ts
    - packages/harness/tune.ts
    - packages/harness/eventScopeDiagnostic.ts
    - scripts/epaVsStatbotics.ts
    - scripts/reparamEquivalence.ts
    - apps/web/src/components/compare/coverageRows.ts
    - apps/web/src/components/compare/DataCoverageTable.tsx
    - apps/web/src/components/compare/MethodologyNote.tsx
    - apps/web/src/components/event/EventMatchTable.tsx
    - apps/web/src/components/event/eventMatchAxis.ts
    - apps/web/src/components/team/MatchTable.tsx
    - apps/web/src/routes/methodology.compare.tsx
    - "plus ~13 test files updated for the new required/optional fields (see Deviations)"
decisions:
  - "D-01: corpus-global first appearance is the ONE predicate all three algorithms consult, via WalkForwardSimulator's optional constructor arg"
  - "D-02: cold start is keyed off the structural flag alone, never off pRedWin===0.5, so an ordinary D-Q3 no-call is provably unaffected"
  - "D-03: neutral em-dash in both Call columns, accessible label 'Not scored — no prior data', distinct from correct/incorrect"
  - "D-04: no republish run; CompareExclusionCountsSchema.coldStart and both match-row schemas' coldStart are OPTIONAL so today's live artifacts keep parsing"
metrics:
  duration: "~2.5 hours"
  completed: 2026-09-09
actuals:
  tokens: 210000
  tasks: 3
  commits: 4
---

# Quick Task 260909-t5q: Unify cold-start handling — predict a tie when all 6 robots are unseen Summary

One shared, corpus-global predicate now decides cold start for OPR, EPA and BPR alike; a cold-start match's prediction is forced to exactly 0.5, counted in a new visible `exclusionCounts.coldStart` bucket, rendered as a neutral em-dash in both match tables' Call column, and explained in the Compare methodology note — with no republish performed.

## What Was Built

**Task 1 — the shared predicate, end to end.** `packages/core/scoring/coldStart.ts` is a dependency-free leaf exporting `buildColdStartIndex` (walk-forward: ask before adding, so a team seen only in a later match still counts as unseen now), `NO_COLD_START_INDEX` (a frozen, mutation-proof empty sentinel — see Deviations for why plain `Object.freeze` alone does not achieve this), and `applyColdStartTie` (generic copy-with-`pRedWin`-forced-to-0.5). `packages/harness/corpusColdStart.ts` builds the real, corpus-wide, offseason-inclusive index from a `Corpus` handle, memoized per handle. `WalkForwardSimulator` (`replay.ts`) takes this index as an optional second constructor argument (default: the no-op sentinel), computes cold start once per match in both `run` and `runAll`, and stamps `coldStart: true` on the record when it applies — the single source of truth every downstream consumer reads. `score.ts` gained `ExclusionCounts.coldStart`, `HarnessPredictionInput.isColdStart` (required), and a new branch in `aggregateScores`'s exclusion chain placed AFTER surrogate and BEFORE missing-result — verified by an automated string-order check. The six production `WalkForwardSimulator` constructions (`cli.ts` ×2, `promote.ts` ×2, `publish.ts` ×2) were wired with a real corpus index; `tune.ts`'s and the two `scripts/*.ts` constructions were deliberately left on the default per the plan's own instruction, with each producer still reading `isColdStart` off the record's stamp (`r.coldStart === true`) rather than a hardcoded literal, so the vocabulary stays single-source even though the value is always `false` there today.

**Task 2 — surfacing it.** `CompareExclusionCountsSchema` gained an OPTIONAL `coldStart` key (D-04); `EventMatchSchema`/`TeamSeasonMatchSchema` gained an optional `coldStart: true` literal on played rows. `coverageRows.ts`'s `COVERAGE_EXCLUSION_COLUMNS` grew a fifth entry, "No prior data", collapsed through a new `collectOptional` helper that treats a missing key as "no opinion" (never coerced to zero) — so a slice where no algorithm publishes the key collapses to `absent`, matching today's live D-04 state. `DataCoverageTable.tsx` needed no hardcoded colspan fix (it already derives `colSpan`/`COVERAGE_LEAF_COLUMN_COUNT` from `.length`); stale "four"-based prose comments were corrected to describe the new five-column reality. Both `EventMatchTable.tsx` and `MatchTable.tsx` gained a new Call-column branch, positioned after "not played" and before "actual tie"/correct/incorrect, rendering the same em-dash glyph but WITH an accessible label (`"Not scored — no prior data"`) distinct from both existing labels, read from the row's own `coldStart` flag — never derived from `pRedWin === 0.5`. `MethodologyNote.tsx` gained a new always-visible paragraph (`COLD_START_EXPLANATION`) explaining the rule in plain language, with no transcribed count (D-04 defers that).

**Task 3 — the census.** A read-only script (`.planning/quick/260909-t5q-.../scripts/coldStartCensus.ts`) opens the corpus read-only, builds the real corpus-global index, and reports the numbers below. No republish, no R2 call, no network access.

## Task 3 Census Results — the D-04 report of what a republish would change

Run against `data/corpus.sqlite`:

```
Total cold-start matches across the whole corpus (all event types): 271
Total cold-start matches in OFFICIAL (non-offseason) events only:    270

season | coldStart total | coldStart official | coldStart offseason | played official | official share %
2016   | 269 | 269 | 0 | 13302 | 2.02%
2017   | 2   | 1   | 1 | 15440 | 0.01%
2018   | 0   | 0   | 0 | 16962 | 0.00%
2019   | 0   | 0   | 0 | 18051 | 0.00%
2020   | 0   | 0   | 0 |  4663 | 0.00%
2022   | 0   | 0   | 0 | 14677 | 0.00%
2023   | 0   | 0   | 0 | 16353 | 0.00%
2024   | 0   | 0   | 0 | 17029 | 0.00%
2025   | 0   | 0   | 0 | 17877 | 0.00%
2026   | 0   | 0   | 0 | 18403 | 0.00%
```

**BPR cross-check:** BPR's own header (`packages/core/algorithms/bpr.ts`) documents 274 dead-even cold-start matches in 2016 and 1 in 2017. This census's official-events-only figures are **269 in 2016** and **1 in 2017** — 2017 is an exact match; 2016 is in the same neighbourhood (269 vs 274, a 5-match / 1.8% difference), not identical.

**Explanation for the 2016 gap (not a predicate bug — verified, not guessed):** the corpus carries four 2016 events flagged `event_type: 100` (preseason "Week 0" scrimmages, e.g. `2016week0`, `2016cass`) that publish `is_offseason: 0` — so this census's "official" bucket (which only excludes `is_offseason === 1`) counts them as official, and per D-01 they are correctly included in the corpus-global index (they are real played matches inside the ingested corpus). 16 played matches across those four events introduce 23 distinct teams to the corpus roughly two months before the regular 2016 season starts. Any 2016 regular-season match whose six teams would otherwise all be cold-start, but where one or more of those teams already appeared in a Week 0 scrimmage, is correctly NOT cold-start under D-01 — exactly the kind of match this predicate is designed to catch — while BPR's own reference count evidently comes from a stream that did not include (or otherwise did not count) those Week 0 matches. This matches the plan's own first suggested cause ("offseason and preseason inclusion in the index versus BPR's own stream") and required no change to the predicate.

**What a republish would change (as directed):**
1. Every one of the 270 official cold-start matches (269 in 2016, 1 in 2017) moves out of `scoredCount` and into `exclusionCounts.coldStart`, identically in OPR, EPA and BPR, by construction — Task 1 placed the new branch after every existing one, so no other exclusion's attribution moves.
2. Winner accuracy and Brier for 2016 (and negligibly 2017) will move by an amount this census cannot predict — it depends on how those specific matches currently score, which this script does not measure. Stated plainly rather than guessed, per the plan's own instruction.
3. The Compare coverage column stays `absent`, and both Call columns keep rendering exactly as they do today, until a republish actually runs. No republish was performed by this task.

## Deviations from Plan

### Auto-fixed / necessary plumbing (Rule 2/3)

**1. `apps/web/src/components/event/eventMatchAxis.ts` was not in the plan's `files_modified` list but had to be touched.** `EventMatchTable.tsx`'s new Call-column branch reads `row.coldStart`, and `EventMatchRow` (built by this file's `toRow`) had no such field. Added an optional `coldStart?: true` to the interface and copied it from `EventMatchSchema.coldStart` in the played branch of `toRow`, mirroring `actualWinner`'s existing played-only convention. Without this the Call-column glyph in `EventMatchTable.tsx` would have been unreachable dead code.

**2. `apps/web/src/routes/methodology.compare.tsx`'s `METHODOLOGY_NOTE_SKELETON_LINE_COUNT` was bumped from 2 to 3.** `MethodologyNote` now always renders two paragraphs (the near-tie caption plus the new cold-start explanation) instead of one, so the pending-state skeleton's footprint had to grow by one line to avoid a layout jump when the real note mounts (the file's own stated design goal).

**3. `packages/harness/report.ts`'s excluded-total and breakdown were initially missed in the first commit, then fixed in a follow-up commit (`2d39b507`).** The plan's own Task 1 action explicitly named this file; it was overlooked during the main edit pass and caught by a final line-by-line audit against the plan text before writing this SUMMARY. `renderHeadToHeadTable`'s `excludedTotal` and its parenthesised breakdown now include `coldStart` alongside `offseason`/`surrogateAffected`/`missingResult`. `quarantined`'s pre-existing omission from both is left exactly as it was, per the plan's own instruction.

**4. Roughly a dozen test files needed a `isColdStart`/`coldStart` addition purely to satisfy the now-required `HarnessPredictionInput.isColdStart` field or the now-five-key `ExclusionCounts`/`ScoreSlice` equality checks** — `artifact.test.ts`, `digest.test.ts`, `eventScopeDiagnostic.test.ts`, `selectionProvenance.test.ts`, `tune.test.ts`, `report.test.ts`, `epaVsStatbotics.test.ts`, plus the Task-2-side `coverageRows.test.ts`, `DataCoverageTable.test.tsx`, `MethodologyNote.test.tsx`, `methodology.compare.test.tsx`. This is exactly the plan's own instruction ("Now let the typechecker drive the rest... In test files, add the false literal next to the existing surrogate literal") rather than an unplanned deviation, but is called out here because these files are not individually named in the plan's `files_modified` frontmatter list.

### Explicitly out of scope (named, not silently skipped, per the plan)

**1. `packages/bpr/evaluate.ts`'s own scorable predicate was NOT touched.** That package carries a sealed 2016-2022/2023-2026 holdout the user has standing instructions never to disturb (`feedback_never_tune_bpr` memory). BPR's `data.ts`/`evaluate.ts` never import `HarnessPredictionInput` at all — they define their own, unrelated `isSurrogateAffected` — so this task's typechange to `HarnessPredictionInput` did not even touch that file's typecheck surface. BPR's own dead-even cold-start count (274 in 2016) is used here only as a cross-check, per the plan's own framing, never as a specification the new predicate was made to match.

**2. `apps/worker/src/scheduled.ts`'s live predict path was NOT touched.** The Worker has no corpus handle, so it cannot build a real cold-start index; a live match whose six teams are all corpus-global first-timers after ten seasons of ingested history is not a reachable state in practice, so the only unreached surface is a displayed confidence, per the plan's own framing.

### Observations recorded, not fixed (per explicit plan instruction)

- `report.ts`'s `excludedTotal`/breakdown still omit `quarantined` — a pre-existing gap this task's own action text explicitly said to leave alone.
- `DataCoverageTable.tsx`'s `DATA_COVERAGE_EXPLAINER_STRUCTURE` string still says "the four excluded columns" (now five) — left untouched because it is locked, "checker-approved copy this task does not own" per that file's own Decision-4 comment; a stale-but-harmless literal, not a factual error, flagged inline with a comment for a future copy pass rather than reworded here.
- `packages/harness/tune.test.ts`'s `replayedPrediction()` test helper (used only via `as any` casts) was not given an `isColdStart` field — no typecheck or behavior requires it there, unlike every other producer.

### Concurrent-session hazard encountered and how it was handled (not a plan deviation, but load-bearing for verifying this task's own commits)

This project runs multiple concurrent sessions against the SAME working checkout (worktrees disabled per the working agreement). During Task 1's commit, another concurrent session ran a broad `git add`/commit cycle (`feat(quick-260909-tom): pure bubble-chart projection module for Teams`, commit `67a87775`) WHILE this task's Task 1 changes were sitting staged in the shared index, sweeping all 22 of this task's Task-1 files into that commit under an unrelated message. That other session detected the problem on its own end and ran `git reset` (soft/mixed, to `HEAD~1`) to undo its own over-broad commit, leaving this task's changes sitting uncommitted again — at which point this task committed them properly, by explicit path, as `0d950e49`. No data was lost (verified via a clean `tsc --noEmit` and full `vitest run` both before and after the incident), and no destructive git command (`reset --hard`, `clean`, force-push) was used at any point by this task. Documented here because the plan's own `<verification>` block asks for `git log --stat` to show a clean, attributable commit history for this task — the actual history is one commit richer than a single-session run would have produced (`0d950e49`, `d7711a3c`, `70509928`, `2d39b507`), and briefly detoured through someone else's commit before landing there.

### Foreign-file verification (working agreement)

The working agreement named `apps/web/src/components/teams-table/TeamsTable.tsx` and `packages/core/rankingPoints/*` as foreign uncommitted edits present at task start, to be left untouched. By the time this task's Task 2 work began, both had already been committed away by other concurrent sessions (visible in `git log`: prior `feat(rp)`/`refactor(swing)` commits) — so the plan's `<verification>` instruction to confirm they are "still modified and still unstaged" no longer applied; there was nothing left to avoid touching, and neither was touched by this task regardless. Every commit in this task was staged by explicit path, never `git add -A`/`git add .`/`git commit -a`, and `git show --stat` was checked after each commit to confirm only intended files landed.

## Verification

- `npx vitest run packages/core/scoring/coldStart.test.ts packages/harness/score.test.ts packages/harness/replay.test.ts` — pass (90 tests).
- `npx vitest run apps/web/src/components/compare apps/web/src/components/event/EventMatchTable.test.tsx apps/web/src/components/team/MatchTable.test.tsx apps/web/src/lib/api/compare.compat.test.ts` — pass.
- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json` — both clean.
- Branch-order automated check (surrogate → coldStart → missing-result) — pass.
- Both Call columns carry the `"Not scored"` accessible label — pass.
- Full repo-root suite: `npx vitest run` — **234 test files, 4266 tests passed, 4 skipped, 0 failed** (run after every task, and again after the Task 1 report.ts follow-up fix).
- Task 3's census script ran cleanly against the real corpus with no fixture substitution.

## No test could not be made to pass

Every test that was run passed. No test was skipped, disabled, or left red.

## Known Stubs

None. No stub, placeholder, or hardcoded-empty value was introduced by this task.

## Threat Flags

None beyond what the plan's own `<threat_model>` already named and mitigated (T-t5q-01 through T-t5q-04, all addressed as designed: `CompareExclusionCountsSchema.coldStart` is optional and pinned by `compare.compat.test.ts`; the new exclusion bucket is visible and counted, never silently dropped; no task read/printed/interpolated `.env`; every commit was staged by explicit path).

## Self-Check

- `packages/core/scoring/coldStart.ts` — FOUND
- `packages/core/scoring/coldStart.test.ts` — FOUND
- `packages/harness/corpusColdStart.ts` — FOUND
- `.planning/quick/260909-t5q-unify-cold-start-handling-predict-a-tie-/scripts/coldStartCensus.ts` — FOUND
- Commit `0d950e49` (Task 1) — FOUND in `git log`
- Commit `d7711a3c` (Task 2) — FOUND in `git log`
- Commit `70509928` (Task 3) — FOUND in `git log`
- Commit `2d39b507` (report.ts follow-up) — FOUND in `git log`

## Self-Check: PASSED
