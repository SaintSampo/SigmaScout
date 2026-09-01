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

type MetricHistoryRows = TeamSeasonArtifact["metricHistory"];
type EventRows = EventsArtifact["events"];

/** True for an event that is part of the official season: not offseason (99 rides `isOffseason`) and not preseason week-0 (100). Championship divisions/Einstein are official. */
function isOfficialEvent(row: EventRows[number]): boolean {
  return !row.isOffseason && row.eventType !== 100;
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
