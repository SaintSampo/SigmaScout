/**
 * Content-as-data for `/methodology/epa-vs-statbotics` (quick task
 * 260908-n5o Task 3; revised same day after reviewing the shipped page —
 * see `packages/harness/pageArtifacts.ts`'s `EpaComparisonAgreementRowSchema`
 * doc comment for the measurement that prompted it), the same discipline
 * `acknowledgmentsContent.ts` already established: this module is the
 * single source of every prose string the page renders, so
 * `epaComparisonContent.test.ts` can pin the exact set of differences and
 * check every string for voice violations without a second hand-typed copy
 * anywhere.
 *
 * Audience: the same FRC community (students, mentors, scouts) the rest of
 * the site is written for. Voice rules, binding on every string here: no em
 * dash characters, short declarative sentences, no hedging openers ("it's
 * worth noting", "importantly", "in essence"), no sentence that restates the
 * previous one in different words, neutral between the two ratings, and a
 * term is explained the first time it appears, in the same sentence.
 *
 * Source material for the three entries below is `docs/models/
 * epa-divergences.md` sections 4, 6 and 3 — reworded here from scratch for a
 * student audience rather than pasted, since that document is written for a
 * maintainer.
 *
 * REVISED 2026-09-11 (quick task 260911-gfe): the `component-maps` entry. What
 * it used to say was that Statbotics groups FIRST's raw scoring fields into
 * pieces using its own table, and that the two sites group those pieces
 * differently in some seasons. Nobody had verified that. The recovered
 * reference (`docs/models/statbotics-breakdown-reference.md`, and the 2026-09-10
 * verification it builds on) shows Statbotics' per-season key list is a
 * RATED-QUANTITY MENU, not a partition: it carries the no-foul total beside the
 * three phase pieces that total is the sum of, and its finer keys sit inside
 * those phases. For 2024 its predicted score comes from one directly rated
 * quantity. So the difference is one of KIND, not of grouping, and the entry now
 * says that. What survives unchanged: the thin-evidence argument, and the
 * 73.5 / 75.2 / 74.0 percent figures from quick task 260910-4x0's partition
 * sweep. The single-piece figure is now named as the shape Statbotics uses,
 * because that is what makes it the interesting one. The `heading` is
 * deliberately UNCHANGED: the developer named this exception by that phrase, and
 * "how a match score is split into pieces" still describes a difference in which
 * one site splits and the other does not. The id set stays at three; see below.
 *
 * NOT REVISED for `epa@8.0.0+baseline` (quick task 260911-3kc, 2026-09-11), and
 * that is deliberate. 8.0.0 corrected the SEASON-BOUNDARY SCALE ANCHOR: a
 * carried rating now enters a new season in that season's point units. It is a
 * real divergence-narrowing, but this page's difference set is PINNED at three
 * ids by a locked decision recorded below, and a fourth entry is exactly the
 * "add it for completeness" instinct that decision rules out. What a reader
 * should know: the numbers this page RENDERS come from the published
 * `v1/methodology/epa-vs-statbotics.json`, which was generated under 7.0.0 and
 * is STALE until the republish that 8.0.0 owes.
 *
 * REVISED 2026-09-10 (quick task 260910-5ym) for `epa@7.0.0+baseline`, which
 * changed the facts under two of the three entries. `win-probability-scale`
 * gained a paragraph on the season boundary: the running spread measure used
 * to carry its observation count across seasons, so it pooled every season
 * ever replayed and stopped being per-season at all; it now re-seeds. And
 * `component-maps` said 2024 "kept five separate scoring pieces that
 * Statbotics grouped into fewer", which is now BACKWARDS — 2024 rates three
 * phase pieces, and is one of the coarser seasons rather than the finest.
 * Its measured accuracy figures (73.5 / 75.2 / 74.0 percent) are quoted from
 * quick task 260910-4x0's partition sweep and are the reason the page can
 * say the choice was measured rather than preferred. The offseason-matches difference (section 7) was DROPPED in
 * this revision, not merely reworded: it explained an "offseason on versus
 * off" stat table that measured a quantity nobody is shown anywhere on this
 * site. The other four EXCLUDED differences (fouls handling, EPA carrying no
 * plus-or-minus of its own, the now-closed elimination-match divergence, and
 * the rebuilt-from-scratch framing — the acknowledgments page already owns
 * that last one) remain deliberately absent. Do not add a fourth entry for
 * completeness; that reviewer instinct is exactly what this task's locked
 * decisions rule out.
 */
