import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithRouter } from "@/test/routerHarness";
import { RankCards } from "./RankCards.js";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { buildTeamRankScopes, type RankableTeamRow } from "../../../../../packages/harness/teamRanks.js";
import { applyTeamFilters } from "../teams-table/teamFilterModel.js";
import { buildTeamRows } from "../teams-table/rowModel.js";
import type { TeamsArtifact } from "../../../../../packages/harness/pageArtifacts.js";

type Ranks = NonNullable<TeamSeasonArtifact["ranks"]>;

afterEach(() => cleanup());

const DEFAULT_PROPS = { season: 2024, algorithmId: "opr" as const };

describe("RankCards — rendering four scopes in order (quick task 260905-ttv)", () => {
  it("renders four cards, in the order world, country, district, state", () => {
    const ranks: Ranks = [
      { scope: "world", rank: 12, total: 3481 },
      { scope: "country", value: "USA", rank: 8, total: 2900 },
      { scope: "district", value: "fim", rank: 3, total: 60 },
      { scope: "state", value: "MI", rank: 5, total: 120 },
    ];

    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);

    const cards = screen.getAllByTestId("rank-card");
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "World: rank 12 of 3481",
      "USA: rank 8 of 2900",
      "FIRST MI: rank 3 of 60",
      "MI: rank 5 of 120",
    ]);
  });

  it("shows the rank as #N and the denominator as a locale-grouped 'of N', always visible", () => {
    const ranks: Ranks = [{ scope: "world", rank: 12, total: 3481 }];

    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);

    const card = screen.getByTestId("rank-card");
    expect(card.textContent).toContain("#12");
    expect(card.textContent).toContain("of 3,481");
  });

  it("district cards label with the reader-facing districtDisplayName, not the raw key", () => {
    const ranks: Ranks = [{ scope: "district", value: "fim", rank: 3, total: 60 }];

    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);

    const card = screen.getByTestId("rank-card");
    expect(card.textContent).toContain("FIRST MI");
    expect(card.textContent).not.toContain("fim");
  });

  it("the country card labels with the raw country string", () => {
    const ranks: Ranks = [{ scope: "country", value: "USA", rank: 8, total: 2900 }];

    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);

    expect(screen.getByTestId("rank-card").textContent).toContain("USA");
  });

  it("the state card labels with the raw state-prov abbreviation", () => {
    const ranks: Ranks = [{ scope: "state", value: "MI", rank: 5, total: 120 }];

    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);

    expect(screen.getByTestId("rank-card").textContent).toContain("MI");
  });
});

describe("RankCards — graceful absence (quick task 260905-ttv)", () => {
  it("renders nothing at all when ranks is undefined — no heading, no empty row, no skeleton", () => {
    const { container } = renderWithRouter(<RankCards ranks={undefined} {...DEFAULT_PROPS} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByTestId("rank-cards")).toBeNull();
  });

  it("renders nothing at all when ranks is an empty array", () => {
    const { container } = renderWithRouter(<RankCards ranks={[]} {...DEFAULT_PROPS} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByTestId("rank-cards")).toBeNull();
  });
});

describe("RankCards — no basis caption (quick task 260905-ttv, rank cards v2)", () => {
  it("renders no element with data-testid=rank-cards-basis anywhere, in both the four-card and single-card cases", () => {
    const fourCards: Ranks = [
      { scope: "world", rank: 1, total: 10 },
      { scope: "country", value: "USA", rank: 1, total: 8 },
      { scope: "district", value: "fim", rank: 1, total: 6 },
      { scope: "state", value: "MI", rank: 1, total: 4 },
    ];
    const { unmount } = renderWithRouter(<RankCards ranks={fourCards} {...DEFAULT_PROPS} />);
    expect(screen.queryByTestId("rank-cards-basis")).toBeNull();
    unmount();

    renderWithRouter(<RankCards ranks={[{ scope: "world", rank: 1, total: 10 }]} {...DEFAULT_PROPS} />);
    expect(screen.queryByTestId("rank-cards-basis")).toBeNull();
  });
});

describe("RankCards — fixed width and label truncation (quick task 260905-ttv)", () => {
  it("all four cards share the same fixed-width class regardless of label length", () => {
    const ranks: Ranks = [
      { scope: "world", rank: 1, total: 10 },
      { scope: "country", value: "USA", rank: 1, total: 8 },
      { scope: "district", value: "fma", rank: 1, total: 6 }, // "FIRST Mid-Atlantic" -- the long label
      { scope: "state", value: "MI", rank: 1, total: 4 },
    ];

    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);

    for (const card of screen.getAllByTestId("rank-card")) {
      expect(card.className).toContain("rank-card");
    }
  });

  it("a long district label (fma -> FIRST Mid-Atlantic) truncates rather than widening the card, with the full label on a title attribute", () => {
    const ranks: Ranks = [{ scope: "district", value: "fma", rank: 1, total: 6 }];

    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);

    const card = screen.getByTestId("rank-card");
    const labelSpan = card.querySelector("span[title]");
    expect(labelSpan?.textContent).toBe("FIRST Mid-Atlantic");
    expect(labelSpan?.getAttribute("title")).toBe("FIRST Mid-Atlantic");
    expect(labelSpan?.className).toContain("truncate");
  });
});

