---
phase: quick-260902-disp
plan: 01
type: execute
wave: 1
depends_on: []
mode: quick
files_modified:
  - packages/core/algorithms/sigma1/contribution.ts
  - packages/core/algorithms/sigma1/contribution.test.ts
  - packages/core/algorithms/sigma1/index.ts
  - packages/core/algorithms/sigma1/params.ts
  - packages/core/algorithms/sigma1/params.test.ts
  - packages/core/algorithms/sigma1/consistency.ts
  - packages/core/algorithms/sigma1/consistency.test.ts
  - packages/core/algorithms/sigma1/adaptation.ts
  - packages/core/algorithms/sigma1/sigma1.test.ts
  - packages/core/algorithms/sigma1/innovationVariance.test.ts
  - packages/core/algorithms/types.ts
  - packages/harness/stateSnapshot.ts
  - packages/harness/stateSnapshot.test.ts
  - packages/harness/metricHistorySchema.ts
  - packages/harness/metricHistory.test.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/pageArtifacts.test.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - packages/harness/cli.ts
  - packages/harness/legacyParams.ts
  - packages/harness/legacyParams.test.ts
  - packages/harness/promote.ts
  - packages/harness/promoteOverride.test.ts
  - packages/harness/promotedOverrides.test.ts
  - packages/harness/searchSpace.ts
  - packages/harness/searchSpace.test.ts
  - packages/harness/manifests.ts
  - packages/harness/manifests.test.ts
  - packages/harness/fixtures/extract-digest-slice.ts
  - scripts/verifyMatchPathUnchanged.ts
  - scripts/verifyAllianceUncertaintyIdentity.ts
  - scripts/measureRewindGap.ts
  - package.json
  - data/algorithm-versions/vpr@5.0.0+tuned-2026-08.json
  - data/algorithm-versions/vpr@5.0.0+tracer-check.json
autonomous: false
requirements:
  - D-D1
  - D-D2
  - D-D3
  - D-D4

estimate:
  tokens: 160000
  raw_tokens: 100000
  tasks: 5
  confidence: low

must_haves:
  truths:
    - "D-D4(b): the published `spread` at every level IS the sample standard deviation of that level's own per-match inferred contribution series. Number and evidence agree by construction, not by coincidence — `contributionSpread` is the ONLY producer of a published spread, and it reads nothing but the accumulator."
    - "D-D1: `P` is gone from every published spread — per-component, TOTAL, and phase group. `predict()` and `update()` keep `P + R` unchanged and untouched."
    - "D-D1: no tuning parameter enters the published `±` at all. `teamMetrics` no longer takes a `params` argument and no longer calls `resolveSigma1Params` — the compiler, not a convention, is what stops a knob reaching the display."
    - "D-D2: no league quantity reaches a published spread. `shrinkConsistency`, `SIGMA1_SHRINKAGE_PRIOR_MATCHES` and `Sigma1Params.shrinkagePriorMatches` are DELETED, not merely unread."
    - "The degenerate rule is exactly one predicate and nothing else: 2+ contributions publish the plain sample SD as computed (including `0`); fewer than 2 OMIT `spread` entirely. No floor, no threshold constant, no shrinkage, no new tunable."
    - "D-D3: the per-match contribution is PUBLISHED on the TOTAL metric of every `metricHistory` row for the match that produced it, labelled as model-inferred — FRC records no per-robot score (Assumption A1), so the artifact never implies the number was measured."
    - "The contribution is an identity, not an opinion: the rating-eligible teammates' TOTAL contributions SUM EXACTLY to the alliance's observed component total for that match. Pinned by a test, on both alliances."
    - "The match path is BITWISE unchanged, measured on a real 265-match replay slice under a detached pre-change worktree: identical prediction-stream digest AND identical state hash over every field except the two new ones."
    - "The re-promoted `vpr@5.0.0+*.json` files carry the SAME `predictionStreamSha256` as their 4.0.0 predecessors. A moved digest is a stop-and-report defect, not a relief."
    - "The running re-tune's winner is NOT stranded: a 4.0.0-shaped search artifact still promotes, through one named, ordered, tested parameter-shape parser shared by `--from` and `--from-version`."
    - "No doc comment describes the retired composition. `teamMetrics`'s D-01 block is REWRITTEN to record the reversal and its reasoning; `types.ts`'s and `pageArtifacts.ts`'s `Σ spread² == scoreVarianceOwn` claims are corrected, not left standing."
  artifacts:
    - packages/core/algorithms/sigma1/contribution.ts
    - scripts/verifyMatchPathUnchanged.ts
    - data/algorithm-versions/vpr@5.0.0+tuned-2026-08.json
    - data/algorithm-versions/vpr@5.0.0+tracer-check.json
  key_links:
    - "`applyAllianceUpdate`'s pre-update `teammateBeliefs[i].mean` -> `contribution` -> `foldContribution`. The mean must be read from `workingTeams` (pre-`updateAllianceSum`), never from `updated[i]`. That one read is the whole definition; reading the posterior instead silently republishes the retired 'how fast is the filter moving' quantity under the new name."
    - "`contributionStats`' KEY -> the metric key `teamMetrics` publishes. One `Record<string, ContributionAccumulator>` keyed by exactly the strings `teamMetrics` emits, so 'the published ± and the series agree' is a lookup, not a reconciliation."
    - "`Sigma1TeamState`'s two new fields -> `SerializedSigma1TeamState` -> `STATE_SNAPSHOT_SHAPE_VERSION` 3 -> 4. Without the bump a stale D1 seed still loads and `teamMetrics` reads `undefined` accumulators on live traffic."
    - "`Sigma1Params` field set -> `Sigma1ParamsSchema` (`z.strictObject`) -> every committed `data/algorithm-versions/*.json` AND every candidate inside the running re-tune's `reports/tune-joint-*.json`. Deleting a key without the 4->5 migration strands the re-tune's winner."
    - "`lastContribution.matchKey` -> the history-row guard. A surrogate-only or DQ-zero alliance gets no update and must therefore get no contribution on that row; the match-key equality is what makes that automatic rather than remembered."
---

# Quick Task 260902-disp — the published ± becomes robot consistency

<objective>
The `±` on the site stops meaning "how confident the model is about this team's
mean" and starts meaning "how much this robot actually varies match to match" —
and the per-match numbers behind it are published, so a scout can check the
figure instead of trusting it.

Purpose: `PROJECT.md`'s core value is honest uncertainty. A number labelled
"± 4.2" beside a team's score reads, to every human who sees it, as a claim
about the robot. Until now it was `√(P + R)`, and `P` is the filter's own
epistemic uncertainty — it shrinks as the model sees more matches whether or not
the robot gets more consistent. The label and the quantity did not match.

Output: a per-match inferred contribution series carried in state, published on
every metric-history row, and a published `±` that is literally that series'
standard deviation.

**Out of scope, and not to be started:** `predict()`/`update()` behaviour, which
must be BITWISE unchanged and is measured that way in Task 5. EPA and OPR. The
running re-tune (Task 3 makes its winner promotable; it does not run it).
Regenerating R2 artifacts. Anything under `apps/web` — another agent owns it.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/260902-disp-team-spread-means-robot-consistency/CONTEXT.md
@.claude/CLAUDE.md

@packages/core/algorithms/sigma1/index.ts
@packages/core/algorithms/sigma1/consistency.ts
@packages/core/algorithms/sigma1/params.ts
@packages/core/algorithms/types.ts
@packages/harness/pageArtifacts.ts
@packages/harness/metricHistorySchema.ts
@packages/harness/stateSnapshot.ts
@packages/harness/promote.ts
@packages/harness/legacyParams.ts
@.planning/quick/260901-trz-scale-relative-reparameterization-and-ro/PLAN.md
@.planning/quick/260901-trz-scale-relative-reparameterization-and-ro/SUMMARY.md
</context>

---

## D-D4, resolved: design (b). Read this before anything else.

**The published `±` IS the sample standard deviation of the published per-match
contribution series.** Not `√R`, not `√(P + R)`, not anything derived from the
filter's internal variance bookkeeping. The number on the page and the list of
numbers under it are the same statistic computed two ways, so a scout who adds
them up in a spreadsheet gets the published figure back.

This was the user's own resolution and it is the right one after reading the
code. Design (a) — publish `√R` with the series alongside as illustration —
cannot be made self-consistent here, and the code says so precisely.
`applyAllianceUpdate` estimates `R` as an EWMA (`consistencyEwmaAlpha`, default
0.2) of `max(0, innovation² − ΣP) / n`. Three separate properties of that
estimator each break agreement with a naive SD of contributions:

1. The `max(0, …)` floor makes it a *biased-upward* estimate of a floored
   quantity, deliberately (`consistency.ts` documents the floor as catching the
   ordinary case where one match lands inside the prior's spread).
2. The EWMA weights recent matches ~0.2 and decays older ones geometrically. A
   plain SD weights every match equally. Those cannot agree except by accident.
3. `ΣP` is subtracted out. The naive SD of the contribution series does not
   subtract it, because the contribution series does not know about it.

So under (a) the number and the evidence disagree, by a margin that varies per
team, and the more carefully a reader checks the more wrong the site looks. That
is worse than publishing nothing. Design (b) has one cost — the published `±`
diverges from the filter's internal `R` — and that cost is not a defect: the
model keeps `P + R` for prediction, and the display gets a plain, checkable
statistic. Two different jobs, two different numbers, both honest.

**Everything below is written for (b).** There is no branch in this plan where
`R` reaches a published spread.

---

## The per-match contribution, defined and defended

**Definition.** For a rating-eligible team `t` on an alliance of `n`
rating-eligible teammates, for component `c` of one match:

    contribution(t, c) = mean_c^pre(t) + innovation_c / n

where `mean_c^pre(t)` is that team's belief mean for `c` **before**
`updateAllianceSum` runs, and `innovation_c = observedSum_c − Σ teammates'
means` — both already computed inside `applyAllianceUpdate` today. Summing over
components gives the TOTAL contribution, and a phase group's is the sum over
that group's own components.

`applyTeamProcessNoise` returns `{ mean: belief.mean, variance: belief.variance
+ q }` — the mean is untouched — so "before the update" is unambiguous and the
process-noise step does not have to be reasoned about.

**Why this one wins, over four alternatives that were considered:**

- **Gain-weighted split** (`mean_c + K_j · innovation_c`, exactly what
  `residualsByTeam` already computes). Rejected: `K_j = P_j / (ΣP + R)` weights
  the split by how *uncertain the filter is about each team*. A well-observed
  robot is credited with less of a surprise than a rookie teammate, so the
  published series would encode the model's confidence — precisely the epistemic
  content D-D1 exists to remove — and a team's own series would move when its
  partners' histories changed. It also does not sum to the observed total.
- **The posterior mean after the update** (`updated[i].mean`). Rejected: its
  match-to-match spread measures how fast the filter is still moving, which
  decays to zero as the gain converges. That is the exact defect `consistency.ts`
  records D-Q2 fixing (published spreads understated ~5x); reintroducing it in
  the display layer would repeat the failure one level up.
- **A flat share of the alliance score** (`allianceScore / 3`). Rejected: every
  teammate gets the identical number, so a strong robot and its two weak
  partners publish identical series. It carries no per-team information at all.
- **A season-wide least-squares deconvolution** (OPR's approach, run per team).
  Rejected: not incremental — it cannot be computed in a Worker's per-match
  update, which is where every other Sigma1 quantity is produced — and it would
  be a second, unevaluated model living inside the display path.

**Three properties make the chosen definition defensible, and each is testable:**

1. **It is computable at the right instant.** Both terms already exist inside
   `applyAllianceUpdate`'s component loop, before `updateAllianceSum` is applied.
   No extra pass, no re-derivation, no lookahead.
2. **It is an identity, not an attribution guess.** `Σ_teams contribution(t, c)
   = Σ means + innovation_c = observedSum_c`. The teammates' contributions add up
   *exactly* to what the alliance actually put on the board. That is the same
   shape as `sigma1.test.ts`'s existing alliance-additivity test, and it is the
   headline test in Task 1.
3. **It reuses the split the codebase already commits to.** The R estimator
   divides by `allianceTeams.length` (`varianceSample = max(0, innovation² −
   sumP) / n`) and `fallbackObserved` distributes a residual the same way. Equal
   split is already this model's stated attribution choice
   (`covariance.ts`'s Pitfall Sigma1-3); this task does not invent a second one.

**The honest caveat, and it must be written into the code and the schema, not
only here.** Because the split is equal, a team's series absorbs its *partners'*
variability too. FRC never records an individual robot's score — TBA publishes
alliance totals and alliance-level breakdowns only (Assumption A1) — so there is
no observed per-robot series to compare against and no way to remove the
partners' share. The number is model-inferred, and every place it surfaces must
say so. It is still a far better answer to "how reliable is this robot" than the
filter's uncertainty about its own mean, which is what the site published before.

---

## The degenerate case: one predicate, deliberately

The user withdrew the floor/threshold question and asked for the simplest thing
that is not wrong: *"I really dont mind if the model takes a few matches to make
sense. humans reading the website will see a team has only played a few matches,
and will understand."*

So the entire rule is:

| contributions folded | published `spread` | what a user sees |
|---|---|---|
| 0 | field OMITTED | the value alone, e.g. `48.2`, with `matchCount: 0` beside it |
| 1 | field OMITTED | the value alone, `matchCount: 1` |
| 2, both 50 | `0` | `50.0 ± 0.0` with a two-row series under it reading 50, 50 |
| 2+, varying | plain sample SD | the figure, with the series that produced it |

No floor. No minimum-match constant. No suppression of an exact zero. No
shrinkage. `spread` is already `optional()` on both `TeamMetric`
(`packages/core/algorithms/types.ts`) and `MetricValueSchema`
(`packages/harness/metricHistorySchema.ts`), and `MetricValue.tsx` already
renders a bare value when it is absent and calls that "the normal case, not an
error" — so omission is a shape the whole stack already handles and **no
`apps/web` change is required by this task**.

The one thing that IS special-cased is the case where the statistic does not
exist: a standard deviation over fewer than two points is undefined, and
`0 / 0` is not an answer. `contributionSpread` returns `undefined` there, and
`teamMetrics` omits the key rather than emitting `spread: 0`.

**Bessel's correction (`n − 1`), not `n`.** D-D4(b)'s own words are "computed the
way a human would compute it" — `STDEV` in every spreadsheet is the `n − 1`
form, and it is the unbiased estimator of the variance. A checker reproducing the
number by hand gets the published figure; with `n` they would not.

---

## Artifact size: measured before the shape was chosen

`docs/publish-budget.md`'s committed measurement (2026-08-31 run) has the team
page at **median 42,217 / max 675,956 bytes against a `budgetMaxBytes` of
375,000** — one of the two pre-existing `payloadBudget.test.ts` failures, out of
scope here and not to be "fixed" by raising a ceiling. The largest artifact is
`v1/team/frc3538/2024/…` at 292 matches.

2024 carries 13 components (12 own-field + `foulsCommitted`), so a
`metricHistory` row publishes **17 metric keys** (13 + `total` + three phase
groups). `roundMetric` is 2 decimals, so one added `"contribution":-3.42` field
costs roughly **22 bytes** serialized.

| shape | worst artifact (292 rows) | median artifact (~30 rows) |
|---|---|---|
| `contribution` on all 17 keys | +109,208 B (**+16.2%**) | +11,220 B (**+26.6%**) |
| `contribution` on `total` only | +6,424 B (**+0.95%**) | +660 B (**+1.6%**) |

**Decision: publish `contribution` on the `total` metric only.** A 16% increase
on an artifact already at 1.80x its budget is not a cost this task gets to
impose; 0.95% is. The headline `±` — the one a human reads on a team page — is
the TOTAL, and that one becomes checkable. Per-component and phase-group `±`
remain computed the same way from the same kind of series, but their series are
not published; `MetricValueSchema.contribution`'s doc comment must say so
plainly rather than leaving a reader to discover the gap.

Rejected alternatives, recorded so they are not re-litigated:
- **A positional parallel array** (`contributions: number[][]` keyed to
  `componentOrder`) drops the key names and costs ~28,000 B on the worst
  artifact (+4.1%). Cheaper than 17 keyed fields, still four times the TOTAL-only
  cost, and it introduces a second, positional encoding that no other field in
  the artifact uses.
- **A separate lazily-fetched artifact** buys a per-component series nobody has
  asked for at the price of a new R2 key space, a new manifest entry, a new
  fetch on the team page, and a new schema — for a page that is not currently
  short of round trips but IS short of bytes.

**This task publishes no artifacts.** R2 is already several model versions stale
(`regenerate-published-artifacts-post-trz.md`). The byte cost is *prospective*
and lands at the next republish, so Task 5 files the estimate into that todo
rather than editing `docs/publish-budget.md` with a number nothing has measured
yet. **No ceiling in `payloadBudget.test.ts` is raised by this task.**

---

## Why the accumulator, and not the series, lives in state

The spread must be computable inside `teamMetrics` from `Sigma1State` alone —
that is the interface the Worker's live path uses. Two shapes could satisfy it:

**Storing the raw series** (`number[][]`, matches x components) is simplest to
reason about and was rejected on a measured constraint. `stateSnapshot.ts`
serializes each team into one D1 row, and `emitSeedSql` throws
`SeedRowTooLargeError` above **90,000 bytes** per row (D1's hard per-statement
limit is 100,000). A 292-match team's contribution matrix is 292 x 13 numbers at
~18 characters each ≈ **84 KB** on top of an existing ~10 KB row — the seed path
breaks outright, and it breaks only at import time, far from the change.

**Storing Welford accumulators** costs 3 numbers per published metric key, so
17 x 3 ≈ 51 numbers ≈ **800 bytes** per team — against the 169-number covariance
matrix that row already carries. Safe by two orders of magnitude.

Welford rather than `(sum, sumSq)`: the sums form loses precision by
cancellation exactly where this feature is most interesting — a steady robot
scoring around 50 with a true spread near 0.5 gives `sumSq ≈ n·2500` and a
difference four orders of magnitude smaller. The published number would be noise
in the last digits precisely for the teams the feature exists to identify.

---

## The running re-tune, and how not to strand its winner

A six-process hyperparameter search is running against this working tree right
now, under `SIGMA1_CODE_VERSION` 4.0.0. Three consequences, each handled:

1. **No source edit may begin until it has exited.** Task 1 carries this as a
   precondition. Verify by process absence AND by the six
   `reports/tune-joint-*-origin*.json` artifacts existing with non-zero size and
   a settled mtime — a quiet log and a head-truncated process list are not proof
   a run finished (project memory, `verifying long-running ingests`).
2. **Its output artifacts record the 4.0.0 parameter shape**, including
   `shrinkagePriorMatches` on every candidate — candidate 0 is the exact
   defaults, so the key is present regardless of whether the search moved it.
   Under 5.0.0's `z.strictObject` a plain `promote --from` throws before
   `--set-param` is consulted. Task 3 adds the 4->5 migration and routes BOTH
   `--from` and `--from-version` through one ordered parser, so the winner
   promotes cleanly.
3. **Its rankings survive the deletion.** `shrinkagePriorMatches` measured a
   Brier range of exactly `0.000e+0` in the re-screen because it is structurally
   incapable of reaching a prediction — its one call site was `teamMetrics`.
   Deleting it therefore cannot reorder any candidate. That claim is not
   asserted: Task 5's bitwise replay is its proof, and Task 3's digest gate is
   its cheap in-repo form.

---

## Task ordering and why

**Task 1 (state) before Task 2 (display)** because `teamMetrics` cannot read an
accumulator that does not exist. Task 1 changes what is *stored* and nothing
about what is *published*, so the whole existing suite must stay green through
it — which makes it the cleanest possible place to detect an accidental match-path
change.

**Task 2 (display) before Task 3 (shape)** so the diff that reverses D-01 is
readable on its own. Task 2 leaves `shrinkConsistency` and
`shrinkagePriorMatches` present but unread for exactly one commit; Task 3 deletes
them. That boundary is green, not red — an unread export for one commit is a
much better trade than a single commit that both redefines the published number
and rewrites the parameter schema. Say so in Task 2's commit message so the
transient state is on the record.

**Task 3 is the one unavoidably atomic commit**, for the reason `params.ts`'s own
version-bump comment and quick task 260901-trz Task 3 both record:
`Sigma1ParamsSchema` is `z.strictObject`, so the instant the field is deleted
every committed `data/algorithm-versions/*.json` fails to parse and
`digest.test.ts` goes red. The deletion, the version bump, the migration and both
re-promotions ship together or the tree is knowingly red at a boundary.

**Task 4 (publish the series) after Task 3** so the artifact shape moves against
a settled code version.

**Task 5 last**, because the bitwise verification is only meaningful against the
complete change set, and because it is the task that would catch a defect
introduced by any of the four before it.

**Commit discipline.** One commit per task; the suite green at every boundary
except the two pre-existing `payloadBudget.test.ts` failures.

---

## Verification conventions (apply to every task)

- Run tests as `pnpm vitest run <path>`. **Never** wrap a test command in
  `timeout` — it swallows output and exits 0 regardless (project memory,
  `timeout+pnpm false green`).
- **Verify by reading output, not by exit code.** A passing exit code with no
  test-count line is not evidence.
- `pnpm install` exits 1 on this machine (better-sqlite3 node-gyp). Expected, not
  a failure; `node_modules` is fine. Verify functionally.
- `pnpm typecheck` after every task. In Tasks 1 and 3 the typechecker is also the
  work list: a new required field on `Sigma1TeamState` and a deleted field on
  `Sigma1Params` each enumerate their own consumers.
- **Two `payloadBudget.test.ts` failures are PRE-EXISTING and out of scope.**
  Confirm they are the same two and that no third appeared. Do not raise a
  ceiling.
- Never `Read`, `cat`, or `echo` `.env` (CLAUDE.md, Secrets handling). No task
  here needs a secret; nothing in this plan takes `--env-file`.
- Do not touch `apps/web`. Do not run `git stash` / `git reset` /
  `git checkout --` — another agent may have uncommitted work in the tree.

---

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: the per-match contribution — folded, accumulated, and proven to add up</name>
  <files>packages/core/algorithms/sigma1/contribution.ts, packages/core/algorithms/sigma1/contribution.test.ts, packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/sigma1.test.ts, packages/harness/stateSnapshot.ts, packages/harness/stateSnapshot.test.ts</files>
  <precondition>The six-process hyperparameter search has EXITED. Confirm by process absence and by six `reports/tune-joint-*-origin*.json` files present with non-zero size and an mtime that has stopped moving across two checks a minute apart. Do not edit a single source file before this holds.</precondition>

  <behavior>
- On a two-alliance synthetic match, the rating-eligible teammates' TOTAL
  contributions SUM EXACTLY to that alliance's observed component total — on both
  alliances, to the last bit. This is an identity, so it is an equality
  assertion, not a tolerance.
- A team whose folded contributions are 50 and 50 reports a spread strictly
  smaller than a team whose are 30 and 70 — the user's own example, executable.
- `contributionSpread` over `[30, 70]` is exactly 28.284271247461902
  (`sqrt(800)`), the `n − 1` form. Over `[50, 50]` it is exactly `0`. Over one
  value, and over zero values, it is `undefined`.
- Welford agrees with a two-pass SD over the same 200-value sequence to within
  1e-9 relative, and agrees to more digits than a `(sum, sumSq)` form does on a
  sequence centred at 5000 with a spread of 0.5.
- Every team that receives a Kalman update in a match also receives exactly one
  contribution fold in that match: `contributionStats[TOTAL_METRIC_KEY].count`
  equals `matchCount` for every team, after any replay.
- A team on a fully-surrogate or whole-alliance-DQ-zero alliance receives NO
  fold and NO `lastContribution` stamp for that match — its accumulator count and
  its `matchCount` both stay put.
- `carrySeason` resets every accumulator to empty and clears `lastContribution`.
- A `serializeState` -> `deserializeState` round trip preserves both new fields,
  and a league row declaring `snapshotShapeVersion: 3` now throws
  `LeagueRowShapeVersionError`.
  </behavior>

  <action>
This task changes what Sigma1 STORES and nothing about what it publishes or
predicts. The entire existing suite must stay green through it. If a prediction
assertion moves in this commit, the contribution fold reached the match path and
that is a defect to find, not a test to update.

**1. `packages/core/algorithms/sigma1/contribution.ts` (new leaf module).**

A Node-free, dependency-free leaf in the same spirit as `consistency.ts`. Export:

    export interface ContributionAccumulator {
      readonly count: number;
      readonly mean: number;
      readonly m2: number;
    }
    export function emptyContributionAccumulator(): ContributionAccumulator
    export function foldContribution(acc: ContributionAccumulator, value: number): ContributionAccumulator
    export function contributionSpread(acc: ContributionAccumulator): number | undefined

`foldContribution` is textbook Welford: `count + 1`, `delta = value - mean`,
`mean + delta/count'`, `m2 + delta * (value - mean')`. Returns a new object;
never mutates.

`contributionSpread` returns `undefined` when `count < 2`, else
`Math.sqrt(m2 / (count - 1))`.

The module header is where this feature's honesty lives, and it must carry, in
its own words: the definition above; that the series is MODEL-INFERRED because
FRC records no per-robot score (Assumption A1) and TBA publishes alliance totals
only; that the equal split means a team's spread absorbs its partners'
variability, which is unavoidable and must never be papered over; why Welford
rather than `(sum, sumSq)` (the cancellation argument from this plan's own
section, restated concretely); why `n − 1`; and the degenerate rule in full —
`undefined` below two points because the statistic does not exist, and a plain
`0` at two identical points because that IS the sample standard deviation and a
floor would be inventing a number. State explicitly that there is no floor, no
minimum-match constant and no league blending anywhere in this module, and that
adding one would reintroduce D-D2 under a different name.

`count` is kept inside the accumulator rather than derived from
`Sigma1TeamState.matchCount` even though the two are equal today. One number
buys a self-contained, independently testable value and removes an invariant a
future edit could quietly break — and the phase-group accumulators genuinely can
diverge, since a group whose components are all absent from `componentOrder`
never folds.

**2. `Sigma1TeamState` gains two fields (`index.ts`).**

    /** Keyed by exactly the metric keys `teamMetrics` publishes: each component name, `TOTAL_METRIC_KEY`, and each `COMPONENT_GROUP_METRIC_KEYS` entry. */
    readonly contributionStats: Readonly<Record<string, ContributionAccumulator>>;
    /** The most recent match in which this team received a Kalman update, and its TOTAL contribution. `null` before the team's first update. */
    readonly lastContribution: { readonly matchKey: string; readonly total: number } | null;

Keying `contributionStats` by the PUBLISHED metric key — rather than a nested
`{ components, total, groups }` — is the decision that makes Task 2 a lookup
instead of a reconciliation: "the published `±` for key K is the SD of the series
under key K" becomes a single line with nothing to keep in agreement. Say that in
the field's doc comment.

`coldStartTeamState` initialises `contributionStats` to `{}` and
`lastContribution` to `null` (a fresh team has no series; `teamMetrics` will omit
its spreads, which is the correct claim). `carrySeason` does the same for every
carried team — with a doc comment stating WHY: contributions are points under one
season's scoring rules, and 2024 points are not 2025 points, so a series that
crossed a season boundary would be a category error, not a longer history. The
team-season artifact is season-scoped and the series it publishes must be too.

**3. `applyAllianceUpdate` computes and folds the contributions.**

Two new parameters: `matchKey: string` and

    contributionGroups: Readonly<Record<string, readonly string[]>>

— a metric-key -> component-name map covering `TOTAL_METRIC_KEY` (every name in
`componentOrder`) and each present `COMPONENT_GROUP_METRIC_KEYS` entry,
assembled once per `update()` call so it is not rebuilt per alliance.

Inside the existing `componentOrder.forEach` loop, retain the innovation exactly
as `varianceSampleByComponent` is already retained:
`innovationByComponent[componentIndex] = innovation`. One array, one line, the
same pattern.

In the `for (const team of allianceTeams)` block that builds `nextTeams`,
compute this team's per-component contribution as
`working.beliefs[name]?.mean ?? 0` plus `innovationByComponent[i]! /
allianceTeams.length`, and fold:

- each component name -> its own contribution,
- each key in `contributionGroups` -> the sum of that key's component
  contributions.

`working` is `workingTeams.get(team)!` — the PRE-`updateAllianceSum` belief. Put
a comment on that read saying it is the whole definition and that reading
`nextBeliefsByTeam` instead would republish the retired "how fast is the filter
moving" quantity under the new name. Set `lastContribution` to
`{ matchKey, total: <the TOTAL contribution> }`.

`allianceTeams.length === 0` already returns early, so a fully-surrogate alliance
folds nothing without a new branch. The whole-alliance-DQ-zero case reaches the
same early return via `redUpdateTeams`/`blueUpdateTeams` being `[]`. Confirm both
by reading the code rather than assuming, and record in the SUMMARY that no new
guard was needed.

**4. `update()` builds `contributionGroups` and threads `result.matchKey`.**
Derive the groups from `componentGroupsForSeason(season)` filtered to names
present in `componentOrder` — the same `indexOf(name) === -1` skip `teamMetrics`
already applies, so the two agree by construction. When
`componentGroupsForSeason` yields nothing for the season, the map carries
`TOTAL_METRIC_KEY` alone.

**5. `stateSnapshot.ts`: both fields into `SerializedSigma1TeamState`, and
`STATE_SNAPSHOT_SHAPE_VERSION` 3 -> 4.** The bump is load-bearing for exactly the
reason the 2 -> 3 bump's own comment gives: `apps/worker/src/stateStore.ts`
filters rows by `algorithm_id` only and never by `algorithm_version`, so a
version bump alone does not make a stale seeded row unreachable. Without the
shape bump a shape-3 row deserializes with `contributionStats` as `undefined` and
`teamMetrics` reads a property of `undefined` on live traffic. Write that
reasoning into the constant's doc comment in the style the 2 -> 3 paragraph
already establishes. Do NOT edit `apps/worker` — the bump makes a stale seed fail
loudly at load, which is the designed behaviour; the re-seed is a filed
follow-up in Task 5.
  </action>

  <tests>
**Add `packages/core/algorithms/sigma1/contribution.test.ts`** (pure, no replay):
- `contributionSpread` over `[30, 70]` is exactly `Math.sqrt(800)`; over
  `[50, 50]` is exactly `0`; over `[50]` and over `[]` is `undefined`. Write the
  `n − 1` justification into the test, so a future edit to `n` fails with its
  reason attached.
- **Welford vs two-pass**: 200 pseudo-random values from a seeded generator
  defined in the test file (never `Math.random`), compared to a two-pass SD
  within 1e-9 relative.
- **The precision claim is load-bearing, so prove it**: on 100 values centred at
  5000 with a spread of 0.5, Welford lands within 1e-9 of the two-pass result
  while a `(sum, sumSq)` form computed inline in the test does measurably worse.
  Without this the header's cancellation argument is an assertion.
- Fold order does not change the result beyond 1e-9 (a property, not an
  implementation restatement).
- `foldContribution` returns a new object and leaves its input untouched.

**Add to `packages/core/algorithms/sigma1/sigma1.test.ts`** a new
`describe("per-match contribution (D-D3)")`:
- **The additivity identity (headline).** Replay one synthetic match through
  `update()` with three rating-eligible teams per alliance and a parsed
  breakdown, then assert that for EACH alliance the three teams'
  `lastContribution.total` values sum EXACTLY to that alliance's observed
  component total. Assert on both alliances — a bug that swaps an alliance's
  innovation would pass a one-sided test.
- **Non-vacuity control** for the above: assert the three contributions are not
  all equal, so the identity cannot be satisfied by a degenerate flat split.
- **The user's example.** Two teams, identical means, driven through a stream
  that gives one a steady contribution history and the other a swinging one;
  assert `contributionSpread(steady) < contributionSpread(streaky)` on
  `TOTAL_METRIC_KEY`. Note in the test that the contributions will not be
  bitwise 50/50 even for a perfectly steady robot, because `mean^pre` moves after
  every match — the ordering is the contract, not the exact figures.
- **Count agreement**: after a multi-match replay, every team's
  `contributionStats[TOTAL_METRIC_KEY].count === matchCount`.
- **Surrogate / DQ-zero**: a team whose alliance was fully surrogate, and a team
  on a whole-alliance-DQ-zero alliance, gain neither a fold nor a
  `lastContribution` stamp for that match.
- **Season reset**: after `carrySeason`, every accumulator is empty and
  `lastContribution` is `null`.
- **Group folding**: a season with phase groups folds a group accumulator whose
  value equals the sum of that group's component contributions for the same
  match; a group with no present components folds nothing and keeps `count: 0`.

**Extend `packages/harness/stateSnapshot.test.ts`**: the round trip preserves
both new fields; a league row at `snapshotShapeVersion: 3` throws
`LeagueRowShapeVersionError`; the existing continuation-replay digest match still
holds.

**Must stay green, unedited — a red here is a bug in this change:** every
prediction and `teamMetrics` assertion in `sigma1.test.ts`,
`innovationVariance.test.ts`, and `digest.test.ts`. This task publishes nothing
new and predicts nothing differently.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/algorithms/sigma1/contribution.test.ts</automated>
    <automated>pnpm vitest run packages/core/algorithms/sigma1</automated>
    <automated>pnpm vitest run packages/harness/stateSnapshot.test.ts packages/harness/digest.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`contribution.ts` exists with Welford accumulation, the `n − 1` spread and the
`undefined`-below-two rule, and a header that states the inference caveat and the
absence of any floor. `Sigma1TeamState` carries `contributionStats` (keyed by
published metric key) and `lastContribution`, initialised at cold start and reset
at every season boundary. The teammates' TOTAL contributions sum exactly to the
observed alliance total on both alliances, with a non-vacuity control.
`contributionStats[total].count === matchCount` after a replay.
`STATE_SNAPSHOT_SHAPE_VERSION` is 4 and a shape-3 league row throws. Every
pre-existing prediction and spread assertion is green and unedited.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: D-D1 + D-D4(b) — the published ± becomes the series' standard deviation</name>
  <files>packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/sigma1.test.ts, packages/core/algorithms/sigma1/innovationVariance.test.ts, packages/core/algorithms/sigma1/consistency.ts, packages/core/algorithms/types.ts, packages/harness/pageArtifacts.ts, scripts/verifyAllianceUncertaintyIdentity.ts</files>
  <precondition>Task 1 is committed: every team's `contributionStats` is populated by a replay and `contributionStats[total].count === matchCount` is asserted by a green test.</precondition>

  <behavior>
- Every published `spread`, at every level, equals `contributionSpread` of that
  level's own accumulator — asserted directly against a series collected
  independently during the replay, to 1e-9.
- A team with fewer than two contributions publishes a metric with `value`
  present and `spread` ABSENT — never `spread: 0`, never a floored value.
- Published `value` is bitwise identical to before this task at every level.
  Expectation is linear and this task changes only uncertainty.
- `teamMetrics` compiles with NO `params` argument: no tuning parameter can reach
  a published spread, enforced by the signature rather than by review.
- `adaptationEnabled` on vs off produces IDENTICAL published spreads for the same
  contribution series — the property D-01 broke and this task restores.
  </behavior>

  <action>
**1. Rewrite `teamMetrics`'s body — it gets substantially smaller.**

For each component name: `value` unchanged (`belief?.mean ?? 0`), and

    const spread = contributionSpread(teamState.contributionStats[name] ?? emptyContributionAccumulator());
    perTeam[name] = { value, ...(spread !== undefined ? { spread } : {}) };

`TOTAL_METRIC_KEY` and each phase group take the identical two lines against
their own keys. The `?? empty…` fallback exists so a metric key with no
accumulator (a component that appeared mid-season) omits its spread rather than
throwing — same claim as a team with no matches, which is the honest one.

Everything the old body read for uncertainty goes: `shrinkConsistency`,
`leagueConsistencyFor`, `resolved.coldStartConsistencyVariance`,
`resolved.shrinkagePriorMatches`, `resolved.minConsistencyVariance`,
`teamOwnComponentVarianceSum`, `teamTotalVariance`, `subsetVariance`, and the
per-group `groupPosterior` accumulation. The group loop still needs its
`indices`/`present` walk to compute `groupValue` and to skip a group whose
components are all absent, so keep that and drop only the variance half.

**`resolveSigma1Params` is no longer called in `teamMetrics`, and the function no
longer takes `params` at all.** Delete the parameter and update `makeSigma1`'s
wrapper (the `AlgorithmModule.teamMetrics(state, teams)` public signature does
not change). This is not tidying — it is the guarantee. D-05 (plan 03-04)
originally required that the published `±` "must stay a direct empirical estimate
of that team's own residual spread, not partly a function of a tuning parameter";
D-01 overrode it by publishing `P`, which `applyTeamProcessNoise`'s
`adaptationFactor` scales. Removing the argument makes the constraint structural
again: a knob cannot reach the display because the function cannot see one.

Do NOT delete `teamOwnComponentVarianceSum`, `teamTotalVariance` or
`subsetVariance` — all three remain live on the match path (`predict()`'s
`redScoreVarianceOwn`, `allianceComponentVarianceSum`, and `rp/state.ts`).
Confirm each by grep before concluding, rather than assuming.

**2. Rewrite `teamMetrics`'s doc comment. Rewritten, not appended to.**

The block currently records D-01 as "a locked, one-way user decision" and states
the `√(P + R)` composition and the alliance-additivity identity as facts. All of
that is now false and must not survive in any form. The replacement records, in
its own voice:

- **What the number is now**: the sample standard deviation of this team's own
  per-match inferred contribution series at this aggregation level, `n − 1`,
  omitted entirely below two matches. `contribution.ts` carries the derivation
  and this comment must point there rather than restating it.
- **That D-01 is REVERSED, and that the reversal is itself a user decision**
  (D-D1, this quick task), with the reasoning stated so nobody re-adds `P`: `P`
  is the filter's uncertainty about the team's MEAN. It is epistemic — it shrinks
  as the model observes more matches whether or not the robot becomes more
  consistent — so it answers "how sure is the model" and the site's `±` is read
  by every human as "how reliable is this robot". Those are two different
  questions and the display owes the second. `predict()` still needs `P + R` and
  still has it.
- **That D-D2 removed league blending too**: the number is this robot's own data
  and nothing else. No shrinkage, no floor, no minimum-match constant. A
  thin-history team shows a spread from very few matches, and a reader can see
  `matchCount` beside it.
- **That D-05's original constraint is restored in form**: no tuning parameter
  enters the computation of the published `±`, and the function no longer
  receives one. State the limit of that claim precisely — the SERIES is still
  model-inferred, so the parameters shape the beliefs the contributions are built
  from; what is gone is any parameter appearing in the spread's own formula.
- **That the alliance-additivity identity to `redScoreVarianceOwn` is
  deliberately gone**, and that the surviving identity (three teams' own
  posterior `P` sums to `redScoreVarianceOwn`) is now pinned directly against
  `teamOwnComponentVarianceSum` because `P` is no longer published in any form.
- **The inference caveat**, one sentence, pointing at `contribution.ts`.

**3. `consistency.ts`'s header.** Its three-quantity map states that `R` is "one
of the two terms behind what the site displays" and that `shrinkConsistency`
blends toward the league average for thin histories. `R` is now an
internal-only filter quantity again — which is what it was before plan 07-06 —
and nothing it produces reaches a published number. Rewrite those claims. Also
rewrite the two boundary contracts that describe display behaviour: the
"zero prior matches gets its shrunk R entirely from the league-average prior"
bullet and the `SIGMA1_MIN_CONSISTENCY_VARIANCE` floor bullet are still true
about the FILTER and false about the DISPLAY; say which. `shrinkConsistency`
itself stays in place for exactly one commit and is deleted in Task 3 — record
that in the commit message, not in a comment that would then need deleting.

**4. Correct the two doc comments that assert a now-false identity.**
`packages/core/algorithms/types.ts`'s `redScoreVarianceOwn` block says it "equals
the sum of its three teams' `TeamMetric.spread` squares, by construction", and
`packages/harness/pageArtifacts.ts` repeats the claim at three sites (its header
block, and the two schema field comments near the alliance-variance and team-metric
definitions). Rewrite each to state what is true now: `redScoreVarianceOwn` is
the alliance's own posterior variance sum and is NOT reconstructible from
published per-team spreads, because those spreads are now a different quantity
entirely. Grep `pageArtifacts.ts` and `types.ts` for `spread` before finishing
and check every hit, rather than trusting this list.

**5. Retire `scripts/verifyAllianceUncertaintyIdentity.ts` — delete it.**
Its entire premise is `Σ published spread² == scoreVarianceOwn`, the identity
this task removes. Leaving it in place would leave a script that passes green
against the currently-published (stale) R2 bytes while asserting a property the
code no longer has — the "README described a model that had been deleted" failure
this project's log names, in executable form. Its guarantee is not lost: the
surviving posterior identity moves into `sigma1.test.ts` (below), where it runs
on every CI run with no network and no published artifacts, which is strictly
better coverage than a manual script against stale bytes. It has no
`package.json` entry, so deletion needs no other edit. Record the deletion and
its reasoning in the SUMMARY.
  </action>

  <tests>
**Rework in `packages/core/algorithms/sigma1/sigma1.test.ts` — by name, with the
reason each moves:**

- `"Test 1 (the tracer's proof) — three teams' published TOTAL spread squares sum
  to predict()'s own redScoreVarianceOwn/blueScoreVarianceOwn"`: the identity is
  real but no longer runs through `spread`. Re-express it against
  `teamOwnComponentVarianceSum` directly, keeping the same two-alliance shape and
  the same exactness. Rename it so the title stops promising a published-bytes
  proof, and state in the test that the quantity is no longer published — that is
  the whole content of the change.
- `"Test 3 — the floor errs wide, never narrow"`: the floor is gone. DELETE it
  and replace with the rule that supersedes it: a cold-start team (0 matches)
  publishes NO `spread` key at any level, and a one-match team likewise.
- `"Test 5 — every published metric key's spread strictly exceeds the square root
  of that key's R term alone"`: `R` no longer participates. DELETE and replace
  with the contract that matters now — for every published key, `spread` equals
  `contributionSpread` of that key's accumulator to 1e-9, against a series the
  test collected independently while driving the replay. That is D-D4(b)'s bar as
  an executable test, and it must cover a component key, `total`, and a phase
  group.
- `"returns exactly the requested teams, each with one entry per component plus
  total, every entry carrying a defined spread"`: no longer unconditional. Split
  into two — a team with 2+ matches carries a defined spread on every key; a
  team with 0 or 1 carries none. The second half is the degenerate rule's only
  test and must name it.
- `"two teams with identical means but different observed residual histories
  report different spread values"`: still true, different mechanism. Retarget its
  comment at the contribution series and keep the assertion.

**Add to `sigma1.test.ts`:**
- **`adaptationEnabled` invariance.** Run the same stream through
  `vprAdaptive` and the adaptation-off module and assert the published spreads
  are bitwise identical for teams whose contribution series match. This is D-05's
  restored constraint, and it is the test that would catch a future edit
  re-admitting a tuning parameter into the display.
- **`value` is unmoved.** Pin two or three teams' published `value` at every
  level against the figures the pre-change code produced (captured while writing
  the test, with their provenance in a comment). A spread-only change that also
  moved a value is a defect.

**`innovationVariance.test.ts`**: its four `shrinkConsistency` uses reconstruct
expected published spreads. Those reconstructions are now wrong by construction.
Retarget each at what it was really testing — the ESTIMATOR (`R` itself, read
from `teamState.consistency` / `teamState.covariance`), not the published
number. Its synthetic-recovery test and its negative control both concern the
estimator and must keep working against it unchanged. **If the negative control
fails, stop** — that means the innovation-based estimator itself was disturbed,
which this task must not do.

**Must stay green, unedited:** `digest.test.ts`, every `predict()` assertion,
`replay.test.ts`, `score.test.ts`.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/algorithms/sigma1</automated>
    <automated>pnpm vitest run packages/harness/digest.test.ts packages/harness/replay.test.ts packages/harness/pageArtifacts.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
Every published spread is `contributionSpread` of its own accumulator, asserted
to 1e-9 against an independently collected series at component, TOTAL and
phase-group level. A team below two matches publishes no `spread` key at all.
`teamMetrics` takes no `params` and calls no `resolveSigma1Params`. Adaptation on
and off publish identical spreads. Published `value` is unmoved. The D-01 doc
block is rewritten to record the reversal, its reasoning, and the instruction not
to re-add `P`; `consistency.ts`'s header no longer claims `R` is displayed;
`types.ts` and `pageArtifacts.ts` no longer assert the retired identity;
`verifyAllianceUncertaintyIdentity.ts` is deleted and its surviving guarantee
lives in a unit test. `digest.test.ts` green and untouched.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: D-D2 — delete shrinkagePriorMatches, SIGMA1_CODE_VERSION 5.0.0, both re-promotions, and the 4→5 migration the re-tune needs</name>
  <files>packages/core/algorithms/sigma1/params.ts, packages/core/algorithms/sigma1/params.test.ts, packages/core/algorithms/sigma1/consistency.ts, packages/core/algorithms/sigma1/consistency.test.ts, packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/adaptation.ts, packages/harness/legacyParams.ts, packages/harness/legacyParams.test.ts, packages/harness/promote.ts, packages/harness/promoteOverride.test.ts, packages/harness/promotedOverrides.test.ts, packages/harness/searchSpace.ts, packages/harness/searchSpace.test.ts, packages/harness/manifests.ts, packages/harness/manifests.test.ts, packages/harness/cli.ts, packages/harness/fixtures/extract-digest-slice.ts, scripts/measureRewindGap.ts, data/algorithm-versions/vpr@5.0.0+tuned-2026-08.json, data/algorithm-versions/vpr@5.0.0+tracer-check.json</files>
  <precondition>Task 2 is committed. `data/corpus.sqlite` exists (both re-promotions replay the bounded 3-event digest slice). Both `data/algorithm-versions/vpr@4.0.0+*.json` files are still the committed set — `--from-version` reads them, so take a `git show HEAD:<path>` copy before deleting.</precondition>

  <behavior>
- `SIGMA1_PARAM_KEYS` has 24 members and does not contain `shrinkagePriorMatches`
  — a negative assertion, so a partial deletion fails loudly.
- `SEARCH_EXCLUSIONS` (9) and `SIGMA1_SEARCH_SPACE` (15) still partition
  `SIGMA1_PARAM_KEYS` exactly; a key in neither fails a test that names it.
- The three parameter shapes are MUTUALLY EXCLUSIVE under their strict schemas:
  each of a real 3.0.0, 4.0.0 and 5.0.0 params object parses under exactly one of
  the three, so the ordered parser is deterministic rather than a guess.
- A 4.0.0-shaped search artifact (the shape the running re-tune emits) promotes
  through `--from`, recording the migration in provenance.
- **Both re-promoted `vpr@5.0.0+*.json` files carry the SAME
  `predictionStreamSha256` as their 4.0.0 predecessors.** A moved digest means the
  deletion reached a prediction and is a stop-and-report condition.
  </behavior>

  <action>
The one unavoidably atomic commit, for the reason `params.ts`'s own 2.1.0 -> 3.0.0
block and quick task 260901-trz Task 3 both record: `Sigma1ParamsSchema` is
`z.strictObject`, so the instant the field is deleted every committed version file
fails to parse and `digest.test.ts` goes red. Retire and re-promote in the SAME
commit. `pnpm typecheck` is the work list. **No `as Sigma1Params` cast is added
anywhere.**

**1. Delete the parameter and its supporting cast.**
- `Sigma1Params.shrinkagePriorMatches` and its `Sigma1ParamsSchema` entry; the
  object-level `.check(...)` predicate that ranges it, if one exists; its
  `DEFAULT_SIGMA1_PARAMS` entry; and its `SIGMA1_PARAM_KEYS` membership (derived,
  so it follows).
- `consistency.ts`'s `shrinkConsistency` and `SIGMA1_SHRINKAGE_PRIOR_MATCHES`,
  and every re-export of `shrinkConsistency` from `index.ts`. Delete
  `consistency.test.ts`'s `shrinkConsistency` describe blocks outright — they test
  a function that no longer exists, and a "kept for a caller that might hold a
  residual" argument does not apply to a league-blending helper that D-D2 removed
  by decision.
- `adaptation.ts`'s single prose reference.
- `searchSpace.ts`'s `shrinkagePriorMatches` bound (15 searchable keys remain).
  Do NOT move it into `SEARCH_EXCLUSIONS` — that record is typed
  `Partial<Record<keyof Sigma1Params, string>>` and the key no longer exists.
  A stale screen artifact naming it now takes `loadSurvivors`' existing
  "unknown key" branch, which is the correct message; note that in the SUMMARY.

**2. `SIGMA1_CODE_VERSION` `"4.0.0"` -> `"5.0.0"`**, with a block in the exact
style of the existing bumps. It must state: this quick task and D-D1/D-D2; that
the parameter set's SHAPE changed so no 4.0.0 file parses as a 5.0.0 one; that
`predict()`'s and `update()`'s output are BITWISE UNCHANGED and that this is
measured, not asserted (naming Task 5's script and the digest equality below);
that `teamMetrics`'s output DOES move at every level, which is the point of the
task; and that both `vpr@4.0.0+*.json` files were retired and re-promoted as
`vpr@5.0.0+*.json` in this same commit via `--from-version`, so the digests were
produced by the new code and never hand-edited. MAJOR because the shipped
parameter shape changed, even though no prediction did.

**3. `legacyParams.ts` — the 4 -> 5 map and one ordered parser.**

Add `LegacySigma1Params4Schema`, a `z.strictObject` FROZEN at the 4.0.0 shape,
and `migrate4to5(legacy): Sigma1Params`, which is key deletion and nothing else.
Its doc comment must say that plainly: no value is rescaled, no default is
substituted, exactly one key is dropped, and that is why no promoted parameter
set's behaviour changes across the migration.

`migrateAbsoluteToScaleRelative` currently returns `Sigma1Params` and therefore
stops compiling. Change its return type to `LegacySigma1Params4` and let the 3.x
path compose as `migrate4to5(migrateAbsoluteToScaleRelative(...))`. This keeps
the 3 -> 4 map meaning exactly what it meant when it was written — the header
already declares it a historical record that must not be edited again — and
expresses the chain as composition rather than by rewriting history.

Add the shared entry point both promotion paths use:

    parseSigma1ParamsWithMigration(raw: unknown): { params: Sigma1Params; migration?: string }

trying, in this fixed order: `Sigma1ParamsSchema` (no migration),
`LegacySigma1Params4Schema` + `migrate4to5`, then
`LegacyAbsoluteSigma1ParamsSchema` + the composed 3 -> 5 chain. Throw a named
error listing all three shapes if none matches. The header must defend the
ordered-attempt design against the obvious objection: because all three schemas
are `strictObject` and the shapes are pairwise distinguishable by key set
(5.0.0 lacks `shrinkagePriorMatches`; 4.0.0 has it alongside the `*Rel` names;
3.0.0 uses the absolute names), at most one can ever match — this is
disambiguation, not guessing, and the mutual-exclusivity test below is what keeps
it that way.

**4. `promote.ts` — route both loaders through it.** `loadFromVersionFile`
replaces its `codeVersion` if/else with a call to
`parseSigma1ParamsWithMigration`, keeping the "newer than this code" refusal
(check the recorded `codeVersion` against `SIGMA1_CODE_VERSION` first and throw
before parsing, exactly as today). `loadSearchArtifact`'s
`Sigma1ParamsSchema.parse(winnerCandidate.params)` becomes the same call. Record
the returned `migration` tag in `provenance.paramShapeMigration`, and set
`objectiveAppliesToPromotedParams: false` whenever a migration was applied, for
the reason already documented: the objective was computed by a different code
version on a differently-shaped set.

This is what keeps the running re-tune's winner promotable. Say so in
`promote.ts`'s header, naming the re-tune and the fact that its candidates carry
`shrinkagePriorMatches` because candidate 0 is the exact 4.0.0 defaults, whether
or not the search moved the key.

**5. Retire and re-promote, in this commit.**

    # copy both retired files out first — `git show HEAD:<path> > <tmp>` is
    # preferable to a working-copy cp, since --from-version reads them AFTER
    # the delete.
    # delete data/algorithm-versions/vpr@4.0.0+tracer-check.json
    # delete data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json

    pnpm promote --from-version <retired tracer-check copy> --name tracer-check
    pnpm promote --from-version <retired tuned-2026-08 copy> --name tuned-2026-08

**The digest gate, and it is the sharp one.** Unlike the 3.0.0 -> 4.0.0
re-promotion, where the algorithm genuinely changed and a moved digest was
expected, here `predictionStreamSha256` **must be byte-identical** to the 4.0.0
file's recorded value. Read both 4.0.0 digests out of git before deleting, and
compare. A moved digest means the deletion reached a prediction — STOP and
report; do not re-promote around it. A matching digest is the cheap in-repo proof
of the claim that `shrinkagePriorMatches` could not affect an outcome, and Task 5
is its thorough form.

`tuned-2026-08`'s carried `linkC: 0.5` override and its provenance note must
survive both migrations, exactly as they survived 3 -> 4. Read the promoted files
back and confirm.

**6. Repoint every `4.0.0` / version-string reference.** Grep `4\.0\.0` and
`vpr@4` under `packages/`, `scripts/` and `data/` before and after. Known sites
follow the same list 260901-trz used one version earlier: `cli.ts`'s pinned
version and its version-history comment (which needs a new paragraph, not a
number swap), `manifests.ts` and `manifests.test.ts`,
`fixtures/extract-digest-slice.ts` (default path constant and its measurement
notes), `scripts/measureRewindGap.ts`, and `promotedOverrides.test.ts`'s
constants and inline strings. Leave `baselineFingerprint.test.ts`'s assertions
alone — they record a committed historical measurement; only surrounding prose
may be corrected. `promoteOverride.test.ts` uses `shrinkagePriorMatches` in a
`--set-param` fixture; move that fixture to another searchable key.

The digest FIXTURE (`packages/harness/fixtures/digest-slice.json`) records raw
matches, not predictions, and the slice is unchanged — it does not need
regenerating.
  </action>

  <tests>
**Extend `packages/harness/legacyParams.test.ts`:**
- **Mutual exclusivity (the enforcement).** Three real fixtures — the 3.0.0
  `tuned-2026-08` params (already inlined there), the 4.0.0 `tuned-2026-08`
  params (inline as a literal now, with a comment naming its provenance and
  noting the source file is retired by this task, so the fixture cannot rot), and
  a 5.0.0 set — each parse under EXACTLY ONE of the three schemas. Assert all
  nine parse/throw outcomes, so the ordered parser's determinism is proven rather
  than argued.
- `migrate4to5` drops exactly one key and leaves every other value bitwise
  identical — iterate the key set rather than spot-checking, so a future added
  field is covered automatically.
- The composed 3 -> 5 chain reproduces the 3 -> 4 map's numbers exactly (compare
  against `migrateAbsoluteToScaleRelative`'s own output minus the dropped key).
- `parseSigma1ParamsWithMigration` on an object matching none of the three throws
  a message naming all three shapes.

**Extend `packages/harness/searchSpace.test.ts`:** the partition still holds at
15 + 9 = 24; `shrinkagePriorMatches` is absent from `SIGMA1_SEARCH_SPACE`,
asserted BY NAME; `SEARCHABLE_PARAM_KEYS` has 15 members in
`SIGMA1_PARAM_KEYS`' sorted order; every surviving default is still strictly
interior to its bound.

**Extend `packages/core/algorithms/sigma1/params.test.ts`:**
`shrinkagePriorMatches` is absent from `SIGMA1_PARAM_KEYS` AND from a
`Sigma1ParamsSchema` parse of an object that includes it (strict rejection);
`Sigma1ParamsSchema` and `isValidParamSet` still agree on every surviving
invariant.

**Extend `packages/harness/promoteOverride.test.ts`:** a `--from` promotion of a
4.0.0-shaped search artifact succeeds, records `paramShapeMigration`, and sets
`objectiveAppliesToPromotedParams: false`; a 5.0.0-shaped one succeeds with no
migration tag and leaves that flag alone.

**Expected red until the re-promotion runs, and not separate failures:**
`digest.test.ts`, `promotedOverrides.test.ts`, `manifests.test.ts`. That coupling
is the reason this is one commit.
  </tests>

  <verify>
    <automated>pnpm typecheck</automated>
    <automated>pnpm vitest run packages/core/algorithms/sigma1</automated>
    <automated>pnpm vitest run packages/harness/legacyParams.test.ts packages/harness/searchSpace.test.ts packages/harness/promoteOverride.test.ts</automated>
    <automated>pnpm vitest run packages/harness/digest.test.ts packages/harness/promotedOverrides.test.ts packages/harness/manifests.test.ts</automated>
  </verify>

  <done>
`SIGMA1_PARAM_KEYS` has 24 members and no `shrinkagePriorMatches`;
`shrinkConsistency` and `SIGMA1_SHRINKAGE_PRIOR_MATCHES` are deleted with their
tests. `SIGMA1_CODE_VERSION` is `5.0.0`. `LegacySigma1Params4Schema` and
`migrate4to5` exist; `parseSigma1ParamsWithMigration` is the single ordered entry
point for both `--from` and `--from-version`, with a nine-outcome mutual-exclusivity
test. A 4.0.0-shaped search artifact promotes, so the running re-tune's winner is
not stranded. `data/algorithm-versions/` holds exactly the two `vpr@5.0.0+*.json`
files; both were written by `pnpm promote --from-version` in this commit; **both
carry the same `predictionStreamSha256` as their 4.0.0 predecessors**; `linkC: 0.5`
and its provenance note survived. The search space partitions at 15 + 9 = 24.
Every `4.0.0` path reference is repointed. No cast was added.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: D-D3 — publish the per-match contribution on every metric-history row</name>
  <files>packages/harness/metricHistorySchema.ts, packages/core/algorithms/types.ts, packages/core/algorithms/sigma1/index.ts, packages/harness/cli.ts, packages/harness/publish.ts, packages/harness/publish.test.ts, packages/harness/metricHistory.test.ts, packages/harness/pageArtifacts.test.ts</files>
  <precondition>Task 3 is committed and `data/algorithm-versions/` holds exactly the two `vpr@5.0.0+*.json` files.</precondition>

  <behavior>
- A `metricHistory` row for a team that received an update in that match carries
  `metrics.total.contribution` — the contribution folded for THAT match.
- A row for a team that received NO update in that match (fully-surrogate
  alliance, whole-alliance-DQ-zero) carries no `contribution` at all. Never a
  stale previous-match value, never a coerced `0`.
- `seasonStats.metrics` and every event-artifact as-of metrics record carry NO
  `contribution` key — zero added bytes on those artifacts.
- Reconstructing the sample standard deviation of a team's published
  `total.contribution` series reproduces that team's final published
  `total.spread`, on a real replayed slice, within publish rounding.
- `opr` and `epa` are entirely unaffected: no `contribution` appears on any of
  their rows, and neither module gains a method body.
  </behavior>

  <action>
**1. `MetricValueSchema` gains `contribution: z.number().optional()`.**

Its doc comment carries D-D3's honesty burden and must state, in its own words:
that the number is MODEL-INFERRED and not measured, because FRC records no
individual robot's score — TBA publishes alliance totals and alliance-level
breakdowns only (Assumption A1); the definition in one line, pointing at
`contribution.ts` for the derivation and the equal-split caveat; that this
series is exactly what the same row's `spread` is the standard deviation of, so
the two can be checked against each other; that it is present ONLY on
`TOTAL_METRIC_KEY`, with the measured byte reason (17 keys x 292 rows would add
~109 KB, +16.2%, to an artifact already over its committed budget; TOTAL-only
adds ~6.4 KB, +0.95%) so the omission reads as a decision rather than an
oversight; and that absence is a valid, expected state — an unrepublished
artifact, an algorithm that does not model it, or a match in which this team
received no update.

**2. `AlgorithmModule` gains an OPTIONAL method** in
`packages/core/algorithms/types.ts`:

    lastContribution?(state: TState, teamKey: string): { readonly matchKey: string; readonly value: number } | null;

Optional, following the same convention `TeamMetric.spread` and
`Prediction.variance` already use for "populated by Sigma1, absent for OPR and
EPA". A required method would force two modules to carry a stub for a concept
they do not have — the live-looking-but-inert surface CONTEXT forbids. Its doc
comment states that a caller MUST compare `matchKey` before attributing the
value to a match, and why: a team can appear on a match's roster and still
receive no update.

`makeSigma1` implements it by reading `state.teams.get(teamKey)?.lastContribution`.
`opr.ts` and `epa.ts` are not edited at all.

**Rejected alternative, recorded:** putting `contribution` on `TeamMetric`
itself. `teamMetrics` is also called for every team in the season at
`publish.ts`'s season-final and as-of-event sites, where a team's
`lastContribution` is from whatever match it last played — a true statement, but
a meaningless field on a season header, and one that would have to be stripped by
a `roundTeamMetricRecord` that already silently drops anything it does not name.
Routing it through an explicitly match-keyed accessor makes the guard impossible
to forget instead of merely documented.

**3. The two metric-history producers attach it, guarded.**
In `publish.ts`'s `onMatchComplete` (around L1644) and `cli.ts`'s equivalent
(around L544), after building `metrics[teamKey]`:

    const c = algorithm.lastContribution?.(state, teamKey);

and when `c !== null/undefined` AND `c.matchKey === match.matchKey`, attach
`contribution: c.value` to the row's `TOTAL_METRIC_KEY` entry only. Build a new
metric object rather than mutating `metrics[teamKey]` — that record is the same
object `teamMetrics` returned and is shared across the loop. Put the match-key
comparison's reason at the call site in both files.

**4. Rounding: `contribution` survives into history rows and only there.**
`roundMetricHistoryRow` currently delegates to `roundTeamMetricRecord`, which is
also the season-header path and which "rebuilds each metric field-by-field, so
anything not named here is silently dropped" (its own comment). Split them: give
`roundMetricHistoryRow` its own record-rounder that additionally carries
`contribution` through `roundMetric`, and add one line to
`roundTeamMetricRecord`'s comment stating that the omission of `contribution`
there is DELIBERATE and byte-motivated, not an oversight. Two call sites, two
visible decisions.

`withHistoryPercentiles` spreads `{ ...metric }`, so it carries the new field
through unchanged; confirm by reading it rather than assuming, and note that the
round step runs last (`buildTeamSeasonArtifact`, ~L1000) so the guard and the
rounding cannot cross.

**5. Do not republish.** This task changes the artifact SHAPE and the schema; the
bytes land at the next republish. Do not run `pnpm publish:seasons`, do not edit
`docs/publish-budget.md`, and do not raise any ceiling in
`payloadBudget.test.ts`. Task 5 files the estimate into the existing republish
todo so whoever runs it knows what to expect.
  </action>

  <tests>
**Extend `packages/harness/metricHistory.test.ts`:** a row carrying
`contribution` validates; a row carrying it on a non-total key also validates
(the schema is per-metric and does not enforce the placement policy — say so in
the test, so a reader knows the TOTAL-only rule is a producer decision, enforced
below); a non-numeric `contribution` throws.

**Extend `packages/harness/publish.test.ts`** — the substantive tests:
- **The round trip that is the whole point.** Drive a small multi-match synthetic
  replay through the real `onMatchComplete` path, collect one team's published
  `total.contribution` series, compute its `n − 1` sample SD, and assert it
  equals that team's final published `total.spread` within the tolerance publish
  rounding implies (both are `roundMetric`, 2 decimals). Write the tolerance's
  derivation into the test. This is D-D4(b)'s promise, verified end to end
  through the real producer rather than against the accumulator.
- A team on a fully-surrogate alliance appears in that match's rows with NO
  `contribution` key, while its `value` and (where defined) `spread` are present.
  Assert the ABSENCE of the key, not a falsy value.
- `contribution` appears on `total` and on no other metric key in any row.
- `seasonStats.metrics` and the as-of-event metrics records carry no
  `contribution` key.
- An `opr` replay produces no `contribution` on any row and does not throw —
  proving the optional method is genuinely optional.

**Must stay green:** `pageArtifacts.test.ts`, `payloadBudget.test.ts` (the same
two pre-existing failures and no third).
  </tests>

  <verify>
    <automated>pnpm vitest run packages/harness/metricHistory.test.ts packages/harness/publish.test.ts packages/harness/pageArtifacts.test.ts</automated>
    <automated>pnpm vitest run packages/harness/payloadBudget.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`MetricValueSchema.contribution` exists, optional, with a doc comment that names
it model-inferred, cites Assumption A1, states the TOTAL-only rule with its
measured byte reason, and points at `contribution.ts`. `AlgorithmModule.lastContribution`
is optional and implemented only by Sigma1; `opr.ts` and `epa.ts` are unedited.
Both producers attach it under a match-key guard with the reason at the call
site. A published contribution series' sample SD reproduces the published
`total.spread` on a real replay, through the real producer. Season-header and
event-artifact records gain zero bytes. `payloadBudget.test.ts` shows the same two
pre-existing failures and no third; no ceiling was raised; nothing was republished.
  </done>
</task>

<task type="auto">
  <name>Task 5: prove the match path is bitwise unchanged, sweep the docs, file the follow-ups</name>
  <files>scripts/verifyMatchPathUnchanged.ts, package.json, .planning/todos/pending/*.md</files>
  <precondition>Tasks 1-4 are committed. The SHA of the commit immediately BEFORE Task 1 is known — capture it now (`git log --oneline` before starting) and record it in the SUMMARY; every hash below is meaningless without it.</precondition>

  <action>
CONTEXT's first verification bar is `predict()` output bitwise unchanged across a
real replay slice, and it says measured, not asserted. Quick task 260901-trz
established the mechanism — a detached pre-change worktree, the same committed
slice replayed in both, and a state hash compared — and this task reuses it with
a stronger expectation: there, one field was allowed to move; here NOTHING may
move except the two fields Task 1 added.

**1. `scripts/verifyMatchPathUnchanged.ts` (new).** Add
`"verify:match-path": "tsx scripts/verifyMatchPathUnchanged.ts"` to
`package.json`, deliberately WITHOUT `--env-file` — this path opens no corpus and
makes no network call, so no secret is ever legitimately in scope (CLAUDE.md,
Secrets handling).

It must run UNCHANGED in both worktrees, which fixes three design constraints:

- **Its only data source is the committed fixture**
  `packages/harness/fixtures/digest-slice.json` (2022; `2022alhu`/`2022azfl`/
  `2022azva`; 265 matches), read with `readFileSync`. `data/corpus.sqlite` is
  gitignored and therefore absent from a fresh worktree (project memory,
  `worktree gitignored state`); a script that needed it would fail on the
  pre-change side for a reason having nothing to do with this change.
- **It must not import anything that pulls in `better-sqlite3`.** Import only
  `WalkForwardSimulator` from `replay.ts`, `vpr` from core, `serializeState`
  from `stateSnapshot.ts`, and `node:crypto`. If any of those drags the native
  module in, compute the prediction digest inline over the same canonical form
  rather than importing `promote.ts`'s helper — say which route was taken in the
  SUMMARY.
- **It must tolerate BOTH state shapes.** Strip `contributionStats` and
  `lastContribution` from each serialized team payload if present, by a NAMED
  allowlist of exclusions with a comment saying these are the only two fields
  this change is permitted to move. Everything else — `beliefs`, `covariance`,
  `consistency`, `matchCount`, `lastEventKey`, `innovationStats`, `rpBeliefs`,
  `rpCovariance`, `rpCrossCovariance`, and the whole league row bar its
  `snapshotShapeVersion` — is hashed.

It prints exactly two hashes: `predictionStreamSha256` over the 265-match
prediction stream, and `stateSha256` over the stripped, key-sorted serialized
rows. Nothing else on stdout, so the two runs diff cleanly.

**2. Run it in both trees.**

    git worktree add --detach ../sigmascout-prechange <PRE_TASK_1_SHA>
    cp scripts/verifyMatchPathUnchanged.ts ../sigmascout-prechange/scripts/
    # in the worktree: pnpm install --ignore-scripts   (skips the better-sqlite3
    # gyp build that always fails on this machine and that nothing here needs)
    # then run the script in each tree and compare the two printed hashes

`--ignore-scripts` is the right flag rather than tolerating the usual exit 1:
this script never opens the corpus, so the native module is genuinely not needed,
and skipping its build removes the one failure mode that would otherwise have to
be reasoned around mid-verification.

**BOTH hashes must be identical.** `predictionStreamSha256` identical proves
`predict()` is untouched. `stateSha256` identical proves `update()` writes the
same state it always did — a stronger claim than the digest alone, since a
divergence in `consistency` or `covariance` would not necessarily surface in 265
matches of predictions but would corrupt every subsequent season.

If either differs, **STOP and report**. Do not adjust the exclusion allowlist to
make it pass — widening that list is exactly how a real regression gets
laundered into a green run. Diff the serialized rows to find the first team and
field that moved and report that instead.

Cleanup: `git worktree remove` frequently fails on this machine (project memory,
`worktree cleanup on Windows`). Verify the working tree is clean and remove the
directory manually if needed; do not let a failed removal be read as a failed
verification.

**3. The retired-behaviour sweep.** Grep `packages/`, `scripts/` and `docs/` for
`shrinkConsistency`, `shrinkagePriorMatches`, `P + R`, `scoreVarianceOwn` and
`4\.0\.0`. Every surviving hit must be one of: a frozen historical schema in
`legacyParams.ts`, a version-bump history comment, `baselineFingerprint.test.ts`'s
committed measurement record, or `predict()`'s own live `P + R` composition —
which is correct and must NOT be edited. Anything else is prose describing a
model that no longer exists; fix it. Read every hit; do not filter by count.

**4. Whole-suite verification.** The first point at which all four decisions, the
version bump, both re-promoted files and the new artifact field coexist. Read the
output: test-file and test counts present, exactly two failures, both in
`payloadBudget.test.ts`, both matching the pre-existing pair.

**5. File the follow-ups** as `.planning/todos/pending/*.md`, matching the format
in that directory:

1. `reseed-d1-algorithm-state-post-disp.md` — `STATE_SNAPSHOT_SHAPE_VERSION` is
   4, so every seeded D1 row is unreadable and the live Worker will throw
   `LeagueRowShapeVersionError` at load until re-seeded. Name the emit command
   and note this is the designed loud failure, not a regression.
2. Amend `regenerate-published-artifacts-post-trz.md` (or supersede it) — vpr is
   now `5.0.0`, and the republish additionally lands D-D3's per-match
   `contribution` field. **Record this task's byte estimate**: ~22 B per row on
   `total` only, ~+6.4 KB (+0.95%) on the largest team artifact, ~+660 B (+1.6%)
   on the median, against a team page already at 675,956 B versus a committed
   375,000 B budget. State that `docs/publish-budget.md` must be re-measured from
   that run, and that the pre-existing breach is not this task's to close.
3. `contribution-series-per-component.md` — the per-component and phase-group
   `±` are computed from contribution series that are NOT published, so only the
   TOTAL figure is currently checkable. Record the two rejected shapes (17 keyed
   fields at +16.2%; a positional parallel array at +4.1%) and their measured
   costs, so a future decision starts from the numbers rather than repeating the
   analysis.
4. `contribution-sum-identity-checker.md` — `verifyAllianceUncertaintyIdentity.ts`
   was deleted with its premise. Its replacement, once artifacts are republished,
   is a published-bytes check that the rating-eligible teammates' published
   `total.contribution` values sum to the alliance's observed component total.
   Note that the in-repo unit test already covers the identity itself, so this is
   an end-to-end confirmation of the PUBLISH path, not a missing guarantee.
  </action>

  <tests>
No new unit tests. This task's verification IS the two hashes, the sweep and the
whole-suite run.

**One check to run and record, not to commit:** run the script twice in the
post-change tree and confirm both hashes are identical across runs. A replay that
is not deterministic invalidates the comparison, and finding that out here costs
two minutes rather than a false conclusion.
  </tests>

  <verify>
    <automated>pnpm verify:match-path</automated>
    <automated>pnpm vitest run</automated>
    <automated>pnpm typecheck</automated>
    <automated>git status --porcelain -- apps/web</automated>
  </verify>

  <done>
`scripts/verifyMatchPathUnchanged.ts` exists, takes no `--env-file`, reads only
the committed 265-match fixture, and prints two hashes. Both hashes are IDENTICAL
between the detached pre-Task-1 worktree and the current tree, with the exclusion
allowlist naming exactly `contributionStats` and `lastContribution` and nothing
else. The retired-behaviour grep is clean or every surviving hit is a marked
historical reference or `predict()`'s own live composition. Full `pnpm vitest run`
read from its output: exactly two failures, both the pre-existing
`payloadBudget.test.ts` pair. `git status --porcelain -- apps/web` is empty. Four
todos filed, including the byte estimate on the republish todo.
  </done>
</task>

</tasks>

<verification>
Read every command's OUTPUT; an exit code alone proves nothing here.

1. `pnpm verify:match-path` prints identical `predictionStreamSha256` and
   `stateSha256` in the detached pre-change worktree and in the current tree.
2. Both `data/algorithm-versions/vpr@5.0.0+*.json` carry the SAME
   `predictionStreamSha256` as the 4.0.0 files they replaced. Compare against
   `git show` output, not memory.
3. `pnpm vitest run` — whole suite, green except the two pre-existing
   `payloadBudget.test.ts` failures, and green at every intermediate commit
   boundary.
4. `pnpm typecheck` clean at every commit boundary.
5. `ls data/algorithm-versions/` shows exactly the two `vpr@5.0.0+*.json` files;
   both `4.0.0` files are gone.
6. Task 5's retired-behaviour grep: every hit is a frozen legacy schema, a
   version-history comment, a committed measurement record, or `predict()`'s own
   live `P + R`.
7. `git log --oneline` shows five commits, one per task, each self-contained.
8. `git status --porcelain -- apps/web` is empty.
9. No hyperparameter search was started or restarted by this task; no artifact was
   republished; no `payloadBudget.test.ts` ceiling was raised.
</verification>

<success_criteria>
- **D-D4(b)**: the published `±` at every level is the sample standard deviation
  of that level's own per-match contribution series, asserted to 1e-9 against an
  independently collected series and end-to-end through the real publish producer.
- **D-D1**: `P` is gone from every published spread; `teamMetrics` takes no
  `params`; adaptation on and off publish identical spreads.
- **D-D2**: `shrinkConsistency`, `SIGMA1_SHRINKAGE_PRIOR_MATCHES` and
  `Sigma1Params.shrinkagePriorMatches` are deleted, not merely unread; no league
  quantity reaches a published number.
- **D-D3**: `metricHistory` rows carry a match-keyed, model-inferred
  `total.contribution`; a team that received no update in a match carries none.
- **The degenerate rule is one predicate**: 2+ contributions publish the plain
  sample SD including `0`; fewer than 2 omit `spread`. No floor, no threshold, no
  new tunable, no `apps/web` change.
- **The contribution is an identity**: teammates' TOTAL contributions sum exactly
  to the observed alliance component total, on both alliances, with a non-vacuity
  control.
- **The match path is measured unchanged**, both prediction stream and state, on
  a real 265-match slice against a detached pre-change worktree — and the two
  re-promoted digests independently confirm it.
- **The re-tune's winner is not stranded**: one named, ordered, mutual-exclusivity-
  tested parameter-shape parser serves both `--from` and `--from-version`.
- **Artifact size was estimated before the shape was chosen**, the cheapest
  honest shape was taken, no ceiling was raised, and the prospective cost is filed
  where the republish will read it.
- **No doc comment describes retired behaviour** — in particular `teamMetrics`'s
  D-01 block records the reversal and its reasoning so nobody re-adds `P`.
</success_criteria>

<output>
Create `.planning/quick/260902-disp-team-spread-means-robot-consistency/SUMMARY.md`
when done, recording: the five commit SHAs and the pre-Task-1 SHA the worktree was
cut from; both hashes from `verify:match-path` in each tree; both
`vpr@5.0.0+*.json` `predictionStreamSha256` values beside their 4.0.0
predecessors; the exact `contributionSpread` figures from the 50/50 vs 30/70 test;
whether any new guard was needed for the surrogate/DQ-zero cases or whether the
existing early return covered them; which import route the verification script
took to avoid `better-sqlite3`; the final `pnpm vitest run` counts with the two
pre-existing failures named; and the four todo filenames.
</output>
