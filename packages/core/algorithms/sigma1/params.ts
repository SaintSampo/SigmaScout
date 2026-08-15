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
 * to reproduce bitwise (this task's own must-have truth).
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
 * module-top-level `makeSigma1(...)` calls (`sigma1`, `sigma1Defaults`,
 * ...), while `params.ts` would need `index.ts`'s constants for
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
 */
export const SIGMA1_CODE_VERSION = "2.0.0";

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
 */
export const SIGMA1_COLD_START_TEAM_TOTAL = 20;

/**
 * Fallback consistency VARIANCE (points^2) for a component the league has
 * never observed a residual for yet — the same role `EPA_FALLBACK_SCORE_SD`
 * plays for EPA's win-probability scale, applied here to Sigma1's own
 * measurement-noise/spread estimate instead. Phase 3 hyperparameter, default
 * unverified.
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
  /** D-07 process-noise magnitude for two matches within the SAME event (points^2 per match). Sourced from `kalman.ts`'s `SIGMA1_PROCESS_NOISE_WITHIN_EVENT`. Phase 3 hyperparameter, default unverified. */
  readonly processNoiseWithinEvent: number;
  /** D-07 process-noise magnitude injected at an EVENT BOUNDARY (points^2). Sourced from `kalman.ts`'s `SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY`. Phase 3 hyperparameter, default unverified. */
  readonly processNoiseEventBoundary: number;
  /** EWMA rate for `consistency.ts`'s `foldConsistency` squared-residual fold. Sourced from `consistency.ts`'s `SIGMA1_CONSISTENCY_EWMA_ALPHA`. Phase 3 hyperparameter, default unverified. */
  readonly consistencyEwmaAlpha: number;
  /** D-11's empirical-Bayes prior-match count for `consistency.ts`'s `shrinkConsistency`. Sourced from `consistency.ts`'s `SIGMA1_SHRINKAGE_PRIOR_MATCHES`. Phase 3 hyperparameter, default unverified. */
  readonly shrinkagePriorMatches: number;
  /** Floor applied to every shrunk consistency VARIANCE (points^2), read inside `consistency.ts`'s `shrinkConsistency`. Sourced from `consistency.ts`'s `SIGMA1_MIN_CONSISTENCY_VARIANCE`. Phase 3 hyperparameter, default unverified. */
  readonly minConsistencyVariance: number;
  /** EWMA rate for `covariance.ts`'s `ewmaCovariance` fold step. Sourced from `covariance.ts`'s `SIGMA1_COV_EWMA_ALPHA`. Phase 3 hyperparameter, default unverified. */
  readonly covEwmaAlpha: number;
  /** Constant shrinkage toward the diagonal applied inside `covariance.ts`'s `ewmaCovariance`. Sourced from `covariance.ts`'s `SIGMA1_COV_SHRINKAGE`. Phase 3 hyperparameter, default unverified. */
  readonly covShrinkage: number;
  /** D-12's default `c` for mode 2's (`predictive-variance`) win-probability denominator scale. Sourced from `linkFunctions.ts`'s `SIGMA1_LINK_C`. Phase 3 hyperparameter, default unverified. */
  readonly linkC: number;
  /** A cold-start team's typical total contribution to an alliance's score, in point units. Sourced from this module's own `SIGMA1_COLD_START_TEAM_TOTAL`. Phase 3 hyperparameter, default unverified. */
  readonly coldStartTeamTotal: number;
  /** Fallback consistency VARIANCE for a component the league has never observed a residual for yet. Sourced from this module's own `SIGMA1_COLD_START_CONSISTENCY_VARIANCE`. Phase 3 hyperparameter, default unverified. */
  readonly coldStartConsistencyVariance: number;
  /** Fallback alliance-score SD before at least 2 alliance-score observations exist this season. Sourced from this module's own `SIGMA1_FALLBACK_SCORE_SD`. Phase 3 hyperparameter, default unverified. */
  readonly fallbackScoreSd: number;
  /** D-17: how far a carried-over consistency estimate decays at a season boundary. Sourced from this module's own `SIGMA1_CONSISTENCY_CARRY_DECAY`. Phase 3 hyperparameter, default unverified. */
  readonly consistencyCarryDecay: number;
  /** D-04: Sigma1's OWN tunable copy of how far a carried-over rating reverts toward the rookie baseline at a season boundary — never read by `carryover.ts`'s frozen `epaCarryover` (EPA stays pinned at Statbotics' published `EPA_MEAN_REVERSION`, D-04). Sourced from `carryover.ts`'s `EPA_MEAN_REVERSION` as this field's default ONLY (Task 3 gives Sigma1 its own `sigma1Carryover` reader). Phase 3 hyperparameter, default unverified. */
  readonly carryMeanReversion: number;
  /** D-04: Sigma1's own tunable copy of the weight given to a team's immediately-prior season's normalized rating when carrying across a season boundary. Sourced from `carryover.ts`'s `EPA_CARRY_LAST_YEAR_WEIGHT` as this field's default only. Phase 3 hyperparameter, default unverified. */
  readonly carryLastYearWeight: number;
  /** D-04: Sigma1's own tunable copy of the complementary weight given to the season before that. Sourced from `carryover.ts`'s `EPA_CARRY_PRIOR_YEAR_WEIGHT` as this field's default only. Phase 3 hyperparameter, default unverified. */
  readonly carryPriorYearWeight: number;
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
 * `sigma1` module built with no explicit `params` (`makeSigma1({ id,
 * linkMode })`, every pre-Phase-3 call site) resolves to this object and
 * must produce bitwise-identical predictions to the pre-parameterization
 * module (this task's must-have truth, proven by `sigma1.test.ts` staying
 * green unmodified).
 */
export const DEFAULT_SIGMA1_PARAMS: Sigma1Params = {
  processNoiseWithinEvent: SIGMA1_PROCESS_NOISE_WITHIN_EVENT,
  processNoiseEventBoundary: SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY,
  consistencyEwmaAlpha: SIGMA1_CONSISTENCY_EWMA_ALPHA,
  shrinkagePriorMatches: SIGMA1_SHRINKAGE_PRIOR_MATCHES,
  minConsistencyVariance: SIGMA1_MIN_CONSISTENCY_VARIANCE,
  covEwmaAlpha: SIGMA1_COV_EWMA_ALPHA,
  covShrinkage: SIGMA1_COV_SHRINKAGE,
  linkC: SIGMA1_LINK_C,
  coldStartTeamTotal: SIGMA1_COLD_START_TEAM_TOTAL,
  coldStartConsistencyVariance: SIGMA1_COLD_START_CONSISTENCY_VARIANCE,
  fallbackScoreSd: SIGMA1_FALLBACK_SCORE_SD,
  consistencyCarryDecay: SIGMA1_CONSISTENCY_CARRY_DECAY,
  carryMeanReversion: EPA_MEAN_REVERSION,
  carryLastYearWeight: EPA_CARRY_LAST_YEAR_WEIGHT,
  carryPriorYearWeight: EPA_CARRY_PRIOR_YEAR_WEIGHT,
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
 */
export const Sigma1ParamsSchema = z.strictObject({
  processNoiseWithinEvent: z.number().finite(),
  processNoiseEventBoundary: z.number().finite(),
  consistencyEwmaAlpha: z.number().finite(),
  shrinkagePriorMatches: z.number().finite(),
  minConsistencyVariance: z.number().finite(),
  covEwmaAlpha: z.number().finite(),
  covShrinkage: z.number().finite(),
  linkC: z.number().finite(),
  coldStartTeamTotal: z.number().finite(),
  coldStartConsistencyVariance: z.number().finite(),
  fallbackScoreSd: z.number().finite(),
  consistencyCarryDecay: z.number().finite(),
  carryMeanReversion: z.number().finite(),
  carryLastYearWeight: z.number().finite(),
  carryPriorYearWeight: z.number().finite(),
  rpMonteCarloSeed: z.number().finite(),
  rpMonteCarloDraws: z.number().finite(),
  adaptationEnabled: z.boolean(),
  adaptationEwmaAlpha: z.number().finite(),
  adaptationExponent: z.number().finite(),
  adaptationMinFactor: z.number().finite(),
  adaptationMaxFactor: z.number().finite(),
  adaptationMinObservations: z.number().finite(),
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
