# EPA vs. Statbotics — SC-2 verdict (quick task 260904-4aa)

**SC-2** (Phase 2's success criteria): "EPA runs walk-forward at any point in a season, and
spot-checked teams land within a documented tolerance of published Statbotics numbers."

> **RE-MEASURED AND REPUBLISHED 2026-09-10 (quick task 260910-5ym): the shipping model is now
> `epa@7.0.0+baseline`, generation `97342984-f48c-49b7-9811-ab124a246cd8`.** Two defects quick
> task 260910-4x0 measured are fixed: the win-probability denominator no longer pools alliance
> scores across seasons (`carrySeason` re-seeds `allianceScoreStats` instead of carrying its
> observation count), and 2024's component map is grouped at phase granularity.
>
> **`scripts/epaVsStatbotics.ts --check` PASSED** under 7.0.0 — all 25 gated statistics are
> inside their committed bands, so `data/baselines/epa-vs-statbotics-2026-09.json` is unchanged
> and still gates the shipped model. Only 2024's agreement row moved, which is exactly what was
> predicted before the run: the win-probability change cannot move a per-team total (it only
> scales `pRedWin`), and 2024 is the only season whose component map changed. Its official-only
> agreement got TIGHTER, not looser: slope 1.014 -> 1.008, Pearson 0.9946 -> 0.997, mean
> absolute difference 0.75 -> 0.52 points.
>
> Head-to-head, measured like-for-like from the PUBLISHED `v1/compare/{year}.json` artifacts on
> both sides (generation `e169a4d4` at `epa@6.0.0+baseline` vs `97342984` at
> `epa@7.0.0+baseline`) — same scorer, same tie handling, same corpus:
>
> | Season | accuracy 6.0.0 -> 7.0.0 | Brier 6.0.0 -> 7.0.0 | Statbotics |
> |--------|--------------------------|-----------------------|------------|
> | 2016 | 0.7195 -> 0.7195 | 0.1857 -> 0.1857 | 0.7312 / 0.1799 |
> | 2017 | 0.6681 -> 0.6681 | 0.2047 -> 0.2043 | 0.6694 / 0.2023 |
> | 2018 | 0.7333 -> 0.7333 | 0.1801 -> 0.1797 | 0.7435 / 0.1747 |
> | 2019 | 0.6441 -> 0.6441 | 0.2310 -> 0.2309 | 0.7322 / 0.1763 |
> | 2020 | 0.7113 -> 0.7113 | 0.2164 -> 0.1909 | 0.7262 / 0.1834 |
> | 2022 | 0.7710 -> 0.7710 | 0.2149 -> 0.1598 | 0.7815 / 0.1502 |
> | 2023 | 0.7610 -> 0.7610 | 0.2079 -> 0.1628 | 0.7647 / 0.1608 |
> | 2024 | 0.7348 -> **0.7520** | 0.2179 -> **0.1688** | 0.7627 / 0.1620 |
> | 2025 | 0.7772 -> 0.7772 | 0.1953 -> 0.1596 | 0.7839 / 0.1537 |
> | 2026 | 0.7943 -> 0.7943 | 0.1548 -> 0.1536 | 0.7978 / 0.1483 |
>
> **No season regressed on either metric.** Brier improved in nine of ten and held exactly in
> 2016, which is the cold-start season where `carrySeason` never runs at all. Accuracy is
> unchanged everywhere except 2024, as expected: the scale fix cannot change `sign(margin)`, and
> 2024 is the only season whose components were regrouped.
>
> **CORRECTION, recorded because it was published wrong first.** An earlier revision of this
> banner claimed 2016, 2017 and 2019 came out ~0.003 WORSE on Brier, and attributed it to the
> re-seed carrying the prior season's mean across a hard scale jump. That was an artifact of the
> COMPARISON, not a property of the model: the "before" column was read from the published
> artifacts (which include ties in the Brier denominator) while the "after" column came from a
> scratch script that excluded them. Comparing the two published generations directly, with one
> scorer on both sides, shows the regressions do not exist. The transient variance inflation
> that reasoning invoked IS a real property of `reseedFromPrior` and is pinned by its own test in
> `expandingStats.test.ts`; it simply never reached the season-level figures. The lesson is the
> ordinary one: a before/after table whose two columns come from two different scorers is not a
> measurement.
>
> The per-team agreement tables further down this document were measured under earlier model
> versions on the dates they name, and remain historical records of those versions.

## History

Recorded **blocked-on-external-dependency** from 2026-08-13 (Phase 1's recon,
`docs/data/tba-field-recon.md`) through 2026-08-14 (Phase 2's D-14, `02-VERIFICATION.md`):
`api.statbotics.io/v3/year/{year}` reproducibly returned HTTP 500 across three URL shapes,
re-confirmed live on both dates. `02-CONTEXT.md`'s deferred-items list carried it forward:
"Statbotics per-team numeric tolerance check (SC-2) — blocked on Statbotics' API returning."

That blocker is gone. Verified live 2026-09-04: `/v3/year/{2022..2026}`, `/v3/team_year/254/2024`,
and `/v3/team_years?year=2025&limit=1000&offset=N` all return HTTP 200, and 2025 paginates to
3,690 team rows. This quick task builds the per-team tolerance check SC-2 asks for and replaces
the un-re-runnable ad-hoc measurement `packages/core/algorithms/epa.ts`'s file header used to cite
("OLS slope vs Statbotics 0.489 -> 0.841", from quick task 260901-is2, a script that was never
committed).

## Measurement methodology

- **Script:** `scripts/epaVsStatbotics.ts` (`npx tsx scripts/epaVsStatbotics.ts`, no `--env-file`
  — this work is credential-free).
- **Statistics:** `packages/harness/epaStatboticsCompare.ts`, a pure, network-free, corpus-free
  module driven by 14 hand-computed synthetic-fixture tests
  (`packages/harness/epaStatboticsCompare.test.ts`).
- **Replay:** one threaded, chronological `epa` replay across the requested season range
  (`packages/harness/replay.ts`'s `buildSeasonStream`/`WalkForwardSimulator`, cold-starting
  positionally at the first requested season per `seasonBoundaryFor`'s D-1 contract, `carrySeason`
  threaded at each boundary) — the same season-loop shape `scripts/measureRewindGap.ts` already
  established. Season-final `epa.teamMetrics()` is captured at EVERY season in the range, not only
  the last.
- **Statbotics data:** `packages/harness/statbotics.ts`'s `fetchStatboticsTeamYears`, paging
  `/v3/team_years?year={season}&limit=1000&offset=N`, Zod-validated at the fetch boundary, thrown
  on any failure (no silent partial series).

### The comparability boundary

One property and one adjustment make "our EPA" and "Statbotics' EPA" mean the same quantity — both
enforced structurally in `epaStatboticsCompare.ts`'s `joinTeams`/the script's own
`ourTeamValuesFromState`, never left as an unstated assumption:

1. **Fouls are excluded from our own published `total` — no longer an adjustment this comparison
   makes, a property of the metric itself as of `epa@3.0.0+baseline` (D-01, quick task 260904-5px).**
   Statbotics' `epa.total_points` is a NO-FOUL figure — verified live 2026-09-04: `frc254`/2024's
   `total_points` is `51.71`, and `auto_points 15.94 + teleop_points 29.48 + endgame_points 6.28 =
   51.70`. `epa.ts`'s `teamMetrics()` now excludes `foulsCommitted` (D-04's cross-attributed
   component: the points an alliance's own fouls cost the OPPONENT) from `total` directly, so this
   script's `ourTeamValuesFromState` reads `total` straight off `teamMetrics()` with no subtraction
   of its own — the exclusion moved from this comparison into the metric. The per-team tables below
   were measured on the IDENTICAL quantity either way (the subtraction and the metric-level
   exclusion compute the same number); the `Ours` columns formerly labelled as `total -
   foulsCommitted` are now simply `total`. Those per-team figures HAVE since been re-measured under
   D-05's elimination discount (see "Tolerance and the committed baseline" below for the current,
   refreshed bands — the tables in "Spot-checked teams" below are the historical `epa@2.0.0+baseline`
   measurement and were not individually regenerated).
2. **Demo team keys never enter the join, on either side.** Raw `frc9970`-`frc9999` and the shared
   pseudo key `demo-pseudo-unregistered` (`packages/core/algorithms/demoTeams.ts`) are dropped by
   `joinTeams` before the join runs.

### Offseason inclusion materially widens the gap — measured, not assumed

Production's own replay stream (`publish:seasons`, and every figure this quick task's default run
produces) is **offseason-inclusive**. Whether Statbotics' team-year EPA reflects offseason events
was an open comparability question this task settled empirically by running BOTH arms against the
identical seasons.

