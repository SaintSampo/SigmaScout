import { Badge } from "@/components/ui/badge";
import { MetricValue } from "@/components/MetricValue";
import { metricKeysFor } from "../../lib/metricKeys.js";
import { MatchTable } from "./MatchTable.js";
import type { AxisDomain, TeamSeasonEvent } from "./matchAxis.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";

/**
 * One event: heading, date, Upcoming badge, the team's end-of-event metric
 * snapshot, and its own horizontal scroll region (06-08-PLAN.md Task 2). This
 * is the highest-risk surface in the phase (D-10) — it recurs once per event
 * section, so every flex/grid ancestor of the scroller below carries
 * `min-w-0`, and the scroller itself is a single native `overflow-x-auto`
 * element with `touch-pan-x`/`overscroll-x-contain` (Tailwind utilities for
 * `touch-action: pan-x` / `overscroll-behavior-x: contain`), never fused with
 * the page's own vertical scroll.
 */
export interface EventSectionProps {
  event: TeamSeasonEvent;
  domain: AxisDomain;
  teamKey: string;
  algorithmId: string;
  season: number;
  metricHistory: readonly MetricHistoryRow[];
}

/**
 * The team's metrics AS CAPTURED WHEN THIS EVENT ENDED — the LAST
 * `metricHistory` row whose `eventKey` matches this event, never
 * `seasonStats.metrics` (the season-final values). `metricHistory` is
 * already this team's own array in chronological order (D-28), so the last
 * matching row IS the end-of-event snapshot; no re-sort needed. Returns
 * `undefined` for an event with only scheduled matches (no history row yet)
 * — the caller renders no snapshot at all rather than falling back to
 * current values.
 */
export function endOfEventMetrics(metricHistory: readonly MetricHistoryRow[], eventKey: string): MetricHistoryRow | undefined {
  let last: MetricHistoryRow | undefined;
  for (const row of metricHistory) {
    if (row.eventKey === eventKey) last = row;
  }
  return last;
}

export function EventSection({ event, domain, teamKey, algorithmId, season, metricHistory }: EventSectionProps) {
  const isUpcoming = event.matches.every((match) => match.actualWinner === undefined);
  const snapshot = endOfEventMetrics(metricHistory, event.eventKey);
  const metricKeys = metricKeysFor(algorithmId, season);

  return (
    <section
      data-testid={`event-section-${event.eventKey}`}
      className="event-card shadow-sm flex min-w-0 flex-col gap-[var(--spacing-sm)] p-[var(--spacing-lg)]"
    >
      <div className="flex min-w-0 items-center gap-[var(--spacing-sm)]">
        <h2 title={event.eventName} className="text-role-heading min-w-0 truncate text-[var(--color-text-primary)]">
          {event.eventName}
        </h2>
        {isUpcoming && <Badge variant="secondary">Upcoming</Badge>}
      </div>
      <p className="text-role-body text-[var(--color-text-muted)]">{event.startDate}</p>

      {snapshot !== undefined && (
        <div data-testid={`event-snapshot-${event.eventKey}`} className="flex min-w-0 flex-wrap items-baseline gap-[var(--spacing-md)]">
          <span className="text-role-label whitespace-nowrap text-[var(--color-text-muted)]">{"As of this event's end:"}</span>
          {metricKeys.map((key) => {
            const metric = snapshot.metrics[key];
            if (metric === undefined) return null;
            return (
              <span key={key} className="flex items-baseline gap-[var(--spacing-xs)]">
                <span className="text-role-label text-[var(--color-text-muted)]">{key}</span>
                <MetricValue metric={metric} />
              </span>
            );
          })}
        </div>
      )}

      <div data-testid={`match-table-scroll-${event.eventKey}`} className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain">
        <MatchTable matches={event.matches} domain={domain} teamKey={teamKey} />
      </div>
    </section>
  );
}
