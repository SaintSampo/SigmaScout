---
task: 260909-3oe-build-a-lean-bpr-variant-and-measure-whi
document: pre-registered rule
date: 2026-09-09
head_at_writing: ae9e8e7d
measured_on: 2016-2022 design era only, post-P3 unified path
holdout_read: none, and none permitted by this task
status: committed BEFORE any contrast number existed
---

# The ladder rule

This document is written and committed **before** `reports/260909-3oe/` exists.
That ordering is the whole point and it is checkable: `git log` on this file
against `ls -l --time-style=full-iso reports/260909-3oe/`. A rule written after
its own numbers are visible is not a rule, and "I wrote it first" is an assertion,
not evidence.

Everything below is fixed in advance. Where the measurements later disagree with
what this document expected, the disagreement is recorded in `LADDER.md` rather
than smoothed away by editing this file.

---

## 1. Orientation

Used everywhere afterwards, without exception:

> **delta = CANDIDATE minus INCUMBENT**, where the INCUMBENT is the rung below on
> the ladder.

A **POSITIVE accuracy delta** favours the candidate.
A **NEGATIVE Brier delta** favours the candidate.

---

## 2. The instrument

- Paired **event-clustered** bootstrap over whole event blocks, units paired by
  `matchKey`, both models scored on the same matches.
- **2000 resamples**, `eventBlockedBootstrap`'s default seed (42).
- Statistics imported from `packages/bpr/holdout.ts` — `meanAccuracyDelta`,
  `meanBrierDelta`, `Paired`. **Not reimplemented.** A design-era interval is
  only a valid pre-registration for a later holdout interval if the two are the
  same quantity computed by the same code.
- Scoring through `evalDesign` plus `EvalExtra.onScored` — the post-P3 unified
  path, never a private replay loop.
- **Design era 2016-2022 only.** `evalDesign` cannot reach a holdout season.
- Each contrast carries its **OWN** 95% percentile interval. `BAR.md`'s 0.169pp
  paired two-sigma bar is a standing, pre-existing constant quoted as a secondary
  condition; it is **never re-derived in this task**. Re-deriving a bar during the
  task that reads it is the forking-paths move the predecessor named, and it is
  forbidden here.

---

## 3. The ladder, fixed in advance

Every rung's seed and skip list is named **now**, before any of them runs, so the
search space of each rung is pinned rather than chosen once its neighbours' numbers
are visible.

| rung | components | seed | `BPR_SKIP_KEYS` | output |
|---|---|---|---|---|
| **L0** | none (the frozen incumbent) | — | — | `packages/bpr/frozen-params.json` (never written) |
| **L1** | side bias | `packages/bpr/frozen-params.json` | `obsSdSlope,foulObsSd,foulQ,foulPriorVar,elimWeight,defPriorVar,defQ,huberK` | `candidates/L1-bias.json` |
| **L2a** | side bias + foul submodel | `candidates/seed-L2a-foul.json` | `obsSdSlope,elimWeight,defPriorVar,defQ,huberK` | `candidates/L2a-foul.json` |
| **L2b** | side bias + elim down-weighting | `candidates/L1-bias.json` | `obsSdSlope,foulObsSd,foulQ,foulPriorVar,defPriorVar,defQ,huberK` | `candidates/L2b-elim.json` |
| **L2c** | side bias + defensive suppression | `candidates/L1-bias.json` | `obsSdSlope,foulObsSd,foulQ,foulPriorVar,elimWeight,huberK` | `candidates/L2c-def.json` |
| **L2d** | side bias + Huber clip | `candidates/L1-bias.json` | `obsSdSlope,foulObsSd,foulQ,foulPriorVar,elimWeight,defPriorVar,defQ` | `candidates/L2d-huber.json` |
| **L3** | all five (the full variant) | — | — | `260909-25z/retune-full.json`, already measured, closes the ladder, **no new tune** |

All tunes use the default **3 sweeps**, matching the predecessor's re-tune.

`seed-L2a-foul.json` is L1's params object with `foulOn` set true and **nothing
else changed**. It exists for exactly one reason: `tune.ts`'s `GRID` holds numeric
keys only, so a boolean cannot be flipped by the search. Every other component is
reachable from its inert value by the grid alone.

**Component inert values**, so "still inert" is checkable rather than a matter of
opinion:

| component | knobs | inert at |
|---|---|---|
| side bias | `biasLr` | `0` (`model.ts:418` gates on `> 0`) |
| foul submodel | `foulOn`, `foulObsSd`, `foulQ`, `foulPriorVar` | `foulOn = false` |
| elim down-weighting | `elimWeight` | `1` |
| defensive suppression | `defPriorVar`, `defQ` | both `0` |
| Huber clip | `huberK` | `1e9` |

---

## 4. The F-23 fix, which is the design's purpose

In **every** rung the 13 shared knobs stay **UNLOCKED**, and every component
already present on the rung below stays unlocked too. Only components not yet on
the ladder are skipped.

