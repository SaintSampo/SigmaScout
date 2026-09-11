/**
 * Unit tests for `measureAllianceReconstruction.ts`'s pure helpers.
 *
 * The measurement LOOP announces its own health on the console: it prints an
 * exclusion census, an `eventCount` beside every interval, and a verdict line
 * that reads "REFUTED" as fluently as "SUPPORTED". What is tested HERE is
 * everything that could be silently wrong in a way no console output would
 * reveal, because each of these produces a plausible number and a false
 * conclusion:
 *
 *   - a `signedMean` that quietly returns the same thing as `mae`, making the
 *     bias column a second copy of the magnitude column;
 *   - a `tierOf` that folds Championship divisions and Einstein together (the
 *     exact shape `EVENT_TYPE_TIERS` already has), which would bury the ~200
 *     Einstein observations inside 11,000 division ones;
 *   - a `correctedOutputs` that throws or silently zeroes a score when TBA's
 *     breakdown is missing or malformed;
 *   - a side-exclusion predicate that drops a whole match where only one
 *     alliance was DQ-zeroed, halving the population for no reason;
 *   - a paired-difference builder that ZERO-FILLS a missing counterpart, which
 *     dilutes every contrast toward zero and manufactures a false
 *     "indistinguishable" — the one failure mode that would let this script
 *     report no finding at all and look correct doing it;
 *   - a `verdictFor` that resolves a zero-spanning interval by the point
 *     estimate's sign, turning noise into a claim.
 */
import { describe, expect, it } from "vitest";
import {
  correctedOutputs,
  emptyCensus,
  errorsOf,
  mae,
  matchExclusion,
  meanDiff,
  pairedAbsErrorDiffs,
  parseSeasons,
  rmse,
  sideExclusion,
  sideKey,
  signedMean,
  statsFor,
  strengthBucketIndex,
  tierOf,
  verdictFor,
  type Observation,
} from "./measureAllianceReconstruction.js";

describe("mae / rmse / signedMean", () => {
  it("computes all three over a known list", () => {
    expect(mae([1, -2, 3, -4])).toBe(2.5);
    expect(rmse([3, -4])).toBeCloseTo(Math.sqrt(12.5), 12);
    expect(signedMean([1, -2, 3, -4])).toBe(-0.5);
  });

  it("signedMean keeps sign where mae does not — the case that proves they are two different columns", () => {
    // A model that misses by +5 half the time and -5 the other half is badly
    // calibrated but UNBIASED. If these two columns ever agreed here, the
    // report would be printing the same number twice under two headings.
    expect(mae([-5, 5])).toBe(5);
    expect(signedMean([-5, 5])).toBe(0);
  });

  it("signedMean equals mae when every miss is in the same direction — systematic over-prediction", () => {
    expect(mae([5, 5, 5])).toBe(5);
    expect(signedMean([5, 5, 5])).toBe(5);
  });

  it("returns NaN on an empty list rather than 0 — an empty sample has no mean, and 0 would read as perfection", () => {
    expect(mae([])).toBeNaN();
    expect(rmse([])).toBeNaN();
    expect(signedMean([])).toBeNaN();
  });
});

