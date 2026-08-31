import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import CalibrationChart, { CALIBRATION_CHART_TESTID, CALIBRATION_SIZE_KEY_TESTID, DEFAULT_CALIBRATION_CHART_WIDTH } from "./CalibrationChart.js";
import {
  calibrationPointRadius,
  countStats,
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

function chartSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector(".recharts-surface");
  if (svg === null) throw new Error("expected a rendered .recharts-surface element");
  return svg as SVGSVGElement;
}

describe("CalibrationChart — jsdom-safe sizing and real-fixture rendering", () => {
  it("renders at least 3 line curves and the SVG's own width equals DEFAULT_CALIBRATION_CHART_WIDTH under jsdom's zero-measurement fallback", () => {
    const pointsByAlgorithm = pointsByAlgorithmFor(fixture2026, "qualification");
    const { container } = render(
      <CalibrationChart pointsByAlgorithm={pointsByAlgorithm} activeAlgorithmId="vpr" onPointSelect={() => {}} />,
    );

    expect(container.querySelectorAll(".recharts-line-curve").length).toBeGreaterThanOrEqual(3);
    expect(chartSvg(container).getAttribute("width")).toBe(String(DEFAULT_CALIBRATION_CHART_WIDTH));
  });

  it("2024 elimination: rendered dot count equals the total number of bins whose count > 0 across the three algorithms' elimination slices", () => {
    const pointsByAlgorithm = pointsByAlgorithmFor(fixture2024, "elimination");
    const expectedDotCount = PUBLISHED_ALGORITHM_IDS.reduce((sum, id) => {
      const slice = sliceFor(fixture2024, id, "elimination");
      return sum + slice.calibrationBins.filter((b) => b.count > 0 && b.meanPredicted !== null && b.observedFrequency !== null).length;
    }, 0);

    const { container } = render(
      <CalibrationChart pointsByAlgorithm={pointsByAlgorithm} activeAlgorithmId="vpr" onPointSelect={() => {}} />,
    );

    const dots = chartSvg(container).querySelectorAll("circle");
    expect(dots.length).toBe(expectedDotCount);
  });

  it("sparse-bin encoding: the smallest-count bin's dot has a strictly smaller r than the largest-count bin's dot, and the smallest is still > 0", () => {
    const pointsByAlgorithm = pointsByAlgorithmFor(fixture2024, "elimination");
    const allPoints = PUBLISHED_ALGORITHM_IDS.flatMap((id) => pointsByAlgorithm[id]);
    const smallest = allPoints.reduce((min, p) => (p.count < min.count ? p : min));
    const largest = allPoints.reduce((max, p) => (p.count > max.count ? p : max));
    expect(smallest.count).toBeLessThan(largest.count);

    const { container } = render(
      <CalibrationChart pointsByAlgorithm={pointsByAlgorithm} activeAlgorithmId="vpr" onPointSelect={() => {}} />,
    );

    const radii = Array.from(chartSvg(container).querySelectorAll("circle")).map((el) => Number(el.getAttribute("r")));
    const smallestR = Math.min(...radii);
    const largestR = Math.max(...radii);

    expect(smallestR).toBeGreaterThan(0);
    expect(smallestR).toBeLessThan(largestR);
  });

  it("the size key's three swatches equal calibrationPointRadius evaluated at countStats' min/median/max for the SAME rendered set — marks and key share one source", () => {
    const pointsByAlgorithm = pointsByAlgorithmFor(fixture2026, "qualification");
    const stats = countStats(pointsByAlgorithm)!;

    const { container } = render(
      <CalibrationChart pointsByAlgorithm={pointsByAlgorithm} activeAlgorithmId="vpr" onPointSelect={() => {}} />,
    );

    const keySwatches = container.querySelectorAll(`[data-testid="${CALIBRATION_SIZE_KEY_TESTID}"] circle`);
    expect(keySwatches).toHaveLength(3);
    const swatchRadii = Array.from(keySwatches).map((el) => Number(el.getAttribute("r")));
    expect(swatchRadii).toEqual([
      calibrationPointRadius(stats.min, stats.max),
      calibrationPointRadius(stats.median, stats.max),
      calibrationPointRadius(stats.max, stats.max),
    ]);
  });

  it("every data dot carries a non-empty SVG <title> naming its algorithm and its own match count, and tabindex=\"0\"", () => {
    const pointsByAlgorithm = pointsByAlgorithmFor(fixture2026, "qualification");
    const { container } = render(
      <CalibrationChart pointsByAlgorithm={pointsByAlgorithm} activeAlgorithmId="vpr" onPointSelect={() => {}} />,
    );

    const dotGroups = Array.from(chartSvg(container).querySelectorAll("circle")).map((circle) => circle.closest("g"));
    expect(dotGroups.length).toBeGreaterThan(0);
    for (const group of dotGroups) {
      expect(group).not.toBeNull();
      expect(group?.getAttribute("tabindex")).toBe("0");
      const title = group?.querySelector("title")?.textContent ?? "";
      expect(title.length).toBeGreaterThan(0);
      expect(/OPR|EPA|VPR/.test(title)).toBe(true);
    }
  });

  it("firing focus on one dot calls onPointSelect once with that dot's algorithm id and a point whose count matches the fixture's bin", () => {
    const pointsByAlgorithm = pointsByAlgorithmFor(fixture2026, "qualification");
    const onPointSelect = vi.fn();
    const { container } = render(
      <CalibrationChart pointsByAlgorithm={pointsByAlgorithm} activeAlgorithmId="vpr" onPointSelect={onPointSelect} />,
    );

    const oprPoints = pointsByAlgorithm.opr;
    expect(oprPoints.length).toBeGreaterThan(0);
    const targetPoint = oprPoints[0]!;

    const dotGroups = Array.from(chartSvg(container).querySelectorAll("circle")).map((circle) => circle.closest("g"));
    const targetGroup = dotGroups.find((g) => g?.querySelector("title")?.textContent?.includes("OPR") && g?.querySelector("title")?.textContent?.includes(targetPoint.count.toLocaleString("en-US")));
    expect(targetGroup).toBeDefined();

    fireEvent.focus(targetGroup!);

    expect(onPointSelect).toHaveBeenCalledTimes(1);
    const [calledAlgorithmId, calledPoint] = onPointSelect.mock.calls[0]!;
    expect(calledAlgorithmId).toBe("opr");
    expect(calledPoint.count).toBe(targetPoint.count);
  });
});
