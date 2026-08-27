---
id: publish-match-predictive-variance
created: 2026-08-25
source: sketch 003-alliance-axes
resolves_phase: 7
priority: high
---

# Publish match-level predictive variance on the event artifact

## What

Add D-10's full predictive variance (`P + Q + R`) for each alliance's predicted
score to `EventMatchSchema` in `packages/harness/pageArtifacts.ts`, and populate
it in `publish.ts`.

## Why

Uncovered while sketching the alliance-axis match display (`.planning/sketches/003-alliance-axes/`).

- **D-10** defines a match prediction's ± as the full predictive variance —
  estimate uncertainty *plus* performance spread. It is explicitly a different
  quantity from the team-page ± (D-09, match-to-match consistency).
- The harness **already computes it**:
  `packages/core/algorithms/sigma1/linkFunctions.ts` consumes it to produce
  `pRedWin` (mode 2/3 of D-12's link function).
- **It is never published.** `EventMatchSchema` carries `predictedRedScore`,
  `predictedBlueScore`, `pRedWin`, and per-component `mean`/`variance` — and no
  match-level variance.

The consequence is concrete: a client cannot draw an honest interval for a match
prediction. The widest quantity available is `sqrt(sum of component variances)`,
which omits the performance-spread term and is badly too narrow — against three
real 2025new matches the actual result landed ~7σ out on SF10m1 and ~10σ out on
QM13. The model is not broken; the published data is incomplete.

**This blocks TEAM-05** (Phase 6: "predicted RP ± variance" per match) and any
Phase 7 alliance display that wants to show uncertainty.

## Acceptance

- `EventMatchSchema` carries a match-level predictive variance (or sd) per
  alliance, and the same for `upcoming` matches.
- Value matches what `linkFunctions.ts` consumed to produce that row's `pRedWin`
  — assert it in a test rather than recomputing it independently, so the two can
  never drift.
- A spot-check across a season shows actual scores falling inside ±1σ at roughly
  the expected rate. If they do not, that is a genuine calibration finding and
  belongs in the record — D-10 already names the calibration curve as the check.
- `docs/publish-budget.md` re-measured: this adds two numbers per match across
  ~2,943 event artifacts.

## Related

- D-09 / D-10 in `.planning/phases/02-prediction-models-epa-sigma1/02-CONTEXT.md`
- D-12 (link function modes) — same variance feeds it
- `.planning/sketches/003-alliance-axes/README.md` — the display that needs it

## Scheduled

**Folded into Phase 7 (Event Pages)** — user decision at `/gsd-plan-phase 7` gate,
2026-08-27. The Quals/Elims tabs (EVNT-04, EVNT-06) render predicted scores next
to actuals, and D-10's ± is the honest uncertainty those rows are supposed to
carry, so the schema + publish change belongs inside this phase rather than
ahead of it.

Combine the resulting R2 republish with
[[republish-playoff-bonus-arrays]] — both rewrite `team/{teamKey}/{year}` and
event artifacts, and one ~23-min pass should serve both.
