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
  "/methodology/spr",
  "/methodology/epa-vs-statbotics",
  "/methodology/compare",
  "/methodology/awards",
  "/methodology/district-points",
  "/methodology/acknowledgments",
];

describe("METHODOLOGY_CARDS", () => {
  it("lists the six hub cards in their exact display order, by equality", () => {
    expect(METHODOLOGY_CARDS.map((card) => card.to)).toEqual(EXPECTED_CARD_ORDER);
  });

  it("keeps the SPR card first, the awards card fourth, district points fifth, and Acknowledgments last; the Sigma card is gone", () => {
    expect(METHODOLOGY_CARDS[0]?.to).toBe("/methodology/spr");
    expect(METHODOLOGY_CARDS[3]?.to).toBe("/methodology/awards");
    expect(METHODOLOGY_CARDS[4]?.to).toBe("/methodology/district-points");
    expect(METHODOLOGY_CARDS.some((card) => (card.to as string) === "/methodology/sigma")).toBe(false);
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

  it("keeps the SPR card's own copy free of all three dash characters", () => {
    const sprCard = METHODOLOGY_CARDS.find((card) => card.to === "/methodology/spr");
    expect(sprCard, "the SPR card is gone from the hub").toBeDefined();
    expect(sprCard?.title).toBe("What is SPR?");
    for (const text of [sprCard?.title ?? "", sprCard?.blurb ?? ""]) {
      expect(text).not.toContain(HYPHEN_MINUS);
      expect(text).not.toContain(EN_DASH);
      expect(text).not.toContain(EM_DASH);
    }
  });

  it("keeps the awards card's own copy free of all three dash characters", () => {
    const awardsCard = METHODOLOGY_CARDS.find((card) => card.to === "/methodology/awards");
    expect(awardsCard, "the awards card is gone from the hub").toBeDefined();
    for (const text of [awardsCard?.title ?? "", awardsCard?.blurb ?? ""]) {
      expect(text).not.toContain(HYPHEN_MINUS);
      expect(text).not.toContain(EN_DASH);
      expect(text).not.toContain(EM_DASH);
    }
  });

  it("keeps the district points card's own copy free of all three dash characters", () => {
    const districtPointsCard = METHODOLOGY_CARDS.find((card) => card.to === "/methodology/district-points");
    expect(districtPointsCard, "the district points card is gone from the hub").toBeDefined();
    for (const text of [districtPointsCard?.title ?? "", districtPointsCard?.blurb ?? ""]) {
      expect(text).not.toContain(HYPHEN_MINUS);
      expect(text).not.toContain(EN_DASH);
      expect(text).not.toContain(EM_DASH);
    }
  });
});
