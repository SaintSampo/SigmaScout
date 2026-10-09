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

  // --- the stacked-award fold (quick task 260925-uf8) ---------------------
  // `npx vitest run packages/core/districts/awardOrderingTables.test.ts`, whose
  // "costs at most the 0.022 of a point" case walks every 2026 rate and pins the
  // ceiling this page states.
  "0.022 of a point",

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
  //  --warmup-from 2026`, run 2026-10-05 (re-recorded after that day's ingest). Cross checked against the exported
  // MEASURED_* constants beside that script.
  "20,371", // MEASURED_SCORED_ROWS
  "0.0555", // MEASURED_MEAN_ABSOLUTE_GAP
  "0.0420", // MEASURED_MEDIAN_ABSOLUTE_GAP
  "0.1225", // MEASURED_P90_ABSOLUTE_GAP
  "4.53%", // MEASURED_WINNER_DISAGREEMENT_RATE
  "0.1469", // MEASURED_BROWSER_FORMULA_BRIER
  "0.1450", // MEASURED_PUBLISHED_BRIER
  "0.2494", // MEASURED_COIN_BRIER
  "0.2123", // MEASURED_SIGN_ONLY_BRIER

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
  // `npx tsx scripts/measureAwardOrderingTables.ts`, Impact rows re-run
  // 2026-09-29 under the Impact first ordering (quick task 260929-imp). Both
  // figures are printed by that script's PRACTICAL ANSWER block for season
  // 2026 and cross checked against the committed literals in
  // `packages/core/districts/awardOrderingTables.ts`. Their full statement,
  // the remaining positions and the sample sizes live on the Predicting awards
  // page; this page states only the two that name the mechanism.
  "earlier Impact wins, ties broken by earlier judged awards", // the Impact ordering itself
  "Impact 26.1%", // Impact, position 1 in the Impact ordering (26.06%, 197 of 756)
  "38.1%", // Rookie All Star, rookie position 1

  // --- `pnpm measure:champ-cutoff` ----------------------------------------
  // `npx tsx scripts/measureChampCutoff.ts`, re-run 2026-10-07 after the
  // rail's same week tie break let 2022isr score (fast task following quick
  // task 261007-jvz; first on the district tier lock floor 2026-10-05, quick
  // tasks 260927-6bf and 261005-04t). Its WALK-FORWARD TUNED LINES block:
  // simulated MAE 17.8 and same position naive MAE 40.5, n = 69 with no
  // season skipped; printed range coverage reads 49 of 69 (71.0%).
  "17.8 points",
  "40.5",
  "69 district seasons",
  "49 of 69 seasons, 71%",

  // --- `pnpm measure:district-cutoff` -------------------------------------
  // `npx tsx scripts/measureDistrictCutoff.ts`, run 2026-10-07 (quick task
  // 261007-jvz, after its finality cascade; first run fast task 261006). Its
  // All positions line: simulated MAE 1.2 and midpoint rule MAE 1.8 against
  // the settled cutoff (gate line 1: 1.15 against midpoint MAE 1.77), n = 203
  // positions over 47 district seasons; gate line 2 reads 181 of 203 (89.2%).
  "47 district seasons",
  "1.2 points on average over 203 positions",
  "1.8 for the midpoint rule",
  "181 of those 203 positions, 89%",
];

/**
 * The nine recorded limitations, by their own row labels, hand typed. A later
 * edit cannot drop one without turning this red. Sources: 10-04 and quick task
 * 261007-4qr record the first four in `ledgerSimulation.ts` (the fourth is
 * the short roster rule, `draftedAllianceCount`); 10-06 the next three in
 * `districtBake.ts` and `publishDistricts.ts`, with quick task 260928-p8i
 * (SPR 9.0.0) adding the rookie rule's rating of a team with no result yet
 * (`packages/harness/sigmaCarry.ts`) among them; and 10-05 the rest in
 * `districtRefresh.ts`'s module header.
 */
