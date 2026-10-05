/**
 * The copy CONTRACT.
 *
 * Every string below is lifted character for character from `10-UI-SPEC.md`'s
 * `## Copy` section, which is a contract rather than a suggestion. The
 * literals are restated here deliberately: a test that imported the same
 * constant it asserts would pin nothing at all.
 */
import { describe, expect, it } from "vitest";
import {
  CHAMP_LEDGER_STATUS_DEFINITIONS,
  CHAMP_LEDGER_CUTOFF_PENDING_FIGURE,
  CHAMP_LEDGER_DRAWER_PENDING_CAPTION,
  CHAMP_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION,
  CHAMP_LEDGER_ESTIMATED_DCMP_LINE,
  CHAMP_LEDGER_NO_CALL_REASONS,
  CHAMP_LEDGER_RANGE_CALL_LABELS,
  CHAMP_LEDGER_RANGE_PENDING_DESCRIPTION,
  champLedgerNoCallDescription,
  districtLedgerChanceLine,
  districtLedgerCutoffFigure,
  districtLedgerCutoffLikelyText,
  districtLedgerRookieBonusLine,
  districtLedgerRookieBonusCaption,
  DISTRICT_LEDGER_AWARD_OUTCOME_LABELS,
  DISTRICT_LEDGER_CHANCE_BELOW_FLOOR,
  DISTRICT_LEDGER_CHANCE_WORDS,
  DISTRICT_LEDGER_CONTRIBUTION_CAPTION,
  DISTRICT_LEDGER_CONTRIBUTION_SETTLED,
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_CUTOFF_LABELS,
  DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION,
  DISTRICT_LEDGER_DRAWER_CUTOFF_CAPTION,
  DISTRICT_LEDGER_DRAWER_NO_CUTOFF_CAPTION,
  DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION,
  DISTRICT_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION,
  DISTRICT_LEDGER_LEGEND_EARNED,
  DISTRICT_LEDGER_LEGEND_EXPLAINER,
  DISTRICT_LEDGER_LEGEND_OPEN,
  DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
  DISTRICT_LEDGER_OUTCOME_CAPTIONS,
  DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS,
  DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS,
  DISTRICT_LEDGER_OUTCOME_LIST_LABELS,
  DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS,
  DISTRICT_LEDGER_SELECTION_ROUTE_WORDS,
  DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_LABELS,
  DISTRICT_LEDGER_TAB_LABEL,
  districtLedgerContributionEarned,
  districtLedgerOutcomeChance,
  districtLedgerOutcomePoints,
  districtLedgerOutcomePointsRange,
  districtLedgerPlacementLine,
  districtLedgerSelectionSettledLine,
  districtLedgerShortEventName,
  CHAMP_LEDGER_COLUMN_LABELS,
  CHAMP_LEDGER_CONTRIBUTION_CAPTION,
  CHAMP_LEDGER_CONTRIBUTION_COLUMN_SOURCE,
  CHAMP_LEDGER_CONTRIBUTION_LIST_LABEL,
  CHAMP_LEDGER_CONTRIBUTION_ROW_LABELS,
  CHAMP_LEDGER_DISTRICT_ONLY_LINE,
  CHAMP_LEDGER_LOCKED_WINNER_LABEL,
  CHAMP_LEDGER_NOT_IN_FIELD_CELL,
  CHAMP_LEDGER_NOT_IN_FIELD_LINE,
  CHAMP_LEDGER_NOT_YET_PRICED_CELL,
  CHAMP_LEDGER_ROW_LABELS,
  CHAMP_LEDGER_TAB_LABEL,
  champLedgerContributionChanceNote,
  champLedgerDcmpStageLine,
  champLedgerDistrictSourceLine,
  champLedgerFieldChanceLine,
  DISTRICT_LEDGER_MILESTONE_GROUPS,
  DISTRICT_LEDGER_MILESTONE_LONG_WORDS,
  DISTRICT_LEDGER_MILESTONE_SUB_WORDS,
  LOCKS_PICKER_EVENT_LABEL,
  LOCKS_PICKER_LIVE,
  LOCKS_PICKER_NEXT_LABEL,
  LOCKS_PICKER_NOW_MARK,
  LOCKS_PICKER_PREV_LABEL,
  LOCKS_PICKER_SEASON_START,
  LOCKS_PICKER_THIS_IS_LIVE,
  locksPickerGroupLabel,
  locksPickerLiveCaption,
  locksPickerMilestoneTitle,
  locksPickerNextText,
  locksPickerOptionLabel,
  locksPickerStopLabel,
  locksPickerUpCaption,
} from "./districtLedgerCopy.js";

