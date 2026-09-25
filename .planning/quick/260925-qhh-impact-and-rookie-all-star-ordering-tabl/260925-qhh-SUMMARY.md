---
id: 260925-qhh
slug: impact-and-rookie-all-star-ordering-tabl
kind: quick
status: complete
completed: 2026-09-25
subsystem: districts
key-files:
  created:
    - scripts/measureAwardOrderingTables.ts
    - scripts/measureAwardOrderingTables.test.ts
    - packages/core/districts/awardOrderingTables.ts
    - packages/core/districts/awardOrderingTables.test.ts
  modified:
    - package.json
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/districtRankingsMerge.test.ts
    - scripts/publishDistricts.ts
    - scripts/publishDistricts.test.ts
    - packages/core/districts/ledgerSimulation.ts
    - packages/core/districts/ledgerSimulation.test.ts
    - apps/web/src/components/districts/districtLedgerRows.ts
    - apps/web/src/components/districts/districtLedgerRows.test.ts
    - apps/web/src/components/methodology/awardsContent.ts
    - apps/web/src/components/methodology/awardsContent.test.ts
    - apps/web/src/components/methodology/districtLedgerContent.ts
    - apps/web/src/components/methodology/districtLedgerContent.test.ts
decisions:
  - "THE RESIDUAL IS MEASURED, NOT SUBTRACTED. `award_points` minus 10 for Impact minus 8 for Rookie All Star is computed PER TEAM-EVENT and then binned, rather than removing an aggregate share from an aggregate pmf. Once awards stack (15 is 10 plus 5, 13 is 8 plus 5) an aggregate subtraction has no unique answer and can go negative, and a negative is not a distribution. A residual outside the six-bin support is censused as UNMODELLED and never clamped; the corpus produced zero of them."
  - "AN EVENT NEEDS 11 ATTENDEES TO CONTRIBUTE, and this guard was NOT in the plan. Measured over all 951 district-tier events: 72 sit below it (70 with a single attendee, one with two, one with eight), they are overwhelmingly 2020's cancelled events, and AN ATTENDEE WON IMPACT AT ALL 72. A one-attendee field is the Impact winner's points row and nothing else, so including them handed position 1 seventy guaranteed wins: 25.12% against the honest 17.99% for 2026. The bar is MAX_IMPACT_POSITION + 1 so every contributing event also fills all ten positions, which is what makes the ten rates comparable at equal n."
  - "THE TWO AWARD POINT VALUES ARE MEASURED, NOT REMEMBERED. The script tabulates `award_points` over team-events whose ONLY judged award was that one and prints the census; 2026's prior window gives Impact 10 x635 and Rookie All Star 8 x525, unanimous, and a corpus-guarded test asserts the modal value equals the committed constant for every registered season."
  - "THE FALLBACK IS ALL OR NOTHING PER EVENT. One roster team missing `priorJudgedAwards` takes the WHOLE event back to the base rate. A team treated as undecorated because its count was absent would sort to the bottom of its field and be priced at the ordering tail, which is a confident wrong number, and it is the same reason `UnratedTeamError` refuses to price the teams it can and drop the rest. A test proves that fallback is BIT IDENTICAL to the pre-ordering histogram, team by team, integer by integer."
  - "BOTH AWARD BLOCKS SHIP. `awardOrderingTables` is additive BESIDE `awardBaseRates`, not a replacement for it, because a reader that cannot order a field falls back to the unreduced table and shipping only the residual would silently under price every award cell on such an event."
  - "THE CLAMP AT THE TIER CEILING IS A CORRECTNESS REQUIREMENT. Impact and Rookie All Star are drawn independently, so 10 plus 8 plus a 13 residual composes to 31 against a district ceiling of 15, and an out of range write to the Int32Array accumulator is a SILENT NO-OP that would drop that draw's mass. The rookie-field test asserts every histogram still sums to the draw count, which is the only assertion in the file that catches a removed clamp."
  - "THE ORDERING PATH CONSUMES ONE MORE LEDGER VALUE PER TEAM (Impact and the residual against the base rate's single categorical draw; no Rookie All Star draw for a veteran, whose chance is structurally zero). A seeded output therefore differs between the two paths BY DESIGN. Every pre-existing ledger test stays green because its fixtures carry no count."
  - "THE SHIPPED ORDERING USES ONE NUMBER PER TEAM, as the task specified, and the stronger award-type-first ordering is measured beside it and printed as REFERENCE ONLY. It is NOT shipped and NOT stated on any page: closing the gap needs a second per-team count on every artifact, which is a scope and payload decision rather than a modelling one."
  - "The rookie ordering degenerates to ascending team number and that is stated rather than hidden: every true rookie has zero prior judged awards by definition, so its 38.14% and 28.60% are mostly the answer to 'one of the k rookies in this field'. The gap between the two positions is what the team-number ordering itself is worth."
  - "The UI was left alone, taking the task's own 'otherwise' branch. A 'most decorated in the field' note would need the ordering position plumbed from the Worker result through `distributionsFromResult` into the row and the cell, and nothing surfaces award provenance there today (`awardSources` has never been rendered)."
