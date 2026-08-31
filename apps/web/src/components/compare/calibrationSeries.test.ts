/**
 * TDD RED-then-GREEN test for `calibrationSeries.ts` (08-10-PLAN.md Task 2).
 * Every non-constructed expected value below is computed from the imported
 * REAL committed fixtures at run time — never a second hand-typed figure —
 * matching D-10's own parity discipline. The two published-headline figures
 * (2026 OPR qualification: 85.3% predicted, 52.8% observed, 395 matches) are
 * therefore proven by RECOMPUTING them from the fixture inside the test
 * body, never by pasting those digits as a literal expectation.
 */
import { describe, expect, it } from "vitest";
import {
  buildCalibrationRows,
  calibrationPointRadius,
  countStats,
  formatCalibrationSentence,
  MAX_POINT_R,
  MIN_POINT_R,
  selectHeadlinePoint,
  validCalibrationPoints,
  type AlgorithmPoints,
  type CalibrationPoint,
  type CompareSlice,
} from "./calibrationSeries.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import compare2026 from "../../routes/__fixtures__/compare-2026.json";
import compare2024 from "../../routes/__fixtures__/compare-2024.json";

const fixture2026 = compare2026 as unknown as { slices: CompareSlice[] };
const fixture2024 = compare2024 as unknown as { slices: CompareSlice[] };

function sliceFor(fixture: { slices: CompareSlice[] }, algorithmId: string, compLevelView: string): CompareSlice {
  const slice = fixture.slices.find((s) => s.algorithmId === algorithmId && s.compLevelView === compLevelView);
  if (slice === undefined) throw new Error(`fixture carries no ${compLevelView} slice for ${algorithmId}`);
  return slice;
}

function pointsByAlgorithmFor(fixture: { slices: CompareSlice[] }, compLevelView: string): AlgorithmPoints {
  const entries = PUBLISHED_ALGORITHM_IDS.map(
    (id): [PublishedAlgorithmId, readonly CalibrationPoint[]] => [id, validCalibrationPoints(sliceFor(fixture, id, compLevelView))],
  );
  return Object.fromEntries(entries) as AlgorithmPoints;
}

describe("validCalibrationPoints", () => {
  it("across every 2026 slice, keeps exactly the bins the fixture itself reports as count>0 with both figures present", () => {
    for (const slice of fixture2026.slices) {
      const expectedCount = slice.calibrationBins.filter(
        (b) => b.count > 0 && b.meanPredicted !== null && b.observedFrequency !== null,
      ).length;
      expect(validCalibrationPoints(slice)).toHaveLength(expectedCount);
    }
  });

  it("2024 EPA elimination: drops exactly the two zero-count bins and keeps both one-match bins (sparse kept, empty dropped)", () => {
    const slice = sliceFor(fixture2024, "epa", "elimination");
    expect(slice.calibrationBins).toHaveLength(10);

    const points = validCalibrationPoints(slice);
    expect(points).toHaveLength(8);

    const droppedBins = slice.calibrationBins.filter((b) => !points.some((p) => p.binStart === b.binStart));
    expect(droppedBins).toHaveLength(2);
    expect(droppedBins.every((b) => b.count === 0)).toBe(true);

    const oneMatchBinStarts = slice.calibrationBins.filter((b) => b.count === 1).map((b) => b.binStart);
    expect(oneMatchBinStarts.length).toBeGreaterThan(0);
    for (const binStart of oneMatchBinStarts) {
      expect(points.some((p) => p.binStart === binStart)).toBe(true);
    }
  });

  it("carries a signed gap = meanPredicted - observedFrequency for every kept point", () => {
    const points = validCalibrationPoints(sliceFor(fixture2026, "opr", "qualification"));
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.gap).toBeCloseTo(point.meanPredicted - point.observedFrequency, 10);
    }
  });
});

