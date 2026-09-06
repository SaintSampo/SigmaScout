import { createFileRoute } from "@tanstack/react-router";
import { AcknowledgmentsPage } from "../components/methodology/AcknowledgmentsPage.js";

/**
 * The `/methodology/acknowledgments` route (quick task 260905-tor). Credits
 * the projects SigmaScout's work is built on. Fetches nothing — every claim
 * it makes is a static fact about this repo, not a number from a published
 * artifact.
 */
export const Route = createFileRoute("/methodology/acknowledgments")({
  component: MethodologyAcknowledgmentsPage,
});

function MethodologyAcknowledgmentsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)]">Acknowledgments</h1>
      <AcknowledgmentsPage />
    </div>
  );
}
