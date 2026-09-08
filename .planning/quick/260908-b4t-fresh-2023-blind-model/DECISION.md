---
task: fresh-2023-blind-model
decision: freeze rule, pre-committed
date: 2026-09-08
---

# Pre-committed freeze rule

Written **before** the holdout was touched, so which model gets frozen is not a
choice made after seeing 2023-2026 numbers.

## Noise floor

The design era has 82,946 scored matches. The standard error on a winner
accuracy near 73% is `sqrt(0.73*0.27/82946)` ≈ **0.154pp**. Two standard errors
is ≈ **0.31pp**.

Ablation deltas at the round-2 optimum:

| component | Δ acc (pp) | beats 2 s.e.? |
|---|---|---|
| season carryover | −1.86 | yes |
| two-timescale (slow + fast form) | −1.58 | yes |
| anti-additivity (w2, w3) | −0.47 | yes |
| foul submodel | −0.03 | no |
| elim down-weighting | −0.03 | no |
| defensive suppression | ~+0.09 | no |
| Huber clip | ~0.00 | no |
| learned side bias | ~+0.03 | no |
| online link calibration (tau) | 0.00 acc, −0.049 log loss | accuracy no, calibration yes |

## Rule

1. A component is **kept for accuracy** only if its ablation delta exceeds two
   standard errors (0.31pp). Anything smaller is as likely to be search noise
   fitted to the design era as it is to be signal, and carrying it into an
   unseen season is a bet with no evidence behind it.
2. A component with no accuracy effect but a **large calibration effect** is
   kept, because Brier and log loss are reported metrics too. This keeps `tau`.
3. Therefore the frozen model is the **parsimonious** variant: season carryover,
   two-timescale state, anti-additivity, online link calibration. Foul submodel,
   elim weighting, defensive suppression, Huber clip and side bias are pinned to
   their inert defaults.
4. The parsimonious variant is re-tuned on the design era before freezing, so it
   is not merely the full model with pieces switched off at settings chosen for
   a different configuration.
5. If the parsimonious variant's design accuracy is **more than 0.31pp below**
   the full model's, rule 3 is overridden and the full model is frozen instead.
   Recorded here so that override is a rule and not a rationalization.

## Holdout protocol

- `holdout.ts` refuses to run unless the frozen parameter file is committed and
  clean at HEAD, and refuses without an explicit `--break-seal` flag.
- It is run **once**. Whatever it prints is the reported result. No re-tuning,
  no "one more variant", no quiet re-runs.
- Both all-matches and quals-only figures are reported, because playoff matches
  are a materially easier prediction problem and mixing them without saying so
  inflates the headline.

## Disclosed contamination

During data recon, before the model existed, I listed the score-breakdown FIELD
NAMES present in 2023-2026 (not results, not outcomes). What that revealed is
that 2026 renames `autoPoints`/`teleopPoints` to `totalAutoPoints`/
`totalTeleopPoints`.

That knowledge was used for exactly one decision: **do not build any component
split on hardcoded breakdown field names**, and restrict the model to
`totalPoints`/`foulPoints`, which were verified present in all seasons. This is
a strictly conservative constraint — it removed a family of model designs rather
than tuning one toward the holdout — but it is a real glance at holdout schema
and is recorded here rather than left implicit.
