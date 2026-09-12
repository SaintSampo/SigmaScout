---
task_id: 260911-r7e
phase: quick-260911-r7e
plan: 01
subsystem: epa
type: quick
tags: [epa, statbotics-fidelity, measurement-artifact, negative-result, accuracy]
status: complete
requires:
  - epa@10.0.0+baseline (unchanged by this task)
  - data/corpus.sqlite
  - STATBOTICS_REFERENCE_FALLBACK (dated constants, 2026-09-04/07)
provides:
  - the current measured EPA-vs-Statbotics accuracy standing under 10.0.0
  - "--warmup on epaVsStatbotics.ts, and a gapped --seasons list"
  - a warm compare:epa-statbotics, so the methodology page stops understating 2022
affects:
  - scripts/epaVsStatbotics.ts
  - package.json
  - docs/models/epa-vs-statbotics.md
tech-stack:
  added: []
  patterns: [equality-pin-never-iterate, optional-key-keeps-artifact-byte-identical, controlled-a-b-same-scored-population]
decisions:
  - "No model change. epa.ts, every constant and epa.version are untouched."
  - "The 2022 deficit was a cold start in the COMPARISON SCRIPT, not a model defect"
  - "Offseason inclusion refuted as an accuracy cause, with a structural reason"
  - "Mechanism 1's queued 8-season component-map work is NOT continued"
  - "The --check tolerance baseline is left on its cold-arm values, deliberately"
metrics:
  duration: ~50m
  completed: 2026-09-11
actuals:
  tasks: 4
  commits: 3
---

# Quick Task 260911-r7e — Reproduce Statbotics EPA accuracy, cheaply

## Answer

**EPA already reproduces Statbotics' accuracy to within −0.11 to −0.49 pp (mean −0.26 pp). The
previously-reported 2.4-point 2022 deficit was an artifact of the measurement script, not the
model. No model change was made, and none is warranted by the remaining residual.**

| Season | Statbotics | ours (warm) | Δ | was (cold) |
|--------|------------:|------------:|-------:|-----------:|
| 2022 | 0.7815 | 0.7797 | **−0.18 pp** | −2.39 pp |
| 2023 | 0.7647 | 0.7636 | **−0.11 pp** | +0.18 pp |
| 2024 | 0.7627 | 0.7578 | **−0.49 pp** | −0.45 pp |
| 2025 | 0.7839 | 0.7802 | **−0.37 pp** | −0.24 pp |
| 2026 | 0.7978 | 0.7962 | **−0.16 pp** | −0.23 pp |

Brier trails in all five seasons (+0.0004 to +0.0048). EPA trails on accuracy in all five too —
2023's cold-arm lead and 2026's cold-arm Brier lead both disappear when measured warm, and that is
reported rather than the cold cells being quoted as wins.

## The defect

`epaVsStatbotics.ts` defaulted to `--seasons 2022-2026`. `replayEpaSeasonFinals` carries EPA state
forward season by season, so **every team cold-started in 2022**, while the Statbotics column it was
differenced against held its real 2019/2020 carry-in. The comparison was charging our model for a
cold start its opponent never paid, in the one season that was the first of the reported range.

`scoredCount` is identical between the cold and warm arms in all five seasons (14,603 / 16,290 /
16,958 / 17,815 / 18,337), so the A/B is controlled on carried state alone — the warm arm did not
win by scoring a different population.

**Production was never affected.** `publish:seasons` has always replayed
`--seasons 2016-2020,2022-2026`, so `v1/compare/{season}.json` and every team/event artifact were
already warm. The cold arm existed only in `compare:epa-statbotics`, which feeds
`v1/methodology/epa-vs-statbotics.json` — so the *published methodology page* has been understating
our own 2022 accuracy by ~2.2 pp against a correctly-warm Statbotics column.

## What landed

| # | commit | what |
|---|---|---|
| 1 | `75ab70bb` | `--seasons` accepts a gapped list (2016-2020,2022-2026); 8 tests |
| 2 | `ef6c651b` | `--warmup`: replay wide, report narrow |
| 3 | `54560831` | `compare:epa-statbotics` passes `--warmup 2016-2020`; the standing recorded |

