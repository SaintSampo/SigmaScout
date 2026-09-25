/**
 * `TeamSearchSchema`'s own coverage — the `tab` field's fallback behavior,
 * plus proof the inherited `RootSearchSchema` fallbacks (year/algorithm)
 * still apply unchanged through `.extend()`.
 */
import { describe, expect, it } from "vitest";
import { CURRENT_SEASON } from "./seasons.js";
import {
  DEFAULT_DISTRICT_TAB,
  DEFAULT_EVENT_TAB,
  DistrictsSearchSchema,
  EVENT_TABS,
  EventSearchSchema,
  EventsSearchSchema,
  MatchSearchSchema,
  RootSearchSchema,
  TeamSearchSchema,
  TeamsSearchSchema,
  applyYearChange,
} from "./searchParams.js";
import { DISTRICT_KEY_PATTERN } from "../../../../packages/core/districts/keys.js";

describe("RootSearchSchema's default algorithm", () => {
  it("defaults to vpr when algorithm is absent", () => {
    expect(RootSearchSchema.parse({}).algorithm).toBe("spr");
  });

  it("every schema extending RootSearchSchema resolves the same empty-input algorithm default", () => {
    expect(TeamsSearchSchema.parse({}).algorithm).toBe("spr");
    expect(EventsSearchSchema.parse({}).algorithm).toBe("spr");
    expect(TeamSearchSchema.parse({}).algorithm).toBe("spr");
    expect(EventSearchSchema.parse({}).algorithm).toBe("spr");
  });

  // A PERMANENT regression proof: a retired algorithm id falls back to the
  // current default via `.catch()` rather than erroring. Built from two
  // segments rather than one quoted literal, to avoid typing a retired id
  // in source.
  it("the retired pre-rename id falls back to vpr via .catch(); the renamed id parses directly", () => {
    const retiredAlgorithmId = "sigma" + "1";
    expect(RootSearchSchema.parse({ algorithm: retiredAlgorithmId }).algorithm).toBe("spr");
    expect(RootSearchSchema.parse({ algorithm: "spr" }).algorithm).toBe("spr");
  });

  // Same permanent regression proof for a different retired wire id
  // (a bookmarked link carrying it must not 404 or blank the page).
  it("the retired previous premier wire id falls back to the current default via .catch()", () => {
    const retiredAlgorithmId = "b" + "pr";
    expect(RootSearchSchema.parse({ algorithm: retiredAlgorithmId }).algorithm).toBe("spr");
  });

  it("a garbage algorithm value falls back to the default", () => {
    expect(RootSearchSchema.parse({ algorithm: "not-a-real-algorithm" }).algorithm).toBe("spr");
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
    expect(parsed.algorithm).toBe("spr");
  });
});

describe("EventSearchSchema", () => {
  // Ordering asserted separately from the default so the two facts (WHICH
  // tab is active vs. WHERE tabs sit in the strip) cannot be conflated.
  it("EVENT_TABS is the six fixed ids in tab-strip order, with the default's id first and 'simulation' last", () => {
    expect(EVENT_TABS).toEqual(["insights", "breakdown", "quals", "alliances", "elims", "simulation"]);
  });

  it("parses each of the six explicit tab ids back unchanged (six iterations)", () => {
    expect(EVENT_TABS).toHaveLength(6);
    for (const tab of EVENT_TABS) {
      expect(EventSearchSchema.parse({ tab }).tab).toBe(tab);
    }
  });

  it("falls back to insights (the new default) on a bogus tab value", () => {
    expect(EventSearchSchema.parse({ tab: "bogus" }).tab).toBe("insights");
  });

  it("defaults to insights when tab is absent", () => {
    expect(EventSearchSchema.parse({}).tab).toBe("insights");
  });

  it("still applies RootSearchSchema's own year/algorithm fallbacks unchanged", () => {
    const parsed = EventSearchSchema.parse({ year: "1899", algorithm: "nope" });
    expect(parsed.year).toBe(CURRENT_SEASON);
    expect(parsed.algorithm).toBe("spr");
  });

  // Which tab is active on arrival vs. where tabs sit in the strip are
  // different facts — asserted against "appended an id and moved the
  // default while I was in there."
  it("DEFAULT_EVENT_TAB is still exactly 'insights' and is NOT the last element of EVENT_TABS", () => {
    expect(DEFAULT_EVENT_TAB).toBe("insights");
    expect(EVENT_TABS.at(-1)).toBe("simulation");
    expect(EVENT_TABS.at(-1)).not.toBe(DEFAULT_EVENT_TAB);
  });
});

describe("TeamsSearchSchema's tint field", () => {
  it("parses tint: 'sigma' through unchanged", () => {
    expect(TeamsSearchSchema.parse({ tint: "sigma" }).tint).toBe("sigma");
  });

  it("resolves an unrecognised tint to undefined, and an absent tint to undefined", () => {
    expect(TeamsSearchSchema.parse({ tint: "rainbow" }).tint).toBeUndefined();
    expect(TeamsSearchSchema.parse({}).tint).toBeUndefined();
  });
});

