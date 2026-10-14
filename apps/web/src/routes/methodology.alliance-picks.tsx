import { createFileRoute } from "@tanstack/react-router";
import { AlliancePicksPage } from "../components/methodology/AlliancePicksPage.js";
import { ALLIANCE_PICKS_PAGE_TITLE } from "../components/methodology/alliancePicksContent.js";

/**
 * The `/methodology/alliance-picks` route (quick task 261014-ol7). Writes up
 * the weighted draft: how the Locks simulation makes alliance picks and how
 * that scored against the fixed order it replaced.
 *
 * Fetches nothing. The pick table chart reads the committed
 * `PICK_POSITION_COUNTS` module through `alliancePicksContent.ts`; the scores
 * were measured once (quick task 261014-mji) and are written in as data.
 *
 * No layout registration needed: the TanStack router plugin generates the
 * route tree from this file's NAME, and `methodology.tsx` nests its children.
 */
export const Route = createFileRoute("/methodology/alliance-picks")({
  component: MethodologyAlliancePicksPage,
});

function MethodologyAlliancePicksPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)]">{ALLIANCE_PICKS_PAGE_TITLE}</h1>
      <AlliancePicksPage />
    </div>
  );
}
