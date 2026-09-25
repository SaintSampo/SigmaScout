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
  "Event",
  "Qualification",
  "Alliance selection",
  "Playoffs",
  "Awards",
  "Event total",
  "Grand total",
] as const;

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
export const DISTRICT_LEDGER_LEGEND_EXPLAINER = "likely = 8 of 10 runs land here · ~ = typical amount when it happens";

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