describe("the UI-SPEC copy contract", () => {
  it("pins the five status definitions character for character", () => {
    expect(DISTRICT_LEDGER_STATUS_DEFINITIONS.prequalified).toBe("prequalified by FIRST");
    expect(DISTRICT_LEDGER_STATUS_DEFINITIONS.locked).toBe("mathematically qualified, no matter what, on district points or an award");
    expect(DISTRICT_LEDGER_STATUS_DEFINITIONS.inRange).toBe("if every team earned its median predicted points, this team would qualify");
    expect(DISTRICT_LEDGER_STATUS_DEFINITIONS.outOfRange).toBe("if every team earned its median predicted points, this team would not qualify");
    expect(DISTRICT_LEDGER_STATUS_DEFINITIONS.lockedOut).toBe("cannot earn enough district points to qualify");
  });

  // Quick task 261004-uw4: the five 10-UI-SPEC sentences above still print
  // where the district tab's chips cut at the median projections. While its
  // predicted cutoff is the simulated line (or pending, or refused) the tab
  // prints this second set, whose In range and Out of range name that cutoff.
  it("pins the district tab's simulated In range and Out of range to the predicted cutoff, and keeps its other three definitions (261004-uw4)", () => {
    expect(DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS.inRange).toBe("this team's median predicted points sit at or above the predicted cutoff");
    expect(DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS.outOfRange).toBe("this team's median predicted points sit below the predicted cutoff");
    expect(DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS.prequalified).toBe(DISTRICT_LEDGER_STATUS_DEFINITIONS.prequalified);
    expect(DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS.locked).toBe(DISTRICT_LEDGER_STATUS_DEFINITIONS.locked);
    expect(DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS.lockedOut).toBe(DISTRICT_LEDGER_STATUS_DEFINITIONS.lockedOut);
    for (const definition of Object.values(DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS)) expect(definition).not.toMatch(/[-‐-―−]/);
    // The district line hands no slot to an award winner inside a run, so it
    // must not borrow the champ tab's clause that says it does.
    expect(DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS.inRange).not.toContain("award");
  });

  it("pins the champ tab's In range and Out of range to the predicted cutoff, and keeps its other three definitions the district tab's (260927-syh)", () => {
    expect(CHAMP_LEDGER_STATUS_DEFINITIONS.inRange).toBe("this team's median predicted points sit at or above the predicted cutoff, which already counts the slots DCMP award winners take");
    expect(CHAMP_LEDGER_STATUS_DEFINITIONS.outOfRange).toBe("this team's median predicted points sit below the predicted cutoff");
    expect(CHAMP_LEDGER_STATUS_DEFINITIONS.prequalified).toBe(DISTRICT_LEDGER_STATUS_DEFINITIONS.prequalified);
    expect(CHAMP_LEDGER_STATUS_DEFINITIONS.locked).toBe(DISTRICT_LEDGER_STATUS_DEFINITIONS.locked);
    expect(CHAMP_LEDGER_STATUS_DEFINITIONS.lockedOut).toBe(DISTRICT_LEDGER_STATUS_DEFINITIONS.lockedOut);
    for (const definition of Object.values(CHAMP_LEDGER_STATUS_DEFINITIONS)) expect(definition).not.toMatch(/[\u002d\u2010-\u2015\u2212]/);
  });

  it("pins the two legend keys and the likely/tilde explainer character for character", () => {
    expect(DISTRICT_LEDGER_LEGEND_EARNED).toBe("earned, final");
    expect(DISTRICT_LEDGER_LEGEND_OPEN).toBe("still open · click for the histogram");
    expect(districtLedgerRookieBonusLine(10)).toBe("+10 rookie bonus");
    expect(districtLedgerRookieBonusLine(5)).toBe("+5 rookie bonus");
    expect(districtLedgerRookieBonusCaption(10)).toBe("Includes the 10 point rookie bonus, added once per season and never to an event total.");
    expect(DISTRICT_LEDGER_LEGEND_EXPLAINER).toBe("likely = 8 of 10 runs land here · ~ = this site's prediction, not a number TBA published");
  });

  it("pins the five status labels and the award variant", () => {
    expect(Object.values(DISTRICT_LEDGER_STATUS_LABELS)).toEqual(["Prequalified", "Locked", "In range", "Out of range", "Locked out"]);
    expect(DISTRICT_LEDGER_LOCKED_AWARD_LABEL).toBe("Locked · award");
  });

  it("pins the Locks milestone picker's words, sketch 024 Q's own, with eight stops", () => {
    expect(LOCKS_PICKER_EVENT_LABEL).toBe("Event");
    expect(LOCKS_PICKER_SEASON_START).toBe("Season start");
    expect(LOCKS_PICKER_LIVE).toBe("Live");
    expect(LOCKS_PICKER_NOW_MARK).toBe("now");
    expect(LOCKS_PICKER_PREV_LABEL).toBe("Previous milestone");
    expect(LOCKS_PICKER_NEXT_LABEL).toBe("Next milestone");
    expect(LOCKS_PICKER_THIS_IS_LIVE).toBe("This is live");
    expect(DISTRICT_LEDGER_MILESTONE_GROUPS.map(({ label, from, to }) => `${label} ${String(from)}/${String(to)}`)).toEqual([
      "Schedule 1/2",
      "Qualification 2/6",
      "Alliances 6/7",
      "Playoffs 7/8",
      "Awards 8/9",
    ]);
    expect(Object.entries(DISTRICT_LEDGER_MILESTONE_SUB_WORDS)).toEqual([
      ["schedule", "Out"],
      ["q1", "¼"],
      ["q2", "½"],
      ["q3", "¾"],
      ["qualsDone", "Done"],
      ["alliance", "Done"],
      ["playoffs", "Done"],
      ["awards", "Done"],
    ]);
    expect(Object.values(DISTRICT_LEDGER_MILESTONE_LONG_WORDS)).toEqual([
      "schedule released",
      "quals ¼ done",
      "quals ½ done",
      "quals ¾ done",
      "quals done",
      "alliance selection done",
      "playoffs done",
      "awards done",
    ]);
    expect(locksPickerMilestoneTitle("Belleville", "q1")).toBe("Belleville · Quals ¼ done");
    expect(locksPickerMilestoneTitle("Belleville", "alliance")).toBe("Belleville · Alliance selection done");
    expect(locksPickerStopLabel("Belleville", "q1", true)).toBe("Belleville quals ¼ done");
    expect(locksPickerStopLabel("Belleville", "awards", false)).toBe("Belleville awards done, not played yet");
    expect(locksPickerNextText("Belleville · Quals done")).toBe("Next: Belleville · Quals done");
    expect(locksPickerNextText(undefined)).toBe("This is live");
    expect(locksPickerGroupLabel({ week: 0, isDcmp: false }, "done")).toBe("Week 1 · done");
    expect(locksPickerGroupLabel({ week: 3, isDcmp: false }, "live")).toBe("Week 4 · live");
    expect(locksPickerGroupLabel({ week: 5, isDcmp: false }, "up")).toBe("Week 6 · not played yet");
    expect(locksPickerGroupLabel({ week: null, isDcmp: false }, "up")).toBe("Week not published · not played yet");
    expect(locksPickerGroupLabel({ week: 5, isDcmp: true }, "done")).toBe("DCMP · done");
    expect(locksPickerOptionLabel("Lansing", true)).toBe("Lansing (live)");
    expect(locksPickerOptionLabel("Lansing", false)).toBe("Lansing");
    expect(locksPickerUpCaption("Marysville")).toBe("Marysville has not started. Its milestones open as they happen.");
    expect(locksPickerLiveCaption("Lansing")).toBe("Lansing is live. Milestones past the red line have not happened yet; use Live for the current state.");
  });

  it("writes no hyphen, en dash or em dash in any Locks milestone picker string", () => {
    const strings = [
      LOCKS_PICKER_EVENT_LABEL,
      LOCKS_PICKER_SEASON_START,
      LOCKS_PICKER_LIVE,
      LOCKS_PICKER_NOW_MARK,
      LOCKS_PICKER_PREV_LABEL,
      LOCKS_PICKER_NEXT_LABEL,
      LOCKS_PICKER_THIS_IS_LIVE,
      ...DISTRICT_LEDGER_MILESTONE_GROUPS.map((group) => group.label),
      ...Object.values(DISTRICT_LEDGER_MILESTONE_SUB_WORDS),
      ...Object.values(DISTRICT_LEDGER_MILESTONE_LONG_WORDS),
      locksPickerMilestoneTitle("Belleville", "q3"),
      locksPickerStopLabel("Belleville", "playoffs", false),
      locksPickerNextText("Belleville · Awards done"),
      locksPickerGroupLabel({ week: null, isDcmp: false }, "up"),
      locksPickerGroupLabel({ week: 2, isDcmp: true }, "live"),
      locksPickerOptionLabel("Lansing", true),
      locksPickerUpCaption("Marysville"),
      locksPickerLiveCaption("Lansing"),
    ];
    for (const text of strings) expect(text).not.toMatch(/[-‐-―−]/);
  });

  it("shortens ONLY a name that matches TBA's whole district template, and prints every other name verbatim", () => {
    expect(districtLedgerShortEventName("PNW District Oregon State Fair Event")).toBe("Oregon State Fair");
    expect(districtLedgerShortEventName("FNC District Wake County Event")).toBe("Wake County");
    expect(districtLedgerShortEventName("FIM District - Kettering University Event #1")).toBe("Kettering University #1");
    expect(districtLedgerShortEventName("FIM District Chelsea Event presented by DTE")).toBe("Chelsea");
    expect(districtLedgerShortEventName("FIM District Milford Event presented by GM Proving Grounds")).toBe("Milford");
    expect(districtLedgerShortEventName("FIM District Kettering University Event #2 presented by Ford")).toBe("Kettering University #2");
    // No name body between "District" and "Event": nothing to shorten to, so
    // the published name stands.
    expect(districtLedgerShortEventName("ISR District Event #1")).toBe("ISR District Event #1");
    // Not a district name at all.
    expect(districtLedgerShortEventName("Done Event")).toBe("Done Event");
    expect(districtLedgerShortEventName("Einstein Field")).toBe("Einstein Field");
  });

  it("pins the tab label and the column labels in render order", () => {
    expect(DISTRICT_LEDGER_TAB_LABEL).toBe("District Locks");
    expect([...DISTRICT_LEDGER_COLUMN_LABELS]).toEqual([
      "Team",
      "Status",
      "Grand total",
      "Event",
      "Event total",
      "Qualification",
      "Alliance selection",
      "Playoffs",
      "Awards",
    ]);
  });

  /**
   * Sketch 020's two printing limits, in Jacob's own words: "Never show
   * '>99%', print '99%'", and "A chance under 5% is never printed as a number".
   * Both are pinned by VALUE here rather than by re-deriving the thresholds, so
   * a later change to either constant has to come through this test.
   */
  it("prints a chance as one line, and never a number outside the 5 to 99 band", () => {
    expect(districtLedgerChanceLine(0.71)).toBe("71% chance");
    expect(districtLedgerChanceLine(0.5)).toBe("50% chance");
    expect(districtLedgerChanceLine(0.05)).toBe("5% chance");
    expect(districtLedgerChanceLine(0.99)).toBe("99% chance");
    // Rounds to 100, prints 99: a season is never over while a decline, the
    // waitlist or a wildcard can still move a team.
    expect(districtLedgerChanceLine(0.997)).toBe("99% chance");
    expect(districtLedgerChanceLine(1)).toBe("99% chance");
    // Under the floor, no number at all.
    expect(districtLedgerChanceLine(0.049)).toBe("<5% chance");
    expect(districtLedgerChanceLine(0.004)).toBe("<5% chance");
    expect(districtLedgerChanceLine(0)).toBe("<5% chance");
    expect(DISTRICT_LEDGER_CHANCE_BELOW_FLOOR).toBe("<5% chance");
  });

  it("says where the drawer's chance comes from, and no longer says the page does not compute one", () => {
    expect(DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION).toBe(
      "The chance beside this team's status is the share of runs where a draw from this distribution lands inside the qualifying slots, against a draw from every other team's own."
    );
    expect(DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION).not.toContain("does not compute");
  });

  it("prints neither of the two superseded status words anywhere in this tab's vocabulary", () => {
    const everyString = [
      ...Object.values(DISTRICT_LEDGER_STATUS_LABELS),
      ...Object.values(DISTRICT_LEDGER_STATUS_DEFINITIONS),
      DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
    ].join(" ");
    expect(everyString).not.toContain("Contending");
    expect(everyString).not.toContain("eliminated");
    // The chance line carries neither word either, at any value.
    const chances = [0, 0.04, 0.3, 0.99, 1].map(districtLedgerChanceLine).join(" ");
    expect(chances).not.toContain("Contending");
    expect(chances).not.toContain("eliminated");
  });
});

