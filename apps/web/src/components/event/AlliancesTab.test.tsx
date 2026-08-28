/**
 * 07-VALIDATION.md's Wave 0 EVNT-05 test file, authored before the component
 * (07-14-PLAN.md Task 1, TDD). Every fixture is a hand-written
 * `EventArtifact`-shaped object literal, never a network response and never
 * a helper that reads a real artifact off disk — mirrors
 * `BreakdownTab.test.tsx`'s established fixture discipline exactly.
 *
 * Task 1 covers the tracer path: `combineAlliancePicks`'s D-15 arithmetic
 * (both hand-computed fixtures), `buildAllianceRows`'s ordering, and the
 * rendered six-column table with the independence caveat. Task 2 extends
 * this file with the all-or-nothing absence contracts, the incomplete
 * notice, and the identity guarantees. Task 3 extends it with
 * `hasAllianceData`.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import {
  ALLIANCES_INDEPENDENCE_CAVEAT,
  AlliancesTab,
  buildAllianceRows,
  combineAlliancePicks,
} from "./AlliancesTab";

type ArtifactTeam = EventArtifact["teams"][number];
type ArtifactAlliance = NonNullable<EventArtifact["alliances"]>[number];

const ChildrenContext = createContext<ReactNode>(null);

function RouteBody() {
  return <>{useContext(ChildrenContext)}</>;
}

function TestHarness({ children }: { children: ReactNode }) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ validateSearch: RootSearchSchema });
    const eventRoute = createRoute({ path: "/event/$eventKey", getParentRoute: () => rootRoute, component: RouteBody });
    const teamRoute = createRoute({ path: "/team/$teamNumber", getParentRoute: () => rootRoute, validateSearch: TeamSearchSchema, component: () => null });
    const routeTree = rootRoute.addChildren([eventRoute, teamRoute]);
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/event/2024casf"] }) });
  });
  return (
    <ChildrenContext.Provider value={children}>
      <RouterProvider router={router} />
    </ChildrenContext.Provider>
  );
}

function team(overrides: Partial<ArtifactTeam> = {}): ArtifactTeam {
  return {
    teamKey: "frc1",
    teamNumber: 1,
    nickname: "Alpha",
    metrics: { [TOTAL_KEY]: { value: 10, spread: 10 } },
    ...overrides,
  };
}

function alliance(overrides: Partial<ArtifactAlliance> = {}): ArtifactAlliance {
  return {
    allianceNumber: 1,
    picks: ["frc1", "frc2", "frc3"],
    ...overrides,
  };
}

function makeArtifact(teams: ArtifactTeam[], alliances: ArtifactAlliance[] | undefined, overrides: Partial<EventArtifact> = {}): EventArtifact {
  return EventArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-27T00:00:00.000Z",
    algorithmId: "sigma1",
    algorithmVersion: "2.0.0+tuned-2026-08",
    eventKey: "2024casf",
    season: 2024,
    matches: [],
    upcoming: [],
    teams,
    ...(alliances === undefined ? {} : { alliances }),
    ...overrides,
  });
}

/** Four teams whose keys/numbers/nicknames match `alliance()`'s default four-pick shape. */
const FOUR_TEAMS: ArtifactTeam[] = [
  team({ teamKey: "frc1", teamNumber: 1, nickname: "Alpha" }),
  team({ teamKey: "frc2", teamNumber: 2, nickname: "Beta" }),
  team({ teamKey: "frc3", teamNumber: 3, nickname: "Gamma" }),
  team({ teamKey: "frc4", teamNumber: 4, nickname: "Delta" }),
];

function renderAlliances(artifact: EventArtifact, algorithmId = "sigma1", season = 2024) {
  return render(
    <TestHarness>
      <AlliancesTab artifact={artifact} algorithmId={algorithmId} season={season} />
    </TestHarness>,
  );
}

afterEach(() => {
  cleanup();
});

describe("combineAlliancePicks — D-15 combination arithmetic (EVNT-05)", () => {
  it("the D-15 worked example: three picks at {value: 10, spread: 10} combine to value 30.00 and spread 17.32, never 30.00 as the spread", () => {
    const totals = [
      { value: 10, spread: 10 },
      { value: 10, spread: 10 },
      { value: 10, spread: 10 },
    ];
    const combined = combineAlliancePicks(totals);
    expect(combined?.value.toFixed(2)).toBe("30.00");
    expect(combined?.spread?.toFixed(2)).toBe("17.32");
    expect(combined?.spread?.toFixed(2)).not.toBe("30.00");
  });

  it("the exact-integer fixture: spreads 3/4/12 combine to exactly spread 13 (9+16+144=169), values 10.50/20.25/30.10 sum to exactly 60.85", () => {
    const totals = [
      { value: 10.5, spread: 3 },
      { value: 20.25, spread: 4 },
      { value: 30.1, spread: 12 },
    ];
    const combined = combineAlliancePicks(totals);
    expect(combined?.value).toBe(60.85);
    expect(combined?.spread).toBe(13);
  });

  it("returns undefined when the FIRST of the three positions is undefined", () => {
    expect(combineAlliancePicks([undefined, { value: 1, spread: 1 }, { value: 1, spread: 1 }])).toBeUndefined();
  });

  it("returns undefined when the SECOND of the three positions is undefined", () => {
    expect(combineAlliancePicks([{ value: 1, spread: 1 }, undefined, { value: 1, spread: 1 }])).toBeUndefined();
  });

  it("returns undefined when the THIRD of the three positions is undefined", () => {
    expect(combineAlliancePicks([{ value: 1, spread: 1 }, { value: 1, spread: 1 }, undefined])).toBeUndefined();
  });

  it("returns a metric with NO spread when all three values are present but one entry publishes no spread", () => {
    const combined = combineAlliancePicks([{ value: 1 }, { value: 2, spread: 1 }, { value: 3, spread: 1 }]);
    expect(combined?.value).toBe(6);
    expect(combined?.spread).toBeUndefined();
  });
});

