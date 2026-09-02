---
phase: quick-260902-varopr
plan: 01
type: execute
wave: 1
depends_on: []
mode: quick
worktree: false
files_modified:
  - packages/core/algorithms/sigma1/varianceOpr.ts
  - packages/core/algorithms/sigma1/varianceOpr.test.ts
  - packages/core/algorithms/sigma1/varianceOpr.recovery.test.ts
  - packages/core/algorithms/sigma1/displayOnly.test.ts
  - packages/core/algorithms/sigma1/fixtures/display-only-baseline.json
  - packages/core/algorithms/sigma1/contribution.ts
  - packages/core/algorithms/sigma1/contribution.test.ts
  - packages/core/algorithms/sigma1/index.ts
  - packages/core/algorithms/sigma1/params.ts
  - packages/core/algorithms/sigma1/params.test.ts
  - packages/core/algorithms/sigma1/consistency.ts
  - packages/core/algorithms/sigma1/sigma1.test.ts
  - packages/harness/stateSnapshot.ts
  - packages/harness/stateSnapshot.test.ts
  - packages/harness/searchSpace.ts
  - packages/harness/searchSpace.test.ts
  - packages/harness/legacyParams.ts
  - packages/harness/legacyParams.test.ts
  - packages/harness/promote.ts
  - packages/harness/promoteOverride.test.ts
  - apps/worker/src/scheduled.ts
  - scripts/measureVarianceOpr.ts
  - package.json
  - docs/models/sigma1-variance-decomposition.md
  - data/algorithm-versions/vpr@5.0.0+tuned-2026-08.json
  - data/algorithm-versions/vpr@5.0.0+tracer-check.json
autonomous: false
requirements:
  - D-V1
  - D-V2
  - D-V3
  - D-V4

estimate:
  tokens: 190000
  raw_tokens: 118000
  tasks: 6
  confidence: low

must_haves:
  truths:
    - "D-V3 RESOLVED: EVENT-SCOPED. The solve reuses `opr.ts`'s event-scoped precedent end to end — not just the 0/1 design matrix, but the `scopeKind: \"event\"` serializer row and the Worker's event-scope `selectionsFor` branch, both of which already exist for OPR alone."
    - "D-V2: rank deficiency is answered BY THE MATH, not a special case. `(X'X + lambda*I)` is positive definite for any `lambda > 0`, so a team with ZERO folded rows solves to EXACTLY `vBar` (the event's mean per-team variance), never 0. No pseudo-inverse, no floor, no minimum-match constant."
    - "D-V4: `predict()` is bitwise unchanged on a real replay slice. Both retired `vpr@4.0.0+*.json` digest hex strings are reproduced character-for-character by the re-promoted `vpr@5.0.0+*.json` files, and `displayOnly.test.ts` pins predict output AND post-fold belief/consistency/covariance state against a fixture generated from PRE-change code."
    - "Commit 96e38754's fold is RETIRED, not left alongside. `contribution.ts`, `contributionStats` and `lastContribution` are deleted — that estimator IS CONTEXT's `even-split contribution SD` row (slope 0.179), the worst of the three measured, and it was never published by anything."
    - "The recovery test cannot be defeated by widening a tolerance: it asserts the chosen estimator's slope in [0.7, 1.2] AND asserts each incumbent's slope by RATIO against it, AND asserts all three have statistically indistinguishable correlation with truth (CONTEXT's conclusion 1 — the win is scale, not ranking)."
    - "`varianceOprRidge` is a VERSIONED parameter that is never searched — a named `SEARCH_EXCLUSIONS` entry with its reason as data, joining the existing nine, enforced by `searchSpace.test.ts`'s partition test."
    - "`SIGMA1_CODE_VERSION` 4.0.0 -> 5.0.0 in the SAME commit as the `z.strictObject` shape change (`shrinkagePriorMatches` deleted, `varianceOprRidge` added), with both version files retired and re-promoted via `--from-version`. Neither digest is hand-edited."
    - "The effective league weight lambda=10 actually implies is MEASURED and written into the doc comment, at both a full season and one event — CONTEXT requires the `this is about this robot` claim to be checkable, not asserted."
    - "No doc comment describes retired behaviour: `teamMetrics`'s block records D-01's REVERSAL (and that D-01's accepted adaptation-coupling cost is thereby undone), `consistency.ts`'s three-variance header gains its fourth quantity and records that R is no longer displayed at all, and `stateSnapshot.ts`'s 3->4 paragraph records that shape 4 shipped a fold nothing ever published."
  artifacts:
    - packages/core/algorithms/sigma1/varianceOpr.ts
    - packages/core/algorithms/sigma1/varianceOpr.recovery.test.ts
    - packages/core/algorithms/sigma1/displayOnly.test.ts
    - scripts/measureVarianceOpr.ts
    - docs/models/sigma1-variance-decomposition.md
    - data/algorithm-versions/vpr@5.0.0+tuned-2026-08.json
    - data/algorithm-versions/vpr@5.0.0+tracer-check.json
  key_links:
    - "`applyAllianceUpdate`'s `innovation` -> BOTH `varianceSample` (filter R, update path, unchanged) AND the decomposition's target `e_m^2` (display path, new). ONE innovation, two estimators. Re-deriving the residual in a second place is how the two would silently diverge."
    - "`Sigma1State.perEventVariance` -> `stateSnapshot.ts`'s new sigma1 `scopeKind: \"event\"` row -> `apps/worker/src/scheduled.ts`'s `selectionsFor`. If `selectionsFor` is not extended, the Worker loads no accumulator: every live `+/-` disappears AND the tick writes back an accumulator rebuilt from one match, destroying the event's history. This is the single highest-consequence edit in the task."
    - "`Sigma1Params` field set -> `Sigma1ParamsSchema` (`z.strictObject`) -> every committed `data/algorithm-versions/*.json` -> `digest.test.ts`. Deleting `shrinkagePriorMatches` without retiring and re-promoting in the same commit turns the reproducibility gate red and keeps it red."
    - "`solveEventVariance` -> a module-level `WeakMap` keyed by the ACCUMULATOR OBJECT (never the event key string). Accumulators are immutable and replaced on every fold, so the WeakMap needs no invalidation and can never go stale; keying by event key would publish a pre-match solve after the fold."
---

# Quick Task 260902-varopr — per-team variance decomposition ("variance OPR")

<objective>
Replace the published `±` with a per-team variance decomposition, so the number on the site
communicates how reliable a robot actually is. Both incumbent estimators compress the
between-robot spread so badly (slope 0.179 and 0.312 against known truth) that a true 3-to-25
point range renders as a ~4-point band. The decomposition recovers the scale (0.871–1.032 at
equal correlation and better RMSE). That is the entire case: not better rankings, a number a
human can read.

Every number in `CONTEXT.md` is an already-obtained experimental result. Nothing here
re-derives them — but the synthetic harness that produced them does NOT exist in this tree
(`scratchpad/variance_opr.ts` is absent), so the recovery test is written FRESH from CONTEXT's
description and must reproduce the table. If it does not, that is a finding, not a tolerance
to widen.

**Out of scope, and not to be started:** `apps/web` (owned by another agent), republishing R2
artifacts (blocked until this lands — that is the point), the pending rolling-origin re-tune,
EPA, and OPR.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/260902-varopr-per-team-variance-decomposition/CONTEXT.md
@.claude/CLAUDE.md

@packages/core/algorithms/opr.ts
@packages/core/algorithms/sigma1/index.ts
@packages/core/algorithms/sigma1/contribution.ts
@packages/core/algorithms/sigma1/consistency.ts
@packages/core/algorithms/sigma1/params.ts
@packages/harness/searchSpace.ts
@packages/harness/stateSnapshot.ts
@packages/harness/legacyParams.ts
@.planning/quick/260901-trz-scale-relative-reparameterization-and-ro/PLAN.md
</context>

---

## D-V3 RESOLVED FIRST: event-scoped (option a) — agreed, with one inversion of `opr.ts`'s conclusion

**Agreed: option (a), event-scoped, with (c) filed as the follow-up.** `opr.ts` was read before
agreeing, and it strengthens the case in three ways CONTEXT does not name, while its
ridge conclusion has to be deliberately INVERTED here for a stated reason.

