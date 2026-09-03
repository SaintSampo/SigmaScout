/**
 * The one-directional migrations off retired `SIGMA1_CODE_VERSION` parameter
 * shapes. There are now TWO, and each has its OWN frozen schema:
 *
 *   - 3.0.0 ABSOLUTE -> 4.0.0 scale-relative (D-T1/D-T2/F3, quick task
 *     260901-trz): `LegacyAbsoluteSigma1ParamsSchema` +
 *     `migrateAbsoluteToScaleRelative`.
 *   - 4.0.0 -> 5.0.0 (D-V4, quick task 260902-varopr): `Legacy4Sigma1ParamsSchema`
 *     + `migrate4to5`, which drops `shrinkagePriorMatches` and adds
 *     `varianceOprRidge`.
 *
 * A second frozen schema BESIDE the first is what that first schema's own
 * DO-NOT-EDIT header prescribes; extending it would have retroactively changed
 * the meaning of every file it has already read.
 *
 * THE TWO ARE CHAINED, and this is a DEVIATION from quick task
 * 260902-varopr's plan, which said the 3.x path would not be touched.
 * Touching it was unavoidable: each migration used to END by parsing its
 * result through `Sigma1ParamsSchema`, so the instant that schema became
 * 5.0.0's, `migrateAbsoluteToScaleRelative` would have thrown on EVERY input —
 * a silently broken migration rather than a dead one. The fix keeps each map
 * doing exactly one hop:
 *
 *     3.0.0 --migrateAbsoluteToScaleRelative--> 4.0.0 --migrate4to5--> 5.0.0
 *
 * so `migrateAbsoluteToScaleRelative` now validates against
 * `Legacy4Sigma1ParamsSchema` (the shape it actually produces) and
 * `promote.ts`'s 3.x branch composes the two. Its FROZEN INPUT SCHEMA and its
 * field-by-field map are untouched, which is what that schema's DO-NOT-EDIT
 * header actually protects; the cross-parameter invariants are still enforced,
 * one hop later, by `migrate4to5`'s own `Sigma1ParamsSchema.parse`.
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
  DEFAULT_SIGMA1_PARAMS,
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
 * result through `Legacy4Sigma1ParamsSchema` — the schema for the shape it
 * actually produces.
 *
 * It validated against `Sigma1ParamsSchema` until 5.0.0, when that schema
 * stopped describing 4.0.0. Retargeting it is what keeps this map WORKING
 * rather than throwing on every input; the cross-parameter invariants it used
 * to enforce here are enforced one hop later by `migrate4to5`, which
 * `promote.ts` composes onto this. See this module's header for the chain.
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
export function migrateAbsoluteToScaleRelative(legacy: LegacyAbsoluteSigma1Params): Legacy4Sigma1Params {
  const carryWeightSum = legacy.carryLastYearWeight + legacy.carryPriorYearWeight;
  if (Math.abs(carryWeightSum - 1) >= 1e-9) {
    throw new Error(
      `migrateAbsoluteToScaleRelative: carryLastYearWeight + carryPriorYearWeight = ${carryWeightSum}, not 1. ` +
        `D-T2's carryPriorYearShare preserves the RATIO of the retired unnormalized pair but not its SUM, so an ` +
        `unnormalized legacy set cannot be migrated without choosing between preserving the blend ratio and preserving ` +
        `the carried magnitude — a choice this migration refuses to make silently.`
    );
  }

  return Legacy4Sigma1ParamsSchema.parse({
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

// ---------------------------------------------------------------------------
// 4.0.0 -> 5.0.0 (D-V4, quick task 260902-varopr)
// ---------------------------------------------------------------------------

/**
 * ## `Legacy4Sigma1ParamsSchema` IS A HISTORICAL RECORD. DO NOT EDIT IT.
 *
 * The FROZEN 4.0.0 `Sigma1Params` shape, added BESIDE
 * `LegacyAbsoluteSigma1ParamsSchema` rather than by extending it — which that
 * schema's own header explicitly forbids and prescribes this exact remedy for:
 * "If a future parameterization needs its own migration, it gets its own
 * frozen schema beside this one; this one stays as written."
 *
 * Everything that header says about editing applies here verbatim. It
 * describes a shape that no longer exists in the running system; its only job
 * is to read files written before 2026-09-02 and say exactly what they meant.
 * Changing a field, adding one, or relaxing `z.strictObject` would silently
 * change the MEANING of every already-migrated file, retroactively, with
 * nothing to notice it.
 *
 * `z.strictObject` for the same reason the 3.0.0 schema is: an unknown key in
 * a file claiming to be a 4.0.0 parameter set is a corrupted or hand-edited
 * artifact, and reading it leniently would migrate a set whose meaning nobody
 * actually knows. No cross-parameter `.check(...)` is attached, also for the
 * same reason: the invariants belong to the CURRENT schema, and
 * `migrate4to5` parses its result through `Sigma1ParamsSchema`.
 */
