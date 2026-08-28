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
  alliancesIncompleteNotice,
  buildAllianceRows,
  combineAlliancePicks,
  hasAllianceData,
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
    algorithmId: "vpr",
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

function renderAlliances(artifact: EventArtifact, algorithmId = "vpr", season = 2024) {
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
    const rows = buildAllianceRows(artifact, "vpr");
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
    expect(buildAllianceRows(a, "vpr").map((r) => r.allianceNumber)).toEqual(buildAllianceRows(b, "vpr").map((r) => r.allianceNumber));
  });
});

describe("AlliancesTab — six-column anatomy (EVNT-05, D-15/D-16)", () => {
  it("renders exactly six column headers in the declared order for a vpr/2024 fixture", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance()]), "vpr", 2024);
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
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc3"] })]), "vpr", 2024);
    const link = await screen.findByRole("link", { name: /Alpha/ });
    await waitFor(() => expect(link.getAttribute("href")).toContain("/team/1"));
    expect(link.getAttribute("href")).toContain("algorithm=vpr");
    expect(link.getAttribute("href")).toContain("year=2024");
  });
});

// ---------------------------------------------------------------------------
// Task 2 — the all-or-nothing rule from both measured causes, the
// incomplete-combination notice, and the identity/adjacency guarantees.
// ---------------------------------------------------------------------------

const FIVE_TEAMS: ArtifactTeam[] = [
  ...FOUR_TEAMS,
  team({ teamKey: "frc5", teamNumber: 5, nickname: "Epsilon" }),
];

describe("AlliancesTab — the all-or-nothing rule, both measured causes (EVNT-05 empty)", () => {
  it("a three-pick alliance whose third pick's team key has NO row in teams renders an em-dash, never the two-term sum", async () => {
    // frc9 is never in the teams array at all — the live 2024cmptx shape.
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc9"] })]));
    const cell = await screen.findByTestId("alliances-cell-combined");
    expect(cell.textContent).toBe("—");
    // frc1 (value 10) + frc2 (value 10) = 20 — the two-term sum a partial
    // implementation would plausibly render instead.
    expect(cell.textContent).not.toContain("20.00");
  });

  it("the same alliance where the third pick HAS a teams row but that row publishes no total metric renders the same em-dash", async () => {
    const teamsWithNoTotal = [...FOUR_TEAMS, team({ teamKey: "frc9", teamNumber: 9, nickname: "Zeta", metrics: {} })];
    renderAlliances(makeArtifact(teamsWithNoTotal, [alliance({ picks: ["frc1", "frc2", "frc9"] })]));
    const cell = await screen.findByTestId("alliances-cell-combined");
    expect(cell.textContent).toBe("—");
    expect(cell.textContent).not.toContain("20.00");
  });

  it("a two-pick alliance (modelled on 2024vabrb) renders an em-dash Combined Total through the SAME rule, with no special case — Captain/Pick 2 filled, Pick 3 and Backup em-dash", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2"] })]));
    expect((await screen.findByTestId("alliances-cell-combined")).textContent).toBe("—");
    expect(screen.getByTestId("alliances-cell-pick2").textContent).toBe("—");
    expect(screen.getByTestId("alliances-cell-pickBackup").textContent).toBe("—");
    expect(screen.getByTestId("alliances-cell-pick0").textContent).toContain("Alpha");
    expect(screen.getByTestId("alliances-cell-pick1").textContent).toContain("Beta");
  });

  it("a one-pick alliance renders em-dash Combined Total and em-dashes in Pick 2, Pick 3 and Backup, with the single pick in Captain", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1"] })]));
    expect((await screen.findByTestId("alliances-cell-combined")).textContent).toBe("—");
    expect(screen.getByTestId("alliances-cell-pick1").textContent).toBe("—");
    expect(screen.getByTestId("alliances-cell-pick2").textContent).toBe("—");
    expect(screen.getByTestId("alliances-cell-pickBackup").textContent).toBe("—");
    expect(screen.getByTestId("alliances-cell-pick0").textContent).toContain("Alpha");
  });

  it("all three sum positions resolve but only two publish a spread — the summed value renders with NO plus-minus suffix", async () => {
    const teams = [
      team({ teamKey: "frc1", teamNumber: 1, nickname: "Alpha", metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc2", teamNumber: 2, nickname: "Beta", metrics: { [TOTAL_KEY]: { value: 2, spread: 1 } } }),
      team({ teamKey: "frc3", teamNumber: 3, nickname: "Gamma", metrics: { [TOTAL_KEY]: { value: 3, spread: 1 } } }),
    ];
    renderAlliances(makeArtifact(teams, [alliance({ picks: ["frc1", "frc2", "frc3"] })]));
    const cell = await screen.findByTestId("alliances-cell-combined");
    expect(cell.textContent).toContain("6.00");
    expect(cell.textContent).not.toContain("±");
  });
});

