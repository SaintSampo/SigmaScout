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
import { DistrictsSearchSchema, RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import {
  DistrictArtifactSchema,
  EventArtifactSchema,
  type DistrictArtifact,
  type DistrictEventState,
  type EventArtifact,
} from "../../../../../packages/harness/pageArtifacts.js";
import { RANK_BAND_LABEL_PREFIX } from "../event/rankRows.js";
import { installMockWorker, type MockWorkerHandle, type MockWorkerScript } from "../../test/mockWorker.js";
import { runDistrictWorkerJob } from "../../workers/districtSimulationProtocol.js";
import { DistrictLedger } from "./DistrictLedger.js";
import {
  DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED,
  DISTRICT_LEDGER_CAVEAT,
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION,
  DISTRICT_LEDGER_DRAWER_LINE_CAPTION,
  DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION,
  DISTRICT_LEDGER_LEGEND_EARNED,
  DISTRICT_LEDGER_LEGEND_EXPLAINER,
  DISTRICT_LEDGER_LEGEND_OPEN,
  DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
  DISTRICT_LEDGER_NO_MATCHES,
  DISTRICT_LEDGER_PROVENANCE,
  DISTRICT_LEDGER_REWIND_LABEL,
  DISTRICT_LEDGER_SEARCH_LABEL,
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_LABELS,
  DISTRICT_LEDGER_STAT_LINE_LABELS,
  DISTRICT_LEDGER_TAB_LABEL,
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

function TestHarness({ children, initialEntry = "/districts?algorithm=spr" }: { children: ReactNode; initialEntry?: string }) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
    // The REAL `DistrictsSearchSchema`, so the three phase-10 params this tab
    // reads are validated here exactly as the shipped route validates them.
    const districtsRoute = createRoute({ path: "/districts", getParentRoute: () => rootRoute, validateSearch: DistrictsSearchSchema, component: RouteBody });
    const teamRoute = createRoute({ path: "/team/$teamNumber", getParentRoute: () => rootRoute, validateSearch: TeamSearchSchema, component: () => null });
    const routeTree = rootRoute.addChildren([districtsRoute, teamRoute]);
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialEntry] }) });
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
/** Quals done, alliances announced, the bracket under way — the ONE state a partially-played playoff can live in. */
const MID_PLAYOFFS = state({ playoffsDone: false, awardsPosted: false });

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

/** Adds one district event whose quals and alliance selection are done and whose bracket is part-played. */
function withPlayoffEvent(team: DistrictTeam): DistrictTeam {
  return {
    ...team,
    remainingEvents: [
      { eventKey: "2026waplay", eventName: "Playoff Event", week: 2, tier: "district", maxPoints: 83, state: MID_PLAYOFFS },
    ],
    maxRemainingDistrict: 83,
    maxRemainingChamp: 83,
  };
}

/** The eight alliances of `playoffEventArtifact`: alliance `n` is `ROSTER`'s three teams at `(n - 1) * 3`. */
const PLAYOFF_ALLIANCES = Array.from({ length: 8 }, (_unused, n) => ({
  allianceNumber: n + 1,
  picks: ROSTER.slice(n * 3, n * 3 + 3),
}));

function allianceRoster(allianceNumber: number): string[] {
  return PLAYOFF_ALLIANCES[allianceNumber - 1]!.picks;
}

/**
 * Seven played elimination rows, chosen so the milestone lands differently on
 * four alliances at once: alliance 1 wins sf1 and sf7 and is therefore in sf11,
 * which SECURES a top-four finish; alliance 4 loses sf7 and is still alive short
 * of one; alliance 5 loses sf5 and is out at seventh; alliance 6 loses sf6 and is
 * out at eighth.
 */
const PLAYOFF_ELIM_WINNERS: readonly { setNumber: number; red: number; blue: number; winner: number }[] = [
  { setNumber: 1, red: 1, blue: 8, winner: 1 },
  { setNumber: 2, red: 4, blue: 5, winner: 4 },
  { setNumber: 3, red: 2, blue: 7, winner: 2 },
  { setNumber: 4, red: 3, blue: 6, winner: 3 },
  { setNumber: 5, red: 8, blue: 5, winner: 8 },
  { setNumber: 6, red: 7, blue: 6, winner: 7 },
  { setNumber: 7, red: 1, blue: 4, winner: 1 },
];

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

/**
 * An event whose qualification is finished, whose alliances are published and
 * whose bracket is PART PLAYED — the live shape the milestone headline exists
 * for. Twelve played qualification rows, eight alliances, seven elimination
 * rows.
 */
