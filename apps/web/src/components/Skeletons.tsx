import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

/**
 * The D-16 first-load state: header, ribbon and column headers render
 * immediately from the shell while the artifact downloads — only the body
 * rows are placeholders. `SkeletonRows` renders just that placeholder body,
 * meant to be dropped inside a `<TableBody>` the caller's own column headers
 * already sit above (05-03-PLAN.md Task 2).
 *
 * Both the Teams table and the Events list (wave 4) consume this, which is
 * why it takes a row and column count rather than hard-coding either — the
 * two surfaces have different column sets and row-count guesses.
 */
export function SkeletonRows({ rows, columns }: { rows: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <TableRow key={rowIndex}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <TableCell key={columnIndex}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * The team page's pending-state header block (06-01-PLAN.md Task 3, joining
 * the `Skeletons.tsx` family) — a name/number placeholder plus a square
 * block standing in for the robot image (D-03, wired by plan 06-07). Shown
 * instead of a single full-page spinner (06-UI-SPEC.md E1 loading).
 */
export function TeamHeaderSkeleton() {
  return (
    <div className="flex items-center gap-[var(--spacing-md)]">
      <Skeleton className="h-16 w-16 shrink-0 rounded-[var(--radius)]" />
      <div className="flex flex-1 flex-col gap-[var(--spacing-sm)]">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

/**
 * One event-section-shaped skeleton card (06-01-PLAN.md Task 3) — a header
 * bar plus a few skeleton rows, joining `SkeletonRows`' family. The route
 * renders 2-3 of these during the pending state (06-UI-SPEC.md E5 loading)
 * so the page's overall shape is visible immediately rather than a single
 * spinner.
 */
export function EventSectionSkeleton() {
  return (
    <div data-testid="event-section-skeleton" className="flex flex-col gap-[var(--spacing-sm)]">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}
