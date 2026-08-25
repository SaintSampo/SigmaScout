---
sketch: 003
name: alliance-axes
question: "How should match predictions with uncertainty be laid out — and at what scale?"
winner: C — event table on one shared scale
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

## DECISION — variant C (2026-08-25)

The first two drafts (per-match cards: both alliances on one axis, or one row each) were **both
rejected**. The user sketched the replacement, and the reason it is better is specific:

> "I dont like A or B. do something like this" — with a table: Match | Alliances | plot | Actual | Call,
> a single axis drawn once in the header, and *"one scale for the whole event"*.

**The drafts gave every match its own zoomed domain.** That made each row readable in isolation and
made every row incomparable to its neighbours — QM 13 (predicted 295/116) and QM 5 (147/165) rendered
at visually similar positions despite being ~150 points apart. A shared event-wide scale restores the
comparison: a high-scoring match sits visibly right of a low-scoring one, and a wide band is wide
relative to every other band on the page rather than only to itself.

It is also a **table, not a stack of cards** — far denser, and consistent with how the rest of the app
reads. Variant A is kept in the file for contrast so the reasoning stays legible.

What the layout encodes:

| Element | Meaning |
|---|---|
| Soft bar | predicted ±1σ for that alliance |
| Solid tick | predicted score |
| Ringed dot | actual score, in alliance colour |
| Actual column | the same numbers as text, for anyone not reading the plot |
| Call column | ✓ / ✗ — did the predicted winner match |

The overlap between the two bands still *is* the win probability, drawn rather than asserted, and a
miss reads as **distance** rather than as a word.

### Three corrections from review

1. **The actual dots were at the wrong heights.** Each dot's `top` was a hand-tuned constant passed
   separately from its band, and the two had drifted — red sat 4.5px high, blue 1.5px low. Fixed by
   *deriving* every y from the band position and shared geometry constants, so they cannot disagree
   again. Verified programmatically: 0 misaligned across all rows.
2. **The loser's NUMBER is grey — the dots are not.** First attempt greyed both; the user corrected it,
   and the correction is right. The two marks have different jobs: on the plot a dot carries *identity*
   ("which alliance is this"), so greying half of them breaks the encoding while duplicating what the
   Call column already says. In the Actual column the numbers are the *outcome*, so greying the loser
   there is doing real work — the column alone now answers "who won". Same visual device, different
   jobs; apply it where it matches the job.
3. **The two alliances of one match now group.** They were 12px apart in a 44px row against a similar
   between-match gap, so a dot landing far from its partner horizontally read as belonging to whichever
   row it was nearest. Tightened to **12px within a match against 47.3px between** (a 3.94× ratio), dot
   shrunk to 12px so the pair touch without overlapping, and a zebra tint added to reinforce the block.
   Proximity now does the grouping, which is the only thing that can.

## Variants

| | Direction | Status |
|---|---|---|
| **C** | Event table, one shared scale | **Selected** |
| **A** | Per-match cards, per-match domain | Superseded — kept for contrast |
| ~~B~~ | One row per alliance | Rejected with A |

A single shared scale is also the correct call structurally: two independent scales would be a
dual-axis chart, where equal-looking bands mean different things — the most common charting mistake.

## Colour note (checked, not assumed)

FRC's red/blue alliance convention is non-negotiable domain vocabulary, and red/green-deficient vision is
the common case — so it was validated rather than trusted: `#DC2626` vs `#2563EB` returns **ΔE 29.9 under
protanopia** (target ≥ 8) and passes lightness, chroma, and contrast. The convention is safe as-is. Team
numbers are still colour-coded *and* positionally grouped, so identity never rests on colour alone.

## Open questions for the reviewer

1. **Where does the shared domain come from?** Currently min/max across the visible matches. For a live
   event it should probably be fixed per season (so it does not shift as matches complete) — an open call.
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
