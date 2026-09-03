---
id: extend-corpus-2019-2020
created: 2026-09-03
source: quick task 260903-230 — user named it as the reason D-5's coverage loss is acceptable
resolves_phase:
priority: high
---

# Extend the corpus back to 2019 and 2020

> **Scope set 2026-09-03 by the user, superseding this file's original "back to 2016" framing.**
> Add **2019 and 2020**. **2021 is never part of the corpus** — it was the at-home/remote
> season with no conventional 3v3 alliance matches, so there is nothing for a match predictor
> to ingest. That is a permanent exclusion, not a deferral.
>
> **Sequencing: this runs BEFORE `retune-sigma1-rolling-origin`.** Tuning once on the final
> corpus beats tuning now and re-tuning after. This resolves the sequencing question that file
> left undecided.

## Why this is filed

`rolling-origin-hyperparameter-tuning`'s **D-5** restricts the Compare page to seasons that
have an origin, which today means 2024/2025/2026 — three displayed seasons instead of five.
The user accepted that coverage loss on the explicit grounds that the corpus will extend back
to 2016, at which point the stranded seasons are the ancient ones rather than the recent ones.

That backfill **was not tracked anywhere** — no todo, no backlog entry, no roadmap phase — so
D-5's justification rested on an intention with no record. This file is that record. If this
job is never done, D-5 should be revisited, because a permanent three-season Compare page is a
materially weaker evidence base than the five-season one it replaced.

## What it buys

