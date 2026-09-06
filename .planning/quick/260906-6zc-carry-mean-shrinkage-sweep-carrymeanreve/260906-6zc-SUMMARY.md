---
quick_id: 260906-6zc
phase: quick-260906-6zc
plan: 01
subsystem: sigma1-experiment
tags: [experiment, sigma1, carry-mean, negative-result, axis-closed]
status: complete
dependency-graph:
  requires: []
  provides: []
  affects:
    - packages/core/algorithms/sigma1/carryover.ts (working-tree only, patched three times, reverted three times, never committed)
tech-stack:
  added: []
  patterns:
    - "Working-tree-only model experiment: patch -> typecheck -> replay -> revert -> confirm clean, never committed"
    - "Scripted arm patcher (patch-arm.cjs) so N arms are character-identical except the constant, replacing hand-diff containment arguments with a structural one"
key-files:
  created:
    - .planning/quick/260906-6zc-carry-mean-shrinkage-sweep-carrymeanreve/score-carrymean.cjs
    - .planning/quick/260906-6zc-carry-mean-shrinkage-sweep-carrymeanreve/patch-arm.cjs
    - .planning/quick/260906-6zc-carry-mean-shrinkage-sweep-carrymeanreve/260906-6zc-RESULTS.md
  modified: []
decisions:
  - "HYPOTHESIS FALSIFIED: raising carryMeanReversion (0.069/0.088 -> 0.25/0.40/0.60) hurts monotonically in every carry-active season and every metric. C-1's falsification condition met exactly - no arm improved any of 2023/2025/2026."
  - "AXIS CLOSED IN BOTH DIRECTIONS: the untested direction (reversion -> 0) is worth at most +0.02pt by linear extrapolation from the measured slope, against a 0.20pt deficit. carryMeanReversion must not be re-proposed without a new mechanism attached."
  - "The over-dispersed-carried-means explanation for the autopsy's over-confidence and blowout-loss signatures is DEAD. Early-season accuracy degraded fastest across the sweep, so the carried mean is informative and under-used, not over-dispersed."
  - "2024's reputation corrected: it is NOT a season that rejects priors generally. It tracks every other season in wanting the carried mean un-shrunk; its 0-for-16 record is specifically against extra carry CONFIDENCE."
  - "No promotion, no tuning, no SIGMA1_CODE_VERSION bump - a completed negative measurement, per the plan's P-4"
metrics:
  duration: "~50min"
  completed: 2026-09-06
actuals:
  tasks: 3
  commits: 2
---

# Quick task 260906-6zc: Carry-mean shrinkage sweep Summary

Tested whether VPR's carried season-boundary means are OVER-DISPERSED — it shrinks a carried
rating only 6.9-8.8% toward the rookie baseline where EPA shrinks a frozen 40% — and whether
raising that shrinkage would close VPR's 0.20pt pooled winner-accuracy deficit to EPA.

**Result: FALSIFIED, and the axis is closed in both directions.** Three arms at 0.25 / 0.40
(EPA parity) / 0.60 were monotonically worse than the promoted baseline in all four
carry-active seasons and on both accuracy and Brier. VPR's deficit to EPA WIDENED at every step:
-0.20pt -> -0.27 -> -0.42 -> -0.64.

## What was built

**Task 1** — `score-carrymean.cjs`, an N-arm scoring instrument adapted from 260905-wwt's
`score-carrytrust.cjs` (same streaming discipline, intersection rule, tie exclusion, early slice
and per-series version guard). New: arms resolved by directory rather than fixed names, an
explicit `d_epa_pt` head-to-head column, and a mechanical Rule-A line per arm. Validated against
both of 260905-wwt's anchors BEFORE any arm ran — the exact 83,655-match scored count with zero
dropped in every season, and the per-season epa/vpr accuracy directions reproducing the two
harness artifacts' own combined slices to within 0.03pt.

