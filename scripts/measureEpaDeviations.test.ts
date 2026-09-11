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
// MOVED to packages/ by quick task 260911-3kc — the blocks that exercised these
// five moved with them to epaCarryScale.test.ts. What is imported here is only
// what this file still asserts ABOUT them: that the arm threads its own
// threshold into `cleanSeasonMean`.
import { EPA_CARRY_RESCALE_MIN_OBS } from "../packages/core/algorithms/epaCarryScale.js";
import {
  ARM_IDS,
  armRegister,
  BASELINE_ARM_ID,
  buildArtifact,
  contrastFor,
  deviationRegister,
  emptyAblationCensus,
  exclusionReasonFor,
  finiteOrThrow,
  meanDiff,
  pairedAccuracyDiffs,
  pairedBrierDiffs,
  rescaledWinProbability,
  SCHEMA_VERSION,
  THRESHOLD_CANDIDATES,
  THRESHOLD_DEFAULT,
  THRESHOLD_SELECTION_OUTCOME,
  verdictFor,
  type ScorableRow,
} from "./measureEpaDeviations.js";

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
      neverSeenTeams: 0,
      carriedTeams: 0,
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

  it("still names the carryover approximation rather than claiming Statbotics parity, now that it SHIPS", () => {
    // Shipping the fix did not make it parity. The rescale is an ESTIMATE of
    // the incoming season's scale from that season's own folded scores, and a
    // team seen before enough of them exist forfeits it — so the label must
    // survive the arm that used to carry it.
    const carry = deviationRegister().find((d) => d.id === "carryover-scale-anchor")!;
    expect(carry.approximation).toBe("closest-walk-forward-legal");
    expect(carry.status).toBe("closed");
    expect(carry.armIds).toEqual([]);
  });
});

// ───────────────────────── threshold refinement (quick task 260911-3kc) ─────
//
// The blocks that exercised `carryoverFixArm`, `ratioForState` and
// `selectThreshold` are GONE, because those functions are gone: the carryover
// fix ships inside `epa@8.0.0+baseline`, so an arm that wrapped the shipped
// module would apply the rescale twice. What survives here is everything that
// is still live — the contrast's reference-arm field, and the frozen record of
// how the shipped threshold was chosen.

describe("contrastFor — a contrast names the arm it was actually measured AGAINST", () => {
  // A challenger measured against an INCUMBENT but labelled `baselineArmId:
  // "epa"` would be read as a vs-baseline effect and would invert a selection
  // decision: an arm can be better than plain EPA and worse than the variant
  // already shipping. The carryover challengers that made this concrete are
  // gone; the field stays in the schema, so its contract stays tested.
  const units = [
    { eventKey: "2019week0", matchKey: "2019week0_qm1", diff: -0.02 },
    { eventKey: "2019week0", matchKey: "2019week0_qm2", diff: -0.01 },
    { eventKey: "2019ncwak", matchKey: "2019ncwak_qm1", diff: -0.03 },
    { eventKey: "2019ncwak", matchKey: "2019ncwak_qm2", diff: 0.01 },
  ];
  const CHALLENGER = "some-challenger-arm";
  const REFERENCE = "some-reference-arm";

  it("defaults to the baseline arm", () => {
    expect(contrastFor(CHALLENGER, "pooled", null, "brier", units)?.baselineArmId).toBe(BASELINE_ARM_ID);
  });

  it("records an explicit reference arm when one is supplied", () => {
    const row = contrastFor(CHALLENGER, "pooled", null, "brier", units, REFERENCE);
    expect(row?.baselineArmId).toBe(REFERENCE);
    expect(row?.armId).toBe(CHALLENGER);
  });

  it("records the reference arm on the identical-diffs short circuit too", () => {
    const zeros = units.map((u) => ({ ...u, diff: 0 }));
    const row = contrastFor(CHALLENGER, "onset", null, "brier", zeros, REFERENCE);
    expect(row?.verdict).toBe("identical");
    expect(row?.baselineArmId).toBe(REFERENCE);
  });
});

