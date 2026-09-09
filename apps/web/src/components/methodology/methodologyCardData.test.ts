/**
 * Order and shape coverage for `METHODOLOGY_CARDS` (quick task 260909-3fj,
 * added alongside the hub's fourth card).
 *
 * WHY THIS FILE EXISTS. `MethodologyCards.tsx` destructures the descriptor
 * array POSITIONALLY, because each `<Link>`'s `to` prop needs its own literal
 * route path for TanStack Router's typed `search` prop to resolve at all (see
 * that file's own doc comment). That makes the ARRAY ORDER load bearing in a
 * way nothing else caught: reordering two entries would render the wrong
 * blurb under the wrong title, and `methodology.index.test.tsx` would stay
 * green throughout, since it iterates the same constant and would happily
 * assert the swapped pairing against itself.
 *
 * So the order is pinned BY EQUALITY against a hand-typed literal array here.
 * That is also this repo's recorded antidote to the iteration list trap: a
 * test that only iterates a list silently absorbs a newly added entry.
 */
import { describe, expect, it } from "vitest";
import { METHODOLOGY_CARDS } from "./methodologyCardData.js";

const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";

const EXPECTED_CARD_ORDER = [
  "/methodology/epa-vs-statbotics",
  "/methodology/compare",
  "/methodology/swing",
  "/methodology/acknowledgments",
];

describe("METHODOLOGY_CARDS", () => {
  it("lists the four hub cards in their exact display order, by equality", () => {
    expect(METHODOLOGY_CARDS.map((card) => card.to)).toEqual(EXPECTED_CARD_ORDER);
  });

  it("keeps the Swing Score card third and Acknowledgments last", () => {
    expect(METHODOLOGY_CARDS[2]?.to).toBe("/methodology/swing");
    expect(METHODOLOGY_CARDS.at(-1)?.to).toBe("/methodology/acknowledgments");
  });

  it("gives every card a non-blank title, blurb and testId", () => {
    for (const card of METHODOLOGY_CARDS) {
      expect(card.title.trim().length, `card "${card.to}" has a blank title`).toBeGreaterThan(0);
      expect(card.blurb.trim().length, `card "${card.to}" has a blank blurb`).toBeGreaterThan(0);
      expect(card.testId.trim().length, `card "${card.to}" has a blank testId`).toBeGreaterThan(0);
    }
  });

  it("gives every card a unique testId", () => {
    const testIds = METHODOLOGY_CARDS.map((card) => card.testId);
    expect(new Set(testIds).size).toBe(testIds.length);
  });

  it("carries no regular expression metacharacter in any title, because methodology.index.test.tsx builds a RegExp from it", () => {
    for (const card of METHODOLOGY_CARDS) {
      expect(card.title, `card "${card.to}" title would break a RegExp`).not.toMatch(/[.*+?^${}()|[\]\\]/);
    }
  });

  it("keeps the Swing Score card's own copy free of all three dash characters", () => {
    const swingCard = METHODOLOGY_CARDS.find((card) => card.to === "/methodology/swing");
    expect(swingCard, "the swing card is gone from the hub").toBeDefined();
    for (const text of [swingCard?.title ?? "", swingCard?.blurb ?? ""]) {
      expect(text).not.toContain(HYPHEN_MINUS);
      expect(text).not.toContain(EN_DASH);
      expect(text).not.toContain(EM_DASH);
    }
  });
});
