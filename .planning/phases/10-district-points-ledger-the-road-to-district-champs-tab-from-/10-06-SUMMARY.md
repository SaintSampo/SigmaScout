---
phase: 10-district-points-ledger-the-road-to-district-champs-tab-from-
plan: 06
subsystem: pipeline
tags: [districts, publish, walk-forward, simulation, awards, byte-budget, r2, sqlite]

requires:
  - phase: 10-02
    provides: the measured award base-rate module, its prior-count rule and its non-judged award-type set
  - phase: 10-03
    provides: DistrictEventStateSchema, DistrictPointPmfSchema, DISTRICT_AWARD_BUCKETS, DistrictPreSimArtifactSchema, the promoted event-points schema, the shared verdict pass and the district byte ceilings
  - phase: 10-04
    provides: simulateDistrictEvent, encodeDistrictPointPmf and the typed simulation errors
  - phase: 10-01
    provides: districtTierWeight and the per-component point ceilings
provides:
  - "The four state facts per district event, derived from the corpus at the run's own instant and written through 10-03's shared applyDistrictEventState"
  - "Baked per-team point pmfs for an unstarted district event, published as a v1/district-presim/{districtKey}/{eventKey}.json sidecar with its own provenance"
  - "The six-cell award base-rate table per district artifact and a bucket-plus-rookie profile per known team, derived once and shared with the bake"
  - "A UTF-8 byte gate on every published district object, enforced before any write, with the real measured numbers recorded in docs/publish-budget.md"
  - "buildPricedSyntheticSchedules: one priced-synthetic-schedule builder shared by the presim rank sidecar and the district bake"
  - "scripts/districtPricingState.ts: the one seam from corpus to walk-forward SPR state, truncated at --as-of"
affects: [10-07, 10-08, 10-09]

actuals:
  tokens: 50285
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "One verdict pass, two callers: the publisher composes rows and calls recomputeDistrictVerdicts rather than keeping its own lock math"
    - "--as-of as a single instant that decides both what is still ahead and what enters the replay, making a walk-forward leak inexpressible rather than merely avoided"
    - "Output-preserving extraction proved by leaving the committed oracle suite's expectations byte-identical"
    - "A vocabulary boundary as a total Record keyed by the source module's own exported literals, so a new value is a type error"

key-files:
  created:
    - packages/harness/districtBake.ts
    - packages/harness/districtBake.test.ts
    - scripts/districtPricingState.ts
    - scripts/districtPricingState.test.ts
  modified:
    - scripts/publishDistricts.ts
    - scripts/publishDistricts.test.ts
    - packages/harness/preSchedule.ts
    - packages/harness/preSchedule.test.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/districtRankingsMerge.ts
    - docs/publish-budget.md

key-decisions:
  - "10-03 landed the SIDECAR branch, so the bake emits DistrictPreSimArtifactSchema objects at districtPreSimKey and the district artifact carries bakedEvents; the four provenance keys went on the sidecar, one copy per event object"
  - "finalStates, not carryStates, is the state that prices a bake — read from replay.ts, which calls finalStates the state after the last replayed match and carryStates the season-boundary value"
  - "recomputeDistrictVerdicts gained ONE optional tierByEvent argument so the publisher can supply the event tier for an award at an event no team carries a row for; applyDistrictRankings passes none and is bit-for-bit unchanged"
  - "The plan's mandated --as-of 2026-03-07 verification run bakes ZERO events on the real corpus — no event has a fully rated roster that early in the season. A second run at --as-of 2026-04-04 exercises the bake; both are recorded"
  - "The bake needs award profiles, so the per-team award derivation landed in Task 1 rather than Task 3; Task 3 publishes it and adds the table"
  - "No algorithm-version bump is owed: no algorithm's own outputs changed, and every field this plan adds is additive and optional"

patterns-established:
  - "The as-of view: a not-yet-started event contributes no played row and no observed state, so a rewound run and a production run are one code path"
  - "Positive-only inference: awardsPosted's award_points clause can turn false into true but never the reverse, so it cannot manufacture a premature grey cell"
  - "All-or-nothing per event with every offender named, mirroring makeRankingPointFiller's stated once-per-event rule"

requirements-completed: [SC-5, SC-6]

