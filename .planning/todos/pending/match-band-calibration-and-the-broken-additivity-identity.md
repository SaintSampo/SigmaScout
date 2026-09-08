---
id: match-band-calibration-and-the-broken-additivity-identity
created: 2026-09-08
source: measured against live 2026 artifacts (vpr@11.0.0+rolling-2026-09e) during quick task 260908-5wd, at the developer's request to put the match ± and the alliance band under a microscope
resolves_phase:
priority: medium
---

# The match band is decently calibrated; the identity the schema claims for it is not true

Measurement only. Nothing was changed, and no fix is proposed here without a decision first.

All figures below are 2026 official play (offseason excluded), `vpr@11.0.0+rolling-2026-09e`,
read from the live published artifacts through the local `/v1` proxy.

## Where the numbers on screen come from

The match row's text `± N` and the plotted alliance band are the SAME source — both take
`redScoreVarianceOwn`/`blueScoreVarianceOwn` and root it (`MatchTable.tsx:224/350`,
`EventMatchTable.tsx:175/272`). They cannot disagree with each other, which is good and worth
keeping.

## Finding A — the sum-of-squares identity is FALSE, and the code already knew

`pageArtifacts.ts`'s file header states, as one of two rules "enforced by `pageArtifacts.test.ts`
rather than left to convention", that `redScoreVarianceOwn` **equals the sum of its three teams'
`TeamMetric.spread` squares, by construction**. `uncertainty-display.md` leans on the same claim
("the site becomes internally consistent by construction, not by discipline").

Measured over **10,016 alliance observations** (ratio = `redScoreVarianceOwn` ÷ Σ team `spread²`):

| statistic | value |
|---|---|
| mean | 0.927 |
| median | **0.837** |
| 5th percentile | 0.427 |
| 95th percentile | 1.741 |
| min / max | 0.186 / 5.676 |
| **within 1% of 1.0** | **1.9%** |

A 30× range is not a rounding artifact. `sigma1/index.ts:1598` already says so outright:

> "THE ALLIANCE-ADDITIVITY IDENTITY IS STILL GONE, AND IT IS STILL A REAL COST. … The published
> spread and `predict()`'s variance are different quantities and have been since 5.0.0."

— and `sigma1.test.ts` pins the break as an INEQUALITY so the two paths cannot be re-coupled by
accident. So the model is behaving as its authors intended; the **schema header and the skill
doc are stale**, asserting a property that was deliberately removed three majors ago. That is
exactly the "docs describe a model that no longer exists" failure this project's log names as its
original sin, and it is currently load-bearing documentation.

One honest confound, stated so nobody over-reads the table: published team `spread` is
SEASON-FINAL while `redScoreVarianceOwn` is AS-OF-MATCH, so some dispersion is expected even had
the constructions matched. It does not explain a median 16% low or a 0.19–5.68 range, and it does
not explain `index.ts`'s own comment.

## Finding B — the band is conservative, not broken

**36,805 alliance observations across 216 events**, `z = (actual − predicted) / √varianceOwn`:

| statistic | measured | Gaussian ±1σ would give |
|---|---|---|
| RMS z | **0.920** | 1.000 |
| within ±1σ | **75.2%** | 68.3% |
| within ±2σ | 96.3% | 95.4% |
| within ±3σ | 99.5% | 99.7% |
| max abs z | 6.66 | — |

The band is roughly **8% too wide**: it is drawn as ±1σ but behaves like a ~75% interval. The
shape is peakier than Gaussian in the middle with a slightly heavier tail (99.5% vs 99.7% at 3σ,
one observation out at 6.7σ).

**This is NOT sketch 003's failure recurring.** That one put actuals 7–10σ outside the band from a
partial variance. This band errs the safe way. But "±1σ" implies 68% to a reader who knows the
convention, and it delivers 75%.

## Finding C — a systematic under-prediction, ~25σ significant

Mean `z` = **+0.1197** over 36,805 observations (SE ≈ 0.0048, so ~25σ from zero — not noise).
Alliances score about 0.12σ ABOVE prediction on average, which at a typical σ ≈ 95 is roughly
**+11 points per alliance**.

Most likely a filter lagging a target that improves across a season — teams get better, and a
walk-forward estimate is always slightly behind. **Recorded as an observation, not a diagnosis**;
nobody has tested that hypothesis. Worth checking whether the bias is concentrated early-season
(consistent with lag) or flat across weeks (which would mean something else).

## Finding D — the site again shows TWO different ± under one name

D-01/D-02/D-03 rejected having two uncertainty quantities. It has two again:

- **Team page ±** = Swing Factor, the robot's match-to-match swing (`swing.ts`; P deliberately
  excluded, and as of quick task 260908-5wd this is intentional — it is a bonus stat about the
  robot, not about the model's confidence).
- **Match row ± and band** = full predictive variance (per-team P + R plus covariance totals).

Team 254 / 2026 shows `± 55.71` on its tile and its matches carry roughly `± 95`. Both are printed
as "±", neither is labelled, and they do not reconcile.

Given 260908-5wd deliberately made the team-page number a swing statistic, the resolution is
probably NOT to re-couple them but to stop claiming they are one quantity: correct the schema
header and `uncertainty-display.md`, and give the two numbers distinguishable labels in the UI.
That is a decision, so it is recorded rather than taken.

## Finding E — the skew is REAL but MODEST, and it is a population property, not a per-team one

Measured 2026-09-08 on **36,806 alliance observations / 227 events**, after removing the mean so
Finding C's bias is not mistaken for skew:

