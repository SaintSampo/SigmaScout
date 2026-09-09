---
task: 260909-3oe-build-a-lean-bpr-variant-and-measure-whi
document: ladder + verdict
date: 2026-09-09
rule: LADDER-RULE.md, committed 815faf23, before any number existed
measured_on: 2016-2022 design era only, post-P3 unified path
holdout_read: none
frozen_params_written: no
---

# The lean-BPR ladder

## 1. The decision

# DO NOT FIRE THE 2023 TEST.

**Recommended candidate: L1** — the frozen parsimonious model plus the learned
side bias, re-tuned (`candidates/L1-bias.json`). It **earns its place on design
data** (+0.215pp, 95% [0.091, 0.340]) and then **fails the fire rule**, because
once you remove the cold-start no-calls its margin is **+0.063pp with a 95%
interval of [-0.049, 0.177] that includes zero**.

**The one sentence:** the smallest variant that clears the design-era bar clears
it almost entirely by breaking 2016 cold-start ties that a warm-started 2023
cannot present, and no larger-but-still-lean rung earns its place at all — so
there is no lean candidate worth the shot, and the shot is saved.

---

## 2. The ranked ladder

Every delta is **paired, event-clustered, 2000 resamples, seed 42**, against the
**rung below**, on 82,735 units over 911 event blocks. PASS/FAIL is
`LADDER-RULE.md` item 9, applied verbatim: Rule A **and** interval-excludes-zero
**and** >= 0.169pp.

| rung | components | live keys | design acc | vs rung below | as-scored dAcc | 95% interval | excl 0 | dBrier | excl 0 | ex-no-call dAcc | 95% interval | PROMOTION |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **L0** frozen incumbent | 0 | 14 | 72.871% | — | — | — | — | — | — | — | — | (baseline) |
| **L1** + side bias | 1 | 15 | 73.086% | L0 | **+0.215** | [0.091, 0.340] | YES | −0.00022 | YES | **+0.063** | [−0.049, 0.177] | **PASS** |
| **L2a** + foul | 2 | 19 | 73.159% | L1 | +0.073 | [−0.032, 0.174] | no | **+0.00013** | YES (wrong way) | +0.073 | [−0.032, 0.174] | **FAIL** |
| **L2b** + elim weight | 2 | 16 | 73.170% | L1 | +0.084 | [−0.011, 0.177] | no | −0.00045 | YES | +0.084 | [−0.011, 0.177] | **FAIL** |
| **L2c** + defensive | 2 | 17 | 73.241% | L1 | +0.155 | [0.033, 0.278] | YES | −0.00046 | YES | +0.155 | [0.033, 0.278] | **FAIL** (bar) |
| **L2d** + Huber | 2 | 16 | 73.123% | L1 | +0.037 | [−0.026, 0.100] | no | −0.00007 | YES | +0.037 | [−0.026, 0.100] | **FAIL** |
| **L3** full variant | 5 | 23 | 73.291% | L1 | **+0.205** | [0.059, 0.353] | YES | −0.00067 | YES | **+0.205** | [0.059, 0.353] | **PASS** |

**Combined rung: NOT BUILT.** Item 10 requires two or more components to pass.
Zero passed.

Reading the table honestly, three things at once:

- **Only two rungs pass promotion: L1 and L3.** Nothing in between does.
- **L2c (defensive suppression) misses by 0.014pp** — +0.155pp against the
  0.169pp bar, about one part in twelve. It clears Rule A and Signal cleanly.
  **The bar was not moved to admit it**, and it should not be: `BAR.md`'s 0.169pp
  is a standing pre-existing constant, and shaving a threshold by 0.014pp to
  promote the component being measured against it is the forking-paths move the
  predecessor named and refused. If the bar is ever re-derived honestly on a
  larger population, L2c is the first thing to re-examine.
- **L2a (foul) is the only rung that fails Rule A outright.** Its Brier gets
  *worse* (+0.00013) and that interval excludes zero, so the degradation is real.
  It buys a sliver of accuracy by making its probabilities worse — exactly the
  trade Rule A exists to catch.

**Neither pre-registered hazard fired.** Item 7's `foulOn` handicap does not
apply: L2a *started* at 73.164, **above** L1's 73.086, so its failure is on its
own merits with no structural excuse. Item 8's INERT-AT-OPTIMUM case does not
apply either: every rung differs from its seed, and `elimWeight` did move off 1.0
to 0.5 despite the grid lacking a 1.0 to return to. Both were worth pre-registering
and neither was needed.

---

## 3. The two numbers, and which one predicts 2023

For the recommended candidate **L1 versus the frozen incumbent**:

|  | accuracy delta | 95% interval | excludes zero? |
|---|---|---|---|
| **as-scored** | **+0.215pp** | [0.091, 0.340] | **YES** |
| **ex-no-call** | **+0.063pp** | [−0.049, 0.177] | **NO** |

