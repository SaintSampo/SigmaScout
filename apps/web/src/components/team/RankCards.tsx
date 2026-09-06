import { Link } from "@tanstack/react-router";
import { districtDisplayName } from "@/lib/districtNames";
import { cn } from "@/lib/utils";
import { tierForPercentile } from "@/lib/tiers";
import { percentileForRank, USA_COUNTRY_VALUE } from "../../../../../packages/harness/teamRanks.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";

export interface RankCardsProps {
  /** Undefined (pre-republish artifact) and `[]` (nothing computed) both render nothing — see this module's header. */
  ranks: TeamSeasonArtifact["ranks"];
  /** The season the page is currently showing — every card's link carries this, not a hardcoded default (asserted against a non-current year). */
  season: number;
  /** The algorithm the page is currently showing — every card's link carries this. */
  algorithmId: PublishedAlgorithmId;
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
 * The `/teams` search object for one card's scope — built per scope, never
 * from a raw artifact string reaching an href unmodified (T-ttv-03). The
 * State case sets BOTH `country: USA_COUNTRY_VALUE` and `state: entry.value`:
 * `buildTeamRankScopes`'s state pool (`packages/harness/teamRanks.ts`) is
 * gated on country as well as state, so a state-only link would land on a
 * different, larger pool than the card's own number describes (a non-US
 * region that also abbreviates to the same two letters would pool in).
 * `USA_COUNTRY_VALUE` is imported rather than re-typed so this spelling can
 * never drift from the pipeline's own gate.
 *
 * `sortDir: "desc"` is included because `Link`'s typed `search` prop expects
 * the TARGET route's fully-required search shape back (`Ribbon.tsx`'s
 * `preserveSearch` names this same TanStack Router contract) — `year` and
 * `algorithm` are the only two other required fields, and this route
 * (`/team/$teamNumber`) has no "current" Teams-page sort to carry forward,
 * so this is the schema's own documented default (`TeamsSearchSchema.sortDir
 * .catch("desc")`), not an invented value.
 */
function scopeSearch(entry: RankScopeEntry, season: number, algorithmId: PublishedAlgorithmId) {
  const base = { year: season, algorithm: algorithmId, sortDir: "desc" as const };
  switch (entry.scope) {
    case "world":
      return base;
    case "country":
      return { ...base, country: entry.value };
    case "district":
      return { ...base, district: entry.value };
    case "state":
      return { ...base, country: USA_COUNTRY_VALUE, state: entry.value };
  }
}

/**
 * Quick task 260905-ttv (rank cards v2): up to four World/Country/District/
 * State rank cards, rendered directly from `TeamSeasonArtifactSchema.ranks`
 * — no client-side ranking happens here, only display and the tier
 * classification below. Renders nothing at all (no heading, no empty row, no
 * skeleton) when `ranks` is absent (a pre-republish artifact that never
 * computed this field) or empty (`[]`, computed and found nothing to show) —
 * the same graceful-absence contract `robotImageUrl`/`activeYears` already
 * use on this artifact.
 *
 * `ranks` already arrives in the order world/country/district/state
 * (`teamRanks.ts`'s `buildTeamRankScopes` contract) — this component renders
 * them in the order given, never re-sorting.
 *
 * Rewritten for quick task 260905-ttv from the 260905-ldu original: cards
 * now mount inside `SeasonHeader`'s identity row rather than as a standalone
 * row below it (`OverviewTab.tsx` no longer renders this component itself),
 * carry a fixed shared width regardless of label length, are coloured by the
 * rarity tier their OWN rank/total falls in, and each links to `/teams`
 * filtered to that exact scope.
 *
 * The basis caption (`data-testid="rank-cards-basis"`, "Ranked by total,
 * official play only") is DELETED, not merely hidden — removing it does not
 * reopen IN-01 (the season-header's own labelling discipline): the cards now
 * sit inside the same card as `data-testid="season-header-as-of"`, and the
 * ranks are computed from the same last-official-match snapshot pool that
 * as-of line already labels (`publish.ts` ranks `teamsRows`, whose metrics
 * are `officialMetricsByTeamWithPercentiles`). One residual is left
 * genuinely unlabelled by this, noted honestly rather than left for a future
 * reader to rediscover: when no snapshot is derivable, the as-of line reads
 * "Season-final" while the ranks remain official-only — that branch has no
 * label naming the ranks specifically. Accepted per the user's explicit
 * request to remove the caption.
 */
export function RankCards({ ranks, season, algorithmId }: RankCardsProps) {
  if (ranks === undefined || ranks.length === 0) return null;

  return (
    <div data-testid="rank-cards" className="flex flex-wrap gap-[var(--spacing-sm)]">
      {ranks.map((entry) => {
        const label = scopeLabel(entry);
        const tier = tierForPercentile(percentileForRank(entry.rank, entry.total));
        return (
          <Link
            key={entry.scope}
            to="/teams"
            search={scopeSearch(entry, season, algorithmId)}
            data-testid="rank-card"
            // The scope label is associated with its number via this link's
            // own accessible name, rather than floating as a bare adjacent
            // string — a screen reader announces "World: rank 12 of 3,481"
            // as one unit, and that name also identifies where the link
            // goes.
            aria-label={`${label}: rank ${entry.rank} of ${entry.total}`}
            className={cn("data-card rank-card p-[var(--spacing-md)]", tier !== undefined && `rank-card--${tier}`)}
          >
            {/*
              No explicit text colour on any of these three spans — all
              three inherit the `<Link>`'s own colour, which a tier modifier
              class sets uniformly for the whole card (matching
              `.metric-tier--rare`'s own single-foreground box) and which
              Common's ring-only modifier leaves untouched at the page's
              default ink, exactly like the label read before this rewrite.
            */}
            <span aria-hidden="true" title={label} className="text-role-label w-full truncate">
              {label}
            </span>
            <span aria-hidden="true" className="numeric-cell text-role-heading">
              {`#${entry.rank}`}
            </span>
            {/* Always visible, never omitted: a rank without its pool size
                is not a claim a reader can check. Grouped with a locale
                thousands separator (e.g. "of 3,481"). */}
            <span aria-hidden="true" className="numeric-cell text-role-label">
              {`of ${entry.total.toLocaleString()}`}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
