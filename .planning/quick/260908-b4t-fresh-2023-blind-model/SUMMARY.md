---
task: fresh-2023-blind-model
status: complete
date: 2026-09-08
frozen_at: a66688af
holdout_accuracy_all: 0.7805
holdout_accuracy_quals: 0.7837
published: true
published_at: 2026-09-08
publish_generation: 34927891-7c14-401d-8684-af4f473ed02e
---

# BPR — a fresh, 2023-blind FRC match predictor

## Result

Frozen on 2016–2022 evidence alone, then evaluated **once** on 2023–2026:

| scope | matches | accuracy | Brier | log loss |
|---|---|---|---|---|
| all (quals + playoffs) | 69,511 | **78.05%** | 0.1483 | 0.4578 |
| qualification only | 57,644 | **78.37%** | 0.1461 | 0.4524 |

Per season (all matches): 2023 **76.44%**, 2024 **76.86%**, 2025 **78.44%**,
2026 **80.20%**.

The holdout came in *above* the design era's 73.08%. That is not the model
improving — 2023–2026 are simply easier seasons than 2016–2019. 2017 alone sits
at 65.65%. Season difficulty dominates, which is exactly why a single headline
number across differently-hard years should be read with care.

## How the constraint was enforced

Two contamination channels, closed separately:

1. **State leakage** — walk-forward with predict-strictly-before-update. Asserted
   by test, not assumed: flipping one match's result leaves every prediction up
   to and including that match bit-identical, and changes only later ones.
2. **Design leakage** — the model's *structure and hyperparameters* were chosen
   using only 2016–2022. `tune.ts` and `score.ts` both refuse any year past 2022
   outright. `holdout.ts` is the sole path to the holdout, and refuses to run
   without `--break-seal` and without the parameter file being committed and
   clean at HEAD. All three refusals were verified before the run.

The task was executed inline, with no subagents, specifically to keep the
firewall intact — a spawned agent orienting itself would very likely have opened
the VPR sources. Nothing under `packages/core/algorithms/sigma1/`,
`packages/harness/`, or `data/algorithm-versions/` was read.

**Disclosed contamination.** During data recon, before the model existed, I
listed the score-breakdown *field names* present in 2023–2026 — not results. That
revealed 2026 renames `autoPoints`/`teleopPoints`. It was used for exactly one
decision: forbid any component split on hardcoded field names, and restrict the
model to `totalPoints`/`foulPoints`. That is strictly conservative — it removed a
family of designs rather than tuning one toward the holdout — but it is a real
glance at holdout schema and is recorded rather than left implicit.

## What the model is

Per-team latent scoring contribution tracked by a Gaussian filter, in
**scale-free units** (multiples of average-alliance-output ÷ 3). The season's
point scale is estimated online and cancels out of the win probability entirely.
This was forced by the constraint, not chosen for elegance: hyperparameters in
raw points cannot generalize to a season whose scoring level was never observed,
and 2016 alliances scored ~90 where 2018 scored ~400. A test asserts that
rescaling a season's scores by 17.3× changes accuracy by nothing to 12 decimals.

Four components survived, each with evidence:

| component | design Δ acc | what it is |
|---|---|---|
| season carryover | +1.80pp | ratings persist across seasons |
| two-timescale state | +1.05pp | slow talent + mean-reverting fast form |
| anti-additivity | +0.53pp | teams contribute by rank, weights (1, 0.7, 0.5) |
| foul-adjusted signal | +0.30pp | score minus foul points |
| online link calibration | 0.00pp acc | log loss 0.557 → 0.529 |

Against a naive additive single-timescale filter with no cross-season memory —
roughly a textbook OPR/Elo shape — the frozen model is **+3.22pp** (69.86 → 73.08).

**The anti-additivity term is the genuinely novel piece.** OPR and EPA both treat
an alliance as the plain sum of its teams. An FRC alliance shares one field and a
finite supply of game pieces, so three elite scorers should not add linearly.
Ranking teams within their alliance and weighting them (1, 0.7, 0.5) is worth
+0.53pp. An independent search on 2016–2019 alone rediscovered w2=0.7 and w3=0.5
*exactly*, which is good evidence this is real structure rather than a fitted
artifact.

