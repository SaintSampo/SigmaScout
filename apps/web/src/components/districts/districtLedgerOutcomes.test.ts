/**
 * The named-outcome lists' own tests — pure, synthetic, no corpus.
 *
 * The load-bearing assertion here is the UNACCOUNTED MASS one: every point value
 * either of these two distributions can carry must be covered by a named row, or
 * the list silently omits part of the cell's own chance. A stacked award that
 * escaped the fold, or a placement table that gained a value, shows up there and
 * nowhere else.
 */
import { describe, expect, it } from "vitest";
import { PLAYOFF_PLACEMENT_POINTS, playoffPoints } from "../../../../../packages/core/districts/bracket.js";
import { AWARD_POINT_SUPPORT } from "../../../../../packages/core/districts/awardBaseRates.js";
import {
  foldStackedAwardPoints,
  IMPACT_AWARD_POINTS,
  ROOKIE_ALL_STAR_AWARD_POINTS,
} from "../../../../../packages/core/districts/awardOrderingTables.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { districtSelectionPoints } from "../../../../../packages/core/districts/selectionPoints.js";
import type { DistrictSelectionRouteObservation } from "../../../../../packages/core/districts/ledgerSimulation.js";
import {
  districtAwardOutcomes,
  districtCellRendersOutcomeList,
  districtOutcomeUnaccountedMass,
  districtPlayoffOutcomes,
  districtSelectionHeadline,
  districtSelectionOutcomes,
  districtSelectionSettledRoute,
  districtSelectionUnaccountedMass,
  InvalidRouteDenominatorError,
  PLAYOFF_ZERO_PLACEMENTS,
} from "./districtLedgerOutcomes.js";
import type { DistrictPlayoffMilestone, DistrictPointDistribution, DistrictSelectionRouteView } from "./districtLedgerRows.js";

const SEASON = 2026;
const TIER = "district" as const;

/** A distribution with the given `points -> count` pairs, sized to the category ceiling. */
function distributionOf(pairs: readonly (readonly [number, number])[], ceiling: number): DistrictPointDistribution {
  const counts = new Float64Array(ceiling + 1);
  let denominator = 0;
  for (const [points, count] of pairs) {
    counts[points] = (counts[points] ?? 0) + count;
    denominator += count;
  }
  return { counts, denominator };
}

const ELIM_CEILING = maxEventPoints(SEASON, TIER).elim;
const AWARD_CEILING = maxEventPoints(SEASON, TIER).award;

/** 40 runs out before the top four, 20 fourth, 20 third, 15 finalist, 5 winner. */
function playoffDistribution(): DistrictPointDistribution {
  return distributionOf(
    [
      [0, 40],
      [playoffPoints(SEASON, TIER, 4), 20],
      [playoffPoints(SEASON, TIER, 3), 20],
      [playoffPoints(SEASON, TIER, 2), 15],
      [playoffPoints(SEASON, TIER, 1), 5],
    ],
    ELIM_CEILING
  );
}

/** 70 runs no award, 20 one judged award, 6 Rookie All Star, 4 Impact. */
function awardDistribution(): DistrictPointDistribution {
  return distributionOf(
    [
      [0, 70],
      [AWARD_POINT_SUPPORT[1]!, 20],
      [ROOKIE_ALL_STAR_AWARD_POINTS, 6],
      [IMPACT_AWARD_POINTS, 4],
    ],
    AWARD_CEILING
  );
}

describe("which cells render an outcome list", () => {
  it("names the two lumpy, named categories and nothing else", () => {
    expect(districtCellRendersOutcomeList("elim")).toBe(true);
    expect(districtCellRendersOutcomeList("award")).toBe(true);
    for (const cell of ["qual", "alliance", "eventTotal", "grandTotal"]) {
      expect(districtCellRendersOutcomeList(cell), cell).toBe(false);
    }
  });
});

