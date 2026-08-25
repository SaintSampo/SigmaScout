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
  return (
    <div className="min-h-screen overflow-x-hidden">
      <Ribbon />
      <Outlet />
    </div>
  );
}

export const Route = createRootRoute({
  validateSearch: RootSearchSchema,
  component: RootLayout,
});
