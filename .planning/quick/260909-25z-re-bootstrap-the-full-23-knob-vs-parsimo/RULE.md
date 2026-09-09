---
task: 260909-25z-re-bootstrap-the-full-23-knob-vs-parsimo
document: pre-registered decision rule
date: 2026-09-09
status: committed before any contrast number existed
---

# The rule, committed before the numbers

This file is committed **first**, before `scripts/paired-contrast.ts` has been run
even once and before any file exists under `reports/260909-25z/`. The commit
ordering against those files' mtimes is the proof — a decision rule written after
its own numbers are visible is not a rule, and asserting "I wrote it first" is not
evidence. Check `git log` on this file against `ls -l --time-style=full-iso` on the
report directory.

---

## The question

**Should the 2023 holdout test fire for the full 23-knob BPR variant?**

Review finding **F-20** was marked KILLED on the reasoning that the parsimonious
model sat 0.238pp below the full 23-knob variant against a bar of 0.31pp — and
that under the review's "really ~0.45pp" estimate it sat *further* inside, so the
freeze decision stood "more comfortably".

Quick task `260909-03b` then measured the correct quantity. The 0.45pp figure was
the **LEVEL** two-sigma bar (measured 0.445pp, reproducing the review's estimate
almost exactly). The **PAIRED** event-clustered two-sigma bar is **0.169pp**, 2.6x
tighter. A 0.238pp gap is inside 0.31pp but is **not** inside 0.169pp, so F-20's
verdict plausibly inverts.

Both of those numbers were also measured on the **pre-P3** path, and P3 changed
the scoring population and the accuracy convention. They are stale as well as
possibly mis-bounded. The correction therefore has to be **measured**, not
asserted, and it has to be measured on the current path.

## The measurement

- Paired **event-clustered bootstrap** over whole event blocks, paired by
  `matchKey`, **2000 resamples**, `eventBlockedBootstrap`'s default seed (42),
  on the **post-P3 design-era path only (2016–2022)**.
- The statistics are `meanAccuracyDelta` and `meanBrierDelta` **imported from
  `packages/bpr/holdout.ts`** — the same code a 2023 runner would execute. That
  is deliberate: a design-era interval and a holdout interval must be the *same
  quantity computed by the same code*, or this document is not a valid
  pre-registration for that run.
- The contrast carries **its own 95% percentile interval**. `BAR.md`'s generic
  0.169pp ablation bar is quoted for orientation only and is **not** the
  instrument. Holding a point estimate up against a bar borrowed from a different
  contrast is exactly the error F-20 made; this task does not repeat it in the
  other direction.
- **Orientation convention, fixed here and used everywhere afterwards:**
  **delta = FULL − PARSIMONIOUS.** A **positive accuracy delta** means the full
  variant is better. A **negative Brier delta** means the full variant is better.

## The three arms

| arm | incumbent (parsimonious side) | candidate (full side) | objective symmetry |
|---|---|---|---|
| **A — as-recorded** | `packages/bpr/frozen-params.json` | `.planning/quick/260908-b4t-fresh-2023-blind-model/round5-full.json` | symmetric: both tuned under the pre-P3 objective, both scored under the post-P3 one. Neither side was tuned to the path scoring it. |
| **B — re-tuned** | post-P3 re-tuned parsimonious | post-P3 re-tuned full | symmetric: both tuned under the same current objective. |
| **C — diagnostic** | `packages/bpr/frozen-params.json` | post-P3 re-tuned full | **MIXED objective.** One side fitted to the scoring path, one side not. |

Arm C structurally favours the full side — it is the same inflation pattern F-23
names for un-re-tuned ablations. It is reported in **one line**, labelled a
diagnostic, and **never quoted as the answer**.

Both re-tunes in Arm B seed from their own side's recorded pre-P3 optimum, which
is the precise mirror of what `DECISION.md` rule 4 did within a single objective.

### `obsSdSlope` is excluded from every tune in this task

`tune.ts:83` added `obsSdSlope` to `GRID` **after** the freeze. That knob was
diagnosed from 2023 weeks 0–1 — finding **F-16**, a disclosed holdout glance.
Searching it here would (a) stop the full variant from being the 23-knob variant
whose gap F-20 is about, and (b) import a holdout-motivated knob into a
design-era decision. Every tune passes `BPR_SKIP_KEYS` including `obsSdSlope`,
and both outputs are asserted to carry slope zero.

---

## FIRE the 2023 test only if ALL of

1. **Rule A** — accuracy delta **above zero** AND Brier delta **below zero**.
   Accuracy alone is not a pass. If the full variant wins accuracy but loses
   Brier, that is a **decisive negative** and the test does not fire.
2. **Signal** — the accuracy delta's **95% percentile interval EXCLUDES ZERO**.
3. **Consistency** — conditions 1 and 2 hold on **both Arm A and Arm B**. If the
   arms disagree in sign, or one excludes zero and the other does not, the result
   is unstable to the objective change and does not warrant spending holdout.

**Otherwise: DO NOT FIRE.** F-20's corrected verdict is recorded in whichever
direction the numbers point, and no 2023 command is handed over at all.

### The 2023 candidate, fixed in advance

If the rule fires, the candidate is the **post-P3 re-tuned full variant**
(`retune-full.json`) — the one tuned under the same measurement path that would
score the test. Naming it *now* removes any post-hoc choice between two full
variants after the numbers are visible.

### Rule A is a TIGHTENING, and saying so now is what makes that checkable

`DECISION.md` rule 1 was accuracy-only, with a calibration carve-out at rule 2.
Rule A here requires accuracy **and** Brier. Adding a condition that makes passing
**harder** is not threshold shopping. Recording that claim before the numbers
exist is what allows it to be checked later rather than merely believed.

---

## Measurement is not recommendation

Clearing this rule establishes that **the gap is real**. It does not by itself
establish that **acting on it is wise**. Those are separate questions and Task 3
argues the second one on its own terms — firewall erosion from acting on a changed
pre-registered threshold, the standing no-parameter-bloat rule, F-23's
upper-bound caveat on per-component credit, and the fact that 2023 is not virgin
data. A rule that fires is a licence to *consider* spending holdout, not an
instruction to spend it.
