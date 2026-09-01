---
phase: quick-260901-is2
plan: 01
type: execute
wave: 1
depends_on: []
mode: quick
files_modified:
  - packages/core/scoring/brier.ts
  - packages/core/scoring/brier.test.ts
  - packages/core/algorithms/epa.ts
  - packages/core/algorithms/epa.test.ts
  - packages/core/algorithms/opr.ts
  - packages/core/algorithms/opr.test.ts
  - packages/core/algorithms/breakdown/fallback.ts
  - packages/core/algorithms/sigma1/consistency.ts
  - packages/core/algorithms/sigma1/consistency.test.ts
  - packages/core/algorithms/sigma1/covariance.ts
  - packages/core/algorithms/sigma1/covariance.test.ts
  - packages/core/algorithms/sigma1/index.ts
  - packages/core/algorithms/sigma1/params.ts
  - packages/core/algorithms/sigma1/sigma1.test.ts
  - packages/core/algorithms/sigma1/innovationVariance.test.ts
  - packages/harness/promote.ts
  - packages/harness/promoteOverride.test.ts
  - packages/harness/stateSnapshot.ts
  - packages/harness/stateSnapshot.test.ts
  - packages/harness/cli.ts
  - packages/harness/manifests.ts
  - packages/harness/manifests.test.ts
  - packages/harness/promotedOverrides.test.ts
  - packages/harness/baselineFingerprint.test.ts
  - packages/harness/fixtures/extract-digest-slice.ts
  - scripts/measureRewindGap.ts
  - data/algorithm-versions/vpr@3.0.0+tracer-check.json
  - data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json
autonomous: false
requirements:
  - D-Q1
  - D-Q2
  - D-Q3
  - D-Q4

estimate:
  tokens: 150000
  raw_tokens: 95000
  tasks: 6
  confidence: low

must_haves:
  truths:
    - "D-Q1: a teammate on an alliance that scores EXACTLY its predicted total does not move — `applyComponentUpdate` credits `currentMean + (allianceValue - predictedAllianceTotal)/n`, with ONE predicted-total pass per alliance computed from the pre-update snapshot."
    - "D-Q2: the published ± is estimated from innovations (`max(0, innovation^2 - sumP)/n`), not from gain-weighted corrections. A synthetic league with a known per-match sigma recovers that sigma to within ~20%, where the retired estimator understated it ~5x."
    - "D-Q2: `residualsByTeam` is UNCHANGED and still feeds `rp/state.ts`'s cross-covariance fold — the RP subsystem is byte-identical in shape, only downstream of a differently-sized R."
    - "D-Q3: a `pRedWin === 0.5` prediction against a decided match enters the winner-accuracy denominator and is counted incorrect. An actual TIE stays excluded. `noCallCount` is still reported. Brier is unchanged."
    - "D-Q4: OPR's logistic scale is `standardDeviation(state.allianceScoreStats, OPR_FALLBACK_SCORE_SD) / OPR_SCALE_DIVISOR_K`, folded leak-free in `update()` from matches already replayed, with a documented `count < 2` fallback of 25."
    - "D-13: every algorithm whose observable output changed carries a bumped code version in the SAME commit as the change — epa 1.1.0 -> 2.0.0, opr 3.1.0 -> 4.0.0, SIGMA1_CODE_VERSION 2.1.0 -> 3.0.0."
    - "Every committed `data/algorithm-versions/*.json` digest is produced by `promote.ts` running the final code — never hand-edited. `digest.test.ts` is green at every commit boundary."
    - "The promoted `tuned-2026-08` set's provenance says, in machine-readable form, that `linkC` was overridden post-search and that its recorded `objective` does NOT describe the shipped parameter set."
    - "No doc comment describes retired behavior: `consistency.ts`'s three-variance header, `sigma1/index.ts`'s `teamMetrics` block, `brier.ts`'s header contract, and `opr.ts`'s scale comment all describe what the code now does."
  artifacts:
    - packages/core/algorithms/sigma1/innovationVariance.test.ts
    - packages/harness/promoteOverride.test.ts
    - data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json
    - data/algorithm-versions/vpr@3.0.0+tracer-check.json
  key_links:
    - "`applyAllianceUpdate`'s per-component `innovation` + `pooledVariance - measurementNoise` (= sumP) -> the per-team variance sample -> BOTH `foldConsistencyVariance` (R fed back into the Kalman gain) AND the covariance sample matrix diagonal. The two must be the same number or the published ± and the filter's own R disagree."
    - "`Sigma1League.componentConsistency` is `shrinkConsistency`'s prior. It MUST fold the same innovation-based sample, or a thin-history team is blended toward a quantity ~25x too small and the fix silently does nothing for new teams."
    - "`OprState.allianceScoreStats` -> `serializeOprState`'s league row -> `STATE_SNAPSHOT_SHAPE_VERSION`. The read path (`apps/worker/src/stateStore.ts`) filters by `algorithm_id` only, NEVER by version, so a stale league row IS reachable after the version bump — the shape bump is what makes it fail loudly instead of deserializing to `undefined`."
    - "`brier.ts`'s accuracy denominator -> `score.ts`'s `aggregateScores` -> `promote.ts`'s `headlineMetrics.winnerAccuracy` -> `digest.test.ts`'s exact assertion. Changing brier without re-promoting turns the reproducibility gate red."
---

# Quick Task 260901-is2 — Model correctness fixes from the adversarial review

