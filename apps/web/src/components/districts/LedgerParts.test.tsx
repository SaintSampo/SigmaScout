/**
 * The Locks ledger's two cell renderers on a PENDING cell (todo
 * locks-loading-cells-read-not-available, quick task 261007-4qr).
 *
 * While a Locks tab is still loading or its run has not landed, an open cell
 * with no distribution yet is the unavailable variant carrying `pending: true`.
 * It prints the pending word with `data-cell="pending"`, the same word the
 * predicted cutoff already prints at that moment, and never "not available",
 * which is the word for an event with no published data. The word carries the
 * meaning: the cell keeps the muted unavailable treatment and no new colour.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  GrandTotalContent,
  LedgerCell,
  OPEN_CELL_BOLD_CLASS,
  OPEN_CELL_SMALL_CLASS,
  UNAVAILABLE_CELL_CLASS,
  heldTeamMedian,
  openCellLines,
  type CellInteraction,
} from "./LedgerParts.js";
import {
  CHAMP_LEDGER_CUTOFF_PENDING_FIGURE,
  DISTRICT_LEDGER_PENDING_CELL,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
  districtLedgerCellLikelyText,
} from "./districtLedgerCopy.js";
import {
  buildDistrictEventSimulationInput,
  buildDistrictLedgerRows,
  distributionsFromResult,
  openDistrictLedgerCell,
  rowCountedPoints,
  securedElimEntry,
  tierEvents,
  type DistrictCellKind,
  type DistrictEventDistributions,
  type DistrictLedgerCell,
  type DistrictStageFinality,
} from "./districtLedgerRows.js";
import { buildChampLedgerRows, dcmpEventKeysFor, type ChampLedgerCell } from "./champLedgerRows.js";
import { computeChampLedgerStatuses } from "./champLedgerStatus.js";
import { computeDistrictLedgerStatuses } from "./districtLedgerStatus.js";
import type { DistrictCellPricing } from "./districtLedgerOutcomes.js";
import { pointPercentiles } from "../../../../../packages/core/districts/pointSummary.js";
import { simulateDistrictEvent, type DistrictSelectionRouteObservation } from "../../../../../packages/core/districts/ledgerSimulation.js";
import { DistrictArtifactSchema, EventArtifactSchema } from "../../../../../packages/harness/pageArtifacts.js";

afterEach(() => cleanup());

const INTERACTION: CellInteraction = { openCellId: undefined, onToggle: () => undefined };
const PENDING: DistrictLedgerCell = { id: "2026walive:qual", cell: "qual", kind: "unavailable", pending: true };
const PLAIN: DistrictLedgerCell = { id: "2026walive:qual", cell: "qual", kind: "unavailable" };
const GRAND_PENDING: DistrictLedgerCell = { id: "grandTotal", cell: "grandTotal", kind: "unavailable", pending: true };
const GRAND_PLAIN: DistrictLedgerCell = { id: "grandTotal", cell: "grandTotal", kind: "unavailable" };

function inRow(node: ReactNode) {
  return render(
    <table>
      <tbody>
        <tr>{node}</tr>
      </tbody>
    </table>
  );
}

describe("the pending word (261007-4qr)", () => {
  it("is the predicted cutoff's own pending figure, with no hyphen or dash character", () => {
    expect(DISTRICT_LEDGER_PENDING_CELL).toBe(CHAMP_LEDGER_CUTOFF_PENDING_FIGURE);
    expect(DISTRICT_LEDGER_PENDING_CELL).not.toMatch(/[-‐-―−]/);
  });
});

describe("LedgerCell on an unavailable cell", () => {
  it("prints the pending word with data-cell pending for a pending cell, never the unavailable word", () => {
    const { container } = inRow(<LedgerCell cell={PENDING} interaction={INTERACTION} />);
    const td = container.querySelector("td")!;
    expect(td.getAttribute("data-cell")).toBe("pending");
    expect(td.textContent).toBe(DISTRICT_LEDGER_PENDING_CELL);
    expect(td.textContent).not.toContain(DISTRICT_LEDGER_UNAVAILABLE_CELL);
    expect(td.querySelector("button")).toBeNull();
    expect(td.querySelector("span")!.className).toBe(UNAVAILABLE_CELL_CLASS);
  });

  it("still prints not available with data-cell unavailable for a plain unavailable cell", () => {
    const { container } = inRow(<LedgerCell cell={PLAIN} interaction={INTERACTION} />);
    const td = container.querySelector("td")!;
    expect(td.getAttribute("data-cell")).toBe("unavailable");
    expect(td.textContent).toBe(DISTRICT_LEDGER_UNAVAILABLE_CELL);
  });
});

describe("LedgerCell on a final cell (quick task 261010-66y, D6)", () => {
  const EXACT: DistrictLedgerCell = { id: "2026walive:elim", cell: "elim", kind: "final", earned: 21 };
  const UP_TO: DistrictLedgerCell = { id: "2026walive:elim", cell: "elim", kind: "final", earned: 21, upTo: true };

  it("prints up to 21 for a settled Playoffs value that is not exact, still a grey final cell and never a button", () => {
    const { container } = inRow(<LedgerCell cell={UP_TO} interaction={INTERACTION} />);
    const td = container.querySelector("td")!;
    expect(td.getAttribute("data-cell")).toBe("final");
    expect(td.getAttribute("data-cell-id")).toBe("2026walive:elim");
    expect(td.textContent).toBe("up to 21");
    expect(td.textContent).not.toMatch(/[-‐-―−~]/);
    expect(td.querySelector("button")).toBeNull();
    // The class list is the exact value's own: a plain string, nothing merged away.
    const exact = inRow(<LedgerCell cell={EXACT} interaction={INTERACTION} />).container.querySelector("td")!;
    expect(td.querySelector("div")!.className).toBe(exact.querySelector("div")!.className);
  });

  it("prints 21 for an exact value, as before", () => {
    const { container } = inRow(<LedgerCell cell={EXACT} interaction={INTERACTION} />);
    const td = container.querySelector("td")!;
    expect(td.getAttribute("data-cell")).toBe("final");
    expect(td.textContent).toBe("21");
  });
});

describe("GrandTotalContent on an unavailable cell", () => {
  it("prints the pending word with data-cell pending for a pending grand total", () => {
    const { container } = inRow(
      <td>
        <GrandTotalContent cell={GRAND_PENDING} interaction={INTERACTION} />
      </td>
    );
    const span = container.querySelector("[data-cell]")!;
    expect(span.getAttribute("data-cell")).toBe("pending");
    expect(span.textContent).toBe(DISTRICT_LEDGER_PENDING_CELL);
    expect(span.className).toBe(UNAVAILABLE_CELL_CLASS);
    expect(container.querySelector("button")).toBeNull();
  });

  it("still prints not available for a plain unavailable grand total", () => {
    const { container } = inRow(
      <td>
        <GrandTotalContent cell={GRAND_PLAIN} interaction={INTERACTION} />
      </td>
    );
    const span = container.querySelector("[data-cell]")!;
    expect(span.getAttribute("data-cell")).toBe("unavailable");
    expect(span.textContent).toBe(DISTRICT_LEDGER_UNAVAILABLE_CELL);
  });
});

// ---------------------------------------------------------------------------
// ONE GRAMMAR FOR EVERY OPEN CELL (quick task 261008-3il): the chance first,
// then the outcome, and on the small line what that outcome pays.
// ---------------------------------------------------------------------------

type OpenCell = Extract<DistrictLedgerCell, { kind: "open" }>;

/** An open cell over hand built counts whose denominator is 100. */
function openFrom(id: string, cell: DistrictCellKind, mass: Readonly<Record<number, number>>, ceiling: number): OpenCell {
  const top = Math.max(ceiling, ...Object.keys(mass).map(Number));
  const counts = new Float64Array(top + 1);
  for (const [points, count] of Object.entries(mass)) counts[Number(points)] = count;
  return openDistrictLedgerCell(id, cell, { counts, denominator: 100 }, ceiling) as OpenCell;
}

