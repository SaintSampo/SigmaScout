---
task: 260922-ldo
title: Workers Paid follow-through — retire the free-plan caps
status: complete
tags: [cloudflare, workers-paid, docs, subrequest-budget, cpu-budget]
key-files:
  created: []
  modified:
    - apps/worker/src/subrequestBudget.ts
    - apps/worker/test/subrequestBudget.test.ts
    - apps/worker/test/liveAlgorithmTier.test.ts
    - apps/worker/wrangler.toml
    - .claude/CLAUDE.md
    - .planning/todos/pending/teams-list-live-delta-overlay.md
    - .planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md (renamed from pending)
    - .planning/todos/completed/played-match-band-and-rp-in-browser.md (renamed from pending)
    - docs/worker-operations.md
    - docs/publish-budget.md
decisions:
  - "SUBREQUEST_CAP raised to 10000 (paid per-invocation limit); SUBREQUEST_RESERVE unchanged at 4"
  - "LIVE_ALGORITHM_IDS value left spr-only — widening it is a separate decision needing its own algorithm version bump"
  - "D1's 5,000,000-rows-read-per-day figure marked superseded but UNCONFIRMED (house rule 7): Jacob gave no paid replacement number"
metrics:
  duration: "~1h10m"
  completed: 2026-09-22
actuals:
  tokens: 47000
  tasks: 4
  commits: 4
---

# Quick Task 260922-ldo: Workers Paid Follow-Through Summary

Retired the free-tier subrequest/CPU/D1/KV limits that the repo argued from before the Cloudflare
account moved to Workers Paid on 2026-09-22, across one code constant, its two dependent test
files, `wrangler.toml`, `.claude/CLAUDE.md`, three todos, and both operations docs — leaving every
R2 write-cost caution and every dated measurement/table byte-identical, and leaving
`LIVE_ALGORITHM_IDS` and `apps/worker/src/scheduled.ts` untouched across the whole task.

## What changed, per step

### Task 1 — `SUBREQUEST_CAP` raised to the paid per-invocation limit
**Commit `94cf5739`** — `feat(260922-ldo): raise SUBREQUEST_CAP to the Workers Paid per-invocation limit`

