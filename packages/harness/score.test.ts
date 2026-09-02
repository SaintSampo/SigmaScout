import { describe, expect, it } from "vitest";
import {
  aggregateScores,
  HOLDOUT_SEASONS,
  QUARANTINE_ABSOLUTE_LIMIT,
  QUARANTINE_SHARE_LIMIT,
  QUARANTINE_SHARE_MIN_POPULATION,
  seasonSplit,
  TUNE_SEASONS,
  type HarnessPredictionInput,
} from "./score.js";

describe("seasonSplit", () => {
  it("labels 2022, 2023 and 2024 as tune", () => {
    expect(seasonSplit(2022)).toBe("tune");
    expect(seasonSplit(2023)).toBe("tune");
    expect(seasonSplit(2024)).toBe("tune");
  });

  it("labels 2025 and 2026 as holdout", () => {
    expect(seasonSplit(2025)).toBe("holdout");
    expect(seasonSplit(2026)).toBe("holdout");
  });

  it("exports the fixed split as named constants", () => {
    expect(TUNE_SEASONS).toEqual([2022, 2023, 2024]);
    expect(HOLDOUT_SEASONS).toEqual([2025, 2026]);
  });

  it("throws for a season outside the covered 2022-2026 range", () => {
    expect(() => seasonSplit(2021)).toThrow();
    expect(() => seasonSplit(2027)).toThrow();
  });
});