/** Third (20) and fourth (16) each lose to none (34), but grouped they make 36: the best guess is 3rd or 4th. 2026 district values. */
const TOP_FOUR = openFrom("2026walive:elim", "elim", { 0: 34, 7: 16, 13: 20, 20: 15, 30: 15 }, 30);
/** A top four finish is secured: no mass at the ruled out value 0. */
const FINALIST = {
  ...openFrom("2026walive:elim", "elim", { 7: 10, 13: 15, 20: 45, 30: 30 }, 30),
  playoffMilestone: { kind: "finalist" },
} as const satisfies OpenCell;
/** In the final: 2nd or 1st only. */
const WINNER = { ...openFrom("2026walive:elim", "elim", { 20: 41, 30: 59 }, 30), playoffMilestone: { kind: "winner" } } as const satisfies OpenCell;
/** Every run wins: the chance reads 99%, never 100%. */
const WINNER_SURE = { ...openFrom("2026walive:elim", "elim", { 30: 100 }, 30), playoffMilestone: { kind: "winner" } } as const satisfies OpenCell;
/** The same three shapes on the District Championship's 3x placement values. */
const TOP_FOUR_DCMP = openFrom("2026walive:elim", "elim", { 0: 34, 21: 16, 39: 20, 60: 15, 90: 15 }, 90);
const FINALIST_DCMP = {
  ...openFrom("2026walive:elim", "elim", { 21: 10, 39: 15, 60: 45, 90: 30 }, 90),
  playoffMilestone: { kind: "finalist" },
} as const satisfies OpenCell;
const WINNER_DCMP = { ...openFrom("2026walive:elim", "elim", { 60: 41, 90: 59 }, 90), playoffMilestone: { kind: "winner" } } as const satisfies OpenCell;
/** Nothing in the top four is likelier than missing it, even grouped. */
const FIFTH_TO_EIGHTH = openFrom("2026walive:elim", "elim", { 0: 60, 7: 10, 13: 10, 20: 10, 30: 10 }, 30);
/** 2nd and 5th to 8th each took 30 runs, 1st 20 and 3rd or 4th 20: the better finish of the tie is named. */
const TIE_SECOND = openFrom("2026walive:elim", "elim", { 0: 30, 7: 10, 13: 10, 20: 30, 30: 20 }, 30);
/** 1st and 2nd each took 40 runs. */
const TIE_FIRST = openFrom("2026walive:elim", "elim", { 0: 20, 20: 40, 30: 40 }, 30);
/** Mass at 25, a value no placement pays: no named finish describes it. */
const UNNAMED_MASS = openFrom("2026walive:elim", "elim", { 0: 50, 25: 50 }, 30);
/** A DCMP division cell moved up by finals points: 21 plus a finals 39 is 60, a named value by accident. */
const SHIFTED = { ...openFrom("2026walive:elim", "elim", { 21: 50, 60: 50 }, 90), shiftedByFinals: true } as const satisfies OpenCell;

/** 56 of 100 runs win an award: 46 a judged award, 10 Impact. */
const AWARD = openFrom("2026walive:award", "award", { 0: 44, 5: 46, 10: 10 }, 10);

/** One route observation, defaulting to a route no draw took that can pay `possible`. */
function slot(draws: number, observed?: readonly [number, number], possible: readonly [number, number] = [1, 16], allianceNumber?: number): DistrictSelectionRouteObservation {
  return {
    draws,
    minPoints: observed?.[0],
    maxPoints: observed?.[1],
    allianceNumber,
    possibleMinPoints: possible[0],
    possibleMaxPoints: possible[1],
  };
}

/** An Alliance selection cell with routes, on a lumpy distribution whose any points chance is `1 - notSelected / 100`. */
function allianceWith(bySlot: readonly DistrictSelectionRouteObservation[], notSelectedDraws: number, rankingFixed: boolean, mass: Readonly<Record<number, number>>): OpenCell {
  return { ...openFrom("2026walive:alliance", "alliance", mass, 16), selection: { routes: { bySlot, notSelectedDraws }, denominator: 100, rankingFixed } };
}

const CAPTAIN_LIKELIER = allianceWith(
  [slot(60, [9, 16]), slot(10, [9, 14]), slot(25, [3, 8]), slot(0, undefined, [0, 0])],
  5,
  false,
  { 0: 5, 4: 25, 12: 70 }
);
const SECOND_PICK_LIKELIER = allianceWith(
  [slot(30, [9, 11]), slot(0, undefined, [9, 16]), slot(60, [1, 8]), slot(0, undefined, [0, 0])],
  10,
  false,
  { 0: 10, 4: 60, 10: 30 }
);
const NEVER_SELECTED = allianceWith([slot(0), slot(0), slot(0), slot(0, undefined, [0, 0])], 100, true, { 0: 100 });
/** A baked event: no routes, 45 of 100 runs paid somewhere from 3 to 16. */
const BAKED_ALLIANCE = openFrom("2026walive:alliance", "alliance", { 0: 55, 3: 15, 9: 20, 16: 10 }, 16);
/** Ranking fixed and every draw a first pick on alliance 5, at 12 points. */
const SETTLED_FIRST_PICK = allianceWith([slot(0), slot(100, [12, 12], [9, 16], 5), slot(0), slot(0, undefined, [0, 0])], 0, true, { 12: 100 });

