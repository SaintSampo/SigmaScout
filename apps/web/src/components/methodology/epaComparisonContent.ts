/**
 * Content-as-data for `/methodology/epa-vs-statbotics` (quick task
 * 260908-n5o Task 3), the same discipline `acknowledgmentsContent.ts`
 * already established: this module is the single source of every prose
 * string the page renders, so `epaComparisonContent.test.ts` can pin the
 * exact set of differences and check every string for voice violations
 * without a second hand-typed copy anywhere.
 *
 * Audience: the same FRC community (students, mentors, scouts) the rest of
 * the site is written for. Voice rules, binding on every string here: no em
 * dash characters, short declarative sentences, no hedging openers ("it's
 * worth noting", "importantly", "in essence"), no sentence that restates the
 * previous one in different words, neutral between the two ratings, and a
 * term is explained the first time it appears, in the same sentence.
 *
 * Source material for the four entries below is `docs/models/
 * epa-divergences.md` sections 7, 4, 6 and 3 — reworded here from scratch
 * for a student audience rather than pasted, since that document is written
 * for a maintainer. The four EXCLUDED differences (fouls handling, EPA
 * carrying no plus-or-minus of its own, the now-closed elimination-match
 * divergence, and the rebuilt-from-scratch framing — the acknowledgments
 * page already owns that last one) are deliberately absent. Do not add a
 * fifth entry for completeness; that reviewer instinct is exactly what this
 * task's locked decisions rule out.
 */
export interface EpaDifferenceEntry {
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

/**
 * The pinned id set (order is the page's own display order). A future
 * difference gets a fifth id here only by a deliberate, separate decision —
 * `epaComparisonContent.test.ts` asserts this exact array by equality, not
 * by iteration, so a silently-added or silently-removed entry fails loudly.
 */
export const EPA_DIFFERENCE_IDS = ["offseason-matches", "win-probability-scale", "component-maps", "no-per-year-tweaks"] as const;

export const EPA_COMPARISON_LEAD =
  "SigmaScout and Statbotics both publish a rating called EPA for every FRC team. The two numbers do not always match. This page explains the four biggest reasons why, and shows real measured numbers instead of a guess.";

export const EPA_DIFFERENCE_ENTRIES: readonly EpaDifferenceEntry[] = [
  {
    id: "offseason-matches",
    heading: "Offseason matches",
    paragraphs: [
      "An offseason event is a competition played outside the official FIRST season, often over the summer or in the fall. SigmaScout replays offseason matches and lets them move a team's rating. Statbotics never sees an offseason match at all: no event page, no rating update, no prediction.",
      "This is the single biggest reason the two ratings disagree. A team that plays a lot of offseason events can end up rated differently on SigmaScout than on Statbotics, simply because SigmaScout has seen more of that team's play.",
      "As of September 2026 this gap narrowed. A team's rating now carries into the next season from its last official match, not its last match of any kind, so an exhibition result in November can no longer change a rating in February. Offseason matches still move a rating within the season they happen in.",
    ],
  },
  {
    id: "win-probability-scale",
    heading: "How win probability is scaled",
    paragraphs: [
      "Predicting a winner means turning a predicted score difference into a probability. Both sites do this the same way, a logistic curve, and both divide the score difference by a measure of how spread out scores are that season.",
      "Statbotics uses one number for the whole season, calculated only once the season is over. SigmaScout uses a running measure that only knows about matches played so far.",
      "This is what makes walk forward prediction possible. Walk forward means predicting a match using only data from before that match was played, never data from later in the season. A Week 1 prediction built from a season-end number would be cheating: it would know things about the season that had not happened yet.",
    ],
  },
  {
    id: "component-maps",
    heading: "How a match score is split into pieces",
    paragraphs: [
      "A game like FRC scores points in pieces: autonomous points, teleop points, endgame points, and finer pieces inside those. Statbotics groups the raw scoring fields FIRST publishes into these pieces using its own table.",
      "SigmaScout built its own table instead, checked directly against the matches it has stored. In some seasons the two sites group scoring pieces differently. In 2024, for example, SigmaScout kept five separate scoring pieces that Statbotics grouped into fewer.",
      "Neither grouping is more correct. They are different choices about how finely to slice the same total score, and a different slicing can shift a rating without changing anything that happened on the field.",
    ],
  },
  {
    id: "no-per-year-tweaks",
    heading: "No per-year adjustments",
    paragraphs: [
      "Statbotics applies small corrections on top of its raw rating in specific seasons. In 2018, for example, it runs the rating through an extra curve before publishing it.",
      "SigmaScout applies no season-specific corrections, in any season. Whatever the underlying rating calculation produces is what gets published, every year, the same way.",
      "This is a deliberate choice, not an oversight. It keeps the calculation identical across every season, at the cost of not smoothing over the handful of season-specific quirks Statbotics has chosen to correct for.",
    ],
  },
];

export const EPA_AGREEMENT_BLOCK_INTRO =
  "This table compares SigmaScout's EPA to Statbotics' EPA for every team with at least 12 matches in a season, offseason matches included. A slope below 1 means SigmaScout's numbers are more compressed than Statbotics' numbers. A correlation near 1 means the two ratings agree on which teams are strong, even when the exact numbers differ. Mean absolute difference is measured in points: the average size of the gap between the two ratings for one team.";

export const EPA_OFFSEASON_ARM_BLOCK_INTRO =
  "These are the same three statistics from the table above, measured twice: once with offseason matches included, and once with them excluded. Comparing the two arms shows how much of the disagreement above comes from offseason matches alone.";

export const EPA_HEAD_TO_HEAD_BLOCK_INTRO =
  "This table compares how often each rating correctly predicted the winner of a match, and each rating's Brier score. A Brier score measures how well a predicted probability matched what actually happened. Lower is better, and a score of 0 would mean a perfect prediction every time.";

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
