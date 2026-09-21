import { describe, expect, it } from "vitest";
import { discoveredTeamEvents, windowsToCheck } from "./liveDiscovery";
import type { LiveRoster } from "../../../../packages/harness/liveRoster.js";

const NOW = Date.parse("2026-09-26T15:00:00.000Z");
const HOUR = 3_600_000;
const win = (eventKey: string, season: number, startMs: number, endMs: number) => ({ eventKey, season, startMs, endMs, inferred: true });
const roster = (eventKey: string, teams: string[], extra: Partial<LiveRoster> = {}): LiveRoster => ({
  schemaVersion: 1,
  eventKey,
  season: 2026,
  teams,
  computedAt: "2026-09-26T14:00:00.000Z",
  ...extra,
});

describe("windowsToCheck", () => {
  const windows = [
    win("2026open", 2026, NOW - HOUR, NOW + HOUR),
    win("2026known", 2026, NOW - HOUR, NOW + HOUR),
    win("2026later", 2026, NOW + 24 * HOUR, NOW + 48 * HOUR),
    win("2026over", 2026, NOW - 48 * HOUR, NOW - 24 * HOUR),
    win("2025open", 2025, NOW - HOUR, NOW + HOUR),
  ];

  it("is only windows open NOW, for this season, that the team's own file does not already name", () => {
    expect(windowsToCheck({ windows, season: 2026, knownEventKeys: new Set(["2026known"]), nowMs: NOW })).toEqual(["2026open"]);
  });

  it("is empty outside an event weekend, so an ordinary robot page fetches no roster at all", () => {
    expect(windowsToCheck({ windows, season: 2026, knownEventKeys: new Set(), nowMs: NOW + 12 * HOUR })).toEqual([]);
    expect(windowsToCheck({ windows: [], season: 2026, knownEventKeys: new Set(), nowMs: NOW })).toEqual([]);
  });

  it("a past season's page discovers nothing, whatever is open today", () => {
    expect(windowsToCheck({ windows, season: 2024, knownEventKeys: new Set(), nowMs: NOW })).toEqual([]);
  });
});

describe("discoveredTeamEvents", () => {
  it("adds an event whose roster names the team, in the published event shape with no matches of its own", () => {
    const events = discoveredTeamEvents({
      teamKey: "frc254",
      knownEventKeys: new Set(),
      rosters: [roster("2026txrm", ["frc118", "frc254"], { eventName: "The Remix", startDate: "2026-09-19" })],
    });
    expect(events).toEqual([{ eventKey: "2026txrm", eventName: "The Remix", startDate: "2026-09-19", matches: [] }]);
  });

  it("ignores a roster without the team, an absent, pending or failed roster, an already known event and a duplicate", () => {
    const events = discoveredTeamEvents({
      teamKey: "frc254",
      knownEventKeys: new Set(["2026known"]),
      rosters: [roster("2026other", ["frc1"]), null, undefined, roster("2026known", ["frc254"]), roster("2026a", ["frc254"]), roster("2026a", ["frc254"])],
    });
    expect(events.map((e) => e.eventKey)).toEqual(["2026a"]);
  });

  it("falls back to the event key for a name the Worker did not know, and orders by start date then key", () => {
    const events = discoveredTeamEvents({
      teamKey: "frc254",
      knownEventKeys: new Set(),
      rosters: [roster("2026b", ["frc254"], { startDate: "2026-10-03" }), roster("2026a", ["frc254"], { startDate: "2026-09-26" })],
    });
    expect(events.map((e) => [e.eventKey, e.eventName])).toEqual([
      ["2026a", "2026a"],
      ["2026b", "2026b"],
    ]);
  });
});