coverage:
  - id: D1
    description: "The four state facts per district event, derived from the corpus at the run's own instant and written through the shared applyDistrictEventState"
    requirement: SC-5
    verification:
      - kind: unit
        ref: "scripts/publishDistricts.test.ts#deriveDistrictEventState — the four state facts"
        status: pass
      - kind: integration
        ref: "scripts/publishDistricts.test.ts#the corpus-guarded state population (SC-5's offline half, on real data)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Baked per-team point pmfs for an unstarted district event, from walk-forward SPR state through 10-04's simulation and encoder"
    requirement: SC-5
    verification:
      - kind: unit
        ref: "packages/harness/districtBake.test.ts#bakeDistrictEvent — the tracer"
        status: pass
      - kind: integration
        ref: "npx tsx scripts/publishDistricts.ts --years 2026 --as-of 2026-04-04 --dry-run --local-out data/local-publish/districts-asof0404"
        status: pass
    human_judgment: false
  - id: D3
    description: "The walk-forward boundary proved by a value: zero matches of a still-ahead event enter the replay, and the truncation is an identity in production"
    requirement: SC-5
    verification:
      - kind: integration
        ref: "scripts/districtPricingState.test.ts#proves the leak is impossible with a VALUE"
        status: pass
      - kind: unit
        ref: "scripts/districtPricingState.test.ts#is an IDENTITY when every start date is in the past"
        status: pass
    human_judgment: false
  - id: D4
    description: "The six-cell award base-rate table and each known team's bucket-and-rookie profile on the wire, derived once and shared with the bake"
    requirement: SC-6
    verification:
      - kind: unit
        ref: "scripts/publishDistricts.test.ts#the award base-rate table on the wire"
        status: pass
      - kind: integration
        ref: "scripts/publishDistricts.test.ts#NAMES a real 2026 team whose published bucket a leak would change"
        status: pass
    human_judgment: false
  - id: D5
    description: "One verdict pass with two callers and one priced-synthetic-schedule builder with two callers, each duplicate deleted rather than documented"
    verification:
      - kind: unit
        ref: "scripts/publishDistricts.test.ts#buildDistrictArtifact — ONE verdict pass, two callers"
        status: pass
      - kind: unit
        ref: "packages/harness/preSchedule.test.ts#buildPricedSyntheticSchedules (the ONE priced-synthetic-schedule builder, shared with the district bake)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A UTF-8 byte gate on every published district object, enforced before any write, with the real numbers recorded in docs/publish-budget.md"
    verification:
      - kind: unit
        ref: "scripts/publishDistricts.test.ts#the publish byte gate"
        status: pass
      - kind: integration
        ref: "scripts/publishDistricts.test.ts#the budget gate fires BEFORE anything is written"
        status: pass
    human_judgment: false

duration: 55 min
completed: 2026-09-25
status: complete
---

# Phase 10 Plan 06: The Offline Publisher Summary

**`scripts/publishDistricts.ts` now publishes the four state facts, baked per-team point distributions for unstarted events priced from walk-forward SPR state, and the measured award base-rate table — with its private verdict pass, its private event-points schema and its UTF-16 byte accounting all deleted.**

## Performance

- **Duration:** 55 min
- **Tasks:** 3 of 3
- **Files modified:** 12 (4 created, 8 modified)

## Which branch 10-03 landed

**SIDECAR.** Read from the committed `packages/harness/pageArtifacts.ts`:
`districtPreSimKey`, `DistrictPreSimArtifactSchema` and `DistrictArtifactSchema.bakedEvents` all
exist. This plan therefore emits one `DistrictPreSimArtifactSchema` object per baked event at
`v1/district-presim/{districtKey}/{eventKey}.json` and adds that event key to the district
artifact's `bakedEvents`. The four provenance keys (`algorithmId`, `algorithmVersion`, `pricedFrom`,
`draws`) went on the sidecar preamble, one copy per event object, all four additive and optional.
`PAGE_ARTIFACT_SCHEMA_VERSION` is still `1`.

## Task Commits

1. **Task 1 (TRACER): one unstarted district event, end to end** — `e1ad6749` (feat)
2. **Task 2: the four state facts and the widened bake** — `c62b429a` (feat)
3. **Task 3: the award table and profiles on the wire, plus the budget doc** — `40a2cb7b` (feat)

## Accomplishments

- **SC-5's offline half.** Every district event in every published season carries the four state
  facts, written through 10-03's own `applyDistrictEventState` rather than a second row walk.
- **SC-5's prediction half.** An event nobody has played is baked into five
  `DistrictPointPmfSchema` values per team from walk-forward SPR state, through the one shared
  synthetic-schedule builder, 10-04's `simulateDistrictEvent` and 10-04's event-level encoder.
