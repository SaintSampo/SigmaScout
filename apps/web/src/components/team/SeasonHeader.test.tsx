import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderWithRouter } from "@/test/routerHarness";
import { SeasonHeader } from "./SeasonHeader.js";
import { metricKeysFor } from "@/lib/metricKeys";
import { PAGE_ARTIFACT_SCHEMA_VERSION, type TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * Radix's `Avatar` (`radix-ui`'s `useImageLoadingStatus`) resolves an
 * `AvatarImage`'s loading status by constructing a REAL `new window.Image()`
 * and listening for its native `load`/`error` events — jsdom never performs
 * an actual network image fetch, so without a stub the status would stay
 * "loading" forever and `AvatarImage`'s own `<img>` would never mount in
 * ANY test here (the Radix source: `imageLoadingStatus === "loaded" ? <img
 * ... /> : null`). This mock resolves every image src to a successful load
 * on the next microtask — scoped to this file only (`vi.stubGlobal`, torn
 * down in `afterAll`), since no other test in the repo constructs an
 * `Image()`.
 */
class MockImage {
  complete = false;
  naturalWidth = 1;
  private listeners: Record<string, Array<(event: unknown) => void>> = { load: [], error: [] };
  private _src = "";

  addEventListener(type: string, callback: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(callback);
  }

