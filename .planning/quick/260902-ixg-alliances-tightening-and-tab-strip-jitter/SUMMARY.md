---
quick_id: 260902-ixg
slug: alliances-tightening-and-tab-strip-jitter
date: 2026-09-02
status: complete
tasks_completed: 5
source: user requests during UAT of 260902-i8i (this session)
---

# Summary - Alliances tab tightening, tab-strip jitter, and the second out-of-band week

All five tasks from PLAN.md executed as specified, one atomic commit each. No task
turned out wrong or impossible; the only deviation is a live-measured regression Task 3's
own fix exposed, described in that section below, fixed in the same commit.

## Commits

| Task | SHA | What a user would have seen |
|---|---|---|
| 1 | d804791f | A muted caption below the Alliances table stating an independence assumption. Now gone; the assumption stays in code comments only. |
| 2 | 834d27b2 | A 240px-wide, always-empty "Pick 3" column on every event without a backup robot (most events). Now the column only appears when at least one alliance actually has one. |
| 3 | 6198ee2c | An "ALLIANCE #" column with 24px of unused padding, and a "RECORD" column with 28px of unused padding. Now both are exactly as wide as their own content requires, and the whole table actually renders at that tightened width instead of silently re-stretching to fill the page. |
| 4 | 33f44ccc | The event/team tab strip visibly sat 3px lower before the first hover than after. Now the strip's position is identical on load, during hover, and after. |
| 5 | 410cfad5 | The event header for 2026iscmp read "Week 19" -- TBA's raw week 18 for this district event is not a season week at all. Now the week segment is omitted, matching the "M, Israel" location alone. |

## Task 1 -- the D-15 caveat comes off the page

Deleted ALLIANCES_INDEPENDENCE_CAVEAT and its p-element render from AlliancesTab.tsx. The
word-for-word copy test (AlliancesTab.test.tsx ~301) was deleted outright, per the plan;
the position-pinning test at ~457 was REWRITTEN, not deleted -- it now pins the
incomplete-combination notice's position against alliances-table-scroll (the table's own
scroll region) instead of the deleted caveat element, preserving the real coverage
(document-order regression) the original test carried.

07-UI-SPEC.md's D-15 row (Copywriting Contract table) and the "Independence-assumption
caveat" instruction are both marked RETIRED 2026-09-02 with the reason and struck through,
not deleted -- the doc no longer silently loses a row it once bound.

combineAlliancePicks's own doc comment was left untouched per the plan's explicit
instruction, with one narrow exception: its closing sentence pointed at
ALLIANCES_INDEPENDENCE_CAVEAT, which no longer exists. That dangling reference was
corrected in place (the substantive independence-assumption paragraph is unchanged) rather
than left to rot, since a comment pointing at a deleted export is exactly the doc-drift this
project's failure log warns about.

Confirmed failing first: "expected <p ...(2)></p> to be null" -- the new "no caveat
anywhere" test, run against the unfixed component before the deletion landed.

## Task 2 -- Pick 3 hides when nothing needs it

buildAllianceColumns now takes a showBackupColumn boolean (computed by a new
hasAnyBackupPick(rows) helper, over the WHOLE table, not per-row) and conditionally
splices the pickBackup column into the array via a spread. Column id and header label are
unchanged when the column IS shown, per the plan's G-8 compatibility requirement.
AlliancesTabSkeleton still renders all seven headers always, with its doc comment now
explaining why: a placeholder that guessed wrong would shift layout twice.

Fixing this broke more existing tests than the plan named outright, all traced to the same
cause -- several fixtures used alliance()'s default 3-pick shape (no backup) and asserted
7 columns:

- The vpr/2024 "seven column headers" test (not just the opr one the plan named) -- both
  used the identical no-backup fixture, so both needed the same fix. Changed to 6 columns
  and added a NEW test asserting 7 columns with a backup-bearing fixture, so both
  directions ("a column that disappears when it should appear is the worse bug") are
  covered by two clearly-purposed tests rather than shoehorning both cases into one.
- "an alliance with exactly three picks renders an empty Backup cell" -- its single-alliance,
  no-backup fixture now has NO backup column at all to find. Rewritten to add a sibling
  alliance WITH a backup, forcing the column to render, then asserting the no-backup row's
  cell is present-but-empty -- a more realistic scenario than the original (a mixed table is
  the real-world case this behavior matters for).
- The two/one-pick "all-or-nothing" tests' pickBackup-blank assertions were removed (the
  column doesn't exist for these fixtures post-fix); their other assertions (blank Pick 1/2,
  filled Captain) are untouched.
- The "count is never branched on" row/column-count test's column-count expectations moved
  from 7 to 6 (same no-backup-anywhere cause).

Confirmed failing first: ran all 5 new/changed assertions together against the unfixed
component -- "expected [ Array(7) ] to have a length of 6 but got 7" and (for the rewritten
empty-cell tests) "expected <td ...>...(1)</td> to be null" -- before making any component
change.

## Task 3 -- tightened columns, and a stretch regression the tightening exposed

allianceNumber 112->88, record 100->72 (both exactly per the plan's measured
header/content requirements). Pick columns and Combined Total untouched.

The regression, live-measured, not anticipated by the plan: dropping Pick 3 (Task 2) and
shrinking these two columns brought the table's own intrinsic width (890px) below the
page's available content width (~1150px on a 1280px viewport). The table's
width:"100%" + minWidth:table.getTotalSize() styling -- the same pattern
Insights/Breakdown/TeamsTable all use, where the column sum is normally close enough to the
container that this never surfaces -- let "100%" start winning over minWidth the moment
the sum dropped, and table-layout:fixed redistributed the freed space proportionally back
across every column. Measured before this second fix: the 88px allianceNumber column
rendered at 113.7px live -- the tightening was silently being undone by the table
stretching to fill the page. Table total measured 1150px, not the plan's targeted ~890px.