- **SC-6's award half.** The six-cell base-rate table with its fit window, observation counts and
  generating script, plus each known team's profile, derived ONCE and handed to both the wire and
  the bake.
- **Four duplicates deleted**: the publisher's own verdict pass, its own `event_points` schema pair,
  a second synthetic-schedule builder that was never written, and a second award derivation that
  was never written.
- **The district byte gate exists at all for the first time**, counts UTF-8, and runs before any
  write.

## The two real runs, verbatim

Both `--dry-run` with `--local-out` into a gitignored folder. Neither touched the network; neither
read, printed, copied, hashed or interpolated a secret.

### Run 1 — the production season list (Fact 7: bakes nothing, replays nothing)

```
npx tsx scripts/publishDistricts.ts --years 2016-2020,2022-2026 --dry-run --local-out data/local-publish/districts
```

Wall time **5.8 s** for all ten seasons. Every season reported zero bake-eligible events and ran NO
walk-forward replay:

```
season 2016 has no registered district award base-rate table (registered: 2019, 2020, 2022, 2023, 2024, 2025, 2026) — publishing no award block and no team award profile
season 2016 — 0 bake-eligible event(s), so NO walk-forward replay was run
season 2016 bake census — considered 73, baked 0; ineligible: not-a-remaining-event=73; skipped: none
season 2016 — 8 district(s), 0 sidecar(s), 1320523 total bytes, replay 0 ms, bake 0 ms
season 2017 — 0 bake-eligible event(s) ... considered 94, baked 0; ineligible: not-a-remaining-event=94
season 2018 — 0 bake-eligible event(s) ... considered 101, baked 0; ineligible: not-a-remaining-event=101
season 2019 award census — measured through 2018 ... considered 117, baked 0; ineligible: not-a-remaining-event=117
season 2020 award census — measured through 2019 ... considered 117, baked 0; ineligible: not-a-remaining-event=117
season 2022 award census — measured through 2020 ... considered 116, baked 0; ineligible: not-a-remaining-event=116
season 2023 award census — measured through 2022 ... considered 115, baked 0; ineligible: not-a-remaining-event=115
season 2024 award census — measured through 2023 ... considered 119, baked 0; ineligible: not-a-remaining-event=119
season 2025 award census — measured through 2024 ... considered 125, baked 0; ineligible: not-a-remaining-event=125
season 2026 award census — measured through 2025 ... considered 150, baked 0; ineligible: not-a-remaining-event=150
season 2026 — 14 district(s), 0 sidecar(s), 2593758 total bytes, replay 0 ms, bake 0 ms
```

**This is the production cost today: ZERO replays, ZERO bakes, about six seconds for the whole
ten-season run.** 2016, 2017 and 2018 publish no award block and no award profile at all, because
`DISTRICT_AWARD_BASE_RATE_SEASONS` does not register them.

Largest objects across the run:

| Object | Bytes | Per team | Teams | Ceiling |
|---|---:|---:|---:|---:|
| `v1/district/2025fsc.json` (largest PER TEAM) | 49,457 | **1,414** | 35 | 1,700 |
| `v1/district/2026fim.json` (largest ABSOLUTE) | **641,981** | 1,210 | 531 | 1,300,000 |

### Run 2 — the plan's mandated as-of instant (bakes NOTHING; see Deviation 1)

```
npx tsx scripts/publishDistricts.ts --years 2026 --as-of 2026-03-07 --dry-run --local-out data/local-publish/districts-asof0307
```

```
season 2026 award census — measured through 2025, script "npx tsx scripts/measureDistrictAwardBaseRates.ts"; cells: none/rookie: n=2042 source=cell; none/veteran: n=7335 source=cell; oneOrTwo/rookie: n=6349 source=bucket-pooled; oneOrTwo/veteran: n=6349 source=cell; threeOrMore/rookie: n=10060 source=bucket-pooled; threeOrMore/veteran: n=10060 source=cell
season 2026 — replayed 167258 match(es) across 2016+2017+2018+2019+2020+2021+2022+2023+2024+2025+2026 (truncated 18554 at as-of 2026-03-07T00:00:00.000Z) in 149299 ms
season 2026 bake census — considered 150, baked 0; ineligible: not-a-remaining-event=119, divisioned-dcmp-parent=8, already-in-progress=1; skipped: no-ranking-point-filler=22
season 2026 — 14 district(s), 0 sidecar(s), 2646787 total bytes, replay 149299 ms, bake 1 ms
```

Wall time 2 m 31 s, of which 149.3 s is the walk-forward replay. **All 22 eligible candidates were
skipped for the same measured reason: at 2026-03-07 no event's registered roster is fully rated.**

