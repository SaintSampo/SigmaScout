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
import compare2016 from "../../routes/__fixtures__/compare-2016.json";
import compare2017 from "../../routes/__fixtures__/compare-2017.json";
import compare2018 from "../../routes/__fixtures__/compare-2018.json";
import compare2019 from "../../routes/__fixtures__/compare-2019.json";
import compare2020 from "../../routes/__fixtures__/compare-2020.json";
import compare2022 from "../../routes/__fixtures__/compare-2022.json";
import compare2023 from "../../routes/__fixtures__/compare-2023.json";
import compare2024 from "../../routes/__fixtures__/compare-2024.json";
import compare2025 from "../../routes/__fixtures__/compare-2025.json";
import compare2026 from "../../routes/__fixtures__/compare-2026.json";

type Slice = CompareArtifact["slices"][number];

/** Fills every field `CompareSliceSchema` requires but this module never reads, so each test only names what it actually cares about. */
function makeSlice(overrides: Partial<Slice> & Pick<Slice, "algorithmId" | "season" | "compLevelView">): Slice {
  return {
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
      { algorithmId: "bpr", value: 5 },
    ]);
    expect(result).toEqual({ kind: "agreed", value: 5 });
  });

  it("three values where one differs return the disagreed variant carrying every supplied algorithm and its own value, in PUBLISHED_ALGORITHM_IDS order regardless of input order", () => {
    const result = collapseSharedCount([
      { algorithmId: "bpr", value: 7 },
      { algorithmId: "opr", value: 5 },
      { algorithmId: "epa", value: 5 },
    ]);
    expect(result).toEqual({
      kind: "disagreed",
      values: [
        { algorithmId: "opr", value: 5 },
        { algorithmId: "epa", value: 5 },
        { algorithmId: "bpr", value: 7 },
      ],
    });
  });

  it("an empty input returns the absent variant", () => {
    expect(collapseSharedCount([])).toEqual({ kind: "absent" });
  });

  it("a single supplied value returns the agreed variant — one algorithm agreeing with itself is agreement, not disagreement", () => {
    expect(collapseSharedCount([{ algorithmId: "bpr", value: 9 }])).toEqual({ kind: "agreed", value: 9 });
  });

  it("two equal values plus one absent algorithm return the agreed variant — an algorithm with no slice never forces a disagreement", () => {
    const result = collapseSharedCount([
      { algorithmId: "opr", value: 3 },
      { algorithmId: "bpr", value: 3 },
    ]);
    expect(result).toEqual({ kind: "agreed", value: 3 });
  });
});

