/**
 * Unit tests for `measureEpaDeviations.ts`'s pure helpers.
 *
 * The measurement LOOP announces its own health on the console — an exclusion
 * census, an `eventCount` beside every interval, a deferred-rescale count, and
 * a pre-registered verdict line that reads WORSE as fluently as BETTER. What is
 * tested HERE is everything that could be silently wrong in a way no console
 * output would reveal, because each of these produces a plausible number and a
 * false conclusion:
 *
 *   - a clean-season-mean unwinding that forgets to subtract the
 *     `EPA_SCORE_SD_SEED_COUNT` pseudo-observations `reseedFromPrior` leaves
 *     behind, which would drag every ratio toward 1 and shrink the very effect
 *     the carryover arm exists to measure;
 *   - a rescale ratio that returns `NaN` on a degenerate seed mean instead of
 *     1 — `NaN` propagates through every component of every carried team and
 *     then formats as a dash, which reads identically to "no data";
 *   - a materializer that rescales a team NOT in `pending` (double-scaling a
 *     team already corrected) or that turns EPA's pinned-zero `adjust`
 *     component into a nonzero value;
 *   - a win-probability rescale that disagrees with the shipped logistic when
 *     handed the shipped SD, which would make the two scale arms measure a
 *     transcription error rather than a scale;
 *   - a local exclusion predicate whose ladder order differs from
 *     `aggregateScores`' own, which would attribute the same match to a
 *     different bucket and break the survivor-count assertion for a reason that
 *     has nothing to do with the model;
 *   - a paired-difference builder that ZERO-FILLS a missing counterpart, which
 *     dilutes every contrast toward zero and manufactures a false
 *     "indistinguishable" — the one failure mode that would let this script
 *     report no finding at all and look correct doing it;
 *   - a `verdictFor` that resolves a zero-spanning interval by the point
 *     estimate's sign, turning noise into a claim, or that gets the metric's
 *     sign convention backwards (for Brier LOWER is better, for winner accuracy
 *     HIGHER is — one function, two conventions, and swapping them would invert
 *     every recommendation this harness produces);
 *   - an artifact builder that silently omits a deviation it could not measure,
 *     which is exactly how a gap becomes invisible.
 */
import { describe, expect, it } from "vitest";
import { EPA_FALLBACK_SCORE_SD, EPA_K, EPA_SCORE_SD_SEED_COUNT } from "../packages/core/algorithms/epa.js";
import {
  ARM_IDS,
  armRegister,
  BASELINE_ARM_ID,
  buildArtifact,
  carryoverFixArm,
  carryRescaleRatio,
  CARRYOVER_FIX_ARM_ID,
  CARRYOVER_FIX_MIN250_ARM_ID,
  CARRYOVER_FIX_MIN500_ARM_ID,
  cleanSeasonMean,
  contrastFor,
  deviationRegister,
  emptyAblationCensus,
  EPA_CARRY_RESCALE_MIN_OBS,
  exclusionReasonFor,
  finiteOrThrow,
  materializePendingTeams,
  meanDiff,
  pairedAccuracyDiffs,
  pairedBrierDiffs,
  ratioForState,
  rescaledWinProbability,
  rescaleComponents,
  SCHEMA_VERSION,
  selectThreshold,
  THRESHOLD_CANDIDATES,
  verdictFor,
  type CarryoverFixState,
  type ContrastMetric,
  type ContrastRow,
  type ScorableRow,
  type Scope,
} from "./measureEpaDeviations.js";