### Run 3 — the as-of instant that actually exercises the bake

```
npx tsx scripts/publishDistricts.ts --years 2026 --as-of 2026-04-04 --dry-run --local-out data/local-publish/districts-asof0404
```

```
season 2026 award census — measured through 2025, script "npx tsx scripts/measureDistrictAwardBaseRates.ts"; cells: none/rookie: n=2042 source=cell; none/veteran: n=7335 source=cell; oneOrTwo/rookie: n=6349 source=bucket-pooled; oneOrTwo/veteran: n=6349 source=cell; threeOrMore/rookie: n=10060 source=bucket-pooled; threeOrMore/veteran: n=10060 source=cell
season 2026 award profiles — 2124 team(s) profiled, 6 without one (no TBA rookie_year); source rungs: none|true=cell, none|false=cell, oneOrTwo|true=bucket-pooled, oneOrTwo|false=cell, threeOrMore|true=bucket-pooled, threeOrMore|false=cell
season 2026 — replayed 177942 match(es) across 2016+2017+2018+2019+2020+2021+2022+2023+2024+2025+2026 (truncated 7870 at as-of 2026-04-04T00:00:00.000Z) in 163208 ms
bake skip 2026njski [spr]: the all-or-nothing ranking-point filler rejected this roster
season 2026 bake census — considered 150, baked 2; ineligible: already-in-progress=8, not-a-remaining-event=131, divisioned-dcmp-parent=8; skipped: no-ranking-point-filler=1
composed "v1/district-presim/2026fim/2026miken.json" (31828 bytes)
composed "v1/district-presim/2026ont/2026onwel.json" (20579 bytes)
season 2026 — 14 district(s), 2 sidecar(s) (largest v1/district-presim/2026fim/2026miken.json at 31828 bytes), 2666878 total bytes, replay 163208 ms, bake 713 ms
```

**Measured figures 10-09 and 10-08 need:**

| Figure | Value |
|---|---|
| Events considered | 150 |
| Events baked | 2 (`2026fim/2026miken`, `2026ont/2026onwel`) |
| Ineligible: not a remaining event | 131 |
| Ineligible: divisioned DCMP parent (`event_type` 2) | 8 |
| Ineligible: already in progress | 8 |
| Skipped: no ranking-point filler | 1 (`2026njski`) |
| Matches replayed | 177,942 across 2016-2026 |
| Matches truncated by the as-of instant | 7,870 |
| Replay wall time | 163.2 s |
| Bake wall time | 713 ms for 2 events (≈ 356 ms/event at 4,000 draws) |
| Sidecar count | 2 |
| Largest sidecar | `v1/district-presim/2026fim/2026miken.json`, **31,828 bytes**, 39-team roster |
| Largest detail object, per team | `v1/district/2026fsc.json`, **1,365 bytes/team** over 40 teams |
| Draws per baked event | 40 schedules x 100 draws = **4,000** |

A written sidecar, read back:

```
keys: schemaVersion, generation, computedAt, districtKey, eventKey, year,
      algorithmId, algorithmVersion, pricedFrom, draws, roster, rows
provenance: spr 7.0.0+baseline current-state draws=4000
roster 39  rows 39
row0  qual      o=4  len=17  sum=1.000000
      alliance  o=0  len=15  sum=1.000000
      elim      o=0  len=8   sum=1.000000
      award     o=0  len=16  sum=1.000000
      total     o=4  len=37  sum=1.000000
```

## Measured figures the plan asked for by name

**Seed-to-seed pmf spread (MEASURED, not asserted against a bar).** From
`packages/harness/districtBake.test.ts`, at the production draw budget:

```
districtBake seed-to-seed spread: max |dp| = 0.03525 across 24 teams x 5 categories at 4000 pooled draws
```

At the fixture's 50-draw budget the same diagnostic printed `0.28000`, which is the expected
sampling behaviour and is why no bar is attached to either number.

**The corpus-guarded state population, exactly as the test reported it:**

```
deriveDistrictEventState 2026: 150 district events, 148 fully observed, 6 with a null qualification
total, never-played: 2026isde3, 2026isde4
```

Zero events report a played count above a non-null total.

**The walk-forward award boundary, as a value:**

```
award walk-forward boundary: 246 of 3155 profiled 2026 teams change bucket when 2026's own awards
leak in; e.g. frc3714 none -> one-or-two, frc5549 one-or-two -> three-or-more,
frc5841 one-or-two -> three-or-more, frc240 one-or-two -> three-or-more,
frc5110 one-or-two -> three-or-more
```

