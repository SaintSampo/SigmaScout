/**
 * TDD RED-then-GREEN test for `DataCoverageTable.tsx` (08-12-PLAN.md Task 2).
 * Inputs are hand-written `CompareArtifact`-shaped object literals — this
 * component's own tests need adversarial shapes (reversed algorithms,
 * shuffled slices, disagreeing algorithms) the real published artifact does
 * not contain. Fixture-derived parity lives in `compare.test.tsx` (Task 3).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  coverageCellTestId,
  DATA_COVERAGE_EXPLAINER_D09,
  DATA_COVERAGE_EXPLAINER_STRUCTURE,
  DATA_COVERAGE_EXPLAINER_TESTID,
  DATA_COVERAGE_HEADING,
  DATA_COVERAGE_SCROLL_TESTID,
  DATA_COVERAGE_SECTION_TESTID,
  DataCoverageSection,
  DataCoverageSectionSkeleton,
  DataCoverageTable,
} from "./DataCoverageTable.js";
import { COVERAGE_EXCLUSION_COLUMNS } from "./coverageRows.js";
import { COMPARE_SEASONS } from "../../lib/api/compare.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../../../packages/harness/publishedAlgorithms.js";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

type Slice = CompareArtifact["slices"][number];

function makeSlice(overrides: Partial<Slice> & Pick<Slice, "algorithmId" | "season" | "compLevelView">): Slice {
  return {
    seasonLabel: "tune",
    headlineEligible: false,
    brierScore: 0.2,
    winnerAccuracy: 0.7,
    scoredCount: 100,
    tieCount: 0,
    noCallCount: 0,
    exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 },
    candidateCount: 100,
    calibrationBins: [],
    ...overrides,
  };
}

function artifactWith(slices: Slice[], algorithmsOrder: readonly string[] = [...PUBLISHED_ALGORITHM_IDS]): CompareArtifact {
  return {
    schemaVersion: 1,
    generation: "test",
    computedAt: "2026-01-01T00:00:00Z",
    algorithms: algorithmsOrder.map((id) => ({ id, version: "1.0.0", codeVersion: "1.0.0", paramSetName: "default" })),
    slices,
  } as unknown as CompareArtifact;
}

const YEAR = 2024;

function fullYearArtifact(overrides: Partial<Record<string, Partial<Slice>>> = {}): Map<number, CompareArtifact> {
  const map = new Map<number, CompareArtifact>();
  map.set(
    YEAR,
    artifactWith(PUBLISHED_ALGORITHM_IDS.map((algorithmId) => makeSlice({ algorithmId, season: YEAR, compLevelView: "combined", ...overrides[algorithmId] }))),
  );
  return map;
}

afterEach(() => cleanup());

describe("DataCoverageTable — header structure", () => {
  it("renders the fixed two-row grouped header with the right spans and eleven leaf columns", () => {
    render(<DataCoverageTable artifactsByYear={fullYearArtifact()} compLevelView="combined" />);
    const table = screen.getByRole("table");

    expect(screen.getByRole("columnheader", { name: "Year" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Candidate matches" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Scored matches" })).toBeDefined();
    const excludedGroup = screen.getByRole("columnheader", { name: "Excluded from scoring" });
    expect(excludedGroup.getAttribute("colspan")).toBe(String(COVERAGE_EXCLUSION_COLUMNS.length));
    expect(screen.getByRole("columnheader", { name: "Ties" })).toBeDefined();
    const noCallGroup = screen.getByRole("columnheader", { name: "No-calls by algorithm" });
    expect(noCallGroup.getAttribute("colspan")).toBe(String(PUBLISHED_ALGORITHM_IDS.length));

    for (const column of COVERAGE_EXCLUSION_COLUMNS) {
      expect(screen.getByRole("columnheader", { name: column.label })).toBeDefined();
    }
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      expect(screen.getByRole("columnheader", { name: algorithmDisplayLabel(algorithmId) })).toBeDefined();
    }

    const rows = within(table).getAllByRole("row");
    const firstBodyRow = rows[2]!;
    expect(within(firstBodyRow).getAllByRole("cell")).toHaveLength(11);
  });

  it("a reversed algorithms array and a shuffled slices array leave header order and every cell value unchanged", () => {
    const orderedSlices = PUBLISHED_ALGORITHM_IDS.map((algorithmId, index) =>
      makeSlice({ algorithmId, season: YEAR, compLevelView: "combined", candidateCount: 100 + index }),
    );
    const shuffled = [orderedSlices[2]!, orderedSlices[0]!, orderedSlices[1]!];
    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(YEAR, artifactWith(shuffled, [...PUBLISHED_ALGORITHM_IDS].reverse()));

    render(<DataCoverageTable artifactsByYear={artifactsByYear} compLevelView="combined" />);

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Year",
      "Candidate matches",
      "Scored matches",
      "Excluded from scoring",
      "Ties",
      "No-calls by algorithm",
      ...COVERAGE_EXCLUSION_COLUMNS.map((c) => c.label),
      ...PUBLISHED_ALGORITHM_IDS.map((id) => algorithmDisplayLabel(id)),
    ]);

    // Candidate counts disagree (100/101/102) so the cell renders the
    // disagreed variant — order of the underlying arrays must not matter.
    const cell = screen.getByTestId(coverageCellTestId(YEAR, "candidateCount"));
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      expect(cell.textContent).toContain(algorithmDisplayLabel(algorithmId));
    }
  });
});

describe("DataCoverageTable — cell rendering (published zero vs absent slice)", () => {
  it("a published zero renders the digit zero, never a blank cell — for a zero exclusion count, a zero tie count and a zero no-call count", () => {
    const artifactsByYear = fullYearArtifact({
      opr: { exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 }, tieCount: 0, noCallCount: 0 },
      epa: { exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 }, tieCount: 0, noCallCount: 0 },
      vpr: { exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 }, tieCount: 0, noCallCount: 0 },
    });
    render(<DataCoverageTable artifactsByYear={artifactsByYear} compLevelView="combined" />);

    const missingResultCell = screen.getByTestId(coverageCellTestId(YEAR, "missingResult"));
    expect(missingResultCell.textContent).toBe("0");
    expect(missingResultCell.textContent).not.toContain("—");

    const tieCell = screen.getByTestId(coverageCellTestId(YEAR, "tieCount"));
    expect(tieCell.textContent).toBe("0");
    expect(tieCell.textContent).not.toContain("—");

    const noCallCell = screen.getByTestId(coverageCellTestId(YEAR, "noCall:opr"));
    expect(noCallCell.textContent).toBe("0");
    expect(noCallCell.textContent).not.toContain("—");
  });

  it("an absent cell renders blank, never the digit zero and never an em-dash — for a season with no artifact and for one algorithm's missing no-call entry", () => {
    render(<DataCoverageTable artifactsByYear={new Map()} compLevelView="combined" />);
    const candidateCell = screen.getByTestId(coverageCellTestId(YEAR, "candidateCount"));
    expect(candidateCell.textContent).toBe("");
    expect(candidateCell.textContent).not.toContain("0");

    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(YEAR, artifactWith([makeSlice({ algorithmId: "vpr", season: YEAR, compLevelView: "combined" })]));
    cleanup();
    render(<DataCoverageTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const oprNoCallCell = screen.getByTestId(coverageCellTestId(YEAR, "noCall:opr"));
    expect(oprNoCallCell.textContent).toBe("");
    expect(oprNoCallCell.textContent).not.toContain("0");
  });

  it("a published zero and an absent sibling cell in the same row render differently", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(YEAR, artifactWith([makeSlice({ algorithmId: "vpr", season: YEAR, compLevelView: "combined", tieCount: 0 })]));
    render(<DataCoverageTable artifactsByYear={artifactsByYear} compLevelView="combined" />);

    const tieCell = screen.getByTestId(coverageCellTestId(YEAR, "tieCount"));
    expect(tieCell.textContent).toBe("0");
    const oprNoCallCell = screen.getByTestId(coverageCellTestId(YEAR, "noCall:opr"));
    expect(oprNoCallCell.textContent).toBe("");
  });

  it("a disagreed shared cell renders all three algorithm labels with their own values, never a single collapsed number", () => {
    const artifactsByYear = fullYearArtifact({
      opr: { candidateCount: 100 },
      epa: { candidateCount: 101 },
      vpr: { candidateCount: 102 },
    });
    render(<DataCoverageTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const cell = screen.getByTestId(coverageCellTestId(YEAR, "candidateCount"));
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      expect(cell.textContent).toContain(algorithmDisplayLabel(algorithmId));
    }
    expect(cell.textContent).not.toBe("100");
  });

  it("every numeric cell carries the numeric-cell class, and a five-digit count renders as bare digits with no thousands separator", () => {
    const artifactsByYear = fullYearArtifact({
      opr: { candidateCount: 12345 },
      epa: { candidateCount: 12345 },
      vpr: { candidateCount: 12345 },
    });
    render(<DataCoverageTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const cell = screen.getByTestId(coverageCellTestId(YEAR, "candidateCount"));
    expect(cell.className).toContain("numeric-cell");
    expect(cell.textContent).toBe("12345");
  });
});

describe("DataCoverageTable — structure, order and emphasis", () => {
  it("renders five rows, seasons ascending, regardless of the input map's insertion order", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    for (const season of [...COMPARE_SEASONS].reverse()) {
      artifactsByYear.set(season, artifactWith(PUBLISHED_ALGORITHM_IDS.map((algorithmId) => makeSlice({ algorithmId, season, compLevelView: "combined" }))));
    }
    render(<DataCoverageTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(2);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual(COMPARE_SEASONS.map(String));
  });

  it("no element in this component carries a semibold, muted, opacity or colour treatment inside the table's own scroll region", () => {
    render(<DataCoverageTable artifactsByYear={fullYearArtifact()} compLevelView="combined" />);
    const scrollRegion = screen.getByTestId(DATA_COVERAGE_SCROLL_TESTID);
    expect(scrollRegion.innerHTML).not.toMatch(/font-semibold|font-\[600\]|opacity-|text-muted-foreground/);
  });

  it("never reads or renders the tune/holdout split — neither the string 'tune' nor 'holdout' appears", () => {
    const artifactsByYear = fullYearArtifact({
      opr: { seasonLabel: "tune" },
      epa: { seasonLabel: "holdout" },
      vpr: { seasonLabel: "tune" },
    });
    render(<DataCoverageTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const table = screen.getByRole("table");
    expect(table.textContent?.toLowerCase()).not.toContain("tune");
    expect(table.textContent?.toLowerCase()).not.toContain("holdout");
  });
});

describe("DataCoverageSection — the explainer", () => {
  it("renders the Copywriting Contract's D-09 sentence character for character", () => {
    render(<DataCoverageSection artifactsByYear={fullYearArtifact()} compLevelView="combined" />);
    expect(screen.getByTestId(DATA_COVERAGE_EXPLAINER_TESTID).textContent).toContain(DATA_COVERAGE_EXPLAINER_D09);
  });

  it("also renders the authored structural sentence beside it", () => {
    render(<DataCoverageSection artifactsByYear={fullYearArtifact()} compLevelView="combined" />);
    expect(screen.getByTestId(DATA_COVERAGE_SECTION_TESTID).textContent).toContain(DATA_COVERAGE_EXPLAINER_STRUCTURE);
  });

  it("renders the heading text", () => {
    render(<DataCoverageSection artifactsByYear={fullYearArtifact()} compLevelView="combined" />);
    expect(screen.getByText(DATA_COVERAGE_HEADING)).toBeDefined();
  });

  // <!-- planner-discipline-allow: offseason events are ignored, offseason matches are ignored, offseason events are excluded from the model, offseason matches are not used, ignores offseason -->
  it("the rendered-DOM offseason-vocabulary gate: none of the forbidden phrasings appear anywhere in the section, case-insensitively", () => {
    render(<DataCoverageSection artifactsByYear={fullYearArtifact()} compLevelView="combined" />);
    const text = (screen.getByTestId(DATA_COVERAGE_SECTION_TESTID).textContent ?? "").toLowerCase();
    const forbidden = [
      "offseason events are ignored",
      "offseason matches are ignored",
      "offseason events are excluded from the model",
      "offseason matches are not used",
      "ignores offseason",
    ];
    for (const phrase of forbidden) expect(text).not.toContain(phrase);
  });

  it("the explainer is always visible: no button, no disclosure toggle in the section's rendered output", () => {
    render(<DataCoverageSection artifactsByYear={fullYearArtifact()} compLevelView="combined" />);
    const section = screen.getByTestId(DATA_COVERAGE_SECTION_TESTID);
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
  });

  it("the explainer block is a DOM sibling of the table's scroll region, not a descendant of it", () => {
    render(<DataCoverageSection artifactsByYear={fullYearArtifact()} compLevelView="combined" />);
    const explainer = screen.getByTestId(DATA_COVERAGE_EXPLAINER_TESTID);
    const scrollRegion = screen.getByTestId(DATA_COVERAGE_SCROLL_TESTID);
    expect(scrollRegion.contains(explainer)).toBe(false);
    expect(explainer.contains(scrollRegion)).toBe(false);
  });
});

describe("DataCoverageTable — no derived column", () => {
  it("the rendered row contains exactly eleven cells and none equals the sum of the four exclusion cells, ties+no-calls, or scored-minus-ties-minus-no-calls", () => {
    const artifactsByYear = fullYearArtifact({
      opr: {
        candidateCount: 1000,
        scoredCount: 900,
        tieCount: 20,
        noCallCount: 30,
        exclusionCounts: { offseason: 40, surrogateAffected: 10, missingResult: 20, quarantined: 30 },
      },
      epa: {
        candidateCount: 1000,
        scoredCount: 900,
        tieCount: 20,
        noCallCount: 30,
        exclusionCounts: { offseason: 40, surrogateAffected: 10, missingResult: 20, quarantined: 30 },
      },
      vpr: {
        candidateCount: 1000,
        scoredCount: 900,
        tieCount: 20,
        noCallCount: 30,
        exclusionCounts: { offseason: 40, surrogateAffected: 10, missingResult: 20, quarantined: 30 },
      },
    });
    render(<DataCoverageTable artifactsByYear={artifactsByYear} compLevelView="combined" />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(2);
    const row = rows.find((r) => within(r).getAllByRole("cell")[0]!.textContent === String(YEAR))!;
    const cells = within(row).getAllByRole("cell");
    expect(cells).toHaveLength(11);

    const excludedTotal = 40 + 10 + 20 + 30;
    const tiesPlusNoCalls = 20 + 30;
    const derivedDenominator = 900 - 20 - 30;
    const cellTexts = cells.map((c) => c.textContent);
    expect(cellTexts).not.toContain(String(excludedTotal));
    expect(cellTexts).not.toContain(String(tiesPlusNoCalls));
    expect(cellTexts).not.toContain(String(derivedDenominator));
  });
});

describe("DataCoverageSectionSkeleton", () => {
  it("renders the heading and the real two-row header above SkeletonRows sized for five rows and eleven columns", () => {
    render(<DataCoverageSectionSkeleton />);
    expect(screen.getByText(DATA_COVERAGE_HEADING)).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Year" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Excluded from scoring" })).toBeDefined();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