describe("AlliancesTab — the incomplete-combination notice (Claude's Discretion, no UI-SPEC row)", () => {
  it("a fixture where every alliance combines renders NO incomplete-notice element at all", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc3"] })]));
    await screen.findByTestId("alliances-table-scroll");
    expect(screen.queryByTestId("alliances-incomplete-notice")).toBeNull();
  });

  it("a 2024cmptx-shaped fixture (8 alliances, 2 unresolvable) renders exactly one notice naming 2, 8 and the algorithm label", async () => {
    const teams = [...FOUR_TEAMS, team({ teamKey: "frc5", teamNumber: 5, nickname: "Epsilon" }), team({ teamKey: "frc6", teamNumber: 6, nickname: "Zeta" })];
    const alliances = [
      alliance({ allianceNumber: 1, picks: ["frc1", "frc2", "frc3"] }),
      alliance({ allianceNumber: 2, picks: ["frc1", "frc2", "frc9"] }), // frc9 unresolvable
      alliance({ allianceNumber: 3, picks: ["frc1", "frc2", "frc3"] }),
      alliance({ allianceNumber: 4, picks: ["frc1", "frc2", "frc3"] }),
      alliance({ allianceNumber: 5, picks: ["frc1", "frc2", "frc3"] }),
      alliance({ allianceNumber: 6, picks: ["frc1", "frc2", "frc3"] }),
      alliance({ allianceNumber: 7, picks: ["frc1", "frc2", "frc9"] }), // frc9 unresolvable
      alliance({ allianceNumber: 8, picks: ["frc1", "frc2", "frc3"] }),
    ];
    renderAlliances(makeArtifact(teams, alliances), "vpr");
    const notice = await screen.findByTestId("alliances-incomplete-notice");
    expect(screen.getAllByTestId("alliances-incomplete-notice")).toHaveLength(1);
    expect(notice.textContent).toContain("2");
    expect(notice.textContent).toContain("8");
    expect(notice.textContent).toContain("VPR");
  });

  it("exactly one incomplete alliance renders the singular form; eight with two incomplete renders the plural form", () => {
    expect(alliancesIncompleteNotice(1, 5, "VPR")).toBe(
      "1 of 5 alliances is missing a combined value because one of its first three picks has no published VPR total.",
    );
    expect(alliancesIncompleteNotice(2, 8, "VPR")).toBe(
      "2 of 8 alliances are missing a combined value because one of their first three picks has no published VPR total.",
    );
    expect(alliancesIncompleteNotice(1, 5, "VPR")).not.toBe(alliancesIncompleteNotice(2, 8, "VPR"));
  });

  it("the notice's icon is aria-hidden, the notice carries no role attribute, and its subtree contains no button", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc9"] })]));
    const notice = await screen.findByTestId("alliances-incomplete-notice");
    expect(notice.hasAttribute("role")).toBe(false);
    expect(within(notice).queryByRole("button")).toBeNull();
    const icon = notice.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("the notice renders BENEATH the independence caveat in document order", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc9"] })]));
    const caveat = await screen.findByTestId("alliances-independence-caveat");
    const notice = await screen.findByTestId("alliances-incomplete-notice");
    // DOM_POSITION_FOLLOWING means `notice` comes after `caveat`.
    expect(caveat.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("AlliancesTab — ordering, adjacency and identity (EVNT-05 adjacency)", () => {
  it("two alliances sharing an identical allianceNumber render as two separate rows, in ascending first-pick team-key order, neither renumbered", () => {
    const artifact = makeArtifact(FOUR_TEAMS, [
      alliance({ allianceNumber: 1, picks: ["frc3"] }),
      alliance({ allianceNumber: 1, picks: ["frc1"] }),
    ]);
    const rows = buildAllianceRows(artifact, "vpr");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.allianceNumber)).toEqual([1, 1]);
    expect(rows.map((row) => row.picks[0]?.teamKey)).toEqual(["frc1", "frc3"]);
  });

  it("two alliances whose Combined Totals are exactly equal render as two separate rows, never merged or de-duplicated", () => {
    const artifact = makeArtifact(FOUR_TEAMS, [
      alliance({ allianceNumber: 1, picks: ["frc1", "frc2", "frc3"] }),
      alliance({ allianceNumber: 2, picks: ["frc1", "frc2", "frc3"] }),
    ]);
    const rows = buildAllianceRows(artifact, "vpr");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.combined?.value).toBe(rows[1]?.combined?.value);
  });

  it("a five-pick alliance renders entries at positions 3 AND 4 in the Backup cell, both as links, neither dropped", async () => {
    renderAlliances(makeArtifact(FIVE_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc3", "frc4", "frc5"] })]));
    const backupCell = await screen.findByTestId("alliances-cell-pickBackup");
    expect(within(backupCell).getAllByRole("link")).toHaveLength(2);
  });

  it("a pick whose team key has no teams row still renders its team number as a link; the nickname position renders an em-dash", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc9", "frc1", "frc2"] })]));
    const captainCell = await screen.findByTestId("alliances-cell-pick0");
    expect(captainCell.textContent).toContain("9");
    const link = within(captainCell).getByRole("link");
    expect(within(link).getByText("—")).toBeDefined();
  });

  it("a one-alliance fixture and an eight-alliance fixture render identical header rows and body-row counts of 1 and 8 — the count is never branched on", async () => {
    renderAlliances(makeArtifact(FOUR_TEAMS, [alliance({ picks: ["frc1", "frc2", "frc3"] })]));
    await waitFor(() => expect(screen.getAllByTestId("alliances-row")).toHaveLength(1));
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    cleanup();

    const eightAlliances = Array.from({ length: 8 }, (_, i) => alliance({ allianceNumber: i + 1, picks: ["frc1", "frc2", "frc3"] }));
    renderAlliances(makeArtifact(FOUR_TEAMS, eightAlliances));
    await waitFor(() => expect(screen.getAllByTestId("alliances-row")).toHaveLength(8));
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
  });

  it("a 60-character nickname renders in full inside the cell's title attribute and the cell carries a truncation class — never a sliced text node", async () => {
    const longNickname = "A".repeat(60);
    const teams = [team({ teamKey: "frc1", teamNumber: 1, nickname: longNickname }), team({ teamKey: "frc2", teamNumber: 2 }), team({ teamKey: "frc3", teamNumber: 3 })];
    renderAlliances(makeArtifact(teams, [alliance({ picks: ["frc1", "frc2", "frc3"] })]));
    const captainCell = await screen.findByTestId("alliances-cell-pick0");
    const nicknameSpan = within(captainCell).getByTitle(longNickname);
    expect(nicknameSpan.textContent).toBe(longNickname);
    expect(nicknameSpan.className).toContain("truncate");
  });
});

// ---------------------------------------------------------------------------
// Task 3 — D-17: hasAllianceData, the predicate the route's disabled-trigger
// state consults. Absent and empty are two separately named cases because
// 07-08's PD-03 makes them distinguishable at the artifact level and D-17
// deliberately collapses them — a test exercising only one would not prove
// the collapse.
// ---------------------------------------------------------------------------

describe("hasAllianceData — D-17's collapse of two distinguishable absences (EVNT-05)", () => {
  it("returns false for an artifact with no alliances key at all", () => {
    const artifact = makeArtifact(FOUR_TEAMS, undefined);
    expect(hasAllianceData(artifact)).toBe(false);
  });

  it("returns false for an artifact whose alliances is an empty array", () => {
    const artifact = makeArtifact(FOUR_TEAMS, []);
    expect(hasAllianceData(artifact)).toBe(false);
  });

  it("returns true for an artifact with one alliance", () => {
    const artifact = makeArtifact(FOUR_TEAMS, [alliance()]);
    expect(hasAllianceData(artifact)).toBe(true);
  });
});
