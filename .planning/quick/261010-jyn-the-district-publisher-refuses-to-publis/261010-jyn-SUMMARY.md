---
phase: quick-261010-jyn
plan: 01
subsystem: districts
tags: [districts, publisher, r2, guard, live-districts, allow-live, skip, evidence, index-carry]
status: complete
requirements_completed: [261010-jyn]
requires:
  - 261009-ul3 (the live facts guard this one sits beside, its reader and writer seams)
  - 261009-tx6 (DISTRICT_AWARDS_WATCH_MS and the builder's retention of a closed district window)
  - 261009-vp9, 261010-66y, 261010-d7r (whose last stated limit this closes)
provides:
  - scripts/districtLiveGuard.ts (liveDistrictEventsAt, checkLiveDistricts, seasonUploadPlan, carryPublishedIndex, calendarWatchEventsAt, compareForLiveEvidence, checkLiveEvidence, LIVE_DISTRICT_MARKER, EVIDENCE_POINT_CATEGORIES)
  - scripts/publishDistricts.ts flag --allow-live, seam CliOptions.now, the two clock passes, the evidence check, the carried index
affects:
  - pnpm publish:districts (skips a live district and exits 0; one more R2 read per season with a skipped and a published district; two new refusals)
  - pnpm verify:district-bake (a dry run: one clock pass as a notice, nothing else)
  - docs/worker-operations.md (one new subsection after the 261009-ul3 one)
tech-stack:
  added: []
  patterns:
    - a guard that skips one unit of a run and lets the rest through, where a whole run refusal would be overridden as routine
    - one rule, one function - the publisher asks the live windows builder itself and holds no date rule of its own
    - a recording wrapper around an injected reader, so a second check reads nothing new and the first module is not edited
    - fail closed on the one object that has to be carried (the published index)
key-files:
  created:
    - scripts/districtLiveGuard.ts
    - scripts/districtLiveGuard.test.ts
  modified:
    - scripts/publishDistricts.ts
    - scripts/publishDistricts.test.ts
    - docs/worker-operations.md
decisions:
  - "D5: a live district is skipped, the run is not refused. Exit 0."
  - "The clock rule reads the live windows builder at the wall clock and adds one comparison (the window has opened). Membership is the manifest's districtKey, no event type test."
  - "The evidence rule covers the calendar window plus 24 hours for a district the clock rule does not list: awards posted raised over the published file, or a lower point value on a row both files hold."
  - "A skipped district's index row is carried from the published index. A published index that cannot be carried refuses the run before any upload."
  - "--allow-live covers both rules and never a clock check that could not run."
metrics:
  duration: about 45 minutes
  completed: 2026-10-10
actuals:
  tokens: 41137
  tasks: 3
  commits: 3
---

# Quick Task 261010-jyn: The district publisher skips a district while one of its events is live

The offline district publisher no longer overwrites a district's file while the Worker owns it. It skips that district (no detail, no sidecar, no local file, no read, no comparison) and publishes every other district of the run, with exit 0. Two rules decide: a clock rule read off the live windows builder, and an evidence rule on the bodies the 261009-ul3 guard has already read. For a run with nothing to skip, every composed artifact and every printed line is identical before and after.

Base commit `e868a1a2`. Three commits, none pushed, none touching `.planning/`:

| Task | Commit | Subject |
| ---- | ------ | ------- |
| 1 | `9f948275` | feat(261010-jyn): the district publisher skips a district with a live event and publishes the others |
| 2 | `8a361697` | feat(261010-jyn): --allow-live publishes the live districts too and a dry run prints a notice |
| 3 | `697563e5` | feat(261010-jyn): a district is also skipped on evidence while an event's calendar window is open, and the operations doc states both rules |

The scope line (`git show --name-only` over the three commits, sorted, unique) lists exactly `docs/worker-operations.md`, `scripts/districtLiveGuard.test.ts`, `scripts/districtLiveGuard.ts`, `scripts/publishDistricts.test.ts`, `scripts/publishDistricts.ts`. No commit from another session landed between the base and HEAD. `origin/main..main` holds these three commits only.

## What is skipped, and when

**The clock rule.** A district is skipped while one of its events is inside its window or in the 24 hours after it. The window is the one `buildLiveWindowsManifest` gives on the same corpus at the wall clock: from the event's match times with one hour either side, or, when the corpus holds no match for the event, from 12 hours before its start date at 00:00 UTC to 4 days after it. The new code adds one comparison, `window.startMs <= nowMs`, because the builder also keeps windows that have not opened. Together they equal the Worker's own watch comparison (`apps/worker/src/districtRefresh.ts`), pinned by a test at six edge instants for both kinds of window. District events, District Championships and divisions are covered alike, because membership is the manifest's `districtKey` and nothing else.

- It runs twice on a run that uploads: after compose and before the first R2 read (`before the bake`), and again after the bake (`before the first upload`). Both feed one skip set. A district skipped at any point stays skipped for the run.
- The clock is `Date.now()`, read once per pass through `CliOptions.now` (a test seam). `--as-of` never decides it and no flag sets it.
- An event the builder can give no window (no match and a start date that does not parse) makes its district live only while the clock's UTC year is the district's season. No such event is in the corpus today.

**The evidence rule.** At the 261009-ul3 second read, for a district the clock rule did not list, and for each of its events whose calendar window plus 24 hours is still open at the clock (through the builder's own `probeWindowFor`, asked the way the builder asks it), the district is also skipped when:

1. this run would write `awardsPosted` true for the event where the published file does not hold it true (false, no state on any row of the event, or no row for the event at all), or
2. this run would write a lower value than the published one in `qual`, `alliance`, `elim`, `award` or `total` of an `eventPoints` row both files hold.

It reads nothing new: `run` hands the 261009-ul3 guard a reader that records each body it returns, and the evidence check reads that map. It never throws. Outside the calendar window plus 24 hours nothing changes: an older event's flag is still raised at the hindsight vantage, and a lower value there is still not a regression. The 261009-ul3 guard runs first and refuses exactly what it refused before.

Not compared by the evidence rule: a district the clock rule listed, a district with no event in a calendar window plus 24 hours, and a published body that is null (a first publish), was not read, is not JSON, or is not a district artifact.

## The index carry

A skipped district's row in `v1/districts/{year}.json` is taken from the index that is published now, read once per season that has both a skipped and a published district, through the existing reader seam, after the evidence check and before the first upload. The uploaded index keeps this run's row order, stamps and year. Rows of districts that are not skipped are this run's. A skipped district with no published row is left out, with one line.

- A season with nothing skipped uploads this run's index, as before.
- A season whose districts are all skipped uploads nothing, the index included, and its published index is not read.
- A published index that is missing, unreadable, not a districts index, or the index of another year refuses the whole run before any upload (`DistrictPublishRefusedError`, exit 1, no local file). `--allow-live` is the way through, since it skips nothing.

## The override

`--allow-live` (`CliOptions.allowLive`) covers both rules: the same event or evidence lines, one override line, nothing skipped, this run's index uploaded. The 261009-ul3 guard still reads and compares those districts, so a live fact the upload would lose still refuses the run (tested). It never covers a clock check that could not run. On a dry run it is accepted and does nothing.

## Every line a run prints, by mode

Real output of the real `run` with a fake reader, a fake writer and an injected clock (`SCRATCH/jyn-exec/jyn-wording.mts`, offline, `fetch` replaced by a function that throws). Fixture: district `2026isr`, event `2026iscmp`, LIVE `2026-07-08T12:07:31.000Z`, GAP `2026-07-09T13:07:31.000Z`. Only the lines this task adds are shown.

**A run that uploads, nothing live (the real clock, today):** no new line. 28 reads, 15 writes, as before.

**A run that uploads, one district live by the clock** (27 reads, 14 writes, resolved):

```
publishDistricts: live district 2026isr: event 2026iscmp is inside its window or within 24 hours after it. Window 2026-07-07T05:39:19.000Z to 2026-07-08T13:07:31.000Z, from its match times. The Worker watches it until 2026-07-09T13:07:31.000Z.
publishDistricts: live district 2026isr is skipped before the bake: this run uploads nothing of it, and its published file stays as the Worker has it.
publishDistricts: "v1/districts/2026.json" keeps the published row of 1 live district(s) this run skips: 2026isr.
publishDistricts: season 2026 — 13 district(s) published, 1 live district(s) skipped, 0 sidecar(s), 2640522 total bytes
publishDistricts: 1 live district(s) skipped, 13 district(s) published. Run this again later, or pass --allow-live to publish them now. See "The offline district publish skips a district while one of its events is live" in docs/worker-operations.md.
```

A district found live at the second pass prints the same two lines with `before the first upload`. With `--local-out` on a run that skipped something, the local out line reads `every object this run uploaded written to "DIR". Nothing was written for a skipped live district.`

**A run that uploads, evidence (i), the flag** (29 reads, 14 writes, resolved):

```
publishDistricts: live district 2026isr: event 2026iscmp is outside the window from its match times and the 24 hours after it, and still inside its calendar window plus 24 hours, until 2026-07-11T00:00:00.000Z, so the Worker may still be watching it. This run would write awards posted true, and the published file does not hold it true.
publishDistricts: live district 2026isr is skipped before the first upload on evidence: this run uploads nothing of it, and its published file stays as the Worker has it.
```

followed by the same kept row line, season line and closing line as above.

**A run that uploads, evidence (ii), the points** (29 reads, 14 writes, resolved):

```
publishDistricts: live district 2026isr: event 2026iscmp is outside the window from its match times and the 24 hours after it, and still inside its calendar window plus 24 hours, until 2026-07-11T00:00:00.000Z, so the Worker may still be watching it. This run would write 2 point value(s) lower than the published file holds. The first: team frc1690, qual, published 69, this run 66.
publishDistricts: live district 2026isr is skipped before the first upload on evidence: this run uploads nothing of it, and its published file stays as the Worker has it.
```

**`--allow-live`, either rule** (28 reads, 15 writes, resolved). The event line or the evidence line as above, then:

```
publishDistricts: --allow-live was given, so this run publishes the 1 live district(s) listed above too.
```

**A dry run, the clock rule** (0 reads, 0 writes, resolved, every object written locally):

```
publishDistricts: live district 2026isr: event 2026iscmp is inside its window or within 24 hours after it. Window 2026-07-07T05:39:19.000Z to 2026-07-08T13:07:31.000Z, from its match times. The Worker watches it until 2026-07-09T13:07:31.000Z.
publishDistricts: --dry-run uploads nothing, so this is a notice. A run that uploads would skip the 1 live district(s) listed above, unless --allow-live is given.
```

**A dry run with `--check-live`, the evidence rule** (14 reads, 0 writes, resolved). The evidence line as above, then:

```
publishDistricts: --dry-run uploads nothing, so this is a notice. A run that uploads would skip the 1 live district(s) listed above on evidence, unless --allow-live is given.
```

A plain dry run makes no evidence call and prints nothing from that rule.

**Every district of a season live** (2016 at `2016-03-19T14:06:34.000Z`: 0 reads, 0 writes, resolved). 11 event lines, 8 skip lines, then:

```
publishDistricts: every district of season 2016 is a live district this run skips, so nothing of that season is uploaded, "v1/districts/2016.json" included.
publishDistricts: 8 live district(s) skipped, 0 district(s) published. Run this again later, or pass --allow-live to publish them now. See "The offline district publish skips a district while one of its events is live" in docs/worker-operations.md.
```

**An event with no window** (temp corpus only): `publishDistricts: live district 2026pnw: event 2026wabon has no match and no usable start date in the corpus, so no window can be built for it. Its season is the current year, so it is read as live.`

**A skipped district with no published index row:** `publishDistricts: live district 2026b has no row in the published "v1/districts/2026.json", so the index this run uploads leaves it out.`

**Refusal 1, the published index cannot be carried** (27 reads, 0 writes, rejected, exit 1):

```
publishDistricts failed: publishDistricts: refused before the first upload. Nothing was uploaded. This run skips 1 live district(s) of season 2026 and has to keep their rows from the published "v1/districts/2026.json", and that object does not exist. Run this again once no district of that season is skipped, or pass --allow-live, which publishes them too.
```

The other reasons read `it could not be read: MESSAGE`, `it is not a districts index`, and `it is the districts index of year N`.

**Refusal 2, the clock check cannot run** (a run that uploads, with or without `--allow-live`), and its dry run line:

```
publishDistricts failed: publishDistricts: refused before the bake. Nothing was uploaded. The live district check could not run: SQLITE_CANTOPEN: unable to open database file. A run that cannot tell whether a district is live does not publish, and --allow-live does not change that.
publishDistricts: the live district check could not run before the bake: SQLITE_CANTOPEN: unable to open database file. A dry run goes on.
```

Every line and message of the guard starts with `publishDistricts:` and contains `live district` (`LIVE_DISTRICT_MARKER`). No line that existed before contains it.

## The dump comparisons

Every baseline was taken by the executor at `e868a1a2` before the first edit.

| Comparison | Printed line | Verdict |
| ---------- | ------------ | ------- |
| Step 0, no bake: planner dump against my before dump | `files before 119 after 119 \| details 109 sidecars 0 indexes 10 other 0 \| only before 0 \| only after 0 \| differing 0` | `UL3 COMPARE CLEAN` |
| Step 0, bake: planner bake dump against my bake before dump | `files before 42 after 42 \| details 26 sidecars 14 indexes 2 other 0 \| only before 0 \| only after 0 \| differing 0` | `UL3 COMPARE CLEAN` |
| Task 1, no bake: before against after | `files before 119 after 119 \| details 109 sidecars 0 indexes 10 other 0 \| only before 0 \| only after 0 \| differing 0` | `UL3 COMPARE CLEAN` |
| Task 1, r9x comparer | `artifacts 109 \| differing 0 \| carried events 1124 \| awardsPosted true before 1124 after 1124 \| flips 0 \| qualifyingAwards entries before 3251 after 3251` | `R9X COMPARE CLEAN` |
| Task 2, no bake: before against after2 | `files before 119 after 119 \| details 109 sidecars 0 indexes 10 other 0 \| only before 0 \| only after 0 \| differing 0` | `UL3 COMPARE CLEAN` |
| Task 2, r9x comparer | `artifacts 109 \| differing 0 \| carried events 1124 \| awardsPosted true before 1124 after 1124 \| flips 0 \| qualifyingAwards entries before 3251 after 3251` | `R9X COMPARE CLEAN` |
| Task 3, no bake: before against after3 | `files before 119 after 119 \| details 109 sidecars 0 indexes 10 other 0 \| only before 0 \| only after 0 \| differing 0` | `UL3 COMPARE CLEAN` |
| Task 3, r9x comparer | `artifacts 109 \| differing 0 \| carried events 1124 \| awardsPosted true before 1124 after 1124 \| flips 0 \| qualifyingAwards entries before 3251 after 3251` | `R9X COMPARE CLEAN` |
| Task 3, bake on (2025 and 2026 as of 2026-04-04): before against after | `files before 42 after 42 \| details 26 sidecars 14 indexes 2 other 0 \| only before 0 \| only after 0 \| differing 0` | `UL3 COMPARE CLEAN` |

Beyond the artifacts: the printed log of the no bake dry run is identical before and after each task (`diff` of the two logs with the directory name masked prints nothing), and it holds zero lines containing `live district`. The bake logs differ only in the replay's millisecond count. The dumps are in the scratchpad: `jyn-before`, `jyn-after`, `jyn-after2`, `jyn-after3`, `jyn-bake-before`, `jyn-bake-after`.

## Verification, as printed

Targeted files (`npx vitest run scripts/districtLiveGuard.test.ts scripts/publishDistricts.test.ts scripts/districtPublishGuard.test.ts packages/harness/manifests.test.ts`), nothing failed and nothing skipped at any point:

| After | Totals | districtLiveGuard | publishDistricts | districtPublishGuard | manifests |
| ----- | ------ | ----------------- | ---------------- | -------------------- | --------- |
| base (planner) | 2 files 130, manifests 51 | n/a | 97 | 33 | 51 |
| Task 1 | `Test Files 4 passed (4)`, `Tests 221 passed (221)` | 29 | 108 | 33 | 51 |
| Task 2 | `Test Files 4 passed (4)`, `Tests 245 passed (245)` | 43 | 118 | 33 | 51 |
| Task 3 | `Test Files 4 passed (4)`, `Tests 296 passed (296)` | 82 | 130 | 33 | 51 |

RED was seen before each task's code: Task 1, both files failed to import the missing module; Task 2, 19 tests failed; Task 3, the guard file failed to collect and 6 publisher tests failed. A mutation check after Task 1 (the line that adds a district to the skip set commented out) failed 6 of the 11 wiring tests, and the file was restored byte for byte.

Typechecks after each task: `TYPECHECKS CLEAN (root, web, e2e, worker)`.

Full root run, `REQUIRE_LOCAL_DATA=1 npx vitest run`, on the tree that became `697563e5`: `Test Files 357 passed (357)`, `Tests 9016 passed | 1 skipped (9017)`, 882.92 s. The one skip is not in a file this task touched (the four targeted files report zero pending).

No test reaches the network: every `run` test of the 261010-jyn describe spies on `globalThis.fetch` with an implementation that throws and asserts it was never called, and every reader and writer is a fake. No existing test body was edited: the only edits to existing lines of `scripts/publishDistricts.test.ts` are three added import lines (one of them later widened by one name).

## The control script (`SCRATCH/jyn-live-at.mts`), as printed

At the real clock, `now --notice --enforce` (after Task 2):

```
clock 2026-10-10T19:27:17.165Z: 109 district(s) of the run, 0 live district event(s) in 0 district(s)
--- what a dry run prints at this clock:
--- returned: 0 live district(s) [], overridden false, unchecked false
--- what a run that uploads prints at this clock:
--- returned: 0 live district(s) [], overridden false, unchecked false
```

At `2026-03-21T18:00:00.000Z --enforce` (after Task 1). The script's own 28 lines:

```
clock 2026-03-21T18:00:00.000Z: 109 district(s) of the run, 28 live district event(s) in 13 district(s)
  2026ca 2026calas matches 2026-03-21T16:52:03.000Z to 2026-03-23T01:32:49.000Z, watched until 2026-03-24T01:32:49.000Z
  2026ca 2026casac matches 2026-03-21T16:16:55.000Z to 2026-03-23T01:49:40.000Z, watched until 2026-03-24T01:49:40.000Z
  2026ca 2026casnd matches 2026-03-21T16:29:02.000Z to 2026-03-23T01:42:00.000Z, watched until 2026-03-24T01:42:00.000Z
  2026fch 2026mdbet matches 2026-03-21T14:02:14.000Z to 2026-03-22T22:00:21.000Z, watched until 2026-03-23T22:00:21.000Z
  2026fch 2026vache matches 2026-03-21T14:02:41.000Z to 2026-03-22T21:55:26.000Z, watched until 2026-03-23T21:55:26.000Z
  2026fim 2026mibel matches 2026-03-20T13:57:47.000Z to 2026-03-21T22:36:04.000Z, watched until 2026-03-22T22:36:04.000Z
  2026fim 2026miber matches 2026-03-21T14:03:37.000Z to 2026-03-22T22:14:18.000Z, watched until 2026-03-23T22:14:18.000Z
  2026fim 2026mibkn matches 2026-03-21T13:50:26.000Z to 2026-03-22T22:33:23.000Z, watched until 2026-03-23T22:33:23.000Z
  2026fim 2026mifli matches 2026-03-21T13:54:54.000Z to 2026-03-22T22:19:22.000Z, watched until 2026-03-23T22:19:22.000Z
  2026fim 2026mimus matches 2026-03-20T13:51:40.000Z to 2026-03-21T22:19:53.000Z, watched until 2026-03-22T22:19:53.000Z
  2026fim 2026mitvc matches 2026-03-20T14:14:26.000Z to 2026-03-21T22:00:39.000Z, watched until 2026-03-22T22:00:39.000Z
  2026fin 2026incol matches 2026-03-21T14:04:08.000Z to 2026-03-22T22:09:30.000Z, watched until 2026-03-23T22:09:30.000Z
  2026fit 2026txfor matches 2026-03-20T14:26:22.000Z to 2026-03-21T22:47:15.000Z, watched until 2026-03-22T22:47:15.000Z
  2026fit 2026txhou matches 2026-03-20T14:36:22.000Z to 2026-03-21T22:43:44.000Z, watched until 2026-03-22T22:43:44.000Z
  2026fit 2026txwac matches 2026-03-20T14:26:19.000Z to 2026-03-21T22:33:14.000Z, watched until 2026-03-22T22:33:14.000Z
  2026fma 2026njrob matches 2026-03-21T13:49:47.000Z to 2026-03-22T22:30:52.000Z, watched until 2026-03-23T22:30:52.000Z
  2026fma 2026pawar matches 2026-03-21T14:01:18.000Z to 2026-03-22T22:19:48.000Z, watched until 2026-03-23T22:19:48.000Z
  2026fnc 2026ncelo matches 2026-03-21T14:04:28.000Z to 2026-03-22T22:04:01.000Z, watched until 2026-03-23T22:04:01.000Z
  2026fnc 2026ncwk2 matches 2026-03-21T13:57:14.000Z to 2026-03-22T20:50:01.000Z, watched until 2026-03-23T20:50:01.000Z
  2026isr 2026isde4 calendar 2026-03-16T12:00:00.000Z to 2026-03-21T00:00:00.000Z, watched until 2026-03-22T00:00:00.000Z
  2026ne 2026ctwat matches 2026-03-21T14:30:06.000Z to 2026-03-22T22:47:09.000Z, watched until 2026-03-23T22:47:09.000Z
  2026ne 2026rikin matches 2026-03-20T14:12:02.000Z to 2026-03-21T22:37:18.000Z, watched until 2026-03-22T22:37:18.000Z
  2026ont 2026onham matches 2026-03-21T14:39:09.000Z to 2026-03-22T22:01:21.000Z, watched until 2026-03-23T22:01:21.000Z
  2026ont 2026onnob matches 2026-03-21T14:45:08.000Z to 2026-03-22T22:40:19.000Z, watched until 2026-03-23T22:40:19.000Z
  2026pch 2026gacol matches 2026-03-20T14:01:05.000Z to 2026-03-21T22:38:57.000Z, watched until 2026-03-22T22:38:57.000Z
  2026pnw 2026wasam matches 2026-03-21T17:12:44.000Z to 2026-03-23T00:38:20.000Z, watched until 2026-03-24T00:38:20.000Z
  2026pnw 2026wayak matches 2026-03-20T17:19:27.000Z to 2026-03-21T23:48:08.000Z, watched until 2026-03-22T23:48:08.000Z
  2026win 2026wiapp matches 2026-03-21T14:50:31.000Z to 2026-03-22T23:17:53.000Z, watched until 2026-03-23T23:17:53.000Z
```

then, under `--- what a run that uploads prints at this clock:`, the check's own 28 event lines for the same events in the same order and 13 skip lines (both counted with `grep -c`: 28 and 13), and:

```
--- returned: 13 live district(s) [2026ca 2026fch 2026fim 2026fin 2026fit 2026fma 2026fnc 2026isr 2026ne 2026ont 2026pch 2026pnw 2026win], overridden false, unchecked false
```

The 41 check lines are not copied here (72 lines in all). They are in `SCRATCH/jyn-exec/t1-control-march.txt`. The first and the last read:

```
publishDistricts: live district 2026ca: event 2026calas is inside its window or within 24 hours after it. Window 2026-03-21T16:52:03.000Z to 2026-03-23T01:32:49.000Z, from its match times. The Worker watches it until 2026-03-24T01:32:49.000Z.
publishDistricts: live district 2026win is skipped before the bake: this run uploads nothing of it, and its published file stays as the Worker has it.
```

At `2026-07-08T12:07:31.000Z --notice --enforce --enforce-allow-live` (after Task 2):

```
clock 2026-07-08T12:07:31.000Z: 109 district(s) of the run, 1 live district event(s) in 1 district(s)
  2026isr 2026iscmp matches 2026-07-07T05:39:19.000Z to 2026-07-08T13:07:31.000Z, watched until 2026-07-09T13:07:31.000Z
--- what a dry run prints at this clock:
publishDistricts: live district 2026isr: event 2026iscmp is inside its window or within 24 hours after it. Window 2026-07-07T05:39:19.000Z to 2026-07-08T13:07:31.000Z, from its match times. The Worker watches it until 2026-07-09T13:07:31.000Z.
publishDistricts: --dry-run uploads nothing, so this is a notice. A run that uploads would skip the 1 live district(s) listed above, unless --allow-live is given.
--- returned: 1 live district(s) [2026isr], overridden false, unchecked false
--- what a run that uploads prints at this clock:
publishDistricts: live district 2026isr: event 2026iscmp is inside its window or within 24 hours after it. Window 2026-07-07T05:39:19.000Z to 2026-07-08T13:07:31.000Z, from its match times. The Worker watches it until 2026-07-09T13:07:31.000Z.
publishDistricts: live district 2026isr is skipped before the bake: this run uploads nothing of it, and its published file stays as the Worker has it.
--- returned: 1 live district(s) [2026isr], overridden false, unchecked false
--- what a run that uploads with --allow-live prints at this clock:
publishDistricts: live district 2026isr: event 2026iscmp is inside its window or within 24 hours after it. Window 2026-07-07T05:39:19.000Z to 2026-07-08T13:07:31.000Z, from its match times. The Worker watches it until 2026-07-09T13:07:31.000Z.
publishDistricts: --allow-live was given, so this run publishes the 1 live district(s) listed above too.
--- returned: 1 live district(s) [2026isr], overridden true, unchecked false
```

The four `--calendar` clocks (after Task 3):

```
clock 2026-10-10T19:35:12.862Z: 109 district(s) of the run, 0 live district event(s) in 0 district(s)
calendar watch: 0 event(s) in 0 district(s) the clock rule does not list: 
clock 2026-07-09T13:07:31.000Z: 109 district(s) of the run, 0 live district event(s) in 0 district(s)
calendar watch: 1 event(s) in 1 district(s) the clock rule does not list: 2026isr(2026iscmp)
clock 2026-07-11T00:00:00.000Z: 109 district(s) of the run, 0 live district event(s) in 0 district(s)
calendar watch: 0 event(s) in 0 district(s) the clock rule does not list: 
clock 2026-03-24T12:00:00.000Z: 109 district(s) of the run, 0 live district event(s) in 0 district(s)
calendar watch: 18 event(s) in 10 district(s) the clock rule does not list: 2026ca(2026calas,2026casac,2026casnd) 2026fch(2026mdbet,2026vache) 2026fim(2026miber,2026mibkn,2026mifli) 2026fin(2026incol) 2026fma(2026njrob,2026pawar) 2026fnc(2026ncelo,2026ncwk2) 2026ne(2026ctwat) 2026ont(2026onham,2026onnob) 2026pnw(2026wasam) 2026win(2026wiapp)
```

Every count matches the planner's measurement.

## What is still not covered

Stated in the doc subsection, from reading R28:

- (a) Past an event's calendar window plus 24 hours nobody watches it, and a publish raises its flag at the hindsight vantage as before. Awards or points that land later than that can still take a lock back. This is the limit "The limits that remain" already states.
- (b) An older snapshot in which a value is HIGHER than the Worker's, because TBA lowered it in between, cannot be told from a newer one and is published.
- (c) A manifest in R2 built from an older corpus can hold a window that neither of today's two windows contains, for an event whose date or schedule moved.
- (d) The evidence rule compares only a published file that parses, so a first publish and a shape change are not compared.
- (e) The Worker can write, and an event's window can open, in the time between the second read and a district's own upload. That time now includes the index read.
- (f) A plain dry run shows the clock rule only.

Two more, found while executing and not in the plan's list:

- (g) The evidence rule looks only at districts the clock rule did not list, and only at events inside a calendar window. A district the clock rule lists under `--allow-live` is published without an evidence line.
- (h) The 261009-ul3 `run` tests, and one test of this task, read the real clock (no `now` seam). They are silent today and at any clock outside the 2026 windows, which is every future clock unless the corpus's 2026 events change.

## Premises and readings, as executed

- P1: there is no 261010-d7r sentence in `docs/worker-operations.md`. None was corrected. The three headers (`packages/core/districts/champJointLock.ts`, `scripts/champJointMonotone.test.ts`, `packages/core/districts/eventAwards.ts`) still say the publisher runs after events are over and are the orchestrator's.
- P2: the evidence rule exists for it. The module header cites the planner's measurement (median 25 hours, 74 at most), dated 2026-10-10. Not re-measured.
- P3: no event type test anywhere. D3's "an offseason event is never a district event" is tested as what the data is (null district key, open window, no district live).
- P4: "starts tomorrow" is pinned on a window from match times. The calendar case is pinned separately, with a test name that says it reads live from 12:00 UTC the day before.
- P5: the no window rule is built and tested on a temp corpus. Unreachable today.
- P6: one added comparison, and a second builder call with retention off (`RETENTION_OFF_NOW_MS = 0`), made only when a district of the clock's UTC year is in the run.
- P7: the doc states the live rule as the code has it (60 minutes when every expected award is listed, 12 hours when one is not). Checked against `awardsPostedRule`.
- P8: the published row is carried. Checked: `recomputeDistrictVerdicts` sets `insights.teamCount` to its own team list length, and the index key appears in `apps/worker/src` only in a comment.
- P9: `run` wraps the reader. `scripts/districtPublishGuard.ts` is not edited.
- R1: `(options.now ?? Date.now)()` once per clock pass. Two calls on a run that uploads, one on a dry run (both tested). `parseOptions` never sets `now` (tested).
- R2, R3: as planned. Parity with the Worker's comparison tested at six instants for both window kinds.
- R4: as planned. An event counts as having a window by event key alone in the retention off answer, whatever district key that window carries.
- R5, R6: two passes, one skip set, never unskipped.
- R7: `--allow-live` covers both rules. A check that cannot run refuses with or without it.
- R8, R9: a dry run skips nothing, and nothing new is logged when neither rule finds anything (the printed log is identical before and after).
- R10: one line per live event, one per skipped district.
- R11: `generation` is the label `district-live-guard-not-published`, `computedAt` the clock as ISO text. The manifest object is read for its windows and dropped.
- R12: the 261009-ul3 passes get only the districts not skipped at that moment, and are not called when districts were skipped and none is left.
- R13, R14: as planned, plus one more refusal (the index of another year, deviation 2).
- R15: the bake loop is not edited. A skipped district's sidecars are baked and passed over.
- R16: tested on 2016 at `2016-03-19T14:06:34.000Z`, by district name.
- R17: the rule, the tables, the plan, the carry and the comparison run with no real corpus. The wiring runs on the real `run`, corpus guarded.
- R18, R19: `calendarWatchEventsAt` calls `probeWindowFor` with the clock moved back by the watch, and is pinned against the builder at six instants.
- R20, R21: as planned. The published side renders as `false`, `no state` or `no row`.
- R22: the fold is stated again in the new module and pinned against `compareDistrictArtifacts` in both directions.
- R23: a fresh map per pass. A throw passes through unrecorded.
- R24: second read, evidence check, index carry, upload loop. Tested by the order of reads and writes (2N plus 1 reads, the index last, all before the first write).
- R25: once after the second read on a run that uploads, once as a notice in a dry run with `--check-live`, never in a plain dry run, never when every district was skipped by the clock.
- R26, R27: tested. `checkLiveEvidence` never throws, a clock that is not finite included.
- R28: in the doc, and above.

## Deviations from Plan

**1. The `Corpus` type is imported from `packages/corpus/db.js`, not from `packages/harness/manifests.js`.** The plan's contract block lists it among the imports from the manifests module, which does not export it, and that file is fenced. A type only import, no behavior.

**2. [Rule 2] `carryPublishedIndex` also refuses the index of another year.** A body that parses as a districts index whose `year` is not the season would otherwise have its rows carried. It refuses with `it is the districts index of year N`. One test added.

**3. The evidence line's wording.** The plan's default says the event "is past its match window". A calendar window also opens before the match window (a median 50 hours before), so the line says "is outside the window from its match times and the 24 hours after it, and still inside its calendar window plus 24 hours". Every token a test names is kept.

**4. The closing line is the last line of `run`, after the `--dry-run` and `--local-out` lines.** The plan says both "after the loop" and "printed last". When districts were skipped, the `--local-out` line no longer claims every composed object was written (wording under "Every line a run prints"). With nothing skipped that line is unchanged.

**5. A season whose districts are all skipped prints its one line and no season summary line.** The plan allows the summary line only "where it is printed".

**6. A clock that is not finite throws before the empty district list returns.** The plan lists the two in the other order. A bad clock is the stricter side, and in `checkLiveDistricts` it is a check that cannot run (a refusal on a run that uploads, one line in a dry run). Tested.

**7. Tests beyond the behavior block, none changing a planned behavior.** A fixture test pinning the planner's measurements (`2026isr`, `2026iscmp`, 14 districts, 8 in 2016, the window's end `2026-07-11T00:00:00.000Z`). The carry keeping this run's row order against a reordered published index. The flag on a `remainingEvents` row. A team's first row at an event. Both evidence kinds at one event (three lines). The evidence check reading the bodies of the second read and not the first. A district with no event in a calendar window. The fixture query breaks a tie on the latest match time by event key.

**8. TDD commits.** The plan asks for one commit per task, so RED was seen and not committed on its own.

**9. Editing mechanics.** Git Bash heredocs fail on this machine for long content, so content was written with the Write tool to the scratchpad and applied by small node scripts that replace exact strings and refuse a match that is missing or not unique (`SCRATCH/jyn-exec/`). No effect on the result.

**10. The March control output is not copied in full.** The script's own 28 lines and the returned line are above. The check's 41 lines are counted and are in the scratchpad file named there.

**11. No GSD state command was run.** STATE.md, ROADMAP.md and the quick tasks table are the orchestrator's (the orchestrator's constraint: commit no `.planning/` file). This SUMMARY is written and not committed.

