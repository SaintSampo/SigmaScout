/**
 * Content-as-data for `/methodology/epa-vs-statbotics` (quick task 260912-tib,
 * a from-scratch rewrite of the page body). This module is the single source
 * of every prose string the page renders: the title, the lead, the three
 * section headings, the "Same on both sites" list, the "Where they differ"
 * comparison cards, and the "How much it matters" head-to-head intro and
 * summary sentence. `epaComparisonContent.test.ts` pins the exact id sets by
 * equality and runs voice, fact and liability gates over every exported
 * string, so a silently added, dropped or reworded entry fails loudly.
 *
 * Audience: the FRC community (students, mentors, scouts) the rest of the
 * site is written for. Voice rules, binding on every string here: no em dash
 * or en dash, short declarative sentences, no hedging openers, no sentence
 * that restates the previous one, neutral between the two sites, and a term
 * is explained the first time it appears, in the same sentence.
 *
 * Facts come from `docs/models/epa-statbotics-gap.md`, `docs/models/
 * epa-divergences.md`, and `packages/core/algorithms/{epa,carryover,
 * epaCarryScale}.ts`. No accuracy or Brier literal appears anywhere in this
 * module except the three 2024 score-piece figures (73.5, 74.0, 75.2), which
 * were already published on the prior version of this page.
 *
 * The published `v1/methodology/epa-vs-statbotics.json` artifact still
 * carries an `agreement` array (`EpaComparisonArtifactSchema` still requires
 * it). This page deliberately does not render it (Jacob, 2026-09-12).
 */

export const EPA_COMPARISON_PAGE_TITLE = "Our EPA vs Statbotics' EPA";

export const EPA_COMPARISON_LEAD =
  "SigmaScout and Statbotics both publish EPA (Expected Points Added), a rating of how many points an FRC team adds to its alliance's score. Most of the calculation is the same on both sites. This page lists what is shared, where the two differ, and how much the differences change match predictions.";

export const EPA_SAME_SECTION_HEADING = "Same on both sites";
export const EPA_DIFFERENCE_SECTION_HEADING = "Where they differ";
export const EPA_HEAD_TO_HEAD_SECTION_HEADING = "How much it matters";

export const EPA_HEAD_TO_HEAD_INTRO =
  "This table shows how often each site's EPA picked the winner of a match, and each one's Brier score. A Brier score measures how close predicted win probabilities came to what actually happened. Lower is better, and 0 would mean a perfect prediction every time.";

export const EPA_CARD_STATBOTICS_LABEL = "Statbotics";
export const EPA_CARD_SIGMASCOUT_LABEL = "SigmaScout";

/** The two note labels a difference card's notes are allowed to carry. */
export type EpaNoteLabel = "Why" | "What it changes";

export interface EpaCardNote {
  readonly label: EpaNoteLabel;
  readonly text: string;
}

/**
 * The pinned shared-list id set, in the page's own display order.
 * `epaComparisonContent.test.ts` asserts this exact array by equality, not
 * by iteration, so a silently added or removed item fails loudly.
 */
export const EPA_SAME_ITEM_IDS = [
  "rating-update",
  "elimination-matches",
  "win-probability-curve",
  "fouls-in-predictions",
  "new-season-carryover",
  "no-uncertainty-range",
] as const;
export type EpaSameItemId = (typeof EPA_SAME_ITEM_IDS)[number];

export interface EpaSameItem {
  readonly id: EpaSameItemId;
  readonly text: string;
}

export const EPA_SAME_ITEMS: readonly EpaSameItem[] = [
  {
    id: "rating-update",
    text: "After every match, each team's rating moves part of the way toward what that match showed. Both sites use the same formula, and on both the learning rate (how far one match can move a rating) starts high and settles as a team plays more matches.",
  },
  {
    id: "elimination-matches",
    text: "Elimination matches count one third as much as qualification matches, and they do not add to a team's match count.",
  },
  {
    id: "win-probability-curve",
    text: "Win probability comes from the same logistic curve, an S-shaped curve that turns the predicted score gap without foul points into a chance of winning.",
  },
  {
    id: "fouls-in-predictions",
    text: "Fouls are added back into predicted scores the same way: both alliances' scores are multiplied by one shared number, so fouls never change which alliance is favored.",
  },
  {
    id: "new-season-carryover",
    text: "A team's first rating in a new season uses the same formula: 70 percent of last season's rating plus 30 percent of the season before, pulled 40 percent of the way back toward a starting value slightly below average.",
  },
  {
    id: "no-uncertainty-range",
    text: "EPA is a single number on both sites, with no ± range showing how uncertain it is.",
  },
];

/**
 * The pinned difference-card id set, in the page's own display order.
 * Pinned by equality in `epaComparisonContent.test.ts`, and matched against
 * the rendered article testids in DOM order by
 * `methodology.epa-vs-statbotics.test.tsx`.
 */
export const EPA_DIFFERENCE_CARD_IDS = [
  "week-one-numbers",
  "score-pieces",
  "new-season-start",
  "score-data-cleanup",
  "season-adjustments",
  "ranking-points",
  "offseason-events",
] as const;
export type EpaDifferenceCardId = (typeof EPA_DIFFERENCE_CARD_IDS)[number];

export interface EpaDifferenceCard {
  readonly id: EpaDifferenceCardId;
  readonly title: string;
  readonly statbotics: string;
  readonly sigmascout: string;
  readonly notes: readonly EpaCardNote[];
}