**Both arms re-measured under `epa@6.0.0+baseline` on 2026-09-08 (quick task 260908-n5o), and the
season set widened to 2022-2026.** The table below previously carried the retired
`epa@2.0.0+baseline` measurement over 2022-2025 only, which meant the published A/B compared one
model version against itself across a narrower season set than the production table above. Two
model versions in one A/B is not a controlled comparison, and neither is two season sets, so both
arms were re-run together against the shipping model. This is the "all-teams" arm, matching the
column shape this table has always used; the min-matches(12) arm is in the per-season table above.

| Season | Arm | Joined | OLS slope | Pearson | Mean abs diff |
|--------|-----|--------|-----------|---------|----------------|
| 2022 | offseason-inclusive | 3,053 | 0.877 | 0.940 | 2.12 pts |
| 2022 | offseason-excluded | 3,053 | 0.972 | 0.997 | 0.65 pts |
| 2023 | offseason-inclusive | 3,284 | 0.852 | 0.936 | 2.90 pts |
| 2023 | offseason-excluded | 3,284 | 0.976 | 0.998 | 0.71 pts |
| 2024 | offseason-inclusive | 3,474 | 0.806 | 0.918 | 2.75 pts |
| 2024 | offseason-excluded | 3,474 | 0.994 | 0.991 | 0.89 pts |
| 2025 | offseason-inclusive | 3,687 | 0.856 | 0.916 | 5.03 pts |
| 2025 | offseason-excluded | 3,687 | 1.014 | 0.993 | 2.62 pts |
| 2026 | offseason-inclusive | 3,714 | 0.963 | 0.972 | 5.01 pts |
| 2026 | offseason-excluded | 3,714 | 0.999 | 0.993 | 1.95 pts |

**The delta is large, not negligible.** Excluding offseason matches from our own replay moves
Pearson from the 0.92-0.97 range to 0.99+ and mean absolute difference down by 1.5 to 3 points
every season, with the OLS slope moving from a 0.81-0.96 compression to 0.97-1.01 (2026
offseason-excluded lands at 0.999, and 2024 at 0.994 — essentially Statbotics' own scale). This is strong evidence
that **Statbotics' `epa.total_points` reflects the official season only** (through
championships), while our production figures also fold in offseason events (post-championship
scrimmages, exhibition brackets, etc.) that genuinely move a team's rating but that Statbotics'
own reference series never saw. This is a real, structural divergence in what "this season's EPA"
means between the two systems — not a bug in either one — and it is the single largest
contributor to the residual `epaVsStatbotics.ts` measures on the production (offseason-inclusive)
arm. `epa-divergences.md` §4 (win-probability scale, expanding-window SD) and §1 (elim weighting)
already document two *rating-mechanics* divergences; this is a third, *data-population*
divergence, newly measured rather than assumed.

2026 was excluded from this table when it was first measured, on the grounds that the season was
still in progress and its offseason population was not yet meaningfully comparable. As of the
2026-09-08 re-measurement it is included, and it behaves like every other season: the excluded arm
lands at a slope of 0.999 and a Pearson of 0.993, against 0.963 and 0.972 on the inclusive arm.

**Neither arm above is what the site publishes, and the A/B is no longer on the explainer page.**
Kept here as measurement history, because it is the evidence that offseason inclusion is the
dominant term in the residual. See the next section for the quantity the site actually shows.

### The published quantity: each team's rating at its own last official match

**Added 2026-09-08 (quick task 260908-n5o), after checking the page against live artifacts.** Both
arms above measure a team's SEASON-FINAL rating. No surface on this site displays that number. The
Teams list publishes `publish.ts`'s `lastOfficialMetricsByTeam` and the team-page header renders
`apps/web/src/lib/officialSnapshot.ts`'s `officialSnapshotRow` — both the team's rating as of its
own LAST OFFICIAL MATCH. Measured live on `epa@6.0.0+baseline`, 2026:

| Team | Teams list (published) | Season-final (`seasonStats.metrics.total`) |
|------|------------------------:|--------------------------------------------:|
| frc7769 | 313.95 | 251.37 |
| frc88 | 155.96 | 182.75 |
| frc2056 | 302.03 | 277.79 |
| frc254 | 328.39 | 328.39 |

Teams with no offseason play agree exactly; every team with offseason play splits. So the
offseason-inclusive arm was scoring a quantity no visitor is shown, and it understated agreement
with Statbotics substantially.

`scripts/epaVsStatbotics.ts` now measures a third arm, `officialOnly`, inside the same replay pass
via an `onMatchComplete` callback that mirrors `lastOfficialMetricsByTeam`'s rule rather than
restating it. min-matches(12), `epa@6.0.0+baseline`:

| Season | Joined | OLS slope | Pearson | Mean abs diff |
|--------|--------|-----------|---------|----------------|
| 2022 | 2,574 | 0.981 | 0.998 | 0.55 pts |
| 2023 | 2,796 | 0.970 | 0.998 | 0.68 pts |
| 2024 | 2,895 | 1.014 | 0.995 | 0.75 pts |
| 2025 | 3,051 | 1.007 | 0.993 | 2.75 pts |
| 2026 | 3,100 | 0.998 | 0.998 | 1.31 pts |

