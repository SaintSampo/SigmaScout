---
task: 260909-25z-re-bootstrap-the-full-23-knob-vs-parsimo
document: verdict
date: 2026-09-09
rule: RULE.md, committed ea32f9c2 at 01:54:17, before any number existed
measured_on: 2016-2022 design era only, post-P3 unified path
holdout_read: none
---

# Verdict

**F-20 INVERTS.** The parsimonious freeze is not comfortably inside the bar; it is
**0.421pp** outside it, with a 95% interval of **[0.270, 0.569]** that excludes
zero at 5.5 sigma. **RULE.md's three conditions all PASS — the rule FIRES.**

**My recommendation is nonetheless: DO NOT FIRE THE 2023 TEST YET.** Not because
the gap is unreal — it is real and clears every bar in sight, including
DECISION.md rule 5's original literal 0.31pp constant with no threshold
correction required. Because the **candidate is wrong**: a decomposition done
after the rule fired shows **39% of the entire gap is one knob**, and spending a
single-shot holdout on a 23-knob variant would answer a question that a day of
free design-era work is about to supersede. Section 5 argues this.

RULE.md reserved exactly this separation in advance: *"A rule that fires is a
licence to consider spending holdout, not an instruction to spend it."*

---

## 1. The measurement table

All figures **post-P3, design era 2016-2022 only**, paired event-clustered
bootstrap, 2000 resamples, seed 42, orientation **FULL minus PARSIMONIOUS**
(positive accuracy = full better; negative Brier = full better).

### Combined (the primary contrast)

| arm | n | events | dAcc (pp) | 95% interval | excl 0 | dBrier | 95% interval | excl 0 |
|---|---|---|---|---|---|---|---|---|
| **A** as-recorded | 82,735 | 911 | **+0.379** | [0.221, 0.538] | **YES** | **-0.00081** | [-0.00110, -0.00052] | **YES** |
| **B** re-tuned *(governing)* | 82,735 | 911 | **+0.421** | [0.270, 0.569] | **YES** | **-0.00089** | [-0.00114, -0.00063] | **YES** |
| C mixed *(diagnostic only)* | 82,735 | 911 | +0.421 | [0.270, 0.569] | YES | -0.00089 | [-0.00114, -0.00063] | YES |

### Slices

| arm | slice | n | dAcc (pp) | 95% interval | excl 0 | dBrier | excl 0 |
|---|---|---|---|---|---|---|---|
| A | champs {2,3,4} | 11,728 | +0.311 | [-0.138, 0.756] | **no** | -0.00150 | YES |
| A | non-champs | 71,007 | +0.390 | [0.231, 0.546] | YES | -0.00070 | YES |
| B | champs {2,3,4} | 11,728 | +0.587 | [0.132, 1.061] | YES | -0.00187 | YES |
| B | non-champs | 71,007 | +0.393 | [0.243, 0.545] | YES | -0.00073 | YES |

### Levels

