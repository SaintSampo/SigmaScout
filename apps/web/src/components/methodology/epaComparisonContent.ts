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
export const EPA_SAME_ITEM_IDS = ["rating-update"] as const;
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
];

/**
 * The pinned difference-card id set, in the page's own display order.
 * Pinned by equality in `epaComparisonContent.test.ts`, and matched against
 * the rendered article testids in DOM order by
 * `methodology.epa-vs-statbotics.test.tsx`.
 */
export const EPA_DIFFERENCE_CARD_IDS = ["week-one-numbers"] as const;
export type EpaDifferenceCardId = (typeof EPA_DIFFERENCE_CARD_IDS)[number];

export interface EpaDifferenceCard {
  readonly id: EpaDifferenceCardId;
  readonly title: string;
  readonly statbotics: string;
  readonly sigmascout: string;
  readonly notes: readonly EpaCardNote[];
}

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
