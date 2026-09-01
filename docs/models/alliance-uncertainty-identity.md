# The alliance-uncertainty identity, verified at the same walk-forward instant

**Date:** 2026-08-31 · **Verdict: HOLDS** — 120/120 compared pairs within a rounding-derived
tolerance, 0 skipped · **Resolution of todo `publish-as-of-match-team-metrics`, with no new
published field**

## The question

Does an alliance's combined uncertainty — `√(Σ picksᵢ spreadᵢ²)` over its three playing teams —
equal that match's own published `redScoreVarianceOwn`/`blueScoreVarianceOwn`, when both sides are
measured at the **same** walk-forward instant?

07-20's original e2e attempt said no (99/99 pairs beyond tolerance), but that check compared
as-of-EVENT per-team spreads against as-of-THAT-MATCH alliance variances — two different instants,
with the telltale first-half/second-half gap collapse (mean 1.130 → 0.373) of a walk-forward
timing mismatch, not a math defect. The identity was unfalsifiable from the bytes as read.

## The insight that closed it without a republish

The team-season artifact's `metricHistory` rows carry each metric **after** each match
(`MetricHistoryRowSchema`'s own contract), and a team's state changes only when that team plays —
so a team's state immediately **before** match M is exactly its row for its own **previous** match.
The as-of-match quantity the todo asked to publish was already derivable from published bytes by a
two-artifact join. Publishing an as-of-match sibling field was therefore **deliberately rejected**:
the event artifact sits 2.17% under its 350,000-byte ceiling post-08-05, and this join costs zero
payload.

## Method

`scripts/verifyAllianceUncertaintyIdentity.ts` (credential-free, public-origin fetches with
cache-busting, same discipline as `mockRankDistribution.ts`):

1. For each of the todo's own four events — `2024new`, `2023cur`, `2024casf`, `2025flta` — fetch
   the VPR event artifact and every playoff team's `team/{teamKey}/{year}` artifact.
2. For every played playoff match (`qf`/`sf`/`f`) and each alliance side: locate each playing
   team's metricHistory row for the match itself, step back one row (pre-match state), and read
   `metrics.total.spread`.
3. Compare `Σ spreadᵢ²` against the match's published `scoreVarianceOwn` for that side.

**Tolerance is derived, not assumed:** each published spread is rounded to
`ROUNDING_RULE.metric` (2 decimals, half-step 0.005) so each squared term carries up to
`2·s·h + h²` of rounding error; summed over three teams, plus the variance field's own
`ROUNDING_RULE.variance` (4-decimal) half-step.

## Result

| Measure | Value |
|---|---|
| Compared pairs (4 events, both sides, all played playoff matches) | 120 |
| Skipped — no published varianceOwn | 0 |
| Skipped — no usable pre-match history row | 0 |
| Mean \|gap\| | 0.0376 variance units |
| Max \|gap\| | 0.1247 variance units |
| Breaches beyond tolerance | **0 / 120** |

The residual gaps are rounding-sized, exactly as the additivity identity plan 07-06 pinned against
`predict()`'s own output (published `total.spread = √(P + R)`; `scoreVarianceOwn = Σ Pᵢ +
covarianceTotal`, whose covariance blocks are per-team). No covariance-term residual
(`covEwmaAlpha`/`covShrinkage`) shows up at this precision — intra-team component covariance is
already inside each team's published spread, and cross-team terms are not modeled.

## Limitations

- Four events, playoff matches only (the todo's own scope: "at least the matches an event's
  playoff alliances play"). Qual-match pairs would need the same join against much larger row sets;
  nothing suggests they would behave differently, but they were not measured here.
- The check reads the currently-published generation (post-08-05). A pre-republish artifact
  (played rows without the 08-05 fields) still parses but was not part of this sample.
- `metricHistory` rows are per-algorithm; only VPR was checked (OPR/EPA publish no spread at all).

## Supersedes

- The corrected monotone-narrowing check in `apps/web/e2e/event-live-artifact.spec.ts` remains as
  the always-on e2e guard; this measurement is the stronger, same-instant claim the todo asked for.
