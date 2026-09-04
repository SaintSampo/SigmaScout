/**
 * 07-VALIDATION.md's Wave 0 EVNT-02 test file, authored before the component
 * (07-11-PLAN.md Task 1, TDD). Every fixture is a hand-written
 * `EventArtifact`-shaped object, never a network response and never a
 * helper that reads a real artifact off disk — mirrors
 * `BreakdownTab.test.tsx`'s established fixture discipline exactly.
 *
 * This first describe-block set covers Task 1's pure data layer
 * (`buildInsightsRows`, `formatEventRecord`, `insightsFallbackNotice`) only.
 * Task 2 extends this same file with the rendered-table cases, reusing
 * `BreakdownTab.test.tsx`'s own `TestHarness` router-context technique since
 * the Team #/Nickname cells are real router `Link`s here too.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { RootSearchSchema, TeamSearchSchema } from "@/lib/searchParams";
import { algorithmDisplayLabel } from "@/components/ribbon/AlgorithmSelect";
import { METRIC_GROUPS } from "@/lib/metricGroups";
import { TOTAL_KEY } from "@/lib/metricKeys";
import { PINNED_COLUMN_IDS } from "@/components/teams-table/columns";
import { EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import {
  buildInsightsRows,
  formatEventRecord,
  insightsFallbackNotice,
  InsightsTab,
  InsightsTabSkeleton,
} from "./InsightsTab";

type ArtifactTeam = EventArtifact["teams"][number];

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

/** A metrics record carrying every Insights group key plus Total, so column-set/tier tests have real data behind every column. */
function fullInsightsMetrics(overrides: Record<string, { value: number; spread?: number; percentile?: number }> = {}) {
  const record: ArtifactTeam["metrics"] = { [TOTAL_KEY]: { value: 10 } };
  for (const group of METRIC_GROUPS) {
    record[group.metricKey] = { value: 10 };
  }
  return { ...record, ...overrides };
}

function renderInsights(artifact: EventArtifact, algorithmId = "vpr", season = 2024) {
  return render(
    <TestHarness>
      <InsightsTab artifact={artifact} algorithmId={algorithmId} season={season} />
    </TestHarness>,
  );
}

function team(overrides: Partial<ArtifactTeam> = {}): ArtifactTeam {
  return {
    teamKey: "frc254",
    teamNumber: 254,
    nickname: "The Cheesy Poofs",
    metrics: { [TOTAL_KEY]: { value: 48.33, spread: 2.32 } },
    ...overrides,
  };
}

/** Builds a valid artifact through `EventArtifactSchema.parse` — the real schema, proving the fixture matches the published shape. */
function makeArtifact(teams: ArtifactTeam[], overrides: Partial<EventArtifact> = {}): EventArtifact {
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
    ...overrides,
  });
}