describe("cleanSeasonMean — unwinding reseedFromPrior's pseudo-observations", () => {
  it("recovers the arithmetic mean of the real folds", () => {
    // A boundary leaves the accumulator at exactly EPA_SCORE_SD_SEED_COUNT
    // observations sitting at the prior season's mean. Fold 200 real
    // observations averaging 60 on top and the blended mean is the
    // count-weighted average of the two — unwinding must return 60 exactly.
    const seedMean = 290;
    const realCount = 200;
    const realMean = 60;
    const count = EPA_SCORE_SD_SEED_COUNT + realCount;
    const mean = (seedMean * EPA_SCORE_SD_SEED_COUNT + realMean * realCount) / count;
    expect(cleanSeasonMean({ count, mean }, seedMean)).toBeCloseTo(realMean, 9);
  });

  it("returns null below EPA_CARRY_RESCALE_MIN_OBS real observations — the walk-forward-legality floor", () => {
    const seedMean = 290;
    const justUnder = EPA_SCORE_SD_SEED_COUNT + EPA_CARRY_RESCALE_MIN_OBS - 1;
    expect(cleanSeasonMean({ count: justUnder, mean: 100 }, seedMean)).toBeNull();
    const exactly = EPA_SCORE_SD_SEED_COUNT + EPA_CARRY_RESCALE_MIN_OBS;
    expect(cleanSeasonMean({ count: exactly, mean: 100 }, seedMean)).not.toBeNull();
  });

  it("returns null when the accumulator never carried a seed at all", () => {
    // `reseedFromPrior` returns its input untouched below 2 observations, so a
    // count at or below the seed size means there is no seed to unwind and the
    // formula's denominator would be zero or negative.
    expect(cleanSeasonMean({ count: EPA_SCORE_SD_SEED_COUNT, mean: 100 }, 290)).toBeNull();
    expect(cleanSeasonMean({ count: 0, mean: 0 }, 290)).toBeNull();
  });

  it("returns null for a non-finite seed mean rather than propagating NaN", () => {
    expect(cleanSeasonMean({ count: 1000, mean: 60 }, Number.NaN)).toBeNull();
  });
});

describe("carryRescaleRatio", () => {
  it("halving the season scale yields a ratio near 0.5", () => {
    const { ratio, deferred } = carryRescaleRatio(50, 100);
    expect(ratio).toBeCloseTo(0.5, 12);
    expect(deferred).toBe(false);
  });

  it("an unchanged scale yields exactly 1", () => {
    expect(carryRescaleRatio(100, 100)).toEqual({ ratio: 1, deferred: false });
  });

  it("a not-yet-measurable clean mean defers rather than guessing", () => {
    expect(carryRescaleRatio(null, 100)).toEqual({ ratio: 1, deferred: true });
  });

  it("a zero or non-finite seed mean yields 1 and counts a deferral", () => {
    expect(carryRescaleRatio(60, 0)).toEqual({ ratio: 1, deferred: true });
    expect(carryRescaleRatio(60, Number.NaN)).toEqual({ ratio: 1, deferred: true });
    expect(carryRescaleRatio(Number.NaN, 100)).toEqual({ ratio: 1, deferred: true });
    // A negative clean mean cannot be a point scale; refuse rather than flip
    // every carried rating's sign.
    expect(carryRescaleRatio(-10, 100)).toEqual({ ratio: 1, deferred: true });
  });
});

describe("rescaleComponents / materializePendingTeams", () => {
  it("multiplies every component by the ratio and leaves a pinned zero at zero", () => {
    const out = rescaleComponents({ autoPoints: 30, teleopPoints: 60, adjust: 0 }, 0.5);
    expect(out).toEqual({ autoPoints: 15, teleopPoints: 30, adjust: 0 });
  });

  it("rescales a pending team, leaves a non-pending team untouched, and reports who it touched", () => {
    const before = new Map<string, Readonly<Record<string, number>>>([
      ["frc111", { autoPoints: 10, adjust: 0 }],
      ["frc222", { autoPoints: 20, adjust: 0 }],
    ]);
    const { teamComponents, touched } = materializePendingTeams(
      before,
      ["frc111", "frc222"],
      new Set(["frc111"]),
      0.25
    );
    expect(touched).toEqual(["frc111"]);
    expect(teamComponents.get("frc111")).toEqual({ autoPoints: 2.5, adjust: 0 });
    // Untouched by reference, not merely by value — a copied-but-equal record
    // would mean the materializer rebuilt state it had no business rebuilding.
    expect(teamComponents.get("frc222")).toBe(before.get("frc222"));
    // The input map is never mutated.
    expect(before.get("frc111")).toEqual({ autoPoints: 10, adjust: 0 });
  });

  it("ignores a team with no state and a pending team not in this match", () => {
    const before = new Map<string, Readonly<Record<string, number>>>([["frc111", { autoPoints: 10 }]]);
    const { teamComponents, touched } = materializePendingTeams(
      before,
      ["frc999"],
      new Set(["frc111", "frc999"]),
      0.5
    );
    expect(touched).toEqual([]);
    expect(teamComponents.get("frc111")).toEqual({ autoPoints: 10 });
  });
});

