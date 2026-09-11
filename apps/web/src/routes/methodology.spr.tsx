import { createFileRoute } from "@tanstack/react-router";
import { SprPage } from "../components/methodology/SprPage.js";
import { SPR_PAGE_TITLE } from "../components/methodology/sprContent.js";

/**
 * The `/methodology/spr` route (quick task 260910-vof). Explains SPR, the
 * site's premier team rating, for a reader who has watched one FRC event.
 * Fetches nothing: every claim it makes is a static fact about how this site
 * computes the number, not a number read from a published artifact.
 *
 * No layout registration needed. The TanStack router plugin generates the
 * route tree from this file's NAME, and `methodology.tsx` already nests its
 * children.
 */
export const Route = createFileRoute("/methodology/spr")({
  component: MethodologySprPage,
});

function MethodologySprPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)]">{SPR_PAGE_TITLE}</h1>
      <SprPage />
    </div>
  );
}
