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
  CHAMP_LEDGER_ESTIMATED_DCMP_LINE,
  CHAMP_LEDGER_NO_CALL_REASONS,
  CHAMP_LEDGER_RANGE_CALL_LABELS,
  CHAMP_LEDGER_RANGE_PENDING_DESCRIPTION,
  champLedgerNoCallDescription,
  districtLedgerChanceLine,
  districtLedgerCutoffFigure,
  districtLedgerCutoffLikelyText,
  districtLedgerRookieBonusLine,
  DISTRICT_LEDGER_AWARD_OUTCOME_LABELS,
  DISTRICT_LEDGER_CHANCE_BELOW_FLOOR,
  DISTRICT_LEDGER_CHANCE_WORDS,
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_CUTOFF_LABELS,
  DISTRICT_LEDGER_DECLINED_LABEL,
  DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_LEGEND_EARNED,
  DISTRICT_LEDGER_LEGEND_EXPLAINER,
  DISTRICT_LEDGER_LEGEND_OPEN,
  DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
  DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS,
  DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS,
  DISTRICT_LEDGER_OUTCOME_LIST_LABELS,
  DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS,
  DISTRICT_LEDGER_SELECTION_ROUTE_WORDS,
  DISTRICT_LEDGER_SIMULATED_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_LABELS,
  DISTRICT_LEDGER_TAB_LABEL,
  districtLedgerCellChance,
  districtLedgerCellLikelyText,
  DISTRICT_LEDGER_NOT_PICKED_WORDS,
  districtLedgerOutcomeChance,
  districtLedgerOutcomePointsRange,
  districtLedgerPaysLine,
  districtLedgerPlacementLine,
  districtLedgerSelectionSettledLine,
  districtLedgerShortEventName,
  CHAMP_LEDGER_COLUMN_LABELS,
  CHAMP_LEDGER_DISTRICT_ONLY_LINE,
  CHAMP_LEDGER_LOCKED_WINNER_LABEL,
  CHAMP_LEDGER_NOT_IN_FIELD_CELL,
  CHAMP_LEDGER_NOT_IN_FIELD_LINE,
  CHAMP_LEDGER_NOT_YET_PRICED_CELL,
  CHAMP_LEDGER_OUT_OF_RANGE_CELL,
  CHAMP_LEDGER_OUT_OF_RANGE_LINE,
  CHAMP_LEDGER_ROW_LABELS,
  CHAMP_LEDGER_TAB_LABEL,
  champLedgerDcmpStageLine,
  champLedgerDistrictSourceLine,
  champLedgerFieldChanceLine,
  DISTRICT_LEDGER_MILESTONE_GROUPS,
  DISTRICT_LEDGER_MILESTONE_LONG_WORDS,
  DISTRICT_LEDGER_MILESTONE_NARROW_SUB_WORDS,
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
  DISTRICT_LEDGER_RUN_PROGRESS_LABEL,
  districtLedgerRunProgressText,
} from "./districtLedgerCopy.js";
import {
  CHAMP_LEDGER_VERDICT_SOURCE_WORDS,
  CHAMP_LEDGER_VERDICT_SUBTOTAL_TITLES,
  DISTRICT_LEDGER_VERDICT_CELL_TITLES,
  DISTRICT_LEDGER_VERDICT_CHIP_LABELS,
  DISTRICT_LEDGER_VERDICT_CUTOFF_TILE_WORDS,
  DISTRICT_LEDGER_VERDICT_LEGEND,
  DISTRICT_LEDGER_VERDICT_NOTE,
  DISTRICT_LEDGER_VERDICT_POINT_NOUNS,
  DISTRICT_LEDGER_VERDICT_TILE_LABELS,
  champLedgerVerdictFieldSuffix,
  districtLedgerOutcomePointsLabel,
  districtLedgerVerdictCapHeadline,
  districtLedgerVerdictCapLabel,
  districtLedgerVerdictChanceOfPoints,
  districtLedgerVerdictCutoffLabel,
  districtLedgerVerdictEarnedAt,
  districtLedgerVerdictEventCellTitle,
  districtLedgerVerdictEventTotalHeadline,
  districtLedgerVerdictEyebrow,
  districtLedgerVerdictFieldHeadline,
  districtLedgerVerdictGrandHeadline,
  districtLedgerVerdictLikelyHeadline,
  districtLedgerVerdictLikelyRange,
  districtLedgerVerdictMedian,
  districtLedgerVerdictOutcomeHeadline,
  districtLedgerVerdictPredictedAt,
  districtLedgerVerdictRuns,
  type LedgerGrandVerdict,
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
    expect(DISTRICT_LEDGER_LEGEND_OPEN).toBe("still open · click to see");
    expect(districtLedgerRookieBonusLine(10)).toBe("+10 rookie bonus");
    expect(districtLedgerRookieBonusLine(5)).toBe("+5 rookie bonus");
    expect(DISTRICT_LEDGER_LEGEND_EXPLAINER).toBe("likely = 8 of 10 runs land here · ~ = this site's prediction, not a number TBA published");
  });

  it("pins the five status labels and the award variant", () => {
    expect(Object.values(DISTRICT_LEDGER_STATUS_LABELS)).toEqual(["Prequalified", "Locked", "In range", "Out of range", "Locked out"]);
    expect(DISTRICT_LEDGER_LOCKED_AWARD_LABEL).toBe("Locked · award");
  });

  it("pins the Locks milestone picker's words with thirteen stops: sketch 024 Q's own, FIRST's five rounds and the Finals (261007-3g2)", () => {
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
      "Playoffs 7/13",
      "Awards 13/14",
    ]);
    expect(Object.entries(DISTRICT_LEDGER_MILESTONE_SUB_WORDS)).toEqual([
      ["schedule", "Out"],
      ["q1", "¼"],
      ["q2", "½"],
      ["q3", "¾"],
      ["qualsDone", "Done"],
      ["alliance", "Done"],
      ["round1", "R1"],
      ["round2", "R2"],
      ["round3", "R3"],
      ["round4", "R4"],
      ["round5", "R5"],
      ["playoffs", "Finals"],
      ["awards", "Done"],
    ]);
    expect(DISTRICT_LEDGER_MILESTONE_NARROW_SUB_WORDS).toEqual({ qualsDone: "Q", alliance: "A", playoffs: "F" });
    expect(Object.values(DISTRICT_LEDGER_MILESTONE_LONG_WORDS)).toEqual([
      "schedule released",
      "quals ¼ done",
      "quals ½ done",
      "quals ¾ done",
      "quals done",
      "alliance selection done",
      "round 1 done",
      "round 2 done",
      "round 3 done",
      "round 4 done",
      "round 5 done",
      "finals done",
      "awards done",
    ]);
    expect(locksPickerMilestoneTitle("Belleville", "round1")).toBe("Belleville · Round 1 done");
    expect(locksPickerMilestoneTitle("Belleville", "playoffs")).toBe("Belleville · Finals done");
    expect(locksPickerStopLabel("Belleville", "playoffs", false)).toBe("Belleville finals done, not played yet");
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
      ...Object.values(DISTRICT_LEDGER_MILESTONE_NARROW_SUB_WORDS),
      ...Object.values(DISTRICT_LEDGER_MILESTONE_LONG_WORDS),
      locksPickerMilestoneTitle("Belleville", "round4"),
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

  // Quick task 261005-04t (D-06): once the District Championship has started,
  // the Live view shows its field, with a sixth status word and its own
  // Locked and Locked out sentences.
  it("pins the Declined label and the field definition set, whose other three read as the base set's (261005-04t)", () => {
    expect(DISTRICT_LEDGER_DECLINED_LABEL).toBe("Declined");
    expect(DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.locked).toBe("in the District Championship field");
    expect(DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.declined).toBe("earned a place at the District Championship and is not in its field");
    expect(DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.lockedOut).toBe("did not earn a place at the District Championship");
    expect(DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.prequalified).toBe(DISTRICT_LEDGER_STATUS_DEFINITIONS.prequalified);
    expect(DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.inRange).toBe(DISTRICT_LEDGER_STATUS_DEFINITIONS.inRange);
    expect(DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS.outOfRange).toBe(DISTRICT_LEDGER_STATUS_DEFINITIONS.outOfRange);
    for (const text of [DISTRICT_LEDGER_DECLINED_LABEL, ...Object.values(DISTRICT_LEDGER_FIELD_STATUS_DEFINITIONS)]) {
      expect(text).not.toMatch(/[-‐-―−]/);
    }
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
    expect(DISTRICT_LEDGER_CHANCE_WORDS.elim).toEqual({ bold: "top 4" });
    // The superseded wording claimed a chance of PLAYING a playoff match, which
    // is not what the number ever was.
    expect(DISTRICT_LEDGER_CHANCE_WORDS.elim.bold).not.toBe("play");
  });

  it("carries the two milestones past the top four, bold words only (261008-3il)", () => {
    expect(DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS).toEqual({
      finalist: { bold: "final" },
      winner: { bold: "win" },
    });
  });

  it("keeps only the bold outcome word in every chance word table (261008-3il)", () => {
    expect(DISTRICT_LEDGER_CHANCE_WORDS).toEqual({ alliance: { bold: "picked" }, elim: { bold: "top 4" }, award: { bold: "award" } });
  });

  it("gives a team on no alliance the not picked words (261008-3il)", () => {
    expect(DISTRICT_LEDGER_NOT_PICKED_WORDS).toEqual({ bold: "not picked", small: "backup call only" });
  });

  it("prints a median cell's likely range as whole numbers with to, rounded as the drawer's tile rounds (261008-3il)", () => {
    expect(districtLedgerCellLikelyText(15.2, 22.4)).toBe("likely 15 to 22");
    expect(districtLedgerCellLikelyText(14.6, 15.4)).toBe("likely 15");
    expect(districtLedgerCellLikelyText(-0.4, 3.6)).toBe("likely 0 to 4");
    // The cell and the tile print the same two numbers.
    for (const [p10, p90] of [[15.2, 22.4], [3.5, 8.49], [0, 0.6]] as const) {
      expect(districtLedgerCellLikelyText(p10, p90).match(/\d+/g)).toEqual([...new Set(districtLedgerVerdictLikelyRange(p10, p90).match(/\d+/g))]);
    }
    for (const dash of ["—", "–", "-"]) expect(districtLedgerCellLikelyText(15.2, 22.4)).not.toContain(dash);
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

  it("carries no dash character in the outcome labels or in any verdict string outside a numeric range", () => {
    const everyString = [
      ...Object.values(DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS),
      ...Object.values(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS),
      DISTRICT_LEDGER_VERDICT_NOTE,
      ...Object.values(DISTRICT_LEDGER_VERDICT_TILE_LABELS),
      ...Object.values(DISTRICT_LEDGER_VERDICT_LEGEND),
      ...Object.values(DISTRICT_LEDGER_VERDICT_CUTOFF_TILE_WORDS),
      ...Object.values(DISTRICT_LEDGER_VERDICT_CELL_TITLES),
      ...Object.values(CHAMP_LEDGER_VERDICT_SUBTOTAL_TITLES),
      ...Object.values(DISTRICT_LEDGER_VERDICT_POINT_NOUNS),
      ...Object.values(DISTRICT_LEDGER_VERDICT_CHIP_LABELS),
      ...Object.values(CHAMP_LEDGER_VERDICT_SOURCE_WORDS),
      districtLedgerVerdictGrandHeadline({ kind: "chance", chance: 0.4 }, 0, 0),
      districtLedgerVerdictFieldHeadline(0.4, 12),
      districtLedgerVerdictCapHeadline(22, 0.5),
      districtLedgerVerdictOutcomeHeadline("Finalist", 0.2),
      districtLedgerVerdictEyebrow("Grand total", 1, "Team"),
      districtLedgerVerdictEventCellTitle("Playoffs", "Live Event"),
      districtLedgerVerdictEarnedAt(["Done Event"]),
      districtLedgerVerdictPredictedAt("Live Event"),
      champLedgerVerdictFieldSuffix(0.4),
      districtLedgerOutcomePointsLabel(27, 48),
    ].join(" ");
    for (const dash of ["—", "–", "-"]) expect(everyString).not.toContain(dash);
    // A range carries its en dash between two digits and no other dash.
    const ranged = [districtLedgerVerdictLikelyHeadline(3, 9, "award"), districtLedgerVerdictEventTotalHeadline(3, 9, "Live Event")].join(" ");
    for (const dash of ["—", "–", "-"]) expect(ranged.replace(/(\d)–(\d)/g, "$1$2")).not.toContain(dash);
  });

  it("carries no dash character in any milestone word, matching the tab's own rule", () => {
    const everyString = [
      ...Object.values(DISTRICT_LEDGER_PLAYOFF_MILESTONE_WORDS).map((entry) => entry.bold),
      DISTRICT_LEDGER_CHANCE_WORDS.elim.bold,
      DISTRICT_LEDGER_NOT_PICKED_WORDS.bold,
      DISTRICT_LEDGER_NOT_PICKED_WORDS.small,
      ...[1, 4, 8].map(districtLedgerPlacementLine),
    ].join(" ");
    for (const dash of ["—", "–", "-"]) expect(everyString).not.toContain(dash);
  });
});

