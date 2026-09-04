import { describe, expect, it } from "vitest";
import { OFFSEASON_EVENT_TYPE, PRESEASON_EVENT_TYPE, isOfficialEventType } from "./eventTypes.js";

describe("isOfficialEventType", () => {
  it("returns false for offseason (99) and preseason Week 0 (100)", () => {
    expect(isOfficialEventType(OFFSEASON_EVENT_TYPE)).toBe(false);
    expect(isOfficialEventType(99)).toBe(false);
    expect(isOfficialEventType(PRESEASON_EVENT_TYPE)).toBe(false);
    expect(isOfficialEventType(100)).toBe(false);
  });

  it("returns true for every real official TBA event type (0-6): regional, district, district championship, championship division, championship finals, district championship division, festival of champions", () => {
    for (const eventType of [0, 1, 2, 3, 4, 5, 6]) {
      expect(isOfficialEventType(eventType)).toBe(true);
    }
  });

  it("returns true for -1, the event-detail-fetch-failed sentinel scheduled.ts already uses -- an unknown type degrades toward the pre-existing (updating) behaviour, not toward silently freezing the teams table", () => {
    expect(isOfficialEventType(-1)).toBe(true);
  });
});
