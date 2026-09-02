# Context — the published ± becomes robot consistency

User decision, 2026-09-02. Two concerns had been collapsed into one field:

- **the model's** predictive uncertainty (`P + R`) — correct for predicting a match
- **the display's** job — telling a human how reliable a robot is

`teamMetrics` published the first. The user wants the second:

> "What +/- needs to show is NOT how certain the model is of the prediction. it needs to
> show a variable humans can understand about how reliable a robot is. A robot that
> scores 50 points in 2 matches is more reliable than a robot that scores 30 and then
> 70 points."

**None of this can affect prediction accuracy.** `predict()`/`update()` never read the
display path — verified: `shrinkConsistency` has exactly one call site, in `teamMetrics`,
and the re-screen measured `shrinkagePriorMatches` at a Brier range of exactly 0.000e+0
because it is structurally incapable of reaching a prediction. The match path keeps
`P + R` unchanged; it needs it.

## D-D1 — drop P from every published spread (LOCKED)

`spread` currently is `√(P + R)` at all three levels (per-component line ~1262,
TOTAL ~1273, phase groups ~1311). P is the filter's uncertainty about the team's MEAN —
epistemic, shrinks with more observations, says nothing about the robot. Remove it from
the published number at every level. Keep it in `predict()`.

Note this reverses D-01 (plan 07-06), which deliberately ADDED P and is recorded in
`teamMetrics`'s doc comment as "a locked, one-way user decision". That comment must be
rewritten, not merely appended to — and it should record that the reversal is itself a
user decision, with the reasoning above, so the next reader does not re-add P.

## D-D2 — no league blending in the displayed number (LOCKED)

`shrinkConsistency` blends a team's own consistency toward the league average by
`matchCount / (matchCount + shrinkagePriorMatches)` — at 8, roughly 40% of a 12-match
team's displayed component spread is the AVERAGE robot, not that robot. The user wants
this robot's own data only.

Consequences to handle:
- `shrinkConsistency` loses its only call site. Delete it and its tests, or keep it only
  if something else genuinely needs it — do not leave a live-looking unused export.
- `shrinkagePriorMatches` becomes a dead parameter. Delete it from `Sigma1Params`. That is
  a SHAPE change: `Sigma1ParamsSchema` is `z.strictObject`, so every committed version file
  must be retired and re-promoted, and `SIGMA1_CODE_VERSION` bumps 4.0.0 -> 5.0.0. Follow
  the precedent `params.ts` documents and the `--from-version` path added in 260901-trz.
- The retune running now searches 9 survivors that do NOT include `shrinkagePriorMatches`
  (it did not survive the screen), so removing it does not invalidate those results.
- A thin-history team now shows a spread from very few matches. That is the accepted cost
  of the user's decision — but see D-D4: it must not be able to render a fake-precise or
  degenerate value.

## D-D3 — publish each robot's per-match inferred contribution (LOCKED)

So the ± is checkable rather than asserted. The user asked whether this could be computed
in the browser; the honest constraint is that **FRC never records an individual robot's
score** — TBA publishes alliance totals and alliance-level breakdowns only (the project's
own Assumption A1). So there is no observed per-robot series; any such number is
model-inferred, and the artifact must label it that way rather than implying it is measured.

## D-D4 — RESOLVE THIS FIRST: what exactly is the published number?

Two coherent designs. **Pick one and make the whole task consistent with it.**

**(a) `± = √R` from the filter**, with the per-match series published alongside as
illustration. Simple, reuses the innovation-based estimator already shipped. Risk: the
series' own standard deviation will NOT equal the published ±, because R is estimated as
`max(0, innovation² − ΣP)/n` while a naive SD of contributions estimates
`(ΣP + R)/n²`. A scout who checks the number will find it disagrees with the series
under it, which is worse than not publishing the series at all.

**(b) `± = the standard deviation of the published contribution series`**, computed the
way a human would compute it. The displayed number and the series agree BY CONSTRUCTION,
which is the whole point of publishing the series. This is also literally what the user
described ("just 1 SD across the metrics"). It diverges from the filter's internal R —
which is fine and expected: the model keeps `P + R` for prediction; the display gets a
plain, checkable statistic.

**Recommendation: (b).** It is the only option where "here is the number, and here are the
matches behind it" is self-consistent. If the planner disagrees after reading the code, it
must say why explicitly rather than defaulting to (a) because it is less work.

Under (b), define the per-match contribution precisely and defend the definition. The
natural one, consistent with the error-split attribution EPA now uses:
`contribution(team, match) = team's mean before the match + (observed alliance total −
predicted alliance total) / n`. State the alternative(s) considered and why this one.

## Cross-cutting

- **In:** `sigma1/index.ts` (`teamMetrics`), `sigma1/params.ts`, `sigma1/consistency.ts`,
  the published artifact schema (`harness/pageArtifacts.ts`), whatever writes the team
  artifact, the version bump and both re-promotions, and tests.
- **Out of scope:** `predict()`/`update()` behaviour — must be BITWISE unchanged, and that
  must be verified, not asserted. EPA and OPR. The running re-tune.
- **`apps/web` is owned by another agent** — do not edit it. If the artifact schema gains a
  field, the site can adopt it later; ship the data first.
- A degenerate guard is still required: a team with one match, or several identical
  contributions, must not publish `± 0` (a claim of perfect reliability). Decide and
  document the floor or the minimum-matches rule — but it must be an honest presentational
  rule, not the league average smuggled back in.

## Verification bar

- `predict()` output bitwise unchanged across a real replay slice.
- The published ± equals the SD of the published series for the same team, to floating
  point, on real data (under design (b)).
- A team whose contributions are 50, 50 publishes a smaller ± than one whose are 30, 70 —
  the user's own example, as an executable test.
- No unused exports left behind; no doc comment describing the retired composition.
