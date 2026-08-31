import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CALIBRATION_EXPLAINER,
  CALIBRATION_LEGEND_TESTID,
  CALIBRATION_SECTION_TESTID,
  CALIBRATION_SENTENCE_TESTID,
  CALIBRATION_YEAR_SELECT_TESTID,
  CalibrationSection,
  DEFAULT_CALIBRATION_ALGORITHM,
  DEFAULT_CALIBRATION_YEAR,
} from "./CalibrationSection.js";
import { formatCalibrationSentence, selectHeadlinePoint, validCalibrationPoints, type CompareSlice } from "./calibrationSeries.js";
import type { CalibrationChartProps } from "./CalibrationChart.js";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import compare2022 from "../../routes/__fixtures__/compare-2022.json";
import compare2024 from "../../routes/__fixtures__/compare-2024.json";
import compare2026 from "../../routes/__fixtures__/compare-2026.json";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

function artifactsMapFrom(entries: readonly [number, unknown][]): ReadonlyMap<number, CompareArtifact> {
  return new Map(entries.map(([year, artifact]) => [year, artifact as CompareArtifact]));
}

function sliceFor(artifact: CompareArtifact, algorithmId: string, compLevelView: string): CompareSlice {
  const slice = artifact.slices.find((s) => s.algorithmId === algorithmId && s.compLevelView === compLevelView) as
    | CompareSlice
    | undefined;
  if (slice === undefined) throw new Error(`fixture carries no ${compLevelView} slice for ${algorithmId}`);
  return slice;
}

const FULL_ARTIFACTS = artifactsMapFrom([
  [2022, compare2022],
  [2024, compare2024],
  [2026, compare2026],
]);

/** A resolving `loadChart` stub whose fake chart exposes a button per point so tests can drive `onPointSelect`/`onPointDeselect` deterministically, without depending on the real Recharts DOM shape (that shape is CalibrationChart.test.tsx's own job). */
function fakeChartLoader(): () => Promise<{ default: ComponentType<CalibrationChartProps> }> {
  function FakeChart({ pointsByAlgorithm, onPointSelect, onPointDeselect }: CalibrationChartProps) {
    const oprPoint = pointsByAlgorithm.opr[0];
    return (
      <div data-testid="fake-calibration-chart">
        {oprPoint !== undefined && (
          <button type="button" onClick={() => onPointSelect("opr", oprPoint)} onBlur={() => onPointDeselect?.()}>
            select-opr-point
          </button>
        )}
      </div>
    );
  }
  return () => Promise.resolve({ default: FakeChart });
}