describe("buildInsightsRows — official vs fallback ordering (EVNT-02, D-07/D-08)", () => {
  it("every team carrying a rank returns orderSource 'official' and rows in ascending rank order, regardless of input order", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc3", teamNumber: 3, rank: 3, metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc1", teamNumber: 1, rank: 1, metrics: { [TOTAL_KEY]: { value: 3 } } }),
      team({ teamKey: "frc2", teamNumber: 2, rank: 2, metrics: { [TOTAL_KEY]: { value: 2 } } }),
    ]);
    const model = buildInsightsRows(artifact, "vpr");
    expect(model.orderSource).toBe("official");
    expect(model.rows.map((row) => row.teamNumber)).toEqual([1, 2, 3]);
  });

  it("no team carrying a rank returns orderSource 'fallback' and rows in descending TOTAL_KEY order", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } } }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 30 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 20 } } }),
    ]);
    const model = buildInsightsRows(artifact, "vpr");
    expect(model.orderSource).toBe("fallback");
    expect(model.rows.map((row) => row.teamNumber)).toEqual([2, 3, 1]);
  });

  it("some teams ranked, some not: orderSource is 'official', ranked teams order ascending, every unranked team sorts after all ranked ones", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc2", teamNumber: 2, rank: 2, metrics: { [TOTAL_KEY]: { value: 2 } } }),
      team({ teamKey: "frc3", teamNumber: 3, rank: 1, metrics: { [TOTAL_KEY]: { value: 3 } } }),
    ]);
    const model = buildInsightsRows(artifact, "vpr");
    expect(model.orderSource).toBe("official");
    expect(model.rows.map((row) => row.teamNumber)).toEqual([3, 2, 1]);
    const firstUnrankedIndex = model.rows.findIndex((row) => row.displayRank === undefined);
    expect(firstUnrankedIndex).toBe(2);
  });

  it("two teams sharing the exact same rank return as two separate rows in ascending team-number order, row count unchanged, neither rank renumbered", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc9", teamNumber: 9, rank: 5, metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc3", teamNumber: 3, rank: 5, metrics: { [TOTAL_KEY]: { value: 2 } } }),
    ]);
    const model = buildInsightsRows(artifact, "vpr");
    expect(model.rows).toHaveLength(2);
    expect(model.rows.map((row) => row.teamNumber)).toEqual([3, 9]);
    expect(model.rows.map((row) => row.displayRank)).toEqual([5, 5]);
  });

  it("two unranked teams with exactly equal TOTAL_KEY values return in ascending team-number order", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc9", teamNumber: 9, metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 15 } } }),
    ]);
    const model = buildInsightsRows(artifact, "vpr");
    expect(model.rows.map((row) => row.teamNumber)).toEqual([3, 9]);
  });

  it("in fallback mode a team whose metrics carries no TOTAL_KEY entry sorts last", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: {} }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: -50 } } }),
    ]);
    const model = buildInsightsRows(artifact, "vpr");
    expect(model.orderSource).toBe("fallback");
    expect(model.rows.map((row) => row.teamNumber)).toEqual([2, 1]);
  });

  it("feeding the same roster twice, once shuffled, returns the identical ordered sequence of teamKey values — official mode", () => {
    const teamsA = [
      team({ teamKey: "frc9", teamNumber: 9, rank: 3, metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc3", teamNumber: 3, rank: 1, metrics: { [TOTAL_KEY]: { value: 2 } } }),
      team({ teamKey: "frc5", teamNumber: 5, rank: 2, metrics: { [TOTAL_KEY]: { value: 3 } } }),
    ];
    const teamsB = [teamsA[2] as ArtifactTeam, teamsA[0] as ArtifactTeam, teamsA[1] as ArtifactTeam];
    const modelA = buildInsightsRows(makeArtifact(teamsA), "vpr");
    const modelB = buildInsightsRows(makeArtifact(teamsB), "vpr");
    expect(modelA.rows.map((row) => row.teamKey)).toEqual(modelB.rows.map((row) => row.teamKey));
    expect(modelA.rows.map((row) => row.teamKey)).toEqual(["frc3", "frc5", "frc9"]);
  });

  it("feeding the same roster twice, once shuffled, returns the identical ordered sequence of teamKey values — fallback mode", () => {
    const teamsA = [
      team({ teamKey: "frc9", teamNumber: 9, metrics: { [TOTAL_KEY]: { value: 15 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 40 } } }),
      team({ teamKey: "frc5", teamNumber: 5, metrics: { [TOTAL_KEY]: { value: 20 } } }),
    ];
    const teamsB = [teamsA[2] as ArtifactTeam, teamsA[0] as ArtifactTeam, teamsA[1] as ArtifactTeam];
    const modelA = buildInsightsRows(makeArtifact(teamsA), "vpr");
    const modelB = buildInsightsRows(makeArtifact(teamsB), "vpr");
    expect(modelA.rows.map((row) => row.teamKey)).toEqual(modelB.rows.map((row) => row.teamKey));
    expect(modelA.rows.map((row) => row.teamKey)).toEqual(["frc3", "frc5", "frc9"]);
  });

  it("displayRank equals the team's own published rank in official mode, undefined for an unranked team inside a ranked event", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, rank: 7, metrics: { [TOTAL_KEY]: { value: 1 } } }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 2 } } }),
    ]);
    const model = buildInsightsRows(artifact, "vpr");
    const ranked = model.rows.find((row) => row.teamNumber === 1);
    const unranked = model.rows.find((row) => row.teamNumber === 2);
    expect(ranked?.displayRank).toBe(7);
    expect(unranked?.displayRank).toBeUndefined();
  });

  it("displayRank in fallback mode is the 1-based position in the returned order, starting at 1 with no gaps", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, metrics: { [TOTAL_KEY]: { value: 10 } } }),
      team({ teamKey: "frc2", teamNumber: 2, metrics: { [TOTAL_KEY]: { value: 30 } } }),
      team({ teamKey: "frc3", teamNumber: 3, metrics: { [TOTAL_KEY]: { value: 20 } } }),
    ]);
    const model = buildInsightsRows(artifact, "vpr");
    expect(model.rows.map((row) => row.displayRank)).toEqual([1, 2, 3]);
  });

  it("an artifact with teams: [] returns zero rows and orderSource 'fallback' — no rank exists, so the discriminant is honest even with nothing to order", () => {
    const model = buildInsightsRows(makeArtifact([]), "vpr");
    expect(model.rows).toHaveLength(0);
    expect(model.orderSource).toBe("fallback");
  });

  it("a one-team artifact returns one row through the same code path as a 43-team one", () => {
    const oneTeamModel = buildInsightsRows(makeArtifact([team({ rank: 1 })]), "vpr");
    expect(oneTeamModel.rows).toHaveLength(1);

    const manyTeams = Array.from({ length: 43 }, (_, index) =>
      team({ teamKey: `frc${index + 1}`, teamNumber: index + 1, rank: index + 1, nickname: `Team ${index + 1}` }),
    );
    const manyTeamsModel = buildInsightsRows(makeArtifact(manyTeams), "vpr");
    expect(manyTeamsModel.rows).toHaveLength(43);
  });
});

