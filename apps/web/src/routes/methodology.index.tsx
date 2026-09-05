import { createFileRoute } from "@tanstack/react-router";
import { MethodologyCards } from "../components/methodology/MethodologyCards.js";

/**
 * The `/methodology` guide hub (quick task 260905-phf Task 1): the index
 * child of the `methodology.tsx` layout route. Fetches nothing — it is a
 * static card grid pointing at the pages that explain how SigmaScout's
 * numbers are produced and measured.
 */
export const Route = createFileRoute("/methodology/")({
  component: MethodologyIndexPage,
});

function MethodologyIndexPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-sm)]">Methodology</h1>
      <p className="mb-[var(--spacing-lg)] max-w-[72ch] text-role-body text-[var(--color-text-muted)]">
        These pages explain how SigmaScout's numbers are produced and measured.
      </p>
      <MethodologyCards />
    </div>
  );
}
