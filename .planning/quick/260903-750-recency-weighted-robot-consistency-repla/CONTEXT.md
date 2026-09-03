# Context — Y becomes recency-weighted robot consistency

## What Y is FOR (user stories, from the developer)

1. **Alliance selection, top seed.** Two robots, same X. Alliance 1 picks the
   **lower Y** — they need a robot that turns up the same every match.
2. **Alliance selection, low seed.** Two robots, same X. Alliance 8 picks the
   **higher Y** — they need variance to have any shot at Alliance 1.
3. **Mid-quals.** Team A must judge whether its partner will score reliably (so A
   can chase a bonus objective) or cannot be relied on (so A must maximise points).

Read those carefully, because they settle three things:

- Y is about **the robot's own match-to-match swing**, not the model's confidence.
- **A blank Y is useless.** Story 2 needs a HIGH Y to be visible; an omitted cell
  serves nobody. Never-blank is now a hard requirement, not a nicety.
- Y must be **comparable between two robots** and readable **in points**.

The developer explicitly allows Y to be a **heuristic**, and asks that recent
matches count for more than old ones.

## D-Y1 — the definition (LOCKED, data-driven)

    Y = SCALE * sqrt( recency-weighted mean of that team's past squared
                      per-match contribution deviations )

with a per-observation decay giving a **half-life of 6 matches**, and
**SCALE = 1.92**.

A team's per-match contribution deviation is its share of the alliance's residual,
`(observed - predicted) / n` — the quantity the filter already computes as the
innovation. Deviations are already centred (they are residuals), so the
weighted RMS **about zero** is the estimator; no running mean is subtracted.

### Both constants were measured, not chosen

Half-life, swept against how well Y predicts a team's ACTUAL deviation in its next
match (walk-forward: Y built only from strictly earlier matches), 275,172
team-matches over 2024-2026:

    half-life   1.5     2      3      4      6      8      12     20     flat
    corr        .5694  .5788  .5876  .5911  .5930  .5927  .5909  .5879  .5794

6 wins. **Decay beats a flat average by 2.3%** — real, and modest; record it as
modest rather than overselling it.

Scale, measured NON-circularly on 86,844 alliance-observations: if `Y_i` is really
robot i's own swing then `sqrt(Ya^2 + Yb^2 + Yc^2)` should equal the alliance's
residual magnitude, which IS observable. Regressing gives **1.92**.

A first attempt at this regressed a team's even-split deviation on its own past
even-split deviations and returned ~1.0. That was CIRCULAR — it predicted a
quantity from past values of the same quantity — and is recorded here so nobody
re-derives it and trusts the answer.

Note 1.92 against the independence-assumption prediction of `sqrt(3) = 1.73`. The
excess is D-06's independent-teams assumption failing: teammates' performances
correlate, so an alliance swings more than three independent robots would. The
measured constant absorbs that instead of assuming it away. Say so in the code.

### The honest ceiling

`r ~= 0.59` is how well ANY estimator predicts a robot's next-match swing from
alliance-only data. That is the data's limit, not this heuristic's shortfall, and
the doc comment must say so rather than implying precision.

## D-Y2 — never blank (LOCKED)

Deviations are centred, so a single observation is already a valid (noisy)
estimate of `E[dev^2]`. **Y is defined from a team's first match onward and is
never omitted.** No floor, no minimum-match threshold, no special case — the
developer has twice rejected those, and story 2 makes omission actively harmful.
A team with few matches shows a noisy Y; the site already shows its match count.

## D-Y3 — this REPLACES variance-OPR for display (LOCKED)

`teamMetrics` stops calling `solveEventVariance`. The ridge, `varianceOprRidge`,
the NNLS active-set solver and the per-event Gram accumulator all stop feeding the
published `±`.

State shrinks dramatically: from an n-by-n Gram matrix plus targets per event, to
**one running number per team per metric key**. The EWMA is O(1) per fold:
`running = w * running + (1 - w) * dev^2` with `w = 0.5^(1/6)`.

**Decide and state plainly whether `varianceOpr.ts` is deleted or kept.** If nothing
reads it, it is dead code — and dead code is exactly what this repo is currently
trying to shed. Recommendation: delete it, its tests, and its recovery test, since
git history preserves the work and a live-looking unused solver is a trap for the
next reader. If you keep it, say what still consumes it.

## D-Y4 — display-only; `predict()` must be bitwise unchanged (LOCKED)

`predict()`/`update()` keep `P + R` for win probability and never read this.
The gate: both re-promoted version files' `predictionStreamSha256` **character-
identical** to their current 6.0.0 values. A moved digest is stop-and-report.

`SIGMA1_CODE_VERSION` 6.0.0 -> 7.0.0. If the two constants become `Sigma1Params`
fields they must be added to `SEARCH_EXCLUSIONS` with their reason as data (they
are display-only and cannot move a Brier score, so they are not tunable); that is
a shape change and needs the frozen-legacy-schema + migration treatment the
`promote.ts` header documents. If they are module constants instead, say why.

## Verification bar

- **The developer's own stories, as executable tests.** Two robots with equal X:
  one whose matches are 50/50 publishes a strictly smaller Y than one whose are
  30/70. A robot that was erratic and has settled shows a falling Y within ~6
  matches (this is what the half-life buys, and it should be pinned).
- A team with exactly ONE match publishes a Y — never a blank, never `0 +/-`.
- Recency actually bites: the same multiset of deviations in a different ORDER
  gives a different Y, and the recent-heavy ordering dominates.
- `predict()` bitwise unchanged (D-Y4), verified not asserted.
- The published blank rate on real data is **0%**, measured the same way the
  34.9% (clamp) and 40.2% (NNLS) figures were, so the three are comparable.

## Scope

**In:** the new estimator and its wiring into `teamMetrics`, the state change, the
version bump and both re-promotions, the `varianceOpr.ts` deletion decision, and
every doc comment that describes the retired decomposition as the source of `±`.

**Out:** `predict()`/`update()` behaviour, `apps/web`, `apps/worker` beyond what the
state-shape change forces, EPA, OPR, republishing (a separate step), and the
rolling-origin re-tune.

## Follow-up to record, not to do here

Both constants were measured against `reports/is2-full` predictions, produced by an
earlier model version. Re-measure after the rolling-origin re-tune lands; the
half-life is unlikely to move much, the scale may.
