---
phase: quick-261005-kzs
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - packages/harness/publish.ts
  - apps/web/src/lib/api/preSchedule.ts
  - docs/simulation-architecture.md
  - docs/publish-budget.md
  - .planning/todos/pending/presim-all-seasons-handoff.md
autonomous: true
requirements: [presim-all-seasons-handoff-step-3]

estimate:
  tokens: 20000
  raw_tokens: 40000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "`pnpm publish:seasons` passes `--presim-from-season 2016` explicitly, so the next real publish builds pre-schedule sidecars for every published season (2016 to 2020, 2022 to 2026)"
    - "The presim drift tripwire and the rest of packages/harness/publish.test.ts pass with the new value"
    - "DEFAULT_PRESCHEDULE_FROM_SEASON is unchanged unless publish.test.ts demands otherwise, and its comment no longer claims to be the only place the cutoff appears"
    - "None of the three named comment/doc locations still says pre-schedule coverage starts at 2026"
    - "PRESIM_SCHEDULE_COUNT is still 1000 and no algorithm version string changed"
    - "The handoff note records the 2026-10-05 all-seasons dry run figures and that steps 1 to 3 are done, and it stays in .planning/todos/pending/"
  artifacts:
    - path: "package.json"
      provides: "publish:seasons script with --presim-from-season 2016"
      contains: "--presim-from-season 2016"
    - path: "packages/harness/publish.ts"
      provides: "Corrected comment above DEFAULT_PRESCHEDULE_FROM_SEASON (fallback only)"
      contains: "DEFAULT_PRESCHEDULE_FROM_SEASON"
    - path: "apps/web/src/lib/api/preSchedule.ts"
      provides: "Header comment naming the 2016 cutoff that publish:seasons passes"
    - path: "docs/simulation-architecture.md"
      provides: "Section 3 client read path no longer names a 2026 coverage floor"
    - path: "docs/publish-budget.md"
      provides: "Gated-by bullet naming 2016 and the offseason exclusion; JSON budget block untouched"
    - path: ".planning/todos/pending/presim-all-seasons-handoff.md"
      provides: "Dated 2026-10-05 section with the measured dry run figures"
      contains: "9,822.6"
  key_links:
    - from: "package.json scripts.publish:seasons"
      to: "packages/harness/publish.ts parseArgs presim-from-season -> publishSeasons preScheduleFromSeason -> `season >= preScheduleFromSeason` gate"
      via: "CLI flag parsed at publish.ts ~line 2986, consumed at ~line 2029"
      pattern: "--presim-from-season\\s+2016"
    - from: "packages/harness/publish.test.ts presim-flag drift tripwire"
      to: "package.json scripts.publish:seasons"
      via: "readFileSync of package.json, asserts flag present and no later than latest published season"
      pattern: "presim-flag drift tripwire"
---

<objective>
Turn on the pre-schedule ("Before schedule release") simulation sidecars for every season. This is
step 3 of `.planning/todos/pending/presim-all-seasons-handoff.md`, approved by Jacob on 2026-10-05
after the all-seasons dry run was measured on current code (2 h 44 min).

Purpose: the next `pnpm publish:seasons` run (step 4, run later by the orchestrator from the main
session, NOT by this plan) then bakes a presim sidecar for every RP-eligible, non-offseason event in
every published season, not only 2026.

Output: one flag value changed in `package.json`; one stale code comment and three stale
coverage statements corrected; the measurement recorded in the handoff note. Three commits, each by
explicit pathspec. Nothing is published, deployed, or pushed.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/todos/pending/presim-all-seasons-handoff.md

Scouted facts (verified by the planner against HEAD a4345daf on 2026-10-05):

- `package.json` line 29, script `publish:seasons`, currently ends
  `--include-offseason --presim-from-season <year> --write-budget`, where the year is the 2026 value.
- `packages/harness/publish.ts` lines 162 to 166: a JSDoc comment then
  `const DEFAULT_PRESCHEDULE_FROM_SEASON = 2026;`. The comment's second sentence claims the default
  is the sole location of the cutoff. That is false: `package.json` passes the flag explicitly and
  the drift tripwire in `publish.test.ts` asserts it. The default is consumed at line ~1920
  (`options.preScheduleFromSeason ?? DEFAULT_PRESCHEDULE_FROM_SEASON`) and gates at line ~2029.
