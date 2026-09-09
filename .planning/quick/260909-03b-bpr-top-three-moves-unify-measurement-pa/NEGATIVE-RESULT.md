# Negative result: P1 is dropped, and no 2023 test is warranted

Quick task `260909-03b`. Measured on **2016–2022 only**. HEAD `a1e93821`.
Evidence: `BAR.md`, `BAR-OUTPUT.txt`, `CHAMPS-DESIGN-ERA.txt`.

This document replaces the `PRE-REGISTRATION.md` the passing branch would have
produced. **There is nothing to test on 2023, so no command is handed over.**

---

## Which gate stopped it, and with what interval

**GATE B.** Pre-registered rule, written before the measurement existed:

> PASS iff BPR-minus-EPA is negative with a 95% interval excluding zero on at
> least the `{2,3,4}` definition. If it does not reproduce, the holdout slice was
> noise at n=5,820, and P1 is DROPPED rather than fitted to a number Jacob cannot
> honestly re-test.

Measured on the design era, paired and event-blocked, 2,000 resamples:

| slice | n | BPR | EPA | BPR−EPA paired | 95% interval | excludes 0? |
|---|---|---|---|---|---|---|
| champs {3,4} | 6,774 | 71.97 | 71.91 | **+0.060pp** | [−0.877, 1.041] | no |
| **champs {2,3,4}** | **11,789** | **70.76** | **71.00** | **−0.240pp** | **[−1.014, 0.528]** | **no** |
| size proxy 121–200 | 9,561 | 70.82 | 70.98 | −0.159pp | [−0.977, 0.708] | no |
| everything else | 71,306 | 73.21 | 70.12 | +3.088pp | [2.644, 3.545] | YES |

The gate's condition is not met on any champs definition.

## Why the proposal is not advanced

P1 was "close the champs deficit": make the anti-additivity weights respond to an
alliance's own rating spread, on the theory that at championships every alliance
member is strong, the true spread is narrow, and suppressing the 2nd and 3rd
teams over-corrects. Its entire evidential basis was one holdout slice —
2023–2026 champs events, n=5,820, BPR 74.67 vs EPA 76.51, **−1.84pp**.

On the design era, which holds **twice** that many champs matches (11,789 across
108 events, and championships exist in every design year), the deficit is
−0.240pp with an interval that comfortably spans zero. On the `{3,4}` definition
— the one closest in size to the slice that generated the hypothesis — BPR is
**ahead** by +0.060pp. BPR's Brier is *better* than EPA's on every champs slice
measured (0.1882 vs 0.2045 on `{2,3,4}`).

The −1.84pp is consistent with sampling noise around a true effect near zero.
Adding a hyperparameter to close a gap that does not exist on the only data that
may inform design would be fitting to holdout noise — exactly the failure this
gate was placed here to prevent, and exactly the kind of unfalsifiable
model-growth the project's failure log already records once.

A second, independent measurement points the same way: anti-additivity's own
ablation delta **restricted to the champs slice** is −0.104pp [−0.471, 0.252],
including zero. The mechanism P1 wanted to make spread-responsive is not
measurably load-bearing at champs in the first place, so the proposed knob had
little to act on even had the deficit been real.

## What was NOT disproved

Two claims were bundled in the original finding and separate cleanly. Being
precise about which one died matters, because the surviving one is interesting:

- **"BPR loses at champs" — not supported.** See above.
- **"BPR's *lead* is absent at champs" — real and large.** Off-champs BPR beats
  EPA by **+3.088pp** with an interval far from zero; at champs the advantage is
  statistically indistinguishable from zero. BPR's edge genuinely does not
  extend to championship play.

That contrast is a real, unexplained property of the model and is worth
understanding. But "our lead shrinks here" is a different research question from
"we are behind here", and it does not justify the specific mechanism P1 proposed.
Anyone picking this up later should start from the contrast, not from the
disproved deficit — and should note that P4 (understand 2024 before banking it)
is the nearer neighbour to it in the review's own ranking.

## Explicitly: no 2023 test

The holdout remains **fully unspent**. No season of 2023–2026 was read by this
task. Concretely:

- No candidate parameter file exists — `packages/bpr/candidate-spread-params.json`
  was never created.
- No `spreadBeta` knob exists in `packages/bpr/model.ts`, in
  `packages/core/algorithms/bpr.ts`, or in `packages/bpr/tune.ts`
  (`grep -rn spreadBeta packages/` returns 0 matches). Task 4 never ran, so
  unlike a Gate C failure there is no inert knob to retain or remove.
- `packages/bpr/frozen-params.json` still has **exactly one commit** and was
  never edited.
- `reports/bpr-2023-test.jsonl` does not exist.
- The only holdout invocation made during this task was
  `--dry-run`, which resolves its plan and evaluates nothing
  (transcript in `GUARDS-PROOF.txt`).

**There is no candidate, therefore there is nothing to test.** Running a 2023
evaluation now would spend a season of the only remaining out-of-sample evidence
to compare the incumbent against itself.

## What this task nonetheless bought

The two moves that did land are real and permanent, and they are why this gate
could be resolved honestly at all:

1. **P3 — the measurement path is unified.** Every BPR figure is now computed on
   the shared population under the shared accuracy convention. The design-era
   figure moved from a flattering **73.081%** to an honest **72.871%**, and the
   population reconciles exactly against the shared harness across all ten
   seasons. The seal now covers the model and the shipped port, and two live
   holdout-read paths were closed.
2. **P2 — the bar is measured, and it was wrong in the safe-sounding direction.**
   The real paired bar is **0.169pp**, not the assumed ~0.45pp. The review's
   figure was the *level* quantity (measured here at 0.445pp). A bar 2.6x too
   high would have rejected genuine improvements, and it is now corrected for
   every future BPR contrast.

A gate that stops a change is the gate working. P2 existed precisely because it
was cheap enough to run before P1, and it earned its place by killing P1 for the
cost of an afternoon rather than for the cost of a holdout season.
