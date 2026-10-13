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
import { GrandTotalContent, LedgerCell, OPEN_CELL_BOLD_CLASS, OPEN_CELL_SMALL_CLASS, UNAVAILABLE_CELL_CLASS, openCellLines, type CellInteraction } from "./LedgerParts.js";
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

  // -------------------------------------------------------------------------
  // THE SECURED LINE (quick task 261012-mw2, D4): an open Playoffs cell of a
  // team still in the bracket says at least what its wins have secured, before
  // the small line its form already prints. These run before the guard below,
  // so every line they print is under it too.
  // -------------------------------------------------------------------------

  /** A median form Playoffs cell carrying the given percentiles. */
  function medianElim(p10: number, p50: number, p90: number): OpenCell {
    return { ...TOP_FOUR, summary: { form: "median", percentiles: { p10, p50, p90 } } } as OpenCell;
  }
  /** A Playoffs cell whose every draw pays nothing: with no pricing it has no small line of its own. */
  const NOTHING_TO_PAY = openFrom("2026walive:elim", "elim", { 0: 100 }, 30);

  it("prints at least N before the pays line of a credited cell in the milestone form, bold line unchanged", () => {
    expect(lines({ ...FINALIST, securedAtLeast: 20 }, DISTRICT_2026)).toEqual({ bold: "85% final", small: "at least 20 · pays 20 or 30" });
    expect(lines({ ...WINNER, securedAtLeast: 20 }, DISTRICT_2026)).toEqual({ bold: "59% win", small: "at least 20 · pays 30" });
    // The District Championship row, at its own tier: a finalist that has been on the field for every win.
    expect(lines({ ...FINALIST, securedAtLeast: 60 }, DCMP_2026)).toEqual({ bold: "85% final", small: "at least 60 · pays 60 or 90" });
  });

  it("prints it in the chance form", () => {
    expect(lines({ ...TOP_FOUR, securedAtLeast: 13 }, DISTRICT_2026)).toEqual({ bold: "66% top 4", small: "at least 13 · pays 7 to 30" });
    expect(lines({ ...TOP_FOUR, securedAtLeast: 13 })).toEqual({ bold: "66% top 4", small: "at least 13 · pays 7 to 30" });
  });

  it("prints it in the median form, before the likely range", () => {
    expect(lines(medianElim(13.2, 20.4, 29.6))).toEqual({ bold: "~20", small: "likely 13 to 30" });
    expect(lines({ ...medianElim(13.2, 20.4, 29.6), securedAtLeast: 13 })).toEqual({ bold: "~20", small: "at least 13 · likely 13 to 30" });
  });

  it("prints at least N alone where the form has no small line", () => {
    expect(lines(NOTHING_TO_PAY)).toEqual({ bold: "0% top 4", small: undefined });
    expect(lines({ ...NOTHING_TO_PAY, securedAtLeast: 13 })).toEqual({ bold: "0% top 4", small: "at least 13" });
  });

  it("changes nothing but the small line: every form's bold line is the uncredited cell's, and the rest of the small line is too", () => {
    const forms: readonly (readonly [OpenCell, DistrictCellPricing | undefined])[] = [
      [TOP_FOUR, DISTRICT_2026],
      [TOP_FOUR, DCMP_2026],
      [TOP_FOUR, undefined],
      [FINALIST, DISTRICT_2026],
      [WINNER, DCMP_2026],
      [medianElim(13.2, 20.4, 29.6), undefined],
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
    expect(lines({ ...AWARD, securedAtLeast: 5 }, DISTRICT_2026)).toEqual({ bold: "56% award", small: "pays 5 or 10" });
    expect(lines({ ...CAPTAIN_LIKELIER, securedAtLeast: 9 }, DISTRICT_2026)).toEqual({ bold: "60% captain", small: "pays 9 to 16" });
    expect(lines({ ...BAKED_ALLIANCE, securedAtLeast: 9 }, DISTRICT_2026)).toEqual({ bold: "45% picked", small: "pays 3 to 16" });
    expect(lines({ ...SETTLED_FIRST_PICK, securedAtLeast: 12 }, DISTRICT_2026)).toEqual({ bold: "~12", small: "first pick, alliance 5" });
    expect(lines({ ...medianCell(15.2, 21.8, 22.4), securedAtLeast: 15 })).toEqual({ bold: "~22", small: "likely 15 to 22" });
    const total = { ...medianCell(15.2, 21.8, 22.4), id: "2026walive:eventTotal", cell: "eventTotal" } as OpenCell;
    expect(lines({ ...total, securedAtLeast: 15 })).toEqual({ bold: "~22", small: "likely 15 to 22" });
  });

  it("prints nothing for a value of zero, below zero, or one that rounds to zero: at least N only where N is above zero", () => {
    for (const secured of [0, -5, 0.4, Number.NaN]) {
      expect(lines({ ...FINALIST, securedAtLeast: secured }, DISTRICT_2026)).toEqual({ bold: "85% final", small: "pays 20 or 30" });
      expect(lines({ ...NOTHING_TO_PAY, securedAtLeast: secured })).toEqual({ bold: "0% top 4", small: undefined });
    }
  });

  it("still never reads 100% on a credited cell's bold line, and the secured line carries no tilde and no dash", () => {
    const credited = lines({ ...WINNER_SURE, securedAtLeast: 20 }, DISTRICT_2026);
    expect(credited).toEqual({ bold: "99% win", small: "at least 20 · pays 30" });
    const smalls = [
      credited.small,
      lines({ ...FINALIST, securedAtLeast: 60 }, DCMP_2026).small,
      lines({ ...TOP_FOUR, securedAtLeast: 13 }, DISTRICT_2026).small,
      lines({ ...medianElim(13.2, 20.4, 29.6), securedAtLeast: 13 }).small,
      lines({ ...NOTHING_TO_PAY, securedAtLeast: 13 }).small,
    ];
    for (const small of smalls) {
      expect(small).toBeDefined();
      expect(small).not.toMatch(/[-‐-―−~%]/);
      expect(small).toBe(small!.toLowerCase());
    }
  });

  it("renders the credited cell's two lines in the table cell, in the two spans and classes every open cell has", () => {
    const { container } = inRow(<LedgerCell cell={{ ...FINALIST, securedAtLeast: 20 }} interaction={INTERACTION} pricing={DISTRICT_2026} />);
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("85% finalat least 20 · pays 20 or 30");
    const spans = [...button.querySelectorAll("span")];
    expect(spans.map((span) => span.className)).toEqual([OPEN_CELL_BOLD_CLASS, OPEN_CELL_SMALL_CLASS]);
    expect(spans.map((span) => span.textContent)).toEqual(["85% final", "at least 20 · pays 20 or 30"]);
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
    expect(button.textContent).toBe("85% finalpays 20 or 30");
  });
});
