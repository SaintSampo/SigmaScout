---
phase: quick-260903-3bv
plan: "01"
subsystem: algorithms
tags: [sigma1, carryover, season-boundary, epa, vitest]
dependency-graph:
  requires: []
  provides:
    - "Gap-aware Sigma1 season-boundary carry: mean reversion and consistency decay both apply once per year elapsed, via a new exported reversionOverGap helper"
    - "A truthful fromSeason on every production SeasonBoundary (cli.ts, tune.ts, publish.ts), via a single shared seasonBoundaryFor constructor"
    - "A gap === 1 bitwise no-op proof and a gap === 2 divergence proof against frozen EPA"
  affects:
    - ".planning/todos/pending/extend-corpus-2019-2020.md (the backfill this unblocks — no Sigma1 carry work remains there)"
    - ".planning/todos/pending/retune-sigma1-rolling-origin.md (tune.ts boundary construction changed; behaviour-neutral on the contiguous corpus)"
tech-stack:
  added: []
  patterns:
    - "gap === 1 fast path returning the pre-change expression unchanged, rather than relying on exponentiation to round-trip a value bitwise in IEEE-754"
    - "Shared boundary constructor (seasonBoundaryFor) replacing three independent inline copies of the same SeasonBoundary literal"
key-files:
  created:
    - packages/harness/seasonBoundary.ts
    - packages/harness/seasonBoundary.test.ts
  modified:
    - packages/core/algorithms/sigma1/carryover.ts
    - packages/core/algorithms/sigma1/index.ts
    - packages/core/algorithms/sigma1/carryover.test.ts
    - packages/harness/cli.ts
    - packages/harness/tune.ts
    - packages/harness/publish.ts
decisions:
  - "gap threaded as a required positional argument on sigma1Carryover/sigma1CarryNormalizedRating rather than added to the shared EpaCarryoverInput — the smallest change that reaches the innermost function without widening EPA's frozen surface. Required rather than defaulted to 1, because a silent default is exactly the gap-blindness being removed"
  - "Explicit gap === 1 fast paths in both reversionOverGap and the consistency-decay computation, rather than trusting ** to round-trip to identity — verified necessary: 1 - (1 - 0.37) ** 1 evaluates to 0.37000000000000005, which would have failed the bitwise bar"
  - "Belief variance is untouched at every gap. carrySeason resets it to a cold-start prior via seedConsistencyFor rather than adding process noise, so a longer gap cannot make it more uncertain. A regression test pins this because an earlier framing of the task had wrongly proposed inflating it"
  - "EPA is NOT gap-aware (user decision). It keeps literal Statbotics-parity behaviour, gap included"
metrics:
  duration: ~17min
  completed: 2026-09-03
status: complete
actuals:
  tasks: 3
  commits: 3
---

# Quick Task 260903-3bv: Gap-aware Sigma1 season-boundary carry — Summary

Sigma1's season-boundary carry now applies mean reversion and consistency decay **once per year
elapsed**, with a bitwise-proven no-op on the current corpus and a truthful `fromSeason` on every
production boundary builder. This unblocks `extend-corpus-2019-2020`, where the permanent absence
of 2021 creates a two-year 2020 → 2022 boundary.

## Why this was needed

`SeasonBoundary` has always carried `fromSeason` and `toSeason`, but the elapsed gap was **never
computed anywhere** — those fields were read only to look up component maps and label state. Every
boundary was treated as one year. That is correct on a contiguous corpus and silently wrong the
moment one has a hole in it: a full student-cohort turnover would have been treated as a single
off-season.

## What changed

- `sigma1Carryover` / `sigma1CarryNormalizedRating` take a required `gap`, applying
  `carryMeanReversion` through a new exported `reversionOverGap(reversion, gap)` —
  `1 - (1 - reversion) ** gap`.
- `carrySeason` computes `gap = toSeason - fromSeason`, **guards it** (throws unless it is an
  integer ≥ 1, rather than silently treating a non-advancing boundary as one year), threads it
  into the carry, and raises `consistencyCarryDecay` to the `gap` power.
- New shared `seasonBoundaryFor` in `packages/harness/seasonBoundary.ts` replaces three inline
  boundary literals.

## The catch that made the difference between working and inert

`tune.ts` and `publish.ts` both hardcoded `fromSeason: season - 1`. On a corpus missing 2021 that
reports `fromSeason: 2021` for the 2022 boundary, pinning `gap` at 1 **forever, on exactly the two
paths that tune and publish** — while every test still passed. The planner caught this; without
Task 3 the entire feature would have been dead code where it mattered.

It was safe to fix here because `fromSeason` had **zero production read sites** before this task
created its first one, so the change is behaviour-neutral on the contiguous corpus, and it cannot
reach EPA (whose `carrySeason` reads only `isColdStart` and `toSeason`).

## Verification

Independently re-run by the orchestrator, not taken on the executor's report:

- **Frozen-file diff empty.** `git diff b2120583 --name-only` over `epa.ts`, `carryover.ts`,
  `searchSpace.ts`, `sigma1/params.ts`, `legacyParams.ts` returns nothing. The EPA freeze and the
  "no new hyperparameter" constraint both hold.
- **Full suite green from the REPO ROOT** (not `apps/web`, which collects a smaller set):
  **168 files, 2908 passed, 1 skipped**.
- **The two changed test files pass in isolation:** 21 tests.
- `tsc --noEmit` clean.

The `gap === 1` no-op is asserted with `toBe` against a hand-written pre-change expression — not
against a re-implementation of the new formula, which would have been circular.

## Deviations from plan

None. Task 3 was an addition beyond the original CONTEXT.md file list, but it was justified in the
plan and explicitly approved by the orchestrator before dispatch.

## Issues encountered

Two test-authoring problems, both caught before commit:

- The monotonicity and belief-variance tests initially compared boundaries with **different
  `toSeason` values**, so the season-specific component keys did not line up and the comparisons
  were against `undefined`. Fixed by holding `toSeason` fixed and varying only `fromSeason`, so
  the gap is the sole difference.
- Two `noUncheckedIndexedAccess` errors from dynamic record lookups in the new tests.

## What this does NOT do

No harness run, no tuning search, no publish, no promote. The mechanism is wired and proven inert
on today's corpus; it only starts changing numbers when `extend-corpus-2019-2020` supplies a
non-contiguous corpus.

## Known consequence, accepted by the user

EPA is deliberately not gap-aware. Across the 2020 → 2022 boundary VPR will handle the gap and EPA
will not, so VPR gains some advantage on 2022 and 2023 from the baseline being handicapped rather
than from VPR being better. **Owed follow-up:** when the backtest runs, compute EPA's 2022 figures
both ways once and report the delta, so the caveat is a measured number rather than an open worry.
