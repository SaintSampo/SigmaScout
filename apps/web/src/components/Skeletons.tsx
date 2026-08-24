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
