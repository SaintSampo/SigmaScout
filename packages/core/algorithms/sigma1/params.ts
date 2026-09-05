/**
 * Sigma1's tunable hyperparameter set (ALGO-04, ALGO-06, D-13). Every field
 * here is a Phase-2 constant turned into plain data: `makeSigma1` resolves
 * `options.params ?? DEFAULT_SIGMA1_PARAMS` once and threads it through
 * `predict`/`update`/`teamMetrics`/`carrySeason` (`sigma1/index.ts`) instead
 * of every module reading its own module-level constant directly. This is
 * what `packages/harness/tune.ts` searches over and `packages/harness/promote.ts`
 * commits as a named, versioned parameter set (D-13/D-14).
 *
 * `DEFAULT_SIGMA1_PARAMS` sources every field by IMPORTING the pre-existing
 * exported constant it replaces — never a re-typed literal — so the default
 * parameter set cannot silently drift from the Phase-2 behaviour it exists
 * to reproduce bitwise (this task's own must-have truth). Since 4.0.0 the
 * five SCALE-RELATIVE fields are DERIVED from those same imported constants
 * (`SIGMA1_PROCESS_NOISE_WITHIN_EVENT / SIGMA1_REFERENCE_SCORE_VARIANCE`, and
 * so on), which keeps that rule intact through the reparameterization: the
 * conversion map is visible in the source, and a relative default cannot
 * drift from the absolute behaviour it exists to reproduce.
 *
 * Scale-relative parameterization (D-T1, quick task 260901-trz, 2026-09-01).
 * Five fields are now DIMENSIONLESS fractions of the season's own realized
 * alliance-score variance rather than absolute point^2/point quantities. See
 * `SIGMA1_CODE_VERSION`'s 3.0.0 -> 4.0.0 block below for what moved and why,
 * `SIGMA1_REFERENCE_SCORE_VARIANCE` for the measured scale they are expressed
 * against, and `sigma1/scale.ts` for the one place they are resolved back
 * into absolute quantities.
 *
 * Module-placement note (deviation from a literal reading of the plan): the
 * three cold-start/fallback constants (`SIGMA1_COLD_START_TEAM_TOTAL`,
 * `SIGMA1_COLD_START_CONSISTENCY_VARIANCE`, `SIGMA1_FALLBACK_SCORE_SD`) and
 * `SIGMA1_CONSISTENCY_CARRY_DECAY` are defined HERE, not in `sigma1/index.ts`
 * as originally drafted, and `sigma1/index.ts` imports and re-exports them —
 * the same "leaf module owns the constant, index.ts imports it" shape
 * `kalman.ts`/`consistency.ts`/`covariance.ts`/`linkFunctions.ts` already
 * use. Defining them in `index.ts` and importing them back into this module
 * would make `index.ts` and `params.ts` import each other: `index.ts` needs
 * `Sigma1Params`/`DEFAULT_SIGMA1_PARAMS` for `Sigma1Options` and its
 * module-top-level `makeSigma1(...)` calls (`vpr`, `vprDefaults`,
 * ... — renamed by plan 07-16, D-04/D-05), while `params.ts` would need `index.ts`'s constants for
 * `DEFAULT_SIGMA1_PARAMS`'s own top-level object literal — a genuine ESM
 * import cycle where BOTH sides dereference the other's binding at
 * module-evaluation time, not inside a deferred function body. That throws
 * `ReferenceError: Cannot access '...' before initialization` (TDZ) at
 * runtime, in either import order, the first time this module graph is
 * loaded — not a style preference, a load-time crash. Keeping this module a
 * pure leaf (it imports only from `kalman.ts`/`consistency.ts`/`covariance.ts`/
 * `linkFunctions.ts`/`carryover.ts`/`swing.ts`, never from
 * `sigma1/index.ts`) is the only acyclic direction, matching this file's own
 * module-ownership discipline precedent in `carryover.ts`'s header.
 */
import { z } from "zod";
import { SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY, SIGMA1_PROCESS_NOISE_WITHIN_EVENT } from "./kalman.js";
import { SIGMA1_CONSISTENCY_EWMA_ALPHA, SIGMA1_MIN_CONSISTENCY_VARIANCE } from "./consistency.js";
// D-Y1 (7.0.0). `swing.ts` imports NOTHING AT ALL — it is a pure leaf with no
// dependencies whatever — so this edge is one-directional and cannot recreate
// the module-evaluation-time TDZ cycle this file's header warns about at
// length. Verified by reading that module's import list, not assumed. (The
// edge this replaced pointed at `varianceOpr.ts`, deleted at 7.0.0.)
import { SIGMA1_SWING_HALF_LIFE_MATCHES, SIGMA1_SWING_SCALE } from "./swing.js";
import { SIGMA1_COV_EWMA_ALPHA, SIGMA1_COV_SHRINKAGE } from "./covariance.js";
import { SIGMA1_LINK_C } from "./linkFunctions.js";
import { EPA_CARRY_LAST_YEAR_WEIGHT, EPA_CARRY_PRIOR_YEAR_WEIGHT, EPA_MEAN_REVERSION } from "../carryover.js";

