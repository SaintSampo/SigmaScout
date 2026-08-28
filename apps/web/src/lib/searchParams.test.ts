/**
 * `TeamSearchSchema`'s own T-06-01 coverage (06-01-PLAN.md Task 2) — the
 * `tab` field's fallback behavior, plus proof the inherited `RootSearchSchema`
 * fallbacks (year/algorithm) still apply unchanged through `.extend()`.
 */
import { describe, expect, it } from "vitest";
import { CURRENT_SEASON } from "./seasons.js";
import { EVENT_TABS, EventSearchSchema, TeamSearchSchema } from "./searchParams.js";

describe("TeamSearchSchema", () => {
  it("parses an explicit valid tab", () => {
    expect(TeamSearchSchema.parse({ tab: "history" }).tab).toBe("history");
  });

  it("falls back to overview on a bogus tab value", () => {
    expect(TeamSearchSchema.parse({ tab: "bogus" }).tab).toBe("overview");
  });

  it("defaults to overview when tab is absent", () => {
    expect(TeamSearchSchema.parse({}).tab).toBe("overview");
  });

  it("still applies RootSearchSchema's own year/algorithm fallbacks unchanged", () => {
    const parsed = TeamSearchSchema.parse({ year: "1899", algorithm: "nope" });
    expect(parsed.year).toBe(CURRENT_SEASON);
    expect(parsed.algorithm).toBe("sigma1");
  });
});

describe("EventSearchSchema (07-01-PLAN.md Task 1)", () => {
  it("EVENT_TABS is the five fixed ids in UI-SPEC order", () => {
    expect(EVENT_TABS).toEqual(["insights", "breakdown", "quals", "alliances", "elims"]);
  });

  it("parses an explicit valid tab", () => {
    expect(EventSearchSchema.parse({ tab: "quals" }).tab).toBe("quals");
  });

  it("falls back to breakdown on a bogus tab value", () => {
    expect(EventSearchSchema.parse({ tab: "bogus" }).tab).toBe("breakdown");
  });

  it("defaults to breakdown when tab is absent", () => {
    expect(EventSearchSchema.parse({}).tab).toBe("breakdown");
  });

  it("still applies RootSearchSchema's own year/algorithm fallbacks unchanged", () => {
    const parsed = EventSearchSchema.parse({ year: "1899", algorithm: "nope" });
    expect(parsed.year).toBe(CURRENT_SEASON);
    expect(parsed.algorithm).toBe("sigma1");
  });
});