- `packages/harness/publish.test.ts` line ~4840, "the presim-flag drift tripwire", reads
  `package.json` and asserts only that `--presim-from-season` is present, is an integer, and is no
  later than the latest season in `--seasons`. It does NOT assert the value of
  `DEFAULT_PRESCHEDULE_FROM_SEASON`. No other test in the repo asserts that constant's value. Other
  tests in the file pass `preScheduleFromSeason` explicitly (2024, 2027) or rely on the 2026 default
  with 2026 fixtures, so leaving the default at 2026 is expected to keep them green.
- `scripts/publishLiveWindows.test.ts` also reads the `publish:seasons` script, but only its
  `--seasons` list.
- Offseason events already get no sidecar: `packages/harness/publish.ts` ~line 1384 to 1387 logs
  "offseason events get no pre schedule sidecar" (quick 261004-uyc), and `publish.test.ts` line
  ~4249 asserts it.
- The web client has no season gate on the sidecar fetch (`apps/web/src/routes/event.$eventKey.tsx`
  ~line 189 uses `preScheduleQueryOptions` for any event; a 404 returns `null`). No Methodology or
  UI copy names a 2026 coverage floor. No test pins any of the comment/doc phrases being edited.
- `docs/simulation-architecture.md` line ~290 ("The 09-10 remediation changed the argument to
  `2026` ...") and line ~296 ("resolves ... on a 2026 event") are historical narrative that stays
  true. Do NOT edit them.
- `docs/publish-budget.md` line ~549 is inside the machine-written JSON budget block and also
  contains the old flag value. Do NOT edit it; the next `--write-budget` publish rewrites it.
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Flip publish:seasons to --presim-from-season 2016 and prove the tripwire accepts it</name>
  <files>package.json (and packages/harness/publish.ts ONLY if the test run in this task demands the default move)</files>
  <precondition>`git status --porcelain -- package.json packages/harness/publish.ts apps/web/src/lib/api/preSchedule.ts docs/simulation-architecture.md docs/publish-budget.md .planning/todos/pending/presim-all-seasons-handoff.md` prints nothing. If any path is already dirty, another session holds it: stop and report, do not edit over it.</precondition>
  <read_first>package.json (lines 25 to 33), packages/harness/publish.test.ts (lines 4834 to 4876)</read_first>
  <action>
    1. Baseline: from the repo root run `npx vitest run packages/harness/publish.test.ts scripts/publishLiveWindows.test.ts`
       BEFORE editing and note the pass/fail counts from the output. Do not wrap it in `timeout` and
       do not run it through `pnpm`; judge it by the printed "Test Files" and "Tests" lines, not by
       the exit code. If the baseline already has failures, record their names; they are not this
       task's to fix, and the post-change run must show no NEW failures.
    2. In `package.json` line 29 (`publish:seasons`), change only the year that follows
       `--presim-from-season` to `2016`. Keep the flag and its explicit value (the tripwire requires
       an explicit year). Leave `--seasons 2016-2020,2022-2026`, `--include-offseason`, and
       `--write-budget` exactly as they are. Touch no other script. This implements handoff step 3
       as approved by Jacob on 2026-10-05.
    3. Re-run the same vitest command. Expected: every test that passed at baseline still passes,
       including "the presim-flag drift tripwire".
    4. Decide on `DEFAULT_PRESCHEDULE_FROM_SEASON`: if the post-change run is green (relative to
       baseline), leave the constant at 2026 and record in the SUMMARY "left at 2026: publish.test.ts
       does not assert the fallback's value". Only if a failure message explicitly requires the
       default to match the script's value, change the constant to 2016 in the same commit and
       record which test asked. Do not change `PRESIM_SCHEDULE_COUNT` or any algorithm version.
    5. Commit by explicit pathspec only (another session may share this checkout; never
       `git add -A`, never `git stash`):
       `git add package.json && git commit -m "feat(quick-261005-kzs): pre-schedule simulation sidecars for every season (presim-from-season 2016)" -- package.json`
       (add `packages/harness/publish.ts` to both the add and the pathspec only if step 4 moved the
       constant). Then `git show --stat HEAD` must list only the intended path(s), and
       `git status --short -- package.json` must print nothing.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout && node -e "const s=require('./package.json').scripts['publish:seasons'];const m=/--presim-from-season\s+(\d+)/.exec(s);if(!m||m[1]!=='2016'||!s.includes('--write-budget')||!s.includes('--seasons 2016-2020,2022-2026')||!s.includes('--include-offseason')){console.error('BAD: '+s);process.exit(1)}console.log('presim-from-season='+m[1])" && grep -c "const PRESIM_SCHEDULE_COUNT = 1000;" packages/harness/publish.ts && npx vitest run packages/harness/publish.test.ts scripts/publishLiveWindows.test.ts</automated>
  </verify>
  <done>`package.json`'s `publish:seasons` passes `--presim-from-season 2016` with the season list, offseason flag and `--write-budget` unchanged; the vitest output shows both files passing with no failures beyond the recorded baseline (the drift tripwire among the passes); `PRESIM_SCHEDULE_COUNT` grep prints 1; the commit touches only `package.json` (plus `publish.ts` only if the test demanded it).</done>
</task>

<task type="auto">
  <name>Task 2: Correct the fallback comment and the three statements that coverage starts at 2026</name>
  <files>packages/harness/publish.ts, apps/web/src/lib/api/preSchedule.ts, docs/simulation-architecture.md, docs/publish-budget.md</files>
  <read_first>packages/harness/publish.ts (lines 158 to 175), apps/web/src/lib/api/preSchedule.ts (lines 1 to 25), docs/simulation-architecture.md (lines 212 to 220), docs/publish-budget.md (lines 58 to 73)</read_first>
  <action>
    1. Baseline typechecks BEFORE editing, from the repo root: `npx tsc --noEmit` and
       `npx tsc --noEmit -p apps/web/tsconfig.json`. Record each error count (0 expected for root; if
       the web run shows errors in route files, check that `apps/web/src/routeTree.gen.ts` exists; a
       missing generated route tree causes about 45 unrelated errors). The post-edit counts must not
       rise.
    2. `packages/harness/publish.ts`, the JSDoc above `DEFAULT_PRESCHEDULE_FROM_SEASON` (lines ~162
       to 165): rewrite it so it states only true things. Required content: this is the fallback
       first season for pre-schedule sidecars, used only when a run omits `--presim-from-season`;
       `pnpm publish:seasons` always passes the flag with an explicit year (2016, so every published
       season, since quick task 261005-kzs); the presim-flag drift tripwire in `publish.test.ts`
       fails if that flag is deleted or set later than the latest season the script publishes. Drop
       the sentence claiming the default is the sole location of the cutoff. If Task 1 left the
       constant at 2026, the comment may say plainly that the fallback stays 2026 and therefore
       differs from the script. Comment-only change unless Task 1 moved the value. Do not touch the
       `PRESIM_SCHEDULE_COUNT` comment or value.
    3. `apps/web/src/lib/api/preSchedule.ts` header comment, lines ~13 to 14: the parenthetical after
       `--presim-from-season` currently names a default year. Replace it with a statement that
       `pnpm publish:seasons` passes 2016, so the covered set is every published season. Keep the
       surrounding sentence (the list of permanent 404 cases) intact and the ` * ` comment layout.
       Comment-only change.
    4. `docs/simulation-architecture.md` section 3, "Client read path" paragraph, line ~217: the
       first item in the parenthetical list of permanent no-sidecar states names a year floor.
       Replace it with "a season below the `--presim-from-season` cutoff (2016 in
       `pnpm publish:seasons`)" or equivalent plain wording; keep the other items (offseason event,
       cold-start first event, RP-less algorithm). Reflow the paragraph to the file's existing wrap
       width. Leave lines ~290 and ~296 (history) alone.
    5. `docs/publish-budget.md`, the bullet starting "**Gated by `--presim-from-season`**" (line
       ~70): change the parenthetical so it says `pnpm publish:seasons` passes 2016 (every published
       season, since quick task 261005-kzs), and add one short sentence that offseason events get no
       sidecar even though they are RP-eligible (explicit gate, quick task 261004-uyc). Keep the
       `--write-budget` sentence. Do NOT edit anything inside the machine-written JSON budget block
       near the end of the file.
    6. Prose rules for all four edits: plain sentences, no em dash characters in any added line.
    7. Re-run both typechecks and `npx vitest run packages/harness/publish.test.ts packages/harness/payloadBudget.test.ts`
       from the repo root (verify by the printed counts; no `timeout`, no `pnpm` wrapper).
    8. Commit by explicit pathspec:
       `git add packages/harness/publish.ts apps/web/src/lib/api/preSchedule.ts docs/simulation-architecture.md docs/publish-budget.md && git commit -m "docs(quick-261005-kzs): pre-schedule coverage statements name the 2016 cutoff" -- packages/harness/publish.ts apps/web/src/lib/api/preSchedule.ts docs/simulation-architecture.md docs/publish-budget.md`
       Then `git show --stat HEAD` must list exactly those four paths and
       `git status --short --` on them must print nothing.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout && test "$(grep -c 'only place the cutoff appears' packages/harness/publish.ts)" = 0 && test "$(grep -c 'defaulting to 2026' apps/web/src/lib/api/preSchedule.ts)" = 0 && test "$(grep -c 'pre-2026 season' docs/simulation-architecture.md)" = 0 && test "$(grep -c 'passes 2026' docs/publish-budget.md)" = 0 && awk '/^## The `presim` pre-schedule sidecar/,/^## The district artifact/' docs/publish-budget.md | grep -c 2016 && awk '/^## The `presim` pre-schedule sidecar/,/^## The district artifact/' docs/publish-budget.md | grep -ci offseason && test "$(git diff HEAD~1 HEAD -- docs/publish-budget.md | grep -c '\"run\":')" = 0 && git diff -U0 HEAD~1 HEAD -- packages/harness/publish.ts apps/web/src/lib/api/preSchedule.ts docs/simulation-architecture.md docs/publish-budget.md | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const n=s.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')&&l.includes('\u2014')).length;console.log('emdash-added='+n);process.exit(n?1:0)})" && npx tsc --noEmit && npx tsc --noEmit -p apps/web/tsconfig.json && npx vitest run packages/harness/publish.test.ts packages/harness/payloadBudget.test.ts</automated>
  </verify>
  <done>The four old phrases each grep to 0 in their files; the publish-budget presim section names 2016 and the offseason exclusion; the JSON budget block has no diff; no added line contains an em dash; root and web typechecks show no new errors versus the step 1 baseline; publish.test.ts and payloadBudget.test.ts pass by printed output; the commit contains exactly the four paths.</done>
