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

/** The lumpy-category words: the bold line's verb, and the conditional line's clause. */
export const DISTRICT_LEDGER_CHANCE_WORDS = {
  alliance: { bold: "picked", conditional: "if picked" },
  elim: { bold: "play", conditional: "if in" },
  award: { bold: "award", conditional: "if won" },
} as const;

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

/** The stat line's three labels. "Today's line" is a FLOOR, and the label says so. */
export const DISTRICT_LEDGER_STAT_LINE_LABELS = {
  todaysLine: "Today's line (floor)",
  todaysLineUnknown: "Capacity not published",
  openCells: "Open cells",
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

/** The limit this page states outright rather than letting a reader infer a chance it does not compute. */
export const DISTRICT_LEDGER_DRAWER_NO_CHANCE_CAPTION = "A chance of finishing above the line would need the line's own distribution, which this page does not compute.";

/** The drawer's two plot labels, used as their accessible names. */
export const DISTRICT_LEDGER_DRAWER_CELL_PLOT_LABEL = "Points for this category";
export const DISTRICT_LEDGER_DRAWER_GRAND_PLOT_LABEL = "Grand total district points";

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
