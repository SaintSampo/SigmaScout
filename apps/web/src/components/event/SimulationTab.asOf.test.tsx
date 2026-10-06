/**
 * The Simulation tab's SPR rewind (quick task 261005-5g0, Part 4), driven
 * through the assembled tab: which starts take the as-of path, what the
 * Worker is sent on each path, and that nothing is fetched until Run.
 *
 * - SPR, rewind start, plan ready: the as-of Worker gets the plan's block and
 *   baselines, never the stored rows, and the result is marked `asOf`.
 * - SPR, rewind start, as-of objects unpublished: today's stored rows, today's
 *   default Worker, marked `stored`.
 * - EPA (or any non SPR artifact) at a rewind start, and SPR at a forward
 *   start: the loader is never called, and the request is byte for byte the
 *   stored one the tab sent before Part 4.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { SIMULATION_STACK_TESTID, SimulationTab } from "./SimulationTab.js";
import { RUN_LABEL_UPDATE } from "./RunControl.js";
import { START_MATCH_NUMBER_INPUT_TESTID } from "./StartMatchPicker.js";
import { baseArtifact, BOTH_PMFS, playedQualRow, upcomingQualRow } from "./simulationTestFixtures.js";
import { installMockWorker, type MockWorkerHandle, type MockWorkerScript } from "../../test/mockWorker.js";
import { DEFAULT_SIMULATION_SEED, runSimulationJob, SIMULATION_DRAWS } from "../../workers/simulationProtocol.js";
import { runSimulationAsOfJob, type SimulationAsOfBlock } from "../../workers/simulationAsOfJob.js";
import { buildSimulationInputs } from "../../lib/simulationInputs.js";
import { rpRuleModuleForSeason } from "../../../../../packages/core/rankingPoints/rules.js";
import { spr } from "../../../../../packages/core/algorithms/spr.js";
import type { AsOfFetchers } from "../districts/asOfRewind.js";
import type { SimulationAsOfPlan } from "./simulationAsOf.js";
import type { EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";

vi.mock("./simulationAsOf.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./simulationAsOf.js")>();
  return { ...actual, loadSimulationAsOf: vi.fn(actual.loadSimulationAsOf) };
});
import { loadSimulationAsOf } from "./simulationAsOf.js";

const ChildrenContext = createContext<ReactNode>(null);
function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}
/** `SimulationTab.failure.test.tsx`'s harness: a completed result mounts real router `Link`s. */
function RouterTestHarness({ children }: { children: ReactNode }) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute();
    const eventRoute = createRoute({ path: "/event/$eventKey", getParentRoute: () => rootRoute, component: RouteBody });
    const teamRoute = createRoute({ path: "/team/$teamNumber", getParentRoute: () => rootRoute, component: () => null });
    return createRouter({ routeTree: rootRoute.addChildren([eventRoute, teamRoute]), history: createMemoryHistory({ initialEntries: ["/event/2024test"] }) });
  });
  return (
    <ChildrenContext.Provider value={children}>
      <RouterProvider router={router} />
    </ChildrenContext.Provider>
  );
}

/** Routes each request to the job its Worker entry runs: the as-of entry's, or the default entry's. */
const script: MockWorkerScript = (message, ctx) => {
  if ((message as { type?: string }).type === "runAsOf") runSimulationAsOfJob(message, ctx.post);
  else runSimulationJob(message, ctx.post);
};

/** qm1 played, qm2 upcoming, both carrying stored pmfs. */
function artifact(algorithmId: string): EventArtifact {
  return baseArtifact({
    algorithmId,
    eventType: 1,
    matches: [playedQualRow({ ...BOTH_PMFS, actualRedRp: 2, actualBlueRp: 0 })],
    upcoming: [upcomingQualRow(BOTH_PMFS)],
  } as Partial<EventArtifact>);
}

const VARS = rpRuleModuleForSeason(2024).thresholdVariables.map((v) => v.name);
const PLAN_TEAMS = ["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"];

/** A ready plan whose block prices for real in the as-of job: six teams, two rows. */
function readyPlan(): SimulationAsOfPlan {
  const init = spr.initState([]);
  const league = [init.logTau, init.scale, 40_000, 360_000, 800];
  for (const _name of VARS) league.push(800, 20, 800 * 36);
  for (const _name of VARS) league.push(0, 0);
  const row = (n: number) => ({
    matchKey: `2024test_qm${String(n)}`,
    eventKey: "2024test",
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber: n,
    redTeams: PLAN_TEAMS.slice(0, 3),
    blueTeams: PLAN_TEAMS.slice(3),
    redSurrogates: [],
    blueSurrogates: [],
    eventType: 1,
    week: 1,
  });
  const block: SimulationAsOfBlock = {
    season: 2024,
    vars: VARS,
    league,
    teams: PLAN_TEAMS.map((teamKey, n) => [teamKey, [[20 + n, 40, 0, 5], [6, 0, 6, 400, 20 + n], null]] as const),
    rows: [row(1), row(2)],
  };
  return {
    status: "ready",
    cutId: "2024test@-1",
    block,
    baselines: PLAN_TEAMS.map((teamKey) => ({ teamKey, earnedRpSum: 0, matchesPlayed: 0 })),
    incompleteBaselineTeamKeys: [],
  };
}

/** Fetchers that record every call and answer "not published". */
function nullFetchers(): AsOfFetchers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    index: async (eventKey) => (calls.push(`index:${eventKey}`), null),
    log: async (eventKey) => (calls.push(`log:${eventKey}`), null),
    season: async () => (calls.push("season"), null),
    start: async () => (calls.push("start"), null),
  };
}