| statistic | value |
|---|---|
| residual mean (the Finding C bias) | **+8.92 points** |
| residual SD | 68.94 |
| skewness | **+0.0825** (z-skewness +0.169) |
| semi-deviation below centre | 64.91 |
| semi-deviation above centre | **73.27** |
| **upper / lower ratio** | **1.129** |
| centred p05 / p95 | −101.6 / **+117.5** |
| centred p01 / p99 | −174.3 / +184.2 |

Coverage, symmetric vs asymmetric band of the same nominal width:

| band | inside | miss LOW | miss HIGH |
|---|---|---|---|
| symmetric ±1σ | 74.0% | 11.8% | **14.3%** |
| asymmetric ±1 semi-deviation | 73.8% | 13.2% | 13.0% |

**What this does and does not justify.** The asymmetry is real — the upper side is ~13% wider,
and with a symmetric band a reader is about 21% more likely to be surprised high than low
(14.3% vs 11.8%). An asymmetric band fixes exactly that lopsidedness, balancing the misses at
13.2/13.0. It does NOT cover more in total (73.8% vs 74.0%) — it redistributes, it does not tighten.

Skewness of +0.08 is small in absolute terms, so this is a refinement, not a defect being repaired.

**The trap to avoid: per-team semi-deviations.** With a 6-match half-life the effective sample per
team is only about 9 observations (Σ decay^age → 1/(1−w) ≈ 9.2). Splitting that by sign leaves
~4.5 per side, so any single team's up/down asymmetry would be mostly noise — a team would get a
lopsided band because of which way its last few matches happened to break, and the site would be
asserting a per-robot skew it cannot possibly know. The 1.129 ratio is stable because it rests on
36,806 observations, not on one team's four.

**Recommended shape if this is built:** keep the per-team width symmetric (stable), and apply the
POPULATION-level ratio as a global shaping constant. Asymmetry then comes from the quantity that
actually supports it, and no per-team skew is invented.

**Bigger prize than the shape:** the band is centred on the prediction, but actuals average +8.92
points above it (Finding C). Re-centring is worth more than re-shaping — and it belongs in the
model, not in the band, since a band drawn off-centre from its own tick would be its own kind of
lie.

## SHIPPED 2026-09-08 — what this todo still covers, and what it no longer does

`f4b07846` moved the EVENT-PAGE band off the published variance and onto
`√(Σ the three teams' Swing Factor²)`, browser-computed for every algorithm, walk-forward.

**Closed by that change:**

- Finding A on the event page. The sum-of-squares identity is now true BY CONSTRUCTION there,
  because the band is literally that sum. (The `pageArtifacts.ts` header and
  `uncertainty-display.md` are still wrong about the PUBLISHED field — see below.)
- The VPR-only privilege. All three algorithms now render identically: 181 of 222 predicted
  cells and 120 bands on `2026casnv`, verified live.
- Finding D on the event page. The tile `±` and the match band are one quantity again.

**Still open:**

1. **The docs are still false about the published field.** `redScoreVarianceOwn` is still
   published by VPR and still is not the sum of its teams' spread squares. Nothing reads it on
   the event page any more, but `pageArtifacts.ts`'s header still states the identity as an
   enforced rule and `uncertainty-display.md` still leans on it. Correct the prose, or stop
   publishing the field.
2. **The team page still draws VPR-only bands.** It cannot use this construction: measured on
   `frc254`'s 2026 artifact, the other 135 teams appear a median of 2 times and only 52.6% appear
   twice at all, so per-team swing is not estimable there. Fixing it needs either the event
   artifacts fetched per event section (a page-load cost on the project's top-priority metric) or
   a per-team swing field added to an artifact (a pipeline change and a republish).
3. **Findings B, C and E are untouched** — the conservatism (~76% coverage where 1σ claims
   68.3%), the +8.92-point centring bias, and the asymmetric-band question.

## 2026-09-08 UPDATE — BPR changes most of this, because BPR publishes properly

The developer is retiring VPR and moving to BPR. Measured against the live artifacts the same
day, `bpr@1.0.0+baseline`:

| check | BPR | VPR | OPR / EPA |
|---|---|---|---|
| alliance variance on EVENT match rows | **89 / 89** | 89 / 89 | 0 / 89 |
| alliance variance on TEAM match rows | **71 / 71** | 71 / 71 | 0 / 71 |
| per-team season `spread` | **yes (12.46 for frc254)** | yes | no |
| published variance ÷ Σ team spread² | **median 1.02** | median 0.837 | n/a |

**Finding A largely retires with VPR.** The additivity identity the schema claims is close to
true for BPR (median 1.02; the remaining dispersion is the season-final-vs-as-of-match confound
this file already names). The badly-broken case was VPR's.

**`a2ea9425` reversed this task's own event-page override** for the reason above plus the
requirement that a match read the same on both pages. The team page cannot compute the browser
band — `frc254`'s teammates appear a median of 2 times, only 52.6% twice — so overriding on the
event page created a page disagreement rather than removing one: BPR read ±139 on the event page
against ±76 on the team page, median ratio 1.65 over 150 observations.

**The one gap left, and it needs the pipeline, not the browser:** OPR and EPA publish no variance
at either level, so they now show a browser band on the event page and NO band on a team page.
Closing it means publishing a derived per-alliance variance for every algorithm — the same
`√(Σ team swing²)` quantity, computed pipeline-side where the full match history is available.
That would make every algorithm identical on both pages by construction and would let
`lib/allianceBand.ts` be deleted.

## Suggested order if this is picked up

1. Correct `pageArtifacts.ts`'s header and `uncertainty-display.md` — they are false TODAY and
   cost nothing to fix.
2. Decide the labelling question in Finding D.
3. Decide whether the ~8% width and the +0.12σ centre are worth a calibration pass, or are
   acceptable conservatism. Note a width fix and a bias fix are independent.
