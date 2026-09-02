/**
 * Fixtures are constructed to satisfy the published `EventsListRowSchema`
 * shape (05-07-PLAN.md Task 1). Includes at least one offseason row with a
 * null week and one row with all three location fields null.
 */
import { describe, expect, it } from "vitest";
import { EventsArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION, type EventsArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { applyEventFilters, filterOptions, hasOutOfBandWeek, MAX_SEASON_WEEK, sortEvents, weekMatches, type EventRow } from "./filterModel.js";

function makeArtifact(events: EventsArtifact["events"]): EventsArtifact {
  return EventsArtifactSchema.parse({
    schemaVersion: PAGE_ARTIFACT_SCHEMA_VERSION,
    generation: "gen-1",
    computedAt: "2026-08-24T00:00:00.000Z",
    algorithmId: "vpr",
    algorithmVersion: "2.0.0+tuned-2026-08",
    season: 2025,
    events,
  });
}

function makeRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    eventKey: "2025alhu",
    name: "Rocket City Regional",
    eventType: 0,
    isOffseason: false,
    startDate: "2025-03-12",
    week: 2,
    teamCount: 44,
    matchCount: 96,
    playedMatchCount: 96,
    country: "USA",
    stateProv: "AL",
    districtKey: null,
    ...overrides,
  };
}

const FIXTURE_EVENTS: EventRow[] = makeArtifact([
  makeRow({ eventKey: "2025alhu", name: "Rocket City Regional", week: 2, country: "USA", stateProv: "AL", districtKey: null }),
  makeRow({ eventKey: "2025mimil", name: "Milwaukee District", week: 3, country: "USA", stateProv: "MI", districtKey: "fim" }),
  makeRow({ eventKey: "2025mitry", name: "Troy District", week: 3, country: "USA", stateProv: "MI", districtKey: "fim" }),
  // Offseason row: null week, per the UI-SPEC's Offseason badge rule.
  makeRow({ eventKey: "2025zoff1", name: "Fall Classic Offseason", isOffseason: true, week: null, country: "USA", stateProv: "OH", districtKey: null }),
  // Fully null-location row.
  makeRow({ eventKey: "2025zoff2", name: "Unlisted Offseason", isOffseason: true, week: null, country: null, stateProv: null, districtKey: null }),
]).events;

/**
 * WR-01 (review 260902). The three REAL 2026 events the defect was found on,
 * pinned with their raw published `week` values as verified against
 * `v1/events/2026/vpr@2.1.0+tuned-2026-08.json`:
 *
 *   2026isde1  week 16  eventType 1  69 played  ISR District Event #1
 *   2026isde2  week 17  eventType 1  64 played  ISR District Event #2
 *   2026iscmp  week 18  eventType 2  75 played  FIRST Israel District Championship
 *
 * These are official, non-offseason, non-preseason events with 208 played
 * matches between them. TBA does not use `week` purely as a 0-indexed season
 * week — it also carries out-of-band indexes for districts running their own
 * calendar — so a blind `week + 1` rendered them "Week 17/18/19". There is no
 * week 17 of an FRC season, and no week filter could reach them.
 *
 * These literals are the point of this fixture: a future change that puts an
 * out-of-band week back on the season-week scale has to delete an assertion
 * below to do it, rather than silently re-shipping the same three nonsense
 * dropdown options.
 */
const ISRAEL_2026_EVENTS: EventRow[] = makeArtifact([
  makeRow({ eventKey: "2026isde1", name: "ISR District Event #1", eventType: 1, week: 16, matchCount: 69, playedMatchCount: 69, country: "Israel", stateProv: "HaMerkaz", districtKey: "isr" }),
  makeRow({ eventKey: "2026isde2", name: "ISR District Event #2", eventType: 1, week: 17, matchCount: 64, playedMatchCount: 64, country: "Israel", stateProv: "HaMerkaz", districtKey: "isr" }),
  makeRow({ eventKey: "2026iscmp", name: "FIRST Israel District Championship", eventType: 2, week: 18, matchCount: 75, playedMatchCount: 75, country: "Israel", stateProv: "HaMerkaz", districtKey: "isr" }),
]).events;