/** A median form Qualification cell carrying the given percentiles. */
function medianCell(p10: number, p50: number, p90: number): OpenCell {
  const base = openFrom("2026walive:qual", "qual", { 10: 50, 20: 50 }, 22);
  return { ...base, summary: { form: "median", percentiles: { p10, p50, p90 } } } as OpenCell;
}

const DISTRICT_2026: DistrictCellPricing = { season: 2026, tier: "district", isRookie: false };
const DCMP_2026: DistrictCellPricing = { season: 2026, tier: "dcmp", isRookie: false };

/** An open Playoffs cell over `mass` that carries the run's route view (quick task 261014-jfx): `notSelectedDraws` of its 100 runs left the team on no alliance. */
function playoffWith(mass: Readonly<Record<number, number>>, notSelectedDraws: number, ceiling = 30): OpenCell {
  return {
    ...openFrom("2026walive:elim", "elim", mass, ceiling),
    selection: { routes: { bySlot: [], notSelectedDraws }, denominator: 100, rankingFixed: false },
  };
}

/** The 6932 shape: 99 runs at zero points, 97 of them on no alliance. */
const SIX_9_3_2 = playoffWith({ 0: 99, 7: 1 }, 97);

/** Every line a fixture prints, for the guards that hold over all of them. */
const PRINTED: { bold: string; small: string | undefined }[] = [];
function lines(cell: OpenCell, pricing?: DistrictCellPricing): { bold: string; small: string | undefined } {
  const printed = openCellLines(cell, pricing);
  PRINTED.push(printed);
  return printed;
}

