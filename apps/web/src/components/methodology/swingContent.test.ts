/**
 * Content coverage for `swingContent.ts` (quick task 260909-3fj).
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
 * `src/routes/methodology.swing.test.tsx`. It has to, because the word labels
 * inside the SVG figures are not strings in this module at all. Neither gate
 * covers the whole page on its own.
 */
import { describe, expect, it } from "vitest";
import {
  SWING_FIGURE_IDS,
  SWING_FIGURES,
  SWING_LEAD,
  SWING_PAGE_TITLE,
  SWING_SECTION_IDS,
  SWING_SECTIONS,
} from "./swingContent.js";

/** The three banned characters, named so a failure message reads clearly. */
const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";

/**
 * The seven section ids, hand-typed. Changing `SWING_SECTIONS` without
 * changing this array is the failure this file exists to catch.
 */
const EXPECTED_SECTION_IDS = [
  "where-the-number-starts",
  "one-team-many-matches",
  "what-a-big-swing-means",
  "three-robots-one-band",
  "reading-the-match-band",
  "how-the-two-constants-were-picked",
  "what-it-cannot-do",
];

/** The five figure ids, hand-typed, same reasoning as above. */
const EXPECTED_FIGURE_IDS = ["even-split", "deviations", "same-rating", "squares-add", "match-band"];

/**
 * Every measured number the page is allowed to state, from
 * `260909-3fj-RESEARCH.md`. Pinned as substrings so a rewrite of the prose
 * cannot silently drop the provenance while still reading fine.
 */
const PINNED_NUMBERS = [
  "275,172",
  "86,844",
  "36,805",
  "31,142",
  "216",
  "0.59",
  "1.92",
  "0.89",
  "0.920",
  "75.2%",
  "96.3%",
  "99.5%",
  "68.3%",
  "2.3%",
  "21%",
  "17.32",
  "298.92",
  "322.42",
  "0.1197",
  "76%",
  "87%",
];

interface StringRecord {
  readonly where: string;
  readonly text: string;
}

/** Every prose string this module exports, tagged with where it came from. */
function collectStrings(): StringRecord[] {
  const records: StringRecord[] = [
    { where: "SWING_PAGE_TITLE", text: SWING_PAGE_TITLE },
    { where: "SWING_LEAD", text: SWING_LEAD },
  ];
  for (const section of SWING_SECTIONS) {
    records.push({ where: `section "${section.id}" heading`, text: section.heading });
    for (const [index, paragraph] of section.paragraphs.entries()) {
      records.push({ where: `section "${section.id}" paragraph ${index}`, text: paragraph });
    }
  }
  for (const figure of SWING_FIGURES) {
    records.push({ where: `figure "${figure.id}" title`, text: figure.title });
    records.push({ where: `figure "${figure.id}" caption`, text: figure.caption });
  }
  return records;
}

describe("SWING_SECTIONS structure", () => {
  it("exports exactly the seven locked section ids, in order, by equality", () => {
    expect(SWING_SECTIONS.map((section) => section.id)).toEqual(EXPECTED_SECTION_IDS);
  });

  it("SWING_SECTION_IDS matches that same hand-typed array", () => {
    expect([...SWING_SECTION_IDS]).toEqual(EXPECTED_SECTION_IDS);
  });

  it("every section carries a non-blank heading and at least one non-blank paragraph", () => {
    for (const section of SWING_SECTIONS) {
      expect(section.heading.trim().length, `section "${section.id}" has a blank heading`).toBeGreaterThan(0);
      expect(section.paragraphs.length, `section "${section.id}" has no paragraphs`).toBeGreaterThan(0);
      for (const [index, paragraph] of section.paragraphs.entries()) {
        expect(paragraph.trim().length, `section "${section.id}" paragraph ${index} is blank`).toBeGreaterThan(0);
      }
    }
  });
});

describe("SWING_FIGURES structure", () => {
  it("exports exactly the five locked figure ids, in order, by equality", () => {
    expect(SWING_FIGURES.map((figure) => figure.id)).toEqual(EXPECTED_FIGURE_IDS);
  });

  it("SWING_FIGURE_IDS matches that same hand-typed array", () => {
    expect([...SWING_FIGURE_IDS]).toEqual(EXPECTED_FIGURE_IDS);
  });

  it("every figure carries a non-blank title and caption", () => {
    for (const figure of SWING_FIGURES) {
      expect(figure.title.trim().length, `figure "${figure.id}" has a blank title`).toBeGreaterThan(0);
      expect(figure.caption.trim().length, `figure "${figure.id}" has a blank caption`).toBeGreaterThan(0);
    }
  });

  it("every figure is claimed by exactly one section, and every named figureId exists", () => {
    const claimed = SWING_SECTIONS.flatMap((section) => (section.figureId === undefined ? [] : [section.figureId]));
    for (const figureId of claimed) {
      expect(SWING_FIGURE_IDS, `section names unknown figure "${figureId}"`).toContain(figureId);
    }
    // No orphan figure (declared but never drawn) and no figure drawn twice.
    expect([...claimed].sort()).toEqual([...EXPECTED_FIGURE_IDS].sort());
  });

  it("every illustrative figure says in its own caption that it is an example", () => {
    for (const figure of SWING_FIGURES) {
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

  it("names OPR, EPA and BPR, which are the algorithms the site does publish", () => {
    const joined = collectStrings()
      .map((record) => record.text)
      .join(" ");
    for (const algorithm of ["OPR", "EPA", "BPR"]) {
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