findings:
  - "IMPACT, season 2026 (fit on 2016 to 2025, 756 events): position 1 17.99% (136 of 756), position 2 13.10% (99 of 756), position 3 11.77% (89 of 756), pooled tail from position 11 down 0.56% (101 of 18,146). Every position 1 to 10 rests on the same n=756 by construction."
  - "ROOKIE ALL STAR, season 2026: rookie position 1 38.14% (246 of 645), position 2 28.60% (139 of 486), position 3 18.05% (63 of 349), tail from position 4 down 11.63% (65 of 559). The denominators fall because they are 'events with at least j rookies'."
  - "The ordering is stable across all seven registered seasons. Impact position 1 ranges 16.96% (2019) to 18.90% (2022); position 2 12.17% to 14.32%; the tail 0.45% to 0.56%. Rookie All Star position 1 rises 29.86% (2019) to 38.14% (2026) as rookie fields thin."
  - "THE DECOMPOSITION REMOVED THE RIGHT MASS, and the sizes are the check. Season 2026 mean award points, base rate against residual: none|rookie 3.3810 to 1.3708 (2.0102 removed, Rookie All Star is most of what a rookie's award points ARE), three-or-more|veteran 3.6458 to 2.9971 (0.6487 removed, Impact), none|veteran 1.1145 to 1.0042 (0.1103), one-or-two|veteran 1.4150 to 1.3404 (0.0747)."
  - "REGISTERED SEASONS ARE EXACTLY THE BASE RATE TABLE'S: 2019, 2020, 2022, 2023, 2024, 2025, 2026, asserted by equality so a season priced two ways cannot exist. 2016 to 2018 carry no table (fewer than three prior district seasons), so the `no-table` disposition is currently unreachable in production and is tested directly on the lookup instead."
  - "THE REFERENCE ONLY ORDERING IS 8.1 POINTS BETTER AT POSITION 1. Sorting on prior IMPACT wins first and falling back to total judged awards gives 26.06% (197 of 756) for 2026 against the shipped ordering's 17.99%, and 25.77% to 26.46% across 2023 to 2026. That also reconciles the shipped figure with 260912-5n8's 24.5%, which was measured under the award-type-first ordering over all events rather than district-tier ones."
  - "BOTH LEDGER TENETS STILL MEASURE ZERO over 921,658 team-positions in 109 district seasons, and every counted total is IDENTICAL to 260925-pl6's: Locked on points 130,718, Locked out 190,854, Locked by the pooled argument alone 213, slots held back for awards 26,604. Awards never touch a verdict, and the sweep proves it rather than the import list merely suggesting it."
  - "Full suite from the repo root: 290 files, 6,479 passed, 1 skipped, zero failures. 59 new tests, counted by observed per-file delta: 19 in the new script test, 15 in the new module test, 14 in ledgerSimulation (74 to 88), 7 in pageArtifacts, 2 in publishDistricts, 1 in districtRankingsMerge (42 to 43) and 1 in districtLedgerRows (50 to 51). All four tsconfigs clean: root, apps/web, apps/worker, apps/web e2e."
