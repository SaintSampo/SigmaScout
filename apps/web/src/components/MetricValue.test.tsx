import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MetricValue } from "./MetricValue.js";

// D-07: the value-and-spread display primitive. Every input/output pair
// below is pinned exactly as 05-UI-SPEC.md's Typography "Sigma display
// format" and the Sigma-metric-display UI Considerations rows specify it
// (05-03-PLAN.md Task 3).

describe("MetricValue", () => {
  it("renders value and spread as '88.20 ± 3.10' in separate elements", () => {
    const { container } = render(<MetricValue metric={{ value: 88.2, spread: 3.1 }} />);

    expect(container.textContent).toBe("88.20 ± 3.10");
    // Value and suffix carry different type/colour, so they must be two
    // distinct child elements, not one text node.
    expect(container.querySelectorAll("*").length).toBeGreaterThanOrEqual(3);
  });

  it("renders exactly '88.20' with no suffix and no separator when spread is absent", () => {
    const { container } = render(<MetricValue metric={{ value: 88.2 }} />);

    expect(container.textContent).toBe("88.20");
    expect(container.textContent?.includes("±")).toBe(false);
  });

  it("renders a single em-dash and nothing else when metric is undefined", () => {
    const { container } = render(<MetricValue metric={undefined} />);

    expect(container.textContent).toBe("—");
  });

  it("renders '0.00' (not an em-dash) for a real zero value", () => {
    const { container } = render(<MetricValue metric={{ value: 0 }} />);

    expect(container.textContent).toBe("0.00");
  });

  it("restores the dropped trailing digit via toFixed(2) formatting, not re-rounding", () => {
    const { container } = render(<MetricValue metric={{ value: 88.239 }} />);

    expect(container.textContent).toBe("88.24");
  });

  it("renders a zero spread as a real suffix: '-3.50 ± 0.00'", () => {
    const { container } = render(<MetricValue metric={{ value: -3.5, spread: 0 }} />);

    expect(container.textContent).toBe("-3.50 ± 0.00");
  });

  it("wraps the value-and-spread pair in one non-wrapping element", () => {
    const { container } = render(<MetricValue metric={{ value: 88.2, spread: 3.1 }} />);

    const outer = container.firstElementChild;
    expect(outer).not.toBeNull();
    expect(outer?.className).toMatch(/whitespace-nowrap/);
  });

  it("resolves the suffix colour through the muted text token, never a literal", () => {
    const { container } = render(<MetricValue metric={{ value: 88.2, spread: 3.1 }} />);

    const suffix = Array.from(container.querySelectorAll("span")).find((el) => el.textContent === " ± 3.10");
    expect(suffix).not.toBeUndefined();
    expect(suffix?.className).toMatch(/text-muted/);
  });

  // D-17 (06-07-PLAN.md Task 1): the tier prop is presentation-only — it may
  // never change a digit, only wrap the SAME output in `.metric-tier`.
  describe("tier prop (D-17)", () => {
    it("wraps the value in the epic modifier class when tier='epic'", () => {
      const { container } = render(<MetricValue metric={{ value: 76.23, spread: 2.85 }} tier="epic" />);

      const outer = container.firstElementChild;
      expect(outer?.className).toMatch(/metric-tier\b/);
      expect(outer?.className).toMatch(/metric-tier--epic/);
    });

    it("renders no metric-tier class at all when tier='common' — identical to no tier prop", () => {
      const { container } = render(<MetricValue metric={{ value: 76.23, spread: 2.85 }} tier="common" />);

      const outer = container.firstElementChild;
      expect(outer?.className).not.toMatch(/metric-tier/);
    });

    it("renders byte-identical numeric text whether tiered or untiered", () => {
      const untiered = render(<MetricValue metric={{ value: 88.2, spread: 3.1 }} />);
      const tiered = render(<MetricValue metric={{ value: 88.2, spread: 3.1 }} tier="legendary" />);

      expect(tiered.container.textContent).toBe(untiered.container.textContent);
      expect(tiered.container.textContent).toBe("88.20 ± 3.10");
    });

    it("renders no metric-tier class when tier is undefined (the default, unchanged behaviour)", () => {
      const { container } = render(<MetricValue metric={{ value: 88.2 }} />);

      const outer = container.firstElementChild;
      expect(outer?.className).not.toMatch(/metric-tier/);
      expect(container.textContent).toBe("88.20");
      expect(container.textContent?.includes("±")).toBe(false);
    });
  });
});