describe("the playoff milestone words", () => {
  it("names the top four rather than playing, because fifth through eighth pay nothing", () => {
    expect(DISTRICT_LEDGER_CHANCE_WORDS.elim).toEqual({ bold: "top 4", conditional: "if top 4" });
    // The superseded wording claimed a chance of PLAYING a playoff match, which
    // is not what the number ever was.
    expect(DISTRICT_LEDGER_CHANCE_WORDS.elim.bold).not.toBe("play");
    expect(DISTRICT_LEDGER_CHANCE_WORDS.elim.conditional).not.toBe("if in");
  });

  it("carries the two milestones past the top four, and nothing else", () => {
    expect(DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS).toEqual({
      finalist: { bold: "finalist", conditional: "if finalist" },
      winner: { bold: "winner", conditional: "if winner" },
    });
  });

  it("prints a placement in plain words, with the English ordinals and no tilde", () => {
    expect(districtLedgerPlacementLine(1)).toBe("1st place");
    expect(districtLedgerPlacementLine(2)).toBe("2nd place");
    expect(districtLedgerPlacementLine(3)).toBe("3rd place");
    expect(districtLedgerPlacementLine(4)).toBe("4th place");
    expect(districtLedgerPlacementLine(8)).toBe("8th place");
    for (let placement = 1; placement <= 8; placement++) {
      expect(districtLedgerPlacementLine(placement)).not.toContain("~");
    }
  });

  it("prints a bare number rather than inventing a suffix for a placement outside the bracket", () => {
    expect(districtLedgerPlacementLine(9)).toBe("place 9");
    expect(districtLedgerPlacementLine(0)).toBe("place 0");
  });

  it("prints an outcome chance in the three cases that mean three different things", () => {
    // A tilde for a prediction.
    expect(districtLedgerOutcomeChance(0.4)).toBe("~40%");
    expect(districtLedgerOutcomeChance(0.005)).toBe("~1%");
    // Unlikely, not impossible: never `~0%`.
    expect(districtLedgerOutcomeChance(0.004)).toBe("<1%");
    expect(districtLedgerOutcomeChance(0.0001)).toBe("<1%");
    // No run produced it at all — a count, so no tilde.
    expect(districtLedgerOutcomeChance(0)).toBe("0%");
    expect(districtLedgerOutcomeChance(0)).not.toContain("~");
    // And nothing here carries the plus-minus codepoint.
    for (const chance of [0, 0.004, 0.4, 1]) expect(districtLedgerOutcomeChance(chance)).not.toContain("±");
  });

  it("prints an outcome's point value as a whole number with no tilde, because a placement's value is a rule", () => {
    expect(districtLedgerOutcomePoints(30)).toBe("30");
    expect(districtLedgerOutcomePoints(0)).toBe("0");
    expect(districtLedgerOutcomePoints(30)).not.toContain("~");
  });

  it("names every playoff and award outcome, and nothing above Impact", () => {
    expect(DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS).toEqual({
      winner: "Wins the event",
      finalist: "Finalist",
      third: "Third place",
      fourth: "Fourth place",
      none: "Out before the top four",
    });
    expect(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS).toEqual({
      impact: "Impact",
      rookieAllStar: "Rookie All Star",
      judged: "One judged award",
      none: "No award",
    });
    // No label names two awards at once, which is the whole point of the fold.
    for (const label of Object.values(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS)) {
      expect(label.toLowerCase()).not.toContain(" and ");
      expect(label.toLowerCase()).not.toContain("plus");
    }
  });

  it("gives each outcome list its OWN caption, so the award list never mentions a bracket", () => {
    expect(DISTRICT_LEDGER_OUTCOME_CAPTIONS.elim).toContain("bracket");
    expect(DISTRICT_LEDGER_OUTCOME_CAPTIONS.award).not.toContain("bracket");
    expect(DISTRICT_LEDGER_OUTCOME_CAPTIONS.award).toContain("never predicted to win two awards");
  });

  it("prints a contribution row's earned total, or the honest absence", () => {
    expect(districtLedgerContributionEarned(24)).toBe("24");
    expect(districtLedgerContributionEarned(0)).toBe("0");
    expect(districtLedgerContributionEarned(undefined)).toBe("none yet");
  });

  it("carries no dash character in the two new lists' own copy", () => {
    const everyString = [
      ...Object.values(DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS),
      ...Object.values(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS),
      ...Object.values(DISTRICT_LEDGER_OUTCOME_CAPTIONS),
      DISTRICT_LEDGER_CONTRIBUTION_CAPTION,
      DISTRICT_LEDGER_CONTRIBUTION_SETTLED,
      districtLedgerContributionEarned(undefined),
    ].join(" ");
    for (const dash of ["—", "–", "-"]) expect(everyString).not.toContain(dash);
  });

  it("carries no dash character in any milestone word, matching the tab's own rule", () => {
    const everyString = [
      ...Object.values(DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS).flatMap((entry) => [entry.bold, entry.conditional]),
      DISTRICT_LEDGER_CHANCE_WORDS.elim.bold,
      DISTRICT_LEDGER_CHANCE_WORDS.elim.conditional,
      ...[1, 4, 8].map(districtLedgerPlacementLine),
    ].join(" ");
    for (const dash of ["—", "–", "-"]) expect(everyString).not.toContain(dash);
  });
});

