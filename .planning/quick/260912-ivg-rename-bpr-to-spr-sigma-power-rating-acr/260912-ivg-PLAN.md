---
phase: quick-260912-ivg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/harness/publishedAlgorithms.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - packages/harness/manifests.ts
  - packages/harness/manifests.test.ts
  - packages/harness/sigmaScore.ts
  - packages/harness/stateSnapshot.ts
  - packages/harness/stateSnapshot.test.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/cli.ts
  - packages/harness/algorithmIdentity.test.ts
  - packages/core/algorithms/bpr.ts
  - packages/core/algorithms/bpr.test.ts
  - packages/core/algorithms/types.ts
  - packages/core/algorithms/sigma1/index.ts
  - packages/core/algorithms/epaWeekOne.ts
  - packages/core/rankingPoints/marginals.ts
  - packages/bpr/
  - packages/pcm/
  - packages/gbr/
  - apps/worker/src/scheduled.ts
  - apps/worker/src/stateProbe.ts
  - apps/worker/src/stateStore.ts
  - apps/worker/wrangler.toml
  - apps/worker/test/
  - apps/web/src/
  - scripts/
  - docs/worker-operations.md
  - docs/simulation-architecture.md
  - docs/models/
autonomous: true
requirements: [IVG-01, IVG-02, IVG-03, IVG-04, IVG-05]

worktree: false   # LOAD-BEARING — see <objective>. data/ and corpus content are
                  # gitignored and do not exist inside a worktree; the node test
                  # project loads real seasons from them and would fail there.

estimate:
  tokens: 210000
  raw_tokens: 140000
  tasks: 5
  confidence: low

must_haves:
  truths:
    - "The publisher/Worker WRITE tier resolves the premier algorithm id to `spr`, and the browser-READ tier still resolves it to `bpr` — both facts asserted by one running test, not by inspection."
    - "No tracked file outside `.planning/` is named `bpr.ts`, lives under `packages/bpr/`, or carries a `Bpr`/`bpr` identifier, except the enumerated, individually-reasoned transitional exclusions."
    - "`git mv` moved content without changing it: every sealed path's blob sha is byte-identical across the move commit."
    - "`algorithmIdentity.test.ts` sweeps `bpr` as a retired id, is green, and has been proven capable of going red."
    - "All three typechecks (root, apps/web, apps/worker) are clean and the full root-run vitest suite is green over both projects."
    - "Nothing measured moved: `frozen-params.json` values, `data/baselines/` content, and everything under `.planning/` are byte-identical to the pre-task base."
  artifacts:
    - packages/spr/ (the 19 files moved from packages/bpr/, content unchanged)
    - packages/core/algorithms/spr.ts and packages/core/algorithms/spr.test.ts
    - packages/harness/publishedAlgorithms.ts carrying TWO exported id tiers
    - apps/web/src/routes/__fixtures__/rp-calibration-2026-spr.json
    - A durable "BPR and SPR are the same algorithm under two names" note in docs/
  key_links:
    - "PIPELINE_ALGORITHM_IDS -> resolvePublishAlgorithms -> artifactKey -> the `spr@` R2 key the Stage 2 republish will write"
    - "PUBLISHED_ALGORITHM_IDS -> searchParams DEFAULT_ALGORITHM -> apps/web artifact fetch -> the `bpr@` R2 key that exists TODAY (unchanged by this plan)"
    - "SEALED_CODE_PATHS strings -> `git rev-parse HEAD:<path>` -> holdout/pcm refusal — a stale path string here does not falsify a record, it disables the seal mechanism outright"
    - "sigmaScore's dual-id set -> the Sigma Score column on BOTH the deployed (bpr) and the about-to-publish (spr) tiers"
---

<objective>
STAGE 1 of the BPR -> SPR cutover: rename the algorithm in the SOURCE TREE only,
with a deliberate two-tier id split that keeps the deployed site working.

Purpose: `SPR` is already the display name everywhere a user can see it. What
still says `bpr` is the IDENTIFIER layer — a package directory, ~200 files of
symbols, and the wire id embedded in R2 object keys, the URL search param, the
KV manifest, and D1's `algorithm_id` column. This plan moves the identifier
layer and the WRITE half of the wire id. It deliberately does NOT move the READ
half.

Output: a tree where the publisher and the Worker WRITE under `spr`, the
deployed browser still READS `bpr`, and a standing test proves both statements
at once.

## Why the split is load-bearing, not ceremony

Cloudflare Pages deploys on push. A single-step flip of `PUBLISHED_ALGORITHM_IDS`
to `spr` would deploy a browser that requests `v1/teams/2026/spr@3.0.0+baseline.json`
before any such object exists — a site-wide 404 on every page. The transition
therefore uses the same two-tier shape the `sigma1` -> `vpr` rename used, which
`packages/harness/publishedAlgorithms.ts` documents in its own header: from plan
07-16 through 07-17 that file carried TWO constants for exactly this reason, and
07-18 collapsed them once the renamed objects were live. Commit `4f26740b` is the
shape to mirror; `c1322eff` is the collapse.