| variant | design accuracy | Brier | log loss |
|---|---|---|---|
| parsimonious (`frozen-params.json`, = Arm B's re-tune) | 72.871% | 0.17559 | 0.52954 |
| full, as recorded (`round5-full.json`) | 73.250% | 0.17477 | 0.52764 |
| full, post-P3 re-tuned (`retune-full.json`) | 73.291% | 0.17470 | 0.52745 |

### The pre-P3 history, recorded but NOT mixed in

`frozen-params.json` records parsimonious **73.081**, full **73.319**, gap
**0.238pp**. These are **pre-P3** and are **not comparable** to anything above.
They are kept here so they do not vanish, never to be differenced against a
post-P3 number. Note what P3 did to each side: the parsimonious level fell
73.081 to 72.871 (-0.21pp) while the full level fell 73.319 to 73.250 (-0.07pp).
The convention change cost the parsimonious model **three times as much**, and
section 3 explains why.

### Arm C collapsed into Arm B, and that is the useful part

The post-P3 re-tune of the parsimonious side **returned its seed unchanged** —
zero differing keys against `frozen-params.json`, converged after sweep 1 with no
accepted move (`RETUNE.txt`). `frozen-params.json` was *already* at a
coordinate-descent optimum under the post-P3 objective. So Arm C's incumbent and
Arm B's incumbent are the same vector, and Arm C is bit-identical to Arm B.

**The F-23 asymmetry this plan was built to avoid does not arise at all.** There
is no un-re-tuned side to inflate against; the parsimonious optimum simply did
not move. Arm B's number therefore carries **no F-23 discount**, and the widening
from Arm A (+0.379) to Arm B (+0.421) is *entirely* the full side improving under
its own re-tune, not the parsimonious side being held back.

---

## 2. Rule application, condition by condition

RULE.md applied verbatim as committed. The contrast is the **combined** pairing
(the arms are defined by parameter pairs, not by slices); the champs/non-champs
rows are supplementary and are treated as such below.

| condition | Arm A | Arm B | verdict |
|---|---|---|---|
| **1. Rule A** — dAcc > 0 **AND** dBrier < 0 | +0.379pp, -0.00081 | +0.421pp, -0.00089 | **PASS** on both |
| **2. Signal** — dAcc 95% interval excludes zero | [0.221, 0.538] | [0.270, 0.569] | **PASS** on both |
| **3. Consistency** — 1 and 2 hold on both arms, same sign | same sign, both exclude | same sign, both exclude | **PASS** |

### The rule's own verdict: FIRE.

The full variant does **not** win accuracy while losing Brier — the decisive
negative Rule A was written to catch. It wins **both**, on **both** arms, at
4.8 sigma (Arm A: 0.379 / 0.0794) and 5.5 sigma (Arm B: 0.421 / 0.0760).

**One honest wobble, recorded rather than smoothed over.** RULE.md did not name
a slice for the Signal condition. On the **champs** slice the arms disagree:
Arm A's champs accuracy interval **includes** zero ([-0.138, 0.756]) while
Arm B's **excludes** it ([0.132, 1.061]). Had the Consistency condition been
written against the champs slice, it would have **failed**. It was not — the
contrast is the combined pairing, where both arms agree cleanly, and both arms'
champs *Brier* intervals exclude zero in the full variant's favour. But the
ambiguity is real, it favoured the outcome, and a future rule of this shape
should name its slice.

---

## 3. Corrected verdict on F-20

> **F-20 (as written): KILLED.** *"The parsimonious was 0.238pp below the full
> model against a 0.31pp bar; under 0.45pp it is further inside; decision stands,
> more comfortably."*

### F-20 INVERTS.

It now rests on **+0.421pp, 95% [0.270, 0.569], paired clustered SE 0.0760pp**
(Arm B, governing) — corroborated by Arm A at **+0.379pp, 95% [0.221, 0.538]**.
The gap is outside the 0.31pp threshold, outside BAR.md's 0.169pp paired bar
(4.98 sigma against it), and outside its own two-sigma interval. Nothing about
"more comfortably" survives.

**F-20's reasoning was structurally sound; it ran on the wrong quantity.**
BAR.md measured the LEVEL two-sigma bar at **0.445pp**, reproducing the
review's "really ~0.45pp" estimate almost exactly. The review's arithmetic was
right. What was wrong was *which quantity was being bounded*: an ablation delta
is a **paired** difference, both variants scored on the same matches, so the
shared match-difficulty variance cancels before any resampling. The paired bar is
**0.169pp**, 2.6x tighter, and the review's own instinct — that its bar might be
too high — was correct.

**But this task does not rest on that correction at all**, and that matters more
than the correction does. **Both** of F-20's numbers moved in the same direction:

| | F-20's figure | measured here |
|---|---|---|
| the gap | 0.238pp | **0.421pp** (Arm B) / 0.379pp (Arm A) |
| the bar | 0.31pp, "really ~0.45pp" | 0.169pp paired (or 0.152pp = 2x this contrast's own SE) |

The inversion is **doubly determined**. The gap alone exceeds F-20's *original,
uncorrected* 0.31pp constant. **F-20 would invert even if the bar correction had
never been discovered.** Section 4 leans on this.

**On instruments.** This task did not compare a point estimate to a borrowed bar
at all — the contrast carries **its own** interval, which is the stronger
instrument and immune to the category error F-20 made. The two approaches agree:
point-vs-bar gives 0.421 / 0.0845 = 4.98 sigma; the contrast's own interval gives
[0.270, 0.569], 5.5 sigma. Agreement is reassuring, but the interval is the
number of record.

### Why the gap grew from 0.238pp to 0.421pp — the mechanism

This is the most useful thing the task found, and it is not "the extra components
turned out to be good".

**The parsimonious model emits 268 exactly-0.5 predictions across the design era.
Every one of them is in 2016. The full model emits one.** Under **D-Q3** — P3's
accuracy convention — an abstention on a decided match is scored a **miss**,
never silently credited to whichever side an operator rounds toward. Per-season
paired deltas (Arm B):

| season | n | dAcc (pp) | parsimonious no-calls |
|---|---|---|---|
| 2016 | 13,117 | **+1.098** | **267** |
| 2017 | 15,103 | +0.033 | 1 |
| 2018 | 16,861 | +0.451 | 0 |
| 2019 | 17,664 | +0.226 | 0 |
| 2020 | 4,618 | +0.303 | 0 |
| 2022 | 14,427 | +0.451 | 0 |

Drop every no-call unit and the gap falls **0.421pp to 0.277pp**. Drop 2016
entirely and it falls to **0.291pp**.

**One knob accounts for it.** Taking `frozen-params.json` and turning on
**`biasLr = 0.001`** — the learned side bias, one parameter, at its pre-P3 value,
with **no re-tune** — removes **269 of the 270** no-calls and lifts design
accuracy **72.871% to 73.035%**, a gain of **0.164pp**, or **39% of the entire
0.421pp gap**. Brier improves too (0.17559 to 0.17547).

At cold start in the first season every team sits at an identical prior, so the
two alliances are numerically tied and the model returns exactly 0.5. The side
bias breaks that tie. That is **tie-breaking, not predictive skill** — but D-Q3 is
right to charge for it, because a model that cannot call a decided match has
genuinely failed to predict it.

This also explains a contradiction in DECISION.md's own ablation table, which
valued the side bias at **+0.03pp** — i.e. it believed removing the term was
*mildly helpful*. That was measured pre-P3, under a convention that did not
penalise an exact-0.5 abstention. **The old convention hid the defect that D-Q3
charges for.** Summed, that table said dropping all five components should have
*gained* 0.06pp; the measured cost is 0.421pp — a **sign disagreement**, mostly
explained by this one convention change, with one-at-a-time ablations missing
interactions accounting for the rest.

---

## 4. DECISION.md rule 5, checked against its own stated quantity

> **Rule 5.** *"If the parsimonious variant's design accuracy is more than 0.31pp
> below the full model's, rule 3 is overridden and the full model is frozen
> instead. Recorded here so that override is a rule and not a rationalization."*

### Reading 1 — rule 5 as a literal CONSTANT (0.31pp)

Measured gap: **0.421pp** (Arm B), **0.379pp** (Arm A). Both exceed 0.31pp.

**Rule 5 fires on its literal text, with no re-derivation and no threshold
touched.**

### Reading 2 — rule 5 as its own DEFINITION ("two standard errors")

Rule 1 derives 0.31pp as *two standard errors*, from
`sqrt(0.73 * 0.27 / 82946)` which is about 0.154pp — a **naive binomial,
marginal** standard error on a **level**. Rule 5 inherits that quantity by
reference. Under the correct instrument the same definition yields a different
number: this contrast's own paired clustered SE is **0.0760pp**, so two standard
errors is **0.152pp** (BAR.md's generic paired bar is 0.169pp). The gap clears
it by **2.8x**.

Correcting a mis-derived constant to the quantity its own text names is a
correction, not a rule change — and note that the naive SE was wrong twice over,
understating clustering (design effect 1.43x) while overstating the paired
quantity (the pairing cancellation is the larger effect, and it dominates).

### The forking-paths objection, stated rather than side-stepped

The objection is correct as a general matter and I will not soften it: **the SE
correction was discovered after the fact, and moving a threshold in the direction
that changes the outcome is the textbook forking-paths move, however principled
the derivation.** A re-derivation that happens to license the answer you were
already leaning toward deserves suspicion by default, and "but my derivation is
right" is exactly what a forking path sounds like from the inside.

**Here, uniquely, the objection does not bite — and the reason is checkable
rather than rhetorical.** The measured gap of **0.421pp exceeds the original,
uncorrected 0.31pp constant on its own**. Rule 5 fires under **both** readings.
The corrected bar changes *how comfortably* it fires (2.8x rather than 1.4x); it
does not change **whether** it fires. **No threshold had to move for this verdict
to hold**, so there is no fork to have taken.

**Which reading I recommend:** use **reading 1**, the literal constant, as the
operative one — precisely *because* it requires nothing to be re-derived and is
therefore unarguable. Cite reading 2 only as corroboration, and adopt the paired
SE for **future** rules written *before* their measurements, where it is a
genuine methodological improvement rather than a retrospective adjustment.

---

## 5. Recommendation

### DO NOT FIRE THE 2023 TEST YET.

The rule fired. I am not disputing the measurement, and I am not asking for the
threshold back. The gap is real, it is 5.5 sigma, it clears the original constant
without any correction, and F-20 inverts. What I am disputing is that
**`retune-full.json` is the right thing to spend a single-shot holdout on.**

Weighed honestly, and not treated as settled by "it clears the bar":

**(a) 39% of the gap is one parameter, and that changes what the interesting
question is.** `biasLr` alone buys 0.164pp of the 0.421pp by removing 269
cold-start no-calls. A **14-knob** "parsimonious + side bias" variant is an
obvious candidate that has never been measured, and it sits between the two
things this task compared. Firing 2023 on the 23-knob variant would establish
"23 beats 13 out-of-sample" and leave the actually-decisive question — *does 14
capture most of it?* — unanswered, with the holdout one shot poorer. That
question costs **nothing**: it is design-era work, 2016-2022, already reachable
through `score.ts` and `tune.ts`.

**(b) Parameter bloat is a standing rule here, and it bites on adoption, not on
measurement.** Ten extra knobs against a lean set, where five of the extra
components measured under 0.1pp *individually* in DECISION.md's table, and one
of them — `elimWeight` — carries an **independent negative result** in this repo
(2026-09-05, 6/6 keep-incumbent, multiplier scattering around 1). That result is
on **VPR**, not BPR, so it is suggestive rather than dispositive — but a
component with a measured negative elsewhere should not be adopted as part of an
undifferentiated bundle just because the bundle's aggregate is positive.

**(c) F-23's upper-bound caveat applies to the attribution, not the aggregate,
and that distinction cuts both ways.** The aggregate here is clean: both sides
were re-tuned, and the parsimonious side turned out to already be at its optimum,
so Arm B carries no F-23 discount. But the **per-component** credit is still an
upper bound, because no component was individually re-tuned. Concretely: after
`biasLr`'s 0.164pp, we know **0.257pp remains and we do not know which of the
other four components carries it** — or whether it is an interaction that no
single component owns. Adopting all ten knobs to capture an effect whose source
is unidentified is precisely the "unidentifiable model" failure this project's
own log already records once.

**(d) Firewall erosion — the tension, and why it is milder than it looks.**
Adopting the full variant means acting on a pre-registered decision being
re-evaluated on a *different measurement path* than the one it was written
against, which is a real move and should be named as one. Against that: **rule 5
is itself pre-registered**, its antecedent is now met on its own literal terms,
and executing a pre-registered override is not inventing a rule — it is the
override doing the job it was written to do. DECISION.md says so in its own
text: *"recorded here so that override is a rule and not a rationalization."*
The erosion risk is not in *honouring* rule 5; it is in **re-freezing twice** —
once now on the 23-knob variant, then again in a week on a 14-knob one — because
each re-seal spends credibility and the second one would look like shopping.
**Re-seal once, on the best candidate.** That is an argument for waiting, not for
ignoring rule 5.

**(e) 2023 is not virgin data, and the recommendation must not imply it is.**
2023 was already read once, inside `260908-b4t`'s single sealed run covering
2023-2026. A candidate-versus-incumbent comparison is a legitimate *new* test of
a *new* candidate, and the paired statistics make it a sharper one than the
original level read. But a clean out-of-sample season is **not** on offer. The
shot is genuinely scarce, which is the whole reason (a) matters: scarce shots
should be spent on the best available candidate, not the first one to clear a bar.

### What to do instead — all of it free, none of it touching the holdout

1. **Measure the 14-knob variant.** `frozen-params.json` + `biasLr`, re-tuned
   post-P3 with the same skip list minus `biasLr`. Contrast it against both
   endpoints using `scripts/paired-contrast.ts`, unchanged.
2. **Decompose the residual 0.257pp** by adding the remaining four components
   one at a time, each **re-tuned**, so the credit is not an F-23 upper bound.
   Expect several to be worth nothing.
3. **Then pre-register once and fire once**, on whichever variant wins the
   design-era decomposition, replacing `TEST-2023.md` before it runs.
4. **Re-seal `frozen-params.json` once**, after that, not before.

Rule 5's antecedent **is** met, so the freeze decision is genuinely due for
re-examination — the current frozen model is measurably 0.42pp worse on design
data than a variant that existed at freeze time, and that should not be left
standing indefinitely on the strength of a superseded number. But re-examining it
properly takes a day of free compute, and doing that first is the difference
between spending the holdout well and spending it merely legitimately.

### If you disagree and want to fire now

That is a defensible reading — the rule fired, and waiting has its own cost.
`TEST-2023.md` exists for exactly that case: it is the pre-registration
RULE.md promised, written **before** the run, naming the candidate RULE.md
fixed in advance. **This task did not execute it.** If the design-era
decomposition in (1)-(2) produces a better candidate, `TEST-2023.md` must be
**replaced before firing**, never amended afterwards.

---

## 6. What was and was not touched

- **No 2023 or later accuracy, Brier or log loss was read or produced.** Every
  number in this document is 2016-2022.
- All five holdout guards were re-proved **by running them** — `GUARDS-PROOF.txt`.
- `packages/bpr/frozen-params.json`: still exactly **1 commit**, read as a tuning
  seed, never written.
- `packages/bpr/model.ts` and `packages/core/algorithms/bpr.ts`: **untouched**.
  The shipped port has not diverged.
- `reports/bpr-2023-test.jsonl` does not exist.
- The only code change is three `export` keywords in `packages/bpr/holdout.ts`,
  plus tests pinning what they compute. `holdout.ts` is not in
  `SEALED_CODE_PATHS`, so the seal is undisturbed.
