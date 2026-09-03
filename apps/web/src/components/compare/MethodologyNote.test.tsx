import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  MethodologyNote,
  buildMethodologyFigures,
  formatSeasonList,
  NEAR_TIE_CAPTION,
  METHODOLOGY_NOTE_TESTID,
} from "./MethodologyNote.js";
import { formatBrierDisplay } from "../../lib/compareTie.js";
import { COMPARE_SEASONS } from "../../lib/api/compare.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import compare2022 from "../../routes/__fixtures__/compare-2022.json";
import compare2023 from "../../routes/__fixtures__/compare-2023.json";
import compare2024 from "../../routes/__fixtures__/compare-2024.json";
import compare2025 from "../../routes/__fixtures__/compare-2025.json";
import compare2026 from "../../routes/__fixtures__/compare-2026.json";

afterEach(() => {
  cleanup();
});

const FIXTURES_BY_YEAR: Record<number, CompareArtifact> = {
  2022: compare2022 as CompareArtifact,
  2023: compare2023 as CompareArtifact,
  2024: compare2024 as CompareArtifact,
  2025: compare2025 as CompareArtifact,
  2026: compare2026 as CompareArtifact,
};

function realArtifactsByYear(): Map<number, CompareArtifact> {
  const map = new Map<number, CompareArtifact>();
  for (const season of COMPARE_SEASONS) {
    map.set(season, FIXTURES_BY_YEAR[season]!);
  }
  return map;
}

function vprCombinedSlice(artifact: CompareArtifact, season: number) {
  const slice = artifact.slices.find(
    (s) => s.algorithmId === "vpr" && s.season === season && s.compLevelView === "combined",
  );
  if (slice === undefined) throw new Error(`fixture for ${season} carries no VPR combined slice`);
  return slice;
}

/**
 * A minimal single-slice artifact — only the fields `buildMethodologyFigures`
 * reads. `includeSeasonLabel` (default true) is D-4's tolerance requirement
 * asserted at the component: the note must render identically whether or not
 * the vestigial field is present on every slice.
 */
function makeMinimalArtifact(
  season: number,
  brierScore: number | null,
  options: { includeSeasonLabel?: boolean } = {},
): CompareArtifact {
  const { includeSeasonLabel = true } = options;
  const slice: Record<string, unknown> = {
    algorithmId: "vpr",
    season,
    headlineEligible: true,
    compLevelView: "combined",
    brierScore,
    winnerAccuracy: 0.75,
    scoredCount: 1000,
    tieCount: 0,
    noCallCount: 0,
    exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 },
    candidateCount: 1000,
    calibrationBins: [],
  };
  if (includeSeasonLabel) slice.seasonLabel = "holdout";

  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-30T00:00:00.000Z",
    algorithms: [{ id: "vpr", version: "1.0.0+x", codeVersion: "1.0.0", paramSetName: "x" }],
    slices: [slice],
  } as CompareArtifact;
}

describe("formatSeasonList", () => {
  it("one season renders as the bare year", () => {
    expect(formatSeasonList([2026])).toBe("2026");
  });

  it("two seasons render as the pair joined by the word 'and'", () => {
    expect(formatSeasonList([2025, 2026])).toBe("2025 and 2026");
  });

  it("three contiguous seasons render as an en-dashed range", () => {
    expect(formatSeasonList([2022, 2023, 2024])).toBe("2022–2024");
  });

  it("four contiguous seasons also render as an en-dashed range (boundary above three)", () => {
    expect(formatSeasonList([2022, 2023, 2024, 2025])).toBe("2022–2025");
  });

  it("three-or-more non-contiguous seasons render as a comma-separated list with the word 'and' before the last", () => {
    expect(formatSeasonList([2022, 2024, 2026])).toBe("2022, 2024 and 2026");
  });
});

