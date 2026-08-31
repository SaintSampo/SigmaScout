import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { installMockWorker } from "../../test/mockWorker.js";
import type { MockWorkerHandle, MockWorkerOptions, MockWorkerScript } from "../../test/mockWorker.js";
import { PROGRESS_CHUNK_DRAWS, SIMULATION_DRAWS, DEFAULT_SIMULATION_SEED, runSimulationJob } from "../../workers/simulationProtocol.js";
import type { SimulationOutboundMessage, SimulationResultMessage } from "../../workers/simulationProtocol.js";
import { SIMULATION_TICK_INTERVAL_MS, useSimulationRun } from "./useSimulationRun.js";
import type { SimulationRunRequest } from "./useSimulationRun.js";
import type { SimMatchInput, SimTeamBaseline } from "../../../../../packages/core/algorithms/simulation/rankSimulation.js";

/**
 * The same fixture SHAPE `simulationProtocol.test.ts`'s `buildFixture` uses
 * (Task 1's read_first instruction) — 6 team keys across 3 matches, pmfs
 * spread across all 5 outcomes, one baseline per team.
 */
function buildFixture(): { matches: SimMatchInput[]; baselines: SimTeamBaseline[] } {
  const baselines: SimTeamBaseline[] = [
    { teamKey: "frc1", earnedRpSum: 10, matchesPlayed: 5 },
    { teamKey: "frc2", earnedRpSum: 8, matchesPlayed: 5 },
    { teamKey: "frc3", earnedRpSum: 6, matchesPlayed: 5 },
    { teamKey: "frc4", earnedRpSum: 9, matchesPlayed: 5 },
    { teamKey: "frc5", earnedRpSum: 7, matchesPlayed: 5 },
    { teamKey: "frc6", earnedRpSum: 5, matchesPlayed: 5 },
  ];
  const matches: SimMatchInput[] = [
    {
      redTeamKeys: ["frc1", "frc2", "frc3"],
      blueTeamKeys: ["frc4", "frc5", "frc6"],
      redRpPmf: [0.2, 0.3, 0.2, 0.2, 0.1],
      blueRpPmf: [0.1, 0.2, 0.3, 0.3, 0.1],
    },
    {
      redTeamKeys: ["frc1", "frc2", "frc3"],
      blueTeamKeys: ["frc4", "frc5", "frc6"],
      redRpPmf: [0.3, 0.2, 0.2, 0.2, 0.1],
      blueRpPmf: [0.2, 0.2, 0.2, 0.2, 0.2],
    },
    {
      redTeamKeys: ["frc1", "frc2", "frc3"],
      blueTeamKeys: ["frc4", "frc5", "frc6"],
      redRpPmf: [0.1, 0.1, 0.3, 0.3, 0.2],
      blueRpPmf: [0.25, 0.25, 0.25, 0.15, 0.1],
    },
  ];
  return { matches, baselines };
}

function buildRequest(signature: string): SimulationRunRequest {
  const { matches, baselines } = buildFixture();
  return { matches, baselines, signature };
}

/** The real `runSimulationJob` round trip, exactly as 08-07's own tests exercise it — the default script every test uses unless it needs a specific failure shape. */
const realRunScript: MockWorkerScript = (message, ctx) => runSimulationJob(message, ctx.post);

let activeHandle: MockWorkerHandle | undefined;

function install(options?: MockWorkerOptions): MockWorkerHandle {
  activeHandle = installMockWorker(options);
  return activeHandle;
}

