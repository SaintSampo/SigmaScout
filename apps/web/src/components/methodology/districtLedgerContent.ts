/**
 * Content-as-data for `/methodology/district-points`, the published statement
 * of how the Road to District Champs ledger predicts a team's district points
 * (phase 10 plan 08).
 *
 * Same discipline as `awardsContent.ts`, `sprContent.ts` and
 * `epaComparisonContent.ts`: this module is the single source of every string
 * the page renders, table cells included, so `districtLedgerContent.test.ts`
 * can pin the structure by equality and check every string for voice
 * violations without a second hand typed copy.
 *
 * NAMED FOR THE LEDGER, ROUTED FOR THE POINTS. `10-PATTERNS.md` and 10-07's own
 * hand off both name this file `districtLedgerContent.ts`, so the name is kept;
 * the route slug is `district-points`, which is what a reader searches for.
 * Not to be confused with `apps/web/src/components/districts/districtLedgerCopy.ts`,
 * which holds the tab's own chrome rather than this page's prose.
 *
 * Voice rules, binding on every exported string (Jacob, sketch 014, reconfirmed
 * by sketches 015 and 016):
 *
 *   1. NO dash characters at all: not the hyphen minus, not the en dash, not
 *      the em dash. Compounds go open ("top 3"), ranges go in words
 *      ("2016 to 2026").
 *   2. Flat and factual, short declarative sentences, third person. No sentence
 *      that explains how or why unless a reader would miss the fact without it.
 *      No singular first person. Numbers and comparisons go in small tables.
 *   3. Never a plus minus sign and never a partial variance, on this page as on
 *      the tab.
 *
 * The voice gate runs at RUNTIME over the exported string VALUES, never as a
 * grep over this file's source. These doc comments use normal punctuation.
 *
 * EVERY NUMBER HERE TRACES TO COMMITTED CODE. Five sources, and no figure on
 * this page comes from anywhere else:
 *
 *   1. `pnpm measure:alliance-win-probability`
 *      (`npx tsx scripts/measureAllianceWinProbability.ts --seasons 2026 --warmup-from 2026`,
 *      run 2026-09-25) — the gap between the browser's alliance pricer and the
 *      site's own published win probability, both Brier figures, the two floors
 *      and the winner disagreement rate. Its recorded constants are exported
 *      beside the script, next to `MEASURED_COMMAND` and `MEASURED_WINDOW`.
 *   2. `pnpm measure:selection-agreement`
 *      (`npx tsx scripts/measureSelectionAgreement.ts --captain-seasons 2023-2026 --seasons 2026 --warmup-from 2026`,
 *      run 2026-09-25) — the captain rule's slot counts, the naive rule's score,
 *      the per round and pooled pick order agreement, the top 3 agreement and
 *      each round's no information floor.
 *   3. `pnpm measure:district-award-base-rates`
 *      (`npx tsx scripts/measureDistrictAwardBaseRates.ts`, run 2026-09-25) —
 *      the award base rate tables. Their full statement lives on
 *      `/methodology/awards`; this page names only the registered season set.
 *   4. `npx vitest run packages/core/districts/pointFormulas.reconciliation.test.ts`
 *      (10-01) — the qualification, alliance selection and playoff point
 *      formulas reconciled against real values The Blue Alliance reports.
 *   5. `npx vitest run packages/core/districts/selectionModel.reconciliation.test.ts`
 *      (10-04) — the progressive captain rule and the serpentine draft order
 *      reconciled against every 2023 and later eight alliance district event.
 *
 * A figure that appears in none of those five is not written here.
 *
 * NO SUBSECTION LEVEL, deliberately. `awardsContent.ts` needed one because its
 * results split four ways; each of this page's six sections is one idea, so a
 * second nesting level would add a shape without adding a distinction.
 */

export const DISTRICT_LEDGER_PAGE_TITLE = "Predicting district points";

export const DISTRICT_LEDGER_LEAD =
  "SigmaScout predicts how many district points each team will finish its district season with. This page states how every category is predicted, how closely each part of the model matches what really happened, and what the model leaves out.";

