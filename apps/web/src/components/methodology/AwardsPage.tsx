import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AWARDS_LEAD, AWARDS_SECTIONS, type AwardsTable } from "./awardsContent.js";

const PARAGRAPH_CLASS = "max-w-[72ch] text-role-body text-[var(--color-text-primary)]";

/**
 * One small results table. Same wrapper and table classes as
 * `EpaComparisonPage.tsx`'s head to head table, so the two methodology tables
 * read as one system. The first column is always a label; a later cell that
 * carries a figure gets `numeric-cell`, and a prose cell is left to wrap.
 */
function AwardsTableBlock({ table }: { table: AwardsTable }) {
  return (
    <div className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
      <table data-slot="table" className="zebra-rows w-auto caption-top text-sm">
        {table.caption !== undefined && (
          <caption className="pb-1 text-left text-role-label text-[var(--color-text-muted)]">{table.caption}</caption>
        )}
        <TableHeader>
          <TableRow>
            {table.head.map((cell) => (
              <TableHead key={cell} className="text-role-label">
                {cell}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row) => (
            <TableRow key={row[0]}>
              {row.map((cell, index) => (
                <TableCell key={index} className={index > 0 && /\d/.test(cell) ? "numeric-cell" : "whitespace-normal"}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}

/**
 * The body of `/methodology/awards`. Renders the lead, every section, and
 * every subsection from `awardsContent.ts`, which is the single source of the
 * page's prose and table cells (sketch 015, variant B2).
 */
export function AwardsPage() {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className={PARAGRAPH_CLASS}>{AWARDS_LEAD}</p>
      {AWARDS_SECTIONS.map((section) => (
        <section key={section.id} id={section.id} className="flex flex-col gap-[var(--spacing-xs)]">
          <h2 className="text-role-heading text-[var(--color-text-primary)]">{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index} className={PARAGRAPH_CLASS}>
              {paragraph}
            </p>
          ))}
          {section.table !== undefined && <AwardsTableBlock table={section.table} />}
          {section.subsections !== undefined && (
            <div className="flex flex-col gap-[var(--spacing-md)]">
              {section.subsections.map((subsection) => (
                <section key={subsection.id} id={subsection.id} className="flex flex-col gap-[var(--spacing-xs)]">
                  <h3 className="text-role-body font-semibold text-[var(--color-text-primary)]">{subsection.heading}</h3>
                  {subsection.paragraphs.map((paragraph, index) => (
                    <p key={index} className={PARAGRAPH_CLASS}>
                      {paragraph}
                    </p>
                  ))}
                  {subsection.table !== undefined && <AwardsTableBlock table={subsection.table} />}
                </section>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
