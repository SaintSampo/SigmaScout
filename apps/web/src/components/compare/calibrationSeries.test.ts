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

  it("keeps sparse bins and drops empty ones — asserted over every committed fixture, and the sparse case is proven to occur", () => {
    // Was pinned to "2024 EPA elimination drops exactly two zero-count bins
    // and keeps both one-match bins". That slice no longer has ANY one-match
    // bin (quick task 260908-b4t refetched the fixtures after publishing BPR,
    // which also brought newer EPA data), so the pinned numbers described data
    // that had ceased to exist. Re-pinning to another slice would just defer
    // the same breakage to the next publish, so this asserts the INVARIANT
    // instead: a bin is kept iff it has a positive count, count === 1
    // included.
    let oneMatchBinsSeen = 0;
    for (const fixture of [fixture2024, fixture2026]) {
      for (const slice of fixture.slices) {
        const points = validCalibrationPoints(slice);
        const kept = new Set(points.map((p) => p.binStart));

        for (const bin of slice.calibrationBins) {
          const hasBothFigures = bin.meanPredicted !== null && bin.observedFrequency !== null;
          if (bin.count === 0) {
            expect(kept.has(bin.binStart), `empty bin ${bin.binStart} must be dropped`).toBe(false);
          } else if (hasBothFigures) {
            expect(kept.has(bin.binStart), `bin ${bin.binStart} with count ${bin.count} must be kept`).toBe(true);
            if (bin.count === 1) oneMatchBinsSeen += 1;
          }
        }
      }
    }

    // Guards the premise: if no sparse bin exists anywhere, the loop above
    // would pass vacuously on the very case this test is named for.
    expect(oneMatchBinsSeen).toBeGreaterThan(0);
  });

  it("carries a signed gap = meanPredicted - observedFrequency for every kept point", () => {
    const points = validCalibrationPoints(sliceFor(fixture2026, "opr", "qualification"));
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.gap).toBeCloseTo(point.meanPredicted - point.observedFrequency, 10);
    }
  });
});