const ISRAEL_2026_KEYS = ["2026iscmp", "2026isde1", "2026isde2"];

describe("out-of-band TBA week values (WR-01)", () => {
  const MIXED = [...FIXTURE_EVENTS, ...ISRAEL_2026_EVENTS];

  it("offers NO numeric week option above the season-week bound, so no dropdown entry can read 'Week 17'", () => {
    const numericWeeks = filterOptions(MIXED).weeks.filter((week): week is number => typeof week === "number");
    expect(numericWeeks).toEqual([2, 3]);
    expect(numericWeeks.some((week) => week > MAX_SEASON_WEEK)).toBe(false);
    for (const raw of [16, 17, 18]) {
      expect(numericWeeks).not.toContain(raw);
    }
  });

  it("collects the out-of-band events into the 'other' bucket instead, placed last", () => {
    const weeks = filterOptions(MIXED).weeks;
    expect(weeks).toContain("other");
    expect(weeks[weeks.length - 1]).toBe("other");
  });

  it("offers no 'other' bucket at all when every event's week is a real season week", () => {
    expect(filterOptions(FIXTURE_EVENTS).weeks).not.toContain("other");
  });

  it("the 'other' filter returns exactly the three real Israeli events, which 208 played matches depend on being reachable", () => {
    const result = applyEventFilters(MIXED, { week: "other" });
    expect(result.map((event) => event.eventKey).sort()).toEqual(ISRAEL_2026_KEYS);
    expect(result.reduce((sum, event) => sum + event.playedMatchCount, 0)).toBe(208);
  });

  it("recognises each real out-of-band week individually, and no in-band one", () => {
    for (const event of ISRAEL_2026_EVENTS) {
      expect(hasOutOfBandWeek(event)).toBe(true);
      expect(weekMatches(event, "other")).toBe(true);
    }
    for (const event of FIXTURE_EVENTS) {
      expect(hasOutOfBandWeek(event)).toBe(false);
      expect(weekMatches(event, "other")).toBe(false);
    }
  });

  it("keeps the other three special buckets disjoint from 'other' — an offseason or Champs row is never swept into it", () => {
    const specials = makeArtifact([
      makeRow({ eventKey: "2026zoff", isOffseason: true, eventType: 99, week: 20 }),
      makeRow({ eventKey: "2026week0", eventType: 100, week: 20 }),
      makeRow({ eventKey: "2026cmptx", eventType: 3, week: 20 }),
      makeRow({ eventKey: "2026einstein", eventType: 4, week: 20 }),
    ]).events;
    for (const event of specials) {
      expect(hasOutOfBandWeek(event)).toBe(false);
    }
    expect(applyEventFilters(specials, { week: "other" })).toEqual([]);
    expect(filterOptions(specials).weeks).not.toContain("other");
  });
});

describe("filterOptions", () => {
  it("returns distinct non-null values per dimension, sorted for stable display", () => {
    const options = filterOptions(FIXTURE_EVENTS);
    // 2026-09-01: the fixture carries an offseason row, which now surfaces as
    // its own special week option after the numeric weeks.
    expect(options.weeks).toEqual([2, 3, "offseason"]);
    expect(options.countries).toEqual(["USA"]);
    expect(options.states).toEqual(["AL", "MI", "OH"]);
    expect(options.districts).toEqual(["fim"]);
  });

  it("excludes null entirely: a null-district event contributes no option, no empty string, and no Unknown entry", () => {
    const options = filterOptions(FIXTURE_EVENTS);
    expect(options.districts).not.toContain(null);
    expect(options.districts).not.toContain("");
    expect(options.districts.some((district) => district.toLowerCase().includes("unknown"))).toBe(false);
  });

  it("yields an empty option list for a dimension where every event's value is null", () => {
    const allNullDistrict = FIXTURE_EVENTS.map((event) => ({ ...event, districtKey: null }));
    const options = filterOptions(allNullDistrict);
    expect(options.districts).toEqual([]);
  });

  it("returns each distinct value exactly once regardless of how many events carry it", () => {
    const options = filterOptions(FIXTURE_EVENTS);
    expect(options.districts).toEqual(["fim"]); // two events share "fim"
  });
});

