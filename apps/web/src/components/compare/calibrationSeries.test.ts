/**
 * `calibrationSeries.ts`'s own coverage (originally 08-10-PLAN.md Task 2,
 * trimmed by WR-07/260902-post-phase08-ungoverned-ui/REVIEW.md to the module
 * that actually ships: `validCalibrationPoints` alone). Every non-constructed
 * expected value below is computed from the imported REAL committed fixtures
 * at run time — never a second hand-typed figure — matching D-10's own
 * parity discipline.
 *
 * WR-07 (260902-post-phase08-ungoverned-ui/REVIEW.md): several describe
 * blocks that used to live here were deleted alongside the functions they
 * covered — headline-point selection, sentence-string formatting, shared
 * count statistics, and merged-chart-row building. They tested a
 * three-series reliability-diagram chart component retired in commit
 * `f8518805`, superseded by `calibrationCards.ts`'s own plain-language card
 * model and its own tests.
 */
import { describe, expect, it } from "vitest";
import { validCalibrationPoints, type CompareSlice } from "./calibrationSeries.js";
import compare2026 from "../../routes/__fixtures__/compare-2026.json";
import compare2024 from "../../routes/__fixtures__/compare-2024.json";

const fixture2026 = compare2026 as unknown as { slices: CompareSlice[] };
const fixture2024 = compare2024 as unknown as { slices: CompareSlice[] };

function sliceFor(fixture: { slices: CompareSlice[] }, algorithmId: string, compLevelView: string): CompareSlice {
  const slice = fixture.slices.find((s) => s.algorithmId === algorithmId && s.compLevelView === compLevelView);
  if (slice === undefined) throw new Error(`fixture carries no ${compLevelView} slice for ${algorithmId}`);
  return slice;
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
