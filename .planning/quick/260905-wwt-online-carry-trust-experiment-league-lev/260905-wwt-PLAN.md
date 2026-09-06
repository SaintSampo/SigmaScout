---
quick_id: 260905-wwt
phase: quick-260905-wwt
plan: 01
type: execute
wave: 1
depends_on: []
date: 2026-09-05
mode: quick
description: "Online carry-trust experiment — a league-level, walk-forward-learned trust signal that lets VPR seed season boundaries confidently while defusing pattern-break seasons. Two arms (seed-only, seed+rescue) isolate the rescue mechanism's contribution. Working-tree experiment: patched, replayed, REVERTED. Nothing ships."
autonomous: true
requirements: [QUICK-260905-WWT]
files_modified:
  - .planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/score-carrytrust.cjs
  - .planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/260905-wwt-RESULTS.md
temporarily_patched:
  - packages/core/algorithms/sigma1/index.ts   # patched twice, reverted twice, NEVER committed
generated_untracked:
  - reports/carrytrust-s-260905/
  - reports/carrytrust-sr-260905/

estimate:
  tokens: 75000
  raw_tokens: 150000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "Each arm has a full 2022-2026 vpr prediction stream produced by the identical harness command shape as the reused baseline, differing ONLY by the patch."
    - "Arm SR's diff CONTAINS Arm S's diff verbatim, so the SR-minus-S delta measures the rescue mechanism and nothing else."
    - "Every reported number for all four series (baseline, S, SR, epa) is computed on ONE matchKey intersection and ONE early-slice event set."
    - "2022 is the replay's cold-start season, so both arms are byte-identical to the baseline there — the free control, asserted rather than assumed."
    - "The pre-committed verdict is recorded against every criterion, including a negative one, and the Rule-A ship-relevance reading is recorded independently."
    - "After the final revert the working tree under packages/ is byte-identical to HEAD and reproduces the committed digests."
  artifacts:
    - .planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/score-carrytrust.cjs
    - .planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/260905-wwt-RESULTS.md
    - reports/carrytrust-s-260905/predictions-2022.jsonl through predictions-2026.jsonl
    - reports/carrytrust-sr-260905/predictions-2022.jsonl through predictions-2026.jsonl
  key_links:
    - "The vpr baseline is reports/rpnoise-baseline-260905 (vpr@9.0.0+rolling-2026-09c, the LIVE promoted set). The epa columns come from reports/autopsy-260905 — its `epa` rows ONLY; that directory's vpr rows are the STALE 8.0.0+rolling-2026-09b set and must never enter any series."
    - "The rescue reads `Sigma1State.carryTrust` as it stood BEFORE this match and folds this match's observations only afterwards — that ordering IS the walk-forward guarantee, and nothing else enforces it."
    - "Both arm artifacts must report algorithmVersion 9.0.0+rolling-2026-09c, identical to the baseline — proof no version bump or parameter change leaked in alongside the patch."
---

<objective>
Test whether a league-level, walk-forward-learned "carry reliability" signal can let VPR seed
season boundaries CONFIDENTLY — capturing the accuracy win Stage 2 measured on 2025 (+0.41pt
out-of-sample at factor 0.845, the strongest challenger ever posted against `rolling-2026-09b`)
— while AUTOMATICALLY defusing the pattern-break season that same confidence loses on (2024,
which has gone 0-for-16 accuracy-positive across every carry formulation tried).

Two arms isolate the mechanism. Arm S applies the confident seed alone; Arm SR applies the
same seed PLUS an online rescue that sheds carried priors faster when they are collectively
mispredicting. SR-minus-S is the rescue's isolated contribution — the number this experiment
exists to produce.

Purpose: convert the pattern-break risk that Rule A accepted with eyes open (see the DECISION
section of `.planning/todos/completed/retune-sigma1-rolling-origin.md`) into a self-correcting
mechanism, or record on measurement that it cannot be.

Output: `260905-wwt-RESULTS.md` with per-season tables for four series, the SR-minus-S delta,
and a pre-committed verdict. Two untracked arm stream directories under `reports/`.

**This is a working-tree experiment.** Model code is patched, replayed, and REVERTED. No new
`Sigma1Params` field, no `SIGMA1_CODE_VERSION` bump, no promotion, no publish, no network, and
nothing under `packages/`, `data/algorithm-versions/`, or `fixtures/` is ever committed.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@packages/core/algorithms/sigma1/index.ts
@packages/core/algorithms/sigma1/adaptation.ts
@.planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs
</context>

<interface_facts>
Verified live in the tree at planning time — do not re-derive, do not re-read these files to
confirm them.

