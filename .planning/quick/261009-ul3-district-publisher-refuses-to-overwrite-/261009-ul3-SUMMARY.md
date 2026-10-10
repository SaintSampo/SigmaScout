---
phase: quick-261009-ul3
plan: 01
subsystem: districts
tags: [districts, publisher, r2, guard, live-facts, allow-regress, check-live]
status: complete
requirements_completed: [261009-ul3]
requires:
  - 261009-r9x (leftover f: an offline republish from an older corpus takes back live facts)
  - 261009-tx6 (the Worker side repair of a replaced artifact, CONTEXT D7)
provides:
  - packages/harness/r2Client.ts getObjectIfExists (a signed GET on the shared retry loop, null for a 404)
  - scripts/districtPublishGuard.ts (compareDistrictArtifacts, formatDistrictRegression, guardLivePublish, DistrictPublishRefusedError, PublishedReader)
  - scripts/publishDistricts.ts flags --allow-regress and --check-live, seams readPublished and writeObject on CliOptions
affects:
  - pnpm publish:districts (reads R2 twice before the first upload, can exit 1 with nothing uploaded)
  - docs/worker-operations.md (one new subsection at the end of "The district refresh pass")
tech-stack:
  added: []
  patterns:
    - a guard that only reads and refuses, in a pure module with an injected reader and logger
    - compose and bake every season before any season uploads, so a refusal leaves R2 untouched
    - one writer binding for every upload of a run, injectable for tests
    - a 404 as a value (null), every other read failure a refusal
key-files:
  created:
    - scripts/districtPublishGuard.ts
    - scripts/districtPublishGuard.test.ts
  modified:
    - packages/harness/r2Client.ts
    - packages/harness/r2ClientRetry.test.ts
    - scripts/publishDistricts.ts
    - scripts/publishDistricts.test.ts
    - docs/worker-operations.md
    - .planning/todos/pending/champ-joint-lock-follow-ups.md (edited, NOT committed)
decisions:
  - "R4: no state on this run's side while live shows a true flag or matches played is a lost fact (the refusing side)"
  - "R5: --allow-regress never covers a read failure; a dry run with --check-live prints a read failure and goes on"
  - "R6: the guard runs twice on a run that uploads, before the bake and before the first upload; every season is composed and baked before any season uploads"
  - "A lower point value on a row that is still there, and qualMatchesTotal, are not compared (D1 does not list them)"
metrics:
  duration: about 25 minutes
  completed: 2026-10-10
actuals:
  tokens: 19772
  tasks: 2
  commits: 2
---

# Quick Task 261009-ul3: The district publisher refuses to overwrite live facts with older ones

The offline district publisher now reads the published `v1/district/{key}.json` of every district of the run before its first upload and refuses the whole run when the upload would take back a fact the live Worker recorded. The guard only reads and refuses: every composed artifact is byte identical before and after.

Base commit `0aafac90`. Two commits, neither pushed:

| Task | Commit | Subject |
| ---- | ------ | ------- |
| 1 | `3f0421af` | feat(261009-ul3): the district publisher reads what is live and refuses to lose a recorded award winner |
| 2 | `14bb1b07` | feat(261009-ul3): every live fact is guarded, with --allow-regress and --check-live, and the operations doc says so |

The two commits name exactly seven repo files: `packages/harness/r2Client.ts`, `packages/harness/r2ClientRetry.test.ts`, `scripts/districtPublishGuard.ts`, `scripts/districtPublishGuard.test.ts`, `scripts/publishDistricts.ts`, `scripts/publishDistricts.test.ts`, `docs/worker-operations.md`. No commit from another session landed between the base and HEAD.

## What the guard refuses

Per event key present in both the published artifact and this run's artifact:

1. `alliancesPicked` true live and not true in this run.
2. `playoffsDone` true live and not true in this run.
3. `awardsPosted` true live and not true in this run.
4. `qualMatchesPlayed` lower in this run.
5. An `eventPoints` row (team, event) live and gone in this run.
6. A `qualifyingAwards` entry (team, event, award type) live and gone in this run.

Not a regression: no published object (a first publish), a published body that is not JSON or fails `DistrictArtifactSchema` (a shape change, named in the output and not compared), an identical artifact, a newer artifact, and any event only one side names. Not compared at all: a lower point value on a row that is still there, and `qualMatchesTotal`.

A read failure other than a 404 refuses a run that uploads, with or without `--allow-regress`.

A refusal uploads nothing and writes no local file (it comes before the first byte gate), and `main` exits 1.

## The flags

- `--allow-regress`: a run that uploads prints the same list, prints one override line and publishes. It never covers a read failure. On a dry run it has nothing to do and is accepted.
- `--check-live`: a `--dry-run` reads every district once (the first pass only), prints the list and never fails, read failures included. On a run that uploads it has nothing to do (that run always checks) and is accepted.
- A plain `--dry-run` makes zero R2 reads.

## What a refusal prints

