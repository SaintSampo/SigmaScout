import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BonusRpDots } from "./BonusRpDots.js";
import { BONUS_DOT_INNER_PX, bonusDotFillPx } from "../../lib/bonusRp.js";
import { predictionPercent } from "../../lib/predictionPercent.js";

/**
 * F10 (quick task 260914-01x, sketch 012 variant C): a predicted dot fills
 * from the bottom to its probability, with no threshold. An absent
 * probability stays the dashed `unknown` dot, and actual dots keep their
 * earned/missed/unknown states unchanged.
 */

function dots(groupTestId: string): HTMLElement[] {
  return Array.from(screen.getByTestId(groupTestId).querySelectorAll<HTMLElement>("[data-testid^='bonus-dot-']"));
}

function fillOf(dot: HTMLElement): HTMLElement | null {
  return dot.querySelector<HTMLElement>(".bonus-dot__fill");
}

describe("BonusRpDots, predicted kind", () => {
  it.each([0, 0.05, 0.15, 0.5, 0.72, 0.9, 1])("a probability of %s renders a predicted dot filled to bonusDotFillPx in whole pixels", (probability) => {
    render(<BonusRpDots season={2024} side="red" kind="predicted" matchKey="m1" probabilities={[probability, 0.3]} applicable />);
    const [dot] = dots("bonus-rp-predicted-m1-red");
    const expectedPx = bonusDotFillPx(probability, BONUS_DOT_INNER_PX);

    expect(dot!.getAttribute("data-state")).toBe("predicted");
    expect(dot!.getAttribute("data-fill-px")).toBe(String(expectedPx));
    expect(dot!.className).toContain("bonus-dot--predicted");

    const fill = fillOf(dot!);
    expect(fill, "expected a fill child").not.toBeNull();
    expect(fill!.getAttribute("aria-hidden")).toBe("true");
    expect(fill!.style.height).toBe(`${expectedPx}px`);
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

  it("renders unknown with no fill for an undefined probabilities array", () => {
    render(<BonusRpDots season={2024} side="red" kind="predicted" matchKey="m1" applicable />);
    for (const dot of dots("bonus-rp-predicted-m1-red")) {
      expect(dot.getAttribute("data-state")).toBe("unknown");
      expect(dot.hasAttribute("data-fill-px")).toBe(false);
      expect(fillOf(dot)).toBeNull();
      expect(dot.getAttribute("title")).toContain("no data published");
      expect(dot.className).toContain("bonus-dot--unknown");
    }
  });

  it("renders the missing trailing positions of a shorter array as unknown with no fill", () => {
    render(<BonusRpDots season={2025} side="blue" kind="predicted" matchKey="m1" probabilities={[0.8]} applicable />);
    const states = dots("bonus-rp-predicted-m1-blue").map((d) => d.getAttribute("data-state"));
    expect(states).toEqual(["predicted", "unknown", "unknown"]);
    expect(dots("bonus-rp-predicted-m1-blue").slice(1).every((d) => fillOf(d) === null)).toBe(true);
  });

  it("renders a non-finite probability as unknown with no fill", () => {
    render(<BonusRpDots season={2024} side="red" kind="predicted" matchKey="m1" probabilities={[Number.NaN, 0.5]} applicable />);
    const [first, second] = dots("bonus-rp-predicted-m1-red");
    expect(first!.getAttribute("data-state")).toBe("unknown");
    expect(fillOf(first!)).toBeNull();
    expect(second!.getAttribute("data-state")).toBe("predicted");
  });

  it("renders every dot unknown with no fill and the not-awarded label when applicable is false", () => {
    render(<BonusRpDots season={2024} side="red" kind="predicted" matchKey="m1" probabilities={[0.9, 0.9]} applicable={false} />);
    for (const dot of dots("bonus-rp-predicted-m1-red")) {
      expect(dot.getAttribute("data-state")).toBe("unknown");
      expect(fillOf(dot)).toBeNull();
      expect(dot.getAttribute("aria-label")).toMatch(/not awarded outside qualification matches$/);
    }
  });
});

describe("BonusRpDots, actual kind (unchanged by F10)", () => {
  it("renders earned and missed states with their labels and classes, and no fill", () => {
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
      expect(fillOf(dot)).toBeNull();
      expect(dot.hasAttribute("data-fill-px")).toBe(false);
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
