import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MetricValue } from "@/components/MetricValue";
import { metricKeysFor, TOTAL_KEY } from "@/lib/metricKeys";
import { METRIC_GROUPS, withDerivedGroupMetrics } from "@/lib/metricGroups";
import { tierForPercentile } from "@/lib/tiers";
import type { Tier } from "@/lib/tiers";
import type { TeamSeasonArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import type { PublishedAlgorithmId } from "../../../../../packages/harness/publishedAlgorithms.js";
import { SIGMA_METRIC_KEY } from "../../../../../packages/harness/sigmaScore.js";
import { RankCards } from "./RankCards.js";

/**
 * One of the two composition seams `OverviewTab.tsx` freezes this task
 * (06-01-PLAN.md Task 2) — plan 06-07 fills in the rest of the season header
 * (robot image, TBA link, D-17's tier-boxed metric grid) without editing
 * this prop contract or `OverviewTab.tsx`.
 */
export interface SeasonHeaderProps {
  artifact: TeamSeasonArtifact;
  /**
   * Quick task 260905-ttv: narrowed from `string` to `PublishedAlgorithmId`
   * so `RankCards`' `/teams` links typecheck against `TeamsSearchSchema`'s
   * `algorithm` field. Every real caller already passes
   * `Route.useSearch().algorithm`, which has exactly this type, so this
   * narrows a prop rather than changing any runtime value.
   */
  algorithmId: PublishedAlgorithmId;
  season: number;
  teamNumber: number;
  /** The last-OFFICIAL-match snapshot metrics (lib/officialSnapshot.ts), when the route could derive one — season-final values render otherwise. */
  metricsOverride?: TeamSeasonArtifact["metricHistory"][number]["metrics"];
  /**
   * The `matchKey` of the row `metricsOverride` came from (quick task
   * 260908-5wd) — the as-of instant, passed as data rather than re-derived
   * here, so the browser-computed Swing Factor can be measured over exactly
   * the span the snapshot's own values describe. Meaningful only alongside
   * `metricsOverride`; absent for the season-final case, where the window is
   * the whole season.
   */
  snapshotMatchKey?: string;
  /**
   * Quick task 260905-ttv: this team's World/Country/District/State rank
   * scopes, threaded straight through to `RankCards` — see that module's own
   * header for the graceful-absence contract (undefined/empty both render
   * nothing).
   */
  ranks?: TeamSeasonArtifact["ranks"];
}

/** Copied from `apps/web/src/components/teams-table/columns.tsx`'s own `formatRecord` — do not import across the teams-table module boundary (06-PATTERNS.md). */
function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}-${record.losses}-${record.ties}`;
}

/** Copied from `apps/web/src/components/teams-table/columns.tsx`'s own `formatWinRate` — same signature (a nullable fraction, not a record), so the zero-match "—" case matches the Teams table exactly. */
function formatWinRate(value: number | null): string {
  if (value === null) return "";
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * The SIGMA SCORE tile.
 *
 * Rendered exactly when the artifact carries a published `sigma` metric entry,
 * which is the same thing as saying "this algorithm publishes Sigma Score" —
 * SPR today, per `SIGMA_SCORE_ALGORITHM_IDS`. There is deliberately NO
 * algorithm-id check in the browser: the data's presence is the condition, so
 * changing which algorithms carry Sigma needs no web change at all.
 *
 * The tile IS tier-boxed (quick task 260909-tgf's construction, inherited). The
 * percentile behind it is the team's residual against an expected-consistency
 * curve fitted at its own rating — so a strong robot is not automatically
 * high-sigma — and the direction is inverted at the pipeline so LOW sigma earns
 * the HIGH tier.
 */
function SigmaScoreTile({ sigmaScore, tier }: { sigmaScore?: number; tier?: Tier }) {
  if (sigmaScore === undefined) return null;
  return (
    <div data-testid="sigma-score-tile" className="flex min-w-0 flex-col items-start gap-[var(--spacing-xs)]">
      <span className="text-role-label text-[var(--color-text-muted)]">Sigma</span>
      <MetricValue metric={{ value: sigmaScore }} tier={tier} />
    </div>
  );
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
 * D-03), a "View on TBA" link, the record/win-rate strings (OFFICIAL play
 * only as of quick task 260908-615 — offseason and preseason results are
 * excluded from these two, and from them alone), D-17's tier key row, and the
 * tier-boxed metric grid.
 */
export function SeasonHeader({ artifact, algorithmId, season, teamNumber, metricsOverride, snapshotMatchKey, ranks }: SeasonHeaderProps) {
  const nickname = artifact.nickname === "" ? `Team ${teamNumber}` : artifact.nickname;
  const { record } = artifact.seasonStats;
  // 2026-09-01 (user request): tiles read the last-OFFICIAL-match snapshot
  // when the route could derive one; season-final otherwise. Each snapshot
  // metric carries its own published percentile (the D-06.1-A discipline —
  // an as-of-then value tiered against the season-final pool), so the tier
  // boxes stay honest either way.
  // Widened with any derivable group entries this algorithm/season supports
  // (D-3, 260904-5zg) BEFORE the tiles read it. As of quick task 260904-7id
  // the pipeline now publishes EPA's own group metrics too, so a real
  // (post-republish) EPA artifact's `metrics` already carries a published
  // `phaseAuto`/`phaseTeleop`/`phaseEndgame` and this call is a no-op for
  // it — `withDerivedGroupMetrics` only still does work for the
  // STALE-ARTIFACT case: a browser holding a cached pre-republish EPA
  // artifact, which has components but no published group entry yet. Both
  // as-of instants (the last-official-match snapshot and season-final) go
  // through this identical call, so the snapshot caption above stays
  // truthful either way. See lib/metricGroups.ts's header for the full
  // honesty argument.
  // Swing Factor merge runs BEFORE withDerivedGroupMetrics, in BOTH as-of
  // states, with its observation window bounded to match whichever one is
  // showing: the whole season for season-final values, and everything up to
  // the snapshot's own match when `snapshotMatchKey` is supplied. See
  // `withBrowserSwingFactor` for why bounding replaced the original skip.
  const resolvedMetrics = metricsOverride ?? artifact.seasonStats.metrics;
  const metrics = withDerivedGroupMetrics(resolvedMetrics, season);
  // Column set is derived from (algorithm, season) ONLY, never from
  // inspecting `metrics` itself — a row missing a declared component
  // renders a BLANK cell and the cell never disappears (D-17/E2 empty).
  const metricKeys = metricKeysFor(algorithmId, season);
  // The headline grid shows four tiles — Auto, Teleop, Endgame, Total —
  // rather than one per raw component (13 in 2024, 11 in 2026). OPR
  // publishes only Total and has no components to group, so it keeps its
  // single tile and the phase groups resolve to `undefined` (blank).
  // An algorithm publishing only Total (OPR) has no components to group, so
  // it shows the single Total tile rather than three tiles that could never
  // be anything but blank.
  const publishesComponents = metricKeys.length > 1;
  // Each phase group tile reads `metrics[group.metricKey]` — for VPR, and
  // for EPA as of quick task 260904-7id, that is a PUBLISHED metric (VPR:
  // own value/spread/percentile; EPA: own value/percentile, no spread —
  // EPA carries a mean only, everywhere), read straight from the artifact,
  // never summed here. It is a DERIVED entry from `withDerivedGroupMetrics`
  // above ONLY in the stale-artifact case — a browser holding a cached
  // pre-260904-7id EPA artifact, which has components but no published
  // group metric yet — and carries a value alone in that case.
  // `tierForPercentile(undefined)` below yields no tier for a derived tile —
  // the honest outcome for stale data, never worked around by inventing a
  // percentile from the single team in view.
  // SWING SCORE is its OWN TILE (developer decision, 2026-09-09), not a `±`
  // suffix on Total. It is one number per team — its total consistency
  // estimate for its NEXT match — which is a different question from every
  // metric beside it, so it reads as its own quantity rather than an
  // annotation on another one. No metric tile carries a `±` any more.
  //
  // Quick task 260909-tgf: the VALUE still prefers the published `swing`
  // metric entry (`SWING_METRIC_KEY` in `metrics`, the SAME resolved/widened
  // record the tiles above read) and falls back to the top-level
  // `swingFactor` field only when that entry is absent — a pre-republish
  // artifact, or a browser-computed estimate for an as-of-event snapshot
  // that never carried a percentile. The TIER comes ONLY from the published
  // entry's percentile, via the existing client `tierForPercentile` (the
  // same function every other tile on this page already uses, so the
  // pipeline's cuts and this page's cuts can never disagree) — when the
  // entry is absent, `tierForPercentile(undefined)` yields `undefined`, so
  // the fallback-only case renders the value with NO ring at all.
  // The published `sigma` entry and NOTHING ELSE. The old
  // `?? artifact.swingFactor` fallback is deliberately gone: that field holds a
  // SWING FACTOR, a different estimator on a different scale (Swing prints
  // 1.92 sigma against Sigma's honest 1 sigma), so falling back to it would
  // print a Swing number under a "Sigma" label. Absent entry means no tile.
  const sigmaMetric = metrics[SIGMA_METRIC_KEY];
  const sigmaScore = sigmaMetric?.value;
  const sigmaTier = tierForPercentile(sigmaMetric?.percentile);
  const groupTiles = publishesComponents
    ? METRIC_GROUPS.map((group) => ({ key: group.id, label: group.label, metric: metrics[group.metricKey] }))
    : [];
  const tiles = [...groupTiles, { key: TOTAL_KEY, label: metricLabel(TOTAL_KEY), metric: metrics[TOTAL_KEY] }];
  const tbaUrl = `https://www.thebluealliance.com/team/${teamNumber}`;

  return (
    <div className="flex min-w-0 flex-col gap-[var(--spacing-md)]">
      {/*
        Quick task 260905-ttv: this row is now `flex-wrap items-start
        justify-between` rather than a single `items-center` row of just
        Avatar+identity — the rank cards (second child) are pushed to the
        row's right edge at wide widths and wrap below the identity block
        (first child, which keeps its own `min-w-0` below so the nickname
        still truncates instead of being squeezed by the cards) at narrow
        ones. Renders identically to before when `ranks` is absent/empty,
        since `RankCards` then renders nothing and `justify-between` has
        only one child to place.
      */}
      <div className="flex flex-wrap items-start justify-between gap-[var(--spacing-md)]">
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
              {/* IN-01 (260902-post-phase08-ungoverned-ui/REVIEW.md), REVISED
                  by quick task 260908-615: the record is
                  `artifact.seasonStats.record`, which the publisher now scopes
                  to OFFICIAL play (`teamStatsOfficial`) — the same population
                  the metric tiles below are snapshotted from. This caption used
                  to warn that the two were DIFFERENT as-of instants; they are
                  now drawn from one population, and the caption says which.

                  What it does NOT mean: offseason and preseason play is not
                  hidden. CONTEXT.md's locked D-WLT keeps it fully visible in
                  this page's match table, its event sections and its
                  metric-history chart — only the summary record is scoped. */}
              <span data-testid="team-record-basis" className="text-role-label text-[var(--color-text-muted)]">
                Official events only
              </span>
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
        <RankCards ranks={ranks} season={season} algorithmId={algorithmId} />
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
        {/* IN-01 (260902-post-phase08-ungoverned-ui/REVIEW.md): the tiles
            below can be one of two DIFFERENT as-of instants — the team's
            last official-match snapshot, or the season-final values — and
            the block must never be unlabelled in either state. The
            last-official-match caption is reachable ONLY when
            `metricsOverride` is genuinely a resolved snapshot: the route
            (team.$teamNumber.tsx) no longer falls back to season-final
            values before passing this prop, so `metricsOverride !==
            undefined` is now a trustworthy signal here — it was NOT before
            that route change, which is why this label could not have been
            added safely without it. */}
        <span data-testid="season-header-as-of" className="text-role-label text-[var(--color-text-muted)]">
          {metricsOverride !== undefined ? "As of last official match" : "Season-final (includes offseason/preseason play)"}
        </span>
        {/* Left-justified with fixed gaps (2026-09-01 user request: "don't
            space out the chosen metrics") — the old equal-track grid spread
            four tiles across the whole card width. */}
        <div data-testid="season-header-metric-grid" className="flex flex-wrap gap-x-[var(--spacing-2xl)] gap-y-[var(--spacing-sm)]">
          {/* `items-start` on each cell (2026-09-01 redesign): flex-col stretch was widening each tier box to the full grid track — the box should hug its value like every other metric cell on the site. */}
          {tiles.map((tile) => (
            <div key={tile.key} data-testid="metric-grid-cell" className="flex min-w-0 flex-col items-start gap-[var(--spacing-xs)]">
              <span className="text-role-label text-[var(--color-text-muted)]">{tile.label}</span>
              <MetricValue metric={tile.metric} tier={tierForPercentile(tile.metric?.percentile)} />
            </div>
          ))}
          {/* Sigma Score's own tile — see `sigmaScore`'s derivation above for
              why it is not a suffix on Total. Quick task 260909-tgf: the tile
              IS tier-boxed, exactly like the tiles beside it — the percentile
              behind it is the team's residual against an expected-swing curve
              at its own rating, inverted at the pipeline so LOW swing earns
              the HIGH tier. */}
          <SigmaScoreTile sigmaScore={sigmaScore} tier={sigmaTier} />
        </div>
      </div>
    </div>
  );
}
