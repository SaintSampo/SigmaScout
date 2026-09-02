/**
 * The one-directional migration off `SIGMA1_CODE_VERSION` 3.0.0's ABSOLUTE
 * parameter shape onto 4.0.0's scale-relative one (D-T1/D-T2/F3, quick task
 * 260901-trz).
 *
 * Lives in `packages/harness`, not `packages/core`: a migration off a retired
 * shape is a TOOLING concern, the same argument `searchSpace.ts`'s header
 * makes for search bounds, and `packages/core` must stay free of anything
 * that is not Worker-importable prediction logic.
 *
 * ## `LegacyAbsoluteSigma1ParamsSchema` IS A HISTORICAL RECORD. DO NOT EDIT IT.
 *
 * It describes a shape that no longer exists anywhere in the running system.
 * Its only job is to read files that were written before 2026-09-01 and say
 * exactly what those files meant. Changing a field, adding one, or relaxing
 * `z.strictObject` would silently change the MEANING of every already-migrated
 * file — retroactively, and with nothing to notice it. If a future
 * parameterization needs its own migration, it gets its own frozen schema
 * beside this one; this one stays as written.
 *
 * ## What the map is
 *
 * Four fields divide by `SIGMA1_REFERENCE_SCORE_VARIANCE`; `coldStartTeamTotal`
 * divides by its SQUARE ROOT, because it is a point total rather than a
 * variance. Both directions read the SAME constant `DEFAULT_SIGMA1_PARAMS`'s
 * own relative defaults are derived from — one constant, two consumers, and
 * they must never sit on different references or the defaults and the shipped
 * set would be on different scales with nothing to say so.
 *
 * F3: the legacy ABSOLUTE process-noise pair is ALSO copied into the two new
 * RP fields, and the legacy absolute cold-start consistency variance into
 * `rpColdStartVariance`. That is not a convenience — it is precisely what
 * makes the RP threshold variables' Kalman step bitwise unchanged across the
 * migration, because those are exactly the three values `rp/state.ts` read
 * through the score-side fields before 4.0.0.
 */
import { z } from "zod";
import {
  SIGMA1_REFERENCE_SCORE_VARIANCE,
  Sigma1ParamsSchema,
  type Sigma1Params,
} from "../core/algorithms/sigma1/params.js";

/**
 * The FROZEN 3.0.0 `Sigma1Params` shape. `z.strictObject` for the same reason
 * `Sigma1ParamsSchema` is: an unknown key in a file claiming to be a 3.0.0
 * parameter set is a corrupted or hand-edited artifact, and reading it
 * leniently would migrate a set whose meaning nobody actually knows.
 *
 * No cross-parameter `.check(...)` is attached here on purpose. The
 * invariants belong to the CURRENT schema, and the migrated result is parsed
 * through `Sigma1ParamsSchema` by `migrateAbsoluteToScaleRelative` below — so
 * an invariant-violating legacy set cannot be migrated into a valid-looking
 * new one, and the error names the invariant under its current field names
 * rather than a retired one.
 */
export const LegacyAbsoluteSigma1ParamsSchema = z.strictObject({
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
});

export type LegacyAbsoluteSigma1Params = z.infer<typeof LegacyAbsoluteSigma1ParamsSchema>;

/**
 * A machine-readable tag for the map applied, recorded in a migrated
 * promotion's `provenance.paramShapeMigration`. Naming the MAP rather than
 * just "migrated" is what lets a later reader tell which of several possible
 * conversions produced a file, if this ever stops being the only one.
 */
export const SIGMA1_3_TO_4_MIGRATION_TAG = "sigma1-3.0.0-absolute-to-4.0.0-scale-relative";