function playoffEventArtifact(): EventArtifact {
  const matches = [];
  for (let m = 0; m < 12; m++) {
    const red = [ROSTER[(m * 6) % 24]!, ROSTER[(m * 6 + 1) % 24]!, ROSTER[(m * 6 + 2) % 24]!];
    const blue = [ROSTER[(m * 6 + 3) % 24]!, ROSTER[(m * 6 + 4) % 24]!, ROSTER[(m * 6 + 5) % 24]!];
    matches.push({
      matchKey: `2026waplay_qm${String(m + 1)}`,
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
  for (const row of PLAYOFF_ELIM_WINNERS) {
    matches.push({
      matchKey: `2026waplay_sf${String(row.setNumber)}m1`,
      compLevel: "sf",
      setNumber: row.setNumber,
      matchNumber: 1,
      sortTime: 1_770_000_000 + row.setNumber * 600,
      redTeams: allianceRoster(row.red),
      blueTeams: allianceRoster(row.blue),
      predictedWinner: "red",
      pRedWin: 0.5,
      predictedRedScore: 100,
      predictedBlueScore: 100,
      actualWinner: row.winner === row.red ? "red" : "blue",
      actualRedScore: row.winner === row.red ? 110 : 90,
      actualBlueScore: row.winner === row.red ? 90 : 110,
      actualRedRp: 0,
      actualBlueRp: 0,
    });
  }
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: ALGORITHM_VERSION,
    eventKey: "2026waplay",
    season: SEASON,
    matches,
    upcoming: [],
    teams: ROSTER.map((teamKey, i) => ({
      teamKey,
      teamNumber: Number(teamKey.replace("frc", "")),
      nickname: `Nickname ${teamKey}`,
      rank: i + 1,
      record: { wins: 6, losses: 6, ties: 0 },
      rp: 2 + (24 - i) / 24,
      metrics: { total: { value: 60 + (24 - i) }, sigma: { value: 8 } },
    })),
    alliances: PLAYOFF_ALLIANCES,
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

/**
 * THE REAL PROTOCOL DISPATCHER as the mock Worker's script, so BOTH request
 * types this tab posts — the per-event run and the advancement chance — travel
 * the same `structuredClone` boundary a browser would enforce.
 */
const realRunScript: MockWorkerScript = (message, ctx) => {
  runDistrictWorkerJob(message, (outbound) => ctx.post(outbound));
};

/** Every mock Worker instance that was handed a request of one kind. */
function instancesReceiving(handle: MockWorkerHandle, type: "run" | "chance") {
  return handle.instances.filter((instance) => instance.received.some((message) => (message as { type?: string }).type === type));
}

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
    expect(qual.textContent ?? "").toMatch(/^~\d+likely \d+\.\d+–\d+\.\d+$/);
  });

  it("renders no plus-minus codepoint anywhere in the tree", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))));
    await waitFor(() => expect(screen.getByTestId("district-ledger-tab")).toBeDefined());
    expect(document.body.textContent ?? "").not.toContain(PLUS_MINUS);
  });

  it("constructs exactly one RUN Worker, terminates it once the result arrives, and sends only the in-progress event", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))));

    // Counted by the request each instance RECEIVED rather than by the raw
    // instance count: since quick task 260925-rpj this tab posts a second,
    // different request — the advancement chance — to a Worker of its own, and
    // a bare length check could no longer tell one run from two.
    await waitFor(() => expect(instancesReceiving(handle!, "run")).toHaveLength(1));
    const instance = instancesReceiving(handle, "run")[0]!;
    await waitFor(() => expect(instance.terminated).toBe(true));

    expect(instance.received).toHaveLength(1);
    const request = instance.received[0] as { events: { eventKey: string }[] };
    expect(request.events.map((event) => event.eventKey)).toEqual(["2026walive"]);
  });

  it("posts the advancement chance to a SECOND Worker, once, and terminates it too", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))));

    await waitFor(() => expect(instancesReceiving(handle!, "chance")).toHaveLength(1));
    const instance = instancesReceiving(handle, "chance")[0]!;
    await waitFor(() => expect(instance.terminated).toBe(true));
    const request = instance.received[0] as { inputs: { teams: unknown[]; slots: number } };
    // One entry per team in the district, and the published capacity, so the
    // ranking sees the whole field.
    expect(request.inputs.teams).toHaveLength(ROSTER.length);
    expect(request.inputs.slots).toBe(12);
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

  it("posts NO per-event run for an unstarted event and still paints its blue cells from the baked pmfs (SC-5)", async () => {
    installFetch({ preSim: preSimBody() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(
      artifactOf(ROSTER.map((teamKey) => withUnstartedEvent(districtTeam(teamKey))), { bakedEvents: ["2026wasoon"] })
    );
    await waitFor(() => {
      const qual = document.querySelector('[data-cell-id="2026wasoon:qual"]');
      expect(qual?.getAttribute("data-cell")).toBe("open");
    });
    // SC-5 is about the SIMULATION: an event nobody has played is priced by the
    // pipeline, so the browser re-runs nothing for it. The advancement chance
    // is a different job on the same baked numbers — a district with something
    // still to play has a real race to rank — so it is exempt by construction
    // rather than by exception, and is asserted on its own below.
    expect(instancesReceiving(handle, "run")).toHaveLength(0);
    const qual = document.querySelector('[data-cell-id="2026wasoon:qual"]')!;
    expect(qual.textContent ?? "").toMatch(/^~\d+likely \d+\.\d+–\d+\.\d+$/);
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
    expect(document.querySelector('[data-cell-id="2026walive:qual"]')!.textContent ?? "").toMatch(/^~\d+likely \d+\.\d+–\d+\.\d+$/);
    // The chance form, on awards: a percentage and a tilde-prefixed conditional amount.
    const award = document.querySelector('[data-cell-id="2026walive:award"]')!;
    expect(award.getAttribute("data-cell")).toBe("open");
    expect(award.textContent ?? "").toMatch(/^~\d+% award(~\d+ if won)?$/);
    // And on playoffs, whose MILESTONE leads the line: the number was never the
    // chance of playing a playoff match, it is the chance of finishing top four
    // (fifth through eighth pay nothing), so the words say that and sit first.
    expect(document.querySelector('[data-cell-id="2026walive:elim"]')!.textContent ?? "").toMatch(
      /^top 4 ~\d+%(~\d+ if top 4)?$/
    );
  });

  it("prints the event name, its week and its stage word in the Event cell", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([withLiveEvent(districtTeam("frc100"))]));

    await waitFor(() => expect(screen.getAllByTestId("district-ledger-event-cell").length).toBe(2));
    const cells = screen.getAllByTestId("district-ledger-event-cell").map((cell) => cell.textContent ?? "");
    expect(cells[0]).toContain("Done Event");
    expect(cells[0]).toContain("Wk 1");
    expect(cells[0]).toContain("final");
    expect(cells[1]).toContain("Live Event");
    expect(cells[1]).toContain("Wk 3");
    expect(cells[1]).toContain("quals");
  });

  it("prints the position, the team number as a router Link, the nickname, the earned total and the projection in the Team cell", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([withLiveEvent(districtTeam("frc100"))]));

    const teamCell = await screen.findByTestId("district-ledger-team-cell");
    expect(within(teamCell).getByRole("link", { name: "100" }).getAttribute("href")).toContain("/team/100");
    // 260925-hr9 moved the position and the projection onto the sketch's own
    // third line, "#1 · 24 earned · median 30": the position leads with a hash
    // rather than trailing a full stop, and the projection is named by what it
    // is, the median of the predicted grand total.
    expect(teamCell.textContent ?? "").toContain("#1 · ");
    expect(teamCell.textContent ?? "").toContain("Nickname 100");
    expect(teamCell.textContent ?? "").toContain("24 earned");
    await waitFor(() => expect(screen.getByTestId("district-ledger-team-cell").textContent ?? "").toMatch(/median \d+/));
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

  it("prints today's line as a floor, and reports the line as absent for an unpublished capacity", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100"), districtTeam("frc101")], { dcmpSlots: 1 }));

    const statLine = await screen.findByTestId("district-ledger-stat-line");
    expect(statLine.textContent).toContain(DISTRICT_LEDGER_STAT_LINE_LABELS.todaysLine);
    cleanup();

    renderLedger(artifactOf([districtTeam("frc100")], { dcmpSlots: null }));
    const unknownLine = await screen.findByTestId("district-ledger-stat-line");
    expect(unknownLine.textContent).toContain(DISTRICT_LEDGER_STAT_LINE_LABELS.todaysLineUnknown);
  });
});