**The per-season award census for 2026 (10-08 quotes these):**

- Fit window: measured through **2025**, script `npx tsx scripts/measureDistrictAwardBaseRates.ts`
- Six published cells and their `n`: `none/rookie` 2,042 (`cell`); `none/veteran` 7,335 (`cell`);
  `oneOrTwo/rookie` 6,349 (`bucket-pooled`); `oneOrTwo/veteran` 6,349 (`cell`);
  `threeOrMore/rookie` 10,060 (`bucket-pooled`); `threeOrMore/veteran` 10,060 (`cell`)
- Profiles: **2,124** teams profiled, **6** without one (TBA reports no `rookie_year`, or the team
  has no `teams` row at all)
- Source-rung distribution: 4 of 6 cells on `cell`, 2 of 6 on `bucket-pooled` (both rookie cells for
  the two decorated buckets — 10-02's table registers no `one-or-two|rookie` or
  `three-or-more|rookie` cell, and the module registers no `unknown` rookie cell for any bucket, so
  nothing was measured-and-not-published)

**The corpus-guarded pricing-state replay:**

```
districtPricingState: as-of 2026-03-07 replayed 26162 match(es) across 2025+2026, truncated 18554;
2026mibig roster 8/41 rated
```

## Exported symbols (10-08 documents these, 10-09 runs them)

`packages/harness/districtBake.ts`:
`DISTRICT_BAKE_SCHEDULE_COUNT` (40), `DISTRICT_BAKE_DRAWS_PER_SCHEDULE` (100),
`DISTRICT_BAKE_DRAW_SALT`, `DistrictBakeSkipReason`, `DistrictBakeRow`, `DistrictBakeBaked`,
`DistrictBakeSkipped`, `DistrictBakeOutcome`, `DistrictBakeError`, `DistrictBakeParams`,
`bakeDistrictEvent`.

`scripts/districtPricingState.ts`:
`CORPUS_PATH`, `DistrictPricingStateError`, `startedEventKeysAsOf`,
`BuildDistrictPricingStateOptions`, `DistrictPricingState`, `resolveDistrictPricingAlgorithm`,
`buildDistrictPricingState`, `openDistrictPricingCorpus`.

`packages/harness/preSchedule.ts` (additions): `buildPricedSyntheticSchedules`,
`PricedSyntheticSchedules`.

`packages/harness/districtRankingsMerge.ts` (addition):
`RecomputeDistrictVerdictsOptions` with its one optional `tierByEvent` member.

`scripts/publishDistricts.ts` new flags:

| Flag | Meaning |
|---|---|
| `--as-of <ISO>` | The instant the run is computed at. Becomes `computedAt`, drives `eventStillAhead`, truncates the replay and decides bake eligibility. Defaults to the run's own clock; rejected when unparseable or later than now. |
| `--local-out <dir>` | Writes every composed object there, named from its R2 key with `/` flattened to `__`. Independent of `--dry-run`. |
| `--no-bake` | Skips the replay and the bake entirely and prints the consequence it causes. |
| `--warmup-from <year>` | First season replayed before the target season. Defaults to 2016, the production `--years` list's first term. |

## The exact production command 10-09 runs

**Unchanged from the committed entry.** No `package.json` edit was made:

```
pnpm publish:districts
# = tsx --env-file=.env scripts/publishDistricts.ts --years 2016-2020,2022-2026
```

Baking is ON by default, so no new flag has to be threaded in. **Per Fact 7 this bakes nothing and
replays nothing today**, so the republish's cost and duration are unchanged from the last one (about
six seconds of composition plus the upload). The `--as-of` runs in this SUMMARY are verification
only and **must not be run against the real bucket**.

## Is an algorithm-version bump owed?

**No.** No algorithm's own code or published numbers changed: `spr`, `opr` and `epa` all produce
byte-identical event/team/compare artifacts, and `npx vitest run` from the repo root is green on all
270 files. Every field this plan adds to the district artifact (`state`, `awardProfile`,
`awardBaseRates`, `bakedEvents`) is additive and optional, and the sidecar is a new artifact kind
with its own key function. The district artifact is deliberately not algorithm-scoped; the SPR
version the bake priced from rides on the sidecar's own `algorithmVersion` provenance key
(`7.0.0+baseline` in the verification runs). `PAGE_ARTIFACT_SCHEMA_VERSION` is unmoved at `1`.

## Files Created/Modified