describe("the open cell's pays line and chance (quick task 261008-3il)", () => {
  it("prints one value alone, two with or, and three or more as a range with to", () => {
    expect(districtLedgerPaysLine({ kind: "values", values: [30] })).toBe("pays 30");
    expect(districtLedgerPaysLine({ kind: "values", values: [20, 30] })).toBe("pays 20 or 30");
    expect(districtLedgerPaysLine({ kind: "values", values: [7, 13, 20, 30] })).toBe("pays 7 to 30");
  });

  it("prints a range with to, and a single number where its two ends meet", () => {
    expect(districtLedgerPaysLine({ kind: "range", low: 9, high: 16 })).toBe("pays 9 to 16");
    expect(districtLedgerPaysLine({ kind: "range", low: 12, high: 12 })).toBe("pays 12");
  });

  it("carries no tilde and no dash character", () => {
    const every = [
      districtLedgerPaysLine({ kind: "values", values: [7, 13, 20, 30] }),
      districtLedgerPaysLine({ kind: "values", values: [5, 10] }),
      districtLedgerPaysLine({ kind: "range", low: 1, high: 8 }),
    ].join(" ");
    for (const mark of ["~", "—", "–", "-", "±"]) expect(every).not.toContain(mark);
  });

  it("prints the cell chance as a whole percent with no tilde, capped at 99 and with no floor", () => {
    expect(districtLedgerCellChance(0.66)).toBe("66%");
    expect(districtLedgerCellChance(0.996)).toBe("99%");
    expect(districtLedgerCellChance(1)).toBe("99%");
    expect(districtLedgerCellChance(0.004)).toBe("0%");
    expect(districtLedgerCellChance(0)).toBe("0%");
  });
});

