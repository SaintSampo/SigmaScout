/**
 * Content coverage for `awardsContent.ts` (quick task 260912-tm8).
 *
 * Same two jobs, in the same deliberately different styles, as
 * `sprContent.test.ts`.
 *
 * STRUCTURE is pinned BY EQUALITY against a hand typed literal array, never by
 * iterating the exported constant. This repo has a recorded iteration list
 * trap: a test that iterates a list silently absorbs a newly added entry.
 *
 * VOICE is asserted at RUNTIME over the exported string VALUES, never grepped
 * from source, because this file's comments legitimately use dashes. The
 * collector builds `{ where, text }` records so a failure names the string.
 *
 * NUMBERS are pinned as substrings. Every figure the page states was measured
 * by committed code (see the content module's header). Pinning them means a
 * prose rewrite cannot quietly drop a sample size or drift a percentage away
 * from what the scripts print. If a script is rerun and a number changes, this
 * test failing is the correct outcome: update the prose and this list together.
 */
import { describe, expect, it } from "vitest";
import {
  AWARDS_LEAD,
  AWARDS_PAGE_TITLE,
  AWARDS_SECTION_IDS,
  AWARDS_SECTIONS,
  AWARDS_SUBSECTION_IDS,
  type AwardsTable,
} from "./awardsContent.js";

const HYPHEN_MINUS = "-";
const EN_DASH = "–";
const EM_DASH = "—";

/** The four section ids, hand typed. Changing `AWARDS_SECTIONS` without this is the failure caught here. */
const EXPECTED_SECTION_IDS = ["the-goal", "the-model", "our-results", "district-award-base-rates"];

/** The four result subsection ids under `our-results`, hand typed for the same reason. */
const EXPECTED_SUBSECTION_IDS = [
  "past-winners-win-again",
  "spr-only-helped-on-autonomous",
  "team-age",
  "one-winner-or-a-short-list",
];

/**
 * Every measured number the page states, as it appears in the prose. Sources:
 * `pnpm measure:award-predictability` (default and `--dcmp`) and
 * `pnpm measure:award-qualification-impact`.
 */
const REQUIRED_FIGURES = [
  // Corpus and the random guess yardstick.
  "41,869",
  "about 3%",
  // Repeat rate.
  "61.4%",
  // Simple rule (B1) against the fitted model, top pick.
  "24.5%",
  "22.1%",
  "12.1%",
  "9.6%",
  "28.2%",
  "22.8%",
  "14.3%",
  "18.9%",
  // SPR alone (B2) against the simple rule, top pick.
  "17.7%",
  "13.1%",
  "9.7%",
  "11.8%",
  "8.9%",
  "10.7%",
  "8.7%",
  "9.3%",
  // Team age.
  "21.6%",
  "19 of the 24",
  // Ranked list.
  "51.1%",
  "84.9%",
  "9.1%",
  "28.5%",
  // --- The one award slate (quick task 261014-qje) -------------------------
  // `pnpm measure:award-slate` (`npx tsx scripts/measureAwardSlate.ts`, run
  // 2026-10-14, saved as `261014-qje-measure.txt`), cross checked against the
  // committed `AWARD_SLATE_TABLES` literal in
  // `packages/core/districts/awardSlate.ts`. DISTRICT TIER 2026 block: counts
  // impact 0.9709, engineeringInspiration 0.9806, rookieAllStar 0.9091 (over
  // events with a rookie), judged 11.7087; training seasons 2019, 2020, 2022,
  // 2023, 2024, 2025. DCMP TIER 2026 block: single and division judged 12.
  "0.97 Impact awards",
  "0.98 Engineering Inspiration awards",
  "11.71 other team awards",
  "0.91 Rookie All Star awards",
  "measured on 2019 to 2025",
  "2023 to 2026", // the registered seasons at both tiers
  "expected to give 12 other team awards",
];

