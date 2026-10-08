/**
 * The verdict drawer's model (sketch 025 variant A, quick task 261006-lxp).
 *
 * Open cells are built with the shipped `pointCellSummary` over a hand-written
 * distribution, and every ceiling comes from `maxEventPoints`, so a cell here is
 * a cell the ledger could have built.
 */
import { describe, expect, it } from "vitest";
import { pointCellSummary, pointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import { maxEventPoints } from "../../../../../packages/core/districts/pointModel.js";
import { playoffPoints } from "../../../../../packages/core/districts/bracket.js";
import { districtSelectionPoints } from "../../../../../packages/core/districts/selectionPoints.js";
import type { DistrictSelectionRouteObservation } from "../../../../../packages/core/districts/ledgerSimulation.js";
import {
  MissingGrandVerdictError,
  MissingTotalContextError,
  buildVerdictModel,
  champGrandSourceChips,
  districtGrandSourceChips,
  ledgerGrandVerdict,
  verdictCategoryChips,
  verdictOutcomeRows,
  type BuildVerdictModelInput,
  type VerdictOpenCell,
} from "./ledgerVerdict.js";
import { openCellLines } from "./LedgerParts.js";
import type { DistrictCellKind, DistrictLedgerCell, DistrictSelectionRouteView } from "./districtLedgerRows.js";
import type { DistrictCellPricing } from "./districtLedgerOutcomes.js";
import type { ChampContribution, ChampLedgerCell } from "./champLedgerRows.js";
import type { LedgerCutoffView, PredictedCutoff } from "./predictedCutoff.js";

const SEASON = 2026;
const CEILINGS = maxEventPoints(SEASON, "district");
const EN_DASH = String.fromCharCode(0x2013);

/** An open cell over `counts` (index = points), summed for its denominator. */
function openCell(cell: DistrictCellKind, counts: readonly number[], ceiling: number, extra: Partial<VerdictOpenCell> = {}): VerdictOpenCell {
  const denominator = counts.reduce((sum, value) => sum + value, 0);
  return {
    id: `live:${cell}`,
    cell,
    kind: "open",
    summary: pointCellSummary(counts, denominator),
    distribution: { counts: Float64Array.from(counts), denominator },
    ceiling,
    ...extra,
  };
}

/** A sparse distribution: `[points, count]` pairs on a zero array up to `ceiling`. */
function sparse(ceiling: number, pairs: ReadonlyArray<readonly [number, number]>): number[] {
  const counts = new Array<number>(ceiling + 1).fill(0);
  for (const [points, count] of pairs) counts[points] = (counts[points] ?? 0) + count;
  return counts;
}

/** A two lump grand total on 0..425: 600 runs around 330 and 400 around 360. */
function grandCounts(): number[] {
  return sparse(425, [
    [326, 150],
    [330, 300],
    [334, 150],
    [356, 100],
    [360, 200],
    [364, 100],
  ]);
}

function view(cutoff: PredictedCutoff, likely?: { p10: number; p90: number }): LedgerCutoffView {
  return { cutoff, likely, districtOnly: false };
}

const BOUNDARY = { above: 214, below: 212 };

function baseInput(cell: VerdictOpenCell, overrides: Partial<BuildVerdictModelInput> = {}): BuildVerdictModelInput {
  return {
    cell,
    cellTitle: "Grand total",
    teamNumber: 4915,
    nickname: "Spartronics",
    season: SEASON,
    isRookie: false,
    tier: "district",
    namedOutcomes: true,
    ...overrides,
  };
}

describe("ledgerGrandVerdict", () => {
  it("reads a range call before every status, a printed chance next, then the guarantees and Declined", () => {
    expect(ledgerGrandVerdict({ statusKey: "capacityUnknown", rangeCall: "pending", chance: undefined })).toEqual({ kind: "pending" });
    expect(ledgerGrandVerdict({ statusKey: "locked", rangeCall: "noCall", chance: 0.4 })).toEqual({ kind: "noCall" });
    expect(ledgerGrandVerdict({ statusKey: "inRange", rangeCall: undefined, chance: 0.57 })).toEqual({ kind: "chance", chance: 0.57 });
    expect(ledgerGrandVerdict({ statusKey: "locked", rangeCall: undefined, chance: undefined })).toEqual({ kind: "qualified" });
    expect(ledgerGrandVerdict({ statusKey: "prequalified", rangeCall: undefined, chance: undefined })).toEqual({ kind: "qualified" });
    expect(ledgerGrandVerdict({ statusKey: "lockedOut", rangeCall: undefined, chance: undefined })).toEqual({ kind: "lockedOut" });
    expect(ledgerGrandVerdict({ statusKey: "declined", rangeCall: undefined, chance: undefined })).toEqual({ kind: "declined" });
    expect(ledgerGrandVerdict({ statusKey: "inRange", rangeCall: undefined, chance: undefined })).toEqual({ kind: "open" });
    expect(ledgerGrandVerdict({ statusKey: "outOfRange", rangeCall: undefined, chance: undefined })).toEqual({ kind: "open" });
    expect(ledgerGrandVerdict({ statusKey: "capacityUnknown", rangeCall: undefined, chance: undefined })).toEqual({ kind: "open" });
    expect(ledgerGrandVerdict({ statusKey: undefined, rangeCall: undefined, chance: undefined })).toEqual({ kind: "open" });
  });
});

describe("buildVerdictModel on the grand total", () => {
  const cell = openCell("grandTotal", grandCounts(), 425);
  const { p10, p50, p90 } = pointPercentiles(cell.distribution.counts, cell.distribution.denominator);

  it("writes the eyebrow, the chance headline and the median, likely and cutoff tiles", () => {
    const model = buildVerdictModel(
      baseInput(cell, {
        grand: {
          verdict: { kind: "chance", chance: 0.57 },
          cutoff: view({ kind: "predicted", points: 213, boundary: BOUNDARY, source: "simulated" }, { p10: 199, p90: 228 }),
        },
      })
    );
    expect(model.eyebrow).toBe("Grand total · 4915 Spartronics");
    expect(model.headline).toBe("Qualifies in 57 of 100 runs.");
    expect(model.tiles.map((t) => [t.key, t.label, t.value])).toEqual([
      ["median", "median", `~${String(Math.round(p50))}`],
      ["likely", "likely", `${String(Math.round(p10))}${EN_DASH}${String(Math.round(p90))}`],
      ["cutoff", "cutoff", "~213"],
    ]);
    expect(model.chart.kind).toBe("histogram");
    if (model.chart.kind !== "histogram") return;
    expect(model.chart.testId).toBe("district-ledger-drawer-grand-plot");
    expect(model.chart.label).toBe("Grand total district points");
    expect(model.chart.maxPoints).toBe(425);
    expect(model.chart.cutoff).toEqual({ position: 213, label: "cutoff ~213", zone: { p10: 199, p90: 228 } });
    expect(model.chart.capLabel).toBeUndefined();
    expect(model.sourceChips).toEqual([]);
  });

  it("draws a settled cutoff with a bare figure and no zone", () => {
    const model = buildVerdictModel(
      baseInput(cell, { grand: { verdict: { kind: "qualified" }, cutoff: view({ kind: "final", points: 213, boundary: BOUNDARY }, { p10: 199, p90: 228 }) } })
    );
    expect(model.headline).toBe("Already qualified.");
    expect(model.tiles.find((t) => t.key === "cutoff")?.value).toBe("213");
    if (model.chart.kind !== "histogram") throw new Error("histogram expected");
    expect(model.chart.cutoff).toEqual({ position: 213, label: "cutoff 213", zone: undefined });
  });

  it("draws a midpoint cutoff with no zone where no likely range is printed", () => {
    const model = buildVerdictModel(
      baseInput(cell, { grand: { verdict: { kind: "chance", chance: 0.3 }, cutoff: view({ kind: "predicted", points: 213, boundary: BOUNDARY, source: "boundary" }) } })
    );
    if (model.chart.kind !== "histogram") throw new Error("histogram expected");
    expect(model.chart.cutoff).toEqual({ position: 213, label: "cutoff ~213", zone: undefined });
  });

  it("prints a state word on the cutoff tile and draws no cutoff for the four non figure arms", () => {
    const cases: ReadonlyArray<readonly [PredictedCutoff, string]> = [
      [{ kind: "capacityUnknown" }, "not published"],
      [{ kind: "absent" }, "none"],
      [{ kind: "pending" }, "pending"],
      [{ kind: "unavailable", reason: "noLine" }, "not available"],
    ];
    for (const [cutoff, word] of cases) {
      const model = buildVerdictModel(baseInput(cell, { grand: { verdict: { kind: "open" }, cutoff: view(cutoff) } }));
      expect(model.tiles.find((t) => t.key === "cutoff")?.value, cutoff.kind).toBe(word);
      if (model.chart.kind !== "histogram") throw new Error("histogram expected");
      expect(model.chart.cutoff, cutoff.kind).toBeUndefined();
      expect(model.headline).toBe(`Likely ${String(Math.round(p10))}${EN_DASH}${String(Math.round(p90))} grand total points.`);
    }
  });

  it("refuses a grand total cell without its grand verdict", () => {
    expect(() => buildVerdictModel(baseInput(cell))).toThrow(MissingGrandVerdictError);
  });

  it("passes the source chips through unchanged", () => {
    const chips = [{ kind: "note" as const, text: "+10 rookie bonus" }];
    const model = buildVerdictModel(baseInput(cell, { grand: { verdict: { kind: "open" }, cutoff: view({ kind: "absent" }) }, sourceChips: chips }));
    expect(model.sourceChips).toEqual(chips);
  });
});

describe("buildVerdictModel on the qualification cell", () => {
  it("names the cap where the median sits at it, with the cap label on the chart", () => {
    const counts = sparse(CEILINGS.qual, [
      [CEILINGS.qual, 58],
      [CEILINGS.qual - 1, 22],
      [CEILINGS.qual - 2, 12],
      [CEILINGS.qual - 3, 8],
    ]);
    const model = buildVerdictModel(baseInput(openCell("qual", counts, CEILINGS.qual), { cellTitle: "Qualification" }));
    expect(CEILINGS.qual).toBe(22);
    expect(model.headline).toBe("Finishes quals at the 22 point cap in 58 of 100 runs.");
    expect(model.tiles.map((t) => t.key)).toEqual(["median", "likely"]);
    if (model.chart.kind !== "histogram") throw new Error("histogram expected");
    expect(model.chart.testId).toBe("district-ledger-drawer-cell-plot");
    expect(model.chart.label).toBe("Points for this category");
    expect(model.chart.capLabel).toBe("22 cap");
    expect(model.chart.cutoff).toBeUndefined();
  });

  it("prints the likely headline anywhere else, still with the cap label", () => {
    const counts = sparse(CEILINGS.qual, [
      [8, 20],
      [10, 40],
      [12, 30],
      [14, 10],
    ]);
    const cell = openCell("qual", counts, CEILINGS.qual);
    const { p10, p90 } = pointPercentiles(cell.distribution.counts, cell.distribution.denominator);
    const model = buildVerdictModel(baseInput(cell, { cellTitle: "Qualification" }));
    expect(model.headline).toBe(`Likely ${String(Math.round(p10))}${EN_DASH}${String(Math.round(p90))} qualification points.`);
    if (model.chart.kind !== "histogram") throw new Error("histogram expected");
    expect(model.chart.capLabel).toBe("22 cap");
  });
});

describe("buildVerdictModel on a total", () => {
  const counts = sparse(120, [
    [40, 20],
    [50, 50],
    [60, 30],
  ]);
  const cell = openCell("eventTotal", counts, 120);
  const { p10, p50, p90 } = pointPercentiles(cell.distribution.counts, cell.distribution.denominator);
  const range = `${String(Math.round(p10))}${EN_DASH}${String(Math.round(p90))}`;

  it("names the event by its short name on a District tab event total", () => {
    const model = buildVerdictModel(baseInput(cell, { total: { kind: "event", eventName: "PNW District Sammamish Event" } }));
    expect(model.headline).toBe(`Likely ${range} points at Sammamish.`);
    expect(model.tiles.map((t) => t.key)).toEqual(["median", "likely"]);
    if (model.chart.kind !== "histogram") throw new Error("histogram expected");
    expect(model.chart.capLabel).toBeUndefined();
  });

  it("names the district noun on the Champ district subtotal", () => {
    expect(buildVerdictModel(baseInput(cell, { total: { kind: "district" } })).headline).toBe(`Likely ${range} district points.`);
  });

  it("answers the field question on an open DCMP subtotal, and the likely range once the field is settled", () => {
    expect(buildVerdictModel(baseInput(cell, { total: { kind: "dcmp", fieldChance: 0.71 } })).headline).toBe(
      `In the field in 71 of 100 runs, and ~${String(Math.round(p50))} points if there.`
    );
    expect(buildVerdictModel(baseInput(cell, { total: { kind: "dcmp", fieldChance: 0.02 } })).headline).toMatch(/^In the field in fewer than 5 of 100 runs/);
    expect(buildVerdictModel(baseInput(cell, { total: { kind: "dcmp", fieldChance: 1 } })).headline).toBe(`Likely ${range} DCMP points.`);
    expect(buildVerdictModel(baseInput(cell, { total: { kind: "dcmp", fieldChance: undefined } })).headline).toBe(`Likely ${range} DCMP points.`);
  });

  it("refuses an event total without its total context", () => {
    expect(() => buildVerdictModel(baseInput(cell))).toThrow(MissingTotalContextError);
  });
});

describe("buildVerdictModel on an outcome cell", () => {
  const points = [1, 2, 3, 4, 5].map((placement) => playoffPoints(SEASON, "district", placement));

  it("heads with the likeliest outcome and tiles the chance of any points", () => {
    const counts = sparse(CEILINGS.elim, [
      [points[0]!, 5],
      [points[1]!, 8],
      [points[2]!, 8],
      [points[3]!, 10],
      [0, 69],
    ]);
    const model = buildVerdictModel(baseInput(openCell("elim", counts, CEILINGS.elim), { cellTitle: "Playoffs" }));
    expect(model.headline).toBe("Out before the top four in 69 of 100 runs.");
    expect(model.tiles).toEqual([
      { key: "mostLikely", label: "most likely", value: "Out before the top four" },
      { key: "chanceOfPoints", label: "chance of points", value: "31%" },
    ]);
    expect(model.chart.kind).toBe("outcomes");
    if (model.chart.kind !== "outcomes") return;
    expect(model.chart.label).toBe("Playoff outcomes");
    // The implicit row is gone from the list (261007-3ik) while the headline
    // and tiles above still count it.
    expect(model.chart.rows.map((row) => row.key)).toEqual(["winner", "finalist", "third", "fourth"]);
  });

  it("heads an alliance placed sixth with the implicit outcome and lists no rows (261007-3ik)", () => {
    const counts = sparse(CEILINGS.elim, [[0, 100]]);
    const model = buildVerdictModel(
      baseInput(openCell("elim", counts, CEILINGS.elim, { playoffMilestone: { kind: "placed", placement: 6, points: 0 } }), { cellTitle: "Playoffs" })
    );
    expect(model.headline).toBe("Out before the top four in 100 of 100 runs.");
    expect(model.tiles).toEqual([
      { key: "mostLikely", label: "most likely", value: "Out before the top four" },
      { key: "chanceOfPoints", label: "chance of points", value: "0%" },
    ]);
    expect(model.chart.kind).toBe("outcomes");
    if (model.chart.kind !== "outcomes") return;
    expect(model.chart.rows).toEqual([]);
  });

  it("breaks an exact tie toward the row that pays more", () => {
    const counts = sparse(CEILINGS.elim, [
      [points[0]!, 40],
      [points[1]!, 40],
      [0, 20],
    ]);
    const model = buildVerdictModel(baseInput(openCell("elim", counts, CEILINGS.elim)));
    expect(model.headline).toBe("Wins the event in 40 of 100 runs.");
  });

  it("lists award outcomes, and draws a histogram for a playoffs cell on a summed row", () => {
    const counts = sparse(CEILINGS.award, [
      [0, 78],
      [5, 19],
      [10, 3],
    ]);
    const award = buildVerdictModel(baseInput(openCell("award", counts, CEILINGS.award)));
    expect(award.headline).toBe("No award in 78 of 100 runs.");
    expect(award.tiles[1]!.value).toBe("22%");
    expect(award.chart.kind === "outcomes" ? award.chart.rows.map((row) => row.key) : []).toEqual(["impact", "judged"]);

    const elimCounts = sparse(CEILINGS.elim * 2, [
      [0, 50],
      [20, 30],
      [43, 20],
    ]);
    const summed = buildVerdictModel(baseInput(openCell("elim", elimCounts, CEILINGS.elim * 2), { namedOutcomes: false }));
    expect(summed.chart.kind).toBe("histogram");
    expect(summed.headline).toMatch(/^Likely \d+–\d+ playoff points\.$/);
    expect(summed.tiles.map((t) => t.key)).toEqual(["median", "likely"]);
  });

  it("lists the routes for an alliance cell whose run reported them, with ranges, and a histogram otherwise", () => {
    const possible = (slot: number) => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => districtSelectionPoints(SEASON, "district", slot, n));
      return { possibleMinPoints: Math.min(...values), possibleMaxPoints: Math.max(...values) };
    };
    const obs = (slot: number, draws: number, min?: number, max?: number): DistrictSelectionRouteObservation => ({
      draws,
      minPoints: min,
      maxPoints: max,
      allianceNumber: undefined,
      ...possible(slot),
    });
    const selection: DistrictSelectionRouteView = {
      routes: { bySlot: [obs(0, 12, 9, 16), obs(1, 14, 11, 16), obs(2, 18, 2, 7), obs(3, 0)], notSelectedDraws: 56 },
      denominator: 100,
      rankingFixed: false,
    };
    const counts = sparse(CEILINGS.alliance, [
      [0, 56],
      [5, 18],
      [12, 26],
    ]);
    const routed = openCell("alliance", counts, CEILINGS.alliance, { selection });
    const outcomes = verdictOutcomeRows(routed, SEASON, "district", false, true);
    expect(outcomes?.label).toBe("Alliance selection outcomes");
    expect(outcomes?.rows[0]).toMatchObject({ key: "captain", label: "Captain" });
    expect(outcomes?.rows.every((row) => row.pointsHigh !== undefined)).toBe(true);
    const model = buildVerdictModel(baseInput(routed));
    expect(model.headline).toBe("Not selected in 56 of 100 runs.");
    expect(model.tiles[1]!.value).toBe("44%");
    // The Alliance list keeps its Not selected row; only Playoffs and Awards drop theirs.
    expect(model.chart.kind === "outcomes" ? model.chart.rows.at(-1)?.key : undefined).toBe("notSelected");

    const baked = openCell("alliance", counts, CEILINGS.alliance);
    expect(verdictOutcomeRows(baked, SEASON, "district", false, true)).toBeUndefined();
    expect(buildVerdictModel(baseInput(baked)).headline).toMatch(/^Likely \d+–\d+ alliance selection points\.$/);
  });
});

