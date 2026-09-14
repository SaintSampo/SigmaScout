---
task: 260914-ndu
type: quick
mode: measurement-only
requirement: ALGO-05
date: 2026-09-14
files_modified: []
---

# Quick Task 260914-ndu: does SPR's within-season adaptation help?

**Requirement.** ALGO-05: the model adapts online within a season, and the harness validates
(on vs off) that adaptation improves the 2023-2026 score. The v1.0 re-audit marked it unsatisfied
because SPR's on/off comparison ran on 2016-2022 only and its 2023-2026 run had no off arm.

**Authorization.** Jacob, 2026-09-14: "prove if adaption helps or not. do not change any live code,
just run a test yourself", then "you are allowed to spend 2023-2026". Nothing under `packages/`
or `apps/` changes for the measurement. Every script, parameter file and result lives in this
directory.

## What "adaptation" means for SPR

SPR has three online mechanisms that move the model within a season, beyond folding match results
into ratings:

| mechanism | knob | what OFF means |
|---|---|---|
| link temperature | `tauLr` | tau stays constant |
| point scale | `scaleMinLr` (EWMA floor 0.01) | the scale is a plain running mean with no recency weighting |
| fast form | `qFast`, `fastPriorVar` | one timescale; no mean-reverting form component |

A model that never updates ratings within a season is not tested. It is a strawman, and it can't
be expressed without a code change.

## Arms

Each OFF arm overrides `packages/spr/frozen-params.json` (ON). **Naive** arms just switch the
mechanism off. **Fair** arms switch it off and then re-select the knobs the removal leaves orphaned,
using 2016-2022 only. The comparison is then best static model against the shipped adaptive model.
The selections are in `DESIGN-GRID.txt` and `scripts/design-grid.ts`, and the committed values are
in `arms/*.json`.

| arm | overrides | design-era selection |
|---|---|---|
| off-tau-naive | `tauLr 0` (tau fixed at 1) | none |
| off-tau-fair | `tauLr 0`, `tau0` | tau0 grid, min design Brier |
| off-scale-naive | `scaleMinLr 0` (all-time running mean) | none |
| off-scale-fair | `scaleMinLr 0`, counter reset each season (within-season running mean) | none |
| off-fast-naive | `qFast 0`, `fastPriorVar 0` | none |
| off-fast-fair | as naive + `qSlow`, `seasonVar`, `priorVar` | 270-point grid, max design accuracy, Brier breaks ties |
| off-all-naive | all three naive switches | none |
| off-all-fair | fast-off + within-season mean scale + static tau, re-selected jointly | 270-point grid on accuracy, then tau0 on Brier |

Accuracy cannot depend on tau: tau > 0 never changes the sign of z, and the rating update never
reads tau. So structural knobs are selected on accuracy and tau0 afterwards on Brier.

`scripts/runner.ts` mirrors `packages/spr/evaluate.ts`'s loop so it can reset the scale counter.
Its equivalence to `runEval` is asserted bit-for-bit, on two parameter sets, before any arm is scored.

## Measurement (pre-registered before any 2023-2026 number is computed)

- Walk-forward from 2016 through 2026, predicting before updating. Official matches only
  (`packages/spr/data.ts`). Surrogate-affected matches are replayed but not scored.
- Deltas are paired over the same matches and oriented so **positive = adaptation helps**:
  accuracy ON-OFF (ties excluded, `accuracyCall`), Brier OFF-ON (ties count), log loss OFF-ON.
- Intervals are 95% event-blocked percentile bootstraps, from `packages/harness/eventBootstrap.ts`
  (2000 resamples, seed 42).
- The headline slice is **all 2023-2026 matches pooled**. Quals-only, each season, and the 2016-2022
  design era are reported for context and do not change the verdict.

### Verdict rule (per arm, headline slice)

- **HELPS**: the accuracy and Brier point estimates both favour ON, at least one of the two intervals
  excludes zero in ON's favour, and neither excludes zero against ON.
- **HURTS**: the mirror image.
- **MIXED**: one interval excludes zero for ON and the other excludes zero against it.
- **NO DETECTABLE EFFECT**: anything else.
- Tau arms make identical calls on every match by construction (checked, not assumed), so they are
  judged on the Brier interval alone.

### ALGO-05 verdict

**off-all-fair** decides it: best static model against the shipped adaptive model. The per-mechanism
arms say where any effect comes from, and the naive arms show how much of the gap is just the
removal breaking tuned knobs.

- off-all-fair HELPS: ALGO-05 is satisfied as written. Adaptation is validated on 2023-2026.
- Any other verdict: ALGO-05's text claims something that was measured false or unproven. The
  requirement is re-issued, dated, to state the measured outcome. This task does not change the
  model either way.

## Tasks

1. Run the design-era grid and commit this plan, the scripts and `arms/*.json` before any
   2023-2026 evaluation.
2. Run `scripts/adaptation-ab.ts` once and keep its output (`AB-RESULT.txt`) as the result.
3. Record the verdict: SUMMARY.md, REQUIREMENTS.md ALGO-05 and the milestone audit's ALGO-05 entry.
4. Then, per Jacob, remove references to 2023-2026 being sealed, now that it is spent (separate
   commits).