/**
 * The 2026 district class weights, by equality: [award, earlier awards,
 * weight, team events]. Each weight is the DISTRICT TIER 2026 block's lift by
 * cell rounded to two places, and each count is that cell's n. Impact
 * none|none 0.0082 (4301), none|one-or-two 0.1226 (4542), none|three-or-more
 * 0.6857 (6172), one-or-two|three-or-more 4.0130 (1331),
 * three-or-more|three-or-more 7.5323 (897); Engineering Inspiration
 * none|veteran 0.0204 (3107), one-or-two|veteran 0.2921 (4529),
 * three-or-more|veteran 1.7645 (7985); Rookie All Star none|rookie 1.0000
 * (1013); judged none|rookie 0.3053 (579), none|veteran 0.3534 (3069),
 * one-or-two|veteran 0.5911 (4503), three-or-more|veteran 1.5374 (7690).
 */
const EXPECTED_WEIGHT_ROWS = [
  ["Impact", "No Impact win, no other award", "0.01", "4,301"],
  ["Impact", "No Impact win, one or two other awards", "0.12", "4,542"],
  ["Impact", "No Impact win, three or more other awards", "0.69", "6,172"],
  ["Impact", "One or two Impact wins, three or more awards", "4.01", "1,331"],
  ["Impact", "Three or more Impact wins", "7.53", "897"],
  ["Engineering Inspiration", "None", "0.02", "3,107"],
  ["Engineering Inspiration", "One or two", "0.29", "4,529"],
  ["Engineering Inspiration", "Three or more", "1.76", "7,985"],
  ["Rookie All Star", "Every rookie", "1.00", "1,013"],
  ["Other team awards", "None, rookie", "0.31", "579"],
  ["Other team awards", "None, veteran", "0.35", "3,069"],
  ["Other team awards", "One or two", "0.59", "4,503"],
  ["Other team awards", "Three or more", "1.54", "7,690"],
];

function tableStrings(where: string, table: AwardsTable | undefined): { where: string; text: string }[] {
  if (table === undefined) return [];
  const out: { where: string; text: string }[] = [];
  if (table.caption !== undefined) out.push({ where: `${where}.table.caption`, text: table.caption });
  table.head.forEach((text, i) => out.push({ where: `${where}.table.head[${i}]`, text }));
  table.rows.forEach((row, r) => row.forEach((text, c) => out.push({ where: `${where}.table.rows[${r}][${c}]`, text })));
  return out;
}

function allStrings(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [
    { where: "AWARDS_PAGE_TITLE", text: AWARDS_PAGE_TITLE },
    { where: "AWARDS_LEAD", text: AWARDS_LEAD },
  ];
  for (const section of AWARDS_SECTIONS) {
    out.push({ where: `${section.id}.heading`, text: section.heading });
    section.paragraphs.forEach((text, i) => out.push({ where: `${section.id}.paragraphs[${i}]`, text }));
    out.push(...tableStrings(section.id, section.table));
    for (const subsection of section.subsections ?? []) {
      out.push({ where: `${subsection.id}.heading`, text: subsection.heading });
      subsection.paragraphs.forEach((text, i) => out.push({ where: `${subsection.id}.paragraphs[${i}]`, text }));
      out.push(...tableStrings(subsection.id, subsection.table));
    }
  }
  return out;
}