describe("openCellLines: one grammar for every open cell (261008-3il)", () => {
  it("names the finish with the most runs, third and fourth grouped, over its chance and what it pays", () => {
    // Third (20) and fourth (16) each lose to none (34); grouped they make 36.
    expect(lines(TOP_FOUR, DISTRICT_2026)).toEqual({ bold: "~3rd or 4th", small: "36% · pays 7 or 13" });
    expect(lines(FIFTH_TO_EIGHTH, DISTRICT_2026)).toEqual({ bold: "~5th to 8th", small: "60% · pays 0" });
  });

  it("names 2nd and 1st once the bracket has ruled the lower finishes out", () => {
    expect(lines(FINALIST, DISTRICT_2026)).toEqual({ bold: "~2nd", small: "45% · pays 20" });
    expect(lines(WINNER, DISTRICT_2026)).toEqual({ bold: "~1st", small: "59% · pays 30" });
  });

  it("never names a finish the milestone rules out, even where its mass is the largest", () => {
    const missHeavy = { ...openFrom("2026walive:elim", "elim", { 0: 70, 20: 20, 30: 10 }, 30), playoffMilestone: { kind: "finalist" } } as const satisfies OpenCell;
    expect(lines(missHeavy, DISTRICT_2026).bold).toBe("~2nd");
    const thirdHeavy = { ...openFrom("2026walive:elim", "elim", { 13: 70, 20: 20, 30: 10 }, 30), playoffMilestone: { kind: "winner" } } as const satisfies OpenCell;
    expect(lines(thirdHeavy, DISTRICT_2026).bold).toBe("~2nd");
  });

  it("goes to the better finish on a tie", () => {
    expect(lines(TIE_SECOND, DISTRICT_2026)).toEqual({ bold: "~2nd", small: "30% · pays 20" });
    expect(lines(TIE_FIRST, DISTRICT_2026)).toEqual({ bold: "~1st", small: "40% · pays 30" });
  });

  it("never prints 100 percent: a near certain win reads 99%", () => {
    expect(lines(WINNER_SURE, DISTRICT_2026)).toEqual({ bold: "~1st", small: "99% · pays 30" });
  });

  it("prices the DCMP row at its own tier", () => {
    expect(lines(TOP_FOUR_DCMP, DCMP_2026)).toEqual({ bold: "~3rd or 4th", small: "36% · pays 21 or 39" });
    expect(lines(FINALIST_DCMP, DCMP_2026)).toEqual({ bold: "~2nd", small: "45% · pays 60" });
    expect(lines(WINNER_DCMP, DCMP_2026)).toEqual({ bold: "~1st", small: "59% · pays 90" });
  });

  it("prints the median form with a likely range where no single finish describes the cell, with the distribution's own percentiles", () => {
    const fallbacks: readonly (readonly [string, OpenCell, DistrictCellPricing | undefined])[] = [
      ["no pricing (the Champ District points row)", TOP_FOUR, undefined],
      ["a season with no bracket", TOP_FOUR, { season: 2019, tier: "district", isRookie: false }],
      ["a cell shifted by finals", SHIFTED, DCMP_2026],
      ["mass at an unnamed value", UNNAMED_MASS, DISTRICT_2026],
      // Wrong tier: DCMP values priced at a district event leave mass no placement covers.
      ["mass no placement of the priced tier covers", TOP_FOUR_DCMP, DISTRICT_2026],
    ];
    for (const [label, cell, pricing] of fallbacks) {
      const { p10, p50, p90 } = pointPercentiles(cell.distribution.counts, cell.distribution.denominator);
      expect(lines(cell, pricing), label).toEqual({ bold: `~${String(Math.round(p50))}`, small: districtLedgerCellLikelyText(p10, p90) });
    }
    // A literal pin of one, so the helper above is not the only witness.
    expect(lines(TOP_FOUR)).toEqual({ bold: "~8", small: "likely 0 to 30" });
  });

  it("prints not picked over backup call only for a team on no alliance, before any other branch", () => {
    expect(lines({ ...TOP_FOUR, notPicked: true }, DISTRICT_2026)).toEqual({ bold: "not picked", small: "backup call only" });
    // Even a cell that somehow carried a milestone reads not picked first.
    expect(lines({ ...FINALIST, notPicked: true }, DISTRICT_2026)).toEqual({ bold: "not picked", small: "backup call only" });
  });

  it("names not picked over the share on an alliance, with no pays and no at least, past half of the runs (261014-jfx)", () => {
    expect(lines(SIX_9_3_2, DISTRICT_2026)).toEqual({ bold: "~not picked", small: "3% on an alliance" });
    expect(lines(playoffWith({ 0: 99, 21: 1 }, 97, 90), DCMP_2026)).toEqual({ bold: "~not picked", small: "3% on an alliance" });
    // Every run left the team off: the selection is still open, so the cell is not flagged, and it reads 0% rather than 100%.
    expect(lines(playoffWith({ 0: 100 }, 100), DISTRICT_2026)).toEqual({ bold: "~not picked", small: "<1% on an alliance" });
  });

  it("keeps 5th to 8th where not picked is not past half, even when it is the single largest outcome", () => {
    // Not picked 40, picked but out 30, 3rd or 4th 15, 2nd 8, 1st 7.
    expect(lines(playoffWith({ 0: 70, 7: 8, 13: 7, 20: 8, 30: 7 }, 40), DISTRICT_2026)).toEqual({ bold: "~5th to 8th", small: "30% · pays 0" });
    // Not picked is 40, short of half, so picked but out (also 40) names the cell.
    expect(lines(playoffWith({ 0: 80, 7: 10, 13: 10 }, 40), DISTRICT_2026)).toEqual({ bold: "~5th to 8th", small: "40% · pays 0" });
    expect(lines(playoffWith({ 0: 70, 13: 30 }, 20), DISTRICT_2026)).toEqual({ bold: "~5th to 8th", small: "50% · pays 0" });
  });

  it("prints a not picked small line that is whole percent words and nothing else", () => {
    const small = lines(SIX_9_3_2, DISTRICT_2026).small!;
    expect(small).toMatch(/^\d+% on an alliance$/);
    expect(small).not.toContain("pays");
    expect(small).not.toContain("at least");
  });

  it("prints exactly what it printed before where the cell carries no route view", () => {
    expect(lines(openFrom("2026walive:elim", "elim", { 0: 99, 7: 1 }, 30), DISTRICT_2026)).toEqual({ bold: "~5th to 8th", small: "99% · pays 0" });
  });

  it("never prints not picked beside a secured figure above zero", () => {
    const secured = { ...SIX_9_3_2, securedAtLeast: 13 };
    const printed = lines(secured, DISTRICT_2026);
    expect(printed.bold).not.toBe("~not picked");
    expect(printed.small).toMatch(/^at least 13/);
  });

  it("prints not picked over backup call only for the flagged cell, with or without a route view", () => {
    expect(lines({ ...SIX_9_3_2, notPicked: true }, DISTRICT_2026)).toEqual({ bold: "not picked", small: "backup call only" });
    expect(lines({ ...TOP_FOUR, notPicked: true }, DISTRICT_2026)).toEqual({ bold: "not picked", small: "backup call only" });
  });

  it("renders the not picked cell's two lines in the table cell, in the two spans and classes every open cell has", () => {
    const { container } = inRow(<LedgerCell cell={SIX_9_3_2} interaction={INTERACTION} pricing={DISTRICT_2026} />);
    const button = container.querySelector("button")!;
    const spans = [...button.querySelectorAll("span")];
    expect(spans.map((span) => span.className)).toEqual([OPEN_CELL_BOLD_CLASS, OPEN_CELL_SMALL_CLASS]);
    expect(spans.map((span) => span.textContent)).toEqual(["~not picked", "3% on an alliance"]);
  });

  it("prints the Awards cell as its chance, the word award, then what an award pays", () => {
    expect(lines(AWARD, DISTRICT_2026)).toEqual({ bold: "56% award", small: "pays 5 to 10" });
    expect(lines(AWARD, { season: 2026, tier: "district", isRookie: true })).toEqual({ bold: "56% award", small: "pays 5 to 10" });
    expect(lines(AWARD, DCMP_2026)).toEqual({ bold: "56% award", small: "pays 15 to 30" });
  });

  it("names the likelier selection route after its chance, over what that route paid", () => {
    expect(lines(CAPTAIN_LIKELIER, DISTRICT_2026)).toEqual({ bold: "60% captain", small: "pays 9 to 16" });
    // Only ever second picked: the untaken first pick row does not widen the span.
    expect(lines(SECOND_PICK_LIKELIER, DISTRICT_2026)).toEqual({ bold: "60% picked", small: "pays 1 to 8" });
  });

  it("prints 0% picked with no small line where the ranking is fixed and no slot took the team", () => {
    expect(lines(NEVER_SELECTED, DISTRICT_2026)).toEqual({ bold: "0% picked", small: undefined });
  });

  it("prints a baked Alliance selection cell's own support as its pays line", () => {
    expect(lines(BAKED_ALLIANCE, DISTRICT_2026)).toEqual({ bold: "45% picked", small: "pays 3 to 16" });
  });

  it("keeps the settled selection line, with the tilde on the point figure", () => {
    expect(lines(SETTLED_FIRST_PICK, DISTRICT_2026)).toEqual({ bold: "~12", small: "first pick, alliance 5" });
  });

  it("prints a median form cell's likely range as whole numbers with to", () => {
    expect(lines(medianCell(15.2, 21.8, 22.4))).toEqual({ bold: "~22", small: "likely 15 to 22" });
    expect(lines(medianCell(14.6, 15, 15.4))).toEqual({ bold: "~15", small: "likely 15" });
  });

  // -------------------------------------------------------------------------
  // THE SECURED LINE (quick task 261012-mw2, D4): an open Playoffs cell of a
  // team still in the bracket says at least what its wins have secured, before
  // the small line its form already prints. These run before the guard below,
  // so every line they print is under it too.
  // -------------------------------------------------------------------------

  /** A Playoffs cell whose every draw pays nothing: with no pricing it has the one point mass at 0 for its median. */
  const NOTHING_TO_PAY = openFrom("2026walive:elim", "elim", { 0: 100 }, 30);

  it("prints at least N before the small line of a credited cell, bold line unchanged", () => {
    expect(lines({ ...FINALIST, securedAtLeast: 20 }, DISTRICT_2026)).toEqual({ bold: "~2nd", small: "at least 20 · 45% · pays 20" });
    expect(lines({ ...WINNER, securedAtLeast: 20 }, DISTRICT_2026)).toEqual({ bold: "~1st", small: "at least 20 · 59% · pays 30" });
    // The District Championship row, at its own tier: a finalist that has been on the field for every win.
    expect(lines({ ...FINALIST_DCMP, securedAtLeast: 60 }, DCMP_2026)).toEqual({ bold: "~2nd", small: "at least 60 · 45% · pays 60" });
    expect(lines({ ...TOP_FOUR, securedAtLeast: 13 }, DISTRICT_2026)).toEqual({ bold: "~3rd or 4th", small: "at least 13 · 36% · pays 7 or 13" });
  });

  it("prints it before the likely line of the median fallback", () => {
    expect(lines(TOP_FOUR)).toEqual({ bold: "~8", small: "likely 0 to 30" });
    expect(lines({ ...TOP_FOUR, securedAtLeast: 13 })).toEqual({ bold: "~8", small: "at least 13 · likely 0 to 30" });
  });

  it("prints it before the likely line of a point mass fallback", () => {
    expect(lines(NOTHING_TO_PAY)).toEqual({ bold: "~0", small: "likely 0" });
    expect(lines({ ...NOTHING_TO_PAY, securedAtLeast: 13 })).toEqual({ bold: "~0", small: "at least 13 · likely 0" });
  });

  it("changes nothing but the small line: every form's bold line is the uncredited cell's, and the rest of the small line is too", () => {
    const forms: readonly (readonly [OpenCell, DistrictCellPricing | undefined])[] = [
      [TOP_FOUR, DISTRICT_2026],
      [TOP_FOUR_DCMP, DCMP_2026],
      [FINALIST, DISTRICT_2026],
      [WINNER_DCMP, DCMP_2026],
      [TOP_FOUR, undefined],
      [SHIFTED, DCMP_2026],
    ];
    for (const [cell, pricing] of forms) {
      const plain = openCellLines(cell, pricing);
      const credited = lines({ ...cell, securedAtLeast: 13 }, pricing);
      expect(credited.bold).toBe(plain.bold);
      expect(credited.small).toBe(`at least 13 · ${plain.small ?? ""}`);
    }
  });

  it("never prints it on a not picked cell", () => {
    expect(lines({ ...TOP_FOUR, notPicked: true, securedAtLeast: 13 }, DISTRICT_2026)).toEqual({ bold: "not picked", small: "backup call only" });
    expect(lines({ ...FINALIST, notPicked: true, securedAtLeast: 20 }, DISTRICT_2026)).toEqual({ bold: "not picked", small: "backup call only" });
  });

  it("never prints it on a cell of another category, even one handed the field", () => {
    expect(lines({ ...AWARD, securedAtLeast: 5 }, DISTRICT_2026)).toEqual({ bold: "56% award", small: "pays 5 to 10" });
    expect(lines({ ...CAPTAIN_LIKELIER, securedAtLeast: 9 }, DISTRICT_2026)).toEqual({ bold: "60% captain", small: "pays 9 to 16" });
    expect(lines({ ...BAKED_ALLIANCE, securedAtLeast: 9 }, DISTRICT_2026)).toEqual({ bold: "45% picked", small: "pays 3 to 16" });
    expect(lines({ ...SETTLED_FIRST_PICK, securedAtLeast: 12 }, DISTRICT_2026)).toEqual({ bold: "~12", small: "first pick, alliance 5" });
    expect(lines({ ...medianCell(15.2, 21.8, 22.4), securedAtLeast: 15 })).toEqual({ bold: "~22", small: "likely 15 to 22" });
    const total = { ...medianCell(15.2, 21.8, 22.4), id: "2026walive:eventTotal", cell: "eventTotal" } as OpenCell;
    expect(lines({ ...total, securedAtLeast: 15 })).toEqual({ bold: "~22", small: "likely 15 to 22" });
  });

  it("prints nothing for a value of zero, below zero, or one that rounds to zero: at least N only where N is above zero", () => {
    for (const secured of [0, -5, 0.4, Number.NaN]) {
      expect(lines({ ...FINALIST, securedAtLeast: secured }, DISTRICT_2026)).toEqual({ bold: "~2nd", small: "45% · pays 20" });
      expect(lines({ ...NOTHING_TO_PAY, securedAtLeast: secured })).toEqual({ bold: "~0", small: "likely 0" });
    }
  });

  it("still never reads 100% on a credited cell's chance, and the secured line carries no tilde and no dash", () => {
    const credited = lines({ ...WINNER_SURE, securedAtLeast: 20 }, DISTRICT_2026);
    expect(credited).toEqual({ bold: "~1st", small: "at least 20 · 99% · pays 30" });
    const smalls = [
      credited.small,
      lines({ ...FINALIST_DCMP, securedAtLeast: 60 }, DCMP_2026).small,
      lines({ ...TOP_FOUR, securedAtLeast: 13 }, DISTRICT_2026).small,
      lines({ ...TOP_FOUR, securedAtLeast: 13 }).small,
      lines({ ...NOTHING_TO_PAY, securedAtLeast: 13 }).small,
    ];
    for (const small of smalls) {
      expect(small).toBeDefined();
      // A best guess small line legitimately carries a percent after its first middle dot; a tilde and a dash are never printed.
      expect(small).not.toMatch(/[-‐-―−~]/);
      expect(small!.split(" · ")[0]).not.toMatch(/[%~]/);
      expect(small).toBe(small!.toLowerCase());
      expect(small).not.toContain("100%");
    }
  });

  it("renders the credited cell's two lines in the table cell, in the two spans and classes every open cell has", () => {
    const { container } = inRow(<LedgerCell cell={{ ...FINALIST, securedAtLeast: 20 }} interaction={INTERACTION} pricing={DISTRICT_2026} />);
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("~2ndat least 20 · 45% · pays 20");
    const spans = [...button.querySelectorAll("span")];
    expect(spans.map((span) => span.className)).toEqual([OPEN_CELL_BOLD_CLASS, OPEN_CELL_SMALL_CLASS]);
    expect(spans.map((span) => span.textContent)).toEqual(["~2nd", "at least 20 · 45% · pays 20"]);
    // The same element, class for class, as the uncredited cell: this line adds words and nothing else.
    const plain = inRow(<LedgerCell cell={FINALIST} interaction={INTERACTION} pricing={DISTRICT_2026} />).container.querySelector("button")!;
    expect(button.className).toBe(plain.className);
    expect([...plain.querySelectorAll("span")].map((span) => span.className)).toEqual(spans.map((span) => span.className));
  });

  it("prints no tilde before a percentage and no 100% on any fixture", () => {
    expect(PRINTED.length).toBeGreaterThan(0);
    for (const printed of PRINTED) {
      for (const line of [printed.bold, printed.small ?? ""]) {
        expect(line).not.toMatch(/~\d+%/);
        expect(line).not.toContain("100%");
      }
    }
  });

  it("renders the same two lines in the table cell", () => {
    const { container } = inRow(<LedgerCell cell={FINALIST} interaction={INTERACTION} pricing={DISTRICT_2026} />);
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("~2nd45% · pays 20");
    expect([...button.querySelectorAll("span")].map((span) => span.textContent)).toEqual(["~2nd", "45% · pays 20"]);
  });
});