**The carrySeason seed site.** `carrySeason` is `packages/core/algorithms/sigma1/index.ts:1776`.
Its per-team loop runs 1827-1948; the per-component loop runs 1863-1924. The current seed
expression is lines 1917-1920: a ternary whose inert branch fires when
`(resolved.carryVarianceFactor === 1 && resolved.carryEvidenceRate === 0) || oldTeamState === undefined`
and whose active branch is
`Math.max(resolved.minConsistencyVariance, coldStartVariance * resolved.carryVarianceFactor * evidenceFactor)`.
`coldStartVariance` is line 1877; `evidenceFactor` is line 1860; `oldTeamState` is line 1829.
Line 1921 assigns `beliefs[name]`; lines 1922-1923 assign `consistency[name]` and are NOT part
of this experiment. `ADJUST_COMPONENT` is `continue`d at 1868-1872 before any of it.

**The team-state literal carrySeason builds** is `nextTeams.set(team, {...})` at 1925-1947 —
it already resets `matchCount: 0`, `lastEventKey: null`, and `innovationStats:
emptyInnovationStats()`. The state literal `carrySeason` returns is 1950-1990.

**The process-noise site.** `applyTeamProcessNoise` is line 449, signature
`(teamState: Sigma1TeamState, eventKey: string, params: Sigma1ResolvedParams)`. It picks `q`
from `params.processNoiseWithinEvent` / `params.processNoiseEventBoundary` (454-457), then
line 467 is `const scaledQ = q * adaptationFactor(teamState.innovationStats, params);`. It is
called from exactly ONE site: `applyAllianceUpdate` line 679.

**The innovation site.** `applyAllianceUpdate` is line 651, returns `AllianceUpdateResult`
(interface at 617-637: `teams`, `league`, `residualsByTeam`). It has an empty-alliance early
return at 663-671 and its final return literal is 975-982. Its per-team finalization loop is
930-973; line 951-954 already computes `meanSquaredNormalizedInnovation` for each team (the
mean of squared per-component normalized innovations), and line 955 takes its square root
before folding at line 968. `workingTeams.get(team)` — bound to `working` at line 931 — holds
the PRE-increment `matchCount` (line 966 does the increment).

**The update site.** `update` is line 1229. It calls `applyAllianceUpdate` twice: `afterRed`
at 1391 (over `state.teams`) and `afterBlue` at 1403 (over `afterRed.teams`). Its returned
state literal is 1542-1556 (`season`, `componentOrder`, `teams: finalTeams`, `league`,
`allianceScoreStats`, `priorSeasonRatings`, `rpSkippedMatchCount`,
`breakdownParseFailureCount`, `elimScoreOffset`). `initState` is line 308. `Sigma1TeamState`
is the interface at 202-230; `Sigma1State` is 257-304.

**Promoted parameters actually in force** (`data/algorithm-versions/vpr@9.0.0+rolling-2026-09c.json`,
the live pin, per-season sets): `carryEvidenceRate` is 0 for EVERY season. `carryVarianceFactor`
is **0.8448855225401831 for 2025** and exactly **1** for every other season. `adaptationEnabled`
is true for 2025 and 2026 only. This is load-bearing for reading the results — see P-3 below.

**Baseline streams, both already on disk, both to be REUSED — never re-replayed.**
- `reports/rpnoise-baseline-260905/` — `vpr@9.0.0+rolling-2026-09c` ONLY, produced by
  `pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/rpnoise-baseline-260905`.
  This is the vpr baseline series.
- `reports/autopsy-260905/` — contains BOTH `epa@5.0.0+baseline` and a STALE
  `vpr@8.0.0+rolling-2026-09b`. Only its `epa` rows are used. `epa` is unchanged since, so
  those rows are still valid.
- Per-season `scoredCount` in the two artifacts is IDENTICAL (14603 / 16290 / 16958 / 17815 /
  18337 combined across comp levels), so the two runs cover the same match population.

**Per-season winner accuracy from the two artifacts' own `combined` slices** — an anchor
produced by the harness, independent of any scorer written here:

| season | epa (autopsy) | vpr baseline (rpnoise) | direction |
|---|---|---|---|
| 2022 | 0.7602 | 0.7569 | epa ahead |
| 2023 | 0.7623 | 0.7563 | epa ahead |
| 2024 | 0.7330 | 0.7452 | **vpr ahead** |
| 2025 | 0.7767 | 0.7662 | epa ahead |
| 2026 | 0.7934 | 0.7907 | epa ahead |

