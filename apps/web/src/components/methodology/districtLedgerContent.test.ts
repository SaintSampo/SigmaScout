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
  // Playoff block: 491 brackets routed, 10,547 values checked, 0 mismatches
  // (re-measured 2026-10-09, quick task 261009-tx8: no bracket left unresolved).
  "491",
  "10,547",
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

  // --- `pnpm measure:award-slate` (quick task 261014-qje) -----------------
  // `npx tsx scripts/measureAwardSlate.ts`, run 2026-10-14 and saved as
  // `261014-qje-measure.txt`. Its DISTRICT TIER 2026 block prints the 2026
  // expected counts per district event: impact 0.9709, engineeringInspiration
  // 0.9806, rookieAllStar 0.9091 (over events with a rookie), judged 11.7087.
  // Its DISTRICT POINT AWARD CENSUS checks 29871 team events with 0 mismatches.
  "0.97 Impact awards",
  "0.98 Engineering Inspiration awards",
  "11.71 other team awards",
  "0.91 Rookie All Star awards",
  "29,871 rows, 0 mismatches",

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

  // --- `pnpm measure:champ-cutoff` ----------------------------------------
  // `npx tsx scripts/measureChampCutoff.ts`, re-run 2026-10-14 by quick task
  // 261014-qje on freshly composed artifacts after the award draws moved onto
  // the award slate (saved as `261014-qje-champ-cutoff-after.txt`). Its
  // WALK-FORWARD TUNED LINES block: simulated MAE 17.6 (gate line 2: 17.58)
  // and same position naive MAE 39.0 (gate line 3: 39.03), n = 69 with no
  // season skipped; printed range coverage reads 48 of 69 (69.6%). The run
  // before it read 17.8, 40.5 and 49 of 69 (71.0%).
  "17.6 points",
  "39.0 for the midpoint rule",
  "69 district seasons",
  "48 of 69 seasons, 70%",

  // --- `pnpm measure:district-cutoff` -------------------------------------
  // `npx tsx scripts/measureDistrictCutoff.ts`, run 2026-10-14 (quick task
  // 261014-hx6, on the as-of path at spr@11.0.0+baseline; the 2026-10-07
  // stored odds run read 1.15 against 1.77 and 181 of 203, retired because it
  // priced open events with odds from after the stop). Its All positions
  // line: simulated MAE 1.2 and midpoint rule MAE 1.9 against the settled
  // cutoff (gate line 1: 1.20 < 1.93, n = 205, PASS), n = 205 positions over
  // 48 district seasons; gate line 2 reads 179 of 205 (87.3%), PASS inside
  // the 72% to 88% band. Re-measured after the weighted pick draft
  // (261014-ol6) and the joint event draws (261014-qv2).
  "48 district seasons",
  "1.2 points on average over 205 positions",
  "1.9 for the midpoint rule",
  "179 of those 205 positions, 87%",
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
  "An award in its first season is priced like the other awards worth the same points",
  "Under 24 teams, the simulation seats whole alliances from the top seed down and the rest forfeit",
  "An event nobody has played is priced from each team's current rating over generated schedules",
  "A team with no result yet this season is rated as SPR rates a team it has not seen",
  "Every baked number's resolution is set by its draw count",
  "An event whose awards are posted can still read as open",
  "Awards are picked up for a day after an event's last match",
  "A Locked waits until an event's Impact award is listed and its award list has been unchanged for an hour",
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
    // task 261008-26o), then the secured playoff points paragraph (quick task
    // 261012-mw2), then these two.
    expect(paragraphs[anchor + 1]).toBe(
      "Once the District Championship alliances are picked, Locked on the Champ Locks tab also counts, for each team, the most rivals that can pass it or take a slot from it in any way the bracket and the awards can still fall, counting each rival once, and locks the team when that count is below the open slots. A championship played in divisions counts every division's bracket and the finals between the division winners. A district with two championships counts both of them."
    );
    expect(paragraphs[anchor + 2]).toBe(
      "A team knocked out of the playoffs has its playoff points settled as soon as its alliance's place in the bracket is decided. From then on Locked allows it no more playoff points than that place pays, and counts them as earned once The Blue Alliance posts them. Until The Blue Alliance posts the number, the grey value reads up to the points that place pays."
    );
    expect(paragraphs[anchor + 3]).toBe(
      "A team still playing in the playoffs is credited the playoff points its wins have already secured, before The Blue Alliance posts them. The Blue Alliance shares an alliance's playoff points among its robots by the wins each was on the field for, so a robot that sat out a win has secured less. An open Playoffs cell reads at least that many points, and the earned figure beside the team counts them."
    );
    expect(paragraphs.slice(anchor + 4, anchor + 6)).toEqual([
      "On the District Locks tab, Locked and Locked out at a rewound point count only the district event points a team had earned by then, never District Championship points.",
      "Once the District Championship has started and its points are posted for its whole field, the live District Locks view shows who is in its field. A team in the field reads Locked, a team that earned a place and is not in the field reads Declined, and every other team reads Locked out.",
    ]);
  });

  it("says once, directly after the settled playoffs paragraph, that a team still playing is credited what its wins have secured, and that a robot is paid by wins (261012-mw2)", () => {
    const paragraphs = paragraphsOf("how-district-points-work");
    const settled = paragraphs.findIndex((text) => text.startsWith("A team knocked out of the playoffs has its playoff points settled"));
    expect(settled).toBeGreaterThan(-1);
    const secured = paragraphs[settled + 1]!;
    expect(secured.startsWith("A team still playing in the playoffs is credited the playoff points its wins have already secured")).toBe(true);
    // Three sentences, no hyphen or dash of any kind, no tilde, no digit and no percentage.
    expect(secured.split(". ")).toHaveLength(3);
    expect(secured).not.toMatch(/[-‐-―−~%\d]/);
    // The rule is by WINS, never by matches played: the wording must not teach the refuted rule.
    expect(secured).toContain("by the wins each was on the field for");
    expect(secured).not.toMatch(/matches? (it|they|a team|a robot) (has |have )?played/);
    // The words the tab itself prints.
    expect(secured).toContain("reads at least that many points");
    expect(secured).toContain("the earned figure beside the team counts them");
    // Said once in the whole page.
    const everyParagraph = DISTRICT_LEDGER_SECTIONS.flatMap((section) => section.paragraphs);
    expect(everyParagraph.filter((text) => text.includes("its wins have already secured"))).toHaveLength(1);
    expect(everyParagraph.filter((text) => text.includes("sat out a win"))).toHaveLength(1);
  });

  it("says a championship played in divisions adds the finals points to the District Championship row once they are earned (261009-tx8)", () => {
    const paragraphs = paragraphsOf("how-district-points-work");
    expect(paragraphs.find((text) => text.startsWith("The Champ Locks tab predicts each team's finish"))).toBe(
      "The Champ Locks tab predicts each team's finish in the race for the district's FIRST Championship slots, adding the District Championship's own four categories to the district season total. Only the grand total folds in the chance of being there. A championship played in divisions adds the finals points to the District Championship row once they are earned."
    );
  });

  it("says, directly after the live view paragraph, that a team not yet listed at a championship can still attend until its whole field is posted (261010-66y)", () => {
    const paragraphs = paragraphsOf("how-district-points-work");
    const live = paragraphs.findIndex((text) => text.startsWith("On the live view, until the championship field is set"));
    expect(live).toBeGreaterThan(-1);
    expect(paragraphs[live + 1]).toBe("Until a championship's points are posted for its whole field, a team not yet listed there is still treated as able to attend.");
    expect(paragraphs[live + 1]).not.toMatch(/[-‐-―−~]/);
    // It is the section's last paragraph, and it is said once.
    expect(live + 1).toBe(paragraphs.length - 1);
    const everyParagraph = DISTRICT_LEDGER_SECTIONS.flatMap((section) => section.paragraphs);
    expect(everyParagraph.filter((text) => text.includes("still treated as able to attend"))).toHaveLength(1);
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

  it("says a category counts as settled once its points are posted, directly after the settled category sentence (261009-vp9)", () => {
    const paragraphs = paragraphsOf("how-open-categories-are-predicted");
    expect(paragraphs.find((text) => text.startsWith("A category that is already settled"))).toBe(
      "A category that is already settled shows the points the team earned, not a prediction. A category counts as settled once its points are posted. An event nobody has played yet is priced by the pipeline before the season, and the browser computes nothing for it."
    );
  });

  it("states in the Limits row what a Locked waits for, naming every award (261009-vp9)", () => {
    const limits = DISTRICT_LEDGER_SECTIONS.find((section) => section.id === "what-this-does-not-model");
    const row = limits?.table?.rows.find((entry) => entry[0]?.startsWith("A Locked waits"));
    expect(row).toEqual([
      "A Locked waits until an event's Impact award is listed and its award list has been unchanged for an hour",
      "Until then the places that event's awards can take stay held back. At a district championship the wait also covers the Winner, Engineering Inspiration and Rookie All Star awards. An event missing its Impact award, or a district championship missing its Winner, Engineering Inspiration or Rookie All Star award, is read after twelve unchanged hours.",
    ]);
    // The awards are named: the cell never says "them".
    expect(row?.[1]).not.toMatch(/\bthem\b/);
  });

  it("describes the open cell grammar, the Playoffs best guess finish and the not picked case (261014-i1c, 261014-jfx)", () => {
    const paragraphs = paragraphsOf("how-open-categories-are-predicted");
    expect(paragraphs.find((text) => text.startsWith("An open cell shows"))).toBe(
      "An open cell shows either a median with a likely range, or a chance followed by the outcome it measures, with the points that outcome pays on the line beneath. The Playoffs cell names a finish instead, as the next paragraph describes. Likely means the 10th to the 90th percentile, and no chance is ever printed as 100 percent."
    );
    expect(paragraphs.find((text) => text.startsWith("The Playoffs cell names"))).toBe(
      "The Playoffs cell names a best guess finish: 1st, 2nd, 3rd or 4th, or 5th to 8th. Third and fourth are one finish, and fifth to eighth are another. The best guess is the finish that came up in the most runs, and a tie goes to the better finish."
    );
    expect(paragraphs.find((text) => text.startsWith("The line beneath gives"))).toBe(
      "The line beneath gives the share of runs that ended there and the points that finish pays. A finish the bracket has already ruled out is never the best guess. Where the cell adds up more than one event, as the Champ Locks District points row does, no one finish describes it, and the cell shows a median with a likely range instead."
    );
    expect(paragraphs.find((text) => text.startsWith("An alliance whose placement is already settled"))).toBe(
      "An alliance whose placement is already settled shows the points that placement pays. A team on no alliance once alliance selection is over reads not picked, and only a backup call can still earn it playoff points. Before then, a team left off every alliance in more than half of the runs reads not picked, with its chance of being on an alliance on the line beneath."
    );
    expect(paragraphs.find((text) => text.startsWith("Where the runs report"))).toBe(
      "Where the runs report which teams were left off every alliance, fifth to eighth means picked but out of the top four. At an event that has not started, fifth to eighth also counts the runs that left the team off every alliance."
    );
    // The new paragraph sits directly after the alliance paragraph.
    const settled = paragraphs.findIndex((text) => text.startsWith("An alliance whose placement is already settled"));
    expect(paragraphs[settled + 1]).toBe(
      "Where the runs report which teams were left off every alliance, fifth to eighth means picked but out of the top four. At an event that has not started, fifth to eighth also counts the runs that left the team off every alliance."
    );
    expect(paragraphs.find((text) => text.startsWith("An elimination match already played"))).toBe(
      "An elimination match already played is taken as played rather than priced again, so every run starts from the bracket as it stands. The best guess and its chance therefore move as the playoffs go on."
    );
    expect(paragraphs.find((text) => text.startsWith("The Playoffs list keeps"))).toBe(
      "The Playoffs list keeps third and fourth on separate rows, and its headline names the same best guess as the cell."
    );
    // The superseded milestone wording is gone from the page.
    expect(paragraphs.join(" ")).not.toMatch(/the milestone the bracket has actually reached|top four before the playoffs/);
  });
});

