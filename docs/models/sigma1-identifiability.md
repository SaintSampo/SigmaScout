# Sigma1 identifiability (SC-3)

This is the check the failure log demands before a variance-carrying model ships: REBUILD_SPEC.md's failure log records an unidentifiable 4D offense/defense/time-allocation model that collapsed — given only alliance-level 3-vs-3 sum observations, the optimizer had more free parameters per team than the data could pin down, and parameters drifted arbitrarily between runs rather than converging. D-06's response was structural: Sigma1 estimates offense only, no defense latent, no cross-team covariance. This document is the check that the response actually works, run against the real corpus (`data/corpus.sqlite`) rather than argued on paper — every number below is quoted from `reports/identifiability.json`, produced by `packages/harness/identifiability.ts` (`pnpm identifiability --seasons 2022-2026`).

## 1. What Sigma1 estimates — every state dimension, per season

Sigma1 tracks exactly one thing per team: a mean and variance for each named component in that season's registered `breakdown/*.ts` component map (D-02), plus a derived `foulsCommitted` component (D-04). **No other latent dimension exists in `Sigma1State`** — no defense rating, no time-allocation split, no cross-team correlation term. Every component is recovered from the same observable: a 3-vs-3 alliance's summed contribution to that component for one match, exactly the structure `opr.ts`'s ridge regression already uses for the season TOTAL. This is what D-06 means by "no defense latent" — Sigma1 has nothing else to estimate beyond what a 3-vs-3 alliance sum, replayed match by match, can actually observe.

The registered components per season (`componentMapForSeason(season).components`, verified live against the corpus this session):

| Season | Components |
|---|---|
| 2022 | `autoTaxi`, `autoCargo`, `teleopCargo`, `endgame`, `adjust`, `foulsCommitted` |
| 2023 | `autoMobility`, `autoGamePiece`, `autoChargeStation`, `teleopGamePiece`, `link`, `endGameChargeStation`, `endGamePark`, `adjust`, `foulsCommitted` |
| 2024 | `autoLeave`, `autoAmpNote`, `autoSpeakerNote`, `teleopAmpNote`, `teleopSpeakerNote`, `teleopSpeakerNoteAmplified`, `endGameOnStage`, `endGamePark`, `endGameHarmony`, `endGameNoteInTrap`, `endGameSpotLightBonus`, `adjust`, `foulsCommitted` |
| 2025 | `autoMobility`, `autoCoral`, `teleopCoral`, `algae`, `endGameBarge`, `adjust`, `foulsCommitted` |
| 2026 | `autoTower`, `endGameTower`, `hubAuto`, `hubTransition`, `hubShift1`, `hubShift2`, `hubShift3`, `hubShift4`, `hubEndgame`, `adjust`, `foulsCommitted` |

Every component here is alliance-level (never per-robot — RESEARCH.md's Assumption A1: TBA's per-robot fields exist but their positional correspondence to `red_teams`/`blue_teams` array order is unverified, so no per-robot field is read anywhere in this phase). A per-team value is recovered from an alliance sum the same way `opr.ts` recovers a per-team total from an alliance's total score — via regression across many overlapping alliances, never a direct per-robot read.

## 2. Sampling design and what was measured (not a full-season claim)