// ---------------------------------------------------------------------------
// THE LEAST A TOTAL MAY PRINT (quick task 261012-mw2, D6 and Task 6): no
// event total, grand total or Team cell median is PRINTED below what the lock
// math already counts for that row or team. Print only.
// ---------------------------------------------------------------------------

/** A median form total cell carrying the given percentiles. */
function totalCell(cell: "eventTotal" | "grandTotal", p10: number, p50: number, p90: number): OpenCell {
  const id = cell === "grandTotal" ? "grandTotal" : "2026walive:eventTotal";
  return { ...openFrom(id, cell, { 50: 50, 60: 50 }, 83), summary: { form: "median", percentiles: { p10, p50, p90 } } } as OpenCell;
}

describe("openCellLines: the least a total may print (quick task 261012-mw2)", () => {
  it("prints the larger of the median and the least, the larger of the low end and the least, and a high end never below the printed median", () => {
    // The run's median is 57.4 and the lock math already counts 58 for the row.
    expect(openCellLines(totalCell("eventTotal", 55.6, 57.4, 61.2))).toEqual({ bold: "~57", small: "likely 56 to 61" });
    expect(openCellLines(totalCell("eventTotal", 55.6, 57.4, 61.2), undefined, 58)).toEqual({ bold: "~58", small: "likely 58 to 61" });
    // Only the low end sits under it: the median and the high end print as they did.
    expect(openCellLines(totalCell("grandTotal", 55.6, 60.2, 64.9), undefined, 58)).toEqual({ bold: "~60", small: "likely 58 to 65" });
    // The least above all three: the range closes to the one number.
    expect(openCellLines(totalCell("grandTotal", 55.6, 57.4, 57.8), undefined, 60)).toEqual({ bold: "~60", small: "likely 60" });
    // A least that is not a whole number is rounded with the figure it holds, never before it.
    expect(openCellLines(totalCell("eventTotal", 55.6, 57.4, 61.2), undefined, 57.6)).toEqual({ bold: "~58", small: "likely 58 to 61" });
  });

  it("prints exactly what it prints today with no least, and with one at or below all three percentiles", () => {
    const cells = [totalCell("eventTotal", 55.6, 57.4, 61.2), totalCell("grandTotal", 100.2, 131.5, 160.9), totalCell("eventTotal", 0, 0, 0), totalCell("grandTotal", 14.6, 15, 15.4)];
    for (const cell of cells) {
      const today = openCellLines(cell);
      expect(openCellLines(cell, undefined, undefined)).toEqual(today);
      const { p10 } = (cell.summary as { percentiles: { p10: number } }).percentiles;
      for (const least of [0, -3, p10, p10 - 0.4, Number.NaN, Number.NEGATIVE_INFINITY]) expect(openCellLines(cell, undefined, least), String(least)).toEqual(today);
    }
  });

  it("never lowers a printed figure, whatever the least", () => {
    const cell = totalCell("grandTotal", 100.2, 131.5, 160.9);
    const numbers = (printed: { bold: string; small: string | undefined }): number[] => `${printed.bold} ${printed.small ?? ""}`.match(/\d+/g)!.map(Number);
    const today = numbers(openCellLines(cell));
    for (const least of [0, 50, 100, 101, 131, 132, 150, 161, 200]) {
      const held = numbers(openCellLines(cell, undefined, least));
      // Median, low end, and the high end where the range has not closed.
      expect(held[0], String(least)).toBe(Math.max(today[0]!, least));
      expect(held[1], String(least)).toBe(Math.max(today[1]!, least));
      expect(held[held.length - 1], String(least)).toBe(Math.max(today[2]!, least));
      expect(held[held.length - 1], String(least)).toBeGreaterThanOrEqual(held[0]!);
    }
  });

  it("is not read by the chance forms, the Playoffs best guess or its median fallback, a not picked cell or the Alliance selection settled route", () => {
    const untouched: readonly (readonly [OpenCell, DistrictCellPricing | undefined])[] = [
      [TOP_FOUR, DISTRICT_2026],
      [TOP_FOUR, undefined],
      [FINALIST, DISTRICT_2026],
      [{ ...FINALIST, securedAtLeast: 20 }, DISTRICT_2026],
      [{ ...TOP_FOUR, notPicked: true }, DISTRICT_2026],
      [AWARD, DISTRICT_2026],
      [CAPTAIN_LIKELIER, DISTRICT_2026],
      [BAKED_ALLIANCE, DISTRICT_2026],
      [NEVER_SELECTED, DISTRICT_2026],
      // Ranking fixed and every draw a first pick at 12 points: the settled route prints ~12, whatever least it is handed.
      [SETTLED_FIRST_PICK, DISTRICT_2026],
    ];
    for (const [cell, pricing] of untouched) expect(openCellLines(cell, pricing, 99)).toEqual(openCellLines(cell, pricing));
    expect(openCellLines(SETTLED_FIRST_PICK, DISTRICT_2026, 99)).toEqual({ bold: "~12", small: "first pick, alliance 5" });
  });

  it("prints no tilde on a percentage, no 100% and no dash with a least, and the tilde stays on the point figure", () => {
    for (const least of [58, 60, 200]) {
      const printed = openCellLines(totalCell("grandTotal", 55.6, 57.4, 61.2), undefined, least);
      expect(printed.bold).toMatch(/^~\d+$/);
      expect(printed.small).toMatch(/^likely \d+( to \d+)?$/);
      expect(`${printed.bold} ${printed.small ?? ""}`).not.toMatch(/[-‐-―−%]/);
    }
  });

  it("LedgerCell and GrandTotalContent pass the least on, and print as today without one", () => {
    const event = totalCell("eventTotal", 55.6, 57.4, 61.2);
    const grand = totalCell("grandTotal", 55.6, 57.4, 61.2);
    const eventPlain = inRow(<LedgerCell cell={event} interaction={INTERACTION} variant="total" />).container.querySelector("button")!;
    expect(eventPlain.textContent).toBe("~57likely 56 to 61");
    const eventHeld = inRow(<LedgerCell cell={event} interaction={INTERACTION} variant="total" least={58} />).container.querySelector("button")!;
    expect(eventHeld.textContent).toBe("~58likely 58 to 61");
    // The same element, class for class: the least changes digits and nothing else.
    expect(eventHeld.className).toBe(eventPlain.className);
    expect([...eventHeld.querySelectorAll("span")].map((span) => span.className)).toEqual([OPEN_CELL_BOLD_CLASS, OPEN_CELL_SMALL_CLASS]);
    const grandOf = (least?: number) =>
      inRow(
        <td>
          <GrandTotalContent cell={grand} interaction={INTERACTION} {...(least === undefined ? {} : { least })} />
        </td>
      ).container.querySelector("button")!;
    expect(grandOf().textContent).toBe("~57likely 56 to 61");
    expect(grandOf(58).textContent).toBe("~58likely 58 to 61");
    expect(grandOf(58).className).toBe(grandOf().className);
    // A grey total is TBA's own number and is never handed through the rule.
    const final: DistrictLedgerCell = { id: "grandTotal", cell: "grandTotal", kind: "final", earned: 57 };
    const finalCell = inRow(
      <td>
        <GrandTotalContent cell={final} interaction={INTERACTION} least={58} />
      </td>
    ).container.querySelector("[data-cell]")!;
    expect(finalCell.textContent).toBe("57");
  });

  it("heldTeamMedian is the rounded larger of the projection and the least, and the rounded projection with none", () => {
    expect(heldTeamMedian(57.4, undefined)).toBe(57);
    expect(heldTeamMedian(57.4, 58)).toBe(58);
    expect(heldTeamMedian(57.4, 57)).toBe(57);
    expect(heldTeamMedian(57.6, 57)).toBe(58);
    expect(heldTeamMedian(61.2, 58)).toBe(61);
    for (const least of [0, -4, Number.NaN, Number.NEGATIVE_INFINITY]) expect(heldTeamMedian(57.4, least)).toBe(57);
  });
});

