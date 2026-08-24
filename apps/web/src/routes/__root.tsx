import { createRootRoute, Outlet } from "@tanstack/react-router";

/**
 * The tracer's root route (plan 05-01 Task 3, Step 5): a minimal header
 * carrying the wordmark and an `<Outlet />`, nothing else. The real ribbon
 * (nav links, year/algorithm dropdowns, search box) is plan 05-05's — this
 * phase's later plans layer onto this same root route rather than replacing
 * it.
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
  component: RootLayout,
});
