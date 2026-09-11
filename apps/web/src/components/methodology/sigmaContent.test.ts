/**
 * Content coverage for `sigmaContent.ts` (quick task 260910-u7g).
 *
 * Two jobs, and they are deliberately different in kind.
 *
 * STRUCTURE is pinned BY EQUALITY against hand-typed literal arrays, never by
 * iterating the exported constant. This repo has a recorded iteration list
 * trap: a test that iterates a list silently skips a newly added entry, so an
 * added or removed section would sail through a `for (const s of SECTIONS)`
 * loop while the page quietly changed shape. `epaComparisonContent.test.ts`
 * established the same pin.
 *
 * VOICE is asserted at RUNTIME over the exported string VALUES, never grepped
 * from the source text, for the reason `epaComparisonContent.test.ts`'s own
 * header gives: this test file's comments (and the content module's)
 * legitimately use normal punctuation including every dash character named
 * below, so a whole-file grep would false-positive on them. The collector
 * builds `{ where, text }` records so a failure names the exact string.
 *
 * The rendered-DOM half of the dash gate lives in
 * `src/routes/methodology.sigma.test.tsx`. It has to, because the word labels
 * inside the SVG figures are not strings in this module at all. Neither gate
 * covers the whole page on its own.
 */
import { describe, expect, it } from "vitest";
import {
  SIGMA_FIGURE_IDS,
  SIGMA_FIGURES,
  SIGMA_LEAD,
  SIGMA_PAGE_TITLE,
  SIGMA_SECTION_IDS,
  SIGMA_SECTIONS,
} from "./sigmaContent.js";

/** The three banned characters, named so a failure message reads clearly. */
const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";

/**
 * The eight section ids, hand-typed. Changing `SIGMA_SECTIONS` without
 * changing this array is the failure this file exists to catch.
 */
const EXPECTED_SECTION_IDS = [
  "where-the-number-starts",
  "a-robots-own-level",
  "what-similar-robots-do",
  "what-a-big-sigma-means",
  "three-robots-one-band",
  "reading-the-match-band",
  "how-it-was-tested",
  "what-it-cannot-do",
];

/** The six figure ids, hand-typed, same reasoning as above. */
const EXPECTED_FIGURE_IDS = ["even-split", "level-and-swing", "evidence", "same-rating", "squares-add", "match-band"];

/**
 * Every measured number the page is allowed to state, from
 * quick tasks 260910-u7g and 260910-sz9. Pinned as substrings so a rewrite of the prose
 * cannot silently drop the provenance while still reading fine.
 */
const PINNED_NUMBERS = [
  "297,854",
  "209,349",
  "110,232",
  "0.59",
  "68.3%",
  "64.1%",
  "67.0%",
  "17.32",
  "33.24",
  "5.05",
  "0.323",
  "0.384",
  "0.80",
  "1.94",
];

interface StringRecord {
  readonly where: string;
  readonly text: string;
}

/** Every prose string this module exports, tagged with where it came from. */
function collectStrings(): StringRecord[] {
  const records: StringRecord[] = [
    { where: "SIGMA_PAGE_TITLE", text: SIGMA_PAGE_TITLE },
    { where: "SIGMA_LEAD", text: SIGMA_LEAD },
  ];
  for (const section of SIGMA_SECTIONS) {
    records.push({ where: `section "${section.id}" heading`, text: section.heading });
    for (const [index, paragraph] of section.paragraphs.entries()) {
      records.push({ where: `section "${section.id}" paragraph ${index}`, text: paragraph });
    }
  }
  for (const figure of SIGMA_FIGURES) {
    records.push({ where: `figure "${figure.id}" title`, text: figure.title });
    records.push({ where: `figure "${figure.id}" caption`, text: figure.caption });
  }
  return records;
}

