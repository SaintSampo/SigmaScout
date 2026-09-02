---
phase: quick-260901-trz
plan: 01
type: execute
wave: 1
depends_on: []
mode: quick
files_modified:
  - packages/harness/eventBootstrap.ts
  - packages/harness/eventBootstrap.test.ts
  - packages/harness/acceptance.ts
  - packages/harness/acceptance.test.ts
  - packages/harness/score.ts
  - packages/harness/score.test.ts
  - packages/harness/cli.ts
  - packages/harness/tune.ts
  - packages/harness/tune.test.ts
  - packages/harness/promote.ts
  - packages/harness/promoteOverride.test.ts
  - packages/harness/promotedOverrides.test.ts
  - packages/harness/legacyParams.ts
  - packages/harness/legacyParams.test.ts
  - packages/harness/searchSpace.ts
  - packages/harness/searchSpace.test.ts
  - packages/harness/manifests.ts
  - packages/harness/manifests.test.ts
  - packages/harness/fixtures/extract-digest-slice.ts
  - packages/core/algorithms/sigma1/params.ts
  - packages/core/algorithms/sigma1/params.test.ts
  - packages/core/algorithms/sigma1/scale.ts
  - packages/core/algorithms/sigma1/scale.test.ts
  - packages/core/algorithms/sigma1/index.ts
  - packages/core/algorithms/sigma1/carryover.ts
  - packages/core/algorithms/sigma1/carryover.test.ts
  - packages/core/algorithms/sigma1/kalman.ts
  - packages/core/algorithms/sigma1/consistency.ts
  - packages/core/algorithms/sigma1/covariance.ts
  - packages/core/algorithms/sigma1/adaptation.ts
  - packages/core/algorithms/sigma1/rp/state.ts
  - packages/core/algorithms/sigma1/sigma1.test.ts
  - packages/core/algorithms/sigma1/innovationVariance.test.ts
  - scripts/reparamEquivalence.ts
  - scripts/measureRewindGap.ts
  - docs/models/sigma1-reparameterization.md
  - package.json
  - data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json
  - data/algorithm-versions/vpr@4.0.0+tracer-check.json
autonomous: false
requirements:
  - D-T1
  - D-T2
  - D-T3
  - D-T4
  - D-T5
  - D-T6
  - D-T7

estimate:
  tokens: 210000
  raw_tokens: 130000
  tasks: 7
  confidence: low

must_haves:
  truths:
    - "D-T1: five hyperparameters are dimensionless. `resolveSigma1Params` is called ONCE per public entry point (`predict`/`update`/`teamMetrics`/`carrySeason`) from `state.allianceScoreStats`, before that call's own fold — so every absolute quantity reflects only matches already replayed (Pitfall EPA-1)."
    - "D-T1: the filter is SCALE-EQUIVARIANT. Multiply every alliance score in a synthetic stream by 4 and every absolute parameter accordingly, and every `pRedWin` is bitwise identical while every predicted score is exactly 4x. Powers of two make this exact, not approximate."
    - "D-T1: an internal helper CANNOT read a relative field — `Sigma1ResolvedParams` `Omit`s all five, so the type system, not a convention, enforces resolve-once."
    - "D-T1: RP threshold-variable process noise is NOT multiplied by an alliance-SCORE variance (a dimensional error: RP variables are counts). RP reads its own versioned absolute pair and is bitwise unchanged from 3.0.0."
    - "D-T2: `carryPriorYearShare = 0.3` reproduces the retired `0.7 * lastYear + 0.3 * yearBefore` blend exactly, and `carryMeanReversion` is the sole shrinkage control. EPA's `epaCarryover` is untouched (D-04)."
    - "D-T3: the excluded keys cannot be searched. `SEARCH_EXCLUSIONS` and `SIGMA1_SEARCH_SPACE` partition `SIGMA1_PARAM_KEYS` exactly — a new parameter that lands in neither fails a test that names it."
    - "D-T5: the tuner selects on seasons strictly before its origin and never on the origin itself. The three structural blindness gates survive with a rolling-origin predicate; the winner is written to disk BEFORE the origin season is ever read."
    - "D-T6: one exported event-blocked bootstrap. On a known-dependence fixture it recovers the analytic block SE and exceeds the match-level figure by the analytic factor. No call site rolls its own."
    - "D-T7: `keep-incumbent` is a normal outcome — a discriminated union member, exit code 0, carrying N, the threshold, and which of the two conditions bound. The MAE guardrail is a veto over eligibility, never a second objective."
    - "The reparameterization is MEASURED, not asserted: `docs/models/sigma1-reparameterization.md` carries per-season Brier / score-MAE / bias before and after, on the PROMOTED parameter set, with the rename-only and the covShrinkage-fix deltas reported separately."
    - "D-13: `SIGMA1_CODE_VERSION` 3.0.0 -> 4.0.0 in the SAME commit as the shape change. Both committed digests were produced by `pnpm promote` running the final code; neither was hand-edited."
    - "No doc comment describes retired behaviour: `params.ts`'s header and every renamed field, `kalman.ts`'s two process-noise constants, `consistency.ts`'s three-variance header, `covariance.ts`'s `covShrinkage` reasoning (now FIXED, not tuned), `carryover.ts`'s blend description, and `tune.ts`'s header all describe what the code now does."
  artifacts:
    - packages/harness/eventBootstrap.ts
    - packages/harness/acceptance.ts
    - packages/harness/legacyParams.ts
    - packages/core/algorithms/sigma1/scale.ts
    - scripts/reparamEquivalence.ts
    - docs/models/sigma1-reparameterization.md
    - data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json
    - data/algorithm-versions/vpr@4.0.0+tracer-check.json
  key_links:
    - "`state.allianceScoreStats` -> `resolveSigma1Params` -> every absolute quantity inside `update()`. Resolved at the TOP of `update`, from `state`, never from the post-fold local. That one line's placement IS the leak-free guarantee."
    - "`Sigma1Params` field names -> `Sigma1ParamsSchema` (`z.strictObject`) -> every committed `data/algorithm-versions/*.json` -> `digest.test.ts`. Renaming a field without retiring and re-promoting in the same commit turns the reproducibility gate red and keeps it red."
    - "`SIGMA1_REFERENCE_SCORE_VARIANCE` -> BOTH `DEFAULT_SIGMA1_PARAMS`'s relative defaults AND `migrateAbsoluteToScaleRelative`'s divisor. One constant, two consumers: if they ever used different references, the defaults and the shipped set would sit on different scales and nothing would say so."
    - "the rolling-origin gate predicate -> `assertNoFutureSeasonLeak` -> the objective. Changing the gates from `seasonLabel === tune` to `season < originSeason` is the single edit in this task that can silently re-open hyperparameter-level leakage."
    - "`HarnessPredictionInput.eventKey` -> `eventBlockedBootstrap` -> `decideAcceptance`'s standard error -> the acceptance bar. Without a real event key the blocking degenerates to match-level and the bar shrinks by ~40% (D-T6's measured figure)."
---

# Quick Task 260901-trz — scale-relative reparameterization and rolling-origin selection

<objective>
Implement the seven LOCKED decisions in `CONTEXT.md`: make five hyperparameters
dimensionless fractions of the season's alliance-score variance (D-T1), merge the two
carry weights into one share (D-T2), prune the search space with an enforced exclusion
list (D-T3), keep adaptation as a binary mode for the re-tune to settle (D-T4), replace
the fixed tune/holdout split with rolling-origin selection (D-T5), and provide the
event-blocked bootstrap (D-T6) and the pre-committed acceptance rule (D-T7) as tested,
shared machinery.

Every number in `CONTEXT.md` is an already-obtained experimental result. Nothing here
re-derives them; the job is to build the infrastructure those measurements call for, and
to prove — by measurement, not assertion — that the parameter reshape preserves behaviour
on the tune seasons.

**Out of scope, and not to be started:** the re-tune itself (a separate multi-hour compute
job; Task 5 makes it runnable and Task 7 files it), regenerating R2 artifacts, EPA's frozen
constants, and anything under `apps/web` — another agent is working there concurrently.

**Guiding constraint from the user: keep the implementation LEAN.** Where a parameter or
mechanism is borderline, drop it. Three places below add machinery anyway; each names why
the leaner alternative was rejected.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/260901-trz-scale-relative-reparameterization-and-ro/CONTEXT.md
@.claude/CLAUDE.md

@packages/core/algorithms/sigma1/params.ts
@packages/core/algorithms/sigma1/index.ts
@packages/core/algorithms/sigma1/carryover.ts
@packages/core/scoring/expandingStats.ts
@packages/harness/searchSpace.ts
@packages/harness/tune.ts
@packages/harness/promote.ts
@packages/harness/score.ts
@.planning/quick/260901-is2-model-correctness-fixes-from-adversarial/PLAN.md
</context>

---

## Findings that shape the plan (read before Task 1)

Four facts were established by reading the tree, and each one moves a decision:

**F1 — the promoted set, not the defaults, is what ships.**
`data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json` carries
`processNoiseWithinEvent: 0.14522393520915602`, `processNoiseEventBoundary: 1`,
`minConsistencyVariance: 1`, `coldStartConsistencyVariance: 16.75421168559074`,
`coldStartTeamTotal: 20`, `covShrinkage: 0.12817359956447036`, `linkC: 0.5`, and
`carryLastYearWeight: 0.7` / `carryPriorYearWeight: 0.3` — the exact blend
`carryPriorYearShare = 0.3` is defined to reproduce. So the equivalence measurement must
run on the PROMOTED set. Measuring the defaults would prove nothing about the site.

**F2 — the old search artifact cannot be re-promoted under the new shape.**
`Sigma1ParamsSchema` is `z.strictObject`, and `promote.ts` does
`Sigma1ParamsSchema.parse(winnerCandidate.params)` on the raw `--from` artifact. Every
candidate inside `reports/tune-joint-off.json` records the ABSOLUTE field names, so that
parse throws before `--set-param` is ever consulted. Worse, that artifact's winner carries
`linkC: 1.2398308984401685` — the shipped `0.5` exists only as a `--set-param` override
recorded in the committed version file. Re-promoting from the search artifact would
silently drop the D-Q2 `linkC` correction. Hence Task 3 adds `--from-version`: promote FROM
the committed version file, migrating its params through the same reparameterization map
the defaults use. The rejected alternative — hand-authoring a new-shape artifact under the
gitignored `reports/` — is exactly what quick task 260901-is2 Task 4 rejected, and for the
same reason (the committed file would read as a fresh tune).

**F3 — RP shares the score-side process-noise parameter, and must not.**
`sigma1/rp/state.ts` L251 reads `params.processNoiseWithinEvent` /
`params.processNoiseEventBoundary` for the RP threshold variables. Those variables are
COUNTS (notes, links, cages), not points. Multiplying their process noise by an
alliance-SCORE variance is a dimensional error that would inject ~10,000 units of noise
per match into a 0-20 scale variable in 2026. Task 3 therefore splits them into
`rpProcessNoiseWithinEvent` / `rpProcessNoiseEventBoundary`, versioned and excluded from
the search, migrated from the legacy absolute values so RP behaviour is bitwise unchanged.
The leaner-looking alternative (scale RP by each threshold variable's own
`rpVariableMean` SD) is dimensionally correct but CHANGES RP dynamics, which this task has
no mandate to do — Task 7 files it.

**F4 — the digest fixture does not need regenerating.**
`packages/harness/fixtures/digest-slice.json` records raw MATCHES (`sliceSeason`,
`sliceEventKeys`, `matches`), not predictions. The slice (2022, `2022alhu`/`2022azfl`/
`2022azva`, 265 matches) is unchanged, so only `extract-digest-slice.ts`'s default path
constant moves. `digest.test.ts` matches fixture to version by slice, not by version
string, and with the corpus present it also asserts corpus and fixture agree — a stale
fixture would fail loudly, not silently.

**Corpus scale (measured, for the cost estimate in Task 5):** non-offseason played matches
per season — 2022: 14,677 / 185 events; 2023: 16,353 / 185; 2024: 17,029 / 192;
2025: 17,877 / 205; 2026: 18,403 / 214.

