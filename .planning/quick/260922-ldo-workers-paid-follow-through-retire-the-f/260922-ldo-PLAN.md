---
phase: 260922-ldo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/worker/src/subrequestBudget.ts
  - apps/worker/test/subrequestBudget.test.ts
  - apps/worker/test/liveAlgorithmTier.test.ts
  - apps/worker/wrangler.toml
  - .claude/CLAUDE.md
  - .planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md
  - .planning/todos/pending/played-match-band-and-rp-in-browser.md
  - .planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md
  - .planning/todos/completed/played-match-band-and-rp-in-browser.md
  - .planning/todos/pending/teams-list-live-delta-overlay.md
  - docs/worker-operations.md
  - docs/publish-budget.md
autonomous: true
requirements: [QUICK-260922-ldo]

estimate:
  tokens: 95000
  raw_tokens: 95000
  tasks: 4
  confidence: low

must_haves:
  truths:
    - "The Worker's in-tick subrequest accounting is sized to the Workers Paid per-invocation limit, not the free-plan one, and every test that re-derives the budget from the constant passes."
    - "A reader of .claude/CLAUDE.md learns the project is on Workers Paid as of 2026-09-22, and cannot mistake a retired free-plan cap for a current design rule."
    - "The two todos the CPU budget was blocking sit in .planning/todos/completed with a dated STATUS block saying the plan upgrade closed them and no measurement is owed."
    - "teams-list-live-delta-overlay.md states exactly one remaining action: lowering GLOBAL_REBUILD_INTERVAL_MS toward one minute."
    - "docs/worker-operations.md and docs/publish-budget.md no longer present the 10 ms CPU budget, the ~41 usable subrequests per tick, or the D1/KV daily caps as current."
    - "Every R2 write-cost caution in the repo is byte-identical to how it started."
  artifacts:
    - apps/worker/src/subrequestBudget.ts
    - .claude/CLAUDE.md
    - .planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md
    - .planning/todos/completed/played-match-band-and-rp-in-browser.md
    - docs/worker-operations.md
    - docs/publish-budget.md
  key_links:
    - "SUBREQUEST_CAP in apps/worker/src/subrequestBudget.ts -> the usable budget that apps/worker/test/liveAlgorithmTier.test.ts re-derives for its LIVE_ALGORITHM_IDS regression guard."
    - "The retired free-plan CPU gate in docs/worker-operations.md -> the two todos closed in step 3, which cite that gate as the reason they were open."
---

<objective>
Jacob upgraded the Cloudflare account to Workers Paid on 2026-09-22. Per invocation the Worker now
has 30 s CPU (was 10 ms) and 10,000 subrequests (was 50). D1 row writes are 50M/month (was
100k/day) and KV writes are 1M/month (was 1,000/day). R2 is a separate product and its free tier is
UNCHANGED, so every R2 write-cost caution in this repo stays true and must not be touched.

Retire the free-tier limits from the one constant that encodes them, from CLAUDE.md's two stack
tables, from three todos that exist only because of those limits, and from the two operations docs
that present them as current.

Purpose: the repo currently argues from caps that no longer apply. Every one of those arguments is
a live trap. A future reader, human or agent, will defer work, split a tick, or refuse a design on
a constraint that was lifted.

Output: four commits, one per numbered step, in the order below. The order is Jacob's and is locked.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@apps/worker/src/subrequestBudget.ts

Do NOT read `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md` in full. It is 2,489
lines and will eat your context. Read only its frontmatter and the first ~20 lines, which is all
step 3 needs.

Do NOT read `docs/worker-operations.md` (1,275 lines) or `docs/publish-budget.md` (309 lines) in
full. Work from the grep hit lists given in task 4 and read only the surrounding lines of each hit.
</context>

<house_rules>
These are not optional and they override any habit to the contrary.

1. NEVER read, `cat`, `echo`, `head`, `tail`, `source`, or `Read` the `.env` file. No step in this
   plan needs a secret. See `.claude/CLAUDE.md`'s "Secrets handling" section.
