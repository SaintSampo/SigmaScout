/**
 * Content coverage for `districtLedgerContent.ts` (phase 10 plan 08).
 *
 * The same three jobs, in the same deliberately different styles, as
 * `awardsContent.test.ts`, and for the same recorded reasons.
 *
 * STRUCTURE is pinned BY EQUALITY against a hand typed literal array, never by
 * iterating the exported constant. This repo has a recorded iteration list
 * trap: a test that iterates a list silently absorbs a newly added entry.
 *
 * VOICE is asserted at RUNTIME over the exported string VALUES, never grepped
 * from source, because the content module's own doc comments legitimately use
 * dashes. The collector builds `{ where, text }` records so a failure names
 * the string that broke the rule.
 *
 * NUMBERS are pinned as substrings. Every figure either page states was
 * measured by committed code, and `REQUIRED_FIGURES` carries a comment naming
 * the generating source for each group. Pinning them means a prose rewrite
 * cannot quietly drop a sample size or drift a percentage away from what the
 * committed constant holds. If a measurement is rerun and a number moves, this
 * test failing is the CORRECT outcome: update the prose and this list together.
 */
import { describe, expect, it } from "vitest";
import {
  DISTRICT_LEDGER_LEAD,
  DISTRICT_LEDGER_PAGE_TITLE,
  DISTRICT_LEDGER_SECTION_IDS,
  DISTRICT_LEDGER_SECTIONS,
  type DistrictLedgerTable,
} from "./districtLedgerContent.js";

const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";
const PLUS_MINUS = "±";

/**
 * The six section ids, hand typed, in render order. Changing
 * `DISTRICT_LEDGER_SECTIONS` without changing this is the failure caught here.
 */
const EXPECTED_SECTION_IDS = [
  "how-district-points-work",
  "how-open-categories-are-predicted",
  "the-alliance-selection-model",
  "award-base-rates",
  "how-well-the-bracket-pricer-works",
  "what-this-does-not-model",
];

/**
 * Every measured figure the page states, as it reads on the page.
 *
 * Sources, one group per generating command:
 *   - the reconciliation counts and the point values:
 *     `npx vitest run packages/core/districts/pointFormulas.reconciliation.test.ts`
 *     (10-01), whose qualification, selection and playoff blocks assert these
 *     populations against real TBA reported values.
 *   - the district championship weight: the same test's divisioned block, whose
 *     observations are recorded as base values "divided by the 3x DCMP weight"
 *     (10-01-SUMMARY).
 */