describe("districtLedgerContent: the weighted draft (261014-ol7)", () => {
  it("says each pick is drawn from the pick table and names the Predicting alliance picks page, directly after the captain rule", () => {
    const section = DISTRICT_LEDGER_SECTIONS.find((entry) => entry.id === "the-alliance-selection-model")!;
    expect(section.paragraphs[0]).toBe(
      "The captain at each alliance's turn is the highest ranked team not yet on an alliance. The draft runs alliance 1 through alliance 8 and then alliance 8 back down to alliance 1.",
    );
    expect(section.paragraphs[1]).toBe(
      "Each pick is drawn from a table of where real picks sat in the line of teams still available, sorted by rating. That table and how it scores are on the Predicting alliance picks page.",
    );
    const pageText = allStrings()
      .map((entry) => entry.text)
      .join(" ");
    expect(pageText).not.toMatch(/taken in rating order/);
  });

  it("keeps the agreement table, which measures the rating order list itself", () => {
    const section = DISTRICT_LEDGER_SECTIONS.find((entry) => entry.id === "the-alliance-selection-model")!;
    expect(section.table?.caption).toBe("Measured against the real draft");
    expect(section.table?.rows.map((row) => row[0])).toContain("Pick order, exact agreement, 2,256 turns in 2026");
  });
});