/**
 * The code half of D-13's `{codeVersion}+{paramSetName}` version identity.
 * Bumped from Phase 2's `"1.0.0"` because parameterizing Sigma1 changes the
 * module's observable contract (a `makeSigma1` call site now accepts
 * `params`/`paramSetName`, and `version` is derived rather than hardcoded).
 *
 * Bumped `"2.0.0"` -> `"2.1.0"`
 * (`.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`,
 * 2026-08-30): `update()`'s observable output changed — a whole-alliance
 * disqualification with a recorded 0 score is now dropped as a rating
 * observation instead of fitted as real performance
 * (`isFullyDqZeroScoreAlliance`, `../dq.ts`) — the same `codeVersion` string
 * must never stand for two different computations (D-13's own invariant,
 * enforced live by `digest.test.ts`'s bitwise reproducibility check against
 * every committed `data/algorithm-versions/*.json` file). The two
 * previously-committed `vpr@2.0.0+*.json` files were retired and re-promoted
 * as `vpr@2.1.0+*.json` from the SAME search artifacts/params in the same
 * commit — this was a code fix, not a re-tune, so no new hyperparameter
 * search was needed.
 *
 * Bumped `"2.1.0"` -> `"3.0.0"` (quick task 260901-is2, D-Q2, 2026-09-01):
 * the measurement-noise estimator R changed. BOTH `update()`'s and
 * `teamMetrics`'s observable output moved — `update()` because R feeds the
 * Kalman gain from the second match onward, and `teamMetrics` because R is
 * one of the two terms behind every published `±`. R is now estimated from
 * INNOVATIONS (`max(0, innovation^2 - sum P) / n`, an unbiased sample given
 * `E[innovation^2] = sum P + R`) rather than from an EWMA of squared
 * gain-weighted residuals, which decayed toward its floor as the filter
 * converged and understated every published spread by roughly 5x. See
 * `consistency.ts`'s header for the derivation and the measured before/after.
 * MAJOR, not minor: this changes the published number on every team page,
 * not an edge case.
 *
 * The two `vpr@2.1.0+*.json` files were retired and re-promoted as
 * `vpr@3.0.0+*.json` in this SAME commit, by `pnpm promote` running the new
 * code — the same precedent the 2.0.0 -> 2.1.0 bump above records, and for
 * the same reason: a digest is only meaningful if the code that produced it
 * is the code that ships, and it is never hand-edited to make a failing
 * reproduction pass. Unlike that bump, `tuned-2026-08`'s re-promotion also
 * carries ONE parameter override — `linkC` 1.2398... -> 0.5, re-selected on
 * the tune seasons only, exactly how the promoted set was chosen — recorded
 * in that file's `provenance.paramOverrides`/`note` with
 * `objectiveAppliesToPromotedParams: false`, because the recorded objective
 * describes the search winner and not the shipped set.
 *
 * Bumped `"3.0.0"` -> `"4.0.0"` (quick task 260901-trz, D-T1/D-T2,
 * 2026-09-01): the parameter set's SHAPE changed, so no 3.0.0 file can be
 * parsed as a 4.0.0 one at all (`Sigma1ParamsSchema` is `z.strictObject`, and
 * five fields were renamed, two deleted and four added). D-T1 made five
 * hyperparameters DIMENSIONLESS fractions of the season's own realized
 * alliance-score variance; D-T2 merged the two unnormalized carry weights
 * into a single `carryPriorYearShare`.
 *
 * BOTH `update()`'s and `teamMetrics`'s observable output move. The measured
 * cause is D-T1's own motivation: the optimal process-noise multiplier tracks
 * each season's alliance-score variance (log-log regression r = 0.970,
 * slope = 0.90 across 2022-2026, whose variances span 718 to 20,164), so a
 * single absolute number tuned on 2022-2024 was badly wrong for 2026 and the
 * filter lagged an improving league — a +15.8% 2026 score-MAE regression that
 * Brier and SD(z) both rated equal-or-better. The effective process noise and
 * both variance floors now track each season's own scale instead. MAJOR, not
 * minor: this changes the shipped model on every page, not an edge case.
 *
 * The two `vpr@3.0.0+*.json` files were retired and re-promoted as
 * `vpr@4.0.0+*.json` in this SAME commit, by `pnpm promote --from-version`
 * running the new code — the same precedent both bumps above record, and for
 * the same reason: a digest is only meaningful if the code that produced it
 * is the code that ships, and it is never hand-edited to make a failing
 * reproduction pass. `--from-version` (rather than `--from`) exists because
 * the retired SEARCH artifacts record the old absolute field names — which
 * `z.strictObject` rejects outright — and because `tuned-2026-08`'s shipped
 * `linkC = 0.5` lives only as a `--set-param` override in the committed
 * version file, not in the search log. Promoting from the committed FILE is
 * what carries that correction forward; promoting from the search artifact
 * would have silently dropped it.
 *
 * Bumped `"4.0.0"` -> `"5.0.0"` (quick task 260902-varopr, D-V1/D-V2/D-V3/D-V4,
 * 2026-09-02): the published `±` became the PER-TEAM VARIANCE DECOMPOSITION
 * (`sigma1/varianceOpr.ts`, deleted at 7.0.0 — see git history), solved per
 * event on a `vBar`-centred ridge, rather than `sqrt(P + R)`.
 *
 * The parameter set's SHAPE changed, so no 4.0.0 file parses as a 5.0.0 one at
 * all (`Sigma1ParamsSchema` is `z.strictObject`; `shrinkagePriorMatches` was
 * deleted and `varianceOprRidge` added).
 *
 * `teamMetrics`'s observable output MOVED, and `predict()`'s and `update()`'s
 * DID NOT. That second half is the central constraint of the task rather than
 * a remark, and it is not asserted: both `vpr@4.0.0+*.json` files were retired
 * and re-promoted as `vpr@5.0.0+*.json` in THIS SAME COMMIT via
 * `pnpm promote --from-version` running the new code, and each new file's
 * `digest.predictionStreamSha256` reproduces its retired predecessor's
 * CHARACTER FOR CHARACTER —
 * `380c598065c72897e8c7a944b6de77a32a69177eab7ff7541d386cb83e7783fb` for
 * `tuned-2026-08` and
 * `38d091e0377272244a3ddaf4eb8ff1b3c9e318f8db466d20fff479be99029a1c` for
 * `tracer-check`, with both headline Brier/accuracy pairs identical too.
 * Neither digest was hand-edited; `computePredictionStreamDigest` hashes
 * exactly `[matchKey, pRedWin, redScore, blueScore]`, so reproducing it IS the
 * proof that `predict()` is bitwise unchanged.
 *
 * MAJOR, not minor: this changes the number on every team page. WHY it changed
 * is measured rather than argued — against known synthetic sigma the retired
 * `sqrt(P + R)` recovers a SLOPE of 0.312, compressing a true 3-to-25 point
 * spread into a ~4-point band so every robot reads as equally consistent; the
 * decomposition recovers 0.79-0.94 at equal correlation and better RMSE. That
 * evidence lived in `varianceOpr.ts`'s header and `varianceOpr.recovery.test.ts`,
 * both deleted at 7.0.0; `git show` at that commit's parent is the record.
 *
 * Bumped `"5.0.0"` -> `"6.0.0"` (quick task 260903-5dp, D-N1/D-N2/D-N3/D-N4,
 * 2026-09-03): the variance decomposition now solves a NON-NEGATIVE least
 * squares problem (Lawson-Hanson active set) instead of solving unconstrained
 * and applying a post-hoc `Math.max(0, x)`. Variances are non-negative BY
 * DEFINITION, so constraining `beta >= 0` DURING the fit is the more correct
 * estimator; the clamp answered the wrong question and then edited the answer.
 *
 * The parameter SHAPE is UNCHANGED — no field was added, removed or renamed,
 * and a 5.0.0 file's `params` validates against the current
 * `Sigma1ParamsSchema` untouched. This bump exists solely because D-13 forbids
 * one `codeVersion` string standing for two different computations, and the
 * OUTPUT changed. It is therefore the first bump with a `--from-version` path
 * that records NO `paramShapeMigration` (`promote.ts`'s `5.` branch), which is
 * the honest statement that nothing was migrated.
 *
 * `teamMetrics`'s observable output MOVED and `predict()`'s / `update()`'s did
 * NOT — the same display-only constraint 5.0.0 carried, verified the same way
 * rather than asserted. Both `vpr@5.0.0+*.json` files were retired and
 * re-promoted as `vpr@6.0.0+*.json` in THIS SAME COMMIT via
 * `pnpm promote --from-version` running the new code, and each new file's
 * `digest.predictionStreamSha256` reproduces its retired predecessor's
 * CHARACTER FOR CHARACTER —
 * `380c598065c72897e8c7a944b6de77a32a69177eab7ff7541d386cb83e7783fb` for
 * `tuned-2026-08` and
 * `38d091e0377272244a3ddaf4eb8ff1b3c9e318f8db466d20fff479be99029a1c` for
 * `tracer-check`, unchanged from 5.0.0, with both headline Brier/accuracy pairs
 * identical too. Neither digest was hand-edited.
 *
 * MAJOR, not minor: this changes the number on every team page. AND IT CHANGES
 * COVERAGE IN THE UNEXPECTED DIRECTION, which is recorded here because a
 * version block that only listed the good half would be the drift this project
 * keeps failing on. Measured over the full 2026 season, published cells with no
 * `±` went 34.9% -> 40.2% (19,436 -> 22,412 of 55,770; 214 cells gained a `±`,
 * 3,190 lost one). The solve is verified KKT-optimal on those same real
 * systems — strictly lower constrained objective in 3,715 of 3,795, higher in
 * zero — so this is a property of the correct estimator, not a defect in it:
 * forbidding a negative `beta` removes the slack that let a co-appearing
 * teammate carry an inflated positive one. NOTHING WAS REPUBLISHED on the
 * strength of it. The published artifacts still carry the 5.0.0 numbers, and
 * the display decision (`0 ±`, fall back to `vBar`, or keep omitting) was left
 * as an open product question. 7.0.0, immediately below, ANSWERS it — with none
 * of the three, by retiring the estimator that raised it.
 *
 * Bumped `"6.0.0"` -> `"7.0.0"` (quick task 260903-750, D-Y1/D-Y2/D-Y3/D-Y4,
 * 2026-09-03): the published `±` is no longer a variance decomposition at all.
 * It is now each team's OWN RECENCY-WEIGHTED SWING (`sigma1/swing.ts`) —
 *
 *     Y = swingScale * sqrt( recency-weighted mean of that team's past squared
 *                            per-match contribution deviations )
 *
 * with a half-life of 6 matches — and the whole per-event solve behind the two
 * previous versions is DELETED, `varianceOpr.ts` with it.
 *
 * WHY, AND IT IS THE USER'S QUESTION RATHER THAN A STATISTICAL ONE. The `±`
 * answers one thing: is this robot the same robot every match? Alliance 1 wants
 * the low number, Alliance 8 wants the high one, and a mid-quals partner needs
 * to know which it is playing beside. The decomposition RANKED robots well but
 * could not always SPEAK: a team whose constrained fit pinned at exactly 0
 * published no `±` at all, because there `0` meant "the solve could not support
 * a positive variance" and printing it would have been a false claim of perfect
 * consistency. That is precisely the low-consistency robot Alliance 8 is
 * hunting for, blanked. 6.0.0 made it WORSE by making the solve more correct.
 *
 * THE COVERAGE NUMBER, measured identically to the two it replaces — one
 * 2022-2026 replay with season carry, promoted `tuned-2026-08` params, counting
 * published cells for every 2026 team against its own last event:
 *
 *     34.9%  (19,436 / 55,770)  5.0.0, unconstrained solve + post-hoc clamp
 *     40.2%  (22,412 / 55,770)  6.0.0, Lawson-Hanson NNLS
 *      0.0%  (0 / 55,785)       7.0.0, recency-weighted swing
 *
 * Teams missing at least one cell: 97.7% -> 98.8% -> 0.0% (0 of 3,719).
 *
 * The denominator moved by ONE TEAM — 3,718 x 15 keys to 3,719 x 15 — and that
 * is recorded rather than rounded away, because a silently-shifting denominator
 * is how a coverage comparison stops meaning anything. The cause is the corpus,
 * not the code: 2026 is the live season and the earlier rows were measured
 * against an ingest one team smaller. It does not touch the reading. Zero is
 * zero against either denominator, and the 15-cell difference is 0.03% of it.
 *
 * THE 0% IS STRUCTURAL, NOT TUNED. There is no floor, no minimum-match rule and
 * no coverage fallback anywhere in `swing.ts` — the developer rejected such a
 * rule twice. Deviations are residuals and therefore already centred about
 * zero, so ONE observation is already a valid (noisy) estimate of `E[dev^2]`
 * and the estimator is defined from a team's first match onward. The single
 * remaining `undefined` case is a key that was never folded, i.e. a team that
 * has not played, which no denominator here contains.
 *
 * BOTH CONSTANTS WERE MEASURED, and `swing.ts` carries the evidence. The
 * half-life was swept walk-forward over 275,172 team-matches against how well
 * the estimate predicts a team's ACTUAL next-match deviation (6 wins at
 * r = 0.5930; a flat no-decay control scores 0.5794, so DECAY HELPS BY 2.3% —
 * real, and modest). The scale, 1.92, was regressed NON-CIRCULARLY on 86,844
 * alliance-observations against the one per-robot-adjacent quantity that is
 * actually observable, the alliance's own residual magnitude. Both are
 * display-only and both are named in `searchSpace.ts`'s `SEARCH_EXCLUSIONS`
 * with their reason as data.
 *
 * The parameter SHAPE changed, so no 6.0.0 file parses as a 7.0.0 one
 * (`Sigma1ParamsSchema` is `z.strictObject`; `varianceOprRidge` was deleted and
 * `swingHalfLifeMatches`/`swingScale` added). `legacyParams.ts` gains a frozen
 * `Legacy6Sigma1ParamsSchema` and `migrate6to7`, reached by `promote.ts`'s new
 * `6.` branch — which, unlike the `5.` branch it replaces, DOES record a
 * `paramShapeMigration` tag, because this hop genuinely drops a field and adds
 * two.
 *
 * `teamMetrics`'s observable output MOVED and `predict()`'s / `update()`'s did
 * NOT — the same display-only constraint 5.0.0 and 6.0.0 each carried, verified
 * the same way rather than asserted. Both `vpr@6.0.0+*.json` files were retired
 * and re-promoted as `vpr@7.0.0+*.json` in THIS SAME COMMIT via
 * `pnpm promote --from-version` running the new code, and each new file's
 * `digest.predictionStreamSha256` reproduces its retired predecessor's
 * CHARACTER FOR CHARACTER —
 * `380c598065c72897e8c7a944b6de77a32a69177eab7ff7541d386cb83e7783fb` for
 * `tuned-2026-08` and
 * `38d091e0377272244a3ddaf4eb8ff1b3c9e318f8db466d20fff479be99029a1c` for
 * `tracer-check`, unchanged since 5.0.0, with both headline Brier/accuracy
 * pairs identical too. Neither digest was hand-edited.
 *
 * `update()` IS ALSO VERIFIED UNCHANGED, and by a stronger instrument than the
 * digest: `displayOnly.test.ts` hashes the post-fold and post-carrySeason
 * filter state against a fixture generated ONCE, before 260902-varopr, and that
 * fixture WAS NOT REGENERATED for this task. With the new `swing` field
 * excluded — for exactly the reason `perEventVariance` was excluded at 5.0.0 —
 * both hashes still reproduce character for character. Two successive
 * display-estimator swaps have now been judged against one unregenerated
 * baseline.
 *
 * MAJOR, not minor: this changes the number on every team page. NOTHING HAS
 * BEEN REPUBLISHED on the strength of it — the live artifacts still carry the
 * 5.0.0 numbers, as they did after 6.0.0. Republishing is a separate step.
 *
 * ONE HONEST LIMIT, recorded here rather than left to be rediscovered: both
 * constants were measured against `reports/is2-full` predictions, produced by
 * an EARLIER model version. Re-measure after the rolling-origin re-tune lands.
 * The half-life sits on a plateau (the sweep is flat between 4 and 12) and is
 * unlikely to move much; the scale may.
 *
 * Bumped `"7.0.0"` -> `"8.0.0"` (D-7, quick task 260904-6a1, 2026-09-04):
 * `update()`'s observable output changed for two distinct, unrelated
 * model-correctness reasons — see `epa.ts`'s identical 3.0.0 -> 4.0.0 bump
 * comment for the shared investigation (`2026bc2_sf14m1`, a genuine
 * ~456-point alliance zeroed to 0 by `adjustPoints: -456` with no DQ flags):
 *
 *   1. `isAdjustZeroedAlliance` (`../dq.ts`) — combined with the existing
 *      `isFullyDqZeroScoreAlliance` into one per-alliance ruling-zero
 *      boolean, applied at both `applyAllianceUpdate`'s per-alliance seam
 *      and the `allianceScoreStats` fold. This required moving
 *      `redUpdateTeams`/`blueUpdateTeams`'s derivation below
 *      `tryParseBreakdownPair` in `update()`, since the new predicate needs
 *      the parsed breakdown's `adjust` value.
 *   2. `adjust` is now PINNED at exactly `{ mean: 0, variance: 0 }` for
 *      every team, in every match: `applyAllianceUpdate`'s per-component
 *      loop returns early for it (leaving belief/residual/innovation/
 *      variance-sample slots untouched), the post-loop consistency and
 *      swing folds skip it (so it is the one key that never publishes a
 *      `±`), `coldStartTeamState` seeds it directly rather than through
 *      `leagueMeanFor`/`seedConsistencyFor`, `applyTeamProcessNoise` never
 *      grows its variance, and both the cold-start and `carrySeason`
 *      divisors exclude it (`modeledComponentCount`) so a cold-start team's
 *      seeded total is unchanged.
 *
 * The parameter set's SHAPE is UNCHANGED — no field was added, removed or
 * renamed, so a 7.0.0 file's `params` still validates against the current
 * `Sigma1ParamsSchema` (`promote.ts`'s `7.` branch shares the current shape
 * with no migration, since no parameter changed in this bump).
 *
 * `update()`'s observable output MOVED (both changes above) and, through it,
 * `predict()`'s reported score moves too wherever a team's carried `adjust`
 * belief was previously nonzero. `teamMetrics`'s published `±` also moves for
 * any team whose swing accumulator previously folded an `adjust` deviation.
 * MAJOR, not minor: change 2 alone moves every team's component vector in
 * every match ever replayed (adjust was previously folded like any other
 * component), not an edge case.
 *
 * All three `vpr@7.0.0+*.json` files (`+rolling-2026-09`, `+tracer-check`,
 * `+tuned-2026-08`) were retired and re-promoted as `vpr@8.0.0+*` in this same
 * commit via `pnpm promote --from-version` running the new code — the same
 * precedent every prior bump above records, and for the same reason: a digest
 * is only meaningful if the code that produced it is the code that ships.
 *
 * `displayOnly.test.ts`'s bitwise-freeze claim (predict()/update() unchanged,
 * 5.0.0 through 7.0.0) is DELIBERATELY BROKEN by this bump, and its three
 * enforcement assertions are marked superseded rather than silently made to
 * pass — see that file's own dated header addendum. This is the first
 * SIGMA1_CODE_VERSION bump since that file was written that is a genuine model
 * change rather than a display-only one.
 *
 * NOT BUMPED at ELIM-R/ELIM-OFF (D-3, quick task 260904-v9n, 2026-09-04),
 * and that non-bump is RECORDED here — deliberately, not left as an absence a
 * future reader could mistake for an oversight. This task added three new
 * `Sigma1Params` fields (`elimObservationNoiseMultiplier`,
 * `elimScoreOffsetEnabled`, `elimScoreOffsetEwmaAlpha`, both new mechanisms
 * living in `sigma1/elim.ts`) and a new `Sigma1State.elimScoreOffset`
 * accumulator. Applying this file's own two triggers, the ONLY two anything
 * above has ever bumped on:
 *
 *   (a) the parameter SHAPE changed such that `z.strictObject` makes an old
 *       file unparseable — does NOT fire here. All three new fields carry
 *       Zod `.default(...)` (D-2), so every already-committed
 *       `vpr@8.0.0+*.json` file — none of which carries these keys — still
 *       parses unchanged and resolves to the inert values
 *       (`elimObservationNoiseMultiplier: 1`, `elimScoreOffsetEnabled:
 *       false`, `elimScoreOffsetEwmaAlpha: 0.05`). This is DIFFERENT from
 *       every prior SHAPE-changing bump above (4.0.0, 5.0.0, 7.0.0), which
 *       each required `--from-version` re-promotion because a `strictObject`
 *       parse of an old file would fail outright; a schema DEFAULT is what
 *       makes the identical kind of addition non-breaking this time.
 *   (b) the observable OUTPUT changed — does NOT fire here either. Both
 *       mechanisms are provably inert at their defaults: `elimNoiseFactor`
 *       returns EXACTLY `1` on the qualification branch and
 *       `params.elimObservationNoiseMultiplier` (default `1`) on every
 *       elimination branch, so the composed `measurementNoiseMultiplier` is
 *       bitwise unchanged; `elimScoreOffsetFor` returns EXACTLY `0` whenever
 *       `elimScoreOffsetEnabled` is `false` (the default), so `predict()`'s
 *       `+ 0` is exact and `update()`'s fold never runs at all — the
 *       accumulator's STATE stays at cold start, not merely its published
 *       output. `params.test.ts`'s identity tests assert byte-identical
 *       prediction streams end to end, the same instrument every prior
 *       "provably inert when off" claim in this file (`adaptationEnabled`,
 *       D-08) has used.
 *
 * Neither trigger fires, so `8.0.0+{paramSetName}` still denotes EXACTLY ONE
 * computation before and after this task — D-13's own invariant, which is
 * precisely what a bump exists to protect. `digest.test.ts` reproducing all
 * four committed `vpr@8.0.0+*.json` prediction-stream digests AND headline
 * metrics BITWISE under this new code is the evidence, not an assertion: the
 * same instrument every prior bump used to justify BUMPING, here used to
 * justify NOT bumping.
 *
 * THE MOMENT EITHER MECHANISM IS ENABLED in a promoted parameter set — a
 * nonzero `elimObservationNoiseMultiplier` deviation from `1` that a re-tune
 * selects, or `elimScoreOffsetEnabled: true` — that promotion IS a real model
 * change (trigger (b) fires: the observable output moves) and earns its own
 * `SIGMA1_CODE_VERSION` bump under this block's normal rules, exactly as
 * `adaptationEnabled`'s own still-unpromoted on-arm would if it ever shipped
 * enabled. This task only REGISTERS the knobs; tuning and enabling either one
 * is explicitly out of scope (see this task's own `<objective>`).
 */
