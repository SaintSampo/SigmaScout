---
quick_id: 260905-tpx
phase: quick-260905-tpx
plan: 01
type: execute
wave: 1
depends_on: []
date: 2026-09-05
mode: quick
description: "RP own-scale process noise — build the missing RP-pmf log-loss metric, baseline the live model under it, then A/B the own-spread-relative RP noise form as a working-tree experiment. Patch, replay, score, REVERT. Nothing ships."
autonomous: true
requirements: [QUICK-260905-TPX]
files_modified:
  - .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/score-rp-logloss.cjs
  - .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/measure-rp-spread.ts
  - .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/260905-tpx-RESULTS.md
temporarily_patched:
  - packages/core/algorithms/sigma1/rp/state.ts   # patched twice, reverted twice, NEVER committed
generated_untracked:
  - reports/rpnoise-baseline-260905/
  - reports/rpnoise-control-260905/
  - reports/rpnoise-ownscale-260905/

estimate:
  tokens: 75000
  raw_tokens: 150000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "An RP-pmf log-loss scorer exists, is committed, and scores the negative log-likelihood of each played qualification alliance's ACTUAL total RP under that alliance's predicted pmf."
    - "The reference per-threshold-variable spread used to derive the relative constants is MEASURED from the corpus, printed, and recorded — never assumed."
    - "Baseline, control, and candidate streams are produced by the identical harness command shape and report the identical algorithmVersion; only the working-tree patch differs."
    - "Whether the RP threshold Kalman state feeds win probability is settled by a bitwise pRedWin comparison across all three streams, not by argument."
    - "The pre-committed verdict is recorded against its stated criteria, including a negative one."
    - "After the final replay the working tree under packages/ is byte-identical to HEAD and reproduces the committed digests."
  artifacts:
    - .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/score-rp-logloss.cjs
    - .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/measure-rp-spread.ts
    - .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/260905-tpx-RESULTS.md
    - reports/rpnoise-baseline-260905/predictions-2022.jsonl through predictions-2026.jsonl
    - reports/rpnoise-control-260905/predictions-2022.jsonl through predictions-2026.jsonl
    - reports/rpnoise-ownscale-260905/predictions-2022.jsonl through predictions-2026.jsonl
  key_links:
    - "The pmf index scale and corpus `red_rp_earned`/`blue_rp_earned` are the SAME scale (total RP including win RP, 0..maxRp) — verified at planning time; the scorer's join rests on it and must re-assert it."
    - "packages/core/algorithms/sigma1/rp/state.ts has exactly THREE read sites for the retiring params (the `q` ternary, the inline belief fallback, and coldStartRpTeamState) — all three move together or the patch is incoherent."
    - "The control run isolates SHAPE from MAGNITUDE: the live promoted set runs 2023/2024 at legacy absolutes (0.145/1/16.75) and 2022/2025/2026 at defaults (0.5/8/25), so a candidate-vs-baseline delta alone cannot be attributed."
---

<objective>
Close the measurement gap that makes `.planning/todos/pending/rp-process-noise-own-scale.md`
`low` priority rather than merely deferred: D-01's tuning objective (Brier over predicted win
probability) is structurally blind to the RP pmf, so the three RP noise parameters sit in
`SEARCH_EXCLUSIONS` and no objective exists that could evaluate a change to them at all.

Build that objective — an RP-pmf log-loss scorer — baseline the live promoted model under it,
then A/B the dimensionally-principled own-spread-relative RP noise form the todo defers, as a
working-tree experiment.

Purpose: decide on measurement, not on the dimensional argument alone, whether scaling each
threshold variable's process noise by that variable's OWN spread is worth a
`SIGMA1_CODE_VERSION` major bump.

Output: `260905-tpx-RESULTS.md` with the measured reference spreads, the derived relative
constants, three per-season log-loss tables, and a pre-committed verdict. Two committed
instruments. Three untracked stream directories under `reports/`.

**This is a working-tree experiment.** Model code is patched, replayed, and REVERTED. Nothing
under `packages/`, `data/algorithm-versions/`, or `fixtures/` is committed. No new parameter,
no `SIGMA1_CODE_VERSION` bump, no promote, no publish, no network. A WIN verdict authorizes a
FOLLOW-UP ship task; it does not authorize shipping anything from this one.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/todos/pending/rp-process-noise-own-scale.md
@packages/core/algorithms/sigma1/rp/state.ts
@packages/harness/predictions.ts
</context>

