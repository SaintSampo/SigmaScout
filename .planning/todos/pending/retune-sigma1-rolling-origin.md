---
id: retune-sigma1-rolling-origin
created: 2026-09-01
source: quick task 260901-trz (D-T1/D-T4/D-T5/D-T7) — the compute job the whole task exists to make runnable
resolves_phase:
priority: high
---

# Run the rolling-origin Sigma1 re-tune

## What changed, and why every promoted parameter is now stale

Quick task `260901-trz` reshaped Sigma1's parameter set and rebuilt the selection
machinery, but deliberately ran **no search**. The shipped
`data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json` therefore carries values that were
selected under the **retired absolute parameterization**, on a **fixed 2022–2024 tune
split**, with `covShrinkage` in the search space. All three of those premises are gone:

- **D-T1** made five hyperparameters dimensionless fractions of the season's own
  alliance-score variance. Their current values are the old absolute values divided by
  `SIGMA1_REFERENCE_SCORE_VARIANCE` — correct as a *reparameterization*, but they are the
  optimum for a scale-blind filter, not for a scale-relative one.
- **D-T2** merged two carry weights into one `carryPriorYearShare`, so the carry axis the
  search explores is a different axis.
- **D-T3** removed `covShrinkage`, `coldStartTeamTotalRel` and `fallbackScoreSd` from the
  searchable set, leaving **16** searchable keys.
- **D-T5** replaced the fixed tune/holdout split with rolling-origin selection.

Only `covShrinkage` (fixed at its documented 0.3) and `linkC` (0.5, re-selected under
D-Q2) are current. **Every other parameter in the shipped set is stale pending this job.**

## What "done" looks like

Six `tune-joint-{on,off}-origin{2024,2025,2026}.json` artifacts plus their
`-acceptance.json` siblings exist, each recording its origin, its selection seasons, the
D-T7 decision, `evaluationCount`, the threshold, and both standard errors. A promotion
happens **only** where the acceptance rule says so.

**A run where nothing clears the bar is a COMPLETED job, not a failed one.** D-T7's whole
point is that the bar is pre-committed; `keep-incumbent` exits 0 and is the correct
outcome to report. Do not widen the bar, do not re-run with a new seed until something
passes, and do not treat a non-zero number of `keep-incumbent` results as a problem to
fix.

## Measured cost, and the lean run shape

One candidate's replay is ~1 ms/match with `rpMonteCarloDraws: 0`:

| origin (scored) | selection seasons | matches | one candidate |
|---|---|---|---|
| 2024 | 2022–2023 | 31,030 | ~31 s |
| 2025 | 2022–2024 | 48,059 | ~48 s |
| 2026 | 2022–2025 | 65,936 | ~66 s |

A joint run at `--evals 60` plus coordinate descent over ~12 survivors is ~84 evaluations,
i.e. **~6.7 hours sequential** across three origins and D-T4's two arms — and a per-origin
screen would add ~4 hours more. Hence three deliberate choices, each with its reason:

1. **The screen runs ONCE, at the earliest origin's window (2022–2023).** This is a
   correctness argument, not a shortcut: survivor selection *is* hyperparameter selection,
   and 2022–2023 is strictly prior to 2024, 2025 **and** 2026, so one survivor set is
   leak-free for all three origins simultaneously. Three screens would cost three times as
   much for no additional discipline. ~41 min.
2. **`--evals 40` per origin, not 60.** The acceptance bar moves as `sqrt(2 ln N)`, so
   60 → 40 moves it from ~0.003488 to ~0.003310 — a 5% relaxation of the bar for a 33%
   compute saving. The runner prints this tradeoff.
3. **Six INDEPENDENT PROCESSES run concurrently.** `openCorpusReadOnly` permits concurrent
   readers, so wall clock collapses to the largest single run (**~70 min**) rather than
   ~5 hours. Use `--batch 4`, not the default 8: `runBoundedSeasons` accumulates every
   prediction for a whole batch across every selection season, which at batch 8 on the
   2026 origin is over half a million objects held per process.

## The commands

```bash
# 1. The screen — ONCE, at the earliest origin's selection window. ~41 min.
pnpm tune --stage screen --seasons 2022,2023 --values 5 --batch 4 \
  --out reports/sensitivity-screen-origin-earliest.json

# 2. The six joint runs — CONCURRENTLY, in six terminals (or six background jobs).
for origin in 2024 2025 2026; do
  for arm in off on; do
    pnpm tune --stage joint --origin $origin --adaptation $arm \
      --evals 40 --batch 4 \
      --survivors reports/sensitivity-screen-origin-earliest.json &
  done
done
wait
```

Each joint run writes `reports/tune-joint-{arm}-origin{origin}.json` (the winner, committed
to disk **before** any origin-season evaluation — D-T5 gate 4) and then
`reports/tune-joint-{arm}-origin{origin}-acceptance.json` (the D-T7 verdict).

**Do not pass `--seasons` alongside `--origin`** — the tuner throws, deliberately: two
sources of truth for one question.

## D-T4's two arms

Adaptation ships **only if its arm's winner clears the D-T7 bar out-of-sample**. D-T4
measured adaptation-on at **-0.0015 Brier on top of 16x process noise** (holdout
0.153558 → 0.152054), which establishes it is not merely a proxy for process noise — but
its winning sub-parameters were selected by looking at holdout, so that figure is an upper
bound, not an estimate. It re-earns its place here or it does not ship.

## The KNOWN STALE anchor this closes

`params.ts`'s `SIGMA1_COLD_START_CONSISTENCY_VARIANCE` has carried a "KNOWN STALE since
3.0.0" paragraph since quick task 260901-is2: 25 (an SD of 5) was tuned against the retired
estimator, which ran ~5x small in SD terms, so the cold-start seed is plausibly about an
**order of magnitude too small in variance terms** against the innovation-based R it seeds.

`searchSpace.ts`'s bound for `coldStartConsistencyVarianceRel` — `[4e-3, 0.5]` — was
widened **specifically so this re-tune can reach that region**; the retired absolute bound
could not. This job is that paragraph's named follow-up, and closing it means either moving
the parameter or recording that the search declined to.

## Promotion, afterwards

Promote only what the acceptance rule accepted, via `pnpm promote --from-version` (so the
shipped `linkC` and `covShrinkage` overrides survive the merge), and then file a **new**
republish todo.

Corrected 2026-09-03 (backlog review): this section used to point at
`.planning/todos/pending/regenerate-published-artifacts-post-trz.md`. That todo has since
been completed and moved to `.planning/todos/completed/`, so the pointer no longer resolves
— and it would be the wrong target anyway. A promotion here bumps `vpr` past the version
that republish covered, so it needs a republish of its own, not a re-run of that one.

Two consequences of the promotion also have to ride the same republish, and neither is
optional:

- `remeasure-baseline-fingerprint-post-trz` must run **after** the republish, not before —
  see that todo's own sequencing section.
- If the promotion adopts per-season parameter sets (Decision 2 in
  `rolling-origin-hyperparameter-tuning`), `CompareSliceSchema.seasonLabel`'s
  `z.enum(["tune","holdout"])` is a published-contract change that must land in the same
  republish.