**Prediction JSONL record fields** (one line per algorithm per match): `matchKey`, `season`,
`eventKey`, `compLevel`, `algorithmId`, `algorithmVersion`, `predictedWinner`, `pRedWin`,
`predictedRedScore`, `predictedBlueScore`, `redComponents`, `blueComponents`, `actualWinner`,
`actualRedScore`, `actualBlueScore`. The two `*Components` blobs dominate file size (30-66 MB
per season).

**Tooling.** Harness entry: `package.json` script `harness` = `tsx --env-file=.env
packages/harness/cli.ts`. Typecheck: `npx tsc --noEmit` at repo root. `tsconfig.json` sets
`strict` and `noUncheckedIndexedAccess` but NOT `noUnusedLocals` — a local left unread by a
patch does not fail the typecheck.
</interface_facts>

<planner_decisions>
Five design details the brief delegated. Each is DECIDED here, with its reason, and each must
be restated in RESULTS.md so a future reader can reproduce the experiment from the record.

**P-1 — The trust signal folds ONLY early-window observations.** The brief says the accumulator
pools observations from carried teams. It is NARROWED here to carried teams whose pre-increment
`matchCount` is below the same 12-match window the rescue acts on. Reason, and it is a
correctness argument rather than a preference: at alpha 0.05 the EWMA tracks roughly the last
20 observations, and by week 2 of a season the overwhelming majority of carried-team matches
come from teams whose priors have already washed out and whose normalized innovations have
returned to ~1. Folding those would drag the accumulator back to its inert value within days,
so a team debuting in week 5 of a pattern-break season would get NO rescue — the exact case the
mechanism exists to serve. Signal window and action window are therefore the same window.

**P-2 — The rescue is injected in `applyTeamProcessNoise`,** as a multiplier applied to
`scaledQ` AFTER `adaptationFactor`, guarded by an explicit branch that skips the multiplication
entirely when the factor is exactly 1. Reason: that one function is the sole consumer of the
process-noise magnitude and already has both `teamState` and `params` in scope, so no new
plumbing reaches any other layer; and the explicit skip branch — the same discipline
`carryVarianceFactor`'s own `=== 1` branch documents at line 1885 — is what makes the 2022
cold-start control a proof rather than a floating-point hope.

**P-3 — The hardcoded 0.5 seed REPLACES the promoted `carryVarianceFactor * evidenceFactor`
product; it does not compose with it.** Both arms therefore seed every carried team at exactly
half the cold-start variance in every season. Consequence that MUST be stated in RESULTS.md
next to the 2025 row: the baseline already carries 0.845 for 2025, so 2025's arm-vs-baseline
delta measures a move from 0.845 to 0.5, while every other season measures a move from 1.0 to
0.5. 2025 is the season with the smallest seed change and the season Stage 2 said was most
promising — read its delta with that in mind.

**P-4 — Carried teams are marked with an OPTIONAL field on `Sigma1TeamState`,** set only in
`carrySeason`. Reason: every downstream construction of a team state either spreads the
existing object (`...working` in `applyAllianceUpdate`, `...existing` in the RP merge) or is
`coldStartTeamState`, which correctly leaves it absent. One write site, zero propagation code,
and being optional keeps `stateSnapshot.ts` and every other consumer typechecking untouched.

**P-5 — The accumulator lives as an OPTIONAL field on `Sigma1State`,** reset to 1 in both
`initState` and `carrySeason`'s returned literal, read pre-match in `update`, folded post-match
from both alliances' observations. Reason: this is the same top-level placement and the same
reset-at-boundary reasoning `elimScoreOffset` already documents at lines 277-293 — a
league-level scalar statistic, beside `allianceScoreStats`, not inside `Sigma1League` (which
holds only per-component maps).
</planner_decisions>

<tasks>

<task type="tracer">
  <name>Task 1: Build the four-series scoring instrument and validate it against the two existing baselines</name>
  <files>.planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/score-carrytrust.cjs</files>
  <action>
Write the join-and-score script FIRST, before any patch or replay, and prove it reproduces
figures the harness produced independently — so that when the arm streams land, the instrument
is already trusted and the only new variable is the model patch.

Adapt `.planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs`
rather than rebuilding from scratch: its streaming discipline, its intersection rule, its early
slice, and its SE-unit delta column are all correct and reusable. What changes is that the two
baseline series now come from TWO DIFFERENT directories, and that a new SR-minus-S column is
required.

Script location is this quick task directory, committed alongside RESULTS.md, because
`reports/` is gitignored and an uncommitted script would leave the results unreproducible.
Plain CommonJS `.cjs`, run with bare `node`, no new dependency.