A full-season design matrix is roughly 36,000 rows x 3,700 columns (`opr.ts`'s own file header measurement) — a dense SVD at that scale is not tractable (`opr.ts` measured ~21s at n=1,500 with cubic scaling; n≈3,700 would run for hours). `identifiability.ts` instead draws a fixed, seeded 25-event sample per season (Mulberry32 PRNG, seed 42 — deterministic, reproducible), yielding:

| Season | Events sampled | Matches | Alliance observations (rows) | Teams (columns) |
|---|---|---|---|---|
| 2022 | 25 / 190 | 1,760 | 3,520 | 775 |
| 2023 | 25 / 196 | 2,076 | 4,152 | 845 |
| 2024 | 25 / 200 | 2,190 | 4,380 | 891 |
| 2025 | 25 / 215 | 2,251 | 4,502 | 986 |
| 2026 | 25 / 227 | 2,029 | 4,058 | 781 |

**Every number in this document is scaled to this sample — never presented as a full-season result.** The 0/1 alliance-participation design matrix is identical across every component within a season (it depends only on which teams shared an alliance, not on any component's value — see `identifiability.ts`'s own file header for the full argument), so `rank`/`conditionNumber` are computed once per season and quoted identically for every component; what varies per component is `nonZeroFraction`/`teamsWithFiveObservations`.

## 3. Thresholds and verdicts

Stated and justified in `identifiability.ts`'s header, applied by the script itself (never left to prose):

- **`CONDITION_NUMBER_CEILING = 1e8`.** Double-precision floats carry ~15-16 significant decimal digits; solving a linear system with condition number C loses roughly log10(C) digits of accuracy. A ceiling of 1e8 leaves ~7-8 digits intact — generous for FRC point totals (tens to low hundreds of points) while still catching a genuinely ill-conditioned participation graph.
- **`MIN_NONZERO_FRACTION = 0.05`** (5%). Below this, almost every team's estimate for that component is dominated by its cold-start prior rather than real data, regardless of conditioning — set deliberately above this plan's own "3% is clearly not identifiable" example, so the check does not wait until the failure is already obvious.
- **Full column rank required** (`rank === teamColumnCount`). A rank deficiency means the sampled alliance-participation graph is disconnected into two or more clusters whose relative ratings are not identifiable AT ALL — this would not otherwise show up as a large `conditionNumber`, since `conditionNumber` is computed only over the surviving (non-negligible) singular values.

| Season | Design matrix | Rank | Condition number | Full column rank |
|---|---|---|---|---|
| 2022 | 3,520 x 775 | 767 | 7.08 | **No** — 8 teams disconnected |
| 2023 | 4,152 x 845 | 845 | 4.52 | Yes |
| 2024 | 4,380 x 891 | 888 | 9.07 | **No** — 3 teams disconnected |
| 2025 | 4,502 x 986 | 986 | 5.19 | Yes |
| 2026 | 4,058 x 781 | 781 | 4.46 | Yes |

Every season's condition number is small (single digits) — the alliance-participation graph, where connected, is extremely well-conditioned; this is not a marginal pass anywhere. The interesting finding is the rank deficiency in 2022 and 2024, addressed next.

### The 2022/2024 rank deficiency is a sample-connectivity artifact, not a corpus-wide identifiability failure

Tracing the disconnected components (a follow-on union-find pass over the same seeded sample, run for this write-up, not shipped as part of `identifiability.ts`) shows the disconnected teams are **not scattered noise** — they are entire regional/international event clusters whose sampled events never shared an alliance with the rest of the 25-event sample:

- **2022:** 4 connected components (sizes 679, 48, 30, 18). The three small islands are exactly `2022on410` (an Ontario district event, 18 teams), `2022qcmo2`+`2022qcmo3` (two Quebec district events, connected to each other but not the rest, 30 teams), and `2022tuis` (a Tunisia event, 48 teams).
- **2024:** 2 connected components (sizes 860, 31). The one island is `2024isde1` (an Israel district event, 31 teams).

This is exactly what regional/international FRC district structure predicts: within a season, an Israel or Ontario/Quebec district event's teams mostly play only each other until a connecting event (a district championship, or Einstein/Worlds) brings regions together — and this 25-event sample, drawn uniformly at random across the WHOLE season, has a real chance of missing every one of a small region's connecting events. **A team inside one of these islands is fully identifiable RELATIVE TO its own island** (the island's own sub-block of the design matrix is itself well-conditioned — these are small, densely-played regional event sets) — what is NOT established by this sample is that an Ontario team's rating is on the same absolute scale as a team from the 679-team main component. A full-season run (every event, not a 25-event sample) would almost certainly connect these islands via the events this sample happened not to draw (district championships, Worlds/Einstein) — but this script does not run at that scale (see Section 2), so that claim is not made here as a verified fact. **This is recorded as a known limitation of the current check's sample size, not resolved by widening the sample until the seasons pass** — inflating the sample post hoc to make 2022/2024 look identifiable would be exactly the kind of result-shopping this project's methodology forbids (the plan's own prohibition: no choice may be made on the basis of a figure and then have the figure re-run until it looks better).

### Per-component verdicts

Every component in 2022 and 2024 inherits a `fail` verdict from the design-level rank deficiency above (a component-specific number cannot outrun a structural connectivity gap in the shared design matrix). 2023/2025/2026, where the design matrix is fully connected, show every component passing except `adjust`:

| Season | Component | Verdict | Non-zero fraction | Teams w/ 5+ obs | Reason (beyond design-level rank, if any) |
|---|---|---|---|---|---|
| 2022 | all 6 | fail | 0.1%-98.1% | 0-767 | design-level: 8 teams disconnected (see above) |
| 2023 | `autoMobility` | pass | 91.2% | 835 | — |
| 2023 | `autoGamePiece` | pass | 93.2% | 841 | — |
| 2023 | `autoChargeStation` | pass | 69.5% | 758 | — |
| 2023 | `teleopGamePiece` | pass | 99.5% | 845 | — |
| 2023 | `link` | pass | 86.2% | 817 | — |
| 2023 | `endGameChargeStation` | pass | 92.4% | 844 | — |
| 2023 | `endGamePark` | pass | 60.0% | 796 | — |
| 2023 | `adjust` | **fail** | 0.1% | 0 | below the 5% non-zero floor |
| 2023 | `foulsCommitted` | pass | 46.7% | 647 | — |
| 2024 | all 13 | fail | 0.0%-97.7% | 0-885 | design-level: 3 teams disconnected (see above); `autoAmpNote`/`adjust` additionally below the 5% floor even setting rank aside |
| 2025 | `autoMobility` | pass | 99.9% | 986 | — |
| 2025 | `autoCoral` | pass | 78.0% | 905 | — |
| 2025 | `teleopCoral` | pass | 98.6% | 986 | — |
| 2025 | `algae` | pass | 66.6% | 820 | — |
| 2025 | `endGameBarge` | pass | 97.5% | 986 | — |
| 2025 | `adjust` | **fail** | 0.1% | 0 | below the 5% non-zero floor |
| 2025 | `foulsCommitted` | pass | 37.8% | 529 | — |
| 2026 | `autoTower` | pass | 5.1% | 32 | passes, but marginal — only just above the 5% floor |
| 2026 | `endGameTower` | pass | 8.7% | 49 | passes, but marginal |
| 2026 | `hubAuto` | pass | 99.7% | 781 | — |
| 2026 | `hubTransition` | pass | 75.0% | 774 | — |
| 2026 | `hubShift1`-`hubShift4` | pass | 47.5%-49.7% | 597-665 | — |
| 2026 | `hubEndgame` | pass | 97.6% | 781 | — |
| 2026 | `adjust` | **fail** | 0.0%-0.2% | 0 | below the 5% non-zero floor |
| 2026 | `foulsCommitted` | pass | 37.5% | 458 | — |

**`adjust` fails in every season.** This is TBA's referee-adjustment-points field — by design, it is near-never non-zero (a referee adjustment is a rare correction, not a routine scoring event), so the 0.0-0.2% non-zero fraction is the CORRECT measurement of a genuinely rare event, not a defect in the check or the corpus. Sigma1 still tracks `adjust` as a component (D-01: "track nearly every data source TBA/FIRST exposes... within reason"), and its near-total absence of signal is exactly why the cold-start/league-mean prior dominates it for essentially every team, every season — an honest, expected, low-stakes outcome (a referee adjustment being mispredicted costs at most a few points, rarely).

## 4. Fouls (D-04) — the weakest component, measured, per season

D-04 named `foulsCommitted` the weakest member of the set before any of this was measured, on the reasoning that TBA's foul fields are alliance-level only and the observation is comparatively rare. The measurement agrees, with a wrinkle D-04's original framing did not anticipate: **fouls are not uniformly weak — 2022/2023 are meaningfully more foul-prone than 2024-2026**, and 2026 renames the underlying raw fields entirely.

| Season | Matches with breakdown (sampled) | Matches with any foul recorded | Fraction | Raw field name(s) |
|---|---|---|---|---|
| 2022 | 1,760 | 1,135 | **64.5%** | `foulCount`, `techFoulCount` |
| 2023 | 2,076 | 1,464 | **70.5%** | `foulCount`, `techFoulCount` |
| 2024 | 2,190 | 1,650 | **75.3%** | `foulCount`, `techFoulCount` |
| 2025 | 2,251 | 1,367 | **60.7%** | `foulCount`, `techFoulCount` |
| 2026 | 2,029 | 1,170 | **57.7%** | `majorFoulCount`, `minorFoulCount` (renamed — `foulCount`/`techFoulCount` absent from 2026's `score_breakdown`) |

These figures are measured directly from this session's SAMPLED corpus read (`identifiability.ts`'s `foulDiagnostics`, checked against the raw, unparsed `score_breakdown` JSON — deliberately NOT through `foulsCommitted`'s derived component, since that component's own non-zero fraction, tabulated separately below, answers a related but different question: "how often did fouls actually cost points," not "how often was any foul recorded at all"). They differ somewhat from the pre-phase estimates recorded in RESEARCH.md's Pitfall Sigma1-1 table (63.2%/65.1%/36.5%/30.3%/36.9%, computed over full-season data) because this check's sample is a 25-event subset, not the full season — the direction (2022-2024 higher than 2025-2026) is consistent, but the magnitudes differ meaningfully for 2024 in particular (36.5% full-season vs. 75.3% in this 25-event sample), which is itself worth noting: foul-recording rate is not uniform across events within a season, so a 25-event sample can and does diverge from the full-season figure. Both are legitimate measurements of different things (sample vs. full corpus); neither is wrong, but a reader comparing them against each other without noticing the different denominators would draw an incorrect conclusion.

Separately, `foulsCommitted`'s own DERIVED non-zero fraction (the fraction of alliance OBSERVATIONS — not matches — where the derived per-team component is non-zero, i.e. where fouls actually cost points, quoted in Section 3's table) ranges 37.5%-51.5% across the four seasons where the design matrix is connected enough to have a component-level verdict at all (2023/2025/2026 pass; 2024's design-level rank deficiency masks what would otherwise likely also be a pass, since 51.5% is well above the 5% floor). This is consistently the LOWEST-signal component among the season's non-`adjust` components — exactly matching D-04's prediction that fouls would be the weakest member of the set, now with a specific number attached rather than an assumption.

2026's field rename (`majorFoulCount`/`minorFoulCount` replacing `foulCount`/`techFoulCount`) is handled explicitly by `breakdown/2026.ts`'s own `diagnosticKeys` and by `identifiability.ts`'s per-season `foulDiagnosticKeys` lookup — no code anywhere assumes a foul field name is stable across seasons (RESEARCH.md Pitfall Sigma1-1).

## 5. Why no defensive latent is estimated (D-06)

REBUILD_SPEC.md's failure log records a 4D offense/defense/time-allocation model that never converged: given only an alliance-sum observable, the optimizer had more free parameters per team than the observable could separate, and different parameter settings produced statistically indistinguishable fits — the textbook unidentifiable-model failure PITFALLS.md's Pitfall 2 also names generically. D-06's design response is structural, not a tuning fix: **Sigma1 estimates offense only.** There is no defense parameter anywhere in `Sigma1State` for an optimizer to fail to identify. When a team suppresses an opponent's scoring (real defensive play), that suppression shows up as unexplained RESIDUAL on the OPPONENT's offensive components — correctly widening the opponent's `±` (since the opponent's actual contribution that match diverged from its own historical mean) rather than being attributed to a defense term the alliance-sum observation model has no way to identify in the first place. This is the direct, one-level-deeper application of the same discipline Section 1 already established for every OTHER component: Sigma1 has exactly the state dimensions this document enumerates, and nothing else — the identifiability check in Sections 2-4 is therefore a check over the COMPLETE state space, not a subset of it.

## 6. Assumption A2, recorded honestly

RESEARCH.md's Assumption A2: Sigma1's teams-are-a-priori-independent simplification (no cross-team covariance tracked, D-06's own extension of "no defense latent" to the covariance structure) is a DESIGN CHOICE, not something this identifiability check — or any check performed so far — has evidence for or against. It is the standard simplification used by every incremental pairwise/group rating system (Elo, Glicko, TrueSkill family), and it is what keeps Sigma1's per-match update O(1) in team count (RESEARCH.md's Pattern 2) rather than reintroducing OPR's O(n²) cost. But nothing in this document, or in plan 02-04's synthetic-fixture tests, establishes that assuming independence costs zero accuracy relative to a jointly-correlated alternative. **The mechanism that would catch A2 costing accuracy is Phase 3's tune-season backtest against OPR/EPA on the same corpus** — the walk-forward harness's own Brier-score comparison (D-21: raw numbers only, no precomputed "wins by" claim) is exactly the tool that would surface A2 as a measurable gap if it exists. This document does not claim A2 is safe; it records that A2 is untested by anything built so far, and names the specific future check (Phase 3's backtest) that would test it.

## 7. SC-2 — Statbotics per-team tolerance check: blocked on an external dependency (D-14)

SC-2's Statbotics per-team numeric tolerance check is **recorded as blocked, not redefined into something achievable**, per D-14. Evidence, verified live 2026-08-13:

- `api.statbotics.io/v3/year/{year}` — HTTP 500
- `api.statbotics.io/v3/team_year/{team}/{year}` — HTTP 500
- `api.statbotics.io/v3/team/{team}` — HTTP 500
- `statbotics.io`'s blog (a possible fallback source for published numbers) — HTTP 403 to automated fetch

All four endpoints/pages were re-confirmed reproducibly failing across multiple sessions this phase (plans 02-01 through 02-06, most recently 2026-08-14 per plan 02-03's SUMMARY) — this is not a transient outage, and no live comparison is possible from this offline pipeline.

**Two options were considered and rejected:**

1. **Running Statbotics' own Python model against this project's corpus.** Rejected — this project's clean-slate mandate (REBUILD_SPEC.md) forbids consulting or porting pre-v3 implementations, and while Statbotics' Python source is a different project's codebase (not this project's own prior implementation), running its actual model code would produce a "comparison" that is really just Statbotics grading itself against this project's corpus, not an independent verification of either implementation's correctness — and would not exercise the live Statbotics API's own computed values at all, which is what SC-2 actually asks for.
2. **Pulling values from Wayback Machine snapshots of Statbotics' site/API.** Rejected — a snapshot's values would be tied to whatever model version Statbotics was running on the snapshot date, not the current live model, making any "tolerance" comparison meaningless (comparing this project's 2026 reimplementation against a stale, unversioned historical snapshot is not a check of anything specific).

**What EPA's correctness rests on instead** (recorded per plan 02-03's own resolution of this same blocker, reaffirmed here): `epa.test.ts`/`carryover.test.ts`'s hand-computed synthetic fixtures (verified against Statbotics' own SOURCE CODE constants and formulas, fetched and cross-checked directly — `NORM_MEAN=1500`, `NORM_SD=250`, `INIT_PENALTY=0.2`, `YEAR_ONE_WEIGHT=0.7`, `MEAN_REVERSION=0.4`, `ELIM_WEIGHT=1/3` all confirmed verbatim against the live GitHub source), plus the walk-forward structural proofs (T-02-08's byte-identical-prefix regression, the leak-proof Proxy). This is a real substitute for a live numeric tolerance check, but it is a DIFFERENT kind of evidence (verified against source code and internal consistency, not against a live published output) — recorded honestly as such, not silently treated as equivalent to what SC-2 originally asked for.

## 8. What this document does NOT claim

- It does not claim Sigma1 or EPA beat OPR on accuracy — that comparison lives in `reports/full-v2/report.html` (plan 02-06 Task 2), is measured on holdout seasons only (2025-2026), and is a Phase 3 question, not this document's.
- It does not claim the 2022/2024 disconnected-graph finding generalizes to the full season — Section 3 states explicitly that a full-season run was not performed (tractability) and that the specific islands found (regional/international district events) are exactly the kind of gap a wider event sample would very likely close, without asserting that as a verified fact.
- It does not claim A2 (team independence) is accuracy-neutral — Section 6 names the specific future check that would establish that, and states plainly that nothing built so far does.

---
*Phase: 02-prediction-models-epa-sigma1 (plan 02-06)*
*Numbers quoted from `reports/identifiability.json`, generated by `pnpm identifiability --seasons 2022-2026` against `data/corpus.sqlite`.*
