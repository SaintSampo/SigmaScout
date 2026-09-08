# GBR — Gradient-Boosted Rating (research model, 2026-09-08)

GBR is SigmaScout's first *trained* machine-learning predictor: hand-rolled
histogram gradient-boosted trees (zero dependencies, Worker-portable inference)
over 25 season-normalized walk-forward features. Where OPR/EPA/VPR/BPR maintain
a hand-designed latent rating with a hand-designed update rule, GBR learns the
mapping from feature vectors to win probability directly from 2016-2025 data.
All score-scale features are z-scored against running within-season statistics,
so the learned function is game-agnostic — the design bet was that this
transfers to a season whose game the model has never seen, which is exactly the
predict-2027 problem.

Research package: `packages/gbr/` (standalone; no imports from
`packages/harness` or any existing algorithm's internals). Built as quick task
`260908-3k5`; process mirrors `260908-b4t` (BPR): design years → freeze →
single-shot sealed holdout.

## Protocol

- **Design years:** 2016-2020, 2022-2025. **Sealed holdout:** 2026, loader-enforced
  (`loadSeason(2026)` throws without `breakSeal`; only `holdout.ts` may pass it,
  and it refuses until `frozen-params.json` is committed clean at HEAD).
- **Selection:** 48-config seeded random search (8 chunks, seeds 201-208), each
  config scored on rolling origins 2022/2023/2024/2025 with training strictly on
  earlier design years. Objective: mean winner accuracy, Brier tiebreak
  (pre-committed). Winner frozen at commit `78f1bc87`.
- **Holdout:** run once, immediately after the freeze, at `78f1bc87`.
- Frozen winner: 170 trees, depth 4, lr 0.0498, minChildWeight 1.33,
  lambda 1.65, subsample 0.854, colsample 0.724, EWMA halflife 20,
  prevSeasonDecay 0.9. The top-12 of 48 configs spanned only 0.1 accuracy
  point — the model is not hyperparameter-fragile.

## Results

Rolling-origin selection (mean over origins 2022-2025): **0.7527 accuracy,
0.1662 Brier** — vs VPR's published mean over the same seasons 0.7480 / 0.1716.

Single-shot 2026 holdout (trained on all nine design years, frozen params):

| Slice | GBR accuracy | GBR Brier | n |
|---|---|---|---|
| 2026 combined | **0.7733** | **0.1542** | 20,161 |
| 2026 quals | 0.7716 | — | 16,479 |
| 2026 elims | 0.7811 | — | 3,682 |
| 2026 offseason only | 0.7657 | 0.1640 | 1,899 |

Published baselines for 2026 (combined view, `reports/full-2016-2026`):
OPR 0.6994 / 0.1791 · VPR 0.7890 / 0.1471 · EPA 0.7943 / 0.1548.

Convention caveat: GBR excludes exact-0.5 predictions from the accuracy
denominator (measure-zero for a GBDT) and scores surrogate-affected matches as
ineligible; the harness counts no-calls as misses. These differences are far
smaller than the gaps above.

## Honest read

- GBR **beat VPR on the rolling-origin mean** (driven by 2022 and 2024) but
  **lost the 2026 holdout** by 1.6 accuracy points and 0.007 Brier. Rule A
  (accuracy AND Brier both improve) is **not met** — GBR does not ship to the
  site in this form.
- It is nonetheless within 1.6pt of a system that has had ~10 code versions of
  tuning, on a game it never saw — evidence the season-normalized-features
  approach genuinely transfers across games, just not yet better than the
  incumbent.
- The offseason-only slice (0.7657, the closest proxy for late-2026 offseason
  events and 2027 cold-open) trails the combined number, consistent with
  offseason lineups being noisier.
- 100% accuracy is not attainable for FRC matches; the irreducible-noise
  ceiling is likely in the low 80s. The productive target remains beating VPR
  walk-forward on both headline metrics.

## Where the headroom likely is (unexplored, in rough order of promise)

1. Per-team component-level features from score breakdowns beyond the three
   group shares (GBR uses auto/teleop/endgame shares only; VPR models
   components fully).
2. Opponent-adjusted contribution (current schedule-strength EWMA is one hop;
   an iterated adjustment or a learned interaction may recover more).
3. More capacity + more search: 48 configs is small; the flat top suggests
   feature limits, not tree limits — new features first.
4. Margin-head-informed win probability (predict margin distribution, derive
   p(win)) rather than a direct classifier.
5. Event-scoped recency (form within the current event vs season form).

Never: ensembling with EPA/VPR (standing project decision).