// ---------------------------------------------------------------------------
// THE SAME RULE OVER THE LOCAL FIXTURE, BOTH TABS (plan fact 28). The eight
// 2026 PNW district event files are gitignored local data; the district file
// beside them is committed. Each event is read at its playoff round stops with
// a real run, exactly as `SCRATCH/mw2/print_check2.mts` reads it.
// ---------------------------------------------------------------------------

/** The repo relative path, found by walking up from the working directory (see `champLedgerRows.test.ts`). */
function repoPath(relative: string): string | undefined {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const PRINT_FIXTURE_EVENTS = ["2026orore", "2026orsal", "2026orwil", "2026waahs", "2026wabon", "2026wasam", "2026wasno", "2026wayak"] as const;
const PRINT_FIXTURE_DISTRICT = "data/fixtures/phase10/district-2026pnw.json";
const PRINT_FIXTURE_MISSING = [PRINT_FIXTURE_DISTRICT, ...PRINT_FIXTURE_EVENTS.map((key) => `data/fixtures/phase10/event-${key}.json`)].filter((file) => repoPath(file) === undefined);
/** The run `print_check2.mts` makes: 400 draws under this seed. */
const PRINT_DRAWS = 400;
const PRINT_SEED = 20261012;
/** The double elimination round of each semifinal set. */
const ROUND_OF_SET: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 4, 12: 4, 13: 5 };