describe("tierOf", () => {
  it("keeps Championship divisions and Einstein as SEPARATE tiers", () => {
    // THE REGRESSION THAT MATTERS. `EVENT_TYPE_TIERS` in
    // packages/core/rankingPoints/constants.ts collapses 3 and 4 into one
    // `championship` tier. Reusing it here would hide ~200 Einstein
    // observations inside ~11,000 division ones, which is the single most
    // stacked field in the sport disappearing into the average.
    expect(tierOf(3)).toBe("champsDivision");
    expect(tierOf(4)).toBe("einstein");
    expect(tierOf(3)).not.toBe(tierOf(4));
  });

  it("folds both district-championship types together and NOT into Championship", () => {
    expect(tierOf(2)).toBe("districtChampionship");
    expect(tierOf(5)).toBe("districtChampionship");
    expect(tierOf(2)).not.toBe(tierOf(3));
  });

  it("maps regional and district to the base control tier", () => {
    expect(tierOf(0)).toBe("base");
    expect(tierOf(1)).toBe("base");
  });

  it("maps Festival of Champions to its own tier", () => {
    expect(tierOf(6)).toBe("festivalOfChampions");
  });

  it("returns null for offseason and preseason — replayed, never scored", () => {
    expect(tierOf(99)).toBeNull();
    expect(tierOf(100)).toBeNull();
  });

  it("THROWS on an unregistered type rather than defaulting it into a bucket", () => {
    expect(() => tierOf(7)).toThrow(/unregistered TBA event_type 7/);
    expect(() => tierOf(-1)).toThrow(/unregistered TBA event_type -1/);
  });
});

describe("correctedOutputs", () => {
  it("subtracts foulPoints AND adjustPoints on both sides", () => {
    const raw = JSON.stringify({
      red: { foulPoints: 12, adjustPoints: -3 },
      blue: { foulPoints: 5, adjustPoints: 0 },
    });
    expect(correctedOutputs(raw, 100, 80)).toEqual({ red: 100 - 12 - -3, blue: 80 - 5 - 0 });
  });

  it("yields the raw score unchanged when TBA omitted the breakdown entirely", () => {
    expect(correctedOutputs(null, 100, 80)).toEqual({ red: 100, blue: 80 });
  });

  it("yields the raw score unchanged on malformed JSON rather than throwing", () => {
    // A throw here would take out a whole nine-season run over one bad row.
    expect(correctedOutputs("{not json", 100, 80)).toEqual({ red: 100, blue: 80 });
  });

  it("yields the raw score unchanged when the breakdown has no foul/adjust fields", () => {
    expect(correctedOutputs(JSON.stringify({ red: {}, blue: {} }), 100, 80)).toEqual({ red: 100, blue: 80 });
  });
});

describe("matchExclusion / sideExclusion", () => {
  const cleanMatch = {
    redSurrogates: [] as readonly string[],
    blueSurrogates: [] as readonly string[],
    redTeams: ["frc1", "frc2", "frc3"] as readonly string[],
    blueTeams: ["frc4", "frc5", "frc6"] as readonly string[],
  };

  it("keeps an ordinary match", () => {
    expect(matchExclusion(cleanMatch, false)).toBeNull();
  });

  it("excludes a surrogate-affected match from either side (harness D-07)", () => {
    expect(matchExclusion({ ...cleanMatch, redSurrogates: ["frc1"] }, false)).toBe("surrogateAffected");
    expect(matchExclusion({ ...cleanMatch, blueSurrogates: ["frc4"] }, false)).toBe("surrogateAffected");
  });

  it("excludes a cold-start record, reading runAll's stamp rather than re-deriving it", () => {
    expect(matchExclusion(cleanMatch, true)).toBe("coldStart");
  });

  it("excludes a fully-demo alliance", () => {
    expect(matchExclusion({ ...cleanMatch, redTeams: ["frc9990", "frc9991", "frc9992"] }, false)).toBe(
      "fullyDemoAlliance"
    );
  });

  it("excludes a DQ-zeroed SIDE while keeping its healthy opposite side", () => {
    const dqd = { teams: ["frc1", "frc2", "frc3"], dqs: ["frc1", "frc2", "frc3"], actual: 0, predicted: 90 };
    const healthy = { teams: ["frc4", "frc5", "frc6"], dqs: [], actual: 120, predicted: 110 };
    expect(sideExclusion(dqd)).toBe("dqZeroedSide");
    expect(sideExclusion(healthy)).toBeNull();
  });

  it("excludes a side whose predicted or actual value is not finite", () => {
    expect(sideExclusion({ teams: ["frc1"], dqs: [], actual: 100, predicted: Number.NaN })).toBe("nonFiniteValue");
    expect(sideExclusion({ teams: ["frc1"], dqs: [], actual: Number.POSITIVE_INFINITY, predicted: 5 })).toBe(
      "nonFiniteValue"
    );
  });

  it("emptyCensus starts every counter at zero so a missing reason cannot read as 'none happened'", () => {
    expect(Object.values(emptyCensus()).every((v) => v === 0)).toBe(true);
  });
});

