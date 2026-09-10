---
task: drop-tba-adjustpoints-from-bpr-scoring-target
quick_id: 260910-4bf
status: complete
date: 2026-09-10
type: implementation
subsystem: algorithms
tags: [bpr, kalman-filter, scoring-target, tba, sealed-code]
provides:
  - "correctionsOf(raw): ScoreCorrections shared-shape helper in both packages/bpr/data.ts and packages/core/algorithms/bpr.ts, computing score - foulPoints - adjustPoints"
  - "cross-module identity test (packages/bpr/scoringTarget.test.ts) pinning requirements (b) malformed-yields-zero, (c) cross-module identity, (d) ADJUST_COMPONENT registered every season"
  - "requirement (a) adjust-cancels-from-target and the port half of (b) pinned in packages/core/algorithms/bpr.test.ts"
  - "equivalence.ts's synthetic payload and score reconstruction now carry adjustPoints alongside foulPoints"
affects: [packages/bpr, packages/core/algorithms/bpr.ts]
prediction_neutral: false
retune: none
holdout_spent: none
requires_republish: true
actuals:
  tasks: 3
  commits: 2
key-files:
  created:
    - packages/bpr/scoringTarget.test.ts
  modified:
    - packages/bpr/data.ts
    - packages/core/algorithms/bpr.ts
    - packages/bpr/equivalence.ts
    - packages/bpr/evaluate.test.ts
    - packages/bpr/model.test.ts
    - packages/core/algorithms/bpr.test.ts
key-decisions:
  - "Shallow raw-field read in both modules rather than routing through the season component map (ADJUST_COMPONENT / tryParseBreakdownPair): state.season is null for the whole first replayed season in the port, and componentMapForSeason throws for an unregistered season, so the component-map route would either make adjust invisible for a season or turn an unregistered season into a hard update-path failure. The shallow read is numerically identical to the component-map route on every parsed payload -- confirmed empirically in Task 3, not merely asserted."
  - "data.ts's malformed-breakdown JSON.parse now returns zeros instead of throwing, matching the port -- an intentional behaviour unification. Task 3 confirmed this affects zero currently-loaded rows (0 mismatches across 152,757 official-play matches)."
requirements-completed: [ADJ-01, ADJ-02, ADJ-03]
metrics:
  completed: 2026-09-10
---

# Quick Task 260910-4bf: Drop TBA's adjustPoints from BPR's scoring target

**score - foulPoints - adjustPoints, identical in both sealed BPR modules, proven by a shared-table cross-module test -- a principled cleanup, not a proven accuracy win.**

## Sealed-path notice

Both `packages/bpr/data.ts` and `packages/core/algorithms/bpr.ts` are listed in
`SEALED_CODE_PATHS` (`packages/bpr/sealedPaths.ts`). **BPR's sealed 78.05%
winner-accuracy figure no longer describes the current code.** It describes the
revision of these two files that predates this change. HEAD after this task's
commits: `dbf6e67a`.

## Republish required

The live site will not reflect this change until BPR artifacts are republished
to R2. Until a republish happens, every published BPR number (rating, win
probability, displayed interval) is computed from the pre-change scoring
target (`score - foulPoints`, without the `adjustPoints` subtraction).

This compounds with already-outstanding republish debt: the
`bpr 2.0.0+baseline` interval-width fix (2026-09-10) is also in code but not
yet on R2.

## Framing -- this is NOT a demonstrated accuracy improvement

The measurement was done ahead of this task (`experiments/phase-bpr`) and was
NOT re-derived here, per instruction:

| Slice | Accuracy | Brier |
|---|---|---|
| 2023 (design-adjacent) | +0.087pp | -0.00036 |
| 2024-25 holdout | +0.003pp | -0.00009 |

**Both accuracy intervals span zero.** This change is justified entirely by
attribution -- a scorekeeper's manual correction is not robot performance, and
a Kalman filter should not take it at full weight as though a robot scored it
(mean |adjust| is only ~0.15 points/match across the whole corpus, but single
corrections reach 150+ points). It is NOT justified by, and must never be
described as, a measured accuracy gain.

Worth carrying forward: mean |adjust| is 0.031 (2024) and 0.044 (2025) but
0.334 (2026), so the holdout years understate what this does live.

## Route confirmation