describe("rescaledWinProbability", () => {
  it("agrees with the shipped logistic when handed the shipped SD", () => {
    // The shipped form, transcribed here ONCE as the oracle: this is the exact
    // expression `epa.ts`'s predict() evaluates.
    const sd = 27.2;
    const scale = sd / (-EPA_K * Math.LN10);
    for (const [red, blue] of [
      [80, 60],
      [60, 80],
      [70, 70],
      [200, 5],
    ] as const) {
      const expected = 1 / (1 + Math.exp(-(red - blue) / scale));
      expect(rescaledWinProbability(red, blue, sd).pRedWin).toBeCloseTo(expected, 12);
    }
  });

  it("resolves an exact tie to red at exactly 0.5, matching the >= 0.5 convention", () => {
    const tie = rescaledWinProbability(70, 70, EPA_FALLBACK_SCORE_SD);
    expect(tie.pRedWin).toBe(0.5);
    expect(tie.winner).toBe("red");
  });

  it("cannot change sign(margin) — the pre-registered invariant, at every scale", () => {
    for (const sd of [1, 5, 25, 106.4, 1000]) {
      expect(rescaledWinProbability(80, 60, sd).pRedWin).toBeGreaterThan(0.5);
      expect(rescaledWinProbability(60, 80, sd).pRedWin).toBeLessThan(0.5);
    }
  });

  it("refuses a non-positive or non-finite SD rather than emitting a degenerate probability", () => {
    expect(() => rescaledWinProbability(80, 60, 0)).toThrow(/scoreSd/);
    expect(() => rescaledWinProbability(80, 60, Number.NaN)).toThrow(/scoreSd/);
  });
});

describe("exclusionReasonFor — pinned to aggregateScores' own ladder order", () => {
  const clean = {
    isOffseason: false,
    isSurrogateAffected: false,
    isColdStart: false,
    actualWinner: "red" as const,
    pRedWin: 0.6,
  };

  it("keeps a clean candidate", () => {
    expect(exclusionReasonFor(clean)).toBeNull();
  });

  it("attributes each reason to exactly one bucket, in aggregateScores' order", () => {
    expect(exclusionReasonFor({ ...clean, isOffseason: true })).toBe("offseason");
    expect(exclusionReasonFor({ ...clean, isSurrogateAffected: true })).toBe("surrogateAffected");
    expect(exclusionReasonFor({ ...clean, isColdStart: true })).toBe("coldStart");
    expect(exclusionReasonFor({ ...clean, actualWinner: null })).toBe("missingResult");
    expect(exclusionReasonFor({ ...clean, pRedWin: Number.NaN })).toBe("invalidProbability");
    expect(exclusionReasonFor({ ...clean, pRedWin: 1.5 })).toBe("invalidProbability");
  });

  it("an offseason surrogate cold-start match is attributed to offseason alone", () => {
    // This is what makes the survivor-count assertion against `aggregateScores`
    // meaningful: the same match must leave via the same door in both.
    expect(
      exclusionReasonFor({ ...clean, isOffseason: true, isSurrogateAffected: true, isColdStart: true })
    ).toBe("offseason");
  });

  it("emptyAblationCensus names every bucket, so a new reason cannot be silently unreported", () => {
    expect(emptyAblationCensus()).toEqual({
      offseason: 0,
      surrogateAffected: 0,
      coldStart: 0,
      missingResult: 0,
      invalidProbability: 0,
    });
  });
});