Real output of `guardLivePublish` with fakes (offline, 2026pnw from the after dump with one event set back by hand):

```
publishDistricts: the published "v1/district/2026old.json" does not parse as a district artifact. That is a shape change, not a regression, so it is not compared.
publishDistricts: live check before the bake: 1 district(s) compared, 1 not published yet, 1 not parseable, 0 unreadable, 5 live fact(s) this run would lose
publishDistricts: this run would lose a live fact: district 2026pnw, event 2026wabon, playoffs done: live true, this run false
publishDistricts: this run would lose a live fact: district 2026pnw, event 2026wabon, awards posted: live true, this run false
publishDistricts: this run would lose a live fact: district 2026pnw, event 2026wabon, qualification matches played: live 68, this run 62
publishDistricts: this run would lose a live fact: district 2026pnw, event 2026wabon, team frc948, points row: live a row totalling 62, this run absent
publishDistricts: this run would lose a live fact: district 2026pnw, event 2026wabon, team frc2046, recorded award winner: live FIRST Impact Award (award type 0), this run absent
publishDistricts failed: publishDistricts: refused before the bake. Nothing was uploaded. This run would lose 5 live fact(s), listed above: the corpus is older than what is live, so run the ingest first and publish again. See "The offline district publish reads what is live first" in docs/worker-operations.md.
```

The override line, printed after the same list under `--allow-regress`:

```
publishDistricts: --allow-regress was given, so the 5 live fact(s) listed above will be overwritten by this run.
```

A read failure (enforce mode, the override given and ignored):

```
publishDistricts failed: publishDistricts: refused before the first upload. Nothing was uploaded. The published "v1/district/2026pnw.json" could not be read: r2Client.getObjectIfExists: GET "v1/district/2026pnw.json" failed with status 503 Service Unavailable after 5 attempts. A run that cannot read what is live does not publish, and --allow-regress does not change that.
```

In a dry run with `--check-live` a read failure is one line and the run goes on: `publishDistricts: the published "KEY" could not be read: MESSAGE. It is not compared.`

A flag state with no state on this run's side renders this run's value as `no state`.

## The dump comparisons

All dumps taken by the executor at HEAD `0aafac90` before the first edit. The planner's dumps were not used as a baseline.

| Comparison | Printed line | Verdict |
| ---------- | ------------ | ------- |
| planner no bake dump against my before dump | `files before 119 after 119 \| details 109 sidecars 0 indexes 10 other 0 \| only before 0 \| only after 0 \| differing 0` | `UL3 COMPARE CLEAN` |
| planner bake dump against my bake before dump | `files before 42 after 42 \| details 26 sidecars 14 indexes 2 other 0 \| only before 0 \| only after 0 \| differing 14` | `UL3 COMPARE FAILED` (expected, see below) |
| Task 1, no bake: before against after | `files before 119 after 119 \| details 109 sidecars 0 indexes 10 other 0 \| only before 0 \| only after 0 \| differing 0` | `UL3 COMPARE CLEAN` |
| Task 1, no bake, r9x comparer | `artifacts 109 \| differing 0 \| carried events 1124 \| awardsPosted true before 1124 after 1124 \| flips 0 \| qualifyingAwards entries before 3251 after 3251` | `R9X COMPARE CLEAN` |
| Task 1, bake on (2025 and 2026 as of 2026-04-04): before against after | `files before 42 after 42 \| details 26 sidecars 14 indexes 2 other 0 \| only before 0 \| only after 0 \| differing 0` | `UL3 COMPARE CLEAN` |
| Task 2, no bake: before against after2 | `files before 119 after 119 \| details 109 sidecars 0 indexes 10 other 0 \| only before 0 \| only after 0 \| differing 0` | `UL3 COMPARE CLEAN` |
| Task 2, no bake, r9x comparer | `artifacts 109 \| differing 0 \| carried events 1124 \| awardsPosted true before 1124 after 1124 \| flips 0 \| qualifyingAwards entries before 3251 after 3251` | `R9X COMPARE CLEAN` |

The bake baseline was TAKEN, not copied: `git diff --quiet 9e979118 HEAD -- scripts packages` is not clean (261009-tx6, tx8, tx9, txb, uhb and vp9 landed in between). The planner's bake dump differs from mine in the 14 district details of 2026, which is those tasks changing how a mid season instant (as of 2026-04-04) is composed. It is not this task: my before and after bake dumps, both at this HEAD, are identical over all 42 files. The dumps live in the session scratchpad (`ul3-before`, `ul3-after`, `ul3-after2`, `ul3-bake-before`, `ul3-bake-after`).

## Verification, as printed

Task 1:
- `npx vitest run packages/harness/r2ClientRetry.test.ts packages/harness/r2ClientList.test.ts scripts/publishDistricts.test.ts`: `Test Files 3 passed (3)`, `Tests 133 passed (133)`. The two files the planner measured at 95 are now 107 (5 new reader tests, 7 new `run` tests).
- `TYPECHECKS CLEAN (root, web, e2e)`.
- Count gate: `3`.

