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
import {
  districtAwardOutcomes,
  districtCellRendersOutcomeList,
  districtOutcomeUnaccountedMass,
  districtPlayoffOutcomes,
  PLAYOFF_ZERO_PLACEMENTS,
} from "./districtLedgerOutcomes.js";
import type { DistrictPlayoffMilestone, DistrictPointDistribution } from "./districtLedgerRows.js";

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