describe("buildInsightsRows — record/rp pass-through (EVNT-02 empty)", () => {
  it("record passes through verbatim: a published record carries exactly that object; a team with no record carries undefined", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, record: { wins: 4, losses: 2, ties: 1 } }),
      team({ teamKey: "frc2", teamNumber: 2 }),
    ]);
    const model = buildInsightsRows(artifact, "vpr");
    const withRecord = model.rows.find((row) => row.teamNumber === 1);
    const withoutRecord = model.rows.find((row) => row.teamNumber === 2);
    expect(withRecord?.record).toEqual({ wins: 4, losses: 2, ties: 1 });
    expect(withoutRecord?.record).toBeUndefined();
  });

  it("rp passes through verbatim including a real 0; a team with no rp carries undefined", () => {
    const artifact = makeArtifact([
      team({ teamKey: "frc1", teamNumber: 1, rp: 0 }),
      team({ teamKey: "frc2", teamNumber: 2 }),
    ]);
    const model = buildInsightsRows(artifact, "vpr");
    const withRp = model.rows.find((row) => row.teamNumber === 1);
    const withoutRp = model.rows.find((row) => row.teamNumber === 2);
    expect(withRp?.rp).toBe(0);
    expect(withRp?.rp).not.toBeUndefined();
    expect(withoutRp?.rp).toBeUndefined();
  });

  it("teamNumber falls back to the team key's digits and nickname to a Team {number} string when either is absent", () => {
    const artifact = makeArtifact([{ teamKey: "frc42", metrics: { [TOTAL_KEY]: { value: 10 } } }]);
    const row = buildInsightsRows(artifact, "vpr").rows[0];
    expect(row?.teamNumber).toBe(42);
    expect(row?.nickname).toBe("Team 42");
  });
});

describe("formatEventRecord (EVNT-02 empty)", () => {
  it("returns wins-losses-ties hyphenated for a published record", () => {
    expect(formatEventRecord({ wins: 4, losses: 2, ties: 1 })).toBe("4-2-1");
  });

  it("returns an empty string for an absent record (2026-09-01: blank, never an em-dash placeholder)", () => {
    expect(formatEventRecord(undefined)).toBe("");
    // The neighbouring all-zero test is what keeps this from being a weak
    // assertion: absence renders as nothing, a real 0-0-0 still renders.
  });

  it("returns the three-zero hyphenated string for a genuine all-zero record — never conflated with absence", () => {
    expect(formatEventRecord({ wins: 0, losses: 0, ties: 0 })).toBe("0-0-0");
  });
});

describe("insightsFallbackNotice (D-08 Copywriting Contract)", () => {
  it("begins with the hand-written literal leading clause and contains the given label", () => {
    const sentence = insightsFallbackNotice("VPR");
    expect(sentence.startsWith("This event has no official TBA ranking. Teams below are ordered by ")).toBe(true);
    expect(sentence).toContain("VPR");
  });
});