describe("districtPlayoffOutcomes", () => {
  it("lists five named outcomes, ordered by points descending, at this event's own placement values", () => {
    const rows = districtPlayoffOutcomes(SEASON, TIER, playoffDistribution(), undefined);
    expect(rows.map((row) => row.id)).toEqual(["winner", "finalist", "third", "fourth", "none"]);
    expect(rows.map((row) => row.points)).toEqual([30, 20, 13, 7, 0]);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.points).toBeLessThan(rows[i - 1]!.points);
  });

  it("takes each chance as the mass at that exact point value, so the list cannot disagree with the cell", () => {
    const rows = districtPlayoffOutcomes(SEASON, TIER, playoffDistribution(), undefined);
    const chanceOf = (id: string): number => rows.find((row) => row.id === id)!.chance;
    expect(chanceOf("winner")).toBeCloseTo(0.05, 12);
    expect(chanceOf("finalist")).toBeCloseTo(0.15, 12);
    expect(chanceOf("third")).toBeCloseTo(0.2, 12);
    expect(chanceOf("fourth")).toBeCloseTo(0.2, 12);
    expect(chanceOf("none")).toBeCloseTo(0.4, 12);
    // And they sum to one, which is what makes the list a decomposition rather
    // than a selection.
    expect(rows.reduce((sum, row) => sum + row.chance, 0)).toBeCloseTo(1, 12);
  });

  it("accounts for EVERY unit of mass the distribution carries", () => {
    const distribution = playoffDistribution();
    const rows = districtPlayoffOutcomes(SEASON, TIER, distribution, undefined);
    expect(districtOutcomeUnaccountedMass(distribution, rows)).toBeCloseTo(0, 12);
  });

  it("rests on the premise that fifth through eighth all pay nothing", () => {
    expect([...PLAYOFF_ZERO_PLACEMENTS]).toEqual([5, 6, 7, 8]);
    for (const placement of PLAYOFF_ZERO_PLACEMENTS) expect(PLAYOFF_PLACEMENT_POINTS[placement - 1]).toBe(0);
  });

  it("omits the nothing row once a top-four finish is secured", () => {
    const milestone: DistrictPlayoffMilestone = { kind: "finalist", chance: 0.2, conditionalMedian: 20 };
    const rows = districtPlayoffOutcomes(SEASON, TIER, playoffDistribution(), milestone);
    expect(rows.map((row) => row.id)).toEqual(["winner", "finalist", "third", "fourth"]);
  });

  it("omits third and fourth as well once the alliance is in the final", () => {
    const milestone: DistrictPlayoffMilestone = { kind: "winner", chance: 0.05, conditionalMedian: 30 };
    const rows = districtPlayoffOutcomes(SEASON, TIER, playoffDistribution(), milestone);
    expect(rows.map((row) => row.id)).toEqual(["winner", "finalist"]);
  });

  it("leaves exactly one row once the bracket has decided the placement", () => {
    for (const [placement, id] of [
      [1, "winner"],
      [2, "finalist"],
      [3, "third"],
      [4, "fourth"],
      [5, "none"],
      [8, "none"],
    ] as const) {
      const rows = districtPlayoffOutcomes(SEASON, TIER, playoffDistribution(), {
        kind: "placed",
        placement,
        points: playoffPoints(SEASON, TIER, placement),
      });
      expect(rows.map((row) => row.id), `placement ${String(placement)}`).toEqual([id]);
    }
  });

  it("keeps a zero-chance row that the bracket has NOT ruled out, so the list's length does not move with the draws", () => {
    // No run reached the final at all, which is a long shot rather than a ruling.
    const distribution = distributionOf(
      [
        [0, 90],
        [playoffPoints(SEASON, TIER, 4), 10],
      ],
      ELIM_CEILING
    );
    const rows = districtPlayoffOutcomes(SEASON, TIER, distribution, undefined);
    expect(rows).toHaveLength(5);
    expect(rows.find((row) => row.id === "winner")!.chance).toBe(0);
  });

  it("applies the dcmp weight through playoffPoints rather than carrying a second table", () => {
    const rows = districtPlayoffOutcomes(SEASON, "dcmp", playoffDistribution(), undefined);
    expect(rows.map((row) => row.points)).toEqual([90, 60, 39, 21, 0]);
  });
});

