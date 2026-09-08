/**
 * Content coverage for `epaComparisonContent.ts` (quick task 260908-n5o
 * Task 3): the pinned four-entry id set (by equality, not iteration — an
 * added fifth entry must fail this test loudly) and the em dash voice gate,
 * asserted at runtime over the exported string VALUES rather than grepped
 * from the source text (this file's own header comments legitimately use an
 * em dash, so a whole-file grep would false-positive on them).
 */
import { describe, expect, it } from "vitest";
import {
  EPA_AGREEMENT_BLOCK_INTRO,
  EPA_COMPARISON_LEAD,
  EPA_DIFFERENCE_ENTRIES,
  EPA_DIFFERENCE_IDS,
  EPA_HEAD_TO_HEAD_BLOCK_INTRO,
  EPA_OFFSEASON_ARM_BLOCK_INTRO,
  headToHeadSummarySentence,
} from "./epaComparisonContent.js";

const EM_DASH = "—";

describe("EPA_DIFFERENCE_ENTRIES", () => {
  it("exports exactly the four locked difference ids, in order, by equality", () => {
    expect(EPA_DIFFERENCE_ENTRIES.map((entry) => entry.id)).toEqual([
      "offseason-matches",
      "win-probability-scale",
      "component-maps",
      "no-per-year-tweaks",
    ]);
  });

  it("EPA_DIFFERENCE_IDS matches EPA_DIFFERENCE_ENTRIES' own ids exactly", () => {
    expect(EPA_DIFFERENCE_ENTRIES.map((entry) => entry.id)).toEqual([...EPA_DIFFERENCE_IDS]);
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
    for (const intro of [EPA_AGREEMENT_BLOCK_INTRO, EPA_OFFSEASON_ARM_BLOCK_INTRO, EPA_HEAD_TO_HEAD_BLOCK_INTRO]) {
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