describe("InsightsTab — column set (EVNT-02, Task 2)", () => {
  it("vpr/2024: exactly nine headers, in the declared order", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: fullInsightsMetrics() }],
    });
    renderInsights(artifact, "vpr", 2024);

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(9));
    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["Rank", "Team #", "Team Name", "Record", "RP", "Auto", "Teleop", "Endgame", "Total"]);
  });

  it("opr/2024: also exactly nine headers — the column count is algorithm-independent, unlike Breakdown's", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: { [TOTAL_KEY]: { value: 20 } } }],
    });
    renderInsights(artifact, "opr", 2024);

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(9));
  });

  it("column order is the fixed declared order even when the fixture's metrics literal declares phaseEndgame before phaseAuto", async () => {
    const reversed: ArtifactTeam["metrics"] = {
      [TOTAL_KEY]: { value: 10 },
      phaseEndgame: { value: 3 },
      phaseTeleop: { value: 2 },
      phaseAuto: { value: 1 },
    };
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: reversed }],
    });
    renderInsights(artifact, "vpr", 2024);

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(9));
    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["Rank", "Team #", "Team Name", "Record", "RP", "Auto", "Teleop", "Endgame", "Total"]);
  });
});

describe("InsightsTab — D-08 fallback header and banner", () => {
  function artifactWithRanks(teams: { rank?: number }[]) {
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
      teams: teams.map((overrides, index) => ({
        teamKey: `frc${index + 1}`,
        teamNumber: index + 1,
        nickname: `Team ${index + 1}`,
        metrics: fullInsightsMetrics(),
        ...overrides,
      })),
    });
  }

  it("no ranks: fallback header contains the algorithm's display label and the word Rank, and the banner renders", async () => {
    renderInsights(artifactWithRanks([{}, {}]), "vpr", 2024);

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(9));
    const rankHeader = screen.getAllByRole("columnheader")[0];
    expect(rankHeader?.textContent).toContain(algorithmDisplayLabel("vpr"));
    expect(rankHeader?.textContent).toContain("Rank");

    const banner = screen.getByTestId("insights-fallback-banner");
    expect(banner.textContent?.startsWith("This event has no official TBA ranking.")).toBe(true);
    expect(banner.querySelector("button")).toBeNull();
    expect(banner.getAttribute("role")).toBeNull();
  });

  it("has ranks: the leading header is exactly the word Rank, and the banner does not exist at all", async () => {
    renderInsights(artifactWithRanks([{ rank: 1 }, { rank: 2 }]), "vpr", 2024);

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(9));
    const rankHeader = screen.getAllByRole("columnheader")[0];
    expect(rankHeader?.textContent).toBe("Rank");
    expect(screen.queryByTestId("insights-fallback-banner")).toBeNull();
  });
});

describe("InsightsTab — pinning (UI-SPEC E3 overflow, structural half)", () => {
  it("Rank/Team #/Nickname carry data-pinned=true; Record/RP/Auto/Teleop/Endgame carry data-pinned=false", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: fullInsightsMetrics() }],
    });
    renderInsights(artifact);

    await waitFor(() => expect(screen.getByTestId("insights-header-rank")).toBeDefined());
    for (const columnId of PINNED_COLUMN_IDS) {
      expect(screen.getByTestId(`insights-header-${columnId}`).getAttribute("data-pinned")).toBe("true");
      expect(screen.getByTestId(`insights-cell-${columnId}`).getAttribute("data-pinned")).toBe("true");
    }
    for (const columnId of ["record", "rp", ...METRIC_GROUPS.map((group) => group.metricKey)]) {
      expect(screen.getByTestId(`insights-header-${columnId}`).getAttribute("data-pinned")).toBe("false");
      expect(screen.getByTestId(`insights-cell-${columnId}`).getAttribute("data-pinned")).toBe("false");
    }
  });
});

