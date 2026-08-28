/**
 * `TeamSearchSchema`'s own T-06-01 coverage (06-01-PLAN.md Task 2) — the
 * `tab` field's fallback behavior, plus proof the inherited `RootSearchSchema`
 * fallbacks (year/algorithm) still apply unchanged through `.extend()`.
 */
import { describe, expect, it } from "vitest";
import { CURRENT_SEASON } from "./seasons.js";
import { EVENT_TABS, EventSearchSchema, EventsSearchSchema, RootSearchSchema, TeamSearchSchema, TeamsSearchSchema } from "./searchParams.js";

describe("RootSearchSchema's default algorithm (plan 07-18 Task 1, the cutover)", () => {
  // Test 1 — the default algorithm.
  it("defaults to vpr when algorithm is absent", () => {
    expect(RootSearchSchema.parse({}).algorithm).toBe("vpr");
  });

  // Test 2 — the empty-input path on every schema that extends the root.
  it("every schema extending RootSearchSchema resolves the same empty-input algorithm default", () => {
    expect(TeamsSearchSchema.parse({}).algorithm).toBe("vpr");
    expect(EventsSearchSchema.parse({}).algorithm).toBe("vpr");
    expect(TeamSearchSchema.parse({}).algorithm).toBe("vpr");
    expect(EventSearchSchema.parse({}).algorithm).toBe("vpr");
  });

  // Test 3 — the adjacency case, D-05's safety argument made executable: the
  // retired id and the renamed id are adjacent INPUTS that resolve to the
  // same value by two different mechanisms.
  it("the retired pre-rename id falls back to vpr via .catch(); the renamed id parses directly", () => {
    expect(RootSearchSchema.parse({ algorithm: "sigma1" }).algorithm).toBe("vpr");
    expect(RootSearchSchema.parse({ algorithm: "vpr" }).algorithm).toBe("vpr");
  });

  // Test 4 — an unrelated garbage value still falls back, unchanged behavior.
  it("a garbage algorithm value falls back to the default", () => {
    expect(RootSearchSchema.parse({ algorithm: "not-a-real-algorithm" }).algorithm).toBe("vpr");
  });
});

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
    expect(parsed.algorithm).toBe("vpr");
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
    expect(parsed.algorithm).toBe("vpr");
  });
});
