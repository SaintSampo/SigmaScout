import { Link } from "@tanstack/react-router";
import { SPR_LEAD, SPR_SECTIONS, type SprSectionId } from "./sprContent.js";

/**
 * Cross-route search carry — the same documented escape hatch `Ribbon.tsx`'s
 * `preserveSearch` uses (see that function's doc comment) and
 * `AcknowledgmentsPage.tsx`'s own local copy.
 */
function preserveSearch(prev: Record<string, unknown>): never {
  return prev as never;
}

/**
 * The two cross-reference links this page renders, keyed by the section they
 * belong to. DOM (a typed `Link`), not prose — the same split
 * `AcknowledgmentsPage.tsx` documents for its own closing link, and the
 * reason `sprContent.ts`'s `readonly string[]` paragraphs never carry a raw
 * link string.
 */
const SECTION_LINKS: Partial<Record<SprSectionId, { readonly to: "/methodology/sigma" | "/methodology/compare"; readonly label: string }>> = {
  "spr-and-sigma-score-are-different": { to: "/methodology/sigma", label: "Read about Sigma Score and the match band" },
  "what-it-does-not-do": { to: "/methodology/compare", label: "See the algorithm accuracy comparison" },
};

/**
 * The `/methodology/spr` page body (quick task 260910-vof). Prose only, no
 * SVG figures — every claim on this page traces to
 * `packages/core/algorithms/spr.ts` at HEAD, verified rather than
 * transcribed from memory (see `sprContent.ts`'s own header for the
 * discipline that keeps it that way).
 *
 * Same content-as-data / thin-page split `SigmaPage.tsx` and
 * `AcknowledgmentsPage.tsx` establish: every string comes from
 * `sprContent.ts`, this component only lays it out.
 *
 * Accent IS the correct link colour here, unlike `SigmaPage.tsx`'s figures:
 * these two links are genuinely clickable, and the sketch-findings skill's
 * green-is-ink-not-paint rule bans green FILLS, not green link text.
 */
export function SprPage() {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{SPR_LEAD}</p>
      {SPR_SECTIONS.map((section) => {
        const link = SECTION_LINKS[section.id];
        return (
          <section key={section.id} id={section.id} className="flex flex-col gap-[var(--spacing-xs)]">
            <h2 className="text-role-heading text-[var(--color-text-primary)]">{section.heading}</h2>
            {section.paragraphs.map((paragraph, index) => (
              <p key={index} className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
                {paragraph}
              </p>
            ))}
            {link !== undefined && (
              <Link
                to={link.to}
                search={preserveSearch}
                className="text-role-body font-semibold text-[var(--color-accent)] underline underline-offset-2"
              >
                {link.label}
              </Link>
            )}
          </section>
        );
      })}
    </div>
  );
}
