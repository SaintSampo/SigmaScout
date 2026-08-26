import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MetricValue } from "@/components/MetricValue";
import { metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { groupedMetric, METRIC_GROUPS } from "@/lib/metricGroups";
import { tierForPercentile } from "@/lib/tiers";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

/**
 * One of the two composition seams `OverviewTab.tsx` freezes this task
 * (06-01-PLAN.md Task 2) — plan 06-07 fills in the rest of the season header
 * (robot image, TBA link, D-17's tier-boxed metric grid) without editing
 * this prop contract or `OverviewTab.tsx`.
 */
export interface SeasonHeaderProps {
  artifact: TeamSeasonArtifact;
  algorithmId: string;
  season: number;
  teamNumber: number;
}

/** Copied from `apps/web/src/components/teams-table/columns.tsx`'s own `formatRecord` — do not import across the teams-table module boundary (06-PATTERNS.md). */
function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}-${record.losses}-${record.ties}`;
}

/** Copied from `apps/web/src/components/teams-table/columns.tsx`'s own `formatWinRate` — same signature (a nullable fraction, not a record), so the zero-match "—" case matches the Teams table exactly. */
function formatWinRate(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/** A rate over zero matches is undefined, never a coerced zero — same rule `teams-table/rowModel.ts`'s own `winRate()` applies. */
function winRateOf(record: { wins: number; losses: number; ties: number }): number | null {
  const totalMatches = record.wins + record.losses + record.ties;
  if (totalMatches === 0) return null;
  return record.wins / totalMatches;
}

/** Copied from `apps/web/src/components/teams-table/columns.tsx`'s own `metricLabel` — same convention (raw key, "Total" for the one guaranteed key) so the header grid never invents a friendlier label the Teams table doesn't also show (D-17: "the same numbers the Teams table showed, so nothing changes meaning on click-through"). */
function metricLabel(key: string): string {
  return key === TOTAL_KEY ? "Total" : key;
}

/**
 * The team-page identity block (06-01-PLAN.md Task 2's frozen shell, filled
 * in by 06-07-PLAN.md Task 2): team number (Display 28/600, the page's
 * primary focal point per 06-UI-SPEC.md's Visual Hierarchy), nickname
 * (falling back to `Team {teamNumber}` when empty, truncated by CSS
 * ellipsis with a `title` attribute — never by slicing the string), the
 * robot image (or an honest fallback tile for the ~25% no-photo case,
 * D-03), a "View on TBA" link, the record/win-rate strings, D-17's tier key
 * row, and the tier-boxed metric grid.
 */
export function SeasonHeader({ artifact, algorithmId, season, teamNumber }: SeasonHeaderProps) {
  const nickname = artifact.nickname === "" ? `Team ${teamNumber}` : artifact.nickname;
  const { record, metrics } = artifact.seasonStats;
  // Column set is derived from (algorithm, season) ONLY, never from
  // inspecting `metrics` itself — a row missing a declared component
  // renders an em-dash cell and the cell never disappears (D-17/E2 empty).
  const metricKeys = metricKeysFor(algorithmId, season);
  // The headline grid shows four tiles — Auto, Teleop, Endgame, Total —
  // rather than one per raw component (13 in 2024, 11 in 2026). OPR
  // publishes only Total and has no components to group, so it keeps its
  // single tile and the phase groups resolve to `undefined` (em-dash).
  // An algorithm publishing only Total (OPR) has no components to group, so
  // it shows the single Total tile rather than three tiles that could never
  // be anything but an em-dash.
  const publishesComponents = metricKeys.length > 1;
  const groupTiles = publishesComponents
    ? METRIC_GROUPS.map((group) => ({ key: group.id, label: group.label, metric: groupedMetric(season, group.id, metrics) }))
    : [];
  const tiles = [...groupTiles, { key: TOTAL_KEY, label: metricLabel(TOTAL_KEY), metric: metrics[TOTAL_KEY] }];
  const tbaUrl = `https://www.thebluealliance.com/team/${teamNumber}`;

  return (
    <div className="flex min-w-0 flex-col gap-[var(--spacing-md)]">
      <div className="flex min-w-0 items-center gap-[var(--spacing-md)]">
        {/*
          Robot image (TEAM-02, D-03). `Avatar`'s own built-in error-triggered
          fallback slot is what makes the ~25% no-photo case a rendering
          branch rather than a conditional tree: `AvatarImage` is only
          rendered at all when `robotImageUrl` is present, and Radix itself
          swaps to `AvatarFallback` on any load failure. Overriding the
          primitive's default `rounded-full`/`size-8` with this app's own
          radius token and a larger fixed size — the fallback tile is
          decorative chrome carrying no visible text, only `role="img"` and
          an accessible label naming the team (06-UI-SPEC.md Copywriting
          Contract).
        */}
        <Avatar className="size-16 shrink-0 rounded-[var(--radius)] after:rounded-[var(--radius)]">
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
            {/* The page's one semantic <h1> — the team's identity is the page title (teams.tsx's own <h1> precedent), even though the team NUMBER is the larger, Display-scale visual focal point per 06-UI-SPEC.md's Visual Hierarchy section. */}
            <h1 title={nickname} className="text-role-heading min-w-0 truncate text-[var(--color-text-primary)]">
              {nickname}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-[var(--spacing-md)]">
            <span data-testid="team-record" className="numeric-cell text-role-body text-[var(--color-text-primary)]">
              {formatRecord(record)}
            </span>
            <span className="numeric-cell text-role-body text-[var(--color-text-muted)]">{formatWinRate(winRateOf(record))}</span>
            {/* TEAM-02's "working link to the team's TBA page" — built from the team NUMBER, not the internal corpus key, per 06-UI-SPEC.md's Copywriting Contract. */}
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

      <div className="flex flex-col gap-[var(--spacing-sm)]">
        {/*
          D-17's tier-boxed metric grid: one cell per declared metric key,
          Total included (unlike the Teams table's sorted, deliberately
          unboxed Total column). The grid reflows to fewer columns at
          narrow widths rather than becoming a scroll region — every cell
          is a bounded numeric, so nothing can force horizontal overflow
          (06-UI-SPEC.md E2 overflow).
        */}
        <div data-testid="season-header-metric-grid" className="grid grid-cols-2 gap-[var(--spacing-sm)] md:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.key} data-testid="metric-grid-cell" className="flex min-w-0 flex-col gap-[var(--spacing-xs)]">
              <span className="text-role-label text-[var(--color-text-muted)]">{tile.label}</span>
              {/*
                Only Total carries a percentile, so only Total gets a rarity
                tier box. A phase group's percentile is a rank against the
                season pool for one specific metric and is not any function
                of its parts' percentiles — see `metricGroups.ts`.
              */}
              <MetricValue metric={tile.metric} tier={tierForPercentile(tile.metric?.percentile)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
