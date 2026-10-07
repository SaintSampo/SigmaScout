/**
 * `ChampLocksLedger`'s component coverage.
 *
 * `DistrictLedger.test.tsx`'s harness exactly: a self-contained router tree
 * carrying a `/team/$teamNumber` route (the Team cells are real `Link`s), a
 * `QueryClientProvider` (this tab fetches event artifacts and baked sidecars of
 * its own), and `installMockWorker({ script: runDistrictWorkerJob })` so every
 * message crosses a real `structuredClone` and a request carrying a function
 * would fail HERE rather than only in a visitor's browser.
 *
 * TWO POSITIONS ARE FIXTURED, and they are the two a reader actually meets:
 *
 * - THE FINISHED DISTRICT AND CHAMPIONSHIP. Every category of both tiers is
 *   final, so the field is a fact, every number is TBA's own and the tab starts
 *   no thread at all. This is where the two rows, the nine columns, the
 *   row-spanning Status and Grand total cells, the two award chips and the em
 *   dash for a team outside the field are pinned.
 * - THE DISTRICT SEASON, BEFORE REGISTRATIONS OPEN. No team carries a dcmp-tier
 *   row, because `scripts/publishDistricts.ts` builds `remainingEvents` from TBA
 *   registrations and a team registers only after it qualifies. This is where
 *   "not yet priced", the labelled district-only grand total, the "to be there"
 *   line and the ABSENCE of a champ chance are pinned.
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
import { installMockWorker, type MockWorkerHandle, type MockWorkerScript } from "../../test/mockWorker.js";
import { runDistrictWorkerJob } from "../../workers/districtSimulationProtocol.js";
import { runAsOfEvent } from "../../workers/districtAsOfJob.js";
import { ChampLocksLedger } from "./ChampLocksLedger.js";
import { DISTRICT_MILESTONE_KEYS } from "./districtMilestones.js";
import { asOfBodyFor, buildAsOfTestObjects } from "./asOfTestFixtures.js";
import {
  CHAMP_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_AWARD_OUTCOME_LABELS,
  DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS,
} from "./districtLedgerCopy.js";

/** The forbidden glyph and the em dash, both built from their CODEPOINTS so this file never types either character. */
const PLUS_MINUS = String.fromCharCode(0x00b1);
const EM_DASH = String.fromCharCode(0x2014);
const SEASON = 2026;
const ALGORITHM_VERSION = "7.0.0+rolling";

const DISTRICT_EVENT = "2026wabon";
const LIVE_EVENT = "2026walive";
const DCMP_EVENT = "2026pncmp";

// ---------------------------------------------------------------------------
// Router + query harness
// ---------------------------------------------------------------------------

const ChildrenContext = createContext<ReactNode>(null);

function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}

function TestHarness({ children, initialEntry = "/districts?algorithm=spr&tab=champ-locks" }: { children: ReactNode; initialEntry?: string }) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
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

const ROSTER = Array.from({ length: 24 }, (_unused, i) => `frc${String(100 + i)}`);
/** The first twelve teams are the District Championship field; the other twelve never went. */
const DCMP_FIELD = new Set(ROSTER.slice(0, 12));

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
      {
        eventKey: DISTRICT_EVENT,
        eventName: "PNW District Bonney Lake Event",
        week: 0,
        tier: "district",
        qual: 12,
        alliance: 6,
        elim: 6,
        award: 0,
        total: 24,
        state: state(),
      },
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

/** A team that played the District Championship: a finished dcmp-tier row on top of its district one. */
function withPlayedDcmp(team: DistrictTeam): DistrictTeam {
  return {
    ...team,
    pointTotal: team.pointTotal + 27,
    eventPoints: [
      ...team.eventPoints,
      {
        eventKey: DCMP_EVENT,
        eventName: "PNW District Championship",
        week: 6,
        tier: "dcmp",
        qual: 18,
        alliance: 9,
        elim: 0,
        award: 0,
        total: 27,
        state: state(),
      },
    ],
  };
}

