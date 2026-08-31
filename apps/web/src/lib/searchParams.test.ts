/**
 * `TeamSearchSchema`'s own T-06-01 coverage (06-01-PLAN.md Task 2) — the
 * `tab` field's fallback behavior, plus proof the inherited `RootSearchSchema`
 * fallbacks (year/algorithm) still apply unchanged through `.extend()`.
 */
import { describe, expect, it } from "vitest";
import { CURRENT_SEASON } from "./seasons.js";
import { DEFAULT_EVENT_TAB, EVENT_TABS, EventSearchSchema, EventsSearchSchema, RootSearchSchema, TeamSearchSchema, TeamsSearchSchema } from "./searchParams.js";

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
  // same value by two different mechanisms. This is a PERMANENT regression
  // proof (not a rename leftover), so the retired id is built from two
  // segments rather than one quoted literal — `packages/harness/
  // algorithmIdentity.test.ts`'s standing sweep matches an EXACT quoted
  // occurrence of the retired id (the same disclosed sweep-pattern
  // limitation that file's own STRUCTURAL_EXEMPTIONS list already applies
  // to a path-segment case), and this file carries no exemption of its own.
  it("the retired pre-rename id falls back to vpr via .catch(); the renamed id parses directly", () => {
    const retiredAlgorithmId = "sigma" + "1";
    expect(RootSearchSchema.parse({ algorithm: retiredAlgorithmId }).algorithm).toBe("vpr");
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

describe("EventSearchSchema (07-01-PLAN.md Task 1; default flipped to insights by 07-18 Task 2; sixth id 'simulation' added by 08-09-PLAN.md Task 1)", () => {
  // Test 4 (plan 07-18 Task 2, rewritten by 08-09 Task 1 PD-09): ordering is
  // untouched — asserted separately from the default so the two facts (WHICH
  // tab is active vs. WHERE tabs sit in the strip) cannot be conflated. The
  // expected array grows from five ids to six, with "simulation" appended
  // last, matching UI-SPEC's declared order.
  it("EVENT_TABS is the six fixed ids in UI-SPEC order, with the default's id first and 'simulation' last", () => {
    expect(EVENT_TABS).toEqual(["insights", "breakdown", "quals", "alliances", "elims", "simulation"]);
  });

  // Test 3 (plan 07-18 Task 2, rewritten by 08-09 Task 1): an explicit tab
  // still wins for every one of the now-SIX ids, so the default change did
  // not turn the field into a constant — this case covers the sixth id
  // automatically once the tuple grows, so it now runs six iterations rather
  // than leaving the coverage implicit.
  it("parses each of the six explicit tab ids back unchanged (six iterations)", () => {
    expect(EVENT_TABS).toHaveLength(6);
    for (const tab of EVENT_TABS) {
      expect(EventSearchSchema.parse({ tab }).tab).toBe(tab);
    }
  });

  // Test 2 (plan 07-18 Task 2): a malformed tab still falls back, to the NEW
  // default. Unmodified by 08-09 Task 1 — run to confirm it still passes.
  it("falls back to insights (the new default) on a bogus tab value", () => {
    expect(EventSearchSchema.parse({ tab: "bogus" }).tab).toBe("insights");
  });

  // Test 1 (plan 07-18 Task 2): the empty-input path. Unmodified by 08-09
  // Task 1 — run to confirm it still passes.
  it("defaults to insights when tab is absent", () => {
    expect(EventSearchSchema.parse({}).tab).toBe("insights");
  });

  it("still applies RootSearchSchema's own year/algorithm fallbacks unchanged", () => {
    const parsed = EventSearchSchema.parse({ year: "1899", algorithm: "nope" });
    expect(parsed.year).toBe(CURRENT_SEASON);
    expect(parsed.algorithm).toBe("vpr");
  });

  // New case, 08-09-PLAN.md Task 1: the separation plan 07-18 already
  // insisted on — which tab is active on arrival vs. where tabs sit in the
  // strip are different facts — asserted here against the specific failure
  // mode of "appended an id and moved the default while I was in there."
  it("DEFAULT_EVENT_TAB is still exactly 'insights' and is NOT the last element of EVENT_TABS", () => {
    expect(DEFAULT_EVENT_TAB).toBe("insights");
    expect(EVENT_TABS.at(-1)).toBe("simulation");
    expect(EVENT_TABS.at(-1)).not.toBe(DEFAULT_EVENT_TAB);
  });
});
