/**
 * Content-as-data for `/methodology/sigma`. Replaces `swingContent.ts`, which
 * explained a number the site stopped showing on 2026-09-10 when Sigma Score
 * shipped for the SPR rating (published under the internal id `bpr`, still
 * unchanged; see `sprContent.ts`).
 *
 * Same discipline as its predecessor and as `epaComparisonContent.ts`: this
 * module is the single source of every prose string the page renders, so
 * `sigmaContent.test.ts` can pin the section and figure sets by equality and
 * check every string for voice violations without a second hand-typed copy
 * anywhere.
 *
 * Audience: a tenth grader who has watched one FRC event. Voice rules, binding
 * on every exported string here:
 *
 *   1. NO dash characters at all — not the hyphen-minus, not the en dash, not
 *      the em dash. Inherited from the previous page at the explicit request of
 *      the person who asked for it. Compounds go open ("half life", "walk
 *      forward", "match to match", "per robot"), ranges go in words ("2024 to
 *      2026"), and formulas go in words too, since a minus sign would trip the
 *      same gate.
 *   2. Short declarative sentences. A term gets explained the first time it
 *      appears, in the same sentence.
 *   3. No hedging openers, no sentence that restates the previous one, no
 *      "not only ... but also", no closing paragraph that summarises the page
 *      back at the reader.
 *   4. Numbers carry units and sample size.
 *
 * NOTE ON THIS COMMENT: the voice gate runs at RUNTIME over the exported string
 * VALUES, never as a grep over this file's source text — doc comments like this
 * one legitimately use normal punctuation, and a whole file grep would false
 * positive on them.
 *
 * Every measured number below traces to quick task 260910-u7g (the head to head
 * against the old number) and 260910-sz9 (the measurement of the old number
 * itself). No number is stated here that those did not produce.
 */

export const SIGMA_PAGE_TITLE = "Sigma Score and the match band";

export const SIGMA_LEAD =
  "Teams on this site carry a number called Sigma, and match rows carry two coloured bars. Both answer one question: how much might a robot's contribution move in its next match. This page shows how that number is worked out, what it tells you, and where it runs out.";

export const SIGMA_FIGURE_IDS = [
  "even-split",
  "level-and-swing",
  "evidence",
  "same-rating",
  "squares-add",
  "match-band",
] as const;
export type SigmaFigureId = (typeof SIGMA_FIGURE_IDS)[number];

export interface SigmaFigure {
  readonly id: SigmaFigureId;
  /** The SVG's accessible name and its `<title>` child. */
  readonly title: string;
  /** The `<figcaption>` under the drawing. */
  readonly caption: string;
  /**
   * True when the DRAWN data is an example rather than a measurement. Every
   * figure on this page draws made up numbers to show a shape, so every caption
   * has to say so — a reader must never mistake a teaching drawing for a
   * published result. `sigmaContent.test.ts` pins that: a figure flagged
   * illustrative whose caption does not say "example" fails.
   */
  readonly illustrative: boolean;
}

export const SIGMA_FIGURES: readonly SigmaFigure[] = [
  {
    id: "even-split",
    title: "One alliance scores 18 points more than predicted, split into 6 points for each robot",
    caption:
      "An example match. The prediction was 150 points and the alliance scored 168. That 18 point gap is split evenly, 6 points to each of the three robots.",
    illustrative: true,
  },
  {
    id: "level-and-swing",
    title: "One team's misses across ten matches, with its own level and the spread around it",
    caption:
      "Example misses for one team, oldest at the left. The dashed line is the team's own level, meaning the amount the model usually misses it by. Sigma measures the spread around that line, not the distance from zero.",
    illustrative: true,
  },
  {
    id: "evidence",
    title: "One example robot's Sigma after zero, two, six and twenty matches played",
    caption:
      "One example robot whose misses are nearly identical every match. The dashed line is what similar robots do. Each row is the published Sigma after that many matches. Two matches move it a little and twenty move it a long way, and it never arrives completely.",
    illustrative: true,
  },
  {
    id: "same-rating",
    title: "Two teams with the same rating and very different Sigma",
    caption:
      "Example misses for two teams on one shared axis. Both carry the same Total. The top team lands in almost the same place every match. The bottom team is scattered across the whole axis.",
    illustrative: true,
  },
  {
    id: "squares-add",
    title: "Three robots at ±10 combine to ±17.32, not ±30",
    caption:
      "Three example robots, each at ±10 points. The combined bar is drawn by the same code the site publishes with, so it cannot drift from the real answer. The pale bar underneath is what you get by adding the three numbers straight up, and it is wrong.",
    illustrative: true,
  },
  {
    id: "match-band",
    title: "Three match rows going from heavy overlap to clean separation",
    caption:
      "Three example matches on one shared score axis. Red and blue are the two alliances. Each bar covers one Sigma either side of that alliance's predicted score, and the solid tick inside it is the prediction. The bars pull apart as the match gets less close.",
    illustrative: true,
  },
];

