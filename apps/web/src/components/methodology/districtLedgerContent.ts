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
 *   3. `pnpm measure:award-slate`
 *      (`npx tsx scripts/measureAwardSlate.ts`, quick task 261014-qje, run
 *      2026-10-14; saved as `261014-qje-measure.txt` in that quick task's
 *      directory) — the one award slate both tiers price from: the 2026
 *      expected award counts per district event (DISTRICT TIER 2026 block:
 *      Impact 0.9709, Engineering Inspiration 0.9806, Rookie All Star 0.9091,
 *      other team awards 11.7087) and the point value cross check (29,871
 *      district tier team events, 0 mismatches). The class weights and their
 *      sample sizes live on `/methodology/awards`.
 *   4. (retired) `pnpm measure:district-award-base-rates` and
 *      `pnpm measure:award-ordering-tables` measured the per team award model
 *      261014-qje removed; their figures (26.1%, 38.1%, the 0.022 of a point
 *      fold cost) are history and are not quoted on the page.
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
 *      2026-10-14 by quick task 261014-qje on freshly composed artifacts after
 *      the award draws moved onto the award slate; saved as
 *      `261014-qje-champ-cutoff-after.txt`) — the Champ Locks simulated line's
 *      error at the end of each district season, walk forward over all 69
 *      district seasons: 17.58 points against 39.03 for the same position
 *      naive line (the midpoint rule). Its likely range covered the published
 *      line in 48 of 69 seasons (69.6%), short of the pre-registered 72% to 88%
 *      band. The range is shown anyway (Jacob, 2026-09-27), so the page quotes
 *      that coverage. Before 261014-qje the run read 17.8, 40.5 and 49 of 69.
 *      The 2026-09-27 run read
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
 *      (`npx tsx scripts/measureDistrictCutoff.ts`, quick task 261014-hx6,
 *      run 2026-10-14 on the as-of path at the SPR 11.0.0 event artifacts and
 *      as-of objects: `loadAsOfRewind`, `assembleAsOfDistrictEvents` and
 *      `runAsOfEvent`, the way the District Locks tab prices a rewound stop)
 *      — the District Locks simulated line's error against the tab's own
 *      settled cutoff at season start and after each competition week, walk
 *      forward over 205 positions of 48 district seasons, 2023 to 2026: 1.20
 *      points against 1.93 for the midpoint rule at the same positions (gate
 *      line 1 passes). Its likely range held the settled cutoff at 179 of 205
 *      positions, 87.3%, inside the pre-registered 72% to 88% band (gate line 2
 *      passes, GO). Re-measured 2026-10-14 after the weighted pick draft
 *      (261014-ol6) and the joint event draws (261014-qv2); the fixed draft run
 *      with independent draws read 1.25 against 2.43 and 183 of 205 (89.3%,
 *      gate line 2 failed), and the weighted draft alone 1.19 against 1.93 and
 *      194 of 205 (94.6%). Every one of the seven leak checks passed at 205 of
 *      205 positions. The 1,194 events open at those positions were all
 *      unstarted at the stop and priced by the bake; none read unavailable.
 *      One position, 2024chs, used the midpoint rule with no range because a
 *      team was left out of the runs.
 *      HISTORY: the runs before it, 2026-10-07 (261007-jvz: 203 positions of 47
 *      seasons, 1.15 against 1.77, 181 of 203, 89.2%) and 2026-10-06
 *      (261007-il9: 193 positions of 45 seasons, 1.17 against 1.80, 171 of
 *      193), priced open events with the odds and ratings stored after the
 *      stop, so a week 5 event at season start was priced knowing weeks 1 to
 *      4. Their figures are history and are not quoted on the page.
 *      Seasons before 2023 refuse (no playoff bracket model), as the tab does.
 *      Source 8's figures are the Champ Locks tab's alone, and the sentence
 *      carrying them names that tab.
 *
 * THE REWOUND VIEW PARAGRAPH CARRIES NO MEASURED FIGURE, AND NEITHER DOES THE
 * CHAMPIONSHIP FIELD PARAGRAPH. Since quick task 261005-5g0 a rewound view is
 * an as-of forecast, so the closing open categories paragraph states that
 * rule and no longer says its predictions know more. The District Locks
 * cutoff sentence is measured at rewound stops (source 9), and only that line
 * is: the chips and cells at a rewound stop have no figure of their own. The
 * championship field paragraph has none either, because source 8 scores only
 * the end of each district season.
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
      "A team knocked out of the playoffs has its playoff points settled as soon as its alliance's place in the bracket is decided. From then on Locked allows it no more playoff points than that place pays, and counts them as earned once The Blue Alliance posts them. Until The Blue Alliance posts the number, the grey value reads up to the points that place pays.",
      "A team still playing in the playoffs is credited the playoff points its wins have already secured, before The Blue Alliance posts them. The Blue Alliance shares an alliance's playoff points among its robots by the wins each was on the field for, so a robot that sat out a win has secured less. An open Playoffs cell reads at least that many points, and the earned figure beside the team counts them.",
      "On the District Locks tab, Locked and Locked out at a rewound point count only the district event points a team had earned by then, never District Championship points.",
      "Once the District Championship has started and its points are posted for its whole field, the live District Locks view shows who is in its field. A team in the field reads Locked, a team that earned a place and is not in the field reads Declined, and every other team reads Locked out.",
      "The Champ Locks tab predicts each team's finish in the race for the district's FIRST Championship slots, adding the District Championship's own four categories to the district season total. Only the grand total folds in the chance of being there. A championship played in divisions adds the finals points to the District Championship row once they are earned.",
      "At a rewound point before the District Championship starts, the championship is simulated with a field made of the teams that are Locked or In range at that point. A team outside that field reads out of range in the championship row, and its grand total counts district points only.",
      "On the live view, until the championship field is set, a team's championship points are estimated from how teams at the same place in past championship fields scored, using only seasons before the one shown, and the four championship categories read not yet priced. Once the District Championship has started, its own prediction is used and teams not registered at it are left out of the table. A season with no earlier season to learn from shows the district season alone until the field is set.",
      "Until a championship's points are posted for its whole field, a team not yet listed there is still treated as able to attend.",
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
          "Each team award a team wins at the event pays: 10 for Impact, 8 for Engineering Inspiration or Rookie All Star, and 5 for any other team award that pays points.",
          "29,871 rows, 0 mismatches",
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
      "A category that is already settled shows the points the team earned, not a prediction. A category counts as settled once its points are posted. An event nobody has played yet is priced by the pipeline before the season, and the browser computes nothing for it.",
      "A team registered for an event but absent from its published match schedule earns no qualification, alliance selection or playoff points there, and its event total is its award prediction alone.",
      "An open cell shows either a median with a likely range, or a chance followed by the outcome it measures, with the points that outcome pays on the line beneath. The Playoffs cell names a finish instead, as the next paragraph describes. Likely means the 10th to the 90th percentile, and no chance is ever printed as 100 percent.",
      "The Playoffs cell names a best guess finish: 1st, 2nd, 3rd or 4th, or 5th to 8th. Third and fourth are one finish, and fifth to eighth are another. The best guess is the finish that came up in the most runs, and a tie goes to the better finish.",
      "The line beneath gives the share of runs that ended there and the points that finish pays. A finish the bracket has already ruled out is never the best guess. Where the cell adds up more than one event, as the Champ Locks District points row does, no one finish describes it, and the cell shows a median with a likely range instead.",
      "An alliance whose placement is already settled shows the points that placement pays. A team on no alliance once alliance selection is over reads not picked, and only a backup call can still earn it playoff points. Before then, a team left off every alliance in more than half of the runs reads not picked, with its chance of being on an alliance on the line beneath.",
      "Where the runs report which teams were left off every alliance, fifth to eighth means picked but out of the top four. At an event that has not started, fifth to eighth also counts the runs that left the team off every alliance.",
      "An elimination match already played is taken as played rather than priced again, so every run starts from the bracket as it stands. The best guess and its chance therefore move as the playoffs go on.",
      "Clicking a Playoffs, Awards or Alliance selection cell lists the outcomes that category can pay rather than drawing a histogram. Each row names one outcome and carries the share of runs that produced it, read from the same runs the cell's own figure comes from. Rows the bracket or the announced alliances have already ruled out are left off.",
      "The Playoffs list keeps third and fourth on separate rows, and its headline names the same best guess as the cell.",
      "The Alliance selection cell names the likelier of the two routes onto a playoff alliance, either captaining one or being picked onto one. The points alone cannot tell those two apart, because a captain and a first pick earn the same amount on the same alliance. Once the alliances are announced, the cell prints the exact points and the alliance that team joined.",
      "Every team still in the points race also carries its chance of qualifying on district points, which is the share of 1,000 runs where its season total lands inside the qualifying slots. Every team at one event reads its points from the same run of that event, so two teams there never take the same points, except at an event priced from a stored bake before it started. A chance never moves a status, and a team whose place is already settled prints none.",
      "The District Locks tab also prints a predicted cutoff. In each of the 1,000 runs the line is the season total of the last team inside the qualifying slots, taken over the same pool of teams still racing for points that the statuses use. The predicted cutoff is the median of that line across the runs, and the likely range beside it is the 10th to the 90th percentile of the same line.",
      "Teams whose median predicted total sits at or above the predicted cutoff are In range, and teams below it are Out of range. The dashed line on every grand total plot is drawn at the same number. Locked, Locked out and Prequalified are guarantees and never depend on the cutoff.",
      "Until the runs finish those two chips read Pending and no cutoff is printed. Where the runs fail or cannot be set up they read No call and no cutoff is printed.",
      "At the season start and after each competition week of 48 district seasons, 2023 to 2026, predicted only from the matches already played, the simulated line missed the cutoff the season settled on by 1.2 points on average over 205 positions, against 1.9 for the midpoint rule at the same positions. Its likely range held the settled cutoff at 179 of those 205 positions, 87%, where a range this wide should hold about 80%. The settled cutoff is the one this tab prints once every team has finished, not the line The Blue Alliance publishes, which ranks a different total.",
      "Once every team still racing for points has finished its season, nothing is drawn any more. The cutoff is then the midpoint of the last team inside the slots and the first team outside them, which is the midpoint rule. The midpoint rule also applies, with no likely range, where the runs left out a team whose season total could not be built, because they ranked a smaller field.",
      "The Champ Locks tab reads its predicted cutoff the same way, except that each team's district points are drawn on their own. In each run the District Championship winning alliance and its Impact, Engineering Inspiration and Rookie All Star winners are also drawn and take their slots first, and the line is read from the teams left. The draws pick award winners the same way the award cells are priced.",
      "Teams at or above that line are In range and teams below it are Out of range. Until the runs finish those two chips read Pending, and where no line can be drawn they read No call. Once the District Championship awards are posted nothing is drawn any more, and the midpoint rule applies.",
      "On the Champ Locks tab, at the end of each district season and predicted only from the seasons before it, the simulated line missed the published line by 17.6 points on average over 69 district seasons, against 39.0 for the midpoint rule. Its likely range, the 10th to the 90th percentile of that line across the runs, held the published line in 48 of 69 seasons, 70%, where a range this wide should hold about 80%.",
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
        [
          "Awards",
          "Each event has an expected number of each award, shared among the teams that can win it by how teams like it have won before. District events and District Championships work the same way.",
        ],
      ],
    },
  },
  {
    id: "the-alliance-selection-model",
    heading: "The alliance selection model",
    paragraphs: [
      "The captain at each alliance's turn is the highest ranked team not yet on an alliance. The draft runs alliance 1 through alliance 8 and then alliance 8 back down to alliance 1.",
      "Each pick is drawn from a table of where real picks sat in the line of teams still available, sorted by rating. That table and how it scores are on the Predicting alliance picks page.",
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
    heading: "How awards are predicted",
    paragraphs: [
      "Each event gives a known number of each award. The awards are shared among the teams that can win them. District events and District Championships are priced the same way.",
      "The number of each award is how many an event gave on average in the most recent earlier season. Only the awards on FIRST's list for the season count, so an award FIRST retired adds nothing.",
      "In 2026 a district event was expected to give 0.97 Impact awards, 0.98 Engineering Inspiration awards and 11.71 other team awards. An event with a rookie was expected to give 0.91 Rookie All Star awards.",
      "Engineering Inspiration goes only to veterans, and Rookie All Star only to rookies. A team that won Impact, Engineering Inspiration or Rookie All Star at an earlier district event that season cannot win the same award at a later one. At a District Championship those three awards go only to teams that won the same award at a district event that season.",
      "A team's share rests on how often teams with the same award record won before, in earlier seasons only. For Impact, earlier Impact wins count first and other earlier team awards second. An award record counts every team award that pays district points, won at any event in an earlier season.",
      "The prediction gives a team at most one award at an event, its highest. The weights and their sample sizes are on the Predicting awards page.",
      "No award prediction moves a team's status. A Locked verdict stays a guarantee.",
      "A team with no published award profile is priced as a veteran with no earlier awards.",
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
          "A team's share of an award reads only its earlier awards and whether it is a rookie.",
        ],
        [
          "An award in its first season is priced like the other awards worth the same points",
          "Its expected number is their average, and its winners follow their weights. From its second season it is measured on its own.",
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
          "When the award rows are missing and no team earned award points, the award cell stays open at its predicted odds.",
        ],
        [
          "Awards are picked up for a day after an event's last match",
          "An award posted later arrives when the district next has an event in play, or at the next offline republish.",
        ],
        [
          "A Locked waits until an event's Impact award is listed and its award list has been unchanged for an hour",
          "Until then the places that event's awards can take stay held back. At a district championship the wait also covers the Winner, Engineering Inspiration and Rookie All Star awards. An event missing its Impact award, or a district championship missing its Winner, Engineering Inspiration or Rookie All Star award, is read after twelve unchanged hours.",
        ],
      ],
    },
  },
];
