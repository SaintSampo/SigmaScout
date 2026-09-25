/**
 * `DistrictLedger`'s component coverage — the tracer's end-to-end proof.
 *
 * The Team cells are real router `Link`s, so every render needs a router
 * context whose tree carries a `to="/team/$teamNumber"` route: the same
 * self-contained-tree `TestHarness` technique `DistrictLocksTab.test.tsx`
 * establishes, plus a `QueryClientProvider` because this tab fetches event
 * artifacts and baked sidecars of its own.
 *
 * THE REAL PROTOCOL IS INSTALLED AS THE MOCK WORKER'S SCRIPT, exactly as
 * `SimulationTab.test.tsx` does: `installMockWorker({ script })` routes every
 * message through `structuredClone`, so a request carrying a function would
 * fail HERE rather than only in a visitor's browser.
 *
 * SC-5 is asserted on the mock handle's `instances` array rather than on
 * `posted`: an EMPTY `instances` array proves the construction never happened,
 * which is strictly stronger than proving a constructed Worker was not used.
 * The empty-request guard lives in `useDistrictSimulationRun` rather than in
 * this component so a future second caller of the hook cannot reintroduce the
 * empty run.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import {
  DistrictArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
  type DistrictEventState,
  type EventArtifact,
} from "../../../../../packages/harness/pageArtifacts.js";
import { installMockWorker, type MockWorkerHandle, type MockWorkerScript } from "../../test/mockWorker.js";
import { runDistrictSimulationJob } from "../../workers/districtSimulationProtocol.js";
import { DistrictLedger } from "./DistrictLedger.js";
import {
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_LEGEND_EARNED,
  DISTRICT_LEDGER_LEGEND_EXPLAINER,
  DISTRICT_LEDGER_LEGEND_OPEN,
  DISTRICT_LEDGER_NO_MATCHES,
  DISTRICT_LEDGER_SEARCH_LABEL,
  DISTRICT_LEDGER_STAT_LINE_LABELS,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
} from "./districtLedgerCopy.js";

/** The forbidden glyph, built from its CODEPOINT so this file never types the character itself. */
const PLUS_MINUS = String.fromCharCode(0x00b1);
const SEASON = 2026;
const ALGORITHM_VERSION = "7.0.0+rolling";

// ---------------------------------------------------------------------------
// Router + query harness
// ---------------------------------------------------------------------------

const ChildrenContext = createContext<ReactNode>(null);

function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}

function TestHarness({ children }: { children: ReactNode }) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
    const districtsRoute = createRoute({ path: "/districts", getParentRoute: () => rootRoute, component: RouteBody });
    const teamRoute = createRoute({ path: "/team/$teamNumber", getParentRoute: () => rootRoute, validateSearch: TeamSearchSchema, component: () => null });
    const routeTree = rootRoute.addChildren([districtsRoute, teamRoute]);
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/districts?algorithm=spr"] }) });
  });
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <ChildrenContext.Provider value={children}>
        <RouterProvider router={router} />
      </ChildrenContext.Provider>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type DistrictTeam = DistrictArtifact["teams"][number];

function state(overrides: Partial<DistrictEventState> = {}): DistrictEventState {
  return { qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: true, playoffsDone: true, awardsPosted: true, ...overrides };
}

