import { createFileRoute } from "@tanstack/react-router";
import { SigmaPage } from "../components/methodology/SigmaPage.js";
import { SIGMA_PAGE_TITLE } from "../components/methodology/sigmaContent.js";

/**
 * The `/methodology/sigma` route. Explains the Sigma number beside a team and
 * the coloured bars on every match row, for a reader who has watched one FRC
 * event. Fetches nothing: every claim it makes is a static fact about how this
 * site computes a number, not a number read from a published artifact.
 *
 * Replaces `/methodology/swing`, which explained the estimator this one took
 * over from on 2026-09-10. The old route is GONE rather than redirected: the
 * page it served was six days old, so there is no meaningful body of inbound
 * links to preserve, and a redirect that lands a reader on a page about a
 * different number would be its own small lie.
 *
 * No layout registration needed. The TanStack router plugin generates the
 * route tree from this file's NAME, and `methodology.tsx` already nests its
 * children.
 */
export const Route = createFileRoute("/methodology/sigma")({
  component: MethodologySigmaPage,
});

function MethodologySigmaPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)]">{SIGMA_PAGE_TITLE}</h1>
      <SigmaPage />
    </div>
  );
}