describe("paired diff builders", () => {
  const row = (matchKey: string, pRedWin: number, actualWinner: ScorableRow["actualWinner"]): ScorableRow => ({
    eventKey: "2024test",
    matchKey,
    pRedWin,
    actualWinner,
  });

  it("drops a match with no counterpart rather than zero-filling it", () => {
    const arm = [row("m1", 0.8, "red"), row("m2", 0.8, "red")];
    const baseline = [row("m1", 0.6, "red")];
    const units = pairedBrierDiffs(arm, baseline);
    expect(units).toHaveLength(1);
    expect(units[0]!.matchKey).toBe("m1");
    // (0.8 - 1)^2 - (0.6 - 1)^2 = 0.04 - 0.16 = -0.12. NEGATIVE = arm better.
    expect(units[0]!.diff).toBeCloseTo(-0.12, 12);
  });

  it("keeps an actual tie in Brier pairing but drops it from accuracy pairing", () => {
    const arm = [row("m1", 0.5, "tie"), row("m2", 0.8, "red")];
    const baseline = [row("m1", 0.9, "tie"), row("m2", 0.3, "red")];
    expect(pairedBrierDiffs(arm, baseline).map((u) => u.matchKey)).toEqual(["m1", "m2"]);
    const accuracy = pairedAccuracyDiffs(arm, baseline);
    expect(accuracy.map((u) => u.matchKey)).toEqual(["m2"]);
    // arm called red and was right (1); baseline called blue and was wrong (0).
    expect(accuracy[0]!.diff).toBe(1);
  });

  it("counts a 0.5 no-call against a decided match as a miss on both sides (D-Q3)", () => {
    const arm = [row("m1", 0.5, "red")];
    const baseline = [row("m1", 0.7, "red")];
    expect(pairedAccuracyDiffs(arm, baseline)[0]!.diff).toBe(-1);
  });

  it("meanDiff is NaN on an empty list — an empty sample has no mean, and 0 would read as a tie", () => {
    expect(Number.isNaN(meanDiff([]))).toBe(true);
    expect(meanDiff([{ eventKey: "e", matchKey: "m", diff: 2 }, { eventKey: "e", matchKey: "n", diff: -4 }])).toBe(-1);
  });
});

describe("verdictFor — two metrics, two sign conventions", () => {
  it("reads Brier with LOWER-is-better", () => {
    expect(verdictFor("brier", -0.01, -0.002, -0.006)).toBe("better");
    expect(verdictFor("brier", 0.002, 0.01, 0.006)).toBe("worse");
  });

  it("reads winner accuracy with HIGHER-is-better — the opposite convention, same function", () => {
    expect(verdictFor("winnerAccuracy", 0.002, 0.01, 0.006)).toBe("better");
    expect(verdictFor("winnerAccuracy", -0.01, -0.002, -0.006)).toBe("worse");
  });

  it("never resolves a zero-spanning interval by the point estimate's sign", () => {
    expect(verdictFor("brier", -0.01, 0.004, -0.003)).toBe("indistinguishable");
    expect(verdictFor("winnerAccuracy", -0.004, 0.01, 0.003)).toBe("indistinguishable");
  });

  it("reports an exactly-zero contrast as identical, not as a suspiciously tight win", () => {
    expect(verdictFor("winnerAccuracy", 0, 0, 0)).toBe("identical");
  });

  it("reports a non-finite interval as unmeasurable rather than picking a side", () => {
    expect(verdictFor("brier", Number.NaN, Number.NaN, Number.NaN)).toBe("unmeasurable");
  });
});

describe("finiteOrThrow — the silent-NaN guard", () => {
  it("returns a finite value unchanged", () => {
    expect(finiteOrThrow(0, "zero is finite")).toBe(0);
  });

  it("throws naming its context instead of letting NaN format as a dash", () => {
    expect(() => finiteOrThrow(Number.NaN, "2019 carry ratio")).toThrow(/2019 carry ratio/);
    expect(() => finiteOrThrow(Number.POSITIVE_INFINITY, "pooled brier")).toThrow(/pooled brier/);
  });
});