Interface: `node <script> [--arms none|s|sr|s,sr]`, default `none`. With `none` it scores only
the two baseline series; that is the mode this task verifies.

**Series wiring, and this is the part most likely to be got wrong.** Four series:
  - `baseline` — from `reports/rpnoise-baseline-260905/predictions-{season}.jsonl`. Every row
    in that directory is vpr.
  - `epa` — from `reports/autopsy-260905/predictions-{season}.jsonl`, taking ONLY rows whose
    `algorithmId` is `epa`. That directory also holds a stale `vpr@8.0.0+rolling-2026-09b`
    series which must be dropped on read and must never reach any accumulator. Keying a series
    by `algorithmId` alone is the bug this instruction exists to prevent: two directories both
    contain vpr rows and they are different models.
  - `s` — from `reports/carrytrust-s-260905/predictions-{season}.jsonl`.
  - `sr` — from `reports/carrytrust-sr-260905/predictions-{season}.jsonl`.
Arm rows carry `algorithmId` of vpr; key them by the DIRECTORY they came from, never by that
field.

**Version guard, printed per season or once per run.** Collect the distinct `algorithmVersion`
seen per series and assert exactly one each: `9.0.0+rolling-2026-09c` for `baseline`, `s`, and
`sr`; `5.0.0+baseline` for `epa`. Print them. A drifted version means the replay ran a
different promoted parameter set and every downstream number is meaningless.

**Reading discipline, load-bearing.** The baseline files alone total roughly 240 MB and a full
four-series run reads roughly 700 MB. Stream each file line by line with `readline` over
`fs.createReadStream`. Parse each line, then retain ONLY the scalar fields `matchKey`,
`eventKey`, `algorithmId`, `algorithmVersion`, `pRedWin`, `actualWinner`. Never retain the
parsed object — the component blobs are the bulk of every line and holding them would exhaust
the heap.

**Per-season algorithm**, for each of 2022 through 2026:
  1. Stream the `baseline` directory into a map keyed on `matchKey` holding `eventKey`,
     `actualWinner`, and that row's `pRedWin` under the series key `baseline`. Record each
     distinct `eventKey` the first time it is seen — that first-appearance order IS
     chronological order, because the stream is written by a walk-forward replay.
  2. Stream the `autopsy` directory, keeping epa rows only, filing `pRedWin` under `epa` on the
     matching entry.
  3. Stream each requested arm directory, filing `pRedWin` under `s` or `sr` respectively.
  4. Scored set = matchKeys present in EVERY requested series whose `actualWinner` is exactly
     red or blue. Ties and any matchKey missing from any series are excluded, so every series
     shares one denominator. Print the denominator per season and the count dropped for reasons
     other than a tie.
  5. Early slice: from the distinct `eventKey` list in first-appearance order, take the first
     `Math.ceil(eventCount * 0.33)` as the early event set. Derive it ONCE from the baseline
     stream and apply it identically to every series — this is the same definition Stage 1
     used, so the two experiments' early-slice numbers are comparable.
  6. Metrics per series over the scored set: accuracy, where the pick is red when `pRedWin` is
     at least 0.5 and blue otherwise and is correct when it equals `actualWinner`; and Brier as
     the mean of the squared difference between `pRedWin` and the red-won indicator. Report both
     over the full scored set, plus accuracy over the early slice.
  7. Per season, compute the binomial standard error of the BASELINE accuracy from that season's
     scored count. For each arm print its accuracy delta from baseline expressed in units of
     that SE, so the verdict is mechanical rather than eyeballed.
  8. When both arms are present, print an SR-minus-S column: the raw accuracy difference and the
     same difference in baseline-SE units. This column is the rescue's isolated effect and is
     the single most important output of the whole experiment.

**Output:** a markdown table per season with accuracy, Brier, early-slice accuracy, early-slice
n and scored n for every present series, the SE-unit delta column for arms, and the SR-minus-S
column; a pooled all-seasons row computed the same way; and a final line reading `TOTAL_SCORED=`
followed by the sum of the per-season scored counts. Print to stdout. The executor pastes the
output into RESULTS.md — the script must not write RESULTS.md itself.

**Validation anchors for this task**, all three produced independently of this script:
  - Stage 1's join over the same corpus and the same tie/pick rules scored 83,655 matches.
  - The two artifacts' own `combined` slices give per-season winner accuracies (table in
    `<interface_facts>`). This script scores a slightly different population (one intersection,
    no no-call handling of its own), so expect agreement in DIRECTION and level, not to four
    decimal places.
  - The direction facts to reproduce: 2024 is the ONE season where the vpr baseline beats epa;
    2022, 2023, 2025 and 2026 all have epa ahead.
  </action>
  <verify>
    <automated>node .planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/score-carrytrust.cjs --arms none</automated>
  </verify>
  <done>
