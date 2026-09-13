---
phase: quick-260912-tnk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/harness/percentiles.ts
  - packages/harness/percentiles.test.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - packages/harness/metricHistorySchema.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/test/scheduled.test.ts
  - .planning/todos/pending/live-merges-drop-percentiles.md
  - packages/harness/teamRanks.ts
  - packages/harness/teamRanks.test.ts
  - apps/web/src/components/team/RankCards.tsx
  - apps/web/src/components/team/RankCards.test.tsx
  - apps/web/src/components/team/SeasonHeader.tsx
  - apps/web/src/components/team/EventSection.tsx
autonomous: true
requirements:
  - 260912-tnk

estimate:
  tokens: 120000
  raw_tokens: 240000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "For every team with official play, the Teams-list tier, the team-season artifact's seasonStats percentile, and the percentile on its last official metricHistory row all come from ONE ranking pool (every team's metrics as of its last official match) and resolve to the same tier, with exactly equal percentiles on the allowlisted history keys"
    - "Event artifact standings, from both publishSeasons and the --event path, rank each as-of-event value against that same pool, and the two paths publish identical standings percentiles"
    - "An offseason-only team's seasonStats percentiles are ranked against the same pool, never a second season-final pool"
    - "Every pool-ranked percentile goes through one helper that applies metric direction and ranks at display precision, so a lower-is-better metric cannot tier inverted on one surface and upright on another, and two teams printing the same number share a percentile"
    - "During a live global rebuild, no Teams row with a rankable value falls back to a false Common: every row's tier is re-derived from the rows' own values with the pipeline's helper, an unchanged pool reproduces the offline tiers exactly, and a touched row keeps its published Sigma entry"
    - "The team page's World rank card carries the team's published Total tier; regional cards use the rounded mid-rank convention, so they differ from it only by pool"
    - "Nothing is republished or deployed: no publish:seasons, no --event, no R2/D1/KV/wrangler write"
  artifacts:
    - path: "packages/harness/percentiles.ts"
      provides: "goodnessPercentileAgainstPools (the single direction-aware, display-precision ranking helper), display-precision sortedPoolsByMetric, withPercentiles and withPoolPercentiles routed through it"
    - path: "packages/harness/publish.ts"
      provides: "one ranking pool per (algorithm, season) built from lastOfficialMetricsByTeam, feeding teams rows, seasonStats (incl. the offseason-only fallback), metricHistory and event standings on both the seasons and --event paths"
    - path: "packages/harness/publish.test.ts"
      provides: "cross-surface tier invariant through the real publishSeasons path, plus seasons/--event standings-percentile parity"
    - path: "apps/worker/src/scheduled.ts"
      provides: "exported rederiveTeamsRowTiers called from runGlobalRebuild; consistency entries carried forward on touched rows"
    - path: ".planning/todos/pending/live-merges-drop-percentiles.md"
      provides: "follow-up for mergeTeamSeasonArtifact / mergeEventArtifact dropping percentiles during live play"
    - path: "apps/web/src/components/team/RankCards.tsx"
      provides: "World card tiered by the published Total percentile; regional cards by rounded percentileForRank"
  key_links:
    - from: "packages/harness/publish.ts publishSeasons per-algorithm block"
      to: "packages/harness/percentiles.ts sortedPoolsByMetric"
      via: "a single pool built from lastOfficialMetricsByTeam(metricHistoryForAlgo, officialEventKeys), passed to withPercentiles, seasonStatsMetricsForTeam, withHistoryPercentiles and buildEventTeamsStanding"
      pattern: "rankingPools"
    - from: "apps/worker/src/scheduled.ts runGlobalRebuild"
      to: "packages/harness/percentiles.ts goodnessPercentileAgainstPools + packages/harness/pageArtifacts.ts publishedTierForPercentile"
      via: "rederiveTeamsRowTiers(rows) before deriveMetricKeyOrder / encodeTeamsRowMetrics"
      pattern: "rederiveTeamsRowTiers"
    - from: "apps/web/src/components/team/SeasonHeader.tsx"
      to: "apps/web/src/components/team/RankCards.tsx"
      via: "worldPercentile prop sourced from artifact.seasonStats.metrics[TOTAL_KEY]?.percentile"
      pattern: "worldPercentile"
---

<objective>
Make the rarity tier a function of (metric value, the one season ranking pool) on every surface of the site, per 260912-tnk-CONTEXT.md's locked rule: the same metric value for the same team, season and algorithm gets the same tier everywhere. The developer's own example (spr 2026 team 6919: Epic in the Teams list, Legendary on its last official event card) must become impossible by construction and be pinned by a test.

Purpose: today the pipeline publishes percentiles from two different pools. The Teams list and seasonStats rank against the last-official-match pool. metricHistory rows and event standings rank against the season-final pool. The live Worker drops tiers entirely, so the Teams list shows a false Common. The World rank card uses a third formula.

Output:
- One ranking pool and one ranking helper in the pipeline, on both publish paths.
- Tier re-derivation in the live global rebuild, within its CPU budget.
- Rank cards that agree with the Total tier.
- A follow-up todo for the live merges this task records but does not fix.
- An audit table of every tier surface, returned in the SUMMARY.

