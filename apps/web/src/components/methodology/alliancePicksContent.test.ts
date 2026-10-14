/**
 * Content coverage for `alliancePicksContent.ts` (quick task 261014-ol7).
 *
 * The same three jobs, in the same deliberately different styles, as
 * `awardsContent.test.ts` and `districtLedgerContent.test.ts`.
 *
 * STRUCTURE is pinned BY EQUALITY against hand typed literals, never by
 * iterating the exported constant (the recorded iteration list trap).
 *
 * VOICE is asserted at RUNTIME over the exported string VALUES, chart labels
 * and every tooltip the charts can show included.
 *
 * NUMBERS come in two kinds. The measured scores are pinned by equality
 * against the 261014-mji SUMMARY's pooled rows. The pick table is NOT pinned:
 * it is read from `PICK_POSITION_COUNTS`, so the test recomputes the caption's
 * figures from that module independently and checks the page states them.
 */
import { describe, expect, it } from "vitest";
import { PICK_POSITION_COUNTS } from "../../../../../packages/core/districts/pickPositionTables.js";
import {
  ALLIANCE_PICKS_LEAD,
  ALLIANCE_PICKS_PAGE_TITLE,
  ALLIANCE_PICKS_SECTION_IDS,
  CALIBRATION_FIXED_ORDER,
  CALIBRATION_LABELS,
  CALIBRATION_WEIGHTED_DRAFT,
  calibrationRow,
  calibrationTooltip,
  formatChance,
  HOW_IT_SCORES_SECTION,
  ordinal,
  PICK_CHART_LABELS,
  PICK_ROUND_LABELS,
  PICK_TABLE,
  PICK_TABLE_CAPTION,
  PICK_TABLE_SEASON,
  PICK_TABLE_SECTION,
  PICK_TABLE_TURNS,
  pickBarTooltip,
  pickChances,
  pickCounts,
  RESULTS_TABLE,
  SAID_VERSUS_HAPPENED_SUBSECTION,
  TEAMS_LEFT_DEFAULT,
  TEAMS_LEFT_MAX,
  TEAMS_LEFT_MIN,
  WHAT_IT_LEAVES_OUT_SECTION,
} from "./alliancePicksContent.js";

const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";

const EXPECTED_SECTION_IDS = ["the-pick-table", "how-it-scores", "what-it-leaves-out"];

/** The 261014-mji SUMMARY's POOLED rows for arms (a), (b) and (c), hand typed. */
const EXPECTED_RESULTS_ROWS = [
  ["Best SPR left, every time", "0.1327", "0.6197", "86.73%"],
  ["Weighted draft", "0.0917", "0.2886", "86.95%"],
  ["Best qualification rank left, every time", "0.1865", "0.8672", "81.35%"],
];

/** The 261014-mji SUMMARY's "Calibration, pooled" block, hand typed: said, happened, teams. */
const EXPECTED_FIXED_ORDER = [
  [0, 20.0, 5772],
  [100, 90.1, 11640],
];
const EXPECTED_WEIGHTED_DRAFT = [
  [0, 1.8, 55],
  [4.5, 6.6, 2005],
  [15.0, 16.0, 1187],
  [24.9, 24.9, 897],
  [35.8, 32.4, 796],
  [44.9, 39.9, 832],
  [55.5, 51.9, 707],
  [64.9, 65.2, 817],
  [75.3, 74.2, 1006],
  [85.3, 85.6, 1209],
  [96.4, 97.7, 3352],
  [100, 100, 4549],
];

const EXPECTED_LEFT_OUT_LABELS = ["The SPR gap.", "Captains and events.", "Declines.", "Backup robots."];

/** No first person, singular or plural, on this page. */
const FIRST_PERSON: readonly RegExp[] = [/\bI\b/, /\bmy\b/i, /\bwe\b/i, /\bour\b/i, /\bus\b/i];

function sentenceCount(text: string): number {
  return (text.match(/\.(\s|$)/g) ?? []).length;
}