/** One live district event, so something is open and the district run has something to rank. */
function withLiveEvent(team: DistrictTeam): DistrictTeam {
  return {
    ...team,
    remainingEvents: [
      { eventKey: LIVE_EVENT, eventName: "PNW District Sammamish Event", week: 2, tier: "district", maxPoints: 83, state: MID_QUALS },
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
      eventCount: 2,
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

/** The finished district AND championship: every category of both tiers is TBA's own. */
function finishedArtifact(): DistrictArtifact {
  return artifactOf(
    ROSTER.map((teamKey) => {
      const base = districtTeam(teamKey);
      const team = DCMP_FIELD.has(teamKey) ? withPlayedDcmp(base) : base;
      if (teamKey === ROSTER[0]) {
        // The DCMP's WINNING ALLIANCE, which the district tier has no
        // equivalent of: its chip reads `Locked · winner`.
        return { ...team, qualifyingAwards: [{ eventKey: DCMP_EVENT, awardType: 1, label: "Winner", awardOnly: false }] };
      }
      if (teamKey === ROSTER[1]) {
        // A judged award at the DCMP: the shipped `Locked · award`.
        return { ...team, qualifyingAwards: [{ eventKey: DCMP_EVENT, awardType: 0, label: "Impact Award", awardOnly: true }] };
      }
      return team;
    })
  );
}

/** The district season before registrations open: one finished event, one live one, and NO dcmp-tier row anywhere. */
function districtSeasonArtifact(): DistrictArtifact {
  return artifactOf(ROSTER.map((teamKey) => withLiveEvent(districtTeam(teamKey))));
}

/**
 * THE CHAMPIONSHIP UNDER WAY: one finished district event, one live district
 * event and the District Championship itself in progress, with every team
 * registered for it. Both open events are priced by the same Worker run at
 * their own tier, so the DCMP cells carry the 3x weight and the District points
 * cells are sums over two events.
 */
function championshipUnderWayArtifact(): DistrictArtifact {
  return artifactOf(
    ROSTER.map((teamKey) => ({
      ...withLiveEvent(districtTeam(teamKey)),
      remainingEvents: [
        { eventKey: LIVE_EVENT, eventName: "PNW District Sammamish Event", week: 2, tier: "district" as const, maxPoints: 83, state: MID_QUALS },
        { eventKey: DCMP_EVENT, eventName: "PNW District Championship", week: 6, tier: "dcmp" as const, maxPoints: 249, state: MID_QUALS },
      ],
      maxRemainingDistrict: 83,
      maxRemainingChamp: 332,
    }))
  );
}

const RP_PMF = [0.2, 0.3, 0.3, 0.2];

function liveEventArtifact(eventKey: string = LIVE_EVENT): EventArtifact {
  const matches = [];
  const upcoming = [];
  for (let m = 0; m < 6; m++) {
    const red = [ROSTER[(m * 6) % 24]!, ROSTER[(m * 6 + 1) % 24]!, ROSTER[(m * 6 + 2) % 24]!];
    const blue = [ROSTER[(m * 6 + 3) % 24]!, ROSTER[(m * 6 + 4) % 24]!, ROSTER[(m * 6 + 5) % 24]!];
    matches.push({
      matchKey: `${eventKey}_qm${String(m + 1)}`,
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
      matchKey: `${eventKey}_qm${String(m + 1)}`,
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
    eventKey,
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

function manifestBody() {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-09-25T00:00:00.000Z",
    algorithms: [{ id: "spr", version: ALGORITHM_VERSION, codeVersion: "7.0.0", paramSetName: "rolling" }],
  };
}

/** Event artifacts are served BY KEY, so a two-event fixture cannot silently answer both requests with one artifact. */
function installFetch(eventArtifacts: readonly EventArtifact[] = []) {
  // The as-of objects a rewound stop reads (quick task 261005-5g0), folded from
  // the served event artifacts.
  const asOf =
    eventArtifacts.length === 0
      ? undefined
      : buildAsOfTestObjects({ season: SEASON, version: ALGORITHM_VERSION, eventArtifacts, extraTeams: ROSTER });
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v1/manifest/algorithms.json")) return Promise.resolve(new Response(JSON.stringify(manifestBody()), { status: 200 }));
    if (url.includes("/v1/asof")) {
      const body = asOfBodyFor(asOf, url);
      return Promise.resolve(body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 }));
    }
    if (url.includes("/v1/event/")) {
      const match = eventArtifacts.find((artifact) => url.includes(artifact.eventKey));
      if (match !== undefined) return Promise.resolve(new Response(JSON.stringify(match), { status: 200 }));
    }
    return Promise.resolve(new Response("", { status: 404 }));
  }) as unknown as typeof fetch;
}

const realRunScript: MockWorkerScript = (message, ctx) => {
  runDistrictWorkerJob(message, (outbound) => ctx.post(outbound), runAsOfEvent);
};

function renderLedger(artifact: DistrictArtifact, initialEntry?: string) {
  render(
    <TestHarness {...(initialEntry === undefined ? {} : { initialEntry })}>
      <ChampLocksLedger artifact={artifact} algorithm="spr" season={SEASON} />
    </TestHarness>
  );
}

/** Both of one team's rows, in render order. */
function rowsFor(teamKey: string): HTMLElement[] {
  return screen.getAllByTestId("champ-ledger-row").filter((row) => row.getAttribute("data-team") === teamKey);
}

/**
 * Waits for the SETTLED simulated line: the stat line's tilde figure. Three
 * Worker jobs stand in front of it (the per event run, the district run and
 * the champ run), so the wait is long.
 */
async function waitForSimulatedLine(): Promise<HTMLElement> {
  const statLine = await screen.findByTestId("district-ledger-stat-line");
  await waitFor(() => expect(statLine.textContent).toMatch(/Predicted cutoff ~\d+/), { timeout: 20000 });
  return statLine;
}

// ---------------------------------------------------------------------------

describe("ChampLocksLedger — the finished district and championship", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  function renderFinished() {
    installFetch();
    handle = installMockWorker({ script: realRunScript });
    renderLedger(finishedArtifact());
  }

  it("renders the Locks milestone picker with a DCMP group in its event menu, and no range input", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getByTestId("district-ledger-rewind")).toBeDefined());
    const groups = [...screen.getByTestId("locks-picker-event").querySelectorAll("optgroup")].map((group) => group.getAttribute("label") ?? "");
    expect(groups.some((label) => label.startsWith("DCMP ·"))).toBe(true);
    expect(screen.getByTestId("champ-ledger-tab").querySelector('input[type="range"]')).toBeNull();
    // Thirteen stops per event, Round 1 to Round 5 and the Finals included (261007-3g2).
    const stops = [...screen.getByTestId("district-ledger-rewind").querySelectorAll("[data-milestone]")];
    expect(stops.map((button) => button.getAttribute("data-milestone"))).toEqual([...DISTRICT_MILESTONE_KEYS]);
    expect(stops).toHaveLength(13);
  });

  it("renders every column label, in order, from the exported tuple", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("columnheader").map((el) => el.textContent)).toEqual([...CHAMP_LEDGER_COLUMN_LABELS]);
  });

  it("defines In range and Out of range against the predicted cutoff, never the every team earns its median rule (260927-syh)", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getByTestId("district-ledger-status-definitions")).toBeTruthy());
    const definitions = screen.getByTestId("district-ledger-status-definitions").textContent ?? "";
    expect(definitions).toContain("this team's median predicted points sit at or above the predicted cutoff, which already counts the slots DCMP award winners take");
    expect(definitions).toContain("this team's median predicted points sit below the predicted cutoff");
    expect(definitions).not.toContain("if every team earned its median predicted points");
  });

  it("gives every team exactly two rows, labelled District points and DCMP points in that order", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getAllByTestId("champ-ledger-row").length).toBe(ROSTER.length * 2));
    const rows = rowsFor(ROSTER[0]!);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute("data-row"))).toEqual(["district", "dcmp"]);
    expect(within(rows[0]!).getByTestId("champ-ledger-source-cell").textContent).toContain("District points");
    expect(within(rows[1]!).getByTestId("champ-ledger-source-cell").textContent).toContain("DCMP points");
  });

  it("carries each district event's short name, ONE-BASED week and stage word on the District points row", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getAllByTestId("champ-ledger-row").length).toBeGreaterThan(0));
    const source = within(rowsFor(ROSTER[0]!)[0]!).getByTestId("champ-ledger-source-cell");
    // The TBA template is shortened, the week is printed one based (the event
    // carries week 0), and the stage word is the shipped one.
    expect(source.textContent).toContain("Bonney Lake Wk 1");
    expect(source.textContent).toContain("final");
    expect(source.textContent).not.toContain("Wk 0");
  });

  it("spans the Status and Grand total cells across both of a team's rows", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getAllByTestId("champ-ledger-row").length).toBeGreaterThan(0));
    const [first, second] = rowsFor(ROSTER[0]!);
    expect(within(first!).getByTestId("district-ledger-status-cell").getAttribute("rowspan")).toBe("2");
    expect(within(first!).getByTestId("champ-ledger-grand-total").getAttribute("rowspan")).toBe("2");
    // The second row carries neither, which is what "spanning" means.
    expect(within(second!).queryByTestId("district-ledger-status-cell")).toBeNull();
    expect(within(second!).queryByTestId("champ-ledger-grand-total")).toBeNull();
  });

  it("reads Locked with the WINNER variant for the DCMP winning alliance and the judged variant for an Impact win", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getAllByTestId("champ-ledger-row").length).toBeGreaterThan(0));
    const winner = within(rowsFor(ROSTER[0]!)[0]!).getByTestId("district-ledger-status-cell");
    const judged = within(rowsFor(ROSTER[1]!)[0]!).getByTestId("district-ledger-status-cell");
    expect(winner.textContent).toContain("winner");
    expect(winner.getAttribute("data-status")).toBe("locked");
    expect(judged.textContent).toContain("award");
    expect(judged.getAttribute("data-status")).toBe("locked");
  });

  it("prints the em dash in all four DCMP cells for a team outside the field, with not in the field under the row label", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getAllByTestId("champ-ledger-row").length).toBeGreaterThan(0));
    // The thirteenth team never went to the championship.
    const outsideKey = ROSTER[12]!;
    expect(DCMP_FIELD.has(outsideKey)).toBe(false);
    const dcmpRow = rowsFor(outsideKey)[1]!;
    const notInField = [...dcmpRow.querySelectorAll('[data-cell="not-in-field"]')];
    // The four categories AND the Subtotal.
    expect(notInField).toHaveLength(5);
    for (const cell of notInField) expect(cell.textContent).toBe(EM_DASH);
    expect(within(dcmpRow).getByTestId("champ-ledger-source-cell").textContent).toContain("not in the field");
    // A team INSIDE the field carries none of them.
    expect(rowsFor(ROSTER[0]!)[1]!.querySelectorAll('[data-cell="not-in-field"]')).toHaveLength(0);
  });

  it("prints a grand total that is TBA's own, with no district-only label, once both tiers are final", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getAllByTestId("champ-ledger-row").length).toBeGreaterThan(0));
    const grand = within(rowsFor(ROSTER[0]!)[0]!).getByTestId("champ-ledger-grand-total");
    // 24 district points plus 27 championship points, grey and final.
    expect(grand.textContent).toContain("51");
    expect(screen.queryAllByTestId("champ-ledger-district-only")).toHaveLength(0);
  });

  it("renders no plus-minus codepoint anywhere in the tree", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getByTestId("champ-ledger-tab")).toBeDefined());
    expect(document.body.textContent ?? "").not.toContain(PLUS_MINUS);
  });
});

