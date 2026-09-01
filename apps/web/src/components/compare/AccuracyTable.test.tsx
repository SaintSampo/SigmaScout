import { describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import {
  AccuracyTable,
  AccuracyTableSkeleton,
  buildAccuracyRows,
  buildRowEmphasis,
  BRIER_HEADER_LABEL,
  WINNER_ACCURACY_HEADER_LABEL,
  COMPARE_ACCURACY_SCROLL_TESTID,
  type AccuracyCell,
  type AccuracyRow,
} from "./AccuracyTable.js";
import { COMPARE_SEASONS } from "../../lib/api/compare.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

afterEach(() => {
  cleanup();
});

const EMPTY_EXCLUSION_COUNTS = { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 };

interface SliceOverrides {
  algorithmId: string;
  season: number;
  compLevelView?: "qualification" | "elimination" | "combined";
  brierScore?: number | null;
  winnerAccuracy?: number | null;
  scoredCount?: number;
}

function makeSlice(overrides: SliceOverrides) {
  return {
    algorithmId: overrides.algorithmId,
    season: overrides.season,
    seasonLabel: "holdout" as const,
    headlineEligible: true,
    compLevelView: overrides.compLevelView ?? "combined",
    brierScore: "brierScore" in overrides ? (overrides.brierScore ?? null) : 0.15,
    winnerAccuracy: "winnerAccuracy" in overrides ? (overrides.winnerAccuracy ?? null) : 0.75,
    scoredCount: overrides.scoredCount ?? 1000,
    tieCount: 0,
    noCallCount: 0,
    exclusionCounts: EMPTY_EXCLUSION_COUNTS,
    candidateCount: 1000,
    calibrationBins: [],
  };
}

function makeArtifact(season: number, slices: ReturnType<typeof makeSlice>[], algorithmIds: readonly string[] = PUBLISHED_ALGORITHM_IDS): CompareArtifact {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-30T00:00:00.000Z",
    algorithms: algorithmIds.map((id) => ({ id, version: "1.0.0+x", codeVersion: "1.0.0", paramSetName: "x" })),
    slices,
  } as CompareArtifact;
}

/** A full, all-view artifact for one season: every algorithm x every view. */
function fullSeasonArtifact(season: number, algorithmIds: readonly string[] = PUBLISHED_ALGORITHM_IDS): CompareArtifact {
  const views: ("qualification" | "elimination" | "combined")[] = ["qualification", "elimination", "combined"];
  const slices = algorithmIds.flatMap((algorithmId) =>
    views.map((compLevelView) =>
      makeSlice({
        algorithmId,
        season,
        compLevelView,
        brierScore: 0.1 + views.indexOf(compLevelView) * 0.01,
        winnerAccuracy: 0.7 + views.indexOf(compLevelView) * 0.01,
      }),
    ),
  );
  return makeArtifact(season, slices, algorithmIds);
}

function fullArtifactsByYear(): Map<number, CompareArtifact> {
  const map = new Map<number, CompareArtifact>();
  for (const season of COMPARE_SEASONS) {
    map.set(season, fullSeasonArtifact(season));
  }
  return map;
}

