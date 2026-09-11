---
task_id: 260910-5ym
type: fix
status: complete
created: 2026-09-10
completed: 2026-09-10
---

# 260910-5ym — Fix 2024 EPA: both defects 260910-4x0 measured

`epa@6.0.0+baseline` → `epa@7.0.0+baseline`. **Published 2026-09-10** as generation
`97342984-f48c-49b7-9811-ab124a246cd8`; `epa@6.0.0+baseline` purged from R2. See "Republish and purge".

## Result

| | before | after | Statbotics | gap closed |
|---|---|---|---|---|
| 2024 accuracy | 0.7348 | **0.7520** | 0.7627 | **62%** |

Both figures are the PUBLISHED ones (`v1/compare/2024.json`, generation `97342984`), not a
scratch script's — see the correction below for why that distinction is load-bearing here.
| 2024 Brier | 0.2179 | **0.1688** | 0.1620 | **88%** |

## Fix 1 — re-seed the win-probability scale at the season boundary

`carrySeason` passed `allianceScoreStats` across the boundary whole, observation count
included. Its own doc comment called that "seeding from the prior season's final value", but a
seed fades as new data arrives and this one could not, because the count came with it. By 2024
the accumulator pooled 282,192 alliance scores across eight seasons; the season's own 44,198
were 15.7% of it and could never outvote the rest. It read an SD of 106.4 where 2024's own was
27.2 — a ~3.9x too-flat logistic.

