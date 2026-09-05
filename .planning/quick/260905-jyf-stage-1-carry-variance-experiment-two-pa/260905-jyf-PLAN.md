---
quick_id: 260905-jyf
phase: quick-260905-jyf
plan: 01
type: execute
wave: 1
depends_on: []
date: 2026-09-05
mode: quick
description: "Stage 1 carry-variance experiment — two parameter-free boundary-variance seed rules in carrySeason, replayed 2022-2026 and scored against the live VPR baseline. Working-tree experiment: patched, replayed, REVERTED."
autonomous: true
requirements: [QUICK-260905-JYF]
files_modified:
  - .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs
  - .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/260905-jyf-RESULTS.md
temporarily_patched:
  - packages/core/algorithms/sigma1/index.ts   # patched twice, reverted twice, NEVER committed
generated_untracked:
  - reports/carryvar-r1-260905/
  - reports/carryvar-r2-260905/

estimate:
  tokens: 70000
  raw_tokens: 35000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Each candidate rule has a full 2022-2026 vpr prediction stream produced by the same harness command shape as the baseline, differing only by the patch."
    - "Every reported number for all four series (baseline-vpr, r1, r2, epa) is computed on the identical matchKey intersection and the identical early-slice event set."
    - "The pre-committed verdict is recorded for BOTH rules, including a negative one."
    - "After the final replay the working tree under packages/ is byte-identical to HEAD and reproduces the committed digests."
  artifacts:
    - .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs
    - .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/260905-jyf-RESULTS.md
    - reports/carryvar-r1-260905/predictions-2022.jsonl through predictions-2026.jsonl
    - reports/carryvar-r2-260905/predictions-2022.jsonl through predictions-2026.jsonl
  key_links:
    - "carrySeason's component loop (index.ts ~1842-1849) is the ONLY edited site — the belief variance seed, not the consistency accumulator."
    - "Candidate artifact.json must report algorithmVersion 8.0.0+rolling-2026-09b, identical to baseline — proof no version bump or param change leaked in."
    - "The early-slice event set is derived ONCE from the baseline stream and reused for all four series."
---

<objective>
Test the measured diagnosis in `reports/autopsy-260905/FINDINGS.md` — that VPR's accuracy
deficit vs EPA is an early-information deficit caused by resetting belief VARIANCE to the
cold-start prior at every season boundary while carrying an EPA-equivalent MEAN across it.

Two parameter-free candidate seed rules are patched into `carrySeason`, each replayed over
2022-2026, and scored against the live VPR baseline and EPA on overall accuracy/Brier and on
an early-season slice.

Purpose: decide, on measurement rather than argument, whether boundary-variance seeding is a
real lever, before any parameter, version, or promotion work is proposed.

Output: `260905-jyf-RESULTS.md` (committed) with per-season tables and a pre-committed verdict
for each rule. Two untracked candidate stream directories under `reports/`.

**This is a working-tree experiment.** Model code is patched, replayed, and REVERTED. Nothing
under `packages/`, `data/algorithm-versions/`, or `fixtures/` is committed. No new parameter,
no `SIGMA1_CODE_VERSION` bump, no promote, no publish, no network.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@reports/autopsy-260905/FINDINGS.md
@packages/core/algorithms/sigma1/index.ts
@packages/core/algorithms/sigma1/carryover.ts
</context>

<interface_facts>
Verified live in the tree at planning time — do not re-derive:

- `carrySeason` is `packages/core/algorithms/sigma1/index.ts:1776`. Its per-team component
  loop runs 1832-1850. The four lines that matter:
  - 1846 `const coldStartVariance = seedConsistencyFor(state.league, name, resolved);`
  - 1847 `beliefs[name] = { mean: share, variance: coldStartVariance };`
  - 1848 `const carriedObserved = oldTeamState?.consistency[name] ?? coldStartVariance;`
  - 1849 `consistency[name] = carriedObserved * consistencyDecayOverGap;`
