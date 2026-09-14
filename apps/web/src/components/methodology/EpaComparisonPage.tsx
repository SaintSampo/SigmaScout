import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EPA_CARD_SIGMASCOUT_LABEL,
  EPA_CARD_STATBOTICS_LABEL,
  EPA_COMPARISON_LEAD,
  EPA_DIFFERENCE_CARDS,
  EPA_DIFFERENCE_SECTION_HEADING,
  EPA_HEAD_TO_HEAD_INTRO,
  EPA_HEAD_TO_HEAD_SECTION_HEADING,
  EPA_SAME_ITEMS,
  EPA_SAME_SECTION_HEADING,
  headToHeadSummarySentence,
  statboticsPulledSentence,
  type EpaDifferenceCardId,
} from "./epaComparisonContent.js";
import type { EpaComparisonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * The `/methodology/epa-vs-statbotics` page body. The route owns the
 * single query; this file never fetches. Static prose (the lead, the
 * shared list, every difference card) renders from first paint, including
 * while the artifact is pending, on a 404, and on a fetch error — only the
 * `results` slot waits on the artifact, filled in by the route with the
 * appropriate branch.
 *
 * `.event-card` is this app's shared card treatment, reused from
 * `MethodologyCards.tsx` and `CalibrationSection.tsx`. The head-to-head
 * table markup mirrors `apps/web/src/components/compare/AccuracyTable.tsx`'s
 * classes rather than inventing a new table treatment.
 *
 * The published artifact's `agreement` array is intentionally unused here —
 * this page dropped the per-season agreement table (OLS slope, Pearson
 * correlation, mean absolute difference) by a locked decision; the schema
 * still requires the field so the artifact and its writer are untouched.
 */

const SAME_LIST_TESTID = "epa-comparison-same-list";
const DIFFERENCE_CARDS_TESTID = "epa-comparison-difference-cards";
const HEAD_TO_HEAD_TABLE_TESTID = "epa-comparison-head-to-head-table";
const HEAD_TO_HEAD_SUMMARY_TESTID = "epa-comparison-head-to-head-summary";
const PROVENANCE_TESTID = "epa-comparison-provenance";
const STATBOTICS_PULLED_TESTID = "epa-comparison-statbotics-pulled";

export function epaDifferenceCardTestId(id: EpaDifferenceCardId): string {
  return `epa-difference-card-${id}`;
}

/** Renders to four decimals, matching `AccuracyTable.tsx`'s null-formatter convention: an empty string, never a dash glyph, so no dash character can reach the DOM from a missing value. */
function formatFourDecimals(value: number | null): string {
  return value === null ? "" : value.toFixed(4);
}

export interface EpaComparisonPageProps {
  readonly results: ReactNode;
}

export function EpaComparisonPage({ results }: EpaComparisonPageProps) {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{EPA_COMPARISON_LEAD}</p>

      <section id="same-on-both-sites" className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">{EPA_SAME_SECTION_HEADING}</h2>
        <ul
          data-testid={SAME_LIST_TESTID}
          className="flex max-w-[72ch] list-disc flex-col gap-[var(--spacing-xs)] pl-[var(--spacing-lg)]"
        >
          {EPA_SAME_ITEMS.map((item) => (
            <li key={item.id} className="text-role-body text-[var(--color-text-primary)]">
              {item.text}
            </li>
          ))}
        </ul>
      </section>

      <section id="where-they-differ" className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">{EPA_DIFFERENCE_SECTION_HEADING}</h2>
        <div data-testid={DIFFERENCE_CARDS_TESTID} className="flex flex-col gap-[var(--spacing-md)]">
          {EPA_DIFFERENCE_CARDS.map((card) => (
            <article
              key={card.id}
              data-testid={epaDifferenceCardTestId(card.id)}
              className="event-card flex min-w-0 flex-col gap-[var(--spacing-sm)] p-[var(--spacing-md)] shadow-sm"
            >
              <h3 className="text-role-body font-semibold text-[var(--color-text-primary)]">{card.title}</h3>
              <dl className="grid gap-[var(--spacing-sm)] md:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-[var(--spacing-xs)]">
                  <dt className="text-role-label text-[var(--color-text-muted)]">{EPA_CARD_STATBOTICS_LABEL}</dt>
                  <dd className="text-role-body text-[var(--color-text-primary)]">{card.statbotics}</dd>
                </div>
                <div className="flex min-w-0 flex-col gap-[var(--spacing-xs)]">
                  <dt className="text-role-label text-[var(--color-text-muted)]">{EPA_CARD_SIGMASCOUT_LABEL}</dt>
                  <dd className="text-role-body text-[var(--color-text-primary)]">{card.sigmascout}</dd>
                </div>
                {card.notes.map((note) => (
                  <div
                    key={note.label}
                    className="flex min-w-0 flex-col gap-[var(--spacing-xs)] md:col-span-2 border-t border-[var(--color-border)] pt-[var(--spacing-sm)]"
                  >
                    <dt className="text-role-label text-[var(--color-text-muted)]">{note.label}</dt>
                    <dd className="text-role-body text-[var(--color-text-primary)]">{note.text}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section id="how-much-it-matters" className="flex flex-col gap-[var(--spacing-sm)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">{EPA_HEAD_TO_HEAD_SECTION_HEADING}</h2>
        <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{EPA_HEAD_TO_HEAD_INTRO}</p>
        {results}
      </section>
    </div>
  );
}

export interface EpaHeadToHeadResultsProps {
  readonly artifact: EpaComparisonArtifact;
}

export function EpaHeadToHeadResults({ artifact }: EpaHeadToHeadResultsProps) {
  const headToHeadRows = artifact.headToHead.slice().sort((a, b) => a.season - b.season);
  const comparableRows = headToHeadRows.filter((row) => row.ourWinnerAccuracy !== null);
  const statboticsAheadCount = comparableRows.filter(
    (row) => row.statboticsWinnerAccuracy > (row.ourWinnerAccuracy as number),
  ).length;
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
      <p data-testid={HEAD_TO_HEAD_SUMMARY_TESTID} className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
        {headToHeadSummarySentence(statboticsAheadCount, comparableRows.length)}
      </p>
      <div data-testid={PROVENANCE_TESTID} className="text-role-body text-[var(--color-text-muted)]">
        Measured under EPA {artifact.epaVersion} on {artifact.measuredAt.slice(0, 10)}.
      </div>
    </>
  );
}

/**
 * The pending branch's placeholder for the results slot only — the lead, the
 * shared list and every difference card are static prose supplied by
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
  SAME_LIST_TESTID as EPA_COMPARISON_SAME_LIST_TESTID,
  DIFFERENCE_CARDS_TESTID as EPA_COMPARISON_DIFFERENCE_CARDS_TESTID,
  HEAD_TO_HEAD_TABLE_TESTID as EPA_COMPARISON_HEAD_TO_HEAD_TABLE_TESTID,
  HEAD_TO_HEAD_SUMMARY_TESTID as EPA_COMPARISON_HEAD_TO_HEAD_SUMMARY_TESTID,
  PROVENANCE_TESTID as EPA_COMPARISON_PROVENANCE_TESTID,
  STATBOTICS_PULLED_TESTID as EPA_COMPARISON_STATBOTICS_PULLED_TESTID,
};