export const SIGMA1_CODE_VERSION = "8.0.0";

/**
 * The scale D-T1's five dimensionless hyperparameters are expressed against:
 * the MATCH-COUNT-WEIGHTED MEAN of the realized expanding alliance-score
 * variance over the 2022-2024 tune pool, folded exactly the way `update()`
 * folds `state.allianceScoreStats` (both alliances per match, a
 * whole-alliance-DQ zero excluded, a fully-demo match skipped whole, and
 * NEVER reset at a season boundary).
 *
 * MEASURED 2026-09-01 by `pnpm reparam:equivalence --mode reference`
 * (`scripts/reparamEquivalence.ts`) over 48,037 tune-season matches; the
 * derivation, the per-season breakdown and the three sanity checks that
 * confirm it is the intended quantity are recorded in
 * `docs/models/sigma1-reparameterization.md`. That is, by definition, the
 * scale the previously promoted ABSOLUTE parameters actually operated at, so
 * `rel = absolute / V_ref` preserves their average absolute value over the
 * pool they were tuned on.
 *
 * THIS IS A FIXED HISTORICAL MEASUREMENT, NOT A KNOB. Re-measuring it later
 * and editing it in place would silently rescale the meaning of every
 * committed `data/algorithm-versions/*.json` file at once, because it has
 * exactly two consumers and they must never disagree:
 * `DEFAULT_SIGMA1_PARAMS`'s relative defaults below, and
 * `packages/harness/legacyParams.ts`'s `migrateAbsoluteToScaleRelative`
 * divisor. If those two ever sat on different references, the defaults and
 * the shipped set would be on different scales and nothing would say so.
 *
 * It lives HERE, not in `scale.ts`, for the reason this file's header already
 * gives for the cold-start constants (leaf module owns the constant), plus a
 * specific one: `DEFAULT_SIGMA1_PARAMS`'s own object literal dereferences it
 * at MODULE-EVALUATION time, so importing it from `scale.ts` would recreate
 * exactly the TDZ import cycle that header warns about.
 */