describe("buildAllianceRows — ordering (EVNT-05 ordering)", () => {
  it("orders rows by ascending allianceNumber even when the fixture's own array is declared in the order 3, 1, 2", () => {
    const artifact = makeArtifact(FOUR_TEAMS, [
      alliance({ allianceNumber: 3, picks: ["frc1"] }),
      alliance({ allianceNumber: 1, picks: ["frc2"] }),
      alliance({ allianceNumber: 2, picks: ["frc3"] }),
    ]);
    const rows = buildAllianceRows(artifact, "sigma1");
    expect(rows.map((row) => row.allianceNumber)).toEqual([1, 2, 3]);
  });

  it("buildAllianceRows called on a shuffled copy of the same input returns the same mapped allianceNumber sequence", () => {
    const alliances = [
      alliance({ allianceNumber: 2, picks: ["frc1"] }),
      alliance({ allianceNumber: 1, picks: ["frc2"] }),
      alliance({ allianceNumber: 3, picks: ["frc3"] }),
    ];
    const a = makeArtifact(FOUR_TEAMS, alliances);
    const b = makeArtifact(FOUR_TEAMS, [...alliances].reverse());
    expect(buildAllianceRows(a, "sigma1").map((r) => r.allianceNumber)).toEqual(buildAllianceRows(b, "sigma1").map((r) => r.allianceNumber));
  });
});

describe("AlliancesTab — six-column anatomy (EVNT-05, D-15/D-16)", () => {
  it("renders exactly six column headers in the declared order for a sigma1/2024 fixture", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance()]), "sigma1", 2024);
    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(6));
    expect(screen.getAllByRole("columnheader").map((el) => el.textContent)).toEqual([
      "Alliance #",
      "Captain",
      "Pick 2",
      "Pick 3",
      "Backup",
      "Combined Total",
    ]);
  });

  it("renders exactly six column headers in the declared order for an opr/2024 fixture — column count is algorithm-independent", async () => {
    const artifact = makeArtifact(FOUR_TEAMS, [alliance()], { algorithmId: "opr", algorithmVersion: "2.0.0+baseline" });
    renderAlliances(artifact, "opr", 2024);
    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(6));
    expect(screen.getAllByRole("columnheader").map((el) => el.textContent)).toEqual([
      "Alliance #",
      "Captain",
      "Pick 2",
      "Pick 3",
      "Backup",
      "Combined Total",
    ]);
  });

  it("a fourth pick renders in the Backup cell with a (backup) suffix, and its total is excluded from the combined value", async () => {
    const withBackup = makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc3", "frc4"] })]);
    const withoutBackup = makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc3"] })]);

    renderAlliances(withBackup);
    const combinedWith = await screen.findByTestId("alliances-cell-combined");
    const combinedWithText = combinedWith.textContent;
    const backupCell = screen.getByTestId("alliances-cell-pickBackup");
    expect(backupCell.textContent).toContain("4");
    expect(backupCell.textContent).toContain("(backup)");
    cleanup();

    renderAlliances(withoutBackup);
    const combinedWithoutText = (await screen.findByTestId("alliances-cell-combined")).textContent;
    expect(combinedWithText).toBe(combinedWithoutText);
  });

  it("an alliance with exactly three picks renders an em-dash in the Backup column", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc3"] })]));
    expect(await screen.findByTestId("alliances-cell-pickBackup")).toHaveProperty("textContent", "—");
  });

  it("the Combined Total cell carries no class containing metric-tier, even when all three picks publish a percentile of 99", async () => {
    const highPercentileTeams = FOUR_TEAMS.map((t) => ({
      ...t,
      metrics: { [TOTAL_KEY]: { value: 10, spread: 10, percentile: 99, tier: "legendary" as const } },
    }));
    renderAlliances(makeArtifact(highPercentileTeams, [alliance({ picks: ["frc1", "frc2", "frc3"] })]));
    const cell = await screen.findByTestId("alliances-cell-combined");
    expect(cell.className).not.toContain("metric-tier");
    const inner = cell.querySelector(".numeric-cell");
    expect(inner?.className ?? "").not.toContain("metric-tier");
  });

  it("does not render TierKeyRow — there is no tier box on this tab to explain", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance()]));
    await screen.findByTestId("alliances-table-scroll");
    expect(screen.queryByTestId("tier-key-row")).toBeNull();
  });

  it("the independence caveat renders exactly once beneath the table, matching the Copywriting Contract's D-15 row word for word", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance()]));
    const caveat = await screen.findByTestId("alliances-independence-caveat");
    expect(caveat.textContent).toBe(
      "Combined values assume each robot's performance is independent of its alliance partners. Real alliances are not fully independent, so the true uncertainty is likely larger than shown.",
    );
    expect(ALLIANCES_INDEPENDENCE_CAVEAT).toBe(caveat.textContent);
    expect(screen.getAllByTestId("alliances-independence-caveat")).toHaveLength(1);
    expect(within(caveat).queryByRole("button")).toBeNull();
  });

  it("a pick's team number and nickname link to /team/{number} with year/algorithm/tab=overview, matching the sibling tables", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc3"] })]), "sigma1", 2024);
    const link = await screen.findByRole("link", { name: /Alpha/ });
    await waitFor(() => expect(link.getAttribute("href")).toContain("/team/1"));
    expect(link.getAttribute("href")).toContain("algorithm=sigma1");
    expect(link.getAttribute("href")).toContain("year=2024");
  });
});