describe("buildAccuracyRows", () => {
  it("orders rows by COMPARE_SEASONS ascending regardless of the map's insertion order", () => {
    const map = new Map<number, CompareArtifact>();
    // Insert in DESCENDING order deliberately.
    for (const season of [...COMPARE_SEASONS].sort((a, b) => b - a)) {
      map.set(season, fullSeasonArtifact(season));
    }
    const rows = buildAccuracyRows(map, "combined");
    expect(rows.map((r) => r.season)).toEqual([...COMPARE_SEASONS]);
  });

  it("column set is PUBLISHED_ALGORITHM_IDS regardless of the artifact's own algorithms array order or slices array order", () => {
    const map = new Map<number, CompareArtifact>();
    for (const season of COMPARE_SEASONS) {
      const artifact = fullSeasonArtifact(season);
      // Reverse `algorithms` and shuffle `slices`.
      const reversedAlgorithms = [...artifact.algorithms].reverse();
      const shuffledSlices = [...artifact.slices].reverse();
      map.set(season, { ...artifact, algorithms: reversedAlgorithms, slices: shuffledSlices });
    }
    const rows = buildAccuracyRows(map, "combined");
    for (const row of rows) {
      expect(Object.keys(row.cells)).toEqual(expect.arrayContaining([...PUBLISHED_ALGORITHM_IDS]));
      for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
        expect(row.cells[algorithmId as keyof typeof row.cells].brierScore).not.toBeNull();
      }
    }
  });

  it("selects the slice by season AND compLevelView together — the qualification/elimination figures never leak into the combined view", () => {
    const season = COMPARE_SEASONS[0]!;
    const artifact = fullSeasonArtifact(season);
    const map = new Map<number, CompareArtifact>([[season, artifact]]);
    const rows = buildAccuracyRows(map, "combined");
    const row = rows.find((r) => r.season === season)!;
    const combinedSlice = artifact.slices.find((s) => s.algorithmId === PUBLISHED_ALGORITHM_IDS[0] && s.compLevelView === "combined")!;
    expect(row.cells[PUBLISHED_ALGORITHM_IDS[0] as keyof typeof row.cells].brierScore).toBe(combinedSlice.brierScore);
  });

  it("a null brierScore/winnerAccuracy on a real slice stays null (never coerced to 0)", () => {
    const season = COMPARE_SEASONS[0]!;
    const artifact = makeArtifact(season, [makeSlice({ algorithmId: PUBLISHED_ALGORITHM_IDS[0]!, season, brierScore: null, winnerAccuracy: null })]);
    const map = new Map<number, CompareArtifact>([[season, artifact]]);
    const rows = buildAccuracyRows(map, "combined");
    const cell = rows.find((r) => r.season === season)!.cells[PUBLISHED_ALGORITHM_IDS[0] as keyof (typeof rows)[number]["cells"]];
    expect(cell.brierScore).toBeNull();
    expect(cell.winnerAccuracy).toBeNull();
  });

  it("a season with no matching slice for one algorithm yields an absent cell for both figures, and never substitutes a different season's slice", () => {
    const season = COMPARE_SEASONS[0]!;
    const otherSeason = COMPARE_SEASONS[1]!;
    // Artifact carries a slice for `otherSeason`, not `season` — a season
    // mismatch, deliberately, to prove no cross-season substitution happens.
    const artifact = makeArtifact(season, [makeSlice({ algorithmId: PUBLISHED_ALGORITHM_IDS[0]!, season: otherSeason, brierScore: 0.999, winnerAccuracy: 0.999 })]);
    const map = new Map<number, CompareArtifact>([[season, artifact]]);
    const rows = buildAccuracyRows(map, "combined");
    const cell = rows.find((r) => r.season === season)!.cells[PUBLISHED_ALGORITHM_IDS[0] as keyof (typeof rows)[number]["cells"]];
    expect(cell.brierScore).toBeNull();
    expect(cell.winnerAccuracy).toBeNull();
  });

  it("a season with no fetched artifact at all yields absent cells for every algorithm at that row, and other rows are unaffected", () => {
    const map = fullArtifactsByYear();
    const missingSeason = COMPARE_SEASONS[2]!;
    map.delete(missingSeason);
    const rows = buildAccuracyRows(map, "combined");
    const missingRow = rows.find((r) => r.season === missingSeason)!;
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      expect(missingRow.cells[algorithmId as keyof typeof missingRow.cells].brierScore).toBeNull();
    }
    const presentRow = rows.find((r) => r.season === COMPARE_SEASONS[0])!;
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      expect(presentRow.cells[algorithmId as keyof typeof presentRow.cells].brierScore).not.toBeNull();
    }
  });
});