describe("buildMethodologyFigures", () => {
  it("reads only VPR's combined-view slice for each season in COMPARE_SEASONS and formats every Brier through the shared formatter", () => {
    const artifactsByYear = realArtifactsByYear();
    const figures = buildMethodologyFigures(artifactsByYear);
    expect(figures?.complete).toBe(true);
    if (figures?.complete !== true) throw new Error("expected complete figures");

    expect(figures.seasons).toEqual(COMPARE_SEASONS);

    for (const brier of figures.seasonBriers) {
      const slice = vprCombinedSlice(FIXTURES_BY_YEAR[brier.season]!, brier.season);
      expect(brier.text).toBe(formatBrierDisplay(slice.brierScore!));
    }

    const allSlices = COMPARE_SEASONS.map((season) => vprCombinedSlice(FIXTURES_BY_YEAR[season]!, season));
    const expectedBest = allSlices.reduce((min, s) => (s.brierScore! < min.brierScore! ? s : min));
    expect(figures.bestSeason).toBe(expectedBest.season);
    expect(figures.bestBrierText).toBe(formatBrierDisplay(expectedBest.brierScore!));
  });

  it("feeding an artifact map whose slices are shuffled and whose algorithms array is reversed produces identical figures", () => {
    const orderedMap = realArtifactsByYear();
    const shuffledMap = new Map<number, CompareArtifact>();
    for (const [season, artifact] of orderedMap) {
      shuffledMap.set(season, {
        ...artifact,
        algorithms: [...artifact.algorithms].reverse(),
        slices: [...artifact.slices].reverse(),
      });
    }
    expect(buildMethodologyFigures(shuffledMap)).toEqual(buildMethodologyFigures(orderedMap));
  });

  it("returns the incomplete form when a season lacks a VPR combined slice — the season list builds from whatever seasons are present, figures and best-season clause are absent", () => {
    const artifactsByYear = new Map<number, CompareArtifact>([
      [2022, makeMinimalArtifact(2022, 0.19)],
      [2023, makeMinimalArtifact(2023, 0.17)],
      // 2024, 2025, 2026 missing entirely.
    ]);
    const figures = buildMethodologyFigures(artifactsByYear);
    expect(figures?.complete).toBe(false);
    expect(figures?.seasons).toEqual([2022, 2023]);
    expect(figures && "seasonBriers" in figures).toBe(false);
  });

  it("returns the incomplete form when a season carries a null Brier", () => {
    const artifactsByYear = new Map<number, CompareArtifact>([
      [2022, makeMinimalArtifact(2022, 0.19)],
      [2023, makeMinimalArtifact(2023, 0.17)],
      [2024, makeMinimalArtifact(2024, 0.18)],
      [2025, makeMinimalArtifact(2025, null)],
      [2026, makeMinimalArtifact(2026, 0.15)],
    ]);
    const figures = buildMethodologyFigures(artifactsByYear);
    expect(figures?.complete).toBe(false);
  });

  it("returns nothing (undefined) when no season carries a matching slice at all", () => {
    expect(buildMethodologyFigures(new Map())).toBeUndefined();
  });

  it("reads no seasonLabel and produces identical figures whether or not every slice carries the vestigial field (D-4 tolerance)", () => {
    const withLabel = new Map<number, CompareArtifact>([
      [2022, makeMinimalArtifact(2022, 0.19, { includeSeasonLabel: true })],
      [2023, makeMinimalArtifact(2023, 0.17, { includeSeasonLabel: true })],
    ]);
    const withoutLabel = new Map<number, CompareArtifact>([
      [2022, makeMinimalArtifact(2022, 0.19, { includeSeasonLabel: false })],
      [2023, makeMinimalArtifact(2023, 0.17, { includeSeasonLabel: false })],
    ]);
    expect(buildMethodologyFigures(withLabel)).toEqual(buildMethodologyFigures(withoutLabel));
  });
});

