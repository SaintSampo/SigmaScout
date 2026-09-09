import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EPA_AGREEMENT_BLOCK_INTRO,
  EPA_COMPARISON_LEAD,
  EPA_DIFFERENCE_ENTRIES,
  EPA_HEAD_TO_HEAD_BLOCK_INTRO,
  headToHeadSummarySentence,
} from "./epaComparisonContent.js";
import type { EpaComparisonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The `/methodology/epa-vs-statbotics` page body (quick task 260908-n5o
 * Task 3; revised same day after reviewing the shipped page). Takes the
 * already-parsed artifact as a PROP — never fetches, never declares its own
 * query — matching `AcknowledgmentsPage.tsx`'s own "content component takes
 * data, route owns the query" split.
 *
 * Revision: the "offseason matches in versus out" A/B section is REMOVED.
 * It compared the same quantity (`minMatchesFiltered`, season-final,
 * offseason-inclusive) that the agreement table itself used to compare —
 * a number nobody is shown anywhere on this site. `artifact.agreement` now
 * carries one row per season, each measured against a team's rating as of
 * its own last official match (the number the Teams list and a team page's
 * header actually show), so there is no second arm left to pair.
 *
 * Every number rendered here comes from `artifact` — no slope, correlation,
 * mean absolute difference, accuracy or Brier value is a literal anywhere in
 * this file (this task's own must_haves). Mirrors
 * `apps/web/src/components/compare/AccuracyTable.tsx`'s table markup and
 * classes rather than inventing a new table treatment.
 */

const AGREEMENT_TABLE_TESTID = "epa-comparison-agreement-table";
const HEAD_TO_HEAD_TABLE_TESTID = "epa-comparison-head-to-head-table";
const HEAD_TO_HEAD_SUMMARY_TESTID = "epa-comparison-head-to-head-summary";
const PROVENANCE_TESTID = "epa-comparison-provenance";

function formatSlopeOrCorrelation(value: number): string {
  return value.toFixed(3);
}

function formatMeanAbsoluteDifference(value: number): string {
  return `${value.toFixed(2)} pts`;
}

/** Accuracy and Brier both render to four decimals, per this page's own numeric-precision rule — never the percentage form `AccuracyTable.tsx`'s Compare page uses, since that page's own precision rule is a separate decision for a separate page. */
function formatFourDecimals(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

export interface EpaComparisonPageProps {
  readonly artifact: EpaComparisonArtifact;
}

export function EpaComparisonPage({ artifact }: EpaComparisonPageProps) {
  const agreementRows = artifact.agreement.slice().sort((a, b) => a.season - b.season);

  const headToHeadRows = artifact.headToHead.slice().sort((a, b) => a.season - b.season);
  const comparableRows = headToHeadRows.filter((row) => row.ourWinnerAccuracy !== null);
  const statboticsAheadCount = comparableRows.filter(
    (row) => row.statboticsWinnerAccuracy > (row.ourWinnerAccuracy as number)
  ).length;

  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{EPA_COMPARISON_LEAD}</p>

      {EPA_DIFFERENCE_ENTRIES.map((entry) => (
        <section key={entry.id} className="flex flex-col gap-[var(--spacing-xs)]">
          <h2 className="text-role-heading text-[var(--color-text-primary)]">{entry.heading}</h2>
          {entry.paragraphs.map((paragraph, index) => (
            <p key={index} className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      <div data-testid={PROVENANCE_TESTID} className="text-role-body text-[var(--color-text-muted)]">
        Measured under EPA {artifact.epaVersion} on {artifact.measuredAt.slice(0, 10)}.
      </div>

      <section className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">Per-season agreement</h2>
        <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{EPA_AGREEMENT_BLOCK_INTRO}</p>
        <div data-testid={AGREEMENT_TABLE_TESTID} className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
          <table data-slot="table" className="zebra-rows w-auto caption-bottom text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="text-role-label">Season</TableHead>
                <TableHead className="text-role-label numeric-cell">Teams compared</TableHead>
                <TableHead className="text-role-label numeric-cell">OLS slope</TableHead>
                <TableHead className="text-role-label numeric-cell">Pearson correlation</TableHead>
                <TableHead className="text-role-label numeric-cell">Mean absolute difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agreementRows.map((row) => (
                <TableRow key={row.season}>
                  <TableCell className="numeric-cell">{row.season}</TableCell>
                  <TableCell className="numeric-cell">{row.joinedCount}</TableCell>
                  <TableCell className="numeric-cell">{formatSlopeOrCorrelation(row.ordinaryLeastSquaresSlope)}</TableCell>
                  <TableCell className="numeric-cell">{formatSlopeOrCorrelation(row.pearson)}</TableCell>
                  <TableCell className="numeric-cell">{formatMeanAbsoluteDifference(row.meanAbsoluteDifference)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">Head-to-head accuracy</h2>
        <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{EPA_HEAD_TO_HEAD_BLOCK_INTRO}</p>
        <div data-testid={HEAD_TO_HEAD_TABLE_TESTID} className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
          <table data-slot="table" className="zebra-rows w-auto caption-bottom text-sm">
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2} className="text-role-label align-bottom">
                  Season
                </TableHead>
                <TableHead colSpan={2} className="text-role-label border-l text-center">
                  SigmaScout EPA
                </TableHead>
                <TableHead colSpan={2} className="text-role-label border-l text-center">
                  Statbotics EPA
                </TableHead>
              </TableRow>
              <TableRow>
                <TableHead className="text-role-label border-l">Winner accuracy</TableHead>
                <TableHead className="text-role-label">Brier score</TableHead>
                <TableHead className="text-role-label border-l">Winner accuracy</TableHead>
                <TableHead className="text-role-label">Brier score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {headToHeadRows.map((row) => (
                <TableRow key={row.season}>
                  <TableCell className="numeric-cell">{row.season}</TableCell>
                  <TableCell className="numeric-cell border-l">{formatFourDecimals(row.ourWinnerAccuracy)}</TableCell>
                  <TableCell className="numeric-cell">{formatFourDecimals(row.ourBrierScore)}</TableCell>
                  <TableCell className="numeric-cell border-l">
                    {formatFourDecimals(row.statboticsWinnerAccuracy)}
                    {!row.statboticsFetched && <span className="text-[var(--color-text-muted)]"> (dated)</span>}
                  </TableCell>
                  <TableCell className="numeric-cell">
                    {formatFourDecimals(row.statboticsBrierScore)}
                    {!row.statboticsFetched && <span className="text-[var(--color-text-muted)]"> (dated)</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
        <p data-testid={HEAD_TO_HEAD_SUMMARY_TESTID} className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
          {headToHeadSummarySentence(statboticsAheadCount, comparableRows.length)}
        </p>
      </section>
    </div>
  );
}

/**
 * The pending branch's shape-preserving placeholder: the lead paragraph and
 * the difference headings are text-only chrome, so they render for real
 * even while the artifact is in flight (the same "gate content, never the
 * element's own existence" rule the rest of this app follows) — only the
 * two data-bearing sections below get a skeleton in their place.
 */
export function EpaComparisonPageSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--spacing-md)]">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export {
  AGREEMENT_TABLE_TESTID as EPA_COMPARISON_AGREEMENT_TABLE_TESTID,
  HEAD_TO_HEAD_TABLE_TESTID as EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID,
  HEAD_TO_HEAD_SUMMARY_TESTID as EPA_COMPARISON_HEAD_TO_HEAD_SUMMARY_TESTID,
  PROVENANCE_TESTID as EPA_COMPARISON_PROVENANCE_TESTID,
};
