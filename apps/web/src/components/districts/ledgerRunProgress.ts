import type { DistrictSimulationRunState } from "./useDistrictSimulationRun.js";

/**
 * THE LOCKS TABS' RUN PROGRESS, as a pure derivation (quick task 261007-481,
 * Jacob 2026-10-07: "add a minimal progress bar for when the simulation is
 * running").
 *
 * Without it a Locks tab that is still simulating looks the same as one that
 * has finished, so the visitor cannot tell whether the cutoff and the open
 * cells are about to change.
 *
 * The tab waits in several ways: the event artifacts loading, the as-of
 * objects loading, an idle run before its effect fires, a complete run for a
 * stale signature. Only an in-flight run knows how far along it is, so only it
 * reads determinate; every other wait reads indeterminate. When nothing is
 * pending (the run landed for the current inputs, it failed, or there is
 * nothing to run) the result is undefined and no bar renders.
 *
 * No React at runtime: the run state is imported as a type only.
 */
export type LedgerRunProgress =
  | { readonly kind: "determinate"; readonly completed: number; readonly total: number }
  | { readonly kind: "indeterminate" };

export function ledgerRunProgress(input: {
  readonly artifactsLoading: boolean;
  readonly runPending: boolean;
  readonly runState: DistrictSimulationRunState;
}): LedgerRunProgress | undefined {
  const { artifactsLoading, runPending, runState } = input;
  if (!artifactsLoading && !runPending) return undefined;
  if (runState.status === "running" && runState.totalEvents > 0) {
    const total = runState.totalEvents;
    // Clamped so a progress message that ever over-reports cannot push
    // aria-valuenow out of its range or the fill past the track.
    const completed = Math.min(Math.max(runState.completedEvents, 0), total);
    return { kind: "determinate", completed, total };
  }
  return { kind: "indeterminate" };
}
