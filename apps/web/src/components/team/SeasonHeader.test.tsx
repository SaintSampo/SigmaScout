import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    algorithmId: "vpr",
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
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="vpr" season={2026} teamNumber={1114} />);

    const fallback = screen.getByRole("img", { name: /1114/ });
    expect(fallback).toBeDefined();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(document.querySelector("img[src]")).toBeNull();
  });

  it("renders a real <img> with the published src when robotImageUrl is present", async () => {
    const artifact = baseArtifact({ robotImageUrl: "https://i.imgur.com/A0CFArb.jpeg" });
    render(<SeasonHeader artifact={artifact} algorithmId="vpr" season={2026} teamNumber={1114} />);

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
    render(<SeasonHeader artifact={baseArtifact({ nickname: "" })} algorithmId="vpr" season={2026} teamNumber={1114} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team 1114");
  });

  it("carries the full 90-character nickname in the title attribute, never a sliced substring, for a long sponsor-heavy name", () => {
    const longNickname = "A".repeat(45) + " Robotics Presented By A Very Long List Of Sponsors Who Paid For This";
    expect(longNickname.length).toBeGreaterThanOrEqual(90);
    const trimmed = longNickname.slice(0, 90);

    render(<SeasonHeader artifact={baseArtifact({ nickname: trimmed })} algorithmId="vpr" season={2026} teamNumber={1114} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.getAttribute("title")).toBe(trimmed);
    expect(heading.textContent).toBe(trimmed);
  });

  it("renders an anchor to the TBA page opening in a new tab with rel=noopener", () => {
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="vpr" season={2026} teamNumber={1114} />);

    const link = screen.getByRole("link", { name: "View on TBA" });
    expect(link.getAttribute("href")).toBe("https://www.thebluealliance.com/team/1114");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("SeasonHeader — tier-boxed metric grid (D-17, E2)", () => {
  afterEach(() => cleanup());

  it("renders four phase tiles — Auto, Teleop, Endgame, Total — read straight from the published group metrics", () => {
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

    render(<SeasonHeader artifact={artifact} algorithmId="vpr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.querySelector("span")?.textContent)).toEqual(["Auto", "Teleop", "Endgame", "Total"]);

    const autoCell = cells.at(0);
    if (autoCell === undefined) throw new Error("expected four grid cells");
    expect(autoCell.textContent).toContain("12.34");
  });

  it("gives every phase group its own plus-minus and rarity tier, not just Total", () => {
    const metrics: TeamSeasonArtifact["seasonStats"]["metrics"] = {
      phaseAuto: { value: 12.34, spread: 1.5, percentile: 96 },
      phaseTeleop: { value: 30, spread: 2, percentile: 20 },
      phaseEndgame: { value: 18.16, spread: 1.1, percentile: 60 },
      total: { value: 60.5, spread: 2.5, percentile: 96 },
    };
    const artifact = baseArtifact({ seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics } });

    render(<SeasonHeader artifact={artifact} algorithmId="vpr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    const autoCell = cells.at(0);
    const teleopCell = cells.at(1);
    const totalCell = cells.at(3);
    if (autoCell === undefined || teleopCell === undefined || totalCell === undefined) throw new Error("expected four grid cells");

    // A group's spread is real published data (the covariance quadratic form
    // over its own component indices), so it renders like any other metric.
    expect(autoCell.textContent).toContain("±");
    expect(autoCell.querySelector(".metric-tier--legendary")).not.toBeNull();
    expect(totalCell.querySelector(".metric-tier--legendary")).not.toBeNull();
    // 20th percentile is Common, which is deliberately unboxed.
    expect(teleopCell.querySelector('[class*="metric-tier"]')).toBeNull();
  });

  it("renders four label-only tiles, each with a BLANK value, when metrics is empty", () => {
    const artifact = baseArtifact({ seasonStats: { record: { wins: 0, losses: 0, ties: 0 }, metrics: {} } });

    render(<SeasonHeader artifact={artifact} algorithmId="vpr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    expect(cells).toHaveLength(4);
    // 2026-09-01: an absent value renders BLANK, never an em-dash placeholder
    // — so each tile's entire text is its label and nothing else. Asserting
    // the exact label list (rather than "is empty") keeps this test proving
    // the tiles still exist and are still labelled.
    expect(cells.map((cell) => cell.textContent)).toEqual(["Auto", "Teleop", "Endgame", "Total"]);
  });

  it("D-3 (260904-5zg): an EPA fixture carrying components but no phaseAuto/phaseTeleop/phaseEndgame renders real derived sums, where before the three tiles were blank", () => {
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
    expect(cells.map((c) => c.querySelector("span")?.textContent)).toEqual(["Auto", "Teleop", "Endgame", "Total"]);
    const [autoCell, teleopCell, endgameCell] = cells;
    expect(autoCell?.textContent).toContain("10"); // 4 + 6
    expect(teleopCell?.textContent).toContain("13"); // 5 + 2 + 2 + 2 + 2
    expect(endgameCell?.textContent).toContain("4"); // 3 + 1
  });

  it("D-3: a VPR fixture with published phase metrics carrying spreads still renders its published spread/tier — derivation is invisible on VPR", () => {
    const metrics: TeamSeasonArtifact["seasonStats"]["metrics"] = {
      phaseAuto: { value: 12.34, spread: 1.5, percentile: 96 },
      phaseTeleop: { value: 30, spread: 2, percentile: 40 },
      phaseEndgame: { value: 18.16, spread: 1.1, percentile: 60 },
      total: { value: 60.5, spread: 2.5, percentile: 96 },
    };
    const artifact = baseArtifact({ seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics } });

    render(<SeasonHeader artifact={artifact} algorithmId="vpr" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    const [autoCell] = cells;
    expect(autoCell?.textContent).toContain("±");
    expect(autoCell?.querySelector(".metric-tier--legendary")).not.toBeNull();
  });

  it("D-3: an EPA phase tile renders NO plus-minus glyph and NO metric-tier class — a derived entry carries a value alone", () => {
    const metrics: TeamSeasonArtifact["seasonStats"]["metrics"] = {
      autoTower: { value: 4 },
      hubAuto: { value: 6 },
      total: { value: 10 },
    };
    const artifact = baseArtifact({ seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics } });

    render(<SeasonHeader artifact={artifact} algorithmId="epa" season={2026} teamNumber={1114} />);

    const cells = screen.getAllByTestId("metric-grid-cell");
    const [autoCell] = cells;
    expect(autoCell?.textContent?.includes("±")).toBe(false);
    expect(autoCell?.querySelector('[class*="metric-tier"]')).toBeNull();
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
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="vpr" season={2026} teamNumber={1114} />);

    expect(screen.queryByTestId("tier-key-row")).toBeNull();
  });
});

describe("SeasonHeader — as-of labelling (IN-01, 260902-post-phase08-ungoverned-ui/REVIEW.md)", () => {
  afterEach(() => cleanup());

  it("labels the tiles 'As of last official match' when metricsOverride is supplied", () => {
    const metricsOverride: TeamSeasonArtifact["seasonStats"]["metrics"] = { total: { value: 50, spread: 3, percentile: 60 } };
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="vpr" season={2026} teamNumber={1114} metricsOverride={metricsOverride} />);

    expect(screen.getByTestId("season-header-as-of").textContent).toBe("As of last official match");
  });

  it("labels the tiles season-final, never the official-match label, when metricsOverride is absent", () => {
    render(<SeasonHeader artifact={baseArtifact()} algorithmId="vpr" season={2026} teamNumber={1114} />);

    const asOf = screen.getByTestId("season-header-as-of");
    expect(asOf.textContent).not.toContain("official match");
    expect(asOf.textContent).toContain("Season-final");
  });
});
