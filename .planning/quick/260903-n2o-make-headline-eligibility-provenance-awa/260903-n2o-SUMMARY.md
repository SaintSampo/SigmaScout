---
phase: quick-260903-n2o
plan: "01"
subsystem: scoring-harness
tags: [scoring, headline-eligibility, provenance, compare-page, adversarial-review]
dependency-graph:
  requires:
    - "quick-260903-krp (the ordering-only rule this adds the missing provenance clause to)"
  provides:
    - "isHeadlineEligible(season, corpusSeasons, selectedOnSeasons) — the conjunction that restores the structural guarantee the retired TUNE_SEASONS list gave"
    - "selectionProvenance.ts — the first and only reader of provenance.tuneSeasons in the repo"
    - "selectCorpusSeasons(db) — eligibility sourced from the corpus, not the --seasons CLI range"
    - "ELIGIBILITY_NOT_CLAIMED — a strict sentinel for call sites that discard the flag"
  affects:
    - ".planning/todos/pending/retune-sigma1-rolling-origin.md (NOT resolved by this; it is what expands VPR from {2025,2026} to {2022-2026} by changing the provenance)"
tech-stack:
  added: []
  patterns:
    - "Required input with an explicit strict sentinel, never a permissive default — 'nothing was tuned on anything' must be unreachable by omission"
    - "One registry reading a committed file's own field, rather than a second independently-maintained record of the same fact"
key-files:
  created:
    - packages/harness/selectionProvenance.ts
    - packages/harness/selectionProvenance.test.ts
  modified:
    - apps/web/src/components/compare/MethodologyNote.tsx
    - packages/harness/score.ts
    - packages/harness/publish.ts
    - packages/harness/cli.ts
    - packages/harness/report.ts
    - packages/corpus/db.ts
    - packages/harness/promote.ts
    - packages/harness/tune.ts
    - packages/harness/eventScopeDiagnostic.ts
    - scripts/reparamEquivalence.ts
decisions:
  - "Eligibility requires BOTH >=2 distinct priors AND that the season is absent from the scoring algorithm's own selected-on set. The first clause alone asserts a property of the OPTIMIZER while reading only a list of years"
  - "selectedOnSeasons is REQUIRED with no default. An empty map reads as 'nothing was tuned on anything' — the most permissive claim available, and precisely the bug being closed. ELIGIBILITY_NOT_CLAIMED is the only permitted absence and forces false"
  - "MethodologyNote's retired sentence removed by OMISSION, not reworded: the fetched Compare artifact carries no per-season selected-on record, and headlineEligible is not a substitute because a false there conflates 'too few priors' with 'the optimizer saw it'"
  - "epa/opr expanding to {2022-2026} is accepted as a correct consequence — ordering alone IS the honest test for a never-tuned baseline — and pinned by test rather than left to surface on a future republish"
metrics:
  duration: ~70min
  completed: 2026-09-03
status: complete
actuals:
  tasks: 5
  commits: 5
---

# Quick Task 260903-n2o: Provenance-aware headline eligibility — Summary

Restores the structural guarantee that quick task `260903-krp` deleted. A season the optimizer was
fitted on can no longer be marked headline-eligible, and the Compare page no longer asserts a
leak-free-selection claim the shipped provenance contradicts.

## Why this existed

`260903-krp` replaced `TUNE_SEASONS = [2022,2023,2024]` — which made a tune season
headline-ineligible **structurally** — with a rule inferring the same property from season
ordering alone. That encodes a premise ("hyperparameters were selected using only prior seasons")
which only becomes true once the rolling-origin re-tune promotes origin-selected parameters. It
has not: the shipped `vpr@7.0.0+tuned-2026-08.json` carries `provenance.tuneSeasons: [2022, 2023,
2024]`, and every rolling-origin run returned `keep-incumbent`.

An adversarial review raised 23 findings; 16 were refuted and **7 survived**. This task fixes them.

**The lesson, recorded because it generalises:** a structural guarantee was traded for an
assumption, and assumptions do not fail loudly. Nothing in the suite went red — the defect was
found by an independent review, and the same was true of the hardcoded season lists caught in
`260903-4fs`. Twice in one session a change was green and wrong.

## The eligibility matrix — evaluated directly, not read from a test

Run against the real corpus and the real committed version file:

```
corpusSeasons (from the CORPUS, not the CLI range): [2019,2020,2022,2023,2024,2025,2026]
vpr  selectedOn=[2022,2023,2024]  eligible=[2025,2026]
epa  selectedOn=[]                eligible=[2022,2023,2024,2025,2026]
opr  selectedOn=[]                eligible=[2022,2023,2024,2025,2026]
```

**VPR is unchanged from what live artifacts already carry.** That is the correct outcome: this
task restored correctness without moving a published number. `epa`/`opr` expanding is right —
ordering alone genuinely is the honest test for a never-tuned baseline — and affects only a future
republish, never anything live.

## The urgent fix (Task 1, shipped first and independently)

`MethodologyNote.tsx` rendered, unconditionally:

> "VPR's hyperparameters for each of 2022–2026 were selected using only seasons before it — no
> displayed season was scored using hyperparameters chosen by looking at it."

False for 2022, 2023 and 2024. And it reached production **without a republish**, because
`buildMethodologyFigures` reads only fields already present in live 5.0.0 artifacts — the next push
of `main` would have deployed it.

Removed by omission rather than reworded: the published artifact carries no per-season selected-on
record, so no honest replacement could be built from it. `headlineEligible` is not a substitute — a
`false` there conflates "too few priors" with "the optimizer saw this season".

## What makes the guarantee structural again

- `selectionProvenance.ts` reads `provenance.tuneSeasons` from the committed version file — **the
  first read of that field anywhere in the repo**. `promote.ts` has written it since Phase 3 and
  nothing ever consumed it.
- Its `vpr` resolution mirrors `applyPromotedOverrides`' own file-presence rule, with a test
  asserting the two agree — otherwise the flag could describe a different parameter set than the
  one actually scored, which is the same bug class one level down.
- A missing algorithm entry **throws by name**. Absence cannot be silently permissive.
- `corpusSeasons` now comes from `selectCorpusSeasons(db)`, so eligibility stopped being a
  property of how the CLI was invoked. Previously `--seasons 2022-2026` made 2022 and 2023
  ineligible for the *wrong reason*, and a single-season republish would have flipped a live key.

## Verification — re-run by the orchestrator

- **The matrix above** evaluated directly through the real corpus and version file, not via tests.
- **The false sentence** — grep-confirmed gone.
- **Fixtures** — `git diff` across BOTH this task and `260903-krp`: untouched.
- **`data/` and `reports/`** — untouched; nothing promoted, tuned or published.
- **`tsc --noEmit` clean at BOTH roots** (`apps/web` needs its own run; the root tsconfig does not
  reach it).
- **Full suite from the repo root:** 169 files, 2,962 passed, 1 skipped, **0 failed**.
- **Both reverts manually confirmed to redden the new test** by the executor — reverting
  `corpusSeasons` to `[season]` flips the assertion; reverting `selectedOnSeasons` to `{}` makes
  `publishSeasons` throw. That closes the specific gap the first review found, where the
  load-bearing call site could be reverted with the suite still green.
- A second adversarial review ran against this fix.

## What this does NOT do

No tuning search, promotion, publish, or harness replay. `retune-sigma1-rolling-origin` is what
promotes origin-selected parameters and thereby expands VPR's eligible set — and it will do so **by
changing the provenance the rule reads**, with no season list to edit.