The measurement in `experiments/phase-bpr` extracted `adjustPoints` through the
season component map (`ADJUST_COMPONENT` / `tryParseBreakdownPair`); this task
ships a shallow raw-field read in both `packages/bpr/data.ts` and
`packages/core/algorithms/bpr.ts`, for the reasons in the plan's design
decision. A throwaway script (`experiments/phase-bpr/verify-adjust-route.ts`,
deleted after this run) loaded the identical official-play population
(`selectMatchesChronological(db, { excludeOffseason: true })`, 152,757 matches
in both routes) through both extraction paths and compared
`redAdjust`/`blueAdjust` per match key:

- Match keys present in one route but not the other: 0
- Rows where either side's adjust value differs between routes: **0**
- Summed |adjust| across the corpus: 38,414.000 (identical from both routes)

This is a field-extraction equivalence check only -- it did not replay the
model, did not compute accuracy or Brier, and never read 2023+ as a holdout.

## Behaviour unification

`packages/bpr/data.ts`'s `loadMatches` previously let a malformed
`scoreBreakdownRaw` `JSON.parse` throw. The new shared `correctionsOf` helper
returns zeros instead, matching the port's existing defensive behaviour. The
route-confirmation check above found **zero rows** where the two extraction
routes disagree on the official-play population `loadMatches` actually loads,
so this behaviour change does not alter any currently-loaded row's
`redAdjust`/`blueAdjust`/`redOut`/`blueOut` values. (The known
malformed-breakdown population -- ~21% of offseason matches carrying one, plus
2018's 140 null-`adjustPoints` sides -- is excluded from `loadMatches` entirely
by `excludeOffseason: true`, which is why zero currently-loaded rows are
affected.)

## What was NOT done

- No re-tune of BPR's frozen hyperparameters.
- No holdout read: never ran a BPR holdout script and never invoked
  `packages/bpr/equivalence.ts --include-holdout`.
- No parameter changes anywhere in `packages/bpr/model.ts` or `BPR_PARAMS`.
- No republish to R2 -- the site still serves the pre-change scoring target
  until a republish is run.

## Task commits

1. **Task 1: Subtract adjustPoints from the target in both modules** --
   `7c88e234` (feat) -- exports `correctionsOf`/`ScoreCorrections` from both
   `packages/bpr/data.ts` and `packages/core/algorithms/bpr.ts`, updates
   `update()`'s target computation, corrects the stale "byte-for-byte" and
   `redOut` doc comments, and carries `adjustPoints` through
   `packages/bpr/equivalence.ts`'s synthetic payload/score reconstruction.
2. **Task 2: Pin the three required behaviours** -- `dbf6e67a` (test) --
   extends `packages/bpr/scoringTarget.test.ts` with the malformed-yields-zero
   loop, the season drift guard over `BREAKDOWN_REGISTERED_SEASONS`, and adds
   a describe block to `packages/core/algorithms/bpr.test.ts` pinning that
   adjust cancels out of the target and that a malformed breakdown still folds
   the match rather than skipping it.

## Verification (re-run by the orchestrator against final HEAD)

```
npx vitest run packages/bpr/scoringTarget.test.ts packages/core/algorithms/bpr.test.ts \
               packages/bpr/evaluate.test.ts packages/bpr/model.test.ts

 Test Files  4 passed (4)
      Tests  80 passed (80)
```

`npx tsc --noEmit` from the repo root: clean, no output.

The three required behaviours are pinned by name:

- requirement (a) `bpr scoring target excludes adjustPoints from the target` (`packages/core/algorithms/bpr.test.ts`)
- requirement (b) `malformed or missing breakdown yields zero, never throws` (both modules; port half also in `bpr.test.ts` as `...never skips the update`)
- requirement (c) `correctionsOf: research model and shipped port agree`
- plus (d) `ADJUST_COMPONENT is mapped for every registered season` -- a drift guard added beyond the brief

## Files created/modified

- `packages/core/algorithms/bpr.ts` -- `correctionsOf`/`ScoreCorrections`
  export, `update()` now computes `score - foulPoints - adjustPoints`,
  corrected PROVENANCE header and stale in-code claims
- `packages/bpr/data.ts` -- mirrors the port; `BprMatch` gains
  `redAdjust`/`blueAdjust`; `redOut`/`blueOut` now corrected for adjust;
  malformed breakdown now degrades to zero instead of throwing
- `packages/bpr/equivalence.ts` -- synthetic breakdown and score
  reconstruction now carry `adjustPoints`
- `packages/bpr/scoringTarget.test.ts` (new) -- the cross-module identity
  test; the only thing holding the two `correctionsOf` implementations in sync
