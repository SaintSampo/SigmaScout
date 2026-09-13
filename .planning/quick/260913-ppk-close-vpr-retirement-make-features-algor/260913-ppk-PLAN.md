---
phase: quick-260913-ppk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  # Task 1: moved (pending -> completed) and appended
  - .planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md
  - .planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md
  # Task 2: comment and doc text only
  - docs/worker-operations.md
  - apps/worker/wrangler.toml
  - packages/harness/publishedAlgorithms.ts
  - apps/web/src/components/ribbon/AlgorithmSelect.tsx
autonomous: true
requirements:
  - 260913-ppk

estimate:
  tokens: 20000
  raw_tokens: 40000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "The todo vpr-retirement-make-features-algorithm-agnostic lives under .planning/todos/completed/ (not pending/), carries resolved_date 2026-09-13 and resolved_by frontmatter, and ends with a RESOLVED 2026-09-13 (quick task 260913-ppk) block recording Jacob's decision (SPR is the only live-folding algorithm permanently; OPR and EPA refresh at republish), the four reasons (CPU gate, shared event_cursor and TBA ETag, subrequest cost 50 vs ~41 for three algorithms, no live event before 2027), the already-settled items (VPR retired in 167eab64; RP-for-every-algorithm superseded by 094667e9 and bcc929cb) and the corrected premise for any reopening; its original body lines are unchanged (0 deleted lines in the commit's numstat)"
    - "No tracked file outside .planning claims VPR folds live or points at the pending todo path: the Task 2 gate grep prints nothing"
    - "docs/worker-operations.md's Live folding tier states that SPR-only is permanent (decided 2026-09-13), says why in plain terms, and points at the completed todo; its troubleshooting row names spr"
    - "No Worker behavior changes: LIVE_ALGORITHM_IDS stays \"spr\", no non-comment line of wrangler.toml, publishedAlgorithms.ts or AlgorithmSelect.tsx changes, and liveAlgorithmTier.test.ts, manifests.test.ts and browserSafeSchemas.test.ts pass (3 files, 55 tests at planning time)"
    - "Each of the two commits contains only this task's paths, built from a temporary index seeded from HEAD, so no other session's staged or unstaged change is absorbed, and no other session's commit is reverted"
  artifacts:
    - path: ".planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md"
      provides: "Closed todo with the RESOLVED 2026-09-13 decision record"
      contains: "RESOLVED 2026-09-13 (quick task 260913-ppk)"
    - path: "docs/worker-operations.md"
      provides: "Permanent SPR-only live-folding statement and corrected troubleshooting row"
      contains: "SPR-only is permanent"
    - path: "packages/harness/publishedAlgorithms.ts"
      provides: "Current-truth comment on ranking points and live folding"
      contains: "todos/completed/vpr-retirement-make-features-algorithm-agnostic.md"
  key_links:
    - from: "docs/worker-operations.md and packages/harness/publishedAlgorithms.ts"
      to: ".planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md"
      via: "path pointer in prose; Task 1 must land first so the pointer resolves"
      pattern: "todos/completed/vpr-retirement-make-features-algorithm-agnostic"
---

<objective>
Close the pending todo `vpr-retirement-make-features-algorithm-agnostic` under Jacob's locked
2026-09-13 decision: SPR stays the only algorithm that folds live, permanently; OPR and EPA keep
refreshing at republish (the manual pre/post-event re-baseline). Then correct every stale comment or
doc line that still says VPR is the live-folding algorithm.

Purpose: the todo's rotation design rests on a wrong premise (shared per-event cursor and ETag) and is
blocked by the CPU gate anyway; leaving it pending, and leaving "VPR folds live" in ops docs, misleads
the next reader.

Output: two commits. Docs and comments only: no Worker behavior change, no deploy, no D1 or R2 touch,
`LIVE_ALGORITHM_IDS` stays `"spr"`, no follow-up todo, no rotation code.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md