- Already in scope inside that loop: `resolved` (a `Sigma1ResolvedParams`, line 1785), `gap`
  (line 1792), `consistencyDecayOverGap` (line 1811), `oldTeamState` (line 1829), `name`.
- `resolved.minConsistencyVariance` is the RESOLVED floor (the raw param is named
  `minConsistencyVarianceRel`; `seedConsistencyFor` at line 382 already floors against
  `params.minConsistencyVariance`). `resolved.carryMeanReversion` exists, constrained to `[0, 1]`.
- `reversionOverGap(reversion, gap)` is exported from `carryover.ts:92`. It is NOT currently
  imported by `index.ts` — line 103 imports only `sigma1Carryover` from `./carryover.js`.
- `ADJUST_COMPONENT` is `continue`d at 1837-1841 before any of this. It stays pinned at
  `{ mean: 0, variance: 0 }`; neither rule touches it.
- Prediction JSONL record fields (one line per algorithm per match, both algorithms
  interleaved in the same season file): `matchKey`, `season`, `eventKey`, `compLevel`,
  `algorithmId`, `algorithmVersion`, `predictedWinner`, `pRedWin`, `predictedRedScore`,
  `predictedBlueScore`, `redComponents`, `blueComponents`, `actualWinner`, `actualRedScore`,
  `actualBlueScore`. The two `*Components` blobs dominate file size (30-66 MB per season).
- Harness entry point: `package.json` script `harness` = `tsx --env-file=.env packages/harness/cli.ts`.
- Typecheck: `npx tsc --noEmit` at repo root (`tsconfig.json` exists).
</interface_facts>

<tasks>

<task type="tracer">
  <name>Task 1: Build the scoring instrument and validate it against the existing baseline</name>
  <files>.planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs</files>
  <action>
Write the join-and-score script FIRST, before any replay, and prove it reproduces a figure
that was produced independently — so that when the candidate streams land, the instrument is
already trusted and the only new variable is the model patch.

Script location is the quick task directory, committed alongside RESULTS.md, because
`reports/` is gitignored and an uncommitted script would leave the RESULTS unreproducible.
Plain CommonJS `.cjs`, run with bare `node`, no new dependency.

Interface: `node <script> [--candidates none|r1,r2]`. With `--candidates none` (the default) it
scores only the two baseline series; that is the mode this task verifies.

Reading discipline, load-bearing: the five baseline files total roughly 240 MB. Stream each
file line by line with `readline` over `fs.createReadStream`. Parse each line, then retain ONLY
the scalar fields `matchKey`, `eventKey`, `algorithmId`, `pRedWin`, `actualWinner`. Never
retain the parsed object — the component blobs are the bulk of every line and holding them
would exhaust the heap.

Per-season algorithm, for each of 2022 through 2026:
  1. Stream `reports/autopsy-260905/predictions-{season}.jsonl` into a map keyed on `matchKey`
     holding `eventKey`, `actualWinner`, and each row's `pRedWin` filed under its
     `algorithmId`. Separately record each distinct `eventKey` the first time it is seen —
     that first-appearance order IS chronological order, because the stream is written by a
     walk-forward replay.
  2. Stream each requested candidate file into the SAME map under its own series key:
     `reports/carryvar-r1-260905/predictions-{season}.jsonl` as `r1`,
     `reports/carryvar-r2-260905/predictions-{season}.jsonl` as `r2`. Candidate rows carry
     `algorithmId` of `vpr`; key them by the directory they came from, not by that field.
  3. Scored set = matchKeys present in EVERY requested series (baseline epa AND baseline vpr
     AND each candidate) whose `actualWinner` is exactly `red` or `blue`. Ties and any matchKey
     missing from any series are excluded, so every reported series shares one denominator.
     Print the denominator per season and print the count of matchKeys dropped for reasons
     other than a tie. A nonzero drop count means the streams disagree and must be surfaced,
     not silently absorbed.
  4. Early slice: take the distinct `eventKey` list in first-appearance order from step 1, take
     the first `Math.ceil(eventCount * 0.33)` of them as the early event set, and mark a scored
     match as early when its `eventKey` is in that set. Derive this set ONCE from the baseline
     stream and apply it identically to all series.
  5. Metrics per series (baseline-vpr, r1, r2, epa) over the scored set: accuracy, where the
     pick is red when `pRedWin >= 0.5` and blue otherwise and is correct when it equals
     `actualWinner`; and Brier as the mean of `(pRedWin - (actualWinner === "red" ? 1 : 0)) ** 2`.
     Report both over the full scored set, plus accuracy over the early slice.
  6. Per season, compute the binomial standard error of the BASELINE-vpr overall accuracy as
     `Math.sqrt(p * (1 - p) / n)` with `p` = baseline overall accuracy and `n` = that season's
     scored count. For each candidate, print the overall-accuracy delta from baseline expressed
     in units of that SE, so the verdict rule is mechanical rather than eyeballed.