- `packages/core/algorithms/bpr.test.ts` -- pins requirement (a) and the port
  half of (b)
- `packages/bpr/evaluate.test.ts`, `packages/bpr/model.test.ts` -- `BprMatch`
  fixture helpers extended with `redAdjust: 0, blueAdjust: 0` (required once
  `BprMatch` gained those fields; found via `tsc --noEmit`)

## Deviations from Plan

### Design deviation from the task brief (approved by the plan)

The brief steered toward reaching `adjust` via `ADJUST_COMPONENT` /
`tryParseBreakdownPair`. The shipped port cannot use that route: `initState`
sets `season: null` and `foldPhases` returns `unchanged` before it ever calls
`tryParseBreakdownPair` when season is null, so `state.season` is null for the
entire first replayed season -- routing the scoring target through it would
silently zero adjust for a whole season in the port while `data.ts` (which
always has `meta.year`) subtracted it. Additionally `componentMapForSeason`
throws for an unregistered season, deliberately outside the `try`, which would
make a future season a hard failure of the live update path. Verified against
the code before execution; all ten seasons map `ADJUST_COMPONENT` to plain
`adjustPoints` with no arithmetic, so the shallow read is numerically
identical, and Task 3 confirmed that empirically (0 mismatches / 152,757).

### Process note (not a Rule 1-4 deviation)

Task 1's TDD red and green steps were verified separately (red state
confirmed: `correctionsOf is not a function`, 9/9 failing; then implemented
and reconfirmed green) but landed in a single `feat(...)` commit rather than
a separate `test(...)` commit at red followed by a `feat(...)` commit at
green. Functionally the TDD discipline was followed; only the git-history
granularity differs from the plan's described flow.

### Auto-fixed issues

**1. [Rule 3 -- Blocking] Fixed `packages/bpr/model.test.ts`'s `BprMatch`
fixture, not listed in the plan's `files_modified`**

- **Found during:** Task 1, running `npx tsc --noEmit` as the plan instructs
  to find every `BprMatch` object literal
- **Issue:** `model.test.ts`'s local `match()` fixture builds a full
  `BprMatch` object literal and would fail to typecheck once `redAdjust`/
  `blueAdjust` became required fields
- **Fix:** Added `redAdjust: 0, blueAdjust: 0` to the fixture defaults,
  identical to the fix applied to `evaluate.test.ts`
- **Files modified:** `packages/bpr/model.test.ts`
- **Verification:** `npx tsc --noEmit` clean; `packages/bpr/model.test.ts` passes
- **Committed in:** `7c88e234` (Task 1 commit)

---

**Total deviations:** 1 design deviation from the brief (reasoned, verified
against code, numerically identical), 1 auto-fixed blocking issue, 1 process
note (no functional impact)

**Impact on plan:** No scope creep -- the model.test.ts fix was explicitly
anticipated by the plan's own "grep the repo, let tsc be the authority"
instruction.

## Out-of-scope findings (not fixed, logged separately)

Two pre-existing, unrelated test failures surfaced during Task 3's full-suite
run and were confirmed (by content and by re-running before/after an unrelated
concurrent commit landed) to be unaffected by this task:

- `packages/harness/digest.test.ts` -- 5 assertions failing on VPR
  promoted-version fixture staleness (corpus has drifted since fixture
  extraction)
- `packages/gbr/seal.test.ts` -- 1 assertion failing on a stale 2026
  row-count pin (corpus has grown)

Full detail in `deferred-items.md` alongside this summary. Neither touches
BPR, `data.ts`, or any file this task modified.

## Issues encountered

A concurrent session committed unrelated work to the same sealed file
(`packages/core/algorithms/bpr.ts`) mid-task -- a `softCredit` alliance-credit
feature (quick task `260910-52c`, commits `e1ba84dd`, `bbc8e2ed`), landing
cleanly on top of this task's two commits. This task's commits (`7c88e234`,
`dbf6e67a`) were verified intact and unaffected both before and after. No
action was taken on the concurrent work; it is outside this task's scope, but
it is a second un-republished change to the same sealed module, and it means
the sealed 78.05% figure is now stale for two independent reasons.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

BPR's scoring target is corrected and cross-module-identical in both sealed
modules, pinned by tests, with route equivalence confirmed against the real
corpus. Republishing BPR artifacts to R2 is required before the site reflects
this change -- not performed by this task per its stated scope.