// ---------------------------------------------------------------------------
// The five status chips: labels, counts, definitions, filters and the one red.
// ---------------------------------------------------------------------------

/** A district whose slot count forces every one of the five statuses into view. */
function statusFixture() {
  return artifactOf(
    [
      // Two locked on points, one locked by an award, and two that cannot
      // reach the line.
      { ...multiEventTeam("frc100", 1), pointTotal: 100, eventPoints: [{ ...multiEventTeam("frc100", 1).eventPoints[0]!, qual: 22, alliance: 16, elim: 30, award: 15, total: 100 }] },
      { ...multiEventTeam("frc101", 1), pointTotal: 90, eventPoints: [{ ...multiEventTeam("frc101", 1).eventPoints[0]!, qual: 22, alliance: 16, elim: 30, award: 15, total: 90 }] },
      {
        ...multiEventTeam("frc102", 1),
        pointTotal: 5,
        eventPoints: [{ ...multiEventTeam("frc102", 1).eventPoints[0]!, qual: 5, alliance: 0, elim: 0, award: 0, total: 5 }],
        qualifyingAwards: [{ eventKey: "2026wa0", awardType: 0, label: "Impact", awardOnly: false }],
      },
      { ...multiEventTeam("frc103", 1), pointTotal: 4, eventPoints: [{ ...multiEventTeam("frc103", 1).eventPoints[0]!, qual: 4, alliance: 0, elim: 0, award: 0, total: 4 }] },
      { ...multiEventTeam("frc104", 1), pointTotal: 3, eventPoints: [{ ...multiEventTeam("frc104", 1).eventPoints[0]!, qual: 3, alliance: 0, elim: 0, award: 0, total: 3 }] },
    ],
    { dcmpSlots: 3 }
  );
}

