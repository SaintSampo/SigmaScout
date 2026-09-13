---
phase: quick-260912-tnk
plan: 01
subsystem: publish pipeline, live Worker, team page
tags: [rarity-tier, percentiles, consistency, worker-cpu]
requires: []
provides:
  - one season ranking pool (last-official-match) for every published percentile, on both publish paths
  - goodnessPercentileAgainstPools, the single direction-aware, display-precision ranking helper
  - carry-forward of published Teams-row tiers and Sigma/Swing entries in the live global rebuild
  - World rank card tiered by the published Total percentile; regional cards rounded
affects: [packages/harness/publish.ts, apps/worker/src/scheduled.ts, apps/web team page]
tech-stack:
  added: []
  patterns: [one pool + one helper for every pool-ranked percentile, measured CPU gate before adding Worker work]
key-files:
  created:
    - .planning/todos/pending/live-merges-drop-percentiles.md
  modified:
    - packages/harness/percentiles.ts
    - packages/harness/percentiles.test.ts
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
    - packages/harness/metricHistorySchema.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/test/scheduled.test.ts
    - packages/harness/teamRanks.ts
    - packages/harness/teamRanks.test.ts
    - apps/web/src/components/team/RankCards.tsx
    - apps/web/src/components/team/RankCards.test.tsx
    - apps/web/src/components/team/SeasonHeader.tsx
    - apps/web/src/components/team/SeasonHeader.test.tsx
    - apps/web/src/components/team/EventSection.tsx
decisions:
  - "260912-tnk: every published percentile ranks against ONE pool per (algorithm, season), every team's metrics as of its last official match, through goodnessPercentileAgainstPools"
  - "260912-tnk: pools and queries rank at display precision (roundMetric), so equal printed values share a percentile"
  - "260912-tnk: live global rebuild CARRIES published tiers forward; full re-derivation failed the 25% CPU gate (measured 67-97% of baseline)"
  - "260912-tnk: World rank card tier = published seasonStats Total percentile; regional cards = rounded percentileForRank"
metrics:
  duration: ~1h45m
  completed: 2026-09-12
status: complete
---

# Quick Task 260912-tnk: Rarity-tier consistency across the site Summary

A rarity tier is now a function of (metric value, one season ranking pool) wherever the offline pipeline
publishes it. The pool is every team's metrics as of its last official match. It feeds:
- Teams-list tiers
- seasonStats
- metricHistory rows
- event standings, on both publishSeasons and `--event`

All of these go through one helper that applies metric direction and ranks at 2-decimal display
precision. The live Worker's global rebuild now keeps published tiers and Sigma entries on touched rows.
The World rank card is tiered by the published Total percentile.

**The live site is unchanged until the developer does all three of these:**
- republishes (`pnpm publish:seasons`) to rewrite every percentile (Task 1)
- deploys the Worker (Task 2)
- ships the web app (Task 3)

The World-card change works against today's artifacts as soon as the web app deploys, because it reads
seasonStats, which is already on the Teams-list pool.

No `docs/publish-budget.md` transcription is owed. Percentile values change, but no published key was added.

## The defect, as measured live (https://data.sigmascout.org, 2026-09-12, before this task)