Fixed in the same commit: the table's width is now the explicit table.getTotalSize()
pixel value (not "100%", and minWidth is now redundant and dropped) -- simultaneously the
floor (the wrapper's overflow-x-auto still engages below it, unchanged) and the ceiling
(never stretches past it). This is scoped to AlliancesTab.tsx's own inline style only;
Insights/Breakdown/TeamsTable are untouched.

Confirmed failing first: "expected '112px' to be '88px'" (column size), then separately
"expected '100%' to be '890px'" (table width) -- both against the unfixed code, before
each respective fix.

Live-measured after both fixes: table total width exactly 890px; all six header cells'
scrollWidth === clientWidth (no ellipsis truncation anywhere, including "ALLIANCE #" at
88px).

## Task 4 -- the tab strip no longer jumps

Root cause matched the plan's measurement exactly: TabsTrigger's base
h-[calc(100%-1px)] computed against TabsList's fixed h-8 (32px), while every line-variant
trigger's .tap-target class forces a 44px min-height regardless -- a percentage height
anchored to a container 12px shorter than the box actually renders at.

Fix, scoped to the line variant only (via the existing group-data-[variant=line]/
tabs-list: / data-[variant=line]: selector pattern the file's own G-5 fix already
established):

- TabsTrigger: group-data-[variant=line]/tabs-list:h-auto! -- the trigger's height comes
  only from its content plus .tap-target's min-height, never a percentage of the list.
- TabsList: data-[variant=line]:h-auto! (drops the fixed h-8) plus
  data-[variant=line]:py-0! (drops the list's own 3px top/bottom padding) -- went one step
  further than the plan's literal description, so the list's height tracks the trigger's
  EXACTLY rather than the trigger plus 6px of list chrome the trigger's own internal py-0.5
  already accounts for.
- transition-all -> transition-colors on the trigger (the underline already has its own
  scoped after:transition-opacity) -- defense in depth, so a future layout-affecting change
  here renders instantaneously instead of animating into a visible jump.

!important is load-bearing on every override: none of them share a modifier prefix with
the base utility they replace, so Tailwind/Lightning CSS gives no cascade-order guarantee
between h-8 and h-auto (or p-[3px] and py-0) without it.

Measurement note (transparency, not a shortcut): headless Playwright could not reproduce
the human-observed "235 on load, snaps to 232 on first hover" transient in either the
pre-fix or post-fix code -- any DOM geometry read (getBoundingClientRect) appears to
already force the browser to its settled layout, which may be exactly why a human notices
the correction and a script reading geometry does not. What IS directly verified, both by
a new tabs.test.tsx (pinning the override classes exist at the source level, confirmed
failing against the unfixed file first) and by live measurement: the underlying circular
percentage-height dependency the plan names as the cause is gone, and listY/triggerY are
now IDENTICAL (232 = 232) and stable across before/during-hover/after-unhover, not merely
"the same by coincidence" as the unfixed code's y values already happened to be in my
particular measurement session.

Live-measured after the fix: listY === triggerY (232 = 232) before, during, and after
hover. listH (45) equals triggerH (44) plus the 1px border-b divider the event route
itself adds (className="... border-b border-[var(--color-border)]"), not a residual
dependency.

## Task 5 -- the event header's second blind week + 1

hasOutOfBandWeek's parameter type in events-list/filterModel.ts was widened from the
concrete EventRow to a new structural OutOfBandWeekCandidate interface
({ week, isOffseason?, eventType? }) -- EventRow still satisfies it with no cast, and
EventHeader.tsx (which has no isOffseason/eventType on EventArtifact at all) can now call
hasOutOfBandWeek({ week: parts.week }) directly, importing the rule instead of duplicating
it. MAX_SEASON_WEEK itself did not need importing since EventHeader only calls the
predicate, not the constant.

eventMetaLine now omits the week segment for any present week that hasOutOfBandWeek
flags, following the same "a null week renders NOTHING" precedent the function's own doc
comment already established for genuinely absent weeks.

Confirmed failing first: "expected 'Week 19' to be ''" for stored week 18 (the live
2026iscmp value), and "expected 'Week 10' to be ''" for the boundary case (stored week 9,
one past MAX_SEASON_WEEK) -- both against the unfixed EventHeader.tsx. Existing in-band
tests (stored 3 -> "Week 4", stored 0 -> "Week 1", stored 8 -> "Week 9") were re-run and
stayed green, confirming the rule only changes behavior above the bound.

## Verification

```
apps/web suite   -> 76 files, 1178 tests, all passing (was 1176 before this session's
                    two new EventHeader tests)
tsc --noEmit     -> clean after every commit
```

Live re-measurement against http://localhost:5280 after all five commits, in one pass:

- Alliances table on 2026iscmp: 890px total width, 6 headers (Alliance #, Captain, Pick 1,
  Pick 2, Combined Total, Record -- no Pick 3), zero header truncation, no independence
  caveat present.
- Tab strip on the event page: listY === triggerY === 232 before, during, and after hover
  -- no jump.
- Event header meta line for 2026iscmp: "Jul 6, 2026 - M, Israel" -- no week segment.

## Known Stubs

None introduced by this task.

## Self-Check: PASSED

All five commits (d804791f, 834d27b2, 6198ee2c, 33f44ccc, 410cfad5) verified present in git log. AlliancesTab.tsx, AlliancesTab.test.tsx, tabs.tsx, tabs.test.tsx, EventHeader.tsx, EventHeader.test.tsx, filterModel.ts and this SUMMARY.md all verified present on disk.