Output: a markdown table per season with overall accuracy, Brier, early-slice accuracy,
early-slice n and scored n for every present series, plus the SE-unit delta column for
candidates; a pooled all-seasons row; and a final line reading `TOTAL_SCORED=` followed by the
sum of the per-season scored counts. Print to stdout. The executor pastes the output into
RESULTS.md — the script must not write RESULTS.md itself.

Validation anchor for this task: FINDINGS.md reports 83,655 scored matches for the epa-vs-vpr
join over these same five files under the same pick and tie rules, and reports 2024 as the
season where VPR beats EPA and 2025 as the season where EPA beats VPR. Reproducing those is
what makes the instrument trustworthy enough to spend twelve minutes of replay on.
  </action>
  <verify>
    <automated>node .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/score-carryvar.cjs --candidates none</automated>
  </verify>
  <done>
The command exits 0 and prints five per-season rows plus a `TOTAL_SCORED=` line whose value is
within 1% of 83,655; the dropped-for-reasons-other-than-a-tie count is 0 for every season; and
the printed numbers agree in DIRECTION with FINDINGS.md — for 2024 vpr overall accuracy above
epa, for 2025 epa above vpr. If the total misses that band, halt and reconcile the join and tie
rules before running any replay. Do not proceed on an instrument that disagrees with the
artifact it is meant to extend.
  </done>
</task>

<task type="auto">
  <name>Task 2: Patch, replay, and revert each candidate rule — strictly sequentially</name>
  <files>packages/core/algorithms/sigma1/index.ts</files>
  <precondition>`git status --porcelain packages` is empty, `data/corpus.sqlite` exists, and all five `reports/autopsy-260905/predictions-{2022..2026}.jsonl` baseline streams exist. Halt if any is false — a dirty tree makes the revert step unable to distinguish this experiment's patch from pre-existing work.</precondition>
  <action>
One working tree, one file, two rules. Run them strictly in sequence: patch R1, typecheck,
replay, revert, confirm clean; only then start R2. Never hold both patches at once.

**R1, the carried-consistency seed.** In the component loop of `carrySeason`
(`packages/core/algorithms/sigma1/index.ts`, the block spanning lines 1842-1849), hoist the
carried lookup above the belief assignment: read `oldTeamState?.consistency[name]` into a local
that stays undefined when the team has no carried state. When it is undefined, assign
`beliefs[name]` exactly as today with `variance` equal to `coldStartVariance` — a team with no
carried evidence must keep today's behavior bit for bit. When it is present, assign
`beliefs[name]`'s `variance` as
`Math.max(resolved.minConsistencyVariance, thatValue * consistencyDecayOverGap)`. The `mean`
stays `share` in both branches. Line 1849's `consistency[name]` formula and its
`carriedObserved` fallback are UNCHANGED: this rule moves the belief variance only, never the
consistency accumulator. R1 needs no import change.

**R2, the reversion-scaled seed.** Add `reversionOverGap` to the existing
`import { sigma1Carryover } from "./carryover.js";` on line 103. In the same loop, when
`oldTeamState` is present, assign `beliefs[name]`'s `variance` as
`Math.max(resolved.minConsistencyVariance, coldStartVariance * reversionOverGap(resolved.carryMeanReversion, gap))`;
when `oldTeamState` is absent, leave `coldStartVariance` unchanged. Lines 1848-1849 are
untouched by R2.