Planned against HEAD `334fff54`. Do NOT read `.planning/STATE.md` in full; do NOT edit or commit
`.planning/STATE.md` or this PLAN.md (the orchestrator owns both). Never read `.env`.

Out of bounds (do not edit): `apps/worker/src/scheduled.ts` (its comment is dated history),
`.planning/triage-2026-09-12.md` (perishable snapshot), any historical `.planning/phases/` or
`.planning/quick/` file, and the dated history paragraphs of `docs/worker-operations.md` (for example
the "D-04/D-05 ... transition" note and the "Verified 2026-08-23" measurements).
</context>

## Concurrency: why this plan never touches the shared git index

Other sessions (notably 260913-nvn) are committing in this SAME checkout while this runs. At planning
time the four Task 2 files were clean against HEAD, but within minutes the checkout had shown foreign
commits to two of them, a foreign rename STAGED in the real index, and foreign unstaged edits to
other files. So every commit in this plan is built in a **private temporary index seeded from HEAD**
and landed with a **compare-and-swap ref update**. This deliberately replaces the "git mv, then
update-index on the real index" approach: a plain `git commit` would absorb whatever another session
has staged, `git mv` would stage our rename where another session's commit could absorb it, and
`git commit` after a foreign commit lands mid-task could silently revert that commit.

Hard bans for the whole plan: `git add` (any form), `git mv`, `git rm`, `git commit` (any form),
`git stash`, `git checkout -- <path>`, `git restore`, and `git update-index` WITHOUT
`GIT_INDEX_FILE` set. The ONLY command that touches the real index is the final
`git reset -q -- <this task's paths>` in step P5 below. Do not push. Do not deploy.

**Blob-source rule (applies to every modified path).** The blob staged for a path must be HEAD's
content plus ONLY this task's edit. Immediately before step P2, run `git diff "$BASE" -- <path>`:
- every hunk is this task's edit: the source is the working-tree file (`git hash-object -w <path>`);
- any hunk is NOT this task's (another session edited the file mid-task): copy HEAD with
  `git show "$BASE:<path>" > "$S/ppk-<basename>"`, Read that copy, apply the identical edit with Edit,
  and hash with `git hash-object -w --path=<path> "$S/ppk-<basename>"`. The working tree keeps both
  sessions' edits; the commit gets only ours.

`core.autocrlf=true` on this machine and several working-tree files are CRLF while their blobs are LF.
`hash-object` with a repo path normalizes this; the numstat gate in P3 catches it if it does not.

### Commit Protocol (run once per task, in Git Bash)

```bash
cd C:/Users/Jacob/Documents/GitHub/SigmaScout
S=C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/bdb6113c-16f2-4fca-adaa-3487fb244f54/scratchpad
N=1                      # task number
PATHS="..."              # every path this task commits (Task 1: both todo paths; Task 2: the 4 files)
IDX="$S/ppk-task$N.index"

# P0 snapshot + real-index precheck (must print nothing: nobody has staged on our paths)
git status --short > "$S/ppk-status-before-$N.txt"
git diff --cached --name-only -- $PATHS

# P1 private index from HEAD
BASE=$(git rev-parse HEAD)
rm -f "$IDX"
GIT_INDEX_FILE="$IDX" git read-tree "$BASE"

# P2 stage blobs into the PRIVATE index only (blob-source rule above picks <source>)
GIT_INDEX_FILE="$IDX" git update-index --add --cacheinfo "100644,$(git hash-object -w <source>),<path>"
#   Task 1's rename is exactly these two lines:
GIT_INDEX_FILE="$IDX" git update-index --force-remove .planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md
GIT_INDEX_FILE="$IDX" git update-index --add --cacheinfo "100644,$(git hash-object -w .planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md),.planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md"

# P3 gates on the private index (read every line of output)
GIT_INDEX_FILE="$IDX" git diff --cached -M --name-status "$BASE"   # ONLY $PATHS
GIT_INDEX_FILE="$IDX" git diff --cached -M --numstat "$BASE"       # counts per task's <verify>; hundreds of lines = line-ending blowup, STOP
GIT_INDEX_FILE="$IDX" git diff --cached -M "$BASE"                 # every +/- line is this task's

# P4 commit and land with compare-and-swap (message file written beforehand with the Write tool)
TREE=$(GIT_INDEX_FILE="$IDX" git write-tree)
NEW=$(git commit-tree "$TREE" -p "$BASE" -F "$S/ppk-task$N-msg.txt")
git update-ref -m "commit: $(head -1 "$S/ppk-task$N-msg.txt")" refs/heads/main "$NEW" "$BASE"
#   If update-ref fails (main is no longer at BASE), another session committed: restart at P0.
#   Never force, never pass a different old-value.

# P5 sync the REAL index for our paths only, then prove nothing foreign was absorbed
git reset -q -- $PATHS
git show --stat --format='%h %s' HEAD                                # only $PATHS
git status --short > "$S/ppk-status-after-$N.txt"
git status --short -- $PATHS                                         # nothing, except " M" on a file that already had foreign hunks
rm -f "$IDX"
```

