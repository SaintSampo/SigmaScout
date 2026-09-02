# Context — per-team variance decomposition ("variance OPR")

The published ± must mean "how reliable is this robot." Two estimators were measured
against synthetic ground truth (60 teams, true per-team sigma spanning 3-25 pts,
`scratchpad/variance_opr.ts`) and BOTH fail the same way: they compress the differences
between robots so severely the display cannot communicate them.

## The measurement that decides this

Ideal estimator: r = 1.000, slope = 1.000. Slope is what matters — it is whether a robot
twice as erratic as another actually *reads* twice as erratic.

**Full season (60 matches/team):**

| estimator | r | slope | RMSE |
|---|---|---|---|
| even-split contribution SD | 0.865 | **0.179** | 6.76 |
| filter R (`max(0, e² − ΣP)/n`) | 0.867 | **0.312** | 5.15 |
| variance-OPR, ridge 0 | 0.861 | **1.032** | 4.11 |
| **variance-OPR, ridge 10** | 0.860 | **0.871** | **3.62** |

**One event (12 matches/team) — the realistic hard case:**

| estimator | r | slope | RMSE |
|---|---|---|---|
| even-split contribution SD | 0.564 | 0.201 | 7.34 |
| filter R | 0.562 | 0.342 | 5.68 |
| **variance-OPR, ridge 10** | 0.550 | **0.558** | 6.43 |

Two conclusions:

1. **All three estimators have the same correlation with truth** (~0.86 full season,
   ~0.55 one event). The ranking information is limited by the DATA, not the estimator.
   Variance-OPR does not make the ± smarter.
2. **Only variance-OPR gets the SCALE right.** At slope 0.18, a true 3-to-25 point spread
   renders as a ~4-point band — every robot looks equally consistent, which defeats the
   entire purpose. At slope 0.87 the displayed range matches the real one. It also has the
   best RMSE of any estimator at a full season.

That is the whole case for this work: not better rankings, a number a human can read.

## D-V1 — the model (LOCKED)

Under independence, for an alliance-observation `m` with residual `e_m`:

    E[e_m²] = sum over teams i in alliance m of sigma_i²

Linear in the unknowns with a 0/1 team-membership design matrix — structurally identical
to OPR, with squared residuals as the target and variance as the unknown. Solve by least
squares. Clamp negatives to 0 (variances cannot be negative); a proper NNLS would be
better and is a documented future refinement, not a blocker.

## D-V2 — ridge must be centred on the league mean, not zero (LOCKED)

Measured: shrinking toward zero drags every team's variance toward "perfectly
consistent" and wrecks both the mean and the scale (at ridge 100, mean estimate 6.2
against a true 11.6). Centring on the league mean variance preserves the mean exactly
(11.7 vs 11.6) at every ridge level.

    (X'X + lambda·I)·beta = X'y + lambda·vBar,  vBar = mean over rows of e²/n

Light ridge only. Measured slope by lambda at a full season: 1.03 (0), 0.87 (10),
0.35 (100), 0.14 (1000). **lambda ~10 is the operating point** — near-best slope, best
RMSE. Anything at 100+ reintroduces exactly the league-blending the user rejected.

Note this IS shrinkage, which the user rejected for the old display. The distinction to
preserve honestly: the retired blend was `matchCount/(matchCount+8)`, giving a 12-match
team ~40% league. A lambda-10 ridge on a 40-team event solve is far lighter. Quantify the
effective league weight it implies and put that number in the doc comment, so the claim
"this is about this robot" stays checkable rather than asserted.

## D-V3 — RESOLVE THIS FIRST: solve scope, and the state-size problem

`X'X` is teams × teams. Season-scoped over ~3,500 teams is 12M entries — far past the
90,000-byte D1 seed row limit that already constrained the previous task. Options:

**(a) Event-scoped solve.** ~40 teams per event → a 40×40 system, trivial to store and
solve. Matches `opr.ts`'s existing event-scoped precedent exactly, and arguably matches
what a scout wants ("how reliable was this robot *at this event*"). Downside: a team's ±
resets per event and ignores its history.

**(b) Season-scoped, sparse.** Teams only co-appear with ~50-100 others, so `X'X` is
sparse. More faithful, materially more machinery, and the sparse structure still has to
survive D1 serialization.

**(c) Event-scoped solves, pooled across events per team.** Solve per event (cheap), then
combine a team's per-event variance estimates into a season figure.

**Recommendation: (a) for the first implementation**, with (c) named as the follow-up. It
reuses an established pattern in this codebase, sidesteps the state-size problem entirely,
and the synthetic result at 12 matches/team (slope 0.558) is exactly the event-scoped
case, so it is the configuration that was actually validated. If you disagree after
reading `opr.ts`, say why explicitly.

## D-V4 — this is display-only (LOCKED)

`predict()`/`update()` keep `P + R` and must be BITWISE unchanged — verify, do not assert.
The decomposition feeds `teamMetrics`'s published `spread` only. It is therefore NOT
tunable by Brier (a display quantity cannot move a prediction), so `lambda` must be a
documented constant with its value justified by the synthetic recovery test, and must be
added to the search-space exclusion list with its reason as data, like the other nine.

## Honest limitations to document, not hide

- Correlation with truth is ~0.86 at a full season and ~0.55 at one event. The ± is a
  genuinely noisy estimate of robot consistency, especially early. The user has already
  accepted this ("humans reading the website will see a team has only played a few
  matches, and will understand") — but the doc comment must state it rather than implying
  the number is precise.
- The residual `e_m` carries mean-model error as well as robot noise, so the estimate
  absorbs some of the filter's own inaccuracy. Measured: with 20 pts of mean-model noise
  the mean estimate inflates from 9.8 to 13.9. Name it.

## Scope

**In:** the decomposition module + its solve, wiring into `teamMetrics`'s `spread`,
removing P and the old shrinkage from the display, deleting `shrinkagePriorMatches`, the
`SIGMA1_CODE_VERSION` bump and both re-promotions, and the synthetic recovery test as a
permanent guard.

**Note:** commit `96e38754` already folded per-match contributions into Sigma1 state (from
the halted 260902-disp task). Decide whether the decomposition needs it, supersedes it, or
should sit alongside it — do not leave two overlapping mechanisms.

**Out:** `apps/web` (owned by another agent). Republishing artifacts — that stays blocked
until this lands, which is the point. EPA and OPR.

## Verification bar

- Synthetic recovery: slope within [0.7, 1.2] against known sigma at a full season, and
  the two incumbents measurably worse on slope — committed as a test with a seeded PRNG.
- The user's own example as an executable test: a robot at 50, 50 publishes a smaller ±
  than one at 30, 70.
- `predict()` output bitwise unchanged on a real replay slice.
- The effective league weight implied by the chosen lambda, measured and documented.