- `packages/harness/districtBake.ts` — pure, no I/O and no clock. Owns the pooling across schedules,
  the encode-round-trim order and the all-or-nothing roster decision, and nothing else.
- `packages/harness/districtBake.test.ts` — 14 tests, no corpus, runs in CI.
- `scripts/districtPricingState.ts` — the corpus-to-walk-forward-SPR-state seam, credential-free.
- `scripts/districtPricingState.test.ts` — the pure truncation predicate plus a corpus-guarded
  replay that proves the leak is impossible with a number.
- `scripts/publishDistricts.ts` — the four state facts, the bake loop and its census, the award
  context, `Buffer.byteLength` accounting, the budget gate, four new flags; the private verdict pass
  and the module-local event-points schema pair deleted.
- `scripts/publishDistricts.test.ts` — 34 additive tests; every one of the 530 committed lines'
  expectations unchanged.
- `packages/harness/preSchedule.ts` — `buildPricedSyntheticSchedules` extracted, output-preserving.
- `packages/harness/pageArtifacts.ts` — four additive optional provenance keys on the sidecar.
- `packages/harness/districtRankingsMerge.ts` — one optional `tierByEvent` argument on the shared
  verdict pass.
- `docs/publish-budget.md` — the real measured district numbers beside 10-03's synthesized ones.

## Decisions Made

1. **`finalStates`, not `carryStates`.** The plan's parenthetical named `carryStates` as the
   post-last-update state. `packages/harness/replay.ts` says otherwise, in its own words:
   `finalStates` is "each algorithm's state after the LAST REPLAYED MATCH... the honest 'where this
   replay ended' value", while `carryStates` is what a season-boundary threading site hands
   `carrySeason` and is deliberately the last-OFFICIAL-match state for an algorithm declaring
   `carryFrom: "last-official-match"`. `districtPricingState.ts` uses `carryStates` to thread across
   a season boundary and `finalStates` to price, and its header states the distinction.
2. **The tier seam on the shared verdict pass.** Adopting `recomputeDistrictVerdicts` broke four
   committed expectations, because `awardQualifiedSets` resolves an award's tier from the artifact's
   own rows and the fixtures' award events carry no row for any team. The fix is the additive
   row-level seam the plan permits: one optional `tierByEvent` argument. `applyDistrictRankings`
   passes none, so the Worker is bit-for-bit unchanged; the publisher passes the corpus's own
   `events.event_type`. All 530 committed lines then pass untouched.
3. **The hypothetical-DCMP ceiling is seeded, not recomputed.** The shared pass reads
   "is the DCMP still ahead" off the artifact's own rows; the publisher has the calendar. Seeding
   every team's `maxRemainingChamp` with the calendar's answer hands the pass that fact, and the
   pass then applies the has-played-a-DCMP and pass-1-eliminated gates itself — exactly as the
   deleted code did.
4. **`--as-of` gates bake eligibility through the as-of view.** An event that had not started at the
   instant contributes no played qualification match, so "zero played quals" and "not yet started"
   coincide. With the instant at the run's own clock the as-of view IS the corpus, which is what
   makes the verification path and the production path one code path.
5. **The award profile derivation landed in Task 1.** `bakeDistrictEvent` refuses a roster with any
   unprofiled team, so the tracer could not have produced five pmfs without it. Task 3 publishes the
   profile and adds the table; the derivation itself is shared, which is what the plan asked for.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] The mandated `--as-of 2026-03-07` verification run bakes ZERO events**

- **Found during:** Task 1, before writing the publisher wiring; re-confirmed by the real run.
- **Issue:** The plan's Fact 7 measured that 131 of 150 2026 district events start at or after
  2026-03-07, and both Task 1's and Task 2's acceptance criteria require that run to bake at least
  one event. Fact 7 did not measure ROSTER RATING COVERAGE, which is what the bake actually needs.
  Measured read-only against the corpus before any code was written: **zero** of the 116
  non-`event_type`-2 events with a roster of at least six have a fully rated roster at 2026-03-07
  (best is 20/27), and the real run confirms it — all 22 candidates skip with
  `no-ranking-point-filler`. The bake is all-or-nothing by design (`makeRankingPointFiller`'s own
  rule, which the plan mandates), so a partially rated roster produces nothing. The two requirements
  are jointly unsatisfiable.
- **Fix:** Kept the mandated run and recorded its census verbatim (it IS an informative result: it
  measures exactly when in a season the bake becomes possible), and added a second run at
  `--as-of 2026-04-04`, where 2 events bake. Coverage by instant, measured:
  2026-03-14 → 1 fully rated event, 2026-03-21 → 7, 2026-03-28 → 17, 2026-04-04 → 13.