Five ideas were tried and **rejected on the evidence**: a per-team foul-conceded
submodel, elimination-match down-weighting, a defensive suppression term, Huber
robustness to broken robots, and a learned red-side bias. Each was worth under
0.1pp — indistinguishable from search noise on 82,946 matches — so all five are
pinned to inert defaults in the frozen model.

Note the clean split on fouls: *subtracting* foul points from the signal helps
(+0.30pp), while *modelling per-team foul rates* does not. Fouls are worth
removing as noise, not worth predicting as skill.

Also useful: winner accuracy depends only on the **sign** of the predicted
margin, so every variance and calibration knob is structurally incapable of
moving it. That is why `tau` shows exactly 0.00pp on accuracy while cutting log
loss substantially.

## Was the search overfitting?

Measured without spending any holdout. Parameters tuned on 2016–2019 scored
**77.75%** on the held-back 2020+2022 slice; parameters that had been tuned on
that slice scored **77.84%**. A 0.09pp gap against a 0.30pp standard error — the
search is not meaningfully overfitting, which is why the design-era number
transferred.

Model selection followed a rule written down *before* the seal was broken
(`DECISION.md`): keep a component only if its ablation delta beats two standard
errors (0.31pp). The parsimonious variant scored 73.081% against the full
23-knob variant's 73.319% — a 0.238pp gap, inside the threshold — so the simpler
model was frozen.

## Caveats

- ~~**No head-to-head against VPR, EPA, or OPR.**~~ *(Superseded by the addendum:
  publishing produced one. BPR leads every published season, but VPR is tuned on
  those seasons and BPR is not, so it is not like-for-like.)* Running them under this harness
  means reading their implementations, which would have broken the firewall this
  task existed to maintain. It also would not be apples-to-apples: those models
  were tuned *on* 2023–2026, and BPR deliberately was not.
- ~~**Not integrated into the site.**~~ *(Superseded by the addendum: published
  2026-09-08 and live.)* It was, at the time of the sealed evaluation, a standalone
  package with its own harness -- no artifact publishing, no Worker path, no UI.
  There is still no live in-event folding: the Worker's subrequest budget caps that
  at one algorithm, currently VPR.
- **78.05% is one number over four differently-hard seasons.** The per-season
  spread of 76.4–80.2% is the more honest summary.
- The holdout is now spent. Any further tuning against 2023–2026 makes it a
  training set, and the next honest out-of-sample test is 2027.

## Files

- `packages/bpr/model.ts` — the model
- `packages/bpr/frozen-params.json` — sealed parameters, commit `a66688af`
- `packages/bpr/{data,evaluate,cli,tune,ablate,score,holdout}.ts`
- `packages/bpr/model.test.ts` — 9 tests
- `DECISION.md` — pre-committed freeze rule
- `HOLDOUT-RESULT.txt` — the single-shot output

---

# Addendum: shipped to production (2026-09-08)

The sections above are the sealed research result. This records what happened
when it was published, which was a materially larger job than "add a model".

## Published

`bpr@1.0.0+baseline`, all ten official seasons, generation `34927891`:
145,070 objects / 5.28 GB, zero errors. Live on `data.sigmascout.org` and
rendering on the Compare page and ribbon.

## The site is now N-algorithm generic

The stated goal was to make the NEXT model cheap. A new algorithm now needs a
registry line plus a module; six seams were involved and the ones that could
fail silently were made to fail loudly:

| seam | change |
|---|---|
| `PUBLISHED_ALGORITHM_IDS` | the one edit a new algorithm should need |
| `BASE_PUBLISH_ALGORITHMS` | id to module, feeds publish + cleanup |
| `buildAlgorithmsManifest` | now DERIVED, throws on an unregistered id |
| `ALGORITHM_DISPLAY_LABELS` | ribbon label |
| `SELECTED_ON_SEASONS_SOURCES` | already threw loudly |
| `serializeState` | bpr branch added; the silent Sigma1 fallthrough documented |

`AccuracyTable`'s column count and `DataCoverageTable`'s test assertions are
derived rather than literal, and the compare/ribbon test suites assert against
the registry instead of a pinned triple.

## Three defects the dry-run caught before any production write

None would have been caught by tests, and all three were found by running
`--dry-run` on one season first:

1. version `1.0.0` violated the D-13 `{codeVersion}+{paramSetName}` artifact-key
   shape, now `1.0.0+baseline`
2. no selected-on provenance registered
3. `state.componentOrder is not iterable` -- `serializeState` silently treats an
   unknown id as Sigma1-shaped, so BPR failed naming a field it has never had

## How BPR compares, and the caveat that matters

Published pooled combined accuracy: BPR leads every season it was measured on
(2024 .7671, 2025 .7854, 2026 .8041) against EPA (.7354/.7745/.7944) and VPR
(.7321/.7641/.7874).

**This is not a like-for-like comparison.** VPR is tuned ON those seasons;
BPR treated them as a sealed holdout. The honest reading is that a
2023-blind model is competitive with tuned ones, not that it is 3pp better.
A visible consequence: OPR has dropped off the home page podium, which has
three places for four algorithms.

## Budget headroom -- one number to watch

`compare` is now at **93.2% of its 20,000-byte ceiling** (14,015 -> 18,630 B),
because that artifact carries one slice set per algorithm. A FIFTH algorithm
breaches it. Raise the ceiling or shrink the per-slice payload first.
R2 storage is at 5.28 GB of the 10 GB free tier.

## Compare page: pill instead of bold

With four algorithms the bold winning value was hard to pick out of a dense
numeric grid. It now renders in a rounded pill -- a SHAPE signal, because the
palette is spent (alliances, tiers, win/loss, accent) and sketch 007 ruled out
a per-algorithm hue. Near-ties still render as ties with no emphasis at all.

## Not done

- `packages/gbr/seal.test.ts` failures belong to a concurrent session
- `publish.test.ts` and four others fail only under full-suite contention;
  `publish.test.ts` passes 149/149 in isolation
- the holdout is spent: re-tuning BPR against 2023-2026 voids the 78.05%

---

# Addendum 2: the no-call boundary (2026-09-08)

Follow-up question: why does BPR report zero no-calls when OPR/EPA/VPR report
some? Because it could not reach the boundary in floating point, and that was
scoring in its favour.

## The defect

`packages/core/scoring/brier.ts` identifies a no-call by EXACT equality with
0.5, and D-Q3 counts a no-call against a decided match as a MISS. BPR's link is
a normal CDF over the Abramowitz-Stegun erf approximation, which returns
+1.0e-9 at the origin rather than 0 -- so `normCdf(0)` evaluated to
0.5000000005. A dead-even matchup landed a hair above the line and was scored
as a confident red pick.

That is not a display problem. OPR, EPA and VPR use logistic links that hit 0.5
exactly and pay the D-Q3 penalty; BPR was collecting credit on coin flips they
were charged for.

## Census, under the frozen parameters

Exactly-0.5 predictions, walked forward over the full corpus:

| season | dead-even predictions |
|---|---|
| 2016 | 274 |
| 2017 | 1 |
| 2018-2026 | 0 |
| **total** | **275** |

Of those 275, red won 134, blue won 139, and 2 were actual ties.

All of them are cold start -- both alliances entirely unseen. Same shape as
EPA's 272+1 and VPR's 269+1. OPR's much larger per-season counts are a
different cause: it is event-scoped, so every event restarts everyone at zero.

## The fix

`normCdf` now short-circuits `z === 0` to exactly 0.5, in both the production
port and the research model. This mirrors the guard
`sigma1/linkFunctions.ts::normalCdf` already applies to its own erf-based CDF --
the repo had solved this once already.

`packages/core/algorithms/bpr.test.ts` pins the boundary with exact-equality
assertions (`toBeCloseTo` would pass against the bug this prevents).

## What it costs, on republish

- **2016 winner accuracy falls by roughly 1.0pp** (134 credited calls of ~13,140
  decided matches become misses). 2017 moves by ~0.007pp.
- **2018-2026 are untouched**, and the sealed holdout **78.05% is unchanged** --
  the 2023-2026 era contains zero dead-even matches.
- The research harness scores a no-call as half credit rather than a miss
  (`evaluate.ts`), a convention split that predates this fix and is now
  reachable: design-era accuracy recomputes to 73.084% against the 73.081%
  sealed in `frozen-params.json`. That file is a record of what was measured at
  freeze time and is deliberately NOT edited.

Artifacts still carry the old numbers until the next republish.