  removeEventListener(type: string, callback: (event: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((listener) => listener !== callback);
  }

  set src(value: string) {
    this._src = value;
    if (!value) return;
    queueMicrotask(() => {
      this.complete = true;
      for (const listener of this.listeners.load ?? []) listener({ currentTarget: this });
    });
  }

  get src(): string {
    return this._src;
  }
}

beforeAll(() => {
  vi.stubGlobal("Image", MockImage);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function baseArtifact(overrides: Partial<TeamSeasonArtifact> = {}): TeamSeasonArtifact {
  return {
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    teamKey: "frc1114",
    teamNumber: 1114,
    nickname: "Simbotics",
    season: 2026,
    seasonStats: { record: { wins: 35, losses: 28, ties: 0 }, metrics: {} },
    events: [],
    metricHistory: [],
    ...overrides,
  };
}

describe("SeasonHeader — robot image (TEAM-02, D-03, E1)", () => {
  afterEach(() => cleanup());

  it("renders the fallback tile with role=img and a team-number-bearing accessible name when robotImageUrl is absent", () => {
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="spr" season={2026} teamNumber={1114} />);

    const fallback = screen.getByRole("img", { name: /1114/ });
    expect(fallback).toBeDefined();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(document.querySelector("img[src]")).toBeNull();
  });

  it("renders a real <img> with the published src when robotImageUrl is present", async () => {
    const artifact = baseArtifact({ robotImageUrl: "https://i.imgur.com/A0CFArb.jpeg" });
    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    await waitFor(() => {
      const img = document.querySelector("img[src]");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toBe("https://i.imgur.com/A0CFArb.jpeg");
    });
  });
});

describe("SeasonHeader — identity (TEAM-02, E1)", () => {
  afterEach(() => cleanup());

  it("renders 'Team 1114' when nickname is empty", () => {
    render(<SeasonHeader artifact={baseArtifact({ nickname: "" })} algorithmId="spr" season={2026} teamNumber={1114} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team 1114");
  });

  it("carries the full 90-character nickname in the title attribute, never a sliced substring, for a long sponsor-heavy name", () => {
    const longNickname = "A".repeat(45) + " Robotics Presented By A Very Long List Of Sponsors Who Paid For This";
    expect(longNickname.length).toBeGreaterThanOrEqual(90);
    const trimmed = longNickname.slice(0, 90);

    render(<SeasonHeader artifact={baseArtifact({ nickname: trimmed })} algorithmId="spr" season={2026} teamNumber={1114} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.getAttribute("title")).toBe(trimmed);
    expect(heading.textContent).toBe(trimmed);
  });

  it("renders an anchor to the TBA page opening in a new tab with rel=noopener", () => {
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="spr" season={2026} teamNumber={1114} />);

    const link = screen.getByRole("link", { name: "View on TBA" });
    expect(link.getAttribute("href")).toBe("https://www.thebluealliance.com/team/1114");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("SeasonHeader — tier-boxed metric grid (D-17, E2)", () => {
  afterEach(() => cleanup());

  it("renders four phase tiles — Total, then Auto, Teleop, Endgame — read straight from the published group metrics", () => {
    const metrics: TeamSeasonArtifact["seasonStats"]["metrics"] = {
      // The pipeline publishes each phase group as a first-class metric with
      // its own spread and percentile (`breakdown/groups.ts`); the client
      // never sums components to produce these.
      phaseAuto: { value: 12.34, spread: 1.5, percentile: 80 },
      phaseTeleop: { value: 30, spread: 2, percentile: 40 },
      phaseEndgame: { value: 18.16, spread: 1.1, percentile: 60 },
      total: { value: 60.5, spread: 2.5, percentile: 96 },
    };
    const artifact = baseArtifact({ seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics } });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.querySelector("span")?.textContent)).toEqual(["Total", "Auto", "Teleop", "Endgame"]);

    const autoCell = cells.at(1);
    if (autoCell === undefined) throw new Error("expected four grid cells");
    expect(autoCell.textContent).toContain("12.34");

    // 2026-09-13: Total leads on its own line; the three phases share the next, which never wraps.
    const [totalCell, ...phaseCells] = cells;
    expect(totalCell?.parentElement?.querySelectorAll('[data-testid="metric-grid-cell"]')).toHaveLength(1);
    const phaseLine = phaseCells[0]?.parentElement;
    expect(phaseCells.every((cell) => cell.parentElement === phaseLine)).toBe(true);
    expect(phaseLine?.className).toContain("flex-nowrap");
  });

  it("gives every phase group its own rarity tier, and no phase tile carries a plus-minus", () => {
    const metrics: TeamSeasonArtifact["seasonStats"]["metrics"] = {
      phaseAuto: { value: 12.34, spread: 1.5, percentile: 96 },
      phaseTeleop: { value: 30, spread: 2, percentile: 20 },
      phaseEndgame: { value: 18.16, spread: 1.1, percentile: 60 },
      total: { value: 60.5, spread: 2.5, percentile: 96 },
    };
    const artifact = baseArtifact({ seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics } });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    const autoCell = cells.at(1);
    const teleopCell = cells.at(2);
    const totalCell = cells.at(0);
    if (autoCell === undefined || teleopCell === undefined || totalCell === undefined) throw new Error("expected four grid cells");

    // A group's published `spread` is the ALGORITHM's own confidence, so it no
    // longer renders (2026-09-09). Sigma Score is a per-team figure with no
    // per-component form, so a phase tile shows a bare value and its tier.
    expect(autoCell.textContent).not.toContain("±");
    expect(autoCell.querySelector(".metric-tier--legendary")).not.toBeNull();
    expect(totalCell.querySelector(".metric-tier--legendary")).not.toBeNull();
    // 20th percentile is Common, which since 260904-7rt (sketch 008 winner
    // C) draws the hairline outline ring rather than staying unboxed.
    expect(teleopCell.querySelector(".metric-tier--common")).not.toBeNull();
  });

  it("renders four label-only tiles, each with a BLANK value, when metrics is empty", () => {
    const artifact = baseArtifact({ seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {} } });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    expect(cells).toHaveLength(4);
    // 2026-09-01: an absent value renders BLANK, never an em-dash placeholder
    // — so each tile's entire text is its label and nothing else. Asserting
    // the exact label list (rather than "is empty") keeps this test proving
    // the tiles still exist and are still labelled.
    expect(cells.map((cell) => cell.textContent)).toEqual(["Total", "Auto", "Teleop", "Endgame"]);
  });

  it("D-3 (260904-5zg; stale-artifact fallback as of 260904-7id): an EPA fixture carrying components but no phaseAuto/phaseTeleop/phaseEndgame — the shape of a browser's cached pre-republish artifact — renders real derived sums, where before the three tiles were blank", () => {
    const metrics: TeamSeasonArtifact["seasonStats"]["metrics"] = {
      autoTower: { value: 4 },
      hubAuto: { value: 6 },
      hubTransition: { value: 5 },
      hubShift1: { value: 2 },
      hubShift2: { value: 2 },
      hubShift3: { value: 2 },
      hubShift4: { value: 2 },
      endGameTower: { value: 3 },
      hubEndgame: { value: 1 },
      total: { value: 27 },
    };
    const artifact = baseArtifact({ seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics } });

    render(<SeasonHeader artifact={artifact} algorithmId="epa" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.querySelector("span")?.textContent)).toEqual(["Total", "Auto", "Teleop", "Endgame"]);
    const [, autoCell, teleopCell, endgameCell] = cells;
    expect(autoCell?.textContent).toContain("10"); // 4 + 6
    expect(teleopCell?.textContent).toContain("13"); // 5 + 2 + 2 + 2 + 2
    expect(endgameCell?.textContent).toContain("4"); // 3 + 1
  });

