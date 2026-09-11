# PCM design-era result — NEGATIVE. Holdout not spent.

**Verdict: KEEP INCUMBENT (BPR). The 2023+2024 holdout was never broken and
2025/2026 remain reserved.** `holdout.ts` has never been run.

Measured 2026-09-11, design years 2016–2022, current scorer (a `pRed === 0.5`
no-call is a miss, not half credit), 82,735 scored matches over 911 events.
Identical rows in every arm.

| arm | accuracy | Brier |
|---|---|---|
| BPR @ `model.ts` `DEFAULTS` (all optional knobs inert) | 70.56% | 0.1880 |
| PCM @ `PCM_DEFAULTS` | 70.74% | 0.1858 |
| **BPR @ `frozen-params.json` (the real tuned model)** | **72.91%** | **0.1755** |
| PCM @ tuned-derived knobs | 72.82% | 0.1754 |

## Read this before quoting the first run

The committed run in `8728f4be` reported PCM beating BPR by +0.177pp accuracy
and −0.00222 Brier, and printed `RULE A: PCM improves BOTH`. That comparison was
against `packages/bpr/model.ts`'s `DEFAULTS`, which is **the all-knobs-inert
starting point for the tuner, not the model that ships**. Against the actually
frozen parameter set, PCM is −0.093pp on accuracy and −0.00002 on Brier — level
at best.

`tune` is worth 2.35pp here. The component split is worth 0.18pp against an
untuned baseline and nothing against a tuned one.

## Why — the mechanism, not just the number

The component residual against the corrected total is ≤0.007 points per alliance
per season (`meanAbsAsymmetry` ≤0.015). **The components sum to the total
essentially exactly, so the decomposition carries no additional information about
what an alliance scored.** All it can change is how that score is attributed
across the three robots, and attribution only helps if a team's phase profile
transfers between alliances better than its total does.

Against that it pays three costs: the same one-observation-per-alliance credit
assignment problem solved three times on smaller, noisier signals; three
estimates summed instead of one; and three phases that are strongly positively
correlated, so the split largely re-measures one quantity three times rather than
adding independent evidence.

The tuned set is where this becomes visible. Tuning moves `obsSd` 0.45 → 1,
`qSlow` 0.0015 → 0.00002 (75× smaller) and `priorVar` 0.5 → 0.1 — every one of
them in the direction of trusting a single observation less. **The component
split and the tuning are substitutes.** Both buy better behaviour under noisy
credit assignment; once tuning has bought it, the extra structural flexibility
has nothing left to add and only costs variance.

## Caveat on the fairest arm

`PcmParams` has no `softCredit` knob, so in the tuned-derived arm the baseline
ran with `softCredit` **on** and PCM structurally could not. That is precisely
the credit-assignment correction, and PCM's three independent rank orderings make
the problem it addresses worse rather than better. The −0.093pp is therefore
against a slightly favoured opponent. It is not expected to flip the conclusion,
but it is not a clean fight either, and anyone reviving this should close that
gap before re-measuring.

## Two things this does NOT say

1. **It says nothing about `w2`/`w3`.** Both arms of the committed run used
   `w2 = w3 = 1`. The 2.35pp tuning gain is the whole set moving together —
   `obsSd`, `qSlow`, `priorVar`, `rookieMean`, `seasonVar`, `tauLr`, `w2`/`w3`
   and `softCredit`. `packages/bpr/ablate.ts`'s `"purely additive alliances
   (w2=w3=1)"` variant isolates the rank weighting against the frozen file and
   has not been run here.
2. **It does not change the displayed component numbers.** `phaseAuto`,
   `phaseTeleop` and `phaseEndgame` are byte-identical across all four arms —
   in BOTH designs the phase filters are driven only by observed phase outputs,
   and no match outcome ever reaches a phase rating. Wiring components into
   `predict` cannot make the displayed components more meaningful; it only
   changes what the prediction is made of. Validating the displayed components
   is separate work with a different objective function.

## A number not to compare against

`packages/bpr/frozen-params.json` records `_design_accuracy_2016_2022: 0.73081`.
That is on the **retired** scorer, which gave half credit for a `pRed === 0.5`
no-call. The same parameters score **72.91%** on the current scorer. The
difference is a scoring-convention change, not a regression.

## State of the package

Committed, tested (10 + 18 tests green), typechecks clean, and inert — no
algorithm id, no artifact surface, no publish path, nothing promoted. `pnpm
pcm:eval` reruns the design-era comparison. `pnpm pcm:holdout` still refuses
without `--break-seal`, committed frozen parameters, and a clean tree across
eight sealed paths.