Per-rule sequence, identical for both:
  1. Apply the patch with Edit.
  2. Run `npx tsc --noEmit` — it must be clean before spending six minutes of replay on it.
  3. Run `pnpm harness --seasons 2022-2026 --algorithm vpr --out reports/carryvar-r1-260905`
     (and `reports/carryvar-r2-260905` for R2). Same season range, same algorithm id, same
     command shape as the baseline: the patch is the only difference. Invoke it with the Bash
     tool's own `timeout` parameter set to 600000. Do NOT wrap the command in the `timeout`
     binary — on this machine `timeout <n> pnpm <cmd>` swallows all output and exits 0, which
     would turn a failed replay into a false green. If the roughly six-minute run overruns the
     tool cap, re-run with `run_in_background` and poll for the five season files rather than
     shortening the season range.
  4. Run `git checkout -- packages/core/algorithms/sigma1/index.ts` and confirm
     `git status --porcelain packages` is empty again.

Do NOT run the full vitest suite while patched. The patch intentionally changes prediction
streams, so digest tests WILL fail — that is the expected, correct behavior of a working digest
gate, not a problem to fix or a signal to weaken. Typecheck only while patched.

If any step fails mid-patch, revert the file FIRST, then report. Never leave the tree patched.

The harness replays against the local `data/corpus.sqlite` and needs no network. If a command
is denied network access, halt and report rather than working around it.
  </action>
  <verify>
    <automated>test -z "$(git status --porcelain packages data fixtures)" && echo TREE_CLEAN && ls reports/carryvar-r1-260905/predictions-*.jsonl reports/carryvar-r2-260905/predictions-*.jsonl | wc -l && node -e "for (const d of ['carryvar-r1-260905','carryvar-r2-260905']) { const s = require('fs').readFileSync('reports/'+d+'/artifact.json','utf8'); console.log(d, s.includes('8.0.0+rolling-2026-09b') ? 'VERSION_MATCHES_BASELINE' : 'VERSION_DRIFTED'); }"</automated>
  </verify>
  <done>
`TREE_CLEAN` prints, the file count is 10 (five season streams per candidate directory, all
nonzero size), and both candidate artifacts print `VERSION_MATCHES_BASELINE` — proving the
replays ran the same promoted parameter set as the baseline and that no version bump or
parameter change leaked in alongside the patch. Both patches have been reverted; `git diff`
against HEAD is empty for every path under `packages/`.
  </done>
</task>

<task type="auto">
  <name>Task 3: Score all four series, record the verdict, prove the tree is back to live behavior</name>
  <files>.planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/260905-jyf-RESULTS.md</files>
  <action>
Run the instrument across all four series: the same script from Task 1, now with
`--candidates r1,r2`. Capture the full stdout.