describe("selectHeadlinePoint", () => {
  it("returns undefined for an empty array", () => {
    expect(selectHeadlinePoint([])).toBeUndefined();
  });

  it("2026 OPR qualification: equals an independently recomputed Math.max over |meanPredicted - observedFrequency| — the case that justifies the whole Calibration section", () => {
    const points = validCalibrationPoints(sliceFor(fixture2026, "opr", "qualification"));
    const expected = points.reduce((best, p) => (Math.abs(p.gap) > Math.abs(best.gap) ? p : best));

    const headline = selectHeadlinePoint(points);

    expect(headline).toEqual(expected);
    expect(formatCalibrationSentence("OPR", headline!)).toBe(
      `OPR predicted ${(expected.meanPredicted * 100).toFixed(1)}%, and it was right ${(expected.observedFrequency * 100).toFixed(1)}% of the time across ${expected.count.toLocaleString("en-US")} matches.`,
    );
  });

  it("determinism contract (constructed — no exact |gap| tie occurs anywhere in the five published artifacts): equal |gap| resolved by the higher count", () => {
    const lowerCount: CalibrationPoint = { binStart: 0.1, binEnd: 0.2, meanPredicted: 0.5, observedFrequency: 0.6, count: 10, gap: -0.1 };
    const higherCount: CalibrationPoint = { binStart: 0.3, binEnd: 0.4, meanPredicted: 0.5, observedFrequency: 0.4, count: 50, gap: 0.1 };
    expect(selectHeadlinePoint([lowerCount, higherCount])).toEqual(higherCount);
  });

  it("determinism contract (constructed): equal |gap| and equal count resolved by the lower binStart", () => {
    const laterBin: CalibrationPoint = { binStart: 0.5, binEnd: 0.6, meanPredicted: 0.5, observedFrequency: 0.6, count: 10, gap: -0.1 };
    const earlierBin: CalibrationPoint = { binStart: 0.1, binEnd: 0.2, meanPredicted: 0.5, observedFrequency: 0.4, count: 10, gap: 0.1 };
    expect(selectHeadlinePoint([laterBin, earlierBin])).toEqual(earlierBin);
  });
});

describe("formatCalibrationSentence", () => {
  it("renders percentages at one decimal place and the count with thousands separators (constructed figures, unrelated to the real headline case)", () => {
    const point: CalibrationPoint = { binStart: 0.6, binEnd: 0.7, meanPredicted: 0.702, observedFrequency: 0.415, count: 2500, gap: 0.287 };
    expect(formatCalibrationSentence("EPA", point)).toBe("EPA predicted 70.2%, and it was right 41.5% of the time across 2,500 matches.");
  });
});

describe("countStats", () => {
  it("returns undefined when there are no points at all", () => {
    const empty: AlgorithmPoints = { opr: [], epa: [], vpr: [] };
    expect(countStats(empty)).toBeUndefined();
  });

  it("2026 qualification: min/median/max computed over all three algorithms' valid points, recomputed independently from the fixture", () => {
    const pointsByAlgorithm = pointsByAlgorithmFor(fixture2026, "qualification");
    const allCounts = PUBLISHED_ALGORITHM_IDS.flatMap((id) => pointsByAlgorithm[id].map((p) => p.count)).sort((a, b) => a - b);

    const stats = countStats(pointsByAlgorithm);

    expect(stats).toEqual({
      min: allCounts[0],
      max: allCounts[allCounts.length - 1],
      median: allCounts[Math.floor(allCounts.length / 2)],
    });
  });
});

describe("calibrationPointRadius", () => {
  it("is non-decreasing in count, always >= MIN_POINT_R and > 0, and equals MAX_POINT_R exactly at count === maxCount", () => {
    const maxCount = 7988; // the real corpus-wide maximum bin count, per 08-CONTEXT.md
    const counts = [1, 2, 30, 400, 5950, maxCount];
    let previous = -Infinity;
    for (const count of counts) {
      const r = calibrationPointRadius(count, maxCount);
      expect(r).toBeGreaterThanOrEqual(MIN_POINT_R);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
    expect(calibrationPointRadius(maxCount, maxCount)).toBe(MAX_POINT_R);
  });
});

describe("buildCalibrationRows", () => {
  it("2024 elimination (a slice set containing zero-count bins): no row's x is 0, every row has exactly one non-null series value, and the row count equals the total valid-point count", () => {
    const pointsByAlgorithm = pointsByAlgorithmFor(fixture2024, "elimination");
    const totalValidPoints = PUBLISHED_ALGORITHM_IDS.reduce((sum, id) => sum + pointsByAlgorithm[id].length, 0);

    const rows = buildCalibrationRows(pointsByAlgorithm);

    expect(rows).toHaveLength(totalValidPoints);
    for (const row of rows) {
      expect(row.x).not.toBe(0);
      const nonNullCount = PUBLISHED_ALGORITHM_IDS.filter((id) => row[id] !== null).length;
      expect(nonNullCount).toBe(1);
    }
  });

  it("rows sort ascending by x", () => {
    const pointsByAlgorithm = pointsByAlgorithmFor(fixture2026, "qualification");
    const rows = buildCalibrationRows(pointsByAlgorithm);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.x).toBeGreaterThanOrEqual(rows[i - 1]!.x);
    }
  });

  it("every algorithm cell's radius equals calibrationPointRadius applied to the SAME countStats.max the caller would compute — marks and a size key can never drift apart", () => {
    const pointsByAlgorithm = pointsByAlgorithmFor(fixture2026, "qualification");
    const maxCount = countStats(pointsByAlgorithm)!.max;

    const rows = buildCalibrationRows(pointsByAlgorithm);

    for (const row of rows) {
      for (const id of PUBLISHED_ALGORITHM_IDS) {
        const cell = row[id];
        if (cell === null) continue;
        expect(cell.radius).toBe(calibrationPointRadius(cell.count, maxCount));
      }
    }
  });
});
