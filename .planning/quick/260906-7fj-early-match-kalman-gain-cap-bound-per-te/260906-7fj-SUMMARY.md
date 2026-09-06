---
quick_id: 260906-7fj
phase: quick-260906-7fj
plan: 01
subsystem: sigma1-experiment
tags: [experiment, sigma1, kalman-gain, positive-result, rule-a-pass, needs-tune]
status: complete
dependency-graph:
  requires: []
  provides: []
  affects:
    - packages/core/algorithms/sigma1/kalman.ts (working-tree only, patched 8 times, reverted 8 times, never committed)
    - packages/core/algorithms/sigma1/index.ts (working-tree only, patched 8 times, reverted 8 times, never committed)
tech-stack:
  added: []
  patterns:
    - "Inertness proven bitwise by replaying the patched code at its identity value and sha256-comparing against the baseline, rather than asserting no-op by inspection"
    - "Scripted multi-file arm patcher with refuse-on-drift guards and CRLF awareness"
key-files:
  created:
    - .planning/quick/260906-7fj-early-match-kalman-gain-cap-bound-per-te/score-gaincap.cjs
    - .planning/quick/260906-7fj-early-match-kalman-gain-cap-bound-per-te/patch-gain.cjs
    - .planning/quick/260906-7fj-early-match-kalman-gain-cap-bound-per-te/260906-7fj-RESULTS.md
  modified: []
decisions:
  - "POSITIVE RESULT: capping the per-team alliance-sum Kalman gain at 0.20 passes Rule A on both legs (pooled accuracy +0.08pt, Brier -0.000295) and closes 38% of VPR's pooled deficit to EPA, from -0.204pt to -0.127pt. First mechanism in this investigation to do either."
  - "C-2 confirms the mechanism where predicted: early_acc improves at roughly TWICE the full-set rate (+0.0016 vs +0.0008 at g20), i.e. the gain is concentrated in the early window the 260905 autopsy identified as the seat of EPA's advantage."
  - "STRUCTURAL FINDING: coldStartVariance and the measurement-noise contribution are seeded from the SAME quantity, so a green team's gain is pinned near 0.5 and NO existing parameter can move it - scaling coldStartConsistencyVariance moves numerator and denominator together. Sigma1Params has no degree of freedom for 'learn slower early'. This is why six prior experiments moving P produced muted, season-inconsistent effects."
  - "PLAN PREMISE CORRECTED: the gain does NOT approach 1. g60 was inert and g45 left 2022 sha256-identical, because three equal-variance teammates each sit near 0.33. VPR over-learns by roughly a factor of two, not catastrophically."
  - "IN-SAMPLE RESULT NOT CLAIMED AS A WIN: per-season best caps give pooled 0.76710 vs EPA 0.76687 (VPR ahead, 111% of gap), but this is selection on the scored seasons themselves AND the per-season spread is adversarial to rolling-origin selection - 2024 wants NO cap while its selection window (2022+2023) both want one."
  - "No promotion, no tuning, no SIGMA1_CODE_VERSION bump - the output is a recommendation to add maxTeamKalmanGain as an inert-at-default searchable parameter and re-tune."
metrics:
  duration: "~75min"
  completed: 2026-09-06
actuals:
  tasks: 4
  commits: 2
---

# Quick task 260906-7fj: Early-match Kalman gain cap Summary

Successor to `260906-6zc`, which falsified the carry-mean hypothesis and closed the last open
half of the season-boundary axis. 6zc relocated the problem to within-season dynamics; the 260905
autopsy's green-team slices located it more precisely still (VPR WINS a team's very first match,
then LOSES matches 1-5). This task tested whether bounding the per-team Kalman gain recovers that
slice.

**Result: POSITIVE — the first Rule-A pass and the first real narrowing of the EPA gap in this
whole line of work.**

| configuration | pooled accuracy | gap to EPA | gap closed |
|---|---|---|---|
| epa@5.0.0+baseline | 0.76687 | | |
| vpr baseline (promoted) | 0.76483 | -0.204pt | |
| **vpr, single cap 0.20** | **0.76560** | **-0.127pt** | **38%** |
| vpr, per-season best | 0.76710 | +0.023pt | 111% — IN-SAMPLE, not claimed |