/** Every paragraph shaped string: the ones the three sentence rule binds. */
function allParagraphs(): { where: string; text: string }[] {
  return [
    { where: "ALLIANCE_PICKS_LEAD", text: ALLIANCE_PICKS_LEAD },
    ...PICK_TABLE_SECTION.paragraphs.map((text, i) => ({ where: `the-pick-table.paragraphs[${i}]`, text })),
    { where: "PICK_TABLE_CAPTION", text: PICK_TABLE_CAPTION },
    ...HOW_IT_SCORES_SECTION.paragraphs.map((text, i) => ({ where: `how-it-scores.paragraphs[${i}]`, text })),
    { where: "RESULTS_TABLE.caption", text: RESULTS_TABLE.caption },
    ...HOW_IT_SCORES_SECTION.afterTable.map((text, i) => ({ where: `how-it-scores.afterTable[${i}]`, text })),
    ...SAID_VERSUS_HAPPENED_SUBSECTION.paragraphs.map((text, i) => ({ where: `said-versus-happened.paragraphs[${i}]`, text })),
    ...WHAT_IT_LEAVES_OUT_SECTION.items.map((item, i) => ({ where: `what-it-leaves-out.items[${i}]`, text: `${item.label} ${item.detail}` })),
  ];
}

/** Every string the page can render, tooltips for every bar and point included. */
function allStrings(): { where: string; text: string }[] {
  const out = [
    { where: "ALLIANCE_PICKS_PAGE_TITLE", text: ALLIANCE_PICKS_PAGE_TITLE },
    ...allParagraphs(),
    { where: "the-pick-table.heading", text: PICK_TABLE_SECTION.heading },
    { where: "how-it-scores.heading", text: HOW_IT_SCORES_SECTION.heading },
    { where: "said-versus-happened.heading", text: SAID_VERSUS_HAPPENED_SUBSECTION.heading },
    { where: "what-it-leaves-out.heading", text: WHAT_IT_LEAVES_OUT_SECTION.heading },
    ...RESULTS_TABLE.head.map((text, i) => ({ where: `RESULTS_TABLE.head[${i}]`, text })),
    ...RESULTS_TABLE.rows.flatMap((row, r) => row.map((text, c) => ({ where: `RESULTS_TABLE.rows[${r}][${c}]`, text }))),
    ...Object.entries(PICK_ROUND_LABELS).map(([key, text]) => ({ where: `PICK_ROUND_LABELS.${key}`, text })),
    ...Object.entries(PICK_CHART_LABELS).flatMap(([key, value]) =>
      (typeof value === "string" ? [value] : [...value]).map((text) => ({ where: `PICK_CHART_LABELS.${key}`, text })),
    ),
    ...Object.entries(CALIBRATION_LABELS).flatMap(([key, value]) =>
      (typeof value === "string" ? [value] : [...value]).map((text) => ({ where: `CALIBRATION_LABELS.${key}`, text })),
    ),
  ];
  for (const round of ["first", "second"] as const) {
    for (let teamsLeft = TEAMS_LEFT_MIN; teamsLeft <= TEAMS_LEFT_MAX; teamsLeft++) {
      pickChances(pickCounts(round), teamsLeft).forEach((chance, index) =>
        out.push({ where: `pickBarTooltip(${round}, ${teamsLeft}, ${index + 1})`, text: pickBarTooltip(index + 1, chance) }),
      );
    }
  }
  for (const point of [...CALIBRATION_FIXED_ORDER, ...CALIBRATION_WEIGHTED_DRAFT]) {
    out.push({ where: `calibrationTooltip(${point.said})`, text: calibrationTooltip(CALIBRATION_LABELS.weightedDraft, point) });
    calibrationRow(CALIBRATION_LABELS.fixedOrder, point).forEach((text) => out.push({ where: `calibrationRow(${point.said})`, text }));
  }
  return out;
}