describe("districtAwardOutcomes", () => {
  it("lists the four named awards for a rookie, ordered by points descending", () => {
    const rows = districtAwardOutcomes(SEASON, TIER, awardDistribution(), true);
    expect(rows.map((row) => row.id)).toEqual(["impact", "rookieAllStar", "judged", "none"]);
    expect(rows.map((row) => row.points)).toEqual([10, 8, 5, 0]);
  });

  it("omits Rookie All Star for a veteran, which cannot win it at all", () => {
    const rows = districtAwardOutcomes(SEASON, TIER, awardDistribution(), false);
    expect(rows.map((row) => row.id)).toEqual(["impact", "judged", "none"]);
  });

  it("takes each chance as the mass at that exact value", () => {
    const rows = districtAwardOutcomes(SEASON, TIER, awardDistribution(), true);
    const chanceOf = (id: string): number => rows.find((row) => row.id === id)!.chance;
    expect(chanceOf("impact")).toBeCloseTo(0.04, 12);
    expect(chanceOf("rookieAllStar")).toBeCloseTo(0.06, 12);
    expect(chanceOf("judged")).toBeCloseTo(0.2, 12);
    expect(chanceOf("none")).toBeCloseTo(0.7, 12);
    expect(rows.reduce((sum, row) => sum + row.chance, 0)).toBeCloseTo(1, 12);
  });

  it("accounts for EVERY unit of mass a FOLDED award distribution can carry", () => {
    // Every support value the draw can land on after the fold, at one count each.
    const folded = [...new Set(AWARD_POINT_SUPPORT.map(foldStackedAwardPoints))];
    const distribution = distributionOf(
      folded.map((points) => [points, 1] as const),
      AWARD_CEILING
    );
    const rows = districtAwardOutcomes(SEASON, TIER, distribution, true);
    expect(districtOutcomeUnaccountedMass(distribution, rows)).toBeCloseTo(0, 12);
  });

  it("would FLAG a stacked award that escaped the fold rather than dropping it silently", () => {
    // A distribution that still carries mass at 13, which no named outcome is.
    const distribution = distributionOf(
      [
        [0, 90],
        [13, 10],
      ],
      AWARD_CEILING
    );
    const rows = districtAwardOutcomes(SEASON, TIER, distribution, true);
    expect(districtOutcomeUnaccountedMass(distribution, rows)).toBeCloseTo(0.1, 12);
  });

  it("names no value above Impact, at either tier", () => {
    for (const tier of ["district", "dcmp"] as const) {
      const rows = districtAwardOutcomes(SEASON, tier, awardDistribution(), true);
      const weight = tier === "district" ? 1 : 3;
      expect(Math.max(...rows.map((row) => row.points))).toBe(IMPACT_AWARD_POINTS * weight);
    }
  });
});

// ---------------------------------------------------------------------------
// The ALLIANCE SELECTION routes (quick task 260925-w4y)
// ---------------------------------------------------------------------------