export const SIGMA_SECTION_IDS = [
  "where-the-number-starts",
  "a-robots-own-level",
  "what-similar-robots-do",
  "what-a-big-sigma-means",
  "three-robots-one-band",
  "reading-the-match-band",
  "how-it-was-tested",
  "what-it-cannot-do",
] as const;
export type SigmaSectionId = (typeof SIGMA_SECTION_IDS)[number];

export interface SigmaSection {
  readonly id: SigmaSectionId;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** The figure drawn inside this section, if it has one. */
  readonly figureId?: SigmaFigureId;
}

export const SIGMA_SECTIONS: readonly SigmaSection[] = [
  {
    id: "where-the-number-starts",
    heading: "Where the number starts",
    figureId: "even-split",
    paragraphs: [
      "FRC never records what one robot scored. The Blue Alliance publishes the alliance total and nothing finer than that. Every per robot number on this page is worked out from alliance scores, not measured on the field.",
      "The first step is one subtraction and one division. Take the score an alliance actually put up, subtract the score that was predicted for it, then divide by the number of robots on the alliance. That is one team's even share of the miss.",
      "Say the prediction was 150 points and the alliance scored 168. The miss is 18 points. Split three ways, that is 6 points each.",
      "Splitting it evenly is a choice, and it is the honest one. Nobody knows which robot did what. Any other split would be made up.",
    ],
  },
  {
    id: "a-robots-own-level",
    heading: "A robot's own level",
    figureId: "level-and-swing",
    paragraphs: [
      "Collect one team's misses across every match it has played, oldest first.",
      "Some teams get missed in the same direction every time. A model might be 8 points low on a particular robot in nearly every match. That steady gap is the model's problem, not the robot's, so it gets measured separately and set aside. It is called the team's level.",
      "Sigma is the spread of the misses around that level. A robot the model gets wrong by the same amount every single match is perfectly consistent, and Sigma treats it that way.",
      "Two separate clocks run here, and keeping them apart is the whole idea. The level moves slowly, over about 18 matches, so a robot that suddenly changes does not have the change quietly absorbed into its level. The spread moves quickly, over about 2 matches, so a change shows up on the site almost straight away.",
      "That is what makes a breakdown visible. A robot that worked for six matches and then stopped scoring is now a long way from the level it earned, and because the spread reacts in about 2 matches, its Sigma climbs while the level has barely moved. A robot that finally gets its mechanism working climbs the same way.",
    ],
  },
  {
    id: "what-similar-robots-do",
    heading: "Starting from what similar robots do",
    figureId: "evidence",
    paragraphs: [
      "A team that has played two matches has almost no evidence about itself. Two matches that happen to land close together do not mean the robot is reliable, they mean you have seen it twice.",
      "So Sigma does not start from nothing. It starts from what robots of similar strength usually do, then moves toward what this robot's own matches say, by an amount that depends on how many matches there are.",
      "It never moves all the way across. Only the last few matches count toward the spread, so the number of matches that carry weight stops growing at about 3 no matter how long the season runs. A small share of the answer stays with what similar robots do, permanently. That is deliberate, and it is what stops one quiet run of matches from being read as proof.",
      "Stronger robots score more points, so they have more points to swing by. The starting guess scales with the team's own rating for that reason, rather than being one number for every robot on the field.",
      "This is why Sigma is never exactly zero and never blank. A robot seen twice gets an honest answer built mostly from its peers. A robot never seen at all still gets one, which means a match between six debut teams can still be given a band.",
      "The old number on this site did start from nothing, and it showed. Measured across 297,854 team matches, about 2 teams in every 1,000 came out below 1 point, meaning the site called them almost perfectly consistent on the strength of two similar matches. Those few teams then missed by 40 points and more.",
    ],
  },
  {
    id: "what-a-big-sigma-means",
    heading: "What a big Sigma means",
    figureId: "same-rating",
    paragraphs: [
      "Sigma is not how sure the site is about a rating. It is how much a robot's contribution moves from match to match.",
      "A robot with a small Sigma plays about the same every match. A robot with a large one might dominate one match and barely show up in the next. Two robots can carry the exact same rating and completely different Sigma.",
      "Which one you want depends on where you are sitting. A top seed picking first usually wants a low Sigma, a partner that turns up the same every match. A low seed hunting an upset wants a high one, because it needs the variance to have any shot at all. Halfway through quals it is how you judge whether the partner you drew can be relied on.",
      "It has its own column in the Teams list and its own tile at the top of a team page, both labelled Sigma, to two decimals.",
      "The site publishes three ratings, OPR, EPA and SPR. Sigma is worked out for SPR only. It was tested against all three and came out better for OPR and SPR and worse for EPA, so rather than show a number that is better in some places and worse in others, it is shown where the testing supported it. Under OPR and EPA the column is simply empty.",
      "The reading is a true one standard deviation, in points. A robot at 12.00 lands within 12 points of its usual level in roughly two matches out of three.",
    ],
  },
  {
    id: "three-robots-one-band",
    heading: "Three robots, one band",
    figureId: "squares-add",
    paragraphs: [
      "An alliance is three robots, and their swings do not simply add up. Square each one, add the squares, then take the square root.",
      "Three robots at ±10 give ±17.32, not ±30. They do not all swing the same way in the same match, so some of the swing cancels itself out.",
      "Every robot on the field has a Sigma, including one playing its first ever match, so every alliance gets a band. The old number had no answer for a robot it had seen fewer than twice, and one such robot meant no band at all for that whole alliance.",
    ],
  },
  {
    id: "reading-the-match-band",
    heading: "Reading the match band",
    figureId: "match-band",
    paragraphs: [
      "On a team page and on an event page, every match row draws both alliances on one shared score axis.",
      "The soft bar covers one Sigma either side of the predicted score, which is the range most results land in. The solid tick inside the bar is the prediction itself. The ringed dot is what the alliance actually scored.",
      "The overlap between the two bars is the win probability, drawn instead of asserted. Heavy overlap means the match is close to a coin flip. Clean separation means a strong favourite.",
      "The band on any match uses only the matches played before it, never anything from later in the season, so it shows what was knowable at the time. It does not reset when a team travels to its second event.",
    ],
  },
  {
    id: "how-it-was-tested",
    heading: "How it was tested",
    paragraphs: [
      "Sigma replaced an older number, and it had to earn the job rather than simply sound better.",
      "The settings were chosen on the 2024 and 2025 seasons, across 209,349 team matches, and then checked once on 2026, across 110,232 team matches for each rating. Choosing settings on one set of seasons and checking on a different one is what stops a number being tuned until it flatters itself.",
      "Every test scored both numbers on the same rows, against the same target, which was how far the team actually landed from prediction in its next match. Each number had to supply both a guess and a range, so neither could be graded on a target it had picked for itself.",
      "A band that claims one standard deviation should contain the result about 68.3% of the time. The old number managed 64.1%, which sounds close but means it was quietly too narrow. Sigma lands at 67.0%.",
      "Sigma separates steady robots from erratic ones better. On a measure where lower is better, it scores 0.323 against the old number's 0.384. It also spots a robot that has just changed slightly faster.",
      "The clearest gap is in how badly each one fails at its worst. On a score that punishes false confidence, the old number came out at 33.24 and Sigma at 5.05. Almost all of that gap is the handful of teams the old number called nearly perfect after two matches.",
      "One result went the other way and is worth stating. On a measure of the typical team rather than the worst case, the old number scored slightly better. That measure rewards a narrow band, and the coverage figures above show the old band was too narrow, so the two findings agree rather than conflict.",
    ],
  },
  {
    id: "what-it-cannot-do",
    heading: "What it cannot do",
    paragraphs: [
      "The best correlation anyone has managed for predicting a team's actual miss in its next match is about 0.59. That is the data's limit rather than the formula's. FRC records no per robot score, so a per robot number always soaks up whatever the two partners did.",
      "The even split is the sharpest limit. All three robots on an alliance get credited with exactly the same miss for that match, so within any single match Sigma cannot tell a robot that broke apart from the two that carried it. The three are told apart only because they play with different partners across the season.",
      "It does not know why a robot changed. A dead battery, a broken intake, a driver having a bad day and a genuinely upgraded mechanism all look identical from alliance scores alone.",
      "It is a season number. A team that was wild in week 1 and has been steady since carries some of that early wildness for a while, though the 2 match spread clock means less of it than you might expect.",
      "The old number was measured over 297,854 team matches before it was replaced. Across the deciles of that measurement, the ratio between what it claimed and what actually happened ran from 0.80 at the calm end to 1.94 at the wild end, meaning it flattered calm robots and overstated wild ones. Sigma was built to close that gap and it does not close it completely.",
    ],
  },
];