describe("SIGMA_SECTIONS structure", () => {
  it("exports exactly the eight locked section ids, in order, by equality", () => {
    expect(SIGMA_SECTIONS.map((section) => section.id)).toEqual(EXPECTED_SECTION_IDS);
  });

  it("SIGMA_SECTION_IDS matches that same hand-typed array", () => {
    expect([...SIGMA_SECTION_IDS]).toEqual(EXPECTED_SECTION_IDS);
  });

  it("every section carries a non-blank heading and at least one non-blank paragraph", () => {
    for (const section of SIGMA_SECTIONS) {
      expect(section.heading.trim().length, `section "${section.id}" has a blank heading`).toBeGreaterThan(0);
      expect(section.paragraphs.length, `section "${section.id}" has no paragraphs`).toBeGreaterThan(0);
      for (const [index, paragraph] of section.paragraphs.entries()) {
        expect(paragraph.trim().length, `section "${section.id}" paragraph ${index} is blank`).toBeGreaterThan(0);
      }
    }
  });
});

describe("SIGMA_FIGURES structure", () => {
  it("exports exactly the six locked figure ids, in order, by equality", () => {
    expect(SIGMA_FIGURES.map((figure) => figure.id)).toEqual(EXPECTED_FIGURE_IDS);
  });

  it("SIGMA_FIGURE_IDS matches that same hand-typed array", () => {
    expect([...SIGMA_FIGURE_IDS]).toEqual(EXPECTED_FIGURE_IDS);
  });

  it("every figure carries a non-blank title and caption", () => {
    for (const figure of SIGMA_FIGURES) {
      expect(figure.title.trim().length, `figure "${figure.id}" has a blank title`).toBeGreaterThan(0);
      expect(figure.caption.trim().length, `figure "${figure.id}" has a blank caption`).toBeGreaterThan(0);
    }
  });

  it("every figure is claimed by exactly one section, and every named figureId exists", () => {
    const claimed = SIGMA_SECTIONS.flatMap((section) => (section.figureId === undefined ? [] : [section.figureId]));
    for (const figureId of claimed) {
      expect(SIGMA_FIGURE_IDS, `section names unknown figure "${figureId}"`).toContain(figureId);
    }
    // No orphan figure (declared but never drawn) and no figure drawn twice.
    expect([...claimed].sort()).toEqual([...EXPECTED_FIGURE_IDS].sort());
  });

  it("every illustrative figure says in its own caption that it is an example", () => {
    for (const figure of SIGMA_FIGURES) {
      if (!figure.illustrative) continue;
      expect(figure.caption, `figure "${figure.id}" draws example data without saying so`).toMatch(/example/i);
    }
  });
});

describe("voice gate over every exported string", () => {
  it("carries no hyphen-minus character anywhere", () => {
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} contains a hyphen-minus`).not.toContain(HYPHEN_MINUS);
    }
  });

  it("carries no en dash character anywhere", () => {
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} contains an en dash`).not.toContain(EN_DASH);
    }
  });

  it("carries no em dash character anywhere", () => {
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} contains an em dash`).not.toContain(EM_DASH);
    }
  });

  it("uses no hedging opener and no 'not only' construction", () => {
    const hedges = /\b(it'?s worth noting|it is worth noting|importantly|in essence|essentially|simply put|needless to say)\b/i;
    const notOnly = /\bnot only\b/i;
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} uses a hedging opener`).not.toMatch(hedges);
      expect(text, `${where} uses a "not only" construction`).not.toMatch(notOnly);
    }
  });

  it("never names the retired algorithm", () => {
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} names a rating the site no longer publishes`).not.toMatch(/\bvpr\b/i);
    }
  });

  it("names OPR, EPA and SPR, which are the algorithms the site does publish", () => {
    const joined = collectStrings()
      .map((record) => record.text)
      .join(" ");
    for (const algorithm of ["OPR", "EPA", "SPR"]) {
      expect(joined, `the page never names ${algorithm}`).toContain(algorithm);
    }
  });
});

describe("measured provenance", () => {
  it("states every pinned number from the research document", () => {
    const joined = collectStrings()
      .map((record) => record.text)
      .join(" ");
    for (const value of PINNED_NUMBERS) {
      expect(joined, `the page no longer states ${value}`).toContain(value);
    }
  });
});