After P5, compare `ppk-status-before-$N.txt` and `ppk-status-after-$N.txt` with this task's paths
filtered out: every foreign entry must still be there. A difference is acceptable only if it is
explained by another session's own activity (its entry is gone because `git log` shows it committed
it), never by this commit; `git show --stat HEAD` listing only this task's paths is the proof.

## Content specs (text to write; referenced by the task actions)

**C1: frontmatter keys for the todo.** Insert these two lines directly after the `priority: high`
line (matching the newest completed todos, e.g. `quick-tasks-append-corrupts-state-frontmatter.md`):

```yaml
resolved_date: 2026-09-13
resolved_by: quick task 260913-ppk, decision only (SPR stays the only live-folding algorithm, no code or Worker change)
```

**C2: closing block for the todo.** Append after the file's current last line (the "Section 1 (live
updates for every algorithm) is unchanged" bullet), preceded by one blank line:

```markdown
---

> **RESOLVED 2026-09-13 (quick task 260913-ppk). Closed: SPR stays the only algorithm that folds live, permanently.**
>
> Jacob's decision, 2026-09-13. OPR and EPA keep refreshing only at republish (the manual
> pre/post-event re-baseline), exactly as today. Docs and comments only: no Worker behavior change,
> no deploy, no D1 or R2 touch, and `LIVE_ALGORITHM_IDS` stays `"spr"`. No follow-up todo was opened
> and no rotation will be built.
>
> Why, each point checked against HEAD on 2026-09-13:
> 1. **CPU budget.** The Worker cannot sustain even SPR alone yet. `docs/worker-operations.md`'s
>    PRE-SEASON GATE (in force 2026-09-12) and `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md`
>    record that a realistic mid-quals tick (2 folded, 60 upcoming) costs 13 ms p50 / 28 ms p90 in
>    Phase A alone against a 10 ms sustained budget, for one algorithm. Folding OPR and EPA as well
>    adds their fold, serialize and artifact-merge CPU on top.
> 2. **Section 1's rotation design was wrong about the cursor.** `event_cursor` holds one row per
>    event with no per-algorithm granularity (`apps/worker/src/scheduled.ts` header: an event advances
>    for all published algorithms in a tick, or for none). An algorithm left out of a tick's rotation
>    would have that tick's matches skipped forever once the shared cursor advanced. The TBA ETag is
>    shared the same way: once one algorithm's tick stores it, the next tick gets a 304 and returns
>    "unchanged" before a lagging algorithm could fold. Quick task 260822-wqt already chose a
>    single-algorithm tier over per-algorithm cursor granularity (see the doc comment on
>    `DEFAULT_LIVE_ALGORITHM_IDS` in `scheduled.ts`); this decision repeats that choice.
> 3. **Subrequest arithmetic with today's three algorithms** (opr, epa, spr):
>    `estimateEventSubrequestCost(3, 6)` = 50 against ~41 usable, so all three per tick never fits.
>    Unchanged from section 1's table, which was written for four.
> 4. **Nothing to measure against.** No live event runs before the 2027 season, and section 1 itself
>    required measuring a real fold before a rotation could be trusted.
>
> Already settled by the 2026-09-13 status note above: step 4 (retire VPR) is done (`167eab64`), and
> sections 2 and 3 (ranking points for every algorithm) are superseded by the SPR-only ranking-point
> decision (`094667e9`, `bcc929cb`).
>
> **If this is ever reopened, start from the corrected premise, not section 1's design.** A rotation
> needs a per-algorithm cursor (not the shared `event_cursor` row) plus a TBA ETag bypass while any
> algorithm lags behind, and it stays blocked behind the PRE-SEASON CPU gate until
> `rp-fold-exceeds-worker-cpu-budget` closes.
```

