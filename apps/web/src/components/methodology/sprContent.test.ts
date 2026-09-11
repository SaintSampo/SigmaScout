/**
 * Content coverage for `sprContent.ts` (quick task 260910-vof).
 *
 * STRUCTURE is pinned BY EQUALITY against hand-typed literal arrays, never by
 * iterating the exported constant — this repo's recorded iteration list trap:
 * a test that only iterates a list silently absorbs an added or removed
 * entry. `sigmaContent.test.ts` established the same pin for its own six
 * sections.
 *
 * FACTS and LIABILITIES are asserted at RUNTIME over the exported string
 * VALUES, never grepped from this file's source text — this module's own
 * header comment (and this file's) legitimately discuss the internal
 * algorithm id `bpr` and the retired 78.05% sealed-holdout figure in prose,
 * so a whole-file grep would false-positive on them.
 *
 * The DERIVATION gate recomputes SPR's rank weights independently, from
 * `BPR_PARAMS` directly, rather than importing `sprContent.ts`'s own derived
 * constants — importing them back would let a broken derivation formula pass
 * against itself.
 */
import { describe, expect, it } from "vitest";
import { BPR_PARAMS } from "../../../../../packages/core/algorithms/bpr.js";
import { SPR_PAGE_TITLE, SPR_LEAD, SPR_SECTION_IDS, SPR_SECTIONS } from "./sprContent.js";

/**
 * The six section ids, hand-typed. Changing `SPR_SECTIONS` without changing
 * this array is the failure this file exists to catch.
 */
const EXPECTED_SECTION_IDS = [
  "what-the-number-is",
  "not-a-solo-score",
  "why-three-do-not-add-up",
  "the-displayed-interval",
  "spr-and-sigma-score-are-different",
  "what-it-does-not-do",
];

/** The retired sealed-holdout figure this page must never transcribe. */
const RETIRED_HOLDOUT_FIGURE = "78.05";
/** The retired display label this page must never render. */
const RETIRED_DISPLAY_LABEL = "BPR";

interface StringRecord {
  readonly where: string;
  readonly text: string;
}

/** Every prose string this module exports, tagged with where it came from. */
function collectStrings(): StringRecord[] {
  const records: StringRecord[] = [
    { where: "SPR_PAGE_TITLE", text: SPR_PAGE_TITLE },
    { where: "SPR_LEAD", text: SPR_LEAD },
  ];
  for (const section of SPR_SECTIONS) {
    records.push({ where: `section "${section.id}" heading`, text: section.heading });
    for (const [index, paragraph] of section.paragraphs.entries()) {
      records.push({ where: `section "${section.id}" paragraph ${index}`, text: paragraph });
    }
  }
  return records;
}

function joinedProse(): string {
  return collectStrings()
    .map((record) => record.text)
    .join(" ");
}

describe("SPR_SECTIONS structure", () => {
  it("exports exactly the six locked section ids, in order, by equality", () => {
    expect(SPR_SECTIONS.map((section) => section.id)).toEqual(EXPECTED_SECTION_IDS);
  });

  it("SPR_SECTION_IDS matches that same hand-typed array", () => {
    expect([...SPR_SECTION_IDS]).toEqual(EXPECTED_SECTION_IDS);
  });

  it("every section carries a non-blank heading and at least one non-blank paragraph", () => {
    for (const section of SPR_SECTIONS) {
      expect(section.heading.trim().length, `section "${section.id}" has a blank heading`).toBeGreaterThan(0);
      expect(section.paragraphs.length, `section "${section.id}" has no paragraphs`).toBeGreaterThan(0);
      for (const [index, paragraph] of section.paragraphs.entries()) {
        expect(paragraph.trim().length, `section "${section.id}" paragraph ${index} is blank`).toBeGreaterThan(0);
      }
    }
  });
});

describe("fact gate over the joined prose", () => {
  const requiredPhrases = [
    "points per match",
    "foul-adjusted",
    "three copies",
    "do not sum",
    "OPR",
    "no ranking-point model",
  ];

  it.each(requiredPhrases)("states the phrase %j somewhere", (phrase) => {
    expect(joinedProse(), `the page never states "${phrase}"`).toContain(phrase);
  });
});

describe("liability gate over every exported string value", () => {
  it("never transcribes the retired sealed-holdout figure", () => {
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} states the retired holdout figure`).not.toContain(RETIRED_HOLDOUT_FIGURE);
    }
  });

  it("never renders the retired display label", () => {
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} renders the retired display label`).not.toContain(RETIRED_DISPLAY_LABEL);
    }
  });
});

describe("derivation gate", () => {
  it("the rank-weight sentence states the weights recomputed independently from BPR_PARAMS", () => {
    // Recomputed here, from BPR_PARAMS directly, never by importing
    // sprContent.ts's own derived constants back into this test.
    const base = [1, BPR_PARAMS.w2, BPR_PARAMS.w3];
    const sum = base.reduce((total, weight) => total + weight, 0);
    const norm = sum > 0 ? 3 / sum : 1;
    const [w1, w2, w3] = base.map((weight) => weight * norm);

    const prose = joinedProse();
    expect(prose, "the strongest-robot weight is missing or stale").toContain((w1 as number).toFixed(2));
    expect(prose, "the middle-robot weight is missing or stale").toContain((w2 as number).toFixed(2));
    expect(prose, "the weakest-robot weight is missing or stale").toContain((w3 as number).toFixed(2));
  });
});
