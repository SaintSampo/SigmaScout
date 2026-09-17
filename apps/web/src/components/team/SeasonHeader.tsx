import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MetricValue } from "@/components/MetricValue";
import { TotalSigmaValue } from "@/components/TotalSigmaValue";
import { metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { METRIC_GROUPS, withDerivedGroupMetrics } from "@/lib/metricGroups";
import { tierForPercentile } from "@/lib/tiers";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";
import { RankCards } from "./RankCards.js";

export interface SeasonHeaderProps {
  artifact: TeamSeasonArtifact;
  /** `RankCards`' `/teams` links typecheck against this same type; every real caller passes `Route.useSearch().algorithm`. */
  algorithmId: PublishedAlgorithmId;
  season: number;
  teamNumber: number;
  /**
   * The LIVE `seasonStats` from `useLiveTeamSeason` (260917-jr4): the
   * published object with `record` and `metricsBasis` brought forward past
   * the last publish. Falls back to `artifact.seasonStats`, so a caller
   * without a live view renders exactly what it rendered before.
   */
  seasonStats?: TeamSeasonArtifact["seasonStats"];
  /** The last-official-match snapshot metrics (lib/officialSnapshot.ts), when the route could derive one — season-final values render otherwise. */
  metricsOverride?: TeamSeasonArtifact["metricHistory"][number]["metrics"];
  /** The `matchKey` of the row `metricsOverride` came from. Not currently consumed here; kept as the as-of instant alongside `metricsOverride`. */
  snapshotMatchKey?: string;
  /** This team's World/Country/District/State rank scopes, threaded to `RankCards` — see that module for the graceful-absence contract (undefined/empty both render nothing). */
  ranks?: TeamSeasonArtifact["ranks"];
}

/** Copied from `teams-table/columns.tsx`'s own `formatRecord` — do not import across the teams-table module boundary. */
function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}-${record.losses}-${record.ties}`;
}

/** Copied from `teams-table/columns.tsx`'s own `formatWinRate` — same signature (a nullable fraction), so the zero-match "—" case matches the Teams table exactly. */
function formatWinRate(value: number | null): string {
  if (value === null) return "";
  return `${(value * 100).toFixed(1)}%`;
}

/** One labelled, tier-boxed metric tile; the box hugs its value like every other metric cell on the site. */
function MetricGridCell({ tile }: { tile: { label: string; metric?: TeamSeasonArtifact["seasonStats"]["metrics"][string] } }) {
  return (
    <div data-testid="metric-grid-cell" className="flex min-w-0 flex-col items-start gap-[var(--spacing-xs)]">
      <span className="text-role-label text-[var(--color-text-muted)]">{tile.label}</span>
      <MetricValue metric={tile.metric} tier={tierForPercentile(tile.metric?.percentile)} />
    </div>
  );
}

/** A rate over zero matches is undefined, never a coerced zero — same rule `teams-table/rowModel.ts`'s own `winRate()` applies. */
function winRateOf(record: { wins: number; losses: number; ties: number }): number | null {
  const totalMatches = record.wins + record.losses + record.ties;
  if (totalMatches === 0) return null;
  return record.wins / totalMatches;
}

/** Copied from `teams-table/columns.tsx`'s own `metricLabel` — same convention (raw key, "Total" for the one guaranteed key) so the header grid never shows a label the Teams table doesn't also show. */
function metricLabel(key: string): string {
  return key === TOTAL_KEY ? "Total" : key;
}

/**
 * The team-page identity block: team number (the page's primary focal
 * point), nickname (falling back to `Team {teamNumber}` when empty, truncated
 * by CSS ellipsis with a `title` attribute, never by slicing the string), the
 * robot image (or an honest fallback tile for the no-photo case), a "View on
 * TBA" link, the record/win-rate strings (official play only — offseason and
 * preseason results are excluded from these two, and from them alone), and
 * the tier-boxed metric grid.
 */
export function SeasonHeader({ artifact, algorithmId, season, teamNumber, seasonStats, metricsOverride, snapshotMatchKey, ranks }: SeasonHeaderProps) {
  const nickname = artifact.nickname === "" ? `Team ${teamNumber}` : artifact.nickname;
  const resolvedSeasonStats = seasonStats ?? artifact.seasonStats;
  const { record } = resolvedSeasonStats;
  // Tiles read the last-official-match snapshot when the route could derive
  // one; season-final otherwise. Each snapshot metric carries its own
  // published percentile, ranked against the one season ranking pool (every
  // team's last official match) that the Teams list and seasonStats use, so
  // a tile and the Teams list cannot disagree about a tier.
  const resolvedMetrics = metricsOverride ?? resolvedSeasonStats.metrics;
  // Widened with any derivable group entries this algorithm/season supports,
  // before the tiles read it — a no-op once the pipeline already publishes an
  // algorithm's own group metrics; still needed for a stale cached artifact
  // that has components but no published group entry yet. See
  // lib/metricGroups.ts's header for the full honesty argument.
  const metrics = withDerivedGroupMetrics(resolvedMetrics, season);
  // Column set is derived from (algorithm, season) only, never from
  // inspecting `metrics` itself — a row missing a declared component renders
  // a blank cell and the cell never disappears.
  const metricKeys = metricKeysFor(algorithmId, season);
  // The headline grid shows four tiles — Auto, Teleop, Endgame, Total —
  // rather than one per raw component. An algorithm publishing only Total
  // (OPR) has no components to group, so it shows the single Total tile
  // rather than three tiles that could never be anything but blank.
  const publishesComponents = metricKeys.length > 1;
  // Each phase group tile reads `metrics[group.metricKey]` — a published
  // metric read straight from the artifact, never summed here, except in the
  // stale-artifact case where it is a derived entry from
  // `withDerivedGroupMetrics` above. `tierForPercentile(undefined)` yields no
  // tier for a derived tile — the honest outcome for stale data.
  //
  // Sigma renders as the right half of a joined split pill
  // (`TotalSigmaValue`) beside the Total tile, instead of a separate tile or
  // a `±` suffix. Its value/tier are read from `artifact.seasonStats.metrics`
  // directly, never from the resolved `metrics` above: `metricsOverride`
  // (when present) is the last official-match row's metrics, but this header
  // wants the season-final, tiered Sigma figure — a per-match sigma entry has
  // no percentile and so no tier, and reading it here would make the pill's
  // tier disappear whenever the route supplies an override. Sigma is
  // therefore season-final while the tiles beside it may be the
  // last-official-match snapshot, the same as-of pairing the Teams row
  // already publishes. Absent entry (every OPR and EPA artifact, or a
  // pre-republish SPR one) means the Total tile degrades to a plain single
  // box — `TotalSigmaValue` is byte-identical to `MetricValue` whenever
  // `sigma` is `undefined`.
  const seasonSigmaMetric = resolvedSeasonStats.metrics[SIGMA_METRIC_KEY];
  const seasonSigmaScore = seasonSigmaMetric?.value;
  const seasonSigmaTier = tierForPercentile(seasonSigmaMetric?.percentile);
  const groupTiles = publishesComponents
    ? METRIC_GROUPS.map((group) => ({ key: group.id, label: group.label, metric: metrics[group.metricKey] }))
    : [];
  // The tile's label names Sigma only when the pill actually renders — never
  // when this algorithm/team carries none, so the label never over-promises.
  const totalLabel = seasonSigmaScore !== undefined ? "Total ± Sigma" : metricLabel(TOTAL_KEY);
  const totalMetric = metrics[TOTAL_KEY];
  const tbaUrl = `https://www.thebluealliance.com/team/${teamNumber}`;

  return (
    <div className="flex min-w-0 flex-col gap-[var(--spacing-md)]">
      {/*
        `flex-wrap items-start justify-between`: the rank cards (second
        child) are pushed to the row's right edge at wide widths and wrap
        below the identity block (first child, which keeps its own `min-w-0`
        so the nickname still truncates) at narrow ones. Renders identically
        when `ranks` is absent/empty, since `RankCards` then renders nothing.
      */}
      <div className="flex flex-wrap items-start justify-between gap-[var(--spacing-md)]">
        <div className="flex min-w-0 items-center gap-[var(--spacing-md)]">
          {/*
            `Avatar`'s own built-in error-triggered fallback slot is what
            makes the no-photo case a rendering branch rather than a
            conditional tree: `AvatarImage` only renders when
            `robotImageUrl` is present, and Radix swaps to `AvatarFallback`
            on any load failure. The fallback tile is decorative chrome
            carrying no visible text, only `role="img"` and an accessible
            label naming the team.
          */}
          <Avatar className="size-28 shrink-0 rounded-[var(--radius)] after:rounded-[var(--radius)]">
            {artifact.robotImageUrl !== undefined && (
              <AvatarImage src={artifact.robotImageUrl} alt={`${nickname} robot photo`} className="rounded-[var(--radius)]" />
            )}
            <AvatarFallback
              role="img"
              aria-label={`No robot photo available for team ${teamNumber}`}
              className="rounded-[var(--radius)] bg-[var(--color-bg-surface)]"
            />
          </Avatar>
          <div className="flex min-w-0 flex-col gap-[var(--spacing-sm)]">
            <div className="flex min-w-0 items-baseline gap-[var(--spacing-md)]">
              <span className="numeric-cell text-role-display shrink-0 text-[var(--color-text-primary)]">{`#${teamNumber}`}</span>
              {/* The page's one semantic <h1> — the team's identity is the page title, even though the team number is the larger, Display-scale visual focal point. */}
              <h1 title={nickname} className="text-role-heading min-w-0 truncate text-[var(--color-text-primary)]">
                {nickname}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-[var(--spacing-md)]">
              <span data-testid="team-record" className="numeric-cell text-role-body text-[var(--color-text-primary)]">
                {formatRecord(record)}
              </span>
              <span className="numeric-cell text-role-body text-[var(--color-text-muted)]">{formatWinRate(winRateOf(record))}</span>
              {/* The record is `artifact.seasonStats.record`, scoped to
                  official play (`teamStatsOfficial`) — the same population the
                  metric tiles below are snapshotted from. This does not mean
                  offseason and preseason play is hidden: it stays fully
                  visible in the match table, event sections and
                  metric-history chart — only the summary record is scoped. */}
              <span data-testid="team-record-basis" className="text-role-label text-[var(--color-text-muted)]">
                Official events only
              </span>
              {/* Built from the team number, not the internal corpus key. */}
              <a
                href={tbaUrl}
                target="_blank"
                rel="noopener"
                className="text-role-body text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                View on TBA
              </a>
            </div>
          </div>
        </div>
        {/*
          The World card is tiered by the published seasonStats Total
          percentile — deliberately not the resolved `metricsOverride` row.
          seasonStats is the record measured equal to the Teams list; before a
          republish, history rows still carry the old season-final-pool
          percentile.
        */}
        <RankCards ranks={ranks} season={season} algorithmId={algorithmId} worldPercentile={artifact.seasonStats.metrics[TOTAL_KEY]?.percentile} />
      </div>

      <div className="flex flex-col gap-[var(--spacing-sm)]">
        {/*
          A tier-boxed metric grid: one cell per declared metric key, Total
          included (unlike the Teams table's sorted, unboxed Total column).
          The grid reflows to fewer columns at narrow widths rather than
          becoming a scroll region — every cell is a bounded numeric, so
          nothing can force horizontal overflow.
        */}
        {/* The tiles below can be one of two different as-of instants — the
            team's last official-match snapshot, or the season-final values —
            and the block must never be unlabelled in either state.
            `metricsOverride !== undefined` is a trustworthy signal because
            the route no longer falls back to season-final values before
            passing this prop. */}
        <span data-testid="season-header-as-of" className="text-role-label text-[var(--color-text-muted)]">
          {metricsOverride !== undefined ? "As of last official match" : "Season-final (includes offseason/preseason play)"}
        </span>
        {/* Left-justified with fixed gaps. Total leads on its own line, and
            Auto, Teleop and Endgame follow together on the line below. The
            phase line never wraps; it tightens its gap on narrow screens
            instead, so the three always read as one group. */}
        <div data-testid="season-header-metric-grid" className="flex flex-col gap-[var(--spacing-sm)]">
          <div className="flex flex-wrap gap-x-[var(--spacing-2xl)] gap-y-[var(--spacing-sm)]">
            {/*
              The Total tile renders the joined split pill
              (`TotalSigmaValue`) instead of `MetricGridCell` plus a separate
              Sigma tile. The pill's Sigma half is
              `seasonSigmaScore`/`seasonSigmaTier`, defined above — see that
              derivation's own comment for why it must not read the resolved
              (possibly snapshot) `metrics` instead.
            */}
            <div data-testid="metric-grid-cell" className="flex min-w-0 flex-col items-start gap-[var(--spacing-xs)]">
              <span className="text-role-label text-[var(--color-text-muted)]">{totalLabel}</span>
              <TotalSigmaValue
                total={totalMetric}
                totalTier={tierForPercentile(totalMetric?.percentile)}
                sigma={seasonSigmaScore !== undefined ? { value: seasonSigmaScore, tier: seasonSigmaTier } : undefined}
              />
            </div>
          </div>
          {groupTiles.length > 0 && (
            <div className="flex min-w-0 flex-nowrap gap-x-[var(--spacing-md)] sm:gap-x-[var(--spacing-2xl)]">
              {groupTiles.map((tile) => (
                <MetricGridCell key={tile.key} tile={tile} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
