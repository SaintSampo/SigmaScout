import { createFileRoute } from "@tanstack/react-router";
import { DistrictPointsPage } from "../components/methodology/DistrictPointsPage.js";
import { DISTRICT_LEDGER_PAGE_TITLE } from "../components/methodology/districtLedgerContent.js";

/**
 * The `/methodology/district-points` route (phase 10 plan 08). States how the
 * Road to District Champs ledger predicts each of the four district point
 * categories, how well the selection model and the bracket pricer were
 * measured to work, and what the model does not cover.
 *
 * Fetches nothing. Every number it states was measured once by a committed
 * script or a committed reconciliation test (see `districtLedgerContent.ts`'s
 * header for all five sources), so the page's figures move only when one of
 * those measurements is rerun and the copy is updated with it.
 *
 * No layout registration needed. The TanStack router plugin generates the
 * route tree from this file's NAME, and `methodology.tsx` already nests its
 * children.
 */
export const Route = createFileRoute("/methodology/district-points")({
  component: MethodologyDistrictPointsPage,
});

function MethodologyDistrictPointsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)]">{DISTRICT_LEDGER_PAGE_TITLE}</h1>
      <DistrictPointsPage />
    </div>
  );
}
