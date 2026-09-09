---
phase: quick-260909-3oe
plan: "01"
subsystem: bpr
tags: [bpr, model-selection, pre-registration, holdout-discipline, parsimony, design-era]
status: complete
requires:
  - 260908-b4t-fresh-2023-blind-model (DECISION.md, frozen-params.json, the ablation table)
  - 260909-03b (BAR.md's 0.169pp paired bar, the P3 unified measurement path)
  - 260909-25z (retune-full.json, Arm B's +0.421pp, the exported paired statistics)
provides:
  - a pre-registered ladder rule committed before any number existed
  - a ranked 7-rung ladder, each rung with its own paired event-clustered 95% interval
  - the re-tuned per-component credits that replace DECISION.md's pinned ablation deltas
  - a DO-NOT-FIRE recommendation on the 2023 single-shot holdout
affects:
  - no source file; measurement only
tech-stack:
  added: []
  patterns:
    - "pre-registration proven by git ordering against artifact mtimes, not asserted"
    - "replicate the predecessor's number with the copied instrument before trusting a new one"
    - "report every contrast twice - as-scored and ex-no-call - with the predictive one named in advance"
key-files:
  created:
    - .planning/quick/260909-3oe-.../LADDER-RULE.md
    - .planning/quick/260909-3oe-.../LADDER.md
    - .planning/quick/260909-3oe-.../scripts/ladder-contrast.ts
    - .planning/quick/260909-3oe-.../candidates/{L1-bias,seed-L2a-foul,L2a-foul,L2b-elim,L2c-def,L2d-huber}.json
    - .planning/quick/260909-3oe-.../{GUARDS-PROOF,REPLICATE,C1,C2,C3,TUNES}.txt
  modified:
    - .planning/STATE.md
decisions:
  - "DO NOT FIRE the 2023 test. The recommended candidate L1 passes design-era promotion and fails the fire rule on persistence."
  - "No component of the residual earns its place individually; the combined rung was therefore not built."
  - "The 0.169pp bar was NOT moved to admit L2c, which missed it by 0.014pp."
  - "L3 would pass the fire rule; the pre-registered parsimony rule does not select it, and that tension is disclosed rather than resolved by rule-switching."
metrics:
  duration: ~65 min
  completed: 2026-09-09
actuals:
  tokens: 27000
  tasks: 4
  commits: 4
---

# Quick Task 260909-3oe: Build a lean BPR variant and measure what it buys

**Built the ladder bottom-up from the frozen incumbent, re-tuning at every rung, and found that no lean variant genuinely earns the 0.421pp gap - so the 2023 shot is saved.**

---

## THE CALL: DO NOT FIRE

**Recommended candidate: L1** - frozen parsimonious + learned side bias, re-tuned
(`candidates/L1-bias.json`). One component, 15 live params keys.

| condition (LADDER-RULE.md item 12) | measured | verdict |
|---|---|---|
| (i) Rule A on as-scored | +0.215pp, Brier -0.00022 | **PASS** |
| (ii) Signal on as-scored | 95% [0.091, 0.340] excludes zero | **PASS** |
| (iii) **Persistence on ex-no-call** | **+0.063pp, 95% [-0.049, 0.177] INCLUDES ZERO** | **FAIL** |

No `TEST-2023.md` was written here, and `260909-25z/TEST-2023.md` was left
untouched. Both are the pre-registered consequences of not firing.

## THE NUMBER THAT MATTERS MOST

> ### As-scored +0.215pp  vs  ex-no-call +0.063pp [-0.049, 0.177]
>
> **The ex-no-call number is the estimate of what a 2023 test would show**, and
> that claim was committed in `LADDER-RULE.md` item 6 **before any of these
> numbers existed** - not chosen afterwards because it gave a tidy answer.

**Two thirds of L1's headline margin is a scoring artifact.** Of its 175.8 net
matches, **125 are the incumbent's 2016 cold-start no-calls** - exact-0.5
predictions that D-Q3 scores as guaranteed misses. A 2023 replay is warm-started
on seven years of state and structurally cannot present them. The design era
agrees emphatically: **2016 carries 269 no-calls, 2017 carries 1, and 2018 / 2019
/ 2020 / 2022 carry zero.**

**New measured support the predecessor did not have.** In all four C2 contrasts -
where *both* sides sit on L1 and can break ties - the as-scored and ex-no-call
rows are **identical**, separated by exactly one unit. The divergence between the
two numbers is a property of **the L0 baseline specifically**, not of the pairing.
It appears only where the incumbent has `biasLr = 0` and vanishes the moment the
incumbent can break a tie. A warm 2023 sits in the regime where the two coincide -
and there, L1 is worth +0.063pp, not +0.215pp.

---

## THE RANKED LADDER

Paired, event-clustered, 2000 resamples, seed 42, 82,735 units / 911 events,
design era 2016-2022 only. PASS/FAIL is the pre-registered promotion rule:
Rule A **and** interval-excludes-zero **and** >= 0.169pp.

| rung | components | live keys | acc | vs | dAcc | 95% interval | dBrier | ex-no-call | PROMOTION |
|---|---|---|---|---|---|---|---|---|---|
| **L0** frozen | 0 | 14 | 72.871% | - | - | - | - | - | baseline |
| **L1** +side bias | 1 | 15 | 73.086% | L0 | **+0.215** | [0.091, 0.340] | -0.00022 | **+0.063** | **PASS** |
| **L2a** +foul | 2 | 19 | 73.159% | L1 | +0.073 | [-0.032, 0.174] | **+0.00013** | +0.073 | **FAIL** |
| **L2b** +elim | 2 | 16 | 73.170% | L1 | +0.084 | [-0.011, 0.177] | -0.00045 | +0.084 | **FAIL** |
| **L2c** +defensive | 2 | 17 | 73.241% | L1 | +0.155 | [0.033, 0.278] | -0.00046 | +0.155 | **FAIL** (bar) |
| **L2d** +Huber | 2 | 16 | 73.123% | L1 | +0.037 | [-0.026, 0.100] | -0.00007 | +0.037 | **FAIL** |
| **L3** full | 5 | 23 | 73.291% | L1 | **+0.205** | [0.059, 0.353] | -0.00067 | **+0.205** | **PASS** |

**Only L1 and L3 pass. Nothing in between does.** Three notes, none smoothed:

- **L2c (defensive) misses by 0.014pp** - +0.155pp against a 0.169pp bar, about
  one part in twelve, having cleared Rule A and Signal cleanly. **The bar was not
  moved.** Shaving a standing threshold by 0.014pp to promote the component being
  measured against it is the forking-paths move the predecessor named and refused.
- **L2a (foul) is the only rung to fail Rule A outright.** Its Brier gets *worse*
  (+0.00013, interval excluding zero), so it buys a sliver of accuracy by making
  its probabilities worse - exactly the trade Rule A exists to catch.
- **Neither pre-registered hazard fired.** L2a *started* at 73.164, **above** L1's
  73.086, so item 7's `foulOn` handicap never applied and the foul failure carries
  no structural excuse. And `elimWeight` moved off 1.0 to 0.5, so item 8's
  INERT-AT-OPTIMUM case never applied either. Both were worth pre-registering; neither was needed.

**Combined rung: NOT BUILT.** Item 10 requires two passers. Zero passed.

---

## THE RESIDUAL DOES NOT SUM - AND THAT IS THE FINDING

| | |
|---|---|
| foul +0.073 / elim +0.084 / defensive +0.155 / Huber +0.037 | **sum +0.349pp** |
| bundle, measured directly as L1 -> L3 | **+0.205pp** |
| **INTERACTION** | **-0.144pp** |

**41% of the summed credits disappear on combination. These four components are
partial SUBSTITUTES for one another, not complements** - each, with the 13 shared
knobs free to re-fit around it, absorbs some of the same residual structure the
others absorb.

So **+0.205pp is held jointly by four components and owned by none of them.**
Each fails promotion alone; the bundle passes. A ladder built one component at a
time structurally cannot recover it. That is the "unidentifiable model" shape this
project's failure log already records once, and it is the strongest argument
*against* adopting L3 on the strength of its aggregate.

The ladder itself closes cleanly: L0->L1 (+0.215) + L1->L3 (+0.205) = +0.420
against +0.421 measured directly. Discrepancy 0.001pp, i.e. rounding.

### F-23's "upper bound" framing inverts

| component | DECISION.md implied credit | re-tuned credit here |
|---|---|---|
| side bias | **-0.03** (believed harmful) | **+0.215** / +0.063 ex-no-call |
| foul | +0.03 | +0.073 |
| elim | +0.03 | +0.084 |
| defensive | **-0.09** (believed harmful) | **+0.155** |
| Huber | 0.00 | +0.037 |

**Every one of the four came in ABOVE its ablation value.** F-23 held that
one-at-a-time ablations at the full optimum are *upper* bounds on credit; for
these components they are **lower** bounds. The mechanism is the -0.144pp
substitution measured directly above - removing a component *from the full model*
costs little because the other three cover for it, while adding it *to L1*, where
it has no substitutes present, buys more.

**Caveat stated rather than buried:** `DECISION.md`'s table is **pre-P3** and
these credits are **post-P3**, so the two are separated by a scoring-convention
change as well as by re-tuning. This is a *consistent story*, not a controlled
comparison, and the side-bias overturn specifically is known to be mostly the
convention change.

---

## THE TIE-BREAK QUESTION, AND ITS ANSWER INVERTS

On the **268 decided matches where the frozen incumbent predicts exactly 0.5**:

| rule | correct | rate | worth |
|---|---|---|---|
| incumbent (no-call = miss) | 0 | 0.00% | - |
| **learned side bias (L1)** | **125** | **46.64%** | +0.1528pp |
| deterministic always-RED | 132 | 49.25% | +0.1614pp |
| **deterministic always-BLUE** | **136** | **50.75%** | **+0.1663pp** |

**A zero-parameter deterministic tie-break BEATS the learned side bias on exactly
the units where the side bias earns its margin.** The knob is **worse than a coin
flip** (46.64%) on these matches. It is not extracting signal from them; it
converts a guaranteed miss into a slightly-worse-than-even guess and is credited
for the conversion.

**The two effects separate by themselves, not by argument.** `model.ts:88-100`
documents `biasLr` as carrying both cold-start tie-breaking and a genuine
elimination seeding signal (elims run 63-78% red). The data splits them for us:
**quals n=268 - all of them; elims n=0 - none.** Every design-era no-call is a
qualification match. So the cold-start effect is 100% of the no-call block and a
free rule beats the knob at it, while the elimination seeding effect lives
entirely in the ex-no-call row - which is +0.063pp, interval spanning zero.

**Not a free swap.** Implementing an always-blue tie-break means editing
`accuracyCall` in `packages/core/scoring/brier.ts` - a shared convention used by
**all four algorithms** and a `SEALED_CODE_PATHS` file. It would re-score EPA, VPR
and Sigma1 as a side effect of a BPR decision. It was **not built and should not
be**; the arithmetic came free from the emitted paired jsonl.

## `elimWeight`, cross-algorithm

Fails on BPR (+0.084pp, [-0.011, 0.177], spans zero, less than half the bar) - the
**same direction** as the standing 2026-09-05 VPR negative result, reached
independently on a different algorithm with a different instrument. The VPR prior
was not allowed to change the promotion rule and did not need to. **No
cross-algorithm disagreement to report.**

---

## THE DISCLOSED WOBBLE

**L3 - the full 23-knob variant - WOULD pass the fire rule** (vs L0: as-scored
+0.421pp [0.270, 0.569]; **ex-no-call +0.277pp [0.139, 0.419], excludes zero**).

The pre-registered parsimony rule (item 11) selects the fewest-component
promotion-passer, which is **L1**, and item 12 then tests the fire rule on **L1**,
which fails. **A differently-written rule - "fire on the best rung that passes the
fire rule" - would fire on L3.** Items 11 and 12 were written as a pipeline
(select, then test) without anticipating that the parsimony-selected rung and the
fire-passing rung could differ. They do.

**The committed rule is honoured and the alternative is disclosed, not taken** -
in the same spirit as the predecessor recording its unnamed-slice ambiguity.

I still recommend not firing, for reasons independent of which rule you prefer:

1. **The task's question came back negative.** It asked for the *smallest* variant
   that genuinely earns the gap. No lean variant does. Firing on L3 abandons the
   question rather than answering it.
2. **L3 is exactly what the predecessor declined to fire on**, for reasons this
   task *strengthened*: the residual is now known to be **unattributable in
   principle** to any single component.
3. **Parameter bloat is a standing rule**, and not one of L3's four added
   components can earn its own place.

**What would change this:** a lean rung that passes the fire rule on its own
ex-no-call margin. **L2c is the only near miss** - if the paired bar is ever
re-derived honestly on a larger population, *before* a candidate is measured
against it, L2c is the first thing to re-examine.

---

## THE INSTRUMENT WAS PROVEN BEFORE USE

The tracer replicated `260909-25z` Arm B **bit-exactly** before any new number was
trusted: **+0.421pp, 95% [0.270, 0.569], Brier -0.00089, 82,735 units, 911
events** - every field agreeing to the printed precision. Two prose figures the
predecessor never printed intervals for also reproduced, now *with* intervals:
ex-no-call **+0.277pp [0.139, 0.419]** and ex-2016 **+0.291pp [0.138, 0.452]**.

A copied script computing a different number would have been a broken instrument
and every rung after it worthless. It did not, so it is not.

## PRE-REGISTRATION, PROVEN BY ORDERING

| | |
|---|---|
| `LADDER-RULE.md` committed | `815faf23` at **13:09:14** |
| first artifact written (`REPLICATE.jsonl`) | **13:09:37** |

**23 seconds.** The rule provably predates every number in this task, checkable
from `git log` against `ls --time-style=full-iso` rather than asserted.

## HOLDOUT AND SEAL - CHECKED FIRST, NOT LAST

| assertion | result |
|---|---|
| no 2023+ accuracy / Brier / log loss read or produced | **confirmed** - every figure is 2016-2022 |
| all five guards armed (1-4 run, 5 grepped) | **ALL FIVE REFUSED** (`GUARDS-PROOF.txt`) |
| `git log --oneline -- packages/bpr/frozen-params.json \| wc -l` | **1** |
| `reports/bpr-2023-test.jsonl` | **absent** |
| `git status --porcelain -- packages/bpr/model.ts packages/core/algorithms/bpr.ts` | **empty** - shipped port undiverged |
| `obsSdSlope` in every candidate | **zero**; skipped in every tune (F-16) |
| `npx vitest run packages/bpr packages/harness` | **47 files, 1122 tests passed** |

**No model code changed.** Not one file under `packages/` was edited - the plan
expected this and the expectation held. `260909-25z` had already exported
everything consumed here. The only new code is `scripts/ladder-contrast.ts`,
inside this quick directory. `frozen-params.json` was read as a tuning seed and
**never written**. No re-seal.

The green suite also confirms `260909-25z`'s deferred red is genuinely resolved
(the stale `sigma1/rp` import is gone), re-proved by running rather than assumed.

## Deviations from Plan

**None affecting any result.** Two operational notes:

1. **[Rule 3 - blocking] Shell scoping bug in a parallel launch.** The first
   attempt to run four tunes concurrently used `A && B && cmd &` chains; `&` binds
   looser than `&&`, so `$D`/`$R` were set only inside the first job and L2b/L2c/L2d
   wrote to `/candidates/...` and failed. L2a ran correctly. Fixed by wrapping each
   job in a subshell with absolute paths and re-running only the three that failed.
   **No measurement was affected** - failed jobs produced no output at all rather
   than a wrong one, and L2a's completed run was verified against its own log
   before being kept.
2. **Parallelism used where the plan assumed serial execution.** With 12 cores
   free, the four L2 tunes ran concurrently and the five contrasts ran
   concurrently. This is a scheduling choice only: each process is independent,
   single-threaded, and writes a distinct output path. Wall clock came in at
   ~65 min against the plan's 50-75 min estimate.

**No `TEST-2023.md` was written and `260909-25z/TEST-2023.md` was not modified** -
these are the pre-registered consequences of not firing, so two files listed in
the plan's `files_modified` are deliberately absent.

## Self-Check: PASSED

All artifacts verified present on disk; all four task gates returned
`GATE-N-PASS`; all four commits verified in `git log`.

| commit | subject |
|---|---|
| `815faf23` | pre-register the ladder rule, before any number exists |
| `fff81307` | the instrument replicates, and L1's margin is the no-call artifact |
| `82798846` | no component earns its place alone, and the bundle is sub-additive |
| `f4e56edb` | the ladder, and DO NOT FIRE |

A concurrent session interleaved commits (`260909-3fj`, `rankingPoints`)
throughout. Every commit here was staged by **explicit path**; no foreign file
entered any of them.