export const Legacy4Sigma1ParamsSchema = z.strictObject({
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
});

export type Legacy4Sigma1Params = z.infer<typeof Legacy4Sigma1ParamsSchema>;

/**
 * Names the MAP applied, not merely "migrated" — the distinction that lets a
 * later reader tell WHICH of several conversions produced a file now that
 * there is more than one.
 */
export const SIGMA1_4_TO_5_MIGRATION_TAG = "sigma1-4.0.0-shrinkage-to-5.0.0-variance-decomposition";

/**
 * Maps one frozen 4.0.0 parameter set onto the 5.0.0 shape, then parses the
 * result through `Sigma1ParamsSchema` so a migrated set is validated exactly
 * as any other construction path is — an invariant-violating legacy set cannot
 * migrate into a valid-looking new one, and the error names the invariant under
 * its current field names.
 *
 * ## The dropped `shrinkagePriorMatches` IS information lost, and that is correct
 *
 * The 4.0.0 `tuned-2026-08` set carries a SEARCHED value for
 * `shrinkagePriorMatches`, and this migration discards it. That is deliberate
 * rather than lossy-by-accident: at 5.0.0 the parameter has NO CONSUMER at all
 * — the published `±` is the per-team variance decomposition and nothing
 * shrinks a consistency estimate toward the league average — so there is
 * nothing left for the value to mean. Carrying it forward would preserve a
 * number whose referent no longer exists, which is exactly the "documentation
 * describing a deleted model" failure this project's own log records.
 *
 * Contrast with `migrateAbsoluteToScaleRelative`'s carry-weight case above,
 * which THROWS rather than choosing: there, two incompatible behaviours could
 * each be preserved and the function refuses to pick silently. Here there is
 * no behaviour to preserve, so dropping is the only honest map and no refusal
 * is warranted.
 *
 * `varianceOprRidge` comes from `DEFAULT_SIGMA1_PARAMS` — the same
 * `SIGMA1_VARIANCE_OPR_RIDGE` constant `varianceOpr.ts` exports and
 * `varianceOpr.recovery.test.ts` defends. It is a never-searched display
 * constant, so the default IS the shipped value; there is no tuned alternative
 * a migration could be failing to carry.
 */
export function migrate4to5(legacy: Legacy4Sigma1Params): Sigma1Params {
  const { shrinkagePriorMatches: _dropped, ...carried } = legacy;
  // Composes with the 6->7 hop rather than duplicating it: a 4.0.0 set has
  // neither `varianceOprRidge` nor the swing pair, so it is a 6.0.0-shaped set
  // minus one field, and `migrate6to7` owns the rest of the journey.
  return migrate6to7(
    Legacy6Sigma1ParamsSchema.parse({ ...carried, varianceOprRidge: LEGACY_6_VARIANCE_OPR_RIDGE })
  );
}

/**
 * The 6.0.0 parameter shape, FROZEN. Identical to 5.0.0's — the 5->6 change was
 * the NNLS solve, which moved no field — so one schema covers both.
 *
 * DO NOT EDIT IT to track `Sigma1Params`. It is a historical record of what the
 * two committed `vpr@6.0.0+*.json` files actually contain, and the only reason
 * they can still be read.
 */
export const Legacy6Sigma1ParamsSchema = Sigma1ParamsSchema.omit({
  swingHalfLifeMatches: true,
  swingScale: true,
}).extend({ varianceOprRidge: z.number().finite() });

export type Legacy6Sigma1Params = z.infer<typeof Legacy6Sigma1ParamsSchema>;

/** The ridge 6.0.0 shipped. Recorded here because the constant it came from is deleted with `varianceOpr.ts`, and a frozen schema may not depend on a live one. */
const LEGACY_6_VARIANCE_OPR_RIDGE = 2;

/** A machine-readable tag for the 6->7 map, recorded in a migrated file's provenance. */
export const SIGMA1_6_TO_7_MIGRATION_TAG = "sigma1-6.0.0-variance-decomposition-to-7.0.0-recency-swing";

/**
 * 6.0.0 -> 7.0.0 (D-Y1/D-Y3, quick task 260903-750): drops `varianceOprRidge`
 * and adds the two swing constants.
 *
 * Both incoming and outgoing values are NEVER-SEARCHED display constants, so the
 * default IS the shipped value and there is no tuned alternative this migration
 * could be failing to carry. The ridge is dropped rather than translated because
 * the estimator it parameterised no longer exists: a recency-weighted mean has
 * no ridge, and inventing a correspondence between the two would be fiction.
 */
export function migrate6to7(legacy: Legacy6Sigma1Params): Sigma1Params {
  const { varianceOprRidge: _dropped, ...carried } = legacy;
  return Sigma1ParamsSchema.parse({
    ...carried,
    swingHalfLifeMatches: DEFAULT_SIGMA1_PARAMS.swingHalfLifeMatches,
    swingScale: DEFAULT_SIGMA1_PARAMS.swingScale,
  });
}