describe("the alliance selection route copy (quick task 260925-w4y)", () => {
  it("names the two headline routes, each with the SAME conditional clause", () => {
    expect(DISTRICT_LEDGER_SELECTION_ROUTE_WORDS).toEqual({
      captain: { bold: "captain", conditional: "if in" },
      picked: { bold: "picked", conditional: "if in" },
    });
    // "if in" covers both routes, which is exactly why it replaced "if picked"
    // on a cell whose bold line now names ONE of them.
    expect(DISTRICT_LEDGER_SELECTION_ROUTE_WORDS.captain.conditional).toBe(DISTRICT_LEDGER_SELECTION_ROUTE_WORDS.picked.conditional);
  });

  it("leaves the shipped alliance chance words alone, because the route-less cell still prints them", () => {
    // A baked event has no route counts, so its cell prints the chance of ANY
    // selection points under the shipped wording. Changing this pair would change
    // what that cell says without changing what its number means.
    expect(DISTRICT_LEDGER_CHANCE_WORDS.alliance).toEqual({ bold: "picked", conditional: "if picked" });
  });

  it("prints the settled route and its alliance, with no tilde", () => {
    expect(districtLedgerSelectionSettledLine("captain", 5)).toBe("captain, alliance 5");
    expect(districtLedgerSelectionSettledLine("firstPick", 2)).toBe("first pick, alliance 2");
    expect(districtLedgerSelectionSettledLine("secondPick", 8)).toBe("second pick, alliance 8");
    for (const route of ["captain", "firstPick", "secondPick", "backup"] as const) {
      expect(districtLedgerSelectionSettledLine(route, 1)).not.toContain("~");
    }
  });

  it("names every selection route", () => {
    expect(DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS).toEqual({
      captain: "Captain",
      firstPick: "First pick",
      secondPick: "Second pick",
      backup: "Backup robot",
      notSelected: "Not selected",
    });
  });

  it("prints a point range with the word `to`, and a single value where the two ends meet", () => {
    expect(districtLedgerOutcomePointsRange(9, 16)).toBe("9 to 16");
    expect(districtLedgerOutcomePointsRange(1, 8)).toBe("1 to 8");
    expect(districtLedgerOutcomePointsRange(12, 12)).toBe("12");
    expect(districtLedgerOutcomePointsRange(0, 0)).toBe("0");
    // A dash between two numbers on this tab means a PERCENTILE range, and these
    // are not percentiles; the plus-minus codepoint is reserved for one standard
    // deviation of full predictive variance and never appears here.
    for (const dash of ["—", "–", "-", "±"]) expect(districtLedgerOutcomePointsRange(9, 16)).not.toContain(dash);
    expect(districtLedgerOutcomePointsRange(9, 16)).not.toContain("~");
  });

  it("gives the selection list its own caption, about the RANKING rather than a bracket", () => {
    expect(DISTRICT_LEDGER_OUTCOME_CAPTIONS.alliance).toContain("ranking");
    expect(DISTRICT_LEDGER_OUTCOME_CAPTIONS.alliance).not.toContain("bracket");
    expect(DISTRICT_LEDGER_OUTCOME_LIST_LABELS.alliance).toBe("Alliance selection outcomes");
  });

  it("carries no dash character in any of the route copy", () => {
    const everyString = [
      ...Object.values(DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS),
      ...Object.values(DISTRICT_LEDGER_SELECTION_ROUTE_WORDS).flatMap((entry) => [entry.bold, entry.conditional]),
      DISTRICT_LEDGER_OUTCOME_CAPTIONS.alliance,
      DISTRICT_LEDGER_OUTCOME_LIST_LABELS.alliance,
      districtLedgerSelectionSettledLine("captain", 5),
      districtLedgerOutcomePointsRange(9, 16),
    ].join(" ");
    for (const dash of ["—", "–", "-"]) expect(everyString).not.toContain(dash);
    expect(everyString).not.toContain("±");
  });
});

