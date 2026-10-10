---
phase: quick-261010-jyn
verified: 2026-10-10
status: passed
score: 8/8 checks verified
gaps: []
warnings: 2
---

# Quick task 261010-jyn Verification (HEAD 697563e5)

Goal: the offline district publisher must not overwrite a district's file while the Worker owns it. A clock rule and an evidence rule skip that district. Every other district publishes. `--allow-live` overrides both.

Verdict: passed. No gap against the goal as D5 states it. Two warnings name limits that are real, are already in the doc, and are not defects of this task.

## 1. Can anything of a skipped district still be written? No.

Every writer in `scripts/publishDistricts.ts` was read. There are three `writeObject` calls (detail, sidecar, index) and one local file writer, `gateAndRecord`. The bake loop (`bakeSeason`) calls neither.

Order in `run`, as it stands at HEAD:

1. Compose.
2. First clock pass.
3. First 261009-ul3 read, on the districts not skipped.
4. Bake.
5. Second clock pass.
6. Second 261009-ul3 read, then the evidence pass.
7. Index carry, for every season.
8. Upload loop.

No byte is written before step 8. Both clock passes and the evidence pass only add to one `skippedDistricts` set, and nothing removes from it. A district found live at the second pass, or skipped on evidence, is therefore in the set before the first write.

In the loop, `publishDistricts.ts` line 2091 skips a skipped district before its byte gate, local file and upload. Line 2121 skips sidecars by `sidecar.artifact.districtKey`. A season whose every district is skipped takes the `continue` at the "none" plan, so its index is not uploaded or written locally. The index for a mixed season is the carried one, built before step 8.

The test at `publishDistricts.test.ts` 2934 to 2975 pins the order for the evidence skip. It checks 2N+1 reads with the index read last, the first write at call 2N+1, no read after the first write, and no write or local file for the skipped key.

## 2. Clock rule against the Worker's watch

`apps/worker/src/districtRefresh.ts` line 521 keeps a member while `window.startMs <= nowMs && nowMs < window.endMs + DISTRICT_AWARDS_WATCH_MS`.

The publisher asks `buildLiveWindowsManifest` at the wall clock. The builder keeps a district window while `endMs > nowMs - WATCH`, which is `nowMs < endMs + WATCH`. `liveDistrictEventsAt` adds `startMs <= nowMs`. The two comparisons are identical, and `loadTickWindowsAt` in the Worker takes the same constant.

Edge tests:

- `districtLiveGuard.test.ts` 146 covers START-1 (not live), START, END, WATCHED_UNTIL-1 (live), WATCHED_UNTIL and +24 hours (not live).
- Test 242 compares the publisher with the Worker's own inequality at six instants for a matches window and a calendar window.
- Tests 699 and 735 do the same for the calendar-watch helper, and test 1095 covers the evidence edge at the calendar watch's end and one millisecond before it.

Where the publisher can read an event as NOT live while the Worker is still watching it:

(a) The Worker reads a manifest published earlier. If that manifest was built before the schedule existed, it holds the CALENDAR window, which closes a median 25 hours (74 at most) after the match window. In that gap the clock rule says not live. The evidence rule covers it, but only when this run would raise `awardsPosted` or write a lower point value. If the file would differ in neither, the district is published and rewritten whole. The 261009-ul3 guard still protects lost rows, flags, played counts and award records there.

(b) The corpus on the publishing machine is staler than the Worker's manifest, or the event's date or schedule moved. This is limit (c) in the doc, and it is partly covered because the calendar window usually contains the event.

(c) Beyond calendar window plus 24 hours nothing watches the event, so there is nothing to protect.

## 3. Evidence rule

