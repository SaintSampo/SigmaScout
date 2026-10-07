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
import { GrandTotalContent, LedgerCell, UNAVAILABLE_CELL_CLASS, type CellInteraction } from "./LedgerParts.js";
import {
  CHAMP_LEDGER_CUTOFF_PENDING_FIGURE,
  DISTRICT_LEDGER_PENDING_CELL,
  DISTRICT_LEDGER_UNAVAILABLE_CELL,
} from "./districtLedgerCopy.js";
import type { DistrictLedgerCell } from "./districtLedgerRows.js";

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
