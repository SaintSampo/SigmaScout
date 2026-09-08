---
task: Fresh FRC match-prediction model, designed 2023-blind, evaluated once on 2023-2026
slug: fresh-2023-blind-model
date: 2026-09-08
mode: quick
---

# Fresh 2023-blind match prediction model

## Constraint (user-chosen Option A)

Model structure AND hyperparameters may only be informed by data from **2022 and
earlier**. 2023-2026 is a sealed holdout, evaluated **once**, at the end.

Two contamination channels must both be closed:
1. **State leakage** — handled by walk-forward, predict-before-update.
2. **Design leakage** — handled by tuning exclusively on 2016-2022 and by
   refusing to read the existing VPR implementation, its tuned parameter
   files, or the project notes recording which VPR knobs won/lost on
   2023-2026.

### Firewall (explicit)

Off-limits for this task:
- `packages/core/algorithms/sigma1/**` (VPR internals)
- `packages/harness/**` (VPR search space, tuned knobs)
- `data/algorithm-versions/**` (parameters fitted on 2023-2026)
- Project memory / docs recording VPR ablation outcomes on 2023+

Allowed: `data/corpus.sqlite` (raw TBA facts), `packages/corpus/schema.sql`.

Executed inline (no subagents) specifically to keep this firewall intact — a
spawned agent would very likely read the VPR sources while orienting.

## Design (from FRC first principles)

Working name **BPR** (Bayesian Power Rating), to sit alongside OPR/EPA/VPR.

- **Signal**: foul-adjusted alliance score, `totalPoints - foulPoints`.
  Verified 100% present in all 10 seasons; `totalPoints == alliance score`
  always. Foul points in an alliance's breakdown are *earned by the
  opponent's fouls*, so they are opponent-attributable, not skill.
- **Field-name discovery must be runtime, not hardcoded.** 2026 renames
  `autoPoints`/`teleopPoints` to `totalAutoPoints`/`totalTeleopPoints`.
  Any component split keyed on ≤2022 field names would silently degrade on
  the holdout. Only `totalPoints`/`foulPoints` are treated as stable.
- **State**: per team, a Gaussian latent contribution in points.
- **Two-timescale**: slow talent `L` + fast form `S` (mean-reverting).
  Motivation: FRC robots get repaired/upgraded between events, a dynamic a
  single decay rate cannot express.
- **Update**: joint Kalman on `y = sum of 3 team means + noise`. Credit is
  assigned in proportion to each team's variance, so uncertain teams move
  more — the Bayesian answer, rather than a fixed fraction.
- **Season carryover**: rating persists with inflated variance. A uniform
  year-to-year scale error cancels in the margin, so it costs calibration
  but not winner accuracy; an online-fitted link absorbs it.
- **Win probability**: `Phi(margin / (tau * sqrt(V_pred)))` with `V_pred`
  from posterior variances + observation noise, and `tau` fitted online by
  gradient on log loss. Uncertainty-aware rather than a fixed logistic.
- **Foul submodel**: per-team foul-conceded rate, added back to the
  predicted margin. Earns its place only if it helps on ≤2022.

## Ablations to settle on 2016-2022 (never on holdout)

1. two-timescale vs single-timescale
2. foul submodel on/off
3. defensive/suppression term (hard-regularized; the "unidentifiable model"
   failure in the project log is the risk here)
4. elimination-match observation weighting
5. rookie/unseen-team prior

## Metrics

Winner accuracy (primary; ties excluded from the denominator and also
reported as half-credit), Brier (secondary), log loss. Reported per season.

## Success

A frozen model whose 2023-2026 accuracy is reported exactly once, honestly,
with no post-hoc adjustment after the seal is broken.
