---
quick_id: 260927-uen
status: complete
date: 2026-09-27
subsystem: web (team page header), worker (comment-only)
tags: [rarity-tier, team-page, live-fold, tierCuts]
dependency-graph:
  requires: [260923-3x0-team-artifact-tier-cuts]
  provides: [team-header-tiers-from-cuts]
  affects: [apps/web/src/components/team/SeasonHeader.tsx, apps/web/src/components/team/RankCards.tsx]
tech-stack:
  added: []
  patterns: [resolveMetricTier fallback to artifact.tierCuts, derived-entry tier guard, resolved-tier-prop-not-percentile-prop]
key-files:
  created: []
  modified:
    - apps/web/src/components/team/SeasonHeader.tsx
    - apps/web/src/components/team/SeasonHeader.test.tsx
    - apps/web/src/components/team/RankCards.tsx
    - apps/web/src/components/team/RankCards.test.tsx
    - apps/web/src/routes/team.$teamNumber.test.tsx
    - apps/web/src/lib/tiers.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/src/artifactMerge.ts
    - docs/worker-operations.md
    - .planning/todos/completed/live-merges-drop-percentiles.md (moved from pending)
decisions:
  - "World card fallback reads the last-official snapshot row through resolveMetricTier, never cuts on the live seasonStats value (Finding 3, departs from the orchestrator's seasonStats-only framing on the new fallback path only)"
  - "Derived group entries (withDerivedGroupMetrics) never take a cut — the guard compares resolvedMetrics[group.metricKey] before passing tierCuts"
  - "Sigma pill stays tierForPercentile-only; no tierCuts change, backed by a new web guard test rather than a Worker test"
metrics:
  duration: "~1h"
  completed: 2026-09-27
actuals:
  tokens: 10143
  tasks: 3
  commits: 3
---

# Phase quick-260927-uen Plan 01: Team header tiers from season cut points Summary

Gives the team page header its rarity tiers back during a live fold. Since 260923-3w6 the tick
rewrites the team-season artifact and `touchedEventTeamMetrics` writes `seasonStats.metrics` as
rounded values with no `percentile`, so the header's Total tile, phase tiles and World rank card
went untiered until the next republish. The team artifact has carried the season `tierCuts` block
since 260923-3x0 and `EventSection` already resolved through it; this task wires the header the
same way and closes `live-merges-drop-percentiles`.

**No Worker behaviour, publisher, or artifact-shape change. No republish and no deploy.** The
`apps/worker` edits are comment-only (verified by a diff gate before committing).

## What changed, per commit

### 1. Tracer — Total tile (`ee988fb0`)

`SeasonHeader.tsx`'s Total tile now computes `totalTier` via
`resolveMetricTier(totalMetric, TOTAL_KEY, artifact.tierCuts)` instead of
`tierForPercentile(totalMetric?.percentile)`. Total is never a derived entry
(`withDerivedGroupMetrics` only adds group keys), so it needs no derived guard. Proved at the
route level in `team.$teamNumber.test.tsx`: two new `260927-uen:` cases beside the existing
260923-3x0 route cases, using the same `artifactWithLiveFoldedRow` fixture. Read the rendered
`season-header-as-of` label first to confirm this fixture renders season-final (the fixture's
`events/{year}` fetch returns a team-shaped body, which `EventsArtifactSchema` rejects, so
`eventsQuery` never resolves and `metricsOverride` stays undefined) — so the pinned tier is the
`seasonStats.total` value (48.33) against the fixture's cuts `[31.17, 52.4, 88.05]`: rare. The
no-cuts case confirms no `.metric-tier` element renders and the value (48.33) still does.

### 2. Expand — phase tiles, World card, Sigma guard (`a44ba6f9`)

- `MetricGridCell` stops deriving its own tier; it now takes a resolved `tier` field on its
  `tile` prop.