/**
 * Fouls stay folded into `week-one-numbers` rather than getting their own
 * card (Claude's discretion, per this task's CONTEXT.md): prediction-time
 * foul handling is now identical on both sites (see `EPA_SAME_ITEMS`'s
 * `fouls-in-predictions` entry above), and the only remaining difference is
 * the week-1 rate, which this card already covers.
 */
export const EPA_DIFFERENCE_CARDS: readonly EpaDifferenceCard[] = [
  {
    id: "week-one-numbers",
    title: "Season numbers from week 1",
    statbotics:
      "Takes the score spread (how widely alliance scores vary) and the foul rate (how many extra points fouls add on average) from all of week 1, once week 1 is over. Uses both for every match, week 1 included.",
    sigmascout:
      "Uses the same week 1 numbers from week 2 on. During week 1, uses running estimates built from the matches already played.",
    notes: [
      { label: "Why", text: "A week 1 prediction cannot use week 1 matches that have not happened yet." },
      {
        label: "What it changes",
        text: "How confident week 1 predictions are, and how large their predicted scores are. This difference never changes a winner pick, because dividing the score gap by a different positive number, or scaling both scores by the same amount, cannot flip which alliance is ahead.",
      },
    ],
  },
  {
    id: "score-pieces",
    title: "How a score is split into pieces",
    statbotics:
      "Rates a list of about 18 numbers per team. The list overlaps itself: a total sits next to the pieces it is made of. In most seasons the predicted score reads only one entry, the total without fouls. In 2018 and 2023 it reads seven pieces through caps and curves, and 2018 also reads three of the other alliance's pieces.",
    sigmascout:
      "Rates pieces that do not overlap and adds all of them up. The 2026 split is finer: four separate hub shifts, where Statbotics uses two pairs.",
    notes: [
      {
        label: "Why",
        text: "Measured on 2024: three pieces (one per match phase) picked 75.2 percent of winners, a single total picked 74.0 percent, and eleven pieces picked 73.5 percent. These three figures come from one measurement and compare only with each other, not with the table below.",
      },
    ],
  },
  {
    id: "new-season-start",
    title: "Starting ratings in a new season",
    statbotics:
      "Splits a team's starting rating across scoring pieces by what each piece was worth in week 1. Converts a carried-over rating (the one brought forward from last season) into the new game's point scale using week 1 numbers it already has. Makes one exception in 2026: Israeli district teams are not pulled back toward average, because they did not compete before the Championship.",
    sigmascout:
      "Splits a starting rating evenly across pieces. Converts a carried-over rating only once 250 alliance scores from the new season are in, so a team that plays before then keeps its rating unconverted. Makes no exception for any group of teams.",
    notes: [{ label: "Why", text: "Nobody knows a new game's scoring scale before it has been played." }],
  },
  {
    id: "score-data-cleanup",
    title: "Cleaning up FIRST's score data",
    statbotics:
      "Corrects the score breakdowns (the detailed per-match scoring records) it gets from The Blue Alliance before rating. Fixes sensor miscounts in 2022, counts game pieces from the field grids in 2019 and 2023, removes bonus points in 2016 and 2017, reworks 2025's algae points, and patches a few individual matches by hand.",
    sigmascout: "Uses the official point values as reported. These corrections have not been adopted yet.",
    notes: [{ label: "What it changes", text: "The two sites rate exactly the same score data only in 2024." }],
  },
  {
    id: "season-adjustments",
    title: "Season-specific adjustments",
    statbotics: "Adjusts predictions in some seasons: 2018 for the switch and scale, plus 2023 and 2025.",
    sigmascout: "Applies no season-specific adjustments.",
    notes: [{ label: "Why", text: "A deliberate choice that keeps the calculation identical in every season." }],
  },
  {
    id: "ranking-points",
    title: "Ranking points",
    statbotics:
      "Also predicts ranking points, the points that order teams in the qualification standings. In 2016 and 2017 elimination matches, mixes those predictions into the predicted score.",
    sigmascout: "Predicts scores and winners only, never ranking points.",
    notes: [{ label: "Why", text: "A deliberate choice by SigmaScout's developer." }],
  },
  {
    id: "offseason-events",
    title: "Offseason events",
    statbotics: "Ignores offseason events entirely.",
    sigmascout:
      "Includes offseason matches, and they can move a rating. The rating on the Teams list and team pages, and a team's starting point for next season, both come from its last official match.",
    notes: [{ label: "What it changes", text: "Nothing for predictions of official matches." }],
  },
];

/**
 * The head-to-head summary sentence, its season count ALWAYS derived from
 * the artifact's own head-to-head rows (never a hardcoded number) — the
 * page must not go stale against its own table. `statboticsAheadCount` is
 * the count of seasons where Statbotics' own accuracy exceeds SigmaScout's;
 * `totalSeasons` is the number of seasons carrying a real comparison
 * (`ourWinnerAccuracy` and `statboticsWinnerAccuracy` both present).
 */
export function headToHeadSummarySentence(statboticsAheadCount: number, totalSeasons: number): string {
  if (totalSeasons === 0) {
    return "No seasons have a published head-to-head comparison yet.";
  }
  if (statboticsAheadCount === 0) {
    return `SigmaScout matched or beat Statbotics on winner accuracy in every one of the ${totalSeasons} measured seasons.`;
  }
  if (statboticsAheadCount === totalSeasons) {
    return `Statbotics had the higher winner accuracy in all ${totalSeasons} measured seasons.`;
  }
  return `Statbotics had the higher winner accuracy in ${statboticsAheadCount} of ${totalSeasons} measured seasons.`;
}