const ABSENT_TEST_CELL: AccuracyCell = { hasSlice: false, brierScore: null, winnerAccuracy: null, scoredCount: 0 };

function makeCell(overrides: Partial<AccuracyCell> = {}): AccuracyCell {
  return { hasSlice: true, brierScore: 0.15, winnerAccuracy: 0.75, scoredCount: 1000, ...overrides };
}

function makeRow(season: number, cells: Partial<Record<PublishedAlgorithmId, AccuracyCell>>): AccuracyRow {
  const full = {} as Record<PublishedAlgorithmId, AccuracyCell>;
  for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
    full[algorithmId] = cells[algorithmId] ?? ABSENT_TEST_CELL;
  }
  return { season, cells: full };
}

describe("buildRowEmphasis (D-11) — direct, unrendered, on hand-built rows", () => {
  it("a row with a clear leader in both metrics names that leader in both", () => {
    const row = makeRow(2022, {
      opr: makeCell({ brierScore: 0.2, winnerAccuracy: 0.5, scoredCount: 1000 }),
      epa: makeCell({ brierScore: 0.1, winnerAccuracy: 0.9, scoredCount: 1000 }),
      vpr: makeCell({ brierScore: 0.3, winnerAccuracy: 0.6, scoredCount: 1000 }),
    });
    const emphasis = buildRowEmphasis(row);
    expect(emphasis.brierLeaders).toEqual(["epa"]);
    expect(emphasis.winnerAccuracyLeaders).toEqual(["epa"]);
  });

  it("a row whose Brier pair is a display tie (real 2022 elimination values) names no Brier leader", () => {
    const row = makeRow(2022, {
      opr: makeCell({ brierScore: 0.14721222242674725, winnerAccuracy: 0.3, scoredCount: 1000 }),
      vpr: makeCell({ brierScore: 0.14717091997830647, winnerAccuracy: 0.6, scoredCount: 1000 }),
    });
    expect(buildRowEmphasis(row).brierLeaders).toEqual([]);
  });

  it("a row whose accuracy pair sits inside the combined standard error (real 2022 elimination triple) names no accuracy leader, even though Brier still resolves", () => {
    const row = makeRow(2022, {
      opr: makeCell({ brierScore: 0.2, winnerAccuracy: 0.7930232558139535, scoredCount: 2613 }),
      epa: makeCell({ brierScore: 0.25, winnerAccuracy: 0.778544061302682, scoredCount: 2613 }),
      vpr: makeCell({ brierScore: 0.3, winnerAccuracy: 0.782375478927203, scoredCount: 2613 }),
    });
    const emphasis = buildRowEmphasis(row);
    expect(emphasis.winnerAccuracyLeaders).toEqual([]);
    expect(emphasis.brierLeaders).toEqual(["opr"]);
  });

  it("a row with an exact tie in each metric names BOTH tied algorithms in each", () => {
    const row = makeRow(2022, {
      opr: makeCell({ brierScore: 0.15, winnerAccuracy: 0.7, scoredCount: 1000 }),
      vpr: makeCell({ brierScore: 0.15, winnerAccuracy: 0.7, scoredCount: 500 }),
    });
    const emphasis = buildRowEmphasis(row);
    expect(emphasis.brierLeaders).toEqual(["opr", "vpr"]);
    expect(emphasis.winnerAccuracyLeaders).toEqual(["opr", "vpr"]);
  });

  it("a row with only one comparable cell per metric names no leader for either metric", () => {
    const row = makeRow(2022, {
      opr: makeCell({ brierScore: 0.15, winnerAccuracy: 0.7, scoredCount: 1000 }),
    });
    const emphasis = buildRowEmphasis(row);
    expect(emphasis.brierLeaders).toEqual([]);
    expect(emphasis.winnerAccuracyLeaders).toEqual([]);
  });
});

