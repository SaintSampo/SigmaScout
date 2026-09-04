/**
 * The team header's last-OFFICIAL-match snapshot (2026-09-01 user request):
 * the top-of-page Auto/Teleop/Endgame/Total tiles should show the team's
 * stats as calculated after their last OFFICIAL match — not the
 * season-final values, which keep learning through offseason (eventType 99)
 * and preseason "Week 0" (eventType 100) play.
 *
 * `metricHistory` rows carry each metric AFTER each match in chronological
 * order (D-28), so the snapshot is simply the LAST row whose event is
 * official — the same walk-forward-state reading `EventSection.tsx`'s
 * `endOfEventMetrics` established, scoped to official events. The team
 * artifact carries no per-event officialness flag; the events/{year}
 * artifact does, so the caller passes its rows.
 *
 * Returns `undefined` when the team has no official rows at all (an
 * offseason-only team) — the caller falls back to season-final values
 * rather than rendering an empty header.
 */
import type { EventsArtifact, TeamSeasonArtifact } from "../../../../packages/harness/pageArtifacts.js";
import { isOfficialEventType } from "../../../../packages/core/algorithms/eventTypes.js";

type MetricHistoryRows = TeamSeasonArtifact["metricHistory"];
type EventRows = EventsArtifact["events"];

/**
 * True for an event that is part of the official season. Delegates to the
 * shared `isOfficialEventType` predicate (quick task 260904-586) for the
 * `eventType` check, but KEEPS the pre-existing `!row.isOffseason` conjunct
 * alongside it — a published events artifact whose two fields ever disagree
 * (e.g. `isOffseason: true` with an `eventType` outside 99/100) still
 * resolves the conservative way, so this file's current behaviour is
 * preserved bit-for-bit. Championship divisions/Einstein are official.
 */
function isOfficialEvent(row: EventRows[number]): boolean {
  return !row.isOffseason && isOfficialEventType(row.eventType);
}

export function officialSnapshotMetrics(
  metricHistory: MetricHistoryRows,
  eventRows: EventRows,
): MetricHistoryRows[number]["metrics"] | undefined {
  const officialKeys = new Set(eventRows.filter(isOfficialEvent).map((row) => row.eventKey));
  let last: MetricHistoryRows[number] | undefined;
  for (const row of metricHistory) {
    if (officialKeys.has(row.eventKey)) last = row;
  }
  return last?.metrics;
}
