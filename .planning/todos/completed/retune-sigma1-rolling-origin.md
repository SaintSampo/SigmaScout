---
id: retune-sigma1-rolling-origin
created: 2026-09-01
source: quick task 260901-trz (D-T1/D-T4/D-T5/D-T7) — the compute job the whole task exists to make runnable
resolves_phase:
priority: high
---

# Run the rolling-origin Sigma1 re-tune

> **Selection windows CAPPED 2026-09-04 (user decision, gsd-fast).** `deriveSelectionSeasons`
> now keeps at most the **3 most recent** available prior seasons (`SELECTION_WINDOW_SEASONS`
> in `packages/harness/tune.ts`) — a max, not a minimum. Every "selection seasons" column in
> this file describes the old uncapped derivation; a future re-tune's windows are e.g.
> 2026 → 2023–2025 and 2027 → 2024–2026. Rationale (recency first, bounded cost second) is in
> the constant's doc comment. Like the two model-change notes below, this makes future runs
> NON-COMPARABLE to the ten verdicts — which were already non-comparable for those reasons.

> **Sigma1's MODEL changed 2026-09-04 (quick task 260904-6a1) — the ten verdicts below are
> NOT invalidated, but they are NON-COMPARABLE to any future re-tune run under this change.**
> Two model-correctness changes landed, both discovered investigating `2026bc2_sf14m1` (a genuine
> ~456-point alliance zeroed to 0 by `adjustPoints: -456`, no DQ flags): (1) `isAdjustZeroedAlliance`
> (`dq.ts`) drops an alliance's own observation when its score is 0 and its parsed `adjust` is
> negative, even with no DQ; (2) `adjust` is now PINNED at exactly 0 for every team, in every match —
> never folded, never carried, excluded from every cold-start/carried-share divisor.
> `SIGMA1_CODE_VERSION` bumped `7.0.0 -> 8.0.0` for exactly this reason; `data/algorithm-versions/`
> now holds `vpr@8.0.0+*`, re-promoted from the same `vpr@7.0.0+*` params (no parameter changed —
> only the model wrapped around them did).
>
> Any re-tune from here forward runs under the new model, by construction (there is no code path
> back to the retired one). The ten verdicts below, and every Brier/accuracy figure quoted in this
> file, were measured under the OLD model (adjust folded as a real per-team component, whole-alliance
> DQ the only ruling-zero exclusion) — they remain internally consistent on their own terms and
> nothing shipped under them is wrong, but they are NOT comparable to a future re-tune's numbers.
> **Do not diff the two model eras as though they were one series**, for the same reason the
> positional-cold-start note below already gives for its own boundary: a different model replays a
> genuinely different trajectory, and a Brier delta computed across the boundary would measure the
> model change, not the parameters.
>
> Expected direction: dropping ~13 previously-fitted ruling-zero observations (measured population,
> quick task 260904-6a1's SUMMARY) and removing every team's fitted `adjust` component (previously a
> real, nonzero per-team estimate for any team with fouls/adjustment history) both remove NOISE from
> the observation stream — a plausible source of a small precision gain in a future re-tune, not
> expected to reverse any of the ten verdicts' direction, but not measured here.

> **Cold start made positional 2026-09-04 (quick task 260904-cs1) — the ten verdicts below are
> NOT invalidated, but they are NON-COMPARABLE to any future re-tune run under this change.**
> `seasonBoundaryFor` no longer decides cold start by matching a module constant
> (`COLD_START_SEASON`, deleted) — it is now `index === 0` of the replay range, by construction.
>
> The ten verdicts recorded below remain internally consistent on their own terms: they were
> measured under cold-start-at-2022, the promoted `rolling-2026-09` parameters still match their
> own validation, and the published 2022-2026 figures are byte-identical under the positional
> default (D-2, pinned by `packages/harness/seasonBoundary.test.ts`'s equivalence test as of this
> task). Nothing shipped is wrong and nothing here needs re-running on the fix's account.
>
> But they ARE non-comparable to any future re-tune run under positional cold start. Such a run
> replays a genuinely different, warmer trajectory — origin 2022 now carries state from 2019 and
> 2020 (backfilled by `extend-corpus-2019-2020`) instead of starting from the rookie baseline — so
> its Brier scores and accepted deltas measure a different thing than the ten below. **Do not diff
> the two sets as though they were one series, and do not carry an old incumbent number forward
> into a new comparison table.**
>
> Expected direction, so a future reader is not surprised: 2022 and 2023 currently predict with no
> or little carried history, so a warm start should move them — 2022's accepted delta above was
> only +0.00125 Brier (adaptation on), a modest edge measured precisely rather than a large one.
> A genuinely warmer 2022 origin is a plausible source of a bigger, more convincing win than the
> one that just cleared. See `.planning/todos/completed/cold-start-season-discards-backfill-carry.md`
> for what was and was not done. *(That prediction was then tested by the 2026-09-04 re-run at the
> bottom of this file: the warm-start 2022 win was +0.000897 — same modest-but-precise character,
> not the bigger win speculated here.)*

> **UNBLOCKED 2026-09-03 (later the same day).** The corpus extension ran, all seven seasons have
> registered breakdown and RP modules, and `score.ts`'s 2022-2026 guard — which made every scoring
> path throw on 2019/2020 — is gone. This job is runnable.
>
> **The origin list GREW, twice.** It is now **2022, 2023, 2024, 2025, 2026 and 2027** — six, not
> the three every cost table below assumes. 2022 and 2023 became origins when 2019/2020 backfilled
> in; 2027 is D-3's live-season origin. Re-derive the cost before running: the numbers below are
> correct per-origin but cover half the job.
>
> **Superseded note (kept for the record) — 2026-09-03 earlier:** The user decided to add 2019
> and 2020 to the corpus before this job, so tuning happens once on the final corpus rather
> than now and again afterwards. That changes the selection seasons for EVERY origin below and
> adds 2022 and 2023 as new origins. Do not run this until that job lands.
>
> **Run shape changed 2026-09-03 — read before running anything.**
> `rolling-origin-hyperparameter-tuning`'s D-3 was answered and then revised the same day.
> The steady-state rule is now *the live season runs its own origin set*, which **adds a
> fourth origin, 2027, selecting on 2022–2026**. Everything below describes the three-origin
> shape (2024/2025/2026) and is correct for those three; it is simply no longer the whole
> job. The 2027 origin differs in kind from the other three: 2027 has not been played, so it
> has **no origin-season evaluation step and no D-T7 acceptance verdict** — it produces a
> winner that is promoted ungated and scored retroactively when the season ends. Do not try
> to run `acceptance.ts` against it. See D-3 in that todo for the full reasoning and the
> tradeoff that was accepted.

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

---

# RESULTS — the re-tune RAN, 2026-09-03/04. All ten verdicts below.

`reports/` is gitignored, so this section is the ONLY durable record of a multi-hour job. The
acceptance JSONs on disk can be deleted or overwritten; these numbers cannot be regenerated without
re-running everything.

## Run shape actually used (differs from the plan above — that text predates the corpus backfill)

- **Screen:** ONCE, on **2019, 2020** (not 2022, 2023). The earliest origin is now 2022, so its
  window is 2019–2020, which is strictly prior to every origin including 2027 — the one-screen
  leak-free argument holds unchanged and got cheaper (18,749 quals vs 31,030).
  Wrote `reports/sensitivity-screen-origin-earliest.json`, **9/15 survive**.
- **Operator override, recorded in that file's own `manualOverrides` block:** `carryPriorYearShare`
  and `carryMeanReversion` were FORCED into the survivor set. The screen window contains exactly one
  season boundary (2019 to 2020) and it has no year-before, so `sigma1CarryNormalizedRating` takes
  its single-season branch and the two-season blend NEVER executes — `carryPriorYearShare` measured
  a range of exactly `0.000e+0`, meaning UNREACHABLE, not unimportant. The origins these serve
  (2024–2026) carry four to six priors. Survivors: **10**.
  *(The same blindness existed in the original `--seasons 2022,2023` plan, where 2022 was that
  corpus's cold start. It was simply never visible.)*
- **Joint:** 5 origins x 2 adaptation arms = **10 runs**, `--evals 40 --batch 4`, in two waves
  grouped by window size (memory: ~1.6 GB/process at 2 seasons, ~2.6 GB at 6).
- **2027 deliberately NOT run as an origin.** `evaluateOriginSeason` replays selection-plus-origin
  and compares candidate vs incumbent ON the origin season; 2027 has no matches, so D-T7 would
  decide on zero evaluations. That is D-3's ungated preseason case, and `--seasons` mode already
  does exactly that job. It remains a separate run.

## The ten verdicts (all against incumbent `7.0.0+tuned-2026-08`)

| origin | arm | verdict | delta Brier | bar | delta SE | delta/SE |
|---|---|---|---|---|---|---|
| 2022 | off | **ACCEPTED** | +0.000969 | 0.000676 | 0.000236 | **+4.1** |
| 2022 | on | **ACCEPTED** | +0.001247 | 0.000684 | 0.000239 | **+5.2** |
| 2023 | off | keep-incumbent | -0.009361 | 0.002891 | 0.001010 | -9.3 |
| 2023 | on | keep-incumbent | -0.005697 | 0.002351 | 0.000821 | -6.9 |
| 2024 | off | keep-incumbent | -0.016634 | 0.002862 | 0.001000 | -16.6 |
| 2024 | on | keep-incumbent | -0.018291 | 0.002926 | 0.001025 | -17.8 |
| 2025 | off | keep-incumbent | -0.002660 | 0.001724 | 0.000602 | -4.4 |
| 2025 | on | keep-incumbent | -0.002553 | 0.001661 | 0.000581 | -4.4 |
| 2026 | off | keep-incumbent | -0.003862 | 0.001638 | 0.000572 | -6.7 |
| 2026 | on | **ACCEPTED** | +0.002218 | 0.001549 | 0.000542 | **+4.1** |

**Three acceptances: 2022 (both arms) and 2026 (adaptation ON only).**

## D-T4 — adaptation RE-EARNED its place, out-of-sample

2026's arms differ by **0.0061 Brier** on an identical search: off misses at -6.7 SE, on clears at
+4.1 SE. D-T4 pre-committed that adaptation ships only if ITS arm clears out-of-sample. It did, on
the most recent complete season — the one whose set would serve live play. The prior -0.0015 figure
was an upper bound (its sub-parameters were picked by looking at holdout); this is the honest
re-earning.

On-minus-off across all five origins: `2022 +0.00028, 2023 +0.00366, 2024 -0.00166, 2025 +0.00011,
2026 +0.00608` — better in **4 of 5**.

## 2024 is a structurally different season, not a noisy one

Diagnosis raised by the user (2024's amplification mechanic made outcomes coordination-dependent
rather than strength-dependent) and supported by the numbers:

- Its miss is the largest (-16.6/-17.8 SE) but its delta SE (0.0010) is IDENTICAL to 2023's, and its
  *level* SE is the LOWEST of all origins. A large, tightly-measured miss is systematic BIAS, not
  variance — a noisy season would give a wide error bar, not a narrow one.
- Its incumbent Brier (0.1702) is the worst of any origin **despite 2024 being inside the
  incumbent's own tune set** (`provenance.tuneSeasons = [2022,2023,2024]`). Training on it does not
  rescue it — that is irreducible difficulty in the season.
- Both arms miss symmetrically, so it is not an adaptation artifact. The one arm where adaptation
  LOSES is 2024 — expected if outcomes are coordination-driven, since adaptation fits per-team
  innovation statistics.

This argues FOR per-season sets rather than against them: a season unlike its predecessors genuinely
wants different parameters, and the scheme correctly refuses to force one vector across a rule change.

## Honesty note on the 2022 win

It cleared on an unusually TIGHT error bar (delta SE 0.000236, four times tighter than any other
origin), not on a large improvement. +0.00097 / +0.00125 Brier is modest in absolute terms. It is a
genuine 4-5 SE result against a pre-committed bar — a small edge measured precisely, not a big one.

## The promotable map, per D-2's `paramSetsBySeason`

| season | set |
|---|---|
| 2022 | NEW — adaptation ON (better of the two accepted arms) |
| 2023, 2024, 2025 | incumbent (nothing cleared) |
| 2026 | NEW — adaptation ON |

## NEXT — and it is blocked on unbuilt work

`promote.ts` writes ONE parameter set per version file. This result needs **two** new sets in a
per-season map. That is exactly the "biggest single cost" `rolling-origin-hyperparameter-tuning`'s
D-2 named and answered in principle — one version carrying `paramSetsBySeason` plus a single
prediction-stream digest over the full replay — but the code does not exist yet. Promotion cannot
proceed until it does.

*(Superseded 2026-09-04: quick task 260904-100 built `paramSetsBySeason`, and the 2026-09-03
verdicts above were promoted as `rolling-2026-09`. The section below is the NEXT run.)*

---

# RESULTS — the re-tune RAN AGAIN, 2026-09-04, under the NEW model. Ten fresh verdicts.

This is the run every note above said would be needed: `SIGMA1_CODE_VERSION 8.0.0` (adjust
pinned at 0, `isAdjustZeroedAlliance`), positional cold start, `SELECTION_WINDOW_SEASONS = 3`
capped windows. NOT comparable to the ten 2026-09-03 verdicts above, exactly as those notes
say — different model, different windows, different incumbent.

## Run shape

- **Screen:** ONCE on 2019, 2020 (`reports/sensitivity-screen-2026-09-04.json`), `--values 5
  --batch 4`. **9/15 survive.** `carryPriorYearShare` measured range exactly `0.000e+0` —
  UNREACHABLE again (the window's one boundary has no prior-prior season, so the two-season
  blend never executes) — and was operator-FORCED into the survivor set, recorded in the
  file's own `manualOverrides` block. `carryMeanReversion` survived on its own this time
  (range 5.091e-3). **Survivors: 10.**
- **Joint:** 5 origins x 2 arms = 10 runs, `--evals 40 --batch 4` (60 candidates each after
  coordinate descent), two waves (2022/2023/2024 then 2025/2026).
- **Incumbent: the LIVE `vpr@8.0.0+rolling-2026-09` per-season set, via the new `--incumbent`
  flag** (commit c1202451, added for this run). D-T7's "beats what SHIPS" is literal this
  time: for 2022 and 2026 the bar is the set that already beat `tuned-2026-08` last run.
  The frozen `INCUMBENT_VERSION_PATH` constant was not touched.
- 2027 deliberately not run (no matches, no D-T7 verdict possible) — same reasoning as the
  2026-09-03 run; the ungated preseason `--seasons` job remains separate.

## The ten verdicts (all against LIVE incumbent `8.0.0+rolling-2026-09`, N = 60)

| origin | arm | verdict | delta Brier | bar | delta SE | delta/SE |
|---|---|---|---|---|---|---|
| 2022 | off | **ACCEPTED** | +0.000897 | 0.000544 | 0.000190 | **+4.7** |
| 2022 | on  | **ACCEPTED** | +0.000628 | 0.000484 | 0.000169 | **+3.7** |
| 2023 | off | keep-incumbent | -0.005297 | 0.002222 | 0.000777 | -6.8 |
| 2023 | on  | keep-incumbent | -0.005076 | 0.002212 | 0.000773 | -6.6 |
| 2024 | off | keep-incumbent | -0.005948 | 0.001458 | 0.000510 | -11.7 |
| 2024 | on  | keep-incumbent | -0.004866 | 0.001306 | 0.000456 | -10.7 |
| 2025 | off | keep-incumbent | -0.003218 | 0.001392 | 0.000487 | -6.6 |
| 2025 | on  | keep-incumbent | -0.003269 | 0.001381 | 0.000482 | -6.8 |
| 2026 | off | keep-incumbent | -0.008616 | 0.001634 | 0.000571 | -15.1 |
| 2026 | on  | keep-incumbent | -0.005695 | 0.001396 | 0.000488 | -11.7 |

**One promotable result: origin 2022, both arms accepted; the off arm's larger delta wins
(+0.000897 > +0.000628), so 2022 promotes adaptation OFF.** Every other origin keeps its
live set — an expected and healthy outcome: the incumbent this time was the strongest set
ever shipped (2023-2025 carry the hardened tuned-2026-08 values; 2026 carries last run's
adaptation-ON winner), not a stale one.

Notes in the same spirit as the first run's honesty notes:
- 2024 misses again, hardest relative to its SE (-11.7) — the structural 2024 diagnosis
  above stands under the new model.
- 2026-off vs 2026-on differ by +0.0029 in on's favor on identical searches — adaptation's
  out-of-sample value on 2026 re-observed under the new model, though neither arm clears
  the live 2026 incumbent (which IS last run's adaptation-on winner).
- The 2022 win is again a small edge measured precisely (delta SE 0.000190, the tightest of
  all ten), clearing a 4.7 SE bar — same character as last run's 2022 result.

## Promotion — DONE, same day

`data/algorithm-versions/vpr@8.0.0+rolling-2026-09b.json` (digest `cf54fc21ef18d8f7...`,
slice season 2022 / 3 events / 265 matches):
`--per-season "2022=search:reports/tune-joint-off-origin2022.json"` +
`--per-season "2019,2020,2023-2026=version:.../vpr@8.0.0+rolling-2026-09.json"`.
`promotedVersionPath.ts` re-pinned `rolling-2026-09` -> `rolling-2026-09b`; the CI digest
slice fixture was refreshed; `selectionProvenance.test.ts`'s independent literal and
`baselineFingerprint.test.ts`'s exact-set census (3 -> 4 files) updated. Harness suite
878/878 green at promotion time.

This closes the job: verdicts recorded, the one accepted result promoted, everything else
keep-incumbent by a pre-committed bar. The republish rides
`republish-after-adjust-model-change` (Item 4's batching rule), same session.

---

# RESULTS — the re-tune RAN A THIRD TIME, 2026-09-05, ACCURACY-PRIMARY. All ten keep-incumbent.

First full re-tune scored under the accuracy-primary objective (260904-oiu: winner
accuracy is the gate, Brier a guardrail veto) — the incumbent `rolling-2026-09b` was
promoted 2026-09-04 under the old objective, ~4 hours before the flip landed, so this run
answers whether that promotion survives the new scoring. It does, everywhere.

## Run shape

- **Screen:** ONCE on 2019, 2020 (`reports/sensitivity-screen-260905.json`), `--values 5
  --batch 4`. **9/15 survive** — same nine as the 2026-09-04 run. `carryPriorYearShare`
  measured range exactly `0.000e+0` (unreachable on this window — known, expected) and was
  operator-FORCED into the survivor set, recorded in the artifact's `operatorOverride`
  field. **Survivors: 10.** First screen over the post-exclusion 15-knob space
  (`elimObservationNoiseMultiplier` excluded since 89b2cf06, 2026-09-05 negative result).
- **Joint:** 5 origins x 2 arms = 10 runs, `--evals 40 --batch 4` (59-60 candidates each),
  two waves (2022/2023/2024 then 2025/2026), all backgrounded, unattended
  (`sigmascout-retune-republish` skill, pre-committed decisions throughout).
- **Incumbent: the LIVE `vpr@8.0.0+rolling-2026-09b` per-season set via `--incumbent`.**
- 2027 deliberately not run (no matches, no D-T7 verdict possible), same as prior runs.
- Artifacts: `reports/tune-joint-{off,on}-origin{2022..2026}-260905{,-acceptance}.json`,
  logs `reports/retune-log-*-260905.txt`, report `reports/retune-260905-run-report.md`
  (all untracked, like every prior run's).

## The ten verdicts (all against LIVE incumbent `8.0.0+rolling-2026-09b`)

Columns differ from the prior tables by design: the acceptance gate is now the winner's
out-of-sample ACCURACY margin vs the noise bar at N evaluations (260904-oiu); Brier delta
is reported as the guardrail. Cross-era comparison to the older Brier-gated tables is
invalid (different objective AND different incumbent) — the only valid comparison is the
one `--incumbent` already made.

| origin | arm | verdict | delta accuracy | bar (N) | delta acc SE | delta Brier (guardrail) |
|---|---|---|---|---|---|---|
| 2022 | off | keep-incumbent | +0.001040 | 0.004575 (59) | 0.001602 | +0.032757 (worse) |
| 2022 | on  | keep-incumbent | -0.000347 | 0.004593 (60) | 0.001605 | +0.034847 (worse) |
| 2023 | off | keep-incumbent | -0.009353 | 0.005662 (60) | 0.001979 | +0.027476 (worse) |
| 2023 | on  | keep-incumbent | -0.005203 | 0.004748 (60) | 0.001659 | +0.002193 (worse) |
| 2024 | off | keep-incumbent | -0.000119 | 0.004118 (60) | 0.001439 | -0.000112 |
| 2024 | on  | keep-incumbent | -0.000656 | 0.005037 (60) | 0.001760 | +0.000912 (worse) |
| 2025 | off | keep-incumbent | -0.003165 | 0.003623 (60) | 0.001266 | +0.002061 (worse) |
| 2025 | on  | keep-incumbent | -0.003222 | 0.004750 (60) | 0.001660 | +0.002842 (worse) |
| 2026 | off | keep-incumbent | -0.002023 | 0.005536 (60) | 0.001935 | +0.005452 (worse) |
| 2026 | on  | keep-incumbent | -0.000437 | 0.004589 (60) | 0.001604 | +0.003063 (worse) |

**Nothing cleared the bar. No promotion, no re-pin, no republish.** Live pin stays
`vpr@8.0.0+rolling-2026-09b.json`; `SIGMA1_CODE_VERSION` stays 8.0.0; publish budget
untouched.

Honesty notes, same spirit as the prior runs:

- The closest challenger (2022/off, +0.10pt vs a 0.46pt bar) carried a +0.033 WORSE Brier
  — under accuracy-primary the searches happily trade calibration for accuracy on the
  selection window, and out-of-sample they gained no accuracy for it. The guardrail would
  have vetoed it even at the bar.
- This is the strongest evidence yet that the incumbent is at a genuine optimum for this
  search space: promoted under Brier-primary, it survives a full 10-run accuracy-primary
  challenge with 8/10 challengers strictly worse on BOTH metrics.
- The two windows the stopped 2026-09-05 elim-R run never reached (2025/2026 origins) are
  now measured under the new objective: keep-incumbent, all four arms.
- STILL OUTSTANDING, not resolved by this run (no republish was warranted): the live
  Worker re-seed for `STATE_SNAPSHOT_SHAPE_VERSION` 7 -> 8 (260904-v9n) — needs a fresh
  publish run before the Worker loads state again.

---

# RESULTS — Stage 2 carryVarianceFactor tune, 2026-09-05. All ten keep-incumbent; 2025/on missed by 0.005pt.

The first search over the 16-knob space including `carryVarianceFactor` (quick task
260905-kjb — the one-parameter boundary-variance retention knob motivated by the EPA/VPR
disagreement autopsy and the 260905-jyf Stage 1 experiment). Same runbook as the two
prior accuracy-primary runs: fresh screen (10/16 survive + carryPriorYearShare force-in =
11), 5 origins x 2 arms at `--evals 40 --batch 4`, acceptance vs the LIVE
`vpr@8.0.0+rolling-2026-09b`.

Screen note: `carryVarianceFactor` survived with the second-largest range of all 16
knobs (1.038e-2), OAT optimum at the default 1 — reachable via the 2019->2020 boundary.

## The ten verdicts (accuracy-primary, vs rolling-2026-09b)

| origin | arm | verdict | delta accuracy | bar | delta Brier | winner carryVarianceFactor |
|---|---|---|---|---|---|---|
| 2022 | off | keep-incumbent | -0.002426 | 0.007780 | +0.000139 | 0.520 |
| 2022 | on  | keep-incumbent | -0.006585 | 0.008101 | +0.002394 | 0.520 |
| 2023 | off | keep-incumbent | -0.007371 | 0.007205 | +0.008495 | 0.520 |
| 2023 | on  | keep-incumbent | -0.004522 | 0.006885 | +0.000468 | 0.520 |
| 2024 | off | keep-incumbent | -0.005607 | 0.005383 | +0.004927 | 0.452 |
| 2024 | on  | keep-incumbent | -0.005548 | 0.005101 | +0.004087 | 0.452 |
| 2025 | off | keep-incumbent | -0.003391 | 0.003954 | +0.003034 | 0.332 |
| 2025 | on  | keep-incumbent | **+0.004070** | 0.004124 | **-0.002078** | 0.845 |
| 2026 | off | keep-incumbent | +0.000656 | 0.004147 | +0.000880 | 0.520 |
| 2026 | on  | keep-incumbent | +0.001476 | 0.004038 | -0.000933 | **1.000** |

**No promotion, no SIGMA1_CODE_VERSION bump (the 260905-kjb non-bump record stands), no
republish. The Worker shape-8 re-seed remains pending.**

Honesty notes:

- **2025/on is the strongest challenger result ever posted against rolling-2026-09b
  under the accuracy-primary objective**: +0.41pt out-of-sample accuracy WITH better
  Brier at factor 0.845, missing the N=62 bar by 0.005pt — in exactly the season the
  disagreement autopsy predicted (2025 = EPA's largest early-info edge). A miss is a
  miss; nothing ships. But this is signal, not scatter.
- 2026/on's search converged on factor exactly 1.0 unaided — the knob buys nothing there.
- 2022-2024 lost out-of-sample at moderate factors (2024 worst, the prior-trust-hostile
  season that also burns EPA), while nine of ten searches independently chose sub-1
  factors in-sample: uniform prior-trust consistently overfits the selection window
  everywhere except 2025.
- DISPOSITION: `carryVarianceFactor` STAYS SEARCHABLE — unlike elim-R (excluded after
  scattering directionless), this knob shows a consistent direction and a near-accept.
  The Stage 2 question is nonetheless CLOSED AS MEASURED under the current protocol:
  a uniform boundary variance factor does not clear the D-T7 bar on any origin. If the
  early-season gap is reattacked, the next formulation should be sharper than uniform
  (e.g. evidence-weighted per team), not a re-run of this one.
- Artifacts: `reports/tune-joint-*-260905s2*.json`, `reports/retune-log-*-260905s2.txt`,
  `reports/sensitivity-screen-260905-s2.json`, report `reports/retune-260905-s2-run-report.md`
  (untracked, like every prior run's).

---

# RESULTS — Stage 3 carryEvidenceRate tune, 2026-09-05. All ten keep-incumbent; the strongest challenger PROFILE yet.

First search over the 17-knob space including `carryEvidenceRate` (quick task 260905-o48
— evidence-weighted boundary variance retention, `coldStartVariance * exp(-rate * n)` over
the team's outgoing-season match count, composing multiplicatively with Stage 2's
`carryVarianceFactor`). Same runbook: fresh screen (11/17 survive + carryPriorYearShare
force-in = 12), 5 origins x 2 arms, `--evals 40 --batch 4`, acceptance vs the LIVE
`vpr@8.0.0+rolling-2026-09b`. Screen: `carryEvidenceRate` survived at range 9.006e-3
(third-largest), OAT optimum at the default 0.

## The ten verdicts (accuracy-primary, vs rolling-2026-09b)

| origin | arm | verdict | delta accuracy | bar | delta Brier | winner rate | winner factor |
|---|---|---|---|---|---|---|---|
| 2022 | off | keep-incumbent | +0.002426 | 0.006824 | +0.005982 | 0.00250 | 0.930 |
| 2022 | on  | keep-incumbent | +0.001594 | 0.006718 | +0.005951 | 0.00250 | 0.930 |
| 2023 | off | keep-incumbent | -0.003469 | 0.005261 | -0.000832 (better) | 0.02885 | 0.085 |
| 2023 | on  | keep-incumbent | -0.002292 | 0.004370 | -0.001206 (better) | 0.02885 | 0.085 |
| 2024 | off | keep-incumbent | -0.005011 | 0.004975 | +0.006873 | 0.02585 | 0.179 |
| 2024 | on  | keep-incumbent | -0.010857 | 0.005459 | +0.007462 | 0.02585 | 0.179 |
| 2025 | off | keep-incumbent | **+0.003787** | 0.004225 | **-0.001489 (better)** | 0.02585 | 0.179 |
| 2025 | on  | keep-incumbent | +0.003335 | 0.004127 | -0.001263 (better) | 0.02585 | 0.179 |
| 2026 | off | keep-incumbent | +0.001804 | 0.003588 | +0.001298 | 0.02585 | 0.179 |
| 2026 | on  | keep-incumbent | +0.002296 | 0.003551 | +0.000321 | 0.02585 | 0.179 |

**No promotion, no SIGMA1_CODE_VERSION bump, no republish. (The shape-8 D1 re-seed landed
separately the same day via the operational republish — see docs/publish-budget.md.)**

Honesty notes:

- **Seven of ten runs posted POSITIVE out-of-sample accuracy margins** — vs three in
  Stage 2 and three in the 2026-09-05 accuracy-primary re-tune. Both 2025 arms were
  positive WITH better Brier (2025/off reached 90% of its bar). This is the strongest
  challenger profile of the three carry-variance formulations.
- 2022 posted its first-ever positive pair (+0.24/+0.16pt) under the GENTLE shape
  (rate 0.0025, factor 0.93 — a ~50-match veteran retaining ~82% confidence).
- The negatives sit exactly where prior-trust should fail: 2024 (-0.50/-1.09pt, from an
  aggressive shape the 2020/2022/2023 selection window overfit to) and 2023 (small,
  with better Brier).
- **Cumulative picture across the day's three tunes: 30 verdicts, 0 promotions** — but
  the boundary-variance mechanism is consistently real and consistently positive on
  2022/2025/2026. The remaining question is ACCEPTANCE POLICY (the ~2 SE bar), not
  model formulation; the recorded next step, if the developer wants it, is a
  retroactive analysis of what a relaxed bar would have shipped across every recorded
  tune, so the noise-shipping risk is quantified before any policy change.
- DISPOSITION: both `carryVarianceFactor` and `carryEvidenceRate` STAY SEARCHABLE
  (consistent direction, repeated near-accepts — the opposite of elim-R's scatter).
- Artifacts: `reports/tune-joint-*-260905s3*.json`, `reports/retune-log-*-260905s3.txt`,
  `reports/sensitivity-screen-260905-s3.json`, `reports/retune-260905-s3-run-report.md`
  (untracked, like every prior run's).

---

# DECISION — Rule A adopted and FIRST SHIPPED, 2026-09-05 (same session as the three tunes above).

After the Stage 3 addendum above named acceptance policy as the open question, the
operator commissioned the retroactive analysis it proposed and then DECIDED. The
analysis (session scratchpad `baranalysis.cjs`, summarized here because scratchpads do
not persist): all 36 accuracy-primary verdicts on disk (retune-0905, elim-R v9n,
Stage 2 CVF, Stage 3 CER) rescored under five candidate rules.

| rule | ships | character |
|---|---|---|
| current D-T7 bar (winner's-curse corrected, ~3 SE) | 0/36 | nothing |
| A: accuracy-positive AND Brier-better | 3 origins | 2025 x2 (2.8/2.6 SE), 2026 x1 (1.1 SE) |
| B: accuracy > 1 SE, no guardrail | 6 | adds three Brier-WORSE ships incl. the closed-negative elim-R 2022 |
| C: > 1 SE AND Brier-better | 3 | identical to A on this data |
| D: any positive accuracy | 7 | adds pure noise (+0.10pt at 0.6 SE, Brier +0.033 worse) |

The clustering evidence that settled it: 2023/2024 went 0-for-16 accuracy-positive
across every formulation while 2025 went 3-for-6 — and every 2025 positive was ALSO
Brier-better, while every 2022 positive was Brier-worse (the noise signature). The
Brier guardrail was a perfect noise classifier on this data.

**DECIDED (operator, 2026-09-05): Rule A is the acceptance policy, and BOTH eligible
ships go out — 2025 AND 2026** (the operator chose the wider option over the
recommended 2025-only). Recorded consequences:

- `vpr@9.0.0+rolling-2026-09c` promoted (commit 75c01ac2): 2025 = Stage 2 on-arm winner
  (+0.0041 acc at 2.8 SE, -0.0021 Brier, carryVarianceFactor 0.845 — the FIRST promoted
  non-default carry knob); 2026 = Stage 2 on-arm winner (+0.0015 acc at 1.1 SE, -0.0009
  Brier, carry knobs at defaults — its delta is in the ten ordinary knobs). All other
  seasons carried from rolling-2026-09b unchanged.
- `SIGMA1_CODE_VERSION` 8.0.0 -> 9.0.0 — the reserved bump the three NOT-BUMPED entries
  fired on; all four 8.0.0 sets retired and re-promoted under 9.0.0; promote.ts gained
  the `8.`-shares-current-shape branch; full suite green (192 files / 3,524).
- Follow-up todos filed: `codify-rule-a-acceptance` (decideAcceptance still implements
  only the old bar — next tune would need hand-reading until this lands, and Rule A must
  run UNCHANGED, pre-committed against policy-tuning drift) and
  `retire-vpr-8-generation-r2` (the orphaned 8.0.0 R2 generation).
- HONESTY: both ships were keep-incumbent under the D-T7 bar. This is a deliberate,
  recorded loosening of the ship standard from "provably better" to "probably better
  with a calibration guardrail," accepted with eyes open on pattern-break risk (the
  2024 analysis in this file), chosen because per-season promotion + within-season
  Worker updates + manual re-tunes bound the blast radius of a wrong ship to one
  season's set until the next measurement.
