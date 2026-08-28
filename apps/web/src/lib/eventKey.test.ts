import { describe, expect, it } from "vitest";
import { EVENT_KEY_PATTERN, eventKeyForSeason, InvalidEventKeyError, isValidEventKey, seasonFromEventKey } from "./eventKey.js";

describe("eventKey", () => {
  it("EVENT_KEY_PATTERN matches a real event key shape", () => {
    expect(EVENT_KEY_PATTERN.test("2024casf")).toBe(true);
  });

  it("isValidEventKey('2024casf') is true", () => {
    expect(isValidEventKey("2024casf")).toBe(true);
  });

  it("isValidEventKey('notanevent') is false", () => {
    expect(isValidEventKey("notanevent")).toBe(false);
  });

  it("isValidEventKey('2024CASF') is false — uppercase is rejected", () => {
    expect(isValidEventKey("2024CASF")).toBe(false);
  });

  it("seasonFromEventKey('2024casf') equals 2024", () => {
    expect(seasonFromEventKey("2024casf")).toBe(2024);
  });

  it("seasonFromEventKey('nope') throws InvalidEventKeyError", () => {
    expect(() => seasonFromEventKey("nope")).toThrow(InvalidEventKeyError);
  });

  it("accepts real corpus-shaped keys of varying length", () => {
    expect(isValidEventKey("2022roe")).toBe(true);
    expect(isValidEventKey("2026arc")).toBe(true);
    expect(isValidEventKey("2024txcmp")).toBe(true);
  });

  it("rejects a key missing the four-digit year", () => {
    expect(isValidEventKey("casf")).toBe(false);
    expect(isValidEventKey("24casf")).toBe(false);
  });

  // ---------------------------------------------------------------------
  // 07-15-PLAN.md Task 3 — eventKeyForSeason, Phase 5 D-12's season swap
  // ---------------------------------------------------------------------

  it("Test 4: eventKeyForSeason swaps only the leading four season digits", () => {
    expect(eventKeyForSeason("2024casf", 2025)).toBe("2025casf");
    expect(eventKeyForSeason("2024casf", 2024)).toBe("2024casf");
    expect(eventKeyForSeason("2022ispr", 2026)).toBe("2026ispr");
  });

  it("Test 5: eventKeyForSeason rejects what the pattern rejects", () => {
    expect(() => eventKeyForSeason("notanevent", 2025)).toThrow(InvalidEventKeyError);
  });

  it("Test 6: eventKeyForSeason and seasonFromEventKey agree on which characters are the season", () => {
    expect(seasonFromEventKey(eventKeyForSeason("2024casf", 2026))).toBe(2026);
  });
});
