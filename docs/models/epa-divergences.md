# EPA divergences from Statbotics (D-13)

D-13 (`.planning/phases/02-prediction-models-epa-sigma1/02-CONTEXT.md`): "Faithful core, our plumbing. Match the algorithm that matters ... using our own component extraction, skip Statbotics' per-season post-processing quirks ... Every deliberate divergence must be documented with its reasoning." This file is that record — every point at which SigmaScout's `epa.ts` reimplementation deliberately produces a different number than Statbotics' own `EPARating`/`EPA` classes would, and why.

Statbotics' source, verified verbatim against `github.com/avgupta456/statbotics` during this phase's research (`.planning/phases/02-prediction-models-epa-sigma1/02-RESEARCH.md`, fetched 2026-08-13): `backend/src/models/epa/{math,main,init,constants,breakdown}.py`, `backend/src/breakdown.py`.

**See `docs/models/epa-vs-statbotics.md` (quick task 260904-4aa, re-measured 260904-5px) for the measurement these divergences predict.** Every deliberate divergence listed below is a reason SigmaScout's EPA does not land at an OLS slope of exactly 1.0 against Statbotics' own per-team `epa.total_points`. §1 (elimination-match handling) is now CLOSED (see below) — the remaining ones are §3 (no per-season post-processing), the independently-derived component maps, and Pitfall EPA-1's expanding-window win-probability scale, plus the newly-measured offseason-population effect. That document is the committed, re-runnable per-team comparison (SC-2); its re-measured slope under `epa@5.0.0+baseline` (derived from `data/baselines/epa-vs-statbotics-2026-09.json`'s min-matches-arm band centres) is 0.80-0.96, offseason-inclusive — the offseason-excluded figure (0.95-1.01) is retained from the `epa@2.0.0+baseline` measurement and was not re-run under `5.0.0+baseline`.

## 1. Elimination matches — CLOSED as of `epa@5.0.0+baseline` (was D-08: full weight and counted, not discounted)

**CLOSED 2026-09-04 (quick task 260904-5px, D-05).** This project adopted BOTH halves of
Statbotics' elimination handling described below: the one-third outer EWMA weight on every
elimination-match observation (`EPA_ELIM_WEIGHT`, `packages/core/algorithms/epa.ts`), and the
per-team match counter that does not advance on an elimination match (`applyComponentUpdate`'s
`isElimination ? matchCount : matchCount + 1`). The developer's goal is for SigmaScout's EPA to
track the real Statbotics as closely as possible, and this divergence — the single largest
remaining rating-mechanics reason the measured slope sat below 1.0 — is now closed rather than
carried forward. What follows is the historical record of the divergence AS IT STOOD before this
adoption; it is kept, not deleted, because a future reader auditing what changed and why needs the
"before" half of the story.

**What this project measured, closing the "Why" paragraph's open question below:** the original
"Why" reasoning said the walk-forward harness itself would show whether adopting Statbotics'
discount was worth it, rather than assuming it a priori. That question is now answered by
measurement, not assumption — see `docs/models/epa-vs-statbotics.md`'s before/after table
(`epa@2.0.0+baseline` vs `epa@5.0.0+baseline`) for the per-season OLS slope, Pearson, mean absolute
difference, and win-probability accuracy/Brier movement the adoption produced, and whether
agreement with Statbotics got tighter or looser as a result.

**Statbotics:** `update_team` applies `ELIM_WEIGHT = 1/3` to every elimination-match observation's outer EWMA blend, and does **not** increment the team's match counter for elim matches — so an elim match both moves a team's rating less than a qual match and never advances the decaying learning-rate schedule (`percent_func`).

**This project (historical, pre-`5.0.0+baseline`):** `epa.ts`'s `update()`/`applyComponentUpdate()` called `twoStageEwma(..., percent, 1)` — `weight` was always `1`, never Statbotics' `1/3` discount — and `epaPercentFunc`'s match counter incremented on every match, elims included (`nextCounts.set(team, matchCount + 1)`, unconditional).

**Why (historical):** D-08 locked this as a deliberate divergence: elimination matches were learned from normally — predict, then update, treated as ordinary observations. Statbotics' own elim-discount reflects an assumption (elim matches are less representative of a team's "true" ability, perhaps due to strategic/alliance-selection effects) that this project did not adopt without evidence; the walk-forward harness itself (Brier score, sliced by `compLevelView` including `elimination`) was named as the mechanism that would show if this choice costs accuracy, rather than assuming Statbotics' discount is correct a priori — see the measurement note above for how that question was resolved.

**Effect (historical):** EPA's ratings moved faster per elim match, and the per-team learning-rate schedule decayed faster overall (since elims counted toward the same 12-match threshold `percent_func` uses to reach its floor of `0.2`) than the equivalent Statbotics computation over the identical match history.

## 2. Fouls — a per-team component, cross-attributed to the opponent (D-04)

