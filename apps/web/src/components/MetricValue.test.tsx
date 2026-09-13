import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MetricValue } from "./MetricValue.js";

// D-07: the metric display primitive. Quick task 260913-g66 removed its
// optional per-cell plus-minus prop, so every case below renders the value
// alone; the formatting and tier contracts are unchanged.

describe("MetricValue", () => {
  it("renders the value inside its own type-role element, within the outer numeric cell", () => {
    const { container } = render(<MetricValue metric={{ value: 88.2 }} />);

    expect(container.textContent).toBe("88.20");
    const valueEl = container.querySelector(".text-role-body");
    expect(valueEl?.textContent).toBe("88.20");
  });

  it("renders exactly '88.20' with no suffix and no separator", () => {
    const { container } = render(<MetricValue metric={{ value: 88.2 }} />);

    expect(container.textContent).toBe("88.20");
    expect(container.textContent?.includes("±")).toBe(false);
  });

  it("renders an empty span with the numeric-cell classes and no text when metric is undefined", () => {
    const { container } = render(<MetricValue metric={undefined} />);

    const outer = container.firstElementChild;
    expect(outer).not.toBeNull();
    expect(outer?.className).toMatch(/numeric-cell/);
    expect(outer?.className).toMatch(/whitespace-nowrap/);
    expect(container.textContent).toBe("");
    expect(container.textContent?.includes("—")).toBe(false);
  });

  it("renders '0.00' (not a blank cell) for a real zero value", () => {
    const { container } = render(<MetricValue metric={{ value: 0 }} />);

    expect(container.textContent).toBe("0.00");
  });

  it("restores the dropped trailing digit via toFixed(2) formatting, not re-rounding", () => {
    const { container } = render(<MetricValue metric={{ value: 88.239 }} />);

    expect(container.textContent).toBe("88.24");
  });

  it("renders a negative value with its sign and two decimals: '-3.50'", () => {
    const { container } = render(<MetricValue metric={{ value: -3.5 }} />);

    expect(container.textContent).toBe("-3.50");
  });

  it("wraps the value in one non-wrapping element", () => {
    const { container } = render(<MetricValue metric={{ value: 88.2 }} />);

    const outer = container.firstElementChild;
    expect(outer).not.toBeNull();
    expect(outer?.className).toMatch(/whitespace-nowrap/);
  });

  it("renders no plus-minus superscript element at all (260913-g66)", () => {
    const { container } = render(<MetricValue metric={{ value: 88.2, spread: 3.1 }} tier="epic" />);

    expect(container.querySelector(".metric-spread-superscript")).toBeNull();
    expect(container.textContent).not.toContain("±");
  });

  // D-17 (06-07-PLAN.md Task 1): the tier prop is presentation-only — it may
  // never change a digit, only wrap the SAME output in `.metric-tier`.
  describe("tier prop (D-17)", () => {
    it("wraps the value in the epic modifier class when tier='epic'", () => {
      const { container } = render(<MetricValue metric={{ value: 76.23 }} tier="epic" />);

      const outer = container.firstElementChild;
      expect(outer?.className).toMatch(/metric-tier\b/);
      expect(outer?.className).toMatch(/metric-tier--epic/);
    });

    // 260904-7rt (sketch 008 winner C): Common now draws the hairline
    // outline ring, so it carries BOTH the base `.metric-tier` class and
    // the `.metric-tier--common` modifier — it no longer matches the
    // undefined-tier case (see the untiered test below for that contract).
    it("wraps the value in the common modifier class when tier='common' (260904-7rt, sketch 008 winner C)", () => {
      const { container } = render(<MetricValue metric={{ value: 76.23 }} tier="common" />);

      const outer = container.firstElementChild;
      expect(outer?.className).toMatch(/metric-tier\b/);
      expect(outer?.className).toMatch(/metric-tier--common/);
    });

    it("renders byte-identical numeric text at tier='common' to the same metric rendered untiered (260904-7rt: the ring is presentation-only)", () => {
      const untiered = render(<MetricValue metric={{ value: 88.2 }} />);
      const common = render(<MetricValue metric={{ value: 88.2 }} tier="common" />);

      expect(common.container.textContent).toBe(untiered.container.textContent);
      expect(common.container.textContent).toBe("88.20");
    });

    it("renders byte-identical numeric text whether tiered or untiered", () => {
      const untiered = render(<MetricValue metric={{ value: 88.2 }} />);
      const tiered = render(<MetricValue metric={{ value: 88.2 }} tier="legendary" />);

      expect(tiered.container.textContent).toBe(untiered.container.textContent);
      expect(tiered.container.textContent).toBe("88.20");
    });

    it("renders no metric-tier class when tier is undefined (the default, unchanged behaviour)", () => {
      const { container } = render(<MetricValue metric={{ value: 88.2 }} />);

      const outer = container.firstElementChild;
      expect(outer?.className).not.toMatch(/metric-tier/);
      expect(container.textContent).toBe("88.20");
      expect(container.textContent?.includes("±")).toBe(false);
    });
  });

  describe("tier wrapper with no plus-minus", () => {
    it("renders the tier box around the bare value", () => {
      const { container } = render(<MetricValue metric={{ value: 76.23 }} tier="epic" />);

      const outer = container.firstElementChild;
      expect(outer?.className).toMatch(/metric-tier\b/);
      expect(outer?.className).toMatch(/metric-tier--epic/);
      expect(container.textContent).toBe("76.23");
    });

    it("renders the bare value, keeping the numeric-cell box, when untiered", () => {
      const { container } = render(<MetricValue metric={{ value: 88.2 }} />);

      expect(container.textContent).toBe("88.20");
      expect(container.textContent?.includes("±")).toBe(false);
      const outer = container.firstElementChild;
      expect(outer?.className).toMatch(/numeric-cell/);
    });
  });
});

