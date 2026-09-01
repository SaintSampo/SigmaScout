import { Fragment } from "react";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SkeletonRows } from "@/components/Skeletons";
import { cn } from "@/lib/utils";
import {
  formatBrierDisplay,
  formatWinnerAccuracyDisplay,
  resolveBrierLeaders,
  resolveWinnerAccuracyLeaders,
  type BrierCandidate,
  type WinnerAccuracyCandidate,
} from "@/lib/compareTie";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import { COMPARE_SEASONS, type CompareCompLevelView } from "../../lib/api/compare.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The COMP-01 accuracy table (08-01-PLAN.md Task 2, complete to D-08;
 * 08-06-PLAN.md Task 2 adds D-11's emphasis): one uniform table, five
 * ascending season rows against three `PUBLISHED_ALGORITHM_IDS`-ordered
 * algorithm column-groups, sketch 007's winning structure, no tune/holdout
 * tiering anywhere. A cell renders at weight 600 ONLY where `buildRowEmphasis`
 * (backed by `compareTie.ts`'s two computed tie tests) names a real leader
 * for that cell's metric — never a naive max/min, and never by adding a
 * treatment to the "losing" cell. This supersedes 08-01's deliberate
 * uniform-plain-weight truth, which was explicitly scoped to await this
 * plan (see 08-06-PLAN.md "Supersedes").
 */

export const COMPARE_ACCURACY_SCROLL_TESTID = "compare-accuracy-scroll";

/** The Copywriting Contract's two exact header strings — read by 08-06 and 08-12 rather than retyped. */
export const WINNER_ACCURACY_HEADER_LABEL = "Winner Accuracy";
export const BRIER_HEADER_LABEL = "Brier Score (lower is better)";

const ACCURACY_TABLE_ROW_COUNT = 5;
const ACCURACY_TABLE_COLUMN_COUNT = 7; // Year + 3 algorithms x 2 metrics

/**
 * One (season, algorithm, compLevelView) triple's figures. `hasSlice` is the
 * discriminator between "the artifact published a slice, and its own figure
 * is genuinely null" and "no matching slice exists for this triple at all"
 * — both render identically (an em-dash), but the discriminator lets a
 * future consumer (e.g. 08-06's near-tie rule) tell the two cases apart
 * without re-deriving the search.
 */
export interface AccuracyCell {
  readonly hasSlice: boolean;
  readonly brierScore: number | null;
  readonly winnerAccuracy: number | null;
  /**
   * The matched slice's own `scoredCount` (08-06-PLAN.md Flagged Planner
   * Assumption 4 — 08-01 did not anticipate this field). Exists solely so
   * `buildRowEmphasis`'s accuracy tie test can build each cell's standard
   * error from that cell's OWN count, per view, rather than a row- or
   * artifact-level count. Never rendered.
   */
  readonly scoredCount: number;
}

export interface AccuracyRow {
  readonly season: number;
  readonly cells: Readonly<Record<PublishedAlgorithmId, AccuracyCell>>;
}

const ABSENT_CELL: AccuracyCell = { hasSlice: false, brierScore: null, winnerAccuracy: null, scoredCount: 0 };

/**
 * Pure row model (08-01-PLAN.md Task 2's `buildAccuracyRows`). Walks
 * `COMPARE_SEASONS` in order, and for each season walks
 * `PUBLISHED_ALGORITHM_IDS` in order, selecting the single slice from THAT
 * season's own fetched artifact whose `algorithmId`/`season`/`compLevelView`
 * all match. A season with no fetched artifact, or an artifact carrying no
 * matching slice, yields the absent-cell discriminator — never a slice from
 * another season and never a fabricated zero. This function performs no
 * arithmetic on any published figure beyond this selection: EVAL-05's claim
 * is that the rendered numbers ARE the artifact's numbers.
 */
export function buildAccuracyRows(
  artifactsByYear: ReadonlyMap<number, CompareArtifact>,
  compLevelView: CompareCompLevelView,
): AccuracyRow[] {
  return COMPARE_SEASONS.map((season): AccuracyRow => {
    const artifact = artifactsByYear.get(season);
    const cells = {} as Record<PublishedAlgorithmId, AccuracyCell>;
    for (const algorithmId of PUBLISHED_ALGORITHM_IDS) {
      const slice = artifact?.slices.find(
        (candidate) => candidate.algorithmId === algorithmId && candidate.season === season && candidate.compLevelView === compLevelView,
      );
      cells[algorithmId] =
        slice === undefined
          ? ABSENT_CELL
          : {
              hasSlice: true,
              brierScore: slice.brierScore,
              winnerAccuracy: slice.winnerAccuracy,
              scoredCount: slice.scoredCount,
            };
    }
    return { season, cells };
  });
}

/**
 * Display-precision formatting — `compareTie.ts`'s `formatBrierDisplay`/
 * `formatWinnerAccuracyDisplay` are the single home for how a Compare figure
 * is printed (Decision 3), so the Brier near-tie test (defined on the
 * DISPLAYED value) and the digits a reader sees can never disagree. This
 * wrapper only adds the em-dash for a null/absent figure; the underlying
 * published figures stay deliberately unrounded (`docs/models/...`'s
 * established convention) — this is display formatting only, never a second
 * rounding pass.
 */
function formatBrier(value: number | null): string {
  return value === null ? "—" : formatBrierDisplay(value);
}

function formatWinnerAccuracy(value: number | null): string {
  return value === null ? "—" : formatWinnerAccuracyDisplay(value);
}

/**
 * D-11's emphasis for one row — the two leader arrays (Brier lower-is-better,
 * Winner Accuracy higher-is-better), each naming the `PublishedAlgorithmId`s
 * whose cell renders at weight 600 for that metric. Performs NO comparison
 * arithmetic of its own: it maps the row into `compareTie.ts`'s candidate
 * shapes and delegates entirely to `resolveBrierLeaders`/
 * `resolveWinnerAccuracyLeaders`, so D-11's rule has exactly one
 * implementation and `compareTie.test.ts` is the test of record for it. An
 * empty array means no emphasis anywhere for that metric in that row — D-11's
 * near-tie state, rendered as full-ink plain weight on both/all cells, never
 * greyed.
 */
export interface RowEmphasis {
  readonly brierLeaders: readonly PublishedAlgorithmId[];
  readonly winnerAccuracyLeaders: readonly PublishedAlgorithmId[];
}

export function buildRowEmphasis(row: AccuracyRow): RowEmphasis {
  const brierCandidates: BrierCandidate[] = PUBLISHED_ALGORITHM_IDS.map((algorithmId) => ({
    algorithmId,
    value: row.cells[algorithmId].brierScore,
  }));
  const accuracyCandidates: WinnerAccuracyCandidate[] = PUBLISHED_ALGORITHM_IDS.map((algorithmId) => ({
    algorithmId,
    value: row.cells[algorithmId].winnerAccuracy,
    scoredCount: row.cells[algorithmId].scoredCount,
  }));
  return {
    brierLeaders: resolveBrierLeaders(brierCandidates),
    winnerAccuracyLeaders: resolveWinnerAccuracyLeaders(accuracyCandidates),
  };
}

/**
 * Sketch 007 winner A's two-row grouped header (Decision 4): a row-label
 * header spanning two rows, three algorithm-group headers each spanning two
 * columns, each carrying a left border so the group header's span and its
 * two body columns land on the same boundary — including the first group,
 * so no group drifts out of alignment.
 */
function AccuracyTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead rowSpan={2} className="text-role-label align-bottom">
          Year
        </TableHead>
        {PUBLISHED_ALGORITHM_IDS.map((algorithmId) => (
          <TableHead key={algorithmId} colSpan={2} className="text-role-label border-l text-center">
            {algorithmDisplayLabel(algorithmId)}
          </TableHead>
        ))}
      </TableRow>
      <TableRow>
        {PUBLISHED_ALGORITHM_IDS.map((algorithmId) => (
          <Fragment key={algorithmId}>
            <TableHead className="text-role-label border-l">{WINNER_ACCURACY_HEADER_LABEL}</TableHead>
            <TableHead className="text-role-label">{BRIER_HEADER_LABEL}</TableHead>
          </Fragment>
        ))}
      </TableRow>
    </TableHeader>
  );
}

