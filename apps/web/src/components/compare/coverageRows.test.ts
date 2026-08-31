/**
 * TDD RED-then-GREEN test for `coverageRows.ts` (08-12-PLAN.md Task 1).
 * Every input below is a hand-written `CompareArtifact`-shaped object
 * literal — this module is pure and its expectations must be independent of
 * the committed fixtures. The one exception is the identity guard at the
 * end, which is deliberately fixture-based and says so.
 */
import { describe, expect, it } from "vitest";
import {
  buildCoverageRows,
  collapseSharedCount,
  COVERAGE_EXCLUSION_COLUMNS,
  type CoverageExclusionKey,
} from "./coverageRows.js";
import { COMPARE_SEASONS } from "../../lib/api/compare.js";
import { PUBLISHED_ALGORITHM_IDS } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import compare2022 from "../../routes/__fixtures__/compare-2022.json";
import compare2023 from "../../routes/__fixtures__/compare-2023.json";
import compare2024 from "../../routes/__fixtures__/compare-2024.json";
import compare2025 from "../../routes/__fixtures__/compare-2025.json";
import compare2026 from "../../routes/__fixtures__/compare-2026.json";

type Slice = CompareArtifact["slices"][number];

/** Fills every field `CompareSliceSchema` requires but this module never reads, so each test only names what it actually cares about. */
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

function artifactWith(slices: Slice[]): CompareArtifact {
  return { schemaVersion: 1, generation: "test", computedAt: "2026-01-01T00:00:00Z", algorithms: [], slices } as unknown as CompareArtifact;
}

const YEAR = 2024;

describe("collapseSharedCount", () => {
  it("three equal values return the agreed variant carrying that value", () => {
    const result = collapseSharedCount([
      { algorithmId: "opr", value: 5 },
      { algorithmId: "epa", value: 5 },
      { algorithmId: "vpr", value: 5 },
    ]);
    expect(result).toEqual({ kind: "agreed", value: 5 });
  });

  it("three values where one differs return the disagreed variant carrying every supplied algorithm and its own value, in PUBLISHED_ALGORITHM_IDS order regardless of input order", () => {
    const result = collapseSharedCount([
      { algorithmId: "vpr", value: 7 },
      { algorithmId: "opr", value: 5 },
      { algorithmId: "epa", value: 5 },
    ]);
    expect(result).toEqual({
      kind: "disagreed",
      values: [
        { algorithmId: "opr", value: 5 },
        { algorithmId: "epa", value: 5 },
        { algorithmId: "vpr", value: 7 },
      ],
    });
  });

  it("an empty input returns the absent variant", () => {
    expect(collapseSharedCount([])).toEqual({ kind: "absent" });
  });

  it("a single supplied value returns the agreed variant — one algorithm agreeing with itself is agreement, not disagreement", () => {
    expect(collapseSharedCount([{ algorithmId: "vpr", value: 9 }])).toEqual({ kind: "agreed", value: 9 });
  });

  it("two equal values plus one absent algorithm return the agreed variant — an algorithm with no slice never forces a disagreement", () => {
    const result = collapseSharedCount([
      { algorithmId: "opr", value: 3 },
      { algorithmId: "vpr", value: 3 },
    ]);
    expect(result).toEqual({ kind: "agreed", value: 3 });
  });
});

