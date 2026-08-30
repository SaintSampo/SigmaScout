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
    <div className="min-h-screen overflow-x-clip">
      <Ribbon />
      <Outlet />
    </div>
  );
}

export const Route = createRootRoute({
  validateSearch: RootSearchSchema,
  component: RootLayout,
});