Why two separate mechanisms were needed: the gapped list exists because
`componentMapForSeason` has no 2021 map, so a contiguous 2016-2026 range throws. `--warmup` exists
because widening `--seasons` made the per-team arm fetch `/v3/team_years` for 2016, which returned
HTTP 500 and **aborted the run after the replay had already finished** — the figures were computed
and thrown away. `--warmup` keeps replay scope and report scope apart so a warmup season costs no
Statbotics request.

`warmupSeasons` is optional on the report and the key is omitted entirely when no warmup is
requested, so the artifact `publishEpaComparison` reads is byte-identical on a no-warmup run.

## Refuted, reported as found

**Offseason inclusion does not move accuracy.** It was the leading hypothesis, on the strength of
the per-team agreement table (offseason-excluded moves OLS slope to 0.97-1.01, Pearson to 0.99+).
Measured: 0.7576 vs 0.7576 in 2022, no season moving more than 0.03 pp.

The reason is structural, which settles it rather than leaving it open: **offseason events are
post-championship**, so within a season they occur after every official match and cannot influence
a prediction made earlier in that season; and `aggregateScores` already excludes offseason matches
from *scoring* in both arms. The divergence is real for published season-end **values** and cannot
reach **predictions on official matches**.

## Deliberately not done

- **Mechanism 1 (per-season rated component maps), GAP in all nine seasons.** This was the queued
  plan — eight more seasons, one quick task each. 260911-pon measured the 2024 closure at
  **−0.036 accuracy points, a loss.** Against a total remaining deficit of 0.26 pp it cannot pay
  for itself.
- **Mechanism 8 (win-probability scale).** Winner accuracy is sign-of-margin only, so the
  probability scale cannot move it; the ablation's own `epa-winprob-*` arms return verdict
  `identical`.
- **No tuning, no sweep, no variant selection.** Both arms were named in the plan before running.
- No republish, no R2 write, no deploy, no network beyond the script's own cached Statbotics
  reference, no BPR/SPR contact, no sealed-holdout spend.

## The one named candidate for the residual, not chased

Our scorer and Statbotics' do not score the same population: `aggregateScores` excludes
surrogate-affected matches, and Statbotics' documented `matchPopulation` is "all qualification +
elimination matches." The counts show it — Statbotics reports 13,286 matches for 2016 against our
12,994, **+2.2%**. Whether those ~2% account for the residual 0.2-0.5 pp is unmeasured. It is a
measurement-comparability difference, not a model difference, which is why it is named with its
evidence instead of being chased by changing the model.

## Handed back

1. **Republish debt: `v1/methodology/epa-vs-statbotics.json` is stale** — it still carries the cold
   2022 figure. Fixing it is `pnpm compare:epa-statbotics` then `pnpm publish:epa-comparison`.
   This task did not republish.
2. **`data/baselines/epa-vs-statbotics-2026-09.json` holds COLD-arm tolerance bands**, so `--check`
   through the now-warm script can fail on the arm change alone. Not re-measured here on purpose —
   moving a tolerance gate is its own decision and must not ride along inside a measurement task.
3. **The ablation register's `offseason-population` entry still reads
   `unmeasurable-in-this-harness`** and can be narrowed to "measured against accuracy, no effect."
   Not edited, because editing `scripts/measureEpaDeviations.ts` without regenerating
   `data/diagnostics/epa-deviation-ablation.json` would leave the committed JSON stale against its
   own generator, and regenerating it is a long run.
4. **`docs/models/epa-statbotics-gap.md`'s 35 GAP cells are unchanged.** This task closed none of
   them and deliberately did not renumber or re-verdict anything there.

## Self-Check: PASSED

- commits `75ab70bb`, `ef6c651b`, `54560831` — all present in `git log`
- `npx vitest run scripts/` — 18 files, 370 tests, all passing
- `npx tsc --noEmit` — clean for every file this task touched (the only errors are
  `scripts/deleteRetiredAlgorithmObjects.{ts,test.ts}`, a CONCURRENT session's uncommitted
  `includePresim` work, untouched and unstaged here)
- `git diff HEAD -- packages/core/algorithms/` — empty; `epa.version` is still `10.0.0+baseline`
- every commit staged by explicit pathspec; no foreign working-tree edit absorbed
- both arms' reports on disk in the session scratchpad; the warm report records
  `warmupSeasons: [2016,2017,2018,2019,2020]`
