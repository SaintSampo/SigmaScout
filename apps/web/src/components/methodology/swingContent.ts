/**
 * Content-as-data for `/methodology/swing` (quick task 260909-3fj), the same
 * discipline `acknowledgmentsContent.ts` and `epaComparisonContent.ts`
 * already established: this module is the single source of every prose
 * string the page renders, so `swingContent.test.ts` can pin the section and
 * figure sets by equality and check every string for voice violations
 * without a second hand-typed copy anywhere.
 *
 * Audience: a tenth grader who has watched one FRC event. Voice rules,
 * binding on every exported string here:
 *
 *   1. NO dash characters at all — not the hyphen-minus, not the en dash,
 *      not the em dash. This is stricter than `epaComparisonContent.ts`
 *      (which bans only the em dash) because "no hyphens" was an explicit
 *      request from the person who asked for this page. Compounds go open
 *      ("half life", "walk forward", "match to match", "per robot"), ranges
 *      go in words ("2024 to 2026"), and formulas go in words too, since a
 *      minus sign would trip the same gate.
 *   2. Short declarative sentences. A term gets explained the first time it
 *      appears, in the same sentence.
 *   3. No hedging openers, no sentence that restates the previous one, no
 *      "not only ... but also", no closing paragraph that summarises the page
 *      back at the reader.
 *   4. Numbers carry units and sample size.
 *
 * NOTE ON THIS COMMENT: the voice gate in `swingContent.test.ts` runs at
 * RUNTIME over the exported string VALUES, never as a grep over this file's
 * source text, for the reason `epaComparisonContent.test.ts`'s own header
 * documents — doc comments like this one legitimately use normal
 * punctuation, and a whole-file grep would false-positive on them.
 *
 * Every measured number below traces to
 * `.planning/quick/260909-3fj-write-a-methodology-post-explaining-swin/260909-3fj-RESEARCH.md`,
 * which is a closed research pass verified against HEAD. No number is stated
 * here that is not in that document.
 *
 * The retired algorithm is DELIBERATELY never named. `PUBLISHED_ALGORITHM_IDS`
 * is `["opr", "epa", "bpr"]` (`packages/harness/publishedAlgorithms.ts`), and
 * the coverage and re-validation figures below are phrased so they stay true
 * without naming a rating the site no longer publishes: the coverage range
 * spans the measured per-algorithm values rather than attributing one to a
 * named rating, and the 2026 re-validation is quoted as "near 2.0" rather
 * than as the two per-algorithm fits it came from. `swingContent.test.ts`
 * asserts that absence.
 */

export const SWING_PAGE_TITLE = "Swing Factor and the match band";

export const SWING_LEAD =
  "Ratings on this site can carry a grey number after a ± sign, and match rows can carry two coloured bars. Both come from one idea: how much does a robot's contribution move from one match to the next. This page shows how that number is worked out, what it tells you, and where it runs out.";

export const SWING_FIGURE_IDS = ["even-split", "deviations", "same-rating", "squares-add", "match-band"] as const;
export type SwingFigureId = (typeof SWING_FIGURE_IDS)[number];

export interface SwingFigure {
  readonly id: SwingFigureId;
  /** The SVG's accessible name and its `<title>` child. */
  readonly title: string;
  /** The `<figcaption>` under the drawing. */
  readonly caption: string;
  /**
   * True when the DRAWN data is an example rather than a measurement. Every
   * figure on this page draws made-up numbers to show a shape, so every
   * caption has to say so — a reader must never mistake a teaching drawing
   * for a published result. `swingContent.test.ts` pins that: a figure
   * flagged illustrative whose caption does not say "example" fails.
   */
  readonly illustrative: boolean;
}