<objective>
Implement the four LOCKED changes in `CONTEXT.md` (D-Q1 EPA error-split attribution,
D-Q2 innovation-based R for the published ±, D-Q3 a no-call counts as a miss,
D-Q4 OPR's expanding-window logistic scale), with the D-13 version bumps and the
re-promotion of `data/algorithm-versions/*.json` by the final code.

Every number in `CONTEXT.md` is an already-obtained experimental result. Nothing here
re-derives them; the job is to make the shipped modules reproduce them, and to leave
behind durable tests that pin the properties those measurements demonstrate.

**Out of scope, and not to be started:** a full hyperparameter re-tune under the new R
estimator; regenerating published R2 artifacts or the compare page's accuracy figures;
the cold-start `0 ± 0` issue. Task 6 files these as todos. **Do not touch `apps/web`** —
another agent is working there concurrently.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/260901-is2-model-correctness-fixes-from-adversarial/CONTEXT.md
@.claude/CLAUDE.md

@packages/core/scoring/brier.ts
@packages/core/algorithms/epa.ts
@packages/core/algorithms/opr.ts
@packages/core/algorithms/sigma1/index.ts
@packages/core/algorithms/sigma1/consistency.ts
@packages/core/algorithms/sigma1/covariance.ts
@packages/core/algorithms/sigma1/params.ts
@packages/harness/promote.ts
@packages/harness/digest.test.ts
</context>

---

## Task ordering and why

Ordered by blast radius, with two hard constraints that fix the ends of the sequence.

**`brier.ts` goes first (Task 1).** It changes scoring semantics for *every* algorithm and
for every metric the harness reports. Anything committed after it is measured under the
final rule; anything committed before it would be measured under a rule about to change.
It also has an unavoidable coupling: `scoreSet` -> `aggregateScores` ->
`promote.ts`'s `headlineMetrics.winnerAccuracy` -> `digest.test.ts`'s *exact* assertion.
Both committed `vpr@2.1.0+*.json` files record `winnerAccuracy` computed under the old
denominator, so Task 1 must regenerate them (see Task 1's own note — this is a re-promote,
not a hand-edit) or the reproducibility gate goes red and stays red.

**The three algorithm changes (Tasks 2, 3, 5) are independent of each other.** EPA, OPR and
Sigma1 share no state, no estimator and no test fixtures. They are ordered
smallest-radius-first: EPA touches one function and its own test file; OPR additionally
touches the D1 state serializer; Sigma1 touches three modules, the code version, and every
file that names a promoted version path.

**Task 4 (the `promote.ts` override) sits immediately before Task 5** because Task 5 is its
only consumer, and because it changes no algorithm output — it can land green on its own.

**The re-promotion goes last (inside Task 5).** A digest is only meaningful if the code that
produced it is the code that ships. The `vpr@3.0.0+*.json` digests depend on Sigma1's code
*and* on `brier.ts`'s accuracy rule (via `headlineMetrics`), so they must be generated after
both are final. They do **not** depend on EPA or OPR — but running them last costs nothing
and removes the need to reason about that.

**Commit discipline.** Each task is one commit and the suite must be green at each commit
boundary. Two tasks bundle a re-promotion into their own commit because the alternative is a
knowingly-red tree: this is exactly the precedent `sigma1/params.ts`'s `2.0.0 -> 2.1.0`
comment already documents ("retired and re-promoted ... in the same commit").

---

## Verification conventions (apply to every task)

- Run tests as `pnpm vitest run <path>`. **Never** wrap a test command in `timeout` — it
  swallows output and exits 0 regardless (project memory, `timeout+pnpm false green`).
- **Verify by reading output, not by exit code.** A passing exit code with no test-count
  line is not evidence.
- `pnpm install` exits 1 on this machine (better-sqlite3 node-gyp). That is expected and is
  not a failure; `node_modules` is fine. Verify functionally.
- `pnpm typecheck` after every task that changes a type or an interface.
- Never `Read`, `cat`, or `echo` `.env` (CLAUDE.md, Secrets handling). No task here needs a
  secret; `promote.ts` opens the corpus read-only.

---

<tasks>

<task type="auto">
  <name>Task 1: D-Q3 — a no-call counts as a miss</name>
  <files>packages/core/scoring/brier.ts, packages/core/scoring/brier.test.ts, data/algorithm-versions/vpr@2.1.0+tracer-check.json, data/algorithm-versions/vpr@2.1.0+tuned-2026-08.json</files>
  <precondition>`reports/tune-joint-off.json` and `reports/tune-tracer-repromote-2.1.0.json` both exist (`reports/` is gitignored; without them the two 2.1.0 files cannot be re-promoted and this task cannot complete). `data/corpus.sqlite` exists.</precondition>

  <action>
In `scoreSet`, a prediction with `pRedWin === 0.5` against a decided match now enters the
accuracy denominator and is always counted incorrect. Concretely: the guard becomes
`if (!isTie)` — the denominator increments for every non-tie prediction — and the
correctness test only credits a strict preference, so a `0.5` prediction increments the
denominator and never the numerator. `noCallCount` still increments and is still reported.
An actual tie stays excluded from accuracy (there is no winner to have predicted) and is
still scored in Brier against 0.5. Brier scoring is untouched.

Rewrite the file's header block, which currently states the retired contract in prose
("It is excluded from the winner-accuracy denominator..."). The replacement must say what
the code now does and why: a model that declines to call a match has failed to predict it;
counting it as a miss is the user's decision (D-Q3), and it also removes a real comparison
defect — OPR declines ~7% of every season, so the old denominator was scoring OPR on a
strictly easier population than VPR and EPA, which made every OPR-vs-VPR accuracy comparison
invalid. Keep the tie and empty-set contracts in the header exactly as they are; they did
not change. Update `ScoreSetResult.winnerAccuracy`'s own doc comment (it currently says
"non-tie, non-no-call").

Then regenerate the two committed version files, because `aggregateScores` feeds
`promote.ts`'s `headlineMetrics.winnerAccuracy` and `digest.test.ts` asserts it exactly.
This is a re-promotion by the current code, not an edit:

```
pnpm promote --from reports/tune-joint-off.json --name tuned-2026-08
pnpm promote --from reports/tune-tracer-repromote-2.1.0.json --name tracer-check
```

Both write back to the SAME filenames (`SIGMA1_CODE_VERSION` is still 2.1.0 here) and both
must reproduce their existing `predictionStreamSha256` byte-for-byte — the algorithm did not
change, only the metric did. If a `predictionStreamSha256` moves in this task, stop: that is
a real defect, not an expected consequence.
  </action>

  <tests>
**Rewrite (encodes the retired contract):** `packages/core/scoring/brier.test.ts`
- L27 `"excludes a 0.5 prediction from the accuracy denominator and counts it as a no-call"`
  -> rename to `"counts a 0.5 prediction as a MISS, not an exclusion (D-Q3)"`. Same fixture;
  `winnerAccuracy` becomes `0.5` (1 correct of 2), `noCallCount` stays 1, `count` stays 2,
  Brier assertion unchanged.
- L78 `"returns null winner accuracy when every prediction is excluded (all ties/no-calls)"`
  -> the fixture is one tie + one `0.5`-vs-red. Under D-Q3 the denominator is 1 and the
  answer is `0` (a real score), not `null`. Rename and re-assert. Then ADD a replacement
  null case that still holds: a set of ties ONLY, which is the sole remaining way the
  denominator reaches 0.

**Add:** a case proving the two exclusions are now different things — `{pRedWin: 0.5,
actualWinner: "red"}` alongside `{pRedWin: 0.5, actualWinner: "tie"}`: `noCallCount === 2`,
`tieCount === 1`, `winnerAccuracy === 0` over a denominator of 1.

**Must stay green (a failure here is a bug in the change, not an outdated contract):**
L5 (hand-computed fixture, no 0.5s), L41 (tie exclusion), L53 (empty set), L62, L68, L90
(JSON round-trip). Also `packages/harness/score.test.ts` and
`packages/core/scoring/calibration.test.ts`.

**Arithmetic prediction for the re-promotion, check it against the promote output:** both
files' slices are the same 265 matches with 3 ties, and both currently record a denominator
of 247 — so both carry 15 no-calls. The new denominator is 262 for both.
`tuned-2026-08`: 181/247 = 0.7327935222672065 becomes 181/262 = 0.6908396946564885.
`tracer-check`: 178/247 = 0.7206477732793523 becomes 178/262 = 0.6793893129770993.
If promote prints something else, investigate before committing.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/scoring/brier.test.ts packages/harness/score.test.ts packages/core/scoring/calibration.test.ts</automated>
    <automated>pnpm vitest run packages/harness/digest.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`scoreSet` counts a no-call as a miss; ties still excluded; Brier unchanged. `brier.ts`'s