describe("DistrictLedger — the five status chips", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders exactly the five labels with live counts, plus the award variant on a team locked by an award", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(statusFixture());

    const chips = await screen.findAllByTestId("district-ledger-status-chip");
    expect(chips.map((chip) => chip.getAttribute("data-status"))).toEqual(["prequalified", "locked", "inRange", "outOfRange", "lockedOut"]);
    for (const [index, label] of Object.values(DISTRICT_LEDGER_STATUS_LABELS).entries()) {
      expect(chips[index]!.textContent ?? "").toContain(label);
    }
    // The award variant renders in the team's own Status cell.
    const statusCells = screen.getAllByTestId("district-ledger-status-cell").map((cell) => cell.textContent ?? "");
    expect(statusCells).toContain(DISTRICT_LEDGER_LOCKED_AWARD_LABEL);
  });

  it("gives every chip its definition as an accessible description and renders all five definitions verbatim", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(statusFixture());

    const chips = await screen.findAllByTestId("district-ledger-status-chip");
    for (const chip of chips) {
      const describedBy = chip.getAttribute("aria-describedby");
      expect(describedBy).not.toBeNull();
      expect(document.getElementById(describedBy!)).not.toBeNull();
    }
    const definitions = screen.getByTestId("district-ledger-status-definitions").textContent ?? "";
    for (const definition of Object.values(DISTRICT_LEDGER_STATUS_DEFINITIONS)) expect(definitions).toContain(definition);
  });

  it("toggles a chip off to hide those rows and back on to restore them, WITHOUT changing the counts", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(statusFixture());

    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row")).toHaveLength(5));
    const lockedChip = screen.getAllByTestId("district-ledger-status-chip").find((chip) => chip.getAttribute("data-status") === "locked")!;
    const countBefore = lockedChip.textContent;
    expect(lockedChip.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(lockedChip);
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row")).toHaveLength(2));
    const lockedAfter = screen.getAllByTestId("district-ledger-status-chip").find((chip) => chip.getAttribute("data-status") === "locked")!;
    expect(lockedAfter.getAttribute("aria-pressed")).toBe("false");
    // A count describes the DISTRICT, not the filtered view.
    expect(lockedAfter.textContent).toBe(countBefore);

    fireEvent.click(lockedAfter);
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row")).toHaveLength(5));
  });

  it("carries the red status modifier on the Locked out chip and its rows, and on nothing else on the tab", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(statusFixture());

    await waitFor(() => expect(screen.getAllByTestId("district-ledger-status-chip")).toHaveLength(5));
    const red = [...document.querySelectorAll(".lock-status-chip--locked-out")];
    // One chip in the filter row, plus the Status cell of each Locked out team.
    expect(red.length).toBeGreaterThan(0);
    const statuses = red.map((element) => element.textContent ?? "");
    for (const text of statuses) expect(text).toContain(DISTRICT_LEDGER_STATUS_LABELS.lockedOut);
    // No element on the tab carries the champ tab's own eliminated modifier.
    expect(document.querySelectorAll(".lock-status-chip--eliminated")).toHaveLength(0);
  });

  it("renders NO chip and the honest capacity copy when TBA published no capacity", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100"), districtTeam("frc101")], { dcmpSlots: null }));

    await waitFor(() => expect(screen.getAllByTestId("district-ledger-status-cell").length).toBe(2));
    for (const cell of screen.getAllByTestId("district-ledger-status-cell")) {
      expect(cell.textContent).toBe(DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED);
      expect(cell.querySelector(".lock-status-chip")).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The Rewind slider (SC-4)
// ---------------------------------------------------------------------------

/** The finished event's own artifact: the same 12-match schedule, every row played. */
function doneEventArtifact(): EventArtifact {
  const live = liveEventArtifact();
  const played = [...live.matches, ...live.upcoming].map((match, index) => ({
    matchKey: `2026wadone_qm${String(index + 1)}`,
    compLevel: "qm" as const,
    setNumber: 1,
    matchNumber: index + 1,
    sortTime: 1_760_000_000 + index * 600,
    redTeams: match.redTeams,
    blueTeams: match.blueTeams,
    predictedWinner: "red" as const,
    pRedWin: 0.55,
    predictedRedScore: 90,
    predictedBlueScore: 85,
    actualWinner: "red" as const,
    actualRedScore: 95,
    actualBlueScore: 80,
    actualRedRp: 3,
    actualBlueRp: 1,
    redRpPmf: RP_PMF,
    blueRpPmf: RP_PMF,
  }));
  return EventArtifactSchema.parse({
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: ALGORITHM_VERSION,
    eventKey: "2026wadone",
    season: SEASON,
    matches: played,
    upcoming: [],
    teams: live.teams,
  });
}

function renderLedgerAt(artifact: DistrictArtifact, initialEntry: string) {
  render(
    <TestHarness initialEntry={initialEntry}>
      <DistrictLedger artifact={artifact} algorithm="spr" season={SEASON} />
    </TestHarness>
  );
}

describe("DistrictLedger — the Rewind slider", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  const finishedDistrict = () => artifactOf(ROSTER.map((teamKey) => districtTeam(teamKey)));

  it("renders the slider with its label, a position readout and the derived jump chips", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(finishedDistrict());

    await waitFor(() => expect(screen.getByTestId("district-ledger-rewind")).toBeDefined());
    expect(screen.getByLabelText(DISTRICT_LEDGER_REWIND_LABEL)).toBeDefined();
    expect(screen.getByTestId("district-ledger-rewind-readout").textContent).toBe("Now");
    const chips = screen.getAllByTestId("district-ledger-jump-chip").map((chip) => chip.getAttribute("data-chip"));
    expect(chips[0]).toBe("season-start");
    expect(chips[chips.length - 1]).toBe("now");

    // 260925-hr9: the rail carries the chips' own short form as tick labels,
    // DERIVED from the same chips rather than from a hardcoded week list, so a
    // district with fewer weeks gets fewer ticks.
    const ticks = [...screen.getByTestId("district-ledger-ticks").children].map((tick) => tick.textContent);
    expect(ticks[0]).toBe("start");
    expect(ticks[ticks.length - 1]).toBe("now");
    // Never MORE than one tick per chip; a week tick that would land on top of
    // a neighbour is dropped rather than drawn over it.
    expect(ticks.length).toBeLessThanOrEqual(chips.length);
    for (const tick of ticks.slice(1, -1)) expect(tick ?? "").toMatch(/^wk \d+$/);
  });

  it("SC-4: a position before an event's last qualification match turns its selection, playoff and award cells BLUE", async () => {
    installFetch({ eventArtifact: doneEventArtifact() });
    handle = installMockWorker({ script: realRunScript });

    // At "now" every one of the event's four cells is a grey final.
    renderLedger(finishedDistrict());
    await waitFor(() => expect(document.querySelector('[data-cell-id="2026wadone:qual"]')).not.toBeNull());
    for (const category of ["qual", "alliance", "elim", "award"]) {
      expect(document.querySelector(`[data-cell-id="2026wadone:${category}"]`)?.getAttribute("data-cell")).toBe("final");
    }
    cleanup();

    // Rewound to the quals-done step, the three later categories reopen.
    renderLedgerAt(finishedDistrict(), "/districts?algorithm=spr&at=2026wadone%3AqualsDone");
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026wadone:alliance"]')?.getAttribute("data-cell")).toBe("open");
    });
    expect(document.querySelector('[data-cell-id="2026wadone:elim"]')?.getAttribute("data-cell")).toBe("open");
    expect(document.querySelector('[data-cell-id="2026wadone:award"]')?.getAttribute("data-cell")).toBe("open");
    // Qualification is decided at that step, so it stays grey.
    expect(document.querySelector('[data-cell-id="2026wadone:qual"]')?.getAttribute("data-cell")).toBe("final");
  });

  /** A finished district whose teams carry DISTINCT totals, so the statuses vary and a change is observable. */
  const variedDistrict = () =>
    artifactOf(
      ROSTER.map((teamKey, index) => {
        const total = 12 + index * 3;
        const base = districtTeam(teamKey);
        return {
          ...base,
          pointTotal: total,
          eventPoints: [{ ...base.eventPoints[0]!, qual: total, alliance: 0, elim: 0, award: 0, total }],
        };
      })
    );

  it("recomputes the statuses at the moved position — at least one chip label changes", async () => {
    installFetch({ eventArtifact: doneEventArtifact() });
    handle = installMockWorker({ script: realRunScript });

    renderLedger(variedDistrict());
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-status-cell").length).toBe(ROSTER.length));
    const atNow = screen.getAllByTestId("district-ledger-status-cell").map((cell) => cell.textContent ?? "");
    cleanup();

    renderLedgerAt(variedDistrict(), "/districts?algorithm=spr&at=season-start");
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-status-cell").length).toBe(ROSTER.length));
    const rewound = screen.getAllByTestId("district-ledger-status-cell").map((cell) => cell.textContent ?? "");
    expect(rewound).not.toEqual(atNow);
  });

  it("marks a clicked jump chip pressed and moves the readout to it", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(finishedDistrict());

    const seasonStart = await waitFor(() => screen.getAllByTestId("district-ledger-jump-chip")[0]!);
    expect(seasonStart.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(seasonStart);
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-jump-chip")[0]!.getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByTestId("district-ledger-rewind-readout").textContent).toBe("Season start");
  });

  it("starts at the step a URL names, and at NOW for an unknown step id with no error state", async () => {
    installFetch({ eventArtifact: doneEventArtifact() });
    handle = installMockWorker({ script: realRunScript });

    renderLedgerAt(finishedDistrict(), "/districts?algorithm=spr&at=2026wadone%3Aalliance");
    await waitFor(() => expect(screen.getByTestId("district-ledger-rewind-readout").textContent).toContain("alliance selection"));
    cleanup();

    renderLedgerAt(finishedDistrict(), "/districts?algorithm=spr&at=a-step-that-never-existed");
    await waitFor(() => expect(screen.getByTestId("district-ledger-rewind-readout").textContent).toBe("Now"));
    expect(screen.getByTestId("district-ledger-tab")).toBeDefined();
  });

  it("constructs a Worker when the slider moves into a finished event, even though the now position constructs none", async () => {
    installFetch({ eventArtifact: doneEventArtifact() });
    handle = installMockWorker({ script: realRunScript });

    renderLedger(finishedDistrict());
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row").length).toBe(ROSTER.length));
    expect(handle.instances).toHaveLength(0);
    cleanup();

    renderLedgerAt(finishedDistrict(), "/districts?algorithm=spr&at=2026wadone%3AqualsDone");
    await waitFor(() => expect(handle!.instances.length).toBeGreaterThan(0));
    const request = handle.instances[handle.instances.length - 1]!.received[0] as { events: { eventKey: string }[] };
    expect(request.events.map((event) => event.eventKey)).toEqual(["2026wadone"]);
  });
});

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

