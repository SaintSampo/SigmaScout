/**
 * EVERY STRING the District Locks tab prints, in one module.
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
export const DISTRICT_LEDGER_TAB_LABEL = "District Locks";

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
 *
 * A SPONSOR TAIL IS DROPPED (Jacob, 2026-10-04): most Michigan events publish
 * as "FIM District Chelsea Event presented by DTE", which the template used to
 * refuse whole, so the picker's menu and the Event cell printed the full name.
 * "presented by <anyone>" after the word "Event" is now part of the template
 * and is not printed; the event's own name is still never guessed at.
 */
const DISTRICT_EVENT_NAME_TEMPLATE = /^[A-Za-z]{2,6} District (?:- )?(.+?) Event( #\d+)?(?: presented by .+)?$/;

export function districtLedgerShortEventName(eventName: string): string {
  const match = DISTRICT_EVENT_NAME_TEMPLATE.exec(eventName);
  if (match === null) return eventName;
  return `${match[1]!}${match[2] ?? ""}`;
}

/**
 * The name the Locks milestone picker prints for an event. A district
 * championship prints "DCMP" (Jacob, 2026-10-04: the full name made the event
 * menu too wide), and one of its divisions prints "DCMP <division>" so two
 * divisions never share a label. Every other event prints the ledger's own
 * short form.
 */
export function locksPickerEventName(eventName: string, isDcmp: boolean): string {
  if (!isDcmp) return districtLedgerShortEventName(eventName);
  const division = / - ([^-]+?) Division$/.exec(eventName);
  return division === null ? "DCMP" : `DCMP ${division[1]!.trim()}`;
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

// ---------------------------------------------------------------------------
// The Locks milestone picker (sketch 024 variant Q)
// ---------------------------------------------------------------------------

/** The label beside the event menu, and the two pills. Sketch 024 Q's own words. */
export const LOCKS_PICKER_EVENT_LABEL = "Event";
export const LOCKS_PICKER_SEASON_START = "Season start";
export const LOCKS_PICKER_LIVE = "Live";
/** The word above the red line that marks where a live event is. */
export const LOCKS_PICKER_NOW_MARK = "now";
/** The two arrow buttons' accessible names. */
export const LOCKS_PICKER_PREV_LABEL = "Previous milestone";
export const LOCKS_PICKER_NEXT_LABEL = "Next milestone";
/** The Next text at the end of the walk. */
export const LOCKS_PICKER_THIS_IS_LIVE = "This is live";

/**
 * The stepper's group row: each label and its grid column span over the eight
 * stops. Sketch 024 Q has nine stops; the Playoffs half stop is not modelled
 * yet, so Playoffs spans one column and Awards moves to the eighth.
 */
export const DISTRICT_LEDGER_MILESTONE_GROUPS: readonly { readonly label: string; readonly from: number; readonly to: number }[] = [
  { label: "Schedule", from: 1, to: 2 },
  { label: "Qualification", from: 2, to: 6 },
  { label: "Alliances", from: 6, to: 7 },
  { label: "Playoffs", from: 7, to: 8 },
  { label: "Awards", from: 8, to: 9 },
];

/** The short word under each stop, keyed by milestone. */
export const DISTRICT_LEDGER_MILESTONE_SUB_WORDS = {
  schedule: "Out",
  q1: "¼",
  q2: "½",
  q3: "¾",
  qualsDone: "Done",
  alliance: "Done",
  playoffs: "Done",
  awards: "Done",
} as const;

/** The long form of each stop, used in its title and its accessible name. */
export const DISTRICT_LEDGER_MILESTONE_LONG_WORDS = {
  schedule: "schedule released",
  q1: "quals ¼ done",
  q2: "quals ½ done",
  q3: "quals ¾ done",
  qualsDone: "quals done",
  alliance: "alliance selection done",
  playoffs: "playoffs done",
  awards: "awards done",
} as const;

type LocksPickerMilestoneKey = keyof typeof DISTRICT_LEDGER_MILESTONE_LONG_WORDS;

/** A milestone's title: `Belleville · Quals ¼ done`. */
export function locksPickerMilestoneTitle(eventName: string, key: LocksPickerMilestoneKey): string {
  const long = DISTRICT_LEDGER_MILESTONE_LONG_WORDS[key];
  return `${eventName} · ${long[0]!.toUpperCase()}${long.slice(1)}`;
}

/** A stop's accessible name, with the not-played suffix on a stop that has not happened. */
export function locksPickerStopLabel(eventName: string, key: LocksPickerMilestoneKey, happened: boolean): string {
  return `${eventName} ${DISTRICT_LEDGER_MILESTONE_LONG_WORDS[key]}${happened ? "" : ", not played yet"}`;
}

/** The text beside the arrows: where the next arrow lands, or the end of the walk. */
export function locksPickerNextText(nextTitle: string | undefined): string {
  return nextTitle === undefined ? LOCKS_PICKER_THIS_IS_LIVE : `Next: ${nextTitle}`;
}

/** The three words an event menu group carries after its week. */
export const LOCKS_PICKER_GROUP_STATUS_WORDS = { done: "done", live: "live", up: "not played yet" } as const;

/**
 * The event menu's group label. TBA weeks are zero indexed and every page on
 * this site prints them one based; the DCMP tier gets its own group.
 */
export function locksPickerGroupLabel(group: { readonly week: number | null; readonly isDcmp: boolean }, status: keyof typeof LOCKS_PICKER_GROUP_STATUS_WORDS): string {
  const head = group.isDcmp ? "DCMP" : group.week === null ? "Week not published" : `Week ${String(group.week + 1)}`;
  return `${head} · ${LOCKS_PICKER_GROUP_STATUS_WORDS[status]}`;
}

/** One event menu option: the event's name, marked when it is live. */
export function locksPickerOptionLabel(eventName: string, live: boolean): string {
  return live ? `${eventName} (live)` : eventName;
}

/** The caption under the stepper for an event that has not started. */
export function locksPickerUpCaption(eventName: string): string {
  return `${eventName} has not started. Its milestones open as they happen.`;
}

/** The caption under the stepper for a live event. */
export function locksPickerLiveCaption(eventName: string): string {
  return `${eventName} is live. Milestones past the red line have not happened yet; use Live for the current state.`;
}

/** The team-number search box's label and placeholder. */
export const DISTRICT_LEDGER_SEARCH_LABEL = "Team number";
export const DISTRICT_LEDGER_SEARCH_PLACEHOLDER = "Search a team number";

/**
 * THE CUTOFF'S FOUR LABELS, shared by the stat line and every grand total
 * dashed rule so the two can never print different words (quick task
 * 260926-37q).
 *
 * `predicted` is the ordinary reading. `predictedDistrictOnly` is the champ
 * tab's pre registration window, where the grand totals behind the cutoff are
 * the district season alone and the label has to say so. `settled` drops the
 * word predicted where every team in the pool is done. `capacityUnknown` is
 * the shipped unpublished capacity wording, unchanged.
 */
export const DISTRICT_LEDGER_CUTOFF_LABELS = {
  predicted: "Predicted cutoff",
  predictedDistrictOnly: "Predicted cutoff (district only)",
  settled: "Cutoff",
  capacityUnknown: "Capacity not published",
} as const;

/**
 * The cutoff's own figure: a tilde on a prediction, a bare integer on a settled
 * one.
 *
 * THE TILDE IS THIS TAB'S STANDING RULE (quick task 260925-m7e): every
 * predicted figure on either Locks tab carries one, and a settled figure never
 * does.
 */
export function districtLedgerCutoffFigure(points: number, isFinal: boolean): string {
  const figure = String(Math.round(points));
  return isFinal ? figure : `~${figure}`;
}

/**
 * The cutoff's likely range: the 10th to the 90th percentile of where the line
 * landed across the runs, as WHOLE NUMBERS with an en dash.
 *
 * `undefined` where the two rounded ends coincide, on `openCellLines`' own
 * recorded rule: a percentile range whose ends are the same number says
 * nothing worth printing, and printing it invites a reader to read a spread
 * into it that is not there.
 *
 * The en dash is the range separator and the plus minus codepoint never
 * appears — it is reserved for exactly one standard deviation of full
 * predictive variance, which this is not.
 */
export function districtLedgerCutoffLikelyText(p10: number, p90: number): string | undefined {
  const low = Math.round(p10);
  const high = Math.round(p90);
  if (low === high) return undefined;
  return `${DISTRICT_LEDGER_LIKELY_PREFIX} ${String(low)}–${String(high)}`;
}

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

/**
 * The five definitions, VERBATIM from `10-UI-SPEC.md`'s `## Copy` section. A
 * test pins them character for character.
 *
 * WHERE THE DISTRICT TAB PRINTS THEM since quick task 261004-uw4: wherever In
 * range and Out of range are still cut at the median projections, which is a
 * position where every team still racing for points is settled, and the
 * excluded team fallback (a run that landed but left a team out). Both
 * sentences are exactly that rule. Everywhere else the tab prints
 * `DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS` below.
 */
export const DISTRICT_LEDGER_STATUS_DEFINITIONS = {
  prequalified: "prequalified by FIRST",
  locked: "mathematically qualified, no matter what, on district points or an award",
  inRange: "if every team earned its median predicted points, this team would qualify",
  outOfRange: "if every team earned its median predicted points, this team would not qualify",
  lockedOut: "cannot earn enough district points to qualify",
} as const;

/**
 * THE DISTRICT TAB'S DEFINITIONS WHILE THE SIMULATED LINE IS IN PLAY (quick
 * task 261004-uw4): printed while the predicted cutoff is the median of the
 * simulated line, and while that line is pending or cannot be drawn. In range
 * and Out of range cut at the predicted cutoff there, so the two "if every
 * team earned its median" sentences above would be false for every team
 * between the old line and the new one.
 *
 * TWO SETS RATHER THAN ONE SENTENCE FOR BOTH, deliberately. Under the midpoint
 * rule an Out of range team can sit exactly AT the printed cutoff (a first
 * team out at 59 and a last team in at 59.4 print a cutoff of 59), so "sit
 * below the predicted cutoff" is not true of that rule, and "would not
 * qualify at the medians" is not true of this one. The other three read as
 * the set above.
 */
export const DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS: Readonly<Record<keyof typeof DISTRICT_LEDGER_STATUS_DEFINITIONS, string>> = {
  ...DISTRICT_LEDGER_STATUS_DEFINITIONS,
  inRange: "this team's median predicted points sit at or above the predicted cutoff",
  outOfRange: "this team's median predicted points sit below the predicted cutoff",
};

/**
 * THE CHAMP TAB'S DEFINITIONS (quick task 260927-syh). Its In range and Out of
 * range no longer cut at "every team earns its median": since 260927-6bf they
 * cut at the predicted cutoff, which is the simulated line while DCMP awards
 * are still to come, so the Championship slots award winners take are already
 * in it. The between property makes both sentences true of the boundary
 * cutoff after the awards post as well. The other three read as the district
 * tab's do.
 */
export const CHAMP_LEDGER_STATUS_DEFINITIONS: Readonly<Record<keyof typeof DISTRICT_LEDGER_STATUS_DEFINITIONS, string>> = {
  ...DISTRICT_LEDGER_STATUS_DEFINITIONS,
  inRange: "this team's median predicted points sit at or above the predicted cutoff, which already counts the slots DCMP award winners take",
  outOfRange: "this team's median predicted points sit below the predicted cutoff",
};

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
 * The grand total plot's caption: what the dashed rule is, then what the likely
 * range is. Two sentences, flat third person, and no dash character of any kind
 * (the en dash belongs to the numeric range alone).
 */
export const DISTRICT_LEDGER_DRAWER_CUTOFF_CAPTION =
  "The dashed line is the predicted cutoff, the midpoint of the last team in range and the first team out of range. The likely range spans the 10th to the 90th percentile of where that line lands across the runs.";

/**
 * The grand total plot's caption for the District Locks tab's SIMULATED line
 * (quick task 261004-uw4): what the number is, then what its likely range
 * spans. The caption above stays for the midpoint rule, which still prints at
 * an open position where a run left a team out. No dash character.
 */
export const DISTRICT_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION =
  "The dashed line is the predicted cutoff, the median across the runs of the points the last team inside the qualifying slots finishes with. The likely range spans the 10th to the 90th percentile of that same line.";

/** What the grand total plot says INSTEAD of drawing a line at zero when capacity is unpublished. */
export const DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION = "TBA has published no capacity for this district, so there is no cutoff to draw.";

/** What the grand total plot says where every team still racing for points is inside the slots, so no first team sits outside them. */
export const DISTRICT_LEDGER_DRAWER_NO_CUTOFF_CAPTION =
  "Every team still racing for points is inside the slots at this position, so there is no first team outside them for a cutoff to sit above.";

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

/**
 * THIS TAB'S OWN WORDING of the conservatism caveat.
 *
 * Declared here rather than inside a component: this module is where every
 * string on either Locks tab lives, and `ChampLocksLedger.tsx` prints this
 * very constant beside its own provenance sentence.
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

// ---------------------------------------------------------------------------
// THE CHAMP LOCKS TAB (sketch 022, quick task 260925-xab)
//
// Every string the champ tab prints lives here too, beside the district tier's,
// rather than in a second copy module: the two tabs share every chip, every
// definition, every legend key and the whole drawer vocabulary, and splitting
// the file would be splitting one contract in half. The names all carry the
// `CHAMP_LEDGER_` prefix, so a reader can see at a glance which tier a string
// belongs to.
// ---------------------------------------------------------------------------

/** The champ tab's own label. Its URL id stays `champ-locks`, which is `searchParams.ts`'s `DISTRICT_TABS` member. */
export const CHAMP_LEDGER_TAB_LABEL = "Champ Locks";

/**
 * The champ table's column labels, in render order.
 *
 * "Source" rather than "Event" (the sketch 022 question, answered): the two
 * rows are a SUMMED set of district events and one championship, so neither
 * one is an event, and "Points" would repeat every header beside it.
 * "Subtotal" rather than "Event total" for the same reason.
 */
export const CHAMP_LEDGER_COLUMN_LABELS = [
  "Team",
  "Status",
  "Grand total",
  "Source",
  "Subtotal",
  "Qualification",
  "Alliance selection",
  "Playoffs",
  "Awards",
] as const;

/** The two row labels, in the fixed order the table renders them. */
export const CHAMP_LEDGER_ROW_LABELS = { district: "District points", dcmp: "DCMP points" } as const;

/**
 * The award variant the district tier never has: the District Championship's
 * WINNING ALLIANCE also qualifies for the FIRST Championship, which is a
 * different and more specific claim than a judged award.
 * `DISTRICT_LEDGER_LOCKED_AWARD_LABEL` covers the judged case unchanged.
 */
export const CHAMP_LEDGER_LOCKED_WINNER_LABEL = "Locked · winner";

/** The DCMP row's small line for a team the field has left out. */
export const CHAMP_LEDGER_NOT_IN_FIELD_LINE = "not in the field";

/**
 * What a DCMP cell prints for a team outside the field: an EM DASH, built from
 * its codepoint so this file never types the glyph.
 *
 * The dash means "not in the field" and nothing else on this tab, which is why
 * the pre-registration window below prints words instead of reusing it.
 */
export const CHAMP_LEDGER_NOT_IN_FIELD_CELL = String.fromCharCode(0x2014);

/**
 * THE PRE-REGISTRATION WINDOW, in two strings.
 *
 * `remainingEvents` on the district artifact is built from TBA registrations,
 * and a team registers for its District Championship only AFTER it qualifies.
 * So for most of the district season nothing on the artifact names the DCMP at
 * all: no dcmp-tier `eventPoints` row, no dcmp-tier `remainingEvents` row, no
 * event key to fetch and no baked sidecar to read. The DCMP row then has
 * nothing to predict, and it says so in words.
 *
 * NOT THE EM DASH, which already means "not in the field" here, and not "not
 * available", which is what a cell says when a prediction was attempted and
 * refused. This is a third thing: the championship has not been priced yet
 * because the field it would be priced over does not exist yet.
 */
export const CHAMP_LEDGER_NOT_YET_PRICED_CELL = "not yet priced";

/**
 * The grand total's small line while the DCMP is not yet priced.
 *
 * The figure above it is the DISTRICT grand total, which is a real number and a
 * true one; it is simply not the whole of what the column is named after. The
 * line says which, so the number is never mistaken for a complete one.
 */
export const CHAMP_LEDGER_DISTRICT_ONLY_LINE = "district only";

/**
 * The DCMP row's small line while a team's place in the field is still open:
 * the one chance, printed once, on the row LABEL rather than inside the four
 * cells (sketch 022 variant A).
 *
 * Clamped by the SAME pair `districtLedgerChanceLine` uses, for the same two
 * reasons, so the two lines can never disagree about what a printable chance
 * is. The tilde is mandatory: every blue figure on this site carries one.
 */
export function champLedgerFieldChanceLine(chance: number): string {
  if (chance * 100 < DISTRICT_LEDGER_CHANCE_FLOOR_PERCENT) return `<${String(DISTRICT_LEDGER_CHANCE_FLOOR_PERCENT)}% to be there`;
  const percent = Math.min(Math.round(chance * 100), DISTRICT_LEDGER_CHANCE_CEILING_PERCENT);
  return `~${String(percent)}% to be there`;
}

/** One source event on the District points row's small line. The stage is a KEY into `DISTRICT_LEDGER_STAGE_WORDS`, so the word is looked up here rather than assembled at a call site. */
export interface ChampLedgerSourceEntry {
  readonly eventName: string;
  readonly week: number | null;
  readonly stage: keyof typeof DISTRICT_LEDGER_STAGE_WORDS;
}

/**
 * The District points row's small line: every district event behind the row,
 * with its short name, its ONE-BASED week (260925-opv) and its stage word.
 *
 * The sketch's own example is "Bonney Lake Wk 1 · final". A row with no
 * district event at all returns the empty string, which the caller prints as
 * nothing rather than as an empty bullet.
 */
export function champLedgerDistrictSourceLine(entries: readonly ChampLedgerSourceEntry[]): string {
  return entries
    .map((entry) => {
      const name = districtLedgerShortEventName(entry.eventName);
      const week = entry.week === null ? "" : ` Wk ${String(entry.week + 1)}`;
      return `${name}${week} · ${DISTRICT_LEDGER_STAGE_WORDS[entry.stage]}`;
    })
    .join(" · ");
}

/**
 * The DCMP row's small line when the field is settled and priced: the
 * championship's WEEK and STAGE, and not its name.
 *
 * Sketch 022 is explicit that this row's line is "the DCMP stage, or the chance
 * of being in the field, or not in the field" — the name is already in the row
 * label beside it, and a District Championship's published name
 * ("Pacific Northwest FIRST District Championship") matches no shortening
 * template and wrapped to three lines on a phone when it was printed here.
 */
export function champLedgerDcmpStageLine(entry: { readonly week: number | null; readonly stage: keyof typeof DISTRICT_LEDGER_STAGE_WORDS }): string {
  const word = DISTRICT_LEDGER_STAGE_WORDS[entry.stage];
  return entry.week === null ? word : `Wk ${String(entry.week + 1)} · ${word}`;
}

/**
 * The grand total drawer's two-row contribution list.
 *
 * THE SAME OBJECT the table's own row labels come from, deliberately: the list
 * describes the very two rows above it, and two tables of the same two words
 * are two places for them to drift.
 */
export const CHAMP_LEDGER_CONTRIBUTION_ROW_LABELS = CHAMP_LEDGER_ROW_LABELS;

/** The champ contribution list's own label and its first column heading — the other two headings are the district tier's, unchanged. */
export const CHAMP_LEDGER_CONTRIBUTION_LIST_LABEL = "Points by source";
export const CHAMP_LEDGER_CONTRIBUTION_COLUMN_SOURCE = "source";

/**
 * The note under the DCMP row of the contribution list: the field chance the
 * row is weighted by, named so a reader can see why the two subtotals do not
 * add to the grand total.
 */
export function champLedgerContributionChanceNote(chance: number): string {
  return `weighted by ${champLedgerFieldChanceLine(chance)}`;
}

/**
 * The champ contribution list's caption, in flat third person.
 *
 * It states the ONE thing the district tier's caption cannot: the DCMP row is
 * weighted by the chance of being in the field, so the grand total is less than
 * the two subtotals added together whenever that chance is under one.
 */
export const CHAMP_LEDGER_CONTRIBUTION_CAPTION =
  "A settled row contributes its earned points exactly. An open one contributes the predicted total beside it. While a team's place in the District Championship field is still open, the championship row is weighted by the chance of being there, so the grand total sits below the two rows added together.";

// ---------------------------------------------------------------------------
// The simulated champ cutoff (quick task 260927-6bf)
//
// THE DISTRICT LOCKS TAB READS THESE TOO since quick task 261004-uw4: the two
// range call labels, the pending description, the pending figure, the pending
// caption and the no call reasons below. They keep the `CHAMP_LEDGER_` prefix
// and their text, because the champ suites pin both and the words are true of
// either tab's simulated line.
// ---------------------------------------------------------------------------

/**
 * THE TWO WITHHELD CHIPS, per Jacob's 2026-09-27 chip timing decision. While
 * the simulated line is still being computed, a contending team's chip reads
 * the neutral `pending` word; where no line can be drawn it reads `No call`.
 * Neither word says In range or Out of range, because neither side has been
 * called. Flat, and no dash character.
 */
export const CHAMP_LEDGER_RANGE_CALL_LABELS = {
  pending: "Pending",
  noCall: "No call",
} as const;

/** The withheld chips' accessible descriptions. The No call one is completed by the reason. */
export const CHAMP_LEDGER_RANGE_PENDING_DESCRIPTION =
  "The simulated cutoff is still running, so this team is not yet called in or out of range.";

/**
 * Each TERMINAL refusal, named. Printed after the stat line's figure and in
 * the No call chip's description, lower case so either can carry it.
 */
export const CHAMP_LEDGER_NO_CALL_REASONS = {
  noHistoryTable: "no earlier season to estimate the District Championship from",
  unpricedDcmp: "a team in the District Championship field has no priced championship points",
  noFieldChance: "a team's chance of reaching the District Championship could not be computed",
  runRefused: "the championship run could not be built at this position",
  teamsExcluded: "a team's grand total could not be built, so the run would rank a smaller field",
  noLine: "no run left a points slot to read a line at",
  workerError: "the simulation did not finish in this browser",
} as const;

/** The No call chip's accessible description: what it means, then why. */
export function champLedgerNoCallDescription(reason: keyof typeof CHAMP_LEDGER_NO_CALL_REASONS): string {
  return `No predicted cutoff can be drawn at this position: ${CHAMP_LEDGER_NO_CALL_REASONS[reason]}.`;
}

/** The stat line's figure while the simulated line is still being computed: a word, never a number. */
export const CHAMP_LEDGER_CUTOFF_PENDING_FIGURE = "pending";

/**
 * The grand total plot's caption for the SIMULATED line: what the number is,
 * then what its likely range spans (shown since Jacob, 2026-09-27).
 */
export const CHAMP_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION =
  "The dashed line is the predicted cutoff, the median of a simulated line. In each run the District Championship winning alliance and its Impact, Engineering Inspiration and Rookie All Star winners take their slots first, and the line is read from the teams left. The likely range spans the 10th to the 90th percentile of where that line lands across the runs.";

/** What the grand total plot says while the line is still being simulated. */
export const CHAMP_LEDGER_DRAWER_PENDING_CAPTION = "The predicted cutoff is still being simulated, so no line is drawn yet.";

/** What the grand total plot says where no line can be drawn, with the reason. */
export function champLedgerDrawerNoCallCaption(reason: keyof typeof CHAMP_LEDGER_NO_CALL_REASONS): string {
  return champLedgerNoCallDescription(reason);
}

/**
 * The DCMP row's small line for an ESTIMATED row: before the District
 * Championship starts, its points come from how teams at the same place in
 * past championship fields scored, not from any roster. Printed only when no
 * field chance line is.
 */
export const CHAMP_LEDGER_ESTIMATED_DCMP_LINE = "estimated from past District Championships";