interface PrintTally {
  checked: number;
  lowBelow: number;
  medianBelow: number;
  lowBelowHeld: number;
  medianBelowHeld: number;
  moved: number;
}
const printTally = (): PrintTally => ({ checked: 0, lowBelow: 0, medianBelow: 0, lowBelowHeld: 0, medianBelowHeld: 0, moved: 0 });

/** The median, the low end and the high end a median form cell prints. */
function printedFigures(printed: { bold: string; small: string | undefined }): { median: number; low: number; high: number } {
  const bold = /^~(\d+)$/.exec(printed.bold);
  const small = /^likely (\d+)(?: to (\d+))?$/.exec(printed.small ?? "");
  if (bold === null || small === null) throw new Error(`not a median form print: ${printed.bold} / ${String(printed.small)}`);
  return { median: Number(bold[1]), low: Number(small[1]), high: Number(small[2] ?? small[1]) };
}

/**
 * One total against the figure it must not print below: without the least and
 * with it. Returns false for a cell that is not an open median form cell.
 */
function notePrint(tally: PrintTally, cell: ChampLedgerCell, least: number, target: number): boolean {
  if (cell.kind !== "open" || cell.summary.form !== "median") return false;
  const plain = printedFigures(openCellLines(cell));
  const held = printedFigures(openCellLines(cell, undefined, least));
  tally.checked += 1;
  if (plain.low < target) tally.lowBelow += 1;
  if (plain.median < target) tally.medianBelow += 1;
  if (held.low < target) tally.lowBelowHeld += 1;
  if (held.median < target) tally.medianBelowHeld += 1;
  if (held.low !== plain.low || held.median !== plain.median || held.high !== plain.high) tally.moved += 1;
  // The rule only ever raises a figure, and never leaves the range upside down.
  expect(held.low).toBeGreaterThanOrEqual(plain.low);
  expect(held.median).toBeGreaterThanOrEqual(plain.median);
  expect(held.high).toBeGreaterThanOrEqual(plain.high);
  expect(held.median).toBeGreaterThanOrEqual(held.low);
  expect(held.high).toBeGreaterThanOrEqual(held.median);
  return true;
}