> ### The ex-no-call number, +0.063pp with an interval spanning zero, is the estimate of what a 2023 test would show.
>
> That claim was **committed in `LADDER-RULE.md` item 6 before any of these
> numbers existed**, not selected afterwards because it produced a tidy answer.

**Two thirds of L1's headline margin is a scoring artifact.** Of the 175.8 net
matches L1 gains, **125 are the incumbent's 2016 cold-start no-calls**, which
D-Q3 scores as guaranteed misses. Remove them and 50.8 matches remain across
81,522 units, and the interval opens across zero.

**Why 2023 cannot reproduce it — the structural warrant, restated.** A 2023
replay is **warm-started** on state carried through 2016-2022. The mechanism that
produces an exact-0.5 prediction is the identical-prior cold start of the first
modelled season, where every team sits at the same prior and the alliances are
numerically tied. That cold start **cannot recur** in a warm season. The design
era says so unambiguously: **2016 carries 269 no-calls, 2017 carries 1, and 2018,
2019, 2020 and 2022 carry zero.** One season of warm-up removed the phenomenon
entirely; 2023 arrives with seven.

**This is an ARGUMENT, not a measurement, and it is labelled as one.** Measuring
it directly would require stepping 2023, which is exactly the shot under
discussion. It cannot be checked without spending the thing it is advising about.

**But this task produced new evidence for it that the predecessor did not have,
and it is a measurement.** In all four C2 contrasts — where *both* sides are
built on L1 and can therefore break ties — the as-scored and ex-no-call rows are
**identical**, with exactly **one** unit separating them (82,735 → 82,734). The
divergence between the two numbers is a property of the **L0 baseline
specifically**, not of the pairing in general. It appears only where the incumbent
has `biasLr = 0`, and it vanishes the instant the incumbent can break a tie. A
warm 2023 is in the regime where the two numbers coincide — and in that regime
L1's number is **+0.063pp, not +0.215pp**.

---

## 4. Residual accounting

### The ladder closes at the L1 hinge

| step | delta |
|---|---|
| L0 → L1 | +0.215pp |
| L1 → L3 | +0.205pp |
| **sum** | **+0.420pp** |
| L0 → L3 measured directly | **+0.421pp** |

Discrepancy 0.001pp — rounding at the printed precision.

### The four components do NOT sum to their own bundle

| component | re-tuned credit vs L1 |
|---|---|
| foul submodel | +0.073pp |
| elim down-weighting | +0.084pp |
| defensive suppression | +0.155pp |
| Huber clip | +0.037pp |
| **sum of individual credits** | **+0.349pp** |
| **bundle, measured as L1 → L3** | **+0.205pp** |
| **INTERACTION** | **−0.144pp** |

**The interaction is negative and large — 41% of the summed credits disappear on
combination.** Said plainly: **these four components are partial SUBSTITUTES for
one another, not complements.** Each, given the 13 shared knobs free to re-fit
around it, absorbs some of the same residual structure the others absorb.

This is the *inconvenient* arithmetic, and it is reported as it fell. A tidy
result would have had four credits summing to the bundle with each component
owning a clean slice. **They do not sum, and naming the interaction is worth more
than smoothing the table.**

### Re-tuned credits against `DECISION.md`'s original ablation — the direction of the bias inverts

`DECISION.md`'s table reports the accuracy change when a component is **removed**,
so a negative entry means the component was valuable.

| component | DECISION.md ablation (removal Δ) | implied original credit | re-tuned credit here | verdict on the old number |
|---|---|---|---|---|
| learned side bias | ~+0.03 | **−0.03** (believed mildly harmful) | **+0.215** as-scored / +0.063 ex-no-call | **OVERTURNED**, sign and all |
| foul submodel | −0.03 | +0.03 | **+0.073** | **exceeded** (2.4×) |
| elim down-weighting | −0.03 | +0.03 | **+0.084** | **exceeded** (2.8×) |
| defensive suppression | ~+0.09 | **−0.09** (believed harmful) | **+0.155** | **OVERTURNED**, sign and all |
| Huber clip | ~0.00 | 0.00 | **+0.037** | **exceeded** |

**F-23's "upper bound" framing is wrong in DIRECTION for these four components,
and this task can now say why.** F-23 held that one-at-a-time ablation deltas
computed at the full model's optimum are *upper bounds* on credit. **Every one of
the four came in ABOVE its ablation value** — the ablations were **lower** bounds,
not upper ones.

The mechanism is the −0.144pp substitution measured directly above. Removing one
component *from the full model* costs little precisely because the other three
cover for it. Adding that same component *to L1*, where it has no substitutes
present, buys more. Substitutability makes ablation-at-the-optimum systematically
**understate** standalone credit, and these components are substitutes.