- Rule (i), the flag, and rule (ii), the lowered value in `qual`, `alliance`, `elim`, `award` or `total` of a row both files hold, match the spec in `compareForLiveEvidence` (`districtLiveGuard.ts` 580 to 611). Not true means false, no state, or no row.
- No new reader call. `run` wraps the injected reader in a recording reader (`publishDistricts.ts`, `checkLiveFacts`), and the evidence check reads that map. The tests count 2N reads without the evidence skip and 2N+1 with it, and the one extra read is the index carry, read after both passes.
- It never throws. Both JSON parses sit in try/catch, the schema is a `safeParse`, and a clock that is not finite is covered by test 1146.
- It does not pre-empt a refusal. `checkLiveFacts` (the 261009-ul3 guard) is awaited first, and `evidencePass` runs only after it returns.
- A district skipped by the CLOCK at the second pass is not read or compared by the guard. That is D5 as written, not a defect.

## 4. Index carry

- `carryPublishedIndex` refuses on a read that throws, a null body, a body that is not JSON or not a districts index, and an index of another year. All five paths are tested in `districtLiveGuard.test.ts`, near 484, and wired in `publishDistricts.test.ts`.
- Every season's carry runs in the `planned` loop, before the upload loop. A refusal therefore leaves R2 untouched.
- A season with every district skipped has the plan "none". It does not read the index and uploads nothing.
- The doc says the Worker keeps the slot counts and sets `teamCount`. I confirmed that at `packages/harness/districtRankingsMerge.ts` 1127 to 1129.

## 5. Override, dry run, the check that cannot run

- `--allow-live` skips nothing and prints one override line. The 261009-ul3 guard still runs on those districts, and the tests include a refusal under `--allow-live`.
- A dry run uses notice mode, skips nothing and never fails. The evidence rule runs there only with `--check-live`.
- A clock check that cannot run throws a `DistrictPublishRefusedError` in enforce mode whether or not `--allow-live` is given. In notice mode it is one printed line. A clock that is not finite is treated as that case.

## 6. Scope

- `git diff e868a1a2 HEAD -- scripts/districtPublishGuard.ts` is empty (0 bytes).
- `git diff --stat e868a1a2 HEAD` lists exactly five files: `docs/worker-operations.md`, `scripts/districtLiveGuard.ts`, `scripts/districtLiveGuard.test.ts`, `scripts/publishDistricts.ts` and `scripts/publishDistricts.test.ts`. Nothing under `packages/` or `apps/` changed.
- The two untracked `.planning/quick/261010-*` directories are other tasks' planning files.

## 7. Commands run

`npx vitest run scripts/districtLiveGuard.test.ts scripts/publishDistricts.test.ts scripts/districtPublishGuard.test.ts packages/harness/manifests.test.ts` printed:

```
Test Files  4 passed (4)
     Tests  296 passed (296)
```

This matches the SUMMARY's 296.

`npx tsc --noEmit && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.e2e.json && npx tsc --noEmit -p apps/worker/tsconfig.json && echo TYPECHECKS CLEAN` printed `TYPECHECKS CLEAN`.

The orchestrator's two offline and production reads (0 lines containing "live district", and 109 districts compared with 0 live facts lost) are cited as given and not re-run. I made no network call and read no `.env`.

## 8. Doc subsection

The subsection after the 261009-ul3 one states:

- both rules, the printed lines, the index carry and `--allow-live`;
- why the override is dangerous, and when it is right;
- the dry-run and cannot-run behaviour;
- six uncovered cases.

I found nothing the code contradicts:

- The window is match times with one hour either side. `LIVE_WINDOW_PAD_MS` is 3,600,000.
- The calendar window is 12 hours before to 4 days after.
- The 60-minute and 12-hour settle figures were checked by the executor against `awardsPostedRule` (P7), and I did not re-derive them.
- "Rule checked twice" and "reads nothing extra" are true. The only R2 read this task adds is the index carry, which the doc states.

## Warnings

1. When the Worker watches an event on a calendar window and the clock rule has stopped listing it, a publish that would change neither `awardsPosted` nor a point value still rewrites the whole detail file. Only the 261009-ul3 guard covers the rest of the Worker-owned fields. This is stated in the doc (limit one and limit three) and follows from D5, so it is not a gap against the goal.
2. The upload loop does not re-check the clock between districts or seasons, so a window can open mid-upload (doc limit (e), named in the SUMMARY). Closing it needs a conditional put.

## Gaps

None.
