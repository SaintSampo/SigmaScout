/**
 * Content-as-data for `/methodology/awards`.
 *
 * Rewritten 2026-09-16 from sketch 015 (variant B2, Jacob's pick): three
 * sections on his outline (the goal, the model, the results), one or two
 * sentences per finding, and the numbers in small tables. The calibration,
 * qualifying and limits sections of the first write up were cut.
 *
 * Same discipline as `sprContent.ts` and `epaComparisonContent.ts`: this
 * module is the single source of every string the page renders, table cells
 * included, so `awardsContent.test.ts` can pin the structure by equality and
 * check every string for voice violations without a second hand typed copy.
 *
 * Voice rules, binding on every exported string:
 *
 *   1. NO dash characters at all: not the hyphen minus, not the en dash, not
 *      the em dash. Compounds go open ("top 3"), ranges go in words
 *      ("2016 to 2026").
 *   2. Flat and factual, short declarative sentences. No sentence that
 *      explains how or why unless a reader would miss it.
 *
 * The voice gate runs at RUNTIME over the exported string VALUES, never as a
 * grep over this file's source. These doc comments use normal punctuation.
 *
 * EVERY NUMBER HERE TRACES TO COMMITTED CODE: `pnpm measure:award-predictability`
 * (default run) and, for the repeat rate, `pnpm measure:award-qualification-impact`.
 * In the predictability output, "Simple rule" is the B1 row (most decorated
 * team present), "SPR alone" is the B2 row (strongest team present), and the
 * top pick figure is the R@1 column. State no number here that those do not
 * print.
 *
 * The district award base rate section's own figures come from a different
 * command, `pnpm measure:district-award-base-rates`
 * (`npx tsx scripts/measureDistrictAwardBaseRates.ts`, run 2026-09-25), and
 * are cross checked against the committed table literals in
 * `packages/core/districts/awardBaseRates.ts`.
 *
 * RETIRED BY PHASE 10, DO NOT RESTORE. `AWARDS_LEAD`'s second sentence used to
 * tell a reader that the site showed no award prediction anywhere yet. The
 * Road to District Champs ledger prints a chance of award points and a typical
 * amount per team per event, so that sentence became false the moment the tab
 * shipped. The assertion in `awardsContent.test.ts` that pinned it was
 * REPLACED rather than deleted, so the lead stays pinned in the other
 * direction. The retired sentence is described here rather than quoted, so
 * that this note cannot re-introduce the wording it retires.
 */

export const AWARDS_PAGE_TITLE = "Predicting awards";

export const AWARDS_LEAD =
  "SigmaScout tested whether FRC awards can be predicted. The Road to District Champs ledger prices a team's award points at a district event from the base rates at the foot of this page, and no other page on the site shows an award prediction.";

export const AWARDS_SECTION_IDS = ["the-goal", "the-model", "our-results", "district-award-base-rates"] as const;
export type AwardsSectionId = (typeof AWARDS_SECTION_IDS)[number];

export const AWARDS_SUBSECTION_IDS = [
  "past-winners-win-again",
  "spr-only-helped-on-autonomous",
  "team-age",
  "one-winner-or-a-short-list",
] as const;
export type AwardsSubsectionId = (typeof AWARDS_SUBSECTION_IDS)[number];