**Validated against the live published artifacts, not just against itself** — the check that would
have caught the original mistake. Measured against published Teams-list totals for 2026: frc7769
313.91 vs 313.95, frc88 155.97 vs 155.96, frc2056 302.06 vs 302.03, frc254 328.40 vs 328.39.
Residuals of 0.01-0.04 are rounding plus a different replay start season (this script starts at
2022; `publish:seasons` starts at 2016), not a rule mismatch.

**This is the live source for the site's own explainer.** This arm, plus the head-to-head
win-probability figures below, is published as a single artifact at
`v1/methodology/epa-vs-statbotics.json` and rendered on `/methodology/epa-vs-statbotics`. Each row
carries `basis: "last-official-match"` so the object names the quantity it measures, and
`scripts/publishEpaComparison.ts` throws `MissingOfficialOnlyArmError` rather than publish a report
that lacks the arm. The offseason-inclusive arm keeps gating the committed tolerance bands via
`--check` and is unchanged; it is simply no longer the number on the page.

## Per-season measured table (production arm: offseason-inclusive, 2022-2026)

`our` / `their` are each side's team count after demo-key exclusion, before the join;
`joined` is the inner-join count. The min-matches(12) arm additionally requires a team's
Statbotics-reported match count to be at least 12 — the point at which `epaPercentFunc`'s learning
rate has decayed to its floor and a rating has mostly stopped moving fast; low-match teams are
noisy on both sides and would otherwise dominate the mean absolute difference.

| Season | Arm | Joined (our / their) | OLS slope | Pearson | Mean abs diff | Our SD | Their SD |
|--------|-----|----------------------|-----------|---------|----------------|--------|----------|
| 2022 | all teams | 3,053 (3,127 / 3,053) | 0.866 | 0.929 | 2.38 | 9.99 | 10.72 |
| 2022 | min-matches(12) | 2,574 | 0.875 | 0.925 | 2.54 | — | — |
| 2023 | all teams | 3,284 (3,638 / 3,284) | 0.854 | 0.921 | 3.21 | 13.02 | 14.05 |
| 2023 | min-matches(12) | 2,796 | 0.845 | 0.911 | 3.47 | — | — |
| 2024 | all teams | 3,474 (4,036 / 3,474) | 0.803 | 0.906 | 2.87 | 8.56 | 9.65 |
| 2024 | min-matches(12) | 2,895 | 0.818 | 0.904 | 3.09 | — | — |
| 2025 | all teams | 3,687 (4,456 / 3,687) | 0.865 | 0.907 | 5.35 | 17.80 | 18.67 |
| 2025 | min-matches(12) | 3,051 | 0.861 | 0.898 | 5.87 | — | — |
| 2026 | all teams | 3,714 (4,743 / 3,714) | 0.942 | 0.965 | 6.64 | 49.35 | 50.51 |
| 2026 | min-matches(12) | 3,100 | 0.941 | 0.968 | 6.67 | — | — |

Full machine-readable results (every joined team, not just the spot-check sample below):
`reports/epa-vs-statbotics/epa-vs-statbotics.json` (production arm) and
`reports/epa-vs-statbotics-nooff/epa-vs-statbotics.json` (offseason-excluded comparability arm).
Both directories are gitignored generated output — re-run
`npx tsx scripts/epaVsStatbotics.ts` / `npx tsx scripts/epaVsStatbotics.ts --seasons 2022-2025 --no-offseason --out reports/epa-vs-statbotics-nooff`
to regenerate them.

Slope stays below 1.0 in every offseason-inclusive season, consistent with
`epa-divergences.md`'s six documented deliberate divergences (D-08's full-weight elims, D-13's no
per-season post-processing, D-04's cross-attributed fouls, the independently-derived component
maps, Pitfall EPA-1's expanding-window SD) plus the newly-measured offseason-population effect
above — this is the expected resting point of those choices, not an unfinished job.

## Spot-checked teams (SC-2's own wording)

The top 15 teams by Statbotics `total_points`, plus a deterministic sample of 15 more drawn by a
fixed seed (`selectSpotCheckTeams`, seed `20260904`, `mulberry32` — the same PRNG
`scripts/measureRewindGap.ts` already uses) — a re-run reproduces the identical named rows every
time. All from the production (offseason-inclusive) run, all-teams arm.

### 2022

| Team | Statbotics `total_points` | Ours (`total - foulsCommitted`) | Diff |
|------|---------------------------:|---------------------------------:|-----:|
| frc1678 | 69.09 | 76.63 | +7.54 |
| frc1323 | 65.29 | 69.38 | +4.09 |
| frc1690 | 64.95 | 64.13 | -0.82 |
| frc254 | 64.86 | 57.56 | -7.30 |
| frc27 | 62.10 | 41.89 | -20.21 |
| frc67 | 59.21 | 53.39 | -5.82 |
| frc2056 | 58.06 | 68.25 | +10.19 |
| frc1577 | 57.41 | 56.10 | -1.31 |
| frc1771 | 56.86 | 52.67 | -4.19 |
| frc624 | 56.83 | 50.76 | -6.07 |
| frc2910 | 55.59 | 68.93 | +13.34 |
| frc176 | 54.53 | 50.67 | -3.86 |
| frc148 | 53.98 | 45.15 | -8.83 |
| frc973 | 53.54 | 44.68 | -8.86 |
| frc111 | 52.92 | 46.47 | -6.45 |
| frc5528 | 12.07 | 11.78 | -0.29 |
| frc7472 | 12.59 | 14.67 | +2.08 |
| frc6824 | 3.90 | 2.08 | -1.82 |
| frc3313 | 15.27 | 10.76 | -4.51 |
| frc6831 | 22.39 | 27.97 | +5.58 |
| frc3669 | 16.19 | 17.29 | +1.10 |
| frc2228 | 19.20 | 12.52 | -6.68 |
| frc2073 | 31.65 | 24.40 | -7.25 |
| frc7634 | 19.03 | 18.03 | -1.00 |
| frc386 | 26.83 | 27.41 | +0.58 |
| frc4632 | 10.17 | 10.42 | +0.25 |
| frc8051 | 9.13 | 11.61 | +2.48 |
| frc7048 | 19.51 | 11.42 | -8.09 |
| frc4476 | 41.02 | 39.14 | -1.88 |
| frc7436 | 11.17 | 12.53 | +1.36 |

### 2023