describe("AccuracyTable — header structure and Copywriting Contract strings", () => {
  it("renders a row-label header 'Year' spanning two rows, three algorithm-group headers spanning two columns each in PUBLISHED_ALGORITHM_IDS order, and a second header row of three metric-header pairs", () => {
    const artifactsByYear = fullArtifactsByYear();
    render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);

    const yearHeader = screen.getByRole("columnheader", { name: "Year" });
    expect(yearHeader.getAttribute("rowspan")).toBe("2");

    const groupHeaders = screen.getAllByRole("columnheader", { name: /^(OPR|EPA|VPR)$/ });
    expect(groupHeaders.map((h) => h.textContent)).toEqual(["OPR", "EPA", "VPR"]);
    for (const header of groupHeaders) {
      expect(header.getAttribute("colspan")).toBe("2");
    }

    const accuracyHeaders = screen.getAllByRole("columnheader", { name: WINNER_ACCURACY_HEADER_LABEL });
    expect(accuracyHeaders).toHaveLength(3);
    const brierHeaders = screen.getAllByRole("columnheader", { name: BRIER_HEADER_LABEL });
    expect(brierHeaders).toHaveLength(3);

    // Exactly 7 leaf columns in the body: Year + 3 algorithms x 2 metrics.
    const table = screen.getByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(2); // 2 header rows precede
    expect(within(bodyRows[0]!).getAllByRole("cell")).toHaveLength(7);
  });

  it("the accuracy header's accessible text is exactly the Copywriting Contract's Winner Accuracy string, and the Brier header carries the lower-is-better parenthetical", () => {
    expect(WINNER_ACCURACY_HEADER_LABEL).toBe("Winner Accuracy");
    expect(BRIER_HEADER_LABEL).toBe("Brier Score (lower is better)");
  });
});

describe("AccuracyTable — ordering (COMP-01)", () => {
  it("column order is PUBLISHED_ALGORITHM_IDS' own order even when the artifact's algorithms array is reversed and slices shuffled", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    for (const season of COMPARE_SEASONS) {
      const artifact = fullSeasonArtifact(season);
      artifactsByYear.set(season, {
        ...artifact,
        algorithms: [...artifact.algorithms].reverse(),
        slices: [...artifact.slices].reverse(),
      });
    }
    render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const groupHeaders = screen.getAllByRole("columnheader", { name: /^(OPR|EPA|VPR)$/ });
    expect(groupHeaders.map((h) => h.textContent)).toEqual(["OPR", "EPA", "VPR"]);
  });

  it("row order is COMPARE_SEASONS ascending even when the year-keyed map is built in descending insertion order", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    for (const season of [...COMPARE_SEASONS].sort((a, b) => b - a)) {
      artifactsByYear.set(season, fullSeasonArtifact(season));
    }
    render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const table = screen.getByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(2);
    const renderedYears = bodyRows.map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(renderedYears).toEqual([...COMPARE_SEASONS].map(String));
  });
});

describe("AccuracyTable — precision formatting (COMP-01)", () => {
  it("formats brierScore as a four-decimal fixed-point string and winnerAccuracy as a one-decimal percentage, computed from the same inputs the test feeds — never hand-typed digit strings", () => {
    const season = COMPARE_SEASONS[0]!;
    const rawBrier = 0.15012807378698909;
    const rawAccuracy = 0.7913181346017167;
    const artifact = makeArtifact(season, [
      makeSlice({ algorithmId: PUBLISHED_ALGORITHM_IDS[0]!, season, brierScore: rawBrier, winnerAccuracy: rawAccuracy }),
    ]);
    const artifactsByYear = new Map<number, CompareArtifact>([[season, artifact]]);
    render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);

    const expectedBrierText = rawBrier.toFixed(4);
    const expectedAccuracyText = `${(rawAccuracy * 100).toFixed(1)}%`;
    expect(screen.getByText(expectedBrierText)).toBeDefined();
    expect(screen.getByText(expectedAccuracyText)).toBeDefined();
  });
});

