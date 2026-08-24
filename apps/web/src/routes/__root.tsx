import { createRootRoute, Outlet } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";

/**
 * The root route (05-05-PLAN.md Task 2): `RootSearchSchema` is wired into
 * `validateSearch` here, so `year`/`algorithm` are validated ONCE, at the
 * router boundary, before any child route or component ever reads them
 * (T-05-02). The root layout itself stays free of any data fetch — NAV-06's
 * fast-load priority applies to the content below it, not to this shell.
 *
 * The header below is the tracer's minimal placeholder (plan 05-01 Task 3,
 * Step 5) carrying only the wordmark. Task 3 of this same plan replaces it
 * with the real `Ribbon` (nav links, year/algorithm dropdowns, search slot)
 * — Ribbon doesn't exist yet at this task's point in a sequential
 * execution, so wiring it in is Task 3's own edit to this file (a
 * documented, necessary addition beyond this task's own `<files>` list —
 * see the plan's SUMMARY.md).
 */
function RootLayout() {
  return (
    <div className="min-h-screen">
      <header className="bg-[var(--color-bg-surface)] px-[var(--spacing-lg)] py-[var(--spacing-md)]">
        <span className="text-[28px] font-semibold leading-[1.2] text-[var(--color-text-primary)]">SigmaScout</span>
      </header>
      <Outlet />
    </div>
  );
}

export const Route = createRootRoute({
  validateSearch: RootSearchSchema,
  component: RootLayout,
});
