/**
 * Content-as-data for `/methodology/awards`.
 *
 * The write up of four research questions: can an award winner be
 * predicted, does team age help, how good is a ranked list (and are its
 * percentages honest), and are the Championship spots that district
 * championship awards decide predictable.
 *
 * Same discipline as `sigmaContent.ts` and `epaComparisonContent.ts`: this
 * module is the single source of every prose string the page renders, so
 * `awardsContent.test.ts` can pin the section set by equality and check every
 * string for voice violations without a second hand typed copy.
 *
 * Audience: a tenth grader who has watched one FRC event. Voice rules, binding
 * on every exported string, inherited from the Sigma page:
 *
 *   1. NO dash characters at all: not the hyphen minus, not the en dash, not
 *      the em dash. Compounds go open ("walk forward", "top 3", "in person"),
 *      ranges go in words ("2016 to 2026"), and a lower number is said in
 *      words rather than with a minus sign.
 *   2. Short declarative sentences. A term is explained where it first appears.
 *   3. No hedging openers, no restating the previous sentence, no closing
 *      paragraph that summarises the page back at the reader.
 *   4. Numbers carry units and sample size.
 *
 * The voice gate runs at RUNTIME over the exported string VALUES, never as a
 * grep over this file's source. These doc comments use normal punctuation.
 *
 * EVERY NUMBER HERE TRACES TO COMMITTED CODE. Two scripts produce them all:
 *   `pnpm measure:award-predictability` (default run, and with `--dcmp`) for
 *   the prediction, ranking, age, calibration and district championship berth
 *   figures; `pnpm measure:award-qualification-impact` for the qualification
 *   share, where award points land, repeat rates, concentration, and Impact
 *   win rate by team age. State no number here that those do not print.
 *
 * ONE WORDING DECISION WORTH KNOWING. The scripts call one baseline
 * "most decorated rookie present". Its comparator is past wins of this award,
 * then past wins of any award, then LOWEST TEAM NUMBER. Past wins only count
 * earlier seasons, and a true rookie has none, so on rookies the rule reduces
 * to the lowest team number. The page says that, because it is what was
 * actually measured.
 */

export const AWARDS_PAGE_TITLE = "Predicting awards";

export const AWARDS_LEAD =
  "FRC events give out awards as well as trophies for winning matches. We tested whether those awards can be predicted before an event starts. This page reports what we measured, what worked, and what it means for qualifying. The site does not show award predictions anywhere else.";

export const AWARDS_SECTION_IDS = [
  "what-we-measured",
  "how-it-was-tested",
  "past-winners-win-again",
  "the-simple-rule-won",
  "team-age",
  "a-short-list",
  "the-percentages-are-too-confident",
  "what-it-means-for-qualifying",
  "what-it-cannot-do",
] as const;
export type AwardsSectionId = (typeof AWARDS_SECTION_IDS)[number];