describe("the alliance selection route helpers", () => {
  /** The possible range each slot pays at a district event, from the measured module rather than retyped. */
  const possibleFor = (slot: number): { low: number; high: number } => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => districtSelectionPoints(SEASON, TIER, slot, n));
    return { low: Math.min(...values), high: Math.max(...values) };
  };

  function observation(slot: number, overrides: Partial<DistrictSelectionRouteObservation> = {}): DistrictSelectionRouteObservation {
    const possible = possibleFor(slot);
    return {
      draws: 0,
      minPoints: undefined,
      maxPoints: undefined,
      allianceNumber: undefined,
      possibleMinPoints: possible.low,
      possibleMaxPoints: possible.high,
      ...overrides,
    };
  }

  /** A route view over `denominator` runs. `slots` gives the four pick slots' overrides. */
  function viewOf(
    denominator: number,
    rankingFixed: boolean,
    slots: readonly Partial<DistrictSelectionRouteObservation>[],
    notSelectedDraws: number
  ): DistrictSelectionRouteView {
    return {
      routes: { bySlot: slots.map((overrides, slot) => observation(slot, overrides)), notSelectedDraws },
      denominator,
      rankingFixed,
    };
  }

  /** 700 captain runs, 120 first pick, 80 second pick, 100 unselected. */
  const mixedView = (): DistrictSelectionRouteView =>
    viewOf(
      1000,
      false,
      [
        { draws: 700, minPoints: 9, maxPoints: 16 },
        { draws: 120, minPoints: 11, maxPoints: 16 },
        { draws: 80, minPoints: 2, maxPoints: 7 },
        {},
      ],
      100
    );

  describe("districtSelectionHeadline", () => {
    it("names CAPTAIN when captaining is likelier than being picked, with the captain chance alone", () => {
      const headline = districtSelectionHeadline(mixedView());
      expect(headline.id).toBe("captain");
      expect(headline.chance).toBeCloseTo(0.7, 12);
      // NOT the chance of any selection points, which is 0.9 — that number under
      // the word "picked" is the defect this replaces.
      expect(headline.chance).not.toBeCloseTo(0.9, 6);
    });

    it("names PICKED when the two picks together beat captaining, and adds them", () => {
      const headline = districtSelectionHeadline(
        viewOf(1000, false, [{ draws: 300, minPoints: 9, maxPoints: 16 }, { draws: 250 }, { draws: 200 }, {}], 250)
      );
      expect(headline.id).toBe("picked");
      expect(headline.chance).toBeCloseTo(0.45, 12);
    });

    it("reads a TIE as picked, which is the shipped word", () => {
      const headline = districtSelectionHeadline(viewOf(100, false, [{ draws: 20 }, { draws: 10 }, { draws: 10 }, {}], 60));
      expect(headline.id).toBe("picked");
      expect(headline.chance).toBeCloseTo(0.2, 12);
    });

    it("refuses a denominator it cannot divide by rather than printing an infinite percentage", () => {
      const broken: DistrictSelectionRouteView = { ...mixedView(), denominator: 0 };
      expect(() => districtSelectionHeadline(broken)).toThrow(InvalidRouteDenominatorError);
    });
  });

  describe("districtSelectionSettledRoute", () => {
    it("names the one route every run took, at its one alliance number, once the ranking is FIXED", () => {
      const settled = districtSelectionSettledRoute(
        viewOf(1000, true, [{ draws: 1000, minPoints: 12, maxPoints: 12, allianceNumber: 5 }, {}, {}, {}], 0)
      );
      expect(settled).toEqual({ id: "captain", allianceNumber: 5 });
    });

    it("names a first pick and a second pick too, on the same terms", () => {
      expect(
        districtSelectionSettledRoute(viewOf(10, true, [{}, { draws: 10, minPoints: 15, maxPoints: 15, allianceNumber: 2 }, {}, {}], 0))
      ).toEqual({ id: "firstPick", allianceNumber: 2 });
      expect(
        districtSelectionSettledRoute(viewOf(10, true, [{}, {}, { draws: 10, minPoints: 3, maxPoints: 3, allianceNumber: 3 }, {}], 0))
      ).toEqual({ id: "secondPick", allianceNumber: 3 });
    });

    it("names NOTHING while the ranking is still open, however unanimous the runs are", () => {
      // The agreement is a prediction there, and the cell already prints it as a
      // chance. Stating it as a caption would assert a draft that has not happened.
      expect(
        districtSelectionSettledRoute(
          viewOf(1000, false, [{ draws: 1000, minPoints: 12, maxPoints: 12, allianceNumber: 5 }, {}, {}, {}], 0)
        )
      ).toBeUndefined();
    });

    it("names nothing for a team no run selected, and nothing where the runs split", () => {
      expect(districtSelectionSettledRoute(viewOf(50, true, [{}, {}, {}, {}], 50))).toBeUndefined();
      expect(
        districtSelectionSettledRoute(viewOf(50, true, [{ draws: 30, allianceNumber: 1 }, { draws: 20, allianceNumber: 2 }, {}, {}], 0))
      ).toBeUndefined();
    });

    it("names nothing where every run took one route but its alliance number is not agreed", () => {
      expect(
        districtSelectionSettledRoute(viewOf(50, true, [{ draws: 50, minPoints: 9, maxPoints: 16, allianceNumber: undefined }, {}, {}, {}], 0))
      ).toBeUndefined();
    });
  });

  describe("districtSelectionOutcomes", () => {
    it("lists the routes in points descending order, with the range the RUNS produced", () => {
      const rows = districtSelectionOutcomes(mixedView());
      expect(rows.map((row) => row.id)).toEqual(["captain", "firstPick", "secondPick", "notSelected"]);
      expect(rows.map((row) => [row.minPoints, row.maxPoints])).toEqual([
        [9, 16],
        [11, 16],
        [2, 7],
        [0, 0],
      ]);
      expect(rows.map((row) => row.chance)).toEqual([0.7, 0.12, 0.08, 0.1]);
    });

    it("falls back to the range a route CAN pay where no run took it, never to a zero", () => {
      const rows = districtSelectionOutcomes(viewOf(100, false, [{}, {}, { draws: 100, minPoints: 4, maxPoints: 4 }, {}], 0));
      const captain = rows.find((row) => row.id === "captain")!;
      expect(captain.chance).toBe(0);
      // A captain pays 9 to 16 whether or not these runs produced one, and a
      // printed 0 would read as "captaining pays nothing".
      expect([captain.minPoints, captain.maxPoints]).toEqual([possibleFor(0).low, possibleFor(0).high]);
    });

    it("keeps a zero-chance row while the ranking is open, so the list's length does not move with the draws", () => {
      const rows = districtSelectionOutcomes(viewOf(100, false, [{ draws: 100, minPoints: 16, maxPoints: 16, allianceNumber: 1 }, {}, {}, {}], 0));
      expect(rows.map((row) => row.id)).toEqual(["captain", "firstPick", "secondPick", "notSelected"]);
    });

    it("omits the routes the RANKING has ruled out: a settled captain has exactly one row", () => {
      const rows = districtSelectionOutcomes(viewOf(100, true, [{ draws: 100, minPoints: 16, maxPoints: 16, allianceNumber: 1 }, {}, {}, {}], 0));
      expect(rows.map((row) => row.id)).toEqual(["captain"]);
      expect(rows[0]!.chance).toBe(1);
      expect([rows[0]!.minPoints, rows[0]!.maxPoints]).toEqual([16, 16]);
    });

    it("leaves a non-captain with NO captain row once quals are done, which is the case Jacob named", () => {
      const rows = districtSelectionOutcomes(viewOf(100, true, [{}, {}, { draws: 100, minPoints: 6, maxPoints: 6, allianceNumber: 6 }, {}], 0));
      expect(rows.map((row) => row.id)).toEqual(["secondPick"]);
    });

    it("leaves an unselected team with only its own row once quals are done", () => {
      const rows = districtSelectionOutcomes(viewOf(100, true, [{}, {}, {}, {}], 100));
      expect(rows.map((row) => row.id)).toEqual(["notSelected"]);
      expect(rows[0]!.chance).toBe(1);
    });

    it("lists a BACKUP ROBOT only where a run produced one", () => {
      expect(districtSelectionOutcomes(mixedView()).some((row) => row.id === "backup")).toBe(false);
      const withBackup = districtSelectionOutcomes(viewOf(10, false, [{}, {}, {}, { draws: 10, minPoints: 0, maxPoints: 0, allianceNumber: 1 }], 0));
      expect(withBackup.map((row) => row.id)).toEqual(["captain", "firstPick", "secondPick", "backup", "notSelected"]);
    });

    it("accounts for EVERY run in every case — the load-bearing arithmetic", () => {
      const views = [
        mixedView(),
        viewOf(100, false, [{}, {}, { draws: 100, minPoints: 4, maxPoints: 4 }, {}], 0),
        viewOf(100, true, [{ draws: 100, minPoints: 16, maxPoints: 16, allianceNumber: 1 }, {}, {}, {}], 0),
        viewOf(100, true, [{}, {}, {}, {}], 100),
        viewOf(10, false, [{}, {}, {}, { draws: 4, minPoints: 0, maxPoints: 0, allianceNumber: 1 }], 6),
        viewOf(1000, false, [{ draws: 300 }, { draws: 250 }, { draws: 200 }, {}], 250),
      ];
      for (const view of views) {
        expect(districtSelectionUnaccountedMass(view, districtSelectionOutcomes(view))).toBeCloseTo(0, 12);
      }
    });

    it("keeps the headline's own number inside the list, so the two cannot disagree", () => {
      const view = mixedView();
      const headline = districtSelectionHeadline(view);
      const rows = districtSelectionOutcomes(view);
      const captain = rows.find((row) => row.id === "captain")!.chance;
      const picked = rows.find((row) => row.id === "firstPick")!.chance + rows.find((row) => row.id === "secondPick")!.chance;
      expect(headline.chance).toBeCloseTo(headline.id === "captain" ? captain : picked, 12);
    });
  });

  it("does NOT name alliance selection in the by-category predicate: its list is chosen by the DATA", () => {
    expect(districtCellRendersOutcomeList("alliance")).toBe(false);
    expect(districtCellRendersOutcomeList("elim")).toBe(true);
    expect(districtCellRendersOutcomeList("award")).toBe(true);
  });
});