owed:
  - "A DISTRICT REPUBLISH IS REQUIRED for either new field to reach production, and a Pages deploy carries the browser half. Until then every published artifact carries no `priorJudgedAwards` and no `awardOrderingTables`, so every event reads `incomplete-profiles` and is priced exactly as it is today. The change is invisible in production until the republish."
  - "NO PUBLISHED NUMBER MOVES FOR A FINISHED SEASON, by the same argument 260925-pl6 measured: every district-tier event of a finished season has its awards posted, so `knownAwardPoints` is supplied, the award pmf is never drawn and no table is consulted at all. No grey number, no verdict, no cut line and no insights count can move. A LIVE district with events still ahead will read different award chances once the republish ships, which is the point."
  - "The Worker's own republish path needs nothing: the merge carries both fields forward through its `...artifact` and `...existing` spreads, and a test now pins each one so a future tick cannot silently drop the ordering key and take every promoted event back to the base rate."
  - "The award-type-first ordering's 8.1 point gap at position 1 is Jacob's call, with the number now measured rather than guessed. Shipping it costs one more integer per team on every district artifact (`priorImpactWins`) and a second ordering in the module."
---

# Quick task 260925-qhh: the two award sorts become probabilities

**The most decorated team in a district field wins Impact 17.99% of the time, the second
13.10%, the third 11.77%, and everything from position 11 down 0.56%. The lowest numbered
rookie wins Rookie All Star 38.14%, the second 28.60%. Those are now the numbers the ledger
prices an award cell with, instead of the team's decoration bucket average.**

## What was missing

`260912-5n8` and `260912-l8t` both found the same thing, four times over: the best available
predictor of Impact is the SORT "most decorated team present" and of Rookie All Star the SORT
"most decorated rookie present", each beating a fitted conditional logit on the berth deciding
stratum and everywhere else. Their own stated limitation was the one that mattered: **a sort
emits no probability**, so nothing could be shown to a user.

`awardBaseRates.ts` filled that hole with a bucket average. A team with three or more prior
judged awards and a team with fifteen were priced identically, and the single most decorated
team in a 40 team field was priced as one of the 25 teams in its bucket.

## The tables

Walk forward in both halves, exactly as the base rate table is. A team's decoration at a
season S event counts only judged awards from seasons strictly before S, and the table
registered for season Y is fit only on district tier events from seasons strictly before Y.
Both halves carry a leak test on a fixture where the leak CHANGES the answer: in half one the
leak moves the Impact winner from position 2 to position 1 and the win count with it.

| season | events | Impact 1 | Impact 2 | Impact 3 | Impact tail 11+ | RAS 1 | RAS 2 |
|---|---|---|---|---|---|---|---|
| 2019 | 230 | 16.96% | 12.17% | 10.00% | 0.52% | 29.86% | 29.78% |
| 2020 | 330 | 18.48% | 14.24% | 10.61% | 0.47% | 33.66% | 28.92% |
| 2022 | 365 | 18.90% | 14.25% | 10.96% | 0.45% | 35.84% | 29.20% |
| 2023 | 461 | 18.00% | 14.32% | 11.50% | 0.48% | 35.68% | 27.91% |
| 2024 | 555 | 17.30% | 13.87% | 11.89% | 0.54% | 37.45% | 29.13% |
| 2025 | 653 | 17.46% | 13.17% | 11.64% | 0.54% | 37.41% | 29.36% |
| 2026 | 756 | 17.99% | 13.10% | 11.77% | 0.56% | 38.14% | 28.60% |

Sample sizes for 2026: every Impact position rests on **n = 756**, the event count, by
construction. The tail is n = 18,146. Rookie All Star positions are n = 645, 486 and 349, and
its tail n = 559; those fall because each denominator is "events with at least j rookies".

## The decomposition

```
award_points = 10 x [won Impact] + 8 x [won Rookie All Star] + residual
```

The residual is **measured** that way per team event and then binned, never derived by
subtracting an aggregate share from an aggregate pmf. The draw composes three independent
pieces: Bernoulli(Impact) from the ordering table, Bernoulli(Rookie All Star) from the rookie
table, and a categorical draw from the residual table.

The sizes of what was removed are the check, and they land where they should:

| 2026 cell | base mean | residual mean | removed |
|---|---|---|---|
| none, rookie | 3.3810 | 1.3708 | **2.0102** |
| three or more, veteran | 3.6458 | 2.9971 | **0.6487** |
| none, veteran | 1.1145 | 1.0042 | 0.1103 |
| one or two, veteran | 1.4150 | 1.3404 | 0.0747 |

