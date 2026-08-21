# OPR baseline change: season-pooled to event-scoped (Phase 3.2)

OPR stopped meaning "one ridge-regularized fit per team per season, pooled across every event
that team attended" and started meaning what TBA and Statbotics actually publish: a fit over one
event's qualification matches only. This document is the single narrative home for that change
(D-14) — why the switch, both baselines' numbers side by side, the restated SC-3 verdict, the
measured cost of early-event cold start, and every deliberate divergence from TBA's own
computation that survives the rewrite.

Every figure below traces to one of four committed files — never to a gitignored `reports/` path
and never to memory:

- **New baseline (event-scoped OPR, and the unchanged EPA/Sigma1 rows beside it):**
  `data/baselines/opr-event-scoped-2026-08.json` — the sole re-run behind every current figure in
  this document, produced by:

```
pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-defaults,sigma1-adapt --out reports/event-scoped-v1
```

  (`runTimestamp: 2026-08-21T17:48:49.076Z`, `corpusIdentity: data/corpus.sqlite`).

- **Retired baseline, as published:** `data/baselines/opr-season-pooled-published-tuned-v3.json`
  — the fingerprint of `reports/tuned-v3`, the run behind `docs/models/sigma1-tuning-results.md`'s
  original published tables (`runTimestamp: 2026-08-17T01:11:06.668Z`).
- **Retired baseline, final run before deletion:** `data/baselines/opr-season-pooled-retired-2026-08.json`
  — D-13's mandated final full run of the season-pooled implementation, captured immediately
  before plan 03.2-02 deleted the code (`runTimestamp: 2026-08-21T08:09:13.781Z`).
- **SC-5 early-event measurement:** `data/diagnostics/opr-event-scope-2026-08.json` — the
  accuracy-by-checkpoint curve, the rank-vs-team-count diagnostic, and the D-09 warm-only cut,
  produced by `packages/harness/eventScopeDiagnostic.ts` against `reports/event-scoped-v1`.

## What changed and why

OPR now means a fit over one event's qualification matches, solved as a plain minimum-norm
pseudo-inverse — which is what TBA computes. TBA's own
`src/backend/common/helpers/matchstats_helper.py` filters `if match.comp_level != "qm": continue`
in both `build_team_mapping` and `build_Minv_matrix`, restricting the fit to qualification matches
only, and solves with `np.linalg.pinv(M)` — a minimum-norm pseudo-inverse with no regularization
term anywhere in the file. SigmaScout's retired implementation instead pooled every event a team
attended across the whole season into one fit, and added a ridge penalty (`OPR_RIDGE_LAMBDA = 3`)
that TBA's own computation does not have. Both departures — season pooling and the ridge term —
are corrected by this rewrite, matching this phase's standing yardstick: what TBA and Statbotics
actually publish, not what is internally most defensible.

**The arithmetic behind dropping the ridge term.** Ridge shrinkage scales roughly as
`lambda / (observations + lambda)`. Under season pooling, a team accumulated roughly 30-40
alliance observations by mid-season, so `OPR_RIDGE_LAMBDA = 3` biased every rating by only about
7-9% — a small, steady effect. Under event scope with qualification matches only, a team finishes
a typical regional with around 12 alliance observations total, so the identical `lambda = 3` would
shrink every rating by roughly 20%, and far more severely in a match's first few observations.
"Freezing lambda" at its old value would have held a constant fixed while its effect roughly
tripled — quietly shipping a weaker opponent than event-scoped OPR is required to be by TBA's own
definition. Removing the ridge term entirely, and letting the minimum-norm SVD solve handle rank
deficiency directly, avoids that silent re-tuning-by-omission. `opr.ts` already imported
`SingularValueDecomposition` from `ml-matrix` for the season-pooled solve, so this needed no new
dependency.

## Both baselines, side by side

**OPR, per season, under both definitions** (all-matches headline, no cold-start mitigation
applied — D-08 explicitly declines mitigation this phase):

| Season | Event-scoped OPR Brier / Winner accuracy | Season-pooled OPR Brier / Winner accuracy (retired) |
|---|---|---|
| 2022 | 0.1890 / 0.7445 | 0.1523 / 0.7743 |
| 2023 | 0.2171 / 0.7133 | 0.1706 / 0.7502 |
| 2024 | 0.2126 / 0.7060 | 0.1687 / 0.7501 |
| 2025 (holdout) | 0.2119 / 0.7296 | 0.1675 / 0.7618 |
| 2026 (holdout) | 0.2211 / 0.7530 | 0.1773 / 0.7825 |

Event-scoped OPR is materially worse on every single season, on both metrics — the expected,
accepted cost of matching TBA's own event-scoped, quals-only, no-shrinkage definition, not a
regression to fix (see `## Early-event behavior (SC-5)` below for the mechanism).

**EPA and every Sigma1 variant, retired run vs. new run, side by side.** Per D-12, no reproduction
control was formally asserted on these four algorithms — EPA and Sigma1 never read OPR's output,
and the underlying match stream is unchanged, so their figures are *expected* to reproduce the
published run exactly. Stating them side by side is what makes any unexplained movement visible to
a reader, since an unintended change to the shared stream during the rewrite would otherwise be
indistinguishable from the OPR swap in the re-issued figures:

| Algorithm | Season | Published (`tuned-v3`) Brier / Acc | New run (`event-scoped-v1`) Brier / Acc | Same? |
|---|---|---|---|---|
| epa | 2022 | 0.1926 / 0.7387 | 0.1926 / 0.7387 | identical |
| epa | 2023 | 0.1985 / 0.7241 | 0.1985 / 0.7241 | identical |
| epa | 2024 | 0.2160 / 0.6991 | 0.2160 / 0.6991 | identical |
| epa | 2025 | 0.1932 / 0.7290 | 0.1932 / 0.7290 | identical |
| epa | 2026 | 0.1742 / 0.7454 | 0.1742 / 0.7454 | identical |
| sigma1 | 2022 | 0.1636 / 0.7604 | 0.1636 / 0.7604 | identical |
| sigma1 | 2023 | 0.1722 / 0.7415 | 0.1722 / 0.7415 | identical |
| sigma1 | 2024 | 0.1765 / 0.7318 | 0.1765 / 0.7318 | identical |
| sigma1 | 2025 | 0.1612 / 0.7657 | 0.1612 / 0.7657 | identical |
| sigma1 | 2026 | 0.1531 / 0.7873 | 0.1531 / 0.7873 | identical |
| sigma1-defaults | 2022 | 0.1691 / 0.7529 | 0.1691 / 0.7529 | identical |
| sigma1-defaults | 2023 | 0.1788 / 0.7299 | 0.1788 / 0.7299 | identical |
| sigma1-defaults | 2024 | 0.1821 / 0.7212 | 0.1821 / 0.7212 | identical |
| sigma1-defaults | 2025 | 0.1662 / 0.7539 | 0.1662 / 0.7539 | identical |
| sigma1-defaults | 2026 | 0.1554 / 0.7819 | 0.1554 / 0.7819 | identical |
| sigma1-adapt | 2022 | 0.1619 / 0.7609 | 0.1619 / 0.7609 | identical |
| sigma1-adapt | 2023 | 0.1699 / 0.7423 | 0.1699 / 0.7423 | identical |
| sigma1-adapt | 2024 | 0.1763 / 0.7321 | 0.1763 / 0.7321 | identical |
| sigma1-adapt | 2025 | 0.1599 / 0.7646 | 0.1599 / 0.7646 | identical |
| sigma1-adapt | 2026 | 0.1494 / 0.7887 | 0.1494 / 0.7887 | identical |

All 20 of 20 season/algorithm pairs are identical to four decimal places. This is the strongest
available confirmation (short of a bitwise digest comparison across every season, not attempted
for this pair) that nothing other than OPR moved between the published run and this phase's
re-run — and it is recorded as evidence, per D-12's explicit decision not to convert this into a
formal reproduction gate.

## The retired baseline's provenance

The retired season-pooled OPR figures are backed by two committed fingerprints, not one:

1. **The published run** (`data/baselines/opr-season-pooled-published-tuned-v3.json`) — the run
   behind `docs/models/sigma1-tuning-results.md`'s original published tables
   (`runTimestamp: 2026-08-17T01:11:06.668Z`), captured in plan 03.2-01 because `reports/tuned-v3`
   is gitignored and was one `rm -rf reports/` away from being the only surviving evidence.
2. **D-13's final run** (`data/baselines/opr-season-pooled-retired-2026-08.json`) — a fresh,
   independent execution of the unmodified season-pooled implementation, run immediately before
   plan 03.2-02 deleted the code (`runTimestamp: 2026-08-21T08:09:13.781Z`).

