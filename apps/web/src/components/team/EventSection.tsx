import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { MetricValue } from "@/components/MetricValue";
import { TotalSigmaValue, totalColumnHeader } from "@/components/TotalSigmaValue";
import { metricKeysFor, TOTAL_KEY } from "../../lib/metricKeys.js";
import { METRIC_GROUPS } from "../../lib/metricGroups.js";
import { tierForPercentile } from "../../lib/tiers.js";
import { MatchTable } from "./MatchTable.js";
import type { AxisDomain, TeamSeasonEvent } from "./matchAxis.js";
import type { MetricHistoryRow } from "../../../../../packages/harness/metricHistorySchema.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";

/**
 * One event: heading, date, Upcoming badge, the team's end-of-event metric
 * snapshot, and its own horizontal scroll region. It recurs once per event
 * section, so every flex/grid ancestor of the scroller below carries
 * `min-w-0`, and the scroller itself is a single native `overflow-x-auto`
 * element with `touch-pan-xy` (a custom Tailwind utility for
 * `touch-action: pan-x pan-y pinch-zoom` — the plain `touch-pan-x` blocks
 * every vertical touch gesture starting here) / `overscroll-x-contain`,
 * never fused with the page's own vertical scroll.
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
   * This event's end-of-event Sigma Score, read from THE SAME history row
   * `endOfEventMetrics` resolved the Total from — so the tile's two halves
   * share one as-of instant. The season-final Sigma is never substituted
   * here; this component is not given `seasonStats` at all, which is the
   * same structural guarantee the tier comment below relies on.
   *
   * Gated on the row CARRYING the entry, never on `algorithmId`
   * (`sigmaScore.ts`'s own rule). Absent — every OPR/EPA row, and any
   * pre-republish SPR one — leaves the tile byte-identical to the plain
   * `MetricValue` it was before, its "Total" label included.
   *
   * A per-match sigma entry carries no `percentile` by design
   * (`metricHistorySchema.ts`), so the Sigma half renders UNTIERED. No tier
   * is invented for it, and it does not take the Alliances tab's `neutral`
   * treatment, which marks a three-team band rather than one team's own
   * untiered Sigma.
   */
  const snapshotSigma = snapshot?.metrics[SIGMA_METRIC_KEY];

  /** The per-event metric line's tiles. */
  const totalTile =
    snapshot === undefined
      ? undefined
      : {
          key: TOTAL_KEY,
          label: snapshotSigma === undefined ? "Total" : totalColumnHeader(algorithmId),
          metric: snapshot.metrics[TOTAL_KEY],
        };
  const groupTiles =
    snapshot === undefined || metricKeys.length <= 1
      ? []
      : METRIC_GROUPS.map((group) => ({ key: group.id, label: group.label, metric: snapshot.metrics[group.metricKey] }));

  return (
    <section
      data-testid={`event-section-${event.eventKey}`}
      className="event-card shadow-sm flex min-w-0 flex-col gap-[var(--spacing-sm)] p-[var(--spacing-lg)]"
    >
      <div className="flex min-w-0 items-center gap-[var(--spacing-sm)]">
        {/* The event name is the way INTO the event page, and it should
            look like one — accent ink + hover underline, the same
            obvious-link treatment as any nav link. */}
        <h2 className="text-role-heading min-w-0 truncate">
          <Link
            to="/event/$eventKey"
            params={{ eventKey: event.eventKey }}
            search={{ year: season, algorithm: algorithmId as PublishedAlgorithmId, tab: "insights" }}
            title={event.eventName}
            className="text-[var(--color-accent)] hover:underline"
          >
            {event.eventName}
          </Link>
        </h2>
        {isUpcoming && <Badge variant="secondary">Upcoming</Badge>}
      </div>
      <p className="flex items-center gap-[var(--spacing-xs)] text-role-body text-[var(--color-text-muted)]">
        <span>{event.startDate}</span>
        {/*
          The standing line, rendered ONLY when BOTH rank and totalTeams are
          present — a half-present pair (independently optional in the
          schema) never renders a partial standing. No Badge: a rank is
          data, not status. No fallback, no client-derived rank, no zero
          default.
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
        <div data-testid={`event-snapshot-${event.eventKey}`} className="flex min-w-0 flex-col gap-[var(--spacing-xs)]">
          {/*
            Same four-way grouping as the season header: Total leads on its
            own line, and Auto, Teleop and Endgame share the line below it.
            That line never wraps; below `sm` each label stacks over its
            value so the three still fit side by side on a phone.
          */}
          {totalTile?.metric !== undefined && (
            <span className="flex items-baseline gap-[var(--spacing-xs)]">
              <span className="text-role-label text-[var(--color-text-muted)]">{totalTile.label}</span>
              {/* `sigma` carries NO tier and NO `neutral` — see `snapshotSigma`'s
                  own comment above for why the right half stays untiered. */}
              <TotalSigmaValue
                total={totalTile.metric}
                totalTier={tierForPercentile(totalTile.metric.percentile)}
                sigma={snapshotSigma === undefined ? undefined : { value: snapshotSigma.value }}
              />
            </span>
          )}
          {groupTiles.some((tile) => tile.metric !== undefined) && (
            <div className="flex min-w-0 flex-nowrap items-end gap-x-[var(--spacing-sm)] sm:items-baseline sm:gap-x-[var(--spacing-md)]">
              {groupTiles.map((tile) => {
                if (tile.metric === undefined) return null;
                return (
                  <span key={tile.key} className="flex min-w-0 flex-col items-start gap-[var(--spacing-xs)] sm:flex-row sm:items-baseline">
                    <span className="text-role-label text-[var(--color-text-muted)]">{tile.label}</span>
                    {/*
                      The tier comes from THIS history row's own published
                      percentile — which ranks this as-of-this-event value
                      against the season's last-official-match field for that
                      metric (the ONE pool the Teams list and the season
                      header rank against, so an equal value carries an equal
                      tier on all three) — never from the team's own
                      season-level percentile/tier, which describes a
                      different value.

                      The caption that used to state this basis on every
                      event card was removed per user request (clutter, not
                      disagreement with the tiers themselves). The basis is
                      now DELIBERATELY NOT stated anywhere on this surface —
                      an accepted risk, not an oversight.
                    */}
                    <MetricValue metric={tile.metric} tier={tierForPercentile(tile.metric.percentile)} />
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div data-testid={`match-table-scroll-${event.eventKey}`} className="min-w-0 touch-pan-xy overflow-x-auto overscroll-x-contain">
        <MatchTable matches={event.matches} domain={domain} teamKey={teamKey} season={season} algorithm={algorithmId as PublishedAlgorithmId} />
      </div>
    </section>
  );
}