describe("DistrictLedger — the drawer", () => {
  const originalFetch = global.fetch;
  const originalMatchMedia = window.matchMedia;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    window.matchMedia = originalMatchMedia;
    cleanup();
    vi.restoreAllMocks();
  });

  const liveDistrict = () => artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey))));

  async function renderWithOpenCells() {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(liveDistrict());
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026walive:qual"]')?.getAttribute("data-cell")).toBe("open");
    });
  }

  function cellButton(cellId: string): HTMLElement {
    const cell = document.querySelector(`[data-cell-id="${cellId}"]`)!;
    return cell.tagName === "BUTTON" ? (cell as HTMLElement) : within(cell as HTMLElement).getByRole("button");
  }

  it("opens ONE drawer under the clicked team, closes it on a second click, and moves it on a different cell", async () => {
    await renderWithOpenCells();
    expect(screen.queryAllByTestId("district-ledger-drawer")).toHaveLength(0);

    fireEvent.click(cellButton("2026walive:qual"));
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-drawer")).toHaveLength(1));
    expect(screen.getByTestId("district-ledger-drawer").getAttribute("data-drawer-cell")).toBe("2026walive:qual");

    // A different cell in the same team MOVES the drawer; still at most one.
    fireEvent.click(cellButton("2026walive:elim"));
    await waitFor(() => expect(screen.getByTestId("district-ledger-drawer").getAttribute("data-drawer-cell")).toBe("2026walive:elim"));
    expect(screen.getAllByTestId("district-ledger-drawer")).toHaveLength(1);

    // The same cell again CLOSES it.
    fireEvent.click(cellButton("2026walive:elim"));
    await waitFor(() => expect(screen.queryAllByTestId("district-ledger-drawer")).toHaveLength(0));
  });

  it("tracks aria-expanded on the clicked cell and leaves every other open cell false", async () => {
    await renderWithOpenCells();
    expect(cellButton("2026walive:qual").getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(cellButton("2026walive:qual"));
    await waitFor(() => expect(cellButton("2026walive:qual").getAttribute("aria-expanded")).toBe("true"));
    expect(cellButton("2026walive:elim").getAttribute("aria-expanded")).toBe("false");
  });

  it("draws both histograms, with today's line on the grand total plot and the floor caption beneath it", async () => {
    await renderWithOpenCells();
    fireEvent.click(cellButton("2026walive:qual"));
    await waitFor(() => expect(screen.getByTestId("district-ledger-drawer-cell-plot")).toBeDefined());
    expect(screen.getByTestId("district-ledger-drawer-grand-plot")).toBeDefined();
    expect(screen.getByTestId("district-hist-marked-line")).toBeDefined();
    expect(screen.getByTestId("district-ledger-drawer").textContent).toContain(DISTRICT_LEDGER_DRAWER_LINE_CAPTION);
    await waitFor(() =>
      expect(screen.getByTestId("district-ledger-drawer").textContent).toContain(DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION)
    );
  });

  it("draws NO line and says so instead when the capacity is unpublished", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey))), { dcmpSlots: null }));
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026walive:qual"]')?.getAttribute("data-cell")).toBe("open");
    });
    fireEvent.click(cellButton("2026walive:qual"));
    await waitFor(() => expect(screen.getByTestId("district-ledger-drawer")).toBeDefined());
    expect(screen.queryByTestId("district-hist-marked-line")).toBeNull();
    expect(screen.getByTestId("district-ledger-drawer").textContent).toContain(DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION);
  });

  it("pins the band-edge label to the hand-computable percentiles of the drawn distribution", async () => {
    await renderWithOpenCells();
    fireEvent.click(cellButton("2026walive:qual"));
    const label = await screen.findByTestId("district-ledger-drawer-band-label");
    const text = label.textContent ?? "";
    expect(text.startsWith(RANK_BAND_LABEL_PREFIX)).toBe(true);
    // One decimal, an EN dash, and never the plus-minus codepoint.
    expect(text).toMatch(/^10th–90th: \d+\.\d–\d+\.\d$/);
    expect(screen.getByTestId("district-ledger-drawer").textContent ?? "").not.toContain(PLUS_MINUS);
  });

  it("uses ONE maximum per column, shared down the column, for two different teams' plots", async () => {
    await renderWithOpenCells();
    fireEvent.click(cellButton("2026walive:elim"));
    await waitFor(() => expect(screen.getByTestId("district-ledger-drawer-cell-plot")).toBeDefined());
    const firstMax = screen.getByTestId("district-ledger-drawer-cell-plot").querySelector("[data-plot-max]")!.getAttribute("data-plot-max");

    // Open the SAME column on a DIFFERENT team: the axis maximum is identical,
    // because it comes from `maxEventPoints` and not from either team's data.
    // Every team carries a cell with this id, so the second element is the
    // second team's own Playoffs cell.
    const elimCells = [...document.querySelectorAll('[data-cell-id="2026walive:elim"]')];
    expect(elimCells.length).toBeGreaterThan(1);
    fireEvent.click(within(elimCells[1] as HTMLElement).getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("district-ledger-drawer-cell-plot")).toBeDefined());
    const secondMax = screen.getByTestId("district-ledger-drawer-cell-plot").querySelector("[data-plot-max]")!.getAttribute("data-plot-max");
    expect(secondMax).toBe(firstMax);
  });

  it("opens with NO animation class when a reduced-motion preference is set (the UAT's manual check is the real one)", async () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    await renderWithOpenCells();
    fireEvent.click(cellButton("2026walive:qual"));
    const drawer = await screen.findByTestId("district-ledger-drawer");
    expect(drawer.innerHTML).not.toContain("district-ledger-drawer--animated");
  });

  it("resolves an unknown drawer team or cell id to CLOSED, never to a neighbouring cell", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedgerAt(liveDistrict(), "/districts?algorithm=spr&drawerTeam=999999&drawerCell=2026walive%3Aqual");
    await waitFor(() => expect(screen.getByTestId("district-ledger-tab")).toBeDefined());
    expect(screen.queryAllByTestId("district-ledger-drawer")).toHaveLength(0);
    cleanup();

    renderLedgerAt(liveDistrict(), "/districts?algorithm=spr&drawerTeam=100&drawerCell=never-existed");
    await waitFor(() => expect(screen.getByTestId("district-ledger-tab")).toBeDefined());
    expect(screen.queryAllByTestId("district-ledger-drawer")).toHaveLength(0);
  });

  it("is shareable: a URL naming a real team and open cell opens the drawer on first paint", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedgerAt(liveDistrict(), "/districts?algorithm=spr&drawerTeam=100&drawerCell=2026walive%3Aqual");
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-drawer")).toHaveLength(1));
    expect(screen.getByTestId("district-ledger-drawer").getAttribute("data-drawer-cell")).toBe("2026walive:qual");
  });
});

