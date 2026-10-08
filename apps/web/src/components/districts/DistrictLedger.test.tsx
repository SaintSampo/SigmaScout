/**
 * `DistrictLedger`'s component coverage — the tracer's end-to-end proof.
 *
 * The Team cells are real router `Link`s, so every render needs a router
 * context whose tree carries a `to="/team/$teamNumber"` route: the same
 * self-contained-tree `TestHarness` technique `ChampLocksLedger.test.tsx`
 * shares, plus a `QueryClientProvider` because this tab fetches event
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
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { installMockWorker, type MockWorkerHandle, type MockWorkerScript } from "../../test/mockWorker.js";
import { runDistrictWorkerJob } from "../../workers/districtSimulationProtocol.js";
import { runAsOfEvent } from "../../workers/districtAsOfJob.js";
import { DistrictLedger } from "./DistrictLedger.js";
import { TEAM_CELL_CLASS } from "./LedgerParts.js";
import { DISTRICT_MILESTONE_KEYS } from "./districtMilestones.js";
import { asOfBodyFor, buildAsOfTestObjects } from "./asOfTestFixtures.js";
import {
  CHAMP_LEDGER_NO_CALL_REASONS,
  DISTRICT_LEDGER_AWARD_OUTCOME_LABELS,
  DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED,
  DISTRICT_LEDGER_CAVEAT,
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_CUTOFF_LABELS,
  DISTRICT_LEDGER_DECLINED_LABEL,
  DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_LEGEND_EARNED,
  DISTRICT_LEDGER_LEGEND_EXPLAINER,
  DISTRICT_LEDGER_LEGEND_OPEN,
  DISTRICT_LEDGER_LIKELY_PREFIX,
  DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
  DISTRICT_LEDGER_NO_MATCHES,
  DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS,
  DISTRICT_LEDGER_PROVENANCE,
  DISTRICT_LEDGER_SEARCH_LABEL,
  DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_LABELS,
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
  /** Event keys whose event artifact 404s even when `eventArtifact` is set: an artifact not published yet. */
  readonly missingEventKeys?: readonly string[];
  /** The events the served artifact stands in for, whose as-of objects are published. Defaults to the artifact's own key. */
  readonly asOfEventKeys?: readonly string[];
}