describe("awardsContent structure", () => {
  it("exports the four section ids in order, by equality", () => {
    expect([...AWARDS_SECTION_IDS]).toEqual(EXPECTED_SECTION_IDS);
  });

  it("renders the sections in exactly the declared id order, by equality", () => {
    expect(AWARDS_SECTIONS.map((section) => section.id)).toEqual(EXPECTED_SECTION_IDS);
  });

  it("exports and renders the four result subsections in order, by equality, all under our-results", () => {
    expect([...AWARDS_SUBSECTION_IDS]).toEqual(EXPECTED_SUBSECTION_IDS);
    const results = AWARDS_SECTIONS.find((section) => section.id === "our-results");
    expect(results?.subsections?.map((subsection) => subsection.id)).toEqual(EXPECTED_SUBSECTION_IDS);
    const others = AWARDS_SECTIONS.filter((section) => section.id !== "our-results");
    expect(others.every((section) => section.subsections === undefined)).toBe(true);
  });

  it("gives every section a non blank heading and some body: a paragraph, or subsections that each carry one", () => {
    for (const section of AWARDS_SECTIONS) {
      expect(section.heading.trim().length, `${section.id} has a blank heading`).toBeGreaterThan(0);
      const subsections = section.subsections ?? [];
      expect(section.paragraphs.length + subsections.length, `${section.id} has no body`).toBeGreaterThan(0);
      for (const block of [section, ...subsections]) {
        expect(block.heading.trim().length, `${block.id} has a blank heading`).toBeGreaterThan(0);
        for (const paragraph of block.paragraphs) {
          expect(paragraph.trim().length, `${block.id} has a blank paragraph`).toBeGreaterThan(0);
        }
      }
      for (const subsection of subsections) {
        expect(subsection.paragraphs.length, `${subsection.id} has no paragraphs`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every table rectangular: each row as wide as the head, no blank cell", () => {
    const tables = AWARDS_SECTIONS.flatMap((section) => [section.table, ...(section.subsections ?? []).map((s) => s.table)]);
    for (const table of tables) {
      if (table === undefined) continue;
      for (const row of table.rows) {
        expect(row.length, `row "${row[0]}" width`).toBe(table.head.length);
        for (const cell of row) expect(cell.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("carries no regular expression metacharacter in the title, because the hub test builds a RegExp from card titles", () => {
    expect(AWARDS_PAGE_TITLE).not.toMatch(/[.*+?^${}()|[\]\\]/);
  });
});

describe("awardsContent voice", () => {
  it("contains no hyphen minus, en dash or em dash in any exported string", () => {
    for (const { where, text } of allStrings()) {
      expect(text, `${where} contains a hyphen minus`).not.toContain(HYPHEN_MINUS);
      expect(text, `${where} contains an en dash`).not.toContain(EN_DASH);
      expect(text, `${where} contains an em dash`).not.toContain(EM_DASH);
    }
  });

  it("uses the public rating name SPR and never the retired internal name BPR", () => {
    for (const { where, text } of allStrings()) {
      expect(text, `${where} names BPR`).not.toMatch(/\bBPR\b/);
    }
  });
});

describe("awardsContent figures", () => {
  it("states every measured figure the scripts produced", () => {
    const pageText = allStrings()
      .map((entry) => entry.text)
      .join("\n");
    for (const figure of REQUIRED_FIGURES) {
      expect(pageText, `the page no longer states ${figure}`).toContain(figure);
    }
  });

  /**
   * REPLACES, rather than deletes, the assertion that pinned the claim phase 10
   * retired: the lead's second sentence used to tell a reader the site showed
   * no award prediction anywhere yet. The District Locks ledger prints
   * a chance of award points per team per event, so that sentence became false
   * when the tab shipped. A deleted assertion would leave the lead unguarded;
   * this one keeps the page pinned in the other direction, so a later edit
   * cannot quietly drop the one place a reader is told where award predictions
   * do appear.
   *
   * The negative guard matches the retired sentence's own tail rather than
   * re-quoting the phrase, so this file does not carry the wording the phase
   * removed.
   */
  it("names where award predictions appear, and says the rest of the site shows none", () => {
    expect(AWARDS_LEAD).toContain("The District Locks ledger prices a team's award points");
    expect(AWARDS_LEAD).toContain("the Champ Locks tab draws the District Championship's Impact");
    expect(AWARDS_LEAD).toContain("no other page on the site shows an award prediction");
    expect(AWARDS_LEAD).not.toMatch(/anywhere yet/);
    expect(AWARDS_LEAD).toContain("The Champ Locks tab prices a team's award points at a District Championship from earlier championships.");
  });

  it("says how a District Championship award is priced: eligibility first, divisions and finals, and 0% for a team that cannot win (quick task 261014-i8i)", () => {
    const section = AWARDS_SECTIONS.find((entry) => entry.id === "district-award-base-rates")!;
    const text = section.paragraphs.join("\n");
    expect(text).toContain("Impact, Engineering Inspiration and Rookie All Star go only to teams that won the same award at a district event that season.");
    expect(text).toContain("A team that cannot win one of them reads 0% for it.");
    expect(text).toContain("A championship played in divisions gives those three awards at its finals and its other team awards in each division.");
    expect(text).toContain("measured from earlier seasons only");
    // The paragraphs sit after the district paragraphs and before the closing guarantee.
    const dcmpAt = section.paragraphs.findIndex((paragraph) => paragraph.startsWith("A District Championship is priced"));
    expect(dcmpAt).toBeGreaterThan(section.paragraphs.findIndex((paragraph) => paragraph.startsWith("The prediction gives a team at most one award")));
    expect(section.paragraphs[section.paragraphs.length - 1]).toBe("No award prediction moves a team's status on the ledger. A Locked verdict stays a guarantee.");
  });

  it("describes the one award slate: slots, the season list, the award record and the no repeat rule (quick task 261014-qje)", () => {
    const section = AWARDS_SECTIONS.find((entry) => entry.id === "district-award-base-rates")!;
    expect(section.heading).toBe("How district awards are predicted");
    expect(section.paragraphs.slice(0, 8)).toEqual([
      "The District Locks ledger and the Champ Locks tab price awards with one model, at district events and District Championships alike. Each event gives a known number of each award, and those awards are shared among the teams that can win them.",
      "The model sorts the team awards that pay district points into slots. Impact pays 10 points and is open to every team. Engineering Inspiration pays 8 and goes only to veterans, and Rookie All Star pays 8 and goes only to rookies. Rookie Inspiration paid 5 and went only to rookies until FIRST dropped it after 2024. Every other team award that pays points is worth 5 and is open to every team.",
      "The number of each award is how many an event gave on average in the most recent earlier season. Only the awards on FIRST's list for the season count, so an award FIRST dropped adds nothing. A new award is given the average of the other awards worth the same points until it has a season of its own.",
      "In 2026 a district event was expected to give 0.97 Impact awards, 0.98 Engineering Inspiration awards and 11.71 other team awards. An event with a rookie was expected to give 0.91 Rookie All Star awards.",
      "A team that won Impact, Engineering Inspiration or Rookie All Star at an earlier district event that season cannot win the same award at a later one.",
      "A team's award record counts every team award that pays district points, won at any event in an earlier season. Dean's List, Woodie Flowers, Volunteer of the Year, Wildcard and Impact Finalist do not count.",
      "A team's share of an award is set by a weight for teams with the same record, measured on earlier seasons only. A weight of 1 is an average team, and a weight of 2 wins twice as often. For Impact, earlier Impact wins count first and other earlier awards second. A record held by fewer than 100 team events uses a wider record instead.",
      "The prediction gives a team at most one award at an event, its highest. The model covers the seasons 2023 to 2026.",
    ]);
    expect(section.table?.caption).toBe("Weights for 2026 district events, measured on 2019 to 2025");
    expect(section.table?.head).toEqual(["Award", "Earlier awards", "Weight", "Team events"]);
    expect(section.table?.rows).toEqual(EXPECTED_WEIGHT_ROWS);
  });

  it("names no part of the retired per team award model in the district section", () => {
    const section = AWARDS_SECTIONS.find((entry) => entry.id === "district-award-base-rates")!;
    const text = [section.heading, ...section.paragraphs, ...tableStrings(section.id, section.table).map((entry) => entry.text)].join("\n");
    expect(text).not.toMatch(/base rate/i);
    expect(text).not.toMatch(/judged award/i);
    expect(text).not.toMatch(/ordering|order of/i);
    expect(text).not.toContain("26.1%");
    expect(text).not.toContain("38.1%");
  });
});