---

## What "provably a reparameterization" means here, and its tolerance

**Exact per-match equivalence is impossible, by construction.** `allianceScoreStats` is an
expanding statistic that deliberately carries across season boundaries (D-T1's own
season-boundary note). The realized `sigma^2` at match m is a weighted blend of every
alliance score folded since 2022 — neither the season's final variance nor constant within
a season. The retired parameterization applied ONE number at every match; the new one
applies `rel * sigma^2_m`, which moves match to match. The two can agree on AVERAGE over a
pool, never at a single match. Anyone claiming exact equivalence has not understood the
change.

**So the reference is measured, not chosen.** `SIGMA1_REFERENCE_SCORE_VARIANCE` is defined
as the MATCH-COUNT-WEIGHTED MEAN of the realized expanding variance over every tune-season
match (2022-2024, folded continuously, DQ-zero alliances excluded exactly as `update()`
excludes them). That is, by definition, the scale the currently promoted absolute
parameters actually operated at — so `rel = absolute / V_ref` preserves the average
absolute value over the pool the parameters were tuned on. Task 2 measures it; Task 3
hardcodes it with the measurement and date recorded in its doc comment.

**Four gates, each with its reason:**

| Gate | Bound | Why this number |
|---|---|---|
| A. Brier | `abs(dBrier) <= 0.0024`, per tune season and pooled | 2 x the measured event-blocked SE (0.001219, D-T6). A shift inside two event-blocked standard errors is not distinguishable from resampling noise AT THE RESOLUTION D-T7's own acceptance rule uses. Anything larger is a behaviour change wearing a rename's clothes. |
| B. score MAE | `abs(dMAE) <= 2%` relative, per tune season | The regression this whole task exists to undo is +7.0% (2025: 19.75 -> 21.14) and +15.8% (2026: 50.56 -> 58.53). A reparameterization must land at least 3x inside the smaller of those. |
| C. bias | `abs(dbias) <= 1.0` point, per tune season | Bias moved most under the R change (+4.05 -> +9.10). 1 point is ~5% of a tune-season MAE and one fifth of the shift that flagged the original defect. |
| D. scale-equivariance | EXACT (bitwise) | The one deviation that IS under our control. See Task 3's test. |

**Two deltas are reported separately, never summed into one number.** The rename-only
delta (promoted params mapped through `V_ref`, `covShrinkage` left at its tuned
0.12817359956447036) is the reparameterization. The second delta adds D-T3's
`covShrinkage` fix (0.3, the documented constant) — a DELIBERATE deviation, estimated by
CONTEXT at ~0.0005 Brier. Gates A-C apply to the rename-only delta. The covShrinkage delta
is reported and must be of the magnitude CONTEXT predicts; if it is not, that is a finding.

**Holdout seasons are reported, never gated.** 2025/2026 Brier/MAE/bias are re-measured
and printed because CONTEXT already publishes those exact figures — this is a
reproduction, not a new peek, and no parameter is selected from them. Expect MAE to fall
toward the retired estimator's numbers (2025 -> ~19.8, 2026 -> ~50.6). If it does not, the
scale-relative change is not doing what the measurement said it would.

**If a gate fails, do not loosen it.** The likely cause is a mis-measured `V_ref`
(wrong DQ handling, or the fold reset at a season boundary when it must not be). Re-derive
and re-run. If it still fails, STOP and report: the shape change is doing something other
than rescaling.

---

## Task ordering and why

Ordered by coupling. Two constraints fix the sequence.

**The parameter SHAPE change is ONE commit (Task 3), and it is unavoidably large.**
`Sigma1ParamsSchema` is `z.strictObject`, so the instant a field is renamed every committed
`data/algorithm-versions/*.json` fails to parse and `digest.test.ts` goes red.
`SearchableParamKey` is derived from `keyof Sigma1Params`, so `SIGMA1_SEARCH_SPACE`'s
`Record` stops typechecking in the same edit. There is no ordering of the rename, the
consumer updates, the version bump and the re-promotion that leaves the tree green at an
intermediate commit boundary — and a knowingly-red boundary is not acceptable. This is
exactly the precedent `params.ts`'s own 2.0.0 -> 2.1.0 comment records and 260901-is2
Task 5 executed again: retire and re-promote in the SAME commit.

**Reviewability is bought by emptying that commit, not by splitting it.** Everything that
can be green on its own is pushed out of Task 3: the bootstrap and acceptance machinery
(Task 1), the equivalence harness and the BEFORE baseline (Task 2), the search-space
exclusion list (Task 4), the rolling-origin control flow (Task 5), the acceptance wiring
(Task 6), and the whole documentation sweep plus the AFTER measurement (Task 7). What
remains in Task 3 is the rename, its mechanical consequences, and the re-promotion — every
item of which would leave the tree red if deferred.

**Task 2 must run BEFORE Task 3.** A before/after comparison whose "before" is reconstructed
after the fact is not a measurement. Task 2 replays the current committed code and records
the numbers in a committed document.

**Task 1 must run before Task 2**, because the equivalence script's "is this delta inside
the noise" question is answered by the event-blocked bootstrap, which is Task 1's output.

**Tasks 4-6 depend on Task 3's final key names** and are ordered smallest-radius-first:
Task 4 is `searchSpace.ts` only; Task 5 rewrites `tune.ts`'s control flow; Task 6 wires the
selection rule into it.

**Commit discipline.** Each task is one commit and the suite must be green at each commit
boundary. Task 3 bundles the version bump and both re-promotions into its own commit for
the reason above.

---

## Verification conventions (apply to every task)

- Run tests as `pnpm vitest run <path>`. **Never** wrap a test command in `timeout` — it
  swallows output and exits 0 regardless (project memory, `timeout+pnpm false green`).
- **Verify by reading output, not by exit code.** A passing exit code with no test-count
  line is not evidence.
- `pnpm install` exits 1 on this machine (better-sqlite3 node-gyp). That is expected and is
  not a failure; `node_modules` is fine. Verify functionally.
- `pnpm typecheck` after every task that changes a type or an interface. In Task 3 the
  typechecker is the primary work list — see that task's own note.
- Never `Read`, `cat`, or `echo` `.env` (CLAUDE.md, Secrets handling). No task here needs a
  secret; every corpus open in this plan is read-only and the new script deliberately takes
  no `--env-file`.
- Do not touch `apps/web`. Do not run `git stash` / `git reset` / `git checkout --` —
  another agent may have uncommitted work in the tree.

---

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: D-T6/D-T7 — the event-blocked bootstrap and the acceptance rule, as shared machinery</name>
  <files>packages/harness/eventBootstrap.ts, packages/harness/eventBootstrap.test.ts, packages/harness/acceptance.ts, packages/harness/acceptance.test.ts, packages/harness/score.ts, packages/harness/score.test.ts, packages/harness/cli.ts, packages/harness/tune.ts, packages/harness/promote.ts</files>

  <behavior>
- On a fixture with perfect within-event dependence (100 events x 20 identical-contribution
  matches, contributions i.i.d. across events), the event-blocked SE recovers the analytic
  `SD(b)/sqrt(100)` to within a few percent, and exceeds a match-level resample of the same
  data by approximately `sqrt(20)` — the analytic understatement factor.
- The bootstrap is deterministic: the same units, statistic and seed give a bitwise
  identical standard error across runs.
- Fewer than 2 distinct event blocks throws by name — a bootstrap over one block reports
  a standard error of zero, which is a false claim of certainty, not a measurement.
- `acceptanceThreshold(60, 0.001219)` returns approximately 0.003488 (CONTEXT's stated
  0.0035 bar at N=60); `acceptanceThreshold(1, se)` throws.
- `decideAcceptance` returns `keep-incumbent` with `reason: "below-threshold"` when the
  candidate's margin does not clear the bar, and `keep-incumbent` with `reason: "mae-veto"`
  when it clears the bar but trips the score-MAE guardrail. Neither throws. Both carry the
  evaluation count and the threshold that produced them.
  </behavior>

  <action>
Three pieces, one commit. None has a consumer yet — that is deliberate: this machinery is
what Tasks 2, 5 and 6 are all measured against, so it lands tested and alone.

**1. `HarnessPredictionInput` gains `eventKey: string` (`score.ts`).**
Event blocking needs a real event key. Deriving one by splitting `matchKey` on `_` would
work today and would be a string-surgery dependency on a TBA naming convention that this
codebase otherwise never relies on. `replay.ts`'s `PredictionRecord` already carries
`r.match.eventKey`, so every producer has it in hand: add the field to the interface and
populate it at each construction site — `cli.ts`'s `runSeasons`, `tune.ts`'s
`runBoundedSeasons`, `promote.ts`'s `main`. `pnpm typecheck` enumerates any site missed.
`aggregateScores` itself does not read the new field; it is carried for downstream
blocking. Say so in the field's doc comment, so a reader does not go looking for a use
inside this module.

**2. `packages/harness/eventBootstrap.ts` (new).**
Lives in `packages/harness` for the reason `searchSpace.ts`'s own header gives: this is a
TUNING/EVALUATION concern, and `packages/core` stays free of anything that is not
Worker-importable prediction logic.

Export `EventBlockedUnit` (`{ readonly eventKey: string }`), `EventBootstrapResult`
(`pointEstimate`, `standardError`, `resamples`, `eventCount`, `matchCount`, `seed`, and a
`percentile` pair at 2.5/97.5), `DEFAULT_EVENT_BOOTSTRAP_RESAMPLES = 2000`, and

    eventBlockedBootstrap<T extends EventBlockedUnit>(
      units, statistic: (sample: readonly T[]) => number, options?: { resamples?, seed? }
    ): EventBootstrapResult

Group `units` by `eventKey` in first-appearance order. Each resample draws `eventCount`
event blocks WITH replacement and concatenates their member units, then applies
`statistic` to the concatenation. The standard error is the sample SD of the resampled
statistics. Use the same Mulberry32 construction `tune.ts` / `identifiability.ts` /
`rp/distribution.ts` already cite to the same source — copy the construction, cite them,
do not import a private helper across module boundaries. Default seed 42, matching
`rpMonteCarloSeed`'s own default.

The generic `statistic` parameter is the whole design: the SAME helper produces the
LEVEL standard error CONTEXT quotes (0.001219, statistic = mean Brier) and the
PAIRED-DIFFERENCE standard error the acceptance rule actually needs (statistic = mean of
per-match `candidateBrier - incumbentBrier`, both models scored on the same resampled
events). Document that distinction in the file header and state plainly which one D-T7's
bar governs: the bar is on a DIFFERENCE, so the paired SE is the faithful quantity, and it
is materially tighter than either side's level SE because the two models see the same
matches. Both remain computable, and Task 6 reports both.

Justify the 2000-resample default in prose (the project's convention: never a bare
literal). At 2000 resamples the Monte Carlo error on the SE itself is roughly
`1/sqrt(2*2000)` ~ 1.6% of the SE, an order of magnitude below the difference between the
event-blocked and match-level figures this helper exists to keep apart.

**3. `packages/harness/acceptance.ts` (new).**
Export:

- `acceptanceThreshold(evaluationCount: number, standardError: number): number` —
  `Math.sqrt(2 * Math.log(evaluationCount)) * standardError`. Throw for
  `evaluationCount < 2`: at N=1 the expression is exactly 0, which is not a bar. Document
  that this is the standard union bound over N evaluations — the bar MOVES with N, which
  is why D-T7 requires N recorded alongside the result.
- `ACCEPTANCE_MAE_RELATIVE_TOLERANCE = 0.01` and `ACCEPTANCE_MAE_NOISE_MULTIPLE = 2`, each
  with its own justification comment. D-T7 says "does not MATERIALLY worsen" without
  giving a number; this is that number, chosen and stated rather than left implicit. A
  candidate trips the veto only when its MAE regression is BOTH statistically
  distinguishable from zero (more than 2 event-blocked standard errors) AND at least 1%
  of the incumbent's MAE in relative terms. The regressions that motivated the guardrail
  were +7.0% and +15.8% — both clear either condition by a wide margin — while
  resampling-scale wiggles clear neither.
