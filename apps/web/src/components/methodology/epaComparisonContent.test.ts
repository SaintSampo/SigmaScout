/**
 * Content coverage for `epaComparisonContent.ts` (quick task 260912-tib, a
 * from-scratch rewrite).
 *
 * STRUCTURE is pinned BY EQUALITY against hand-typed literal arrays and a
 * hand-typed note-label object, never by iterating the exported constant —
 * this repo's recorded iteration list trap: a test that only iterates a list
 * silently absorbs an added or removed entry. `sigmaContent.test.ts` and
 * `sprContent.test.ts` established the same pin.
 *
 * VOICE, FACT and LIABILITY gates are asserted at RUNTIME over the exported
 * string VALUES via `collectStrings()`, never grepped from this file's own
 * source text — this file's own header comment discusses banned phrases in
 * prose, so a whole-file grep would false-positive on them.
 */
import { describe, expect, it } from "vitest";
import {
  EPA_CARD_SIGMASCOUT_LABEL,
  EPA_CARD_STATBOTICS_LABEL,
  EPA_COMPARISON_LEAD,
  EPA_COMPARISON_PAGE_TITLE,
  EPA_DIFFERENCE_CARD_IDS,
  EPA_DIFFERENCE_CARDS,
  EPA_DIFFERENCE_SECTION_HEADING,
  EPA_HEAD_TO_HEAD_INTRO,
  EPA_HEAD_TO_HEAD_SECTION_HEADING,
  EPA_SAME_ITEM_IDS,
  EPA_SAME_ITEMS,
  EPA_SAME_SECTION_HEADING,
  headToHeadSummarySentence,
  type EpaNoteLabel,
} from "./epaComparisonContent.js";

const EM_DASH = "—";
const EN_DASH = "–";

/** The one shared-list id this task's thin content carries. */
const EXPECTED_SAME_ITEM_IDS = ["rating-update"];

/** The one difference-card id this task's thin content carries. */
const EXPECTED_DIFFERENCE_CARD_IDS = ["week-one-numbers"];

/** The full note-label mapping for the cards that exist so far. */
const EXPECTED_NOTE_LABELS: Record<string, EpaNoteLabel[]> = {
  "week-one-numbers": ["Why", "What it changes"],
};

/** The only decimal numbers (digit-dot-digit) copy on this page is allowed to state. */
const ALLOWED_DECIMALS = ["73.5", "74.0", "75.2"];

interface StringRecord {
  readonly where: string;
  readonly text: string;
}

/** Every prose string this module exports, tagged with where it came from. */
function collectStrings(): StringRecord[] {
  const records: StringRecord[] = [
    { where: "EPA_COMPARISON_PAGE_TITLE", text: EPA_COMPARISON_PAGE_TITLE },
    { where: "EPA_COMPARISON_LEAD", text: EPA_COMPARISON_LEAD },
    { where: "EPA_SAME_SECTION_HEADING", text: EPA_SAME_SECTION_HEADING },
    { where: "EPA_DIFFERENCE_SECTION_HEADING", text: EPA_DIFFERENCE_SECTION_HEADING },
    { where: "EPA_HEAD_TO_HEAD_SECTION_HEADING", text: EPA_HEAD_TO_HEAD_SECTION_HEADING },
    { where: "EPA_HEAD_TO_HEAD_INTRO", text: EPA_HEAD_TO_HEAD_INTRO },
    { where: "EPA_CARD_STATBOTICS_LABEL", text: EPA_CARD_STATBOTICS_LABEL },
    { where: "EPA_CARD_SIGMASCOUT_LABEL", text: EPA_CARD_SIGMASCOUT_LABEL },
  ];
  for (const item of EPA_SAME_ITEMS) {
    records.push({ where: `same item "${item.id}"`, text: item.text });
  }
  for (const card of EPA_DIFFERENCE_CARDS) {
    records.push({ where: `card "${card.id}" title`, text: card.title });
    records.push({ where: `card "${card.id}" statbotics line`, text: card.statbotics });
    records.push({ where: `card "${card.id}" sigmascout line`, text: card.sigmascout });
    for (const note of card.notes) {
      records.push({ where: `card "${card.id}" note "${note.label}"`, text: note.text });
    }
  }
  for (const [aheadCount, total] of [
    [0, 0],
    [0, 5],
    [3, 5],
    [5, 5],
  ] as const) {
    records.push({
      where: `headToHeadSummarySentence(${aheadCount}, ${total})`,
      text: headToHeadSummarySentence(aheadCount, total),
    });
  }
  return records;
}

