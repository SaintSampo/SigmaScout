/**
 * Content coverage for `awardsContent.ts` (quick task 260912-tm8).
 *
 * Same two jobs, in the same deliberately different styles, as
 * `sigmaContent.test.ts`.
 *
 * STRUCTURE is pinned BY EQUALITY against a hand typed literal array, never by
 * iterating the exported constant. This repo has a recorded iteration list
 * trap: a test that iterates a list silently absorbs a newly added entry.
 *
 * VOICE is asserted at RUNTIME over the exported string VALUES, never grepped
 * from source, because this file's comments legitimately use dashes. The
 * collector builds `{ where, text }` records so a failure names the string.
 *
 * NUMBERS are pinned as substrings. Every figure the page states was measured
 * by committed code (see the content module's header). Pinning them means a
 * prose rewrite cannot quietly drop a sample size or drift a percentage away
 * from what the scripts print. If a script is rerun and a number changes, this
 * test failing is the correct outcome: update the prose and this list together.
 */
import { describe, expect, it } from "vitest";
import { AWARDS_LEAD, AWARDS_PAGE_TITLE, AWARDS_SECTION_IDS, AWARDS_SECTIONS } from "./awardsContent.js";

const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";

/** The nine section ids, hand typed. Changing `AWARDS_SECTIONS` without this is the failure caught here. */
const EXPECTED_SECTION_IDS = [
  "what-we-measured",
  "how-it-was-tested",
  "past-winners-win-again",
  "the-simple-rule-won",
  "team-age",
  "a-short-list",
  "the-percentages-are-too-confident",
  "what-it-means-for-qualifying",
  "what-it-cannot-do",
];

/**
 * Every measured number the page states, as it appears in the prose. Sources:
 * `pnpm measure:award-predictability` (default and `--dcmp`) and
 * `pnpm measure:award-qualification-impact`.
 */
const REQUIRED_FIGURES = [
  // Corpus and scoring scope. 30,516 is instances BUILT (2016 included);
  // 28,033 is the scored sum over 2017 to 2026. They are not the same number.
  "41,869",
  "30,516",
  "28,033",
  // Concentration and repeat rate.
  "29,064",
  "48.7%",
  "6,390",
  "2,074",
  "1,799",
  "1,104",
  "61.4%",
  "348 of 1,616",
  "21.5%",
  // Simple rule against the model, top pick.
  "24.5% of 1,538",
  "22.1%",
  "12.1% of 1,454",
  "9.6%",
  "28.2% of 557",
  "22.8%",
  "14.3% of 1,492",
  "18.9% of 1,171",
  "17.7%",
  "6.8%",
  // Team age.
  "3.85%",
  "294 wins in 7,628",
  "0.65%",
  "85 wins in 13,121",
  "21.6%",
  "19 of the 24",
  "46.1% of 1,114",
  "42.9%",
  // Ranked list.
  "51.1%",
  "84.9%",
  "9.1%",
  "28.5%",
  "32.3%",
  "52.2%",
  // Calibration.
  "29.9%",
  "21.2%",
  "1,470",
  "17.0%",
  "9.5%",
  // Qualification.
  "8.4%",
  "125 of 7,125",
  "1.8%",
  "3,556",
  "16.39",
  "5,689",
  "1.33",
  "259",
  "519",
  "9.3%",
  "2,798",
  "49 of the 78",
  "62.8%",
  "24 of 52",
  "46.2%",
  "13 of 61",
];

function allStrings(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [
    { where: "AWARDS_PAGE_TITLE", text: AWARDS_PAGE_TITLE },
    { where: "AWARDS_LEAD", text: AWARDS_LEAD },
  ];
  for (const section of AWARDS_SECTIONS) {
    out.push({ where: `${section.id}.heading`, text: section.heading });
    section.paragraphs.forEach((text, i) => out.push({ where: `${section.id}.paragraphs[${i}]`, text }));
  }
  return out;
}

describe("awardsContent structure", () => {
  it("exports the nine section ids in order, by equality", () => {
    expect([...AWARDS_SECTION_IDS]).toEqual(EXPECTED_SECTION_IDS);
  });

  it("renders the sections in exactly the declared id order, by equality", () => {
    expect(AWARDS_SECTIONS.map((section) => section.id)).toEqual(EXPECTED_SECTION_IDS);
  });

  it("gives every section a non blank heading and at least one non blank paragraph", () => {
    for (const section of AWARDS_SECTIONS) {
      expect(section.heading.trim().length, `${section.id} has a blank heading`).toBeGreaterThan(0);
      expect(section.paragraphs.length, `${section.id} has no paragraphs`).toBeGreaterThan(0);
      for (const paragraph of section.paragraphs) {
        expect(paragraph.trim().length, `${section.id} has a blank paragraph`).toBeGreaterThan(0);
      }
    }
  });

  it("carries no regular expression metacharacter in the title, because the hub test builds a RegExp from card titles", () => {
    expect(AWARDS_PAGE_TITLE).not.toMatch(/[.*+?^${}()|[\]\\]/);
  });
});

describe("awardsContent voice", () => {
  it("contains no hyphen minus, en dash or em dash in any exported string", () => {
    for (const { where, text } of allStrings()) {
      expect(text, `${where} contains a hyphen minus`).not.toContain(HYPHEN_MINUS);
      expect(text, `${where} contains an en dash`).not.toContain(EN_DASH);
      expect(text, `${where} contains an em dash`).not.toContain(EM_DASH);
    }
  });

  it("uses the public rating name SPR and never the retired internal name BPR", () => {
    for (const { where, text } of allStrings()) {
      expect(text, `${where} names BPR`).not.toMatch(/\bBPR\b/);
    }
  });
});

describe("awardsContent figures", () => {
  it("states every measured figure the scripts produced", () => {
    const pageText = allStrings()
      .map((entry) => entry.text)
      .join("\n");
    for (const figure of REQUIRED_FIGURES) {
      expect(pageText, `the page no longer states ${figure}`).toContain(figure);
    }
  });

  it("describes the rookie rule as what it measures, the lowest team number, not as decoration", () => {
    const teamAge = AWARDS_SECTIONS.find((section) => section.id === "team-age");
    expect(teamAge?.paragraphs.join(" ")).toContain("lowest team number");
  });

  it("says the site shows no award predictions, so the page cannot read as a feature announcement", () => {
    expect(AWARDS_LEAD).toContain("does not show award predictions");
  });
});
