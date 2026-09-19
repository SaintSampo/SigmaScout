---
id: keep-preseason-week-0-out-of-official-calculations
created: 2026-09-14
source: requested by Jacob 2026-09-14 ("make sure the unofficial week 1 data is not used for official play calculations"); gap found while scoping this todo against HEAD 0f4ab9dc
area: pipeline
severity: minor
priority: medium
files:
  - packages/core/algorithms/eventTypes.ts:42
  - packages/corpus/schema.sql:21
  - packages/corpus/db.ts:586-588
  - packages/harness/publish.ts:2506
  - packages/harness/publish.ts:2540
  - packages/harness/publish.ts:2686
  - packages/harness/score.ts:303
  - apps/worker/src/scheduled.ts:52-63
---

# Keep preseason "Week 0" play out of official ratings, predictions and accuracy

> **STATUS 2026-09-18: looked at during the stock-take and deliberately NOT started.** It is a model
> change, not a cleanup. Excluding type 100 moves early-season predictions, so it moves published
> accuracy for every algorithm, needs version bumps for all three, a republish and all three D1 seeds
> (about 75k of the 100k daily row-write cap, and 50k of that day's cap was already spent on two SPR
> seeds). Step 4 also needs Jacob's acceptance call on the measured before and after. Start it on a
> day with a full D1 budget and no other republish planned. Nothing below has changed.

## The rule this todo protects

Unofficial play (TBA `event_type` 99 offseason and 100 preseason "Week 0") must never feed an official
play calculation: ratings used to predict official matches, published accuracy, the leaderboard,
records, or season carry. `isOfficialEventType` (`eventTypes.ts:42`) already states this rule and
excludes both types.

**Naming trap.** The corpus's `week` column is 0-indexed, so `week === 0` is official **Week 1**.
Preseason "Week 0" events carry `week = null`, not `0`. Never filter Week 0 play by `week`.

## The gap, at HEAD `0f4ab9dc`

The rating and scoring paths do not use `isOfficialEventType`. They use the corpus's `is_offseason`
column, which `schema.sql:21` derives from `event_type == 99` **only**. `eventTypes.ts`'s own header
warns about exactly this: "a caller that only checked `is_offseason` would still let Week-0 results
move the season leaderboard."

- **Replay and folding.** The loaders drop `e.is_offseason = 0` rows only (`db.ts:586-588`,
  `publish.ts:2506`, `publish.ts:2540`). Preseason matches are therefore replayed through
  `predict`/`update`, so they move EPA, SPR, Sigma Score and ranking-point accumulator state before
  official Week 1.
- **Published accuracy.** `publish.ts:2686` builds the scoring exclusion from `is_offseason === 1`,
  and `aggregateScores` (`score.ts:303`) skips only `isOffseason`. Preseason matches pass that filter,
  so any that get a prediction are scored.

**Size, measured against `data/corpus.sqlite` 2026-09-14.** Every season has preseason events, and
every one starts before that season's first official event:

| Season | 2016 | 2017 | 2018 | 2019 | 2020 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|---|
| Preseason events | 4 | 7 | 7 | 10 | 6 | 6 | 8 | 5 | 10 | 12 |
| Their played matches | 16 | 11 | 32 | 29 | 29 | 32 | 37 | 31 | 31 | 31 |

Small next to a season's official matches, which is why this is `minor`. It still sits exactly where
it does the most damage: first thing in the season, when ratings are coldest.

## Already correct (do not redo)

- **Season carry.** EPA (`epa.ts:1149`) and SPR (`spr.ts:920`) declare
  `carryFrom: "last-official-match"`, using `isOfficialEventType` (`replay.ts:229`).
- **Leaderboard, records, team-page header.** `publish.ts:2694`, `scheduled.ts:650`/`:1294` and
  `officialSnapshot.ts:35` all use `isOfficialEventType`.
- **EPA's frozen week-1 statistics.** Preseason has `week = null`, and `epaWeekOne.ts` never enrols a
  null week.

## Work

1. **Confirm before changing anything.** Count preseason matches that reach (a) the replay stream and
   (b) the scored set in the current compare slices. The code says both are non-zero; check it.
2. **Fix at the source, once.** Make every rating and scoring filter use `isOfficialEventType`
   instead of `is_offseason`, or have the loaders drop `event_type IN (99, 100)`. Grep every
   `is_offseason` consumer, including `db.ts:690`, `:1222`, `:1635` and the Worker's live path. Do
   not add a third predicate.
3. **Decide the Worker's live path.** `scheduled.ts:52-63` says a live offseason event "still folds
   its matches into per-event and per-team artifacts normally". Check whether a live preseason
   event also folds into D1 rating state that official matches then read. The live windows are
   closed by the CPU gate, so nothing is exposed today.
4. **Measure, then ship under Rule A.** Excluding Week 0 changes early-season predictions, and so the
   published accuracy. Measure before and after with a scorer that counts ties the same way in both
   arms (see memory `scorer-mismatch-before-after`). Bump the algorithm versions and republish
   through the normal seed-first, deploy-second tail.
5. **Pin it.** Add a test that fails if a type-100 match reaches the replay stream or the scored set,
   next to the existing official-play tests.

## Related, closed

- `remeasure-accuracy-record-offseason-inclusion` and `narrow-offseason-population-ablation-entry`
  concerned type 99 only. The latter's structural argument, "offseason events are
  post-championship", does not cover preseason, which is **pre**-season. It is also not strictly
  true for type 99: 2026 has three in-season offseason events (`2026mnbt2` and `2026srsd` on
  2026-03-21, `2026isrtp` on 2026-04-03), although the `is_offseason` filter already excludes them.