export interface EpaDifferenceEntry {
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

/**
 * The pinned id set (order is the page's own display order). A future
 * difference gets a fourth id here only by a deliberate, separate decision —
 * `epaComparisonContent.test.ts` asserts this exact array by equality, not
 * by iteration, so a silently-added or silently-removed entry fails loudly.
 */
export const EPA_DIFFERENCE_IDS = ["win-probability-scale", "component-maps", "no-per-year-tweaks"] as const;

export const EPA_COMPARISON_LEAD =
  "SigmaScout and Statbotics both publish a rating called EPA for every FRC team. The two numbers do not always match. This page explains the three biggest reasons why, and shows real measured numbers instead of a guess.";

export const EPA_DIFFERENCE_ENTRIES: readonly EpaDifferenceEntry[] = [
  {
    id: "win-probability-scale",
    heading: "How win probability is scaled",
    paragraphs: [
      "Predicting a winner means turning a predicted score difference into a probability. Both sites do this the same way, a logistic curve, and both divide the score difference by a measure of how spread out scores are that season. That divisor decides how big a lead has to be before a prediction becomes confident.",
      "Statbotics uses one number for the whole season, calculated only once the season is over. SigmaScout uses a running measure that only knows about matches played so far.",
      "This is what makes walk forward prediction possible. Walk forward means predicting a match using only data from before that match was played, never data from later in the season. A Week 1 prediction built from a season-end number would be cheating: it would know things about the season that had not happened yet.",
      "Every season gets its own measure. Scoring scales change enormously between FRC games, so a lead that decides a match in one season is a rounding error in another. At each season boundary SigmaScout keeps the previous season's spread as a starting guess and then lets the new season's own matches replace it, which takes about one event.",
    ],
  },
  {
    id: "component-maps",
    heading: "How a match score is split into pieces",
    paragraphs: [
      "A match score can be broken into pieces: points scored in the autonomous period, points scored by the drivers, points scored at the end of the match. SigmaScout rates each piece separately for every team, then adds the pieces back together to predict a score.",
      "Statbotics predicts from a single number instead. For 2024 it rates one quantity per alliance, the match score with penalty points taken out, and predicts directly from that. It does publish piece by piece figures beside it, and those are worth reading, but they are extra views rather than the thing its predicted score is built from. Several of them overlap, counting the same points at two levels of detail at once.",
      "So the two sites are not slicing the same score two different ways. One rates several pieces and adds them up. The other rates one total. For 2024 the three pieces SigmaScout rates are the three phases of a match, which is also the split Statbotics uses when it checks its own numbers add up.",
      "How finely to slice matters more than it sounds. Each piece is rated separately from roughly a dozen qualification matches per team, so more pieces means each one is estimated from the same thin evidence and carries more noise. Adding those noisy pieces back together makes a noisier predicted score.",
      "Slicing 2024 more coarsely was a measured change, not a preference. Rating eleven scoring pieces predicted 73.5 percent of 2024 winners correctly. Rating three predicted 75.2 percent. Rating a single total, which is the shape Statbotics uses, predicted 74.0 percent. There is a best middle and it is neither the finest nor the coarsest slicing.",
      "Neither approach is more correct. They are different choices about how much detail to rate, and a different choice can shift a rating without changing anything that happened on the field.",
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
  "This table compares SigmaScout's EPA to Statbotics' EPA for every team with at least 12 matches in a season. The SigmaScout number is each team's rating as of its own last official match, the same number shown on the Teams list and at the top of a team page. A slope below 1 means SigmaScout's numbers are more compressed than Statbotics' numbers. A correlation near 1 means the two ratings agree on which teams are strong, even when the exact numbers differ. Mean absolute difference is measured in points: the average size of the gap between the two ratings for one team.";

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