export const SWING_FIGURES: readonly SwingFigure[] = [
  {
    id: "even-split",
    title: "One alliance scores 18 points more than predicted, split into 6 points for each robot",
    caption:
      "An example match. The prediction was 150 points and the alliance scored 168. That 18 point gap is split evenly, 6 points to each of the three robots.",
    illustrative: true,
  },
  {
    id: "deviations",
    title: "One team's misses across ten matches, with the newest matches counting most",
    caption:
      "Example misses for one team, oldest at the left. Darker dots count more, because recent matches carry more weight. The dashed line is that team's own average miss. The shaded band is one Swing Factor either side of it.",
    illustrative: true,
  },
  {
    id: "same-rating",
    title: "Two teams with the same rating and very different swing",
    caption:
      "Example misses for two teams on one shared axis. Both carry the same Total. The top team lands in almost the same place every match. The bottom team is scattered across the whole axis.",
    illustrative: true,
  },
  {
    id: "squares-add",
    title: "Three robots at ±10 combine to ±17.32, not ±30",
    caption:
      "Three example robots, each at ±10 points. The combined bar is drawn by the same code the site publishes with, so it cannot drift from the real answer. The pale bar underneath is what you get by adding the three swings straight up, and it is wrong.",
    illustrative: true,
  },
  {
    id: "match-band",
    title: "Three match rows going from heavy overlap to clean separation",
    caption:
      "Three example matches on one shared score axis. Red and blue are the two alliances. Each bar covers one standard deviation either side of that alliance's predicted score, and the solid tick inside it is the prediction. The bars pull apart as the match gets less close.",
    illustrative: true,
  },
];

export const SWING_SECTION_IDS = [
  "where-the-number-starts",
  "one-team-many-matches",
  "what-a-big-swing-means",
  "three-robots-one-band",
  "reading-the-match-band",
  "how-the-two-constants-were-picked",
  "what-it-cannot-do",
] as const;
export type SwingSectionId = (typeof SWING_SECTION_IDS)[number];

export interface SwingSection {
  readonly id: SwingSectionId;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** The figure drawn inside this section, if it has one. */
  readonly figureId?: SwingFigureId;
}