// ── shared fixture for the paired / bucketing / stats tests ────────────────

function obs(partial: Partial<Observation> & Pick<Observation, "matchKey" | "algorithmId">): Observation {
  return {
    season: 2026,
    eventKey: partial.eventKey ?? "2026evt",
    eventType: 0,
    tier: "base",
    compLevel: "qm",
    side: "red",
    predicted: 100,
    actualRaw: 100,
    actualCorrected: 100,
    rosterSize: 3,
    strengthRef: 100,
    ...partial,
  };
}

describe("errorsOf / statsFor", () => {
  it("signs the error as predicted - actual, so POSITIVE means the model OVER-predicted", () => {
    const rows = [obs({ matchKey: "m1", algorithmId: "bpr", predicted: 150, actualCorrected: 100, actualRaw: 120 })];
    expect(errorsOf(rows, "corrected")).toEqual([50]);
    expect(errorsOf(rows, "raw")).toEqual([30]);
  });

  it("reports mean predicted and mean actual beside the errors, per target", () => {
    const rows = [
      obs({ matchKey: "m1", algorithmId: "bpr", predicted: 150, actualCorrected: 100, actualRaw: 120 }),
      obs({ matchKey: "m2", algorithmId: "bpr", predicted: 50, actualCorrected: 100, actualRaw: 120 }),
    ];
    const s = statsFor(rows, "corrected");
    expect(s.n).toBe(2);
    expect(s.mae).toBe(50);
    expect(s.signed).toBe(0); // +50 and -50 cancel — unbiased, badly calibrated
    expect(s.meanPredicted).toBe(100);
    expect(s.meanActual).toBe(100);
  });
});

describe("pairedAbsErrorDiffs", () => {
  it("pairs on (matchKey, side) and differences the ABSOLUTE errors", () => {
    const a = [obs({ matchKey: "m1", side: "red", algorithmId: "bpr", predicted: 130, actualCorrected: 100 })];
    const b = [obs({ matchKey: "m1", side: "red", algorithmId: "epa", predicted: 90, actualCorrected: 100 })];
    const units = pairedAbsErrorDiffs(a, b, "corrected");
    expect(units).toHaveLength(1);
    expect(units[0]!.diff).toBe(30 - 10);
    expect(units[0]!.eventKey).toBe("2026evt");
  });

  it("never pairs red against blue — the same matchKey on the other side is NOT a counterpart", () => {
    const a = [obs({ matchKey: "m1", side: "red", algorithmId: "bpr", predicted: 130, actualCorrected: 100 })];
    const b = [obs({ matchKey: "m1", side: "blue", algorithmId: "epa", predicted: 90, actualCorrected: 100 })];
    expect(pairedAbsErrorDiffs(a, b, "corrected")).toHaveLength(0);
  });

  it("DROPS an observation with no counterpart rather than zero-filling it", () => {
    // A zero-filled row asserts "the two models tied here". That dilutes the
    // contrast toward zero and manufactures a false "indistinguishable" — the
    // one silent failure that would let this script report no finding at all.
    const a = [
      obs({ matchKey: "m1", algorithmId: "bpr", predicted: 130, actualCorrected: 100 }),
      obs({ matchKey: "m2", algorithmId: "bpr", predicted: 130, actualCorrected: 100 }),
    ];
    const b = [obs({ matchKey: "m1", algorithmId: "epa", predicted: 100, actualCorrected: 100 })];
    const units = pairedAbsErrorDiffs(a, b, "corrected");
    expect(units).toHaveLength(1);
    expect(units.map((u) => u.matchKey)).toEqual(["m1"]);
    expect(meanDiff(units)).toBe(30); // NOT 15, which is what zero-filling m2 would give
  });

  it("meanDiff is NaN on an empty pairing rather than 0", () => {
    expect(meanDiff([])).toBeNaN();
  });

  it("sideKey distinguishes the two alliances of one match", () => {
    expect(sideKey("m1", "red")).not.toBe(sideKey("m1", "blue"));
  });
});