**Did they agree?** For 2022, 2023, and 2026 — the three seasons where both runs' prediction-stream
sidecars survived intact — the retired code's per-season `predictionStreamSha256` digest matches
the published run's digest **bitwise, exactly**: the strongest possible confirmation available that
the retired code at HEAD still reproduced the published prediction stream. For 2024 and 2025, D-13's
final run suffered a sidecar-persistence defect (`predictions-2024.jsonl` wrote 0 bytes,
`predictions-2025.jsonl` was never written — an I/O fault in that specific run, not a code-behavior
change; see `03.2-01-SUMMARY.md`'s "Known Anomaly"), so no bitwise digest comparison is possible
for those two seasons. Their aggregated Brier/winner-accuracy/scored-count figures, however, match
the published run to full floating-point precision — strong, though not bitwise-conclusive,
corroborating evidence the underlying computation was identical there too. Recorded as measured,
not smoothed into a clean "all five seasons confirmed" claim it does not support.

## SC-3 Verdict

D-02's literal reading, preserved unchanged: tuned Sigma1 must beat **both** OPR and EPA on
holdout Brier **and** holdout winner accuracy, on **both** holdout seasons (2025, 2026) —
evaluated as eight separate yes/no comparisons.

### Current verdict — measured against event-scoped OPR (2026-08-21)

Computed directly from `data/baselines/opr-event-scoped-2026-08.json`.

| # | Season | Comparison | Tuned Sigma1 | Baseline | Result |
|---|---|---|---|---|---|
| 1 | 2025 | Brier vs OPR | 0.1612 | 0.2119 | **PASS** (lower is better) |
| 2 | 2025 | Accuracy vs OPR | 0.7657 | 0.7296 | **PASS** (higher is better) |
| 3 | 2025 | Brier vs EPA | 0.1612 | 0.1932 | **PASS** |
| 4 | 2025 | Accuracy vs EPA | 0.7657 | 0.7290 | **PASS** |
| 5 | 2026 | Brier vs OPR | 0.1531 | 0.2211 | **PASS** |
| 6 | 2026 | Accuracy vs OPR | 0.7873 | 0.7530 | **PASS** |
| 7 | 2026 | Brier vs EPA | 0.1531 | 0.1742 | **PASS** |
| 8 | 2026 | Accuracy vs EPA | 0.7873 | 0.7454 | **PASS** |

**Current verdict: SC-3 PASSES — all 8/8 comparisons clear, measured against event-scoped OPR.**

### Retired verdict — measured against season-pooled OPR through Phase 3 (dated 2026-08-17)

Preserved from `docs/models/sigma1-tuning-results.md`'s original published `## SC-3 Verdict`
table, computed from `data/baselines/opr-season-pooled-published-tuned-v3.json` — what Phase 3
actually measured, unedited.

| # | Season | Comparison | Tuned Sigma1 | Baseline | Result |
|---|---|---|---|---|---|
| 1 | 2025 | Brier vs OPR | 0.1612 | 0.1675 | **PASS** (lower is better) |
| 2 | 2025 | Accuracy vs OPR | 0.7657 | 0.7618 | **PASS** (higher is better) |
| 3 | 2025 | Brier vs EPA | 0.1612 | 0.1932 | **PASS** |
| 4 | 2025 | Accuracy vs EPA | 0.7657 | 0.7290 | **PASS** |
| 5 | 2026 | Brier vs OPR | 0.1531 | 0.1773 | **PASS** |
| 6 | 2026 | Accuracy vs OPR | 0.7873 | 0.7825 | **PASS** |
| 7 | 2026 | Brier vs EPA | 0.1531 | 0.1742 | **PASS** |
| 8 | 2026 | Accuracy vs EPA | 0.7873 | 0.7454 | **PASS** |

**Retired verdict (dated 2026-08-17): SC-3 PASSES — 8/8, as measured through Phase 3 against
season-pooled OPR.**

### Which baseline is weaker?

**Event-scoped OPR is the weaker opponent.** Comparing the two committed fingerprints directly
(`## Both baselines, side by side` above): event-scoped OPR scores worse than season-pooled OPR on
both Brier and winner accuracy, in every one of the five seasons, including both holdout seasons
(2025: Brier 0.2119 vs 0.1675, accuracy 0.7296 vs 0.7618; 2026: Brier 0.2211 vs 0.1773, accuracy
0.7530 vs 0.7825). Sigma1's own figures did not move at all — D-10 kept the promoted version
bit-frozen across this rewrite, confirmed by the unchanged digest gate and the identical-to-four-
decimal-places table above. **Consequently, Sigma1's margin over OPR widening between the retired
verdict and the current one (for example, the 2025 Brier gap growing from 0.0063 under the retired
baseline to 0.0507 under the new one) is attributable entirely to the baseline changing, and NOT to
any improvement in Sigma1.** This is required framing (D-15), not optional garnish: presenting a
wider margin as if Sigma1 had gotten better would misattribute a change in the opponent to a change
in the model being evaluated, and that is exactly the honesty gap 04-CONTEXT D-11 names. In this
case the measurement also confirms 03.2-CONTEXT D-15's own stated expectation (event OPR is
weaker) — there is no contradiction to flag here, but the record states the direction and the
attribution outright regardless, per the same standing rule that would require flagging a
disagreement if one existed.

Both verdicts pass 8/8 either way, so there is no shortfall to record a named decision about; if a
future re-run of either baseline produced a FAIL, per 03-CONTEXT D-02 it would be recorded as a
failure with a named decision about what to change, never reworded, dropped, or rebased onto the
warm-only cut (D-09).

## Early-event behavior (SC-5)

_(Written by plan 03.2-05, Task 2 — see below.)_

## Named divergences from TBA

_(Written by plan 03.2-05, Task 2 — see below.)_

## Open Items

_(Written by plan 03.2-05, Task 2 — see below.)_

---
*Phase: 03.2-swap-opr-to-event-scoped-and-re-issue-affected-figures*
*Generated: 2026-08-21, from `data/baselines/opr-event-scoped-2026-08.json` (`pnpm harness --seasons 2022-2026 --algorithm opr,epa,sigma1,sigma1-defaults,sigma1-adapt --out reports/event-scoped-v1`, `runTimestamp: 2026-08-21T17:48:49.076Z`)*
