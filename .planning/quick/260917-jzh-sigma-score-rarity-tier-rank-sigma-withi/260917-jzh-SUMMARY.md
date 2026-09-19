---
status: complete
quick_id: 260917-jzh
commits:
  - df2ba43e
  - 29efc2fb
  - 4265f726
republish: live 2026-09-18, generation 2c518101-7756-4c03-bcc3-8359474efe91 (budget doc 0db1e16b)
---

# 260917-jzh: Sigma rarity tier ranks Sigma inside its rating window — Summary

Jacob asked whether the Sigma Score rarity tier accounts for strong teams naturally carrying a high
Sigma Score. It did so only halfway. The old scheme ranked the DIFFERENCE between a team's Sigma and
the median Sigma of its rating neighbours, which normalizes level but not spread, on a rating axis
(season-final Total) the Teams page does not show, with one clamped window shared by the top 92 teams.

Replaced with a within-window, OLS-detrended mid-rank percentile on the last-official-match Total
axis (season-final fallback for offseason-only teams), with a symmetric shrinking window and an
11-team floor at the pool's edges. Declared under `spr@5.0.0+baseline`. `predict()`, `pRedWin`,
variance and the match band are untouched: a published-display correction, not an accuracy claim.
The published Sigma VALUE is unchanged; only its percentile, and so its tier, moves.

**Live since 2026-09-18**, generation `2c518101` (108,976 objects, 3.91 GB). Measured on the live
`v1/teams/2026/spr@5.0.0+baseline.json` through `experiments/260917-jzh/measureTiers.ts`, n=3699:
published Legendary share by Total decile 4.6 / 4.3 / 4.9 / 4.6 / 4.9 / 4.3 / 3.8 / 5.9 / 4.9 / 5.7
percent, Common 48.2 to 51.1 percent in every decile, bottom 92 at 45.7 / 27.2 / 20.7 / 6.5 and top 92
at 51.1 / 25.0 / 19.6 / 4.3, frc254 Epic. `pnpm verify:subset` 18 entries, 0 failing, one generation.
D1 seeded for spr only (25,136 rows written); opr and epa versions did not change and were left.
Worker `c9b4642e` deployed after the seed. Live e2e 170/170.