  it("D-3: a fixture with published phase metrics keeps its published values and tiers, and renders none of their spreads", () => {
    const metrics: TeamSeasonArtifact["seasonStats"]["metrics"] = {
      phaseAuto: { value: 12.34, spread: 1.5, percentile: 96 },
      phaseTeleop: { value: 30, spread: 2, percentile: 40 },
      phaseEndgame: { value: 18.16, spread: 1.1, percentile: 60 },
      total: { value: 60.5, spread: 2.5, percentile: 96 },
    };
    const artifact = baseArtifact({ seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics } });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    const [, autoCell] = cells;
    // Published phase value and tier survive; the published spread does not
    // render (2026-09-09) — it is the algorithm's own confidence.
    expect(autoCell?.textContent).toContain("12.34");
    expect(autoCell?.textContent).not.toContain("±");
    expect(autoCell?.querySelector(".metric-tier--legendary")).not.toBeNull();
  });

  it("stale-artifact fallback: an EPA phase tile with NO published group entry renders NO plus-minus glyph and NO metric-tier class — a derived entry carries a value alone", () => {
    const metrics: TeamSeasonArtifact["seasonStats"]["metrics"] = {
      autoTower: { value: 4 },
      hubAuto: { value: 6 },
      total: { value: 10 },
    };
    const artifact = baseArtifact({ seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics } });

    render(<SeasonHeader artifact={artifact} algorithmId="epa" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    const [, autoCell] = cells;
    expect(autoCell?.textContent?.includes("±")).toBe(false);
    expect(autoCell?.querySelector('[class*="metric-tier"]')).toBeNull();
  });

  it("D-3 (260904-7id): an EPA season whose phaseTeleop carries a PUBLISHED percentile renders a tiered Teleop tile — EPA carries no spread, ever, but the tier is real", () => {
    const metrics: TeamSeasonArtifact["seasonStats"]["metrics"] = {
      phaseAuto: { value: 12.34, percentile: 40 },
      phaseTeleop: { value: 30, percentile: 96 },
      phaseEndgame: { value: 18.16, percentile: 60 },
      total: { value: 60.5, percentile: 80 },
    };
    const artifact = baseArtifact({ seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics } });

    render(<SeasonHeader artifact={artifact} algorithmId="epa" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    const [, autoCell, teleopCell] = cells;
    // EPA carries no spread anywhere, published or derived — the ± glyph
    // never appears, even on a metric that DOES now carry a real tier.
    expect(teleopCell?.textContent?.includes("±")).toBe(false);
    expect(teleopCell?.querySelector(".metric-tier--legendary")).not.toBeNull();
    // 40th percentile is Common, which (since 260904-7rt) still draws the
    // hairline outline ring rather than staying unboxed — proving this
    // tier came from a real published percentile, not a fabricated "no
    // tier at all" derived value.
    expect(autoCell?.querySelector(".metric-tier--common")).not.toBeNull();
  });

  it("renders one bare-value cell with no plus-minus character for an OPR fixture", () => {
    const artifact = baseArtifact({ seasonStats: { record: { wins: 10, losses: 2, ties: 0 }, metrics: { total: { value: 42.1 } } } });

    render(<SeasonHeader artifact={artifact} algorithmId="opr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    expect(cells).toHaveLength(1);
    const [oprCell] = cells;
    if (oprCell === undefined) throw new Error("expected exactly one grid cell");
    expect(oprCell.textContent).toContain("42.10");
    expect(oprCell.textContent?.includes("±")).toBe(false);
  });

  it("does not render the TierKeyRow — it lives at the foot of the Overview panel, not in the header", () => {
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="spr" season={2026} teamNumber={1114} />);

    expect(screen.queryByTestId("tier-key-row")).toBeNull();
  });
});

