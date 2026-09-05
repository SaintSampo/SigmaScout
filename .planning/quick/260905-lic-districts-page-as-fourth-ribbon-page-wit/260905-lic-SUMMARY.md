---
quick_id: 260905-lic
status: complete
date: 2026-09-05
commits:
  - 1b8a8785 (Task 1 — district ingest into the corpus)
  - 91af577a (Task 2 — point model, lock math, publish script)
  - e0f7dcdc (Task 2 fix — award ceiling raised to 15, official-model citation)
  - b67ec75a (Task 3 — /districts route, fourth ribbon link, four tabs)
---

# Quick Task 260905-lic: Districts page with Insights, Breakdown, District Locks, Champ Locks

## What shipped

- **Corpus**: three new tables — `districts` (with TBA's official `dcmp_slots`/`cmp_slots`
  capacities), `district_rankings` (per-team totals plus `event_points_raw` verbatim JSON),
  `event_teams` (registration — the only way to know a team still has an event ahead).
  Four new ETag-aware TBA fetchers, a pure normalize module, and a `--districts-only`
  ingest mode (`pnpm ingest:districts`).
- **Real ingest (run from the main context; executor sandboxes deny network)**:
  | Season | Districts | Ranking rows | District events | Registrations |
  |--------|-----------|--------------|-----------------|---------------|
  | 2019 | 11 | 1,782 | 117 | 4,405 |
  | 2020 | 11 | 1,816 | 117 | 3,834 |
  | 2022 | 11 | 1,451 | 116 | 3,690 |
  | 2023 | 11 | 1,592 | 115 | 4,049 |
  | 2024 | 11 | 1,675 | 119 | 4,235 |
  | 2025 | 12 | 1,748 | 125 | 4,424 |
  | 2026 | 14 | 2,130 | 150 | 5,299 |

  Totals: 81 districts, 12,194 ranking rows, 29,936 registrations (749 TBA requests, all 200s).
- **Math core** (`packages/core/districts/`): `pointModel.ts` (per-season per-tier ceilings),
  `locks.ts` (pure `computeLocks`: locked / eliminated / contending / unknown + `pointsToLock`,
  O(n log n)), and `reconciliation.test.ts` — a corpus-wide scan proving every declared ceiling
  is at or above every component value TBA has ever actually reported in any ingested season.
- **Artifacts**: `districtsIndexKey`/`districtDetailKey` + Zod schemas in
  `packages/harness/pageArtifacts.ts` (deliberately outside `PageKind`; no Worker edit).
  `scripts/publishDistricts.ts` (`pnpm publish:districts`), artifacts-before-index ordering.
  Published to R2 and verified served by content at `data.sigmascout.org`.
  Sizes (2026): largest `v1/district/2026fim.json` 427,663 B; index 2,089 B; season total 1,702,423 B.
- **UI**: Districts is the fourth ribbon link. `/districts` has a district picker
  (empty state until one is chosen), `?district=` and `?tab=` URL state, and four tabs —
  Insights (lean: capacities, cut lines, tallies, top-N), Breakdown (expandable per-event
  qual/alliance/playoff/award components, never collapsed into a total), and District Locks /
  Champ Locks (one shared component; status, points-still-needed or explicit "no longer
  attainable", capacity + cut line in the header, and the conservatism caveat in plain language).

## The lock math's honesty guarantees

- Ties count as possible losses (`>=` threat comparison) — tiebreakers are not modeled.
- `slots: null` (TBA published no capacity) renders "capacity not published", never a guess.
- Declines/waitlists/wildcards are unmodeled and can only move a team **up**, so a `locked`
  verdict stays conservative; the UI says this out loud.
- **Award-ceiling correction (e0f7dcdc)**: the Task 2 executor derived ceilings from corpus
  maxima (award=10 for 2023+). Verified against the official district point model: per-award
  values (Impact 10, EI/RAS 8, judged 5) are unchanged since 2019, stacking is legal and
  demonstrated in-corpus (15 in 2019/2020, 13 in 2022), and no rule caps it. A too-low ceiling
  can produce a false "locked" guarantee, so every season now declares award=15 (the highest
  demonstrated stack). Zero effect on completed seasons; matters mid-season.
- frclocks.com was consulted for the concept only; no value came from it.

## Deviations from plan

1. Real ingest and real publish ran from the main context (executor sandboxes deny network) —
   anticipated by the plan.
2. `routeTree.gen.ts` is gitignored (generated at build), so it is regenerated, not committed —
   the plan's "commit it" instruction assumed it was tracked; it is not.
3. Breakdown tab uses expandable per-team rows (nested per-event component table) instead of a
   pivoted column matrix — the algorithm-metric table pattern does not fit variable per-team
   event counts.
4. Lock status is plain text, not color-coded — the palette's only semantic colors are reserved
   (accent = interactive, destructive = errors), per the sketch skill.
5. `maxRemaining*` adds no speculative future rookie bonus — the corpus carries no `rookie_year`
   signal, and TBA folds the bonus into `point_total` at a rookie's first ranked event.
   Documented in `publishDistricts.ts`.
6. `parseYearsRange` accepts one contiguous range per invocation (pre-existing), so the full
   ingest ran as `--years 2019-2020` + `--years 2022-2026`.

## Deferred (from the plan's deferral list)

- Insights ships lean: no charts, no join against algorithm-scoped team metrics.
- Award-level detail (which award) is not ingested — TBA's `award_points` aggregate suffices.
- District artifacts refresh only via offline `pnpm ingest:districts` + `pnpm publish:districts`;
  the live Worker cron does not touch them.

## Test evidence

- Task suites: 47/47 (ingest/corpus), 163/163 (core districts + harness + publish),
  19/19 (new UI tests); full `apps/web` suite 83 files / 1,278 tests green;
  `pnpm --filter web run typecheck` clean.
- Repo-root suite: one pre-existing slow-machine timeout flake in
  `packages/harness/seasonParamSets.test.ts` (untouched by this task); no new red.
- Reconciliation scan runs against the real corpus (all 7 seasons) and passes.