header describes the new contract and names the OPR-comparison defect it closes. Both
`vpr@2.1.0+*.json` files were regenerated by `pnpm promote` (never edited), each reproducing
its prior `predictionStreamSha256` with only `headlineMetrics.winnerAccuracy` and
`promotedAt` moved. `digest.test.ts` green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: D-Q1 — EPA attributes the alliance ERROR, not the alliance total</name>
  <files>packages/core/algorithms/epa.ts, packages/core/algorithms/epa.test.ts</files>

  <behavior>
- A teammate on an alliance whose observed component total equals its predicted total does
  NOT move (innovation 0 -> `twoStageEwma(mean, mean, percent, 1) === mean`), for every
  component and for every teammate regardless of how unequal their means are.
- Two teammates with different means on the same alliance both move by the SAME absolute
  amount `percent * err/n` for a given component — the error is shared, the level is not.
- With one rating-eligible team (`n === 1`) the new formula is arithmetically identical to
  the retired even split, so every existing `n === 1` fixture is unchanged.
  </behavior>

  <action>
In `applyComponentUpdate`, compute the alliance's predicted total ONCE per component, before
the per-team loop, from the map passed in (the pre-update snapshot) — mirroring Statbotics'
`attribute_match`, which computes one `pred_bd` per alliance and then loops teams. Every
teammate must be attributed against the SAME prediction; computing it inside the loop off
the progressively-updated `nextComponents` would silently make attribution order-dependent.

Per component: `predictedAllianceTotal = sum over teams of (currentComponents[c] ?? coldStart)`,
using the identical `?? coldStart` fallback the function already applies per team. Then feed
each teammate `currentMean + (allianceValue - predictedAllianceTotal) / teams.length` into
`twoStageEwma`, replacing `observedShare = allianceValue / teams.length`.

Do NOT change: the D-04 foul cross-attribution, the D-05 fallback path (`fallbackObserved`,
`foulsCommittedCarryForward`), the D-08 elim-weight and counter divergences, `twoStageEwma`,
`epaPercentFunc`, `carrySeason`, or the DQ/demo/surrogate handling.

Update the module header's "Component attribution" divergence bullet: it currently says "a
component's alliance total is divided evenly across its rating-eligible teammates — Statbotics
has no direct analog here". That is now false in both halves. Replace it with the error-split
description and record that this is now FAITHFUL to `post_process_attrib`
(`err = observed - predicted`, `attrib = epa + err/n`), so it moves out of the deliberate-
divergence list. Also update `applyComponentUpdate`'s own doc comment ("evenly split per
component — see file header on component attribution").

Bump `version: "1.1.0+baseline"` -> `"2.0.0+baseline"`, with a comment in the same style as
the existing 1.0.0 -> 1.1.0 bump: name this quick task, name D-Q1, and state that
`update()`'s observable output changed (D-13: no version string may stand for two different
computations). Note in that comment that this is a MAJOR bump because it changes attribution
for every multi-team alliance, not an edge case.

Record the measured effect in the header or at the use site so the reason survives: OLS slope
vs Statbotics `epa.total_points` 0.489 -> 0.841, rating SD 12.5 -> 17.4 (Statbotics 18.7),
2025 quals Brier 0.1950 -> 0.1589. The slope lands at 0.84 rather than 1.00 because of the
divergences the module documents on purpose — say so, or a future reader will read 0.84 as
an unfinished job.
  </action>

  <tests>
