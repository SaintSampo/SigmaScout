/**
 * Pure coverage-row model behind the Compare page's Data coverage per year
 * section (08-12-PLAN.md Task 1) — mirrors `calibrationSeries.ts`'s split in
 * this same directory: no React import, no UI-framework dependency,
 * testable without a renderer.
 *
 * The central discipline of this module is D-09's "surfaces everything the
 * artifact carries" obligation, applied to a shape most of the app's fields
 * don't have. Measured against all 45 published slices this session: seven
 * of the eight coverage fields present at measurement time (`candidateCount`,
 * `scoredCount`, `tieCount` and all four ORIGINAL `exclusionCounts` members)
 * agree across OPR/EPA/VPR in all 15 (season, compLevelView) groups TODAY.
 * Quick task 260909-t5q's `coldStart` fifth member (below) postdates that
 * measurement and is absent from every published slice, so it was neither
 * agreeing nor disagreeing — see this header's own `coldStart` paragraph
 * for its distinct absent-vs-zero handling. The schema now declares FIVE
 * `exclusionCounts` members and NINE coverage fields in total. Nothing in
 * `CompareSliceSchema` or in
 * `aggregateScores` (`packages/harness/score.ts`) guarantees that agreement —
 * those fields are computed inside a per-algorithm loop, and
 * `exclusionCounts.quarantined` is by construction an algorithm-specific
 * verdict (`!isValidPRedWin(candidate.pRedWin)`) — so `collapseSharedCount`
 * below returns an explicit disagreed variant rather than silently
 * attributing one algorithm's own figure to the match population. The
 * alternative — printing the first algorithm's value under a header claiming
 * to describe the match population — would look exactly like a correct
 * render.
 *
 * Quick task 260909-t5q added a FIFTH exclusion column, `coldStart`
 * ("No prior data") — see `packages/harness/score.ts`'s
 * `ExclusionCounts.coldStart` doc comment for the algorithm-level contract.
 * It is structurally different from the other four: `CompareExclusionCountsSchema`
 * publishes it OPTIONALLY (D-04 defers the republish that would add it to
 * today's already-live four-key artifacts), so `collectOptional` below
 * treats a missing key as "this algorithm has no opinion" rather than
 * folding it into `collect`'s always-a-number contract — an algorithm with
 * no published value for this key is simply excluded from the collapse, so
 * a slice where NO published algorithm carries the key collapses to the
 * `absent` variant, never to an agreed `0`.
 *
 * `noCallCount` is the one coverage field that DOES vary by algorithm — a
 * no-call is a fact about an algorithm's own prediction (exactly 50%), not
 * about the match population it was scored on — so it is carried per
 * algorithm below and NEVER collapsed, even when all three happen to agree.
 *
 * A published count of zero is a real measurement and must render as the
 * agreed variant carrying zero. A season/view/algorithm with no matching
 * slice is a genuine absence and must render as the absent variant. Two of
 * the four ORIGINAL exclusion columns are zero in all 45 published slices
 * today, and — per D-04 — the fifth (`coldStart`) is ABSENT in every one of
 * those same live slices until a republish runs, so conflating the two
 * branches in either direction would be wrong on most of what this table
 * renders — the rendering layer (`DataCoverageTable.tsx`) maps `agreed`
 * value `0` to a printed digit and `absent` to the em-dash, and this
 * module's own job is keeping those two branches structurally distinct so
 * that mapping cannot collapse them by accident.
 *
 * This module performs NO arithmetic on any published figure: it never sums
 * the exclusion columns, never adds ties to no-calls, and never derives
 * winner accuracy's denominator. `scoreSet` (`packages/core/scoring/brier.ts`)
 * increments the accuracy denominator only when a prediction is neither a
 * tie nor a no-call, so a prediction that is BOTH is counted in both
 * published columns but dropped from the denominator exactly once —
 * subtracting scored minus ties minus no-calls would undercount by the size
 * of an overlap the artifact publishes nothing about.
 */
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { COMPARE_SEASONS, type CompareCompLevelView } from "../../lib/api/compare.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/** One `CompareArtifact`'s `slices[number]` element — the raw published shape this module reads and never re-exports. */
type CompareSlice = CompareArtifact["slices"][number];

/** The five `CompareExclusionCountsSchema` member names, in the table's declared column order. */
export type CoverageExclusionKey = "offseason" | "surrogateAffected" | "missingResult" | "quarantined" | "coldStart";

export interface CoverageExclusionColumn {
  readonly key: CoverageExclusionKey;
  readonly label: string;
}

/**
 * The table's fixed column order and the UI-SPEC's own header labels for
 * each — the only place these labels live. Never "... excluded": the
 * `Excluded from scoring` group header already carries that word, so
 * repeating it on every leaf column would be redundant.
 *
 * `coldStart` ("No prior data", quick task 260909-t5q) is deliberately LAST:
 * it is the newest column, published optionally (D-04), and reads as absent
 * on every slice today — placing it at the end keeps the four
 * always-present columns' positions unchanged for anyone already reading
 * this table.
 */
export const COVERAGE_EXCLUSION_COLUMNS: readonly CoverageExclusionColumn[] = [
  { key: "offseason", label: "Offseason" },
  { key: "surrogateAffected", label: "Surrogate-affected" },
  { key: "missingResult", label: "Missing result" },
  { key: "quarantined", label: "Quarantined" },
  { key: "coldStart", label: "No prior data" },
];

interface AlgorithmValue {
  readonly algorithmId: PublishedAlgorithmId;
  readonly value: number;
}