The command exits 0 and prints five per-season rows plus a `TOTAL_SCORED=` line whose value is
within 1% of 83,655; the version guard prints exactly `9.0.0+rolling-2026-09c` for baseline and
exactly `5.0.0+baseline` for epa; the dropped-for-reasons-other-than-a-tie count is 0 for every
season; and the per-season directions match the anchor table — 2024 baseline above epa, the
other four seasons epa above baseline — with accuracy levels inside roughly 0.01 of the
artifact figures.

If the total misses that band, or if any season's direction disagrees, or if the dropped count
is nonzero, HALT and reconcile the join before running any replay. A nonzero drop count means
the two baseline directories disagree about the match population, which the artifacts say they
should not; it must be surfaced and explained, never silently absorbed. Do not proceed on an
instrument that disagrees with the artifacts it is meant to extend.

Then commit the instrument alone, by explicit path
(`git add .planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/score-carrytrust.cjs`),
with a `chore(quick-260905-wwt):` message. Never `git add -A` or `git add .` — a concurrent
session shares this checkout and holds unrelated untracked work.
  </done>
</task>

<task type="auto">
  <name>Task 2: Patch, typecheck, replay, and revert each arm — strictly sequentially</name>
  <files>packages/core/algorithms/sigma1/index.ts</files>
  <precondition>`git status --porcelain packages` is empty, `data/corpus.sqlite` exists, and all five `reports/rpnoise-baseline-260905/predictions-{2022..2026}.jsonl` streams exist. Halt if any is false. A dirty `packages` tree makes the revert step unable to distinguish this experiment's patch from another session's work — and if it is dirty with edits this plan did not make, report and stop rather than reverting someone else's file.</precondition>
  <action>
One working tree, one file, two arms. Run them strictly in sequence: patch S, typecheck,
replay, revert, confirm clean; only then start SR. Never hold both patches at once.

**Arm S — the confident seed alone.** One edit, plus one module-level constant.

Add a module-level constant near the other Sigma1 constants holding the experiment's seed
factor, value exactly 0.5, named so that it reads unmistakably as experiment-only scaffolding.
Then replace the `seededVariance` ternary at lines 1917-1920 so that the inert branch fires on
`oldTeamState === undefined` ALONE, and the active branch is the maximum of
`resolved.minConsistencyVariance` and `coldStartVariance` times that new constant. Per P-3 the
constant REPLACES `resolved.carryVarianceFactor * evidenceFactor` rather than composing with
it; `evidenceFactor` is left computed but unread, which is fine because `noUnusedLocals` is off.
Line 1921's `beliefs[name]` assignment, lines 1922-1923's consistency handling, and the
`ADJUST_COMPONENT` early-continue are all UNTOUCHED. Arm S needs no import change, no interface
change, and no new state.

**Arm SR — the same seed PLUS the online rescue.** Arm SR's diff must CONTAIN Arm S's diff
verbatim; that containment is what makes SR-minus-S the rescue's isolated effect rather than a
comparison of two different seeds. Nine edit sites, all in the same file:

  1. `Sigma1TeamState` (interface, 202-230): add an optional readonly boolean marking that this
     team entered the current season through a boundary WITH carried state. Optional by P-4.
  2. `Sigma1State` (interface, 257-304): add an optional readonly number holding the league-level
     trust accumulator. Optional by P-5.
  3. Beside Arm S's seed constant, add three more experiment constants: the EWMA alpha at 0.05,
     the early-window match count at 12, and the rescue's upper clamp at 8. All hardcoded; no
     `Sigma1Params` field is created, which is what keeps this a non-shipping experiment.
  4. `initState` (308): set the accumulator to 1 — the "correctly specified" cold value, the same
     prior `emptyInnovationStats` documents for its per-team analogue.
  5. `applyTeamProcessNoise` (449): add a trailing `carryTrust: number` parameter. Compute a
     rescue factor that is EXACTLY 1 unless the team is marked carried AND its `matchCount` is
     below the window constant, in which case it is the square root of `carryTrust` clamped
     between 1 and the max constant — one-sided by construction, so it can only ever shed priors
     faster, never slow the filter down. Then apply it to line 467's `scaledQ` under an explicit
     branch that SKIPS the multiplication entirely when the factor is exactly 1 (P-2). The
     `matchCount` read here is the pre-increment value, so a carried team's matches 1 through 12
     are the rescued ones.
  6. `AllianceUpdateResult` (617-637): add a readonly array of this alliance's trust
     observations.
  7. `applyAllianceUpdate` (651): add a trailing `carryTrust: number` parameter; return an empty
     observations array from the empty-alliance early return at 663-671; pass `carryTrust`
     through to `applyTeamProcessNoise` at line 679; inside the finalization loop at 930-973
     push the ALREADY-COMPUTED `meanSquaredNormalizedInnovation` from line 951 onto the
     observations array when `working` is marked carried and `working.matchCount` is below the
     window constant (P-1); and include the array in the return literal at 975-982. Do not
     recompute the innovation — line 951 is exactly the squared normalized innovation the
     accumulator wants, and `foldInnovation` at line 968 already guarantees it is finite.
  8. `update` (1229): read the accumulator from `state` before the two `applyAllianceUpdate`
     calls, defaulting to 1 when absent, and pass that SAME pre-match value to BOTH calls at
     1391 and 1403. That is the walk-forward guarantee: a match's own two alliances can never
     influence the trust value their own update is performed under. After both calls, fold the
     red observations then the blue observations into a new accumulator value with the standard
     EWMA form at the alpha constant, and add the result to the returned state literal at
     1542-1556.
  9. `carrySeason` (1776): Arm S's seed edit, unchanged; set the carried marker in the
     `nextTeams.set` literal at 1925-1947 to whether `oldTeamState` was defined; and set the
     accumulator to 1 in the returned state literal at 1950-1990 — reset at every boundary, the
     same reasoning `elimScoreOffset` documents at 285-291. The early return at line 1777 for a
     cold-start boundary is untouched, which is precisely what makes 2022 the free control.