const EXPECTED_LIMITS = [
  "Declines are not modelled",
  "The award draw does not depend on how a team did on the field",
  "The district level award table is applied at the district championship too",
  "Under 24 teams, the simulation seats whole alliances from the top seed down and the rest forfeit",
  "An event nobody has played is priced from each team's current rating over generated schedules",
  "A team with no result yet this season is rated as SPR rates a team it has not seen",
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

  it("states exactly the recorded limitations, by equality against a hand typed literal", () => {
    const limits = DISTRICT_LEDGER_SECTIONS.find((section) => section.id === "what-this-does-not-model");
    expect(limits, "the limits section is gone from the page").toBeDefined();
    expect(limits?.table?.rows.map((row) => row[0])).toEqual(EXPECTED_LIMITS);
  });

  it("states no count in the limits paragraph or the limits caption, so the count cannot drift from the table (todo methodology-limits-table-count)", () => {
    const limits = DISTRICT_LEDGER_SECTIONS.find((section) => section.id === "what-this-does-not-model");
    expect(limits, "the limits section is gone from the page").toBeDefined();
    const texts = [...(limits?.paragraphs ?? []), limits?.table?.caption ?? ""];
    const countWord = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
    for (const text of texts) {
      expect(text, `"${text}" states a count in digits`).not.toMatch(/\d/);
      expect(text, `"${text}" states a count in words`).not.toMatch(countWord);
    }
  });
});

describe("districtLedgerContent: the rewound view and the championship field (261005-04t)", () => {
  const paragraphsOf = (id: string) => DISTRICT_LEDGER_SECTIONS.find((section) => section.id === id)?.paragraphs ?? [];

  it("states, directly after the award lock paragraph, what a rewound District Locks view counts and what Live shows once the championship starts", () => {
    const paragraphs = paragraphsOf("how-district-points-work");
    const anchor = paragraphs.findIndex((text) => text.startsWith("A team is also Locked when"));
    expect(anchor).toBeGreaterThan(-1);
    // The joint proof paragraph (quick task 261009-2tr) follows the pooled
    // Locked paragraph directly, then the settled playoffs paragraph (quick
    // task 261008-26o), then these two.
    expect(paragraphs[anchor + 1]).toBe(
      "Once the District Championship alliances are picked, Locked on the Champ Locks tab also counts, for each team, the most rivals that can pass it or take a slot from it in any way the bracket and the awards can still fall, counting each rival once, and locks the team when that count is below the open slots."
    );
    expect(paragraphs[anchor + 2]).toBe(
      "A team knocked out of the playoffs has its playoff points settled as soon as its alliance's place in the bracket is decided. From then on Locked allows it no more playoff points than that place pays, and counts them as earned once The Blue Alliance posts them."
    );
    expect(paragraphs.slice(anchor + 3, anchor + 5)).toEqual([
      "On the District Locks tab, Locked and Locked out at a rewound point count only the district event points a team had earned by then, never District Championship points.",
      "Once the District Championship has started, the live District Locks view shows who is in its field. A team in the field reads Locked, a team that earned a place and is not in the field reads Declined, and every other team reads Locked out.",
    ]);
  });

  it("closes the open categories section with the as-of rule and the playoff stops, and nothing says a rewound view knows more (261005-5g0, 261007-3g2)", () => {
    const paragraphs = paragraphsOf("how-open-categories-are-predicted");
    expect(paragraphs[paragraphs.length - 1]).toBe(
      "A rewound view predicts every match still ahead from the ratings and odds as they stood at that stop. An event whose schedule was not yet posted then is predicted over generated schedules, as an event that has not started is. A playoff stop, Round 1 to Round 5 or Finals, keeps the real result of every set played by then and predicts the rest."
    );
    for (const section of DISTRICT_LEDGER_SECTIONS) {
      for (const text of section.paragraphs) expect(text).not.toMatch(/know more|knows more/);
    }
  });

  it("describes the open cell grammar and the Playoffs cell's milestones and not picked case (261008-3il)", () => {
    const paragraphs = paragraphsOf("how-open-categories-are-predicted");
    expect(paragraphs.find((text) => text.startsWith("An open cell shows"))).toBe(
      "An open cell shows either a median with a likely range, or a chance followed by the outcome it measures, with the points that outcome pays on the line beneath. Likely means the 10th to the 90th percentile, and no chance is ever printed as 100 percent."
    );
    expect(paragraphs.find((text) => text.startsWith("The Playoffs cell asks"))).toBe(
      "The Playoffs cell asks about the milestone the bracket has actually reached: the top four before the playoffs, the final once an alliance can no longer finish worse than fourth, and the win once it is in the final. An alliance whose placement is already settled shows the points that placement pays. A team on no alliance once alliance selection is over reads not picked, and only a backup call can still earn it playoff points."
    );
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
