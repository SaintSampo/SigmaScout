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
  DISTRICT_LEDGER_COLUMN_LABELS,
  DISTRICT_LEDGER_LEGEND_EARNED,
  DISTRICT_LEDGER_LEGEND_EXPLAINER,
  DISTRICT_LEDGER_LEGEND_OPEN,
  DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
  DISTRICT_LEDGER_STATUS_DEFINITIONS,
  DISTRICT_LEDGER_STATUS_LABELS,
  DISTRICT_LEDGER_TAB_LABEL,
  DISTRICT_LEDGER_TICK_NOW,
  DISTRICT_LEDGER_TICK_START,
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
    expect(DISTRICT_LEDGER_LEGEND_EXPLAINER).toBe("likely = 8 of 10 runs land here · ~ = this site's prediction, not a number TBA published");
  });

  it("pins the five status labels and the award variant", () => {
    expect(Object.values(DISTRICT_LEDGER_STATUS_LABELS)).toEqual(["Prequalified", "Locked", "In range", "Out of range", "Locked out"]);
    expect(DISTRICT_LEDGER_LOCKED_AWARD_LABEL).toBe("Locked · award");
  });

  it("pins the slider's tick labels, which are the jump chips' short form", () => {
    expect(DISTRICT_LEDGER_TICK_START).toBe("start");
    expect(DISTRICT_LEDGER_TICK_NOW).toBe("now");
    expect(districtLedgerTickWeekLabel(0)).toBe("wk 0");
    expect(districtLedgerTickWeekLabel(3)).toBe("wk 3");
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
      "Event",
      "Qualification",
      "Alliance selection",
      "Playoffs",
      "Awards",
      "Event total",
      "Grand total",
    ]);
  });

  it("prints neither of the two superseded status words anywhere in this tab's vocabulary", () => {
    const everyString = [
      ...Object.values(DISTRICT_LEDGER_STATUS_LABELS),
      ...Object.values(DISTRICT_LEDGER_STATUS_DEFINITIONS),
      DISTRICT_LEDGER_LOCKED_AWARD_LABEL,
    ].join(" ");
    expect(everyString).not.toContain("Contending");
    expect(everyString).not.toContain("eliminated");
  });
});