describe("deviationRegister / buildArtifact — nothing is silently omitted", () => {
  it("gives every deviation an explicit status and a reason whenever it was not measured", () => {
    const register = deviationRegister();
    expect(register.length).toBeGreaterThanOrEqual(8);
    for (const deviation of register) {
      expect(deviation.id).toBeTruthy();
      expect(deviation.docSection).toBeTruthy();
      expect([
        "measured",
        "closed",
        "display-only",
        "unmeasurable-in-this-harness",
        "unmeasurable-no-reference",
      ]).toContain(deviation.status);
      if (deviation.status.startsWith("unmeasurable")) {
        expect(deviation.reason, `${deviation.id} must name why it could not be measured`).toBeTruthy();
      }
    }
    // Every id is unique — a duplicated id would let one entry hide another.
    expect(new Set(register.map((d) => d.id)).size).toBe(register.length);
  });

  it("carries the deviations this harness is specifically accountable for", () => {
    const ids = deviationRegister().map((d) => d.id);
    for (const id of [
      "carryover-scale-anchor",
      "winprob-scale",
      "component-map",
      "per-year-postprocess-2018",
      "elim-weight",
      "published-total-excludes-fouls",
      "offseason-population",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("refuses to let a UI sum effects that do not add", () => {
    const artifact = buildArtifact({
      seasons: [2022, 2023],
      corpusPath: "data/corpus.sqlite",
      streamPopulation: "offseason-inclusive",
      rows: [],
      contrasts: [],
      census: emptyAblationCensus(),
      carryScale: [],
      deferredRescales: 0,
      rescaledTeams: 0,
    });
    expect(artifact.schemaVersion).toBe(SCHEMA_VERSION);
    expect(artifact.notes.additive).toBe(false);
    expect(artifact.notes.combinationsMeasured).toEqual([]);
    expect(artifact.scorer.tiesCountedInBrier).toBe(true);
    expect(artifact.deviations.map((d) => d.id)).toEqual(deviationRegister().map((d) => d.id));
    expect(artifact.arms.map((a) => a.id)).toEqual([...ARM_IDS]);
    expect(artifact.arms.filter((a) => a.isBaseline).map((a) => a.id)).toEqual([BASELINE_ARM_ID]);
    // The baseline arm enables nothing, by definition.
    expect(artifact.arms.find((a) => a.id === BASELINE_ARM_ID)!.deviations).toEqual([]);
    // Every non-baseline arm names at least one deviation, and every named
    // deviation exists in the register.
    const registerIds = new Set(artifact.deviations.map((d) => d.id));
    for (const arm of artifact.arms) {
      if (arm.isBaseline) continue;
      expect(arm.deviations.length).toBeGreaterThan(0);
      for (const id of arm.deviations) expect(registerIds.has(id)).toBe(true);
    }
    // An arm that must never ship says why, in the artifact itself.
    const leaky = artifact.arms.find((a) => !a.shippable);
    expect(leaky?.unshippableReason).toBeTruthy();
  });

  it("names the carryover arm's approximation rather than claiming Statbotics parity", () => {
    const carry = deviationRegister().find((d) => d.id === "carryover-scale-anchor")!;
    expect(carry.approximation).toBe("closest-walk-forward-legal");
    expect(ARM_IDS).toContain(CARRYOVER_FIX_ARM_ID);
  });
});

// ───────────────────────── threshold refinement (quick task 260911-3kc) ─────

describe("carryoverFixArm(id, minObs) — the threshold is THREADED, never defaulted", () => {
  // Each of these is a state the arm would be in mid-season, differing ONLY in
  // how many of the new season's own alliance scores have been folded. If
  // `minObs` were dropped anywhere between the arm's constructor and
  // `cleanSeasonMean`'s fourth parameter, every arm would silently behave like
  // the incumbent at 100 and the threshold comparison would measure three
  // copies of one arm while reporting them as three thresholds.
  const SEED_MEAN = 290;
  const REAL_MEAN = 60;

  function stateWithRealFolds(minObs: number, realCount: number): CarryoverFixState {
    const arm = carryoverFixArm("arm-under-test", minObs);
    const base = arm.initState(["frc1"]);
    const count = EPA_SCORE_SD_SEED_COUNT + realCount;
    const mean = (SEED_MEAN * EPA_SCORE_SD_SEED_COUNT + REAL_MEAN * realCount) / count;
    return {
      ...base,
      seedMean: SEED_MEAN,
      inner: { ...base.inner, allianceScoreStats: { count, mean, m2: 0 } },
    };
  }

  it("defers at 400 real folds and reads the ratio at 600 when built at minObs = 500", () => {
    expect(ratioForState(stateWithRealFolds(500, 400)).deferred).toBe(true);
    const readable = ratioForState(stateWithRealFolds(500, 600));
    expect(readable.deferred).toBe(false);
    expect(readable.ratio).toBeCloseTo(REAL_MEAN / SEED_MEAN, 9);
  });

  it("reads the ratio at BOTH 400 and 600 when built at minObs = 100", () => {
    expect(ratioForState(stateWithRealFolds(100, 400)).deferred).toBe(false);
    expect(ratioForState(stateWithRealFolds(100, 600)).deferred).toBe(false);
  });

  it("keeps the zero-argument call site on the incumbent threshold", () => {
    const arm = carryoverFixArm();
    expect(arm.id).toBe(CARRYOVER_FIX_ARM_ID);
    expect(arm.initState([]).minObs).toBe(EPA_CARRY_RESCALE_MIN_OBS);
  });
});

describe("contrastFor — a contrast names the arm it was actually measured AGAINST", () => {
  // A challenger measured against the INCUMBENT but labelled `baselineArmId:
  // "epa"` would be read as a vs-baseline effect and would invert the
  // selection decision: a challenger that is slightly better than plain EPA but
  // WORSE than the incumbent fix would look like a reason to adopt it.
  const units = [
    { eventKey: "2019week0", matchKey: "2019week0_qm1", diff: -0.02 },
    { eventKey: "2019week0", matchKey: "2019week0_qm2", diff: -0.01 },
    { eventKey: "2019ncwak", matchKey: "2019ncwak_qm1", diff: -0.03 },
    { eventKey: "2019ncwak", matchKey: "2019ncwak_qm2", diff: 0.01 },
  ];

  it("defaults to the baseline arm", () => {
    const row = contrastFor(CARRYOVER_FIX_MIN250_ARM_ID, "pooled", null, "brier", units);
    expect(row?.baselineArmId).toBe(BASELINE_ARM_ID);
  });

  it("records an explicit reference arm when one is supplied", () => {
    const row = contrastFor(
      CARRYOVER_FIX_MIN250_ARM_ID,
      "pooled",
      null,
      "brier",
      units,
      CARRYOVER_FIX_ARM_ID
    );
    expect(row?.baselineArmId).toBe(CARRYOVER_FIX_ARM_ID);
    expect(row?.armId).toBe(CARRYOVER_FIX_MIN250_ARM_ID);
  });

  it("records the reference arm on the identical-diffs short circuit too", () => {
    const zeros = units.map((u) => ({ ...u, diff: 0 }));
    const row = contrastFor(CARRYOVER_FIX_MIN500_ARM_ID, "onset", null, "brier", zeros, CARRYOVER_FIX_ARM_ID);
    expect(row?.verdict).toBe("identical");
    expect(row?.baselineArmId).toBe(CARRYOVER_FIX_ARM_ID);
  });
});

describe("selectThreshold — the pre-declared rule, executed by a function rather than by eye", () => {
  function contrast(
    armId: string,
    scope: Scope,
    metric: ContrastMetric,
    pointEstimate: number,
    lower: number,
    upper: number
  ): ContrastRow {
    return {
      armId,
      baselineArmId: CARRYOVER_FIX_ARM_ID,
      scope,
      season: null,
      metric,
      pointEstimate,
      standardError: 0.001,
      percentile: { lower, upper },
      eventCount: 100,
      matchCount: 5000,
      verdict: verdictFor(metric, lower, upper, pointEstimate),
      note: null,
    };
  }

  const CHALLENGERS = [
    { armId: CARRYOVER_FIX_MIN250_ARM_ID, minObs: 250 },
    { armId: CARRYOVER_FIX_MIN500_ARM_ID, minObs: 500 },
  ];
  const INCUMBENT = { armId: CARRYOVER_FIX_ARM_ID, minObs: EPA_CARRY_RESCALE_MIN_OBS };

  /** A challenger that is neutral on both guards — the guards must not be what decides. */
  function neutralGuards(armId: string): ContrastRow[] {
    return [
      contrast(armId, "pooled", "winnerAccuracy", 0.0001, -0.0009, 0.0011),
      contrast(armId, "pooled", "brier", -0.00001, -0.0002, 0.0002),
    ];
  }

  it("keeps the incumbent when every challenger's primary interval spans zero", () => {
    const rows = [
      ...neutralGuards(CARRYOVER_FIX_MIN250_ARM_ID),
      ...neutralGuards(CARRYOVER_FIX_MIN500_ARM_ID),
      contrast(CARRYOVER_FIX_MIN250_ARM_ID, "onset", "brier", -0.0004, -0.002, 0.0012),
      contrast(CARRYOVER_FIX_MIN500_ARM_ID, "onset", "brier", -0.0009, -0.0031, 0.0009),
    ];
    const decision = selectThreshold(rows, CHALLENGERS, INCUMBENT);
    expect(decision.selected).toBe(EPA_CARRY_RESCALE_MIN_OBS);
    expect(decision.selectedArmId).toBe(CARRYOVER_FIX_ARM_ID);
    expect(decision.reason).toMatch(/no challenger/i);
  });

  it("takes the SMALLER threshold when both challengers pass all three clauses", () => {
    const rows = [
      ...neutralGuards(CARRYOVER_FIX_MIN250_ARM_ID),
      ...neutralGuards(CARRYOVER_FIX_MIN500_ARM_ID),
      contrast(CARRYOVER_FIX_MIN250_ARM_ID, "onset", "brier", -0.004, -0.006, -0.002),
      contrast(CARRYOVER_FIX_MIN500_ARM_ID, "onset", "brier", -0.008, -0.01, -0.006),
    ];
    const decision = selectThreshold(rows, CHALLENGERS, INCUMBENT);
    expect(decision.selected).toBe(250);
    expect(decision.selectedArmId).toBe(CARRYOVER_FIX_MIN250_ARM_ID);
    expect(decision.reason).toMatch(/tie-break/i);
  });

  it("rejects a challenger whose pooled-season ACCURACY is definitively worse (guard 1)", () => {
    const rows = [
      contrast(CARRYOVER_FIX_MIN250_ARM_ID, "pooled", "winnerAccuracy", -0.003, -0.005, -0.001),
      contrast(CARRYOVER_FIX_MIN250_ARM_ID, "pooled", "brier", -0.00001, -0.0002, 0.0002),
      contrast(CARRYOVER_FIX_MIN250_ARM_ID, "onset", "brier", -0.004, -0.006, -0.002),
      ...neutralGuards(CARRYOVER_FIX_MIN500_ARM_ID),
      contrast(CARRYOVER_FIX_MIN500_ARM_ID, "onset", "brier", -0.0004, -0.002, 0.0012),
    ];
    const decision = selectThreshold(rows, CHALLENGERS, INCUMBENT);
    expect(decision.selected).toBe(EPA_CARRY_RESCALE_MIN_OBS);
    const rejected = decision.evaluations.find((e) => e.armId === CARRYOVER_FIX_MIN250_ARM_ID)!;
    expect(rejected.passed).toBe(false);
    expect(rejected.clause).toMatch(/guard 1/i);
  });

  it("rejects a challenger whose pooled-season BRIER is definitively worse (guard 2)", () => {
    const rows = [
      contrast(CARRYOVER_FIX_MIN500_ARM_ID, "pooled", "winnerAccuracy", 0.0001, -0.0009, 0.0011),
      contrast(CARRYOVER_FIX_MIN500_ARM_ID, "pooled", "brier", 0.003, 0.001, 0.005),
      contrast(CARRYOVER_FIX_MIN500_ARM_ID, "onset", "brier", -0.008, -0.01, -0.006),
      ...neutralGuards(CARRYOVER_FIX_MIN250_ARM_ID),
      contrast(CARRYOVER_FIX_MIN250_ARM_ID, "onset", "brier", -0.0004, -0.002, 0.0012),
    ];
    const decision = selectThreshold(rows, CHALLENGERS, INCUMBENT);
    expect(decision.selected).toBe(EPA_CARRY_RESCALE_MIN_OBS);
    const rejected = decision.evaluations.find((e) => e.armId === CARRYOVER_FIX_MIN500_ARM_ID)!;
    expect(rejected.passed).toBe(false);
    expect(rejected.clause).toMatch(/guard 2/i);
  });

  it("refuses to decide on a MISSING primary contrast rather than silently defaulting", () => {
    // An absent contrast is not evidence of no effect. Treating it as a quiet
    // "did not pass" would let a broken measurement look like a clean
    // keep-the-incumbent outcome, which is the one wrong answer that looks
    // exactly like the right one.
    const rows = [...neutralGuards(CARRYOVER_FIX_MIN250_ARM_ID), ...neutralGuards(CARRYOVER_FIX_MIN500_ARM_ID)];
    expect(() => selectThreshold(rows, CHALLENGERS, INCUMBENT)).toThrow(/primary contrast/i);
  });

  it("reads only contrasts measured against the INCUMBENT, never vs-baseline ones", () => {
    const vsBaseline = contrast(CARRYOVER_FIX_MIN250_ARM_ID, "onset", "brier", -0.04, -0.06, -0.02);
    const rows = [
      ...neutralGuards(CARRYOVER_FIX_MIN250_ARM_ID),
      ...neutralGuards(CARRYOVER_FIX_MIN500_ARM_ID),
      { ...vsBaseline, baselineArmId: BASELINE_ARM_ID },
      contrast(CARRYOVER_FIX_MIN250_ARM_ID, "onset", "brier", -0.0004, -0.002, 0.0012),
      contrast(CARRYOVER_FIX_MIN500_ARM_ID, "onset", "brier", -0.0009, -0.0031, 0.0009),
    ];
    const decision = selectThreshold(rows, CHALLENGERS, INCUMBENT);
    expect(decision.selected).toBe(EPA_CARRY_RESCALE_MIN_OBS);
  });
});

describe("the candidate set and the selection rule are literal data in the artifact", () => {
  it("declares exactly three candidates, with the incumbent among them", () => {
    expect(THRESHOLD_CANDIDATES).toHaveLength(3);
    expect(THRESHOLD_CANDIDATES).toContain(EPA_CARRY_RESCALE_MIN_OBS);
    // Strictly ascending — the tie-break says "smaller", which is only
    // meaningful against an ordered set.
    expect([...THRESHOLD_CANDIDATES]).toEqual([...THRESHOLD_CANDIDATES].sort((a, b) => a - b));
  });

  it("serializes the rule, the tie-break and the default into the artifact", () => {
    const artifact = buildArtifact({
      seasons: [2022, 2023],
      corpusPath: "data/corpus.sqlite",
      streamPopulation: "offseason-inclusive",
      rows: [],
      contrasts: [],
      census: emptyAblationCensus(),
      carryScale: [],
      deferredRescales: 0,
      rescaledTeams: 0,
      thresholdSelection: null,
    });
    const block = artifact.notes.thresholdSelection;
    expect(block.candidates).toHaveLength(3);
    expect(block.default).toBe(EPA_CARRY_RESCALE_MIN_OBS);
    expect(block.rule).toBeTruthy();
    expect(block.tieBreak).toMatch(/smaller/i);
    // `selected` is null until the run has actually produced one: a pre-filled
    // selection would be a decision made before the measurement existed.
    expect(block.selected).toBeNull();
  });

  it("carries all three carryover arms, each naming the same deviation", () => {
    expect(ARM_IDS).toContain(CARRYOVER_FIX_MIN250_ARM_ID);
    expect(ARM_IDS).toContain(CARRYOVER_FIX_MIN500_ARM_ID);
    const arms = armRegister();
    for (const id of [CARRYOVER_FIX_ARM_ID, CARRYOVER_FIX_MIN250_ARM_ID, CARRYOVER_FIX_MIN500_ARM_ID]) {
      expect(arms.find((a) => a.id === id)!.deviations).toEqual(["carryover-scale-anchor"]);
    }
    expect(deviationRegister().find((d) => d.id === "carryover-scale-anchor")!.armIds).toEqual([
      CARRYOVER_FIX_ARM_ID,
      CARRYOVER_FIX_MIN250_ARM_ID,
      CARRYOVER_FIX_MIN500_ARM_ID,
    ]);
  });

  it("bumps the schema version, because a consumer must now read baselineArmId", () => {
    expect(SCHEMA_VERSION).toBe(2);
  });
});
