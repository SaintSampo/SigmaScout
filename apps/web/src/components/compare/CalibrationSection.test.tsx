/**
 * CalibrationSection — sketch 006-C card contract (2026-09-01 rebuild).
 * Component-level cases against the real committed 2026/2022 fixtures; the
 * route-level D-10 parity cases live in `compare.test.tsx`'s own calibration
 * describe. Every expected string is recomputed through
 * `calibrationCards.ts` — the same pure model the component renders through
 * — never hand-typed.
 */
import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import compare2026 from "../../routes/__fixtures__/compare-2026.json";
import compare2022 from "../../routes/__fixtures__/compare-2022.json";
import { CompareArtifactSchema, type CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../../../packages/harness/publishedAlgorithms.js";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import { buildCalibrationCard, cardHeadlineSentence, fmtPct, niceCeil, SPARSE_N } from "./calibrationCards.js";
import {
  CALIBRATION_EMPTY_RANGE_TEXT,
  CALIBRATION_SPARSE_TAG,
  CALIBRATION_YEAR_SELECT_TESTID,
  CalibrationSection,
  calibrationCardSentenceTestId,
  calibrationCardTestId,
} from "./CalibrationSection.js";

const ARTIFACT_2026: CompareArtifact = CompareArtifactSchema.parse(compare2026);
const ARTIFACT_2022: CompareArtifact = CompareArtifactSchema.parse(compare2022);
const ARTIFACTS = new Map([
  [2026, ARTIFACT_2026],
  [2022, ARTIFACT_2022],
]);

function sliceFor(artifact: CompareArtifact, algorithmId: string, view: string) {
  const slice = artifact.slices.find((s) => s.algorithmId === algorithmId && s.compLevelView === view);
  if (slice === undefined) throw new Error(`fixture carries no ${view} slice for ${algorithmId}`);
  return slice;
}

describe("calibrationCards — the pure model", () => {
  it("picks the valid bin nearest 70% mean-predicted as the headline", () => {
    const slice = sliceFor(ARTIFACT_2026, "vpr", "combined");
    const card = buildCalibrationCard(slice);
    expect(card.headline).not.toBeNull();
    const distances = card.rows
      .filter((r) => r.point !== null)
      .map((r) => Math.abs(r.point!.meanPredicted - 0.7));
    expect(Math.abs(card.headline!.meanPredicted - 0.7)).toBe(Math.min(...distances));
  });

  it("an all-empty slice yields a null headline and ten empty rows", () => {
    const card = buildCalibrationCard({
      calibrationBins: Array.from({ length: 10 }, (_, i) => ({ binStart: i / 10, binEnd: (i + 1) / 10, meanPredicted: null, observedFrequency: null, count: 0 })),
    });
    expect(card.headline).toBeNull();
    expect(card.rows).toHaveLength(10);
    expect(card.rows.every((r) => r.point === null)).toBe(true);
    expect(card.maxAbsDeviation).toBe(0);
  });

  it("niceCeil steps up to the next 0.05 and never below one step", () => {
    expect(niceCeil(0.001, 0.05)).toBeCloseTo(0.05, 10);
    expect(niceCeil(0.051, 0.05)).toBeCloseTo(0.1, 10);
    expect(niceCeil(0, 0.05)).toBeCloseTo(0.05, 10);
  });
});

describe("CalibrationSection — sketch 006-C cards", () => {
  it("renders one card per published algorithm, each with its own fixture-recomputed headline sentence", () => {
    render(<CalibrationSection artifactsByYear={ARTIFACTS} compLevelView="combined" />);
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      const card = buildCalibrationCard(sliceFor(ARTIFACT_2026, algorithmId, "combined"));
      expect(screen.getByTestId(calibrationCardSentenceTestId(algorithmId)).textContent).toContain(
        cardHeadlineSentence(algorithmDisplayLabel(algorithmId), card.headline!),
      );
    }
    cleanup();
  });

  it("bin rows: populated rows print predicted → actual with the count; empty bins print the verbatim empty-range sentence; sparse rows carry the tag", () => {
    render(<CalibrationSection artifactsByYear={ARTIFACTS} compLevelView="combined" />);
    const card = buildCalibrationCard(sliceFor(ARTIFACT_2026, "vpr", "combined"));
    const cardEl = screen.getByTestId(calibrationCardTestId("vpr"));

    const emptyCount = card.rows.filter((r) => r.point === null).length;
    expect(within(cardEl).queryAllByText(CALIBRATION_EMPTY_RANGE_TEXT)).toHaveLength(emptyCount);

    const firstPopulated = card.rows.find((r) => r.point !== null)!;
    expect(within(cardEl).getByText(`${fmtPct(firstPopulated.point!.meanPredicted, 1)}%`)).toBeDefined();
    expect(within(cardEl).getByText(`${fmtPct(firstPopulated.point!.observedFrequency, 1)}%`)).toBeDefined();

    // Sparse honesty: tag count in the ROWS area equals the recomputed
    // number of sparse populated rows (the headline may add one more).
    const sparseRows = card.rows.filter((r) => r.point !== null && r.point.count < SPARSE_N).length;
    const headlineSparse = card.headline !== null && card.headline.count < SPARSE_N ? 1 : 0;
    expect(within(cardEl).queryAllByText(CALIBRATION_SPARSE_TAG)).toHaveLength(sparseRows + headlineSparse);
    cleanup();
  });

  it("the compLevelView prop re-derives the cards — qualification differs from combined for at least one algorithm", () => {
    render(<CalibrationSection artifactsByYear={ARTIFACTS} compLevelView="qualification" />);
    const card = buildCalibrationCard(sliceFor(ARTIFACT_2026, "opr", "qualification"));
    expect(screen.getByTestId(calibrationCardSentenceTestId("opr")).textContent).toContain(
      cardHeadlineSentence(algorithmDisplayLabel("opr"), card.headline!),
    );
    cleanup();
  });

  it("the local year Select re-derives the cards from that year's artifact", async () => {
    render(<CalibrationSection artifactsByYear={ARTIFACTS} compLevelView="combined" />);
    fireEvent.click(screen.getByTestId(CALIBRATION_YEAR_SELECT_TESTID));
    fireEvent.click(await screen.findByRole("option", { name: "2022" }));

    const card = buildCalibrationCard(sliceFor(ARTIFACT_2022, "vpr", "combined"));
    expect(screen.getByTestId(calibrationCardSentenceTestId("vpr")).textContent).toContain(
      cardHeadlineSentence(algorithmDisplayLabel("vpr"), card.headline!),
    );
    cleanup();
  });

  it("each card's mini deviation chart renders one bar per VALID bin, none for empties", () => {
    render(<CalibrationSection artifactsByYear={ARTIFACTS} compLevelView="combined" />);
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      const card = buildCalibrationCard(sliceFor(ARTIFACT_2026, algorithmId, "combined"));
      const validCount = card.rows.filter((r) => r.point !== null).length;
      const cardEl = screen.getByTestId(calibrationCardTestId(algorithmId));
      expect(cardEl.querySelectorAll("svg rect")).toHaveLength(validCount);
    }
    cleanup();
  });
});
