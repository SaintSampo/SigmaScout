import { beforeAll, describe, expect, it } from "vitest";
import { installMockWorker } from "../test/mockWorker.js";
import {
  SIMULATION_DRAWS,
  PROGRESS_CHUNK_DRAWS,
  DEFAULT_SIMULATION_SEED,
  runSimulationJob,
} from "./simulationProtocol.js";
import type { SimulationRequest, SimulationOutboundMessage, SimulationResultMessage } from "./simulationProtocol.js";
import { createSimulationWorker } from "./createSimulationWorker.js";
import { simulateRanks, mulberry32 } from "../../../../packages/core/algorithms/simulation/rankSimulation.js";
import type { SimMatchInput, SimTeamBaseline } from "../../../../packages/core/algorithms/simulation/rankSimulation.js";

/**
 * Task 1's shared fixture: 6 teams across 3 matches, three-team alliances
 * each side, pmfs with mass spread across all 5 outcomes (never a
 * one-outcome-forced pmf — Test 3 exists specifically to confirm this
 * fixture actually spreads, so Tests 1 and 4 aren't vacuously true). This
 * plan's subject is plumbing, not distribution realism — 08-03 owns fixture
 * realism for the math itself.
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

describe("simulationProtocol — Task 1 TRACER: the real round trip", () => {
  const { matches, baselines } = buildFixture();
  const collected: SimulationOutboundMessage[] = [];

  // One real round trip, shared by Tests 1-3 so they assert against the
  // SAME collected array per the plan's <behavior> text, not merely an
  // equivalent one recomputed per test.
  beforeAll(async () => {
    const handle = installMockWorker({
      script: (message, ctx) => runSimulationJob(message, ctx.post),
    });
    try {
      const worker = new Worker("simulation-protocol-test-worker", {});
      await new Promise<void>((resolve) => {
        worker.onmessage = (event: MessageEvent) => {
          const data = event.data as SimulationOutboundMessage;
          collected.push(data);
          if (data.type === "result") resolve();
        };
        const request: SimulationRequest = {
          type: "run",
          matches,
          baselines,
          draws: SIMULATION_DRAWS,
          seed: DEFAULT_SIMULATION_SEED,
        };
        worker.postMessage(request);
      });
    } finally {
      handle.restore();
    }
  });

  it("Test 1: the round trip — one result message, per-team histograms summing to exactly 1000 draws", () => {
    const last = collected[collected.length - 1];
    expect(last?.type).toBe("result");
    if (last === undefined || last.type !== "result") throw new Error("unreachable: asserted above");
    expect(last.rankHistograms.size).toBe(baselines.length);
    for (const histogram of last.rankHistograms.values()) {
      expect(histogram.length).toBe(baselines.length);
      let sum = 0;
      for (const count of histogram) sum += count;
      expect(sum).toBe(SIMULATION_DRAWS);
    }
    expect(last.draws).toBe(1000);
  });

  it("Test 2: the progress contract, in order — exactly Math.ceil(draws/chunk) messages, strictly increasing, ending at 1000/1000, then exactly one result and nothing after", () => {
    const progressMessages = collected.filter((m): m is Extract<SimulationOutboundMessage, { type: "progress" }> => m.type === "progress");
    const resultMessages = collected.filter((m) => m.type === "result");

    expect(progressMessages.length).toBe(Math.ceil(SIMULATION_DRAWS / PROGRESS_CHUNK_DRAWS));

    let previousCompleted = -1;
    for (const message of progressMessages) {
      expect(message.completedDraws).toBeGreaterThan(previousCompleted);
      previousCompleted = message.completedDraws;
      expect(message.totalDraws).toBe(SIMULATION_DRAWS);
    }
    expect(progressMessages[progressMessages.length - 1]?.completedDraws).toBe(SIMULATION_DRAWS);

    expect(resultMessages.length).toBe(1);
    // The result message must be the very last item collected: no message
    // of any kind follows it.
    expect(collected[collected.length - 1]?.type).toBe("result");
  });

  it("Test 3: the fixture actually spreads — at least one team's histogram has non-zero counts at two or more rank positions", () => {
    const last = collected[collected.length - 1];
    if (last === undefined || last.type !== "result") throw new Error("Test 1 should have produced a result message");
    let foundSpread = false;
    for (const histogram of last.rankHistograms.values()) {
      let nonZeroPositions = 0;
      for (const count of histogram) if (count > 0) nonZeroPositions++;
      if (nonZeroPositions >= 2) {
        foundSpread = true;
        break;
      }
    }
    expect(foundSpread).toBe(true);
  });
});

describe("simulationProtocol — Task 1: chunking equivalence and clone survival", () => {
  const { matches, baselines } = buildFixture();

  it("Test 4: chunking is NOT a behavior change — chunked histograms are entry-for-entry identical to one unchunked simulateRanks call over the same seed (PD-01, load-bearing)", async () => {
    const direct = simulateRanks(matches, baselines, SIMULATION_DRAWS, mulberry32(DEFAULT_SIMULATION_SEED));

    const collected: SimulationOutboundMessage[] = [];
    const handle = installMockWorker({
      script: (message, ctx) => runSimulationJob(message, ctx.post),
    });
    let chunkedResult: SimulationResultMessage | undefined;
    try {
      const worker = new Worker("simulation-protocol-test-worker-4", {});
      await new Promise<void>((resolve) => {
        worker.onmessage = (event: MessageEvent) => {
          const data = event.data as SimulationOutboundMessage;
          collected.push(data);
          if (data.type === "result") {
            chunkedResult = data;
            resolve();
          }
        };
        const request: SimulationRequest = {
          type: "run",
          matches,
          baselines,
          draws: SIMULATION_DRAWS,
          seed: DEFAULT_SIMULATION_SEED,
        };
        worker.postMessage(request);
      });
    } finally {
      handle.restore();
    }

    if (chunkedResult === undefined) throw new Error("chunked round trip produced no result message");
    expect(chunkedResult.rankHistograms.size).toBe(direct.rankHistograms.size);
    for (const [teamKey, directHistogram] of direct.rankHistograms) {
      const chunkedHistogram = chunkedResult.rankHistograms.get(teamKey);
      expect(chunkedHistogram).toBeDefined();
      // Entry-for-entry comparison, not a summary statistic (mean/sum could
      // agree by coincidence on a wide fixture without the per-rank counts
      // actually matching).
      expect(Array.from(chunkedHistogram!)).toEqual(Array.from(directHistogram));
    }
  });

  it("Test 5: the payload survives the real structuredClone boundary — a Map of Int32Arrays round-trips unchanged", async () => {
    const collected: SimulationOutboundMessage[] = [];
    const handle = installMockWorker({
      script: (message, ctx) => runSimulationJob(message, ctx.post),
    });
    let resultMessage: SimulationResultMessage | undefined;
    try {
      const worker = new Worker("simulation-protocol-test-worker-5", {});
      await new Promise<void>((resolve) => {
        worker.onmessage = (event: MessageEvent) => {
          const data = event.data as SimulationOutboundMessage;
          collected.push(data);
          if (data.type === "result") {
            resultMessage = data;
            resolve();
          }
        };
        const request: SimulationRequest = {
          type: "run",
          matches,
          baselines,
          draws: SIMULATION_DRAWS,
          seed: DEFAULT_SIMULATION_SEED,
        };
        worker.postMessage(request);
      });
    } finally {
      handle.restore();
    }
    if (resultMessage === undefined) throw new Error("round trip produced no result message");

    // Printed for the SUMMARY per the plan's explicit instruction: record
    // which branch cloneMessage()/this direct assertion takes under this
    // jsdom environment.
    // eslint-disable-next-line no-console
    console.log(`typeof structuredClone: ${typeof structuredClone}`);

    if (typeof structuredClone === "function") {
      const cloned = structuredClone(resultMessage);
      expect(cloned.rankHistograms instanceof Map).toBe(true);
      for (const [teamKey, histogram] of resultMessage.rankHistograms) {
        const clonedHistogram = cloned.rankHistograms.get(teamKey);
        // Not `toBeInstanceOf(Int32Array)`: under this repo's jsdom test
        // environment, Vitest runs the test module in a jsdom-created
        // realm whose `Int32Array` constructor is a DIFFERENT object
        // identity from the one the global `structuredClone` function
        // reconstructs typed arrays with (that function's own defining
        // realm) — an `instanceof` check across that boundary fails even
        // though the clone is byte-for-byte correct. `Object.prototype
        // .toString` reads the internal `[[Class]]`/`Symbol.toStringTag`
        // slot, which survives the cross-realm boundary, so it is the
        // correct tool for this assertion.
        expect(Object.prototype.toString.call(clonedHistogram)).toBe("[object Int32Array]");
        expect(Array.from(clonedHistogram as ArrayLike<number>)).toEqual(Array.from(histogram));
      }
    } else {
      // Documented fallback per this file's own header comment and
      // mockWorker.ts's cloneMessage(): if structuredClone is unavailable
      // in this environment, the assertion is not silently dropped — it is
      // recorded as a skipped comparison, explicit in the SUMMARY.
      expect(typeof structuredClone).toBe("undefined");
    }
  });
});

describe("simulationProtocol — Task 2: the Vite seam, constructed through createSimulationWorker()", () => {
  const { matches, baselines } = buildFixture();

  it("Test 6: the round trip through createSimulationWorker() — same terminal conditions as Test 1, plus the URL/options contract the mock instance recorded", async () => {
    const handle = installMockWorker({
      script: (message, ctx) => runSimulationJob(message, ctx.post),
    });
    let resultMessage: SimulationResultMessage | undefined;
    try {
      const worker = createSimulationWorker();
      await new Promise<void>((resolve) => {
        worker.onmessage = (event: MessageEvent) => {
          const data = event.data as SimulationOutboundMessage;
          if (data.type === "result") {
            resultMessage = data;
            resolve();
          }
        };
        const request: SimulationRequest = {
          type: "run",
          matches,
          baselines,
          draws: SIMULATION_DRAWS,
          seed: DEFAULT_SIMULATION_SEED,
        };
        worker.postMessage(request);
      });

      if (resultMessage === undefined) throw new Error("createSimulationWorker() round trip produced no result message");
      expect(resultMessage.rankHistograms.size).toBe(baselines.length);
      for (const histogram of resultMessage.rankHistograms.values()) {
        let sum = 0;
        for (const count of histogram) sum += count;
        expect(sum).toBe(SIMULATION_DRAWS);
      }

      // The closest a jsdom test can get to the real bundling seam: pin
      // both halves of the contract createSimulationWorker() promises —
      // the URL it constructed with, and the module-worker option.
      expect(handle.instances.length).toBe(1);
      const instance = handle.instances[0];
      expect(instance).toBeDefined();
      // Vite's own transform of `new Worker(new URL("./simulation.worker.ts",
      // import.meta.url), ...)` appends a `?worker_file&type=module` query
      // suffix to the resolved URL under this test's Vite/vite-node
      // pipeline — genuine evidence Vite recognized the worker-detection
      // shape even inside a jsdom test transform, not just at build time.
      // `.toContain` (not an exact suffix match) is deliberate.
      expect(String(instance!.url)).toContain("simulation.worker.ts");
      expect(instance!.options?.type).toBe("module");
    } finally {
      handle.restore();
    }
  });
});