Seven arms (0.60 / 0.45 / 0.30 / 0.20 / 0.15 / 0.10 / 0.05) bracket every season's optimum.
g20 and g15 both pass Rule A. 2026 flips outright at g10 (+0.04pt, VPR ahead of EPA).

## What was built

**Task 1** — `patch-gain.cjs` (six anchored edits across two files, refuse-on-drift guards,
CRLF-aware) and `score-gaincap.cjs` (derived from 6zc's scorer, arm directory repointed),
validated against both standing anchors before any arm ran.

**Task 2 — the inertness proof, run as a test rather than asserted.** Patched at `maxGain = 1`,
replayed 2022, and required sha256 identity with the baseline. It passed exactly
(`2ea000c2a73f8dd9...`). This is strictly stronger than 6zc's free cold-start control: it proves
the six edits are a true no-op at default, so any movement in the arms is the cap and not the
plumbing.

**Task 3** — seven arms, strictly in sequence, never two patches held at once, each typechecked
clean and reverted with `git checkout --` before the next.

**Task 4** — scored all nine series, applied C-1..C-5 mechanically, wrote RESULTS.md.

## The finding underneath the numbers

The plan's premise was wrong and the correction is the more valuable output. It predicted the
gain approaches 1 so that one match nearly overwrites a green team's rating. It does not — g60
was inert and g45 left 2022 byte-identical, because `K_j` is a SHARE of pooled variance and three
equal-variance teammates each sit near 0.33.

The reason is structural: `coldStartVariance = seedConsistencyFor(...)` (`index.ts:1877`) while
the measurement noise `R` is the sum of teammates' consistency estimates, defaulting to
`coldStartConsistencyVariance` (`index.ts:750`). **A team's belief variance `P` and its own
contribution to `R` come from the same seed**, so a green team's gain is pinned near 0.5 —
an implicit ceiling nobody designed, and one that no current parameter can move, because scaling
that quantity moves numerator and denominator together.

So VPR's early gain is not catastrophic, it is **uniformly about twice what it should be**, and
`Sigma1Params` cannot express the correction. That also explains why six prior experiments moving
`P` (carry variance, carry evidence rate, carry trust) produced muted and season-inconsistent
effects: they were pushing on a ratio that re-equalises.

## Why the in-sample crossing is not claimed as beating EPA

Per-season best caps put VPR ahead pooled (+0.023pt). It is not a win, for two independent
reasons recorded in RESULTS.md: each season's cap was selected by looking at that season's own
result, and — more seriously — the per-season optima (0.20 / 0.10 / NO CAP / 0.15 / 0.10) are
adversarial to rolling-origin selection. 2024 is the only season that wants no cap, and its
selection window (2022 and 2023) both want one, so the protocol would hand 2024 a cap it is
punished for. The defensible candidate is the single global 0.20.

## Recommended next step (not started)

Add `maxTeamKalmanGain` to `Sigma1Params` at an inert default of 1, wire it to the two score-side
call sites only, register it in `SIGMA1_SEARCH_SPACE` at roughly `{ min: 0.08, max: 1, scale:
"linear" }` (below 0.05 collapses, above 0.45 is inert), and run the rolling-origin re-tune under
`decideAcceptance`. Watch 2024 specifically. Fallback if out-of-sample selection mishandles it:
the single global 0.20, already a Rule-A pass on its own.

## Deviations from plan

The sweep was extended from the pre-committed three arms (0.60/0.45/0.30) to seven, downward, as
each new point showed the effect still climbing. The pre-committed criteria C-1..C-5 were not
changed, and every added arm was scored by the same instrument against the same baselines. The
extension was reported to the operator before the final two arms ran.

Two foreign edits from a concurrent session appeared in `packages/` mid-run
(`harness/publish.ts`, then `ingest/normalize.ts` + `ingest/schemas.ts`). Verified the replay path
reads the corpus DB via `replay.ts` and does not call the edited ingest functions on the
`--seasons` path; independently, g60's 2022 stream came back byte-identical to a baseline
generated days earlier, which demonstrates the pipeline stayed reproducible throughout. Nothing
foreign was ever staged — every commit here was staged by explicit path.
