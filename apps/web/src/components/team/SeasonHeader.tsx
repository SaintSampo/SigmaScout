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

/**
 * The team-page identity block: team number (Display 28/600, the page's
 * primary focal point per 06-UI-SPEC.md's Visual Hierarchy), nickname
 * (falling back to `Team {teamNumber}` when empty, truncated by CSS
 * ellipsis with a `title` attribute — never by slicing the string), and the
 * record/win-rate strings. Robot image, TBA link and the tier-boxed metric
 * grid (D-17) are plan 06-07's job, not this task's.
 */
export function SeasonHeader({ artifact, teamNumber }: SeasonHeaderProps) {
  const nickname = artifact.nickname === "" ? `Team ${teamNumber}` : artifact.nickname;
  const { record } = artifact.seasonStats;

  return (
    <div className="flex min-w-0 flex-col gap-[var(--spacing-sm)]">
      <div className="flex min-w-0 items-baseline gap-[var(--spacing-md)]">
        <span className="numeric-cell text-role-display shrink-0 text-[var(--color-text-primary)]">{`#${teamNumber}`}</span>
        {/* The page's one semantic <h1> — the team's identity is the page title (teams.tsx's own <h1> precedent), even though the team NUMBER is the larger, Display-scale visual focal point per 06-UI-SPEC.md's Visual Hierarchy section. */}
        <h1 title={nickname} className="text-role-heading min-w-0 truncate text-[var(--color-text-primary)]">
          {nickname}
        </h1>
      </div>
      <div className="flex items-center gap-[var(--spacing-md)]">
        <span data-testid="team-record" className="numeric-cell text-role-body text-[var(--color-text-primary)]">
          {formatRecord(record)}
        </span>
        <span className="numeric-cell text-role-body text-[var(--color-text-muted)]">{formatWinRate(winRateOf(record))}</span>
      </div>
    </div>
  );
}
