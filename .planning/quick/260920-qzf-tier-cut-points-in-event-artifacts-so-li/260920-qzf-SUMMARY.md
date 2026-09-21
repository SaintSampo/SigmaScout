---
quick_id: 260920-qzf
subsystem: event-artifacts
tags: [zod, rarity-tier, tiercuts, live-worker, event-artifact, web-ui]
key-files:
  created:
    - packages/harness/tierCuts.ts
    - packages/harness/tierCuts.test.ts
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/harness/percentiles.ts
    - packages/harness/publish.ts
    - apps/worker/src/artifactMerge.ts
    - apps/worker/test/scheduled.mergePreservation.test.ts
    - apps/web/src/lib/tiers.ts
    - apps/web/src/components/event/BreakdownTab.tsx
    - apps/web/src/components/event/InsightsTab.tsx
    - apps/web/src/components/event/AlliancesTab.tsx
    - apps/web/src/components/match/MatchRobotGrid.tsx
    - apps/web/src/components/team/EventSection.tsx
    - apps/web/src/components/team/useLiveTeamSeason.ts
    - .planning/todos/pending/live-merges-drop-percentiles.md
completed: 2026-09-20
status: complete
---

# 260920-qzf: tier cut points in event artifacts so live-folded rows keep their rarity tier

**Code complete and tested. Nothing is live yet: a republish (so artifacts carry the block) and a
push (Pages deploy) are owed.**

## The defect this closes

A live tick writes touched standings and `live` block rows with a value and no percentile, because
the Worker computes none. Every touched team rendered with no rarity tier until the next offline
publish. On 2026-09-20 that hit all 42 teams at Chezy Champs at once. Computing percentiles in the
tick needs the season pool and is blocked behind `rp-fold-exceeds-worker-cpu-budget`. This ships
the answer (three numbers per metric) instead of the pool (thousands).

## What changed

- A tier is a monotone step function of the rounded value against a fixed pool, so three cut
  values per metric reproduce it exactly. `buildTierCutsFromPools` (`percentiles.ts`) derives them
  from the same `rankingPools` every published percentile ranks against, by evaluating the
  reference formula at every distinct pool value and one grid step either side. Neighbouring grid
  values are `roundMetric(v ± 0.01)`, never bare addition.
- Event artifacts carry an optional `tierCuts` block: `{ metricName: { cuts: [rare, epic,
  legendary], lower?: true } }`. Declared on `EventArtifactSchema` so the Worker's write-side parse
  keeps it; `.catch(undefined)` so a malformed block degrades to absent. No
  `PAGE_ARTIFACT_SCHEMA_VERSION` bump: additive and optional.
- `sigma` is excluded structurally. The cuts map's key set is the pool's key set, and sigma never
  enters that pool. Its published percentile is a within-window rank, so a pool-derived cut would
  paint a wrong tier.
- The Worker merge is unchanged. `tierCuts` rides the existing spread. Doc comments only.
- Web: `resolveMetricTier` prefers a published percentile and falls back to `tierFromCuts` only
  when it is absent. Wired into BreakdownTab, InsightsTab, AlliancesTab, MatchRobotGrid and
  EventSection. The team and match pages already hold the event artifact, so no new fetch. No class
  string, palette or spacing change.
- `live-merges-drop-percentiles.md` rewritten: the tier gap is closed, the percentile NUMBER gap
  stays open and stays blocked.

## No published number changes, so no version bump

Every value, spread, percentile, tier, prediction and pmf is byte-identical. This adds a derived
key computed from the pool that produced the percentiles beside it.

## Size

Measured against a 3,700-team pool with each season's real metric names: 368 to 645 bytes per
event artifact, worst case 2016. Largest event body today is 228,865 B against a 350,000 B ceiling.
No ceiling moves.

## What this does not fix

The percentile number (World rank card, the Alliances combined estimate) stays absent for a
live-folded row and is never approximated. A bootstrap write of an event with no published artifact
carries no cuts and renders untiered as before.

## Commits

1. `57df9c2d` feat: cuts are built, published, and proven to reproduce the published tier exactly
2. `610d796e` test: pin that the cuts block survives a live merge, and say so in the merge's own docs
3. `c67313ab` feat: the client derives a tier from cuts whenever a percentile is missing

## Verification

- Exactness sweep (`tierCuts.test.ts`): tier from cuts equals tier from percentile for every
  distinct rounded pool value and one grid step either side, both directions, with ties on each
  band edge, negatives, singleton and all-identical pools, far extremes, and a 400-team pool over
  every registered season's metric names. Zero mismatches.
- Worker: the block survives a folding tick and the write-side parse; a bootstrap merge carries
  none; an artifact without it still merges.
- Executor: root `npx vitest run`, 259 files, 5822 passed, 1 skipped. Root, worker and web
  `tsc --noEmit` clean.

## Owed

1. `pnpm publish:seasons`, then commit the budget doc
2. Push, then `gh run list`
3. Rerun the live-only Playwright specs
4. A screenshot check of a live-folded event page
