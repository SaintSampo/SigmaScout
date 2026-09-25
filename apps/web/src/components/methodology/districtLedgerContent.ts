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
];
