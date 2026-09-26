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
  districtLedgerChanceLine,
  districtLedgerRookieBonusLine,
  districtLedgerRookieBonusCaption,
  DISTRICT_LEDGER_AWARD_OUTCOME_LABELS,
  DISTRICT_LEDGER_CHANCE_BELOW_FLOOR,
  DISTRICT_LEDGER_CHANCE_WORDS,
  DISTRICT_LEDGER_CONTRIBUTION_CAPTION,
  DISTRICT_LEDGER_CONTRIBUTION_SETTLED,
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_DRAWER_CHANCE_CAPTION,
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
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_LABELS,
  DISTRICT_LEDGER_TAB_LABEL,
  DISTRICT_LEDGER_TICK_NOW,
  DISTRICT_LEDGER_TICK_START,
  districtLedgerContributionEarned,
  districtLedgerOutcomeChance,
  districtLedgerOutcomePoints,
  districtLedgerOutcomePointsRange,
  districtLedgerPlacementLine,
  districtLedgerSelectionSettledLine,
  districtLedgerShortEventName,
  districtLedgerTickWeekLabel,
} from "./districtLedgerCopy.js";

describe("the UI-SPEC copy contract", () => {
  it("pins the five status definitions character for character", () => {
    expect(DISTRICT_LEDGER_STATUS_DEFINITIONS.prequalified).toBe("prequalified by FIRST");
    expect(DISTRICT_LEDGER_STATUS_DEFINITIONS.locked).toBe("mathematically qualified, no matter what, on district points or an award");
    expect(DISTRICT_LEDGER_STATUS_DEFINITIONS.inRange).toBe("if every team earned its median predicted points, this team would qualify");
    expect(DISTRICT_LEDGER_STATUS_DEFINITIONS.outOfRange).toBe("if every team earned its median predicted points, this team would not qualify");
    expect(DISTRICT_LEDGER_STATUS_DEFINITIONS.lockedOut).toBe("cannot earn enough district points to qualify");
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

  it("pins the slider's tick labels, which are the jump chips' short form", () => {
    expect(DISTRICT_LEDGER_TICK_START).toBe("start");
    expect(DISTRICT_LEDGER_TICK_NOW).toBe("now");
    expect(districtLedgerTickWeekLabel(0)).toBe("wk 1");
    expect(districtLedgerTickWeekLabel(3)).toBe("wk 4");
  });

  it("shortens ONLY a name that matches TBA's whole district template, and prints every other name verbatim", () => {
    expect(districtLedgerShortEventName("PNW District Oregon State Fair Event")).toBe("Oregon State Fair");
    expect(districtLedgerShortEventName("FNC District Wake County Event")).toBe("Wake County");
    expect(districtLedgerShortEventName("FIM District - Kettering University Event #1")).toBe("Kettering University #1");
    // No name body between "District" and "Event": nothing to shorten to, so
    // the published name stands.
    expect(districtLedgerShortEventName("ISR District Event #1")).toBe("ISR District Event #1");
    // Not a district name at all.
    expect(districtLedgerShortEventName("Done Event")).toBe("Done Event");
    expect(districtLedgerShortEventName("Einstein Field")).toBe("Einstein Field");
  });

  it("pins the tab label and the column labels in render order", () => {
    expect(DISTRICT_LEDGER_TAB_LABEL).toBe("Road to District Champs");
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