// ---------------------------------------------------------------------------
// The removal, scoped to the district tier
// ---------------------------------------------------------------------------

describe("DistrictLedger — the old District Locks table is gone from this tier", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("never prints the champ tab's word for the `contending` verdict", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100"), districtTeam("frc101")]));
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row").length).toBe(2));
    expect(document.body.textContent ?? "").not.toContain("Contending");
  });

  it("never uses the champ tab's word for the `eliminated` verdict to MEAN eliminated", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    // 12 slots against 24 teams, so some teams really are eliminated on points.
    renderLedger(
      artifactOf(
        ROSTER.map((teamKey, index) => {
          const base = districtTeam(teamKey);
          const total = 12 + index * 3;
          return { ...base, pointTotal: total, eventPoints: [{ ...base.eventPoints[0]!, qual: total, alliance: 0, elim: 0, award: 0, total }] };
        })
      )
    );
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-status-cell").length).toBe(ROSTER.length));
    // The champ tab renders `eliminated` with the class
    // `lock-status-chip--eliminated`; this tab renders that verdict as "Locked
    // out" under its own modifier, and every element reading "Out of range"
    // carries the OUT-OF-RANGE modifier, which means the median projection.
    expect(document.querySelectorAll(".lock-status-chip--eliminated")).toHaveLength(0);
    for (const element of document.querySelectorAll(".lock-status-chip")) {
      if ((element.textContent ?? "").startsWith(DISTRICT_LEDGER_STATUS_LABELS.outOfRange)) {
        expect(element.className).toContain("lock-status-chip--out-of-range");
      }
    }
  });

  it("renders none of the old District Locks test ids on this tier", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100")]));
    await waitFor(() => expect(screen.getByTestId("district-ledger-tab")).toBeDefined());
    expect(screen.queryByTestId("district-locks-header-stats")).toBeNull();
    expect(screen.queryByTestId("district-district-locks-tab")).toBeNull();
    expect(screen.queryByTestId("district-district-locks-column-toggle")).toBeNull();
    expect(screen.queryByTestId("district-locks-schedule-strip")).toBeNull();
  });

  it("still renders the conservatism caveat, in this tab's own words, plus the grey-is-TBA sentence", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100")]));
    const caveat = await screen.findByTestId("district-ledger-caveat");
    expect(caveat.textContent).toContain(DISTRICT_LEDGER_CAVEAT);
    expect(caveat.textContent).toContain(DISTRICT_LEDGER_PROVENANCE);
  });
});

// ---------------------------------------------------------------------------
// WR-09: a refusal inside a render-path `useMemo` costs this tab, not the page
// ---------------------------------------------------------------------------