**One caveat, stated rather than buried:** `DECISION.md`'s table is **pre-P3** and
these credits are **post-P3**, so the two are separated by a scoring-convention
change as well as by the re-tuning. This is a *consistent story*, not a clean
controlled comparison. The side-bias overturn in particular is known to be mostly
the convention change (P3's D-Q3 charges for the abstentions the old convention
silently forgave). The four non-bias components move in a uniform direction that
the measured substitution independently predicts, which is why the reading is
offered at all — but it is one inference, not four independent confirmations.

### What remains unattributed

**+0.205pp of the +0.421pp gap is held jointly by four components and owned by
none of them.** Each fails promotion alone; the bundle passes. A ladder built one
component at a time structurally cannot recover it, because the effect exists
only in combination. That is the "unidentifiable model" shape this project's
failure log already records once, and it is the strongest argument in this
document *against* adopting the full variant on the strength of its aggregate.

---

## 5. The deterministic tie-break

On the **268 decided matches where the frozen incumbent predicts exactly 0.5**:

| rule | correct | rate | worth |
|---|---|---|---|
| incumbent (no-call = miss under D-Q3) | 0 | 0.00% | — |
| **learned side bias (L1)** | **125** | **46.64%** | +0.1528pp |
| deterministic always-RED | 132 | 49.25% | +0.1614pp |
| **deterministic always-BLUE** | **136** | **50.75%** | **+0.1663pp** |

**The one line: a zero-parameter deterministic tie-break BEATS the learned side
bias on exactly the units where the side bias earns its margin — 50.75% versus
46.64%, 136 matches versus 125.**

The learned side bias is **worse than a coin flip** on these matches. It is not
extracting signal from them; it converts a guaranteed miss into a
slightly-worse-than-even guess and is credited for the conversion.

### The two effects, kept apart — and the data separates them for us

`model.ts:88-100` documents `biasLr` as carrying two distinct things: cold-start
tie-breaking, and a genuine elimination seeding signal (quals run 49.2-50.3% red,
but **elims run 63-78% red** because the higher seed is conventionally placed on
red). Those must not be collapsed. They do not need to be separated by argument:

- **quals: n = 268 — all of them.**
- **elims: n = 0 — none.**

**Every no-call unit in the design era is a qualification match.** So:

- **The cold-start effect is 100% of the no-call block**, and a zero-parameter
  rule beats the knob at it. **The cold-start credit alone does not justify the
  parameter.**
- **The elimination seeding effect lives entirely outside the no-call block**, in
  the ex-no-call rows — which is where it would have to show up if it were paying
  for itself. That row is **+0.063pp, 95% [−0.049, 0.177]**. On design-era
  evidence **the seeding signal does not separately justify the knob either**,
  though note this is the weaker of the two conclusions: +0.063pp is positive, and
  the interval's failure to exclude zero is not evidence that the effect is absent.

### The tie-break is not a free swap, even where it looks equivalent

Implementing "always call blue on an exact tie" would mean changing `accuracyCall`
in `packages/core/scoring/brier.ts` — a **shared scoring convention used by all
four algorithms**, and a `SEALED_CODE_PATHS` edit. It would re-score EPA, VPR and
Sigma1 as a side effect of a BPR decision. **It was not built and should not be**;
the arithmetic above is computed from the emitted paired jsonl, which is why the
question could be answered for free. The finding is that a cheap alternative
*would* outperform the knob, not a recommendation to go implement it.

---

## 6. The `elimWeight` cross-algorithm note

`elimWeight` **fails promotion on BPR** (+0.084pp, 95% [−0.011, 0.177], interval
includes zero, less than half the 0.169pp bar) — the **same direction** as the
standing 2026-09-05 VPR negative result (6/6 keep-incumbent, multiplier scattering
around 1), reached independently on a different algorithm with a different
instrument. Per `LADDER-RULE.md` item 13 the VPR prior was *not* allowed to change
the promotion rule, and it did not need to: BPR rejected the knob on its own
evidence. There is **no cross-algorithm disagreement** to report.

---

## 7. Recommendation

### DO NOT FIRE. The shot is saved.

`LADDER-RULE.md` item 12, applied to **L1 vs `packages/bpr/frozen-params.json`**:

| condition | measured | verdict |
|---|---|---|
| (i) Rule A on as-scored | +0.215pp, −0.00022 | **PASS** |
| (ii) Signal on as-scored | [0.091, 0.340] excludes zero | **PASS** |
| (iii) **Persistence on ex-no-call** | +0.063pp, **[−0.049, 0.177] includes zero** | **FAIL** |

**No `TEST-2023.md` is written in this directory, and `260909-25z/TEST-2023.md`
is left untouched** — no `superseded_by:` line was added, because nothing
supersedes it. Both are the pre-registered consequences of not firing.