export const SIGMA1_REFERENCE_SCORE_VARIANCE = 1028.2155111415093;

/**
 * A cold-start team's typical total contribution to an alliance's score, in
 * point units (mirrors `epa.ts`'s `EPA_INIT_TYPICAL_TEAM_SHARE` reasoning
 * exactly — a flat, documented placeholder scaled down to a defensible
 * per-component seed, corrected within a handful of matches by the Kalman
 * gain once real observations arrive). Used only when the LEAGUE's own
 * running mean for a component has no data yet (`sigma1/index.ts`'s
 * `Sigma1League.componentMean`) — once any team anywhere has been observed,
 * new cold-start teams seed from that live league average instead of this
 * fixed constant. Phase 3 hyperparameter, default unverified.
 *
 * NO LONGER READ ON THE UPDATE PATH since 4.0.0 (D-T1). It is the ABSOLUTE
 * value `DEFAULT_SIGMA1_PARAMS.coldStartTeamTotalRel` is DERIVED from, at
 * `SIGMA1_REFERENCE_SCORE_VARIANCE` — which is precisely why it must not be
 * deleted — but the value the filter applies is now
 * `coldStartTeamTotalRel * sigma` (LINEAR in sigma, not squared: this is a
 * point total, not a variance), resolved per call by
 * `scale.ts`'s `resolveSigma1Params`.
 */
export const SIGMA1_COLD_START_TEAM_TOTAL = 20;

/**
 * Fallback consistency VARIANCE (points^2) for a component the league has
 * never observed a sample for yet — the same role `EPA_FALLBACK_SCORE_SD`
 * plays for EPA's win-probability scale, applied here to Sigma1's own
 * measurement-noise/spread estimate instead. Phase 3 hyperparameter, default
 * unverified.
 *
 * KNOWN STALE since `SIGMA1_CODE_VERSION` 3.0.0 (D-Q2, quick task
 * 260901-is2). 25 (an SD of 5) was tuned against the RETIRED estimator,
 * which ran roughly 5x small in SD terms — so this cold-start seed is now
 * plausibly about an order of magnitude too small in variance terms against
 * the innovation-based R it seeds. It is deliberately LEFT UNCHANGED here:
 * moving it without a search would be a guess, and a full joint re-tune
 * under the new estimator is a filed follow-up.
 *
 * THAT FOLLOW-UP IS NOW NAMED: it is quick task 260901-trz's rolling-origin
 * re-tune. The staleness argument above stands unchanged, and 4.0.0's
 * reparameterization does not fix it — `coldStartConsistencyVarianceRel`'s
 * default is this same 25 divided by `SIGMA1_REFERENCE_SCORE_VARIANCE`, so it
 * reproduces the same (stale) behaviour on the tune seasons by construction.
 * What DID change is that `searchSpace.ts`'s bound for the relative field is
 * deliberately widened so the re-tune can actually REACH the order of
 * magnitude this paragraph says is plausibly needed; the retired absolute
 * bound could not. This sentence is that follow-up's anchor in the code.
 *
 * NO LONGER READ ON THE UPDATE PATH since 4.0.0 (D-T1), for the same reason
 * `SIGMA1_COLD_START_TEAM_TOTAL` above is not: it is the ABSOLUTE value
 * `DEFAULT_SIGMA1_PARAMS.coldStartConsistencyVarianceRel` is DERIVED from, at
 * `SIGMA1_REFERENCE_SCORE_VARIANCE`, and the value the filter applies is now
 * `coldStartConsistencyVarianceRel * sigma^2`.
 */
export const SIGMA1_COLD_START_CONSISTENCY_VARIANCE = 25;

/** Fallback alliance-score SD before at least 2 alliance-score observations exist this season (mirrors `epa.ts`'s `EPA_FALLBACK_SCORE_SD`). Phase 3 hyperparameter, default unverified. */
export const SIGMA1_FALLBACK_SCORE_SD = 25;

/**
 * D-17: how far a carried-over consistency estimate decays at a season
 * boundary before the empirical-Bayes shrinkage (D-11) even applies — since
 * `carrySeason` also resets `matchCount` to 0, `shrinkConsistency` will
 * fully weight the league prior immediately after a carry regardless of this
 * value; what this constant controls is how quickly the CARRIED value stops
 * mattering as the new season's own observations accumulate. Phase 3's tuner
 * is explicitly allowed to shrink this to 0 if the carried consistency
 * signal turns out not to be real (D-17's own wording). Phase 3
 * hyperparameter, default unverified.
 */
export const SIGMA1_CONSISTENCY_CARRY_DECAY = 0.5;

/**
 * Every tunable Sigma1 hyperparameter, as plain data threaded through
 * `makeSigma1` (`sigma1/index.ts`) rather than read as a module constant.
 * Every field is a `readonly number` (bar `adaptationEnabled`) — this is a
 * data declaration, not behaviour.
 *
 * Since 4.0.0 (D-T1) the interface splits three ways, and the split is worth
 * knowing before reading any individual field:
 *
 *   - Five `*Rel` fields are DIMENSIONLESS fractions of the season's own
 *     realized alliance-score variance (or, for `coldStartTeamTotalRel`, its
 *     standard deviation). No helper ever reads them: `scale.ts`'s
 *     `resolveSigma1Params` turns them into absolute quantities exactly once
 *     per public entry point, and `Sigma1ResolvedParams` `Omit`s them so the
 *     type system — not a convention — enforces that.
 *   - The `rp*` process-noise and cold-start fields are ABSOLUTE, because RP
 *     threshold variables are COUNTS rather than points (F3).
 *   - Everything else is dimensionless already (rates, shares, exponents,
 *     clamps) or is `fallbackScoreSd`, which stays absolute because it is the
 *     bootstrap for the very scale the `*Rel` fields are expressed against.
 */