/**
 * THE PRE-REGISTRATION WINDOW, rendered.
 *
 * The orchestrator's own acceptance for quick task 260925-xab was a synthetic
 * artifact with no dcmp-tier event anywhere rendering "not yet priced" DCMP
 * cells, a "district only" grand total and a computed status for every team.
 *
 * MOVED BY QUICK TASK 260927-6bf, deliberately. The DCMP row's Subtotal is now
 * ESTIMATED from past District Championships by field rank, so the grand total
 * is a real champ total rather than a district only one, the champ run is no
 * longer suppressed, and the stat line prints the SIMULATED line. The four
 * DCMP category cells still read "not yet priced". Each test waits for the
 * SETTLED render (the stat line's figure), because the transient render before
 * the estimate arrives still shows the district only fallback.
 */
describe("ChampLocksLedger — the district season, before registrations open", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  function renderDistrictSeason() {
    installFetch([liveEventArtifact()]);
    handle = installMockWorker({ script: realRunScript });
    renderLedger(districtSeasonArtifact());
  }

  it("reads every DCMP CATEGORY cell as not yet priced, and prices the DCMP Subtotal from past championships", async () => {
    renderDistrictSeason();
    await waitForSimulatedLine();
    const dcmpRow = rowsFor(ROSTER[0]!)[1]!;
    const unpriced = [...dcmpRow.querySelectorAll('[data-cell="not-yet-priced"]')];
    // The four categories; the Subtotal is the estimate.
    expect(unpriced).toHaveLength(4);
    for (const cell of unpriced) expect(cell.textContent).toBe("not yet priced");
    expect(dcmpRow.querySelector('[data-cell-id="dcmp-row:eventTotal"]')?.getAttribute("data-cell")).toBe("open");
    expect(dcmpRow.querySelectorAll('[data-cell="not-in-field"]')).toHaveLength(0);
    expect(dcmpRow.querySelectorAll('[data-cell="unavailable"]')).toHaveLength(0);
  }, 30000);

  it("prints NO district only label once the estimate is in, and no grand total is unavailable", async () => {
    renderDistrictSeason();
    await waitForSimulatedLine();
    expect(screen.queryAllByTestId("champ-ledger-district-only")).toHaveLength(0);
    for (const grand of screen.getAllByTestId("champ-ledger-grand-total")) expect(grand.querySelector('[data-cell="unavailable"]')).toBeNull();
  }, 30000);

  it("prints the SIMULATED line on the stat line, with its likely range and never the district only label", async () => {
    renderDistrictSeason();
    const statLine = await waitForSimulatedLine();
    expect(statLine.textContent).toMatch(/^Predicted cutoff ~\d+ · likely \d+–\d+$/);
    // Jacob, 2026-09-27: the range is shown with the line.
    expect(within(statLine).queryByTestId("district-ledger-cutoff-likely")).not.toBeNull();
    expect(statLine.textContent).not.toContain("district only");
  }, 30000);

  it("computes a status for EVERY team, never Capacity not published", async () => {
    renderDistrictSeason();
    await waitForSimulatedLine();
    const cells = screen.getAllByTestId("district-ledger-status-cell");
    expect(cells).toHaveLength(ROSTER.length);
    for (const cell of cells) {
      expect(cell.getAttribute("data-status")).not.toBeNull();
      expect(cell.textContent).not.toContain("Capacity not published");
    }
  }, 30000);

  /**
   * TWO CHANCES NOW PRINT. The chance of being in the field sits on the DCMP
   * row's own label, and the champ chance beside the status, under In range
   * and Out of range alone, because the champ run is no longer suppressed.
   */
  it("carries the to be there line on the DCMP row, and a champ chance only beside In range and Out of range", async () => {
    renderDistrictSeason();
    await waitForSimulatedLine();
    const dcmpSources = screen.getAllByTestId("champ-ledger-source-cell").filter((cell) => cell.getAttribute("data-row") === "dcmp");
    expect(dcmpSources.some((cell) => /to be there/.test(cell.textContent ?? ""))).toBe(true);
    for (const cell of dcmpSources) {
      const text = cell.textContent ?? "";
      if (!text.includes("to be there")) continue;
      expect(text).toMatch(/(~\d+% to be there|<5% to be there)/);
    }
    for (const line of screen.queryAllByTestId("district-ledger-chance")) {
      const status = line.closest('[data-testid="district-ledger-status-cell"]')?.getAttribute("data-status");
      expect(["inRange", "outOfRange"]).toContain(status);
    }
  }, 30000);

  it("cuts In range and Out of range at the printed line: the BETWEEN property", async () => {
    renderDistrictSeason();
    const statLine = await waitForSimulatedLine();
    const points = Number(/~(\d+)/.exec(statLine.textContent ?? "")![1]);
    let called = 0;
    for (const teamKey of ROSTER) {
      const first = rowsFor(teamKey)[0]!;
      const status = within(first).getByTestId("district-ledger-status-cell").getAttribute("data-status");
      if (status !== "inRange" && status !== "outOfRange") continue;
      const median = Number(/median (\d+)/.exec(within(first).getByTestId("district-ledger-team-cell").textContent ?? "")![1]);
      called += 1;
      if (status === "inRange") expect(median).toBeGreaterThanOrEqual(points);
      else expect(median).toBeLessThanOrEqual(points);
    }
    expect(called).toBeGreaterThan(0);
  }, 30000);

  it("renders no plus-minus codepoint anywhere in the tree", async () => {
    renderDistrictSeason();
    await waitFor(() => expect(screen.getByTestId("champ-ledger-tab")).toBeDefined());
    expect(document.body.textContent ?? "").not.toContain(PLUS_MINUS);
  });
});