function chooseMatch(n: number): void {
  fireEvent.change(screen.getByTestId(START_MATCH_NUMBER_INPUT_TESTID), { target: { value: String(n) } });
}

let handle: MockWorkerHandle | undefined;
afterEach(() => {
  handle?.restore();
  handle = undefined;
  cleanup();
  vi.mocked(loadSimulationAsOf).mockClear();
});

describe("the Simulation tab's SPR rewind", () => {
  it("SPR at a rewind start with a ready plan: the as-of Worker gets the plan's block and baselines, and the result is marked asOf", async () => {
    handle = installMockWorker({ script });
    const plan = readyPlan();
    vi.mocked(loadSimulationAsOf).mockResolvedValueOnce(plan);
    const fetchers = nullFetchers();
    const a = artifact("spr");
    render(
      <RouterTestHarness>
        <SimulationTab artifact={a} algorithmId="spr" season={2024} asOfFetchers={fetchers} />
      </RouterTestHarness>
    );
    await waitFor(() => expect(screen.getByTestId(START_MATCH_NUMBER_INPUT_TESTID)).toBeDefined());
    chooseMatch(1);
    fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));

    await waitFor(() => expect(screen.getByTestId(SIMULATION_STACK_TESTID).getAttribute("data-simulation-source")).toBe("asOf"));
    expect(vi.mocked(loadSimulationAsOf)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadSimulationAsOf).mock.calls[0]![0]).toEqual({ artifact: a, startMatchKey: "2024test_qm1" });
    expect(vi.mocked(loadSimulationAsOf).mock.calls[0]![1]).toBe(fetchers);
    expect(handle.instances).toHaveLength(1);
    expect(String(handle.instances[0]!.url)).toContain("simulationAsOf.worker");
    if (plan.status !== "ready") throw new Error("unreachable");
    expect(handle.instances[0]!.received).toEqual([{ type: "runAsOf", asOf: plan.block, baselines: plan.baselines, draws: SIMULATION_DRAWS, seed: DEFAULT_SIMULATION_SEED }]);
    // The plan's six teams were ranked, not the stored inputs' two.
    expect(screen.getAllByTestId("rank-distribution-row")).toHaveLength(6);
  });

  it("SPR at a rewind start with the as-of objects unpublished: today's stored rows through today's default Worker", async () => {
    handle = installMockWorker({ script });
    const fetchers = nullFetchers();
    const a = artifact("spr");
    render(
      <RouterTestHarness>
        <SimulationTab artifact={a} algorithmId="spr" season={2024} asOfFetchers={fetchers} />
      </RouterTestHarness>
    );
    await waitFor(() => expect(screen.getByTestId(START_MATCH_NUMBER_INPUT_TESTID)).toBeDefined());
    chooseMatch(1);
    fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));

    await waitFor(() => expect(screen.getByTestId(SIMULATION_STACK_TESTID).getAttribute("data-simulation-source")).toBe("stored"));
    expect(vi.mocked(loadSimulationAsOf)).toHaveBeenCalledTimes(1);
    expect(fetchers.calls).toContain("index:2024test");
    expect(String(handle.instances[0]!.url)).toContain("simulation.worker");
    const stored = buildSimulationInputs(a, "2024test_qm1")!;
    expect(handle.instances[0]!.received).toEqual([{ type: "run", matches: stored.remainingMatches, baselines: stored.baselines, draws: SIMULATION_DRAWS, seed: DEFAULT_SIMULATION_SEED }]);
  });

  it.each([
    ["EPA at a rewind start", "epa", 1],
    ["SPR at a forward start", "spr", 2],
  ])("%s: the loader is never called, nothing is fetched, and the stored request is sent unchanged", async (_name, algorithmId, startMatch) => {
    handle = installMockWorker({ script });
    const fetchers = nullFetchers();
    const a = artifact(algorithmId);
    render(
      <RouterTestHarness>
        <SimulationTab artifact={a} algorithmId={algorithmId} season={2024} asOfFetchers={fetchers} />
      </RouterTestHarness>
    );
    await waitFor(() => expect(screen.getByTestId(START_MATCH_NUMBER_INPUT_TESTID)).toBeDefined());
    chooseMatch(startMatch);
    fireEvent.click(screen.getByRole("button", { name: RUN_LABEL_UPDATE }));

    await waitFor(() => expect(screen.getByTestId(SIMULATION_STACK_TESTID).getAttribute("data-simulation-source")).toBe("stored"));
    expect(vi.mocked(loadSimulationAsOf)).not.toHaveBeenCalled();
    expect(fetchers.calls).toEqual([]);
    expect(String(handle.instances[0]!.url)).toContain("simulation.worker");
    expect(String(handle.instances[0]!.url)).not.toContain("simulationAsOf");
    const stored = buildSimulationInputs(a, `2024test_qm${String(startMatch)}`)!;
    expect(handle.instances[0]!.received[0]).toEqual({ type: "run", matches: stored.remainingMatches, baselines: stored.baselines, draws: SIMULATION_DRAWS, seed: DEFAULT_SIMULATION_SEED });
  });

  it("nothing is fetched until Run is pressed, even at an SPR rewind start", () => {
    handle = installMockWorker({ script });
    const fetchers = nullFetchers();
    render(<SimulationTab artifact={artifact("spr")} algorithmId="spr" season={2024} asOfFetchers={fetchers} />);
    chooseMatch(1);
    expect(fetchers.calls).toEqual([]);
    expect(vi.mocked(loadSimulationAsOf)).not.toHaveBeenCalled();
    expect(handle.instances).toHaveLength(0);
  });
});