describe("alliancePicksContent structure", () => {
  it("exports the three section ids in render order, by equality", () => {
    expect([...ALLIANCE_PICKS_SECTION_IDS]).toEqual(EXPECTED_SECTION_IDS);
    expect([PICK_TABLE_SECTION.id, HOW_IT_SCORES_SECTION.id, WHAT_IT_LEAVES_OUT_SECTION.id]).toEqual(EXPECTED_SECTION_IDS);
    expect(SAID_VERSUS_HAPPENED_SUBSECTION.id).toBe("said-versus-happened");
  });

  it("titles the page as the awards page titles itself", () => {
    expect(ALLIANCE_PICKS_PAGE_TITLE).toBe("Predicting alliance picks");
    expect(ALLIANCE_PICKS_PAGE_TITLE).not.toMatch(/[.*+?^${}()|[\]\\]/);
  });

  it("lists exactly the four things the model leaves out, by equality", () => {
    expect(WHAT_IT_LEAVES_OUT_SECTION.items.map((item) => item.label)).toEqual(EXPECTED_LEFT_OUT_LABELS);
  });

  it("keeps the results table rectangular and pinned to the measured pooled rows", () => {
    expect([...RESULTS_TABLE.head]).toEqual(["How picks are made", "Brier", "Log loss", "Calls right"]);
    expect(RESULTS_TABLE.rows.map((row) => [...row])).toEqual(EXPECTED_RESULTS_ROWS);
  });

  it("carries the slider's range of 2 to 40 teams left, starting inside it", () => {
    expect([TEAMS_LEFT_MIN, TEAMS_LEFT_MAX]).toEqual([2, 40]);
    expect(TEAMS_LEFT_DEFAULT).toBeGreaterThanOrEqual(TEAMS_LEFT_MIN);
    expect(TEAMS_LEFT_DEFAULT).toBeLessThanOrEqual(TEAMS_LEFT_MAX);
  });
});

describe("the pick table is read from PICK_POSITION_COUNTS, never pasted", () => {
  const newest = Math.max(...Object.keys(PICK_POSITION_COUNTS).map(Number));
  const counts = PICK_POSITION_COUNTS[newest]!;
  const total = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

  it("uses the newest season key, the table live predictions use", () => {
    expect(PICK_TABLE_SEASON).toBe(newest);
    expect(PICK_TABLE).toBe(counts);
    expect(pickCounts("first")).toBe(counts.firstPick);
    expect(pickCounts("second")).toBe(counts.secondPick);
  });

  it("names the seasons and the turn counts the table was built from, in the caption", () => {
    expect(PICK_TABLE_TURNS).toEqual({ first: total(counts.firstPick), second: total(counts.secondPick) });
    expect(PICK_TABLE_CAPTION).toContain(`${total(counts.firstPick).toLocaleString("en-US")} first picks`);
    expect(PICK_TABLE_CAPTION).toContain(`${total(counts.secondPick).toLocaleString("en-US")} second picks`);
    expect(PICK_TABLE_CAPTION).toContain(`from ${counts.seasonsFrom} to ${counts.seasonsTo}`);
    expect(PICK_TABLE_CAPTION).toContain(`the ${newest} season`);
  });
});

describe("pickChances: cut the table to the line, rescale to 100%", () => {
  it("cuts and rescales a small table", () => {
    expect(pickChances([3, 1, 0, 4], 2)).toEqual([0.75, 0.25]);
    expect(pickChances([3, 1], 4)).toEqual([0.75, 0.25, 0, 0]);
  });

  it("puts the whole chance on the best team left when the line holds no mass", () => {
    expect(pickChances([0, 0, 5], 2)).toEqual([1, 0]);
  });

  it("sums to 1 with one entry per team left, for both rounds at every slider stop", () => {
    for (const round of ["first", "second"] as const) {
      for (let teamsLeft = TEAMS_LEFT_MIN; teamsLeft <= TEAMS_LEFT_MAX; teamsLeft++) {
        const chances = pickChances(pickCounts(round), teamsLeft);
        expect(chances).toHaveLength(teamsLeft);
        expect(chances.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      }
    }
  });
});

describe("formatting", () => {
  it("prints chances as whole percent from 10%, one decimal below, a sliver as <0.1% and none as 0%", () => {
    expect(formatChance(0.3339)).toBe("33%");
    expect(formatChance(0.0995)).toBe("10%");
    expect(formatChance(0.0476)).toBe("4.8%");
    expect(formatChance(0.0004)).toBe("<0.1%");
    expect(formatChance(0)).toBe("0%");
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30, 40].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "30th",
      "40th",
    ]);
  });

  it("builds the tooltips and table rows from the point", () => {
    expect(pickBarTooltip(3, 0.1251)).toBe("3rd best team left: 13%");
    expect(calibrationTooltip("Weighted draft", { said: 4.5, happened: 6.6, teams: 2005 })).toBe(
      "Weighted draft: said 4.5%, happened 6.6%, 2,005 teams",
    );
    expect([...calibrationRow("Best SPR left", { said: 0, happened: 20.0, teams: 5772 })]).toEqual(["Best SPR left", "0%", "20%", "5,772"]);
  });
});

