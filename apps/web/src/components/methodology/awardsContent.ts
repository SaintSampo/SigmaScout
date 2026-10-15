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
 * THE DISTRICT AWARD SECTION (id kept as `district-award-base-rates` so the
 * anchor stays stable) describes the one award slate of quick task 261014-qje,
 * `packages/core/districts/awardSlate.ts`, which prices district events and
 * District Championships alike. Every figure in it comes from
 * `pnpm measure:award-slate` (`npx tsx scripts/measureAwardSlate.ts`, run
 * 2026-10-14, saved as `261014-qje-measure.txt` in that quick task's
 * directory) and is cross checked against the committed
 * `AWARD_SLATE_TABLES` literal:
 *
 *   - the 2026 district counts per event (DISTRICT TIER 2026 block: impact
 *     0.9709, engineeringInspiration 0.9806, rookieAllStar 0.9091 over events
 *     with a rookie, judged 11.7087), from 2025's district events;
 *   - the 2026 district class weights and their n (the same block's lifts by
 *     cell, rounded to two places; the training seasons 2019, 2020 and 2022 to
 *     2025);
 *   - the 2026 DCMP judged count, 12 per division and per single championship
 *     (DCMP TIER 2026 block, `counts, single` and `counts, division`);
 *   - the registered seasons, 2023 to 2026 at both tiers.
 *
 * RETIRED with the per team model (261014-qje, Q-12), DO NOT RESTORE: the base
 * rate table (`measure:district-award-base-rates`), the Impact and Rookie All
 * Star ordering figures (`measure:award-ordering-tables`) and the separate
 * DCMP slate measurement (`measure:dcmp-award-slate`). Their figures are
 * history and are not quoted on the page.
 *
 * RETIRED BY PHASE 10, DO NOT RESTORE. `AWARDS_LEAD`'s second sentence used to
 * tell a reader that the site showed no award prediction anywhere yet. The
 * District Locks ledger prints a chance of award points and a typical
 * amount per team per event, so that sentence became false the moment the tab
 * shipped. The assertion in `awardsContent.test.ts` that pinned it was
 * REPLACED rather than deleted, so the lead stays pinned in the other
 * direction. The retired sentence is described here rather than quoted, so
 * that this note cannot re-introduce the wording it retires.
 */

export const AWARDS_PAGE_TITLE = "Predicting awards";

export const AWARDS_LEAD =
  "SigmaScout tested whether FRC awards can be predicted. The District Locks ledger prices a team's award points at a district event from the model at the foot of this page, the Champ Locks tab draws the District Championship's Impact, Engineering Inspiration and Rookie All Star winners when it sets its predicted cutoff, and no other page on the site shows an award prediction. The Champ Locks tab prices a team's award points at a District Championship from earlier championships.";

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
    heading: "How district awards are predicted",
    paragraphs: [
      "The District Locks ledger and the Champ Locks tab price awards with one model, at district events and District Championships alike. Each event gives a known number of each award, and those awards are shared among the teams that can win them.",
      "The model sorts the team awards that pay district points into slots. Impact pays 10 points and is open to every team. Engineering Inspiration pays 8 and goes only to veterans, and Rookie All Star pays 8 and goes only to rookies. Rookie Inspiration paid 5 and went only to rookies until FIRST dropped it after 2024. Every other team award that pays points is worth 5 and is open to every team.",
      "The number of each award is how many an event gave on average in the most recent earlier season. Only the awards on FIRST's list for the season count, so an award FIRST dropped adds nothing. A new award is given the average of the other awards worth the same points until it has a season of its own.",
      "In 2026 a district event was expected to give 0.97 Impact awards, 0.98 Engineering Inspiration awards and 11.71 other team awards. An event with a rookie was expected to give 0.91 Rookie All Star awards.",
      "A team that won Impact, Engineering Inspiration or Rookie All Star at an earlier district event that season cannot win the same award at a later one.",
      "A team's award record counts every team award that pays district points, won at any event in an earlier season. Dean's List, Woodie Flowers, Volunteer of the Year, Wildcard and Impact Finalist do not count.",
      "A team's share of an award is set by a weight for teams with the same record, measured on earlier seasons only. A weight of 1 is an average team, and a weight of 2 wins twice as often. For Impact, earlier Impact wins count first and other earlier awards second. A record held by fewer than 100 team events uses a wider record instead.",
      "The prediction gives a team at most one award at an event, its highest. The model covers the seasons 2023 to 2026.",
      "A District Championship is priced by the same model, with its own numbers measured on earlier championships. Impact, Engineering Inspiration and Rookie All Star go only to teams that won the same award at a district event that season. A team that cannot win one of them reads 0% for it.",
      "A championship played in divisions gives those three awards at its finals and its other team awards in each division. A championship played as one event gives both. The number of Impact, Engineering Inspiration and Rookie All Star awards comes from the district's own count the season before. In 2026 each division and each single championship was expected to give 12 other team awards. The teams most likely to get them are set by their earlier award record, measured from earlier seasons only.",
      "No award prediction moves a team's status on the ledger. A Locked verdict stays a guarantee.",
    ],
    table: {
      caption: "Weights for 2026 district events, measured on 2019 to 2025",
      head: ["Award", "Earlier awards", "Weight", "Team events"],
      rows: [
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
      ],
    },
  },
];