<interface_facts>
Verified live in the tree and against `data/corpus.sqlite` at planning time — do not re-derive.
Every number below was read from the actual artifact, not inferred.

**The three read sites in `packages/core/algorithms/sigma1/rp/state.ts`** (the only places the
retiring params are consumed anywhere in the codebase):
- line 165, inside `coldStartRpTeamState`: `variance: params.rpColdStartVariance`
- line 295, inside `foldRpObservation`: the `const q = sameEvent ? params.rpProcessNoiseWithinEvent : params.rpProcessNoiseEventBoundary;` ternary, currently hoisted ABOVE the per-variable loop
- line 302, inside that loop's `existing.rpBeliefs[name] ?? { ... }` inline cold-start fallback: `variance: params.rpColdStartVariance`
The loop runs 297-305 and calls `applyProcessNoise(belief, q)` at line 304.

**The available per-variable statistic is a real variance, not a proxy.** `RpLeague.rpVariableMean`
is `Record<string, ExpandingStats>` and `ExpandingStats` (`packages/core/scoring/expandingStats.ts`)
carries `count`, `mean`, and `m2` (Welford's sum of squared deviations). Population variance is
`m2 / count`, defined for `count >= 2`. `standardDeviation(stats, fallback)` at that module's tail
already returns `fallback` below `count < 2`. No Bernoulli or bounded-count proxy is needed.

**The fold that produces those stats** (`state.ts` lines 348-350): `observedShare = observedSum / allianceTeams.length`,
folded `allianceTeams.length` times per alliance-variable. `allianceTeams` is the rating-eligible
teammate list (surrogates already excluded by the caller).

**Leak-proofing already holds.** `foldRpObservation` reads `input.league` (pre-match state) for the
process-noise decision and writes `nextRpVariableMean` only into its return value, so a variance
read at match k can only see matches 1..k-1. The patch preserves that by construction as long as it
reads `league`, never `nextRpVariableMean`.

**`rpVariableMean` carries ACROSS season boundaries** (`index.ts` line 1962, `league: state.league`),
but threshold-variable NAMES are season-specific, so keys do not collide and the statistics are
effectively per-season. Documented at `index.ts` 1954-1961.

**RP state does not feed win probability, by reading.** `sigma1/index.ts` computes `pRedWin` at line
1132 from score-side quantities only; `predictAllianceRpMoments` is not called until line 1153 and
takes `redScore`/`redScoreVarianceOwn` as INPUTS. `rp/state.ts`'s header asserts the module never
reads or writes the score-side `beliefs`/`covariance`/`consistency`. This task verifies that claim
empirically rather than inheriting it.

**Prediction JSONL record fields** (one line per algorithm per match; `epa` and `vpr` interleaved in
the same season file): `matchKey`, `season`, `eventKey`, `compLevel`, `algorithmId`,
`algorithmVersion`, `predictedWinner`, `pRedWin`, `predictedRedScore`, `predictedBlueScore`,
`redComponents`, `blueComponents`, `variance`, `redRpPmf`, `blueRpPmf`, `actualWinner`,
`actualRedScore`, `actualBlueScore`. The `*Components` blobs dominate file size (30-66 MB/season).
`vpr` rows carry `redRpPmf`/`blueRpPmf`; `epa` rows never do.

**There is NO actual-RP field in the prediction stream.** It carries `actualWinner`,
`actualRedScore`, `actualBlueScore` and nothing else about the outcome. The actual RP total must
be joined from the corpus.

**The corpus supplies it, on the identical scale as the pmf index.** `data/corpus.sqlite`'s
`matches` table has `red_rp_earned` / `blue_rp_earned`, which are TOTAL RP INCLUDING win RP —
sampled and confirmed (2024 `2024alhu_qm1`, red winner, `red_rp_earned` 2 = that season's `winRp`).
Observed ranges over non-offseason played qualification matches: 2022/2023/2024 max 4, 2025/2026
max 6. Rule-module `maxRp` is `winRp + bonusNames.length`: 2022/2023/2024 `2 + 2 = 4`;
2025/2026 `3 + 3 = 6`. So a valid pmf index range is exactly `0..maxRp` and matches the corpus
column with no offset. Observed pmf lengths in a real stream: 5 for a 2024 `qm`, 1 for `sf`/`f`
(the degenerate elimination pmf, which is why only `qm` is scored).

**Corpus RP coverage** over non-offseason played `qm` matches: 2022 n=12064 / 0 null; 2023 n=13558 /
0 null; 2024 n=14162 / **21 null**; 2025 n=14821 / 0 null; 2026 n=15191 / 0 null. The 21 nulls must
be excluded and counted, never coerced.

**The autopsy stream is STALE.** `reports/autopsy-260905/predictions-*.jsonl` carries `vpr`
`algorithmVersion` `8.0.0+rolling-2026-09b`. `SIGMA1_CODE_VERSION` is now `9.0.0`
(`params.ts:545`) and `PROMOTED_VPR_VERSION_PATH` (`packages/harness/promotedVersionPath.ts:92`)
points at `data/algorithm-versions/vpr@9.0.0+rolling-2026-09c.json`, whose `version` field is the
string `9.0.0+rolling-2026-09c`. A fresh baseline replay is therefore REQUIRED; the autopsy stream
is usable only as a shape fixture for validating the scorer.

**The live promoted set is not uniform across seasons** (`vpr@9.0.0+rolling-2026-09c.json`,
`paramSetsBySeason`): 2023 and 2024 run `rpProcessNoiseWithinEvent` 0.14522393520915602,
`rpProcessNoiseEventBoundary` 1, `rpColdStartVariance` 16.75421168559074 (legacy pre-4.0.0 tuned
inheritance); 2022, 2025 and 2026 run 0.5 / 8 / 25. This is why the control run exists.

**Defaults** (the values the relative constants are derived from):
`SIGMA1_PROCESS_NOISE_WITHIN_EVENT` = 0.5 (`kalman.ts:76`),
`SIGMA1_PROCESS_NOISE_EVENT_BOUNDARY` = 8 (`kalman.ts:91`),
`SIGMA1_COLD_START_CONSISTENCY_VARIANCE` = 25 (`params.ts:633`).

**`RpRuleModule`** (`rp/constants.ts:165`): `season`, `thresholdVariables`, `bonusNames`, `maxRp`,
`winRp`, `tieRp`, `parse(rawBreakdownJson, side, eventType): RpParsedResult`, `predictThresholds`.
`RpParsedResult.thresholdVariables` is `Record<string, number>` holding the ALLIANCE-level sums.
`isRpEligibleEventType(eventType)` (`rp/constants.ts:105`) gates whether an RP prediction is emitted
at all; offseason event types are not eligible.

**Harness entry point:** `package.json` script `harness` = `tsx --env-file=.env packages/harness/cli.ts`.
`cli.ts` has NO `--set-param` flag — a magnitude control must be a code patch, not a CLI override.
Typecheck: `npx tsc --noEmit` at repo root. A full 2022-2026 single-algorithm replay takes roughly
six minutes on this machine.
</interface_facts>

<tasks>

<task type="tracer">
  <name>Task 1: Build the two instruments, measure the reference spreads, and produce the fresh baseline</name>
  <files>.planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/score-rp-logloss.cjs, .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/measure-rp-spread.ts</files>
  <precondition>`data/corpus.sqlite` exists and `reports/autopsy-260905/predictions-2024.jsonl` exists. The first is the only source of actual RP totals; the second is the shape fixture the scorer is validated against before any replay is spent.</precondition>
  <action>
Build the measurement before the experiment, and prove each instrument on data that already
exists, so that when the candidate streams land the only new variable is the model patch.

Both scripts live in the quick task directory and are COMMITTED, because `reports/` is gitignored
and an uncommitted instrument would leave the RESULTS unreproducible. No new dependency: use
`better-sqlite3` and `readline`, both already resolvable from the repo root.

**Instrument A — `score-rp-logloss.cjs`, the missing objective.** Plain CommonJS, run with bare
`node`. Interface: `node <script> --series <label>=<dir>[,<label>=<dir>...]`, first label is the
reference series all deltas are measured against.

Reading discipline, load-bearing: a five-season stream set is roughly 240 MB. Stream each file line
by line with `readline` over `fs.createReadStream`, parse, and retain ONLY `matchKey`, `season`,
`eventKey`, `compLevel`, `algorithmId`, `algorithmVersion`, `pRedWin`, `redRpPmf`, `blueRpPmf`.
Never retain the parsed object — the two component blobs are the bulk of every line.

Load actual RP once, before streaming: open `data/corpus.sqlite` read-only and select `match_key`,
`red_rp_earned`, `blue_rp_earned` from `matches` where both RP columns are non-null, into a single
Map. Roughly 70k entries; trivial memory.

Scored observation set, stated so the denominator is one thing and not four: a row qualifies when
`algorithmId` is `vpr`, `compLevel` is `qm`, both `redRpPmf` and `blueRpPmf` are present, and the
corpus Map has an entry for its `matchKey`. Each qualifying row contributes TWO scored observations
— red alliance and blue alliance — each pairing one pmf with its own side's actual RP total. Score
only matchKeys that qualify in EVERY named series, so all series share one denominator.

Per observation, log-loss is the negative natural log of the predicted probability mass at the
actual RP total, floored: take `pmf[actualRp]`, treat a missing index or a non-finite value as 0,
then score the negative log of the maximum of that value and the epsilon 1e-6. Hard-code that
epsilon as a named constant and print its value in the output header, because it sets the ceiling
on how bad a single calibration failure can look and a reader must not have to guess it.

Count and report separately, never folded into the mean silently:
- `zeroMass` — observations whose predicted mass at the actual outcome was exactly 0 (a calibration
  failure that deserves its own number).
- `outOfRange` — observations whose actual RP total is at or beyond `pmf.length` (a SCALE mismatch
  between the pmf index and the corpus column, which would invalidate the whole join; this must be
  0 and the executor must halt and reconcile if it is not).
- `droppedNoCorpusRp` — qualifying rows with no corpus RP entry.
- `droppedNotInAllSeries` — matchKeys missing from at least one series.

Per season and per series report: mean log-loss, scored observation count, `zeroMass`,
`outOfRange`, and the standard error of the mean log-loss computed as the sample standard deviation
of the per-observation log-loss divided by the square root of the observation count. For every
non-reference series also report the mean-log-loss delta from the reference expressed in units of
the REFERENCE series' standard error, so the verdict is mechanical rather than eyeballed. Add a
pooled all-seasons row computed over the union of scored observations, not as an average of season
means.

Win-probability guard: for every non-reference series, compare `pRedWin` against the reference
series for every scored matchKey using `Object.is`, and print either `PRED_WIN_IDENTICAL` or
`PRED_WIN_DIVERGED n=<count>` per series per season. This is what settles, by measurement, whether
the RP threshold Kalman state feeds win probability.

Version guard: collect the distinct `vpr` `algorithmVersion` values seen per series and print them.
More than one value in a series, or a mismatch across series, is a fatal condition to surface, not
absorb.

Emit a markdown table per season plus the pooled row, print to stdout, and end with a final line
reading `TOTAL_SCORED=` followed by the sum of per-season scored observation counts. The script must
not write RESULTS.md itself — the executor pastes its output.

**Instrument B — `measure-rp-spread.ts`, the derivation reference.** TypeScript, run with
`npx tsx <script>`, because it must import the real season rule modules rather than reimplement
threshold parsing. Open `data/corpus.sqlite` read-only. For 2022, 2023 and 2024 only, iterate
non-offseason played qualification matches that have a score breakdown, in `sort_time` order. For
each alliance side, call that season's rule module's `parse` on the parsed `score_breakdown_raw`
with that side and the event's `event_type`, guarded by `isRpEligibleEventType` so the offseason
throw path is never reached. Take `thresholdVariables`, divide each value by the rating-eligible
teammate count for that side (that side's team array length minus its surrogate array length), and
fold the resulting share into a per-season-per-variable Welford accumulator EXACTLY as
`foldRpObservation` does — once per eligible teammate, not once per alliance, so the counts match
the model's own.

Report per season and per variable: observation count, mean, population variance as `m2 / count`,
and its square root. Then compute two candidate reference aggregates over every 2022-2024
(season, variable) pair: the observation-count-WEIGHTED mean of the population variances, and the
UNWEIGHTED mean across variables. Print both, and print the three derived relative constants under
each aggregate: within-event as 0.5 divided by the reference, event-boundary as 8 divided by the
reference, cold-start as 25 divided by the reference. The weighted aggregate is the one the patch
uses; the unweighted one is printed so RESULTS can show how much the derivation choice moves the
constants.

**Validate instrument A on the stale autopsy stream** with `--series autopsy=reports/autopsy-260905`.
This costs nothing and proves the join before six minutes of replay is spent on it.

**Then produce the fresh baseline.** Run `pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/rpnoise-baseline-260905`
using the Bash tool's own timeout parameter set to 600000. Do NOT wrap it in the `timeout` binary —
on this machine that swallows all output and exits 0, turning a failed replay into a false green.
If the run overruns the tool cap, re-run with `run_in_background` and poll for the five season files
rather than shortening the season range. The replay reads the local corpus and needs no network; if
a command is denied network access, halt and report rather than working around it.

Score the fresh baseline and keep the full stdout for RESULTS.
  </action>
  <verify>
    <automated>node .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/score-rp-logloss.cjs --series baseline=reports/rpnoise-baseline-260905</automated>
  </verify>
  <done>
The autopsy validation run exits 0, reports a nonzero scored count for all five seasons, reports
`outOfRange` of 0 for every season, and prints exactly one `vpr` version, `8.0.0+rolling-2026-09b`
— confirming the shape of the join and confirming the stream is stale relative to the live 9.0.0
promoted set.

The baseline scoring run exits 0, prints five per-season rows plus a pooled row, reports
`outOfRange` of 0 for every season, prints `droppedNoCorpusRp` of 21 or fewer in 2024 and 0 in the
other four seasons, and prints exactly one `vpr` version, `9.0.0+rolling-2026-09c`. If the version
string differs, record the actual value and continue — the binding requirement is that baseline,
control and candidate all report the IDENTICAL version, not that it equals a literal written at
planning time.

If `outOfRange` is nonzero in any season, HALT: the pmf index and the corpus RP column are not on
the same scale, and every downstream number would be meaningless. Reconcile before replaying
anything else.

`npx tsx measure-rp-spread.ts` exits 0 and prints per-season-per-variable counts, means and
variances for 2022-2024, both reference aggregates, and both sets of three derived relative
constants.
  </done>
</task>

<task type="auto">
  <name>Task 2: Patch, replay, and revert twice — the magnitude control, then the own-scale candidate</name>
  <files>packages/core/algorithms/sigma1/rp/state.ts</files>
  <precondition>`git status --porcelain packages` is empty, and all five `reports/rpnoise-baseline-260905/predictions-{2022..2026}.jsonl` streams exist. Halt if either is false — a dirty tree makes the revert step unable to distinguish this experiment's patch from pre-existing work.</precondition>
  <action>
One working tree, one file, two patches. Run strictly in sequence: patch the control, typecheck,
replay, revert, confirm clean; only then start the candidate. Never hold both patches at once.

**Why the control run exists, and why skipping it would make the result uninterpretable.** The live
promoted set runs 2023 and 2024 at legacy absolutes (0.145 / 1 / 16.75) and 2022, 2025 and 2026 at
the defaults (0.5 / 8 / 25). The candidate's relative constants are derived from the DEFAULTS, so a
raw candidate-versus-baseline delta in 2023 and 2024 would confound the scaling SHAPE with a
magnitude jump back toward the defaults. The control run holds every season at the defaults with
the existing absolute shape, making candidate-versus-control a pure shape comparison across all
five seasons. It also yields a free finding: control-versus-baseline measures what the legacy tuned
RP absolutes are actually worth on RP log-loss.

**Patch C, the magnitude control.** In `packages/core/algorithms/sigma1/rp/state.ts`, replace the
three parameter reads with the default literals, leaving the structure otherwise untouched: the
`q` ternary at line 295 becomes 0.5 within-event and 8 at an event boundary; the inline cold-start
fallback variance at line 302 becomes 25; `coldStartRpTeamState`'s variance at line 165 becomes 25.
No other edit. Replay to `reports/rpnoise-control-260905`.

**Patch X, the own-scale candidate.** Three coordinated edits to the same file, using the WEIGHTED
reference aggregate's three relative constants from Task 1's `measure-rp-spread.ts` output.
Hard-code those three derived numbers as named module-level constants at the top of the file with
a comment recording the derivation — each as its default divided by the measured weighted reference
variance — and record the measured reference value itself in that comment so the derivation is
reproducible from the file alone.

Add a per-variable variance helper alongside the existing `rpLeagueMeanFor` at line 135: given the
league and a variable name, return that variable's population variance as `m2` divided by `count`
when `count` is at least 2, and otherwise return a caller-supplied fallback. This mirrors
`expandingStats.ts`'s own `standardDeviation(stats, fallback)` contract rather than inventing a
second convention.

Then: move the `q` ternary at line 295 INSIDE the per-variable loop, because `q` is no longer one
scalar shared by every threshold variable. Within the loop, select the within-event or
event-boundary relative constant by the existing `sameEvent` flag, and set `q` to that constant
multiplied by the variable's own population variance from the helper, with the fallback being the
corresponding ABSOLUTE default — 0.5 within-event, 8 at a boundary. That fallback is the honest
behavior when fewer than two observations exist for a variable: there is no own-spread signal yet,
so the model falls back to exactly what it does today rather than to a fabricated spread.

Apply the same treatment to both cold-start variance sites — line 302's inline fallback and
`coldStartRpTeamState` at line 165 — using the cold-start relative constant multiplied by the
variable's own population variance, falling back to the absolute 25.

Read `league`, never `nextRpVariableMean`. The former is pre-match state and keeps the process-noise
decision leak-proof by construction; the latter already includes this match's own observation and
would make the model read its own future.

Per-patch sequence, identical for both:
  1. Apply the edits.
  2. Run `npx tsc --noEmit` — it must be clean before spending six minutes of replay on it.
  3. Run `pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/rpnoise-control-260905`
     for C, and the same command with `--out reports/rpnoise-ownscale-260905` for X. Same season
     range, same algorithm id, same command shape as the baseline: the patch is the only difference.
     Invoke it with the Bash tool's own timeout parameter set to 600000. Do NOT wrap the command in
     the `timeout` binary — on this machine that swallows all output and exits 0, which would turn
     a failed replay into a false green. If the run overruns the tool cap, re-run with
     `run_in_background` and poll for the five season files rather than shortening the season range.
  4. Run `git checkout -- packages/core/algorithms/sigma1/rp/state.ts` and confirm
     `git status --porcelain packages` is empty again.

Do NOT run the full vitest suite while patched. Both patches intentionally change prediction
streams, so digest tests WILL fail — that is the expected, correct behavior of a working digest
gate, not a problem to fix or a signal to weaken. Typecheck only while patched.

If any step fails mid-patch, revert the file FIRST, then report. Never leave the tree patched.

If the candidate replay throws — the Cholesky path in `rp/distribution.ts` has a documented ridge
escalation and a Cauchy-Schwarz clamp, and a much larger per-variable `q` could plausibly stress it
— revert, record the exact failure and the season and match it occurred on, and report that as a
finding. A candidate form that cannot complete a replay is itself a measured result. Do not weaken
the ridge, the clamp, or any guard to make the run finish.
  </action>
  <verify>
    <automated>test -z "$(git status --porcelain packages data fixtures)" && echo TREE_CLEAN && ls reports/rpnoise-control-260905/predictions-*.jsonl reports/rpnoise-ownscale-260905/predictions-*.jsonl | wc -l</automated>
  </verify>
  <done>
`TREE_CLEAN` prints, and the file count is 10 — five season streams per candidate directory, all
nonzero size. Both patches have been reverted and `git diff` against HEAD is empty for every path
under `packages/`. Task 1's scorer, run across all three series, reports exactly one `vpr`
`algorithmVersion` and the same one for all three — proving the replays ran the same promoted
parameter set and that no version bump or parameter-file change leaked in alongside a patch.

The three derived relative constants used by patch X are recorded verbatim, alongside the measured
weighted reference variance they were derived from.
  </done>
</task>

<task type="auto">
  <name>Task 3: Score all three series, apply the pre-committed verdict, prove the tree is back to live behavior</name>
  <files>.planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/260905-tpx-RESULTS.md</files>
  <action>
Run the instrument across all three series in one invocation, with the CONTROL as the reference
label so every delta is measured against it:
`--series control=reports/rpnoise-control-260905,ownscale=reports/rpnoise-ownscale-260905,baseline=reports/rpnoise-baseline-260905`.
Capture the full stdout. Then run it a second time with `baseline` as the reference label, so the
candidate-versus-live-model view is also on record.

**Validity gate, checked FIRST.** Every series must print `PRED_WIN_IDENTICAL` for every season. If
any series prints `PRED_WIN_DIVERGED`, the experiment is INVALID as designed and no win-or-loss
verdict may be issued: it would mean the RP threshold Kalman state feeds win probability somewhere,
contradicting what `rp/state.ts`'s header asserts and `sigma1/index.ts`'s line ordering implies, and
it would change the blast radius of any future ship task. Record that as the finding, with the
season, the divergence count, and a pointer to where the coupling would have to live. That outcome
is more valuable than the log-loss numbers, not a failure of the task.

**Pre-committed verdict criteria, applied mechanically with no post-hoc adjustment.** The own-scale
form WINS if and only if ALL of the following hold against the CONTROL series:
  - per-season mean RP log-loss improves (is lower) in at least 3 of the 5 seasons;
  - pooled mean RP log-loss improves;
  - no season worsens by more than 2.0 standard errors — that is, every season's SE-unit delta
    column is at or above negative 2.0;
  - in no season does the candidate's `zeroMass` count exceed the control's by more than ten
    percent plus five observations;
  - and the validity gate above passed.
Anything else is a NO-WIN, and a NO-WIN closes `.planning/todos/pending/rp-process-noise-own-scale.md`
as measured-negative. Record a negative result with the same weight and the same detail as a
positive one; this task's value is the verdict, whichever way it falls.

The CONTROL is the primary comparator because it isolates the scaling shape from the magnitude
difference the live promoted set carries in 2023 and 2024. Compute the same five criteria against
the BASELINE series as a secondary view. If the two views disagree on the verdict, state that
explicitly and prominently, keep the control-based verdict as the decision, and name the
disagreement as a caveat any follow-up ship task must resolve first.

Write `260905-tpx-RESULTS.md` in the quick task directory containing: the motivation in two or three
sentences pointing at the todo file and naming the missing-objective problem it identifies; the
measured per-season-per-variable spread table from `measure-rp-spread.ts`, both reference aggregates,
and both sets of derived constants, with the weighted set marked as the one used; the exact diff of
each patch as a fenced block, so the experiment is reproducible from the committed record alone once
the working-tree patches are gone; the exact commands run for each replay; the epsilon used by the
log-loss and why a zero-mass count is reported separately from the mean; the full per-season tables
for all three series in both reference framings; the win-probability guard result; the verdict
against each of the five criteria with the deciding numbers quoted; and a reproducibility note
recording that `reports/` is gitignored, so the three stream sets are NOT recoverable from git and
must be regenerated by re-running the recorded commands.

Close RESULTS with a "what a ship task would entail" section, written whether the verdict is WIN or
NO-WIN so the record is complete either way: retire `rpProcessNoiseWithinEvent`,
`rpProcessNoiseEventBoundary` and `rpColdStartVariance`; add their relative replacements; bump
`SIGMA1_CODE_VERSION` from 9.0.0 to 10.0.0; retire and re-promote every committed
`data/algorithm-versions/vpr@9.0.0+*.json` in the same commit per the established precedent and
re-pin `PROMOTED_VPR_VERSION_PATH`; and carry the three replacements into `SEARCH_EXCLUSIONS` with
the same recorded reason the retiring three carry — D-01's objective is Brier over predicted win
probability and is structurally blind to the RP pmf — noting that this task's scorer is precisely
the objective that would have to become part of the tuning loop for that exclusion to ever be
lifted. State plainly that nothing in that list is done by this task.

If the Write tool is blocked on the RESULTS path, return the complete document text in the task
output and let the caller write it. Do not route around a blocked write with a Bash heredoc.

Then prove the tree is back to bitwise-live behavior. Run `npx vitest run packages/harness/digest.test.ts`
first, then the full repo-root suite with `npx vitest run`. Use `npx vitest run` directly, not a
`pnpm` wrapper under the `timeout` binary, and read the actual test output rather than trusting the
exit code alone. Run the full suite from the REPO ROOT, not from `apps/web` — the root run covers
roughly twice as many files and a red test has hidden in that gap before.

Commit scope: the quick task directory only — the PLAN, the RESULTS, and the two instrument scripts.
Stage by explicit path, `git add .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p`,
never `git add -A` or `git add .`, because another session may share this checkout. Nothing under
`packages/`, `data/algorithm-versions/`, `fixtures/`, or `reports/` is staged.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/digest.test.ts && npx vitest run && test -f .planning/quick/260905-tpx-rp-own-scale-process-noise-build-an-rp-p/260905-tpx-RESULTS.md && git status --porcelain packages data fixtures reports | wc -l</automated>
  </verify>
  <done>
`digest.test.ts` passes on the reverted tree — its corpus-backed slices green — proving the working
tree reproduces the committed prediction digests bitwise and that neither patch survived. The full
repo-root `npx vitest run` is green, judged by reading its summary line rather than by exit code
alone.

RESULTS.md exists and states an explicit WIN or NO-WIN verdict against all five pre-committed
criteria with the deciding numbers quoted, or an explicit INVALID finding if the win-probability
guard failed. It records the measured reference spreads and the three derived constants, both
reference framings, and the ship-task outline.

The final `git status` line count over `packages data fixtures reports` is 0, and the commit touches
only paths under the quick task directory.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `.env` -> harness process | The harness script runs `tsx --env-file=.env`; live TBA and R2 credentials are loaded into a process whose output is streamed into an agent transcript |
| working tree -> git history | Temporary model patches live in a tracked file and could be committed by an over-broad staging command |
| corpus SQLite -> scoring script | A read-only third-party-derived data store is joined against model output; a scale mismatch would silently produce meaningless numbers rather than an error |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-tpx-01 | Information Disclosure | `.env` read by `pnpm harness` | high | mitigate | Never `Read`, `cat`, or echo `.env`; let `tsx --env-file` consume it by path, exactly as CLAUDE.md's secrets-handling convention requires. Harness stdout is a replay progress log and carries no credential |
| T-tpx-02 | Tampering | `packages/core/algorithms/sigma1/rp/state.ts` | high | mitigate | Both patches are reverted with `git checkout --` after their own replay; Tasks 2 and 3 each gate on `git status --porcelain packages data fixtures` being empty, and Task 3 additionally proves bitwise-live behavior via `digest.test.ts` |
| T-tpx-03 | Tampering | git staging area (shared checkout) | medium | mitigate | Stage by explicit path under the quick task directory only; never `git add -A` or `git add .`, since a concurrent session may hold unrelated edits in this same checkout |
| T-tpx-04 | Spoofing | RP-pmf log-loss join (pmf index vs `red_rp_earned`) | high | mitigate | The scorer counts and reports `outOfRange` observations explicitly, and Task 1's acceptance halts the whole experiment if that count is nonzero — a scale mismatch cannot pass as a plausible-looking mean |
| T-tpx-05 | Repudiation | derived relative constants | medium | mitigate | The constants are printed by a committed measurement script, recorded in a patch comment alongside the measured reference they came from, and reproduced in RESULTS — never a bare literal whose origin lives only in a transcript |
| T-tpx-06 | Elevation of Privilege | promoted parameter sets / published artifacts | medium | accept | No promote, publish, version bump, or R2 write is in scope; the replays are read-only against the local corpus and write only to gitignored `reports/` directories |

No package-manager install occurs in this task, so no package legitimacy gate applies.
</threat_model>

<verification>
- The scorer reproduces a valid join on the pre-existing autopsy stream, with zero out-of-range
  observations, before any replay is spent.
- The reference per-variable spreads are measured from the corpus by a committed script and printed,
  and the three relative constants are derived from them and the documented defaults.
- Baseline, control and candidate replays use the identical harness command shape, season range and
  algorithm id, and all three report the identical `vpr` `algorithmVersion`.
- All three series are scored on one matchKey intersection with one epsilon and one denominator.
- The win-probability guard is evaluated before any verdict and can invalidate the experiment.
- Both patches are reverted; `digest.test.ts` and the full repo-root suite pass on the final tree.
- The commit contains only the quick task directory.
</verification>

<success_criteria>
- An RP-pmf log-loss objective exists as committed, runnable code — the measurement the todo names
  as absent.
- `260905-tpx-RESULTS.md` records an explicit WIN, NO-WIN, or INVALID verdict decided by the
  pre-committed criteria and justified with quoted numbers, plus the ship-task outline.
- `git status` is clean for `packages`, `data`, `fixtures`, and `reports`.
- No new `Sigma1Params` field, no `SIGMA1_CODE_VERSION` bump, no promotion, no publish, no network.
</success_criteria>

<output>
Commit the quick task directory (PLAN, RESULTS, both instrument scripts) with a
`docs(quick-260905-tpx)` message summarizing the verdict.
</output>