export interface Sigma1Params {
  /**
   * D-07/D-T1 process-noise magnitude for two matches within the SAME event,
   * as a DIMENSIONLESS FRACTION of the season's own realized alliance-score
   * variance: the filter injects `processNoiseWithinEventRel * sigma^2` per
   * match, where `sigma` is `standardDeviation(state.allianceScoreStats,
   * fallbackScoreSd)`. Default DERIVED from `kalman.ts`'s
   * `SIGMA1_PROCESS_NOISE_WITHIN_EVENT / SIGMA1_REFERENCE_SCORE_VARIANCE`,
   * never re-typed. Resolved to an absolute quantity in exactly one place
   * (`scale.ts`'s `resolveSigma1Params`) and never read directly by a helper.
   */
  readonly processNoiseWithinEventRel: number;
  /** D-07/D-T1 process-noise magnitude injected at an EVENT BOUNDARY, as a dimensionless fraction of the season's alliance-score variance (see `processNoiseWithinEventRel`). Default DERIVED from `kalman.ts`'s `SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY / SIGMA1_REFERENCE_SCORE_VARIANCE`. */
  readonly processNoiseEventBoundaryRel: number;
  /** EWMA rate for `consistency.ts`'s `foldConsistencyVariance` innovation-based variance fold (D-Q2; was `foldConsistency`'s squared-residual fold before 3.0.0). Sourced from `consistency.ts`'s `SIGMA1_CONSISTENCY_EWMA_ALPHA`. Phase 3 hyperparameter, default unverified. */
  readonly consistencyEwmaAlpha: number;
  /**
   * D-Y1 (quick task 260903-750): the half-life, IN MATCHES, of the published
   * `±`'s recency weighting. MEASURED, not chosen: swept 1.5/2/3/4/6/8/12/20
   * against how well the estimate predicts a team's ACTUAL deviation in its
   * next match, walk-forward over 275,172 team-matches, and 6 wins
   * (r = 0.5930). A FLAT average — no decay at all — scores 0.5794, so decay
   * genuinely helps but only by 2.3%; record that as modest rather than
   * overselling it. `swing.ts` derives the per-observation decay from this
   * rather than storing it, because the half-life is the number that was
   * measured and the number a reader can reason about.
   *
   * Display-only, therefore search-excluded — see `searchSpace.ts`.
   */
  readonly swingHalfLifeMatches: number;
  /**
   * D-Y1: the multiplier that puts the published `±` into TRUE POINTS.
   *
   * A team's per-match deviation is its share of the alliance residual,
   * `(observed - predicted) / n`, which is systematically smaller than the
   * robot's own swing. MEASURED non-circularly on 86,844 alliance-observations:
   * if `Y_i` is really robot i's swing then `sqrt(Ya^2+Yb^2+Yc^2)` must equal
   * the alliance's residual magnitude, which IS observable. Regressing gives
   * 1.92.
   *
   * Note against the independence-assumption prediction of `sqrt(3) = 1.73`:
   * the excess is D-06's independent-teams assumption FAILING — teammates
   * correlate, so an alliance swings more than three independent robots would.
   * This constant absorbs that rather than assuming it away.
   *
   * A first attempt regressed a team's even-split deviation on its OWN past
   * even-split deviations and returned ~1.0. That was CIRCULAR — it predicted a
   * quantity from past values of the same quantity — and is recorded here so
   * nobody re-derives it and believes the answer.
   *
   * Display-only, therefore search-excluded.
   */
  readonly swingScale: number;
  /** D-T1: floor applied to every shrunk consistency VARIANCE, as a dimensionless fraction of the season's alliance-score variance — `minConsistencyVarianceRel * sigma^2` is what `consistency.ts`'s `shrinkConsistency` actually receives. Default DERIVED from `consistency.ts`'s `SIGMA1_MIN_CONSISTENCY_VARIANCE / SIGMA1_REFERENCE_SCORE_VARIANCE`. */
  readonly minConsistencyVarianceRel: number;
  /** EWMA rate for `covariance.ts`'s `ewmaCovarianceSample` fold step (D-Q2; `ewmaCovariance` was the update path's entry point before 3.0.0 and now delegates to it). Sourced from `covariance.ts`'s `SIGMA1_COV_EWMA_ALPHA`. Phase 3 hyperparameter, default unverified. */
  readonly covEwmaAlpha: number;
  /** Constant shrinkage toward the diagonal applied inside `covariance.ts`'s `ewmaCovarianceSample`. Sourced from `covariance.ts`'s `SIGMA1_COV_SHRINKAGE`. Phase 3 hyperparameter, default unverified. */
  readonly covShrinkage: number;
  /** D-12's default `c` for mode 2's (`predictive-variance`) win-probability denominator scale. Sourced from `linkFunctions.ts`'s `SIGMA1_LINK_C`. Phase 3 hyperparameter, default unverified. */
  readonly linkC: number;
  /**
   * D-T1: a cold-start team's typical total contribution to an alliance's
   * score, as a dimensionless fraction of the season's alliance-score
   * STANDARD DEVIATION. Scaling is LINEAR (`coldStartTeamTotalRel * sigma`),
   * not squared, because this is a point total rather than a variance — the
   * two scalings are one character apart in `scale.ts` and `scale.test.ts`
   * has a dedicated test that tells them apart. Default DERIVED from this
   * module's own `SIGMA1_COLD_START_TEAM_TOTAL / sqrt(SIGMA1_REFERENCE_SCORE_VARIANCE)`.
   */
  readonly coldStartTeamTotalRel: number;
  /** D-T1: fallback consistency VARIANCE for a component the league has never observed a sample for yet, as a dimensionless fraction of the season's alliance-score variance. Default DERIVED from this module's own `SIGMA1_COLD_START_CONSISTENCY_VARIANCE / SIGMA1_REFERENCE_SCORE_VARIANCE` — see that constant's own doc comment for why it is KNOWN STALE under the D-Q2 estimator, and why the reparameterization does not fix that. */
  readonly coldStartConsistencyVarianceRel: number;
  /**
   * Fallback alliance-score SD before at least 2 alliance-score observations
   * exist. Sourced from this module's own `SIGMA1_FALLBACK_SCORE_SD`.
   * Phase 3 hyperparameter, default unverified.
   *
   * D-T1: this field STAYS ABSOLUTE, deliberately. It is the bootstrap value
   * for sigma ITSELF, used when fewer than two alliance scores have been
   * folded, so it cannot be expressed as a fraction of the quantity it stands
   * in for. Consequence, recorded rather than hidden: at 25 a cold-start
   * state resolves to a scale of 625, roughly 0.61x
   * `SIGMA1_REFERENCE_SCORE_VARIANCE`, so the very first matches of 2022 run
   * slightly tight — a bounded, transient, documented deviation the expanding
   * statistic erases within a few dozen matches. Do NOT "fix" this by setting
   * it to `sqrt(SIGMA1_REFERENCE_SCORE_VARIANCE)`; that would be an
   * unrequested retune of the bootstrap, and D-T1 changed nothing about this
   * parameter's value.
   */
  readonly fallbackScoreSd: number;
  /** D-17: how far a carried-over consistency estimate decays at a season boundary. Sourced from this module's own `SIGMA1_CONSISTENCY_CARRY_DECAY`. Phase 3 hyperparameter, default unverified. */
  readonly consistencyCarryDecay: number;
  /**
   * D-04: Sigma1's OWN tunable copy of how far a carried-over rating reverts
   * toward the rookie baseline at a season boundary — never read by
   * `carryover.ts`'s frozen `epaCarryover` (EPA stays pinned at Statbotics'
   * published `EPA_MEAN_REVERSION`, D-04). Sourced from `carryover.ts`'s
   * `EPA_MEAN_REVERSION` as this field's default ONLY. Phase 3
   * hyperparameter, default unverified.
   *
   * D-T2: this is now the SOLE shrinkage control for the season-boundary
   * carry. The retired `carryLastYearWeight`/`carryPriorYearWeight` pair was
   * UNNORMALIZED, so its SUM also controlled overall shrinkage — duplicating
   * this parameter's job — while only its RATIO asked a distinct question.
   * With `carryPriorYearShare` the blend weights always sum to 1 and the
   * carried magnitude is preserved, leaving shrinkage entirely to this field.
   */
  readonly carryMeanReversion: number;
  /**
   * D-04/D-T2: Sigma1's own tunable SHARE of the blend given to the season
   * BEFORE last when carrying a rating across a season boundary —
   * `blended = (1 - share) * lastYear + share * yearBefore`, in [0, 1].
   *
   * Replaces the retired `carryLastYearWeight`/`carryPriorYearWeight` pair
   * (D-T2): two parameters carrying one new degree of freedom plus a
   * duplicate of `carryMeanReversion`. Default `0.3` reproduces the retired
   * `0.7 * lastYear + 0.3 * yearBefore` blend EXACTLY, and is DERIVED from
   * `carryover.ts`'s own frozen EPA pair
   * (`EPA_CARRY_PRIOR_YEAR_WEIGHT / (EPA_CARRY_LAST_YEAR_WEIGHT + EPA_CARRY_PRIOR_YEAR_WEIGHT)`)
   * rather than re-typed, so it cannot drift from the blend it reproduces.
   */
  readonly carryPriorYearShare: number;
  /**
   * D-T1/F3: process-noise magnitude for two matches within the SAME event,
   * for the RP THRESHOLD VARIABLES (`rp/state.ts`). ABSOLUTE, and deliberately
   * separate from the score side's now-relative pair.
   *
   * The dimensional argument, which is the whole reason this field exists:
   * RP threshold variables are COUNTS (notes, links, cages, tower points) on
   * roughly a 0-20 scale, not alliance points. Multiplying their process
   * noise by an alliance-SCORE variance — which reaches ~20,000 in 2026 —
   * would inject several hundred times the variable's own range as noise per
   * match. That is a category error, not a conservative choice. Before 4.0.0
   * `rp/state.ts` read the score-side pair directly; the split is what keeps
   * RP's Kalman step bitwise unchanged across the reparameterization.
   *
   * Rejected alternative, recorded so it is not rediscovered as an oversight:
   * scale each threshold variable's noise by that variable's OWN league SD
   * (`rpVariableMean`). Dimensionally correct, and deferred — it would CHANGE
   * RP dynamics, which the reparameterization has no mandate to do.
   *
   * Default sourced from `kalman.ts`'s `SIGMA1_PROCESS_NOISE_WITHIN_EVENT`,
   * i.e. exactly the absolute value RP used before 4.0.0.
   */
  readonly rpProcessNoiseWithinEvent: number;
  /** D-T1/F3: the RP threshold variables' own EVENT-BOUNDARY process noise, ABSOLUTE — see `rpProcessNoiseWithinEvent` for the dimensional argument. Default sourced from `kalman.ts`'s `SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY`. */
  readonly rpProcessNoiseEventBoundary: number;
  /**
   * D-T1/F3: the cold-start belief VARIANCE for an RP threshold variable the
   * league has never observed (`rp/state.ts`'s `coldStartRpTeamState` and its
   * lazy per-variable cold start). ABSOLUTE, for exactly the dimensional
   * reason `rpProcessNoiseWithinEvent` records — a count-scale variable
   * seeded with a fraction of a ~20,000 alliance-score variance would claim
   * an initial spread hundreds of times its own range.
   *
   * Before 4.0.0 `rp/state.ts` read `params.coldStartConsistencyVariance`,
   * which is now relative; without this field RP's Kalman step would NOT be
   * bitwise unchanged, which D-T1's own verification bar requires it to be.
   * Default sourced from this module's own
   * `SIGMA1_COLD_START_CONSISTENCY_VARIANCE` — exactly the absolute value RP
   * used before 4.0.0.
   */
  readonly rpColdStartVariance: number;
  /** D-16/D-11: the seed for the RP joint-model's Monte Carlo draw (plan 03-03) — a VERSIONED parameter, not an implementation detail, since "unchanged means bitwise identical" requires the seed to be part of the committed parameter set. */
  readonly rpMonteCarloSeed: number;
  /** D-16/D-11: the number of Monte Carlo draws the RP joint model takes (plan 03-03) — versioned alongside the seed for the same reason. */
  readonly rpMonteCarloDraws: number;
  /**
   * D-05/D-08 (plan 03-04, `./adaptation.js`): whether within-season
   * innovation-driven per-team process-noise adaptation is active. Default
   * `false` — D-08: the default promoted version ships adaptation OFF
   * unless the measurement (plan 03-05's best-vs-best search) says
   * otherwise, so `false` is the honest default from the first commit
   * rather than something flipped back later. This is a MODE, not a
   * numeric knob, and is therefore deliberately EXCLUDED from the
   * sensitivity screen's one-at-a-time sweep — plan 03-05 searches it as
   * two independent optimizer runs per D-06, never as a dimension inside
   * one run. Since 4.0.0 that exclusion is DATA, not prose: it is a named
   * entry in `packages/harness/searchSpace.ts`'s `SEARCH_EXCLUSIONS`, with a
   * test that fails if any parameter lands in neither the search space nor
   * the exclusion list (D-T3).
   *
   * D-T4's MEASUREMENT, and the caveat that is inseparable from it (quick
   * task 260901-trz). Adaptation-on beat adaptation-off in EVERY arm
   * measured, and still added **-0.0015 Brier on top of 16x process noise**
   * (holdout 0.153558 -> 0.152054). That second figure is the load-bearing
   * one: it means adaptation is NOT merely a slow proxy for process noise,
   * which was the obvious alternative explanation and would have made it
   * redundant once D-T1's scale-relative process noise landed.
   *
   * THE CAVEAT: adaptation's winning SUB-PARAMETERS (`adaptationEwmaAlpha`,
   * `adaptationExponent`, the two clamp bounds, `adaptationMinObservations`)
   * were selected BY LOOKING AT HOLDOUT. A figure whose configuration was
   * chosen on the same data it is reported against is inflated by an unknown
   * amount, so -0.0015 is an upper bound on the real effect, not an estimate
   * of it.
   *
   * Consequently D-T4 neither deletes adaptation nor enables it. It enters
   * the rolling-origin re-tune (D-T5) as two independent optimizer runs per
   * origin — the D-06 precedent — with its sub-parameters selected on
   * strictly-prior seasons only, and it SHIPS ONLY IF its arm's winner clears
   * D-T7's acceptance bar against the incumbent out-of-sample. Quick task
   * 260901-trz did NOT enable it; see
   * `.planning/todos/pending/retune-sigma1-rolling-origin.md`.
   */
  readonly adaptationEnabled: boolean;
  /** D-05 (plan 03-04): EWMA rate for `./adaptation.js`'s `foldInnovation` squared-normalized-innovation fold — matches `consistencyEwmaAlpha`'s reasoning: one off match must not swing the factor. Phase 3 hyperparameter, default unverified. */
  readonly adaptationEwmaAlpha: number;
  /** D-05 (plan 03-04): exponent applied to a team's mean squared normalized innovation before clamping (`./adaptation.js`'s `adaptationFactor`) — 0.5 scales the factor with the ratio of observed to expected innovation STANDARD deviation rather than variance, a gentler default than the raw variance ratio. Phase 3 hyperparameter, default unverified. */
  readonly adaptationExponent: number;
  /** T-03-06 (plan 03-04): lower clamp bound for `./adaptation.js`'s `adaptationFactor`. An unbounded adaptive filter can destabilize — an over-large factor inflates `P`, which inflates the Kalman gain, which produces a larger innovation next match, which inflates the factor again — the clamp is the documented stability bound, not decoration. Phase 3 hyperparameter, default unverified. */
  readonly adaptationMinFactor: number;
  /** T-03-06 (plan 03-04): upper clamp bound for `./adaptation.js`'s `adaptationFactor`. Phase 3 hyperparameter, default unverified. */
  readonly adaptationMaxFactor: number;
  /** D-05 (plan 03-04): below this many folded observations, `./adaptation.js`'s `adaptationFactor` returns exactly 1 — a team's first match cannot tell you its regime is changing. Phase 3 hyperparameter, default unverified. */
  readonly adaptationMinObservations: number;
  /**
   * D-4 (`./elim.js`, quick task 260904-v9n, ELIM-R): a DIMENSIONLESS
   * multiplier applied to the measurement noise `R` of an ELIMINATION
   * observation (`compLevel !== "qm"`) — it multiplies a quantity already in
   * points^2, so unlike the five `*Rel` fields above it passes through
   * `resolveSigma1Params` completely unchanged (it is not one of the fields
   * that `Omit` removes). Default exactly `1`: no elim-specific treatment at
   * all, so `1.0 * base === base` bitwise for every finite `base`.
   *
   * COMPOSES with the pre-existing `FALLBACK_NOISE_MULTIPLIER`
   * (`breakdown/fallback.ts`) rather than replacing it — an elim match with a
   * missing/malformed breakdown carries both inflations, since a fallback
   * observation's own noise inflation and an elim observation's noise
   * treatment are two independent facts about that one observation.
   *
   * MOTIVATED by the shipped `reports/rolling-2026-09b` walk-forward
   * backtest (offseason excluded): VPR's elim winner accuracy trails its
   * quals accuracy in 2023 (73.1% vs 75.8%) and 2024 (71.2% vs 75.0%) at
   * n~=2800/season, while OPR gains +5 to +11 points at elims every season.
   * SEARCHABLE (`searchSpace.ts`) — this is the parameter the accuracy-primary
   * tuner rules on to answer whether the model over-trusts elim observations
   * (a multiplier above 1) or under-uses late-event information (a
   * multiplier below 1); see `elim.ts`'s own header for the fuller argument.
   */
  readonly elimObservationNoiseMultiplier: number;
  /**
   * D-10 (`./elim.js`, quick task 260904-v9n, ELIM-OFF): whether the
   * within-season learned elim score offset is applied at all. Default
   * `false` — the honest default from the first commit, matching D-08's
   * `adaptationEnabled` precedent, since this ships unmeasured.
   *
   * KNOWN LIMITATION (D-13), carried here in full: a symmetric league-wide
   * offset added to BOTH alliances CANCELS in the margin, so enabling this
   * does NOT move `pRedWin`, winner accuracy or Brier — its purpose is
   * honest published elim SCORE predictions, not accuracy. Precisely: it
   * cancels ANALYTICALLY, not bitwise — `(a+k) - (b+k)` is not guaranteed to
   * equal `a-b` in IEEE-754 — so with this flag ON, `pRedWin` may differ at
   * ULP scale from the flag-OFF run, and a flag-ON digest is not guaranteed
   * to reproduce a flag-OFF one. At the default `false` the cancellation IS
   * exact (`x + 0 === x` for every finite `x`), which is what lets
   * `params.test.ts`'s identity test assert byte-identical streams.
   *
   * A MODE, not a numeric knob — search-excluded (`searchSpace.ts`) for the
   * `adaptationEnabled` reason (a boolean has no bound, no scale and no
   * meaningful neighbour) AND, independently, because a symmetric offset
   * cannot move `pRedWin` at all, so the accuracy-primary objective is
   * structurally blind to whether it is on.
   */
  readonly elimScoreOffsetEnabled: boolean;
  /**
   * D-7 (`./elim.js`, quick task 260904-v9n, ELIM-OFF): the EWMA rate for the
   * league-level elim score offset's online fold. Default `0.05` — roughly a
   * 13-observation half-life (`ln(0.5) / ln(1 - 0.05) ~= 13.5`), about half a
   * typical elim bracket's worth of alliance-observations, chosen at the
   * LOG-MIDPOINT of this field's own declared search-exclusion-adjacent
   * bound rather than copied from a per-team EWMA alpha: the per-team rates
   * in this file (`consistencyEwmaAlpha`/`covEwmaAlpha`/`adaptationEwmaAlpha`,
   * all default around 0.2) are tuned for ONE team's history and would be far
   * too twitchy for a statistic accumulating across an entire league's
   * concurrent elimination brackets.
   *
   * Display-only, therefore search-excluded (`searchSpace.ts`) for the
   * `swingScale`/`swingHalfLifeMatches` reason: the accuracy-primary
   * objective reads `predict()`'s win probability, which this field is
   * structurally blind to (D-13's cancellation), so searching it would
   * optimise noise.
   */
  readonly elimScoreOffsetEwmaAlpha: number;
  /**
   * D-1 (`carrySeason`, quick task 260905-kjb, CVR-PARAM/CVR-WIRE): a UNIFORM
   * PER-TEAM multiplier on the cold-start belief-VARIANCE prior a returning
   * team is seeded with at a season boundary — applied in `carrySeason`
   * ONLY to a team that has carried state (`oldTeamState !== undefined`),
   * and applied to EVERY modeled component of the incoming season without
   * reference to that component's name.
   *
   * Default `1` is exactly today's behaviour, via an EXPLICIT `=== 1`
   * branch in `carrySeason` — a full cold-start reset, no retention at all.
   * Values below 1 seed a returning team with proportionally MORE
   * confidence than a first-timer, the asymmetry
   * `reports/autopsy-260905/FINDINGS.md` diagnosed VPR as missing relative
   * to EPA.
   *
   * DIMENSIONLESS: a unitless multiplier on a variance already in the right
   * units, so — exactly like `elimObservationNoiseMultiplier` above — it
   * passes through `resolveSigma1Params` completely unchanged rather than
   * being one of the five `*Rel` fields the `Omit` removes.
   *
   * MOTIVATED by quick task 260905-jyf's two-candidate Stage 1 experiment,
   * whose result points both ways: R1 (a NAME-MATCHED, per-component
   * carried seed) won its pre-committed criteria — early-slice accuracy up
   * on both 2023 (0.7402 -> 0.7413) and 2025 (0.7405 -> 0.7407), every
   * season inside +/-0.4 SE, pooled Brier 0.1593 -> 0.1590 — validating the
   * DIRECTION, but by an order of magnitude under the ~1.3pt EPA-vs-VPR
   * early-slice gap it targeted. R2 (a TEAM-LEVEL uniform factor derived
   * from `reversionOverGap(carryMeanReversion, gap)`) closed NEGATIVE at
   * -10.46 pooled SE-units, three seasons breaching the -2.0 SE floor —
   * saying the DOSE (its own derived value, ~0.069) was far too aggressive,
   * not that the shape was wrong.
   *
   * The REACH is deliberately TEAM-LEVEL (R2's gate), not per-component
   * name-matched (R1's gate): FRC component names are season-specific, so
   * a per-component carried-evidence gate (`oldTeamState?.consistency[name]
   * !== undefined`) reaches only `foulsCommitted` at any real season
   * boundary — checked across all five seasons' `OWN_FIELD_COMPONENT_MAP`s
   * plus `FOULS_COMMITTED_COMPONENT` — which is a knob not worth tuning.
   * This field uses R2's team-level reach so it moves EVERY modeled
   * component's seed for a returning team.
   *
   * The VALUE is free and searchable (`searchSpace.ts`) and must NEVER be
   * re-derived from `reversionOverGap(carryMeanReversion, gap)` — that
   * specific derivation is what measured negative above. This field
   * borrows R2's reach condition and multiplicative shape while leaving
   * the dose itself to the search.
   */
  readonly carryVarianceFactor: number;
}