**Per-arm sequence, identical for both:**
  1. Apply the patch with Edit.
  2. Run `npx tsc --noEmit` — it must be clean before spending replay time on it.
  3. Run `pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/carrytrust-s-260905`
     (and `reports/carrytrust-sr-260905` for SR). Same season range, same algorithm id, same
     command shape as the reused baseline: the patch is the only difference. Invoke it with the
     Bash tool's own `timeout` parameter set to 600000. Do NOT wrap the command in the `timeout`
     binary — on this machine that swallows all output and exits 0, turning a failed replay into
     a false green. If the run overruns the tool cap, re-run with `run_in_background` and poll
     for the five season files rather than shortening the season range.
  4. Run `git checkout -- packages/core/algorithms/sigma1/index.ts` and confirm
     `git status --porcelain packages` is empty again.

Do NOT run the vitest suite while patched. Both patches intentionally change prediction streams
for 2023 onward, so digest tests WILL fail — that is the expected, correct behavior of a working
digest gate, not a problem to fix or a signal to weaken. Typecheck only while patched.

If any step fails mid-patch, revert the file FIRST, then report. Never leave the tree patched.

The harness replays against the local `data/corpus.sqlite` and needs no network. If a command is
denied network access, halt and report rather than working around it.
  </action>
  <verify>
    <automated>test -z "$(git status --porcelain packages)" && echo TREE_CLEAN && ls reports/carrytrust-s-260905/predictions-*.jsonl reports/carrytrust-sr-260905/predictions-*.jsonl | wc -l && node -e "const c=require('crypto'),fs=require('fs');const h=p=>c.createHash('sha256').update(fs.readFileSync(p)).digest('hex');const b=h('reports/rpnoise-baseline-260905/predictions-2022.jsonl');for(const d of ['carrytrust-s-260905','carrytrust-sr-260905']){console.log(d,h('reports/'+d+'/predictions-2022.jsonl')===b?'CONTROL_2022_IDENTICAL':'CONTROL_2022_DIFFERS');const a=fs.readFileSync('reports/'+d+'/artifact.json','utf8');console.log(d,a.includes('9.0.0+rolling-2026-09c')?'VERSION_MATCHES_BASELINE':'VERSION_DRIFTED');}"</automated>
  </verify>
  <done>
`TREE_CLEAN` prints, the file count is 10 (five season streams per arm directory, all nonzero
size), both arms print `CONTROL_2022_IDENTICAL`, and both print `VERSION_MATCHES_BASELINE`.

The 2022 control is the load-bearing one. 2022 is index 0 of the replay range, so
`seasonBoundaryFor` reports a cold start, `carrySeason` returns at line 1777 before any seed
runs, no team is ever marked carried, the accumulator never leaves 1, and the rescue's explicit
skip branch never multiplies anything. A 2022 stream that differs from the baseline by a single
byte therefore means the patch reached a code path it was never supposed to reach — halt,
diagnose, and do not score anything until it is explained.

