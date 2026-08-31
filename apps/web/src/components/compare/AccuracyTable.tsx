import { Fragment } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SkeletonRows } from "@/components/Skeletons";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import { COMPARE_SEASONS, type CompareCompLevelView } from "../../lib/api/compare.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The COMP-01 accuracy table (08-01-PLAN.md Task 2), complete to its D-08
 * contract: one uniform table, five ascending season rows against three
 * `PUBLISHED_ALGORITHM_IDS`-ordered algorithm column-groups, sketch 007's
 * winning structure, plain-weight figures, no tune/holdout tiering
 * anywhere. D-11's near-tie bolding rule is 08-06's job, not this plan's —
 * every cell here renders at the SAME plain weight, deliberately.
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
}

export interface AccuracyRow {
  readonly season: number;
  readonly cells: Readonly<Record<PublishedAlgorithmId, AccuracyCell>>;
}

const ABSENT_CELL: AccuracyCell = { hasSlice: false, brierScore: null, winnerAccuracy: null };

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
          : { hasSlice: true, brierScore: slice.brierScore, winnerAccuracy: slice.winnerAccuracy };
    }
    return { season, cells };
  });
}

/**
 * Display-precision restoration of what JSON serialization dropped — the
 * published figures are deliberately unrounded (`docs/models/...`'s
 * established convention), and this is the only place a decimal count is
 * chosen. Never a second rounding pass over an already-published figure.
 */
function formatBrier(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

function formatWinnerAccuracy(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
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
      <Table>
        <AccuracyTableHeader />
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.season}>
              <TableCell className="numeric-cell">{row.season}</TableCell>
              {PUBLISHED_ALGORITHM_IDS.map((algorithmId) => {
                const cell = row.cells[algorithmId];
                return (
                  <Fragment key={algorithmId}>
                    <TableCell className="numeric-cell border-l">{formatWinnerAccuracy(cell.winnerAccuracy)}</TableCell>
                    <TableCell className="numeric-cell">{formatBrier(cell.brierScore)}</TableCell>
                  </Fragment>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
      <Table>
        <AccuracyTableHeader />
        <TableBody>
          <SkeletonRows rows={ACCURACY_TABLE_ROW_COUNT} columns={ACCURACY_TABLE_COLUMN_COUNT} />
        </TableBody>
      </Table>
    </div>
  );
}