describe("SeasonHeader — as-of labelling (IN-01, 260902-post-phase08-ungoverned-ui/REVIEW.md)", () => {
  afterEach(() => cleanup());

  it("labels the tiles 'As of last official match' when metricsOverride is supplied", () => {
    const metricsOverride: TeamSeasonArtifact["seasonStats"]["metrics"] = { total: { value: 50, spread: 3, percentile: 60 } };
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="spr" season={2026} teamNumber={1114} metricsOverride={metricsOverride} />);

    expect(screen.getByTestId("season-header-as-of").textContent).toBe("As of last official match");
  });

  it("labels the tiles season-final, never the official-match label, when metricsOverride is absent", () => {
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="spr" season={2026} teamNumber={1114} />);

    const asOf = screen.getByTestId("season-header-as-of");
    expect(asOf.textContent).not.toContain("official match");
    expect(asOf.textContent).toContain("Season-final");
  });
});

describe("SeasonHeader — Total renders the split pill with Sigma (quick task 260913-jkp)", () => {
  afterEach(() => cleanup());

  it("renders the published Sigma Score as the right half of the Total tile's pill, NOT as a separate tile", () => {
    const artifact = baseArtifact({
      seasonStats: {
        record: { wins: 1, losses: 0, ties: 0 },
        metrics: { total: { value: 42.1 }, sigma: { value: 18.5 } },
      },
    });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    const pill = screen.getByTestId("total-sigma-pill");
    expect(pill.textContent).toContain("42.10");
    expect(pill.textContent).toContain("±18.50");
    const totalCell = screen.getAllByTestId("metric-grid-cell").at(0);
    expect(totalCell?.querySelector("span")?.textContent).toBe("Total ± Sigma");
  });

  // The pill shows the published Sigma entry, never the algorithm's own
  // `spread` — a different quantity at a different level (the model's
  // uncertainty about its rating, not the robot's match-to-match variation).
  it("shows the Sigma Score and never the algorithm's own spread, for an algorithm that publishes both", () => {
    const artifact = baseArtifact({
      seasonStats: {
        record: { wins: 1, losses: 0, ties: 0 },
        metrics: { total: { value: 60.5, spread: 2.5 }, sigma: { value: 41.25 } },
      },
    });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);
    const pill = screen.getByTestId("total-sigma-pill");
    expect(pill.textContent).toContain("60.50");
    expect(pill.textContent).toContain("±41.25");
    // SPR's own spread of 2.50 must not appear anywhere.
    expect(pill.textContent).not.toContain("2.50");
  });

  it("renders one plain Total box, no pill, for a team with no Sigma entry at all", () => {
    const artifact = baseArtifact({
      seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: { total: { value: 10 } } },
    });
    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    expect(screen.queryByTestId("total-sigma-pill")).toBeNull();
    const totalCell = screen.getAllByTestId("metric-grid-cell").at(0);
    expect(totalCell?.textContent).toContain("10.00");
    expect(totalCell?.querySelector("span")?.textContent).toBe("Total");
  });

  it("an artifact whose Total carries a published spread renders NO plus-minus from it, when Sigma is absent", () => {
    const artifact = baseArtifact({
      seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: { total: { value: 60.5, spread: 2.5 } } },
    });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    // SPR always shows four tiles (Total, then Auto/Teleop/Endgame); Total is first.
    const totalCell = cells.at(0);
    expect(totalCell?.textContent).toContain("60.50");
    expect(totalCell?.textContent).not.toContain("±");
  });

  it("a team with no played matches renders the Total tile with no ± and no crash", () => {
    const artifact = baseArtifact({
      seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: { total: { value: 0 } } },
      events: [],
    });

    render(<SeasonHeader artifact={artifact} algorithmId="opr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    const [totalCell] = cells;
    expect(totalCell?.textContent?.includes("±")).toBe(false);
  });

  it("carries the pill's Sigma half's legendary tier class when seasonStats.metrics.sigma has percentile 97", () => {
    const artifact = baseArtifact({
      seasonStats: {
        record: { wins: 1, losses: 0, ties: 0 },
        metrics: { total: { value: 60.5 }, sigma: { value: 8.42, percentile: 97 } },
      },
    });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    const pill = screen.getByTestId("total-sigma-pill");
    expect(pill.textContent).toContain("8.42");
    expect(pill.querySelector(".metric-tier--legendary")).not.toBeNull();
  });

  it("carries the pill's Sigma half's common (hairline ring) tier class when seasonStats.metrics.sigma has percentile 12", () => {
    const artifact = baseArtifact({
      seasonStats: {
        record: { wins: 1, losses: 0, ties: 0 },
        metrics: { total: { value: 60.5 }, sigma: { value: 3.1, percentile: 12 } },
      },
    });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    const pill = screen.getByTestId("total-sigma-pill");
    expect(pill.textContent).toContain("3.10");
    expect(pill.querySelector(".metric-tier--common")).not.toBeNull();
  });

  it("the pill's Sigma half reads seasonStats DIRECTLY, so it survives when metricsOverride is the last-official-match snapshot (which carries no sigma)", () => {
    const artifact = baseArtifact({
      seasonStats: {
        record: { wins: 1, losses: 0, ties: 0 },
        metrics: { total: { value: 72.97 }, sigma: { value: 12.5 } },
      },
    });
    // The snapshot row itself carries no `sigma` entry — the real shape of a
    // `metricHistory` row (verified live 2026-09-13: frc2481 2026 spr, 66
    // history rows, none with sigma).
    const metricsOverride: TeamSeasonArtifact["seasonStats"]["metrics"] = { total: { value: 70 } };

    render(
      <SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} metricsOverride={metricsOverride} />
    );

    const pill = screen.getByTestId("total-sigma-pill");
    expect(pill.textContent).toContain("70.00");
    expect(pill.textContent).toContain("±12.50");
  });

  it("still shows no pill and no tile when there is no Sigma Score entry at all (every OPR and EPA artifact)", () => {
    const artifact = baseArtifact({
      seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: { total: { value: 10 } } },
      events: [],
    });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    expect(screen.queryByTestId("total-sigma-pill")).toBeNull();
  });

  it("renders no plus-minus superscript anywhere in the header -- MetricValue has no plus-minus render path since 260913-g66", () => {
    const metrics: TeamSeasonArtifact["seasonStats"]["metrics"] = {
      total: { value: 60.5, percentile: 96 },
      sigma: { value: 8.42, percentile: 97 },
    };
    const artifact = baseArtifact({
      seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics },
      events: [],
    });

    render(<SeasonHeader artifact={artifact} algorithmId="spr" season={2026} teamNumber={1114} />);

    expect(document.querySelectorAll(".metric-spread-superscript")).toHaveLength(0);
  });
});