**C3: `docs/worker-operations.md` Live folding tier paragraph.** Insert as its own paragraph (blank
line before and after) directly after the paragraph that opens with ``**`opr` and `epa` remain FULLY
PUBLISHED**`` (it ends "expected behavior, not a bug.") and before the paragraph that opens with
``**Adding a second id to `LIVE_ALGORITHM_IDS` is gated**``:

```markdown
**SPR-only is permanent — decided 2026-09-13 (quick task 260913-ppk).** OPR and EPA will not be
rotated into the live tick. The Worker cannot yet sustain even SPR alone inside the CPU budget (see
the PRE-SEASON GATE below), and the per-event cursor and the TBA ETag are shared across algorithms,
so an algorithm left out of a tick would have its matches skipped rather than caught up later. The
full reasoning, and the design premise any reopening must start from, is in
`.planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md`.
```

**C4: `docs/worker-operations.md` troubleshooting row.** Replace the whole row that begins
``| `opr` or `epa` metrics look stale mid-event`` (line 725 at planning time) with exactly:

```markdown
| `opr` or `epa` metrics look stale mid-event while `spr` updates | Expected — only `spr` folds live (see "Live folding tier" above) | `LIVE_ALGORITHM_IDS` in `apps/worker/wrangler.toml`; refresh via a re-baseline (above) |
```

**C5: `apps/worker/wrangler.toml` comment lines.** Two single-line swaps in the comment block above
`LIVE_ALGORITHM_IDS`; locate by anchor, not line number. The line beginning
`# Quick task 260822-wqt:` (line 36 at planning time) becomes the first line below, and the line
beginning `# published set (D-03) is unchanged:` (line 45) becomes the second. Nothing else in the
file changes.

```toml
# Quick task 260822-wqt: only the published SPR algorithm folds LIVE, per
# published set (D-03) is unchanged: opr, epa and spr all keep being
```

**C6: `packages/harness/publishedAlgorithms.ts` doc comment.** Replace the paragraph that begins
` * TWO CAPABILITIES LEAVE WITH IT` and runs through the line ending
`for the plan to rebuild ranking points as a SigmaScout-layer feature.` (lines 55-64 at planning
time; the ` */` on the next line stays) with exactly:

```ts
 * VPR was the only algorithm that modelled ranking points when it left, so
 * the rank SIMULATION and the per-bonus RP dots in the match tables
 * (`redBonusRp`/`blueBonusRp`) lost their source with it. Both are back, for
 * SPR only: ranking-point odds are now built at the SigmaScout layer
 * (`packages/core/rankingPoints/`) and, by quick task 260913-it4's
 * 2026-09-13 decision, attached to SPR's predictions alone. OPR and EPA
 * publish no ranking-point odds (`094667e9`), and the Simulation tab works
 * under SPR only (`bcc929cb`). SPR is also the only algorithm that folds
 * live, a permanent choice (quick task 260913-ppk); see
 * `.planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md`.
```

**C7: `apps/web/src/components/ribbon/AlgorithmSelect.tsx`.** In the `AlgorithmSelect` doc comment,
the line beginning ` * freshness anywhere in this component (` (line 188 at planning time) names the
retired algorithm inside its parenthetical. Change only that algorithm name to `SPR`, so the line
reads exactly:

```ts
 * freshness anywhere in this component (only SPR folds live, and this
```

## Commit messages (write each with the Write tool to the scratchpad before its P4)

`$S/ppk-task1-msg.txt`:

```text
docs(260913-ppk): close the algorithm-agnostic todo, SPR stays the only live-folding algorithm

- Move vpr-retirement-make-features-algorithm-agnostic to todos/completed with a RESOLVED 2026-09-13 note
- Record why: the CPU gate, the shared event_cursor and TBA ETag, a 3-algorithm cost of 50 vs ~41 subrequests, no live event before 2027
- Record the corrected premise for any reopening: per-algorithm cursor plus ETag bypass, still behind the CPU gate

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

`$S/ppk-task2-msg.txt`:

```text
docs(260913-ppk): SPR is the only live-folding algorithm in ops docs and comments

- worker-operations.md: troubleshooting row names spr; Live folding tier records the permanent 2026-09-13 decision
- wrangler.toml: LIVE_ALGORITHM_IDS comment names SPR and the opr/epa/spr published set; the value is unchanged
- publishedAlgorithms.ts: ranking points came back SPR-only; point at the completed todo
- AlgorithmSelect.tsx: freshness comment names SPR

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

<tasks>

<task type="auto">
  <name>Task 1: Close the todo under the locked SPR-only live-folding decision</name>
  <files>.planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md, .planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md</files>
  <read_first>.planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md (whole file, 131 lines, so the appended block matches its voice)</read_first>
  <!-- planner-discipline-allow: todos/pending/vpr-retirement -->
  <action>
Implements the developer's locked 2026-09-13 decision (close the todo; SPR stays the only live-folding algorithm; docs only). Run the Commit Protocol's P0 first with N=1 and PATHS set to the pending and completed todo paths; the real-index precheck must print nothing.