/**
 * Reproduces Phase-2 Sigma1 behaviour exactly: every field is imported from
 * the pre-existing constant it replaces, never a re-typed literal, so this
 * default set cannot drift from the numbers it is defined to reproduce. A
 * `vpr` module (renamed by plan 07-16, D-04/D-05) built with no explicit
 * `params` (`makeSigma1({ id, linkMode })`, every pre-Phase-3 call site) resolves to this object and
 * must produce bitwise-identical predictions to the pre-parameterization
 * module (this task's must-have truth, proven by `sigma1.test.ts` staying
 * green unmodified).
 */
export const DEFAULT_SIGMA1_PARAMS: Sigma1Params = {
  // D-T1: the five relative fields are DERIVED from the absolute constants
  // they replace, divided by the measured reference — never re-typed
  // literals. The reparameterization map is therefore visible right here in
  // the source, and these defaults cannot drift from the absolute behaviour
  // they exist to reproduce. Note the ONE linear case: `coldStartTeamTotal`
  // is a point total, so it divides by `sqrt(V_ref)`, not `V_ref`.
  processNoiseWithinEventRel: SIGMA1_PROCESS_NOISE_WITHIN_EVENT / SIGMA1_REFERENCE_SCORE_VARIANCE,
  processNoiseEventBoundaryRel: SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY / SIGMA1_REFERENCE_SCORE_VARIANCE,
  consistencyEwmaAlpha: SIGMA1_CONSISTENCY_EWMA_ALPHA,
  // D-Y1: IMPORTED from swing.ts, never a re-typed 6 and 1.92. Sharper here
  // than for most defaults, because both were MEASURED: a re-typed copy could
  // drift from the measurement its doc comment records.
  swingHalfLifeMatches: SIGMA1_SWING_HALF_LIFE_MATCHES,
  swingScale: SIGMA1_SWING_SCALE,
  minConsistencyVarianceRel: SIGMA1_MIN_CONSISTENCY_VARIANCE / SIGMA1_REFERENCE_SCORE_VARIANCE,
  covEwmaAlpha: SIGMA1_COV_EWMA_ALPHA,
  covShrinkage: SIGMA1_COV_SHRINKAGE,
  linkC: SIGMA1_LINK_C,
  coldStartTeamTotalRel: SIGMA1_COLD_START_TEAM_TOTAL / Math.sqrt(SIGMA1_REFERENCE_SCORE_VARIANCE),
  coldStartConsistencyVarianceRel: SIGMA1_COLD_START_CONSISTENCY_VARIANCE / SIGMA1_REFERENCE_SCORE_VARIANCE,
  fallbackScoreSd: SIGMA1_FALLBACK_SCORE_SD,
  consistencyCarryDecay: SIGMA1_CONSISTENCY_CARRY_DECAY,
  carryMeanReversion: EPA_MEAN_REVERSION,
  // D-T2: derived from the retired pair's own RATIO, so `0.3` cannot drift
  // from the `0.7 / 0.3` blend it is defined to reproduce exactly.
  carryPriorYearShare: EPA_CARRY_PRIOR_YEAR_WEIGHT / (EPA_CARRY_LAST_YEAR_WEIGHT + EPA_CARRY_PRIOR_YEAR_WEIGHT),
  // F3: RP's own ABSOLUTE pair plus its cold-start variance, sourced from the
  // exact constants `rp/state.ts` read through the score-side fields before
  // 4.0.0 — this is what makes RP's Kalman step bitwise unchanged.
  rpProcessNoiseWithinEvent: SIGMA1_PROCESS_NOISE_WITHIN_EVENT,
  rpProcessNoiseEventBoundary: SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY,
  rpColdStartVariance: SIGMA1_COLD_START_CONSISTENCY_VARIANCE,
  rpMonteCarloSeed: 42,
  rpMonteCarloDraws: 2000,
  adaptationEnabled: false,
  adaptationEwmaAlpha: 0.2,
  adaptationExponent: 0.5,
  adaptationMinFactor: 0.25,
  adaptationMaxFactor: 4.0,
  adaptationMinObservations: 3,
  // D-4 (quick task 260904-v9n, ELIM-R): exactly 1 — no elim-specific
  // treatment at all until the re-tune (searchable) says otherwise.
  elimObservationNoiseMultiplier: 1,
  // D-10 (quick task 260904-v9n, ELIM-OFF): off by default, unmeasured.
  elimScoreOffsetEnabled: false,
  // D-7: roughly a 13-observation half-life, chosen rather than tuned.
  elimScoreOffsetEwmaAlpha: 0.05,
  // D-1 (quick task 260905-kjb, CVR-PARAM): exactly 1 — a full cold-start
  // reset, today's behaviour, until the re-tune says otherwise.
  carryVarianceFactor: 1,
};

