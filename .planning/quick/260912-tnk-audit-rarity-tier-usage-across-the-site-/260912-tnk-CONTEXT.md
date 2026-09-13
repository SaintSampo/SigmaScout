# Quick Task 260912-tnk: audit rarity tier usage across the site for consistency - Context

**Gathered:** 2026-09-12
**Status:** Ready for planning

<domain>
## Task Boundary

Audit every place the rarity tier (Common / Rare / Epic / Legendary, `apps/web/src/lib/tiers.ts`,
`packages/harness/pageArtifacts.ts` `publishedTierForPercentile`) is used on the website, and make them
consistent. The developer's own example of the defect: a robot whose Total renders **Legendary** on
its last match of official play on its team page must render the **same tier** in the Teams list.

The rule this task establishes: **the same metric value for the same team, season and algorithm gets
the same tier on every surface.** A tier is a function of (value, the one season ranking pool) — never
of which page is showing it.

</domain>

<decisions>
## Implementation Decisions

### The canonical ranking pool (orchestrator decision, from the developer's stated rule)
- The ONE pool is the one the Teams list already uses: every team's metrics as of its **last official
  match** (`lastOfficialMetricsByTeam` -> `withPercentiles(officialMetricsByTeam, teamsThisSeason)` in
  `packages/harness/publish.ts`). The Teams list and the team-page season header already agree with
  each other on this pool (verified live, below) and are the reference.
- Every other percentile the pipeline publishes must be ranked against that same pool: per-team
  `metricHistory` rows (`withHistoryPercentiles`), event artifact standings (`withEventPercentiles`,
  seasons path AND the `--event` path near publish.ts:3782), and anything else that consumes
  `sortedPools`. Today they rank against the SEASON-FINAL pool (`sortedPoolsByMetric(metricsByTeam)`,
  built from `algorithm.teamMetrics(finalState)`), which is a different distribution.
- An offseason-only team (no official play; `seasonStatsMetricsForTeam` falls back to season-final
  metrics) should also be ranked against the unified pool, not a second one.
- Direction must survive: `withPercentiles` applies `goodnessPercentile(…, metricDirectionOrDefault)`;
  the sorted-pool helpers do not. Whatever replaces them must apply direction identically, so a
  lower-is-better metric (Sigma/Swing) cannot tier inverted on one surface and upright on another.
- Consistency must be BY CONSTRUCTION and PINNED BY A TEST: for a team with official play, its last
  official `metricHistory` row's allowlisted percentiles, its `seasonStats.metrics` percentiles, and
  its Teams-row `tier` must all resolve to the same tier (and the percentiles should be exactly equal —
  `percentileAgainstSortedPool` is documented to agree exactly with `percentileRanks` for a pool
  member). An iteration-list trap applies here: do not pin this with a hardcoded season list that a
  new season silently skips.

### Republish
- **Fix + tests only. Do NOT run `pnpm publish:seasons`, `--event`, or any R2/D1/KV write.** The
  developer will republish when it suits them. (R2 is over its free-tier storage; `--event` publishes
  cold and must never be run on an event anyone cares about.) The SUMMARY must state plainly that the
  live site is unchanged until that republish.

### Live-event gap (developer chose: INCLUDE it)
- During a live event, `apps/worker/src/scheduled.ts` `runGlobalRebuild` rebuilds touched Teams rows
  from `info.metrics` with no tier, so the web client's `tier ?? "common"` coalesce
  (`apps/web/src/components/teams-table/columns.tsx:387`) paints a Common ring on a team that may be
  Legendary until the next offline publish. Accepted as a tradeoff on 2026-09-04; now in scope.
- Committed scope: the Teams list must not fall back to a false Common during live updates. Preferred
  approach: `runGlobalRebuild` already holds every row's official-scoped values for that
  (algorithm, season), which IS the canonical pool, so it can re-derive tiers for all rows with the
  same shared ranking helper the pipeline uses — offline-identical by construction. Fallback if that
  cannot fit: carry the prior published tier forward for a touched row rather than dropping it.