**What `opr.ts` adds to the case for (a).** The precedent is not merely "OPR also solves per
event." It is a complete, already-built path for event-scoped state that Sigma1 currently does
not use: `stateSnapshot.ts` already declares `scopeKind: "event"` in `STATE_ROW_SCOPE_KINDS`
and serializes OPR's per-event observations into it; `apps/worker/src/scheduled.ts`'s
`selectionsFor` already has an `algorithmId === "opr"` branch that loads an event row alongside
the team rows. Option (a) reuses two mechanisms that exist and are in production. Option (b)
would have to invent per-team-pair sparse state AND survive the 90,000-byte seed-row limit that
`SeedRowTooLargeError` already enforces; `X'X` over ~3,500 teams is 12M entries and is not
close. Option (c) needs (a) first regardless.

**Where `opr.ts`'s conclusion must be inverted, and why that is not a contradiction.**
`opr.ts` deliberately deleted its ridge (D-06) and relies on a bare minimum-norm pseudo-inverse.
Its stated reason is that a `lambda` tuned at season pooling (~30-40 observations) shrinks
ratings ~20% at event scope (~12 observations) — "freezing it would triple its effect while
calling it unchanged."

That argument does **not** transfer, because `opr.ts`'s ridge shrank toward **ZERO** and this one
does not. Shrinking a rating toward zero biases the published number downward by construction;
CONTEXT measured the identical failure for a zero-centred variance ridge (at lambda 100, mean
estimate 6.2 against a true 11.6) and D-V2 rejects it for exactly that reason. A ridge centred on
`vBar` preserves the mean exactly (11.7 vs 11.6) at **every** lambda. So the thing `opr.ts`
removed and the thing D-V2 requires are different objects that share a name.

**What DOES transfer is the rank-deficiency observation, and it is the load-bearing one.**
`opr.ts` records that "an event-scoped, quals-only design matrix has no rank at each event's
start" and answers it with a minimum-norm solution, which returns exactly `0`. For a *rating*, 0
is an honest "no information". For a *variance*, 0 is the claim that a robot is perfectly
consistent — a positive false claim, and precisely the honest-uncertainty failure PROJECT.md
forbids. The `vBar`-centred ridge is what makes rank deficiency SAFE here rather than merely
survivable; see the next section.

**One thing in `opr.ts` deliberately NOT copied.** `opr.ts` has no incremental-inverse
machinery — `update()` rebuilds the whole design matrix `M` from a growing observation list and
runs a fresh `SingularValueDecomposition(MtM).solve(Mts)` on every single match. That is O(matches
x teams) of rebuild per match and it stores every raw observation. This task accumulates the
normal equations directly instead (`X'X` and `X'y` folded per alliance row), which is cheaper per
match, bounded by `teams^2` rather than growing with match count, and materially smaller to
serialize. State this in the new module's header so the deviation from the precedent is recorded
rather than looking like an oversight.

## What a team with 1–2 matches actually gets (requirement: no fake-precise number)

The system solved is `(X'X + lambda*I) * beta = X'y + lambda * vBar`, with `X` the 0/1
alliance-membership design matrix over one event, `y` the squared alliance residuals, and `vBar`
the event's mean per-team variance (`mean over rows of e^2/n`).

- **`lambda > 0` makes the matrix positive definite**, so a Cholesky factorization always exists
  and no pseudo-inverse is needed. Rank deficiency stops being a special case and becomes an
  ordinary well-posed solve. Cholesky failing is therefore a real defect (a corrupt accumulator
  or `lambda <= 0`), and must throw loudly with the event key and row count — the same discipline
  `opr.ts`'s finiteness guard already applies.
- **A team with ZERO folded rows solves to EXACTLY `vBar`.** Its row of `X'X` is all zeros and its
  entry in `X'y` is 0, so its equation reduces to `lambda * beta_i = lambda * vBar`. This is not a
  substituted constant — it is what the estimator's own algebra returns when the data says
  nothing. It is also the correct claim: "as uncertain as a typical robot at this event."
- **A team with ONE row** is pulled toward `vBar` with weight `lambda / (1 + lambda)` on the
  diagonal term alone (~91% at lambda=10), further constrained by its two teammates' equations.
  So its published `±` is approximately the event average, displayed beside a `matchCount` of 1.
- **A team with 12 rows** sits at a diagonal-only weight of `10/22 ~ 45%`. The off-diagonal
  co-appearance structure genuinely reduces this, but by how much is an EMPIRICAL question and
  CONTEXT requires it answered with a number rather than an argument. Task 3 measures it.

**No floor, no minimum-match constant, no threshold is added anywhere.** The user withdrew that
question deliberately (2026-09-02) and `contribution.ts`'s header already records the exact
wording. The considered-and-rejected alternative — publish no `±` below 2 matches, as
`contributionSpread` did — is named in the new module's header WITH its reason for rejection: a
sample SD over one point genuinely does not exist (`0/0`), whereas the ridge-regularized solve
has a defined answer at one row, so omitting there would be a threshold rather than a domain
check.

**One domain check IS added, and it is a judgment call the user may overrule.** D-V1 locks
"clamp negatives to 0". A clamped value means the least-squares fit wanted a negative variance
for that team — the additive model failed for it. Publishing `0 ±` would be a positive claim of
perfect consistency. So: the SOLVE clamps to 0 per D-V1 (its return value is always a valid
variance), and `teamMetrics` OMITS the `spread` key when the solved variance is `<= 0`. The clamp
RATE is measured on both the synthetic harness and a real corpus event and written into the doc;
a non-trivial rate is a finding that points at the NNLS refinement D-V1 already names.

## Commit 96e38754: RETIRE it. It is the estimator this task exists to replace.

`contribution.ts` computes, per match, `mean_c^pre(t) + innovation_c / n` and publishes the
sample SD of that series. **That is exactly CONTEXT's `even-split contribution SD` row** — r 0.865,
**slope 0.179**, RMSE 6.76 at a full season; slope 0.201 at one event. It is the worst of the
three measured estimators on the only axis that decides this task.

It is also **not published by anything**. Verified by grep: `contributionStats`,
`lastContribution`, `contributionSpread` and `foldContribution` appear only in `sigma1/index.ts`
(fold + type + re-export), `stateSnapshot.ts` (serialize), their own tests, and the halted
260902-disp plan. `teamMetrics` still returns `sqrt(P + R)` and never reads the accumulator. The
halted task's Task 1 landed; its Task 2 (publish it) never ran.

**Decision: revert the mechanism. Do not coexist.**

1. Coexisting leaves two published-`±`-candidate mechanisms in state with nothing choosing
   between them — the named failure mode.
2. The state is not free: ~800 bytes per team in every D1 seed row and every snapshot, forever,
   for a quantity that will never be published.
3. Its documentation becomes actively false on the day the decomposition ships.
   `contribution.ts`'s header opens "the per-match INFERRED CONTRIBUTION series behind every
   published `±`" and `stateSnapshot.ts`'s 3->4 paragraph says it "IS the published `±` from this
   version on." Leaving those in the tree reproduces the project's own failure-log pattern (a
   document describing a model that was deleted) with the polarity reversed.

**Three things survive the revert and must not be lost:**

- **The `contributionGroups` machinery is CONSUMED, not deleted.** `update()`'s once-per-call
  metric-key -> component-name map, and `applyAllianceUpdate`'s `contributionGroupIndices`
  resolution, are exactly what the decomposition needs to build its per-key targets — including
  the `indexOf(name) === -1` filter that keeps the folded key set and the published key set in
  agreement by construction. Rename to `varianceGroups` / `varianceGroupIndices` and keep the
  reasoning in their comments.
- **The user's 50/50-vs-30/70 example** (CONTEXT's verification bar) moves to the new estimator's
  test in Task 5.
- **The honest caveat** — FRC records no individual robot's score, so the number is
  model-inferred and absorbs partners' variability — is equally true of the decomposition and is
  carried verbatim in substance into the new module's header.

Do NOT `git revert 96e38754`: it also bumped `STATE_SNAPSHOT_SHAPE_VERSION` and two commits have
landed since. Remove the mechanism by hand (Task 2).

## Version and promotion mechanics — three corrections to the brief

Established by reading the tree; each changes what Task 5 does:

**C1 — there is no `migrate4to5`, and the existing migration is FORBIDDEN from being extended.**
The only migration is `migrateAbsoluteToScaleRelative` (3.x -> 4.0.0). Its
`LegacyAbsoluteSigma1ParamsSchema` is a frozen historical record whose own header says "DO NOT
EDIT IT ... If a future parameterization needs its own migration, it gets its own frozen schema
beside this one." Task 5 therefore adds a NEW `Legacy4Sigma1ParamsSchema` + `migrate4to5` +
`SIGMA1_4_TO_5_MIGRATION_TAG` beside the existing pair, and a `startsWith("4.")` branch in
`promote.ts`'s `loadFromVersionFile`. The 3.x branch is not touched.

**C2 — there are exactly TWO committed version files, not six.** `data/algorithm-versions/`
contains `vpr@4.0.0+tracer-check.json` and `vpr@4.0.0+tuned-2026-08.json`. The six artifacts the
brief refers to are almost certainly `reports/reparam-*.json` (six files, written 2026-09-01) —
those are equivalence MEASUREMENTS, are gitignored, are not parameter sets, and nothing parses
them through `Sigma1ParamsSchema`. Two files are retired and re-promoted, not six.

**C3 — the rolling-origin re-tune has NOT completed.**
`.planning/todos/pending/retune-sigma1-rolling-origin.md` is still pending, so there is no tuned
5.0.0 candidate to promote. Both re-promotions are mechanical `--from-version` migrations of the
committed 4.0.0 files. Do not start a re-tune.

**C4 — `digest.test.ts` IS the bitwise gate, and it is exact.**
`computePredictionStreamDigest` hashes `[matchKey, pRedWin, redScore, blueScore]` over a bounded
recorded slice — precisely `predict()`'s output and nothing else. So the D-V4 verification is not
a new instrument: it is the existing gate, running green at every commit boundary, plus one
recorded cross-version check in Task 5 (the new files' digest hex must equal the retired files'
digest hex, character for character).

## Verification conventions (apply to every task)

- Run tests as `pnpm vitest run <path>`. **Never** wrap a test command in `timeout` — it swallows
  output and exits 0 regardless (project memory, `timeout+pnpm false green`).
- **Verify by reading output, not by exit code.** A passing exit code with no test-count line is
  not evidence.
- `pnpm install` exits 1 on this machine (better-sqlite3 node-gyp). Expected; `node_modules` is
  fine. Verify functionally.
- `pnpm typecheck` after every task that changes a type or an interface.
- **Two `packages/harness/payloadBudget.test.ts` failures are PRE-EXISTING and out of scope**
  (`.planning/todos/pending/payload-budget-teams-and-team-page-overage.md`). Record their count
  before Task 1 and confirm it is unchanged at the end; do not fix them, and do not let them mask
  a new failure.
- **No worktree.** This task's verification depends on `data/corpus.sqlite` (gitignored, ~363 MB)
  for the digest gate and the row-size measurement, and gitignored state does not follow a
  worktree (project memory, `Worktree gitignored state`). Work in the main tree.
- Never `Read`, `cat`, or `echo` `.env` (CLAUDE.md, Secrets handling). No task here needs a
  secret; every corpus open is read-only.
- Do not touch `apps/web`. Do not run `git stash` / `git reset` / `git checkout --` — another
  agent may have uncommitted work.
- Commit discipline: one commit per task, suite green at each boundary. Task 5 is unavoidably
  atomic (shape change + version bump + both re-promotions) for the reason 260901-trz Task 3
  records.

---

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: build the display-only instrument BEFORE changing anything</name>
  <files>packages/core/algorithms/sigma1/displayOnly.test.ts, packages/core/algorithms/sigma1/fixtures/display-only-baseline.json</files>
  <precondition>`data/corpus.sqlite` exists and `pnpm vitest run packages/harness/digest.test.ts` is green on the CURRENT tree — this task must record a baseline from unmodified code.</precondition>

  <behavior>
- Replaying a fixed synthetic multi-event stream through `vpr` reproduces, bitwise, a committed
  array of `[matchKey, pRedWin, redScore, blueScore]` tuples.
- After that same replay, every team's `beliefs` (mean and variance per component), `consistency`
  record, `covariance` matrix, `matchCount`, `innovationStats` and `allianceScoreStats` reproduce
  a committed canonical-JSON SHA-256 — one hash over the whole post-fold filter state.
- The fixture is generated once, from pre-change code, and is never regenerated to make a later
  task pass.
  </behavior>

  <action>
This task changes no shipped code. It builds the thing every later task is judged against. A
"predict is unchanged" claim verified after the fact by re-reading the diff is not a measurement.

**Record two things first, into the task's SUMMARY notes (not code):**
1. The `digest.digest` hex string and headline metrics from BOTH
   `data/algorithm-versions/vpr@4.0.0+tuned-2026-08.json` and `vpr@4.0.0+tracer-check.json`.
   Task 5 asserts the re-promoted 5.0.0 files reproduce these exact strings.
2. The current `pnpm vitest run packages/harness/payloadBudget.test.ts` pass/fail counts, so the
   two known failures cannot later hide a third.

**`packages/core/algorithms/sigma1/displayOnly.test.ts` (new), plus its committed fixture.**

Build a deterministic synthetic stream in the test file itself — never `Math.random`; use the
Mulberry32 construction `tune.ts` / `identifiability.ts` / `rp/distribution.ts` already cite to
the same source, copied with a citation rather than imported across a module boundary. Shape it
to exercise the paths that matter, and say in a comment why each is present:

- Two events running CONCURRENTLY (interleaved matches), so an event-partitioned accumulator
  added in Task 4 cannot pass by accident on a single-event stream.
- At least one team appearing at both events (the cross-event process-noise path).
- One alliance that is entirely surrogate, and one whole-alliance-DQ-with-zero-score alliance —
  both of which must fold NOTHING, and both of which Task 4's accumulator must also skip.
- One match with `scoreBreakdownRaw: null` (the D-05 fallback path).
- A season boundary via `carrySeason`, since Task 2 and Task 4 both touch the carry.
- Roughly 40 teams over ~120 matches per event — enough that Task 4's solve is exercised at a
  realistic width.

Generate the fixture by running the test once in a write mode gated behind an explicit env var
(e.g. `SIGMA1_WRITE_DISPLAY_ONLY_BASELINE=1`), then commit it. The test's DEFAULT path only ever
READS the fixture. Put the regeneration instruction and a blunt prohibition in the test's header:
this fixture is evidence that a display-only change stayed display-only, and regenerating it to
make a later task green destroys the only thing it is for. Mirror `digest.test.ts`'s own wording
("a digest mismatch is a finding about the code, not a fixture to refresh").

Hash the post-fold state with the SAME canonicalization discipline `stateSnapshot.ts` already
uses (recursively key-sorted objects, `Map`s as key-sorted entry arrays) so property insertion
order can never flip the hash. Reuse `serializeState` for this rather than writing a second
canonicalizer — but hash ONLY the fields that must not move: `beliefs`, `consistency`,
`covariance`, `matchCount`, `innovationStats`, `lastEventKey`, the RP triple, and the league
row's `componentMean` / `componentConsistency` / `allianceScoreStats`. Deliberately EXCLUDE the
fields Tasks 2 and 4 legitimately change (`contributionStats`, `lastContribution`, and Task 4's
new `perEventVariance`), and name that exclusion list in the test with one line per entry saying
why it is excluded. That list is the test's whole contract: everything not on it is frozen.
  </action>

  <tests>
The test IS the deliverable. Two assertions: the prediction-tuple array, and the state hash.
Also assert the fixture's own `matchCount` and `teamCount` are non-zero, so a fixture that
silently degenerates to an empty replay cannot pass vacuously.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/algorithms/sigma1/displayOnly.test.ts</automated>
    <automated>pnpm vitest run packages/harness/digest.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`displayOnly.test.ts` and its committed fixture exist and pass against unmodified code. Both
4.0.0 digest hex strings and the pre-existing `payloadBudget.test.ts` failure count are recorded
in the SUMMARY. No file under `packages/core/algorithms/sigma1/` other than the two new ones
changed.
  </done>
</task>