**Statbotics:** multiplies a no-foul predicted score by a season-level foul rate — `red_score * (1 + foul_rate)` — a single scalar correction applied uniformly, not a per-team learned quantity.

**This project:** models `foulsCommitted` as its own per-team component (D-04), derived per `breakdown/*.ts`'s `parse()` from the **opposing** alliance's raw `foulPoints` field (`result[FOULS_COMMITTED_COMPONENT] = opponent.foulPoints`) — the points an alliance's own fouls cost the *other* side. `predict()` then adds each side's OWN offensive total to the OPPONENT's predicted `foulsCommitted`, never its own: `redScore = redOffensiveTotal + blueComponents[FOULS_COMMITTED_COMPONENT].mean`.

**Why:** D-04 explicitly requires a per-team fouls-committed component so a predicted total includes the opponent's expected foul contribution, rather than a single alliance-wide multiplier. This is also the component D-04 names as the identifiability check's weakest member (see `docs/models/sigma1-identifiability.md`) — fouls are sparse (30-65% of matches carry any recorded foul, per season) and the cross-alliance attribution adds a wrinkle a uniform scalar correction never has to handle.

**Correction recorded here (not a new divergence, a bug fix to this divergence's implementation):** commit `a0ec5d54` fixed `epa.ts`'s `predict()`, which had previously summed an alliance's OWN `foulsCommitted` mean into its OWN predicted score (backwards — crediting a team's fouls to itself, and omitting the opponent's fouls entirely) rather than the opposing alliance's, as D-04 actually specifies and as `sigma1/index.ts` had implemented correctly from the start (flagged as WINDOWS.md entry 3 by plan 02-04, now resolved). Every EPA number in this phase's `reports/full-v2/artifact.json` and this SUMMARY is from a run at or after that fix; no pre-fix EPA figure is cited anywhere in this phase's published output.

**Second correction recorded here (code review, phase 02, CR-01):** `predict()`'s D-04 cross-attribution above was correct, but `update()`'s D-05 fallback path (a match with no `score_breakdown`, `epa.ts`'s `fallbackObserved`) had a related bug in the SAME quantity: it fed a fraction of an alliance's own actual score into that alliance's own `foulsCommitted` slot, and never netted the opponent's predicted foul contribution out of the alliance's own score before splitting it across offensive components — silently reintroducing the exact cross-alliance misattribution D-04/`a0ec5d54` had already closed for `predict()`, just in the fallback update path instead. Fixed in `dc6b841b`: the fallback split now mirrors `predict()`'s own formula exactly (own score net of the opponent's predicted `foulsCommitted`, split across offensive components only), and `foulsCommitted` itself is carried forward unchanged rather than synthesized (genuinely unobservable without a real breakdown). Every EPA number in `reports/full-v2/artifact.json` as of this correction is from a run at or after `dc6b841b`; see `02-06-SUMMARY.md`'s regeneration note for whether this fix moved the head-to-head figures.

**Third correction recorded here (D-01, quick task 260904-5px) — this divergence NARROWED, not withdrawn:** the per-team, cross-attributed `foulsCommitted` component described above still exists exactly as written and still drives match prediction — `predict()` is untouched by this correction. What changed is the PUBLISHED per-team metric: `epa.ts`'s `teamMetrics()` now excludes `foulsCommitted` from `total`, matching Statbotics' own no-foul `epa.total_points` (verified live: `frc254`/2024's `total_points` 51.71 reconciles against auto + teleop + endgame alone, with no foul term). `foulsCommitted` is still published as its own per-team entry — only its membership in the summed `total` moved. This creates a deliberate ASYMMETRY worth stating plainly: `carrySeason()`'s cross-season carryover input stays the fouls-INCLUSIVE per-team sum (pinned by a dedicated test in `epa.test.ts`), so the published `total` and the quantity carried across a season boundary are now two different numbers for any team that has ever committed a foul. VPR's own `total` (`sigma1/index.ts`) is unaffected by this correction and keeps summing every component including its own `foulsCommitted` — D-01 and D-05 are scoped to EPA alone, since EPA exists specifically to match Statbotics and VPR does not.

## 3. No per-season post-processing (D-13)

**Statbotics:** `post_process_breakdown`/`post_process_attrib` apply per-year quirks on top of the raw EWMA — most notably a 2018-specific switch/scale sigmoid transform, plus per-year clamps on specific components.

**This project:** `epa.ts` runs no equivalent step. The raw two-stage EWMA output (`twoStageEwma`) is the team's component mean, full stop — no season-specific sigmoid, no clamp.

**Why:** D-13 explicitly scopes the "faithful core" match to the algorithm that matters (the EWMA update, the decaying learning rate, elim weighting policy, init/carryover scheme, the win-probability form) and explicitly excludes "Statbotics' per-season post-processing quirks." 2022-2026 (this project's covered seasons) postdate 2018, so the switch/scale sigmoid would not fire for any season this project scores regardless — but the general exclusion (no per-year clamps either) is stated as a standing policy, not a one-off skip.

## 4. Win-probability scale — expanding-window SD, never a season-batch constant (Pitfall EPA-1)

**Statbotics:** `predict_match` divides the score margin by `year_obj.score_sd`, computed once as a season-level constant.

**This project:** `epa.ts`'s `predict()` divides by `standardDeviation(state.allianceScoreStats, EPA_FALLBACK_SCORE_SD)` — an expanding-window Welford SD (`packages/core/scoring/expandingStats.ts`) folded match-by-match as `update()` runs, seeded at a season boundary from the prior season's final value (`epa.ts`'s `carrySeason`), falling back to a documented constant (`EPA_FALLBACK_SCORE_SD = 25`) before at least 2 observations exist.

**Why:** RESEARCH.md's Pitfall EPA-1: using Statbotics' season-FINAL `score_sd` as-is for a week-1 match's win-probability scale is outcome leakage — the prediction would be informed by variance data from matches not yet played, directly undermining the walk-forward guarantee (predict-before-update, PITFALLS.md Pitfall 3) this entire project's evaluation methodology depends on. The mathematical FORM of the logistic (natural-exp, algebraically identical to Statbotics' base-10 `k_func` form) is preserved faithfully per D-13; only the source of the scale denominator changes, and it changes because the season-batch version cannot be computed walk-forward at all — SC-2 itself ("EPA runs walk-forward at any point in a season") is not achievable with Statbotics' literal `score_sd`.

## 5. Variance — every component carries `±`, not a mean alone (this project's core value, contrasted with EPA's own docstring)

**Statbotics:** `EPARating`'s own docstring states outright: "does not handle covariance between variables" — `EPARating` carries a `mean` only, no variance, no spread.

**This project:** `epa.ts` reproduces this exactly — `EpaState.teamComponents` is a plain `Record<string, number>` per team, and `teamMetrics()` returns `{ value }` with no `spread` field (D-27's contract makes `spread` optional precisely so EPA can omit it honestly rather than fabricate one). Sigma1, the OTHER algorithm this phase ships, is the one that carries variance on every component (D-01/D-03/D-10) — the entire thesis of PROJECT.md's core value ("Sigma-family metrics are displayed as `X ± Y`").

**Why:** This is not a "fix" to Statbotics' EPA — it is a faithful reproduction of what Statbotics' EPA actually is (mean-only), stated explicitly here so a reader does not mistake EPA's lack of `±` for an oversight. The variance gap between EPA and Sigma1 is the entire point of building both: EPA is the honest, faithful, variance-free baseline; Sigma1 is the variance-carrying alternative this project is built to prove out.

## 6. Component extraction — this project's own per-season maps, not Statbotics' `all_keys[year]` grouping

**Statbotics:** groups TBA's raw `score_breakdown` fields into named "attributes" via a per-year `all_keys[year]` table (`backend/src/breakdown.py`), with its own grouping granularity choices (e.g. some 2024 auto/teleop note fields collapsed into fewer named attributes than TBA's raw field count).

**This project:** `packages/core/algorithms/breakdown/{2022..2026}.ts` are this project's own independently-built per-season component maps (D-02), verified directly against this project's own ingested corpus (`data/corpus.sqlite`) rather than ported from Statbotics' table. Granularity choices (e.g. 2024's `autoAmpNotePoints`/`autoSpeakerNotePoints`/`teleopAmpNotePoints`/`teleopSpeakerNotePoints`/`teleopSpeakerNoteAmplifiedPoints` kept as five separate components rather than collapsed) were made per-season during plan 02-01/02-02, using Statbotics' own grouping as a starting reference (D-01: "when in doubt about what to track or how to define it, match what Statbotics does") but re-derived independently against this project's own field inventory, per the clean-slate mandate (REBUILD_SPEC.md — no porting of pre-v3 values, and Statbotics' component tables are a different codebase entirely, not this project's own prior implementation, so this is a design choice rather than a provenance violation).

**Why:** D-02 requires per-season, data-driven component maps (never hardcoded branches); each season's map is built and Zod-validated against this project's own corpus (T-02-01/ASVS V5 — every read field asserted finite, unknown fields stripped rather than passed through). Divergent granularity from Statbotics' own table is an accepted consequence of independent re-derivation, not a defect — the harness's own accuracy measurement (this phase's `reports/full-v2/artifact.json`) is what would surface a granularity choice that costs accuracy, not a requirement to match Statbotics' table exactly.

---

*Phase: 02-prediction-models-epa-sigma1 (plan 02-06)*
*Statbotics source citations verified 2026-08-13 (`.planning/phases/02-prediction-models-epa-sigma1/02-RESEARCH.md`).*