describe("the threshold decision survives as literal data after its arms were deleted", () => {
  it("declares exactly three candidates, strictly ascending, with the shipped value among them", () => {
    expect(THRESHOLD_CANDIDATES).toHaveLength(3);
    expect(THRESHOLD_CANDIDATES).toContain(THRESHOLD_SELECTION_OUTCOME.selected);
    // The tie-break says "smaller", which is only meaningful against an order.
    expect([...THRESHOLD_CANDIDATES]).toEqual([...THRESHOLD_CANDIDATES].sort((a, b) => a - b));
    // The INCUMBENT at measurement time was the smallest candidate. It is NOT
    // the shipped constant any more, and conflating the two would rewrite what
    // the challengers were measured against.
    expect(THRESHOLD_DEFAULT).toBe(THRESHOLD_CANDIDATES[0]);
  });

  it("keeps the frozen record in step with the constant the model actually runs at", () => {
    // These two moving apart is the failure this pins: a decision record that
    // describes a threshold nothing uses reads exactly like a decision record
    // that describes the shipped one.
    expect(EPA_CARRY_RESCALE_MIN_OBS).toBe(THRESHOLD_SELECTION_OUTCOME.selected);
  });

  it("records every challenger it evaluated, passing or not, with the clause that decided it", () => {
    expect(THRESHOLD_SELECTION_OUTCOME.evaluations).toHaveLength(2);
    for (const evaluation of THRESHOLD_SELECTION_OUTCOME.evaluations) {
      expect(evaluation.clause).toBeTruthy();
      expect(Number.isFinite(evaluation.onsetBrier)).toBe(true);
      expect(THRESHOLD_CANDIDATES).toContain(evaluation.minObs);
    }
    // The winner is the SMALLEST passing threshold — the recorded tie-break.
    const passing = THRESHOLD_SELECTION_OUTCOME.evaluations.filter((e) => e.passed).map((e) => e.minObs);
    expect(Math.min(...passing)).toBe(THRESHOLD_SELECTION_OUTCOME.selected);
  });

  it("serializes the rule, the tie-break, the default and the shipped constant into the artifact", () => {
    const artifact = buildArtifact({
      seasons: [2022, 2023],
      corpusPath: "data/corpus.sqlite",
      streamPopulation: "offseason-inclusive",
      rows: [],
      contrasts: [],
      census: emptyAblationCensus(),
      carryScale: [],
      neverSeenTeams: 0,
      carriedTeams: 0,
    });
    const block = artifact.notes.thresholdSelection;
    expect(block.candidates).toHaveLength(3);
    expect(block.default).toBe(THRESHOLD_DEFAULT);
    expect(block.rule).toBeTruthy();
    expect(block.tieBreak).toMatch(/smaller/i);
    expect(block.selected).toBe(THRESHOLD_SELECTION_OUTCOME.selected);
    expect(block.shippedConstant).toBe(EPA_CARRY_RESCALE_MIN_OBS);
    expect(block.reason).toMatch(/not independently confirmed/i);
  });

  it("carries NO carryover arm, and says so by absence", () => {
    // The load-bearing assertion of this whole closeout: an arm that wrapped
    // the shipped module would now apply the rescale twice, so its return would
    // be measured as "the fix" while being a double-apply.
    for (const armId of ARM_IDS) expect(armId).not.toMatch(/carryover/);
    for (const arm of armRegister()) expect(arm.id).not.toMatch(/carryover/);
  });

  it("closes the deviation while KEEPING its measurement", () => {
    const carry = deviationRegister().find((d) => d.id === "carryover-scale-anchor")!;
    expect(carry.status).toBe("closed");
    expect(carry.armIds).toEqual([]);
    expect(carry.priorMeasurement).not.toBeNull();
    expect(carry.priorMeasurement!.thresholdSelection).toEqual(THRESHOLD_SELECTION_OUTCOME);
    // The regression is recorded, not quietly dropped along with the arm.
    const labels = carry.priorMeasurement!.values.map((v) => v.label).join(" | ");
    expect(labels).toMatch(/WORSE/);
    // It is still an APPROXIMATION of Statbotics, not parity.
    expect(carry.approximation).toBe("closest-walk-forward-legal");
  });

  it("keeps the schema version, because a consumer must read baselineArmId", () => {
    expect(SCHEMA_VERSION).toBe(2);
  });
});
