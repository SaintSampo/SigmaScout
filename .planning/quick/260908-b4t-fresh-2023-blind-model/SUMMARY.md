---
task: fresh-2023-blind-model
status: complete
date: 2026-09-08
frozen_at: a66688af
holdout_accuracy_all: 0.7805
holdout_accuracy_quals: 0.7837
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

- **No head-to-head against VPR, EPA, or OPR.** Running them under this harness
  means reading their implementations, which would have broken the firewall this
  task existed to maintain. It also would not be apples-to-apples: those models
  were tuned *on* 2023–2026, and BPR deliberately was not.
- **Not integrated into the site.** This is a standalone package with its own
  harness. No artifact publishing, no Worker path, no UI.
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