**Old generation deleted 2026-09-18.** Jacob ran `pnpm cleanup:r2-generations --generation
spr@4.0.0+baseline --execute` (36,536 objects, 1.55 GB, the census's only orphan) after the auto mode
classifier denied it to Claude as a cloud storage mass delete. Checked from the public origin
afterwards: the teams, event and team keys under `spr@4.0.0+baseline` all return 404, the same keys
under the three live generations return 200, and `pnpm verify:subset` is still 0 failing. Nothing
further is owed.

## Commits

- `df2ba43e` feat: `sigmaMetric.ts` rewrite, `publish.ts` call site plus four now-false comments, existing tests adapted
- `29efc2fb` test: per-decile uniformity, steep-top-trend edge block, `sigmaWindowIndices` equality pins
- `4265f726` feat: `SPR_VERSION` 4.0.0 to 5.0.0+baseline, `softCredit.test.ts` equality pin

## Live-pool measurement

`npx tsx experiments/260917-jzh/measureTiers.ts` (gitignored, not committed) runs the SHIPPED
`sigmaMetricByTeam` over the live `v1/teams/2026/spr@4.0.0+baseline.json`, decoded with
`decodeTeamMetricEntry`. Inputs are display-rounded published values. 3722 teams, 23 dropped for a
missing Total, 3699 eligible. Re-run and confirmed by the orchestrator after the executor returned.

```
=== Per-decile shares (sorted by published Total) ===
decile 1   n=  369  NEW  common   48.2 rare   26.0 epic   20.6 legendary    5.1  |  PUBLISHED  common   40.4 rare   31.2 epic   26.6 legendary    1.9
decile 2   n=  370  NEW  common   48.1 rare   25.9 epic   21.4 legendary    4.6  |  PUBLISHED  common   41.1 rare   37.0 epic   20.0 legendary    1.9
decile 3   n=  370  NEW  common   48.9 rare   25.7 epic   20.0 legendary    5.4  |  PUBLISHED  common   44.6 rare   32.7 epic   21.6 legendary    1.1
decile 4   n=  370  NEW  common   50.0 rare   25.7 epic   19.7 legendary    4.6  |  PUBLISHED  common   43.8 rare   30.8 epic   24.1 legendary    1.4
decile 5   n=  370  NEW  common   48.4 rare   26.2 epic   20.5 legendary    4.9  |  PUBLISHED  common   47.6 rare   28.6 epic   20.8 legendary    3.0
decile 6   n=  370  NEW  common   49.2 rare   25.1 epic   21.1 legendary    4.6  |  PUBLISHED  common   50.0 rare   19.5 epic   24.9 legendary    5.7
decile 7   n=  370  NEW  common   49.2 rare   25.4 epic   21.1 legendary    4.3  |  PUBLISHED  common   47.0 rare   21.1 epic   20.5 legendary   11.4
decile 8   n=  370  NEW  common   49.7 rare   24.9 epic   19.5 legendary    5.9  |  PUBLISHED  common   47.8 rare   24.3 epic   17.0 legendary   10.8
decile 9   n=  370  NEW  common   51.4 rare   24.1 epic   20.0 legendary    4.6  |  PUBLISHED  common   60.5 rare   17.8 epic   13.2 legendary    8.4
decile 10  n=  370  NEW  common   49.2 rare   25.9 epic   19.2 legendary    5.7  |  PUBLISHED  common   76.5 rare    7.0 epic   11.1 legendary    5.4

=== Edge blocks ===
bottom92   n=   92  NEW  common   47.8 rare   27.2 epic   18.5 legendary    6.5  |  PUBLISHED  common   45.7 rare   29.3 epic   20.7 legendary    4.3
top92      n=   92  NEW  common   51.1 rare   25.0 epic   19.6 legendary    4.3  |  PUBLISHED  common   84.8 rare    7.6 epic    5.4 legendary    2.2

=== Top 5 teams by Total (the stated residual artifact: non-centred windows) ===
  frc254   total=400.24  new tier=epic    new percentile=77.3  published tier=common
  frc1678  total=380.21  new tier=common  new percentile=31.8  published tier=common
  frc4414  total=373.85  new tier=common  new percentile=13.6  published tier=common
  frc1323  total=365.67  new tier=common  new percentile=22.7  published tier=common
  frc27    total=355.73  new tier=epic    new percentile=86.4  published tier=common
```

Stop condition cleared: every decile Common inside [44,56]; both 92-team edge blocks Common inside
[38,62] and Legendary inside [1,11].

Caveat on the axis: this measurement feeds the published (official) Total and the published
(season-final) Sigma, which is exactly the D-2 pairing, but the season-final fallback is covered by
unit test only since the live artifact carries no season-final Total. The pairing asymmetry
(season-final Sigma against an official axis) is documented in the `sigmaMetric.ts` header with its
named follow-up: a last-official Sigma snapshot from the layer walk. No block missed its target, so
there is no measured argument for that follow-up yet.

## Pinned test tolerances (measured, then pinned)

- Uniformity (n=2000, seeded LCG, noise spread growing with rating): new scheme Common 47.0 to 51.5
  and Legendary 3.5 to 6.0 across all deciles (bands [44,56] and [2,9]). Old reference scheme
  Legendary 3.0 bottom decile against 16.5 top decile, 5.5x (asserted floor 3x).
- Steep top trend (top halfWindow=50 block): old scheme 100.0 percent Common (floor 90); new scheme
  46.0 percent Common (ceiling 60) with 3 Legendary (floor 1).
- Window pins: `SIGMA_WINDOW_MIN_HALF_WIDTH === 5`; `(2000, 500, 50)` gives `{450, 551}`; `i=n-1`
  gives `{1989, 2000}`; `i=0` gives `{0, 11}`.
- Outlier: neighbour `frc99` percentile shift measured exactly 0, tier unchanged, pinned `< 2`.
  Farther neighbours in that near-noiseless linear pool shift 24 to 36 points because residual ties
  are tight there; `frc99` is the site the pre-change test used.

## Version pins

Moved: `packages/core/algorithms/spr.ts` (`SPR_VERSION`), `packages/spr/softCredit.test.ts:103`.

Left, judged site by site: `opr.ts`/`opr.test.ts` (OPR's own version); `spr.ts:201` (historical
paragraph naming opr/epa versions); `sigmaMetric.ts:12` (dated citation of the measured baseline);
`publish.test.ts` (6 version-agnostic fixture strings); `scripts/localPricingFixture.test.ts` (4
sites, none feed the `SPR_VERSION` refusal check, which reads `spr.version` dynamically; 12/12
pass untouched); `scripts/priceFrozenEventRow.test.ts:374` (schema-validity fixture, 26/26 pass);
`AlgorithmSelect.tsx:25` (doc comment whose example already reads `5.0.0+baseline`);
`liveMetricSidecar.test.ts:56` (untracked, owned by a concurrent session).

## Methodology copy

`grep -i -E "similar rating|for its rating|of its caliber|comparably rated|rarity|tier"` over
`apps/web/src/components/methodology/*Content.ts`: no matches. `sprContent.ts` mentions Sigma on
lines 5-6, 35, 70 and 77, all describing Sigma itself and the match band, neither of which changed.
No edit made.

## Gate

- `npx vitest run` from the repo root: 5537 passed, 3 failed, 1 skipped. `tsc --noEmit` clean.
- The 3 failures are all in `apps/worker/test/scheduled.sidecar.test.ts`, an UNTRACKED file that
  belongs to a concurrent session (the per-event team artifact / live metric sidecar work, with
  `apps/worker/src/scheduled.ts` and friends mid-edit and uncommitted during this run). It references
  `spr.version` only dynamically. This task touched no `apps/worker` file. Not fixed here.
- Orchestrator re-verified: three commits present with the expected file lists,
  `sigmaMetric.test.ts` + `softCredit.test.ts` 21/21, measurement table reproduced.

## Remaining (orchestrator, after Jacob confirms)

PLAN.md "Orchestrator steps": publish:seasons under spr@5.0.0+baseline (detached PowerShell run),
commit the budget block, content-check the live 2026 teams file with `measureTiers.ts`, D1 seed,
confirm a Worker tick (no redeploy expected), verify:subset, old-generation cleanup on explicit
go-ahead, push (check `origin/main..main` first), live e2e.