- Each phase group tile's tier is `resolveMetricTier(metrics[group.metricKey], group.metricKey,
  cuts)`, where `cuts` is `artifact.tierCuts` only when `resolvedMetrics[group.metricKey]` is
  defined, `undefined` otherwise (Finding 2's derived guard) — a client-summed stale-artifact
  entry never takes a cut-derived tier.
- `worldTier` is computed in `SeasonHeader`: `tierForPercentile` of
  `artifact.seasonStats.metrics[TOTAL_KEY]?.percentile` when defined, else
  `resolveMetricTier(metricsOverride?.[TOTAL_KEY], TOTAL_KEY, artifact.tierCuts)` — the
  last-official snapshot row's own tier, never cuts on the live `seasonStats` value.
- `RankCards`' `worldPercentile?: number` prop is replaced by `worldTier?: Tier`, used directly
  for the world scope. `SeasonHeader` is the module's only caller.
- Sigma pill is unchanged (`tierForPercentile(seasonSigmaMetric?.percentile)` only); a doc
  sentence and a new guard test pin that it never reads `tierCuts`.
- `tiers.ts`'s `resolveMetricTier` doc comment corrected (it read "the event artifact's
  `tierCuts` block", stale since 260923-3x0) to say it reads the block off whichever artifact
  the caller holds, naming `SeasonHeader` alongside `EventSection`. No code changed in that file.
- New `SeasonHeader.test.tsx` describe "live-folded tiers from tierCuts (260927-uen)": nine
  cases covering the four-tiers-from-one-render case, published-percentile-wins, no-tierCuts,
  the override-source case (Finding 3), both World fallback cases, World's outright
  published-percentile win, the derived guard, and the Sigma guard.
- `RankCards.test.tsx`'s three World-card cases updated to pass `worldTier` instead of
  `worldPercentile`.

### 3. Close the todo, sweep references (`c0551e1e`)

`git mv`'d `live-merges-drop-percentiles.md` from `pending` to `completed` before any edit (the
known edit-then-`git mv` content-drop trap on this machine), then inserted a
`STATUS 2026-09-27: CLOSED` blockquote directly under the frontmatter, above the existing
2026-09-23 block, covering: the percentile-NUMBER half needed no work (no web surface prints
one); the real gap was the header, now resolved through `resolveMetricTier` with the team
artifact's `tierCuts`; the World card's fallback and derived-guard rules; the Sigma pill needing
nothing (cites the two Worker tests); the Alliances Combined Total tier still thinning during
live folds (accepted, out of scope — `allianceTierApproximation.ts` needs a published percentile
number, not a tier); and that the unscoped offseason `seasonStats` write is still how the Worker
behaves, with no reader-visible defect remaining from it after this task.

Swept every stale reference to the pending path across `apps/worker/src/scheduled.ts` (two
sites: the file header and `runScheduleOnlyPricing`'s doc comment),
`apps/worker/src/artifactMerge.ts` (two sites: `mergeTeamSeasonArtifact`'s `seasonStats` comment
and `touchedEventTeamMetrics`'s doc), and `docs/worker-operations.md` (one site, with a half-sentence
added that the team page header now tiers from the same block). The Worker edits are
comment-only, verified before committing with a diff gate that strips comment-prefixed lines and
asserts the remainder is empty.

## Deliberate calls

- **World card fallback source (Finding 3).** The published `seasonStats` Total percentile always
  wins. When absent, the fallback reads the last-official snapshot row
  (`metricsOverride[TOTAL_KEY]`) through `resolveMetricTier` — its own published percentile
  (Finding 1 pins this equal to `seasonStats`' for these keys), or cuts on its value for a
  live-folded official row. It is never cuts on the live `seasonStats` value itself, because the
  tick overwrites that value with the algorithm's CURRENT state (the schedule-only path and every
  offseason fold — the only live folds in late September), an instant the rank beside the card and
  the Teams list do not describe. This is the one place this task departs from a
  "keyed on seasonStats Total" framing, and only on the new fallback path.
- **Derived guard (Finding 2).** `withDerivedGroupMetrics` sums present components client-side for
  a stale artifact with no published group entry; that sum is not guaranteed to equal the value
  the publisher would rank. An entry in `metrics` but not in `resolvedMetrics` (so it is derived)
  never takes a cut and stays untiered, as today.
- **Sigma needs no change (Finding 4).** No algorithm's `teamMetrics` emits a `sigma` key; the
  tick carries the prior published Sigma entry, percentile included, into `seasonStats.metrics`
  unchanged (pinned by two existing Worker tests). `SeasonTierCutsSchema` never carries `sigma`.
  Added a web guard test, no Worker test.
- **Percentile NUMBER stays out of scope.** No web surface prints a percentile number — only a
  tier colour and, on the World card, a rank plus its pool size — so the todo's "number" half
  needed no work. `allianceTierApproximation.ts` still needs published percentiles as
  interpolation points, so the Alliances Combined Total tier still thins during live folds;
  recorded as accepted and out of scope in the closed todo.

## Is a republish needed?

No. The `tierCuts` block is already live on every republished team file (since 260923-3x0); this
task only changes how the client reads it. No algorithm version bump, no schema change, no visual
change to an already-tiered surface.

## Tests and build

```
npx vitest run 'apps/web/src/routes/team.$teamNumber.test.tsx' apps/web/src/components/team/SeasonHeader.test.tsx  (Task 1)
 Test Files  2 passed (2)
      Tests  47 passed (47)

npx vitest run apps/web/src/components/team apps/web/src/routes apps/web/src/lib/tiers.test.ts  (Task 2)
 Test Files  35 passed (35)
      Tests  674 passed (674)

npx vitest run  (repo root, Task 3)
 Test Files  298 passed (298)
      Tests  6961 passed | 1 skipped (6962)

npx tsc --noEmit (root): no output
npx tsc --noEmit -p apps/web/tsconfig.json: no output
npx tsc --noEmit -p apps/worker/tsconfig.json: no output
```

No peer-baseline failures encountered — another session's untracked `.planning/quick/` work
(`260927-ue3-...`) was present throughout but never overlapped a file this plan touched, and it
was committed by that session mid-task without conflict.

## Commits

| Commit | What |
|---|---|
| `ee988fb0` | the header Total tile tiers from tierCuts, proven through the real route |
| `a44ba6f9` | phase tiles and the World rank card tier from tierCuts; Sigma stays percentile-only |
| `c0551e1e` | close `live-merges-drop-percentiles`; sweep stale references (Worker edits comment-only) |