**Task 1 (also)** — `patch-arm.cjs`, a scripted arm patcher. Rather than hand-editing three
times and arguing containment by diff comparison (260905-wwt's approach), the arms are generated
from one script so they are character-identical except the constant. It refuses to run if the
constant is already present, if the anchor has drifted, or if the use site is not unique. It is
also CRLF-aware: `core.autocrlf` re-materializes the file with Windows endings after
`git checkout --`, which silently broke `\n` anchors on the second arm until handled.

**Task 2** — three arms, strictly in sequence, never two patches held at once. Each: patch ->
`npx tsc --noEmit` (clean) -> `pnpm harness --seasons 2022-2026 --algorithm vpr` -> `git checkout
--` -> confirm clean. All three artifacts report the unchanged `9.0.0+rolling-2026-09c`.

**Task 3** — scored all five series, applied C-1..C-5 mechanically, wrote RESULTS.md.

## Results

| pooled (n=83,655) | accuracy | brier | early_acc | vs baseline | vs epa |
|---|---|---|---|---|---|
| baseline (0.069/0.088) | 0.7648 | 0.1587 | 0.7450 | | -0.20pt |
| epa | 0.7669 | 0.1634 | 0.7516 | | |
| r25 (0.25) | 0.7642 | 0.1592 | 0.7428 | -0.42 SE | -0.27pt |
| r40 (0.40) | 0.7627 | 0.1599 | 0.7397 | -1.44 SE | -0.42pt |
| r60 (0.60) | 0.7605 | 0.1611 | 0.7356 | -2.97 SE | -0.64pt |

C-3 (control) PASSED: every arm's 2022 stream is sha256-identical to the baseline and every 2022
metric matches to four decimals, because 2022 is the cold-start season and `carrySeason` returns
before any carry work. C-1, C-2, C-4 and C-5 all failed.

## Why this is worth having measured

The single most informative column is `early_acc`, which degraded FASTEST across the sweep
(0.7450 -> 0.7356, steeper than full-set accuracy at every arm). The early-season window is
where `reports/autopsy-260905/FINDINGS.md` located the entirety of EPA's advantage. Shrinking
VPR's carried mean made VPR worse precisely where it was already losing, which means the carried
mean is **informative and under-used** — the opposite of the plan's hypothesis.

That kills the over-dispersion explanation for the two autopsy signatures (VPR more confident on
disagreements yet losing them; VPR losing the blowout slice 56.1/43.9), and it closes the second
and last half of the carry axis. Stage 1-3 and 260905-wwt closed the variance half; this closes
the mean half. Nothing about the season boundary is left to try.

## Where the evidence points next (not started — awaiting operator direction)

`FINDINGS.md`'s green-team slices survive this result and sharpen it: VPR WINS a team's very
first match (EPA share 48.6%, n=247) and then LOSES matches 1-5 (EPA share 53.6%, n=1,850), with
the edge gone by 16+. The cold-start seed is fine; the first few UPDATES are where the rating
goes wrong — a within-season gain problem, not a boundary problem.

Mechanism implicated: VPR's Kalman gain `P / (P + R)` is unbounded in [0,1], and a team is seeded
at 17-33x the `minConsistencyVarianceRel` floor, so the gain on its first observation is near 1
and a single match nearly overwrites the rating. EPA's `percent_func` is bounded and floors at
0.2, so no single match can dominate. Capping the per-update gain for a team's first few matches
is untested, targets EPA's winning slices directly, and — being within-season — is not obviously
exposed to 2024's confidence veto. Would need a new inert-at-default knob.

## Deviations from plan

None material. One process fix was needed mid-task: `patch-arm.cjs` was made CRLF-aware after
`git checkout --` restored `carryover.ts` with Windows line endings and broke the second arm's
anchor match. Caught by the script's own refuse-on-drift guard rather than by producing a wrong
patch — the guard did its job.

A foreign edit to `packages/harness/publish.ts` (another session's 260905-tll work) appeared in
the working tree mid-run. Verified it is not imported by `cli.ts` or `replay.ts` and therefore
cannot affect replay output; it was never staged. Every commit in this task was staged by
explicit path.