/**
 * THE CHIP TIMING (Jacob, 2026-09-27): while the champ run is in flight, In
 * range and Out of range read a neutral Pending and the stat line prints no
 * figure, while every verdict chip is already there. They settle ONCE. A
 * Worker error reads No call with its reason, never the rank rule.
 *
 * The Worker here is CONTROLLABLE: the per event run and the district run go
 * through the real protocol, and the champ run (the one chance request that
 * carries award draws) is held until the test releases or fails it.
 */
describe("ChampLocksLedger — the simulated cutoff's chip timing", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  /** A prequalified team, so a verdict chip exists to prove it renders before the line does. */
  function prequalifiedSeasonArtifact(): DistrictArtifact {
    return artifactOf(
      ROSTER.map((teamKey) => {
        const team = withLiveEvent(districtTeam(teamKey));
        return teamKey === ROSTER[5]
          ? { ...team, champLock: { status: "prequalified" as const, pointsToLock: 0, threatCount: 0, cutLinePoints: 40, allocationNote: null } }
          : team;
      })
    );
  }

  function renderHeld(mode: "hold" | "error") {
    const held: { message: unknown; post: (outbound: unknown) => void }[] = [];
    installFetch([liveEventArtifact()]);
    handle = installMockWorker({
      script: (message, ctx) => {
        const request = message as { type?: string; inputs?: { awardDraws?: unknown } };
        if (request.type === "chance" && request.inputs?.awardDraws !== undefined) {
          if (mode === "error") ctx.post({ type: "error", name: "Error", message: "forced by the test" });
          else held.push({ message, post: (outbound) => ctx.post(outbound) });
          return;
        }
        runDistrictWorkerJob(message, (outbound) => ctx.post(outbound), runAsOfEvent);
      },
    });
    renderLedger(prequalifiedSeasonArtifact());
    return held;
  }

  function statusesOnScreen(): (string | null)[] {
    return screen.getAllByTestId("district-ledger-status-cell").map((cell) => cell.getAttribute("data-status"));
  }

  it("reads Pending, with no figure and no rank chip, until the champ run lands, and then settles ONCE", async () => {
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
    await waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 20000 });
    await waitFor(() => expect(statusesOnScreen()).toContain("pending"));

    const statuses = statusesOnScreen();
    expect(statuses).not.toContain("inRange");
    expect(statuses).not.toContain("outOfRange");
    // The verdict chip is already there.
    expect(statuses).toContain("prequalified");
    const statLine = screen.getByTestId("district-ledger-stat-line");
    expect(statLine.textContent).toBe("Predicted cutoff pending");
    for (const chip of screen.getAllByTestId("district-ledger-status-chip")) {
      const status = chip.getAttribute("data-status");
      if (status === "inRange" || status === "outOfRange") expect(chip.textContent).toContain(String.fromCharCode(0x2014));
    }
    expect(screen.queryAllByTestId("district-ledger-chance")).toHaveLength(0);

    // Release the LATEST held run (an earlier one may be stale by now).
    const latest = held[held.length - 1]!;
    released = true;
    runDistrictWorkerJob(latest.message, latest.post);
    await waitFor(() => expect(screen.getByTestId("district-ledger-stat-line").textContent).toMatch(/^Predicted cutoff ~\d+ · likely \d+–\d+$/), { timeout: 20000 });
    const settled = statusesOnScreen();
    expect(settled).not.toContain("pending");
    expect(settled.some((status) => status === "inRange" || status === "outOfRange")).toBe(true);
    observer.disconnect();

    // SETTLES ONCE: every stat line the page ever showed is either the
    // pending one or the final figure, never a second number in between.
    const figures = new Set(statLineTexts.filter((text) => /~\d+/.test(text)));
    expect(figures.size).toBe(1);
    for (const text of statLineTexts) {
      expect(text).not.toContain("district only");
      expect(text).not.toContain("not available");
    }
    // And no chip ever showed a rank rule call or a transient No call first.
    for (const status of ["inRange", "outOfRange", "no-call"]) expect(statusesBeforeRelease.has(status)).toBe(false);
    expect(statusesBeforeRelease.has("pending")).toBe(true);
  }, 40000);

  it("reads No call with its reason when the champ run fails, and never the rank rule", async () => {
    renderHeld("error");
    await waitFor(() => expect(statusesOnScreen()).toContain("no-call"), { timeout: 20000 });
    const statuses = statusesOnScreen();
    expect(statuses).not.toContain("inRange");
    expect(statuses).not.toContain("outOfRange");
    expect(statuses).not.toContain("pending");
    expect(statuses).toContain("prequalified");
    const noCall = screen.getAllByTestId("district-ledger-status-cell").find((cell) => cell.getAttribute("data-status") === "no-call")!;
    expect(noCall.textContent).toContain("No call");
    expect(noCall.textContent).toContain("the simulation did not finish in this browser");
    const statLine = screen.getByTestId("district-ledger-stat-line");
    expect(statLine.textContent).toContain("Predicted cutoff not available");
    expect(within(statLine).getByTestId("district-ledger-cutoff-reason").textContent).toContain("the simulation did not finish in this browser");
  }, 40000);
});

