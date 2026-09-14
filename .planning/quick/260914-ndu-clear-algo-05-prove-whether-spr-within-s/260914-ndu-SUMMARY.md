---
task: 260914-ndu
status: complete
requirement: ALGO-05
date: 2026-09-14
verdict: adaptation helps (Brier and log loss); winner accuracy within noise
---

# 260914-ndu: does SPR's within-season adaptation help?

**Answer: yes, overall. The gain is calibration, not winner calls, and one of the three
mechanisms is a net loss.**

The verdict rule, all off arms and their 2016-2022 knob selections were committed at `c9923e79`,
before any 2023-2026 number existed. `scripts/adaptation-ab.ts` then ran once, and its output is
`AB-RESULT.txt`. No file under `packages/` or `apps/` was changed by the measurement.

## Result on 2023-2026 (69,400 matches, 795 events; positive = adaptation helps)

| arm (what is switched off) | dAcc ON-OFF | dBrier OFF-ON | verdict |
|---|---|---|---|
| **all three, fair** (best static model, re-selected on 2016-2022) | +0.077pp [-0.132, +0.289] | +0.00126 [0.00061, 0.00188] | **HELPS** |
| all three, naive | +2.235pp [1.892, 2.572] | +0.02557 [0.02413, 0.02710] | HELPS |
| fast form, fair | +0.795pp [0.606, 0.979] | +0.00504 [0.00445, 0.00562] | HELPS |
| fast form, naive | +1.388pp [1.181, 1.595] | +0.00821 [0.00762, 0.00880] | HELPS |
| scale recency, fair (within-season running mean) | **-0.270pp [-0.428, -0.107]** | **-0.00152 [-0.00192, -0.00113]** | **HURTS** |
| scale recency, naive (all-time running mean) | +0.849pp [0.590, 1.122] | +0.00429 [0.00343, 0.00522] | HELPS |
| online tau, fair (static tau 0.55) | +0.000pp (identical calls) | +0.00010 [-0.00005, 0.00026] | NO DETECTABLE EFFECT |
| online tau, naive (tau fixed at 1) | +0.000pp (identical calls) | +0.00946 [0.00887, 0.01001] | HELPS |

The ON model scores 78.018% and Brier 0.14884 on 2023-2026.

## What it means

- **ALGO-05 is satisfied as written.** The deciding arm is best-static against adaptive, and it
  passes the pre-registered rule. The Brier interval clears zero, the accuracy interval spans it,
  and neither goes against ON. By season the Brier gain comes from 2025 and 2026; in 2023 and 2024
  it is about zero.
- **Fast form is the adaptation that earns its place.** It is clear of zero in every season
  2023-2026, and on 2016-2022 too. The fair all-off arm closes most of that gap by raising `qSlow`
  to 0.002, a single random-walk timescale. That is why the combined effect is much smaller than
  fast form alone.
- **The scale's recency EWMA is a measured loss.** Replacing it with a running mean that resets
  each season wins on both eras: +0.31pp on 2016-2022, +0.27pp on 2023-2026, and Brier is better
  on both. This is a lead, not a change. Acting on it would change `spr.ts` predictions (a version
  bump) and needs Jacob's call.
- **Online tau adds nothing a fixed tau does not.** It is only better than tau = 1.

## Method notes

- Instrument: the SPR research model (`packages/spr/model.ts`) with `frozen-params.json` as ON,
  replayed walk-forward 2016 through 2026, official matches, predicting before updating. The
  shipped `packages/core/algorithms/spr.ts` differs in a few ways: demo-team exclusion, offseason
  folding, and boundary carry from the last official match. It shares all three mechanisms and
  their values.
- `scripts/runner.ts` mirrors `runEval` so the scale counter can be reset each season. Its
  bit-identical equivalence to `runEval` was asserted before scoring (`DESIGN-GRID.txt`, line 1).
- Intervals: 95% event-blocked percentile bootstrap, from the shared `eventBootstrap.ts`
  (2000 resamples, seed 42).
- No fair-arm selection sits on a grid edge.

## Follow-on in this task

Per Jacob ("you are allowed to spend 2023-2026 ... remove all references to those being sealed"),
references to 2023-2026 as sealed or unspendable were removed from code comments, the SPR
evaluation tool, the RP measurement-script guards, and the docs, in separate commits.
REQUIREMENTS.md (ALGO-05 re-issued to name SPR) and the milestone audit (31/38) are updated.