/**
 * The executable spec for D-13's committed parameter set, mirroring
 * `artifact.ts`'s `HarnessArtifactSchema` validate-on-write role.
 * `z.strictObject` so an unknown key in a committed parameter file
 * (`data/algorithm-versions/*.json`) fails loudly at the parse boundary
 * instead of being silently stripped — T-03-08's mitigation. Every field is
 * `z.number().finite()`: a NaN/Infinity value in a committed file is a
 * corrupted or hand-edited artifact, never a valid parameter.
 *
 * D-11 / 03-REVIEW WR-01: the object-level `.check(...)` below folds in the
 * five cross-parameter invariants that `packages/harness/searchSpace.ts`'s
 * `isValidParamSet` also enforces (that function remains the cheap boolean
 * pre-filter for grid sweeps — see its own doc comment). Before this change,
 * those invariants were enforced only by CONVENTION at three call sites
 * (`promote.ts`'s `main`, `cli.ts`'s `loadSearchWinnerSigma1`,
 * `PromotedVersionSchema`'s nested `params` field) plus two bare `as
 * Sigma1Params` casts in `tune.ts` that bypassed even that convention — a
 * fourth boundary could simply forget to call `isValidParamSet`, exactly how
 * this gap arose. Attaching the checks HERE, on the schema every
 * construction path already parses through, makes an invalid `Sigma1Params`
 * unconstructible rather than merely unbuilt-by-convention — the same
 * "runtime fact, not a convention a cast can bypass" reasoning
 * `replay.ts`'s leak-proof `toLeakProofUpcoming` Proxy already uses (D-11
 * cites it directly). Each violation reports its own named issue, so a
 * rejected candidate says which invariant it broke rather than failing
 * opaquely:
 *
 *   - D-07: `processNoiseEventBoundaryRel` must strictly exceed
 *     `processNoiseWithinEventRel`, or the boundary/within-event distinction
 *     is meaningless. D-T1 renamed both sides of this predicate and did NOT
 *     weaken it: both scale by the SAME `sigma^2` at resolve time, so the
 *     dimensionless ordering is the identical statement about the absolute
 *     quantities the filter applies.
 *   - F3: the SAME D-07 ordering, applied to the RP threshold variables' own
 *     absolute pair (`rpProcessNoiseEventBoundary` >
 *     `rpProcessNoiseWithinEvent`) — a separate predicate because they are
 *     now separate parameters, and the argument for the ordering is
 *     unchanged.
 *   - T-03-06: `adaptationMinFactor` must be strictly less than
 *     `adaptationMaxFactor`, or the stability clamp is degenerate/inverted.
 *   - D-04/D-T2: `carryMeanReversion` and `carryPriorYearShare` are each only
 *     meaningful in the closed interval [0, 1]. The retired
 *     `carryLastYearWeight`/`carryPriorYearWeight` pair had one range check
 *     each; the merged share has one, and the complementary weight is
 *     `1 - share` by construction rather than by validation.
 */