Task 2:
- RED first: 24 new tests failed before the code.
- `npx vitest run scripts/districtPublishGuard.test.ts scripts/publishDistricts.test.ts packages/harness/r2ClientRetry.test.ts`: `Test Files 3 passed (3)`, `Tests 146 passed (146)` (33 in the new guard file, 97 in the publisher file, 16 in the retry file).
- `TYPECHECKS CLEAN (root, web, e2e)`.
- Count gate: `3`.
- Full root `npx vitest run`: `Test Files 353 passed (353)`, `Tests 8588 passed | 1 skipped (8589)`, 178.90 s. The one skip is not in a file this task touched.

Every `run` test of the 261009-ul3 describe spies on `globalThis.fetch` with an implementation that throws and asserts it was never called. No test touches the network. No existing test body was edited: the only edit to existing lines is the vitest import line of `scripts/publishDistricts.test.ts`.

## Premises and readings, as executed

- C1: `getObject` is unchanged. `getObjectIfExists` sits beside it on `sendWithRetry`, success meaning 2xx or 404, null for a 404.
- C2, R1: only `options.dryRun` decides whether a run uploads. A `--local-out` run without `--dry-run` is guarded.
- C3: the refusal and the doc name the ingest, never the rebaseline. Checked at this HEAD: `scripts/rebaseline.ts` runs the plain, rankings, alliances, event teams and awards passes, not the districts pass, and never the district publish. Not changed.
- C4: the doc subsection is `### The offline district publish reads what is live first (quick task 261009-ul3)`, at the end of "The district refresh pass", before the rule that closes it.
- C5, R2, R3: event presence and the one state per event fold are as the plan states.
- R4, R5: both taken on the refusing side, as planned.
- R6: two passes on a run that uploads, one in a dry run with `--check-live`. Every season is composed, then every season baked, then uploads. Per object order inside a season is unchanged.
- R7: the composed artifact is compared, before `bakedEvents` is attached.
- R8: no new refusal in `parseOptions`.
- R9: reads go 16 at a time, results handled in input order.
- R10: the comparison and the mode table are tested with no corpus (`scripts/districtPublishGuard.test.ts`). The ordering facts are tested on the real `run`, corpus guarded.
- R11: stated in the doc, not fixed. The Worker can still write between the second read and that district's upload.

## Deviations from Plan

**1. The doc subsection named by the plan no longer exists under that name.** The plan places the new subsection after "Known freshness limit". Quick tasks 261009-tx6 and 261009-vp9 renamed it "The limits that remain". The new subsection went after it and before the closing rule, which is the same place. One sentence in "The limits that remain" still reads "The offline publisher refusing to overwrite newer live facts is a separate quick task (261009-ul3)". It was left alone (the plan says to change no other part of the doc) and is still true.

**2. Leftover (f) in the todo was already closed and struck by quick 261009-tx6.** The plan says to mark it closed by 261009-ul3 and strike its bold sentence. The sentence was already struck. The bullet's lead now reads "CLOSED by quick 261009-tx6 and, at the source, by quick 261009-ul3." and one sentence was added: the publisher now reads the published artifact before uploading and refuses the run when the upload would lose a live fact, with `--allow-regress` as the override. Every existing line is kept and no item was added. The file is edited and NOT committed.

**3. Additions beyond the behavior block, none changing a planned behavior.** `getObjectIfExists` releases the unread body of a 404. The refused `run` test also asserts the local output folder stays empty. The guard file has a few extra cases (the same award type moved to another team, a team missing from this run, an event named only through an award entry, the first failing key in input order, 40 clean keys read once each, the override having no effect in report mode). `parseOptions` has one extra case for R8.

**4. Editing mechanics.** Git Bash heredocs fail on this machine for long content, so file content was written with the Write tool to the scratchpad and spliced in by small node scripts. No effect on the result.

## Known Stubs

None.

## What the orchestrator still owes

1. Commit the planning files (this SUMMARY, the PLAN, the CONTEXT, the todo edit).
2. From the main context, the first read of production through the new reader (network and credentials, never run by the executor):

   ```
   npx tsx --env-file=.env scripts/publishDistricts.ts --years "2016-2020,2022-2026" --dry-run --no-bake --check-live
   ```

   Expected out of season: one line `publishDistricts: live check before the bake: 109 district(s) compared, 0 not published yet, 0 not parseable, 0 unreadable, 0 live fact(s) this run would lose`, and no fact line. A fact line there means the corpus is behind what is live.
3. Check `origin/main..main` before any push: it holds commits from other sessions besides these two. No Worker deploy and no republish is owed by this task.

## Self-Check: PASSED

- FOUND: scripts/districtPublishGuard.ts
- FOUND: scripts/districtPublishGuard.test.ts
- FOUND: commit 3f0421af
- FOUND: commit 14bb1b07