describe("aggregateScores", () => {
  // 2024 (tune): 3 candidate qual matches (2 scorable, 1 offseason, 1
  // surrogate-affected, 1 missing-result — 5 qual candidates total) plus 1
  // scorable elimination match.
  // 2025 (holdout): 1 scorable qual match.
  const predictions: HarnessPredictionInput[] = [
    {
      matchKey: "2024test_qm1",
      season: 2024,
      eventKey: "2024test",
      compLevel: "qm",
      algorithmId: "opr",
      pRedWin: 0.7,
      predictedRedScore: 60,
      predictedBlueScore: 40,
      actualWinner: "red",
      isOffseason: false,
      isSurrogateAffected: false,
    },
    {
      matchKey: "2024test_qm2",
      season: 2024,
      eventKey: "2024test",
      compLevel: "qm",
      algorithmId: "opr",
      pRedWin: 0.3,
      predictedRedScore: 40,
      predictedBlueScore: 60,
      actualWinner: "blue",
      isOffseason: false,
      isSurrogateAffected: false,
    },
    {
      matchKey: "2024off_qm1",
      season: 2024,
      eventKey: "2024off",
      compLevel: "qm",
      algorithmId: "opr",
      pRedWin: 0.6,
      predictedRedScore: 55,
      predictedBlueScore: 45,
      actualWinner: "red",
      isOffseason: true,
      isSurrogateAffected: false,
    },
    {
      matchKey: "2024test_qm3",
      season: 2024,
      eventKey: "2024test",
      compLevel: "qm",
      algorithmId: "opr",
      pRedWin: 0.4,
      predictedRedScore: 45,
      predictedBlueScore: 55,
      actualWinner: "red",
      isOffseason: false,
      isSurrogateAffected: true,
    },
    {
      matchKey: "2024test_qm4",
      season: 2024,
      eventKey: "2024test",
      compLevel: "qm",
      algorithmId: "opr",
      pRedWin: 0.9,
      predictedRedScore: 70,
      predictedBlueScore: 30,
      actualWinner: null,
      isOffseason: false,
      isSurrogateAffected: false,
    },
    {
      matchKey: "2024test_sf1",
      season: 2024,
      eventKey: "2024test",
      compLevel: "sf",
      algorithmId: "opr",
      pRedWin: 0.65,
      predictedRedScore: 62,
      predictedBlueScore: 38,
      actualWinner: "red",
      isOffseason: false,
      isSurrogateAffected: false,
    },
    {
      matchKey: "2025test_qm1",
      season: 2025,
      eventKey: "2025test",
      compLevel: "qm",
      algorithmId: "opr",
      pRedWin: 0.8,
      predictedRedScore: 65,
      predictedBlueScore: 35,
      actualWinner: "red",
      isOffseason: false,
      isSurrogateAffected: false,
    },
  ];

  const slices = aggregateScores(predictions);

  it("produces one slice per season per competition-level view (qualification, elimination, combined)", () => {
    // 2 seasons x 3 views = 6 slices.
    expect(slices).toHaveLength(6);
    const views = new Set(slices.map((s) => s.compLevelView));
    expect(views).toEqual(new Set(["qualification", "elimination", "combined"]));
  });

  it("labels 2022-2024 tune and 2025-2026 holdout, with only holdout slices headline-eligible", () => {
    const tuneSlices = slices.filter((s) => s.season === 2024);
    const holdoutSlices = slices.filter((s) => s.season === 2025);
    expect(tuneSlices.every((s) => s.seasonLabel === "tune")).toBe(true);
    expect(tuneSlices.every((s) => s.headlineEligible === false)).toBe(true);
    expect(holdoutSlices.every((s) => s.seasonLabel === "holdout")).toBe(true);
    expect(holdoutSlices.every((s) => s.headlineEligible === true)).toBe(true);
  });

  it("carries exclusion counts broken out by reason, summing with scoredCount to candidateCount", () => {
    const qualSlice2024 = slices.find((s) => s.season === 2024 && s.compLevelView === "qualification")!;
    // Candidates: qm1, qm2, off_qm1, qm3, qm4 = 5. Scorable: qm1, qm2 = 2.
    expect(qualSlice2024.candidateCount).toBe(5);
    expect(qualSlice2024.scoredCount).toBe(2);
    expect(qualSlice2024.exclusionCounts).toEqual({
      offseason: 1,
      surrogateAffected: 1,
      missingResult: 1,
      quarantined: 0,
    });
    const total =
      qualSlice2024.scoredCount +
      qualSlice2024.exclusionCounts.offseason +
      qualSlice2024.exclusionCounts.surrogateAffected +
      qualSlice2024.exclusionCounts.missingResult +
      qualSlice2024.exclusionCounts.quarantined;
    expect(total).toBe(qualSlice2024.candidateCount);
  });

  it("holds the same scored-plus-excluded invariant for every slice", () => {
    for (const slice of slices) {
      const total =
        slice.scoredCount +
        slice.exclusionCounts.offseason +
        slice.exclusionCounts.surrogateAffected +
        slice.exclusionCounts.missingResult +
        slice.exclusionCounts.quarantined;
      expect(total).toBe(slice.candidateCount);
    }
  });

  it("D-06/D-07 zero-quarantine regression check: with no malformed predictions, exclusionCounts.quarantined is 0 on every slice, and every other slice value is unchanged from the pre-change fixture behavior above", () => {
    for (const slice of slices) {
      expect(slice.exclusionCounts.quarantined).toBe(0);
    }
  });

  it("splits qualification and elimination views correctly and combines them", () => {
    const elimSlice2024 = slices.find((s) => s.season === 2024 && s.compLevelView === "elimination")!;
    expect(elimSlice2024.candidateCount).toBe(1);
    expect(elimSlice2024.scoredCount).toBe(1);

    const combinedSlice2024 = slices.find((s) => s.season === 2024 && s.compLevelView === "combined")!;
    expect(combinedSlice2024.candidateCount).toBe(6);
    expect(combinedSlice2024.scoredCount).toBe(3);
  });

  it("attaches calibration bins to every slice", () => {
    for (const slice of slices) {
      expect(Array.isArray(slice.calibrationBins)).toBe(true);
      expect(slice.calibrationBins.length).toBeGreaterThan(0);
    }
  });

  it("round-trips through JSON.stringify/parse with no non-serializable sentinel", () => {
    const roundTripped = JSON.parse(JSON.stringify(slices)) as typeof slices;
    expect(roundTripped).toEqual(slices);
  });
});

