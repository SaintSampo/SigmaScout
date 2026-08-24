/**
 * THROWAWAY — 05-04-PLAN.md Task 1 (D-04's touch-scroll proof). Deleted by
 * plan 05-08. Mounts `TableSpike` at `/spike`, fetching nothing and reading
 * no artifact — fabricated rows only. Not linked from the ribbon; reachable
 * only by direct navigation (the touch-scroll Playwright spec does this).
 */
import { createFileRoute } from "@tanstack/react-router";
import { TableSpike } from "../spike/TableSpike.js";

export const Route = createFileRoute("/spike")({
  component: SpikeRoute,
});

function SpikeRoute() {
  return <TableSpike />;
}