describe("the alliance selection route copy (quick task 260925-w4y)", () => {
  it("names the two headline routes, bold words only (261008-3il)", () => {
    expect(DISTRICT_LEDGER_SELECTION_ROUTE_WORDS).toEqual({
      captain: { bold: "captain" },
      picked: { bold: "picked" },
    });
  });

  it("keeps the route-less alliance word, because a baked cell still prints it", () => {
    // A baked event has no route counts, so its cell prints the chance of ANY
    // selection points under the word picked.
    expect(DISTRICT_LEDGER_CHANCE_WORDS.alliance).toEqual({ bold: "picked" });
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

  it("names the selection list by its own label", () => {
    expect(DISTRICT_LEDGER_OUTCOME_LIST_LABELS.alliance).toBe("Alliance selection outcomes");
  });

  it("carries no dash character in any of the route copy", () => {
    const everyString = [
      ...Object.values(DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS),
      ...Object.values(DISTRICT_LEDGER_SELECTION_ROUTE_WORDS).map((entry) => entry.bold),
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
   * FOUR ABSENCES, FOUR DIFFERENT WORDS. The em dash means the field has
   * settled and left this team out; "not yet priced" means nothing was
   * predicted at all; "not available" (the district tier's) means a prediction
   * was attempted and refused; "out of range" (quick task 261007-mxf) means
   * the team is outside the simulated Locked plus In range field. Asserting
   * they are pairwise different is what stops a later edit collapsing two of
   * them into one.
   */
  it("keeps the four DCMP absences distinct, and builds the em dash from its codepoint", () => {
    expect(CHAMP_LEDGER_NOT_IN_FIELD_CELL).toBe(String.fromCharCode(0x2014));
    expect(CHAMP_LEDGER_NOT_IN_FIELD_LINE).toBe("not in the field");
    expect(CHAMP_LEDGER_NOT_YET_PRICED_CELL).toBe("not yet priced");
    expect(CHAMP_LEDGER_OUT_OF_RANGE_CELL).toBe("out of range");
    expect(CHAMP_LEDGER_OUT_OF_RANGE_LINE).toBe("outside the simulated field");
    expect(CHAMP_LEDGER_DISTRICT_ONLY_LINE).toBe("district only");
    const four = [CHAMP_LEDGER_NOT_IN_FIELD_CELL, CHAMP_LEDGER_NOT_YET_PRICED_CELL, "not available", CHAMP_LEDGER_OUT_OF_RANGE_CELL];
    expect(new Set(four).size).toBe(4);
    // Neither new string carries a hyphen, an en dash or an em dash.
    for (const text of [CHAMP_LEDGER_OUT_OF_RANGE_CELL, CHAMP_LEDGER_OUT_OF_RANGE_LINE]) expect(text).not.toMatch(/[-\u2013\u2014]/);
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

  it("carries no dash character in any of the cutoff copy", () => {
    const everyString = [
      ...Object.values(DISTRICT_LEDGER_CUTOFF_LABELS),
      districtLedgerCutoffFigure(59, false),
      districtLedgerCutoffFigure(59, true),
      ...Object.values(DISTRICT_LEDGER_VERDICT_CUTOFF_TILE_WORDS),
    ].join(" ");
    for (const dash of ["—", "–", "-"]) expect(everyString).not.toContain(dash);
    expect(everyString).not.toContain("±");
    // The likely text carries its en dash between two digits and no other dash.
    const likely = districtLedgerCutoffLikelyText(55.4, 63.6) ?? "";
    for (const dash of ["—", "–", "-"]) expect(likely.replace(/(\d)–(\d)/g, "$1$2")).not.toContain(dash);
    expect(likely).not.toContain("±");
  });

  it("carries no dash character in any of the simulated champ cutoff copy (quick task 260927-6bf)", () => {
    const everyString = [
      ...Object.values(CHAMP_LEDGER_RANGE_CALL_LABELS),
      CHAMP_LEDGER_RANGE_PENDING_DESCRIPTION,
      ...Object.values(CHAMP_LEDGER_NO_CALL_REASONS),
      ...Object.keys(CHAMP_LEDGER_NO_CALL_REASONS).map((reason) => champLedgerNoCallDescription(reason as keyof typeof CHAMP_LEDGER_NO_CALL_REASONS)),
      CHAMP_LEDGER_CUTOFF_PENDING_FIGURE,
      CHAMP_LEDGER_ESTIMATED_DCMP_LINE,
    ].join(" ");
    for (const dash of ["—", "–", "-"]) expect(everyString).not.toContain(dash);
    expect(everyString).not.toContain("±");
  });

  it("never says In range or Out of range on a withheld chip", () => {
    for (const label of Object.values(CHAMP_LEDGER_RANGE_CALL_LABELS)) {
      expect(label).not.toMatch(/in range|out of range/i);
    }
  });

  it("never prints the retired wording in any verdict string", () => {
    const everyString = [
      DISTRICT_LEDGER_VERDICT_NOTE,
      ...Object.values(DISTRICT_LEDGER_VERDICT_LEGEND),
      ...Object.values(DISTRICT_LEDGER_VERDICT_CUTOFF_TILE_WORDS),
      ...Object.values(CHAMP_LEDGER_VERDICT_SOURCE_WORDS),
      ...(["chance", "qualified", "lockedOut", "declined", "pending", "noCall", "open"] as const).map((kind) =>
        districtLedgerVerdictGrandHeadline(kind === "chance" ? { kind, chance: 0.4 } : { kind }, 3, 9)
      ),
      districtLedgerVerdictCutoffLabel("~59"),
    ].join(" ");
    expect(everyString.toLowerCase()).not.toContain("today");
  });
});

describe("the verdict drawer copy (sketch 025 variant A, quick task 261006-lxp)", () => {
  const EN_DASH = String.fromCharCode(0x2013);
  /** Any hyphen, en dash or em dash. */
  const ANY_DASH = /[-–—]/;
  /** An en dash between two digits, the one dash a numeric range may carry. */
  const RANGE_DASH = /(\d)–(\d)/g;

  it("pins the note, the tile labels and the legend keys character for character", () => {
    expect(DISTRICT_LEDGER_VERDICT_NOTE).toBe("likely = 8 of 10 runs");
    expect(DISTRICT_LEDGER_VERDICT_TILE_LABELS).toEqual({
      median: "median",
      likely: "likely",
      cutoff: "cutoff",
      mostLikely: "most likely",
      chanceOfPoints: "chance of points",
    });
    expect(DISTRICT_LEDGER_VERDICT_LEGEND).toEqual({
      bars: "how often each total came up",
      band: "likely range",
      tick: "median",
      cutoff: "cutoff",
      zone: "where the cutoff lands in 8 of 10 runs",
    });
    expect(DISTRICT_LEDGER_VERDICT_CUTOFF_TILE_WORDS).toEqual({ capacityUnknown: "not published", absent: "none" });
  });

  it("pins every cell title equal to its own column label, and the two champ subtotal titles", () => {
    expect(DISTRICT_LEDGER_VERDICT_CELL_TITLES.grandTotal).toBe(DISTRICT_LEDGER_COLUMN_LABELS[2]);
    expect(DISTRICT_LEDGER_VERDICT_CELL_TITLES.eventTotal).toBe(DISTRICT_LEDGER_COLUMN_LABELS[4]);
    expect(DISTRICT_LEDGER_VERDICT_CELL_TITLES.qual).toBe(DISTRICT_LEDGER_COLUMN_LABELS[5]);
    expect(DISTRICT_LEDGER_VERDICT_CELL_TITLES.alliance).toBe(DISTRICT_LEDGER_COLUMN_LABELS[6]);
    expect(DISTRICT_LEDGER_VERDICT_CELL_TITLES.elim).toBe(DISTRICT_LEDGER_COLUMN_LABELS[7]);
    expect(DISTRICT_LEDGER_VERDICT_CELL_TITLES.award).toBe(DISTRICT_LEDGER_COLUMN_LABELS[8]);
    expect(DISTRICT_LEDGER_VERDICT_CELL_TITLES).toEqual({
      grandTotal: "Grand total",
      eventTotal: "Event total",
      qual: "Qualification",
      alliance: "Alliance selection",
      elim: "Playoffs",
      award: "Awards",
    });
    expect(CHAMP_LEDGER_VERDICT_SUBTOTAL_TITLES).toEqual({ district: "District subtotal", dcmp: "DCMP subtotal" });
  });

  it("pins the point nouns, the chip labels and the champ source words", () => {
    expect(DISTRICT_LEDGER_VERDICT_POINT_NOUNS).toEqual({
      grandTotal: "grand total",
      qual: "qualification",
      alliance: "alliance selection",
      elim: "playoff",
      award: "award",
      district: "district",
      dcmp: "DCMP",
    });
    expect(DISTRICT_LEDGER_VERDICT_CHIP_LABELS).toEqual({ qual: "Quals", alliance: "Alliance", elim: "Playoffs", award: "Awards" });
    expect(CHAMP_LEDGER_VERDICT_SOURCE_WORDS).toEqual({
      districtEarned: "earned at district events",
      districtPredicted: "predicted at district events",
      dcmpEarned: "earned at the DCMP",
      dcmpPredicted: "predicted at the DCMP",
      districtOnly: "district points only",
    });
  });

  it("clamps the runs count at the same floor and ceiling the Status cell's chance line uses", () => {
    expect(districtLedgerVerdictRuns(0.049)).toBe("fewer than 5");
    expect(districtLedgerVerdictRuns(0.05)).toBe("5");
    expect(districtLedgerVerdictRuns(0.57)).toBe("57");
    expect(districtLedgerVerdictRuns(0.994)).toBe("99");
    expect(districtLedgerVerdictRuns(0.996)).toBe("99");
    expect(districtLedgerVerdictRuns(1)).toBe("99");
    // The two printings agree on every edge.
    for (const chance of [0.049, 0.05, 0.57, 0.994, 0.996, 1]) {
      const line = districtLedgerChanceLine(chance);
      const runs = districtLedgerVerdictRuns(chance);
      expect(line === DISTRICT_LEDGER_CHANCE_BELOW_FLOOR ? "fewer than 5" : line.replace("% chance", "")).toBe(runs);
    }
  });

  it("writes the grand total headline for a chance, every fixed state and the open arm", () => {
    expect(districtLedgerVerdictGrandHeadline({ kind: "chance", chance: 0.57 }, 0, 0)).toBe("Qualifies in 57 of 100 runs.");
    expect(districtLedgerVerdictGrandHeadline({ kind: "chance", chance: 0.996 }, 0, 0)).toBe("Qualifies in 99 of 100 runs.");
    expect(districtLedgerVerdictGrandHeadline({ kind: "chance", chance: 0.049 }, 0, 0)).toBe("Qualifies in fewer than 5 of 100 runs.");
    const fixed: ReadonlyArray<readonly [LedgerGrandVerdict["kind"], string]> = [
      ["qualified", "Already qualified."],
      ["lockedOut", "Cannot qualify on points."],
      ["declined", "Earned a place and is not in the field."],
      ["pending", "Chance still being simulated."],
      ["noCall", "No call at this position."],
    ];
    for (const [kind, sentence] of fixed) {
      expect(districtLedgerVerdictGrandHeadline({ kind } as LedgerGrandVerdict, 0, 0)).toBe(sentence);
    }
    expect(districtLedgerVerdictGrandHeadline({ kind: "open" }, 330.2, 371.6)).toBe(`Likely 330${EN_DASH}372 grand total points.`);
  });

  it("prints every drawer figure as an integer and clamps the low end at zero", () => {
    expect(districtLedgerVerdictLikelyRange(-0.5, 3.4)).toBe(`0${EN_DASH}3`);
    expect(districtLedgerVerdictMedian(-0.4)).toBe("~0");
    expect(districtLedgerVerdictMedian(129.6)).toBe("~130");
    expect(districtLedgerVerdictLikelyHeadline(10.2, 19.7, "qualification")).toBe(`Likely 10${EN_DASH}20 qualification points.`);
  });

  it("writes the field, cap, event total and outcome headlines", () => {
    expect(districtLedgerVerdictFieldHeadline(0.71, 129.6)).toBe("In the field in 71 of 100 runs, and ~130 points if there.");
    expect(districtLedgerVerdictFieldHeadline(0.02, 129.6)).toBe("In the field in fewer than 5 of 100 runs, and ~130 points if there.");
    expect(districtLedgerVerdictCapHeadline(22, 0.58)).toBe("Finishes quals at the 22 point cap in 58 of 100 runs.");
    expect(districtLedgerVerdictEventTotalHeadline(40.4, 61.5, "PNW District Oregon State Fair Event")).toBe(
      `Likely 40${EN_DASH}62 points at Oregon State Fair.`
    );
    expect(districtLedgerVerdictOutcomeHeadline("Wins the event", 0.92)).toBe("Wins the event in 92 of 100 runs.");
    expect(districtLedgerVerdictOutcomeHeadline("Impact", 0.004)).toBe("Impact in 0 of 100 runs.");
    expect(districtLedgerVerdictChanceOfPoints(0.48)).toBe("48%");
  });

  it("writes the eyebrow, the cell titles, the chart labels and the source chip texts", () => {
    expect(districtLedgerVerdictEyebrow("Grand total", 4915, "Spartronics")).toBe("Grand total · 4915 Spartronics");
    expect(districtLedgerVerdictEventCellTitle("Qualification", "PNW District Oregon State Fair Event")).toBe("Qualification at Oregon State Fair");
    expect(districtLedgerVerdictCutoffLabel("~213")).toBe("cutoff ~213");
    expect(districtLedgerVerdictCutoffLabel("213")).toBe("cutoff 213");
    expect(districtLedgerVerdictCapLabel(22)).toBe("22 cap");
    expect(districtLedgerVerdictEarnedAt(["PNW District Glacier Peak Event", "Done Event"])).toBe("earned at Glacier Peak, Done Event");
    expect(districtLedgerVerdictPredictedAt("PNW District Sammamish Event")).toBe("predicted at Sammamish");
  });

  it("clamps the champ field suffix by the same two limits", () => {
    expect(champLedgerVerdictFieldSuffix(0.71)).toBe(", in the field 71% of runs");
    expect(champLedgerVerdictFieldSuffix(0.049)).toBe(", in the field <5% of runs");
    expect(champLedgerVerdictFieldSuffix(0.996)).toBe(", in the field 99% of runs");
  });

  it("prints an outcome row's points with the unit, as one value or a range", () => {
    expect(districtLedgerOutcomePointsLabel(30)).toBe("30 pts");
    expect(districtLedgerOutcomePointsLabel(27, 48)).toBe("27 to 48 pts");
    expect(districtLedgerOutcomePointsLabel(0, 0)).toBe("0 pts");
  });

  it("carries no dash character in any verdict string, except the en dash inside a numeric range", () => {
    const strings: string[] = [
      DISTRICT_LEDGER_VERDICT_NOTE,
      ...Object.values(DISTRICT_LEDGER_VERDICT_TILE_LABELS),
      ...Object.values(DISTRICT_LEDGER_VERDICT_LEGEND),
      ...Object.values(DISTRICT_LEDGER_VERDICT_CUTOFF_TILE_WORDS),
      ...Object.values(DISTRICT_LEDGER_VERDICT_CELL_TITLES),
      ...Object.values(CHAMP_LEDGER_VERDICT_SUBTOTAL_TITLES),
      ...Object.values(DISTRICT_LEDGER_VERDICT_POINT_NOUNS),
      ...Object.values(DISTRICT_LEDGER_VERDICT_CHIP_LABELS),
      ...Object.values(CHAMP_LEDGER_VERDICT_SOURCE_WORDS),
      districtLedgerVerdictRuns(0.03),
      districtLedgerVerdictMedian(12),
      districtLedgerVerdictLikelyRange(3, 9),
      districtLedgerVerdictLikelyHeadline(3, 9, "award"),
      ...(["chance", "qualified", "lockedOut", "declined", "pending", "noCall", "open"] as const).map((kind) =>
        districtLedgerVerdictGrandHeadline(kind === "chance" ? { kind, chance: 0.4 } : { kind }, 3, 9)
      ),
      districtLedgerVerdictEventTotalHeadline(3, 9, "Live Event"),
      districtLedgerVerdictFieldHeadline(0.4, 12),
      districtLedgerVerdictCapHeadline(22, 0.5),
      districtLedgerVerdictOutcomeHeadline("Finalist", 0.2),
      districtLedgerVerdictChanceOfPoints(0.2),
      districtLedgerVerdictEyebrow("Grand total", 1, "Team"),
      districtLedgerVerdictEventCellTitle("Playoffs", "Live Event"),
      districtLedgerVerdictCutoffLabel("~12"),
      districtLedgerVerdictCapLabel(22),
      districtLedgerVerdictEarnedAt(["Done Event"]),
      districtLedgerVerdictPredictedAt("Live Event"),
      champLedgerVerdictFieldSuffix(0.4),
      champLedgerVerdictFieldSuffix(0.01),
      districtLedgerOutcomePointsLabel(27, 48),
      ...Object.values(DISTRICT_LEDGER_PLAYOFF_OUTCOME_LABELS),
      ...Object.values(DISTRICT_LEDGER_AWARD_OUTCOME_LABELS),
      ...Object.values(DISTRICT_LEDGER_SELECTION_OUTCOME_LABELS),
    ];
    for (const text of strings) {
      expect(text.replace(RANGE_DASH, "$1$2"), text).not.toMatch(ANY_DASH);
      expect(text).not.toContain(String.fromCharCode(0x00b1));
      expect(text.toLowerCase()).not.toContain("today");
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

describe("the run progress bar copy (quick task 261007-481)", () => {
  it("pins the label and the spoken value, singular for one event", () => {
    expect(DISTRICT_LEDGER_RUN_PROGRESS_LABEL).toBe("Simulation progress");
    expect(districtLedgerRunProgressText(3, 9)).toBe("3 of 9 events simulated");
    expect(districtLedgerRunProgressText(0, 1)).toBe("0 of 1 event simulated");
  });

  it("carries no dash character, matching the tab's own rule", () => {
    const everyString = [DISTRICT_LEDGER_RUN_PROGRESS_LABEL, districtLedgerRunProgressText(3, 9), districtLedgerRunProgressText(0, 1)].join(" ");
    for (const dash of ["—", "–", "-"]) expect(everyString).not.toContain(dash);
  });
});