`packages/core/scoring/expandingStats.ts` gains `reseedFromPrior(stats, pseudoCount)`: the
prior regime's mean and SD survive, its count is replaced by `EPA_SCORE_SD_SEED_COUNT = 50`
(about one event's worth of alliance scores). A too-thin prior (`count < 2`) passes through
untouched so the caller's fallback keeps applying.

50 is chosen, not tuned: large enough that a season's opening matches inherit a sane scale
instead of falling back to `EPA_FALLBACK_SCORE_SD` (25 suits 2024's 27.2 but not 2026's
144.6), small enough that the season's own data dominates well inside week 1.

## Fix 2 — 2024's component map collapsed to phase granularity

2024 carried the most granular map of any season (13 components against a median of 9) on the
season with the second-lowest score variance in the corpus. Eleven per-team EWMAs, each from
roughly a dozen quals, were summed into every predicted alliance total.

Four additive partitions, replayed off one shared carry, scored on 2024's 16,764 decided
official matches:

| rating granularity | comps | accuracy |
|---|---|---|
| one component per TBA field (was shipping) | 13 | 0.7348 |
| Statbotics' comp partition | 6 | 0.7461 |
| **phase groups — shipped** | **5** | **0.7520** |
| a single no-foul total | 3 | 0.7403 |

**The curve turns over.** Collapsing to one total is worse than three groups, so "fewer is
better" is not the lesson and must not be propagated to another season without measuring it.

The grouping is not invented: it is `groups.ts`'s existing 2024 `auto`/`teleop`/`endgame`
partition, already published as phase metrics, and it matches three of Statbotics' own rated
2024 keys. Bare `auto`/`teleop`/`endgame` component names follow 2022's existing precedent.

### What Statbotics actually does, verified from source

Fetched `backend/src/models/epa/breakdown.py` and `backend/src/breakdown.py` 2026-09-10 (their
API was returning HTTP 500 throughout). `get_score_from_breakdown`'s 2024 branch is
`score = breakdown["no_foul_points"]` — **one** directly-rated quantity. Their `comp_0..comp_9`
keys are display/RP quantities that overlap (`speaker_points` re-counts notes already inside
`auto_note_points`/`teleop_note_points`), so no additive partition of theirs exists to match.
Matching their comp count would not have delivered the accuracy; matching their *prediction*
target (one component) measurably loses 1.2 pp to phase groups.

## A latent defect this surfaced

`stateSnapshot.test.ts`'s round-trip digest equality broke for `epa` and `vpr` — and the
baseline was green, so it was mine. The cause was not the collapse itself: `stateSnapshot.ts`
writes rows with `stableStringify` (alphabetical keys), while a live state carries components
in insertion order, and floating-point addition is not associative. A continuation replay from
a restored state therefore diverged from the same replay on the live state in the last bits of
every predicted score. The collapse only changed component magnitudes enough to make a
**pre-existing** order sensitivity visible.

Fixed at the right layer for each algorithm, which is not the same layer:

- **EPA** has no canonical component order in its state, so `sumComponentsAcrossTeam` now emits
  sorted keys and the prediction depends only on which components exist and their values.
- **Sigma1** already carries an explicit `componentOrder` that round-trips faithfully, so
  `stateSnapshot.ts` restores runtime key order on read (`inComponentOrder`). Sorting sigma1's
  sums instead was tried first and **reverted**: it changed its float summation order and broke
  the committed bitwise digests all five promoted `vpr` parameter sets are pinned to
  (D-15/SC-5). Those seals are intact.

## Measured outcome, all ten seasons

Like-for-like from the PUBLISHED `v1/compare/{year}.json` on both sides — generation
`e169a4d4` at `epa@6.0.0+baseline` against `97342984` at `epa@7.0.0+baseline`, one scorer, one
corpus, same tie handling:

| Season | accuracy | Brier |
|---|---|---|
| 2016 | 0.7195 -> 0.7195 | 0.1857 -> 0.1857 |
| 2017 | 0.6681 -> 0.6681 | 0.2047 -> 0.2043 |
| 2018 | 0.7333 -> 0.7333 | 0.1801 -> 0.1797 |
| 2019 | 0.6441 -> 0.6441 | 0.2310 -> 0.2309 |
| 2020 | 0.7113 -> 0.7113 | 0.2164 -> 0.1909 |
| 2022 | 0.7710 -> 0.7710 | 0.2149 -> 0.1598 |
| 2023 | 0.7610 -> 0.7610 | 0.2079 -> 0.1628 |
| **2024** | 0.7348 -> **0.7520** | 0.2179 -> **0.1688** |
| 2025 | 0.7772 -> 0.7772 | 0.1953 -> 0.1596 |
| 2026 | 0.7943 -> 0.7943 | 0.1548 -> 0.1536 |

**No season regressed on either metric.** Brier improved in nine of ten and held exactly in
2016, the cold-start season where `carrySeason` never runs. Accuracy moved only in 2024, which
is the expected signature: the scale fix cannot change `sign(margin)`, and 2024 is the only
season whose components were regrouped.

### Correction: the "three seasons got worse" claim was wrong

This summary, its commit message (`8da3e4cc`), the STATE row and a test comment all originally
reported that 2016, 2017 and 2019 came out ~0.003 worse on Brier, explained by the re-seed
carrying the prior season's mean across a hard scale jump. **That regression does not exist.**
It was an artifact of the comparison: the "before" column was read from the published artifacts,
which include ties in the Brier denominator, while the "after" column came from
`experiments/260910-5ym/verify.ts`, which excluded them. Two different scorers, one table.

The transient variance inflation the explanation invoked is a real property of
`reseedFromPrior` and is still pinned by its own test — it simply never reached the season-level
figures. The generalisable lesson: a before/after table whose columns come from two different
scorers is not a measurement, and the fix is to compare two published generations directly.

## Verification

- 236 test files / 4,360 tests green at repo root scope; both `tsc --noEmit` projects clean
  (root and `apps/web` — project memory warns the root config alone misses the web app).
- Baseline arm of every experiment reproduced the published slice exactly (16,958 published −
  194 ties = 16,764; accuracy 0.7348 to four places) before any variant was trusted.
- 28 tests were red mid-change, every one traced to these two changes and fixed at the source
  rather than by loosening an assertion. `carryover.test.ts`'s "carried forward unchanged"
  case pinned the defect itself and now pins the re-seed.

## Republish and purge

**DONE 2026-09-10, authorised by the user.** Republished as generation
`97342984-f48c-49b7-9811-ab124a246cd8`: 108,820 objects, 4,240,958,382 bytes, all three
algorithms, artifacts before manifest. `scripts/epaVsStatbotics.ts --check` PASSED under 7.0.0,
so the committed tolerance bands needed no re-measurement, and
`v1/methodology/epa-vs-statbotics.json` was republished from that report at `7.0.0+baseline`.
`epa@6.0.0+baseline` was then purged from R2; 3.0.0, 4.0.0 and 5.0.0 were censused first and
confirmed already absent (0/60), so 6.0.0 was the only previous version that existed.

Scratch scripts: `experiments/260910-4x0/` and `experiments/260910-5ym/` (gitignored).