<task type="auto">
  <name>Task 2: retire commit 96e38754's never-published contribution fold</name>
  <files>packages/core/algorithms/sigma1/contribution.ts, packages/core/algorithms/sigma1/contribution.test.ts, packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/sigma1.test.ts, packages/core/algorithms/sigma1/params.test.ts, packages/harness/stateSnapshot.ts, packages/harness/stateSnapshot.test.ts</files>
  <precondition>Task 1 is committed and `displayOnly.test.ts` is green.</precondition>

  <action>
Delete the mechanism, keep what the decomposition consumes. Every deletion below is safe because
nothing reads the accumulator: `teamMetrics` still returns `sqrt(P + R)` and never touches it.

**Delete:** `sigma1/contribution.ts`, `sigma1/contribution.test.ts`, the `contributionStats` and
`lastContribution` fields on `Sigma1TeamState`, their initialization in `coldStartTeamState` and
`carrySeason`, the whole per-team contribution fold block in `applyAllianceUpdate`, the
`contribution.js` import and the four-symbol re-export block in `index.ts`, and the
`contributionStats` / `lastContribution` fields plus their doc comment from
`SerializedSigma1TeamState` / `sigma1TeamStateToJson`. Remove the "per-match contribution (D-D3)"
block from `sigma1.test.ts` and the contribution assertions from `params.test.ts` /
`stateSnapshot.test.ts`.

**Keep, renamed:** `update()`'s once-per-call metric-key map (`contributionGroups` ->
`varianceGroups`) and `applyAllianceUpdate`'s index resolution (`contributionGroupIndices` ->
`varianceGroupIndices`). Their existing comments already explain the load-bearing part — that
group names are filtered by the SAME `indexOf(name) === -1` skip `teamMetrics` applies, so the
folded key set and the published key set agree by construction rather than by two lists being
kept in step. Preserve that reasoning verbatim in substance under the new names. Task 4 folds
targets against this map; if it is deleted here it is only reinvented three tasks later, worse.

**Also keep, unchanged:** `innovationByComponent`. Task 4 reads exactly this array. Retarget its
doc comment from the contribution fold to "the decomposition's per-key target, folded in Task 4"
rather than deleting an array that is about to be needed. (If keeping a written-but-unread local
across one commit is unacceptable to the executor, delete it and reinstate it in Task 4 — but say
which was done in the commit message, do not leave it ambiguous.)

**`STATE_SNAPSHOT_SHAPE_VERSION` 4 -> 5.** The team payload's field set genuinely shrank, and
`apps/worker/src/stateStore.ts`'s `readScopedState` filters by `algorithm_id` only — a shape-4
row seeded before this change would still be selected and would deserialize with fields that no
longer exist in the type. Bump, and REWRITE the existing 3 -> 4 paragraph rather than deleting
it: it currently asserts that `contributionStats` "IS the published `±` from this version on",
which was never true of any shipped code. It must instead record that shape 4 shipped a fold from
a halted task, that nothing ever published it, and that shape 5 retired it one commit later. A
future reader tracing a shape-4 seed row needs that sentence to exist.

**Do NOT bump `SIGMA1_CODE_VERSION`.** Commit 96e38754 did not (it changed what Sigma1 stores,
not what it predicts or publishes), and neither does this. `digest.test.ts` must stay green
against the committed 4.0.0 files through this commit — that is itself evidence the revert
touched nothing observable.
  </action>

  <tests>
No new tests. The evidence is that `displayOnly.test.ts` and `digest.test.ts` are both still
green with no fixture regenerated — the removed fold was outside `displayOnly`'s frozen field
list precisely because it was about to be removed.

Update `stateSnapshot.test.ts`'s shape-version assertion to 5 and its round-trip fixtures. Its
lossless-round-trip proof is a continuation-replay digest match, so it will fail loudly if the
field removal changed behaviour rather than just storage.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/algorithms/sigma1/displayOnly.test.ts packages/core/algorithms/sigma1/sigma1.test.ts packages/core/algorithms/sigma1/params.test.ts</automated>
    <automated>pnpm vitest run packages/harness/stateSnapshot.test.ts packages/harness/digest.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`contribution.ts` and its test are gone; no `contributionStats` / `lastContribution` remains in
any type, fold, serializer or test. `varianceGroups` / `varianceGroupIndices` survive with their
reasoning intact. `STATE_SNAPSHOT_SHAPE_VERSION` is 5 and its 3 -> 4 paragraph records what shape
4 actually shipped. `SIGMA1_CODE_VERSION` is still 4.0.0, and both digest files reproduce.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: the decomposition module and the synthetic recovery test — no consumer yet</name>
  <files>packages/core/algorithms/sigma1/varianceOpr.ts, packages/core/algorithms/sigma1/varianceOpr.test.ts, packages/core/algorithms/sigma1/varianceOpr.recovery.test.ts</files>
  <precondition>Task 2 is committed.</precondition>

  <behavior>
- **Rank deficiency, exactly.** A team present in `teamOrder` with zero folded rows solves to
  EXACTLY `vBar` for every key. Assert bitwise equality, not closeness — this is algebra, not an
  approximation.
- **A one-row team** lands strictly between its own row's `e^2/n` and `vBar`, and strictly nearer
  `vBar` at `lambda = 10` than at `lambda = 1`.
- **The mean is preserved.** Over the synthetic league, the mean solved variance is within a few
  percent of the true mean variance at every `lambda` in {0, 1, 10, 100} — D-V2's whole
  justification for centring on `vBar`, asserted rather than trusted. The corresponding
  zero-centred solve is included as a NEGATIVE CONTROL and must visibly wreck the mean at
  `lambda = 100`, reproducing CONTEXT's 6.2-against-11.6 finding. Without that control the
  centring is untested.
- **Recovery, full season (60 matches/team):** the decomposition's slope against known sigma is
  in [0.7, 1.2].
- **Both incumbents are measurably worse, by RATIO:** `slope(varianceOpr) > 2.0 *
  slope(evenSplitContributionSd)` and `slope(varianceOpr) > 1.5 * slope(filterR)`. Absolute upper
  bounds are asserted too (`evenSplit < 0.35`, `filterR < 0.55`), but the ratios are what make the
  test un-defeatable by widening a single tolerance.
- **All three correlate with truth equally.** Pairwise `|r_a - r_b| < 0.05`. CONTEXT's conclusion
  1 is that the ranking information is limited by the DATA — this assertion is what stops the test
  being read as a claim that the decomposition ranks better.
- **Recovery, one event (12 matches/team):** slope in [0.40, 0.75] (CONTEXT measured 0.558), and
  both ratio assertions still hold.
- Determinism: two runs at the same seed produce bitwise identical slopes.
  </behavior>

  <action>
**`packages/core/algorithms/sigma1/varianceOpr.ts` (new).** A leaf in `packages/core` because the
Worker calls `teamMetrics` (`apps/worker/src/scheduled.ts`) and must be able to solve. `ml-matrix`
is already a Worker-bundled dependency (`opr.ts` imports it), so no new dependency is added.

Export:

- `SIGMA1_VARIANCE_OPR_RIDGE = 10` — the documented constant. Its doc comment carries CONTEXT's
  full lambda table (slope 1.03 / 0.87 / 0.35 / 0.14 at 0 / 10 / 100 / 1000), states that 10 is
  near-best slope AND best RMSE, states that anything at 100+ reintroduces exactly the
  league-blending the user rejected, and states that this value is defended by
  `varianceOpr.recovery.test.ts` rather than by Brier — a display quantity cannot move a
  prediction. Task 5 turns this into `DEFAULT_SIGMA1_PARAMS.varianceOprRidge` by IMPORTING this
  constant, never by re-typing 10 (`params.ts`'s own header rule).
- `EventVarianceAccumulator` — `{ rowCount, teamOrder, gram, targets, vBarSums }`. `teamOrder` is
  first-appearance order and is the column index. `gram` is the dense `teamOrder x teamOrder`
  co-appearance matrix, i.e. `X'X`. `targets` maps metric key -> `(X'y)` indexed by `teamOrder`.
  `vBarSums` maps metric key -> `sum over rows of e^2 / n_row`, so `vBar_k = vBarSums[k] /
  rowCount`. Per-row `n` divides individually because a surrogate-reduced alliance genuinely has
  two eligible slots, not three.
- `emptyEventVarianceAccumulator()`.
- `foldVarianceObservation(acc, teams, squaredResidualByKey)` — returns a NEW accumulator, never
  mutates (the immutability contract every other Sigma1 state helper keeps). A team key repeated
  within one row accumulates its `gram` entry (`+1`, never overwritten to a flat 1) for exactly
  the demo-team reason `solveEventOpr`'s own comment records — two demo robots on one alliance
  remap to the same pseudo key and really did occupy two slots.
- `solveEventVariance(acc, lambda)` -> `ReadonlyMap<teamKey, Readonly<Record<metricKey, number>>>`
  of VARIANCES (never SDs — the `consistency.ts` boundary-contract convention: the caller takes
  `Math.sqrt` only at the point of display).

**The solve.** Build `A = gram + lambda * I` and a right-hand-side matrix `B` whose column `k` is
`targets[k] + lambda * vBar_k`. `A` is symmetric positive definite for any `lambda > 0`, so use
`CholeskyDecomposition` from `ml-matrix` and solve ALL key columns against ONE factorization.
Deliberately NOT `SingularValueDecomposition`: `opr.ts` needs a pseudo-inverse because it has no
ridge, and this one is well-posed by construction — say so in the comment, because reusing SVD
"to match the precedent" would be copying a workaround for a problem this solve does not have. If
Cholesky reports the matrix is not positive definite, THROW with the event context and the row
count; that means `lambda <= 0` or a corrupt accumulator, and folding a corrupt variance into
every published spread is the failure `opr.ts`'s finiteness guard already refuses.

Clamp each solved value at 0 (D-V1) and note in the comment that a proper NNLS is the documented
future refinement, not a blocker, and that the clamp RATE is measured (Task 6's doc).

**Memoize the solve** in a module-level `WeakMap<EventVarianceAccumulator, SolvedEventVariance>`.
The key MUST be the accumulator OBJECT, never the event key string: accumulators are immutable
and a new object is produced on every fold, so the WeakMap self-invalidates and can never return
a pre-match solve after a fold; keying by event key would do exactly that. This is what keeps
`publish.ts`'s per-match `teamMetrics` loop (line ~1649, already documented as costing 9-26 ms per
match) from paying a fresh factorization per call. A memo of a pure function of an immutable
object is referentially transparent — state that, since a module-level cache in `packages/core`
otherwise reads like a purity violation.

**The header must carry, in its own words:**
- What the model is (D-V1): `E[e_m^2] = sum over teams i on alliance m of sigma_i^2`, linear in
  the unknowns with a 0/1 design matrix, structurally identical to OPR with squared residuals as
  the target and variance as the unknown.
- Why the ridge is centred on `vBar` and not 0 (D-V2), with the measured numbers.
- Why this INVERTS `opr.ts`'s no-ridge conclusion without contradicting it (the two ridges shrink
  toward different things; a variance shrunk toward 0 claims perfection).
- The rank-deficiency answer in full, as written in this plan's own section above.
- Why the normal equations are accumulated rather than the raw observations re-solved every match
  the way `opr.ts` does.
- The honest caveat carried from `contribution.ts`: FRC records no individual robot's score, so
  this is model-inferred and never measured, and a team's estimate absorbs its partners'
  variability. Plus the second one CONTEXT names: `e_m` carries mean-model error as well as robot
  noise, so the estimate absorbs some of the filter's own inaccuracy (measured: 20 pts of
  mean-model noise inflates the mean estimate from 9.8 to 13.9).
- That correlation with truth is ~0.86 at a full season and ~0.55 at one event — the `±` is a
  genuinely noisy estimate of consistency, especially early, and the comment must say so rather
  than implying precision.

**`varianceOpr.recovery.test.ts` (new) — the permanent guard.** Seeded Mulberry32 defined in the
test file, never `Math.random`. 60 teams, true per-team sigma spanning 3-25 points, alliances
drawn at random, alliance residual `e_m ~ Normal(0, sqrt(sum of teammates' sigma^2))`. Two arms:
60 matches/team and 12 matches/team.