The corpus currently runs 2022–2026 (`eventScopeDiagnostic.ts`'s `DEFAULT_SEASONS =
"2022-2026"`, and `score.ts`'s season guard throws outside that range). Rolling origin spends
the earliest seasons as the first selection window and can never score them, so the corpus
start determines which seasons are permanently unscoreable:

| Corpus starts | Earliest selection window | First origin | Displayed seasons (through 2027) |
|---|---|---|---|
| 2022 (today) | 2022–2023 | 2024 | 4 |
| 2016 | 2016–2017 | 2018 | up to 10, minus whatever 2020/2021 costs |

The stranded pair moves from 2022–2023 to 2016–2017, which is the whole point: nobody's
headline claim depends on 2016.

## The 2020/2021 complication — read before scoping this

**2020** was cancelled a few weeks in; only a partial slate of events was ever played.
**2021** was the at-home/remote season, with no conventional alliance matches at all. Neither
is an ordinary season, and a backfill that treats them as ordinary will produce quietly wrong
numbers rather than loud failures.

Two distinct places this bites, and they need separate answers:

1. **Selection windows and origins (Channel A).** Straightforward to handle — a season can be
   excluded from the searchable set and from the origin list by exclusion, and rolling origin's
   "strictly before" rule does not require the selection seasons to be contiguous.
2. **The season-boundary carry (Channel B).** Harder, and currently untested.
   `sigma1CarryNormalizedRating` (`packages/core/algorithms/sigma1/carryover.ts:77-91`) blends
   a team's `lastYear` and `yearBefore` ratings. That assumes two consecutive prior seasons.
   Across a 2020/2021 gap the chain is broken: what is 2022's `lastYear` — 2021 (not
   comparable), 2019 (three years stale), or nothing? The single-season branch
   (`lastYear ?? yearBefore`) and the no-history branch (`EPA_ROOKIE_BASELINE`) both exist, so
   the code will not crash — it will silently pick one. **That is the risk: a defensible-looking
   number produced by an undecided rule.**

   This never arises today because the corpus starts at 2022 and is contiguous. Extending the
   corpus is what makes it real.

## Also worth checking before committing to this

- **RP rules coverage.** `RP_REGISTERED_SEASONS` (`packages/core/algorithms/sigma1/rp/rules.ts:56`)
  is derived from the registered per-season rule modules. Every backfilled season needs its own
  ranking-point rules module, or RP prediction has no rules to apply for it. This is per-season
  manual work and is probably the largest single cost in this job.
- **TBA data quality pre-2018.** Score breakdowns are less consistent in older seasons; the
  harness's `parseBreakdown` guard (quick task `260818-inm`) degrades a Zod failure to a counted
  skip, so bad seasons will show up as skip counts rather than crashes — check those counts
  rather than assuming a clean ingest.
- **Corpus size and ingest time.** Roughly doubling the season count doubles ingest and every
  full-replay cost downstream, including every tuning search.

## Relationship to other open todos

- `rolling-origin-hyperparameter-tuning` D-5 — the decision this justifies.
- `retune-sigma1-rolling-origin` — if the corpus grows before that job runs, its measured cost
  table and its origin list both change. Doing the backfill FIRST would mean tuning once on the
  full corpus rather than tuning now and re-tuning after. Sequencing is not decided here.

---

## How 2020 is accounted for (user question, 2026-09-03)

"2020 was barely a season" is three separate concerns. Only the third needs code.

**1. It is short (~1/3 of a normal season) — NO handling needed.** Sigma1 is a Kalman filter:
a team with 12 matches already carries a wider posterior than one with 60, so "barely a season"
is *already* represented as high variance. The tuning objective is Brier summed over matches, so
2020 contributes roughly a third of a normal season's weight automatically. **Adding an explicit
down-weight would double-count it.**

**2. It must not carry a headline claim — ALREADY covered.** 2020's only prior is 2019, which is
exactly D-4's thin-prior case. Under D-5 it does not display at all. 2019 and 2020 are both
selection-only seasons. No new rule needed.

**3. The 2021 GAP — the real problem, and it is not about 2020 being short.**

The 2020 → 2022 boundary spans two years. `SeasonBoundary` (`packages/core/algorithms/types.ts:203-207`)
already carries `fromSeason` and `toSeason`, but **the gap is never computed anywhere** — verified
2026-09-03: those fields are read only to look up component maps and to label state. So today a
2020 → 2022 carry applies exactly one year's mean-reversion and one year's boundary process
noise. It would claim a team is as predictable after a two-year gap — a full student-cohort
turnover — as after a single off-season.

### Recommended fix — RECOMMENDED, NOT YET CONFIRMED BY THE USER

Make both the reversion and the boundary process noise **per year elapsed** rather than per
boundary:

```
gap = toSeason - fromSeason                            // already available, never used
mean:     revert by 1 - (1 - carryMeanReversion)^gap   // apply it `gap` times
variance: add processNoiseEventBoundary `gap` times    // variances add over a random walk
```

Why this shape rather than a 2020-specific special case:

- **No new parameter and no new tuning axis.** It reuses two params that already exist and are
  already tuned.
- **Bitwise identical when `gap === 1`** — every boundary in the current corpus. It therefore
  clears this project's equivalence-gate bar with a zero-diff proof on the existing span, the
  same way D-T1 had to.
- **Dimensionally correct.** Variance accumulating linearly in elapsed time is the definition of
  a random walk; the current code is the `gap = 1` special case. This generalizes it rather than
  patching around it.
- It fixes the **variance** side, which is what matters. A two-year-stale mean is survivable; a
  two-year-stale mean carried with one-year confidence produces confidently wrong predictions.

## ANSWERED 2026-09-03: RP is NOT separable, and it costs FOUR modules

The open question was whether the replay folds RP for a season it only *selects* on. **It
does.** All three `rpRuleModuleForSeason` call sites in `packages/core/algorithms/sigma1/index.ts`
are unconditional — there is no path that skips RP:

| Call site | What it does |
|---|---|
| `predict()` — `index.ts:1015` | Computes the RP pmf for EVERY match predicted |
| `update()` — `index.ts:1187` | Resolves the rule module for every match update, and sizes a new team's RP state from it |
| `carrySeason()` — `index.ts:1570` | Resolves the INCOMING season's module to size the reset RP state at every boundary |

So replaying 2019 or 2020 **at all** — purely as selection seasons, with nothing RP-related ever
displayed — throws on the first predict/update/carry. The "zero RP modules" branch does not
exist.

### A SECOND per-season module, found while verifying the first

`carrySeason` also calls `componentMapForSeason` (`packages/core/algorithms/breakdown/index.ts:59-64`),
which has the **identical** throw-for-unmapped-season design and its own per-season `{year}.ts`
file (`breakdown/2022.ts` through `2026.ts`).

**Each backfilled season therefore needs TWO modules, not one:**

1. `breakdown/2019.ts`, `breakdown/2020.ts` — the score-component map for that year's game
2. `rp/rules/2019.ts`, `rp/rules/2020.ts` — that year's RP threshold variables and bonuses

**Four modules total.** This is the largest single line item in this job.

### What makes it tractable

It is mechanical, not novel:

- Five worked examples of each already exist.
- `breakdown/index.ts:3` documents the extension path in one line: *"a new entry in
  `SEASON_COMPONENT_MAPS` below and a new `{year}.ts`"*.
- Both directories carry a `reconciliation.test.ts`, so a new season's mapping can be **proven**
  against real corpus data rather than eyeballed.

### Do this FIRST — a ~10-minute de-risk

`scripts/recon-tba-fields.ts` is a read-only probe of TBA's actual `score_breakdown` shape per
season. It is hardcoded to `SEASONS = [2022, 2023, 2024, 2025, 2026]`. **Point it at 2019 and
2020 before anyone writes a module** — it will report exactly what those games expose, which is
the one genuine unknown here. 2019 and 2020 predate every season this codebase was built
against, and their breakdown JSON is shaped differently.

## What the corpus becomes

Seasons: **2019, 2020, 2022, 2023, 2024, 2025, 2026** — 2021 permanently absent.

| Origin (scored, displayed) | Selection seasons |
|---|---|
| 2019 | — nothing before it; not an origin |
| 2020 | 2019 only — thin prior, not an origin (D-4 precedent) |
| 2022 | 2019, 2020 |
| 2023 | 2019, 2020, 2022 |
| 2024 | 2019, 2020, 2022, 2023 |
| 2025 | + 2024 |
| 2026 | + 2025 |
| 2027 | + 2026 |

**This restores 2022 and 2023 to the Compare page.** D-5 took the displayed set down to three
seasons (2024/2025/2026); with this backfill it becomes six (2022 through 2027), because 2022 and
2023 gain genuine origins. The coverage loss D-5 accepted is largely undone by this job — which
is exactly why it runs first.

---

## MEASURED 2026-09-03 — the recon results, and what they decide

Two read-only probes were run against TBA. Both are committed with their output:

- `scripts/recon-tba-fields-2019-2020.ts` → `docs/data/tba-field-recon-2019-2020.md` (the
  complete `score_breakdown` key set per season)
- `scripts/recon-rp-rates-2019-2020.ts` → `docs/data/tba-rp-rates-2019-2020.md` (bonus-RP base
  rates across EVERY in-season event, not a sample)

### Season sizes, so "2020 was barely a season" is a number

| Season | Events that played quals | Qual matches |
|---|---|---|
| 2019 | 189 of 193 listed | **14,916** |
| 2020 | **52 of 186 listed** | **3,806** |

2020 is ~26% the size of 2019. **Consequence for tuning:** the new 2022 origin selects on
2019 + 2020 = **18,722 matches**, versus 31,030 for the earliest origin today (2022+2023). The
earliest origin will therefore be tuned on thinner evidence than any current origin. Not a
blocker, but its results deserve that caveat when read.

### DECIDED: 2020's `shieldEnergizedRankingPoint` is NOT modelled

It fired **0 times in 7,612 alliance-sides**. Not rare — never. `stage3Activated` is likewise
exactly 0. The observed `rp` total maxes out at 3 (win 2 + operational 1), never 4, which
independently confirms it.

`rp/rules/2020.ts` must therefore treat the energized RP as **structurally unavailable**, not as
a live threshold variable. A threshold variable whose target is a constant zero spends a
parameter learning nothing and adds noise to everything it touches.

### RESOLVED: 2019's rocket RP is NOT the hard case it was assumed to be

An earlier note in this file flagged `completeRocketRankingPoint` as a modelling problem because
it is a combinatorial completion condition rather than a count threshold. **The measurement
softens that considerably:** it fires **6.5% — 1,953 positive examples** across 14,916 matches.
That is an ordinary low-base-rate binary prediction, not a special case. The combinatorial rule
governs how the RP was SCORED; predicting it only requires predicting a binary outcome.

### CRITICAL — read the authoritative RP flags, NEVER reconstruct them

Both seasons show bonus-RP flags that **do not reconcile** with their own apparent component
booleans:

| Season | RP flag | Rate | Apparent components | Rate |
|---|---|---|---|---|
| 2019 | `completeRocketRankingPoint` | 6.5% | `completedRocketNear` + `completedRocketFar` | 2.4% + 2.4% ≈ 4.8% |
| 2020 | `shieldOperationalRankingPoint` | 14.7% | `stage2Activated` | **0.5%** — off by ~30x |

The mechanism behind each discrepancy is **not known** and was deliberately not guessed at.

**The instruction that follows is not optional:** `rp/rules/2019.ts` and `rp/rules/2020.ts` must
read the `*RankingPoint` flags as ground truth and must NOT derive them from component fields.
Deriving them from the game rules as understood would have produced two quietly wrong modules
whose tests passed against their own derivation — the exact failure shape this project's failure
log already names.

### Module difficulty, revised by the measurements

| Module | Difficulty | Note |
|---|---|---|
| `breakdown/2019.ts` | Easy | Clean auto/teleop/endgame split; point values confirmed against observed sums |
| `breakdown/2020.ts` | Easy | Same |
| `rp/rules/2019.ts` | Easy-Medium | Two live RPs (rocket 6.5%, HAB docking 41.3%); read the flags, do not derive |
| `rp/rules/2020.ts` | Easy-Medium | ONE live RP (operational 14.7%); energized is structurally absent |

The four modules are routine. The risk in this job is **not** the modelling — it is the
reconstruct-vs-read trap above.

## Sigma1 gap handling — DONE, ahead of this job

Quick task `260903-3bv` (commits `91044bf7`, `003dc7f1`, `bc9fb3d2`) landed the gap-aware carry
this backfill needs, so no Sigma1 carry work remains here:

- `carryMeanReversion` and `consistencyCarryDecay` both apply once per year elapsed.
- Belief variance is unchanged by gap — `carrySeason` already resets it to a cold-start prior,
  and a regression test pins that.
- `cli.ts`, `tune.ts` and `publish.ts` now build boundaries through one shared
  `seasonBoundaryFor`, fixing a hardcoded `fromSeason: season - 1` in tune and publish that would
  have pinned the gap at 1 forever on exactly the two paths that matter.
- Proven a bitwise no-op on the contiguous 2022-2026 corpus.

**EPA is deliberately NOT gap-aware** (user decision, 2026-09-03): it keeps literal
Statbotics-parity behaviour. The accepted consequence is that across the 2020 → 2022 boundary VPR
handles the gap and EPA does not, so VPR gains some advantage on 2022 and 2023 from the baseline
being handicapped rather than from VPR being better.

**Owed follow-up:** when the backtest runs, compute EPA's 2022 figures both ways once and report
the delta, so this caveat is a measured number rather than an open worry. If it is negligible the
concern dissolves; if it is large it is disclosed rather than discovered later.
