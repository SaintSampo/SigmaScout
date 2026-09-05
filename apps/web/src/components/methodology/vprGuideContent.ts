/**
 * Content-as-data for the `/methodology/vpr` explainer (quick task
 * 260905-phf Task 2). `VprGuide.tsx` maps this array to `<section>`
 * elements — the single source of section titles and body prose, so
 * `methodology.vpr.test.tsx` can iterate this constant structurally rather
 * than hand-typing a second copy.
 *
 * Audience: high school students in the FRC community. Short sentences, no
 * formulas, no jargon without a plain-language gloss in the same sentence.
 *
 * Every claim below is traceable to a named source file — this task's own
 * closed claim list, checked live against the shipped model before writing:
 *
 *   1. VPR = Variance Power Rating, SigmaScout's own rating.
 *      (07-CONTEXT.md D-04)
 *   2. A VPR number has a rating and a ± that answer two different
 *      questions. (sigma1/index.ts header)
 *   3. The rating: compare expected vs actual alliance score, nudge each
 *      of the three robots' per-component estimates toward explaining the
 *      difference. (sigma1/index.ts header; kalman.ts's updateAllianceSum)
 *   4. The ± is match-to-match swing, recency-weighted — NOT model
 *      uncertainty about the rating. (sigma1/index.ts "WHAT THE ± IS FOR";
 *      swing.ts header)
 *   5. Who it helps: a captain picking first wants low ±; a low seed
 *      hunting an upset wants high ±; a mid-quals partner needs to know
 *      which. (swing.ts's three user stories)
 *   6. No matches played -> no ± shown; absence, not zero. (sigma1/index.ts
 *      D-Y2)
 *   7. Offense only, no defense term — an alliance's final score can't
 *      identify which robot was defended; unexplained shortfall widens the
 *      ± instead. (sigma1/index.ts D-06)
 *   8. A new season starts near last season's rating, but with a much less
 *      certain starting variance. (sigma1/index.ts carrySeason,
 *      carryVarianceFactor)
 *   9. VPR's settings are found by automated search over past seasons, not
 *      hand-picked. (REBUILD_SPEC.md "tuned and adjusted automatically")
 *  10. Every published accuracy number is scored walk-forward — predict
 *      before update, never with hindsight. (.claude/CLAUDE.md methodology
 *      constraint)
 *  11. Closing: VPR is scored head-to-head against OPR and EPA on the
 *      accuracy-comparison page.
 *
 * Two hard prohibitions honored throughout: no numeric accuracy figure of
 * this page's own (no Brier, no accuracy percentage, no season score — all
 * of that lives on the fetched accuracy-comparison page), and no claim that
 * VPR is better than any other rating.
 */
export interface VprGuideSection {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
}

export const VPR_GUIDE_SECTIONS: readonly VprGuideSection[] = [
  {
    id: "what-is-vpr",
    title: "What VPR is",
    paragraphs: [
      "VPR stands for Variance Power Rating. It's SigmaScout's own rating for how good a team is.",
      "Every VPR number you see has two parts written together, like 42.3 ± 8.1. The first number is the rating. The second number, after the ± sign, is a completely different kind of measurement. This page explains what each one means and why they're kept separate.",
    ],
  },
  {
    id: "rating",
    title: "The rating: what a robot contributes",
    paragraphs: [
      "After every match, VPR compares what it expected each alliance to score against what that alliance actually scored. Whatever the difference is, VPR spreads it across the three robots on that alliance, nudging each robot's rating toward whatever best explains the result.",
      "It does this separately for each part of the score — autonomous, teleop, endgame, and the rest — not just the final total. That's how VPR can tell a robot that's strong in autonomous from one that's strong in teleop, even though both only ever play on shared alliances.",
    ],
  },
  {
    id: "swing",
    title: "The ±: how steady, not how sure",
    paragraphs: [
      "It's tempting to read the ± as \"how sure SigmaScout is about the rating.\" That's not what it measures. The ± is how much a robot's contribution swings from match to match, weighted so recent matches count more than old ones.",
      "A robot with a small ± plays about the same every match. A robot with a large ± might dominate one match and barely show up in the next. Two robots can carry the exact same rating and a completely different ±.",
    ],
  },
  {
    id: "who-it-helps",
    title: "Who the ± helps — and when it's blank",
    paragraphs: [
      "An alliance captain picking first wants a robot with a low ± — it needs to know what it's getting. A low-seeded team hunting an upset might want the opposite: a high-± robot, betting on a great match instead of a steady one. A team playing alongside a partner mid-tournament needs to know which kind of robot it just got paired with.",
      "A team that hasn't played a match yet has no swing to measure, so SigmaScout shows no ± for it at all. That's not a zero — a zero would claim the robot never varies, which nobody can say about a team with no matches played. It just means there's nothing to summarize yet.",
    ],
  },
  {
    id: "no-defense",
    title: "Why there's no defense number",
    paragraphs: [
      "VPR measures offense only, on purpose. An alliance's final score can't say which robot on it was playing defense instead of scoring — FRC's match data doesn't record that. Guessing anyway would risk a mistake this project has made before: estimating something the data can't actually support.",
      "When a robot scores less than expected for a reason VPR can't see, like being defended, that shows up as a wider ± instead of being blamed on a defense number that doesn't exist.",
    ],
  },
  {
    id: "new-season",
    title: "A new season starts softer",
    paragraphs: [
      "At the start of a new season, VPR doesn't forget a team completely — it starts each team's rating near where it left off the season before. But it treats that starting point as much less certain, because a team can rebuild its whole robot over the off-season. A handful of real matches quickly override that starting guess.",
    ],
  },
  {
    id: "tested",
    title: "Tested honestly, not hand-picked",
    paragraphs: [
      "VPR's internal settings aren't chosen by feel. An automated search tries many combinations against past seasons of real matches, and the version that performs best on seasons it has already seen is then checked again on seasons it never saw during the search.",
      "Every accuracy number this site publishes — VPR's or anyone else's — is measured the same honest way: predicting each match using only what was known before it was played, then updating afterward. Nothing is scored with the benefit of hindsight.",
    ],
  },
  {
    id: "check-it",
    title: "See it checked",
    paragraphs: [
      "VPR isn't just described here — it's measured, head-to-head against two other well-known ratings, OPR and EPA, season by season.",
    ],
  },
] as const;

/** The example illustration's literal numbers (`swing` section) — not a real team's, per this task's own rule. */
export const VPR_GUIDE_ILLUSTRATION_METRIC = { value: 25.4, spread: 2.1 } as const;

/** The section after whose paragraphs the illustration renders. */
export const VPR_GUIDE_ILLUSTRATION_SECTION_ID = "swing";

/** The section after whose paragraphs the closing link to the accuracy-comparison route renders. */
export const VPR_GUIDE_CLOSING_LINK_SECTION_ID = "check-it";
