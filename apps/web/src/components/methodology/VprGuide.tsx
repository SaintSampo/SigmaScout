import { VPR_GUIDE_SECTIONS } from "./vprGuideContent.js";

/**
 * The Intro to VPR explainer body (quick task 260905-phf). Maps
 * `VPR_GUIDE_SECTIONS` to `<section>` elements — content-as-data, matching
 * `CalibrationSection.tsx`'s explainer paragraph treatment. Task 2 owns the
 * real prose; this component only owns the render shape.
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
        </section>
      ))}
    </div>
  );
}