export interface AwardsSection {
  readonly id: AwardsSectionId;
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export const AWARDS_SECTIONS: readonly AwardsSection[] = [
  {
    id: "what-we-measured",
    heading: "What we measured",
    paragraphs: [
      "Award records come from The Blue Alliance. We collected 41,869 of them from ten seasons, 2016 to 2026. There is no 2021, because that season had no regular in person events. The records cover every award type at every official event.",
      "One prediction means one award at one event: which of the teams there won it. That gave 30,516 predictions. The 2016 season was used only for learning, so 28,033 of them were scored, across nine seasons from 2017 to 2026.",
      "A typical event has about 40 teams. Picking one at random finds the winner about 3% of the time. Read every result below against that.",
    ],
  },
  {
    id: "how-it-was-tested",
    heading: "How it was tested",
    paragraphs: [
      "Every prediction was made walk forward. A prediction for one season could only use seasons that came before it, so nothing was graded against an answer it had already seen.",
      "Two methods were compared. The first was a fitted model that weighed a team's past awards and its SPR rating going into the event. SPR is the rating this site uses to rank robots. The second was a simple rule: pick the team at the event that has won the most awards in earlier seasons.",
      "Fitting a model has some randomness in it, so small gaps between two methods can appear by chance. We measured how large those chance gaps get. A gap smaller than that is reported as no real difference, not as a win.",
    ],
  },
  {
    id: "past-winners-win-again",
    heading: "Past winners win again",
    paragraphs: [
      "A judged award is any award except the winner and finalist trophies. Judged awards sit with a small group of teams. Of the 29,064 judged awards in the data, the top 10% of teams hold 48.7%. Of 6,390 teams, 2,074 never won one at all, about a third.",
      "The Impact Award, once called the Chairman's Award, repeats more than any other. Of 1,799 Impact wins, 1,104 went to a team that had already won Impact in an earlier season. That is 61.4%. The Judges' Award repeats least: 348 of 1,616, or 21.5%.",
    ],
  },
  {
    id: "the-simple-rule-won",
    heading: "The simple rule beat the model",
    paragraphs: [
      "On the awards teams care about most, the simple rule won. For Impact it named the winner in 24.5% of 1,538 predictions, against 22.1% for the model. For Engineering Inspiration it scored 12.1% of 1,454, against 9.6%. For the Safety Award it scored 28.2% of 557, against 22.8%.",
      "Adding a robot rating and fitting weights did not help on these awards. Knowing who has won before did better.",
      "The model did win two awards, each by a small margin. For Excellence in Engineering it scored 14.3% of 1,492, against 12.1% for the simple rule. For the Autonomous Award it scored 18.9% of 1,171, against 14.3%.",
      "Autonomous is the one award where the robot rating clearly matters. Ranking teams by SPR alone found the Autonomous winner 17.7% of the time. The same ranking found the Impact winner only 6.8% of the time. That fits what each award is for.",
    ],
  },
  {
    id: "team-age",
    heading: "Team age",
    paragraphs: [
      "Older teams do win Impact more often. Teams 20 or more years past their rookie year won Impact at 3.85% of their event appearances, 294 wins in 7,628. Teams 1 to 3 years past their rookie year won at 0.65%, 85 wins in 13,121.",
      "Once past wins are counted, age adds almost nothing. Giving the model each team's age moved its Impact result from 22.1% to 21.6%, which is within chance. Age made no real difference on 19 of the 24 judged awards we scored. Older teams win more because they have had longer to build a record, and the record is what predicts.",
      "Age does matter for the rookie awards, since they are meant for rookie teams. For the Rookie All Star Award a plain rule still did better than the model. Rookies have no earlier awards to count, so the simple rule in practice picks the rookie with the lowest team number. That rule won Rookie All Star in 46.1% of 1,114 predictions. The model with age included scored 42.9%.",
      "Team numbers are handed out roughly in the order teams register, so a lower number usually means a rookie that signed up earlier. We did not test why that predicts the award.",
    ],
  },
  {
    id: "a-short-list",
    heading: "A short list works better than one pick",
    paragraphs: [
      "Naming a single winner is the hardest version of the question. A short list does much better. For Impact, the simple rule's top 3 teams included the winner 51.1% of the time, and its top 10 included the winner 84.9% of the time. Random lists that size would include the winner 9.1% and 28.5% of the time. The typical Impact winner was ranked third out of about 39 teams.",
      "Across the five main judged awards, a top 3 list held the winner between 32.3% and 52.2% of the time, against about 8% for a random list. On three of the five the simple rule made the better list. On Excellence in Engineering and Autonomous the model did.",
    ],
  },
  {
    id: "the-percentages-are-too-confident",
    heading: "The percentages are too confident",
    paragraphs: [
      "A prediction can come with a percentage, like saying a team has a 30% chance. For that number to be honest, teams given 30% should win about 30% of the time.",
      "Ours are too confident. On average the model gave its top pick for Impact a 29.9% chance. That team actually won 21.2% of the time, across 1,470 predictions. For Engineering Inspiration it said 17.0% and the pick won 9.5%. All five main judged awards were too confident in the same direction.",
      "The ordering is still useful. The percentages attached to it are not ready to show anyone and would need correcting first. The simple rule gives no percentage at all. It only puts teams in order.",
    ],
  },
  {
    id: "what-it-means-for-qualifying",
    heading: "What it means for qualifying",
    paragraphs: [
      "Awards earn district points, and district points decide who goes to a district championship. They matter less there than they might seem. Awards make up 8.4% of all district points. If award points were removed entirely, 125 of 7,125 district championship spots would change hands, or 1.8%.",
      "Award points mostly go to teams that are already safe. The 3,556 team seasons well above the district championship cut averaged 16.39 award points. The 5,689 well below it averaged 1.33. The teams whose spot is actually in doubt earn the fewest award points.",
      "The FIRST Championship is different. At a district championship, the Impact, Engineering Inspiration, and Rookie All Star awards each come with an automatic spot at the Championship. Of 519 such awards, 259 went to a team that was not inside the points cut. For those teams the award was the whole reason they went. That is 9.3% of the 2,798 Championship spots from districts in the data.",
      "Those spots can be predicted. At a district championship, the lowest numbered rookie won Rookie All Star in 49 of the 78 cases where the award decided a spot, or 62.8%. A random pick would manage about 4%. For Impact, the most decorated team won 24 of 52, or 46.2%, against about 9% at random. Engineering Inspiration was much harder: the right team was in a top 3 list in only 13 of 61 cases.",
      "The cut used here is approximate. Teams that qualify by award take up Championship spots, so the real points cut sits a little higher than the one we used. The true share of spots decided by awards is, if anything, larger.",
    ],
  },
  {
    id: "what-it-cannot-do",
    heading: "What it cannot do",
    paragraphs: [
      "These are measurements, not a feature. Nothing on this site predicts awards for a live event.",
      "Judges decide awards from presentations, interviews, and what they see in the pits. None of that is in the data. Every method here only sees results from earlier seasons, so it cannot know about a team that improved over the winter.",
      "Some awards are rare. Where a result rests on a small number of predictions, a few lucky or unlucky events can move it a lot.",
      "The numbers were measured on September 12, 2026 and will not update on their own.",
    ],
  },
];
