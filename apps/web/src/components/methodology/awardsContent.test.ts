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
  // --- District award base rates ------------------------------------------
  // `pnpm measure:district-award-base-rates`
  // (`npx tsx scripts/measureDistrictAwardBaseRates.ts`, run 2026-09-25),
  // cross checked against the committed 2026 table literals in
  // `packages/core/districts/awardBaseRates.ts`.
  "2019, 2020, 2022, 2023, 2024, 2025 and 2026", // DISTRICT_AWARD_BASE_RATE_SEASONS
  "2,042", // n, none|rookie
  "52.4%", // 1 - pmf[0], none|rookie
  "7,335", // n, none|veteran
  "19.9%", // 1 - pmf[0], none|veteran
  "6,349", // n, one-or-two|veteran
  "26.1%", // 1 - pmf[0], one-or-two|veteran
  "10,060", // n, three-or-more|veteran
  "61.6%", // 1 - pmf[0], three-or-more|veteran
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
   * no award prediction anywhere yet. The Road to District Champs ledger prints
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
    expect(AWARDS_LEAD).toContain("The Road to District Champs ledger prices a team's award points");
    expect(AWARDS_LEAD).toContain("no other page on the site shows an award prediction");
    expect(AWARDS_LEAD).not.toMatch(/anywhere yet/);
  });
});