| Team | Statbotics `total_points` | Ours | Diff |
|------|---------------------------:|-----:|-----:|
| frc1323 | 84.15 | 84.28 | +0.13 |
| frc2056 | 83.67 | 27.93 | -55.74 |
| frc1678 | 77.86 | 81.90 | +4.04 |
| frc6329 | 77.31 | 66.49 | -10.82 |
| frc254 | 77.18 | 78.84 | +1.66 |
| frc3005 | 75.65 | 71.60 | -4.05 |
| frc5940 | 75.09 | 73.46 | -1.63 |
| frc2046 | 74.78 | 52.20 | -22.58 |
| frc2910 | 74.55 | 82.47 | +7.92 |
| frc6036 | 73.68 | 60.46 | -13.22 |
| frc1577 | 72.31 | 67.64 | -4.67 |
| frc2468 | 72.28 | 70.54 | -1.74 |
| frc3538 | 72.21 | 40.28 | -31.93 |
| frc930 | 71.79 | 50.13 | -21.66 |
| frc1325 | 71.53 | 49.38 | -22.15 |
| frc5586 | 46.99 | 52.46 | +5.47 |
| frc2526 | 31.35 | 33.24 | +1.89 |
| frc4603 | 11.03 | 12.60 | +1.57 |
| frc5851 | 42.10 | 42.98 | +0.88 |
| frc4964 | 15.63 | 16.24 | +0.61 |
| frc2481 | 60.55 | 63.85 | +3.30 |
| frc7717 | 22.31 | 21.29 | -1.02 |
| frc5927 | 28.56 | 25.77 | -2.79 |
| frc8700 | 24.64 | 24.80 | +0.16 |
| frc6106 | 15.78 | 10.77 | -5.01 |
| frc5052 | 14.91 | 17.28 | +2.37 |
| frc368 | 49.18 | 45.42 | -3.76 |
| frc8516 | 38.71 | 30.88 | -7.83 |
| frc2170 | 41.80 | 33.09 | -8.71 |
| frc6823 | 50.08 | 39.87 | -10.21 |

frc2056's 2023 row (-55.74) is by far the largest single divergence measured in any spot-check
table across all five seasons — flagged here rather than smoothed over or excluded. It was not
investigated further: this task's mandate is to measure and document, not to tune EPA's
attribution arithmetic (see "Do NOT tune EPA" in the plan this task executes). A plausible
contributing factor consistent with the divergences already on record is a season with an unusual
mix of surrogate/DQ/demo-adjacent matches for that team, but this is a hypothesis, not a verified
cause.

### 2024

| Team | Statbotics `total_points` | Ours | Diff |
|------|---------------------------:|-----:|-----:|
| frc1678 | 58.05 | 43.88 | -14.17 |
| frc1323 | 55.76 | 48.90 | -6.86 |
| frc3005 | 54.85 | 53.26 | -1.59 |
| frc6328 | 54.26 | 37.39 | -16.87 |
| frc2056 | 53.70 | 49.36 | -4.34 |
| frc1690 | 53.62 | 51.02 | -2.60 |
| frc1796 | 52.99 | 35.43 | -17.56 |
| frc1771 | 52.71 | 47.79 | -4.92 |
| frc254 | 51.71 | 37.36 | -14.35 |
| frc1756 | 51.67 | 41.65 | -10.02 |
| frc1706 | 51.28 | 43.29 | -7.99 |
| frc604 | 50.93 | 41.23 | -9.70 |
| frc2910 | 50.25 | 33.92 | -16.33 |
| frc4414 | 49.49 | 36.33 | -13.16 |
| frc5940 | 49.23 | 48.29 | -0.94 |
| frc8787 | 10.30 | 6.56 | -3.74 |
| frc9287 | 10.27 | 13.89 | +3.62 |
| frc4476 | 39.02 | 37.21 | -1.81 |
| frc5923 | 7.20 | 6.46 | -0.74 |
| frc6854 | 10.58 | 10.96 | +0.38 |
| frc5031 | 11.49 | 11.53 | +0.04 |
| frc4499 | 39.47 | 31.71 | -7.76 |
| frc7178 | 23.96 | 24.36 | +0.40 |
| frc8087 | 11.49 | 7.50 | -3.99 |
| frc2903 | 7.70 | 5.46 | -2.24 |
| frc1111 | 9.14 | 9.96 | +0.82 |
| frc2797 | 7.02 | 9.13 | +2.11 |
| frc2130 | 8.79 | 11.18 | +2.39 |
| frc6873 | 15.24 | 19.98 | +4.74 |
| frc9303 | 4.97 | 4.66 | -0.31 |

2024 is notable for a consistent NEGATIVE bias among the top 15 (every one of the top 15 teams
runs lower on our side than Statbotics') — the smallest OLS slope of any measured season (0.803,
all-teams arm), consistent with the table above.

### 2025

| Team | Statbotics `total_points` | Ours | Diff |
|------|---------------------------:|-----:|-----:|
| frc2056 | 120.05 | 100.59 | -19.46 |
| frc2910 | 114.07 | 86.10 | -27.97 |
| frc1323 | 111.96 | 116.17 | +4.21 |
| frc1690 | 107.72 | 107.39 | -0.33 |
| frc1678 | 105.74 | 93.43 | -12.31 |
| frc118 | 104.75 | 103.98 | -0.77 |
| frc2481 | 99.40 | 92.93 | -6.47 |
| frc5940 | 98.63 | 78.71 | -19.92 |
| frc1796 | 98.05 | 88.37 | -9.68 |
| frc4678 | 97.95 | 86.33 | -11.62 |
| frc3683 | 97.72 | 77.58 | -20.14 |
| frc694 | 97.18 | 99.17 | +1.99 |
| frc7457 | 96.42 | 99.96 | +3.54 |
| frc422 | 95.58 | 61.20 | -34.38 |
| frc4414 | 94.24 | 95.64 | +1.40 |
| frc5160 | 21.71 | 23.59 | +1.88 |
| frc7603 | 19.18 | 25.94 | +6.76 |
| frc6657 | 42.69 | 40.59 | -2.10 |
| frc2013 | 11.82 | 16.57 | +4.75 |
| frc3853 | 12.99 | 3.30 | -9.69 |
| frc3646 | 23.52 | 29.34 | +5.82 |
| frc10281 | 22.27 | 25.65 | +3.38 |
| frc5486 | 20.45 | 21.26 | +0.81 |
| frc4717 | 18.18 | 19.07 | +0.89 |
| frc7797 | 20.99 | 22.43 | +1.44 |
| frc6981 | 18.82 | 19.70 | +0.88 |
| frc7038 | 21.53 | 24.69 | +3.16 |
| frc9023 | 69.64 | 62.07 | -7.57 |
| frc1229 | 35.49 | 37.75 | +2.26 |
| frc7762 | 16.02 | 19.68 | +3.66 |

### 2026 (season still in progress at measurement time)