/**
 * theme.css drift guard for the Common outline treatment (260904-7rt, sketch
 * 008 winner C). This treatment is a design DECISION with a sketch behind
 * it, not an incidental style — this test exists so a future edit to
 * theme.css cannot silently regress it back to Common having no rule at
 * all. Resolved relative to THIS module (not the process cwd) via
 * `fileURLToPath` + `import.meta.url`, following `favicon.test.ts`'s
 * established pattern — a bare `vitest run` at the repo root picks up a
 * different file set than one invoked from `apps/web` (STATE.md: "Test
 * scope trap"), so a cwd-relative path is exactly how this test would pass
 * in one invocation and fail in the other.
 */
describe("theme.css Common-tier drift guard (260904-7rt)", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const themeCssPath = resolve(testDir, "../styles/theme.css");
  const themeCss = readFileSync(themeCssPath, "utf-8");

  it("declares --tier-common-edge", () => {
    expect(themeCss).toMatch(/--tier-common-edge:\s*#[0-9A-Fa-f]{6};/);
  });

  it("declares a .metric-tier--common rule that references the token via var()", () => {
    const match = themeCss.match(/\.metric-tier--common\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    const body = match?.[1] ?? "";
    expect(body).toMatch(/box-shadow:\s*inset[^;]*var\(--tier-common-edge\)/);
  });

  it("the .metric-tier--common rule sets no background and no border", () => {
    const match = themeCss.match(/\.metric-tier--common\s*\{([^}]*)\}/);
    const body = match?.[1] ?? "";
    expect(body).not.toMatch(/\bbackground\s*:/);
    expect(body).not.toMatch(/\bborder\s*:/);
  });
});

describe("MetricValue — spread must never reach the screen (developer rule, 2026-09-09)", () => {
  it("renders NO ± for a metric carrying the algorithm's spread", () => {
    const { container } = render(<MetricValue metric={{ value: 183.9, spread: 36.32 }} />);
    expect(container.textContent).toBe("183.90");
    expect(container.textContent).not.toContain("±");
    expect(container.textContent).not.toContain("36.32");
  });
});