- `AcceptanceOutcome`, a discriminated union: `{ decision: "accept", ... }` or
  `{ decision: "keep-incumbent", reason: "below-threshold" | "mae-veto", ... }`. Both
  members carry `margin`, `threshold`, `evaluationCount`, `maeDelta`, `maeVetoBound`.
- `decideAcceptance(input): AcceptanceOutcome`, taking incumbent/candidate Brier,
  incumbent/candidate MAE, the paired standard errors for both deltas, and the evaluation
  count.

The header must say, in its own words, that `keep-incumbent` is a SUCCESSFUL search
result, not a failure: a caller that treats it as an error, exits non-zero on it, or
retries until something is accepted has defeated the purpose of a pre-committed bar. This
function never throws for a non-accepting comparison.

Evaluation ORDER, because it decides what gets reported: a candidate is ELIGIBLE when it
clears the Brier bar AND passes the MAE veto; the winner is the best eligible candidate.
When no candidate is eligible, the reported `reason` is the one that bound the BEST-BRIER
candidate — so the report says "the best candidate was vetoed on score MAE" rather than
the less informative "nothing was accepted".
  </action>

  <tests>
**Add `packages/harness/eventBootstrap.test.ts`:**
- **Known-dependence fixture (the headline test).** 100 events x 20 matches. Every match in
  event i carries the same value `b_i`, with `b_i` drawn from a seeded generator defined in
  the test file (never `Math.random`, or the test is a coin flip). The true SE of the mean
  is `SD(b)/sqrt(100)`. Assert the event-blocked SE recovers it within 5%, and write the
  tolerance's justification into the test rather than leaving a bare number.
- **Negative control, same fixture:** a match-level resample (drawing 2000 individual
  matches with replacement) reports an SE approximately `sqrt(20)` = 4.47x smaller. Assert
  the ratio lands in [3.5, 5.5]. Without this the headline test could pass against a helper
  that silently blocks on nothing.
- **Independence control:** 100 events x 20 matches where every match's value is
  independent. Event-blocked and match-level SEs must now AGREE within ~15% — proving the
  helper inflates only where dependence exists, and is not simply always larger.
- Determinism: same seed twice, bitwise identical `standardError`.
- Different seeds give different draws but SEs within ~10% of each other.
- 1 event block throws, message names the block count.
- `percentile.lower < pointEstimate < percentile.upper` on the dependent fixture.

**Add `packages/harness/acceptance.test.ts`:**
- `acceptanceThreshold(60, 0.001219)` is within 1e-6 of 0.0034876..., pinning CONTEXT's
  stated 0.0035 bar at N=60. Compute the expected value in the test from
  `Math.sqrt(2*Math.log(60))*0.001219`, and assert `toBeCloseTo(0.0035, 4)` alongside, so
  the test states the published figure it is defending.
- The bar MOVES with N: assert `acceptanceThreshold(120, se) > acceptanceThreshold(60, se) >
  acceptanceThreshold(30, se)`, and record the three values in a comment — this is the
  property that makes recording N mandatory.
- `acceptanceThreshold(1, se)` and `acceptanceThreshold(0, se)` both throw.
- accept: margin comfortably above the bar, MAE unchanged.
- `keep-incumbent` / `below-threshold`: margin positive but under the bar. Assert the
  returned object, and assert the function did NOT throw (an explicit assertion, because
  "this is a normal outcome" is the contract).
- `keep-incumbent` / `mae-veto`: margin above the bar, MAE +8% with a small SE — the
  shape of the regression that motivated the guardrail.
- Veto does NOT fire on a +0.3% MAE move with a large SE (fails both conditions), nor on a
  +5% move whose SE is large enough that it is under 2 SE (fails the noise condition) —
  two tests, so both halves of the AND are proven load-bearing.
- A candidate that IMPROVES MAE is never vetoed.

**Update `packages/harness/score.test.ts`** fixtures for the new required `eventKey` field.
No assertion about scoring behaviour changes; if any existing score assertion moves, the
field was not additive and that is a bug.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/harness/eventBootstrap.test.ts packages/harness/acceptance.test.ts</automated>
    <automated>pnpm vitest run packages/harness/score.test.ts packages/harness/tune.test.ts packages/harness/digest.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`eventBootstrap.ts` and `acceptance.ts` exist, exported, tested, with no consumers yet.
The known-dependence fixture recovers the analytic block SE and its negative control shows
a match-level resample understating by ~sqrt(20). `keep-incumbent` is a returned union
member, proven not to throw. `HarnessPredictionInput` carries `eventKey`, populated at every
producer. Whole harness suite green.
  </done>
</task>

<task type="auto">
  <name>Task 2: the equivalence harness, the measured reference variance, and the BEFORE baseline</name>
  <files>scripts/reparamEquivalence.ts, package.json, docs/models/sigma1-reparameterization.md</files>
  <precondition>`data/corpus.sqlite` exists (363 MB, present as of this plan) and `data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json` is still the committed promoted set — this task must run against the PRE-change code.</precondition>

  <action>
This task changes no shipped code. It builds the instrument the whole task is judged by,
and takes the reading that Task 7 compares against. A before/after comparison whose
"before" is reconstructed after the fact is not a measurement.

**`scripts/reparamEquivalence.ts` (new).** Add `"reparam:equivalence": "tsx
scripts/reparamEquivalence.ts"` to `package.json` — deliberately WITHOUT `--env-file=.env`
(this path opens the corpus read-only and makes no network call, so no secret is ever
legitimately in scope; CLAUDE.md's secrets boundary).

Two modes, one script:

`--mode reference` — measure `SIGMA1_REFERENCE_SCORE_VARIANCE`. Build the tune-season
stream with `buildSeasonStream(db, season, { includeOffseason: false })` for 2022, 2023,
2024 IN ORDER, and fold every alliance score through `foldObservation` in exactly the way
`update()` does: both alliances per match, EXCEPT a whole-alliance-DQ zero
(reuse `isFullyDqZeroScoreAlliance` from `../dq.js` — do not re-derive the predicate), and
**never reset the statistic at a season boundary** (`carrySeason` carries it forward; a
reset here would measure a quantity the model never sees). Before each match, record
`standardDeviation(stats, SIGMA1_FALLBACK_SCORE_SD) ** 2` — the value that match's update
would have been scaled by. Report the MATCH-COUNT-WEIGHTED MEAN of that series over the
whole tune pool, plus per-season means, the first-match and final values, and the match
count. The weighted mean is `SIGMA1_REFERENCE_SCORE_VARIANCE`.

`--mode measure --params <version-file> --seasons <list> --out <path>` — replay a named
promoted parameter set and report, per season and pooled: Brier (combined comp-level view,
the D-01 objective), winner accuracy, alliance-score MAE
(`mean(abs(predRed-actualRed)) and abs(predBlue-actualBlue)` over both alliances), and
signed bias (`mean(pred - actual)`, both alliances). Attach the event-blocked bootstrap SE
from Task 1 to Brier and to MAE. Drive the replay through `cli.ts`'s exported `runSeasons`
or, if that has no parameter hook, through `WalkForwardSimulator` + `buildSeasonStream`
directly — either way `replay.ts` stays the only replay implementation, exactly as
`tune.ts`'s header requires of itself.

Two details that decide correctness:
1. The MAE/bias population must be the SAME population Brier is scored on — apply
   `aggregateScores`' own exclusions (offseason, surrogate-affected, missing result,
   quarantined). Two different populations would make the two metrics uncomparable and
   would reintroduce, in the measuring instrument, exactly the silent-narrowing failure
   `score.ts`'s quarantine bounds exist to prevent.
2. Seasons carry: 2022-2026 is ONE continuous replay with `carrySeason` threading, not five
   independent runs. Anything else measures a different model.

**Run it, and record the readings.** Create `docs/models/sigma1-reparameterization.md`
(committed; `reports/` is gitignored and would lose the baseline). Structure:
its purpose and the four gates from this plan's own "provably a reparameterization"
section restated in the document's own voice; the measured
`SIGMA1_REFERENCE_SCORE_VARIANCE` with its per-season breakdown and the exact command that
produced it; a BEFORE table (per season: Brier +/- event-blocked SE, MAE, bias, match
count) for `vpr@3.0.0+tuned-2026-08` over 2022-2026; and an explicitly empty AFTER section
with a one-line note that Task 7 fills it. Record the corpus mtime/size so a later reader
can tell whether the corpus moved underneath the comparison.

Sanity-check the reading before committing: the measured per-season variances should land
near CONTEXT's table (2022 ~900, 2023 ~1406, 2024 ~718) and 2025 MAE/bias should land near
the measured 21.14 / +9.10. They will not match to the digit — CONTEXT's variances are
season-final and this is an expanding series — but an order-of-magnitude mismatch means
the fold is wrong (most likely a reset at a season boundary, or the DQ predicate inverted).
Do not proceed to Task 3 on a reading you cannot explain.
  </action>

  <tests>
No new unit tests: this script's output IS its verification, and its two non-trivial
components (the bootstrap, the exclusion population) are already tested in Task 1 and
`score.test.ts` respectively.

**Two checks to run and record, not to commit as tests:**
- The reference-mode weighted mean must lie strictly BETWEEN the smallest and largest
  per-season variance it averages. If it does not, the weighting is wrong.
- Run `--mode measure` twice on the same inputs and confirm identical Brier to the last
  digit. A replay that is not deterministic invalidates every comparison downstream, and
  finding that out now costs four minutes rather than a whole task.
  </tests>

  <verify>
    <automated>pnpm reparam:equivalence --mode reference</automated>
    <automated>pnpm reparam:equivalence --mode measure --params data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json --seasons 2022,2023,2024,2025,2026 --out reports/reparam-before.json</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`scripts/reparamEquivalence.ts` exists with both modes and a `package.json` script that
takes no `--env-file`. `SIGMA1_REFERENCE_SCORE_VARIANCE` is MEASURED, its value and
derivation recorded. `docs/models/sigma1-reparameterization.md` is committed carrying the
gates, the reference measurement, and a five-season BEFORE table with event-blocked SEs.
The determinism check passed. No file under `packages/` changed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: D-T1 + D-T2 — the parameter shape change, SIGMA1_CODE_VERSION 4.0.0, and both re-promotions</name>
  <files>packages/core/algorithms/sigma1/params.ts, packages/core/algorithms/sigma1/scale.ts, packages/core/algorithms/sigma1/scale.test.ts, packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/carryover.ts, packages/core/algorithms/sigma1/kalman.ts, packages/core/algorithms/sigma1/consistency.ts, packages/core/algorithms/sigma1/covariance.ts, packages/core/algorithms/sigma1/adaptation.ts, packages/core/algorithms/sigma1/rp/state.ts, packages/core/algorithms/sigma1/params.test.ts, packages/core/algorithms/sigma1/carryover.test.ts, packages/core/algorithms/sigma1/sigma1.test.ts, packages/core/algorithms/sigma1/innovationVariance.test.ts, packages/harness/legacyParams.ts, packages/harness/legacyParams.test.ts, packages/harness/promote.ts, packages/harness/promoteOverride.test.ts, packages/harness/promotedOverrides.test.ts, packages/harness/searchSpace.ts, packages/harness/searchSpace.test.ts, packages/harness/manifests.ts, packages/harness/manifests.test.ts, packages/harness/cli.ts, packages/harness/fixtures/extract-digest-slice.ts, scripts/measureRewindGap.ts, scripts/verifyAllianceUncertaintyIdentity.ts, data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json, data/algorithm-versions/vpr@4.0.0+tracer-check.json</files>
  <precondition>Task 2 is committed and `SIGMA1_REFERENCE_SCORE_VARIANCE`'s measured value is recorded in `docs/models/sigma1-reparameterization.md`. `data/corpus.sqlite` exists (both re-promotions replay a bounded 3-event slice).</precondition>

  <behavior>
