import { describe, expect, it } from "vitest";
import { eventKeyFromMatchKey, InvalidMatchKeyError, isValidMatchKey } from "./matchKey.js";

describe("matchKey", () => {
  it("isValidMatchKey('2024casf_qm1') is true", () => {
    expect(isValidMatchKey("2024casf_qm1")).toBe(true);
  });

  it("eventKeyFromMatchKey('2024casf_qm1') equals '2024casf'", () => {
    expect(eventKeyFromMatchKey("2024casf_qm1")).toBe("2024casf");
  });

  it("splits at the FIRST underscore, not the last — a suffix carrying its own underscore still resolves the correct event key", () => {
    expect(eventKeyFromMatchKey("2024casf_qf1_m2")).toBe("2024casf");
  });

  it("isValidMatchKey('notanevent_qm1') is false — the prefix is not a valid event key", () => {
    expect(isValidMatchKey("notanevent_qm1")).toBe(false);
  });

  it("isValidMatchKey('2024casf') is false — no underscore at all", () => {
    expect(isValidMatchKey("2024casf")).toBe(false);
  });

  it("isValidMatchKey('2024casf_') is false — empty suffix", () => {
    expect(isValidMatchKey("2024casf_")).toBe(false);
  });

  it("isValidMatchKey('') is false", () => {
    expect(isValidMatchKey("")).toBe(false);
  });

  it("eventKeyFromMatchKey throws InvalidMatchKeyError for a key with no underscore", () => {
    expect(() => eventKeyFromMatchKey("2024casf")).toThrow(InvalidMatchKeyError);
  });

  it("eventKeyFromMatchKey throws InvalidMatchKeyError for a key whose prefix is not a valid event key", () => {
    expect(() => eventKeyFromMatchKey("notanevent_qm1")).toThrow(InvalidMatchKeyError);
  });

  it("accepts real corpus-shaped event-key prefixes of varying length", () => {
    expect(eventKeyFromMatchKey("2022roe_qm5")).toBe("2022roe");
    expect(eventKeyFromMatchKey("2024txcmp_sf1m1")).toBe("2024txcmp");
  });
});
