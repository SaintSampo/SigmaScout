import { SPR_LEAD, SPR_SECTIONS } from "./sprContent.js";

/**
 * The body of `/methodology/spr`, the "What is SPR?" page. Renders the lead
 * and every section from `sprContent.ts`, which is the single source of the
 * page's prose. Headings and paragraphs only: the page carries no figure and
 * no outbound link (sketch 018).
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