Apply the PRE-COMMITTED verdict criteria mechanically, per rule, with no post-hoc adjustment:
  - A rule WINS if it improves early-slice accuracy over baseline-vpr on BOTH 2023 and 2025,
    AND on no season loses overall accuracy by more than 2 binomial SE (that is, for every
    season the candidate's SE-unit delta column is at or above -2.0).
  - Otherwise the rule does NOT win. Record that outcome with the same weight and the same
    detail. A negative result is a completed experiment, and this one closes off a named
    hypothesis from FINDINGS.md either way.
  - If both rules win, report both and note which has the larger early-slice gain. Do NOT
    promote, tune, or productionize either — the follow-up is a separate decision for the user,
    not this task's job.

Write `260905-jyf-RESULTS.md` in the quick task directory containing: the motivation in two or
three sentences with a pointer to `reports/autopsy-260905/FINDINGS.md`; the exact diff of each
patch as a fenced block, so the experiment is reproducible from the committed record alone
after the working-tree patches are gone; the exact commands run for each replay; the full
per-season comparison tables from the script; the early-slice definition stated explicitly
(first-appearance chronological event order, first `ceil(33%)` of a season's events); the
verdict per rule against the criteria above with the deciding numbers quoted; and a
reproducibility note recording that `reports/` is gitignored, so the four stream sets are NOT
recoverable from git and must be regenerated by re-running the recorded commands.

If the Write tool is blocked on the RESULTS path, return the complete document text in the task
output and let the caller write it. Do not route around a blocked write with a Bash heredoc.

Then prove the tree is back to bitwise-live behavior: run
`npx vitest run packages/harness/digest.test.ts`. Use `npx vitest run` directly, not a `pnpm`
wrapper under the `timeout` binary, and read the actual test output rather than trusting the
exit code alone.

Commit scope: the quick task directory only — the PLAN, the RESULTS, and the scoring script.
Stage by explicit path (`git add .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa`),
never `git add -A` or `git add .`, because another session may share this checkout. Nothing
under `packages/`, `data/algorithm-versions/`, `fixtures/`, or `reports/` is staged.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/digest.test.ts && test -f .planning/quick/260905-jyf-stage-1-carry-variance-experiment-two-pa/260905-jyf-RESULTS.md && git status --porcelain packages data fixtures reports | wc -l</automated>
  </verify>
  <done>
`digest.test.ts` passes on the reverted tree, proving the working tree reproduces the committed
prediction digests bitwise and that neither patch survived. RESULTS.md exists and states an
explicit WIN or NO-WIN verdict for BOTH R1 and R2, each justified by the quoted deciding
numbers. The final `git status` line count over `packages data fixtures reports` is 0. The
commit touches only paths under the quick task directory.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `.env` -> harness process | The harness script runs `tsx --env-file=.env`; live TBA and R2 credentials are loaded into a process whose output is streamed into an agent transcript |
| working tree -> git history | Temporary model patches live in tracked files and could be committed by an over-broad staging command |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-jyf-01 | Information Disclosure | `.env` read by `pnpm harness` | high | mitigate | Never `Read`, `cat`, or echo `.env`; let `tsx --env-file` consume it by path, exactly as CLAUDE.md's secrets-handling convention requires. Harness stdout is a replay progress log and carries no credential |
| T-jyf-02 | Tampering | `packages/core/algorithms/sigma1/index.ts` | high | mitigate | Patches are reverted with `git checkout --` after each replay; Task 2 and Task 3 both gate on `git status --porcelain packages data fixtures` being empty, and Task 3 additionally proves bitwise-live behavior via `digest.test.ts` |
| T-jyf-03 | Tampering | git staging area (shared checkout) | medium | mitigate | Stage by explicit path under the quick task directory only; never `git add -A` or `git add .`, since a concurrent session may hold unrelated edits in this same checkout |
| T-jyf-04 | Elevation of Privilege | promoted parameter sets / published artifacts | medium | accept | No promote, publish, or R2 write is in scope; the replays are read-only against the local corpus and write only to gitignored `reports/` directories |

No package-manager install occurs in this task, so no package legitimacy gate applies.
</threat_model>

<verification>
- Task 1's instrument reproduces FINDINGS.md's independently-produced scored-match count to
  within 1% and matches its per-season direction before any replay is run.
- Both candidate replays use the identical harness command shape, season range, and algorithm
  id as the baseline, and their artifacts report the identical algorithm version.
- All four series are scored on one matchKey intersection and one early-slice event set.
- Both patches are reverted; `digest.test.ts` passes on the final tree.
- The commit contains only the quick task directory.
</verification>

<success_criteria>
- `260905-jyf-RESULTS.md` records an explicit WIN or NO-WIN verdict for R1 and for R2, each
  decided by the pre-committed criteria and justified with quoted numbers.
- `git status` is clean for `packages`, `data`, `fixtures`, and `reports`.
- No new `Sigma1Params` field, no `SIGMA1_CODE_VERSION` bump, no promotion, no publish.
</success_criteria>

<output>
Commit the quick task directory (PLAN, RESULTS, scoring script) with a `docs(quick-260905-jyf)`
message summarizing the verdict for both rules.
</output>
