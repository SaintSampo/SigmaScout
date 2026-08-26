import { Badge } from "@/components/ui/badge";
import { MetricValue } from "@/components/MetricValue";
import { metricKeysFor, TOTAL_KEY } from "../../lib/metricKeys.js";
import { METRIC_GROUPS } from "../../lib/metricGroups.js";
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
          {/*
            Same four-way grouping as the season header: this line previously
            spilled all 13 of 2024's raw components across three wrapped rows.
          */}
          {[
            ...METRIC_GROUPS.map((group) => ({
              key: group.id,
              label: group.label,
              metric: metricKeys.length > 1 ? snapshot.metrics[group.metricKey] : undefined,
            })),
            { key: TOTAL_KEY, label: "Total", metric: snapshot.metrics[TOTAL_KEY] },
          ].map((tile) => {
            if (tile.metric === undefined) return null;
            return (
              <span key={tile.key} className="flex items-baseline gap-[var(--spacing-xs)]">
                <span className="text-role-label text-[var(--color-text-muted)]">{tile.label}</span>
                {/*
                  No rarity tier here yet. `MetricHistoryRowSchema.metrics`
                  publishes only { value, spread } — a history row carries no
                  percentile, because the percentile pass ranks SEASON-FINAL
                  values. Tiering an as-of-this-event value with the
                  season-final percentile would colour a number by a rank it
                  does not have. See F-06-3.
                */}
                <MetricValue metric={tile.metric} />
              </span>
            );
          })}
        </div>
      )}

      <div data-testid={`match-table-scroll-${event.eventKey}`} className="min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain">
        <MatchTable matches={event.matches} domain={domain} teamKey={teamKey} season={season} />
      </div>
    </section>
  );
}
