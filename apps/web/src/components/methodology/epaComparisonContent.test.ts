/**
 * Content coverage for `epaComparisonContent.ts` (rewritten 2026-09-17 with
 * sketch 016: the difference cards became one table, the shared list one
 * paragraph).
 *
 * STRUCTURE is pinned BY EQUALITY against a hand-typed literal array, never
 * by iterating the exported constant — this repo's recorded iteration list
 * trap: a test that only iterates a list silently absorbs an added or removed
 * entry. `sprContent.test.ts` established the same
 * pin.
 *
 * VOICE, FACT and LIABILITY gates are asserted at RUNTIME over the exported
 * string VALUES via `collectStrings()`, never grepped from this file's own
 * source text — this file's own header comment discusses banned phrases in
 * prose, so a whole-file grep would false-positive on them.
 */
import { describe, expect, it } from "vitest";
import {
  EPA_COMPARISON_LEAD,
  EPA_COMPARISON_PAGE_TITLE,
  EPA_DIFFERENCE_NOTE_LABEL,
  EPA_DIFFERENCE_ROW_IDS,
  EPA_DIFFERENCE_ROWS,
  EPA_DIFFERENCE_SECTION_HEADING,
  EPA_DIFFERENCE_SIGMASCOUT_LABEL,
  EPA_DIFFERENCE_STATBOTICS_LABEL,
  EPA_HEAD_TO_HEAD_INTRO,
  EPA_HEAD_TO_HEAD_SECTION_HEADING,
  EPA_SAME_PARAGRAPH,
  EPA_SAME_SECTION_HEADING,
  sigmascoutMeasuredSentence,
  statboticsPulledSentence,
} from "./epaComparisonContent.js";

const HYPHEN_MINUS = "-";
const EM_DASH = "—";
const EN_DASH = "–";

