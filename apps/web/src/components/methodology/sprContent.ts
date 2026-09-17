/**
 * Content-as-data for `/methodology/spr`, the "What is SPR?" page.
 *
 * Rewritten 2026-09-17 from sketch 018. This one page replaces both the old
 * "What SPR measures" page and the deleted "Sigma Score and the match band"
 * page (`/methodology/sigma` now redirects here). The copy is Jacob's own
 * trim of variant A: a lead and four short sections.
 *
 * Voice rules, binding on every exported string: NO dash characters at all
 * (hyphen minus, en dash, em dash), flat and factual, short declarative
 * sentences. The voice gate runs at RUNTIME over the exported string VALUES
 * in `sprContent.test.ts`, never as a grep over this file's source.
 *
 * DERIVED, NEVER TYPED: the three rank weights are computed from
 * `SPR_PARAMS` (`w2`, `w3`), renormalized to sum to three exactly as
 * `packages/core/algorithms/spr.ts` does, so a retune cannot leave a stale
 * number on the page. The "7 in 10" figure is the alliance band's measured
 * walk forward coverage across 2024 to 2026 (71.6% of 131,961 alliance
 * results); restate it if that measurement is rerun.
 *
 * Never render the internal algorithm id or the retired display label, and
 * never transcribe the retired 78.05% figure.
 */
import { SPR_PARAMS } from "../../../../../packages/core/algorithms/spr.js";

const RANK_WEIGHT_BASE = [1, SPR_PARAMS.w2, SPR_PARAMS.w3];
const RANK_WEIGHT_SUM = RANK_WEIGHT_BASE.reduce((sum, weight) => sum + weight, 0);
const RANK_WEIGHT_NORM = RANK_WEIGHT_SUM > 0 ? 3 / RANK_WEIGHT_SUM : 1;
const RANK_WEIGHTS = RANK_WEIGHT_BASE.map((weight) => weight * RANK_WEIGHT_NORM) as [number, number, number];
const [RANK_WEIGHT_1, RANK_WEIGHT_2, RANK_WEIGHT_3] = RANK_WEIGHTS;

export const SPR_PAGE_TITLE = "What is SPR?";

export const SPR_LEAD =
  "SPR (Sigma Power Rating) is the rating SigmaScout uses to rank teams and predict matches. It estimates how many points a team adds to its alliance's score in a match.";

export const SPR_SECTION_IDS = [
  "what-the-number-is",
  "the-strongest-robot-counts-most",
  "the-plus-or-minus",
  "the-bars-on-a-match-row",
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
      "SPR is points per match. FRC records only alliance scores, never what one robot scored, so SPR is worked out from alliance results with foul points removed.",
    ],
  },
  {
    id: "the-strongest-robot-counts-most",
    heading: "The strongest robot counts most",
    paragraphs: [
      `Three SPRs do not add up to the alliance's predicted score the way three OPRs do. Within an alliance the strongest robot counts ${RANK_WEIGHT_1.toFixed(2)} times, the middle robot ${RANK_WEIGHT_2.toFixed(2)} times and the last robot ${RANK_WEIGHT_3.toFixed(2)} times.`,
    ],
  },
  {
    id: "the-plus-or-minus",
    heading: "The ± next to it",
    paragraphs: [
      "The second number is called Sigma. It is how much a team's contribution moves from match to match. A team shown as 60.00 ± 8.00 lands within 8 points of its usual level in about two matches out of three.",
    ],
  },
  {
    id: "the-bars-on-a-match-row",
    heading: "The bars on a match row",
    paragraphs: [
      "Each alliance's three Sigmas combine into one band around its predicted score. Across 2024 to 2026 the band held ~7 in 10 results. Heavy overlap between red and blue means a close match. The win probability is worked out separately.",
    ],
  },
];
