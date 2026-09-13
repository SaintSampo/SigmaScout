import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MetricValue } from "./MetricValue.js";
import { TotalSigmaValue, TOTAL_SIGMA_COLUMN_WIDTH_PX, totalColumnHeader, totalColumnWidth } from "./TotalSigmaValue.js";

// Quick task 260913-jkp Task 1: the shared split-pill component. Sketch 011
// winner A (.jA rules) is the visual spec; these tests pin the structural
// contract, not pixels.

describe("TotalSigmaValue", () => {
  it("with no sigma, renders innerHTML identical to MetricValue given the same total and tier", () => {
    const total = { value: 425.67 };
    const withSigma = render(<TotalSigmaValue total={total} totalTier="epic" />);
    const plain = render(<MetricValue metric={total} tier="epic" />);

    expect(withSigma.container.innerHTML).toBe(plain.container.innerHTML);
  });

  it("with no sigma and no tier, still renders identically to MetricValue", () => {
    const total = { value: 12.3 };
    const withSigma = render(<TotalSigmaValue total={total} />);
    const plain = render(<MetricValue metric={total} />);

    expect(withSigma.container.innerHTML).toBe(plain.container.innerHTML);
  });

  it("with no total, renders the blank MetricValue cell and no ± text, even when sigma is given", () => {
    const { container } = render(<TotalSigmaValue sigma={{ value: 92, tier: "epic" }} />);
    const blank = render(<MetricValue />);

    expect(container.innerHTML).toBe(blank.container.innerHTML);
    expect(container.textContent).toBe("");
    expect(container.textContent?.includes("±")).toBe(false);
  });

  it("with both total and sigma, renders one pill: left half Total's tier only, right half Sigma's tier only (rare Total, epic Sigma)", () => {
    const { getByTestId } = render(<TotalSigmaValue total={{ value: 425.67 }} totalTier="rare" sigma={{ value: 92, tier: "epic" }} />);

    const pill = getByTestId("total-sigma-pill");
    expect(pill.className).toMatch(/numeric-cell/);
    expect(pill.className).toMatch(/whitespace-nowrap/);
    expect(pill.className).toMatch(/metric-pill\b/);
    expect(pill.className).not.toMatch(/metric-tier--/);

    const totalHalf = pill.querySelector(".metric-pill__total")!;
    expect(totalHalf).not.toBeNull();
    expect(totalHalf.textContent).toBe("425.67");
    expect(totalHalf.className).toMatch(/metric-tier--rare/);
    expect(totalHalf.className).not.toMatch(/metric-tier--epic/);

    const sigmaHalf = pill.querySelector(".metric-pill__sigma")!;
    expect(sigmaHalf).not.toBeNull();
    expect(sigmaHalf.textContent).toBe("±92.00");
    expect(sigmaHalf.className).toMatch(/metric-tier--epic/);
    expect(sigmaHalf.className).not.toMatch(/metric-tier--rare/);
  });

  it("an undefined totalTier or sigma tier leaves that half with no metric-tier modifier", () => {
    const { getByTestId } = render(<TotalSigmaValue total={{ value: 10 }} sigma={{ value: 5 }} />);
    const pill = getByTestId("total-sigma-pill");

    const totalHalf = pill.querySelector(".metric-pill__total")!;
    const sigmaHalf = pill.querySelector(".metric-pill__sigma")!;
    expect(totalHalf.className).not.toMatch(/metric-tier--/);
    expect(sigmaHalf.className).not.toMatch(/metric-tier--/);
    expect(sigmaHalf.className).not.toMatch(/metric-pill__sigma--neutral/);
  });

  it("a neutral sigma gives the right half the neutral class and no tier modifier, even when a tier is also passed", () => {
    const { getByTestId } = render(<TotalSigmaValue total={{ value: 1024.22 }} totalTier="legendary" sigma={{ value: 235.26, tier: "epic", neutral: true }} />);
    const pill = getByTestId("total-sigma-pill");

    const sigmaHalf = pill.querySelector(".metric-pill__sigma")!;
    expect(sigmaHalf.className).toMatch(/metric-pill__sigma--neutral/);
    expect(sigmaHalf.className).not.toMatch(/metric-tier--/);
    expect(sigmaHalf.textContent).toBe("±235.26");
  });

  it("never reads total.spread: a total carrying spread 33 never prints '33.00'", () => {
    const { container } = render(<TotalSigmaValue total={{ value: 12.34, spread: 33 }} totalTier="common" sigma={{ value: 5, tier: "rare" }} />);

    expect(container.textContent).not.toContain("33.00");
    expect(container.textContent).toBe("12.34±5.00");
  });

  it("puts no aria-label on the pill halves — the visible text is the accessible text", () => {
    const { getByTestId } = render(<TotalSigmaValue total={{ value: 10 }} sigma={{ value: 5, tier: "rare" }} />);
    const pill = getByTestId("total-sigma-pill");

    expect(pill.querySelector(".metric-pill__total")?.getAttribute("aria-label")).toBeNull();
    expect(pill.querySelector(".metric-pill__sigma")?.getAttribute("aria-label")).toBeNull();
  });

  it("restores trailing zeros via toFixed(2), never re-rounding", () => {
    const { getByTestId } = render(<TotalSigmaValue total={{ value: 88.2 }} sigma={{ value: 9 }} />);
    const pill = getByTestId("total-sigma-pill");

    expect(pill.querySelector(".metric-pill__total")?.textContent).toBe("88.20");
    expect(pill.querySelector(".metric-pill__sigma")?.textContent).toBe("±9.00");
  });
});

describe("totalColumnHeader / totalColumnWidth / TOTAL_SIGMA_COLUMN_WIDTH_PX", () => {
  it("TOTAL_SIGMA_COLUMN_WIDTH_PX is 154", () => {
    expect(TOTAL_SIGMA_COLUMN_WIDTH_PX).toBe(154);
  });

  it("totalColumnHeader reads 'Total ± Sigma' for spr and 'Total' for opr/epa", () => {
    expect(totalColumnHeader("spr")).toBe("Total ± Sigma");
    expect(totalColumnHeader("opr")).toBe("Total");
    expect(totalColumnHeader("epa")).toBe("Total");
  });

  it("totalColumnWidth returns 154 for spr and the fallback width otherwise", () => {
    expect(totalColumnWidth("spr", 120)).toBe(154);
    expect(totalColumnWidth("opr", 120)).toBe(120);
    expect(totalColumnWidth("epa", 84)).toBe(84);
  });
});