/**
 * THE CHAMP LOCKS TAB'S OWN COPY (sketch 022, quick task 260925-xab).
 *
 * Every literal is restated here rather than imported-and-compared, on the same
 * terms as the district tier's contract above: a test that asserted a constant
 * against itself would pin nothing.
 */
describe("the Champ Locks copy contract", () => {
  it("pins the tab label and the nine column labels in render order", () => {
    expect(CHAMP_LEDGER_TAB_LABEL).toBe("Champ Locks");
    expect([...CHAMP_LEDGER_COLUMN_LABELS]).toEqual([
      "Team",
      "Status",
      "Grand total",
      "Source",
      "Subtotal",
      "Qualification",
      "Alliance selection",
      "Playoffs",
      "Awards",
    ]);
  });

  it("pins the two row labels and the winner variant of the Locked chip", () => {
    expect(CHAMP_LEDGER_ROW_LABELS.district).toBe("District points");
    expect(CHAMP_LEDGER_ROW_LABELS.dcmp).toBe("DCMP points");
    expect(CHAMP_LEDGER_LOCKED_WINNER_LABEL).toBe("Locked · winner");
    // The judged case stays the district tier's string, unchanged.
    expect(DISTRICT_LEDGER_LOCKED_AWARD_LABEL).toBe("Locked · award");
  });

  /**
   * THREE ABSENCES, THREE DIFFERENT WORDS. The em dash means the field has
   * settled and left this team out; "not yet priced" means nothing was
   * predicted at all; "not available" (the district tier's) means a prediction
   * was attempted and refused. Asserting they are pairwise different is what
   * stops a later edit collapsing two of them into one.
   */
  it("keeps the three DCMP absences distinct, and builds the em dash from its codepoint", () => {
    expect(CHAMP_LEDGER_NOT_IN_FIELD_CELL).toBe(String.fromCharCode(0x2014));
    expect(CHAMP_LEDGER_NOT_IN_FIELD_LINE).toBe("not in the field");
    expect(CHAMP_LEDGER_NOT_YET_PRICED_CELL).toBe("not yet priced");
    expect(CHAMP_LEDGER_DISTRICT_ONLY_LINE).toBe("district only");
    const three = [CHAMP_LEDGER_NOT_IN_FIELD_CELL, CHAMP_LEDGER_NOT_YET_PRICED_CELL, "not available"];
    expect(new Set(three).size).toBe(3);
  });

  it("prints the field chance with a mandatory tilde, inside the same 5 to 99 band the status line uses", () => {
    expect(champLedgerFieldChanceLine(0.62)).toBe("~62% to be there");
    expect(champLedgerFieldChanceLine(1)).toBe("~99% to be there");
    expect(champLedgerFieldChanceLine(0.995)).toBe("~99% to be there");
    expect(champLedgerFieldChanceLine(0.049)).toBe("<5% to be there");
    expect(champLedgerFieldChanceLine(0)).toBe("<5% to be there");
    expect(champLedgerFieldChanceLine(0.05)).toBe("~5% to be there");
  });

  it("writes the District points row's small line as short name, one based week, stage word", () => {
    expect(
      champLedgerDistrictSourceLine([
        { eventName: "PNW District Bonney Lake Event", week: 0, stage: "done" },
        { eventName: "PNW District Sammamish Event", week: 2, stage: "playoffs" },
      ])
    ).toBe("Bonney Lake Wk 1 · final · Sammamish Wk 3 · playoffs");
    // A week-less event prints its name and stage and invents no week.
    expect(champLedgerDistrictSourceLine([{ eventName: "Offseason Thing", week: null, stage: "quals" }])).toBe("Offseason Thing · quals");
    // No source at all is the empty string, which the cell prints as nothing.
    expect(champLedgerDistrictSourceLine([])).toBe("");
  });

  it("prints the DCMP row's own line as a week and a stage, never the championship's name", () => {
    expect(champLedgerDcmpStageLine({ week: 5, stage: "done" })).toBe("Wk 6 · final");
    expect(champLedgerDcmpStageLine({ week: 5, stage: "quals" })).toBe("Wk 6 · quals");
    expect(champLedgerDcmpStageLine({ week: null, stage: "unstarted" })).toBe("not started");
    expect(champLedgerDcmpStageLine({ week: 5, stage: "done" })).not.toContain("District Championship");
  });

  it("names the contribution list's two rows from the SAME table the ledger's rows come from", () => {
    expect(CHAMP_LEDGER_CONTRIBUTION_ROW_LABELS).toBe(CHAMP_LEDGER_ROW_LABELS);
    expect(CHAMP_LEDGER_CONTRIBUTION_LIST_LABEL).toBe("Points by source");
    expect(CHAMP_LEDGER_CONTRIBUTION_COLUMN_SOURCE).toBe("source");
    expect(champLedgerContributionChanceNote(0.62)).toBe("weighted by ~62% to be there");
  });

  it("says in the caption WHY the two subtotals do not add to the grand total", () => {
    expect(CHAMP_LEDGER_CONTRIBUTION_CAPTION).toContain("weighted by the chance of being there");
    for (const dash of ["—", "–", "-"]) expect(CHAMP_LEDGER_CONTRIBUTION_CAPTION).not.toContain(dash);
    expect(CHAMP_LEDGER_CONTRIBUTION_CAPTION).not.toContain("±");
  });
});

