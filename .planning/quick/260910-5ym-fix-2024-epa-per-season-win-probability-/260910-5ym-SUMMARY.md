---
task_id: 260910-5ym
type: fix
status: complete
created: 2026-09-10
completed: 2026-09-10
---

# 260910-5ym — Fix 2024 EPA: both defects 260910-4x0 measured

`epa@6.0.0+baseline` → `epa@7.0.0+baseline`. **Not yet republished** — see "Required next step".

## Result

| | before | after | Statbotics | gap closed |
|---|---|---|---|---|
| 2024 accuracy | 0.7348 | **0.7520** | 0.7627 | **62%** |
| 2024 Brier | 0.2179 | **0.1704** | 0.1620 | **81%** |

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

## Honest costs

Re-measured across all ten seasons against the shipped code. Five seasons gain 0.03–0.05
Brier. **Three get marginally worse and are recorded, not omitted:** 2016 (+0.0031), 2017
(+0.0027), 2019 (+0.0028). The re-seed carries the prior season's mean as well as its SD, and
FRC's scale jumps hard across those boundaries (2016 averaged 85.5, 2017 averaged 233.5), so
Welford's running variance is transiently inflated while the mean migrates. The pooled
accumulator happened to sit closer to those three seasons' scales by coincidence. Pinned by a
dedicated test so it is a known property, not a surprise.

2016's accuracy moves −0.45 pp for a separate, benign reason: at cold start both alliances hold
identical components, so the margin is exactly 0 and the `>= 0` tie convention picks red.
Sorted summation turns some of those exact zeros into ±1e-15, flipping coin-flip picks.

## Verification

- 236 test files / 4,360 tests green at repo root scope; both `tsc --noEmit` projects clean
  (root and `apps/web` — project memory warns the root config alone misses the web app).
- Baseline arm of every experiment reproduced the published slice exactly (16,958 published −
  194 ties = 16,764; accuracy 0.7348 to four places) before any variant was trusted.
- 28 tests were red mid-change, every one traced to these two changes and fixed at the source
  rather than by loosening an assertion. `carryover.test.ts`'s "carried forward unchanged"
  case pinned the defect itself and now pins the re-seed.

## Required next step (not done here)

**A republish is required for any of this to reach the site.** `v1/compare/*.json` and
`v1/methodology/epa-vs-statbotics.json` still serve `6.0.0` figures, and the per-team agreement
statistics and committed tolerance bands in `docs/models/epa-vs-statbotics.md` have not been
re-measured under `7.0.0` — that file now carries a stale-figures banner. Publishing is
outward-facing and was left for explicit authorisation.

Scratch scripts: `experiments/260910-4x0/` and `experiments/260910-5ym/` (gitignored).