- Scale-equivariance, EXACT: take a synthetic stream, multiply every alliance score by 4,
  and multiply `fallbackScoreSd` by 4 in the parameter set. Every `pRedWin` is bitwise
  identical between the two runs and every predicted score is exactly 4x. Powers of two
  make this exact in IEEE-754 rather than approximate.
- `resolveSigma1Params(params, emptyExpandingStats())` returns
  `processNoiseWithinEvent === params.processNoiseWithinEventRel * params.fallbackScoreSd ** 2`
  — the documented cold-start scale, before any alliance score has been folded.
- `sigma1Carryover` with `carryPriorYearShare = 0.3` produces, for every team, exactly the
  value the retired `0.7 * lastYear + 0.3 * yearBefore` blend produced, to the last bit.
- The RP threshold-variable Kalman step is bitwise unchanged from 3.0.0 for the migrated
  promoted parameter set.
  </behavior>

  <action>
The one unavoidably atomic commit. `pnpm typecheck` is the primary work list here: after
the rename it enumerates every consumer, and each one is re-annotated rather than cast.
**No `as Sigma1Params` cast is added anywhere in this task** — a cast is how the invariants
`Sigma1ParamsSchema` now enforces get bypassed, which is the defect 03-REVIEW WR-01 already
closed once.

**1. `params.ts` — the shape.**

Add `SIGMA1_REFERENCE_SCORE_VARIANCE`, OWNED BY THIS MODULE (not `scale.ts`), with the
measured value from Task 2. Its doc comment records: what it is (the match-count-weighted
mean realized expanding alliance-score variance over the 2022-2024 tune pool), how it was
measured (`pnpm reparam:equivalence --mode reference`), when, and WHY it lives here — the
same "leaf module owns the constant, `index.ts` imports it" discipline this file's header
already explains for the cold-start constants, plus the specific fact that
`DEFAULT_SIGMA1_PARAMS`'s own object literal dereferences it at module-evaluation time, so
importing it from `scale.ts` would create the exact TDZ cycle that header warns about.
State that it is a fixed historical measurement, not a knob: re-measuring it later and
editing it in place would silently rescale every committed version file's meaning.

Rename five fields and add one, per D-T1's table:

| retired | new | scaling |
|---|---|---|
| `processNoiseWithinEvent` | `processNoiseWithinEventRel` | x sigma^2 |
| `processNoiseEventBoundary` | `processNoiseEventBoundaryRel` | x sigma^2 |
| `coldStartConsistencyVariance` | `coldStartConsistencyVarianceRel` | x sigma^2 |
| `minConsistencyVariance` | `minConsistencyVarianceRel` | x sigma^2 |
| `coldStartTeamTotal` | `coldStartTeamTotalRel` | x sigma (LINEAR) |

`fallbackScoreSd` STAYS ABSOLUTE and keeps its value of 25 — it is the bootstrap for sigma
itself and cannot be a fraction of the quantity it stands in for (D-T1 says so explicitly).
Record the consequence in its doc comment: with `fallbackScoreSd = 25` a cold-start state
resolves to a scale of 625, roughly 0.6x the reference, so the very first matches of 2022
run slightly tight — a bounded, transient, documented deviation that the expanding
statistic erases within a few dozen matches. Do NOT "fix" this by setting `fallbackScoreSd`
to `sqrt(SIGMA1_REFERENCE_SCORE_VARIANCE)`; that would be an unrequested retune of the
bootstrap, and CONTEXT changed nothing about this parameter's value.