describe("the said versus happened data", () => {
  const triples = (points: typeof CALIBRATION_FIXED_ORDER) => points.map((p) => [p.said, p.happened, p.teams]);

  it("pins both series to the measured calibration block, by equality", () => {
    expect(triples(CALIBRATION_FIXED_ORDER)).toEqual(EXPECTED_FIXED_ORDER);
    expect(triples(CALIBRATION_WEIGHTED_DRAFT)).toEqual(EXPECTED_WEIGHTED_DRAFT);
  });

  it("covers all 17,412 scored teams in each series", () => {
    const teams = (points: typeof CALIBRATION_FIXED_ORDER) => points.reduce((a, p) => a + p.teams, 0);
    expect(teams(CALIBRATION_FIXED_ORDER)).toBe(17412);
    expect(teams(CALIBRATION_WEIGHTED_DRAFT)).toBe(17412);
    expect(RESULTS_TABLE.caption).toContain("17,412 teams");
    expect(RESULTS_TABLE.caption).toContain("485 district events from 2023 to 2026");
  });

  it("states the fixed order's two groups as the data has them", () => {
    const [zero, hundred] = CALIBRATION_FIXED_ORDER;
    const text = SAID_VERSUS_HAPPENED_SUBSECTION.paragraphs.join(" ");
    expect(text).toContain(`Of the ${zero!.teams.toLocaleString("en-US")} teams it gave 0%, 1 in 5 were picked`);
    expect(text).toContain(`1 in 10 of the ${hundred!.teams.toLocaleString("en-US")} it gave 100% were not`);
    expect(Math.round(100 / zero!.happened)).toBe(5);
    expect(Math.round(100 / (100 - hundred!.happened))).toBe(10);
    expect(CALIBRATION_LABELS.fixedZeroNote).toBe("1 in 5 picked");
    expect(CALIBRATION_LABELS.fixedHundredNote).toBe("1 in 10 not picked");
  });

  it("says plainly that the weighted draft scored better in every season, and nothing more", () => {
    expect(HOW_IT_SCORES_SECTION.afterTable[0]).toBe(
      "The weighted draft scored better than best SPR left on all three measures in every season from 2023 to 2026. Lower Brier and log loss mean the chances sit closer to what happened.",
    );
  });
});

describe("alliancePicksContent voice", () => {
  it("contains no hyphen minus, en dash or em dash in any string the page can render", () => {
    for (const { where, text } of allStrings()) {
      expect(text, `${where} contains a hyphen minus`).not.toContain(HYPHEN_MINUS);
      expect(text, `${where} contains an en dash`).not.toContain(EN_DASH);
      expect(text, `${where} contains an em dash`).not.toContain(EM_DASH);
    }
  });

  it("uses no first person", () => {
    for (const { where, text } of allStrings()) {
      for (const pattern of FIRST_PERSON) expect(pattern.test(text), `${where} uses the first person`).toBe(false);
    }
  });

  it("uses the public rating name SPR and never a retired internal name", () => {
    for (const { where, text } of allStrings()) {
      expect(text, `${where} names a retired rating`).not.toMatch(/\b(BPR|VPR|Sigma1)\b/);
    }
  });

  it("keeps every paragraph, caption and list item to at most three sentences", () => {
    for (const { where, text } of allParagraphs()) {
      expect(sentenceCount(text), `${where} runs past three sentences`).toBeLessThanOrEqual(3);
    }
  });
});