/**
 * THE DRAWER, at the champ tier.
 *
 * The one structural question this tier asks that the district tier does not:
 * which pane a clicked cell gets. A DCMP cell is ONE event, so its Playoffs and
 * Awards cells list their named outcomes at the 3x weight; a District points
 * cell is a SUM over several events, whose support no placement names, so it
 * keeps the histogram.
 */
describe("ChampLocksLedger — the drawer", () => {
  const originalFetch = global.fetch;
  let handle: MockWorkerHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
    global.fetch = originalFetch;
    cleanup();
    vi.restoreAllMocks();
  });

  function renderUnderWay(initialEntry?: string) {
    // ALL THREE events get an artifact, including the finished district one: a
    // rewound position reopens it and fetches it, and a 404 there would make
    // every grand total unavailable and silence the chance run.
    installFetch([liveEventArtifact(DISTRICT_EVENT), liveEventArtifact(LIVE_EVENT), liveEventArtifact(DCMP_EVENT)]);
    handle = installMockWorker({ script: realRunScript });
    renderLedger(championshipUnderWayArtifact(), initialEntry);
  }

  /**
   * Waits for one cell to be priced (a real button), then clicks it.
   *
   * The grand total carries its `data-cell-id` ON the button, because it is
   * rendered inside a row-spanning cell of its own; every other cell carries it
   * on the `<td>` with the button inside. Both shapes are handled here rather
   * than by two helpers.
   */
  async function clickCell(cellId: string): Promise<void> {
    await waitFor(
      () => {
        const cell = document.querySelector(`[data-cell-id="${cellId}"]`);
        expect(cell?.getAttribute("data-cell")).toBe("open");
      },
      { timeout: 8000 }
    );
    const cell = document.querySelector(`[data-cell-id="${cellId}"]`) as HTMLElement;
    fireEvent.click(cell.tagName === "BUTTON" ? cell : within(cell).getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("champ-ledger-drawer")).toBeDefined());
  }

  it("lists the four playoff outcomes at the DCMP WEIGHT for a DCMP Playoffs cell, and draws no histogram", async () => {
    renderUnderWay();
    await clickCell("dcmp-row:elim");
    const drawer = screen.getByTestId("champ-ledger-drawer");
    const list = within(drawer).getByTestId("district-ledger-drawer-outcomes");
    for (const label of [
      DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS.winner,
      DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS.finalist,
      DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS.third,
      DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS.fourth,
    ]) {
      expect(within(list).getByText(label)).toBeDefined();
    }
    // 2026's dcmp-tier placement values: three times the district tier's.
    const text = list.textContent ?? "";
    for (const points of ["90", "60", "39", "21"]) expect(text).toContain(points);
    // The implicit "Out before the top four" row is not listed (261007-3ik).
    expect(within(list).queryByText(DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS.none)).toBeNull();
    expect(within(drawer).queryByTestId("district-ledger-drawer-cell-plot")).toBeNull();
  });

  it("lists the award outcomes at the DCMP weight and omits a VETERAN's Rookie All Star row", async () => {
    renderUnderWay();
    await clickCell("dcmp-row:award");
    const list = within(screen.getByTestId("champ-ledger-drawer")).getByTestId("district-ledger-drawer-outcomes");
    expect(within(list).getByText(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS.impact)).toBeDefined();
    expect(within(list).getByText(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS.judged)).toBeDefined();
    // The implicit "No award" row is not listed (261007-3ik).
    expect(within(list).queryByText(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS.none)).toBeNull();
    // Every fixture team is a veteran (`awardProfile.rookie` is false), and a
    // veteran cannot win Rookie All Star, so the row is omitted rather than
    // printed at zero.
    expect(within(list).queryByText(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS.rookieAllStar)).toBeNull();
    // 30 for Impact, the 3x weight.
    expect(list.textContent ?? "").toContain("30");
  });

  it("draws the HISTOGRAM for a District points Playoffs cell, because no named outcome covers a sum of events", async () => {
    renderUnderWay();
    await clickCell("district-row:elim");
    const drawer = screen.getByTestId("champ-ledger-drawer");
    expect(within(drawer).getByTestId("district-ledger-drawer-cell-plot")).toBeDefined();
    expect(within(drawer).queryByTestId("district-ledger-drawer-outcomes")).toBeNull();
  });

  it("draws the grand total ONCE in one verdict pane, with one source line naming both sources", async () => {
    renderUnderWay();
    await clickCell("grand");
    const drawer = screen.getByTestId("champ-ledger-drawer");
    expect(within(drawer).getAllByTestId("district-ledger-drawer-grand-plot")).toHaveLength(1);
    expect(within(drawer).queryByTestId("district-ledger-drawer-cell-plot")).toBeNull();
    expect(within(drawer).getByTestId("district-ledger-verdict-eyebrow").textContent ?? "").toMatch(/^Grand total · \d+ /);
    expect(within(drawer).getByTestId("district-ledger-verdict-headline").textContent ?? "").toMatch(
      /^(Qualifies in (\d+|fewer than 5) of 100 runs\.|Already qualified\.|Cannot qualify on points\.|Chance still being simulated\.|No call at this position\.|Likely \d+–\d+ grand total points\.)$/
    );
    const source = within(drawer).getByTestId("district-ledger-verdict-source").textContent ?? "";
    expect(source).toContain("district events");
    expect(/predicted at the DCMP|earned at the DCMP|district points only/.test(source), source).toBe(true);
  });

  /**
   * REWOUND TO SEASON START the District Championship has not happened yet, so
   * every team's place in the field is open again even though the artifact
   * lists the registration. Since quick task 260927-6bf the DCMP row there is
   * the ESTIMATE by field rank, never the real roster's prediction, and the
   * grand total weighs it by the chance of being there.
   */
  it("prints the field chance on the grand total's DCMP chip and heads an open DCMP subtotal with it, at a rewound position", async () => {
    renderUnderWay("/districts?algorithm=spr&tab=champ-locks&at=season-start");
    // TWO Worker jobs stand between the first paint and this line: the
    // per-event run over both open events, and the district advancement chance
    // over its results. The default one-second wait is not enough for both.
    let teamKey = "";
    await waitFor(
      () => {
        // A team whose place in the field is still OPEN, under one.
        const open = screen
          .getAllByTestId("champ-ledger-source-cell")
          .filter((cell) => cell.getAttribute("data-row") === "dcmp")
          .find((cell) => {
            const match = /(<5|~(\d+))% to be there/.exec(cell.textContent ?? "");
            return match !== null && (match[1] === "<5" || Number(match[2]) < 99);
          });
        expect(open).toBeDefined();
        teamKey = open!.closest("tr")!.getAttribute("data-team")!;
        const grand = document.querySelector(`[data-testid="champ-ledger-row"][data-team="${teamKey}"] [data-cell-id="grand"]`);
        expect(grand?.getAttribute("data-cell")).toBe("open");
      },
      { timeout: 20000 }
    );
    fireEvent.click(document.querySelector(`[data-testid="champ-ledger-row"][data-team="${teamKey}"] button[data-cell-id="grand"]`) as HTMLElement);
    const grandDrawer = await screen.findByTestId("champ-ledger-drawer");
    expect(within(grandDrawer).getByTestId("district-ledger-verdict-source").textContent ?? "").toMatch(
      /predicted at the DCMP, in the field (\d+|<5)% of runs/
    );

    const subtotal = document.querySelector(`[data-testid="champ-ledger-row"][data-team="${teamKey}"] [data-cell-id="dcmp-row:eventTotal"]`) as HTMLElement;
    expect(subtotal.getAttribute("data-cell")).toBe("open");
    fireEvent.click(within(subtotal).getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("champ-ledger-drawer").getAttribute("data-drawer-cell")).toBe("dcmp-row:eventTotal"));
    const drawer = screen.getByTestId("champ-ledger-drawer");
    expect(within(drawer).getByTestId("district-ledger-verdict-eyebrow").textContent ?? "").toMatch(/^DCMP subtotal · /);
    expect(within(drawer).getByTestId("district-ledger-verdict-headline").textContent ?? "").toMatch(
      /^In the field in (\d+|fewer than 5) of 100 runs, and ~\d+ points if there\.$/
    );
  }, 30000);

  /**
   * FINDING 3 (quick task 260927-6bf): a rewound position before the DCMP
   * starts used to read "district only" and suppress the champ run. It now
   * prices every team from the estimate, draws the simulated line, and reads
   * nothing off the real DCMP roster: the DCMP category cells stay "not yet
   * priced" even though the championship's own artifact is on hand.
   */
  it("prices every team from the estimate at a rewound position before the DCMP, with no district only and the champ run not suppressed", async () => {
    renderUnderWay("/districts?algorithm=spr&tab=champ-locks&at=season-start");
    const statLine = await waitForSimulatedLine();
    expect(statLine.textContent).not.toContain("district only");
    expect(within(statLine).queryByTestId("district-ledger-cutoff-likely")).not.toBeNull();
    expect(screen.queryAllByTestId("champ-ledger-district-only")).toHaveLength(0);
    const dcmpRow = rowsFor(ROSTER[0]!)[1]!;
    expect(dcmpRow.querySelectorAll('[data-cell="not-yet-priced"]')).toHaveLength(4);
    expect(dcmpRow.querySelector('[data-cell-id="dcmp-row:eventTotal"]')?.getAttribute("data-cell")).toBe("open");
  }, 30000);

  it("resolves an unknown cell id to CLOSED rather than to a neighbouring cell", async () => {
    renderUnderWay("/districts?algorithm=spr&tab=champ-locks&drawerTeam=100&drawerCell=dcmp-row:nope");
    await waitFor(() => expect(screen.getAllByTestId("champ-ledger-row").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("champ-ledger-drawer")).toBeNull();
  });
});
