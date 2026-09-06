---
quick_id: 260905-tpx
phase: quick-260905-tpx
plan: 01
status: complete
subsystem: sigma1-rp
tags: [measurement, rp, log-loss, hyperparameter-experiment, negative-result]
dependency-graph:
  requires: []
  provides: [rp-pmf-log-loss-objective]
  affects: [".planning/todos/pending/rp-process-noise-own-scale.md"]
tech-stack:
  added: []
  patterns: ["working-tree-only patch/replay/revert experiment", "log-loss objective over a discrete pmf joined against a corpus actuals column"]
key-files:
  created:
    - .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/score-rp-logloss.cjs
    - .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/measure-rp-spread.ts
    - .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/260905-tpx-RESULTS.md
  modified: []
decisions:
  - "Closed .planning/todos/pending/rp-process-noise-own-scale.md as measured-negative: the own-spread-relative RP process-noise form fails the pre-committed verdict criteria against both the control and baseline reference framings (a season worsens by more than the 2.0-SE ceiling under both)."
metrics:
  duration: "~90min"
  completed: 2026-09-05
actuals:
  tokens: 68000
  tasks: 3
  commits: 1
---

# Quick task 260905-tpx: RP own-scale process noise — build an RP-pmf log-loss objective, measure, verdict Summary

Built the missing RP-pmf log-loss objective and used it to measure the own-spread-relative RP
process-noise candidate against both a magnitude-isolating control and the live baseline —
verdict: NO-WIN under both framings, closing the deferred todo as measured-negative.

## What was built

Two committed instruments in the quick task directory:

- **`score-rp-logloss.cjs`** — streams multi-series `predictions-*.jsonl` sets, joins each
  qualifying `vpr`/`qm` row's `redRpPmf`/`blueRpPmf` against `data/corpus.sqlite`'s
  `red_rp_earned`/`blue_rp_earned` (same 0..maxRp scale, verified), and reports per-season and
  pooled mean log-loss (epsilon-floored at `1e-6`), zero-mass counts, out-of-range counts (the
  scale-mismatch guard), a version guard, and a bitwise `pRedWin` win-probability guard between
  series.
- **`measure-rp-spread.ts`** — imports the real 2022/2023/2024 RP rule modules and folds each
  rating-eligible teammate's per-team share of each threshold variable's observed sum into a
  Welford accumulator exactly as `foldRpObservation` does, then derives both a
  count-weighted and an unweighted reference variance and the three relative constants from
  each.

## What was measured

- Instrument A validated on the stale `reports/autopsy-260905` stream before any replay: zero
  out-of-range observations, exactly one `vpr` version (`8.0.0+rolling-2026-09b`), confirming
  the join and confirming staleness relative to the live `9.0.0` promoted set.
- Fresh baseline replay (`reports/rpnoise-baseline-260905`, `vpr@9.0.0+rolling-2026-09c`) scored
  clean: `outOfRange=0` every season, `droppedNoCorpusRp=21` in 2024 only.
- Instrument B measured 2022-2024 per-variable spreads (12 season/variable pairs, e.g. 2022
  `matchCargoTotal` variance 10.32, 2024 `ensembleBonusOnStageRobotsThreshold` variance
  0.000319) and derived the WEIGHTED reference variance `3.964037`, giving relative constants
  `withinEventRel=0.1261340319`, `eventBoundaryRel=2.0181445097`, `coldStartRel=6.3067015929`.
- Task 2 patched `packages/core/algorithms/sigma1/rp/state.ts` twice, in the working tree only:
  Patch C (magnitude control — every season forced to code defaults 0.5/8/25, isolating scaling
  SHAPE from the live promoted set's 2023/2024 legacy-tuned magnitude), and Patch X (the
  own-scale candidate, reading each threshold variable's own pre-match population variance from
  `RpLeague.rpVariableMean` and falling back to today's exact absolute default when fewer than 2
  observations exist). Each was typechecked, replayed across all 5 seasons, and reverted with
  `git checkout --` before the next patch was applied; `git status --porcelain packages` was
  confirmed empty after each revert.
- Scored all three series (`baseline`, `control`, `ownscale`) in both reference framings.
  Win-probability guard: `PRED_WIN_IDENTICAL` in every season, every series, both framings —
  settling by measurement that RP threshold Kalman state does not feed win probability.

## Verdict: NO-WIN (measured-negative)

Against CONTROL: 3/5 seasons improve and pooled improves, but 2024 worsens by +5.15 SE
(exceeds the 2.0-SE ceiling) and its zero-mass count exceeds control's by more than the 10%+5
tolerance (311 vs. 288.9 threshold). Against BASELINE: 4/5 seasons improve and pooled improves,
but 2025 worsens by +2.36 SE (just over the ceiling). Both framings independently fail
criterion 3 (no season worsens by more than 2.0 SE), on different seasons — agreeing on the
overall verdict while disagreeing on the specific failing season, a caveat recorded in RESULTS
for any future iteration. Per the plan's pre-committed rule (ALL five criteria must hold),
this closes `.planning/todos/pending/rp-process-noise-own-scale.md` as measured-negative. The
RP-pmf log-loss objective itself remains a durable, reusable artifact for any future candidate.

## Deviations from Plan

None — plan executed exactly as written, including the two mid-run continuation resumes (the
first execution was restarted from scratch after a transient server termination; no prior
commits or reports existed at that point, so Task 1 was executed cleanly from the beginning).

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary changes. `.env` was never read
by this session (the harness process consumed it via `--env-file`); the working-tree patches
were reverted and verified clean before commit; staging was by explicit path only.

## Self-Check: PASSED

- FOUND: `.planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/260905-tpx-PLAN.md`
- FOUND: `.planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/260905-tpx-RESULTS.md`
- FOUND: `.planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/measure-rp-spread.ts`
- FOUND: `.planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/score-rp-logloss.cjs`
- FOUND commit: `e9ada7c4`
- `git status --porcelain packages data fixtures reports` = 0 lines at completion.
- `npx tsc --noEmit` clean; `npx vitest run packages/harness/digest.test.ts` green (10/10);
  full repo-root `npx vitest run` green (194 files, 3558 passed, 4 skipped, 0 failed).