describe("districtLedgerContent: the one award slate (261014-qje)", () => {
  const section = () => DISTRICT_LEDGER_SECTIONS.find((entry) => entry.id === "award-base-rates")!;

  it("keeps the award section's id and states the slate, by equality", () => {
    expect(section().heading).toBe("How awards are predicted");
    expect(section().paragraphs).toEqual([
      "Each event gives a known number of each award. The awards are shared among the teams that can win them. District events and District Championships are priced the same way.",
      "The number of each award is how many an event gave on average in the most recent earlier season. Only the awards on FIRST's list for the season count, so an award FIRST retired adds nothing.",
      "In 2026 a district event was expected to give 0.97 Impact awards, 0.98 Engineering Inspiration awards and 11.71 other team awards. An event with a rookie was expected to give 0.91 Rookie All Star awards.",
      "Engineering Inspiration goes only to veterans, and Rookie All Star only to rookies. A team that won Impact, Engineering Inspiration or Rookie All Star at an earlier district event that season cannot win the same award at a later one. At a District Championship those three awards go only to teams that won the same award at a district event that season.",
      "A team's share rests on how often teams with the same award record won before, in earlier seasons only. For Impact, earlier Impact wins count first and other earlier team awards second. An award record counts every team award that pays district points, won at any event in an earlier season.",
      "The prediction gives a team at most one award at an event, its highest. The weights and their sample sizes are on the Predicting awards page.",
      "No award prediction moves a team's status. A Locked verdict stays a guarantee.",
      "A team with no published award profile is priced as a veteran with no earlier awards.",
      "One qualification slot is held back for every district event whose Impact award is still to come. The Impact winner at a district event takes a slot, so a team is never told it is Locked on a slot an award is about to claim. A slot held back this way returns to the points race as soon as that award is posted.",
    ]);
  });

  it("states the award points in the categories table and the slate in the open categories table", () => {
    const points = DISTRICT_LEDGER_SECTIONS.find((entry) => entry.id === "how-district-points-work")!;
    expect(points.table?.rows.find((row) => row[0] === "Awards")).toEqual([
      "Awards",
      "Each team award a team wins at the event pays: 10 for Impact, 8 for Engineering Inspiration or Rookie All Star, and 5 for any other team award that pays points.",
      "29,871 rows, 0 mismatches",
    ]);
    const open = DISTRICT_LEDGER_SECTIONS.find((entry) => entry.id === "how-open-categories-are-predicted")!;
    expect(open.table?.rows.find((row) => row[0] === "Awards")).toEqual([
      "Awards",
      "Each event has an expected number of each award, shared among the teams that can win it by how teams like it have won before. District events and District Championships work the same way.",
    ]);
    expect(open.paragraphs.find((text) => text.startsWith("The Champ Locks tab reads its predicted cutoff"))).toBe(
      "The Champ Locks tab reads its predicted cutoff the same way, except that each team's district points are drawn on their own. In each run the District Championship winning alliance and its Impact, Engineering Inspiration and Rookie All Star winners are also drawn and take their slots first, and the line is read from the teams left. The draws pick award winners the same way the award cells are priced.",
    );
  });

  it("names no part of the retired per team award model anywhere on the page", () => {
    const pageText = allStrings()
      .map((entry) => entry.text)
      .join("\n");
    expect(pageText).not.toMatch(/base rate/i);
    expect(pageText).not.toMatch(/judged award/i);
    expect(pageText).not.toContain("0.022");
    expect(pageText).not.toContain("26.1%");
    expect(pageText).not.toContain("38.1%");
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
