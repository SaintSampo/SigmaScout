---
id: 260925-qhh
slug: impact-and-rookie-all-star-ordering-tabl
kind: quick
status: in-progress
created: 2026-09-25
---

# Quick task 260925-qhh: Impact and Rookie All Star ordering tables

Turn the two measured SORTS from `260912-5n8` and `260912-l8t` into calibrated per-team
probabilities, and layer them on the base-rate award draw so the most decorated team in an
event's field gets the Impact chance the corpus supports rather than its decoration bucket's
average.

## The decomposition, stated before anything is written

The base rate prices ALL judged awards at once. Layering an Impact probability on top of it
without removing Impact's own mass would count Impact twice. The decomposition is measured,
not algebraic:

```
award_points = 10 x [won Impact] + 8 x [won Rookie All Star] + residual
```

The script measures the RESIDUAL directly, per team-event, by subtracting the two award
point values from that team-event's observed `award_points`, and tabulates the residual over
the same six-bin support and the same (decoration bucket x rookie state) cells the base rate
uses. The draw then composes: Bernoulli(Impact from the ordering table) plus
Bernoulli(Rookie All Star from the rookie ordering table) plus a categorical draw from the
residual table.

Mean is linear, so `E[10 I + 8 R + residual] = E[award_points]` EXACTLY whenever the two
Bernoulli probabilities equal the cell's empirical rates. That identity is a test, not a
claim.

The two point values (10 and 8) are MEASURED by the script from team-events where the only
judged award won was that one, printed, and pinned by a corpus-guarded test. They are not
remembered.

## The orderings

- **Impact:** every district-tier attendee of the event, ordered by prior judged award count
  descending, ties broken by ascending team number. Position `k = 1..10`, pooled tail `11+`.
- **Rookie All Star:** the attendees whose rookie state is `rookie`, ordered the same way.
  Position `j = 1..3`, pooled tail `4+`. Every true rookie has zero prior judged awards, so
  this ordering reduces to ascending team number among rookies — that is stated in the module
  and in the SUMMARY rather than hidden.

Prior judged award count is `priorJudgedAwardCount` from `measureDistrictAwardBaseRates.ts`,
imported rather than restated, so the published `priorJudgedAwards` and the measured ordering
cannot disagree.

## Walk-forward, both halves

Half one: a team's decoration at a season-S event counts only judged awards from seasons
strictly before S. Half two: the table registered for season Y is fit only on district-tier
events from seasons strictly before Y. Both carry a leak test on a fixture where the leak
CHANGES the answer.

## Population

Prior-season district-tier team-events (`event_points_raw` entries whose OWN `district_cmp`
is false), restricted to events that carry at least one `event_awards_all` row — an event
whose awards were never ingested would count every attendee as a non-winner and deflate every
probability. The excluded count is printed.

## Tasks

1. **T1** `scripts/measureAwardOrderingTables.ts` + `.test.ts`, `pnpm measure:award-ordering-tables`.
   Pure helpers unit tested; two leak tests; corpus-guarded describe with `existsSync`.
2. **T2** `packages/core/districts/awardOrderingTables.ts` + `.test.ts` — the season-registered
   tables written from T1's real printed output, the `{ p, n, source }` lookups, the residual
   lookup reusing `AwardBaseRateResult`, and the shared ordering helper. Corpus-guarded
   reproduction test added to T1's test file.
3. **T3** Artifact: `awardProfile.priorJudgedAwards` (optional), `awardOrderingTables`
   (optional) beside `awardBaseRates`, same `measuredThroughSeason < season` refinement.
   Publisher writes both. No `PAGE_ARTIFACT_SCHEMA_VERSION` bump.
4. **T4** The draw in `ledgerSimulation.ts`, plus the browser's `awardProfileFor` forwarding
   `priorJudgedAwards`. Ordering applies only when the season has a table AND every roster
   team carries `priorJudgedAwards`; otherwise the base-rate path is bit-identical to today.
5. **T5** Methodology copy on `/methodology/awards` and the ledger page, every number from
   T1's real run.
6. **T6** Run the script, the ledger tests, `pnpm measure:ledger-tenets`, the full suite and
   all four tsconfigs. SUMMARY.

## Constraints

Main working tree. Stage by explicit path. Never `git add -A`. Never touch `.planning/sketches/`
or `data/`. No network, no publish, no deploy. Never read `.env`. Trailer on every commit.