| Team | Statbotics `total_points` | Ours | Diff |
|------|---------------------------:|-----:|-----:|
| frc4414 | 356.94 | 335.16 | -21.78 |
| frc254 | 327.82 | 317.27 | -10.55 |
| frc1323 | 309.96 | 278.44 | -31.52 |
| frc7769 | 309.28 | 228.54 | -80.74 |
| frc1690 | 302.61 | 414.14 | +111.53 |
| frc2056 | 302.17 | 261.21 | -40.96 |
| frc27 | 295.15 | 279.25 | -15.90 |
| frc2481 | 288.12 | 287.06 | -1.06 |
| frc1114 | 287.57 | 260.71 | -26.86 |
| frc125 | 283.42 | 280.41 | -3.01 |
| frc5687 | 282.69 | 251.32 | -31.37 |
| frc2910 | 281.69 | 244.38 | -37.31 |
| frc1678 | 279.67 | 266.36 | -13.31 |
| frc9470 | 278.91 | 120.80 | -158.11 |
| frc7558 | 278.87 | 273.78 | -5.09 |
| frc3821 | 2.97 | 2.51 | -0.46 |
| frc2075 | 144.05 | 150.09 | +6.04 |
| frc8885 | 5.98 | 7.48 | +1.50 |
| frc9138 | 6.53 | 5.70 | -0.83 |
| frc6071 | 22.25 | 23.93 | +1.68 |
| frc8590 | 30.31 | 30.61 | +0.30 |
| frc991 | 62.78 | 70.83 | +8.05 |
| frc5137 | 95.08 | 93.17 | -1.91 |
| frc11219 | 26.33 | 32.88 | +6.55 |
| frc2344 | 57.70 | 55.18 | -2.52 |
| frc10661 | 69.27 | 74.54 | +5.27 |
| frc4277 | 29.46 | 27.11 | -2.35 |
| frc4909 | 134.50 | 135.57 | +1.07 |
| frc1625 | 127.62 | 111.24 | -16.38 |
| frc3683 | 177.66 | 176.65 | -1.01 |

frc9470 (-158.11) and frc1690 (+111.53) are 2026's two largest outliers, in opposite directions —
flagged for the same reason as frc2056's 2023 outlier above (measured and reported, not
investigated or smoothed). 2026 is still in progress as of this measurement (2026-09-04); both our
own EPA state and Statbotics' team-year figures will continue to shift for the remainder of the
season, which the baseline's own rationale names as a known limitation of gating a live season
(see below).

## Tolerance and the committed baseline

`data/baselines/epa-vs-statbotics-2026-09.json` records, per season, a tolerance band for
`ordinaryLeastSquaresSlope`, `pearson`, `meanAbsoluteDifference`, `ourStandardDeviation`, and
`theirStandardDeviation` — built from the offseason-inclusive, production-parity run's
min-matches(12) arm (the less-noisy of the two arms, per the discussion above). Bands are centred
on the measured value: slope/Pearson at ±0.05, mean absolute difference at ±1.0 points, and both
standard deviations at ±max(1.5, 10% of the measured value) so a season with a much larger point
scale (2026: our SD ≈ 51) is not gated by a band sized for a smaller-scale season (2022: our SD ≈
10).

**Re-measured 2026-09-04 (quick task 260904-5px).** The bands above were originally measured under
the retired `epa@2.0.0+baseline`. D-01's fouls-exclusion change (moving the subtraction from this
script into `epa.teamMetrics()`) was verified FIRST as an arithmetic identity against those
untouched 2.0.0 bands — `--check` passed with the baseline file byte-identical, proving nothing
double-subtracts. The bands were then RE-MEASURED (this commit) — not because the corpus stopped
being deterministic, but because two genuine model changes landed since: quick task 260904-6a1's
adjust-pinning/adjust-zeroed-alliance correction (`epa@3.0.0+baseline -> 4.0.0+baseline`) and D-05's
elimination-match discount adopted by this task (`epa@4.0.0+baseline -> 5.0.0+baseline`). Both are
folded into the current bands together — the movement from the 2.0.0-measured bands to the current
ones is NOT attributable to the elimination discount alone. The half-width formula itself is
UNCHANGED; only the centres moved, recentred on freshly measured `epa@5.0.0+baseline` values. The
determinism claim still holds going forward: re-running `scripts/epaVsStatbotics.ts` unchanged
against the current code reproduces these figures exactly, so the bands exist to catch a REAL
regression in EPA's attribution arithmetic or component extraction, not day-to-day measurement
noise.

```
npx tsx scripts/epaVsStatbotics.ts --check
```