D-T2: delete `carryLastYearWeight` and `carryPriorYearWeight`, add
`carryPriorYearShare` (default 0.3, reproducing today's 0.7/0.3). Its doc comment must
carry D-T2's reasoning: the retired pair was UNNORMALIZED, so their SUM controlled overall
shrinkage — already `carryMeanReversion`'s job — while only their RATIO asked a distinct
question. Two parameters carrying one new degree of freedom plus a duplicate.
`carryMeanReversion` is now the sole shrinkage control; say so in ITS comment too.

F3: add `rpProcessNoiseWithinEvent` and `rpProcessNoiseEventBoundary` (absolute, defaulted
to `SIGMA1_PROCESS_NOISE_WITHIN_EVENT` / `SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY`). Their doc
comments must state the dimensional argument: the RP threshold variables are COUNTS, not
points, so multiplying their process noise by an alliance-SCORE variance is a category
error, not a conservative choice. Record the rejected alternative (per-variable scaling
off `rpVariableMean`'s own SD) and that it is deferred because it would change RP dynamics,
which this task has no mandate to do.

**Every relative default is DERIVED, never re-typed** — this file's own header rule
("sources every field by IMPORTING the pre-existing exported constant it replaces"):
`processNoiseWithinEventRel: SIGMA1_PROCESS_NOISE_WITHIN_EVENT / SIGMA1_REFERENCE_SCORE_VARIANCE`,
and `coldStartTeamTotalRel: SIGMA1_COLD_START_TEAM_TOTAL / Math.sqrt(SIGMA1_REFERENCE_SCORE_VARIANCE)`
for the linear one. The reparameterization map is then visible in the source, and the
defaults cannot drift from the absolute behaviour they exist to reproduce.

`Sigma1ParamsSchema`: rename the five fields, drop the two carry weights, add
`carryPriorYearShare` and the two RP fields. In the object-level `.check(...)`: rename the
D-07 predicate to the `Rel` pair (the invariant is UNCHANGED in meaning — both sides scale
by the same sigma^2, so a dimensionless ordering is the identical statement); ADD the same
D-07 predicate for the RP pair; replace the two carry-weight range checks with one on
`carryPriorYearShare` in [0,1]. Update the schema's doc comment, which currently enumerates
five invariants by name.

Bump `SIGMA1_CODE_VERSION` `"3.0.0"` -> `"4.0.0"` with a block in the exact style of the
existing 2.1.0 -> 3.0.0 comment: name this quick task and D-T1/D-T2, state that the
parameter set's SHAPE changed so no 3.0.0 file can be parsed as a 4.0.0 one, state that
`update()`'s and `teamMetrics`'s observable output both move because the effective process
noise and variance floors now track each season's own scale, and record that the two
`vpr@3.0.0+*.json` files were retired and re-promoted as `vpr@4.0.0+*.json` IN THIS SAME
COMMIT, from the committed 3.0.0 files via `--from-version`, so the digests were produced
by the new code and never hand-edited. MAJOR: this changes the shipped model on every page,
not an edge case.

**2. `sigma1/scale.ts` (new leaf module).**

    export interface Sigma1ResolvedParams
      extends Omit<Sigma1Params,
        "processNoiseWithinEventRel" | "processNoiseEventBoundaryRel" |
        "coldStartConsistencyVarianceRel" | "minConsistencyVarianceRel" |
        "coldStartTeamTotalRel"> {
      readonly scoreSd: number;
      readonly scoreVariance: number;
      readonly processNoiseWithinEvent: number;
      readonly processNoiseEventBoundary: number;
      readonly coldStartConsistencyVariance: number;
      readonly minConsistencyVariance: number;
      readonly coldStartTeamTotal: number;
    }

    export function resolveSigma1Params(params: Sigma1Params, stats: ExpandingStats): Sigma1ResolvedParams

`scoreSd = standardDeviation(stats, params.fallbackScoreSd)`, `scoreVariance = scoreSd ** 2`,
the four variance-scaled fields multiplied by `scoreVariance`, `coldStartTeamTotal`
multiplied by `scoreSd`. Import `Sigma1Params` as a TYPE ONLY (`import type`) so this module
has no runtime import edge back to `params.ts` at all — the same acyclicity discipline
`params.ts`'s header records, applied one module further out.

The `Omit` is load-bearing and the header must say so: an internal helper that receives
`Sigma1ResolvedParams` CANNOT read a relative field, because the type does not have one.
That makes "resolve once, at a leak-free point" a fact about the type system rather than a
convention a future edit can quietly break — the same "unconstructible, not merely
unbuilt-by-convention" reasoning `Sigma1ParamsSchema`'s object-level check already uses.

The header must also carry the season-boundary note verbatim in substance (D-T1):
`allianceScoreStats` deliberately carries across seasons and is NOT reset, so a new season
starts scaled by the PREVIOUS season's sigma and converges to its own within a few hundred
matches. That lag is real, leak-free, and ACCEPTED. Resetting it would leave the first
matches of every season with no scale at all, which is strictly worse. A future reader must
not be able to mistake this for an oversight.

**3. `sigma1/index.ts` — wiring.**

Call `resolveSigma1Params(params, state.allianceScoreStats)` ONCE at the top of each public
entry point: `predict`, `update`, `teamMetrics`, `carrySeason`. In `update` it must read
`state.allianceScoreStats`, NOT the post-fold local computed near the end of the function —
that single line's placement is the entire Pitfall EPA-1 guarantee, so put a comment on it
saying exactly that.

In `predict`, the existing `const seasonScoreSd = standardDeviation(state.allianceScoreStats,
params.fallbackScoreSd)` becomes `resolved.scoreSd`. One definition of sigma in the module,
not two.

Every internal helper's `params: Sigma1Params` annotation becomes `params:
Sigma1ResolvedParams`. **The function BODIES do not change** — they already read
`params.processNoiseWithinEvent`, `params.minConsistencyVariance` and so on, and those names
survive on the resolved type. This is the reason for the `Omit` shape: the diff is
annotations plus four resolve calls, not a rewrite. Affected in `index.ts`:
`componentColdStartTotal`, `seedConsistencyFor`, `coldStartTeamState`,
`applyTeamProcessNoise`, `applyAllianceUpdate`, `fallbackObserved`, and the `teamMetrics`
shrink/floor block. Also re-annotate `adaptation.ts`'s `adaptationFactor`, `carryover.ts`'s
`sigma1Carryover` / `sigma1CarryNormalizedRating`, and `rp/state.ts`'s fold entry points.
`consistency.ts` and `covariance.ts` already take plain numbers and need no signature change
— confirm this rather than assuming it.

**4. `rp/state.ts` — the dimensional split.** Its `q` selection reads
`params.rpProcessNoiseWithinEvent` / `params.rpProcessNoiseEventBoundary` instead of the
score-side pair. Add the reasoning at the use site AND in the module header: an RP threshold
variable is a count on a 0-20-ish scale; the score-side noise is now a fraction of an
alliance-score variance that reaches ~20,000 in 2026, and multiplying the two would inject
several hundred times the variable's own range as noise per match. Note the consequence for
future searches: the tuner used to move RP's `q` as a side effect of moving the score side's
and now does not — a real change in what a search explores, and an intended one.

**5. `carryover.ts` — D-T2.** `sigma1CarryNormalizedRating`'s blend becomes
`(1 - share) * lastYear + share * yearBefore`. Rewrite the module header's description of
the blend and the function's own doc comment, both of which name the two retired weights.
The header's D-04 argument (Sigma1 owns a tunable copy so EPA's stays frozen at Statbotics'
published constants) is UNCHANGED and must survive intact — only the blend's shape moved.
**`carryover.ts`'s `epaCarryover` is not touched.** D-04 pins it and the user has explicitly
confirmed EPA stays a clean Statbotics reference.

**6. Doc comments on the retired absolute constants.** `kalman.ts`'s
`SIGMA1_PROCESS_NOISE_WITHIN_EVENT` / `SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY` and
`consistency.ts`'s `SIGMA1_MIN_CONSISTENCY_VARIANCE`, plus `params.ts`'s
`SIGMA1_COLD_START_CONSISTENCY_VARIANCE` and `SIGMA1_COLD_START_TEAM_TOTAL`, are no longer
read on the update path. Keep them — they are the derivation source for the relative
defaults, which is exactly why they must not be deleted — but rewrite each comment to say
that: it is the absolute value the relative default is derived from, at
`SIGMA1_REFERENCE_SCORE_VARIANCE`, and it is no longer the value the filter applies. A
live-looking constant that nothing reads is the next reader's trap; the preceding task's
`ewmaCovariance` comment records the same pattern.

`SIGMA1_COLD_START_CONSISTENCY_VARIANCE`'s "KNOWN STALE since 3.0.0" paragraph is now
partly superseded: the staleness argument stands, but the follow-up it anchors is this
task's re-tune, and the relative bound in Task 4 is widened specifically so that re-tune can
reach the right region. Update the paragraph to say so rather than leaving it pointing at a
closed todo.

**7. `packages/harness/legacyParams.ts` (new) — the migration.**

Lives in `packages/harness`, not `packages/core`: a one-directional migration off a retired
shape is a TOOLING concern, the same argument `searchSpace.ts`'s header makes for search
bounds, and `packages/core` must stay free of anything that is not Worker-importable
prediction logic.

Export `LegacyAbsoluteSigma1ParamsSchema` — a `z.strictObject` describing the FROZEN 3.0.0
shape — and

    migrateAbsoluteToScaleRelative(legacy: LegacyAbsoluteSigma1Params): Sigma1Params

dividing the four variance-scaled fields by `SIGMA1_REFERENCE_SCORE_VARIANCE`, dividing
`coldStartTeamTotal` by its square root, setting `carryPriorYearShare` from the legacy pair,
and copying the legacy absolute process-noise pair into the two new RP fields (F3: this is
what makes RP bitwise unchanged). The header must state that this schema is a HISTORICAL
RECORD and is never to be edited again — it describes a shape that no longer exists, and
changing it would silently change what a migrated file means.

**Carry-weight migration, and the one honest wrinkle.** The legacy pair is unnormalized, so
`share = priorYear / (lastYear + priorYear)` recovers the ratio but LOSES the sum. For the
promoted set the sum is exactly 1.0 (0.7 + 0.3), so the migration is exact and the shipped
model is unchanged. Assert `Math.abs(sum - 1) < 1e-9` and THROW with a message naming the
sum otherwise — a legacy set whose weights did not sum to 1 cannot be migrated without
choosing which of two behaviours to preserve, and this task must not make that choice
silently. Document the throw.

**8. `promote.ts` — `--from-version <path>`.** An alternative to `--from`; exactly one of
the two is required. It reads a committed version file, validates it against a
codeVersion-tolerant read of `PromotedVersionSchema` (params parsed by
`LegacyAbsoluteSigma1ParamsSchema` when the file's `codeVersion` is older than
`SIGMA1_CODE_VERSION`, then migrated), and promotes the result through the SAME replay,
digest and validate-then-write path every other promotion uses. `--set-param` continues to
apply on top, with its existing `--provenance-note` pairing rule unchanged.

Provenance for a `--from-version` promotion: carry `searchArtifact`, `objective`,
`tuneSeasons`, `seed`, `survivors`, `losoSummary` FORWARD from the source file unchanged —
they describe the search that produced the source parameter set, which is still the honest
lineage — and ADD `derivedFromVersion` (the source file's `version` string) and
`paramShapeMigration` (a short machine-readable tag naming the map applied). Set
`objectiveAppliesToPromotedParams: false` UNCONDITIONALLY for any migrated promotion, even
with no `--set-param`: the recorded objective was computed by a different code version on a
differently-shaped parameter set, so it does not describe the shipped set. Extend
`ProvenanceSchema` with the two new fields as OPTIONAL so every already-committed file keeps
validating. Document all of this in `promote.ts`'s header alongside the existing
`--set-param` section, including why `--from` could not be used here (F2: the search
artifact records the retired shape AND does not carry the shipped `linkC`).

**9. `searchSpace.ts` — mechanical only in this task.** Rename the five keys, delete the two
carry-weight entries, add `carryPriorYearShare: { min: 0, max: 1, scale: "linear" }`, and
REBASE every renamed bound into dimensionless units with FRESH prose — a bound divided
through mechanically would keep a justification written about points^2, which is the stale-
comment failure mode this project's log names. Starting points, to be adjusted against the
measured `V_ref` (illustrated at `V_ref` = 1000):

- `processNoiseWithinEventRel: { min: 2e-5, max: 2e-3, scale: "log" }`. The prose should
  record the result that motivates the whole change: expressed as a fraction of variance,
  the per-season optimum spread COLLAPSES from ~16x to ~2x. Using CONTEXT's own table,
  the best relative value per season is roughly 1.6e-4 (2022), 1.0e-4 (2023), 2.0e-4 (2024),
  2.2e-4 (2025), 1.2e-4 (2026) — a bound spanning [2e-5, 2e-3] brackets all five with two
  decades of headroom on each side.
- `processNoiseEventBoundaryRel: { min: 4e-4, max: 6e-2, scale: "log" }`. Note in the prose
  that the currently promoted absolute value (1) sits EXACTLY at the retired bound's `min`
  — an at-bound winner the retired space could not escape downward. The new lower bound is
  set below the promoted value's relative image on purpose.
- `coldStartConsistencyVarianceRel: { min: 4e-3, max: 0.5, scale: "log" }`. The upper bound
  is deliberately generous: `params.ts` records this parameter as KNOWN STALE under the
  innovation-based R, plausibly an order of magnitude too small, so the space must be able
  to reach the region the re-tune needs.
- `minConsistencyVarianceRel: { min: 1e-4, max: 3e-2, scale: "log" }`.

Verify every new default is strictly INTERIOR to its bound — `screenGridFor` throws
otherwise and `searchSpace.test.ts` asserts it. `isValidParamSet`'s predicates get the same
renames and the same RP addition `Sigma1ParamsSchema` did; the two must stay in agreement
and both test files assert that. Deletions from the search space (D-T3) are Task 4's job,
not this one's — do not do them here.

**10. Retire and re-promote, in this commit.**

    # retire (delete) data/algorithm-versions/vpr@3.0.0+tracer-check.json
    # retire (delete) data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json

    pnpm promote --from-version <the retired tracer-check file> --name tracer-check
    pnpm promote --from-version <the retired tuned-2026-08 file> --name tuned-2026-08

Take a copy of both retired files somewhere untracked FIRST — `--from-version` reads them,
and deleting before promoting makes the source unavailable. `git show HEAD:<path>` also
works and is preferable to a copy.

Both promotions write `vpr@4.0.0+*.json`. Expect the `predictionStreamSha256` to MOVE for
both — unlike the 2.1.0 re-promotion, the algorithm genuinely changed here. A digest that
did NOT move would mean the resolved scale never reached the update path, which is a defect,
not a relief: check for it explicitly.

`covShrinkage` stays at its migrated value in this task. D-T3's "fix it" lands in Task 4,
where the change is isolated and its ~0.0005 Brier cost can be attributed to it alone rather
than tangled into the rename's delta.

**11. Repoint every path and identity reference.** Grep `3\.0\.0` and `tuned-2026-08` under
`packages/` and `scripts/` before and after. Known sites: `packages/harness/cli.ts` L134
(and its surrounding version-history comment, which needs a new paragraph, not a number
swap), `packages/harness/manifests.ts` L222, `packages/harness/manifests.test.ts` L28,
`packages/harness/fixtures/extract-digest-slice.ts` L58 (and its L27-L41 measurement notes),
`scripts/measureRewindGap.ts` L415, `packages/harness/promotedOverrides.test.ts` L33-L35 and
the inline strings at L216 and L286. Leave `baselineFingerprint.test.ts`'s assertions alone
— they assert what a COMMITTED HISTORICAL file records, and rewriting them would be
falsifying a measurement record (Task 7 fixes the prose around them).
`scripts/verifyAllianceUncertaintyIdentity.ts` L29 names `minConsistencyVariance` in prose
only; update the name and note it is now a fraction of variance.
  </action>

  <tests>
**Add `packages/core/algorithms/sigma1/scale.test.ts`:**
- **Scale-equivariance (the headline test, and CONTEXT's named verification bar).** Build a
  synthetic multi-match stream with `scoreBreakdownRaw: null` (so the fallback observation
  path runs) and replay it through `makeSigma1` twice: run A at scores `s` with
  `fallbackScoreSd = f`, run B at scores `4*s` with `fallbackScoreSd = 4*f`, both with
  otherwise identical relative parameters. Assert every `pRedWin` is BITWISE equal and every
  predicted score is exactly `4x`. **Use 4, not an arbitrary factor** — a power of two makes
  every intermediate product, sum and quotient exact in IEEE-754, so this is an equality
  assertion rather than a tolerance. Write that reason into the test; a future maintainer
  who "simplifies" it to 1.7 will get a mysterious failure.
- Cold-start scale: `resolveSigma1Params(DEFAULT_SIGMA1_PARAMS, emptyExpandingStats())`
  reports `scoreVariance === fallbackScoreSd ** 2` and each absolute field equals its
  relative value times that — pinning the documented transient at the start of 2022.
- Linear vs squared: fold observations giving a known sigma, then assert
  `coldStartTeamTotal === rel * sigma` (NOT `rel * sigma ** 2`). The two scalings are one
  character apart in the source and this is the test that tells them apart.
- Leak-freeness: resolve from a state, fold one more observation, resolve again — the first
  result is unchanged, and the second differs. (Proves the property; does not restate the
  implementation.)
- Type-level: a helper typed `(p: Sigma1ResolvedParams) => number` cannot read
  `p.processNoiseWithinEventRel`. Assert via a `@ts-expect-error` line, so the `Omit`'s
  guarantee is checked by the compiler in CI rather than believed.

**Add `packages/harness/legacyParams.test.ts`:**
- Round-trip on a REAL fixture: the exact `params` object of the retired
  `vpr@3.0.0+tuned-2026-08.json`, inlined as a literal with a comment naming its provenance
  and stating that the source file is retired by this task (so the fixture cannot rot when
  the file disappears). Assert every migrated field equals `legacy / V_ref` (or its sqrt for
  the linear one) to 1e-12, that `carryPriorYearShare === 0.3`, and that the two RP fields
  carry the legacy absolute process-noise pair unchanged.
- Round-tripping the migrated result back through `SIGMA1_REFERENCE_SCORE_VARIANCE` recovers
  the legacy values to 1e-9.
- Unnormalized carry weights (e.g. 0.6/0.3) THROW, and the message names the sum.
- The migrated set parses through `Sigma1ParamsSchema`, so an invariant-violating legacy set
  cannot be migrated into a valid-looking one.
- An unknown key in a legacy record is rejected by the frozen strict schema.

**Extend `packages/core/algorithms/sigma1/carryover.test.ts`** (CONTEXT's named bar): at
`carryPriorYearShare = 0.3`, `sigma1Carryover` reproduces the retired
`0.7 * lastYear + 0.3 * yearBefore` blend EXACTLY — hand-compute the expected blended value
for two or three teams from the two normalized inputs and assert to the last bit, rather
than comparing against a re-implementation of the same formula (which would pass even if
both were wrong). Keep the existing assertion that a default-params call and an
`epaCarryover` call read the same numbers where they still should, and adjust its comment
to name the share rather than the two weights.

**Extend `packages/core/algorithms/sigma1/params.test.ts`:** the two carry weights are gone
from `SIGMA1_PARAM_KEYS`; `carryPriorYearShare` and the two RP fields are present; the five
renamed keys are present under their new names and ABSENT under the old ones (a negative
assertion, so a partial rename fails loudly); `Sigma1ParamsSchema` and `isValidParamSet`
still agree on every invariant including the new RP ordering; each relative default equals
its source constant divided by the reference (pinning the "derived, never re-typed" rule as
a test).

**Triage rule for `sigma1.test.ts` — read before editing anything there.**
- **Expect to recompute, and say why in the comment.** Any test that constructs a
  `Sigma1State` literal with an empty `allianceScoreStats` and asserts an exact
  post-`update` number or an exact variance floor: those states now resolve to a scale of
  `fallbackScoreSd ** 2` = 625, so `minConsistencyVariance` is `rel * 625` rather than the
  retired absolute 1. Recompute each from the resolved scale and update the surrounding
  comment to name the quantity it is derived from. **Do NOT loosen an exact assertion to a
  wide `toBeCloseTo` to make it pass** — that converts a contract into a shrug.
- **MUST stay green, unedited.** Every RELATIONAL assertion: the additivity identity and its
  non-vacuity control, the floor-errs-wide check, the per-component and phase-group tests,
  "a fallback shrinks variance less", "an event boundary applies more process noise",
  determinism, "three link modes share one update path", and the DQ / demo / eventType /
  malformed-breakdown blocks. These state relationships, not magnitudes, and every one of
  them survives a uniform rescaling. **A red in any of them is a bug in this change, not an
  outdated contract** — in particular a red in the additivity identity means the P/R
  composition in `teamMetrics` was disturbed, which this task must not do.
- `innovationVariance.test.ts`'s synthetic-recovery test asserts a MEDIAN spread against a
  known true sigma of 12 within a documented tolerance. It builds its own synthetic league,
  so its `allianceScoreStats` is whatever that league produces — expect the recovered median
  to move somewhat and the negative control (the retired estimator running >=3x small) to
  hold unchanged. If the recovery test fails, recompute the tolerance from the fixture's own
  realized scale and record the new number with its derivation; if the NEGATIVE CONTROL
  fails, stop — that means the innovation-based estimator itself was disturbed.

**Expected red until the re-promotion runs, and not separate failures:**
`digest.test.ts`, `promotedOverrides.test.ts`, `manifests.test.ts`. This is the "same
commit" coupling the ordering section describes.

**Extend `promoteOverride.test.ts`:** `--from-version` provenance carries
`derivedFromVersion` and `paramShapeMigration` and sets
`objectiveAppliesToPromotedParams: false` even with no `--set-param`; passing both `--from`
and `--from-version` throws; passing neither throws.
  </tests>

  <verify>
    <automated>pnpm typecheck</automated>
    <automated>pnpm vitest run packages/core/algorithms/sigma1</automated>
    <automated>pnpm vitest run packages/harness/legacyParams.test.ts packages/harness/promoteOverride.test.ts packages/harness/searchSpace.test.ts</automated>
    <automated>pnpm vitest run packages/harness/digest.test.ts packages/harness/promotedOverrides.test.ts packages/harness/manifests.test.ts</automated>
  </verify>

  <done>
Five parameters are dimensionless and one carry share replaces two weights. `scale.ts`
resolves them once per entry point from `state.allianceScoreStats`, and the `Omit` makes a
relative read impossible inside a helper — asserted by a `@ts-expect-error` line. The
scale-equivariance test passes BITWISE at a factor of 4. RP reads its own versioned absolute
pair with the dimensional argument recorded at the use site. `carryPriorYearShare = 0.3`
reproduces the retired blend exactly. `SIGMA1_CODE_VERSION` is `4.0.0`; both 3.0.0 files are
deleted and both `vpr@4.0.0+*.json` files were written by `pnpm promote --from-version` in
this commit, each carrying `derivedFromVersion`, `paramShapeMigration`, and
`objectiveAppliesToPromotedParams: false`. Both digests MOVED. Every `3.0.0` path reference
is repointed. No `as Sigma1Params` cast was added. Suite green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: D-T3 — search-space pruning, enforced rather than conventional</name>
  <files>packages/harness/searchSpace.ts, packages/harness/searchSpace.test.ts, packages/harness/tune.ts, packages/core/algorithms/sigma1/covariance.ts, data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json</files>
  <precondition>Task 3 is committed: the renamed keys exist and both `vpr@4.0.0+*.json` files are present.</precondition>

  <behavior>
- `SEARCH_EXCLUSIONS` and `SIGMA1_SEARCH_SPACE` partition `SIGMA1_PARAM_KEYS` exactly: no
  key in both, no key in neither. A newly added `Sigma1Params` field that lands in neither
  fails a test that names the field.
- `screenGridFor` throws for an excluded key, naming the key and quoting its exclusion
  reason.
- `loadSurvivors` rejects a survivors file that names an excluded key, quoting the reason
  rather than only saying the key is not searchable.
- Every exclusion reason is a real sentence, not a placeholder.
  </behavior>

  <action>
D-T3's own wording is the requirement: `searchSpace.ts` must express the exclusions
EXPLICITLY, as a named list with reasons, "not by omission — a future reader must not be
able to re-add them by accident."

Replace the current `SearchableParamKey = Exclude<keyof Sigma1Params, "rpMonteCarloSeed" |
"rpMonteCarloDraws" | "adaptationEnabled">` with a data-first construction:

    export const SEARCH_EXCLUSIONS = { ... } as const satisfies Partial<Record<keyof Sigma1Params, string>>;
    export type ExcludedParamKey = keyof typeof SEARCH_EXCLUSIONS;
    export type SearchableParamKey = Exclude<keyof Sigma1Params, ExcludedParamKey>;

The eight entries and their reasons, each written out in full in the source (paraphrased
here):

- `covShrinkage` — a numerical safeguard, not a modelling knob. It keeps the covariance
  matrix positive semi-definite for the group-spread quadratic form. The sensitivity
  screen's optimum sat at the 0 bound, i.e. the search wanted to DELETE the guarantee to buy
  about 0.0005 Brier. Tuning a safeguard against the objective it protects is a category
  error. Fixed, not tuned.
- `coldStartTeamTotalRel` — inert by construction: it applies only before ANY league data
  exists at all, and the live league average takes over the instant any team anywhere has
  been observed.
- `fallbackScoreSd` — inert by construction: the `count < 2` bootstrap for sigma itself.
- `rpMonteCarloSeed` — tuning a random seed optimizes the realization, not the model.
- `rpMonteCarloDraws` — a compute/precision tradeoff, set by a convergence check.
- `rpProcessNoiseWithinEvent`, `rpProcessNoiseEventBoundary` — the D-01 objective (Brier
  over predicted win probability) is structurally blind to the RP pmf, so searching them
  spends budget on a dimension the objective cannot see. The same argument the two
  Monte Carlo fields already carry.
- `adaptationEnabled` — a MODE, not a numeric knob (D-06 / D-T4): searched as two
  independent optimizer runs, never as a dimension inside one run.

Delete `covShrinkage`, `coldStartTeamTotalRel` and `fallbackScoreSd` from
`SIGMA1_SEARCH_SPACE`. That leaves 16 searchable keys.

`screenGridFor` gains an early runtime guard for an excluded key even though the type
already forbids it — `loadSurvivors` reads STRINGS out of a JSON file, so the type system is
not the only entry path. The guard's message quotes the exclusion reason, so a stale
survivors artifact from before this change explains itself instead of just failing.

`loadSurvivors` in `tune.ts` already rejects a non-`SEARCHABLE_PARAM_KEYS` member; extend
its message to check `SEARCH_EXCLUSIONS` first and quote the reason.

**Apply the `covShrinkage` fix to the shipped set, in this commit and isolated to it.**
D-T3 says "Fix it", and the shipped `vpr@4.0.0+tuned-2026-08` still carries the tuned
0.12817359956447036. Re-promote once more, using the mechanism that exists for exactly this:

    pnpm promote --from-version <the vpr@4.0.0+tuned-2026-08.json committed by Task 3> \
      --name tuned-2026-08 \
      --set-param covShrinkage=0.3 \
      --provenance-note "covShrinkage restored to its documented constant (D-T3, quick task 260901-trz): it is the PSD safeguard for the group-spread quadratic form, not a modelling knob, and the sensitivity screen's optimum sat at the 0 bound -- the search was trading the guarantee for roughly 0.0005 Brier. It is now excluded from the search space by SEARCH_EXCLUSIONS, so this value is fixed rather than tuned. Every OTHER parameter in this set was searched under the retired absolute parameterization and is stale pending the rolling-origin re-tune."

Read the file back and confirm `covShrinkage` is 0.3 and the `predictionStreamSha256` moved.
Note the file writes back to the SAME `vpr@4.0.0+tuned-2026-08.json` path, so no reference
repointing is needed. `tracer-check` is a fixed reference set and takes no override — check
whether it already carries the documented constant and say so in the SUMMARY either way.

**Documentation.** `covariance.ts`'s header explains the PSD reasoning behind `covShrinkage`
as the justification for a TUNABLE value. Rewrite it: the PSD reasoning is unchanged and
still correct, but the parameter is now FIXED, and the header must say why (the screen
result above), so a future reader does not restore it to the search space believing the
omission was an oversight. This is a specific instruction in the task brief, not a
housekeeping note.
  </action>

  <tests>
**Extend `packages/harness/searchSpace.test.ts`:**
- **The partition test (the enforcement).** `Object.keys(SEARCH_EXCLUSIONS)` and
  `Object.keys(SIGMA1_SEARCH_SPACE)` are disjoint, and their union sorted equals
  `SIGMA1_PARAM_KEYS`. Assert with a message that NAMES the offending keys on failure
  (compute the two set differences and interpolate them), so a future parameter added to
  `Sigma1Params` and forgotten here produces "processNoiseFoo is in neither
  SIGMA1_SEARCH_SPACE nor SEARCH_EXCLUSIONS" rather than an opaque length mismatch. This one
  test is what makes the exclusion enforced rather than conventional.
- Every exclusion reason is at least 40 characters — a reason, not a shrug.
- `screenGridFor` throws for each excluded key, and the message contains that key's own
  reason text.
- `SEARCHABLE_PARAM_KEYS` has 16 members and preserves `SIGMA1_PARAM_KEYS`' sorted order.
- The three deleted keys are absent from `SIGMA1_SEARCH_SPACE`, asserted BY NAME — so
  re-adding one turns this test red with a message that says which.
- Every surviving default is still strictly interior to its own bound (the existing
  assertion; confirm it still passes after Task 3's rebasing).

**Extend `packages/harness/tune.test.ts`:** `loadSurvivors` on a fixture naming an excluded
key throws with the reason quoted; on a fixture naming a genuinely unknown key it still
throws the pre-existing message. Two distinct failures, two distinct messages.

**Must stay green:** `digest.test.ts` (after the re-promotion), `promoteOverride.test.ts`,
`params.test.ts`.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/harness/searchSpace.test.ts packages/harness/tune.test.ts</automated>
    <automated>pnpm vitest run packages/harness/digest.test.ts packages/core/algorithms/sigma1/params.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`SEARCH_EXCLUSIONS` is a named, reasoned, tested list that partitions `SIGMA1_PARAM_KEYS`
with `SIGMA1_SEARCH_SPACE`; a parameter in neither fails a test that names it. Sixteen keys
remain searchable. `screenGridFor` and `loadSurvivors` both refuse an excluded key by name
and quote its reason. The shipped `vpr@4.0.0+tuned-2026-08` carries `covShrinkage: 0.3` with
a provenance note, promoted by `pnpm promote`, digest moved. `covariance.ts`'s header says
the parameter is fixed and why.
  </done>
</task>

<task type="auto">
  <name>Task 5: D-T5 — rolling-origin selection replaces the fixed split in the tuner</name>
  <files>packages/harness/tune.ts, packages/harness/tune.test.ts</files>
  <precondition>Task 4 is committed. This task changes control flow only; it does not run a search.</precondition>

  <action>
D-T5 changes the tuner's CONTROL FLOW, not just its data selection: the search now runs once
per origin. Be honest about what that costs before writing it.

**Cost, from the measured corpus.** One candidate's replay is ~1 ms/match with
`rpMonteCarloDraws: 0` (this file's own runtime assumption), and batching amortizes the
stream build but not the per-candidate compute:

| origin (scored) | selection seasons | matches | one candidate |
|---|---|---|---|
| 2024 | 2022-2023 | 31,030 | ~31 s |
| 2025 | 2022-2024 | 48,059 | ~48 s |
| 2026 | 2022-2025 | 65,936 | ~66 s |

A joint run at today's default `--evals 60` plus coordinate descent over ~12 survivors is
~84 evaluations. Per adaptation arm that is ~43 / ~67 / ~92 min for the three origins;
across three origins and D-T4's two arms, **about 6.7 hours sequential**. Adding a
per-origin sensitivity screen (16 keys x 5 values = 80 evaluations) would add ~4 hours more.
Over ten hours of single-threaded replay is not something to schedule by accident.

**So the runner is designed lean, and the plan says so up front:**

1. **The screen runs ONCE, at the EARLIEST origin's selection window (2022-2023) — and this
   is a correctness argument, not a shortcut.** Survivor selection IS hyperparameter
   selection, so it must obey the same rule. 2022-2023 is strictly prior to 2024, 2025 AND
   2026, so a survivor set chosen there is leak-free for all three origins simultaneously.
   Three screens would be three times the cost for no additional discipline. ~41 min, once.
2. **`--evals 40` per origin instead of 60.** The acceptance bar moves with N as
   `sqrt(2 ln N)`: 60 -> 40 moves it from ~0.003488 to ~0.003310, a 5% relaxation for a 33%
   compute saving. State that tradeoff in the runner's own console output so the operator
   sees what the budget bought.
3. **The six runs (3 origins x 2 adaptation arms) are INDEPENDENT PROCESSES and should be
   run concurrently.** `openCorpusReadOnly` permits concurrent readers. Wall clock then
   collapses to the largest single run, ~70 min, rather than ~5 hours. Recommend `--batch 4`
   rather than the default 8 for concurrent runs: `runBoundedSeasons` accumulates every
   prediction for a whole batch across every selection season, which at batch 8 on the 2026
   origin is over half a million objects per process.

**Do not run any of this.** Task 7 files the compute job with these figures attached.

**The control-flow change.**

Add `--origin <season>` to the joint stage. When present it REPLACES `--seasons`: the
selection seasons are derived as every corpus season strictly less than the origin, and
passing both is an error (two sources of truth for the same question). Emit one artifact per
origin, defaulting to `reports/tune-joint-{adaptation}-origin{season}.json`.

**The three structural blindness gates SURVIVE — they change predicate, they are not
deleted.** This is the single edit in this plan that can silently re-open leakage, so it
gets its own paragraph in the file header:

- Gate 1 (pre-corpus): every selection season is strictly less than `originSeason`.
- Gate 2 (an INDEPENDENT code path, per T-03-07's "one gate is a convention"): recompute
  `Math.max(...selectionSeasons)` and re-assert it is below `originSeason`. Two paths so a
  bug in either cannot silently disable the other, exactly as today.
- Gate 3 (post-scoring): rename `assertNoHoldoutLeak` to
  `assertNoFutureSeasonLeak(slices, originSeason)` and change its predicate from
  `seasonLabel !== "tune"` to `season >= originSeason`. Keep it exported so `tune.test.ts`
  can still assert it throws without a corpus replay. Delete the old name — leaving both
  would let a call site keep the retired check by accident.
- Gate 4 (NEW, structural): the origin season is never read during selection at all. The
  winner is chosen from selection seasons only and **written to the artifact BEFORE any
  origin-season evaluation runs** (Task 6 adds that evaluation). Committing the winner to
  disk first is what makes it structurally impossible for the out-of-sample result to feed
  back into the choice. State this as the reason for the write ordering, so a later
  refactor that "tidies up" by moving the write to the end knows what it is removing.

`TUNE_SEASONS` and `HOLDOUT_SEASONS` stay in `score.ts` — other callers and every committed
artifact read them (D-T5 says so explicitly) — but **`tune.ts` stops importing them**.
`seasonSplit` is still called inside `aggregateScores`, which is fine and unchanged; what
must go is the tuner's own dependence on the fixed split.

**Delete `computeLoso` and `LosoFold`.** Rolling origin supersedes leave-one-season-out as
the overfitting guard — LOSO re-sliced a POOLED selection over a fixed set of three seasons,
which is exactly the construct D-T5 removes. Dead code that describes a retired discipline
is the failure mode this project's log names, so delete rather than gate. Replace the
artifact's `loso` field with `overfittingGuard: "rolling-origin (D-T5)"` and record the
origin and its selection seasons at the top level. `ProvenanceSchema.losoSummary` STAYS in
`promote.ts` (optional) — it is how already-promoted files describe how THEY were selected,
and removing it would invalidate a historical record.

**Rewrite `tune.ts`'s header.** Its "Holdout blindness is STRUCTURAL" section describes the
fixed split in detail and is now wrong in its central claim. The replacement states the
rolling-origin rule, why it is the same discipline the module-level predict-before-update
sequencing already enforces one level up (D-T5's own framing: this is the one place that
discipline currently does not reach), that the origin season is scored but never selected
on, and the four gates.
  </action>

  <tests>
**Extend `packages/harness/tune.test.ts`** — all pure, no corpus:
- `assertNoFutureSeasonLeak` throws for a slice at the origin season and for one after it;
  passes for slices strictly before. The old name is gone (assert the export is absent, so a
  stale import fails at the test rather than silently resolving).
- Selection-season derivation: origin 2024 gives [2022, 2023]; origin 2025 gives
  [2022, 2023, 2024]; origin 2026 gives [2022, 2023, 2024, 2025].
- Origin 2022 (no prior season) throws with a message naming the empty selection window —
  the leanest correct behaviour, since there is nothing to select on.
- Passing both `--origin` and `--seasons` throws.
- Gate 1 and gate 2 each fire independently: construct an input that defeats one and assert
  the other still throws. If a single fix silences both, they are not two paths.
- `planJointCandidates` is unchanged by this task — assert its existing behaviour still
  holds (empty / singleton / random branches, candidate 0 is always the exact defaults,
  seeded reproducibility).
- The artifact shape carries `origin`, `selectionSeasons` and `overfittingGuard`, and no
  `loso` key.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/harness/tune.test.ts</automated>
    <automated>pnpm vitest run packages/harness/promote.ts packages/harness/digest.test.ts packages/harness/promotedOverrides.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`tune.ts` takes `--origin`, derives selection seasons as strictly-prior only, and emits one
artifact per origin. Four gates: two independent pre-corpus checks, a renamed post-scoring
check, and the write-winner-before-evaluating ordering. `TUNE_SEASONS`/`HOLDOUT_SEASONS` are
no longer imported by the tuner and still exported by `score.ts`. `computeLoso` is deleted
and the artifact records `overfittingGuard` instead. The header describes rolling origin,
and the measured per-origin cost table and the lean run shape (one screen, `--evals 40`, six
concurrent processes at `--batch 4`) are recorded in it. No search was run.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: D-T6/D-T7 — the out-of-sample evaluation and the pre-committed acceptance rule, wired in</name>
  <files>packages/harness/tune.ts, packages/harness/tune.test.ts</files>
  <precondition>Tasks 1 and 5 are committed: `eventBootstrap.ts` / `acceptance.ts` exist and the tuner runs per origin.</precondition>

  <behavior>
- After the winner is written, the tuner evaluates BOTH the winner and the incumbent on the
  origin season and reports the acceptance decision with `evaluationCount`, `threshold`, the
  paired event-blocked SEs, and the MAE delta.
- A run where nothing clears the bar exits 0 and its artifact records
  `decision: "keep-incumbent"` with the binding reason. The console says so in one plain
  sentence.
- The incumbent's parameters come from the committed promoted version file, not from
  `DEFAULT_SIGMA1_PARAMS` — the bar is against what ships.
  </behavior>

  <action>
Task 5 made the tuner select per origin. This task makes it DECIDE, using the machinery
Task 1 built. It is a separate commit because it changes what the run means, not how it
iterates.

**The evaluation phase.** After the winner is chosen and written (gate 4's ordering — do not
disturb it), replay exactly two candidates over the ORIGIN season alone: the winner, and the
incumbent read from `data/algorithm-versions/vpr@{SIGMA1_CODE_VERSION}+tuned-2026-08.json`.
Both go through one `evaluateCandidateBatch` call, so they see a single shared stream and
identical matches — which is what makes the PAIRED bootstrap valid. Cost is ~2 x 18 s per
origin: negligible against the search, so there is no reason to approximate it.

The incumbent is read from the committed version file, never from `DEFAULT_SIGMA1_PARAMS`.
The bar is "beats what ships", and the shipped set is not the defaults (Finding F1). Fail
loudly if the file is missing rather than silently substituting defaults.

**The statistics.** Collect per-match Brier contributions and per-match absolute score errors
for both candidates over the origin season, each carrying its `eventKey` (Task 1's addition).
Then:

- `brierDeltaSe = eventBlockedBootstrap(units, sample => mean(candidateBrier - incumbentBrier))`
  — the PAIRED difference, resampling events once and scoring both models on the same draw.
- `maeDeltaSe` the same way over the score errors.
- Also compute and report the LEVEL SE of the winner's Brier, so the artifact carries the
  quantity CONTEXT's 0.001219 figure is comparable to. Reporting both costs one extra call
  and prevents a later reader comparing a paired SE against a level one.

Note the paired-vs-level distinction in the artifact's own field names, not only in a
comment — `brierDeltaStandardError` and `brierLevelStandardError` cannot be confused with
each other at a glance the way two fields both called `se` could.

**The decision.** Call `decideAcceptance` with `evaluationCount` = the number of candidates
actually EVALUATED in this origin's search (random draws plus coordinate-descent neighbours,
excluding rejected-and-resampled draws that were never scored). That count is what the union
bound is over; using the requested `--evals` instead would understate it whenever refinement
added candidates. Record it in the artifact next to the threshold it produced — D-T7 requires
it, because the bar moves with it.

**Reporting `keep-incumbent` as success.** The artifact records the full outcome object. The
console prints one plain sentence for each case, for example: the search evaluated N
candidates, the best beat the incumbent by X, the bar at N was Y, and so the incumbent
stands. The process exits 0. Add a comment at the exit path stating that a non-zero exit or
a retry loop on this outcome would defeat the point of a pre-committed bar — this is the
place a future operator is most likely to "fix" it.

**MAE guardrail wiring.** Pass incumbent and candidate MAE plus `maeDeltaSe` into
`decideAcceptance`; it applies D-T7's veto. Report the veto's two bounds alongside the
observed delta so a near-miss is legible rather than a bare boolean. The veto is over
ELIGIBILITY: a vetoed candidate is not the winner, and the reported reason names the veto
rather than the (cleared) Brier bar.

**D-T4's arms.** Nothing new to implement — `--adaptation on|off` already exists and
`adaptationEnabled` is already excluded from the searchable set (Task 4 made that explicit).
What this task adds is the comparison shape: the two arms produce two artifacts per origin,
and adaptation ships only if its arm's winner clears the D-T7 bar against the incumbent
out-of-sample. Record that rule in the tuner's header next to the acceptance section, citing
D-T4's measured -0.0015 and its caveat that the figure was inflated by having selected its
sub-parameters on holdout.
  </action>

  <tests>
**Extend `packages/harness/tune.test.ts`** — pure, no corpus (the acceptance and bootstrap
functions are already unit-tested in Task 1; what is tested here is the WIRING):
- The evaluation-count derivation: a fixture with 40 random draws, 6 rejected-and-resampled,
  and 18 refinement candidates yields 58, not 40 and not 64.
- Building the paired per-match unit list from two candidates' predictions pairs them by
  `matchKey` and throws if the two lists differ in length or in match set — an unpaired
  comparison would silently produce a meaningless SE, and this is the assertion that stops
  it.
- The console/artifact shape for each of the three outcomes (`accept`,
  `keep-incumbent`/`below-threshold`, `keep-incumbent`/`mae-veto`) — assert the artifact
  carries `evaluationCount`, `threshold`, both SE fields under their distinct names, and the
  binding reason.
- A missing incumbent version file throws by name rather than defaulting.

**Must stay green:** everything from Task 5's tune tests, `acceptance.test.ts`,
`eventBootstrap.test.ts`.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/harness/tune.test.ts packages/harness/acceptance.test.ts packages/harness/eventBootstrap.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
The tuner evaluates winner and incumbent on the origin season through one shared stream,
computes paired event-blocked SEs for both Brier and score MAE, and applies
`decideAcceptance`. The artifact carries the decision, `evaluationCount`, the threshold, both
SE fields under distinct names, and the binding reason. `keep-incumbent` exits 0 and reads as
a result. The incumbent comes from the committed promoted file. No search was run.
  </done>
</task>

<task type="auto">
  <name>Task 7: the AFTER measurement, the documentation sweep, the deferred follow-ups, and whole-suite verification</name>
  <files>docs/models/sigma1-reparameterization.md, .planning/todos/pending/, packages/harness/baselineFingerprint.test.ts, packages/core/algorithms/sigma1/params.ts</files>
  <precondition>Tasks 1-6 are committed. `data/corpus.sqlite` exists. `docs/models/sigma1-reparameterization.md` carries the BEFORE table from Task 2.</precondition>

  <action>
**1. Take the AFTER reading, and answer the question this whole task is judged by.**

Three measurements, all with `scripts/reparamEquivalence.ts --mode measure`:

    # (a) rename-only: the Task 3 commit's promoted set, covShrinkage still at its tuned value
    pnpm reparam:equivalence --mode measure --params <the vpr@4.0.0+tuned-2026-08.json as committed by Task 3, via git show> --seasons 2022,2023,2024,2025,2026 --out reports/reparam-after-rename-only.json

    # (b) shipped: the current file, covShrinkage fixed at 0.3
    pnpm reparam:equivalence --mode measure --params data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json --seasons 2022,2023,2024,2025,2026 --out reports/reparam-after-shipped.json

Fill in `docs/models/sigma1-reparameterization.md`'s AFTER section with both, per season:
Brier +/- event-blocked SE, score MAE, bias, and the delta against Task 2's BEFORE table.

Then state the verdict explicitly, in the document:

- **Gates A-C apply to (a), on the TUNE seasons only.** `abs(dBrier) <= 0.0024`,
  `abs(dMAE) <= 2%` relative, `abs(dbias) <= 1.0` point, per season and pooled. Report each
  gate as passed or failed with its measured value next to its bound. A table where the
  bound and the measurement sit side by side is the artifact; a sentence saying "within
  tolerance" is not.
- **The (b) minus (a) delta is the `covShrinkage` fix, isolated.** CONTEXT estimates ~0.0005
  Brier. Report it and say whether it landed there. It is a deliberate deviation, named as
  one, and it is NOT permitted to be folded into the reparameterization's own delta.
- **2025 and 2026 are reported, never gated.** Expect MAE to fall toward the retired
  estimator's figures (2025 ~19.8 from 21.14, 2026 ~50.6 from 58.53) and bias to fall toward
  ~+4-5 from +9.10 / +25.89. Say plainly whether it did. This is the measured problem D-T1
  exists to fix, so a null result here is the most important finding this task could produce
  and must not be buried.

**If a gate fails, do not loosen it and do not ship past it.** Record the failure, state the
most likely cause (a mis-measured `SIGMA1_REFERENCE_SCORE_VARIANCE` — check the DQ exclusion
and that the fold is not reset at a season boundary), and stop for a decision. The document
is the deliverable either way: a recorded failure is a result, a quietly widened bound is
not.

**2. The retired-behaviour sweep.** Every module in this task carries dense doc comments
citing decision IDs; a comment describing behaviour that no longer exists is the specific
failure mode this project's log names. Grep for the retired names and confirm each surviving
hit is either a deliberate, clearly-marked historical reference or a still-correct statement:

    grep -rn "carryLastYearWeight\|carryPriorYearWeight\|processNoiseWithinEvent\b\|processNoiseEventBoundary\b\|minConsistencyVariance\b\|coldStartConsistencyVariance\b\|coldStartTeamTotal\b\|assertNoHoldoutLeak\|computeLoso\|LosoFold" packages/ scripts/ --include=*.ts

Every hit must be one of: a `Sigma1ResolvedParams` field (the resolved absolute names are
correct and current), an `rpProcessNoise*` field, a version-bump comment describing history,
`legacyParams.ts`'s frozen schema, or `promote.ts`'s `losoSummary` (a historical provenance
field). Anything else is stale and gets fixed here.

Specifically confirm, one by one, that these read as current: `params.ts`'s header and its
`SIGMA1_REFERENCE_SCORE_VARIANCE` ownership note; `kalman.ts`'s two constants;
`consistency.ts`'s three-variance header (its top-failure-mode framing now has a FOURTH
quantity to keep apart — the SCALE the other three are expressed relative to — and should
say so); `covariance.ts`'s `covShrinkage` reasoning (fixed, not tuned); `carryover.ts`'s
blend description; `scale.ts`'s season-boundary lag note; and `tune.ts`'s rolling-origin
header.

**3. D-T4's documentation.** `params.ts`'s `adaptationEnabled` doc comment currently
explains why the field is excluded from the screen. Add D-T4's measurement and its caveat:
adaptation beat off in every arm and still added -0.0015 Brier on top of 16x process noise
(holdout 0.153558 -> 0.152054), so it is NOT merely a proxy for process noise — but its
winning sub-parameters were selected by looking at holdout, which inflates that figure. It
enters the re-tune as two independent optimizer runs and ships only if it wins out-of-sample
under the D-T7 bar. It is NOT enabled by this task.

**4. Fix the one piece of prose the version bump makes false.**
`baselineFingerprint.test.ts` records a committed historical fingerprint at
opr `3.0.0+baseline` / epa `1.1.0+baseline` / vpr `2.1.0+tuned-2026-08`, with prose around it
calling those "current". They were already historical before this task and are now two
versions behind. Update the title and the doc comment to say the fingerprint records the
versions it was MEASURED under, and cross-reference the re-measure todo. **Leave the
assertions themselves exactly as they are** — they assert what a committed historical file
contains, and rewriting them would be falsifying a measurement record.

**5. File the deferred follow-ups** as `.planning/todos/pending/*.md`, matching the existing
format in that directory. Each names what changed, what is now stale, and what "done" looks
like:

1. `retune-sigma1-rolling-origin.md` — THE compute job. Include Task 5's cost table, the
   lean run shape (one screen at the earliest origin; `--evals 40`; six concurrent processes
   at `--batch 4`; ~70 min wall clock), the exact command lines for the screen and the six
   joint runs, and the D-T7 acceptance rule that decides what gets promoted. Note that a
   run where nothing clears the bar is a completed job, not a failed one. Note also that
   `coldStartConsistencyVarianceRel`'s widened upper bound exists specifically so this
   re-tune can reach the region the innovation-based R needs, closing the KNOWN STALE anchor
   `params.ts` has carried since 3.0.0.
2. `regenerate-published-artifacts-post-trz.md` — supersede or cross-reference the existing
   `regenerate-published-artifacts-post-is2.md`: vpr is now `4.0.0+tuned-2026-08` and the
   R2 artifacts are two model versions stale. Record that the republish must wait for the
   re-tune, since republishing twice in a week is wasted work — and that until it happens
   the live site still serves the pre-is2 model.
3. `rp-process-noise-own-scale.md` — F3's deferred alternative: RP's threshold-variable
   process noise is pinned absolute, but the principled form scales each variable by its own
   `rpVariableMean` SD. Doing so changes RP dynamics, which this task had no mandate to do.
   Name the two new parameters this would retire.
4. `remeasure-baseline-fingerprint-post-trz.md` — the offseason-inclusive fingerprint records
   pre-is2 versions for all three algorithms and needs re-measuring under opr 4.0.0 /
   epa 2.0.0 / vpr 4.0.0.

**6. Whole-suite verification.** This is the first point at which all seven decisions, the
version bump, and both re-promoted version files coexist.
  </action>

  <tests>
No new tests. This task's verification IS the full suite plus the recorded measurement.
  </tests>

  <verify>
    <automated>pnpm reparam:equivalence --mode measure --params data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json --seasons 2022,2023,2024,2025,2026 --out reports/reparam-after-shipped.json</automated>
    <automated>pnpm vitest run</automated>
    <automated>pnpm typecheck</automated>
    <automated>git status --porcelain -- apps/web</automated>
  </verify>

  <done>
`docs/models/sigma1-reparameterization.md` carries BEFORE and AFTER tables for all five
seasons, each gate reported with its measured value beside its bound, the `covShrinkage`
delta isolated from the rename delta, and an explicit statement of whether the 2025/2026 MAE
regression was recovered. The retired-behaviour grep is clean or every surviving hit is a
marked historical reference. `adaptationEnabled`'s comment carries D-T4's measurement and
its holdout caveat. `baselineFingerprint.test.ts`'s prose describes a historical record with
its assertions untouched. Four todos filed. Full `pnpm vitest run` green, read from its
output (test-file and test counts present, not an exit code). `git status -- apps/web` is
empty.
  </done>
</task>

</tasks>

<verification>
Read every command's OUTPUT; an exit code alone proves nothing here.

1. `pnpm vitest run` — whole suite green at the end of Task 7, and green at every
   intermediate commit boundary (each task's own `<verify>` block is the narrower gate).
2. `pnpm typecheck` — clean. In Task 3 it is also the work list: after the rename it
   enumerates every consumer, and each is re-annotated rather than cast.
3. `ls data/algorithm-versions/` shows exactly `vpr@4.0.0+tracer-check.json` and
   `vpr@4.0.0+tuned-2026-08.json`; both `3.0.0` files are gone.
4. `grep -rn "3\.0\.0" packages/ scripts/ --include=*.ts` returns only historical references
   inside version-bump comments, `legacyParams.ts`'s frozen schema, opr's own unrelated
   version history, and the baseline-fingerprint record — no live path and no live pin.
5. Task 7's retired-behaviour grep is clean or every hit is a marked historical reference.
6. `git log --oneline` shows seven commits, one per task, each self-contained.
7. `git status --porcelain -- apps/web` is empty.
8. No hyperparameter search was run. `reports/tune-joint-*-origin*.json` does not exist.
</verification>

<success_criteria>
- D-T1: five parameters are dimensionless fractions of the season's alliance-score variance,
  resolved once per entry point from `state.allianceScoreStats`; the scale-equivariance test
  passes bitwise at a factor of 4; `fallbackScoreSd` stayed absolute at 25; RP's process
  noise is dimensionally separate and bitwise unchanged.
- D-T2: one `carryPriorYearShare` replaces two unnormalized weights, reproducing 0.7/0.3
  exactly at 0.3; `carryMeanReversion` is the sole shrinkage control; EPA's `epaCarryover`
  is untouched.
- D-T3: `SEARCH_EXCLUSIONS` partitions `SIGMA1_PARAM_KEYS` with `SIGMA1_SEARCH_SPACE`, with
  a reason per exclusion and a test that names a key placed in neither; `covShrinkage` is
  fixed at its documented constant in the shipped set.
- D-T4: adaptation is neither deleted nor enabled; the two-arm comparison shape and its
  measured figure with its holdout caveat are recorded.
- D-T5: the tuner selects on strictly-prior seasons per origin, with four gates, and no
  longer imports the fixed split; LOSO is deleted; the per-origin cost and the lean run
  shape are recorded rather than assumed.
- D-T6: one exported event-blocked bootstrap, validated against a known-dependence fixture
  with an analytic answer and a match-level negative control.
- D-T7: the bar is `sqrt(2 ln N) x SE`, N is recorded beside it, the score-MAE guardrail is
  a veto over eligibility, and `keep-incumbent` is a normal outcome that exits 0.
- The reparameterization is MEASURED against four stated gates on the tune seasons, with the
  `covShrinkage` deviation isolated and the 2025/2026 recovery reported.
- D-13: `SIGMA1_CODE_VERSION` 4.0.0 in the same commit as the shape change; every committed
  digest produced by `pnpm promote` running the final code; no digest hand-edited anywhere.
- No doc comment describes retired behaviour.
</success_criteria>

<output>
Create `.planning/quick/260901-trz-scale-relative-reparameterization-and-ro/SUMMARY.md` when
done, recording: the seven commit SHAs; the measured `SIGMA1_REFERENCE_SCORE_VARIANCE` with
its per-season breakdown; the four equivalence gates with measured value beside bound, for
the rename-only delta; the isolated `covShrinkage` delta; the 2025/2026 MAE and bias
before/after; both `vpr@4.0.0+*.json` digests and whether each moved as expected; the
event-blocked vs match-level SE figures from the known-dependence fixture; and the four todo
filenames.
</output>
