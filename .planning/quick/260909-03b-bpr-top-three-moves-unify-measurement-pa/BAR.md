# The selection bar, and the two gates

Quick task `260909-03b`, Task 3 (P2). Measured on **2016–2022 only**.
HEAD at measurement: `d4c63be7`. Evidence: `BAR-OUTPUT.txt`, `CHAMPS-DESIGN-ERA.txt`.

This document was written **before** any model change was made, and it is what
decides whether one happens at all.

---

## Part A — the bar is a PAIRED quantity, and it is 2.6x tighter than assumed

`260908-vqr-REVIEW.md` measured a 1.45x design effect from **marginal** standard
errors, inferred a bar of "really ~0.45pp", and noted anti-additivity's −0.47pp
sat "within 0.02pp of it" (F-21). It correctly refused to conclude from that,
because an ablation delta is a **paired** difference: both variants are scored on
the *same* matches, so shared match-difficulty variance cancels inside the
difference before any resampling happens.

Measured here with `packages/harness/eventBootstrap.ts` (2,000 resamples, 911
event blocks, 81,790 accuracy denominator):

| quantity | value |
|---|---|
| full-model accuracy | 72.871% |
| **level** clustered SE | 0.2223pp |
| naive binomial SE | 0.1555pp |
| **design effect** | **1.430x** (review measured 1.45x — reproduced) |
| **level** two-sigma bar | **0.445pp** |
| **paired** clustered SE (anti-additivity contrast) | **0.0845pp** |
| **PAIRED two-sigma bar, full design era** | **0.169pp** |
| **PAIRED two-sigma bar, champs slice {2,3,4}** | **0.364pp** |

**The review's 0.45pp was the LEVEL bar.** The measured level two-sigma value is
0.445pp — it reproduces the review's estimate almost exactly, which confirms the
0.45pp figure was the marginal quantity rather than an error of arithmetic. The
correct paired bar is **0.169pp, about 2.6x tighter.**

The direction matters, and it is the direction the review flagged as possible but
could not determine: **the review's bar was too HIGH, not too low.** A rule built
on 0.45pp would have rejected real improvements. F-21's specific worry — that
anti-additivity's effect was indistinguishable from the bar — dissolves entirely:
at a 0.169pp bar, a −0.503pp effect is **−5.95 sigma**, not a coin flip.

Per-variant paired results (full design era) are in `BAR-OUTPUT.txt`. Five
variants are exactly 0.000 because those knobs are already inert at the frozen
parameters (`foulOn`, `elimWeight`, `defPriorVar`, `huberK`, and `tauLr` for
accuracy) — they change log loss but not a single winner call.

---

## GATE A: PASS

**Rule (pre-registered).** PASS iff the purely-additive ablation's paired delta
has a 95% interval EXCLUDING zero.

**Measured.** `purely additive alliances (w2=w3=1)`, full design era:

```
dAcc  -0.503pp    paired clustered SE 0.0845pp    95% [-0.666, -0.342]    EXCLUDES ZERO
```

**Verdict: PASS.** Anti-additivity is a real axis. Removing it costs 0.503pp of
accuracy, and the interval is nowhere near zero. The model's distinctive
alliance-weighting is doing genuine, measurable work.

---

## GATE B: STOP

**Rule (pre-registered).** PASS iff BPR-minus-EPA is **negative with a 95%
interval excluding zero** on at least the `{2,3,4}` definition. If it does not
reproduce, the holdout slice was noise at n=5,820 and P1 is DROPPED rather than
fitted to a number that cannot honestly be re-tested.

**The hypothesis under test.** From the holdout: champs-level events, n=5,820,
BPR 74.67 vs EPA 76.51 = **−1.84pp**. P1 proposed a spread-responsive
anti-additivity knob to close exactly that gap.

**Measured on 2016–2022** (design era holds 11,789 champs-level matches — twice
the holdout slice — across 108 events):

| slice | n | BPR | EPA | VPR | BPR−EPA paired, event-blocked | excludes 0? |
|---|---|---|---|---|---|---|
| champs {3,4} | 6,774 | 71.97 | 71.91 | 71.02 | **+0.060pp** [−0.877, 1.041] | no |
| champs {2,3,4} | 11,789 | 70.76 | 71.00 | 70.24 | **−0.240pp** [−1.014, 0.528] | no |
| size proxy 121–200 | 9,561 | 70.82 | 70.98 | 70.32 | **−0.159pp** [−0.977, 0.708] | no |
| everything else | 71,306 | 73.21 | 70.12 | 69.72 | **+3.088pp** [2.644, 3.545] | YES |

**Verdict: STOP.** The deficit does not reproduce. On the `{2,3,4}` definition
the point estimate is −0.240pp against a holdout-suggested −1.84pp, and its
interval comfortably includes zero. On `{3,4}` — the definition closest in size
to the holdout slice that produced the hypothesis — BPR is *ahead* by +0.060pp.
On the review's own size proxy, −0.159pp, again including zero.

**Task 4 is SKIPPED. No knob is added. No 2023 test is warranted.**

### What is real, and what was not

Two claims were bundled together in the original finding, and they separate cleanly:

- **"BPR *loses* at champs" — not supported.** On twice the evidence, BPR is
  within a quarter of a point of EPA in accuracy and *ahead* on Brier at every
  champs definition (0.1882 vs 0.2045 on `{2,3,4}`). The holdout's −1.84pp at
  n=5,820 is consistent with sampling noise around a true effect near zero.
- **"BPR's *lead* is smaller at champs" — real and large.** Off-champs BPR beats
  EPA by +3.088pp with an interval far from zero; at champs the advantage is
  statistically absent. That contrast is genuine and worth understanding.

But P1 was a proposal to fix a *deficit*, and there is no deficit to fix. Adding
a parameter to close a gap that does not exist on the only data that may inform
design would be fitting to holdout noise — the precise failure this gate was
placed here to prevent.

A supporting observation, measured independently in Part A: anti-additivity's
ablation delta **on the champs slice** is −0.104pp [−0.471, 0.252], which
includes zero. The mechanism P1 wanted to make spread-responsive is not
measurably load-bearing at champs in the first place, so the proposed knob had
little to act on even if the deficit had been real.

---

## GATE C: NOT REACHED

Stated here as pre-registered, and recorded as moot because Gate B stopped first.

> A candidate is frozen iff ALL of: (i) the selected spread coefficient is
> positive — the direction the champs mechanism predicts, with negative values in
> the grid specifically so this can be falsified; (ii) on the FULL design era,
> accuracy does not fall and Brier does not rise; (iii) on the design-era champs
> slice, the accuracy gain exceeds the champs-slice paired clustered two-sigma
> bar of **0.364pp** AND Brier falls.

No candidate exists, so no condition was evaluated. Recording the bar values
anyway: they were computed before any candidate existed, which is what would have
made them binding, and they remain valid for any future contrast measured on this
same population.

---

## Summary of gate verdicts

```
GATE A: PASS  - anti-additivity delta -0.503pp, 95% [-0.666, -0.342], excludes zero (-5.95 sigma vs the 0.169pp paired bar)
GATE B: STOP  - champs deficit does not reproduce: {2,3,4} -0.240pp, 95% [-1.014, 0.528], includes zero
GATE C: MOOT  - not reached; Task 4 skipped, no candidate frozen, no 2023 test warranted
```
