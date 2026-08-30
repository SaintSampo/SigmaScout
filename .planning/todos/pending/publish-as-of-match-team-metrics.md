---
id: publish-as-of-match-team-metrics
created: 2026-08-29
source: 07-20-PLAN.md Task 2 (ledger row 9), routed forward after developer review
resolves_phase:
priority: medium
---

# Publish each team's metrics as-of-each-match, so the alliance-uncertainty identity can be tested

## What

`EventTeamSchema.metrics` (the event artifact's `teams[]` array) publishes each team's metrics
AS-OF-EVENT — state after the event's LAST chronological match, per `publish.ts`'s own D-10 comment
on `metricsAsOfEvent`. There is no published quantity giving a team's metrics AS-OF-A-SPECIFIC-MATCH
(the walk-forward state immediately before that match was played), except indirectly through each
match's own `redScoreVarianceOwn`/`blueScoreVarianceOwn` (an ALLIANCE-level aggregate, not a
per-team value).

## Why

07-20's `event-live-artifact.spec.ts` originally tried to check a numeric identity: does an
alliance's combined uncertainty (`sqrt(sum of its first-3-picks' TeamMetric.spread squared)`, using
the published, as-of-event `metrics.total.spread`) equal that alliance's own published per-match
variance (`redScoreVarianceOwn`/`blueScoreVarianceOwn`, computed walk-forward, as-of-that-match)?

Measured against real `2024new`/`2023cur`/`2024casf`/`2025flta` data: **99/99 found pairs exceed a
derived 0.02 tolerance**, by 0.03 to 2.04 sigma units. A developer-run direct check (280
alliance-pairs across 140 matches at `2024new`) confirmed the cause: the mean gap is 1.130 in the
first half of the event and 0.373 in the second half — a ~3x collapse, exactly the signature of
comparing two quantities measured at DIFFERENT points in the walk-forward, not a data defect or a
covariance effect. **The identity as originally conceived is unfalsifiable from currently published
bytes** — there is no published, as-of-that-match per-team spread to compare against a specific
match's own variance.

07-20's spec was corrected to assert the provable, monotone-narrowing relationship instead (see
`apps/web/e2e/event-live-artifact.spec.ts`, ledger row 9). The TRUE identity — same-instant
per-team spread vs. that instant's alliance-level variance — remains untested and unactionable until
this gap closes.

## Acceptance

- Publish (or make derivable from an existing published quantity) each team's `total` metric
  spread AS OF a specific match's prediction time, for at least the matches an event's playoff
  alliances play — the walk-forward state immediately before that match, not the event-final state.
- With that quantity available, re-attempt the alliance-uncertainty identity
  (`sqrt(sum of first-3-picks' as-of-that-match spread squared)` vs. that match's own
  `redScoreVarianceOwn`/`blueScoreVarianceOwn`) and assert it holds within a rounding-derived
  tolerance, or document a genuine residual (e.g. from Sigma1/VPR's `covEwmaAlpha`/`covShrinkage`
  inter-team covariance terms) if it still does not.
- Consider whether this is worth a new page-artifact field at all, or whether the existing
  monotone-narrowing check (already shipped) is sufficient evidence for the product's needs —
  publishing a new as-of-match per-team quantity has its own payload-budget cost
  (`docs/publish-budget.md`) that should be weighed against what it actually buys.

## Related

- `apps/web/e2e/event-live-artifact.spec.ts` — the corrected, monotone-narrowing test this todo
  supersedes with a stronger claim once the data exists.
- `packages/harness/publish.ts`'s `metricsAsOfEvent`/D-10 comment — the existing as-of-event
  semantics this todo asks to add an as-of-match sibling to.
- `.planning/phases/07-event-pages/07-20-SUMMARY.md` — the full measured accounting.