describe("buildCoverageRows", () => {
  it("returns exactly five rows for the five COMPARE_SEASONS, ascending, regardless of the input map's insertion order", () => {
    const slices: Slice[] = [];
    for (const season of [...COMPARE_SEASONS].reverse()) {
      for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
        slices.push(makeSlice({ algorithmId, season, compLevelView: "combined" }));
      }
    }
    const artifactsByYear = new Map<number, CompareArtifact>();
    for (const season of [...COMPARE_SEASONS].reverse()) {
      artifactsByYear.set(season, artifactWith(slices.filter((s) => s.season === season)));
    }
    const rows = buildCoverageRows(artifactsByYear, "combined");
    expect(rows.map((r) => r.season)).toEqual([...COMPARE_SEASONS]);
  });

  it("selects each slice by season, algorithm id AND compLevelView together — a qualification/elimination slice does not leak into the combined-view row", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(
      YEAR,
      artifactWith(
        PUBLISHED_ALGORITHM_IDS.flatMap((algorithmId) => [
          makeSlice({ algorithmId, season: YEAR, compLevelView: "combined", candidateCount: 100 }),
          makeSlice({ algorithmId, season: YEAR, compLevelView: "qualification", candidateCount: 200 }),
          makeSlice({ algorithmId, season: YEAR, compLevelView: "elimination", candidateCount: 300 }),
        ]),
      ),
    );
    const combinedRows = buildCoverageRows(artifactsByYear, "combined");
    const row = combinedRows.find((r) => r.season === YEAR)!;
    expect(row.candidateCount).toEqual({ kind: "agreed", value: 100 });
  });

  it("never substitutes a slice from a different season", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(
      YEAR,
      artifactWith([
        ...PUBLISHED_ALGORITHM_IDS.map((algorithmId) => makeSlice({ algorithmId, season: YEAR, compLevelView: "combined", candidateCount: 111 })),
        ...PUBLISHED_ALGORITHM_IDS.map((algorithmId) => makeSlice({ algorithmId, season: YEAR - 1, compLevelView: "combined", candidateCount: 999 })),
      ]),
    );
    const rows = buildCoverageRows(artifactsByYear, "combined");
    const row = rows.find((r) => r.season === YEAR)!;
    expect(row.candidateCount).toEqual({ kind: "agreed", value: 111 });
  });

  it("a season with no fetched artifact yields a row whose every shared cell is absent and whose no-call entry for every algorithm is absent", () => {
    const rows = buildCoverageRows(new Map(), "combined");
    const row = rows.find((r) => r.season === YEAR)!;
    expect(row.candidateCount).toEqual({ kind: "absent" });
    expect(row.scoredCount).toEqual({ kind: "absent" });
    expect(row.tieCount).toEqual({ kind: "absent" });
    for (const column of COVERAGE_EXCLUSION_COLUMNS) {
      expect(row.exclusionCounts[column.key]).toEqual({ kind: "absent" });
    }
    for (const entry of row.noCalls) {
      expect(entry.count).toBeUndefined();
    }
  });

  it("a season carrying slices for only one algorithm yields agreed shared cells from that algorithm and absent no-call entries for the other two", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(YEAR, artifactWith([makeSlice({ algorithmId: "vpr", season: YEAR, compLevelView: "combined", candidateCount: 42, noCallCount: 6 })]));
    const rows = buildCoverageRows(artifactsByYear, "combined");
    const row = rows.find((r) => r.season === YEAR)!;
    expect(row.candidateCount).toEqual({ kind: "agreed", value: 42 });
    const vprEntry = row.noCalls.find((e) => e.algorithmId === "vpr")!;
    expect(vprEntry.count).toBe(6);
    const oprEntry = row.noCalls.find((e) => e.algorithmId === "opr")!;
    const epaEntry = row.noCalls.find((e) => e.algorithmId === "epa")!;
    expect(oprEntry.count).toBeUndefined();
    expect(epaEntry.count).toBeUndefined();
  });

  it("a published count of ZERO produces the agreed variant carrying zero — never absent — for a zero exclusion count, a zero tie count and a zero no-call count", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(
      YEAR,
      artifactWith(
        PUBLISHED_ALGORITHM_IDS.map((algorithmId) =>
          makeSlice({
            algorithmId,
            season: YEAR,
            compLevelView: "combined",
            tieCount: 0,
            noCallCount: 0,
            exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 },
          }),
        ),
      ),
    );
    const rows = buildCoverageRows(artifactsByYear, "combined");
    const row = rows.find((r) => r.season === YEAR)!;
    expect(row.tieCount).toEqual({ kind: "agreed", value: 0 });
    expect(row.exclusionCounts.missingResult).toEqual({ kind: "agreed", value: 0 });
    for (const entry of row.noCalls) expect(entry.count).toBe(0);
  });

  it("noCallCount is returned per algorithm, in PUBLISHED_ALGORITHM_IDS order, and is NEVER collapsed — even when all three happen to be equal", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(
      YEAR,
      artifactWith([
        makeSlice({ algorithmId: "opr", season: YEAR, compLevelView: "combined", noCallCount: 10 }),
        makeSlice({ algorithmId: "epa", season: YEAR, compLevelView: "combined", noCallCount: 20 }),
        makeSlice({ algorithmId: "vpr", season: YEAR, compLevelView: "combined", noCallCount: 30 }),
      ]),
    );
    let rows = buildCoverageRows(artifactsByYear, "combined");
    let row = rows.find((r) => r.season === YEAR)!;
    expect(row.noCalls.map((e) => e.algorithmId)).toEqual([...PUBLISHED_ALGORITHM_IDS]);
    expect(row.noCalls.map((e) => e.count)).toEqual([10, 20, 30]);

    // All three equal: still three entries, never one collapsed value.
    artifactsByYear.set(
      YEAR,
      artifactWith(PUBLISHED_ALGORITHM_IDS.map((algorithmId) => makeSlice({ algorithmId, season: YEAR, compLevelView: "combined", noCallCount: 15 }))),
    );
    rows = buildCoverageRows(artifactsByYear, "combined");
    row = rows.find((r) => r.season === YEAR)!;
    expect(row.noCalls).toHaveLength(3);
    expect(row.noCalls.every((e) => e.count === 15)).toBe(true);
  });

  it("every other coverage field IS collapsed — disagreeing candidateCounts yield the disagreed variant naming all three, and the row's other cells are unaffected", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(
      YEAR,
      artifactWith([
        makeSlice({ algorithmId: "opr", season: YEAR, compLevelView: "combined", candidateCount: 100, tieCount: 4 }),
        makeSlice({ algorithmId: "epa", season: YEAR, compLevelView: "combined", candidateCount: 101, tieCount: 4 }),
        makeSlice({ algorithmId: "vpr", season: YEAR, compLevelView: "combined", candidateCount: 100, tieCount: 4 }),
      ]),
    );
    const rows = buildCoverageRows(artifactsByYear, "combined");
    const row = rows.find((r) => r.season === YEAR)!;
    expect(row.candidateCount.kind).toBe("disagreed");
    if (row.candidateCount.kind === "disagreed") {
      expect(row.candidateCount.values.map((v) => v.algorithmId)).toEqual([...PUBLISHED_ALGORITHM_IDS]);
    }
    expect(row.tieCount).toEqual({ kind: "agreed", value: 4 });
  });

  it("COVERAGE_EXCLUSION_COLUMNS is a readonly ordered list of the four exclusion keys, and buildCoverageRows emits cells keyed by those same keys", () => {
    expect(COVERAGE_EXCLUSION_COLUMNS.map((c) => c.key)).toEqual(["offseason", "surrogateAffected", "missingResult", "quarantined"]);

    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(
      YEAR,
      artifactWith(
        PUBLISHED_ALGORITHM_IDS.map((algorithmId) =>
          makeSlice({
            algorithmId,
            season: YEAR,
            compLevelView: "combined",
            exclusionCounts: { offseason: 1, surrogateAffected: 2, missingResult: 3, quarantined: 4 },
          }),
        ),
      ),
    );
    const rows = buildCoverageRows(artifactsByYear, "combined");
    const row = rows.find((r) => r.season === YEAR)!;
    const keys = Object.keys(row.exclusionCounts) as CoverageExclusionKey[];
    expect(keys.sort()).toEqual(["missingResult", "offseason", "quarantined", "surrogateAffected"]);
    expect(row.exclusionCounts.offseason).toEqual({ kind: "agreed", value: 1 });
    expect(row.exclusionCounts.surrogateAffected).toEqual({ kind: "agreed", value: 2 });
    expect(row.exclusionCounts.missingResult).toEqual({ kind: "agreed", value: 3 });
    expect(row.exclusionCounts.quarantined).toEqual({ kind: "agreed", value: 4 });
  });

  it("performs no arithmetic: a distinctive sum of a row's own exclusion counts appears in no returned cell", () => {
    const DISTINCTIVE_SUM = 1 + 3 + 5 + 9; // = 18, chosen to not collide with any input field below
    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(
      YEAR,
      artifactWith(
        PUBLISHED_ALGORITHM_IDS.map((algorithmId) =>
          makeSlice({
            algorithmId,
            season: YEAR,
            compLevelView: "combined",
            candidateCount: 100,
            scoredCount: 82,
            tieCount: 7,
            noCallCount: 11,
            exclusionCounts: { offseason: 1, surrogateAffected: 3, missingResult: 5, quarantined: 9 },
          }),
        ),
      ),
    );
    const rows = buildCoverageRows(artifactsByYear, "combined");
    const row = rows.find((r) => r.season === YEAR)!;
    const rendered: number[] = [];
    for (const field of [row.candidateCount, row.scoredCount, row.tieCount, ...Object.values(row.exclusionCounts)]) {
      if (field.kind === "agreed") rendered.push(field.value);
    }
    for (const entry of row.noCalls) if (entry.count !== undefined) rendered.push(entry.count);
    expect(rendered).not.toContain(DISTINCTIVE_SUM);
  });
});

describe("candidate/scored/exclusion identity guard (fixture-based, labelled as such)", () => {
  const FIXTURES: Record<number, { slices: Slice[] }> = {
    2022: compare2022 as unknown as { slices: Slice[] },
    2023: compare2023 as unknown as { slices: Slice[] },
    2024: compare2024 as unknown as { slices: Slice[] },
    2025: compare2025 as unknown as { slices: Slice[] },
    2026: compare2026 as unknown as { slices: Slice[] },
  };

  it("over all five committed fixtures and all three views, candidateCount equals scoredCount plus the four exclusion counts — measured at planning time: 45 of 45", () => {
    let checked = 0;
    for (const season of COMPARE_SEASONS) {
      for (const slice of FIXTURES[season]!.slices) {
        const excludedTotal =
          slice.exclusionCounts.offseason + slice.exclusionCounts.surrogateAffected + slice.exclusionCounts.missingResult + slice.exclusionCounts.quarantined;
        expect(slice.candidateCount, `season ${season} algorithm ${slice.algorithmId} view ${slice.compLevelView}`).toBe(slice.scoredCount + excludedTotal);
        checked += 1;
      }
    }
    expect(checked).toBe(45);
  });
});