No STOP rule fired: no comparison printed `FAILED`, no fenced file needed a change, no existing test body needed an edit, and the full run shows no failure.

## Known Stubs

None.

## What the orchestrator still owes

1. Commit the planning files (this SUMMARY, the PLAN, the CONTEXT) and log the quick task.
2. Correct the three headers of premise P1 that still say the publisher is run after events are over.
3. From the main context, with SCR set to the session scratchpad:

   (a) The offline dry run, which must print nothing new today. No `.env`, no network, about 6 seconds:

   ```
   npx tsx scripts/publishDistricts.ts --years "2016-2020,2022-2026" --dry-run --no-bake | grep -c "live district"
   ```

   Expected: `0`.

   (b) The control script at a past instant. Offline and read only:

   ```
   npx tsx "$SCR/jyn-live-at.mts" 2026-07-08T12:07:31.000Z --notice --enforce --enforce-allow-live --calendar
   npx tsx "$SCR/jyn-live-at.mts" 2026-03-21T18:00:00.000Z --enforce
   npx tsx "$SCR/jyn-live-at.mts" 2026-07-09T13:07:31.000Z --calendar
   ```

   Expected: one live event (`2026isr`, `2026iscmp`) with the notice, the skip and the override; 28 events in 13 districts; one event in an evidence window. The full wording in every mode, through the real `run` with fakes: `npx tsx "$SCR/jyn-exec/jyn-wording.mts"`.

   (c) The dry run that reads production (network and credentials, never run by the executor):

   ```
   npx tsx --env-file=.env scripts/publishDistricts.ts --years "2016-2020,2022-2026" --dry-run --no-bake --check-live
   ```

   Expected out of season: the 261009-ul3 line `publishDistricts: live check before the bake: 109 district(s) compared, 0 not published yet, 0 not parseable, 0 unreadable, 0 live fact(s) this run would lose`, and no line containing `live district`. A `live district` line there means an event is inside a window at the real clock, or the corpus and the published file disagree inside a calendar window.
4. Check `origin/main..main` before any push: it holds these three commits. No Worker deploy and no republish is owed by this task.

## Self-Check: PASSED

- FOUND: scripts/districtLiveGuard.ts
- FOUND: scripts/districtLiveGuard.test.ts
- FOUND: commit 9f948275
- FOUND: commit 8a361697
- FOUND: commit 697563e5
