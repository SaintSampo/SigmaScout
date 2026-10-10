/**
 * Content-as-data for `/methodology/district-points`, the published statement
 * of how the District Locks ledger predicts a team's district points
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
 * EVERY NUMBER HERE TRACES TO COMMITTED CODE. Six sources, and no figure on
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
 *   3. `pnpm measure:award-ordering-tables`
 *      (`npx tsx scripts/measureAwardOrderingTables.ts`, Impact rows re-run
 *      2026-09-29 under the Impact first ordering, quick task 260929-imp) for
 *      the two Impact and Rookie All Star ordering figures. Their full statement, the
 *      remaining positions and every sample size live on
 *      `/methodology/awards`; this page states only the two that name the
 *      mechanism.
 *   4. `pnpm measure:district-award-base-rates`
 *      (`npx tsx scripts/measureDistrictAwardBaseRates.ts`, run 2026-09-25) —
 *      the award base rate tables. Their full statement lives on
 *      `/methodology/awards`; this page names only the registered season set.
 *   5. `npx vitest run packages/core/districts/pointFormulas.reconciliation.test.ts`
 *      (10-01) — the qualification, alliance selection and playoff point
 *      formulas reconciled against real values The Blue Alliance reports.
 *   6. `npx vitest run packages/core/districts/selectionModel.reconciliation.test.ts`
 *      (10-04) — the progressive captain rule and the serpentine draft order
 *      reconciled against every 2023 and later eight alliance district event.
 *   7. `SIMULATION_DRAWS` in `apps/web/src/workers/simulationProtocol.ts`
 *      (quick task 260925-rpj) — the 1,000 runs the advancement chance is the
 *      share of. One draw count is shared by every simulation this site runs in
 *      a browser, so the figure on this page is the constant itself rather than
 *      a number typed beside it.
 *
 *   8. `pnpm measure:champ-cutoff`
 *      (`npx tsx scripts/measureChampCutoff.ts`, quick task 260927-6bf, re-run
 *      2026-10-05 on the district tier lock floor of quick task 261005-04t) —
 *      the Champ Locks simulated line's error at the end of each district
 *      season, walk forward over all 69 district seasons: 17.8 points against
 *      40.5 for the midpoint rule at the same position. Its likely range
 *      covered the published line in 49 of 69 seasons, short of the
 *      pre-registered 72% to 88% band. The range is shown anyway (Jacob,
 *      2026-09-27), so the page quotes that coverage. The 2026-09-27 run read
 *      16.4, 41.0 and 49 of 69, on verdicts that already held championship
 *      points. On 2026-10-07, after quick task 261007-jvz's finality cascade,
 *      the run reproduced 18.2, 40.4 and 48 of 69 over 68 seasons exactly,
 *      with 2022isr the one season skipped. Later that day the rail's same
 *      week tie break (district before dcmp, `districtTimeline.ts`) let
 *      2022isr score too: 69 seasons, 17.8 against 40.5, 49 of 69, and the
 *      walk-forward selection moved 2026's setting to uniform/drawn/1.30
 *      (Jacob honored the pre-registered rule, 2026-10-07). Between c4bc0b62 (261005-5g0) and
 *      261007-jvz it read 18.5, 39.0 and 42 of 69 over 62 seasons, because six
 *      curtailed events never read qualification final.
 *
 *   9. `pnpm measure:district-cutoff`
 *      (`npx tsx scripts/measureDistrictCutoff.ts`, fast task 261006, run
 *      2026-10-07 after quick task 261007-jvz's finality cascade, over the
 *      local publish set and the SPR 10.0.0 event
 *      artifacts) — the District Locks simulated line's error against the
 *      tab's own settled cutoff at season start and after each competition
 *      week, walk forward over 203 positions of 47 district seasons, 2023 to
 *      2026: 1.15 points against 1.77 for the midpoint rule at the same
 *      positions. Its likely range held the settled cutoff at 181 of 203
 *      positions, 89.2%, three positions above the pre-registered 72% to 88%
 *      band; the range is shown with that coverage quoted, the champ ruling.
 *      The run before it (261007-il9) read 193 positions of 45 seasons, 1.17
 *      against 1.80 and 171 of 193.
 *      Seasons before 2023 refuse (no playoff bracket model), as the tab does.
 *      Source 8's figures are the Champ Locks tab's alone, and the sentence
 *      carrying them names that tab.
 *
 * THE REWOUND VIEW AND THE CHAMPIONSHIP FIELD PARAGRAPHS CARRY NO MEASURED
 * FIGURE. Since quick task 261005-5g0 a rewound view is an as-of forecast, so
 * the closing open categories paragraph states that rule and no longer says
 * its predictions know more; how well a rewound stop predicts has not been
 * measured.
 *
 * A figure that appears in none of those sources is not written here.
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
      "Once the District Championship alliances are picked, Locked on the Champ Locks tab also counts, for each team, the most rivals that can pass it or take a slot from it in any way the bracket and the awards can still fall, counting each rival once, and locks the team when that count is below the open slots. A championship played in divisions counts every division's bracket and the finals between the division winners. A district with two championships counts both of them.",
      "A team knocked out of the playoffs has its playoff points settled as soon as its alliance's place in the bracket is decided. From then on Locked allows it no more playoff points than that place pays, and counts them as earned once The Blue Alliance posts them.",
      "On the District Locks tab, Locked and Locked out at a rewound point count only the district event points a team had earned by then, never District Championship points.",
      "Once the District Championship has started, the live District Locks view shows who is in its field. A team in the field reads Locked, a team that earned a place and is not in the field reads Declined, and every other team reads Locked out.",
      "The Champ Locks tab predicts each team's finish in the race for the district's FIRST Championship slots, adding the District Championship's own four categories to the district season total. Only the grand total folds in the chance of being there.",
      "At a rewound point before the District Championship starts, the championship is simulated with a field made of the teams that are Locked or In range at that point. A team outside that field reads out of range in the championship row, and its grand total counts district points only.",
      "On the live view, until the championship field is set, a team's championship points are estimated from how teams at the same place in past championship fields scored, using only seasons before the one shown, and the four championship categories read not yet priced. Once the District Championship has started, its own prediction is used and teams not registered at it are left out of the table. A season with no earlier season to learn from shows the district season alone until the field is set.",
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
          "491 brackets and 10,547 rows, 0 mismatches",
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
      "A team registered for an event but absent from its published match schedule earns no qualification, alliance selection or playoff points there, and its event total is its award prediction alone.",
      "An open cell shows either a median with a likely range, or a chance followed by the outcome it measures, with the points that outcome pays on the line beneath. Likely means the 10th to the 90th percentile, and no chance is ever printed as 100 percent.",
      "The Playoffs cell asks about the milestone the bracket has actually reached: the top four before the playoffs, the final once an alliance can no longer finish worse than fourth, and the win once it is in the final. An alliance whose placement is already settled shows the points that placement pays. A team on no alliance once alliance selection is over reads not picked, and only a backup call can still earn it playoff points.",
      "An elimination match already played is taken as played rather than priced again, so every run starts from the bracket as it stands. The chance therefore moves as the playoffs go on.",
      "Clicking a Playoffs, Awards or Alliance selection cell lists the outcomes that category can pay rather than drawing a histogram. Each row names one outcome and carries the share of runs that produced it, read from the same runs the cell's own figure comes from. Rows the bracket or the ranking has already ruled out are left off.",
      "The Alliance selection cell names the likelier of the two routes onto a playoff alliance, either captaining one or being picked onto one. The points alone cannot tell those two apart, because a captain and a first pick earn the same amount on the same alliance. Once qualification is over the ranking is settled, so the cell prints the exact points and the alliance the draft gives that team.",
      "Every team still in the points race also carries its chance of qualifying on district points, which is the share of 1,000 runs where its season total lands inside the qualifying slots. Each team's total is drawn on its own, so the runs miss the fact that two teams at one event compete for the same points. A chance never moves a status, and a team whose place is already settled prints none.",
      "The District Locks tab also prints a predicted cutoff. In each of the 1,000 runs the line is the season total of the last team inside the qualifying slots, taken over the same pool of teams still racing for points that the statuses use. The predicted cutoff is the median of that line across the runs, and the likely range beside it is the 10th to the 90th percentile of the same line.",
      "Teams whose median predicted total sits at or above the predicted cutoff are In range, and teams below it are Out of range. The dashed line on every grand total plot is drawn at the same number. Locked, Locked out and Prequalified are guarantees and never depend on the cutoff.",
      "Until the runs finish those two chips read Pending and no cutoff is printed. Where the runs fail or cannot be set up they read No call and no cutoff is printed.",
      "At the season start and after each competition week of 47 district seasons, 2023 to 2026, predicted only from the matches already played, the simulated line missed the cutoff the season settled on by 1.2 points on average over 203 positions, against 1.8 for the midpoint rule at the same positions. Its likely range held the settled cutoff at 181 of those 203 positions, 89%, where a range this wide should hold about 80%. The settled cutoff is the one this tab prints once every team has finished, not the line The Blue Alliance publishes, which ranks a different total.",
      "Once every team still racing for points has finished its season, nothing is drawn any more. The cutoff is then the midpoint of the last team inside the slots and the first team outside them, which is the midpoint rule. The midpoint rule also applies, with no likely range, where the runs left out a team whose season total could not be built, because they ranked a smaller field.",
      "The Champ Locks tab reads its predicted cutoff the same way, with one step added. In each run the District Championship winning alliance and its Impact, Engineering Inspiration and Rookie All Star winners are drawn and take their slots first, and the line is read from the teams left. Award winners come from that season's district winners of the same award, and each award's count starts from the number the district gave the season before.",
      "Teams at or above that line are In range and teams below it are Out of range. Until the runs finish those two chips read Pending, and where no line can be drawn they read No call. Once the District Championship awards are posted nothing is drawn any more, and the midpoint rule applies.",
      "On the Champ Locks tab, at the end of each district season and predicted only from the seasons before it, the simulated line missed the published line by 17.8 points on average over 69 district seasons, against 40.5 for the midpoint rule. Its likely range, the 10th to the 90th percentile of that line across the runs, held the published line in 49 of 69 seasons, 71%, where a range this wide should hold about 80%.",
      "On the Champ Locks tab a run also counts a team as qualified when it lands on the winning alliance or draws one of those awards.",
      "A rewound view predicts every match still ahead from the ratings and odds as they stood at that stop. An event whose schedule was not yet posted then is predicted over generated schedules, as an event that has not started is. A playoff stop, Round 1 to Round 5 or Finals, keeps the real result of every set played by then and predicts the rest.",
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
          "The eight alliance double elimination bracket, with every match still to be played priced from the two alliances' published ratings.",
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
      "Impact and Rookie All Star are priced separately, by where a team sits in its event's field rather than by that table. The team with the most earlier Impact wins, ties broken by earlier judged awards, wins Impact 26.1% of the time, and the lowest numbered rookie wins Rookie All Star 38.1% of the time. The rest of the judged awards are drawn from a table with those two taken out.",
      "The full table, its sample sizes and the cells that cannot be scored are on the Predicting awards page.",
      "Two awards at one event are never a predicted outcome. The tables did measure teams that won Rookie All Star and a judged award, or Impact and one more, and that share of the mass is moved onto the higher award of the pair instead. The most it costs any 2026 rate is 0.022 of a point of expected award points, which buys an award cell that never offers an outcome a reader should not plan around.",
      "No award prediction moves a team's status. A Locked verdict stays a guarantee.",
      "A team with no published award profile is priced as a veteran with no prior judged awards.",
      "One qualification slot is held back for every district event whose Impact award is still to come. The Impact winner at a district event takes a slot, so a team is never told it is Locked on a slot an award is about to claim. A slot held back this way returns to the points race as soon as that award is posted.",
    ],
  },
  {
    id: "how-well-the-bracket-pricer-works",
    heading: "How well the bracket pricer works",
    paragraphs: [
      "The browser prices an alliance from two numbers a published event file already carries for every team: its rating and its own uncertainty.",
      "This is an approximation of the number the site publishes, not the same calculation. Over 20,371 played matches in 2026 the two sit 0.0555 apart on average, and half the time within 0.0420.",
    ],
    table: {
      caption: "The browser's number against the site's own, over 20,371 played matches in 2026",
      head: ["Measure", "Value"],
      rows: [
        ["Mean absolute gap against the published win probability", "0.0555"],
        ["Median absolute gap", "0.0420"],
        ["Ninetieth percentile absolute gap", "0.1225"],
        ["Matches where the two pick different winners", "4.53%"],
        ["Brier, the number the browser computes", "0.1469"],
        ["Brier, the number the site publishes", "0.1450"],
        ["Brier, a coin", "0.2494"],
        ["Brier, the sign of the rating difference alone", "0.2123"],
      ],
    },
  },
  {
    id: "what-this-does-not-model",
    heading: "What this does not model",
    paragraphs: ["Each limit below is recorded in the code that produced the numbers above."],
    table: {
      caption: "Limits",
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
          "Under 24 teams, the simulation seats whole alliances from the top seed down and the rest forfeit",
          "The pattern measured at 5 of 5 such district events.",
        ],
        [
          "An event nobody has played is priced from each team's current rating over generated schedules",
          "The schedule The Blue Alliance will publish is not known when those numbers are baked.",
        ],
        [
          "A team with no result yet this season is rated as SPR rates a team it has not seen",
          "Its uncertainty is the league's prior for that rating, not anything the team has shown.",
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