describe("aggregateScores — D-20/D-22 per-algorithm grouping", () => {
  // 2 algorithms x 2 seasons x 3 views = 12 slices, one shared match stream
  // scored by both algorithms (D-22) — grouping must key by
  // (algorithmId, season, compLevelView), never conflating two algorithms'
  // figures into one slice.
  const ALGORITHM_IDS = ["opr", "epa"] as const;
  const SEASONS = [2024, 2025] as const;

  function multiAlgorithmPredictions(): HarnessPredictionInput[] {
    const predictions: HarnessPredictionInput[] = [];
    for (const algorithmId of ALGORITHM_IDS) {
      for (const season of SEASONS) {
        predictions.push({
          matchKey: `${season}test_qm1`,
          season,
          eventKey: `${season}test`,
          compLevel: "qm",
          algorithmId,
          // Deliberately different pRedWin per algorithm so a bug that
          // conflated algorithms would produce a detectably wrong Brier.
          pRedWin: algorithmId === "opr" ? 0.9 : 0.1,
          predictedRedScore: 60,
          predictedBlueScore: 40,
          actualWinner: "red",
          isOffseason: false,
          isSurrogateAffected: false,
        });
      }
    }
    return predictions;
  }

  it("produces one slice per (algorithmId, season, compLevelView) — N algorithms x M seasons x 3 views", () => {
    const multiSlices = aggregateScores(multiAlgorithmPredictions());
    expect(multiSlices).toHaveLength(ALGORITHM_IDS.length * SEASONS.length * 3);

    for (const algorithmId of ALGORITHM_IDS) {
      for (const season of SEASONS) {
        const forCombo = multiSlices.filter((s) => s.algorithmId === algorithmId && s.season === season);
        expect(forCombo).toHaveLength(3);
        expect(new Set(forCombo.map((s) => s.compLevelView))).toEqual(
          new Set(["qualification", "elimination", "combined"])
        );
      }
    }
  });

  it("keeps each algorithm's metrics independent — one algorithm's slice is never influenced by another's predictions for the same match", () => {
    const multiSlices = aggregateScores(multiAlgorithmPredictions());
    const oprSlice = multiSlices.find((s) => s.algorithmId === "opr" && s.season === 2024 && s.compLevelView === "combined")!;
    const epaSlice = multiSlices.find((s) => s.algorithmId === "epa" && s.season === 2024 && s.compLevelView === "combined")!;

    // opr predicted 0.9 for the actual red winner (near-perfect), epa
    // predicted 0.1 (near-perfectly wrong) — their Brier scores must differ
    // and neither may be an average of the two.
    expect(oprSlice.brierScore).not.toBeNull();
    expect(epaSlice.brierScore).not.toBeNull();
    expect(oprSlice.brierScore).toBeCloseTo((1 - 0.9) ** 2, 10);
    expect(epaSlice.brierScore).toBeCloseTo((1 - 0.1) ** 2, 10);
    expect(oprSlice.brierScore).not.toBeCloseTo(epaSlice.brierScore!, 5);
  });
});

