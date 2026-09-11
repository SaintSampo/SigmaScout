import { SPR_LEAD, SPR_SECTIONS } from "./sprContent.js";

/**
 * The `/methodology/spr` page body (quick task 260910-vof). Prose only, no
 * SVG figures — every claim on this page traces to
 * `packages/core/algorithms/bpr.ts` at HEAD, verified rather than
 * transcribed from memory (see `sprContent.ts`'s own header for the
 * discipline that keeps it that way).
 *
 * Same content-as-data / thin-page split `SigmaPage.tsx` and
 * `AcknowledgmentsPage.tsx` establish: every string comes from
 * `sprContent.ts`, this component only lays it out.
 */
export function SprPage() {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{SPR_LEAD}</p>
      {SPR_SECTIONS.map((section) => (
        <section key={section.id} id={section.id} className="flex flex-col gap-[var(--spacing-xs)]">
          <h2 className="text-role-heading text-[var(--color-text-primary)]">{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index} className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