Both patches have been reverted; `git diff` against HEAD is empty for every path under
`packages/`. Nothing was committed by this task.
  </done>
</task>

<task type="auto">
  <name>Task 3: Score all four series, apply the pre-committed verdict, prove the tree is back to live behavior</name>
  <files>.planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/260905-wwt-RESULTS.md</files>
  <action>
Run the instrument across all four series: the same script from Task 1, now with `--arms s,sr`.
Capture the full stdout.

**Apply the PRE-COMMITTED criteria mechanically, in this order, with no post-hoc adjustment.**

First, the premise check. If Arm S beats the baseline on overall accuracy in NO season, the
whole hypothesis fails at its first step — confident seeding buys nothing to rescue — and the
verdict is PREMISE FAILED. Record it with the same weight and the same detail as a win, then
skip criteria (a) and (b) as vacuous and still evaluate (c) and the Rule-A reading.

The MECHANISM VALIDATES only if all three hold:
  - **(a) Retention.** Take the set of seasons where S's overall accuracy exceeds the baseline's.
    Pool the scored matches across exactly those seasons. Compute the pooled accuracy gain over
    baseline for S and for SR on that pooled set. SR must retain at least 60% of S's gain.
  - **(b) Rescue of the pattern-break season.** Let the S loss be
    `max(0, baseline2024Accuracy - S2024Accuracy)` and the SR loss the same expression for SR.
    SR's loss must be at most half of S's loss. If S's 2024 loss is zero, record that the
    premise's second half did not reproduce — 2024 did not punish the confident seed this time —
    and mark (b) vacuous rather than passed.
  - **(c) Never the worst option.** In no season may SR be worse than BOTH the baseline and S
    beyond noise. Mechanically: for each season, if SR's accuracy is below both, the criterion
    fails when SR is more than 1.0 baseline-SE below EITHER of them. Use the same per-season
    binomial baseline SE the script already prints, as the one common yardstick.

Then, INDEPENDENTLY of the three criteria above, record the ship-relevant question under a
Rule-A-style reading: pooled accuracy up versus baseline AND pooled Brier not worse. That is the
standard the operator adopted on 2026-09-05 and it is a different question from whether the
mechanism works — report both answers, and do not let either one soften the other.

Also assert and report the 2022 control from Task 2 (byte-identical streams), and state the
seasons where the arms diverge from baseline (2023 onward, the seasons with a boundary).

