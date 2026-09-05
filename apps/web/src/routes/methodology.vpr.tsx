import { createFileRoute } from "@tanstack/react-router";
import { VprGuide } from "../components/methodology/VprGuide.js";

/**
 * The `/methodology/vpr` route (quick task 260905-phf Task 1 shell, Task 2
 * prose): the Intro to VPR explainer, aimed at a high-school FRC audience.
 * Fetches nothing — every claim it makes is a static, source-cited fact
 * about the shipped model, not a number pulled from a published artifact.
 */
export const Route = createFileRoute("/methodology/vpr")({
  component: MethodologyVprPage,
});

function MethodologyVprPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] p-[var(--spacing-lg)]">
      <h1 className="text-role-heading mb-[var(--spacing-md)]">Intro to VPR</h1>
      <VprGuide />
    </div>
  );
}
