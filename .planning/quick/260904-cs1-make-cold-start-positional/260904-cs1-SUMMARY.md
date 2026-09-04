---
phase: quick-260904-cs1
plan: "01"
subsystem: harness
tags: [cold-start, seasonBoundary, structural-prevention, tuning]
dependency-graph:
  requires: []
  provides:
    - "positional cold start — index 0 of the replay range, by construction"
  affects:
    - ".planning/todos/pending/retune-sigma1-rolling-origin.md (a future re-tune now measures a warmer trajectory)"
tech-stack:
  added: []
  patterns:
    - "Positional-by-construction over remembered-constant: make the wrong state unrepresentable rather than memorable"
key-files:
  created: []
  modified:
    - packages/harness/seasonBoundary.ts
    - packages/harness/seasonBoundary.test.ts
    - packages/harness/cli.ts
    - packages/harness/tune.ts
    - packages/harness/publish.ts
    - packages/harness/promote.ts
    - packages/core/algorithms/breakdown/constants.ts
    - scripts/measureRewindGap.ts
    - scripts/reparamEquivalence.ts
    - apps/web/src/lib/seasons.ts
decisions:
  - "Cold start is positional (index === 0), not a value matched against a module constant. The first element of a replay range has no predecessor to carry from — that IS the definition"
  - "COLD_START_SEASON and isColdStartSeason DELETED outright. A stale literal left behind is something the next reader finds and trusts"
  - "--cold-start-season survives, narrowed to a diagnostic-only override for deliberately forcing a non-index-0 season cold. Its old documented purpose ('extending the corpus back to 2016 is a flag, not an edit') is now false and was deleted rather than softened"
  - "Three readers that borrowed the constant for something that was never cold start got their own honest literals: promote.ts's validation-slice season, measureRewindGap.ts's replay-range start, and a comment in apps/web"
metrics:
  duration: ~50min
  completed: 2026-09-04
status: complete
actuals:
  tasks: 4
  commits: 5
---

# Quick Task 260904-cs1: positional cold start — Summary

`seasonBoundaryFor` decided cold start by **matching a module constant** (`COLD_START_SEASON = 2022`)
rather than by position. That made the corpus's first season a fact someone had to *remember*, and
it went stale silently the moment `extend-corpus-2019-2020` moved the corpus start to 2019.

Measured consequence: an origin-2022 tuning replay built state across 2019 and 2020, then
**discarded it at 2022**. Every team entered 2022 from the rookie baseline despite two prior seasons
sitting in the corpus.

## The fix

```ts
isColdStart: coldStartSeason === undefined ? index === 0 : season === coldStartSeason
```

Positional by default; the explicit override survives for a genuine diagnostic. The first element of
a replay range has no predecessor to carry from — that is what a cold start *is*, so it cannot go
stale again.

## The safety argument was DEMONSTRATED, not asserted

Production was republished ~20 minutes before this landed, on numbers produced by the old mode. If
the equivalence did not hold, the live artifacts and the code would silently disagree about how they
were generated.

`seasonBoundary.test.ts` computes every boundary over `[2022, 2023, 2024, 2025, 2026]` both
positionally and with the explicit constant and asserts whole-object `toEqual` at every index — and
separately proves the modes genuinely differ where they should:

```
[2019, 2020, 2022]   positional -> [true,  false, false]     (2019 is the cold start)
[2019, 2020, 2022]   constant   -> [false, false, true ]     (2022 was — the bug)
```

That second assertion is the non-vacuity guard: the equivalence cannot pass by the two modes being
trivially identical. **`publish.test.ts` was not edited at all** (verified: zero occurrences in the
five-commit diff), which was the stated tripwire — if an existing assertion had to move, the safety
case would have been wrong.

## `COLD_START_SEASON` — deleted, all twelve readers resolved

`grep -rn 'COLD_START_SEASON|isColdStartSeason' packages/ apps/ scripts/` returns **zero** matches,
comments included. Of its readers:

- `cli.ts`, `tune.ts`, `seasonParamSets.test.ts` — import dropped, positional default applies.
  `tune.ts`'s `runBoundedSeasons` is the call site this whole task exists to fix.
- `publish.ts` — the `?? COLD_START_SEASON` fallback is gone; an ordinary publish is positional.
- `promote.ts` — was never about cold start. It borrowed the constant because 2022 *happened* to
  also be the corpus's first season. Now `DEFAULT_VALIDATION_SLICE_SEASON = 2022`, its own choice.
- `scripts/measureRewindGap.ts` — same borrowing; now `DEFAULT_REPLAY_START_SEASON = 2022`.
- `apps/web/src/lib/seasons.ts` — comment rewritten; `FIRST_SEASON` stays 2022 as a UI fact
  deliberately independent of the algorithms' replay range.

## A bug my own earlier fix missed

`scripts/measureRewindGap.ts` and `scripts/reparamEquivalence.ts` each carried an inline
`fromSeason: season - 1` boundary literal that quick task `260903-3bv` never centralised — a fourth
and fifth copy beyond the three that task caught. Both misreported the 2020→2022 boundary as a
one-year gap. Both now build boundaries through the shared `seasonBoundaryFor`.

That is the same duplicated-fact pattern for the third time this session, and it is worth naming
that the gap fix which introduced `seasonBoundaryFor` did not itself find all its own call sites.

## Verification — re-run by the orchestrator

- Constant deletion confirmed by grep — zero matches.
- Equivalence test read and run: 6/6, and its assertions checked to be non-vacuous rather than taken
  on trust.
- `publish.test.ts` absent from the diff.
- **170 files, 3,016 passed, 1 skipped, 0 failed.** `tsc --noEmit` clean at both roots.
- `git status --porcelain -- data/ reports/` empty — nothing was re-measured, which mattered because
  production had just been written.

## What this does and does not change

**Does not change** the just-shipped artifacts: a publish over `[2022…2026]` has 2022 at index 0
either way.

**Does change** future tuning replays that start earlier. When the re-tune is run — the user's call —
origin 2022 gets a genuine two-season warm start and 2023 gains real prior state.

**The ten recorded verdicts stay internally consistent** and are not invalidated; the promoted
parameters still match their own validation. But they become **non-comparable** to any future
positional re-tune, which measures a warmer trajectory. That note is recorded in
`retune-sigma1-rolling-origin` so nobody diffs the two sets as though a methodology change were a
model regression.