- **Files modified:** none — this is a verification-procedure deviation, not a code change.
- **Verification:** both runs' full stdout is in this SUMMARY.
- **Committed in:** `c62b429a` (the census that reports it).

**2. [Rule 1 - Bug] The tracer's `run()` tests would have failed a corpus-less CI**

- **Found during:** Task 2.
- **Issue:** Task 1's byte-gate test called `run()`, which opens `data/corpus.sqlite`. That file is
  gitignored, so the test would have thrown in CI — the exact shape of the gap an eight-day red CI
  once hid in (`project_test_scope_trap`).
- **Fix:** Moved every `run()`-based test behind the `existsSync` plus explicit `it.skip` guard
  `packages/core/districts/reconciliation.test.ts` established.
- **Files modified:** `scripts/publishDistricts.test.ts`
- **Verification:** `npx vitest run` from the repo root, 270 files green, 1 skipped.
- **Committed in:** `c62b429a`

**3. [Rule 1 - Bug] The tracer's ceiling assertion as written cannot hold for a sampled histogram**

- **Found during:** Task 1.
- **Issue:** The plan asked the tracer to assert that the `total` pmf's "support upper bound EQUALS
  the sum of `maxEventPoints`'s four components". That is the ALLOCATED histogram length, not the
  published one: `encodeDistrictPointPmf` trims trailing zeros, and a 50-draw (or even 4,000-draw)
  sample never reaches the perfect-event maximum.