const MID_QUALS = state({ qualMatchesPlayed: 6, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
const UNSTARTED = state({ qualMatchesPlayed: 0, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false });

const ROSTER = Array.from({ length: 24 }, (_unused, i) => `frc${String(100 + i)}`);

function districtTeam(teamKey: string, overrides: Partial<DistrictTeam> = {}): DistrictTeam {
  const number = Number(teamKey.replace("frc", ""));
  return {
    teamKey,
    teamNumber: number,
    nickname: `Nickname ${String(number)}`,
    rank: number - 99,
    pointTotal: 24,
    rookieBonus: 0,
    adjustments: 0,
    eventPoints: [
      { eventKey: "2026wadone", eventName: "Done Event", week: 0, tier: "district", qual: 12, alliance: 6, elim: 6, award: 0, total: 24, state: state() },
    ],
    remainingEvents: [],
    maxRemainingDistrict: 0,
    maxRemainingChamp: 0,
    qualifyingAwards: [],
    awardProfile: { bucket: "none", rookie: false },
    districtLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 20, allocationNote: null },
    champLock: { status: "contending", pointsToLock: 5, threatCount: 1, cutLinePoints: 40, allocationNote: null },
    ...overrides,
  };
}

/** Adds one live district event to every team, so the tab has exactly one event to simulate. */
function withLiveEvent(team: DistrictTeam): DistrictTeam {
  return {
    ...team,
    remainingEvents: [
      { eventKey: "2026walive", eventName: "Live Event", week: 2, tier: "district", maxPoints: 83, state: MID_QUALS },
    ],
    maxRemainingDistrict: 83,
    maxRemainingChamp: 83,
  };
}

function withUnstartedEvent(team: DistrictTeam): DistrictTeam {
  return {
    ...team,
    remainingEvents: [
      { eventKey: "2026wasoon", eventName: "Soon Event", week: 4, tier: "district", maxPoints: 83, state: UNSTARTED },
    ],
    maxRemainingDistrict: 83,
    maxRemainingChamp: 83,
  };
}

function artifactOf(teams: DistrictTeam[], overrides: Partial<DistrictArtifact> = {}): DistrictArtifact {
  return DistrictArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    year: SEASON,
    abbreviation: "pnw",
    displayName: "Pacific Northwest",
    dcmpSlots: 12,
    cmpSlots: 4,
    teams,
    insights: {
      teamCount: teams.length,
      eventCount: 3,
      dcmpCutLinePoints: 24,
      cmpCutLinePoints: 48,
      districtLockedCount: 0,
      districtEliminatedCount: 0,
      champLockedCount: 0,
      champEliminatedCount: 0,
    },
    ...overrides,
  });
}

const RP_PMF = [0.2, 0.3, 0.3, 0.2];