describe("the tab's error boundary (WR-09)", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  /**
   * An UNREGISTERED season is the whole-table refusal this boundary exists for:
   * `buildDistrictLedgerRows` and `computeDistrictLedgerStatuses` both open with
   * `maxEventPoints(artifact.year, "district")`, which throws
   * `UnknownDistrictSeasonError` rather than guessing a ceiling. Both calls sit
   * inside a render-path `useMemo`, so before the boundary the throw unmounted
   * the whole route subtree and the Locks page went blank.
   */
  function unregisteredSeasonArtifact(): DistrictArtifact {
    return artifactOf([districtTeam("frc100")], { year: 1999, districtKey: "1999pnw" });
  }

  it("renders the site's ErrorState instead of a blank page when the row build refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(unregisteredSeasonArtifact());

    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeDefined());
    // The tab itself is gone, which is the point: a refusal is contained rather
    // than fabricated around.
    expect(screen.queryByTestId("district-ledger-tab")).toBeNull();
    // Something is on the page. A blank subtree is exactly what this test
    // exists to rule out.
    expect(document.body.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("names the tab in the error copy, so a reader knows WHICH surface refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(unregisteredSeasonArtifact());

    await waitFor(() => expect(screen.getByText(`Couldn't load the ${DISTRICT_LEDGER_TAB_LABEL} tab.`)).toBeDefined());
  });

  it("leaves a registered season rendering the tab exactly as before — the boundary adds no DOM of its own", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100")]));

    await waitFor(() => expect(screen.getByTestId("district-ledger-tab")).toBeDefined());
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The advancement chance (quick task 260925-rpj)
// ---------------------------------------------------------------------------

/**
 * A team whose points are already far enough clear to be Locked, and whose
 * GRAND TOTAL says the same thing: the extra points arrive as a second
 * FINISHED district event rather than as a bare `pointTotal` bump, so the
 * verdict and the run set are reading the same district. A fixture where the
 * two disagreed would still pass the "no chance under a Locked chip" assertion,
 * but it would pass through the gap counter rather than through the property
 * the design rests on.
 */
function lockedTeam(teamKey: string): DistrictTeam {
  const base = withLiveEvent(districtTeam(teamKey));
  return {
    ...base,
    pointTotal: 224,
    eventPoints: [
      ...base.eventPoints,
      { eventKey: "2026wabig", eventName: "Big Event", week: 1, tier: "district", qual: 100, alliance: 50, elim: 30, award: 20, total: 200, state: state() },
    ],
  };
}

/** A finished team nobody's ceiling can fall below: 20 points, against a field whose floors are all 24. */
function lockedOutTeam(teamKey: string): DistrictTeam {
  const base = districtTeam(teamKey);
  return {
    ...base,
    pointTotal: 20,
    eventPoints: [{ eventKey: "2026wadone", eventName: "Done Event", week: 0, tier: "district", qual: 10, alliance: 5, elim: 5, award: 0, total: 20, state: state() }],
  };
}

describe("DistrictLedger — the advancement chance", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  /** The live district, plus one team Locked on points and one Locked out. */
  function mixedDistrict() {
    const teams = ROSTER.map((teamKey) => (teamKey === ROSTER[0] ? lockedTeam(teamKey) : withLiveEvent(districtTeam(teamKey))));
    return artifactOf([...teams, lockedOutTeam("frc900")]);
  }

  async function renderMixed() {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(mixedDistrict());
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-chance").length).toBeGreaterThan(0));
  }

  function statusCellFor(teamKey: string): HTMLElement {
    const row = document.querySelector(`[data-testid="district-ledger-row"][data-team="${teamKey}"]`)!;
    return within(row as HTMLElement).getByTestId("district-ledger-status-cell");
  }

  it("prints one chance line under every In range and Out of range chip and under no other", async () => {
    await renderMixed();
    const cells = [...document.querySelectorAll('[data-testid="district-ledger-status-cell"][data-status]')];
    expect(cells.length).toBeGreaterThan(0);
    let printed = 0;
    for (const cell of cells) {
      const status = cell.getAttribute("data-status")!;
      const lines = within(cell as HTMLElement).queryAllByTestId("district-ledger-chance");
      if (status === "inRange" || status === "outOfRange") {
        expect(lines, `${status} printed ${String(lines.length)} chance lines`).toHaveLength(1);
        printed += 1;
      } else {
        expect(lines, `${status} printed a chance`).toHaveLength(0);
      }
    }
    expect(printed).toBeGreaterThan(0);
  });

  it("prints NOTHING beside the Locked and the Locked out chip, whose verdicts are guarantees", async () => {
    await renderMixed();
    const locked = statusCellFor(ROSTER[0]!);
    expect(locked.getAttribute("data-status")).toBe("locked");
    expect(within(locked).queryByTestId("district-ledger-chance")).toBeNull();

    const lockedOut = statusCellFor("frc900");
    expect(lockedOut.getAttribute("data-status")).toBe("lockedOut");
    expect(within(lockedOut).queryByTestId("district-ledger-chance")).toBeNull();
  });

  it("obeys the two printing limits: never a number under 5, never one above 99, and never the word eliminated", async () => {
    await renderMixed();
    for (const line of screen.getAllByTestId("district-ledger-chance")) {
      const text = line.textContent ?? "";
      expect(text).toMatch(/^(<5% chance|\d{1,2}% chance)$/);
      const percent = /^(\d{1,2})%/.exec(text);
      if (percent !== null) {
        expect(Number(percent[1])).toBeGreaterThanOrEqual(5);
        expect(Number(percent[1])).toBeLessThanOrEqual(99);
      }
    }
    // The shipped caveat legitimately contains the word inside a sentence
    // ("has not been eliminated"), so the rule is asserted where it binds: on
    // the chance lines themselves, which never carry it and never read 100.
    const everyLine = screen.getAllByTestId("district-ledger-chance").map((line) => line.textContent ?? "").join(" ");
    expect(everyLine).not.toContain("eliminated");
    expect(everyLine).not.toContain("100%");
  });

  it("prints no chance and constructs NO Worker at all on a finished district (SC-5)", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => districtTeam(teamKey))));
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row").length).toBeGreaterThan(0));
    expect(screen.queryAllByTestId("district-ledger-chance")).toHaveLength(0);
    expect(handle.instances).toHaveLength(0);
  });

  it("prints no chance when TBA published no capacity for the district", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey))), { dcmpSlots: null }));
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026walive:qual"]')?.getAttribute("data-cell")).toBe("open");
    });
    expect(instancesReceiving(handle, "chance")).toHaveLength(0);
    expect(screen.queryAllByTestId("district-ledger-chance")).toHaveLength(0);
  });

  it("prints no chance when the browser cannot construct a Worker at all", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ failOnConstruct: new Error("Worker is not defined") });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))));
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row").length).toBeGreaterThan(0));
    expect(screen.queryAllByTestId("district-ledger-chance")).toHaveLength(0);
  });

  it("recomputes the chance at a REWOUND position, against the race the slider reopened", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    // The plain live district here rather than `mixedDistrict()`: at
    // season start every started event is reopened, so every team needs a
    // distribution at every one of its events, and the stand-in team frc900 is
    // deliberately absent from the served event roster. That absence is the
    // refusal `districtLedgerChances.test.ts` pins; this test is about the
    // rewind, so it uses a district the fetch mock can price in full.
    renderLedgerAt(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))), "/districts?algorithm=spr&at=season-start");
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-chance").length).toBeGreaterThan(0));

    for (const line of screen.getAllByTestId("district-ledger-chance")) {
      expect(line.textContent ?? "").toMatch(/^(<5% chance|\d{1,2}% chance)$/);
    }
    const request = instancesReceiving(handle, "chance").at(-1)!.received[0] as { inputs: { teams: unknown[] } };
    expect(request.inputs.teams).toHaveLength(ROSTER.length);
  });

  it("ranks the whole district, including the teams whose own chip prints nothing", async () => {
    await renderMixed();
    const request = instancesReceiving(handle!, "chance")[0]!.received[0] as { inputs: { teams: { teamKey: string }[] } };
    expect(request.inputs.teams.map((team) => team.teamKey)).toContain("frc900");
    expect(request.inputs.teams).toHaveLength(ROSTER.length + 1);
  });
});

