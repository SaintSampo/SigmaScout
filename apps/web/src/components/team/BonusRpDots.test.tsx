import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BonusRpDots } from "./BonusRpDots.js";
import { bonusDotTier } from "../../lib/bonusRp.js";
import { predictionPercent } from "../../lib/predictionPercent.js";

/**
 * A predicted dot renders one of three tiers (`bonusDotTier`); an absent
 * probability stays the dashed `unknown` dot, and actual dots keep their
 * earned/missed/unknown states.
 */

function dots(groupTestId: string): HTMLElement[] {
  return Array.from(screen.getByTestId(groupTestId).querySelectorAll<HTMLElement>("[data-testid^='bonus-dot-']"));
}

describe("BonusRpDots, predicted kind", () => {
  it.each([0.1, 0.5, 0.9])("a probability of %s renders a predicted dot with its bonusDotTier as a single span with no element children", (probability) => {
    render(<BonusRpDots season={2024} side="red" kind="predicted" matchKey="m1" probabilities={[probability, 0.3]} applicable />);
    const [dot] = dots("bonus-rp-predicted-m1-red");
    const expectedTier = bonusDotTier(probability);

    expect(dot!.getAttribute("data-state")).toBe("predicted");
    expect(dot!.getAttribute("data-tier")).toBe(expectedTier);
    expect(dot!.className).toContain("bonus-dot--predicted");
    expect(dot!.className).toContain(`bonus-dot--tier-${expectedTier}`);
    expect(dot!.children).toHaveLength(0);
  });

  it("keeps the exact whole percentage in both title and aria-label", () => {
    render(<BonusRpDots season={2024} side="blue" kind="predicted" matchKey="m1" probabilities={[0.724, 0.005]} applicable />);
    const [melody, ensemble] = dots("bonus-rp-predicted-m1-blue");

    expect(melody!.getAttribute("title")).toBe(`Melody: predicted ${predictionPercent(0.724)}% likely`);
    expect(melody!.getAttribute("aria-label")).toBe(melody!.getAttribute("title"));
    expect(ensemble!.getAttribute("title")).toContain(`${predictionPercent(0.005)}%`);
    expect(ensemble!.getAttribute("aria-label")).toBe(ensemble!.getAttribute("title"));
  });

  it("keeps the letter as the dot's only text", () => {
    render(<BonusRpDots season={2025} side="red" kind="predicted" matchKey="m1" probabilities={[0.4, 0.6, 0.9]} applicable />);
    expect(dots("bonus-rp-predicted-m1-red").map((d) => d.textContent)).toEqual(["A", "C", "B"]);
  });

  it("renders unknown with no tier for an undefined probabilities array", () => {
    render(<BonusRpDots season={2024} side="red" kind="predicted" matchKey="m1" applicable />);
    for (const dot of dots("bonus-rp-predicted-m1-red")) {
      expect(dot.getAttribute("data-state")).toBe("unknown");
      expect(dot.hasAttribute("data-tier")).toBe(false);
      expect(dot.getAttribute("title")).toContain("no data published");
      expect(dot.className).toContain("bonus-dot--unknown");
    }
  });

  it("renders the missing trailing positions of a shorter array as unknown with no tier", () => {
    render(<BonusRpDots season={2025} side="blue" kind="predicted" matchKey="m1" probabilities={[0.8]} applicable />);
    const states = dots("bonus-rp-predicted-m1-blue").map((d) => d.getAttribute("data-state"));
    expect(states).toEqual(["predicted", "unknown", "unknown"]);
    expect(dots("bonus-rp-predicted-m1-blue").slice(1).every((d) => !d.hasAttribute("data-tier"))).toBe(true);
  });

  it("renders a non-finite probability as unknown with no tier", () => {
    render(<BonusRpDots season={2024} side="red" kind="predicted" matchKey="m1" probabilities={[Number.NaN, 0.5]} applicable />);
    const [first, second] = dots("bonus-rp-predicted-m1-red");
    expect(first!.getAttribute("data-state")).toBe("unknown");
    expect(first!.hasAttribute("data-tier")).toBe(false);
    expect(second!.getAttribute("data-state")).toBe("predicted");
  });

  it("renders every dot unknown with no tier and the not-awarded label when applicable is false", () => {
    render(<BonusRpDots season={2024} side="red" kind="predicted" matchKey="m1" probabilities={[0.9, 0.9]} applicable={false} />);
    for (const dot of dots("bonus-rp-predicted-m1-red")) {
      expect(dot.getAttribute("data-state")).toBe("unknown");
      expect(dot.hasAttribute("data-tier")).toBe(false);
      expect(dot.getAttribute("aria-label")).toMatch(/not awarded outside qualification matches$/);
    }
  });
});

describe("BonusRpDots, actual kind (unchanged by the three-tier predicted dots)", () => {
  it("renders earned and missed states with their labels and classes, and no tier", () => {
    render(<BonusRpDots season={2024} side="red" kind="actual" matchKey="m1" states={["earned", "missed"]} applicable />);
    const [earned, missed] = dots("bonus-rp-actual-m1-red");

    expect(earned!.getAttribute("data-state")).toBe("earned");
    expect(earned!.getAttribute("title")).toBe("Melody: earned");
    expect(earned!.className).toBe("bonus-dot bonus-dot--red bonus-dot--earned");
    expect(earned!.textContent).toBe("M");

    expect(missed!.getAttribute("data-state")).toBe("missed");
    expect(missed!.getAttribute("aria-label")).toBe("Ensemble: not earned");
    expect(missed!.className).toBe("bonus-dot bonus-dot--red bonus-dot--missed");

    for (const dot of [earned!, missed!]) {
      expect(dot.hasAttribute("data-tier")).toBe(false);
    }
  });

  it("renders unknown for an omitted states list", () => {
    render(<BonusRpDots season={2026} side="blue" kind="actual" matchKey="m1" applicable />);
    const all = dots("bonus-rp-actual-m1-blue");
    expect(all).toHaveLength(3);
    for (const dot of all) {
      expect(dot.getAttribute("data-state")).toBe("unknown");
      expect(dot.className).toBe("bonus-dot bonus-dot--blue bonus-dot--unknown");
      expect(dot.getAttribute("title")).toContain("no data published");
    }
  });
});