function liveEventArtifact(): EventArtifact {
  const matches = [];
  const upcoming = [];
  for (let m = 0; m < 6; m++) {
    const red = [ROSTER[(m * 6) % 24]!, ROSTER[(m * 6 + 1) % 24]!, ROSTER[(m * 6 + 2) % 24]!];
    const blue = [ROSTER[(m * 6 + 3) % 24]!, ROSTER[(m * 6 + 4) % 24]!, ROSTER[(m * 6 + 5) % 24]!];
    matches.push({
      matchKey: `2026walive_qm${String(m + 1)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: m + 1,
      sortTime: 1_760_000_000 + m * 600,
      redTeams: red,
      blueTeams: blue,
      predictedWinner: "red",
      pRedWin: 0.55,
      predictedRedScore: 90,
      predictedBlueScore: 85,
      actualWinner: "red",
      actualRedScore: 95,
      actualBlueScore: 80,
      actualRedRp: 3,
      actualBlueRp: 1,
      redRpPmf: RP_PMF,
      blueRpPmf: RP_PMF,
    });
  }
  for (let m = 6; m < 12; m++) {
    const red = [ROSTER[(m * 6) % 24]!, ROSTER[(m * 6 + 1) % 24]!, ROSTER[(m * 6 + 2) % 24]!];
    const blue = [ROSTER[(m * 6 + 3) % 24]!, ROSTER[(m * 6 + 4) % 24]!, ROSTER[(m * 6 + 5) % 24]!];
    upcoming.push({
      matchKey: `2026walive_qm${String(m + 1)}`,
      compLevel: "qm",
      setNumber: 1,
      matchNumber: m + 1,
      sortTime: 1_760_000_000 + m * 600,
      redTeams: red,
      blueTeams: blue,
      predictedWinner: "blue",
      pRedWin: 0.45,
      predictedRedScore: 80,
      predictedBlueScore: 90,
      redRpPmf: RP_PMF,
      blueRpPmf: RP_PMF,
    });
  }
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: ALGORITHM_VERSION,
    eventKey: "2026walive",
    season: SEASON,
    matches,
    upcoming,
    teams: ROSTER.map((teamKey, i) => ({
      teamKey,
      teamNumber: Number(teamKey.replace("frc", "")),
      nickname: `Nickname ${teamKey}`,
      rank: i + 1,
      record: { wins: 3, losses: 3, ties: 0 },
      rp: 2 + (24 - i) / 24,
      metrics: { total: { value: 60 + (24 - i) }, sigma: { value: 8 } },
    })),
  });
}

const PRESIM_PMF = { o: 0, p: [0.25, 0.25, 0.25, 0.25] };

function preSimBody() {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    districtKey: "2026pnw",
    eventKey: "2026wasoon",
    year: SEASON,
    roster: [...ROSTER].sort(),
    rows: [...ROSTER].sort().map((_unused, t) => ({ t, qual: PRESIM_PMF, alliance: PRESIM_PMF, elim: PRESIM_PMF, award: PRESIM_PMF, total: PRESIM_PMF })),
  };
}

function manifestBody() {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithms: [{ id: "spr", version: ALGORITHM_VERSION, codeVersion: "7.0.0", paramSetName: "rolling" }],
  };
}

interface FetchOptions {
  readonly eventArtifact?: EventArtifact;
  readonly preSim?: unknown;
}

function installFetch(options: FetchOptions = {}) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v1/manifest/algorithms.json")) return Promise.resolve(new Response(JSON.stringify(manifestBody()), { status: 200 }));
    if (url.includes("/v1/district-presim/")) {
      if (options.preSim === undefined) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify(options.preSim), { status: 200 }));
    }
    if (url.includes("/v1/event/")) {
      if (options.eventArtifact === undefined) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify(options.eventArtifact), { status: 200 }));
    }
    return Promise.resolve(new Response("", { status: 404 }));
  }) as unknown as typeof fetch;
}

const realRunScript: MockWorkerScript = (message, ctx) => {
  runDistrictSimulationJob(message, (outbound) => ctx.post(outbound));
};

function renderLedger(artifact: DistrictArtifact) {
  render(
    <TestHarness>
      <DistrictLedger artifact={artifact} algorithm="spr" season={SEASON} />
    </TestHarness>
  );
}

// ---------------------------------------------------------------------------

describe("DistrictLedger — the tracer slice", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders every column label, in order, from the exported tuple", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100")]));
    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("columnheader").map((el) => el.textContent)).toEqual([...DISTRICT_LEDGER_COLUMN_LABELS]);
  });

  it("prints the artifact's own integer in every finished category cell, and a median with a likely range in an in-progress event's Qualification cell", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))));

    // Every grey cell on the finished event is a single integer.
    await waitFor(() => expect(document.querySelectorAll('[data-cell="final"]').length).toBeGreaterThan(0));
    const finals = [...document.querySelectorAll('[data-cell="final"]')];
    for (const cell of finals) expect(cell.textContent ?? "").toMatch(/^\d+$/);

    // The live event's Qualification cell is a focusable <button> printing a
    // median and a "likely" range.
    await waitFor(() => {
      const qual = document.querySelector('[data-cell-id="2026walive:qual"]');
      expect(qual?.getAttribute("data-cell")).toBe("open");
    });
    const qual = document.querySelector('[data-cell-id="2026walive:qual"]')!;
    expect(within(qual as HTMLElement).getByRole("button")).toBeDefined();
    expect(qual.textContent ?? "").toMatch(/^\d+likely \d+\.\d+–\d+\.\d+$/);
  });

  it("renders no plus-minus codepoint anywhere in the tree", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))));
    await waitFor(() => expect(screen.getByTestId("district-ledger-tab")).toBeDefined());
    expect(document.body.textContent ?? "").not.toContain(PLUS_MINUS);
  });

  it("constructs exactly one Worker, terminates it once the result arrives, and sends only the in-progress event", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))));

    await waitFor(() => expect(handle!.instances).toHaveLength(1));
    const instance = handle.instances[0]!;
    await waitFor(() => expect(instance.terminated).toBe(true));

    expect(instance.received).toHaveLength(1);
    const request = instance.received[0] as { events: { eventKey: string }[] };
    expect(request.events.map((event) => event.eventKey)).toEqual(["2026walive"]);
  });

  it("keeps the grey cells and shows the unavailable copy in the open cells when the browser cannot construct a Worker", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ failOnConstruct: new Error("Worker is not defined") });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))));

    await waitFor(() => expect(document.querySelectorAll('[data-cell="final"]').length).toBeGreaterThan(0));
    const qual = await waitFor(() => {
      const found = document.querySelector('[data-cell-id="2026walive:qual"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(qual.getAttribute("data-cell")).toBe("unavailable");
    expect(qual.textContent).toBe(DISTRICT_LEDGER_UNAVAILABLE_CELL);
    for (const cell of document.querySelectorAll('[data-cell="final"]')) expect(cell.textContent ?? "").toMatch(/^\d+$/);
  });

  it("constructs NO Worker at all when every district event is finished (SC-5)", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => districtTeam(teamKey))));
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row").length).toBeGreaterThan(0));
    expect(handle.instances).toHaveLength(0);
  });

  it("constructs NO Worker for an unstarted event and still paints its blue cells from the baked pmfs (SC-5)", async () => {
    installFetch({ preSim: preSimBody() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(
      artifactOf(ROSTER.map((teamKey) => withUnstartedEvent(districtTeam(teamKey))), { bakedEvents: ["2026wasoon"] })
    );
    await waitFor(() => {
      const qual = document.querySelector('[data-cell-id="2026wasoon:qual"]');
      expect(qual?.getAttribute("data-cell")).toBe("open");
    });
    expect(handle.instances).toHaveLength(0);
    const qual = document.querySelector('[data-cell-id="2026wasoon:qual"]')!;
    expect(qual.textContent ?? "").toMatch(/^\d+likely \d+\.\d+–\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------
// The full table: spans, both text forms, the Event and Team cells, the
// controls card.
// ---------------------------------------------------------------------------

/** One team with `count` FINISHED district-tier events, so its Team and Grand total cells span that many rows. */
function multiEventTeam(teamKey: string, count: number): DistrictTeam {
  const base = districtTeam(teamKey);
  return {
    ...base,
    pointTotal: 24 * count,
    eventPoints: Array.from({ length: count }, (_unused, i) => ({
      eventKey: `2026wa${String(i)}`,
      eventName: `Event ${String(i)}`,
      week: i,
      tier: "district" as const,
      qual: 12,
      alliance: 6,
      elim: 6,
      award: 0,
      total: 24,
      state: state(),
    })),
  };
}

describe("DistrictLedger — the full table", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("spans the Team and Grand total cells over each team's OWN row count, never a hardcoded two", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([multiEventTeam("frc200", 3), multiEventTeam("frc100", 2)]));

    await waitFor(() => expect(screen.getAllByTestId("district-ledger-team-cell")).toHaveLength(2));
    const teamCells = screen.getAllByTestId("district-ledger-team-cell");
    const grandCells = screen.getAllByTestId("district-ledger-grand-total");
    // frc200 earned 72 and sorts first; frc100 earned 48.
    expect(teamCells.map((cell) => cell.getAttribute("rowspan"))).toEqual(["3", "2"]);
    expect(grandCells.map((cell) => cell.getAttribute("rowspan"))).toEqual(["3", "2"]);
    expect(screen.getAllByTestId("district-ledger-row")).toHaveLength(5);
  });

  it("renders BOTH blue text forms on one fixture: a median plus a likely range, and a chance plus a tilde-prefixed conditional amount", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))));

    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026walive:qual"]')?.getAttribute("data-cell")).toBe("open");
    });
    // The median form, on qualification.
    expect(document.querySelector('[data-cell-id="2026walive:qual"]')!.textContent ?? "").toMatch(/^\d+likely \d+\.\d+–\d+\.\d+$/);
    // The chance form, on awards: a percentage and a tilde-prefixed conditional amount.
    const award = document.querySelector('[data-cell-id="2026walive:award"]')!;
    expect(award.getAttribute("data-cell")).toBe("open");
    expect(award.textContent ?? "").toMatch(/^\d+% award(~\d+ if won)?$/);
    // And on playoffs, with its own word.
    expect(document.querySelector('[data-cell-id="2026walive:elim"]')!.textContent ?? "").toMatch(/^\d+% play(~\d+ if in)?$/);
  });

  it("prints the event name, its week and its stage word in the Event cell", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([withLiveEvent(districtTeam("frc100"))]));

    await waitFor(() => expect(screen.getAllByTestId("district-ledger-event-cell").length).toBe(2));
    const cells = screen.getAllByTestId("district-ledger-event-cell").map((cell) => cell.textContent ?? "");
    expect(cells[0]).toContain("Done Event");
    expect(cells[0]).toContain("Wk 0");
    expect(cells[0]).toContain("final");
    expect(cells[1]).toContain("Live Event");
    expect(cells[1]).toContain("Wk 2");
    expect(cells[1]).toContain("quals");
  });

  it("prints the position, the team number as a router Link, the nickname, the earned total and the projection in the Team cell", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([withLiveEvent(districtTeam("frc100"))]));

    const teamCell = await screen.findByTestId("district-ledger-team-cell");
    expect(within(teamCell).getByRole("link", { name: "100" }).getAttribute("href")).toContain("/team/100");
    expect(teamCell.textContent ?? "").toContain("1. ");
    expect(teamCell.textContent ?? "").toContain("Nickname 100");
    expect(teamCell.textContent ?? "").toContain("24 earned");
    await waitFor(() => expect(screen.getByTestId("district-ledger-team-cell").textContent ?? "").toMatch(/projected/));
  });

  it("renders the two legend keys and the explainer verbatim from the copy module", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100")]));

    const legend = await screen.findByTestId("district-ledger-legend");
    expect(legend.textContent).toContain(DISTRICT_LEDGER_LEGEND_EARNED);
    expect(legend.textContent).toContain(DISTRICT_LEDGER_LEGEND_OPEN);
    expect(legend.textContent).toContain(DISTRICT_LEDGER_LEGEND_EXPLAINER);
  });

  it("filters rows by a team-number prefix and shows an honest empty message when nothing matches", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100"), districtTeam("frc101"), districtTeam("frc200")]));

    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row")).toHaveLength(3));
    const input = screen.getByLabelText(DISTRICT_LEDGER_SEARCH_LABEL);
    fireEvent.change(input, { target: { value: "10" } });
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row")).toHaveLength(2));
    fireEvent.change(input, { target: { value: "999" } });
    await waitFor(() => expect(screen.queryAllByTestId("district-ledger-row")).toHaveLength(0));
    expect(screen.getByText(DISTRICT_LEDGER_NO_MATCHES)).toBeDefined();
  });

  it("prints today's line as a floor and the open-cell count, and reports the line as absent for an unpublished capacity", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100"), districtTeam("frc101")], { dcmpSlots: 1 }));

    const statLine = await screen.findByTestId("district-ledger-stat-line");
    expect(statLine.textContent).toContain(DISTRICT_LEDGER_STAT_LINE_LABELS.todaysLine);
    expect(statLine.textContent).toContain("0 of 8");
    cleanup();

    renderLedger(artifactOf([districtTeam("frc100")], { dcmpSlots: null }));
    const unknownLine = await screen.findByTestId("district-ledger-stat-line");
    expect(unknownLine.textContent).toContain(DISTRICT_LEDGER_STAT_LINE_LABELS.todaysLineUnknown);
  });
});
