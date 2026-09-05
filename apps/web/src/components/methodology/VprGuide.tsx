import { Link } from "@tanstack/react-router";
import { MetricValue } from "@/components/MetricValue";
import {
  VPR_GUIDE_CLOSING_LINK_SECTION_ID,
  VPR_GUIDE_ILLUSTRATION_METRIC,
  VPR_GUIDE_ILLUSTRATION_SECTION_ID,
  VPR_GUIDE_SECTIONS,
} from "./vprGuideContent.js";

/**
 * Cross-route search carry — the same documented escape hatch `Ribbon.tsx`'s
 * `preserveSearch` uses (see that function's doc comment).
 */
function preserveSearch(prev: Record<string, unknown>): never {
  return prev as never;
}

/**
 * The Intro to VPR explainer body (quick task 260905-phf Task 2). Maps
 * `VPR_GUIDE_SECTIONS` to `<section>` elements — content-as-data, matching
 * `CalibrationSection.tsx`'s explainer paragraph treatment.
 *
 * Two presentational additions are tied to a section id rather than folded
 * into the plain-string paragraph data: the one allowed illustration (the
 * real `MetricValue` component, fed literal illustration numbers, on the
 * `swing` section) and the closing link to the accuracy-comparison route (on
 * the `check-it` section) — both are DOM, not prose, and content-as-data's
 * `readonly string[]` shape has no room for either.
 */
export function VprGuide() {
  return (
    <div className="flex flex-col gap-[var(--spacing-lg)]">
      {VPR_GUIDE_SECTIONS.map((section) => (
        <section key={section.id} className="flex flex-col gap-[var(--spacing-xs)]">
          <h2 className="text-role-heading text-[var(--color-text-primary)]">{section.title}</h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index} className="max-w-[72ch] text-role-body text-[var(--color-text-primary)]">
              {paragraph}
            </p>
          ))}
          {section.id === VPR_GUIDE_ILLUSTRATION_SECTION_ID && (
            <div className="event-card mt-[var(--spacing-xs)] flex w-fit flex-col items-start gap-[var(--spacing-xs)] p-[var(--spacing-sm)]">
              <MetricValue metric={VPR_GUIDE_ILLUSTRATION_METRIC} />
              <span className="text-role-label text-[var(--color-text-muted)]">Illustration only — not a real team's numbers.</span>
            </div>
          )}
          {section.id === VPR_GUIDE_CLOSING_LINK_SECTION_ID && (
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
    </div>
  );
}
