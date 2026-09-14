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
  /** The season the page is currently showing — every card's link carries this, not a hardcoded default. */
  season: number;
  /** The algorithm the page is currently showing — every card's link carries this. */
  algorithmId: PublishedAlgorithmId;
  /**
   * The team's published Total percentile (`seasonStats.metrics.total.percentile`)
   * — the World card's tier comes from this, never from its rank. Absent
   * renders the World card with no tier modifier at all.
   */
  worldPercentile?: number;
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
 * The `/teams` search object for one card's scope, built per scope so a raw
 * artifact string never reaches an href unmodified. The `state` case sets
 * both `country: USA_COUNTRY_VALUE` and `state: entry.value`: the pipeline's
 * state pool (`buildTeamRankScopes` in `packages/harness/teamRanks.ts`) is
 * gated on country as well as state, so a state-only link would land on a
 * different, larger pool than the card's own number describes.
 *
 * `sortDir: "desc"` is included because `Link`'s typed `search` prop requires
 * the target route's full search shape back; this matches
 * `TeamsSearchSchema.sortDir.catch("desc")`, the route's own documented
 * default.
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
 * Up to four World/Country/District/State rank cards, rendered directly from
 * `TeamSeasonArtifactSchema.ranks` — no client-side ranking happens here,
 * only display and the tier classification below. Renders nothing at all
 * when `ranks` is absent (a pre-republish artifact that never computed this
 * field) or empty (`[]`, computed and found nothing to show).
 *
 * `ranks` already arrives in the order world/country/district/state
 * (`teamRanks.ts`'s `buildTeamRankScopes` contract) — this component renders
 * them in the order given, never re-sorting.
 *
 * The World card's tier comes from `worldPercentile`, the same `seasonStats`
 * Total percentile the Teams list stamps its Total tier from, never from its
 * own rank. Regional pools (country, district, state) are subsets no
 * published percentile covers, so those cards use `percentileForRank`'s
 * rank-specialised mid-rank convention instead — they differ from the Total
 * tier only by pool.
 *
 * There is no "ranked by" basis caption: the cards sit inside the same card
 * as `data-testid="season-header-as-of"`, and the ranks are computed from
 * the same last-official-match snapshot pool that as-of line already labels.
 */
export function RankCards({ ranks, season, algorithmId, worldPercentile }: RankCardsProps) {
  if (ranks === undefined || ranks.length === 0) return null;

  return (
    <div data-testid="rank-cards" className="flex flex-wrap gap-[var(--spacing-sm)]">
      {ranks.map((entry) => {
        const label = scopeLabel(entry);
        const tier = tierForPercentile(entry.scope === "world" ? worldPercentile : percentileForRank(entry.rank, entry.total));
        return (
          <Link
            key={entry.scope}
            to="/teams"
            search={scopeSearch(entry, season, algorithmId)}
            data-testid="rank-card"
            // The label is tied to its number via the link's own accessible name
            // ("World: rank 12 of 3,481") rather than a bare adjacent string.
            aria-label={`${label}: rank ${entry.rank} of ${entry.total}`}
            className={cn("data-card rank-card p-[var(--spacing-md)]", tier !== undefined && `rank-card--${tier}`)}
          >
            {/* No explicit text colour here: all three spans inherit the Link's
                own colour, set uniformly by the tier modifier class. */}
            <span aria-hidden="true" title={label} className="text-role-label w-full truncate">
              {label}
            </span>
            <span aria-hidden="true" className="numeric-cell text-role-heading">
              {`#${entry.rank}`}
            </span>
            {/* Always shown: a rank without its pool size is not a claim a
                reader can check. */}
            <span aria-hidden="true" className="numeric-cell text-role-label">
              {`of ${entry.total.toLocaleString()}`}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