- CPU budget is a hard constraint: free-plan Workers are terminated when they hit the 10ms CPU limit
  *consistently* (see CLAUDE.md's Cron Trigger row — one healthy over-budget tick proves nothing), and
  `runGlobalRebuild` is already described as "close to the entire CPU budget by itself". Any added work
  must be measured/reasoned about, not assumed free. Runs on the slower global-rebuild cadence, not
  every tick.
- The live per-team artifact (`mergeTeamSeasonArtifact`) and live event artifact merges also drop
  percentiles (header tiles and new event-card rows render with NO box — an honest absence, not a
  false tier). Audit and record these; fix only if it fits the CPU and subrequest budgets without
  reading the Teams artifact on every tick. Otherwise record as a follow-up todo in
  `.planning/todos/pending/`.

### Team-page rank cards
- `apps/web/src/components/team/RankCards.tsx` tiers the World card by
  `percentileForRank(rank, total)` (`packages/harness/teamRanks.ts`), a different formula and pool from
  the Total tier. The World card's tier must agree with the Total tier on the Teams list. Regional cards
  (country / district / state) are ranks within a region and may legitimately differ from the World
  tier — but they must use the same percentile formula and rounding convention, so the only difference
  is the pool.

### Claude's Discretion
- Exact helper naming/structure, and whether the audit record lives in the SUMMARY or a separate
  `260912-tnk-AUDIT.md` in this directory.
- Any further tier surfaces the audit finds (bubble chart tone fallback, alliance approximate tiers,
  match-page robot grid, Insights/Breakdown, Sigma column) — fix if they violate the rule above and the
  fix is local; otherwise record.

</decisions>

<specifics>
## Specific Ideas — measured evidence (live `https://data.sigmascout.org`, 2026-09-12)

Compared, per team, (a) Teams-list Total tier, (b) team-page season-header Total percentile,
(c) the Total percentile on the `metricHistory` row equal to the header value (the last official
event card). Sample: every 25th team plus ±6 ranks around each tier cut (so rates are inflated vs the
whole field; the direction is not).

| Algorithm / season | checked | (a)≠(c) |
|---|---|---|
| spr 2026 | 185 | 84 |
| epa 2026 | 185 | 21 |
| opr 2026 | 185 | 22 |
| spr 2025 | 185 | 34 |
| epa 2025 | 185 | 40 |

(a) and (b) agreed in every case. (c) is always HIGHER. Worst: spr 2026 team 6919, Total 189.71 —
list Epic (94.9), header Epic (94.9), last official event card **Legendary (100)** — the developer's
exact example. spr 2026 Rare teams at 74.9 read Epic at 93.8 on their event card.

World rank card vs list Total tier, spr 2026, ±8 ranks around each cut: 5 of 51 mismatch (e.g. team
610: list Legendary, World card Epic at 94.99, rank 186/3707). The rank pool counts 3,707 real rows
(8 without a Total) while the percentile pool is 3,699 teams with a Total, and the card does not apply
the pipeline's 1-decimal percentile rounding.

Tier surfaces found (all funnel through `MetricValue` + `tierForPercentile`, or the published `tier`):
- Teams list metric cells + Sigma column (`teams-table/columns.tsx`, `rowModel.ts`) — published `tier`
- Teams bubble chart tone (`teams-table/teamsBubbleModel.ts`) — published `tier`, `"neutral"` fallback
- Team page: season header (`team/SeasonHeader.tsx`) — seasonStats percentile; event cards
  (`team/EventSection.tsx`) — metricHistory percentile; rank cards (`team/RankCards.tsx`) —
  rank-position percentile; key row (`team/TierKeyRow.tsx`)
- Event page: Insights (`event/InsightsTab.tsx`), Breakdown (`event/BreakdownTab.tsx`), Alliances
  (`event/AlliancesTab.tsx` + `lib/allianceTierApproximation.ts`) — event artifact percentile
- Match page robot grid (`match/MatchRobotGrid.tsx`, `lib/preMatchMetrics.ts`)

</specifics>

<canonical_refs>
## Canonical References

- `.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md` — tier cuts, Common
  outline-only treatment, "a number does not change meaning between pages"
- `packages/harness/percentiles.ts` — `withPercentiles`, `percentileAgainstSortedPool`,
  `sortedPoolsByMetric`, `HISTORY_PERCENTILE_METRIC_KEYS`
- `packages/harness/publish.ts` — ~2860-2915 (pool construction), 3048 (teams rows), 3300-3321 (team
  artifact), 3782 (`--event` path), `withHistoryPercentiles`, `withEventPercentiles`,
  `seasonStatsMetricsForTeam`, `withPublishedTiers`
- `packages/harness/metricDirection.ts` — `goodnessPercentile`, `metricDirectionOrDefault`
- `apps/worker/src/scheduled.ts` — `runGlobalRebuild` (~1462), `mergeTeamSeasonArtifact` (~789)
- `packages/harness/teamRanks.ts` — `percentileForRank`, `buildTeamRankScopes`
- Project memory: test-scope trap (run vitest from the REPO ROOT, not apps/web); root `tsc` misses
  apps/web (run the web tsconfig too); `timeout <n> pnpm` swallows output and exits 0; the
  `docs/publish-budget.md` manual step; iteration-list trap.

</canonical_refs>
