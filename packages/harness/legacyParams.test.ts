import { describe, expect, it } from "vitest";
import {
  LegacyAbsoluteSigma1ParamsSchema,
  migrateAbsoluteToScaleRelative,
  SIGMA1_3_TO_4_MIGRATION_TAG,
  type LegacyAbsoluteSigma1Params,
} from "./legacyParams.js";
import { SIGMA1_REFERENCE_SCORE_VARIANCE, Sigma1ParamsSchema } from "../core/algorithms/sigma1/params.js";

/**
 * The EXACT `params` object of the retired
 * `data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json`, inlined as a
 * literal rather than read from disk.
 *
 * That file is RETIRED — deleted by the same commit that added this test, and
 * replaced by `vpr@4.0.0+tuned-2026-08.json` — so reading it at test time
 * would make this fixture rot the moment it disappeared. Inlined, it is a
 * permanent record of the shipped parameter set this migration was defined
 * against, which is exactly what a migration test needs.
 */
const RETIRED_TUNED_2026_08: LegacyAbsoluteSigma1Params = {
  processNoiseWithinEvent: 0.14522393520915602,
  processNoiseEventBoundary: 1,
  consistencyEwmaAlpha: 0.03444905576109887,
  shrinkagePriorMatches: 8,
  minConsistencyVariance: 1,
  covEwmaAlpha: 0.2600009894482791,
  covShrinkage: 0.12817359956447036,
  linkC: 0.5,
  coldStartTeamTotal: 20,
  coldStartConsistencyVariance: 16.75421168559074,
  fallbackScoreSd: 25,
  consistencyCarryDecay: 0.4142244359478354,
  carryMeanReversion: 0.06930459369905292,
  carryLastYearWeight: 0.7,
  carryPriorYearWeight: 0.3,
  rpMonteCarloSeed: 42,
  rpMonteCarloDraws: 2000,
  adaptationEnabled: false,
  adaptationEwmaAlpha: 0.2,
  adaptationExponent: 0.5,
  adaptationMinFactor: 0.25,
  adaptationMaxFactor: 4,
  adaptationMinObservations: 3,
};

describe("migrateAbsoluteToScaleRelative — the real promoted set", () => {
  const migrated = migrateAbsoluteToScaleRelative(RETIRED_TUNED_2026_08);

  it("divides each of the four variance-scaled fields by SIGMA1_REFERENCE_SCORE_VARIANCE", () => {
    expect(migrated.processNoiseWithinEventRel).toBeCloseTo(
      RETIRED_TUNED_2026_08.processNoiseWithinEvent / SIGMA1_REFERENCE_SCORE_VARIANCE,
      12
    );
    expect(migrated.processNoiseEventBoundaryRel).toBeCloseTo(
      RETIRED_TUNED_2026_08.processNoiseEventBoundary / SIGMA1_REFERENCE_SCORE_VARIANCE,
      12
    );
    expect(migrated.minConsistencyVarianceRel).toBeCloseTo(
      RETIRED_TUNED_2026_08.minConsistencyVariance / SIGMA1_REFERENCE_SCORE_VARIANCE,
      12
    );
    expect(migrated.coldStartConsistencyVarianceRel).toBeCloseTo(
      RETIRED_TUNED_2026_08.coldStartConsistencyVariance / SIGMA1_REFERENCE_SCORE_VARIANCE,
      12
    );
  });

  it("divides the ONE linear field by the SQUARE ROOT of the reference, not the reference", () => {
    expect(migrated.coldStartTeamTotalRel).toBeCloseTo(
      RETIRED_TUNED_2026_08.coldStartTeamTotal / Math.sqrt(SIGMA1_REFERENCE_SCORE_VARIANCE),
      12
    );
    // The control that makes the assertion above sharp: dividing by the
    // reference itself would be the one-character mistake.
    expect(migrated.coldStartTeamTotalRel).not.toBeCloseTo(
      RETIRED_TUNED_2026_08.coldStartTeamTotal / SIGMA1_REFERENCE_SCORE_VARIANCE,
      12
    );
  });

  it("round-trips: multiplying back through the reference recovers the legacy absolutes", () => {
    expect(migrated.processNoiseWithinEventRel * SIGMA1_REFERENCE_SCORE_VARIANCE).toBeCloseTo(
      RETIRED_TUNED_2026_08.processNoiseWithinEvent,
      9
    );
    expect(migrated.processNoiseEventBoundaryRel * SIGMA1_REFERENCE_SCORE_VARIANCE).toBeCloseTo(
      RETIRED_TUNED_2026_08.processNoiseEventBoundary,
      9
    );
    expect(migrated.minConsistencyVarianceRel * SIGMA1_REFERENCE_SCORE_VARIANCE).toBeCloseTo(
      RETIRED_TUNED_2026_08.minConsistencyVariance,
      9
    );
    expect(migrated.coldStartConsistencyVarianceRel * SIGMA1_REFERENCE_SCORE_VARIANCE).toBeCloseTo(
      RETIRED_TUNED_2026_08.coldStartConsistencyVariance,
      9
    );
    expect(migrated.coldStartTeamTotalRel * Math.sqrt(SIGMA1_REFERENCE_SCORE_VARIANCE)).toBeCloseTo(
      RETIRED_TUNED_2026_08.coldStartTeamTotal,
      9
    );
  });

  it("D-T2: recovers the retired 0.7/0.3 blend as a share of exactly 0.3", () => {
    expect(migrated.carryPriorYearShare).toBe(0.3);
  });

  it("F3: copies the legacy ABSOLUTE process-noise pair and cold-start variance into RP's own three fields, UNCHANGED", () => {
    // This is what makes the RP threshold variables' Kalman step bitwise
    // identical across the migration — those three values are exactly what
    // `rp/state.ts` read through the score-side fields before 4.0.0.
    expect(migrated.rpProcessNoiseWithinEvent).toBe(RETIRED_TUNED_2026_08.processNoiseWithinEvent);
    expect(migrated.rpProcessNoiseEventBoundary).toBe(RETIRED_TUNED_2026_08.processNoiseEventBoundary);
    expect(migrated.rpColdStartVariance).toBe(RETIRED_TUNED_2026_08.coldStartConsistencyVariance);
  });

  it("passes every dimensionless and already-absolute field through untouched", () => {
    expect(migrated.consistencyEwmaAlpha).toBe(RETIRED_TUNED_2026_08.consistencyEwmaAlpha);
    expect(migrated.shrinkagePriorMatches).toBe(RETIRED_TUNED_2026_08.shrinkagePriorMatches);
    expect(migrated.covEwmaAlpha).toBe(RETIRED_TUNED_2026_08.covEwmaAlpha);
    expect(migrated.covShrinkage).toBe(RETIRED_TUNED_2026_08.covShrinkage);
    // The D-Q2 `linkC` correction, which exists ONLY in the committed version
    // file and NOT in the search artifact its provenance names — carrying it
    // through the migration is the whole reason `promote.ts` grew
    // `--from-version`.
    expect(migrated.linkC).toBe(0.5);
    expect(migrated.fallbackScoreSd).toBe(RETIRED_TUNED_2026_08.fallbackScoreSd);
    expect(migrated.consistencyCarryDecay).toBe(RETIRED_TUNED_2026_08.consistencyCarryDecay);
    expect(migrated.carryMeanReversion).toBe(RETIRED_TUNED_2026_08.carryMeanReversion);
    expect(migrated.rpMonteCarloSeed).toBe(RETIRED_TUNED_2026_08.rpMonteCarloSeed);
    expect(migrated.rpMonteCarloDraws).toBe(RETIRED_TUNED_2026_08.rpMonteCarloDraws);
    expect(migrated.adaptationEnabled).toBe(RETIRED_TUNED_2026_08.adaptationEnabled);
  });

  it("produces a set that parses cleanly through the CURRENT Sigma1ParamsSchema", () => {
    expect(() => Sigma1ParamsSchema.parse(migrated)).not.toThrow();
  });
});

