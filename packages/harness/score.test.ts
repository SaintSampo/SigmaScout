import { describe, expect, it } from "vitest";
import {
  aggregateScores,
  HOLDOUT_SEASONS,
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
    });
    const total =
      qualSlice2024.scoredCount +
      qualSlice2024.exclusionCounts.offseason +
      qualSlice2024.exclusionCounts.surrogateAffected +
      qualSlice2024.exclusionCounts.missingResult;
    expect(total).toBe(qualSlice2024.candidateCount);
  });

  it("holds the same scored-plus-excluded invariant for every slice", () => {
    for (const slice of slices) {
      const total =
        slice.scoredCount +
        slice.exclusionCounts.offseason +
        slice.exclusionCounts.surrogateAffected +
        slice.exclusionCounts.missingResult;
      expect(total).toBe(slice.candidateCount);
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