// ---------------------------------------------------------------------------
// The playoff headline as the bracket advances (quick task 260925-uf8)
// ---------------------------------------------------------------------------

describe("DistrictLedger — the playoff milestone advances with the bracket", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  /**
   * The Playoffs cell's rendered text for one team, whitespace and all.
   *
   * Across ALL of that team's rows, not just the first: every team here plays two
   * district events, so the finished one's row comes first and carries no playoff
   * cell for the live one.
   */
  function elimTextFor(teamKey: string): string {
    for (const row of document.querySelectorAll(`[data-team="${teamKey}"]`)) {
      const cell = row.querySelector('[data-cell-id="2026waplay:elim"]');
      if (cell !== null) return cell.textContent ?? "";
    }
    return "";
  }

  async function renderPlayoffs() {
    installFetch({ eventArtifact: playoffEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withPlayoffEvent(districtTeam(teamKey)))));
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026waplay:elim"]')?.getAttribute("data-cell")).toBe("open");
    });
    // The whole roster's playoff cells are open before anything is asserted, so
    // a still-loading cell can never pass for a milestone.
    await waitFor(() => {
      expect(elimTextFor(allianceRoster(1)[0]!)).not.toBe("");
    });
  }

  it("asks about the FINALIST for an alliance that has secured a top-four finish", async () => {
    await renderPlayoffs();
    for (const teamKey of allianceRoster(1)) {
      expect(elimTextFor(teamKey), teamKey).toMatch(/^finalist ~\d+%(~\d+ if finalist)?$/);
    }
  });

  it("still asks about the TOP FOUR for an alliance that is alive but has not secured one", async () => {
    await renderPlayoffs();
    // Alliance 4 lost sf7 and drops to sf9, whose loser is fifth and pays
    // nothing, so nothing is secured.
    for (const teamKey of allianceRoster(4)) {
      expect(elimTextFor(teamKey), teamKey).toMatch(/^top 4 ~\d+%(~\d+ if top 4)?$/);
    }
  });

  it("prints the PLACEMENT for an alliance the bracket has already decided, with no chance beside it", async () => {
    await renderPlayoffs();
    // Alliance 5 lost sf2 and then sf5: out at seventh, which pays nothing.
    for (const teamKey of allianceRoster(5)) {
      expect(elimTextFor(teamKey), teamKey).toBe("~07th place");
    }
    // Alliance 6 lost sf4 and then sf6: out at eighth.
    for (const teamKey of allianceRoster(6)) {
      expect(elimTextFor(teamKey), teamKey).toBe("~08th place");
    }
  });

  it("gives a secured alliance NO mass below fourth place, so the headline and the histogram agree", async () => {
    await renderPlayoffs();
    // The chance of a top-four finish is settled at 1 for alliance 1, which is
    // exactly why the cell has stopped asking about it.
    const text = elimTextFor(allianceRoster(1)[0]!);
    expect(text).not.toContain("top 4");
    expect(text).not.toContain("~100%");
  });

  it("leaves the other three categories' wording exactly as it was", async () => {
    await renderPlayoffs();
    // The award cell on the SAME live event, found across that team's rows the
    // same way the playoff cell is.
    let award: Element | null = null;
    for (const row of document.querySelectorAll(`[data-team="${allianceRoster(1)[0]!}"]`)) {
      award = row.querySelector('[data-cell-id="2026waplay:award"]') ?? award;
    }
    expect(award?.textContent ?? "").toMatch(/^~\d+% award(~\d+ if won)?$/);
  });
});
