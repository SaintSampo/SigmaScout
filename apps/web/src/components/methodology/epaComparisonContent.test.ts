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
  statboticsPulledSentence,
  type EpaNoteLabel,
} from "./epaComparisonContent.js";

const EM_DASH = "—";
const EN_DASH = "–";

/** The full six-item shared-list id set, in copy-deck order. */
const EXPECTED_SAME_ITEM_IDS = [
  "rating-update",
  "elimination-matches",
  "win-probability-curve",
  "fouls-in-predictions",
  "new-season-carryover",
  "no-uncertainty-range",
];

/** The full seven-card difference-card id set, in copy-deck order. */
const EXPECTED_DIFFERENCE_CARD_IDS = [
  "week-one-numbers",
  "score-pieces",
  "new-season-start",
  "score-data-cleanup",
  "season-adjustments",
  "ranking-points",
  "offseason-events",
];

/** The full note-label mapping for every card in the copy deck. */
const EXPECTED_NOTE_LABELS: Record<string, EpaNoteLabel[]> = {
  "week-one-numbers": ["Why", "What it changes"],
  "score-pieces": ["Why"],
  "new-season-start": ["Why"],
  "score-data-cleanup": ["What it changes"],
  "season-adjustments": ["Why"],
  "ranking-points": ["Why"],
  "offseason-events": ["What it changes"],
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
  for (const dates of [["2026-09-04"], ["2026-09-07", "2026-09-04"]]) {
    records.push({ where: `statboticsPulledSentence(${dates.join(", ")})`, text: statboticsPulledSentence(dates) });
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

describe("fact gate over the shared list", () => {
  const requiredPhrases = ["one third", "logistic", "70 percent", "30 percent", "40 percent"];

  it.each(requiredPhrases)("the shared list states the phrase %j somewhere", (phrase) => {
    const joined = EPA_SAME_ITEMS.map((item) => item.text).join(" ");
    expect(joined, `the shared list never states "${phrase}"`).toContain(phrase);
  });
});

describe("fact gate per difference card", () => {
  function cardProse(id: string): string {
    const card = EPA_DIFFERENCE_CARDS.find((candidate) => candidate.id === id);
    expect(card, `no card found with id "${id}"`).toBeDefined();
    return [card?.title ?? "", card?.statbotics ?? "", card?.sigmascout ?? "", ...(card?.notes.map((note) => note.text) ?? [])].join(" ");
  }

  it("week-one-numbers contains 'week 1' and 'never changes a winner pick'", () => {
    const prose = cardProse("week-one-numbers");
    expect(prose, "week-one-numbers is missing 'week 1'").toContain("week 1");
    expect(prose, "week-one-numbers is missing 'never changes a winner pick'").toContain("never changes a winner pick");
  });

  it("score-pieces contains 75.2, 74.0 and 73.5", () => {
    const prose = cardProse("score-pieces");
    expect(prose, "score-pieces is missing 75.2").toContain("75.2");
    expect(prose, "score-pieces is missing 74.0").toContain("74.0");
    expect(prose, "score-pieces is missing 73.5").toContain("73.5");
  });

  it("new-season-start contains 250", () => {
    const prose = cardProse("new-season-start");
    expect(prose, "new-season-start is missing 250").toContain("250");
  });

  it("score-data-cleanup contains 'have not been adopted' and never implies a deliberate reason", () => {
    const prose = cardProse("score-data-cleanup");
    expect(prose, "score-data-cleanup is missing 'have not been adopted'").toContain("have not been adopted");
    expect(prose, "score-data-cleanup implies a deliberate reason").not.toMatch(/\b(deliberate|on purpose|chose|choice)\b/i);
  });

  it("season-adjustments contains 'deliberate'", () => {
    const prose = cardProse("season-adjustments");
    expect(prose, "season-adjustments is missing 'deliberate'").toMatch(/\bdeliberate\b/);
  });

  it("ranking-points contains 'deliberate'", () => {
    const prose = cardProse("ranking-points");
    expect(prose, "ranking-points is missing 'deliberate'").toMatch(/\bdeliberate\b/);
  });

  it("offseason-events contains 'last official match'", () => {
    const prose = cardProse("offseason-events");
    expect(prose, "offseason-events is missing 'last official match'").toContain("last official match");
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

describe("statboticsPulledSentence", () => {
  it("names the one exact date when every season shares it", () => {
    expect(statboticsPulledSentence(["2026-09-04", "2026-09-04", "2026-09-04"])).toBe(
      "Statbotics numbers were last pulled from the Statbotics API on September 4, 2026."
    );
  });

  it("names the oldest and newest dates when seasons differ, whatever order they arrive in", () => {
    expect(statboticsPulledSentence(["2026-09-07", "2026-09-04", "2026-09-05"])).toBe(
      "Statbotics numbers were last pulled from the Statbotics API between September 4, 2026 and September 7, 2026."
    );
  });

  it("never shifts the calendar day across timezones, and reads a full timestamp by its date", () => {
    expect(statboticsPulledSentence(["2026-01-01T23:30:00.000Z"])).toContain("January 1, 2026");
  });

  it("returns an empty string for no dates, so the page renders no line", () => {
    expect(statboticsPulledSentence([])).toBe("");
  });
});