export interface AccuracyTableProps {
  artifactsByYear: ReadonlyMap<number, CompareArtifact>;
  compLevelView: CompareCompLevelView;
}

export function AccuracyTable({ artifactsByYear, compLevelView }: AccuracyTableProps) {
  const rows = buildAccuracyRows(artifactsByYear, compLevelView);

  return (
    <div
      data-testid={COMPARE_ACCURACY_SCROLL_TESTID}
      className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain"
    >
      {/* Raw <table>, NOT shadcn's <Table> (08-15 deferred item, fixed):
          <Table> wraps its own [data-slot="table-container"] overflow-x-auto
          div, which absorbed all horizontal overflow and left this testid'd
          region never overflowing by construction — the one table in the app
          whose *-scroll testid was not the literal scrolling element. The
          row/cell primitives (TableBody/TableRow/...) stay shadcn. */}
      <table data-slot="table" className="w-full caption-bottom text-sm">
        <AccuracyTableHeader />
        <TableBody>
          {rows.map((row) => {
            const emphasis = buildRowEmphasis(row);
            return (
              <TableRow key={row.season}>
                <TableCell className="numeric-cell">{row.season}</TableCell>
                {PUBLISHED_ALGORITHM_IDS.map((algorithmId) => {
                  const cell = row.cells[algorithmId];
                  // Weight ONLY, never colour — D-11's near-tie state is
                  // expressed by WITHHOLDING weight from the leader; a
                  // non-leader cell renders exactly as it did before this
                  // rule existed (same class set, same ink, same opacity).
                  const accuracyIsLeader = emphasis.winnerAccuracyLeaders.includes(algorithmId);
                  const brierIsLeader = emphasis.brierLeaders.includes(algorithmId);
                  return (
                    <Fragment key={algorithmId}>
                      <TableCell className={cn("numeric-cell border-l", accuracyIsLeader && "font-semibold")}>
                        {formatWinnerAccuracy(cell.winnerAccuracy)}
                      </TableCell>
                      <TableCell className={cn("numeric-cell", brierIsLeader && "font-semibold")}>
                        {formatBrier(cell.brierScore)}
                      </TableCell>
                    </Fragment>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </table>
    </div>
  );
}

/**
 * The pending state's placeholder: the real two-row header (so the pending
 * and populated states share an identical footprint) above `SkeletonRows`
 * sized for five rows and seven columns — never a spinner, never headerless.
 */
export function AccuracyTableSkeleton() {
  return (
    <div
      data-testid={COMPARE_ACCURACY_SCROLL_TESTID}
      className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain"
    >
      <table data-slot="table" className="w-full caption-bottom text-sm">
        <AccuracyTableHeader />
        <TableBody>
          <SkeletonRows rows={ACCURACY_TABLE_ROW_COUNT} columns={ACCURACY_TABLE_COLUMN_COUNT} />
        </TableBody>
      </table>
    </div>
  );
}
