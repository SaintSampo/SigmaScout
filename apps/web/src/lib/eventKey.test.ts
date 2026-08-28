import { describe, expect, it } from "vitest";
import { EVENT_KEY_PATTERN, InvalidEventKeyError, isValidEventKey, seasonFromEventKey } from "./eventKey.js";

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
});