Move the file with a plain filesystem move, NOT a git move: `mv .planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md .planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md` (a git move stages the rename in the shared index, where another session's commit could absorb it). Read the moved file, then with Edit: insert spec C1's two frontmatter keys after the `priority: high` line, and append spec C2 after the current last line with one blank line before it. Do not change any existing body line: the body is history, including section 1's table and the two dated STATUS notes. No `|` goes into anything destined for STATE.md.

Write the task-1 message from the "Commit messages" section to `$S/ppk-task1-msg.txt` with the Write tool, then run P1 through P5. In P2 use only the two rename lines, since this task has no other modified path. The pending path is absent from the working tree, which is expected. P5's `git reset -q -- $PATHS` drops the pending path from the real index and records the completed path at the new HEAD blob.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout && C=$(git log -1 --format=%H -F --grep='docs(260913-ppk): close the algorithm-agnostic todo') && echo "commit=$C" && test -n "$C" && test ! -e .planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md && test -f .planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md && git show -M --numstat --format='%h %s' "$C" && git show "$C:.planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md" | grep -c -F -e "RESOLVED 2026-09-13 (quick task 260913-ppk)" -e "resolved_date: 2026-09-13" -e "estimateEventSubrequestCost(3, 6)" -e "per-algorithm cursor (not the shared" && echo "line9:[$(git show "$C:.planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md" | sed -n '9p')]" && echo "index-pending:[$(git ls-files -- .planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md)]" && echo "status-todos:[$(git status --short -- .planning/todos/vpr-retirement-make-features-algorithm-agnostic.md .planning/todos/pending/vpr-retirement-make-features-algorithm-agnostic.md .planning/todos/completed/vpr-retirement-make-features-algorithm-agnostic.md)]"</automated>
  </verify>
  <done>
- The commit's numstat is exactly one line: `.planning/todos/{pending => completed}/vpr-retirement-make-features-algorithm-agnostic.md` with about 35-45 added and 0 deleted lines. The subject is the task-1 message.
- The grep count is 4, one line per distinct string. `line9:[---]` confirms the frontmatter still closes, with its seven original lines plus the two C1 keys.
- `index-pending:[]` and `status-todos:[]` both print empty brackets.
- Every foreign entry in `ppk-status-before-1.txt` survives in `ppk-status-after-1.txt`, apart from any that the other session provably committed itself.
  </done>
</task>

<task type="auto">
  <name>Task 2: Replace the stale VPR live-folding claims in ops docs and code comments with SPR</name>
  <files>docs/worker-operations.md, apps/worker/wrangler.toml, packages/harness/publishedAlgorithms.ts, apps/web/src/components/ribbon/AlgorithmSelect.tsx</files>
  <read_first>docs/worker-operations.md lines 251-300 and 715-730; apps/worker/wrangler.toml lines 33-66; packages/harness/publishedAlgorithms.ts lines 40-68; apps/web/src/components/ribbon/AlgorithmSelect.tsx lines 180-191</read_first>
  <action>
Implements the developer's locked 2026-09-13 decision: docs and comments only. Task 1 must be committed first so the new pointers resolve. Run P0 with N=2 and PATHS set to the four files; the real-index precheck must print nothing. Also run `git diff HEAD -- <each file>` now and note any hunk that is not yours, because the blob-source rule depends on it.

Apply with Edit, each to the working-tree file:
- In `docs/worker-operations.md`, insert spec C3 as its own paragraph inside "Live folding tier", and replace the troubleshooting row with spec C4.
- In `apps/worker/wrangler.toml`, make only the two comment-line swaps in spec C5. Never touch the `LIVE_ALGORITHM_IDS = "spr"` line, the dated D-04/D-05 and 260912-ivg history paragraphs, or any non-comment line.
- In `packages/harness/publishedAlgorithms.ts`, replace the stale paragraph with spec C6. The earlier `vpr` removal paragraph and `export const PUBLISHED_ALGORITHM_IDS` stay unchanged.
- In `apps/web/src/components/ribbon/AlgorithmSelect.tsx`, apply spec C7, the single algorithm-name change on that comment line.

Write the task-2 message from the "Commit messages" section to `$S/ppk-task2-msg.txt` with the Write tool, then run P1 through P5. Choose each file's blob source using the blob-source rule. Do not edit `apps/worker/src/scheduled.ts`.

Run the tests from the repo root: `npx vitest run apps/worker/test/liveAlgorithmTier.test.ts packages/harness/manifests.test.ts packages/harness/browserSafeSchemas.test.ts`. Read the pass counts in the output and never trust the exit code alone. Run only these three files: other sessions' deletions can make unrelated suites red. Skip `tsc` for this comment-only change.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout && C=$(git log -1 --format=%H -F --grep='docs(260913-ppk): SPR is the only live-folding algorithm') && echo "commit=$C" && test -n "$C" && echo "gate1:[$(git grep -n -i -E 'only .?vpr.? folds|vpr folds live|while .?vpr.? updates|todos/pending/vpr-retirement' "$C" -- ':!.planning')]" && echo "gate2:[$(git show "$C:apps/worker/wrangler.toml" | grep -n -E 'VPR algorithm folds|epa and vpr all keep')]" && echo "noncomment:[$(git diff "$C~1" "$C" -- apps/worker/wrangler.toml | grep -E '^[+-][^#+-]')]" && git show "$C:apps/worker/wrangler.toml" | grep -c '^LIVE_ALGORITHM_IDS = "spr"$' && git show "$C:docs/worker-operations.md" | grep -c -F -e 'SPR-only is permanent' -e 'only `spr` folds live' && git show "$C:packages/harness/publishedAlgorithms.ts" | grep -c -F -e 'export const PUBLISHED_ALGORITHM_IDS = ["opr", "epa", "spr"] as const;' -e 'todos/completed/vpr-retirement-make-features-algorithm-agnostic.md' && git show --numstat --format='%h %s' "$C" && git status --short -- docs/worker-operations.md apps/worker/wrangler.toml packages/harness/publishedAlgorithms.ts apps/web/src/components/ribbon/AlgorithmSelect.tsx && npx vitest run apps/worker/test/liveAlgorithmTier.test.ts packages/harness/manifests.test.ts packages/harness/browserSafeSchemas.test.ts 2>&1 | tail -6</automated>
  </verify>
  <done>
- `gate1:[]`, `gate2:[]` and `noncomment:[]` all print empty brackets. The `LIVE_ALGORITHM_IDS` count is 1, the worker-operations count is 2 and the publishedAlgorithms count is 2.
- The commit's numstat lists exactly the four files, in about these amounts: worker-operations.md +8/-1, wrangler.toml 2/2, publishedAlgorithms.ts 10/10, AlgorithmSelect.tsx 1/1. The subject is the task-2 message.
- `git status --short` on the four files prints nothing unless another session had pre-existing hunks there. Those hunks must still show as unstaged M, and must not appear in `git show HEAD`.
- Vitest reports `Test Files  3 passed (3)` and `Tests  55 passed (55)`, or the same file count with a test count explained by a concurrent session's commit.
- Every foreign entry in `ppk-status-before-2.txt` survives in `ppk-status-after-2.txt`, apart from any that the other session provably committed itself.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| this session -> shared git checkout | Other live sessions stage, edit and commit in the same working tree and index |
| repo text -> Worker deploy config | `apps/worker/wrangler.toml` `[vars]` values reach production on the next deploy |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ppk-01 | Tampering | git index / commits | high | mitigate | Commits are built in a private `GIT_INDEX_FILE` seeded from HEAD, so a foreign staged change can never enter them. `git add`, `git mv`, `git rm` and `git commit` are banned, and the real index is touched only by a path-scoped `git reset` after landing. P3's name-status, numstat and diff gates, P5's `git show --stat`, and the before/after status comparison prove no foreign content was absorbed |
| T-ppk-02 | Tampering | branch ref (reverting a concurrent commit) | high | mitigate | `git update-ref refs/heads/main NEW BASE` is a compare-and-swap. If another session committed after P1, the update fails and the protocol restarts from P0. It never forces |
| T-ppk-03 | Tampering | `apps/worker/wrangler.toml` LIVE_ALGORITHM_IDS | medium | mitigate | Only two comment lines change. The `noncomment:[]` gate proves no non-comment line changed, the `LIVE_ALGORITHM_IDS = "spr"` count must be 1, and `liveAlgorithmTier.test.ts` re-derives the budget from the file. No deploy is part of this plan |
| T-ppk-04 | Information Disclosure | `.env` secrets | low | accept | No step reads or references `.env`, no test here needs credentials, and no network command runs. The CLAUDE.md secrets rule applies as written |
</threat_model>

<verification>
- Both commits exist on local `main`, in order (Task 1, then Task 2), and each contains only its own paths.
- The Task 2 gate grep over HEAD, excluding `.planning`, prints nothing.
- The three test files pass from the repo root.
- Nothing is pushed or deployed, and there is no D1 or R2 command.
- STATE.md and PLAN.md are not committed.
</verification>

<success_criteria>
- The todo is under `.planning/todos/completed/`, with resolved frontmatter and a RESOLVED 2026-09-13 block covering the decision, the four reasons, the settled items and the corrected reopen premise. Its original body is intact.
- No non-`.planning` tracked text still says VPR folds live or points at the pending todo path. `docs/worker-operations.md` states SPR-only is permanent, with the why and a pointer.
- Worker behavior is untouched: `LIVE_ALGORITHM_IDS` stays `"spr"` and only comment and doc lines change.
- No other session's staged, unstaged or committed work is absorbed or reverted.
</success_criteria>

<output>
Do NOT write SUMMARY.md with the Write tool; subagents are blocked from it. Return the summary text in
the final message (both commit hashes, each commit's numstat, the gate outputs, the vitest pass
counts, and any foreign hunk that forced the HEAD-copy blob path). The orchestrator writes
`.planning/quick/260913-ppk-close-vpr-retirement-make-features-algor/260913-ppk-SUMMARY.md`.
</output>