describe("RankCards — tier colour (quick task 260905-ttv)", () => {
  it("rank 1 of 3481 carries the Legendary modifier class", () => {
    const ranks: Ranks = [{ scope: "world", rank: 1, total: 3481 }];
    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("rank-card").className).toContain("rank-card--legendary");
  });

  it("rank 3481 of 3481 (last place) carries the Common modifier class", () => {
    const ranks: Ranks = [{ scope: "world", rank: 3481, total: 3481 }];
    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("rank-card").className).toContain("rank-card--common");
  });

  it("a mid-pool rank carries the band tierForPercentile puts its percentileForRank value in (rank 500 of 1000 -> Rare)", () => {
    // percentileForRank(500, 1000) = ((1000-500)+0.5)/1000*100 = 50.05 -> Rare [50,75).
    const ranks: Ranks = [{ scope: "world", rank: 500, total: 1000 }];
    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("rank-card").className).toContain("rank-card--rare");
  });

  it("the tier is derived per card from that card's OWN rank/total -- four cards on one team page can carry different tiers", () => {
    const ranks: Ranks = [
      { scope: "world", rank: 3481, total: 3481 }, // Common
      { scope: "district", value: "fim", rank: 1, total: 60 }, // Legendary
    ];
    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);
    const cards = screen.getAllByTestId("rank-card");
    expect(cards[0]?.className).toContain("rank-card--common");
    expect(cards[1]?.className).toContain("rank-card--legendary");
    // At least two different tiers really did render on one page.
    expect(cards[0]?.className).not.toContain("rank-card--legendary");
  });

  it("no card ever carries .metric-tier", () => {
    const ranks: Ranks = [{ scope: "world", rank: 1, total: 3481 }];
    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);
    expect(screen.getByTestId("rank-card").className).not.toContain("metric-tier");
  });
});

describe("RankCards — links (quick task 260905-ttv)", () => {
  it("the World card links to /teams with the page's current year and algorithm and no region params", () => {
    const ranks: Ranks = [{ scope: "world", rank: 12, total: 3481 }];
    renderWithRouter(<RankCards ranks={ranks} season={2024} algorithmId="opr" />);

    const href = screen.getByTestId("rank-card").getAttribute("href") ?? "";
    expect(href.startsWith("/teams")).toBe(true);
    expect(href).toContain("year=2024");
    expect(href).toContain("algorithm=opr");
    expect(href).not.toContain("country=");
    expect(href).not.toContain("district=");
    expect(href).not.toContain("state=");
  });

  it("the Country card adds country=<value>", () => {
    const ranks: Ranks = [{ scope: "country", value: "USA", rank: 8, total: 2900 }];
    renderWithRouter(<RankCards ranks={ranks} season={2024} algorithmId="opr" />);

    const href = screen.getByTestId("rank-card").getAttribute("href") ?? "";
    expect(href).toContain("country=USA");
    expect(href).not.toContain("district=");
    expect(href).not.toContain("state=");
  });

  it("the District card adds district=<value>", () => {
    const ranks: Ranks = [{ scope: "district", value: "fim", rank: 3, total: 60 }];
    renderWithRouter(<RankCards ranks={ranks} season={2024} algorithmId="opr" />);

    const href = screen.getByTestId("rank-card").getAttribute("href") ?? "";
    expect(href).toContain("district=fim");
    expect(href).not.toContain("country=");
    expect(href).not.toContain("state=");
  });

  it("the State card adds BOTH country=USA and state=<value>", () => {
    const ranks: Ranks = [{ scope: "state", value: "MI", rank: 5, total: 120 }];
    renderWithRouter(<RankCards ranks={ranks} season={2024} algorithmId="opr" />);

    const href = screen.getByTestId("rank-card").getAttribute("href") ?? "";
    expect(href).toContain("country=USA");
    expect(href).toContain("state=MI");
    expect(href).not.toContain("district=");
  });

  it("every card's href carries the current year and algorithm, asserted against a non-default algorithm and non-current year", () => {
    const ranks: Ranks = [
      { scope: "world", rank: 1, total: 10 },
      { scope: "country", value: "USA", rank: 1, total: 8 },
      { scope: "district", value: "fim", rank: 1, total: 6 },
      { scope: "state", value: "MI", rank: 1, total: 4 },
    ];
    // 2024 is not CURRENT_SEASON (2026); "opr" is not the default algorithm
    // (DEFAULT_ALGORITHM is "vpr") -- so a hardcoded default would fail this.
    renderWithRouter(<RankCards ranks={ranks} season={2024} algorithmId="opr" />);

    for (const card of screen.getAllByTestId("rank-card")) {
      const href = card.getAttribute("href") ?? "";
      expect(href).toContain("year=2024");
      expect(href).toContain("algorithm=opr");
    }
  });

  it("each card remains a single accessible unit: an accessible link whose name identifies where it goes and carries its numbers", () => {
    const ranks: Ranks = [{ scope: "world", rank: 12, total: 3481 }];
    renderWithRouter(<RankCards ranks={ranks} {...DEFAULT_PROPS} />);

    const link = screen.getByRole("link", { name: "World: rank 12 of 3481" });
    expect(link).toBeDefined();
  });
});