/**
 * The three-way outcome of collapsing one coverage field across whichever
 * algorithms published a slice for a given (season, compLevelView): all
 * present algorithms agree (`agreed`), at least two disagree (`disagreed`,
 * naming every one of them), or no algorithm published a slice at all
 * (`absent`). The `disagreed` member exists because the seven collapsible
 * fields' agreement is an EMPIRICAL property of today's data, not a schema
 * guarantee — see this module's own doc comment above.
 */
export type SharedCount =
  | { readonly kind: "agreed"; readonly value: number }
  | { readonly kind: "disagreed"; readonly values: readonly AlgorithmValue[] }
  | { readonly kind: "absent" };

/**
 * Collapses a readonly list of algorithm/value pairs into a `SharedCount`.
 * Empty yields `absent`; every value strictly equal (numeric, no tolerance —
 * these are published integers) yields `agreed`; anything else yields
 * `disagreed` with every pair re-emitted in `PUBLISHED_ALGORITHM_IDS` order,
 * NEVER in input order, so a caller supplying algorithms out of order still
 * gets a deterministic, republish-proof emission order.
 */
export function collapseSharedCount(values: readonly AlgorithmValue[]): SharedCount {
  if (values.length === 0) return { kind: "absent" };
  const first = values[0]!.value;
  const allEqual = values.every((entry) => entry.value === first);
  if (allEqual) return { kind: "agreed", value: first };
  const ordered = PUBLISHED_ALGORITHM_IDS.map((id) => values.find((entry) => entry.algorithmId === id)).filter(
    (entry): entry is AlgorithmValue => entry !== undefined,
  );
  return { kind: "disagreed", values: ordered };
}

/** One algorithm's own no-call count for a row, or `undefined` when that algorithm published no matching slice — the absent-vs-zero discriminator applied per algorithm, since no-calls are never collapsed. */
export interface NoCallEntry {
  readonly algorithmId: PublishedAlgorithmId;
  readonly count: number | undefined;
}

export interface CoverageRow {
  readonly season: number;
  readonly candidateCount: SharedCount;
  readonly scoredCount: SharedCount;
  readonly exclusionCounts: Readonly<Record<CoverageExclusionKey, SharedCount>>;
  readonly tieCount: SharedCount;
  /** Per algorithm, in `PUBLISHED_ALGORITHM_IDS` order — never collapsed. */
  readonly noCalls: readonly NoCallEntry[];
}

/**
 * Walks `COMPARE_SEASONS` in order and, for each season, walks
 * `PUBLISHED_ALGORITHM_IDS` in order to find that algorithm's single slice
 * matching this season and this view. Collapses the seven shared fields
 * through `collapseSharedCount` over whichever algorithms produced a slice;
 * carries `noCallCount` through per algorithm without collapsing it.
 *
 * Selects strictly by (season, algorithmId, compLevelView) together — a
 * slice from another season or another view never reaches a row it does not
 * belong to, and a season with no fetched artifact yields a row whose every
 * shared cell is `absent`.
 */
export function buildCoverageRows(
  artifactsByYear: ReadonlyMap<number, CompareArtifact>,
  compLevelView: CompareCompLevelView,
): CoverageRow[] {
  return COMPARE_SEASONS.map((season): CoverageRow => {
    const artifact = artifactsByYear.get(season);
    const slicesByAlgorithm = new Map<PublishedAlgorithmId, CompareSlice>();
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      const slice = artifact?.slices.find(
        (candidate) => candidate.algorithmId === algorithmId && candidate.season === season && candidate.compLevelView === compLevelView,
      );
      if (slice !== undefined) slicesByAlgorithm.set(algorithmId, slice);
    }

    function collect(reader: (slice: CompareSlice) => number): SharedCount {
      const values: AlgorithmValue[] = [];
      for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
        const slice = slicesByAlgorithm.get(algorithmId);
        if (slice !== undefined) values.push({ algorithmId, value: reader(slice) });
      }
      return collapseSharedCount(values);
    }

    /**
     * D-02/D-04 (quick task 260909-t5q): the `coldStart` column's own
     * collapse — `reader` may return `undefined` (the field is genuinely
     * absent from that algorithm's published slice, not zero). An
     * algorithm with an undefined reading is excluded from `values`
     * entirely, exactly like an algorithm with no slice at all — so a
     * column where NO published algorithm carries the key collapses to
     * `absent` via `collapseSharedCount`'s own empty-array rule, never to
     * an agreed `0`. This module's header explains why `collect` above
     * cannot be reused unchanged for this one column.
     */
    function collectOptional(reader: (slice: CompareSlice) => number | undefined): SharedCount {
      const values: AlgorithmValue[] = [];
      for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
        const slice = slicesByAlgorithm.get(algorithmId);
        if (slice === undefined) continue;
        const value = reader(slice);
        if (value !== undefined) values.push({ algorithmId, value });
      }
      return collapseSharedCount(values);
    }

    const exclusionCounts = {} as Record<CoverageExclusionKey, SharedCount>;
    for (const column of COVERAGE_EXCLUSION_COLUMNS) {
      exclusionCounts[column.key] =
        column.key === "coldStart"
          ? collectOptional((slice) => slice.exclusionCounts.coldStart)
          : collect((slice) => slice.exclusionCounts[column.key as Exclude<CoverageExclusionKey, "coldStart">]);
    }

    const noCalls: NoCallEntry[] = PUBLISHED_ALGORITHM_IDS.map((algorithmId) => ({
      algorithmId,
      count: slicesByAlgorithm.get(algorithmId)?.noCallCount,
    }));

    return {
      season,
      candidateCount: collect((slice) => slice.candidateCount),
      scoredCount: collect((slice) => slice.scoredCount),
      exclusionCounts,
      tieCount: collect((slice) => slice.tieCount),
      noCalls,
    };
  });
}