/**
 * Maps one frozen 3.0.0 parameter set onto the 4.0.0 shape, then parses the
 * result through `Sigma1ParamsSchema` so a migrated set is validated exactly
 * as any other construction path is.
 *
 * ## The carry weights, and the one honest wrinkle
 *
 * The legacy pair is UNNORMALIZED, so `share = priorYear / (lastYear +
 * priorYear)` recovers the RATIO but LOSES the SUM. For both committed 3.0.0
 * files the sum is exactly 1.0 (0.7 + 0.3), so the migration is exact and the
 * shipped model's carry behaviour is unchanged.
 *
 * A legacy set whose weights did NOT sum to 1 cannot be migrated without
 * choosing which of two behaviours to preserve — the ratio or the magnitude —
 * and this function must not make that choice silently. It THROWS, naming the
 * sum. That is a refusal to guess, not a defensive guard.
 */
export function migrateAbsoluteToScaleRelative(legacy: LegacyAbsoluteSigma1Params): Sigma1Params {
  const carryWeightSum = legacy.carryLastYearWeight + legacy.carryPriorYearWeight;
  if (Math.abs(carryWeightSum - 1) >= 1e-9) {
    throw new Error(
      `migrateAbsoluteToScaleRelative: carryLastYearWeight + carryPriorYearWeight = ${carryWeightSum}, not 1. ` +
        `D-T2's carryPriorYearShare preserves the RATIO of the retired unnormalized pair but not its SUM, so an ` +
        `unnormalized legacy set cannot be migrated without choosing between preserving the blend ratio and preserving ` +
        `the carried magnitude — a choice this migration refuses to make silently.`
    );
  }

  return Sigma1ParamsSchema.parse({
    // Four variance-scaled fields.
    processNoiseWithinEventRel: legacy.processNoiseWithinEvent / SIGMA1_REFERENCE_SCORE_VARIANCE,
    processNoiseEventBoundaryRel: legacy.processNoiseEventBoundary / SIGMA1_REFERENCE_SCORE_VARIANCE,
    minConsistencyVarianceRel: legacy.minConsistencyVariance / SIGMA1_REFERENCE_SCORE_VARIANCE,
    coldStartConsistencyVarianceRel: legacy.coldStartConsistencyVariance / SIGMA1_REFERENCE_SCORE_VARIANCE,
    // The ONE linear field: a point total, so it divides by the SD, not the
    // variance.
    coldStartTeamTotalRel: legacy.coldStartTeamTotal / Math.sqrt(SIGMA1_REFERENCE_SCORE_VARIANCE),
    // F3: the legacy ABSOLUTES carried straight across, which is what makes
    // the RP Kalman step bitwise unchanged.
    rpProcessNoiseWithinEvent: legacy.processNoiseWithinEvent,
    rpProcessNoiseEventBoundary: legacy.processNoiseEventBoundary,
    rpColdStartVariance: legacy.coldStartConsistencyVariance,
    // D-T2.
    carryPriorYearShare: legacy.carryPriorYearWeight / carryWeightSum,
    // Everything else is dimensionless or already absolute, and passes
    // through untouched.
    consistencyEwmaAlpha: legacy.consistencyEwmaAlpha,
    shrinkagePriorMatches: legacy.shrinkagePriorMatches,
    covEwmaAlpha: legacy.covEwmaAlpha,
    covShrinkage: legacy.covShrinkage,
    linkC: legacy.linkC,
    fallbackScoreSd: legacy.fallbackScoreSd,
    consistencyCarryDecay: legacy.consistencyCarryDecay,
    carryMeanReversion: legacy.carryMeanReversion,
    rpMonteCarloSeed: legacy.rpMonteCarloSeed,
    rpMonteCarloDraws: legacy.rpMonteCarloDraws,
    adaptationEnabled: legacy.adaptationEnabled,
    adaptationEwmaAlpha: legacy.adaptationEwmaAlpha,
    adaptationExponent: legacy.adaptationExponent,
    adaptationMinFactor: legacy.adaptationMinFactor,
    adaptationMaxFactor: legacy.adaptationMaxFactor,
    adaptationMinObservations: legacy.adaptationMinObservations,
  });
}