/**
 * The agreement test this whole feature rests on
 * (`260905-ttv-PLAN.md`'s `<the_invariant_this_task_rests_on>`): a district
 * or state scope computed by `buildTeamRankScopes` and the rank
 * `buildTeamRows` computes after `applyTeamFilters` with that card's own
 * link preset produce the SAME rank and the SAME total. This is what makes
 * item 6 ("clicking a rank card lands on a table showing the same number")
 * a promise proven by a test, not a comment.
 */
describe("RankCards — the district/state agreement invariant (quick task 260905-ttv)", () => {
  function buildFixtureRows(): RankableTeamRow[] {
    return [
      { teamKey: "frc1114", teamNumber: 1114, metrics: { total: { value: 50 } }, country: "USA", stateProv: "MI", districtKey: "fim" },
      { teamKey: "frc27", teamNumber: 27, metrics: { total: { value: 40 } }, country: "USA", stateProv: "MI", districtKey: "fim" },
      { teamKey: "frc16", teamNumber: 16, metrics: { total: { value: 60 } }, country: "USA", stateProv: "OH", districtKey: "fim" },
      { teamKey: "frc118", teamNumber: 118, metrics: { total: { value: 70 } }, country: "USA", stateProv: "AL" },
      { teamKey: "frc254", teamNumber: 254, metrics: { total: { value: 90 } }, country: "CAN", stateProv: "ON", districtKey: "ont" },
    ];
  }

  function toArtifactTeams(rows: RankableTeamRow[]): TeamsArtifact["teams"] {
    return rows.map((r) => ({
      teamKey: r.teamKey,
      teamNumber: r.teamNumber,
      nickname: "Team",
      eventCount: 1,
      matchCount: 10,
      record: { wins: 1, losses: 0, ties: 0 },
      metrics: r.metrics as TeamsArtifact["teams"][number]["metrics"],
      country: r.country,
      stateProv: r.stateProv,
      districtKey: r.districtKey,
    }));
  }

  it("the district scope's rank/total agrees with buildTeamRows after applyTeamFilters({district})", () => {
    const rows = buildFixtureRows();
    const scopes = buildTeamRankScopes({ rows, teamKey: "frc1114" });
    const districtScope = scopes.find((s) => s.scope === "district")!;
    expect(districtScope).toBeDefined();

    const artifactTeams = toArtifactTeams(rows);
    const filtered = applyTeamFilters(artifactTeams, { district: districtScope.value });
    const tableRows = buildTeamRows({ season: 2024, teams: filtered } as TeamsArtifact, "opr");
    const targetRow = tableRows.find((r) => r.teamKey === "frc1114")!;

    expect(targetRow).toBeDefined();
    expect(targetRow.rank).toBe(districtScope.rank);
    expect(tableRows.length).toBe(districtScope.total);
  });

  it("the state scope's rank/total agrees with buildTeamRows after applyTeamFilters({country: USA, state})", () => {
    const rows = buildFixtureRows();
    const scopes = buildTeamRankScopes({ rows, teamKey: "frc1114" });
    const stateScope = scopes.find((s) => s.scope === "state")!;
    expect(stateScope).toBeDefined();

    const artifactTeams = toArtifactTeams(rows);
    const filtered = applyTeamFilters(artifactTeams, { country: "USA", state: stateScope.value });
    const tableRows = buildTeamRows({ season: 2024, teams: filtered } as TeamsArtifact, "opr");
    const targetRow = tableRows.find((r) => r.teamKey === "frc1114")!;

    expect(targetRow).toBeDefined();
    expect(targetRow.rank).toBe(stateScope.rank);
    expect(tableRows.length).toBe(stateScope.total);
  });
});