describe("AccuracyTable — empty/absent values (COMP-01)", () => {
  it("a null brierScore renders a blank cell (never an em-dash), with its column header still present", () => {
    const season = COMPARE_SEASONS[0]!;
    const artifact = makeArtifact(season, [
      makeSlice({ algorithmId: PUBLISHED_ALGORITHM_IDS[0]!, season, brierScore: null, winnerAccuracy: 0.5 }),
    ]);
    const artifactsByYear = new Map<number, CompareArtifact>([[season, artifact]]);
    render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    expect(screen.getAllByRole("columnheader", { name: BRIER_HEADER_LABEL }).length).toBeGreaterThan(0);

    const table = screen.getByRole("table");
    const seasonRow = within(table)
      .getAllByRole("row")
      .find((row) => within(row).queryAllByRole("cell")[0]?.textContent === String(season))!;
    expect(seasonRow).toBeDefined();
    // Cell order per row: Year, then per algorithm [accuracy, brier].
    const cells = within(seasonRow).getAllByRole("cell");
    expect(cells[1]!.textContent).toBe("50.0%");
    expect(cells[2]!.textContent).toBe("");
    expect(seasonRow.textContent).not.toContain("—");
  });

  it("a null winnerAccuracy behaves identically — a blank cell, never a zero, an em-dash, or a placeholder string", () => {
    const season = COMPARE_SEASONS[0]!;
    const artifact = makeArtifact(season, [
      makeSlice({ algorithmId: PUBLISHED_ALGORITHM_IDS[0]!, season, brierScore: 0.5, winnerAccuracy: null }),
    ]);
    const artifactsByYear = new Map<number, CompareArtifact>([[season, artifact]]);
    render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const table = screen.getByRole("table");
    const seasonRow = within(table)
      .getAllByRole("row")
      .find((row) => within(row).queryAllByRole("cell")[0]?.textContent === String(season))!;
    expect(seasonRow).toBeDefined();
    const cells = within(seasonRow).getAllByRole("cell");
    expect(cells[1]!.textContent).toBe("");
    expect(cells[2]!.textContent).toBe("0.5000");
    expect(seasonRow.textContent).not.toContain("—");
    expect(screen.queryByText("0.00")).toBeNull();
    expect(screen.queryByText("0.0%")).toBeNull();
  });

  it("a year whose artifact carries no matching slice for one algorithm renders the em-dash in BOTH of that algorithm's cells, leaving the other two algorithms' cells for that row unaffected", () => {
    const season = COMPARE_SEASONS[0]!;
    const [algoA, algoB, algoC] = PUBLISHED_ALGORITHM_IDS;
    const artifact = makeArtifact(season, [
      makeSlice({ algorithmId: algoB!, season, brierScore: 0.3, winnerAccuracy: 0.6 }),
      makeSlice({ algorithmId: algoC!, season, brierScore: 0.4, winnerAccuracy: 0.7 }),
      // algoA has no slice for this season at all.
    ]);
    const artifactsByYear = new Map<number, CompareArtifact>([[season, artifact]]);
    const rows = buildAccuracyRows(artifactsByYear, "combined");
    const row = rows.find((r) => r.season === season)!;
    expect(row.cells[algoA as keyof typeof row.cells].brierScore).toBeNull();
    expect(row.cells[algoA as keyof typeof row.cells].winnerAccuracy).toBeNull();
    expect(row.cells[algoB as keyof typeof row.cells].brierScore).toBe(0.3);
    expect(row.cells[algoC as keyof typeof row.cells].brierScore).toBe(0.4);
  });
});

describe("AccuracyTable — slice selection by view (COMP-01)", () => {
  it("with the combined view selected, qualification and elimination figures appear nowhere in the rendered output", () => {
    const season = COMPARE_SEASONS[0]!;
    const artifact = fullSeasonArtifact(season, [PUBLISHED_ALGORITHM_IDS[0]!]);
    const artifactsByYear = new Map<number, CompareArtifact>([[season, artifact]]);
    render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);

    const qualSlice = artifact.slices.find((s) => s.compLevelView === "qualification")!;
    const elimSlice = artifact.slices.find((s) => s.compLevelView === "elimination")!;
    expect(screen.queryByText(qualSlice.brierScore!.toFixed(4))).toBeNull();
    expect(screen.queryByText(elimSlice.brierScore!.toFixed(4))).toBeNull();
  });
});