This is fix and tests only. The live site does not change until the developer republishes, deploys the Worker, and pushes the web app. The SUMMARY must say that plainly.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/260912-tnk-audit-rarity-tier-usage-across-the-site-/260912-tnk-CONTEXT.md
@.planning/STATE.md
@.claude/CLAUDE.md
@.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md

HARD PROHIBITIONS (every task):
- Do NOT run `pnpm publish:seasons`, `--event`, or any R2/D1/KV write. Do NOT run any `wrangler` command, deploy anything, or push. Do not attempt network-dependent verification: executor subagents have no network.
- Never read, cat, or echo `.env` (CLAUDE.md "Secrets handling"). No task here needs it.
- Other sessions share this checkout. Stage files by explicit path only, never `git add -A` or `git add .`. Do not touch `.planning/quick/260912-tib-*`, `.planning/todos/pending/quick-tasks-append-corrupts-state-frontmatter.md`, or `scripts/epaVsStatbotics.ts`. Those belong to another session's in-flight quick task. Run `git status` after every commit and confirm only this task's paths landed.
- Do not run `gsd-tools quick-tasks-append` (banned on this checkout). Do not edit STATE.md or write SUMMARY.md: return the SUMMARY text, and the orchestrator writes it.
- Run vitest from the REPO ROOT as `npx vitest run <paths>`. Never use `timeout ... pnpm`, which swallows output and exits 0. Judge a run by its printed summary line (N passed, 0 failed), not its exit code.
- Typecheck all three configs, because the root tsc does not cover apps/web: `npx tsc --noEmit`, `npx tsc --noEmit -p apps/web/tsconfig.json`, and `npx tsc --noEmit -p apps/worker/tsconfig.json`.

Code facts confirmed against HEAD 3afabbec while planning. Line numbers are approximate; grep by name.
- packages/harness/percentiles.ts has these exports:
  - `percentileRanks` (73)
  - `withPercentiles` (119): ranks raw unrounded values and applies `goodnessPercentile` with `metricDirectionOrDefault`.
  - `percentileAgainstSortedPool` (191): no direction, no rounding of the query.
  - `sortedPoolsByMetric` (233): unrounded values.
  - `HISTORY_PERCENTILE_METRIC_KEYS` (272).
- packages/harness/publish.ts has these pieces:
  - `withHistoryPercentiles` (278) and `withEventPercentiles` (388): neither applies direction.
  - `lastOfficialMetricsByTeam` (312).
  - `seasonStatsMetricsForTeam(teamKey, officialWithPercentiles, seasonFinalWithPercentiles)` (352).
  - `withPublishedTiers` (2098) and `buildEventTeamsStanding` (2121).
  - `publishSeasons` (2443). `officialEventKeys` is built at 2533 and the metric-history hook runs at 2697-2726.
  - Per-algorithm block (2857-2914):
    - The season-final pool is built at 2869 and 2879.
    - The official record and its widened copy are built at 2913-2914.
    - `metricHistoryForAlgo` is bound at 2889, AFTER the season-final pool.
  - Teams rows (2984-3060), `rankableTeamRows` (3069), event pool use (3164-3169), seasonStats (3278-3302), metricHistory (3321).
  - `buildSingleEventPublish` (3650): hook at 3712-3730, pool at 3777-3784.
- packages/harness/swingMetric.ts `swingMetricByTeam` ranks Sigma/Swing on a RESIDUAL against a rating-local expected curve (`percentileRanks(residuals)`), not on the value. Both of its consumers (teams row and seasonStats) read the same `swingMetricForAlgo` entry, so they already agree. That tier CANNOT be re-derived from the displayed value. Do not touch swingMetric.ts.
- The rendered team-page season header reads `metricsOverride`, which is the last official metricHistory row resolved client-side by apps/web/src/lib/officialSnapshot.ts. It falls back to `seasonStats.metrics` only when no snapshot is derivable (SeasonHeader.tsx:135). So the header tiles today show the history-row tier, not the seasonStats tier.
- apps/worker/src/scheduled.ts:
  - `runGlobalRebuild` (1467-1539) rebuilds touched rows with `metrics: roundTeamMetricRecord(info.metrics)`. That drops every tier AND the published Sigma entry.
  - `runGlobalRebuild` runs only on the 10-minute interval or when an event completes (1642-1646).
  - `mergeTeamSeasonArtifact` (789) and `mergeEventArtifact` (660) write percentile-free metrics every tick.
- packages/harness/teamRanks.ts:
  - `percentileForRank` (271) is unrounded and uses the rank pool, which counts real rows without a Total.
  - `buildTeamRankScopes` (296).
  - The module is browser-bundled. browserSafeSchemas.test.ts (~222) checks it for Node built-ins only.
- The docs/publish-budget.md-backed tests (packages/harness/payloadBudget.test.ts) read recorded numbers from the doc. They do not re-measure artifacts, so no change here affects them. No key is added to any published artifact: percentile values change, key sets do not. Nothing needs transcribing into docs/publish-budget.md.
</context>

<tasks>