describe("buildCoverageRows", () => {
  it("returns exactly one row per COMPARE_SEASONS entry, ascending, regardless of the input map's insertion order", () => {
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
    artifactsByYear.set(YEAR, artifactWith([makeSlice({ algorithmId: "bpr", season: YEAR, compLevelView: "combined", candidateCount: 42, noCallCount: 6 })]));
    const rows = buildCoverageRows(artifactsByYear, "combined");
    const row = rows.find((r) => r.season === YEAR)!;
    expect(row.candidateCount).toEqual({ kind: "agreed", value: 42 });
    const vprEntry = row.noCalls.find((e) => e.algorithmId === "bpr")!;
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

  it("noCallCount is returned per algorithm, in PUBLISHED_ALGORITHM_IDS order, and is NEVER collapsed — even when every algorithm happens to be equal", () => {
    // Counts are generated per published id rather than written out, so
    // adding an algorithm does not silently leave a hole here (the fixture
    // used to name three ids literally, and a fourth arrived as `undefined`).
    const distinctCounts = PUBLISHED_ALGORITHM_IDS.map((_, i) => 10 * (i + 1));
    const artifactsByYear = new Map<number, CompareArtifact>();
    artifactsByYear.set(
      YEAR,
      artifactWith(
        PUBLISHED_ALGORITHM_IDS.map((algorithmId, i) =>
          makeSlice({ algorithmId, season: YEAR, compLevelView: "combined", noCallCount: distinctCounts[i]! }),
        ),
      ),
    );
    let rows = buildCoverageRows(artifactsByYear, "combined");
    let row = rows.find((r) => r.season === YEAR)!;
    expect(row.noCalls.map((e) => e.algorithmId)).toEqual([...PUBLISHED_ALGORITHM_IDS]);
    expect(row.noCalls.map((e) => e.count)).toEqual(distinctCounts);

    // Every algorithm equal: still one entry each, never one collapsed value.
    artifactsByYear.set(
      YEAR,
      artifactWith(PUBLISHED_ALGORITHM_IDS.map((algorithmId) => makeSlice({ algorithmId, season: YEAR, compLevelView: "combined", noCallCount: 15 }))),
    );
    rows = buildCoverageRows(artifactsByYear, "combined");
    row = rows.find((r) => r.season === YEAR)!;
    expect(row.noCalls).toHaveLength(PUBLISHED_ALGORITHM_IDS.length);
    expect(row.noCalls.every((e) => e.count === 15)).toBe(true);
  });

  it("every other coverage field IS collapsed — disagreeing candidateCounts yield the disagreed variant naming every algorithm, and the row's other cells are unaffected", () => {
    const artifactsByYear = new Map<number, CompareArtifact>();
    // One algorithm (epa) disagrees; the rest agree. Built from the registry so
    // a newly published algorithm joins the majority instead of going missing.
    artifactsByYear.set(
      YEAR,
      artifactWith(
        PUBLISHED_ALGORITHM_IDS.map((algorithmId) =>
          makeSlice({
            algorithmId,
            season: YEAR,
            compLevelView: "combined",
            candidateCount: algorithmId === "epa" ? 101 : 100,
            tieCount: 4,
          }),
        ),
      ),
    );
    const rows = buildCoverageRows(artifactsByYear, "combined");
    const row = rows.find((r) => r.season === YEAR)!;
    expect(row.candidateCount.kind).toBe("disagreed");
    if (row.candidateCount.kind === "disagreed") {
      expect(row.candidateCount.values.map((v) => v.algorithmId)).toEqual([...PUBLISHED_ALGORITHM_IDS]);
    }
    expect(row.tieCount).toEqual({ kind: "agreed", value: 4 });
  });

  it("COVERAGE_EXCLUSION_COLUMNS is a readonly ordered list of the five exclusion keys, and buildCoverageRows emits cells keyed by those same keys", () => {
    // Written as a single `toEqual` against a literal, NEVER as a loop over
    // the column list — a loop would silently skip a future sixth key
    // (quick task 260909-t5q added this fifth, `coldStart`, deliberately
    // LAST — see COVERAGE_EXCLUSION_COLUMNS' own doc comment).
    expect(COVERAGE_EXCLUSION_COLUMNS.map((c) => c.key)).toEqual([
      "offseason",
      "surrogateAffected",
      "missingResult",
      "quarantined",
      "coldStart",
    ]);

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
    expect(keys.sort()).toEqual(["coldStart", "missingResult", "offseason", "quarantined", "surrogateAffected"]);
    expect(row.exclusionCounts.offseason).toEqual({ kind: "agreed", value: 1 });
    expect(row.exclusionCounts.surrogateAffected).toEqual({ kind: "agreed", value: 2 });
    expect(row.exclusionCounts.missingResult).toEqual({ kind: "agreed", value: 3 });
    expect(row.exclusionCounts.quarantined).toEqual({ kind: "agreed", value: 4 });
    // The fixture above never sets `coldStart` on any of the three
    // algorithms' slices — the live D-04 case — so the column collapses to
    // ABSENT, never to an agreed 0.
    expect(row.exclusionCounts.coldStart).toEqual({ kind: "absent" });
  });

  /**
   * D-02/D-04 (quick task 260909-t5q): the `coldStart` column's own
   * dedicated coverage, per the plan's `<behavior>` block.
   */
  describe("coldStart column — absent-vs-agreed-vs-disagreed (D-02/D-04)", () => {
    it("a slice whose published exclusion counts carry only the original four keys collapses coldStart to the ABSENT variant, not to an agreed value of 0", () => {
      const artifactsByYear = new Map<number, CompareArtifact>();
      artifactsByYear.set(
        YEAR,
        artifactWith(
          PUBLISHED_ALGORITHM_IDS.map((algorithmId) =>
            makeSlice({
              algorithmId,
              season: YEAR,
              compLevelView: "combined",
              exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0 },
            }),
          ),
        ),
      );
      const rows = buildCoverageRows(artifactsByYear, "combined");
      const row = rows.find((r) => r.season === YEAR)!;
      expect(row.exclusionCounts.coldStart).toEqual({ kind: "absent" });
    });

    it("two algorithms publishing different coldStart values collapse to the disagreed variant, naming both", () => {
      const artifactsByYear = new Map<number, CompareArtifact>();
      artifactsByYear.set(
        YEAR,
        artifactWith([
          makeSlice({
            algorithmId: "opr",
            season: YEAR,
            compLevelView: "combined",
            exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0, coldStart: 12 },
          }),
          makeSlice({
            algorithmId: "epa",
            season: YEAR,
            compLevelView: "combined",
            exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0, coldStart: 7 },
          }),
        ]),
      );
      const rows = buildCoverageRows(artifactsByYear, "combined");
      const row = rows.find((r) => r.season === YEAR)!;
      expect(row.exclusionCounts.coldStart.kind).toBe("disagreed");
      if (row.exclusionCounts.coldStart.kind === "disagreed") {
        const byAlgorithm = Object.fromEntries(row.exclusionCounts.coldStart.values.map((v) => [v.algorithmId, v.value]));
        expect(byAlgorithm.opr).toBe(12);
        expect(byAlgorithm.epa).toBe(7);
      }
    });

    it("all published algorithms agreeing on a real coldStart value collapses to agreed, including agreeing on zero", () => {
      const artifactsByYear = new Map<number, CompareArtifact>();
      artifactsByYear.set(
        YEAR,
        artifactWith(
          PUBLISHED_ALGORITHM_IDS.map((algorithmId) =>
            makeSlice({
              algorithmId,
              season: YEAR,
              compLevelView: "combined",
              exclusionCounts: { offseason: 0, surrogateAffected: 0, missingResult: 0, quarantined: 0, coldStart: 0 },
            }),
          ),
        ),
      );
      const rows = buildCoverageRows(artifactsByYear, "combined");
      const row = rows.find((r) => r.season === YEAR)!;
      expect(row.exclusionCounts.coldStart).toEqual({ kind: "agreed", value: 0 });
    });
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
    2016: compare2016 as unknown as { slices: Slice[] },
    2017: compare2017 as unknown as { slices: Slice[] },
    2018: compare2018 as unknown as { slices: Slice[] },
    2019: compare2019 as unknown as { slices: Slice[] },
    2020: compare2020 as unknown as { slices: Slice[] },
    2022: compare2022 as unknown as { slices: Slice[] },
    2023: compare2023 as unknown as { slices: Slice[] },
    2024: compare2024 as unknown as { slices: Slice[] },
    2025: compare2025 as unknown as { slices: Slice[] },
    2026: compare2026 as unknown as { slices: Slice[] },
  };

  it("over all ten committed fixtures and all three views, candidateCount equals scoredCount plus the four exclusion counts — one check per season, view and published algorithm", () => {
    let checked = 0;
    for (const season of COMPARE_SEASONS) {
      for (const slice of FIXTURES[season]!.slices) {
        // The committed fixtures still carry `vpr` slices for the seasons it
        // was published on, and that is correct — the compare artifact is a
        // historical record and VPR's retirement (2026-09-09) removed it from
        // the SITE, not from data already written. This guard is about the
        // algorithms the site publishes, so a retired id is skipped rather
        // than counted.
        if (!(PUBLISHED_ALGORITHM_IDS as readonly string[]).includes(slice.algorithmId)) continue;
        const excludedTotal =
          slice.exclusionCounts.offseason + slice.exclusionCounts.surrogateAffected + slice.exclusionCounts.missingResult + slice.exclusionCounts.quarantined;
        expect(slice.candidateCount, `season ${season} algorithm ${slice.algorithmId} view ${slice.compLevelView}`).toBe(slice.scoredCount + excludedTotal);
        checked += 1;
      }
    }
    // 10 seasons x 3 views x one slice per published algorithm.
    expect(checked).toBe(COMPARE_SEASONS.length * 3 * PUBLISHED_ALGORITHM_IDS.length);
  });
});
