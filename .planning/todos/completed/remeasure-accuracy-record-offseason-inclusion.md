---
id: remeasure-accuracy-record-offseason-inclusion
created: 2026-08-28
source: 07-17-PLAN.md Task 4 (D6), routed forward at 07-19 Task 4
resolves_phase:
priority: high
---

# Re-measure the accuracy record under the offseason-inclusive publish methodology

## What

Re-run the walk-forward accuracy/Brier-score measurement that produced `docs/models/`'s and
`data/baselines/`'s committed figures, under the SAME `--include-offseason` scope that
`pnpm publish:seasons` now uses for every published artifact (07-17's D-18 change, PD-02).

## Why

07-17's full republish widened `buildSeasonStream` to include offseason and preseason matches —
**20,055 additional played matches (+23.8% over the 84,339 regular-season matches) now enter the
walk-forward replay**, and 6,729 of 17,670 team-seasons (38%) carry at least one played offseason
match and therefore publish different numbers than before. `docs/models/` and `data/baselines/`
were both measured on the narrower, offseason-EXCLUDED stream and have never been re-run against
the wider one.

This is a genuine divergence between what is published (the enlarged, offseason-inclusive model)
and what the project's own accuracy claims (Brier score, winner accuracy, the SC-3 comparison
against OPR/EPA) were measured against. Every accuracy figure currently in `docs/models/` describes
a model that no longer matches what ships.

## Acceptance

- Re-run the walk-forward evaluation harness with `--include-offseason` across 2022-2026.
- Re-measure Brier score and winner accuracy for OPR, EPA, and VPR (the renamed Sigma1) against the
  same holdout structure SC-3 originally used.
- Publish the re-measured figures in `docs/models/` and `data/baselines/`, dated, beside (not over)
  the existing offseason-excluded figures — matching this project's own standing convention of never
  overwriting a frozen measurement record.
- State plainly whether the offseason-inclusive figures move any conclusion SC-3 or the Compare page
  currently rests on (a widened, noisier training/eval stream is a plausible source of some
  degradation; whether it is real or noise is exactly what this re-measurement answers).

## Related

- 07-17-SUMMARY.md, finding D6 (first disclosed this divergence)
- `.planning/phases/07-event-pages/07-17-PLAN.md` PD-02 (the offseason-inclusive command-scope
  decision this divergence is a consequence of)
- `docs/publish-budget.md`'s "Latest run" section (2026-08-28), which names this divergence and
  states it is "a standing finding routed forward, not resolved here"
- [[exclude-offseason-demo-teams]] — a SEPARATE, later-discovered exclusion (FRC team numbers
  9970-9999 are not real teams) that also changes the model's input set and should be folded into
  this same re-measurement pass rather than re-measuring twice (see that todo's own "Sequencing"
  note, added 2026-08-29)

## Scheduled

Not yet assigned to a phase. Land before any future accuracy claim (a new SC criterion, a Compare
page change, or a tuning re-run) is made against the currently-published, offseason-inclusive
model.