/**
 * The six sections, declared once and in render order. `DISTRICT_LEDGER_SECTIONS`
 * is asserted equal to this tuple, so a declared id carrying no section is a
 * red test rather than a quietly dropped section.
 */
export const DISTRICT_LEDGER_SECTION_IDS = [
  "how-district-points-work",
  "how-open-categories-are-predicted",
  "the-alliance-selection-model",
  "award-base-rates",
  "how-well-the-bracket-pricer-works",
  "what-this-does-not-model",
] as const;
export type DistrictLedgerSectionId = (typeof DISTRICT_LEDGER_SECTION_IDS)[number];

export interface DistrictLedgerTable {
  readonly caption?: string;
  readonly head: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface DistrictLedgerSection {
  readonly id: DistrictLedgerSectionId;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly table?: DistrictLedgerTable;
}

export const DISTRICT_LEDGER_SECTIONS: readonly DistrictLedgerSection[] = [
  {
    id: "how-district-points-work",
    heading: "How district points work",
    paragraphs: [
      "A team earns district points at every district event it plays. Four categories make up an event total, and a team's event totals make up its season total.",
      "Every formula below reproduces the value The Blue Alliance itself reports, checked row by row across ten seasons.",
      "A team is also Locked when the points still available in the district cannot lift enough rivals past it. Points are shared out inside an event, so the whole district has far fewer points left than the sum of what every rival could reach on its own. Either test is enough on its own, and both are applied at every position.",
    ],
    table: {
      caption: "The four categories, and what a district championship is worth",
      head: ["Category", "Points", "Checked against the corpus"],
      rows: [
        [
          "Qualification",
          "The game manual's inverse error function formula on a team's qualification rank and the size of the field.",
          "29,796 rows, 0 mismatches",
        ],
        [
          "Alliance selection",
          "A captain or a first pick earns 17 minus the alliance number. A second pick earns the alliance number itself. A fourth robot earns nothing.",
          "20,209 rows, 0 mismatches",
        ],
        [
          "Playoffs",
          "Final placement only: 30 for first, 20 for second, 13 for third, 7 for fourth, and nothing for fifth through eighth.",
          "478 brackets and 10,278 rows, 0 mismatches",
        ],
        [
          "Awards",
          "Set by the judged awards a team wins at the event. The chance and the typical amount come from measured base rates.",
          "Stated on the Predicting awards page",
        ],
        [
          "District championship",
          "Every value a team earns at a district championship is three times the district event value.",
          "The same formulas, at the championship weight",
        ],
      ],
    },
  },
  {
    id: "how-open-categories-are-predicted",
    heading: "How the open categories are predicted",
    paragraphs: [
      "One run produces a ranking, then the captains and the picks, then the bracket. A team's four numbers in a run therefore belong to the same imagined weekend, and each histogram is one marginal of the same runs.",
      "The event total is the per run sum of the four categories. The season total is the exact convolution of a team's event totals, plus the rookie bonus and any adjustments.",
      "The rookie bonus is 10 points in a team's first season and 5 in its second. It is added once per season to the season total and to the floor the locks use, never to an event total. The Team cell prints it when it applies.",
      "A category that is already settled shows the points the team earned, not a prediction. An event nobody has played yet is priced by the pipeline before the season, and the browser computes nothing for it.",
      "An open cell shows either a median with a likely range, or a chance with the typical amount when it happens. Likely means the 10th to the 90th percentile.",
    ],
    table: {
      caption: "What decides each open category",
      head: ["Category", "How it is predicted"],
      rows: [
        [
          "Qualification",
          "The rank simulation over the event's remaining matches, then the game manual's formula on the rank that run drew.",
        ],
        ["Alliance selection", "The captains and the two picks of that same drawn ranking, then the selection point values."],
        [
          "Playoffs",
          "The eight alliance double elimination bracket, with every match priced from the two alliances' published ratings.",
        ],
        ["Awards", "A draw from the base rate for the team's own count of prior judged awards and its rookie status."],
      ],
    },
  },
  {
    id: "the-alliance-selection-model",
    heading: "The alliance selection model",
    paragraphs: [
      "The captain at each alliance's turn is the highest ranked team not yet on an alliance. The draft runs alliance 1 through alliance 8 and then alliance 8 back down to alliance 1. Picks are taken in rating order among the teams still available.",
      "The one captain slot the rule missed is alliance 8 at 2026milac, where the rule expected the team ranked 13 and the real captain was ranked 14.",
      "The second pick is the weaker half. Its exact agreement is 22.34% against a floor of 7.85%, about 2.8 times the floor, where first picks run about 11 times their own floor. The real second pick typically sits at position 4 in the model's list, against position 2 for a first pick.",
    ],
    table: {
      caption: "Measured against the real draft",
      head: ["What was measured", "The model", "No information floor"],
      rows: [
        ["Captain slots named correctly, 485 events, 2023 to 2026", "99.97%, or 3,879 of 3,880", "3.75%"],
        ["The same slots, under the rule that the captains are the eight best ranked teams", "25.15%, or 976 of 3,880", "3.75%"],
        ["Pick order, exact agreement, 2,256 turns in 2026", "32.62%", "5.90%"],
        ["First picks, exact agreement, 1,128 turns", "42.91%", "3.95%"],
        ["Second picks, exact agreement, 1,128 turns", "22.34%", "7.85%"],
        ["Pick order, the real pick inside the model's top 3", "60.51%", "not measured"],
      ],
    },
  },
  {
    id: "award-base-rates",
    heading: "Award base rates",
    paragraphs: [
      "The award cell is priced from a table of how often teams in the same position have earned district award points. The table for each season is built only from the seasons before it.",
      "The full table, its sample sizes and the cells that cannot be scored are on the Predicting awards page.",
      "No award prediction moves a team's status. A Locked verdict stays a guarantee.",
      "One qualification slot is held back for every district event whose Impact award is still to come. The Impact winner at a district event takes a slot, so a team is never told it is Locked on a slot an award is about to claim. A slot held back this way returns to the points race as soon as that award is posted.",
    ],
  },
  {
    id: "how-well-the-bracket-pricer-works",
    heading: "How well the bracket pricer works",
    paragraphs: [
      "The browser prices an alliance from two numbers a published event file already carries for every team: its rating and its own uncertainty.",
      "This is an approximation of the number the site publishes, not the same calculation. Over 19,792 played matches in 2026 the two sit 0.0552 apart on average, and half the time within 0.0417.",
    ],
    table: {
      caption: "The browser's number against the site's own, over 19,792 played matches in 2026",
      head: ["Measure", "Value"],
      rows: [
        ["Mean absolute gap against the published win probability", "0.0552"],
        ["Median absolute gap", "0.0417"],
        ["Ninetieth percentile absolute gap", "0.1224"],
        ["Matches where the two pick different winners", "4.44%"],
        ["Brier, the number the browser computes", "0.1462"],
        ["Brier, the number the site publishes", "0.1443"],
        ["Brier, a coin", "0.2494"],
        ["Brier, the sign of the rating difference alone", "0.2112"],
      ],
    },
  },
  {
    id: "what-this-does-not-model",
    heading: "What this does not model",
    paragraphs: ["Seven limits, each one recorded in the code that produced the numbers above."],
    table: {
      caption: "Seven limits",
      head: ["Limit", "What is known about it"],
      rows: [
        ["Declines are not modelled", "One captain slot in 3,880 went to a lower ranked team, at 2026milac."],
        [
          "The award draw does not depend on how a team did on the field",
          "The base rate table covers judged awards only.",
        ],
        [
          "The district level award table is applied at the district championship too",
          "That assumes the same earning rates at both tiers, and it has not been tested.",
        ],
        [
          "An event nobody has played is priced from each team's current rating over generated schedules",
          "The schedule The Blue Alliance will publish is not known when those numbers are baked.",
        ],
        [
          "Every baked number's resolution is set by its draw count",
          "4,000 draws per event, with a measured movement between seeds of at most 0.03525.",
        ],
        [
          "An event whose awards are posted can still read as open",
          "When the award rows are missing and no team earned award points, the award cell stays open at the base rate.",
        ],
        [
          "Awards posted after every event in the district has finished wait for the next offline republish",
          "An event's live window closes one hour after the last match observed there.",
        ],
      ],
    },
  },
];