<task type="tracer">
  <name>Task 1: One ranking pool: every published percentile ranked against the last-official-match pool, pinned end-to-end through publishSeasons</name>
  <files>packages/harness/percentiles.ts, packages/harness/percentiles.test.ts, packages/harness/publish.ts, packages/harness/publish.test.ts, packages/harness/metricHistorySchema.ts</files>
  <read_first>
    - packages/harness/percentiles.ts (whole file, 272 lines)
    - packages/harness/metricDirection.ts lines 115-137 (`metricDirectionOrDefault`, `goodnessPercentile`)
    - packages/harness/rounding.ts lines 182-197 (`roundTo`, `roundMetric`; decimal-shift rounding, idempotent)
    - packages/harness/publish.ts lines 250-398, 2092-2136, 2521-2533, 2690-2732, 2857-2915, 2984-3095, 3160-3170, 3272-3325, 3650-3785
    - packages/harness/publish.test.ts lines 160-260 (fixture helpers `findEventArtifact`, `seasonEvent`, `seasonMatch`, `findTeamArtifact`, `seedTwoEventSeason`), 2304-2442, 2821-3053, 4008-4034, 4659-4760
    - packages/harness/percentiles.test.ts lines 72-247
    - packages/harness/metricHistorySchema.ts lines 15-35
  </read_first>
  <action>
Implements CONTEXT "The canonical ranking pool": the ONE pool is the Teams-list pool. It is also consistent BY CONSTRUCTION and PINNED BY A TEST.

A. packages/harness/percentiles.ts: one ranking helper.
- `sortedPoolsByMetric(metricsByTeam, teamKeys)` builds each pool from `roundMetric(metric.value)`. Skip an undefined value, so pool membership is exactly `withPercentiles`'s: a team in teamKeys that has a value.
  - Rank at display precision for two reasons. Two teams that print the same number must share a percentile. And the live Worker only ever sees rounded published values, so without this its re-derivation (Task 2) cannot reproduce offline tiers exactly at a rounding-created tie near a cut.
  - Cite the precedent in the doc comment: publish.ts's `rankableTeamRows` comment (quick task 260905-ttv) already ranks ROUNDED metrics for the same reason.
  - Published values themselves are not rounded here. buildTeamsArtifact and buildTeamSeasonArtifact still own that boundary.
- Add exported `goodnessPercentileAgainstPools(sortedPools, metricName, value): number | undefined`.
  - Return undefined when the map has no pool for the name. Never a coerced 0, per the PD-07 absence contract.
  - Otherwise return `goodnessPercentile(percentileAgainstSortedPool(pool, roundMetric(value)), metricDirectionOrDefault(metricName))`.
  - State in its doc that this is the single function every pool-ranked published percentile goes through.
- Reimplement `withPercentiles(metricsByTeam, teamKeys, sortedPools?)` through that helper. The optional third argument defaults to `sortedPoolsByMetric(metricsByTeam, teamKeys)`, so a caller can pass the pool it already built.
  - Keep its contract: only teams in teamKeys that have a value get a percentile, and nothing is mutated.
  - `percentileAgainstSortedPool` and `percentileRanks` stay unchanged and exported. swingMetric.ts uses `percentileRanks`.
- Add exported `withPoolPercentiles(metrics, sortedPools, allowlist?)`. It takes one team's metric record and returns a NEW record: each metric gets a percentile from the helper when (no allowlist, or the name is in it) and a pool exists; otherwise the metric is copied with no percentile key.
- Rewrite the stale docs so the code does not describe a deleted model:
  - The file header (lines 1-24): one pool now feeds the teams row, seasonStats, metricHistory and event standings.
  - `percentileAgainstSortedPool`'s D-06.1-A doc: it no longer says "SEASON-FINAL distribution" or "against the final field". It now reads "an earlier value ranked against the season's last-official-match field".
  - `sortedPoolsByMetric`'s doc.

B. packages/harness/publish.ts, publishSeasons per-algorithm block:
- Bind `metricHistoryForAlgo` and compute `officialMetricsByTeam = lastOfficialMetricsByTeam(metricHistoryForAlgo, officialEventKeys)` BEFORE any pool.
- Build `rankingPools` exactly ONCE from `officialMetricsByTeam` and `teamsThisSeason`. Pass it to `withPercentiles(officialMetricsByTeam, teamsThisSeason, rankingPools)`.
- Delete the season-final widened record (built ~2869) and the season-final sorted pool (built ~2879): that is the second pool.
- KEEP the unwidened season-final `metricsByTeam`. It is still the swing rating axis for `swingMetricByTeam`, the `metricsAsOfEvent` fallback, and the offseason-only team's values.
- Change `seasonStatsMetricsForTeam` to `(teamKey, officialWithPercentiles, seasonFinalMetrics, rankingPools)`.
  - The official branch and the emptiness check are unchanged.
  - The fallback branch returns `withPoolPercentiles(seasonFinalMetrics[teamKey] ?? {}, rankingPools)`, tagged "season-final". This is CONTEXT's offseason-only rule: ranked against the unified pool, not a second one.
  - Update the call at ~3282.
