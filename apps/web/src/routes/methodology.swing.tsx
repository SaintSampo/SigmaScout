import { createFileRoute } from "@tanstack/react-router";
import { SwingPage } from "../components/methodology/SwingPage.js";
import { SWING_PAGE_TITLE } from "../components/methodology/swingContent.js";

/**
 * The `/methodology/swing` route (quick task 260909-3fj). Explains the grey
 * `±` beside a rating and the coloured bars on every match row, for a reader
 * who has watched one FRC event. Fetches nothing: every claim it makes is a
 * static fact about how this site computes a number, not a number read from a
 * published artifact.
 *
 * No layout registration needed. The TanStack router plugin generates the
 * route tree from this file's NAME, and `methodology.tsx` already nests its
 * children.
 */
export const Route = createFileRoute("/methodology/swing")({
  component: MethodologySwingPage,
});

function MethodologySwingPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)]">{SWING_PAGE_TITLE}</h1>
      <SwingPage />
    </div>
  );
}
