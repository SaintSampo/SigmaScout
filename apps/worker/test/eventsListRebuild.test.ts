/**
 * The events-list rebuild's pure pieces (quick task 261024-jdz). The driven,
 * end-to-end half lives in `scheduled.phaseBWrites.test.ts`, which runs the real
 * `runTick`; this file pins the three functions a refactor could break without
 * any tick-level case noticing.
 */
import { describe, expect, it } from "vitest";
import { eventsListCountsOf, patchEventsListRows, recordEventsListCounts, type EventsListFeed } from "../src/eventsListRebuild.js";

function row(eventKey: string, overrides: Record<string, unknown> = {}) {
  return {
    eventKey,
    name: `Name of ${eventKey}`,
    eventType: 99,
    isOffseason: true,
    startDate: "2026-10-24",
    week: null,
    teamCount: 0,
    matchCount: 0,
    playedMatchCount: 0,
    country: "USA",
    stateProv: "CA",
    districtKey: null,
    ...overrides,
  };
}

describe("eventsListCountsOf", () => {
  it("counts played rows, played plus upcoming, and the union of every team over both", () => {
    const written = {
      matches: [
        { redTeams: ["frc1", "frc2", "frc3"], blueTeams: ["frc4", "frc5", "frc6"] },
        { redTeams: ["frc1", "frc4", "frc7"], blueTeams: ["frc2", "frc5", "frc8"] },
      ],
      upcoming: [{ redTeams: ["frc9", "frc1", "frc2"], blueTeams: ["frc3", "frc4", "frc5"] }],
    };
    expect(eventsListCountsOf(written)).toEqual({ playedMatchCount: 2, matchCount: 3, teamCount: 9 });
  });

  it("returns all zeros for empty arrays", () => {
    expect(eventsListCountsOf({ matches: [], upcoming: [] })).toEqual({ playedMatchCount: 0, matchCount: 0, teamCount: 0 });
  });

  it("returns undefined when upcoming is missing, so a malformed write never zeroes a row", () => {
    expect(eventsListCountsOf({ matches: [{ redTeams: ["frc1"], blueTeams: ["frc2"] }] })).toBeUndefined();
  });

  it("returns undefined for a non-object", () => {
    expect(eventsListCountsOf(undefined)).toBeUndefined();
    expect(eventsListCountsOf("nope")).toBeUndefined();
  });
});

describe("patchEventsListRows", () => {
  it("gives a fed row the three counts and keeps every publisher field", () => {
    const rows = [row("2026a")];
    const result = patchEventsListRows(rows, new Map([["2026a", { matchCount: 3, playedMatchCount: 1, teamCount: 6 }]]));
    expect(result.changed).toBe(true);
    expect(result.missingEventKeys).toEqual([]);
    expect(result.rows[0]).toEqual({ ...rows[0], matchCount: 3, playedMatchCount: 1, teamCount: 6 });
  });

  it("returns an unfed row as the same object", () => {
    const fed = row("2026a");
    const unfed = row("2026b");
    const result = patchEventsListRows([fed, unfed], new Map([["2026a", { matchCount: 1, playedMatchCount: 1, teamCount: 6 }]]));
    expect(result.rows[1]).toBe(unfed);
  });

  it("reports changed false when the counts already match", () => {
    const rows = [row("2026a", { matchCount: 3, playedMatchCount: 1, teamCount: 6 })];
    const result = patchEventsListRows(rows, new Map([["2026a", { matchCount: 3, playedMatchCount: 1, teamCount: 6 }]]));
    expect(result.changed).toBe(false);
  });

  it("lists a fed key with no row in missingEventKeys, sorted, and appends nothing", () => {
    const rows = [row("2026a")];
    const result = patchEventsListRows(
      rows,
      new Map([
        ["2026z", { matchCount: 1, playedMatchCount: 0, teamCount: 6 }],
        ["2026m", { matchCount: 1, playedMatchCount: 0, teamCount: 6 }],
      ])
    );
    expect(result.missingEventKeys).toEqual(["2026m", "2026z"]);
    expect(result.rows).toHaveLength(1);
    expect(result.changed).toBe(false);
  });
});

describe("recordEventsListCounts", () => {
  const counts = (n: number) => ({ matchCount: n, playedMatchCount: n, teamCount: 6 });

  it("keeps two events recorded under one composite key", () => {
    const feed: EventsListFeed = new Map();
    recordEventsListCounts(feed, "opr::2026", "opr", 2026, "2026a", counts(1));
    recordEventsListCounts(feed, "opr::2026", "opr", 2026, "2026b", counts(2));
    const entry = feed.get("opr::2026")!;
    expect(entry.algorithmId).toBe("opr");
    expect(entry.season).toBe(2026);
    expect([...entry.counts.keys()]).toEqual(["2026a", "2026b"]);
  });

  it("replaces an earlier record for the same event", () => {
    const feed: EventsListFeed = new Map();
    recordEventsListCounts(feed, "opr::2026", "opr", 2026, "2026a", counts(1));
    recordEventsListCounts(feed, "opr::2026", "opr", 2026, "2026a", counts(2));
    expect(feed.get("opr::2026")!.counts.get("2026a")).toEqual(counts(2));
  });
});