describe("migrateAbsoluteToScaleRelative — refusals", () => {
  it("THROWS on unnormalized carry weights, naming the sum", () => {
    // The retired pair was unnormalized, so a share recovers the RATIO but
    // loses the SUM. A set whose weights do not sum to 1 cannot be migrated
    // without choosing between preserving the blend ratio and preserving the
    // carried magnitude, and this migration must not make that choice
    // silently.
    const unnormalized = { ...RETIRED_TUNED_2026_08, carryLastYearWeight: 0.6, carryPriorYearWeight: 0.3 };
    expect(() => migrateAbsoluteToScaleRelative(unnormalized)).toThrow(/= 0\.8999999999999999|= 0\.9/);
    expect(() => migrateAbsoluteToScaleRelative(unnormalized)).toThrow(/carryPriorYearShare preserves the RATIO/);
  });

  it("cannot turn an invariant-violating legacy set into a valid-looking new one", () => {
    // D-07: the boundary bump must strictly exceed the within-event one. The
    // violation survives the (order-preserving) division, so the migrated set
    // is rejected by the CURRENT schema rather than sneaking through.
    const inverted = { ...RETIRED_TUNED_2026_08, processNoiseWithinEvent: 5, processNoiseEventBoundary: 1 };
    expect(() => migrateAbsoluteToScaleRelative(inverted)).toThrow(/D-07/);
  });
});

describe("LegacyAbsoluteSigma1ParamsSchema — the frozen historical record", () => {
  it("accepts the retired promoted set exactly", () => {
    expect(() => LegacyAbsoluteSigma1ParamsSchema.parse(RETIRED_TUNED_2026_08)).not.toThrow();
  });

  it("REJECTS an unknown key — a file claiming to be a 3.0.0 parameter set with an extra field is hand-edited or corrupt, not migratable", () => {
    expect(() =>
      LegacyAbsoluteSigma1ParamsSchema.parse({ ...RETIRED_TUNED_2026_08, someFutureKnob: 1 })
    ).toThrow(/[Uu]nrecognized key/);
  });

  it("REJECTS a NEW-shape parameter set — the frozen schema describes the retired shape and only that", () => {
    // A 4.0.0 file routed into the legacy reader by mistake must fail loudly
    // rather than being migrated a second time, which would divide every
    // already-relative field by the reference again.
    const alreadyMigrated = migrateAbsoluteToScaleRelative(RETIRED_TUNED_2026_08);
    expect(() => LegacyAbsoluteSigma1ParamsSchema.parse(alreadyMigrated)).toThrow();
  });

  it("names the map it applies, so a migrated promotion's provenance says WHICH conversion produced it", () => {
    expect(SIGMA1_3_TO_4_MIGRATION_TAG).toBe("sigma1-3.0.0-absolute-to-4.0.0-scale-relative");
  });
});
