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
 * others below) discuss the internal algorithm id `spr` and the retired
 * 78.05% sealed-holdout figure in prose, while the page itself, which reads
 * only the exported values, states neither.
 *
 * Every claim below is verified against `packages/core/algorithms/spr.ts` at
 * HEAD (the module header, `displaySdFactor`, `SPR_PARAMS`, the rank
 * weighting doc comment above `viewOfMap`, `foldRatings`'s credit allocation,
 * and `teamMetrics`), never transcribed from memory or from a prior version
 * of this file.
 */
import { SPR_PARAMS } from "../../../../../packages/core/algorithms/spr.js";

/**
 * The three rank weights `viewOfMap` renormalizes to, recomputed here rather
 * than typed in, so this page's prose sentence cannot drift from the shipped
 * model the way a hand-typed number could. `SigmaPage.tsx`'s own header
 * documents the same never-retype-a-shipping-constant discipline for its
 * figures; this is that discipline applied to prose instead of a drawing.
 */
const RANK_WEIGHT_BASE = [1, SPR_PARAMS.w2, SPR_PARAMS.w3];
const RANK_WEIGHT_SUM = RANK_WEIGHT_BASE.reduce((sum, weight) => sum + weight, 0);
const RANK_WEIGHT_NORM = RANK_WEIGHT_SUM > 0 ? 3 / RANK_WEIGHT_SUM : 1;
const RANK_WEIGHTS = RANK_WEIGHT_BASE.map((weight) => weight * RANK_WEIGHT_NORM) as [number, number, number];
const [RANK_WEIGHT_1, RANK_WEIGHT_2, RANK_WEIGHT_3] = RANK_WEIGHTS;

export const SPR_PAGE_TITLE = "What SPR measures";

export const SPR_LEAD =
  "SPR, short for Sigma Power Rating, is the rating SigmaScout uses to rank teams. This page explains what the number is, why it is never a solo score, and where it stops.";

export const SPR_SECTION_IDS = [
  "what-the-number-is",
  "not-a-solo-score",
  "why-three-do-not-add-up",
  "the-displayed-interval",
  "spr-and-sigma-score-are-different",
  "what-it-does-not-do",
] as const;
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
  {
    id: "not-a-solo-score",
    heading: "Not a solo score",
    paragraphs: [
      "SPR is never a solo measurement. FRC records only alliance totals, never what one robot scored on its own, so every match's surprise, the gap between the predicted alliance score and the actual one, has to be split across the three robots that produced it. The split is not even: each team absorbs a share proportional to its own remaining uncertainty and its expected rank weight, so a team the model is still unsure about moves more, and a team the model expects to contribute less absorbs less.",
      `A team's contribution also depends on who it plays with. Within an alliance the three robots are ranked by rating, and the largest weight is matched to the largest rating: the strongest robot on an alliance counts ${RANK_WEIGHT_1.toFixed(2)} times, the middle robot counts ${RANK_WEIGHT_2.toFixed(2)} times, and the weakest counts ${RANK_WEIGHT_3.toFixed(2)} times. That makes SPR a spread amplifier rather than a suppressor: an alliance built from one star robot and two weak partners is predicted to outscore three mediocre robots carrying the same total rating.`,
      "SPR is also foul-adjusted a second way. Foul points, and the scorekeeper's own manual adjustment correction, are both subtracted from the target before SPR is fit to it, so the number describes robot output rather than scoreboard output.",
    ],
  },
  {
    id: "why-three-do-not-add-up",
    heading: "Why three SPRs do not add up",
    paragraphs: [
      "SPR is not an additive decomposition. Add the SPRs of an alliance's three teams together and the result is not the alliance's predicted score. Three teammates' SPRs simply do not sum.",
      "That is a deliberate difference from OPR. OPR's least-squares definition is built so that an alliance's three OPRs do sum to its predicted score, and a reader coming from OPR will naturally expect SPR to behave the same way. It does not, because of the ranking and foul-adjustment mechanics described above.",
    ],
  },
  {
    id: "the-displayed-interval",
    heading: "The displayed interval",
    paragraphs: [
      "Every SPR ships with a plus or minus range next to it. That range is calibrated separately from the internal variance the filter tracks while it is fitting the rating, because the two are not the same number. The filter's own variance runs wider than what is actually realized, so the raw filter number is never what is shown.",
      "The displayed range is fit separately, against how often the filter's own misses actually landed inside one standard deviation, so the interval next to a team's SPR reads honestly on the page even though the filter's internal math runs wider than that.",
    ],
  },
  {
    id: "spr-and-sigma-score-are-different",
    heading: "SPR and Sigma Score are different numbers",
    paragraphs: [
      "SPR and Sigma Score share their first word, and they answer different questions. SPR is the rating: how many points per match a team is expected to contribute. Sigma Score is a separate number about how much that contribution moves from match to match, and it is published for teams rated under SPR only.",
    ],
  },
  {
    id: "what-it-does-not-do",
    heading: "What it does not do",
    paragraphs: [
      "SPR carries no ranking-point model. It emits no probability mass function for a match's ranking points and cannot drive the rank simulation. That is a deliberate scope boundary, not an omission.",
      "For how well SPR actually predicts match winners, the measured numbers live on the algorithm accuracy page rather than here.",
    ],
  },
];