- `apps/worker/src/subrequestBudget.ts`: `SUBREQUEST_CAP` 50 → 10000. `SUBREQUEST_RESERVE` stays 4
  (its doc comment was already accurate — a tick's fixed costs didn't move). Module header and the
  constant's doc comment rewritten to state the paid limits and 2026-09-22, keep the rotation /
  no-starvation / `tryConsume` deferral machinery with a stated reason (the cap can change again;
  starvation is a correctness property of the rotation itself, not of the cap's size), and mark the
  old KV-write-cap argument for keeping the rotation offset in D1 as historical (KV is 1M
  writes/month now, nowhere near the old 1,000/day cap) while keeping the actual design: the offset
  stays in D1's `event_cursor`, now because it's co-located with the cursor it advances alongside.
- `apps/worker/test/subrequestBudget.test.ts`: the constant-pinning test now asserts `10000` and its
  title says so; every other test in the file (explicit numeric `SubrequestBudget` construction) was
  left alone per the plan's instruction.
- `apps/worker/test/liveAlgorithmTier.test.ts`: only the assertion **message** at the
  `usable`/`estimated` comparison was rewritten to name the paid cap and note the guard is now a
  regression guard against a future per-event cost term, not a live constraint. The
  `estimateEventSubrequestCost` formula assertions and all other tests are untouched.
- `apps/worker/wrangler.toml`: only the comment block above `LIVE_ALGORITHM_IDS` was rewritten to
  record the subrequest argument for the spr-only live tier as retired 2026-09-22, and to say
  widening the tier is a separate decision needing its own algorithm version bump. The
  `LIVE_ALGORITHM_IDS = "spr"` value line itself is byte-identical (verified: 0 added/removed lines
  matching `^LIVE_ALGORITHM_IDS` across the whole task).

Verified: `pnpm --filter worker run typecheck` clean; `npx vitest run apps/worker` from the repo
root — **20 test files, 468 tests, 0 failures** (re-confirmed identically after task 4).

### Task 2 — `.claude/CLAUDE.md`'s five in-scope rows rewritten as history
**Commit `53eee77a`** — `docs(260922-ldo): mark CLAUDE.md's free-plan cap arguments as retired`

Exactly five prose edits, no table restructuring (`git diff --stat`: 5 removed / 5 added lines):

1. Budget constraint bullet — now names Workers Paid since 2026-09-22 with the four paid figures,
   states R2/Pages/KV stay within their free allowances, keeps the TBA rate-limit clause.
2. KV topology row — the 1,000-writes/day cap now reads as the reason the thin-manifest design was
   *originally* chosen, with the paid 1M/month figure alongside; eventual-consistency sentence kept
   verbatim; design conclusion unchanged.
3. D1 topology row — the 42-of-50-subrequests arithmetic now reads as historical (10,000 per
   invocation retires the argument); everything else in the cell (R2's no-batch `get()`, `batch()` +
   `WHERE team_key IN (...)`, R2-primary/KV-thin-manifest/D1-never-browser-reachable, the Phase 4
   D-13 parenthetical) kept intact and byte-identical.
4. "KV as the primary artifact store" (What NOT to Use) — cap marked historical, verdict unchanged,
   "Use Instead" column untouched.
5. "Cron Trigger doing full-season recompute" (What NOT to Use) — the design point (bulk compute
   never belongs in a cron tick) now stands independent of ceiling size rather than resting on the
   10ms figure; the 2026-08-29 isolate-flexibility finding (`worker-tick-exceeds-cpu-budget` session
   name, `cpuTime:38` then killed at `10`) is preserved and marked as measured under the free plan.

Every R2 row is untouched (`zero egress fees` phrase present, count 1). The `## Alternatives
Considered` "GitHub-Actions/local Node pipeline for bulk compute" row still argues from CPU time per
invocation and was **deliberately left alone** — it sits outside the two named tables this step's
scope covers. Carried into the leftover-hit list below (Group 4).

### Task 3 — closed the two CPU-blocked todos, shrank the teams-list todo to one action
**Commit `4b8e97f5`** — `docs(260922-ldo): close the two CPU-blocked todos, shrink the teams-list todo to one action`

- `git mv`'d both `rp-fold-exceeds-worker-cpu-budget.md` and `played-match-band-and-rp-in-browser.md`
  from `todos/pending/` to `todos/completed/` **first**, then edited in the STATUS block (avoiding
  the repo's known Edit-then-`git mv` content-drop hazard). Verified after commit with
  `git show --stat HEAD` (both renames show non-zero line deltas: +8 and +14) and
  `git status --short .planning/todos` (clean) — the content landed in the same commit as the
  rename.
- Each STATUS block: dated 2026-09-22, labelled CLOSED, attributes the closure to the Workers Paid
  move (10 ms→30 s CPU, 50→10,000 subrequests), states explicitly that no observation or experiment
  is owed — including `rp-fold-exceeds-worker-cpu-budget`'s open ask to tail the first promoted
  event and record `outcome`/`cpuTime`, now retired as a gate. Bodies are retained byte-identical as
  measurement records below the block; `rp-fold-exceeds-worker-cpu-budget`'s block names the two
  things that stay useful independent of the cap (the cold-isolate finding, and the file's own
  within-run-arm-difference measurement rule).
- `teams-list-live-delta-overlay.md` stays **pending** (not closed): the per-event delta-overlay
  redesign is withdrawn (it was a CPU workaround), leaving exactly one remaining action — lowering
  `GLOBAL_REBUILD_INTERVAL_MS` toward one minute, argued on R2 write cost (unchanged) rather than
  CPU. The "Direction" and "Open points for the plan" sections (both describing the withdrawn
  design) were deleted; the interval itself was **not** changed.
- `apps/worker/src/scheduled.ts` is confirmed unmodified across the whole task (`git log --name-only`
  for that path between the first and last commit of this task returns nothing).

### Task 4 — retired the free-tier limits from both operations docs; built the leftover-hit list
**Commit `79a63fd9`** — `docs(260922-ldo): mark worker-operations.md and publish-budget.md's free-plan caps as retired`

**`docs/worker-operations.md`** (dated-banner count: 17 occurrences of `2026-09-22`):
- New plan-change banner near the top (after the opening paragraph, before `## Deploying`).
- The **PRE-SEASON GATE** section's heading and opening rewritten to read unambiguously LIFTED
  2026-09-22, pointing at the closed todo; the "Do not open a live window..." imperative sentence
  further down is marked `[LIFTED 2026-09-22 — see banner above]` and now notes the todo is in
  `completed/`. The pre-existing 2026-09-21 partial-lift note and the 2026-09-15 "gate STAYS CLOSED"
  re-measurement are kept as history under the new master banner rather than rewritten line by line.
- `### How the CPU budget is actually enforced — corrected 2026-08-29` gets a dated banner stating
  the account is now on Workers Paid (30 s CPU); the isolate-flexibility finding and the "design
  against the limit, never against the flexibility" rule are kept intact below it, unedited.
- Live-folding-tier "Why" paragraph, the D1 write-cap seeding guidance (three separate places: the
  quick-task-260912-ivg row-write note, the "Row-write budget" paragraph, and the standalone "The D1
  write cap" paragraph), the pre-event probe's `1 + 2*6 = 13` subrequest arithmetic, and the "When
  something is wrong" troubleshooting table's two rows citing the subrequest cap and the `10 ms`
  CPU budget as live diagnostic reasoning — all reframed against the paid limits without deleting
  any number.
- `### First real run — 2026-09-12` (the CPU measurement that produced the mid-teens/28 ms p90
  finding) gets a dated banner noting the todo it fed is now closed; its "Tracked as its own item"
  closing line now points at the completed path.
- **D1's 5,000,000-rows-read-per-day figure is marked "Superseded 2026-09-22 — figure
  unconfirmed"** rather than replaced with a guessed number (house rule 7: Jacob's four confirmed
  paid figures — 30 s CPU, 10,000 subrequests, 50M D1 row writes/month, 1M KV writes/month — do not
  include a rows-READ figure). **This needs Jacob's confirmation** before the discipline this
  section describes (pinning `teams=`/`event=` on every probe run) can be treated as unnecessary.

**`docs/publish-budget.md`** (3 occurrences of `2026-09-22`):
- `## Worker runtime budget (D-21/D-23, plan 04-07)` gets a dated historical banner at its head; the
  headline finding paragraph and the "What would have to change" lever list are reframed as
  historical (past tense, "measured on the free plan") without deleting any measurement.
- **Untouched, verified**: `git diff -- docs/publish-budget.md | grep -c budgetMaxBytes` → `0`. The
  payload budget table, upload-concurrency section, storage-and-write-volume section, and the
  machine-readable json budget block at the end of the file are byte-identical — those are R2/page-
  size concerns and R2's free tier is unchanged.

Verified after this step: `npx vitest run apps/worker packages/harness` from the repo root — **66
test files, 1594 tests, 0 failures**. `npx vitest run apps/worker` alone — **20 test files, 468
tests, 0 failures** (matches task 1's count exactly).

## The leftover-hit list

Repo-wide verification grep, run exactly as specified from `git ls-files` (excluding
`.planning/quick/` and `.planning/debug/`):

```
git ls-files -z | grep -zv "^\.planning/quick/" | grep -zv "^\.planning/debug/" \
  | xargs -0 grep -nE "10 ms|10ms|SUBREQUEST_CAP 50|1,000 writes/day|100k"
```

**254 hits across 67 files.** Every hit is classified below into exactly one of the four groups.

### 1. Historical by construction — 173 hits, 49 files

`.planning/phases/**` plan, summary, research, context, verification, UAT, validation, discussion-
log and plan-outline artifacts (36 files), plus `.planning/todos/completed/**` entries not touched
by this task (7 files: `keep-preseason-week-0-out-of-official-calculations.md`,
`live-match-updates-swing-and-lossy-merge.md`, `pages-deploy-can-poison-asset-cache.md`,
`swing-score-audit.md`, `vpr-retirement-make-features-algorithm-agnostic.md`,
`worker-state-shape-unexercised-since-seed.md`, `worker-tick-exceeds-cpu-budget.md`). These are
dated snapshots of what was true when written and are correct as they stand.

**Added to this group, same character but outside its two literal directory patterns** (flagged
rather than silently folded in): `.planning/research/ARCHITECTURE.md`, `PITFALLS.md`, `STACK.md`,
`SUMMARY.md` (4 files — pre-build research docs, never revised, same "dated record" character as a
phase's own `RESEARCH.md`); `.planning/WINDOWS.md` (1 file — the one matching entry is a defect
already marked `RESOLVED 2026-08-29` / `fixed`); `.planning/v1.0-MILESTONE-AUDIT.md` (1 file — a
dated audit of an already-sealed, fully-complete milestone).

Full file list omitted here for length (49 files, counts range 1–20 hits each); every one of them
is a completed-phase or completed-todo artifact never revised in place by GSD convention.

### 2. Rewritten or banner-marked historical in this task — 58 hits, 8 files

- `.claude/CLAUDE.md` — 2 of its 3 hits (the KV row, the Cron Trigger row; both rewritten in task 2)
- `docs/worker-operations.md` — 24 hits (whole file rewritten/banner-marked in task 4)
- `docs/publish-budget.md` — 4 hits (whole file rewritten/banner-marked in task 4)
- `apps/worker/src/subrequestBudget.ts` — 1 hit (inside the task-1 historical parenthetical)
- `apps/worker/wrangler.toml` — 1 hit (inside the task-1 historical comment rewrite)
- `.planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md` — 24 hits (closed + STATUS block, task 3)
- `.planning/todos/completed/played-match-band-and-rp-in-browser.md` — 1 hit (closed + STATUS block, task 3)
- `.planning/todos/pending/teams-list-live-delta-overlay.md` — 1 hit (task 3's shrink-to-one-action rewrite; not one of task 4's own literal list of six paths, but rewritten this session, so grouped here rather than left unexplained)

### 3. R2 or unrelated, deliberately untouched — 3 hits, 1 file

`docs/first-paint-measurement.md` — all 3 hits are browser parse-to-paint-time measurements
("under 10 ms" as a rendering benchmark), nothing to do with Worker CPU. Exactly as the plan
predicted.

### 4. Still reads as current, left alone because it sits outside the locked scope — 20 hits, 10 files

Every item the plan told me to expect, confirmed present, plus two new findings from the survey:

- **`.claude/CLAUDE.md`**, the `## Alternatives Considered` "GitHub-Actions/local Node pipeline for
  bulk compute" row (1 hit, line 130) — still argues "will always fit in 10ms CPU time per
  invocation." Locked-scope carve-out named explicitly in task 2.
- **`apps/worker/src/liveWindows.ts`** lines 124 and 139 (2 hits) — comments citing the CPU budget
  as the reason for a validation prefilter.
- **`packages/harness/manifests.ts`** line 162 (1 hit) and **`packages/harness/manifests.test.ts`**
  line 204 (1 hit) — same shape, citing a "10ms CPU budget."
- **`apps/worker/test/liveWindows.test.ts`** line 165 (1 hit) — same shape.
- **`apps/worker/migrations/0001_algorithm_state.sql`** line 53 (1 hit) — citing KV's old
  1,000-writes/day cap as the reason for batching per-event-per-tick writes.
- **`.planning/STATE.md`** (7 hits) — its `stopped_at` and Session Continuity blocks still say the
  pre-season CPU gate is in force. STATE.md belongs to the orchestrator; not edited, only flagged.
- **NEW — `.planning/ROADMAP.md`** (3 hits, lines 227, 639, 660) and **`.planning/REQUIREMENTS.md`**
  (2 hits, lines 25–26) — both are living project-tracking documents (not frozen phase artifacts
  the way a `PLAN.md`/`SUMMARY.md` is), structurally the same kind of document as `STATE.md`, and
  both read as current in places (REQUIREMENTS.md's DATA-05 checkbox literally defines the target as
  "Workers 10ms CPU per invocation"; ROADMAP.md's F5 row says a fix "fits the 10ms CPU budget").
  Grouped here alongside STATE.md rather than folded into Group 1, since neither is a
  never-revised historical artifact by convention.
- **NEW — `apps/worker/test/liveAlgorithmTier.test.ts`** header comment, lines 19–22 (1 hit) — was
  **not** touched by task 1 (whose `<read_first>` scoped only lines 425–485, the three budget
  assertions). The header still says "WHAT STILL CONSTRAINS THE LIVE TIER IS CPU, NOT SUBREQUESTS...
  against a 10 ms budget" and cites
  `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md` — a path that no longer exists
  (that todo moved to `completed/` in task 3). This is a genuine drift the survey at planning time
  did not name; worth a follow-up quick task or todo to fix the stale path and the retired-budget
  framing.

## Figures marked superseded but unconfirmed (house rule 7)

One figure, flagged for Jacob rather than guessed:

- **D1 rows-read-per-day, `docs/worker-operations.md`'s "D1 ROW-READ CAP" note.** The free plan's
  5,000,000-rows-read-per-day figure is marked `Superseded 2026-09-22 — figure unconfirmed` in
  place. Jacob's four supplied paid figures (30 s CPU, 10,000 subrequests/invocation, 50M D1 row
  writes/month, 1M KV writes/month) do not include a rows-READ number for D1 at any grain. The
  `teams=`/`event=`-pinning discipline that section describes should not be treated as unnecessary
  until this is confirmed.

## Worker deploy is OWED

**This task changed `apps/worker/src/subrequestBudget.ts`, which is live code, and nothing was
deployed.** No network action was taken in this task (house rule 2: no `wrangler deploy`, no
publish, no `git push`). The deploy must run later, from a clean tree, via:

```bash
cd apps/worker
npx wrangler deploy
```

**Not** `pnpm --filter worker deploy` — that hits pnpm's own built-in `deploy` and deploys nothing
(a known trap recorded in project memory). Confirm afterwards with
`npx wrangler deployments list` and that the deploy output lists the three bindings (`MANIFEST`,
`DB`, `ARTIFACTS`) and `schedule: * * * * *`, per `docs/worker-operations.md`'s "Deploying" section.

Until that deploy runs, the deployed Worker is still enforcing `SUBREQUEST_CAP = 50` in practice
(the tracked source says 10000, but the running Worker was built before this change) — this is a
correctness gap between tracked config and deployed behavior, not a bug in this task's commits.

## Deviations from Plan

None — all four tasks executed as scoped. Two items are worth naming as **additions beyond the
plan's own survey**, both auto-fixed under the shared-process rule for what deviation each is:

1. **[Rule 2 — missing coverage]** The PRE-SEASON GATE section in `docs/worker-operations.md`
   contained a direct, unambiguous "do not open a live window... until [todo] is closed" imperative
   the plan's task description didn't call out by exact wording. Left as written it would have
   continued to read as a live instruction after the todo closed. Neutralized inline in addition to
   the section-level banner the plan asked for.
2. **[Rule 2 — missing coverage]** `apps/worker/test/liveAlgorithmTier.test.ts`'s header comment
   (lines 1–28) sat outside task 1's locked `<read_first>` scope (lines 425–485) and was correctly
   left untouched per the plan's own boundary — but the survey found it during task 4's leftover-hit
   pass and it is now recorded in Group 4 above as a genuine finding, including the stale
   `todos/pending/` path reference.

Both are documented as leftover-hit-list Group 4 entries rather than fixed outside the plan's
locked file lists, since neither was in any task's named `<files>` list and this plan's house rules
lock scope to exactly what each task names.

## Self-Check

```
FOUND: apps/worker/src/subrequestBudget.ts
FOUND: apps/worker/test/subrequestBudget.test.ts
FOUND: apps/worker/test/liveAlgorithmTier.test.ts
FOUND: apps/worker/wrangler.toml
FOUND: .claude/CLAUDE.md
FOUND: .planning/todos/pending/teams-list-live-delta-overlay.md
FOUND: .planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md
FOUND: .planning/todos/completed/played-match-band-and-rp-in-browser.md
FOUND: docs/worker-operations.md
FOUND: docs/publish-budget.md
FOUND: 94cf5739 (task 1 commit)
FOUND: 53eee77a (task 2 commit)
FOUND: 4b8e97f5 (task 3 commit)
FOUND: 79a63fd9 (task 4 commit)
```

## Self-Check: PASSED

## Commits

- `94cf5739` — `feat(260922-ldo): raise SUBREQUEST_CAP to the Workers Paid per-invocation limit`
- `53eee77a` — `docs(260922-ldo): mark CLAUDE.md's free-plan cap arguments as retired`
- `4b8e97f5` — `docs(260922-ldo): close the two CPU-blocked todos, shrink the teams-list todo to one action`
- `79a63fd9` — `docs(260922-ldo): mark worker-operations.md and publish-budget.md's free-plan caps as retired`

All four staged by explicit path only (never `git add -A`/`git add .`/`git commit -a`); the shared
checkout's unrelated dirty files (`.planning/sketches/MANIFEST.md`,
`.planning/sketches/020-locks-page-reimagined/`) were never staged or touched.