describe("InsightsTab — Record and RP cells (EVNT-02 empty, RP prohibition)", () => {
  function oneTeamArtifact(overrides: Partial<ArtifactTeam> = {}) {
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
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: fullInsightsMetrics(), ...overrides }],
    });
  }

  it("a team publishing {wins:8, losses:3, ties:0} renders 8-3-0", async () => {
    renderInsights(oneTeamArtifact({ record: { wins: 8, losses: 3, ties: 0 } }));
    const cell = await screen.findByTestId("insights-cell-record");
    expect(cell.textContent).toBe("8-3-0");
  });

  it("a team with no record renders an em-dash", async () => {
    renderInsights(oneTeamArtifact());
    const cell = await screen.findByTestId("insights-cell-record");
    expect(cell.textContent).toBe("");
  });

  it("a team publishing rp:3.6 renders 3.60", async () => {
    renderInsights(oneTeamArtifact({ rp: 3.6 }));
    const cell = await screen.findByTestId("insights-cell-rp");
    expect(cell.textContent).toBe("3.60");
  });

  it("a team publishing rp:0 renders 0.00 (never an em-dash — a real zero is distinct from absence)", async () => {
    renderInsights(oneTeamArtifact({ rp: 0 }));
    const cell = await screen.findByTestId("insights-cell-rp");
    expect(cell.textContent).toBe("0.00");
  });

  it("a team with no rp renders an em-dash", async () => {
    renderInsights(oneTeamArtifact());
    const cell = await screen.findByTestId("insights-cell-rp");
    expect(cell.textContent).toBe("");
  });

  it("the RP cell carries numeric-cell and never a metric-tier class, even when every phase metric is at percentile 99", async () => {
    renderInsights(oneTeamArtifact({ rp: 12.34, metrics: fullInsightsMetrics({ [TOTAL_KEY]: { value: 10 }, phaseAuto: { value: 1, percentile: 99 }, phaseTeleop: { value: 1, percentile: 99 }, phaseEndgame: { value: 1, percentile: 99 } }) }));
    const cell = await screen.findByTestId("insights-cell-rp");
    expect(cell.className).toContain("numeric-cell");
    expect(cell.querySelector('[class*="metric-tier"]')).toBeNull();
  });

  it("an unranked team inside a ranked event renders an em-dash Rank cell and its row is the last row", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [
        { teamKey: "frc1", teamNumber: 1, nickname: "One", rank: 1, metrics: fullInsightsMetrics() },
        { teamKey: "frc2", teamNumber: 2, nickname: "Two", metrics: fullInsightsMetrics() },
      ],
    });
    renderInsights(artifact);

    await waitFor(() => expect(screen.getAllByTestId("insights-row")).toHaveLength(2));
    const rows = screen.getAllByTestId("insights-row");
    expect(rows[1]?.getAttribute("data-team-number")).toBe("2");
    const lastRankCell = within(rows[1] as HTMLElement).getByTestId("insights-cell-rank");
    expect(lastRankCell.textContent).toBe("");
  });
});

describe("InsightsTab — tier boundaries on the Auto column (D-09)", () => {
  async function renderWithAutoPercentile(percentile: number) {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: fullInsightsMetrics({ phaseAuto: { value: 10, percentile } }) }],
    });
    renderInsights(artifact);
    const cell = await screen.findByTestId("insights-cell-phaseAuto");
    const inner = cell.querySelector(".numeric-cell");
    if (inner === null) throw new Error("MetricValue's numeric-cell span was not found inside the Insights Auto cell");
    return inner as HTMLElement;
  }

  it("percentile 95 yields legendary", async () => {
    expect((await renderWithAutoPercentile(95)).className).toContain("metric-tier--legendary");
  });
  it("percentile 94.9 yields epic", async () => {
    expect((await renderWithAutoPercentile(94.9)).className).toContain("metric-tier--epic");
  });
  it("percentile 75 yields epic", async () => {
    expect((await renderWithAutoPercentile(75)).className).toContain("metric-tier--epic");
  });
  it("percentile 74.9 yields rare", async () => {
    expect((await renderWithAutoPercentile(74.9)).className).toContain("metric-tier--rare");
  });
  it("percentile 50 yields rare", async () => {
    expect((await renderWithAutoPercentile(50)).className).toContain("metric-tier--rare");
  });
  it("percentile 49.9 yields no metric-tier class", async () => {
    expect((await renderWithAutoPercentile(49.9)).className).not.toContain("metric-tier");
  });

  it("three consecutive rows all at percentile 96 render three legendary boxes — no de-duplication", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [1, 2, 3].map((n) => ({
        teamKey: `frc${n}`,
        teamNumber: n,
        nickname: `Team ${n}`,
        rank: n,
        metrics: fullInsightsMetrics({ phaseAuto: { value: 10, percentile: 96 } }),
      })),
    });
    renderInsights(artifact);

    await waitFor(() => expect(screen.getAllByTestId("insights-row")).toHaveLength(3));
    const legendaryBoxes = document.querySelectorAll("[data-testid='insights-cell-phaseAuto'] .metric-tier--legendary");
    expect(legendaryBoxes).toHaveLength(3);
  });

  it("a metric with no percentile renders no metric-tier class", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: fullInsightsMetrics() }],
    });
    renderInsights(artifact);
    const cell = await screen.findByTestId("insights-cell-phaseAuto");
    const inner = cell.querySelector(".numeric-cell");
    expect(inner?.className).not.toContain("metric-tier");
  });
});