Compute all three estimators on the SAME generated data — that shared draw is the point, since it
removes the sampling difference from the comparison:
1. **the decomposition** (this module);
2. **even-split contribution SD** — implemented directly in the test file (`contribution.ts` is
   deleted; this is its only remaining reason to exist, and the test is its correct home because
   the test's whole job is a three-way comparison);
3. **filter R** — `max(0, e^2 - sumP) / n` folded per team, matching what
   `applyAllianceUpdate` computes. Use a small fixed `sumP` and record it, so the arm is
   reproducible.

Define "slope" explicitly in the test (ordinary least squares of estimate on truth, WITH an
intercept) and put the definition in a comment — a slope computed through the origin is a
different number and CONTEXT's table would not be comparable. Report `r`, `slope` and `RMSE` for
all three arms and print the table on failure so a regression says which estimator moved.

Write the anti-tolerance-widening rationale INTO the test file, above the ratio assertions: a
future revert to either incumbent must fail this test, and it must not be possible to make it
pass by loosening one bound.

**Also measure, and assert, the effective league weight** (CONTEXT's fourth verification bar).
For each team compute `w_i = (est_i - vBar) / (est_i_at_lambda_0 - vBar)`, the team's own weight
against the league prior, skipping teams whose `lambda = 0` estimate is within 1e-9 of `vBar`
(the ratio is undefined there, and silently dividing would produce a garbage median). Report the
MEDIAN `1 - w_i` — the effective league share — at 60 matches/team and at 12 matches/team.
Compare it in the test's own output to the retired display blend's `1 - 12/(12+8) = 0.40` at a
12-match team. Assert only that the figure is finite and in [0, 1]; the NUMBER goes in Task 6's
doc. If the one-event figure EXCEEDS 0.40, D-V2's "far lighter" claim is false — do not write that
phrase anywhere, write the measured comparison instead, and surface it as a finding in the
SUMMARY. Do not change `lambda`: D-V2 is locked.

**Record but do not gate** the one-event slope at `lambda = 0` alongside `lambda = 10`, since
CONTEXT's table has no one-event `lambda = 0` row and the number is free to obtain here. It goes
in Task 6's doc as an observation, not as an argument for changing a locked decision.
  </action>

  <tests>
`varianceOpr.test.ts` — the unit behaviours: fold immutability; repeated key accumulates to 2 in
`gram`; per-row `n` divides `vBarSums` individually (a two-eligible-team row is not divided by 3);
the zero-row team solves bitwise to `vBar`; the one-row bracketing; `lambda = 0` on a
rank-deficient system throws rather than returning zeros; the memo returns the identical object
for the same accumulator and a DIFFERENT one after a fold; a solved value clamps at 0 for a
constructed negative case.

`varianceOpr.recovery.test.ts` — the behaviours listed above, all arms.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/algorithms/sigma1/varianceOpr.test.ts packages/core/algorithms/sigma1/varianceOpr.recovery.test.ts</automated>
    <automated>pnpm vitest run packages/core/algorithms/sigma1/displayOnly.test.ts packages/harness/digest.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`varianceOpr.ts` exists, exported, tested, with NO consumer — it lands tested and alone (the
260901-trz Task 1 pattern). The recovery test reproduces CONTEXT's table within its stated bounds
and pins both incumbents by ratio. The effective league weight is measured at both horizons and
recorded in the SUMMARY. Nothing else in the tree changed; both digests still reproduce.
  </done>
</task>

<task type="auto">
  <name>Task 4: fold the accumulator into Sigma1 state, serialize it, and load it in the Worker — still publishing nothing</name>
  <files>packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/sigma1.test.ts, packages/harness/stateSnapshot.ts, packages/harness/stateSnapshot.test.ts, apps/worker/src/scheduled.ts</files>
  <precondition>Task 3 is committed. `data/corpus.sqlite` exists — the row-size measurement replays a real event.</precondition>

  <action>
**`Sigma1State` gains `perEventVariance: ReadonlyMap<string, EventVarianceAccumulator>`**, keyed
by `eventKey`, exactly as `OprState.perEvent` is (D-01's reasoning applies unchanged:
`replay.ts`'s `buildSeasonStream` interleaves concurrent events into one chronological stream, so
resetting on an `eventKey` change would corrupt every simultaneously-running event; partition,
never reset). `carrySeason` resets it to empty for the same reason it reset the contribution
accumulators: points under one season's scoring rules are not points under another's, and a
series crossing a boundary would mostly measure the rule change.

**Fold in `applyAllianceUpdate`, from the innovations already computed.** The per-key squared
residuals are:
- per component `c`: `innovationByComponent[c] ** 2`;
- `TOTAL_METRIC_KEY`: `(sum over componentOrder of innovationByComponent) ** 2`;
- each group `g` in `varianceGroupIndices`: `(sum over g's indices of innovationByComponent) ** 2`.

Take them from `innovationByComponent` — the array Task 2 preserved — and NEVER re-derive the
residual from beliefs a second time. A comment must say why: `varianceSample` (filter R, update
path) and this target are two estimators over ONE innovation, and a second derivation is exactly
how they would silently diverge. State the relationship plainly, because it is the crispest
description of what this task does: filter R subtracts `sumP` and divides the remainder equally
across teammates; the decomposition least-squares-solves the whole event's system for the same
quantity. Same input, different inversion.

Fold exactly the rows `applyAllianceUpdate` already folds — `allianceTeams` (rating-eligible,
demo-remapped, surrogate-filtered), with the existing `allianceTeams.length === 0` early return
covering the all-surrogate and whole-alliance-DQ-zero cases. Add NO second eligibility rule; that
discipline is stated all over this module and is what keeps `predict`, `update` and the RP fold
from drifting apart.

**`stateSnapshot.ts`: sigma1 gains `scopeKind: "event"` rows.** One row per event, payload
`{ rowCount, teamOrder, gram, targets, vBarSums }`, emitted from `sortedEntries(state.perEventVariance)`
in the same shape `serializeOprState` already uses for its own event rows. `deserializeSigma1State`
rebuilds the map from `row.scopeKind === "event"`. Bump `STATE_SNAPSHOT_SHAPE_VERSION` 5 -> 6 with
its own paragraph following the file's established form: name what the payload gained, and state
the load-bearing reason (a shape-5 row deserializes with `perEventVariance` undefined, and
`teamMetrics` would then publish no spread at all on live traffic — the shape check is the only
thing that turns that into a loud `LeagueRowShapeVersionError` naming the re-seed as the fix).

**MEASURE the event row against the 90,000-byte budget.** `emitSeedSql` throws
`SeedRowTooLargeError` above `DEFAULT_MAX_STATEMENT_LENGTH`, and a single row cannot be split.
Replay the LARGEST event in the corpus by team count (find it with a query; a champs division at
~75-80 teams is the realistic worst case) and record the emitted event row's byte length in the
SUMMARY. Add a test asserting it stays under the budget with the measured headroom stated.
Estimated ~45 KB at 80 teams and 17 metric keys (a dense `gram` of ~6,400 small integers plus 17
float vectors), so it should fit with roughly 2x headroom — but this is an estimate and the
measurement decides. **If it exceeds the budget**, the named fallback is to store `gram` as an
upper-triangular sparse record of co-appearing pairs only (a team co-appears with ~50 others, so
that is roughly a 3x reduction); do NOT reach for rounding the target sums, which would trade a
size problem for a reproducibility one.

**`apps/worker/src/scheduled.ts`'s `selectionsFor` MUST return an event selection for sigma1 too.**
This is the highest-consequence edit in the task. Today the `{ scopeKind: "event", scopeKeys:
[eventKey] }` selection is returned only for `algorithmId === "opr"`. Without extending it, a live
tick loads no accumulator, so (a) every published `±` vanishes from the merged artifacts, and
worse (b) `update()` rebuilds the accumulator from that tick's one or two matches and
`selectChangedRows` writes it back, destroying the whole event's accumulated history one tick at
a time. Restructure so the event selection is returned for every algorithm that has event-scoped
state, and put that consequence in the function's comment so it cannot be "simplified" back.
Confirm (do not assume) that `readScopedState` batches multiple selections into one D1 call, so
the subrequest budget is unchanged — OPR already passes two selections, which is strong evidence
but not proof.

**Measure the added CPU on both hot paths and record both figures.** (i) The Worker tick: one
`teamMetrics` call per event per algorithm, so one factorization; a Cholesky at n=80 with 17
right-hand sides is on the order of 300k flops and should be well under a millisecond, but the
project has ALREADY had a tick killed at the CPU budget (project memory,
`worker-tick-exceeds-cpu-budget`), so the figure gets measured and written down rather than
reasoned about. (ii) `publish.ts`'s per-match `teamMetrics` loop, whose own comment records 9-26
ms per match today — with the `WeakMap` memo this should be one factorization per fold rather
than per call, and the measurement is what proves the memo is actually hitting.

**Publish nothing yet.** `teamMetrics` is untouched in this task. `displayOnly.test.ts` and
`digest.test.ts` must both still be green with no fixture regenerated — that is the evidence that
adding the accumulator moved neither `predict()` nor the filter.
  </action>

  <tests>
Extend `sigma1.test.ts`: the accumulator is partitioned by event across an interleaved
two-event stream (a team playing at both events contributes to both accumulators and neither is
contaminated); an all-surrogate alliance and a whole-alliance-DQ-zero alliance fold NO row
(assert `rowCount` unchanged, not merely that no throw occurred); `carrySeason` empties the map;
the folded `TOTAL` target equals the square of the summed per-component innovations for a
hand-computable fixture.

Extend `stateSnapshot.test.ts`: shape version 6; event rows round-trip losslessly through the
existing continuation-replay digest proof; the largest-real-event row size assertion.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/algorithms/sigma1/sigma1.test.ts packages/core/algorithms/sigma1/displayOnly.test.ts</automated>
    <automated>pnpm vitest run packages/harness/stateSnapshot.test.ts packages/harness/digest.test.ts packages/harness/publish.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`Sigma1State.perEventVariance` is folded, serialized as `scopeKind: "event"` rows at shape
version 6, and loaded by the Worker via an extended `selectionsFor`. The largest real event's row
size and both CPU figures are measured and recorded. `teamMetrics` is unchanged, and
`displayOnly.test.ts` plus both digests are green with no fixture regenerated.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: publish it — teamMetrics reads the decomposition; SIGMA1_CODE_VERSION 5.0.0 and both re-promotions</name>
  <files>packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/params.ts, packages/core/algorithms/sigma1/params.test.ts, packages/core/algorithms/sigma1/sigma1.test.ts, packages/harness/searchSpace.ts, packages/harness/searchSpace.test.ts, packages/harness/legacyParams.ts, packages/harness/legacyParams.test.ts, packages/harness/promote.ts, packages/harness/promoteOverride.test.ts, data/algorithm-versions/vpr@5.0.0+tuned-2026-08.json, data/algorithm-versions/vpr@5.0.0+tracer-check.json</files>
  <precondition>Task 4 is committed. `data/corpus.sqlite` exists (both re-promotions replay their recorded bounded slice). Both retired 4.0.0 digest hex strings are recorded from Task 1.</precondition>

  <behavior>
- **The user's own example, executable:** on a constructed event where team A's alliances land at
  50 and 50 against prediction and team B's at 30 and 70, with matched partner structure so the
  two are otherwise identical, A's published `TOTAL` spread is strictly smaller than B's.
- **The published spread is a LOOKUP, not a reconciliation:** for every published key `K`, the
  spread is `sqrt` of the decomposition's solved variance for key `K`. No key's spread is
  assembled from a different construction than another's.
- **`predict()` is bitwise unchanged.** The re-promoted `vpr@5.0.0+tuned-2026-08.json` and
  `vpr@5.0.0+tracer-check.json` carry `digest.digest` strings CHARACTER-FOR-CHARACTER equal to
  their retired 4.0.0 predecessors, and `displayOnly.test.ts`'s prediction array and state hash
  are unchanged with no fixture regenerated.
- **P is gone from the display.** No `belief.variance` and no `shrinkConsistency` result reaches
  any returned `TeamMetric.spread`.
- **`shrinkagePriorMatches` is unconstructible.** `Sigma1ParamsSchema.parse` on an object carrying
  it throws (`z.strictObject`), and no `Sigma1Params` field lands in neither
  `SIGMA1_SEARCH_SPACE` nor `SEARCH_EXCLUSIONS`.
  </behavior>

  <action>
The one unavoidably atomic commit, for the reason 260901-trz Task 3 records: the instant a field
leaves `Sigma1Params`, every committed `data/algorithm-versions/*.json` fails `z.strictObject`
and `digest.test.ts` goes red, and `SearchableParamKey` stops typechecking in the same edit.
There is no ordering that leaves an intermediate boundary green. `pnpm typecheck` is the primary
work list. **No `as Sigma1Params` cast is added anywhere** — that is how the invariants
`Sigma1ParamsSchema` enforces get bypassed, the defect 03-REVIEW WR-01 closed once.

**1. `teamMetrics` reads the decomposition.** Resolve the solve ONCE per distinct `eventKey`
within the call (a local `Map<string, Solved>` over the memoized `solveEventVariance`), keyed off
each team's existing `lastEventKey`. Then, per team:
- `value` is UNCHANGED at every level. Expectation is linear however the components covary, and
  this task changes only the uncertainty. Say so, as the existing comment already does.
- `spread` for every key is `Math.sqrt(solved[team][key])`, OMITTED when the team has no
  `lastEventKey`, when its event has no accumulator, or when the solved variance is `<= 0` (the
  clamped case — see this plan's domain-check section; publishing `0 ±` would be a false claim of
  perfection, and omission is the same "the statistic does not exist" discipline
  `contributionSpread` used, not a floor).
- DELETE the `shrinkConsistency` call, the `Math.max(resolved.minConsistencyVariance, ...)` floors
  on `teamTotalVariance` / `subsetVariance`, the `teamOwnComponentVarianceSum(teamState)` call in
  the TOTAL branch, and the `groupPosterior` accumulation in the group branch.

**Two consequences to handle explicitly, not silently.**
(a) `teamOwnComponentVarianceSum`'s doc comment currently explains that its `seed` parameter
exists to keep `allianceComponentVarianceSum`'s floating-point addition ORDER byte-identical, and
that `teamMetrics` shares the function so the alliance-additivity identity holds by construction.
`teamMetrics` no longer calls it. Keep the function and its `seed` (the match path still needs
it), and rewrite the comment to say the sharing ended and why. (b) `sigma1.test.ts`'s Test 1, the
alliance-additivity identity — "three teammates' TOTAL spreads sum in quadrature to the alliance
variance `predict` reports" — is now FALSE by design: the published spread and `predict()`'s
variance are different quantities again. Do not delete that test silently. Replace it with a test
that pins the property that IS still true (`predict()`'s own `redScoreVarianceOwn` is still the
alliance sum of per-team `P + R`, computed from state, independent of what `teamMetrics`
publishes) and record the retirement in the test file and in `teamMetrics`'s doc comment. Losing
that identity is a real cost of D-V4 and must be visible.

**2. `params.ts` — the shape change.** DELETE `shrinkagePriorMatches` from the interface, from
`DEFAULT_SIGMA1_PARAMS` and from `Sigma1ParamsSchema`. `consistency.ts`'s
`SIGMA1_SHRINKAGE_PRIOR_MATCHES` constant and its `shrinkConsistency` function SURVIVE as exported
and tested — the residual/variance door pattern in that module keeps functions whose contract is
still correct even with no live caller — but each gains a paragraph saying it is no longer on any
path and why, exactly as `foldConsistency` already carries one.

ADD `varianceOprRidge: number`, defaulted by IMPORTING `SIGMA1_VARIANCE_OPR_RIDGE` from
`varianceOpr.ts`, never re-typing 10. Its doc comment: a VERSIONED, never-searched display
constant; the value's justification lives in `varianceOpr.ts` and is defended by the recovery
test. Confirm `varianceOpr.ts` imports nothing from `params.ts` so no TDZ import cycle is created
(the failure `params.ts`'s header warns about at length).

Bump `SIGMA1_CODE_VERSION` `"4.0.0"` -> `"5.0.0"` in the established comment style: name this
quick task and D-V1/D-V2/D-V3/D-V4; state that the parameter set's SHAPE changed so no 4.0.0 file
parses as a 5.0.0 one; state that `teamMetrics`'s observable output moved and `predict()`'s and
`update()`'s DID NOT, with the reproduced digest as the evidence; record that both files were
retired and re-promoted in THIS SAME COMMIT via `--from-version` running the new code and neither
digest was hand-edited. MAJOR because this changes the number on every team page.

**3. `searchSpace.ts`.** Remove `shrinkagePriorMatches`'s bound. Add `varianceOprRidge` to
`SEARCH_EXCLUSIONS`, joining the existing nine, with its reason AS DATA — in the register's own
voice, covering: it is a DISPLAY quantity, and D-01's objective is Brier over the predicted win
probability, which is structurally blind to `teamMetrics` entirely (the same objective-blindness
argument the three RP entries already carry, but total rather than partial); it was selected
against KNOWN synthetic sigma, which is a strictly better instrument for this question than Brier
could ever be; and D-V4 states the constraint outright — a display quantity cannot move a
prediction, so it is not tunable by the objective. `searchSpace.test.ts`'s partition test enforces
the placement.

**4. `legacyParams.ts` — a NEW frozen schema BESIDE the existing one.** Do not touch
`LegacyAbsoluteSigma1ParamsSchema`; its own header forbids it and prescribes this exact remedy.
Add `Legacy4Sigma1ParamsSchema` (the frozen 4.0.0 shape, `z.strictObject`),
`migrate4to5(legacy): Sigma1Params` (drop `shrinkagePriorMatches`, add `varianceOprRidge` from the
default, copy everything else unchanged, then parse the result through `Sigma1ParamsSchema` so an
invariant-violating legacy set cannot migrate into a valid-looking new one), and
`SIGMA1_4_TO_5_MIGRATION_TAG`. The new schema gets the same DO-NOT-EDIT header. Note in
`migrate4to5` that a dropped tuned `shrinkagePriorMatches` is information LOST — the tuned set
carries a searched value for it — and that this is correct rather than lossy-by-accident: the
parameter has no consumer, so there is nothing for the value to mean.

**5. `promote.ts`.** Add a `sourceVersion.codeVersion.startsWith("4.")` branch to
`loadFromVersionFile`, mapping through `migrate4to5` and tagging `paramShapeMigration` with the
new tag. Leave the 3.x branch untouched. Update the refusal message's "only 3.x is migratable"
text and the function's doc comment.

**6. Retire and re-promote, in this commit.** `git rm` both `vpr@4.0.0+*.json` and run
`pnpm promote --from-version` against each retired file (from git history if already removed;
sequence the removal after the promotions if that is simpler). Then perform the D-V4 check
explicitly: assert each new file's `digest.digest` equals the retired hex string recorded in
Task 1, character for character, and record both strings in the SUMMARY. **If either differs,
STOP.** `predict()` moved, the central constraint of this task is broken, and no amount of
re-promotion fixes it — find the change instead.
  </action>

  <tests>
Add to `sigma1.test.ts`: the 50/50-vs-30/70 example against the real published spread; every
published key carries a spread sourced from the decomposition (assert against a directly-computed
`solveEventVariance` result for the same state, so a divergent second construction would fail);
a team with `lastEventKey === null` publishes `value` and no `spread`; the retired-identity
replacement test described above.

`params.test.ts`: `Sigma1ParamsSchema.parse` rejects an object carrying `shrinkagePriorMatches`;
`DEFAULT_SIGMA1_PARAMS.varianceOprRidge === SIGMA1_VARIANCE_OPR_RIDGE` (identity, not a literal).

`legacyParams.test.ts`: `migrate4to5` on the real retired `tuned-2026-08` params produces a set
that parses clean, drops the retired key, and carries the default ridge; a 4.0.0 object with an
unknown key is refused.

`searchSpace.test.ts`: the partition assertion covers `varianceOprRidge`;
`screenGridFor("varianceOprRidge" as never, 5)` throws quoting its recorded reason.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/algorithms/sigma1/</automated>
    <automated>pnpm vitest run packages/harness/searchSpace.test.ts packages/harness/legacyParams.test.ts packages/harness/promoteOverride.test.ts packages/harness/promotedOverrides.test.ts</automated>
    <automated>pnpm vitest run packages/harness/digest.test.ts packages/harness/stateSnapshot.test.ts packages/harness/publish.test.ts packages/harness/pageArtifacts.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`teamMetrics` publishes the decomposition at every key; P and the old shrinkage are gone from the
display. `shrinkagePriorMatches` is deleted and `varianceOprRidge` is a versioned, excluded
parameter. `SIGMA1_CODE_VERSION` is 5.0.0 and both `vpr@5.0.0+*.json` files exist, produced by
`pnpm promote --from-version` running the new code. **Both digest hex strings match their retired
4.0.0 predecessors exactly**, and `displayOnly.test.ts` passes with no fixture regenerated.
  </done>
</task>

<task type="auto">
  <name>Task 6: the measurement document, the doc-comment sweep, and the follow-ups</name>
  <files>docs/models/sigma1-variance-decomposition.md, scripts/measureVarianceOpr.ts, package.json, packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/consistency.ts, packages/core/algorithms/sigma1/varianceOpr.ts, packages/harness/stateSnapshot.ts</files>
  <precondition>Task 5 is committed.</precondition>

  <action>
**`scripts/measureVarianceOpr.ts` + a `package.json` script** taking NO `--env-file` (this path
opens the corpus read-only and makes no network call; CLAUDE.md's secrets boundary). It replays a
named season against the promoted 5.0.0 set and reports, per event and pooled: the distribution of
published TOTAL spreads (min / p10 / median / p90 / max), the CLAMP RATE (fraction of team-key
pairs whose solved variance hit 0), the fraction of teams with no published spread and why, and
`vBar` per event. Its purpose is to answer "does the number on the site actually spread out now"
against real data rather than only against synthetic truth.

Run it on one full recent season and record the output. **Sanity check before committing:** the
real-corpus TOTAL spread distribution must be visibly wider than what the retired `sqrt(P + R)`
produced. If it is not, the synthetic recovery and the real corpus disagree and that is a finding
to report, not a document to write around.

**`docs/models/sigma1-variance-decomposition.md` (committed;** `reports/` is gitignored and would
lose it). Structure:
- What the published `±` now means, in one paragraph a non-specialist can read.
- The model (D-V1) and the ridge (D-V2), with CONTEXT's two measurement tables reproduced and the
  recovery test's own reproduction beside them.
- **The effective league weight** from Task 3, at both horizons, compared numerically to the
  retired display blend's 0.40 at a 12-match team. CONTEXT requires this number to exist so the
  "this is about this robot" claim stays checkable. If the one-event figure exceeds 0.40, say so
  plainly — do not soften it.
- The one-event `lambda = 0` vs `lambda = 10` slope observation from Task 3, labelled an
  observation, not a proposal.
- The real-corpus distribution, the clamp rate, and the row-size and CPU figures from Task 4.
- **Honest limitations, as their own section, not footnotes:** correlation with truth is ~0.86 at
  a full season and ~0.55 at one event, so the `±` is a genuinely noisy estimate of consistency,
  especially early; `e_m` carries mean-model error as well as robot noise (20 pts of mean-model
  noise inflates the mean estimate from 9.8 to 13.9); the estimate is model-inferred and absorbs
  partners' variability, because FRC records no individual robot's score; `lambda` is a fixed
  count of pseudo-observations, so its effective shrinkage depends on event size and a 75-team
  champs division is not a 40-team regional; and the `±` resets per event under D-V3(a).

**The doc-comment sweep. Each of these currently describes behaviour that no longer exists:**
- **`teamMetrics`'s block (`sigma1/index.ts`).** It records D-01 as "a locked, one-way user
  decision that supersedes the earlier constraint outright" and spells out the accepted cost
  ("an adaptation on/off comparison can no longer attribute the published `±` independently of the
  tuning parameter"). It must now record the REVERSAL: P is the filter's uncertainty about the
  MEAN, not the robot's variability, and including it is part of why the display compressed;
  D-V4 reverses D-01; and the adaptation-coupling cost D-01 accepted is thereby UNDONE, since the
  published number no longer contains P at all. Reversing a decision that was recorded as
  one-way is exactly the kind of thing this codebase writes down rather than quietly overwriting.
- **`consistency.ts`'s header.** Its top-stated failure mode is conflating three "variance"
  quantities, and there is now a fourth: the per-team decomposed variance `sigma_i^2` from
  `varianceOpr.ts` — the only one that is DISPLAYED. Add it to the list with the same treatment
  the 4.0.0 `sigma^2` entry got (what KIND of thing it is, and what mistaking it for a neighbour
  would cost). And correct the three existing entries: `consistency` is no longer "ONE OF THE TWO
  TERMS behind every published spread" but a purely internal Kalman-gain input; the "estimate
  uncertainty (P)" entry is no longer displayed; the "full predictive variance" entry no longer
  shares a construction with `teamMetrics`.
- **`stateSnapshot.ts`.** Confirm the 3->4 paragraph rewritten in Task 2 and the 4->5 / 5->6
  paragraphs added in Tasks 2 and 4 read as one coherent history.
- **`varianceOpr.ts`.** Fill in the measured effective league weight and clamp rate, which were
  not available when the module was written.

**Follow-ups — file each as a todo under `.planning/todos/pending/`:**
- **D-V3 option (c)**: pool per-event solves into a season figure per team. Name it as the
  designed successor, not a nice-to-have; the per-event reset is a real limitation of what ships.
- **NNLS** instead of clamping negatives at 0 (D-V1 names it), carrying the measured clamp rate as
  its motivation.
- **Re-tune under the new display** if the pending rolling-origin re-tune has not yet run — note
  that `shrinkagePriorMatches` no longer exists in the search space, which shrinks it by one
  dimension.

**Reconcile existing pending todos:** `sigma1-cold-start-zero-plus-minus.md` is very likely
resolved or restated by this work (a cold-start team now solves to `vBar`, not to a suspicious
zero) — read it, and either close it with a note pointing here or rewrite it to whatever remains
true. Update `regenerate-published-artifacts-post-trz.md` and
`remeasure-baseline-fingerprint-post-trz.md` to record that the 5.0.0 bump makes both strictly
required before the site can show the new number.

Finally, confirm the pre-existing `payloadBudget.test.ts` failure count recorded in Task 1 is
unchanged.
  </action>

  <tests>
No new unit tests. The measurement script's output IS its verification, and every claim the
document makes is already pinned by a test committed in Tasks 3-5.
  </tests>

  <verify>
    <automated>pnpm measure:variance-opr --season 2025</automated>
    <automated>pnpm vitest run packages/core/algorithms/sigma1/ packages/harness/digest.test.ts packages/harness/stateSnapshot.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`docs/models/sigma1-variance-decomposition.md` is committed carrying the model, both measurement
tables, the measured effective league weight against the retired blend, the real-corpus
distribution and clamp rate, and the honest-limitations section. No doc comment in
`sigma1/index.ts`, `consistency.ts`, `varianceOpr.ts` or `stateSnapshot.ts` describes retired
behaviour — in particular `teamMetrics` records D-01's reversal and `consistency.ts` names its
fourth quantity. Follow-ups filed, existing todos reconciled, `payloadBudget.test.ts` failure
count unchanged.
  </done>
</task>

</tasks>

<verification>
- `pnpm vitest run packages/core/algorithms/sigma1/` — green, including the recovery test's full
  three-estimator table at both horizons.
- `pnpm vitest run packages/harness/` — green except the two pre-existing `payloadBudget.test.ts`
  failures recorded in Task 1, at the same count.
- `pnpm typecheck` — clean.
- Both `vpr@5.0.0+*.json` digest hex strings equal their retired 4.0.0 predecessors, character for
  character.
- `displayOnly.test.ts` passes with its fixture never regenerated after Task 1.
</verification>

<success_criteria>
The published `±` is the per-team variance decomposition at every metric key the site shows;
`predict()` and the filter are provably untouched; commit 96e38754's estimator is gone rather
than sitting alongside; a team with one match reads as uncertain because the math says so; and
`lambda`'s value, its implied league weight, and the estimator's honest limits are all written
down as measured numbers rather than asserted.
</success_criteria>

<output>
Create `.planning/quick/260902-varopr-per-team-variance-decomposition/SUMMARY.md` when done.
</output>