- Reimplement `withHistoryPercentiles(rows, rankingPools)` as a per-row `withPoolPercentiles(row.metrics, rankingPools, HISTORY_PERCENTILE_METRIC_KEYS)`. Reimplement `withEventPercentiles(metrics, rankingPools)` as `withPoolPercentiles(metrics, rankingPools)`. Keep both exports.
- Pass `rankingPools` at ~3169 (`buildEventTeamsStanding`) and ~3321 (`withHistoryPercentiles`). Direction now applies identically on every surface, per CONTEXT "Direction must survive".
- `buildSingleEventPublish` (the --event path):
  - Build that season's official event-key set from `selectEventMeta(db, season)` filtered by `isOfficialEventType`, the same predicate publishSeasons uses at ~2533.
  - In its `onMatchComplete` hook, when `match.eventKey` is official, call `algorithm.teamMetrics(state, involvedTeams)` ONCE. Reuse that single call for the existing Sigma talent capture when both apply, rather than calling it twice. Overwrite each involved team's entry in a local last-official record whenever the team has metrics: the last official match wins, the same rule as `lastOfficialMetricsByTeam`.
  - After the replay, build the pool with that function's ONE sortedPoolsByMetric call. Use the last-official record and `teamsThisSeason` filtered by `isDemoTeamKey`, for parity with publishSeasons ~2523.
  - Keep exactly one such call and one `buildSeasonStream(` and one `metricsAsOfEvent(` in the function's source range: the structural test at publish.test.ts ~4023 counts them.
  - Keep `seasonFinalMetrics` for the `metricsAsOfEvent` fallback.
  - This path already replays the whole season, so the only added cost is one `teamMetrics` call per official match. The seasons path already pays that cost.
- Rewrite every stale comment describing the season-final pool:
  - `withHistoryPercentiles` doc (~250-277)
  - `seasonStatsMetricsForTeam` doc (~327-351)
  - `withEventPercentiles` doc (~364-387)
  - `buildEventTeamsStanding` doc (~2111-2120)
  - the inline block at ~2861-2912 (rewrite it as one short explanation of the single pool; do not append a changelog)
  - ~3164-3167, ~3278-3281, ~3777-3780
  - packages/harness/metricHistorySchema.ts `MetricValueSchema.percentile` doc (~19-34, "SEASON-FINAL distribution" and "the season-final counterpart")
- Name 260912-tnk as the reason in each rewrite.

