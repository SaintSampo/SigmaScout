import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EPA_COMPARISON_LEAD,
  EPA_DIFFERENCE_NOTE_LABEL,
  EPA_DIFFERENCE_ROWS,
  EPA_DIFFERENCE_SECTION_HEADING,
  EPA_DIFFERENCE_SIGMASCOUT_LABEL,
  EPA_DIFFERENCE_STATBOTICS_LABEL,
  EPA_HEAD_TO_HEAD_INTRO,
  EPA_HEAD_TO_HEAD_SECTION_HEADING,
  EPA_SAME_PARAGRAPH,
  EPA_SAME_SECTION_HEADING,
  sigmascoutMeasuredSentence,
  statboticsPulledSentence,
  type EpaDifferenceRowId,
} from "./epaComparisonContent.js";
import type { EpaComparisonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The `/methodology/epa-vs-statbotics` page body. The route owns the
 * single query; this file never fetches. Static prose (the lead, the
 * shared paragraph, the difference table) renders from first paint, including
 * while the artifact is pending, on a 404, and on a fetch error — only the
 * `results` slot waits on the artifact, filled in by the route with the
 * appropriate branch.
 *
 * Section order is results first (sketch 016, Jacob's pick): "How much it
 * matters", then "Same on both sites", then "Where they differ".
 *
 * Both tables mirror `apps/web/src/components/compare/AccuracyTable.tsx`'s
 * classes rather than inventing a new table treatment. The difference table's
 * cells are sentences, so they wrap (`whitespace-normal`) and carry a minimum
 * width; on a phone the table scrolls sideways inside its own container.
 *
 * The published artifact's `agreement` array is intentionally unused here —
 * this page dropped the per-season agreement table (OLS slope, Pearson
 * correlation, mean absolute difference) by a locked decision; the schema
 * still requires the field so the artifact and its writer are untouched.
 */

const SAME_PARAGRAPH_TESTID = "epa-comparison-same-paragraph";
const DIFFERENCE_TABLE_TESTID = "epa-comparison-difference-table";
const HEAD_TO_HEAD_TABLE_TESTID = "epa-comparison-head-to-head-table";
const PROVENANCE_TESTID = "epa-comparison-provenance";
const STATBOTICS_PULLED_TESTID = "epa-comparison-statbotics-pulled";

export function epaDifferenceRowTestId(id: EpaDifferenceRowId): string {
  return `epa-difference-row-${id}`;
}

/** Renders to four decimals, matching `AccuracyTable.tsx`'s null-formatter convention: an empty string, never a dash glyph, so no dash character can reach the DOM from a missing value. */
function formatFourDecimals(value: number | null): string {
  return value === null ? "" : value.toFixed(4);
}

const PROSE_CELL_CLASS = "min-w-[11rem] whitespace-normal align-top text-role-body text-[var(--color-text-primary)]";

export interface EpaComparisonPageProps {
  readonly results: ReactNode;
}

export function EpaComparisonPage({ results }: EpaComparisonPageProps) {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{EPA_COMPARISON_LEAD}</p>

      <section id="how-much-it-matters" className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">{EPA_HEAD_TO_HEAD_SECTION_HEADING}</h2>
        <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{EPA_HEAD_TO_HEAD_INTRO}</p>
        {results}
      </section>

      <section id="same-on-both-sites" className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">{EPA_SAME_SECTION_HEADING}</h2>
        <p data-testid={SAME_PARAGRAPH_TESTID} className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
          {EPA_SAME_PARAGRAPH}
        </p>
      </section>

      <section id="where-they-differ" className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">{EPA_DIFFERENCE_SECTION_HEADING}</h2>
        <div data-testid={DIFFERENCE_TABLE_TESTID} className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
          <table data-slot="table" className="zebra-rows w-auto caption-bottom text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="text-role-label">
                  <span className="sr-only">Topic</span>
                </TableHead>
                <TableHead className="text-role-label">{EPA_DIFFERENCE_STATBOTICS_LABEL}</TableHead>
                <TableHead className="text-role-label">{EPA_DIFFERENCE_SIGMASCOUT_LABEL}</TableHead>
                <TableHead className="text-role-label">{EPA_DIFFERENCE_NOTE_LABEL}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EPA_DIFFERENCE_ROWS.map((row) => (
                <TableRow key={row.id} data-testid={epaDifferenceRowTestId(row.id)}>
                  <th scope="row" className="p-2 text-left align-top text-role-body font-semibold whitespace-nowrap text-[var(--color-text-primary)]">
                    {row.topic}
                  </th>
                  <TableCell className={PROSE_CELL_CLASS}>{row.statbotics}</TableCell>
                  <TableCell className={PROSE_CELL_CLASS}>{row.sigmascout}</TableCell>
                  <TableCell className={PROSE_CELL_CLASS}>{row.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      </section>
    </div>
  );
}

export interface EpaHeadToHeadResultsProps {
  readonly artifact: EpaComparisonArtifact;
}

export function EpaHeadToHeadResults({ artifact }: EpaHeadToHeadResultsProps) {
  const headToHeadRows = artifact.headToHead.slice().sort((a, b) => a.season - b.season);
  const pulledSentence = statboticsPulledSentence(headToHeadRows.map((row) => row.statboticsCapturedAt));

  return (
    <>
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
                <TableCell className="numeric-cell border-l">{formatFourDecimals(row.statboticsWinnerAccuracy)}</TableCell>
                <TableCell className="numeric-cell">{formatFourDecimals(row.statboticsBrierScore)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
      {pulledSentence !== "" && (
        <p data-testid={STATBOTICS_PULLED_TESTID} className="max-w-[72ch] text-role-body text-[var(--color-text-muted)]">
          {pulledSentence}
        </p>
      )}
      <div data-testid={PROVENANCE_TESTID} className="text-role-body text-[var(--color-text-muted)]">
        {sigmascoutMeasuredSentence(artifact.epaVersion, artifact.measuredAt)}
      </div>
    </>
  );
}

/**
 * The pending branch's placeholder for the results slot only — the lead, the
 * shared paragraph and the difference table are static prose supplied by
 * `EpaComparisonPage` itself and render regardless of query state.
 */
export function EpaHeadToHeadSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--spacing-sm)]">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-5 w-2/3" />
    </div>
  );
}

export {
  SAME_PARAGRAPH_TESTID as EPA_COMPARISON_SAME_PARAGRAPH_TESTID,
  DIFFERENCE_TABLE_TESTID as EPA_COMPARISON_DIFFERENCE_TABLE_TESTID,
  HEAD_TO_HEAD_TABLE_TESTID as EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID,
  PROVENANCE_TESTID as EPA_COMPARISON_PROVENANCE_TESTID,
  STATBOTICS_PULLED_TESTID as EPA_COMPARISON_STATBOTICS_PULLED_TESTID,
};
