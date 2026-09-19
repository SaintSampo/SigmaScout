---
status: complete
quick_id: 260917-jr4
verdict: IT DID NOT WORK (the sidecar); superseded by 260918-16t
written: 2026-09-18, after the fact, from the commits and the measurement section
commits:
  - a591d302
  - 288f2b4c
  - dd5cd8a2
  - 9b69dcf5
  - 552cb087
---

# 260917-jr4: live tick writes one ephemeral sidecar instead of twelve team artifacts — Summary

This summary was written a day late, during the 2026-09-18 stock-take, from the five commits and the
measurement section of `.planning/todos/pending/rp-fold-exceeds-worker-cpu-budget.md`. Nothing here is
a number this document produced.

## What was built

- `a591d302` The live tick stopped writing per-team season artifacts. Phase B wrote one ephemeral
  sidecar per algorithm-event at `v1/live/{eventKey}/{algorithmId}@{version}.json` instead.
  `estimateEventSubrequestCost` became `2 + 6A` (8 for the spr-only tier, 20 for all three). The
  pinned per-tick subrequest count was re-derived as arithmetic before the run (64, minus 36 team
  calls, plus 6 sidecar calls, equals 34) and observed exactly.
- `288f2b4c` The robot page and the match page derive their live view from the sidecar through one
  extension primitive, `extendMetricHistory`. Two defects were fixed with it and both fixes survive
  today: a finished event's matches no longer render as unplayed once its 7-day window closes, and the
  match page's pre-match cells no longer go blank for a match folded since the last republish.
- `dd5cd8a2`, `9b69dcf5` The probe gained a `sidecar=N` arm and `phaseBVersion=`, with the bar written
  before any number existed.

## The measurement: IT DID NOT WORK

Recorded in `552cb087`. Validity gate passed, so the numbers are interpretable, and the bar was not
renegotiated.

| Arm (reused isolates) | mean |
|---|---|
| `allPhaseB`, the tick as it stood | 18.9 ms |
| `pbTeams0`, no team writes at all | 12.2 ms |
| `pbSidecar`, team writes replaced by the sidecar | 21.7 ms |

The sidecar cost 9.5 ± 1.7 ms, more than the twelve team writes it replaced, because it is
read-modify-append: a second whole-body parse and stringify per tick. Replacing twelve small
read-modify-writes with one large one moved the cost instead of deleting it.

## What happened next

The verdict pointed at putting the live rows inside the event artifact the tick already reads and
writes. That is quick task 260918-16t, which deleted the sidecar outright (object, key, schema, writer,
reader) and measured the replacement at about +2 ms in two independent runs.

**The sidecar Worker was never deployed to production.** Only the probe ran it. A whole-bucket census
on 2026-09-18 found zero keys under `v1/live/`. What did ship from this task, inside Worker `c9b4642e`
and the 2026-09-18 web deploy, is the part 260918-16t kept: the tick no longer writes team artifacts,
the robot and match pages derive their live view, and the two defect fixes above.