describe("CalibrationSection", () => {
  afterEach(() => cleanup());

  it("default render (before any interaction) shows VPR's headline sentence for 2026, derived from the fixture", async () => {
    const loadChart = fakeChartLoader();
    render(<CalibrationSection artifactsByYear={FULL_ARTIFACTS} compLevelView="combined" loadChart={loadChart} />);

    expect(DEFAULT_CALIBRATION_YEAR).toBe(2026);
    expect(DEFAULT_CALIBRATION_ALGORITHM).toBe("vpr");

    const slice = sliceFor(compare2026 as unknown as CompareArtifact, "vpr", "combined");
    const headline = selectHeadlinePoint(validCalibrationPoints(slice))!;
    const expectedSentence = formatCalibrationSentence(algorithmDisplayLabel("vpr"), headline);

    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent).toBe(expectedSentence));
  });

  it("OPR + qualification (via compLevelView prop) + 2026: the rendered sentence equals formatCalibrationSentence applied to the headline point recomputed from the imported fixture — no hand-typed expected figure appears in executable code", async () => {
    const loadChart = fakeChartLoader();
    render(<CalibrationSection artifactsByYear={FULL_ARTIFACTS} compLevelView="qualification" loadChart={loadChart} />);

    fireEvent.click(screen.getByTestId(CALIBRATION_LEGEND_TESTID).querySelector("button")!); // OPR is the first PUBLISHED_ALGORITHM_IDS entry

    const slice = sliceFor(compare2026 as unknown as CompareArtifact, "opr", "qualification");
    const headline = selectHeadlinePoint(validCalibrationPoints(slice))!;
    const expectedSentence = formatCalibrationSentence(algorithmDisplayLabel("opr"), headline);

    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent).toBe(expectedSentence));
  });

  it("clicking the EPA legend entry changes the sentence to EPA's own headline fact and moves aria-pressed, with no fetch issued", async () => {
    const loadChart = fakeChartLoader();
    const fetchSpy = vi.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchSpy as unknown as typeof fetch;

    render(<CalibrationSection artifactsByYear={FULL_ARTIFACTS} compLevelView="combined" loadChart={loadChart} />);
    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent).not.toBe(""));

    const legendButtons = screen.getByTestId(CALIBRATION_LEGEND_TESTID).querySelectorAll("button");
    const epaButton = Array.from(legendButtons).find((b) => b.textContent === "EPA")!;
    fireEvent.click(epaButton);

    const slice = sliceFor(compare2026 as unknown as CompareArtifact, "epa", "combined");
    const headline = selectHeadlinePoint(validCalibrationPoints(slice))!;
    const expectedSentence = formatCalibrationSentence(algorithmDisplayLabel("epa"), headline);

    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent).toBe(expectedSentence));
    expect(epaButton.getAttribute("aria-pressed")).toBe("true");

    expect(fetchSpy).not.toHaveBeenCalled();
    global.fetch = originalFetch;
  });

  it("changing the year Select to 2024 changes the sentence, with no fetch issued", async () => {
    const loadChart = fakeChartLoader();
    const fetchSpy = vi.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchSpy as unknown as typeof fetch;

    render(<CalibrationSection artifactsByYear={FULL_ARTIFACTS} compLevelView="combined" loadChart={loadChart} />);
    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent).not.toBe(""));

    fireEvent.click(screen.getByTestId(CALIBRATION_YEAR_SELECT_TESTID));
    const option2024 = await screen.findByRole("option", { name: "2024" });
    fireEvent.click(option2024);

    const slice = sliceFor(compare2024 as unknown as CompareArtifact, "vpr", "combined");
    const headline = selectHeadlinePoint(validCalibrationPoints(slice))!;
    const expectedSentence = formatCalibrationSentence(algorithmDisplayLabel("vpr"), headline);

    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent).toBe(expectedSentence));
    expect(fetchSpy).not.toHaveBeenCalled();
    global.fetch = originalFetch;
  });

  it("selecting a chart point replaces the sentence with that point's own fact, then deselecting restores the headline sentence", async () => {
    const loadChart = fakeChartLoader();
    render(<CalibrationSection artifactsByYear={FULL_ARTIFACTS} compLevelView="combined" loadChart={loadChart} />);

    const headlineSlice = sliceFor(compare2026 as unknown as CompareArtifact, "vpr", "combined");
    const headline = selectHeadlinePoint(validCalibrationPoints(headlineSlice))!;
    const headlineSentence = formatCalibrationSentence(algorithmDisplayLabel("vpr"), headline);
    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent).toBe(headlineSentence));

    const oprSlice = sliceFor(compare2026 as unknown as CompareArtifact, "opr", "combined");
    const oprPoint = validCalibrationPoints(oprSlice)[0]!;
    const oprSentence = formatCalibrationSentence(algorithmDisplayLabel("opr"), oprPoint);

    const selectButton = await screen.findByText("select-opr-point");
    fireEvent.click(selectButton);
    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent).toBe(oprSentence));

    fireEvent.blur(selectButton);
    await waitFor(() => expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent).toBe(headlineSentence));
  });

  it("renders the corrected diagonal-orientation explainer, and the UI-SPEC's inverted form does not appear", async () => {
    const loadChart = fakeChartLoader();
    render(<CalibrationSection artifactsByYear={FULL_ARTIFACTS} compLevelView="combined" loadChart={loadChart} />);

    expect(screen.getByText(CALIBRATION_EXPLAINER)).toBeDefined();
    expect(CALIBRATION_EXPLAINER).toContain("below the diagonal means the algorithm was more confident");
    expect(CALIBRATION_EXPLAINER).not.toContain("above the diagonal means the algorithm was more confident");
  });

  it("a rejecting loadChart still leaves the heading, year Select, sentence, explainer and legend all in the document — only the chart is replaced by Retry", async () => {
    const loadChart = vi.fn(() => Promise.reject(new Error("chunk load failed")));
    render(<CalibrationSection artifactsByYear={FULL_ARTIFACTS} compLevelView="combined" loadChart={loadChart} />);

    await waitFor(() => expect(screen.getByText("Chart failed to load")).toBeDefined());

    expect(screen.getByText("Calibration")).toBeDefined();
    expect(screen.getByTestId(CALIBRATION_YEAR_SELECT_TESTID)).toBeDefined();
    expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent?.length).toBeGreaterThan(0);
    expect(screen.getByText(CALIBRATION_EXPLAINER)).toBeDefined();
    expect(screen.getByTestId(CALIBRATION_LEGEND_TESTID)).toBeDefined();
    expect(loadChart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(loadChart).toHaveBeenCalledTimes(2));
  });

  it("when the selected algorithm/year/compLevel has no valid bins, NO_USABLE_BINS_SENTENCE renders and no chart mounts (constructed — this exact combination does not occur in the published data)", async () => {
    // Deliberately keyed at DEFAULT_CALIBRATION_YEAR (2026) with a slice for
    // DEFAULT_CALIBRATION_ALGORITHM ("vpr") under the "combined" compLevel
    // this test passes — the default render itself must hit the empty
    // branch, with no year/algorithm interaction needed. The year Select's
    // own options are always COMPARE_SEASONS (2022-2026, D-10's real fixed
    // list), so a synthetic out-of-range year would never be selectable.
    const zeroBinSlice = {
      algorithmId: "vpr",
      season: DEFAULT_CALIBRATION_YEAR,
      seasonLabel: "holdout",
      headlineEligible: false,
      compLevelView: "combined",
      brierScore: null,
      winnerAccuracy: null,
      scoredCount: 0,
      tieCount: 0,
      noCallCount: 0,
      exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 },
      candidateCount: 0,
      calibrationBins: [{ binStart: 0, binEnd: 0.1, meanPredicted: null, observedFrequency: null, count: 0 }],
    };
    const emptyArtifact = { schemaVersion: 1, algorithms: [], slices: [zeroBinSlice] } as unknown as CompareArtifact;
    const artifacts = new Map<number, CompareArtifact>([[DEFAULT_CALIBRATION_YEAR, emptyArtifact]]);

    const loadChart = fakeChartLoader();
    render(<CalibrationSection artifactsByYear={artifacts} compLevelView="combined" loadChart={loadChart} />);

    await waitFor(() =>
      expect(screen.getByTestId(CALIBRATION_SENTENCE_TESTID).textContent).toBe(
        "Not enough matches to show a calibration result for this selection.",
      ),
    );
    expect(screen.queryByTestId("fake-calibration-chart")).toBeNull();
  });

  it("every legend entry resolves to at least a 44x44px tap target", async () => {
    const loadChart = fakeChartLoader();
    render(<CalibrationSection artifactsByYear={FULL_ARTIFACTS} compLevelView="combined" loadChart={loadChart} />);

    const buttons = screen.getByTestId(CALIBRATION_LEGEND_TESTID).querySelectorAll("button");
    expect(buttons.length).toBe(3);
    for (const button of Array.from(buttons)) {
      expect(button.className).toContain("tap-target");
    }
  });
});