function joinedProse(): string {
  return collectStrings()
    .map((record) => record.text)
    .join(" ");
}

describe("EPA_SAME_ITEMS structure", () => {
  it("exports exactly the locked shared-item ids, in order, by equality", () => {
    expect(EPA_SAME_ITEMS.map((item) => item.id)).toEqual(EXPECTED_SAME_ITEM_IDS);
  });

  it("EPA_SAME_ITEM_IDS matches that same hand-typed array", () => {
    expect([...EPA_SAME_ITEM_IDS]).toEqual(EXPECTED_SAME_ITEM_IDS);
  });

  it("every shared item carries non-empty text", () => {
    for (const item of EPA_SAME_ITEMS) {
      expect(item.text.length).toBeGreaterThan(0);
    }
  });
});

describe("EPA_DIFFERENCE_CARDS structure", () => {
  it("exports exactly the locked difference-card ids, in order, by equality", () => {
    expect(EPA_DIFFERENCE_CARDS.map((card) => card.id)).toEqual(EXPECTED_DIFFERENCE_CARD_IDS);
  });

  it("EPA_DIFFERENCE_CARD_IDS matches that same hand-typed array", () => {
    expect([...EPA_DIFFERENCE_CARD_IDS]).toEqual(EXPECTED_DIFFERENCE_CARD_IDS);
  });

  it("every card's note labels equal the hand-typed expected mapping, by equality", () => {
    for (const card of EPA_DIFFERENCE_CARDS) {
      const expected = EXPECTED_NOTE_LABELS[card.id];
      expect(expected, `no expected note labels recorded for card "${card.id}"`).toBeDefined();
      expect(card.notes.map((note) => note.label)).toEqual(expected);
    }
  });

  it("every card carries non-empty title, statbotics and sigmascout text", () => {
    for (const card of EPA_DIFFERENCE_CARDS) {
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.statbotics.length).toBeGreaterThan(0);
      expect(card.sigmascout.length).toBeGreaterThan(0);
      for (const note of card.notes) {
        expect(note.text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("voice gate over every exported string", () => {
  it("carries no em dash anywhere", () => {
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} contains an em dash`).not.toContain(EM_DASH);
    }
  });

  it("carries no en dash anywhere", () => {
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} contains an en dash`).not.toContain(EN_DASH);
    }
  });

  it("uses no hedging opener", () => {
    const hedges = /\b(it'?s worth noting|it is worth noting|importantly|in essence|essentially|simply put|needless to say)\b/i;
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} uses a hedging opener`).not.toMatch(hedges);
    }
  });
});

describe("liability gate over every exported string", () => {
  const bannedPhrases = [
    "rates one quantity per alliance",
    "rates one quantity per season",
    "predicts from a single number instead",
    "the other rates one total",
    "once the season is over",
  ];

  it.each(bannedPhrases)("never contains the retracted phrase %j", (phrase) => {
    const lowerJoined = joinedProse().toLowerCase();
    expect(lowerJoined).not.toContain(phrase.toLowerCase());
  });

  it("never contains the words slope, pearson or correlation", () => {
    const lowerJoined = joinedProse().toLowerCase();
    expect(lowerJoined).not.toMatch(/\bslope\b/);
    expect(lowerJoined).not.toMatch(/\bpearson\b/);
    expect(lowerJoined).not.toMatch(/\bcorrelation\b/);
  });

  it("never contains the phrase mean absolute difference", () => {
    const lowerJoined = joinedProse().toLowerCase();
    expect(lowerJoined).not.toContain("mean absolute difference");
  });

  it("every digit-dot-digit number across all strings is one of the allowed 2024 score-piece figures", () => {
    for (const { where, text } of collectStrings()) {
      const matches = text.match(/\d+\.\d+/g) ?? [];
      for (const match of matches) {
        expect(ALLOWED_DECIMALS, `${where} states a decimal number "${match}" outside the allowed set`).toContain(match);
      }
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
