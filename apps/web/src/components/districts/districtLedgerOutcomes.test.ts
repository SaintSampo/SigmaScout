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
import { ENGINEERING_INSPIRATION_AWARD_POINTS } from "../../../../../packages/core/districts/hypotheticalDcmp.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { districtSelectionPoints } from "../../../../../packages/core/districts/selectionPoints.js";
import type { DistrictSelectionRouteObservation } from "../../../../../packages/core/districts/ledgerSimulation.js";
import {
  districtAwardOutcomes,
  districtCellPay,
  districtCellRendersOutcomeList,
  districtOutcomeUnaccountedMass,
  districtPlayoffBestGuess,
  districtPlayoffOutcomes,
  districtSelectionHeadline,
  districtSelectionOutcomes,
  districtSelectionSettledRoute,
  districtSelectionUnaccountedMass,
  InvalidRouteDenominatorError,
  PLAYOFF_ZERO_PLACEMENTS,
  type DistrictCellPricing,
} from "./districtLedgerOutcomes.js";
import { openDistrictLedgerCell } from "./districtLedgerRows.js";
import type { DistrictLedgerCell, DistrictPlayoffMilestone, DistrictPointDistribution, DistrictSelectionRouteView } from "./districtLedgerRows.js";

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
    const milestone: DistrictPlayoffMilestone = { kind: "finalist" };
    const rows = districtPlayoffOutcomes(SEASON, TIER, playoffDistribution(), milestone);
    expect(rows.map((row) => row.id)).toEqual(["winner", "finalist", "third", "fourth"]);
  });

  it("omits third and fourth as well once the alliance is in the final", () => {
    const milestone: DistrictPlayoffMilestone = { kind: "winner" };
    const rows = districtPlayoffOutcomes(SEASON, TIER, playoffDistribution(), milestone);
    expect(rows.map((row) => row.id)).toEqual(["winner", "finalist"]);
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

describe("districtPlayoffBestGuess (261014-i1c)", () => {
  type OpenCell = Extract<DistrictLedgerCell, { kind: "open" }>;
  const DISTRICT: DistrictCellPricing = { season: SEASON, tier: "district", isRookie: false };
  const DCMP: DistrictCellPricing = { season: SEASON, tier: "dcmp", isRookie: false };

  /** An open Playoffs cell over `points -> count` pairs at the given tier's ceiling. */
  function elimCell(pairs: readonly (readonly [number, number])[], tier: "district" | "dcmp" = "district"): OpenCell {
    const ceiling = maxEventPoints(SEASON, tier).elim;
    return openDistrictLedgerCell("2026walive:elim", "elim", distributionOf(pairs, ceiling), ceiling) as OpenCell;
  }
  const finalist: DistrictPlayoffMilestone = { kind: "finalist" };
  const winner: DistrictPlayoffMilestone = { kind: "winner" };

  it("groups third and fourth, so two finishes that each lose to the biggest single row can win together", () => {
    const guess = districtPlayoffBestGuess(elimCell([[0, 34], [7, 16], [13, 20], [20, 15], [30, 15]]), DISTRICT)!;
    expect(guess.id).toBe("thirdOrFourth");
    expect(guess.chance).toBeCloseTo(0.36, 12);
    expect(guess.pay).toEqual({ kind: "values", values: [7, 13] });
  });

  it("prices 3rd or 4th at the DCMP's own values", () => {
    const guess = districtPlayoffBestGuess(elimCell([[0, 34], [21, 16], [39, 20], [60, 15], [90, 15]], "dcmp"), DCMP)!;
    expect(guess.id).toBe("thirdOrFourth");
    expect(guess.pay.values).toEqual([21, 39]);
  });

  it("names 5th to 8th with the single pay 0, zero kept", () => {
    const guess = districtPlayoffBestGuess(elimCell([[0, 60], [7, 10], [13, 10], [20, 10], [30, 10]]), DISTRICT)!;
    expect(guess.id).toBe("fifthToEighth");
    expect(guess.chance).toBeCloseTo(0.6, 12);
    expect(guess.pay).toEqual({ kind: "values", values: [0] });
  });

  it("names 1st and 2nd with their own pay", () => {
    expect(districtPlayoffBestGuess(elimCell([[0, 10], [20, 30], [30, 60]]), DISTRICT)).toMatchObject({ id: "first", pay: { values: [30] } });
    expect(districtPlayoffBestGuess(elimCell([[0, 10], [20, 60], [30, 30]]), DISTRICT)).toMatchObject({ id: "second", pay: { values: [20] } });
  });

  it("gives a tie to the better finish", () => {
    // 2nd 30 against 5th to 8th 30, with 1st and 3rd or 4th at 20.
    expect(districtPlayoffBestGuess(elimCell([[0, 30], [7, 10], [13, 10], [20, 30], [30, 20]]), DISTRICT)!.id).toBe("second");
    // 1st 40 against 2nd 40.
    expect(districtPlayoffBestGuess(elimCell([[0, 20], [20, 40], [30, 40]]), DISTRICT)!.id).toBe("first");
    // 3rd or 4th 40 against 5th to 8th 40.
    expect(districtPlayoffBestGuess(elimCell([[0, 40], [7, 20], [13, 20], [30, 20]]), DISTRICT)!.id).toBe("thirdOrFourth");
  });

  it("never names a finish the milestone rules out, even where its mass is the largest", () => {
    const missHeavy = { ...elimCell([[0, 70], [20, 20], [30, 10]]), playoffMilestone: finalist };
    expect(districtPlayoffBestGuess(missHeavy, DISTRICT)!.id).toBe("second");
    const thirdHeavy = { ...elimCell([[13, 70], [20, 20], [30, 10]]), playoffMilestone: winner };
    expect(districtPlayoffBestGuess(thirdHeavy, DISTRICT)!.id).toBe("second");
    // Top four secured: third or fourth stays on offer.
    const top = { ...elimCell([[7, 40], [13, 30], [20, 20], [30, 10]]), playoffMilestone: finalist };
    expect(districtPlayoffBestGuess(top, DISTRICT)).toMatchObject({ id: "thirdOrFourth", pay: { values: [7, 13] } });
  });

  it("reads the drawer's own rows: its chance is the sum of that finish's rows with the same milestone", () => {
    const cell = { ...elimCell([[7, 10], [13, 15], [20, 25], [30, 50]]), playoffMilestone: finalist };
    const rows = districtPlayoffOutcomes(SEASON, TIER, cell.distribution, cell.playoffMilestone);
    const guess = districtPlayoffBestGuess(cell, DISTRICT)!;
    expect(guess.id).toBe("first");
    expect(guess.chance).toBe(rows.find((row) => row.id === "winner")!.chance);
    const grouped = { ...elimCell([[7, 40], [13, 20], [20, 20], [30, 20]]), playoffMilestone: finalist };
    const groupedRows = districtPlayoffOutcomes(SEASON, TIER, grouped.distribution, grouped.playoffMilestone);
    const groupedGuess = districtPlayoffBestGuess(grouped, DISTRICT)!;
    expect(groupedGuess.id).toBe("thirdOrFourth");
    expect(groupedGuess.chance).toBe(groupedRows.filter((row) => row.id === "third" || row.id === "fourth").reduce((sum, row) => sum + row.chance, 0));
  });

  it("is undefined for a cell no single finish describes, and never throws", () => {
    const named = elimCell([[0, 34], [7, 16], [13, 20], [20, 15], [30, 15]]);
    // No pricing, as on the Champ Locks District points row.
    expect(districtPlayoffBestGuess(named, undefined)).toBeUndefined();
    // A season with no bracket: playoffPoints throws there, so the guard has to come first.
    expect(() => districtPlayoffBestGuess(named, { season: 2019, tier: "district", isRookie: false })).not.toThrow();
    expect(districtPlayoffBestGuess(named, { season: 2019, tier: "district", isRookie: false })).toBeUndefined();
    // A finals shift can land on named values by accident (21 plus 39 is 60).
    const shifted = { ...elimCell([[21, 50], [60, 50]], "dcmp"), shiftedByFinals: true } as const;
    expect(districtPlayoffBestGuess(shifted, DCMP)).toBeUndefined();
    // Mass at a value no placement pays.
    expect(districtPlayoffBestGuess(elimCell([[0, 50], [25, 50]]), DISTRICT)).toBeUndefined();
    // DCMP values priced at a district event.
    expect(districtPlayoffBestGuess(elimCell([[0, 34], [21, 66]], "dcmp"), DISTRICT)).toBeUndefined();
  });

  it("is undefined for a team on no alliance and for any cell that is not a Playoffs cell", () => {
    expect(districtPlayoffBestGuess({ ...elimCell([[0, 100]]), notPicked: true }, DISTRICT)).toBeUndefined();
    const ceiling = maxEventPoints(SEASON, TIER).award;
    const award = openDistrictLedgerCell("2026walive:award", "award", distributionOf([[0, 50], [5, 50]], ceiling), ceiling) as OpenCell;
    expect(districtPlayoffBestGuess(award, DISTRICT)).toBeUndefined();
  });
});

describe("districtAwardOutcomes", () => {
  it("lists the four named awards for a rookie, ordered by points descending", () => {
    const rows = districtAwardOutcomes(SEASON, TIER, awardDistribution(), true);
    expect(rows.map((row) => row.id)).toEqual(["impact", "rookieAllStar", "judged", "none"]);
    expect(rows.map((row) => row.points)).toEqual([10, 8, 5, 0]);
  });

  it("lists Engineering Inspiration in Rookie All Star's place for a veteran, which cannot win Rookie All Star at all (261014-i8i)", () => {
    const rows = districtAwardOutcomes(SEASON, TIER, awardDistribution(), false);
    expect(rows.map((row) => row.id)).toEqual(["impact", "engineeringInspiration", "judged", "none"]);
    expect(rows.map((row) => row.points)).toEqual([10, 8, 5, 0]);
    expect(ENGINEERING_INSPIRATION_AWARD_POINTS).toBe(ROOKIE_ALL_STAR_AWARD_POINTS);
  });

  it("prices both 8 point rows at the dcmp weight, and never lists both (261014-i8i)", () => {
    const veteran = districtAwardOutcomes(SEASON, "dcmp", awardDistribution(), false);
    expect(veteran.map((row) => row.id)).toEqual(["impact", "engineeringInspiration", "judged", "none"]);
    expect(veteran.map((row) => row.points)).toEqual([30, 24, 15, 0]);
    const rookie = districtAwardOutcomes(SEASON, "dcmp", awardDistribution(), true);
    expect(rookie.map((row) => row.id)).toEqual(["impact", "rookieAllStar", "judged", "none"]);
    expect(rookie.map((row) => row.points)).toEqual([30, 24, 15, 0]);
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

  it("accounts for EVERY unit of mass a FOLDED award distribution can carry, for a rookie AND a veteran, at both tiers", () => {
    // Every support value the draw can land on after the fold, at one count
    // each, times the tier weight. A veteran's 8 is Engineering Inspiration and
    // a rookie's is Rookie All Star, so each list covers the same folded set.
    const folded = [...new Set(AWARD_POINT_SUPPORT.map(foldStackedAwardPoints))];
    for (const tier of ["district", "dcmp"] as const) {
      const weight = tier === "district" ? 1 : 3;
      const distribution = distributionOf(
        folded.map((points) => [points * weight, 1] as const),
        maxEventPoints(SEASON, tier).award
      );
      for (const isRookie of [true, false]) {
        const rows = districtAwardOutcomes(SEASON, tier, distribution, isRookie);
        expect(districtOutcomeUnaccountedMass(distribution, rows), `${tier} rookie=${String(isRookie)}`).toBeCloseTo(0, 12);
      }
    }
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

  it("pays a veteran's Awards cell 5, 8 and 10 at a district event and 15, 24 and 30 at a DCMP (261014-i8i)", () => {
    type OpenCell = Extract<DistrictLedgerCell, { kind: "open" }>;
    for (const [tier, expected] of [
      ["district", [5, 8, 10]],
      ["dcmp", [15, 24, 30]],
    ] as const) {
      const ceiling = maxEventPoints(SEASON, tier).award;
      const cell = openDistrictLedgerCell("2026walive:award", "award", distributionOf([[0, 50], [5, 50]], ceiling), ceiling) as OpenCell;
      expect(districtCellPay(cell, { season: SEASON, tier, isRookie: false })).toEqual({ kind: "values", values: expected });
    }
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

    it("reads as PICKED when both routes print as 0%, so the cell never names a route beside a zero (260929-cz0)", () => {
      // 3 captain runs in 1,000 is 0.3%, which the cell prints as ~0%.
      const headline = districtSelectionHeadline(viewOf(1000, false, [{ draws: 3 }, {}, {}, {}], 997));
      expect(headline.id).toBe("picked");
      expect(Math.round(headline.chance * 100)).toBe(0);
    });

    it("still names CAPTAIN once the captain chance prints as 1%, even with no pick at all", () => {
      // 6 in 1,000 is 0.6%, which rounds to 1%: a route beside a printed number.
      const headline = districtSelectionHeadline(viewOf(1000, false, [{ draws: 6 }, {}, {}, {}], 994));
      expect(headline.id).toBe("captain");
      expect(Math.round(headline.chance * 100)).toBe(1);
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
