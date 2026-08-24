import { createFileRoute } from "@tanstack/react-router";

/**
 * 05-05-PLAN.md Task 2: a placeholder route so the ribbon's "Compare" link
 * (NAV-01) has somewhere real to land and never 404s. The real Compare page
 * (prediction accuracy per algorithm per year) is Phase 8's — this route
 * exists only so the link works, per 05-CONTEXT.md's phase boundary: "The
 * ribbon links to Compare, but the page itself is Phase 8's."
 */
export const Route = createFileRoute("/compare")({
  component: ComparePlaceholder,
});

function ComparePlaceholder() {
  return (
    <div className="p-[var(--spacing-lg)]">
      <h1 className="mb-[var(--spacing-md)] text-[20px] font-semibold leading-[1.2] text-[var(--color-text-primary)]">Compare</h1>
      <p className="text-[14px] text-[var(--color-text-muted)]">The Compare page arrives in Phase 8.</p>
    </div>
  );
}