The 13 shared knobs: `obsSd`, `qSlow`, `rhoFast`, `qFast`, `priorVar`,
`fastPriorVar`, `rookieMean`, `seasonShrink`, `seasonVar`, `tauLr`, `scaleMinLr`,
`w2`, `w3`.

This is the specific fix for **F-23**. `DECISION.md`'s ablation table measured each
component with every *other* parameter pinned at the full model's optimum, which
makes each of its deltas an **upper bound on credit** and therefore useless as
evidence of absence. A credit measured the way this document specifies is an
**estimate**, because the rest of the model was free to re-fit around the
component under test. A component pinned at another model's optimum has never had
a fair chance to earn its place.

---

## 5. `obsSdSlope` is skipped in every tune

It appears in the skip list of every rung above, and it is asserted **zero** in
every candidate file by the automated gate.

Reason: it was diagnosed from 2023 weeks 0-1 (**F-16**). It is holdout-motivated
and must not enter a design-era decision, whatever it might be worth.

---

## 6. The two numbers, defined before they exist

Three slices are computed. Two of them matter.

- **As-scored** (combined) — the pairing over **every** unit, exactly what
  `holdout.ts` would compute on a 2023 run. No unit is dropped for any reason.
  This is the honest headline number and it is what the FIRE rule's conditions
  (i) and (ii) read.

- **Ex-no-call** — the combined pairing with every unit dropped where the
  **incumbent predicts exactly 0.5 OR the candidate predicts exactly 0.5**. The
  condition is **symmetric across the two sides by construction**, so it cannot
  favour either one. This is the FIRE rule's condition (iii).

- **Ex-2016** — drops season 2016 entirely. **Corroboration only.** It is a
  coarser instrument than ex-no-call (it discards ~13,000 genuine units to remove
  ~267 no-calls) and no rule reads it.

### The pre-committed claim, stated plainly and before any number exists

> **The ex-no-call number is the estimate of what a 2023 candidate-versus-incumbent
> test would show.**

The warrant: a 2023 replay is **warm-started** on state carried through 2016-2022.
The mechanism that produces exact-0.5 predictions is the identical-prior cold start
of the first modelled season, where every team sits at the same prior and the two
alliances are numerically tied. That cold start **cannot recur** in 2023.

**This is a STRUCTURAL argument, not a measurement.** Checking it directly would
require stepping 2023, which this task is forbidden to do, so it is recorded here
as an argument and it is labelled as one everywhere it is used.

Its design-era support is the predecessor's own per-season table, and it is strong:
2016 carries **267** parsimonious no-calls; 2017 carries **1**; 2018, 2019, 2020 and
2022 carry **0** each. The moment the model is warm, the phenomenon disappears
entirely. A season warm-started on seven years of state is at least as warm as 2017
was after one.

---

## 7. The `foulOn` handicap, handled in advance

Record each rung's `[tune] start acc=` line from its stderr, into `TUNES.txt`.

L2a is the rung this exists for. Turning `foulOn` on at **un-refit** foul knobs may
start that rung **below** the rung it seeds from, and `tune.ts`'s `better()` accepts
only strict improvements (with an `ACC_NOISE` deadband of 0.05pp), so a 3-sweep
coordinate descent may not recover the lost ground.

**Pre-registered reporting:** if L2a's start is below L1's level **AND** its final is
also below L1's level, report the foul submodel as **NOT EARNING its place**, name
the handicap explicitly, and claim **no more than** that it did not recover from its
own structural starting point under a 3-sweep search. Specifically: do **not** claim
the foul submodel is harmful, and do **not** quietly re-run it with more sweeps to
get a nicer number. The handicap is a property of the search, it is disclosed, and
the parsimony rule is unaffected either way — a component that cannot be shown to
earn its place does not go in.

---

## 8. Bit-identical rungs

If a rung's tuned params equal its seed's params on every key, record the component
as **INERT-AT-OPTIMUM**, record its delta as **exactly zero**, and **SKIP its
contrast run**. Running a contrast of a vector against itself is a guaranteed zero
and costs minutes for no information.

`elimWeight` is the likely case: `tune.ts:75` gives it the values
`[0.0, 0.1, 0.2, 0.3, 0.5, 0.8]` and the inert value **1.0 is not among them**.
Seeding at 1 is still correct — `better()` requires strict improvement, so the rung
keeps `elimWeight = 1` if nothing in the grid beats it — but it means the rung can
come back bit-identical to its seed, which is a **clean negative result**, not a
failure of the run.

---

## 9. PROMOTION rule

A component **earns its place** iff **ALL THREE** hold, measured against the rung
below on the **combined (as-scored)** pairing:

1. **Rule A** — accuracy delta **above zero** AND Brier delta **below zero**.
   Accuracy alone is **not** a pass. This is the condition that catches a variant
   that wins winner-calls while degrading its probabilities.
