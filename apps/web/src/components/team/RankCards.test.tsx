import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RankCards } from "./RankCards.js";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

type Ranks = NonNullable<TeamSeasonArtifact["ranks"]>;

afterEach(() => cleanup());

describe("RankCards — rendering four scopes in order (quick task 260905-ldu)", () => {
  it("renders four cards, in the order world, country, district, state", () => {
    const ranks: Ranks = [
      { scope: "world", rank: 12, total: 3481 },
      { scope: "country", value: "USA", rank: 8, total: 2900 },
      { scope: "district", value: "fim", rank: 3, total: 60 },
      { scope: "state", value: "MI", rank: 5, total: 120 },
    ];

    render(<RankCards ranks={ranks} />);

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

    render(<RankCards ranks={ranks} />);

    const card = screen.getByTestId("rank-card");
    expect(card.textContent).toContain("#12");
    expect(card.textContent).toContain("of 3,481");
  });

  it("district cards label with the reader-facing districtDisplayName, not the raw key", () => {
    const ranks: Ranks = [{ scope: "district", value: "fim", rank: 3, total: 60 }];

    render(<RankCards ranks={ranks} />);

    const card = screen.getByTestId("rank-card");
    expect(card.textContent).toContain("FIRST MI");
    expect(card.textContent).not.toContain("fim");
  });

  it("the country card labels with the raw country string", () => {
    const ranks: Ranks = [{ scope: "country", value: "USA", rank: 8, total: 2900 }];

    render(<RankCards ranks={ranks} />);

    expect(screen.getByTestId("rank-card").textContent).toContain("USA");
  });

  it("the state card labels with the raw state-prov abbreviation", () => {
    const ranks: Ranks = [{ scope: "state", value: "MI", rank: 5, total: 120 }];

    render(<RankCards ranks={ranks} />);

    expect(screen.getByTestId("rank-card").textContent).toContain("MI");
  });
});

describe("RankCards — graceful absence (quick task 260905-ldu)", () => {
  it("renders nothing at all when ranks is undefined — no heading, no empty row, no skeleton", () => {
    const { container } = render(<RankCards ranks={undefined} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("rank-cards")).toBeNull();
  });

  it("renders nothing at all when ranks is an empty array", () => {
    const { container } = render(<RankCards ranks={[]} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("rank-cards")).toBeNull();
  });
});

describe("RankCards — basis caption (quick task 260905-ldu)", () => {
  it("renders exactly one basis caption whenever any card renders, naming total-based ranking over official play only", () => {
    const ranks: Ranks = [{ scope: "world", rank: 1, total: 10 }];

    render(<RankCards ranks={ranks} />);

    const basis = screen.getByTestId("rank-cards-basis");
    expect(basis.textContent).toContain("total");
    expect(basis.textContent).toContain("official play");
    expect(screen.getAllByTestId("rank-cards-basis")).toHaveLength(1);
  });
});

describe("RankCards — accessibility (quick task 260905-ldu)", () => {
  it("associates each card's scope label with its number via one accessible group, rather than a bare floating string", () => {
    const ranks: Ranks = [{ scope: "world", rank: 12, total: 3481 }];

    render(<RankCards ranks={ranks} />);

    const group = screen.getByRole("group", { name: "World: rank 12 of 3481" });
    expect(group).toBeDefined();
  });
});