/** The full five-row difference id set, in display order. */
const EXPECTED_DIFFERENCE_ROW_IDS = [
  "week-one-numbers",
  "score-pieces",
  "new-season-start",
  "score-data-cleanup",
  "season-adjustments",
];

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
    { where: "EPA_SAME_PARAGRAPH", text: EPA_SAME_PARAGRAPH },
    { where: "EPA_DIFFERENCE_STATBOTICS_LABEL", text: EPA_DIFFERENCE_STATBOTICS_LABEL },
    { where: "EPA_DIFFERENCE_SIGMASCOUT_LABEL", text: EPA_DIFFERENCE_SIGMASCOUT_LABEL },
    { where: "EPA_DIFFERENCE_NOTE_LABEL", text: EPA_DIFFERENCE_NOTE_LABEL },
  ];
  for (const row of EPA_DIFFERENCE_ROWS) {
    records.push({ where: `row "${row.id}" topic`, text: row.topic });
    records.push({ where: `row "${row.id}" statbotics cell`, text: row.statbotics });
    records.push({ where: `row "${row.id}" sigmascout cell`, text: row.sigmascout });
    records.push({ where: `row "${row.id}" note`, text: row.note });
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

describe("EPA_DIFFERENCE_ROWS structure", () => {
  it("exports exactly the locked difference-row ids, in order, by equality", () => {
    expect(EPA_DIFFERENCE_ROWS.map((row) => row.id)).toEqual(EXPECTED_DIFFERENCE_ROW_IDS);
  });

  it("EPA_DIFFERENCE_ROW_IDS matches that same hand-typed array", () => {
    expect([...EPA_DIFFERENCE_ROW_IDS]).toEqual(EXPECTED_DIFFERENCE_ROW_IDS);
  });

  it("every row carries a non-empty topic, statbotics cell, sigmascout cell and note", () => {
    for (const row of EPA_DIFFERENCE_ROWS) {
      expect(row.topic.trim().length, `row "${row.id}" topic`).toBeGreaterThan(0);
      expect(row.statbotics.trim().length, `row "${row.id}" statbotics`).toBeGreaterThan(0);
      expect(row.sigmascout.trim().length, `row "${row.id}" sigmascout`).toBeGreaterThan(0);
      expect(row.note.trim().length, `row "${row.id}" note`).toBeGreaterThan(0);
    }
  });

  it("names the two sites in the column headers", () => {
    expect(EPA_DIFFERENCE_STATBOTICS_LABEL).toBe("Statbotics");
    expect(EPA_DIFFERENCE_SIGMASCOUT_LABEL).toBe("SigmaScout");
  });
});

describe("voice gate over every exported string", () => {
  it("carries no hyphen minus, en dash or em dash anywhere", () => {
    for (const { where, text } of collectStrings()) {
      expect(text, `${where} contains a hyphen minus`).not.toContain(HYPHEN_MINUS);
      expect(text, `${where} contains an en dash`).not.toContain(EN_DASH);
      expect(text, `${where} contains an em dash`).not.toContain(EM_DASH);
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

  it("makes no claim about which site's EPA is more accurate; the table carries that", () => {
    const lowerJoined = joinedProse().toLowerCase();
    expect(lowerJoined).not.toMatch(/higher winner accuracy|more accurate|better than|outperform|beats /);
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

describe("fact gate over the shared paragraph", () => {
  const requiredPhrases = ["one third", "logistic", "70 percent", "30 percent", "40 percent"];

  it.each(requiredPhrases)("the shared paragraph states the phrase %j", (phrase) => {
    expect(EPA_SAME_PARAGRAPH, `the shared paragraph never states "${phrase}"`).toContain(phrase);
  });
});

describe("fact gate per difference row", () => {
  function rowProse(id: string): string {
    const row = EPA_DIFFERENCE_ROWS.find((candidate) => candidate.id === id);
    expect(row, `no row found with id "${id}"`).toBeDefined();
    return [row?.topic ?? "", row?.statbotics ?? "", row?.sigmascout ?? "", row?.note ?? ""].join(" ");
  }

  it("week-one-numbers contains 'week 1' and 'never changes a winner pick'", () => {
    const prose = rowProse("week-one-numbers");
    expect(prose, "week-one-numbers is missing 'week 1'").toContain("week 1");
    expect(prose, "week-one-numbers is missing 'never changes a winner pick'").toContain("never changes a winner pick");
  });

  it("score-pieces contains 75.2, 74.0 and 73.5", () => {
    const prose = rowProse("score-pieces");
    expect(prose, "score-pieces is missing 75.2").toContain("75.2");
    expect(prose, "score-pieces is missing 74.0").toContain("74.0");
    expect(prose, "score-pieces is missing 73.5").toContain("73.5");
  });

  it("new-season-start contains 250", () => {
    const prose = rowProse("new-season-start");
    expect(prose, "new-season-start is missing 250").toContain("250");
  });

  it("score-data-cleanup contains 'have not been adopted' and never implies a deliberate reason", () => {
    const prose = rowProse("score-data-cleanup");
    expect(prose, "score-data-cleanup is missing 'have not been adopted'").toContain("have not been adopted");
    expect(prose, "score-data-cleanup implies a deliberate reason").not.toMatch(/\b(deliberate|on purpose|chose|choice)\b/i);
  });

  it("season-adjustments contains 'deliberate'", () => {
    const prose = rowProse("season-adjustments");
    expect(prose, "season-adjustments is missing 'deliberate'").toMatch(/\bdeliberate\b/);
  });
});

describe("sigmascoutMeasuredSentence", () => {
  it("names the version and the long form date, both from its arguments", () => {
    expect(sigmascoutMeasuredSentence("10.0.0+baseline", "2026-09-12T18:04:00.000Z")).toBe(
      "SigmaScout EPA measured with EPA 10.0.0+baseline on September 12, 2026."
    );
  });

  it("carries no ISO hyphen or dash from the timestamp onto the page", () => {
    expect(sigmascoutMeasuredSentence("10.0.0+baseline", "2026-09-12")).not.toMatch(/[-–—]/);
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
