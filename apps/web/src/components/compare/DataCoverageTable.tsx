/**
 * The Compare page's Data coverage per year section (08-12-PLAN.md Task 2) —
 * the last section on the page, discharging D-09's "surfaces everything the
 * artifact carries" obligation for the eight coverage fields nothing else on
 * the page renders: `candidateCount`, `scoredCount`, all four
 * `exclusionCounts` members, `tieCount` and `noCallCount`.
 *
 * Mirrors `AccuracyTable.tsx`'s established idiom in this same directory: a
 * two-row grouped header with left borders marking each group's boundary
 * (including the first), a BLANK cell for an absent value (2026-09-01: no
 * em-dash placeholders anywhere), a named `*Skeleton`
 * sibling sharing the real header so pending and populated states share a
 * footprint, and one scroll region carrying the app's established
 * `min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain` set.
 *
 * `noCallCount` is the one coverage field that varies by algorithm (measured
 * 15 of 15 published (season, compLevelView) groups, `coverageRows.ts`'s own
 * doc comment) — it renders as its own three-column `No-calls by algorithm`
 * group, in `PUBLISHED_ALGORITHM_IDS` order, never collapsed. The other seven
 * fields render as one shared column each, printed as a single number when
 * the three algorithms agree and as all three labelled values when they do
 * not (`SharedCount`'s `disagreed` branch — an empirical property of today's
 * data, not a schema guarantee, per `coverageRows.ts`).
 *
 * Declares NO state of any kind: `compLevelView` arrives as a prop from
 * 08-06's single page-level state — the accuracy table's and 08-10's
 * calibration section's third consumer.
 */
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SkeletonRows } from "@/components/Skeletons";
import { algorithmDisplayLabel } from "../ribbon/AlgorithmSelect.js";
import { PUBLISHED_ALGORITHM_IDS, type PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { buildCoverageRows, COVERAGE_EXCLUSION_COLUMNS, type SharedCount } from "./coverageRows.js";
import type { CompareCompLevelView } from "../../lib/api/compare.js";
import type { CompareArtifact } from "../../../../../packages/harness/pageArtifacts.js";

export const DATA_COVERAGE_SECTION_TESTID = "compare-data-coverage-section";
export const DATA_COVERAGE_SCROLL_TESTID = "compare-data-coverage-scroll";
export const DATA_COVERAGE_EXPLAINER_TESTID = "compare-data-coverage-explainer-d09";

/** The Copywriting Contract's exact heading string. */
export const DATA_COVERAGE_HEADING = "Data coverage per year";

/**
 * The Copywriting Contract's data-coverage explainer row, rewritten
 * 2026-09-01 to carry no em-dash (user directive), otherwise verbatim and
 * still carrying D-09's binding offseason distinction. Not otherwise reworded,
 * not split, and the second sentence below is NOT folded into it (Decision
 * 4): it is checker-approved copy this plan does not own.
 */
export const DATA_COVERAGE_EXPLAINER_D09 =
  "Offseason matches feed each algorithm's predictions but are excluded from the accuracy scores above; the numbers reflect only official-season matches with a recorded winner.";

/**
 * The authored second paragraph (Decision 4): the partition claim guarded by
 * `coverageRows.test.ts`'s fixture-based identity guard, the ties/no-calls
 * placement, and the non-additive overlap that is this plan's own reason for
 * never rendering a derived denominator.
 */
export const DATA_COVERAGE_EXPLAINER_STRUCTURE =
  "Scored matches plus the four excluded columns account for every candidate match. Ties and no-calls are counted inside the scored matches, not excluded from them: a tie has no winner to have predicted, and a no-call is a prediction of exactly fifty percent either way, so both are still scored for Brier even though neither counts toward winner accuracy. A single match can be both a tie and a no-call, so the Ties and No-calls columns do not add together.";

const COVERAGE_TABLE_ROW_COUNT = 5;
/** Year + Candidate matches + Scored matches + 4 exclusion columns + Ties + 3 no-call columns = 11 (Flagged Planner Assumption 2 — three more than UI-SPEC's original 8-column sketch, per Decision 1). */
export const COVERAGE_LEAF_COLUMN_COUNT = 3 + COVERAGE_EXCLUSION_COLUMNS.length + 1 + PUBLISHED_ALGORITHM_IDS.length;

/** A stable per-(season, column) test id. `columnKey` is one of `"candidateCount"`, `"scoredCount"`, `"tieCount"`, a `CoverageExclusionKey`, or `"noCall:{algorithmId}"`. */
export function coverageCellTestId(season: number, columnKey: string): string {
  return `data-coverage-cell-${season}-${columnKey}`;
}

/**
 * Maps one `SharedCount` to its rendered text: `agreed` prints the value as
 * bare digits, INCLUDING zero; `absent` prints a BLANK cell; and
 * `disagreed` prints every algorithm's own label and value. These two
 * branches (agreed-zero vs absent) are the single behaviour most likely to
 * be collapsed by a later contributor who reads a zero as an empty; two of
 * the four exclusion columns are zero in every slice this site publishes
 * today, so the wrong branch here is what the table would show most of the
 * time.
 */
function renderSharedCount(cell: SharedCount): string {
  if (cell.kind === "absent") return "";
  if (cell.kind === "agreed") return String(cell.value);
  return cell.values.map((entry) => `${algorithmDisplayLabel(entry.algorithmId)} ${entry.value}`).join(", ");
}

function renderNoCall(count: number | undefined): string {
  return count === undefined ? "" : String(count);
}

/**
 * Sketch 007/`AccuracyTable.tsx`'s two-row grouped header, extended to a
 * third group: a row-label-adjacent pair of standalone columns (Candidate
 * matches, Scored matches), the four-column `Excluded from scoring` group, a
 * standalone `Ties` column, and the three-column `No-calls by algorithm`
 * group — each group carrying a left border on both its group header and its
 * first leaf column so the two land on the same boundary.
 */
function DataCoverageTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead rowSpan={2} className="text-role-label align-bottom">
          Year
        </TableHead>
        <TableHead rowSpan={2} className="text-role-label align-bottom">
          Candidate matches
        </TableHead>
        <TableHead rowSpan={2} className="text-role-label align-bottom">
          Scored matches
        </TableHead>
        <TableHead colSpan={COVERAGE_EXCLUSION_COLUMNS.length} className="text-role-label border-l text-center">
          Excluded from scoring
        </TableHead>
        <TableHead rowSpan={2} className="text-role-label border-l align-bottom">
          Ties
        </TableHead>
        <TableHead colSpan={PUBLISHED_ALGORITHM_IDS.length} className="text-role-label border-l text-center">
          No-calls by algorithm
        </TableHead>
      </TableRow>
      <TableRow>
        {COVERAGE_EXCLUSION_COLUMNS.map((column, index) => (
          <TableHead key={column.key} className={cn("text-role-label", index === 0 && "border-l")}>
            {column.label}
          </TableHead>
        ))}
        {PUBLISHED_ALGORITHM_IDS.map((algorithmId, index) => (
          <TableHead key={algorithmId} className={cn("text-role-label", index === 0 && "border-l")}>
            {algorithmDisplayLabel(algorithmId)}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

export interface DataCoverageTableProps {
  readonly artifactsByYear: ReadonlyMap<number, CompareArtifact>;
  readonly compLevelView: CompareCompLevelView;
}

/**
 * The table alone — `buildCoverageRows`' output mapped to cells and nothing
 * else. Performs no selection and no arithmetic of its own: `coverageRows.ts`
 * is the test of record for what the numbers are.
 */
export function DataCoverageTable({ artifactsByYear, compLevelView }: DataCoverageTableProps) {
  const rows = buildCoverageRows(artifactsByYear, compLevelView);

  return (
    <div data-testid={DATA_COVERAGE_SCROLL_TESTID} className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
      <Table className="zebra-rows w-auto">
        <DataCoverageTableHeader />
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.season}>
              <TableCell className="numeric-cell">{row.season}</TableCell>
              <TableCell data-testid={coverageCellTestId(row.season, "candidateCount")} className="numeric-cell">
                {renderSharedCount(row.candidateCount)}
              </TableCell>
              <TableCell data-testid={coverageCellTestId(row.season, "scoredCount")} className="numeric-cell">
                {renderSharedCount(row.scoredCount)}
              </TableCell>
              {COVERAGE_EXCLUSION_COLUMNS.map((column, index) => (
                <TableCell
                  key={column.key}
                  data-testid={coverageCellTestId(row.season, column.key)}
                  className={cn("numeric-cell", index === 0 && "border-l")}
                >
                  {renderSharedCount(row.exclusionCounts[column.key])}
                </TableCell>
              ))}
              <TableCell data-testid={coverageCellTestId(row.season, "tieCount")} className="numeric-cell border-l">
                {renderSharedCount(row.tieCount)}
              </TableCell>
              {row.noCalls.map((entry: { algorithmId: PublishedAlgorithmId; count: number | undefined }, index: number) => (
                <TableCell
                  key={entry.algorithmId}
                  data-testid={coverageCellTestId(row.season, `noCall:${entry.algorithmId}`)}
                  className={cn("numeric-cell", index === 0 && "border-l")}
                >
                  {renderNoCall(entry.count)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export interface DataCoverageSectionProps {
  readonly artifactsByYear: ReadonlyMap<number, CompareArtifact>;
  readonly compLevelView: CompareCompLevelView;
}

/**
 * The section: heading, D-09's contract explainer, the authored structural
 * explainer, then the table. Both paragraphs are always visible — never a
 * tooltip, never behind a disclosure toggle.
 */
export function DataCoverageSection({ artifactsByYear, compLevelView }: DataCoverageSectionProps) {
  return (
    <div data-testid={DATA_COVERAGE_SECTION_TESTID} className="mt-[var(--spacing-xl)]">
      <h2 className="text-role-heading">{DATA_COVERAGE_HEADING}</h2>
      <p data-testid={DATA_COVERAGE_EXPLAINER_TESTID} className="mt-[var(--spacing-xs)] text-role-body text-[var(--color-text-muted)]">
        {DATA_COVERAGE_EXPLAINER_D09}
      </p>
      <p className="mt-[var(--spacing-xs)] text-role-body text-[var(--color-text-muted)]">{DATA_COVERAGE_EXPLAINER_STRUCTURE}</p>
      <div className="mt-[var(--spacing-md)]">
        <DataCoverageTable artifactsByYear={artifactsByYear} compLevelView={compLevelView} />
      </div>
    </div>
  );
}

/**
 * The pending state's placeholder: the real heading and the real two-row
 * header (so pending and populated states share an identical footprint)
 * above `SkeletonRows` sized for five rows and eleven columns — never a
 * spinner, never headerless. Shares `DATA_COVERAGE_SECTION_TESTID` and
 * `DATA_COVERAGE_SCROLL_TESTID` with the populated section, mirroring
 * `AccuracyTableSkeleton`'s identical precedent in this same directory.
 */
export function DataCoverageSectionSkeleton() {
  return (
    <div data-testid={DATA_COVERAGE_SECTION_TESTID} className="mt-[var(--spacing-xl)]">
      <h2 className="text-role-heading">{DATA_COVERAGE_HEADING}</h2>
      <div data-testid={DATA_COVERAGE_SCROLL_TESTID} className="mt-[var(--spacing-md)] min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <Table className="zebra-rows w-auto">
          <DataCoverageTableHeader />
          <TableBody>
            <SkeletonRows rows={COVERAGE_TABLE_ROW_COUNT} columns={COVERAGE_LEAF_COLUMN_COUNT} />
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