**Measured result: PASSED**, both times — once against the byte-identical 2.0.0 bands (the fouls
change alone, proving the arithmetic identity) and once against the re-measured 5.0.0 bands (the
elimination discount plus 6a1's adjust change, which genuinely move the statistics). Every one of
the 25 gated statistics (5 seasons × 5 statistics) falls inside its current committed band.

**Did agreement with Statbotics get tighter or closer to 1.0?** Comparing each season's re-measured
min-matches-arm OLS slope against the centre the OLD (2.0.0) bands implied:

| Season | Old slope (epa@2.0.0, band centre) | New slope (epa@5.0.0, measured) | Direction |
|--------|------------------------------------:|-----------------------------------:|-----------|
| 2022 | 0.875 | 0.886 | tighter (+0.011) |
| 2023 | 0.845 | 0.842 | looser (-0.003) |
| 2024 | 0.818 | 0.818 | essentially flat (+0.0004) |
| 2025 | 0.861 | 0.853 | looser (-0.009) |
| 2026 | 0.941 | 0.961 | tighter (+0.021) |

**Mixed, not a clean win in one direction — flagged as a genuine surprise, not smoothed over.**
Three seasons (2022, 2024, 2026) moved tighter or held flat; two (2023, 2025) moved slightly
looser. §1's own prediction (adopting Statbotics' elimination discount should move the slope closer
to 1.0) is only partially borne out, and the movements are small in every season (≤0.02) — small
enough that they are plausibly within the noise the corpus's continued growth introduces between
measurements, rather than a clean signal that the elimination discount (plus 6a1's adjust change)
dominates the residual. This is not investigated further here (matching this document's own
"measure and document, not tune" mandate) and is not reverted over — the adoption is the developer's
locked decision regardless of which way the numbers moved.

The 2026 row is a named, deliberate exception to "the corpus is deterministic": 2026 is still in
progress, so its baseline band will need re-measuring (and likely widening or replacing) as more
of that season is played — see the baseline's own `rationale` field.

### Carry-instant change (`epa@6.0.0+baseline`, quick task 260908-615, 2026-09-08)

**What changed.** EPA's cross-season prior is now taken at a season's last OFFICIAL match rather
than at its season-final state (`carryFrom: "last-official-match"` →
`WalkForwardSimulator.runAll`'s `carryStates`). See `epa-divergences.md` §7. Every season after the
first in a multi-season replay therefore starts from a different prior, so the per-team figures the
bands above gate CAN move — this is a genuine model change, not measurement noise, and it is the
same class of change as D-05's elimination discount, which also required a re-measurement.

**Why a `--check` run is required rather than optional.** The committed bands in
`data/baselines/epa-vs-statbotics-2026-09.json` were centred on freshly measured
`epa@5.0.0+baseline` values. They have NOT been re-measured for 6.0.0. Until the command below has
been run, the band file describes a model that is no longer the one shipping.

```
npx tsx scripts/epaVsStatbotics.ts --check
```

**Procedure if `--check` FAILS**, following the 2026-09-04 re-measurement note above exactly: re-run
the script without `--check`, rebuild the bands with the **UNCHANGED half-width formula**
(slope/Pearson ±0.05, mean absolute difference ±1.0, both standard deviations ±max(1.5, 10%)) recentred
on the freshly measured values, commit the refreshed baseline, and record a per-season before/after
slope table in the same shape as the 2026-09-04 one — including an honest direction verdict, whether
or not it matches the prediction.

**Predicted direction: closer agreement.** Statbotics' own priors are championship-frozen, so
removing an offseason tail from our carry moves the two systems' cross-season seeding toward each
other. Recorded before the run as a prediction to be checked, never as a result.

#### Measured result (2026-09-08): PASSED — and the prediction held

`npx tsx scripts/epaVsStatbotics.ts --check` **PASSED**. All 25 gated statistics (5 seasons × 5
statistics) fall inside their existing committed bands, so
`data/baselines/epa-vs-statbotics-2026-09.json` is UNCHANGED by this task — no re-measurement of the
bands was required, and the half-width formula was not touched.

Unlike D-05's elimination discount — whose own before/after table above is honestly reported as
"mixed, not a clean win" — this change moved agreement with Statbotics **tighter on all three
statistics in essentially every season**. Min-matches(12) arm, `epa@5.0.0+baseline` (measured
2026-09-04) vs `epa@6.0.0+baseline` (measured 2026-09-08):

| Season | Slope 5.0.0 → 6.0.0 | Pearson 5.0.0 → 6.0.0 | Mean abs diff 5.0.0 → 6.0.0 |
|--------|----------------------|------------------------|------------------------------|
| 2022 | 0.886 → 0.886 (flat) | 0.925 → 0.937 | 2.54 → 2.24 |
| 2023 | 0.842 → 0.845 | 0.911 → 0.928 | 3.47 → 3.14 |
| 2024 | 0.818 → 0.823 | 0.904 → 0.918 | 3.09 → 2.94 |
| 2025 | 0.853 → 0.855 | 0.898 → 0.907 | 5.87 → 5.51 |
| 2026 | 0.961 → 0.963 | 0.968 → 0.976 | 6.67 → 4.76 |

**No season moved away from Statbotics on any of the three.** Slope rose toward 1.0 in four seasons
and held flat in the fifth; Pearson rose in all five; mean absolute difference fell in all five, most
sharply in 2026 (6.67 → 4.76 points). The movements are small in slope terms (≤0.005) but consistent
in sign across every season and every statistic, which is a different quality of evidence from a
single large move — a coin-flip effect does not land the same direction fifteen times.

**One further observable change, recorded because it is real and would otherwise puzzle a future
reader:** our own pre-join team counts DROPPED in the later seasons (2024: 4,036 → 3,987; 2025:
4,456 → 4,384; 2026: 4,743 → 4,643). That is the carry-instant change working as designed, not
teams going missing. A team whose only appearance in season N was in that season's offseason tail is
no longer carried into season N+1's initial state, so it no longer shows up in N+1 with a
carried-over rating it had not earned in official play. Joined counts are unchanged (Statbotics'
side is unchanged, and the join is an inner one), so every statistic above is measured over the same
team population as before.

## SigmaScout's EPA vs. Statbotics' own win-probability model

Now that `metrics.win_prob.season.{acc,mse}` parses correctly (see "The schema fix" below), a
direct comparison is possible. Figures below are both offseason-inclusive, qual+elim-combined
slices from `npx tsx packages/harness/cli.ts --seasons 2022-2026 --algorithm epa --include-offseason`
(no `--env-file` needed for a corpus-only replay) — BEFORE under `epa@2.0.0+baseline` (measured
2026-09-04, before this quick task's changes) and AFTER under `epa@5.0.0+baseline` (measured
2026-09-04, this task's own run, `reports/epa-brier-5px-5.0.0/artifact.json`), so the fouls
exclusion, 6a1's adjust-pinning/adjust-zeroed-alliance change, AND D-05's elimination discount are
ALL reflected together in the AFTER column — this table cannot and does not isolate the elimination
discount's own contribution.

| Season | Statbotics accuracy | EPA accuracy (BEFORE, `2.0.0`) | EPA accuracy (AFTER, `5.0.0`) | Statbotics Brier (mse) | EPA Brier (BEFORE, `2.0.0`) | EPA Brier (AFTER, `5.0.0`) |
|--------|---------------------:|----------------------------------:|----------------------------------:|-------------------------:|-------------------------------:|-------------------------------:|
| 2022 | 0.7815 | 0.7581 | 0.7602 | 0.1502 | 0.1615 | 0.1609 |
| 2023 | 0.7647 | 0.7612 | 0.7608 | 0.1608 | 0.1641 | 0.1643 |
| 2024 | 0.7627 | 0.7356 | 0.7338 | 0.1620 | 0.1870 | 0.1874 |
| 2025 | 0.7839 | 0.7739 | 0.7742 | 0.1537 | 0.1593 | 0.1599 |
| 2026 | 0.7978 | 0.7953 | 0.7942 | 0.1483 | 0.1430 | 0.1434 |

### Re-measured under `epa@10.0.0+baseline` (quick task 260911-r7e, 2026-09-11) — and the 2022 deficit was a MEASUREMENT artifact

**Supersedes every head-to-head figure below.** The `6.0.0` and `5.0.0` tables predate the
carryover scale anchor (`epa@8.0.0`), the frozen week-1 score SD (`epa@9.0.0`) and the 2024
component collapse, so they cannot be read as the model's current standing against Statbotics.

This task was asked for one thing: make EPA's accuracy reproduce Statbotics', with as few changes
as possible. It made **no model change at all.** Two arms were measured and the second one
explains almost the entire remaining deficit.

#### The finding: the first REPORTED season cold-starts, and 2022 was that season

`epaVsStatbotics.ts` defaulted to `--seasons 2022-2026` and `replayEpaSeasonFinals` carries EPA
state forward season by season — so every team entered 2022 with no history, while Statbotics
entered 2022 holding its real 2019/2020 carry-in. The comparison was charging our model for a
cold start its opponent never paid. `--warmup 2016-2020` (this task's only functional change)
replays those seasons for carry alone and reports on 2022-2026 as before.

| Season | Statbotics | ours, COLD 2022-start | ours, WARM 2016-warmup | Δ cold | **Δ warm** | warm − cold |
|--------|------------:|----------------------:|-----------------------:|-------:|-----------:|------------:|
| 2022 | 0.7815 | 0.7576 | 0.7797 | −2.39 pp | **−0.18 pp** | **+2.21 pp** |
| 2023 | 0.7647 | 0.7665 | 0.7636 | +0.18 pp | **−0.11 pp** | −0.28 pp |
| 2024 | 0.7627 | 0.7582 | 0.7578 | −0.45 pp | **−0.49 pp** | −0.05 pp |
| 2025 | 0.7839 | 0.7815 | 0.7802 | −0.24 pp | **−0.37 pp** | −0.12 pp |
| 2026 | 0.7978 | 0.7955 | 0.7962 | −0.23 pp | **−0.16 pp** | +0.07 pp |

Brier, same two arms (Statbotics' `metrics.win_prob.season.mse`):

| Season | Statbotics | ours, COLD | ours, WARM | Δ warm |
|--------|------------:|-----------:|-----------:|-------:|
| 2022 | 0.1502 | 0.1606 | 0.1550 | +0.0048 |
| 2023 | 0.1608 | 0.1597 | 0.1612 | +0.0004 |
| 2024 | 0.1620 | 0.1667 | 0.1667 | +0.0047 |
| 2025 | 0.1537 | 0.1561 | 0.1565 | +0.0028 |
| 2026 | 0.1483 | 0.1505 | 0.1506 | +0.0023 |

`scoredCount` is identical between the two arms in every season (14,603 / 16,290 / 16,958 /
17,815 / 18,337), so this is a controlled A/B on the carried state alone — the warm arm did not
win by scoring a different population.

**Standing result: the accuracy deficit is −0.11 to −0.49 pp, mean −0.26 pp, across all five
seasons.** Every season still trails Statbotics on accuracy — 2023's cold-arm lead does not
survive warming, and that is reported rather than the cold 2023 cell being quoted as a win.
Brier also trails in all five; 2026's former Brier lead was an artifact of the same cold arm.

#### Production was ALREADY warm — only this page's number was wrong

`publish:seasons` has always replayed `--seasons 2016-2020,2022-2026`, so `v1/compare/{season}.json`
and every team/event artifact already carried warm figures. The cold arm existed **only** in
`compare:epa-statbotics`, which feeds `v1/methodology/epa-vs-statbotics.json`. The published
methodology page has therefore been understating our own 2022 accuracy by ~2.2 pp against a
correctly-warm Statbotics column. `compare:epa-statbotics` now passes `--warmup 2016-2020`, so the
next run of it corrects that page.

**Republish debt: `v1/methodology/epa-vs-statbotics.json` is stale as of this task** and still
carries the cold 2022 figure. This task did not republish.

#### What was measured and REFUTED, reported as found

Offseason inclusion was the leading hypothesis for the residual, on the strength of the per-team
agreement table above (offseason-excluded moves OLS slope to 0.97-1.01 and Pearson to 0.99+). It
**does not move accuracy at all**: 0.7576 vs 0.7576 in 2022, and no season moved by more than
0.03 pp. The reason is structural and settles the question rather than leaving it open —
**offseason events are post-championship**, so within a season they occur after every official
match, and `aggregateScores` already excludes offseason matches from scoring in both arms. The
offseason divergence is real for published *values* at season end and cannot reach *predictions on
official matches*. The ablation register's `offseason-population` entry can be narrowed from
`unmeasurable-in-this-harness` to "measured against accuracy, no effect."

#### What was deliberately NOT done, and why

Mechanism 1 (per-season rated component maps) is `GAP` in all nine seasons in
`epa-statbotics-gap.md`, and closing it was the queued plan. The 2024 tracer in quick task
260911-pon measured its closure at **−0.036 accuracy points — a loss** — and eight more seasons of
the same shape were scheduled. Against a total remaining deficit of 0.26 pp, that work cannot pay
for itself, so this task did not continue it. Mechanism 8 (win-probability scale) is excluded for a
stronger reason: winner accuracy is `sign(margin)` only, so the probability scale **cannot** move it
(the ablation's own `epa-winprob-*` arms return verdict `identical`).

#### The one named candidate for the residual, not chased

Our scorer and Statbotics' do not score the same population. `aggregateScores` excludes
surrogate-affected matches; Statbotics' `matchPopulation` is documented as "all qualification +
elimination matches." The gap is visible in the counts: Statbotics reports 13,286 matches for 2016
against our 12,994 (+2.2%). Whether those ~2% move accuracy by the residual 0.2-0.5 pp is
unmeasured. **It is a measurement-comparability difference, not a model difference** — which is why
it is named here with its evidence rather than closed by changing the model to chase it.

#### `--check`'s baseline is a COLD-arm artifact

`data/baselines/epa-vs-statbotics-2026-09.json` holds per-team agreement tolerance bands measured
on the cold arm. `--check` run through the now-warm `compare:epa-statbotics` will compare warm
statistics against cold bands and can fail for that reason alone. The baseline was deliberately
**not** re-measured here: moving a tolerance gate is its own decision and must not ride along
inside a measurement task.

### SUPERSEDED — re-measured under `epa@6.0.0+baseline` (quick task 260908-n5o, 2026-09-08)

**Historical. The "this is what the site publishes" claim this heading used to carry is no longer
true** — see the `10.0.0+baseline` section above, which also shows that this table's 2022 row
(0.7602) was measured on a cold 2022 start and understates the model by ~2.2 pp. Kept as
measurement history.

The three columns above were measured under `2.0.0` and `5.0.0` via
`packages/harness/cli.ts`. The table below is the `6.0.0+baseline` figure, measured by
`scripts/epaVsStatbotics.ts`'s own win-probability arm, which is the exact quantity published to
`v1/methodology/epa-vs-statbotics.json` and rendered on `/methodology/epa-vs-statbotics`.

**These are not a drop-in continuation of the columns above and must not be read as one.** They
come from a different harness path over a different match population (this script's own
chronological replay, `scoredCount` 14,603 to 18,337 per season), so a cell-by-cell delta against
the `5.0.0` column mixes a model change with a measurement-path change. Stated here rather than
quietly appended to the table above, which is what would have made it look controlled.

| Season | EPA accuracy (`6.0.0`) | Statbotics accuracy | EPA Brier (`6.0.0`) | Statbotics Brier | Scored |
|--------|------------------------:|---------------------:|---------------------:|------------------:|--------:|
| 2022 | 0.7602 | 0.7815 | 0.1609 | 0.1502 | 14,603 |
| 2023 | 0.7621 | 0.7647 | 0.1633 | 0.1608 | 16,290 |
| 2024 | 0.7328 | 0.7627 | 0.1862 | 0.1620 | 16,958 |
| 2025 | 0.7767 | 0.7839 | 0.1586 | 0.1537 | 17,815 |
| 2026 | 0.7937 | 0.7978 | 0.1428 | 0.1483 | 18,337 |

**Statbotics has the higher winner accuracy in all five seasons.** Our EPA wins on Brier in 2026
only (0.1428 against 0.1483). That is the same standing verdict the `5.0.0` table above reports,
and the published page states it in those terms rather than selecting the one season we lead.

**The Statbotics columns here are dated reference figures, not live ones.** `/v3/year/{season}`
returned HTTP 200 with an empty JSON body when this was measured on 2026-09-08, so
`statboticsReference` fell back to its constants captured 2026-09-04. The published artifact
carries a per-season `statboticsFetched: false` for exactly this reason and the page renders those
cells marked `(dated)`, so a stale figure is visible as stale instead of passing as current.

**Reported plainly, as measured: the movement is small and mixed, not a clean improvement or a
clean degradation.** Accuracy improved in 2022 and 2025 (by ~0.02-0.03 points), and degraded
slightly in 2023, 2024, and 2026 (by ~0.01-0.18 points, all under 0.002 in relative terms — 2024's
is the largest single movement at -0.18 accuracy points). Brier improved (got lower, better) only in
2022 (-0.0006); it got very slightly worse (higher) in 2023, 2024, 2025, and 2026 (+0.0002 to
+0.0004 each). None of these movements are large enough to change this document's standing verdict:
**Statbotics' own win-probability model still beats our EPA reimplementation on both accuracy and
Brier in four of five seasons** (2022-2025, both before and after); **our EPA still wins on Brier in
2026** (0.1434 vs. Statbotics' 0.1483, AFTER) while still trailing slightly on accuracy (0.7942 vs.
0.7978). This is not a regression to fix — `epa.ts`'s own file header states plainly that EPA is
"the honest, faithful, variance-free baseline," never the algorithm this project is built to prove
out; Sigma1 (the variance-carrying alternative, D-01/D-03/D-10) is. This table is EPA's honest
standing against the system it reimplements, nothing more — the adoption of Statbotics' elimination
discount is reported here regardless of the small size of its effect, not selectively reported only
if it had moved the numbers by more.

This comparison mixes an offseason-inclusive slice (ours) against a Statbotics season figure whose
own offseason inclusion is unconfirmed (same caveat as the per-team comparison above) — flagged
here rather than treated as apples-to-apples.

## The schema fix (the OTHER reason SC-2 stayed blocked)

The endpoint returning was necessary but not sufficient. `StatboticsYearResponseSchema` parsed
`{ epa_acc: number }` — a shape live `/v3/year/{season}` has never returned in its current v3 form
(verified 2026-09-04). Winner-prediction accuracy actually lives at
`metrics.win_prob.season.acc`, with Statbotics' own Brier score (directly comparable to ours)
alongside it at `metrics.win_prob.season.mse`. That meant `statboticsReference` had been catching
its OWN parse failure on every call and returning `STATBOTICS_REFERENCE_FALLBACK` unconditionally
— **the API coming back up on 2026-09-04 changed nothing on its own**, because the parse failed
before the fallback path was ever reached. Fixed in `packages/harness/statbotics.ts`: the schema
now reads the live shape, `mse` is a new field on `StatboticsReference`, and every fallback
constant is replaced with a value fetched live and individually verified 2026-09-04 (see that
file's own doc comments for the full before/after).

**The fallback correction, restated.** Every corrected figure is 6-9 winner-accuracy points HIGHER
than the estimate it replaces:

| Season | Old estimate (unverified, dated 2026-08-13) | New value (fetched and verified 2026-09-04) | Delta |
|--------|----------------------------------------------|-----------------------------------------------|-------|
| 2022 | 0.70 | 0.7815 | +8.15 pts |
| 2023 | 0.70 | 0.7647 | +6.47 pts |
| 2024 | 0.71 | 0.7627 | +5.27 pts |
| 2025 | 0.71 | 0.7839 | +7.39 pts |
| 2026 | 0.71 | 0.7978 | +8.78 pts |

This makes the target SigmaScout is measured against materially HARDER — that is the correction,
not a problem with it.

## Flagged: a stale claim this correction contradicts

`.planning/PROJECT.md` line 67 (Success Metrics table) currently reads: "EPA reimplemented, not
pulled from Statbotics API ... ⚠ Partially held (Phase 2) — reimplementation works walk-forward at
every boundary, but the spot-check mitigation is **blocked**: `api.statbotics.io/v3/year/{year}`
reproducibly 500s (D-14, WINDOWS entries 1–2). EPA correctness currently rests on synthetic-fixture
tests and walk-forward structural proofs instead."

That is now false — the blocker is resolved and the spot-check mitigation this document records
exists, is committed, and is re-runnable. `PROJECT.md` is not in this quick task's declared file
scope, so it is not edited here; per this task's own "flag, do not silently rewrite" instruction, a
pending todo is filed instead: `.planning/todos/pending/update-project-md-sc2-blocked-claim.md`.

## Verdict

**SC-2 is met, at the tolerance recorded in `data/baselines/epa-vs-statbotics-2026-09.json`
(slope/Pearson ±0.05, mean absolute difference ±1.0 points, both standard deviations
±max(1.5, 10%) — all measured on the offseason-inclusive, production-parity, min-matches(≥12)
arm) — with the explicit, measured caveat that offseason-inclusive agreement (Pearson 0.90-0.97,
slope 0.80-0.94) is meaningfully looser than offseason-excluded agreement (Pearson 0.99+, slope
~0.95-1.01), a real structural divergence in what "this season's EPA" means between the two
systems, not a defect in either.**

SC-2 moves from blocked-on-external-dependency to measured-and-closed, replacing the prior
externally-blocked record, with committed evidence:

- `scripts/epaVsStatbotics.ts` — the re-runnable comparison
- `packages/harness/epaStatboticsCompare.ts` / `.test.ts` — the tested statistics
- `data/baselines/epa-vs-statbotics-2026-09.json` — the committed tolerance
- `reports/epa-vs-statbotics/` / `reports/epa-vs-statbotics-nooff/` — the full per-team results
  (gitignored, regenerate with the commands above)
- this document — the spot-checked named teams, the tolerance, and the comparability boundary

---

### Accuracy standing, added 2026-09-11 (quick task 260911-r7e)

The verdict above is about per-team EPA **value** agreement. On head-to-head **winner accuracy**,
measured warm under `epa@10.0.0+baseline`, EPA trails Statbotics by **−0.11 to −0.49 pp (mean
−0.26 pp)** in 2022-2026, and trails on Brier in all five seasons. That is the honest standing and
it required no model change to reach — the previously-reported 2022 deficit of −2.39 pp was a cold
2022 start in the comparison script, not the model.

*Quick task: 260904-4aa; accuracy standing re-measured by 260911-r7e (2026-09-11).*
*Statbotics endpoints re-verified live 2026-09-04.*