const REQUIRED_FIGURES = [
  // Qualification block: 29,796 checked, 0 mismatches.
  "29,796",
  // Alliance selection block: 20,209 checked, 0 mismatches.
  "20,209",
  // Playoff block: 478 brackets routed, 10,278 values checked, 0 mismatches.
  "478",
  "10,278",
  "0 mismatches",
  // selectionPoints.ts, exhaustive over all 32 slot by alliance combinations.
  "17 minus the alliance number",
  // PLAYOFF_PLACEMENT_POINTS in bracket.ts: [30, 20, 13, 7, 0, 0, 0, 0].
  "30 for first",
  "20 for second",
  "13 for third",
  "7 for fourth",
  // districtTierWeight: the DCMP weight is 3 in every registered season.
  "three times",

  // --- `pnpm measure:selection-agreement` ---------------------------------
  // `npx tsx scripts/measureSelectionAgreement.ts --captain-seasons 2023-2026
  //  --seasons 2026 --warmup-from 2026`, run 2026-09-25. Cross checked against
  // the exported MEASURED_* constants beside that script and, for the captain
  // half, against selectionModel.reconciliation.test.ts's own assertions.
  "485 events",
  "3,879 of 3,880", // MEASURED_PROGRESSIVE_CORRECT_SLOTS of MEASURED_CAPTAIN_SLOTS
  "99.97%",
  "976 of 3,880", // MEASURED_NAIVE_CORRECT_SLOTS, the labelled baseline
  "25.15%",
  "3.75%", // MEASURED_CAPTAIN_COIN_FLOOR
  "2,256 turns", // MEASURED_PICK_TURNS
  "32.62%", // MEASURED_EXACT_AGREEMENT
  "5.90%", // MEASURED_POOLED_COIN_FLOOR
  "1,128 turns", // MEASURED_FIRST_PICK_TURNS and MEASURED_SECOND_PICK_TURNS
  "42.91%", // MEASURED_FIRST_PICK_EXACT_AGREEMENT
  "3.95%", // MEASURED_FIRST_PICK_COIN_FLOOR
  "22.34%", // MEASURED_SECOND_PICK_EXACT_AGREEMENT — the figure 10-02 forbids softening
  "7.85%", // MEASURED_SECOND_PICK_COIN_FLOOR
  "60.51%", // MEASURED_TOP3_AGREEMENT
  "2026milac", // MEASURED_PROGRESSIVE_MISSES, the single named miss
  "position 4", // MEASURED_MEDIAN_MODEL_RANK, second picks (10-02's PICK-ORDER block)
  "position 2", // the same block's first pick median

  // --- `pnpm measure:alliance-win-probability` ----------------------------
  // `npx tsx scripts/measureAllianceWinProbability.ts --seasons 2026
  //  --warmup-from 2026`, run 2026-09-25. Cross checked against the exported
  // MEASURED_* constants beside that script.
  "19,792", // MEASURED_SCORED_ROWS
  "0.0552", // MEASURED_MEAN_ABSOLUTE_GAP
  "0.0417", // MEASURED_MEDIAN_ABSOLUTE_GAP
  "0.1224", // MEASURED_P90_ABSOLUTE_GAP
  "4.44%", // MEASURED_WINNER_DISAGREEMENT_RATE
  "0.1462", // MEASURED_BROWSER_FORMULA_BRIER
  "0.1443", // MEASURED_PUBLISHED_BRIER
  "0.2494", // MEASURED_COIN_BRIER
  "0.2112", // MEASURED_SIGN_ONLY_BRIER

  // --- the recorded limits ------------------------------------------------
  // 10-06's districtBake.test.ts prints the seed to seed spread at the
  // production draw budget; DISTRICT_BAKE_SCHEDULE_COUNT x
  // DISTRICT_BAKE_DRAWS_PER_SCHEDULE is the 4,000.
  "4,000 draws",
  "0.03525",

  // --- `SIMULATION_DRAWS` ------------------------------------------------
  // `apps/web/src/workers/simulationProtocol.ts` exports the one draw count
  // every browser simulation on this site shares. The advancement chance is a
  // share of exactly that many runs, so the page states the constant.
  "1,000 runs",

  // --- `pnpm measure:award-ordering-tables` -------------------------------
  // `npx tsx scripts/measureAwardOrderingTables.ts`, run 2026-09-25. Both
  // figures are printed by that script's PRACTICAL ANSWER block for season
  // 2026 and cross checked against the committed literals in
  // `packages/core/districts/awardOrderingTables.ts`. Their full statement,
  // the remaining positions and the sample sizes live on the Predicting awards
  // page; this page states only the two that name the mechanism.
  "18.0%", // Impact, position 1 in the most decorated ordering
  "38.1%", // Rookie All Star, rookie position 1
];

/**
 * The seven recorded limitations, by their own row labels, hand typed. A later
 * edit cannot drop one without turning this red. Sources: 10-04 records the
 * first three in `ledgerSimulation.ts`, 10-06 the next three in
 * `districtBake.ts` and `publishDistricts.ts`, and 10-05 the last in
 * `districtRefresh.ts`'s module header.
 */
const EXPECTED_LIMITS = [
  "Declines are not modelled",
  "The award draw does not depend on how a team did on the field",
  "The district level award table is applied at the district championship too",
  "An event nobody has played is priced from each team's current rating over generated schedules",
  "Every baked number's resolution is set by its draw count",
  "An event whose awards are posted can still read as open",
  "Awards posted after every event in the district has finished wait for the next offline republish",
];

/** A retired name or a retired piece of vocabulary must never reach a public page. */
const RETIRED_VOCABULARY: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "the retired internal rating name BPR", pattern: /\bBPR\b/ },
  { label: "the retired internal rating name VPR", pattern: /\bVPR\b/ },
  { label: "the retired internal rating name Sigma1", pattern: /\bSigma1\b/ },
  { label: "the deleted Swing vocabulary", pattern: /\bSwing\b/i },
  { label: "a spread, which must never render", pattern: /\bspread\b/i },
];

/** No singular first person anywhere on a public page. */
const FIRST_PERSON: readonly RegExp[] = [/\bI\b/, /\bmy\b/i];

function tableStrings(where: string, table: DistrictLedgerTable | undefined): { where: string; text: string }[] {
  if (table === undefined) return [];
  const out: { where: string; text: string }[] = [];
  if (table.caption !== undefined) out.push({ where: `${where}.table.caption`, text: table.caption });
  table.head.forEach((text, i) => out.push({ where: `${where}.table.head[${i}]`, text }));
  table.rows.forEach((row, r) => row.forEach((text, c) => out.push({ where: `${where}.table.rows[${r}][${c}]`, text })));
  return out;
}

function allStrings(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [
    { where: "DISTRICT_LEDGER_PAGE_TITLE", text: DISTRICT_LEDGER_PAGE_TITLE },
    { where: "DISTRICT_LEDGER_LEAD", text: DISTRICT_LEDGER_LEAD },
  ];
  for (const section of DISTRICT_LEDGER_SECTIONS) {
    out.push({ where: `${section.id}.heading`, text: section.heading });
    section.paragraphs.forEach((text, i) => out.push({ where: `${section.id}.paragraphs[${i}]`, text }));
    out.push(...tableStrings(section.id, section.table));
  }
  return out;
}

