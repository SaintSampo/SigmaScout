/**
 * `MatchRobotGrid` coverage (260909-tiq-PLAN.md Task 2's `<behavior>`
 * contract) — a PURE function of its props, so this test needs no query
 * client, only the shared router harness for the team-number `Link`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderWithRouter } from "../../test/routerHarness.js";
import { MatchRobotGrid, type MatchRobotRecord } from "./MatchRobotGrid.js";
import { MetricValue } from "@/components/MetricValue";
import { totalColumnHeader } from "@/components/TotalSigmaValue";
import { tierForPercentile } from "../../lib/tiers.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { SeasonTierCuts, TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * Radix's `Avatar` resolves an `AvatarImage`'s loading status by constructing
 * a REAL `new window.Image()` and listening for its native `load`/`error`
 * events — jsdom never performs an actual network image fetch, so without
 * this stub the status would stay "loading" forever and `AvatarImage`'s own
 * `<img>` would never mount. Copied from `team/SeasonHeader.test.tsx`'s own
 * stub verbatim (same Radix primitive, same jsdom gap).
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

const SEASON = 2024;
const ALGORITHM: PublishedAlgorithmId = "spr";

const RED_TEAMS = ["frc254", "frc118", "frc1114"];
const BLUE_TEAMS = ["frc100", "frc200", "frc300"];

function artifact(overrides: Partial<TeamSeasonArtifact> = {}): TeamSeasonArtifact {
  return {
    schemaVersion: 1,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "spr",
    algorithmVersion: "2.0.0+tuned",
    teamKey: "frc254",
    teamNumber: 254,
    nickname: "The Cheesy Poofs",
    season: SEASON,
    seasonStats: { record: { wins: 1, losses: 0, ties: 0 }, metrics: {} },
    events: [],
    metricHistory: [],
    ...overrides,
  } as TeamSeasonArtifact;
}

function resolvedRecord(basis: "before-this-match" | "latest-played", overrides: Partial<MatchRobotRecord> = {}): MatchRobotRecord {
  return {
    artifact: artifact(),
    preMatch: {
      metrics: {
        total: { value: 42.5, spread: 3.1, percentile: 82 },
        phaseAuto: { value: 10, percentile: 40 },
        phaseTeleop: { value: 20, percentile: 60 },
        phaseEndgame: { value: 5, percentile: 96 },
      },
      basis,
      asOfMatchKey: "2024casf_qm1",
    },
    isPending: false,
    ...overrides,
  };
}

function allResolved(basis: "before-this-match" | "latest-played"): Record<string, MatchRobotRecord> {
  const byTeamKey: Record<string, MatchRobotRecord> = {};
  for (const key of [...RED_TEAMS, ...BLUE_TEAMS]) {
    byTeamKey[key] = resolvedRecord(basis);
  }
  return byTeamKey;
}

describe("MatchRobotGrid", () => {
  it("renders six robot cards, three per alliance, red first, in roster order", () => {
    renderWithRouter(<MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={allResolved("before-this-match")} season={SEASON} algorithm={ALGORITHM} />);
    const cards = screen.getAllByTestId(/^robot-card-/);
    expect(cards.map((card) => card.getAttribute("data-testid"))).toEqual([
      "robot-card-frc254",
      "robot-card-frc118",
      "robot-card-frc1114",
      "robot-card-frc100",
      "robot-card-frc200",
      "robot-card-frc300",
    ]);
  });

  it("a card with robotImageUrl renders AvatarImage; a card without it renders only AvatarFallback and no <img>", async () => {
    const byTeamKey = allResolved("before-this-match");
    byTeamKey.frc254 = { ...byTeamKey.frc254!, artifact: artifact({ robotImageUrl: "https://example.com/robot.jpg" }) };
    byTeamKey.frc118 = { ...byTeamKey.frc118!, artifact: artifact({ robotImageUrl: undefined }) };
    renderWithRouter(<MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={byTeamKey} season={SEASON} algorithm={ALGORITHM} />);

    const withPhoto = screen.getByTestId("robot-card-frc254");
    await waitFor(() => expect(withPhoto.querySelector("img")).not.toBeNull());

    const withoutPhoto = screen.getByTestId("robot-card-frc118");
    expect(withoutPhoto.querySelector("img")).toBeNull();
    expect(screen.getByLabelText("No robot photo available for team 118")).toBeDefined();
  });

  it("a card whose pre-match state resolved renders Auto/Teleop/Endgame/Total, tier-boxed where the history metric carries a percentile", () => {
    renderWithRouter(<MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={allResolved("before-this-match")} season={SEASON} algorithm={ALGORITHM} />);
    const card = screen.getByTestId("robot-card-frc254");
    expect(card.textContent).toContain("Auto");
    expect(card.textContent).toContain("Teleop");
    expect(card.textContent).toContain("Endgame");
    expect(card.textContent).toContain("Total");
    expect(card.textContent).toContain("42.50");
    // phaseEndgame's percentile (96) lands in the Legendary tier band.
    expect(card.querySelector(".metric-tier--legendary")).not.toBeNull();
    // phaseAuto's percentile (40) lands in the Common tier band (outline-only, still boxed).
    expect(card.querySelector(".metric-tier--common")).not.toBeNull();
  });

  it("a card whose pre-match state did NOT resolve renders blank metric cells plus the no-pre-match-metrics note, and no number", () => {
    const byTeamKey = allResolved("before-this-match");
    byTeamKey.frc254 = { artifact: artifact(), preMatch: undefined, isPending: false };
    renderWithRouter(<MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={byTeamKey} season={SEASON} algorithm={ALGORITHM} />);
    const card = screen.getByTestId("robot-card-frc254");
    expect(card.textContent).toContain("No pre-match metrics for this team.");
    expect(/\d/.test(card.textContent!.replace("254", "").replace("No pre-match metrics for this team.", ""))).toBe(false);
  });

  it("a pending card renders a skeleton, not a blank — isPending true", () => {
    const byTeamKey = allResolved("before-this-match");
    byTeamKey.frc254 = { artifact: undefined, preMatch: undefined, isPending: true };
    renderWithRouter(<MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={byTeamKey} season={SEASON} algorithm={ALGORITHM} />);
    const card = screen.getByTestId("robot-card-frc254");
    expect(card.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(card.textContent).not.toContain("No pre-match metrics for this team.");
  });

  it("given a metric carrying both a value and a spread, the rendered card contains the value and no ± character anywhere (spread-leak guard)", () => {
    renderWithRouter(<MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={allResolved("before-this-match")} season={SEASON} algorithm={ALGORITHM} />);
    const card = screen.getByTestId("robot-card-frc254");
    expect(card.textContent).toContain("42.50");
    expect(card.textContent).not.toContain("±");
  });

  it("basis 'before-this-match' and 'latest-played' render DIFFERENT combined as-of wording", () => {
    const beforeRender = renderWithRouter(
      <MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={allResolved("before-this-match")} season={SEASON} algorithm={ALGORITHM} />,
    );
    const beforeText = screen.getByTestId("match-robot-grid-as-of").textContent;
    beforeRender.unmount();

    renderWithRouter(<MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={allResolved("latest-played")} season={SEASON} algorithm={ALGORITHM} />);
    const latestText = screen.getByTestId("match-robot-grid-as-of").textContent;

    expect(beforeText).not.toBe(latestText);
    expect(beforeText).toMatch(/going into this match/);
    expect(latestText).toMatch(/has not been played/);
  });

  it("when the six cards disagree on basis, no combined line renders and each resolved card states its own basis", () => {
    const byTeamKey = allResolved("before-this-match");
    byTeamKey.frc254 = resolvedRecord("latest-played");
    renderWithRouter(<MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={byTeamKey} season={SEASON} algorithm={ALGORITHM} />);

    expect(screen.queryByTestId("match-robot-grid-as-of")).toBeNull();
    expect(screen.getByTestId("robot-card-frc254").textContent).toContain("As of its most recent played match");
    expect(screen.getByTestId("robot-card-frc118").textContent).toContain("As of immediately before this match");
  });

  /**
   * Quick task 260917-2f4: "for SPR, Sigma should be stored and displayed
   * anywhere Total is". The per-robot Total cell reads its Sigma from the SAME
   * `metricHistory` row the Total itself came from (`preMatch.metrics`), so
   * both halves of the pill share one as-of instant — never the season-final
   * Sigma from `seasonStats`, which is a different instant.
   *
   * Gated on DATA PRESENCE, never on algorithm id (`sigmaScore.ts`'s own
   * rule): the pill and the Sigma-naming label appear exactly when the row
   * carries a `SIGMA_METRIC_KEY` entry.
   */
  describe("Total ± Sigma pill", () => {
    /** The four metric cells of a card, in `METRIC_CELLS` order — Auto, Teleop, Endgame, Total. */
    function metricCells(card: HTMLElement): HTMLElement[] {
      const container = card.lastElementChild as HTMLElement;
      return Array.from(container.children).filter((child): child is HTMLElement => child.tagName === "DIV");
    }

    function totalCell(card: HTMLElement): HTMLElement {
      const cells = metricCells(card);
      return cells[cells.length - 1]!;
    }

    /** `resolvedRecord` with a `sigma` metrics entry injected (or, for `undefined`, deliberately without one). */
    function recordWithSigma(sigma: number | undefined): MatchRobotRecord {
      const base = resolvedRecord("before-this-match");
      const preMatch = base.preMatch!;
      return {
        ...base,
        preMatch: {
          ...preMatch,
          metrics: {
            ...preMatch.metrics,
            ...(sigma === undefined ? {} : { [SIGMA_METRIC_KEY]: { value: sigma } }),
          },
        },
      };
    }

    function renderWithSigma(sigma: number | undefined) {
      const byTeamKey = allResolved("before-this-match");
      byTeamKey.frc254 = recordWithSigma(sigma);
      return renderWithRouter(
        <MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={byTeamKey} season={SEASON} algorithm={ALGORITHM} />,
      );
    }

    it("a pre-match row carrying a sigma entry renders the Total cell as ONE joined pill with both halves", () => {
      renderWithSigma(4.25);
      const cell = totalCell(screen.getByTestId("robot-card-frc254"));
      const pill = cell.querySelector('[data-testid="total-sigma-pill"]');
      expect(pill).not.toBeNull();
      expect(pill!.querySelector(".metric-pill__total")!.textContent).toBe("42.50");
      expect(pill!.querySelector(".metric-pill__sigma")!.textContent).toBe("±4.25");
    });

    it("the Sigma half is the row's own sigma, never the Total's spread (spread must never reach the screen)", () => {
      // The fixture's total carries `spread: 3.1`; the pill's ± is 4.25.
      renderWithSigma(4.25);
      const card = screen.getByTestId("robot-card-frc254");
      expect(card.textContent).toContain("±4.25");
      expect(card.textContent).not.toContain("3.10");
    });

    it("a sigma entry with no percentile renders its half UNTIERED — no tier class, and not the neutral treatment either", () => {
      renderWithSigma(4.25);
      const sigmaHalf = totalCell(screen.getByTestId("robot-card-frc254")).querySelector(".metric-pill__sigma")!;
      expect(sigmaHalf.className).not.toMatch(/metric-tier--/);
      expect(sigmaHalf.className).not.toContain("metric-pill__sigma--neutral");
    });

    it("the Total half keeps its own percentile's tier", () => {
      renderWithSigma(4.25);
      // total's percentile (82) lands in the Epic band.
      const totalHalf = totalCell(screen.getByTestId("robot-card-frc254")).querySelector(".metric-pill__total")!;
      expect(totalHalf.className).toContain("metric-tier--epic");
    });

    it("the Total cell's label names Sigma only when the row carries one", () => {
      const withSigma = renderWithSigma(4.25);
      expect(totalCell(screen.getByTestId("robot-card-frc254")).firstElementChild!.textContent).toBe(totalColumnHeader(ALGORITHM));
      expect(totalColumnHeader(ALGORITHM)).toBe("Total ± Sigma");
      withSigma.unmount();

      renderWithSigma(undefined);
      expect(totalCell(screen.getByTestId("robot-card-frc254")).firstElementChild!.textContent).toBe("Total");
    });

    it("a row with NO sigma entry renders the Total value byte-identically to plain MetricValue", () => {
      const reference = render(<MetricValue metric={{ value: 42.5, spread: 3.1 }} tier={tierForPercentile(82)} />);
      const referenceHtml = reference.container.innerHTML;
      reference.unmount();

      renderWithSigma(undefined);
      const cell = totalCell(screen.getByTestId("robot-card-frc254"));
      expect(cell.querySelector('[data-testid="total-sigma-pill"]')).toBeNull();
      expect(cell.lastElementChild!.outerHTML).toBe(referenceHtml);
    });

    it("the Auto/Teleop/Endgame cells are unchanged by a present sigma — no pill, no ±, plain MetricValue", () => {
      renderWithSigma(4.25);
      const cells = metricCells(screen.getByTestId("robot-card-frc254"));
      const phaseCells = cells.slice(0, cells.length - 1);
      expect(phaseCells.map((cell) => cell.firstElementChild!.textContent)).toEqual(["Auto", "Teleop", "Endgame"]);
      for (const cell of phaseCells) {
        expect(cell.querySelector('[data-testid="total-sigma-pill"]')).toBeNull();
        expect(cell.textContent).not.toContain("±");
      }
    });
  });

  /**
   * Quick task 260920-qzf: a `live`-block-derived row carries a value but no
   * percentile — this is what `tierCuts` is for. `phaseAuto` (index 0 of
   * `METRIC_CELLS`) is the fixture's percentile-less metric here.
   */
  describe("tierCuts fallback (260920-qzf)", () => {
    const NO_PERCENTILE_TIER_CUTS: SeasonTierCuts = { phaseAuto: { cuts: [8, 12, 18] } };

    /** `resolvedRecord` with `phaseAuto`'s percentile stripped — a live-folded row's exact shape. */
    function recordWithNoPercentileOnAuto(): MatchRobotRecord {
      const base = resolvedRecord("before-this-match");
      const preMatch = base.preMatch!;
      return {
        ...base,
        preMatch: {
          ...preMatch,
          metrics: { ...preMatch.metrics, phaseAuto: { value: preMatch.metrics.phaseAuto!.value } },
        },
      };
    }

    /** The four metric cells of a card, in `METRIC_CELLS` order — a local copy of the "Total ± Sigma pill" describe's own helper, since `describe` callback scopes are not shared. */
    function localMetricCells(card: HTMLElement): HTMLElement[] {
      const container = card.lastElementChild as HTMLElement;
      return Array.from(container.children).filter((child): child is HTMLElement => child.tagName === "DIV");
    }

    function autoCell(card: HTMLElement): HTMLElement {
      return localMetricCells(card)[0]!;
    }

    it("a cell whose entry has a value and no percentile renders the tier the cuts imply", () => {
      const byTeamKey = allResolved("before-this-match");
      byTeamKey.frc254 = recordWithNoPercentileOnAuto();
      renderWithRouter(
        <MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={byTeamKey} season={SEASON} algorithm={ALGORITHM} tierCuts={NO_PERCENTILE_TIER_CUTS} />,
      );
      const cell = autoCell(screen.getByTestId("robot-card-frc254"));
      // value 10 >= cuts.phaseAuto[1] (12)? no; >= cuts[0] (8)? yes -> rare.
      expect(cell.querySelector(".metric-tier--rare")).not.toBeNull();
    });

    it("the same cell with no cuts supplied renders no tier box at all", () => {
      const byTeamKey = allResolved("before-this-match");
      byTeamKey.frc254 = recordWithNoPercentileOnAuto();
      renderWithRouter(<MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={byTeamKey} season={SEASON} algorithm={ALGORITHM} />);
      const cell = autoCell(screen.getByTestId("robot-card-frc254"));
      expect(cell.className).not.toMatch(/metric-tier/);
    });

    it("a cell that DOES carry a percentile renders identical markup whether or not cuts are supplied (published percentile always wins)", () => {
      const withCuts = renderWithRouter(
        <MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={allResolved("before-this-match")} season={SEASON} algorithm={ALGORITHM} tierCuts={NO_PERCENTILE_TIER_CUTS} />,
      );
      const withCutsHtml = autoCell(screen.getByTestId("robot-card-frc254")).outerHTML;
      withCuts.unmount();

      renderWithRouter(<MatchRobotGrid redTeams={RED_TEAMS} blueTeams={BLUE_TEAMS} byTeamKey={allResolved("before-this-match")} season={SEASON} algorithm={ALGORITHM} />);
      const withoutCutsHtml = autoCell(screen.getByTestId("robot-card-frc254")).outerHTML;

      expect(withCutsHtml).toBe(withoutCutsHtml);
    });
  });
});