describe("SeasonHeader — rank cards render inside the header (quick task 260905-ttv)", () => {
  afterEach(() => cleanup());

  it("renders the rank cards inside the header when ranks is supplied", () => {
    const ranks: NonNullable<TeamSeasonArtifact["ranks"]> = [{ scope: "world", rank: 12, total: 3481 }];
    renderWithRouter(<SeasonHeader artifact={baseArtifact()} algorithmId="spr" season={2026} teamNumber={1114} ranks={ranks} />);

    expect(screen.getByTestId("rank-cards")).toBeDefined();
    expect(screen.getByTestId("rank-card").textContent).toContain("World");
  });

  it("tiers the World card by seasonStats' Total percentile, even when metricsOverride carries a different one (quick task 260912-tnk)", () => {
    const ranks: NonNullable<TeamSeasonArtifact["ranks"]> = [{ scope: "world", rank: 1, total: 3481 }];
    const artifact = baseArtifact({
      seasonStats: { record: { wins: 35, losses: 28, ties: 0 }, metrics: { total: { value: 189.71, percentile: 94.9 } } },
    });
    renderWithRouter(
      <SeasonHeader
        artifact={artifact}
        algorithmId="spr"
        season={2026}
        teamNumber={1114}
        ranks={ranks}
        metricsOverride={{ total: { value: 189.71, percentile: 100 } }}
      />
    );

    const className = screen.getByTestId("rank-card").className;
    expect(className).toContain("rank-card--epic");
    expect(className).not.toContain("rank-card--legendary");
  });

  it("renders nothing extra when ranks is absent -- no rank-cards element, and every other assertion in this file is unaffected", () => {
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="spr" season={2026} teamNumber={1114} />);

    expect(screen.queryByTestId("rank-cards")).toBeNull();
  });
});

describe("SeasonHeader — record basis caption (quick task 260908-615)", () => {
  afterEach(() => cleanup());

  it("names the official-only population beside the record", () => {
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="spr" season={2026} teamNumber={1114} />);

    expect(screen.getByTestId("team-record-basis").textContent).toBe("Official events only");
  });

  it("still renders the record itself unchanged — the caption describes it, it does not replace it", () => {
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="spr" season={2026} teamNumber={1114} />);

    expect(screen.getByTestId("team-record").textContent).toContain("35");
    expect(screen.getByTestId("team-record").textContent).toContain("28");
  });
});