**Write `260905-wwt-RESULTS.md`** in this quick task directory containing:
  - The motivation in three or four sentences, with pointers to the Stage 2 and Stage 3 verdict
    tables and the Rule A DECISION section in
    `.planning/todos/completed/retune-sigma1-rolling-origin.md`.
  - The exact diff of each arm's patch as a fenced block, so the experiment is reproducible from
    the committed record alone after the working-tree patches are gone, plus an explicit
    statement that Arm SR's diff contains Arm S's diff verbatim.
  - All five planner decisions P-1 through P-5 restated with their reasons — especially P-3, and
    the 2025 reading it forces: the baseline already carries factor 0.845 there, so 2025's delta
    measures 0.845 to 0.5 while every other season measures 1.0 to 0.5.
  - The exact commands run for each replay, and the note that the baseline and epa streams were
    REUSED rather than re-replayed, naming both source directories and both algorithm versions.
  - The full per-season and pooled tables from the script, including the SR-minus-S column.
  - The early-slice definition stated explicitly (first-appearance chronological event order,
    first `ceil(33%)` of a season's events) and the note that it matches Stage 1's definition.
  - The verdict against every criterion with the deciding numbers quoted, the independent Rule-A
    reading, and — whatever the outcome — a plain statement of what the day's carry-variance
    thread should conclude from it.
  - A reproducibility note recording that `reports/` is gitignored, so none of the four stream
    sets is recoverable from git and all must be regenerated by re-running the recorded commands.

A negative result is a completed experiment. This one closes off a named mechanism either way,
and a NO-VALIDATION verdict recorded honestly is worth more than a validated one argued into
existence. Do NOT promote, tune, add a parameter, or productionize anything on the strength of
a positive result either — the follow-up is a separate decision for the user.

If the Write tool is blocked on the RESULTS path, return the complete document text in the task
output and let the caller write it. Do not route around a blocked write with a Bash heredoc.

Then prove the tree is back to bitwise-live behavior: run
`npx vitest run packages/harness/digest.test.ts`. Use `npx vitest run` directly, not a `pnpm`
wrapper under the `timeout` binary, and read the actual test output rather than trusting the
exit code alone.

**Commit scope: NOTHING.** The instrument was already committed in Task 1. RESULTS.md is left
uncommitted for the orchestrator's docs commit, together with the plan and the summary. Do not
stage anything in this task, and under no circumstances `git add -A` or `git add .` — a
concurrent session shares this checkout.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/digest.test.ts && test -f .planning/quick/260905-wwt-online-carry-trust-experiment-league-lev/260905-wwt-RESULTS.md && git status --porcelain packages data fixtures | wc -l</automated>
  </verify>
  <done>
`digest.test.ts` passes on the reverted tree, proving the working tree reproduces the committed
prediction digests bitwise and that neither patch survived. RESULTS.md exists and states an
explicit VALIDATES / DOES-NOT-VALIDATE / PREMISE-FAILED verdict with each of criteria (a), (b),
(c) individually adjudicated and its deciding number quoted, plus the independent Rule-A
reading, plus all five planner decisions and the P-3 caveat on the 2025 row. The final
`git status` line count over `packages data fixtures` is 0. No commit was made by this task.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `.env` -> harness process | `pnpm harness` runs `tsx --env-file=.env`; live TBA and R2 credentials load into a process whose output is streamed into an agent transcript |
| working tree -> git history | Temporary model patches live in a tracked file and could be committed by an over-broad staging command |
| this session -> concurrent session | One checkout, two sessions: a `git add -A` or an over-broad `git checkout --` would absorb or destroy the other session's work |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-wwt-01 | Information Disclosure | `.env` read by `pnpm harness` | high | mitigate | Never `Read`, `cat`, or echo `.env`; let `tsx --env-file` consume it by path, exactly as CLAUDE.md's secrets-handling convention requires. Harness stdout is a replay progress log and carries no credential |
| T-wwt-02 | Tampering | `packages/core/algorithms/sigma1/index.ts` | high | mitigate | Each patch is reverted with `git checkout --` on that ONE path after its replay; Task 2 and Task 3 both gate on `git status --porcelain packages` being empty, and Task 3 additionally proves bitwise-live behavior via `digest.test.ts` |
| T-wwt-03 | Tampering | git staging area (shared checkout) | high | mitigate | Task 1 stages exactly one file by explicit path; Tasks 2 and 3 stage nothing. Never `git add -A` or `git add .`. Never `git checkout --` any path this plan did not itself patch |
| T-wwt-04 | Spoofing | arm streams replayed under the wrong parameter set | medium | mitigate | Both the artifact-level version guard (Task 2 verify) and the per-row version guard inside the scorer assert `9.0.0+rolling-2026-09c`; a drifted version fails the task rather than producing a plausible-looking table |
| T-wwt-05 | Tampering | the walk-forward guarantee itself | high | mitigate | The accumulator is read from `state` BEFORE either alliance update and folded only after both; the 2022 cold-start byte-identity control catches any leak that reaches a season with no boundary |
| T-wwt-06 | Elevation of Privilege | promoted parameter sets / published artifacts | medium | accept | No promote, publish, version bump, or R2 write is in scope; the replays are read-only against the local corpus and write only to gitignored `reports/` directories |

No package-manager install occurs in this task, so no package legitimacy gate applies.
</threat_model>

<verification>
- Task 1's instrument reproduces Stage 1's independently-produced scored-match count to within
  1% and matches the harness artifacts' per-season direction before any replay is run.
- Both arm replays use the identical harness command shape, season range, and algorithm id as
  the reused baseline, and their artifacts report the identical algorithm version.
- Arm SR's diff contains Arm S's diff verbatim, so SR-minus-S isolates the rescue.
- 2022 streams are byte-identical to the baseline for both arms.
- All four series are scored on one matchKey intersection and one early-slice event set, with
  the epa series drawn from `algorithmId` epa rows only.
- Both patches are reverted; `digest.test.ts` passes on the final tree.
- Only `score-carrytrust.cjs` was committed, by explicit path, in Task 1.
</verification>

<success_criteria>
- `260905-wwt-RESULTS.md` records an explicit verdict against criteria (a), (b) and (c)
  individually, plus the independent Rule-A ship-relevance reading, each justified with quoted
  numbers, and restates planner decisions P-1 through P-5 including the P-3 caveat on 2025.
- `git status` is clean for `packages`, `data`, and `fixtures`.
- No new `Sigma1Params` field, no `SIGMA1_CODE_VERSION` bump, no promotion, no publish, no
  network call.
</success_criteria>

<output>
The executor commits ONLY `score-carrytrust.cjs`, in Task 1, by explicit path. RESULTS.md,
this PLAN, and the SUMMARY are left for the orchestrator's `docs(quick-260905-wwt)` commit.
</output>