2. **Signal** — the accuracy delta's **95% percentile interval excludes zero**.
3. **Bar** — the accuracy delta **point estimate is at least 0.169pp**, `BAR.md`'s
   standing paired two-sigma bar measured on this exact population. Quoted, not
   re-derived.

Otherwise the component **does not earn its place**, and fewer components wins.

---

## 10. The combined rung

- If **two or more** components pass promotion: build **exactly ONE** additional
  rung containing all passers, re-tuned (with `foulOn` true in its seed if the foul
  submodel is among them), and contrast it against L1.
- If **exactly one** passes: that rung is the top candidate. No extra rung.
- If **none** passes: the top candidate is **L1** if L1 itself passes promotion
  against L0, otherwise **L0** — that is, nothing is adopted at all.

**Exactly one extra rung, no more.** That bound is pre-registered here precisely so
the decomposition cannot turn into an unbounded search over component subsets, which
is how a design-era exploration quietly becomes an overfit.

---

## 11. RECOMMENDED CANDIDATE — the parsimony rule

Among all rungs satisfying promotion, the recommended candidate is the one with:

1. the **FEWEST COMPONENTS**; ties broken by
2. the **fewest live params keys**; ties broken by
3. the **larger ex-no-call accuracy delta**.

Component count is the operative criterion because it is **unambiguous**, and
because Jacob's standing rule is fewer knobs.

**On the inherited names.** "13-knob", "14-knob" and "23-knob" are inherited proper
names and they mix two counting conventions; they do **not** reproduce under any
single one. Counting live (non-inert) params keys, the frozen parsimonious model has
14, parsimonious-plus-side-bias has 15, and the full variant has 23. Counting only
searchable shared knobs gives 13 on the parsimonious side and reproduces 23 on the
full side only if `tau0` is added back. **Do not relitigate this and do not silently
renumber.** Keep the inherited names, record the derived counts once in a `LADDER.md`
footnote, and argue on component count.

**If the only rung satisfying promotion is the full 23-knob variant, say so plainly**
rather than recommending a smaller rung that fails its own conditions. The purpose of
this task is to find the smallest variant that *genuinely* earns the gap, and
"nothing smaller does" is a legitimate answer to that question.

---

## 12. FIRE the 2023 test only if ALL of

Measured on the **recommended candidate versus `packages/bpr/frozen-params.json`**
— the incumbent-versus-candidate pairing, which is the one a 2023 run would compute:

1. **Rule A** on the **AS-SCORED** combined pairing — accuracy delta above zero AND
   Brier delta below zero.
2. **Signal** on the **AS-SCORED** combined pairing — the accuracy delta's 95%
   interval excludes zero.
3. **Persistence** — on the **EX-NO-CALL** combined pairing, the accuracy delta is
   **above zero** AND its **95% interval excludes zero**.

Condition (iii) is the one that separates predictive skill from the 2016 scoring
artifact, and per item 6 it is the condition that predicts a 2023 result. A candidate
whose entire margin lives in cold-start no-calls will pass (i) and (ii) and fail
(iii), and it should — 2023 will not reproduce that margin.

**Otherwise: DO NOT FIRE.** Record the ladder, name the best candidate, and state
plainly that the shot is saved. Saving the shot is a good outcome, not a failure to
produce one.

### Promotion and firing are deliberately different rules

Promotion is design-era adoption. Firing spends a scarce single-shot holdout. A
component can legitimately earn its place on design data while still failing to
justify spending the shot, and this document keeps the two separable on purpose.

---

## 13. Standing priors, recorded so they cannot be quietly invented later

- **`elimWeight` has an independent negative result in this repo** (2026-09-05, 6/6
  keep-incumbent, multiplier scattering around 1). That result is on **VPR**, not
  BPR. It is therefore **suggestive and does NOT change the promotion rule** — L2b
  is scored by item 9 like every other rung. If L2b passes despite it, that is a
  genuine cross-algorithm disagreement worth **one line** in `LADDER.md`, not a
  reason to discount the measurement after the fact.

- **The side-bias gain is legitimate under the shared convention.** Every algorithm
  pays the D-Q3 abstention penalty, so BPR avoiding it is not cheating, and a model
  that cannot call a decided match has genuinely failed to predict it. The
  **promotion rule therefore does not penalise it at all**. Only the **FIRE** rule
  does, through condition (iii), and only because 2023 will not reproduce the
  cold-start conditions that generate it — not because the gain is illegitimate.

---

## 14. What this task will not do, whatever the numbers say

- It does **not** run the 2023 test.
- It does **not** write `packages/bpr/frozen-params.json`.
- It does **not** edit any file in `SEALED_CODE_PATHS`. If a measurement appears to
  require one, the task **HALTS and flags it loudly** rather than making the edit.
- It does **not** re-seal.

**Re-seal ONCE, later, on the winner.** The predecessor's note (d) is binding: each
re-seal spends credibility, and re-sealing twice — once now, once again next week —
would look like shopping regardless of how principled each step was.
