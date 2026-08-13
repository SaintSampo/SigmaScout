import { describe, expect, it } from "vitest";
import { calibrationBins, type CalibrationPrediction } from "./calibration.js";

describe("calibrationBins", () => {
  it("assigns a probability exactly on a bin boundary to the upper bin", () => {
    // With binCount=10, 0.3 sits exactly on the boundary between bin 2
    // ([0.2, 0.3)) and bin 3 ([0.3, 0.4)). floor(0.3 * 10) = 3, so it must
    // land in bin 3 (the upper bin), never bin 2.
    const predictions: CalibrationPrediction[] = [{ pRedWin: 0.3, actualWinner: "red" }];
    const bins = calibrationBins(predictions, 10);
    expect(bins[2]!.count).toBe(0);
    expect(bins[3]!.count).toBe(1);
    expect(bins[3]!.binStart).toBeCloseTo(0.3, 10);
    expect(bins[3]!.binEnd).toBeCloseTo(0.4, 10);
  });

  it("assigns exactly 1.0 to the final bin rather than overflowing", () => {
    const predictions: CalibrationPrediction[] = [{ pRedWin: 1.0, actualWinner: "red" }];
    const bins = calibrationBins(predictions, 10);
    expect(bins).toHaveLength(10);
    expect(bins[9]!.count).toBe(1);
    expect(bins[9]!.binStart).toBeCloseTo(0.9, 10);
    expect(bins[9]!.binEnd).toBeCloseTo(1.0, 10);
  });

  it("reports null for mean predicted probability and observed frequency in an empty bin", () => {
    // Only bin 0 gets a prediction; every other bin (including bin 9) is empty.
    const predictions: CalibrationPrediction[] = [{ pRedWin: 0.05, actualWinner: "blue" }];
    const bins = calibrationBins(predictions, 10);
    const emptyBin = bins[9]!;
    expect(emptyBin.count).toBe(0);
    expect(emptyBin.meanPredicted).toBeNull();
    expect(emptyBin.observedFrequency).toBeNull();
  });

  it("sums bin counts to the total number of scored predictions", () => {
    const predictions: CalibrationPrediction[] = [
      { pRedWin: 0.05, actualWinner: "red" },
      { pRedWin: 0.12, actualWinner: "blue" },
      { pRedWin: 0.5, actualWinner: "tie" },
      { pRedWin: 0.91, actualWinner: "red" },
      { pRedWin: 1.0, actualWinner: "red" },
    ];
    const bins = calibrationBins(predictions, 10);
    const totalBinned = bins.reduce((sum, bin) => sum + bin.count, 0);
    expect(totalBinned).toBe(predictions.length);
  });

  it("computes mean predicted probability and observed frequency correctly within a bin", () => {
    // Both predictions land in bin 5 ([0.5, 0.6)).
    const predictions: CalibrationPrediction[] = [
      { pRedWin: 0.55, actualWinner: "red" }, // target 1
      { pRedWin: 0.58, actualWinner: "blue" }, // target 0
    ];
    const bins = calibrationBins(predictions, 10);
    const bin = bins[5]!;
    expect(bin.count).toBe(2);
    expect(bin.meanPredicted).toBeCloseTo((0.55 + 0.58) / 2, 10);
    expect(bin.observedFrequency).toBeCloseTo((1 + 0) / 2, 10);
  });

  it("defaults to ten equal-width bins covering [0, 1] when binCount is omitted", () => {
    const bins = calibrationBins([]);
    expect(bins).toHaveLength(10);
    expect(bins[0]!.binStart).toBe(0);
    expect(bins[9]!.binEnd).toBe(1);
  });

  it("round-trips through JSON.stringify/parse with no non-serializable sentinel in an empty bin", () => {
    const bins = calibrationBins([], 4);
    const roundTripped = JSON.parse(JSON.stringify(bins)) as typeof bins;
    expect(roundTripped).toEqual(bins);
    expect(roundTripped.every((bin) => bin.meanPredicted === null)).toBe(true);
  });

  it("throws for a non-positive or non-integer binCount", () => {
    expect(() => calibrationBins([], 0)).toThrow();
    expect(() => calibrationBins([], -1)).toThrow();
    expect(() => calibrationBins([], 2.5)).toThrow();
  });
});