function installFetch(options: FetchOptions = {}) {
  // The as-of objects a rewound stop reads (quick task 261005-5g0), folded from
  // the served event artifact, so a rewound test sees what production publishes.
  const asOf =
    options.eventArtifact === undefined
      ? undefined
      : buildAsOfTestObjects({
          season: SEASON,
          version: ALGORITHM_VERSION,
          eventArtifacts: (options.asOfEventKeys ?? [options.eventArtifact.eventKey]).map((eventKey) => ({ ...options.eventArtifact!, eventKey })),
          extraTeams: ROSTER,
        });
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v1/manifest/algorithms.json")) return Promise.resolve(new Response(JSON.stringify(manifestBody()), { status: 200 }));
    if (url.includes("/v1/asof")) {
      const body = asOfBodyFor(asOf, url);
      return Promise.resolve(body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 }));
    }
    if (url.includes("/v1/district-presim/")) {
      if (options.preSim === undefined) return Promise.resolve(new Response("", { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify(options.preSim), { status: 200 }));
    }
    if (url.includes("/v1/event/")) {
      if (options.missingEventKeys?.some((eventKey) => url.includes(`/v1/event/${eventKey}/`)) === true) {
        return Promise.resolve(new Response("", { status: 404 }));
      }
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
  runDistrictWorkerJob(message, (outbound) => ctx.post(outbound), runAsOfEvent);
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
    // While the event artifact loads and the run is pending the cell reads
    // "pending" (todo locks-loading-cells-read-not-available, quick task
    // 261007-4qr); once the Worker construction fails the run is not pending
    // and the cell settles on the unavailable copy, which is what this case is
    // about. So wait for the settled cell, not merely for the cell to exist.
    const qual = await waitFor(() => {
      const found = document.querySelector('[data-cell-id="2026walive:qual"]');
      expect(found).not.toBeNull();
      expect(found!.getAttribute("data-cell")).toBe("unavailable");
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

  it("prints a SETTLED cutoff with no tilde and no range where every team is done", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100"), districtTeam("frc101")], { dcmpSlots: 1 }));

    const statLine = await screen.findByTestId("district-ledger-stat-line");
    // Both teams are finished, so the pool is settled: the word `predicted`
    // never appears and neither does a tilde or a range.
    expect(statLine.textContent).toContain(DISTRICT_LEDGER_CUTOFF_LABELS.settled);
    expect(statLine.textContent).not.toContain("Predicted");
    expect(statLine.textContent).not.toContain("~");
    expect(within(statLine).queryByTestId("district-ledger-cutoff-likely")).toBeNull();
    // The district tab NEVER carries the champ tab's district only variant.
    expect(statLine.textContent).not.toContain(DISTRICT_LEDGER_CUTOFF_LABELS.predictedDistrictOnly);
  });

  it("reports the cutoff as absent, with no range, for an unpublished capacity", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100")], { dcmpSlots: null }));
    const unknownLine = await screen.findByTestId("district-ledger-stat-line");
    expect(unknownLine.textContent).toContain(DISTRICT_LEDGER_CUTOFF_LABELS.capacityUnknown);
    expect(within(unknownLine).queryByTestId("district-ledger-cutoff-likely")).toBeNull();
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
// The championship field on the Live view (quick task 261005-04t, D-06)
// ---------------------------------------------------------------------------

const CHAMPIONSHIP_KEY = "2026wacmp";

/** One finished district event row, every point in qualification. */
function doneDistrictRow(total: number) {
  return { eventKey: "2026wadone", eventName: "Done Event", week: 0, tier: "district" as const, qual: total, alliance: 0, elim: 0, award: 0, total, state: state() };
}

/** One finished District Championship row: the team played it. */
function championshipRow(qual: number) {
  return { eventKey: CHAMPIONSHIP_KEY, eventName: "District Championship", week: 5, tier: "dcmp" as const, qual, alliance: 0, elim: 0, award: 0, total: qual, state: state() };
}

/**
 * A finished district whose championship has been played. Two slots: frc100
 * and frc101 earn them on district points, the other three cannot.
 *
 * frc100 plays the championship. frc101 plays it only when `everyEarnedPlacePlays`;
 * otherwise it carries no championship row and is the Declined team. frc102 is
 * a late entry from below the line and plays it.
 */
function fieldDistrict(everyEarnedPlacePlays: boolean): DistrictArtifact {
  const team = (teamKey: string, district: number, championship: number | undefined) =>
    districtTeam(teamKey, {
      pointTotal: district + (championship ?? 0),
      eventPoints: championship === undefined ? [doneDistrictRow(district)] : [doneDistrictRow(district), championshipRow(championship)],
    });
  return artifactOf(
    [
      team("frc100", 100, 20),
      team("frc101", 90, everyEarnedPlacePlays ? 15 : undefined),
      team("frc102", 10, 5),
      team("frc103", 5, undefined),
      team("frc104", 3, undefined),
    ],
    { dcmpSlots: 2 }
  );
}

describe("DistrictLedger — the championship field on the Live view (261005-04t)", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  const chips = () => screen.getAllByTestId("district-ledger-status-chip");
  const chip = (status: string) => chips().find((element) => element.getAttribute("data-status") === status);
  const statusCellOf = (teamKey: string) =>
    document.querySelector(`[data-testid="district-ledger-row"][data-team="${teamKey}"] [data-testid="district-ledger-status-cell"]`);

  it("C1: at Live, four chips with Declined between Locked and Locked out and no range chips, the field's definitions, and a Declined team that prints no chance", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(fieldDistrict(false));

    await waitFor(() => expect(chips()).toHaveLength(4));
    expect(chips().map((element) => element.getAttribute("data-status"))).toEqual(["prequalified", "locked", "declined", "lockedOut"]);
    // The field reads every team as Locked, Declined or Locked out, so In range
    // and Out of range would both print 0: neither chip nor its line is drawn.
    expect(chip("inRange")).toBeUndefined();
    expect(chip("outOfRange")).toBeUndefined();
    expect(chip("declined")!.textContent).toBe(`${DISTRICT_LEDGER_DECLINED_LABEL} 1`);
    expect(chip("locked")!.textContent).toBe(`${DISTRICT_LEDGER_STATUS_LABELS.locked} 2`);
    expect(chip("lockedOut")!.textContent).toBe(`${DISTRICT_LEDGER_STATUS_LABELS.lockedOut} 2`);
    expect(chip("declined")!.querySelector(".lock-status-chip--declined")).not.toBeNull();

    const definitions = screen.getByTestId("district-ledger-status-definitions").textContent ?? "";
    expect(definitions).toContain(`${DISTRICT_LEDGER_DECLINED_LABEL} ${DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.declined}`);
    expect(definitions).toContain(`${DISTRICT_LEDGER_STATUS_LABELS.locked} ${DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.locked}`);
    expect(definitions).toContain(`${DISTRICT_LEDGER_STATUS_LABELS.lockedOut} ${DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.lockedOut}`);
    expect(definitions).not.toContain(DISTRICT_LEDGER_STATUS_DEFINITIONS.locked);
    expect(definitions).not.toContain(DISTRICT_LEDGER_STATUS_DEFINITIONS.lockedOut);
    expect(definitions).not.toContain(DISTRICT_LEDGER_STATUS_LABELS.inRange);
    expect(definitions).not.toContain(DISTRICT_LEDGER_STATUS_LABELS.outOfRange);
    // The Declined chip is described by its own definition line.
    const describedBy = chip("declined")!.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy!)?.textContent).toBe(`${DISTRICT_LEDGER_DECLINED_LABEL} ${DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.declined}`);

    const declinedCell = statusCellOf("frc101")!;
    expect(declinedCell.getAttribute("data-status")).toBe("declined");
    expect(declinedCell.querySelector(".lock-status-chip--declined")).not.toBeNull();
    expect(declinedCell.textContent).toBe(DISTRICT_LEDGER_DECLINED_LABEL);
    expect(within(declinedCell as HTMLElement).queryByTestId("district-ledger-chance")).toBeNull();
    // The late entry from below the line is in the field, so it reads Locked.
    expect(statusCellOf("frc102")?.getAttribute("data-status")).toBe("locked");

    // The Declined chip filters like the other three.
    expect(screen.getAllByTestId("district-ledger-row")).toHaveLength(5);
    fireEvent.click(chip("declined")!);
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row")).toHaveLength(4));
    expect(statusCellOf("frc101")).toBeNull();
    expect(chip("declined")!.getAttribute("aria-pressed")).toBe("false");
    expect(chip("declined")!.textContent).toBe(`${DISTRICT_LEDGER_DECLINED_LABEL} 1`);
    fireEvent.click(chip("declined")!);
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-row")).toHaveLength(5));
    expect(statusCellOf("frc101")).not.toBeNull();
  });

  it("C2: the same district rewound to Season start shows five chips, no Declined chip and no field definitions", async () => {
    installFetch({ eventArtifact: doneEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedgerAt(fieldDistrict(false), "/districts?algorithm=spr&at=season-start");

    await waitFor(() => expect(screen.getByTestId("locks-picker-season-start").getAttribute("aria-pressed")).toBe("true"));
    await waitFor(() => expect(chips()).toHaveLength(5));
    expect(chips().map((element) => element.getAttribute("data-status"))).toEqual(["prequalified", "locked", "inRange", "outOfRange", "lockedOut"]);
    expect(chip("declined")).toBeUndefined();
    const definitions = screen.getByTestId("district-ledger-status-definitions").textContent ?? "";
    expect(definitions).not.toContain(DISTRICT_LEDGER_DECLINED_LABEL);
    expect(definitions).not.toContain(DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.declined);
    expect(definitions).not.toContain(DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.locked);
    expect(definitions).not.toContain(DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.lockedOut);
    // The base set's Locked and Locked out, which the simulated set shares.
    expect(definitions).toContain(DISTRICT_LEDGER_STATUS_DEFINITIONS.locked);
    expect(definitions).toContain(DISTRICT_LEDGER_STATUS_DEFINITIONS.lockedOut);
    expect(document.querySelectorAll('[data-testid="district-ledger-status-cell"][data-status="declined"]')).toHaveLength(0);
  });

  it("C3: a started championship where every team that earned a place plays it: three chips, no Declined and no range chips, the field's Locked and Locked out", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(fieldDistrict(true));

    await waitFor(() => expect(chips()).toHaveLength(3));
    expect(chips().map((element) => element.getAttribute("data-status"))).toEqual(["prequalified", "locked", "lockedOut"]);
    expect(chip("declined")).toBeUndefined();
    expect(chip("locked")!.textContent).toBe(`${DISTRICT_LEDGER_STATUS_LABELS.locked} 3`);
    expect(chip("lockedOut")!.textContent).toBe(`${DISTRICT_LEDGER_STATUS_LABELS.lockedOut} 2`);
    const definitions = screen.getByTestId("district-ledger-status-definitions").textContent ?? "";
    expect(definitions).not.toContain(DISTRICT_LEDGER_DECLINED_LABEL);
    expect(definitions).toContain(`${DISTRICT_LEDGER_STATUS_LABELS.locked} ${DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.locked}`);
    expect(definitions).toContain(`${DISTRICT_LEDGER_STATUS_LABELS.lockedOut} ${DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.lockedOut}`);
  });

  it("C4: the Declined chip is drawn by the Out of range rule itself, sharing one declaration block", () => {
    // `core.autocrlf` is true on this machine, so a checkout can carry CRLF.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "theme.css"), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((match) => match[1]!.split(",").map((selector) => selector.trim()));
    const declined = selectors.filter((list) => list.includes(".lock-status-chip--declined"));
    expect(declined).toHaveLength(1);
    expect(declined[0]).toContain(".lock-status-chip--out-of-range");
    expect(selectors.filter((list) => list.some((selector) => selector.includes("lock-status-chip--declined")))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The milestone picker (SC-4)
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

/**
 * The finished event's artifact with its bracket: the eight alliances of
 * `playoffEventArtifact` and its seven played sf rows (Round 1 and three of
 * Round 2), after the last qualification row. For the round stops (261007-3g2).
 */
function doneBracketEventArtifact(): EventArtifact {
  const done = doneEventArtifact();
  const sf = PLAYOFF_ELIM_WINNERS.map((row) => ({
    matchKey: `2026wadone_sf${String(row.setNumber)}m1`,
    compLevel: "sf" as const,
    setNumber: row.setNumber,
    matchNumber: 1,
    sortTime: 1_770_000_000 + row.setNumber * 600,
    redTeams: allianceRoster(row.red),
    blueTeams: allianceRoster(row.blue),
    predictedWinner: "red" as const,
    pRedWin: 0.5,
    predictedRedScore: 100,
    predictedBlueScore: 100,
    actualWinner: row.winner === row.red ? ("red" as const) : ("blue" as const),
    actualRedScore: row.winner === row.red ? 110 : 90,
    actualBlueScore: row.winner === row.red ? 90 : 110,
  }));
  return EventArtifactSchema.parse({ ...done, matches: [...done.matches, ...sf], alliances: PLAYOFF_ALLIANCES });
}

function renderLedgerAt(artifact: DistrictArtifact, initialEntry: string) {
  render(
    <TestHarness initialEntry={initialEntry}>
      <DistrictLedger artifact={artifact} algorithm="spr" season={SEASON} />
    </TestHarness>
  );
}

describe("DistrictLedger — the milestone picker", () => {
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

  /** The picker's thirteen stops, in render order. */
  const stops = () => [...within(screen.getByTestId("district-ledger-rewind")).getAllByRole("button")].filter((button) => button.hasAttribute("data-milestone"));
  const stop = (key: string) => screen.getByTestId("district-ledger-rewind").querySelector(`[data-milestone="${key}"]`)!;

  it("renders the milestone picker at now: thirteen stops in order, Live pressed, and nothing after it", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(finishedDistrict());

    await waitFor(() => expect(screen.getByTestId("district-ledger-rewind")).toBeDefined());
    expect(stops().map((button) => button.getAttribute("data-milestone"))).toEqual([...DISTRICT_MILESTONE_KEYS]);
    expect(stops()).toHaveLength(13);
    // A finished event: every stop has happened, so every stop is solid and clickable.
    for (const button of stops()) expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("locks-picker-live").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("locks-picker-season-start").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("locks-picker-next-text").textContent).toBe("This is live");
    expect((screen.getByTestId("locks-picker-event") as HTMLSelectElement).value).toBe("2026wadone");
    // No range input survives anywhere in the tab.
    expect(document.querySelector('input[type="range"]')).toBeNull();
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

  it("presses the Season start pill and a clicked stop, each through the URL", async () => {
    installFetch({ eventArtifact: doneEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(finishedDistrict());

    const seasonStart = await waitFor(() => screen.getByTestId("locks-picker-season-start"));
    expect(seasonStart.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(seasonStart);
    await waitFor(() => expect(screen.getByTestId("locks-picker-season-start").getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByTestId("locks-picker-live").getAttribute("aria-pressed")).toBe("false");

    // The picker keeps no selection of its own, so a pressed stop after a click
    // proves the id went into `?at=` and came back out.
    fireEvent.click(stop("playoffs"));
    await waitFor(() => expect(stop("playoffs").getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByTestId("locks-picker-season-start").getAttribute("aria-pressed")).toBe("false");
  });

  it("starts at the milestone a URL names, and at Live for an unknown step id with no error state", async () => {
    installFetch({ eventArtifact: doneEventArtifact() });
    handle = installMockWorker({ script: realRunScript });

    renderLedgerAt(finishedDistrict(), "/districts?algorithm=spr&at=2026wadone%3Aalliance");
    await waitFor(() => expect(stop("alliance").getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByTestId("locks-picker-live").getAttribute("aria-pressed")).toBe("false");
    cleanup();

    renderLedgerAt(finishedDistrict(), "/districts?algorithm=spr&at=a-step-that-never-existed");
    await waitFor(() => expect(screen.getByTestId("locks-picker-live").getAttribute("aria-pressed")).toBe("true"));
    expect(stops().some((button) => button.getAttribute("aria-pressed") === "true")).toBe(false);
    expect(screen.getByTestId("district-ledger-tab")).toBeDefined();
  });

  it("presses Round 1 at ?at=<event>:round:1 once the artifact loads, leaves the event's Playoffs cell open, and conditions the run on Round 1's sets (261007-3g2)", async () => {
    installFetch({ eventArtifact: doneBracketEventArtifact() });
    handle = installMockWorker({ script: realRunScript });

    renderLedgerAt(finishedDistrict(), "/districts?algorithm=spr&at=2026wadone%3Around%3A1");
    await waitFor(() => expect(stop("round1").getAttribute("aria-pressed")).toBe("true"));
    expect(stops().filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026wadone:elim"]')?.getAttribute("data-cell")).toBe("open");
    });
    await waitFor(() => expect(instancesReceiving(handle!, "run").length).toBeGreaterThan(0));
    const runs = instancesReceiving(handle, "run");
    type RunRequest = { type: string; events: { eventKey: string; input: { playedElimMatches?: { setNumber: number }[] } }[] };
    const request = runs[runs.length - 1]!.received.find((message) => (message as { type?: string }).type === "run") as RunRequest;
    expect(request.events.map((event) => event.eventKey)).toEqual(["2026wadone"]);
    expect(request.events[0]!.input.playedElimMatches?.map((match) => match.setNumber)).toEqual([1, 2, 3, 4]);
  });

  it("round trips a Schedule link through its alias: Schedule pressed, and the event's qualification reopens once its artifact loads", async () => {
    installFetch({ eventArtifact: doneEventArtifact() });
    handle = installMockWorker({ script: realRunScript });

    renderLedgerAt(finishedDistrict(), "/districts?algorithm=spr&at=2026wadone%3Aschedule");
    await waitFor(() => expect(stop("schedule").getAttribute("aria-pressed")).toBe("true"));
    expect((screen.getByTestId("locks-picker-event") as HTMLSelectElement).value).toBe("2026wadone");
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026wadone:qual"]')?.getAttribute("data-cell")).toBe("open");
    });
    expect(stop("schedule").getAttribute("aria-pressed")).toBe("true");
  });

  it("constructs a Worker when the picker moves into a finished event, even though the now position constructs none", async () => {
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

/**
 * The verdict pane's readers (sketch 025 variant A, quick task 261006-lxp).
 * The grand total headline is one of these sentences, and nothing else.
 */
const GRAND_HEADLINE =
  /^(Qualifies in (\d+|fewer than 5) of 100 runs\.|Already qualified\.|Cannot qualify on points\.|Chance still being simulated\.|No call at this position\.|Likely \d+–\d+ grand total points\.)$/;

function verdictHeadline(drawer: HTMLElement): string {
  return within(drawer).getByTestId("district-ledger-verdict-headline").textContent ?? "";
}

function verdictTiles(drawer: HTMLElement): { key: string | null; value: string }[] {
  return within(drawer)
    .queryAllByTestId("district-ledger-verdict-tile")
    .map((tile) => ({ key: tile.getAttribute("data-tile"), value: tile.querySelector(".district-ledger-verdict__tile-value")?.textContent ?? "" }));
}

function verdictTile(drawer: HTMLElement, key: string): string | undefined {
  return verdictTiles(drawer).find((tile) => tile.key === key)?.value;
}

/** The stat line's own figure: the bold value beside its label. */
function statLineFigure(): string {
  return screen.getByTestId("district-ledger-stat-line").querySelector("b")?.textContent ?? "";
}

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

  /** The clicked button's team: its key, and the number and nickname its Team cell prints. */
  function teamOfButton(button: HTMLElement): { teamKey: string; number: string; nickname: string } {
    const teamKey = button.closest("tr")!.getAttribute("data-team")!;
    const firstRow = document.querySelector(`[data-testid="district-ledger-row"][data-team="${teamKey}"]`)!;
    return {
      teamKey,
      number: firstRow.querySelector(".district-ledger-team-number")?.textContent ?? "",
      nickname: firstRow.querySelector(".district-ledger-team-name")?.textContent ?? "",
    };
  }

  /** One team's grand total button. */
  function grandButtonOf(teamKey: string): HTMLElement {
    return document.querySelector(`[data-testid="district-ledger-row"][data-team="${teamKey}"] button[data-cell-id="grand"]`) as HTMLElement;
  }

  it("prints a PREDICTED cutoff with a tilde where something is still open, and the same number on the dashed rule", async () => {
    await renderWithOpenCells();
    const statLine = await screen.findByTestId("district-ledger-stat-line");
    // The figure is the median of the SIMULATED line (quick task 261004-uw4),
    // so it arrives with the chance run: 1,000 draws on the mock Worker.
    await waitFor(() => expect(statLine.textContent).toMatch(/~\d+/), { timeout: 15_000 });
    expect(statLine.textContent).toContain(DISTRICT_LEDGER_CUTOFF_LABELS.predicted);
    const printed = Number(/~(\d+)/.exec(statLine.textContent ?? "")![1]!);

    // THE FIGURE SITS INSIDE THE RANGE PRINTED BESIDE IT, because both come
    // from one call over one set of runs. Before this task the figure was the
    // midpoint of two medians and could sit below its own range.
    const likely = within(statLine).queryByTestId("district-ledger-cutoff-likely");
    if (likely !== null) {
      const ends = /(\d+)–(\d+)/.exec(likely.textContent ?? "");
      expect(ends, `the likely range reads "${likely.textContent ?? ""}"`).not.toBeNull();
      expect(Number(ends![1])).toBeLessThanOrEqual(printed);
      expect(printed).toBeLessThanOrEqual(Number(ends![2]));
    }

    // THE SAME VALUE ON BOTH SURFACES, which is the whole point of the one
    // memo: the dashed rule's own label is the stat line's label, and the
    // histogram's marked position is the stat line's number.
    fireEvent.click(cellButton("grand"));
    const drawer = await screen.findByTestId("district-ledger-drawer");
    expect(within(drawer).getByTestId("district-hist-marked-line")).toBeDefined();
    // The dashed rule's own label and the cutoff tile carry the stat line's
    // figure, character for character, and no caption explains them.
    expect(within(drawer).getByTestId("district-hist-cutoff-label").textContent).toBe(`cutoff ~${String(printed)}`);
    expect(verdictTile(drawer, "cutoff")).toBe(`~${String(printed)}`);
    expect(drawer.textContent ?? "").not.toContain("The dashed line");
    expect(printed).toBeGreaterThan(0);
  });

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

  it("draws ONE chart for a qualification cell, headed by its likely range or its cap, with the median and likely tiles", async () => {
    await renderWithOpenCells();
    const button = cellButton("2026walive:qual");
    const team = teamOfButton(button);
    fireEvent.click(button);
    const drawer = await screen.findByTestId("district-ledger-drawer");
    expect(within(drawer).getAllByTestId("district-ledger-drawer-cell-plot")).toHaveLength(1);
    expect(within(drawer).queryByTestId("district-ledger-drawer-grand-plot")).toBeNull();
    expect(verdictHeadline(drawer)).toMatch(/^(Likely \d+–\d+ qualification points\.|Finishes quals at the \d+ point cap in \d+ of 100 runs\.)$/);
    expect(verdictTiles(drawer).map((tile) => tile.key)).toEqual(["median", "likely"]);
    expect(verdictTile(drawer, "median")).toMatch(/^~\d+$/);
    expect(verdictTile(drawer, "likely")).toMatch(/^\d+–\d+$/);
    expect(verdictTile(drawer, "cutoff")).toBeUndefined();
    expect(within(drawer).getByTestId("district-ledger-verdict-eyebrow").textContent).toBe(`Qualification at Live Event · ${team.number} ${team.nickname}`);
    expect(within(drawer).getByTestId("district-hist-cap").textContent).toMatch(/^\d+ cap$/);
    expect(within(drawer).queryByTestId("district-ledger-verdict-source")).toBeNull();
    // The table cell itself still prints its one decimal likely line.
    expect(cellButton("2026walive:qual").textContent ?? "").toMatch(/likely \d+\.\d–\d+\.\d/);
  });

  it("draws NO cutoff on the grand total and says so on its tile when the capacity is unpublished", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey))), { dcmpSlots: null }));
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026walive:qual"]')?.getAttribute("data-cell")).toBe("open");
    });
    fireEvent.click(cellButton("grand"));
    const drawer = await screen.findByTestId("district-ledger-drawer");
    expect(within(drawer).getByTestId("district-ledger-drawer-grand-plot")).toBeDefined();
    expect(within(drawer).queryByTestId("district-hist-marked-line")).toBeNull();
    expect(verdictTile(drawer, "cutoff")).toBe("not published");
    expect(verdictHeadline(drawer)).toMatch(/^Likely \d+–\d+ grand total points\.$/);
  });

  it("pins the likely and median tiles to whole numbers that round the cell's own one decimal line", async () => {
    await renderWithOpenCells();
    const small = cellButton("2026walive:qual").textContent ?? "";
    const ends = /likely (\d+\.\d)–(\d+\.\d)/.exec(small);
    expect(ends, `the qualification cell reads "${small}"`).not.toBeNull();
    fireEvent.click(cellButton("2026walive:qual"));
    const drawer = await screen.findByTestId("district-ledger-drawer");
    const likely = /^(\d+)–(\d+)$/.exec(verdictTile(drawer, "likely") ?? "");
    expect(likely, "an en dash between two whole numbers").not.toBeNull();
    // The same percentiles at two precisions: within rounding of each other.
    expect(Math.abs(Number(likely![1]) - Number(ends![1]))).toBeLessThanOrEqual(0.55);
    expect(Math.abs(Number(likely![2]) - Number(ends![2]))).toBeLessThanOrEqual(0.55);
    expect(verdictTile(drawer, "median")).toMatch(/^~\d+$/);
    expect(drawer.textContent ?? "").not.toContain(PLUS_MINUS);
  });

  it("uses ONE maximum per column, shared down the column, for two different teams' plots", async () => {
    // QUALIFICATION rather than Playoffs: since 260925-uf8 the Playoffs and
    // Awards drawers render an OUTCOME LIST instead of a plot, so they have no
    // axis to share. Qualification is one of the three that still plots, and the
    // property under test — the maximum comes from `maxEventPoints` and not from
    // either team's data — is the same property on either column.
    await renderWithOpenCells();
    fireEvent.click(cellButton("2026walive:qual"));
    await waitFor(() => expect(screen.getByTestId("district-ledger-drawer-cell-plot")).toBeDefined());
    const firstMax = screen.getByTestId("district-ledger-drawer-cell-plot").querySelector("[data-plot-max]")!.getAttribute("data-plot-max");

    // Open the SAME column on a DIFFERENT team: the axis maximum is identical.
    // Every team carries a cell with this id, so the second element is the
    // second team's own Qualification cell.
    const qualCells = [...document.querySelectorAll('[data-cell-id="2026walive:qual"]')];
    expect(qualCells.length).toBeGreaterThan(1);
    fireEvent.click(within(qualCells[1] as HTMLElement).getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("district-ledger-drawer-cell-plot")).toBeDefined());
    const secondMax = screen.getByTestId("district-ledger-drawer-cell-plot").querySelector("[data-plot-max]")!.getAttribute("data-plot-max");
    expect(secondMax).toBe(firstMax);
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

  // -------------------------------------------------------------------------
  // The outcome lists and the grand total pane (quick task 260925-uf8)
  // -------------------------------------------------------------------------

  it("renders an OUTCOME LIST and no histogram for the Playoffs cell", async () => {
    await renderWithOpenCells();
    fireEvent.click(cellButton("2026walive:elim"));
    const list = await screen.findByTestId("district-ledger-drawer-outcomes");
    expect(screen.queryByTestId("district-ledger-drawer-cell-plot")).toBeNull();
    // Every playoff outcome that pays points, ordered by points descending; the
    // implicit "Out before the top four" row is not listed (261007-3ik).
    const rows = within(list).getAllByTestId("district-ledger-outcome-row");
    expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual(["winner", "finalist", "third", "fourth"]);
    expect(list.textContent ?? "").toContain(DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS.winner);
    expect(list.textContent ?? "").not.toContain(DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS.none);
  });

  it("prints each playoff outcome's own point value, from the placement table and not from the axis", async () => {
    await renderWithOpenCells();
    fireEvent.click(cellButton("2026walive:elim"));
    const list = await screen.findByTestId("district-ledger-drawer-outcomes");
    const pointsOf = (outcome: string): string =>
      list.querySelector(`[data-outcome="${outcome}"] .district-ledger-verdict-outcomes__points`)?.textContent ?? "";
    expect(pointsOf("winner")).toBe("30 pts");
    expect(pointsOf("finalist")).toBe("20 pts");
    expect(pointsOf("third")).toBe("13 pts");
    expect(pointsOf("fourth")).toBe("7 pts");
    expect(list.querySelector('[data-outcome="none"]')).toBeNull();
  });

  it("renders an OUTCOME LIST for the Awards cell, and omits Rookie All Star for a veteran", async () => {
    await renderWithOpenCells();
    fireEvent.click(cellButton("2026walive:award"));
    const list = await screen.findByTestId("district-ledger-drawer-outcomes");
    expect(screen.queryByTestId("district-ledger-drawer-cell-plot")).toBeNull();
    const rows = within(list).getAllByTestId("district-ledger-outcome-row");
    // The fixture's teams are veterans, so Rookie All Star is not an outcome,
    // and the implicit "No award" row is not listed (261007-3ik).
    expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual(["impact", "judged"]);
    expect(list.textContent ?? "").not.toContain(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS.rookieAllStar);
    expect(list.textContent ?? "").not.toContain(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS.none);
  });

  it("lists Rookie All Star for a ROOKIE, at its own point value", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(
      artifactOf(
        ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey, { awardProfile: { bucket: "none", rookie: true } })))
      )
    );
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026walive:award"]')?.getAttribute("data-cell")).toBe("open");
    });
    fireEvent.click(cellButton("2026walive:award"));
    const list = await screen.findByTestId("district-ledger-drawer-outcomes");
    expect(within(list).getAllByTestId("district-ledger-outcome-row").map((row) => row.getAttribute("data-outcome"))).toEqual([
      "impact",
      "rookieAllStar",
      "judged",
    ]);
    expect(list.querySelector('[data-outcome="rookieAllStar"] .district-ledger-verdict-outcomes__points')?.textContent).toBe("8 pts");
  });

  it("never lists an award outcome above Impact, so a stacked award cannot reach a screen", async () => {
    await renderWithOpenCells();
    fireEvent.click(cellButton("2026walive:award"));
    const list = await screen.findByTestId("district-ledger-drawer-outcomes");
    const values = [...list.querySelectorAll(".district-ledger-verdict-outcomes__points")].map((cell) => parseInt(cell.textContent ?? "", 10));
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => Number.isFinite(value))).toBe(true);
    expect(Math.max(...values)).toBe(10);
    for (const value of values) expect(value).toBeLessThanOrEqual(10);
  });

  // Alliance selection LEFT this list in quick task 260925-w4y: its routes have
  // names too, and its points are ambiguous between two of them, so it renders
  // the outcome list whenever the run reported its routes. The route-less case
  // (a baked event) is covered in "the alliance selection cell's routes" below.
  it("keeps the shipped histogram on Qualification and the event total", async () => {
    await renderWithOpenCells();
    for (const cellId of ["2026walive:qual", "2026walive:eventTotal"]) {
      fireEvent.click(cellButton(cellId));
      await waitFor(() => expect(screen.getByTestId("district-ledger-drawer").getAttribute("data-drawer-cell")).toBe(cellId));
      expect(screen.getByTestId("district-ledger-drawer-cell-plot"), cellId).toBeDefined();
      expect(screen.queryByTestId("district-ledger-drawer-outcomes"), cellId).toBeNull();
      fireEvent.click(cellButton(cellId));
      await waitFor(() => expect(screen.queryAllByTestId("district-ledger-drawer")).toHaveLength(0));
    }
  });

  it("draws the grand total ONCE in one verdict pane, headed by the Status cell's own chance, with one source line", async () => {
    await renderWithOpenCells();
    const statLine = screen.getByTestId("district-ledger-stat-line");
    await waitFor(() => expect(statLine.textContent).toMatch(/~\d+/), { timeout: 15_000 });
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-chance").length).toBeGreaterThan(0), { timeout: 15_000 });

    // A team whose Status cell prints a number, and one printing the floor where there is one.
    const lines = screen.getAllByTestId("district-ledger-chance");
    const picks = [lines.find((line) => /^\d+% chance$/.test(line.textContent ?? "")), lines.find((line) => line.textContent === "<5% chance")].filter(
      (line): line is HTMLElement => line !== undefined
    );
    expect(picks.length).toBeGreaterThan(0);
    for (const line of picks) {
      const teamKey = line.closest("tr")!.getAttribute("data-team")!;
      const printed = line.textContent ?? "";
      const button = grandButtonOf(teamKey);
      const team = teamOfButton(button);
      fireEvent.click(button);
      const drawer = await screen.findByTestId("district-ledger-drawer");
      expect(drawer.getAttribute("data-drawer-cell")).toBe("grand");
      // ONE plot, no cell plot, no outcome list.
      expect(within(drawer).getAllByTestId("district-ledger-drawer-grand-plot")).toHaveLength(1);
      expect(within(drawer).queryByTestId("district-ledger-drawer-cell-plot")).toBeNull();
      expect(within(drawer).queryByTestId("district-ledger-drawer-outcomes")).toBeNull();
      expect(within(drawer).getByTestId("district-ledger-verdict-eyebrow").textContent).toBe(`Grand total · ${team.number} ${team.nickname}`);

      // The SAME N the Status cell prints.
      const headline = verdictHeadline(drawer);
      expect(headline).toMatch(GRAND_HEADLINE);
      const runs = printed === "<5% chance" ? "fewer than 5" : printed.replace("% chance", "");
      expect(headline).toBe(`Qualifies in ${runs} of 100 runs.`);

      // The cutoff tile is the stat line's own figure, and the chart labels the same one.
      const figure = statLineFigure();
      expect(verdictTile(drawer, "cutoff")).toBe(figure);
      expect(within(drawer).getByTestId("district-hist-cutoff-label").textContent).toBe(`cutoff ${figure}`);
      // The hatched zone is drawn exactly when the stat line prints a likely range.
      const statPrintsLikely = within(statLine).queryByTestId("district-ledger-cutoff-likely") !== null;
      expect(within(drawer).queryByTestId("district-hist-cutoff-zone") !== null).toBe(statPrintsLikely);

      // One source line: the settled event's earned points, the live one's prediction.
      const source = within(drawer).getByTestId("district-ledger-verdict-source").textContent ?? "";
      expect(source).toContain("24 earned at Done Event");
      expect(source).toMatch(/~\d+ predicted at Live Event/);

      fireEvent.click(grandButtonOf(teamKey));
      await waitFor(() => expect(screen.queryAllByTestId("district-ledger-drawer")).toHaveLength(0));
    }
  });

  it("keeps the cutoff on the grand total drawer, as the chart's label and the cutoff tile", async () => {
    await renderWithOpenCells();
    fireEvent.click(cellButton("grand"));
    const drawer = await screen.findByTestId("district-ledger-drawer");
    // The dashed rule is drawn at the simulated line, so it arrives with the chance run.
    await waitFor(() => expect(within(drawer).getByTestId("district-hist-marked-line")).toBeDefined(), { timeout: 15_000 });
    const tile = verdictTile(drawer, "cutoff") ?? "";
    expect(tile).toMatch(/^~\d+$/);
    expect(within(drawer).getByTestId("district-hist-cutoff-label").textContent).toBe(`cutoff ${tile}`);
  });

  it("draws NO grand total plot beside a category cell: the playoffs pane is its outcome list, headed by the likeliest outcome", async () => {
    await renderWithOpenCells();
    fireEvent.click(cellButton("2026walive:elim"));
    const drawer = await screen.findByTestId("district-ledger-drawer");
    const list = within(drawer).getByTestId("district-ledger-drawer-outcomes");
    expect(within(drawer).queryByTestId("district-ledger-drawer-grand-plot")).toBeNull();
    expect(within(drawer).queryByTestId("district-ledger-drawer-cell-plot")).toBeNull();

    // The likeliest PRINTED chance names the headline.
    const rows = within(list)
      .getAllByTestId("district-ledger-outcome-row")
      .map((row) => {
        const chance = row.querySelector(".district-ledger-verdict-outcomes__chance")?.textContent ?? "";
        return { label: row.querySelector(".district-ledger-verdict-outcomes__label")?.textContent ?? "", printed: /^~(\d+)%$/.exec(chance)?.[1] };
      });
    const top = Math.max(...rows.map((row) => Number(row.printed ?? 0)));
    const match = /^(.+) in (\d+) of 100 runs\.$/.exec(verdictHeadline(drawer));
    expect(match, verdictHeadline(drawer)).not.toBeNull();
    expect(Number(match![2])).toBe(top);
    expect(rows.filter((row) => Number(row.printed ?? 0) === top).map((row) => row.label)).toContain(match![1]);

    expect(verdictTiles(drawer).map((tile) => tile.key)).toEqual(["mostLikely", "chanceOfPoints"]);
    expect(verdictTile(drawer, "mostLikely")).toBe(match![1]);
    expect(verdictTile(drawer, "chanceOfPoints")).toMatch(/^\d+%$/);
    // A category cell carries no source line.
    expect(within(drawer).queryByTestId("district-ledger-verdict-source")).toBeNull();
  });

  it("prints no plus-minus codepoint anywhere in either outcome list", async () => {
    await renderWithOpenCells();
    for (const cellId of ["2026walive:elim", "2026walive:award"]) {
      fireEvent.click(cellButton(cellId));
      const list = await screen.findByTestId("district-ledger-drawer-outcomes");
      expect(list.textContent ?? "", cellId).not.toContain(PLUS_MINUS);
      fireEvent.click(cellButton(cellId));
      await waitFor(() => expect(screen.queryAllByTestId("district-ledger-drawer")).toHaveLength(0));
    }
  });

  it("is shareable: a URL naming a real team and open cell opens the drawer on first paint", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedgerAt(liveDistrict(), "/districts?algorithm=spr&drawerTeam=100&drawerCell=2026walive%3Aqual");
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-drawer")).toHaveLength(1));
    expect(screen.getByTestId("district-ledger-drawer").getAttribute("data-drawer-cell")).toBe("2026walive:qual");
  });

  it("does not pin the Team column: it keeps the surface and the alignment and scrolls with the table (sketch 025)", () => {
    expect(TEAM_CELL_CLASS).toBe("bg-[var(--color-bg-surface)] align-middle");
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
    // The chance is 1,000 joint draws run synchronously on the mock Worker.
    // Testing-library's default 1 s wait covers it here and not on Linux CI,
    // where all four chance tests timed out at about 1.1 s (run 36214067545).
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-chance").length).toBeGreaterThan(0), { timeout: 15_000 });
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

    // THE LIVE DEFECT, PINNED (quick task 261004-uw4). With no Worker no
    // distribution is ever built, so every projection is a fallback, and the
    // old stat line printed their midpoint as a prediction: "Predicted cutoff
    // ~0" with every team In range. Now a failed run prints no figure at all.
    const statLine = screen.getByTestId("district-ledger-stat-line");
    await waitFor(() => expect(statLine.textContent).toContain("not available"), { timeout: 20_000 });
    expect(within(statLine).getByTestId("district-ledger-cutoff-reason").textContent).toContain(CHAMP_LEDGER_NO_CALL_REASONS.workerError);
    expect(statLine.textContent).not.toMatch(/~\d/);
    const statuses = screen.getAllByTestId("district-ledger-status-cell").map((cell) => cell.getAttribute("data-status"));
    expect(statuses).toContain("no-call");
    expect(statuses).not.toContain("inRange");
    expect(statuses).not.toContain("outOfRange");
  });

  it("recomputes the chance at a REWOUND position, against the race the slider reopened", async () => {
    // The served artifact stands in for both events, so both carry as-of objects.
    installFetch({ eventArtifact: liveEventArtifact(), asOfEventKeys: ["2026wadone", "2026walive"] });
    handle = installMockWorker({ script: realRunScript });
    // The plain live district here rather than `mixedDistrict()`: at
    // season start every started event is reopened, so every team needs a
    // distribution at every one of its events, and the stand-in team frc900 is
    // deliberately absent from the served event roster. Since quick task
    // 260927-vmb that absence prices frc900 from awards alone rather than
    // refusing it; this test is about the rewind, so it uses a district whose
    // every team is on the served roster.
    renderLedgerAt(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))), "/districts?algorithm=spr&at=season-start");
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-chance").length).toBeGreaterThan(0), { timeout: 15_000 });

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

  /**
   * THE REPRODUCTION (quick task 260925-uf8). One team entered in the live event
   * and ABSENT from the served event artifact's roster: the simulation returns no
   * distribution for it, so every open cell and its grand total are unavailable.
   *
   * Before the fix that ONE team silenced the whole district — which is what
   * `?year=2026&district=2026pnw&tab=road-to-district-champs&at=2026wasam:awards`
   * was showing, at 90 teams rather than one. Now it is excluded from the
   * ranking, is named in the run, and its own row still says "not available".
   *
   * SINCE QUICK TASK 260927-vmb this fixture's team is no longer unpriceable:
   * `liveEventArtifact()` posts qualification rows and frc901 is on none of
   * them, so the event's own run prices it from awards alone. The two tests
   * below now pin that reading instead of the unavailable one.
   */
  function districtWithOneUnpriceableTeam() {
    const teams = ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)));
    return artifactOf([...teams, withLiveEvent(districtTeam("frc901"))]);
  }

  it("prints a chance for the whole district, the registered no show included (260927-vmb)", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(districtWithOneUnpriceableTeam());
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-chance").length).toBeGreaterThan(0), { timeout: 15_000 });

    // Every printed line is still a well-formed one.
    for (const line of screen.getAllByTestId("district-ledger-chance")) {
      expect(line.textContent ?? "").toMatch(/^(<5% chance|\d{1,2}% chance)$/);
    }
    // 260927-vmb: the registered no show is priced from awards alone, so it is
    // POSTED to the ranking with the roster rather than left out.
    const request = instancesReceiving(handle, "chance").at(-1)!.received[0] as { inputs: { teams: { teamKey: string }[] } };
    const posted = request.inputs.teams.map((team) => team.teamKey);
    expect(posted).toContain("frc901");
    expect(posted).toHaveLength(ROSTER.length + 1);
  });

  it("prices the registered no show's OWN row from awards alone rather than printing unavailable (260927-vmb)", async () => {
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(districtWithOneUnpriceableTeam());
    await waitFor(() => expect(screen.getAllByTestId("district-ledger-chance").length).toBeGreaterThan(0), { timeout: 15_000 });

    const rows = [...document.querySelectorAll('[data-testid="district-ledger-row"][data-team="frc901"]')];
    expect(rows.length).toBeGreaterThan(0);
    const text = rows.map((row) => row.textContent ?? "").join(" ");
    // 260927-vmb: priced from awards alone, so no cell of its row is unavailable.
    expect(text).not.toContain(DISTRICT_LEDGER_UNAVAILABLE_CELL);
  });

  /**
   * THE 260925-uf8 GUARD, RESTORED (quick task 260927-vmb). The two tests above
   * used to reach it through a registered team missing from the served roster,
   * which is now priced from awards alone. These reach it through the two
   * single team refusals that still exist:
   *
   * - A MISSING EVENT ARTIFACT. frc901's only open event, `2026waghost`, has
   *   started but its artifact 404s (`useDistrictEventArtifacts` lists it in
   *   `missingEventArtifacts`), so the tab holds no distribution for it, that
   *   event's open cells read unavailable, and so does the grand total.
   * - A REFUSED CONVOLUTION. frc901 plays the served live event, but its
   *   rookie bonus plus adjustments is negative, so `convolveDistrictGrandTotal`
   *   throws `NegativeDistrictShiftError` and `buildDistrictLedgerRows` degrades
   *   that team alone through `degradedLedgerTeam`.
   *
   * Either way the team is left out of the chance ranking, its own row says
   * "not available" with no chance line, and every other team keeps its chance.
   */
  const REFUSALS: ReadonlyArray<readonly [string, () => DistrictArtifact, readonly string[]]> = [
    [
      "an event artifact that is not served",
      () =>
        artifactOf([
          ...ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey))),
          {
            ...districtTeam("frc901"),
            remainingEvents: [{ eventKey: "2026waghost", eventName: "Ghost Event", week: 2, tier: "district", maxPoints: 83, state: MID_QUALS }],
            maxRemainingDistrict: 83,
            maxRemainingChamp: 83,
          },
        ]),
      ["2026waghost"],
    ],
    [
      "a grand total convolution that refuses (degradedLedgerTeam)",
      () =>
        artifactOf([
          ...ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey))),
          withLiveEvent(districtTeam("frc901", { adjustments: -5 })),
        ]),
      [],
    ],
  ];

  for (const [label, districtFor, missingEventKeys] of REFUSALS) {
    it(`excludes ONE refused team from the chance ranking and still prints the rest of the district's chances: ${label}`, async () => {
      installFetch({ eventArtifact: liveEventArtifact(), missingEventKeys });
      handle = installMockWorker({ script: realRunScript });
      renderLedger(districtFor());
      await waitFor(() => expect(screen.getAllByTestId("district-ledger-chance").length).toBeGreaterThan(0), { timeout: 15_000 });

      for (const line of screen.getAllByTestId("district-ledger-chance")) {
        expect(line.textContent ?? "").toMatch(/^(<5% chance|\d{1,2}% chance)$/);
      }
      const request = instancesReceiving(handle, "chance").at(-1)!.received[0] as { inputs: { teams: { teamKey: string }[] } };
      const posted = request.inputs.teams.map((team) => team.teamKey);
      expect(posted).not.toContain("frc901");
      expect(posted).toHaveLength(ROSTER.length);

      const rows = [...document.querySelectorAll('[data-testid="district-ledger-row"][data-team="frc901"]')];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((row) => row.textContent ?? "").join(" ")).toContain(DISTRICT_LEDGER_UNAVAILABLE_CELL);
      for (const row of rows) {
        expect(within(row as HTMLElement).queryAllByTestId("district-ledger-chance")).toHaveLength(0);
      }
    });
  }

  /**
   * THE EXCLUDED TEAM FALLBACK (quick task 261004-uw4). The two tests above
   * pin that one refused team does not silence the district's chances. These
   * pin what the CUTOFF does there: the run ranked a smaller field, so its
   * line is not the district's line, and the tab keeps the shipped midpoint
   * rule exactly, with no likely range, the median rule's chips and the
   * median rule's own definitions under them.
   */
  for (const [label, districtFor, missingEventKeys] of REFUSALS) {
    it(`keeps the midpoint cutoff, with no likely range and the median rule's chips, where the run left ONE team out: ${label}`, async () => {
      installFetch({ eventArtifact: liveEventArtifact(), missingEventKeys });
      handle = installMockWorker({ script: realRunScript });
      renderLedger(districtFor());
      await waitFor(() => expect(screen.getAllByTestId("district-ledger-chance").length).toBeGreaterThan(0), { timeout: 15_000 });

      const statLine = screen.getByTestId("district-ledger-stat-line");
      expect(statLine.textContent).toMatch(/^Predicted cutoff ~\d+$/);
      expect(within(statLine).queryByTestId("district-ledger-cutoff-likely")).toBeNull();
      expect(statLine.textContent).not.toContain("not available");

      const statuses = screen.getAllByTestId("district-ledger-status-cell").map((cell) => cell.getAttribute("data-status"));
      expect(statuses.some((status) => status === "inRange" || status === "outOfRange")).toBe(true);
      expect(statuses).not.toContain("no-call");
      expect(statuses).not.toContain("pending");
      for (const chip of screen.getAllByTestId("district-ledger-status-chip")) {
        expect(chip.textContent ?? "").not.toContain(String.fromCharCode(0x2014));
      }

      const definitions = screen.getByTestId("district-ledger-status-definitions").textContent ?? "";
      expect(definitions).toContain(DISTRICT_LEDGER_STATUS_DEFINITIONS.inRange);
      expect(definitions).toContain(DISTRICT_LEDGER_STATUS_DEFINITIONS.outOfRange);

      // The dashed rule is the midpoint rule's: drawn, carrying the stat line's
      // figure on its tile, and with no hatched zone, because no likely range is printed.
      const grand = document.querySelector('[data-cell-id="grand"][data-cell="open"]')!;
      fireEvent.click(grand.tagName === "BUTTON" ? grand : within(grand as HTMLElement).getByRole("button"));
      const drawer = await screen.findByTestId("district-ledger-drawer");
      expect(within(drawer).getByTestId("district-hist-marked-line")).toBeDefined();
      expect(verdictTile(drawer, "cutoff")).toBe(statLineFigure());
      expect(within(drawer).queryByTestId("district-hist-cutoff-zone")).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// The simulated cutoff's chip timing (quick task 261004-uw4)
// ---------------------------------------------------------------------------

/**
 * THE CHIP TIMING, on the District Locks tab (Jacob's 2026-09-27 decision,
 * applied here on 2026-10-04): while the chance run is in flight, In range and
 * Out of range read a neutral Pending and the stat line prints no figure,
 * while every verdict chip is already there. They settle ONCE. A failed run
 * reads No call with its reason and never prints a figure.
 *
 * The Worker here is CONTROLLABLE, the shape `ChampLocksLedger.test.tsx` uses:
 * the per event run goes through the real protocol, and every chance request
 * is held until the test releases it, or failed.
 */
describe("DistrictLedger — the simulated cutoff's chip timing", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  const EM_DASH = String.fromCharCode(0x2014);

  /** The live district, plus one team Locked on points and one Locked out, so verdict chips exist. */
  function mixedDistrict() {
    const teams = ROSTER.map((teamKey) => (teamKey === ROSTER[0] ? lockedTeam(teamKey) : withLiveEvent(districtTeam(teamKey))));
    return artifactOf([...teams, lockedOutTeam("frc900")]);
  }

  function renderHeld(mode: "hold" | "error") {
    const held: { message: unknown; post: (outbound: unknown) => void }[] = [];
    installFetch({ eventArtifact: liveEventArtifact() });
    handle = installMockWorker({
      script: (message, ctx) => {
        if ((message as { type?: string }).type === "chance") {
          if (mode === "error") ctx.post({ type: "error", name: "Error", message: "forced by the test" });
          else held.push({ message, post: (outbound) => ctx.post(outbound) });
          return;
        }
        runDistrictWorkerJob(message, (outbound) => ctx.post(outbound), runAsOfEvent);
      },
    });
    renderLedger(mixedDistrict());
    return held;
  }

  function statusesOnScreen(): (string | null)[] {
    return screen.getAllByTestId("district-ledger-status-cell").map((cell) => cell.getAttribute("data-status"));
  }

  function filterChip(status: string): HTMLElement {
    return screen.getAllByTestId("district-ledger-status-chip").find((chip) => chip.getAttribute("data-status") === status)!;
  }

  it("reads Pending, with no figure, no dashed rule and no range chip, until the chance run lands, and then settles ONCE", async () => {
    const statLineTexts: string[] = [];
    const statusesBeforeRelease = new Set<string | null>();
    let released = false;
    const observer = new MutationObserver(() => {
      const statLine = document.querySelector('[data-testid="district-ledger-stat-line"]');
      if (statLine !== null) statLineTexts.push(statLine.textContent ?? "");
      if (released) return;
      for (const cell of document.querySelectorAll('[data-testid="district-ledger-status-cell"]')) statusesBeforeRelease.add(cell.getAttribute("data-status"));
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });

    const held = renderHeld("hold");
    await waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 20_000 });
    await waitFor(() => expect(statusesOnScreen()).toContain("pending"));

    const statuses = statusesOnScreen();
    expect(statuses).not.toContain("inRange");
    expect(statuses).not.toContain("outOfRange");
    // D-04: the verdict chips are already there.
    expect(statuses).toContain("locked");
    expect(statuses).toContain("lockedOut");
    const statLine = screen.getByTestId("district-ledger-stat-line");
    expect(statLine.textContent).toBe("Predicted cutoff pending");
    expect(filterChip("inRange").textContent).toContain(EM_DASH);
    expect(filterChip("outOfRange").textContent).toContain(EM_DASH);
    expect(screen.queryAllByTestId("district-ledger-chance")).toHaveLength(0);
    // The definitions under the chips already name the cutoff the chips will cut at.
    const definitions = screen.getByTestId("district-ledger-status-definitions").textContent ?? "";
    expect(definitions).toContain(DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS.inRange);
    expect(definitions).toContain(DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS.outOfRange);

    // An opened grand total drawer draws NO dashed rule while the line is pending.
    const grand = document.querySelector('[data-cell-id="grand"][data-cell="open"]')!;
    fireEvent.click(grand.tagName === "BUTTON" ? grand : within(grand as HTMLElement).getByRole("button"));
    const drawer = await screen.findByTestId("district-ledger-drawer");
    expect(within(drawer).queryByTestId("district-hist-marked-line")).toBeNull();
    expect(verdictTile(drawer, "cutoff")).toBe("pending");

    // Release the LATEST held run (an earlier one may be stale by now).
    const latest = held[held.length - 1]!;
    released = true;
    runDistrictWorkerJob(latest.message, latest.post);
    await waitFor(() => expect(screen.getByTestId("district-ledger-stat-line").textContent).toMatch(/^Predicted cutoff ~\d+( · likely \d+–\d+)?$/), {
      timeout: 20_000,
    });
    const settled = statusesOnScreen();
    expect(settled).not.toContain("pending");
    expect(settled.some((status) => status === "inRange" || status === "outOfRange")).toBe(true);
    // The dashed rule arrives with the figure, in the drawer that was already open.
    const openDrawer = screen.getByTestId("district-ledger-drawer");
    expect(within(openDrawer).getByTestId("district-hist-marked-line")).toBeDefined();
    expect(verdictTile(openDrawer, "cutoff")).toMatch(/^~\d+$/);
    observer.disconnect();

    // SETTLES ONCE: every stat line the page ever showed is either the
    // pending one or the final figure, never a second number in between.
    const figures = new Set(statLineTexts.filter((text) => /~\d+/.test(text)));
    expect(figures.size).toBe(1);
    for (const text of statLineTexts) expect(text).not.toContain("not available");
    // And no chip ever showed a median rule call or a transient No call first.
    for (const status of ["inRange", "outOfRange", "no-call"]) expect(statusesBeforeRelease.has(status)).toBe(false);
    expect(statusesBeforeRelease.has("pending")).toBe(true);
  }, 40_000);

  it("reads No call with its reason when the chance run fails, prints no figure, and leaves every verdict alone", async () => {
    renderHeld("error");
    await waitFor(() => expect(statusesOnScreen()).toContain("no-call"), { timeout: 20_000 });
    const statuses = statusesOnScreen();
    expect(statuses).not.toContain("inRange");
    expect(statuses).not.toContain("outOfRange");
    expect(statuses).not.toContain("pending");
    const noCall = screen.getAllByTestId("district-ledger-status-cell").find((cell) => cell.getAttribute("data-status") === "no-call")!;
    expect(noCall.textContent).toContain("No call");
    expect(noCall.textContent).toContain(CHAMP_LEDGER_NO_CALL_REASONS.workerError);

    const statLine = screen.getByTestId("district-ledger-stat-line");
    expect(statLine.textContent).toContain("Predicted cutoff not available");
    expect(within(statLine).getByTestId("district-ledger-cutoff-reason").textContent).toContain(CHAMP_LEDGER_NO_CALL_REASONS.workerError);
    expect(statLine.textContent).not.toMatch(/~\d/);
    expect(screen.queryAllByTestId("district-ledger-chance")).toHaveLength(0);

    // D-04: the guarantees keep their chips and their counts.
    expect(statuses).toContain("locked");
    expect(statuses).toContain("lockedOut");
    expect(filterChip("locked").textContent).toMatch(/\d/);
    expect(filterChip("lockedOut").textContent).toMatch(/\d/);
    expect(filterChip("locked").textContent).not.toContain(EM_DASH);
    expect(filterChip("lockedOut").textContent).not.toContain(EM_DASH);
    expect(filterChip("inRange").textContent).toContain(EM_DASH);
    expect(filterChip("outOfRange").textContent).toContain(EM_DASH);
  }, 40_000);
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

  it("settles the Playoffs cell GREY for an alliance the bracket has already decided, with no chance beside it (261008-26o)", async () => {
    await renderPlayoffs();
    const kindFor = (teamKey: string): string | null => {
      for (const row of document.querySelectorAll(`[data-team="${teamKey}"]`)) {
        const cell = row.querySelector('[data-cell-id="2026waplay:elim"]');
        if (cell !== null) return cell.getAttribute("data-cell");
      }
      return null;
    };
    // Alliance 5 lost sf2 and then sf5: out at seventh, and alliance 6 lost
    // sf4 and then sf6: out at eighth. Both pay nothing, settled at once.
    for (const teamKey of [...allianceRoster(5), ...allianceRoster(6)]) {
      expect(kindFor(teamKey), teamKey).toBe("final");
      expect(elimTextFor(teamKey), teamKey).toBe("0");
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

describe("DistrictLedger — the alliance selection cell names the likelier route", () => {
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
   * THIRTY teams, because the shipped 24-team roster fills eight three-team
   * alliances EXACTLY and every team is therefore selected in every draw — which
   * pins the cell in the median form and hides every route wording behind the
   * 99.5% fallback. Six teams have to miss out for the chance form to appear at
   * all.
   */
  const WIDE_ROSTER = Array.from({ length: 30 }, (_unused, i) => `frc${String(300 + i)}`);

  const WIDE_QUALS_OPEN = state({ qualMatchesPlayed: 6, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false });
  /** Quals DONE and the alliances not yet announced: the one position where the draft is a settled ranking's own. */
  const WIDE_QUALS_DONE = state({ qualMatchesPlayed: 12, qualMatchesTotal: 12, alliancesPicked: false, playoffsDone: false, awardsPosted: false });

  function wideTeam(teamKey: string, eventState: DistrictEventState): DistrictTeam {
    return {
      ...districtTeam(teamKey),
      remainingEvents: [{ eventKey: "2026wawide", eventName: "Wide Event", week: 2, tier: "district", maxPoints: 83, state: eventState }],
      maxRemainingDistrict: 83,
      maxRemainingChamp: 83,
    };
  }

  /** Twelve qualification rows over thirty teams, `played` of them played and the rest still to come. */
  function wideEventArtifact(played: number): EventArtifact {
    const matches = [];
    const upcoming = [];
    for (let m = 0; m < 12; m++) {
      const red = [WIDE_ROSTER[(m * 6) % 30]!, WIDE_ROSTER[(m * 6 + 1) % 30]!, WIDE_ROSTER[(m * 6 + 2) % 30]!];
      const blue = [WIDE_ROSTER[(m * 6 + 3) % 30]!, WIDE_ROSTER[(m * 6 + 4) % 30]!, WIDE_ROSTER[(m * 6 + 5) % 30]!];
      const row = {
        matchKey: `2026wawide_qm${String(m + 1)}`,
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
        redRpPmf: RP_PMF,
        blueRpPmf: RP_PMF,
      };
      if (m < played) {
        matches.push({ ...row, actualWinner: "red", actualRedScore: 95, actualBlueScore: 80, actualRedRp: 3, actualBlueRp: 1 });
      } else {
        upcoming.push(row);
      }
    }
    return EventArtifactSchema.parse({
      schemaVersion: 1,
      generation: "gen-1",
      computedAt: "2026-09-25T00:00:00.000Z",
      algorithmId: "spr",
      algorithmVersion: ALGORITHM_VERSION,
      eventKey: "2026wawide",
      season: SEASON,
      matches,
      upcoming,
      teams: WIDE_ROSTER.map((teamKey, i) => ({
        teamKey,
        teamNumber: Number(teamKey.replace("frc", "")),
        nickname: `Nickname ${teamKey}`,
        rank: i + 1,
        record: { wins: 3, losses: 3, ties: 0 },
        rp: 2 + (30 - i) / 30,
        metrics: { total: { value: 60 + (30 - i) }, sigma: { value: 8 } },
      })),
    });
  }

  async function renderWide(played: number, eventState: DistrictEventState) {
    installFetch({ eventArtifact: wideEventArtifact(played) });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(WIDE_ROSTER.map((teamKey) => wideTeam(teamKey, eventState))));
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026wawide:alliance"]')?.getAttribute("data-cell")).toBe("open");
    });
    await waitFor(() => {
      expect(selectionTexts().some((text) => text.length > 0)).toBe(true);
    });
  }

  /** Every team's Alliance selection cell text, in table order. */
  function selectionTexts(): string[] {
    return [...document.querySelectorAll('[data-cell-id="2026wawide:alliance"]')].map((cell) => cell.textContent ?? "");
  }

  function clickSelectionCellMatching(pattern: RegExp): string {
    for (const cell of document.querySelectorAll('[data-cell-id="2026wawide:alliance"]')) {
      const text = cell.textContent ?? "";
      if (!pattern.test(text)) continue;
      fireEvent.click(within(cell as HTMLElement).getByRole("button"));
      return text;
    }
    throw new Error(`no alliance cell matching ${String(pattern)}`);
  }

  it("prints the LIKELIER route first, with `if in` beneath it, while the ranking is still open", async () => {
    await renderWide(6, WIDE_QUALS_OPEN);
    const texts = selectionTexts();
    const captainCells = texts.filter((text) => /^captain ~\d+%(~\d+ if in)?$/.test(text));
    const pickedCells = texts.filter((text) => /^picked ~\d+%(~\d+ if in)?$/.test(text));
    expect(captainCells.length, `captain cells among ${JSON.stringify(texts)}`).toBeGreaterThan(0);
    expect(pickedCells.length, `picked cells among ${JSON.stringify(texts)}`).toBeGreaterThan(0);
    // The shipped clause is gone wherever a route is named: the bold line covers
    // ONE route now, so "if picked" beside it would describe the wrong event.
    for (const text of [...captainCells, ...pickedCells]) expect(text).not.toContain("if picked");
  });

  it("never prints the chance of ANY selection points under the word `picked`", async () => {
    await renderWide(6, WIDE_QUALS_OPEN);
    // The defect: a team that captains an alliance in most runs read as "picked"
    // at the sum of all three routes. A captain-heavy cell now says captain.
    for (const text of selectionTexts()) {
      if (!/^captain ~/.test(text)) continue;
      expect(text).not.toContain("picked");
    }
  });

  it("lists the four routes in the drawer, with the points each one paid", async () => {
    await renderWide(6, WIDE_QUALS_OPEN);
    clickSelectionCellMatching(/^(captain|picked) ~/);
    const list = await screen.findByTestId("district-ledger-drawer-outcomes");
    const rows = within(list).getAllByTestId("district-ledger-outcome-row");
    expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual(["captain", "firstPick", "secondPick", "notSelected"]);
    // No histogram beside it: the routes ARE the axis.
    expect(screen.queryByTestId("district-ledger-drawer-cell-plot")).toBeNull();
    // The captain row's points read as a range, and a captain's range is 9 to 16.
    const captainPoints = list.querySelector('[data-outcome="captain"] .district-ledger-verdict-outcomes__points')?.textContent ?? "";
    expect(captainPoints).toMatch(/^\d+( to \d+)? pts$/);
    expect(captainPoints).not.toContain("±");
    // Every chance in the list, and they account for the whole hundred.
    const chances = [...list.querySelectorAll(".district-ledger-verdict-outcomes__chance")].map(
      (cell) => cell.textContent ?? ""
    );
    expect(chances).toHaveLength(4);
    expect(chances.every((text) => /^(0%|<1%|~\d+%)$/.test(text))).toBe(true);
  });

  it("prints the settled route and its alliance once quals are DONE, in place of a range whose ends are equal", async () => {
    await renderWide(12, WIDE_QUALS_DONE);
    const texts = selectionTexts();
    const captains = texts.filter((text) => /^~\d+captain, alliance \d$/.test(text));
    const firstPicks = texts.filter((text) => /^~\d+first pick, alliance \d$/.test(text));
    const secondPicks = texts.filter((text) => /^~\d+second pick, alliance \d$/.test(text));
    // Eight alliances, so eight of each, and the remaining six teams are the
    // ones the draft leaves out of a thirty-team field.
    expect({ captains: captains.length, firstPicks: firstPicks.length, secondPicks: secondPicks.length }).toEqual({
      captains: 8,
      firstPicks: 8,
      secondPicks: 8,
    });
    // "the rest print their pick chance" — and a team no run selected prints zero.
    expect(texts.filter((text) => /^picked ~0%$/.test(text))).toHaveLength(6);
    // No percentile range whose two ends are the same number survives anywhere.
    for (const text of texts) expect(text).not.toContain(DISTRICT_LEDGER_LIKELY_PREFIX);
  });

  it("leaves a settled captain ONE row in the drawer, at its exact points", async () => {
    await renderWide(12, WIDE_QUALS_DONE);
    clickSelectionCellMatching(/^~\d+captain, alliance \d$/);
    const list = await screen.findByTestId("district-ledger-drawer-outcomes");
    const rows = within(list).getAllByTestId("district-ledger-outcome-row");
    expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual(["captain"]);
    // A point mass: one value, no range.
    expect(list.querySelector('[data-outcome="captain"] .district-ledger-verdict-outcomes__points')?.textContent).toMatch(/^\d+ pts$/);
    expect(list.querySelector('[data-outcome="captain"] .district-ledger-verdict-outcomes__chance')?.textContent).toBe("~100%");
  });

  it("leaves a settled second pick with NO captain row, which is the omission Jacob asked for", async () => {
    await renderWide(12, WIDE_QUALS_DONE);
    clickSelectionCellMatching(/^~\d+second pick, alliance \d$/);
    const list = await screen.findByTestId("district-ledger-drawer-outcomes");
    expect(within(list).getAllByTestId("district-ledger-outcome-row").map((row) => row.getAttribute("data-outcome"))).toEqual([
      "secondPick",
    ]);
  });

  it("keeps the shipped wording and the histogram for an UNSTARTED event, whose sidecar carries no routes", async () => {
    installFetch({ preSim: preSimBody() });
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withUnstartedEvent(districtTeam(teamKey))), { bakedEvents: ["2026wasoon"] }));
    await waitFor(() => {
      expect(document.querySelector('[data-cell-id="2026wasoon:alliance"]')?.getAttribute("data-cell")).toBe("open");
    });
    const cell = document.querySelector('[data-cell-id="2026wasoon:alliance"]')!;
    expect(cell.textContent ?? "").toMatch(/^~\d+% picked(~\d+ if picked)?$/);
    fireEvent.click(within(cell as HTMLElement).getByRole("button"));
    expect(await screen.findByTestId("district-ledger-drawer-cell-plot")).toBeDefined();
    expect(screen.queryByTestId("district-ledger-drawer-outcomes")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("DistrictLedger — the run progress bar (quick task 261007-481)", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a determinate bar as the controls card's last row while the run is held, and drops it once the run lands", async () => {
    // Hold the per event run so the tab stays mid run long enough to read the
    // bar; every other request (the advancement chance) runs for real.
    const held: { message: unknown; post: (outbound: unknown) => void }[] = [];
    let holding = true;
    handle = installMockWorker({
      script: (message, ctx) => {
        if (holding && (message as { type?: string }).type === "run") {
          held.push({ message, post: (outbound) => ctx.post(outbound) });
          return;
        }
        realRunScript(message, ctx);
      },
    });
    installFetch({ eventArtifact: liveEventArtifact() });
    renderLedger(artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey)))));

    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    // An early indeterminate frame while the event artifact loads is expected;
    // wait for the in flight run's determinate state.
    await waitFor(() => expect(screen.getByTestId("district-ledger-run-progress").getAttribute("data-progress")).toBe("determinate"));
    const latest = held[held.length - 1]!;
    const totalEvents = (latest.message as { events: unknown[] }).events.length;
    const bar = screen.getByTestId("district-ledger-run-progress");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe(String(totalEvents));
    expect(screen.getByTestId("district-ledger-controls").lastElementChild).toBe(bar);

    latest.post({ type: "progress", completedEvents: 1, totalEvents: 1 });
    await waitFor(() => expect(screen.getByTestId("district-ledger-run-progress").getAttribute("aria-valuenow")).toBe("1"));
    const fill = screen.getByTestId("district-ledger-run-progress").firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("100%");

    holding = false;
    runDistrictWorkerJob(latest.message, latest.post, runAsOfEvent);
    await waitFor(() => expect(screen.queryByTestId("district-ledger-run-progress")).toBeNull());
  });

  it("renders no bar when there is nothing to run", async () => {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(artifactOf([districtTeam("frc100")]));
    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("district-ledger-run-progress")).toBeNull();
  });
});