/**
 * THE PREDICTED CUTOFF'S COPY (quick task 260926-37q).
 *
 * The four labels, the tilde rule, the whole number en dash range, and the
 * two captions' own no dash rule.
 */
describe("the predicted cutoff copy", () => {
  it("names all four labels, with the champ tab's district only variant among them", () => {
    expect(DISTRICT_LEDGER_CUTOFF_LABELS).toEqual({
      predicted: "Predicted cutoff",
      predictedDistrictOnly: "Predicted cutoff (district only)",
      settled: "Cutoff",
      capacityUnknown: "Capacity not published",
    });
  });

  it("puts a tilde on a predicted figure and none on a settled one", () => {
    expect(districtLedgerCutoffFigure(59, false)).toBe("~59");
    expect(districtLedgerCutoffFigure(59, true)).toBe("59");
    expect(districtLedgerCutoffFigure(58.5, false)).toBe("~59");
    expect(districtLedgerCutoffFigure(182, true)).toBe("182");
    expect(districtLedgerCutoffFigure(182, true)).not.toContain("~");
  });

  it("writes the likely range as whole numbers with an EN DASH and never a plus minus", () => {
    const text = districtLedgerCutoffLikelyText(55.4, 63.6);
    expect(text).toBe("likely 55–64");
    expect(text).toContain("–");
    expect(text).not.toContain("±");
    expect(text).not.toContain("-");
    expect(text).not.toContain("—");
  });

  it("omits the range where the two rounded ends coincide, on openCellLines' own rule", () => {
    expect(districtLedgerCutoffLikelyText(60, 60)).toBeUndefined();
    expect(districtLedgerCutoffLikelyText(59.6, 60.4)).toBeUndefined();
    expect(districtLedgerCutoffLikelyText(59.4, 60.4)).toBe("likely 59–60");
  });

  it("says in two sentences what the dashed rule is and what the likely range is", () => {
    expect(DISTRICT_LEDGER_DRAWER_CUTOFF_CAPTION).toContain("midpoint");
    expect(DISTRICT_LEDGER_DRAWER_CUTOFF_CAPTION).toContain("10th to the 90th percentile");
    expect(DISTRICT_LEDGER_DRAWER_CUTOFF_CAPTION.split(". ")).toHaveLength(2);
  });

  it("carries no dash character in any of the cutoff copy", () => {
    const everyString = [
      ...Object.values(DISTRICT_LEDGER_CUTOFF_LABELS),
      DISTRICT_LEDGER_DRAWER_CUTOFF_CAPTION,
      DISTRICT_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION,
      DISTRICT_LEDGER_DRAWER_NO_CUTOFF_CAPTION,
      DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION,
    ].join(" ");
    for (const dash of ["—", "–", "-"]) expect(everyString).not.toContain(dash);
    expect(everyString).not.toContain("±");
  });

  it("describes the district tab's simulated line as a median with its own range, never as a midpoint (261004-uw4)", () => {
    expect(DISTRICT_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION).toContain("median");
    expect(DISTRICT_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION).toContain("10th to the 90th percentile");
    expect(DISTRICT_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION).not.toContain("midpoint");
    expect(DISTRICT_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION.split(". ")).toHaveLength(2);
  });

  it("carries no dash character in any of the simulated champ cutoff copy (quick task 260927-6bf)", () => {
    const everyString = [
      ...Object.values(CHAMP_LEDGER_RANGE_CALL_LABELS),
      CHAMP_LEDGER_RANGE_PENDING_DESCRIPTION,
      ...Object.values(CHAMP_LEDGER_NO_CALL_REASONS),
      ...Object.keys(CHAMP_LEDGER_NO_CALL_REASONS).map((reason) => champLedgerNoCallDescription(reason as keyof typeof CHAMP_LEDGER_NO_CALL_REASONS)),
      CHAMP_LEDGER_CUTOFF_PENDING_FIGURE,
      CHAMP_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION,
      CHAMP_LEDGER_DRAWER_PENDING_CAPTION,
      CHAMP_LEDGER_ESTIMATED_DCMP_LINE,
    ].join(" ");
    for (const dash of ["—", "–", "-"]) expect(everyString).not.toContain(dash);
    expect(everyString).not.toContain("±");
  });

  it("never says In range or Out of range on a withheld chip, and describes the simulated line's likely range", () => {
    for (const label of Object.values(CHAMP_LEDGER_RANGE_CALL_LABELS)) {
      expect(label).not.toMatch(/in range|out of range/i);
    }
    // Jacob, 2026-09-27: the simulated line's range is shown.
    expect(CHAMP_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION).toContain("10th to the 90th percentile");
    expect(CHAMP_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION).toContain("winning alliance");
    for (const award of ["Impact", "Engineering Inspiration", "Rookie All Star"]) expect(CHAMP_LEDGER_DRAWER_SIMULATED_CUTOFF_CAPTION).toContain(award);
  });

  it("says cutoff, never the retired wording, in the two absence captions", () => {
    expect(DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION).toContain("cutoff");
    expect(DISTRICT_LEDGER_DRAWER_NO_CUTOFF_CAPTION).toContain("cutoff");
    for (const caption of [DISTRICT_LEDGER_DRAWER_CUTOFF_CAPTION, DISTRICT_LEDGER_DRAWER_NO_LINE_CAPTION, DISTRICT_LEDGER_DRAWER_NO_CUTOFF_CAPTION]) {
      expect(caption.toLowerCase()).not.toContain("today");
    }
  });
});

describe("locksPickerEventName", () => {
  it("prints DCMP for a district championship and keeps divisions apart", async () => {
    const { locksPickerEventName } = await import("./districtLedgerCopy.js");
    expect(locksPickerEventName("Pacific Northwest FIRST District Championship", true)).toBe("DCMP");
    expect(locksPickerEventName("FIRST in Michigan State Championship - Aptiv Division", true)).toBe("DCMP Aptiv");
    expect(locksPickerEventName("PNW District Oregon State Fair Event", false)).toBe("Oregon State Fair");
  });
});