C. Tests. Write the invariant test first and watch it FAIL against the unchanged pipeline before implementing A and B. That is the proof it discriminates.
- packages/harness/publish.test.ts: add describe "publishSeasons — one ranking pool across every tier surface (quick task 260912-tnk)", using the temp-corpus pattern at ~2918-2999.
  - Fixture:
    - one season, algorithm `epa` (per-team-independent, so as-of-event values equal a team's last-match values), `includeOffseason: true`
    - at least 9 teams with official play across two official events with varied scores
    - one later offseason event (eventType 99, isOffseason true) with lopsided scores involving some of those teams, so the season-final pool differs from the official pool
    - at least one team that plays ONLY the offseason event
  - Iterate teams from the PUBLISHED teams artifact rows that carry a total. Never use a hardcoded team or season list: that is the iteration-list trap. Assert a non-vacuous floor (at least 9) and that at least one published tier is not Common.
  - Assert per team:
    1. For every key in `HISTORY_PERCENTILE_METRIC_KEYS` present on its last official metricHistory row (official = not the fixture's offseason event key), the row percentile is `toBe` equal to `seasonStats.metrics[key].percentile`.
    2. For every key on seasonStats.metrics, the teams-row `tier` equals `publishedTierForPercentile(seasonStats.metrics[key].percentile)`. Absent on both sides means Common.
    3. On the event artifact of that team's last official event, the standing's percentile for each key equals `goodnessPercentileAgainstPools(pools, key, standingValue)`, where `pools = sortedPoolsByMetric(record of published teams-row metrics, row keys)`. Rounding is idempotent, so this pool equals the pipeline's.
  - Assert for the offseason-only team: seasonStats `metricsBasis` is "season-final", and its total percentile equals `goodnessPercentileAgainstPools(pools, "total", value)`.
  - DISCRIMINATOR: for at least one team, the percentile its official total would receive against the pool built from every team's LAST metricHistory row (the season-final values) differs from the published one. This proves the fixture separates the two pools.
- Add to the existing describe "publishSeasons and --event agree on the SigmaScout layer" (~4675): seed via `seedTwoEventSeason`, then add one later offseason event and match. Publish with `includeOffseason: true`, run `buildSingleEventPublish` on the late event, and assert every team's standings percentile is identical between the two paths for every key.
- Update, do not weaken, the tests this legitimately changes:
  - the `seasonStatsMetricsForTeam` direct tests (~2880-2916): new signature; the fallback now carries unified-pool percentiles
  - the `withHistoryPercentiles` tests (~2304-2353)
  - the real-corpus invariant describe (~2355-2442): retitle it away from "season-final agreement" and compute its expected value through `goodnessPercentileAgainstPools`, so rounding cannot make it flaky
- packages/harness/percentiles.test.ts: add tests for `goodnessPercentileAgainstPools`.
  - A declared lower-is-better name (use `SWING_METRIC_KEY`) inverts exactly as `withPercentiles` does.
  - Two values that collide at 2 decimals share a percentile.
  - For a pool member, it equals `withPercentiles`'s percentile for that team exactly.
  - No pool returns undefined.
- Also test `withPoolPercentiles`: the allowlist is respected, there is no pool-less key, and nothing is mutated.
- Adjust any `sortedPoolsByMetric` test that asserted unrounded values.
- Do not modify `swingMetric.ts` or its tests.

Commit (explicit paths only) as `fix(260912-tnk): rank every published percentile against the one last-official-match pool`.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/percentiles.test.ts packages/harness/swingMetric.test.ts packages/harness/metricDirection.test.ts && npx vitest run packages/harness/publish.test.ts -t "260912-tnk|--event agree|seasonStatsMetricsForTeam|withHistoryPercentiles|replays the season exactly once" && npx vitest run packages/harness/publish.test.ts packages/harness/payloadBudget.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>
- The new invariant describe exists, passes, and was observed failing before the implementation. Its floor, non-Common and discriminator assertions all hold.
- The --event parity test passes, and the structural once-only test still passes.
- publish.test.ts and payloadBudget.test.ts pass in full: the printed summary shows 0 failed.
- Root tsc is clean.
- No season-final pool is built in publishSeasons, and no comment in the touched files still describes history or event percentiles as ranked against the season-final pool.
- Committed by explicit path.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Live Teams list keeps honest tiers: runGlobalRebuild re-derives every row's tier from the one pool (CPU-measured)</name>
  <files>apps/worker/src/scheduled.ts, apps/worker/test/scheduled.test.ts, .planning/todos/pending/live-merges-drop-percentiles.md</files>
  <read_first>
    - apps/worker/src/scheduled.ts lines 1-110 (module header, incl. the GLOBAL REBUILD scope paragraph ~48-62), 140-163 (imports), 470-484, 660-708, 789-855, 880-883, 1395-1438, 1452-1539, 1640-1650
    - apps/worker/test/scheduled.test.ts lines 370-400 (fakes and helpers), 790-960 (the 260902-pbe untouched-row test and the 260908-5wd touched-row test)
    - packages/harness/pageArtifacts.ts lines 196-260 (`TeamMetricSchema.tier`, `publishedTierForPercentile`) and ~1079-1150 (`encodeTeamMetricEntry`, `encodeTeamsRowMetrics`, `deriveMetricKeyOrder`)
    - packages/harness/percentiles.ts as changed by Task 1
    - docs/worker-operations.md lines 480-500 (the pre-season CPU gate) and the "How the CPU budget is actually enforced" section
  </read_first>
  <behavior>
    - Offline parity: start from an UNROUNDED metrics record for about 40 synthetic teams, including two values that collide at 2 decimals right at a tier cut. Compute tiers the way publishSeasons now does: `withPercentiles`, then `publishedTierForPercentile` per metric, with values rounded by `roundMetric`. Feed the rounded, tiered rows to `rederiveTeamsRowTiers`. Every tier is unchanged (offline-identical by construction).
    - A touched row whose value moved into the top 5% gets tier "legendary". A row that fell below the 50th percentile has NO tier key: a stale "epic" is removed, and no "common" string is written.
    - A row's Sigma or Swing entry (value and tier) is never re-tiered, and on a touched row it is carried forward from the prior row unchanged.
    - runTick integration: with a seeded teams artifact of untouched rows plus a tick that touches the fixture teams, every touched row with a total in the WRITTEN artifact (decoded with `decodeTeamsRowMetrics`) carries exactly the tier `rederiveTeamsRowTiers` computes over the written rows' values.
    - The 260902-pbe untouched-row test still proves its value and spread survive the round trip exactly. Its tier is asserted to equal the re-derived one rather than dropped from the assertion.
  </behavior>
  <action>
Implements CONTEXT "Live-event gap (developer chose: INCLUDE it)": the Teams list must not fall back to a false Common during live updates. This uses the PREFERRED approach: re-derive tiers for all rows with the shared helper.

1. In apps/worker/src/scheduled.ts, add exported pure `rederiveTeamsRowTiers(rows)`. Rows are record-form teams rows, which `runGlobalRebuild` owns: they are freshly decoded or freshly built.
   - Build pools once with `sortedPoolsByMetric` from packages/harness/percentiles.ts, over a record keyed by `row.teamKey` of `row.metrics`, with the rows' team keys as the pool membership.
   - For every metric entry whose key is NOT `SIGMA_METRIC_KEY` (packages/harness/sigmaScore.ts) or `SWING_METRIC_KEY` (packages/harness/swingFactor.ts), compute `publishedTierForPercentile(goodnessPercentileAgainstPools(pools, key, entry.value))`. Assign it to `entry.tier`, or delete `entry.tier` when the result is undefined.
     - Exclude those two keys because their tier is a rating-local residual rank (swingMetric.ts), not a value rank. It cannot be re-derived from the displayed value.
   - Mutate the entries in place rather than spreading new objects. Allocation is the dominant cost at about 3,800 rows by 18 keys.
   - Never add an entry for a key a row lacks.
   - Document that membership matches the pipeline's pool: teams rows are `teamsThisSeason` with official-scoped metrics, and a row with no official play carries no metric entries.
2. In `runGlobalRebuild`:
   - Build each touched row's metrics as the prior row's entries for `SIGMA_METRIC_KEY` and `SWING_METRIC_KEY` (when present), overlaid by `roundTeamMetricRecord(info.metrics)`. The live tick does not compute the season-final consistency figure, so the published one is kept rather than dropped. Today a touched spr team loses its Sigma value and tier until the next publish.
   - Then call `rederiveTeamsRowTiers(rows)` before `deriveMetricKeyOrder`.
   - This adds zero subrequests and runs only on the global-rebuild cadence (10 minutes, or when an event completes).
   - Update the module header's GLOBAL REBUILD paragraph and `runGlobalRebuild`'s doc to say tiers are re-derived and what the added CPU was measured at.
3. CPU gate (CONTEXT: "Any added work must be measured/reasoned about, not assumed free"). Measure before committing.
   - Write a throwaway timing script OUTSIDE the repo, in the executor's temp or scratchpad directory. Never commit it.
   - Build a synthetic positional teams artifact text of 3,800 rows by 18 metric keys, plus a Sigma entry with tiers, through `encodeTeamsRowMetrics` / `deriveMetricKeyOrder`, so its shape matches what the Worker reads.
   - BASELINE is the rebuild's existing CPU-bound path: `JSON.parse`, `TeamsArtifactSchema.parse`, `deriveMetricKeyOrder`, `encodeTeamsRowMetrics` over every row, and `JSON.stringify`.
   - ADDED is `rederiveTeamsRowTiers` on the decoded rows.
   - Run each with `npx tsx`: 20 warm-up runs, then take the median of 50.
   - Accept if the ADDED median is at most 25% of the BASELINE median, and record both medians in `rederiveTeamsRowTiers`'s doc comment and in the SUMMARY.
   - If the gate fails, use CONTEXT's fallback instead. Do not re-derive; for each touched row, copy the prior row's `tier` onto the same key's new entry when the prior entry exists. Record the measurement that forced it.
   - Note in the SUMMARY that live windows are currently forbidden by the pre-season CPU gate in docs/worker-operations.md, so this path is not exercised in production until that gate closes.
4. Tests go in apps/worker/test/scheduled.test.ts, in a new describe "260912-tnk: live Teams-row tiers", covering the behavior list above. The parity test imports `withPercentiles`, `sortedPoolsByMetric`, `goodnessPercentileAgainstPools` (packages/harness/percentiles.ts), `publishedTierForPercentile` (pageArtifacts.ts) and `roundMetric` (rounding.ts). Do not import packages/harness/publish.ts into the worker tests.
   - Update the 260902-pbe assertion at ~848: keep `value` and `spread` exact, and assert `tier` equals the helper's result.
   - Extend the 260908-5wd touched-row test (~864) so its seeded prior row carries a `sigma` entry with a tier, and assert that entry survives.
5. Write the follow-up todo `.planning/todos/pending/live-merges-drop-percentiles.md`. Use the frontmatter shape of the existing pending todos: id, created 2026-09-12, source quick task 260912-tnk, priority medium. It records CONTEXT's audited-but-not-fixed live gaps:
   - `mergeTeamSeasonArtifact` writes `seasonStats.metrics` and appended metricHistory rows with no percentiles, and drops `metricsBasis`. Touched teams' header tiles, new event cards and the World rank card render untiered. It also writes `seasonStats.metrics` from offseason ticks unscoped.
   - `mergeEventArtifact` writes touched standings without percentiles.
   - Why it was not fixed here: every tick would need the Teams artifact, which is the pool. That means one more R2 read per algorithm and a full decode, on a Worker already over its sustained CPU budget per docs/worker-operations.md. CONTEXT allowed a fix only without reading the Teams artifact every tick.
   - A candidate direction for later, not a decision: carry a compact pool (per-key sorted values) somewhere cheap to read.

Commit (explicit paths only) as `fix(260912-tnk): re-derive Teams-row tiers in the live global rebuild`.
  </action>
  <verify>
    <automated>npx vitest run apps/worker/test/scheduled.test.ts apps/worker/test/scheduled.officialRecord.test.ts apps/worker/test/scheduled.replay.test.ts apps/worker/test/scheduled.rp.test.ts && npx tsc --noEmit -p apps/worker/tsconfig.json && npx tsc --noEmit</automated>
  </verify>
  <done>
- `rederiveTeamsRowTiers` is exported and called from `runGlobalRebuild`.
- All behavior tests pass, including offline parity with rounding collisions at a cut, stale-tier removal, and the carried-forward Sigma entry.
- The worker test files pass with 0 failed in the printed summary, and both tsc runs are clean.
- The CPU measurement was taken, and its two medians plus the gate verdict are recorded in the doc comment and returned for the SUMMARY.
- The follow-up todo exists.
- Committed by explicit path.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Rank cards agree with the Total tier; audit every other tier surface</name>
  <files>packages/harness/teamRanks.ts, packages/harness/teamRanks.test.ts, apps/web/src/components/team/RankCards.tsx, apps/web/src/components/team/RankCards.test.tsx, apps/web/src/components/team/SeasonHeader.tsx, apps/web/src/components/team/EventSection.tsx</files>
  <read_first>
    - packages/harness/teamRanks.ts lines 1-31 (header and imports), 241-334
    - packages/harness/teamRanks.test.ts lines 289-325
    - apps/web/src/components/team/RankCards.tsx (whole file, 155 lines)
    - apps/web/src/components/team/RankCards.test.tsx lines 1-20 and 135-175
    - apps/web/src/components/team/SeasonHeader.tsx lines 18-48, 110-136, 260-270
    - apps/web/src/components/team/EventSection.tsx lines 118-146
    - apps/web/src/lib/tiers.ts, apps/web/src/lib/officialSnapshot.ts
    - For the audit only, read just enough to classify each surface: apps/web/src/components/teams-table/columns.tsx ~380-390, rowModel.ts ~105-175, teamsBubbleModel.ts lines 1-20 and ~225-240, apps/web/src/components/event/InsightsTab.tsx ~245-295, BreakdownTab.tsx ~315-322, AlliancesTab.tsx ~425-510, apps/web/src/lib/allianceTierApproximation.ts lines 1-100, apps/web/src/components/match/MatchRobotGrid.tsx ~95-105, apps/web/src/lib/preMatchMetrics.ts lines 1-90, apps/web/src/components/team/TierKeyRow.tsx
  </read_first>
  <behavior>
    - The World card's tier comes from the `worldPercentile` prop, not from rank. At rank 1 of 3481 with worldPercentile 94.9, the World card carries `rank-card--epic`, not legendary.
    - With worldPercentile absent, the World card carries no `rank-card--` tier modifier at all. It never falls back to `percentileForRank`.
    - Regional cards use the rounded rank percentile. `percentileForRank(126, 2500)` is exactly 95 (raw 94.98 rounds to 95.0), so a country card at rank 126 of 2500 carries `rank-card--legendary`.
    - `percentileForRank` now agrees EXACTLY (`toBe`, no longer `toBeCloseTo`) with `percentileRanks` for the r-th-best member of a strictly ordered pool. Rank 1 of 1 is still 50.
    - SeasonHeader passes `artifact.seasonStats.metrics.total?.percentile` as `worldPercentile`, even when `metricsOverride` is supplied with a different total percentile.
  </behavior>
  <action>
Implements CONTEXT "Team-page rank cards": the World card's tier must agree with the Teams-list Total tier. Regional cards use the same formula and rounding convention, so the only difference is the pool. Also implements CONTEXT's Claude's-Discretion audit of the remaining surfaces.

1. apps/web/src/components/team/RankCards.tsx:
   - Add optional prop `worldPercentile?: number`.
   - For `entry.scope === "world"`, the tier is `tierForPercentile(worldPercentile)`. This is the team's published Total percentile, the exact number the Teams-list Total tier is stamped from (both come from publish.ts's official-pool widened record).
   - For every other scope, the tier is `tierForPercentile(percentileForRank(entry.rank, entry.total))`.
   - Update the component doc: the World pool IS the season ranking pool, so its tier is the Total tier from a single source. Regional pools are subsets no published percentile covers, so they use the rank-specialised mid-rank convention, rounded identically.
2. apps/web/src/components/team/SeasonHeader.tsx:
   - Pass `worldPercentile={artifact.seasonStats.metrics[TOTAL_KEY]?.percentile}` to RankCards.
   - Use seasonStats deliberately, NOT the resolved `metricsOverride`. Before the developer's republish, history rows are still ranked against the old season-final pool (CONTEXT's measured column (c)). seasonStats is the record measured equal to the Teams list today. After Task 1 plus a republish, the two are identical anyway.
   - A live-merged artifact without a percentile renders the World card untiered: an honest absence, matching the header's own tiles.
   - Rewrite the stale comment at ~113-117 ("an as-of-then value tiered against the season-final pool") to name the one pool.