Rookie All Star is most of what a rookie's award points ARE, and Impact is most of what the
top veteran bucket's extra points are. A residual that was not lighter than its base rate cell
is exactly what the double count looks like, and a test asserts it cell by cell for every
registered season.

The two point values were measured rather than remembered: over team events whose ONLY judged
award was that one, 2026's prior window gives **Impact 10 x635** and **Rookie All Star 8 x525**,
unanimous in both censuses.

## The guard the plan did not anticipate

The first run put Impact position 1 at **25.12%**. That was wrong, and the reason is worth
recording. 72 of the corpus's 951 district tier events have fewer than 11 attendees in
`event_points_raw` (70 of them exactly one), they are overwhelmingly 2020's cancelled events,
and **an attendee won Impact at all 72**. A one attendee field is not a field; it is the Impact
winner's points row and nothing else. Including them handed position 1 seventy guaranteed wins.

The bar is `MAX_IMPACT_POSITION + 1`, which also makes every contributing event fill all ten
positions, so the ten rates are comparable at equal n rather than carrying a gradient in how
many events reach that far down. It removes 7.6% of events and the whole of the artifact. The
honest answer is 17.99%.

## What the ledger does now

Three paths in the award step and exactly one runs, reported on the result as
`awardOrdering`:

- `posted` — awards known, nothing drawn, no table consulted.
- `applied` — the ordering path.
- `incomplete-profiles` — any roster team missing `priorJudgedAwards`, so the whole event is
  priced from the base rate. **Bit identical** to the pre-ordering histogram, proven team by
  team and integer by integer.
- `no-table` — a season with no ordering table. Currently unreachable in production, because
  the registered season set is asserted equal to the base rate table's.

The clamp at the tier's award ceiling is load bearing, not tidy-up: Impact and Rookie All Star
are drawn independently, so 10 plus 8 plus a 13 residual composes to 31 against a district
ceiling of 15, and an out of range write to the `Int32Array` accumulator is a **silent no-op**
that would drop that draw's mass and leave `chanceOfAnyPoints` reading a confident percentage
over an incomplete distribution. The rookie field test asserts every histogram still sums to
the draw count, which is the only assertion that catches a removed clamp.

## What is left on the table, measured

The shipped ordering uses one number per team, as specified. Sorting on prior **Impact** wins
first and falling back to the total gives **26.06%** at position 1 for 2026 (197 of 756)
against the shipped **17.99%** — an 8.1 point gap, stable at 25.77% to 26.46% across 2023 to
2026. It is printed as REFERENCE ONLY, is not shipped, and is not stated on any page, because
the site does not use it. Closing the gap costs a second per team integer on every district
artifact, which is Jacob's call with the number now in front of him.

That gap also reconciles this task's figure with `260912-5n8`'s 24.5%: that measurement used
the award-type-first ordering over all events, not district tier ones.

## Verification

| check | result |
|---|---|
| `npx vitest run` from the repo root | 290 files, 6,479 passed, 1 skipped, zero failures (59 new tests by per-file delta, no regressions) |
| `npx tsc --noEmit` (root, apps/web, apps/worker, apps/web e2e) | all four clean |
| `pnpm measure:award-ordering-tables` | ran here; every committed literal re-measured by the corpus guarded test within 1e-9 on p and exactly on n |
| `pnpm measure:ledger-tenets` | **both tenets 0 violations** over 921,658 team-positions; every total identical to 260925-pl6's |

The tenet sweep is the load bearing one: awards never touch a verdict, and 130,718 Locked on
points, 190,854 Locked out, 213 pooled-only locks and 26,604 held back slots are unchanged to
the unit.

## Commits

| commit | what |
|---|---|
| `bed5ca27` | the measurement script and the season registered module |
| `5cc49cb7` | the artifact's ordering key and tables, and the publisher that writes them |
| `f3c49c27` | the ledger draw, and the browser forwarding the ordering key |
| `e3e8e9a1` | both methodology pages |

## Self-Check: PASSED

All four created files exist on disk; all four commits are present in `git log`; the working
tree carries no unstaged change to any file this task touched.
