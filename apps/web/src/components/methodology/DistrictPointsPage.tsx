import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DISTRICT_LEDGER_LEAD, DISTRICT_LEDGER_SECTIONS, type DistrictLedgerTable } from "./districtLedgerContent.js";

/**
 * Plain string rather than a `cn()` call: `tailwind-merge` eats a text role
 * class that sits beside a `text-[var(...)]` colour, and only a screenshot
 * catches it (project memory `project_cn_drops_text_role_classes`).
 */
const PARAGRAPH_CLASS = "max-w-[72ch] text-role-body text-[var(--color-text-primary)]";

/**
 * One small results table. Lifted from `AwardsPage.tsx`'s `AwardsTableBlock`
 * unchanged, including the scroll region and the cell rule, so the two
 * methodology pages read as one system. The first column is always a label; a
 * later cell that carries a figure gets `numeric-cell`, and a prose cell is
 * left to wrap.
 */
function DistrictPointsTableBlock({ table }: { table: DistrictLedgerTable }) {
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
 * The body of `/methodology/district-points`. Renders the lead and every
 * section from `districtLedgerContent.ts`, which is the single source of this
 * page's prose and table cells.
 *
 * `AwardsPage.tsx`'s shape with the subsection branch removed: each of this
 * page's sections is one idea, so the content module declares no subsection
 * level for this renderer to walk.
 *
 * No colour is added by this page. Every class here is a shipped token, so the
 * dataviz palette validator has nothing new to check.
 */
export function DistrictPointsPage() {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className={PARAGRAPH_CLASS}>{DISTRICT_LEDGER_LEAD}</p>
      {DISTRICT_LEDGER_SECTIONS.map((section) => (
        <section key={section.id} id={section.id} className="flex flex-col gap-[var(--spacing-xs)]">
          <h2 className="text-role-heading text-[var(--color-text-primary)]">{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index} className={PARAGRAPH_CLASS}>
              {paragraph}
            </p>
          ))}
          {section.table !== undefined && <DistrictPointsTableBlock table={section.table} />}
        </section>
      ))}
    </div>
  );
}