export const SWING_SECTIONS: readonly SwingSection[] = [
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
    id: "one-team-many-matches",
    heading: "One team, many matches",
    figureId: "deviations",
    paragraphs: [
      "Now collect one team's misses across every match it has played, oldest first.",
      "Recent matches count more. Each match further back counts about 0.89 as much as the one after it. Stack that up and a match 6 back counts half as much as the newest one, which is why 6 is called the half life.",
      "Then measure how spread out those misses are around the team's own average miss, not around zero. That step is called centring, and it is what turns this into a number about the robot.",
      "Here is why. A model that misses a team by the same amount in every single match has shown no swing at all. The steady gap is the model's problem, not the robot's. Measured on OPR before centring, one team came out at ±298.92 against a rating of 322.42, and almost all of that was steady bias rather than anything the robot did.",
      "Multiply the spread by 1.92 so the answer reads in points. That is the Swing Factor.",
      "It needs at least two played matches. One match cannot tell a steady bias apart from a real swing, so a team with a single match gets no Swing Factor at all.",
      "A Swing Factor of exactly 0 is a real answer, not a bug. A robot the model misses by the same amount every time is perfectly consistent.",
      "All of this happens once, when the site publishes its data. Your browser never runs the calculation, so the same number shows up on a team page and on an event page.",
    ],
  },
  {
    id: "what-a-big-swing-means",
    heading: "What a big swing means",
    figureId: "same-rating",
    paragraphs: [
      "The ± is not how sure the site is about the rating. It is how much a robot's contribution moves from match to match.",
      "A robot with a small ± plays about the same every match. A robot with a large ± might dominate one match and barely show up in the next. Two robots can carry the exact same rating and a completely different ±.",
      "Which one you want depends on where you are sitting. A top seed picking first usually wants a low ±, a partner that turns up the same every match. A low seed hunting an upset wants a high ±, because it needs the variance to have any shot at all. Halfway through quals it is how you judge whether the partner you drew can be relied on.",
      "You see it today as a grey ± beside the Total at the top of a team page, and in the Total column of the Teams list, to two decimals. The ± toggle in the ribbon at the top of the site turns every ± off at once.",
      "It is worked out for every algorithm the site publishes, OPR, EPA and BPR, from nothing but the predicted score, the actual score and the roster. The same robot carries a different ± under each one, because each one misses by a different amount.",
    ],
  },
  {
    id: "three-robots-one-band",
    heading: "Three robots, one band",
    figureId: "squares-add",
    paragraphs: [
      "An alliance is three robots, and their swings do not simply add up. Square each one, add the squares, then take the square root.",
      "Three robots at ±10 give ±17.32, not ±30. They do not all swing the same way in the same match, so some of the swing cancels itself out.",
      "It is all or nothing. If any robot on the alliance has no Swing Factor yet, that alliance gets no band at all. Better no band than a band that is too tight, because a band drawn from part of the picture reads as confidence the site has not earned.",
    ],
  },
  {
    id: "reading-the-match-band",
    heading: "Reading the match band",
    figureId: "match-band",
    paragraphs: [
      "On a team page and on an event page, every match row draws both alliances on one shared score axis.",
      "The soft bar covers one standard deviation either side of the predicted score, which is the range you would expect most results to land in. The solid tick inside the bar is the prediction itself. The ringed dot is what the alliance actually scored.",
      "The overlap between the two bars is the win probability, drawn instead of asserted. Heavy overlap means the match is close to a coin flip. Clean separation means a strong favourite.",
      "The band on any match uses only the matches played before it, never anything from later in the season, so it shows what was knowable at the time. It does not reset when a team travels to its second event.",
      "A missing band is missing on purpose. One robot with no Swing Factor yet means no band for that whole alliance.",
    ],
  },
  {
    id: "how-the-two-constants-were-picked",
    heading: "How the two numbers were picked",
    paragraphs: [
      "Two numbers steer all of this: the half life of 6 matches and the scale of 1.92. Both were measured rather than chosen.",
      "The half life was swept over 275,172 team matches from 2024 to 2026, walk forward, meaning every test only ever used matches played before the one it was scoring. 6 sits at the top of a plateau running from roughly 4 to 12, so anything in that range performs about the same.",
      "Weighting recent matches beats a flat average by only 2.3%, and the code says so out loud instead of overselling it.",
      "The 1.92 scale came from 86,844 alliance observations. It checks how far alliances actually landed from their predictions against the three robots' own unscaled swing, which is a comparison against something the field really records.",
      "The first attempt at that scale was circular. It compared a team's miss against that same team's past misses and duly recovered about 1.0, which is what a circular test always does. That mistake is written into the code so nobody repeats it.",
      "Both numbers are permanently shut out of parameter tuning. The tuner scores predictions and is blind to a display number, so letting it near these two could only ever chase a better looking ±.",
    ],
  },
  {
    id: "what-it-cannot-do",
    heading: "What it cannot do",
    paragraphs: [
      "The best correlation anyone has managed for predicting a team's actual miss in its next match is about 0.59. That is the data's limit rather than the formula's. FRC records no per robot score, so a per robot number always soaks up whatever the two partners did.",
      "The band is deliberately wide. It covers about 76% to 87% of actual scores depending on which rating you are looking at, against 68.3% for a textbook one standard deviation band. Checked again on 2026 over 31,142 alliance observations, the scale that would make the band a textbook one standard deviation came out near 2.0.",
      "Giving each rating its own scale would fix the width, and that was deliberately turned down. Three numbers instead of one would need measuring again on every model change, and a stale number nobody rechecked is the exact failure this project keeps a log about.",
      "An audit over 36,805 alliance observations across 216 events found the typical miss was 0.920 band widths. 75.2% of results landed inside one band width, 96.3% inside two and 99.5% inside three.",
      "Alliances score a little above their prediction on average, by 0.1197 band widths, and the misses lean high. You are about 21% more likely to be surprised high than low.",
      "It says nothing at all until a team has played two matches.",
    ],
  },
];
