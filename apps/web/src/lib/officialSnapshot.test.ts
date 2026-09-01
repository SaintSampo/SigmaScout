import { describe, expect, it } from "vitest";
import { officialSnapshotMetrics } from "./officialSnapshot.js";
import type { EventsArtifact, TeamSeasonArtifact } from "../../../../packages/harness/pageArtifacts.js";

type HistoryRow = TeamSeasonArtifact["metricHistory"][number];
type EventRow = EventsArtifact["events"][number];

function historyRow(eventKey: string, total: number, matchIndex: number): HistoryRow {
  return { matchKey: `${eventKey}_qm${matchIndex}`, season: 2026, eventKey, algorithmId: "vpr", teamKey: "frc118", matchIndex, metrics: { total: { value: total } } } as HistoryRow;
}

function eventRow(eventKey: string, overrides: Partial<EventRow> = {}): EventRow {
  return { eventKey, name: eventKey, eventType: 0, isOffseason: false, startDate: "2026-03-01", week: 0, teamCount: 30, matchCount: 60, playedMatchCount: 60, country: "USA", stateProv: "NC", districtKey: null, ...overrides } as EventRow;
}

describe("officialSnapshotMetrics", () => {
  it("returns the LAST row from an official event, skipping later offseason and preseason rows", () => {
    const history = [
      historyRow("2026ncca", 40, 0),
      historyRow("2026ncca", 45, 1),
      historyRow("2026offx", 60, 2), // offseason, later — must not win
      historyRow("2026prez", 70, 3), // preseason week-0, later — must not win
    ];
    const events = [eventRow("2026ncca"), eventRow("2026offx", { isOffseason: true, eventType: 99 }), eventRow("2026prez", { eventType: 100 })];
    expect(officialSnapshotMetrics(history, events)?.total?.value).toBe(45);
  });

  it("championship divisions count as official", () => {
    const history = [historyRow("2026ncca", 40, 0), historyRow("2026arc", 55, 1)];
    const events = [eventRow("2026ncca"), eventRow("2026arc", { eventType: 3, week: null })];
    expect(officialSnapshotMetrics(history, events)?.total?.value).toBe(55);
  });

  it("returns undefined for an offseason-only team, so the caller falls back to season-final", () => {
    const history = [historyRow("2026offx", 60, 0)];
    const events = [eventRow("2026offx", { isOffseason: true, eventType: 99 })];
    expect(officialSnapshotMetrics(history, events)).toBeUndefined();
  });
});