describe("the source chips", () => {
  it("sums settled District events into one earned chip, then one predicted chip per open event, then the rookie bonus", () => {
    const chips = districtGrandSourceChips(
      [
        { eventKey: "a", eventName: "PNW District Glacier Peak Event", earned: 52, open: undefined },
        { eventKey: "b", eventName: "Live Event", earned: 10, open: { p10: 30, p50: 41.6, p90: 55 } },
        { eventKey: "c", eventName: "Done Event", earned: 24, open: undefined },
      ],
      10
    );
    expect(chips).toEqual([
      { kind: "earned", figure: "76", text: "earned at Glacier Peak, Done Event" },
      { kind: "predicted", figure: "~42", text: "predicted at Live Event" },
      { kind: "note", text: "+10 rookie bonus" },
    ]);
    expect(districtGrandSourceChips([], 0)).toEqual([]);
  });

  function contributions(dcmp: Partial<ChampContribution>): ChampContribution[] {
    return [
      { row: "district", earned: 112, open: undefined, fieldChance: undefined, notYetPriced: false },
      { row: "dcmp", earned: undefined, open: { p10: 90, p50: 129.6, p90: 170 }, fieldChance: 0.71, notYetPriced: false, ...dcmp },
    ];
  }
  const team = { membership: "open" as const, grandTotalIsDistrictOnly: false, rookieBonus: 0 };

  it("carries the field suffix on the Champ DCMP chip only while the field chance is under one", () => {
    expect(champGrandSourceChips(contributions({}), team)).toEqual([
      { kind: "earned", figure: "112", text: "earned at district events" },
      { kind: "predicted", figure: "~130", text: "predicted at the DCMP, in the field 71% of runs" },
    ]);
    expect(champGrandSourceChips(contributions({ fieldChance: 0.02 }), team)[1]).toMatchObject({ text: "predicted at the DCMP, in the field <5% of runs" });
    expect(champGrandSourceChips(contributions({ fieldChance: 1 }), team)[1]).toMatchObject({ text: "predicted at the DCMP" });
    expect(champGrandSourceChips(contributions({ fieldChance: undefined }), { ...team, membership: "in" })[1]).toMatchObject({ text: "predicted at the DCMP" });
    expect(champGrandSourceChips(contributions({ earned: 140, open: undefined, fieldChance: undefined }), { ...team, membership: "in" })[1]).toEqual({
      kind: "earned",
      figure: "140",
      text: "earned at the DCMP",
    });
  });

  it("reads district points only for a team out of the field, a district only grand total and an unpriced DCMP, and adds the rookie bonus", () => {
    const note = { kind: "note", text: "district points only" };
    expect(champGrandSourceChips(contributions({}), { ...team, membership: "out" })[1]).toEqual(note);
    expect(champGrandSourceChips(contributions({}), { ...team, grandTotalIsDistrictOnly: true })[1]).toEqual(note);
    expect(champGrandSourceChips(contributions({ open: undefined, notYetPriced: true }), team)[1]).toEqual(note);
    expect(champGrandSourceChips(contributions({ open: undefined }), team)[1]).toEqual(note);
    const withBonus = champGrandSourceChips(
      [{ row: "district", earned: undefined, open: { p10: 40, p50: 60.2, p90: 80 }, fieldChance: undefined, notYetPriced: false }, ...contributions({}).slice(1)],
      { ...team, rookieBonus: 5 }
    );
    expect(withBonus[0]).toEqual({ kind: "predicted", figure: "~60", text: "predicted at district events" });
    expect(withBonus[withBonus.length - 1]).toEqual({ kind: "note", text: "+5 rookie bonus" });
  });

  it("builds one category chip per category cell, settled as its figure and open as the table cell prints it", () => {
    const qual = openCell("qual", sparse(CEILINGS.qual, [[18, 50], [20, 50]]), CEILINGS.qual);
    const elim = openCell("elim", sparse(CEILINGS.elim, [[0, 34], [7, 16], [13, 20], [20, 15], [30, 15]]), CEILINGS.elim);
    const award = openCell("award", sparse(CEILINGS.award, [[0, 78], [5, 22]]), CEILINGS.award);
    const cells: ChampLedgerCell[] = [
      qual,
      { id: "x:alliance", cell: "alliance", kind: "final", earned: 16 },
      elim,
      award,
      { id: "x:eventTotal", cell: "eventTotal", kind: "final", earned: 99 } satisfies DistrictLedgerCell,
      { id: "x:grandTotal", cell: "grandTotal", kind: "notYetPriced" },
    ];
    // THE SAME PRICING THE TABLE CELL RECEIVES (261008-3il), so a chip prints
    // exactly what the table prints, pays line included.
    const pricing: DistrictCellPricing = { season: SEASON, tier: "district", isRookie: false };
    const qualLines = openCellLines(qual, pricing);
    const elimLines = openCellLines(elim, pricing);
    const awardLines = openCellLines(award, pricing);
    expect(elimLines).toEqual({ bold: "66% top 4", small: "pays 7 to 30" });
    expect(verdictCategoryChips(cells, pricing)).toEqual([
      { kind: "category", label: "Quals", figure: qualLines.bold, small: qualLines.small, open: true },
      { kind: "category", label: "Alliance", figure: "16", small: undefined, open: false },
      { kind: "category", label: "Playoffs", figure: elimLines.bold, small: elimLines.small, open: true },
      { kind: "category", label: "Awards", figure: awardLines.bold, small: awardLines.small, open: true },
    ]);
  });
});