afterEach(() => {
  activeHandle?.restore();
  activeHandle = undefined;
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSimulationRun", () => {
  it("H1: idle at rest — no Worker constructed by rendering", () => {
    const handle = install({ script: realRunScript });
    const { result } = renderHook(() => useSimulationRun());
    expect(result.current.state).toEqual({ status: "idle" });
    expect(handle.instances).toHaveLength(0);
  });

  it("H2: start() constructs exactly one Worker and posts exactly one request", () => {
    const handle = install({ script: realRunScript });
    const { result } = renderHook(() => useSimulationRun());
    const request = buildRequest("sig-h2");

    act(() => result.current.start(request));

    expect(handle.instances).toHaveLength(1);
    expect(handle.instances[0]!.received).toHaveLength(1);
    expect(handle.instances[0]!.received[0]).toEqual({
      type: "run",
      matches: request.matches,
      baselines: request.baselines,
      draws: SIMULATION_DRAWS,
      seed: DEFAULT_SIMULATION_SEED,
    });
    expect(result.current.state).toEqual({ status: "running", completedDraws: 0, totalDraws: SIMULATION_DRAWS, elapsedMs: 0 });
  });

  it("H3: progress advances the counter and never produces a result while running", async () => {
    const { baselines } = buildFixture();
    const observedRunningStates: { completedDraws: number; hasResult: boolean }[] = [];
    // A test-authored script, not the real runSimulationJob: each progress
    // message is separated by a real macrotask boundary so React commits a
    // render between them, rather than all 21 messages of the real round
    // trip firing synchronously within one microtask (which the mock's own
    // header documents — delivery is deferred by a microtask, never a real
    // thread hop — and which would let React's automatic batching collapse
    // every intermediate state into the single final commit).
    const STEP_DELAY_MS = 10;
    const steppedScript: MockWorkerScript = async (_message, ctx) => {
      for (let step = 1; step <= 3; step++) {
        await new Promise<void>((resolve) => setTimeout(resolve, STEP_DELAY_MS));
        ctx.post({ type: "progress", completedDraws: step * PROGRESS_CHUNK_DRAWS, totalDraws: SIMULATION_DRAWS } satisfies SimulationOutboundMessage);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, STEP_DELAY_MS));
      ctx.post({
        type: "result",
        rankHistograms: new Map(baselines.map((b) => [b.teamKey, new Int32Array(baselines.length)])),
        draws: SIMULATION_DRAWS,
        computeMs: 3,
      } satisfies SimulationOutboundMessage);
    };
    // Fake `setTimeout` only (not `performance`), and advance it with
    // `advanceTimersByTimeAsync` — which flushes microtasks between each
    // fired timer — so each of the script's three progress posts lands as
    // its OWN separate React commit, deterministically, rather than racing
    // a real-time `waitFor` poll interval against a script that (with real
    // timers) finishes faster than the poll ever fires.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    install({ script: steppedScript });
    const { result } = renderHook(() => useSimulationRun());
    act(() => result.current.start(buildRequest("sig-h3")));

    for (let step = 1; step <= 3; step++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STEP_DELAY_MS);
      });
      const current = result.current.state;
      expect(current.status).toBe("running");
      if (current.status === "running") {
        observedRunningStates.push({ completedDraws: current.completedDraws, hasResult: "result" in current });
      }
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_DELAY_MS);
    });
    expect(result.current.state.status).toBe("complete");

    expect(observedRunningStates.some((s) => s.completedDraws === PROGRESS_CHUNK_DRAWS)).toBe(true);
    for (let i = 1; i < observedRunningStates.length; i++) {
      expect(observedRunningStates[i]!.completedDraws).toBeGreaterThan(observedRunningStates[i - 1]!.completedDraws);
    }
    expect(observedRunningStates.every((s) => !s.hasResult)).toBe(true);
  });

  it("H4: the terminal result message completes the run", async () => {
    const handle = install({ script: realRunScript });
    const { result } = renderHook(() => useSimulationRun());
    const { baselines } = buildFixture();
    const request = buildRequest("sig-h4");

    act(() => result.current.start(request));
    await waitFor(() => expect(result.current.state.status).toBe("complete"));

    const state = result.current.state;
    if (state.status !== "complete") throw new Error("unreachable: asserted above");

    expect(state.result.rankHistograms.size).toBe(baselines.length);
    for (const histogram of state.result.rankHistograms.values()) {
      let sum = 0;
      for (const count of histogram) sum += count;
      expect(sum).toBe(SIMULATION_DRAWS);
    }
    expect(Number.isFinite(state.elapsedMs)).toBe(true);
    expect(state.elapsedMs).toBeGreaterThan(0);

    const posted = handle.instances[0]!.posted;
    const resultMessage = posted.find((m): m is SimulationResultMessage => (m as SimulationOutboundMessage).type === "result");
    expect(resultMessage).toBeDefined();
    expect(state.computeMs).toBe(resultMessage!.computeMs);
    expect(state.signature).toBe(request.signature);
  });

  it("H5: construction failure becomes the error state, never running, no exception escapes", () => {
    install({ failOnConstruct: new Error("no module workers here") });
    const { result } = renderHook(() => useSimulationRun());

    expect(() => act(() => result.current.start(buildRequest("sig-h5")))).not.toThrow();
    expect(result.current.state).toEqual({ status: "error" });
  });

  it("H6a: a mid-run throw INSIDE the job (runSimulationJob's own translated error message) becomes the error state", async () => {
    // An unknown team key referenced by a match, absent from baselines,
    // makes 08-03's simulateRanks throw UnknownTeamKeyError — caught by
    // runSimulationJob's own try/catch and translated into a real `error`
    // message via the actual exported function, never fabricated. A
    // synthetic progress message precedes it so the "at least one progress
    // message, then a failure" sequence is exercised at the hook level.
    const { baselines } = buildFixture();
    const badMatches: SimMatchInput[] = [
      {
        redTeamKeys: ["frc1", "frc2", "frc-unknown"],
        blueTeamKeys: ["frc4", "frc5", "frc6"],
        redRpPmf: [0.2, 0.3, 0.2, 0.2, 0.1],
        blueRpPmf: [0.1, 0.2, 0.3, 0.3, 0.1],
      },
    ];
    const script: MockWorkerScript = (message, ctx) => {
      ctx.post({ type: "progress", completedDraws: PROGRESS_CHUNK_DRAWS, totalDraws: SIMULATION_DRAWS } satisfies SimulationOutboundMessage);
      runSimulationJob(message, ctx.post);
    };
    install({ script });
    const { result } = renderHook(() => useSimulationRun());
    act(() => result.current.start({ matches: badMatches, baselines, signature: "sig-h6a" }));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({ status: "error" });
  });

  it("H6b: a script that throws OUTSIDE the job (the instance's own onerror) becomes the error state", async () => {
    const script: MockWorkerScript = (_message, ctx) => {
      ctx.post({ type: "progress", completedDraws: PROGRESS_CHUNK_DRAWS, totalDraws: SIMULATION_DRAWS } satisfies SimulationOutboundMessage);
      throw new Error("simulated worker script crash");
    };
    install({ script });
    const { result } = renderHook(() => useSimulationRun());
    act(() => result.current.start(buildRequest("sig-h6b")));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toEqual({ status: "error" });
  });

  it("H7: a new run supersedes the previous one — terminate() called, a second instance exists, completedDraws resets to 0", async () => {
    const script: MockWorkerScript = (_message, ctx) => {
      ctx.post({ type: "progress", completedDraws: 500, totalDraws: SIMULATION_DRAWS } satisfies SimulationOutboundMessage);
      // Never posts a result — this run is superseded before it can finish.
    };
    const handle = install({ script });
    const { result } = renderHook(() => useSimulationRun());

    act(() => result.current.start(buildRequest("sig-h7-first")));
    await waitFor(() => {
      const current = result.current.state;
      expect(current.status).toBe("running");
      if (current.status === "running") expect(current.completedDraws).toBe(500);
    });

    act(() => result.current.start(buildRequest("sig-h7-second")));

    expect(handle.instances[0]!.terminated).toBe(true);
    expect(handle.instances).toHaveLength(2);
    expect(result.current.state).toEqual({ status: "running", completedDraws: 0, totalDraws: SIMULATION_DRAWS, elapsedMs: 0 });
  });

  it("H8: a superseded run's late message is ignored — the state still reflects the second run's signature", async () => {
    const script: MockWorkerScript = (_message, ctx) => {
      ctx.post({ type: "progress", completedDraws: 500, totalDraws: SIMULATION_DRAWS } satisfies SimulationOutboundMessage);
    };
    const handle = install({ script });
    const { result } = renderHook(() => useSimulationRun());

    act(() => result.current.start(buildRequest("sig-h8-first")));
    await waitFor(() => expect(result.current.state.status).toBe("running"));
    act(() => result.current.start(buildRequest("sig-h8-second")));

    const staleResult: SimulationResultMessage = {
      type: "result",
      rankHistograms: new Map(buildFixture().baselines.map((b) => [b.teamKey, new Int32Array(6)])),
      draws: SIMULATION_DRAWS,
      computeMs: 1,
    };
    act(() => handle.instances[0]!.onmessage?.({ data: staleResult }));

    const current = result.current.state;
    expect(current.status).toBe("running");
    if (current.status === "running") {
      // The second run's fresh progress (0), not anything from the first
      // instance's late, ignored message.
      expect(current.completedDraws).toBe(0);
    }
  });

  it("H9: the terminal message terminates its own Worker, on both a successful and a failed run", async () => {
    const successHandle = install({ script: realRunScript });
    const { result: successResult } = renderHook(() => useSimulationRun());
    act(() => successResult.current.start(buildRequest("sig-h9-success")));
    await waitFor(() => expect(successResult.current.state.status).toBe("complete"));
    expect(successHandle.instances[0]!.terminated).toBe(true);
    successHandle.restore();

    const failHandle = install({ failOnConstruct: new Error("no module workers here") });
    const { result: failResult } = renderHook(() => useSimulationRun());
    act(() => failResult.current.start(buildRequest("sig-h9-fail")));
    expect(failResult.current.state).toEqual({ status: "error" });
    // Construction itself failed, so no instance to terminate — the error
    // path this half of the test proves is that NOTHING is left dangling.
    expect(failHandle.instances).toHaveLength(0);
  });

  it("H10: unmount terminates a live Worker and swallows a post-unmount message with no React warning", async () => {
    const script: MockWorkerScript = (_message, ctx) => {
      ctx.post({ type: "progress", completedDraws: 500, totalDraws: SIMULATION_DRAWS } satisfies SimulationOutboundMessage);
    };
    const handle = install({ script });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useSimulationRun());

    act(() => result.current.start(buildRequest("sig-h10")));
    await waitFor(() => expect(result.current.state.status).toBe("running"));

    act(() => unmount());
    expect(handle.instances[0]!.terminated).toBe(true);

    const lateResult: SimulationResultMessage = {
      type: "result",
      rankHistograms: new Map(buildFixture().baselines.map((b) => [b.teamKey, new Int32Array(6)])),
      draws: SIMULATION_DRAWS,
      computeMs: 1,
    };
    expect(() => handle.instances[0]!.onmessage?.({ data: lateResult })).not.toThrow();

    const updateAfterUnmountWarning = consoleErrorSpy.mock.calls.some((call) =>
      String(call[0]).includes("state update") || String(call[0]).includes("unmounted")
    );
    expect(updateAfterUnmountWarning).toBe(false);
  });

  it("H11: the elapsed timer ticks while running, and stops changing once the run ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    install({ script: realRunScript });
    const { result } = renderHook(() => useSimulationRun());

    act(() => result.current.start(buildRequest("sig-h11")));
    // Fake timers do not affect the mock's queueMicrotask delivery (a native
    // microtask API, not part of the fake-timer clock) — advancing the fake
    // clock here only fires the ticking `setInterval`, not the queued
    // message delivery, which is why both mechanisms coexist in this test.
    act(() => {
      vi.advanceTimersByTime(SIMULATION_TICK_INTERVAL_MS * 3);
    });

    const runningState = result.current.state;
    expect(runningState.status).toBe("running");
    if (runningState.status === "running") {
      expect(runningState.elapsedMs).toBeGreaterThan(0);
    }

    // Yield to the microtask queue so the real round trip (queued by
    // start()'s postMessage call) actually runs and completes.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(result.current.state.status).toBe("complete"));

    const completedElapsed = (result.current.state as { elapsedMs: number }).elapsedMs;
    act(() => {
      vi.advanceTimersByTime(SIMULATION_TICK_INTERVAL_MS * 20);
    });
    expect((result.current.state as { elapsedMs: number }).elapsedMs).toBe(completedElapsed);
  });

  it("H12: the final elapsed value comes from result arrival, not from the last tick", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    install({ script: realRunScript });
    const { result } = renderHook(() => useSimulationRun());

    act(() => result.current.start(buildRequest("sig-h12")));
    // Two ticks fire (at 100ms, 200ms) — the fake clock's own semantics jump
    // straight to the advanced target for every fired callback in one call,
    // so the observed tick value below IS that target, 220ms.
    act(() => {
      vi.advanceTimersByTime(SIMULATION_TICK_INTERVAL_MS * 2 + 20);
    });
    const lastTicked = (result.current.state as { elapsedMs: number }).elapsedMs;
    expect(lastTicked).toBe(220);

    // Advance further, short of the NEXT tick boundary (300ms) — no
    // additional `setInterval` callback fires, so the state's `elapsedMs`
    // does not change here; only the underlying clock moves, to 260ms.
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect((result.current.state as { elapsedMs: number }).elapsedMs).toBe(lastTicked);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(result.current.state.status).toBe("complete"));

    const finalElapsed = (result.current.state as { elapsedMs: number }).elapsedMs;
    expect(finalElapsed % SIMULATION_TICK_INTERVAL_MS).not.toBe(0);
    expect(finalElapsed).toBeGreaterThan(lastTicked);
    expect(finalElapsed).toBeLessThan(lastTicked + SIMULATION_TICK_INTERVAL_MS);
  });

  it("H13: no Worker in the environment at all is an error state, not a crash", () => {
    // No installMockWorker() call at all — jsdom's real, total absence of a
    // `Worker` global. Proves start() is the ONLY construction site: an
    // eagerly-constructed Worker (module scope or mount) would already have
    // thrown during render, before this test ever calls start().
    expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe("undefined");
    const { result } = renderHook(() => useSimulationRun());

    expect(() => act(() => result.current.start(buildRequest("sig-h13")))).not.toThrow();
    expect(result.current.state).toEqual({ status: "error" });
  });
});