describe("MethodologyNote — rendering", () => {
  it("the complete case renders every season's Brier figure and the best-season clause naming the derived season (D-5, quick task 260903-n2o: no season-list assertion — that text only ever came from the retired selection sentence)", () => {
    const artifactsByYear = realArtifactsByYear();
    const figures = buildMethodologyFigures(artifactsByYear);
    if (figures?.complete !== true) throw new Error("expected complete figures");
    render(<MethodologyNote artifactsByYear={artifactsByYear} />);
    const note = screen.getByTestId(METHODOLOGY_NOTE_TESTID);
    const text = note.textContent ?? "";

    for (const brier of figures.seasonBriers) expect(text).toContain(brier.text);
    expect(text).toContain(String(figures.bestSeason));
  });

  it("the incomplete case renders the near-tie caption alone and no second paragraph (D-5, quick task 260903-n2o: the retired selection sentence is gone, not replaced)", () => {
    const artifactsByYear = new Map<number, CompareArtifact>([
      [2022, makeMinimalArtifact(2022, 0.19)],
      [2023, makeMinimalArtifact(2023, 0.17)],
    ]);
    render(<MethodologyNote artifactsByYear={artifactsByYear} />);
    const note = screen.getByTestId(METHODOLOGY_NOTE_TESTID);
    const text = note.textContent ?? "";
    expect(text).toBe(NEAR_TIE_CAPTION);
    expect(note.querySelectorAll("p")).toHaveLength(1);
  });

  it("the complete form renders neither fragment of the retired leak-free-selection claim (D-5, quick task 260903-n2o)", () => {
    const artifactsByYear = realArtifactsByYear();
    render(<MethodologyNote artifactsByYear={artifactsByYear} />);
    const text = screen.getByTestId(METHODOLOGY_NOTE_TESTID).textContent ?? "";
    expect(text).not.toMatch(/selected using only seasons before/i);
    expect(text).not.toMatch(/no displayed season was scored/i);
  });

  it("the D-11 caption renders in every case, including when buildMethodologyFigures returns nothing", () => {
    render(<MethodologyNote artifactsByYear={new Map()} />);
    const text = screen.getByTestId(METHODOLOGY_NOTE_TESTID).textContent ?? "";
    expect(text).toContain(NEAR_TIE_CAPTION);
  });

  it("both paragraphs are always visible: no button, no disclosure toggle, no hover-only container; the block carries the muted body treatment", () => {
    const artifactsByYear = realArtifactsByYear();
    render(<MethodologyNote artifactsByYear={artifactsByYear} />);
    const note = screen.getByTestId(METHODOLOGY_NOTE_TESTID);
    expect(within(note).queryAllByRole("button")).toHaveLength(0);
    const paragraphs = note.querySelectorAll("p");
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    for (const p of Array.from(paragraphs)) {
      expect(p.className).toMatch(/text-role-body/);
      expect(p.className).toMatch(/text-\[var\(--color-text-muted\)\]/);
    }
  });

  it("renders no significance-claiming vocabulary anywhere in its output, case-insensitively", () => {
    const artifactsByYear = realArtifactsByYear();
    render(<MethodologyNote artifactsByYear={artifactsByYear} />);
    const text = (screen.getByTestId(METHODOLOGY_NOTE_TESTID).textContent ?? "").toLowerCase();
    expect(text).not.toMatch(/statistically significant/);
    expect(text).not.toMatch(/significance level/);
    expect(text).not.toMatch(/p-value/);
    expect(text).not.toMatch(/mcnemar/);
  });

  it("renders no dangling reference to the retired tune/holdout categories anywhere in its output, case-insensitively", () => {
    const artifactsByYear = realArtifactsByYear();
    render(<MethodologyNote artifactsByYear={artifactsByYear} />);
    const text = (screen.getByTestId(METHODOLOGY_NOTE_TESTID).textContent ?? "").toLowerCase();
    expect(text).not.toMatch(/\btune\b/);
    expect(text).not.toMatch(/\bholdout\b/);
  });

  it("renders identically whether or not every slice carries seasonLabel (D-4 tolerance, asserted at the component)", () => {
    const withLabel = new Map<number, CompareArtifact>([
      [2022, makeMinimalArtifact(2022, 0.19, { includeSeasonLabel: true })],
      [2023, makeMinimalArtifact(2023, 0.17, { includeSeasonLabel: true })],
    ]);
    const withoutLabel = new Map<number, CompareArtifact>([
      [2022, makeMinimalArtifact(2022, 0.19, { includeSeasonLabel: false })],
      [2023, makeMinimalArtifact(2023, 0.17, { includeSeasonLabel: false })],
    ]);

    const { unmount } = render(<MethodologyNote artifactsByYear={withLabel} />);
    const withLabelText = screen.getByTestId(METHODOLOGY_NOTE_TESTID).textContent ?? "";
    unmount();

    render(<MethodologyNote artifactsByYear={withoutLabel} />);
    const withoutLabelText = screen.getByTestId(METHODOLOGY_NOTE_TESTID).textContent ?? "";

    expect(withoutLabelText).toBe(withLabelText);
  });
});
