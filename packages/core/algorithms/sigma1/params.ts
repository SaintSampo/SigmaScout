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
 * `linkFunctions.ts`/`carryover.ts`, never from `sigma1/index.ts`) is the
 * only acyclic direction, matching this file's own module-ownership
 * discipline precedent in `carryover.ts`'s header.
 */
import { z } from "zod";
import { SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY, SIGMA1_PROCESS_NOISE_WITHIN_EVENT } from "./kalman.js";
import {
  SIGMA1_CONSISTENCY_EWMA_ALPHA,
  SIGMA1_MIN_CONSISTENCY_VARIANCE,
  SIGMA1_SHRINKAGE_PRIOR_MATCHES,
} from "./consistency.js";
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
 */
export const SIGMA1_CODE_VERSION = "4.0.0";

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
 * Every field is a `readonly number` — this is a data declaration, not
 * behaviour, so the interface is declared in full now even though this
 * task (03-01 Task 1) only wires `processNoiseWithinEvent`/
 * `processNoiseEventBoundary` through the update path; Task 2 wires the
 * remaining ten, Task 3 wires the three carry fields.
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
  /** D-11's empirical-Bayes prior-match count for `consistency.ts`'s `shrinkConsistency`. Sourced from `consistency.ts`'s `SIGMA1_SHRINKAGE_PRIOR_MATCHES`. Phase 3 hyperparameter, default unverified. */
  readonly shrinkagePriorMatches: number;
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
   * one run.
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
  shrinkagePriorMatches: SIGMA1_SHRINKAGE_PRIOR_MATCHES,
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
    shrinkagePriorMatches: z.number().finite(),
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
