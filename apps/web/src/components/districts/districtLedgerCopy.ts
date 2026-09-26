/**
 * EVERY STRING the Road to District Champs tab prints, in one module.
 * Content-as-data: exported string constants, no JSX, no React import.
 *
 * NOT TO BE CONFUSED with 10-08's methodology module, which lives at
 * `apps/web/src/components/methodology/districtLedgerContent.ts` — a different
 * file in a different directory. The two have similar names and hold different
 * things: this one is tab chrome, that one is methodology prose, and only the
 * methodology one is bound by the methodology voice gate.
 *
 * The definitions and the legend keys below are lifted CHARACTER FOR CHARACTER
 * from `10-UI-SPEC.md`'s `## Copy` section. They are a contract and a test pins
 * them.
 */

/** The tab's own label and its URL id — the id is `searchParams.ts`'s `DISTRICT_TABS` member, restated here only as the panel's test id root. */
export const DISTRICT_LEDGER_TAB_LABEL = "Road to District Champs";

/**
 * The table's column labels, in render order. The header renders FROM this
 * tuple, so the labels and the column count cannot disagree.
 */
export const DISTRICT_LEDGER_COLUMN_LABELS = [
  "Team",
  "Status",
  "Grand total",
  "Event",
  "Event total",
  "Qualification",
  "Alliance selection",
  "Playoffs",
  "Awards",
] as const;

/**
 * TBA's own district event naming template: a district code, the word
 * "District", an optional dash, the event's own name, then the word "Event"
 * and an optional "#N" for a district that runs two events under one name.
 *
 * The Event cell prints the SHORT form so the ledger's nine columns fit at
 * 1280px, and it only ever shortens a name that matches this template WHOLE:
 * a name that does not carry the prefix and the "Event" suffix is printed
 * verbatim, never guessed at. "PNW District Oregon State Fair Event" becomes
 * "Oregon State Fair"; "FIM District - Kettering University Event #1" becomes
 * "Kettering University #1"; "ISR District Event #1" and any non-district
 * name are left exactly as TBA published them.
 */
