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
