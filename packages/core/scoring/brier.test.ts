import { describe, expect, it } from "vitest";
import { scoreSet, type ScoredPrediction } from "./brier.js";

describe("scoreSet", () => {
  it("computes Brier score and winner accuracy against hand-computed values on a fixed fixture", () => {
    // Hand-computed:
    //   (0.8 - 1)^2 = 0.04   (red won, favored red, correct)
    //   (0.3 - 0)^2 = 0.09   (blue won, favored blue, correct)
    //   (0.6 - 0)^2 = 0.36   (blue won, favored red, wrong)
    //   (0.9 - 1)^2 = 0.01   (red won, favored red, correct)
    // Brier = (0.04 + 0.09 + 0.36 + 0.01) / 4 = 0.5 / 4 = 0.125
    // Accuracy = 3/4 = 0.75
    const predictions: ScoredPrediction[] = [
      { pRedWin: 0.8, actualWinner: "red" },
      { pRedWin: 0.3, actualWinner: "blue" },
      { pRedWin: 0.6, actualWinner: "blue" },
      { pRedWin: 0.9, actualWinner: "red" },
    ];
    const result = scoreSet(predictions);
    expect(result.brierScore).toBeCloseTo(0.125, 10);
    expect(result.winnerAccuracy).toBeCloseTo(0.75, 10);
    expect(result.count).toBe(4);
    expect(result.tieCount).toBe(0);
    expect(result.noCallCount).toBe(0);
  });

  it("excludes a 0.5 prediction from the accuracy denominator and counts it as a no-call", () => {
    const predictions: ScoredPrediction[] = [
      { pRedWin: 0.8, actualWinner: "red" },
      { pRedWin: 0.5, actualWinner: "red" },
    ];
    const result = scoreSet(predictions);
    expect(result.noCallCount).toBe(1);
    // Only the 0.8/red prediction counts toward accuracy: 1/1 = 1.
    expect(result.winnerAccuracy).toBe(1);
    // Both predictions still contribute to Brier: count is 2.
    expect(result.count).toBe(2);
    expect(result.brierScore).toBeCloseTo(((0.8 - 1) ** 2 + (0.5 - 1) ** 2) / 2, 10);
  });

  it("excludes a tied match from accuracy and scores it against 0.5 in Brier", () => {
    const predictions: ScoredPrediction[] = [
      { pRedWin: 0.7, actualWinner: "tie" },
      { pRedWin: 0.8, actualWinner: "red" },
    ];
    const result = scoreSet(predictions);
    expect(result.tieCount).toBe(1);
    expect(result.winnerAccuracy).toBe(1); // only the red prediction counts
    expect(result.count).toBe(2);
    expect(result.brierScore).toBeCloseTo(((0.7 - 0.5) ** 2 + (0.8 - 1) ** 2) / 2, 10);
  });

  it("returns null metrics with count 0 for an empty set, never a divide-by-zero or non-serializable value", () => {
    const result = scoreSet([]);
    expect(result.brierScore).toBeNull();
    expect(result.winnerAccuracy).toBeNull();
    expect(result.count).toBe(0);
    expect(result.tieCount).toBe(0);
    expect(result.noCallCount).toBe(0);
  });

  it("returns the single element's squared error as the Brier score", () => {
    const result = scoreSet([{ pRedWin: 0.2, actualWinner: "red" }]);
    expect(result.brierScore).toBeCloseTo((0.2 - 1) ** 2, 10);
    expect(result.winnerAccuracy).toBe(0); // favored blue (0.2 < 0.5), actual red -> wrong
  });

  it("scores exact 0.0 and 1.0 predictions without special-casing, contributing full squared error when wrong", () => {
    const predictions: ScoredPrediction[] = [
      { pRedWin: 0.0, actualWinner: "red" }, // fully wrong
      { pRedWin: 1.0, actualWinner: "blue" }, // fully wrong
    ];
    const result = scoreSet(predictions);
    expect(result.brierScore).toBeCloseTo(((0 - 1) ** 2 + (1 - 0) ** 2) / 2, 10);
    expect(result.winnerAccuracy).toBe(0);
  });

  it("returns null winner accuracy when every prediction is excluded (all ties/no-calls) but still scores Brier", () => {
    const predictions: ScoredPrediction[] = [
      { pRedWin: 0.5, actualWinner: "tie" },
      { pRedWin: 0.5, actualWinner: "red" },
    ];
    const result = scoreSet(predictions);
    expect(result.winnerAccuracy).toBeNull();
    expect(result.count).toBe(2);
    expect(result.tieCount).toBe(1);
    expect(result.noCallCount).toBe(2);
  });

  it("round-trips through JSON.stringify/parse with no non-serializable sentinel", () => {
    const withData = scoreSet([
      { pRedWin: 0.6, actualWinner: "red" },
      { pRedWin: 0.5, actualWinner: "tie" },
    ]);
    const roundTripped = JSON.parse(JSON.stringify(withData)) as typeof withData;
    expect(roundTripped).toEqual(withData);

    const empty = scoreSet([]);
    const roundTrippedEmpty = JSON.parse(JSON.stringify(empty)) as typeof empty;
    expect(roundTrippedEmpty).toEqual(empty);
    expect(roundTrippedEmpty.brierScore).toBeNull();
  });
});
