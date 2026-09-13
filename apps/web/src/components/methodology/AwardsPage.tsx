import { AWARDS_LEAD, AWARDS_SECTIONS } from "./awardsContent.js";

/**
 * The body of `/methodology/awards` (quick task 260912-tm8). Renders the lead
 * and every section from `awardsContent.ts`, which is the single source of the
 * page's prose.
 *
 * Deliberately the same markup and tokens as `SigmaPage.tsx`'s section loop,
 * minus its figures: this page states measurements in sentences and draws
 * nothing, so there is no figure registry to carry.
 */
export function AwardsPage() {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{AWARDS_LEAD}</p>
      {AWARDS_SECTIONS.map((section) => (
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