describe("AccuracyTable — plain weight and no tiering (D-08); D-11 emphasis (08-06)", () => {
  it("every numeric cell carries the numeric-cell class, no muted/greyed/reduced-opacity/loser-ink/per-algorithm-colour class ever reaches any cell, and a semibold class reaches EXACTLY the cells buildRowEmphasis names for each row — computed, never hand-typed", () => {
    const artifactsByYear = fullArtifactsByYear();
    const { container } = render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const html = container.innerHTML;
    // The muted/greyed/colour half is UNCHANGED and strengthened — D-11
    // never adds a treatment to a "losing" cell, only withholds weight from
    // a leader.
    expect(html).not.toMatch(/text-muted-foreground/);
    expect(html).not.toMatch(/compare-algo-/);
    expect(html).not.toMatch(/loser-ink/);
    expect(html).not.toMatch(/opacity-/);

    const numericCells = container.querySelectorAll(".numeric-cell");
    expect(numericCells.length).toBeGreaterThan(0);

    // The semibold half: for every row, buildRowEmphasis is the SAME
    // function this test asks whether a cell is bold — so this is a proof
    // that rendering agrees with the computed rule, not a second
    // independently-typed expectation that could silently drift from it.
    const rows = buildAccuracyRows(artifactsByYear, "combined");
    const table = screen.getByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(2);
    rows.forEach((row, rowIndex) => {
      const emphasis = buildRowEmphasis(row);
      const cells = within(bodyRows[rowIndex]!).getAllByRole("cell");
      PUBLISHED_ALGORITHM_IDS.forEach((algorithmId, algoIndex) => {
        const accuracyCellIndex = 1 + algoIndex * 2;
        const brierCellIndex = accuracyCellIndex + 1;
        const expectAccuracyBold = emphasis.winnerAccuracyLeaders.includes(algorithmId);
        const expectBrierBold = emphasis.brierLeaders.includes(algorithmId);
        expect(/font-semibold/.test(cells[accuracyCellIndex]!.className)).toBe(expectAccuracyBold);
        expect(/font-semibold/.test(cells[brierCellIndex]!.className)).toBe(expectBrierBold);
      });
    });
  });

  it("a row whose leaders differ between the two metrics bolds one cell in each metric, in different algorithm column-groups — emphasis is per metric, never per row", () => {
    const season = COMPARE_SEASONS[0]!;
    const artifact = makeArtifact(season, [
      makeSlice({ algorithmId: "opr", season, brierScore: 0.1, winnerAccuracy: 0.5, scoredCount: 1000 }),
      makeSlice({ algorithmId: "epa", season, brierScore: 0.3, winnerAccuracy: 0.9, scoredCount: 1000 }),
      makeSlice({ algorithmId: "vpr", season, brierScore: 0.2, winnerAccuracy: 0.6, scoredCount: 1000 }),
    ]);
    const artifactsByYear = new Map<number, CompareArtifact>([[season, artifact]]);
    render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);

    const table = screen.getByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(2);
    const row = bodyRows.find((r) => within(r).getAllByRole("cell")[0]?.textContent === String(season))!;
    const cells = within(row).getAllByRole("cell");
    // Layout: [Year, opr-accuracy, opr-brier, epa-accuracy, epa-brier, vpr-accuracy, vpr-brier]
    expect(/font-semibold/.test(cells[1]!.className)).toBe(false); // opr accuracy: not the leader (epa is)
    expect(/font-semibold/.test(cells[2]!.className)).toBe(true); // opr brier: the leader (lowest, 0.1)
    expect(/font-semibold/.test(cells[3]!.className)).toBe(true); // epa accuracy: the leader (highest, 0.9)
    expect(/font-semibold/.test(cells[4]!.className)).toBe(false); // epa brier: not the leader
    expect(/font-semibold/.test(cells[5]!.className)).toBe(false); // vpr accuracy: not the leader
    expect(/font-semibold/.test(cells[6]!.className)).toBe(false); // vpr brier: not the leader
  });

  it("a cell built from a slice with scoredCount zero still builds and renders its figures, and only its emphasis is withheld", () => {
    const season = COMPARE_SEASONS[0]!;
    const artifact = makeArtifact(season, [
      makeSlice({ algorithmId: "opr", season, brierScore: 0.1, winnerAccuracy: 0.9, scoredCount: 0 }),
      makeSlice({ algorithmId: "vpr", season, brierScore: 0.5, winnerAccuracy: 0.1, scoredCount: 1000 }),
    ]);
    const artifactsByYear = new Map<number, CompareArtifact>([[season, artifact]]);
    const rows = buildAccuracyRows(artifactsByYear, "combined");
    const row = rows.find((r) => r.season === season)!;
    const oprCell = row.cells["opr" as PublishedAlgorithmId];
    expect(oprCell.winnerAccuracy).toBe(0.9);
    expect(oprCell.scoredCount).toBe(0);
    // Rendered, opr's 0.9 figure still appears despite the zero count.
    render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    expect(screen.getByText("90.0%")).toBeDefined();
    // But emphasis is withheld — a huge lead cannot overcome a zero count.
    const emphasis = buildRowEmphasis(row);
    expect(emphasis.winnerAccuracyLeaders).toEqual([]);
  });

  it("neither the string tune nor holdout appears anywhere in the rendered output, and no element carries a class/data attribute derived from seasonLabel or headlineEligible, even when both fields are present on every slice", () => {
    const artifactsByYear = fullArtifactsByYear();
    const { container } = render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const html = container.innerHTML;
    expect(html.toLowerCase()).not.toMatch(/\btune\b/);
    expect(html.toLowerCase()).not.toMatch(/\bholdout\b/);
    expect(html).not.toMatch(/headline-eligible|headlineEligible/);
  });
});