3. packages/harness/teamRanks.ts `percentileForRank`:
   - Round with `roundTo(..., ROUNDING_RULE.percentile)`, importing from `./rounding.js`. That module has no imports of its own, so it stays browser-safe; browserSafeSchemas.test.ts checks this module for Node built-ins only.
   - Replace the "Deliberately NOT rounded" paragraph with the 260912-tnk rationale: a regional card must resolve a borderline position exactly as a metric tile does.
   - State that the function now serves regional scopes only.
   - Record the one residual honestly. Rank pools strictly order equal totals by team number, so two tied teams in one region get adjacent percentiles where mid-rank would give one. That matches the distinct ranks the card prints. A row without a Total cannot enter a regional pool, because `deriveTeamRegions` votes only official events and every algorithm guarantees a Total.
   - Update the file header's sentence listing this module's imports.
4. Tests:
   - RankCards.test.tsx: cover the behavior list, and update the existing "tier colour" tests (~135-173) to pass `worldPercentile` wherever they assert a World tier.
   - teamRanks.test.ts: update ~289-325 as above.
   - Add a SeasonHeader test only if SeasonHeader.test.tsx already renders RankCards (check first). Otherwise the RankCards prop test is sufficient.
5. apps/web/src/components/team/EventSection.tsx: rewrite the D-06.1-A comment (~124-133) so it says the card's percentile ranks this as-of-event value against the season's last-official-match field. This is a comment-only change. Keep the G-06.1-28 paragraph intact.
6. Audit record. Return this in the SUMMARY text; do not write a separate file. It is a table of every tier surface with columns: surface and file, the data it tiers from, the pool before this task, the disposition. Rows:
   - Teams list metric cells and Sigma column (columns.tsx ~387, rowModel.ts): published `tier`. Consistent. Live gap fixed by Task 2.
   - Teams bubble chart (teamsBubbleModel.ts ~239): published `tier` with a "neutral" fallback, which is the documented 260909-tom rendering of Common-or-unranked, not a different tier. No change.
   - Season header tiles (SeasonHeader.tsx, via `metricsOverride` = last official history row): season-final pool before. Fixed by Task 1.
   - Season header Sigma tile: residual rank shared with the teams row through one `swingMetricForAlgo` entry. Consistent.
   - Event cards (EventSection.tsx): fixed by Task 1.
   - Rank cards: this task.
   - TierKeyRow: a static legend.
   - Event Insights, Breakdown and Alliances pick cells: event artifact, fixed by Task 1 on both publish paths.
   - allianceTierApproximation.ts: interpolates the event's published (value, percentile) pairs, so it inherits Task 1. It is approximate by design for an alliance value no team holds.
   - Match robot grid via preMatchMetrics.ts: history rows, fixed by Task 1.
   - Live Worker surfaces: Task 2 plus the follow-up todo.
   Fix any further surface only if it violates the rule and the fix is local. Otherwise record it in the table.