export interface AwardsTable {
  readonly caption?: string;
  readonly head: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface AwardsSubsection {
  readonly id: AwardsSubsectionId;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly table?: AwardsTable;
}

export interface AwardsSection {
  readonly id: AwardsSectionId;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly table?: AwardsTable;
  readonly subsections?: readonly AwardsSubsection[];
}

export const AWARDS_SECTIONS: readonly AwardsSection[] = [
  {
    id: "the-goal",
    heading: "The goal: predict awards",
    paragraphs: [
      "In September 2026 we collected 41,869 award results from TBA, 2016 to 2026, to look for patterns and predict future winners. A typical event has about 40 teams, so a random guess is right about 3% of the time.",
    ],
  },
  {
    id: "the-model",
    heading: "The model: what we built",
    paragraphs: [
      "We compared a fitted model against a simple rule. Each season was predicted using only the seasons before it.",
    ],
    table: {
      head: ["Method", "How it picks a winner"],
      rows: [
        ["Fitted model", "Weighs each team's past awards and its SPR rating"],
        ["Simple rule", "The team at the event with the most awards in earlier seasons"],
      ],
    },
  },
  {
    id: "our-results",
    heading: "Our results",
    paragraphs: [],
    subsections: [
      {
        id: "past-winners-win-again",
        heading: "Past winners win again",
        paragraphs: [
          "61.4% of Impact wins went to a team that had won Impact before. Counting past wins beat the fitted model on the awards teams care about most.",
        ],
        table: {
          caption: "How often the top pick won",
          head: ["Award", "Simple rule", "Model"],
          rows: [
            ["Impact", "24.5%", "22.1%"],
            ["Engineering Inspiration", "12.1%", "9.6%"],
            ["Safety", "28.2%", "22.8%"],
            ["Excellence in Engineering", "12.1%", "14.3%"],
            ["Autonomous", "14.3%", "18.9%"],
          ],
        },
      },
      {
        id: "spr-only-helped-on-autonomous",
        heading: "SPR only helped on the Autonomous Award",
        paragraphs: [
          "We also ranked teams by SPR alone, with no award history. Autonomous is the one award where that clearly beat the simple rule. It was barely ahead on Excellence in Engineering and behind on every other judged award.",
        ],
        table: {
          caption: "How often the top pick won, best five awards for SPR",
          head: ["Award", "SPR alone", "Simple rule"],
          rows: [
            ["Autonomous", "17.7%", "14.3%"],
            ["Excellence in Engineering", "13.1%", "12.1%"],
            ["Innovation in Control", "9.7%", "11.8%"],
            ["Industrial Design", "8.9%", "10.7%"],
            ["Quality", "8.7%", "9.3%"],
          ],
        },
      },
      {
        id: "team-age",
        heading: "Team age: no real difference",
        paragraphs: [
          "Older teams win more because they have had longer to build a record. Once the model knows past wins, age adds nothing. It made no real difference on 19 of the 24 judged awards.",
        ],
        table: {
          caption: "Impact, top pick",
          head: ["Model", "Correct"],
          rows: [
            ["Without team age", "22.1%"],
            ["With team age", "21.6%"],
          ],
        },
      },
      {
        id: "one-winner-or-a-short-list",
        heading: "Predicting just one winner is much harder than predicting a short list",
        paragraphs: ["The typical Impact winner was ranked third out of about 39 teams."],
        table: {
          caption: "Impact, how often the list held the winner",
          head: ["List", "Simple rule", "Random"],
          rows: [
            ["Top pick", "24.5%", "about 3%"],
            ["Top 3", "51.1%", "9.1%"],
            ["Top 10", "84.9%", "28.5%"],
          ],
        },
      },
    ],
  },
  {
    id: "district-award-base-rates",
    heading: "District award base rates",
    paragraphs: [
      "The Road to District Champs ledger prices each team's award cell from a table of how often teams in the same position earned district award points. The table for a season is built only from the seasons before it.",
      "Seven seasons carry a table: 2019, 2020, 2022, 2023, 2024, 2025 and 2026. The three earliest district seasons carry none, because fewer than three earlier district seasons exist for them.",
      "Rookie status splits the table only where a team has never won a judged award. A rookie has no earlier season, so the two decorated buckets have no rookie cell to measure, and TBA reports a rookie year for every team here, so the three unknown rows are empty as well.",
      "No award prediction moves a team's status on the ledger. A Locked verdict stays a guarantee.",
    ],
    table: {
      caption: "Season 2026, fit on 2016 to 2025",
      head: [
        "Prior judged awards and rookie status",
        "Teams",
        "Any award points",
        "Distribution over 5, 8, 10, 13 and 15 or more points",
      ],
      rows: [
        ["None, rookie", "2,042", "52.4%", "27.1%, 25.0%, 0.1%, 0.1%, 0.0%"],
        ["None, veteran", "7,335", "19.9%", "17.2%, 1.1%, 1.4%, 0.1%, 0.1%"],
        ["None, rookie year unknown", "0", "not scored", "not scored"],
        ["One or two, rookie", "0", "not scored", "not scored"],
        ["One or two, veteran", "6,349", "26.1%", "23.4%, 1.3%, 1.2%, 0.1%, 0.0%"],
        ["One or two, rookie year unknown", "0", "not scored", "not scored"],
        ["Three or more, rookie", "0", "not scored", "not scored"],
        ["Three or more, veteran", "10,060", "61.6%", "48.4%, 5.3%, 7.4%, 0.2%, 0.2%"],
        ["Three or more, rookie year unknown", "0", "not scored", "not scored"],
      ],
    },
  },
];
