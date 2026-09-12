# Quick Task 260912-2uz: restore negative binomial to retest it - Context

**Gathered:** 2026-09-12
**Status:** Ready for planning

<domain>
## Task Boundary

Restore `"negative-binomial"` to the `MarginalFamily` union and to `marginals.ts`'s fit path
(both were DELETED, not disabled, in `2731bfab` by plan 09-06's D-06 collapse), then re-run
09-06's marginal-family attribution through the one published scorer.

Source todo: `.planning/todos/pending/restore-negative-binomial-to-retest-it.md`. Read it — it
carries the full framing and Jacob's recorded decision.

**Why this exists:** 09-06 measured negative-binomial marginals and got 3 improved / 3 regressed /
24 tied on the reporting slice, and 0/0/33 (all exact ties) on the selection slice, and reverted on
that evidence. The ties were a BUG, not a result: `clauseProbability` refitted combined moments as
a hardcoded Gaussian and discarded the declared family, so most cells were structurally incapable
of responding. Quick task 260911-w7k fixed that hardcode — but the family had already been deleted,
so nothing can exercise the fix. The recorded verdict "negative-binomial does not help" is
**unsupported, not disproven.**

</domain>

<decisions>
## Implementation Decisions — ALL LOCKED, DO NOT REVISIT

### D-1. Selection slice ONLY. The reporting slice is FORBIDDEN.

**Decided by Jacob, 2026-09-12, recorded in the todo.**

Run the comparison on the **selection slice (2016-2020 + 2022)** alone. The 2023-2026 reporting
slice stays unspent — it was already used once for this question on 2026-09-11 and a second use
would further weaken it as an honest check on anything later.

- **An agent may NOT spend the reporting slice for ANY reason, including a promising
  selection-slice result.** That prohibition is the entire point of the recorded decision.
- Do not pass `--seasons` any value containing 2023, 2024, 2025, or 2026 for this measurement.
- Do not report a 2023-2026 figure, even incidentally, even if one is cheap to produce.

**How the result must be read** (also Jacob's, also locked):
- A selection-slice result **cannot promote anything on its own**. That is what the slice split is
  for. It can do exactly two things:
- **No real gain on the reachable cells → close the question.** A family that cannot beat the
  incumbent on the data it was chosen against will not be rescued by the reporting slice.
- **A real gain → STOP and report the magnitude to Jacob.** Do not reach for 2023-2026 to confirm
  it. Re-spending the reporting slice is a fresh decision for Jacob to make with the
  selection-slice magnitude in hand.

### D-2. Same-scorer rule (09-06's D-11) binds, and it binds hardest here.

Both arms MUST pass through the **same imported `SigmaScoutLayer` class**, constructed the same way
the publisher constructs it — **two arguments** (`ruleModule`, `algorithmId`). The second argument
selects Sigma-vs-Swing band variance; omitting it is the exact defect that silently scored a
different band than the one published.

- **One replay per season, shared by both arms.** The arms multiply LAYERS, never replays. Build
  the season stream, run `WalkForwardSimulator` once, then fold the same `records` through one
  control layer and one NB layer per algorithm.
- Both arms must provably score the **identical observation set** — the layer's eligibility gates
  run before any family branch, so they cannot differ in which observations they see. Assert this
  in-flight (per-bonus observation counts equal across arms) rather than assuming it.
- Score both arms with the **same `brier`/`rate`/`meanPredicted` helpers** already in
  `measureRpCalibration.ts`. Never a second scoring implementation.

**Precedent this guards:** a scorer mismatch manufactured a phantom ~0.003 regression on this exact
question once already. See `project_scorer_mismatch_before_after` and the SAME-SCORER FIX block in
`scripts/measureRpCalibration.ts`'s header.

### D-3. How the NB arm is selected: a measurement-only seam, NOT a restored config object.

09-06 deliberately collapsed `RpLayerConfig` and everything that selected between branches. **Do
not restore it.** There must be no selectable surface in production.

Use this seam instead: `SigmaScoutLayer`'s constructor takes an `RpRuleModule`, and
`allianceBonusRpPmf` reads `ruleModule.thresholdVariables` and passes them straight to
`fitAllianceMarginals`. So the measurement script can build a **variant rule module** —

```ts
{ ...ruleModule, thresholdVariables: ruleModule.thresholdVariables.map(v => ({ ...v, marginalFamily: "negative-binomial" })) }
```

— and hand it to a second `SigmaScoutLayer`. Same class, same construction shape, zero production
surface, and it is exactly what D-02 anticipated ("a future family extends this union and the
variables that want it, rather than reintroducing a global switch").

Verify before relying on it that the season modules' `parse` / `evaluateBonuses` do not use `this`
(an object spread drops the prototype). If any does, clone differently rather than abandoning the
seam.

### D-4. NB is NOT closed under scaled addition — reach is math-forced and must be honoured.

This is the load-bearing structural fact of the whole task and it was MEASURED, not assumed.

`analyticPmf.ts`'s `familyForClauseSum` derives a clause's family from its terms' declarations and
**throws** on (a) mixed declarations within one clause and (b) any single declared family that is
not closed under scaled addition. Its `default:` arm is currently a `never` exhaustiveness check —
restoring a second union member makes that arm a **compile error first**, then a live runtime throw.

A sum of independent NB variables is NB only when every `p` matches, and `X / divisor` is not even
integer-supported. So negative binomial genuinely belongs in that throwing arm. **Do not invent a
closure. Do not add a silent Gaussian fallback for NB sums** — that would reintroduce precisely the
hardcode 260911-w7k removed, and would make this whole re-test meaningless a second time.

**Therefore: declare NB only on variables whose EVERY clause is a single unscaled term** (`divisor`
absent or 1), plus `nestedSameVariable` variables (those route through interval enumeration, which
calls `probAtLeast` on the fitted marginal directly and honours the family). A variable appearing in
ANY multi-term or divisor-bearing clause must stay `"gaussian"` — including when it also appears in
a single-term clause elsewhere, because a MIXED clause throws on the `declared.size !== 1` check.

**Measured eligibility on the selection slice** (verified against HEAD by running the rule modules,
2026-09-12 — re-verify rather than trusting this table if the season modules have changed):

| Season | Eligible variables | Poisoned variables |
|---|---|---|
| 2016 | `position1crossings`..`position5crossings`, `attackedTowerEndStrength` (6/8) | `teleopChallengePoints`, `teleopScalePoints` |
| 2017 | none (0/4) | `autoFuelPoints`, `teleopFuelPoints`, `autoRotorPoints`, `teleopRotorPoints` |
| 2018 | `autoRunPoints`, `autoSwitchOwnershipSec`, `endgamePoints` (3/3) | none |
| 2019 | `habClimbPoints` (1/1) | none |
| 2020 | `endgamePoints` (1/1) | none |
| 2022 | `matchCargoTotal`, `autoCargoTotal`, `endgamePoints` (3/3) | none |

**Resulting per-bonus reach — 7 of 11 bonuses, i.e. 21 of 33 cells:**

| Season | Bonus | Under NB | Why |
|---|---|---|---|
| 2016 | `breach` | **CAN MOVE** | `countOfIndicators`, all indicators single unscaled terms |
| 2016 | `capture` | stays gaussian | `conjunctionDistinct`, 1 of 2 clauses is a scaled sum |
| 2017 | `kPa` | stays gaussian | `linearCombination` of scaled terms |
| 2017 | `rotor` | stays gaussian | `linearCombination` of scaled terms |
| 2018 | `autoQuest` | **CAN MOVE** | `conjunctionDistinct`, all clauses identity |
| 2018 | `faceTheBoss` | **CAN MOVE** | `singleThreshold` |
| 2019 | `habDocking` | **CAN MOVE** | `singleThreshold` |
| 2019 | `completeRocket` | cannot move | `constant` false — structurally inert |
| 2020 | `shieldOperational` | **CAN MOVE** | `singleThreshold` |
| 2022 | `cargoBonus` | **CAN MOVE** | `dataDependentMixture`, all three clauses identity |
| 2022 | `hangarBonus` | **CAN MOVE** | `singleThreshold` |

**This is the headline improvement over the 09-06 run**, which reached 0 of 33 selection-slice
cells. Derive this partition IN CODE at runtime from the predicate registry — never hardcode the
table above — so it cannot drift from the season modules.

### D-5. Report reachable and unreachable cells SEPARATELY. This is the lesson of the whole todo.

The 09-06 verdict failed because structurally-inert ties were pooled with live cells and diluted
the signal. **Do not repeat that.**

- Evaluate the gain on the **21 reachable cells only**.
- Report the 12 unreachable cells explicitly, with the reason each is unreachable (scaled-sum
  closure, or constant). They will tie exactly with control by construction — say so as a
  structural fact, never present them as evidence of anything.
- A cell that ties because its fit fell back to Gaussian is a THIRD category — see D-6.

### D-6. Restore the `negativeBinomial` resolution counter, or the measurement cannot be trusted.

`MarginalResolutionTally` was kept through the collapse **minus its `negativeBinomial` counter**.
Without it, an arm labelled `"negative-binomial"` whose fits mostly fell back to Gaussian is
indistinguishable from a genuine NB arm — which is the exact failure the tally was built to prevent.

The NB method-of-moments fit is undefined for `mean <= 0` and for `variance <= mean`
(under-dispersion), and both fall back to Gaussian. Under-dispersion is plausible for several of
these variables, so this is a live risk, not a theoretical one.

Restore the counter, report per-arm resolution counts alongside the Brier table, and **state what
fraction of the NB arm's fits genuinely resolved to negative binomial.** A result where most fits
fell back is a result about the fit's applicability, and must be reported as that rather than as a
verdict on the family.

Restore both deleted fallback reasons too (`non-positive-mean`, `variance-le-mean`) — they describe
exactly these two branches and were deleted with the rung.

### Claude's Discretion

- Exact CLI surface for the arm (a `--marginal-arm` flag, a separate script, or similar). Prefer
  the smallest addition to `measureRpCalibration.ts` that keeps ONE replay and ONE scorer.
- Where the written-up result lands (a report under `reports/rp/` is gitignored; the durable record
  belongs in the SUMMARY and, if the question closes, in the todo itself).
- Test granularity for the restored NB fit path, beyond the non-negotiables in the plan.

</decisions>

<specifics>
## Specific Ideas

**What to restore, all from `2731bfab` — recover the exact deleted text with
`git show 2731bfab -- <path>` rather than rewriting it from memory.** It was deleted with its
documentation and its reasoning intact; that prose is worth more than a paraphrase.

`packages/core/rankingPoints/constants.ts`
- `MarginalFamily` union: `"gaussian"` -> `"negative-binomial" | "gaussian"`.
- The comment block above it currently explains why the union has ONE member. That explanation is
  now false and must be rewritten, not left standing.

`packages/core/rankingPoints/marginals.ts`
- `NB_MAX_TAIL_TERMS` (the 100_000 tail-loop cap).
- `ResolvedMarginalFamily`: add `"negative-binomial"` back.
- `MarginalFallbackReason`: add `"non-positive-mean"` and `"variance-le-mean"` back.
- `FittedMarginal`: the optional `r` and `p` fields.
- `fitMarginal`: the fourth rung (declared NB -> two Gaussian fallbacks, else
  `r = mean²/(variance−mean)`, `p = mean/(mean+r)`).
- `nbTailSum`, `nbMode`, `negativeBinomialAtLeast` — the log-space discrete CDF. It is carefully
  written (log-space recurrence, no factorial ratios, lower-sum-then-switch to avoid catastrophic
  cancellation, bounded loop). Restore it verbatim.
- `probAtLeast` / `probAtMost`: the `"negative-binomial"` switch arms.

`packages/core/rankingPoints/analyticPmf.ts`
- `MarginalResolutionTally`: the `negativeBinomial` counter and `emptyMarginalResolutionTally`.
- `familyForClauseSum`: the `default:` arm stops compiling once the union grows. Give
  `"negative-binomial"` its own explicit `case` that throws with a message naming closure under
  scaled addition as the violated precondition — do NOT weaken the guard to make it compile.

`packages/harness/sigmaScoutLayer.ts`
- Wherever the tally is accumulated, count the NB resolution.

**Do NOT restore:** `RpLayerConfig` and its unions, `RP_LAYER_CONFIG_DEFAULT`,
`describeRpLayerConfig`, `assertSupportedRpLayerConfig`, `resolveDeclaredFamily`, the layer
constructor's config parameter, the `p-red-win` win source, the `discrete-margin` tie model,
`splitOutcomeProbabilities`, the inertness golden, or the `--arms` registry. Those are separate
refused changes and are out of scope. This task restores ONE family and re-tests it.

**Season modules stay `"gaussian"`.** All 34 declarations remain as they are; the NB arm is built
by the measurement script from the variant rule module (D-3), never by editing the tree. Production
behaviour must be bit-identical before and after this task.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/todos/pending/restore-negative-binomial-to-retest-it.md` — the task and Jacob's
  recorded decision. Authoritative.
- `.planning/todos/pending/rp-bonus-probabilities-are-severely-under-predicted.md` — the parent
  finding; its STATUS 2026-09-12 section explains why this verdict is in doubt.
- `docs/models/rp-attribution.md` — the 09-06 measurement, its bar, its per-cell tables, and the
  "Why the marginal arm's reach is far narrower than its label" section. **This document will need
  updating** with whatever this re-test finds, since it currently records a verdict this task is
  re-opening. Its committed record `data/baselines/rp-attribution-2026-09.json` has a digest sync
  test — do not break it; add rather than rewrite.
- `docs/models/rp-layer-config-arms.md` — the arm vocabulary from 09-06.
- `.planning/quick/260911-w7k-fix-clauseprobability-hardcoded-gaussian/` — the fix this re-test
  exercises.
- Commit `2731bfab` — the collapse that deleted everything being restored.

## Environment notes

- **Another session is writing to this checkout concurrently.** `epa.ts`, `epaWeekOne.ts`, three
  `docs/models/` files and quick task `260912-2vg` all appeared on a tree that was clean when this
  task started. **Stage by explicit path. Never `git add -A` or `git add .`** — a prior commit
  (`f0c7af48`) absorbed a foreign session's edits exactly this way.
- Worktrees are already disabled (`workflow.use_worktrees=false`), which is correct here: the
  corpus (`data/corpus.sqlite`, 582MB) is gitignored and would not exist in a worktree.
- The measurement reads `data/corpus.sqlite` read-only. No network access is needed — do not
  attempt a publish, an R2 write, or a live-origin check from this task.
- Run tests from the REPO ROOT, not `apps/web` (the root suite is ~167 files; `apps/web` is 77 and
  has hidden red before). Verify by OUTPUT, not by exit code — `timeout <n> pnpm <cmd>` swallows
  output and exits 0 on this machine. Prefer `npx vitest run <path>`.

</canonical_refs>