export const Sigma1ParamsSchema = z
  .strictObject({
    processNoiseWithinEventRel: z.number().finite(),
    processNoiseEventBoundaryRel: z.number().finite(),
    consistencyEwmaAlpha: z.number().finite(),
    swingHalfLifeMatches: z.number().finite().positive(),
    swingScale: z.number().finite().positive(),
    minConsistencyVarianceRel: z.number().finite(),
    covEwmaAlpha: z.number().finite(),
    covShrinkage: z.number().finite(),
    linkC: z.number().finite(),
    coldStartTeamTotalRel: z.number().finite(),
    coldStartConsistencyVarianceRel: z.number().finite(),
    fallbackScoreSd: z.number().finite(),
    consistencyCarryDecay: z.number().finite(),
    carryMeanReversion: z.number().finite(),
    carryPriorYearShare: z.number().finite(),
    rpProcessNoiseWithinEvent: z.number().finite(),
    rpProcessNoiseEventBoundary: z.number().finite(),
    rpColdStartVariance: z.number().finite(),
    rpMonteCarloSeed: z.number().finite(),
    rpMonteCarloDraws: z.number().finite(),
    adaptationEnabled: z.boolean(),
    adaptationEwmaAlpha: z.number().finite(),
    adaptationExponent: z.number().finite(),
    adaptationMinFactor: z.number().finite(),
    adaptationMaxFactor: z.number().finite(),
    adaptationMinObservations: z.number().finite(),
    // D-4/D-2 (quick task 260904-v9n, ELIM-R/ELIM-WIRE): `.default(1)` is
    // what lets every already-committed `vpr@8.0.0+*.json` file — none of
    // which carries this key — still parse and resolve to the inert value.
    elimObservationNoiseMultiplier: z.number().finite().positive().default(1),
    // D-10/D-2 (quick task 260904-v9n, ELIM-OFF/ELIM-WIRE): `.default(false)`
    // is what keeps every committed file parsing with the mechanism inert.
    elimScoreOffsetEnabled: z.boolean().default(false),
    elimScoreOffsetEwmaAlpha: z.number().finite().default(0.05),
    // D-1/CVR-PARAM (quick task 260905-kjb): `.default(1)` is what lets
    // every already-committed `vpr@8.0.0+*.json` file — none of which
    // carries this key — still parse and resolve inert, the same argument
    // the elim fields' defaults carry above. `.positive()` excludes `0`,
    // which would seed a returning team at ZERO variance (perfect certainty
    // after a layoff — the exact claim `seedConsistencyFor`'s floor exists
    // to refuse). `.max(1)` is a real constraint, not decoration: a factor
    // above 1 would mean trusting a returning team LESS than a first-timer,
    // the opposite of the hypothesis this stage tests and not a question
    // this knob is asking.
    carryVarianceFactor: z.number().finite().positive().max(1).default(1),
  })
  .check((ctx) => {
    const value = ctx.value;
    if (!(value.processNoiseEventBoundaryRel > value.processNoiseWithinEventRel)) {
      ctx.issues.push({
        code: "custom",
        message:
          "D-07: processNoiseEventBoundaryRel must strictly exceed processNoiseWithinEventRel (the boundary/within-event distinction is otherwise meaningless)",
        path: ["processNoiseEventBoundaryRel", "processNoiseWithinEventRel"],
        input: value,
      });
    }
    if (!(value.rpProcessNoiseEventBoundary > value.rpProcessNoiseWithinEvent)) {
      ctx.issues.push({
        code: "custom",
        message:
          "D-07/F3: rpProcessNoiseEventBoundary must strictly exceed rpProcessNoiseWithinEvent (the same argument as the score side's pair, applied to the RP threshold variables' own absolute noise)",
        path: ["rpProcessNoiseEventBoundary", "rpProcessNoiseWithinEvent"],
        input: value,
      });
    }
    if (!(value.adaptationMinFactor < value.adaptationMaxFactor)) {
      ctx.issues.push({
        code: "custom",
        message: "T-03-06: adaptationMinFactor must be strictly less than adaptationMaxFactor (a degenerate or inverted clamp is never valid)",
        path: ["adaptationMinFactor", "adaptationMaxFactor"],
        input: value,
      });
    }
    if (!(value.carryMeanReversion >= 0 && value.carryMeanReversion <= 1)) {
      ctx.issues.push({
        code: "custom",
        message: "D-04: carryMeanReversion must lie within the closed interval [0, 1]",
        path: ["carryMeanReversion"],
        input: value,
      });
    }
    if (!(value.carryPriorYearShare >= 0 && value.carryPriorYearShare <= 1)) {
      ctx.issues.push({
        code: "custom",
        message: "D-04/D-T2: carryPriorYearShare must lie within the closed interval [0, 1]",
        path: ["carryPriorYearShare"],
        input: value,
      });
    }
  }) satisfies z.ZodType<Sigma1Params>;

/**
 * The ONE canonical iteration order for every consumer that folds
 * `Sigma1Params` into an accumulated result (`tune.ts`'s search log,
 * `promote.ts`'s digest) — derived from `DEFAULT_SIGMA1_PARAMS`'s own keys
 * (never hand-typed, so it cannot drift from the interface) and sorted with
 * a plain lexicographic comparator. Two runs of the same search must
 * iterate parameters in the same order to produce the same winner
 * (D-16/ALGO-04's ordering edge) — every consumer reads this array, never
 * `Object.keys` on a freshly built record.
 */
export const SIGMA1_PARAM_KEYS: readonly (keyof Sigma1Params)[] = (
  Object.keys(DEFAULT_SIGMA1_PARAMS) as (keyof Sigma1Params)[]
).sort();