2. NO network actions. No `wrangler deploy`, no publish, no `git push`, no live fetch. The Worker
   deploy IS owed after this task and must be recorded in the summary as owed. It must happen
   later, from a clean tree, via `npx wrangler deploy` (NOT `pnpm --filter worker deploy`, which
   hits pnpm's built-in and deploys nothing).
3. This checkout is shared with other sessions and has unrelated dirty files:
   `.planning/sketches/MANIFEST.md` and `.planning/sketches/020-locks-page-reimagined/`. Stage by
   explicit path only. Never `git add -A`, never `git add .`, never `git commit -a`. A previous
   commit in this repo absorbed a peer session's edits exactly that way.
4. Verify by OUTPUT, never by exit code. Do not wrap test or typecheck commands in `timeout` and do
   not add pnpm wrappers beyond the ones named here. Both have swallowed real failures in this repo
   before. Read the printed summary line.
5. Do not commit docs artifacts. SUMMARY.md, STATE.md and this PLAN.md are the orchestrator's to
   commit. You write SUMMARY.md to this task directory AND return its full text in your final
   message, but you never `git add` it.
6. Commit messages: `feat(260922-ldo): ...` for step 1, `docs(260922-ldo): ...` for steps 2, 3 and
   4. Every message ends with the line:
   `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
7. Never invent a limit Jacob did not supply. The four paid figures you have are: 30 s CPU per
   invocation, 10,000 subrequests per invocation, 50M D1 row writes per month, 1M KV writes per
   month. If a sentence cites a cap outside that set (for example D1's 5,000,000 rows-read-per-day),
   mark it as superseded by the paid plan and flag it in the summary as a figure Jacob should
   confirm. Do not guess a replacement number.
8. Do not touch anything R2. Not the R2 rows in CLAUDE.md, not the R2 storage and write-volume
   section or the machine-readable json budget block in `docs/publish-budget.md`, not any R2
   write-cost caution anywhere. R2's free tier is unchanged.
</house_rules>

<tasks>

<task type="auto">
  <name>Task 1: Raise the subrequest cap to the paid per-invocation limit and re-point the tests</name>
  <files>apps/worker/src/subrequestBudget.ts, apps/worker/test/subrequestBudget.test.ts, apps/worker/test/liveAlgorithmTier.test.ts, apps/worker/wrangler.toml</files>
  <read_first>
- `apps/worker/src/subrequestBudget.ts` (132 lines, read whole)
- `apps/worker/test/subrequestBudget.test.ts` lines 1-15 (the block that pins the constant)
- `apps/worker/test/liveAlgorithmTier.test.ts` lines 425-485 (the three budget assertions)
- `apps/worker/wrangler.toml` lines 34-49 (the comment block above LIVE_ALGORITHM_IDS)
  </read_first>
  <action>
In `apps/worker/src/subrequestBudget.ts`: set `SUBREQUEST_CAP` to 10000. Leave `SUBREQUEST_RESERVE`
at 4. Its value and its doc comment both stay accurate, since a tick's own fixed costs did not move.

Rewrite the module header comment (lines 1 through 20) and the `SUBREQUEST_CAP` doc comment so they
state the paid limits and the date rather than the free-plan ones. Three things must come across:

- The account has been on Workers Paid since 2026-09-22. The per-invocation subrequest limit is
  10,000, not the 50 this module was originally sized against.
- The rotation, the no-starvation ordering and the `tryConsume` deferral machinery all STAY IN
  PLACE. They simply never trigger at this cap. Say why they stay rather than implying they are
  dead code: the cap is a platform limit that can change again, and the starvation property the
  header describes is a correctness property of the rotation itself, not of the cap's size.
- The header's current argument that the rotation offset belongs in D1 rather than KV rests on KV's
  old thousand-writes-per-day free cap. That argument is retired. KV is 1M writes per month on the
  paid plan, which a ten-hour event day at one-minute ticks does not come close to. Mark that
  reasoning as historical, stating it was the original pre-2026-09-22 reason, and keep the design:
  the offset still lives beside `last_folded_match_key` and `tba_etag` in D1's `event_cursor` row,
  now because it is co-located with the cursor it advances with, not because KV is too small.

Do not change any method body, any signature, `rotate`, or `sortEventKeys`.

In `apps/worker/test/subrequestBudget.test.ts`: the first describe block pins the constant to the
old free-plan value and names that value in the test title. Update both the asserted number and the
title so the test asserts the paid per-invocation limit. The other tests in that file construct a
`SubrequestBudget` with explicit numeric arguments. Those are exercising the class with chosen
values, not re-deriving the platform cap, so LEAVE THEM ALONE. The `boundary triple` test derives
`usableCap` from the constant and keeps passing unchanged; do not touch it.

In `apps/worker/test/liveAlgorithmTier.test.ts`: two tests compute `usable` from
`new SubrequestBudget().usableCap` and keep passing at the new cap. What is now false is the
assertion MESSAGE at around line 439, which re-types the old cap and reserve as prose. Rewrite that
message to name the paid cap and the date, and to say the guard now has enormous headroom and is
retained as a regression guard against a future per-event cost term rather than as a live
constraint. Leave the `estimateEventSubrequestCost` formula assertions untouched. That arithmetic
is about the Worker's own shape and did not change.

In `apps/worker/wrangler.toml`: the comment block above `LIVE_ALGORITHM_IDS` justifies the spr-only
live folding tier partly from the roughly 41 subrequests it says are actually available per tick,
and it re-types the old cap and reserve. Rewrite ONLY those comment lines to record that the
subrequest argument for the tier is retired as of 2026-09-22 under the paid plan, and that widening
the live tier is a separate decision which changes published numbers and needs its own algorithm
version bump, so the value is deliberately left as it stands. The `LIVE_ALGORITHM_IDS` value line
itself must come out of this task byte-identical. Do NOT add opr or epa to it.

Then run the worker typecheck and the worker test suite from the repo root (see verify). Both must
be clean before you commit.

Commit with `git add` naming exactly the four paths above.
  </action>
  <verify>
    <automated>cd "$(git rev-parse --show-toplevel)" && pnpm --filter worker run typecheck && npx vitest run apps/worker</automated>
    <automated>cd "$(git rev-parse --show-toplevel)" && grep -c "SUBREQUEST_CAP = 10000" apps/worker/src/subrequestBudget.ts && grep -c "SUBREQUEST_RESERVE = 4" apps/worker/src/subrequestBudget.ts && grep -c "SUBREQUEST_CAP).toBe(10000)" apps/worker/test/subrequestBudget.test.ts</automated>
    <automated>cd "$(git rev-parse --show-toplevel)" && git diff HEAD -- apps/worker/wrangler.toml | grep -cE "^[-+]LIVE_ALGORITHM_IDS"</automated>
    <human-check>
The vitest run is from the REPO ROOT, never from `apps/worker`. The root `vitest.config.ts` scopes
its `node` project to include `apps/worker/**/*.test.ts`, and it sets `passWithNoTests: true`, so a
mistyped path prints a green result having run nothing. Read the printed summary: it must report 20
test files under `apps/worker/test/` and zero failures. A run reporting 0 files is a FAILED
verification, not a pass.

The third command must print `0`: zero added or removed lines beginning with `LIVE_ALGORITHM_IDS`,
proving the value line was not edited. Any other number means you touched the locked line. Revert it
before committing.
    </human-check>
  </verify>
  <done>
`SUBREQUEST_CAP` is 10000 and `SUBREQUEST_RESERVE` is 4. The module header and the constant's doc
comment state the paid limits and 2026-09-22, keep the rotation and deferral machinery with a stated
reason, and mark the KV-write-cap argument historical without deleting the D1 design it produced.
The constant-pinning test asserts the paid limit. The `liveAlgorithmTier` assertion message no
longer re-types the retired cap. `wrangler.toml`'s comment records the retired subrequest argument
while its `LIVE_ALGORITHM_IDS` value is byte-identical. Worker typecheck clean; the repo-root vitest
run reports 20 worker test files and zero failures. One commit, `feat(260922-ldo): ...`, staged by
explicit path.
  </done>
</task>

<task type="auto">
  <name>Task 2: Rewrite CLAUDE.md's budget constraint and the five rows that argue from retired caps</name>
  <files>.claude/CLAUDE.md</files>
  <read_first>
The project instructions live at `.claude/CLAUDE.md`, NOT at the repo root. Locate the exact rows
first rather than reading the file top to bottom:

`grep -nE "free tier|free plan|10ms|1,000 writes|100k|subrequest" .claude/CLAUDE.md`
  </read_first>
  <action>
Exactly five edits. Every one is a prose rewrite of an existing line. Do not restructure the tables,
do not add or remove rows, do not reorder anything.

Edit 1, the Budget constraint bullet under `### Constraints` (currently line 16). Replace
"Cloudflare free tiers only; respect TBA API rate limits" with a statement that the account is on
Workers Paid as of 2026-09-22, and that R2, Pages and KV stay within their free allowances. Keep the
TBA API rate-limit clause and keep the trailing em-dash rationale in the same shape as its sibling
bullets.

Edit 2, the KV row in `### Cloudflare Storage & Compute Topology` (the row whose first cell names KV
as the thin manifest layer). Its "Why Recommended" cell argues from a thousand-writes-per-day free
cap. Rewrite so that cap reads as history: KV writes are 1M per month on the paid plan since
2026-09-22, and the old daily figure was the free-tier constraint the thin-manifest design was
originally chosen under. Keep the design conclusion (KV holds small hot pointer and flag values, not
the artifact store) and keep the eventual-consistency sentence verbatim.

Edit 3, the D1 row in the same table (live per-team algorithm state, Worker-internal only). Its cell
argues from consuming 42 of the free plan's 50 subrequests per invocation. Rewrite so that
arithmetic reads as the pre-2026-09-22 reason: the per-invocation limit is now 10,000, so the
subrequest argument no longer forces the design. Keep everything else in the cell intact: that R2's
`get()` has no multi-key batch form, that `batch()` plus one `WHERE team_key IN (...)` collapses the
reads, that R2 stays the primary artifact store and KV the thin manifest layer, that D1 is never
reachable from the browser, and the whole trailing parenthetical crediting Phase 4, D-13,
2026-08-22 and `04-RESEARCH.md`.

Edit 4, the "KV as the primary artifact store" row in `## What NOT to Use`. It opens by citing a
free-tier daily write cap. Rewrite that cap as historical (it was the free-tier cap before
2026-09-22) and keep the row's verdict unchanged: KV is still not the bulk JSON payload store, R2
still is. The row's "Use Instead" column stays exactly as written.

Edit 5, the "Cron Trigger doing full-season recompute or the 1000-run simulation" row in
`## What NOT to Use`. Three locked requirements here:

- Keep the design point. Bulk compute (full-season recompute, hyperparameter tuning, the 1000-run
  simulation) belongs in the offline Node pipeline or the browser, never in a cron tick. That
  conclusion is unchanged and must survive intact, along with the "recompute-per-request"
  failure-log framing and the "Use Instead" column.
- Drop the CPU-limit argument as the reason. The row must no longer justify its conclusion with the
  10 ms budget.
- Do NOT delete the 2026-08-29 debug-session finding about isolate flexibility (the
  `worker-tick-exceeds-cpu-budget` session, where the same Worker version returned `ok` at a
  `cpuTime` of 38 and was then killed pinned at the limit sixty seconds later on the same code and
  data). Mark it historical, since it was measured on the free plan before 2026-09-22, and keep it
  findable in the row.

Leave untouched, deliberately: every row that mentions R2 (the R2 primary-data-store row, the
read and serving-layer row, the R2-as-primary-store alternatives row); the "D1 for the client read
path" row in What NOT to Use, which argues from complexity and requirements rather than from any
cap; the Cron Trigger topology row, whose five-triggers-per-account figure is outside the four paid
figures you were given; and the `## Sources` bullet, which is an accurate record of what was fetched
and when.

One row you must NOT rewrite but MUST report. The `## Alternatives Considered` table has a
"GitHub-Actions/local Node pipeline for bulk compute" row that still argues from CPU time per
invocation. It sits in neither of the two tables Jacob named, so editing it is outside the locked
scope of this step. Leave it exactly as it is, and carry it into task 4's leftover-hit list under
the heading for hits that still read as current and were left alone because they sit outside the
locked scope.

Commit `.claude/CLAUDE.md` alone, by explicit path.
  </action>
  <verify>
    <automated>cd "$(git rev-parse --show-toplevel)" && git diff HEAD --stat -- .claude/CLAUDE.md</automated>
    <automated>cd "$(git rev-parse --show-toplevel)" && grep -c "2026-09-22" .claude/CLAUDE.md && grep -c "worker-tick-exceeds-cpu-budget" .claude/CLAUDE.md && grep -c "zero egress fees" .claude/CLAUDE.md</automated>
    <human-check>
Read the five rewritten rows end to end. Each must read as a statement about what was true before
2026-09-22, not as a current rule. The second command proves the isolate-flexibility finding
survived (its session name is still present) and that the R2 row is intact (its "zero egress fees"
phrase untouched). `git diff --stat` should report roughly ten changed lines, five removed and five
added, and nothing else. A much larger number means you restructured something you should not have.
    </human-check>
  </verify>
  <done>
CLAUDE.md's Budget constraint names Workers Paid since 2026-09-22 with R2, Pages and KV inside their
free allowances. The KV and D1 topology rows and the KV-as-artifact-store and Cron-Trigger rows in
What NOT to Use all present their caps as history. The Cron Trigger row keeps its design point and
its 2026-08-29 isolate-flexibility finding, now marked historical, and no longer argues from the CPU
limit. Every R2 row is byte-identical. The Alternatives Considered row is untouched and queued for
the leftover list. One commit, `docs(260922-ldo): ...`, `.claude/CLAUDE.md` only.
  </done>
</task>

<task type="auto">
  <name>Task 3: Close the two CPU-blocked todos and shrink the teams-list todo to one action</name>
  <files>.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md, .planning/todos/pending/played-match-band-and-rp-in-browser.md, .planning/todos/pending/teams-list-live-delta-overlay.md</files>
  <read_first>
- `.planning/todos/pending/played-match-band-and-rp-in-browser.md` (33 lines, read whole)
- `.planning/todos/pending/teams-list-live-delta-overlay.md` (31 lines, read whole)
- `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md`: frontmatter and the first ~20
  lines ONLY. It is 2,489 lines of measurement history. You are prepending a block, not reading or
  editing the body. Do not read past line 20.
  </read_first>
  <action>
Close two todos. For each of `rp-fold-exceeds-worker-cpu-budget.md` and
`played-match-band-and-rp-in-browser.md`:

1. `git mv .planning/todos/pending/<file> .planning/todos/completed/<file>`
2. THEN edit the moved file, inserting a STATUS block immediately after the closing `---` of the
   frontmatter and before the `#` title.

The order matters and so does the check. In this repo an Edit followed by a `git mv` has silently
dropped the edited content from the commit. Move first, edit second, and after you commit run
`git status` and `git show --stat HEAD` to confirm both the rename AND the content change landed in
the same commit. If the content is missing, amend it in before moving on.

The STATUS block, for both files, must say in the file's own voice:

- Dated 2026-09-22 and labelled CLOSED.
- Closed by the Cloudflare account moving to Workers Paid, which raised per-invocation CPU from
  10 ms to 30 s and subrequests from 50 to 10,000. The constraint each todo existed to work around
  is gone.
- No observation and no experiment is owed. `rp-fold-exceeds-worker-cpu-budget` in particular had an
  open ask to tail the first promoted event and record its `outcome` and `cpuTime`. State
  explicitly that this is no longer owed as a gate. If that data turns up on its own it is
  interesting, not required.
- Everything below the block is retained as a measurement record, not as live work. For
  `rp-fold-exceeds-worker-cpu-budget`, name what stays genuinely useful independent of the cap: the
  cold-isolate finding (first-call compilation work dominates and is paid again every tick), and
  the file's own standing rule that bars are pre-registered as within-run arm differences and never
  as absolute `cpuTime`.

Do not edit or delete a single line of either file's existing body.

Shrink the third todo. Rewrite `.planning/todos/pending/teams-list-live-delta-overlay.md` in place.
It stays in `pending`; it is NOT closed. State, dated 2026-09-22:

- The per-event delta-overlay redesign is WITHDRAWN. It was a workaround for the tick's CPU cost and
  the Worker is no longer CPU-constrained.
- The single remaining action is to lower `GLOBAL_REBUILD_INTERVAL_MS` in
  `apps/worker/src/scheduled.ts` toward one minute. That is safe on R2, one Class-A write per
  minute, and R2's free tier is unchanged, so this is the one claim in the file still argued on R2
  write cost rather than on CPU.
- The interval is NOT changed in this task. Leave it exactly as it is in `scheduled.ts`. This todo's
  whole remaining content is that one action, left for a future task.

Delete the "Direction" and "Open points for the plan" sections, since both describe the withdrawn
redesign. Keep the frontmatter and keep the title's statement of the staleness problem, which is
still true.

Commit all five paths (two pending deletions, two completed additions, one pending modification) in
one commit, staged by explicit path.
  </action>
  <verify>
    <automated>cd "$(git rev-parse --show-toplevel)" && ls .planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md .planning/todos/completed/played-match-band-and-rp-in-browser.md && test ! -e .planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md && test ! -e .planning/todos/pending/played-match-band-and-rp-in-browser.md && echo MOVED-OK</automated>
    <automated>cd "$(git rev-parse --show-toplevel)" && grep -c "2026-09-22" .planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md .planning/todos/completed/played-match-band-and-rp-in-browser.md .planning/todos/pending/teams-list-live-delta-overlay.md && grep -c "GLOBAL_REBUILD_INTERVAL_MS" .planning/todos/pending/teams-list-live-delta-overlay.md</automated>
    <automated>cd "$(git rev-parse --show-toplevel)" && git show --stat HEAD && git status --short .planning/todos</automated>
    <automated>cd "$(git rev-parse --show-toplevel)" && git show HEAD --numstat -- .planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md</automated>
    <human-check>
`git show --stat HEAD` must list the two renames AND show a non-zero line delta on each renamed
file. A rename with `0` added lines means the STATUS block did not land in the commit: the
Edit-then-`git mv` hazard fired. Amend the content in rather than opening a second commit.
`git status --short .planning/todos` must be empty afterwards.

Also read the shrunken `teams-list-live-delta-overlay.md` end to end. It must contain exactly one
action and that action must be the interval change, with no trace of the withdrawn overlay design.
And confirm `apps/worker/src/scheduled.ts` is NOT in this commit: the interval itself stays put.
    </human-check>
  </verify>
  <done>
Both CPU-blocked todos are in `.planning/todos/completed/` with a dated 2026-09-22 STATUS block
naming the plan upgrade as the closer, stating no observation or experiment is owed, and keeping
their bodies byte-identical as measurement records. `teams-list-live-delta-overlay.md` stays pending
with the overlay redesign withdrawn and `GLOBAL_REBUILD_INTERVAL_MS` as its single remaining action.
`apps/worker/src/scheduled.ts` is unmodified. One commit, `docs(260922-ldo): ...`, containing both
renames with their content changes, verified with `git show --stat HEAD`.
  </done>
</task>

<task type="auto">
  <name>Task 4: Retire the free-tier limits from the two operations docs and produce the leftover-hit list</name>
  <files>docs/worker-operations.md, docs/publish-budget.md</files>
  <read_first>
Do NOT read either doc whole. Build the hit list first and read only around each hit:

```
cd "$(git rev-parse --show-toplevel)"
grep -nE "10 ms|10ms|subrequest|1,000|100k|free plan|free tier" docs/worker-operations.md
grep -nE "10 ms|10ms|subrequest|1,000|100k|free plan|free tier" docs/publish-budget.md
```

Known shape, so you can budget your reading:

- `docs/worker-operations.md` is 1,275 lines with roughly 30 hits. The sections that present the
  retired limits as current rules are: `## Live folding tier (quick task 260822-wqt)` (~line 326),
  `### How the CPU budget is actually enforced — corrected 2026-08-29` (~line 487),
  `## PRE-SEASON GATE: do not open a live window until the RP fold fits the CPU budget` (~line 586),
  `## Pre-event probe` (~line 751, the usable-subrequests arithmetic around lines 678-679), the
  D1 caps around lines 154, 173 and 764, and the diagnosis rows in `## When something is wrong`
  (~lines 1073-1079).
- `docs/publish-budget.md` is 309 lines. Its retired-limit surface is almost entirely the
  `## Worker runtime budget (D-21/D-23, plan 04-07)` section, lines ~127-255.
  </read_first>
  <action>
Part A, rewrite the two docs.

Work hit by hit. For each hit, decide which of three it is and act accordingly:

- It presents a retired limit as a CURRENT rule. Rewrite it to the paid limits (30 s CPU and 10,000
  subrequests per invocation; 50M D1 row writes per month; 1M KV writes per month), or mark it
  historical with the date 2026-09-22 if the sentence is a record of a past measurement rather than
  a rule.
- It is a dated record of something that was measured or that happened. Leave the number alone and
  make sure the surrounding text cannot be misread as still in force. A dated incident write-up
  usually needs nothing more than a one-line banner at the head of its section.
- It is about R2, or about something unrelated (a browser parse-to-paint figure, a schedule count).
  Leave it completely alone.

Two sections need more than a sentence rewrite:

`## PRE-SEASON GATE: do not open a live window until the RP fold fits the CPU budget` in
`docs/worker-operations.md` is a standing operational prohibition whose entire basis is the 10 ms
budget. The paid upgrade retires it. Rewrite its heading and opening so it reads unambiguously as
LIFTED on 2026-09-22 by the move to Workers Paid, keep the body as the record of why the gate
existed, and make sure nothing below it still reads as a live instruction to keep windows closed.

`### How the CPU budget is actually enforced — corrected 2026-08-29` in the same file is a general
explainer written in the present tense about the free-plan budget. Put a dated banner at its head
stating that the account moved to Workers Paid on 2026-09-22 and the per-invocation CPU limit is now
30 s, and that everything below describes the free-plan regime the project operated under until then.
Keep the isolate-flexibility finding and the "design against the limit, never against the
flexibility" rule intact below the banner. Both are still sound engineering advice at any limit.

Also add a short dated banner near the top of `docs/worker-operations.md` (just after the opening
paragraph, before `## Deploying`) so a reader who lands mid-document has the plan change in view.

In `docs/publish-budget.md`, the `## Worker runtime budget` section's headline finding is that the
per-tick subrequest budget cannot fit an ordinary 3v3 match. That finding is now purely historical.
Mark the section as such with a dated banner, rewrite the sentences that state the old usable-budget
arithmetic as current, and leave the measurement tables intact as the record. Do NOT touch the
payload budget section, the storage-and-write-volume section, the upload-concurrency section, or the
machine-readable json budget block at the end of the file. Those are R2 and page-size concerns and
are unchanged.

Do not delete any measurement, any table, or any dated finding anywhere in either doc.

Part B, the verification grep and the leftover-hit list.

Run exactly this from the repo root. It is scoped by `git ls-files` because an unscoped recursive
grep over this repo takes minutes on the corpus:

```
cd "$(git rev-parse --show-toplevel)"
git ls-files -z \
  | grep -zv "^\.planning/quick/" \
  | grep -zv "^\.planning/debug/" \
  | xargs -0 grep -nE "10 ms|10ms|SUBREQUEST_CAP 50|1,000 writes/day|100k"
```

(`node_modules` is untracked, so `git ls-files` already excludes it. `.planning/quick/` holds this
plan and your SUMMARY, so they are excluded too and cannot pollute the result.)

Then classify EVERY hit and put the classified list in the summary, grouped under these exact
headings:

1. **Historical by construction.** `.planning/phases/**` plan, summary, research, context,
   verification and UAT artifacts, plus `.planning/todos/completed/**`. These are dated snapshots of
   what was true when they were written and are correct as they stand. Give a count and the file
   list, not every line.
2. **Rewritten or banner-marked historical in this task.** `.claude/CLAUDE.md`,
   `docs/worker-operations.md`, `docs/publish-budget.md`,
   `apps/worker/src/subrequestBudget.ts`, `apps/worker/wrangler.toml`, the two closed todos.
3. **R2 or unrelated, deliberately untouched.** Expect `docs/first-paint-measurement.md` here (its
   "under 10 ms" figures are browser parse-to-paint measurements, nothing to do with Worker CPU) and
   any R2 write-cost line.
4. **Still reads as current, left alone because it sits outside the locked scope.** Flag each one
   with its file, line and a one-line description so Jacob can decide. From the survey done at
   planning time, expect at least these, and confirm each is still present:
   - `.claude/CLAUDE.md`, the `## Alternatives Considered` GitHub-Actions-pipeline row (task 2's
     locked-scope carve-out).
   - `apps/worker/src/liveWindows.ts` lines ~124 and ~139, comments citing the CPU budget as the
     reason for a prefilter.
   - `packages/harness/manifests.ts` line ~162 and `packages/harness/manifests.test.ts` line ~204,
     same shape.
   - `apps/worker/test/liveWindows.test.ts` line ~165, same shape.
   - `apps/worker/migrations/0001_algorithm_state.sql` line ~53, citing KV's old daily write cap.
   - `.planning/STATE.md`, whose `stopped_at` and Session Continuity blocks still say the pre-season
     CPU gate is in force. STATE.md belongs to the orchestrator. Do not edit it; just flag it.
   - `docs/worker-operations.md` around line 764, D1's 5,000,000-rows-read-per-day figure, which is
     a daily free-tier cap Jacob did not supply a paid replacement for. Mark it superseded per house
     rule 7 and flag the number for him to confirm.

Every hit must land in exactly one of the four groups. A hit you cannot classify is a finding, not a
footnote: say so plainly.

Commit the two docs by explicit path. Then write SUMMARY.md to this task directory and return its
full text in your final message.
  </action>
  <verify>
    <automated>cd "$(git rev-parse --show-toplevel)" && grep -c "2026-09-22" docs/worker-operations.md docs/publish-budget.md</automated>
    <automated>cd "$(git rev-parse --show-toplevel)" && git diff HEAD~1 --stat -- docs/publish-budget.md && git diff HEAD~1 -- docs/publish-budget.md | grep -cE "^[-+].*budgetMaxBytes"</automated>
    <automated>cd "$(git rev-parse --show-toplevel)" && git ls-files -z | grep -zv "^\.planning/quick/" | grep -zv "^\.planning/debug/" | xargs -0 grep -nE "10 ms|10ms|SUBREQUEST_CAP 50|1,000 writes/day|100k" | wc -l</automated>
    <automated>cd "$(git rev-parse --show-toplevel)" && npx vitest run apps/worker packages/harness</automated>
    <human-check>
The second command must print `0`: no line touching `budgetMaxBytes` changed, proving the
machine-readable json budget block and the R2 payload budget survived untouched.

The third command prints the total hit count. That number is not itself a pass or fail: the pass
condition is that the summary classifies every one of those hits into exactly one of the four
groups, and that group 4 is explicitly enumerated rather than waved at.

The last command re-runs the worker and harness suites after the doc edits. Several harness and
worker tests read repo source files, so a doc edit can move a count. Read the OUTPUT, not the exit
code: the root vitest config sets `passWithNoTests: true`, so a mistyped path prints green having
run nothing.
    </human-check>
  </verify>
  <done>
`docs/worker-operations.md` carries a dated 2026-09-22 banner near its top, its pre-season CPU gate
reads as LIFTED, and its CPU-budget explainer carries a dated banner above an intact
isolate-flexibility finding. `docs/publish-budget.md`'s Worker runtime budget section is marked
historical with its measurement tables intact, and its payload budget, storage and write-volume
sections and json budget block are byte-identical. The repo-wide verification grep has been run from
`git ls-files` and every hit is classified in the summary under one of the four named groups, with
group 4 enumerated file-by-file including the D1 rows-read figure flagged for Jacob. Worker and
harness suites pass. One commit, `docs(260922-ldo): ...`, the two docs only. SUMMARY.md written to
the task directory and returned in full in the final message, uncommitted.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| repo working tree -> git history | A shared checkout with a peer session's dirty files; an over-broad `git add` commits work this task does not own |
| `.env` -> agent transcript | Live TBA and Cloudflare/R2 credentials; a single `Read` puts them in a transcript on disk |
| `SUBREQUEST_CAP` -> the deployed Worker's outbound call volume | The constant is the only in-process ceiling on how many subrequests one tick may issue |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-260922-01 | Information disclosure | `.env` | critical | mitigate | House rule 1 forbids reading it by any means; no task in this plan needs a secret, and no command in any `<verify>` block touches it |
| T-260922-02 | Tampering | shared working tree | high | mitigate | House rule 3: stage by explicit path only; each task's commit names its exact files; task 3 verifies with `git status --short .planning/todos` |
| T-260922-03 | Denial of service | Worker tick outbound calls | medium | accept | Raising the cap 200x removes the in-process ceiling that previously bounded a runaway tick. Accepted because the platform enforces 10,000 per invocation regardless, the deferral machinery stays in place, and `estimateEventSubrequestCost` remains flat in the touched-team count with a test pinning that flatness (task 1 leaves those assertions untouched) |
| T-260922-04 | Repudiation | closed todos | low | mitigate | Task 3 preserves both bodies byte-identical and adds a dated, attributed STATUS block rather than deleting the record |
| T-260922-SC | Tampering | npm/pip/cargo installs | high | accept | This task installs no packages. `pnpm --filter worker run typecheck` and `npx vitest` run already-installed local binaries; no legitimacy gate applies |
</threat_model>

<verification>
- Worker typecheck clean and `npx vitest run apps/worker` green from the REPO ROOT, reporting 20
  test files, after task 1 and again after task 4.
- `apps/worker/wrangler.toml`'s `LIVE_ALGORITHM_IDS` value line byte-identical across the whole task.
- `apps/worker/src/scheduled.ts` unmodified across the whole task.
- Every R2 row in `.claude/CLAUDE.md` and the whole json budget block plus payload/storage sections
  of `docs/publish-budget.md` byte-identical.
- Exactly four commits, in order, each staged by explicit path, each ending with the Co-Authored-By
  line. No `git push`, no deploy, no publish.
- The repo-wide verification grep run from `git ls-files`, with every hit classified into one of the
  four named groups in the summary.
</verification>

<success_criteria>
1. `SUBREQUEST_CAP` is 10000, `SUBREQUEST_RESERVE` is 4, and the module comment states the paid
   limits and 2026-09-22 while keeping the rotation and deferral machinery with a stated reason.
2. Worker tests and typecheck pass, verified by printed output rather than exit code.
3. `.claude/CLAUDE.md` names Workers Paid since 2026-09-22 and its five in-scope rows read as
   history, with the isolate-flexibility finding preserved and marked historical.
4. Both CPU-blocked todos are in `completed/` with dated STATUS blocks stating nothing is owed, and
   `teams-list-live-delta-overlay.md` has exactly one remaining action.
5. Neither operations doc presents the 10 ms budget, the ~41 usable subrequests per tick, or the
   D1/KV daily caps as current; no measurement or table was deleted.
6. The summary lists every leftover grep hit, classified, with group 4 enumerated file-by-file.
7. The summary records that a Worker deploy is OWED and must be run later from a clean tree via
   `npx wrangler deploy`.
</success_criteria>

<output>
Write `.planning/quick/260922-ldo-workers-paid-follow-through-retire-the-f/260922-ldo-SUMMARY.md`
when done, AND return its full text in your final message. Do not commit it — the orchestrator owns
SUMMARY.md, STATE.md and PLAN.md.

The summary must contain, at minimum:
- What changed, per numbered step, with the commit SHA for each.
- The leftover-hit list, grouped under the four headings from task 4.
- A clearly-headed statement that a **Worker deploy is OWED**: this task changed
  `apps/worker/src/subrequestBudget.ts`, which is live code, and nothing is deployed. It must run
  later from a clean tree via `npx wrangler deploy` (not `pnpm --filter worker deploy`).
- Any figure you marked superseded but could not replace, flagged for Jacob.
</output>
