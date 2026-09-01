import { Badge } from "@/components/ui/badge";
import { MetricValue } from "@/components/MetricValue";
import { metricKeysFor, TOTAL_KEY } from "../../lib/metricKeys.js";
import { METRIC_GROUPS } from "../../lib/metricGroups.js";
import { tierForPercentile } from "../../lib/tiers.js";
import { MatchTable } from "./MatchTable.js";
import type { AxisDomain, TeamSeasonEvent } from "./matchAxis.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";

/**
 * One event: heading, date, Upcoming badge, the team's end-of-event metric
 * snapshot, and its own horizontal scroll region (06-08-PLAN.md Task 2). This
 * is the highest-risk surface in the phase (D-10) — it recurs once per event
 * section, so every flex/grid ancestor of the scroller below carries
 * `min-w-0`, and the scroller itself is a single native `overflow-x-auto`
 * element with `touch-pan-xy`/`overscroll-x-contain` (07-UAT.md G-4: a
 * custom Tailwind utility for `touch-action: pan-x pan-y pinch-zoom` — the
 * plain `touch-pan-x` this used to carry blocked every vertical touch
 * gesture starting here — / `overscroll-behavior-x: contain`), never fused
 * with the page's own vertical scroll.
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

  /**
   * D-06.1-A (plan 06.1-06, Task 3): the per-event metric line's tiles.
   */
  const tiles =
    snapshot === undefined
      ? []
      : [
          ...METRIC_GROUPS.map((group) => ({
            key: group.id,
            label: group.label,
            metric: metricKeys.length > 1 ? snapshot.metrics[group.metricKey] : undefined,
          })),
          { key: TOTAL_KEY, label: "Total", metric: snapshot.metrics[TOTAL_KEY] },
        ];

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
      <p className="flex items-center gap-[var(--spacing-xs)] text-role-body text-[var(--color-text-muted)]">
        <span>{event.startDate}</span>
        {/*
          TEAM-04/F-06-3 (plan 06.1-01): the standing line, rendered ONLY
          when BOTH rank and totalTeams are present — a half-present pair
          (TeamSeasonEventSchema declares them independently optional) never
          renders a partial standing. No Badge (PD-03): a rank is data, not
          status. No fallback, no client-derived rank, no zero default — see
          this plan's must_haves.prohibitions.
        */}
        {event.rank !== undefined && event.totalTeams !== undefined && (
          <>
            <span aria-hidden="true">&middot;</span>
            <span data-testid={`event-standing-${event.eventKey}`} className="text-[var(--color-text-primary)]">
              Rank {event.rank} of {event.totalTeams}
            </span>
          </>
        )}
      </p>

      {snapshot !== undefined && (
        <div data-testid={`event-snapshot-${event.eventKey}`} className="flex min-w-0 flex-wrap items-baseline gap-[var(--spacing-md)]">
          {/*
            Same four-way grouping as the season header: this line previously
            spilled all 13 of 2024's raw components across three wrapped rows.
          */}
          {tiles.map((tile) => {
            if (tile.metric === undefined) return null;
            return (
              <span key={tile.key} className="flex items-baseline gap-[var(--spacing-xs)]">
                <span className="text-role-label text-[var(--color-text-muted)]">{tile.label}</span>
                {/*
                  D-06.1-A (plan 06.1-06, Task 3): the tier comes from THIS
                  history row's own published percentile
                  (`MetricValueSchema.percentile`, plan 06.1-03/06.1-05) —
                  which ranks this as-of-this-event value against the
                  SEASON-FINAL field for that metric — never from the team's
                  season-final `TeamMetricSchema.percentile`/`tier`. That
                  substitution (an as-of-then value tiered by an as-of-then
                  rank) is exactly the defect F-06-3 was filed to prevent.

                  G-06.1-28 (plan 06.1-08, Task 1, option-a): the caption that
                  used to state this basis on every event card was removed
                  per user request (UAT test 28 — clutter, not disagreement
                  with the tiers themselves). The basis is now DELIBERATELY
                  NOT stated anywhere on this surface — a signed accepted
                  risk (T-06.1-24, signed Jacob Williams, 2026-08-26; the
                  full disposition lives in that plan's threat register), not
                  an oversight. A future reader who wants to relocate the
                  explanation should start there, not assume it was dropped
                  by mistake.
                */}
                <MetricValue metric={tile.metric} tier={tierForPercentile(tile.metric.percentile)} />
              </span>
            );
          })}
        </div>
      )}

      <div data-testid={`match-table-scroll-${event.eventKey}`} className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <MatchTable matches={event.matches} domain={domain} teamKey={teamKey} season={season} />
      </div>
    </section>
  );
}