**Add to `epa.test.ts`** (CONTEXT's named verification bar):
- `"a teammate on an alliance that hits its prediction exactly does not move"` — three
  rating-eligible teams with deliberately UNEQUAL prior means (e.g. 40 / 10 / 10 on
  `autoLeave`), a breakdown whose `autoLeavePoints` is exactly 60, all three surrogate-free.
  Assert each team's `autoLeave` is unchanged to 1e-10 and each `teamMatchCounts` incremented.
  This is the test that fails loudly against the retired even split, which would have fed the
  40-point robot a 20 and dropped it to 33.33.
- Negative control in the same block: change the observation to 90 and assert all three teams
  moved by the SAME delta (`percent * 30/3 = 10 * percent`), proving the error is shared and
  the test above is not vacuous.

**Must stay green — no edits expected:** every existing `epa.test.ts` case. This is a
falsifiable prediction, not a hope: each existing update fixture is either `n === 1`
(L94 hand-computed EWMA, L126 elim divergence, L355 D-05 fallback attribution — all built
with two or three surrogates so only one team is rating-eligible) or starts from
`epa.initState` where every teammate carries the identical cold-start mean (L447/L478
breakdown-parse cases, L514 demo cases, L586 DQ cases). In both situations
`(allianceValue - n*mean)/n + mean === allianceValue/n`, so the two formulas coincide
exactly. **If any existing epa test goes red, the new code is wrong — do not edit the test.**
The single exception to inspect rather than assume is L262 (event-boundary invariance),
which asserts an equality between two runs and therefore survives even if its absolute
numbers move.

**Also check (version string):** `packages/harness/baselineFingerprint.test.ts` L262 and
`scripts/deleteRetiredAlgorithmObjects.test.ts` L443 both contain the literal
`"1.1.0+baseline"`. Neither is coupled to the live module — the first asserts what a
COMMITTED historical fingerprint in `data/baselines/` records, the second builds a mock
manifest response. Leave both assertions alone; Task 6 fixes the now-stale prose around the
first one.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/algorithms/epa.test.ts packages/core/algorithms/carryover.test.ts</automated>
    <automated>pnpm vitest run packages/harness/baselineFingerprint.test.ts packages/harness/manifests.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`applyComponentUpdate` performs one predicted-total pass per alliance-component from the
pre-update snapshot and attributes `currentMean + err/n`. The no-movement test and its
negative control pass. Every pre-existing epa test passes UNEDITED. `epa.version` is
`2.0.0+baseline` with a D-13 bump comment naming D-Q1. No doc comment still describes an
even split.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: D-Q4 — OPR's logistic scale becomes an expanding-window SD</name>
  <files>packages/core/algorithms/opr.ts, packages/core/algorithms/opr.test.ts, packages/core/algorithms/breakdown/fallback.ts, packages/harness/stateSnapshot.ts, packages/harness/stateSnapshot.test.ts</files>

  <behavior>
- With fewer than 2 folded alliance scores, `predict` uses `OPR_FALLBACK_SCORE_SD / k`
  (25 / 1.1) as its scale — never 0, never NaN.
- After folding a spread of alliance scores, the scale equals
  `standardDeviation(state.allianceScoreStats, 25) / 1.1` computed from ONLY the matches
  already passed to `update` — a prediction made at match `i` is unchanged by folding
  match `i+1` (Pitfall EPA-1, leak-free by construction).
- A whole-alliance-DQ zero score is excluded from the fold, matching `epa.ts`/`sigma1`.
  </behavior>

  <action>
Add `allianceScoreStats: ExpandingStats` to `OprState`, initialised via
`emptyExpandingStats()` in `initState`. Fold BOTH alliances' raw `result.redScore` /
`result.blueScore` in `update()` via `foldObservation`, subject to the same
`isFullyDqZeroScoreAlliance` exclusion the module already computes for `redRow`/`blueRow`
— reuse those existing predicates rather than recomputing. Import from
`packages/core/scoring/expandingStats.ts`; do not write a second Welford.

Two placement details that decide correctness:
1. The fold must run on every `qm` match that survives the `isFullyDemoAlliance` guard,
   including the `newRows.length === 0` early-return path — an all-surrogate alliance still
   has a real observed score. Move the fold above that early return and make that path
   return the state with the updated stats rather than the untouched `state`.
2. The scale is SEASON-wide even though OPR's ratings are event-scoped. That is deliberate:
   it is a link-function scale, not a rating. Say so in a comment. No `carrySeason` is needed
   — `opr` implements none, and `cli.ts`'s `runSeasons` therefore starts OPR from
   `initState` every season (see its doc comment, "deliberately left OUT of
   `initialStates`"), which is exactly the season-wide-but-not-cross-season scope wanted.

Replace `OPR_LOGISTIC_SCALE = 10`. Verified: nothing under `apps/` references it, and
`packages/core/algorithms/breakdown/fallback.ts` L22 only mentions it in prose. Export
instead:
- `OPR_SCALE_DIVISOR_K = 1.1` — fitted on tune seasons 2022-2024 only.
- `OPR_FALLBACK_SCORE_SD = 25` — the `count < 2` fallback, matching `EPA_FALLBACK_SCORE_SD`
  in value. Declare it locally with a comment naming EPA's constant and why it is not
  imported: `epa.ts` imports `ratingEligibleTeams` from `opr.ts`, so importing back would
  create a module cycle (same reasoning `sigma1/params.ts`'s header records for its own
  constants).

`logisticWinProbability` keeps its shape; `predict` now computes
`scale = standardDeviation(state.allianceScoreStats, OPR_FALLBACK_SCORE_SD) / OPR_SCALE_DIVISOR_K`
and passes it in.

Rewrite the `OPR_LOGISTIC_SCALE` doc comment wholesale — it currently claims a fixed 10 was
"chosen so a margin of roughly one typical alliance-score SD ... maps to a confident-but-
unsaturated probability (margin=10 -> ~0.73)", which was the actual defect (per-season optima
are 19, 28, 21, 31, 75). The replacement must record: why a per-season fitted constant is
LEAKAGE (it uses the outcomes it predicts); that the expanding form adapts within a season
too and matches or beats the leaky per-season ceiling in all five seasons; the measured
Brier improvement (4.1%-18.8%, elims 2.6%-19.0% except 2022 elims at -3.2%); and that this
does NOT reduce OPR's no-call rate, because a no-call comes from a zero predicted margin and
`0/scale === 0` for any scale — under D-Q3 those now count as misses, which is expected.

Update `breakdown/fallback.ts` L22's cross-reference so it does not name a deleted constant.

Bump `version: "3.1.0+baseline"` -> `"4.0.0+baseline"` with a D-13 comment in the existing
style, naming this task and D-Q4.

**State serialization.** `OprState` gained a field, so `serializeOprState` /
`deserializeOprState` must carry it. It is a league-scoped quantity — put it in
`SerializedOprLeague` alongside `snapshotShapeVersion`, exactly as the sigma1 and epa league
rows already carry their own `allianceScoreStats`. Then bump
`STATE_SNAPSHOT_SHAPE_VERSION` 2 -> 3, per that constant's own doc comment ("Bumped whenever
a league payload's FIELDS change shape"). This bump is load-bearing, not ceremony:
`apps/worker/src/stateStore.ts`'s `readScopedState` filters by `algorithm_id` only and never
by `algorithm_version`, so a stale OPR league row IS reachable after the version bump — the
shape check is the only thing that turns "deserialized `allianceScoreStats` as `undefined`"
into a loud `LeagueRowShapeVersionError`. Add that reasoning to the bump comment.
  </action>

  <tests>
**Rewrite (encodes the retired contract):** `packages/core/algorithms/opr.test.ts`
- L65 `describe("OPR_LOGISTIC_SCALE")` — the constant is gone. Replace with a block asserting
  `OPR_SCALE_DIVISOR_K > 0` and `OPR_FALLBACK_SCORE_SD > 0`, and that
  `OPR_FALLBACK_SCORE_SD === EPA_FALLBACK_SCORE_SD` (pins the "matching" claim so the two
  cannot silently drift apart).
- L154 the export-surface test asserts an EXACT sorted symbol list. Update it:
  `OPR_LOGISTIC_SCALE` out, `OPR_FALLBACK_SCORE_SD` and `OPR_SCALE_DIVISOR_K` in.
- L165 `"identifies itself as opr, version 3.1.0+baseline"` -> `4.0.0+baseline`.

**Add:**
- `count < 2` fallback: a fresh `opr.initState([])`, predict a match with a non-zero
  synthetic rating spread, and assert the implied scale equals
  `OPR_FALLBACK_SCORE_SD / OPR_SCALE_DIVISOR_K` by inverting the logistic from the returned
  `pRedWin` and margin. Assert it is NOT 10 (proves the old constant is gone from the path).
- Expanding scale: fold a sequence of `qm` matches with a known alliance-score spread, then
  assert the implied scale equals
  `standardDeviation(finalState.allianceScoreStats, 25) / 1.1` to 1e-9.
- Leak-freeness: capture the prediction for match `i`, fold match `i+1`, re-predict match `i`
  from the OLD state, assert byte-identical. (This proves the property; it does not merely
  restate the implementation.)
- DQ exclusion: a whole-alliance-DQ zero score does not fold into `allianceScoreStats`
  (`count` unchanged), while the opposing alliance's score does.
- Round-trip: `packages/harness/stateSnapshot.test.ts` — extend the existing OPR round-trip
  case (L644) to assert `allianceScoreStats` survives `serializeState`/`deserializeState`
  with identical `count`/`mean`/`m2`.

**Must stay green:** `opr.test.ts` L82 (tracer, first match at exactly 0.5 — score 0 both
sides, scale-independent), L201 (literal-zero cold start), L466 (probability strictly inside
(0,1)), L489 (exactly 0.5 at zero margin), L177/L223/L258 (solve behaviour), L511-L860
(surrogate / DQ / demo policy). None of these depend on the scale's value. A red here is a
bug in the fold placement, most likely the early-return path in point 1 above.
`stateSnapshot.test.ts` L449/L455 uses `STATE_SNAPSHOT_SHAPE_VERSION - 1` and is
bump-agnostic by construction; `apps/worker/test/readScopedStateSql.test.ts`'s literal
`{"snapshotShapeVersion":2}` payloads are opaque rows that are never deserialized — leave
them.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/algorithms/opr.test.ts packages/core/scoring/expandingStats.test.ts</automated>
    <automated>pnpm vitest run packages/harness/stateSnapshot.test.ts packages/harness/replay.test.ts packages/harness/cli.season-carry.test.ts</automated>
    <automated>pnpm vitest run apps/worker</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
OPR's scale is `expandingAllianceScoreSD / 1.1` with a documented `count < 2` fallback of 25.
`OPR_LOGISTIC_SCALE` is gone from the code and from every doc comment that named it.
`OprState.allianceScoreStats` round-trips through the D1 serializer;
`STATE_SNAPSHOT_SHAPE_VERSION` is 3 with a comment explaining why the version-agnostic read
path makes the bump load-bearing. `opr.version` is `4.0.0+baseline`. Worker suite green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: promote.ts gains an auditable single-parameter override</name>
  <files>packages/harness/promote.ts, packages/harness/promoteOverride.test.ts</files>

  <behavior>
- `applyParamOverrides(params, ["linkC=0.5"])` returns a set differing only in `linkC`.
- An unknown key throws, naming the key and listing valid keys.
- A non-finite or non-numeric value throws.
- `adaptationEnabled` accepts only `true`/`false`; a number throws.
- The result still parses through `Sigma1ParamsSchema`, so an override that breaks a
  cross-parameter invariant (e.g. `processNoiseEventBoundary=0.1`) is rejected, not written.
  </behavior>

  <action>
**Finding first, because it determines the shape:** `promote.ts` has NO override path today.
Its CLI is `--from`, `--name`, `--id`, `--slice-season`, `--slice-events`, `--adaptation`,
`--code-version`, and the promoted params are exactly
`Sigma1ParamsSchema.parse(winnerCandidate.params)` with `rpMonteCarloDraws` restored. There
is therefore no way to ship the D-Q2 `linkC = 0.5` set from `reports/tune-joint-off.json`,
whose recorded winner carries `linkC = 1.2398308984401685`.

The precedent path — hand-authoring a derived search artifact under `reports/`, as
`reports/tune-tracer-repromote-2.1.0.json` did for the 2.0.0 -> 2.1.0 bump — would work
mechanically and is not a hand-edited digest. It is rejected here for two reasons: `reports/`
is gitignored, so the divergence would live only in an untracked file that the committed
provenance merely names; and the artifact's `objective` field would be carried forward as if
it described the overridden set, which it does not. The committed file would look exactly
like a fresh tune. CONTEXT is explicit that this must not happen.

Add instead the smallest mechanism that puts the divergence IN the committed file:

1. CLI: `"set-param": { type: "string", multiple: true }` and
   `"provenance-note": { type: "string" }`. Passing `--set-param` WITHOUT
   `--provenance-note` is an error — an unexplained divergence from the search winner is the
   thing this mechanism must not enable.
2. Export a pure `applyParamOverrides(params: Sigma1Params, specs: readonly string[]):
   Sigma1Params` (exported so it is testable without a corpus replay; `main` is not
   exported). Parse `key=value`, reject unknown keys against `SIGMA1_PARAM_KEYS`, reject
   non-finite numbers, handle the one boolean field explicitly.
3. Apply it AFTER `Sigma1ParamsSchema.parse(winnerCandidate.params)` and BEFORE the
   `rpMonteCarloDraws` restore, then let the existing `PromotedVersionSchema.parse` re-validate
   — so an override that violates a cross-parameter invariant throws before anything is
   written, with no new call site added (the strengthened schema already does this work).
4. Extend `ProvenanceSchema` with three OPTIONAL fields, so every existing committed file
   keeps validating:
   - `paramOverrides: z.record(z.string(), z.union([z.number(), z.boolean()])).optional()` —
     machine-readable, e.g. `{ "linkC": 0.5 }`.
   - `note: z.string().min(1).optional()` — the human sentence.
   - `objectiveAppliesToPromotedParams: z.boolean().optional()` — written as `false` whenever
     any override is present. This is what stops the file reading as a fresh tune: the
     recorded `objective` is the SEARCH winner's, and with an override it no longer describes
     the shipped parameter set. Populate all three only when overrides exist; leave them
     absent otherwise so a no-override promotion writes byte-identical provenance to today's.
5. Print the overrides in `promote.ts`'s closing console output alongside the digest, so a
   promotion that silently applied one is impossible to miss.

Document all of this in `promote.ts`'s header block: what the flag is for, what it is NOT for
(it is not a tuner, and it is not a way to reshape a search result into a claim), and the
rule that a digest is never hand-edited — the override changes the INPUT to a real replay,
which then produces a real digest.
  </action>

  <tests>
**Add `packages/harness/promoteOverride.test.ts`** (new file — keep it separate from
`digest.test.ts`, which owns the corpus-backed reproducibility gate):
- happy path: single override changes exactly one field, deep-equal on the rest.
- repeated `--set-param` style: two specs both applied.
- unknown key throws, message contains the key.
- `linkC=abc`, `linkC=NaN`, `linkC=Infinity` all throw.
- `adaptationEnabled=true` / `=false` accepted; `adaptationEnabled=1` throws.
- invariant violation: `processNoiseEventBoundary=0.1` (below `processNoiseWithinEvent`)
  is rejected by `Sigma1ParamsSchema`, proving the override cannot construct an invalid set.
- `PromotedVersionSchema` round-trip with and without the three new provenance fields,
  proving both existing committed files' shape still validates.

**Must stay green:** `packages/harness/promotedOverrides.test.ts` (different file, different
subject — the CLI's promoted-version RESOLUTION), `packages/harness/digest.test.ts`,
`packages/harness/tune.test.ts`, `packages/harness/searchSpace.test.ts`. Nothing about
algorithm output changes in this task; a red anywhere else means the schema change was not
additive.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/harness/promoteOverride.test.ts packages/harness/promotedOverrides.test.ts packages/harness/digest.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
`promote.ts` accepts `--set-param key=value` (repeatable) only alongside
`--provenance-note`, applies it through `Sigma1ParamsSchema`, and records
`paramOverrides` / `note` / `objectiveAppliesToPromotedParams: false` in the committed file.
A no-override promotion writes provenance byte-identical to today's. No digest is edited
anywhere. New test file green; existing harness suites unchanged.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: D-Q2 — the published ± is estimated from innovations, plus the 3.0.0 re-promotion</name>
  <files>packages/core/algorithms/sigma1/consistency.ts, packages/core/algorithms/sigma1/covariance.ts, packages/core/algorithms/sigma1/index.ts, packages/core/algorithms/sigma1/params.ts, packages/core/algorithms/sigma1/innovationVariance.test.ts, packages/core/algorithms/sigma1/consistency.test.ts, packages/core/algorithms/sigma1/covariance.test.ts, packages/core/algorithms/sigma1/sigma1.test.ts, packages/harness/cli.ts, packages/harness/manifests.ts, packages/harness/manifests.test.ts, packages/harness/promotedOverrides.test.ts, packages/harness/fixtures/extract-digest-slice.ts, scripts/measureRewindGap.ts, data/algorithm-versions/vpr@3.0.0+tracer-check.json, data/algorithm-versions/vpr@3.0.0+tuned-2026-08.json</files>
  <precondition>Task 4 is committed (`--set-param` / `--provenance-note` exist). `reports/tune-joint-off.json` and `reports/tune-tracer-repromote-2.1.0.json` exist. `data/corpus.sqlite` exists.</precondition>

  <behavior>
- On a synthetic league where the truth is known by construction (60 teams, true per-team
  per-match sigma = 12, model assumptions exactly satisfied, promoted params), the published
  TOTAL `spread` recovers 12 to within ~20% — the retired estimator returns ~2.3, understating
  it ~5x.
- For one alliance-component, the per-team variance sample is exactly
  `max(0, innovation^2 - sumP) / n`, and the covariance sample matrix's DIAGONAL entry for
  that component equals the same number (`d_c^2 - sumP_c/n` with `d_c = innovation_c/sqrt(n)`).
  These are two views of one quantity and must be numerically identical.
- `residualsByTeam` is byte-identical to before, and `rp/state.ts`'s cross-covariance fold
  receives exactly what it received before.
  </behavior>

  <action>
**The defect.** `sigma1/index.ts` publishes `spread = sqrt(P + R)` where R is an EWMA of
gain-weighted corrections `K * innovation`, `K = P/(sumP + R)`. As the filter converges K
shrinks, so R decays toward its floor no matter how much the team actually varies. The
published ± therefore measures how much the filter is still adjusting, not the team's
match-to-match spread.

**The estimator.** Innovations are observable and `E[innovation^2] = sumP_teammates +
R_alliance`, so an unbiased per-team sample for one component is
`max(0, innovation^2 - sumP) / n`.

Everything needed already exists inside `applyAllianceUpdate`'s per-component loop:
`innovation`, `allianceTeams.length`, and `pooledVariance` (which is `sumP + measurementNoise`,
so `sumP = pooledVariance - measurementNoise`). Compute `sumP` directly from
`teammateBeliefs` rather than by subtraction, so the reader can see it is the prior-variance
sum and not a leftover.

**`consistency.ts` — add a sibling entry point, do not reuse `foldConsistency`.**
`foldConsistency` takes a RESIDUAL and squares it internally; the honest estimator produces a
VARIANCE directly, and passing `Math.sqrt(sample)` through the old door would be exactly the
conflation this module's header names as its top failure mode. Add:

```
foldConsistencyVariance(prior: number, varianceSample: number, alpha?: number): number
```

— a plain EWMA with no squaring. Keep `foldConsistency` exported and tested; its `residual`
door is still the correct shape for anything that genuinely holds a residual.

**`covariance.ts` — same pattern.** The per-team covariance folds
`outer(d, d) - diag(sumP/n)` where `d_c = innovation_c / sqrt(n)`: the diagonal is floored at
0 BEFORE the EWMA, off-diagonals are left signed and then shrunk toward the diagonal exactly
as the module already does. The off-diagonals are required — phase-group spreads need
`Cov(auto_i, auto_j)` and no client can reconstruct them. Add:

```
ewmaCovarianceSample(prior, sample: readonly (readonly number[])[], alpha?, shrinkage?): number[][]
```

folding a pre-computed CxC sample matrix. Refactor `ewmaCovariance(prior, residual, ...)` to
delegate to it via `outer(residual, residual)` so there is exactly ONE EWMA-plus-shrinkage
implementation. Note in `ewmaCovariance`'s doc comment that it is no longer on Sigma1's
update path and name the sibling that is — a live-looking function that nothing calls is the
next reader's trap.

**`sigma1/index.ts` wiring.** In `applyAllianceUpdate`:
- per component, compute `sumP` and `varianceSample = Math.max(0, innovation**2 - sumP) / n`;
  every teammate on that alliance receives the SAME sample (there is no way to recover a
  team-differentiated innovation from a summed observation — the identical limitation
  `componentGains` and the normalized-innovation block already document).
- fold `varianceSample` into each team's `consistency[name]` via `foldConsistencyVariance`,
  replacing the `foldConsistency(..., residualVector[i], ...)` call.
- build a per-team CxC sample matrix (`d_i * d_j` off-diagonal, `varianceSample` on the
  diagonal — assert to yourself that `d_c^2 - sumP_c/n` and `varianceSample` are the same
  number, then let one of them be the source of truth) and fold it via
  `ewmaCovarianceSample`, replacing the `ewmaCovariance(..., residualVector, ...)` call.
- **`Sigma1League.componentConsistency` must fold the same sample.** It is
  `shrinkConsistency`'s prior, i.e. the target a thin-history team is blended toward. Leaving
  it on squared gain-weighted residuals would blend two incompatible quantities and the fix
  would silently do nothing for every new team. Fold once per teammate, preserving today's
  per-alliance fold COUNT so the running mean's weighting is unchanged in shape. Rewrite that
  field's doc comment, which currently says "every team's own squared gain-weighted residual".
- **Do NOT touch `residualsByTeam`.** It still computes `gains[i] * innovation` and still
  feeds `rp/state.ts`'s cross-covariance fold. That subsystem is unchanged by design
  (CONTEXT, D-Q2). Add a comment at its definition saying it is now used ONLY for the RP
  cross-covariance, so a future reader does not "unify" the two.

**Documentation (this is half the task, not a postscript).**
- `consistency.ts`'s header block names conflating three variance quantities as the top
  failure mode. Its "consistency (D-09, THIS module)" bullet describes an EWMA of squared
  residuals. Rewrite it: R is now estimated from innovations via the identity above; state
  that the estimator changed and why the old one was biased toward its floor; state the
  measured consequence (synthetic recovery 2.29 -> 12.35 against a true 12; real-corpus z-SD
  falling from 1.62-4.99 to 0.89-1.25 across 2022-2026 quals and elims; holdout playoff
  calibration mean absolute gap 0.072 -> 0.041). Add one new boundary contract to the list:
  every teammate on an alliance receives the SAME per-component R sample, so per-team R
  differentiation now comes from which alliances a team played on, not from within-alliance
  gain differences — an honest property of a summed observation, and worth naming before
  someone reads two teammates' equal spreads as a bug.
- `sigma1/index.ts`'s `teamMetrics` doc comment currently describes R as "D-09's
  match-to-match residual variance, D-11-shrunk" and `covariance.ts`'s header describes the
  gain-weighted attribution as what gets folded. Both must now describe the innovation-based
  estimate. Keep every claim that is still true (the additivity identity, the P-is-published
  reversal of the old D-05 assertion, the group-spread-needs-off-diagonals argument).
- `params.ts`: `coldStartConsistencyVariance` is 25 (an SD of 5) and was tuned against the
  retired estimator, which ran ~5x small. Do NOT change it — a full re-tune is deferred — but
  add one sentence to its doc comment recording that it is now known-stale, so the follow-up
  todo has an anchor in the code.

**Version and re-promotion, same commit.** Bump `SIGMA1_CODE_VERSION` `"2.1.0"` -> `"3.0.0"`
with a comment in the exact style of the existing 2.0.0 -> 2.1.0 block: name this task and
D-Q2, state that `update()`'s and `teamMetrics`'s observable output both changed, and record
that the two `vpr@2.1.0+*.json` files were retired and re-promoted as `vpr@3.0.0+*.json` in
this same commit so their digests were produced by the new code rather than edited. Then:

```
# retire (delete) data/algorithm-versions/vpr@2.1.0+tracer-check.json
# retire (delete) data/algorithm-versions/vpr@2.1.0+tuned-2026-08.json

pnpm promote --from reports/tune-tracer-repromote-2.1.0.json --name tracer-check

pnpm promote --from reports/tune-joint-off.json --name tuned-2026-08 \
  --set-param linkC=0.5 \
  --provenance-note "linkC re-selected post-estimator-change (D-Q2, quick task 260901-is2): coarse grid 0.2/0.3/0.4/0.5/0.7/1.0/1.24/1.5/2/3 selected on TUNE seasons 2022-2024 only, exactly how the promoted set was chosen; holdout quals Brier equal (0.1551), holdout elims Brier better (0.1596 -> 0.1580). Every OTHER parameter in this set was tuned against the RETIRED residual-history R estimator and is stale. A full re-tune under the innovation-based estimator is DEFERRED; the recorded objective describes the search winner, not this set."
```

`tracer-check` keeps `linkC: 1` — it is a fixed reference set, not a tuned one, and takes no
override. The tuned set keeps the NAME `tuned-2026-08` (CONTEXT: "`tuned-2026-08`'s
replacement carries linkC 0.5"); the `paramOverrides` / `note` /
`objectiveAppliesToPromotedParams: false` provenance is what carries the honesty, not the
filename.

**Repoint every reference to the retired path/identity** (grep `2\.1\.0` under `packages/`
and `scripts/` before and after):
- `packages/harness/cli.ts` L132 `PROMOTED_VPR_VERSION_PATH`
- `packages/harness/manifests.ts` L222 and `manifests.test.ts` L28
- `packages/harness/fixtures/extract-digest-slice.ts` L56 `DEFAULT_VERSION_PATH`
- `scripts/measureRewindGap.ts` L415
- `packages/harness/promotedOverrides.test.ts` L33-35 and the inline strings at L216, L286

The committed `packages/harness/fixtures/digest-slice.json` does NOT need regenerating: the
slice (season 2022, events `2022alhu`/`2022azfl`/`2022azva`, 265 matches) is unchanged, and
`digest.test.ts` matches a fixture to a version by `sliceSeason` + `sliceEventKeys`, not by
version string. Only `extract-digest-slice.ts`'s default path constant moves. Confirm this by
reading `digest.test.ts`'s output — with the corpus present it also asserts corpus and
fixture agree, so a stale fixture would fail loudly rather than silently.
  </action>

  <tests>
**Add `packages/core/algorithms/sigma1/innovationVariance.test.ts`** — CONTEXT's named
verification bar, and the durable replacement for the session-local scratchpad harness:
- **Synthetic recovery (the headline test).** Build a synthetic league whose truth is known
  by construction: 60 teams, per-team per-component true means drawn from a fixed seeded
  generator, each match's observed alliance total = sum of true team contributions plus noise
  with a known per-team per-match sigma of 12 (so the model's own assumptions are exactly
  satisfied), replayed through `vpr` with `DEFAULT_SIGMA1_PARAMS`. Assert the median published
  TOTAL `spread` across teams recovers 12 within a documented tolerance (CONTEXT measured
  12.35, i.e. 0.97x — assert something like `10 <= median <= 15`, and write the tolerance's
  justification into the test, not just the number). Use a deterministic seeded PRNG defined
  in the test file — no `Math.random`, or the test is a coin flip.
- **Negative control, in the same file:** compute what the retired estimator would have
  produced on the same fixture (an EWMA of `gains[i] * innovation` squared) and assert it is
  at least 3x smaller than the truth. Without this, a future refactor that quietly reverts the
  estimator could still pass the recovery test by widening the tolerance.
- **Identity test:** for one hand-built alliance-component (known `innovation`, known
  teammate variances, `n = 3`), assert `max(0, innovation^2 - sumP)/n` equals the covariance
  sample matrix's diagonal entry to 1e-12 — the two views of one quantity.
- **RP untouched:** assert `residualsByTeam` still holds `gain * innovation` by constructing
  an alliance update and comparing against a hand-computed gain, and that a fixture with a
  real breakdown still produces non-empty `redRpPmf`/`blueRpPmf`.

**Extend `consistency.test.ts`:** `foldConsistencyVariance(4, 9, 0.5) === 6.5` (folds the
variance as given, no squaring) alongside the existing `foldConsistency(4, 3, 0.5) === 6.5`
(squares the residual) — the two adjacent assertions are what make the boundary legible.

**Extend `covariance.test.ts`:** `ewmaCovarianceSample` folds a supplied matrix and applies
the same diagonal shrinkage; `ewmaCovariance(prior, r, a, s)` and
`ewmaCovarianceSample(prior, outer(r, r), a, s)` are byte-identical (proves the delegation
refactor changed nothing).

**Triage rule for `sigma1.test.ts` — read this before editing anything there.**
- **MUST stay green, unedited.** Every test that constructs a `Sigma1State` literal and calls
  `teamMetrics`/`predict` directly reads the same fields as before and is untouched by the
  estimator change: L164, L234, L313, L358, L377 (honest-variance check), L437-L603
  (the additivity identity Test 1, its non-vacuity Test 2, the floor-errs-wide Test 3, and
  the per-component/phase-group Tests 5 and 6). **`sigma1.test.ts`'s additivity identity must
  still hold — CONTEXT names it explicitly as part of the verification bar.** Also relational
  assertions over `update()`: L722 (fallback shrinks variance less), L926 (event boundary
  applies more process noise), L1052 (determinism), L988 (three link modes share one update
  path), the DQ/demo/eventType/malformed-breakdown blocks. A red in ANY of these is a bug in
  the change, not an outdated contract — in particular a red in L437-L603 means the
  `teamMetrics` P/R composition was disturbed, which this task must not do.
- **Expect to recompute, and say why in the comment.** Any assertion pinning an EXACT
  post-`update()` number after more than one update, because R now enters the Kalman gain at
  a different magnitude from match 2 onward. At the FIRST update every team's consistency is
  still the cold-start constant, so single-update fixtures are unaffected — check L1132
  (D-05 fallback attribution) against this before touching it; it is likely green as written.
  When a number genuinely must move, recompute it from the new estimator and update the
  surrounding comment to state which quantity it is derived from. Do NOT loosen an exact
  assertion to `toBeCloseTo` with a wide tolerance to make it pass.

**Also expected red until repointed:** `promotedOverrides.test.ts` (version identities),
`manifests.test.ts` (path constant), `digest.test.ts` (until the re-promotion runs). These
three are the "same commit" coupling, not separate failures.

**Optional, non-gating: reproduce CONTEXT's real-corpus measurement.** The scratchpad harness
is gone, but the prediction sidecar carries everything needed
(`packages/harness/predictions.ts`: `variance`, `predictedRedScore`, `predictedBlueScore`,
`actualRedScore`, `actualBlueScore`). Run
`pnpm harness --algorithm vpr --seasons 2024 --predictions-out reports/is2-z` and compute the
SD of `((actualRed - actualBlue) - (predRed - predBlue)) / sqrt(variance)` over the jsonl.
CONTEXT measured 2024 quals 1.62 -> 0.94. An honest filter gives ~1.0. Record the number in
the SUMMARY. Do not gate the commit on it — it is a several-minute corpus run, and the
committed tests are the durable evidence.
  </tests>

  <verify>
    <automated>pnpm vitest run packages/core/algorithms/sigma1</automated>
    <automated>pnpm vitest run packages/harness/digest.test.ts packages/harness/promotedOverrides.test.ts packages/harness/manifests.test.ts</automated>
    <automated>pnpm typecheck</automated>
  </verify>

  <done>
R is estimated from innovations in both the per-component consistency and the per-team
covariance, and in the league prior that shrinkage blends toward. `foldConsistencyVariance`
and `ewmaCovarianceSample` are sibling entry points, not overloads of the residual doors.
`residualsByTeam` and the RP fold are unchanged. The synthetic-recovery test recovers a known
sigma and its negative control proves the retired estimator would not.
`sigma1.test.ts`'s additivity identity still holds. `SIGMA1_CODE_VERSION` is `3.0.0`; the two
`2.1.0` files are deleted and `vpr@3.0.0+tracer-check.json` / `vpr@3.0.0+tuned-2026-08.json`
were written by `pnpm promote` in this commit, the tuned one carrying `linkC: 0.5`,
`paramOverrides`, a provenance note, and `objectiveAppliesToPromotedParams: false`. Every
`2.1.0` path reference is repointed. `digest.test.ts` green.
  </done>
</task>

<task type="auto">
  <name>Task 6: deferred follow-ups, stale prose, and whole-suite verification</name>
  <files>.planning/todos/pending/, packages/harness/baselineFingerprint.test.ts, docs/worker-operations.md</files>

  <action>
File the four explicitly-out-of-scope items from CONTEXT as `.planning/todos/pending/*.md`,
matching the existing todo format in that directory. Each must name what changed, what is now
stale, and what "done" looks like:
1. `retune-sigma1-under-innovation-r.md` — every tuned parameter in `vpr@3.0.0+tuned-2026-08`
   except `linkC` was searched against the retired estimator and traded off against an R that
   ran ~5x small. `coldStartConsistencyVariance` (25) is the most obviously stale. A full
   joint re-tune, then a re-promotion, closes it.
2. `regenerate-published-artifacts-post-is2.md` — all three algorithm versions changed and
   D-Q3 moves every accuracy figure on the site (OPR 2025 quals ~72.3% -> ~66.1%; VPR/EPA
   barely move). R2 artifacts, the algorithms manifest, and the compare page's numbers all
   need a republish. Also record that `STATE_SNAPSHOT_SHAPE_VERSION` is now 3, so seeded D1
   algorithm state must be re-seeded from a fresh publish run before the Worker can fold.
3. `remeasure-baseline-fingerprint-post-is2.md` — `data/baselines/`'s offseason-inclusive
   fingerprint records opr `3.1.0+baseline`, epa `1.1.0+baseline`, vpr `2.1.0+tuned-2026-08`.
   Those are historical facts about a past measurement and must NOT be edited; the fingerprint
   needs re-measuring under the new versions.
4. `sigma1-cold-start-zero-plus-minus.md` — a never-seen team still publishes `0 ± 0`;
   untouched by this task.

Fix the one piece of prose the version bumps make false: `baselineFingerprint.test.ts` L253
titles its case `"the offseason-inclusive fingerprint carries exactly opr/epa/vpr, at their
current post-fix versions"` and its doc comment says "under their current, post-rename/
post-code-bump ids and versions". After this task those versions are the PREVIOUS ones.
Change the title and comment to say the fingerprint records the versions it was MEASURED
under (opr 3.1.0 / epa 1.1.0 / vpr 2.1.0, pre-260901-is2), and cross-reference todo 3.
**Leave the assertions themselves exactly as they are** — they assert what a committed
historical file contains, and rewriting them to the new versions would be falsifying a
measurement record.

Grep for any remaining doc comment that describes retired behavior:
`grep -rn "even split\|evenly split\|OPR_LOGISTIC_SCALE\|gain-weighted residual\|squared residual" packages/ --include=*.ts`
and confirm each surviving hit is either (a) a deliberate historical reference clearly marked
as such, or (b) `foldConsistency`'s own still-correct residual contract. This is the
requirement-4 sweep; a stale doc comment here is the exact failure mode the project's failure
log names.

Then run the whole suite and typecheck. Do not touch `apps/web`.
  </action>

  <tests>
No new tests. This task's verification IS the full suite: it is the first point at which all
four changes, three version bumps, and two re-promoted version files coexist.
  </tests>

  <verify>
    <automated>pnpm vitest run</automated>
    <automated>pnpm typecheck</automated>
    <automated>git status --porcelain -- apps/web</automated>
  </verify>

  <done>
Four todos filed. `baselineFingerprint.test.ts`'s prose describes a historical record rather
than claiming current versions, with assertions untouched. The retired-behavior grep is clean.
Full `pnpm vitest run` green, read from its output (test-file and test counts present, not an
exit code). `git status -- apps/web` is empty — nothing in the other agent's tree was touched.
  </done>
</task>

</tasks>

<verification>
Read every command's OUTPUT; an exit code alone proves nothing here.

1. `pnpm vitest run` — whole suite green at the end of Task 6, and green at every intermediate
   commit boundary (each task's own `<verify>` block is the narrower gate).
2. `pnpm typecheck` — clean.
3. `ls data/algorithm-versions/` shows exactly `vpr@3.0.0+tracer-check.json` and
   `vpr@3.0.0+tuned-2026-08.json`; the two `2.1.0` files are gone.
4. `git log --oneline` shows six commits, one per task, each self-contained.
5. `grep -rn "2\.1\.0" packages/ scripts/ --include=*.ts` returns only historical references
   inside version-bump comments and the baseline-fingerprint record — no live path or pin.
6. `git status --porcelain -- apps/web` is empty.
</verification>

<success_criteria>
- D-Q1: a teammate on an alliance that hits its prediction exactly does not move; every
  pre-existing epa test passes unedited.
- D-Q2: the synthetic-recovery test recovers a known sigma; its negative control shows the
  retired estimator would not; `sigma1.test.ts`'s additivity identity still holds;
  `residualsByTeam` and the RP fold are unchanged.
- D-Q3: a no-call is a miss, a tie is still excluded, Brier is unchanged, `noCallCount` is
  still reported.
- D-Q4: OPR's scale is the expanding-window SD over 1.1, leak-free, with a documented
  `count < 2` fallback of 25.
- D-13: epa 2.0.0, opr 4.0.0, SIGMA1_CODE_VERSION 3.0.0, each bumped in the same commit as
  the output change it stands for.
- Every committed digest was produced by `promote.ts` running the final code. No digest,
  anywhere, was hand-edited.
- The `tuned-2026-08` provenance says in machine-readable form that `linkC` was overridden
  post-search and that its recorded objective does not describe the shipped set.
- `consistency.ts`, `sigma1/index.ts`'s `teamMetrics`, `brier.ts`'s header, and `opr.ts`'s
  scale comment all describe what the code now does.
</success_criteria>

<output>
Create `.planning/quick/260901-is2-model-correctness-fixes-from-adversarial/SUMMARY.md` when
done, recording: the six commit SHAs; the before/after `winnerAccuracy` for both re-promoted
2.1.0 files and the final 3.0.0 headline metrics; the synthetic-recovery test's measured
median spread against the true sigma of 12; the optional real-corpus z-SD if it was run; and
the four todo filenames.
</output>