/** Every paragraph on the page, with the section it belongs to. */
function allParagraphs(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [{ where: "DISTRICT_LEDGER_LEAD", text: DISTRICT_LEDGER_LEAD }];
  for (const section of DISTRICT_LEDGER_SECTIONS) {
    section.paragraphs.forEach((text, i) => out.push({ where: `${section.id}.paragraphs[${i}]`, text }));
  }
  return out;
}

/**
 * Sentence terminating periods only: a period followed by whitespace or by the
 * end of the string. A decimal point inside a figure is therefore not counted.
 */
function sentenceCount(text: string): number {
  return (text.match(/\.(\s|$)/g) ?? []).length;
}

describe("districtLedgerContent structure", () => {
  it("exports the six section ids in order, by equality", () => {
    expect([...DISTRICT_LEDGER_SECTION_IDS]).toEqual(EXPECTED_SECTION_IDS);
  });

  it("renders the sections in exactly the declared id order, by equality", () => {
    expect(DISTRICT_LEDGER_SECTIONS.map((section) => section.id)).toEqual(EXPECTED_SECTION_IDS);
  });

  it("gives every section a non blank heading and at least one paragraph", () => {
    for (const section of DISTRICT_LEDGER_SECTIONS) {
      expect(section.heading.trim().length, `${section.id} has a blank heading`).toBeGreaterThan(0);
      expect(section.paragraphs.length, `${section.id} has no paragraphs`).toBeGreaterThan(0);
      for (const paragraph of section.paragraphs) {
        expect(paragraph.trim().length, `${section.id} has a blank paragraph`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every table rectangular: each row as wide as the head, no blank cell", () => {
    for (const section of DISTRICT_LEDGER_SECTIONS) {
      const table = section.table;
      if (table === undefined) continue;
      expect(table.head.length, `${section.id} has a table with no head`).toBeGreaterThan(0);
      for (const row of table.rows) {
        expect(row.length, `${section.id} row "${row[0]}" width`).toBe(table.head.length);
        for (const cell of row) expect(cell.trim().length, `${section.id} has a blank cell`).toBeGreaterThan(0);
      }
    }
  });

  it("carries no regular expression metacharacter in the title, because the hub test builds a RegExp from card titles", () => {
    expect(DISTRICT_LEDGER_PAGE_TITLE).not.toMatch(/[.*+?^${}()|[\]\\]/);
  });

  it("states exactly the seven recorded limitations, by equality against a hand typed literal", () => {
    const limits = DISTRICT_LEDGER_SECTIONS.find((section) => section.id === "what-this-does-not-model");
    expect(limits, "the limits section is gone from the page").toBeDefined();
    expect(limits?.table?.rows.map((row) => row[0])).toEqual(EXPECTED_LIMITS);
  });
});

describe("districtLedgerContent voice", () => {
  it("contains no hyphen minus in any exported string", () => {
    for (const { where, text } of allStrings()) {
      expect(text, `${where} contains a hyphen minus`).not.toContain(HYPHEN_MINUS);
    }
  });

  it("contains no en dash in any exported string", () => {
    for (const { where, text } of allStrings()) {
      expect(text, `${where} contains an en dash`).not.toContain(EN_DASH);
    }
  });

  it("contains no em dash in any exported string", () => {
    for (const { where, text } of allStrings()) {
      expect(text, `${where} contains an em dash`).not.toContain(EM_DASH);
    }
  });

  it("never prints a plus minus sign, on this page as on the tab", () => {
    for (const { where, text } of allStrings()) {
      expect(text, `${where} prints a plus minus sign`).not.toContain(PLUS_MINUS);
    }
  });

  it("names no retired rating and no retired vocabulary", () => {
    for (const { where, text } of allStrings()) {
      for (const { label, pattern } of RETIRED_VOCABULARY) {
        expect(pattern.test(text), `${where} names ${label}`).toBe(false);
      }
    }
  });

  it("uses no singular first person", () => {
    for (const { where, text } of allStrings()) {
      for (const pattern of FIRST_PERSON) {
        expect(pattern.test(text), `${where} uses the singular first person`).toBe(false);
      }
    }
  });

  it("keeps every paragraph to at most three sentences", () => {
    for (const { where, text } of allParagraphs()) {
      expect(sentenceCount(text), `${where} runs past three sentences`).toBeLessThanOrEqual(3);
    }
  });
});

describe("districtLedgerContent figures", () => {
  it("states every measured figure its committed sources produced", () => {
    const pageText = allStrings()
      .map((entry) => entry.text)
      .join("\n");
    for (const figure of REQUIRED_FIGURES) {
      expect(pageText, `the page no longer states ${figure}`).toContain(figure);
    }
  });
});