## What runs after this plan (NOT executor work — the orchestrator runs these)

Every task below is offline-executable. Executor subagents' sandbox denies all
network Bash, so none of these are planned as tasks:

- **Stage 2 — WRITE PASS.** `pnpm publish:seasons`, artifacts before manifest.
  Also discharges the presim republish recorded as OWED in STATE.md row 131.
- **Stage 3 — D1 RESEED.** Insert `algorithm_id = 'spr'` rows.
- **Stage 4 — WORKER DEPLOY.** `LIVE_ALGORITHM_IDS=spr`.
- **Stage 5 — CLIENT FLIP.** Collapse the two tiers back into one; push; Pages deploys.
- **Stage 6 — CLEANUP.** Delete `bpr@` R2 objects and `algorithm_id='bpr'` D1 rows,
  with a before/after census as the evidence.

## Execution environment — do NOT use a worktree

`data/*` is gitignored (except three allowlisted subdirectories) and the corpus
database is not tracked. A git worktree therefore has no corpus, and the `node`
vitest project's tests — several of which replay a real season — fail there for
reasons that have nothing to do with this rename. Run every task in the main
checkout at `C:/Users/Jacob/Documents/GitHub/SigmaScout`.

## A note on `apps/worker/src/stateProbe.ts`

The CONTEXT recorded 102 UNCOMMITTED lines in this file from concurrent quick
task `260912-iur` (an `?rp=` ablation arm), and a decision to carry them in.
Re-checked at planning time: those edits are now COMMITTED at `e57bd2fd`
("feat(quick-260912-iur): the probe's rp ablation arm, aimed by git not by
assumption"), which is an ancestor of HEAD. The working tree is clean apart from
`.planning/`. There is nothing to carry; rename the file's contents like any
other. Do not treat the `?rp=` arm as stray work and do not revert it.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.planning/quick/260912-ivg-rename-bpr-to-spr-sigma-power-rating-acr/260912-ivg-CONTEXT.md

@packages/harness/publishedAlgorithms.ts
@packages/harness/algorithmIdentity.test.ts
@packages/bpr/sealedPaths.ts
</context>

<tier_rules>
## The classification every edit in this plan is decided by

Read this before touching a file. Every occurrence of `bpr` falls into exactly
one of six tiers, and the tier — not the file — decides what happens to it.

| Tier | What it is | Stage 1 value | Named instances |
|------|-----------|---------------|-----------------|
| **WRITE** | the publisher/Worker emit path: the id that ends up in an R2 key, a KV manifest entry, a D1 `algorithm_id`, or a wrangler var | becomes `spr` | `PIPELINE_ALGORITHM_IDS` (new), `packages/core/algorithms/bpr.ts`'s `id:` field, `resolvePublishAlgorithms`'s default set, `manifests.ts`'s `buildAlgorithmsManifest`, `scheduled.ts`'s `DEFAULT_LIVE_ALGORITHM_IDS` + module-registry key + `parseLiveAlgorithmIds` validation set, `apps/worker/wrangler.toml`'s `LIVE_ALGORITHM_IDS`, `stateProbe.ts`, `scripts/replayRig.ts`, `scripts/measureFieldAveragedRanks.ts`'s `DEFAULT_ALGORITHM_ID`, `scripts/measureAllianceReconstruction.ts`'s `subject`, `scripts/measureRpCalibration.ts`'s cell predicate |
| **READ** | what a browser deployed from this commit will request | **stays `bpr`** | `PUBLISHED_ALGORITHM_IDS`, `apps/web/src/lib/searchParams.ts`'s `DEFAULT_ALGORITHM`, `apps/web/src/lib/metricKeys.ts`, `apps/web/src/components/compare/MethodologyNote.tsx`'s `PREMIER_ALGORITHM_ID`, `apps/web/src/components/teams-table/columns.tsx`, every `compare-20NN.json` fixture's JSON content |
| **BOTH** | a shared predicate reached from both tiers, which must answer the same way for either name during the split | accepts `bpr` AND `spr` | `packages/harness/sigmaScore.ts`'s `SIGMA_SCORE_ALGORITHM_IDS`, `packages/harness/stateSnapshot.ts`'s serialize/deserialize dispatch |
| **SYMBOL** | an identifier, type, or filename with no wire meaning | renamed unconditionally | `packages/bpr/` -> `packages/spr/`, `bpr.ts` -> `spr.ts`, `BprModel`, `BprParams`, `BprState`, `BprMatch`, `BPR_PARAMS`, `BPR_VERSION`, `bprRows`, `runBprFold`, `serializeBprState`, `deserializeBprState`, the `rp-calibration-2026-bpr.json` fixture filename |
| **FROZEN** | a record of what was measured, under the name in force when it was measured | untouched | `packages/spr/frozen-params.json`'s `_note`/`_model`/`_selected`/`_softCredit_note` VALUES, all of `data/baselines/`, all of `.planning/`, every measured-figure citation (`v1/presim/2026mrcmp/bpr@3.0.0+baseline.json` cost 388,484 B; the sealed 78.05%) |
| **LIVE-POINTER** | a path STRING that a running program resolves against the current tree | repointed, with proof | `packages/spr/sealedPaths.ts`'s `SEALED_CODE_PATHS`, `packages/pcm/holdout.ts`'s sealed list, `packages/pcm/seal.test.ts`'s pin, `scripts/measureAwardPredictability.ts`'s `BPR_PARAMS_PATH`, `packages/spr/holdout.test.ts`'s `toContain` assertion |

### The LIVE-POINTER call-out — read this, it contradicts a literal reading of the task scope

The task scope lists "`sealedPaths.ts` sealed paths" as out of scope, alongside
`frozen-params.json` values. Those two are NOT the same kind of thing and this
plan treats them differently, deliberately:

- `frozen-params.json`'s `_note`/`_model`/`_design_accuracy_2016_2022` are a
  RECORD. Rewriting them would falsify the audit trail. They stay. That is the
  scope's intent and this plan honours it.
- `SEALED_CODE_PATHS` is a LIVE POINTER. `assertSealed` runs
  `git rev-parse HEAD:<path>` against each entry at run time. If the files move
  and the strings do not, every holdout and every pcm run refuses to start with a
  path error — the seal mechanism is disabled, not preserved.

Repointing them preserves the record rather than falsifying it, and this is
provable rather than argued: `git mv` does not alter content, so
`git rev-parse <pre-move-commit>:packages/bpr/model.ts` and
`git rev-parse HEAD:packages/spr/model.ts` return the SAME blob sha. Task 2's
verification is exactly that equality, run over all five sealed paths. If any sha
differs, content moved when it should not have, and the task has failed.

### Uppercase `BPR` in prose is a separate question from the wire id

The sweep in `algorithmIdentity.test.ts` matches case-sensitively on the
lowercase wire id. Prose reading "BPR (Bayesian Power Rating)" never trips it.
Prose is handled by Task 3 on its own merits: current-behaviour prose is
renamed, historical measurement prose is kept and marked.
</tier_rules>

<tasks>

<task type="tracer">
  <name>Task 1: The two-tier split, end to end — one id path, no file moves</name>
  <precondition>`git status --porcelain` shows nothing modified outside `.planning/`. The `260912-iur` probe edits are already committed at `e57bd2fd`; if the tree is dirty in `apps/worker/`, stop and report rather than committing someone else's work.</precondition>
  <files>packages/harness/publishedAlgorithms.ts, packages/harness/publish.ts, packages/harness/publish.test.ts, packages/harness/manifests.ts, packages/harness/manifests.test.ts, packages/harness/sigmaScore.ts, packages/harness/stateSnapshot.ts, packages/harness/cli.ts, packages/core/algorithms/bpr.ts, apps/worker/src/scheduled.ts, apps/worker/src/stateProbe.ts, apps/worker/wrangler.toml, apps/worker/test/liveAlgorithmTier.test.ts, scripts/replayRig.ts</files>
  <read_first>packages/harness/publishedAlgorithms.ts (its header documents the prior split), and `git show 4f26740b:packages/harness/publishedAlgorithms.ts` (the two-constant shape to mirror, including the lifecycle paragraph naming which plan collapses it)</read_first>
  <behavior>
    - `PIPELINE_ALGORITHM_IDS` resolves to the three write-tier ids with the premier id reading `spr`.
    - `PUBLISHED_ALGORITHM_IDS` still resolves to the three read-tier ids with the premier id reading `bpr` — asserted in the SAME test, so the split cannot be half-collapsed silently.
    - `artifactKey` built from the premier module's own `id` produces a key whose algorithm segment is `spr`, for the `teams` page and for at least one scoped page.
    - `parseLiveAlgorithmIds` accepts the new write-tier premier id and REJECTS the retiring one with `UnknownLiveAlgorithmIdError` — the negative half is what proves validation moved to the write tier rather than widening to accept both.
    - `usesSigmaScore` answers true for BOTH names, so the Sigma Score column survives on the deployed read tier and on the about-to-publish write tier.
    - `serializeState`/`deserializeState` dispatch to the premier branch for BOTH names, so a Worker deployed at Stage 4 can still read D1 rows written under the old name before the Stage 3 reseed.
  </behavior>
  <action>
Add a second exported constant beside `PUBLISHED_ALGORITHM_IDS` in
`packages/harness/publishedAlgorithms.ts` — name it `PIPELINE_ALGORITHM_IDS`,
with a `PipelineAlgorithmId` type, mirroring commit `4f26740b` exactly. Leave
`PUBLISHED_ALGORITHM_IDS`'s VALUE untouched. Keep the file import-free so it
stays safe on the browser's import graph. Write the lifecycle paragraph in the
same voice as the existing header: state that the two constants genuinely name
different facts right now, that only the third member differs, name this quick
task as the plan that introduced the split, and name Stage 5 as the step that
deletes `PIPELINE_ALGORITHM_IDS` and moves `PUBLISHED_ALGORITHM_IDS`'s value.
Update the existing header paragraph so a reader is not told the split is over.

Repoint the three write-tier consumers at the new constant:
`resolvePublishAlgorithms`'s default set in `publish.ts`, `parseLiveAlgorithmIds`'s
validation set in `scheduled.ts`, and `replayRig.ts`'s default algorithm list.
Confirm by grep that nothing under `apps/web/` reaches the new constant.

In `packages/core/algorithms/bpr.ts` — do NOT move the file in this task — change
the registry `id:` field to the new wire id and rename the exported module symbol
and every `Bpr`-prefixed exported type. Update all importers' specifiers
(`packages/harness/{cli,manifests,publish}.ts` and their tests,
`apps/worker/src/{scheduled,stateProbe,stateStore}.ts`, `apps/worker/test/*`,
`packages/bpr/{equivalence,scoringTarget.test,softCredit.test}.ts`,
`apps/web/src/components/methodology/sprContent{,.test}.ts`). The import PATH
still ends in `bpr.js` after this task; Task 2 moves it.

In `apps/worker/src/scheduled.ts`: set `DEFAULT_LIVE_ALGORITHM_IDS` to the new
write-tier id, key the module registry on it, and rewrite the 2026-09-09 comment
block above `DEFAULT_LIVE_ALGORITHM_IDS` so it describes the current split rather
than the previous rename. Set `LIVE_ALGORITHM_IDS` in `apps/worker/wrangler.toml`
to the new id — note in a comment that the Worker is not deployed until Stage 4,
so this value is inert until then.

In `apps/worker/src/stateProbe.ts`: rename the probe's `algorithmId` literals,
its D1 `WHERE algorithm_id = ...` predicate, and its `Bpr`-prefixed locals and
types (`bprRows`, the `BprState` import, the `algorithmId:` literal fields). Add
one line to the probe's header noting that until the Stage 3 reseed the live D1
holds no rows under the new id, so a probe run before Stage 3 legitimately
reports zero rows rather than an error.

Make the two BOTH-tier predicates accept either name: `SIGMA_SCORE_ALGORITHM_IDS`
in `packages/harness/sigmaScore.ts` becomes a two-member set, and
`stateSnapshot.ts`'s serialize and deserialize dispatch each accept either id.
Write one sentence at each site saying this is transitional and that Stage 5
removes the retiring member — these two sites are why the deployed site keeps its
Sigma Score column while the publisher writes under the new name.

Reword, do not delete, the comment prose that cites the old id as a statement of
CURRENT fact: `publish.ts`'s registry doc comment, `stateSnapshot.ts`'s "how bpr
first failed" note, `packages/core/algorithms/sigma1/index.ts`'s published-set
aside, and `packages/core/algorithms/types.ts`'s metric-key aside. Leave the two
measured-figure citations (`pageArtifacts.ts`'s and `publish.ts`'s presim byte
counts) exactly as measured — Task 4 marks them.

Extend `packages/harness/publish.test.ts` (already a structurally exempt file, so
it may cite either id freely) with the split assertions listed in `<behavior>`,
and extend `apps/worker/test/liveAlgorithmTier.test.ts` with the accept/reject
pair. Update `manifests.test.ts` and `stateSnapshot.test.ts` where they pin the
premier id.

Commit before Task 2 begins — Task 2 moves files this task edited, and an Edit
followed by a `git mv` can silently drop the edited content.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && npx tsc --noEmit && npx tsc --noEmit -p apps/worker/tsconfig.json && npx vitest run packages/harness/publish.test.ts packages/harness/manifests.test.ts packages/harness/stateSnapshot.test.ts apps/worker/test/liveAlgorithmTier.test.ts</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git grep -n "PIPELINE_ALGORITHM_IDS" -- apps/web | wc -l | grep -qx "0" && echo "OK: the write tier does not reach the client"</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git status --porcelain | grep -v "^?? .planning/" | grep -v "^ M .planning/" | wc -l | grep -qx "0" && echo "OK: task 1 fully committed"</automated>
  </verify>
  <done>Both id tiers exist and disagree on exactly one member; one test asserts both at once; all four named test files are green; root and worker typechecks are clean; the work is committed and the tree is clean outside `.planning/`.</done>
  <reversibility rating="reversible">Two constants where there was one, plus renamed literals. Nothing is published or deployed by this task; a revert restores the prior tree exactly.</reversibility>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Move the tree and rename the symbols — content-preserving, proven by blob sha</name>
  <precondition>Task 1 is committed and `git status --porcelain` is clean outside `.planning/`. Record Task 1's commit sha; Task 2's verification compares blob shas against it.</precondition>
  <files>packages/bpr/ (all 19 files) -> packages/spr/, packages/core/algorithms/bpr.ts -> spr.ts, packages/core/algorithms/bpr.test.ts -> spr.test.ts, apps/web/src/routes/__fixtures__/rp-calibration-2026-bpr.json -> ...-spr.json, packages/pcm/, packages/gbr/, packages/core/rankingPoints/marginals.ts, packages/core/algorithms/epaWeekOne.ts, scripts/, apps/web/src/, apps/worker/src/, apps/worker/test/</files>
  <read_first>packages/bpr/sealedPaths.ts, packages/pcm/holdout.ts (its sealed list), packages/pcm/seal.test.ts (its pin), packages/bpr/holdout.test.ts (its `toContain` assertion)</read_first>
  <action>
Before moving anything, capture the blob sha of each of the five sealed paths at
Task 1's commit, plus `packages/bpr/frozen-params.json`. Keep them; the verify
step compares against them.

Move with `git mv`, never a delete-plus-create: the whole `packages/bpr/`
directory to `packages/spr/`; `packages/core/algorithms/bpr.ts` and its
`.test.ts` sibling to `spr.ts`/`spr.test.ts`; and
`apps/web/src/routes/__fixtures__/rp-calibration-2026-bpr.json` to the
correspondingly renamed filename. `packages/bpr/` carries no `package.json`, so
it is not a pnpm workspace member — `pnpm-lock.yaml` needs no edit, and its one
case-insensitive match is a base64 substring inside a sha512 integrity hash, not
an identifier. `vitest.config.ts` and `tsconfig.json` select by glob
(`packages/**`), so neither needs an edit either. Confirm both claims by grep
rather than assuming them.

Update every import specifier that named a moved path, and every prose path
citation in a comment or a markdown file that names one (`packages/pcm/*` has
several, `packages/gbr/{cli,holdout}.ts` have two, `packages/core/rankingPoints/marginals.ts`
and `packages/core/algorithms/epaWeekOne.ts` have one each,
`scripts/measureAwardPredictability.ts` has three plus its `BPR_PARAMS_PATH`
constant, `packages/pcm/DESIGN-RESULT.md` has two).

Repoint every LIVE-POINTER path string: `SEALED_CODE_PATHS` in the moved
`sealedPaths.ts`, the sealed list in `packages/pcm/holdout.ts`, the pin in
`packages/pcm/seal.test.ts`, the `toContain` assertion in the moved
`holdout.test.ts`, and `BPR_PARAMS_PATH` in
`scripts/measureAwardPredictability.ts`. Add one sentence to `sealedPaths.ts`'s
header recording that this list was repointed by a pure rename, that the blob
shas are unchanged across the move, and that the measured numbers the seal
attests to are therefore still attributable to the same content.

Rename the remaining SYMBOL-tier identifiers across the whole tree — the
`Bpr`-prefixed types and classes, the `BPR_`-prefixed constants, `bprRows`,
`runBprFold`, `serializeBprState`, `deserializeBprState`, and every local named
after the algorithm — in `packages/spr/`, `packages/pcm/`, `packages/harness/`,
`apps/worker/`, `apps/web/`, and `scripts/`. Do NOT touch any value classified
READ or FROZEN in the tier table: the `compare-20NN.json` fixtures' JSON
content, `searchParams.ts`'s default, `metricKeys.ts`, `MethodologyNote.tsx`'s
premier constant, `columns.tsx`'s premier comparison, all of `data/baselines/`,
and the four underscore-prefixed keys in `frozen-params.json` all stay exactly
as they are.

After committing, run `git status` and confirm nothing edited was left unstaged
— an Edit followed by a `git mv` in the same task is the documented way this
repo has silently lost edited content before.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && for p in model evaluate data cli; do a=$(git rev-parse "$TASK1_SHA:packages/bpr/$p.ts"); b=$(git rev-parse "HEAD:packages/spr/$p.ts"); [ "$a" = "$b" ] || { echo "CONTENT MOVED: $p.ts"; exit 1; }; done; a=$(git rev-parse "$TASK1_SHA:packages/core/algorithms/bpr.ts"); b=$(git rev-parse "HEAD:packages/core/algorithms/spr.ts"); [ "$a" = "$b" ] || { echo "CONTENT MOVED: ported module"; exit 1; }; a=$(git rev-parse "$TASK1_SHA:packages/bpr/frozen-params.json"); b=$(git rev-parse "HEAD:packages/spr/frozen-params.json"); [ "$a" = "$b" ] || { echo "FROZEN PARAMS MUTATED"; exit 1; }; echo "OK: all six blobs identical across the move"</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git diff --stat "$TASK1_SHA"..HEAD -- data/baselines .planning | wc -l | grep -qx "0" && echo "OK: no frozen record touched"</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && npx tsc --noEmit && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/worker/tsconfig.json</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && npx vitest run 2>&1 | tee /tmp/ivg-t2.log; grep -E "Test Files +[0-9]+ passed" /tmp/ivg-t2.log</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git status --porcelain | grep -v "\.planning/" | wc -l | grep -qx "0" && echo "OK: nothing left unstaged after a rename commit"</automated>
  </verify>
  <done>`git ls-files` lists no tracked path outside `.planning/` whose filename carries the retiring token; all six sealed/frozen blobs are byte-identical across the move; all three typechecks are clean; the full root-run suite is green with both projects present; the tree is clean outside `.planning/`.</done>
  <reversibility rating="costly">A tree-wide `git mv` plus ~200 files of identifier edits. Revertable by a single `git revert` of this task's commit while it is the tip, but painful to unwind once Stage 2 has published under the new id.</reversibility>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Docs prose, and one durable "same algorithm, two names" note</name>
  <files>docs/worker-operations.md, docs/simulation-architecture.md, docs/models/*.md, packages/pcm/DESIGN-RESULT.md</files>
  <read_first>docs/worker-operations.md lines 130-145 and 600-640, docs/simulation-architecture.md lines 170-205</read_first>
  <action>
Split every docs occurrence into CURRENT-BEHAVIOUR prose and MEASUREMENT RECORD,
and treat each accordingly.

Current-behaviour prose is renamed. In `docs/worker-operations.md` that is the
seed-file runbook around line 136 and the sentence at line 140 that currently
asserts the registry id, the seed filename and every command are still the old
id — that sentence is now false and must be rewritten to describe the two-tier
split instead: which tier each command belongs to, and that the live D1 carries
no rows under the new id until the Stage 3 reseed. Rename the seed filename the
runbook names, and check whether the generator that emits it needs the same
rename (it is generated, not tracked — confirm by grep before claiming either
way).

Measurement records keep the name they were measured under. In
`docs/worker-operations.md` that is the deployed-version verification around
lines 610 and 631; in `docs/simulation-architecture.md` it is the three presim
byte-count rows around lines 179, 181 and 199. Leave the figures and the object
keys exactly as written. Task 4 attaches the exemption marker; do not attach it
here, so that Task 4's sweep run is a genuine discovery of what needs marking
rather than a confirmation of what this task already assumed.

`docs/models/` and `docs/publish-budget.md` are already path-excluded from the
identity sweep as measurement records, so nothing there is forced by a gate.
Rename only the prose in `docs/models/` that describes how the system works
today; leave every reported Brier score, accuracy figure, and tuning result
attributed to the name it was measured under.

Add the durable note. Put it in `docs/models/` as a short standalone section or
file that states plainly: BPR and SPR are the same algorithm under two names;
SPR became the display name on 2026-09-10 and the identifier on this task's
date; every measurement recorded under the earlier name — including the sealed
2016-2022 design and the 2023-2026 holdout — applies unchanged to the later
name; and nothing under `.planning/` or `data/baselines/` was rewritten, which
is why the history still reads under the earlier name. Name the file and the
anchor in the SUMMARY so later work can link to it.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && grep -rli "same algorithm under two names" docs/ | wc -l | grep -qvx "0" && echo "OK: durable note exists"</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && grep -v '^#' docs/worker-operations.md | grep -c "seed filename and every command here are still" | grep -qx "0" && echo "OK: the stale still-unrenamed claim is gone"</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && grep -c "388,484" docs/simulation-architecture.md | grep -qvx "0" && echo "OK: the measured byte counts are still present and unedited"</automated>
  </verify>
  <done>No doc asserts as current fact that the identifier layer is unrenamed; the three presim byte-count rows and the deployed-version verification figures are unchanged; a findable note states that the two names are one algorithm and that the measurement history is unrewritten.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Extend the existing retired-id sweep to cover the old wire id</name>
  <files>packages/harness/algorithmIdentity.test.ts, packages/harness/sigmaScore.ts, packages/harness/stateSnapshot.ts, packages/harness/pageArtifacts.ts, packages/harness/publish.ts, docs/simulation-architecture.md, docs/worker-operations.md, scripts/verifySubsetPublish.ts</files>
  <read_first>packages/harness/algorithmIdentity.test.ts in full — its header records the three-way SOURCE/CLIENT/LIVE split and the reasoning style every new entry must match</read_first>
  <behavior>
    - `RETIRED_IDS` contains the old wire id, pinned by an exported-value assertion so a later edit that silently drops it fails a test rather than quietly stopping the sweep.
    - The sweep finds zero identity-shaped occurrences outside the exclusion lists.
    - The marker-exempted match count is at or under a cap that equals the real counted number, not a round number chosen with headroom.
    - Both exclusion lists' pinned lengths equal their real lengths, updated in the same diff that adds each entry.
    - The sweep has been demonstrated capable of going RED: a temporary identity-shaped occurrence introduced in a non-excluded file makes it fail, and removing it makes it pass again.
  </behavior>
  <action>
Extend the EXISTING mechanism. Do not add a second sweep, a second test file, or
a parallel exclusion list.

Add the old wire id to `RETIRED_IDS`. Export that array and add an assertion
pinning its exact contents, in the same style as the two existing length pins —
the sweep silently covering nothing is the failure mode a length-only pin would
miss.

Add ONE entry to `IDENTITY_SWEEP_EXCLUSIONS` for the client tree, and raise the
pinned length by one in the same diff. Its inline reason must say what it is:
the browser-READ tier, deliberately still naming the retiring id because the
objects it names are the only ones that exist in R2 today, and Stage 5's
collapse is what deletes this entry — mirroring exactly the client-package
exclusion the previous rename carried between plans 07-16 and 07-18 and then
removed. Say in the entry which stage deletes it.

Add STRUCTURAL_EXEMPTIONS entries for the two BOTH-tier files Task 1 made
dual-name (`sigmaScore.ts` and `stateSnapshot.ts`), and raise that list's pinned
length to match. Reason each one individually in the file header's prose block,
in the voice the existing entries use: a predicate that must answer identically
for either name during the split is not an unrenamed identity, and Stage 5
removes the retiring member from each. Check whether `stateSnapshot.test.ts`
needs the same treatment; add it only if the sweep actually flags it.

Attach the `[pre-rename]` marker to the genuine measured-figure citations Task 3
left in place — the two presim byte-count comments in `pageArtifacts.ts` and
`publish.ts`, the three table rows in `docs/simulation-architecture.md`, and the
deployed-version verification lines in `docs/worker-operations.md`. The marker
is honoured only on a comment line in source and only outside a fenced block in
markdown; put it where it is actually honoured. Then COUNT the real
marker-exempted match total by running the sweep and reading the number, and set
`MARKER_CAP` to that exact count, raising it in a visible diff with the reason
written above it — never by widening a file exclusion instead.

Add the retiring id to `scripts/verifySubsetPublish.ts`'s expectation table as a
still-PRESENT id (it is: the `bpr@` objects are what the deployed site reads
until Stage 5). It moves to `expectAbsent` at Stage 6, not here. That file is
already structurally exempt.

Then prove the gate is not vacuous: temporarily add an identity-shaped
occurrence of the retiring id to a file in no exclusion list, run the sweep,
confirm it FAILS and names that file and line, remove it, and confirm it passes.
Record both outputs in the SUMMARY. Do not leave the probe in the tree.
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && npx vitest run packages/harness/algorithmIdentity.test.ts 2>&1 | tee /tmp/ivg-t4.log; grep -E "Test Files +1 passed" /tmp/ivg-t4.log</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git status --porcelain | grep -v "\.planning/" | wc -l | grep -qx "0" && echo "OK: the red-proof probe was removed and everything else is committed"</automated>
  </verify>
  <done>The sweep covers the old wire id, is green, has a pinned `RETIRED_IDS` content assertion, has both list lengths pinned to their real values with each new entry reasoned inline and naming the stage that deletes it, has `MARKER_CAP` set to a counted rather than estimated number, and has been observed failing on a deliberately planted occurrence.</done>
  <reversibility rating="reversible">A test file's exclusion lists and a set of comment markers. Revertable in one commit.</reversibility>
</task>

<task type="auto" tdd="false">
  <name>Task 5: Full-tree gate — three typechecks, the real suite, and a residual census</name>
  <files>(no source changes expected; any fix this task discovers is committed here)</files>
  <action>
Run the three checks that this repo has historically returned false green on,
and read their OUTPUT rather than their exit code.

Typechecks: the root config covers only `packages/**` and `scripts/**`, so run
`apps/web/tsconfig.json` and `apps/worker/tsconfig.json` separately. A root-only
run returning clean while `apps/web` is red is a recorded failure mode here.
Triage any type error rather than dismissing it as cosmetic — the last one
dismissed that way was a real live/offline divergence.

Test suite: run vitest from the REPOSITORY ROOT, never from `apps/web`. The root
config declares two projects; the `node` project holds 155 test files and the
`web` project 111, for 266 tracked test files total. Read the reported Test
Files count and confirm both project names appear in the output. A run that
reports roughly a hundred files ran only half the repo. Do not wrap the run in
`timeout` and do not invoke it through a `pnpm` script wrapper — both have
swallowed output and exited zero here.

Iteration-list trap: a test that ITERATES a hardcoded id list silently SKIPS a
renamed id instead of failing. Only an equality pin fails loudly. Open and check
each of these by hand for a hardcoded list that should have gained the new id or
lost the old one, and record the verdict per file in the SUMMARY:
`packages/harness/publish.test.ts`, `packages/harness/manifests.test.ts`,
`packages/harness/level1Digest.test.ts`, `packages/harness/selectionProvenance.test.ts`,
`scripts/replayRig.test.ts`, `scripts/measureRpCalibration.test.ts`,
`scripts/deleteRetiredAlgorithmObjects.test.ts`,
`scripts/deleteOrphanedDemoTeamObjects.test.ts`,
`apps/web/src/components/compare/*.test.tsx`,
`apps/web/src/components/ribbon/AlgorithmSelect.test.tsx`,
`apps/web/src/routes/index.test.tsx`, and
`apps/web/src/routes/methodology.compare.test.tsx`.

Residual census: run a case-insensitive tree-wide search for the old token,
excluding `.planning/` and the four already-reasoned measurement-record paths
(`pnpm-lock.yaml`'s sha512 substring, `data/baselines/`, `docs/models/`,
`docs/publish-budget.md`). Account for EVERY remaining line in the SUMMARY under
one of the six tiers from this plan's tier table. A line that fits no tier is a
miss, not an exception — fix it. Uppercase prose occurrences are expected and
fine wherever they name what was measured or what the history records.

Finally, confirm no user-visible string changed: the display name was already
the new one before this task, so a diff of rendered text should be empty. Grep
the `apps/web/` diff across all of this plan's commits for changes to string
literals that reach the DOM, and state in the SUMMARY that the set is empty (or
enumerate it if it is not).
  </action>
  <verify>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && npx tsc --noEmit && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/worker/tsconfig.json && echo "OK: all three typechecks clean"</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && npx vitest run 2>&1 | tee /tmp/ivg-t5.log; grep -E "Test Files +26[0-9] passed \(26[0-9]\)" /tmp/ivg-t5.log && grep -qE "\|node\|" /tmp/ivg-t5.log && grep -qE "\|web\|" /tmp/ivg-t5.log && echo "OK: both projects ran, full file count"</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git ls-files | grep -v "^\.planning/" | grep -ci "bpr" | grep -qx "0" && echo "OK: no tracked filename outside planning history carries the retired token"</automated>
    <automated>cd "C:/Users/Jacob/Documents/GitHub/SigmaScout" && git grep -in "bpr" -- . ':!.planning' ':!pnpm-lock.yaml' ':!data/baselines' ':!docs/models' ':!docs/publish-budget.md' | tee /tmp/ivg-residual.txt; wc -l < /tmp/ivg-residual.txt</automated>
  </verify>
  <done>All three typechecks clean; the root suite reports its full two-project file count green; every iteration-list file has a recorded verdict; every residual line is accounted for under a named tier; the user-visible string set is stated.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| source tree -> Cloudflare Pages | a push to `main` auto-deploys the client; any read-tier id change ships to real users without a further gate |
| source tree -> R2 / D1 | the write-tier id decides what object keys and database rows Stages 2-3 create |
| repo working tree -> agent transcript | `.env` holds live TBA and R2 credentials and must never be rendered |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ivg-01 | Denial of Service | `PUBLISHED_ALGORITHM_IDS` -> Pages auto-deploy | critical | mitigate | The read tier's VALUE is unchanged by every task in this plan; Task 1's test asserts both tiers in one place so a half-collapse fails CI rather than 404ing the live site |
| T-ivg-02 | Tampering | `frozen-params.json`, `data/baselines/`, `.planning/` | high | mitigate | Task 2 proves byte-identity by blob sha and by an empty `git diff --stat` over those paths, rather than asserting it in prose |
| T-ivg-03 | Repudiation | `SEALED_CODE_PATHS` / `assertSealed` | high | mitigate | Paths are repointed, and the repointing is proven content-preserving by blob-sha equality across the move commit — so the seal still attests to the same content it always did |
| T-ivg-04 | Information Disclosure | `.env` | critical | mitigate | No task reads, cats, echoes, or interpolates `.env`; Stage 1 needs no credential at all, and the sweep already skips the file by name |
| T-ivg-05 | Spoofing | D1 `algorithm_id` during the split | medium | accept | Between Stage 1 and Stage 3 the live database holds rows only under the retiring id; the dual-name `stateSnapshot` dispatch means a Worker deployed in that window reads them correctly rather than mis-parsing them |
| T-ivg-06 | Tampering | npm/pip/cargo installs | high | mitigate | Not applicable — this plan installs no package and adds no dependency. `pnpm-lock.yaml` is unmodified; Task 2 verifies its single case-insensitive match is a sha512 substring, not an identifier |
</threat_model>

<verification>
Stage 1 is verified when all of the following hold at the plan's tip commit:

1. Two id tiers exist, disagree on exactly one member, and are asserted together
   by a running test.
2. `git ls-files` outside `.planning/` lists no filename carrying the retired token.
3. All six sealed/frozen blob shas are byte-identical across the move commit, and
   `git diff --stat` over `data/baselines` and `.planning` for the whole plan is empty.
4. `algorithmIdentity.test.ts` sweeps the retired id, is green, and was observed red.
5. Root, `apps/web`, and `apps/worker` typechecks are each clean, run separately.
6. `npx vitest run` from the repository root reports its full two-project file
   count green.
7. Every residual case-insensitive match outside the four reasoned measurement
   paths is accounted for under a named tier in the SUMMARY.
</verification>

<success_criteria>
- The publisher and Worker write `spr`; the deployed browser reads `bpr`; one test proves both.
- No number moved. No tuning ran. No measurement was rewritten.
- The orchestrator can run Stage 2 (`pnpm publish:seasons`) from the main context immediately after this plan lands.
</success_criteria>

<output>
Create `.planning/quick/260912-ivg-rename-bpr-to-spr-sigma-power-rating-acr/260912-ivg-SUMMARY.md` when done.

The SUMMARY must carry, because the later stages depend on them:
- Task 1's commit sha (the blob-sha baseline).
- The per-file verdict table for the iteration-list check.
- The residual-census table, every line mapped to a tier.
- Each exclusion/exemption entry added, its reason, and the stage that deletes it.
- The red-proof output showing the sweep failing on a planted occurrence.
- The path and anchor of the durable "same algorithm, two names" note.
</output>