describe("applyEventFilters", () => {
  it("returns only events whose week strictly equals the filter value (adjacency edge)", () => {
    const result = applyEventFilters(FIXTURE_EVENTS, { week: 3 });
    expect(result.map((event) => event.eventKey).sort()).toEqual(["2025mimil", "2025mitry"]);
    // An event at week 2 (adjacent) is excluded, not just week 4.
    expect(result.some((event) => event.eventKey === "2025alhu")).toBe(false);
  });

  it("excludes an event with a null week from any week filter", () => {
    const result = applyEventFilters(FIXTURE_EVENTS, { week: 3 });
    expect(result.some((event) => event.week === null)).toBe(false);
  });

  it("returns every event unchanged, including events with null fields, when no filter is set", () => {
    const result = applyEventFilters(FIXTURE_EVENTS, {});
    expect(result).toHaveLength(FIXTURE_EVENTS.length);
  });

  it("returns the intersection, not the union, when two dimensions are set", () => {
    const result = applyEventFilters(FIXTURE_EVENTS, { week: 3, district: "fim" });
    expect(result.map((event) => event.eventKey).sort()).toEqual(["2025mimil", "2025mitry"]);
  });

  it("returns an empty array rather than falling back to everything when a value matches nothing", () => {
    const result = applyEventFilters(FIXTURE_EVENTS, { district: "no-such-district" });
    expect(result).toEqual([]);
  });

  it("never matches an event on a dimension where the event's value is null, for any filter value", () => {
    const result = applyEventFilters(FIXTURE_EVENTS, { district: "fim" });
    expect(result.some((event) => event.districtKey === null)).toBe(false);
  });

  it("excludes a null-district event while a district filter is active, distinct from the option-list case above", () => {
    const result = applyEventFilters(FIXTURE_EVENTS, { district: "fim" });
    const nullDistrictEvent = FIXTURE_EVENTS.find((event) => event.districtKey === null);
    expect(nullDistrictEvent).toBeDefined();
    expect(result).not.toContainEqual(nullDistrictEvent);
  });
});

describe("sortEvents", () => {
  it("orders by start date ascending and breaks ties by ascending event key", () => {
    const tiedDate = [
      makeRow({ eventKey: "2025zzzz", startDate: "2025-03-12" }),
      makeRow({ eventKey: "2025aaaa", startDate: "2025-03-12" }),
    ];
    const sorted = sortEvents(tiedDate, "startDate", "asc");
    expect(sorted.map((event) => event.eventKey)).toEqual(["2025aaaa", "2025zzzz"]);
  });

  it("is deterministic: calling it twice yields identical output", () => {
    const first = sortEvents(FIXTURE_EVENTS, "startDate", "asc");
    const second = sortEvents(FIXTURE_EVENTS, "startDate", "asc");
    expect(first.map((event) => event.eventKey)).toEqual(second.map((event) => event.eventKey));
  });

  it("returns an empty array unchanged", () => {
    expect(sortEvents([], "startDate", "asc")).toEqual([]);
  });

  it("returns a single event unchanged", () => {
    const single = [makeRow()];
    expect(sortEvents(single, "startDate", "asc")).toEqual(single);
  });

  it("does not mutate its input", () => {
    const input = [...FIXTURE_EVENTS];
    const originalOrder = input.map((event) => event.eventKey);
    sortEvents(input, "startDate", "desc");
    expect(input.map((event) => event.eventKey)).toEqual(originalOrder);
  });
});
