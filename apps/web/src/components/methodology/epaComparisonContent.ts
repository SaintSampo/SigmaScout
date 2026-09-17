/**
 * Content-as-data for `/methodology/epa-vs-statbotics`. This module is the
 * single source of every prose string the page renders: the title, the
 * lead, the three section headings, the "How much it matters" intro and the
 * two provenance lines under its table, the "Same on both sites" paragraph,
 * and every cell of the "Where they differ" comparison table.
 * `epaComparisonContent.test.ts` pins the row id set by equality and runs
 * voice, fact and liability gates over every exported string, so a silently
 * added, dropped or reworded entry fails loudly.
 *
 * Rewritten 2026-09-17 from sketch 016 (variant B, results section first,
 * Jacob's pick): the difference cards became one table and the shared list
 * became one paragraph.
 *
 * Audience: the FRC community (students, mentors, scouts) the rest of the
 * site is written for. Voice rules, binding on every string here: NO dash
 * characters at all (hyphen minus, en dash, em dash; compounds go open, as
 * in "carried over"), flat and factual, short declarative sentences, no
 * hedging openers, neutral between the two sites.
 *
 * Facts come from `docs/models/epa-statbotics-gap.md`, `docs/models/
 * epa-divergences.md`, and `packages/core/algorithms/{epa,carryover,
 * epaCarryScale}.ts`. No accuracy or Brier literal appears anywhere in this
 * module except the three 2024 score-piece figures (73.5, 74.0, 75.2), which
 * were already published on the prior version of this page.
 *
 * The published `v1/methodology/epa-vs-statbotics.json` artifact still
 * carries an `agreement` array (`EpaComparisonArtifactSchema` still requires
 * it). This page deliberately does not render it.
 */

export const EPA_COMPARISON_PAGE_TITLE = "Our EPA vs Statbotics' EPA";

export const EPA_COMPARISON_LEAD =
  "Statbotics publishes EPA (Expected Points Added), a rating of how many points an FRC team adds to its alliance's score. SigmaScout reimplements EPA for the purpose of comparison. Most of the calculations are the same on both sites, but there are minor differences. This page lists where the two differ and how much the differences change match predictions.";

/** Section headings, in the page's display order: results first. */
export const EPA_HEAD_TO_HEAD_SECTION_HEADING = "How much it matters";
export const EPA_SAME_SECTION_HEADING = "Same on both sites";
export const EPA_DIFFERENCE_SECTION_HEADING = "Where they differ";

export const EPA_HEAD_TO_HEAD_INTRO =
  "How often each site's EPA picked the match winner, and its Brier score. Lower Brier is better.";

export const EPA_SAME_PARAGRAPH =
  "Both sites update ratings with the same formula, count elimination matches one third as much as qualification matches, use the same logistic win probability curve, and add fouls back the same way. A new season starts from the same blend: 70 percent of last season, 30 percent of the season before, pulled 40 percent of the way back toward average. Neither site shows a ± range on EPA.";

/** Column headers of the difference table. The first column (the topic) has no header. */
export const EPA_DIFFERENCE_STATBOTICS_LABEL = "Statbotics";
export const EPA_DIFFERENCE_SIGMASCOUT_LABEL = "SigmaScout";
export const EPA_DIFFERENCE_NOTE_LABEL = "Note";

/**
 * The pinned difference-row id set, in the page's own display order.
 * Pinned by equality in `epaComparisonContent.test.ts`, and matched against
 * the rendered row testids in DOM order by
 * `methodology.epa-vs-statbotics.test.tsx`.
 */
export const EPA_DIFFERENCE_ROW_IDS = [
  "week-one-numbers",
  "score-pieces",
  "new-season-start",
  "score-data-cleanup",
  "season-adjustments",
] as const;
export type EpaDifferenceRowId = (typeof EPA_DIFFERENCE_ROW_IDS)[number];

export interface EpaDifferenceRow {
  readonly id: EpaDifferenceRowId;
  readonly topic: string;
  readonly statbotics: string;
  readonly sigmascout: string;
  readonly note: string;
}

/**
 * Fouls stay folded into `week-one-numbers` rather than getting their own
 * row: prediction-time foul handling is identical on both sites (see
 * `EPA_SAME_PARAGRAPH`), and the only remaining difference is the week 1
 * rate, which this row already covers.
 */
export const EPA_DIFFERENCE_ROWS: readonly EpaDifferenceRow[] = [
  {
    id: "week-one-numbers",
    topic: "Week 1 numbers",
    statbotics: "Score spread and foul rate come from all of week 1 and apply to every match, week 1 included",
    sigmascout: "Same numbers from week 2 on. Running estimates during week 1",
    note: "Changes week 1 confidence. It never changes a winner pick",
  },
  {
    id: "score-pieces",
    topic: "Score pieces",
    statbotics: "About 18 overlapping numbers. Most seasons predict from one total",
    sigmascout: "Pieces that do not overlap, added up",
    note: "On 2024, three pieces picked 75.2 percent of winners, one total 74.0 percent, eleven pieces 73.5 percent",
  },
  {
    id: "new-season-start",
    topic: "New season start",
    statbotics: "Splits a rating by week 1 piece values. Converts to the new point scale right away",
    sigmascout: "Splits evenly. Converts after 250 alliance scores",
    note: "Nobody knows a new game's scale before it is played",
  },
  {
    id: "score-data-cleanup",
    topic: "Score data cleanup",
    statbotics: "Corrects FIRST's score data in 2016, 2017, 2019, 2022, 2023 and 2025",
    sigmascout: "Official values as reported. These corrections have not been adopted yet",
    note: "Identical score data only in 2024",
  },
  {
    id: "season-adjustments",
    topic: "Season adjustments",
    statbotics: "Adjusts predictions in 2018, 2023 and 2025",
    sigmascout: "None",
    note: "A deliberate choice that keeps every season identical",
  },
];

/** Long-form UTC date, so an ISO calendar date never shifts a day across the viewer's timezone. */
const PULLED_DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

function formatPulledDate(isoDate: string): string {
  const parsed = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? isoDate : PULLED_DATE.format(parsed);
}

/**
 * The line under the head-to-head table naming when the Statbotics column was
 * last pulled from the Statbotics API. Built from the artifact's per-season
 * `statboticsCapturedAt`, never a typed date, so it cannot go stale against the
 * table. One date when every season shares it; the oldest and newest when they
 * differ, so no season's age is hidden. Empty input returns an empty string and
 * the page renders nothing.
 */
export function statboticsPulledSentence(capturedDates: readonly string[]): string {
  const days = [...new Set(capturedDates.map((date) => date.slice(0, 10)))].sort();
  if (days.length === 0) return "";
  const oldest = formatPulledDate(days[0] as string);
  if (days.length === 1) {
    return `Statbotics numbers were last pulled from the Statbotics API on ${oldest}.`;
  }
  const newest = formatPulledDate(days[days.length - 1] as string);
  return `Statbotics numbers were last pulled from the Statbotics API between ${oldest} and ${newest}.`;
}

/**
 * The provenance line under the head-to-head table: which SigmaScout EPA
 * version produced the SigmaScout column, and when. Built from the artifact's
 * own `epaVersion` and `measuredAt`, never typed, and the date goes through the
 * same long form as the Statbotics line so no ISO hyphen reaches the page.
 */
export function sigmascoutMeasuredSentence(epaVersion: string, measuredAt: string): string {
  return `SigmaScout EPA measured with EPA ${epaVersion} on ${formatPulledDate(measuredAt)}.`;
}
