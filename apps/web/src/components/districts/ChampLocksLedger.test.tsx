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
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
import { ChampLocksLedger } from "./ChampLocksLedger.js";
import { CHAMP_LEDGER_COLUMN_LABELS } from "./districtLedgerCopy.js";

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

const RP_PMF = [0.2, 0.3, 0.3, 0.2];

function liveEventArtifact(): EventArtifact {
  const matches = [];
  const upcoming = [];
  for (let m = 0; m < 6; m++) {
    const red = [ROSTER[(m * 6) % 24]!, ROSTER[(m * 6 + 1) % 24]!, ROSTER[(m * 6 + 2) % 24]!];
    const blue = [ROSTER[(m * 6 + 3) % 24]!, ROSTER[(m * 6 + 4) % 24]!, ROSTER[(m * 6 + 5) % 24]!];
    matches.push({
      matchKey: `${LIVE_EVENT}_qm${String(m + 1)}`,
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
      matchKey: `${LIVE_EVENT}_qm${String(m + 1)}`,
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
    eventKey: LIVE_EVENT,
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

function installFetch(eventArtifact?: EventArtifact) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v1/manifest/algorithms.json")) return Promise.resolve(new Response(JSON.stringify(manifestBody()), { status: 200 }));
    if (url.includes("/v1/event/") && eventArtifact !== undefined) {
      return Promise.resolve(new Response(JSON.stringify(eventArtifact), { status: 200 }));
    }
    return Promise.resolve(new Response("", { status: 404 }));
  }) as unknown as typeof fetch;
}

const realRunScript: MockWorkerScript = (message, ctx) => {
  runDistrictWorkerJob(message, (outbound) => ctx.post(outbound));
};

function renderLedger(artifact: DistrictArtifact) {
  render(
    <TestHarness>
      <ChampLocksLedger artifact={artifact} algorithm="spr" season={SEASON} />
    </TestHarness>
  );
}

/** Both of one team's rows, in render order. */
function rowsFor(teamKey: string): HTMLElement[] {
  return screen.getAllByTestId("champ-ledger-row").filter((row) => row.getAttribute("data-team") === teamKey);
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

  it("renders every column label, in order, from the exported tuple", async () => {
    renderFinished();
    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("columnheader").map((el) => el.textContent)).toEqual([...CHAMP_LEDGER_COLUMN_LABELS]);
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
 * The orchestrator's own acceptance for quick task 260925-xab: a synthetic
 * artifact with no dcmp-tier event anywhere must render the "not yet priced"
 * cells, the "district only" grand total, and a computed status for every team.
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
    installFetch(liveEventArtifact());
    handle = installMockWorker({ script: realRunScript });
    renderLedger(districtSeasonArtifact());
  }

  it("reads every DCMP cell as not yet priced rather than as an em dash or as not available", async () => {
    renderDistrictSeason();
    await waitFor(() => expect(screen.getAllByTestId("champ-ledger-row").length).toBe(ROSTER.length * 2));
    const dcmpRow = rowsFor(ROSTER[0]!)[1]!;
    const unpriced = [...dcmpRow.querySelectorAll('[data-cell="not-yet-priced"]')];
    expect(unpriced).toHaveLength(5);
    for (const cell of unpriced) expect(cell.textContent).toBe("not yet priced");
    expect(dcmpRow.querySelectorAll('[data-cell="not-in-field"]')).toHaveLength(0);
    expect(dcmpRow.querySelectorAll('[data-cell="unavailable"]')).toHaveLength(0);
  });

  it("prints the DISTRICT-ONLY grand total, labelled, for every team rather than blanking the column", async () => {
    renderDistrictSeason();
    // Waited for rather than asserted on the first paint: the live event's
    // distributions arrive from the Worker, and until they do the district
    // half has nothing to convolve either.
    await waitFor(() => expect(screen.getAllByTestId("champ-ledger-district-only")).toHaveLength(ROSTER.length));
    for (const label of screen.getAllByTestId("champ-ledger-district-only")) expect(label.textContent).toBe("district only");
    const grand = within(rowsFor(ROSTER[0]!)[0]!).getByTestId("champ-ledger-grand-total");
    expect(grand.querySelector('[data-cell="unavailable"]')).toBeNull();
  });

  it("computes a status for EVERY team, never Capacity not published", async () => {
    renderDistrictSeason();
    await waitFor(() => expect(screen.getAllByTestId("champ-ledger-row").length).toBe(ROSTER.length * 2));
    const cells = screen.getAllByTestId("district-ledger-status-cell");
    expect(cells).toHaveLength(ROSTER.length);
    for (const cell of cells) {
      expect(cell.getAttribute("data-status")).not.toBeNull();
      expect(cell.textContent).not.toContain("Capacity not published");
    }
  });

  /**
   * THE ONE CHANCE THIS WINDOW MAY PRINT is the chance of being in the field,
   * on the DCMP row's own label. The CHAMP chance — the chance of reaching the
   * FIRST Championship — is suppressed, because the grand totals it would rank
   * are district-only and ranking them would answer a different question.
   */
  it("carries the to be there line on the DCMP row and NO chance beside the status", async () => {
    renderDistrictSeason();
    await waitFor(() => {
      const dcmpSources = screen.getAllByTestId("champ-ledger-source-cell").filter((cell) => cell.getAttribute("data-row") === "dcmp");
      expect(dcmpSources.some((cell) => /to be there/.test(cell.textContent ?? ""))).toBe(true);
    });
    const dcmpSources = screen.getAllByTestId("champ-ledger-source-cell").filter((cell) => cell.getAttribute("data-row") === "dcmp");
    for (const cell of dcmpSources) {
      const text = cell.textContent ?? "";
      if (!text.includes("to be there")) continue;
      expect(text).toMatch(/(~\d+% to be there|<5% to be there)/);
    }
    // Never a silent zero and never a champ chance: the status chips carry no
    // number at all in this window.
    expect(screen.queryAllByTestId("district-ledger-chance")).toHaveLength(0);
  });

  it("renders no plus-minus codepoint anywhere in the tree", async () => {
    renderDistrictSeason();
    await waitFor(() => expect(screen.getByTestId("champ-ledger-tab")).toBeDefined());
    expect(document.body.textContent ?? "").not.toContain(PLUS_MINUS);
  });
});
