/**
 * The Locks run progress derivation's full matrix (quick task 261007-481):
 * which waits read determinate, which read indeterminate, and which render
 * nothing at all.
 */
import { describe, expect, it } from "vitest";
import { ledgerRunProgress } from "./ledgerRunProgress.js";
import type { DistrictSimulationRunState } from "./useDistrictSimulationRun.js";

const IDLE: DistrictSimulationRunState = { status: "idle" };
const ERROR: DistrictSimulationRunState = { status: "error" };
const COMPLETE: DistrictSimulationRunState = { status: "complete", events: [], draws: 1000, signature: "sig" };

function running(completedEvents: number, totalEvents: number): DistrictSimulationRunState {
  return { status: "running", completedEvents, totalEvents };
}

describe("ledgerRunProgress", () => {
  it("renders nothing when idle and nothing is loading or pending", () => {
    expect(ledgerRunProgress({ artifactsLoading: false, runPending: false, runState: IDLE })).toBeUndefined();
  });

  it("reads indeterminate when idle with the run pending (before its effect fires)", () => {
    expect(ledgerRunProgress({ artifactsLoading: false, runPending: true, runState: IDLE })).toEqual({ kind: "indeterminate" });
  });

  it("reads determinate while the run is in flight", () => {
    expect(ledgerRunProgress({ artifactsLoading: false, runPending: true, runState: running(3, 9) })).toEqual({ kind: "determinate", completed: 3, total: 9 });
  });

  it("reads indeterminate for a running state with no events to count", () => {
    expect(ledgerRunProgress({ artifactsLoading: false, runPending: true, runState: running(0, 0) })).toEqual({ kind: "indeterminate" });
  });

  it("clamps an over reported completed count into the total", () => {
    expect(ledgerRunProgress({ artifactsLoading: false, runPending: true, runState: running(12, 9) })).toEqual({ kind: "determinate", completed: 9, total: 9 });
  });

  it("renders nothing once the run is complete for the current signature", () => {
    expect(ledgerRunProgress({ artifactsLoading: false, runPending: false, runState: COMPLETE })).toBeUndefined();
  });

  it("reads indeterminate when the complete run is for a stale signature", () => {
    expect(ledgerRunProgress({ artifactsLoading: false, runPending: true, runState: COMPLETE })).toEqual({ kind: "indeterminate" });
  });

  it("renders nothing after a failed run", () => {
    expect(ledgerRunProgress({ artifactsLoading: false, runPending: false, runState: ERROR })).toBeUndefined();
  });

  it("reads indeterminate after a failed run while event artifacts load", () => {
    expect(ledgerRunProgress({ artifactsLoading: true, runPending: false, runState: ERROR })).toEqual({ kind: "indeterminate" });
  });

  it("reads indeterminate when idle while event artifacts load", () => {
    expect(ledgerRunProgress({ artifactsLoading: true, runPending: false, runState: IDLE })).toEqual({ kind: "indeterminate" });
  });

  it("reads determinate for an in flight run even while event artifacts load", () => {
    expect(ledgerRunProgress({ artifactsLoading: true, runPending: false, runState: running(2, 5) })).toEqual({ kind: "determinate", completed: 2, total: 5 });
  });

  it("renders nothing for a running state that is not pending and not loading (a one frame transient)", () => {
    expect(ledgerRunProgress({ artifactsLoading: false, runPending: false, runState: running(1, 4) })).toBeUndefined();
  });
});
