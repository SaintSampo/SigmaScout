/**
 * Content-as-data for `/methodology/spr` (quick task 260910-vof). Same
 * discipline as `sigmaContent.ts`: this module is the single source of every
 * prose string the page renders, so `sprContent.test.ts` can pin the section
 * set by equality and check every string for voice and fact violations
 * without a second hand-typed copy anywhere.
 *
 * Audience: FRC students and mentors. Plain language first, precise second.
 *
 * UNLIKE `sigmaContent.ts`, this module carries NO dash ban. The person who
 * commissioned the Sigma Score page asked for no hyphens there; nobody asked
 * for that here, and this page needs hyphenated compounds to stay accurate
 * (`foul-adjusted`, `least-squares`). Do not add a dash gate to
 * `sprContent.test.ts` on the strength of the sibling file's pattern.
 *
 * NOTE ON THIS COMMENT AND THIS FILE'S OTHER COMMENTS: the gates in
 * `sprContent.test.ts` run at RUNTIME over the exported string VALUES, never
 * as a grep over this file's source text. That is what lets this comment (and
 * others below) discuss the internal algorithm id `bpr` and the retired
 * 78.05% sealed-holdout figure in prose, while the page itself, which reads
 * only the exported values, states neither.
 */

export const SPR_PAGE_TITLE = "What SPR measures";

export const SPR_LEAD =
  "SPR, short for Sigma Power Rating, is the rating SigmaScout uses to rank teams. This page explains what the number is, why it is never a solo score, and where it stops.";

export const SPR_SECTION_IDS = ["what-the-number-is"] as const;
export type SprSectionId = (typeof SPR_SECTION_IDS)[number];

export interface SprSection {
  readonly id: SprSectionId;
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export const SPR_SECTIONS: readonly SprSection[] = [
  {
    id: "what-the-number-is",
    heading: "What the number is",
    paragraphs: [
      "SPR states one number: how many points per match a team is expected to contribute to its alliance's score. The score itself is foul-adjusted first, so SPR describes what the robot actually did on the field rather than what the scoreboard read.",
      "A team's SPR is exactly one third of what an alliance built from three copies of that robot would be predicted to score. That is not a loose comparison. SPR's rank weights are renormalized to sum to three by construction, so three identical ratings always add up to exactly three times the rating, which is what makes the one third framing precise.",
    ],
  },
];