describe("AccuracyTable — scroll region", () => {
  it("sits inside exactly one element carrying the app's table-scroll class set and the exported scroll test id, with no nested scroll region", () => {
    const artifactsByYear = fullArtifactsByYear();
    const { container } = render(<AccuracyTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const scrollRegions = screen.getAllByTestId(COMPARE_ACCURACY_SCROLL_TESTID);
    expect(scrollRegions).toHaveLength(1);
    const region = scrollRegions[0]!;
    expect(region.className).toMatch(/overflow-x-auto/);
    expect(region.className).toMatch(/touch-pan-xy/);
    expect(region.className).toMatch(/overscroll-x-contain/);
    expect(region.className).toMatch(/min-w-0/);
    // No DESCENDANT of the region also carries the same testid — `within()`
    // only searches inside the container, never including it — so zero
    // matches here means the outer region found above is the only one.
    const nested = within(region).queryAllByTestId(COMPARE_ACCURACY_SCROLL_TESTID);
    expect(nested).toHaveLength(0);
    void container;
  });
});

describe("AccuracyTableSkeleton", () => {
  it("renders the real two-row header followed by SkeletonRows sized for five rows and seven columns — never a spinner, never headerless", () => {
    render(<AccuracyTableSkeleton />);
    expect(screen.getByRole("columnheader", { name: "Year" })).toBeDefined();
    const groupHeaders = screen.getAllByRole("columnheader", { name: /^(OPR|EPA|VPR)$/ });
    expect(groupHeaders).toHaveLength(3);

    const table = screen.getByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(2);
    expect(bodyRows).toHaveLength(5);
    expect(within(bodyRows[0]!).getAllByRole("cell")).toHaveLength(7);
  });
});
