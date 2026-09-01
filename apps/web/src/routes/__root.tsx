import { createRootRoute, Outlet } from "@tanstack/react-router";
import { RootSearchSchema } from "../lib/searchParams.js";
import { Ribbon } from "../components/ribbon/Ribbon.js";

/**
 * The root route (05-05-PLAN.md Task 2): `RootSearchSchema` is wired into
 * `validateSearch` here, so `year`/`algorithm` are validated ONCE, at the
 * router boundary, before any child route or component ever reads them
 * (T-05-02). The root layout itself stays free of any data fetch — NAV-06's
 * fast-load priority applies to the content below it, not to this shell.
 *
 * `Ribbon` (Task 3) replaces the tracer's minimal placeholder header here.
 * This edit to `__root.tsx` is not in Task 3's own declared `<files>` list —
 * Ribbon did not exist yet at Task 2's point in this plan's sequential
 * execution, so Task 2 could only wire `validateSearch` and leave the
 * placeholder header in place. Wiring the real `Ribbon` in is Task 3's
 * necessary follow-up (documented deviation, Rule 2: this plan's own
 * must-have truth — "a persistent top ribbon carries the wordmark and links
 * to Teams, Events and Compare on every route" — is unmet without it; see
 * this plan's SUMMARY.md).
 */
function RootLayout() {
  // G-12 (07-UAT.md): same latent trap as `Ribbon.tsx`'s header —
  // `overflow-x-hidden` with no authored `overflow-y` forces the Y axis's
  // USED value to `auto` per the CSS Overflow spec, silently turning this
  // element into a scroll container the instant its content is ever exactly
  // as tall as the viewport (today `min-h-screen` keeps it taller, so it has
  // never fired here, but that is incidental to page content length, not a
  // property this element guarantees). `overflow-x-clip` clips horizontal
  // overflow identically without that risk. Changed proactively for the same
  // reason this rule already produced two real bugs in this codebase this
  // phase (this gap, and a `assertNoIntermediateScroller` false positive on
  // this exact div) — the fix costs nothing and removes the trap at its root.
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <Ribbon />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
      {/* S1 (2026-09-01 user decision): one quiet site-wide sponsor line.
          The flex column keeps it at the viewport bottom on short pages
          without ever overlapping content. */}
      <footer className="mt-[var(--spacing-2xl)] flex items-center justify-center gap-[var(--spacing-sm)] border-t border-[var(--color-border)] bg-[var(--color-bg-surface)] px-[var(--spacing-md)] py-[var(--spacing-sm)]">
        <span className="text-role-label text-[var(--color-text-muted)]">Sponsored by</span>
        <a href="https://www.alfredosys.com/" target="_blank" rel="noopener noreferrer" aria-label="Alfredo Systems" className="inline-flex items-center">
          <img src="/alfredo-systems.png" alt="Alfredo Systems" className="h-6 w-auto" />
        </a>
      </footer>
    </div>
  );
}

export const Route = createRootRoute({
  validateSearch: RootSearchSchema,
  component: RootLayout,
});
