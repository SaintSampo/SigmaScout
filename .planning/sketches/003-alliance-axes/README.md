---
sketch: 003
name: alliance-axes
question: "Does the interval-axis idea from 001-C extend to match predictions — and does each alliance want its own axis or a shared one?"
winner: null
tags: [match-prediction, uncertainty, phase-6, phase-7, alliance]
---

# Sketch 003: Alliance axes on match predictions

## Why this exists

Direct user request after sketch 001:

> "I like the choice to display Axis from C. lets use that more. for example on a match page, we can
> display each alliance on its own axis."

Grounded in real scope rather than invented: **TEAM-05** (Phase 6) requires each event section to list a
team's matches with "predicted winner, confidence, predicted scores, predicted RP ± variance, actual
scores, and actual RP". **EVNT-05** (Phase 7) wants alliance combined metrics. **ALGO-07** already
guarantees Sigma predictions carry variance. So this is the display for data the pipeline is already
committed to producing.

## The data is real

Three actual matches from `v1/event/2025new/sigma1@2.0.0+tuned-2026-08.json`, chosen to span the range:

| Match | Prediction | Actual | Why it is here |
|---|---|---|---|
| SF 10m1 | 235 vs 235, pRed 0.493 | 203–248 blue | A true coin flip — the case a point estimate cannot express |
| QM 13 | 295 vs 116, pRed 1.000 | 279–167 red | A blowout — total separation |
| QM 43 | 126 vs 200, pRed 0.005 | 154–132 **red** | **The model was confidently wrong.** Called blue at 99.5% |

QM 43 is the important one. A tool claiming "honest uncertainty" has to be able to show its own misses,
and a design that only looks good on correct predictions is not honest.

## THE FINDING — a pipeline gap, not a design question

**Building this uncovered that the visualization needs a number the artifact does not publish.**

- **D-10** defines a match prediction's ± as the **full predictive variance** — estimate uncertainty
  *plus* performance spread (`P + Q + R`). It is explicitly a different quantity from the team-page ±
  (D-09, match-to-match consistency).
- The harness **computes exactly that** — `packages/core/algorithms/sigma1/linkFunctions.ts` uses it to
  produce `pRedWin`.
- **`EventMatchSchema` in `packages/harness/pageArtifacts.ts` does not publish it.** The event artifact
  carries `predictedRedScore`, `predictedBlueScore`, `pRedWin`, and per-component `mean`/`variance` —
  and no match-level predictive variance.

So the widest honest band a client can currently draw is `sqrt(sum of component variances)`, which omits
the performance-spread term. This sketch uses that, and it is visibly too narrow: the actual result falls
7σ out on SF 10m1 and ~10σ out on QM 13. **That is the missing term, not a broken model** — the win
probabilities shown alongside are computed from the correct variance internally.

**Action for Phase 6/7 planning: publish match-level predictive variance on the event artifact.** Without
it, any interval display of a match prediction is either wrong or has to be dropped. Cheap to add — the
number already exists at compute time.

## Variants

| | Direction | Trade |
|---|---|---|
| **A** | Both alliances on one shared axis | The overlap *is* the win probability, drawn rather than asserted. Compact. Reading each alliance's own range is slightly harder |
| **B** | One row per alliance, common scale | Easier per-alliance reading, natural place to hang team chips / component breakdown / predicted RP. Costs vertical room; the overlap must be inferred |

Both keep a **single shared scale**. Two independent scales would be a dual-axis chart — equal-looking
bands would mean different things, which is the most common charting mistake and is explicitly disallowed.

## Colour note (checked, not assumed)

FRC's red/blue alliance convention is non-negotiable domain vocabulary, and red/green-deficient vision is
the common case — so it was validated rather than trusted: `#DC2626` vs `#2563EB` returns **ΔE 29.9 under
protanopia** (target ≥ 8) and passes lightness, chroma, and contrast. The convention is safe as-is. Team
numbers are still colour-coded *and* positionally grouped, so identity never rests on colour alone.

## Open questions for the reviewer

1. **A or B?** A makes the differentiator legible; B scales better as more per-alliance detail arrives in
   Phases 6–7.
2. **Should the actual result appear on the same axis?** It is drawn here as a triangle under the axis.
   It makes misses obvious — arguably the most honest thing on the page, and arguably noise for upcoming
   matches where there is no actual yet.
3. **What happens for an upcoming match** (no actual)? The axis still works, but the page needs a
   deliberate empty treatment rather than a gap.
4. Untested on a phone. 620px of plot does not fit a 390px screen — the axis likely needs to become a
   compact two-row form on mobile.

## Files

- `index.html` — both variants, tab-switchable, with the variance caveat stated on the page itself
- `data.js` — the three real matches
- `preview-{a,b}.png`
- Theme: `../themes/default.css`