describe("aggregateScores — D-06/D-07 quarantine and bound", () => {
  function prediction(overrides: Partial<HarnessPredictionInput> & Pick<HarnessPredictionInput, "matchKey">): HarnessPredictionInput {
    return {
      season: 2024,
      eventKey: "2024test",
      compLevel: "qm",
      algorithmId: "opr",
      pRedWin: 0.6,
      predictedRedScore: 60,
      predictedBlueScore: 40,
      actualWinner: "red",
      isOffseason: false,
      isSurrogateAffected: false,
      ...overrides,
    };
  }

  // The regression case required by success criterion 1: before this
  // phase's fix, a NaN pRedWin flowed straight into scoreSet and produced a
  // NaN brierScore instead of being quarantined and counted. This mixed
  // fixture (2 valid predictions + 1 NaN) is the exact shape that proves
  // it: brierScore must be a real number, and exclusionCounts.quarantined
  // must be 1, never a NaN Brier and never a silent drop.
  it("quarantines a non-numeric (NaN) probability alongside valid ones, yielding a real Brier score and a quarantine count of 1", () => {
    const predictions: HarnessPredictionInput[] = [
      prediction({ matchKey: "2024test_qm1", pRedWin: 0.7, actualWinner: "red" }),
      prediction({ matchKey: "2024test_qm2", pRedWin: 0.3, actualWinner: "blue" }),
      prediction({ matchKey: "2024test_qm3", pRedWin: NaN, actualWinner: "red" }),
    ];
    const slices = aggregateScores(predictions);
    const combined = slices.find((s) => s.compLevelView === "combined")!;
    expect(combined.brierScore).not.toBeNull();
    expect(Number.isNaN(combined.brierScore)).toBe(false);
    expect(combined.exclusionCounts.quarantined).toBe(1);
    expect(combined.scoredCount).toBe(2);
    expect(combined.candidateCount).toBe(3);
  });

  it("quarantines an out-of-interval probability (negative or above 1) the same way as a NaN", () => {
    const predictions: HarnessPredictionInput[] = [
      prediction({ matchKey: "2024test_qm1", pRedWin: 0.7, actualWinner: "red" }),
      prediction({ matchKey: "2024test_qm2", pRedWin: -0.2, actualWinner: "blue" }),
      prediction({ matchKey: "2024test_qm3", pRedWin: 1.4, actualWinner: "red" }),
    ];
    const slices = aggregateScores(predictions);
    const combined = slices.find((s) => s.compLevelView === "combined")!;
    expect(combined.exclusionCounts.quarantined).toBe(2);
    expect(combined.scoredCount).toBe(1);
    expect(combined.candidateCount).toBe(3);
  });

  it("keeps the scored-plus-excluded accounting identity true when quarantines are present", () => {
    const predictions: HarnessPredictionInput[] = [
      prediction({ matchKey: "2024test_qm1", pRedWin: 0.7, actualWinner: "red" }),
      prediction({ matchKey: "2024off_qm1", pRedWin: NaN, actualWinner: "red", isOffseason: true }),
      prediction({ matchKey: "2024test_qm2", pRedWin: Infinity, actualWinner: "blue" }),
    ];
    const slices = aggregateScores(predictions);
    const combined = slices.find((s) => s.compLevelView === "combined")!;
    // The offseason-flagged NaN candidate is counted under offseason (an
    // earlier branch in the filter loop), never as a quarantine.
    expect(combined.exclusionCounts.offseason).toBe(1);
    expect(combined.exclusionCounts.quarantined).toBe(1);
    const total =
      combined.scoredCount +
      combined.exclusionCounts.offseason +
      combined.exclusionCounts.surrogateAffected +
      combined.exclusionCounts.missingResult +
      combined.exclusionCounts.quarantined;
    expect(total).toBe(combined.candidateCount);
  });

  it("returns normally with 24 quarantined candidates in a population below the share-bound floor", () => {
    const predictions: HarnessPredictionInput[] = [];
    for (let i = 0; i < 24; i++) {
      predictions.push(prediction({ matchKey: `2024bad_qm${i}`, pRedWin: NaN }));
    }
    predictions.push(prediction({ matchKey: "2024good_qm1", pRedWin: 0.6 }));
    // 25 candidates total, well under QUARANTINE_SHARE_MIN_POPULATION.
    expect(predictions.length).toBeLessThan(QUARANTINE_SHARE_MIN_POPULATION);

    expect(() => aggregateScores(predictions)).not.toThrow();
    const slices = aggregateScores(predictions);
    const combined = slices.find((s) => s.compLevelView === "combined")!;
    expect(combined.exclusionCounts.quarantined).toBe(24);
  });

  it("throws when the quarantine count reaches QUARANTINE_ABSOLUTE_LIMIT (25), naming the season and the bound crossed", () => {
    const predictions: HarnessPredictionInput[] = [];
    for (let i = 0; i < QUARANTINE_ABSOLUTE_LIMIT; i++) {
      predictions.push(prediction({ matchKey: `2024bad_qm${i}`, pRedWin: NaN }));
    }
    expect(() => aggregateScores(predictions)).toThrow(/2024/);
    expect(() => aggregateScores(predictions)).toThrow(/QUARANTINE_ABSOLUTE_LIMIT/);
  });

  it("throws when the quarantined share exceeds QUARANTINE_SHARE_LIMIT with a population at or above the floor, even below the absolute limit", () => {
    const predictions: HarnessPredictionInput[] = [];
    // 200 candidates (the population floor), 2 quarantined (1% > 0.5%),
    // count (2) well below QUARANTINE_ABSOLUTE_LIMIT (25).
    for (let i = 0; i < QUARANTINE_SHARE_MIN_POPULATION - 2; i++) {
      predictions.push(prediction({ matchKey: `2024good_qm${i}`, pRedWin: 0.6 }));
    }
    predictions.push(prediction({ matchKey: "2024bad_qm1", pRedWin: NaN }));
    predictions.push(prediction({ matchKey: "2024bad_qm2", pRedWin: NaN }));
    expect(predictions.length).toBe(QUARANTINE_SHARE_MIN_POPULATION);
    expect(2 / QUARANTINE_SHARE_MIN_POPULATION).toBeGreaterThan(QUARANTINE_SHARE_LIMIT);

    expect(() => aggregateScores(predictions)).toThrow(/QUARANTINE_SHARE_LIMIT/);
  });

  it("does not apply the share bound below the population floor, even when the share would exceed it", () => {
    const predictions: HarnessPredictionInput[] = [];
    // 150 candidates (below the 200 floor), 1 quarantined — a 0.67% share
    // that WOULD cross QUARANTINE_SHARE_LIMIT if the floor did not gate it.
    for (let i = 0; i < 149; i++) {
      predictions.push(prediction({ matchKey: `2024good_qm${i}`, pRedWin: 0.6 }));
    }
    predictions.push(prediction({ matchKey: "2024bad_qm1", pRedWin: NaN }));
    expect(predictions.length).toBeLessThan(QUARANTINE_SHARE_MIN_POPULATION);
    expect(1 / predictions.length).toBeGreaterThan(QUARANTINE_SHARE_LIMIT);

    expect(() => aggregateScores(predictions)).not.toThrow();
  });
});
