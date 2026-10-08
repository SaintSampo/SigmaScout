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