Per team: Teams-list Total tier vs the Total percentile on its last official metricHistory row (the team
page's last official event card). Sample: every 25th team plus ±6 ranks around each tier cut, so the
rates are higher than the whole field; the direction always held.

| Algorithm / season | checked | tier differs |
|---|---|---|
| spr 2026 | 185 | 84 |
| epa 2025 | 185 | 40 |
| spr 2025 | 185 | 34 |
| opr 2026 | 185 | 22 |
| epa 2026 | 185 | 21 |

The event-card percentile was always higher. Worst: spr 2026 team 6919, Total 189.71, was Epic (94.9) on
the list and **Legendary (100)** on its last official event card. That is the developer's example
exactly. The World rank card also disagreed with the list tier at the cuts (5 of 51 near-cut spr 2026
teams).

## Task 1: one ranking pool (678449f5)

**Fail-first evidence.** The new invariant test was written first, against an unchanged publish.ts. It failed:

    AssertionError: frc1 phaseAuto: history row percentile vs seasonStats: expected 81.8 to be 95 // Object.is equality
     ❯ packages/harness/publish.test.ts:3187:102

**What changed:**
- **percentiles.ts**
  - Added `goodnessPercentileAgainstPools`, the single ranking helper.
  - Added `withPoolPercentiles`.
  - `sortedPoolsByMetric` now pools rounded values.
  - `withPercentiles` takes an optional prebuilt pool and routes through the helper.
  - Stale "season-final" docs rewritten.
- **publish.ts**
  - `rankingPools` is built once from `lastOfficialMetricsByTeam`, and the season-final pool is deleted.
  - `seasonStatsMetricsForTeam(teamKey, officialWithPercentiles, seasonFinalMetrics, rankingPools)`: the
    offseason-only fallback is ranked against the same pool.
  - `withHistoryPercentiles` and `withEventPercentiles` are now thin wrappers.
  - `--event`: its replay hook captures last-official metrics with a single `teamMetrics` call, shared
    with the Sigma talent capture. The pool filters demo keys. The structural once-only test still holds.
- **Tests**
  - New describe "publishSeasons — one ranking pool across every tier surface" covers:
    - a floor of 9 teams and at least one non-Common tier
    - history row vs seasonStats, exact
    - teams-row tier vs seasonStats tier
    - event standing vs helper
    - an offseason-only team ranked against the same pool
    - a discriminator showing the old season-final pool gives a different percentile
  - New `--event` standings-percentile parity test.
  - Updated: `seasonStatsMetricsForTeam` and `withHistoryPercentiles` tests, and the real-corpus
    invariant (retitled; its expected value now comes from the helper).
  - New percentiles tests: lower-is-better inversion, 2-decimal collision, exact equality with
    `withPercentiles` for pool members, absent pool returns undefined, `withPoolPercentiles` allowlist,
    no pool, and no mutation.

## Task 2: live Teams-row tiers (6775fad7)

**CPU gate: FAIL, so the fallback was used.**

Setup: throwaway `npx tsx` script in the scratchpad. Synthetic positional teams artifact of 3,800 rows ×
18 keys plus a tiered Sigma entry (1.94 MB). 20 warm-up runs, then the median of 50.

| Run | BASELINE median | ADDED median (re-derivation) | Ratio |
|---|---|---|---|
| 1 | 134.96 ms | 90.36 ms | 67.0% |
| 2 | 77.43 ms | 72.53 ms | 93.7% |
| 3 | 74.85 ms | 72.68 ms | 97.1% |

Gate: ADDED at most 25% of BASELINE. Building the pools alone was 35.8%, and one `roundMetric` pass
alone was 16.0%.

As pre-committed, the Worker does not re-derive tiers. `touchedTeamsRowMetrics(prior, fresh)` works
like this:
- Each fresh value keeps the prior row's published tier for the same key.
- A key with no prior tier gets no tier key; "common" is never written.
- The prior Sigma/Swing entry (value and tier) is carried forward.

**Tests** (describe "260912-tnk: live Teams-row tiers"):
- 6 unit tests
- 1 runTick integration test
- the 260908-5wd test extended so a seeded Sigma entry survives

Temporarily restoring the old call site made both integration tests fail
(`frc1 tier: expected undefined to be 'legendary'`;
`expected undefined to deeply equal { value: 3.25, tier: 'epic' }`), and the call site was then put back.

**Follow-up todo:** `.planning/todos/pending/live-merges-drop-percentiles.md` records three gaps:
- `mergeTeamSeasonArtifact` and `mergeEventArtifact` still drop percentiles and `metricsBasis`.
- Offseason ticks write seasonStats unscoped.
- Carried tiers go stale.

This path is not exercised in production yet. docs/worker-operations.md's pre-season CPU gate forbids
opening any live window until the RP-fold CPU todo closes.

## Task 3: rank cards (7c97bf38)

- **RankCards:** the World card's tier is `tierForPercentile(worldPercentile)`. With no percentile, the
  card has no `rank-card--` modifier. Regional cards use `percentileForRank`.
- **SeasonHeader:** passes `worldPercentile` from `artifact.seasonStats.metrics.total?.percentile`,
  deliberately not from `metricsOverride`.
- **`percentileForRank`:** now rounds with `roundTo(..., ROUNDING_RULE.percentile)`. It equals
  `percentileRanks` exactly, and 126 of 2500 gives exactly 95.
- **Comments:** the stale "season-final pool" comments in SeasonHeader and EventSection were rewritten.
- **Tests:** World card at rank 1 with percentile 94.9 is Epic; no percentile means no modifier;
  regional card at 126/2500 is Legendary; `teamRanks` exact equality is now `toBe`; a new SeasonHeader
  test covers a `metricsOverride` of 100 with seasonStats at 94.9, which gives Epic. Temporarily
  reverting both changes made all 6 new tests fail.

## Audit: every tier surface

| Surface (file) | Tiers from | Pool before this task | Disposition |
|---|---|---|---|
| Teams list metric cells + Sigma column (teams-table/columns.tsx, rowModel.ts) | published teams-row `tier` (`?? "common"`) | last-official-match | Consistent. Live false-Common gap: tiers now carried forward (Task 2; stale until republish, not re-ranked) |
| Teams bubble chart (teamsBubbleModel.ts) | published Total `tier`, `"neutral"` fallback | last-official-match | No change. `"neutral"` is the documented 260909-tom rendering of Common-or-unranked |
| Season header tiles (SeasonHeader.tsx via `metricsOverride` = last official history row; seasonStats fallback) | history-row percentile | season-final | Fixed by Task 1 (needs republish) |
| Season header Sigma tile | `sigma` entry percentile | residual rank (swingMetric.ts), shared with the teams row | Consistent |
| Team page event cards (EventSection.tsx) | history-row percentile | season-final | Fixed by Task 1; comment rewritten |
| Rank cards (RankCards.tsx) | World and regional: rank formula, unrounded | rank pool (third formula) | Fixed by Task 3 |
| TierKeyRow.tsx | static legend | n/a | No change |
| Event Insights / Breakdown / Alliances pick cells (event/*.tsx) | event standing percentile | season-final | Fixed by Task 1 on both publish paths |
| allianceTierApproximation.ts | interpolation of the event's published (value, percentile) pairs | inherits the event artifact | Inherits Task 1; approximate by design |
| Match robot grid (MatchRobotGrid.tsx via preMatchMetrics.ts) | prior history-row percentile | season-final | Fixed by Task 1 |
| Live Worker: teams rows (runGlobalRebuild) | dropped | n/a | Task 2: carried forward |
| Live Worker: team/event merges | dropped | n/a | Recorded in follow-up todo |

## Contradictions with CONTEXT

1. **Header source.** The rendered season header reads the last official metricHistory row (resolved
   client-side in officialSnapshot.ts), not seasonStats. So today the header tiles show the event-card
   tier, not the list tier.
2. **Sigma/Swing can't be re-derived.** Their tiers are rating-local residual ranks (swingMetric.ts), not
   ranks of the displayed value.
3. **Rounding mismatch.** The pipeline ranked unrounded values while the Worker only sees rounded ones.
   A real case, found in an existing test: 44.99999999999999 vs a pooled 45. Both sides now rank at
   display precision.
4. **Live re-derivation didn't fit.** CONTEXT's preferred approach measured at 67-97% of the rebuild
   baseline, so the CONTEXT fallback shipped.

## Deviations from Plan

1. **[Rule 1 - Bug] An existing test pinned the deleted season-final pool.** Test 8 in "D-10 as-of-event
   value" did so, and its "not the event roster" discriminator only held on float noise. Its expected
   value is now computed against the last-official-match pool; the roster discriminator is kept
   (published 50 vs roster 58.3). Commit 678449f5.
2. **Plan-sanctioned fallback in Task 2.** `rederiveTeamsRowTiers` was implemented, measured, and
   removed after it failed the gate. The shipped function is `touchedTeamsRowMetrics`. Must-have truth 5
   (re-derivation reproduces offline tiers exactly) is therefore NOT met, as the plan's fallback clause
   allows. A touched team whose value crossed a cut keeps its old tier until the next publish.
3. **TDD ordering in Task 2.** The implementation came before its tests because the gate had to be
   measured first. The tests were then proven to discriminate by temporarily restoring the old call site.

## Out-of-scope observations (not fixed)

- **Sigma tile may not render.** metricHistory rows carry no `sigma` entry, so when the header resolves
  `metricsOverride` to a history row, the Sigma tile may not render. This comes from reading the code;
  it was not checked in a browser.
- **Stale comment.** SeasonHeader.tsx:135 still refers to `withBrowserSwingFactor`, which no longer exists.

## Verification

- Executor, full set:
  `npx vitest run packages/harness/percentiles.test.ts packages/harness/publish.test.ts packages/harness/teamRanks.test.ts packages/harness/browserSafeSchemas.test.ts packages/harness/payloadBudget.test.ts packages/harness/swingMetric.test.ts packages/harness/metricDirection.test.ts apps/worker/test apps/web/src/components apps/web/src/lib`
  gave `Test Files 114 passed (114)` / `Tests 1955 passed (1955)`.
- Orchestrator re-run, independent:
  - `npx vitest run packages/harness/percentiles.test.ts packages/harness/teamRanks.test.ts apps/worker/test/scheduled.test.ts apps/web/src/components/team` gave `Test Files 21 passed (21)` / `Tests 398 passed (398)`.
  - `npx vitest run packages/harness/publish.test.ts -t "260912-tnk|--event agree"` gave `Tests 25 passed | 172 skipped (197)`.
- `npx tsc --noEmit`, `npx tsc --noEmit -p apps/web/tsconfig.json` and
  `npx tsc --noEmit -p apps/worker/tsconfig.json` are all clean (re-run by the orchestrator).
- Each commit contains only its task's paths. Nothing was published, deployed, pushed, or written to
  R2/D1/KV, and `.env` was never read.

## Self-Check: PASSED