describe("verdictFor", () => {
  it("reports SUPPORTED only when the interval excludes zero on the negative side", () => {
    expect(verdictFor(-40, -20, -30)).toBe("supported");
  });

  it("reports REFUTED when the interval excludes zero on the positive side", () => {
    expect(verdictFor(19.8, 40.0, 29.6)).toBe("refuted");
  });

  it("reports INDISTINGUISHABLE whenever the interval spans zero, never resolving it by the point estimate", () => {
    expect(verdictFor(-0.37, 0.15, -0.13)).toBe("indistinguishable");
    expect(verdictFor(-5, 5, 4.9)).toBe("indistinguishable");
    expect(verdictFor(0, 10, 5)).toBe("indistinguishable"); // touching zero is not excluding it
    expect(verdictFor(-10, 0, -5)).toBe("indistinguishable");
  });

  it("reports UNMEASURABLE rather than inventing a verdict from a non-finite interval", () => {
    expect(verdictFor(Number.NaN, Number.NaN, Number.NaN)).toBe("unmeasurable");
  });
});

describe("strengthBucketIndex", () => {
  it("deduplicates to match-sides before bucketing, so one match-side cannot be counted three times", () => {
    // The same 4 match-sides seen by 3 algorithms = 12 observations. Bucketed
    // naively that is 12 rows into 2 buckets of 6; deduplicated it is 4 rows
    // into 2 buckets of 2, which is the only edge set every algorithm shares.
    const rows: Observation[] = [];
    for (const algorithmId of ["opr", "epa", "bpr"]) {
      for (const [i, strengthRef] of [10, 20, 30, 40].entries()) {
        rows.push(obs({ matchKey: `m${i}`, algorithmId, strengthRef }));
      }
    }
    const assignment = strengthBucketIndex(rows, 2);
    expect(assignment.size).toBe(4);
    expect(assignment.get(sideKey("m0", "red"))).toBe(0);
    expect(assignment.get(sideKey("m1", "red"))).toBe(0);
    expect(assignment.get(sideKey("m2", "red"))).toBe(1);
    expect(assignment.get(sideKey("m3", "red"))).toBe(1);
  });

  it("assigns every match-side to exactly one bucket, dropping none", () => {
    const rows = Array.from({ length: 17 }, (_, i) => obs({ matchKey: `m${i}`, algorithmId: "bpr", strengthRef: i }));
    const assignment = strengthBucketIndex(rows, 5);
    expect(assignment.size).toBe(17);
  });
});

describe("parseSeasons (reused from measureSwingSkill.ts)", () => {
  it("expands a range", () => {
    expect(parseSeasons("2024-2026")).toEqual([2024, 2025, 2026]);
  });

  it("accepts a comma-separated mix of ranges and single years, which the GAPPED corpus requires", () => {
    // 2021 is permanently absent (the remote season) and 2020 has no
    // Championship, so the default spec is a gapped list, not one range.
    expect(parseSeasons("2016-2019,2022-2026")).toEqual([
      2016, 2017, 2018, 2019, 2022, 2023, 2024, 2025, 2026,
    ]);
  });

  it("de-duplicates and sorts ascending", () => {
    expect(parseSeasons("2026,2024-2025,2026,2024")).toEqual([2024, 2025, 2026]);
  });
});