describe("the least a total may print, over the local 2026 PNW fixture on both tabs (quick task 261012-mw2, fact 28)", () => {
  if (PRINT_FIXTURE_MISSING.length > 0) {
    const what = `the local fixture files are absent: ${PRINT_FIXTURE_MISSING.join(", ")}`;
    if (process.env.REQUIRE_LOCAL_DATA === "1") {
      it(`REQUIRE_LOCAL_DATA=1 and the local data is absent: ${what}`, () => {
        throw new Error(`REQUIRE_LOCAL_DATA=1, but this local data gated group cannot run: ${what}`);
      });
    } else {
      it.skip(`skipped: ${what}`, () => {});
    }
    return;
  }

  it(
    "without the least a low end prints below the earned figure 154 times and a median 110 times on each tab, and with it never; and nothing but print moves",
    () => {
      const district = DistrictArtifactSchema.parse(JSON.parse(readFileSync(repoPath(PRINT_FIXTURE_DISTRICT)!, "utf8")));
      const ALL_FINAL: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
      const ALL_OPEN: DistrictStageFinality = { qual: false, alliance: false, elim: false, award: false };
      const districtGrand = printTally();
      const districtEvent = printTally();
      const champGrand = printTally();
      const champDistrictRow = printTally();
      const teamMedian = { district: { checked: 0, below: 0, belowHeld: 0 }, champ: { checked: 0, below: 0, belowHeld: 0 } };
      let stops = 0;
      let champFloors = 0;
      let champFloorNotTheHeader = 0;
      let districtCountedNotTheHeader = 0;
      let printChangedTheModel = 0;

      for (const eventKey of PRINT_FIXTURE_EVENTS) {
        const event = EventArtifactSchema.parse(JSON.parse(readFileSync(repoPath(`data/fixtures/phase10/event-${eventKey}.json`)!, "utf8")));
        const playoff = event.matches.filter((match) => (match.compLevel === "sf" || match.compLevel === "f") && match.actualWinner !== undefined);
        for (let round = 1; round <= 6; round++) {
          // Rounds 1 to 5, then the first Finals row.
          const at = playoff.filter((match) => (match.compLevel === "sf" ? (ROUND_OF_SET[match.setNumber] ?? 9) <= round : round === 6 && match.matchNumber === 1));
          if (round === 6 && !at.some((match) => match.compLevel === "f")) continue;
          const playedKeys = at.map((match) => match.matchKey);
          const stage: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
          const built = buildDistrictEventSimulationInput({
            eventKey,
            season: 2026,
            eventArtifact: event,
            districtArtifact: district,
            stage,
            startMatchKey: null,
            conditionOnPlayedElims: false,
            asOfPlayedElimMatchKeys: playedKeys,
            tier: "district",
          });
          if (!built.ok) continue;
          stops += 1;
          const entry: DistrictEventDistributions = {
            ...distributionsFromResult(simulateDistrictEvent(built.input, PRINT_DRAWS, PRINT_SEED)),
            ...securedElimEntry(event, 2026, "district", new Set(playedKeys)),
          };
          const stageByEvent = new Map<string, DistrictStageFinality>();
          for (const team of district.teams) {
            for (const tierEvent of tierEvents(team, "district")) {
              if (!stageByEvent.has(tierEvent.eventKey)) stageByEvent.set(tierEvent.eventKey, tierEvent.eventKey === eventKey ? stage : ALL_FINAL);
            }
          }
          for (const key of dcmpEventKeysFor(district)) stageByEvent.set(key, ALL_OPEN);
          const distributions = new Map([[eventKey, entry]]);

          // THE DISTRICT LOCKS TAB.
          const model = buildDistrictLedgerRows({ artifact: district, distributions, stageByEvent, tier: "district" });
          const districtStatuses = computeDistrictLedgerStatuses({ artifact: district, teams: model.teams });
          const districtLockedOut = new Set<string>();
          for (const [teamKey, result] of districtStatuses.byTeam) if (result.status === "lockedOut") districtLockedOut.add(teamKey);
          // THE CHAMP LOCKS TAB.
          const champ = buildChampLedgerRows({ artifact: district, distributions, stageByEvent, startedDcmpEventKeys: new Set(), atLivePosition: false });
          const champStatuses = computeChampLedgerStatuses({ artifact: district, teams: champ.teams, districtLockedOut, distributions });

          // Everything the display is NOT handed back, read before one line is printed and again after.
          const summaryOf = (cell: ChampLedgerCell): unknown => (cell.kind === "open" ? cell.summary : cell.kind);
          const modelValues = (): string =>
            JSON.stringify({
              district: model.teams.map((team) => [team.teamKey, team.projection, team.earnedAtPosition, team.position, summaryOf(team.grandTotal), team.rows.map((row) => summaryOf(row.eventTotal))]),
              districtStatuses: [...districtStatuses.byTeam].map(([teamKey, result]) => [teamKey, result.status, result.lockedBy]),
              champ: champ.teams.map((team) => [team.teamKey, team.projection, team.earnedAtPosition, team.position, summaryOf(team.grandTotal), summaryOf(team.districtRow.subtotal), summaryOf(team.dcmpRow.subtotal)]),
              champStatuses: [...champStatuses.byTeam].map(([teamKey, result]) => [teamKey, result.status]),
              champFloors: [...(champStatuses.floorByTeam ?? [])],
            });
          const before = modelValues();

          for (const team of model.teams) {
            const row = team.rows.find((candidate) => candidate.eventKey === eventKey);
            if (row === undefined) continue;
            // What the tab hands in: the sum of the team's rows' counted points.
            const counted = team.rows.reduce((sum, candidate) => sum + rowCountedPoints(candidate), 0);
            const header = Math.round(team.earnedAtPosition);
            if (counted !== team.earnedAtPosition) districtCountedNotTheHeader += 1;
            if (notePrint(districtGrand, team.grandTotal, counted, header)) {
              teamMedian.district.checked += 1;
              if (heldTeamMedian(team.projection, undefined) < header) teamMedian.district.below += 1;
              if (heldTeamMedian(team.projection, counted) < header) teamMedian.district.belowHeld += 1;
            }
            notePrint(districtEvent, row.eventTotal, rowCountedPoints(row), Math.round(rowCountedPoints(row)));
          }
          for (const team of champ.teams) {
            const floor = champStatuses.floorByTeam?.get(team.teamKey);
            if (floor === undefined) continue;
            champFloors += 1;
            if (floor !== team.earnedAtPosition) champFloorNotTheHeader += 1;
            const header = Math.round(team.earnedAtPosition);
            const districtCounted = team.districtRow.countedAtPosition ?? 0;
            notePrint(champDistrictRow, team.districtRow.subtotal, districtCounted, Math.round(districtCounted));
            if (notePrint(champGrand, team.grandTotal, floor, header)) {
              teamMedian.champ.checked += 1;
              if (heldTeamMedian(team.projection, undefined) < header) teamMedian.champ.below += 1;
              if (heldTeamMedian(team.projection, floor) < header) teamMedian.champ.belowHeld += 1;
            }
          }
          if (modelValues() !== before) printChangedTheModel += 1;
        }
      }

      console.log(
        `[261012-mw2 printed totals] stops ${String(stops)}; district grand ${JSON.stringify(districtGrand)}; district event ${JSON.stringify(districtEvent)}; champ district row ${JSON.stringify(champDistrictRow)}; champ grand ${JSON.stringify(champGrand)}; team median ${JSON.stringify(teamMedian)}; champ floors ${String(champFloors)}, not the header ${String(champFloorNotTheHeader)}; district counted not the header ${String(districtCountedNotTheHeader)}`
      );
      expect(stops).toBe(48);
      // Without the least: 154 low ends and 110 medians print below. With it: none. The same on every total.
      const pinned: PrintTally = { checked: 1512, lowBelow: 154, medianBelow: 110, lowBelowHeld: 0, medianBelowHeld: 0, moved: 154 };
      expect(districtGrand).toEqual(pinned);
      expect(districtEvent).toEqual(pinned);
      expect(champDistrictRow).toEqual(pinned);
      expect(champGrand).toEqual(pinned);
      expect(teamMedian).toEqual({ district: { checked: 1512, below: 110, belowHeld: 0 }, champ: { checked: 1512, below: 110, belowHeld: 0 } });
      // What is handed in is the earned figure wherever the earned figure is the floor: every one of these rewound stops.
      expect(districtCountedNotTheHeader).toBe(0);
      expect({ champFloors, champFloorNotTheHeader }).toEqual({ champFloors: 6048, champFloorNotTheHeader: 0 });
      // NOTHING BUT PRINT MOVES: no row model, projection, summary or status is handed the least, and none changed.
      expect(printChangedTheModel).toBe(0);
    },
    600_000
  );
});
