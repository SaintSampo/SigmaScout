import { createFileRoute } from "@tanstack/react-router";
import { AwardsPage } from "../components/methodology/AwardsPage.js";
import { AWARDS_PAGE_TITLE } from "../components/methodology/awardsContent.js";

/**
 * The `/methodology/awards` route (quick task 260912-tm8). Writes up whether
 * FRC awards can be predicted.
 *
 * Fetches nothing: every number it states was measured once by
 * `pnpm measure:award-predictability` and
 * `pnpm measure:award-qualification-impact` and is written into
 * `awardsContent.ts` as prose. That is also why the page says, in its own
 * words, that the numbers will not update on their own.
 *
 * No layout registration needed. The TanStack router plugin generates the
 * route tree from this file's NAME, and `methodology.tsx` already nests its
 * children.
 */
export const Route = createFileRoute("/methodology/awards")({
  component: MethodologyAwardsPage,
});

function MethodologyAwardsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)]">{AWARDS_PAGE_TITLE}</h1>
      <AwardsPage />
    </div>
  );
}
