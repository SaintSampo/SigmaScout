import { Link } from "@tanstack/react-router";
import {
  ACKNOWLEDGMENTS_ACCURACY_LINK_ENTRY_ID,
  ACKNOWLEDGMENTS_BUILT_WITH_PARAGRAPHS,
  ACKNOWLEDGMENTS_BUILT_WITH_TITLE,
  ACKNOWLEDGMENTS_ENTRIES,
  ACKNOWLEDGMENTS_LEAD,
  ACKNOWLEDGMENTS_PACKAGES,
} from "./acknowledgmentsContent.js";

/**
 * Cross-route search carry — the same documented escape hatch `Ribbon.tsx`'s
 * `preserveSearch` uses (see that function's doc comment).
 */
function preserveSearch(prev: Record<string, unknown>): never {
  return prev as never;
}

/**
 * The Acknowledgments page body (quick task 260905-tor). Maps
 * `ACKNOWLEDGMENTS_ENTRIES` to `<section>` elements — content-as-data,
 * matching the structure and closing-link treatment the former Intro to
 * VPR page used before its retirement (quick task 260908-n5o).
 *
 * The outbound anchor for each credit lives inside its `<h2>` rather than
 * beside it: that keeps one accessible name shared by both the heading role
 * and the link role, which is what the route test's "a level-2 heading with
 * that entry's name exists, and a link with that accessible name exists"
 * assertion relies on.
 *
 * The internal link to the accuracy-comparison route is keyed by
 * `ACKNOWLEDGMENTS_ACCURACY_LINK_ENTRY_ID` rather than folded into the
 * paragraph strings, because it's DOM (a typed `Link`), not prose — the same
 * reason the former Intro to VPR page keyed its own closing link by section
 * id instead of putting a raw `<a>` string in `readonly string[]` content
 * data.
 */
export function AcknowledgmentsPage() {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">{ACKNOWLEDGMENTS_LEAD}</p>
      {ACKNOWLEDGMENTS_ENTRIES.map((entry) => (
        <section key={entry.id} className="flex flex-col gap-[var(--spacing-xs)]">
          <h2 className="text-role-heading text-[var(--color-text-primary)]">
            <a
              href={entry.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] underline underline-offset-2"
            >
              {entry.name}
            </a>
          </h2>
          {entry.paragraphs.map((paragraph, index) => (
            <p key={index} className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
              {paragraph}
            </p>
          ))}
          {entry.id === ACKNOWLEDGMENTS_ACCURACY_LINK_ENTRY_ID && (
            <Link
              to="/methodology/compare"
              search={preserveSearch}
              className="text-role-body font-semibold text-[var(--color-accent)] underline underline-offset-2"
            >
              See the algorithm accuracy comparison
            </Link>
          )}
        </section>
      ))}
      <section className="flex flex-col gap-[var(--spacing-xs)]">
        <h2 className="text-role-heading text-[var(--color-text-primary)]">{ACKNOWLEDGMENTS_BUILT_WITH_TITLE}</h2>
        {ACKNOWLEDGMENTS_BUILT_WITH_PARAGRAPHS.map((paragraph, index) => (
          <p key={index} className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
            {paragraph}
          </p>
        ))}
        <p className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
          {ACKNOWLEDGMENTS_PACKAGES.map((entry) => entry.label).join(", ")}.
        </p>
      </section>
    </div>
  );
}