const DISTRICT_EVENT_NAME_TEMPLATE = /^[A-Za-z]{2,6} District (?:- )?(.+) Event( #\d+)?$/;

export function districtLedgerShortEventName(eventName: string): string {
  const match = DISTRICT_EVENT_NAME_TEMPLATE.exec(eventName);
  if (match === null) return eventName;
  return `${match[1]!}${match[2] ?? ""}`;
}

/** The per-event stage word the Event cell prints beside the name and week. */
export const DISTRICT_LEDGER_STAGE_WORDS = {
  unstarted: "not started",
  quals: "quals",
  selection: "alliance selection",
  playoffs: "playoffs",
  awards: "awards",
  done: "final",
} as const;

/** What a cell prints when the tab holds no distribution for it — an honest absence, never a fabricated zero. */
export const DISTRICT_LEDGER_UNAVAILABLE_CELL = "not available";

/** The prefix a median-form cell's second line carries. "likely" means 8 of 10 runs land there — the 10th to 90th percentile in plain words. */
export const DISTRICT_LEDGER_LIKELY_PREFIX = "likely";

/**
 * The lumpy-category words: the bold line's verb, and the conditional line's
 * clause.
 *
 * THE PLAYOFF ENTRY IS A CORRECTION. It read `play` / `if in`, which printed
 * "~66% play" on a cell whose points are zero for every alliance out in the
 * first two rounds — so the number was never the chance of PLAYING a playoff
 * match, it was the chance of finishing in the top four. Jacob, 2026-09-25:
 * "top four > finalist > winner". The word now says what the number is, and
 * `DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS` carries the two milestones past it.
 */
export const DISTRICT_LEDGER_CHANCE_WORDS = {
  alliance: { bold: "picked", conditional: "if picked" },
  elim: { bold: "top 4", conditional: "if top 4" },
  award: { bold: "award", conditional: "if won" },
} as const;

/**
 * The Playoffs cell's milestone words, for the two positions past a secured
 * top-four finish.
 *
 * The bold line reads `finalist ~40%` and the small line `~20 if finalist`: the
 * milestone first, then the tilde figure, which is the order Jacob wrote them
 * in. `top 4` is not here because it is not a milestone the bracket has reached
 * — it is the DEFAULT question, and its words live in
 * `DISTRICT_LEDGER_CHANCE_WORDS.elim` beside the other two categories'.
 */
export const DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS = {
  finalist: { bold: "finalist", conditional: "if finalist" },
  winner: { bold: "winner", conditional: "if winner" },
} as const;

/** The ordinal suffixes for placements one through eight, indexed `placement - 1`. A table, not arithmetic: eight values, and every English exception is inside them. */
const PLACEMENT_ORDINALS: readonly string[] = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

/**
 * The small line a Playoffs cell prints once the bracket has DECIDED its
 * alliance's placement: the placement, in plain words.
 *
 * No tilde, because a decided placement is not a prediction — it is what
 * happened. The bold line beside it still carries one, because the POINTS are
 * this site's own reading of that placement until TBA posts them.
 */
export function districtLedgerPlacementLine(placement: number): string {
  const ordinal = PLACEMENT_ORDINALS[placement - 1];
  // A placement outside the eight-alliance bracket cannot arise from
  // `routePlayedBracket`, which only ever produces 1 through 8. Printing the
  // bare number is the honest fallback rather than inventing a suffix.
  return ordinal === undefined ? `place ${String(placement)}` : `${ordinal} place`;
}

/** The two legend keys, verbatim from the UI-SPEC. */
export const DISTRICT_LEDGER_LEGEND_EARNED = "earned, final";
export const DISTRICT_LEDGER_LEGEND_OPEN = "still open · click for the histogram";

/** The likely/tilde explainer, verbatim from the UI-SPEC. */
export const DISTRICT_LEDGER_LEGEND_EXPLAINER = "likely = 8 of 10 runs land here · ~ = this site's prediction, not a number TBA published";

/** The Rewind slider's label, from CONTEXT's "The slider" section. */
export const DISTRICT_LEDGER_REWIND_LABEL = "Rewind to";

/**
 * The tick labels printed under the slider rail: the short form of the jump
 * chips that sit above it, so the axis reads without repeating the chips' own
 * words. Derived from the SAME chips, never a hardcoded week list.
 */
export const DISTRICT_LEDGER_TICK_START = "start";
export const DISTRICT_LEDGER_TICK_NOW = "now";
export function districtLedgerTickWeekLabel(week: number): string {
  // TBA weeks are zero indexed; every page on this site prints them one based.
  return `wk ${String(week + 1)}`;
}

/** The hint under the slider, in flat third person. */
export const DISTRICT_LEDGER_REWIND_HINT = "Rewinding reopens the categories a district event had already decided, and every status recomputes at the new position.";

/** The team-number search box's label and placeholder. */
export const DISTRICT_LEDGER_SEARCH_LABEL = "Team number";
export const DISTRICT_LEDGER_SEARCH_PLACEHOLDER = "Search a team number";

/** The stat line's labels. "Today's line" is a FLOOR, and the label says so. The open cell count was removed at Jacob's request (2026-09-25). */
export const DISTRICT_LEDGER_STAT_LINE_LABELS = {
  todaysLine: "Today's line (floor)",
  todaysLineUnknown: "Capacity not published",
} as const;

/** The empty state when the team search matches nothing. */
export const DISTRICT_LEDGER_NO_MATCHES = "No team matches that number.";

/**
 * Jacob's five status words, in the fixed order the chip row renders. The data
 * status `eliminated` is NEVER printed, and neither is the champ tab's sixth
 * verdict word for `contending` — this tab's "Out of range" means the median
 * projection, not elimination, which is exactly why the district tier needed
 * its own vocabulary.
 */
export const DISTRICT_LEDGER_STATUS_LABELS = {
  prequalified: "Prequalified",
  locked: "Locked",
  inRange: "In range",
  outOfRange: "Out of range",
  lockedOut: "Locked out",
} as const;

/** The variant a team locked BY AN AWARD renders — a note on one status, never a second status. */
export const DISTRICT_LEDGER_LOCKED_AWARD_LABEL = "Locked · award";

/**
 * The two printing limits sketch 020's language rules set on a chance, in
 * Jacob's own words: "Never show '>99%', print '99%'", and "A chance under 5%
 * is never printed as a number".
 *
 * BOTH ARE ABOUT WHAT THE NUMBER WOULD DO TO A READER, not about precision. A
 * team's season is never actually over while a slot can still come back to it
 * through a decline, a waitlist or a wildcard, so a printed 100 would be a
 * promise the page cannot keep; and a printed 2 reads as a verdict the run set
 * has no business handing down.
 */
export const DISTRICT_LEDGER_CHANCE_CEILING_PERCENT = 99;
export const DISTRICT_LEDGER_CHANCE_FLOOR_PERCENT = 5;

/** What a chance below the floor prints instead of a number. */
export const DISTRICT_LEDGER_CHANCE_BELOW_FLOOR = "<5% chance";

/**
 * The one line printed under an In range or Out of range chip.
 *
 * Takes a chance in `[0, 1]` and returns the whole line, so no caller ever
 * multiplies by a hundred or rounds on its own. The word `eliminated` never
 * appears here or anywhere else on this tab.
 */
export function districtLedgerChanceLine(chance: number): string {
  // The FLOOR is tested against the chance itself, before rounding: the rule
  // is that a chance under 5% never prints as a number, and 4.9% rounded to 5
  // would be exactly that number.
  if (chance * 100 < DISTRICT_LEDGER_CHANCE_FLOOR_PERCENT) return DISTRICT_LEDGER_CHANCE_BELOW_FLOOR;
  // The CEILING is a clamp on the printed value rather than on the chance,
  // because the thing being forbidden is the printed 100.
  const percent = Math.min(Math.round(chance * 100), DISTRICT_LEDGER_CHANCE_CEILING_PERCENT);
  return `${String(percent)}% chance`;
}

/** What a team renders when TBA published no capacity for this district-year — plain text, no chip, exactly as the shipped champ tab does for `unknown`. */
export const DISTRICT_LEDGER_CAPACITY_NOT_PUBLISHED = "Capacity not published";

/** The five definitions, VERBATIM from `10-UI-SPEC.md`'s `## Copy` section. A test pins them character for character. */
export const DISTRICT_LEDGER_STATUS_DEFINITIONS = {
  prequalified: "prequalified by FIRST",
  locked: "mathematically qualified, no matter what, on district points or an award",
  inRange: "if every team earned its median predicted points, this team would qualify",
  outOfRange: "if every team earned its median predicted points, this team would not qualify",
  lockedOut: "cannot earn enough district points to qualify",
} as const;

/**
 * The drawer's captions. Flat third person, no dash characters other than the
 * en dash inside a printed percentile range.
 *
 * WRITTEN FRESH rather than copied from the sketch: the sketch's own caption
 * describes a sketch simulation, and these say where the numbers actually come
 * from.
 */
export const DISTRICT_LEDGER_DRAWER_CELL_CAPTION = "The bar heights are the shape of the simulated points. The shaded band spans the 10th to the 90th percentile and the tick marks the median.";

/** The lumpy-category addendum: the chance of no points at all. */
export function districtLedgerNoPointsCaption(chancePercent: number): string {
  return `${String(chancePercent)}% of runs earn no points at all here.`;
}

/**
 * The grand total plot's caption. Today's line is the slot-th team's EARNED
 * points at this position, a FLOOR on where the real line ends up, since open
 * categories can only add points.
 */
export const DISTRICT_LEDGER_DRAWER_LINE_CAPTION = "The dashed line is the earned points of the team sitting at the last qualifying slot right now, a floor on where the real line ends up.";

/** What the grand total plot says INSTEAD of drawing a line at zero when capacity is unpublished. */
export const DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION = "TBA has published no capacity for this district, so there is no line to draw.";

/**
 * The grand total plot's chance caption, printed only where a chance is
 * actually printed beside the team's status.
 *
 * REPLACES the shipped `DISTRICT_LEDGER_DRAWER_NO_CHANCE_CAPTION`, which said a
 * chance of finishing above the line would need the line's own distribution and
 * that this page did not compute it. Quick task 260925-rpj computes it, from
 * this very distribution and every other team's own, so the old sentence had to
 * go in the same commit: a page still stating a limit it no longer has is worse
 * than one that never stated it.
 */
export const DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION =
  "The chance beside this team's status is the share of runs where a draw from this distribution lands inside the qualifying slots, against a draw from every other team's own.";

/** The drawer's two plot labels, used as their accessible names. */
export const DISTRICT_LEDGER_DRAWER_CELL_PLOT_LABEL = "Points for this category";
export const DISTRICT_LEDGER_DRAWER_GRAND_PLOT_LABEL = "Grand total district points";

/**
 * The named outcomes the Playoffs and Awards drawers list instead of drawing a
 * histogram.
 *
 * NAMES RATHER THAN POINT VALUES. Both categories pay exactly one of four or
 * five values, and every one of them has a name the reader already uses. A
 * histogram over the same distribution draws four bars and twenty-six gaps and
 * asks the reader to read a placement off an x position.
 */
export const DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS = {
  winner: "Wins the event",
  finalist: "Finalist",
  third: "Third place",
  fourth: "Fourth place",
  none: "Out before the top four",
} as const;

/** See `DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS`. `judged` is one judged award, which is the award support's own second bin. */
export const DISTRICT_LEDGER_AWARD_OUTCOME_LABELS = {
  impact: "Impact",
  rookieAllStar: "Rookie All Star",
  judged: "One judged award",
  none: "No award",
} as const;

/** The two outcome lists' headings, and the accessible name of each list. */
export const DISTRICT_LEDGER_OUTCOME_LIST_LABELS = {
  elim: "Playoff outcomes",
  award: "Award outcomes",
  alliance: "Alliance selection outcomes",
} as const;

/** The outcome list's two column headings. */
export const DISTRICT_LEDGER_OUTCOME_COLUMN_LABELS = { chance: "chance", points: "points" } as const;

/**
 * One outcome row's chance, as one string.
 *
 * THREE CASES, and the difference between them is what the reader is being told:
 *
 *   exactly zero  -> `0%`, with NO tilde. No run produced this outcome, which is
 *                    a count rather than an estimate, and a tilde would suggest
 *                    a number that could round the other way.
 *   under a half   -> `<1%`, because `~0%` beside a non-zero chance reads as
 *                    impossible when it is merely unlikely.
 *   anything else  -> `~NN%`, the tab's own tilde convention for a prediction.
 *
 * Deliberately NOT `districtLedgerChanceLine`'s 5-to-99 band: that band is about
 * a chance printed as a VERDICT beside a team's status, where a 2% reads as a
 * sentence being passed. These are the pieces one cell's own distribution breaks
 * into, and they have to sum to a hundred for the list to make sense.
 */
export function districtLedgerOutcomeChance(chance: number): string {
  if (chance <= 0) return "0%";
  if (chance < 0.005) return "<1%";
  return `~${String(Math.round(chance * 100))}%`;
}

/** One outcome row's point value. A whole number of points, never a tilde: the placement's value is a rule, not a prediction. */
export function districtLedgerOutcomePoints(points: number): string {
  return String(Math.round(points));
}

/**
 * The two outcome lists' captions, in flat third person.
 *
 * ONE PER LIST, not one shared. A single caption mentioning the bracket was
 * printed under the AWARD list too, where there is no bracket to have ruled
 * anything out; and the award list has its own fact to state, which is that a
 * team is never predicted to win two awards at one event.
 */
export const DISTRICT_LEDGER_OUTCOME_CAPTIONS = {
  elim: "Each row is one placement the playoffs can pay, with the share of runs that produced it. The rows the bracket has already ruled out are not listed.",
  award: "Each row is one award outcome, with the share of runs that produced it. A team is never predicted to win two awards at one event, so the rows never overlap.",
  alliance:
    "Each row is one route onto a playoff alliance, with the share of runs that produced it and the points that route paid in those runs. The rows the ranking has already ruled out are not listed.",
} as const;

/**
 * The grand total drawer's PER-EVENT contribution list.
 *
 * It replaced a second copy of the grand total histogram, which the drawer drew
 * twice whenever the clicked cell was the grand total itself (Jacob, 2026-09-25).
 * A reader who clicked the grand total was shown the same bars in both panes; the
 * question that pane can actually answer is which event the spread comes from.
 */
export const DISTRICT_LEDGER_CONTRIBUTION_LIST_LABEL = "Points by event";
/** "earned so far" rather than "earned": on an event still running, the published total is only what TBA has posted up to now. */
export const DISTRICT_LEDGER_CONTRIBUTION_COLUMN_LABELS = { event: "event", earned: "earned so far", open: "predicted total" } as const;

/** What the open column prints for an event that is already settled: nothing is open, so there is nothing to predict. */
export const DISTRICT_LEDGER_CONTRIBUTION_SETTLED = "settled";

/** What the earned column prints where TBA has published no points for that event yet. */
export const DISTRICT_LEDGER_CONTRIBUTION_NONE_EARNED = "none yet";

/** One event's earned total, or the honest absence. */
export function districtLedgerContributionEarned(earned: number | undefined): string {
  return earned === undefined ? DISTRICT_LEDGER_CONTRIBUTION_NONE_EARNED : String(Math.round(earned));
}

/**
 * The contribution list's caption, in flat third person.
 *
 * It has to say WHICH of the two numbers on an open row is the contribution, or
 * a reader adds them. A settled event contributes the number in the earned
 * column; an open one contributes the predicted total, which already includes
 * whatever it has earned so far.
 */
export const DISTRICT_LEDGER_CONTRIBUTION_CAPTION =
  "A settled event contributes its earned points exactly. An open one contributes the predicted total beside it, which already counts what it has earned so far. The grand total is those contributions added together, plus any rookie bonus.";

/** The Team cell's rookie bonus line, printed only when the bonus is non zero: 10 points in a team's first season, 5 in its second, added once per season. */
export function districtLedgerRookieBonusLine(points: number): string {
  return `+${String(points)} rookie bonus`;
}

/** The grand total plot's rookie bonus caption, printed only when the bonus is non zero. */
export function districtLedgerRookieBonusCaption(points: number): string {
  return `Includes the ${String(points)} point rookie bonus, added once per season and never to an event total.`;
}

/** The marked line's own short label beside the grand total plot. */
export const DISTRICT_LEDGER_DRAWER_LINE_LABEL = "Today's line";

/**
 * THIS TAB'S OWN WORDING of the conservatism caveat.
 *
 * Declared here rather than imported from `DistrictLocksTab.tsx`: reaching
 * across a component boundary for one string would couple the two tabs for no
 * gain, and this tab needs a second sentence that one does not.
 */
export const DISTRICT_LEDGER_CAVEAT =
  "A Locked verdict is a guarantee. A team that is not Locked has not been eliminated: declines, waitlist movement and wildcard slots can only ever help a team's chances, never hurt them.";

/**
 * The sentence the champ tab does not need, because this tab PREDICTS and that
 * one does not. Flat third person, no dash characters.
 */
export const DISTRICT_LEDGER_PROVENANCE =
  "Grey numbers are TBA's own. Every blue number is a prediction from this site's own simulation.";

/**
 * THE ALLIANCE SELECTION CELL'S ROUTE WORDS (quick task 260925-w4y).
 *
 * The bold line names the LIKELIER ROUTE and puts it first, exactly as the
 * Playoffs cell's milestone does: `captain ~70%` or `picked ~44%`. The small line
 * says `if in`, not `if picked`, because it is the typical amount given ANY
 * selection points and the bold line no longer covers both routes.
 *
 * `DISTRICT_LEDGER_CHANCE_WORDS.alliance` is untouched and still ships: it is
 * what a cell with NO route counts prints, which is every baked event. The two
 * wordings are different because the two numbers are different, and printing the
 * route wording over the any-points chance would be the same conflation this task
 * exists to remove.
 */
export const DISTRICT_LEDGER_SELECTION_ROUTE_WORDS = {
  captain: { bold: "captain", conditional: "if in" },
  picked: { bold: "picked", conditional: "if in" },
} as const;

/** The route names the settled line uses. A table, so "first pick" is never assembled from a slot number at a call site. */
export const DISTRICT_LEDGER_SELECTION_ROUTE_NAMES = {
  captain: "captain",
  firstPick: "first pick",
  secondPick: "second pick",
  backup: "backup robot",
  notSelected: "not selected",
} as const;

/**
 * The small line an Alliance selection cell prints once the RANKING IS FIXED and
 * every run put the team on one alliance in one slot: the route, then the
 * alliance it is on.
 *
 * No tilde, on the same terms as the Playoffs cell's settled placement line: with
 * the ranking settled the draft this model produces from it is determined, so the
 * route is not a prediction. The bold line beside it still carries one, because
 * the POINTS are this site's reading until TBA posts them.
 */
export function districtLedgerSelectionSettledLine(
  route: keyof typeof DISTRICT_LEDGER_SELECTION_ROUTE_NAMES,
  allianceNumber: number
): string {
  return `${DISTRICT_LEDGER_SELECTION_ROUTE_NAMES[route]}, alliance ${String(allianceNumber)}`;
}

/** The Alliance selection outcome list's row labels. Sentence case, like the other two lists'. */
export const DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS = {
  captain: "Captain",
  firstPick: "First pick",
  secondPick: "Second pick",
  backup: "Backup robot",
  notSelected: "Not selected",
} as const;

/**
 * One outcome row's point value as a RANGE, or as a single number where the two
 * ends meet.
 *
 * "9 to 16" rather than a dash, because a dash between two numbers on this tab
 * means a percentile range (the `likely` line) and these are not percentiles.
 * Never the plus-minus codepoint, which is reserved for one standard deviation of
 * full predictive variance.
 */
export function districtLedgerOutcomePointsRange(minPoints: number, maxPoints: number): string {
  const low = Math.round(minPoints);
  const high = Math.round(maxPoints);
  return low === high ? String(low) : `${String(low)} to ${String(high)}`;
}