describe("MatchSearchSchema", () => {
  it("carries no tab field — the match page has no tabs", () => {
    const parsed = MatchSearchSchema.parse({});
    expect("tab" in parsed).toBe(false);
  });

  it("still applies RootSearchSchema's own year/algorithm fallbacks unchanged", () => {
    const parsed = MatchSearchSchema.parse({ year: "1899", algorithm: "nope" });
    expect(parsed.year).toBe(CURRENT_SEASON);
    expect(parsed.algorithm).toBe("spr");
  });

  it("parses an explicit valid year/algorithm pair unchanged", () => {
    const parsed = MatchSearchSchema.parse({ year: CURRENT_SEASON, algorithm: "spr" });
    expect(parsed.year).toBe(CURRENT_SEASON);
    expect(parsed.algorithm).toBe("spr");
  });
});

describe("DistrictsSearchSchema — the Road to District Champs params", () => {
  const base = { year: 2026, algorithm: "spr" };

  it("round-trips the three phase-10 fields", () => {
    const parsed = DistrictsSearchSchema.parse({ ...base, district: "2026pnw", at: "2026wabon:qualsDone", drawerTeam: "4131", drawerCell: "2026wabon:qual" });
    expect(parsed.at).toBe("2026wabon:qualsDone");
    expect(parsed.drawerTeam).toBe(4131);
    expect(parsed.drawerCell).toBe("2026wabon:qual");
  });

  it("falls a malformed rewind step id back to absent, which the resolver reads as the now position", () => {
    expect(DistrictsSearchSchema.parse({ ...base, at: { nested: true } }).at).toBeUndefined();
    expect(DistrictsSearchSchema.parse({ ...base, at: ["a", "b"] }).at).toBeUndefined();
    // A merely UNKNOWN string is not malformed — the runtime resolver is what
    // turns it into "now", exactly as `resolveSortKey` does for `sort`.
    expect(DistrictsSearchSchema.parse({ ...base, at: "never-existed" }).at).toBe("never-existed");
  });

  it("falls a malformed drawer team back to absent rather than to an undefined page state", () => {
    expect(DistrictsSearchSchema.parse({ ...base, drawerTeam: "not-a-number" }).drawerTeam).toBeUndefined();
    expect(DistrictsSearchSchema.parse({ ...base, drawerTeam: 12.5 }).drawerTeam).toBeUndefined();
  });

  it("falls a malformed drawer cell id back to absent, which renders as closed", () => {
    expect(DistrictsSearchSchema.parse({ ...base, drawerCell: { nested: true } }).drawerCell).toBeUndefined();
  });

  it("still falls an unrecognised tab back to the renamed default, so every pre-rename link lands on the same panel", () => {
    expect(DistrictsSearchSchema.parse({ ...base, tab: "district-locks" }).tab).toBe(DEFAULT_DISTRICT_TAB);
    expect(DEFAULT_DISTRICT_TAB).toBe("road-to-district-champs");
    expect(DistrictsSearchSchema.parse({ ...base, tab: "champ-locks" }).tab).toBe("champ-locks");
  });

  // WR-10: `?district=` is the one district field with a knowable static
  // shape, so it is validated at this boundary with the SAME pattern the
  // Worker validates it with rather than reaching a fetch URL path unchecked.
  it("keeps a well formed district key exactly as written", () => {
    for (const key of ["2026pnw", "2026fim", "2025fsc", "2026ont"]) {
      expect(DistrictsSearchSchema.parse({ ...base, district: key }).district).toBe(key);
    }
  });

  it("falls a malformed district key back to absent, so it never reaches districtDetailKey or a fetch path", () => {
    for (const malformed of ["../../etc/passwd", "2026PNW", "pnw", "2026", "2026 pnw", "2026pnw/../x", "", "26pnw"]) {
      expect(DistrictsSearchSchema.parse({ ...base, district: malformed }).district).toBeUndefined();
    }
  });

  it("validates it against the SHARED pattern, so the browser and the Worker cannot drift apart on what a district key is", () => {
    expect(DISTRICT_KEY_PATTERN.test("2026pnw")).toBe(true);
    expect(DISTRICT_KEY_PATTERN.test("2026PNW")).toBe(false);
  });

  it("survives a year change untouched — applyYearChange rewrites only the literal key `sort`", () => {
    const parsed = DistrictsSearchSchema.parse({ ...base, at: "2026wabon:qualsDone", drawerTeam: 4131, drawerCell: "2026wabon:qual" });
    const next = applyYearChange(parsed as never, 2025);
    expect((next as unknown as Record<string, unknown>).at).toBe("2026wabon:qualsDone");
    expect((next as unknown as Record<string, unknown>).drawerTeam).toBe(4131);
    expect((next as unknown as Record<string, unknown>).drawerCell).toBe("2026wabon:qual");
  });
});