- **Fix:** Asserted the invariant in the form a sampled histogram can satisfy — no published value
  EXCEEDS its declared ceiling, per category and for the total — and kept the load-bearing
  assertion (the total's mean equals the sum of the four category means) unchanged, since that is
  what actually proves the five pmfs are marginals of one run. The substitution and its reason are
  in the test's own comment.
- **Files modified:** `packages/harness/districtBake.test.ts`
- **Verification:** `npx vitest run packages/harness/districtBake.test.ts`, 14 passed.
- **Committed in:** `e1ad6749`

**4. [Rule 3 - Blocker] The `EventPointsEntrySchema` symbol gate is unsatisfiable as stated**

- **Found during:** Task 1.
- **Issue:** The gate requires `grep -c "EventPointsEntrySchema"` over comment-filtered code to
  return exactly 1, "and that one line is the import of the promoted schema". Any USE of the
  imported symbol is a second matching line, so importing it and using it always returns 2.
- **Fix:** Imported it under a local alias (`DistrictRankingsEventPointsEntrySchema as
  PromotedEventPointsEntry`) and called `.array()` on the alias at the single use site. The gate's
  INTENT is fully met — both module-local schemas are deleted and the promoted name is the only
  survivor — and the gate now returns exactly 1. The import comment says why the alias exists.
- **Files modified:** `scripts/publishDistricts.ts`
- **Verification:** `grep -vE '^[[:space:]]*(//|\*|/\*)' scripts/publishDistricts.ts | grep -c
  "EventPointsEntrySchema"` returns `1`.
- **Committed in:** `e1ad6749`

**5. [Rule 2 - Missing critical] `--bake-limit` exists as a programmatic option, not a CLI flag**

- **Found during:** Task 1.
- **Issue:** The plan's Task 1 slice bakes one event and Task 2 widens it. Rather than commit a
  crippled loop and immediately uncripple it, the limit landed as an optional programmatic
  `bakeLimit` (default unbounded) that a test or a caller can set. Task 1's committed code therefore
  already bakes every eligible event; the tracer gate was satisfied by verifying one real baked
  event end to end before Task 2 began.
- **Files modified:** `scripts/publishDistricts.ts`
- **Verification:** the tracer's own real run produced a schema-valid sidecar with five pmfs and the
  provenance keys, read back by eye, before Task 2 started.
- **Committed in:** `e1ad6749`

---

**Total deviations:** 5 auto-fixed (2 x Rule 1, 2 x Rule 3, 1 x Rule 2).
**Impact on plan:** No scope creep. Deviation 1 is a planning gap the plan's own Fact 7 did not
cover and is the only one a reader must know about — the mandated verification command does not
exercise the bake, and a second instant does.

## Issues Encountered

**The as-of view cannot reconstruct a past `remainingEvents` list.** `district_rankings` stores the
FINAL standings, not an as-of snapshot, so at `--as-of 2026-04-04` only 19 of 150 events are in any
team's `remainingEvents` (131 are `not-a-remaining-event`). This is correct for production, where the
rankings ARE current, and it narrows the verification surface but does not compromise it — the bake,
the pricing state and the state facts are all genuinely exercised. Worth knowing before anyone reads
the `not-a-remaining-event` census line as a defect.

**The full-suite flake did not appear.** `MetricHistoryTab.test.tsx` passed on the single full run;
no re-run was needed.

## Verification

- `npx vitest run` from the REPO ROOT: **270 files, 6,084 passed, 1 skipped** (the skip is a
  corpus-guarded describe unrelated to this plan). No re-run needed.
- `npx tsc --noEmit` — clean. `npx tsc --noEmit -p apps/web/tsconfig.json` — clean.
  `npx tsc --noEmit -p apps/worker/tsconfig.json` — clean.
- `git diff --stat -- package.json pnpm-lock.yaml` — **empty**.
- `git status --short data/` — **empty** (`data/*` is gitignored; the local output folders never
  reached git).
- Symbol gates over CODE ONLY (comment-filtered): `computeLocksWithQualifiers` = **0**,
  `EventPointsEntrySchema` = **1** (the import), `body.length` = **0**, `Buffer.byteLength` = **3**.
- `grep -c "^export const PAGE_ARTIFACT_SCHEMA_VERSION = 1;" packages/harness/pageArtifacts.ts` =
  **1**.
- The fenced machine-readable `json budget` block in `docs/publish-budget.md` is **byte-identical to
  HEAD** (1,505 bytes both sides).
- The plus-minus codepoint U+00B1 appears in neither new file.
- Oracle test files, additions only: `preSchedule.test.ts` +93/-0, `pageArtifacts.test.ts` +22/-0,
  `generatedSchedules.test.ts` untouched, `publishDistricts.test.ts` +831/-2 where both deletions are
  import lines and no expectation changed.

## Security

**No secret was read, printed, copied, hashed or interpolated, and no network request was made.**
`.env` was never passed to `Read`, `cat`, `head`, `tail` or `echo`; no command in this plan carried an
environment-file flag; `putObject` was never called because every run was `--dry-run`; and neither
new module references `process.env` (asserted by a test in
`scripts/districtPricingState.test.ts`). No package was installed.

## Next Phase Readiness

**10-07 (web)** can now read, from a published artifact:
- `state` on every `eventPoints` and `remainingEvents` row for the grey-versus-blue decision. A row
  with no `state` is a pre-phase-10 artifact, not a grey cell.
- `bakedEvents` on the district artifact, and a `v1/district-presim/{districtKey}/{eventKey}.json`
  sidecar for each key listed there. **An event absent from `bakedEvents` must be treated as
  unavailable — never 404-probed for.**
- `awardBaseRates` (once per artifact) plus `awardProfile` (per team) for an in-progress event's
  award cell. A team with no `awardProfile` renders as unavailable, not as a guessed veteran.
- A TBA `event_type` 2 divisioned DCMP parent is **never** baked; do not expect a sidecar for one.

**10-08 (methodology)** has three limitations recorded in code and quotable from here:
1. The bake prices from CURRENT walk-forward state over SYNTHETIC schedules, not the real one. An
   unstarted event has no results so the state is identical, and the 40-schedule pool spans schedule
   luck, but the published pmf is not conditioned on the schedule TBA will actually release.
2. Every baked number rests on **4,000 pooled draws**, which is its resolution. The measured
   seed-to-seed spread at that budget is **max |dp| = 0.03525**.
3. `awardsPosted` reads **false** for an event whose awards are posted, whose award rows are absent
   from the (gitignored) corpus, and where no team earned district award points. That event's award
   cell stays blue with a base-rate pmf rather than grey at zero. Stated limitation, not a bug.

**10-09 (operator):** `pnpm publish:districts` is unchanged and bakes nothing today, so the
republish is the same cost and duration as the last one. Deploy the Worker BEFORE the republish
(every field here is additive and optional precisely so the newly deployed Worker can parse a
pre-republish artifact). The `--as-of` verification runs are NOT part of the republish.

## Self-Check: PASSED

Every file this SUMMARY claims was created exists on disk
(`packages/harness/districtBake.ts`, `packages/harness/districtBake.test.ts`,
`scripts/districtPricingState.ts`, `scripts/districtPricingState.test.ts`), and every commit hash it
names resolves in `git log --oneline --all`: `e1ad6749`, `c62b429a`, `40a2cb7b`, `3018d0ea`,
`db24621b`.