7. The SUMMARY must also state plainly:
   - The live site is unchanged until the developer republishes (Task 1's percentiles), deploys the Worker (Task 2), and pushes the web app (Task 3). The World-card change works against today's artifacts as soon as the web app deploys.
   - No docs/publish-budget.md transcription is owed: no published key was added.
   - Where the code contradicted CONTEXT:
     - the rendered header reads the history row, not seasonStats
     - Sigma and Swing tiers are residual ranks and cannot be re-derived from the value
     - the pipeline ranked unrounded values while the Worker sees only rounded ones

Commit (explicit paths only) as `fix(260912-tnk): tier the World rank card by the Total percentile, round regional cards`.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/teamRanks.test.ts packages/harness/browserSafeSchemas.test.ts apps/web/src/components/team apps/web/src/components/teams-table apps/web/src/components/event apps/web/src/components/match apps/web/src/lib && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit</automated>
  </verify>
  <done>
- The World card is tiered by the published Total percentile and is untiered when that percentile is absent.
- Regional cards use the rounded `percentileForRank`.
- All behavior tests pass. The listed web and harness test paths pass with 0 failed in the printed summary, and both tsc runs are clean.
- No stale "season-final pool" comment remains in SeasonHeader.tsx or EventSection.tsx.
- The audit table and the plain "live site unchanged until republish" statement are included in the returned SUMMARY text.
- Committed by explicit path.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| .env -> agent transcript | Live TBA and R2 credentials sit in the working tree; no task needs them |
| executor -> production R2/D1/KV | A publish or wrangler command would write live data or deploy |
| shared checkout -> other sessions | Concurrent sessions have uncommitted work in the same tree |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-tnk-01 | Information disclosure | .env | high | mitigate | Hard prohibition in context: never Read, cat or echo .env. No verification step needs a secret. |
| T-tnk-02 | Tampering | production artifacts and Worker | high | mitigate | No publish:seasons, --event, wrangler, deploy or push. Verification is local vitest and tsc only. |
| T-tnk-03 | Tampering | other sessions' files | medium | mitigate | Stage by explicit path. Named off-limits paths. Run git status after each commit. |
| T-tnk-04 | Denial of service | Worker CPU budget | medium | mitigate | Task 2's measured 25%-of-baseline gate, with the carry-forward fallback. Global-rebuild cadence only. Zero added subrequests. |
</threat_model>

<verification>
After all three tasks, from the repo root:
- `npx vitest run packages/harness/percentiles.test.ts packages/harness/publish.test.ts packages/harness/teamRanks.test.ts packages/harness/browserSafeSchemas.test.ts packages/harness/payloadBudget.test.ts packages/harness/swingMetric.test.ts packages/harness/metricDirection.test.ts apps/worker/test apps/web/src/components apps/web/src/lib`
  - The printed summary must show 0 failed. publish.test.ts includes real-corpus replays and may take several minutes. Do not wrap it in `timeout`.
- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json` and `npx tsc --noEmit -p apps/worker/tsconfig.json`, all clean.
- `git status --porcelain` shows no modification by this task to `.planning/quick/260912-tib-*`, `.planning/todos/pending/quick-tasks-append-corrupts-state-frontmatter.md`, `scripts/epaVsStatbotics.ts`, or `.env`.
- `git log --oneline -3` shows the three 260912-tnk commits, each containing only its task's paths.
</verification>

<success_criteria>
- One ranking pool per (algorithm, season): the last-official-match pool. It feeds the teams row, seasonStats (including offseason-only teams), metricHistory, and event standings on both publish paths. A single direction-aware, display-precision helper produces every pool-ranked percentile.
- A publishSeasons fixture test proves the Teams-list tier, seasonStats percentile and last-official history row percentile agree for every published team with official play. It asserts a floor, a non-Common tier, and a discriminator showing the old pool would have failed.
- The live global rebuild re-derives tiers offline-identically, keeps Sigma entries, and its measured added CPU is recorded against the gate. The live team and event merge gaps are recorded as a follow-up todo.
- The World rank card agrees with the Total tier, and regional cards share the rounding convention.
- The audit table and the "live site unchanged until republish" statement are in the SUMMARY. Nothing was published, deployed or pushed.
</success_criteria>

<output>
Return the SUMMARY text, including the Task 2 CPU medians, the Task 3 audit table, and the contradictions with CONTEXT. The orchestrator writes `.planning/quick/260912-tnk-audit-rarity-tier-usage-across-the-site-/260912-tnk-SUMMARY.md` and handles STATE.md. Do not write either file.
</output>