### The disclosed tension, which is the most important thing in this section

**L3 — the full 23-knob variant — WOULD pass the fire rule.** Against L0:
as-scored +0.421pp [0.270, 0.569]; **ex-no-call +0.277pp [0.139, 0.419], which
excludes zero**. All three conditions pass.

The pre-registered parsimony rule (item 11) selects the **fewest-component** rung
among promotion-passers, which is **L1**, and item 12 then evaluates the fire rule
on **L1**, which fails. **A differently-written rule — "fire on the best rung that
passes the fire rule" — would fire on L3.** The rule as committed is honoured; the
alternative is disclosed rather than quietly taken.

**This is a genuine wobble in the pre-registration and it is recorded as one**, in
the same spirit as the predecessor recording its unnamed-slice ambiguity. Item 11
and item 12 were written as a pipeline (select, then test) without anticipating
that the parsimony-selected rung and the fire-passing rung could differ. They do.

**I still recommend not firing, and the reason is independent of which rule you
prefer:**

1. **The task's own question came back negative.** It asked for the *smallest*
   variant that genuinely earns the gap. The answer is that **no lean variant
   does** — L1's margin is a warm-start artifact, and all four remaining
   components fail individually. Firing on L3 would not answer the question this
   task was commissioned to answer; it would abandon it.
2. **L3 is exactly the candidate the predecessor declined to fire on**, for
   reasons this task has now *strengthened* rather than weakened. Its 0.257pp
   residual is still unattributed — and is now known to be **unattributable in
   principle** to any single component, because the four are substitutes holding
   +0.205pp jointly that none owns.
3. **Parameter bloat is a standing rule** and L3 is 5 components / 23 live keys
   against L0's 0 / 14, with **not one of the four added components able to earn
   its own place**.
4. **The scarce shot has not been made more valuable by anything measured today.**

### What would have to be true for the shot to be worth spending

- **A rung that passes the fire rule on its own ex-no-call margin AND is lean.**
  L2c is the only near miss: +0.155pp against the 0.169pp bar, Rule A and Signal
  both clean, two components. If the paired bar is ever re-derived honestly on a
  larger design population — **before** a candidate is measured against it, never
  after — L2c becomes the candidate to look at.
- **Or an honest decision to spend the shot on L3 as a bundle**, accepting that a
  pass would establish "23 beats 14 out-of-sample" while leaving the residual
  permanently unattributed. That is a legitimate choice; it is Jacob's to make,
  and it is not what the pre-registered rule selects.

---

## 8. What was and was not touched

**No model code changed.** The plan expected this and the expectation held: not
one file under `packages/` was edited. `260909-25z` had already exported
everything this task consumed. The only new code is
`scripts/ladder-contrast.ts`, inside this quick directory.

| assertion | command | output |
|---|---|---|
| no 2023+ figure read or produced | every number in this task comes from `evalDesign`, which cannot reach a holdout season | design era 2016-2022 only |
| all five guards armed | see `GUARDS-PROOF.txt` (guards 1-4 run, guard 5 grepped) | ALL FIVE ARMED |
| frozen params still sealed | `git log --oneline -- packages/bpr/frozen-params.json \| wc -l` | `1` |
| 2023 test never run | `test -f reports/bpr-2023-test.jsonl` | absent |
| model + shipped port undiverged | `git status --porcelain -- packages/bpr/model.ts packages/core/algorithms/bpr.ts` | empty |
| `obsSdSlope` zero everywhere | node scan over `candidates/*.json` | zero in every candidate |
| test suite green | `npx vitest run packages/bpr packages/harness` | 47 files, 1122 tests passed |

- `packages/bpr/frozen-params.json` was **read as a tuning seed and never
  written**. No re-seal.
- `obsSdSlope` appears in the skip list of **every** tune and is zero in every
  candidate file, so no holdout-motivated knob (F-16) entered a design-era
  decision.

### Footnote: the inherited knob names versus the derived counts

"13-knob", "14-knob" and "23-knob" are inherited **proper names** and they mix two
counting conventions. Counting **live params keys** — the 14 always-live shared
keys plus the keys owned by each non-inert component:

| rung | components | live params keys |
|---|---|---|
| L0 frozen ("13-knob") | 0 | **14** |
| L1 ("14-knob") | 1 | **15** |
| L2a | 2 | 19 |
| L2b | 2 | 16 |
| L2c | 2 | 17 |
| L2d | 2 | 16 |
| L3 ("23-knob") | 5 | **23** |

The inherited "23" reproduces exactly; "13" and "14" are each one lower than the
live-key count, because they count searchable shared knobs and exclude `tau0`,
which sits in every params file and appears in no `GRID` row. **The names were not
renumbered**, and every ranking argument in this document is made on **component
count**, which is unambiguous.