/** Every number a pays line prints, in order. */
function paysNumbers(small: string | undefined): number[] {
  expect(small).toMatch(/^pays /);
  return (small ?? "").match(/\d+/g)!.map(Number);
}

describe("the cell's pays line agrees with the drawer's outcome rows (261008-3il)", () => {
  const elimCounts = sparse(CEILINGS.elim, [[0, 34], [7, 16], [13, 20], [20, 15], [30, 15]]);
  const topFour = openCell("elim", elimCounts, CEILINGS.elim);
  const finalist = openCell("elim", elimCounts, CEILINGS.elim, { playoffMilestone: { kind: "finalist", chance: 0.3, conditionalMedian: 30 } });
  const winner = openCell("elim", elimCounts, CEILINGS.elim, { playoffMilestone: { kind: "winner", chance: 0.15, conditionalMedian: 30 } });

  for (const tier of ["district", "dcmp"] as const) {
    it(`prints only drawer row points on every Playoffs fixture at the ${tier} tier`, () => {
      const pricing: DistrictCellPricing = { season: SEASON, tier, isRookie: false };
      for (const cell of [topFour, finalist, winner]) {
        const drawer = verdictOutcomeRows(cell, SEASON, tier, false, true)!.rows.map((row) => row.points);
        for (const value of paysNumbers(openCellLines(cell, pricing).small)) expect(drawer).toContain(value);
      }
      // The top four pays line spans the fourth place value to the winner's.
      expect(paysNumbers(openCellLines(topFour, pricing).small)).toEqual([playoffPoints(SEASON, tier, 4), playoffPoints(SEASON, tier, 1)]);
    });
  }

  const award = openCell("award", sparse(CEILINGS.award, [[0, 44], [5, 46], [10, 10]]), CEILINGS.award);
  for (const [tier, isRookie] of [["district", false], ["district", true], ["dcmp", false], ["dcmp", true]] as const) {
    it(`prints only drawer row points on the Awards cell at the ${tier} tier, ${isRookie ? "rookie" : "veteran"}`, () => {
      const drawer = verdictOutcomeRows(award, SEASON, tier, isRookie, true)!.rows.map((row) => row.points);
      const printed = paysNumbers(openCellLines(award, { season: SEASON, tier, isRookie }).small);
      for (const value of printed) expect(drawer).toContain(value);
      // The span reaches from the smallest award to the largest.
      expect(printed[0]).toBe(Math.min(...drawer.filter((points) => points > 0)));
      expect(printed[printed.length - 1]).toBe(Math.max(...drawer));
    });
  }

  it("prints a selection route's span as the min and max of the drawer's own route rows", () => {
    const obs = (draws: number, min: number | undefined, max: number | undefined, possible: readonly [number, number]): DistrictSelectionRouteObservation => ({
      draws,
      minPoints: min,
      maxPoints: max,
      allianceNumber: undefined,
      possibleMinPoints: possible[0],
      possibleMaxPoints: possible[1],
    });
    const fixtures: readonly DistrictSelectionRouteView[] = [
      // Captain likelier.
      { routes: { bySlot: [obs(60, 9, 16, [9, 16]), obs(10, 9, 14, [9, 16]), obs(25, 3, 8, [1, 8]), obs(0, undefined, undefined, [0, 0])], notSelectedDraws: 5 }, denominator: 100, rankingFixed: false },
      // Only ever second picked, first pick untaken.
      { routes: { bySlot: [obs(30, 9, 11, [9, 16]), obs(0, undefined, undefined, [9, 16]), obs(60, 1, 8, [1, 8]), obs(0, undefined, undefined, [0, 0])], notSelectedDraws: 10 }, denominator: 100, rankingFixed: false },
      // Both pick routes taken.
      { routes: { bySlot: [obs(12, 9, 16, [9, 16]), obs(14, 11, 16, [9, 16]), obs(18, 2, 7, [1, 8]), obs(0, undefined, undefined, [0, 0])], notSelectedDraws: 56 }, denominator: 100, rankingFixed: false },
    ];
    const pricing: DistrictCellPricing = { season: SEASON, tier: "district", isRookie: false };
    for (const selection of fixtures) {
      const cell = openCell("alliance", sparse(CEILINGS.alliance, [[0, 50], [8, 50]]), CEILINGS.alliance, { selection });
      const rows = verdictOutcomeRows(cell, SEASON, "district", false, true)!.rows;
      const [low, high = low] = paysNumbers(openCellLines(cell, pricing).small);
      expect(rows.map((row) => row.points)).toContain(low);
      expect(rows.map((row) => row.pointsHigh)).toContain(high);
    }
  });
});
