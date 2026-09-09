---
phase: quick-260908-n5o
plan: 01
subsystem: methodology-pages
tags: [epa, statbotics, methodology, comparison-artifact, vpr-purge]
dependency-graph:
  requires:
    - packages/harness/score.ts (aggregateScores, ELIGIBILITY_NOT_CLAIMED)
    - packages/harness/statbotics.ts (statboticsReference)
    - packages/harness/pageArtifacts.ts (PagePreambleSchema, PAGE_ARTIFACT_SCHEMA_VERSION)
  provides:
    - epaComparisonKey() / EpaComparisonArtifactSchema (packages/harness/pageArtifacts.ts)
    - scripts/publishEpaComparison.ts (composeEpaComparisonArtifact + CLI)
    - apps/web/src/lib/api/epaComparison.ts (fetchEpaComparisonArtifact)
    - /methodology/epa-vs-statbotics route and its content module
  affects:
    - apps/web/src/components/methodology/methodologyCardData.ts (hub card set)
    - apps/web/src/components/methodology/MethodologyCards.tsx
tech-stack:
  added: []
  patterns:
    - "Cross-season artifact key declared outside PageKind (districtsIndexKey/preScheduleKey precedent)"
    - "Named-error composition gates instead of best-effort merge (publishEpaComparison.ts)"
    - "Content-as-data with a runtime em-dash voice gate over exported string values"
key-files:
  created:
    - scripts/epaVsStatbotics.test.ts
    - scripts/publishEpaComparison.ts
    - scripts/publishEpaComparison.test.ts
    - apps/web/src/lib/api/epaComparison.ts
    - apps/web/src/lib/api/epaComparison.test.ts
    - apps/web/src/components/methodology/epaComparisonContent.ts
    - apps/web/src/components/methodology/epaComparisonContent.test.ts
    - apps/web/src/components/methodology/EpaComparisonPage.tsx
    - apps/web/src/routes/methodology.epa-vs-statbotics.tsx
    - apps/web/src/routes/methodology.epa-vs-statbotics.test.tsx
    - .planning/quick/260908-n5o-purge-intro-to-vpr-page-and-add-statboti/deferred-items.md
  modified:
    - scripts/epaVsStatbotics.ts
    - packages/harness/pageArtifacts.ts
    - package.json
    - apps/web/src/components/methodology/methodologyCardData.ts
    - apps/web/src/components/methodology/MethodologyCards.tsx
    - apps/web/src/components/methodology/acknowledgmentsContent.ts
    - apps/web/src/components/methodology/AcknowledgmentsPage.tsx
  deleted:
    - apps/web/src/routes/methodology.vpr.tsx
    - apps/web/src/routes/methodology.vpr.test.tsx
    - apps/web/src/components/methodology/VprGuide.tsx
    - apps/web/src/components/methodology/vprGuideContent.ts
decisions:
  - "epaComparisonKey() declared as its own function outside PageKind, per the plan's own flagged deviation — the Worker never writes this artifact and the per-season size budget does not apply to a cross-season document."
  - "The EPA-vs-Statbotics fetcher declares its own EpaComparisonFetchError/EpaComparisonValidationError rather than reusing the shared year-carrying ArtifactFetchError/ArtifactValidationError, because this artifact has no year at all and a fabricated year would render a nonsensical error message. Matches apps/web/src/lib/api/manifests.ts's own precedent for a key with no year."
  - "Head-to-head accuracy in the published artifact always reads the offseason-inclusive arm (the production arm the live site serves), never the offseason-excluded arm — scoring excludes offseason matches on both arms regardless, so this is 'the arm the site runs', not a different-scoring choice."
  - "Per-season agreement rows read the min-matches(12) filtered arm, matching the same arm docs/models/epa-vs-statbotics.md's own committed baseline is built from."
actuals:
  tokens: 62000
  tasks: 4
  commits: 4
status: complete
---

# Phase quick-260908-n5o Plan 01: Purge Intro to VPR, ship the EPA-vs-Statbotics explainer (Tasks 1-4) Summary

Re-measured EPA against Statbotics under the shipping `epa@6.0.0+baseline` model with a version
stamp and a walk-forward win-probability arm, built the publish key/schema/publisher with named
gates that refuse to mix model versions or mismatched season sets, shipped a new
`/methodology/epa-vs-statbotics` page (fetcher, content-as-data, three stat blocks, tests), and
purged the retired Intro to VPR page end to end, handing its hub slot to the new page.

