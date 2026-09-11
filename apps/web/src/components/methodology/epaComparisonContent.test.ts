/**
 * Content coverage for `epaComparisonContent.ts` (quick task 260908-n5o
 * Task 3; revised same day to drop the offseason-matches entry — see the
 * module's own header comment): the pinned three-entry id set (by equality,
 * not iteration — an added fourth entry must fail this test loudly) and the
 * em dash voice gate, asserted at runtime over the exported string VALUES
 * rather than grepped from the source text (this file's own header comments
 * legitimately use an em dash, so a whole-file grep would false-positive on
 * them).
 */
import { describe, expect, it } from "vitest";
import {
  EPA_AGREEMENT_BLOCK_INTRO,
  EPA_COMPARISON_LEAD,
  EPA_DIFFERENCE_ENTRIES,
  EPA_DIFFERENCE_IDS,
  EPA_HEAD_TO_HEAD_BLOCK_INTRO,
  headToHeadSummarySentence,
} from "./epaComparisonContent.js";

const EM_DASH = "—";

describe("EPA_DIFFERENCE_ENTRIES", () => {
  it("exports exactly the three locked difference ids, in order, by equality", () => {
    expect(EPA_DIFFERENCE_ENTRIES.map((entry) => entry.id)).toEqual(["win-probability-scale", "component-maps", "no-per-year-tweaks"]);
  });

  it("EPA_DIFFERENCE_IDS matches EPA_DIFFERENCE_ENTRIES' own ids exactly", () => {
    expect(EPA_DIFFERENCE_ENTRIES.map((entry) => entry.id)).toEqual([...EPA_DIFFERENCE_IDS]);
  });

  /**
   * RETRACTED-CLAIM GATE (quick task 260911-j2w). The `component-maps` entry
   * used to tell readers that Statbotics rates a single quantity for an
   * alliance and predicts directly from it, while SigmaScout rates several
   * pieces and adds them up. `docs/models/statbotics-breakdown-reference.md`
   * §3 disproves it: `predict_match` sums an 18-entry PER-TEAM vector
   * component-wise across the alliance, the same shape SigmaScout uses. Only
   * how many of that vector's entries the predicted score READS varies by
   * season (§18). The phrases below are pinned verbatim rather than
   * paraphrased, so an editor pasting the retired wording back fails here
   * instead of shipping it to the page.
   */
  it("the component-maps entry does not reassert the retracted one-number-per-alliance claim", () => {
    const entry = EPA_DIFFERENCE_ENTRIES.find((candidate) => candidate.id === "component-maps");
    expect(entry).toBeDefined();
    const prose = [entry?.heading ?? "", ...(entry?.paragraphs ?? [])].join(" ").toLowerCase();
    for (const retracted of [
      "rates one quantity per alliance",
      "rates one quantity per season",
      "predicts from a single number instead",
      "the other rates one total",
    ]) {
      expect(prose).not.toContain(retracted);
    }
  });

  it("every entry carries a non-empty heading and at least one paragraph", () => {
    for (const entry of EPA_DIFFERENCE_ENTRIES) {
      expect(entry.heading.length).toBeGreaterThan(0);
      expect(entry.paragraphs.length).toBeGreaterThan(0);
      for (const paragraph of entry.paragraphs) {
        expect(paragraph.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("voice gate — no em dash in any exported string", () => {
  it("the lead paragraph carries no em dash", () => {
    expect(EPA_COMPARISON_LEAD).not.toContain(EM_DASH);
  });

  it("every difference entry's heading and every paragraph carries no em dash", () => {
    for (const entry of EPA_DIFFERENCE_ENTRIES) {
      expect(entry.heading).not.toContain(EM_DASH);
      for (const paragraph of entry.paragraphs) {
        expect(paragraph).not.toContain(EM_DASH);
      }
    }
  });

  it("every stat-block intro sentence carries no em dash", () => {
    for (const intro of [EPA_AGREEMENT_BLOCK_INTRO, EPA_HEAD_TO_HEAD_BLOCK_INTRO]) {
      expect(intro).not.toContain(EM_DASH);
    }
  });

  it("headToHeadSummarySentence's output carries no em dash across every count shape", () => {
    for (const [aheadCount, total] of [
      [0, 0],
      [0, 5],
      [3, 5],
      [5, 5],
    ] as const) {
      expect(headToHeadSummarySentence(aheadCount, total)).not.toContain(EM_DASH);
    }
  });
});

describe("headToHeadSummarySentence", () => {
  it("derives its season count from the arguments, never a hardcoded number", () => {
    expect(headToHeadSummarySentence(3, 5)).toContain("3 of 5");
    expect(headToHeadSummarySentence(2, 4)).toContain("2 of 4");
  });

  it("names every season when Statbotics leads all of them", () => {
    expect(headToHeadSummarySentence(5, 5)).toContain("all 5");
  });

  it("credits SigmaScout when Statbotics leads none", () => {
    expect(headToHeadSummarySentence(0, 5)).toMatch(/matched or beat/);
  });
});
