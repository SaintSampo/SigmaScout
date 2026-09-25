/**
 * The two TBA key shapes (phase 10 review, WR-03 and WR-10).
 *
 * Both patterns are tested SEPARATELY and in full, positive and negative, even
 * though they are equal literals today. That redundancy is the point of the
 * finding: the moment one of them is narrowed, the suite that pins the other
 * must not move with it.
 */
import { describe, expect, it } from "vitest";
import { DISTRICT_KEY_PATTERN, EVENT_KEY_PATTERN } from "./keys.js";

/** Real district keys, from the published `v1/districts/{year}.json` vocabulary. */
const REAL_DISTRICT_KEYS = ["2026pnw", "2026fim", "2026fnc", "2026ont", "2026isr", "2025fsc", "2022chs", "2016mar"];

/** Real event keys across the three shapes the corpus carries: regular district, divisioned dcmp parent, and a non district regional. */
const REAL_EVENT_KEYS = ["2026wabon", "2026wasam", "2026miken", "2026pncmp", "2026micmp", "2024casf", "2026txcmp1", "2026cmptx"];

/**
 * Strings a key must never be accepted as. Every one of them is a value that
 * would otherwise have reached a TBA URL path segment, an R2 object key, a D1
 * cursor row key or a browser fetch path.
 */
const MALFORMED = [
  "",
  "pnw",
  "2026",
  "26pnw",
  "2026PNW",
  "2026 pnw",
  "2026pnw ",
  " 2026pnw",
  "2026pnw/rankings",
  "../../etc/passwd",
  "2026pnw/../2026fim",
  "2026-pnw",
  "2026pnw.json",
  "2026pnw?x=1",
  "2026pnw#frag",
  "2026pnw%2f",
  "20260pnw\n2026fim",
];

describe("DISTRICT_KEY_PATTERN", () => {
  it("accepts every real district key shape", () => {
    for (const key of REAL_DISTRICT_KEYS) expect(DISTRICT_KEY_PATTERN.test(key)).toBe(true);
  });

  it("rejects every malformed value, so none of them can become a URL path segment or an R2 key", () => {
    for (const value of MALFORMED) expect(DISTRICT_KEY_PATTERN.test(value)).toBe(false);
  });

  it("is anchored at both ends, so a valid key embedded in a longer string is still refused", () => {
    expect(DISTRICT_KEY_PATTERN.test("x2026pnw")).toBe(false);
    expect(DISTRICT_KEY_PATTERN.test("2026pnw!")).toBe(false);
  });

  it("carries no global flag, so repeated tests of the same value cannot disagree with each other", () => {
    expect(DISTRICT_KEY_PATTERN.global).toBe(false);
    expect(DISTRICT_KEY_PATTERN.test("2026pnw")).toBe(true);
    expect(DISTRICT_KEY_PATTERN.test("2026pnw")).toBe(true);
  });
});

describe("EVENT_KEY_PATTERN", () => {
  it("accepts every real event key shape, including a divisioned dcmp parent and a championship key", () => {
    for (const key of REAL_EVENT_KEYS) expect(EVENT_KEY_PATTERN.test(key)).toBe(true);
  });

  it("rejects every malformed value, so none of them can become `/event/{key}/awards` or a D1 cursor row key", () => {
    for (const value of MALFORMED) expect(EVENT_KEY_PATTERN.test(value)).toBe(false);
  });

  it("is anchored at both ends", () => {
    expect(EVENT_KEY_PATTERN.test("x2026wabon")).toBe(false);
    expect(EVENT_KEY_PATTERN.test("2026wabon/awards")).toBe(false);
  });

  it("carries no global flag", () => {
    expect(EVENT_KEY_PATTERN.global).toBe(false);
    expect(EVENT_KEY_PATTERN.test("2026wabon")).toBe(true);
    expect(EVENT_KEY_PATTERN.test("2026wabon")).toBe(true);
  });
});

describe("the two patterns are separately declared (WR-03)", () => {
  it("are two distinct objects, so narrowing one cannot silently retune the other", () => {
    expect(DISTRICT_KEY_PATTERN).not.toBe(EVENT_KEY_PATTERN);
  });

  it("names the coincidence rather than hiding it: they are equal literals TODAY", () => {
    // If this assertion ever fails, one of the two was deliberately narrowed.
    // That is allowed. What is NOT allowed is the narrowing happening to the
    // shared literal and silently changing the other consumer's meaning, which
    // is what the separate declarations above make impossible.
    expect(DISTRICT_KEY_PATTERN.source).toBe(EVENT_KEY_PATTERN.source);
  });
});