## What Was Built

**Task 1 — measurement script.** `scripts/epaVsStatbotics.ts`'s `EpaVsStatboticsReport` now carries
`epaVersion` (read from `epa.version`, never hand-typed) and a per-season `winProbability` arm:
`aggregateScores`' `"combined"`-view slice for our own winner accuracy/Brier, paired with
`statboticsReference`'s own season figure. Two new pure, corpus-free, network-free exports —
`mapRecordsToHarnessPredictionInput` and `selectCombinedSlice` — carry the actual logic and are unit
tested in `scripts/epaVsStatbotics.test.ts` (8 tests). `currentEpaVersion()` is a third small export
that lets the version-stamp equality be tested without running `main()`'s corpus/network driver. The
script itself was NOT run (network + corpus, orchestrator-run in Task 5).

**Task 2 — publish key, schema, publisher.** `packages/harness/pageArtifacts.ts` gained
`epaComparisonKey()` (declared outside `PageKind`, per the plan's own flagged deviation) and
`EpaComparisonArtifactSchema` (one `agreement` array covering both offseason arms, distinguished by
each row's own `includeOffseason` flag; one `headToHead` array). `scripts/publishEpaComparison.ts`
composes the two arm-report JSONs into one artifact, with three named-error gates —
`MismatchedEpaVersionError`, `MismatchedSeasonSetError`, `MislabelledArmError` — each proven by a
dedicated test in `scripts/publishEpaComparison.test.ts` (6 tests) to throw and compose nothing. A
`publish:epa-comparison` script entry was added to `package.json`. The publisher itself was NOT run
(writes to R2, orchestrator-run in Task 5).

**Task 3 — the page.** `apps/web/src/lib/api/epaComparison.ts` fetches the artifact, mirroring
`compare.ts`'s shape but with its own error classes (see Decisions). `epaComparisonContent.ts` holds
the four locked differences (offseason matches, win-probability scale, component maps, no per-year
tweaks) as content-as-data, each reworded from `docs/models/epa-divergences.md` sections 7/4/6/3 for
a student audience rather than pasted, plus the three stat-block intro sentences and a
`headToHeadSummarySentence` whose season count is always derived, never hardcoded.
`EpaComparisonPage.tsx` renders the prose and three stat blocks (per-season agreement, offseason in
versus out with both arms visually paired in one table, head-to-head accuracy) purely from the
artifact prop — no fetch, no query. `methodology.epa-vs-statbotics.tsx` wires one `useQuery` with the
same 404/error/pending/populated branch order `methodology.compare.tsx` uses. 24 tests across the
three new test files, plus the 8 from Task 1 and 6 from Task 2 (38 new tests total this plan).

**Task 4 — the purge.** Deleted `methodology.vpr.tsx`/`.test.tsx` and `VprGuide.tsx`/
`vprGuideContent.ts` outright. `methodologyCardData.ts`'s first card now points at
`/methodology/epa-vs-statbotics` (title "Our EPA vs Statbotics' EPA"); the hub still shows exactly
three cards. `MethodologyCards.tsx`'s destructured first card and its `Link` were renamed to match.
Two surviving comments in `acknowledgmentsContent.ts` and `AcknowledgmentsPage.tsx` named the deleted
`VprGuide`/`vprGuideContent` files directly — these would have tripped the leftover-reference gate,
so they were reworded to describe the retired page by concept instead ("the former Intro to VPR
page"). The web build regenerates `routeTree.gen.ts` (gitignored) with no stale VPR entry.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking] Two pre-existing comments named the deleted files, tripping the leftover gate**
- **Found during:** Task 4's `! git grep -nE 'VprGuide|vprGuideContent|methodology/vpr'` check
- **Issue:** `acknowledgmentsContent.ts` and `AcknowledgmentsPage.tsx` each carried a doc comment
  from an earlier task that named `VprGuide.tsx`/`vprGuideContent.ts` by filename as a design
  precedent. Deleting the files these comments pointed at left dangling references that matched the
  gate's own pattern, which would have failed Task 4's own verify step.
- **Fix:** Reworded both comments to describe the retired page by concept ("the former Intro to VPR
  page") rather than naming the deleted files, matching the plan's own instruction for comments this
  task writes.
- **Files modified:** `apps/web/src/components/methodology/acknowledgmentsContent.ts`,
  `apps/web/src/components/methodology/AcknowledgmentsPage.tsx`
- **Commit:** `250959ce`

**2. [Judgment call, not a plan-literal instruction] The fetcher declares its own error classes**
- **Context:** Task 3's action text names `ArtifactFetchError`/`ArtifactValidationError` (the shared
  classes from `./errors.js`) as the fetcher's error types, mirroring `compare.ts`. Both classes
  require a `year: number` constructor argument, and `v1/methodology/epa-vs-statbotics.json` has no
  year at all — it is a single cross-season document.
- **Decision:** Declared `EpaComparisonFetchError`/`EpaComparisonValidationError` in
  `epaComparison.ts` instead, following `apps/web/src/lib/api/manifests.ts`'s own established
  precedent for a key with no year (`v1/manifest/algorithms.json`). A fabricated year passed to the
  shared classes would have printed a nonsensical "for {year}" error message. The route's `ErrorState`
  component already supports an optional `year` prop for exactly this reason, so the render side needs
  no change; only the thrown-error type differs from a literal reading of the plan text.
- **Files:** `apps/web/src/lib/api/epaComparison.ts`

### Out of Scope, Logged Not Fixed

**Pre-existing root typecheck error, unrelated to this task.** `npx tsc --noEmit` fails on
`packages/harness/tune.test.ts(1069,15): error TS2304: Cannot find name 'Sigma1Params'.` — confirmed
pre-existing (file untouched by this task or by the concurrent session, last modified in commit
`f700ad2d` before this task started) and unrelated to VPR/EPA-comparison work. `npx vitest run` does
not surface it because Vitest's transform performs no full type check. Logged in
`.planning/quick/260908-n5o-purge-intro-to-vpr-page-and-add-statboti/deferred-items.md`, not fixed —
out of this task's scope boundary.

## Task 5 — Deliberately Not Run

Task 5 (`checkpoint:human-action`, gate `blocking`) is ORCHESTRATOR-RUN and is **pending**. It
requires network access this executor's sandbox denies: measuring both arms live against the corpus
and a live Statbotics fetch (`npx tsx scripts/epaVsStatbotics.ts --check` and the offseason-excluded
2022-2026 run), the real `pnpm publish:epa-comparison` R2 write, a live-page verification, and
updating `docs/models/epa-vs-statbotics.md` / `docs/models/epa-divergences.md` to retire the stale
`epa@2.0.0+baseline` figures. None of that ran. As of this SUMMARY, every key under
`v1/methodology/` still 404s, and the new page correctly shows its error/empty state against live R2
— exactly the state Task 5's own `<what-built>` describes. The orchestrator runs Task 5 from the main
context per the plan's `<sandbox_boundary>` and `<instructions>`.

## Known Stubs

None — every table on the new page reads its numbers from the `EpaComparisonArtifact` prop with no
hardcoded fallback. The page correctly renders empty/error states until Task 5 publishes real data;
that is the intended pending-state behavior, not a stub.

## Self-Check: PASSED

- All 11 created files confirmed present on disk.
- All 4 deleted files confirmed absent from disk.
- All 4 task commit hashes (`2bc6f840`, `06bb31cc`, `e2f4b891`, `250959ce`) confirmed present in
  `git log --oneline --all`.
- Full root `npx vitest run`: 220 test files passed, 4084 tests passed, 4 skipped, 0 failed (up from
  the pre-task baseline of 215 files / 4045 tests — the delta is the 5 new test files this plan
  added: `epaVsStatbotics.test.ts`, `publishEpaComparison.test.ts`, `epaComparison.test.ts`,
  `epaComparisonContent.test.ts`, `methodology.epa-vs-statbotics.test.tsx`).
- Root `npx tsc --noEmit`: clean except the confirmed pre-existing, unrelated `tune.test.ts` error
  (logged in `deferred-items.md`, not fixed — out of scope).
- `npx tsc --noEmit -p apps/web/tsconfig.json`: clean.
- `pnpm --filter web build`: succeeded, regenerated `routeTree.gen.ts` with no stale VPR route.
- Leftover gate `git grep -nE 'VprGuide|vprGuideContent|methodology/vpr' -- apps packages scripts`:
  zero matches.
