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
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { GrandTotalContent, LedgerCell, UNAVAILABLE_CELL_CLASS, openCellLines, type CellInteraction } from "./LedgerParts.js";
import {
  CHAMP_LEDGER_CUTOFF_PENDING_FIGURE,
  DISTRICT_LEDGER_PENDING_CELL,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
} from "./districtLedgerCopy.js";
import { openDistrictLedgerCell, type DistrictCellKind, type DistrictLedgerCell } from "./districtLedgerRows.js";
import type { DistrictCellPricing } from "./districtLedgerOutcomes.js";
import type { DistrictSelectionRouteObservation } from "../../../../../packages/core/districts/ledgerSimulation.js";

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

/** 66 of 100 runs reach the top four, spread over the four placements' 2026 district values. */
const TOP_FOUR = openFrom("2026walive:elim", "elim", { 0: 34, 7: 16, 13: 20, 20: 15, 30: 15 }, 30);
const FINALIST = { ...TOP_FOUR, playoffMilestone: { kind: "finalist", chance: 0.85, conditionalMedian: 30 } } as const satisfies OpenCell;
const WINNER = { ...TOP_FOUR, playoffMilestone: { kind: "winner", chance: 0.59, conditionalMedian: 30 } } as const satisfies OpenCell;
const WINNER_SURE = { ...TOP_FOUR, playoffMilestone: { kind: "winner", chance: 0.999, conditionalMedian: 30 } } as const satisfies OpenCell;

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

/** Every line a fixture prints, for the guards that hold over all of them. */
const PRINTED: { bold: string; small: string | undefined }[] = [];
function lines(cell: OpenCell, pricing?: DistrictCellPricing): { bold: string; small: string | undefined } {
  const printed = openCellLines(cell, pricing);
  PRINTED.push(printed);
  return printed;
}

describe("openCellLines: one grammar for every open cell (261008-3il)", () => {
  it("prints the top four form as the chance, the outcome, then what the top four pays", () => {
    expect(lines(TOP_FOUR, DISTRICT_2026)).toEqual({ bold: "66% top 4", small: "pays 7 to 30" });
  });

  it("prints the final once top four is secured, and the win once in the final", () => {
    expect(lines(FINALIST, DISTRICT_2026)).toEqual({ bold: "85% final", small: "pays 20 or 30" });
    expect(lines(WINNER, DISTRICT_2026)).toEqual({ bold: "59% win", small: "pays 30" });
  });

  it("never prints 100 percent: a near certain win reads 99%", () => {
    expect(lines(WINNER_SURE, DISTRICT_2026)).toEqual({ bold: "99% win", small: "pays 30" });
  });

  it("prices the DCMP row at its own tier", () => {
    expect(lines(TOP_FOUR, DCMP_2026)).toEqual({ bold: "66% top 4", small: "pays 21 to 90" });
    expect(lines(FINALIST, DCMP_2026)).toEqual({ bold: "85% final", small: "pays 60 or 90" });
  });

  it("falls back to the cell's own nonzero support with no pricing (the Champ District points row)", () => {
    expect(lines(TOP_FOUR)).toEqual({ bold: "66% top 4", small: "pays 7 to 30" });
  });

  it("falls back to the support for a season with no bracket, and never throws", () => {
    expect(lines(TOP_FOUR, { season: 2019, tier: "district", isRookie: false })).toEqual({ bold: "66% top 4", small: "pays 7 to 30" });
  });

  it("prints not picked over backup call only for a team on no alliance, before any other branch", () => {
    expect(lines({ ...TOP_FOUR, notPicked: true }, DISTRICT_2026)).toEqual({ bold: "not picked", small: "backup call only" });
    // Even a cell that somehow carried a milestone reads not picked first.
    expect(lines({ ...FINALIST, notPicked: true }, DISTRICT_2026)).toEqual({ bold: "not picked", small: "backup call only" });
  });

  it("prints the Awards cell as its chance, the word award, then what an award pays", () => {
    expect(lines(AWARD, DISTRICT_2026)).toEqual({ bold: "56% award", small: "pays 5 or 10" });
    expect(lines(AWARD, { season: 2026, tier: "district", isRookie: true })).toEqual({ bold: "56% award", small: "pays 5 to 10" });
    expect(lines(AWARD, DCMP_2026)).toEqual({ bold: "56% award", small: "pays 15 or 30" });
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
    expect(button.textContent).toBe("85% finalpays 20 or 30");
  });
});
