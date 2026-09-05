import { districtDisplayName } from "@/lib/districtNames";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

export interface RankCardsProps {
  /** Undefined (pre-republish artifact) and `[]` (nothing computed) both render nothing — see this module's header. */
  ranks: TeamSeasonArtifact["ranks"];
}

type RankScopeEntry = NonNullable<TeamSeasonArtifact["ranks"]>[number];

const WORLD_LABEL = "World";

/**
 * The reader-facing scope label for one rank card. `district` goes through
 * `districtDisplayName` (this directory never shows a raw district key —
 * `fim` renders as `FIRST MI`); `country`/`state` render their raw published
 * value directly (TBA's own country string / state-prov abbreviation);
 * `world` has no published `value` at all, so it gets a fixed label.
 */
function scopeLabel(entry: RankScopeEntry): string {
  switch (entry.scope) {
    case "world":
      return WORLD_LABEL;
    case "district":
      return entry.value !== undefined ? districtDisplayName(entry.value) : "District";
    case "country":
    case "state":
      return entry.value ?? "";
  }
}

/**
 * Quick task 260905-ldu: up to four World/Country/District/State rank cards,
 * rendered directly from `TeamSeasonArtifactSchema.ranks` — no client-side
 * ranking happens here, only display. Renders nothing at all (no heading, no
 * empty row, no skeleton) when `ranks` is absent (a pre-republish artifact
 * that never computed this field) or empty (`[]`, computed and found nothing
 * to show) — the same graceful-absence contract `robotImageUrl`/
 * `activeYears` already use on this artifact.
 *
 * `ranks` already arrives in the order world/country/district/state
 * (`teamRanks.ts`'s `buildTeamRankScopes` contract) — this component renders
 * them in the order given, never re-sorting.
 *
 * Reuses this directory's existing visual vocabulary (`SeasonHeader.tsx`):
 * the `.data-card` shell, `.text-role-label`/`--color-text-muted` for the
 * scope label, `.numeric-cell` for the rank number. Cards lay out as a
 * wrapping row that reflows to fewer columns at narrow widths — every value
 * is a bounded numeric, so nothing can force horizontal overflow.
 */
export function RankCards({ ranks }: RankCardsProps) {
  if (ranks === undefined || ranks.length === 0) return null;

  return (
    <div data-testid="rank-cards" className="flex flex-col gap-[var(--spacing-sm)]">
      <div className="flex flex-wrap gap-[var(--spacing-md)]">
        {ranks.map((entry) => {
          const label = scopeLabel(entry);
          return (
            <div
              key={entry.scope}
              data-testid="rank-card"
              role="group"
              // The scope label is associated with its number via this
              // group's own accessible name, rather than floating as a bare
              // adjacent string — a screen reader announces "World: rank 12
              // of 3,481" as one unit.
              aria-label={`${label}: rank ${entry.rank} of ${entry.total}`}
              className="data-card flex min-w-0 flex-col items-start gap-[var(--spacing-xs)] p-[var(--spacing-md)]"
            >
              <span aria-hidden="true" className="text-role-label text-[var(--color-text-muted)]">
                {label}
              </span>
              <span aria-hidden="true" className="numeric-cell text-role-heading text-[var(--color-text-primary)]">
                {`#${entry.rank}`}
              </span>
              {/* Always visible, never omitted: a rank without its pool
                  size is not a claim a reader can check. Grouped with a
                  locale thousands separator (e.g. "of 3,481"). */}
              <span aria-hidden="true" className="numeric-cell text-role-label text-[var(--color-text-muted)]">
                {`of ${entry.total.toLocaleString()}`}
              </span>
            </div>
          );
        })}
      </div>
      {/*
        Exactly one basis caption for the whole row (IN-01's discipline,
        matching SeasonHeader.tsx's own as-of line): these ranks are computed
        from each team's last-official-match snapshot against an
        official-play-only pool, a different as-of instant from the
        season-final record shown above, and an unlabelled number here would
        be a new unmarked claim.
      */}
      <span data-testid="rank-cards-basis" className="text-role-label text-[var(--color-text-muted)]">
        Ranked by total, official play only
      </span>
    </div>
  );
}