describe("InsightsTab — partial phase-metric data", () => {
  it("a team missing phaseTeleop renders an em-dash while the Teleop header stays present", async () => {
    const metrics = fullInsightsMetrics();
    delete metrics.phaseTeleop;
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics }],
    });
    renderInsights(artifact);

    await waitFor(() => expect(screen.getByTestId("insights-header-phaseTeleop")).toBeDefined());
    expect(screen.getByTestId("insights-cell-phaseTeleop").textContent).toBe("");
  });

  it("an opr fixture whose team publishes none of the three phase keys renders three em-dash cells and all nine headers", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "opr",
      algorithmVersion: "3.0.0+baseline",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: { [TOTAL_KEY]: { value: 20 } } }],
    });
    renderInsights(artifact, "opr", 2024);

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(9));
    for (const group of METRIC_GROUPS) {
      expect(screen.getByTestId(`insights-cell-${group.metricKey}`).textContent).toBe("");
    }
  });
});

describe("InsightsTab — empty and zero-one-many (EVNT-02 empty)", () => {
  it("teams: [] renders EmptyState naming the event and no table element", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [],
    });
    renderInsights(artifact);

    await waitFor(() => expect(screen.getByText("No teams for 2024casf")).toBeDefined());
    expect(document.querySelector("table")).toBeNull();
  });

  it("a one-team artifact and a 43-team artifact render identical header rows and body row counts of 1 and 43", async () => {
    const oneTeamArtifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc1", teamNumber: 1, nickname: "One", rank: 1, metrics: fullInsightsMetrics() }],
    });
    const { unmount } = renderInsights(oneTeamArtifact);
    await waitFor(() => expect(screen.getAllByTestId("insights-row")).toHaveLength(1));
    const oneTeamHeaders = screen.getAllByRole("columnheader").map((el) => el.textContent);
    unmount();

    const manyTeams = Array.from({ length: 43 }, (_, index) => ({
      teamKey: `frc${index + 1}`,
      teamNumber: index + 1,
      nickname: `Team ${index + 1}`,
      rank: index + 1,
      metrics: fullInsightsMetrics(),
    }));
    const manyTeamsArtifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: manyTeams,
    });
    renderInsights(manyTeamsArtifact);
    await waitFor(() => expect(screen.getAllByTestId("insights-row")).toHaveLength(43));
    const manyTeamHeaders = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(manyTeamHeaders).toEqual(oneTeamHeaders);
  });
});

describe("InsightsTab — long text (UI-SPEC E3 long-text)", () => {
  it("a 60-character nickname renders in full inside the cell's title attribute and carries a truncation class", async () => {
    const longNickname = "A".repeat(60);
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: longNickname, rank: 1, metrics: fullInsightsMetrics() }],
    });
    renderInsights(artifact);

    const cell = await screen.findByTestId("insights-cell-nickname");
    expect(cell.className).toContain("truncate");
    const link = within(cell).getByTitle(longNickname);
    expect(link.textContent).toBe(longNickname);
  });
});

describe("InsightsTab — tier key row, accessibility and scroll region", () => {
  it("TierKeyRow renders exactly once", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: fullInsightsMetrics() }],
    });
    renderInsights(artifact);

    await waitFor(() => expect(screen.getAllByTestId("tier-key-row")).toHaveLength(1));
  });

  it("no columnheader contains a button, and no header carries aria-sort", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: fullInsightsMetrics() }],
    });
    renderInsights(artifact);

    await waitFor(() => expect(screen.getAllByRole("columnheader")).toHaveLength(9));
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.querySelector("button")).toBeNull();
      expect(header.getAttribute("aria-sort")).toBeNull();
    }
  });

  it("exactly one element carries data-testid=insights-table-scroll", async () => {
    const artifact = EventArtifactSchema.parse({
      schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
      generation: "gen-1",
      computedAt: "2026-08-27T00:00:00.000Z",
      algorithmId: "vpr",
      algorithmVersion: "2.0.0+tuned-2026-08",
      eventKey: "2024casf",
      season: 2024,
      matches: [],
      upcoming: [],
      teams: [{ teamKey: "frc254", teamNumber: 254, nickname: "The Cheesy Poofs", rank: 1, metrics: fullInsightsMetrics() }],
    });
    renderInsights(artifact);

    await waitFor(() => expect(screen.getAllByTestId("insights-table-scroll")).toHaveLength(1));
  });
});

describe("InsightsTabSkeleton", () => {
  it("renders the nine real headers with the bare Rank header, skeleton body rows, and zero progressbar elements", () => {
    render(<InsightsTabSkeleton algorithmId="vpr" season={2024} />);

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["Rank", "Team #", "Team Name", "Record", "RP", "Auto", "Teleop", "Endgame", "Total"]);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