</task>

<task type="auto">
  <name>Task 3: Record the 2026-10-05 measurement and steps 1 to 3 done in the handoff note</name>
  <files>.planning/todos/pending/presim-all-seasons-handoff.md</files>
  <read_first>.planning/todos/pending/presim-all-seasons-handoff.md (whole file, 173 lines)</read_first>
  <action>
    Insert one new dated section directly after "## The goal" (before "## Read this first: the
    timings below are stale"), headed "## 2026-10-05: steps 1 to 3 done". Do not rewrite or delete
    the older sections; they stay as the record. Do not move the file out of `pending/`: steps 4
    (publish) and 5 (record the browser result) are still open. Wrap at the file's existing width
    (about 100 columns), plain sentences, no em dash characters. The section must state:

    - Step 1 done. The all-seasons dry run ran on current code: commit 5e047e98, command
      `npx tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2026 --include-offseason --presim-from-season 2016 --dry-run --skip-state`,
      started 01:12 and finished 03:56 on 2026-10-05. Log: `reports/presim-allyears/dryrun-20261005.out.log`
      (local, gitignored).
    - Measured figures, as a short table or list: total 9,822.6 s (2 h 44 min); EPA sidecars
      3,982 s and SPR sidecars 5,046 s, each summed over seasons; 2026 alone EPA sidecars 518.4 s
      and SPR 534.1 s; 3,336 presim sidecars, median 7,792 bytes, p95 19,125, max 42,582;
      108,661 objects and 4,192,395,808 bytes in the whole publish.
    - Comparison: the earlier all-seasons dry run at bd040e70 (before both speed fixes) took 7.85 h;
      a 2026-only full publish took about 31 minutes (1,871 s on 2026-09-19). The dry run uploads
      nothing, so the real publish's wall clock also includes R2 upload time this run did not
      measure.
    - The offseason worry in "Read this first" did not happen: offseason events get no sidecar (the
      explicit gate added by quick 261004-uyc), so the sidecar count did not grow by half again.
    - Step 2 done: Jacob approved turning it on, 2026-10-05, after this measurement.
    - Step 3 done in quick task 261005-kzs: `package.json`'s `publish:seasons` now passes
      `--presim-from-season 2016`; state what Task 1 decided for `DEFAULT_PRESCHEDULE_FROM_SEASON`
      (expected: left at 2026 because `publish.test.ts` does not assert it); the comment above it,
      the `preSchedule.ts` header, `docs/simulation-architecture.md` section 3, and the
      `docs/publish-budget.md` bullet were corrected.
    - Still open: the live site serves 2026-only sidecars until step 4's publish runs (main session,
      Jacob's go-ahead in the moment). Step 5 is unchanged.

    Commit by explicit pathspec:
    `git add .planning/todos/pending/presim-all-seasons-handoff.md && git commit -m "docs(quick-261005-kzs): handoff records the all-seasons dry run and steps 1 to 3 done" -- .planning/todos/pending/presim-all-seasons-handoff.md`
    Then `git show --stat HEAD` must list only that path.
  </action>
  <verify>
    <automated>cd C:/Users/Jacob/Documents/GitHub/SigmaScout && f=.planning/todos/pending/presim-all-seasons-handoff.md && test -f "$f" && test ! -e .planning/todos/completed/presim-all-seasons-handoff.md && grep -c "## 2026-10-05: steps 1 to 3 done" "$f" && grep -c "9,822.6" "$f" && grep -c "3,336" "$f" && grep -c "dryrun-20261005.out.log" "$f" && grep -c "5e047e98" "$f" && grep -c "261005-kzs" "$f" && git diff -U0 HEAD~1 HEAD -- "$f" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const n=s.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')&&l.includes('\u2014')).length;console.log('emdash-added='+n);process.exit(n?1:0)})"</automated>
  </verify>
  <done>The handoff note, still under `pending/`, carries a "2026-10-05: steps 1 to 3 done" section with every measured figure listed in this task, the approval, the step 3 changes, and the open steps 4 and 5; no added line contains an em dash; the commit touches only that file.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| shared git checkout | Other Claude sessions may edit and commit in the same working tree concurrently |
| offline publisher -> live R2 | `pnpm publish:seasons` writes the live site's data; this plan changes what the NEXT run writes but runs nothing |
| local `.env` | Holds the TBA key and R2 token pair; this plan never needs it |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-kzs-01 | Tampering | shared checkout commits | medium | mitigate | Task 1 precondition refuses dirty target paths; every commit uses `git add <paths> && git commit -- <paths>`; `git show --stat HEAD` confirms only intended paths; no `git add -A`, no `git stash` |
| T-kzs-02 | Denial of service | live data / R2 write volume | medium | mitigate | No publish, deploy, push, rebaseline, or dry run in this plan; step 4 stays with the orchestrator and Jacob's in-the-moment go-ahead |
| T-kzs-03 | Information disclosure | `.env` secrets | high | mitigate | No task reads, cats, or sources `.env`; the dry run command is quoted only as recorded text in the handoff note, never executed |
| T-kzs-04 | Tampering | silent presim switch-off | low | mitigate | The existing presim-flag drift tripwire in publish.test.ts runs in Task 1 and Task 2 verify; the flag stays explicit |
| T-kzs-05 | Repudiation | machine-written budget block | low | mitigate | Task 2 verify asserts the JSON budget block's `"run":` line has no diff |
</threat_model>

<verification>
- `node -e` check: `publish:seasons` has `--presim-from-season 2016`, season list, `--include-offseason` and `--write-budget` intact.
- `npx vitest run packages/harness/publish.test.ts scripts/publishLiveWindows.test.ts packages/harness/payloadBudget.test.ts` from the repo root: all pass by printed output (no new failures versus the Task 1 baseline).
- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: no new errors versus the Task 2 baseline.
- `grep -c "const PRESIM_SCHEDULE_COUNT = 1000;" packages/harness/publish.ts` prints 1; no file under `packages/core` or `apps/worker` is in any of the three commits.
- Three commits, each listing only its own paths in `git show --stat`.
- Nothing pushed: `git log origin/main..main --oneline` still includes the three new commits (they are local only).
</verification>

<success_criteria>
- The next `pnpm publish:seasons` would bake presim sidecars for every published season.
- All four stale statements corrected; history paragraphs and the JSON budget block untouched.
- Handoff note records the measurement and stays pending.
- No algorithm version, no `PRESIM_SCHEDULE_COUNT`, no publish, no deploy, no push.
</success_criteria>

<output>
Create `.planning/quick/261005-kzs-pre-schedule-simulation-on-for-every-sea/261005-kzs-SUMMARY.md` when done.
It must state the `DEFAULT_PRESCHEDULE_FROM_SEASON` decision and why, the baseline and final test and
typecheck counts, and the three commit hashes. If the Write tool is blocked for SUMMARY.md, return
the SUMMARY text to the orchestrator instead; do not route around the block with a Bash heredoc.
</output>
